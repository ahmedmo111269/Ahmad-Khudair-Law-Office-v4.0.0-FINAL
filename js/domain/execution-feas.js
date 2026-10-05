// FEAS domain rules: explicit complete-period snapshots, integer minor units, and traceable sources.
// These are office-defined accounting policies, not legal assumptions.
import {addCivilDays, enumerateExecutionUnits, isCivilDate} from './execution-period-calendar.js';
import {addMinor, currencyFractionDigits, fromMinorUnits, sumMinor} from './execution-money.js';

export const FEAS_MODEL = 'feas-v1';
export const FEAS_PERIOD_STATES = Object.freeze(['PROJECTED', 'RECOGNIZED', 'CLOSED']);
export const FEAS_RECOGNIZED_STATES = Object.freeze(['RECOGNIZED', 'CLOSED']);
export const FEAS_PERIOD_BASES = Object.freeze([['ANNIVERSARY', 'شهر عددي من تاريخ السريان'], ['CALENDAR_MONTH', 'شهر تقويمي من أوله']]);
export const FEAS_PERIOD_START_POLICIES = Object.freeze([['ASK', 'اسأل المستخدم'], ['INCLUDE_FULL', 'احتساب الفترة كاملة'], ['EXCLUDE', 'استبعاد الفترة'], ['MANUAL', 'مبلغ يدوي']]);
export const FEAS_MID_CHANGE_POLICIES = Object.freeze([
  ['ASK', 'اسأل المستخدم'], ['KEEP_OLD_VALUE', 'تبقى الفترة بالقيمة القديمة'], ['USE_NEW_VALUE', 'الفترة كاملة بالقيمة الجديدة'], ['MANUAL', 'مبلغ يدوي لهذه الفترة']
]);
export const FEAS_END_POLICIES = Object.freeze([
  ['ASK', 'اسأل المستخدم'], ['INCLUDE_FULL', 'احتساب الفترة كاملة'], ['EXCLUDE', 'استبعاد الفترة'], ['MANUAL', 'مبلغ يدوي']
]);
export const FEAS_ACCRUAL_TIMINGS = Object.freeze([['AFTER_PERIOD_END', 'بعد اكتمال الفترة']]);
export const FEAS_MONTH_END_POLICIES = Object.freeze([['CLAMP_TO_LAST_DAY', 'قص إلى آخر يوم — بلا انجراف']]);
export const FEAS_FREQUENCIES = Object.freeze([
  ['daily', 'يومية'], ['weekly', 'أسبوعية'], ['semiMonthly', 'نصف شهرية'],
  ['monthly', 'شهرية'], ['yearly', 'سنوية'], ['custom', 'مخصصة']
]);

const DEFAULT_RULES = Object.freeze({
  periodBasis: 'ANNIVERSARY', startPolicy: 'ASK', midChangePolicy: 'ASK', endPolicy: 'ASK',
  accrualTiming: 'AFTER_PERIOD_END', monthEndPolicy: 'CLAMP_TO_LAST_DAY'
});
const MID_CHOICES = new Set(['KEEP_OLD_VALUE', 'USE_NEW_VALUE', 'MANUAL']);
const END_CHOICES = new Set(['INCLUDE_FULL', 'EXCLUDE', 'MANUAL']);

function resolvedRules(obligation = {}) {
  return {
    periodBasis: ['ANNIVERSARY', 'CALENDAR_MONTH'].includes(obligation.periodBasis) ? obligation.periodBasis : DEFAULT_RULES.periodBasis,
    startPolicy: ['ASK', 'INCLUDE_FULL', 'EXCLUDE', 'MANUAL'].includes(obligation.startPolicy) ? obligation.startPolicy : DEFAULT_RULES.startPolicy,
    midChangePolicy: ['ASK', 'KEEP_OLD_VALUE', 'USE_NEW_VALUE', 'MANUAL'].includes(obligation.midChangePolicy) ? obligation.midChangePolicy : DEFAULT_RULES.midChangePolicy,
    endPolicy: ['ASK', 'INCLUDE_FULL', 'EXCLUDE', 'MANUAL'].includes(obligation.endPolicy) ? obligation.endPolicy : DEFAULT_RULES.endPolicy,
    accrualTiming: 'AFTER_PERIOD_END',
    monthEndPolicy: 'CLAMP_TO_LAST_DAY'
  };
}

export function validateFeasObligation(input = {}) {
  const errors = {};
  if (!String(input.executionId || '').trim()) errors.executionId = 'التنفيذ مطلوب.';
  if (!String(input.obligationType || '').trim()) errors.obligationType = 'نوع الالتزام كما أدخله المكتب مطلوب.';
  if (!FEAS_FREQUENCIES.some(([key]) => key === input.frequency)) errors.frequency = 'اختر دورية الالتزام صراحةً.';
  const rules = resolvedRules(input);
  if (!FEAS_PERIOD_BASES.some(([key]) => key === rules.periodBasis)) errors.periodBasis = 'أساس الفترة غير معروف.';
  if (!FEAS_PERIOD_START_POLICIES.some(([key]) => key === rules.startPolicy)) errors.startPolicy = 'سياسة بداية الفترة غير معروفة.';
  if (!FEAS_MID_CHANGE_POLICIES.some(([key]) => key === rules.midChangePolicy)) errors.midChangePolicy = 'سياسة الحكم اللاحق غير معروفة.';
  if (!FEAS_END_POLICIES.some(([key]) => key === rules.endPolicy)) errors.endPolicy = 'سياسة نهاية الحكم غير معروفة.';
  if (!FEAS_ACCRUAL_TIMINGS.some(([key]) => key === rules.accrualTiming)) errors.accrualTiming = 'توقيت الاستحقاق غير معروف.';
  if (!FEAS_MONTH_END_POLICIES.some(([key]) => key === rules.monthEndPolicy)) errors.monthEndPolicy = 'سياسة نهاية الشهر غير معروفة.';
  const currency = String(input.currency || '').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) errors.currency = 'رمز العملة مطلوب بصيغة ISO من ثلاثة أحرف.';
  else { try { currencyFractionDigits(currency); } catch (error) { errors.currency = error.message; } }
  if (!isCivilDate(input.startDate || input.anchorDate)) errors.startDate = 'تاريخ بداية/ارتكاز الالتزام مطلوب لبناء فترات ثابتة.';
  else if (input.startDate && !isCivilDate(input.startDate)) errors.startDate = 'تاريخ بداية الالتزام غير صحيح.';
  if (input.endDate && !isCivilDate(input.endDate)) errors.endDate = 'تاريخ نهاية الالتزام غير صحيح.';
  if (input.startDate && input.endDate && input.endDate < input.startDate) errors.endDate = 'تاريخ النهاية قبل البداية.';
  if (['weekly', 'custom'].includes(input.frequency) && !isCivilDate(input.anchorDate || input.startDate)) errors.anchorDate = 'تاريخ ارتكاز مدني مطلوب لهذه الدورية.';
  if (input.frequency === 'custom' && (!Number.isInteger(Number(input.customDays)) || Number(input.customDays) < 1 || Number(input.customDays) > 36500)) errors.customDays = 'أدخل عدد أيام الدورية المخصصة.';
  return errors;
}

export function recognitionPeriodKey(obligationId, anchorDate, k) {
  if (!String(obligationId || '').trim() || !isCivilDate(anchorDate) || !Number.isSafeInteger(k) || k < 0) throw new RangeError('بيانات مفتاح فترة الاعتراف غير صحيحة.');
  return `feas::${encodeURIComponent(String(obligationId))}::${anchorDate}::${k}`;
}

const activeValueSlice = row => row && !row.isDeleted && row.status !== 'cancelled' && row.status !== 'superseded' && row.status !== 'needs_review';
const sequenceOrder = (a, b) => (Number(a.sequence || 0) - Number(b.sequence || 0)) || String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || String(a.id || '').localeCompare(String(b.id || ''));
const maximum = (...values) => values.filter(Boolean).sort().at(-1) || '';
const minimum = (...values) => values.filter(Boolean).sort()[0] || '';

function effectiveSliceEnds(slices) {
  const sorted = slices.slice().sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)) || sequenceOrder(a, b));
  const ends = new Map();
  for (let i = 0; i < sorted.length; i += 1) {
    const row = sorted[i], next = sorted[i + 1];
    const nextDayBefore = next ? addCivilDays(next.startDate, -1) : '';
    ends.set(row.id, minimum(row.endDate || '', nextDayBefore || '', '9999-12-31'));
  }
  return {sorted, ends};
}

function calendarOptions(obligation, rules) {
  const frequency = obligation.frequency;
  if (frequency === 'yearly') return {unit: 'YEAR', monthEndPolicy: rules.monthEndPolicy};
  if (frequency === 'weekly') return {unit: 'WEEK'};
  if (frequency === 'daily') return {unit: 'DAY'};
  if (frequency === 'custom') return {unit: 'DAY', step: Number(obligation.customDays)};
  if (frequency === 'semiMonthly') return null;
  return {unit: 'MONTH', periodBasis: rules.periodBasis, monthEndPolicy: rules.monthEndPolicy};
}

function officeChoice(sliceChoice, obligationChoice, allowed) {
  if (allowed.has(sliceChoice)) return sliceChoice;
  return allowed.has(obligationChoice) ? obligationChoice : 'ASK';
}

/** Resolve requested dates into whole obligation periods; boundary overlaps are reported, never prorated. */
export function resolveExecutionClaim({obligation, valuePeriods = [], fromDate, toDate, periodDecisions = [], maxUnits = 1200} = {}) {
  if (!obligation?.id) throw new TypeError('الالتزام غير محدد.');
  if (!isCivilDate(fromDate) || !isCivilDate(toDate) || toDate < fromDate) throw new RangeError('أدخل تاريخي بداية ونهاية صحيحين للفترة المطلوب حسابها.');
  const rules = resolvedRules(obligation);
  const currency = String(obligation.currency || '').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new RangeError('عملة الالتزام غير محددة.');
  const freq = obligation.frequency;
  const anchorDate = obligation.anchorDate || obligation.startDate || fromDate;
  if (!isCivilDate(anchorDate)) throw new RangeError('تاريخ ارتكاز الفترة غير صحيح.');
  const walk = enumerateExecutionUnits({
    fromDate, toDate, frequency: freq, anchorDate, customDays: obligation.customDays == null ? null : Number(obligation.customDays),
    periodBasis: rules.periodBasis, monthEndPolicy: rules.monthEndPolicy, maxUnits
  });
  if (walk.truncated) return {obligationId: obligation.id, fromDate, toDate, currency, segments: [], periods: [], partials: [], decisions: [], recognizedAmountMinor: 0, truncated: true};

  const sources = valuePeriods.filter(row => activeValueSlice(row) && row.obligationId === obligation.id);
  for (const source of sources) {
    if (!isCivilDate(source.startDate)) throw new RangeError(`تاريخ شريحة القيمة غير صحيح (${source.id}).`);
    if (!Number.isSafeInteger(source.amountMinor) || source.amountMinor < 0) throw new RangeError(`شريحة القيمة ${source.id} لا تحمل مبلغًا صحيحًا بوحدات صغرى؛ راجعها صراحةً قبل استخدامها.`);
    if (String(source.currency || currency).toUpperCase() !== currency) throw new RangeError(`عملة شريحة القيمة ${source.id} لا تطابق عملة الالتزام.`);
    if (source.endDate && (!isCivilDate(source.endDate) || source.endDate < source.startDate)) throw new RangeError(`نهاية شريحة القيمة ${source.id} غير صحيحة.`);
  }
  const {sorted, ends} = effectiveSliceEnds(sources);
  const segments = [], periods = [], partials = [], decisions = [];
  const obligationStart = obligation.startDate || anchorDate;
  const obligationEnd = obligation.endDate || '9999-12-31';
  const decisionFor = (periodKey, kinds) => (periodDecisions || []).find(item => item?.periodKey === periodKey && kinds.includes(item.kind));
  const decisionTrace = (kind, choice, supplied, fallbackReason = '') => ({
    kind, choice, reason: String(supplied?.reason || fallbackReason || '').trim(),
    decidedAt: String(supplied?.decidedAt || ''), decidedBy: String(supplied?.decidedBy || '')
  });
  const ask = (unit, key, kind, reason, options) => decisions.push({periodKey: key, k: unit.k, fromDate: unit.start, toDate: unit.end, kind, reason, options});
  let fixedApplied = false;
  for (const unit of walk.units) {
    if (unit.end < obligationStart || unit.start > obligationEnd) continue;
    if (!Number.isSafeInteger(unit.k) || unit.k < 0) continue;
    const key = recognitionPeriodKey(obligation.id, anchorDate, unit.k);
    const periodDecisionsTrace = [];
    let manualAmount = null;
    const fullInRange = unit.start >= fromDate && unit.end <= toDate;

    if (!fullInRange) {
      const kinds = [];
      if (unit.start < fromDate) kinds.push('RANGE_START');
      if (unit.end > toDate) kinds.push('RANGE_END');
      const requested = decisionFor(key, [...kinds, 'RANGE_BOUNDARY']);
      const rangeChoices = new Set(['INCLUDE_FULL', 'EXCLUDE', 'MANUAL']);
      if (!requested || !rangeChoices.has(requested.choice)) {
        const kind = kinds.length > 1 ? 'RANGE_BOUNDARY' : (kinds[0] || 'RANGE_BOUNDARY');
        partials.push({k: unit.k, periodKey: key, fromDate: unit.start, toDate: unit.end, kind});
        ask(unit, key, kind, 'حدود النطاق لا تحتوي الفترة كاملة', [...rangeChoices]);
        continue;
      }
      if (!String(requested.reason || '').trim()) {
        ask(unit, key, 'DECISION_REASON', 'سبب القرار الصريح مطلوب للفترة المتقاطعة جزئيًا', ['REASON']);
        continue;
      }
      periodDecisionsTrace.push(decisionTrace(kinds.length > 1 ? 'RANGE_BOUNDARY' : kinds[0], requested.choice, requested));
      if (requested.choice === 'EXCLUDE') continue;
      if (requested.choice === 'MANUAL') {
        if (!Number.isSafeInteger(requested.amountMinor) || requested.amountMinor < 0) {
          ask(unit, key, kinds.length > 1 ? 'RANGE_BOUNDARY' : (kinds[0] || 'RANGE_BOUNDARY'), 'أدخل مبلغًا يدويًا كاملًا بوحدات صغرى؛ لا تُستخدم نسبة يومية', ['MANUAL_AMOUNT']);
          continue;
        }
        manualAmount = requested.amountMinor;
      }
    }

    const initialStartsInside = sorted[0]?.startDate > unit.start && sorted[0]?.startDate <= unit.end
      && (sorted[0].startDate === obligationStart || (unit.start < obligationStart && obligationStart <= unit.end));
    if (unit.start < obligationStart && obligationStart <= unit.end) {
      const supplied = decisionFor(key, ['START_DATE']);
      const choice = supplied?.choice || (rules.startPolicy !== 'ASK' ? rules.startPolicy : 'ASK');
      if (!['INCLUDE_FULL', 'EXCLUDE', 'MANUAL'].includes(choice)) {
        ask(unit, key, 'START_DATE', 'بداية الالتزام تقع في منتصف فترة', ['INCLUDE_FULL', 'EXCLUDE', 'MANUAL']);
        continue;
      }
      if (supplied && !String(supplied.reason || '').trim()) {
        ask(unit, key, 'DECISION_REASON', 'سبب القرار الصريح لبداية الالتزام مطلوب', ['REASON']);
        continue;
      }
      periodDecisionsTrace.push(decisionTrace('START_DATE', choice, supplied, supplied ? '' : (obligation.choiceReason || 'قاعدة ممارسة المكتب المسجلة')));
      if (choice === 'EXCLUDE') continue;
      if (choice === 'MANUAL') {
        if (!Number.isSafeInteger(supplied.amountMinor) || supplied.amountMinor < 0) {
          ask(unit, key, 'START_DATE', 'أدخل مبلغًا يدويًا كاملًا بوحدات صغرى', ['MANUAL_AMOUNT']);
          continue;
        }
        manualAmount = supplied.amountMinor;
      }
    }

    const transitions = sorted.filter(source => source.startDate > unit.start && source.startDate <= unit.end);
    const initialPartialSource = initialStartsInside || (rules.periodBasis === 'CALENDAR_MONTH' && sorted[0]?.startDate > unit.start && sorted[0]?.startDate <= unit.end);
    const effectiveTransitions = initialPartialSource ? transitions.filter(source => source.id !== sorted[0]?.id) : transitions;
    let selected = sorted.filter(source => source.startDate <= unit.start && (ends.get(source.id) || source.endDate || '9999-12-31') >= unit.start).at(-1) || null;
    let midChoice = '';
    if (effectiveTransitions.length) {
      const transition = effectiveTransitions.at(-1);
      const supplied = decisionFor(key, ['MID_CHANGE']);
      midChoice = supplied?.choice || officeChoice(transition.midPeriodChoice, rules.midChangePolicy, MID_CHOICES);
      if (!MID_CHOICES.has(midChoice)) midChoice = 'ASK';
      if (midChoice === 'ASK') {
        ask(unit, key, 'MID_CHANGE', 'حكم لاحق يبدأ في منتصف فترة', [...MID_CHOICES]);
        continue;
      }
      if (supplied && !String(supplied.reason || '').trim()) {
        ask(unit, key, 'DECISION_REASON', 'سبب قرار الحكم اللاحق مطلوب', ['REASON']);
        continue;
      }
      periodDecisionsTrace.push(decisionTrace('MID_CHANGE', midChoice, supplied, supplied ? '' : (transition.choiceReason || obligation.choiceReason || 'قاعدة ممارسة المكتب المسجلة')));
      if (midChoice === 'KEEP_OLD_VALUE') selected = selected || sorted.filter(source => source.startDate < transition.startDate).at(-1) || null;
      else if (midChoice === 'USE_NEW_VALUE') selected = transition;
      else {
        if (supplied && Number.isSafeInteger(supplied.amountMinor) && supplied.amountMinor >= 0) manualAmount = supplied.amountMinor;
        else if (Number.isSafeInteger(transition.manualPeriodAmountMinor) && transition.manualPeriodAmountMinor >= 0) manualAmount = transition.manualPeriodAmountMinor;
        else {
          ask(unit, key, 'MID_CHANGE', 'المبلغ اليدوي للفترة غير مسجل', ['MANUAL_AMOUNT']);
          continue;
        }
        selected = transition;
      }
    }
    if (!selected && initialPartialSource && unit.start < obligationStart && obligationStart <= unit.end) selected = sorted[0] || null;
    if (!selected && initialPartialSource && rules.periodBasis === 'CALENDAR_MONTH') selected = sorted[0] || null;
    if (!selected || selected.startDate > unit.end || (ends.get(selected.id) || selected.endDate || '9999-12-31') < unit.start) continue;

    const unitEndsMid = selected.endDate && selected.endDate >= unit.start && selected.endDate < unit.end;
    const obligationEndsMid = obligation.endDate && obligation.endDate >= unit.start && obligation.endDate < unit.end;
    let endChoice = '';
    if (unitEndsMid || obligationEndsMid) {
      const choiceSource = unitEndsMid ? selected : obligation;
      const supplied = decisionFor(key, ['END_DATE']);
      endChoice = supplied?.choice || officeChoice(choiceSource.endPeriodChoice, rules.endPolicy, END_CHOICES);
      if (!END_CHOICES.has(endChoice)) endChoice = 'ASK';
      if (endChoice === 'ASK') {
        ask(unit, key, 'END_DATE', 'نهاية الحكم تقع في منتصف فترة', [...END_CHOICES]);
        continue;
      }
      if (supplied && !String(supplied.reason || '').trim()) {
        ask(unit, key, 'DECISION_REASON', 'سبب قرار نهاية الحكم مطلوب', ['REASON']);
        continue;
      }
      periodDecisionsTrace.push(decisionTrace('END_DATE', endChoice, supplied, supplied ? '' : (choiceSource.choiceReason || obligation.choiceReason || 'قاعدة ممارسة المكتب المسجلة')));
      if (endChoice === 'EXCLUDE') continue;
      if (endChoice === 'MANUAL') {
        if (supplied && Number.isSafeInteger(supplied.amountMinor) && supplied.amountMinor >= 0) manualAmount = supplied.amountMinor;
        else if (Number.isSafeInteger(choiceSource.manualEndAmountMinor) && choiceSource.manualEndAmountMinor >= 0) manualAmount = choiceSource.manualEndAmountMinor;
        else {
          ask(unit, key, 'END_DATE', 'المبلغ اليدوي لنهاية الفترة غير مسجل', ['MANUAL_AMOUNT']);
          continue;
        }
      }
    }

    const selectedValueType = selected.valueType === 'fixed' ? 'fixed' : 'periodic';
    if (selectedValueType === 'fixed') {
      const fixedInside = selected.startDate >= fromDate && selected.startDate <= toDate;
      if (fixedApplied || (!fixedInside && fullInRange)) continue;
      fixedApplied = true;
    }
    const amountMinor = manualAmount === null ? selected.amountMinor : manualAmount;
    if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) throw new RangeError('قيمة الفترة غير صحيحة بوحدات صغرى.');
    if (amountMinor === 0) continue;
    const segment = {
      unitIndex: unit.index, k: unit.k, periodKey: key, unitStart: unit.start, unitEnd: unit.end,
      valuePeriodId: selected.id, judgmentId: selected.judgmentId || '',
      rateAmountMinor: selected.amountMinor, amountMinor, currency,
      choice: midChoice || endChoice || periodDecisionsTrace.at(-1)?.choice || '',
      choiceReason: periodDecisionsTrace.map(decision => decision.reason).filter(Boolean).join('؛ ') || selected.choiceReason || obligation.choiceReason || '',
      decisions: periodDecisionsTrace,
      equation: `1 فترة كاملة (${unit.start} → ${unit.end}) × ${amountMinor} = ${amountMinor} وحدة صغرى`
    };
    segments.push(segment);
    periods.push({periodKey: key, k: unit.k, fromDate: unit.start, toDate: unit.end,
      amountMinor, currency, segments: [segment], decisions: periodDecisionsTrace, equation: segment.equation});
  }
  const recognizedAmountMinor = sumMinor(segments, segment => segment.amountMinor);
  const money = value => fromMinorUnits(value, currency).toLocaleString('en-US', {minimumFractionDigits: currencyFractionDigits(currency), maximumFractionDigits: currencyFractionDigits(currency)});
  return {
    obligationId: obligation.id, obligationType: obligation.obligationType,
    fromDate, toDate, currency, frequency: freq, ...rules,
    recognizedAmountMinor, segments, periods, partials, decisions, units: walk.units, truncated: false,
    equation: periods.map(period => `1 فترة كاملة (${period.fromDate} → ${period.toDate}) × ${money(period.amountMinor)} = ${money(period.amountMinor)} ${currency}`).join(' + ')
      || 'لا توجد فترة كاملة تغطيها شريحة قيمة؛ الفترات المتقاطعة جزئيًا معروضة بحاجة قرار.'
  };
}

function safeAmountMinor(row, label) {
  if (!Number.isSafeInteger(row?.amountMinor)) throw new TypeError(`${label} لا يحمل مبلغًا صحيحًا بوحدات صغرى؛ أوقف الحساب لحين المراجعة.`);
  return row.amountMinor;
}

function netLedgerRowsMinor(entries = []) {
  const rows = entries.filter(row => !row.isDeleted);
  const byId = new Map(rows.map(row => [row.id, row]));
  const adjustments = new Map();
  for (const row of rows) {
    if (!row.adjustsLedgerId) continue;
    const target = adjustments.get(row.adjustsLedgerId) || {delta: 0, reversed: 0, ids: []};
    const amount = safeAmountMinor(row, `الحركة ${row.id}`);
    if (row.type === 'REVERSAL') target.reversed = addMinor(target.reversed, amount);
    else if (row.type === 'ADJUSTMENT') target.delta = addMinor(target.delta, row.adjustDirection === 'decrease' ? -amount : amount);
    target.ids.push(row.id);
    adjustments.set(row.adjustsLedgerId, target);
  }
  return [...byId.values()].filter(row => !row.adjustsLedgerId).map(row => {
    const effect = adjustments.get(row.id) || {delta: 0, reversed: 0, ids: []};
    const netAmountMinor = addMinor(safeAmountMinor(row, `الحركة ${row.id}`), effect.delta, -effect.reversed);
    return {...row, amountMinor: safeAmountMinor(row, `الحركة ${row.id}`), netAmountMinor, adjustmentIds: effect.ids};
  });
}

const EXPENSE_TYPES = new Set(['EXECUTION_FEE', 'STAMP', 'COLLECTION_FEE', 'OTHER_EXPENSE']);
const activeAllocation = row => row && !row.isDeleted && row.isActive !== false;

/** Rebuild a FEAS balance entirely from recognized snapshots, approved deltas and ledger events. */
export function calculateFeasBalance({executionPeriods = [], allocations = [], ledger = [], differences = [], asOf = '', periodThroughDate = ''} = {}) {
  if (asOf && !isCivilDate(asOf)) throw new RangeError('تاريخ اللقطة المدنية غير صحيح.');
  if (periodThroughDate && !isCivilDate(periodThroughDate)) throw new RangeError('أفق الفترة المدنية غير صحيح.');
  const cutoff = asOf ? `${asOf}T23:59:59.999Z` : '';
  const unitCutoff = periodThroughDate || asOf;
  const ledgerAtDate = ledger.filter(row => !asOf || !row.date || row.date <= asOf);
  const collectionDateByReceipt = new Map(ledger.filter(row => !row.isDeleted && row.type === 'COLLECTION' && row.receiptId).map(row => [row.receiptId, row.date || '']));
  const allocationsAtDate = allocations.filter(row => {
    if (!row || row.isDeleted) return false;
    if (!asOf) return row.isActive !== false;
    if (!row.createdAt || row.createdAt > cutoff || (row.supersededAt && row.supersededAt <= cutoff)) return false;
    const receiptDate = collectionDateByReceipt.get(row.receiptId);
    if (receiptDate && receiptDate > asOf) return false;
    return true;
  });
  const recognized = executionPeriods.filter(row => {
    if (row.isDeleted || !FEAS_RECOGNIZED_STATES.includes(row.status)) return false;
    return (!asOf || !row.recognizedAt || row.recognizedAt <= cutoff)
      && (!unitCutoff || row.toDate <= unitCutoff);
  });
  const periodByKey = new Map();
  for (const row of recognized) {
    if (!row.periodKey || !Number.isSafeInteger(row.recognizedAmountMinor)) throw new TypeError(`لقطة الفترة ${row.id || ''} ناقصة أو غير سليمة؛ لم يُخفَ العيب في الرصيد.`);
    const previous = periodByKey.get(row.periodKey);
    if (previous) throw new TypeError(`مفتاح فترة الاعتراف مكرر (${row.periodKey})؛ أوقف الحساب لحين إصلاح السجل.`);
    periodByKey.set(row.periodKey, row);
  }
  const liveDifferenceKeys = new Set();
  for (const row of differences.filter(item => !item.isDeleted && item.accountingModel === FEAS_MODEL
    && ['PENDING_REVIEW', 'REVIEWED', 'APPROVED', 'POSTED'].includes(item.status) && periodByKey.has(item.periodKey))) {
    const key = `${row.settlementId || ''}|${row.periodKey}`;
    if (row.settlementId && liveDifferenceKeys.has(key)) throw new TypeError(`تسوية FEAS تحتوي فرقًا مكررًا للفترة ${row.periodKey}؛ أوقف الحساب حتى فحص السلامة.`);
    if (row.settlementId) liveDifferenceKeys.add(key);
  }
  const eligibleDifferences = differences.filter(row => !row.isDeleted && row.accountingModel === FEAS_MODEL
    && ['APPROVED', 'POSTED'].includes(row.status) && periodByKey.has(row.periodKey)
    && (!asOf || ((!row.createdAt || row.createdAt <= cutoff) && (!row.decidedAt || row.decidedAt <= cutoff))));
  const currencySet = new Set([
    ...recognized.map(row => String(row.currency || '').toUpperCase()),
    ...ledgerAtDate.filter(row => !row.isDeleted && row.currency).map(row => String(row.currency).toUpperCase()),
    ...eligibleDifferences.filter(row => row.currency).map(row => String(row.currency).toUpperCase())
  ].filter(Boolean));
  if (currencySet.size > 1) throw new TypeError(`يتضمن التنفيذ أكثر من عملة (${[...currencySet].join('، ')}). لا يجوز جمع الأرصدة بعملات مختلفة.`);
  const currency = [...currencySet][0] || recognized[0]?.currency || ledgerAtDate.find(row => row.currency)?.currency || '';
  for (const row of [...recognized, ...allocationsAtDate, ...ledgerAtDate.filter(item => !item.isDeleted), ...eligibleDifferences]) {
    if (row.currency && String(row.currency).toUpperCase() !== String(currency).toUpperCase()) throw new TypeError(`عملة السجل ${row.id || ''} لا تطابق عملة التنفيذ.`);
  }
  const deltasByPeriod = new Map();
  for (const row of eligibleDifferences) {
    const amount = safeAmountMinor({amountMinor: row.differenceAmountMinor}, `فرق الاستحقاق ${row.id}`);
    deltasByPeriod.set(row.periodKey, addMinor(deltasByPeriod.get(row.periodKey) || 0, amount));
  }
  const periodRows = [...periodByKey.values()].map(row => {
    const allocatedRows = allocationsAtDate.filter(allocation => allocation.periodKey === row.periodKey);
    const allocatedMinor = sumMinor(allocatedRows, allocation => safeAmountMinor(allocation, `التخصيص ${allocation.id}`));
    const deltaMinor = deltasByPeriod.get(row.periodKey) || 0;
    const finalAmountMinor = addMinor(row.recognizedAmountMinor, deltaMinor);
    if (finalAmountMinor < 0) throw new TypeError(`تجاوز مجموع فروق الفترة ${row.periodKey} أصل المبلغ المعترف به؛ أوقف الحساب للمراجعة.`);
    return {
      ...row, key: row.periodKey, start: row.fromDate, end: row.toDate,
      entitlementType: row.obligationTypeSnapshot || row.obligationType || '',
      originalAmountMinor: row.recognizedAmountMinor, finalAmountMinor, differenceMinor: deltaMinor,
      allocatedMinor, remainingMinor: Math.max(0, addMinor(finalAmountMinor, -allocatedMinor)),
      periodCreditMinor: Math.max(0, addMinor(allocatedMinor, -finalAmountMinor)),
      originalAmount: fromMinorUnits(row.recognizedAmountMinor, row.currency),
      finalAmount: fromMinorUnits(finalAmountMinor, row.currency),
      difference: fromMinorUnits(deltaMinor, row.currency),
      allocated: fromMinorUnits(allocatedMinor, row.currency),
      remaining: fromMinorUnits(Math.max(0, addMinor(finalAmountMinor, -allocatedMinor)), row.currency),
      equation: `max(0, ${row.recognizedAmountMinor} + ${deltaMinor} − ${allocatedMinor}) = ${Math.max(0, addMinor(finalAmountMinor, -allocatedMinor))} وحدة صغرى`,
      creditMinor: Math.max(0, addMinor(allocatedMinor, -finalAmountMinor)),
      allocationIds: allocatedRows.map(allocation => allocation.id)
    };
  }).sort((a, b) => String(a.fromDate).localeCompare(String(b.fromDate)) || String(a.periodKey).localeCompare(String(b.periodKey)));

  const activeAllocations = allocationsAtDate.filter(row => periodByKey.has(row.periodKey));
  const allocatedMinor = sumMinor(activeAllocations, row => safeAmountMinor(row, `التخصيص ${row.id}`));
  const baseMinor = sumMinor(recognized, row => safeAmountMinor({amountMinor: row.recognizedAmountMinor}, `فترة ${row.id}`));
  const approvedDeltaMinor = sumMinor(eligibleDifferences, row => safeAmountMinor({amountMinor: row.differenceAmountMinor}, `فرق الاستحقاق ${row.id}`));
  const finalEntitlementMinor = addMinor(baseMinor, approvedDeltaMinor);
  if (recognized.some(row => !row.currency) || allocationsAtDate.some(row => periodByKey.has(row.periodKey) && !row.currency)
      || ledgerAtDate.some(row => !row.isDeleted && (!row.currency || !isCivilDate(row.date)))) throw new TypeError('يوجد سجل FEAS مالي بلا رمز عملة أو تاريخ مدني صريح؛ أوقف الجمع حتى المراجعة.');
  if (recognized.some(row => !isCivilDate(row.fromDate) || !isCivilDate(row.toDate) || row.toDate < row.fromDate)) throw new TypeError('يوجد نطاق لقطة اعتراف غير صالح؛ أوقف الجمع حتى المراجعة.');
  const netLedgerMinor = netLedgerRowsMinor(ledgerAtDate);
  const netLedger = netLedgerMinor.map(row => ({...row, amount: currency ? fromMinorUnits(row.amountMinor, currency) : 0, netAmount: currency ? fromMinorUnits(row.netAmountMinor, currency) : 0}));
  const collectedMinor = sumMinor(netLedgerMinor.filter(row => row.type === 'COLLECTION'), row => row.netAmountMinor);
  const expensesMinor = sumMinor(netLedgerMinor.filter(row => EXPENSE_TYPES.has(row.type)), row => row.netAmountMinor);
  const expensesInPoaMinor = sumMinor(netLedgerMinor.filter(row => EXPENSE_TYPES.has(row.type) && row.includeInPoa), row => row.netAmountMinor);
  const unallocatedMinor = Math.max(0, addMinor(collectedMinor, -allocatedMinor));
  const overAllocatedMinor = Math.max(0, addMinor(allocatedMinor, -collectedMinor));
  const remainingMinor = Math.max(0, addMinor(finalEntitlementMinor, -allocatedMinor));
  const creditMinor = Math.max(0, addMinor(collectedMinor, -finalEntitlementMinor));
  const originalOutstandingMinor = Math.max(0, addMinor(baseMinor, -allocatedMinor));
  const differencePartMinor = addMinor(remainingMinor, -originalOutstandingMinor);
  const pendingDifferences = differences.filter(row => {
    if (row.isDeleted || row.accountingModel !== FEAS_MODEL || !periodByKey.has(row.periodKey) || (asOf && row.createdAt && row.createdAt > cutoff)) return false;
    if (['DRAFT', 'PENDING_REVIEW', 'REVIEWED'].includes(row.status)) return true;
    if (!asOf) return false;
    if (['APPROVED', 'POSTED'].includes(row.status)) return Boolean(row.decidedAt && row.decidedAt > cutoff);
    if (row.status === 'CANCELLED') return Boolean((row.decidedAt || row.supersededAt) && (row.decidedAt || row.supersededAt) > cutoff);
    return false;
  });
  const pendingMinor = sumMinor(pendingDifferences, row => safeAmountMinor({amountMinor: row.differenceAmountMinor}, `فرق معلّق ${row.id}`));
  const major = value => currency ? fromMinorUnits(value, currency) : 0;
  const equations = [
    `الاستحقاق المعترف: ${baseMinor} وحدة صغرى`,
    `فروق معتمدة تفسيرية: ${approvedDeltaMinor} وحدة صغرى (لا تُضاف مرة أخرى إلى الشريحة)`,
    `${baseMinor} + ${approvedDeltaMinor} = ${finalEntitlementMinor} وحدة صغرى`,
    `max(0, ${finalEntitlementMinor} − ${allocatedMinor} تخصيصًا) = المتبقي ${remainingMinor} وحدة صغرى`,
    `التحصيل: ${collectedMinor} − التخصيص: ${allocatedMinor} = غير مخصص ${unallocatedMinor} وحدة صغرى`,
    creditMinor > 0 ? `رصيد دائن منفصل = max(0, ${collectedMinor} − ${finalEntitlementMinor}) = ${creditMinor} وحدة صغرى` : ''
  ].filter(Boolean);
  return {
    accountingModel: FEAS_MODEL, currency, asOf, periodThroughDate: unitCutoff,
    recognizedPrincipalMinor: baseMinor, approvedDifferencesMinor: approvedDeltaMinor,
    finalEntitlementMinor, collectedMinor, allocatedMinor, unallocatedMinor, overAllocatedMinor,
    remainingMinor, creditMinor, expensesMinor, expensesInPoaMinor, originalOutstandingMinor, differencePartMinor, pendingDifferencesMinor: pendingMinor,
    recognizedPrincipal: major(baseMinor), approvedDifferences: major(approvedDeltaMinor),
    finalEntitlement: major(finalEntitlementMinor), collected: major(collectedMinor), allocated: major(allocatedMinor),
    unallocated: major(unallocatedMinor), overAllocated: major(overAllocatedMinor), remaining: major(remainingMinor),
    credit: major(creditMinor), expenses: major(expensesMinor), expensesInPoa: major(expensesInPoaMinor), originalOutstanding: major(originalOutstandingMinor),
    differencePart: major(differencePartMinor), periodCount: periodRows.length,
    periods: periodRows,
    differences: {pending: major(pendingMinor), approved: major(approvedDeltaMinor), posted: major(sumMinor(eligibleDifferences.filter(row => row.status === 'POSTED'), row => row.differenceAmountMinor))},
    equations,
    netLedger
  };
}

/** Allocate a received amount to recognized periods using an explicitly selected method. */
export function planFeasAllocation({periods = [], amountMinor, method = 'FIFO', targets = [], partyId = ''} = {}) {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new RangeError('مبلغ التحصيل بوحدات صغرى غير صحيح.');
  const allowed = new Set(['DIRECT', 'MANUAL', 'FIFO', 'LIFO', 'PROPORTIONAL', 'BY_PARTY']);
  if (!allowed.has(method)) throw new RangeError('طريقة التخصيص غير معروفة.');
  const outstanding = periods.filter(row => Number.isSafeInteger(row.remainingMinor) && row.remainingMinor > 0)
    .map(row => ({...row, remainingMinor: row.remainingMinor}))
    .sort((a, b) => String(a.fromDate || a.start || '').localeCompare(String(b.fromDate || b.start || '')) || String(a.periodKey).localeCompare(String(b.periodKey)));
  const byKey = new Map(outstanding.map(row => [row.periodKey, row]));
  const chosen = [];
  const assignedByKey = new Map();
  const chosenKeys = new Set();
  const warnings = [];
  const add = (period, valueMinor, selectedParty = '') => {
    if (!Number.isSafeInteger(valueMinor) || valueMinor <= 0) throw new RangeError('قيمة كل تخصيص يجب أن تكون وحدات صغرى موجبة وصحيحة.');
    const targetKey = `${period.periodKey}|${selectedParty || period.beneficiaryPartyIdSnapshot || ''}`;
    if (chosenKeys.has(targetKey)) throw new RangeError(`يوجد تخصيص مكرر للفترة ${period.periodKey} والمستحق نفسه.`);
    chosenKeys.add(targetKey);
    const already = assignedByKey.get(period.periodKey) || 0;
    if (addMinor(already, valueMinor) > period.remainingMinor) throw new RangeError(`التخصيص على الفترة ${period.periodKey} يتجاوز المتبقي المعترف به.`);
    const expectedParty = period.beneficiaryPartyIdSnapshot || '';
    if (selectedParty && expectedParty && selectedParty !== expectedParty) throw new RangeError(`المستفيد المحدد لا يطابق لقطة فترة الاعتراف ${period.periodKey}.`);
    assignedByKey.set(period.periodKey, addMinor(already, valueMinor));
    chosen.push({periodKey: period.periodKey, amountMinor: valueMinor, partyId: selectedParty || expectedParty});
  };

  if (method === 'DIRECT' || method === 'MANUAL') {
    for (const target of targets || []) {
      const key = typeof target === 'string' ? target : target?.periodKey;
      const period = byKey.get(key);
      if (!period) throw new RangeError(`لا توجد فترة معترف بها ذات مفتاح ${key || 'فارغ'}.`);
      const amount = typeof target === 'string' ? period.remainingMinor : target.amountMinor;
      add(period, amount, typeof target === 'string' ? '' : target.partyId || '');
    }
  } else if (method === 'FIFO' || method === 'LIFO') {
    const ordered = method === 'LIFO' ? outstanding.slice().reverse() : outstanding;
    let left = amountMinor;
    for (const period of ordered) {
      if (left <= 0) break;
      const take = Math.min(left, period.remainingMinor);
      add(period, take);
      left = addMinor(left, -take);
    }
  } else if (method === 'PROPORTIONAL') {
    const pool = sumMinor(outstanding, row => row.remainingMinor);
    if (pool > 0) {
      const distributable = Math.min(amountMinor, pool);
      const shares = outstanding.map(period => {
        const numerator = BigInt(distributable) * BigInt(period.remainingMinor);
        return {period, floor: Number(numerator / BigInt(pool)), remainder: numerator % BigInt(pool)};
      });
      const assigned = shares.reduce((sum, share) => sum + share.floor, 0);
      let rest = distributable - assigned;
      shares.sort((a, b) => a.remainder === b.remainder
        ? String(a.period.fromDate || a.period.start || '').localeCompare(String(b.period.fromDate || b.period.start || ''))
        : (a.remainder > b.remainder ? -1 : 1));
      for (const share of shares) {
        const extra = rest > 0 ? 1 : 0;
        const amount = share.floor + extra;
        if (amount > 0) add(share.period, amount);
        rest -= extra;
      }
    }
  } else if (method === 'BY_PARTY') {
    const scoped = outstanding.filter(period => !partyId || period.beneficiaryPartyIdSnapshot === partyId);
    if (!scoped.length) warnings.push({code: 'no_party_periods', message: 'لا توجد فترات معترف بها للمستفيد المحدد؛ لم يتم أي تخصيص.'});
    let left = amountMinor;
    for (const period of scoped) {
      if (left <= 0) break;
      const take = Math.min(left, period.remainingMinor);
      add(period, take, partyId);
      left = addMinor(left, -take);
    }
  }

  const allocatedMinor = sumMinor(chosen, row => row.amountMinor);
  const unallocatedMinor = addMinor(amountMinor, -allocatedMinor);
  if (!outstanding.length) warnings.push({code: 'no_recognized_periods', message: 'لا توجد فترات معترف بها ذات رصيد متبقٍ؛ ظل التحصيل غير مخصص.'});
  return {lines: chosen, allocatedMinor, unallocatedMinor, warnings};
}

/** A stable comparison basis used for REVIEWED → APPROVED concurrency checks. */
export function feasReviewFingerprint(rows = []) {
  return JSON.stringify(rows.slice().sort((a, b) => String(a.periodKey).localeCompare(String(b.periodKey))).map(row => ({
    periodKey: row.periodKey,
    oldValueMinor: row.oldValueMinor,
    newValueMinor: row.newValueMinor,
    collectedMinor: row.collectedMinor,
    differenceMinor: row.differenceMinor
  })));
}

/** Compare a new value period with already-recognized snapshots only. */
export function analyzeFeasValueChange({obligation, valuePeriods = [], executionPeriods = [], allocations = [], differences = [], candidateValuePeriodId = '', maxUnits = 1200} = {}) {
  const candidate = valuePeriods.find(row => row.id === candidateValuePeriodId);
  if (!candidate || candidate.obligationId !== obligation?.id) throw new RangeError('شريحة القيمة المرشحة لا تتبع الالتزام المحدد.');
  const resolverValuePeriods = valuePeriods.filter(row => row.id === candidateValuePeriodId || activeValueSlice(row)).map(row => row.id === candidateValuePeriodId && row.status === 'needs_review' ? {...row, status: 'active'} : row);
  const approvedByKey = new Map();
  for (const row of differences.filter(item => item.accountingModel === FEAS_MODEL && ['APPROVED', 'POSTED'].includes(item.status) && !item.isDeleted)) {
    approvedByKey.set(row.periodKey, addMinor(approvedByKey.get(row.periodKey) || 0, safeAmountMinor({amountMinor: row.differenceAmountMinor}, `فرق ${row.id}`)));
  }
  const rows = [];
  const recognized = executionPeriods.filter(row => !row.isDeleted && FEAS_RECOGNIZED_STATES.includes(row.status) && row.obligationId === obligation.id);
  for (const period of recognized) {
    const recalculated = resolveExecutionClaim({obligation, valuePeriods: resolverValuePeriods, fromDate: period.fromDate, toDate: period.toDate, maxUnits});
    if (recalculated.truncated) throw new RangeError('نطاق التسوية يتجاوز حد الفترات؛ ضيّق النطاق قبل المراجعة.');
    const oldValueMinor = addMinor(period.recognizedAmountMinor, approvedByKey.get(period.periodKey) || 0);
    const newValueMinor = recalculated.recognizedAmountMinor;
    const differenceMinor = newValueMinor - oldValueMinor;
    if (!differenceMinor) continue;
    const collectedMinor = sumMinor(allocations.filter(row => activeAllocation(row) && row.periodKey === period.periodKey), row => safeAmountMinor(row, `التخصيص ${row.id}`));
    const previousAmountMinor = period.recognizedAmountMinor;
    rows.push({
      periodKey: period.periodKey, executionPeriodId: period.id, obligationId: obligation.id,
      entitlementType: obligation.obligationType, start: period.fromDate, end: period.toDate,
      oldValueMinor, newValueMinor, differenceMinor, collectedMinor,
      oldValue: fromMinorUnits(oldValueMinor, period.currency), newValue: fromMinorUnits(newValueMinor, period.currency),
      difference: fromMinorUnits(differenceMinor, period.currency), collected: fromMinorUnits(collectedMinor, period.currency),
      originalRecognizedMinor: previousAmountMinor,
      previousJudgmentId: period.sourceJudgmentIds?.at(-1) || '', newJudgmentId: candidate.judgmentId || '',
      previousSliceId: period.sourceValuePeriodIds?.at(-1) || '', newSliceId: candidate.id,
      equation: `${newValueMinor} − (${period.recognizedAmountMinor} + ${approvedByKey.get(period.periodKey) || 0}) = ${differenceMinor} وحدة صغرى`,
      segments: recalculated.segments
    });
  }
  const totalsMinor = {
    oldValue: sumMinor(rows, row => row.oldValueMinor),
    newValue: sumMinor(rows, row => row.newValueMinor),
    difference: sumMinor(rows, row => row.differenceMinor),
    collected: sumMinor(rows, row => row.collectedMinor)
  };
  return {
    obligation, candidate, rows,
    totalsMinor,
    totals: Object.fromEntries(Object.entries(totalsMinor).map(([key, value]) => [key, fromMinorUnits(value, obligation.currency)])),
    range: rows.length ? {from: rows.map(row => row.start).sort()[0], to: rows.map(row => row.end).sort().at(-1)} : {from: '', to: ''}
  };
}
