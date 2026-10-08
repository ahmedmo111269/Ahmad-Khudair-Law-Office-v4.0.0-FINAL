// =====================================================================
// مركز التنفيذ — نموذج العمل (Work Model) للقراءة فقط
// ---------------------------------------------------------------------
// يحوّل التنفيذات إلى «عمل مطلوب»: لكل تنفيذ خطوة واحدة واضحة (Next Step)
// بأولوية، وترتيب موحّد للطابور. لا كتابة هنا أبدًا.
//  • الحساب المالي كله من خدمة التنفيذ المبسّطة (hydrateSimpleRows) — لا منطق مالي مكرر.
//  • كل شاشة تعرض الطابور (مركز التنفيذ، الجدول، «مكتب اليوم»، ملف القضية) تقرأ من هنا.
//  • لا قواعد قانونية: الأولوية تعتمد على «متأخرات مسجّلة» و«موعد إجراء مسجّل» فقط.
// =====================================================================
import {localDate, addDays} from '../core/clock.js';
import {isCivilDate} from '../domain/execution-calendar.js';
import {PERIOD_STATUS} from '../domain/execution-schedule.js';
import {EXECUTION_TYPE_LABELS} from '../domain/execution.js';
import {fromMinorUnits} from '../domain/execution-money.js';
import {formatFileNumber} from '../core/file-number.js';
import * as S from './execution-simple.js';

/** سقف مسح الطابور (حماية للأداء): الأحدث أولًا، والبقية عبر البحث في الجدول. */
export const QUEUE_SCAN_CAP = 300;
/** سقف مسح «مكتب اليوم» (أخف من الطابور الكامل). */
export const ATTENTION_SCAN_CAP = 120;
const SCAN_PAGE = 100;
const CHUNK = 25;

export const SEVERITY_RANK = Object.freeze({critical: 4, high: 3, normal: 2, info: 1});
/** الألوان والنصوص: تُستخدم في الواجهة والمكتب معًا (نفس شارات cp-*). */
export const SEVERITY_LABEL = Object.freeze({critical: 'عاجل', high: 'مستحق', normal: 'قريب', info: 'للمراجعة'});

const money = (minor, currency = 'EGP') => `${fromMinorUnits(minor || 0, currency).toLocaleString('en-US', {maximumFractionDigits: 2})} ج.م`;
const dateText = iso => (isCivilDate(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');

/**
 * «المتابعة المخططة» الفعّالة: إجراء مخطَّط تاريخه يتجاوزه إجراءٌ لاحق مسجَّل بتاريخ
 * مساوٍ له أو أحدث، يُعدّ منفَّذًا ولا يبقى «متأخرًا» إلى الأبد (لا تغيير على البيانات).
 */
export function liveFollowUp(hydrated = {}) {
  const next = hydrated.nextAction || null;
  if (!next || !isCivilDate(next.nextActionDate)) return null;
  const last = hydrated.lastAction || null;
  if (last && last.id !== next.id && String(last.date || '') >= next.nextActionDate) return null;
  return next;
}

/**
 * الخطوة التالية لتنفيذ واحد — دالة نقية (قابلة للاختبار بلا IndexedDB).
 * @returns {{code, severity, label, actionLabel, also}}
 */
export function deriveNextStep({statusKey = 'running', statusLabel = '', overdueMinor = 0, overdueSince = '', currency = 'EGP',
  followUpLabel = '', followUpDate = '', hasValue = true, today = localDate()} = {}) {
  if (statusKey === 'completed') return {code: 'done', severity: 'info', label: 'مكتمل السداد', actionLabel: 'فتح البطاقة', also: ''};
  if (statusKey === 'suspended' || statusKey === 'closed') return {code: 'paused', severity: 'info', label: `${statusLabel || 'موقوف'} — لا خطوة حتى إعادة التشغيل`, actionLabel: 'فتح البطاقة', also: ''};
  if (!hasValue) return {code: 'value', severity: 'normal', label: 'لم تُسجَّل القيمة والدورية بعد', actionLabel: 'أدخل القيمة', also: ''};
  const due = isCivilDate(followUpDate) && followUpDate <= today;
  const soon = isCivilDate(followUpDate) && followUpDate > today && followUpDate <= addDays(today, 7);
  const text = followUpLabel || 'إجراء تالٍ';
  if (overdueMinor > 0) {
    const also = due ? `ومعه إجراء ${followUpDate < today ? 'متأخر' : 'مستحق اليوم'}: ${text}` : '';
    return {code: 'collect', severity: 'critical', label: `متأخرات ${money(overdueMinor, currency)} — أقدم استحقاق ${dateText(overdueSince)}`, actionLabel: 'تحصيل', also};
  }
  if (due) return {code: 'action', severity: 'high', label: `${text} — ${followUpDate < today ? `متأخر منذ ${dateText(followUpDate)}` : 'مستحق اليوم'}`, actionLabel: 'تسجيل الإجراء', also: ''};
  if (soon) return {code: 'action', severity: 'normal', label: `${text} — ${dateText(followUpDate)}`, actionLabel: 'تسجيل الإجراء', also: ''};
  if (isCivilDate(followUpDate)) return {code: 'planned', severity: 'info', label: `التالي: ${text} — ${dateText(followUpDate)}`, actionLabel: 'تسجيل الإجراء', also: ''};
  return {code: 'none', severity: 'info', label: 'لا خطوة مجدولة — سجّل ما تم أو حدّد الإجراء التالي', actionLabel: 'تسجيل إجراء', also: ''};
}

/** الحقول المشتقة لتنفيذ واحد من لقطة hydrateSimpleRows + أسماء الأطراف/الملف (قراءة فقط). */
export function describeExecutionRow(row = {}, hydrated = null, legacy = {}, {today = localDate()} = {}) {
  const item = hydrated || null;
  const extra = legacy || {};
  const rows = item?.schedule?.rows || [];
  const overdue = rows.filter(period => period.status !== PERIOD_STATUS.PAID && period.toDate < today && Number(period.remainingMinor || 0) > 0);
  const overdueMinor = overdue.reduce((sum, period) => sum + Number(period.remainingMinor || 0), 0);
  const overdueSince = overdue.map(period => period.toDate).sort()[0] || '';
  const statusKey = item?.status?.key || 'running';
  const followUp = liveFollowUp(item || {});
  const followUpLabel = followUp ? (followUp.nextAction || 'إجراء') : '';
  const followUpDate = followUp?.nextActionDate || '';
  const hasValue = item ? Boolean(item.hasValue || rows.length) : true;
  const currency = item?.schedule?.currency || 'EGP';
  const step = deriveNextStep({
    statusKey, statusLabel: item?.status?.label || '', overdueMinor, overdueSince, currency,
    followUpLabel, followUpDate, hasValue, today
  });
  const fileNumber = row.fileNumber || extra.fileRow?.fileNumber || extra.caseRow?.fileNumber || '';
  const lastAction = item?.lastAction || null;
  return {
    id: row.id, fileId: row.fileId || extra.fileRow?.id || '', clientId: row.clientId || extra.clientRow?.id || '',
    displayNumber: row.internalNumber || row.officialNumber || legacyNumber(row) || '',
    clientName: item?.creditor?.name || extra.clientRow?.fullName || '',
    opponentName: item?.debtor?.name || '',
    fileNumber,
    fileNumberText: fileNumber ? formatFileNumber(fileNumber) : '',
    currency,
    dueUntilToday: item?.summary?.dueMinor || 0,
    paidTotal: item?.summary?.paidMinor || 0,
    remainingTotal: item?.summary?.remainingMinor || 0,
    creditTotal: item?.summary?.creditMinor || 0,
    overdueMinor, overdueCount: overdue.length, overdueSince,
    lastActionLabel: lastAction ? `${lastAction.kindLabel || lastAction.kind || 'إجراء'} ${lastAction.date || ''}`.trim() : '',
    lastActionDate: lastAction?.date || '',
    nextActionLabel: followUp ? `${followUpLabel} ${followUpDate}` : '',
    nextActionText: followUpLabel,
    nextActionDate: followUpDate,
    statusKey, statusLabel: item?.status?.label || '',
    derivedStatus: statusKey,
    periods: rows.length,
    hasValue,
    valueState: hasValue ? 'set' : 'missing',
    step, severity: step.severity,
    // «يحتاج متابعة» = له خطوة عاجلة أو قريبة (مصطلح واحد في العدّاد والطابور).
    needsFollowUp: step.severity === 'critical' || step.severity === 'high' || step.severity === 'normal',
    executionTypeLabel: EXECUTION_TYPE_LABELS[row.executionType] || '',
    authority: row.authority || row.executionOffice || '',
    openedDate: row.openedDate || String(row.createdAt || '').slice(0, 10),
    internalNumber: row.internalNumber || '',
    officialNumber: row.officialNumber || ''
  };
}

function legacyNumber(row) {
  if (row.executionNumber) return `${row.executionNumber}${row.executionYear ? `/${row.executionYear}` : ''}`;
  return '';
}

/** قراءة الكيانات القديمة (المرحلة → القضية → الملف → الموكل) بلا كتابة، مع تخزين مؤقت للطلب. */
async function decorateLegacyRows(office, rows, cache) {
  const get = async (store, id) => {
    if (!id) return null;
    if (!cache.has(`${store}:${id}`)) cache.set(`${store}:${id}`, await office.r[store].get(id).catch(() => null));
    return cache.get(`${store}:${id}`);
  };
  const caseRows = await Promise.all(rows.map(row => (row.caseId ? get('cases', row.caseId) : null)));
  const fileRows = await Promise.all(rows.map((row, i) => {
    const id = row.fileId || caseRows[i]?.fileId || '';
    return id ? get('files', id) : null;
  }));
  const clientRows = await Promise.all(rows.map((row, i) => {
    const id = row.clientId || fileRows[i]?.clientId || '';
    return id ? get('clients', id) : null;
  }));
  return rows.map((_, i) => ({caseRow: caseRows[i], fileRow: fileRows[i], clientRow: clientRows[i]}));
}

/** وصف دفعة من التنفيذات (تعتمد على hydrateSimpleRows الموجودة). */
export async function describeExecutions(office, rows = [], {today = localDate()} = {}) {
  if (!rows.length) return [];
  const cache = new Map();
  const out = [];
  for (let index = 0; index < rows.length; index += CHUNK) {
    const chunk = rows.slice(index, index + CHUNK);
    const [hydrated, legacy] = await Promise.all([
      S.hydrateSimpleRows(office, chunk).catch(() => []),
      decorateLegacyRows(office, chunk, cache).catch(() => chunk.map(() => ({})))
    ]);
    chunk.forEach((row, i) => out.push(describeExecutionRow(row, hydrated[i] || null, legacy[i] || {}, {today})));
  }
  return out;
}

/** مسح الأحدث أولًا بفهرس openedDate (كما كان يفعل مركز التنفيذ). */
export async function scanExecutionRows(office, {limit = QUEUE_SCAN_CAP} = {}) {
  const items = [];
  let cursor = null, hasMore = false;
  do {
    const page = await office.r.execution.page({index: 'openedDate', direction: 'prev', cursor, limit: SCAN_PAGE});
    items.push(...(page.items || []).filter(row => !row.isDeleted));
    cursor = page.nextCursor || null;
    hasMore = Boolean(page.hasMore);
  } while (cursor && hasMore && items.length < limit);
  return {rows: items.slice(0, limit), scannedAll: !hasMore && items.length <= limit};
}

/** الطابور الكامل (حتى السقف): وصف + عدّادات. */
export async function executionWorkQueue(office, {limit = QUEUE_SCAN_CAP, today = localDate()} = {}) {
  const {rows, scannedAll} = await scanExecutionRows(office, {limit});
  const items = await describeExecutions(office, rows, {today});
  return {items, counts: countQueue(items), counted: items.length, scannedAll, today};
}

/** عدّادات الطابور — التعريفات نفسها التي كانت في المركز (running/overdue/needsFollowUp/completed). */
export function countQueue(items = []) {
  const counts = {all: items.length, running: 0, overdue: 0, needsFollowUp: 0, completed: 0, attention: 0, overdueMinor: 0, remainingMinor: 0};
  for (const item of items) {
    if (counts[item.statusKey] !== undefined) counts[item.statusKey] += 1;
    if (item.needsFollowUp) counts.needsFollowUp += 1;
    if (item.severity === 'critical' || item.severity === 'high') counts.attention += 1;
    counts.overdueMinor += Number(item.overdueMinor || 0);
    counts.remainingMinor += Number(item.remainingTotal || 0);
  }
  return counts;
}

/** مطابقة الفلتر (lane) مع العدّادات. */
export function matchesLane(lane, item) {
  if (!lane || lane === 'all') return true;
  if (lane === 'needsFollowUp') return Boolean(item.needsFollowUp);
  return item.statusKey === lane;
}

export const searchableText = item => [item.displayNumber, item.internalNumber, item.officialNumber, item.clientName, item.opponentName, item.fileNumber, item.fileNumberText]
  .filter(Boolean).join(' ').toLowerCase();

/** ترتيب داخل القسم: الأولوية ← أقدم موعد ← الأكبر متبقيًا. */
export function sortItems(items = [], mode = 'urgent') {
  const list = items.slice();
  if (mode === 'remaining') return list.sort((a, b) => (b.remainingTotal || 0) - (a.remainingTotal || 0));
  if (mode === 'recent') return list.sort((a, b) => String(b.openedDate || '').localeCompare(String(a.openedDate || '')));
  return list.sort((a, b) =>
    (SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])
    || String(a.overdueSince || a.nextActionDate || '9999-99-99').localeCompare(String(b.overdueSince || b.nextActionDate || '9999-99-99'))
    || (b.remainingTotal || 0) - (a.remainingTotal || 0));
}

/**
 * أقسام الطابور (بعد الفلتر والبحث والترتيب):
 *  now    — يحتاج قرارك الآن (عاجل/مستحق)
 *  soon   — قريب خلال 7 أيام أو بيانات ناقصة
 *  calm   — جارٍ بلا مطالبة / بخطوة مخططة بعيدة
 *  paused — موقوف أو مغلق يدويًا
 *  done   — مكتمل السداد
 */
export function queueSections(items = [], {lane = 'all', query = '', sort = 'urgent'} = {}) {
  const q = String(query || '').trim().toLowerCase();
  const filtered = items.filter(item => matchesLane(lane, item) && (!q || searchableText(item).includes(q)));
  const sections = {now: [], soon: [], calm: [], paused: [], done: []};
  for (const item of sortItems(filtered, sort)) {
    if (item.statusKey === 'completed') sections.done.push(item);
    else if (item.statusKey === 'suspended' || item.statusKey === 'closed') sections.paused.push(item);
    else if (item.severity === 'critical' || item.severity === 'high') sections.now.push(item);
    else if (item.severity === 'normal') sections.soon.push(item);
    else sections.calm.push(item);
  }
  return sections;
}

/** تحديث بند واحد بعد تسجيل (بلا إعادة مسح الطابور كله). */
export async function refreshExecutionItem(office, executionId, {today = localDate()} = {}) {
  const row = await office.r.execution.get(executionId).catch(() => null);
  if (!row || row.isDeleted) return null;
  const [item] = await describeExecutions(office, [row], {today});
  return item || null;
}

/**
 * عناصر «مكتب اليوم»: التنفيذات التي تحتاج قرارًا الآن فقط (عاجل/مستحق).
 * تُمرَّر إلى محرك التركيز كمصدر إضافي — لا تُخزَّن.
 */
export async function executionAttentionBrief(office, {today = localDate(), scan = ATTENTION_SCAN_CAP} = {}) {
  const {rows} = await scanExecutionRows(office, {limit: scan});
  const items = await describeExecutions(office, rows, {today});
  return items
    .filter(item => item.statusKey !== 'completed' && (item.severity === 'critical' || item.severity === 'high'))
    .map(item => ({
      id: item.id, severity: item.severity, step: item.step.code, label: item.step.label,
      title: [item.displayNumber || 'تنفيذ', item.clientName].filter(Boolean).join(' — '),
      clientName: item.clientName, fileNumber: item.fileNumberText, fileId: item.fileId,
      date: item.overdueSince || item.nextActionDate || today,
      actionLabel: item.step.actionLabel,
      overdueMinor: item.overdueMinor, remainingMinor: item.remainingTotal, currency: item.currency
    }));
}

/** تنفيذات ملف واحد (فهرس fileId القائم) — لكوكبيت الملف. */
export async function executionsForFile(office, fileId, {today = localDate(), limit = 50} = {}) {
  if (!fileId) return [];
  const rows = await office.r.execution.byIndex('fileId', fileId, limit).catch(() => []);
  return describeExecutions(office, rows.filter(row => !row.isDeleted), {today});
}
