// مركز العمل (Work Center): اختبارات المجال النقي، الترحيل v13→v14، أوامر الخدمة، الاستعلام، التكامل والسلامة.
// تعمل على IndexedDB حقيقي (fake-indexeddb في Node، المحرك الحقيقي في المتصفح) وعلى بيانات تجريبية + سجلات محكومة.
import {upgradeSchema, STORES, STORE, SCHEMA, SCHEMA_MIGRATIONS, migrationPlan} from '../db/schema.js';
import {Office} from '../services/office.js';
import {createLegalFile, saveParty} from '../services/legal-files.js';
import {saveOperational} from '../services/operations.js';
import {saveEntity} from '../services/entity-save.js';
import {seedDemoData} from '../services/demo-seed.js';
import {seedTaxonomy} from '../services/client-files.js';
import {seedLookups, getLookup, saveLookupValue, removeLookupValue} from '../services/lookups.js';
import {LOOKUP_CATEGORIES} from '../domain/lookup-defaults.js';
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
import * as ST from '../services/work-statuses.js';
import {prefs} from '../core/preferences.js';
import {events} from '../core/events.js';
import {createGridRelations} from '../services/grid-relations.js';
import {searchAll} from '../services/search-engine.js';

const rejects = async fn => { try { await fn(); } catch (error) { return error; } throw Error('Expected promise to reject'); };
const idsOf = items => items.map(i => i.id);
async function openDb(name, version, stores = null) {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(name, version);
    r.onupgradeneeded = e => {
      if (stores) {            // قاعدة v13 الحقيقية: كل المخازن عدا الجديدة
        for (const store of stores) { const def = SCHEMA[store]; const os = r.result.createObjectStore(store, {keyPath: def.keyPath, ...(def.autoIncrement ? {autoIncrement: true} : {})}); for (const [n, k] of Object.entries(def.indexes)) os.createIndex(n, k, {unique: def.uniqueIndexes.includes(n)}); }
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
  // مكتب معزول (قاعدته ورمزه) لاختبارات الحالات المخصصة: لا يغيّر أعداد العناصر في المكتب المشترك للاختبارات الأخرى.
  const isolated = async tag => {
    const name = `AhmadKhudairLawOfficeDB__test__wcstatus__${tag}__${Date.now()}`;
    const db = await openDb(name, SCHEMA_VERSION);
    const office = new Office({db, assert() {}, token: `wcst-${tag}`, profile: {id: `wcst-${tag}`}});
    await seedLookups(office);
    return {db, office, done: () => { db.close(); indexedDB.deleteDatabase(name); ST.resetWorkStatuses(); }};
  };

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
  test('مركز العمل/مجال: تسميات وألوان الأولوية والحالة قابلة للتخصيص، وتفضيلات الجهاز لا تحمل قائمة حالات مخصصة', () => {
    const cfg = K.sanitizeWorkConfig({priorities: {urgent: {label: 'حرج للغاية', color: '#112233'}}, statuses: {waiting: {label: 'في انتظار الموكل'}, c_review: {label: 'تسمية لا تُحفظ', color: '#445566'}, 'bad key': {color: '#ffffff'}},
      customStatuses: [{key: 'c_old', label: 'قديمة في التفضيلات', kind: 'open'}]});
    expect(D.priorityInfo('urgent', cfg).label).toBe('حرج للغاية'); expect(D.priorityInfo('urgent', cfg).color).toBe('#112233');
    expect(D.statusInfo('waiting', cfg).label).toBe('في انتظار الموكل');
    // الحالات المخصصة لا تُحفظ في تفضيلات الجهاز (قائمتها في Lookups داخل قاعدة المكتب): يُقبل لون فقط، والتسمية ومفتاح غريب يُرفضان.
    expect(cfg.customStatuses.length).toBe(0);
    expect(JSON.stringify(cfg.statuses.c_review)).toBe(JSON.stringify({color: '#445566'})); expect(cfg.statuses['bad key']).toBe(undefined);
    expect(K.sanitizeWorkConfig({priorities: {urgent: {color: 'javascript:alert(1)'}}}).priorities.urgent).toBe(undefined);
  });
  test('مركز العمل/مجال: الحالات المخصصة من صفوف Lookups — مفتاح ثابت من المعرّف، مفتوحة دائمًا، مرتبة، والمحذوفة تتقاعد', () => {
    const rows = [
      {id: '01HZZZZZ00AAAAAAAAAA', value: 'تحت المراجعة', order: 2, isDeleted: false},
      {id: '01HZZZZZ00BBBBBBBBBB', value: 'بانتظار الموكل', order: 1, isDeleted: false},
      {id: '01HZZZZZ00CCCCCCCCCC', value: 'حالة قديمة', order: 3, isDeleted: true},
      {id: '', value: 'بلا معرّف'}, {id: 'x1', value: '   '}
    ];
    const {custom, retired} = D.customStatusesFromRows(rows);
    expect(custom.map(x => x.label).join('|')).toBe('بانتظار الموكل|تحت المراجعة');                 // بترتيب order لا ترتيب الإدخال
    expect(custom.every(x => x.kind === 'open' && /^c_[a-z0-9_]{1,24}$/.test(x.key))).toBe(true);
    expect(custom[0].key).toBe(D.customStatusKey('01HZZZZZ00BBBBBBBBBB'));                          // مشتق من المعرّف لا من الاسم
    expect(retired.map(x => x.label).join()).toBe('حالة قديمة');
    const cfg = {customStatuses: custom, retiredStatuses: retired, statuses: {[custom[0].key]: {color: '#123456'}}};
    expect(D.mergeStatuses(cfg).filter(x => x.custom).length).toBe(2);
    expect(D.statusInfo(custom[0].key, cfg).color).toBe('#123456');                                  // لون الجهاز يغلب الافتراضي
    expect(D.statusInfo(retired[0].key, cfg).retired).toBe(true);
    expect(D.statusInfo(retired[0].key, cfg).label).toBe('حالة قديمة (محذوفة)');
    expect(D.mergeStatuses(cfg).some(x => x.key === retired[0].key)).toBe(false);                    // المتقاعدة لا تظهر في الاختيار
    expect(D.statusInfo('c_zzzzzz', cfg).unknown).toBe(true);                                        // مفتاح يتيم لا يُعرض خامًا
    expect(D.statusInfo('c_zzzzzz', cfg).label).toBe('حالة محذوفة');
    expect(D.statusKindOf(custom[0].key, cfg)).toBe('open');
    const many = Array.from({length: 45}, (_, i) => ({id: `ID${String(i).padStart(18, '0')}`, value: `حالة ${i}`, order: i}));
    expect(D.customStatusesFromRows(many).custom.length).toBe(D.MAX_CUSTOM_STATUSES);                // سقف الأمان
  });
  test('مركز العمل/قوائم: إنشاء حالة مخصصة — صف في lookups لا في التفضيلات، والمفتاح يثبت عند إعادة التسمية، والتحقق من الاسم', async () => {
    const t = await isolated('create');
    try {
      const {office} = t;
      const made = await ST.createCustomStatus(office, 'بانتظار الموكل');
      const rows = await office.r.lookups.byIndex('category', D.STATUS_LOOKUP, 50);
      expect(rows.length).toBe(1); expect(rows[0].value).toBe('بانتظار الموكل'); expect(rows[0].id).toBe(made.id);
      expect(made.key).toBe(D.customStatusKey(made.id));
      expect(K.getWorkConfig().customStatuses.map(x => x.label).join()).toBe('بانتظار الموكل');
      await K.saveWorkConfig({});                                                                        // ما يُحفظ على الجهاز لا يحمل قائمة الحالات
      expect(((prefs.get(K.WORK_CONFIG_KEY) || {}).customStatuses || []).length).toBe(0);
      const task = await C.saveWorkItem(office, {title: 'WCST مهمة بحالة مخصصة', status: made.key, dueDate: today});
      expect(task.status).toBe(made.key);
      const renamed = await ST.renameCustomStatus(office, made.id, 'بانتظار رد الموكل');
      expect(renamed.key).toBe(made.key);                                                                // إعادة التسمية لا تفكّ الارتباط
      expect(K.getWorkConfig().customStatuses[0].label).toBe('بانتظار رد الموكل');
      const item = await Q.getWorkItem(office, task.id);
      expect(item.status).toBe(made.key); expect(item.statusLabel).toBe('بانتظار رد الموكل');
      expect(D.isOpenStatus(item.status, K.getWorkConfig())).toBe(true);
      for (const [name, part] of [['مكتمل', 'أساسية'], ['مكتّمل', 'أساسية'], ['مؤرشف', 'أساسية'], ['  بانتظار   رد الموكل ', 'موجود'], ['', 'مطلوب'], ['ا'.repeat(31), 'أطول']]) {
        const error = await rejects(() => ST.createCustomStatus(office, name));
        expect(String(error.message).includes(part)).toBe(true);
      }
      expect((await office.r.lookups.byIndex('category', D.STATUS_LOOKUP, 50)).length).toBe(1);           // الرفض لا يترك صفوفًا
    } finally { t.done(); }
  });
  test('مركز العمل/قوائم: حذف الحالة المخصصة منطقي — تتقاعد وتبقى مقروءة للمهام القديمة ولا يُحجب تعديلها', async () => {
    const t = await isolated('retire');
    try {
      const {office} = t;
      const made = await ST.createCustomStatus(office, 'حالة ستُحذف');
      const task = await C.saveWorkItem(office, {title: 'WCST مهمة بحالة ستتقاعد', status: made.key, dueDate: today});
      await ST.removeCustomStatus(office, made.id);
      const cfg = K.getWorkConfig();
      expect(cfg.customStatuses.some(x => x.key === made.key)).toBe(false);
      expect(cfg.retiredStatuses.some(x => x.key === made.key)).toBe(true);
      const row = (await office.r.lookups.byIndexRaw('category', D.STATUS_LOOKUP, 50)).find(r => r.id === made.id);
      expect(row.isDeleted).toBe(true);                                                                   // حذف منطقي: الصف باقٍ
      const item = await Q.getWorkItem(office, task.id);
      expect(item.status).toBe(made.key); expect(item.statusLabel).toBe('حالة ستُحذف (محذوفة)');
      expect(D.statusKindOf(item.status, cfg)).toBe('open');
      const edited = await C.saveWorkItem(office, {title: 'WCST مهمة معدّلة بعد التقاعد'}, task.id);        // التعديل لا يُرفض ولا يغيّر الحالة
      expect(edited.status).toBe(made.key); expect(edited.title).toBe('WCST مهمة معدّلة بعد التقاعد');
      const other = await C.saveWorkItem(office, {title: 'WCST أخرى', dueDate: today});
      expect((await rejects(() => C.setItemStatus(office, other.id, made.key))).message.includes('محذوفة')).toBe(true);   // اختيارها لمهمة أخرى مرفوض
      expect(Boolean(await rejects(() => C.saveWorkItem(office, {title: 'WCST ثالثة', status: made.key})))).toBe(true);
      const probe = [{k: 'status', opts: []}];
      expect(D.workItemFieldOverrides(probe, cfg, item)[0].opts.some(([k]) => k === made.key)).toBe(true);  // تبقى خيارًا ظاهرًا لمهمتها فقط
      expect(D.workItemFieldOverrides(probe, cfg, null)[0].opts.some(([k]) => k === made.key)).toBe(false);
      expect(D.mergeStatuses(cfg).some(x => x.key === made.key)).toBe(false);
    } finally { t.done(); }
  });
  test('مركز العمل/قوائم: مسار «القوائم» العام يضيف ويعيد التسمية ويحذف حالات المهام نفسها', async () => {
    const t = await isolated('lists');
    try {
      const {office} = t;
      expect(Boolean(LOOKUP_CATEGORIES[D.STATUS_LOOKUP])).toBe(true);                                    // الفئة ظاهرة في الإعدادات ← القوائم
      await ST.ensureWorkStatuses(office);
      expect(ST.customStatusSnapshot().fresh).toBe(true);
      const row = await saveLookupValue(office, D.STATUS_LOOKUP, 'عبر القوائم');                         // كما تفعل شاشة القوائم
      expect(ST.customStatusSnapshot().fresh).toBe(false);                                                // أُبطلت اللقطة بحدث التغيير
      await ST.ensureWorkStatuses(office);
      const key = D.customStatusKey(row.id);
      expect(K.getWorkConfig().customStatuses.map(x => x.key).join()).toBe(key);
      expect(D.statusInfo(key, K.getWorkConfig()).kind).toBe('open');
      // الإضافة من القوائم مباشرةً تخضع لقاعدة الاسم نفسها (خطاف الفئة): لا اسم حالة أساسية ولا تكرار بعد التطبيع ولا 31 حرفًا.
      for (const [bad, part] of [['مكتمل', 'أساسية'], ['ملغي', 'أساسية'], ['  مؤرشف ', 'أساسية'], ['عبر   القوائم', 'موجود'], ['ا'.repeat(31), 'أطول']]) {
        const error = await rejects(() => saveLookupValue(office, D.STATUS_LOOKUP, bad));
        expect(Boolean(error) && String(error.message).includes(part)).toBe(true);
      }
      expect((await office.r.lookups.byIndex('category', D.STATUS_LOOKUP, 50)).length).toBe(1);
      await saveLookupValue(office, 'workItemType', 'مكتمل');                                              // فئة أخرى لا تتأثر بقاعدة الحالات
      await saveLookupValue(office, D.STATUS_LOOKUP, 'عبر القوائم (معدّلة)', row.id);
      await ST.ensureWorkStatuses(office);
      expect(K.getWorkConfig().customStatuses[0].key).toBe(key); expect(K.getWorkConfig().customStatuses[0].label).toBe('عبر القوائم (معدّلة)');
      await removeLookupValue(office, row.id);
      await ST.ensureWorkStatuses(office);
      expect(K.getWorkConfig().customStatuses.length).toBe(0); expect(K.getWorkConfig().retiredStatuses[0].key).toBe(key);
    } finally { t.done(); }
  });
  test('مركز العمل/قوائم: سقف الحالات المخصصة يُفرض على كل مسارات الإضافة ولا تُحتسب فيه المحذوفة', async () => {
    const t = await isolated('cap');
    try {
      const {office} = t;
      for (let i = 1; i <= D.MAX_CUSTOM_STATUSES; i++) await saveLookupValue(office, D.STATUS_LOOKUP, `حالة رقم ${i}`);
      expect(String((await rejects(() => saveLookupValue(office, D.STATUS_LOOKUP, 'حالة زائدة'))).message).includes('الحد الأقصى')).toBe(true);
      expect(String((await rejects(() => ST.createCustomStatus(office, 'حالة زائدة أخرى'))).message).includes('الحد الأقصى')).toBe(true);
      const rows = await office.r.lookups.byIndex('category', D.STATUS_LOOKUP, 100);
      expect(rows.length).toBe(D.MAX_CUSTOM_STATUSES);
      await ST.removeCustomStatus(office, rows[0].id);
      await saveLookupValue(office, D.STATUS_LOOKUP, 'حالة بعد الحذف');                                    // مقبولة: المتقاعدة خارج السقف
      await ST.refreshWorkStatuses(office);
      expect(K.getWorkConfig().customStatuses.length).toBe(D.MAX_CUSTOM_STATUSES);
      expect(K.getWorkConfig().retiredStatuses.length).toBe(1);
      await ST.renameCustomStatus(office, rows[1].id, 'حالة رقم 2 معدّلة');                                 // إعادة التسمية لا تتأثر بالسقف
    } finally { t.done(); }
  });
  test('مركز العمل/قوائم: النسخة الاحتياطية تحمل تعريف الحالات المخصصة (والمتقاعدة) وتُستعاد بالمفاتيح نفسها وتبقى المهام مرتبطة', async () => {
    const a = await isolated('bk-a'), b = await isolated('bk-b');
    try {
      const live = await ST.createCustomStatus(a.office, 'حالة للنسخ الاحتياطي');
      const gone = await ST.createCustomStatus(a.office, 'حالة محذوفة قبل النسخ');
      const retiredTask = await C.saveWorkItem(a.office, {title: 'WCST مهمة بحالة متقاعدة', status: gone.key, dueDate: today});
      await ST.removeCustomStatus(a.office, gone.id);
      const task = await C.saveWorkItem(a.office, {title: 'WCST مهمة للنسخ', status: live.key, dueDate: today});
      const payload = await exportDatabase(a.office.ctx);
      await importDatabase(b.office.ctx, payload);
      await ST.refreshWorkStatuses(b.office);
      const cfg = K.getWorkConfig();
      expect(cfg.customStatuses.map(x => x.key).join()).toBe(live.key);
      expect(cfg.retiredStatuses.map(x => x.key).join()).toBe(gone.key);
      const restored = await Q.getWorkItem(b.office, task.id);
      expect(restored.status).toBe(live.key); expect(restored.statusLabel).toBe('حالة للنسخ الاحتياطي');
      expect((await Q.getWorkItem(b.office, retiredTask.id)).statusLabel).toBe('حالة محذوفة قبل النسخ (محذوفة)');
    } finally { a.done(); b.done(); }
  });
  test('مركز العمل/قوائم: لا تتسرب الحالات بين قاعدتين، واستعادة نسخة فوق الاتصال الحالي تُبطل اللقطة', async () => {
    const a = await isolated('iso-a'), b = await isolated('iso-b');
    try {
      await ST.createCustomStatus(a.office, 'حالة المكتب أ');
      await ST.ensureWorkStatuses(a.office);
      expect(K.getWorkConfig().customStatuses.map(x => x.label).join()).toBe('حالة المكتب أ');
      await ST.ensureWorkStatuses(b.office);                                                              // قاعدة أخرى برمز مختلف
      expect(K.getWorkConfig().customStatuses.length).toBe(0);
      await ST.ensureWorkStatuses(a.office);
      expect(K.getWorkConfig().customStatuses.length).toBe(1);
      // استعادة فوق الاتصال الحالي (databases.js) تعيد كتابة lookups بلا entity:changed، فيُطلق المستدعي db:restored.
      const payload = await exportDatabase(a.office.ctx);
      await ST.createCustomStatus(a.office, 'حالة أضيفت بعد النسخة');
      expect(K.getWorkConfig().customStatuses.length).toBe(2);
      await importDatabase(a.office.ctx, payload);
      expect(K.getWorkConfig().customStatuses.length).toBe(2);                                            // اللقطة قديمة قبل الإعلان
      events.emit('db:restored', {token: a.office.ctx.token}, false);
      await ST.ensureWorkStatuses(a.office);
      expect(K.getWorkConfig().customStatuses.map(x => x.label).join()).toBe('حالة المكتب أ');
    } finally { a.done(); b.done(); }
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
    expect(SCHEMA_VERSION).toBe(17); expect(SCHEMA_MIGRATIONS.at(-1).version).toBe(14); expect(SCHEMA_MIGRATIONS.some(m => m.version === 15)).toBe(true); expect(SCHEMA_MIGRATIONS.some(m => m.version === 16 && m.addsStores.includes('syncChanges'))).toBe(true); expect(SCHEMA_MIGRATIONS.some(m => m.version === 17 && m.addsStores.includes('executionPeriods') && !m.destructive && !m.backfill)).toBe(true);
    const plan = migrationPlan(13, 14);
    expect(plan.addsStores.join()).toBe('workItems,workItemComments,workItemRecurrences'); expect(plan.destructive).toBe(false); expect(migrationPlan(14, 14).steps.length).toBe(0);
    const execPlan = migrationPlan(14, 15);
    expect(execPlan.addsStores.join()).toBe('executionParties,executionValuePeriods,executionLedger,executionAllocations,executionReceipts,executionActions,executionPOAs,differenceRecords,executionSettlements,executionAdjustments,executionTemplates');
    expect(execPlan.destructive).toBe(false); expect(migrationPlan(15, 15).steps.length).toBe(0);
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
    expect(payload.schemaVersion).toBe(17); expect(Array.isArray(payload.stores.workItems)).toBe(true); expect(Array.isArray(payload.stores.executionLedger)).toBe(true); expect(Array.isArray(payload.stores.executionPeriods)).toBe(true);
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
  test('مركز العمل/إسقاط: أرشفة السجل الأصلي (لا حذفه) تُبقي العنصر «المصدر غير متاح حاليًا» وتحفظ طبقته', async () => {
    const {office, file} = await env();
    const src = await saveOperational(office, 'procedures', {fileId: file.id, description: 'عمل سيُؤرشف مصدره', internalDueDate: tomorrow, status: 'open'});
    const id = ref('procedures', src.id);
    await C.setPinned(office, id, true);
    await office.archive('procedures', src.id);
    const orphan = await Q.getWorkItem(office, id);
    expect(orphan.sourceAvailable).toBe(false); expect(orphan.isPinned).toBe(true);
    const pinned = await Q.queryWorkItems(office, {drive: 'pinned'}, {limit: 50});
    expect(idsOf(pinned.items).includes(id)).toBe(true);
    await office.restore('procedures', src.id);
    expect((await Q.getWorkItem(office, id)).sourceAvailable).toBe(true);
  });
  test('مركز العمل/صلاحيات: مقاعد المنشئ/المكلّف/الرؤية موجودة على المهام والتكرار ونقطة canActOn تسمح حاليًا', async () => {
    const {office} = await env();
    const row = await C.saveWorkItem(office, {title: 'مهمة صلاحيات', dueDate: today});
    expect(row.createdBy).toBe('user'); expect(row.assigneeId).toBe(null); expect(row.visibility).toBe('office');
    const def = await C.saveRecurrence(office, {title: 'تكرار صلاحيات', startDate: today, rule: {freq: 'weekly'}});
    expect(def.createdBy).toBe('user'); expect(def.visibility).toBe('office');
    expect(D.WORK_ROLES.join()).toBe('creator,assignee,editor,viewer'); expect(D.canActOn('delete', row, {id: 'x'})).toBe(true);
  });
  test('مركز العمل/واجهة: مساعدات البطاقة: «الخصم: X + N آخرين»، شارات الموعد، وكل الإشارات نصية (ليست لونًا فقط)', async () => {
    const card = await import('../ui/work-card.js');
    expect(card.partiesLine('الخصم', [{text: 'أحمد علي'}, {text: 'ب'}, {text: 'ج'}])).toBe('الخصم: أحمد علي + 2 آخرين');
    expect(card.partiesLine('الخصم', [{text: 'أحمد علي'}, {text: 'ب'}])).toBe('الخصم: أحمد علي + 1 آخر');
    expect(card.partiesLine('الخصم', [])).toBe('');
    const late = card.dueChip({dueDate: addDays(today, -3), isOpen: true}, today); expect(late.tone).toBe('danger'); expect(late.text.includes('متأخر')).toBe(true);
    expect(card.dueChip({dueDate: today, dueTime: '09:30', isOpen: true}, today).text).toBe('اليوم 09:30');
    expect(card.dueChip({dueDate: tomorrow, isOpen: true}, today).text).toBe('غدًا'); expect(card.dueChip({dueDate: '', isOpen: true}, today).text).toBe('بلا موعد');
    const {office, procedure} = await env();
    const item = await Q.getWorkItem(office, ref('procedures', procedure.id));
    const html = card.workCardHtml(item, {config: K.getWorkConfig(), today});
    expect(html.includes('data-wc-id="procedures::')).toBe(true);
    for (const p of D.DEFAULT_WORK_PRIORITIES) { const chip = card.priorityChip({priority: p.key}, K.getWorkConfig()); expect(chip.includes(p.label) && chip.includes(p.mark) && chip.includes(p.icon)).toBe(true); }
    expect(card.statusChip({status: 'inProgress', statusLabel: 'قيد التنفيذ'}, K.getWorkConfig()).includes('قيد التنفيذ')).toBe(true);
    expect(html.includes('aria-label=')).toBe(true); expect(html.includes('type="checkbox"')).toBe(true);
  });
  test('مركز العمل/واجهة: تجميع التاريخ وأقسام اليوم والآن/التالي صحيحة', async () => {
    const views = await import('../ui/work-views.js');
    const groups = views.groupByDate([{dueDate: '2026-01-01'}, {dueDate: '2026-01-01'}, {dueDate: '2026-01-02'}, {dueDate: ''}]);
    expect(groups.map(g => g.items.length).join()).toBe('2,1,1');
    expect([D.dayPartOf({dueDate: ''}), D.dayPartOf({dueDate: today, sourceType: 'hearings'}), D.dayPartOf({dueDate: today, dueTime: '09:00', sourceType: 'procedures'}), D.dayPartOf({dueDate: today, sourceType: 'communications'}), D.dayPartOf({dueDate: today, sourceType: 'procedures'})].join()).toBe('undated,hearings,morning,followups,admin');
    const items = [{isOpen: true, dueTime: '09:00', id: 'a'}, {isOpen: true, dueTime: '10:20', id: 'b'}, {isOpen: true, dueTime: '15:00', id: 'c'}, {isOpen: false, dueTime: '10:10', id: 'd'}];
    const nn = Q.nowAndNext(items, '10:10');
    expect(nn.now.map(i => i.id).join()).toBe('b'); expect(nn.next.id).toBe('c');            // 09:00 بدأ قبل أكثر من 60 دقيقة؛ 10:20 خلال 30 دقيقة القادمة
    const earlier = Q.nowAndNext(items, '09:30');
    expect(earlier.now.map(i => i.id).join()).toBe('a'); expect(earlier.next.id).toBe('b');
    expect(Q.nowAndNext([], '10:00').next).toBe(null);
  });
  test('مركز العمل/موفّر الجدول: DataGrid يستعلم بمؤشر ويطبّق بحث الأعمدة أثناء المرور ويعلن الفرز غير الزمني', async () => {
    const {office} = await env();
    const {createWorkGridProvider, workColumns} = await import('../ui/work-grid.js');
    const relations = createGridRelations(office, 'workItems');
    const rt = {office, relations, st: {range: 'custom', from: '', to: addDays(today, 60), pageSize: 25, filters: {}, q: ''}, items: new Map(), config: () => K.getWorkConfig(), spec: (extra = {}) => ({range: 'custom', from: '', to: addDays(today, 60), undated: true, ...extra}), register(i) { this.items.set(i.id, i); }};
    const provider = createWorkGridProvider(rt);
    const columns = workColumns(rt);
    const first = await provider.getRows({pagination: {size: 25}}, {columns});
    expect(first.rows.length).toBe(25); expect(first.hasMore).toBe(true); expect(Boolean(first.nextCursor)).toBe(true); expect(first.totalExact).toBe(false);
    const second = await provider.getRows({pagination: {size: 25, cursor: first.nextCursor}}, {columns});
    expect(second.rows.length > 0 && !second.rows.some(r => first.rows.some(x => x.id === r.id))).toBe(true);
    const filtered = await provider.getRows({search: {text: 'الخصم الثاني'}, pagination: {size: 25}}, {columns});
    expect(filtered.rows.length > 0 && filtered.rows.every(r => relations.items(r, 'opponent').some(o => o.text.includes('الخصم الثاني')) || (r.title + r.typeLabel).includes('الخصم الثاني'))).toBe(true);
    const sorted = await provider.getRows({sort: [{key: 'title', dir: 'asc'}], pagination: {size: 25}}, {columns});
    expect(sorted.sortStatus.global).toBe(false);
  });
  test('مركز العمل/تنظيف: إغلاق قاعدة الاختبار', async () => {
    const {db} = await env();
    db.close(); indexedDB.deleteDatabase(dbName);
    expect(localDate(new Date(2026, 0, 31))).toBe('2026-01-31');
  });
}
