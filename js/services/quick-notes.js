// ============================================================================
// Quick Notes / caseNotes application service
// ----------------------------------------------------------------------------
// المخزن canonical هو caseNotes الموجود في النظام. هذه الطبقة توسّعه إلى ملاحظات
// تشغيلية عامة بدل إنشاء Notes store ثانٍ. الروابط المنفصلة تحفظ معرّفات فقط في
// quickNoteLinks، والمسودات في caseNoteDrafts ولا تُسجّل نشاطًا أثناء الكتابة.
// ============================================================================
import {STORE} from '../db/schema.js';
import {transaction, request} from '../db/unit-of-work.js';
import {uid} from '../core/id.js';
import {getDeviceId} from '../core/device-id.js';
import {Clock, localDate, addDays} from '../core/clock.js';
import {normalizeArabic, normalizeDigits} from '../core/search-normalizer.js';
import {AppError, ERR} from '../core/errors.js';
import {events} from '../core/events.js';
import {getLookups} from './lookups.js';
import {saveWorkItemFromQuickNote} from './work-items.js';

export const NOTE_LIFECYCLES = Object.freeze({OPEN: 'OPEN', DONE: 'DONE'});
export const NOTE_PRIORITIES = Object.freeze({LOW: 'LOW', NORMAL: 'NORMAL', HIGH: 'HIGH', URGENT: 'URGENT'});
export const NOTE_COLORS = Object.freeze(['DEFAULT', 'YELLOW', 'BLUE', 'GREEN', 'RED', 'ORANGE', 'PURPLE', 'GRAY']);
export const NOTE_ENTITY_TYPES = Object.freeze([
  'CLIENT', 'LEGAL_FILE', 'CASE', 'PARTY', 'HEARING', 'PROCEDURE', 'JUDGMENT', 'EXECUTION', 'POA',
  'SERVICE_RECORD', 'EXPERT_REPORT', 'APPOINTMENT', 'COMMUNICATION', 'FEE', 'DOCUMENT_REFERENCE', 'WORK_ITEM', 'QUICK_NOTE'
]);

const NOTE_STORE = STORE.caseNotes;
const LINK_STORE = STORE.quickNoteLinks;
const DRAFT_STORE = STORE.caseNoteDrafts;
const MAX_PAGE = 100;
const MAX_LINKS = 100;

const entityStore = Object.freeze({
  CLIENT: STORE.clients, LEGAL_FILE: STORE.files, CASE: STORE.cases, PARTY: STORE.fileParties, HEARING: STORE.hearings,
  PROCEDURE: STORE.procedures, JUDGMENT: STORE.judgments, EXECUTION: STORE.execution,
  POA: STORE.powersOfAttorney, SERVICE_RECORD: STORE.serviceRecords, EXPERT_REPORT: STORE.expertReports,
  APPOINTMENT: STORE.appointments, COMMUNICATION: STORE.communications, FEE: STORE.fees,
  DOCUMENT_REFERENCE: STORE.documentReferences, WORK_ITEM: STORE.workItems, QUICK_NOTE: STORE.caseNotes
});

const nowIso = () => Clock.now();
let logicalSortStamp = 0;
const nextSortKey = (at, noteId) => {
  const physical = Date.parse(String(at || '')) || Date.now();
  logicalSortStamp = Math.max(physical, logicalSortStamp + 1);
  return `${String(logicalSortStamp).padStart(13, '0')}::${noteId}`;
};
const clean = (value, max = 10000) => String(value ?? '').replace(/\u0000/g, '').slice(0, max);
const cleanDate = value => {
  const text = String(value ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
};
const cleanTimestamp = value => value == null || value === '' ? null : String(value).slice(0, 80);
const normalizeSearch = value => normalizeArabic(normalizeDigits(String(value ?? '')))
  .replace(/[.,!?؛،:()[\]{}"'`~_+=*/\\|<>-]+/g, ' ')
  .replace(/\s+/g, ' ').trim();
const tagsOf = value => {
  const list = Array.isArray(value) ? value : String(value ?? '').split(/[,،؛;\n]+/);
  return [...new Set(list.map(x => clean(x, 80).trim()).filter(Boolean))].slice(0, 30);
};
const validPriority = value => Object.values(NOTE_PRIORITIES).includes(value) ? value : NOTE_PRIORITIES.NORMAL;
const validColor = value => NOTE_COLORS.includes(value) ? value : 'DEFAULT';
const dateNow = () => new Date();

export function effectiveNoteState(note, at = nowIso()) {
  if (!note) return 'TRASH';
  if (note.deletedAt || note.isDeleted) return 'TRASH';
  if (note.archivedAt || note.isArchived) return 'ARCHIVED';
  if (note.lifecycle === NOTE_LIFECYCLES.DONE) return 'DONE';
  if (note.snoozedUntil && String(note.snoozedUntil) > String(at)) return 'SNOOZED';
  return 'ACTIVE';
}

export function isSnoozeExpired(note, at = nowIso()) {
  return Boolean(note?.snoozedUntil && String(note.snoozedUntil) <= String(at));
}

export function noteText(note) {
  return [note?.title, note?.content, ...(Array.isArray(note?.tagIds) ? note.tagIds : [])].filter(Boolean).join(' ');
}

function activity(office, id, action, fileId = null, summary = '') {
  return office.activity(NOTE_STORE, id, action, fileId || null, summary);
}

function normalizeInput(input = {}, old = null, {id = null} = {}) {
  const content = clean(input.content !== undefined ? input.content : old?.content, 50000).trim();
  const title = clean(input.title !== undefined ? input.title : old?.title, 500).trim();
  if (!content && !title) throw new AppError(ERR.VALIDATION, 'اكتب نص الملاحظة أو عنوانًا قبل الحفظ.', {content: 'الملاحظة فارغة'});
  const createdAt = old?.createdAt || input.createdAt || nowIso();
  const updatedAt = nowIso();
  const noteId = id || old?.id || input.id || uid();
  const tagIds = tagsOf(input.tagIds !== undefined ? input.tagIds : (old?.tagIds || input.tags));
  const fileId = clean(input.fileId !== undefined ? input.fileId : old?.fileId, 200).trim();
  const caseId = clean(input.caseId !== undefined ? input.caseId : old?.caseId, 200).trim();
  const clientId = clean(input.clientId !== undefined ? input.clientId : old?.clientId, 200).trim();
  const lifecycle = input.lifecycle === NOTE_LIFECYCLES.DONE || (old?.lifecycle === NOTE_LIFECYCLES.DONE && input.lifecycle === undefined)
    ? NOTE_LIFECYCLES.DONE : NOTE_LIFECYCLES.OPEN;
  const completedAt = lifecycle === NOTE_LIFECYCLES.DONE ? (input.completedAt || old?.completedAt || updatedAt) : null;
  const archivedAt = input.archivedAt !== undefined ? cleanTimestamp(input.archivedAt) : (old?.archivedAt || null);
  const deletedAt = input.deletedAt !== undefined ? cleanTimestamp(input.deletedAt) : (old?.deletedAt || null);
  const snoozedUntil = input.snoozedUntil !== undefined ? cleanTimestamp(input.snoozedUntil) : (old?.snoozedUntil || null);
  const dueAt = input.dueAt !== undefined ? cleanDate(input.dueAt) : (old?.dueAt || '');
  const remindAt = input.remindAt !== undefined ? cleanTimestamp(input.remindAt) : (old?.remindAt || null);
  const sourceType = clean(input.sourceType !== undefined ? input.sourceType : old?.sourceType, 80).trim();
  const sourceId = clean(input.sourceId !== undefined ? input.sourceId : old?.sourceId, 200).trim();
  const customColor = /^#[0-9a-f]{3,8}$/i.test(String(input.customColor ?? old?.customColor ?? '')) ? String(input.customColor ?? old?.customColor) : '';
  const note = {
    ...(old || {}),
    id: noteId,
    kind: 'QUICK_NOTE',
    title, content, contentFormat: 'plain',
    noteType: clean(input.noteType !== undefined ? input.noteType : old?.noteType, 100).trim() || 'عادية',
    category: clean(input.category !== undefined ? input.category : old?.category, 100).trim() || 'عامة',
    priority: validPriority(input.priority !== undefined ? input.priority : old?.priority),
    colorToken: validColor(input.colorToken !== undefined ? input.colorToken : old?.colorToken),
    customColor, colorLabel: clean(input.colorLabel !== undefined ? input.colorLabel : old?.colorLabel, 100).trim(),
    isPinned: Boolean(input.isPinned !== undefined ? input.isPinned : old?.isPinned),
    pinnedAt: input.isPinned !== undefined ? (input.isPinned ? (old?.pinnedAt || updatedAt) : null) : (old?.pinnedAt || null),
    isStarred: Boolean(input.isStarred !== undefined ? input.isStarred : old?.isStarred),
    lifecycle, completedAt, archivedAt, deletedAt, snoozedUntil, dueAt, remindAt,
    showOnOpen: Boolean(input.showOnOpen !== undefined ? input.showOnOpen : old?.showOnOpen),
    triagedAt: input.triagedAt !== undefined ? cleanTimestamp(input.triagedAt) : (old?.triagedAt || null),
    sortKey: clean(input.sortKey !== undefined ? input.sortKey : old?.sortKey, 200) || nextSortKey(updatedAt, noteId),
    tagIds, checklist: normalizeChecklist(input.checklist !== undefined ? input.checklist : old?.checklist),
    createdAt, createdBy: old?.createdBy || input.createdBy || 'user', updatedAt, updatedBy: input.updatedBy || 'user',
    contentUpdatedAt: input.contentUpdatedAt || (old && input.content === undefined && input.title === undefined ? old.contentUpdatedAt : updatedAt),
    sourceType, sourceId, fileId, caseId, clientId,
    workItemIds: Array.isArray(input.workItemIds) ? [...new Set(input.workItemIds.filter(Boolean))] : (old?.workItemIds || []),
    deviceId: input.deviceId || old?.deviceId || getDeviceId(), hlc: input.hlc || old?.hlc || updatedAt,
    rev: Number(input.rev ?? old?.rev ?? 0) + 1, version: Number(old?.version || 0) + 1, schemaVersion: 1,
    isArchived: Boolean(archivedAt), isDeleted: Boolean(deletedAt)
  };
  note.searchTextNormalized = normalizeSearch([note.title, note.content, note.noteType, note.category, note.priority, note.colorLabel, ...note.tagIds, note.sourceType, note.sourceId, note.fileId, note.caseId, note.clientId].join(' '));
  if (!note.triagedAt && (note.tagIds.length || note.dueAt || note.fileId || note.caseId || note.clientId || note.sourceId)) note.triagedAt = updatedAt;
  return note;
}

export function normalizeChecklist(value) {
  const list = Array.isArray(value) ? value : [];
  return list.slice(0, 100).map((item, index) => ({
    id: clean(item?.id, 200) || uid(), text: clean(item?.text, 1000).trim(), done: Boolean(item?.done),
    sortKey: clean(item?.sortKey, 100) || String(index), doneAt: item?.done ? (item.doneAt || nowIso()) : null
  })).filter(item => item.text);
}

export function parseQuickNoteQuery(raw = '') {
  const words = String(raw).trim().split(/[\s،,;؛]+/).filter(Boolean);
  const query = {text: [], tag: '', file: '', client: '', priority: '', color: '', states: new Set(), type: ''};
  const priorityMap = {منخفضة: 'LOW', منخفض: 'LOW', عادية: 'NORMAL', عادي: 'NORMAL', مرتفعة: 'HIGH', مرتفع: 'HIGH', عالية: 'HIGH', عالي: 'HIGH', عاجلة: 'URGENT', عاجل: 'URGENT'};
  for (let i = 0; i < words.length; i += 1) {
    let token = words[i];
    // The UI deliberately displays «وسم: مهم» with a space. Treat the next token as
    // the value when the colon was separated by whitespace, without consuming the
    // rest of the free-text query.
    if (/^[^:：]+[:：]$/.test(token) && words[i + 1]) token += words[++i];
    const m = /^([^:：]+)[:：](.+)$/.exec(token);
    const key = normalizeSearch(m ? m[1] : token);
    const value = m ? normalizeSearch(m[2]) : '';
    if (m && ['وسم', 'tag'].includes(key)) query.tag = value;
    else if (m && ['ملف', 'file'].includes(key)) query.file = value;
    else if (m && ['موكل', 'client'].includes(key)) query.client = value;
    else if (m && ['اولوية', 'priority'].includes(key)) query.priority = priorityMap[value] || value.toUpperCase();
    else if (m && ['لون', 'color'].includes(key)) query.color = value.toUpperCase();
    else if (m && ['نوع', 'type'].includes(key)) query.type = value;
    else if (['متاخر', 'overdue'].includes(key)) query.states.add('OVERDUE');
    else if (['اليوم', 'today'].includes(key)) query.states.add('TODAY');
    else if (['مؤجل', 'snoozed'].includes(key)) query.states.add('SNOOZED');
    else if (['مثبت', 'pinned'].includes(key)) query.states.add('PINNED');
    else if (['منتهي', 'منجزة', 'منجز', 'done'].includes(key)) query.states.add('DONE');
    else if (['مرتبط', 'linked'].includes(key)) query.states.add('LINKED');
    else if (['بلا_ربط', 'بلا-ربط', 'بلا ربط', 'unlinked'].includes(key)) query.states.add('UNLINKED');
    else query.text.push(key);
  }
  return query;
}

export function matchesQuickNoteQuery(note, parsed, at = nowIso(), {includeDeleted = false} = {}) {
  if (!note || (!includeDeleted && (note.isDeleted || note.deletedAt))) return false;
  const state = effectiveNoteState(note, at);
  const today = localDate(dateNow());
  if (parsed.priority && validPriority(parsed.priority) !== note.priority) return false;
  if (parsed.color && validColor(parsed.color) !== note.colorToken) return false;
  if (parsed.type && !normalizeSearch(note.noteType).includes(parsed.type)) return false;
  if (parsed.tag && !note.tagIds?.some(tag => normalizeSearch(tag).includes(parsed.tag))) return false;
  if (parsed.file && !normalizeSearch(`${note.fileId || ''} ${note.sourceId || ''}`).includes(parsed.file)) return false;
  if (parsed.client && !normalizeSearch(note.clientId || '').includes(parsed.client)) return false;
  for (const flag of parsed.states) {
    if (flag === 'DONE' && state !== 'DONE') return false;
    if (flag === 'SNOOZED' && state !== 'SNOOZED') return false;
    if (flag === 'PINNED' && !note.isPinned) return false;
    if (flag === 'OVERDUE' && !(note.dueAt && note.dueAt < today && note.lifecycle === NOTE_LIFECYCLES.OPEN)) return false;
    if (flag === 'TODAY' && note.dueAt !== today) return false;
    if (flag === 'LINKED' && !note.sourceId && !note.fileId && !note.caseId && !note.clientId) return false;
    if (flag === 'UNLINKED' && (note.sourceId || note.fileId || note.caseId || note.clientId)) return false;
  }
  return !parsed.text.length || parsed.text.every(token => normalizeSearch(note.searchTextNormalized || noteText(note)).includes(token));
}

export function smartCaptureProposals(text = '') {
  const raw = String(text || '').trim();
  const normalized = normalizeSearch(raw);
  const proposals = [];
  if (/!!|!{2,}|عاجل|ضروري|urgent/i.test(raw)) proposals.push({type: 'priority', value: 'URGENT', label: '🔥 عاجل'});
  const file = raw.match(/(?:ملف|ملف رقم|file)\s*([٠-٩۰-۹\d]+\s*[\/]\s*[٠-٩۰-۹\d]{4})/i) || raw.match(/(?:^|[^٠-٩۰-۹\d])([٠-٩۰-۹\d]{1,6}\s*\/\s*[٠-٩۰-۹\d]{4})(?=$|[^٠-٩۰-۹\d])/);
  if (file) proposals.push({type: 'file', value: normalizeDigits(file[1]).replace(/\s+/g, ''), label: `📁 ملف ${normalizeDigits(file[1]).replace(/\s+/g, '')}`});
  const person = raw.match(/(?:اتصل|قابل|مع|بخصوص)\s+([\u0600-\u06ffA-Za-z]{2,}(?:\s+[\u0600-\u06ffA-Za-z]{2,})?)/);
  if (person) proposals.push({type: 'client', value: person[1].trim(), label: `👤 ${person[1].trim()}`});
  const dayWords = ['اليوم', 'غدًا', 'غدا', 'بعد غد', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت', 'الأحد', 'الاثنين'];
  const day = dayWords.find(word => normalized.includes(normalizeSearch(word)));
  if (day) proposals.push({type: 'date-word', value: day, label: `📅 ${day}`});
  if (!proposals.length && normalized) proposals.push({type: 'text', value: normalized.slice(0, 80), label: '🏷 مراجعة الوسم / الربط'});
  return [...new Map(proposals.map(p => [`${p.type}:${p.value}`, p])).values()].slice(0, 6);
}

export async function quickNoteTypes(office) {
  try { return (await getLookups(office, ['quickNoteType'])).quickNoteType || []; }
  catch { return ['عادية', 'مكالمة', 'اجتماع', 'قرار', 'فكرة', 'تذكير', 'بعد الجلسة', 'طلب مستند', 'متابعة موكل', 'أخرى']; }
}

export async function getQuickNote(office, id, {raw = false} = {}) {
  if (!id) return null;
  return raw ? office.r.caseNotes.getManyRaw([id]).then(rows => rows[0] || null) : office.r.caseNotes.get(id);
}

export async function saveQuickNote(office, input = {}, {id = null, expectedVersion = null, links = null, action = null, includeDeleted = false} = {}) {
  const existing = id ? await getQuickNote(office, id, {raw: includeDeleted}) : (input.id ? await getQuickNote(office, input.id, {raw: includeDeleted}) : null);
  if (existing?.isDeleted && !includeDeleted) throw new AppError(ERR.CONFLICT, 'الملاحظة في السلة؛ استعدها قبل التعديل.');
  if (id && !existing) throw new AppError(ERR.NOT_FOUND, 'الملاحظة غير موجودة.');
  if (expectedVersion != null && existing && Number(existing.version || 0) !== Number(expectedVersion)) throw new AppError(ERR.CONFLICT, 'تغيرت الملاحظة على جهاز آخر؛ أعد فتحها قبل الحفظ.');
  const row = normalizeInput(input, existing, {id: id || input.id});
  const isNew = !existing;
  const requestedLinks = Array.isArray(links) ? links : null;
  const linkRows = requestedLinks ? sanitizeLinks(row.id, requestedLinks) : [];
  if (requestedLinks?.length && !linkRows.length) throw new AppError(ERR.VALIDATION, 'الرابط المختار غير صالح.');
  const first = linkRows[0];
  if (first && !row.sourceId) { row.sourceType = first.entityType; row.sourceId = first.entityId; }
  // Keep the canonical direct fields in sync with approved links for the
  // existing file/case/client indexes; the link rows remain the complete relation set.
  for (const link of linkRows) {
    if (link.entityType === 'LEGAL_FILE' && !row.fileId) row.fileId = link.entityId;
    if (link.entityType === 'CASE' && !row.caseId) row.caseId = link.entityId;
    if (link.entityType === 'CLIENT' && !row.clientId) row.clientId = link.entityId;
  }
  if (first) row.searchTextNormalized = normalizeSearch(noteText(row) + ' ' + linkRows.map(link => `${link.entityType} ${link.entityId}`).join(' '));
  if (first && !row.triagedAt) row.triagedAt = row.updatedAt;
  if (requestedLinks) {
    for (const link of linkRows) {
      if (link.entityType === 'QUICK_NOTE' && link.entityId === row.id) throw new AppError(ERR.VALIDATION, 'لا يمكن ربط الملاحظة بنفسها.');
      const targetStore = entityStore[link.entityType];
      const target = targetStore ? await office.r[targetStore].get(link.entityId).catch(() => null) : null;
      if (!target || target.isDeleted) throw new AppError(ERR.NOT_FOUND, `السجل المرتبط غير موجود: ${link.entityType}.`);
    }
  }
  const stores = [NOTE_STORE, STORE.activityLog, ...(requestedLinks ? [LINK_STORE] : [])];
  const out = await transaction(office.ctx, stores, async tx => {
    await request(tx.objectStore(NOTE_STORE).put(row));
    if (requestedLinks) {
      const linksStore = tx.objectStore(LINK_STORE);
      const current = await request(linksStore.index('noteId').getAll(IDBKeyRange.only(row.id)));
      const wanted = new Set(linkRows.map(link => link.id));
      for (const oldLink of current) if (!wanted.has(oldLink.id)) await request(linksStore.delete(oldLink.id));
      for (const link of linkRows) await request(linksStore.put(link));
    }
    const fileId = row.fileId || (first?.entityType === 'LEGAL_FILE' ? first.entityId : null);
    const operation = action || (isNew ? 'created' : 'updated');
    await request(tx.objectStore(STORE.activityLog).add(activity(office, row.id, operation, fileId)));
    return row;
  });
  events.emit('entity:changed', {entityType: NOTE_STORE, id: out.id});
  return out;
}

function sanitizeLinks(noteId, links = []) {
  const out = [];
  for (const input of links.slice(0, MAX_LINKS)) {
    const entityType = String(input?.entityType || '').toUpperCase();
    const entityId = clean(input?.entityId, 200).trim();
    const relationType = clean(input?.relationType || 'CONTEXT', 80).trim() || 'CONTEXT';
    if (!NOTE_ENTITY_TYPES.includes(entityType) || !entityId) continue;
    out.push({id: `${noteId}::${entityType}::${entityId}::${relationType}`, noteId, entityType, entityId, relationType, createdAt: input.createdAt || nowIso()});
  }
  return [...new Map(out.map(row => [row.id, row])).values()];
}

export async function linksForNote(office, noteId) {
  if (!noteId) return [];
  return office.r.quickNoteLinks.byIndex('noteId', noteId, MAX_LINKS);
}

export async function notesForEntity(office, entityType, entityId, {limit = 100} = {}) {
  const type = String(entityType || '').toUpperCase();
  if (!entityId) return [];
  const ids = new Set();
  const linked = await office.r.quickNoteLinks.byIndex('entityType_entityId', [type, String(entityId)], Math.min(MAX_LINKS, limit)).catch(() => []);
  linked.forEach(link => ids.add(link.noteId));
  const direct = [];
  const directFields = {LEGAL_FILE: 'fileId', CASE: 'caseId', CLIENT: 'clientId'};
  const field = directFields[type];
  if (field && office.r.caseNotes) direct.push(...await office.r.caseNotes.byIndex(field, String(entityId), Math.min(limit, 500)).catch(() => []));
  const rows = ids.size ? await office.r.caseNotes.getMany([...ids]) : [];
  const merged = [...new Map([...direct, ...rows].filter(row => !row.isDeleted && !row.deletedAt).map(row => [row.id, row])).values()];
  return merged.sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''))).slice(0, limit);
}

export async function linkQuickNote(office, noteId, link, {relationType = 'CONTEXT'} = {}) {
  const note = await getQuickNote(office, noteId);
  if (!note) throw new AppError(ERR.NOT_FOUND, 'الملاحظة غير موجودة.');
  const rows = await linksForNote(office, noteId);
  const next = sanitizeLinks(noteId, [...rows, {...link, relationType}]);
  const updated = {...note, triagedAt: note.triagedAt || nowIso(), updatedAt: nowIso(), version: Number(note.version || 0) + 1};
  const entityType = String(link?.entityType || '').toUpperCase();
  const entityId = String(link?.entityId || '');
  if (!entityStore[entityType] || !entityId) throw new AppError(ERR.VALIDATION, 'نوع السجل أو معرّفه غير صالح.');
  if (entityType !== 'QUICK_NOTE') {
    const target = await office.r[entityStore[entityType]].get(entityId).catch(() => null);
    if (!target) throw new AppError(ERR.NOT_FOUND, 'السجل المراد ربط الملاحظة به غير موجود.');
    if (!updated.sourceId) { updated.sourceType = entityType; updated.sourceId = entityId; }
    if (entityType === 'LEGAL_FILE') updated.fileId = entityId;
    if (entityType === 'CLIENT') updated.clientId = entityId;
    if (entityType === 'CASE') { updated.caseId = entityId; updated.fileId = updated.fileId || target.fileId || ''; }
  }
  updated.searchTextNormalized = normalizeSearch(noteText(updated) + ' ' + next.map(x => `${x.entityType} ${x.entityId}`).join(' '));
  return saveQuickNote(office, updated, {id: noteId, links: next, action: 'linked'});
}

export async function unlinkQuickNote(office, noteId, linkId) {
  const note = await getQuickNote(office, noteId);
  if (!note) throw new AppError(ERR.NOT_FOUND, 'الملاحظة غير موجودة.');
  const links = (await linksForNote(office, noteId)).filter(link => link.id !== linkId);
  const has = (type, field) => links.some(link => link.entityType === type) ? note[field] : '';
  const first = links[0];
  return saveQuickNote(office, {
    ...note,
    sourceType: first?.entityType || '', sourceId: first?.entityId || '',
    fileId: has('LEGAL_FILE', 'fileId'), caseId: has('CASE', 'caseId'), clientId: has('CLIENT', 'clientId')
  }, {id: noteId, links, action: 'unlinked'});
}

export async function updateNoteState(office, noteId, patch = {}, action = 'updated') {
  const note = await getQuickNote(office, noteId, {raw: Boolean(patch.deletedAt !== undefined || patch.isDeleted !== undefined || action === 'restored')});
  if (!note) throw new AppError(ERR.NOT_FOUND, 'الملاحظة غير موجودة.');
  const data = {...note, ...patch};
  if (patch.lifecycle === NOTE_LIFECYCLES.DONE) data.completedAt = patch.completedAt || nowIso();
  if (patch.lifecycle === NOTE_LIFECYCLES.OPEN) data.completedAt = null;
  return saveQuickNote(office, data, {id: noteId, action, includeDeleted: Boolean(patch.deletedAt !== undefined || patch.isDeleted !== undefined || action === 'restored')});
}

export const completeQuickNote = (office, id) => updateNoteState(office, id, {lifecycle: NOTE_LIFECYCLES.DONE}, 'completed');
export const reopenQuickNote = (office, id) => updateNoteState(office, id, {lifecycle: NOTE_LIFECYCLES.OPEN}, 'reopened');
export const archiveQuickNote = (office, id) => updateNoteState(office, id, {archivedAt: nowIso(), isArchived: true}, 'archived');
// Archive is an independent dimension from soft delete. Restoring a trashed note
// therefore only clears the tombstone and preserves a previous archive state.
export const unarchiveQuickNote = (office, id) => updateNoteState(office, id, {archivedAt: null, isArchived: false}, 'unarchived');
export const restoreQuickNote = (office, id) => updateNoteState(office, id, {deletedAt: null, isDeleted: false}, 'restored');
export const snoozeQuickNote = (office, id, until) => updateNoteState(office, id, {snoozedUntil: cleanTimestamp(until)}, until ? 'snoozed' : 'unsnoozed');

export async function toggleQuickNoteChecklist(office, id, index, done) {
  const note = await getQuickNote(office, id);
  if (!note) throw new AppError(ERR.NOT_FOUND, 'الملاحظة غير موجودة.');
  if (note.isDeleted || note.deletedAt) throw new AppError(ERR.CONFLICT, 'استعد الملاحظة من السلة قبل تعديل قائمة التحقق.');
  const checklist = normalizeChecklist(note.checklist);
  const position = Number(index);
  if (!Number.isInteger(position) || !checklist[position]) throw new AppError(ERR.NOT_FOUND, 'بند قائمة التحقق غير موجود.');
  checklist[position] = {...checklist[position], done: Boolean(done), doneAt: done ? nowIso() : null};
  return saveQuickNote(office, {...note, checklist}, {id, expectedVersion: note.version, action: 'checklist'});
}

export async function deleteQuickNote(office, id) {
  // Read the raw row so retrying the same user action is idempotent even after
  // the repository's normal read hides soft-deleted rows.
  const note = await getQuickNote(office, id, {raw: true});
  if (!note) throw new AppError(ERR.NOT_FOUND, 'الملاحظة غير موجودة.');
  if (note.isDeleted || note.deletedAt) return note;
  const now = nowIso();
  return updateNoteState(office, id, {deletedAt: now, isDeleted: true}, 'deleted');
}

export async function purgeQuickNote(office, id) {
  const row = await getQuickNote(office, id, {raw: true});
  if (!row) throw new AppError(ERR.NOT_FOUND, 'الملاحظة غير موجودة في السلة.');
  if (!row.deletedAt && !row.isDeleted) throw new AppError(ERR.CONFLICT, 'لا يمكن الإزالة النهائية قبل نقل الملاحظة إلى السلة.');
  await transaction(office.ctx, [NOTE_STORE, LINK_STORE, STORE.activityLog], async tx => {
    await request(tx.objectStore(NOTE_STORE).delete(id));
    const links = await request(tx.objectStore(LINK_STORE).index('noteId').getAll(IDBKeyRange.only(id)));
    for (const link of links) await request(tx.objectStore(LINK_STORE).delete(link.id));
    await request(tx.objectStore(STORE.activityLog).add(activity(office, id, 'purged')));
  }, {captureChanges: true});
  events.emit('entity:changed', {entityType: NOTE_STORE, id});
  return true;
}

function encodeManualCursor(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeManualCursor(value) {
  try {
    const binary = atob(String(value));
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new AppError(ERR.VALIDATION, 'مؤشر ترتيب الملاحظات غير صالح.');
  }
}

const manualKeyOf = row => row?.sortKey || `\u0000${row?.createdAt || row?.updatedAt || row?.id || ''}::${row?.id || ''}`;

/** ملاحظة «لم تُفرز بعد»: بلا وسم/موعد/ربط/إشارة فرز — أساس صندوق الالتقاط. */
function isInboxRow(row) {
  return !row?.triagedAt && !row?.tagIds?.length && !row?.dueAt && !row?.sourceId && !row?.fileId && !row?.caseId && !row?.clientId;
}

/**
 * Manual ordering compatibility stream.
 *
 * v18 deliberately did not backfill historical caseNotes, so old rows may not
 * have sortKey and therefore cannot appear in the sortKey index. This merges a
 * cursor over indexed rows with a cursor over legacy rows (createdAt index),
 * one item at a time. It never materialises the notes store and keeps pending
 * heads as ids inside the opaque local cursor.
 */
async function pageManualQuickNotes(office, {predicate, limit, cursor, includeDeleted}) {
  const initial = cursor ? decodeManualCursor(cursor) : {};
  if (initial.sessionToken && initial.sessionToken !== office.ctx.token) throw new AppError(ERR.STALE, 'انتهت صلاحية مؤشر ترتيب الملاحظات.');
  const state = {
    sessionToken: office.ctx.token,
    indexedCursor: initial.indexedCursor || null,
    legacyCursor: initial.legacyCursor || null,
    indexedPending: initial.indexedPending || null,
    legacyPending: initial.legacyPending || null,
    indexedDone: Boolean(initial.indexedDone),
    legacyDone: Boolean(initial.legacyDone)
  };
  const source = (name, index, filter) => ({name, index, filter});
  const indexed = source('indexed', 'sortKey', predicate);
  const legacy = source('legacy', 'createdAt', row => !row.sortKey && predicate(row));
  const rawById = async id => (id ? (await office.r.caseNotes.getManyRaw([id]))[0] || null : null);

  const load = async (which, spec) => {
    const pendingKey = `${which}Pending`, cursorKey = `${which}Cursor`, doneKey = `${which}Done`;
    if (state[doneKey]) return null;
    if (state[pendingKey]) {
      const pending = state[pendingKey];
      const row = await rawById(pending.id);
      if (row && (includeDeleted || !row.isDeleted) && spec.filter(row)) return {row, pending};
      state[cursorKey] = pending.after || null;
      state[pendingKey] = null;
      if (!pending.hasMore) { state[doneKey] = true; return null; }
    }
    const result = await office.r.caseNotes.page({
      index: spec.index, cursor: state[cursorKey], limit: 1, direction: 'next', filter: spec.filter, includeDeleted
    });
    if (!result.items.length) { state[doneKey] = true; state[cursorKey] = null; return null; }
    const row = result.items[0];
    const pending = {id: row.id, after: result.nextCursor, hasMore: Boolean(result.hasMore)};
    state[pendingKey] = pending;
    return {row, pending};
  };

  let indexedHead = await load('indexed', indexed);
  let legacyHead = await load('legacy', legacy);
  const rows = [];
  while (rows.length < Math.min(Math.max(1, limit), MAX_PAGE) && (indexedHead || legacyHead)) {
    const takeIndexed = indexedHead && (!legacyHead || manualKeyOf(indexedHead.row) <= manualKeyOf(legacyHead.row));
    const which = takeIndexed ? 'indexed' : 'legacy';
    const head = takeIndexed ? indexedHead : legacyHead;
    rows.push(head.row);
    const pendingKey = `${which}Pending`, cursorKey = `${which}Cursor`, doneKey = `${which}Done`;
    state[cursorKey] = head.pending.after || null;
    state[pendingKey] = null;
    if (!head.pending.hasMore) state[doneKey] = true;
    if (which === 'indexed') indexedHead = await load('indexed', indexed);
    else legacyHead = await load('legacy', legacy);
  }

  const nextCursor = indexedHead || legacyHead || state.indexedCursor || state.legacyCursor
    ? encodeManualCursor(state) : null;
  return {items: rows, nextCursor, prevCursor: null, hasMore: Boolean(nextCursor), hasPrev: Boolean(cursor)};
}

export async function pageQuickNotes(office, {query = '', status = 'ACTIVE', sort = 'updated', limit = 50, cursor = null, direction = 'prev', filter = null} = {}) {
  const parsed = parseQuickNoteQuery(query);
  const now = nowIso();
  const sortMap = {updated: 'updatedAt', newest: 'createdAt', oldest: 'createdAt', due: 'dueAt', manual: 'sortKey'};
  const index = sortMap[sort] || 'updatedAt';
  const dir = sort === 'oldest' || sort === 'manual' ? 'next' : direction;
  const predicate = row => {
    if (!matchesQuickNoteQuery(row, parsed, now, {includeDeleted: status === 'TRASH'})) return false;
    const state = effectiveNoteState(row, now);
    if (status && status !== 'ALL') {
      if (status === 'TRASH' && state !== 'TRASH') return false;
      if (status === 'ARCHIVED' && state !== 'ARCHIVED') return false;
      if (status === 'DONE' && state !== 'DONE') return false;
      if (status === 'SNOOZED' && state !== 'SNOOZED') return false;
      // صندوق الالتقاط = ملاحظة مفتوحة لم تُفرز بعد. قبل v5.15 كانت أي ملاحظة بلا
      // إشارة فرز تظهر هنا حتى لو كانت منجزة/مؤرشفة، فيشوّه العدّاد وينتقل المستخدم
      // إلى صندوق يحتوي عملًا منتهيًا.
      if (status === 'INBOX' && (state !== 'ACTIVE' || !isInboxRow(row))) return false;
      if (status === 'ACTIVE' && !['ACTIVE', 'SNOOZED'].includes(state)) return false;
    }
    return !filter || filter(row, state);
  };
  const result = sort === 'manual'
    ? await pageManualQuickNotes(office, {predicate, limit, cursor, includeDeleted: status === 'TRASH'})
    : await office.r.caseNotes.page({index, cursor, limit: Math.min(Math.max(1, limit), MAX_PAGE), direction: dir, filter: predicate, includeDeleted: status === 'TRASH'});
  return {...result, rows: result.items.map(row => ({...row, effectiveState: effectiveNoteState(row, now), isSnoozeExpired: isSnoozeExpired(row, now)})), query: parsed, index, direction: dir};
}

export async function countQuickNotes(office, {status = 'ACTIVE', query = ''} = {}) {
  // count() remains O(1) for the common all/open dashboard counters. Filtered counters
  // use a bounded cursor rather than materialising every note in a page.
  if (!query && status === 'ALL') return office.r.caseNotes.count();
  let count = 0, cursor = null;
  do {
    const page = await pageQuickNotes(office, {status, query, limit: MAX_PAGE, cursor});
    count += page.rows.length; cursor = page.hasMore ? page.nextCursor : null;
    if (count > 100000) break;
  } while (cursor);
  return count;
}

/**
 * عدّ كل الصناديق في مسحة واحدة بدل أربع مسحات كاملة متوازية (توفير كبير على المخازن الكبيرة).
 * كل مفتاح يطابق ما يعيده العرض المقابل تمامًا (ACTIVE = مفتوحة + مؤجلة، INBOX = مفتوحة لم تُفرز)،
 * و`capped` تعني أن المسحة بلغت سقف الصفحات فالأعداد الحقيقية أكبر ويُعرض لها علامة +.
 */
export async function quickNotesStats(office, {pageLimit = 100, maxRows = 20000} = {}) {
  const counts = {INBOX: 0, ACTIVE: 0, DONE: 0, SNOOZED: 0, ARCHIVED: 0, TRASH: 0, ALL: 0, capped: false};
  let cursor = null, scanned = 0;
  do {
    const page = await office.r.caseNotes.page({index: 'updatedAt', cursor, limit: Math.min(Math.max(1, Number(pageLimit) || 100), MAX_PAGE), direction: 'prev', includeDeleted: true});
    for (const row of page.items) {
      scanned += 1;
      counts.ALL += 1;
      const state = effectiveNoteState(row);
      if (state === 'TRASH') counts.TRASH += 1;
      else if (state === 'ACTIVE') { counts.ACTIVE += 1; if (isInboxRow(row)) counts.INBOX += 1; }
      else if (state === 'SNOOZED') { counts.ACTIVE += 1; counts.SNOOZED += 1; }
      else counts[state] += 1; // DONE / ARCHIVED
      if (scanned >= maxRows) { counts.capped = true; break; }
    }
    cursor = counts.capped ? null : (page.hasMore ? page.nextCursor : null);
  } while (cursor);
  return counts;
}

/** إفراغ السلة: جلسة واحدة تمسح حتى `limit` ملاحظة محذوفة وروابطها نهائيًا، بلا حذف خارج السلة. */
export async function emptyQuickNoteTrash(office, {limit = 200} = {}) {
  const cap = Math.min(Math.max(1, Number(limit) || 1), 500);
  const page = await pageQuickNotes(office, {status: 'TRASH', limit: cap});
  const ids = page.rows.map(row => row.id);
  if (!ids.length) return {purged: 0};
  await transaction(office.ctx, [NOTE_STORE, LINK_STORE, STORE.activityLog], async tx => {
    const notes = tx.objectStore(NOTE_STORE), links = tx.objectStore(LINK_STORE);
    for (const id of ids) {
      await request(notes.delete(id));
      const rows = await request(links.index('noteId').getAll(IDBKeyRange.only(id)));
      for (const link of rows) await request(links.delete(link.id));
    }
    await request(tx.objectStore(STORE.activityLog).add(activity(office, 'bulk', 'purged', null)));
  }, {captureChanges: true});
  events.emit('entity:changed', {entityType: NOTE_STORE, id: 'bulk'});
  return {purged: ids.length};
}

/** إضافة وسم واحد إلى مجموعة ملاحظات في معاملة واحدة (دمج مع وسوم كل ملاحظة دون مساس بالباقي). */
export async function addTagToQuickNotes(office, ids = [], tag = '') {
  const value = clean(tag, 80).trim();
  if (!value) throw new AppError(ERR.VALIDATION, 'اكتب نص الوسم أولًا.');
  const unique = [...new Set(ids.filter(Boolean))].slice(0, 500);
  if (!unique.length) return {count: 0};
  const rows = await office.r.caseNotes.getManyRaw(unique);
  const updated = rows
    .filter(row => !row.deletedAt && !row.isDeleted && !(row.tagIds || []).includes(value))
    .map(row => normalizeInput({...row, tagIds: [...(row.tagIds || []), value]}, row, {id: row.id}));
  if (!updated.length) return {count: 0};
  await transaction(office.ctx, [NOTE_STORE, STORE.activityLog], async tx => {
    for (const row of updated) await request(tx.objectStore(NOTE_STORE).put(row));
    await request(tx.objectStore(STORE.activityLog).add(activity(office, 'bulk', 'tagged', null)));
  });
  events.emit('entity:changed', {entityType: NOTE_STORE, id: 'bulk'});
  return {count: updated.length};
}

/**
 * التذكيرات: مسحتان محدودتان على فهرسي remindAt وdueAt تُعيدان القسمتين
 * «مستحقة الآن» و«القادمة خلال horizonDays» معًا — أساس شارة الجرس وصفحة التذكيرات.
 * لا تُحمّل المخزن كله ولا تشمل السلة/الأرشفة/المنجز/المؤجل (state مشتق لا يُكتب).
 */
export async function dueReminders(office, {now = nowIso(), horizonDays = 7, limit = 200} = {}) {
  const today = localDate(dateNow());
  const horizon = addDays(today, Math.max(1, Number(horizonDays) || 7));
  const horizonIso = `${horizon}T23:59:59.999Z`;
  const cap = Math.min(Math.max(1, Number(limit) || 1), 500);
  const qualify = row => !['TRASH', 'ARCHIVED', 'DONE', 'SNOOZED'].includes(effectiveNoteState(row, now));
  const [reminders, dues] = await Promise.all([
    office.r.caseNotes.reportRange({index: 'remindAt', lower: '', upper: horizonIso, direction: 'next', limit: cap, filter: qualify}).catch(() => []),
    // dueAt يُخزَّن '' بلا موعد — والسلة الفارغة مفتاح صالح في الفهرس، فيبدأ النطاق من أول تاريخ صحيح.
    office.r.caseNotes.reportRange({index: 'dueAt', lower: '0000-01-01', upper: horizon, direction: 'next', limit: cap, filter: qualify}).catch(() => [])
  ]);
  const byId = new Map();
  const earliestOf = row => {
    const times = [row.remindAt ? String(row.remindAt) : '', row.dueAt ? `${row.dueAt}T00:00:00.000Z` : ''].filter(Boolean).sort();
    return times[0] || '';
  };
  for (const row of [...reminders, ...dues]) if (!byId.has(row.id)) byId.set(row.id, row);
  const isDueNow = row => Boolean((row.remindAt && String(row.remindAt) <= now) || (row.dueAt && row.dueAt <= today));
  const rows = [...byId.values()].map(row => ({...row, reminderDueNow: isDueNow(row), reminderAt: earliestOf(row)}));
  const rank = row => (row.reminderDueNow ? '0' : '1') + row.reminderAt;
  rows.sort((a, b) => rank(a).localeCompare(rank(b)));
  return {
    due: rows.filter(row => row.reminderDueNow).slice(0, cap),
    upcoming: rows.filter(row => !row.reminderDueNow).slice(0, cap),
    capped: reminders.length >= cap || dues.length >= cap
  };
}

export async function noteAgenda(office, {from = localDate(), to = addDays(localDate(), 7), limit = 200} = {}) {
  const result = await office.r.caseNotes.reportRange({index: 'dueAt', lower: from, upper: `${to}\uffff`, direction: 'next', limit: Math.min(limit, 5000), filter: row => !row.isDeleted && row.lifecycle !== NOTE_LIFECYCLES.DONE && effectiveNoteState(row) !== 'SNOOZED'});
  return result.filter(row => !row.archivedAt && !row.deletedAt).map(row => ({...row, effectiveState: effectiveNoteState(row)}));
}

export async function needsActionNotes(office, {limit = 100} = {}) {
  const today = localDate();
  const now = nowIso();
  const cap = Math.min(Math.max(1, Number(limit) || 1), 5000);
  const qualifies = row => {
    const state = effectiveNoteState(row, now);
    return state !== 'TRASH' && state !== 'ARCHIVED' && state !== 'DONE' && state !== 'SNOOZED'
      && ((row.dueAt && row.dueAt <= today) || [NOTE_PRIORITIES.HIGH, NOTE_PRIORITIES.URGENT].includes(row.priority) || (row.remindAt && String(row.remindAt) <= now));
  };
  // Needs Action is the union of three bounded index reads. Reading only the
  // due-date stream could hide an urgent note with no due date behind a full
  // page of dated notes, so priority and reminder indexes are queried too.
  const read = options => office.r.caseNotes.reportRange({...options, limit: 5000, filter: qualifies}).catch(() => []);
  const [due, priority, reminders] = await Promise.all([
    read({index: 'dueAt', lower: '0000-01-01', upper: `${today}\uffff`, direction: 'prev'}),
    read({index: 'priority', lower: 'HIGH', upper: 'URGENT', direction: 'next'}),
    read({index: 'remindAt', lower: '', upper: now, direction: 'prev'})
  ]);
  const merged = [...new Map([...due, ...priority, ...reminders].map(row => [row.id, row])).values()];
  const rank = {URGENT: 4, HIGH: 3, NORMAL: 2, LOW: 1};
  return merged.sort((a, b) => String(a.dueAt || '9999-12-31').localeCompare(String(b.dueAt || '9999-12-31'))
    || (rank[b.priority] || 0) - (rank[a.priority] || 0)
    || String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''))).slice(0, cap);
}

// ---------- المسودات ----------
export function draftKey(contextKey = 'global') { return `draft:${getDeviceId()}:${clean(contextKey, 200) || 'global'}`; }
export async function saveQuickNoteDraft(office, {contextKey = 'global', noteId = '', content = '', title = '', ...rest} = {}) {
  const row = {id: draftKey(contextKey), noteId: clean(noteId, 200), ownerId: getDeviceId(), contextKey: clean(contextKey, 200), content: clean(content, 50000), title: clean(title, 500), ...rest, updatedAt: nowIso()};
  await office.r.caseNoteDrafts.put(row);
  return row;
}
export async function getQuickNoteDraft(office, contextKey = 'global') { return office.r.caseNoteDrafts.get(draftKey(contextKey)); }
export async function deleteQuickNoteDraft(office, contextKey = 'global') { return office.r.caseNoteDrafts.delete(draftKey(contextKey)); }
export async function listQuickNoteDrafts(office, limit = 20) { return office.r.caseNoteDrafts.page({index: 'updatedAt', direction: 'prev', limit}); }

export async function toggleQuickNoteFlag(office, id, field, value) {
  if (!['isPinned', 'isStarred', 'showOnOpen'].includes(field)) throw new AppError(ERR.VALIDATION, 'خاصية الملاحظة غير معروفة.');
  return updateNoteState(office, id, {[field]: Boolean(value), ...(field === 'isPinned' ? {pinnedAt: value ? nowIso() : null} : {})}, value ? (field === 'isPinned' ? 'pinned' : 'starred') : (field === 'isPinned' ? 'unpinned' : 'unstarred'));
}

export async function bulkUpdateQuickNotes(office, ids = [], patch = {}, action = 'bulk') {
  const unique = [...new Set(ids.filter(Boolean))].slice(0, 500);
  if (!unique.length) return {count: 0};
  const allowed = ['priority', 'colorToken', 'snoozedUntil', 'dueAt', 'lifecycle', 'archivedAt', 'deletedAt', 'isArchived', 'isDeleted', 'triagedAt'];
  const safePatch = Object.fromEntries(Object.entries(patch).filter(([key]) => allowed.includes(key)));
  const rows = await office.r.caseNotes.getManyRaw(unique);
  const now = nowIso();
  const updated = rows.filter(row => !row.deletedAt || safePatch.deletedAt === null).map(row => normalizeInput({...row, ...safePatch}, row, {id: row.id}));
  await transaction(office.ctx, [NOTE_STORE, STORE.activityLog], async tx => {
    for (const row of updated) await request(tx.objectStore(NOTE_STORE).put(row));
    await request(tx.objectStore(STORE.activityLog).add(activity(office, 'bulk', action, null)));
  });
  return {count: updated.length};
}

function midpointKey(left = '', right = '\uffff') {
  let prefix = '';
  for (let index = 0; index < 100; index += 1) {
    const low = index < left.length ? left.charCodeAt(index) : 0;
    const high = index < right.length ? right.charCodeAt(index) : 0xffff;
    if (high - low > 1) return prefix + String.fromCharCode(Math.floor((low + high) / 2));
    prefix += String.fromCharCode(low);
  }
  return `${left}\u0000`;
}

/** Return ordered keys strictly between two existing keys without renumbering the store. */
function keysBetween(left, right, count) {
  const out = []; let previous = left || '';
  const upper = right || '\uffff';
  for (let index = 0; index < count; index += 1) {
    previous = midpointKey(previous, upper);
    out.push(previous);
  }
  return out;
}

export async function reorderQuickNotes(office, ids = []) {
  const unique = [...new Set(ids.filter(Boolean))].slice(0, MAX_PAGE);
  if (!unique.length) return {count: 0};
  const rows = await office.r.caseNotes.getManyRaw(unique);
  const byId = new Map(rows.filter(row => !row.isDeleted && !row.deletedAt).map(row => [row.id, row]));
  if (byId.size !== unique.length) throw new AppError(ERR.CONFLICT, 'تغيّر عرض الملاحظات؛ أعد تحميل الصفحة قبل حفظ الترتيب.');
  const current = [...byId.values()].sort((a, b) => String(a.sortKey || `${a.updatedAt || a.createdAt || ''}::${a.id}`).localeCompare(String(b.sortKey || `${b.updatedAt || b.createdAt || ''}::${b.id}`)));
  const firstKey = String(current[0].sortKey || `${current[0].updatedAt || current[0].createdAt || ''}::${current[0].id}`);
  const lastKey = String(current.at(-1).sortKey || `${current.at(-1).updatedAt || current.at(-1).createdAt || ''}::${current.at(-1).id}`);
  const active = row => !row.isDeleted && !row.deletedAt;
  const [before, after] = await Promise.all([
    office.r.caseNotes.page({index: 'sortKey', direction: 'prev', upper: firstKey, upperOpen: true, limit: 1, filter: active}).catch(() => ({items: []})),
    office.r.caseNotes.page({index: 'sortKey', direction: 'next', lower: lastKey, lowerOpen: true, limit: 1, filter: active}).catch(() => ({items: []}))
  ]);
  const left = before.items?.[0]?.sortKey || '';
  const right = after.items?.[0]?.sortKey || '\uffff';
  const rankKeys = keysBetween(String(left), String(right), unique.length);
  const at = nowIso();
  const ordered = unique.map((id, index) => ({...byId.get(id), sortKey: rankKeys[index], updatedAt: at, version: Number(byId.get(id).version || 0) + 1, rev: Number(byId.get(id).rev || 0) + 1}));
  await transaction(office.ctx, [NOTE_STORE, STORE.activityLog], async tx => {
    for (const row of ordered) await request(tx.objectStore(NOTE_STORE).put(row));
    await request(tx.objectStore(STORE.activityLog).add(activity(office, 'bulk', 'reorder', null)));
  });
  events.emit('entity:changed', {entityType: NOTE_STORE, id: 'bulk'});
  return {count: ordered.length};
}

export function entityStoreForNoteType(type) { return entityStore[String(type || '').toUpperCase()] || null; }
export { normalizeSearch, tagsOf };
