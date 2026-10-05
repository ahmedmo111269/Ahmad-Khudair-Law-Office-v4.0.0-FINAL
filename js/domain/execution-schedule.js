// =====================================================================
// محرك جدول الاستحقاق المشتق (Derived Execution Schedule)
// • الفترات من تاريخ ارتكاز ثابت، بقيمة كاملة، ولا تدخل الفترة الجارية في المستحق.
// • كل الحسابات المالية وحدات صغرى صحيحة؛ أطوال الفترات لا تدخل معادلة القيمة.
// =====================================================================
import {
  addCivilDays, completedPeriods, isCivilDate, periodEnd, periodIndexOf, periodStart, runningPeriod,
  semiMonthlyPeriod, semiMonthlyPeriodIndex
} from './execution-period-calendar.js';
import {addMinor, fromMinorUnits, sumMinor, toMinorUnits} from './execution-money.js';

export const SCHEDULE_MAX_UNITS = 1200;
export const EXECUTION_ENGINE_VERSION = 2;

export const PERIOD_STATUS = Object.freeze({
  PAID: 'paid', PARTIAL: 'partial', UNPAID: 'unpaid', NOTHING_DUE: 'nothing_due',
  RUNNING: 'RUNNING', NEEDS_DECISION: 'NEEDS_DECISION'
});

export const PERIOD_STATUS_LABELS = Object.freeze({
  paid: '✔ مسدد', partial: '◐ جزئي', unpaid: '✗ غير مدفوع', nothing_due: '· لا استحقاق',
  RUNNING: '⏳ جارية (تُستحق عند اكتمالها)', NEEDS_DECISION: '⚠ بحاجة قرار'
});

/**
 * توقيت الاستحقاق — إعداد ممارسة مكتب قابل للاختيار، وليس ثابتًا قانونيًا.
 * • AT_PERIOD_START : الفترة تُستحق من يوم بدايتها (نفقة تُستحق مقدَّمًا) — وهو
 *   الافتراضي، لأنه يمنع «تنفيذ جديد بلا أي رقم» عند بدء السريان من اليوم.
 * • AFTER_PERIOD_END: الفترة لا تُستحق إلا بعد انتهائها (مطالبة بالمدة المنقضية).
 * في الحالتين تبقى الفترة الجارية ظاهرة بمبلغها المتوقع، فلا نافذة فارغة أبدًا.
 */
export const ACCRUAL_TIMINGS = Object.freeze(['AT_PERIOD_START', 'AFTER_PERIOD_END']);
export const ACCRUAL_TIMING_LABELS = Object.freeze({
  AT_PERIOD_START: 'من بداية الفترة (تُستحق مقدَّمًا)',
  AFTER_PERIOD_END: 'بعد اكتمال الفترة'
});

/** إعداد ممارسة المكتب المؤرخة — لا تمثل حكمًا قانونيًا ثابتًا. */
export const DEFAULT_SCHEDULE_SETTINGS = Object.freeze({
  engineVersion: EXECUTION_ENGINE_VERSION,
  effectiveFrom: '2026-10-05',
  source: 'ممارسة المكتب — بحسب إفادة المستخدم',
  periodBasis: 'ANNIVERSARY',
  startPolicy: 'ASK',
  midChangePolicy: 'ASK',
  endPolicy: 'ASK',
  accrualTiming: 'AT_PERIOD_START',
  monthEndPolicy: 'CLAMP_TO_LAST_DAY',
  allocationOrder: 'fifo',
  roundingPolicy: 'integerMinorUnits',
  carryCreditForward: true,
  defaultCurrency: 'EGP'
});

const EXPENSE_LEDGER_TYPES = new Set(['EXECUTION_FEE', 'STAMP', 'COLLECTION_FEE', 'OTHER_EXPENSE']);
export const isExpenseLedgerRow = row => EXPENSE_LEDGER_TYPES.has(String(row?.type || '')) || String(row?.category || '') === 'expense';
const VOIDED_STATUSES = new Set(['voided', 'cancelled']);
const MID_CHOICES = new Set(['KEEP_OLD_VALUE', 'USE_NEW_VALUE', 'MANUAL']);
const END_CHOICES = new Set(['INCLUDE_FULL', 'EXCLUDE', 'MANUAL']);

export function currencyCode(value, fallback = 'EGP') {
  const text = String(value || '').trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(text)) return text;
  return String(fallback || 'EGP').toUpperCase();
}

export function minorFromRow(row, currency = 'EGP') {
  if (Number.isSafeInteger(row?.amountMinor)) return row.amountMinor;
  const raw = row?.amount;
  if (raw === null || raw === undefined || raw === '') return 0;
  try { return toMinorUnits(raw, currency); } catch { return 0; }
}

function settingsWith(settings) {
  const out = {...DEFAULT_SCHEDULE_SETTINGS, ...(settings || {})};
  if (!['ANNIVERSARY', 'CALENDAR_MONTH'].includes(out.periodBasis)) out.periodBasis = 'ANNIVERSARY';
  if (!['ASK', 'INCLUDE_FULL', 'EXCLUDE', 'MANUAL'].includes(out.startPolicy)) out.startPolicy = 'ASK';
  if (!['ASK', 'KEEP_OLD_VALUE', 'USE_NEW_VALUE', 'MANUAL'].includes(out.midChangePolicy)) out.midChangePolicy = 'ASK';
  if (!['ASK', 'INCLUDE_FULL', 'EXCLUDE', 'MANUAL'].includes(out.endPolicy)) out.endPolicy = 'ASK';
  // توقيت الاستحقاق خيار مكتب حقيقي: كان مُثبَّتًا برمجيًا على AFTER_PERIOD_END فصار أي
  // تنفيذ جديد يبدأ سريانه من اليوم بلا أي رقم حتى نهاية الشهر. صار قابلًا للاختيار.
  if (!ACCRUAL_TIMINGS.includes(out.accrualTiming)) out.accrualTiming = DEFAULT_SCHEDULE_SETTINGS.accrualTiming;
  out.monthEndPolicy = 'CLAMP_TO_LAST_DAY';
  if (!['fifo', 'lifo', 'proportional'].includes(out.allocationOrder)) out.allocationOrder = 'fifo';
  return out;
}

const isActiveSlice = slice => slice && !slice.isDeleted
  && !VOIDED_STATUSES.has(String(slice.status || '').toLowerCase())
  && String(slice.status || '') !== 'superseded';
const sliceStart = slice => isCivilDate(slice?.startDate) ? slice.startDate : '';
const sliceEnd = slice => isCivilDate(slice?.endDate) ? slice.endDate : '';
const minimum = (...values) => values.filter(Boolean).sort()[0] || '';

/**
 * خريطة الدورية ← وحدة التقويم. مصدر واحد لكل الطبقات (المحرك، شاشة الأفق،
 * محرك الفترات اليدوية) حتى لا يختلف تاريخ مقترح عن تاريخ محسوب.
 */
export function calendarForPeriodicity(periodicity, {periodBasis = 'ANNIVERSARY', monthEndPolicy = 'CLAMP_TO_LAST_DAY', customDays = null} = {}) {
  const frequency = String(periodicity || 'monthly');
  if (frequency === 'yearly') return {unit: 'YEAR', monthEndPolicy};
  if (frequency === 'weekly') return {unit: 'WEEK'};
  if (frequency === 'daily') return {unit: 'DAY'};
  if (frequency === 'custom') return {unit: 'DAY', step: Math.max(1, Number(customDays) || 1)};
  if (frequency === 'semiMonthly') return {unit: 'DAY', step: 15, semiMonthly: true};
  return {unit: 'MONTH', periodBasis, monthEndPolicy};
}

function calendarFor(group, settings) {
  return calendarForPeriodicity(group.periodicity, {periodBasis: settings.periodBasis, monthEndPolicy: settings.monthEndPolicy, customDays: group.customDays});
}

/** قيم البند على محور زمني، مع إبقاء ارتكاز أول قيمة ثابتًا في السلسلة كلها. */
/** تنسيق مدني موحّد للتواريخ والمبالغ داخل المعادلات المعروضة للمستخدم. */
export function civilLabel(iso) {
  return isCivilDate(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : String(iso || '—');
}
/**
 * مبلغ بوحدات كبرى داخل المعادلات المعروضة.
 * بلا فواصل آلاف عمدًا: المعادلة تُقرأ كقيمة حسابية (`× 4000.00 = 4000.00 ج.م`)
 * وتبقى قابلة للبحث والمقارنة النصية في الاختبارات والمستندات.
 */
export function minorLabel(minor, currency = 'EGP') {
  return fromMinorUnits(Number.isSafeInteger(minor) ? minor : 0, currencyCode(currency)).toFixed(2);
}

export function valueTimeline(slices = []) {
  const groups = new Map();
  for (const slice of (slices || []).filter(isActiveSlice)) {
    const start = sliceStart(slice);
    if (!start) continue;
    const fixed = String(slice.valueType || 'periodic') === 'fixed';
    const type = String(slice.entitlementType || slice.obligationType || 'بند').trim() || 'بند';
    const itemId = String(slice.itemId || slice.obligationId || `legacy:${type}`);
    const key = `${itemId}::${fixed ? 'fixed' : 'periodic'}`;
    if (!groups.has(key)) groups.set(key, {key, itemId, entitlementType: type, fixed, slices: [], periodicity: slice.periodicity || 'monthly', currency: currencyCode(slice.currency, DEFAULT_SCHEDULE_SETTINGS.defaultCurrency)});
    const group = groups.get(key);
    group.slices.push({
      id: slice.id, startDate: start, endDate: sliceEnd(slice), fixed,
      amountMinor: minorFromRow(slice, currencyCode(slice.currency, DEFAULT_SCHEDULE_SETTINGS.defaultCurrency)), judgmentId: slice.judgmentId || slice.linkedJudgmentId || '',
      partyId: slice.partyId || '', judgmentKind: slice.judgmentKind || '', periodicity: slice.periodicity || group.periodicity,
      customDays: Number(slice.customDays) || null,
      anchorDate: isCivilDate(slice.anchorDate) ? slice.anchorDate : (isCivilDate(slice.anchor) ? slice.anchor : ''),
      startPeriodChoice: slice.startPeriodChoice || '', midPeriodChoice: slice.midPeriodChoice || '', endPeriodChoice: slice.endPeriodChoice || '',
      periodDecisionsSnapshot: Array.isArray(slice.periodDecisionsSnapshot) ? slice.periodDecisionsSnapshot.map(row => ({...row})) : [],
      manualStartAmountMinor: Number.isSafeInteger(slice.manualStartAmountMinor) ? slice.manualStartAmountMinor : null,
      manualPeriodAmountMinor: Number.isSafeInteger(slice.manualPeriodAmountMinor) ? slice.manualPeriodAmountMinor : null,
      manualEndAmountMinor: Number.isSafeInteger(slice.manualEndAmountMinor) ? slice.manualEndAmountMinor : null,
      choiceReason: String(slice.choiceReason || slice.midPeriodReason || ''),
      startChoiceReason: String(slice.startChoiceReason || ''),
      sourceReference: slice.sourceReference || '', currency: slice.currency || '', raw: slice
    });
    if (!fixed && slice.periodicity) group.periodicity = slice.periodicity;
  }
  for (const group of groups.values()) {
    group.slices.sort((a, b) => a.startDate.localeCompare(b.startDate) || String(a.id).localeCompare(String(b.id)));
    group.anchorDate = group.slices.map(slice => slice.anchorDate).find(isCivilDate) || group.slices[0].startDate;
    group.periodicity = group.slices[0]?.periodicity || group.periodicity || 'monthly';
    group.customDays = group.slices[0]?.customDays || null;
    group.slices.forEach((slice, index) => {
      const next = group.slices[index + 1];
      const derivedEnd = next ? addCivilDays(next.startDate, -1) : '';
      slice.effectiveEnd = minimum(slice.endDate || '', derivedEnd || '', '9999-12-31');
      slice.previous = index ? group.slices[index - 1] : null;
    });
    group.calendar = calendarFor(group, settingsWith({}));
  }
  return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key));
}

function periodIndexFor(group, date, settings) {
  return group.periodicity === 'semiMonthly'
    ? semiMonthlyPeriodIndex(group.anchorDate, date)
    : periodIndexOf(group.anchorDate, date, calendarFor(group, settings));
}
function periodForIndex(group, k, settings) {
  if (group.periodicity === 'semiMonthly') return semiMonthlyPeriod(group.anchorDate, k);
  const calendar = calendarFor(group, settings);
  return {k, from: periodStart(group.anchorDate, k, calendar), to: periodEnd(group.anchorDate, k, calendar)};
}
function periodsForGroup(group, asOf, settings, maxUnits) {
  if (asOf < group.anchorDate) return {complete: [], running: [], truncated: false};
  if (group.periodicity !== 'semiMonthly') {
    const calendar = calendarFor(group, settings);
    const complete = completedPeriods(group.anchorDate, asOf, {
      ...calendar, accrualTiming: settings.accrualTiming, maxPeriods: maxUnits
    });
    const running = runningPeriod(group.anchorDate, asOf, {...calendar, accrualTiming: settings.accrualTiming});
    return {complete, running: running ? [running] : [], truncated: complete.length >= maxUnits};
  }
  const currentK = semiMonthlyPeriodIndex(group.anchorDate, asOf);
  const complete = [], running = [];
  let k = 0;
  for (; k <= currentK && complete.length < maxUnits; k += 1) {
    const period = periodForIndex(group, k, settings);
    if (period.to <= asOf) complete.push(period);
    else if (period.from <= asOf && period.to >= asOf) running.push(period);
  }
  const nextUnvisited = periodForIndex(group, k, settings);
  return {complete, running, truncated: k <= currentK || nextUnvisited.from <= asOf};
}

function periodUnitKey(group, k) {
  return `${encodeURIComponent(group.itemId)}::${group.anchorDate}::${k}`;
}

function configuredChoice(sliceChoice, configured, choices) {
  if (choices.has(sliceChoice)) return sliceChoice;
  return choices.has(configured) ? configured : 'ASK';
}
const sliceDecision = (slice, kind) => (slice?.periodDecisionsSnapshot || []).find(row => row.kind === kind) || null;

/** Decide one whole period; this routine has no day counts or fractional-value inputs. */
function resolvePeriodValue(group, period, settings) {
  const insideStarts = group.slices.filter(slice => slice.startDate > period.from && slice.startDate <= period.to);
  const firstSlice = group.slices[0];
  const initialStartK = firstSlice ? periodIndexFor(group, firstSlice.startDate, settings) : null;
  const initialPartial = Boolean(firstSlice && period.k === initialStartK && firstSlice.startDate > period.from && firstSlice.startDate <= period.to);
  let selected = group.slices.filter(slice => slice.startDate <= period.from).at(-1) || null;
  let manualValue = null;
  let choice = '';
  const decisionSnapshots = [];
  if (initialPartial) {
    const startChoice = configuredChoice(firstSlice.startPeriodChoice, settings.startPolicy, new Set(['INCLUDE_FULL', 'EXCLUDE', 'MANUAL']));
    choice = startChoice;
    const startDecision = sliceDecision(firstSlice, 'START_DATE');
    if (startDecision) decisionSnapshots.push(startDecision);
    if (startChoice === 'ASK') return {needsDecision: true, reason: 'بداية الالتزام تقع في منتصف فترة', transition: firstSlice, choiceOptions: ['INCLUDE_FULL', 'EXCLUDE', 'MANUAL'], decisionKind: 'START_DATE'};
    if (startChoice === 'EXCLUDE') return {amountMinor: 0, parts: [], skipped: true, startChoice};
    if (startChoice === 'INCLUDE_FULL') selected = firstSlice;
    else {
      manualValue = firstSlice.manualStartAmountMinor;
      if (!Number.isSafeInteger(manualValue) || manualValue < 0) return {needsDecision: true, reason: 'المبلغ اليدوي لفترة البداية غير مسجل', transition: firstSlice, choiceOptions: ['MANUAL'], decisionKind: 'START_MANUAL'};
      selected = firstSlice;
    }
  }
  const initialCalendarStart = initialPartial;
  const transitions = initialCalendarStart ? insideStarts.filter(slice => slice.id !== firstSlice?.id) : insideStarts;
  if (transitions.length) {
    const transition = transitions.at(-1);
    const choiceValue = configuredChoice(transition.midPeriodChoice, settings.midChangePolicy, MID_CHOICES);
    choice = choiceValue;
    const midDecision = sliceDecision(transition, 'MID_CHANGE');
    if (midDecision) decisionSnapshots.push(midDecision);
    if (choiceValue === 'ASK') return {needsDecision: true, reason: 'حكم لاحق يبدأ في منتصف فترة', transition, choiceOptions: ['KEEP_OLD_VALUE', 'USE_NEW_VALUE', 'MANUAL']};
    if (choiceValue === 'KEEP_OLD_VALUE') {
      if (!selected) selected = group.slices.find(slice => slice.id === transition.previous?.id) || null;
    } else if (choiceValue === 'USE_NEW_VALUE') selected = transition;
    else {
      manualValue = transition.manualPeriodAmountMinor;
      if (!Number.isSafeInteger(manualValue) || manualValue < 0) return {needsDecision: true, reason: 'المبلغ اليدوي للفترة غير مسجل', transition, choiceOptions: ['MANUAL']};
      selected = transition;
    }
  }
  if (!selected && initialCalendarStart) selected = group.slices[0];
  if (!selected || selected.startDate > period.to || selected.effectiveEnd < period.from) return {amountMinor: 0, parts: [], skipped: true};

  const endsMidPeriod = selected.endDate && selected.endDate >= period.from && selected.endDate < period.to;
  if (endsMidPeriod) {
    const endChoice = configuredChoice(selected.endPeriodChoice, settings.endPolicy, END_CHOICES);
    const endDecision = sliceDecision(selected, 'END_DATE');
    if (endDecision) decisionSnapshots.push(endDecision);
    if (endChoice === 'ASK') return {needsDecision: true, reason: 'نهاية الحكم تقع في منتصف فترة', transition: selected, choiceOptions: ['INCLUDE_FULL', 'EXCLUDE', 'MANUAL']};
    if (endChoice === 'EXCLUDE') return {amountMinor: 0, parts: [], skipped: true, endChoice};
    if (endChoice === 'MANUAL') {
      const amountMinor = selected.manualEndAmountMinor;
      if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) return {needsDecision: true, reason: 'المبلغ اليدوي لنهاية الفترة غير مسجل', transition: selected, choiceOptions: ['MANUAL']};
      manualValue = amountMinor;
    }
  }
  const amountMinor = manualValue === null ? selected.amountMinor : manualValue;
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) throw new RangeError('قيمة الفترة ليست عددًا صحيحًا بوحدات صغرى.');
  return {
    amountMinor,
    selected,
    choice,
    parts: amountMinor > 0 ? [{
      sliceId: selected.id, judgmentId: selected.judgmentId, judgmentKind: selected.judgmentKind, partyId: selected.partyId,
      amountMinor, rateAmountMinor: selected.amountMinor, currency: selected.currency, sourceReference: selected.sourceReference,
      valueChange: selected.previous ? {
        previousSliceId: selected.previous.id, previousAmountMinor: selected.previous.amountMinor,
        previousJudgmentId: selected.previous.judgmentId, newAmountMinor: selected.amountMinor,
        differenceMinor: addMinor(selected.amountMinor, -selected.previous.amountMinor)
      } : null,
      choice, choiceReason: decisionSnapshots.map(row => row.reason).filter(Boolean).join('؛ ') || selected.choiceReason || '',
      decisionsSnapshot: decisionSnapshots, equation: `1 فترة كاملة (${civilLabel(period.from)} → ${civilLabel(period.to)}) × ${minorLabel(amountMinor, selected.currency)} = ${minorLabel(amountMinor, selected.currency)} ج.م`
    }] : []
  };
}

/**
 * Build derived units for completed periods plus an informational running period.
 * Periods are generated from each item's immutable original anchor.
 */
export function buildScheduleUnits({slices = [], asOf = '', fromDate = '', settings = {}, maxUnits = SCHEDULE_MAX_UNITS} = {}) {
  const options = settingsWith(settings);
  if (!isCivilDate(asOf)) throw new RangeError('تاريخ الحساب غير صحيح.');
  if (fromDate && !isCivilDate(fromDate)) throw new RangeError('تاريخ البداية غير صحيح.');
  const groups = valueTimeline(slices);
  const units = [];
  const decisions = [];
  let truncated = false;
  for (const group of groups) {
    const first = group.slices[0];
    if (!first) continue;
    if (group.fixed || String(group.periodicity) === 'fixed') {
      if (first.startDate > asOf || (first.endDate && first.endDate < first.startDate)) continue;
      const key = periodUnitKey(group, 0);
      units.push({
        periodKey: key, unitKey: key, legacyPeriodKey: `${group.entitlementType}::${first.startDate}`,
        itemId: group.itemId, anchorDate: group.anchorDate, k: 0, entitlementType: group.entitlementType,
        periodicity: 'fixed', currency: group.currency, fixed: true, isComplete: true, fromDate: first.startDate, toDate: first.startDate,
        dueMinor: first.amountMinor, projectedMinor: first.amountMinor,
        parts: [{sliceId: first.id, judgmentId: first.judgmentId, judgmentKind: first.judgmentKind, partyId: first.partyId, currency: first.currency,
          amountMinor: first.amountMinor, rateAmountMinor: first.amountMinor, sourceReference: first.sourceReference,
          valueChange: null, equation: `${minorLabel(first.amountMinor, first.currency)} ج.م (مبلغ مقطوع مرة واحدة)`}]
      });
      continue;
    }

    const generated = periodsForGroup(group, asOf, options, maxUnits);
    const complete = generated.complete;
    if (generated.truncated) truncated = true;
    const periods = [...complete, ...generated.running.filter(item => !complete.some(done => done.k === item.k))];
    const uniquePeriods = [...new Map(periods.map(period => [period.k, period])).values()].sort((a, b) => a.k - b.k);
    for (const period of uniquePeriods) {
      if (fromDate && period.to < fromDate) continue;
      if (period.from > asOf) continue;
      const isComplete = complete.some(item => item.k === period.k);
      const result = resolvePeriodValue(group, period, options);
      const unitKey = periodUnitKey(group, period.k);
      if (result.needsDecision) {
        decisions.push({itemId: group.itemId, periodKey: unitKey, k: period.k, fromDate: period.from, toDate: period.to, kind: result.decisionKind || 'MID_CHANGE', reason: result.reason, choiceOptions: result.choiceOptions || []});
        units.push({
          periodKey: unitKey, unitKey, legacyPeriodKey: `${group.entitlementType}::${period.from}`,
          itemId: group.itemId, anchorDate: group.anchorDate, k: period.k, entitlementType: group.entitlementType,
          periodicity: group.periodicity, currency: group.currency, fixed: false, isComplete, needsDecision: true, status: PERIOD_STATUS.NEEDS_DECISION,
          decisionReason: result.reason, fromDate: period.from, toDate: period.to, dueOn: period.to,
          dueMinor: 0, projectedMinor: 0, parts: []
        });
        continue;
      }
      if (result.skipped || !result.parts.length) continue;
      const unit = {
        periodKey: unitKey, unitKey, legacyPeriodKey: `${group.entitlementType}::${period.from}`,
        itemId: group.itemId, anchorDate: group.anchorDate, k: period.k, entitlementType: group.entitlementType,
        periodicity: group.periodicity, currency: group.currency, fixed: false, isComplete, fromDate: period.from, toDate: period.to, dueOn: period.to,
        dueMinor: isComplete ? result.amountMinor : 0,
        projectedMinor: result.amountMinor, parts: result.parts,
        valueMinor: result.amountMinor,
        choice: result.choice || '', choiceReason: result.parts[0]?.choiceReason || ''
      };
      units.push(unit);
    }
  }
  const deduped = [...new Map(units.map(unit => [unit.unitKey, unit])).values()]
    .filter(unit => !fromDate || unit.toDate >= fromDate)
    .sort((a, b) => a.fromDate.localeCompare(b.fromDate) || a.unitKey.localeCompare(b.unitKey));
  return {units: deduped, truncated, groups, decisions, engineVersion: options.engineVersion};
}

/**
 * التخصيص: تثبيت (DIRECT) ثم تلقائي بالترتيب المختار، والزائد رصيد دائن.
 * لا يُنشئ المحرك أي سجل تخزين — النتيجة نقية وقابلة لإعادة البناء بالكامل.
 */
export function allocateReceipts({units = [], receipts = [], allocations = [], settings = {}, asOf = ''} = {}) {
  const options = settingsWith(settings);
  const unitsByKey = new Map();
  const unitsByLegacyKey = new Map();
  for (const unit of units) {
    unitsByKey.set(unit.unitKey, unit);
    const aliases = unitsByLegacyKey.get(unit.legacyPeriodKey) || [];
    aliases.push(unit);
    unitsByLegacyKey.set(unit.legacyPeriodKey, aliases);
  }
  const activeReceipts = (receipts || [])
    .filter(receipt => !receipt.isDeleted && !VOIDED_STATUSES.has(String(receipt.status || '').toLowerCase()))
    .filter(receipt => !asOf || !receipt.date || receipt.date <= asOf)
    .map(receipt => ({
      id: receipt.id, date: receipt.date || '', receiptNumber: receipt.receiptNumber || '',
      amountMinor: minorFromRow(receipt, currencyCode(receipt.currency, options.defaultCurrency)),
      paymentMethod: receipt.paymentMethod || '', reference: receipt.reference || '', notes: receipt.notes || '',
      createdAt: receipt.createdAt || '', currency: currencyCode(receipt.currency, options.defaultCurrency)
    }))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.createdAt).localeCompare(String(b.createdAt)) || String(a.id).localeCompare(String(b.id)));
  const receiptById = new Map(activeReceipts.map(receipt => [receipt.id, receipt]));

  const paidByUnit = new Map();
  const remainingCapacity = new Map();
  for (const unit of units) {
    paidByUnit.set(unit.unitKey, []);
    remainingCapacity.set(unit.unitKey, unit.isComplete ? unit.dueMinor : unit.projectedMinor);
  }

  const warnings = [];
  const pins = (allocations || [])
    .filter(row => !row.isDeleted && row.isActive !== false && !row.supersededBy && row.receiptId)
    .filter(row => receiptById.has(row.receiptId))
    .map(row => ({
      receiptId: row.receiptId, requestedKey: row.periodKey,
      amountMinor: minorFromRow(row, receiptById.get(row.receiptId)?.currency || options.defaultCurrency),
      method: row.method || 'DIRECT', ledgerId: row.ledgerId || '', mode: row.mode || 'direct'
    }))
    .sort((a, b) => String(receiptById.get(a.receiptId)?.date || '').localeCompare(String(receiptById.get(b.receiptId)?.date || ''))
      || a.requestedKey.localeCompare(b.requestedKey));
  const pinnedRequestedByUnit = new Map();
  const pinnedSpent = new Map();
  for (const pin of pins) {
    let unit = unitsByKey.get(pin.requestedKey);
    if (!unit) {
      const candidates = unitsByLegacyKey.get(pin.requestedKey) || [];
      if (candidates.length === 1) unit = candidates[0];
      else {
        warnings.push({code: candidates.length ? 'pin-ambiguous-period' : 'pin-unknown-period', receiptId: pin.receiptId, periodKey: pin.requestedKey});
        continue;
      }
    }
    pinnedRequestedByUnit.set(unit.unitKey, addMinor(pinnedRequestedByUnit.get(unit.unitKey) || 0, pin.amountMinor));
    const capacity = remainingCapacity.get(unit.unitKey) || 0;
    const allowance = Math.min(pin.amountMinor, capacity);
    if (allowance < pin.amountMinor) warnings.push({code: 'pin-over-period', receiptId: pin.receiptId, periodKey: unit.unitKey, requestedMinor: pin.amountMinor, appliedMinor: allowance});
    if (allowance <= 0) continue;
    remainingCapacity.set(unit.unitKey, addMinor(capacity, -allowance));
    paidByUnit.get(unit.unitKey).push({receiptId: pin.receiptId, amountMinor: allowance, mode: unit.isComplete ? 'direct' : 'advance', ledgerId: pin.ledgerId});
    pinnedSpent.set(pin.receiptId, addMinor(pinnedSpent.get(pin.receiptId) || 0, allowance));
  }

  const order = options.allocationOrder === 'lifo' ? -1 : 1;
  const orderedOpenUnits = () => units.filter(unit => (remainingCapacity.get(unit.unitKey) || 0) > 0)
    .sort((a, b) => Number(b.isComplete) - Number(a.isComplete)
      || order * (a.fromDate.localeCompare(b.fromDate) || a.unitKey.localeCompare(b.unitKey)));
  const autoLines = [];
  for (const receipt of activeReceipts) {
    let left = addMinor(receipt.amountMinor, -(pinnedSpent.get(receipt.id) || 0));
    if (left <= 0) continue;
    const completedTargets = orderedOpenUnits().filter(unit => unit.isComplete);
    left = allocatePool(completedTargets, left);
    // Any remainder is a visible advance only on the current running period(s), never a reduction of due today.
    if (left > 0) left = allocatePool(orderedOpenUnits().filter(unit => !unit.isComplete && unit.status !== PERIOD_STATUS.NEEDS_DECISION), left);
    if (left > 0) warnings.push({code: 'receipt-credit', receiptId: receipt.id, amountMinor: left});
  }
  function allocatePool(targets, left) {
    if (left <= 0 || !targets.length) return left;
    if (options.allocationOrder === 'proportional') {
      const pool = sumMinor(targets, unit => remainingCapacity.get(unit.unitKey) || 0);
      const distributable = Math.min(left, pool);
      if (pool > 0 && distributable > 0) {
        const shares = targets.map(unit => {
          const numerator = BigInt(distributable) * BigInt(remainingCapacity.get(unit.unitKey) || 0);
          return {unit, floor: Number(numerator / BigInt(pool)), remainder: numerator % BigInt(pool)};
        });
        let rest = distributable - shares.reduce((sum, share) => sum + share.floor, 0);
        shares.sort((a, b) => a.remainder === b.remainder ? a.unit.fromDate.localeCompare(b.unit.fromDate) : (a.remainder > b.remainder ? -1 : 1));
        for (const share of shares) {
          const extra = rest > 0 ? 1 : 0;
          const amount = share.floor + extra;
          rest -= extra;
          if (amount > 0) applyAuto(share.unit, amount);
        }
        return addMinor(left, -distributable);
      }
      return left;
    }
    for (const unit of targets) {
      if (left <= 0) break;
      const capacity = remainingCapacity.get(unit.unitKey) || 0;
      const take = Math.min(left, capacity);
      if (take <= 0) continue;
      applyAuto(unit, take);
      left = addMinor(left, -take);
    }
    return left;
  }
  function applyAuto(unit, amountMinor) {
    remainingCapacity.set(unit.unitKey, addMinor(remainingCapacity.get(unit.unitKey) || 0, -amountMinor));
    const mode = unit.isComplete ? 'auto' : 'advance';
    paidByUnit.get(unit.unitKey).push({receiptId: null, amountMinor, mode});
    autoLines.push({unitKey: unit.unitKey, amountMinor, mode});
  }

  return {paidByUnit, remainingCapacity, autoLines, pinnedSpent, pinnedRequestedByUnit, warnings, receiptById};
}

/** Build the displayed schedule and totals. Running rows are informational only. */
export function buildExecutionSchedule({
  slices = [], receipts = [], allocations = [], ledger = [], settings = {}, asOf = '', fromDate = '', expenses = null,
  periodThroughDate = '', receiptAsOf = ''
} = {}) {
  const options = settingsWith(settings);
  if (!isCivilDate(asOf)) throw new RangeError('تاريخ الحساب غير صحيح.');
  const unitAsOf = isCivilDate(periodThroughDate) && periodThroughDate < asOf ? periodThroughDate : asOf;
  const receiptCutoff = isCivilDate(receiptAsOf) ? receiptAsOf : asOf;
  const built = buildScheduleUnits({slices, asOf: unitAsOf, fromDate, settings: options});
  const units = built.units;
  const allocation = allocateReceipts({units, receipts, allocations, settings: options, asOf: receiptCutoff});
  const rowsByRange = new Map();
  const dateText = iso => isCivilDate(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : iso;
  const labelOf = (from, to) => `${dateText(from)} – ${dateText(to)}`;
  for (const unit of units) {
    const lines = allocation.paidByUnit.get(unit.unitKey) || [];
    const paidMinor = sumMinor(lines, line => line.amountMinor);
    const dueMinor = unit.isComplete ? unit.dueMinor : 0;
    const rowState = unit.needsDecision ? 'decision' : (unit.isComplete ? 'complete' : 'running');
    const rowKey = `${unit.fromDate}..${unit.toDate}::${rowState}`;
    const isRunning = !unit.isComplete && !unit.needsDecision;
    const status = unit.needsDecision ? PERIOD_STATUS.NEEDS_DECISION
      : isRunning ? PERIOD_STATUS.RUNNING
        : dueMinor <= 0 ? PERIOD_STATUS.NOTHING_DUE
          : paidMinor >= dueMinor ? PERIOD_STATUS.PAID
            : paidMinor > 0 ? PERIOD_STATUS.PARTIAL : PERIOD_STATUS.UNPAID;
    if (!rowsByRange.has(rowKey)) rowsByRange.set(rowKey, {
      fromDate: unit.fromDate, toDate: unit.toDate, label: labelOf(unit.fromDate, unit.toDate),
      dueMinor: 0, paidMinor: 0, advanceMinor: 0, projectedMinor: 0,
      remainingMinor: 0, units: [], lines: [], valueChanges: [], isComplete: true,
      needsDecision: false, dueOn: unit.toDate
    });
    const row = rowsByRange.get(rowKey);
    row.units.push(unit);
    row.isComplete = row.isComplete && unit.isComplete;
    row.needsDecision ||= Boolean(unit.needsDecision);
    row.lines.push(...lines.map(line => ({...line, unitKey: unit.unitKey, periodKey: unit.periodKey,
      entitlementType: unit.entitlementType, fromDate: unit.fromDate, toDate: unit.toDate,
      advance: !unit.isComplete})));
    row.dueMinor = addMinor(row.dueMinor, dueMinor);
    row.projectedMinor = addMinor(row.projectedMinor, unit.isComplete ? unit.dueMinor : unit.projectedMinor || 0);
    if (unit.isComplete) row.paidMinor = addMinor(row.paidMinor, paidMinor);
    else row.advanceMinor = addMinor(row.advanceMinor, paidMinor);
    for (const part of unit.parts || []) if (part.valueChange) row.valueChanges.push({...part.valueChange, entitlementType: unit.entitlementType, fromDate: unit.fromDate});
    row.status = row.needsDecision ? PERIOD_STATUS.NEEDS_DECISION : status;
  }
  const rows = [...rowsByRange.values()].sort((a, b) => a.fromDate.localeCompare(b.fromDate) || a.toDate.localeCompare(b.toDate)).map(row => {
    const duePaid = row.isComplete ? row.paidMinor : 0;
    const remainingMinor = row.isComplete ? Math.max(0, addMinor(row.dueMinor, -duePaid)) : 0;
    const overpaidMinor = Math.max(0, addMinor(
      sumMinor(row.units.filter(unit => unit.isComplete), unit => allocation.pinnedRequestedByUnit.get(unit.unitKey) || 0), -row.dueMinor
    ));
    const status = row.needsDecision ? PERIOD_STATUS.NEEDS_DECISION
      : !row.isComplete ? PERIOD_STATUS.RUNNING
        : row.dueMinor <= 0 ? PERIOD_STATUS.NOTHING_DUE
          : duePaid >= row.dueMinor ? PERIOD_STATUS.PAID
            : duePaid > 0 ? PERIOD_STATUS.PARTIAL : PERIOD_STATUS.UNPAID;
    const equation = row.units.map(unit => {
      const value = fromMinorUnits(unit.isComplete ? unit.dueMinor : unit.projectedMinor || 0, currencyCode(unit.parts?.[0]?.currency || unit.currency, options.defaultCurrency));
      const formatted = Number(value).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
      return `${unit.entitlementType}: 1 فترة كاملة (${dateText(unit.fromDate)} → ${dateText(unit.toDate)}) × ${formatted} = ${formatted} ج.م`;
    }).join(' | ');
    return {
      ...row, overpaidMinor, remainingMinor, status,
      periodNumber: Math.max(0, ...row.units.map(unit => Number(unit.k || 0) + 1)),
      periodKeys: row.units.map(unit => unit.periodKey),
      dueOn: row.toDate,
      projectedRemainingMinor: Math.max(0, addMinor(row.projectedMinor, -row.advanceMinor)),
      trace: {
        equation,
        sources: row.units.flatMap(unit => (unit.parts || []).map(part => ({sliceId: part.sliceId, judgmentId: part.judgmentId,
          from: unit.fromDate, to: unit.toDate, sourceReference: part.sourceReference, itemId: unit.itemId, anchorDate: unit.anchorDate, k: unit.k}))),
        paidFrom: row.lines.map(line => ({receiptId: line.receiptId, amountMinor: line.amountMinor, mode: line.mode, advance: line.advance}))
      }
    };
  });

  const completedRows = rows.filter(row => row.isComplete && !row.needsDecision);
  const runningRows = rows.filter(row => !row.isComplete && !row.needsDecision);
  const dueMinor = sumMinor(completedRows, row => row.dueMinor);
  const allocatedMinor = sumMinor(completedRows, row => row.paidMinor);
  const advanceMinor = sumMinor(runningRows, row => row.advanceMinor);
  const receiptList = [...allocation.receiptById.values()];
  const paidMinor = sumMinor(receiptList, receipt => receipt.amountMinor);
  const creditMinor = Math.max(0, addMinor(paidMinor, -allocatedMinor));
  const unallocatedCreditMinor = Math.max(0, addMinor(creditMinor, -advanceMinor));
  const expenseRows = (ledger || []).filter(entry => !entry.isDeleted
    && !VOIDED_STATUSES.has(String(entry.status || '').toLowerCase()) && isExpenseLedgerRow(entry));
  const expenseMinor = sumMinor(expenseRows, entry => minorFromRow(entry, currencyCode(entry.currency, options.defaultCurrency)));
  const expenseInPoaMinor = sumMinor(expenseRows.filter(entry => entry.includeInPoa), entry => minorFromRow(entry, currencyCode(entry.currency, options.defaultCurrency)));
  const currency = currencyCode(slices.find(slice => slice.currency)?.currency
    || receiptList.find(receipt => receipt.currency)?.currency, options.defaultCurrency);
  const unallocatedReceipts = receiptList.map(receipt => {
    const allocatedForReceipt = pinnedAndAutoFor(receipt.id, allocation);
    return {...receipt, allocatedMinor: allocatedForReceipt, creditMinor: Math.max(0, addMinor(receipt.amountMinor, -allocatedForReceipt))};
  });
  const remainingMinor = Math.max(0, addMinor(dueMinor, -allocatedMinor));
  const equations = [
    `المطلوب حتى ${dateText(unitAsOf)} = ${fromMinorUnits(dueMinor, currency).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})} ${currency}`,
    `المدفوع = ${fromMinorUnits(paidMinor, currency).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})} ${currency}`,
    `المخصّص على الفترات المستحقة = ${fromMinorUnits(allocatedMinor, currency).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})} ${currency}`,
    `المتبقي = max(0, المستحق − المخصّص على المستحق) = ${fromMinorUnits(remainingMinor, currency).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})} ${currency}`,
    advanceMinor > 0 ? `مدفوع مقدمًا على الفترة الجارية = ${fromMinorUnits(advanceMinor, currency).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})} ${currency} — لا يخفض المطلوب حتى اكتمال الفترة` : '',
    unallocatedCreditMinor > 0 ? `رصيد دائن غير مخصّص = ${fromMinorUnits(unallocatedCreditMinor, currency).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})} ${currency}` : '',
    expenseMinor > 0 ? `مصروفات ورسوم (منفصلة عن أصل الدين) = ${fromMinorUnits(expenseMinor, currency).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})} ${currency}` : ''
  ].filter(Boolean);
  return {
    asOf, periodThroughDate: unitAsOf, fromDate, settings: options, engineVersion: options.engineVersion, currency,
    rows, units, decisions: built.decisions, runningRows, truncated: built.truncated,
    receipts: unallocatedReceipts,
    totals: {
      dueMinor, paidMinor, allocatedMinor, advanceMinor, creditMinor, unallocatedCreditMinor,
      remainingMinor, overpaidMinor: sumMinor(rows, row => row.overpaidMinor),
      expenseMinor, expenseInPoaMinor, periodCount: completedRows.filter(row => row.dueMinor > 0).length,
      paidPeriods: completedRows.filter(row => row.status === PERIOD_STATUS.PAID).length,
      partialPeriods: completedRows.filter(row => row.status === PERIOD_STATUS.PARTIAL).length,
      unpaidPeriods: completedRows.filter(row => row.status === PERIOD_STATUS.UNPAID).length,
      runningPeriods: runningRows.length, decisionPeriods: rows.filter(row => row.needsDecision).length
    },
    warnings: [...allocation.warnings, ...built.decisions.map(row => ({code: 'period-decision-required', ...row}))],
    equations
  };
}

function pinnedAndAutoFor(receiptId, allocation) {
  let total = 0;
  for (const lines of allocation.paidByUnit.values()) for (const line of lines) if (line.receiptId === receiptId) total = addMinor(total, line.amountMinor);
  return total;
}

/** «احسب مدة»: count only whole completed periods enclosed by the range. */
export function claimForRange({slices = [], receipts = [], allocations = [], settings = {}, schedule: suppliedSchedule = null, fromDate, toDate, asOf = '', rangeDecisions = []} = {}) {
  const options = settingsWith(settings);
  if (!isCivilDate(fromDate) || !isCivilDate(toDate) || toDate < fromDate) throw new RangeError('نطاق المدة غير صحيح.');
  const horizon = isCivilDate(asOf) ? asOf : toDate;
  const full = suppliedSchedule || buildExecutionSchedule({slices, receipts, allocations, settings: options, asOf: horizon});
  const allUnits = full.rows.flatMap(row => (row.units || []).map(unit => ({
    unit, row, lines: row.lines.filter(line => line.unitKey === unit.unitKey)
  })));
  const complete = [], partials = [], decisionRows = [], notYetComplete = [], boundaryCandidates = [];
  const seenCandidates = new Set();
  const hasSuppliedDecision = unit => (rangeDecisions || []).some(decision => decision?.periodKey === unit.periodKey && decision?.choice
    && (!decision.range || (decision.range.fromDate === fromDate && decision.range.toDate === toDate)));
  for (const entry of allUnits) {
    const {unit, row, lines} = entry;
    if (unit.toDate < fromDate || unit.fromDate > toDate) continue;
    // المطالبة تطالب بما انقضى فعلاً: الفترة التي لم تنتهِ بعد تُعرض بمبلغها
    // المتوقع ولا تُطالب به افتراضيًا — إلا بقرار صريح من المكتب يدرجها كاملة.
    // هذا يفصل «المطلوب حتى اليوم» (يتبع توقيت الاستحقاق) عن «مطالبة مدة».
    if (unit.toDate > horizon && !hasSuppliedDecision(unit)) {
      notYetComplete.push({periodKey: unit.periodKey, fromDate: unit.fromDate, toDate: unit.toDate,
        projectedMinor: unit.dueMinor || unit.projectedMinor || 0, paidMinor: sumMinor(lines, line => line.amountMinor),
        label: `${dateLabel(unit.fromDate)} – ${dateLabel(unit.toDate)}`, status: PERIOD_STATUS.RUNNING});
      continue;
    }
    const enclosed = unit.fromDate >= fromDate && unit.toDate <= toDate;
    const values = {
      dueMinor: unit.isComplete && !unit.needsDecision ? unit.dueMinor : 0,
      paidMinor: unit.isComplete && !unit.needsDecision ? sumMinor(lines, line => line.amountMinor) : 0
    };
    values.remainingMinor = Math.max(0, values.dueMinor - values.paidMinor);
    if (unit.needsDecision) {
      decisionRows.push({periodKey: unit.periodKey, fromDate: unit.fromDate, toDate: unit.toDate, reason: unit.decisionReason || 'الفترة تحتاج قرارًا بشأن القيمة'});
      continue;
    }
    if (!unit.isComplete) {
      // فترة جارية: لا تدخل في المستحق، لكنها تُعرض دائمًا بمبلغها المتوقع —
      // لا نافذة «احسب مدة» فارغة ولا رقم يختفي بلا سبب مفهوم.
      notYetComplete.push({periodKey: unit.periodKey, fromDate: unit.fromDate, toDate: unit.toDate,
        projectedMinor: unit.projectedMinor || 0, paidMinor: sumMinor(lines, line => line.amountMinor),
        label: `${dateLabel(unit.fromDate)} – ${dateLabel(unit.toDate)}`, status: PERIOD_STATUS.RUNNING});
      continue;
    }
    if (enclosed) {
      complete.push({...unit, ...values, row});
      continue;
    }
    const startsBefore = unit.fromDate < fromDate;
    const endsAfter = unit.toDate > toDate;
    const kind = startsBefore && endsAfter ? 'RANGE_BOUNDARY' : startsBefore ? 'RANGE_START' : 'RANGE_END';
    const candidateId = `${unit.periodKey}|${kind}`;
    if (seenCandidates.has(candidateId)) continue;
    seenCandidates.add(candidateId);
    const supplied = rangeDecisions.find(decision => decision?.periodKey === unit.periodKey
      && (decision.kind === kind || decision.kind === 'RANGE_BOUNDARY')
      && (!decision.range || (decision.range.fromDate === fromDate && decision.range.toDate === toDate))) || null;
    const allowed = new Set(['INCLUDE_FULL', 'EXCLUDE', 'MANUAL']);
    const choice = allowed.has(supplied?.choice) ? supplied.choice : '';
    const reason = String(supplied?.reason || '').trim();
    const amountMinor = supplied?.amountMinor;
    const needsReason = Boolean(choice && !reason);
    const needsAmount = choice === 'MANUAL' && (!Number.isSafeInteger(amountMinor) || amountMinor < 0);
    const candidate = {periodKey: unit.periodKey, itemId: unit.itemId, anchorDate: unit.anchorDate, k: unit.k,
      fromDate: unit.fromDate, toDate: unit.toDate, kind, options: [...allowed], dueMinor: values.dueMinor,
      paidMinor: values.paidMinor, choice, reason, amountMinor: Number.isSafeInteger(amountMinor) ? amountMinor : null,
      needsReason, needsAmount, decidedAt: supplied?.decidedAt || '', decidedBy: supplied?.decidedBy || ''};
    boundaryCandidates.push(candidate);
    if (!choice || needsReason || needsAmount) {
      partials.push(candidate);
      continue;
    }
    if (choice === 'EXCLUDE') continue;
    const selectedDue = choice === 'MANUAL' ? amountMinor : values.dueMinor;
    const selectedPaid = Math.min(values.paidMinor, selectedDue);
    const selectedRemaining = Math.max(0, selectedDue - selectedPaid);
    complete.push({...unit, ...values, dueMinor: selectedDue, paidMinor: selectedPaid, remainingMinor: selectedRemaining,
      row, rangeDecision: {...candidate, choice, reason}});
  }
  const includedRows = complete.map(unit => ({
    periodKey: unit.periodKey, fromDate: unit.fromDate, toDate: unit.toDate,
    label: `${dateLabel(unit.fromDate)} – ${dateLabel(unit.toDate)}`,
    dueMinor: unit.dueMinor, paidMinor: unit.paidMinor, remainingMinor: unit.remainingMinor,
    projectedMinor: unit.dueMinor, advanceMinor: 0, isComplete: true, needsDecision: false,
    status: unit.dueMinor <= 0 ? PERIOD_STATUS.NOTHING_DUE : unit.paidMinor >= unit.dueMinor ? PERIOD_STATUS.PAID : unit.paidMinor > 0 ? PERIOD_STATUS.PARTIAL : PERIOD_STATUS.UNPAID,
    units: [unit], rangeDecision: unit.rangeDecision || null
  })).sort((a, b) => a.fromDate.localeCompare(b.fromDate) || a.periodKey.localeCompare(b.periodKey));
  const dueMinor = sumMinor(includedRows, row => row.dueMinor);
  const paidMinor = sumMinor(includedRows, row => row.paidMinor);
  const remainingMinor = Math.max(0, dueMinor - paidMinor);
  const beforeMinor = sumMinor(allUnits.filter(({unit}) => unit.isComplete && !unit.needsDecision && unit.toDate < fromDate),
    ({unit, lines}) => Math.max(0, unit.dueMinor - sumMinor(lines, line => line.amountMinor)));
  const sideBySideScenarios = boundaryCandidates.flatMap(candidate => ['INCLUDE_FULL', 'EXCLUDE', 'MANUAL'].map(choice => {
    const amount = choice === 'INCLUDE_FULL' ? candidate.dueMinor
      : choice === 'EXCLUDE' ? 0
        : (candidate.choice === 'MANUAL' && Number.isSafeInteger(candidate.amountMinor) ? candidate.amountMinor : null);
    const paid = amount === null ? null : Math.min(candidate.paidMinor, amount);
    return {periodKey: candidate.periodKey, kind: candidate.kind, choice, amountMinor: amount,
      paidMinor: paid, remainingMinor: amount === null ? null : Math.max(0, amount - paid),
      equation: amount === null ? 'يلزم إدخال مبلغ كامل صراحةً؛ لا يُحسب بنسبة الأيام.'
        : `قيمة الفترة المختارة كاملة ${amount} − المدفوع ${paid} = المتبقي ${Math.max(0, amount - paid)} وحدة صغرى`};
  }));
  const decisions = boundaryCandidates.filter(candidate => candidate.choice && !candidate.needsReason && !candidate.needsAmount)
    .map(candidate => ({...candidate, trace: `قرار ${candidate.choice} للفترة ${candidate.fromDate} → ${candidate.toDate}: ${candidate.reason}`}));
  const runningProjectedMinor = sumMinor(notYetComplete, row => row.projectedMinor || 0);
  const fmt = value => fromMinorUnits(value, full.currency).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  const equations = [
    `${includedRows.length} فترات مكتملة/محسومة داخل المدة = ${fmt(dueMinor)} ${full.currency}`,
    `المدفوع على الفترات المختارة = ${fmt(paidMinor)} ${full.currency}`,
    `المتبقي عن المدة = max(0, ${fmt(dueMinor)} − ${fmt(paidMinor)}) = ${fmt(remainingMinor)} ${full.currency}`,
    decisions.length ? `قرارات حدود المدة المسجلة: ${decisions.map(row => `${row.trace} — ${row.decidedBy || 'فاعل غير محدد'} — ${row.decidedAt || 'تاريخ غير محدد'}`).join('؛ ')}` : '',
    partials.length ? `حدود فترة ناقصة تنتظر قرارًا صريحًا: ${partials.map(row => `${row.fromDate} → ${row.toDate}`).join('؛ ')}` : 'لا توجد حدود ناقصة بلا قرار',
    decisionRows.length ? `فترات تحتاج قرار قيمة منفصلًا: ${decisionRows.map(row => `${row.fromDate} → ${row.toDate}`).join('؛ ')}` : '',
    notYetComplete.length ? `فترات جارية معلوماتية وليست مستحقة بعد (قيمتها المتوقعة ${fmt(runningProjectedMinor)} ${full.currency}): ${notYetComplete.map(row => `${row.fromDate} → ${row.toDate} = ${fmt(row.projectedMinor)}`).join('؛ ')}` : '',
    beforeMinor ? `رصيد سابق غير مسدد قبل المدة = ${fmt(beforeMinor)} ${full.currency}` : 'لا يوجد رصيد سابق غير مسدد قبل المدة',
    `الإجمالي المطلوب = ${fmt(remainingMinor + beforeMinor)} ${full.currency}`
  ].filter(Boolean);
  return {
    fromDate, toDate, rows: includedRows, complete: includedRows,
    partialAtStart: partials.find(row => row.kind === 'RANGE_START' || row.kind === 'RANGE_BOUNDARY') || null,
    partialAtEnd: partials.find(row => row.kind === 'RANGE_END' || row.kind === 'RANGE_BOUNDARY') || null,
    partials, decisionRows, notYetComplete, decisions, sideBySideScenarios,
    totals: {dueMinor, paidMinor, remainingMinor, beforeMinor, runningProjectedMinor,
      totalRequiredMinor: dueMinor ? remainingMinor + beforeMinor : beforeMinor, currency: full.currency},
    equations, asOf: horizon, settings: options
  };
}

function dateLabel(iso) { return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`; }
function makeChangeSummary(before, after, currency) {
  const beforeRows = new Map(before.rows.flatMap(row => row.units.map(unit => [unit.unitKey, {row, unit}])));
  const afterRows = new Map(after.rows.flatMap(row => row.units.map(unit => [unit.unitKey, {row, unit}])));
  const keys = [...new Set([...beforeRows.keys(), ...afterRows.keys()])].sort();
  const rows = keys.map(key => {
    const old = beforeRows.get(key), next = afterRows.get(key);
    const oldMinor = old?.unit.isComplete ? old.unit.dueMinor : 0;
    const newMinor = next?.unit.isComplete ? next.unit.dueMinor : 0;
    const differenceMinor = addMinor(newMinor, -oldMinor);
    const unit = next?.unit || old?.unit;
    return {
      periodKey: key, k: unit?.k, fromDate: unit?.fromDate || '', toDate: unit?.toDate || '',
      label: unit ? `${dateLabel(unit.fromDate)} – ${dateLabel(unit.toDate)}` : '',
      oldMinor, newMinor, differenceMinor,
      oldValue: fromMinorUnits(oldMinor, currency), newValue: fromMinorUnits(newMinor, currency),
      difference: fromMinorUnits(differenceMinor, currency),
      oldPaidMinor: old?.row?.paidMinor || 0, newPaidMinor: next?.row?.paidMinor || 0,
      creditBecauseOverpaidMinor: Math.max(0, addMinor((old?.row?.paidMinor || 0), -newMinor))
    };
  }).filter(row => row.differenceMinor !== 0 || row.oldMinor !== row.newMinor);
  return {rows, oldDueMinor: before.totals.dueMinor, newDueMinor: after.totals.dueMinor,
    differenceMinor: addMinor(after.totals.dueMinor, -before.totals.dueMinor), creditMinor: after.totals.creditMinor,
    remainingMinor: after.totals.remainingMinor};
}

/** Preview a subsequent judgment, including side-by-side choices for an incomplete boundary. */
export function previewValueChange({slices = [], receipts = [], allocations = [], settings = {}, asOf = '', periodThroughDate = '', candidate, previousSliceId = '', manualAmountMinor = null, manualPeriodAmountMinor = null, manualEndAmountMinor = null} = {}) {
  if (!candidate?.startDate || !isCivilDate(candidate.startDate)) throw new RangeError('تاريخ سريان الحكم اللاحق مطلوب.');
  if (!(minorFromRow(candidate) > 0)) throw new RangeError('القيمة الجديدة يجب أن تكون أكبر من صفر.');
  const options = settingsWith(settings);
  const before = buildExecutionSchedule({slices, receipts, allocations, settings: options, asOf, periodThroughDate});
  const prior = (slices || []).filter(slice => String(slice.entitlementType || '') === String(candidate.entitlementType || '')
    && (!candidate.startDate || !slice.startDate || slice.startDate <= candidate.startDate))
    .sort((a, b) => String(a.startDate || '').localeCompare(String(b.startDate || ''))).at(-1);
  const itemId = String(candidate.itemId || candidate.obligationId || prior?.itemId || `legacy:${candidate.entitlementType || 'بند'}`);
  const candidateSlice = {
    ...candidate, id: candidate.id || '__candidate__', itemId,
    entitlementType: candidate.entitlementType, valueType: candidate.valueType || 'periodic',
    amountMinor: minorFromRow(candidate, before.currency), amount: candidate.amount,
    startDate: candidate.startDate, endDate: candidate.endDate || '',
    periodicity: candidate.periodicity || 'monthly', judgmentId: candidate.judgmentId || '',
    judgmentKind: candidate.judgmentKind || 'later', status: 'active'
  };
  if (Number.isSafeInteger(manualAmountMinor)) candidateSlice.manualPeriodAmountMinor = manualAmountMinor;
  const withoutPrevious = previousSliceId ? slices.filter(slice => slice.id !== previousSliceId) : slices;
  const evaluate = (midPeriodChoice = '', endPeriodChoice = '', manualMinor = null) => {
    const nextCandidate = {...candidateSlice};
    if (midPeriodChoice) nextCandidate.midPeriodChoice = midPeriodChoice;
    if (endPeriodChoice) nextCandidate.endPeriodChoice = endPeriodChoice;
    if (Number.isSafeInteger(manualMinor)) {
      nextCandidate.manualPeriodAmountMinor = manualMinor;
      nextCandidate.manualEndAmountMinor = manualMinor;
    }
    return buildExecutionSchedule({slices: [...withoutPrevious, nextCandidate], receipts, allocations, settings: options, asOf, periodThroughDate});
  };
  const defaultAfter = evaluate();
  const nextGroups = valueTimeline([...withoutPrevious, candidateSlice]);
  const group = nextGroups.find(row => row.entitlementType === candidateSlice.entitlementType && row.itemId === itemId);
  const anchor = group?.anchorDate || candidate.startDate;
  const normalizedGroup = group || {anchorDate: anchor, periodicity: candidate.periodicity || 'monthly', customDays: candidate.customDays || null};
  const k = periodIndexFor(normalizedGroup, candidate.startDate, options);
  const affected = periodForIndex(normalizedGroup, k, options);
  const affectedFrom = affected.from;
  const affectedTo = affected.to;
  const midPeriod = candidate.startDate !== affectedFrom;
  const endK = candidate.endDate && isCivilDate(candidate.endDate) ? periodIndexFor(normalizedGroup, candidate.endDate, options) : -1;
  const endPeriod = endK >= 0 ? periodForIndex(normalizedGroup, endK, options) : null;
  const endPeriodFrom = endPeriod?.from || '';
  const endPeriodTo = endPeriod?.to || '';
  const midEnd = Boolean(candidate.endDate && candidate.endDate >= endPeriodFrom && candidate.endDate < endPeriodTo);
  const midManualMinor = Number.isSafeInteger(manualPeriodAmountMinor) ? manualPeriodAmountMinor
    : Number.isSafeInteger(manualAmountMinor) ? manualAmountMinor : null;
  const endManualMinor = Number.isSafeInteger(manualEndAmountMinor) ? manualEndAmountMinor
    : Number.isSafeInteger(manualAmountMinor) ? manualAmountMinor : null;
  const scenarios = {};
  if (midPeriod) {
    for (const choice of ['KEEP_OLD_VALUE', 'USE_NEW_VALUE']) {
      const computed = evaluate(choice);
      scenarios[choice] = makeChangeSummary(before, computed, computed.currency);
    }
    scenarios.MANUAL = makeChangeSummary(before, evaluate('MANUAL', '', midManualMinor), before.currency);
  }
  if (midEnd) {
    for (const choice of ['INCLUDE_FULL', 'EXCLUDE']) {
      const computed = evaluate('', choice);
      scenarios[choice] = makeChangeSummary(before, computed, computed.currency);
    }
    scenarios.END_MANUAL = makeChangeSummary(before, evaluate('', 'MANUAL', endManualMinor), before.currency);
  }
  const summary = makeChangeSummary(before, defaultAfter, defaultAfter.currency);
  return {
    ...summary, currency: defaultAfter.currency, asOf,
    oldDueMinor: before.totals.dueMinor, newDueMinor: defaultAfter.totals.dueMinor,
    differenceMinor: addMinor(defaultAfter.totals.dueMinor, -before.totals.dueMinor),
    totals: {
      oldDueMinor: before.totals.dueMinor, newDueMinor: defaultAfter.totals.dueMinor,
      differenceMinor: addMinor(defaultAfter.totals.dueMinor, -before.totals.dueMinor),
      oldRemainingMinor: before.totals.remainingMinor, newRemainingMinor: defaultAfter.totals.remainingMinor,
      creditMinor: defaultAfter.totals.creditMinor
    },
    midPeriod: midPeriod ? {periodKey: periodUnitKey(normalizedGroup, k), itemId, anchorDate: normalizedGroup.anchorDate, k,
      fromDate: affectedFrom, toDate: affectedTo, effectiveFrom: candidate.startDate} : null,
    midEndPeriod: midEnd ? {periodKey: periodUnitKey(normalizedGroup, endK), itemId, anchorDate: normalizedGroup.anchorDate, k: endK,
      fromDate: endPeriodFrom, toDate: endPeriodTo, effectiveTo: candidate.endDate} : null,
    scenarios, manualPeriodAmountMinor: midManualMinor, manualEndAmountMinor: endManualMinor,
    equations: [
      `قبل: ${fromMinorUnits(before.totals.dueMinor, before.currency)} — بعد القرار المسجل: ${fromMinorUnits(defaultAfter.totals.dueMinor, defaultAfter.currency)}`,
      midPeriod ? `تاريخ السريان ${dateLabel(candidate.startDate)} يقع داخل الفترة ${dateLabel(affectedFrom)} → ${dateLabel(affectedTo)}؛ اعرض البدائل ولا تحتسبها صامتًا.` : '',
      midEnd ? `تاريخ النهاية ${dateLabel(candidate.endDate)} يقع داخل الفترة ${dateLabel(endPeriodFrom)} → ${dateLabel(endPeriodTo)}؛ اعرض البدائل ولا تحتسبها صامتًا.` : '',
      `الفترات الكاملة × قيمتها الكاملة — لا تناسب بالأيام.`
    ].filter(Boolean)
  };
}

/** رصيد سابق + فترة جديدة + مصروفات مختارة = إجمالي التوكيل (بلا ازدواج). */
export function buildPoaFigures({schedule, fromDate, toDate, includePreviousBalance = true, expenses = [], expenseIds = [], rangeDecisions = [], feesMinor = 0, stampsMinor = 0, previousAction = null, previousOverrideMinor = null} = {}) {
  if (!schedule) throw new TypeError('جدول التنفيذ مطلوب لحساب التوكيل.');
  if (!isCivilDate(fromDate) || !isCivilDate(toDate) || toDate < fromDate) throw new RangeError('مدة التوكيل غير صحيحة.');
  let previousMinor = 0, periodDueMinor = 0, periodPaidMinor = 0, periodClaimMinor = 0, differencesMinor = 0;
  const lines = [], partials = [], decisionsUsed = [], runningPeriods = [];
  const units = schedule.rows.flatMap(row => (row.units || []).length ? row.units.map(unit => {
    const linesForUnit = (row.lines || []).filter(line => line.unitKey === unit.unitKey);
    const dueMinor = Number.isSafeInteger(unit.dueMinor) ? unit.dueMinor : 0;
    const paidMinor = sumMinor(linesForUnit, line => line.amountMinor);
    return {...unit, dueMinor, paidMinor, remainingMinor: Math.max(0, dueMinor - paidMinor),
      label: monthLabel(unit.fromDate, unit.toDate),
      valueChanges: (unit.parts || []).map(part => part.valueChange).filter(Boolean)};
  }) : [row]);
  const claimThrough = isCivilDate(schedule.asOf) ? schedule.asOf : toDate;
  const poaDecisionFor = key => (rangeDecisions || []).some(decision => decision?.periodKey === key && decision?.choice
    && (!decision.range || (decision.range.fromDate === fromDate && decision.range.toDate === toDate)));
  for (const row of units) {
    if (row.needsDecision) continue;
    // فترة جارية: معلومة ظاهرة بمبلغها المتوقع، ولا تُضاف إلى إجمالي التوكيل
    // لأنها لم تُستحق بعد. ظهورها يمنع «توكيل بلا أي سطر» عند تنفيذ جديد.
    if (!row.isComplete || (row.toDate > claimThrough && !poaDecisionFor(row.periodKey))) {
      if (row.fromDate > toDate || row.toDate < fromDate) continue;
      runningPeriods.push({periodKey: row.periodKey || '', fromDate: row.fromDate, toDate: row.toDate,
        label: row.label || monthLabel(row.fromDate, row.toDate), projectedMinor: Number.isSafeInteger(row.projectedMinor) ? row.projectedMinor : 0,
        paidMinor: 0, note: 'فترة جارية لم تكتمل — لا تدخل في إجمالي التوكيل'});
      continue;
    }
    if (row.toDate < fromDate) {
      previousMinor = addMinor(previousMinor, Math.max(0, row.remainingMinor));
      continue;
    }
    if (row.fromDate > toDate || row.toDate < fromDate) continue;
    const enclosed = row.fromDate >= fromDate && row.toDate <= toDate;
    let dueMinor = row.dueMinor, paidMinor = row.paidMinor, rangeDecision = null;
    if (!enclosed) {
      const startsBefore = row.fromDate < fromDate;
      const endsAfter = row.toDate > toDate;
      const kind = startsBefore && endsAfter ? 'RANGE_BOUNDARY' : startsBefore ? 'RANGE_START' : 'RANGE_END';
      const decision = rangeDecisions.find(item => item?.periodKey === row.periodKey
        && (item.kind === kind || item.kind === 'RANGE_BOUNDARY')
        && (!item.range || (item.range.fromDate === fromDate && item.range.toDate === toDate))) || null;
      const valid = decision && ['INCLUDE_FULL', 'EXCLUDE', 'MANUAL'].includes(decision.choice) && String(decision.reason || '').trim()
        && (decision.choice !== 'MANUAL' || (Number.isSafeInteger(decision.amountMinor) && decision.amountMinor >= 0));
      if (!valid) {
        partials.push({periodKey: row.periodKey, itemId: row.itemId || '', anchorDate: row.anchorDate || '', k: row.k,
          fromDate: row.fromDate, toDate: row.toDate, kind, dueMinor: row.dueMinor, paidMinor: row.paidMinor,
          choice: decision?.choice || '', reason: decision?.reason || '', amountMinor: decision?.amountMinor ?? null,
          options: ['INCLUDE_FULL', 'EXCLUDE', 'MANUAL']});
        continue;
      }
      rangeDecision = {...decision, kind, trace: `قرار ${decision.choice} للفترة ${row.fromDate} → ${row.toDate}: ${decision.reason}`};
      decisionsUsed.push(rangeDecision);
      if (decision.choice === 'EXCLUDE') continue;
      if (decision.choice === 'MANUAL') dueMinor = decision.amountMinor;
      paidMinor = Math.min(paidMinor, dueMinor);
    }
    periodDueMinor = addMinor(periodDueMinor, dueMinor);
    periodPaidMinor = addMinor(periodPaidMinor, paidMinor);
    for (const change of row.valueChanges || []) differencesMinor = addMinor(differencesMinor, Math.abs(change.differenceMinor || 0));
    // المطالبة داخل المدة = المستحق − ما حُصّل فعلًا فيها. كان التوكيل يطالب
    // بالمستحق الكامل فيتجاهل محاضر التحصيل المسجلة داخل نفس المدة (ازدواج مطالبة).
    const claimMinor = Math.max(0, addMinor(dueMinor, -paidMinor));
    periodClaimMinor = addMinor(periodClaimMinor, claimMinor);
    lines.push({
      kind: 'period', periodKey: row.periodKey || '', fromDate: row.fromDate, toDate: row.toDate, label: row.label || monthLabel(row.fromDate, row.toDate),
      amountMinor: claimMinor, dueMinor, paidMinor, claimMinor, remainingMinor: claimMinor,
      note: rangeDecision ? `${rangeDecision.trace} — لا تناسب بالأيام` : (paidMinor ? `محصّل داخل المدة ${fromMinorUnits(paidMinor, schedule.currency)} — لا يُطالب به مرة ثانية` : (dueMinor ? '' : 'لا استحقاق')),
      equation: paidMinor
        ? `${row.label || monthLabel(row.fromDate, row.toDate)}: مستحق ${fromMinorUnits(dueMinor, schedule.currency)} − محصّل ${fromMinorUnits(paidMinor, schedule.currency)} = مطلوب ${fromMinorUnits(claimMinor, schedule.currency)}`
        : `${row.label || monthLabel(row.fromDate, row.toDate)}: ${fromMinorUnits(dueMinor, schedule.currency)}`,
      rangeDecision: rangeDecision || null
    });
  }
  const expenseLines = (expenses || []).filter(expense => !expenseIds || expenseIds.includes(expense.id))
    .map(expense => ({
      kind: 'expense', id: expense.id, label: expense.label || expense.type, fromDate: expense.date, toDate: expense.date,
      amountMinor: expense.amountMinor, remainingMinor: expense.amountMinor,
      note: expense.borneByLabel ? `يتحمله: ${expense.borneByLabel}` : '',
      equation: `${expense.label || expense.type}: ${fromMinorUnits(expense.amountMinor, schedule.currency)}`
    }));
  const expensesMinor = sumMinor(expenseLines, line => line.amountMinor);
  const fees = Number.isSafeInteger(feesMinor) ? feesMinor : 0;
  const stamps = Number.isSafeInteger(stampsMinor) ? stampsMinor : 0;
  const feesLine = fees ? {kind: 'fee', label: 'رسوم (إدخال يدوي)', fromDate: '', toDate: '', amountMinor: fees, remainingMinor: fees, note: 'النظام لا يفترض رسومًا ولا دمغة — أدخلها أنت حسب واقع الملف.', equation: `رسوم = ${fromMinorUnits(fees, schedule.currency)}`} : null;
  const stampsLine = stamps ? {kind: 'stamp', label: 'دمغة (إدخال يدوي)', fromDate: '', toDate: '', amountMinor: stamps, remainingMinor: stamps, note: 'النظام لا يفترض رسومًا ولا دمغة — أدخلها أنت حسب واقع الملف.', equation: `دمغة = ${fromMinorUnits(stamps, schedule.currency)}`} : null;
  // «تعديل المبلغ» في اقتراح الرصيد السابق: مبلغ صريح يدخل مكان المحسوب،
  // ويُذكر الفرق في الملاحظة حتى لا يبدو رقمًا مُقدَّرًا صامتًا.
  const override = Number.isSafeInteger(previousOverrideMinor) && previousOverrideMinor >= 0 ? previousOverrideMinor : null;
  const previousApplied = includePreviousBalance ? (override === null ? previousMinor : override) : 0;
  const previousOverridden = includePreviousBalance && override !== null && override !== previousMinor;
  // الإجمالي = الرصيد السابق + ما هو مطلوب فعلًا داخل المدة + مصروفات + رسوم + دمغة.
  const totalMinor = addMinor(addMinor(addMinor(addMinor(previousApplied, periodClaimMinor), expensesMinor), fees), stamps);
  // معادلات لكل سطر فترة: متساوية ⇒ 9 × 3,000 = 27,000 · مختلفة ⇒ 3 × 3,000 + 6 × 3,500 = 30,000 · جزئية ⇒ قسمة يومية واضحة
  // نضيف equation لكل سطر فترة بناءً على تجميع القيم
  const periodEquations = (() => {
    if (!lines.length) return [];
    // إذا كل الفترات بنفس المبلغ
    const amounts = lines.map(l => l.amountMinor);
    const unique = [...new Set(amounts)];
    if (unique.length === 1) {
      const amt = unique[0];
      const formatted = fromMinorUnits(amt, schedule.currency).toLocaleString('en-US', {minimumFractionDigits: 2});
      return [`${lines.length} × ${formatted} = ${fromMinorUnits(periodDueMinor, schedule.currency)}`];
    }
    // مختلفة
    const groups = new Map();
    for (const l of lines) {
      const key = l.amountMinor;
      groups.set(key, (groups.get(key) || 0) + 1);
    }
    const parts = [...groups.entries()].map(([amt, count]) => `${count} × ${fromMinorUnits(amt, schedule.currency).toLocaleString('en-US', {minimumFractionDigits: 2})}`).join(' + ');
    return [`${parts} = ${fromMinorUnits(periodDueMinor, schedule.currency)}`];
  })();

  const previousNote = (() => {
    const overrideNote = previousOverridden
      ? `المبلغ المحسوب ${fromMinorUnits(previousMinor, schedule.currency)} عُدِّل صراحةً إلى ${fromMinorUnits(previousApplied, schedule.currency)} — `
      : '';
    if (!previousAction) return `${overrideNote}جزء من المتبقي — لا يُضاف عليه مرة ثانية`;
    const num = previousAction.referenceNumber || previousAction.id || '';
    const date = previousAction.date || '';
    return `${overrideNote}مرتبط بمحضر ${previousAction.kindLabel || previousAction.kind || 'تبديد'}${num ? ` رقم ${num}` : ''}${date ? ` بتاريخ ${date}` : ''} — جزء من المتبقي ولا يُضاف عليه مرة ثانية`;
  })();

  return {
    fromDate, toDate, currency: schedule.currency,
    previousBalanceMinor: previousMinor, previousAppliedMinor: previousApplied,
    previousOverrideMinor: override, previousOverridden: previousOverridden,
    periodDueMinor, periodPaidMinor, periodClaimMinor, periodRemainingMinor: Math.max(0, addMinor(periodDueMinor, -periodPaidMinor)),
    differencesMinor, expensesMinor, feesMinor: fees, stampsMinor: stamps, totalMinor, partials, rangeDecisions: decisionsUsed, runningPeriods,
    previousAction, previousNote,
    lines: [
      ...(previousApplied ? [{kind: 'previous', label: `رصيد سابق غير مسدد حتى ${addCivilDays(fromDate, -1)}`, fromDate: '', toDate: '', amountMinor: previousApplied, remainingMinor: previousApplied, note: previousNote, equation: `رصيد سابق = ${fromMinorUnits(previousApplied, schedule.currency)}${previousAction ? ` — مرتبط بمحضر ${previousAction.kindLabel || previousAction.kind}` : ''}`}] : []),
      ...lines.map(l => ({...l, equation: l.equation || `${l.label}: ${fromMinorUnits(l.amountMinor, schedule.currency)}`})),
      ...expenseLines,
      ...(feesLine ? [feesLine] : []),
      ...(stampsLine ? [stampsLine] : [])
    ],
    equations: [
      ...(previousApplied ? [`رصيد سابق = ${fromMinorUnits(previousApplied, schedule.currency)}${previousAction ? ` — مرتبط بمحضر ${previousAction.kindLabel || previousAction.kind} رقم ${previousAction.referenceNumber || ''} بتاريخ ${previousAction.date || ''}` : ' — لا يوجد محضر تبديد/حجز مرتبط'}`] : []),
      ...(periodEquations.length ? [`الفترة الجديدة: ${periodEquations[0]}`] : [`فترة التوكيل (${monthLabel(fromDate, toDate)}) = ${fromMinorUnits(periodDueMinor, schedule.currency)}`]),
      ...(periodPaidMinor ? [`المحصّل داخل المدة = ${fromMinorUnits(periodPaidMinor, schedule.currency)} — يُخصم من المطالبة: ${fromMinorUnits(periodDueMinor, schedule.currency)} − ${fromMinorUnits(periodPaidMinor, schedule.currency)} = ${fromMinorUnits(periodClaimMinor, schedule.currency)}`] : []),
      ...lines.map(l => l.equation || `${l.label} = ${fromMinorUnits(l.amountMinor, schedule.currency)}`),
      ...decisionsUsed.map(row => row.trace),
      partials.length ? `فترات حدّية تنتظر قرارًا صريحًا: ${partials.map(row => `${row.fromDate} → ${row.toDate}`).join('؛ ')}` : '',
      runningPeriods.length ? `فترات جارية ظاهرة بمبلغها المتوقع ولا تدخل في الإجمالي: ${runningPeriods.map(row => `${row.fromDate} → ${row.toDate} = ${fromMinorUnits(row.projectedMinor || 0, schedule.currency)}`).join('؛ ')}` : '',
      ...(expensesMinor ? [`مصروفات مختارة = ${fromMinorUnits(expensesMinor, schedule.currency)}`] : []),
      ...(fees ? [`رسوم (يدوي) = ${fromMinorUnits(fees, schedule.currency)} — النظام لا يفترض رسومًا ولا دمغة`] : []),
      ...(stamps ? [`دمغة (يدوي) = ${fromMinorUnits(stamps, schedule.currency)} — النظام لا يفترض رسومًا ولا دمغة`] : []),
      `إجمالي التوكيل = ${fromMinorUnits(totalMinor, schedule.currency)} = ${fromMinorUnits(previousApplied, schedule.currency)} (رصيد سابق) + ${fromMinorUnits(periodClaimMinor, schedule.currency)} (مطلوب المدة) + ${fromMinorUnits(expensesMinor, schedule.currency)} (مصروفات) + ${fromMinorUnits(fees, schedule.currency)} (رسوم) + ${fromMinorUnits(stamps, schedule.currency)} (دمغة)`,
      differencesMinor ? `منها فروق أحكام ${fromMinorUnits(differencesMinor, schedule.currency)} مضمّنة داخل الفترة — لا تُضاف مرة ثانية` : ''
    ].filter(Boolean),
    equation: [
      previousApplied ? `رصيد سابق ${fromMinorUnits(previousApplied, schedule.currency)}` : '',
      periodClaimMinor ? `مطلوب المدة ${fromMinorUnits(periodClaimMinor, schedule.currency)}` : '',
      expensesMinor ? `مصروفات ${fromMinorUnits(expensesMinor, schedule.currency)}` : '',
      fees ? `رسوم ${fromMinorUnits(fees, schedule.currency)}` : '',
      stamps ? `دمغة ${fromMinorUnits(stamps, schedule.currency)}` : ''
    ].filter(Boolean).join(' + ') + ` = ${fromMinorUnits(totalMinor, schedule.currency)}`,
    periodEquations
  };
}

export function monthLabel(fromDate, toDate = '') {
  if (!isCivilDate(fromDate)) return '';
  const display = iso => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
  return isCivilDate(toDate) && toDate !== fromDate ? `${display(fromDate)} – ${display(toDate)}` : display(fromDate);
}

export function emptySchedule(asOf = '', currency = 'EGP') {
  return {
    asOf, fromDate: '', settings: settingsWith({}), currency, rows: [], units: [], receipts: [], truncated: false, warnings: [],
    totals: {dueMinor: 0, paidMinor: 0, allocatedMinor: 0, advanceMinor: 0, creditMinor: 0, unallocatedCreditMinor: 0, remainingMinor: 0, expenseMinor: 0, expenseInPoaMinor: 0, periodCount: 0, paidPeriods: 0, partialPeriods: 0, unpaidPeriods: 0, runningPeriods: 0, decisionPeriods: 0},
    equations: []
  };
}
