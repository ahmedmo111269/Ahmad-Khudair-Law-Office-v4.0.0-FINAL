// FEAS domain rules: explicit obligation periods, immutable recognition snapshots,
// minor-unit balances, interpretation-only judgment deltas, and traceable sources.
// This module is pure and does not assert any legal entitlement or default rate.
import {addCivilDays, civilDaysInclusive, enumerateExecutionUnits, isCivilDate} from './execution-calendar.js';
import {addMinor, currencyFractionDigits, fromMinorUnits, prorateMinorHalfUp, sumMinor} from './execution-money.js';

export const FEAS_MODEL = 'feas-v1';
export const FEAS_PERIOD_STATES = Object.freeze(['PROJECTED', 'RECOGNIZED', 'CLOSED']);
export const FEAS_RECOGNIZED_STATES = Object.freeze(['RECOGNIZED', 'CLOSED']);
export const FEAS_PRORATION_POLICIES = Object.freeze([
  ['days', 'التناسب بعدد الأيام الفعلية داخل وحدة الدورية'],
  ['periodStart', 'قيمة كاملة إذا بدأ المصدر في أول وحدة مكتملة؛ وما عدا ذلك تناسب بالأيام']
]);
export const FEAS_FREQUENCIES = Object.freeze([
  ['daily', 'يومية'], ['weekly', 'أسبوعية'], ['semiMonthly', 'نصف شهرية'],
  ['monthly', 'شهرية'], ['yearly', 'سنوية'], ['custom', 'مخصصة']
]);

export function validateFeasObligation(input = {}) {
  const errors = {};
  if (!String(input.executionId || '').trim()) errors.executionId = 'التنفيذ مطلوب.';
  if (!String(input.obligationType || '').trim()) errors.obligationType = 'نوع الالتزام كما أدخله المكتب مطلوب.';
  if (!FEAS_FREQUENCIES.some(([key]) => key === input.frequency)) errors.frequency = 'اختر دورية الالتزام صراحةً.';
  if (!FEAS_PRORATION_POLICIES.some(([key]) => key === input.prorationPolicy)) errors.prorationPolicy = 'اختر سياسة الجزء من الفترة صراحةً؛ لا توجد سياسة مفترضة.';
  const currency = String(input.currency || '').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) errors.currency = 'رمز العملة مطلوب بصيغة ISO من ثلاثة أحرف.';
  else { try { currencyFractionDigits(currency); } catch (error) { errors.currency = error.message; } }
  if (input.startDate && !isCivilDate(input.startDate)) errors.startDate = 'تاريخ بداية الالتزام غير صحيح.';
  if (input.endDate && !isCivilDate(input.endDate)) errors.endDate = 'تاريخ نهاية الالتزام غير صحيح.';
  if (input.startDate && input.endDate && input.endDate < input.startDate) errors.endDate = 'تاريخ النهاية قبل البداية.';
  if (['weekly', 'custom'].includes(input.frequency) && !isCivilDate(input.anchorDate)) errors.anchorDate = 'تاريخ مرجعي صريح مطلوب لهذه الدورية.';
  if (input.frequency === 'custom' && (!Number.isInteger(Number(input.customDays)) || Number(input.customDays) < 1 || Number(input.customDays) > 36500)) errors.customDays = 'أدخل عدد أيام الدورية المخصصة.';
  return errors;
}

export function recognitionPeriodKey(obligationId, fromDate, toDate) {
  if (!String(obligationId || '').trim() || !isCivilDate(fromDate) || !isCivilDate(toDate) || toDate < fromDate) throw new RangeError('بيانات مفتاح فترة الاعتراف غير صحيحة.');
  return `feas::${encodeURIComponent(String(obligationId))}::${fromDate}..${toDate}`;
}

const activeValueSlice = row => row && !row.isDeleted && row.status !== 'cancelled' && row.status !== 'superseded' && row.status !== 'needs_review';
const sequenceOrder = (a, b) => (Number(a.sequence || 0) - Number(b.sequence || 0)) || String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || String(a.id || '').localeCompare(String(b.id || ''));
const maximum = (...values) => values.filter(Boolean).sort().at(-1) || '';
const minimum = (...values) => values.filter(Boolean).sort()[0] || '';
const intersects = (aStart, aEnd, bStart, bEnd) => aStart <= bEnd && bStart <= aEnd;

function effectiveSliceEnds(slices) {
  const sorted = slices.slice().sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)) || sequenceOrder(a, b));
  const ends = new Map();
  for (let i = 0; i < sorted.length; i++) {
    const row = sorted[i];
    const next = sorted[i + 1];
    const nextDayBefore = next ? addCivilDays(next.startDate, -1) : '';
    ends.set(row.id, minimum(row.endDate || '', nextDayBefore || '', '9999-12-31'));
  }
  return {sorted, ends};
}

/**
 * Resolve a proposed claim period from obligation rules and legal value periods.
 * Only calculation segments are returned; this does not write or recognize debt.
 */
export function resolveExecutionClaim({obligation, valuePeriods = [], fromDate, toDate, maxUnits = 1200} = {}) {
  if (!obligation?.id) throw new TypeError('الالتزام غير محدد.');
  if (!isCivilDate(fromDate) || !isCivilDate(toDate) || toDate < fromDate) throw new RangeError('أدخل تاريخي بداية ونهاية صحيحين للفترة المطلوب حسابها.');
  if (!FEAS_PRORATION_POLICIES.some(([key]) => key === obligation.prorationPolicy)) throw new RangeError('سياسة احتساب الفترة غير محددة؛ لم يُستخدم افتراض بديل.');
  const currency = String(obligation.currency || '').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new RangeError('عملة الالتزام غير محددة.');
  const freq = obligation.frequency;
  const walk = enumerateExecutionUnits({
    fromDate, toDate, frequency: freq, anchorDate: obligation.anchorDate || '',
    customDays: obligation.customDays === '' || obligation.customDays == null ? null : Number(obligation.customDays), maxUnits
  });
  if (walk.truncated) return {obligationId: obligation.id, fromDate, toDate, currency, segments: [], units: walk.units, recognizedAmountMinor: 0, truncated: true};

  const sources = valuePeriods.filter(row => activeValueSlice(row) && row.obligationId === obligation.id);
  for (const source of sources) {
    if (!isCivilDate(source.startDate)) throw new RangeError(`تاريخ شريحة القيمة غير صحيح (${source.id}).`);
    if (!Number.isSafeInteger(source.amountMinor) || source.amountMinor < 0) throw new RangeError(`شريحة القيمة ${source.id} لا تحمل مبلغًا صحيحًا بوحدات صغرى؛ راجعها صراحةً قبل استخدامها.`);
    if (String(source.currency || currency).toUpperCase() !== currency) throw new RangeError(`عملة شريحة القيمة ${source.id} لا تطابق عملة الالتزام.`);
    if (source.endDate && (!isCivilDate(source.endDate) || source.endDate < source.startDate)) throw new RangeError(`نهاية شريحة القيمة ${source.id} غير صحيحة.`);
  }
  const {sorted, ends} = effectiveSliceEnds(sources);
  const segments = [];
  let fixedApplied = false;
  const obligationStart = obligation.startDate || fromDate;
  const obligationEnd = obligation.endDate || toDate;

  for (const unit of walk.units) {
    const selectedStart = maximum(unit.start, fromDate, obligationStart);
    const selectedEnd = minimum(unit.end, toDate, obligationEnd);
    if (!selectedStart || !selectedEnd || selectedEnd < selectedStart) continue;
    const unitDays = civilDaysInclusive(unit.start, unit.end);
    const selectedDays = civilDaysInclusive(selectedStart, selectedEnd);
    for (const source of sorted) {
      const sourceEnd = ends.get(source.id) || source.endDate || '9999-12-31';
      const coveredStart = maximum(selectedStart, source.startDate);
      const coveredEnd = minimum(selectedEnd, sourceEnd);
      if (!coveredStart || !coveredEnd || coveredEnd < coveredStart || !intersects(coveredStart, coveredEnd, selectedStart, selectedEnd)) continue;
      const valueType = source.valueType === 'fixed' ? 'fixed' : 'periodic';
      if (valueType === 'fixed') {
        if (fixedApplied || source.startDate < fromDate || source.startDate > toDate || source.startDate < obligationStart || source.startDate > obligationEnd) continue;
        fixedApplied = true;
        segments.push({
          unitIndex: unit.index, unitStart: unit.start, unitEnd: unit.end,
          valuePeriodId: source.id, judgmentId: source.judgmentId || '',
          coveredStart: source.startDate, coveredEnd: source.startDate, coveredDays: 1, periodDays: 1,
          rateAmountMinor: source.amountMinor, amountMinor: source.amountMinor,
          currency, policy: 'fixed-once', equation: `${source.amountMinor} وحدة صغرى (قيمة ثابتة مرة واحدة)`
        });
        continue;
      }
      const coveredDays = civilDaysInclusive(coveredStart, coveredEnd);
      const selectedUnitWhole = selectedStart === unit.start && selectedEnd === unit.end;
      const sourceActiveAtUnitStart = source.startDate <= unit.start && sourceEnd >= unit.start;
      const useWholeUnit = obligation.prorationPolicy === 'periodStart' && selectedUnitWhole && sourceActiveAtUnitStart;
      const amountMinor = useWholeUnit ? source.amountMinor : prorateMinorHalfUp(source.amountMinor, coveredDays, unitDays);
      if (!Number.isSafeInteger(amountMinor)) throw new RangeError('ناتج الفترة يتجاوز حد الدقة الآمن.');
      if (amountMinor === 0) continue;
      segments.push({
        unitIndex: unit.index, unitStart: unit.start, unitEnd: unit.end,
        valuePeriodId: source.id, judgmentId: source.judgmentId || '',
        coveredStart, coveredEnd, coveredDays, periodDays: unitDays,
        rateAmountMinor: source.amountMinor, amountMinor, currency,
        policy: useWholeUnit ? 'periodStart' : 'days',
        equation: useWholeUnit
          ? `وحدة كاملة × ${source.amountMinor} = ${amountMinor} وحدة صغرى`
          : `${coveredDays}/${unitDays} يوم × ${source.amountMinor} = ${amountMinor} وحدة صغرى`
      });
    }
  }
  const recognizedAmountMinor = sumMinor(segments, segment => segment.amountMinor);
  return {
    obligationId: obligation.id, obligationType: obligation.obligationType,
    fromDate, toDate, currency, frequency: freq, prorationPolicy: obligation.prorationPolicy,
    recognizedAmountMinor, segments, units: walk.units, truncated: false,
    equation: segments.map(segment => segment.equation).join(' + ') || 'لا توجد شريحة قيمة تغطي النطاق المحدد.'
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
export function calculateFeasBalance({executionPeriods = [], allocations = [], ledger = [], differences = [], asOf = ''} = {}) {
  if (asOf && !isCivilDate(asOf)) throw new RangeError('تاريخ اللقطة المدنية غير صحيح.');
  const cutoff = asOf ? `${asOf}T23:59:59.999Z` : '';
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
  const recognized = executionPeriods.filter(row => !row.isDeleted && FEAS_RECOGNIZED_STATES.includes(row.status)
    && (!asOf || ((!row.recognizedAt || row.recognizedAt <= cutoff) && row.toDate <= asOf)));
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
      allocatedMinor, remainingMinor: addMinor(finalAmountMinor, -allocatedMinor),
      originalAmount: fromMinorUnits(row.recognizedAmountMinor, row.currency),
      finalAmount: fromMinorUnits(finalAmountMinor, row.currency),
      difference: fromMinorUnits(deltaMinor, row.currency),
      allocated: fromMinorUnits(allocatedMinor, row.currency),
      remaining: fromMinorUnits(addMinor(finalAmountMinor, -allocatedMinor), row.currency),
      equation: `${row.recognizedAmountMinor} + ${deltaMinor} − ${allocatedMinor} = ${addMinor(finalAmountMinor, -allocatedMinor)} وحدة صغرى`,
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
  const remainingMinor = addMinor(finalEntitlementMinor, -allocatedMinor);
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
    `فروق معتمدة تفسيرية: ${approvedDeltaMinor} وحدة صغرى (لا تُضاف مرة أخرى إلى الشريحة)` ,
    `${baseMinor} + ${approvedDeltaMinor} = ${finalEntitlementMinor} وحدة صغرى`,
    `${finalEntitlementMinor} − ${allocatedMinor} تخصيصًا = ${remainingMinor} وحدة صغرى`,
    `التحصيل: ${collectedMinor} − التخصيص: ${allocatedMinor} = غير مخصص ${unallocatedMinor} وحدة صغرى`
  ];
  return {
    accountingModel: FEAS_MODEL, currency,
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
export function planFeasAllocation({periods = [], amountMinor, method = 'DIRECT', targets = [], partyId = ''} = {}) {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new RangeError('مبلغ التحصيل بوحدات صغرى غير صحيح.');
  const allowed = new Set(['DIRECT', 'MANUAL', 'FIFO', 'PROPORTIONAL', 'BY_PARTY']);
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
  } else if (method === 'FIFO') {
    let left = amountMinor;
    for (const period of outstanding) {
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
