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
import {FEAS_MODEL, FEAS_RECOGNIZED_STATES, calculateFeasBalance} from '../domain/execution-feas.js';
import {addCivilDays} from '../domain/execution-calendar.js';
import {addMinor, fromMinorUnits, sumMinor, toMinorUnits} from '../domain/execution-money.js';
import {executionIntegrityReport as getFeasIntegrityReport} from './execution-feas.js';
import {executionSlices, executionAllocations, executionLedgerRows, executionDifferences, executionPoaRows} from './execution.js';

const logRow = (office, entityType, entityId, action, summary, {fileId = null, metadata = {}} = {}) => {
  const row = {id: uid(), entityType, entityId, action, timestamp: Clock.now(), summary, metadata};
  if (fileId) row.fileId = fileId;
  return row;
};

async function buildFeasPoaDraft(office, {execution, executionId, previousPoaId = '', fromDate = '', toDate = '', includePreviousBalance = true, includeExpenses = false, stampAmount = '', extraAmount = '', extraLabel = ''}) {
  const limit = 2000;
  const [periods, allocations, ledger, differences, poas, obligations] = await Promise.all([
    office.r.executionPeriods.byIndex('executionId', executionId, limit + 1),
    office.r.executionAllocations.byIndex('executionId', executionId, limit + 1),
    office.r.executionLedger.byIndex('executionId', executionId, limit + 1),
    office.r.differenceRecords.byIndex('executionId', executionId, limit + 1),
    office.r.executionPOAs.byIndex('executionId', executionId, limit + 1),
    office.r.executionObligations.byIndex('executionId', executionId, limit + 1)
  ]);
  const overflow = [['فترات الاعتراف', periods], ['التخصيصات', allocations], ['الحركات', ledger], ['الفروق', differences], ['التوكيلات', poas], ['الالتزامات', obligations]].find(([, rows]) => rows.length > limit);
  if (overflow) throw new AppError(ERR.CONFLICT, `تجاوز عدد ${overflow[0]} حد القراءة الآمن؛ لم تُبنَ لقطة توكيل من بيانات جزئية.`);
  const integrity = await getFeasIntegrityReport(office, executionId);
  const integrityError = integrity.issues.find(issue => issue.severity === 'error');
  if (integrityError) throw new AppError(ERR.CONFLICT, `تعذر إنشاء لقطة توكيل FEAS بسبب فحص سلامة: ${integrityError.reason}`);
  const previousPoa = previousPoaId ? await office.r.executionPOAs.get(previousPoaId) : null;
  if (previousPoaId && (!previousPoa || previousPoa.isDeleted || previousPoa.executionId !== executionId)) throw new AppError(ERR.VALIDATION, 'التوكيل السابق المحدد غير موجود لهذا التنفيذ.');
  const recognized = periods.filter(row => !row.isDeleted && FEAS_RECOGNIZED_STATES.includes(row.status)).sort((a, b) => String(a.fromDate).localeCompare(String(b.fromDate)));
  let suggestedFrom = recognized[0]?.fromDate || '';
  if (isIsoDate(previousPoa?.toDate)) {
    const afterPrevious = addCivilDays(previousPoa.toDate, 1);
    suggestedFrom = recognized.find(row => row.fromDate >= afterPrevious)?.fromDate || suggestedFrom;
  }
  const from = isIsoDate(fromDate) ? fromDate : suggestedFrom;
  const to = isIsoDate(toDate) ? toDate : (recognized.at(-1)?.toDate || '');
  if (from && !isIsoDate(from) || to && !isIsoDate(to)) throw new AppError(ERR.VALIDATION, 'تاريخ نطاق التوكيل غير صالح.');
  if (from && to && to < from) throw new AppError(ERR.VALIDATION, 'تاريخ نهاية فترة التوكيل قبل بدايتها.', {toDate: 'تاريخ غير صحيح'});
  const currency = recognized[0]?.currency || obligations.find(row => !row.isDeleted)?.currency || ledger.find(row => !row.isDeleted)?.currency || '';
  if (!currency) throw new AppError(ERR.CONFLICT, 'لا توجد عملة FEAS معرفة لهذا التنفيذ؛ لم يُفترض رمز عملة لإنشاء التوكيل.');
  // POA is an issue-time snapshot over explicit recognized periods, not a historical balance-as-of the end date.
  const summary = calculateFeasBalance({executionPeriods: periods, allocations, ledger, differences});
  const intersects = (row) => from && to && row.fromDate <= to && from <= row.toDate;
  const partiallySelected = recognized.filter(row => intersects(row) && !(row.fromDate >= from && row.toDate <= to));
  if (partiallySelected.length) throw new AppError(ERR.VALIDATION, `نطاق التوكيل يقطع لقطة اعتراف محفوظة (${partiallySelected[0].fromDate} → ${partiallySelected[0].toDate}). اختر النطاق كاملًا؛ لا تُقسَّم اللقطة تلقائيًا.`);
  const periodRows = summary.periods.filter(row => from && to && row.fromDate >= from && row.toDate <= to);
  const periodMinor = sumMinor(periodRows, row => row.finalAmountMinor);
  const previousMinor = from ? Math.max(0, sumMinor(summary.periods.filter(row => row.toDate < from), row => row.remainingMinor)) : 0;
  const derivedPreviousBalance = fromMinorUnits(previousMinor, currency || 'EGP');
  const previousPoaTotal = previousPoa && Number.isSafeInteger(previousPoa.totalMinor) ? previousPoa.totalMinor : null;
  const previouslyUsedExpenseIds = new Set(poas.filter(row => !row.isDeleted).flatMap(row => (row.lines || []).filter(line => line.sourceType === 'expense' && line.included).flatMap(line => line.sourceIds || [])));
  const expenseRows = summary.netLedger.filter(row => ['EXECUTION_FEE', 'STAMP', 'COLLECTION_FEE', 'OTHER_EXPENSE'].includes(row.type)
    && row.includeInPoa && (!to || row.date <= to) && !previouslyUsedExpenseIds.has(row.id));
  const expenseMinor = sumMinor(expenseRows, row => row.netAmountMinor);
  const sourceFingerprint = JSON.stringify({
    executionId, from, to, currency,
    periods: summary.periods.map(row => [row.periodKey, row.status, row.recognizedAmountMinor, row.finalAmountMinor, row.allocatedMinor, row.recognizedAt]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    ledger: summary.netLedger.map(row => [row.id, row.type, row.netAmountMinor, row.date, row.includeInPoa]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    allocations: allocations.map(row => [row.id, row.periodKey, row.amountMinor, row.isActive, row.createdAt, row.supersededAt]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    differences: differences.map(row => [row.id, row.periodKey, row.status, row.differenceAmountMinor, row.decidedAt, row.supersededAt]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    poas: poas.map(row => [row.id, row.totalMinor, row.snapshotAt, (row.lines || []).map(line => [line.key, line.amountMinor, line.included, line.sourceIds])]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))
  });
  const stampMinor = stampAmount === '' ? 0 : toMinorUnits(stampAmount, currency);
  const extraMinor = extraAmount === '' ? 0 : toMinorUnits(extraAmount, currency);
  const lines = [
    {key: 'previousBalance', label: 'رصيد مشتق من اللقطات المعترف بها قبل بداية النطاق', amountMinor: includePreviousBalance ? previousMinor : 0,
      amount: fromMinorUnits(includePreviousBalance ? previousMinor : 0, currency || 'EGP'), included: Boolean(includePreviousBalance && previousMinor), sourceType: 'balance', sourceIds: [],
      detail: `${from ? `الحساب حتى ${addCivilDays(from, -1)}` : 'لا توجد بداية نطاق صريحة'} · ${previousPoa ? `إجمالي التوكيل السابق ${previousPoa.total} تاريخي ولا يُرحَّل إلى الرصيد` : 'لا يُنشئ هذا البند دينًا ولا يغيّر الرصيد'}${previousPoaTotal === null && previousPoa ? ' · نسخة التوكيل السابق لا تحمل مبلغًا بوحدات صغرى' : ''}`},
    ...periodRows.map(period => ({key: `period:${period.key}`, label: `لقطة معترف بها ${period.fromDate} → ${period.toDate}`,
      amountMinor: period.finalAmountMinor, amount: period.finalAmount, included: period.finalAmountMinor > 0, sourceType: 'period',
      sourceIds: [period.id, ...(differences.filter(row => !row.isDeleted && ['APPROVED', 'POSTED'].includes(row.status) && row.periodKey === period.periodKey).map(row => row.id))],
      detail: `${period.originalAmountMinor} + ${period.differenceMinor} فرق تفسيري = ${period.finalAmountMinor} وحدة صغرى؛ التخصيص: ${period.allocatedMinor} وحدة صغرى؛ مرجع الاعتراف ${period.periodKey}`})),
    {key: 'differences', label: 'الفروق التفسيرية (مدمجة في مبالغ اللقطات أعلاه)', amountMinor: 0, amount: 0, included: false, sourceType: 'difference', sourceIds: [],
      detail: 'لا تُضاف مرة ثانية إلى مبلغ اللقطة؛ اعتمادها لا ينشئ حركة دين.'},
    {key: 'expenses', label: `مصروفات فعلية مُعلَّمة للدخول (${expenseRows.length})`, amountMinor: expenseMinor,
      amount: fromMinorUnits(expenseMinor, currency), included: Boolean(includeExpenses && expenseMinor > 0), sourceType: 'expense', sourceIds: expenseRows.map(row => row.id),
      detail: expenseRows.map(row => `${row.date} ${row.type}: ${row.netAmount}`).join(' · ')},
    ...(stampMinor > 0 ? [{key: 'stamp', label: 'دمغة (قيمة فعلية أدخلها المستخدم)', amountMinor: stampMinor, amount: fromMinorUnits(stampMinor, currency || 'EGP'), included: true, sourceType: 'manual', sourceIds: [], detail: 'قيمة يدوية — لا يقدّرها البرنامج'}] : []),
    ...(extraMinor > 0 ? [{key: 'extra', label: extraLabel || 'مبلغ آخر أدخله المستخدم', amountMinor: extraMinor, amount: fromMinorUnits(extraMinor, currency || 'EGP'), included: true, sourceType: 'manual', sourceIds: [], detail: 'قيمة يدوية'}] : [])
  ];
  const included = lines.filter(line => line.included && line.amountMinor > 0);
  const includedMinor = sumMinor(included, line => line.amountMinor);
  const periodTotal = fromMinorUnits(periodMinor, currency || 'EGP');
  const previousTotal = fromMinorUnits(includePreviousBalance ? previousMinor : 0, currency || 'EGP');
  const differenceTotal = 0;
  const expenseTotal = fromMinorUnits(expenseMinor, currency || 'EGP');
  return {
    execution, accountingModel: FEAS_MODEL, currency, previousPoa, previousPoaId: previousPoa?.id || '', fromDate: from, toDate: to, lines, included,
    sourceFingerprint, idempotencyKey: uid(),
    totals: {previousBalance: previousTotal, previousBalanceMinor: includePreviousBalance ? previousMinor : 0,
      derivedPreviousBalance, derivedPreviousBalanceMinor: previousMinor, periods: periodTotal, periodsMinor: periodMinor,
      collectedInPeriod: fromMinorUnits(sumMinor(periodRows, row => row.allocatedMinor), currency || 'EGP'),
      differences: differenceTotal, differencesMinor: 0, expenses: expenseTotal, expensesMinor: expenseMinor,
      stamp: fromMinorUnits(stampMinor, currency || 'EGP'), stampMinor, extra: fromMinorUnits(extraMinor, currency || 'EGP'), extraMinor,
      total: fromMinorUnits(includedMinor, currency || 'EGP'), totalMinor: includedMinor, newPeriodValue: periodTotal, newPeriodValueMinor: periodMinor},
    periodRows,
    equations: [`لقطات معترف بها داخل النطاق: ${periodRows.length} · ${periodMinor} وحدة صغرى (تشمل الفروق التفسيرية مرة واحدة)`,
      `الرصيد السابق من الحساب المعاد بناؤه: ${previousMinor} وحدة صغرى — التوكيل السابق لا يغيّر الرصيد`,
      `المصروفات الفعلية المتاحة: ${expenseMinor} وحدة صغرى`, `إجمالي لقطة التوكيل: ${includedMinor} وحدة صغرى`]
  };
}

/**
 * مسودة توكيل: كل بند بمصدره. لا شيء «يُخمَّن»؛ كل بند يظهر مع إمكانية استثنائه.
 * includePreviousBalance / includeDifferences / includeExpenses: قرار المستخدم.
 */
export async function buildPoaDraft(office, {executionId, previousPoaId = '', fromDate = '', toDate = '', includePreviousBalance = true, includeDifferences = true, includeExpenses = false, stampAmount = '', extraAmount = '', extraLabel = '', partyIds = [], previousBalanceOverride = ''} = {}) {
  const execution = await office.r.execution.get(executionId);
  if (!execution || execution.isDeleted) throw new AppError(ERR.NOT_FOUND, 'سجل التنفيذ غير موجود.');
  if (execution.accountingModel === FEAS_MODEL) return buildFeasPoaDraft(office, {execution, executionId, previousPoaId, fromDate, toDate, includePreviousBalance, includeExpenses, stampAmount, extraAmount, extraLabel});
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

/** Immutable FEAS issue snapshot. It never changes the execution balance or its source events. */
async function saveFeasExecutionPoa(office, input, execution, previousPoaId) {
  if (!isIsoDate(input.date) || !isIsoDate(input.fromDate) || !isIsoDate(input.toDate) || input.toDate < input.fromDate) throw new AppError(ERR.VALIDATION, 'تاريخ التوكيل وبداية ونهاية نطاق اللقطة مطلوبة صراحةً.', {date: 'مطلوب', fromDate: 'مطلوب', toDate: 'مطلوب'});
  const obligations = await office.r.executionObligations.byIndex('executionId', execution.id, 2001);
  if (obligations.length > 2000) throw new AppError(ERR.CONFLICT, 'تجاوز عدد الالتزامات حد القراءة الآمن؛ لم تُحفظ لقطة جزئية.');
  const currency = String(input.currency || obligations.find(row => !row.isDeleted)?.currency || '').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new AppError(ERR.VALIDATION, 'عملة لقطة FEAS غير محددة صراحةً.');
  if (!String(input.idempotencyKey || '').trim() || !String(input.sourceFingerprint || '').trim()) throw new AppError(ERR.VALIDATION, 'مفتاح منع الازدواج وبصمة مصادر لقطة FEAS مطلوبان. أعد فتح مسودة التوكيل.');
  const idempotentPoaId = `FEASPOA::${encodeURIComponent(execution.id)}::${encodeURIComponent(input.idempotencyKey)}`;
  const existingRequest = await office.r.executionPOAs.get(idempotentPoaId);
  if (existingRequest) {
    const lineSignature = rows => JSON.stringify((rows || []).map(line => [line.key, line.amountMinor, Boolean(line.included), line.sourceType, [...(line.sourceIds || [])].sort()]));
    if (existingRequest.sourceFingerprint === input.sourceFingerprint && existingRequest.totalMinor === input.totalMinor && lineSignature(existingRequest.lines) === lineSignature(input.lines)) return existingRequest;
    throw new AppError(ERR.CONFLICT, 'مفتاح التوكيل استُخدم مع بيانات مختلفة؛ لم تُنشأ لقطة مكررة.');
  }
  const freshDraft = await buildFeasPoaDraft(office, {execution, executionId: execution.id, previousPoaId, fromDate: input.fromDate, toDate: input.toDate, includePreviousBalance: true, includeExpenses: false});
  if (freshDraft.sourceFingerprint !== input.sourceFingerprint) throw new AppError(ERR.CONFLICT, 'تغيرت لقطات/حركات التنفيذ بعد إعداد مسودة التوكيل؛ أعد فتح المسودة قبل الحفظ.');
  const generatedByKey = new Map(freshDraft.lines.map(line => [line.key, line]));
  const sameIds = (left = [], right = []) => JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
  for (const line of input.lines || []) {
    if (!line.included) throw new AppError(ERR.VALIDATION, 'يجب ألا تتضمن لقطة التوكيل بنودًا مستبعدة.');
    if (['period', 'balance', 'expense'].includes(line.sourceType)) {
      const generated = generatedByKey.get(line.key);
      if (!generated || !Number.isSafeInteger(line.amountMinor) || line.amountMinor !== generated.amountMinor || !sameIds(line.sourceIds, generated.sourceIds)) throw new AppError(ERR.CONFLICT, `مصدر أو مبلغ البند ${line.key} لا يطابق المسودة المعاد بناؤها.`);
    } else if (line.sourceType === 'difference') {
      throw new AppError(ERR.VALIDATION, 'لا تُدرج الفروق التفسيرية منفصلة؛ فهي مدمجة في قيمة اللقطة المعترف بها.');
    } else if (line.sourceType !== 'manual' || !['stamp', 'extra'].includes(line.key) || (line.sourceIds || []).length) {
      throw new AppError(ERR.VALIDATION, 'نوع مصدر بند التوكيل غير مسموح في لقطة FEAS.');
    }
  }
  const lines = (Array.isArray(input.lines) ? input.lines : []).map(line => {
    const amountMinor = Number.isSafeInteger(line.amountMinor) ? line.amountMinor : toMinorUnits(line.amount ?? 0, currency);
    if (amountMinor < 0) throw new AppError(ERR.VALIDATION, 'لا تقبل بنود لقطة التوكيل مبالغ سالبة.');
    return {...line, amountMinor, amount: fromMinorUnits(amountMinor, currency), sourceIds: Array.isArray(line.sourceIds) ? [...new Set(line.sourceIds.filter(Boolean))] : []};
  });
  const included = lines.filter(line => line.included && line.amountMinor > 0);
  const totalMinor = sumMinor(included, line => line.amountMinor);
  if (totalMinor <= 0) throw new AppError(ERR.VALIDATION, 'إجمالي لقطة التوكيل يجب أن يكون موجبًا؛ لا تُنشأ حركة دين بهذا الإجراء.');
  if (Number.isSafeInteger(input.totalMinor) && input.totalMinor !== totalMinor) throw new AppError(ERR.CONFLICT, 'تغير مجموع بنود لقطة التوكيل؛ أعد المعاينة قبل الحفظ.');
  const previousPoa = previousPoaId ? await office.r.executionPOAs.get(previousPoaId) : null;
  if (previousPoaId && (!previousPoa || previousPoa.isDeleted || previousPoa.executionId !== execution.id)) throw new AppError(ERR.VALIDATION, 'التوكيل السابق المحدد لا يتبع التنفيذ.');
  const existingPoas = await office.r.executionPOAs.byIndex('executionId', execution.id, 2001);
  if (existingPoas.length > 2000) throw new AppError(ERR.CONFLICT, 'تجاوز عدد التوكيلات حد القراءة الآمن؛ لم تُحفظ لقطة جزئية.');
  const now = Clock.now();
  const row = {
    id: idempotentPoaId, idempotencyKey: String(input.idempotencyKey), sourceFingerprint: input.sourceFingerprint,
    executionId: execution.id, accountingModel: FEAS_MODEL, currency,
    fileId: execution.fileId || '', clientId: input.clientId || execution.clientId || '',
    poaNumber: String(input.poaNumber || input.reference || '').trim(), reference: String(input.reference || '').trim(),
    kind: previousPoaId ? 'reissue' : (input.kind || 'first'), previousPoaId: previousPoaId || '',
    date: input.date, fromDate: input.fromDate, toDate: input.toDate,
    baseAmountMinor: sumMinor(lines.filter(line => line.key?.startsWith('period:') && line.included), line => line.amountMinor),
    previousBalanceMinor: sumMinor(lines.filter(line => line.key === 'previousBalance' && line.included), line => line.amountMinor),
    differencesAmountMinor: 0,
    expensesAmountMinor: sumMinor(lines.filter(line => line.key === 'expenses' && line.included), line => line.amountMinor),
    stampAmountMinor: sumMinor(lines.filter(line => line.key === 'stamp' && line.included), line => line.amountMinor),
    totalMinor, baseAmount: fromMinorUnits(sumMinor(lines.filter(line => line.key?.startsWith('period:') && line.included), line => line.amountMinor), currency),
    previousBalance: fromMinorUnits(sumMinor(lines.filter(line => line.key === 'previousBalance' && line.included), line => line.amountMinor), currency),
    differencesAmount: 0, expensesAmount: fromMinorUnits(sumMinor(lines.filter(line => line.key === 'expenses' && line.included), line => line.amountMinor), currency),
    stampAmount: fromMinorUnits(sumMinor(lines.filter(line => line.key === 'stamp' && line.included), line => line.amountMinor), currency),
    total: fromMinorUnits(totalMinor, currency),
    judgmentIds: Array.isArray(input.judgmentIds) ? [...new Set(input.judgmentIds.filter(Boolean))] : [],
    partyIds: Array.isArray(input.partyIds) ? [...new Set(input.partyIds.filter(Boolean))] : [],
    lines: lines.map(line => ({key: line.key, label: line.label, amount: line.amount, amountMinor: line.amountMinor, included: Boolean(line.included), sourceType: line.sourceType || '', sourceIds: line.sourceIds, detail: line.detail || ''})),
    status: 'active', sequence: existingPoas.length + 1, notes: String(input.notes || '').trim(),
    snapshotAt: now, createdAt: now, updatedAt: now, version: 1, isDeleted: false
  };
  let poaNumber = row.poaNumber;
  const result = await transaction(office.ctx, [STORE.executionPOAs, STORE.fileNumberCounters, STORE.activityLog], async tx => {
    const store = tx.objectStore(STORE.executionPOAs);
    const existing = await request(store.get(row.id));
    if (existing) {
      if (existing.sourceFingerprint === row.sourceFingerprint && existing.totalMinor === row.totalMinor) return {row: existing, reused: true};
      throw new AppError(ERR.CONFLICT, 'مفتاح التوكيل استُخدم مع بيانات مختلفة؛ لم تُنشأ لقطة مكررة.');
    }
    if (!poaNumber) poaNumber = await nextPoaNumber(tx, row.date.slice(0, 4));
    row.poaNumber = poaNumber;
    await request(store.add(row));
    await request(tx.objectStore(STORE.activityLog).add(logRow(office, STORE.executionPOAs, row.id, 'snapshot-create', `حفظ لقطة توكيل FEAS ${row.poaNumber} للفترة ${row.fromDate} → ${row.toDate} بإجمالي ${row.total} ${currency} — لا تنشئ حركة دين`, {fileId: row.fileId})));
    return {row, reused: false};
  });
  if (!result.reused) events.emit('entity:changed', {entityType: STORE.executionPOAs, id: result.row.id});
  return result.row;
}

/** حفظ التوكيل: يُخزَّن تفصيل المصادر كما رآه المستخدم، وتُعلَّم المكونات المُدرجة بمعرّف التوكيل للمسار الحالي. */
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
  if (execution.accountingModel === FEAS_MODEL) {
    if (id) throw new AppError(ERR.CONFLICT, 'لقطة توكيل FEAS غير قابلة للتعديل؛ أنشئ إصدارًا جديدًا موثقًا بدل الكتابة فوقها.');
    return saveFeasExecutionPoa(office, input, execution, input.previousPoaId || input.previousPoa?.id || '');
  }
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
