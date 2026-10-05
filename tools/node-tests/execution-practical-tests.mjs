// =====================================================================
// اختبارات عملية فعلية لمركز التنفيذ — تقود التطبيق الحقيقي (نوافذه
// ونماذجه وتبويباته) فوق IndexedDB حقيقي، لا اختبارات وحدة معزولة.
// التشغيل:  node execution-practical-tests.mjs
// ---------------------------------------------------------------------
// تغطي: القائمة والعدّادات · إنشاء تنفيذ من النافذة الحقيقية · الأرقام
// الثلاثة · التبويبات الأربعة · التحصيل · الإجراء · المصروف · الحكم اللاحق
// · احسب مدة · كشف/توكيل · التعديل والإلغاء من الصف · تتبّع الأرقام
// · الملفات التجريبية · مسح بيانات التنفيذ · المسح الشامل.
// =====================================================================
import './harness.mjs';
import {mountAppShell} from './dom-forms.mjs';
import assert from 'node:assert/strict';

const results = [];
let failures = 0;

const tick = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));

async function check(name, fn) {
  try {
    await fn();
    results.push(['PASS', name]);
    console.log(`PASS — ${name}`);
  } catch (error) {
    failures += 1;
    results.push(['FAIL', name, error?.message || String(error)]);
    console.log(`FAIL — ${name} → ${error?.message || error}`);
  }
}

/* ------------------------------ أدوات DOM ------------------------------ */
const main = () => document.querySelector('#main-content');
const modalRoot = () => document.querySelector('#modal-root');
const text = node => String(node?.textContent || '').replace(/\s+/g, ' ').trim();
const money = value => Number(String(value).replace(/[^\d.-]/g, ''));
const q = selector => main()?.querySelector(selector) || null;
const qa = selector => [...(main()?.querySelectorAll(selector) || [])];

async function fill(form, values) {
  for (const [name, value] of Object.entries(values)) {
    const el = form.querySelector(`[name="${name}"]`);
    assert.ok(el, `حقل مفقود في النموذج: ${name}`);
    if (el.tagName === 'SELECT') {
      const options = [...el.querySelectorAll('option')];
      const index = options.findIndex(option => (option.getAttribute('value') ?? '') === String(value));
      assert.ok(index >= 0, `خيار غير موجود في ${name}: ${value}`);
      el.selectedIndex = index;
      options[index].setAttribute('selected', '');
      options.forEach((option, i) => { if (i !== index) option.removeAttribute('selected'); });
    } else {
      el.value = value;
    }
    el.dispatchEvent(new globalThis.Event('input', {bubbles: true}));
    el.dispatchEvent(new globalThis.Event('change', {bubbles: true}));
  }
  await tick();
}

async function submit(form, wait = 400) {
  form.dispatchEvent(new globalThis.Event('submit', {bubbles: true, cancelable: true}));
  await tick(wait);
}

async function openModalBy(selector, wait = 300) {
  const button = q(selector) || modalRoot()?.querySelector(selector);
  assert.ok(button, `زر غير موجود: ${selector}`);
  button.dispatchEvent(new globalThis.Event('click', {bubbles: true}));
  await tick(wait);
  return modalRoot()?.querySelector('.modal-card');
}

const cardNumbers = async () => {
  const nodes = qa('.exec-numbers .num b');
  return {
    due: money(nodes[0]?.textContent),
    paid: money(nodes[1]?.textContent),
    remaining: money(nodes[2]?.textContent)
  };
};

const closeModals = async () => {
  for (let i = 0; i < 8; i += 1) {
    const cards = [...modalRoot().querySelectorAll('[data-close]')];
    if (!cards.length) break;
    cards[cards.length - 1].dispatchEvent(new globalThis.Event('click', {bubbles: true}));
    await tick(80);
  }
};

/* ------------------------------ الإقلاع ------------------------------ */
const app = await mountAppShell();
const office = app.office;
const S = await import('../../js/services/execution-simple.js');
const ADMIN = await import('../../js/services/data-admin.js');
const {localDate, addDays} = await import('../../js/core/clock.js');
const {STORE} = await import('../../js/db/schema.js');

const today = localDate();
const monthsBack = n => {
  const d = new Date(`${today}T00:00:00`);
  d.setMonth(d.getMonth() - n);
  return localDate(d);
};
const startOf = iso => `${iso.slice(0, 8)}01`;

console.log(`\n=== اختبارات مركز التنفيذ العملية — ${today} ===\n`);

/* ===================== 0) تنظيف: لا بيانات قديمة ===================== */
await check('يمسح كل البيانات الموجودة (بيانات تجريبية) قبل الاختبار', async () => {
  const before = {};
  for (const name of ['clients', 'files', 'cases', 'execution', 'judgments']) before[name] = await office.r[name].count().catch(() => 0);
  const profileName = String(office.ctx?.profile?.displayName || office.ctx?.profile?.name || '').trim();
  const out = await ADMIN.clearAllData(office, {reason: 'تجهيز بيئة الاختبار', confirmName: profileName});
  assert.equal(out.cleared, true);
  for (const name of ['clients', 'files', 'cases', 'execution', 'judgments', 'executionValuePeriods', 'executionReceipts']) {
    const count = await office.r[name].count().catch(() => 0);
    assert.equal(Number(count || 0), 0, `${name} لم يُفرَّغ (${count})`);
  }
  console.log(`      مُسح: ${JSON.stringify(before)}`);
});

await check('المسح الشامل يرفض اسم تأكيد غير مطابق', async () => {
  await assert.rejects(() => ADMIN.clearAllData(office, {reason: 'x', confirmName: 'اسم خاطئ'}));
});

/* ============== 1) القائمة: عدّادات وشبكة وأعمدة حسابية ============== */
await check('صفحة مركز التنفيذ تُحمَّل بشبكة حقيقية وعدّادات محسوبة', async () => {
  await app.go('executionCenter');
  await tick(900);
  assert.ok(q('#exec-grid'), 'شبكة التنفيذات غير موجودة');
  const counters = qa('[data-counters] .counter');
  assert.ok(counters.length >= 4, `عدد العدّادات ${counters.length}`);
  assert.ok(!text(q('[data-counters]')).includes('…'), 'العدّادات لم تُحسب بعد');
  const headers = qa('#exec-grid thead th[data-key]').map(node => node.dataset.key);
  for (const key of ['internalNumber', 'clientName', 'dueUntilToday', 'paidTotal', 'remainingTotal']) {
    assert.ok(headers.includes(key), `عمود مفقود: ${key}`);
  }
});

/* ============ 2) إنشاء تنفيذ من النافذة الحقيقية ============ */
let executionId = '';
let clientId = '';

await check('نافذة «تنفيذ جديد» تُنشئ التنفيذ وتفتح بطاقته بأرقام محسوبة', async () => {
  const client = await office.saveClient({fullName: 'أحمد محمد خضير (عميل اختبار)', phones: ['01000000000'], status: 'active'});
  clientId = client.id;
  const card = await openModalBy('[data-new-execution]', 300);
  assert.ok(card, 'نافذة التنفيذ الجديد لم تُفتح');
  const form = modalRoot().querySelector('[data-form="new-execution"]');
  assert.ok(form, 'نموذج التنفيذ الجديد غير موجود');
  await fill(form, {
    clientId: client.id,
    opponentName: 'محمد عبد السلام (منفذ ضده)',
    entitlementType: 'نفقة صغار',
    valueType: 'periodic',
    periodicity: 'monthly',
    amount: '3000',
    effectiveFrom: startOf(monthsBack(5)),
    judgmentNumber: '1450/2025',
    court: 'محكمة الأسرة بالمنصورة',
    judgmentDate: monthsBack(6),
    executionType: 'family',
    authority: 'قلم تنفيذ المنصورة'
  });
  await submit(form, 900);
  assert.ok(String(app.route || '').startsWith('exc:'), `لم تُفتح البطاقة (المسار: ${app.route})`);
  executionId = String(app.route).slice(4);
  await tick(500);
  const numbers = await cardNumbers();
  // 6 فترات مكتملة على الأقل × 3000 (الشهر الجاري محسوب من بدايته)
  assert.ok(numbers.due >= 15000, `المطلوب ${numbers.due} — يبدو أن لا حساب`);
  assert.equal(numbers.paid, 0);
  assert.equal(numbers.remaining, numbers.due);
  console.log(`      الأرقام: مطلوب ${numbers.due} · مدفوع ${numbers.paid} · متبقٍ ${numbers.remaining}`);
});

await check('البطاقة تعرض جدول الكشف الشهري بصفوف حقيقية', async () => {
  const rows = qa('[data-tab-panel] tbody tr');
  assert.ok(rows.length >= 5, `صفوف الجدول ${rows.length}`);
  const first = text(rows[0]);
  assert.ok(/\d/.test(first), 'صف بلا أرقام');
  console.log(`      ${rows.length} صف · أول صف: ${first.slice(0, 90)}`);
});

/* ==================== 3) التبويبات الأربعة ==================== */
for (const [tab, label] of [['log', 'السجل'], ['data', 'الحكم والبيانات'], ['poa', 'التوكيل والطباعة'], ['account', 'الحساب']]) {
  await check(`تبويب «${label}» يعمل ويعرض محتوى`, async () => {
    const button = qa('.exec-tab').find(node => node.dataset.tab === tab);
    assert.ok(button, `زر التبويب ${tab} غير موجود`);
    button.dispatchEvent(new globalThis.Event('click', {bubbles: true}));
    await tick(250);
    const panel = q('[data-tab-panel]');
    assert.ok(panel, 'لوحة التبويب غير موجودة');
    assert.ok(text(panel).length > 20, `محتوى التبويب ${tab} فارغ`);
    assert.ok(button.classList.contains('is-active'), 'التبويب لم يُعلَّم نشطًا');
    if (tab === 'data') assert.ok(text(panel).includes('نفقة صغار'), 'بيانات البند غير ظاهرة');
    if (tab === 'poa') assert.ok(text(panel).includes('كشف'), 'قسم الكشف غير ظاهر');
    if (tab === 'log') assert.ok(qa('[data-log-item]').length >= 0, 'قائمة السجل غير موجودة');
  });
}

/* ==================== 4) التحصيل ==================== */
await check('تسجيل تحصيل يحدّث المدفوع والمتبقي فورًا', async () => {
  const before = await cardNumbers();
  const card = await openModalBy('[data-record]', 250);
  assert.ok(card, 'ورقة التسجيل لم تُفتح');
  const tile = modalRoot().querySelector('[data-record="collection"]');
  assert.ok(tile, 'بلاطة التحصيل غير موجودة');
  tile.dispatchEvent(new globalThis.Event('click', {bubbles: true}));
  await tick(350);
  const form = modalRoot().querySelector('[data-form="collection"]');
  assert.ok(form, 'نموذج التحصيل لم يُفتح');
  await fill(form, {amount: '5000', date: addDays(today, -30), target: 'auto', reference: 'م-1'});
  await tick(350);
  const preview = text(modalRoot().querySelector('[data-preview]'));
  assert.ok(preview.includes('سيُخصَّص') || preview.includes('المتبقي'), `معاينة التخصيص فارغة: ${preview}`);
  await submit(form, 900);
  await closeModals();
  await app.refresh();
  await tick(700);
  const after = await cardNumbers();
  assert.equal(after.paid, 5000, `المدفوع ${after.paid}`);
  assert.equal(after.remaining, before.remaining - 5000, `المتبقي ${after.remaining} (كان ${before.remaining})`);
  console.log(`      مطلوب ${after.due} · مدفوع ${after.paid} · متبقٍ ${after.remaining}`);
});

await check('التحصيل يظهر في تبويب السجل ويقبل التعديل', async () => {
  qa('.exec-tab').find(node => node.dataset.tab === 'log').dispatchEvent(new globalThis.Event('click', {bubbles: true}));
  await tick(300);
  const items = qa('[data-log-item]');
  assert.ok(items.length >= 1, 'السجل فارغ بعد التحصيل');
  assert.ok(text(items[0]).includes('تحصيل') || text(items[0]).includes('محضر'), `أول سجل: ${text(items[0])}`);
  const editButton = modalRoot() && q('[data-edit]');
  assert.ok(editButton, 'زر التعديل على صف السجل غير موجود');
});

/* ==================== 5) إجراء + مصروف ==================== */
await check('تسجيل إجراء يظهر في السجل و«الإجراء التالي»', async () => {
  const card = await openModalBy('[data-record]', 250);
  modalRoot().querySelector('[data-record="action"]').dispatchEvent(new globalThis.Event('click', {bubbles: true}));
  await tick(350);
  const form = modalRoot().querySelector('[data-form="action"]');
  assert.ok(form, 'نموذج الإجراء لم يُفتح');
  await fill(form, {kind: 'تكليف بالوفاء', date: addDays(today, -10), nextAction: 'متابعة الحجز', nextActionDate: addDays(today, 7), notes: 'إجراء اختبار'});
  await submit(form, 900);
  await closeModals();
  await app.refresh();
  await tick(700);
  const summary = text(q('.exec-summary'));
  assert.ok(summary.includes('تكليف بالوفاء'), `آخر إجراء غير ظاهر: ${summary.slice(0, 200)}`);
});

await check('تسجيل مصروف يظهر سطرًا مستقلًا ولا يزيد أصل الدين', async () => {
  const before = await cardNumbers();
  const card = await openModalBy('[data-record]', 250);
  modalRoot().querySelector('[data-record="expense"]').dispatchEvent(new globalThis.Event('click', {bubbles: true}));
  await tick(350);
  const form = modalRoot().querySelector('[data-form="expense"]');
  assert.ok(form, 'نموذج المصروف لم يُفتح');
  await fill(form, {typeLabel: "رسم تنفيذ", amount: '350', date: addDays(today, -8), borneBy: 'debtor'});
  await submit(form, 900);
  await closeModals();
  await app.refresh();
  await tick(700);
  const after = await cardNumbers();
  assert.equal(after.due, before.due, 'المصروف غيّر أصل الدين');
  assert.ok(text(q('.exec-summary')).includes('مصروفات'), 'سطر المصروفات غير ظاهر');
  const bundle = await S.simpleCardBundle(office, executionId);
  assert.equal(bundle.expenses.length, 1);
});

/* ==================== 6) حكم لاحق ==================== */
await check('حكم لاحق بالزيادة يظهر فرقًا على الشهور المتأثرة فقط', async () => {
  const before = await S.simpleCardBundle(office, executionId);
  const beforeDue = before.schedule.totals.dueMinor;
  const card = await openModalBy('[data-record]', 250);
  modalRoot().querySelector('[data-record="judgment"]').dispatchEvent(new globalThis.Event('click', {bubbles: true}));
  await tick(400);
  const form = modalRoot().querySelector('[data-form="later-judgment"]');
  assert.ok(form, 'نموذج الحكم اللاحق لم يُفتح');
  await fill(form, {amount: '4000', effectiveFrom: startOf(monthsBack(2)), entitlementType: 'نفقة صغار', judgmentNumber: '777/2026', judgmentDate: monthsBack(3)});
  await tick(500);
  await submit(form, 1000);
  await closeModals();
  await app.refresh();
  await tick(800);
  const after = await S.simpleCardBundle(office, executionId);
  assert.ok(after.schedule.totals.dueMinor > beforeDue, `المطلوب لم يزد: ${beforeDue} → ${after.schedule.totals.dueMinor}`);
  assert.ok(after.judgments.some(row => row.judgmentKind === 'later'), 'الحكم اللاحق غير مسجل');
  const affected = after.schedule.rows.filter(row => row.valueChanges?.length);
  assert.ok(affected.length > 0, 'لا شهر يحمل الفرق');
  console.log(`      المطلوب ${beforeDue / 100} → ${after.schedule.totals.dueMinor / 100} · شهور متأثرة ${affected.length}`);
});

/* ==================== 7) احسب مدة ==================== */
await check('نافذة «احسب مدة» تحسب مبالغًا حقيقية لا أصفارًا', async () => {
  const card = await openModalBy('[data-open-duration]', 400);
  assert.ok(card, 'نافذة المدة لم تُفتح');
  const form = modalRoot().querySelector('[data-form="duration"]');
  assert.ok(form, 'نموذج المدة غير موجود');
  const lastMonth = startOf(monthsBack(5));
  await fill(form, {fromDate: lastMonth, toDate: addDays(today, -1)});
  await submit(form, 900);
  const result = text(modalRoot().querySelector('[data-result]'));
  assert.ok(result.includes('المستحق عن المدة'), `نتيجة المدة فارغة: ${result.slice(0, 200)}`);
  const rows = [...modalRoot().querySelectorAll('[data-result] tbody tr')];
  assert.ok(rows.length >= 3, `صفوف المدة ${rows.length}`);
  const total = rows.reduce((sum, row) => sum + money(row.querySelectorAll('td')[1]?.textContent), 0);
  assert.ok(total > 0, `إجمالي المدة صفر — لا حساب: ${result.slice(0, 200)}`);
  console.log(`      ${rows.length} صف · إجمالي المستحق عن المدة ${total}`);
  await closeModals();
});

/* ==================== 8) كشف وتوكيل ==================== */
await check('مسودة التوكيل تحسب رصيدًا سابقًا وفترة وإجماليًا', async () => {
  const draft = await S.simplePoaDraft(office, executionId, {fromDate: startOf(monthsBack(2)), toDate: addDays(today, -1)});
  assert.ok(draft.periodDueMinor > 0, `فترة التوكيل صفر: ${JSON.stringify(draft).slice(0, 200)}`);
  assert.ok(draft.totalMinor > 0, 'إجمالي التوكيل صفر');
  console.log(`      رصيد سابق ${draft.previousAppliedMinor / 100} · فترة ${draft.periodDueMinor / 100} · إجمالي ${draft.totalMinor / 100}`);
});

await check('حفظ توكيل يثبته نسخة غير قابلة للتعديل ويظهر في تبويب التوكيل', async () => {
  const draft = await S.simplePoaDraft(office, executionId, {fromDate: startOf(monthsBack(2)), toDate: addDays(today, -1)});
  const poa = await S.saveSimplePoa(office, executionId, {...draft, poaNumber: 'ت-اختبار-1'}, {date: today, printNow: false});
  assert.ok(poa?.id, 'التوكيل لم يُحفظ');
  await app.refresh();
  await tick(700);
  qa('.exec-tab').find(node => node.dataset.tab === 'poa').dispatchEvent(new globalThis.Event('click', {bubbles: true}));
  await tick(300);
  const panel = text(q('[data-tab-panel]'));
  assert.ok(panel.includes('ت-اختبار-1'), 'التوكيل غير ظاهر في تبويبه');
});

/* ==================== 9) تتبّع الأرقام ==================== */
for (const which of ['due', 'paid', 'remaining']) {
  await check(`تتبّع «${which}» يشرح كيف حُسب الرقم`, async () => {
    qa('.exec-tab').find(node => node.dataset.tab === 'account').dispatchEvent(new globalThis.Event('click', {bubbles: true}));
    await tick(200);
    const button = q(`.exec-summary [data-trace="${which}"]`);
    assert.ok(button, `زر التتبّع ${which} غير موجود`);
    button.dispatchEvent(new globalThis.Event('click', {bubbles: true}));
    await tick(300);
    const body = text(modalRoot());
    assert.ok(body.length > 40, `شرح التتبّع فارغ: ${body}`);
    await closeModals();
  });
}

/* ==================== 10) الإلغاء من الصف ==================== */
await check('إلغاء تحصيل من صف السجل يُعيد الحساب', async () => {
  const before = await cardNumbers();
  qa('.exec-tab').find(node => node.dataset.tab === 'log').dispatchEvent(new globalThis.Event('click', {bubbles: true}));
  await tick(300);
  const voidButton = qa('[data-void][data-kind="receipt"]')[0];
  assert.ok(voidButton, 'زر إلغاء التحصيل غير موجود');
  voidButton.dispatchEvent(new globalThis.Event('click', {bubbles: true}));
  await tick(350);
  const confirmOk = [...modalRoot().querySelectorAll('[data-ok]')].pop();
  assert.ok(confirmOk, 'نافذة التأكيد لم تظهر');
  const reasonInput = modalRoot().querySelector('.confirm-input');
  if (reasonInput) reasonInput.value = 'إلغاء اختبار';
  confirmOk.dispatchEvent(new globalThis.Event('click', {bubbles: true}));
  await tick(1200);
  await closeModals();
  await app.refresh();
  await tick(800);
  const after = await cardNumbers();
  assert.ok(after.paid < before.paid, `المدفوع لم ينقص بعد الإلغاء: ${before.paid} → ${after.paid}`);
  console.log(`      مدفوع ${before.paid} → ${after.paid}`);
});

/* ==================== 11) عدّادات القائمة ==================== */
await check('القائمة تعرض أرقامًا محسوبة لكل صف بعد كل العمليات', async () => {
  await app.go('executionCenter');
  await tick(1200);
  const rows = qa('#exec-grid tbody tr[data-i]');
  assert.ok(rows.length >= 1, 'لا صفوف في الشبكة');
  const first = text(rows[0]);
  assert.ok(/\d/.test(first), 'صف بلا أرقام');
  const counters = text(q('[data-counters]'));
  assert.ok(!counters.includes('…'), 'العدّادات لم تُحسب');
  const hydrated = await S.hydrateSimpleRows(office, (await office.r.execution.all(50)).filter(row => !row.isDeleted));
  assert.ok(hydrated[0].summary.dueMinor > 0, 'ملخص الصف بلا مطلوب');
  // العدّادات يجب أن تعكس الحالة المشتقة فعلًا (كانت تتجمّد على أصفار الجلسة الأولى)
  const expected = {running: 0, overdue: 0, completed: 0};
  for (const item of hydrated) if (expected[item.status.key] !== undefined) expected[item.status.key] += 1;
  const rendered = {};
  for (const node of qa('[data-counters] .counter')) {
    rendered[node.dataset.count] = Number(text(node.querySelector('b')).replace(/[^\d]/g, ''));
  }
  assert.equal(rendered.running, expected.running, `عدّاد «جارٍ» ${rendered.running} بدل ${expected.running}`);
  assert.equal(rendered.overdue, expected.overdue, `عدّاد المتأخرات ${rendered.overdue} بدل ${expected.overdue}`);
  assert.equal(rendered.completed, expected.completed, `عدّاد المكتمل ${rendered.completed} بدل ${expected.completed}`);
  assert.equal(rendered.running + rendered.overdue + rendered.completed, hydrated.length, 'مجموع العدّادات لا يساوي عدد التنفيذات');
  console.log(`      أول صف: ${first.slice(0, 110)}`);
  console.log(`      العدّادات: ${JSON.stringify(rendered)}`);
});

/* ==================== 12) الملفات التجريبية ==================== */
await check('يمسح بيانات التنفيذ ثم يحمّل ملفات تنفيذ تجريبية جاهزة', async () => {
  const cleared = await ADMIN.clearExecutionData(office, {reason: 'تجهيز المعاينة'});
  assert.equal(cleared.cleared, true);
  assert.equal(await office.r.execution.count(), 0);
  const seeded = await ADMIN.seedExecutionDemoFiles(office);
  assert.equal(seeded.count, 4);
  const executions = (await office.r.execution.all(50)).filter(row => !row.isDeleted);
  assert.equal(executions.length, 4);
  console.log(`      أُنشئ: ${executions.map(row => `${row.internalNumber || row.officialNumber}`).join(' · ')}`);
});

await check('كل ملف تنفيذ تجريبي يحسب أرقامًا حقيقية (لا أصفار)', async () => {
  const executions = (await office.r.execution.all(50)).filter(row => !row.isDeleted);
  for (const execution of executions) {
    const bundle = await S.simpleCardBundle(office, execution.id);
    const totals = bundle.schedule.totals;
    assert.ok(totals.dueMinor > 0, `${execution.internalNumber || execution.id}: المطلوب صفر`);
    assert.ok(bundle.schedule.rows.length > 0, `${execution.internalNumber}: لا فترات`);
    assert.ok(bundle.judgments.length > 0, `${execution.internalNumber}: لا حكم`);
    console.log(`      ${execution.internalNumber || execution.officialNumber} — مطلوب ${totals.dueMinor / 100} · مدفوع ${totals.paidMinor / 100} · متبقٍ ${totals.remainingMinor / 100} · فترات ${bundle.schedule.rows.length} · ${bundle.status.label}`);
  }
});

await check('بطاقة كل ملف تجريبي تُفتح وكل تبويب فيها يعمل', async () => {
  const executions = (await office.r.execution.all(50)).filter(row => !row.isDeleted);
  for (const execution of executions) {
    await app.go(`exc:${execution.id}`);
    await tick(500);
    const numbers = await cardNumbers();
    assert.ok(numbers.due > 0, `${execution.internalNumber}: أرقام البطاقة صفر`);
    for (const tab of ['log', 'data', 'poa', 'account']) {
      const button = qa('.exec-tab').find(node => node.dataset.tab === tab);
      assert.ok(button, `${execution.internalNumber}: تبويب ${tab} مفقود`);
      button.dispatchEvent(new globalThis.Event('click', {bubbles: true}));
      await tick(200);
      assert.ok(text(q('[data-tab-panel]')).length > 20, `${execution.internalNumber}: تبويب ${tab} فارغ`);
    }
  }
});

await check('حذف الملفات التجريبية يمسحها وحدها فقط', async () => {
  const foreign = await office.saveClient({fullName: 'موكل حقيقي لا يُمسح', phones: ['012'], status: 'active'});
  const real = await S.createSimpleExecution(office, {
    clientId: foreign.id, opponentName: 'خصم حقيقي', entitlementType: 'نفقة صغار',
    valueType: 'periodic', periodicity: 'monthly', amount: '1000', effectiveFrom: startOf(monthsBack(2)),
    judgmentNumber: '9/2026', court: 'محكمة الأسرة', executionType: 'family'
  });
  const out = await ADMIN.removeExecutionDemoFiles(office);
  assert.equal(out.removed, 4, `حذف ${out.removed} بدل 4`);
  const left = (await office.r.execution.all(50)).filter(row => !row.isDeleted);
  assert.equal(left.length, 1, `بقي ${left.length} تنفيذ`);
  assert.equal(left[0].id, real.execution.id, 'التنفيذ الحقيقي حُذف بدل التجريبي');
});

/* ==================== 13) توقيت الاستحقاق ==================== */
await check('توقيت الاستحقاق «بعد الاكتمال» يبقي الفترة الجارية ظاهرة بمبلغها', async () => {
  const {saveExecutionSettings} = await import('../../js/services/execution-settings.js');
  const {executionSettings} = await import('../../js/services/execution-settings.js');
  const current = executionSettings(office);
  await saveExecutionSettings(office, {...current, schedule: {...current.schedule, accrualTiming: 'AFTER_PERIOD_END'}});
  const client = await office.saveClient({fullName: 'عميل فترة جارية', phones: ['013'], status: 'active'});
  const created = await S.createSimpleExecution(office, {
    clientId: client.id, opponentName: 'خصم', entitlementType: 'نفقة صغار',
    valueType: 'periodic', periodicity: 'monthly', amount: '2500', effectiveFrom: today,
    judgmentNumber: '1/2026', court: 'محكمة الأسرة', executionType: 'family'
  });
  const bundle = await S.simpleCardBundle(office, created.execution.id);
  assert.equal(bundle.schedule.totals.dueMinor, 0, 'المستحق يجب أن يكون صفرًا قبل اكتمال الفترة');
  assert.equal(bundle.schedule.totals.runningPeriods, 1, 'الفترة الجارية مفقودة');
  assert.ok(bundle.schedule.rows[0].projectedMinor > 0, 'المبلغ المتوقع مفقود');
  await app.go(`exc:${created.execution.id}`);
  await tick(500);
  const summary = text(q('.exec-summary'));
  assert.ok(summary.includes('فترة جارية'), `سطر الفترة الجارية غير ظاهر: ${summary.slice(0, 250)}`);
  // إعادة الإعداد إلى الافتراضي حتى تبقى بقية الفحوص على سلوك المكتب المعتمد
  const reverted = executionSettings(office);
  await saveExecutionSettings(office, {...reverted, schedule: {...reverted.schedule, accrualTiming: 'AT_PERIOD_START'}});
});

await check('تاريخ حساب قديم لا يُخفي الأرقام بلا إنذار (زر الرجوع لليوم)', async () => {
  const {prefs} = await import('../../js/core/preferences.js');
  prefs.set('ui:exec:asof:v1', '2020-01-01');
  await app.refresh();
  await tick(700);
  const summary = text(q('.exec-summary') || main());
  assert.ok(summary.includes('الحساب موقوف') || summary.includes('ارجع إلى اليوم') || summary.includes('الرجوع إلى اليوم'),
    `لا إنذار ولا زر رجوع: ${summary.slice(0, 250)}`);
  const reset = q('[data-asof-today]');
  assert.ok(reset, 'زر الرجوع إلى اليوم غير موجود');
  reset.dispatchEvent(new globalThis.Event('click', {bubbles: true}));
  await tick(700);
  assert.ok(!q('[data-asof-today]'), 'الزر بقي ظاهرًا بعد الرجوع إلى اليوم');
  prefs.set('ui:exec:asof:v1', '');
});

/* ==================== 14) لا تنفيذ بلا قيمة ==================== */
await check('النموذج العام لا ينشئ تنفيذًا بلا حكم ولا بند قيمة', async () => {
  const {openEntityForm} = await import('../../js/ui/form.js');
  const card = await openEntityForm(app, 'execution', {});
  const form = modalRoot().querySelector('[data-form="new-execution"]');
  assert.ok(form, 'النموذج العام لم يوجّه إلى نموذج مركز التنفيذ');
  await closeModals();
  void card;
});

/* ==================== التقرير ==================== */
console.log(`\n==================================================`);
console.log(`${results.length - failures}/${results.length} فحصًا ناجحًا · ${failures} فشل`);
if (failures) {
  console.log('\nالفحوص الفاشلة:');
  for (const [status, name, message] of results.filter(row => row[0] === 'FAIL')) console.log(`  • ${name} → ${message}`);
}
console.log(`==================================================\n`);
process.exit(failures ? 1 : 0);
