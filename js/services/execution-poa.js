// =====================================================================
// توكيلات التنفيذ (Execution POAs) — أول مرة وإعادة توكيل
// ---------------------------------------------------------------------
// • كل مبلغ داخل التوكيل له مصدر ظاهر: رصيد سابق (فترة/محضر)، فترة جديدة
//   (شريحة/حكم)، فرق معتمد (سجل فرق)، مصروف فعلي (حركة مصروف)، دمغة يدخلها المستخدم.
// • لا يُضاف أي رسم أو دمغة أو مصروف لم يدخله المستخدم فعليًا.
// • لا ازدواج بين توكيلين: المكوّن الذي ضُم إلى توكيل يُعلَّم بـ poaId فلا يُقترح ثانية.
// =====================================================================
import {STORE} from '../db/schema.js';
import {transaction, request} from '../db/unit-of-work.js';
import {uid} from '../core/id.js';
import {Clock, localDate} from '../core/clock.js';
import {AppError, ERR} from '../core/errors.js';
import {events} from '../core/events.js';
import {num, round2, isIsoDate, money, POA_STATUS_LABELS, poaStatusLabel} from '../domain/execution.js';
import {balanceAsOf, buildEntitlementPeriods, outstandingPeriods, netLedger} from '../domain/entitlement-engine.js';
import {executionSlices, executionAllocations, executionLedgerRows, executionDifferences, executionPoaRows} from './execution.js';

const logRow = (office, entityType, entityId, action, summary, {fileId = null, metadata = {}} = {}) => {
  const row = {id: uid(), entityType, entityId, action, timestamp: Clock.now(), summary, metadata};
  if (fileId) row.fileId = fileId;
  return row;
};

/**
 * مسودة توكيل: كل بند بمصدره. لا شيء «يُخمَّن»؛ كل بند يظهر مع إمكانية استثنائه.
 * includePreviousBalance / includeDifferences / includeExpenses: قرار المستخدم.
 */
export async function buildPoaDraft(office, {executionId, previousPoaId = '', fromDate = '', toDate = '', includePreviousBalance = true, includeDifferences = true, includeExpenses = false, stampAmount = '', extraAmount = '', extraLabel = '', partyIds = [], previousBalanceOverride = ''} = {}) {
  const execution = await office.r.execution.get(executionId);
  if (!execution || execution.isDeleted) throw new AppError(ERR.NOT_FOUND, 'سجل التنفيذ غير موجود.');
  const previousPoa = previousPoaId ? await office.r.executionPOAs.get(previousPoaId) : null;
  const from = isIsoDate(fromDate) ? fromDate : (previousPoa?.toDate ? localDateAfter(previousPoa.toDate) : (execution.openedDate || localDate()));
  const to = isIsoDate(toDate) ? toDate : (execution.entitlementThroughDate || localDate());
  if (to < from) throw new AppError(ERR.VALIDATION, 'تاريخ نهاية فترة التوكيل قبل بدايتها.', {toDate: 'تاريخ غير صحيح'});
  const [slices, allocations, ledger, differences] = await Promise.all([
    executionSlices(office, executionId), executionAllocations(office, executionId),
    executionLedgerRows(office, executionId), executionDifferences(office, executionId)
  ]);
  const beforeFrom = balanceAsOf({slices, allocations, ledger, differences, asOf: localDateBefore(from), throughDate: localDateBefore(from), policy: execution.prorationPolicy});
  const derivedPreviousBalance = round2(Math.max(0, beforeFrom.remaining));
  // عند إعادة التوكيل: الرصيد السابق = إجمالي التوكيل السابق كما سُجِّل (أو قيمة يدوية),
  // والمكتب يرى أيضًا الرصيد المشتق ليقارن بنفسه — لا دمج خفي بين الرقمين.
  const previousBalanceValue = previousBalanceOverride !== undefined && previousBalanceOverride !== null && previousBalanceOverride !== ''
    ? round2(num(previousBalanceOverride))
    : (previousPoa ? round2(num(previousPoa.total)) : derivedPreviousBalance);
  const build = buildEntitlementPeriods({slices, to, policy: execution.prorationPolicy});
  const periodRows = build.periods.filter(period => period.start >= from && period.start <= to);
  const periodTotal = round2(periodRows.reduce((sum, period) => sum + period.finalAmount, 0));
  const periodAllocations = allocations.filter(allocation => allocation.isActive !== false && !allocation.isDeleted && periodRows.some(period => period.key === allocation.periodKey));
  const collectedInPeriod = round2(periodAllocations.reduce((sum, allocation) => sum + num(allocation.amount), 0));
  const availableDifferences = differences.filter(row => ['APPROVED', 'POSTED'].includes(row.status) && !row.poaId && round2(num(row.differenceAmount)) > 0.001);
  const differenceTotal = round2(availableDifferences.reduce((sum, row) => sum + num(row.differenceAmount), 0));
  const expenseRows = netLedger(ledger).filter(row => row.category === 'expense' && row.includeInPoa && !row.poaId);
  const expenseDrawer = expenseRows;
  const expenseTotal = round2(expenseDrawer.reduce((sum, row) => sum + row.netAmount, 0));
  const stamp = round2(num(stampAmount));
  const extra = round2(num(extraAmount));
  const lines = [
    {
      key: 'previousBalance', label: previousPoa ? `رصيد التوكيل السابق ${previousPoa.poaNumber || ''} حتى ${localDateBefore(from)}`.trim() : 'رصيد سابق حتى ' + localDateBefore(from),
      amount: includePreviousBalance ? previousBalanceValue : 0,
      included: Boolean(includePreviousBalance), sourceType: 'balance', sourceIds: previousPoa ? [previousPoa.id] : [],
      detail: `${previousPoa ? `إجمالي التوكيل السابق: ${round2(num(previousPoa.total))}` : `الرصيد المشتق في ${localDateBefore(from)}`} · الرصيد المشتق في ${localDateBefore(from)}: ${derivedPreviousBalance}`
    },
    ...periodRows.map(period => ({
      key: `period:${period.key}`, label: `فترة ${period.start} → ${period.end}`, amount: round2(period.finalAmount), included: true,
      sourceType: 'period', sourceIds: [period.key], detail: `${period.equation}${period.judgmentId ? ' — حكم: ' + period.judgmentId : ''}`
    })),
    {
      key: 'differences', label: `فروق أحكام معتمدة (${availableDifferences.length})`, amount: includeDifferences ? differenceTotal : 0,
      included: Boolean(includeDifferences), sourceType: 'difference', sourceIds: availableDifferences.map(row => row.id),
      detail: availableDifferences.map(row => `${row.periodKey}: ${row.oldValue} → ${row.newValue} = ${row.differenceAmount}`).join(' · ')
    },
    {
      key: 'expenses', label: `مصروفات فعلية مُعلَّمة بالدخول في التوكيل (${expenseDrawer.length})`, amount: includeExpenses ? expenseTotal : 0,
      included: Boolean(includeExpenses), sourceType: 'expense', sourceIds: expenseDrawer.map(row => row.id),
      detail: expenseDrawer.map(row => `${row.date} ${row.type}: ${row.netAmount}`).join(' · ')
    }
  ];
  if (stamp > 0) lines.push({key: 'stamp', label: 'دمغة (قيمة فعلية أدخلها المستخدم)', amount: stamp, included: true, sourceType: 'manual', sourceIds: [], detail: 'قيمة يدوية — لا يقدّرها البرنامج'});
  if (extra > 0) lines.push({key: 'extra', label: extraLabel || 'مبلغ آخر أدخله المستخدم', amount: extra, included: true, sourceType: 'manual', sourceIds: [], detail: 'قيمة يدوية'});
  const included = lines.filter(line => line.included && line.amount > 0);
  const total = round2(included.reduce((sum, line) => sum + line.amount, 0));
  return {
    execution, previousPoa, previousPoaId: previousPoa?.id || '', fromDate: from, toDate: to, lines, included,
    totals: {
      previousBalance: round2(lines.find(line => line.key === 'previousBalance')?.amount || 0),
      derivedPreviousBalance,
      periods: periodTotal, collectedInPeriod, differences: differenceTotal, expenses: expenseTotal, stamp, extra, total,
      newPeriodValue: periodTotal
    },
    periodRows,
    equations: [
      `فترة التوكيل: ${from} → ${to} (${periodRows.length} فترة) = ${periodTotal}`,
      `الرصيد السابق المُدرج: ${previousBalanceValue}${previousPoa ? ' (إجمالي التوكيل السابق)' : ''} — الرصيد المشتق في ${localDateBefore(from)}: ${derivedPreviousBalance}`,
      `فروق معتمدة متاحة: ${differenceTotal}`,
      `مصروفات فعلية قابلة للإدراج: ${expenseTotal}`,
      `إجمالي التوكيل بإدراجك: ${total}`
    ]
  };
}
const localDateBefore = day => { const d = new Date(`${day}T00:00:00`); d.setDate(d.getDate() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` };
const localDateAfter = day => { const d = new Date(`${day}T00:00:00`); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` };

/** حفظ التوكيل: يُخزَّن تفصيل المصادر كما رآه المستخدم، وتُعلَّم المكونات المُدرجة بمعرّف التوكيل. */
/** رقم توكيل داخلي متسلسل عند عدم إدخال رقم مرجعي — يُستخدم للعرض والبحث والطباعة. */
async function nextPoaNumber(tx, year) {
  const counters = tx.objectStore(STORE.fileNumberCounters);
  const id = `executionPoa:${year}`;
  const counter = await request(counters.get(id));
  const next = (counter?.lastNumber || 0) + 1;
  await request(counters.put({id, year, kind: 'executionPoa', lastNumber: next, updatedAt: Clock.now()}));
  return `POA-${year}-${String(next).padStart(4, '0')}`;
}

export async function saveExecutionPoa(office, input, id = null) {
  // يقبل مسودة buildPoaDraft كما هي (تحمل كائن التنفيذ وتجميعات totals) أو مدخلًا مباشرًا بمعرّف التنفيذ.
  if (input.totals && typeof input.totals === 'object') {
    input = {...input, previousBalance: input.previousBalance ?? input.totals.previousBalance, baseAmount: input.baseAmount ?? input.totals.newPeriodValue, differencesAmount: input.differencesAmount ?? input.totals.differences, expensesAmount: input.expensesAmount ?? input.totals.expenses, stampAmount: input.stampAmount ?? input.totals.stamp, total: input.total ?? input.totals.total};
  }
  const executionId = input.executionId || input.execution?.id || '';
  const previousPoaId = input.previousPoaId || input.previousPoa?.id || '';
  const execution = await office.r.execution.get(executionId);
  if (!execution || execution.isDeleted) throw new AppError(ERR.NOT_FOUND, 'سجل التنفيذ غير موجود.');
  const old = id ? await office.r.executionPOAs.get(id) : null;
  if (id && !old) throw new AppError(ERR.NOT_FOUND, 'التوكيل غير موجود.');
  if (!(num(input.total) > 0)) throw new AppError(ERR.VALIDATION, 'إجمالي التوكيل يجب أن يكون أكبر من صفر (اختر مكونًا واحدًا على الأقل أو أدخل دمغة/مبلغًا فعليًا).', {total: 'مطلوب'});
  const previousPoa = previousPoaId ? await office.r.executionPOAs.get(previousPoaId) : null;
  if (previousPoaId && !previousPoa) throw new AppError(ERR.VALIDATION, 'التوكيل السابق المحدد غير موجود.');
  if (previousPoa && previousPoa.executionId !== executionId) throw new AppError(ERR.VALIDATION, 'التوكيل السابق يتبع تنفيذًا آخر.');
  const now = Clock.now();
  const siblings = await executionPoaRows(office, executionId);
  let poaNumber = String(input.poaNumber || input.reference || '').trim();
  const row = {
    ...(old || {}), ...input,
    id: id || uid(),
    executionId,
    fileId: execution.fileId || '',
    clientId: input.clientId || execution.clientId || '',
    poaNumber: String(input.poaNumber || input.reference || '').trim(),
    reference: String(input.reference || '').trim(),
    kind: previousPoaId ? 'reissue' : (input.kind || 'first'),
    previousPoaId: previousPoaId || '',
    date: isIsoDate(input.date) ? input.date : localDate(),
    fromDate: isIsoDate(input.fromDate) ? input.fromDate : '',
    toDate: isIsoDate(input.toDate) ? input.toDate : '',
    baseAmount: round2(num(input.baseAmount)),
    previousBalance: round2(num(input.previousBalance)),
    differencesAmount: round2(num(input.differencesAmount)),
    expensesAmount: round2(num(input.expensesAmount)),
    stampAmount: round2(num(input.stampAmount)),
    total: round2(num(input.total)),
    judgmentIds: Array.isArray(input.judgmentIds) ? [...new Set(input.judgmentIds.filter(Boolean))] : [],
    partyIds: Array.isArray(input.partyIds) ? [...new Set(input.partyIds.filter(Boolean))] : [],
    lines: Array.isArray(input.lines) ? input.lines.map(line => ({key: line.key, label: line.label, amount: round2(num(line.amount)), sourceType: line.sourceType || '', sourceIds: Array.isArray(line.sourceIds) ? line.sourceIds : [], detail: line.detail || ''})) : [],
    status: input.status || 'active',
    sequence: input.sequence ? Number(input.sequence) : (old?.sequence || siblings.length + 1),
    notes: String(input.notes || '').trim(),
    createdAt: old?.createdAt || now,
    updatedAt: now,
    version: (old?.version || 0) + 1,
    isDeleted: old?.isDeleted || false
  };
  const differenceIds = (input.lines || []).filter(line => line.sourceType === 'difference').flatMap(line => line.sourceIds || []);
  const expenseIds = (input.lines || []).filter(line => line.sourceType === 'expense').flatMap(line => line.sourceIds || []);
  await transaction(office.ctx, [STORE.executionPOAs, STORE.differenceRecords, STORE.executionLedger, STORE.fileNumberCounters, STORE.activityLog], async tx => {
    if (!poaNumber) poaNumber = await nextPoaNumber(tx, String(row.date || '').slice(0, 4) || String(Clock.today()).slice(0, 4));
    row.poaNumber = poaNumber;
    await request(tx.objectStore(STORE.executionPOAs).put(row));
    // تعليم المكونات المُدرجة: يمنع إدراجها في توكيل لاحق (لا ازدواج)
    if (differenceIds.length) {
      const store = tx.objectStore(STORE.differenceRecords);
      for (const differenceId of differenceIds) {
        const difference = await request(store.get(differenceId));
        if (difference && !difference.isDeleted) await request(store.put({...difference, poaId: row.id, updatedAt: now, version: (difference.version || 0) + 1}));
      }
    }
    if (expenseIds.length) {
      const store = tx.objectStore(STORE.executionLedger);
      for (const ledgerId of expenseIds) {
        const entry = await request(store.get(ledgerId));
        if (entry && !entry.isDeleted) await request(store.put({...entry, poaId: row.id, updatedAt: now, version: (entry.version || 0) + 1}));
      }
    }
    await request(tx.objectStore(STORE.activityLog).add(logRow(office, STORE.executionPOAs, row.id, id ? 'update' : 'create',
      `${id ? 'تحديث' : 'إنشاء'} ${row.kind === 'reissue' ? 'إعادة توكيل' : 'توكيل'} ${row.poaNumber || ''} للفترة ${row.fromDate} → ${row.toDate} بإجمالي ${row.total}`,
      {fileId: row.fileId})));
  });
  events.emit('entity:changed', {entityType: STORE.executionPOAs, id: row.id});
  return row;
}

/** إعادة توكيل: مسودة جاهزة تربط التوكيل السابق وتُظهر مصدر كل مبلغ. */
export async function reissuePoaDraft(office, previousPoaId, {toDate = '', ...rest} = {}) {
  const previous = await office.r.executionPOAs.get(previousPoaId);
  if (!previous || previous.isDeleted) throw new AppError(ERR.NOT_FOUND, 'التوكيل السابق غير موجود.');
  return buildPoaDraft(office, {executionId: previous.executionId, previousPoaId, toDate, includePreviousBalance: true, includeDifferences: true, ...rest});
}

export async function poaDetail(office, poaId) {
  const poa = await office.r.executionPOAs.get(poaId);
  if (!poa || poa.isDeleted) throw new AppError(ERR.NOT_FOUND, 'التوكيل غير موجود.');
  const previous = poa.previousPoaId ? await office.r.executionPOAs.get(poa.previousPoaId) : null;
  const allocations = await executionAllocations(office, poa.executionId);
  const collectedInWindow = round2(allocations.filter(allocation => allocation.isActive !== false && !allocation.isDeleted && allocation.periodKey >= `${poa.fromDate}` && allocation.createdAt && String(allocation.createdAt).slice(0, 10) <= poa.toDate).reduce((sum, allocation) => sum + num(allocation.amount), 0));
  return {poa, previous, statusLabel: poaStatusLabel(poa.status), collectedInWindow, lines: poa.lines || [], sources: (poa.lines || []).map(line => ({...line, amountLabel: money(line.amount)}))};
}

export {POA_STATUS_LABELS, POA_STATUS_LABELS as POA_LABELS, outstandingPeriods};
