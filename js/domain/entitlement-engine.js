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
  num, round2, equationText, isIsoDate, todayIso, maxIso, minIso, addDaysIso,
  periodStartFor, nextPeriodStart, periodEndFor, periodKeyOf, parsePeriodKey,
  enumeratePeriods, daysBetweenInclusive, DAY_MS, utcOf, isoOfUtc,
  LEDGER_CATEGORY, isExpenseType, isCollectionType, DEFAULT_PRORATION,
  IN_REVIEW_DIFFERENCE_STATUSES, ACTIVE_DIFFERENCE_STATUSES, PETITION_KIND, JUDICIAL_KIND
} from './execution.js';

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

/**
 * تغطية شريحة لفترة: أيام التقاطع الكاملة + النسبة + المبلغ ومعادلته.
 * policy='periodStart' (سلوك بديل يختاره المكتب) يعتمد قيمة الفترة كاملة إذا كانت الشريحة سارية في بدايتها.
 */
export function coverageOfPeriod(slice, periodStart, periodEnd, policy = DEFAULT_PRORATION) {
  const sliceStart = slice.startDate || periodStart;
  const sliceEnd = slice.endDate || '9999-12-31';
  const start = maxIso(periodStart, sliceStart);
  const end = minIso(periodEnd, sliceEnd);
  const periodDays = Math.max(1, daysBetweenInclusive(periodStart, periodEnd));
  if (!isIsoDate(start) || !isIsoDate(end) || end < start) {
    return {covered: false, coveredDays: 0, periodDays, ratio: 0, amount: 0, prorated: false, start: '', end: ''};
  }
  const coveredDays = daysBetweenInclusive(start, end);
  const ratio = coveredDays / periodDays;
  const prorated = ratio < 0.9999;
  // سياسة «بداية الفترة» خيار يحدده المكتب: إذا كانت الشريحة سارية في بداية الفترة تُحتسب كاملة.
  const fullPeriod = policy === 'periodStart' && sliceStart <= periodStart;
  return {
    covered: true, coveredDays, periodDays, ratio, prorated, start, end,
    amount: fullPeriod ? round2(num(slice.amount)) : round2(num(slice.amount) * ratio)
  };
}

/** قيمة شريحة لفترة واحدة (نفس منطق محرك الفترات، مكشوفة للشرح والاختبار). */
export function sliceValueForPeriod(slice, period = {}, {policy = DEFAULT_PRORATION} = {}) {
  if (!slice) return {covered: false, amount: 0, prorated: false};
  if (!sliceIsPeriodic(slice)) {
    const days = daysBetweenInclusive(slice.startDate || period.start, slice.endDate || slice.startDate || period.end);
    return {covered: true, amount: round2(num(slice.amount)), prorated: false, coveredDays: days, periodDays: days, ratio: 1};
  }
  const coverage = coverageOfPeriod(slice, period.start, period.end, policy);
  return {...coverage, amount: coverage.amount};
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
  const remaining = round2(final - paid);
  const originalOutstanding = round2(Math.max(0, original - paid));
  const differencePart = round2(remaining - originalOutstanding);
  return {
    finalAmount: final, originalAmount: original, collected: paid, remaining, originalOutstanding, differencePart,
    equation: `${final} − ${paid} = ${remaining} = رصيد أصلي ${originalOutstanding} + فرق ${differencePart}`
  };
}

/** نوع الاستحقاق: مبلغ ثابت (لا يتكرر) أم دوري. */
export const sliceIsPeriodic = slice => (slice?.valueType || 'periodic') !== 'fixed';

const UNIT_LABELS = Object.freeze({daily: 'يوم', weekly: 'أسبوع', semiMonthly: 'نصف شهر', monthly: 'شهر', yearly: 'سنة', custom: 'دورة'});
/** نهاية الشريحة الفعلية: صريحة إن سُجلت، وإلا اليوم السابق لبداية الشريحة اللاحقة. */
function effectiveEnds(usable) {
  // ترتيب: تاريخ السريان ثم الأقدم تسجيلًا. كل شريحة تنتهي فعليًا في اليوم السابق لبداية
  // الشريحة التالية في الترتيب — حتى لو اتحد تاريخ البداية (حكم لاحق بنفس تاريخ السريان):
  // عندها تُستبعد الشريحة الأقدم كليًا من ذلك التاريخ ولا يُجمع المبلغان (منع الازدواج).
  const byStart = usable.slice().sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)) || byCreated(a, b));
  const map = new Map();
  byStart.forEach((slice, index) => {
    const next = byStart[index + 1];
    const explicit = slice.endDate || '';
    const derived = next ? addDaysIso(next.startDate, -1) : '';
    map.set(slice.id, explicit && derived ? minIso(explicit, derived) : (explicit || derived || '9999-12-31'));
  });
  return map;
}

/**
 * بناء فترات الاستحقاق لنوع استحقاق واحد:
 * - المبلغ الثابت = فترة واحدة تبدأ بتاريخ سريانه ولا تتكرر.
 * - المبلغ الدوري = فترات متتالية بتوليد كسول ومحدود، ونهاية كل شريحة تُشتق
 *   من الشريحة اللاحقة (لا تُعدَّل الشريحة القديمة)، فحكم يوليو ينهي سريان
 *   شريحة يناير في 30 يونيو دون أي كتابة على السجل القديم.
 */
export function periodsForEntitlement({slices = [], entitlementType = '', from = '', to = '', asOf = '', maxPeriods = 1200, policy = DEFAULT_PRORATION, mode = 'knowledge'} = {}) {
  const usable = slicesOfEntitlement(eligibleSlices(slices, asOf, {mode}), entitlementType);
  if (!usable.length) return {periods: [], truncated: false, range: {from: '', to: ''}};
  const horizon = to || asOf || todayIso();
  const ends = effectiveEnds(usable);
  const startDates = usable.map(slice => slice.startDate).filter(isIsoDate).sort();
  const rangeFrom = from || startDates[0];
  const rangeTo = horizon;
  const contributions = [];
  let truncated = false;
  for (const raw of usable) {
    // شريحة «مؤطَّرة»: نهايتها الفعلية هي اليوم السابق لبداية الشريحة اللاحقة، بلا أي كتابة على السجل الأصلي.
    const slice = {...raw, endDate: minIso(raw.endDate || '9999-12-31', ends.get(raw.id) || '9999-12-31')};
    const sliceFrom = maxIso(slice.startDate, rangeFrom);
    const sliceTo = minIso(slice.endDate, rangeTo);
    if (!isIsoDate(sliceFrom) || !isIsoDate(sliceTo) || sliceTo < sliceFrom) continue;
    if (!sliceIsPeriodic(slice)) {
      contributions.push({
        slice, start: slice.startDate, end: slice.endDate || slice.startDate, periodicity: 'fixed',
        coveredDays: daysBetweenInclusive(slice.startDate, slice.endDate || slice.startDate),
        periodDays: daysBetweenInclusive(slice.startDate, slice.endDate || slice.startDate),
        prorated: false, amount: round2(slice.amount)
      });
      continue;
    }
    const walk = enumeratePeriods({from: sliceFrom, to: sliceTo, periodicity: slice.periodicity, customDays: slice.customDays, anchor: slice.anchor || slice.startDate, maxPeriods});
    if (walk.truncated) truncated = true;
    for (const period of walk.periods) {
      const coverage = coverageOfPeriod(slice, period.start, period.end, policy);
      if (!coverage.covered || !(coverage.amount > 0)) continue;
      contributions.push({
        slice, start: period.start, end: period.end,
        periodicity: slice.periodicity || 'monthly',
        coveredDays: coverage.coveredDays, periodDays: coverage.periodDays,
        prorated: coverage.prorated, amount: coverage.amount, coverage
      });
    }
  }
  const grouped = new Map();
  for (const item of contributions) {
    const key = periodKeyOf(entitlementType, item.start);
    const group = grouped.get(key) || {key, entitlementType, start: item.start, end: item.end, items: []};
    group.items.push(item);
    group.start = minIso(group.start, item.start);
    group.end = maxIso(group.end, item.end);
    grouped.set(key, group);
  }
  const list = [...grouped.values()].map(group => {
    const items = group.items.slice().sort(byCreated.slice ? (a, b) => byCreated(a.slice, b.slice) : undefined);
    const finalOne = items[items.length - 1];
    const finalSlice = finalOne.slice;
    const finalAmount = round2(items.reduce((sum, item) => sum + item.amount, 0));
    // القيمة الأصلية: ما كانت عليه الفترة قبل أي حكم لاحق (أول شريحة عرفتها الفترة، بتغطيتها الخام)
    const originals = usable
      .filter(slice => slice.startDate <= group.end && (slice.endDate || '9999-12-31') >= group.start)
      .sort(byCreated);
    const originalSlice = originals[0] || finalSlice;
    let originalAmount;
    if (!sliceIsPeriodic(originalSlice)) originalAmount = round2(originalSlice.amount);
    else {
      const coverage = coverageOfPeriod(originalSlice, group.start, group.end, policy);
      originalAmount = coverage.covered ? coverage.amount : round2(num(originalSlice.amount) * (group.start >= originalSlice.startDate ? 1 : 0));
    }
    const unit = UNIT_LABELS[finalOne.periodicity] || 'فترة';
    const itemEquations = items.map(item => item.prorated
      ? `${item.coveredDays} من ${item.periodDays} يومًا × ${round2(num(item.slice.amount))} = ${item.amount}`
      : `1 ${UNIT_LABELS[item.periodicity] || 'فترة'} × ${round2(num(item.slice.amount))} = ${item.amount}`);
    const equation = items.length > 1
      ? `${itemEquations.join(' + ')} = ${finalAmount}`
      : itemEquations[0];
    return {
      key: group.key,
      entitlementType,
      start: group.start,
      end: group.end,
      periodicity: finalOne.periodicity || 'monthly',
      sliceId: finalSlice.id,
      judgmentId: finalSlice.judgmentId,
      partyId: finalSlice.partyId || '',
      originalSliceId: originalSlice.id,
      originalJudgmentId: originalSlice.judgmentId,
      finalAmount,
      originalAmount: round2(originalAmount),
      finalValue: round2(num(finalSlice.amount)),
      originalValue: round2(num(originalSlice.amount)),
      prorated: items.some(item => item.prorated),
      coveredDays: finalOne.coveredDays,
      periodDays: finalOne.periodDays,
      unit,
      equation,
      parts: items.map(item => ({sliceId: item.slice.id, amount: item.amount, prorated: item.prorated, coveredDays: item.coveredDays, periodDays: item.periodDays})),
      differenceEquation: Math.abs(finalAmount - round2(originalAmount)) > 0.004
        ? `${finalAmount} − ${round2(originalAmount)} = ${round2(finalAmount - round2(originalAmount))}`
        : ''
    };
  }).sort((a, b) => a.start.localeCompare(b.start));
  return {periods: list, truncated, range: {from: rangeFrom, to: rangeTo}};
}

/** فترات كل أنواع الاستحقاق داخل التنفيذ. */
export function buildEntitlementPeriods({slices = [], asOf = '', from = '', to = '', maxPeriods = 1200, policy = DEFAULT_PRORATION, mode = 'knowledge'} = {}) {
  const keys = entitlementKeys(eligibleSlices(slices, asOf, {mode}));
  const periods = [];
  let truncated = false;
  for (const entitlementType of keys) {
    const build = periodsForEntitlement({slices, entitlementType, from, to, asOf, maxPeriods, policy, mode});
    periods.push(...build.periods);
    if (build.truncated) truncated = true;
  }
  periods.sort((a, b) => a.start.localeCompare(b.start) || String(a.entitlementType).localeCompare(String(b.entitlementType)));
  return {periods, truncated, entitlementKeys: keys};
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
  for (const period of periods) {
    map.set(period.key, {
      periodKey: period.key,
      entitlementType: period.entitlementType,
      start: period.start, end: period.end,
      dueDate: period.start,
      finalAmount: round2(period.finalAmount),
      originalAmount: round2(period.originalAmount),
      originalValue: period.originalValue,
      finalValue: period.finalValue,
      sliceId: period.sliceId, judgmentId: period.judgmentId,
      originalSliceId: period.originalSliceId, originalJudgmentId: period.originalJudgmentId,
      equation: period.equation, prorated: period.prorated,
      // المستحق المرتبط بالشريحة (إن سُجّل): يجعل التخصيص «حسب المستحق» ممكنًا بلا تخمين
      partyId: period.partyId || '',
      allocated: 0, allocationIds: [], parties: new Set(period.partyId ? [period.partyId] : [])
    });
  }
  for (const allocation of allocations) {
    if (allocation.isDeleted || allocation.isActive === false) continue;
    const entry = map.get(allocation.periodKey);
    if (!entry) continue;
    entry.allocated = round2(entry.allocated + num(allocation.amount));
    entry.allocationIds.push(allocation.id);
    if (allocation.executionPartyId) entry.parties.add(allocation.executionPartyId);
  }
  const list = [...map.values()].map(entry => ({
    ...entry,
    parties: [...entry.parties],
    remaining: round2(entry.finalAmount - entry.allocated),
    originalOutstanding: round2(Math.max(0, entry.originalAmount - entry.allocated)),
    differencePart: round2((entry.finalAmount - entry.allocated) - Math.max(0, entry.originalAmount - entry.allocated)),
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
export function allocationPlan({outstanding = [], amount = 0, method = 'DIRECT', targets = [], partyId = ''} = {}) {
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
  } else if (method === 'FIFO') {
    let left = money;
    for (const row of rows.slice().sort((a, b) => a.start.localeCompare(b.start))) {
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
export function analyzeSliceImpact({slices = [], newSlice, allocations = [], ledger = [], asOf = '', throughDate = '', maxPeriods = 1200, policy = DEFAULT_PRORATION} = {}) {
  if (!newSlice) return {rows: [], totals: {oldValue: 0, newValue: 0, collected: 0, difference: 0, originalOutstanding: 0, remaining: 0}};
  const before = slices.filter(slice => slice.id !== newSlice.id);
  const entitlementType = newSlice.entitlementType;
  const from = (slicesOfEntitlement(before, entitlementType)[0]?.startDate) || newSlice.startDate;
  const to = newSlice.endDate || throughDate || asOf || maxIso(todayIso(), newSlice.startDate);
  const beforeBuild = periodsForEntitlement({slices: before, entitlementType, from, to, asOf, maxPeriods, policy});
  const afterBuild = periodsForEntitlement({slices: [...before, newSlice], entitlementType, from, to, asOf, maxPeriods, policy});
  const afterByKey = new Map(afterBuild.periods.map(period => [period.key, period]));
  const beforeByKey = new Map(beforeBuild.periods.map(period => [period.key, period]));
  const allocationByKey = new Map();
  for (const allocation of allocations) {
    if (allocation.isDeleted || allocation.isActive === false) continue;
    allocationByKey.set(allocation.periodKey, round2((allocationByKey.get(allocation.periodKey) || 0) + num(allocation.amount)));
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
export function balanceSummary({periods = [], allocations = [], ledger = [], differences = [], asOf = ''} = {}) {
  const inRange = rows => rows.filter(row => !row.isDeleted && (!asOf || !row.date || String(row.date) <= asOf));
  const totals = ledgerTotals(inRange(ledger));
  const outstanding = outstandingPeriods({periods, allocations: allocations.filter(a => !a.isDeleted && a.isActive !== false), differences});
  const collected = totals.collected;
  const unallocated = round2(collected - outstanding.totals.allocated);
  const finalEntitlement = outstanding.totals.finalEntitlement;
  const remaining = round2(finalEntitlement - collected);
  const analytical = unallocated > 0.001 ? analyticalAllocation({outstanding: outstanding.periods, unallocated}) : {lines: [], remainder: 0, applied: 0};
  const originalOutstanding = round2(outstanding.totals.originalOutstanding + analytical.applied);
  const differencePart = round2(remaining - originalOutstanding);
  const approvedDiff = outstanding.totals.approvedDiff;
  const pendingDiff = outstanding.totals.pendingDiff;
  const postedDiff = round2(inRange(differences).filter(d => d.status === 'POSTED').reduce((sum, d) => sum + num(d.differenceAmount), 0));
  const equations = [
    `الاستحقاق النهائي: ${finalEntitlement} (${periods.length} فترة)`,
    `المحصل: ${collected}`,
    `الرصيد: ${finalEntitlement} − ${collected} = ${remaining}`,
    `تفكيك الرصيد: رصيد أصلي ${originalOutstanding} + فروق أحكام ${differencePart} = ${remaining}`
  ];
  if (unallocated > 0.001) equations.push(`يوجد ${unallocated} محصل لم يُخصَّص لفترة بعد؛ يُعرض تحليليًا على الأقدم ويحتاج تخصيصًا صريحًا.`);
  if (pendingDiff) equations.push(`فروق تنتظر المراجعة/الاعتماد: ${pendingDiff} (لا تُعد ملتزمًا معتمدًا قبل قرار المستخدم).`);
  return {
    asOf: asOf || '',
    finalEntitlement,
    originalEntitlement: outstanding.totals.originalEntitlement,
    collected,
    remaining,
    originalOutstanding,
    differencePart,
    differences: {approved: approvedDiff, pending: pendingDiff, posted: postedDiff},
    unallocated,
    analyticalAllocation: analytical,
    expenses: totals.expenses,
    expensesInPoa: totals.expensesInPoa,
    differencesPostedInLedger: totals.differencesPosted,
    periods: outstanding.periods,
    periodCount: periods.length,
    equations,
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
  const allocationsByPeriod = new Map();
  for (const allocation of allocations) {
    if (allocation.isDeleted || allocation.isActive === false) continue;
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
      detail: period.equation,
      meta: {
        periodKey: period.periodKey, entitlementType: period.entitlementType,
        sliceId: period.sliceId, judgmentId: period.judgmentId,
        judgmentLabel: judgmentById.get(period.judgmentId)?.judgmentNumber || '',
        sliceLabel: sliceById.get(period.sliceId) ? `${sliceById.get(period.sliceId).amount} من ${sliceById.get(period.sliceId).startDate}` : ''
      },
      children: [
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
  const receiptNodes = receipts.map(receipt => ({
    id: `receipt:${receipt.id}`,
    label: `محضر ${receipt.receiptNumber || ''} — ${receipt.date || ''}`.trim(),
    amount: round2(num(receipt.amount)),
    detail: `${receipt.receiptType || ''} · ${receipt.allocationMethod || ''}`.trim(),
    meta: {receiptId: receipt.id, ledgerId: receipt.ledgerId || ''},
    children: (allocationsByPeriod.size ? allocations.filter(a => a.receiptId === receipt.id) : []).map(allocation => ({
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
          ...periodNodes
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
export function balanceAsOf({slices = [], allocations = [], ledger = [], differences = [], asOf = '', maxPeriods = 1200, policy = DEFAULT_PRORATION, throughDate = '', mode = 'knowledge'} = {}) {
  const cutoff = asOf || todayIso();
  const end = `${cutoff}T23:59:59.999Z`;
  const effective = mode === 'effective';
  const knownSlices = eligibleSlices(slices, cutoff, {mode: effective ? 'effective' : 'knowledge'});
  const build = buildEntitlementPeriods({slices: knownSlices, asOf: cutoff, to: throughDate || cutoff, maxPeriods, policy, mode});
  const ledgerById = new Map(ledger.map(row => [row.id, row]));
  const knownAllocations = allocations.filter(row => {
    if (row.isDeleted || row.isActive === false) return false;
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
  const summary = balanceSummary({periods: build.periods, allocations: knownAllocations, ledger: knownLedger, differences: knownDifferences, asOf: cutoff});
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
    if (summary.remaining < -0.005) push('negative_balance', 'warn', `رصيد سالب (تحصيل يزيد على الاستحقاق المسجل) بمقدار ${round2(-summary.remaining)} — راجع التحصيلات والتخصيص.`, {amount: round2(-summary.remaining)});
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
      const monthsLate = Math.round((utcOf(today) - utcOf(lastPeriod.start)) / DAY_MS / 30);
      if (monthsLate >= 2 && summary && summary.remaining > 0.005) push('stale_follow_up', 'info', `آخر فترة محسوبة بدأت في ${lastPeriod.start} ولم يُسجَّل موقفها منذ نحو ${monthsLate} شهرًا.`, {lastPeriod: lastPeriod.key});
    }
  }
  if (execution.nextReviewDate && execution.nextReviewDate < today) push('review_overdue', 'info', `موعد المتابعة التنظيمي (${execution.nextReviewDate}) تجاوز تاريخ اليوم.`, {nextReviewDate: execution.nextReviewDate});
  if (execution.needsReview) push('record_needs_review', 'warn', 'هذا السجل يحتاج مراجعة بشرية لإكمال بياناته.', {reasons: (execution.reviewReasons || []).join('، ')});
  return alerts;
}

export {equationText, isoOfUtc, parsePeriodKey, nextPeriodStart, periodEndFor, periodStartFor, DAY_MS};
