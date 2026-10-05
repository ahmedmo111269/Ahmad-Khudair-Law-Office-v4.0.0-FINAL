// =====================================================================
// محرك الفترات — إضافات تشغيلية فوق المحرك القائم (بلا محرك موازٍ)
// ---------------------------------------------------------------------
// • «+ فترة يدوية»: من · إلى · المبلغ · السبب ⇒ شريحة **مقطوعة** ببند مستقل
//   ومعرّف بند خاص، فلا تعدّل الفترات الآلية ولا تزاحمها.
// • «اقتراح الفترة التالية»: آخر نهاية + 1 بنفس القاعدة (نفس تقويم المحرك).
// • شرح مبسّط لقاعدة الفترات يُعرض في الإعدادات.
// كل كتابة تمر عبر خدمات التطبيق القائمة (addExecutionJudgment + saveValueSlice)
// وتُسجَّل في Activity Log. لا تُحذف ولا تُعدَّل أي فترة آلية.
// =====================================================================
import {uid} from '../core/id.js';
import {localDate} from '../core/clock.js';
import {AppError, ERR} from '../core/errors.js';
import {events} from '../core/events.js';
import {isCivilDate, periodIndexOf, periodStart, periodEnd} from '../domain/execution-period-calendar.js';
import {toMinorUnits, fromMinorUnits} from '../domain/execution-money.js';
import {executionSettings} from './execution-settings.js';
import {executionCache} from './execution-cache.js';
import {addExecutionJudgment, saveValueSlice, cancelValueSlice, executionSlices} from './execution.js';
import {executionSimpleInputs} from './execution-simple.js';
import {calendarForPeriodicity} from '../domain/execution-schedule.js';

/** بادئة البند المستقل للفترات اليدوية — تجعله لا يتعارض مع بنود الحكم الآلية. */
export const MANUAL_ITEM_PREFIX = 'فترة يدوية';
export const MANUAL_SLICE_MARKER = 'MANUAL_PERIOD';

const amountLabel = (minor, currency = 'EGP') => fromMinorUnits(Number(minor || 0), currency)
  .toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const display = iso => (isCivilDate(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');

/** هل هذه الشريحة فترة يدوية؟ (مقطوعة + معرّف بند يحمل علامة الفترة اليدوية) */
export function isManualSlice(slice) {
  if (!slice || slice.isDeleted) return false;
  if (slice.valueType !== 'fixed') return false;
  const itemId = String(slice.itemId || '');
  return itemId.includes(`::${MANUAL_SLICE_MARKER}::`) || String(slice.sourceReference || '').startsWith(MANUAL_SLICE_MARKER);
}

/** الفترات اليدوية المسجلة على تنفيذ (للعرض والحذف). */
export async function listManualPeriods(office, executionId) {
  const slices = await executionSlices(office, executionId, {limit: 500}).catch(() => []);
  return slices.filter(isManualSlice).sort((a, b) => String(a.startDate || '').localeCompare(String(b.startDate || '')));
}

/**
 * اقتراح الفترة التالية: آخر نهاية + 1 يوم، بنفس قاعدة الفترات (ANNIVERSARY/CALENDAR_MONTH).
 * قراءة فقط — لا يكتب شيئًا ولا يعدّل الفترات الآلية.
 */
export async function suggestNextPeriod(office, executionId, {bundle = null} = {}) {
  const inputs = bundle ? {execution: bundle.execution, slices: bundle.slices, periods: bundle.periods} : await executionSimpleInputs(office, executionId);
  const settings = bundle?.settings || executionSettings(office);
  const slices = (inputs.slices || []).filter(slice => !slice.isDeleted && !['cancelled', 'superseded'].includes(String(slice.status || '')) && slice.valueType !== 'fixed');
  const active = slices.at(-1) || null;
  if (!active) return {available: false, reason: 'لا يوجد بند قيمة دوري — أدخل القيمة والدورية أولًا.'};
  const anchorDate = isCivilDate(active.anchorDate) ? active.anchorDate : (isCivilDate(active.anchor) ? active.anchor : active.startDate);
  if (!isCivilDate(anchorDate)) return {available: false, reason: 'تاريخ الارتكاز غير محدد على بند القيمة.'};
  const options = calendarForPeriodicity(active.periodicity || 'monthly', {periodBasis: settings?.schedule?.periodBasis || 'ANNIVERSARY', customDays: active.customDays});
  const rows = (bundle?.schedule?.rows || []).filter(row => isCivilDate(row.toDate));
  const lastEnd = rows.length ? rows.map(row => row.toDate).sort().at(-1) : '';
  const today = localDate();
  const reference = lastEnd && lastEnd > today ? lastEnd : today;
  let k = 0;
  try { k = Math.max(0, periodIndexOf(anchorDate, reference, options)); } catch { k = 0; }
  // إن كانت الفترة الحالية لم تُدرج بعد (نهايتها بعد المرجع) نقترح التالية بعدها.
  const candidateK = lastEnd && periodEndSafe(anchorDate, k, options) === lastEnd ? k + 1 : k;
  const fromDate = periodStartSafe(anchorDate, candidateK, options);
  const toDate = periodEndSafe(anchorDate, candidateK, options);
  const amountMinor = Number(active.amountMinor || Math.round(Number(active.amount || 0) * 100)) || 0;
  if (!isCivilDate(fromDate) || !isCivilDate(toDate)) return {available: false, reason: 'تعذر حساب الفترة التالية من الارتكاز.'};
  return {
    available: true, anchorDate, k: candidateK, fromDate, toDate, amountMinor,
    currency: active.currency || settings?.schedule?.defaultCurrency || 'EGP',
    entitlementType: active.entitlementType || '',
    periodicity: active.periodicity || 'monthly',
    periodBasis: settings?.schedule?.periodBasis || 'ANNIVERSARY',
    equation: `الفترة رقم ${candidateK + 1} من الارتكاز ${display(anchorDate)}: ${display(fromDate)} ← ${display(toDate)} × ${amountLabel(amountMinor, active.currency || 'EGP')} = ${amountLabel(amountMinor, active.currency || 'EGP')} ج.م`,
    alreadyInSchedule: rows.some(row => row.fromDate === fromDate && row.toDate === toDate)
  };
}

function periodStartSafe(anchorDate, k, options) { try { return periodStart(anchorDate, k, options); } catch { return ''; } }
function periodEndSafe(anchorDate, k, options) { try { return periodEnd(anchorDate, k, options); } catch { return ''; } }

/**
 * إنشاء فترة يدوية: شريحة مقطوعة ببند مستقل ومعرّف بند خاص.
 * لا تعدّل الفترات الآلية ولا تحذف شيئًا؛ والإلغاء لاحقًا حالة مسجلة بسبب.
 */
export async function createManualPeriod(office, {executionId, fromDate, toDate = '', amount, reason = '', entitlementType = ''} = {}) {
  office.ctx.assert();
  if (!isCivilDate(fromDate)) throw new AppError(ERR.VALIDATION, 'تاريخ بداية الفترة اليدوية مطلوب.', {fromDate: 'مطلوب'});
  const end = isCivilDate(toDate) ? toDate : fromDate;
  if (end < fromDate) throw new AppError(ERR.VALIDATION, 'تاريخ نهاية الفترة قبل بدايتها.', {toDate: 'قبل البداية'});
  const reasonText = String(reason || '').trim();
  if (!reasonText) throw new AppError(ERR.VALIDATION, 'سبب الفترة اليدوية مطلوب — تُضاف إلى الحساب ولا تُنسى.', {reason: 'مطلوب'});
  const settings = executionSettings(office);
  const currency = settings?.schedule?.defaultCurrency || 'EGP';
  let amountMinor = 0;
  try { amountMinor = toMinorUnits(amount, currency); } catch (error) { throw new AppError(ERR.VALIDATION, `المبلغ: ${error.message}`, {amount: error.message}); }
  if (!(amountMinor > 0)) throw new AppError(ERR.VALIDATION, 'مبلغ الفترة اليدوية يجب أن يكون أكبر من صفر.', {amount: 'مطلوب'});
  const label = `${MANUAL_ITEM_PREFIX}${entitlementType ? ` — ${String(entitlementType).trim()}` : ''}`;
  const marker = `${MANUAL_SLICE_MARKER}:${uid()}`;
  const judgment = await addExecutionJudgment(office, {
    executionId, entitlementType: label, judgmentKind: 'other', judgmentDate: fromDate,
    judgmentNumber: '', court: '', valueType: 'fixed', amount: fromMinorUnits(amountMinor, currency),
    effectiveFrom: fromDate, effectiveTo: end,
    notes: `فترة يدوية (${display(fromDate)} ← ${display(end)}) — السبب: ${reasonText}`
  });
  const slice = await saveValueSlice(office, {
    executionId, judgmentId: judgment.id, entitlementType: label, valueType: 'fixed',
    amount: fromMinorUnits(amountMinor, currency), startDate: fromDate, endDate: end,
    itemId: `${executionId}::${marker}`, anchorDate: fromDate,
    sourceReference: `${marker}|${display(fromDate)}→${display(end)}|${reasonText}`,
    notes: reasonText
  });
  executionCache.clearExecution(executionId);
  events.emit('execution:cache-invalidated', {executionId, reason: 'manual-period'});
  return {
    judgment, slice, manualPeriod: {fromDate, toDate: end, amountMinor, reason: reasonText, label},
    equation: `فترة يدوية ${display(fromDate)} ← ${display(end)} = ${amountLabel(amountMinor, currency)} ج.م`
  };
}

/** إلغاء فترة يدوية: حالة مسجلة بسبب (لا حذف فعلي). */
export async function cancelManualPeriod(office, sliceId, reason = '') {
  const text = String(reason || '').trim();
  if (!text) throw new AppError(ERR.VALIDATION, 'سبب إلغاء الفترة اليدوية مطلوب.', {reason: 'مطلوب'});
  const row = await cancelValueSlice(office, sliceId, text);
  if (row?.executionId) {
    executionCache.clearExecution(row.executionId);
    events.emit('execution:cache-invalidated', {executionId: row.executionId, reason: 'manual-period-cancelled'});
  }
  return row;
}

/** شرح مبسّط لقاعدة الفترات — يُعرض في إعدادات التنفيذ وفي نافذة الفترات. */
export function periodRuleExplanation({anchorDate = '', periodBasis = 'ANNIVERSARY', periodicity = 'monthly', today = localDate()} = {}) {
  if (String(periodicity) !== 'monthly' && String(periodicity) !== 'yearly') {
    const label = {weekly: 'أسبوعية', daily: 'يومية', semiMonthly: 'نصف شهرية (15 يومًا)', custom: 'مخصصة'}[String(periodicity)] || String(periodicity);
    return `الدورية ${label}: فترات متتالية بنفس الطول من تاريخ الارتكاز${isCivilDate(anchorDate) ? ` ${display(anchorDate)}` : ''}.`;
  }
  if (!isCivilDate(anchorDate)) {
    return periodBasis === 'CALENDAR_MONTH'
      ? 'CALENDAR_MONTH ⇒ «01/الشهر إلى آخر يوم في الشهر» — شهر تقويمي كامل.'
      : 'ANNIVERSARY ⇒ «من يوم الارتكاز إلى اليوم السابق لذكرى الشهر التالي».';
  }
  const options = calendarForPeriodicity(periodicity, {periodBasis});
  const reference = today > anchorDate ? today : anchorDate;
  let k = 0;
  try { k = Math.max(0, periodIndexOf(anchorDate, reference, options)); } catch { k = 0; }
  const from = periodStartSafe(anchorDate, k, options);
  const to = periodEndSafe(anchorDate, k, options);
  return periodBasis === 'CALENDAR_MONTH'
    ? `CALENDAR_MONTH ⇒ «${display(from)} إلى ${display(to)}» — شهر تقويمي كامل (الارتكاز أول الشهر).`
    : `ANNIVERSARY ⇒ «من ${display(from)} إلى ${display(to)}» (الارتكاز إلى ما قبله في الشهر التالي).`;
}

export const manualPeriodHelpers = Object.freeze({amountLabel, display});
