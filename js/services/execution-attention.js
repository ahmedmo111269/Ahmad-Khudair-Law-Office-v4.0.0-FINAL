// =====================================================================
// مركز «يحتاج انتباهي» — كشف تنظيمي على تنفيذات المكتب
// ---------------------------------------------------------------------
// • تنبيه تنظيمي لإدارة المكتب، **ليس تقييمًا قانونيًا** لأي موقف.
// • لا يخترع بيانات: كل بطاقة تُبنى من سجلات موجودة (رصيد، إجراء، توكيل،
//   عريضة، حكم) وتعرض سببها وتاريخه.
// • لا يحمّل السجل كله في الذاكرة: مسح محدود بصفحات (limit) وعدّ تراكمي،
//   وما زاد عن السقف يُعلن صراحةً («محسوب على أحدث N تنفيذ»).
// • الحدود قابلة للتعديل من إعدادات التنفيذ: lists.followUpThresholds.
// =====================================================================
import {localDate} from '../core/clock.js';
import {isCivilDate, daysBetweenCivil} from '../domain/execution-period-calendar.js';
import {fromMinorUnits} from '../domain/execution-money.js';
import {executionSettings} from './execution-settings.js';
import {hydrateSimpleRows, simpleCardBundle} from './execution-simple.js';

export const ATTENTION_DISCLAIMER = 'تنبيه تنظيمي — ليس تقييمًا قانونيًا';

export const DEFAULT_THRESHOLDS = Object.freeze({
  unpaidWithoutActionDays: 60,
  poaWithoutResultDays: 30,
  periodEndedWithoutPositionDays: 0,
  petitionWithoutJudicialNumber: true,
  judgmentWithoutEffectiveDate: true,
  enabled: true
});

export const ATTENTION_CATEGORIES = Object.freeze([
  {key: 'unpaidNoAction', severity: 'red', icon: '🔴', title: 'رصيد غير مسدَّد بلا إجراء', filter: 'attention:unpaidNoAction'},
  {key: 'poaNoResult', severity: 'orange', icon: '🟠', title: 'توكيل بلا نتيجة', filter: 'attention:poaNoResult'},
  {key: 'periodNoPosition', severity: 'orange', icon: '🟠', title: 'فترة انتهت بلا موقف', filter: 'attention:periodNoPosition'},
  {key: 'petitionNoJudicial', severity: 'blue', icon: '🔵', title: 'رقم عرائض بلا رقم قضائي', filter: 'attention:petitionNoJudicial'},
  {key: 'judgmentNoEffective', severity: 'blue', icon: '🔵', title: 'حكم بلا تاريخ سريان', filter: 'attention:judgmentNoEffective'}
]);

/** الحدود الفعلية: المحفوظ في الإعدادات فوق الافتراضي (دمج صريح بلا قيم مفقودة). */
export function attentionThresholds(settings) {
  const stored = settings?.lists?.followUpThresholds || {};
  const merged = {...DEFAULT_THRESHOLDS, ...stored};
  const days = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : fallback;
  };
  return {
    unpaidWithoutActionDays: days(merged.unpaidWithoutActionDays, DEFAULT_THRESHOLDS.unpaidWithoutActionDays),
    poaWithoutResultDays: days(merged.poaWithoutResultDays, DEFAULT_THRESHOLDS.poaWithoutResultDays),
    periodEndedWithoutPositionDays: days(merged.periodEndedWithoutPositionDays, DEFAULT_THRESHOLDS.periodEndedWithoutPositionDays),
    petitionWithoutJudicialNumber: merged.petitionWithoutJudicialNumber !== false,
    judgmentWithoutEffectiveDate: merged.judgmentWithoutEffectiveDate !== false,
    enabled: merged.enabled !== false
  };
}

const money = (minor, currency = 'EGP') => fromMinorUnits(Number(minor || 0), currency)
  .toLocaleString('en-US', {maximumFractionDigits: 2});

const ageDays = (iso, today) => (isCivilDate(iso) ? Math.max(0, daysBetweenCivil(iso, today)) : null);

const isActive = row => row && !row.isDeleted && String(row.status || '').toLowerCase() !== 'voided';

/**
 * يفحص تنفيذًا واحدًا ويعيد قائمة البطاقات المستحقة له.
 * `item` = صف hydrateSimpleRows (الأرقام الثلاثة + آخر إجراء).
 */
export function attentionForExecution({execution, item, actions = [], poas = [], judgments = [], thresholds, today = localDate()} = {}) {
  const out = [];
  if (!execution || execution.isDeleted) return out;
  const currency = item?.schedule?.currency || 'EGP';
  const remaining = Number(item?.summary?.remainingMinor || 0);
  const clientName = item?.creditor?.name || execution.clientName || '';
  const number = execution.internalNumber || execution.officialNumber || execution.executionNumber || 'بلا رقم';
  const base = {executionId: execution.id, number, clientName, currency};
  const liveActions = (actions || []).filter(isActive);
  const lastActionDate = liveActions.map(action => action.date).filter(isCivilDate).sort().at(-1) || '';

  // 🔴 رصيد غير مسدَّد بلا إجراء منذ أكثر من الحد
  if (remaining > 0) {
    const age = ageDays(lastActionDate, today);
    const stale = !lastActionDate || (age !== null && age > thresholds.unpaidWithoutActionDays);
    if (stale) {
      out.push({
        ...base, category: 'unpaidNoAction', severity: 'red',
        detail: lastActionDate
          ? `رصيد ${money(remaining, currency)} ج.م — آخر إجراء ${lastActionDate} (منذ ${age} يومًا)`
          : `رصيد ${money(remaining, currency)} ج.م — لا يوجد أي إجراء مسجَّل`,
        date: lastActionDate || execution.openedDate || '',
        amountMinor: remaining
      });
    }
  }

  // 🟠 توكيل صادر بلا إجراء/نتيجة بعده منذ أكثر من الحد
  const livePoas = (poas || []).filter(row => isActive(row) && String(row.status || '') !== 'cancelled');
  for (const poa of livePoas) {
    if (!isCivilDate(poa.date)) continue;
    const age = ageDays(poa.date, today);
    if (age === null || age <= thresholds.poaWithoutResultDays) continue;
    const hasResultAfter = liveActions.some(action => isCivilDate(action.date) && action.date > poa.date);
    if (hasResultAfter) continue;
    out.push({
      ...base, category: 'poaNoResult', severity: 'orange',
      detail: `توكيل ${poa.poaNumber || 'بلا رقم'} صادر ${poa.date} (منذ ${age} يومًا) — لم يُسجَّل إجراء بعده`,
      date: poa.date, amountMinor: Math.round(Number(poa.total || 0) * 100), poaId: poa.id
    });
  }

  // 🟠 فترة انتهت ولم يُتخذ فيها موقف (لا تحصيل يغطيها ولا إجراء بعدها)
  const endedRows = (item?.schedule?.rows || []).filter(row => isCivilDate(row.toDate) && row.toDate < today
    && Number(row.remainingMinor || 0) > 0 && row.status !== 'RUNNING');
  for (const row of endedRows) {
    const age = ageDays(row.toDate, today);
    if (age === null || age < thresholds.periodEndedWithoutPositionDays) continue;
    const hasPositionAfter = liveActions.some(action => isCivilDate(action.date) && action.date >= row.toDate);
    if (hasPositionAfter) continue;
    out.push({
      ...base, category: 'periodNoPosition', severity: 'orange',
      detail: `فترة ${row.fromDate} ← ${row.toDate} منتهية منذ ${age} يومًا بمتبقٍ ${money(row.remainingMinor, currency)} ج.م — لا إجراء بعدها`,
      date: row.toDate, amountMinor: Number(row.remainingMinor || 0), periodKey: row.periodKeys?.[0] || row.fromDate
    });
  }

  // 🔵 رقم عرائض مسجَّل بلا رقم قضائي
  if (thresholds.petitionWithoutJudicialNumber) {
    const petition = String(execution.petitionNumber || '').trim();
    const judicial = String(execution.officialNumber || execution.judicialNumber || '').trim();
    if (petition && !judicial) {
      out.push({
        ...base, category: 'petitionNoJudicial', severity: 'blue',
        detail: `رقم العرائض ${petition} مسجَّل ولا يوجد رقم قضائي للتنفيذ`,
        date: execution.openedDate || ''
      });
    }
  }

  // 🔵 حكم بلا تاريخ سريان (لا يمكن بناء فترات منه بدقة)
  if (thresholds.judgmentWithoutEffectiveDate) {
    for (const judgment of (judgments || []).filter(isActive)) {
      if (isCivilDate(judgment.effectiveFrom)) continue;
      out.push({
        ...base, category: 'judgmentNoEffective', severity: 'blue',
        detail: `حكم ${judgment.judgmentNumber || 'بلا رقم'} بتاريخ ${judgment.judgmentDate || '—'} بلا تاريخ سريان`,
        date: judgment.judgmentDate || '', judgmentId: judgment.id
      });
    }
  }
  return out;
}

/**
 * مسح محدود: يقرأ أحدث `limit` تنفيذ على دفعات، ويعدّ تراكميًا.
 * لا يحمّل السجل كله في الذاكرة، ويُعلن إن كان المسح جزئيًا.
 */
export async function scanAttention(office, {limit = 200, batchSize = 25} = {}) {
  const settings = executionSettings(office);
  const thresholds = attentionThresholds(settings);
  const today = localDate();
  const groups = Object.fromEntries(ATTENTION_CATEGORIES.map(category => [category.key, []]));
  if (!thresholds.enabled) {
    return {enabled: false, thresholds, categories: ATTENTION_CATEGORIES.map(category => ({...category, count: 0, items: []})), scanned: 0, scannedAll: true, total: 0, today};
  }
  const cap = Math.max(1, Math.min(Number(limit) || 200, 1000));
  const size = Math.max(5, Math.min(Number(batchSize) || 25, 100));
  let cursor = null, hasMore = false, scanned = 0;
  const executions = [];
  do {
    const page = await office.r.execution.page({index: 'openedDate', direction: 'prev', cursor, limit: size}).catch(() => ({items: [], hasMore: false}));
    const items = (page.items || []).filter(row => !row.isDeleted);
    executions.push(...items);
    cursor = page.nextCursor || null;
    hasMore = Boolean(page.hasMore);
  } while (cursor && hasMore && executions.length < cap);
  const capped = executions.slice(0, cap);
  for (let index = 0; index < capped.length; index += size) {
    const chunk = capped.slice(index, index + size);
    const hydrated = await hydrateSimpleRows(office, chunk).catch(() => []);
    const perExecution = await Promise.all(chunk.map(async execution => {
      const [actions, poas, judgments] = await Promise.all([
        office.r.executionActions.byIndex('executionId', execution.id, 200).catch(() => []),
        office.r.executionPOAs.byIndex('executionId', execution.id, 200).catch(() => []),
        office.r.judgments.byIndex('executionId', execution.id, 200).catch(() => [])
      ]);
      return {actions, poas, judgments};
    }));
    chunk.forEach((execution, position) => {
      const item = hydrated[position] || null;
      const found = attentionForExecution({execution, item, thresholds, today, ...perExecution[position]});
      for (const hit of found) { if (groups[hit.category]) groups[hit.category].push(hit); }
    });
    scanned += chunk.length;
  }
  const categories = ATTENTION_CATEGORIES.map(category => ({
    ...category,
    count: groups[category.key].length,
    items: groups[category.key].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
  }));
  return {
    enabled: true, thresholds, categories, scanned, scannedAll: !hasMore, today,
    total: categories.reduce((sum, category) => sum + category.count, 0)
  };
}

/** تفاصيل تنفيذ واحد (لفتح بطاقة انتباه داخل صفحة التنفيذ نفسه). */
export async function attentionForCard(office, executionId, {bundle = null} = {}) {
  const settings = executionSettings(office);
  const thresholds = attentionThresholds(settings);
  const today = localDate();
  const data = bundle || await simpleCardBundle(office, executionId, {allowFuture: true});
  return attentionForExecution({
    execution: data.execution,
    item: {schedule: data.schedule, summary: data.schedule.totals, creditor: data.creditor},
    actions: data.actions || [], poas: data.poas || [], judgments: data.judgments || [],
    thresholds, today
  });
}
