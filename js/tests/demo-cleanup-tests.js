// =====================================================================
// اختبارات حذف البيانات التجريبية دفعة واحدة (services/demo-data.js)
// ---------------------------------------------------------------------
// تزرع قاعدة مؤقتة ببيانات تجريبية حقيقية عبر seedDemoData نفسها، ثم:
//   • تتحقق أن الفحص (قراءة فقط) يرى السجلات الموسومة والمرتبطة بها.
//   • تحذف الكل مرة واحدة وتتحقق أن كل مخازن المكتب خلت من أي سجل ظاهر،
//     وأن السجلات الحقيقية (غير التجريبية) بقيت سليمة تمامًا.
//   • تتحقق أن الحذف منطقي (tombsotne isDeleted) وأنه مسجَّل في سجل النشاط
//     (لا حذف في صمت)، وأن وسم الزرع التلقائي أُوقف.
//   • تتحقق أن الفحص لا يكتب أي شيء (لقطة قبل/بعد متطابقة).
// القاعدة مؤقتة وتُحذف بعد الاختبار.
// =====================================================================
import {upgradeSchema} from '../db/schema.js';
import {STORE, STORES} from '../db/schema.js';
import {Office} from '../services/office.js';
import {seedDemoData, DEMO_MARK} from '../services/demo-seed.js';
import {seedExecutionDemoFiles} from '../services/data-admin.js';
import {seedTaxonomy} from '../services/client-files.js';
import {seedLookups} from '../services/lookups.js';
import {saveEntity} from '../services/entity-save.js';
import {scanDemoData, removeDemoData, isDemoMarkedRow, hasDemoData, DEMO_DELETABLE_STORES} from '../services/demo-data.js';

const REAL_CLIENT = {fullName: 'موكل حقيقي — لا يُمس', phones: ['01000000000'], status: 'active', notes: 'سجل حقيقي دائم بلا أي وسم تجريبي.'};

async function openTemp(name) {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 18);
    request.onupgradeneeded = event => upgradeSchema(request.result, event.target.transaction);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return {db, office: new Office({db, assert() {}, token: 'demo-cleanup-test', profile: {id: 'demo-cleanup-test'}})};
}

/** عدد الصفوف الظاهرة (غير المحذوفة منطقيًا) في كل المخازن. */
async function visibleCounts(office) {
  const out = {};
  for (const store of STORES) {
    const rows = await office.r[store].all(20000).catch(() => []);
    out[store] = rows.filter(row => !row.isDeleted).length;
  }
  return out;
}

export async function runDemoCleanupTests(test, expect) {
  const name = `AhmadKhudairLawOfficeDB__test__demo_cleanup__${Date.now()}`;
  const {db, office} = await openTemp(name);
  let seedError = null;
  let beforeScan = null;
  let afterScan = null;
  let removed = null;
  let countsBefore = null;
  let countsAfter = null;
  let cleanupError = null;
  const snapshot = list => JSON.stringify(list.map(row => [row.id, row.isDeleted, row.updatedAt, row.version]).sort());

  // سجل حقيقي (بلا وسم) + سجل حقيقي مرتبط بملف حقيقي، لضمان أن الحذف لا يمسهما
  let real = null;
  let beforeRemoval = null;
  let afterRemoval = null;
  let afterRemoveState = null;
  try {
    await seedLookups(office);
    await seedTaxonomy(office);
    const report = await seedDemoData(office);
    if (!report?.files) throw Error('لم تُزرع بيانات تجريبية');
    real = await office.saveClient({...REAL_CLIENT});

    // 1) الفحص قراءة فقط ولا يكتب شيئًا
    const allBefore = {};
    for (const store of STORES) allBefore[store] = await office.r[store].all(5000).catch(() => []);
    beforeScan = await scanDemoData(office);
    const allAfterScan = {};
    for (const store of STORES) allAfterScan[store] = await office.r[store].all(5000).catch(() => []);
    let scanWrote = false;
    for (const store of STORES) if (snapshot(allBefore[store]) !== snapshot(allAfterScan[store])) scanWrote = true;
    beforeRemoval = {allBefore, scanWrote};

    countsBefore = await visibleCounts(office);
    removed = await removeDemoData(office, {reason: 'اختبار حذف البيانات التجريبية'});
    countsAfter = await visibleCounts(office);
    const allAfter = {};
    for (const store of STORES) allAfter[store] = await office.r[store].all(5000).catch(() => []);
    afterRemoval = {allAfter};
    afterScan = await scanDemoData(office);
    afterRemoveState = {
      seedMeta: await office.r.meta.get('demoSeed'),
      execMeta: await office.r.meta.get('executionDemoSeed'),
      familyMeta: await office.r.meta.get('executionFamilyDemo'),
      hasDemo: await hasDemoData(office),
      secondRun: await removeDemoData(office, {reason: 'تكرار'})
    };
  } catch (error) {
    seedError = error;
  }

  const rows = (bag, store) => (bag?.[store] || []).filter(row => !row.isDeleted);

  test('حذف تجريبي: الزرع والفحص والحذف تعمل بلا أخطاء', () => { if (seedError) throw Error(String(seedError?.stack || seedError)) });
  test('حذف تجريبي: الفحص يرى سجلات موسومة وسجلات مرتبطة بها', () => {
    if (!beforeScan) throw Error('لا نتيجة فحص');
    if (beforeScan.total < 100) throw Error('عدد السجلات التجريبية المتوقع أكبر: ' + beforeScan.total);
    if (beforeScan.marked < 50) throw Error('السجلات الموسومة قليلة: ' + beforeScan.marked);
    if (beforeScan.related < 40) throw Error('السجلات المرتبطة قليلة: ' + beforeScan.related);
    if (beforeScan.total !== beforeScan.marked + beforeScan.related) throw Error('مجموع الأعداد غير متسق');
    for (const store of ['files', 'clients', 'hearings', 'fees', 'fileClients']) {
      if (!beforeScan.byStore[store]?.total) throw Error('مخزن غير مشمول في الفحص: ' + store);
    }
  });
  test('حذف تجريبي: الفحص لا يكتب أي شيء (قراءة فقط)', () => {
    if (beforeRemoval.scanWrote) throw Error('الفحص غيّر صفوفًا في المخازن');
  });
  test('حذف تجريبي: الحذف يزيل كل سجل تجريبي ظاهر من كل مخازن السجلات', () => {
    if (!removed || !removed.removed) throw Error('لم يُحذف شيء');
    for (const store of DEMO_DELETABLE_STORES) {
      const expected = store === STORE.clients ? 1 : 0; // يبقى الموكل الحقيقي وحده
      if (countsAfter[store] !== expected) {
        throw Error(`بقي ${countsAfter[store]} سجلًا ظاهرًا في ${store} (المتوقع ${expected})`);
      }
    }
  });
  test('حذف تجريبي: السجل الحقيقي وبيانات المستخدم لا تُمس إطلاقًا', () => {
    const fresh = rows(afterRemoval.allAfter, STORE.clients);
    if (fresh.length !== 1) throw Error('عدد الموكلين الحقيقيين تغيّر: ' + fresh.length);
    if (fresh[0].id !== real.id) throw Error('تغيّر الموكل الحقيقي');
    if (fresh[0].fullName !== REAL_CLIENT.fullName) throw Error('تغيّر اسم الموكل الحقيقي');
    if (fresh[0].isDeleted) throw Error('حُذف السجل الحقيقي');
    if (fresh[0].notes !== REAL_CLIENT.notes) throw Error('تغيّرت ملاحظات السجل الحقيقي');
  });
  test('حذف تجريبي: الحذف منطقي (soft delete) والقوالب والقوائم والترقيم سليمة', () => {
    const allFiles = afterRemoval.allAfter[STORE.files] || [];
    if (!allFiles.length) throw Error('لا صفوف ملفات أصلًا');
    if (!allFiles.every(row => row.isDeleted === true)) throw Error('لم تُوسم كل الملفات بالحذف المنطقي');
    if (!allFiles.every(row => Boolean(row.deletedAt))) throw Error('سجل بلا تاريخ حذف');
    // القوائم والتصنيفات والقوالب لم تُمس (ليست بيانات تجريبية)
    if (!rows(afterRemoval.allAfter, STORE.lookups).length) throw Error('فُقدت القوائم');
    if (!rows(afterRemoval.allAfter, STORE.taxonomy).length) throw Error('فُقد التصنيف');
    const counters = rows(afterRemoval.allAfter, STORE.fileNumberCounters);
    if (!counters.length) throw Error('فُقد عدّاد ترقيم الملفات');
  });
  test('حذف تجريبي: المسح مسجَّل في سجل النشاط داخل المعاملة نفسها (لا حذف في صمت)', () => {
    const log = (afterRemoval.allAfter[STORE.activityLog] || []).find(row => row.action === 'remove_demo_data');
    if (!log) throw Error('لا يوجد صف في سجل النشاط');
    if (!String(log.summary || '').includes('حذف البيانات التجريبية')) throw Error('ملخص السجل غير واضح');
    if (Number(log.metadata?.total || 0) !== removed.removed) throw Error('عدد السجلات في السجل لا يطابق المنفَّذ');
    if (log.metadata?.stores?.clients === undefined) throw Error('لا أعداد لكل مخزن');
    // لا بيانات شخصية خام في السجل: لا أسماء ولا أرقام قومية
    const serialized = JSON.stringify(log.metadata);
    for (const banned of ['fullName', 'nationalId', 'phones', 'address']) if (serialized.includes(banned)) throw Error('سجل النشاط يحمل بيانات شخصية: ' + banned);
  });
  test('حذف تجريبي: بعد الحذف لا يرى الفحص أي سجل تجريبي', () => {
    if (!afterScan) throw Error('لا نتيجة فحص بعد الحذف');
    expect(afterScan.total).toBe(0);
  });
  test('حذف تجريبي: وسم الزرع التلقائي أُوقف فلا تعود البيانات من تلقاء نفسها', () => {
    const meta = afterRemoveState.seedMeta;
    if (!meta) throw Error('لا صف meta للزرع التجريبي');
    expect(meta.seeded).toBe(false);
    if (!meta.removedAt) throw Error('لا تاريخ للحذف في meta');
    if (afterRemoveState.execMeta) throw Error('لم يُعَد تسليح زرع التنفيذ التجريبي');
    if (afterRemoveState.familyMeta) throw Error('لم يُعَد تسليح مثال الأسرة التجريبي');
    expect(afterRemoveState.hasDemo).toBe(false);
  });
  test('حذف تجريبي: الحذف الثاني بلا عمل (لا شيء متبقٍ)', () => {
    expect(afterRemoveState.secondRun.removed).toBe(0);
  });
  test('حذف تجريبي: كاشف الوسم لا يخلط بين السجل الحقيقي والتجريبي', () => {
    expect(isDemoMarkedRow({title: `${DEMO_MARK} دعوى`})).toBe(true);
    expect(isDemoMarkedRow({notes: 'ملاحظة 〔تجريبي〕 داخل نص'})).toBe(true);
    expect(isDemoMarkedRow({isDemo: true})).toBe(true);
    expect(isDemoMarkedRow({demoTag: 'execution-demo-v1'})).toBe(true);
    expect(isDemoMarkedRow({tags: [{label: `ملف ${DEMO_MARK}`}]})).toBe(true);
    expect(isDemoMarkedRow({title: 'ملف حقيقي', notes: 'لا وسم'})).toBe(false);
    expect(isDemoMarkedRow(null)).toBe(false);
  });

  db.close();
  try { indexedDB.deleteDatabase(name); } catch { /* متجاهَل */ }

  // اختبارات مستقلة: زرع ملفات التنفيذ التجريبية وحذفها (مسار data-admin)
  const name2 = `AhmadKhudairLawOfficeDB__test__demo_cleanup_exec__${Date.now()}`;
  const execEnv = await openTemp(name2);
  let execRemoved = null;
  let execLeft = null;
  try {
    await seedLookups(execEnv.office);
    await seedTaxonomy(execEnv.office);
    await seedExecutionDemoFiles(execEnv.office);
    execRemoved = await removeDemoData(execEnv.office, {reason: 'اختبار'});
    execLeft = await visibleCounts(execEnv.office);
  } catch (error) {
    execRemoved = {error};
  }
  execEnv.db.close();
  try { indexedDB.deleteDatabase(name2); } catch { /* متجاهَل */ }

  test('حذف تجريبي: ملفات التنفيذ التجريبية وحدها تُحذف بلا بقايا', () => {
    if (execRemoved?.error) throw Error(String(execRemoved.error?.stack || execRemoved.error));
    if (!execRemoved?.removed) throw Error('لم يُحذف أي سجل تنفيذ تجريبي');
    for (const store of ['execution', 'executionLedger', 'executionReceipts', 'executionParties', 'executionValuePeriods', 'files', 'clients', 'judgments', 'workItems', 'hearings']) {
      if (execLeft[store] > 0) throw Error(`بقايا في ${store}: ${execLeft[store]}`);
    }
    if (execLeft[STORE.lookups] < 1) throw Error('فُقدت القوائم');
  });

  // موكل حقيقي داخل قاعدة فيها تنفيذ تجريبي: لا يُمس
  const name3 = `AhmadKhudairLawOfficeDB__test__demo_cleanup_mix__${Date.now()}`;
  const mixEnv = await openTemp(name3);
  let mixed = null;
  try {
    await seedLookups(mixEnv.office);
    await seedTaxonomy(mixEnv.office);
    await seedExecutionDemoFiles(mixEnv.office);
    const keep = await mixEnv.office.saveClient({...REAL_CLIENT});
    const task = await saveEntity(mixEnv.office, 'workItems', {kind: 'task', title: 'مهمة حقيقية', status: 'notStarted', dueDate: '2026-12-31', clientId: keep.id});
    // خصم حقيقي كتبه المستخدم قبل الزرع بساعة (غير مرتبط بأي سجل) — يجب أن يبقى
    const realOpponent = {id: 'REAL-OPP-1', name: 'خصم حقيقي قديم', opponentType: 'شخص طبيعي', notes: '', createdAt: new Date(Date.now() - 3600_000).toISOString(), updatedAt: new Date(Date.now() - 3600_000).toISOString(), version: 1, isDeleted: false};
    await mixEnv.office.r.opponents.put(realOpponent);
    await removeDemoData(mixEnv.office, {reason: 'اختبار'});
    mixed = {
      client: await mixEnv.office.r.clients.get(keep.id),
      task: await mixEnv.office.r.workItems.get(task.id),
      opponent: await mixEnv.office.r.opponents.get(realOpponent.id)
    };
  } catch (error) {
    mixed = {error};
  }
  mixEnv.db.close();
  try { indexedDB.deleteDatabase(name3); } catch { /* متجاهَل */ }

  test('حذف تجريبي: السجلات الحقيقية تبقى حتى مع وجود بيانات تجريبية (موكل · مهمة · خصم قديم)', () => {
    if (mixed?.error) throw Error(String(mixed.error?.stack || mixed.error));
    if (!mixed?.client || mixed.client.isDeleted) throw Error('حُذف الموكل الحقيقي');
    if (!mixed?.task || mixed.task.isDeleted) throw Error('حُذفت المهمة الحقيقية');
    if (!mixed?.opponent || mixed.opponent.isDeleted) throw Error('حُذف الخصم الحقيقي القديم (خارج نافذة الزرع)');
  });
}
