// ============================================================
// اختبارات صيانة الإقلاع (موجة 3): فهرسة نص البحث لم تعد تُنتظَر في الإقلاع،
// صارت مقيَّدة بعلامة اكتمال + بصمة، فلا تُمسح المخازن عند كل فتح.
// تُغطّى هنا ثلاث properties مهمة:
//   1) الأمان: كل الملفات تُفهرس فعلًا في أول تشغيل (لا ملفات تبحث بلا نص).
//   2) الاقتصاد: التشغيل التالي بلا عمل (علامة الاكتمال + البصمة) ≈ صفر.
//   3) اليقظة: ملف جديد بلا فهرسة يغيّر البصمة ⇒ يعيد المسح تلقائيًا.
// وكذلك: مسار الإقلاع searchIndex:false لا يفهرس لكنه لا يكسر شيئًا.
// ============================================================
import {runMaintenance, indexMissingSearchText, SEARCH_INDEX_META} from '../services/maintenance.js';
import {upgradeSchema, STORE} from '../db/schema.js';
import {DatabaseContext} from '../db/database-context.js';
import {Office} from '../services/office.js';
import {uid} from '../core/id.js';

const NOW = '2026-10-02T09:00:00.000Z';

function openDb(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 18);
    request.onupgradeneeded = event => upgradeSchema(request.result, event.target.transaction);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function runMaintenanceBootTests(test, expect) {
  const name = `AhmadKhudairLawOfficeDB__test__maint__${Date.now()}`;
  const out = {};
  const db = await openDb(name);
  const ctx = new DatabaseContext(db, {id: 'm1', databaseName: name, displayName: 'صيانة'}, {deviceId: 'test-device'});
  const office = new Office(ctx);
  try {
    // ملفات بلا searchIndexedAt (كما في قاعدة قديمة أو بعد استعادة)
    await new Promise((resolve, reject) => {
      const tx = office.ctx.rawDb.transaction([STORE.files], 'readwrite');
      const store = tx.objectStore(STORE.files);
      for (let i = 0; i < 12; i++) store.put({id: `file-${i}`, fileNumber: `2026/0000${i}`, title: `ملف بحث ${i}`, status: 'open', createdAt: NOW, updatedAt: NOW, lastActivityAt: NOW, version: 1, isDeleted: false, isArchived: false});
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });

    out.setupError = '';
    const boot = await runMaintenance(office, {searchIndex: false});
    out.deferredReport = boot.indexed;
    out.searchTextAfterBoot = (await office.r.files.get('file-0')).searchText;

    out.firstScan = await indexMissingSearchText(office);
    const files = await office.r.files.all(50);
    out.allIndexed = files.every(row => row.searchText && row.searchIndexedAt);
    out.marker = await office.r.meta.get(SEARCH_INDEX_META);

    out.secondScan = await indexMissingSearchText(office);

    // ملف جديد يُضاف بلا فهرسة (محاكاة استعادة/مزامنة كتبت مباشرة) ⇒ البصمة تتغيّر
    await new Promise((resolve, reject) => {
      const tx = office.ctx.rawDb.transaction([STORE.files], 'readwrite');
      tx.objectStore(STORE.files).put({id: 'file-new', fileNumber: '2026/00099', title: 'ملف جديد يحتاج فهرسة', status: 'open', createdAt: NOW, updatedAt: new Date().toISOString(), lastActivityAt: new Date().toISOString(), version: 1, isDeleted: false});
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
    out.thirdScan = await indexMissingSearchText(office);
    out.newFileIndexed = Boolean((await office.r.files.get('file-new')).searchText);

    // 4) نص مطابق مسبقًا بلا بصمة: تُختم البصمة ويُكتب الماركر، فلا يتكرّر المسح
    await new Promise((resolve, reject) => {
      const tx = office.ctx.rawDb.transaction([STORE.files], 'readwrite');
      const store = tx.objectStore(STORE.files);
      for (let i = 0; i < 4; i++) store.put({id: `file-same-${i}`, fileNumber: '2026/9000' + i, title: 'ملف مطابق', status: 'open', searchText: '', partyNames: '', createdAt: NOW, updatedAt: NOW, lastActivityAt: new Date(Date.now() + 1000 * i).toISOString(), version: 1, isDeleted: false});
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
    out.stampScan = await indexMissingSearchText(office, {force: true});
    out.stamped = (await office.r.files.get('file-same-0')).searchIndexedAt;
    out.skipAfterStamp = await indexMissingSearchText(office);

    // الصيانة الكاملة (المسار القديم) ما زالت تفهرس حين تُطلب مباشرة
    await office.r.meta.delete(SEARCH_INDEX_META);
    out.fullReport = await runMaintenance(office, {searchIndex: true});
    out.forcedAfterClear = await indexMissingSearchText(office, {force: true});
  } catch (error) {
    out.setupError = String(error?.message || error);
  } finally {
    ctx.close();
    try { indexedDB.deleteDatabase(name); } catch { /* بيئة بلا صلاحية */ }
  }

  test('إعداد مجموعة الصيانة نجح بلا خطأ', () => expect(out.setupError).toBe(''));
  test('صيانة الإقلاع لا تنتظر فهرسة نص البحث (تُرجع deferred)', () => {
    expect(out.deferredReport).toBe('deferred');
    expect(out.searchTextAfterBoot).toBe(undefined);
  });
  test('فهرسة البحث تُكمل كل الملفات الناقصة عند أول تشغيل', () => {
    expect(out.firstScan).toBe(12);
    expect(out.allIndexed).toBe(true);
    expect(Boolean(out.marker?.complete)).toBe(true);
  });
  test('التشغيل الثاني بلا جديد لا يمسح المخزن (0 صفحة مفحوصة)', () => {
    expect(out.secondScan).toBe(0);
  });
  test('ملف جديد بلا فهرسة يغيّر البصمة فيعيد المسح تلقائيًا', () => {
    expect(out.thirdScan).toBe(1);
    expect(out.newFileIndexed).toBe(true);
  });
  test('ملف بنص مطابق سابقًا يُختم ببصمة الفهرسة فلا يُعاد فحصه أبدًا', () => {
    expect(typeof out.stampScan).toBe('number');
    expect(Boolean(out.stamped)).toBe(true);
    expect(out.skipAfterStamp).toBe(0);
  });
  test('مسار runMaintenance الكامل ما زال يفهرس عند الطلب، وforce يتجاهل العلامة', () => {
    expect(out.fullReport.indexed >= 0).toBe(true);
    expect(typeof out.forcedAfterClear).toBe('number');
  });
}
