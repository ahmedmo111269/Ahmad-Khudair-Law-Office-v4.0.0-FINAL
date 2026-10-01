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
  const [slices, allocations, ledger, differences] = await Promise.all([
    executionSlices(office, executionId),
    executionAllocations(office, executionId),
    executionLedgerRows(office, executionId),
    office.r.differenceRecords.byIndexAll('executionId', executionId)
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
  if (input.type === 'DIFFERENCE_DUE') throw new AppError(ERR.VALIDATION, 'فرق الاستحقاق لا يُسجَّل يدويًا كحركة: يُراجع ويُعتمد من شاشة التسويات ثم يُرحَّل.');
  const now = Clock.now();
  const row = {
    id: uid(),
    executionId: input.executionId,
    fileId: execution.fileId || '',
    clientId: execution.clientId || '',
    type: input.type,
    category: LEDGER_CATEGORY[input.type],
    amount: round2(num(input.amount)),
    currency: input.currency || 'جنيه',
    date: input.date,
    receiptId: input.receiptId || '',
    differenceRecordId: input.differenceRecordId || '',
    poaId: input.poaId || '',
    judgmentId: input.judgmentId || '',
    periodKey: input.periodKey || '',
    documentReferenceId: input.documentReferenceId || '',
    paymentMethod: String(input.paymentMethod || '').trim(),
    includeInPoa: isExpenseType(input.type) ? Boolean(input.includeInPoa) : false,
    sourceType: input.sourceType || 'manual',
    sourceId: input.sourceId || '',
    adjustsLedgerId: input.adjustsLedgerId || '',
    adjustDirection: input.adjustDirection === 'decrease' ? 'decrease' : (input.adjustDirection === 'increase' ? 'increase' : ''),
    reason: String(input.reason || '').trim(),
    notes: String(input.notes || '').trim(),
    createdBy: office.ctx?.profile?.id || 'user',
    createdAt: now,
    updatedAt: now,
    version: 1,
    isDeleted: false
  };
  if (input.type === 'REVERSAL' || input.type === 'ADJUSTMENT') {
    const original = await office.r.executionLedger.get(input.adjustsLedgerId);
    if (!original || original.isDeleted) throw new AppError(ERR.VALIDATION, 'لا يمكن إنشاء تصحيح أو عكس بدون حركة أصلية موجودة.');
    if (original.executionId !== input.executionId) throw new AppError(ERR.VALIDATION, 'الحركة الأصلية تتبع تنفيذًا آخر.');
    const siblings = await office.r.executionLedger.byIndexAll('executionId', input.executionId);
    const net = netLedger(siblings);
    const target = net.find(item => item.id === original.id);
    if (!target) throw new AppError(ERR.CONFLICT, 'تعذر قراءة الحركة الأصلية.');
    if (input.type === 'REVERSAL') {
      if (target.netAmount <= 0.001) throw new AppError(ERR.CONFLICT, 'هذه الحركة معكوسة بالكامل بالفعل؛ لا يُسمح بعكس مكرر.');
      if (round2(num(input.amount)) > target.netAmount + 0.001) throw new AppError(ERR.VALIDATION, `مبلغ العكس أكبر من صافي الحركة الأصلية (${target.netAmount}).`, {amount: 'أكبر من المتاح'});
    } else if (round2(num(input.amount)) > round2(num(original.amount)) + 0.001) {
      throw new AppError(ERR.VALIDATION, 'مبلغ التصحيح أكبر من مبلغ الحركة الأصلية.', {amount: 'أكبر من الأصل'});
    }
  }
  const out = await transaction(office.ctx, [STORE.executionLedger, STORE.activityLog], async tx => {
    await request(tx.objectStore(STORE.executionLedger).put(row));
    await request(tx.objectStore(STORE.activityLog).add(logRow(office, STORE.executionLedger, row.id, 'create', `${LEDGER_TYPE_LABELS[row.type] || row.type}: ${row.amount} بتاريخ ${row.date}${row.reason ? ' — ' + row.reason : ''}`, {fileId: row.fileId})));
    return row;
  });
  events.emit('entity:changed', {entityType: STORE.executionLedger, id: out.id});
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
  const record = {id: uid(), executionId, fileId: original.fileId || '', ledgerId, kind: 'REVERSAL', amount: reversal.amount, reason, status: 'POSTED', newLedgerId: reversal.id, createdAt: now, createdBy: office.ctx?.profile?.id || 'user', updatedAt: now, isDeleted: false};
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
  const record = {id: uid(), executionId, fileId: original.fileId || '', ledgerId, kind: 'ADJUSTMENT', amount: round2(num(amount)), direction, reason, status: 'POSTED', newLedgerId: adjustment.id, createdAt: now, createdBy: office.ctx?.profile?.id || 'user', updatedAt: now, isDeleted: false};
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
  const amount = round2(num(input.amount));
  if (!(amount > 0)) throw new AppError(ERR.VALIDATION, 'مبلغ التحصيل يجب أن يكون أكبر من صفر.', {amount: 'مطلوب'});
  if (!isIsoDate(input.date)) throw new AppError(ERR.VALIDATION, 'تاريخ التحصيل مطلوب.', {date: 'مطلوب'});
  const context = await allocationContext(office, input.executionId);
  const plan = planFromInput({context, amount, allocation: input.allocation || {}});
  const ledgerRow = {
    executionId: input.executionId, type: 'COLLECTION', amount, date: input.date,
    paymentMethod: input.paymentMethod || '', receiptId: '', poaId: input.poaId || '', documentReferenceId: input.documentReferenceId || '',
    sourceType: 'receipt', periodKey: '', notes: String(input.notes || '').trim(), currency: input.currency || 'جنيه'
  };
  const out = await transaction(office.ctx, [STORE.executionReceipts, STORE.executionLedger, STORE.executionAllocations, STORE.fileNumberCounters, STORE.activityLog], async tx => {
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
    await request(tx.objectStore(STORE.executionReceipts).put(receipt));
    await request(tx.objectStore(STORE.executionLedger).put(ledger));
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
  events.emit('entity:changed', {entityType: STORE.executionReceipts, id: out.receipt.id});
  events.emit('entity:changed', {entityType: STORE.executionLedger, id: out.ledger.id});
  return out;
}

function planFromInput({context, amount, allocation = {}}) {
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
  const plan = planFromInput({context, amount: receipt.amount, allocation});
  const now = Clock.now();
  const rows = [];
  await transaction(office.ctx, [STORE.executionAllocations, STORE.executionReceipts, STORE.activityLog], async tx => {
    for (const row of previous) await request(tx.objectStore(STORE.executionAllocations).put({...row, isActive: false, supersededAt: now, supersededBy: 'reallocation'}));
    for (const line of plan.lines) {
      const row = {
        id: uid(), executionId: receipt.executionId, ledgerId: receipt.ledgerId, receiptId, periodKey: line.periodKey,
        executionPartyId: line.partyId || '', judgmentId: line.judgmentId || '', entitlementType: line.entitlementType || '',
        amount: round2(line.amount), method: allocation.method || 'MANUAL', isDifference: false, differenceRecordId: '',
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
  const amount = round2(num(input.amount));
  if (!(amount > 0)) throw new AppError(ERR.VALIDATION, 'مبلغ التحصيل يجب أن يكون أكبر من صفر.', {amount: 'مطلوب'});
  if (!isIsoDate(input.date)) throw new AppError(ERR.VALIDATION, 'تاريخ التحصيل مطلوب.', {date: 'مطلوب'});
  const context = await allocationContext(office, input.executionId);
  const plan = planFromInput({context, amount, allocation: input.allocation || {}});
  const now = Clock.now();
  const ledger = await addLedgerEntry(office, {
    executionId: input.executionId, type: 'COLLECTION', amount, date: input.date, paymentMethod: input.paymentMethod || '',
    notes: input.notes || '', sourceType: 'direct', documentReferenceId: input.documentReferenceId || ''
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
