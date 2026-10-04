// Quick Notes regression tests: the feature must stay on caseNotes, use cursor reads,
// keep lifecycle/archive/delete/snooze independent, and preserve links atomically.
import {upgradeSchema, STORE} from '../db/schema.js';
import {SCHEMA_VERSION} from '../core/constants.js';
import {ERR} from '../core/errors.js';
import {Office} from '../services/office.js';
import {createLegalFile} from '../services/legal-files.js';
import * as QN from '../services/quick-notes.js';
import {saveWorkItemFromQuickNote} from '../services/work-items.js';
import {searchStore} from '../services/search-engine.js';

function openDb(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, SCHEMA_VERSION);
    request.onupgradeneeded = event => upgradeSchema(request.result, event.target.transaction);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

const close = env => { try { env.db.close(); indexedDB.deleteDatabase(env.name); } catch {} };

async function env() {
  const name = `AhmadKhudairLawOfficeDB__test__quick-notes__${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const db = await openDb(name);
  const office = new Office({db, assert() {}, token: `quick-${name}`, profile: {id: 'quick-test', databaseName: name}});
  const client = await office.saveClient({fullName: 'موكل اختبار الملاحظات'});
  const file = await createLegalFile(office, {clientId: client.id, title: 'ملف اختبار الملاحظات', fileType: 'مدني'});
  const stage = await office.createCase({fileId: file.id, stageType: 'دعوى', caseNumber: 'QN-1', caseYear: '2026'});
  return {db, office, client, file, stage, name};
}

const rejects = async fn => { try { await fn(); } catch (error) { return error; } throw Error('Expected promise to reject'); };

export async function runQuickNotesTests(test, expect) {
  test('ملاحظات سريعة/مجال: الحالة الفعالة مشتقة ولا تكتب انتهاء التأجيل', () => {
    const snoozed = {id: 'n', lifecycle: QN.NOTE_LIFECYCLES.OPEN, snoozedUntil: '2026-10-04T09:00:00.000Z', isDeleted: false};
    expect(QN.effectiveNoteState(snoozed, '2026-10-03T12:00:00.000Z')).toBe('SNOOZED');
    expect(QN.effectiveNoteState(snoozed, '2026-10-05T12:00:00.000Z')).toBe('ACTIVE');
    expect(QN.isSnoozeExpired(snoozed, '2026-10-05T12:00:00.000Z')).toBe(true);
    expect(snoozed.snoozedUntil).toBe('2026-10-04T09:00:00.000Z');
  });

  test('ملاحظات سريعة/بحث: العربية والأرقام الهندية ومفاتيح البحث ذات المسافة تُفهم دون تغيير النص', () => {
    const query = QN.parseQuickNoteQuery('وسم: مهم أولوية: عاجلة متأخر ١٢٣');
    expect(query.tag).toBe('مهم');
    expect(query.priority).toBe(QN.NOTE_PRIORITIES.URGENT);
    expect(query.states.has('OVERDUE')).toBe(true);
    expect(query.text.join(' ')).toContain('123');
    const proposals = QN.smartCaptureProposals('اتصل بموكل ١٢٣/٢٠٢٦ !! غدًا');
    expect(proposals.some(item => item.type === 'priority' && item.value === QN.NOTE_PRIORITIES.URGENT)).toBe(true);
    expect(proposals.some(item => item.type === 'file' && item.value === '123/2026')).toBe(true);
  });

  test('ملاحظات سريعة/حفظ: caseNotes هو المصدر، النص غير موثوق يبقى قيمة، والإصدار يمنع التعارض', async () => {
    const e = await env();
    try {
      const note = await QN.saveQuickNote(e.office, {title: 'عنوان', content: '<img src=x onerror=alert(1)> نص', fileId: e.file.id, tagIds: 'مهم، مراجعة', priority: 'HIGH', checklist: [{text: 'مراجعة المستند'}, {text: 'إرسال الموعد', done: true}]});
      expect(note.kind).toBe('QUICK_NOTE');
      expect(note.content).toContain('<img');
      expect(note.contentFormat).toBe('plain');
      expect(note.checklist.length).toBe(2); expect(note.checklist[1].done).toBe(true);
      const checklistUpdate = await QN.toggleQuickNoteChecklist(e.office, note.id, 0, true);
      expect(checklistUpdate.checklist[0].done).toBe(true);
      expect(note.fileId).toBe(e.file.id);
      expect(note.version).toBe(1);
      const edited = await QN.saveQuickNote(e.office, {...checklistUpdate, title: 'عنوان معدل', content: note.content}, {id: note.id, expectedVersion: checklistUpdate.version});
      expect(edited.version).toBe(3);
      const conflict = await rejects(() => QN.saveQuickNote(e.office, {content: 'نسخة قديمة'}, {id: note.id, expectedVersion: note.version}));
      expect(conflict.code).toBe(ERR.CONFLICT);
      expect((await e.office.r.caseNotes.get(note.id)).content).toContain('<img');
      expect(await e.office.r.quickNoteLinks.count()).toBe(0);
    } finally { close(e); }
  });

  test('ملاحظات سريعة/ربط: روابط المعرّفات فقط، الرابط الوهمي يُرفض قبل أي كتابة', async () => {
    const e = await env();
    try {
      const note = await QN.saveQuickNote(e.office, {content: 'مراجعة الملف'});
      const linked = await QN.linkQuickNote(e.office, note.id, {entityType: 'LEGAL_FILE', entityId: e.file.id});
      expect(linked.fileId).toBe(e.file.id);
      const links = await QN.linksForNote(e.office, note.id);
      expect(links.length).toBe(1);
      expect(links[0].entityId).toBe(e.file.id);
      expect((await QN.notesForEntity(e.office, 'LEGAL_FILE', e.file.id)).some(row => row.id === note.id)).toBe(true);
      const converted = await saveWorkItemFromQuickNote(e.office, {...linked, fileId: '', caseId: '', clientId: ''});
      expect(converted.row.fileId).toBe(e.file.id);
      const bad = await rejects(() => QN.saveQuickNote(e.office, {content: 'لا تحفظ'}, {links: [{entityType: 'LEGAL_FILE', entityId: 'missing-file'}]}));
      expect(bad.code).toBe(ERR.NOT_FOUND);
      expect((await e.office.r.caseNotes.all()).some(row => row.content === 'لا تحفظ')).toBe(false);
    } finally { close(e); }
  });

  test('ملاحظات سريعة/بحث شامل: المرشح العربي يطبق على caseNotes دون نتائج فهرس زائفة', async () => {
    const e = await env();
    try {
      const urgent = await QN.saveQuickNote(e.office, {content: 'مراجعة عاجلة', priority: 'URGENT', tagIds: 'مهم'});
      await QN.saveQuickNote(e.office, {content: 'مراجعة عادية', priority: 'NORMAL', tagIds: 'مهم'});
      const priority = await searchStore(e.office, 'caseNotes', 'أولوية: عاجلة', {limit: 10});
      expect(priority.items.length).toBe(1); expect(priority.items[0].row.id).toBe(urgent.id);
      const tag = await searchStore(e.office, 'caseNotes', 'وسم: مهم', {limit: 10});
      expect(tag.items.length).toBe(2);
    } finally { close(e); }
  });

  test('ملاحظات سريعة/دورة: DONE والأرشفة والحذف والسلة والاستعادة أبعاد مستقلة', async () => {
    const e = await env();
    try {
      const note = await QN.saveQuickNote(e.office, {content: 'دورة حياة'});
      await QN.completeQuickNote(e.office, note.id);
      expect(QN.effectiveNoteState(await QN.getQuickNote(e.office, note.id))).toBe('DONE');
      await QN.reopenQuickNote(e.office, note.id);
      await QN.archiveQuickNote(e.office, note.id);
      let row = await QN.getQuickNote(e.office, note.id);
      expect(row.isArchived).toBe(true); expect(row.isDeleted).toBe(false); expect(QN.effectiveNoteState(row)).toBe('ARCHIVED');
      await QN.deleteQuickNote(e.office, note.id);
      row = await QN.getQuickNote(e.office, note.id);
      expect(row.isDeleted).toBe(true); expect(QN.effectiveNoteState(row)).toBe('TRASH');
      expect((await QN.pageQuickNotes(e.office, {status: 'TRASH'})).rows.some(item => item.id === note.id)).toBe(true);
      expect((await QN.deleteQuickNote(e.office, note.id)).id).toBe(note.id);
      await QN.restoreQuickNote(e.office, note.id);
      row = await QN.getQuickNote(e.office, note.id);
      expect(row.isDeleted).toBe(false); expect(row.isArchived).toBe(true); expect(QN.effectiveNoteState(row)).toBe('ARCHIVED');
      await QN.unarchiveQuickNote(e.office, note.id);
      row = await QN.getQuickNote(e.office, note.id);
      expect(row.isArchived).toBe(false); expect(QN.effectiveNoteState(row)).toBe('ACTIVE');
    } finally { close(e); }
  });

  test('ملاحظات سريعة/تأجيل: لا تظهر الملاحظة بلا موعد في يحتاج إجراء، وانتهاء التأجيل قراءة فقط', async () => {
    const e = await env();
    try {
      const plain = await QN.saveQuickNote(e.office, {content: 'بلا موعد'});
      const urgent = await QN.saveQuickNote(e.office, {content: 'عاجل', priority: 'URGENT'});
      const needs = await QN.needsActionNotes(e.office);
      expect(needs.some(row => row.id === urgent.id)).toBe(true);
      expect(needs.some(row => row.id === plain.id)).toBe(false);
      const snoozed = await QN.snoozeQuickNote(e.office, plain.id, '2099-01-02T09:00:00.000Z');
      const before = snoozed.updatedAt;
      expect(QN.effectiveNoteState(snoozed)).toBe('SNOOZED');
      expect(QN.effectiveNoteState(snoozed, '2100-01-01T00:00:00.000Z')).toBe('ACTIVE');
      expect((await e.office.r.caseNotes.get(plain.id)).updatedAt).toBe(before);
    } finally { close(e); }
  });

  test('ملاحظات سريعة/ترتيب: pagination والفهرس اليدوي لا يحمّلان كل المخزن، والتحويل إلى متابعة idempotent', async () => {
    const e = await env();
    try {
      const first = await QN.saveQuickNote(e.office, {content: 'أول ملاحظة', dueAt: '2026-10-01'});
      const second = await QN.saveQuickNote(e.office, {content: 'ثاني ملاحظة'});
      const third = await QN.saveQuickNote(e.office, {content: 'ثالث ملاحظة'});
      const fourth = await QN.saveQuickNote(e.office, {content: 'رابع ملاحظة'});
      const page = await QN.pageQuickNotes(e.office, {status: 'ALL', sort: 'manual', limit: 2});
      expect(page.rows.length).toBe(2); expect(page.hasMore).toBe(true);
      const pageTwo = await QN.pageQuickNotes(e.office, {status: 'ALL', sort: 'manual', limit: 2, cursor: page.nextCursor});
      expect(pageTwo.rows.length).toBe(2);
      expect(page.rows.some(row => pageTwo.rows.some(other => other.id === row.id))).toBe(false);
      await QN.reorderQuickNotes(e.office, page.rows.map(row => row.id).reverse());
      const refreshed = await QN.pageQuickNotes(e.office, {status: 'ALL', sort: 'manual', limit: 2});
      expect(refreshed.rows[0].id).toBe(second.id); expect(refreshed.rows[1].id).toBe(first.id);
      const refreshedTwo = await QN.pageQuickNotes(e.office, {status: 'ALL', sort: 'manual', limit: 2, cursor: refreshed.nextCursor});
      expect(refreshedTwo.rows.map(row => row.id).sort().join(',')).toBe([third.id, fourth.id].sort().join(','));
      await QN.reorderQuickNotes(e.office, refreshedTwo.rows.map(row => row.id).reverse());
      const finalOrder = await QN.pageQuickNotes(e.office, {status: 'ALL', sort: 'manual', limit: 10});
      expect(finalOrder.rows.map(row => row.id).slice(0, 2).join(',')).toBe([second.id, first.id].join(','));
      const created = await saveWorkItemFromQuickNote(e.office, {...second, fileId: e.file.id, caseId: e.stage.id});
      const reused = await saveWorkItemFromQuickNote(e.office, {...second, fileId: e.file.id, caseId: e.stage.id});
      expect(created.reused).toBe(false); expect(reused.reused).toBe(true); expect(reused.row.id).toBe(created.row.id);
      expect((await e.office.r.workItems.byIndex('sourceId', second.id)).length).toBe(1);
      // Existing caseNotes created before v18 have no sortKey. They must still
      // be visible in manual pagination without an implicit data rewrite.
      const legacyId = 'legacy-quick-note-without-sort-key';
      await e.office.r.caseNotes.put({id: legacyId, fileId: e.file.id, caseId: '', content: 'ملاحظة تاريخية بلا مفتاح ترتيب', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', isDeleted: false, isArchived: false});
      let legacyCursor = null; let legacyFound = false;
      for (let pageIndex = 0; pageIndex < 10 && !legacyFound; pageIndex += 1) {
        const legacyPage = await QN.pageQuickNotes(e.office, {status: 'ALL', sort: 'manual', limit: 1, cursor: legacyCursor});
        legacyFound ||= legacyPage.rows.some(row => row.id === legacyId);
        legacyCursor = legacyPage.hasMore ? legacyPage.nextCursor : null;
        if (!legacyCursor) break;
      }
      expect(legacyFound).toBe(true);
      expect((await e.office.r.caseNotes.get(legacyId)).sortKey).toBe(undefined);
    } finally { close(e); }
  });

  test('ملاحظات سريعة/مسودة: كتابة المسودة لا تُنشئ ملاحظة ولا نشاطًا، والاستعادة بعد إعادة الفتح ممكنة', async () => {
    const e = await env();
    try {
      const before = await e.office.r.activityLog.count();
      const draft = await QN.saveQuickNoteDraft(e.office, {contextKey: 'file:test', title: 'مسودة', content: 'لم تحفظ بعد'});
      expect(draft.id).toContain('draft:');
      expect((await QN.getQuickNoteDraft(e.office, 'file:test')).content).toBe('لم تحفظ بعد');
      expect(await e.office.r.caseNotes.count()).toBe(0);
      expect(await e.office.r.activityLog.count()).toBe(before);
      await QN.deleteQuickNoteDraft(e.office, 'file:test');
      expect(await QN.getQuickNoteDraft(e.office, 'file:test')).toBe(undefined);
    } finally { close(e); }
  });
}
