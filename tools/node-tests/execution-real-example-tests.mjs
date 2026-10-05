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


const app = await mountAppShell();
const office = app.office;
const S = await import('../../js/services/execution-simple.js');
const ADMIN = await import('../../js/services/data-admin.js');
const FEASApp = await import('../../js/services/execution-feas.js');
const {localDate, addDays} = await import('../../js/core/clock.js');
const CAL = await import('../../js/domain/execution-period-calendar.js');
const M = {unit: 'MONTH', periodBasis: 'ANNIVERSARY', monthEndPolicy: 'CLAMP_TO_LAST_DAY'};
const today = localDate();
const A = CAL.periodStart(today, -9, M);            // الارتكاز: 9 فترات كاملة تنتهي أمس
const pS = k => CAL.periodStart(A, k, M), pE = k => CAL.periodEnd(A, k, M);
const dmy = iso => iso.split('-').reverse().join('/');
console.log(`\n=== مثال فعلي: نفقة 3,000 شهريًا من ${dmy(A)} · اليوم ${dmy(today)} ===\n`);
let executionId = '';
const bundle = () => S.simpleCardBundle(office, executionId);
const record = async kind => {
  await openModalBy('[data-record]', 250);
  modalRoot().querySelector(`[data-record="${kind}"]`).dispatchEvent(new globalThis.Event('click', {bubbles: true}));
  await tick(400);
};
const refresh = async () => { await closeModals(); await app.refresh(); await tick(800); };
const tab = async key => { qa('.exec-tab').find(node => node.dataset.tab === key).dispatchEvent(new globalThis.Event('click', {bubbles: true})); await tick(350); };

await check('تجهيز: مسح البيانات وفتح مركز التنفيذ', async () => {
  const name = String(office.ctx?.profile?.displayName || office.ctx?.profile?.name || '').trim();
  await ADMIN.clearAllData(office, {reason: 'مثال فعلي', confirmName: name});
  await app.go('executionCenter'); await tick(900);
  assert.ok(q('#exec-grid'));
});

await check(`1) إنشاء تنفيذ نفقة 3,000 من ${dmy(A)} ⇒ الافتراضي «بعد اكتمال الفترة»: 9 فترات = 27,000 (الفترة التي تبدأ اليوم = صفر)؛ و«من بداية الفترة»: 30,000`, async () => {
  const client = await office.saveClient({fullName: 'هدى السيد (مثال فعلي)', phones: ['01011111111'], status: 'active'});
  await openModalBy('[data-new-execution]', 300);
  const form = modalRoot().querySelector('[data-form="new-execution"]');
  await fill(form, {clientId: client.id, opponentName: 'كريم فتحي', entitlementType: 'نفقة صغار', valueType: 'periodic', periodicity: 'monthly',
    amount: '3000', effectiveFrom: A, judgmentNumber: '220/2025', court: 'محكمة أسرة بنها', judgmentDate: addDays(A, -10), executionType: 'family', authority: 'قلم تنفيذ بنها'});
  await submit(form, 1000);
  executionId = String(app.route).slice(4);
  await tick(600);
  const n = await cardNumbers();
  console.log(`      مطلوب ${n.due} · مدفوع ${n.paid} · متبقٍ ${n.remaining}`);
  assert.equal(n.due, 27000); assert.equal(n.remaining, 27000);
  const SET = await import('../../js/services/execution-settings.js');
  const cur = SET.executionSettings(office);
  await SET.saveExecutionSettings(office, {...cur, schedule: {...cur.schedule, accrualTiming: 'AT_PERIOD_START'}});
  const after = await bundle();
  console.log(`      من بداية الفترة: مستحق ${after.schedule.totals.dueMinor / 100} · فترات جارية ${after.schedule.totals.runningPeriods}`);
  assert.equal(after.schedule.totals.dueMinor, 3000000, 'من بداية الفترة: الفترة الجارية تُستحق اليوم');
  assert.equal(cur.schedule.accrualTiming, 'AFTER_PERIOD_END', 'الافتراضي يجب أن يكون بعد الاكتمال');
  await SET.saveExecutionSettings(office, {...SET.executionSettings(office), schedule: {...SET.executionSettings(office).schedule, accrualTiming: cur.schedule.accrualTiming}});
  const b = await bundle();
  const firstRow = b.schedule.rows[0];
  assert.equal(firstRow.fromDate, A); assert.equal(firstRow.toDate, pE(0));
});

await check(`2) احسب مدة: ${dmy(pS(0))} → ${dmy(pE(2))} = 3 × 3,000 = 9,000 بالضبط`, async () => {
  await openModalBy('[data-open-duration]', 400);
  const form = modalRoot().querySelector('[data-form="duration"]');
  await fill(form, {fromDate: pS(0), toDate: pE(2)});
  await submit(form, 900);
  const result = text(modalRoot().querySelector('[data-result]'));
  console.log(`      ${result.slice(0, 160)}…`);
  assert.ok(result.includes('9,000'), 'الإجمالي 9,000 غير ظاهر');
  for (const bad of ['2,612.9', '5,612.9', '600.00']) assert.ok(!result.includes(bad), `قيمة تناسبية ظاهرة ${bad}`);
  await closeModals();
});

await check('3) احسب مدة بنطاق يقطع فترتين: لا تناسب بالأيام، والفترة الحدّية تطلب قرارًا', async () => {
  await openModalBy('[data-open-duration]', 400);
  const form = modalRoot().querySelector('[data-form="duration"]');
  await fill(form, {fromDate: addDays(pS(1), 10), toDate: addDays(pE(4), -5)});
  await submit(form, 900);
  const result = text(modalRoot().querySelector('[data-result]'));
  console.log(`      ${result.slice(0, 220)}…`);
  assert.ok(/جزئ|حدّ|حد|قرار/.test(result), 'لا تنبيه للفترة الجزئية');
  assert.ok(result.includes('6,000'), 'الفترتان الكاملتان (6,000) غير ظاهرتين');
  await closeModals();
});

await check('4) محضر تحصيل 10,000 ⇒ مدفوع 10,000 ومتبقٍ 17,000', async () => {
  await record('collection');
  const form = modalRoot().querySelector('[data-form="collection"]');
  await fill(form, {amount: '10000', date: addDays(today, -20), target: 'auto', reference: 'محضر 55'});
  await submit(form, 900);
  await refresh();
  const n = await cardNumbers();
  assert.equal(n.paid, 10000); assert.equal(n.remaining, 17000);
});

let poa1 = null, poa2 = null;
await check(`5) إنشاء توكيل من الواجهة: ${dmy(pS(0))} → ${dmy(pE(5))} — يُحفظ ولا يغيّر المتبقي`, async () => {
  await tab('poa');
  const card = await openModalBy('[data-action="poa"]', 600);
  const form = modalRoot().querySelector('[data-form="poa"]');
  assert.ok(form, 'نافذة التوكيل لم تُفتح');
  await fill(form, {fromDate: pS(0), toDate: pE(5), poaNumber: 'ت-1/2026'});
  await tick(500);
  const preview = text(form.querySelector('[data-preview]'));
  console.log(`      معاينة: ${preview.slice(0, 200)}…`);
  assert.ok(preview.includes('إجمالي التوكيل'));
  await submit(form, 1200);
  await refresh();
  const b = await bundle();
  poa1 = b.poas.find(p => p.poaNumber === 'ت-1/2026');
  assert.ok(poa1, 'التوكيل لم يُحفظ');
  console.log(`      ت-1: من ${dmy(poa1.fromDate)} إلى ${dmy(poa1.toDate)} · إجمالي ${poa1.total}`);
  assert.equal(poa1.toDate, pE(5));
  assert.equal(Number(poa1.total), 18000, 'ت-1 يجب أن يساوي 6 × 3,000');
  const n = await cardNumbers(); assert.equal(n.remaining, 17000, 'التوكيل غيّر المتبقي');
});

await check('6) «توكيل جديد» يبدأ تلقائيًا من اليوم التالي لنهاية آخر توكيل', async () => {
  await tab('poa');
  await openModalBy('[data-action="poa"]', 600);
  const form = modalRoot().querySelector('[data-form="poa"]');
  assert.equal(form.querySelector('[name="fromDate"]').value, pS(6), 'بداية التوكيل الجديد ليست بعد نهاية السابق');
  await fill(form, {toDate: pE(8), poaNumber: 'ت-2/2026'});
  await tick(500);
  await submit(form, 1200);
  await refresh();
  const b = await bundle();
  poa2 = b.poas.find(p => p.poaNumber === 'ت-2/2026');
  assert.ok(poa2, 'التوكيل الثاني لم يُحفظ');
  console.log(`      ت-2: من ${dmy(poa2.fromDate)} إلى ${dmy(poa2.toDate)} · إجمالي ${poa2.total}`);
  assert.equal(poa2.fromDate, pS(6));
  const n = await cardNumbers(); assert.equal(n.remaining, 17000, 'التوكيل الثاني غيّر المتبقي (ازدواج)');
  const prev = Number(poa2.previousBalance), base = Number(poa2.baseAmount);
  console.log(`      رصيد سابق ${prev} + فترة ${base} = ${poa2.total}`);
  assert.equal(base, 9000, 'فترة ت-2 = 3 × 3,000'); assert.equal(prev, 8000, 'الرصيد السابق = 18,000 − 10,000'); assert.equal(Number(poa2.total), 17000);
});

await check('7) إعادة توكيل من صف توكيل محدد تبدأ بعد نهايته هو (لا آخر توكيل)', async () => {
  await tab('poa');
  const btn1 = q(`[data-reissue-poa="${poa1.id}"]`);
  assert.ok(btn1, 'زر إعادة التوكيل غير موجود');
  btn1.dispatchEvent(new globalThis.Event('click', {bubbles: true})); await tick(600);
  let form = modalRoot().querySelector('[data-form="poa"]');
  assert.equal(form.querySelector('[name="fromDate"]').value, pS(6), 'إعادة ت-1 لا تبدأ بعد نهايته');
  await closeModals(); await tab('poa');
  q(`[data-reissue-poa="${poa2.id}"]`).dispatchEvent(new globalThis.Event('click', {bubbles: true})); await tick(600);
  form = modalRoot().querySelector('[data-form="poa"]');
  assert.equal(form.querySelector('[name="fromDate"]').value, pS(9), 'إعادة ت-2 لا تبدأ بعد نهايته');
  await fill(form, {toDate: addDays(pS(9), 0), poaNumber: 'ت-3/2026'});
  await closeModals();
});

await check('8) إجراء تنفيذ + مصروف 350 (لا يزيد أصل الدين)', async () => {
  await record('action');
  let form = modalRoot().querySelector('[data-form="action"]');
  await fill(form, {kind: 'تكليف بالوفاء', date: addDays(today, -5), nextAction: 'حجز إداري', nextActionDate: addDays(today, 10), notes: 'مثال فعلي'});
  await submit(form, 900); await refresh();
  assert.ok(text(q('.exec-summary')).includes('تكليف بالوفاء'));
  await record('expense');
  form = modalRoot().querySelector('[data-form="expense"]');
  await fill(form, {typeLabel: 'رسم تنفيذ', amount: '350', date: addDays(today, -4), borneBy: 'debtor'});
  await submit(form, 900); await refresh();
  const n = await cardNumbers(); assert.equal(n.due, 27000); assert.equal(n.remaining, 17000);
});

await check(`9) حكم لاحق 4,000 من ${dmy(pS(5))} ⇒ +4 × 1,000 = 31,000 مطلوب و21,000 متبقٍ؛ التوكيلات المحفوظة لا تتغير`, async () => {
  await record('judgment');
  const form = modalRoot().querySelector('[data-form="later-judgment"]');
  await fill(form, {amount: '4000', effectiveFrom: pS(5), entitlementType: 'نفقة صغار', judgmentNumber: '90/2026', judgmentDate: addDays(pS(5), -3)});
  await tick(500); await submit(form, 1000); await refresh();
  const n = await cardNumbers();
  console.log(`      مطلوب ${n.due} · مدفوع ${n.paid} · متبقٍ ${n.remaining}`);
  assert.equal(n.due, 31000); assert.equal(n.remaining, 21000);
  const b = await bundle();
  assert.equal(b.poas.find(p => p.id === poa1.id).total, poa1.total, 'لقطة ت-1 تغيّرت');
  assert.equal(b.poas.find(p => p.id === poa2.id).total, poa2.total, 'لقطة ت-2 تغيّرت');
});

await check('10) احسب مدة بعد الحكم اللاحق: الفترات 6..8 = 3 × 4,000 = 12,000', async () => {
  await openModalBy('[data-open-duration]', 400);
  const form = modalRoot().querySelector('[data-form="duration"]');
  await fill(form, {fromDate: pS(6), toDate: pE(8)});
  await submit(form, 900);
  const result = text(modalRoot().querySelector('[data-result]'));
  assert.ok(result.includes('12,000'), result.slice(0, 200));
  await closeModals();
});

await check('11) التبويبات الأربعة + تتبّع الأرقام + كشف الحساب', async () => {
  for (const key of ['account', 'log', 'data', 'poa']) { await tab(key); assert.ok(text(q('[data-tab-panel]')).length > 20, `تبويب ${key} فارغ`); }
  await tab('log');
  const log = text(q('[data-tab-panel]'));
  assert.ok(log.includes('10,000') && log.includes('تكليف بالوفاء'), 'السجل لا يعرض التحصيل/الإجراء');
  await tab('account');
  for (const which of ['due', 'paid', 'remaining']) {
    const b = q(`.exec-summary [data-trace="${which}"]`); assert.ok(b, `زر تتبع ${which}`);
    b.dispatchEvent(new globalThis.Event('click', {bubbles: true})); await tick(400);
    assert.ok(text(modalRoot()).length > 30, `تتبّع ${which} فارغ`); await closeModals();
  }
  const doc = await S.simpleStatementDocument(office, executionId, {mode: 'monthly'});
  const docText = JSON.stringify(doc);
  assert.ok(docText.includes('31,000') || docText.includes('3100000') || docText.includes('31000'), 'الكشف لا يحمل 31,000');
});

await check('12) إلغاء التحصيل من السجل يعيد المتبقي 31,000، ثم مركز السلامة بلا أخطاء حاجبة', async () => {
  const b = await bundle();
  const receipt = b.receipts?.[0] || (await office.r.executionReceipts.byIndex('executionId', executionId, 10))[0];
  await S.voidSimpleRecord(office, {kind: 'receipt', id: receipt.id, reason: 'اختبار إلغاء'});
  await refresh();
  const n = await cardNumbers(); assert.equal(n.paid, 0); assert.equal(n.remaining, 31000);
  const report = await FEASApp.executionIntegrityReport(office, executionId);
  console.log(`      سلامة: ${report.issues.length} ملاحظة (${report.issues.map(i => i.code).join(', ') || '—'})`);
  assert.ok(!report.issues.some(i => i.severity === 'error'));
});

const pass = results.filter(r => r[0] === 'PASS').length;
console.log(`\n${pass}/${results.length} فحصًا ناجحًا · ${failures} فشل`);
process.exit(failures ? 1 : 0);
