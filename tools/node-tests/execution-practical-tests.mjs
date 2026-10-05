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
    // ملف يبدأ اليوم: المستحق صفر بحكم «بعد اكتمال الفترة» لكن الفترة الجارية ظاهرة بمبلغها.
    assert.ok(totals.dueMinor > 0 || (totals.runningPeriods > 0 && bundle.schedule.rows[0].projectedMinor > 0), `${execution.internalNumber || execution.id}: المطلوب صفر بلا فترة جارية`);
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
    assert.ok(numbers.due > 0 || text(q('.exec-summary')).includes('فترة جارية'), `${execution.internalNumber}: أرقام البطاقة صفر بلا فترة جارية`);
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

/* ====================================================================
   الإصلاح 5.13.2 — أفق الحساب والإعدادات القابلة للتعديل
   الدليل المرجعي: تنفيذ نفقة يبدأ 2026-10-05 بمبلغ 3,000 شهريًا.
   كل فحص هنا يثبت سلوكًا كان مكسورًا سابقًا: القصّ الصامت للمستقبل،
   تاريخ حساب عالمي يخفي الأرقام، زر إعدادات ميت، وحفظ بلا رسالة خطأ.
   ==================================================================== */
const {prefs} = await import('../../js/core/preferences.js');
const {executionSettings: readSettings} = await import('../../js/services/execution-settings.js');
const CACHE = await import('../../js/services/execution-cache.js');
const HORIZON = await import('../../js/ui/execution-horizon-picker.js');
const ANCHOR_EXEC_COUNT = (await office.r.execution.all(500)).filter(row => !row.isDeleted).length;

/** تنظيف تفضيلات الحساب حتى يبدأ هذا القسم من اليوم فعلًا. */
const resetAsOfPrefs = async ids => {
  await prefs.set('ui:exec:asof:v1', '');
  await prefs.set('ui:exec:asof-scope:v1', 'per-execution');
  for (const id of ids || []) { await prefs.set(HORIZON.asOfKeyFor(id), ''); await prefs.set(`ui:exec:asof-future:${id}`, '1'); }
};

const newAnchorExecution = async label => {
  const client = await office.saveClient({fullName: `عميل أفق ${label}`, phones: ['011'], status: 'active'});
  const created = await S.createSimpleExecution(office, {
    clientId: client.id, opponentName: `خصم أفق ${label}`, entitlementType: 'نفقة صغار',
    valueType: 'periodic', periodicity: 'monthly', amount: '3000', effectiveFrom: today,
    judgmentNumber: '900/2026', court: 'محكمة الأسرة', executionType: 'family'
  });
  return created.execution;
};

const horizonText = () => text(q('[data-horizon-picker]'));
const pickerDate = () => q('[data-horizon-picker] [data-asof]')?.value || '';

let anchorId = '', anchorTwoId = '';
await check('15) الدليل المرجعي: تنفيذ يبدأ اليوم بمبلغ 3,000 يعطي فترة واحدة = 3,000', async () => {
  const anchor = await newAnchorExecution('أ');
  anchorId = anchor.id;
  const second = await newAnchorExecution('ب');
  anchorTwoId = second.id;
  await resetAsOfPrefs([anchorId, anchorTwoId]);
  assert.equal((await office.r.execution.all(500)).filter(row => !row.isDeleted).length, ANCHOR_EXEC_COUNT + 2);
  const bundle = await S.simpleCardBundle(office, anchorId, {asOf: today, allowFuture: true});
  assert.equal(bundle.schedule.totals.dueMinor, 300000, `المطلوب ${bundle.schedule.totals.dueMinor}`);
  assert.equal(bundle.schedule.rows.length, 1, `عدد الفترات ${bundle.schedule.rows.length}`);
  assert.equal(bundle.schedule.rows[0].toDate, '2026-11-04');
});

await check('16) اختصار «+شهر» يعطي «مطلوب حتى 04/11/2026» = 3,000 من ارتكاز الفترة', async () => {
  await app.go(`exc:${anchorId}`);
  await tick(600);
  const chip = qa('[data-horizon-preset]').find(button => button.dataset.horizonPreset === 'plus-1');
  assert.ok(chip, 'اختصار «+شهر» غير موجود في شاشة الأفق');
  assert.equal(chip.dataset.date, '2026-11-04', `تاريخ الاختصار ${chip.dataset.date}`);
  chip.dispatchEvent(new globalThis.Event('click', {bubbles: true}));
  await tick(900);
  assert.equal(pickerDate(), '2026-11-04', 'حقل التاريخ لم يتغير');
  const numbers = await cardNumbers();
  assert.equal(numbers.due, 3000, `المطلوب ${numbers.due}`);
  assert.ok(horizonText().includes('1'), 'عدد الفترات غير معروض');
});

await check('17) تاريخ 04/01/2027 يُحسب فعلًا: 3 فترات = 9,000 ومعادلة ظاهرة (بلا قصّ صامت)', async () => {
  const input = q('[data-horizon-picker] [data-asof]');
  input.value = '2027-01-04';
  input.dispatchEvent(new globalThis.Event('change', {bubbles: true}));
  await tick(900);
  const numbers = await cardNumbers();
  assert.equal(numbers.due, 9000, `المطلوب عند 04/01/2027 = ${numbers.due} (المتوقع 9,000 = 3 فترات)`);
  const summary = text(q('.exec-summary'));
  assert.ok(/3 × 3,000/.test(summary), `معادلة الفترات غير ظاهرة: ${summary.slice(0, 300)}`);
  assert.ok(!summary.includes('حتى 05/10/2026') || summary.includes('04/01/2027'), 'التاريخ المعروض لا يطابق المحسوب');
  const stored = await S.simpleSchedule(office, anchorId, {asOf: '2027-01-04', allowFuture: true});
  assert.equal(stored.schedule.requestedAsOf, '2027-01-04');
  assert.equal(stored.schedule.effectiveAsOf, '2027-01-04');
  assert.equal(stored.schedule.horizonCapped, false);
  assert.equal(Boolean(stored.schedule.estimatedPeriods), true, 'وسم «تقديري» مفقود للفترات المستقبلية');
});

await check('18) عند إيقاف الحساب المستقبلي: تاريخ فعلي معلن + تنبيه، ولا رقم منسوب لتاريخ آخر', async () => {
  const box = q('[data-horizon-picker] [data-horizon-future]');
  assert.ok(box, 'مفتاح «احسب حتى تاريخ مستقبلي» مفقود');
  box.checked = false;
  box.dispatchEvent(new globalThis.Event('change', {bubbles: true}));
  await tick(900);
  const summary = text(q('.exec-summary'));
  const numbers = await cardNumbers();
  assert.equal(numbers.due, 3000, `المطلوب بعد الإيقاف ${numbers.due}`);
  assert.ok(q('[data-horizon-capped]'), 'تنبيه القصّ غير ظاهر');
  assert.ok(summary.includes('05/10/2026'), `التاريخ الفعلي غير معلن: ${summary.slice(0, 300)}`);
  const stored = await S.simpleSchedule(office, anchorId, {asOf: '2027-01-04', allowFuture: false});
  assert.equal(stored.schedule.horizonCapped, true);
  assert.equal(stored.schedule.effectiveAsOf, today);
  assert.ok(String(stored.schedule.horizonNote || '').length > 10, 'نص سبب القصّ مفقود');
});

await check('19) «المطلوب حتى» لكل بطاقة على حدة: تغيير بطاقة (أ) لا يمسّ بطاقة (ب)', async () => {
  await prefs.set(HORIZON.asOfKeyFor(anchorId), '2027-01-04');
  await app.go(`exc:${anchorTwoId}`);
  await tick(800);
  const numbers = await cardNumbers();
  assert.equal(numbers.due, 3000, `بطاقة (ب) تأثرت بتاريخ بطاقة (أ): ${numbers.due}`);
  assert.notEqual(pickerDate(), '2027-01-04', 'بطاقة (ب) حملت تاريخ بطاقة (أ)');
  assert.equal(pickerDate(), today, 'حقل بطاقة (ب) يجب أن يبدأ من اليوم (بلا تاريخ محفوظ)');
  const storedTwo = await S.simpleSchedule(office, anchorTwoId, {asOf: '', allowFuture: true});
  assert.equal(storedTwo.schedule.rows.length, 1);
});

await check('20) «احسب مدة» لنطاق مستقبلي: لا رسالة «قُصّ أفق الحساب» بلا مبرر وتُحتسب الفترات المنتهية', async () => {
  await app.go(`exc:${anchorId}`);
  await tick(700);
  const card = await openModalBy('[data-open-duration]', 500);
  const form = modalRoot().querySelector('[data-form="duration"]');
  assert.ok(form, 'نموذج «احسب مدة» غير موجود');
  const future = form.querySelector('[data-allow-future]');
  assert.ok(future, 'خيار الحساب المستقبلي غير موجود في «احسب مدة»');
  await fill(form, {fromDate: '2026-10-05', toDate: '2027-01-04'});
  future.checked = true;
  await submit(form, 900);
  const result = text(form.querySelector('[data-result]'));
  assert.ok(result.includes('9,000'), `النتيجة لا تحتوي 9,000: ${result.slice(0, 260)}`);
  assert.ok(!result.includes('قُصّ أفق الحساب'), `ما زالت رسالة القصّ القديمة ظاهرة: ${result.slice(0, 260)}`);
  assert.ok(result.includes('تقديري'), 'وسم «تقديري» غير ظاهر في نتيجة المدة');
  await closeModals();
  void card;
});

await check('21) التوكيل: رصيد سابق + فترة + معادلة + رسوم/دمغة يدوية = إجمالي صحيح', async () => {
  const card = await openModalBy('[data-action="poa"]', 700);
  const form = modalRoot().querySelector('[data-form="poa"]');
  assert.ok(form, 'نموذج التوكيل غير موجود');
  await fill(form, {fromDate: '2026-10-05', toDate: '2027-01-04', fees: '500', stamps: '100'});
  const running = form.querySelector('[name="includeRunningPeriods"]');
  assert.ok(running, 'خيار إدراج الفترات غير المنتهية مفقود');
  running.checked = true;
  running.dispatchEvent(new globalThis.Event('change', {bubbles: true}));
  await tick(900);
  const preview = text(form.querySelector('[data-preview]'));
  assert.ok(/3 × 3,000/.test(preview), `معادلة فترة التوكيل مفقودة: ${preview.slice(0, 300)}`);
  assert.ok(preview.includes('9,600'), `الإجمالي مع الرسوم والدمغة غير صحيح: ${preview.slice(0, 300)}`);
  assert.ok(preview.includes('رسوم') && preview.includes('دمغة'), 'سطرا الرسوم والدمغة غير ظاهرين');
  assert.ok(form.querySelector('[name="fees"]') && form.querySelector('[name="stamps"]'), 'حقلا الرسوم والدمغة مفقودان');
  await submit(form, 1200);
  const poas = await office.r.executionPOAs.byIndex('executionId', anchorId, 20);
  const saved = poas.filter(row => !row.isDeleted).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
  assert.ok(saved, 'لم يُحفظ التوكيل');
  assert.equal(Number(saved.feesAmount), 500, `الرسوم المحفوظة ${saved.feesAmount}`);
  assert.equal(Number(saved.stampAmount), 100, `الدمغة المحفوظة ${saved.stampAmount}`);
  assert.equal(Number(saved.total), 9600, `إجمالي التوكيل ${saved.total}`);
  void card;
});

await check('22) شاشة الإعدادات: كل الخيارات قابلة للتعديل ويُحفظ التغيير وينعكس على الأرقام فورًا', async () => {
  // نُعيد بطاقة القياس إلى «المطلوب حتى اليوم» أولًا حتى يكون الفرق من الإعدادات
  // وحدها لا من تاريخ محفوظ من فحص سابق.
  await prefs.set(HORIZON.asOfKeyFor(anchorId), '');
  await prefs.set(HORIZON.asOfKeyFor(anchorTwoId), '');
  await app.go('executionCenter');
  await tick(700);
  await openModalBy('[data-settings]', 500);
  const form = modalRoot().querySelector('[data-form="settings"]');
  assert.ok(form, 'نموذج الإعدادات غير موجود');
  const accrual = form.querySelector('[name="accrualTiming"]');
  assert.equal([...accrual.querySelectorAll('option')].length, 2, 'خيارات توقيت الاستحقاق ناقصة');
  for (const name of ['periodBasis', 'startPolicy', 'midChangePolicy', 'endPolicy', 'allocationOrder', 'defaultCurrency']) {
    assert.ok(form.querySelector(`[name="${name}"]`), `قاعدة ${name} غير قابلة للتعديل`);
  }
  for (const name of ['entitlementTypes', 'executionMethods', 'collectionMethods', 'actionKinds', 'expenseTypes', 'borneBy', 'laterJudgmentKinds']) {
    assert.ok(form.querySelector(`[name="${name}"]`), `قائمة ${name} غير قابلة للتعديل`);
  }
  assert.ok(form.querySelector('[data-templates]'), 'زر تعديل قوالب الطباعة مفقود');
  assert.ok(form.querySelector('[name="asOfScope"]'), 'خيار نطاق تاريخ الحساب مفقود');
  const before = readSettings(office);
  await fill(form, {accrualTiming: 'AFTER_PERIOD_END'});
  await submit(form, 1200);
  const after = readSettings(office);
  assert.equal(after.schedule.accrualTiming, 'AFTER_PERIOD_END', 'لم يُحفظ توقيت الاستحقاق');
  assert.ok(Number(after.ruleVersion) > Number(before.ruleVersion), 'نسخة القواعد لم ترتفع');
  assert.ok(!modalRoot().querySelector('[data-form="settings"]'), 'النافذة لم تُغلق بعد الحفظ الناجح');
  await app.go(`exc:${anchorId}`);
  await tick(800);
  const summary = text(q('.exec-summary'));
  assert.ok(summary.includes('فترة جارية'), `لم تنعكس الإعدادات على الحساب: ${summary.slice(0, 240)}`);
  assert.equal((await cardNumbers()).due, 0, 'توقيت «بعد اكتمال الفترة» يجب أن يؤجل المستحق');
});

await check('23) رابط «إعدادات التنفيذ» داخل ملاحظة الفترة الجارية يفتح النافذة (كان زرًا ميتًا)', async () => {
  await app.go(`exc:${anchorId}`);
  await tick(800);
  const link = q('.exec-summary [data-settings]');
  assert.ok(link, 'رابط الإعدادات داخل الملاحظة غير موجود');
  link.dispatchEvent(new globalThis.Event('click', {bubbles: true}));
  await tick(500);
  assert.ok(modalRoot().querySelector('[data-form="settings"]'), 'الرابط لم يفتح نافذة الإعدادات');
  await closeModals();
});

await check('24) حفظ الإعدادات الفاشل: رسالة خطأ صريحة داخل النموذج والنافذة لا تُغلق', async () => {
  await app.go('executionCenter');
  await tick(600);
  await openModalBy('[data-settings]', 500);
  const form = modalRoot().querySelector('[data-form="settings"]');
  const original = prefs.set.bind(prefs);
  prefs.set = () => { throw new Error('تعذّر الكتابة في التخزين (محاكاة فشل)'); };
  try {
    await fill(form, {accrualTiming: 'AT_PERIOD_START'});
    await submit(form, 900);
  } finally { prefs.set = original; }
  const form2 = modalRoot().querySelector('[data-form="settings"]');
  assert.ok(form2, 'النافذة أُغلقت رغم فشل الحفظ');
  const errorLine = form2.querySelector('[data-settings-error]');
  assert.ok(errorLine && !errorLine.hidden, 'لا رسالة خطأ داخل النموذج');
  assert.ok(text(errorLine).length > 5, 'رسالة الخطأ فارغة');
  await closeModals();
});

await check('25) تحقق الإعدادات: قائمة فارغة أو كود مكرر لا يُحفظ ولا يُغلق النافذة', async () => {
  await app.go('executionCenter');
  await tick(600);
  await openModalBy('[data-settings]', 500);
  const form = modalRoot().querySelector('[data-form="settings"]');
  const before = readSettings(office);
  await fill(form, {entitlementTypes: '   '});
  await submit(form, 700);
  assert.ok(modalRoot().querySelector('[data-form="settings"]'), 'النافذة أُغلقت مع قائمة فارغة');
  assert.ok(!modalRoot().querySelector('[data-settings-error]')?.hidden, 'لا رسالة تحقق للقائمة الفارغة');
  await fill(form, {entitlementTypes: 'نفقة صغار', expenseTypes: 'A=رسم\nA=مصروف'});
  await submit(form, 700);
  assert.ok(!modalRoot().querySelector('[data-settings-error]')?.hidden, 'لا رسالة تحقق للكود المكرر');
  assert.equal(Number(readSettings(office).ruleVersion), Number(before.ruleVersion), 'حُفظ إعداد غير صالح');
  await closeModals();
});

await check('26) إبطال ذاكرة الحساب: تغيير الإعدادات يغيّر نتيجة simpleSchedule المخزّنة مؤقتًا', async () => {
  CACHE.clearExecutionCache('فحص');
  const first = await S.simpleSchedule(office, anchorId, {asOf: today, allowFuture: true});
  const second = await S.simpleSchedule(office, anchorId, {asOf: today, allowFuture: true});
  assert.equal(second.cacheHit, true, 'لم تُستَخدم الذاكرة المؤقتة في الطلب المتكرر');
  const before = second.schedule.totals.dueMinor;
  const {saveExecutionSettings} = await import('../../js/services/execution-settings.js');
  const settings = readSettings(office);
  await saveExecutionSettings(office, {...settings, schedule: {...settings.schedule, accrualTiming: 'AT_PERIOD_START'}});
  const third = await S.simpleSchedule(office, anchorId, {asOf: today, allowFuture: true});
  assert.equal(third.cacheHit, false, 'الذاكرة لم تُبطَل بعد تغيير الإعدادات');
  assert.notEqual(third.schedule.totals.dueMinor, before, 'الأرقام لم تتغير بعد تغيير الإعدادات');
  // الكتابة على سجلات التنفيذ تُبطل الذاكرة أيضًا (تحصيل/إجراء/مصروف…)
  await S.recordSimpleCollection(office, {executionId: anchorId, amount: 500, date: today, paymentMethod: 'نقدي'});
  const fourth = await S.simpleSchedule(office, anchorId, {asOf: today, allowFuture: true});
  assert.equal(fourth.cacheHit, false, 'الذاكرة لم تُبطَل بعد تسجيل تحصيل');
  assert.equal(fourth.schedule.totals.paidMinor, 50000, `المدفوع ${fourth.schedule.totals.paidMinor}`);
  // تنظيف: إلغاء التحصيل وإعادة التوقيت الافتراضي
  const receipts = await office.r.executionReceipts.byIndex('executionId', anchorId, 20);
  for (const receipt of receipts.filter(row => !row.isDeleted)) await S.voidSimpleRecord(office, {kind: 'receipt', id: receipt.id, reason: 'تنظيف فحص'});
  const fresh = readSettings(office);
  await saveExecutionSettings(office, {...fresh, schedule: {...fresh.schedule, accrualTiming: 'AT_PERIOD_START'}});
});

await check('27) واجهة مركز التنفيذ عربية RTL وبمسميات غير تقنية في كل الشاشات الجديدة', async () => {
  await app.go(`exc:${anchorId}`);
  await tick(700);
  const summary = text(q('.exec-summary'));
  for (const label of ['المطلوب حتى', 'المحصّل', 'الرصيد', 'المعادلة', 'احسب مدة', 'توكيل جديد', 'محضر تحصيل']) {
    assert.ok(summary.includes(label), `مسمّى عربي مفقود: ${label}`);
  }
  const visibleText = `${text(q('[data-horizon-picker]'))} ${summary}`;
  assert.ok(!/[A-Za-z]{4,}/.test(visibleText), `تسريب مصطلح إنجليزي في واجهة الأفق: ${visibleText.slice(0, 180)}`);
  await resetAsOfPrefs([anchorId, anchorTwoId]);
});

await check('28) تغيير «أساس الفترة الشهرية» من الإعدادات يغيّر بنية الجدول فورًا (إعداد مكتب لا كود)', async () => {
  await resetAsOfPrefs([anchorId, anchorTwoId]);
  const SETTINGS_SERVICE = await import('../../js/services/execution-settings.js');
  const before = await S.simpleSchedule(office, anchorId, {asOf: '2027-01-04', allowFuture: true});
  assert.equal(before.schedule.rows.length, 3, `الافتراضي (يوم الارتكاز) يجب أن يعطي 3 فترات حتى 04/01/2027 — وجد ${before.schedule.rows.length}`);
  assert.equal(before.schedule.totals.dueMinor, 900000, `المطلوب الافتراضي ${before.schedule.totals.dueMinor}`);
  const base = readSettings(office);
  await SETTINGS_SERVICE.saveExecutionSettings(office, {...base, schedule: {...base.schedule, periodBasis: 'CALENDAR_MONTH'}});
  const after = await S.simpleSchedule(office, anchorId, {asOf: '2027-01-04', allowFuture: true});
  assert.equal(after.schedule.rows.length, 4, `أساس الشهر التقويمي يجب أن يعطي 4 فترات — وجد ${after.schedule.rows.length}`);
  assert.equal(after.schedule.rows[0].status, 'NEEDS_DECISION', 'الفترة الجزئية (01/10–31/10) يجب أن تطلب قرارًا صريحًا بلا احتساب تناسبي');
  assert.equal(Number(after.schedule.totals.dueMinor), 900000, 'لا يُحتسب ما لم يُقرَّر صراحةً');
  const now = readSettings(office);
  await SETTINGS_SERVICE.saveExecutionSettings(office, {...now, schedule: {...now.schedule, periodBasis: 'ANNIVERSARY'}});
  const restored = await S.simpleSchedule(office, anchorId, {asOf: '2027-01-04', allowFuture: true});
  assert.equal(restored.schedule.rows.length, 3, 'لم تُستعد القاعدة الافتراضية');
  await resetAsOfPrefs([anchorId, anchorTwoId]);
});

await check('29) ترتيب التوزيع والعملة الافتراضية: إعدادان يغيّران النتيجة فعلًا (لا خيار بلا أثر)', async () => {
  const SETTINGS_SERVICE = await import('../../js/services/execution-settings.js');
  const base = readSettings(office);
  await SETTINGS_SERVICE.saveExecutionSettings(office, {...base, schedule: {...base.schedule, allocationOrder: 'fifo'}});
  await S.recordSimpleCollection(office, {executionId: anchorId, amount: 1000, date: today, paymentMethod: 'نقدي'});
  const fifo = await S.simpleSchedule(office, anchorId, {asOf: '2026-12-04', allowFuture: true});
  assert.equal(fifo.schedule.rows[0].paidMinor, 100000, `في «الأقدم أولًا» يجب أن تُخصم 1,000 من الفترة الأولى — وجد ${fifo.schedule.rows[0].paidMinor}`);
  assert.equal(fifo.schedule.rows[1].paidMinor, 0, `الفترة الثانية يجب أن تبقى بلا سداد — وجد ${fifo.schedule.rows[1].paidMinor}`);
  const fifoRuleVersion = readSettings(office).ruleVersion;
  const mid = readSettings(office);
  await SETTINGS_SERVICE.saveExecutionSettings(office, {...mid, schedule: {...mid.schedule, allocationOrder: 'lifo'}});
  assert.ok(Number(readSettings(office).ruleVersion) > Number(fifoRuleVersion), 'تغيير ترتيب التوزيع لم يرفع نسخة القواعد');
  await S.recordSimpleCollection(office, {executionId: anchorId, amount: 1000, date: today, paymentMethod: 'نقدي'});
  const lifo = await S.simpleSchedule(office, anchorId, {asOf: '2026-12-04', allowFuture: true});
  assert.equal(lifo.schedule.rows[0].paidMinor, 0, `في «الأحدث فالأقدم» لا يجب أن تصل دفعة إلى الفترة الأقدم — وجد ${lifo.schedule.rows[0].paidMinor}`);
  assert.equal(lifo.schedule.rows[1].paidMinor, 200000, `كل المدفوع (2,000) يجب أن يتجه إلى الفترة الأحدث — وجد ${lifo.schedule.rows[1].paidMinor}`);
  // العملة الافتراضية تُطبَّق على السجلات الجديدة (ولا تبدّل عملة مبلغ مسجَّل فعلًا).
  const afterOrder = readSettings(office);
  await SETTINGS_SERVICE.saveExecutionSettings(office, {...afterOrder, schedule: {...afterOrder.schedule, defaultCurrency: 'USD'}});
  const EX = await import('../../js/services/execution.js');
  const temp = await S.createSimpleExecution(office, {
    newClientName: 'عميل عملة الفحص', entitlementType: 'نفقة', valueType: 'periodic',
    periodicity: 'monthly', amount: '1000', effectiveFrom: today
  });
  const usd = await S.simpleSchedule(office, temp.execution.id, {asOf: today, allowFuture: true});
  assert.equal(usd.schedule.currency, 'USD', `العملة الافتراضية لم تُطبَّق على بند جديد — وجد ${usd.schedule.currency}`);
  const anchorStill = await S.simpleSchedule(office, anchorId, {asOf: '2026-12-04', allowFuture: true});
  assert.equal(anchorStill.schedule.currency, 'EGP', 'مبلغ مسجَّل صراحةً بعملة يجب ألا تُبدَّل بتغيير الافتراضي');
  await EX.deleteExecution(office, temp.execution.id, null, 'تنظيف فحص الإعدادات').catch(() => {});
  const afterCurrency = readSettings(office);
  await SETTINGS_SERVICE.saveExecutionSettings(office, {...afterCurrency, schedule: {...afterCurrency.schedule, defaultCurrency: 'EGP'}});
  // تنظيف: إلغاء المحضرين وإعادة القيم الافتراضية
  const receipts = await office.r.executionReceipts.byIndex('executionId', anchorId, 30);
  for (const receipt of receipts.filter(row => !row.isDeleted && String(row.status || '') !== 'voided')) {
    await S.voidSimpleRecord(office, {kind: 'receipt', id: receipt.id, reason: 'تنظيف فحص الإعدادات'});
  }
  const now = readSettings(office);
  await SETTINGS_SERVICE.saveExecutionSettings(office, {...now, schedule: {...now.schedule, allocationOrder: 'fifo'}});
  const restored = await S.simpleSchedule(office, anchorId, {asOf: '2026-12-04', allowFuture: true});
  assert.equal(Number(restored.schedule.totals.paidMinor), 0, `لم يُنظَّف التحصيل: ${restored.schedule.totals.paidMinor}`);
  await resetAsOfPrefs([anchorId, anchorTwoId]);
});

await check('30) «احسب مدة» بمبلغ يدوي: 4,000 × 3 فترات + رسوم 500 + دمغة 100 = 12,600 مع المعادلة', async () => {
  await app.go(`exc:${anchorId}`);
  await tick(700);
  await openModalBy('[data-open-duration]', 500);
  const form = modalRoot().querySelector('[data-form="duration"]');
  assert.ok(form, 'نموذج «احسب مدة» غير موجود');
  const manualBox = form.querySelector('[data-use-manual]');
  assert.ok(manualBox, 'خيار «استخدم الحساب اليدوي» مفقود');
  assert.equal(manualBox.checked, false, 'الجدول المسجَّل هو المصدر الافتراضي — والخيار اليدوي اختياري');
  await fill(form, {fromDate: '2026-10-05', toDate: '2027-01-04', manualAmount: '4000', manualPeriodicity: 'monthly', manualFees: '500', manualStamps: '100'});
  manualBox.checked = true;
  await submit(form, 900);
  const result = text(form.querySelector('[data-result]'));
  assert.ok(result.includes('12,600'), `الإجمالي اليدوي غير صحيح: ${result.slice(0, 260)}`);
  assert.ok(result.includes('3'), 'عدد الفترات غير ظاهر');
  assert.ok(/12,000/.test(result), `إجمالي الفترات غير ظاهر: ${result.slice(0, 260)}`);
  assert.ok(result.includes('مذكرة'), 'تنبيه «مذكرة يدوية لا تغيّر الرصيد» مفقود');
  await closeModals();
  // الجدول المسجَّل لم يتغير من الحساب اليدوي.
  const after = await S.simpleSchedule(office, anchorId, {asOf: '2027-01-04', allowFuture: true});
  assert.equal(Number(after.schedule.totals.dueMinor), 900000, `الحساب المسجَّل تأثر بالمذكرة اليدوية: ${after.schedule.totals.dueMinor}`);
  await resetAsOfPrefs([anchorId, anchorTwoId]);
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
