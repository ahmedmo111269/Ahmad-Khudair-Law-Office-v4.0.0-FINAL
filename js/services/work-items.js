// =====================================================================
// مركز العمل — خدمة الأوامر (Application Service). كل كتابة تمر من هنا ثم إلى المستودعات/الخدمات الأصلية.
// ---------------------------------------------------------------------
// • المهمة الجديدة = صف مستقل في workItems (kind='native').
// • الجلسة/العمل الإداري/الموعد/المتابعة… = سجلات أصلية؛ مركز العمل يكتب نتيجة الفعل في السجل الأصلي عبر
//   خدمته الرسمية (saveOperational) والطبقة التشغيلية (kind='overlay') داخل المعاملة نفسها: ينجح الاثنان أو يُلغيان.
// • لا نسخ لأي بيانات قانونية. الحذف حذف منطقي للمهام المستقلة فقط؛ السجل الأصلي لا يُحذف من هنا أبدًا.
// • سجل النشاط الموجود (activityLog) هو السجل الوحيد؛ لا بيانات شخصية خام في metadata.
// =====================================================================
import {STORE} from '../db/schema.js';
import {transaction, request} from '../db/unit-of-work.js';
import {uid} from '../core/id.js';
import {Clock} from '../core/clock.js';
import {AppError, ERR} from '../core/errors.js';
import {events} from '../core/events.js';
import {saveOperational} from './operations.js';
import {assertExpectedVersion} from './consistency.js';
import {
  WORK_KIND, TASK_SOURCE, overlayId, parseOverlayId, isIsoDate, normalizeTime, validateNativeInput, normalizeTags,
  normalizeRule, expandRecurrence, COMMENT_TYPE_KEYS, PRIORITY_KEYS, snoozeTarget, mergeStatuses, isOpenStatus, statusInfo
} from '../domain/work-items.js';
import {workSource} from '../domain/work-sources.js';
import {getWorkConfig} from './work-config.js';
import {ensureWorkStatuses} from './work-statuses.js';

const WI = STORE.workItems, WC = STORE.workItemComments, WR = STORE.workItemRecurrences;
const nowIso = () => Clock.now();
const changed = id => events.emit('entity:changed', {entityType: WI, id});

// ---------- مساعدات ----------
export const VIRTUAL_PREFIX = 'rec::';
export function parseItemRef(ref) {
  const id = typeof ref === 'string' ? ref : ref?.id;
  if (!id) throw new AppError(ERR.VALIDATION, 'عنصر العمل غير محدد.');
  if (id.startsWith(VIRTUAL_PREFIX)) {
    const [, defId, date] = id.split('::');
    return {kind: 'virtual', id, defId, date};
  }
  const overlay = parseOverlayId(id);
  return overlay ? {kind: 'projected', id, ...overlay} : {kind: 'native', id};
}

function activityRow(entityId, action, summary, {fileId = null, metadata = {}} = {}) {
  return {id: uid(), entityType: 'workItems', entityId, action, timestamp: nowIso(), summary, metadata, ...(fileId ? {fileId} : {})};
}
const logTx = (tx, entry) => request(tx.objectStore(STORE.activityLog).add(entry));

const blankOverlay = (sourceType, sourceId, dueDate = '') => ({
  id: overlayId(sourceType, sourceId), kind: WORK_KIND.overlay, sourceType, sourceId, dueDate: dueDate || '',
  status: null, priority: null, tags: [], pinnedAt: null, quadrant: null, originalDueDate: '', postponeCount: 0, commentCount: 0,
  completedAt: null, completedBy: null, completedFor: null, cancelledAt: null, cancelledFor: null, statusBeforeComplete: null,
  archivedAt: null, isArchived: false, isDeleted: false, createdAt: nowIso(), updatedAt: nowIso(), version: 1
});
const blankComment = (workItemId, {type, body}) => ({
  id: uid(), workItemId, type: COMMENT_TYPE_KEYS.includes(type) ? type : 'note', body: String(body ?? '').trim().slice(0, 5000),
  createdAt: nowIso(), createdBy: 'user', updatedAt: nowIso(), version: 1, isDeleted: false
});

/** يقرأ حالة السجل الأصلي والطبقة بالقيم الحالية (لا نثق بنسخة الواجهة). */
async function loadProjected(office, ref) {
  const source = workSource(ref.sourceType);
  if (!source) throw new AppError(ERR.VALIDATION, 'نوع مصدر العمل غير مدعوم.');
  const [row, overlay] = await Promise.all([office.r[source.store].get(ref.sourceId), office.r.workItems.getManyRaw([ref.id]).then(r => r[0] || null)]);
  const live = Boolean(row) && !row.isDeleted && !row.isArchived;
  return {source, row: live ? row : null, overlay, live};
}
async function loadNative(office, ref) {
  const row = await office.r.workItems.get(ref.id);
  if (!row || row.kind !== WORK_KIND.native) throw new AppError(ERR.NOT_FOUND, 'المهمة غير موجودة أو محذوفة.');
  return row;
}
const requireSource = ctx => { if (!ctx.live) throw new AppError(ERR.NOT_FOUND, 'المصدر غير متاح حاليًا؛ يمكنك الاحتفاظ بالعنصر أو أرشفته فقط.'); };
const requireCap = (source, cap, text) => { if (!source.caps?.[cap]) throw new AppError(ERR.VALIDATION, text || 'هذا الإجراء غير متاح لهذا النوع من العناصر؛ افتح السجل الأصلي لتنفيذه.'); };

function overlayWriter(sourceType, sourceId, dueDate, mutate, {comment = null} = {}) {
  return async tx => {
    const os = tx.objectStore(WI), id = overlayId(sourceType, sourceId);
    const cur = await request(os.get(id));
    const next = cur ? {...cur} : blankOverlay(sourceType, sourceId, dueDate);
    if (dueDate && !next.dueDate) next.dueDate = dueDate;
    mutate(next, cur);
    if (comment?.body) {
      const row = blankComment(id, comment);
      await request(tx.objectStore(WC).add(row));
      next.commentCount = (next.commentCount || 0) + 1;
    }
    next.updatedAt = nowIso(); next.version = (cur?.version || 0) + 1;
    await request(os.put(next));
    return next;
  };
}

/** يكتب في السجل الأصلي (إن لزم) والطبقة وسجل النشاط داخل معاملة واحدة. */
async function commitProjected(office, ctx, ref, {patch = null, adjourn = false, mutate, summary, action, comment = null, dueDate = null, metadata = {}}) {
  const {source, row} = ctx;
  const when = dueDate ?? (row ? String(source.dateOf(row) || '').slice(0, 10) : (ctx.overlay?.dueDate || ''));
  const writer = overlayWriter(ref.sourceType, ref.sourceId, when, mutate, {comment});
  const entry = activityRow(ref.id, action, summary, {metadata: {sourceType: ref.sourceType, ...metadata}});
  const hook = async tx => { await writer(tx); await logTx(tx, entry); };
  if (patch && Object.keys(patch).length && source.writer === 'operational') {
    requireSource(ctx);
    await saveOperational(office, source.store, patch, ref.sourceId, {extraStores: [WI, WC], withinTransaction: hook});
  } else if (patch && Object.keys(patch).length && source.writer === 'file') {
    requireSource(ctx);
    await transaction(office.ctx, [STORE.files, WI, WC, STORE.activityLog], async tx => {
      const files = tx.objectStore(STORE.files), file = await request(files.get(ref.sourceId));
      if (!file || file.isDeleted) throw new AppError(ERR.NOT_FOUND, 'الملف غير متاح.');
      const at = nowIso();
      Object.assign(file, patch, {updatedAt: at, lastActivityAt: at, version: (file.version || 0) + 1});
      await request(files.put(file));
      await hook(tx);
    });
    events.emit('entity:changed', {entityType: STORE.files, id: ref.sourceId});
  } else {
    await transaction(office.ctx, [WI, WC, STORE.activityLog], hook);
  }
  changed(ref.id);
  return {ok: true, id: ref.id};
}

async function commitNative(office, row, entry, {comment = null} = {}) {
  const next = {...row, updatedAt: nowIso(), version: (row.version || 0) + 1};
  await transaction(office.ctx, [WI, WC, STORE.activityLog], async tx => {
    if (comment?.body) { await request(tx.objectStore(WC).add(blankComment(row.id, comment))); next.commentCount = (next.commentCount || 0) + 1; }
    await request(tx.objectStore(WI).put(next));
    await logTx(tx, {...entry, ...(row.fileId ? {fileId: row.fileId} : {})});
  });
  changed(row.id);
  return next;
}

// ---------- التحقق من الروابط (معرّفات فقط) ----------
const RELATED_STORES = ['hearings', 'procedures', 'appointments', 'communications', 'judgments', 'serviceRecords', 'expertReports', 'execution', 'caseNotes', 'powersOfAttorney'];
async function liveRow(office, store, id) {
  if (!id) return null;
  const row = await office.r[store].get(id);
  return row && !row.isDeleted ? row : null;
}
/** يتحقق من الروابط ويكمّل معرّفات الملف/القضية/الموكل من السجل المرتبط دون نسخ أي نص قانوني. */
export async function resolveLinks(office, data) {
  const out = {...data};
  if (out.relatedType) {
    if (!RELATED_STORES.includes(out.relatedType)) throw new AppError(ERR.VALIDATION, 'نوع السجل المرتبط غير مدعوم.', {relatedType: 'غير مدعوم'});
    const related = await liveRow(office, out.relatedType, out.relatedId);
    if (!related) throw new AppError(ERR.NOT_FOUND, 'السجل المرتبط غير موجود.', {relatedId: 'غير موجود'});
    out.fileId ||= related.fileId || '';
    out.caseId ||= related.caseId || related.stageId || '';
    out.clientId ||= related.clientId || '';
  }
  if (out.caseId) {
    const stage = await liveRow(office, 'cases', out.caseId);
    if (!stage) throw new AppError(ERR.NOT_FOUND, 'القضية / المرحلة غير موجودة.', {caseId: 'غير موجودة'});
    if (out.fileId && stage.fileId && stage.fileId !== out.fileId) throw new AppError(ERR.VALIDATION, 'القضية لا تتبع الملف المحدد.', {caseId: 'لا تتبع هذا الملف'});
    out.fileId ||= stage.fileId || '';
  }
  if (out.fileId && !(await liveRow(office, 'files', out.fileId))) throw new AppError(ERR.NOT_FOUND, 'الملف غير موجود.', {fileId: 'غير موجود'});
  if (out.clientId && !(await liveRow(office, 'clients', out.clientId))) throw new AppError(ERR.NOT_FOUND, 'الموكل غير موجود.', {clientId: 'غير موجود'});
  if (out.opponentId && !(await liveRow(office, 'opponents', out.opponentId))) throw new AppError(ERR.NOT_FOUND, 'الخصم غير موجود.', {opponentId: 'غير موجود'});
  return out;
}

// ---------- إنشاء/تعديل المهام المستقلة ----------
/** إنشاء/تعديل مهمة مستقلة. `recurFreq` تُنشئ تعريف تكرار بدل صف واحد (التوليد كسول). */
export async function saveWorkItem(office, input, id = null, expectedVersion = null) {
  if (!id && input?.recurFreq) return createRecurringTask(office, input);
  await ensureWorkStatuses(office);
  const config = getWorkConfig();
  const statusKeys = mergeStatuses(config).map(s => s.key);
  const old = id ? await office.r.workItems.get(id) : null;
  if (id && (!old || old.kind !== WORK_KIND.native)) throw new AppError(ERR.NOT_FOUND, 'المهمة غير موجودة.');
  if (old) assertExpectedVersion(old, expectedVersion, 'المهمة');
  // حالة المهمة الحالية تُقبل كما هي ولو تقاعدت (حُذفت من القائمة)؛ أما اختيار حالة متقاعدة جديدة فمرفوض.
  const {errors, data} = validateNativeInput({...(old || {}), ...input}, {statuses: old?.status ? [...statusKeys, old.status] : statusKeys});
  if (Object.keys(errors).length) throw new AppError(ERR.VALIDATION, 'راجع بيانات المهمة.', errors);
  const linked = await resolveLinks(office, data);
  const at = nowIso(), rowId = id || uid();
  // Quick Notes تتحول إلى Work Item موجود في مركز العمل نفسه؛ لا ننشئ نظام مهام آخر.
  // المصدر مميز كي تكون العملية idempotent ويمكن الرجوع للملاحظة الأصلية.
  const sourceType = old?.sourceType || (input.sourceType === 'QUICK_NOTE' ? 'QUICK_NOTE' : TASK_SOURCE);
  const sourceId = old?.sourceId || input.sourceId || rowId;
  const row = {
    ...(old || {}), ...linked, id: rowId, kind: WORK_KIND.native, sourceType, sourceId,
    createdAt: old?.createdAt || at, updatedAt: at, version: (old?.version || 0) + 1,
    isArchived: old?.isArchived || false, isDeleted: false, deletedAt: null,
    postponeCount: old?.postponeCount || 0, commentCount: old?.commentCount || 0, originalDueDate: old?.originalDueDate || '',
    createdBy: old?.createdBy || 'user', assigneeId: old?.assigneeId ?? null, visibility: old?.visibility || 'office',   // مقاعد للصلاحيات المستقبلية
    pinnedAt: old?.pinnedAt ?? null, quadrant: input.quadrant !== undefined ? (input.quadrant || null) : (old?.quadrant ?? null),
    completedAt: old?.completedAt ?? null, completedBy: old?.completedBy ?? null, archivedAt: old?.archivedAt ?? null,
    recurrenceId: old?.recurrenceId || input.recurrenceId || '', occurrenceDate: old?.occurrenceDate || input.occurrenceDate || ''
  };
  // تغيير الموعد من نموذج التعديل يُحتسب إعادة جدولة (يحفظ الموعد الأصلي دون زيادة عدّاد التأجيل).
  if (old && old.dueDate && row.dueDate !== old.dueDate && !row.originalDueDate) row.originalDueDate = old.dueDate;
  if (row.status === 'done' && !row.completedAt) { row.completedAt = at; row.completedBy = 'user'; }
  if (row.status !== 'done') { row.completedAt = null; row.completedBy = null; }
  await transaction(office.ctx, [WI, STORE.activityLog], async tx => {
    await request(tx.objectStore(WI).put(row));
    await logTx(tx, activityRow(rowId, id ? 'update' : 'create', id ? 'تحديث مهمة' : 'إنشاء مهمة', {fileId: row.fileId || null}));
  });
  changed(rowId);
  return row;
}

// ---------- الإنجاز / إعادة الفتح / الإلغاء ----------
async function resolveVirtual(office, ref) {
  if (ref.kind !== 'virtual') return ref;
  const row = await materializeOccurrence(office, ref.defId, ref.date);
  return {kind: 'native', id: row.id};
}

export async function completeItem(office, refInput, {by = 'user'} = {}) {
  let ref = await resolveVirtual(office, parseItemRef(refInput));
  const at = nowIso();
  if (ref.kind === 'native') {
    const row = await loadNative(office, ref);
    if (row.status === 'done') return {ok: true, id: row.id, unchanged: true};
    await commitNative(office, {...row, status: 'done', statusBeforeComplete: row.status || 'notStarted', completedAt: at, completedBy: by},
      activityRow(row.id, 'complete', 'إنجاز مهمة', {metadata: {from: row.status || 'notStarted'}}));
    return {ok: true, id: row.id};
  }
  const ctx = await loadProjected(office, ref);
  requireCap(ctx.source, 'complete');
  requireSource(ctx);
  const due = String(ctx.source.dateOf(ctx.row) || '').slice(0, 10);
  return commitProjected(office, ctx, ref, {
    patch: ctx.source.patch.complete?.(ctx.row) || null, action: 'complete', summary: 'إنجاز عنصر عمل', dueDate: due,
    mutate: o => { o.statusBeforeComplete = o.status || null; o.status = null; o.completedAt = at; o.completedBy = by; o.completedFor = due; o.cancelledAt = null; o.cancelledFor = null; }
  });
}

export async function reopenItem(office, refInput) {
  await ensureWorkStatuses(office);
  const ref = await resolveVirtual(office, parseItemRef(refInput));
  if (ref.kind === 'native') {
    const row = await loadNative(office, ref);
    if (row.status !== 'done' && row.status !== 'cancelled') return {ok: true, id: row.id, unchanged: true};
    const back = row.statusBeforeComplete && row.statusBeforeComplete !== 'done' && row.statusBeforeComplete !== 'cancelled' ? row.statusBeforeComplete : 'notStarted';
    await commitNative(office, {...row, status: back, completedAt: null, completedBy: null}, activityRow(row.id, 'reopen', 'إعادة فتح مهمة', {metadata: {to: back}}));
    return {ok: true, id: row.id};
  }
  const ctx = await loadProjected(office, ref);
  requireCap(ctx.source, 'reopen');
  requireSource(ctx);
  const config = getWorkConfig();
  return commitProjected(office, ctx, ref, {
    patch: ctx.source.patch.reopen?.(ctx.row) || null, action: 'reopen', summary: 'إعادة فتح عنصر عمل',
    mutate: o => { o.status = o.statusBeforeComplete && isOpenStatus(o.statusBeforeComplete, config) ? o.statusBeforeComplete : null; o.completedAt = null; o.completedBy = null; o.completedFor = null; o.cancelledAt = null; o.cancelledFor = null; }
  });
}

export async function cancelItem(office, refInput, {reason = ''} = {}) {
  const ref = await resolveVirtual(office, parseItemRef(refInput));
  const at = nowIso();
  const comment = reason ? {type: 'note', body: `سبب الإلغاء: ${reason}`} : null;
  if (ref.kind === 'native') {
    const row = await loadNative(office, ref);
    if (row.status === 'cancelled') return {ok: true, id: row.id, unchanged: true};
    await commitNative(office, {...row, status: 'cancelled', statusBeforeComplete: row.status === 'done' ? row.statusBeforeComplete : (row.status || 'notStarted'), completedAt: null, completedBy: null},
      activityRow(row.id, 'cancel', 'إلغاء مهمة', {metadata: {from: row.status || 'notStarted'}}), {comment});
    return {ok: true, id: row.id};
  }
  const ctx = await loadProjected(office, ref);
  requireCap(ctx.source, 'cancel');
  requireSource(ctx);
  const due = String(ctx.source.dateOf(ctx.row) || '').slice(0, 10);
  return commitProjected(office, ctx, ref, {
    patch: ctx.source.patch.cancel?.(ctx.row) || null, action: 'cancel', summary: 'إلغاء عنصر عمل', dueDate: due, comment,
    mutate: o => { o.statusBeforeComplete = o.status || null; o.status = null; o.cancelledAt = at; o.cancelledFor = due; o.completedAt = null; o.completedBy = null; o.completedFor = null; }
  });
}

// ---------- التأجيل وإعادة الجدولة ----------
function assertDate(date, {allowPast = true, today = Clock.today()} = {}) {
  if (!isIsoDate(date)) throw new AppError(ERR.VALIDATION, 'التاريخ غير صحيح.', {date: 'تاريخ غير صحيح'});
  if (!allowPast && date < today) throw new AppError(ERR.VALIDATION, 'لا يمكن التأجيل إلى تاريخ سابق لليوم.', {date: 'تاريخ سابق'});
  return date;
}

/** تأجيل: يحفظ الموعد الأصلي ويزيد عدّاد التأجيل. الجلسة تُؤجَّل رسميًا داخل سجلها (adjournedTo) فتُنشأ جلستها التالية. */
export async function postponeItem(office, refInput, {date, option = '', reason = '', time = null} = {}) {
  const today = Clock.today();
  const target = option && option !== 'custom' ? snoozeTarget(option, today) : date;
  assertDate(target, {allowPast: false, today});
  const ref = await resolveVirtual(office, parseItemRef(refInput));
  const comment = reason ? {type: 'postponeReason', body: reason} : null;
  if (ref.kind === 'native') {
    const row = await loadNative(office, ref);
    if (row.status === 'done' || row.status === 'cancelled') throw new AppError(ERR.VALIDATION, 'لا يمكن تأجيل مهمة مكتملة أو ملغاة؛ أعد فتحها أولًا.');
    if (row.dueDate === target) throw new AppError(ERR.VALIDATION, 'الموعد الجديد مطابق للموعد الحالي.', {date: 'نفس الموعد'});
    const next = {...row, dueDate: target, ...(time !== null ? {dueTime: normalizeTime(time)} : {}), originalDueDate: row.originalDueDate || row.dueDate || '', postponeCount: (row.postponeCount || 0) + 1, lastPostponedAt: nowIso(), status: 'postponed'};
    await commitNative(office, next, activityRow(row.id, 'postpone', 'تأجيل مهمة', {metadata: {count: next.postponeCount}}), {comment});
    return {ok: true, id: row.id, dueDate: target};
  }
  const ctx = await loadProjected(office, ref);
  requireCap(ctx.source, 'postpone');
  requireSource(ctx);
  const current = String(ctx.source.dateOf(ctx.row) || '').slice(0, 10);
  if (current === target) throw new AppError(ERR.VALIDATION, 'الموعد الجديد مطابق للموعد الحالي.', {date: 'نفس الموعد'});
  const adjourn = Boolean(ctx.source.caps.adjourn && ctx.source.patch.adjourn);
  const patch = adjourn ? ctx.source.patch.adjourn(ctx.row, target, reason)
    : (ctx.source.patch.postpone || ctx.source.patch.reschedule)(ctx.row, target, reason);
  return commitProjected(office, ctx, ref, {
    patch, action: 'postpone', summary: adjourn ? 'تأجيل جلسة (سُجّل في سجل الجلسة)' : 'تأجيل عنصر عمل', dueDate: target, comment, metadata: {count: (ctx.overlay?.postponeCount || 0) + 1},
    mutate: o => {
      o.originalDueDate = o.originalDueDate || current; o.postponeCount = (o.postponeCount || 0) + 1; o.lastPostponedAt = nowIso();
      if (!adjourn) { o.dueDate = target; o.completedAt = null; o.completedFor = null; }
      o.status = adjourn ? null : 'postponed';
    }
  });
}

/** إعادة جدولة (تعديل الموعد دون احتسابه تأجيلًا). */
export async function rescheduleItem(office, refInput, {date, time = null} = {}) {
  assertDate(date);
  const ref = await resolveVirtual(office, parseItemRef(refInput));
  if (ref.kind === 'native') {
    const row = await loadNative(office, ref);
    const next = {...row, dueDate: date, ...(time !== null ? {dueTime: normalizeTime(time)} : {}), originalDueDate: row.originalDueDate || row.dueDate || ''};
    await commitNative(office, next, activityRow(row.id, 'reschedule', 'إعادة جدولة مهمة'));
    return {ok: true, id: row.id, dueDate: date};
  }
  const ctx = await loadProjected(office, ref);
  requireCap(ctx.source, 'reschedule');
  requireSource(ctx);
  const current = String(ctx.source.dateOf(ctx.row) || '').slice(0, 10);
  return commitProjected(office, ctx, ref, {
    patch: ctx.source.patch.reschedule?.(ctx.row, date) || null, action: 'reschedule', summary: 'إعادة جدولة عنصر عمل', dueDate: date,
    mutate: o => { o.originalDueDate = o.originalDueDate || current; o.dueDate = date; }
  });
}

// ---------- الحالة والأولوية والتثبيت والوسوم ----------
export async function setItemStatus(office, refInput, key) {
  await ensureWorkStatuses(office);
  const config = getWorkConfig();
  const info = statusInfo(key, config);
  if (info.unknown) throw new AppError(ERR.VALIDATION, 'حالة غير معروفة.');
  if (info.retired) throw new AppError(ERR.VALIDATION, 'هذه الحالة محذوفة من القائمة؛ اختر حالة أخرى.');
  if (info.kind === 'done') return completeItem(office, refInput);
  if (info.kind === 'cancelled') return cancelItem(office, refInput);
  const ref = await resolveVirtual(office, parseItemRef(refInput));
  if (ref.kind === 'native') {
    const row = await loadNative(office, ref);
    if (row.status === key) return {ok: true, id: row.id, unchanged: true};
    await commitNative(office, {...row, status: key, completedAt: null, completedBy: null}, activityRow(row.id, 'status', 'تغيير حالة مهمة', {metadata: {from: row.status, to: key}}));
    return {ok: true, id: row.id};
  }
  const ctx = await loadProjected(office, ref);
  // الحالات التشغيلية (قيد التنفيذ/بانتظار/مؤجل) تُحفظ في الطبقة لكل المصادر؛ وإن كان للمصدر مفهوم مقابل (الأعمال الإدارية) يُكتب فيه أيضًا.
  const patch = ctx.source.caps.setStatus ? ctx.source.patch.setStatus?.(ctx.row, key) || null : null;
  return commitProjected(office, ctx, ref, {
    patch, action: 'status', summary: 'تغيير حالة عنصر عمل', metadata: {to: key},
    mutate: o => { o.status = key === 'notStarted' || (key === 'waiting' && patch) ? null : key; o.completedAt = null; o.completedFor = null; }
  });
}

export async function setItemPriority(office, refInput, priority) {
  if (!PRIORITY_KEYS.includes(priority)) throw new AppError(ERR.VALIDATION, 'أولوية غير معروفة.');
  const ref = await resolveVirtual(office, parseItemRef(refInput));
  if (ref.kind === 'native') {
    const row = await loadNative(office, ref);
    if (row.priority === priority) return {ok: true, id: row.id, unchanged: true};
    await commitNative(office, {...row, priority}, activityRow(row.id, 'priority', 'تغيير أولوية مهمة', {metadata: {from: row.priority, to: priority}}));
    return {ok: true, id: row.id};
  }
  const ctx = await loadProjected(office, ref);
  return commitProjected(office, ctx, ref, {action: 'priority', summary: 'تغيير أولوية عنصر عمل', metadata: {to: priority}, mutate: o => { o.priority = priority; }});
}

export async function setPinned(office, refInput, pinned = true) {
  const ref = await resolveVirtual(office, parseItemRef(refInput));
  if (ref.kind === 'native') {
    const row = await loadNative(office, ref);
    if (Boolean(row.pinnedAt) === Boolean(pinned)) return {ok: true, id: row.id, unchanged: true};
    await commitNative(office, {...row, pinnedAt: pinned ? nowIso() : null}, activityRow(row.id, pinned ? 'pin' : 'unpin', pinned ? 'تثبيت مهمة' : 'إلغاء تثبيت مهمة'));
    return {ok: true, id: row.id};
  }
  const ctx = await loadProjected(office, ref);
  return commitProjected(office, ctx, ref, {action: pinned ? 'pin' : 'unpin', summary: pinned ? 'تثبيت عنصر عمل' : 'إلغاء تثبيت عنصر عمل', mutate: o => { o.pinnedAt = pinned ? nowIso() : null; }});
}

export async function setItemTags(office, refInput, tags) {
  const clean = normalizeTags(tags);
  const ref = await resolveVirtual(office, parseItemRef(refInput));
  if (ref.kind === 'native') {
    const row = await loadNative(office, ref);
    await commitNative(office, {...row, tags: clean}, activityRow(row.id, 'tags', 'تعديل وسوم مهمة'));
    return {ok: true, id: row.id, tags: clean};
  }
  const ctx = await loadProjected(office, ref);
  await commitProjected(office, ctx, ref, {action: 'tags', summary: 'تعديل وسوم عنصر عمل', mutate: o => { o.tags = clean; }});
  return {ok: true, id: ref.id, tags: clean};
}

export async function setItemQuadrant(office, refInput, quadrant) {
  const value = ['q1', 'q2', 'q3', 'q4'].includes(quadrant) ? quadrant : null;
  const ref = await resolveVirtual(office, parseItemRef(refInput));
  if (ref.kind === 'native') {
    const row = await loadNative(office, ref);
    await commitNative(office, {...row, quadrant: value}, activityRow(row.id, 'quadrant', 'تغيير تصنيف المصفوفة', {metadata: {to: value || 'auto'}}));
    return {ok: true, id: row.id};
  }
  const ctx = await loadProjected(office, ref);
  return commitProjected(office, ctx, ref, {action: 'quadrant', summary: 'تغيير تصنيف المصفوفة', metadata: {to: value || 'auto'}, mutate: o => { o.quadrant = value; }});
}

/** تحويل ملاحظة سريعة إلى مهمة أصلية في مركز العمل، مع منع الإنشاء المكرر عند إعادة المحاولة. */
export async function saveWorkItemFromQuickNote(office, note, {force = false} = {}) {
  if (!note?.id) throw new AppError(ERR.VALIDATION, 'الملاحظة غير محددة.');
  const existing = await office.r.workItems.byIndex('sourceId', note.id, 100)
    .then(rows => rows.find(row => row.kind === WORK_KIND.native && row.sourceType === 'QUICK_NOTE' && !row.isDeleted))
    .catch(() => null);
  if (existing && !force) return {row: existing, reused: true};
  // Capture links are intentionally stored in quickNoteLinks as well as the
  // canonical direct fields. Resolve them here so conversion to the existing
  // Work Center preserves approved context without copying note content into
  // another store as a second Notes/Tasks system.
  const links = office.r.quickNoteLinks ? await office.r.quickNoteLinks.byIndex('noteId', note.id, 100).catch(() => []) : [];
  const firstLink = type => links.find(link => link.entityType === type)?.entityId || '';
  const row = await saveWorkItem(office, {
    title: String(note.title || note.content || 'ملاحظة سريعة').trim().slice(0, 500),
    description: String(note.content || '').trim().slice(0, 5000),
    dueDate: String(note.dueAt || '').slice(0, 10),
    priority: note.priority === 'URGENT' ? 'urgent' : note.priority === 'HIGH' ? 'high' : note.priority === 'LOW' ? 'low' : 'medium',
    status: 'notStarted',
    tags: Array.isArray(note.tagIds) ? note.tagIds.join(', ') : String(note.tags || ''),
    fileId: note.fileId || firstLink('LEGAL_FILE'),
    caseId: note.caseId || firstLink('CASE'),
    clientId: note.clientId || firstLink('CLIENT'),
    sourceType: 'QUICK_NOTE', sourceId: note.id
  });
  return {row, reused: false};
}

// ---------- الأرشفة والحذف ----------
export async function archiveItem(office, refInput) {
  const ref = parseItemRef(refInput);
  if (ref.kind === 'virtual') throw new AppError(ERR.VALIDATION, 'لا يمكن أرشفة تكرار لم يُنشأ بعد؛ أنهِ التكرار بدلًا من ذلك.');
  if (ref.kind === 'native') {
    await loadNative(office, ref);
    const row = await office.archive(WI, ref.id);
    return {ok: true, id: row.id};
  }
  const ctx = await loadProjected(office, ref);
  return commitProjected(office, ctx, ref, {action: 'archive', summary: 'أرشفة عنصر عمل', mutate: o => { o.isArchived = true; o.archivedAt = nowIso(); }});
}
export async function restoreItem(office, refInput) {
  const ref = parseItemRef(refInput);
  if (ref.kind === 'native') {
    const row = await office.r.workItems.get(ref.id);
    if (!row) throw new AppError(ERR.NOT_FOUND, 'المهمة غير موجودة.');
    await office.restore(WI, ref.id);
    return {ok: true, id: ref.id};
  }
  const ctx = await loadProjected(office, ref);
  return commitProjected(office, ctx, ref, {action: 'restore', summary: 'استعادة عنصر عمل من الأرشيف', mutate: o => { o.isArchived = false; o.archivedAt = null; }});
}
/** حذف منطقي للمهام المستقلة فقط. السجلات الأصلية لا تُحذف من مركز العمل. */
export async function deleteItem(office, refInput) {
  const ref = parseItemRef(refInput);
  if (ref.kind !== 'native') throw new AppError(ERR.VALIDATION, 'لا يمكن حذف سجل أصلي من مركز العمل. أرشِف العنصر لإخفائه، أو احذف السجل الأصلي من صفحته.');
  await loadNative(office, ref);
  const row = await office.softDelete(WI, ref.id);
  return {ok: true, id: row.id};
}
export async function undoDelete(office, id) {
  const row = await office.r.workItems.getManyRaw([id]).then(r => r[0]);
  if (!row || row.kind !== WORK_KIND.native) throw new AppError(ERR.NOT_FOUND, 'المهمة غير موجودة.');
  const next = {...row, isDeleted: false, deletedAt: null, deletedBy: null, updatedAt: nowIso(), version: (row.version || 0) + 1};
  await transaction(office.ctx, [WI, STORE.activityLog], async tx => {
    await request(tx.objectStore(WI).put(next));
    await logTx(tx, activityRow(id, 'restore', 'التراجع عن حذف مهمة', {fileId: row.fileId || null}));
  });
  changed(id);
  return {ok: true, id};
}

// ---------- التعليقات والملاحظات ----------
export async function addComment(office, refInput, {type = 'note', body} = {}) {
  const text = String(body ?? '').trim();
  if (!text) throw new AppError(ERR.VALIDATION, 'نص التعليق مطلوب.', {body: 'مطلوب'});
  const ref = await resolveVirtual(office, parseItemRef(refInput));
  if (ref.kind === 'native') {
    const row = await loadNative(office, ref);
    const next = await commitNative(office, row, activityRow(row.id, 'comment', 'إضافة تعليق'), {comment: {type, body: text}});
    return {ok: true, id: next.id};
  }
  const ctx = await loadProjected(office, ref);
  return commitProjected(office, ctx, ref, {action: 'comment', summary: 'إضافة تعليق', comment: {type, body: text}, mutate: () => {}});
}
export async function updateComment(office, commentId, {type, body}) {
  const row = await office.r.workItemComments.get(commentId);
  if (!row) throw new AppError(ERR.NOT_FOUND, 'التعليق غير موجود.');
  const text = String(body ?? '').trim();
  if (!text) throw new AppError(ERR.VALIDATION, 'نص التعليق مطلوب.', {body: 'مطلوب'});
  const next = {...row, body: text.slice(0, 5000), type: COMMENT_TYPE_KEYS.includes(type) ? type : row.type, updatedAt: nowIso(), version: (row.version || 0) + 1};
  await transaction(office.ctx, [WC, STORE.activityLog], async tx => {
    await request(tx.objectStore(WC).put(next));
    await logTx(tx, activityRow(row.workItemId, 'comment-edit', 'تعديل تعليق'));
  });
  changed(row.workItemId);
  return next;
}
export async function removeComment(office, commentId) {
  const row = await office.r.workItemComments.get(commentId);
  if (!row) throw new AppError(ERR.NOT_FOUND, 'التعليق غير موجود.');
  await transaction(office.ctx, [WC, WI, STORE.activityLog], async tx => {
    await request(tx.objectStore(WC).put({...row, isDeleted: true, deletedAt: nowIso(), updatedAt: nowIso(), version: (row.version || 0) + 1}));
    const os = tx.objectStore(WI), parent = await request(os.get(row.workItemId));
    if (parent) await request(os.put({...parent, commentCount: Math.max(0, (parent.commentCount || 0) - 1)}));
    await logTx(tx, activityRow(row.workItemId, 'comment-delete', 'حذف تعليق'));
  });
  changed(row.workItemId);
  return {ok: true};
}

// ---------- التكرار (تعريف + توليد كسول) ----------
export async function createRecurringTask(office, input) {
  const startDate = String(input.dueDate || Clock.today());
  const {errors, data} = validateNativeInput({...input, dueDate: startDate, status: 'notStarted'}, {statuses: ['notStarted']});
  if (Object.keys(errors).length) throw new AppError(ERR.VALIDATION, 'راجع بيانات المهمة المتكررة.', errors);
  const rule = normalizeRule({
    freq: input.recurFreq, interval: input.recurInterval, until: input.recurUntil, count: input.recurCount,
    byWeekday: input.recurWeekdays || [], byMonthDay: input.recurMonthDay
  });
  return saveRecurrence(office, {...data, rule, startDate});
}
export async function saveRecurrence(office, input, id = null) {
  const old = id ? await office.r.workItemRecurrences.get(id) : null;
  if (id && !old) throw new AppError(ERR.NOT_FOUND, 'تعريف التكرار غير موجود.');
  const {errors, data} = validateNativeInput({...(old || {}), ...input, status: 'notStarted'}, {statuses: ['notStarted']});
  if (Object.keys(errors).length) throw new AppError(ERR.VALIDATION, 'راجع بيانات المهمة المتكررة.', errors);
  if (!isIsoDate(input.startDate || old?.startDate)) throw new AppError(ERR.VALIDATION, 'تاريخ بداية التكرار مطلوب.', {startDate: 'مطلوب'});
  const linked = await resolveLinks(office, data);
  const at = nowIso(), rowId = id || uid();
  const row = {
    ...(old || {}), ...linked, id: rowId, kind: 'recurrence', rule: normalizeRule(input.rule || old?.rule), startDate: input.startDate || old.startDate,
    status: input.status === 'ended' ? 'ended' : input.status === 'paused' ? 'paused' : (old?.status || 'active'),
    createdBy: old?.createdBy || 'user', assigneeId: old?.assigneeId ?? null, visibility: old?.visibility || 'office',
    createdAt: old?.createdAt || at, updatedAt: at, version: (old?.version || 0) + 1, isDeleted: false
  };
  delete row.dueDate; delete row.dueTime;
  row.dueTime = normalizeTime(input.dueTime ?? old?.dueTime);
  await transaction(office.ctx, [WR, STORE.activityLog], async tx => {
    await request(tx.objectStore(WR).put(row));
    await logTx(tx, activityRow(rowId, id ? 'recurrence-update' : 'recurrence-create', id ? 'تحديث مهمة متكررة' : 'إنشاء مهمة متكررة', {fileId: row.fileId || null}));
  });
  events.emit('entity:changed', {entityType: WR, id: rowId});
  changed(rowId);
  return row;
}
export async function endRecurrence(office, id) {
  return saveRecurrence(office, {status: 'ended'}, id);
}
export async function listRecurrences(office, {includeEnded = false} = {}) {
  const rows = await office.r.workItemRecurrences.byIndex('status', 'active', 500);
  const paused = await office.r.workItemRecurrences.byIndex('status', 'paused', 500);
  const ended = includeEnded ? await office.r.workItemRecurrences.byIndex('status', 'ended', 500) : [];
  return [...rows, ...paused, ...ended].sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
}
/** يحوّل تكرارًا افتراضيًا إلى مهمة حقيقية عند أول تفاعل. idempotent: مفتاح (recurrenceId, occurrenceDate) لا يتكرر. */
export async function materializeOccurrence(office, defId, date) {
  const def = await office.r.workItemRecurrences.get(defId);
  if (!def || def.status === 'ended') throw new AppError(ERR.NOT_FOUND, 'تعريف التكرار غير متاح.');
  if (!expandRecurrence(def.rule, def.startDate, date, date).includes(date)) throw new AppError(ERR.VALIDATION, 'هذا التاريخ ليس ضمن جدول التكرار.');
  const at = nowIso();
  const row = await transaction(office.ctx, [WI, STORE.activityLog], async tx => {
    const os = tx.objectStore(WI);
    const existing = await request(os.index('recurrenceId_occurrenceDate').get(IDBKeyRange.only([defId, date])));
    if (existing) return existing;
    const id = uid();
    const item = {
      id, kind: WORK_KIND.native, sourceType: TASK_SOURCE, sourceId: id, title: def.title, description: def.description || '', type: def.type || '',
      dueDate: date, dueTime: def.dueTime || '', status: 'notStarted', priority: def.priority || 'medium', tags: def.tags || [],
      fileId: def.fileId || '', caseId: def.caseId || '', clientId: def.clientId || '', opponentId: def.opponentId || '',
      relatedType: def.relatedType || '', relatedId: def.relatedId || '', recurrenceId: defId, occurrenceDate: date,
      createdBy: def.createdBy || 'user', assigneeId: def.assigneeId ?? null, visibility: def.visibility || 'office',
      originalDueDate: '', postponeCount: 0, commentCount: 0, pinnedAt: null, quadrant: null, completedAt: null, completedBy: null, archivedAt: null,
      isArchived: false, isDeleted: false, createdAt: at, updatedAt: at, version: 1
    };
    await request(os.add(item));
    await logTx(tx, activityRow(id, 'create', 'إنشاء تكرار من مهمة متكررة', {fileId: item.fileId || null, metadata: {recurrenceId: defId}}));
    return item;
  });
  changed(row.id);
  return row;
}

// ---------- القراءة المساندة ----------
export async function listComments(office, itemId, {limit = 50} = {}) {
  const page = await office.r.workItemComments.page({index: 'workItemId_createdAt', lower: [itemId, ''], upper: [itemId, '\uffff'], direction: 'prev', limit: Math.min(limit, 100)});
  return page.items;
}
/** سجل العنصر: نشاط الطبقة/المهمة + نشاط السجل الأصلي (من activityLog الموجود فقط). */
export async function itemHistory(office, itemRef, {limit = 60} = {}) {
  const ref = parseItemRef(itemRef);
  const keys = [['workItems', ref.id]];
  if (ref.kind === 'projected') {
    const source = workSource(ref.sourceType);
    if (source) keys.push([source.store, ref.sourceId]);
  }
  const pages = await Promise.all(keys.map(([type, id]) => office.r.activityLog.page({index: 'entityType_entityId_timestamp', lower: [type, id, ''], upper: [type, id, '\uffff'], direction: 'prev', limit: Math.min(limit, 100)})));
  return pages.flatMap(p => p.items).sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp))).slice(0, limit);
}

/** قيم مبدئية لنموذج «مهمة مرتبطة» من أي سجل: معرّفات وروابط فقط، وعنوان مقترح يكتبه المستخدم أو يعدّله. */
export async function linkedTaskPreset(office, relatedType, relatedId) {
  if (relatedType === 'files') return {fileId: relatedId};
  if (relatedType === 'clients') return {clientId: relatedId};
  if (relatedType === 'opponents') return {opponentId: relatedId};
  if (relatedType === 'cases') {
    const stage = await liveRow(office, 'cases', relatedId);
    return {caseId: relatedId, fileId: stage?.fileId || ''};
  }
  if (!RELATED_STORES.includes(relatedType)) throw new AppError(ERR.VALIDATION, 'نوع السجل غير مدعوم للربط.');
  const row = await liveRow(office, relatedType, relatedId);
  if (!row) throw new AppError(ERR.NOT_FOUND, 'السجل غير موجود.');
  const fileId = row.fileId || (row.caseId ? (await liveRow(office, 'cases', row.caseId))?.fileId : '') || '';
  return {relatedType, relatedId, fileId, caseId: row.caseId || row.stageId || '', clientId: row.clientId || ''};
}

// ---------- عمليات جماعية: كل عنصر معاملة مستقلة ونتيجة كل عنصر تُعرض بصدق ----------
export async function bulkApply(office, refs, action, params = {}) {
  const table = {
    complete: r => completeItem(office, r), reopen: r => reopenItem(office, r), cancel: r => cancelItem(office, r),
    archive: r => archiveItem(office, r), restore: r => restoreItem(office, r), pin: r => setPinned(office, r, true), unpin: r => setPinned(office, r, false),
    postpone: r => postponeItem(office, r, params), priority: r => setItemPriority(office, r, params.priority), status: r => setItemStatus(office, r, params.status)
  };
  const run = table[action];
  if (!run) throw new AppError(ERR.VALIDATION, 'إجراء جماعي غير معروف.');
  const done = [], failed = [];
  for (const ref of refs) {
    try { await run(ref); done.push(typeof ref === 'string' ? ref : ref.id); }
    catch (error) { failed.push({id: typeof ref === 'string' ? ref : ref.id, message: error?.message || 'فشل التنفيذ'}); }
  }
  return {done, failed};
}

// ---------- المهام المنجزة: عدّ وحذف نهائي (مهام مستقلة فقط) ----------
// «منجزة» = مهمة مستقلة (kind='native') حالتها done ولم تُحذف منطقيًا. لا تُلمس السجلات الأصلية
// (جلسات/أعمال/مواعيد) ولا طبقاتها، لأنها ليست مهامًا مستقلة. الحذف نهائي من الشاشة وقاعدة البيانات:
// يمر عبر معاملة DatabaseContext نفسها كبقية الحذف الفيزيائي (يُسجَّل كـ Tombstone للمزامنة).
const isLiveCompletedNative = row => row?.kind === WORK_KIND.native && row.status === 'done' && !row.isDeleted && !row.deletedAt;

/** عدد المهام المنجزة الحيّة (قراءة فقط عبر فهرس الحالة، بصفحات محدودة). */
export async function countCompletedWorkItems(office) {
  let count = 0, cursor = null;
  do {
    const page = await office.r.workItems.page({index: 'status', key: 'done', cursor, limit: 100, filter: isLiveCompletedNative});
    count += page.items.length;
    cursor = page.hasMore ? page.nextCursor : null;
  } while (cursor);
  return count;
}

/**
 * حذف نهائي لدفعة من المهام المنجزة مع تعليقاتها، في معاملة واحدة لكل دفعة.
 * يعيد عدد ما حُذف في هذه الدفعة؛ استدعِه حتى يعود 0 لتفريغ الكل.
 */
export async function purgeCompletedWorkItems(office, {limit = 200} = {}) {
  const cap = Math.min(Math.max(1, Number(limit) || 1), 500);
  const ids = [];
  let cursor = null;
  do {
    const page = await office.r.workItems.page({index: 'status', key: 'done', cursor, limit: 100, filter: isLiveCompletedNative});
    for (const row of page.items) {
      ids.push(row.id);
      if (ids.length >= cap) break;
    }
    cursor = ids.length >= cap ? null : (page.hasMore ? page.nextCursor : null);
  } while (cursor);
  if (!ids.length) return {purged: 0};
  await transaction(office.ctx, [WI, WC, STORE.activityLog], async tx => {
    const items = tx.objectStore(WI), comments = tx.objectStore(WC);
    for (const id of ids) {
      await request(items.delete(id));
      const rows = await request(comments.index('workItemId').getAll(IDBKeyRange.only(id)));
      for (const comment of rows) await request(comments.delete(comment.id));
    }
    await logTx(tx, activityRow('bulk', 'purged', `حذف نهائي لـ ${ids.length} مهمة منجزة`, {metadata: {count: ids.length}}));
  });
  events.emit('entity:changed', {entityType: WI, id: 'bulk'});
  return {purged: ids.length};
}
