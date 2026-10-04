// =====================================================================
// محرك الجدول الشهري المشتق (Derived Execution Schedule)
// ---------------------------------------------------------------------
// • دالة نقية: (بنود القيمة + الدورية + التحصيلات) → صفوف شهرية حتى تاريخ الحساب.
//   لا تُخزَّن صفوف مستقبلية، ولا تُبنى فترات على «اعتراف» يدوي.
// • المال: أعداد صحيحة بالقروش (minor units) فقط، وبلا كسور عائمة في الجمع.
// • التاريخ: تاريخ مدني نقي YYYY-MM-DD بلا منطقة زمنية.
// • التخصيص: تخصيصات مُثبَّتة (DIRECT) يحترمها المحرك، وما بقي يُخصَّص تلقائيًا
//   بالترتيب الذي يحدده المكتب (الأقدم أولًا افتراضيًا)؛ الزائد رصيد دائن مرئي.
// • لكل رقم عقدة تتبع {الصيغة، المدخلات، المصادر، النتيجة}.
// =====================================================================
import {addCivilDays, civilDaysInclusive, daysInCivilMonth, isCivilDate} from './execution-calendar.js';
import {addMinor, fromMinorUnits, prorateMinorHalfUp, sumMinor, toMinorUnits} from './execution-money.js';

export const SCHEDULE_MAX_UNITS = 1200;

export const PERIOD_STATUS = Object.freeze({
  PAID: 'paid', PARTIAL: 'partial', UNPAID: 'unpaid', NOTHING_DUE: 'nothing_due'
});

export const PERIOD_STATUS_LABELS = Object.freeze({
  paid: '✔ مسدد', partial: '◐ جزئي', unpaid: '✗ لم يُدفع', nothing_due: '· لا استحقاق'
});

/** إعدادات الحساب الافتراضية — كلها قابلة للتعديل من إعدادات المكتب. */
export const DEFAULT_SCHEDULE_SETTINGS = Object.freeze({
  monthBasis: 'calendar',           // calendar | fromStart | thirtyDays
  firstMonthPolicy: 'prorateDays',  // prorateDays | fullMonth
  monthDayBasis: 'actual',          // actual | thirty
  allocationOrder: 'fifo',          // fifo | lifo | proportional
  roundingPolicy: 'halfUpToPiaster',// سياسة معلنة: التقريب لأقرب قرش (نصف لأعلى)
  carryCreditForward: true,         // الرصيد الدائن يُطبَّق تلقائيًا على الاستحقاقات الجديدة
  defaultCurrency: 'EGP'
});

const EXPENSE_LEDGER_TYPES = new Set(['EXECUTION_FEE', 'STAMP', 'COLLECTION_FEE', 'OTHER_EXPENSE']);
/** أنواع المصروفات القابلة للتعديل من إعدادات المكتب — تُقرأ من حقل category أيضًا. */
export const isExpenseLedgerRow = row => EXPENSE_LEDGER_TYPES.has(String(row?.type || '')) || String(row?.category || '') === 'expense';
const VOIDED_STATUSES = new Set(['voided', 'cancelled']);

/** العملة: يقبل رمز ISO أو نصًا عربيًا قديمًا («جنيه») ويعود للعملة الافتراضية بلا تخمين قانوني. */
export function currencyCode(value, fallback = 'EGP') {
  const text = String(value || '').trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(text)) return text;
  return String(fallback || 'EGP').toUpperCase();
}

/** مبلغ بسيط (major units) → قروش بلا كسور عائمة. */
export function minorFromRow(row, currency = 'EGP') {
  if (Number.isSafeInteger(row?.amountMinor)) return row.amountMinor;
  const raw = row?.amount;
  if (raw === null || raw === undefined || raw === '') return 0;
  try { return toMinorUnits(raw, currency); } catch { return 0; }
}

function settingsWith(settings) {
  return {...DEFAULT_SCHEDULE_SETTINGS, ...(settings || {})};
}

const isActiveSlice = slice => slice
  && !slice.isDeleted
  && !VOIDED_STATUSES.has(String(slice.status || '').toLowerCase())
  && String(slice.status || '') !== 'superseded';

const sliceStart = slice => (isCivilDate(slice.startDate) ? slice.startDate : '');
const sliceEnd = slice => (isCivilDate(slice.endDate) ? slice.endDate : '');

const maximum = (...values) => values.filter(Boolean).sort().at(-1) || '';
const minimum = (...values) => values.filter(Boolean).sort()[0] || '';

/**
 * تقسيم بنود القيمة إلى «مجموعات بند»: كل بند له سلسلة زمنية من القيم.
 * الحكم اللاحق يقسّم السلسلة تلقائيًا: الشريحة القديمة تنتهي قبل بداية الجديدة.
 */
export function valueTimeline(slices = []) {
  const groups = new Map();
  for (const slice of (slices || []).filter(isActiveSlice)) {
    const start = sliceStart(slice);
    if (!start) continue;
    const fixed = String(slice.valueType || 'periodic') === 'fixed';
    const type = String(slice.entitlementType || slice.obligationType || 'بند').trim() || 'بند';
    const key = fixed ? `${type}::ثابت` : `${type}::دوري`;
    if (!groups.has(key)) groups.set(key, {key, entitlementType: type, fixed, slices: [], periodicity: slice.periodicity || 'monthly'});
    const group = groups.get(key);
    group.slices.push({
      id: slice.id, startDate: start, endDate: sliceEnd(slice), fixed,
      amountMinor: minorFromRow(slice), judgmentId: slice.judgmentId || slice.linkedJudgmentId || '',
      judgmentKind: slice.judgmentKind || '', periodicity: slice.periodicity || group.periodicity,
      sourceReference: slice.sourceReference || '', currency: slice.currency || '',
      raw: slice
    });
    if (!fixed && slice.periodicity) group.periodicity = slice.periodicity;
  }
  for (const group of groups.values()) {
    group.slices.sort((a, b) => a.startDate.localeCompare(b.startDate) || String(a.id).localeCompare(String(b.id)));
    // نهاية كل شريحة تُشتق من بداية الشريحة اللاحقة في نفس البند (الحكم اللاحق).
    group.slices.forEach((slice, index) => {
      const next = group.slices[index + 1];
      slice.effectiveEnd = minimum(slice.endDate || '', next ? addCivilDays(next.startDate, -1) : '', '9999-12-31');
      slice.previous = index ? group.slices[index - 1] : null;
    });
  }
  return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** حدود الوحدة (شهر/فترة) بحسب أساس الاحتساب المختار في الإعدادات. */
function unitBounds(cursor, group, settings) {
  if (settings.monthBasis === 'fromStart') {
    const anchor = group.slices[0].startDate;
    const anchorDay = Number(anchor.slice(-2));
    const start = cursor <= anchor ? anchor : `${cursor.slice(0, 7)}-${String(Math.min(anchorDay, daysInCivilMonth(Number(cursor.slice(0, 4)), Number(cursor.slice(5, 7))))).padStart(2, '0')}`;
    if (start < cursor) {
      const nextMonthStart = addCivilDays(`${start.slice(0, 7)}-01`, daysInCivilMonth(Number(start.slice(0, 4)), Number(start.slice(5, 7))));
      const [y, m] = [Number(nextMonthStart.slice(0, 4)), Number(nextMonthStart.slice(5, 7))];
      const day = Math.min(anchorDay, daysInCivilMonth(y, m));
      return {start: `${nextMonthStart.slice(0, 7)}-${String(day).padStart(2, '0')}`, nextAnchor: true};
    }
    const [year, month, day] = start.split('-').map(Number);
    const nextYear = month === 12 ? year + 1 : year;
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextDay = Math.min(day, daysInCivilMonth(nextYear, nextMonth));
    return {start, end: addCivilDays(`${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}-${String(nextDay).padStart(2, '0')}`, -1)};
  }
  const start = `${cursor.slice(0, 7)}-01`;
  const [year, month] = start.split('-').map(Number);
  return {start, end: `${start.slice(0, 7)}-${String(daysInCivilMonth(year, month)).padStart(2, '0')}`};
}

function unitDays(unit, settings) {
  const actual = civilDaysInclusive(unit.start, unit.end);
  if (settings.monthDayBasis === 'thirty' && actual >= 28) return 30;
  return actual;
}

/**
 * الجدول المشتق: وحدات (بند × فترة) حتى تاريخ الحساب، بلا أي تخزين.
 * كل وحدة تحمل مستحقها ومصادره ومعادلته الكسرية.
 */
export function buildScheduleUnits({slices = [], asOf = '', fromDate = '', settings = {}, maxUnits = SCHEDULE_MAX_UNITS} = {}) {
  const options = settingsWith(settings);
  if (!isCivilDate(asOf)) throw new RangeError('تاريخ الحساب غير صحيح.');
  if (fromDate && !isCivilDate(fromDate)) throw new RangeError('تاريخ البداية غير صحيح.');
  const groups = valueTimeline(slices);
  const units = [];
  let truncated = false;
  for (const group of groups) {
    const first = group.slices[0];
    if (!first) continue;
    // مدى التغطية = اتحاد الشرائح (لا تتوقف السلسلة عند نهاية أول شريحة).
    const openEnd = maximum(...group.slices.map(slice => slice.effectiveEnd).filter(Boolean), '9999-12-31');
    const end = minimum(openEnd, asOf);
    let cursor = maximum(first.startDate, fromDate || '', `${first.startDate.slice(0, 7)}-01`);
    if (group.fixed || String(group.periodicity) === 'fixed') {
      const start = first.startDate;
      if (start > end) continue;
      const fixedSlice = group.slices[0];
      units.push({
        periodKey: `${group.entitlementType}::${start}`, unitKey: `${group.entitlementType}::${start}`,
        entitlementType: group.entitlementType, fixed: true, fromDate: start, toDate: start,
        dueMinor: fixedSlice.amountMinor,
        parts: [{
          sliceId: fixedSlice.id, judgmentId: fixedSlice.judgmentId, judgmentKind: fixedSlice.judgmentKind,
          amountMinor: fixedSlice.amountMinor, rateAmountMinor: fixedSlice.amountMinor,
          coveredStart: start, coveredEnd: start, days: 1, periodDays: 1, whole: true, sourceReference: fixedSlice.sourceReference,
          valueChange: null, equation: `${fixedSlice.amountMinor} قرش (مبلغ مقطوع مرة واحدة)`
        }]
      });
      continue;
    }
    let guard = 0;
    while (civilDaysInclusive(cursor, end) > 0) {
      if (units.length >= maxUnits * 4 || guard++ > maxUnits) { truncated = true; break; }
      const bounds = unitBounds(cursor, group, options);
      const start = bounds.start;
      const finish = minimum(bounds.end, end);
      if (!start || !finish || finish < start) break;
      const parts = [];
      let dueMinor = 0;
      for (const slice of group.slices) {
        const coveredStart = maximum(start, slice.startDate, first.startDate);
        const coveredEnd = minimum(finish, slice.effectiveEnd);
        if (!coveredStart || !coveredEnd || coveredEnd < coveredStart) continue;
        const whole = coveredStart === start && coveredEnd === finish;
        const days = civilDaysInclusive(coveredStart, coveredEnd);
        const denominator = unitDays({start, end: finish}, options);
        const openedHere = slice.startDate >= start && slice.startDate <= finish;
        // «الشهر الأول الناقص» سياسة إعداد: تُحتسب فترة كاملة أو تُقسَّم بالأيام.
        const useWhole = whole || (openedHere && options.firstMonthPolicy === 'fullMonth');
        const amountMinor = useWhole ? slice.amountMinor : prorateMinorHalfUp(slice.amountMinor, days, denominator);
        if (amountMinor <= 0) continue;
        parts.push({
          sliceId: slice.id, judgmentId: slice.judgmentId, judgmentKind: slice.judgmentKind,
          amountMinor, rateAmountMinor: slice.amountMinor, coveredStart, coveredEnd, days,
          periodDays: denominator, whole, sourceReference: slice.sourceReference,
          valueChange: slice.previous ? {
            previousSliceId: slice.previous.id, previousAmountMinor: slice.previous.amountMinor,
            previousJudgmentId: slice.previous.judgmentId, newAmountMinor: slice.amountMinor,
            differenceMinor: addMinor(slice.amountMinor, -slice.previous.amountMinor)
          } : null,
          equation: useWhole
            ? `${slice.amountMinor} قرش (قيمة البند كاملة)`
            : `${days}/${denominator} يوم × ${slice.amountMinor} قرش = ${amountMinor} قرش`
        });
        dueMinor = addMinor(dueMinor, amountMinor);
      }
      if (parts.length) {
        units.push({
          periodKey: `${group.entitlementType}::${start}`, unitKey: `${group.entitlementType}::${start}`,
          entitlementType: group.entitlementType, fixed: false, fromDate: start, toDate: finish,
          dueMinor, parts
        });
      }
      const nextCursor = addCivilDays(finish, 1);
      if (nextCursor <= cursor) break;
      cursor = nextCursor;
    }
  }
  const deduped = [];
  const seen = new Set();
  for (const unit of units) {
    if (seen.has(unit.unitKey)) continue;
    seen.add(unit.unitKey);
    deduped.push(unit);
  }
  deduped.sort((a, b) => a.fromDate.localeCompare(b.fromDate) || a.unitKey.localeCompare(b.unitKey));
  return {units: deduped, truncated, groups};
}

/**
 * التخصيص: تثبيت (DIRECT) ثم تلقائي بالترتيب المختار، والزائد رصيد دائن.
 * لا يُنشئ المحرك أي سجل تخزين — النتيجة نقية وقابلة لإعادة البناء بالكامل.
 */
export function allocateReceipts({units = [], receipts = [], allocations = [], settings = {}, asOf = ''} = {}) {
  const options = settingsWith(settings);
  const unitsByKey = new Map(units.map(unit => [unit.unitKey, unit]));
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
    remainingCapacity.set(unit.unitKey, unit.dueMinor);
  }

  const warnings = [];
  // 1) التثبيت اليدوي: تخصيصات محفوظة (مباشرة/معاد تخصيصها) — لها الأولوية على التلقائي.
  const pins = (allocations || [])
    .filter(row => !row.isDeleted && row.isActive !== false && !row.supersededBy && row.receiptId)
    .filter(row => receiptById.has(row.receiptId))
    .map(row => ({
      receiptId: row.receiptId, unitKey: row.periodKey,
      amountMinor: minorFromRow(row, receiptById.get(row.receiptId)?.currency || options.defaultCurrency),
      method: row.method || 'DIRECT', ledgerId: row.ledgerId || '', mode: row.mode || 'direct'
    }))
    .sort((a, b) => String(receiptById.get(a.receiptId)?.date || '').localeCompare(String(receiptById.get(b.receiptId)?.date || ''))
      || a.unitKey.localeCompare(b.unitKey));
  const pinnedRequestedByUnit = new Map();
  const pinnedSpent = new Map();
  for (const pin of pins) {
    const unit = unitsByKey.get(pin.unitKey);
    if (!unit) { warnings.push({code: 'pin-unknown-period', receiptId: pin.receiptId, periodKey: pin.unitKey}); continue; }
    pinnedRequestedByUnit.set(pin.unitKey, addMinor(pinnedRequestedByUnit.get(pin.unitKey) || 0, pin.amountMinor));
    const capacity = remainingCapacity.get(pin.unitKey);
    const allowance = Math.min(pin.amountMinor, capacity);
    if (allowance < pin.amountMinor) warnings.push({code: 'pin-over-period', receiptId: pin.receiptId, periodKey: pin.unitKey, requestedMinor: pin.amountMinor, appliedMinor: allowance});
    if (allowance <= 0) continue;
    remainingCapacity.set(pin.unitKey, addMinor(capacity, -allowance));
    paidByUnit.get(pin.unitKey).push({receiptId: pin.receiptId, amountMinor: allowance, mode: 'direct', ledgerId: pin.ledgerId});
    pinnedSpent.set(pin.receiptId, addMinor(pinnedSpent.get(pin.receiptId) || 0, allowance));
  }

  // 2) التلقائي: باقي كل محضر يُطبَّق على القدرة المتبقية بالترتيب المختار.
  const order = options.allocationOrder === 'lifo' ? -1 : 1;
  const openUnits = () => units.filter(unit => (remainingCapacity.get(unit.unitKey) || 0) > 0)
    .sort((a, b) => order * (a.fromDate.localeCompare(b.fromDate) || a.unitKey.localeCompare(b.unitKey)));
  const autoLines = [];
  for (const receipt of activeReceipts) {
    let left = addMinor(receipt.amountMinor, -(pinnedSpent.get(receipt.id) || 0));
    if (left <= 0) continue;
    if (options.allocationOrder === 'proportional') {
      const targets = openUnits();
      const pool = sumMinor(targets, unit => remainingCapacity.get(unit.unitKey) || 0);
      const distributable = Math.min(left, pool);
      if (pool > 0 && distributable > 0) {
        const shares = targets.map(unit => {
          const numerator = BigInt(distributable) * BigInt(remainingCapacity.get(unit.unitKey) || 0);
          return {unit, floor: Number(numerator / BigInt(pool)), remainder: numerator % BigInt(pool)};
        });
        let rest = distributable - shares.reduce((sum, share) => sum + share.floor, 0);
        shares.sort((a, b) => (a.remainder === b.remainder ? a.unit.fromDate.localeCompare(b.unit.fromDate) : (a.remainder > b.remainder ? -1 : 1)));
        for (const share of shares) {
          const extra = rest > 0 ? 1 : 0;
          const amount = share.floor + extra;
          rest -= extra;
          if (amount <= 0) continue;
          applyAuto(share.unit, amount);
        }
        left = addMinor(left, -distributable);
      }
    } else {
      for (const unit of openUnits()) {
        if (left <= 0) break;
        const capacity = remainingCapacity.get(unit.unitKey) || 0;
        const take = Math.min(left, capacity);
        if (take <= 0) continue;
        applyAuto(unit, take);
        left = addMinor(left, -take);
      }
    }
    if (left > 0) warnings.push({code: 'receipt-credit', receiptId: receipt.id, amountMinor: left});
  }
  function applyAuto(unit, amountMinor) {
    remainingCapacity.set(unit.unitKey, addMinor(remainingCapacity.get(unit.unitKey) || 0, -amountMinor));
    paidByUnit.get(unit.unitKey).push({receiptId: null, amountMinor, mode: 'auto'});
    autoLines.push({unitKey: unit.unitKey, amountMinor});
  }

  return {paidByUnit, remainingCapacity, autoLines, pinnedSpent, pinnedRequestedByUnit, warnings, receiptById};
}

/** بناء الجدول الكامل: صفوف عرض مجمّعة بالشهر + الأرقام الثلاثة + التتبع. */
export function buildExecutionSchedule({
  slices = [], receipts = [], allocations = [], ledger = [], settings = {}, asOf = '', fromDate = '', expenses = null
} = {}) {
  const options = settingsWith(settings);
  const {units, truncated} = buildScheduleUnits({slices, asOf, fromDate, settings: options});
  const allocation = allocateReceipts({units, receipts, allocations, settings: options, asOf});
  const rowsByDate = new Map();
  for (const unit of units) {
    const lines = allocation.paidByUnit.get(unit.unitKey) || [];
    const paidMinor = sumMinor(lines, line => line.amountMinor);
    const dueMinor = unit.dueMinor;
    const status = dueMinor <= 0 ? PERIOD_STATUS.NOTHING_DUE
      : paidMinor >= dueMinor ? PERIOD_STATUS.PAID
        : paidMinor > 0 ? PERIOD_STATUS.PARTIAL : PERIOD_STATUS.UNPAID;
    if (!rowsByDate.has(unit.fromDate)) {
      rowsByDate.set(unit.fromDate, {
        fromDate: unit.fromDate, toDate: unit.toDate, label: monthLabel(unit.fromDate),
        dueMinor: 0, paidMinor: 0, remainingMinor: 0, units: [], lines: [], valueChanges: []
      });
    }
    const row = rowsByDate.get(unit.fromDate);
    row.fromDate = minimum(row.fromDate, unit.fromDate);
    row.toDate = maximum(row.toDate, unit.toDate);
    row.units.push(unit);
    row.lines.push(...lines.map(line => ({...line, unitKey: unit.unitKey, entitlementType: unit.entitlementType, fromDate: unit.fromDate, toDate: unit.toDate})));
    row.dueMinor = addMinor(row.dueMinor, dueMinor);
    row.paidMinor = addMinor(row.paidMinor, paidMinor);
    for (const part of unit.parts) if (part.valueChange) row.valueChanges.push({...part.valueChange, entitlementType: unit.entitlementType, fromDate: unit.fromDate});
  }
  const rows = [...rowsByDate.values()].sort((a, b) => a.fromDate.localeCompare(b.fromDate)).map(row => ({
    ...row,
    // «دفعة زائدة»: مبلغ مُثبَّت على الفترة يتجاوز استحقاقها الحالي (بعد تخفيض مثلًا).
    // تُعرض بلا رد ولا تسوية تلقائية، ولا تمسّ طريقة تدفّق المال في التخصيص.
    overpaidMinor: Math.max(0, addMinor(
      sumMinor(row.units, unit => allocation.pinnedRequestedByUnit.get(unit.unitKey) || 0), -row.dueMinor
    )),
    remainingMinor: Math.max(0, addMinor(row.dueMinor, -row.paidMinor)),
    status: row.dueMinor <= 0 ? PERIOD_STATUS.NOTHING_DUE
      : row.paidMinor >= row.dueMinor ? PERIOD_STATUS.PAID
        : row.paidMinor > 0 ? PERIOD_STATUS.PARTIAL : PERIOD_STATUS.UNPAID,
    trace: {
      equation: row.units.map(unit => `${unit.entitlementType}: ${unit.parts.map(part => part.equation).join(' + ')}`).join(' | '),
      sources: row.units.flatMap(unit => unit.parts.map(part => ({sliceId: part.sliceId, judgmentId: part.judgmentId, from: part.coveredStart, to: part.coveredEnd}))),
      paidFrom: row.lines.map(line => ({receiptId: line.receiptId, amountMinor: line.amountMinor, mode: line.mode}))
    }
  }));

  const dueMinor = sumMinor(rows, row => row.dueMinor);
  const allocatedMinor = sumMinor(rows, row => row.paidMinor);
  const receiptList = [...allocation.receiptById.values()];
  const paidMinor = sumMinor(receiptList, receipt => receipt.amountMinor);
  const creditMinor = Math.max(0, addMinor(paidMinor, -allocatedMinor));
  const expenseRows = (ledger || []).filter(entry => !entry.isDeleted
    && !VOIDED_STATUSES.has(String(entry.status || '').toLowerCase())
    && (EXPENSE_LEDGER_TYPES.has(entry.type) || entry.category === 'expense'));
  const expenseMinor = sumMinor(expenseRows, entry => minorFromRow(entry, currencyCode(entry.currency, options.defaultCurrency)));
  const expenseInPoaMinor = sumMinor(expenseRows.filter(entry => entry.includeInPoa), entry => minorFromRow(entry, currencyCode(entry.currency, options.defaultCurrency)));
  const currency = currencyCode(
    slices.find(slice => slice.currency)?.currency
      || receiptList.find(receipt => receipt.currency)?.currency, options.defaultCurrency);
  const unallocatedReceipts = receiptList.map(receipt => {
    const allocatedForReceipt = pinnedAndAutoFor(receipt.id, allocation);
    return {...receipt, allocatedMinor: allocatedForReceipt, creditMinor: Math.max(0, addMinor(receipt.amountMinor, -allocatedForReceipt))};
  });

  return {
    asOf, fromDate, settings: options, currency,
    rows,
    units,
    truncated,
    receipts: unallocatedReceipts,
    totals: {
      dueMinor, paidMinor, allocatedMinor, creditMinor,
      remainingMinor: Math.max(0, addMinor(dueMinor, -allocatedMinor)),
      overpaidMinor: sumMinor(rows, row => row.overpaidMinor),
      expenseMinor, expenseInPoaMinor,
      periodCount: rows.length,
      paidPeriods: rows.filter(row => row.status === PERIOD_STATUS.PAID).length,
      partialPeriods: rows.filter(row => row.status === PERIOD_STATUS.PARTIAL).length,
      unpaidPeriods: rows.filter(row => row.status === PERIOD_STATUS.UNPAID).length
    },
    warnings: allocation.warnings,
    equations: [
      `المطلوب حتى ${asOf} = ${fromMinorUnits(dueMinor, currency)} ${currency}`,
      `المدفوع (محاضر محصلة) = ${fromMinorUnits(paidMinor, currency)} ${currency}`,
      `المخصّص على الفترات = ${fromMinorUnits(allocatedMinor, currency)} ${currency}`,
      `المتبقي = المطلوب − المخصّص = ${fromMinorUnits(Math.max(0, addMinor(dueMinor, -allocatedMinor)), currency)} ${currency}`,
      creditMinor > 0 ? `رصيد دائن غير مخصّص = ${fromMinorUnits(creditMinor, currency)} ${currency}` : '',
      expenseMinor > 0 ? `مصروفات ورسوم (منفصلة عن أصل الدين) = ${fromMinorUnits(expenseMinor, currency)} ${currency}` : ''
    ].filter(Boolean)
  };
}

function pinnedAndAutoFor(receiptId, allocation) {
  let total = 0;
  for (const lines of allocation.paidByUnit.values()) for (const line of lines) if (line.receiptId === receiptId) total = addMinor(total, line.amountMinor);
  return total;
}

/** مطالبة عن مدة (احسب مدة): المستحق/المدفوع/المتبقي عن نطاق + الرصيد السابق له. */
export function claimForRange({slices = [], receipts = [], allocations = [], settings = {}, fromDate, toDate, asOf = ''} = {}) {
  const options = settingsWith(settings);
  if (!isCivilDate(fromDate) || !isCivilDate(toDate) || toDate < fromDate) throw new RangeError('نطاق المدة غير صحيح.');
  const horizon = isCivilDate(asOf) ? maximum(asOf, toDate) : toDate;
  const full = buildExecutionSchedule({slices, receipts, allocations, settings: options, asOf: horizon});
  const rows = [];
  let dueMinor = 0, paidMinor = 0, beforeMinor = 0;
  for (const row of full.rows) {
    if (row.toDate < fromDate) { beforeMinor = addMinor(beforeMinor, row.remainingMinor); continue; }
    if (row.fromDate > toDate) continue;
    const overlapStart = maximum(row.fromDate, fromDate);
    const overlapEnd = minimum(row.toDate, toDate);
    const days = civilDaysInclusive(overlapStart, overlapEnd);
    const rowDays = civilDaysInclusive(row.fromDate, row.toDate);
    const ratio = days >= rowDays ? 1 : days / rowDays;
    const due = ratio === 1 ? row.dueMinor : prorateMinorHalfUp(row.dueMinor, days, rowDays);
    const paid = ratio === 1 ? row.paidMinor : Math.min(row.paidMinor, due);
    dueMinor = addMinor(dueMinor, due);
    paidMinor = addMinor(paidMinor, paid);
    rows.push({...row, overlapStart, overlapEnd, dueMinor: due, paidMinor: paid, remainingMinor: Math.max(0, addMinor(due, -paid))});
  }
  const remainingMinor = Math.max(0, addMinor(dueMinor, -paidMinor));
  return {
    fromDate, toDate, rows,
    totals: {
      dueMinor, paidMinor, remainingMinor, beforeMinor,
      totalRequiredMinor: addMinor(remainingMinor, beforeMinor),
      currency: full.currency
    },
    equations: [
      `المستحق عن المدة (${fromDate} → ${toDate}) = ${fromMinorUnits(dueMinor, full.currency)}`,
      `المدفوع عنها = ${fromMinorUnits(paidMinor, full.currency)}`,
      `المتبقي عنها = ${fromMinorUnits(remainingMinor, full.currency)}`,
      beforeMinor ? `رصيد سابق غير مسدد قبل المدة = ${fromMinorUnits(beforeMinor, full.currency)}` : 'لا يوجد رصيد سابق غير مسدد قبل المدة',
      `الإجمالي المطلوب = ${fromMinorUnits(addMinor(remainingMinor, beforeMinor), full.currency)}`
    ]
  };
}

/** معاينة حكم لاحق: فرق كل شهر مرة واحدة، بلا إعادة احتساب المبلغ كاملًا. */
export function previewValueChange({slices = [], receipts = [], allocations = [], settings = {}, asOf = '', candidate, previousSliceId = ''} = {}) {
  if (!candidate?.startDate || !isCivilDate(candidate.startDate)) throw new RangeError('تاريخ سريان الحكم اللاحق مطلوب.');
  if (!(minorFromRow(candidate) > 0)) throw new RangeError('القيمة الجديدة يجب أن تكون أكبر من صفر.');
  const before = buildExecutionSchedule({slices, receipts, allocations, settings, asOf});
  const candidateSlice = {
    id: candidate.id || '__candidate__', entitlementType: candidate.entitlementType,
    valueType: candidate.valueType || 'periodic', amountMinor: minorFromRow(candidate, before.currency),
    amount: candidate.amount, startDate: candidate.startDate, endDate: candidate.endDate || '',
    periodicity: candidate.periodicity || 'monthly', judgmentId: candidate.judgmentId || '',
    judgmentKind: candidate.judgmentKind || 'later', status: 'active'
  };
  const withoutPrevious = previousSliceId
    ? slices.filter(slice => slice.id !== previousSliceId)
    : slices;
  const after = buildExecutionSchedule({slices: [...withoutPrevious, candidateSlice], receipts, allocations, settings, asOf});
  const beforeByKey = new Map(before.rows.map(row => [row.fromDate, row]));
  const afterByKey = new Map(after.rows.map(row => [row.fromDate, row]));
  const keys = [...new Set([...beforeByKey.keys(), ...afterByKey.keys()])].sort();
  const rows = keys.map(key => {
    const oldRow = beforeByKey.get(key), newRow = afterByKey.get(key);
    const oldMinor = oldRow?.dueMinor || 0, newMinor = newRow?.dueMinor || 0;
    const differenceMinor = addMinor(newMinor, -oldMinor);
    return {
      fromDate: key, label: monthLabel(key), oldMinor, newMinor, differenceMinor,
      oldValue: fromMinorUnits(oldMinor, after.currency), newValue: fromMinorUnits(newMinor, after.currency),
      difference: fromMinorUnits(differenceMinor, after.currency),
      oldPaidMinor: oldRow?.paidMinor || 0, newPaidMinor: newRow?.paidMinor || 0,
      creditBecauseOverpaidMinor: Math.max(0, addMinor((oldRow?.paidMinor || 0), -(newMinor)))
    };
  }).filter(row => row.differenceMinor !== 0 || row.oldMinor !== row.newMinor);
  const beforeTotals = before.totals, afterTotals = after.totals;
  return {
    rows, currency: after.currency, asOf,
    totals: {
      oldDueMinor: beforeTotals.dueMinor, newDueMinor: afterTotals.dueMinor,
      differenceMinor: addMinor(afterTotals.dueMinor, -beforeTotals.dueMinor),
      oldRemainingMinor: beforeTotals.remainingMinor, newRemainingMinor: afterTotals.remainingMinor,
      creditMinor: afterTotals.creditMinor
    },
    equations: [
      `قبل: ${fromMinorUnits(beforeTotals.dueMinor, after.currency)} — بعد: ${fromMinorUnits(afterTotals.dueMinor, after.currency)}`,
      `الفرق = ${fromMinorUnits(addMinor(afterTotals.dueMinor, -beforeTotals.dueMinor), after.currency)} (يظهر مرة واحدة على الشهور المتأثرة)`
    ]
  };
}

/** رصيد سابق + فترة جديدة + مصروفات مختارة = إجمالي التوكيل (بلا ازدواج). */
export function buildPoaFigures({schedule, fromDate, toDate, includePreviousBalance = true, expenses = [], expenseIds = []} = {}) {
  if (!schedule) throw new TypeError('جدول التنفيذ مطلوب لحساب التوكيل.');
  if (!isCivilDate(fromDate) || !isCivilDate(toDate) || toDate < fromDate) throw new RangeError('مدة التوكيل غير صحيحة.');
  let previousMinor = 0, periodDueMinor = 0, periodPaidMinor = 0, differencesMinor = 0;
  const lines = [];
  for (const row of schedule.rows) {
    if (row.toDate < fromDate) {
      previousMinor = addMinor(previousMinor, row.remainingMinor);
      continue;
    }
    if (row.fromDate > toDate) continue;
    periodDueMinor = addMinor(periodDueMinor, row.dueMinor);
    periodPaidMinor = addMinor(periodPaidMinor, row.paidMinor);
    for (const change of row.valueChanges || []) differencesMinor = addMinor(differencesMinor, Math.abs(change.differenceMinor || 0));
    lines.push({
      kind: 'period', fromDate: row.fromDate, toDate: row.toDate, label: row.label,
      amountMinor: row.dueMinor, paidMinor: row.paidMinor, remainingMinor: row.remainingMinor,
      note: row.dueMinor ? '' : 'لا استحقاق'
    });
  }
  const expenseLines = (expenses || []).filter(expense => !expenseIds || expenseIds.includes(expense.id))
    .map(expense => ({
      kind: 'expense', id: expense.id, label: expense.label || expense.type, fromDate: expense.date, toDate: expense.date,
      amountMinor: expense.amountMinor, remainingMinor: expense.amountMinor,
      note: expense.borneByLabel ? `يتحمله: ${expense.borneByLabel}` : ''
    }));
  const expensesMinor = sumMinor(expenseLines, line => line.amountMinor);
  const previousApplied = includePreviousBalance ? previousMinor : 0;
  const totalMinor = addMinor(addMinor(previousApplied, periodDueMinor), expensesMinor);
  return {
    fromDate, toDate, currency: schedule.currency,
    previousBalanceMinor: previousMinor, previousAppliedMinor: previousApplied,
    periodDueMinor, periodPaidMinor, periodRemainingMinor: Math.max(0, addMinor(periodDueMinor, -periodPaidMinor)),
    differencesMinor, expensesMinor, totalMinor,
    lines: [
      ...(previousApplied ? [{kind: 'previous', label: `رصيد سابق غير مسدد حتى ${addCivilDays(fromDate, -1)}`, fromDate: '', toDate: '', amountMinor: previousApplied, remainingMinor: previousApplied, note: 'جزء من المتبقي — لا يُضاف عليه مرة ثانية'}] : []),
      ...lines, ...expenseLines
    ],
    equations: [
      ...(previousApplied ? [`رصيد سابق = ${fromMinorUnits(previousApplied, schedule.currency)}`] : []),
      `فترة التوكيل (${fromDate} → ${toDate}) = ${fromMinorUnits(periodDueMinor, schedule.currency)}`,
      ...(expensesMinor ? [`مصروفات مختارة = ${fromMinorUnits(expensesMinor, schedule.currency)}`] : []),
      `إجمالي التوكيل = ${fromMinorUnits(totalMinor, schedule.currency)}`,
      differencesMinor ? `منها فروق أحكام ${fromMinorUnits(differencesMinor, schedule.currency)} مضمّنة داخل الفترة — لا تُضاف مرة ثانية` : ''
    ].filter(Boolean)
  };
}

export function monthLabel(fromDate) {
  if (!isCivilDate(fromDate)) return '';
  const months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  const [year, month] = fromDate.split('-').map(Number);
  return `${months[month - 1]} ${year}`;
}

export function emptySchedule(asOf = '', currency = 'EGP') {
  return {
    asOf, fromDate: '', settings: settingsWith({}), currency, rows: [], units: [], receipts: [], truncated: false, warnings: [],
    totals: {dueMinor: 0, paidMinor: 0, allocatedMinor: 0, creditMinor: 0, remainingMinor: 0, expenseMinor: 0, expenseInPoaMinor: 0, periodCount: 0, paidPeriods: 0, partialPeriods: 0, unpaidPeriods: 0},
    equations: []
  };
}
