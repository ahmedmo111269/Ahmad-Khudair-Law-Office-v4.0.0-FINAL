// ============================================================
// اختبارات «الانتباه» في موجة 3: مؤشر التوكيلات في ملخص اليوم، والتراجع عن
// الحذف المنطقي من شاشة السجل. الحذف في هذا البرنامج علَم (isDeleted) لا
// مسح صفوف، فالتراجع يجب أن يكون دقيقًا: لا يستورد سجلًا جديدًا، ولا يرفع
// الإصدار بلا سبب، ولا يلمس من لم يُحذف.
// ============================================================
import {dashboardBrief} from '../services/dashboard.js';
import {deleteEntity, restoreEntity} from '../services/entity-save.js';
import {upgradeSchema, STORE} from '../db/schema.js';
import {DatabaseContext} from '../db/database-context.js';
import {Office} from '../services/office.js';
import {localDate, addDays} from '../core/clock.js';

function openDb(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 18);
    request.onupgradeneeded = event => upgradeSchema(request.result, event.target.transaction);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function runAttentionTests(test, expect) {
  const name = `AhmadKhudairLawOfficeDB__test__attention__${Date.now()}`;
  const out = {setupError: ''};
  const db = await openDb(name);
  const ctx = new DatabaseContext(db, {id: 'att1', databaseName: name, displayName: 'انتباه'}, {deviceId: 'test-device'});
  const office = new Office(ctx);
  try {
    const today = localDate();
    const client = await office.saveClient({fullName: 'موكل التوكيلات', nationalId: '29000000000111', phones: ['01000000000']});

    const poa = async (number, expiry) => {
      const id = `poa-${number}`;
      await new Promise((resolve, reject) => {
        const tx = ctx.rawDb.transaction(STORE.powersOfAttorney, 'readwrite');
        tx.objectStore(STORE.powersOfAttorney).put({id, clientId: client.id, poaNumber: number, expiryDate: expiry, status: 'active', createdAt: today, updatedAt: today, version: 1, isDeleted: false});
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
      });
      return id;
    };
    await poa('SOON', addDays(today, 10));
    await poa('EXPIRED', addDays(today, -5));
    await poa('FAR', addDays(today, 200));
    await poa('NONE', '');

    const brief = await dashboardBrief(office);
    out.expiring = brief.expiringPoa.map(row => row.poaNumber).sort();
    out.expired = brief.expiredPoa.map(row => row.poaNumber).sort();
    out.clientNameOnExpiring = brief.expiringPoa[0]?.clientName;

    // ===== التراجع عن الحذف المنطقي =====
    await new Promise((resolve, reject) => {
      const tx = ctx.rawDb.transaction(STORE.appointments, 'readwrite');
      tx.objectStore(STORE.appointments).put({id: 'appt-1', clientId: client.id, title: 'موعد للمحاكمة', date: today, time: '10:00', status: 'scheduled', createdAt: today, updatedAt: today, version: 1, isDeleted: false});
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
    const before = await office.r.appointments.get('appt-1');
    await deleteEntity(office, 'appointments', 'appt-1');
    const afterDelete = await office.r.appointments.getManyRaw(['appt-1']);
    out.deletedFlag = Boolean(afterDelete[0]?.isDeleted);
    out.deletedAtSet = Boolean(afterDelete[0]?.deletedAt);

    const restored = await restoreEntity(office, 'appointments', 'appt-1');
    out.restoredFlag = Boolean(restored.isDeleted);
    out.versionBumped = Number(restored.version) === Number(before.version) + 2; // الحذف رفعه واحدًا والتراجع واحدًا
    out.titleKept = restored.title === 'موعد للمحاكمة';
    out.activityLogged = (await office.r.activityLog.byIndex('entityId', 'appt-1', 20)).some(row => row.action === 'restore');

    // التراجع الثاني على سجل حي: لا كتابة ولا رفع إصدار
    const again = await restoreEntity(office, 'appointments', 'appt-1');
    out.noopVersionSame = Number(again.version) === Number(restored.version);

    // البحث/القائمة لا ترى المحذوف وتراه بعد التراجع
    out.listBeforeDelete = (await office.r.appointments.byIndex('clientId', client.id, 50)).length;
    await deleteEntity(office, 'appointments', 'appt-1');
    out.listAfterDelete = (await office.r.appointments.byIndex('clientId', client.id, 50)).length;
    await restoreEntity(office, 'appointments', 'appt-1');
    out.listAfterRestore = (await office.r.appointments.byIndex('clientId', client.id, 50)).length;

    // سجل غير موجود: خطأ واضح لا صمت
    out.missingError = await restoreEntity(office, 'appointments', 'nope-1').then(() => '', error => error?.code || 'error');
  } catch (error) {
    out.setupError = String(error?.stack || error?.message || error);
  } finally {
    ctx.close();
    try { indexedDB.deleteDatabase(name); } catch { /* بيئة بلا صلاحية */ }
  }

  test('إعداد مجموعة الانتباه نجح بلا خطأ', () => expect(out.setupError).toBe(''));
  test('ملخص اليوم: توكيل خلال ٣٠ يومًا يُرى، والبعيد لا يُرى', () => {
    expect(JSON.stringify(out.expiring)).toBe(JSON.stringify(['SOON']));
    expect(JSON.stringify(out.expired)).toBe(JSON.stringify(['EXPIRED']));
  });
  test('اسم الموكل يُرفق بالبطاقة مباشرة (بلا نقرة إضافية)', () => {
    expect(out.clientNameOnExpiring).toBe('موكل التوكيلات');
  });
  test('الحذف المنطقي يضع العلَم والتاريخ (سلوك قائم لا ينكسر)', () => {
    expect(out.deletedFlag).toBe(true);
    expect(out.deletedAtSet).toBe(true);
  });
  test('التراجع يعيد السجل كما كان ويرفع الإصدار مرة واحدة ويسجّل في النشاط', () => {
    expect(out.restoredFlag).toBe(false);
    expect(out.versionBumped).toBe(true);
    expect(out.titleKept).toBe(true);
    expect(out.activityLogged).toBe(true);
  });
  test('التراجع عن سجل حي عملية عديمة الأثر (لا كتابة ولا إصدار جديد)', () => {
    expect(out.noopVersionSame).toBe(true);
  });
  test('القائمة المفهرسة تخفي المحذوف وتُظهر المتراجَع عنه', () => {
    expect(out.listBeforeDelete).toBe(1);
    expect(out.listAfterDelete).toBe(0);
    expect(out.listAfterRestore).toBe(1);
  });
  test('سجل غير موجود: خطأ مُصنَّف لا صمت', () => {
    expect(out.missingError).toBe('DB_NOT_FOUND');
  });
}
