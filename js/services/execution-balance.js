// =====================================================================
// محرك الرصيد: التفكيك الكامل، لقطة تاريخية، المقارنة، المحاكي، السجل الزمني
// ---------------------------------------------------------------------
// • لا رقم مالي بلا مصدر: كل عقدة في شجرة الرصيد تحمل معرّفاتها (فترة/حكم/محضر/تخصيص).
// • الرصيد في تاريخ معين يُعاد حسابه من البيانات التي كانت مسجلة حتى ذلك التاريخ
//   (تاريخ المعرفة createdAt للسجلات غير المالية، وتاريخ الحركة للحركات المالية).
// • المحاكي «ماذا لو» لا يكتب أي شيء: لا حكم ولا حركة ولا رصيد.
// =====================================================================
import {STORE} from '../db/schema.js';
import {Clock, localDate} from '../core/clock.js';
import {AppError, ERR} from '../core/errors.js';
import {num, round2, isIsoDate, todayIso, DEFAULT_PRORATION, IN_REVIEW_DIFFERENCE_STATUSES, LEDGER_TYPE_LABELS, EXECUTION_TYPE_LABELS} from '../domain/execution.js';
import {balanceAsOf, balanceTrace, buildEntitlementPeriods, analyzeSliceImpact, executionAlerts, slicesOfEntitlement, eligibleSlices} from '../domain/entitlement-engine.js';
import {executionBundle, executionSlices, executionAllocations, executionLedgerRows, executionDifferences, summarizeExecution} from './execution.js';

const TIMELINE_KINDS = {
  [STORE.execution]: {label: 'التنفيذ', route: id => `exc:${id}`},
  [STORE.judgments]: {label: 'حكم', route: id => `rec:judgments:${id}`},
  [STORE.executionValuePeriods]: {label: 'شريحة قيمة', route: null},
  [STORE.executionReceipts]: {label: 'محضر تحصيل', route: null},
  [STORE.executionLedger]: {label: 'حركة مالية', route: null},
  [STORE.executionPOAs]: {label: 'توكيل تنفيذ', route: null},
  [STORE.executionActions]: {label: 'إجراء تنفيذ', route: null},
  [STORE.differenceRecords]: {label: 'فرق استحقاق', route: null},
  [STORE.executionSettlements]: {label: 'تسوية فروق', route: null},
  [STORE.executionAdjustments]: {label: 'تصحيح مالي', route: null},
  [STORE.executionParties]: {label: 'طرف تنفيذ', route: null}
};

/** الرصيد + شجرة التفكيك (حتى الوصول إلى الحكم/الفترة/المحضر/التخصيص/الحركة). */
export async function executionBalance(office, executionId, {asOf = ''} = {}) {
  const info = await executionBundle(office, executionId, {asOf});
  if (!info) throw new AppError(ERR.NOT_FOUND, 'سجل التنفيذ غير موجود.');
  const trace = balanceTrace({
    summary: info.summary, periods: info.periods, allocations: info.allocations, receipts: info.receipts,
    ledger: info.ledger, differences: info.differences, slices: info.slices, judgments: info.judgments
  });
  return {info, trace, summary: info.summary, equations: info.summary.equations};
}

/** الرصيد في تاريخ معين — يعاد حسابه ولا يعتمد على أي رقم حالٍ معدَّل. */
export async function balanceSnapshot(office, executionId, date) {
  if (!isIsoDate(date)) throw new AppError(ERR.VALIDATION, 'تاريخ اللقطة غير صحيح.', {date: 'تاريخ غير صحيح'});
  const execution = await office.r.execution.get(executionId);
  if (!execution || execution.isDeleted) throw new AppError(ERR.NOT_FOUND, 'سجل التنفيذ غير موجود.');
  const [slices, allocations, ledger, differences] = await Promise.all([
    executionSlices(office, executionId), executionAllocations(office, executionId),
    executionLedgerRows(office, executionId), executionDifferences(office, executionId)
  ]);
  // نهاية الاستحقاق المعلنة في التنفيذ تحدّ الفترات: لا تُمدَّد الفترات بعد التاريخ المحدد للاستحقاق.
  const through = execution.entitlementThroughDate && execution.entitlementThroughDate < date ? execution.entitlementThroughDate : date;
  const summary = balanceAsOf({slices, allocations, ledger, differences, asOf: date, throughDate: through, policy: execution.prorationPolicy || DEFAULT_PRORATION, mode: 'effective'});
  const build = buildEntitlementPeriods({slices, to: through, asOf: date, mode: 'effective', policy: execution.prorationPolicy || DEFAULT_PRORATION});
  return {
    date, summary, periods: build.periods,
    ledgerAtDate: ledger.filter(row => !row.date || row.date <= date),
    receiptsAtDateKnown: differences.filter(row => !row.createdAt || String(row.createdAt) <= `${date}T23:59:59.999Z`),
    note: `الرصيد في ${date} محسوب من الفترات والحركات التي تاريخها حتى ذلك اليوم؛ الشرائح المسجلة لاحقًا بتاريخ سريان سابق مُدرجة ومُعلَّمة.`,
    equations: summary.equations
  };
}

/** مقارنة حكمين — عرض فقط، لا تعديل لأي بيانات. */
export async function compareJudgments(office, executionId, firstId, secondId) {
  const execution = await office.r.execution.get(executionId);
  const first = await office.r.judgments.get(firstId);
  const second = await office.r.judgments.get(secondId);
  if (!first || !second) throw new AppError(ERR.NOT_FOUND, 'أحد الحكمين غير موجود.');
  if (first.id === second.id) throw new AppError(ERR.VALIDATION, 'اختر حكمين مختلفين للمقارنة.');
  const slices = await executionSlices(office, executionId);
  const entitlementType = second.entitlementType || first.entitlementType;
  const allocations = await executionAllocations(office, executionId);
  const secondSlice = slicesOfEntitlement(slices, entitlementType).find(slice => slice.judgmentId === secondId) || null;
  const throughDate = execution?.entitlementThroughDate || '';
  const impact = secondSlice ? analyzeSliceImpact({slices, newSlice: secondSlice, allocations, throughDate, policy: execution?.prorationPolicy}) : {rows: [], totals: {difference: 0}};
  return {
    entitlementType,
    first, second,
    rows: [
      {label: 'القيمة', first: num(first.amount) ? round2(num(first.amount)) : '—', second: num(second.amount) ? round2(num(second.amount)) : '—'},
      {label: 'نوع القيمة', first: first.valueType === 'fixed' ? 'ثابت' : 'دوري', second: second.valueType === 'fixed' ? 'ثابت' : 'دوري'},
      {label: 'الدورية', first: first.periodicity || '—', second: second.periodicity || '—'},
      {label: 'تاريخ الحكم', first: first.judgmentDate || '—', second: second.judgmentDate || '—'},
      {label: 'تاريخ سريان القيمة', first: first.effectiveFrom || '—', second: second.effectiveFrom || '—'},
      {label: 'رقم الحكم/الاستئناف', first: first.judgmentNumber || first.appealNumber || '—', second: second.judgmentNumber || second.appealNumber || '—'},
      {label: 'المحكمة', first: first.court || '—', second: second.court || '—'},
      {label: 'الفترات المتأثرة', first: '—', second: impact.rows.length ? `${impact.rows.length} فترة` : 'لا يوجد أثر مسجل'},
      {label: 'الفرق الناتج', first: '—', second: impact.rows.length ? round2(impact.totals.difference) : '—'}
    ],
    impact: impact.rows
  };
}

/**
 * محاكي «ماذا لو»: يحسب أثر قيمة مقترحة بلا أي كتابة. لا حكم ولا حركة ولا رصيد يتغير.
 */
export async function simulateValueChange(office, {executionId, entitlementType, amount, effectiveFrom, periodicity = 'monthly', valueType = 'periodic', endDate = '', throughDate = ''} = {}) {
  const execution = await office.r.execution.get(executionId);
  if (!execution || execution.isDeleted) throw new AppError(ERR.NOT_FOUND, 'سجل التنفيذ غير موجود.');
  if (!(num(amount) > 0)) throw new AppError(ERR.VALIDATION, 'أدخل قيمة مقترحة أكبر من صفر للمحاكاة.', {amount: 'مطلوب'});
  if (!isIsoDate(effectiveFrom)) throw new AppError(ERR.VALIDATION, 'تاريخ سريان مقترح صحيح مطلوب للمحاكاة.', {effectiveFrom: 'مطلوب'});
  const slices = await executionSlices(office, executionId);
  if (!slices.some(slice => slice.entitlementType === entitlementType)) throw new AppError(ERR.VALIDATION, 'لا يوجد نوع استحقاق بهذا الاسم داخل التنفيذ.', {entitlementType: 'غير موجود'});
  const allocations = await executionAllocations(office, executionId);
  const hypothetical = {
    id: '__simulation__', executionId, entitlementType, valueType, amount: round2(num(amount)), periodicity,
    startDate: effectiveFrom, endDate: isIsoDate(endDate) ? endDate : '', judgmentId: '__simulation__', status: 'active',
    createdAt: `${todayIso()}T23:59:59.999Z`, isDeleted: false, simulation: true
  };
  const impact = analyzeSliceImpact({slices, newSlice: hypothetical, allocations, throughDate: throughDate || execution.entitlementThroughDate || '', policy: execution.prorationPolicy});
  const beforeBuild = buildEntitlementPeriods({slices, to: throughDate || execution.entitlementThroughDate || '', policy: execution.prorationPolicy});
  const afterBuild = buildEntitlementPeriods({slices: [...slices, hypothetical], to: throughDate || execution.entitlementThroughDate || '', policy: execution.prorationPolicy});
  const beforeTotal = round2(beforeBuild.periods.reduce((sum, period) => sum + period.finalAmount, 0));
  const afterTotal = round2(afterBuild.periods.reduce((sum, period) => sum + period.finalAmount, 0));
  return {
    simulation: true,
    hypothetical,
    rows: impact.rows,
    totals: {
      difference: impact.totals.difference,
      beforeTotal, afterTotal,
      collected: impact.totals.collected
    },
    scenarios: [
      {label: 'بلا تغيير (الواقع المسجل)', total: beforeTotal},
      {label: 'لو صدر الحكم المقترح', total: afterTotal, delta: round2(afterTotal - beforeTotal)},
      {label: 'لو حُصّل كل الاستحقاق المقترح', total: 0, delta: 0}
    ],
    warning: 'هذه محاكاة فقط: لم يُسجَّل حكم ولم تُنشأ حركة ولم يتغير الرصيد.'
  };
}

/** السجل الزمني للتنفيذ من Activity Log الموجود + وقائع السجلات نفسها. */
export async function executionTimeline(office, executionId, {limit = 200} = {}) {
  const info = await executionBundle(office, executionId);
  if (!info) throw new AppError(ERR.NOT_FOUND, 'سجل التنفيذ غير موجود.');
  const ids = [
    executionId,
    ...info.judgments.map(row => row.id),
    ...info.slices.map(row => row.id),
    ...info.receipts.map(row => row.id),
    ...info.ledger.map(row => row.id),
    ...info.poas.map(row => row.id),
    ...info.actions.map(row => row.id),
    ...info.differences.map(row => row.id),
    ...info.settlements.map(row => row.id),
    ...info.adjustments.map(row => row.id),
    ...info.parties.map(row => row.id)
  ].slice(0, 120);
  const items = [];
  for (const id of ids) {
    const rows = await office.r.activityLog.byIndex('entityId', id, 50);
    for (const row of rows) {
      const kind = TIMELINE_KINDS[row.entityType] || {label: row.entityType || 'نشاط', route: null};
      items.push({
        id: row.id, at: row.timestamp, date: String(row.timestamp || '').slice(0, 10),
        kind: kind.label, title: row.summary || row.action || kind.label,
        action: row.action, entityType: row.entityType, entityId: row.entityId,
        route: kind.route ? kind.route(row.entityId) : '',
        metadata: row.metadata || {}
      });
    }
  }
  // وقائع جوهرية قد تكون بلا سجل نشاط (بيانات مستوردة/قديمة): تُضاف من السجلات نفسها.
  const recorded = new Set(items.map(item => `${item.entityType}|${item.entityId}`));
  const push = (entityType, entityId, date, title, route = '') => {
    if (recorded.has(`${entityType}|${entityId}`) || !date) return;
    items.push({id: `${entityType}:${entityId}`, at: date, date: String(date).slice(0, 10), kind: (TIMELINE_KINDS[entityType] || {}).label || entityType, title, action: 'record', entityType, entityId, route, metadata: {}});
  };
  for (const row of info.judgments) push(STORE.judgments, row.id, row.judgmentDate, `حكم ${row.judgmentNumber || ''}`.trim(), `rec:judgments:${row.id}`);
  for (const row of info.slices) push(STORE.executionValuePeriods, row.id, row.startDate, `شريحة قيمة ${row.amount} من ${row.startDate}`);
  for (const row of info.receipts) push(STORE.executionReceipts, row.id, row.date, `محضر تحصيل ${row.receiptNumber || ''} بمبلغ ${row.amount}`);
  for (const row of info.poas) push(STORE.executionPOAs, row.id, row.date, `توكيل ${row.poaNumber || ''} بإجمالي ${row.total}`);
  for (const row of info.actions) push(STORE.executionActions, row.id, row.date, `إجراء ${row.kind}${row.referenceNumber ? ' — ' + row.referenceNumber : ''}`);
  return items.sort((a, b) => String(b.at || '').localeCompare(String(a.at || ''))).slice(0, limit);
}

export async function executionAlertsFor(office, executionId) {
  const info = await executionBundle(office, executionId);
  if (!info) throw new AppError(ERR.NOT_FOUND, 'سجل التنفيذ غير موجود.');
  return info.alerts;
}

/** صفوف مركز التنفيذ حسب مؤشر مختار (كل مؤشر يفتح قائمة مفلترة). */
export async function executionsForKpi(office, {kpi = 'all', sample = 60, limit = 100} = {}) {
  const page = await office.r.execution.page({index: 'openedDate', direction: 'prev', limit: Math.min(100, Math.max(1, sample))});
  const today = todayIso();
  const rows = [];
  for (const execution of page.items) {
    const info = await executionBundle(office, execution.id);
    if (!info) continue;
    const {summary, alerts} = info;
    const pendingDifferences = info.differences.some(row => IN_REVIEW_DIFFERENCE_STATUSES.includes(row.status));
    const match = {
      all: () => true,
      family: () => execution.executionType === 'family',
      civil: () => execution.executionType === 'civil',
      criminal: () => execution.executionType === 'criminal',
      followUp: () => alerts.some(alert => ['review_overdue', 'stale_follow_up', 'record_needs_review', 'poa_draft', 'receipt_without_result', 'unallocated_collection'].includes(alert.code)) || (execution.nextReviewDate && execution.nextReviewDate <= today),
      overdue: () => execution.nextReviewDate && execution.nextReviewDate < today,
      partialCollection: () => summary.collected > 0 && summary.remaining > 0.005,
      completed: () => summary.finalEntitlement > 0 && summary.remaining <= 0.005,
      // «فروق غير مسددة»: تشمل ما ينتظر المراجعة (لا يُعد التزامًا معتمدًا) وما اعتُمد ولم يُحصَّل
      differencesUnpaid: () => round2(num(summary.differences.approved) + num(summary.differences.pending)) > 0 && summary.remaining > 0.005,
      settlementsReview: () => pendingDifferences
    }[kpi] || (() => true);
    if (match()) rows.push({execution, summary, alerts: alerts.filter(alert => alert.severity !== 'info' || true)});
    if (rows.length >= limit) break;
  }
  return {rows, kpi, sampleSize: page.items.length, hasMore: page.hasMore};
}

export {summarizeExecution, LEDGER_TYPE_LABELS, EXECUTION_TYPE_LABELS, balanceTrace};
