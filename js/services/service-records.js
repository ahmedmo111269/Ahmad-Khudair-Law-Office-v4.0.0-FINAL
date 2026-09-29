// سجلات مستقلة للإعلانات والإنذارات وإعادات الإعلان، ومراجع المحضرين.
// هذا سجل وقائع إدارية فقط؛ لا يحسب مواعيد قانونية ولا يقيّم صحة الإعلان.
import { STORE } from '../db/schema.js';
import { transaction, request } from '../db/unit-of-work.js';
import { uid } from '../core/id.js';
import { Clock } from '../core/clock.js';
import { normalizeArabic } from '../core/search-normalizer.js';
import { AppError, ERR } from '../core/errors.js';
import { events } from '../core/events.js';

const pad = n => String(n).padStart(6, '0');

async function issueNumber(tx, year) {
  const counters = tx.objectStore(STORE.fileNumberCounters);
  const id = `service:${year}`;
  const counter = await request(counters.get(id));
  const next = (counter?.lastNumber || 0) + 1;
  await request(counters.put({ id, year, kind: 'service', lastNumber: next, updatedAt: Clock.now() }));
  return `SR-${year}-${pad(next)}`;
}

export async function saveServiceRecord(office, input, id = null) {
  const old = id ? await office.r.serviceRecords.get(id) : null;
  if (id && !old) throw new AppError(ERR.NOT_FOUND, 'سجل الإعلان / الإنذار غير موجود.');
  const now = Clock.now();
  const row = {
    ...(old || {}), ...input,
    id: id || uid(),
    createdAt: old?.createdAt || now,
    updatedAt: now,
    version: (old?.version || 0) + 1,
    isArchived: old?.isArchived || false,
    isDeleted: old?.isDeleted || false,
    recordState: old?.isDeleted ? 'deleted' : 'active',
    deletedAt: old?.deletedAt || null,
    actionType: input.actionType || old?.actionType || 'إعلان',
    status: input.status || old?.status || 'مسودة'
  };
  if (!row.fileId) throw new AppError(ERR.VALIDATION, 'يجب ربط الإعلان بملف.', { fileId: 'الملف مطلوب' });
  const [file, caseRow, hearing, party, bailiff, previous] = await Promise.all([
    office.r.files.get(row.fileId),
    row.caseId ? office.r.cases.get(row.caseId) : null,
    row.hearingId ? office.r.hearings.get(row.hearingId) : null,
    row.partyId ? office.r.fileParties.get(row.partyId) : null,
    row.bailiffId ? office.r.bailiffs.get(row.bailiffId) : null,
    row.previousServiceId ? office.r.serviceRecords.get(row.previousServiceId) : null
  ]);
  if (!file || file.isDeleted) throw new AppError(ERR.NOT_FOUND, 'الملف المرتبط غير موجود.');
  if (row.caseId && (!caseRow || (caseRow.isDeleted && row.caseId !== old?.caseId) || caseRow.fileId !== row.fileId)) throw new AppError(ERR.VALIDATION, 'المرحلة المختارة لا تتبع الملف المحدد.', { caseId: 'مرحلة غير مطابقة للملف' });
  if (row.hearingId && (!hearing || (hearing.isDeleted && row.hearingId !== old?.hearingId) || (hearing.fileId && hearing.fileId !== row.fileId))) throw new AppError(ERR.VALIDATION, 'الجلسة المختارة لا تتبع الملف المحدد.', { hearingId: 'جلسة غير مطابقة للملف' });
  if (row.partyId && (!party || (party.isDeleted && row.partyId !== old?.partyId) || party.fileId !== row.fileId)) throw new AppError(ERR.VALIDATION, 'الطرف المختار لا يتبع الملف المحدد.', { partyId: 'طرف غير مطابق للملف' });
  if (row.bailiffId && (!bailiff || (bailiff.isDeleted && row.bailiffId !== old?.bailiffId))) throw new AppError(ERR.NOT_FOUND, 'المحضر المحدد غير موجود.');
  if (row.previousServiceId && (!previous || (previous.isDeleted && row.previousServiceId !== old?.previousServiceId) || previous.fileId !== row.fileId)) throw new AppError(ERR.VALIDATION, 'الإعلان السابق لا يتبع الملف المحدد.', { previousServiceId: 'سجل غير مطابق للملف' });
  if (previous) { let cursor=previous; const seen=new Set(); for(let depth=0;cursor&&depth<1000;depth++){if(cursor.id===row.id||seen.has(cursor.id))throw new AppError(ERR.CONFLICT,'تعذر حفظ علاقة إعادة الإعلان بسبب دورة غير صحيحة.');seen.add(cursor.id);if(!cursor.previousServiceId)break;cursor=await office.r.serviceRecords.get(cursor.previousServiceId)}if(cursor?.previousServiceId&&seen.size>=1000)throw new AppError(ERR.CONFLICT,'سلسلة إعادة الإعلان أعمق من الحد الآمن للتحقق.'); }
  if (row.submittedAt && !/^\d{4}-\d{2}-\d{2}$/.test(row.submittedAt)) throw new AppError(ERR.VALIDATION, 'تاريخ التقديم غير صحيح.', { submittedAt: 'تاريخ غير صحيح' });
  if (row.serviceDate && !/^\d{4}-\d{2}-\d{2}$/.test(row.serviceDate)) throw new AppError(ERR.VALIDATION, 'تاريخ الإعلان غير صحيح.', { serviceDate: 'تاريخ غير صحيح' });
  if (party) {
    row.partyName = party.partyName || party.name || row.partyName || '';
    row.partyRole = party.role || row.partyRole || '';
  }
  if (bailiff) {
    row.bailiffName = bailiff.name || '';
    row.court = row.court || bailiff.court || '';
    row.section = row.section || bailiff.section || '';
    row.office = row.office || bailiff.office || '';
  }
  row.year = Number(row.year) || Number((row.submittedAt || row.createdAt).slice(0, 4));
  const result = await transaction(office.ctx, [STORE.serviceRecords, STORE.fileNumberCounters, STORE.files, STORE.activityLog], async tx => {
    if (!row.internalNumber) row.internalNumber = await issueNumber(tx, row.year || Number(now.slice(0, 4)));
    await request(tx.objectStore(STORE.serviceRecords).put(row));
    const files = tx.objectStore(STORE.files);
    const parent = await request(files.get(row.fileId));
    if (!parent || parent.isDeleted) throw new AppError(ERR.CONFLICT, 'الملف المرتبط لم يعد متاحًا.');
    parent.lastActivityAt = now; parent.updatedAt = now; parent.version = (parent.version || 0) + 1;
    await request(files.put(parent));
    await request(tx.objectStore(STORE.activityLog).add({
      id: uid(), entityType: STORE.serviceRecords, entityId: row.id, action: id ? 'update' : 'create',
      timestamp: now, summary: `${id ? 'تحديث' : 'إنشاء'} سجل إعلان / إنذار`, metadata: {}, fileId: row.fileId
    }));
    return row;
  });
  events.emit('entity:changed', { entityType: STORE.serviceRecords, id: result.id });
  events.emit('entity:changed', { entityType: STORE.files, id: row.fileId });
  return result;
}

export async function reannounceServiceRecord(office, id) {
  const old = await office.r.serviceRecords.get(id);
  if (!old || old.isDeleted) throw new AppError(ERR.NOT_FOUND, 'سجل الإعلان السابق غير موجود.');
  const [party,bailiff,caseRow,hearing]=await Promise.all([old.partyId?office.r.fileParties.get(old.partyId):null,old.bailiffId?office.r.bailiffs.get(old.bailiffId):null,old.caseId?office.r.cases.get(old.caseId):null,old.hearingId?office.r.hearings.get(old.hearingId):null]);
  return saveServiceRecord(office, {
    fileId: old.fileId, caseId: caseRow&&!caseRow.isDeleted?old.caseId:'', hearingId: hearing&&!hearing.isDeleted?old.hearingId:'', partyId: party&&!party.isDeleted?old.partyId:'',
    partyName: old.partyName || '', partyRole: old.partyRole || '', actionType: 'إعادة إعلان', type: old.type || 'إعادة إعلان',
    court: old.court || '', section: old.section || '', office: old.office || '', bailiffId: bailiff&&!bailiff.isDeleted?old.bailiffId:'', bailiffName: old.bailiffName || '',
    previousServiceId: old.id, governorate: old.governorate || '', district: old.district || '', area: old.area || '',
    address: old.address || '', alternativeAddress: old.alternativeAddress || '', addressNotes: old.addressNotes || '',
    status: 'مسودة', result: '', noticeNumber: '', submittedAt: '', serviceDate: '', notes: ''
  });
}

export async function saveBailiff(office, input, id = null) {
  const old = id ? await office.r.bailiffs.get(id) : null;
  if (id && !old) throw new AppError(ERR.NOT_FOUND, 'سجل المحضر غير موجود.');
  const name = String(input.name ?? old?.name ?? '').trim();
  if (!name) throw new AppError(ERR.VALIDATION, 'اسم المحضر مطلوب.', { name: 'مطلوب' });
  const now = Clock.now();
  const row = {
    ...(old || {}), ...input, id: id || uid(), name, nameNormalized: normalizeArabic(name),
    isActive: input.isActive === undefined ? (old?.isActive !== false) : Boolean(input.isActive),
    activeStatus: (input.isActive === undefined ? (old?.isActive !== false) : Boolean(input.isActive)) ? 'active' : 'inactive',
    createdAt: old?.createdAt || now, updatedAt: now, version: (old?.version || 0) + 1,
    isArchived: old?.isArchived || false, isDeleted: old?.isDeleted || false
  };
  await transaction(office.ctx, [STORE.bailiffs, STORE.activityLog], async tx => {
    await request(tx.objectStore(STORE.bailiffs).put(row));
    await request(tx.objectStore(STORE.activityLog).add({ id: uid(), entityType: STORE.bailiffs, entityId: row.id, action: id ? 'update' : 'create', timestamp: now, summary: `${id ? 'تحديث' : 'إضافة'} بيانات محضر`, metadata: {} }));
  });
  events.emit('entity:changed', { entityType: STORE.bailiffs, id: row.id });
  return row;
}

export async function fileServiceRecords(office, fileId, limit = 5000) {
  const bounded=Math.min(5000,Math.max(1,limit));
  const [rows,total]=await Promise.all([
    office.r.serviceRecords.byIndexKey('fileId_recordState',[fileId,'active'],bounded),
    office.r.serviceRecords.countIndex('fileId_recordState',[fileId,'active'])
  ]);
  rows.sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
  return {rows,total,more:total>rows.length};
}

export async function serviceCycle(office, id) {
  const current = await office.r.serviceRecords.get(id);
  if (!current || current.isDeleted) throw new AppError(ERR.NOT_FOUND, 'سجل الإعلان غير موجود.');
  const [all,total] = await Promise.all([
    office.r.serviceRecords.byIndexKey('fileId_recordState',[current.fileId,'active'],5000),
    office.r.serviceRecords.countIndex('fileId_recordState',[current.fileId,'active'])
  ]);
  const byId = new Map(all.map(x => [x.id, x]));
  let root = current; const seen = new Set([current.id]);
  while (root.previousServiceId && byId.has(root.previousServiceId) && !seen.has(root.previousServiceId)) { root = byId.get(root.previousServiceId); seen.add(root.id); }
  const children = new Map();
  for (const row of all) if (row.previousServiceId) { if (!children.has(row.previousServiceId)) children.set(row.previousServiceId, []); children.get(row.previousServiceId).push(row); }
  for (const list of children.values()) list.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  const records = [], visited = new Set();let hasBranches=false;
  const visit = (row, depth = 0) => { if (!row || visited.has(row.id)) return; visited.add(row.id); records.push({ ...row, __depth: depth });const next=children.get(row.id)||[];if(next.length>1)hasBranches=true;for (const child of next) visit(child, depth + 1); };
  visit(root);
  return { current, root, records, hasBranches, more: total > all.length };
}
