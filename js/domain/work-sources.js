// =====================================================================
// مركز العمل — محوّلات المصادر (Source Adapters) وبناء نموذج العرض لعنصر العمل. نقي بلا IndexedDB.
// ---------------------------------------------------------------------
// كل محوّل يصف كيف يُقرأ سجل أصلي كعنصر عمل (تاريخ/وقت/حالة/عنوان/روابط/صلاحيات) وكيف تُترجم
// أفعال مركز العمل (إنجاز/إلغاء/إعادة جدولة…) إلى حقول السجل الأصلي. التسجيل مفتوح للتوسع:
// registerWorkSource() يضيف مصدرًا جديدًا دون تعديل المحرك أو الواجهة.
// القاعدة الذهبية: لا نسخ لبيانات قانونية. العنوان المشتق يأتي من حقول السجل الأصلي لحظة العرض فقط.
// =====================================================================
import {isClosedFile} from './entities.js';
import {
  WORK_KIND, SOURCE_LABELS, TASK_SOURCE, overlayId, isIsoDate, normalizeTime, sortKeyOf,
  isOpenStatus, statusInfo, priorityRank, PRIORITY_KEYS, DEFAULT_PRIORITY
} from './work-items.js';

const truthy = value => value === true || value === 'true';
const falsy = value => value === false || value === 'false';

const hearingKind = status => {
  const s = String(status || '');
  if (/ملغ/.test(s)) return 'cancelled';
  return /تمت|حضر|مؤجل|تأجل|انتهت/.test(s) ? 'done' : 'open';
};
const appointmentKind = status => {
  const s = String(status || '');
  if (/^(تم|done)$/.test(s)) return 'done';
  return /^(ملغي|ملغى|cancelled)$/.test(s) ? 'cancelled' : 'open';
};
const serviceKind = status => {
  const s = String(status || '');
  if (/ملغى|ملغي/.test(s)) return 'cancelled';
  return /تم الإعلان|تم الاستلام|مغلق/.test(s) ? 'done' : 'open';
};

/**
 * Adapter contract:
 *  type/store/label/icon · index (حقل التاريخ المفهرس) · undatedKey (مفتاح فهرس «بلا موعد» إن وُجد) ·
 *  lookbackDays (عمق «المتأخر» للمصادر التي لا تملك فهرس حالة) · scopeIndexes (فهارس الملف/القضية/الموكل) ·
 *  dateOf/timeOf/sourceKind/openStatus/title/subtitle/links/route/defaultPriority ·
 *  include(row): هل السجل مرشّح كعنصر عمل أصلًا · caps: الأفعال المسموحة · patch: ترجمة الأفعال لحقول السجل الأصلي ·
 *  writer: 'operational' (saveOperational) | 'file' (تحديث حقل واحد داخل المعاملة) | null (طبقة تشغيلية فقط).
 */
const hearings = {
  type: 'hearings', store: 'hearings', label: SOURCE_LABELS.hearings, icon: '⚖️', defaultEnabled: true, writer: 'operational',
  index: 'hearingDate', lookbackDays: 90, scopeIndexes: {fileId: 'fileId', caseId: 'caseId'},
  dateOf: r => r.hearingDate || '', timeOf: r => r.hearingTime || '',
  include: r => Boolean(r.hearingDate),
  sourceKind: r => hearingKind(r.status), openStatus: () => 'notStarted',
  statusLabel: r => hearingKind(r.status) === 'done' && /مؤجل|تأجل/.test(String(r.status || '')) ? 'مؤجلة (انتهت بالتأجيل)' : '',
  title: r => r.reason || r.type || 'جلسة',
  subtitle: r => [r.generatedFromAdjournment ? 'جلسة تالية بعد تأجيل' : '', r.type && r.reason ? r.type : '', r.chamber].filter(Boolean).join(' — '),
  links: r => ({fileId: r.fileId || '', caseId: r.caseId || r.stageId || '', clientId: '', opponentId: ''}),
  route: r => `rec:hearings:${r.id}`, defaultPriority: () => 'high',
  caps: {complete: true, reopen: true, cancel: true, reschedule: true, postpone: true, setStatus: false, adjourn: true},
  patch: {
    complete: () => ({status: 'تمت'}), reopen: () => ({status: 'مجدولة'}), cancel: () => ({status: 'ملغاة'}),
    reschedule: (_r, date) => ({hearingDate: date}),
    adjourn: (_r, date, reason) => ({status: 'مؤجلة', adjournedTo: date, ...(reason ? {adjournReason: reason} : {})})
  }
};

const procedures = {
  type: 'procedures', store: 'procedures', label: SOURCE_LABELS.procedures, icon: '🗂️', defaultEnabled: true, writer: 'operational',
  index: 'internalDueDate', undatedKey: '', lookbackDays: Infinity, scopeIndexes: {fileId: 'fileId', caseId: 'caseId'},
  dateOf: r => r.internalDueDate || '', timeOf: () => '',
  include: () => true,
  sourceKind: r => r.status === 'done' ? 'done' : r.status === 'cancelled' ? 'cancelled' : 'open',
  openStatus: r => r.status === 'pending' ? 'waiting' : 'notStarted',
  title: r => r.description || r.type || 'عمل إداري', subtitle: r => r.description && r.type ? r.type : '',
  links: r => ({fileId: r.fileId || '', caseId: r.caseId || '', clientId: '', opponentId: ''}),
  route: r => `rec:procedures:${r.id}`,
  defaultPriority: r => r.priority === 'critical' ? 'urgent' : r.priority === 'urgent' ? 'high' : 'medium',
  caps: {complete: true, reopen: true, cancel: true, reschedule: true, postpone: true, setStatus: true},
  patch: {
    complete: () => ({status: 'done'}), reopen: () => ({status: 'open'}), cancel: () => ({status: 'cancelled'}),
    reschedule: (_r, date) => ({internalDueDate: date}),
    // المصدر يعرف «قيد الانتظار» فقط؛ «قيد التنفيذ» حالة تشغيلية تُحفظ في الطبقة.
    setStatus: (_r, key) => key === 'waiting' ? {status: 'pending'} : (key === 'notStarted' || key === 'inProgress') ? {status: 'open'} : null
  }
};

const appointments = {
  type: 'appointments', store: 'appointments', label: SOURCE_LABELS.appointments, icon: '📅', defaultEnabled: true, writer: 'operational',
  index: 'date', lookbackDays: 60, scopeIndexes: {fileId: 'fileId', clientId: 'clientId'},
  dateOf: r => r.date || '', timeOf: r => r.time || '',
  include: r => Boolean(r.date),
  sourceKind: r => appointmentKind(r.status), openStatus: r => /مؤجل/.test(String(r.status || '')) ? 'postponed' : 'notStarted',
  title: r => r.title || 'موعد', subtitle: r => [r.withWhom, r.location].filter(Boolean).join(' — '),
  links: r => ({fileId: r.fileId || '', caseId: '', clientId: r.clientId || '', opponentId: ''}),
  route: r => `rec:appointments:${r.id}`, defaultPriority: () => 'medium',
  caps: {complete: true, reopen: true, cancel: true, reschedule: true, postpone: true, setStatus: false},
  patch: {
    complete: () => ({status: 'تم'}), reopen: () => ({status: 'مجدول'}), cancel: () => ({status: 'ملغي'}),
    reschedule: (_r, date) => ({date}), postpone: (_r, date) => ({date, status: 'مؤجل'})
  }
};

const communications = {
  type: 'communications', store: 'communications', label: SOURCE_LABELS.communications, icon: '📞', defaultEnabled: true, writer: 'operational',
  index: 'followUpDate', lookbackDays: 180, scopeIndexes: {fileId: 'fileId', clientId: 'clientId'},
  dateOf: r => r.followUpDate || '', timeOf: () => '',
  // وجود «تاريخ المتابعة» يعني متابعة مطلوبة ما لم تُغلق صراحةً (followUpRequired=false).
  include: r => Boolean(r.followUpDate),
  sourceKind: r => falsy(r.followUpRequired) ? 'done' : 'open', openStatus: () => 'notStarted',
  title: r => r.subject ? `متابعة: ${r.subject}` : 'متابعة اتصال', subtitle: r => [r.contactName, r.channel].filter(Boolean).join(' — '),
  links: r => ({fileId: r.fileId || '', caseId: '', clientId: r.clientId || '', opponentId: ''}),
  route: r => `rec:communications:${r.id}`, defaultPriority: () => 'medium',
  caps: {complete: true, reopen: true, cancel: false, reschedule: true, postpone: true, setStatus: false},
  patch: {
    complete: () => ({followUpRequired: false}), reopen: () => ({followUpRequired: true}),
    reschedule: (_r, date) => ({followUpDate: date})
  }
};

const files = {
  type: 'files', store: 'files', label: SOURCE_LABELS.files, icon: '📁', defaultEnabled: true, writer: 'file', overlayTerminal: true,
  index: 'nextStepDate', lookbackDays: 180, scopeIndexes: {fileId: 'id'},
  dateOf: r => r.nextStepDate || '', timeOf: () => '',
  include: r => Boolean(r.nextStepDate) && !isClosedFile(r),
  // إنجاز الخطوة لا يغيّر سجل الملف: يُسجَّل في الطبقة مع التاريخ الذي أُنجز من أجله، فإذا حُدّدت خطوة جديدة عادت مفتوحة.
  sourceKind: (r, overlay) => overlay?.completedAt && overlay.completedFor === r.nextStepDate ? 'done'
    : overlay?.cancelledAt && overlay.cancelledFor === r.nextStepDate ? 'cancelled' : 'open',
  openStatus: () => 'notStarted',
  title: r => r.nextStep || 'الخطوة التالية للملف', subtitle: () => '',
  links: r => ({fileId: r.id || '', caseId: '', clientId: '', opponentId: ''}),
  route: r => `file:${r.id}`, defaultPriority: () => 'medium',
  caps: {complete: true, reopen: true, cancel: true, reschedule: true, postpone: true, setStatus: false},
  patch: {reschedule: (_r, date) => ({nextStepDate: date})}
};

const serviceRecords = {
  type: 'serviceRecords', store: 'serviceRecords', label: SOURCE_LABELS.serviceRecords, icon: '📨', defaultEnabled: false, writer: null,
  index: 'serviceDate', lookbackDays: 90, scopeIndexes: {fileId: 'fileId', caseId: 'caseId'},
  dateOf: r => r.serviceDate || '', timeOf: () => '',
  include: r => Boolean(r.serviceDate) && r.recordState !== 'deleted',
  sourceKind: r => serviceKind(r.status), openStatus: () => 'notStarted',
  title: r => [r.type || 'إعلان / إنذار', r.partyName].filter(Boolean).join(' — '), subtitle: r => r.status || '',
  links: r => ({fileId: r.fileId || '', caseId: r.caseId || '', clientId: '', opponentId: ''}),
  route: r => `rec:serviceRecords:${r.id}`, defaultPriority: () => 'medium',
  caps: {complete: false, reopen: false, cancel: false, reschedule: false, postpone: false, setStatus: false},
  patch: {}
};

const registry = new Map([hearings, procedures, appointments, communications, files, serviceRecords].map(s => [s.type, s]));

/** تسجيل مصدر جديد (قابلية التوسع): يكفي إعطاء محوّل بنفس العقد. */
export function registerWorkSource(adapter) {
  if (!adapter?.type || !adapter?.store || !adapter?.index || typeof adapter.dateOf !== 'function' || typeof adapter.sourceKind !== 'function') {
    throw new TypeError('محوّل مصدر عمل غير صالح.');
  }
  registry.set(adapter.type, {
    label: SOURCE_LABELS[adapter.type] || adapter.type, icon: '•', defaultEnabled: false, writer: null, lookbackDays: 90,
    scopeIndexes: {}, include: () => true, timeOf: () => '', openStatus: () => 'notStarted', subtitle: () => '',
    links: () => ({fileId: '', caseId: '', clientId: '', opponentId: ''}), defaultPriority: () => DEFAULT_PRIORITY,
    caps: {}, patch: {}, ...adapter
  });
  return registry.get(adapter.type);
}
export const workSource = type => registry.get(type) || null;
export const allWorkSources = () => [...registry.values()];
export function enabledWorkSources(config = {}) {
  return allWorkSources().filter(source => (config.sources && source.type in config.sources) ? Boolean(config.sources[source.type]) : source.defaultEnabled);
}
export const sourceLabelOf = type => workSource(type)?.label || SOURCE_LABELS[type] || type;

// ---------- بناء نماذج العرض ----------
const isLiveRow = row => Boolean(row) && !row.isDeleted && !row.isArchived;
export {isLiveRow as isLiveSourceRow};

function common(item, config) {
  const info = statusInfo(item.status, config);
  const kind = info.kind;
  return {
    ...item,
    statusKind: kind, statusLabel: item.statusLabel || info.label,
    isOpen: kind === 'open', isDone: kind === 'done', isCancelled: kind === 'cancelled',
    isPinned: Boolean(item.pinnedAt),
    sortKey: sortKeyOf(item)
  };
}
function validPriority(key, fallback) { return PRIORITY_KEYS.includes(key) ? key : fallback; }

/** عنصر مسقَط من سجل أصلي + طبقته التشغيلية (إن وُجدت). لا يُخزَّن أبدًا؛ يُبنى عند القراءة. */
export function buildProjectedItem(source, row, overlay = null, {config = {}} = {}) {
  const rawDate = String(source.dateOf(row) || '').slice(0, 10);
  const dueDate = isIsoDate(rawDate) ? rawDate : '';
  const kind = source.sourceKind(row, overlay);
  let status;
  if (kind === 'done') status = 'done';
  else if (kind === 'cancelled') status = 'cancelled';
  else status = overlay?.status && isOpenStatus(overlay.status, config) ? overlay.status : source.openStatus(row);
  const links = source.links(row);
  return common({
    id: overlayId(source.type, row.id), kind: WORK_KIND.overlay, projected: true,
    sourceType: source.type, sourceId: row.id, sourceAvailable: true, sourceLabel: source.label, sourceIcon: source.icon,
    title: source.title(row) || source.label, subtitle: source.subtitle?.(row) || '', typeLabel: source.label,
    description: '', notes: row.notes || '',
    dueDate, dueTime: normalizeTime(source.timeOf?.(row)),
    status, statusLabel: source.statusLabel?.(row) || '',
    priority: validPriority(overlay?.priority, source.defaultPriority(row)),
    tags: Array.isArray(overlay?.tags) ? overlay.tags : [], pinnedAt: overlay?.pinnedAt || '',
    quadrant: overlay?.quadrant || '',
    ...links, relatedType: source.type, relatedId: row.id,
    originalDueDate: overlay?.originalDueDate || '', postponeCount: overlay?.postponeCount || 0,
    completedAt: kind === 'done' ? (overlay?.completedAt || '') : '', completedBy: kind === 'done' ? (overlay?.completedBy || '') : '',
    archivedAt: overlay?.archivedAt || '', hasOverlay: Boolean(overlay),
    caps: {...source.caps, edit: false, delete: false, archive: true, comment: true, pin: true, priority: true, tags: true},
    route: source.route(row), createdAt: row.createdAt || '', updatedAt: row.updatedAt || '',
    raw: row, overlay
  }, config);
}

/** مهمة جديدة مستقلة (صف حقيقي في workItems). */
export function buildNativeItem(row, {config = {}} = {}) {
  const dueDate = isIsoDate(row.dueDate) ? row.dueDate : '';
  const status = row.status || 'notStarted';
  return common({
    id: row.id, kind: WORK_KIND.native, projected: false,
    sourceType: TASK_SOURCE, sourceId: row.id, sourceAvailable: true, sourceLabel: SOURCE_LABELS.task, sourceIcon: '✅',
    title: row.title || 'مهمة بلا عنوان', subtitle: '', typeLabel: row.type || SOURCE_LABELS.task,
    description: row.description || '', notes: row.description || '',
    dueDate, dueTime: normalizeTime(row.dueTime), status,
    priority: validPriority(row.priority, DEFAULT_PRIORITY),
    tags: Array.isArray(row.tags) ? row.tags : [], pinnedAt: row.pinnedAt || '', quadrant: row.quadrant || '',
    fileId: row.fileId || '', caseId: row.caseId || '', clientId: row.clientId || '', opponentId: row.opponentId || '',
    relatedType: row.relatedType || '', relatedId: row.relatedId || '',
    originalDueDate: row.originalDueDate || '', postponeCount: row.postponeCount || 0,
    completedAt: row.completedAt || '', completedBy: row.completedBy || '', archivedAt: row.archivedAt || '',
    recurrenceId: row.recurrenceId || '', occurrenceDate: row.occurrenceDate || '',
    caps: {complete: true, reopen: true, cancel: true, reschedule: true, postpone: true, setStatus: true, edit: true, delete: true, archive: true, comment: true, pin: true, priority: true, tags: true},
    route: '', createdAt: row.createdAt || '', updatedAt: row.updatedAt || '', version: row.version || 1,
    raw: row, overlay: null
  }, config);
}

/** طبقة تشغيلية فقدت مصدرها (حُذف/أُرشف): يبقى العنصر وتاريخه ويظهر «المصدر غير متاح حاليًا». لا عنوان منسوخ. */
export function buildOrphanItem(overlay, {config = {}} = {}) {
  const typeLabel = sourceLabelOf(overlay.sourceType);
  const done = Boolean(overlay.completedAt);
  const status = done ? 'done' : (overlay.status && isOpenStatus(overlay.status, config) ? overlay.status : 'notStarted');
  return common({
    id: overlay.id, kind: WORK_KIND.overlay, projected: true,
    sourceType: overlay.sourceType, sourceId: overlay.sourceId, sourceAvailable: false, sourceLabel: typeLabel, sourceIcon: '⛓️‍💥',
    title: `${typeLabel} — المصدر غير متاح حاليًا`, subtitle: '', typeLabel, description: '', notes: '',
    dueDate: isIsoDate(overlay.dueDate) ? overlay.dueDate : '', dueTime: '', status,
    priority: validPriority(overlay.priority, DEFAULT_PRIORITY),
    tags: Array.isArray(overlay.tags) ? overlay.tags : [], pinnedAt: overlay.pinnedAt || '', quadrant: overlay.quadrant || '',
    fileId: '', caseId: '', clientId: '', opponentId: '', relatedType: overlay.sourceType, relatedId: overlay.sourceId,
    originalDueDate: overlay.originalDueDate || '', postponeCount: overlay.postponeCount || 0,
    completedAt: overlay.completedAt || '', completedBy: overlay.completedBy || '', archivedAt: overlay.archivedAt || '', hasOverlay: true,
    caps: {complete: false, reopen: false, cancel: false, reschedule: false, postpone: false, setStatus: false, edit: false, delete: false, archive: true, comment: true, pin: true, priority: true, tags: true},
    route: '', createdAt: overlay.createdAt || '', updatedAt: overlay.updatedAt || '', raw: null, overlay
  }, config);
}

/** هل يمر العنصر من مرشّحات التصفية؟ (يُطبَّق بعد بناء العنصر وبدون أي قراءة إضافية). */
export function itemPassesFilters(item, f = {}) {
  const kinds = f.kinds || ['open'];
  if (kinds.length && !kinds.includes(item.statusKind)) return false;
  if (f.archived === 'only') { if (!item.archivedAt) return false; }
  else if (f.archived !== 'any' && item.archivedAt) return false;
  if (f.statuses?.length && !f.statuses.includes(item.status)) return false;
  if (f.priorities?.length && !f.priorities.includes(item.priority)) return false;
  if (f.sources?.length && !f.sources.includes(item.sourceType)) return false;
  if (f.types?.length && !f.types.includes(item.typeLabel)) return false;
  if (f.tags?.length && !f.tags.every(tag => item.tags.includes(tag))) return false;
  if (f.pinned && !item.isPinned) return false;
  if (f.relatedId && !(item.relatedId === f.relatedId || item.sourceId === f.relatedId)) return false;
  if (f.quadrant && item.quadrant !== f.quadrant) return false;
  return true;
}
export {priorityRank};
