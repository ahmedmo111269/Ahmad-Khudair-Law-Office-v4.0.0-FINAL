// =====================================================================
// دفتر حركات التنفيذ (Execution Ledger) — Append-Only
// ---------------------------------------------------------------------
// • لا UPDATE ولا DELETE لحركة مالية تاريخية: التصحيح = ADJUSTMENT، والعكس = REVERSAL،
//   وكلاهما سجل جديد يشير إلى الحركة الأصلية (adjustsLedgerId) بسبب مكتوب.
// • المصروفات (رسم تنفيذ/دمغة/مصروف تحصيل/أخرى) منفصلة عن أصل الاستحقاق وعن التحصيل،
//   وتُعلَّم صراحةً هل تدخل إجمالي التوكيل (includeInPoa) — ولا يخمّن البرنامج أي رسم.
// • محضر التحصيل كيان مستقل، وحركة التحصيل تُنشأ معه في معاملة واحدة، ثم التخصيصات.
// • أصل الدين لا يُخلط بالمصروفات، والرصيد لا يُخزَّن: يُشتق في محرك الرصيد.
// =====================================================================
import {STORE} from '../db/schema.js';
import {transaction, request} from '../db/unit-of-work.js';
import {uid} from '../core/id.js';
import {Clock, localDate} from '../core/clock.js';
import {AppError, ERR} from '../core/errors.js';
import {events} from '../core/events.js';
import {
  num, round2, isIsoDate, validateLedgerEntry, validateAllocationLines, LEDGER_TYPE_LABELS, LEDGER_CATEGORY,
  isExpenseType, isCollectionType, ALLOCATION_METHOD_LABELS, DEFAULT_PRORATION, money
} from '../domain/execution.js';
import {netLedger, outstandingPeriods, allocationPlan, buildEntitlementPeriods} from '../domain/entitlement-engine.js';
import {FEAS_MODEL, calculateFeasBalance, planFeasAllocation} from '../domain/execution-feas.js';
import {addMinor, fromMinorUnits, sumMinor, toMinorUnits} from '../domain/execution-money.js';
import {executionSlices, executionAllocations, executionLedgerRows} from './execution.js';

const MAX_ROWS = 5000;
const logRow = (office, entityType, entityId, action, summary, {fileId = null, metadata = {}} = {}) => {
  const row = {id: uid(), entityType, entityId, action, timestamp: Clock.now(), summary, metadata};
  if (fileId) row.fileId = fileId;
  return row;
};

async function requireExecution(office, executionId) {
  const execution = await office.r.execution.get(executionId);
  if (!execution || execution.isDeleted) throw new AppError(ERR.NOT_FOUND, 'سجل التنفيذ غير موجود.');
  return execution;
}

/** سياق التخصيص: الفترات المتبقية داخل التنفيذ + الحركة المراد تخصيصها. */
export async function allocationContext(office, executionId, {asOf = ''} = {}) {
  const execution = await requireExecution(office, executionId);
  if (execution.accountingModel === FEAS_MODEL) {
    const [periods, obligations, allocations, ledger, differences] = await Promise.all([
      office.r.executionPeriods.byIndex('executionId', executionId, MAX_ROWS),
      office.r.executionObligations.byIndex('executionId', executionId, MAX_ROWS),
      office.r.executionAllocations.byIndex('executionId', executionId, MAX_ROWS),
      office.r.executionLedger.byIndex('executionId', executionId, MAX_ROWS),
      office.r.differenceRecords.byIndex('executionId', executionId, MAX_ROWS)
    ]);
    if ([periods, obligations, allocations, ledger, differences].some(rows => rows.length >= MAX_ROWS)) throw new AppError(ERR.CONFLICT, 'تجاوزت بيانات FEAS حد القراءة الآمن؛ لم يُحسب تخصيص جزئي. راجع السجلات أو ضيّق النطاق.');
    const summary = calculateFeasBalance({executionPeriods: periods, allocations, ledger, differences, asOf});
    const rows = summary.periods.map(period => ({
      ...period, periodKey: period.periodKey, remaining: period.remaining,
      remainingMinor: period.remainingMinor,
      parties: period.beneficiaryPartyIdSnapshot ? [period.beneficiaryPartyIdSnapshot] : [],
      partyId: period.beneficiaryPartyIdSnapshot || ''
    }));
    const outstanding = {periods: rows.filter(period => period.remainingMinor > 0), totals: {allocated: summary.allocated, remaining: summary.remaining}};
    const currency = summary.currency || obligations.find(row => !row.isDeleted && row.status !== 'inactive')?.currency || '';
    return {execution, slices: [], allocations, ledger, differences, periods: summary.periods, outstanding, summary, obligations, currency};
  }
  const [slices, allocations, ledger, differences] = await Promise.all([
    executionSlices(office, executionId), executionAllocations(office, executionId), executionLedgerRows(office, executionId),
    office.r.differenceRecords.byIndex('executionId', executionId, MAX_ROWS)
  ]);
  const build = buildEntitlementPeriods({slices, asOf, to: execution.entitlementThroughDate || '', policy: execution.prorationPolicy || DEFAULT_PRORATION});
  const outstanding = outstandingPeriods({periods: build.periods, allocations, differences});
  return {execution, slices, allocations, ledger, differences, periods: build.periods, outstanding};
}

/**
 * إضافة حركة مالية جديدة. لا تُقبل حركة بمعرّف قائم: الحركة التاريخية لا تُعدَّل.
 */
export async function addLedgerEntry(office, input) {
  if (input.id) throw new AppError(ERR.CONFLICT, 'لا يمكن تعديل حركة مالية تاريخية أو استبدالها. استخدم تصحيحًا (ADJUSTMENT) أو عكسًا (REVERSAL).');
  const execution = await requireExecution(office, input.executionId);
  const errors = validateLedgerEntry(input);
  if (Object.keys(errors).length) throw new AppError(ERR.VALIDATION, 'راجع بيانات الحركة المالية.', errors);
  if (input.type === 'DIFFERENCE_DUE') throw new AppError(ERR.VALIDATION, 'فرق الاستحقاق لا يُسجَّل يدويًا كحركة: يُراجع ويُعتمد من شاشة التسويات.');
  const feas = execution.accountingModel === FEAS_MODEL;
  let amount = round2(num(input.amount)), currency = input.currency || 'جنيه', amountMinor = null;
  if (feas) {
    const obligations = await office.r.executionObligations.byIndex('executionId', input.executionId, MAX_ROWS);
    if (obligations.length >= MAX_ROWS) throw new AppError(ERR.CONFLICT, 'تجاوزت الالتزامات حد القراءة الآمن؛ لم تُسجَّل حركة على أساس جزئي.');
    const currencies = [...new Set(obligations.filter(row => !row.isDeleted && row.status !== 'inactive').map(row => String(row.currency || '').toUpperCase()).filter(Boolean))];
    currency = String(input.currency || currencies[0] || '').toUpperCase();
    if (!currency) throw new AppError(ERR.VALIDATION, 'عملة الحركة مطلوبة؛ عرّف عملة FEAS صراحةً أو أدخل رمز العملة.');
    if (currencies.some(code => code !== currency)) throw new AppError(ERR.CONFLICT, 'عملة الحركة لا تطابق عملة التزامات هذا التنفيذ.');
    try {
      amountMinor = Number.isSafeInteger(input.amountMinor) ? input.amountMinor : toMinorUnits(input.amount, currency);
      if (amountMinor <= 0) throw new RangeError('المبلغ يجب أن يكون وحدات صغرى موجبة.');
      amount = fromMinorUnits(amountMinor, currency);
    } catch (error) {
      throw new AppError(ERR.VALIDATION, error.message || 'قيمة الحركة لا تطابق دقة العملة.', {amount: error.message || 'قيمة غير صحيحة'});
    }
  }
  const now = Clock.now();
  const row = {
    id: uid(), executionId: input.executionId, fileId: execution.fileId || '', clientId: execution.clientId || '',
    type: input.type, category: LEDGER_CATEGORY[input.type], amount,
    ...(feas ? {amountMinor, currency} : {currency}),
    ...(input.idempotencyKey ? {idempotencyKey: String(input.idempotencyKey)} : {}),
    date: input.date, receiptId: input.receiptId || '', differenceRecordId: input.differenceRecordId || '', poaId: input.poaId || '',
    judgmentId: input.judgmentId || '', periodKey: input.periodKey || '', documentReferenceId: input.documentReferenceId || '',
    paymentMethod: String(input.paymentMethod || '').trim(), includeInPoa: isExpenseType(input.type) ? Boolean(input.includeInPoa) : false,
    sourceType: input.sourceType || 'manual', sourceId: input.sourceId || '', adjustsLedgerId: input.adjustsLedgerId || '',
    adjustDirection: input.adjustDirection === 'decrease' ? 'decrease' : (input.adjustDirection === 'increase' ? 'increase' : ''),
    reason: String(input.reason || '').trim(), notes: String(input.notes || '').trim(),
    createdBy: office.ctx?.profile?.id || 'user', createdAt: now, updatedAt: now, version: 1, isDeleted: false
  };
  if (input.type === 'REVERSAL' || input.type === 'ADJUSTMENT') {
    const original = await office.r.executionLedger.get(input.adjustsLedgerId);
    if (!original || original.isDeleted) throw new AppError(ERR.VALIDATION, 'لا يمكن إنشاء تصحيح أو عكس بدون حركة أصلية موجودة.');
    if (original.executionId !== input.executionId) throw new AppError(ERR.VALIDATION, 'الحركة الأصلية تتبع تنفيذًا آخر.');
    if (feas) {
      if (!Number.isSafeInteger(original.amountMinor) || String(original.currency || '').toUpperCase() !== currency) throw new AppError(ERR.CONFLICT, 'الحركة الأصلية بلا وحدات صغرى/عملة مطابقة؛ أوقف التصحيح حتى المراجعة.');
      const siblings = await office.r.executionLedger.byIndex('executionId', input.executionId, MAX_ROWS);
      if (siblings.length >= MAX_ROWS) throw new AppError(ERR.CONFLICT, 'تجاوز الدفتر حد القراءة الآمن؛ لم يُنفذ التصحيح على صافي جزئي.');
      const net = calculateFeasBalance({ledger: siblings}).netLedger;
      const target = net.find(item => item.id === original.id);
      if (!target) throw new AppError(ERR.CONFLICT, 'تعذر قراءة الحركة الأصلية.');
      if (input.type === 'REVERSAL') {
        if (target.netAmountMinor <= 0) throw new AppError(ERR.CONFLICT, 'هذه الحركة معكوسة بالكامل بالفعل؛ لا يُسمح بعكس مكرر.');
        if (amountMinor > target.netAmountMinor) throw new AppError(ERR.VALIDATION, `مبلغ العكس أكبر من صافي الحركة الأصلية (${fromMinorUnits(target.netAmountMinor, currency)}).`, {amount: 'أكبر من المتاح'});
      } else if (amountMinor > original.amountMinor) {
        throw new AppError(ERR.VALIDATION, 'مبلغ التصحيح أكبر من مبلغ الحركة الأصلية.', {amount: 'أكبر من الأصل'});
      }
    } else {
      const siblings = await office.r.executionLedger.byIndex('executionId', input.executionId, MAX_ROWS);
      if (siblings.length >= MAX_ROWS) throw new AppError(ERR.CONFLICT, 'تجاوز الدفتر حد القراءة الآمن؛ لم يُنفذ التصحيح على صافي جزئي.');
      const target = netLedger(siblings).find(item => item.id === original.id);
      if (!target) throw new AppError(ERR.CONFLICT, 'تعذر قراءة الحركة الأصلية.');
      if (input.type === 'REVERSAL') {
        if (target.netAmount <= 0.001) throw new AppError(ERR.CONFLICT, 'هذه الحركة معكوسة بالكامل بالفعل؛ لا يُسمح بعكس مكرر.');
        if (amount > target.netAmount + 0.001) throw new AppError(ERR.VALIDATION, `مبلغ العكس أكبر من صافي الحركة الأصلية (${target.netAmount}).`, {amount: 'أكبر من المتاح'});
      } else if (amount > round2(num(original.amount)) + 0.001) throw new AppError(ERR.VALIDATION, 'مبلغ التصحيح أكبر من مبلغ الحركة الأصلية.', {amount: 'أكبر من الأصل'});
    }
  }
  const out = await transaction(office.ctx, [STORE.executionLedger, STORE.activityLog], async tx => {
    const store = tx.objectStore(STORE.executionLedger);
    if (row.idempotencyKey) {
      const existing = await request(store.index('idempotencyKey').get(row.idempotencyKey));
      if (existing) return existing;
    }
    await request(store.add(row));
    await request(tx.objectStore(STORE.activityLog).add(logRow(office, STORE.executionLedger, row.id, 'create', `${LEDGER_TYPE_LABELS[row.type] || row.type}: ${row.amount} ${row.currency || ''} بتاريخ ${row.date}${row.reason ? ' — ' + row.reason : ''}`, {fileId: row.fileId})));
    return row;
  });
  if (out.id === row.id) events.emit('entity:changed', {entityType: STORE.executionLedger, id: out.id});
  return out;
}

export async function recordExpense(office, input) {
  if (!isExpenseType(input.type)) throw new AppError(ERR.VALIDATION, 'نوع الحركة ليس مصروفًا مسجلًا. استخدم رسم تنفيذ أو دمغة أو مصروف تحصيل أو مصروفًا آخر.');
  return addLedgerEntry(office, {...input, sourceType: input.sourceType || 'expense'});
}

/** عكس حركة مالية: سجل REVERSAL جديد مرتبط بالأصل + سجل تصحيح إداري للتدقيق. */
export async function reverseLedgerEntry(office, {executionId, ledgerId, amount, reason, date = ''} = {}) {
  if (!String(reason || '').trim()) throw new AppError(ERR.VALIDATION, 'سبب العكس مطلوب.', {reason: 'مطلوب'});
  const original = await office.r.executionLedger.get(ledgerId);
  if (!original || original.isDeleted) throw new AppError(ERR.NOT_FOUND, 'الحركة الأصلية غير موجودة.');
  const now = Clock.now();
  const reversal = await addLedgerEntry(office, {
    executionId, type: 'REVERSAL', amount: amount === undefined || amount === '' ? original.amount : amount,
    date: isIsoDate(date) ? date : localDate(), adjustsLedgerId: ledgerId, reason,
    sourceType: 'reversal', sourceId: ledgerId, notes: `عكس ${LEDGER_TYPE_LABELS[original.type] || original.type} بتاريخ ${original.date}`
  });
  const record = {id: uid(), executionId, fileId: original.fileId || '', ledgerId, kind: 'REVERSAL', amount: reversal.amount, ...(reversal.amountMinor !== undefined ? {amountMinor: reversal.amountMinor, currency: reversal.currency} : {}), reason, status: 'POSTED', newLedgerId: reversal.id, createdAt: now, createdBy: office.ctx?.profile?.id || 'user', updatedAt: now, isDeleted: false};
  await transaction(office.ctx, [STORE.executionAdjustments, STORE.activityLog], async tx => {
    await request(tx.objectStore(STORE.executionAdjustments).put(record));
    await request(tx.objectStore(STORE.activityLog).add(logRow(office, STORE.executionAdjustments, record.id, 'create', `عكس حركة مالية بمبلغ ${record.amount} — السبب: ${reason}`, {fileId: record.fileId})));
  });
  events.emit('entity:changed', {entityType: STORE.executionAdjustments, id: record.id});
  return {reversal, record};
}

/** تصحيح حركة مالية: زيادة أو تخفيض بمبلغ محدد مع سبب مكتوب. */
export async function adjustLedgerEntry(office, {executionId, ledgerId, amount, direction = 'increase', reason, date = ''} = {}) {
  if (!String(reason || '').trim()) throw new AppError(ERR.VALIDATION, 'سبب التصحيح مطلوب.', {reason: 'مطلوب'});
  const original = await office.r.executionLedger.get(ledgerId);
  if (!original || original.isDeleted) throw new AppError(ERR.NOT_FOUND, 'الحركة الأصلية غير موجودة.');
  const now = Clock.now();
  const adjustment = await addLedgerEntry(office, {
    executionId, type: 'ADJUSTMENT', amount, date: isIsoDate(date) ? date : localDate(), adjustsLedgerId: ledgerId,
    adjustDirection: direction === 'decrease' ? 'decrease' : 'increase', reason, sourceType: 'adjustment', sourceId: ledgerId,
    notes: `تصحيح ${direction === 'decrease' ? 'بتخفيض' : 'بزيادة'} على حركة ${LEDGER_TYPE_LABELS[original.type] || original.type} بتاريخ ${original.date}`
  });
  const record = {id: uid(), executionId, fileId: original.fileId || '', ledgerId, kind: 'ADJUSTMENT', amount: adjustment.amount, ...(adjustment.amountMinor !== undefined ? {amountMinor: adjustment.amountMinor, currency: adjustment.currency} : {}), direction, reason, status: 'POSTED', newLedgerId: adjustment.id, createdAt: now, createdBy: office.ctx?.profile?.id || 'user', updatedAt: now, isDeleted: false};
  await transaction(office.ctx, [STORE.executionAdjustments, STORE.activityLog], async tx => {
    await request(tx.objectStore(STORE.executionAdjustments).put(record));
    await request(tx.objectStore(STORE.activityLog).add(logRow(office, STORE.executionAdjustments, record.id, 'create', `تصحيح حركة مالية بمبلغ ${record.amount} (${direction === 'decrease' ? 'تخفيض' : 'زيادة'}) — السبب: ${reason}`, {fileId: record.fileId})));
  });
  events.emit('entity:changed', {entityType: STORE.executionAdjustments, id: record.id});
  return {adjustment, record};
}

// ===== محاضر التحصيل =====
async function nextReceiptNumber(tx, year) {
  const counters = tx.objectStore(STORE.fileNumberCounters);
  const id = `receipt:${year}`;
  const counter = await request(counters.get(id));
  const next = (counter?.lastNumber || 0) + 1;
  await request(counters.put({id, year, kind: 'receipt', lastNumber: next, updatedAt: Clock.now()}));
  return `RC-${year}-${String(next).padStart(4, '0')}`;
}

/** التخصيصات الفعّالة لمحضر أو حركة. */
export async function allocationsFor(office, {receiptId = '', ledgerId = ''} = {}) {
  const rows = receiptId
    ? await office.r.executionAllocations.byIndex('receiptId', receiptId, MAX_ROWS)
    : await office.r.executionAllocations.byIndex('ledgerId', ledgerId, MAX_ROWS);
  return rows.filter(row => !row.isDeleted).sort((a, b) => String(a.periodKey).localeCompare(String(b.periodKey)));
}

/**
 * تسجيل محضر تحصيل + حركة التحصيل + التخصيصات في معاملة واحدة.
 * لا يُسمح بتخصيص أكبر من مبلغ المحضر، ولا بتخصيص نفس المبلغ مرتين، ولا لفترة غير موجودة.
 */
export async function recordCollection(office, input) {
  const execution = await requireExecution(office, input.executionId);
  if (!isIsoDate(input.date)) throw new AppError(ERR.VALIDATION, 'تاريخ التحصيل مطلوب.', {date: 'مطلوب'});
  const context = await allocationContext(office, input.executionId);
  const feas = execution.accountingModel === FEAS_MODEL;
  let amount = round2(num(input.amount)), amountMinor = null, currency = input.currency || 'جنيه';
  if (feas) {
    currency = String(input.currency || context.currency || '').toUpperCase();
    if (!currency) throw new AppError(ERR.VALIDATION, 'عملة التحصيل غير محددة؛ عرّف التزام FEAS أو أدخل عملة صريحة.');
    if (context.currency && currency !== String(context.currency).toUpperCase()) throw new AppError(ERR.CONFLICT, 'عملة التحصيل لا تطابق عملة التنفيذ.');
    try { amountMinor = toMinorUnits(input.amount, currency); amount = fromMinorUnits(amountMinor, currency); }
    catch (error) { throw new AppError(ERR.VALIDATION, error.message || 'المبلغ لا يطابق دقة العملة.', {amount: error.message || 'مبلغ غير صحيح'}); }
  }
  if (!(amount > 0)) throw new AppError(ERR.VALIDATION, 'مبلغ التحصيل يجب أن يكون أكبر من صفر.', {amount: 'مطلوب'});
  const plan = planFromInput({context, amount: feas ? input.amount : amount, amountMinor, allocation: {...(input.allocation || {}), currency}});
  const ledgerRow = {
    executionId: input.executionId, type: 'COLLECTION', amount, ...(feas ? {amountMinor, currency} : {currency}), date: input.date,
    paymentMethod: input.paymentMethod || '', receiptId: '', poaId: input.poaId || '', documentReferenceId: input.documentReferenceId || '',
    sourceType: 'receipt', periodKey: '', notes: String(input.notes || '').trim(), ...(input.idempotencyKey ? {idempotencyKey: input.idempotencyKey} : {})
  };
  const out = await transaction(office.ctx, [STORE.executionReceipts, STORE.executionLedger, STORE.executionAllocations, STORE.fileNumberCounters, STORE.activityLog], async tx => {
    const receiptsStore = tx.objectStore(STORE.executionReceipts), ledgerStore = tx.objectStore(STORE.executionLedger);
    if (input.idempotencyKey) {
      const existingReceipt = await request(receiptsStore.index('idempotencyKey').get(String(input.idempotencyKey)));
      if (existingReceipt) {
        const existingLedger = existingReceipt.ledgerId ? await request(ledgerStore.get(existingReceipt.ledgerId)) : null;
        const existingAllocations = await request(tx.objectStore(STORE.executionAllocations).index('receiptId').getAll(globalThis.IDBKeyRange.only(existingReceipt.id)));
        const activeAllocations = existingAllocations.filter(row => !row.isDeleted && row.isActive !== false);
        const unallocated = feas
          ? fromMinorUnits(Math.max(0, (existingReceipt.amountMinor || 0) - sumMinor(activeAllocations, row => row.amountMinor || 0)), existingReceipt.currency || 'EGP')
          : round2(Math.max(0, num(existingReceipt.amount) - activeAllocations.reduce((sum, row) => sum + num(row.amount), 0)));
        return {receipt: existingReceipt, ledger: existingLedger, allocations: existingAllocations, unallocated, warnings: [], reused: true};
      }
    }
    const receiptId = uid();
    const year = String(input.date).slice(0, 4);
    const receiptNumber = String(input.receiptNumber || '').trim() || await nextReceiptNumber(tx, year);
    const receipt = {
      id: receiptId,
      executionId: input.executionId,
      fileId: execution.fileId || '',
      clientId: execution.clientId || '',
      receiptNumber,
      date: input.date,
      amount,
      ...(feas ? {amountMinor, currency} : {}),
      ...(input.idempotencyKey ? {idempotencyKey: String(input.idempotencyKey)} : {}),
      receiptType: input.receiptType || 'محضر تحصيل',
      collectorName: String(input.collectorName || '').trim(),
      collectionSide: input.collectionSide || '',
      paymentMethod: String(input.paymentMethod || '').trim(),
      poaId: input.poaId || '',
      documentReferenceId: input.documentReferenceId || '',
      allocationMethod: input.allocation?.method || 'DIRECT',
      reference: String(input.reference || '').trim(),
      notes: String(input.notes || '').trim(),
      hasExpenses: Boolean(input.expenses?.length),
      status: 'posted',
      createdBy: office.ctx?.profile?.id || 'user',
      createdAt: Clock.now(), updatedAt: Clock.now(), version: 1, isDeleted: false
    };
    ledgerRow.receiptId = receiptId;
    ledgerRow.sourceId = receiptId;
    const ledger = {...ledgerRow, id: uid(), category: 'collection', createdBy: office.ctx?.profile?.id || 'user', createdAt: Clock.now(), updatedAt: Clock.now(), version: 1, isDeleted: false};
    receipt.ledgerId = ledger.id;
    await request(receiptsStore.add(receipt));
    await request(ledgerStore.add(ledger));
    const allocations = [];
    for (const line of plan.lines) {
      const allocation = {
        id: uid(),
        executionId: input.executionId,
        ledgerId: ledger.id,
        receiptId,
        periodKey: line.periodKey,
        executionPartyId: line.partyId || '',
        judgmentId: line.judgmentId || '',
        entitlementType: line.entitlementType || '',
        amount: round2(line.amount),
        ...(feas ? {amountMinor: line.amountMinor, currency} : {}),
        method: input.allocation?.method || 'DIRECT',
        isDifference: Boolean(line.isDifference),
        differenceRecordId: line.differenceRecordId || '',
        isActive: true,
        createdBy: office.ctx?.profile?.id || 'user',
        createdAt: Clock.now(),
        version: 1,
        isDeleted: false
      };
      allocations.push(allocation);
      await request(tx.objectStore(STORE.executionAllocations).put(allocation));
    }
    await request(tx.objectStore(STORE.activityLog).add(logRow(office, STORE.executionReceipts, receiptId, 'create', `محضر تحصيل ${receiptNumber}: ${amount} بتاريخ ${input.date}${allocations.length ? ` — ${allocations.length} تخصيص` : ' — بلا تخصيص بعد'}`, {fileId: receipt.fileId})));
    return {receipt, ledger, allocations, unallocated: plan.unallocated, warnings: plan.warnings};
  });
  if (!out.reused) {
    events.emit('entity:changed', {entityType: STORE.executionReceipts, id: out.receipt.id});
    events.emit('entity:changed', {entityType: STORE.executionLedger, id: out.ledger.id});
  }
  return out;
}

function planFromInput({context, amount, amountMinor = null, allocation = {}}) {
  if (context.execution.accountingModel === FEAS_MODEL) {
    const selectedCurrency = String(allocation.currency || '').toUpperCase();
    const currency = String(context.currency || selectedCurrency || '').toUpperCase();
    if (!currency) throw new AppError(ERR.VALIDATION, 'لا توجد عملة FEAS محددة لهذا التنفيذ؛ عرّف التزامًا أولًا.');
    if (selectedCurrency && selectedCurrency !== currency) throw new AppError(ERR.CONFLICT, 'عملة التخصيص لا تطابق عملة التنفيذ.');
    let exactAmountMinor;
    try {
      exactAmountMinor = Number.isSafeInteger(amountMinor) ? amountMinor : toMinorUnits(amount, currency);
      if (exactAmountMinor <= 0) throw new RangeError('مبلغ التخصيص يجب أن يكون موجبًا.');
    } catch (error) { throw new AppError(ERR.VALIDATION, error.message || 'المبلغ لا يطابق دقة العملة.', {amount: error.message || 'مبلغ غير صحيح'}); }
    let targets = [];
    try {
      targets = (allocation.targets || []).map(target => typeof target === 'string' ? target : ({
        periodKey: target.periodKey,
        amountMinor: Number.isSafeInteger(target.amountMinor) ? target.amountMinor : toMinorUnits(target.amount, currency),
        partyId: target.partyId || ''
      }));
      const plan = planFeasAllocation({periods: context.outstanding.periods, amountMinor: exactAmountMinor, method: allocation.method || 'DIRECT', targets, partyId: allocation.partyId || ''});
      const periodByKey = new Map(context.outstanding.periods.map(period => [period.periodKey, period]));
      const lines = plan.lines.map(line => {
        const period = periodByKey.get(line.periodKey);
        return {...line, amount: fromMinorUnits(line.amountMinor, currency), currency, judgmentId: period?.sourceJudgmentIds?.at(-1) || '', entitlementType: period?.entitlementType || ''};
      });
      return {...plan, lines, amountMinor: exactAmountMinor, amount: fromMinorUnits(exactAmountMinor, currency), unallocated: fromMinorUnits(plan.unallocatedMinor, currency), currency};
    } catch (error) { throw new AppError(ERR.VALIDATION, error.message || 'تعذر إعداد التخصيص.', {allocation: error.message || 'تخصيص غير صحيح'}); }
  }
  const method = allocation.method || 'DIRECT';
  // أي تخصيص صريح لفترات محددة (مباشر أو يدوي) يُتحقق من مفاتيحه قبل أي كتابة — لا تخصيص لفترة غير موجودة.
  if (Array.isArray(allocation.targets) && allocation.targets.length) {
    const allowed = new Set(context.outstanding.periods.map(period => period.periodKey));
    for (const target of allocation.targets) {
      const key = typeof target === 'string' ? target : target.periodKey;
      if (key && !allowed.has(key)) throw new AppError(ERR.VALIDATION, `لا توجد فترة استحقاق بالمفتاح المحدد (${key}) داخل هذا التنفيذ.`, {periodKey: 'فترة غير موجودة'});
    }
  }
  const plan = allocationPlan({outstanding: context.outstanding.periods, amount, method, targets: allocation.targets || [], partyId: allocation.partyId || ''});
  const periodByKey = new Map(context.outstanding.periods.map(period => [period.periodKey, period]));
  const lines = plan.lines.map(line => {
    const period = periodByKey.get(line.periodKey);
    return {...line, judgmentId: period?.judgmentId || '', entitlementType: period?.entitlementType || ''};
  });
  const outstandingMap = new Map(context.outstanding.periods.map(period => [period.periodKey, period]));
  const errors = validateAllocationLines({lines, amount, outstanding: outstandingMap});
  if (errors.length) throw new AppError(ERR.VALIDATION, errors[0].message, {allocation: errors[0].code});
  return {...plan, lines};
}

/** إعادة تخصيص محضر: التخصيصات القديمة تُعلَّم غير فعّالة (لا تُحذف) وتُكتب الجديدة. */
export async function reallocateReceipt(office, receiptId, allocation = {}) {
  const receipt = await office.r.executionReceipts.get(receiptId);
  if (!receipt || receipt.isDeleted) throw new AppError(ERR.NOT_FOUND, 'محضر التحصيل غير موجود.');
  const context = await allocationContext(office, receipt.executionId);
  const previous = await allocationsFor(office, {receiptId});
  const plan = planFromInput({context, amount: receipt.amount, amountMinor: receipt.amountMinor ?? null, allocation});
  const now = Clock.now();
  const rows = [];
  await transaction(office.ctx, [STORE.executionAllocations, STORE.executionReceipts, STORE.activityLog], async tx => {
    for (const row of previous) await request(tx.objectStore(STORE.executionAllocations).put({...row, isActive: false, supersededAt: now, supersededBy: 'reallocation'}));
    for (const line of plan.lines) {
      const row = {
        id: uid(), executionId: receipt.executionId, ledgerId: receipt.ledgerId, receiptId, periodKey: line.periodKey,
        executionPartyId: line.partyId || '', judgmentId: line.judgmentId || '', entitlementType: line.entitlementType || '',
        amount: round2(line.amount),
        ...(receipt.amountMinor !== undefined ? {amountMinor: line.amountMinor, currency: receipt.currency || context.currency} : {}),
        method: allocation.method || 'MANUAL', isDifference: false, differenceRecordId: '',
        isActive: true, createdBy: office.ctx?.profile?.id || 'user', createdAt: now, version: 1, isDeleted: false
      };
      rows.push(row);
      await request(tx.objectStore(STORE.executionAllocations).put(row));
    }
    await request(tx.objectStore(STORE.executionReceipts).put({...receipt, allocationMethod: allocation.method || 'MANUAL', updatedAt: now, version: (receipt.version || 0) + 1}));
    await request(tx.objectStore(STORE.activityLog).add(logRow(office, STORE.executionReceipts, receiptId, 'update', `إعادة تخصيص محضر ${receipt.receiptNumber || ''} (${rows.length} تخصيص) — التخصيص السابق محفوظ في السجل`, {fileId: receipt.fileId})));
  });
  events.emit('entity:changed', {entityType: STORE.executionReceipts, id: receiptId});
  return {allocations: rows, unallocated: plan.unallocated, warnings: plan.warnings};
}

/** تعديل وصفي لمحضر: المبلغ والتاريخ يقبلان التصحيح فقط بحركة تعديل/عكس. */
export async function updateReceiptDetails(office, receiptId, input = {}) {
  const receipt = await office.r.executionReceipts.get(receiptId);
  if (!receipt || receipt.isDeleted) throw new AppError(ERR.NOT_FOUND, 'محضر التحصيل غير موجود.');
  if ((input.amount !== undefined && round2(num(input.amount)) !== round2(receipt.amount)) || (input.date && input.date !== receipt.date)) {
    throw new AppError(ERR.CONFLICT, 'مبلغ المحضر وتاريخه لا يُعدَّلان مباشرة بعد التسجيل. سجّل تصحيحًا أو عكسًا للحركة المالية المرتبطة.');
  }
  const row = {...receipt, ...input, id: receiptId, receiptNumber: receipt.receiptNumber, updatedAt: Clock.now(), version: (receipt.version || 0) + 1};
  await transaction(office.ctx, [STORE.executionReceipts, STORE.activityLog], async tx => {
    await request(tx.objectStore(STORE.executionReceipts).put(row));
    await request(tx.objectStore(STORE.activityLog).add(logRow(office, STORE.executionReceipts, receiptId, 'update', `تحديث بيانات محضر ${receipt.receiptNumber || ''}`, {fileId: row.fileId})));
  });
  return row;
}

/** حركة تحصيل بلا محضر (تحصيل مباشر) — تُسجَّل كمصدر مستقل مع تخصيص اختياري. */
export async function recordDirectCollection(office, input) {
  const execution = await requireExecution(office, input.executionId);
  if (!isIsoDate(input.date)) throw new AppError(ERR.VALIDATION, 'تاريخ التحصيل مطلوب.', {date: 'مطلوب'});
  const context = await allocationContext(office, input.executionId);
  if (execution.accountingModel === FEAS_MODEL) {
    const currency = String(input.currency || context.currency || '').toUpperCase();
    if (!currency) throw new AppError(ERR.VALIDATION, 'عملة التحصيل غير محددة؛ عرّف التزام FEAS أو أدخل رمز العملة.');
    if (context.currency && currency !== String(context.currency).toUpperCase()) throw new AppError(ERR.CONFLICT, 'عملة التحصيل لا تطابق عملة التنفيذ.');
    let amountMinor;
    try { amountMinor = toMinorUnits(input.amount, currency); if (amountMinor <= 0) throw new RangeError('مبلغ التحصيل يجب أن يكون موجبًا.'); }
    catch (error) { throw new AppError(ERR.VALIDATION, error.message || 'مبلغ التحصيل غير صحيح.', {amount: error.message || 'مبلغ غير صحيح'}); }
    const amount = fromMinorUnits(amountMinor, currency);
    const plan = planFromInput({context, amount: input.amount, amountMinor, allocation: {...(input.allocation || {}), currency}});
    const now = Clock.now(), id = uid();
    const saved = await transaction(office.ctx, [STORE.executionLedger, STORE.executionAllocations, STORE.activityLog], async tx => {
      const ledgerStore = tx.objectStore(STORE.executionLedger);
      if (input.idempotencyKey) {
        const existing = await request(ledgerStore.index('idempotencyKey').get(String(input.idempotencyKey)));
        if (existing) {
          const existingAllocations = await request(tx.objectStore(STORE.executionAllocations).index('ledgerId').getAll(globalThis.IDBKeyRange.only(existing.id)));
          const allocated = sumMinor(existingAllocations.filter(row => !row.isDeleted && row.isActive !== false), row => row.amountMinor || 0);
          return {ledger: existing, allocations: existingAllocations, unallocated: fromMinorUnits(Math.max(0, (existing.amountMinor || 0) - allocated), currency), reused: true};
        }
      }
      const ledger = {
        id, executionId: input.executionId, fileId: execution.fileId || '', clientId: execution.clientId || '',
        type: 'COLLECTION', category: 'collection', amount, amountMinor, currency, date: input.date,
        paymentMethod: String(input.paymentMethod || '').trim(), receiptId: '', differenceRecordId: '', poaId: '',
        judgmentId: '', periodKey: '', documentReferenceId: input.documentReferenceId || '', includeInPoa: false,
        sourceType: 'direct', sourceId: '', ...(input.idempotencyKey ? {idempotencyKey: String(input.idempotencyKey)} : {}),
        adjustsLedgerId: '', adjustDirection: '', reason: '', notes: String(input.notes || '').trim(),
        createdBy: office.ctx?.profile?.id || 'user', createdAt: now, updatedAt: now, version: 1, isDeleted: false
      };
      const rows = [];
      await request(ledgerStore.add(ledger));
      for (const line of plan.lines) {
        const row = {
          id: uid(), executionId: input.executionId, ledgerId: ledger.id, receiptId: '', periodKey: line.periodKey,
          executionPartyId: line.partyId || '', judgmentId: line.judgmentId || '', entitlementType: line.entitlementType || '',
          amount: line.amount, amountMinor: line.amountMinor, currency, method: input.allocation?.method || 'DIRECT',
          isDifference: false, differenceRecordId: '', isActive: true, createdBy: office.ctx?.profile?.id || 'user',
          createdAt: now, version: 1, isDeleted: false
        };
        rows.push(row);
        await request(tx.objectStore(STORE.executionAllocations).add(row));
      }
      await request(tx.objectStore(STORE.activityLog).add(logRow(office, STORE.executionLedger, ledger.id, 'create', `تحصيل مباشر: ${amount} ${currency} بتاريخ ${input.date}${rows.length ? ` — ${rows.length} تخصيص` : ' — بلا تخصيص'}`, {fileId: ledger.fileId})));
      return {ledger, allocations: rows, unallocated: plan.unallocated, reused: false};
    });
    if (!saved.reused) events.emit('entity:changed', {entityType: STORE.executionLedger, id: saved.ledger.id});
    return saved;
  }
  const amount = round2(num(input.amount));
  if (!(amount > 0)) throw new AppError(ERR.VALIDATION, 'مبلغ التحصيل يجب أن يكون أكبر من صفر.', {amount: 'مطلوب'});
  const plan = planFromInput({context, amount, allocation: input.allocation || {}});
  const now = Clock.now();
  const ledger = await addLedgerEntry(office, {
    executionId: input.executionId, type: 'COLLECTION', amount, date: input.date, paymentMethod: input.paymentMethod || '',
    notes: input.notes || '', sourceType: 'direct', documentReferenceId: input.documentReferenceId || '', idempotencyKey: input.idempotencyKey || ''
  });
  const rows = [];
  for (const line of plan.lines) {
    const row = {
      id: uid(), executionId: input.executionId, ledgerId: ledger.id, receiptId: '', periodKey: line.periodKey,
      executionPartyId: line.partyId || '', judgmentId: line.judgmentId || '', entitlementType: line.entitlementType || '',
      amount: round2(line.amount), method: input.allocation?.method || 'DIRECT', isDifference: false, differenceRecordId: '',
      isActive: true, createdBy: office.ctx?.profile?.id || 'user', createdAt: now, version: 1, isDeleted: false
    };
    rows.push(row);
    await office.r.executionAllocations.put(row);
  }
  await office.log(STORE.executionLedger, ledger.id, 'update', execution.fileId || null);
  return {ledger, allocations: rows, unallocated: plan.unallocated};
}

/** ميزانية الحركات: أصل الدين مقابل المصروفات مقابل التصحيحات — منفصلة صراحةً. */
export async function ledgerBreakdown(office, executionId) {
  const rows = await executionLedgerRows(office, executionId);
  const net = netLedger(rows);
  const sum = filter => round2(net.filter(filter).reduce((total, row) => total + row.netAmount, 0));
  return {
    rows: net,
    collected: sum(row => isCollectionType(row.type)),
    expenses: sum(row => isExpenseType(row.type)),
    expensesInPoa: round2(net.filter(row => isExpenseType(row.type) && row.includeInPoa).reduce((total, row) => total + row.netAmount, 0)),
    differencesPosted: sum(row => row.type === 'DIFFERENCE_DUE'),
    corrections: round2(net.reduce((total, row) => total + (row.netAmount - num(row.amount)), 0)),
    byType: Object.fromEntries([...new Set(net.map(row => row.type))].map(type => [type, sum(row => row.type === type)])),
    collectedLabel: money(sum(row => isCollectionType(row.type))),
    expensesLabel: money(sum(row => isExpenseType(row.type)))
  };
}

export {outstandingPeriods, netLedger, ALLOCATION_METHOD_LABELS};
