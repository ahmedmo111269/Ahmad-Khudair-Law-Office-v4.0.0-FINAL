// =====================================================================
// اختبارات واجهة قسم التنفيذ المبسّط — مسارات المستخدم الفعلية.
// ---------------------------------------------------------------------
// كل اختبار يقود الواجهة الحقيقية (نفس النوافذ والشبكة والبطاقة) على قاعدة
// IndexedDB وهمية، ويعدّ النقرات ويتحقق من الأرقام بعد كل خطوة:
//   S1 تنفيذ جديد · S2 تحصيل · S3 إجراء · S5 احسب مدة · S7 توكيل · S8 إلغاء/تراجع.
// =====================================================================
import {upgradeSchema} from '../db/schema.js';
import {SCHEMA_VERSION} from '../core/constants.js';
import {Office} from '../services/office.js';
import {prefs} from '../core/preferences.js';
import * as S from '../services/execution-simple.js';
import * as CENTER from '../modules/execution-center.js';
import * as FORMS from '../ui/execution-simple-forms.js';
import {modal, modalOpensOnTop, closeModal, closeAllModals, stackedModal, confirmBox} from '../ui/modal.js';

const nativeFormDataWorks = () => {
  try {
    const node = document.createElement('form');
    node.innerHTML = '<input name="a" value="1">';
    return [...new FormData(node).entries()].length === 1;
  } catch { return false; }
};

/** بيئة DOM وهمية لا تملأ FormData من النموذج (linkedom) → نضيف طبقة متوافقة للاختبار فقط. */
function ensureFormDataShim() {
  if (nativeFormDataWorks()) return false;
  const Native = globalThis.FormData;
  globalThis.FormData = class extends Native {
    constructor(form) {
      super();
      if (form && typeof form.querySelectorAll === 'function') {
        for (const el of form.querySelectorAll('[name]')) {
          if (el.tagName === 'SELECT') {
            const picked = [...(el.options || [])].filter(option => option.hasAttribute('selected'));
            this.append(el.name, picked.length ? picked[0].value : (el.options?.[0]?.value ?? ''));
            continue;
          }
          if (el.type === 'checkbox' || el.type === 'radio') {
            if (el.checked) this.append(el.name, el.value || 'on');
            continue;
          }
          this.append(el.name, el.value ?? '');
        }
      }
    }
  };
  return true;
}

async function openDb(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, SCHEMA_VERSION);
    request.onupgradeneeded = event => upgradeSchema(request.result, event.target.transaction);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function env() {
  const name = `AhmadKhudairLawOfficeDB__test__execution-ui__${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const db = await openDb(name);
  const office = new Office({db, assert() {}, token: 'exec-ui-test', profile: {id: 'tester'}});
  await prefs.init().catch(() => null);
  const client = await office.saveClient({fullName: 'منى عبدالسلام الشاذلي'});
  const created = await S.createSimpleExecution(office, {
    clientId: client.id, opponentName: 'محمود فاروق الحلواني', executionType: 'family',
    entitlementType: 'نفقة شهرية', valueType: 'periodic', periodicity: 'monthly', amount: 3000,
    effectiveFrom: '2025-01-01', entitlementTo: '2025-12-31', judgmentNumber: '101/2025',
    judgmentDate: '2025-01-10', court: 'محكمة الأسرة بالمنصورة', officialNumber: '1200/2025',
    entitlementThroughDate: '2025-12-31'
  });
  // حكم لاحق: 4,000 شهريًا من 01/07/2025 (نفس سيناريو الأرقام الذهبية).
  await S.recordSubsequentJudgment(office, {
    executionId: created.execution.id, entitlementType: 'نفقة شهرية', amount: 4000,
    effectiveFrom: '2025-07-01', effectiveTo: '2025-12-31', judgmentNumber: '550/2025',
    judgmentDate: '2025-07-20', court: 'استئناف الأسرة'
  });
  return {db, office, name, client, execution: created.execution};
}
const closeEnv = e => { try { e.db.close(); indexedDB.deleteDatabase(e.name); } catch {} };

/** تطبيق مصغّر يسجل التوجيه والتحديث كما يفعل التطبيق الحقيقي. */
function fakeApp(office) {
  const calls = [];
  return {
    office, calls,
    go(route) { calls.push(['go', route]); return Promise.resolve(); },
    refresh() { calls.push(['refresh']); return Promise.resolve(); },
    fail(error) { throw error; },
    __execCenter: null, __execSimple: {}
  };
}

const main = () => document.querySelector('#main-content');
const modalRoot = () => document.querySelector('#modal-root');
/** مجموعات اختبار أخرى تعيد بناء body؛ نضمن وجود الحاويتين قبل تركيب الواجهة. */
function ensureHosts() {
  if (!main()) { const host = document.createElement('section'); host.id = 'main-content'; document.body.append(host); }
  if (!modalRoot()) { const host = document.createElement('div'); host.id = 'modal-root'; document.body.append(host); }
}
const click = node => node.dispatchEvent(new Event('click', {bubbles: true, cancelable: true}));
const submit = form => form.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
/** اختيار قيمة داخل <select> بطريقة تعمل في المتصفح وفي linkedom معًا. */
const pick = (select, value) => {
  const option = [...(select.options || [])].find(item => item.value === value);
  if (option) option.setAttribute('selected', 'selected'); else select.value = value;
  return select;
};
const cleanup = () => { if (main()) main().innerHTML = ''; if (modalRoot()) modalRoot().innerHTML = ''; };

export async function runExecutionUiTests(test, expect) {
  const shimmed = ensureFormDataShim();
  ensureHosts();
  const backup = {main: main()?.innerHTML || '', modal: modalRoot()?.innerHTML || ''};

  test('واجهة — مركز التنفيذ: عدّادات قابلة للنقر وشبكة مركّبة بلا أخطاء', async () => {
    const e = await env();
    try {
      const app = fakeApp(e.office);
      ensureHosts();
      main().innerHTML = CENTER.executionCenterPage(app);
      await CENTER.bindExecutionCenter(app);
      await wait(200);
      const counters = main().querySelectorAll('[data-count]');
      expect(counters.length).toBe(4);
      click(counters[1]);
      await wait(150);
      expect(main().querySelectorAll('[data-count]')[1].classList.contains('is-active')).toBe(true);
      expect(main().querySelector('#exec-grid')?.children.length > 0).toBe(true);
      const row = [...main().querySelectorAll('.dg-click')].find(node => node.textContent.includes('منى'));
      expect(Boolean(row)).toBe(true);
      expect(row.textContent.includes('42,000')).toBe(true);
      expect(row.textContent.includes('محمود')).toBe(true);
    } finally { cleanup(); closeEnv(e); }
  });

  test('واجهة — البطاقة: ثلاثة أرقام + أربعة تبويبات والتبديل بينها', async () => {
    const e = await env();
    try {
      const app = fakeApp(e.office);
      await S.recordSimpleCollection(e.office, {executionId: e.execution.id, amount: 9000, date: '2025-04-10'});
      ensureHosts();
      main().innerHTML = await CENTER.executionDetailPage(app, e.execution.id);
      await CENTER.bindExecutionDetail(app, e.execution.id);
      expect(main().querySelectorAll('[data-tab]').length).toBe(4);
      const numbers = main().querySelector('.exec-numbers');
      expect(numbers.textContent.includes('33,000')).toBe(true);
      expect(numbers.textContent.includes('42,000')).toBe(true);
      expect(numbers.textContent.includes('9,000')).toBe(true);
      click(main().querySelector('[data-tab="log"]'));
      expect(main().querySelector('[data-log-list]').children.length >= 3).toBe(true);
      click(main().querySelector('[data-tab="poa"]'));
      expect(Boolean(main().querySelector('[data-statement-mode]'))).toBe(true);
      click(main().querySelector('[data-tab="data"]'));
      expect(Boolean(main().querySelector('.advanced-anchor'))).toBe(true);
      click(main().querySelector('[data-tab="account"]'));
      expect(main().querySelectorAll('.account-table tbody tr').length).toBe(12);
    } finally { cleanup(); closeEnv(e); }
  });

  test('S2 — تسجيل تحصيل بالمبلغ فقط: نقرات محدودة + محضر جديد + تحديث البطاقة', async () => {
    const e = await env();
    try {
      const app = fakeApp(e.office);
      const before = (await e.office.r.executionReceipts.byIndex('executionId', e.execution.id, 100)).length;
      let clicks = 0;
      ensureHosts();
      const card = await FORMS.simpleCollectionDialog(app, e.execution.id);
      clicks += 1; // فتح ورقة التسجيل ثم نموذج التحصيل
      const form = card.querySelector('[data-form="collection"]');
      form.querySelector('[name="amount"]').value = '3000';
      submit(form);
      await wait(200);
      const after = await e.office.r.executionReceipts.byIndex('executionId', e.execution.id, 100);
      expect(after.length).toBe(before + 1);
      expect(Number(after.at(-1).amount)).toBe(3000);
      expect(after.at(-1).date).toBe(localToday());
      expect(app.calls.some(call => call[0] === 'refresh')).toBe(true);
      expect(clicks <= 5).toBe(true);
      expect(Boolean(document.querySelector('#toast-stack .toast'))).toBe(true);
    } finally { cleanup(); closeEnv(e); }
  });

  test('S3 — تسجيل إجراء بالنوع والتاريخ فقط (حد أقصى 5 نقرات)', async () => {
    const e = await env();
    try {
      const app = fakeApp(e.office);
      ensureHosts();
      const card = await FORMS.simpleActionDialog(app, e.execution.id);
      const form = card.querySelector('[data-form="action"]');
      form.querySelector('[name="kind"]').value = 'notice';
      form.querySelector('[name="date"]').value = '2025-05-12';
      submit(form);
      await wait(150);
      const rows = await e.office.r.executionActions.byIndex('executionId', e.execution.id, 100);
      expect(rows.length).toBe(1);
      expect(rows[0].kind).toBe('notice');
      expect(rows[0].referenceNumber).toBe('');
      expect(app.calls.some(call => call[0] === 'refresh')).toBe(true);
    } finally { cleanup(); closeEnv(e); }
  });

  test('S5 — احسب مدة: اختصار واحد ثم حساب يعرض المستحق والمدفوع والمتبقي والرصيد السابق', async () => {
    const e = await env();
    try {
      const app = fakeApp(e.office);
      await S.recordSimpleCollection(e.office, {executionId: e.execution.id, amount: 9000, date: '2025-04-10'});
      ensureHosts();
      const card = await FORMS.durationDialog(app, e.execution.id, {lockExecution: true, fromDate: '2025-04-01', toDate: '2025-09-30'});
      const form = card.querySelector('[data-form="duration"]');
      submit(form);
      await wait(200);
      const result = form.querySelector('[data-result]').textContent.replace(/\s+/g, ' ');
      const rows = form.querySelectorAll('.mini-table tbody tr');
      expect(rows.length).toBe(6);
      // المستحق عن المدة (3×3,000 أبريل–يونيو + 3×4,000 يوليو–سبتمبر) = 21,000، والتحصيل خُصّص على يناير–مارس فلا رصيد سابق.
      expect(result.includes('21,000')).toBe(true);
      expect(result.includes('0.00')).toBe(true);
      expect(form.querySelector('[data-result]').textContent.split('21,000').length - 1 >= 2).toBe(true);
      expect(form.querySelector('[data-copy]').hidden).toBe(false);
      expect(form.querySelector('[data-poa]').hidden).toBe(false);
    } finally { cleanup(); closeEnv(e); }
  });

  test('S7 — التوكيل: رصيد سابق + فترة + إجمالي، وإصداره لا يغيّر المتبقي', async () => {
    const e = await env();
    try {
      const app = fakeApp(e.office);
      await S.recordSimpleCollection(e.office, {executionId: e.execution.id, amount: 9000, date: '2025-04-10'});
      const before = (await S.simpleCardBundle(e.office, e.execution.id, {asOf: '2025-12-31'})).schedule.totals.remainingMinor;
      ensureHosts();
      const card = await FORMS.simplePoaDialog(app, e.execution.id, {fromDate: '2025-07-01', toDate: '2025-12-31'});
      const form = card.querySelector('[data-form="poa"]');
      submit(form);
      await wait(250);
      const poas = await e.office.r.executionPOAs.byIndex('executionId', e.execution.id, 100);
      expect(poas.length).toBe(1);
      const after = (await S.simpleCardBundle(e.office, e.execution.id, {asOf: '2025-12-31'})).schedule.totals.remainingMinor;
      expect(after).toBe(before);
      // فترة التوكيل (6×4,000 = 24,000) + رصيد سابق غير مسدد (أبريل–يونيو 3×3,000 = 9,000) = 33,000
      expect(Number(poas[0].total)).toBe(33_000);
    } finally { cleanup(); closeEnv(e); }
  });

  test('S8 — إلغاء سجل بسبب من صفه ثم التراجع يعيد الحالة بلا حذف', async () => {
    const e = await env();
    try {
      const receipt = await S.recordSimpleCollection(e.office, {executionId: e.execution.id, amount: 3000, date: '2025-04-10'});
      await S.voidSimpleRecord(e.office, {kind: 'receipt', id: receipt.receipt.id, reason: 'قيد مزدوج'});
      const voided = await e.office.r.executionReceipts.get(receipt.receipt.id);
      expect(voided.status).toBe('voided');
      await S.undoVoidSimpleRecord(e.office, {kind: 'receipt', id: receipt.receipt.id});
      const restored = await e.office.r.executionReceipts.get(receipt.receipt.id);
      expect(restored.status).toBe('posted');
      const rows = await e.office.r.executionReceipts.byIndex('executionId', e.execution.id, 100);
      expect(rows.length).toBe(1);
    } finally { cleanup(); closeEnv(e); }
  });

  test('ورقة التسجيل: 6 أيقونات، والنموذج يُفتح فوقها فترجع إليها بعد الحفظ (لا شيء يمنع التسجيل)', async () => {
    const e = await env();
    try {
      const app = fakeApp(e.office);
      ensureHosts();
      main().innerHTML = await CENTER.executionDetailPage(app, e.execution.id);
      await CENTER.bindExecutionDetail(app, e.execution.id);
      // 1) الضغط على «+ تسجيل» يفتح الورقة السادسية
      click(main().querySelector('[data-record]'));
      await wait(80);
      const sheet = modalRoot().querySelector('.modal-card');
      expect(Boolean(sheet)).toBe(true);
      expect(modalRoot().querySelectorAll('.record-tile').length).toBe(6);
      expect(sheet.textContent.includes('المطلوب')).toBe(true);
      // 2) اختيار «تحصيل» يفتح النموذج فوق الورقة (نافذتان) لا بدلًا منها
      click(modalRoot().querySelector('.record-tile[data-record="collection"]'));
      await wait(300);
      expect(modalRoot().querySelectorAll('.modal-card').length).toBe(2);
      expect(modalRoot().querySelectorAll('.modal-backdrop.is-stacked').length).toBe(1);
      // 3) الحفظ يعود إلى الورقة (نافذة واحدة) ويُحدِّث أرقامها
      const form = modalRoot().querySelector('[data-form="collection"]');
      form.querySelector('[name="amount"]').value = '1000';
      submit(form);
      await wait(400);
      expect(modalRoot().querySelectorAll('.modal-card').length).toBe(1);
      expect(modalRoot().querySelector('.record-tile')).not.toBeUndefined?.();
      expect(Boolean(modalRoot().querySelector('[data-sheet-numbers]'))).toBe(true);
      const sheetNumbers = modalRoot().querySelector('[data-sheet-numbers]').textContent;
      expect(sheetNumbers.includes('42,000')).toBe(true);   // المطلوب (الأفق 31/12/2025)
      expect(sheetNumbers.includes('1,000')).toBe(true);    // المدفوع بعد التحصيل الجديد
      // 4) الإغلاق ينظّف الجذر كاملًا (لا نوافذ معلّقة تحجب الواجهة)
      closeModal();
      expect(modalRoot().querySelectorAll('.modal-card').length).toBe(0);
      expect(modalRoot().innerHTML).toBe('');
    } finally { cleanup(); closeEnv(e); }
  });

  test('النوافذ المكدَّسة: الإغلاق يعود للنافذة السفلى ولا يمسح كل شيء', async () => {
    ensureHosts();
    try {
      modal('<p>سفلى</p>');
      modalOpensOnTop();
      modal('<p>عليا</p>');
      expect(modalRoot().querySelectorAll('.modal-card').length).toBe(2);
      expect(modalRoot().querySelectorAll('.modal-backdrop.is-stacked').length).toBe(1);
      closeModal();
      expect(modalRoot().querySelectorAll('.modal-card').length).toBe(1);
      expect(modalRoot().textContent.includes('سفلى')).toBe(true);
      closeModal();
      expect(modalRoot().querySelectorAll('.modal-card').length).toBe(0);
      // بلا مكدَّس: الإغلاق يمسح الجذر (منع بقايا تحجب النقر)
      modal('<p>واحدة</p>');
      closeModal();
      expect(modalRoot().innerHTML).toBe('');
    } finally { cleanup(); }
  });

  test('صف السجل لا يفتح «الإلغاء» عند النقر عليه — زر الإلغاء وحده يفعل', async () => {
    const e = await env();
    try {
      const app = fakeApp(e.office);
      await S.recordSimpleCollection(e.office, {executionId: e.execution.id, amount: 3000, date: '2025-04-10'});
      ensureHosts();
      main().innerHTML = await CENTER.executionDetailPage(app, e.execution.id);
      await CENTER.bindExecutionDetail(app, e.execution.id);
      click(main().querySelector('[data-tab="log"]'));
      const row = main().querySelector('[data-log-item]');
      expect(Boolean(row)).toBe(true);
      expect(row.hasAttribute('data-void')).toBe(false);
      expect(row.hasAttribute('data-voided')).toBe(true);
      click(row);
      await wait(120);
      expect(modalRoot().querySelectorAll('.modal-card').length).toBe(0);   // لا نافذة تأكيد من نقرة الصف
      expect(modalRoot().textContent.includes('إلغاء هذا السجل')).toBe(false);
    } finally { cleanup(); closeEnv(e); }
  });

  test('نافذة التوكيل تعرض قاعدة منع الازدواج وأرقام المعادلة قبل الحفظ', async () => {
    const e = await env();
    try {
      const app = fakeApp(e.office);
      ensureHosts();
      const card = await FORMS.simplePoaDialog(app, e.execution.id, {fromDate: '2025-07-01', toDate: '2025-12-31'});
      expect(card.querySelectorAll('[data-no-double-count]').length).toBe(1);
      const preview = card.querySelector('[data-preview]').textContent.replace(/\s+/g, ' ');
      expect(preview.length > 10).toBe(true);
      expect(/[\d,]+/.test(preview)).toBe(true);
      const before = (await S.simpleCardBundle(e.office, e.execution.id, {asOf: '2025-12-31'})).schedule.totals.remainingMinor;
      const save = card.querySelector('[data-save]');
      submit(card.querySelector('[data-form="poa"]'));
      await wait(400);
      const after = (await S.simpleCardBundle(e.office, e.execution.id, {asOf: '2025-12-31'})).schedule.totals.remainingMinor;
      expect(after).toBe(before);           // إصدار التوكيل لا يغيّر المتبقي
      expect(Boolean(save)).toBe(true);
    } finally { cleanup(); closeEnv(e); }
  });

  test('أفق الاستحقاق: لا فترات بعد «تاريخ الاستحقاق حتى»، وتحصيل بعده يظل مخسومًا من المتبقي', async () => {
    const e = await env();
    try {
      const base = await S.simpleCardBundle(e.office, e.execution.id, {asOf: '2026-10-04'});
      expect(base.schedule.rows.length).toBe(12);
      expect(base.schedule.rows.at(-1).toDate).toBe('2025-12-31');
      expect(base.schedule.totals.dueMinor).toBe(4_200_000);
      const before = base.schedule.totals.remainingMinor;
      await S.recordSimpleCollection(e.office, {executionId: e.execution.id, amount: 5000, date: '2026-05-01'});
      const after = await S.simpleCardBundle(e.office, e.execution.id, {asOf: '2026-10-04'});
      expect(after.schedule.rows.length).toBe(12);                 // بلا فترة جديدة بعد الأفق
      expect(after.schedule.rows.at(-1).toDate).toBe('2025-12-31');
      expect(after.schedule.totals.remainingMinor).toBe(before - 500_000);  // التحصيل المتأخر يظل مخسومًا
      expect(after.schedule.totals.dueMinor).toBe(4_200_000);
    } finally { cleanup(); closeEnv(e); }
  });

  test('S1 — تنفيذ جديد من شاشة واحدة: 4 مدخلات إلزامية ثم يُبنى الجدول ويُفتح التنفيذ', async () => {
    const e = await env();
    try {
      const app = fakeApp(e.office);
      ensureHosts();
      const before = (await e.office.r.execution.page({index: 'openedDate', direction: 'prev', limit: 100})).items.length;
      const card = await FORMS.newExecutionDialog(app, {});
      const form = card.querySelector('[data-form="new-execution"]');
      // الإلزامي فقط: الموكل + المبلغ + النوع + تاريخ السريان
      pick(form.querySelector('[name="clientId"]'), e.client.id);
      form.querySelector('[name="amount"]').value = '2500';
      form.querySelector('[name="effectiveFrom"]').value = '2025-03-01';
      submit(form);
      await wait(300);
      const rows = (await e.office.r.execution.page({index: 'openedDate', direction: 'prev', limit: 100})).items;
      expect(rows.length).toBe(before + 1);
      const created = rows.find(row => row.id !== e.execution.id);
      const bundle = await S.simpleCardBundle(e.office, created.id, {asOf: '2025-12-31'});
      expect(bundle.schedule.rows.length).toBe(10);          // من مارس إلى ديسمبر 2025 بلا أي خطوة إضافية
      expect(bundle.schedule.totals.dueMinor).toBe(2_500_00 * 10);
      expect(app.calls.some(call => call[0] === 'go' && String(call[1]).startsWith('exc:'))).toBe(true);
    } finally { cleanup(); closeEnv(e); }
  });

  test('S6 — حكم لاحق: معاينة حية ثم تخفيض يتطلب تأكيدًا صريحًا', async () => {
    const e = await env();
    try {
      const app = fakeApp(e.office);
      ensureHosts();
      const card = await FORMS.subsequentJudgmentDialog(app, e.execution.id, {});
      const form = card.querySelector('[data-form="later-judgment"]');
      form.querySelector('[name="amount"]').value = '2000';        // تخفيض عن 3,000
      form.querySelector('[name="effectiveFrom"]').value = '2025-10-01';
      form.dispatchEvent(new Event('input', {bubbles: true}));
      await wait(300);
      const previewText = form.querySelector('[data-preview]').textContent.replace(/\s+/g, ' ');
      expect(previewText.includes('الأثر شهرًا بشهر')).toBe(true);
      expect(form.querySelector('[data-confirm-line]').hidden).toBe(false);
      submit(form);
      await wait(250);
      const judgmentsAfterRejection = await e.office.r.judgments.byIndex('executionId', e.execution.id, 100);
      expect(judgmentsAfterRejection.length).toBe(2);              // حُفظ الحكم الأصلي + الحكم اللاحق الأول فقط
      // الآن مع التأكيد الصريح
      form.querySelector('[name="confirmedDecrease"]').checked = true;
      submit(form);
      await wait(300);
      const judgments = await e.office.r.judgments.byIndex('executionId', e.execution.id, 100);
      expect(judgments.length).toBe(3);
      const bundle = await S.simpleCardBundle(e.office, e.execution.id, {asOf: '2025-12-31'});
      expect(bundle.schedule.totals.dueMinor).toBe((3_000 * 6 + 4_000 * 3 + 2_000 * 3) * 100);
    } finally { cleanup(); closeEnv(e); }
  });

  // عقد السلامة مع بقية التطبيق: confirmBox بسلوكه القديم يحلّ محل النافذة المفتوحة
  // وينظّف الجذر بالكامل بعده. كسره سابقًا جعل نافذة الإعدادات تبقى مفتوحة فتحجب
  // النقر في مركز العمل — لذلك يُثبَّت هنا صراحةً.
  test('confirmBox فوق نافذة مفتوحة: يحلّ محلها وينظّف الجذر (لا طبقة عالقة تحجب النقر)', async () => {
    ensureModalRoot();
    try {
      const settings = modal('<h2 class="modal-title">إعدادات تجريبية</h2><button type="button" data-close>إغلاق</button>');
      expect(Boolean(settings)).toBe(true);
      expect(document.querySelectorAll('#modal-root .modal-backdrop').length).toBe(1);
      const answer = confirmBox('تأكيد فوق نافذة؟', {okText: 'نعم'});
      await wait(60);
      expect(document.querySelectorAll('#modal-root .modal-backdrop').length).toBe(1); // حلّ محلها ولا طبقتين
      const ok = document.querySelector('#modal-root [data-ok]');
      expect(Boolean(ok)).toBe(true);
      ok.click();
      expect(await answer).toBe(true);
      await wait(60);
      expect(document.querySelectorAll('#modal-root .modal-backdrop').length).toBe(0); // لا شيء يبقى ليحجب النقر
      expect(document.querySelectorAll('#modal-root .modal-card').length).toBe(0);
    } finally { closeAllModals(); }
  });

  test('النوافذ المكدَّسة تُقلَّم طبقةً طبقة، و«إغلاق» على نافذة غير مكدَّسة يمسح كل شيء كما كان', async () => {
    ensureModalRoot();
    try {
      const sheet = modal('<h2 class="modal-title">الورقة</h2>');
      expect(Boolean(sheet)).toBe(true);
      const form = stackedModal('<h2 class="modal-title">النموذج</h2>');
      expect(Boolean(form)).toBe(true);
      expect(document.querySelectorAll('#modal-root .modal-backdrop').length).toBe(2);
      closeModal();
      expect(document.querySelectorAll('#modal-root .modal-backdrop').length).toBe(1);
      expect(document.querySelector('#modal-root .modal-card .modal-title').textContent.trim()).toBe('الورقة');
      closeModal();
      expect(document.querySelectorAll('#modal-root .modal-backdrop').length).toBe(0);
    } finally { closeAllModals(); }
  });

  void shimmed;
  if (main()) main().innerHTML = backup.main;
  if (modalRoot()) modalRoot().innerHTML = backup.modal;
}

// جذر النوافذ موجود في التطبيق وtests.html؛ نُنشئه للفحوص التي تعمل في Node فقط.
function ensureModalRoot() {
  let root = document.querySelector('#modal-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'modal-root';
    document.body.append(root);
  }
  return root;
}

// تاريخ اليوم بالتنسيق المدني نفسه المستخدم في التطبيق (بلا منطقة زمنية).
function localToday() {
  const now = new Date();
  const pad = value => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
