// =====================================================================
// خدمة التنفيذ — الكتابة والقراءة الأساسية (تنفيذ/أطراف/أحكام/شرائح قيمة/إجراءات)
// ---------------------------------------------------------------------
// • كل الكتابات تمر عبر Application Services ثم Repositories (قاعدة المشروع).
// • الأحكام تُسجَّل في مخزن judgments الموجود بحقول سلسلة إضافية (executionId،
//   previousJudgmentId، القيمة، تاريخ السريان) بدل إنشاء مخزن أحكام مكرر.
// • شرائح القيمة Append-Only: لا تُعدَّل شريحة تاريخية، والتغيير = شريحة جديدة.
// • لا يُستنتج تاريخ سريان من تاريخ حكم، ولا تُنشأ فترات مسبقًا (توليد كسول).
// =====================================================================
import {STORE} from '../db/schema.js';
import {transaction, request} from '../db/unit-of-work.js';
import {uid} from '../core/id.js';
import {Clock, localDate} from '../core/clock.js';
import {AppError, ERR} from '../core/errors.js';
import {events} from '../core/events.js';
import {normalizeArabic} from '../core/search-normalizer.js';
import {assertExpectedVersion} from './consistency.js';
import {
  num, round2, isIsoDate, todayIso, DEFAULT_PRORATION, ACTION_KIND_LABELS,
  validateExecution, validateValueSlice, EXECUTION_TYPE_LABELS, EXECUTION_STATUS_LABELS, PERIODICITY_LABELS
} from '../domain/execution.js';
import {buildEntitlementPeriods, analyzeSliceImpact, balanceSummary, executionAlerts, eligibleSlices} from '../domain/entitlement-engine.js';

const MAX_CHILD_ROWS = 2000;
const logRow = (office, entityType, entityId, action, summary, {fileId = null, metadata = {}} = {}) => {
  const row = {id: uid(), entityType, entityId, action, timestamp: Clock.now(), summary, metadata};
  if (fileId) row.fileId = fileId;
  return row;
};

// ===== التنفيذ =====
async function nextInternalNumber(tx, year) {
  const counters = tx.objectStore(STORE.fileNumberCounters);
  const id = `execution:${year}`;
  const counter = await request(counters.get(id));
  const next = (counter?.lastNumber || 0) + 1;
  await request(counters.put({id, year, kind: 'execution', lastNumber: next, updatedAt: Clock.now()}));
  return `EX-${year}-${String(next).padStart(4, '0')}`;
}

export async function saveExecution(office, input, id = null, expectedVersion = null) {
  const old = id ? await office.r.execution.get(id) : null;
  if (id && !old) throw new AppError(ERR.NOT_FOUND, 'سجل التنفيذ غير موجود.');
  if (old) assertExpectedVersion(old, expectedVersion, 'التنفيذ');
  const errors = validateExecution(input);
  if (Object.keys(errors).length) throw new AppError(ERR.VALIDATION, 'راجع بيانات التنفيذ.', errors);
  const now = Clock.now();
  const row = {
    ...(old || {}), ...input,
    id: id || uid(),
    executionType: input.executionType,
    executionMethod: input.executionMethod || old?.executionMethod || '',
    status: input.status || old?.status || 'active',
    prorationPolicy: input.prorationPolicy || old?.prorationPolicy || DEFAULT_PRORATION,
    entitlementThroughDate: isIsoDate(input.entitlementThroughDate) ? input.entitlementThroughDate : (old?.entitlementThroughDate || ''),
    createdAt: old?.createdAt || now,
    updatedAt: now,
    version: (old?.version || 0) + 1,
    isArchived: old?.isArchived || false,
    isDeleted: old?.isDeleted || false
  };
  // أكواد الربط: معرّفات فقط، تُنسخ من السجل الأصلي عند الربط ولا تُكرَّر بياناته.
  if (row.caseId) {
    const stage = await office.r.cases.get(row.caseId);
    if (!stage || stage.isDeleted) throw new AppError(ERR.VALIDATION, 'المرحلة القضائية المختارة غير متاحة.', {caseId: 'مرحلة غير موجودة'});
    if (row.fileId && stage.fileId && stage.fileId !== row.fileId) throw new AppError(ERR.VALIDATION, 'المرحلة المختارة لا تتبع الملف المحدد.', {caseId: 'مرحلة غير مطابقة للملف'});
    row.fileId = row.fileId || stage.fileId || '';
  }
  if (row.fileId) {
    const file = await office.r.files.get(row.fileId);
    if (!file || file.isDeleted) throw new AppError(ERR.VALIDATION, 'الملف القانوني المختار غير متاح.', {fileId: 'ملف غير موجود'});
  }
  if (row.clientId) {
    const client = await office.r.clients.get(row.clientId);
    if (!client || client.isDeleted) throw new AppError(ERR.NOT_FOUND, 'الموكل المختار غير موجود.');
  }
  const out = await transaction(office.ctx, [STORE.execution, STORE.fileNumberCounters, STORE.activityLog], async tx => {
    if (!row.internalNumber) row.internalNumber = await nextInternalNumber(tx, Number(String(row.openedDate || now).slice(0, 4)) || Number(now.slice(0, 4)));
    await request(tx.objectStore(STORE.execution).put(row));
    await request(tx.objectStore(STORE.activityLog).add(logRow(office, STORE.execution, row.id, id ? 'update' : 'create', `${id ? 'تحديث' : 'فتح'} تنفيذ ${row.internalNumber} (${EXECUTION_TYPE_LABELS[row.executionType] || ''})`, {fileId: row.fileId})));
    return row;
  });
  events.emit('entity:changed', {entityType: STORE.execution, id: out.id});
  if (out.fileId) events.emit('entity:changed', {entityType: STORE.files, id: out.fileId});
  // نص البحث مشتق (اسم الموكل/رقم الملف/أرقام الأحكام) — لا يُغيّر أي بيانات قانونية.
  await refreshExecutionSearchText(office, out.id).catch(() => null);
  return out;
}

export const createExecution = (office, input) => saveExecution(office, input, null, null);

/** أطراف التنفيذ: من يستحق (الدائن/المستحق) ومن يُنفَّذ ضده (المدين)، بصفات يسجلها المستخدم. */
export async function saveExecutionParty(office, input, id = null) {
  const old = id ? await office.r.executionParties.get(id) : null;
  if (id && !old) throw new AppError(ERR.NOT_FOUND, 'طرف التنفيذ غير موجود.');
  if (!input.executionId) throw new AppError(ERR.VALIDATION, 'يجب تحديد التنفيذ.', {executionId: 'مطلوب'});
  const execution = await office.r.execution.get(input.executionId);
  if (!execution || execution.isDeleted) throw new AppError(ERR.NOT_FOUND, 'سجل التنفيذ غير موجود.');
  const name = String(input.name ?? old?.name ?? '').trim();
  const client = input.clientId ? await office.r.clients.get(input.clientId) : null;
  const opponent = input.opponentId ? await office.r.opponents.get(input.opponentId) : null;
  const displayName = name || client?.fullName || opponent?.name || '';
  if (!displayName) throw new AppError(ERR.VALIDATION, 'اسم الطرف مطلوب.', {name: 'اسم الطرف مطلوب'});
  const now = Clock.now();
  const siblings = await office.r.executionParties.byIndexAll('executionId', input.executionId);
  const row = {
    ...(old || {}), ...input,
    id: id || uid(),
    executionId: input.executionId,
    fileId: execution.fileId || '',
    clientId: input.clientId || old?.clientId || '',
    opponentId: input.opponentId || old?.opponentId || '',
    name: displayName,
    nameNormalized: normalizeArabic(displayName),
    partyKind: input.partyKind || old?.partyKind || (client ? 'client' : opponent ? 'opponent' : 'other'),
    role: input.role || old?.role || (input.side === 'debtor' ? 'منفذ ضده' : 'مستحق'),
    side: input.side || old?.side || 'creditor',
    share: input.share === '' || input.share === undefined || input.share === null ? (old?.share ?? '') : num(input.share),
    sequence: input.sequence ? Number(input.sequence) : (old?.sequence || siblings.length + 1),
    isActive: input.isActive === undefined ? (old?.isActive ?? true) : Boolean(input.isActive),
    createdAt: old?.createdAt || now,
    updatedAt: now,
    version: (old?.version || 0) + 1,
    isDeleted: old?.isDeleted || false
  };
  await transaction(office.ctx, [STORE.executionParties, STORE.activityLog], async tx => {
    await request(tx.objectStore(STORE.executionParties).put(row));
    await request(tx.objectStore(STORE.activityLog).add(logRow(office, STORE.executionParties, row.id, id ? 'update' : 'create', `${id ? 'تحديث' : 'إضافة'} طرف تنفيذ: ${displayName} (${row.role})`, {fileId: row.fileId})));
  });
  events.emit('entity:changed', {entityType: STORE.executionParties, id: row.id});
  await refreshExecutionSearchText(office, row.executionId).catch(() => null);
  return row;
}

// ===== سلسلة الأحكام =====
export async function executionJudgments(office, executionId, limit = 500) {
  const rows = await office.r.judgments.byIndexAll('executionId', executionId);
  return rows.slice(0, limit).sort((a, b) => Number(a.sequence || 0) - Number(b.sequence || 0) || String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
}

/**
 * إضافة حكم إلى سلسلة التنفيذ: الحكم القديم لا يُعدَّل، والجديد يحمل previousJudgmentId.
 * تاريخ الحكم ≠ تاريخ سريان القيمة: الحقلان مستقلان ولا يُشتق أحدهما من الآخر.
 */
export async function addExecutionJudgment(office, input) {
  const execution = await office.r.execution.get(input.executionId);
  if (!execution || execution.isDeleted) throw new AppError(ERR.NOT_FOUND, 'سجل التنفيذ غير موجود.');
  const errors = {};
  if (!input.entitlementType) errors.entitlementType = 'نوع الاستحقاق مطلوب للحكم الذي يحدد قيمة.';
  if (!isIsoDate(input.judgmentDate)) errors.judgmentDate = 'تاريخ الحكم مطلوب.';
  if (input.amount !== undefined && input.amount !== '' && !(num(input.amount) > 0)) errors.amount = 'قيمة الحكم يجب أن تكون أكبر من صفر.';
  if (input.effectiveFrom && !isIsoDate(input.effectiveFrom)) errors.effectiveFrom = 'تاريخ سريان القيمة غير صحيح.';
  if (input.effectiveTo && !isIsoDate(input.effectiveTo)) errors.effectiveTo = 'تاريخ انتهاء السريان غير صحيح.';
  if (input.effectiveTo && input.effectiveFrom && input.effectiveTo < input.effectiveFrom) errors.effectiveTo = 'تاريخ انتهاء السريان قبل تاريخ بدايته.';
  if (Object.keys(errors).length) throw new AppError(ERR.VALIDATION, 'راجع بيانات الحكم.', errors);
  const chain = await executionJudgments(office, input.executionId);
  const previous = input.previousJudgmentId ? chain.find(row => row.id === input.previousJudgmentId) || null : chain.at(-1) || null;
  if (input.previousJudgmentId && !previous) throw new AppError(ERR.VALIDATION, 'الحكم السابق المحدد غير موجود في هذه السلسلة.');
  const now = Clock.now();
  const row = {
    id: uid(),
    executionId: input.executionId,
    fileId: execution.fileId || '',
    caseId: input.caseId || execution.caseId || '',
    entitlementType: input.entitlementType,
    sequence: chain.length + 1,
    previousJudgmentId: previous?.id || '',
    judgmentKind: input.judgmentKind || 'later',
    judgmentDate: input.judgmentDate,
    judgmentNumber: String(input.judgmentNumber || '').trim(),
    lawsuitNumber: String(input.lawsuitNumber || '').trim(),
    appealNumber: String(input.appealNumber || '').trim(),
    caseYear: String(input.caseYear || '').trim(),
    court: input.court || '',
    chamber: String(input.chamber || '').trim(),
    stage: input.stage || '',
    judgmentType: input.judgmentType || '',
    judgmentStatus: input.judgmentStatus || '',
    noticeDate: isIsoDate(input.noticeDate) ? input.noticeDate : '',
    appealFiledDate: isIsoDate(input.appealFiledDate) ? input.appealFiledDate : '',
    effectiveFrom: isIsoDate(input.effectiveFrom) ? input.effectiveFrom : '',
    effectiveTo: isIsoDate(input.effectiveTo) ? input.effectiveTo : '',
    valueType: input.valueType === 'fixed' ? 'fixed' : 'periodic',
    periodicity: input.periodicity || '',
    amount: input.amount === '' || input.amount === undefined ? null : round2(num(input.amount)),
    operativeSummary: String(input.operativeSummary || '').trim(),
    documentReferenceId: input.documentReferenceId || '',
    notes: String(input.notes || '').trim(),
    createdAt: now,
    createdBy: office.ctx?.profile?.id || 'user',
    updatedAt: now,
    isDeleted: false
  };
  await transaction(office.ctx, [STORE.judgments, STORE.activityLog], async tx => {
    await request(tx.objectStore(STORE.judgments).put(row));
    await request(tx.objectStore(STORE.activityLog).add(logRow(office, STORE.judgments, row.id, 'create', `تسجيل حكم ${row.judgmentKind === 'original' ? 'أصلي' : 'لاحق'} للتنفيذ (${row.judgmentNumber || 'بلا رقم'})`, {fileId: row.fileId})));
  });
  events.emit('entity:changed', {entityType: STORE.judgments, id: row.id});
  await refreshExecutionSearchText(office, row.executionId).catch(() => null);
  return row;
}

/** تعديل وصفي فقط: القيمة وتاريخ السريان لا يُعدَّلان بعد ربط شريحة قيمة بالحكم. */
export async function updateExecutionJudgment(office, id, input) {
  const old = await office.r.judgments.get(id);
  if (!old || old.isDeleted) throw new AppError(ERR.NOT_FOUND, 'الحكم غير موجود.');
  const slices = (await office.r.executionValuePeriods.byIndexAll('linkedJudgmentId', id));
  const locked = slices.length > 0;
  const row = {...old, ...input, id, updatedAt: Clock.now(), version: (old.version || 0) + 1};
  if (locked) {
    const changedMoney = (input.amount !== undefined && round2(num(input.amount)) !== round2(num(old.amount))) ||
      (input.effectiveFrom !== undefined && input.effectiveFrom !== old.effectiveFrom) ||
      (input.effectiveTo !== undefined && input.effectiveTo !== old.effectiveTo) ||
      (input.previousJudgmentId !== undefined && input.previousJudgmentId !== old.previousJudgmentId);
    if (changedMoney) throw new AppError(ERR.CONFLICT, 'لا يمكن تعديل قيمة حكم أو تاريخ سريان مربوط بشريحة قيمة. سجّل حكمًا لاحقًا بشريحة جديدة، أو ألغِ الشريحة ثم أنشئ غيرها.');
  }
  if (row.effectiveFrom && row.effectiveTo && row.effectiveTo < row.effectiveFrom) throw new AppError(ERR.VALIDATION, 'تاريخ انتهاء السريان قبل تاريخ بدايته.', {effectiveTo: 'تاريخ غير صحيح'});
  await transaction(office.ctx, [STORE.judgments, STORE.activityLog], async tx => {
    await request(tx.objectStore(STORE.judgments).put(row));
    await request(tx.objectStore(STORE.activityLog).add(logRow(office, STORE.judgments, id, 'update', `تحديث بيانات حكم (${row.judgmentNumber || ''})`, {fileId: row.fileId})));
  });
  events.emit('entity:changed', {entityType: STORE.judgments, id});
  return row;
}

// ===== شرائح القيمة (Value Periods) =====
export async function executionSlices(office, executionId, {asOf = ''} = {}) {
  const rows = await office.r.executionValuePeriods.byIndexAll('executionId', executionId);
  const list = rows.filter(row => !row.isDeleted);
  return asOf ? eligibleSlices(list, asOf) : list;
}

/**
 * شريحة قيمة جديدة. لا تُعدَّل شريحة تاريخية أبدًا: التصحيح = إلغاء الشريحة
 * (بحالة مسجلة) + إنشاء شريحة جديدة. ترجع الشريحة وأثرها المتوقع على الفترات.
 */
export async function saveValueSlice(office, input) {
  const execution = await office.r.execution.get(input.executionId);
  if (!execution || execution.isDeleted) throw new AppError(ERR.NOT_FOUND, 'سجل التنفيذ غير موجود.');
  const judgment = input.judgmentId ? await office.r.judgments.get(input.judgmentId) : null;
  if (!judgment || judgment.isDeleted) throw new AppError(ERR.VALIDATION, 'الحكم المصدر مطلوب لكل شريحة قيمة.', {judgmentId: 'حكم غير موجود'});
  if (judgment.executionId && judgment.executionId !== input.executionId) throw new AppError(ERR.VALIDATION, 'الحكم المختار يتبع تنفيذًا آخر.', {judgmentId: 'حكم غير مطابق'});
  const existing = (await executionSlices(office, input.executionId)).filter(slice => slice.id !== input.id);
  if (input.partyId) {
    const party = await office.r.executionParties.get(input.partyId);
    if (!party || party.isDeleted || party.executionId !== input.executionId) throw new AppError(ERR.VALIDATION, 'المستحق المختار لهذه الشريحة لا يتبع هذا التنفيذ.', {partyId: 'طرف غير موجود'});
  }
  const errors = validateValueSlice(input, {existing});
  // التداخل مع شريحة مفتوحة لنفس النوع: يُشتق حدّ الشريحة السابقة من الشريحة الجديدة بلا تعديلها،
  // لذلك نسمح بالتداخل فقط عندما تكون الشريحة الجديدة أحدث (تُسجَّل لاحقًا) وتكون بدايتها بعد بداية السابقة.
  if (errors.startDate && existing.some(slice => String(slice.entitlementType) === String(input.entitlementType) && slice.startDate <= input.startDate && !slice.endDate)) {
    delete errors.startDate;
  }
  if (Object.keys(errors).length) throw new AppError(ERR.VALIDATION, 'راجع بيانات شريحة القيمة.', errors);
  const now = Clock.now();
  const row = {
    id: uid(),
    executionId: input.executionId,
    fileId: execution.fileId || '',
    clientId: execution.clientId || '',
    // رقم تسلسل لكل شريحة: يجعل ترتيب «الأحدث» حتميًا بلا الاعتماد على وقت التسجيل وحده
    sequence: existing.reduce((max, slice) => Math.max(max, Number(slice.sequence || 0)), 0) + 1,
    entitlementType: String(input.entitlementType).trim(),
    partyId: input.partyId || '',
    judgmentId: input.judgmentId,
    linkedJudgmentId: input.judgmentId,
    valueType: input.valueType === 'fixed' ? 'fixed' : 'periodic',
    amount: round2(num(input.amount)),
    currency: input.currency || 'جنيه',
    periodicity: input.valueType === 'fixed' ? 'fixed' : (input.periodicity || 'monthly'),
    customDays: input.periodicity === 'custom' ? Math.max(1, Math.floor(num(input.customDays) || 1)) : null,
    anchor: input.anchor || input.startDate || '',
    startDate: input.startDate,
    endDate: isIsoDate(input.endDate) ? input.endDate : '',
    proration: input.proration || execution.prorationPolicy || DEFAULT_PRORATION,
    status: input.status || 'active',
    sourceReference: String(input.sourceReference || '').trim(),
    notes: String(input.notes || '').trim(),
    needsReview: Boolean(input.needsReview),
    createdAt: now,
    createdBy: office.ctx?.profile?.id || 'user',
    updatedAt: now,
    version: 1,
    isDeleted: false
  };
  await transaction(office.ctx, [STORE.executionValuePeriods, STORE.activityLog], async tx => {
    await request(tx.objectStore(STORE.executionValuePeriods).put(row));
    await request(tx.objectStore(STORE.activityLog).add(logRow(office, STORE.executionValuePeriods, row.id, 'create', `شريحة قيمة: ${row.entitlementType} ${row.amount} من ${row.startDate}${row.valueType === 'fixed' ? ' (مبلغ ثابت)' : ` (${PERIODICITY_LABELS[row.periodicity] || ''})`}`, {fileId: row.fileId})));
  });
  events.emit('entity:changed', {entityType: STORE.executionValuePeriods, id: row.id});
  const impact = await previewSliceImpact(office, input.executionId, row);
  return {...row, __impact: impact};
}

/** معاينة أثر شريحة على الفترات (قراءة فقط، لا تكتب شيئًا). */
export async function previewSliceImpact(office, executionId, slice) {
  const execution = await office.r.execution.get(executionId);
  const slices = await executionSlices(office, executionId);
  const allocations = await executionAllocations(office, executionId);
  const through = execution?.entitlementThroughDate || '';
  return analyzeSliceImpact({slices, newSlice: slice, allocations, throughDate: through, policy: execution?.prorationPolicy || DEFAULT_PRORATION});
}

/** إلغاء شريحة قيمة: حالة مسجلة بسبب — الشريحة تبقى في السجل التاريخي ولا تُحذف. */
export async function cancelValueSlice(office, id, reason = '') {
  const old = await office.r.executionValuePeriods.get(id);
  if (!old || old.isDeleted) throw new AppError(ERR.NOT_FOUND, 'شريحة القيمة غير موجودة.');
  if (old.status === 'cancelled') throw new AppError(ERR.CONFLICT, 'هذه الشريحة ملغاة بالفعل.');
  const now = Clock.now();
  const row = {...old, status: 'cancelled', cancelledAt: now, cancelReason: String(reason || '').trim(), updatedAt: now, version: (old.version || 0) + 1};
  await transaction(office.ctx, [STORE.executionValuePeriods, STORE.activityLog], async tx => {
    await request(tx.objectStore(STORE.executionValuePeriods).put(row));
    await request(tx.objectStore(STORE.activityLog).add(logRow(office, STORE.executionValuePeriods, id, 'cancel', `إلغاء شريحة قيمة ${row.entitlementType} (${row.amount} من ${row.startDate})${row.cancelReason ? ' — السبب: ' + row.cancelReason : ''}`, {fileId: row.fileId})));
  });
  events.emit('entity:changed', {entityType: STORE.executionValuePeriods, id});
  return row;
}

// ===== الإجراءات اللاحقة =====
export async function saveExecutionAction(office, input, id = null) {
  const old = id ? await office.r.executionActions.get(id) : null;
  if (id && !old) throw new AppError(ERR.NOT_FOUND, 'إجراء التنفيذ غير موجود.');
  const execution = await office.r.execution.get(input.executionId);
  if (!execution || execution.isDeleted) throw new AppError(ERR.NOT_FOUND, 'سجل التنفيذ غير موجود.');
  const errors = {};
  if (!input.kind) errors.kind = 'نوع الإجراء مطلوب.';
  else if (!ACTION_KIND_LABELS[input.kind]) errors.kind = 'نوع الإجراء غير معروف: اختر حجزًا أو إعلان بيع أو جلسة بيع أو تبديدًا أو رقم عرائض أو رقمًا قضائيًا.';
  if (!isIsoDate(input.date)) errors.date = 'تاريخ الإجراء مطلوب.';
  if (input.resultFileId && !String(input.resultFileId).trim()) errors.resultFileId = 'الملف المرتبط غير صحيح.';
  if (Object.keys(errors).length) throw new AppError(ERR.VALIDATION, 'راجع بيانات الإجراء.', errors);
  const now = Clock.now();
  const existing = await office.r.executionActions.byIndexAll('executionId', input.executionId);
  const row = {
    ...(old || {}), ...input,
    id: id || uid(),
    executionId: input.executionId,
    fileId: execution.fileId || '',
    clientId: execution.clientId || '',
    kind: input.kind,
    kindLabel: ACTION_KIND_LABELS[input.kind] || input.kind,
    date: input.date,
    referenceNumber: String(input.referenceNumber || '').trim(),
    authority: String(input.authority || '').trim(),
    judicialNumber: String(input.judicialNumber || '').trim(),
    petitionNumber: String(input.petitionNumber || '').trim(),
    status: input.status || old?.status || 'done',
    resultFileId: input.resultFileId || old?.resultFileId || '',
    sequence: input.sequence ? Number(input.sequence) : (old?.sequence || existing.length + 1),
    notes: String(input.notes || '').trim(),
    createdAt: old?.createdAt || now,
    updatedAt: now,
    version: (old?.version || 0) + 1,
    isDeleted: old?.isDeleted || false
  };
  await transaction(office.ctx, [STORE.executionActions, STORE.activityLog], async tx => {
    await request(tx.objectStore(STORE.executionActions).put(row));
    await request(tx.objectStore(STORE.activityLog).add(logRow(office, STORE.executionActions, row.id, id ? 'update' : 'create', `${id ? 'تحديث' : 'تسجيل'} إجراء تنفيذ: ${row.kind}${row.referenceNumber ? ' — رقم ' + row.referenceNumber : ''}`, {fileId: row.fileId})));
  });
  events.emit('entity:changed', {entityType: STORE.executionActions, id: row.id});
  return row;
}

/**
 * إنشاء ملف قانوني ناتج عن إجراء تنفيذ (مثلًا قضية جنائية ناتجة عن التبديد) باستخدام
 * نظام الملفات الموجود ثم ربطه بالملف الأصلي عبر fileRelations — لا تُنشأ قضية داخل التنفيذ.
 */
export async function createResultFile(office, {executionId, actionId = '', title, fileType = '', relationType = 'ناتج عن'} = {}) {
  const execution = await office.r.execution.get(executionId);
  if (!execution || execution.isDeleted) throw new AppError(ERR.NOT_FOUND, 'سجل التنفيذ غير موجود.');
  if (!execution.fileId) throw new AppError(ERR.VALIDATION, 'لا يمكن إنشاء ملف مرتبط قبل ربط التنفيذ بملف قانوني.');
  const {createLegalFile, saveRelation} = await import('./legal-files.js');
  const file = await createLegalFile(office, {
    title: title || `ملف ناتج عن تنفيذ ${execution.internalNumber || ''}`.trim(),
    fileType: fileType || '',
    status: 'مفتوح',
    openedAt: localDate()
  });
  const relation = await saveRelation(office, {sourceFileId: file.id, targetFileId: execution.fileId, relationType, notes: `مرتبط بإجراء تنفيذ ${execution.internalNumber || ''}`});
  if (actionId) await saveExecutionAction(office, {...(await office.r.executionActions.get(actionId)), executionId, resultFileId: file.id}, actionId);
  await office.log(STORE.execution, executionId, 'create', execution.fileId || null);
  return {file, relation};
}

// ===== قراءات مشتركة =====
export async function executionAllocations(office, executionId, limit = MAX_CHILD_ROWS) {
  return office.r.executionAllocations.byIndex('executionId', executionId, Math.min(limit, 5000));
}
export async function executionLedgerRows(office, executionId, limit = MAX_CHILD_ROWS) {
  const rows = await office.r.executionLedger.byIndex('executionId', executionId, Math.min(limit, 5000));
  return rows.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || String(a.id).localeCompare(String(b.id)));
}
export async function executionReceipts(office, executionId, limit = MAX_CHILD_ROWS) {
  const rows = await office.r.executionReceipts.byIndexAll('executionId', executionId);
  return rows.slice(0, limit).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
}
export async function executionDifferences(office, executionId, limit = MAX_CHILD_ROWS) {
  const rows = await office.r.differenceRecords.byIndexAll('executionId', executionId);
  return rows.slice(0, limit).sort((a, b) => String(a.periodKey || '').localeCompare(String(b.periodKey || '')));
}
export async function executionSettlements(office, executionId) {
  const rows = await office.r.executionSettlements.byIndexAll('executionId', executionId);
  return rows.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}
export async function executionPoaRows(office, executionId) {
  const rows = await office.r.executionPOAs.byIndexAll('executionId', executionId);
  return rows.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
}
export async function executionActionRows(office, executionId) {
  const rows = await office.r.executionActions.byIndexAll('executionId', executionId);
  return rows.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || Number(a.sequence || 0) - Number(b.sequence || 0));
}
export async function executionPartyRows(office, executionId) {
  const rows = await office.r.executionParties.byIndexAll('executionId', executionId);
  return rows.sort((a, b) => Number(a.sequence || 0) - Number(b.sequence || 0) || String(a.name || '').localeCompare(String(b.name || '')));
}
export async function executionAdjustmentRows(office, executionId) {
  const rows = await office.r.executionAdjustments.byIndexAll('executionId', executionId);
  return rows.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
}

/**
 * ملخص التنفيذ: مشتق بالكامل من الشرائح والحركات والتخصيصات والفروق.
 * لا يوجد حقل رصيد يدوي: أي عرض للرصيد يمر من هنا.
 */
export async function summarizeExecution(office, execution, {asOf = '', throughDate = ''} = {}) {
  if (!execution) return null;
  const through = throughDate || execution.entitlementThroughDate || '';
  const [slices, allocations, ledger, differences] = await Promise.all([
    executionSlices(office, execution.id, {asOf}),
    executionAllocations(office, execution.id),
    executionLedgerRows(office, execution.id),
    executionDifferences(office, execution.id)
  ]);
  const build = buildEntitlementPeriods({slices, asOf, to: through, maxPeriods: 1200, policy: execution.prorationPolicy || DEFAULT_PRORATION});
  const scopedAllocations = asOf ? allocations.filter(row => !row.createdAt || String(row.createdAt) <= `${asOf}T23:59:59.999Z`) : allocations;
  const scopedLedger = asOf ? ledger.filter(row => !row.date || String(row.date) <= asOf) : ledger;
  const scopedDifferences = asOf ? differences.filter(row => !row.createdAt || String(row.createdAt) <= `${asOf}T23:59:59.999Z`) : differences;
  const summary = balanceSummary({periods: build.periods, allocations: scopedAllocations, ledger: scopedLedger, differences: scopedDifferences, asOf});
  const current = slices.slice().sort((a, b) => String(a.startDate || '').localeCompare(String(b.startDate || ''))).at(-1) || null;
  const latestLedger = scopedLedger.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))[0] || null;
  return {
    ...summary,
    truncated: build.truncated,
    entitlementKeys: build.entitlementKeys,
    currentValue: current ? {amount: current.amount, entitlementType: current.entitlementType, startDate: current.startDate, judgmentId: current.judgmentId} : null,
    lastPeriod: build.periods.at(-1) || null,
    lastLedger: latestLedger ? {date: latestLedger.date, type: latestLedger.type, amount: latestLedger.netAmount ?? latestLedger.amount} : null
  };
}

/** حزمة قراءة واحدة لبطاقة التنفيذ (كل الأقسام) — قراءات مفهرسة ومحدودة. */
export async function executionBundle(office, executionId, {asOf = '', throughDate = ''} = {}) {
  const execution = await office.r.execution.get(executionId);
  if (!execution || execution.isDeleted) return null;
  const [parties, judgments, slices, allocations, ledger, receipts, differences, settlements, poas, actions, adjustments] = await Promise.all([
    executionPartyRows(office, executionId),
    executionJudgments(office, executionId),
    executionSlices(office, executionId, {asOf}),
    executionAllocations(office, executionId),
    executionLedgerRows(office, executionId),
    executionReceipts(office, executionId),
    executionDifferences(office, executionId),
    executionSettlements(office, executionId),
    executionPoaRows(office, executionId),
    executionActionRows(office, executionId),
    executionAdjustmentRows(office, executionId)
  ]);
  const through = throughDate || execution.entitlementThroughDate || '';
  const build = buildEntitlementPeriods({slices, asOf, to: through, maxPeriods: 1200, policy: execution.prorationPolicy || DEFAULT_PRORATION});
  const scoped = {
    allocations: asOf ? allocations.filter(row => !row.createdAt || String(row.createdAt) <= `${asOf}T23:59:59.999Z`) : allocations,
    ledger: asOf ? ledger.filter(row => !row.date || String(row.date) <= asOf) : ledger,
    differences: asOf ? differences.filter(row => !row.createdAt || String(row.createdAt) <= `${asOf}T23:59:59.999Z`) : differences
  };
  const summary = balanceSummary({periods: build.periods, allocations: scoped.allocations, ledger: scoped.ledger, differences: scoped.differences, asOf});
  const alerts = executionAlerts({execution, slices, judgments, periods: build.periods, ledger: scoped.ledger, receipts, allocations: scoped.allocations, differences: scoped.differences, poas, actions, summary});
  const current = slices.slice().sort((a, b) => String(a.startDate || '').localeCompare(String(b.startDate || ''))).at(-1) || null;
  const latestLedger = scoped.ledger.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))[0] || null;
  const lastReceipt = receipts[0] || null;
  const lastPoa = poas.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))[0] || null;
  const lastAction = actions.at(-1) || null;
  return {
    execution, parties, judgments, slices, allocations, ledger, receipts, differences, settlements, poas, actions, adjustments,
    periods: build.periods,
    truncated: build.truncated,
    summary: {
      ...summary,
      truncated: build.truncated,
      entitlementKeys: build.entitlementKeys,
      currentValue: current ? {amount: current.amount, entitlementType: current.entitlementType, startDate: current.startDate, judgmentId: current.judgmentId} : null,
      lastPeriod: build.periods.at(-1) || null,
      lastLedger: latestLedger ? {date: latestLedger.date, type: latestLedger.type, amount: latestLedger.netAmount ?? latestLedger.amount} : null,
      lastReceipt, lastPoa, lastAction
    },
    alerts
  };
}

/**
 * صفوف مركز التنفيذ: قراءة cursor محدودة + ملخصات محسوبة للصفوف المعروضة فقط،
 * ثم نموذج عرض مسطّح للأعمدة العامة (رقم التنفيذ/الموكل/الملف/النوع/الحكم/القيمة الحالية/
 * آخر فترة/المحصل/المتبقي/فرق الحكم/آخر توكيل/آخر محضر/الحالة/آخر إجراء) — بلا دمج أي حقلين.
 */
export async function executionListRow(office, execution, {withSummary = true, summary = undefined} = {}) {
  const summaryRow = summary !== undefined ? summary : (withSummary ? await summarizeExecution(office, execution) : null);
  const client = execution.clientId ? await office.r.clients.get(execution.clientId).catch(() => null) : null;
  const file = execution.fileId ? await office.r.files.get(execution.fileId).catch(() => null) : null;
  const judgments = await office.r.judgments.byIndexAll('executionId', execution.id).catch(() => []);
  const chain = judgments.filter(row => !row.isDeleted).slice().sort((a, b) => Number(a.sequence || 0) - Number(b.sequence || 0));
  const latest = chain.at(-1) || null;
  return {
    id: execution.id,
    execution,
    summary: summaryRow,
    internalNumber: execution.internalNumber || execution.executionNumber || '',
    officialNumber: execution.officialNumber || '',
    clientId: execution.clientId || '', clientName: client?.fullName || client?.name || '',
    fileId: execution.fileId || '', fileNumber: file?.fileNumber || '', fileTitle: file?.title || '',
    executionType: execution.executionType || '', executionTypeLabel: EXECUTION_TYPE_LABELS[execution.executionType] || 'غير محدد',
    status: execution.status || '', statusLabel: EXECUTION_STATUS_LABELS[execution.status] || execution.status || '—',
    authority: execution.authority || execution.executionOffice || '',
    judgmentLabel: latest ? `${latest.judgmentNumber || ''}${latest.judgmentDate ? ' ' + latest.judgmentDate : ''}`.trim() : '',
    judgmentDate: latest?.judgmentDate || execution.judgmentDate || '',
    judgmentsCount: chain.length,
    currentValue: summaryRow?.currentValue?.amount ?? 0,
    currentValueType: summaryRow?.currentValue?.entitlementType || '',
    lastPeriod: summaryRow?.lastPeriod?.key || '',
    collected: summaryRow?.collected ?? 0,
    balance: summaryRow?.remaining ?? 0,
    judgmentDifference: summaryRow?.differencePart ?? 0,
    expenses: summaryRow?.expenses ?? 0,
    lastPoa: summaryRow?.lastPoa ? (summaryRow.lastPoa.poaNumber || summaryRow.lastPoa.id) : '',
    lastReceipt: summaryRow?.lastReceipt ? (summaryRow.lastReceipt.receiptNumber || summaryRow.lastReceipt.id) : '',
    lastAction: summaryRow?.lastAction ? (summaryRow.lastAction.kindLabel || summaryRow.lastAction.kind || '') + (summaryRow.lastAction.referenceNumber ? ' — ' + summaryRow.lastAction.referenceNumber : '') : '',
    lastReviewDate: execution.nextReviewDate || '',
    needsReview: Boolean(execution.needsReview || execution.isArchived === false && execution.needsReview),
    openedDate: execution.openedDate || ''
  };
}

/** نموذج العرض المسطّح لمجموعة تنفيذات (يُستخدم من مركز التنفيذ أثناء ترقيم المؤشر). */
export async function hydrateExecutionRows(office, executions = [], {withSummary = true, summarize = true} = {}) {
  // ملخصات الصفوف المعروضة فقط، وبالتوازي — لا حساب لكل التنفيذات في المخزن.
  if (summarize && withSummary) {
    const summaries = await Promise.all(executions.map(execution => summarizeExecution(office, execution)));
    return Promise.all(executions.map((execution, index) => executionListRow(office, execution, {summary: summaries[index]})));
  }
  return Promise.all(executions.map(execution => executionListRow(office, execution, {withSummary: false})));
}

/**
 * صفوف مركز التنفيذ: قراءة cursor محدودة + ملخصات محسوبة للصفوف المعروضة فقط،
 * ثم نموذج عرض مسطّح للأعمدة العامة (رقم التنفيذ/الموكل/الملف/النوع/الحكم/القيمة الحالية/
 * آخر فترة/المحصل/المتبقي/فرق الحكم/آخر توكيل/آخر محضر/الحالة/آخر إجراء) — بلا دمج أي حقلين.
 */
export async function listExecutionRows(office, {limit = 25, cursor = null, index = 'openedDate', direction = 'prev', filter = null, withSummary = true} = {}) {
  const page = await office.r.execution.page({index, cursor, direction, limit: Math.min(Math.max(1, limit), 100), filter});
  const rows = await hydrateExecutionRows(office, page.items, {withSummary});
  return {rows, nextCursor: page.nextCursor, hasMore: page.hasMore, hasPrev: page.hasPrev, total: page.items.length};
}

/** مؤشرات مركز التنفيذ على عيّنة محدودة ومعلنة (لا ادعاء إحصاء كامل بلا حساب). */
export async function executionCenterStats(office, {sample = 300} = {}) {
  office.ctx.assert();
  const page = await office.r.execution.page({index: 'openedDate', direction: 'prev', limit: Math.min(100, sample)});
  const buckets = {
    total: 0, byType: {civil: 0, criminal: 0, family: 0, unknown: 0}, byStatus: {},
    needsFollowUp: 0, reviewOverdue: 0, partialCollection: 0, completed: 0, differencesUnpaid: 0, settlementsAwaitingReview: 0, alerts: 0
  };
  const today = todayIso();
  const sampleRows = [];
  for (const execution of page.items) {
    const info = await executionBundle(office, execution.id);
    if (!info) continue;
    const {summary, alerts} = info;
    buckets.total += 1;
    const typeKey = EXECUTION_TYPE_LABELS[execution.executionType] ? execution.executionType : 'unknown';
    buckets.byType[typeKey] = (buckets.byType[typeKey] || 0) + 1;
    buckets.byStatus[execution.status || 'not_started'] = (buckets.byStatus[execution.status || 'not_started'] || 0) + 1;
    if (alerts.some(alert => alert.code === 'review_overdue') || (execution.nextReviewDate && execution.nextReviewDate <= today)) buckets.needsFollowUp += 1;
    if (execution.nextReviewDate && execution.nextReviewDate < today) buckets.reviewOverdue += 1;
    if (summary.collected > 0 && summary.remaining > 0.005) buckets.partialCollection += 1;
    if (summary.remaining <= 0.005 && summary.finalEntitlement > 0) buckets.completed += 1;
    if ((num(summary.differences.approved) + num(summary.differences.pending)) > 0 && summary.remaining > 0.005) buckets.differencesUnpaid += 1;
    if (info.differences.some(row => ['DRAFT', 'PENDING_REVIEW'].includes(row.status))) buckets.settlementsAwaitingReview += 1;
    if (alerts.length) buckets.alerts += 1;
    sampleRows.push({execution, summary, alerts});
  }
  return {...buckets, sampledRows: sampleRows, sampleSize: page.items.length, hasMore: page.hasMore};
}

/**
 * نص بحث مشتق للتنفيذ: اسم الموكل + رقم الملف + أرقام الأحكام والاستئناف + الأرقام الرسمية.
 * يخزّن نصًا مُطبَّعًا فقط (بلا نسخ بيانات قانونية إلى سجل آخر) ليجد البحث بالاسم التنفيذَ نفسه.
 */
export async function refreshExecutionSearchText(office, executionId) {
  const execution = await office.r.execution.get(executionId);
  if (!execution || execution.isDeleted) return null;
  const parts = [
    execution.internalNumber, execution.officialNumber, execution.executionNumber,
    EXECUTION_TYPE_LABELS[execution.executionType] || '', execution.authority, execution.executionOffice
  ];
  if (execution.clientId) {
    const client = await office.r.clients.get(execution.clientId);
    if (client) parts.push(client.fullName, ...(Array.isArray(client.phones) ? client.phones : []), client.phone || '');
  }
  if (execution.fileId) {
    const file = await office.r.files.get(execution.fileId);
    if (file) parts.push(file.title, file.fileNumber);
  }
  const judgments = await office.r.judgments.byIndexAll('executionId', executionId).catch(() => []);
  for (const judgment of judgments) parts.push(judgment.judgmentNumber, judgment.lawsuitNumber, judgment.appealNumber, judgment.court, judgment.entitlementType);
  const parties = await office.r.executionParties.byIndexAll('executionId', executionId).catch(() => []);
  for (const party of parties) parts.push(party.name, party.role);
  const searchText = normalizeArabic(parts.filter(Boolean).join(' '));
  const row = {...execution, searchText, searchTextNormalized: searchText, searchIndexedAt: Clock.now()};
  await office.r.execution.put(row);
  return row;
}

export {round2};
