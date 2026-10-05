// =====================================================================
// محرك الاستحقاق والفروق والتخصيص والرصيد — نقي بالكامل (بلا IndexedDB/DOM)
// ---------------------------------------------------------------------
// المبادئ الملزمة المنفَّذة هنا:
//  • الرصيد نتيجة حسابية مشتقة من الشرائح والحركات والتخصيصات — لا رقم يدوي.
//  • الشريحة القديمة لا تُعدَّل: الحكم اللاحق ينشئ شريحة جديدة، والفترة تعرف
//    قيمتها «النهائية» (أحدث شريحة) و«الأصلية» (أول شريحة عرفتها الفترة).
//  • لا ازدواج حساب: قيمة الحكم اللاحق لا تُضاف فوق قيمة الحكم الأصلي؛ الأثر
//    الإضافي = الفرق فقط (Final − Original)، ويظهر مفككًا لا مجمّعًا.
//  • كل نتيجة قابلة للتفسير: معادلة + فترة + حكم مصدر + حركات مرتبطة.
// =====================================================================
import {
  num, round2, equationText, isIsoDate, todayIso, parsePeriodKey, maxIso,
  LEDGER_CATEGORY, isExpenseType, isCollectionType,
  IN_REVIEW_DIFFERENCE_STATUSES, ACTIVE_DIFFERENCE_STATUSES, PETITION_KIND, JUDICIAL_KIND
} from './execution.js';
import {buildExecutionSchedule, buildScheduleUnits, DEFAULT_SCHEDULE_SETTINGS, currencyCode, PERIOD_STATUS} from './execution-schedule.js';
import {fromMinorUnits, sumMinor, toMinorUnits} from './execution-money.js';
import {isCivilDate} from './execution-period-calendar.js';

const activeSlice = slice => slice && !slice.isDeleted && slice.status !== 'cancelled';
const createdRank = slice => `${slice.createdAt || ''}|${String(slice.id || '')}`;
// ترتيب «تسجيل الشرائح»: رقم التسلسل أولًا (حتمي وحتى داخل نفس الألفية)، ثم وقت التسجيل
// ثم المعرّف. لا يُعتمد على الترتيب الأبجدي للمعرّف لأن المعرّف يحتوي جزءًا عشوائيًا.
const byCreated = (a, b) =>
  (Number(a.sequence || 0) - Number(b.sequence || 0)) ||
  (a.createdAt || '').localeCompare(b.createdAt || '') ||
  String(a.id).localeCompare(String(b.id));

/** الشرائح المرشحة للحظة معرفة معينة (asOf): لا نقرأ ما لم يكن مسجلًا بعد. */
export function eligibleSlices(slices = [], asOf = '', {mode = 'knowledge'} = {}) {
  const list = slices.filter(activeSlice);
  if (!asOf) return list;
  // knowledge: الشرائح المعروفة حتى تاريخ (وقت التسجيل). effective: الشرائح السارية ماليًا حتى تاريخ
  // (تاريخ سريان القيمة <= التاريخ) — تُستخدم في «الرصيد في تاريخ» مع تنبيه صريح عن الشرائح المسجلة لاحقًا.
  if (mode === 'effective') return list.filter(slice => !slice.startDate || slice.startDate <= asOf);
  const cutoff = String(asOf).length > 10 ? String(asOf) : `${asOf}T23:59:59.999Z`;
  return list.filter(slice => !slice.createdAt || slice.createdAt <= cutoff);
}

export function slicesOfEntitlement(slices = [], entitlementType = '') {
  return slices
    .filter(slice => String(slice.entitlementType || '') === String(entitlementType || ''))
    .slice()
    .sort(byCreated);
}
export const entitlementKeys = (slices = []) => [...new Set(slices.filter(activeSlice).map(slice => String(slice.entitlementType || '')))];

/** شريحة سارية على يوم معين: أحدث شريحة مُسجَّلة تغطي هذا اليوم. */
export function sliceAt(slices = [], entitlementType = '', day = '', asOf = '') {
  const candidates = slicesOfEntitlement(eligibleSlices(slices, asOf), entitlementType)
    .filter(slice => slice.startDate <= day && (!slice.endDate || slice.endDate >= day));
  return candidates.sort(byCreated).at(-1) || null;
}

/** أول شريحة عرفتها الفترة: هي «الرصيد الأصلي» الذي قيس عليه الفرق. */
export function originalSliceForPeriod(slices = [], entitlementType = '', periodStart = '') {
  const candidates = slicesOfEntitlement(slices, entitlementType)
    .filter(slice => slice.startDate <= periodStart && (!slice.endDate || slice.endDate >= periodStart));
  return candidates.sort(byCreated)[0] || null;
}

/** Coverage is binary at the period level. Partial intersections never alter a value. */
export function coverageOfPeriod(slice, periodStart, periodEnd) {
  if (!slice || !isCivilDate(periodStart) || !isCivilDate(periodEnd) || periodEnd < periodStart) {
    return {covered: false, complete: false, needsDecision: false, amount: 0, start: '', end: ''};
  }
  const sliceStart = isCivilDate(slice.startDate) ? slice.startDate : periodStart;
  const sliceEnd = isCivilDate(slice.endDate) ? slice.endDate : '9999-12-31';
  const intersects = sliceStart <= periodEnd && periodStart <= sliceEnd;
  const complete = sliceStart <= periodStart && sliceEnd >= periodEnd;
  return {
    covered: complete, complete, needsDecision: intersects && !complete,
    amount: complete ? round2(num(slice.amount)) : 0,
    start: intersects ? (sliceStart > periodStart ? sliceStart : periodStart) : '',
    end: intersects ? (sliceEnd < periodEnd ? sliceEnd : periodEnd) : ''
  };
}

/** A periodic slice contributes its full amount only when the whole civil period is covered. */
export function sliceValueForPeriod(slice, period = {}) {
  if (!slice) return {covered: false, amount: 0, needsDecision: false};
  if (!sliceIsPeriodic(slice)) {
    const startsInRange = isCivilDate(slice.startDate) && slice.startDate >= period.start && slice.startDate <= period.end;
    return {covered: startsInRange, amount: startsInRange ? round2(num(slice.amount)) : 0, needsDecision: false};
  }
  return coverageOfPeriod(slice, period.start, period.end);
}

/**
 * تفكيك مبلغ فترة واحدة بلا ازدواج: المتبقي = النهائي − المحصل،
 * والرصيد الأصلي = الأصلية − المحصل، وجزء الفرق = المتبقي − الرصيد الأصلي.
 * مثال: 4000 نهائي، 3000 أصلية، 2000 محصل → متبقٍ 2000 = أصلي 1000 + فرق 1000.
 */
export function outstandingBreakdown({finalAmount = 0, originalAmount = 0, collected = 0} = {}) {
  const final = round2(num(finalAmount));
  const original = round2(num(originalAmount));
  const paid = round2(num(collected));
  const remaining = round2(Math.max(0, final - paid));
  const credit = round2(Math.max(0, paid - final));
  const originalOutstanding = round2(Math.max(0, original - paid));
  const differencePart = round2(remaining - originalOutstanding);
  return {
    finalAmount: final, originalAmount: original, collected: paid, remaining, credit, originalOutstanding, differencePart,
    equation: `${final} − ${Math.min(final, paid)} = ${remaining} = رصيد أصلي ${originalOutstanding} + فرق ${differencePart}${credit ? `؛ رصيد دائن ${credit}` : ''}`
  };
}

/** نوع الاستحقاق: مبلغ ثابت (لا يتكرر) أم دوري. */
export const sliceIsPeriodic = slice => (slice?.valueType || 'periodic') !== 'fixed';

const UNIT_LABELS = Object.freeze({daily: 'يوم', weekly: 'أسبوع', semiMonthly: 'نصف شهر', monthly: 'شهر', yearly: 'سنة', custom: 'دورة'});
/** نهاية الشريحة الفعلية: صريحة إن سُجلت، وإلا اليوم السابق لبداية الشريحة اللاحقة. */
/** Map the v2 anchored-unit engine to the established legacy accounting view. */
function legacyPeriodFromUnit(unit, settings = {}) {
  const currency = currencyCode(unit.currency || unit.parts?.[0]?.currency, settings.defaultCurrency || 'EGP');
  const finalMinor = unit.isComplete && !unit.needsDecision ? unit.dueMinor : 0;
  const finalPart = unit.parts?.at(-1) || {};
  const previousMinor = Number.isSafeInteger(finalPart.valueChange?.previousAmountMinor)
    ? finalPart.valueChange.previousAmountMinor : (finalMinor || finalPart.amountMinor || 0);
  const originalSliceId = finalPart.valueChange?.previousSliceId || finalPart.sliceId || '';
  const originalJudgmentId = finalPart.valueChange?.previousJudgmentId || finalPart.judgmentId || '';
  const periodicity = unit.fixed ? 'fixed' : (unit.parts?.[0]?.periodicity || unit.periodicity || 'monthly');
  return {
    key: unit.unitKey, periodKey: unit.unitKey, unitKey: unit.unitKey,
    legacyPeriodKey: unit.legacyPeriodKey || `${unit.entitlementType}::${unit.fromDate}`,
    itemId: unit.itemId, anchorDate: unit.anchorDate, k: unit.k,
    entitlementType: unit.entitlementType, start: unit.fromDate, end: unit.toDate,
    fromDate: unit.fromDate, toDate: unit.toDate, dueDate: unit.toDate,
    isComplete: Boolean(unit.isComplete), needsDecision: Boolean(unit.needsDecision),
    decisionReason: unit.decisionReason || '', choiceOptions: unit.choiceOptions || [],
    periodicity, unit: ({daily: 'يوم', weekly: 'أسبوع', semiMonthly: 'نصف شهر', monthly: 'شهر', yearly: 'سنة', custom: 'دورة', fixed: 'مبلغ مقطوع'})[periodicity] || 'فترة',
    sliceId: finalPart.sliceId || '', judgmentId: finalPart.judgmentId || '', partyId: finalPart.partyId || '',
    originalSliceId, originalJudgmentId,
    finalAmount: fromMinorUnits(finalMinor, currency), originalAmount: fromMinorUnits(previousMinor, currency),
    finalValue: fromMinorUnits(finalPart.rateAmountMinor ?? finalMinor, currency),
    originalValue: fromMinorUnits(previousMinor, currency),
    equation: finalPart.equation || unit.decisionReason || '',
    decisionsSnapshot: [...new Map((unit.parts || []).flatMap(part => part.decisionsSnapshot || [])
      .map(decision => [`${decision.periodKey || unit.periodKey}::${decision.kind}`, decision])).values()],
    parts: (unit.parts || []).map(part => ({
      sliceId: part.sliceId, amount: fromMinorUnits(part.amountMinor || 0, currency),
      amountMinor: part.amountMinor || 0, judgmentId: part.judgmentId || '',
      currency: part.currency || currency, valueChange: part.valueChange || null, equation: part.equation || '',
      decisionsSnapshot: part.decisionsSnapshot || []
    })),
    differenceEquation: previousMinor !== finalMinor ? `${finalMinor} − ${previousMinor} = ${finalMinor - previousMinor}` : ''
  };
}

function buildV2Periods({slices = [], from = '', to = '', asOf = '', maxPeriods = 1200, settings = {}, mode = 'knowledge'} = {}) {
  const horizon = to || asOf || todayIso();
  const usable = eligibleSlices(slices, asOf, {mode});
  if (!usable.length) return {periods: [], truncated: false, range: {from: '', to: horizon}, decisions: [], entitlementKeys: []};
  const firstStarts = usable.map(slice => slice.startDate).filter(isCivilDate).sort();
  const rangeFrom = from || firstStarts[0] || '';
  const options = {...DEFAULT_SCHEDULE_SETTINGS, ...(settings || {})};
  const built = buildScheduleUnits({slices: usable, asOf: horizon, fromDate: rangeFrom, settings: options, maxUnits: maxPeriods});
  const periods = built.units
    .filter(unit => unit.isComplete || unit.needsDecision)
    .map(unit => legacyPeriodFromUnit(unit, options))
    .filter(period => !rangeFrom || period.end >= rangeFrom)
    .filter(period => !horizon || period.start <= horizon)
    .sort((a, b) => a.start.localeCompare(b.start) || String(a.key).localeCompare(String(b.key)));
  return {
    periods, truncated: built.truncated, range: {from: rangeFrom, to: horizon}, decisions: built.decisions,
    entitlementKeys: [...new Set(usable.filter(activeSlice).map(slice => String(slice.entitlementType || '')))]
  };
}

/** Derived full-period entitlement rows for one displayed obligation label. */
export function periodsForEntitlement({slices = [], entitlementType = '', from = '', to = '', asOf = '', maxPeriods = 1200, settings = {}, mode = 'knowledge'} = {}) {
  const built = buildV2Periods({slices, from, to, asOf, maxPeriods, settings, mode});
  const periods = built.periods.filter(row => String(row.entitlementType || '') === String(entitlementType || ''));
  return {periods, truncated: built.truncated, range: built.range, decisions: built.decisions.filter(row => String(row.entitlementType || '') === String(entitlementType || ''))};
}

/** Full-period rows for all items; partial/curr­ent periods never contribute a fractional value. */
export function buildEntitlementPeriods({slices = [], asOf = '', from = '', to = '', maxPeriods = 1200, settings = {}, mode = 'knowledge'} = {}) {
  const built = buildV2Periods({slices, asOf, from, to, maxPeriods, settings, mode});
  return {...built, periods: built.periods, entitlementKeys: built.entitlementKeys};
}

// ===== الحركات المالية: صافي كل حركة بعد التصحيحات والعكوس =====
/**
 * لا تُعدَّل الحركة التاريخية: تُضاف REVERSAL أو ADJUSTMENT. هذه الدالة تحسب
 * «الصافي الفعّال» لكل حركة مع بقاء السجل الأصلي كما هو.
 */
export function netLedger(entries = []) {
  const byId = new Map();
  for (const row of entries.filter(row => !row.isDeleted)) byId.set(row.id, row);
  const adjustments = new Map();
  const reversals = new Map();
  for (const row of byId.values()) {
    if (!row.adjustsLedgerId) continue;
    const target = adjustments.get(row.adjustsLedgerId) || {delta: 0, reversed: 0, rows: []};
    if (row.type === 'REVERSAL') target.reversed += num(row.amount);
    else if (row.type === 'ADJUSTMENT') target.delta += num(row.adjustDirection === 'decrease' ? -row.amount : row.amount);
    target.rows.push(row.id);
    adjustments.set(row.adjustsLedgerId, target);
  }
  const rows = [];
  for (const row of byId.values()) {
    if (row.adjustsLedgerId) continue; // الحركة التصحيحية تُعرض داخل أصلها
    const effect = adjustments.get(row.id) || {delta: 0, reversed: 0, rows: []};
    const net = round2(num(row.amount) + effect.delta - effect.reversed);
    rows.push({
      ...row,
      category: LEDGER_CATEGORY[row.type] || 'other',
      netAmount: net,
      adjusted: Boolean(effect.rows.length),
      reversedAmount: round2(effect.reversed),
      adjustmentIds: effect.rows
    });
  }
  return rows.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || String(a.id).localeCompare(String(b.id)));
}

export function ledgerTotals(entries = []) {
  const net = netLedger(entries);
  const collections = net.filter(row => isCollectionType(row.type));
  const expenses = net.filter(row => isExpenseType(row.type));
  const obligations = net.filter(row => row.type === 'DIFFERENCE_DUE');
  return {
    rows: net,
    collected: round2(collections.reduce((sum, row) => sum + row.netAmount, 0)),
    expenses: round2(expenses.reduce((sum, row) => sum + row.netAmount, 0)),
    expensesInPoa: round2(expenses.filter(row => row.includeInPoa).reduce((sum, row) => sum + row.netAmount, 0)),
    differencesPosted: round2(obligations.reduce((sum, row) => sum + row.netAmount, 0)),
    collectionRows: collections,
    expenseRows: expenses
  };
}

// ===== التخصيص =====
/** المتبقي على كل فترة = النهائي − المخصص لها. */
export function outstandingPeriods({periods = [], allocations = [], differences = []} = {}) {
  const map = new Map();
  const aliases = new Map();
  for (const period of periods) {
    const entry = {
      periodKey: period.key, legacyPeriodKey: period.legacyPeriodKey || '',
      entitlementType: period.entitlementType,
      start: period.start, end: period.end,
      dueDate: period.end,
      finalAmount: round2(period.finalAmount),
      originalAmount: round2(period.originalAmount),
      originalValue: period.originalValue,
      finalValue: period.finalValue,
      sliceId: period.sliceId, judgmentId: period.judgmentId,
      originalSliceId: period.originalSliceId, originalJudgmentId: period.originalJudgmentId,
      equation: period.equation, needsDecision: period.needsDecision, decisionReason: period.decisionReason || '',
      // المستحق المرتبط بالشريحة (إن سُجّل): يجعل التخصيص «حسب المستحق» ممكنًا بلا تخمين
      partyId: period.partyId || '',
      allocated: 0, allocationIds: [], parties: new Set(period.partyId ? [period.partyId] : [])
    };
    map.set(period.key, entry);
    if (period.legacyPeriodKey && !aliases.has(period.legacyPeriodKey)) aliases.set(period.legacyPeriodKey, entry);
  }
  for (const allocation of allocations) {
    if (allocation.isDeleted || allocation.isActive === false) continue;
    const entry = map.get(allocation.periodKey) || aliases.get(allocation.periodKey);
    if (!entry) continue;
    entry.allocated = round2(entry.allocated + num(allocation.amount));
    entry.allocationIds.push(allocation.id);
    if (allocation.executionPartyId) entry.parties.add(allocation.executionPartyId);
  }
  const list = [...map.values()].map(entry => ({
    ...entry,
    parties: [...entry.parties],
    remaining: round2(Math.max(0, entry.finalAmount - entry.allocated)),
    originalOutstanding: round2(Math.max(0, entry.originalAmount - entry.allocated)),
    differencePart: round2(Math.max(0, entry.finalAmount - entry.allocated) - Math.max(0, entry.originalAmount - entry.allocated)),
    difference: round2(entry.finalAmount - entry.originalAmount)
  })).sort((a, b) => a.start.localeCompare(b.start));
  const totalFinal = round2(list.reduce((sum, row) => sum + row.finalAmount, 0));
  const totalOriginal = round2(list.reduce((sum, row) => sum + row.originalAmount, 0));
  const allocated = round2(list.reduce((sum, row) => sum + row.allocated, 0));
  const originalOutstanding = round2(list.reduce((sum, row) => sum + row.originalOutstanding, 0));
  const differencePart = round2(list.reduce((sum, row) => sum + row.differencePart, 0));
  const approvedDiff = round2([...differences].filter(d => ACTIVE_DIFFERENCE_STATUSES.includes(d.status)).reduce((sum, d) => sum + num(d.differenceAmount), 0));
  const pendingDiff = round2([...differences].filter(d => IN_REVIEW_DIFFERENCE_STATUSES.includes(d.status)).reduce((sum, d) => sum + num(d.differenceAmount), 0));
  return {periods: list, totals: {finalEntitlement: totalFinal, originalEntitlement: totalOriginal, allocated, originalOutstanding, differencePart, approvedDiff, pendingDiff}};
}

/**
 * خطة تخصيص نقدية على الفترات. لا تفترض FIFO قاعدة: الطريقة يختارها المستخدم،
 * والمستند المحدد للفترة يُخصَّص مباشرة (DIRECT/MANUAL).
 */
export function allocationPlan({outstanding = [], amount = 0, method = 'FIFO', targets = [], partyId = ''} = {}) {
  const money = round2(num(amount));
  const warnings = [];
  const rows = outstanding.filter(row => row.remaining > 0.001);
  const byKey = new Map(rows.map(row => [row.periodKey, row]));
  let chosen = [];
  if (method === 'DIRECT' || method === 'MANUAL') {
    for (const target of targets || []) {
      const periodKey = typeof target === 'string' ? target : target.periodKey;
      const entry = byKey.get(periodKey);
      if (!entry) { warnings.push({code: 'unknown_period', periodKey, message: `لا توجد فترة استحقاق مطابقة (${periodKey}).`}); continue; }
      const wanted = typeof target === 'string' ? entry.remaining : round2(num(target.amount));
      chosen.push({periodKey, amount: wanted, partyId: entry.parties?.[0] || ''});
    }
  } else if (method === 'FIFO' || method === 'LIFO') {
    const ordered = rows.slice().sort((a, b) => a.start.localeCompare(b.start) || String(a.periodKey).localeCompare(String(b.periodKey)));
    if (method === 'LIFO') ordered.reverse();
    let left = money;
    for (const row of ordered) {
      if (left <= 0.001) break;
      const take = Math.min(left, row.remaining);
      chosen.push({periodKey: row.periodKey, amount: take, partyId: row.parties?.[0] || ''});
      left = round2(left - take);
    }
  } else if (method === 'PROPORTIONAL') {
    const pool = rows.reduce((sum, row) => sum + row.remaining, 0);
    if (pool <= 0) warnings.push({code: 'nothing_due', message: 'لا يوجد متبقٍ لتخصيص المبلغ عليه.'});
    else {
      const raw = rows.map(row => ({periodKey: row.periodKey, exact: money * (row.remaining / pool), row}));
      let assigned = 0;
      const lines = raw.map(item => {
        const value = Math.floor(item.exact * 100) / 100;
        assigned = round2(assigned + value);
        return {periodKey: item.periodKey, amount: value, partyId: item.row.parties?.[0] || '', remainder: item.exact - value};
      });
      let rest = round2(money - assigned);
      for (const line of lines.slice().sort((a, b) => b.remainder - a.remainder)) {
        if (rest <= 0.001) break;
        const step = Math.min(rest, 0.01);
        line.amount = round2(line.amount + step);
        rest = round2(rest - step);
      }
      chosen = lines.filter(line => line.amount > 0);
    }
  } else if (method === 'BY_PARTY') {
    let left = money;
    const scoped = rows.filter(row => !partyId || (row.parties || []).includes(partyId));
    if (!scoped.length) warnings.push({code: 'no_party_periods', message: 'لا توجد فترات مرتبطة بالمستحق المحدد؛ لم يتم أي تخصيص تلقائي.'});
    for (const row of scoped.slice().sort((a, b) => a.start.localeCompare(b.start))) {
      if (left <= 0.001) break;
      const take = Math.min(left, row.remaining);
      chosen = [...chosen, {periodKey: row.periodKey, amount: take, partyId: partyId || row.parties?.[0] || ''}];
      left = round2(left - take);
    }
  }
  // لم يُطلب مبلغ صريح لكل سطر (DIRECT بلا مبالغ): أكمل الباقي على أقدم الفترات مع تنبيه صريح.
  if (method === 'DIRECT' && round2(chosen.reduce((sum, line) => sum + line.amount, 0)) < money - 0.001) {
    let left = round2(money - round2(chosen.reduce((sum, line) => sum + line.amount, 0)));
    for (const row of rows.slice().sort((a, b) => a.start.localeCompare(b.start))) {
      if (left <= 0.001) break;
      const already = chosen.find(line => line.periodKey === row.periodKey);
      const room = round2(row.remaining - (already ? already.amount : 0));
      if (room <= 0.001) continue;
      const take = Math.min(left, room);
      if (already) already.amount = round2(already.amount + take);
      else chosen.push({periodKey: row.periodKey, amount: take, partyId: row.parties?.[0] || ''});
      left = round2(left - take);
    }
    warnings.push({code: 'direct_default_order', message: 'طُلب التخصيص المباشر بلا مبالغ لكل فترة: أُكمل الباقي على أقدم الفترات تلقائيًا (وليس لأنه القاعدة القانونية). راجع السطور وعدّلها إن اختلف ترتيب المكتب.'});
  }
  const total = round2(chosen.reduce((sum, line) => sum + line.amount, 0));
  const overflow = round2(total - money);
  if (overflow > 0.001) warnings.push({code: 'over_ledger', message: `إجمالي التخصيص يتجاوز مبلغ الحركة بـ ${round2(overflow)}.`});
  return {
    lines: chosen.map(line => ({...line, amount: round2(line.amount)})).filter(line => line.amount > 0),
    allocated: round2(Math.min(total, money)),
    unallocated: round2(Math.max(0, money - total)),
    overAllocated: round2(Math.max(0, total - money)),
    warnings
  };
}

/** التخصيص التحليلي للعرض فقط عندما توجد تحصيلات بلا تخصيص: الأقدم أولًا، بلا كتابة أي سجل. */
export function analyticalAllocation({outstanding = [], unallocated = 0} = {}) {
  let left = round2(num(unallocated));
  const lines = [];
  for (const row of outstanding.slice().sort((a, b) => a.start.localeCompare(b.start))) {
    if (left <= 0.001) break;
    const room = round2(Math.max(0, row.remaining));
    if (room <= 0.001) continue;
    const take = Math.min(left, room);
    lines.push({periodKey: row.periodKey, amount: take});
    left = round2(left - take);
  }
  return {lines, remainder: left, applied: round2(num(unallocated) - left)};
}

// ===== محرك الفروق: أثر حكم لاحق على فترات سابقة =====
/**
 * يحلل أثر شريحة جديدة على الفترات المعروفة أصلًا:
 * كل صف = فترة | القديم | الجديد | المحصل | الفرق | الرصيد الأصلي | الرصيد النهائي.
 */
export function analyzeSliceImpact({slices = [], newSlice, allocations = [], ledger = [], asOf = '', throughDate = '', maxPeriods = 1200, settings = {}} = {}) {
  if (!newSlice) return {rows: [], totals: {oldValue: 0, newValue: 0, collected: 0, difference: 0, originalOutstanding: 0, remaining: 0}};
  const before = slices.filter(slice => slice.id !== newSlice.id);
  const entitlementType = newSlice.entitlementType;
  const priorSlice = slicesOfEntitlement(before, entitlementType)
    .filter(slice => !newSlice.startDate || !slice.startDate || slice.startDate <= newSlice.startDate).at(-1) || null;
  const normalizedNewSlice = {
    ...newSlice,
    itemId: newSlice.itemId || priorSlice?.itemId || `legacy:${entitlementType || 'بند'}`,
    anchorDate: newSlice.anchorDate || priorSlice?.anchorDate || priorSlice?.startDate || newSlice.startDate
  };
  const from = (slicesOfEntitlement(before, entitlementType)[0]?.startDate) || normalizedNewSlice.startDate;
  const to = normalizedNewSlice.endDate || throughDate || asOf || maxIso(todayIso(), normalizedNewSlice.startDate);
  const beforeBuild = periodsForEntitlement({slices: before, entitlementType, from, to, asOf, maxPeriods, settings});
  const afterBuild = periodsForEntitlement({slices: [...before, normalizedNewSlice], entitlementType, from, to, asOf, maxPeriods, settings});
  const afterByKey = new Map(afterBuild.periods.map(period => [period.key, period]));
  const beforeByKey = new Map(beforeBuild.periods.map(period => [period.key, period]));
  const aliases = new Map([...beforeBuild.periods, ...afterBuild.periods].flatMap(period => [[period.key, period.key], [period.legacyPeriodKey, period.key]]));
  const allocationByKey = new Map();
  for (const allocation of allocations) {
    if (allocation.isDeleted || allocation.isActive === false) continue;
    const key = aliases.get(allocation.periodKey) || allocation.periodKey;
    allocationByKey.set(key, round2((allocationByKey.get(key) || 0) + num(allocation.amount)));
  }
  const rows = [];
  for (const period of afterBuild.periods) {
    const oldPeriod = beforeByKey.get(period.key) || null;
    const newPeriod = afterByKey.get(period.key);
    // فترة بلا استحقاق سابق مسجل: الشريحة الأولى تُنشئ استحقاقًا، وليست «فرقًا» يحتاج تسوية.
    if (!oldPeriod) continue;
    const oldValue = round2(oldPeriod.finalAmount);
    const newValue = round2(newPeriod.finalAmount);
    if (Math.abs(newValue - oldValue) < 0.005) continue; // الفترات غير المتأثرة لا تُدرج
    const collected = round2(allocationByKey.get(period.key) || 0);
    const difference = round2(newValue - oldValue);
    const originalOutstanding = round2(Math.max(0, oldValue - collected));
    rows.push({
      periodKey: period.key,
      entitlementType,
      start: period.start, end: period.end,
      oldValue, newValue, difference,
      collected,
      remaining: round2(Math.max(0, newValue - collected)),
      originalOutstanding,
      differencePart: round2(Math.max(0, newValue - collected) - originalOutstanding) > 0 ? round2(Math.max(0, newValue - collected) - originalOutstanding) : 0,
      previousJudgmentId: oldPeriod?.judgmentId || '',
      newJudgmentId: newPeriod?.judgmentId || '',
      previousSliceId: oldPeriod?.sliceId || '',
      newSliceId: newPeriod?.sliceId || '',
      equation: `${newValue} − ${oldValue} = ${difference}`,
      executedEarlier: collected > 0
    });
  }
  // فترات كانت قائمة قبل الشريحة ولم تعد قائمة بعدها (تغيير تغطية): تُعرض للمراجعة بلا ادعاء فرق موجب.
  for (const period of beforeBuild.periods) {
    if (afterByKey.has(period.key)) continue;
    const collected = round2(allocationByKey.get(period.key) || 0);
    const oldValue = round2(period.finalAmount);
    rows.push({
      periodKey: period.key,
      entitlementType,
      start: period.start, end: period.end,
      oldValue, newValue: 0, difference: round2(-oldValue),
      collected,
      remaining: 0,
      originalOutstanding: round2(Math.max(0, oldValue - collected)),
      differencePart: 0,
      previousJudgmentId: period.judgmentId || '',
      newJudgmentId: '',
      previousSliceId: period.sliceId || '',
      newSliceId: newSlice.id,
      equation: `الفترة ${period.key} لم تعد مشمولة بالاستحقاق بعد هذه الشريحة (${oldValue} → 0)`,
      coverageRemoved: true,
      executedEarlier: collected > 0
    });
  }
  const totals = rows.reduce((acc, row) => ({
    oldValue: round2(acc.oldValue + row.oldValue),
    newValue: round2(acc.newValue + row.newValue),
    collected: round2(acc.collected + row.collected),
    difference: round2(acc.difference + row.difference),
    originalOutstanding: round2(acc.originalOutstanding + row.originalOutstanding),
    remaining: round2(acc.remaining + row.remaining)
  }), {oldValue: 0, newValue: 0, collected: 0, difference: 0, originalOutstanding: 0, remaining: 0});
  return {rows, totals, range: {from, to}, truncated: beforeBuild.truncated || afterBuild.truncated};
}

// ===== مجموع الرصيد =====
/**
 * ملخص الرصيد من البيانات المسجلة فقط:
 *   الرصيد = الاستحقاق النهائي المشتق − المحصل الفعلي
 *   ويُفكَّك إلى: رصيد أصلي + فروق أحكام لاحقة (+ تصحيحات إن وُجدت).
 */
export function balanceSummary({periods = [], slices = [], allocations = [], ledger = [], differences = [], asOf = '', throughDate = '', settings = {}, mode = 'knowledge'} = {}) {
  const scheduleDate = isIsoDate(asOf) ? asOf : todayIso();
  const cutoffTime = `${scheduleDate}T23:59:59.999Z`;
  const knownByCutoff = row => mode === 'effective' || !row.createdAt || String(row.createdAt) <= cutoffTime;
  const inRange = rows => rows.filter(row => !row.isDeleted && (!row.date || String(row.date) <= scheduleDate) && knownByCutoff(row));
  const visibleLedger = inRange(ledger);
  const totals = ledgerTotals(visibleLedger);
  const visibleLedgerById = new Map(visibleLedger.map(row => [row.id, row]));
  const activeAllocations = allocations.filter(row => !row.isDeleted
    && (row.isActive !== false || (row.supersededAt && String(row.supersededAt) > cutoffTime))
    && knownByCutoff(row)
    && (!row.supersededAt || String(row.supersededAt) > cutoffTime)
    && (!visibleLedgerById.get(row.ledgerId)?.date || visibleLedgerById.get(row.ledgerId).date <= scheduleDate))
    .map(row => row.isActive === false ? {...row, isActive: true} : row);
  const outstanding = outstandingPeriods({periods, allocations: activeAllocations, differences});
  const receipts = totals.collectionRows.filter(row => row.netAmount > 0).map(row => {
    const currency = currencyCode(row.currency, settings.defaultCurrency || 'EGP');
    const amountMinor = toMinorUnits(row.netAmount, currency);
    return {id: row.receiptId || row.id, receiptId: row.receiptId || row.id, date: row.date || '', currency, amountMinor, amount: fromMinorUnits(amountMinor, currency), status: row.status};
  });
  const schedule = buildExecutionSchedule({
    slices, receipts, allocations: activeAllocations, ledger: visibleLedger, settings,
    asOf: scheduleDate, periodThroughDate: isIsoDate(throughDate) ? throughDate : '', receiptAsOf: scheduleDate
  });
  const currency = schedule.currency;
  const finalEntitlement = fromMinorUnits(schedule.totals.dueMinor, currency);
  const allocatedOnDue = fromMinorUnits(schedule.totals.allocatedMinor, currency);
  const remaining = fromMinorUnits(schedule.totals.remainingMinor, currency);
  const credit = fromMinorUnits(schedule.totals.creditMinor, currency);
  const advance = fromMinorUnits(schedule.totals.advanceMinor, currency);
  const unallocatedCredit = fromMinorUnits(schedule.totals.unallocatedCreditMinor, currency);
  const collected = totals.collected;
  const unallocated = round2(collected - outstanding.totals.allocated);
  const autoAppliedMinor = sumMinor(schedule.rows.filter(row => row.isComplete && !row.needsDecision), row =>
    sumMinor(row.lines.filter(line => line.mode === 'auto'), line => line.amountMinor));
  const autoApplied = fromMinorUnits(autoAppliedMinor, currency);
  const analytical = autoApplied > 0.001 ? analyticalAllocation({outstanding: outstanding.periods, unallocated: autoApplied}) : {lines: [], remainder: 0, applied: 0};
  const originalOutstanding = round2(outstanding.totals.originalOutstanding + analytical.applied);
  const differencePart = round2(remaining - originalOutstanding);
  const approvedDiff = outstanding.totals.approvedDiff;
  const pendingDiff = outstanding.totals.pendingDiff;
  const postedDiff = round2(inRange(differences).filter(d => d.status === 'POSTED').reduce((sum, d) => sum + num(d.differenceAmount), 0));
  const equations = [
    `الاستحقاق النهائي للفترات المكتملة: ${finalEntitlement} ${currency} (${schedule.totals.periodCount} فترة)`,
    `المحصل: ${collected}`,
    `المخصص على الفترات المكتملة: ${allocatedOnDue}`,
    `المتبقي = max(0, المستحق − المخصص على الفترات المكتملة) = ${remaining}`,
    `تفكيك الرصيد: رصيد أصلي ${originalOutstanding} + فروق أحكام ${differencePart} = ${remaining}`
  ];
  if (advance > 0.001) equations.push(`مدفوع مقدمًا على فترة جارية = ${advance} ${currency}؛ لا يخفض المطلوب قبل اكتمالها.`);
  if (unallocatedCredit > 0.001) equations.push(`رصيد دائن غير مخصص منفصل = ${unallocatedCredit} ${currency}.`);
  if (unallocated > 0.001) equations.push(`يوجد ${unallocated} محصل غير مخصص فعليًا؛ التوزيع التحليلي للأقدم لا يكتب تخصيصًا.`);
  if (credit > 0.001) equations.push(`رصيد دائن إجمالي = max(0, المحصل − المستحق المكتمل) = ${credit} ${currency}.`);
  if (pendingDiff) equations.push(`فروق تنتظر المراجعة/الاعتماد: ${pendingDiff} (لا تُعد ملتزمًا معتمدًا قبل قرار المستخدم).`);
  return {
    asOf: scheduleDate, periodThroughDate: schedule.periodThroughDate,
    finalEntitlement,
    originalEntitlement: outstanding.totals.originalEntitlement,
    collected,
    remaining,
    credit,
    advance,
    unallocatedCredit,
    originalOutstanding,
    differencePart,
    differences: {approved: approvedDiff, pending: pendingDiff, posted: postedDiff},
    unallocated,
    analyticalAllocation: analytical,
    expenses: totals.expenses,
    expensesInPoa: totals.expensesInPoa,
    differencesPostedInLedger: totals.differencesPosted,
    periods: outstanding.periods,
    periodCount: schedule.totals.periodCount,
    equations,
    schedule,
    allocationsTotal: outstanding.totals.allocated,
    collectionRows: totals.collectionRows,
    expenseRows: totals.expenseRows
  };
}

/** شجرة تفكيك الرصيد حتى المصدر: الرصيد ← الفترات/المحاضر/الفروق/التصحيحات. */
export function balanceTrace({summary, periods = [], allocations = [], receipts = [], ledger = [], differences = [], slices = [], judgments = []} = {}) {
  const periodRows = summary?.periods || [];
  const receiptById = new Map(receipts.map(row => [row.id, row]));
  const ledgerById = new Map(ledger.map(row => [row.id, row]));
  const sliceById = new Map(slices.map(row => [row.id, row]));
  const judgmentById = new Map(judgments.map(row => [row.id, row]));
  const periodAliases = new Map();
  for (const period of periodRows) {
    periodAliases.set(period.periodKey, period.periodKey);
    if (period.legacyPeriodKey && !periodAliases.has(period.legacyPeriodKey)) periodAliases.set(period.legacyPeriodKey, period.periodKey);
  }
  const traceAllocations = allocations.filter(allocation => !allocation.isDeleted && allocation.isActive !== false).map(allocation => {
    const periodKey = periodAliases.get(allocation.periodKey) || allocation.periodKey;
    return periodKey === allocation.periodKey ? allocation : {...allocation, periodKey, legacyPeriodKey: allocation.periodKey};
  });
  const allocationsByPeriod = new Map();
  for (const allocation of traceAllocations) {
    const list = allocationsByPeriod.get(allocation.periodKey) || [];
    list.push(allocation);
    allocationsByPeriod.set(allocation.periodKey, list);
  }
  const periodNodes = periodRows.map(period => {
    const links = allocationsByPeriod.get(period.periodKey) || [];
    return {
      id: `period:${period.periodKey}`,
      label: `فترة ${period.start} → ${period.end}`.trim(),
      amount: period.finalAmount,
      detail: [period.equation, ...(period.decisionsSnapshot || []).map(decision => `${decision.kind}: ${decision.choice} — ${decision.reason || ''}`)].filter(Boolean).join(' · '),
      meta: {
        periodKey: period.periodKey, entitlementType: period.entitlementType,
        sliceId: period.sliceId, judgmentId: period.judgmentId,
        decisions: period.decisionsSnapshot || [],
        judgmentLabel: judgmentById.get(period.judgmentId)?.judgmentNumber || '',
        sliceLabel: sliceById.get(period.sliceId) ? `${sliceById.get(period.sliceId).amount} من ${sliceById.get(period.sliceId).startDate}` : ''
      },
      children: [
        ...(period.decisionsSnapshot || []).map((decision, index) => ({
          id: `period:${period.periodKey}:decision:${index}`, label: `قرار الفترة: ${decision.kind} — ${decision.choice}`,
          amount: 0, detail: `${decision.reason || ''} · ${decision.decidedAt || 'قاعدة مكتب'} · ${decision.decidedBy || ''}`,
          meta: {decision}, children: []
        })),
        ...(period.originalValue !== period.finalValue ? [{
          id: `period:${period.periodKey}:original`, label: 'القيمة الأصلية قبل الحكم اللاحق',
          amount: period.originalAmount, detail: `الفرق ${period.difference}`, meta: {judgmentId: period.originalJudgmentId}, children: []
        }] : []),
        ...links.map(allocation => {
          const ledgerRow = ledgerById.get(allocation.ledgerId) || null;
          const receipt = allocation.receiptId ? receiptById.get(allocation.receiptId) : null;
          return {
            id: `allocation:${allocation.id}`,
            label: receipt ? `محضر ${receipt.receiptNumber || ''} — ${receipt.date || ''}`.trim() : `حركة ${ledgerRow?.type || ''} — ${ledgerRow?.date || ''}`,
            amount: round2(num(allocation.amount)),
            detail: `طريقة التخصيص: ${allocation.method || ''}`,
            meta: {ledgerId: allocation.ledgerId, receiptId: allocation.receiptId || '', allocationId: allocation.id},
            children: allocation.isDifference ? [{id: `difference:${allocation.differenceRecordId}`, label: 'فرق حكم لاحق مُعتمد', amount: round2(num(allocation.amount)), detail: '', meta: {differenceRecordId: allocation.differenceRecordId}, children: []}] : []
          };
        })
      ]
    };
  });
  const tracedDecisionKeys = new Set(periodRows.flatMap(period => period.decisionsSnapshot || [])
    .map(decision => `${decision.periodKey || ''}::${decision.kind}::${decision.choice}::${decision.decidedAt || ''}`));
  const savedDecisionNodes = slices.flatMap(slice => (slice.periodDecisionsSnapshot || []).map(decision => ({slice, decision})))
    .filter(({decision}) => !tracedDecisionKeys.has(`${decision.periodKey || ''}::${decision.kind}::${decision.choice}::${decision.decidedAt || ''}`))
    .map(({slice, decision}, index) => ({
      id: `slice:${slice.id}:decision:${index}`, label: `قرار محفوظ: ${decision.kind} — ${decision.choice}`,
      amount: 0, detail: `${decision.reason || ''} · ${decision.decidedAt || ''} · ${decision.decidedBy || ''}`,
      meta: {sliceId: slice.id, decision}, children: []
    }));
  const receiptNodes = receipts.map(receipt => ({
    id: `receipt:${receipt.id}`,
    label: `محضر ${receipt.receiptNumber || ''} — ${receipt.date || ''}`.trim(),
    amount: round2(num(receipt.amount)),
    detail: `${receipt.receiptType || ''} · ${receipt.allocationMethod || ''}`.trim(),
    meta: {receiptId: receipt.id, ledgerId: receipt.ledgerId || ''},
    children: (allocationsByPeriod.size ? traceAllocations.filter(a => a.receiptId === receipt.id) : []).map(allocation => ({
      id: `receipt-allocation:${allocation.id}`,
      label: `تخصيص على ${allocation.periodKey}`,
      amount: round2(num(allocation.amount)),
      detail: allocation.isDifference ? 'فرق حكم لاحق' : 'استحقاق فترة',
      meta: {periodKey: allocation.periodKey},
      children: []
    }))
  }));
  const differenceNodes = differences.map(difference => ({
    id: `difference:${difference.id}`,
    label: `فرق ${difference.periodKey} — ${difference.status}`,
    amount: round2(num(difference.differenceAmount)),
    detail: `${difference.oldValue ?? ''} → ${difference.newValue ?? ''}`,
    meta: {differenceRecordId: difference.id, previousJudgmentId: difference.previousJudgmentId, newJudgmentId: difference.newJudgmentId},
    children: []
  }));
  const correctionRows = netLedger(ledger).filter(row => row.adjusted || row.type === 'ADJUSTMENT' || row.type === 'REVERSAL');
  const correctionNodes = correctionRows.map(row => ({
    id: `correction:${row.id}`,
    label: `${row.type === 'REVERSAL' ? 'عكس' : row.type === 'ADJUSTMENT' ? 'تصحيح' : 'حركة معدَّلة'} — ${row.date || ''}`,
    amount: round2(row.netAmount),
    detail: row.reason || row.notes || '',
    meta: {ledgerId: row.id, adjustsLedgerId: row.adjustsLedgerId || ''},
    children: []
  }));
  const differenceTotal = round2(differences.filter(d => ACTIVE_DIFFERENCE_STATUSES.includes(d.status)).reduce((sum, d) => sum + num(d.differenceAmount), 0));
  const correctionsEffect = round2(correctionRows.reduce((sum, row) => sum + (num(row.netAmount) - num(row.amount)), 0));
  return {
    id: 'balance',
    label: 'الرصيد الحالي',
    amount: round2(num(summary?.remaining)),
    detail: `الاستحقاق ${round2(num(summary?.finalEntitlement))} − المحصل ${round2(num(summary?.collected))}`,
    meta: {},
    children: [
      {
        id: 'entitlement', label: 'الاستحقاق النهائي', amount: round2(num(summary?.finalEntitlement)),
        detail: `${periodRows.length} فترة`, meta: {count: periodRows.length},
        children: [
          {id: 'entitlement:original', label: 'الاستحقاق الأصلي (قبل الأحكام اللاحقة)', amount: round2(num(summary?.originalEntitlement)), detail: '', meta: {}, children: []},
          ...periodNodes,
          ...savedDecisionNodes
        ]
      },
      {
        id: 'collected', label: 'المحصل', amount: round2(num(summary?.collected)),
        detail: `${receiptNodes.length} محضر/حركة`, meta: {count: receiptNodes.length},
        children: receiptNodes
      },
      {
        id: 'differences', label: 'فروق الأحكام اللاحقة', amount: differenceTotal,
        detail: `${differences.length} سجل فرق`, meta: {count: differences.length},
        children: differenceNodes
      },
      {
        id: 'corrections', label: 'التصحيحات والعكوس', amount: correctionsEffect,
        detail: `${correctionRows.length} حركة`, meta: {count: correctionRows.length},
        children: correctionNodes
      },
      {
        id: 'expenses', label: 'مصروفات التنفيذ (منفصلة عن أصل الدين)', amount: round2(num(summary?.expenses)),
        detail: `منها داخل التوكيل: ${round2(num(summary?.expensesInPoa))}`, meta: {}, children: []
      }
    ]
  };
}

/** الرصيد في تاريخ معين: يعتمد ما كان مسجلًا فعليًا حتى ذلك التاريخ ولا يقرأ ما بعده. */
export function balanceAsOf({slices = [], allocations = [], ledger = [], differences = [], asOf = '', maxPeriods = 1200, settings = {}, throughDate = '', mode = 'knowledge'} = {}) {
  const cutoff = asOf || todayIso();
  const end = `${cutoff}T23:59:59.999Z`;
  const effective = mode === 'effective';
  const knownSlices = eligibleSlices(slices, cutoff, {mode: effective ? 'effective' : 'knowledge'});
  const build = buildEntitlementPeriods({slices: knownSlices, asOf: cutoff, to: throughDate || cutoff, maxPeriods, settings, mode});
  const ledgerById = new Map(ledger.map(row => [row.id, row]));
  const knownAllocations = allocations.filter(row => {
    if (row.isDeleted) return false;
    if (row.isActive === false && (!row.supersededAt || String(row.supersededAt) <= end)) return false;
    const parent = ledgerById.get(row.ledgerId);
    const day = row.date || parent?.date || '';
    if (day && String(day) > cutoff) return false;
    return effective || !row.createdAt || String(row.createdAt) <= end;
  });
  const knownLedger = ledger.filter(row => !row.isDeleted && (!row.date || String(row.date) <= cutoff) && (effective || !row.createdAt || String(row.createdAt) <= end));
  const knownDifferences = differences.filter(row => {
    if (row.isDeleted) return false;
    const day = row.periodEnd || row.periodStart || '';
    if (effective && day && String(day) > cutoff) return false;
    return effective || !row.createdAt || String(row.createdAt) <= end;
  });
  const summary = balanceSummary({periods: build.periods, slices: knownSlices, allocations: knownAllocations, ledger: knownLedger, differences: knownDifferences, asOf: cutoff, throughDate: throughDate || cutoff, settings, mode});
  if (effective) {
    summary.recordedLaterSlices = knownSlices.filter(slice => slice.createdAt && String(slice.createdAt) > end).map(slice => ({id: slice.id, entitlementType: slice.entitlementType, amount: slice.amount, startDate: slice.startDate, createdAt: slice.createdAt}));
    summary.dateBasis = 'event-dates';
    summary.note = 'الرصيد في هذا التاريخ محسوب من الفترات والحركات التي تاريخها حتى ذلك اليوم. الشرائح المسجلة لاحقًا بتاريخ سريان سابق مُدرجة ومُعلَّمة في recordedLaterSlices.';
  }
  return summary;
}

// ===== تنبيهات تنظيمية (لا تُوصف مخالفة قانونية ولا استحقاقًا حتميًا) =====
export function executionAlerts({execution = null, slices = [], judgments = [], periods = [], ledger = [], receipts = [], allocations = [], differences = [], poas = [], actions = [], summary = null, today = todayIso()} = {}) {
  const alerts = [];
  const push = (code, severity, message, refs = {}) => alerts.push({code, severity, message, ...refs});
  if (!execution) return alerts;
  const entitlementTypes = entitlementKeys(slices);
  if (!execution.executionType) push('missing_execution_type', 'warn', 'نوع التنفيذ غير محدد — سجّله من بيانات التنفيذ.', {});
  if (!entitlementTypes.length) push('missing_value', 'info', 'لا توجد شرائح قيمة مسجلة لهذا التنفيذ بعد.', {});
  for (const type of entitlementTypes) {
    if (!judgments.some(judgment => String(judgment.entitlementType || '') === type && judgment.executionId === execution.id)) {
      push('slice_without_judgment', 'warn', `شريحة قيمة لنوع «${type}» بلا حكم مصدر مسجل.`, {entitlementType: type});
    }
  }
  for (const judgment of judgments) {
    if (!isIsoDate(judgment.effectiveFrom) && judgment.amount) push('judgment_without_effective_date', 'warn', `الحكم ${judgment.judgmentNumber || ''} له قيمة بلا تاريخ سريان مسجل — لا يُستنتج تلقائيًا.`.trim(), {judgmentId: judgment.id});
  }
  const pendingDifferences = differences.filter(row => IN_REVIEW_DIFFERENCE_STATUSES.includes(row.status));
  if (pendingDifferences.length) push('differences_awaiting_review', 'warn', `${pendingDifferences.length} فرق استحقاق ينتظر المراجعة والاعتماد.`, {count: pendingDifferences.length});
  const approvedNotPosted = differences.filter(row => row.accountingModel !== 'feas-v1' && row.status === 'APPROVED');
  if (approvedNotPosted.length) push('differences_approved_not_posted', 'info', `${approvedNotPosted.length} فرق معتمد لم يُرحَّل بعد إلى الحركات المالية.`, {count: approvedNotPosted.length});
  if (summary?.integrityBlocked) push('balance_read_limit', 'error', summary.integrityMessage || 'تعذر إظهار رصيد كامل بسبب حد القراءة الآمن.');
  if (summary && !summary.integrityBlocked) {
    if (summary.remaining > 0.005) push('balance_due', 'info', `رصيد غير مسدد بمقدار ${round2(summary.remaining)}.`, {amount: round2(summary.remaining)});
    if (summary.credit > 0.005) push('surplus_credit', 'info', `يوجد رصيد دائن منفصل بمقدار ${round2(summary.credit)}.`, {amount: round2(summary.credit)});
    if (summary.collected > 0 && summary.remaining > 0.005) push('partial_collection', 'info', 'تحصيل جزئي: يوجد محصل مع رصيد متبقٍ.', {collected: summary.collected, remaining: round2(summary.remaining)});
    if (summary.unallocated > 0.005) push('unallocated_collection', 'warn', `يوجد ${round2(summary.unallocated)} محصل لم يُخصَّص لفترة محددة بعد.`, {amount: round2(summary.unallocated)});
    const collectionRows = ledger.filter(row => isCollectionType(row.type) && !row.receiptId && !row.isDeleted);
    if (collectionRows.length) push('collection_without_receipt', 'info', `${collectionRows.length} حركة تحصيل بلا محضر مسجل.`, {count: collectionRows.length});
  }
  const receiptsWithoutEffect = receipts.filter(receipt => !ledger.some(row => row.receiptId === receipt.id && !row.isDeleted));
  if (receiptsWithoutEffect.length) push('receipt_without_result', 'warn', `${receiptsWithoutEffect.length} محضر تحصيل بلا حركة مالية مرتبطة (بلا نتيجة).`, {count: receiptsWithoutEffect.length});
  const petitionPending = actions.filter(action => action.kind === PETITION_KIND && !actions.some(other => other.kind === JUDICIAL_KIND && other.executionId === action.executionId));
  if (petitionPending.length) push('petition_without_judicial_number', 'info', 'رقم عرائض مسجل بلا رقم قضائي — إن كان المكتب يتابع هذا الأمر أضف الرقم القضائي.', {count: petitionPending.length});
  for (const poa of poas) {
    if (poa.status === 'draft') push('poa_draft', 'info', `توكيل ${poa.poaNumber || ''} بحالة مسودة ويحتاج متابعة.`.trim(), {poaId: poa.id});
    if (poa.toDate && poa.toDate < today && poa.status !== 'done' && poa.status !== 'cancelled') push('poa_expired_period', 'info', `فترة التوكيل ${poa.poaNumber || ''} انتهت بتاريخ ${poa.toDate} ولم تُغلق حالته.`, {poaId: poa.id, toDate: poa.toDate});
  }
  const allocatedByLedger = new Map();
  for (const allocation of allocations) if (!allocation.isDeleted && allocation.isActive !== false) allocatedByLedger.set(allocation.ledgerId, round2((allocatedByLedger.get(allocation.ledgerId) || 0) + num(allocation.amount)));
  for (const row of netLedger(ledger)) {
    if (!isCollectionType(row.type)) continue;
    const allocated = allocatedByLedger.get(row.id) || 0;
    if (allocated > row.netAmount + 0.001) push('allocation_conflict', 'warn', `تخصيص أكبر من حركة التحصيل بتاريخ ${row.date} (${allocated} مقابل ${row.netAmount}).`, {ledgerId: row.id});
  }
  const openTypes = new Set(entitlementTypes);
  if (openTypes.size && periods.length) {
    const lastPeriod = periods.slice().sort((a, b) => a.start.localeCompare(b.start)).at(-1);
    if (lastPeriod && lastPeriod.start < today) {
      const monthsLate = Math.max(0,
        (Number(today.slice(0, 4)) - Number(lastPeriod.start.slice(0, 4))) * 12
        + Number(today.slice(5, 7)) - Number(lastPeriod.start.slice(5, 7)));
      if (monthsLate >= 2 && summary && summary.remaining > 0.005) push('stale_follow_up', 'info', `آخر فترة محسوبة بدأت في ${lastPeriod.start} ولم يُسجَّل موقفها منذ نحو ${monthsLate} شهرًا.`, {lastPeriod: lastPeriod.key});
    }
  }
  if (execution.nextReviewDate && execution.nextReviewDate < today) push('review_overdue', 'info', `موعد المتابعة التنظيمي (${execution.nextReviewDate}) تجاوز تاريخ اليوم.`, {nextReviewDate: execution.nextReviewDate});
  if (execution.needsReview) push('record_needs_review', 'warn', 'هذا السجل يحتاج مراجعة بشرية لإكمال بياناته.', {reasons: (execution.reviewReasons || []).join('، ')});
  return alerts;
}

export {equationText, parsePeriodKey};
