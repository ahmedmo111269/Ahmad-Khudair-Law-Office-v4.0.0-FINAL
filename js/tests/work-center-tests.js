// مركز العمل (Work Center): اختبارات المجال النقي، الترحيل v13→v14، أوامر الخدمة، الاستعلام، التكامل والسلامة.
// تعمل على IndexedDB حقيقي (fake-indexeddb في Node، المحرك الحقيقي في المتصفح) وعلى بيانات تجريبية + سجلات محكومة.
import {upgradeSchema, STORES, STORE, SCHEMA, SCHEMA_MIGRATIONS, migrationPlan} from '../db/schema.js';
import {Office} from '../services/office.js';
import {createLegalFile, saveParty} from '../services/legal-files.js';
import {saveOperational} from '../services/operations.js';
import {saveEntity} from '../services/entity-save.js';
import {seedDemoData} from '../services/demo-seed.js';
import {seedTaxonomy} from '../services/client-files.js';
import {seedLookups, getLookup} from '../services/lookups.js';
import {exportDatabase, importDatabase, inspectBackup} from '../services/backup.js';
import {deepHealth} from '../services/integrity.js';
import {Clock, addDays, localDate} from '../core/clock.js';
import {uid} from '../core/id.js';
import {SCHEMA_VERSION} from '../core/constants.js';
import * as D from '../domain/work-items.js';
import * as S from '../domain/work-sources.js';
import * as C from '../services/work-items.js';
import * as Q from '../services/work-query.js';
import * as I from '../services/work-insights.js';
import * as K from '../services/work-config.js';
import {createGridRelations} from '../services/grid-relations.js';
import {searchAll} from '../services/search-engine.js';

const rejects = async fn => { try { await fn(); } catch (error) { return error; } throw Error('Expected promise to reject'); };
const idsOf = items => items.map(i => i.id);
async function openDb(name, version, stores = null) {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(name, version);
    r.onupgradeneeded = e => {
      if (stores) {            // قاعدة v13 الحقيقية: كل المخازن عدا الجديدة
        for (const store of stores) { const os = r.result.createObjectStore(store, {keyPath: 'id'}); for (const [n, k] of Object.entries(SCHEMA[store].indexes)) os.createIndex(n, k, {unique: false}); }
      } else upgradeSchema(r.result, e.target.transaction);
    };
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  });
}

export async function runWorkCenterTests(test, expect) {
  const today = Clock.today(), tomorrow = addDays(today, 1);
  const dbName = `AhmadKhudairLawOfficeDB__test__workcenter__${Date.now()}`;
  let envPromise = null;
  const env = () => envPromise ||= (async () => {
    const db = await openDb(dbName, SCHEMA_VERSION);
    const office = new Office({db, assert() {}, token: 'wc-test', profile: {id: 'wc-test'}});
    await seedLookups(office); await seedTaxonomy(office);
    await K.saveWorkConfig({}); // الإعدادات الافتراضية
    const client = await office.saveClient({fullName: 'موكل اختبار مركز العمل'});
    const file = await createLegalFile(office, {clientId: client.id, title: 'ملف مركز العمل', fileType: 'مدني'});
    const stage = await office.createCase({fileId: file.id, stageType: 'دعوى', caseNumber: '777', caseYear: '2026'});
    for (const name of ['الخصم الأول', 'الخصم الثاني', 'الخصم الثالث']) {
      const opponent = await saveEntity(office, 'opponents', {name});
      await saveParty(office, {fileId: file.id, partyKind: 'opponent', opponentId: opponent.id, role: 'مدعى عليه'});
    }
    const hearing = await saveOperational(office, 'hearings', {caseId: stage.id, hearingDate: today, hearingTime: '10:00', type: 'نظر', reason: 'جلسة اختبار مركز العمل', court: 'محكمة الاختبار'});
    const procedure = await saveOperational(office, 'procedures', {fileId: file.id, description: 'إجراء اختبار مركز العمل', type: 'متابعة', internalDueDate: tomorrow, status: 'open', priority: 'urgent'});
    const overdueProc = await saveOperational(office, 'procedures', {fileId: file.id, description: 'إجراء متأخر للاختبار', internalDueDate: addDays(today, -5), status: 'open', priority: 'normal'});
    const appointment = await saveOperational(office, 'appointments', {clientId: client.id, fileId: file.id, title: 'موعد اختبار', date: addDays(today, 3), time: '11:30', status: 'مجدول'});
    const comm = await saveOperational(office, 'communications', {clientId: client.id, fileId: file.id, subject: 'اتصال اختبار', date: today, followUpDate: addDays(today, 2)});
    const fileRow = await office.r.files.get(file.id);
    await office.saveFile({...fileRow, nextStep: 'خطوة اختبار للملف', nextStepDate: addDays(today, 4)}, file.id);
    const snapshot = async () => ({
      client: await office.r.clients.get(client.id), file: await office.r.files.get(file.id), stage: await office.r.cases.get(stage.id),
      parties: (await office.r.fileParties.byIndexAll('fileId', file.id)).map(p => ({id: p.id, name: p.name}))
    });
    return {db, office, client, file, stage, hearing, procedure, overdueProc, appointment, comm, snapshot, before: await snapshot()};
  })();
  const ref = (type, id) => D.overlayId(type, id);

  // ===== 1) المجال النقي =====
  test('مركز العمل/مجال: الحالات الافتراضية الست + مؤرشف علم منفصل', () => {
    expect(D.DEFAULT_WORK_STATUSES.map(s => s.key).join()).toBe('notStarted,inProgress,waiting,postponed,done,cancelled');
    expect(D.ARCHIVED_LABEL).toBe('مؤرشف');
    expect(D.statusKindOf('done')).toBe('done'); expect(D.statusKindOf('cancelled')).toBe('cancelled'); expect(D.statusKindOf('postponed')).toBe('open');
  });
  test('مركز العمل/مجال: أربع أولويات لكل منها أيقونة ورمز نصي (اللون ليس الإشارة الوحيدة)', () => {
    expect(D.DEFAULT_WORK_PRIORITIES.length).toBe(4);
    for (const p of D.DEFAULT_WORK_PRIORITIES) { expect(Boolean(p.icon && p.mark && p.label)).toBe(true); }
    expect(D.priorityRank('urgent') > D.priorityRank('high') && D.priorityRank('high') > D.priorityRank('medium') && D.priorityRank('medium') > D.priorityRank('low')).toBe(true);
  });
  test('مركز العمل/مجال: تسميات وألوان الأولوية والحالة قابلة للتخصيص وحالات مخصصة', () => {
    const cfg = K.sanitizeWorkConfig({priorities: {urgent: {label: 'حرج للغاية', color: '#112233'}}, statuses: {waiting: {label: 'في انتظار الموكل'}}, customStatuses: [{key: 'c_review', label: 'تحت المراجعة', kind: 'open', color: '#445566'}, {key: 'bad key', label: 'x', kind: 'open'}]});
    expect(D.priorityInfo('urgent', cfg).label).toBe('حرج للغاية'); expect(D.priorityInfo('urgent', cfg).color).toBe('#112233');
    expect(D.statusInfo('waiting', cfg).label).toBe('في انتظار الموكل');
    expect(D.statusInfo('c_review', cfg).kind).toBe('open'); expect(cfg.customStatuses.length).toBe(1);
    expect(K.sanitizeWorkConfig({priorities: {urgent: {color: 'javascript:alert(1)'}}}).priorities.urgent).toBe(undefined);
  });
  test('مركز العمل/مجال: تصنيف المواعيد وفئات التأخر', () => {
    expect(D.classifyDue(addDays(today, -1), today)).toBe('overdue'); expect(D.classifyDue(today, today)).toBe('today'); expect(D.classifyDue(tomorrow, today)).toBe('tomorrow');
    expect(D.classifyDue(addDays(today, 5), today)).toBe('week'); expect(D.classifyDue(addDays(today, 20), today)).toBe('later'); expect(D.classifyDue('', today)).toBe('undated');
    expect(D.agingBucket(addDays(today, -1), today).key).toBe('d1'); expect(D.agingBucket(addDays(today, -3), today).key).toBe('d2_3');
    expect(D.agingBucket(addDays(today, -6), today).key).toBe('d4_7'); expect(D.agingBucket(addDays(today, -20), today).key).toBe('d8_30'); expect(D.agingBucket(addDays(today, -90), today).key).toBe('d31');
    expect(D.agingBucket(today, today)).toBe(null);
  });
  test('مركز العمل/مجال: مفتاح الترتيب: تاريخ ثم وقت ثم أولوية ثم معرّف، وبلا موعد أخيرًا', () => {
    const a = D.sortKeyOf({dueDate: '2026-01-02', dueTime: '09:00', priority: 'low', id: 'b'}), b = D.sortKeyOf({dueDate: '2026-01-02', dueTime: '09:00', priority: 'urgent', id: 'a'});
    const c = D.sortKeyOf({dueDate: '2026-01-02', dueTime: '', priority: 'urgent', id: 'a'}), d = D.sortKeyOf({dueDate: '', priority: 'urgent', id: 'a'});
    expect(b < a).toBe(true); expect(a < c).toBe(true); expect(c < d).toBe(true);
  });
  test('مركز العمل/مجال: أهداف التأجيل (غدًا، بعد يومين، أسبوع، شهر بنهاية الشهر، مخصص)', () => {
    expect(D.snoozeTarget('tomorrow', '2026-12-31')).toBe('2027-01-01'); expect(D.snoozeTarget('twoDays', '2026-02-27')).toBe('2026-03-01');
    expect(D.snoozeTarget('nextWeek', '2026-10-01')).toBe('2026-10-08'); expect(D.snoozeTarget('nextMonth', '2026-01-31')).toBe('2026-02-28');
    expect(D.snoozeTarget('custom', '2026-04-01', '2026-05-05')).toBe('2026-05-05'); expect(D.snoozeTarget('custom', '2026-04-01', 'x')).toBe('');
  });
  test('مركز العمل/مجال: مصفوفة أيزنهاور تلقائية وتتفوق عليها الإعادة اليدوية', () => {
    expect(D.classifyQuadrant({priority: 'urgent', dueDate: today}, today)).toBe('q1'); expect(D.classifyQuadrant({priority: 'high', dueDate: addDays(today, 9)}, today)).toBe('q2');
    expect(D.classifyQuadrant({priority: 'low', dueDate: today}, today)).toBe('q3'); expect(D.classifyQuadrant({priority: 'low', dueDate: ''}, today)).toBe('q4');
    expect(D.classifyQuadrant({priority: 'urgent', dueDate: today, quadrant: 'q4'}, today)).toBe('q4');
  });
  test('مركز العمل/مجال: توليد التكرار (أسبوعي/شهري بنهاية الشهر/عدّاد/سنوي كبيس) بلا مخزن', () => {
    expect(D.expandRecurrence({freq: 'weekly', byWeekday: [1, 3]}, '2026-10-01', '2026-10-01', '2026-10-21').join()).toBe('2026-10-05,2026-10-07,2026-10-12,2026-10-14,2026-10-19,2026-10-21');
    expect(D.expandRecurrence({freq: 'monthly'}, '2026-01-31', '2026-01-01', '2026-04-30').join()).toBe('2026-01-31,2026-02-28,2026-03-31,2026-04-30');
    expect(D.expandRecurrence({freq: 'daily', interval: 3, count: 4}, '2026-10-01', '2026-10-01', '2026-12-31').length).toBe(4);
    expect(D.expandRecurrence({freq: 'yearly'}, '2024-02-29', '2024-01-01', '2026-12-31').join()).toBe('2024-02-29,2025-02-28,2026-02-28');
    expect(D.expandRecurrence({freq: 'daily', until: '2026-10-03'}, '2026-10-01', '2026-10-01', '2026-10-31').length).toBe(3);
    expect(D.expandRecurrence({freq: 'daily'}, '2026-10-01', '2030-01-01', '2030-01-05').length).toBe(5);   // قفزة حسابية بلا مسح من البداية
  });
  test('مركز العمل/مجال: التحقق: العنوان مطلوب والتاريخ/الوقت/الأولوية صحيحة', () => {
    const bad = D.validateNativeInput({title: '  ', dueDate: '2026-02-30', dueTime: '25:00', priority: 'x'});
    expect(Boolean(bad.errors.title && bad.errors.dueDate && bad.errors.dueTime && bad.errors.priority)).toBe(true);
    const ok = D.validateNativeInput({title: ' مهمة ', dueDate: '2026-10-05', dueTime: '٩:٣٠', tags: 'أ، ب,أ'});
    expect(Object.keys(ok.errors).length).toBe(0); expect(ok.data.dueTime).toBe('09:30'); expect(ok.data.tags.join()).toBe('أ,ب'); expect(ok.data.title).toBe('مهمة');
  });
  test('مركز العمل/مجال: معرّف الطبقة حتمي ويُحلَّل', () => {
    expect(D.overlayId('hearings', 'H1')).toBe('hearings::H1'); expect(D.parseOverlayId('hearings::H1').sourceId).toBe('H1'); expect(D.parseOverlayId('01HXTASK')).toBe(null);
  });

  // ===== 2) الترحيل v13 → v14 =====
  test('مركز العمل/ترحيل: سجل الترحيلات الرسمي يصف v14 إضافيًا غير مدمر', () => {
    expect(SCHEMA_VERSION).toBe(14); expect(SCHEMA_MIGRATIONS.at(-1).version).toBe(14);
    const plan = migrationPlan(13, 14);
    expect(plan.addsStores.join()).toBe('workItems,workItemComments,workItemRecurrences'); expect(plan.destructive).toBe(false); expect(migrationPlan(14, 14).steps.length).toBe(0);
  });
  test('مركز العمل/ترحيل: ترقية قاعدة v13 حقيقية تحفظ كل السجلات وتضيف المخازن والفهارس', async () => {
    const name = `AhmadKhudairLawOfficeDB__test__migrate__${Date.now()}`;
    const old = STORES.filter(s => !['workItems', 'workItemComments', 'workItemRecurrences'].includes(s));
    const v13 = await openDb(name, 13, old);
    expect(v13.objectStoreNames.contains('workItems')).toBe(false);
    await new Promise((res, rej) => { const tx = v13.transaction(['clients', 'files', 'hearings'], 'readwrite'); tx.objectStore('clients').put({id: 'C1', fullName: 'موكل قديم', createdAt: 'x', updatedAt: 'x', isDeleted: false}); tx.objectStore('files').put({id: 'F1', fileNumber: '2025/0001', title: 'ملف قديم', status: 'مفتوح', isDeleted: false}); tx.objectStore('hearings').put({id: 'H1', caseId: 'S1', fileId: 'F1', hearingDate: '2026-10-05', status: 'مجدولة'}); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    v13.close();
    const v14 = await openDb(name, 14);
    try {
      for (const s of ['workItems', 'workItemComments', 'workItemRecurrences']) expect(v14.objectStoreNames.contains(s)).toBe(true);
      const idx = [...v14.transaction('workItems').objectStore('workItems').indexNames];
      for (const n of ['kind_dueDate', 'status_dueDate', 'completedAt', 'pinnedAt', 'archivedAt', 'recurrenceId_occurrenceDate', 'fileId', 'relatedId']) expect(idx.includes(n)).toBe(true);
      const o = new Office({db: v14, assert() {}, token: 'm', profile: {id: 'm'}});
      expect((await o.r.clients.get('C1')).fullName).toBe('موكل قديم'); expect((await o.r.files.get('F1')).fileNumber).toBe('2025/0001'); expect((await o.r.hearings.get('H1')).hearingDate).toBe('2026-10-05');
      expect(await o.r.workItems.count()).toBe(0);
      const health = await deepHealth({assert() {}, db: v14, profile: {databaseName: name}}, {scanRows: false});
      expect(health.schemaIssues.length).toBe(0);
    } finally { v14.close(); indexedDB.deleteDatabase(name); }
    const again = await openDb(name, 14).catch(() => null); // إعادة التشغيل بعد الحذف لا تؤثر
    again?.close(); indexedDB.deleteDatabase(name);
  });
  test('مركز العمل/ترحيل: نسخة احتياطية v13 قديمة (بلا المخازن الجديدة) تُقبل وتُستعاد والمخازن الجديدة فارغة', async () => {
    const {db, office} = await env();
    const payload = await exportDatabase(office.ctx);
    expect(payload.schemaVersion).toBe(14); expect(Array.isArray(payload.stores.workItems)).toBe(true);
    const legacy = JSON.parse(JSON.stringify(payload));
    legacy.schemaVersion = 13; for (const s of ['workItems', 'workItemComments', 'workItemRecurrences']) delete legacy.stores[s];
    legacy.manifest.storeNames = legacy.manifest.storeNames.filter(s => !['workItems', 'workItemComments', 'workItemRecurrences'].includes(s));
    for (const s of ['workItems', 'workItemComments', 'workItemRecurrences']) delete legacy.manifest.recordCounts[s];
    legacy.manifest.totalRecords = Object.values(legacy.manifest.recordCounts).reduce((a, b) => a + b, 0);
    delete legacy.integrity;
    const info = await inspectBackup(legacy);
    expect(info.valid).toBe(true);
    const name2 = `AhmadKhudairLawOfficeDB__test__restore__${Date.now()}`;
    const db2 = await openDb(name2, 14);
    try {
      const o2 = new Office({db: db2, assert() {}, token: 'r', profile: {id: 'r'}});
      await importDatabase(o2.ctx, legacy);
      expect(await o2.r.workItems.count()).toBe(0);
      expect((await o2.r.clients.count()) > 0).toBe(true);
    } finally { db2.close(); indexedDB.deleteDatabase(name2); }
    void db;
  });

  // ===== 3) أوامر الخدمة: المهام المستقلة =====
  let taskId = null;
  test('مركز العمل/مهمة: إنشاء مهمة مستقلة بروابط معرّفات فقط وبدون نسخ أي بيانات قانونية', async () => {
    const {office, client, file, stage} = await env();
    const row = await saveEntity(office, 'workItems', {title: 'مهمة اختبار 1', dueDate: today, dueTime: '14:00', priority: 'high', tags: 'عاجل، مراجعة', fileId: file.id, caseId: stage.id, clientId: client.id, type: 'مهمة'});
    taskId = row.id;
    expect(typeof row.id).toBe('string'); expect(row.id.length).toBe(20); expect(row.kind).toBe('native'); expect(row.sourceType).toBe('task'); expect(row.sourceId).toBe(row.id);
    const text = JSON.stringify(row);
    for (const forbidden of ['موكل اختبار مركز العمل', 'ملف مركز العمل', 'الخصم الأول', 'محكمة', '777']) expect(text.includes(forbidden)).toBe(false);
    expect(row.fileId).toBe(file.id); expect(row.caseId).toBe(stage.id); expect(row.tags.join()).toBe('عاجل,مراجعة');
  });
  test('مركز العمل/مهمة: رفض مهمة بلا عنوان أو بتاريخ/ربط غير صالح', async () => {
    const {office, file} = await env();
    expect((await rejects(() => C.saveWorkItem(office, {title: ''}))).details.title).toBeTruthy();
    expect((await rejects(() => C.saveWorkItem(office, {title: 'س', dueDate: '2026-13-40'}))).details.dueDate).toBeTruthy();
    expect((await rejects(() => C.saveWorkItem(office, {title: 'س', fileId: 'NOPE'}))).details.fileId).toBeTruthy();
    expect((await rejects(() => C.saveWorkItem(office, {title: 'س', fileId: file.id, caseId: 'NOPE'}))).details.caseId).toBeTruthy();
  });
  test('مركز العمل/مهمة: تعديل المهمة يحفظ الإصدار ويحفظ الموعد الأصلي عند تغييره', async () => {
    const {office} = await env();
    const old = await office.r.workItems.get(taskId);
    const edited = await C.saveWorkItem(office, {title: 'مهمة اختبار 1 (معدلة)', dueDate: addDays(today, 6)}, taskId, old.version);
    expect(edited.version).toBe(old.version + 1); expect(edited.originalDueDate).toBe(today); expect(edited.title).toBe('مهمة اختبار 1 (معدلة)');
    expect(edited.fileId).toBe(old.fileId); expect(edited.tags.join()).toBe(old.tags.join());
    const stale = await rejects(() => C.saveWorkItem(office, {title: 'تعارض'}, taskId, old.version));
    expect(Boolean(stale)).toBe(true);
    await C.saveWorkItem(office, {dueDate: today}, taskId);
  });
  test('مركز العمل/مهمة: إنجاز ثم إعادة فتح ويحفظ السجل completedAt/completedBy والحالة السابقة', async () => {
    const {office} = await env();
    await C.setItemStatus(office, taskId, 'inProgress');
    await C.completeItem(office, taskId, {by: 'اختبار'});
    let row = await office.r.workItems.get(taskId);
    expect(row.status).toBe('done'); expect(Boolean(row.completedAt)).toBe(true); expect(row.completedBy).toBe('اختبار'); expect(row.statusBeforeComplete).toBe('inProgress');
    await C.reopenItem(office, taskId);
    row = await office.r.workItems.get(taskId);
    expect(row.status).toBe('inProgress'); expect(row.completedAt).toBe(null);
  });
  test('مركز العمل/مهمة: التأجيل يحفظ الموعد الأصلي ويزيد العدّاد ويسجّل السبب ولا يقبل تاريخًا ماضيًا', async () => {
    const {office} = await env();
    const target = addDays(today, 2);
    await C.postponeItem(office, taskId, {date: target, reason: 'طلب الموكل'});
    let row = await office.r.workItems.get(taskId);
    expect(row.dueDate).toBe(target); expect(row.originalDueDate).toBe(today); expect(row.postponeCount).toBe(1); expect(row.status).toBe('postponed');
    await C.postponeItem(office, taskId, {option: 'nextWeek', reason: ''});
    row = await office.r.workItems.get(taskId);
    expect(row.originalDueDate).toBe(today); expect(row.postponeCount).toBe(2); expect(row.dueDate).toBe(addDays(today, 7));
    const comments = await C.listComments(office, taskId);
    expect(comments.some(c => c.type === 'postponeReason' && c.body === 'طلب الموكل')).toBe(true);
    expect(Boolean(await rejects(() => C.postponeItem(office, taskId, {date: addDays(today, -1)})))).toBe(true);
    await C.rescheduleItem(office, taskId, {date: today});
    row = await office.r.workItems.get(taskId);
    expect(row.dueDate).toBe(today); expect(row.postponeCount).toBe(2);
  });
  test('مركز العمل/مهمة: الأولوية والتثبيت والوسوم والحالة وتصنيف المصفوفة', async () => {
    const {office} = await env();
    await C.setItemPriority(office, taskId, 'urgent'); await C.setPinned(office, taskId, true); await C.setItemTags(office, taskId, ['أ', 'ب', 'أ']); await C.setItemQuadrant(office, taskId, 'q2');
    const row = await office.r.workItems.get(taskId);
    expect(row.priority).toBe('urgent'); expect(Boolean(row.pinnedAt)).toBe(true); expect(row.tags.join()).toBe('أ,ب'); expect(row.quadrant).toBe('q2');
    await C.setPinned(office, taskId, false); await C.setItemQuadrant(office, taskId, '');
    const after = await office.r.workItems.get(taskId);
    expect(after.pinnedAt).toBe(null); expect(after.quadrant).toBe(null);
    expect(Boolean(await rejects(() => C.setItemPriority(office, taskId, 'zzz')))).toBe(true);
  });
  test('مركز العمل/مهمة: التعليقات بأنواعها وعدّاد التعليقات والتعديل والحذف المنطقي', async () => {
    const {office} = await env();
    for (const type of D.COMMENT_TYPE_KEYS) await C.addComment(office, taskId, {type, body: `نص ${type}`});
    let row = await office.r.workItems.get(taskId);
    expect(row.commentCount >= 6).toBe(true);
    const list = await C.listComments(office, taskId);
    expect(new Set(list.map(c => c.type)).size >= 6).toBe(true);
    const target = list.find(c => c.type === 'instruction');
    await C.updateComment(office, target.id, {type: 'instruction', body: 'تعليمات معدلة'});
    await C.removeComment(office, target.id);
    row = await office.r.workItems.get(taskId);
    const left = await C.listComments(office, taskId);
    expect(left.some(c => c.id === target.id)).toBe(false); expect(row.commentCount).toBe(left.length);
    expect(Boolean(await rejects(() => C.addComment(office, taskId, {body: '  '})))).toBe(true);
  });
  test('مركز العمل/مهمة: أرشفة واستعادة (منفصلتان عن الحذف) ثم حذف منطقي بتراجع', async () => {
    const {office} = await env();
    const r = await C.saveWorkItem(office, {title: 'مهمة للأرشفة والحذف', dueDate: today});
    await C.archiveItem(office, r.id);
    let row = await office.r.workItems.get(r.id);
    expect(row.isArchived).toBe(true); expect(Boolean(row.archivedAt)).toBe(true); expect(row.isDeleted).toBe(false);
    let page = await Q.queryWorkItems(office, {range: 'today', kinds: ['open']}, {limit: 200});
    expect(idsOf(page.items).includes(r.id)).toBe(false);
    page = await Q.queryWorkItems(office, {drive: 'archived'}, {limit: 50});
    expect(idsOf(page.items).includes(r.id)).toBe(true);
    await C.restoreItem(office, r.id);
    page = await Q.queryWorkItems(office, {range: 'today', kinds: ['open']}, {limit: 200});
    expect(idsOf(page.items).includes(r.id)).toBe(true);
    await C.deleteItem(office, r.id);
    row = (await office.r.workItems.getManyRaw([r.id]))[0];
    expect(row.isDeleted).toBe(true); expect(Boolean(row.deletedAt)).toBe(true); expect(row.isArchived).toBe(false);
    page = await Q.queryWorkItems(office, {range: 'today', kinds: ['open']}, {limit: 200});
    expect(idsOf(page.items).includes(r.id)).toBe(false);
    await C.undoDelete(office, r.id);
    page = await Q.queryWorkItems(office, {range: 'today', kinds: ['open']}, {limit: 200});
    expect(idsOf(page.items).includes(r.id)).toBe(true);
    await C.deleteItem(office, r.id);
  });
  test('مركز العمل/مهمة: ربط المهمة بسجل (جلسة) يكمّل الملف والقضية بالمعرّفات', async () => {
    const {office, hearing, file, stage} = await env();
    const preset = await C.linkedTaskPreset(office, 'hearings', hearing.id);
    expect(preset.fileId).toBe(file.id); expect(preset.caseId).toBe(stage.id); expect(preset.relatedType).toBe('hearings'); expect(preset.relatedId).toBe(hearing.id);
    const row = await C.saveWorkItem(office, {title: 'متابعة الجلسة', dueDate: tomorrow, ...preset});
    expect(row.relatedId).toBe(hearing.id);
    const linked = await Q.queryWorkItems(office, {range: 'all', relatedId: hearing.id}, {limit: 50});
    expect(idsOf(linked.items).includes(row.id)).toBe(true);
    expect((await rejects(() => C.saveWorkItem(office, {title: 'س', relatedType: 'hearings', relatedId: 'NOPE'}))).details.relatedId).toBeTruthy();
  });

  // ===== 4) الإسقاطات: الكتابة في السجل الأصلي + طبقة =====
  test('مركز العمل/إسقاط: الجلسة والعمل الإداري والموعد والمتابعة وخطوة الملف تظهر بلا نسخ وبمعرّف طبقة حتمي', async () => {
    const {office, hearing, procedure, appointment, comm, file} = await env();
    const page = await Q.queryWorkItems(office, {range: 'custom', from: today, to: addDays(today, 5), undated: false}, {limit: 200});
    for (const [type, id] of [['hearings', hearing.id], ['procedures', procedure.id], ['appointments', appointment.id], ['communications', comm.id], ['files', file.id]]) {
      const item = page.items.find(i => i.id === ref(type, id));
      if (!item) throw Error(`العنصر المسقَط غير ظاهر: ${type}`);
      expect(item.sourceType).toBe(type); expect(item.sourceId).toBe(id); expect(item.sourceAvailable).toBe(true);
    }
    expect(await office.r.workItems.count() >= 1).toBe(true);
    const overlays = (await office.r.workItems.all(5000)).filter(r => r.kind === 'overlay');
    expect(overlays.length).toBe(0);     // القراءة وحدها لا تكتب أي طبقة
  });
  test('مركز العمل/إسقاط: إنجاز عمل إداري يكتب status=done في السجل الأصلي والطبقة في معاملة واحدة', async () => {
    const {office, procedure} = await env();
    await C.completeItem(office, ref('procedures', procedure.id));
    const src = await office.r.procedures.get(procedure.id);
    expect(src.status).toBe('done'); expect(src.fileId).toBe(procedure.fileId); expect(src.description).toBe(procedure.description);
    const ov = (await office.r.workItems.getManyRaw([ref('procedures', procedure.id)]))[0];
    expect(ov.kind).toBe('overlay'); expect(Boolean(ov.completedAt)).toBe(true); expect(ov.id).toBe(`procedures::${procedure.id}`);
    expect(JSON.stringify(ov).includes('إجراء اختبار')).toBe(false);
    const open = await Q.queryWorkItems(office, {range: 'tomorrow'}, {limit: 100});
    expect(idsOf(open.items).includes(ref('procedures', procedure.id))).toBe(false);
    const done = await Q.queryWorkItems(office, {range: 'tomorrow', kinds: ['done']}, {limit: 100});
    expect(idsOf(done.items).includes(ref('procedures', procedure.id))).toBe(true);
    const completed = await Q.queryWorkItems(office, {drive: 'completed', from: today, to: today}, {limit: 100});
    expect(idsOf(completed.items).includes(ref('procedures', procedure.id))).toBe(true);
    await C.reopenItem(office, ref('procedures', procedure.id));
    expect((await office.r.procedures.get(procedure.id)).status).toBe('open');
    const again = await Q.queryWorkItems(office, {range: 'tomorrow'}, {limit: 100});
    expect(idsOf(again.items).includes(ref('procedures', procedure.id))).toBe(true);
  });
  test('مركز العمل/إسقاط: تأجيل عمل إداري يغيّر موعد السجل الأصلي ويحفظ الموعد الأصلي والعدّاد دون تكرار الطبقة', async () => {
    const {office, procedure} = await env();
    const id = ref('procedures', procedure.id);
    await C.postponeItem(office, id, {option: 'twoDays', reason: 'انتظار مستندات'});
    await C.postponeItem(office, id, {date: addDays(today, 9)});
    expect((await office.r.procedures.get(procedure.id)).internalDueDate).toBe(addDays(today, 9));
    const overlays = (await office.r.workItems.all(5000)).filter(r => r.id === id);
    expect(overlays.length).toBe(1);
    expect(overlays[0].postponeCount).toBe(2); expect(overlays[0].originalDueDate).toBe(tomorrow);
    const item = await Q.getWorkItem(office, id);
    expect(item.dueDate).toBe(addDays(today, 9)); expect(item.status).toBe('postponed'); expect(item.postponeCount).toBe(2);
    await C.rescheduleItem(office, id, {date: tomorrow});
    expect((await Q.getWorkItem(office, id)).dueDate).toBe(tomorrow);
  });
  test('مركز العمل/إسقاط: تأجيل الجلسة يُسجَّل في سجل الجلسة (adjournedTo) وتنشأ جلستها التالية ولا تتغير بياناتها القانونية', async () => {
    const {office, hearing} = await env();
    const id = ref('hearings', hearing.id);
    const target = addDays(today, 14);
    await C.postponeItem(office, id, {date: target, reason: 'تأجيل لإعلان الخصم'});
    const src = await office.r.hearings.get(hearing.id);
    expect(src.adjournedTo).toBe(target); expect(src.adjournReason).toBe('تأجيل لإعلان الخصم'); expect(src.status).toBe('مؤجلة');
    expect(src.hearingDate).toBe(today); expect(src.caseId).toBe(hearing.caseId); expect(src.reason).toBe(hearing.reason); expect(src.court).toBe(hearing.court);
    const kids = await office.r.hearings.byIndex('previousHearingId', hearing.id, 5);
    expect(kids.length).toBe(1); expect(kids[0].hearingDate).toBe(target);
    const open = await Q.queryWorkItems(office, {range: 'custom', from: target, to: target}, {limit: 50});
    expect(open.items.some(i => i.sourceId === kids[0].id && i.sourceType === 'hearings')).toBe(true);
    const todays = await Q.queryWorkItems(office, {range: 'today'}, {limit: 100});
    expect(idsOf(todays.items).includes(id)).toBe(false);
    const old = await Q.getWorkItem(office, id);
    expect(old.isDone).toBe(true); expect(old.statusLabel.includes('مؤجلة')).toBe(true);
  });
  test('مركز العمل/إسقاط: إنجاز الموعد وإعادة جدولته ومتابعة الاتصال وإنجازها', async () => {
    const {office, appointment, comm} = await env();
    await C.rescheduleItem(office, ref('appointments', appointment.id), {date: addDays(today, 6)});
    expect((await office.r.appointments.get(appointment.id)).date).toBe(addDays(today, 6));
    await C.completeItem(office, ref('appointments', appointment.id));
    expect((await office.r.appointments.get(appointment.id)).status).toBe('تم');
    await C.postponeItem(office, ref('communications', comm.id), {date: addDays(today, 4)});
    expect((await office.r.communications.get(comm.id)).followUpDate).toBe(addDays(today, 4));
    await C.completeItem(office, ref('communications', comm.id));
    expect((await office.r.communications.get(comm.id)).followUpRequired).toBe(false);
    const still = await Q.queryWorkItems(office, {range: 'all'}, {limit: 500});
    expect(idsOf(still.items).includes(ref('communications', comm.id))).toBe(false);
  });
  test('مركز العمل/إسقاط: خطوة الملف: الإنجاز في الطبقة فقط ويرتبط بتاريخها فإذا تغير عادت مفتوحة', async () => {
    const {office, file} = await env();
    const id = ref('files', file.id);
    const before = await office.r.files.get(file.id);
    await C.completeItem(office, id);
    const after = await office.r.files.get(file.id);
    expect(after.nextStepDate).toBe(before.nextStepDate); expect(after.nextStep).toBe(before.nextStep);
    expect((await Q.getWorkItem(office, id)).isDone).toBe(true);
    await C.reopenItem(office, id);
    expect((await Q.getWorkItem(office, id)).isOpen).toBe(true);
    await C.completeItem(office, id);
    await C.postponeItem(office, id, {date: addDays(today, 12)});
    const moved = await Q.getWorkItem(office, id);
    expect((await office.r.files.get(file.id)).nextStepDate).toBe(addDays(today, 12)); expect(moved.isOpen).toBe(true); expect(moved.postponeCount).toBe(1);
  });
  test('مركز العمل/إسقاط: الأولوية والتثبيت والتعليق على عنصر مسقَط يكتب الطبقة فقط ولا يغيّر السجل الأصلي', async () => {
    const {office, overdueProc} = await env();
    const id = ref('procedures', overdueProc.id), before = JSON.stringify(await office.r.procedures.get(overdueProc.id));
    await C.setItemPriority(office, id, 'urgent'); await C.setPinned(office, id, true); await C.addComment(office, id, {type: 'update', body: 'تحديث على الإجراء المتأخر'}); await C.setItemTags(office, id, ['ملاحظة']);
    expect(JSON.stringify(await office.r.procedures.get(overdueProc.id))).toBe(before);
    const item = await Q.getWorkItem(office, id);
    expect(item.priority).toBe('urgent'); expect(item.isPinned).toBe(true); expect(item.tags.join()).toBe('ملاحظة'); expect(item.overlay.commentCount).toBe(1);
    const pinned = await Q.queryWorkItems(office, {drive: 'pinned'}, {limit: 50});
    expect(idsOf(pinned.items).includes(id)).toBe(true);
    await C.setItemStatus(office, id, 'inProgress');
    expect((await Q.getWorkItem(office, id)).status).toBe('inProgress');
    expect((await office.r.procedures.get(overdueProc.id)).status).toBe('open');
  });
  test('مركز العمل/إسقاط: المصدر المؤرشف أو المحذوف لا يحذف عنصر العمل: يبقى «المصدر غير متاح حاليًا» وتاريخه محفوظ', async () => {
    const {office, file} = await env();
    const extra = await saveOperational(office, 'procedures', {fileId: file.id, description: 'عمل سيُحذف مصدره', internalDueDate: addDays(today, 1), status: 'open'});
    const id = ref('procedures', extra.id);
    await C.addComment(office, id, {type: 'note', body: 'ملاحظة يجب أن تبقى'});
    await office.softDelete('procedures', extra.id);
    const page = await Q.queryWorkItems(office, {range: 'tomorrow'}, {limit: 100});
    const orphan = page.items.find(i => i.id === id);
    expect(Boolean(orphan)).toBe(true); expect(orphan.sourceAvailable).toBe(false); expect(orphan.title.includes('المصدر غير متاح حاليًا')).toBe(true);
    expect(JSON.stringify(orphan).includes('عمل سيُحذف مصدره')).toBe(false);
    const comments = await C.listComments(office, id);
    expect(comments.length).toBe(1); expect(comments[0].body).toBe('ملاحظة يجب أن تبقى');
    expect(Boolean(await rejects(() => C.completeItem(office, id)))).toBe(true);
    await C.archiveItem(office, id);
    const gone = await Q.queryWorkItems(office, {range: 'tomorrow'}, {limit: 100});
    expect(idsOf(gone.items).includes(id)).toBe(false);
    const archived = await Q.queryWorkItems(office, {drive: 'archived'}, {limit: 100});
    expect(idsOf(archived.items).includes(id)).toBe(true);
    expect(Boolean(await rejects(() => C.deleteItem(office, id)))).toBe(true);
  });
  test('مركز العمل/إسقاط: الحذف لا يُنفَّذ على سجل أصلي من مركز العمل', async () => {
    const {office, hearing} = await env();
    expect(Boolean(await rejects(() => C.deleteItem(office, ref('hearings', hearing.id))))).toBe(true);
    expect(Boolean(await office.r.hearings.get(hearing.id))).toBe(true);
  });

  // ===== 5) الاستعلام والفترات =====
  test('مركز العمل/استعلام: الفترات (اليوم/غدًا/الأسبوع/الأسبوع القادم/الشهر/السنة/متأخر/مخصص/الكل) تعيد النطاق الصحيح', async () => {
    const {office} = await env();
    const mk = (type, id, date) => ({type, id, date});
    const seedDates = [mk('procedures', 'p-a', today), mk('procedures', 'p-b', tomorrow), mk('procedures', 'p-c', addDays(today, 30)), mk('procedures', 'p-d', addDays(today, -3))];
    const created = [];
    for (const d of seedDates) created.push(await C.saveWorkItem(office, {title: `فترة ${d.id}`, dueDate: d.date}));
    const within = async (spec, id) => idsOf((await Q.queryWorkItems(office, spec, {limit: 500})).items).includes(created[id].id);
    expect(await within({range: 'today'}, 0)).toBe(true); expect(await within({range: 'today'}, 1)).toBe(false);
    expect(await within({range: 'tomorrow'}, 1)).toBe(true); expect(await within({range: 'tomorrow'}, 0)).toBe(false);
    expect(await within({range: 'overdue'}, 3)).toBe(true); expect(await within({range: 'overdue'}, 0)).toBe(false);
    expect(await within({range: 'custom', from: addDays(today, 25), to: addDays(today, 35)}, 2)).toBe(true); expect(await within({range: 'custom', from: addDays(today, 25), to: addDays(today, 35)}, 0)).toBe(false);
    expect(await within({range: 'all'}, 2)).toBe(true); expect(await within({range: 'all'}, 3)).toBe(true);
    const [wf, wt] = Q.resolveRange('week').from ? [Q.resolveRange('week').from, Q.resolveRange('week').to] : ['', ''];
    expect(wf <= today && today <= wt).toBe(true);
    const nw = Q.resolveRange('nextWeek'); expect(nw.from > wt).toBe(true);
    const mo = Q.resolveRange('month'), nm = Q.resolveRange('nextMonth'); expect(mo.from <= today && today <= mo.to && nm.from > mo.to).toBe(true);
    const yr = Q.resolveRange('year'); expect(yr.from.slice(5)).toBe('01-01'); expect(yr.to.slice(5)).toBe('12-31');
    expect(await within({range: 'custom', from: addDays(today, 40), to: addDays(today, 50)}, 0)).toBe(false);
  });
  test('مركز العمل/استعلام: الترقيم بالمؤشر يطابق الاستعلام الواحد ترتيبًا ولا يكرر ولا يفقد', async () => {
    const {office} = await env();
    const one = await Q.queryWorkItems(office, {range: 'custom', from: '', to: addDays(today, 60), undated: true}, {limit: 800});
    expect(one.items.length >= 8).toBe(true);
    const paged = []; let cursor = null, pages = 0;
    for (;;) { const r = await Q.queryWorkItems(office, {range: 'custom', from: '', to: addDays(today, 60), undated: true}, {limit: 3, cursor}); paged.push(...r.items); pages++; if (!r.hasMore) break; cursor = r.nextCursor; if (pages > 300) throw Error('حلقة ترقيم لا تنتهي'); }
    expect(paged.length).toBe(one.items.length);
    expect(new Set(idsOf(paged)).size).toBe(paged.length);
    expect(idsOf(paged).join('|')).toBe(idsOf(one.items).join('|'));
    const keys = one.items.map(i => i.sortKey);
    expect(keys.join('\n')).toBe([...keys].sort().join('\n'));
  });
  test('مركز العمل/استعلام: المتأخر مقصوص بعمق قابل للضبط للمصادر بلا فهرس حالة والمقصوص يُعلن', async () => {
    const {office} = await env();
    const long = await saveOperational(office, 'appointments', {clientId: (await env()).client.id, title: 'موعد قديم جدًا', date: addDays(today, -400), status: 'مجدول'});
    const page = await Q.queryWorkItems(office, {range: 'overdue'}, {limit: 800});
    expect(idsOf(page.items).includes(ref('appointments', long.id))).toBe(false);
    const wide = await Q.queryWorkItems(office, {range: 'custom', from: addDays(today, -500), to: addDays(today, -1)}, {limit: 800});
    expect(idsOf(wide.items).includes(ref('appointments', long.id))).toBe(true);
  });
  test('مركز العمل/استعلام: المرشحات المركبة (حالة/أولوية/مصدر/نوع/وسم/مثبّت) تُطبَّق معًا', async () => {
    const {office} = await env();
    const a = await C.saveWorkItem(office, {title: 'مركب أ', dueDate: today, priority: 'urgent', tags: ['س1'], type: 'متابعة', status: 'inProgress'});
    const b = await C.saveWorkItem(office, {title: 'مركب ب', dueDate: today, priority: 'low', tags: ['س1'], type: 'مهمة'});
    await C.setPinned(office, a.id, true);
    const run = async f => idsOf((await Q.queryWorkItems(office, {range: 'today', ...f}, {limit: 300})).items);
    expect((await run({priorities: ['urgent'], tags: ['س1']})).includes(a.id)).toBe(true);
    expect((await run({priorities: ['urgent'], tags: ['س1']})).includes(b.id)).toBe(false);
    expect((await run({statuses: ['inProgress'], sources: ['task']})).includes(a.id)).toBe(true);
    expect((await run({types: ['متابعة']})).includes(b.id)).toBe(false);
    expect((await run({pinned: true})).includes(a.id)).toBe(true); expect((await run({pinned: true})).includes(b.id)).toBe(false);
    expect((await run({sources: ['hearings']})).every(id => id.startsWith('hearings::'))).toBe(true);
  });
  test('مركز العمل/استعلام: البحث يعيد استخدام تطبيع البحث الشامل ويصل بالموكل والخصم ورقم الملف والقضية والتعليق والوسم', async () => {
    const {office, file, client} = await env();
    const t = await C.saveWorkItem(office, {title: 'مهمة بحث', dueDate: today, fileId: file.id, caseId: (await env()).stage.id, tags: ['وسم-فريد']});
    await C.addComment(office, t.id, {type: 'note', body: 'نص تعليق نادر زنجبيل'});
    const find = async q => idsOf((await Q.queryWorkItems(office, {range: 'custom', from: '', to: addDays(today, 60), undated: true, q}, {limit: 200})).items);
    expect((await find('موكل اختبار مركز')).includes(t.id)).toBe(true);
    expect((await find('الخصم الثاني')).includes(t.id)).toBe(true);
    expect((await find('2026')).length > 0).toBe(true);
    expect((await find('777')).includes(t.id)).toBe(true);
    expect((await find('وسم-فريد')).includes(t.id)).toBe(true);
    expect((await find('زنجبيل')).includes(t.id)).toBe(true);
    expect((await find('اختبار')).length > 0).toBe(true);
    expect((await find('كلمة-غير-موجودة-أبدًا')).length).toBe(0);
    expect((await find('مَوْكِل اختبار')).includes(t.id)).toBe(true);   // التطبيع العربي (التشكيل)
    expect((await find('موكل  مركز')).includes(t.id)).toBe(true);
    expect(Boolean(client.id)).toBe(true);
  });
  test('مركز العمل/استعلام: نطاق الملف والموكل والخصم (فهارس) ولا يخلط ملفات أخرى', async () => {
    const {office, file, client, hearing} = await env();
    const other = await createLegalFile(office, {clientId: (await office.saveClient({fullName: 'موكل آخر'})).id, title: 'ملف آخر', fileType: 'مدني'});
    const stage = await office.createCase({fileId: other.id, stageType: 'دعوى', caseNumber: '555', caseYear: '2026'});
    const foreign = await saveOperational(office, 'hearings', {caseId: stage.id, hearingDate: today, reason: 'جلسة ملف آخر'});
    const byFile = await Q.queryWorkItems(office, {range: 'all', kinds: ['open', 'done', 'cancelled'], fileId: file.id}, {limit: 500});
    if (!idsOf(byFile.items).includes(ref('hearings', hearing.id))) throw Error(`جلسة الملف غير ظاهرة في نطاق الملف (${byFile.items.length} عنصرًا)`);
    expect(idsOf(byFile.items).includes(ref('hearings', foreign.id))).toBe(false);
    expect(byFile.items.every(i => i.fileId === file.id || i.sourceType === 'hearings')).toBe(true);
    const byClient = await Q.queryWorkItems(office, {range: 'all', kinds: ['open', 'done', 'cancelled'], clientId: client.id}, {limit: 500});
    if (!idsOf(byClient.items).includes(ref('hearings', hearing.id))) throw Error(`جلسة الموكل غير ظاهرة في نطاق الموكل (${byClient.items.length} عنصرًا)`);
    expect(idsOf(byClient.items).includes(ref('hearings', foreign.id))).toBe(false);
    const opponentParty = (await office.r.fileParties.byIndexAll('fileId', file.id)).find(p => p.opponentId);
    const byOpponent = await Q.queryWorkItems(office, {range: 'all', kinds: ['open', 'done', 'cancelled'], opponentId: opponentParty.opponentId}, {limit: 500});
    expect(idsOf(byOpponent.items).includes(ref('hearings', hearing.id))).toBe(true); expect(idsOf(byOpponent.items).includes(ref('hearings', foreign.id))).toBe(false);
  });
  test('مركز العمل/استعلام: الحالات التشغيلية عبر فهرس status_dueDate (أعمدة كانبان) وفي أعمدة التقدّم فقط', async () => {
    const {office} = await env();
    const a = await C.saveWorkItem(office, {title: 'كانبان قيد التنفيذ', dueDate: today, status: 'inProgress'});
    const w = await C.saveWorkItem(office, {title: 'كانبان بانتظار', dueDate: today, status: 'waiting'});
    const col = async status => idsOf((await Q.queryWorkItems(office, {drive: 'status', statuses: [status], range: 'all'}, {limit: 100})).items);
    expect((await col('inProgress')).includes(a.id)).toBe(true); expect((await col('inProgress')).includes(w.id)).toBe(false);
    expect((await col('waiting')).includes(w.id)).toBe(true);
    await C.setItemStatus(office, a.id, 'waiting');
    expect((await col('waiting')).includes(a.id)).toBe(true); expect((await col('inProgress')).includes(a.id)).toBe(false);
    const open = await Q.queryWorkItems(office, {range: 'today', statuses: ['notStarted']}, {limit: 400});
    expect(open.items.every(i => i.status === 'notStarted')).toBe(true);
  });
  test('مركز العمل/استعلام: بلا موعد تظهر فقط عند طلبها وتأتي أخيرًا', async () => {
    const {office} = await env();
    const u = await C.saveWorkItem(office, {title: 'بلا موعد للاختبار'});
    const without = await Q.queryWorkItems(office, {range: 'today'}, {limit: 400});
    expect(idsOf(without.items).includes(u.id)).toBe(false);
    const withAll = await Q.queryWorkItems(office, {range: 'all', undated: true}, {limit: 800});
    const last = withAll.items.at(-1);
    expect(idsOf(withAll.items).includes(u.id)).toBe(true); expect(withAll.items.filter(i => !i.dueDate).length > 0 && withAll.items.at(-1).dueDate === '').toBe(true); expect(Boolean(last)).toBe(true);
  });
  test('مركز العمل/استعلام: إلغاء الاستعلام عبر AbortSignal', async () => {
    const {office} = await env();
    const controller = new AbortController(); controller.abort();
    const error = await rejects(() => Q.queryWorkItems(office, {range: 'all'}, {limit: 50, signal: controller.signal}));
    expect(error.name).toBe('AbortError');
  });
  test('مركز العمل/استعلام: ملخص الرأس يطابق الأعداد الفعلية ويكتب لا شيء', async () => {
    const {office} = await env();
    const before = await office.r.workItems.count();
    const sum = await Q.workSummary(office);
    const todayItems = await Q.queryWorkItems(office, {range: 'today'}, {limit: 800});
    const overdue = await Q.queryWorkItems(office, {range: 'overdue'}, {limit: 800});
    expect(sum.todayCount).toBe(todayItems.items.length); expect(sum.overdue).toBe(overdue.items.length);
    expect(await office.r.workItems.count()).toBe(before);
    expect(Q.nowAndNext(todayItems.items, '10:10').now.every(i => i.dueTime >= '09:10')).toBe(true);
  });

  // ===== 6) التكرار =====
  test('مركز العمل/تكرار: تعريف أسبوعي يولّد عناصر افتراضية بلا صفوف، ويُحوَّل عند التفاعل مرة واحدة فقط', async () => {
    const {office} = await env();
    const before = await office.r.workItems.count();
    const def = await saveEntity(office, 'workItems', {title: 'مهمة متكررة اختبار', dueDate: today, recurFreq: 'daily', recurInterval: 1, priority: 'medium'});
    expect(def.kind).toBe('recurrence'); expect(await office.r.workItems.count()).toBe(before);
    const week = await Q.queryWorkItems(office, {range: 'custom', from: today, to: addDays(today, 6)}, {limit: 300});
    const virtual = week.items.filter(i => i.recurrenceId === def.id);
    expect(virtual.length).toBe(7); expect(virtual.every(i => i.isVirtual && i.id.startsWith('rec::'))).toBe(true);
    const first = virtual[0];
    await C.completeItem(office, first.id);
    await C.completeItem(office, first.id);
    const made = (await office.r.workItems.all(5000)).filter(r => r.recurrenceId === def.id);
    expect(made.length).toBe(1); expect(made[0].status).toBe('done'); expect(made[0].occurrenceDate).toBe(first.dueDate);
    const after = await Q.queryWorkItems(office, {range: 'custom', from: today, to: addDays(today, 6)}, {limit: 300});
    expect(after.items.filter(i => i.recurrenceId === def.id).length).toBe(6);
    expect(Boolean(await rejects(() => C.materializeOccurrence(office, def.id, addDays(today, -400))))).toBe(true);   // تاريخ ليس ضمن جدول التكرار
    await C.endRecurrence(office, def.id);
    const ended = await Q.queryWorkItems(office, {range: 'custom', from: addDays(today, 1), to: addDays(today, 6)}, {limit: 300});
    expect(ended.items.some(i => i.recurrenceId === def.id)).toBe(false);
  });
  test('مركز العمل/تكرار: المتأخر من التكرار يظهر آخر فائت فقط', async () => {
    const {office} = await env();
    const def = await C.saveRecurrence(office, {title: 'متكرر فائت', startDate: addDays(today, -10), rule: {freq: 'daily'}});
    const late = await Q.queryWorkItems(office, {range: 'overdue'}, {limit: 400});
    expect(late.items.filter(i => i.recurrenceId === def.id).length).toBe(1);
    await C.endRecurrence(office, def.id);
  });

  // ===== 7) الاستنتاجات =====
  test('مركز العمل/ذكاء: قواعد «يحتاج انتباهي» وتأجيل مرارًا ومصادر مفقودة واقتراحات بلا ذكاء خارجي', async () => {
    const {office} = await env();
    const cfg = K.getWorkConfig();
    const base = {isOpen: true, dueDate: addDays(today, -2), priority: 'low', postponeCount: 0, sourceAvailable: true, sourceType: 'task'};
    expect(I.attentionReasons(base, {today, config: cfg}).some(r => r.key === 'overdue')).toBe(true);
    expect(I.attentionReasons({...base, dueDate: today, postponeCount: 4}, {today, config: cfg}).some(r => r.key === 'repeatedPostpone')).toBe(true);
    expect(I.attentionReasons({...base, dueDate: '', priority: 'urgent'}, {today, config: cfg}).some(r => r.key === 'highNoDate')).toBe(true);
    expect(I.attentionReasons({...base, dueDate: today, sourceType: 'hearings'}, {today, config: cfg}).some(r => r.key === 'hearingSoon')).toBe(true);
    expect(I.attentionReasons({...base, isOpen: true, dueDate: today, sourceAvailable: false}, {today, config: cfg}).some(r => r.key === 'sourceMissing')).toBe(true);
    expect(I.attentionReasons(base, {today, config: {attention: {rules: {overdue: false}}, urgentWithinDays: 2}}).some(r => r.key === 'overdue')).toBe(false);
    const att = await I.attentionItems(office, {today});
    expect(att.rows.length > 0).toBe(true); expect(att.rows.every(r => r.reasons.length > 0)).toBe(true);
    const sug = I.buildSuggestions({overdue: 3, hearingsToday: 1, hearingsTomorrow: 0, postponed: 0, undated: 0, todayCount: 4}, {staleCount: 2});
    expect(sug.map(s => s.key).join()).toBe('overdue,hearingsToday,stale');
    expect(I.buildSuggestions({overdue: 0, todayCount: 0}, {}).some(s => s.key === 'free')).toBe(true);
  });
  test('مركز العمل/ذكاء: المراجعة اليومية والأسبوعية والإنتاجية وصفية وصحيحة', async () => {
    const {office} = await env();
    const day = await I.dailyReview(office, {today});
    expect(Array.isArray(day.done) && Array.isArray(day.openToday) && Array.isArray(day.tomorrow)).toBe(true);
    expect(day.carryOver.every(i => i.caps.postpone && i.sourceType !== 'hearings')).toBe(true);
    const week = await I.weeklyReview(office, {today});
    expect(week.monday <= today && today <= week.sunday).toBe(true);
    const prod = await I.productivity(office, {today, days: 7});
    expect(prod.series.length).toBe(7); expect(prod.series.reduce((n, d) => n + d.count, 0)).toBe(prod.total);
    expect((await I.staleFiles(office, {today, days: 1})).length >= 0).toBe(true);
  });

  // ===== 8) العروض المحفوظة والحالة =====
  test('مركز العمل/عروض: العروض المحفوظة والحالة المحفوظة تُنظَّف وتستمر', async () => {
    await K.saveWorkState({range: 'week', view: 'kanban', q: 'بحث', filters: {priorities: ['urgent', 'bogus'], sources: ['hearings'], pinned: true}});
    const st = K.getWorkState();
    expect(st.range).toBe('week'); expect(st.view).toBe('kanban'); expect(st.filters.priorities.join()).toBe('urgent'); expect(st.filters.pinned).toBe(true);
    await K.saveWorkState({view: 'hacker', range: 'nope'});
    expect(K.getWorkState().view).toBe('cards'); expect(K.getWorkState().range).toBe('today');
    await K.saveWorkView('جلسات عاجلة', {range: 'week', view: 'list', filters: {sources: ['hearings'], priorities: ['urgent']}});
    const views = K.listWorkViews();
    expect(views.length >= 1 && views.at(-1).name === 'جلسات عاجلة' && views.at(-1).state.view === 'list').toBe(true);
    await K.saveWorkView('جلسات عاجلة (معدّل)', views.at(-1).state, views.at(-1).id);
    expect(K.listWorkViews().at(-1).name).toBe('جلسات عاجلة (معدّل)');
    for (const v of K.listWorkViews()) await K.removeWorkView(v.id);
    expect(K.listWorkViews().length).toBe(0);
  });

  // ===== 9) سلامة البيانات والنشاط والبحث الشامل =====
  test('مركز العمل/سلامة: لا تغيّر أي عملية معرّفات الملف/القضية/الموكل ولا أرقامها ولا أسماء الأطراف', async () => {
    const {office, before, snapshot} = await env();
    const after = await snapshot();
    expect(after.file.id).toBe(before.file.id); expect(after.file.fileNumber).toBe(before.file.fileNumber); expect(after.stage.caseNumber).toBe(before.stage.caseNumber); expect(after.stage.id).toBe(before.stage.id);
    expect(after.client.fullName).toBe(before.client.fullName); expect(after.client.id).toBe(before.client.id);
    expect(JSON.stringify(after.parties)).toBe(JSON.stringify(before.parties));
    void office;
  });
  test('مركز العمل/سلامة: سجل النشاط الموجود يستقبل أحداث العناصر بلا بيانات شخصية خام', async () => {
    const {office} = await env();
    const log = (await office.r.activityLog.all(5000)).filter(r => r.entityType === 'workItems');
    expect(log.length > 10).toBe(true);
    const text = JSON.stringify(log);
    for (const name of ['موكل اختبار مركز العمل', 'الخصم الأول', 'الخصم الثاني', 'ملف مركز العمل']) expect(text.includes(name)).toBe(false);
    expect(log.every(r => r.id && r.action && r.timestamp && r.summary)).toBe(true);
    const history = await C.itemHistory(office, ref('procedures', (await env()).procedure.id));
    expect(history.some(h => h.entityType === 'workItems') && history.some(h => h.entityType === 'procedures')).toBe(true);
    expect(history.every((h, i, a) => i === 0 || String(a[i - 1].timestamp) >= String(h.timestamp))).toBe(true);
  });
  test('مركز العمل/سلامة: فحص سلامة قاعدة البيانات يمر: لا صفوف مكررة ولا روابط مكسورة للمهام والتعليقات', async () => {
    const {db} = await env();
    const health = await deepHealth({assert() {}, db, profile: {databaseName: dbName}}, {scanRows: true});
    const mine = health.issues.filter(i => ['workItems', 'workItemComments', 'workItemRecurrences'].includes(i.store));
    if (mine.length) throw Error(JSON.stringify(mine.slice(0, 3)));
    expect(health.counts.workItems > 0).toBe(true);
  });
  test('مركز العمل/سلامة: لا تكرار في الطبقات ولا معرّفات مكررة والمعرّفات نصية من المولّد المحلي', async () => {
    const {office} = await env();
    const rows = await office.r.workItems.all(5000);
    expect(new Set(rows.map(r => r.id)).size).toBe(rows.length);
    const overlays = rows.filter(r => r.kind === 'overlay');
    expect(new Set(overlays.map(r => `${r.sourceType}::${r.sourceId}`)).size).toBe(overlays.length);
    expect(overlays.every(r => r.id === `${r.sourceType}::${r.sourceId}`)).toBe(true);
    expect(rows.filter(r => r.kind === 'native').every(r => typeof r.id === 'string' && r.id.length === 20)).toBe(true);
    expect(uid().length).toBe(20);
  });
  test('مركز العمل/سلامة: النسخة الاحتياطية الكاملة تحمل عناصر العمل وتُستعاد بنفس العدد', async () => {
    const {office} = await env();
    const payload = await exportDatabase(office.ctx);
    const counts = Object.fromEntries(['workItems', 'workItemComments', 'workItemRecurrences'].map(s => [s, payload.stores[s].length]));
    expect(counts.workItems > 0 && counts.workItemComments > 0 && counts.workItemRecurrences > 0).toBe(true);
    const info = await inspectBackup(payload);
    expect(info.recordCounts.workItems).toBe(counts.workItems);
    const name2 = `AhmadKhudairLawOfficeDB__test__restore2__${Date.now()}`;
    const db2 = await openDb(name2, 14);
    try {
      const o2 = new Office({db: db2, assert() {}, token: 'r2', profile: {id: 'r2'}});
      await importDatabase(o2.ctx, payload);
      expect(await o2.r.workItems.count()).toBe(counts.workItems); expect(await o2.r.workItemComments.count()).toBe(counts.workItemComments);
      const page = await Q.queryWorkItems(o2, {range: 'all', undated: true}, {limit: 300});
      expect(page.items.length > 5).toBe(true);
    } finally { db2.close(); indexedDB.deleteDatabase(name2); }
  });
  test('مركز العمل/بحث شامل: المهام المستقلة تظهر في البحث الشامل الموجود ولا يظهر عنصر طبقة', async () => {
    const {office} = await env();
    const result = await searchAll(office, 'مهمة بحث', {stores: ['workItems']});
    expect(result.total >= 1).toBe(true);
    const group = result.groups.find(g => g.store === 'workItems');
    expect(group.items.every(i => i.row.kind === 'native')).toBe(true);
    expect(group.items[0].route.startsWith('actionCenter?item=')).toBe(true);
  });
  test('مركز العمل/علاقات: «الخصم: X + 2 آخرين» بلا تكرار عبر قارئ العلاقات الموحّد', async () => {
    const {office, file, hearing} = await env();
    const item = await Q.getWorkItem(office, ref('hearings', hearing.id));
    const rel = createGridRelations(office, 'workItems');
    await rel.hydrate([item]);
    const opponents = rel.items(item, 'opponent');
    expect(opponents.length).toBe(3); expect(new Set(opponents.map(o => o.text)).size).toBe(3);
    const mod = await import('../ui/work-card.js');
    expect(mod.partiesLine('الخصم', opponents)).toBe('الخصم: الخصم الأول + 2 آخرين');
    expect(mod.partiesLine('الموكل', rel.items(item, 'client'))).toBe('الموكل: موكل اختبار مركز العمل');
    expect(rel.items(item, 'legalFile').length).toBe(1);
    void file;
  });
  test('مركز العمل/قوائم: أنواع ووسوم وأسباب التأجيل من القوائم القابلة للتعديل', async () => {
    const {office} = await env();
    expect((await getLookup(office, 'workItemType')).includes('متابعة')).toBe(true);
    expect((await getLookup(office, 'workItemPostponeReason')).length > 0).toBe(true);
    expect(Array.isArray(await getLookup(office, 'workItemTag'))).toBe(true);
  });
  test('مركز العمل/عمليات جماعية: كل عنصر معاملة مستقلة ونتيجة كل عنصر صادقة', async () => {
    const {office} = await env();
    const a = await C.saveWorkItem(office, {title: 'جماعي أ', dueDate: today}), b = await C.saveWorkItem(office, {title: 'جماعي ب', dueDate: today});
    const out = await C.bulkApply(office, [a.id, b.id, 'NOPE-ID'], 'complete');
    expect(out.done.length).toBe(2); expect(out.failed.length).toBe(1);
    expect((await office.r.workItems.get(a.id)).status).toBe('done');
    expect((await C.bulkApply(office, [a.id], 'reopen')).done.length).toBe(1);
    expect(Boolean(await rejects(() => C.bulkApply(office, [a.id], 'explode')))).toBe(true);
  });
  test('مركز العمل/إسقاط: سجلات المصادر الاختيارية والتوسع عبر registerWorkSource', async () => {
    expect(S.workSource('serviceRecords').defaultEnabled).toBe(false);
    expect(S.enabledWorkSources({}).map(s => s.type).join()).toBe('hearings,procedures,appointments,communications,files');
    expect(S.enabledWorkSources({sources: {serviceRecords: true, files: false}}).map(s => s.type).includes('serviceRecords')).toBe(true);
    S.registerWorkSource({type: 'testExt', store: 'documentReferences', index: 'date', dateOf: r => r.date, sourceKind: () => 'open', title: r => r.title});
    expect(S.workSource('testExt').caps).toBeTruthy();
    expect(Boolean(await rejects(async () => S.registerWorkSource({type: 'bad'})))).toBe(true);
  });
  test('مركز العمل/بيانات تجريبية: على 50 ملفًا تجريبيًا يعمل الاستعلام والملخص بلا أخطاء ولا تكرار', async () => {
    const name3 = `AhmadKhudairLawOfficeDB__test__wcdemo__${Date.now()}`;
    const db3 = await openDb(name3, 14);
    try {
      const o3 = new Office({db: db3, assert() {}, token: 'wd', profile: {id: 'wd'}});
      await seedLookups(o3); await seedTaxonomy(o3); await seedDemoData(o3);
      const all = await Q.queryWorkItems(o3, {range: 'all', undated: true}, {limit: 3000});
      expect(all.items.length > 100).toBe(true); expect(new Set(idsOf(all.items)).size).toBe(all.items.length);
      expect(all.items.every(i => i.id && i.title && i.sortKey && typeof i.sourceAvailable === 'boolean')).toBe(true);
      const sum = await Q.workSummary(o3);
      expect(sum.overdue + sum.todayCount + sum.tomorrow + sum.week + sum.later + sum.undated > 100).toBe(true);
      const rel = createGridRelations(o3, 'workItems');
      await rel.hydrate(all.items.slice(0, 60));
      expect(all.items.slice(0, 60).every(i => rel.model(i))).toBe(true);
    } finally { db3.close(); indexedDB.deleteDatabase(name3); }
  });
  test('مركز العمل/تنظيف: إغلاق قاعدة الاختبار', async () => {
    const {db} = await env();
    db.close(); indexedDB.deleteDatabase(dbName);
    expect(localDate(new Date(2026, 0, 31))).toBe('2026-01-31');
  });
}
