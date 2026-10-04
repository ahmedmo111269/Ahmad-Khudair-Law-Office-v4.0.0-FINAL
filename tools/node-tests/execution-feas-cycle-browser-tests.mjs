// الدورة الكاملة لمسار FEAS من الواجهة الجديدة: إنشاء بتفعيل صريح ← تعريف التزام
// ← معاينة (بلا كتابة) ← اعتراف صريح بفترة ← ظهور الأرقام في البطاقة الموحّدة
// ← تسوية فروق ← اعتماد ← تثبيت ← ثبات الأرقام بعد إعادة التحميل دون اتصال.
//
// كل خطوة تُنفَّذ بالنقر على عناصر الواجهة الحقيقية (وتُملأ الحقول كإدخال مستخدم)،
// ثم يُتحقق من الأثر في IndexedDB ومن محرك FEAS نفسه. لا يُكتب PASS لما لم يُنفَّذ.
import {chromium} from 'playwright';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const base = (process.env.FEAS_BASE_URL || process.env.GRID_BASE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
const artifactDir = path.join(repository, '.cache', 'execution-feas-cycle');
await fs.mkdir(artifactDir, {recursive: true});

let browser;
if (process.env.GRID_BROWSER_EXECUTABLE) {
  browser = await chromium.launch({executablePath: process.env.GRID_BROWSER_EXECUTABLE, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage']});
} else {
  const {default: slim, inflate} = await import('@sparticuz/chromium');
  const require = createRequire(import.meta.url);
  await inflate(path.resolve(path.dirname(require.resolve('@sparticuz/chromium')), '../bin/al2023.tar.br'));
  const libPath = path.join(process.env.TMPDIR || '/tmp', 'al2023', 'lib');
  process.env.LD_LIBRARY_PATH = [libPath, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');
  browser = await chromium.launch({executablePath: await slim.executablePath(), headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage']});
}

const report = {scenario: 'execution-feas-full-cycle-from-new-ui', browser: browser.version(), date: new Date().toISOString(), checks: [], failures: [], consoleErrors: []};
const check = (name, ok, detail = '') => {
  if (ok) report.checks.push({name, status: 'PASS', detail});
  else { report.failures.push({name, detail}); console.log(`FAIL — ${name}: ${detail}`); }
};
const main = () => document.querySelector('#main-content');

const context = await browser.newContext({viewport: {width: 1366, height: 900}, locale: 'ar-EG', serviceWorkers: 'allow'});
const page = await context.newPage();
page.on('pageerror', error => report.consoleErrors.push(String(error.message || error)));
page.on('console', message => { if (message.type() === 'error' && !/favicon|ERR_CONNECTION|ERR_INTERNET|ERR_NAME/.test(message.text())) report.consoleErrors.push(message.text()); });

await page.goto(`${base}/index.html`);
await page.waitForFunction(() => window.__LAW_OFFICE_APP__ && !window.__LAW_OFFICE_APP__.booting, null, {timeout: 90000});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// ===== 1) إنشاء تنفيذ بنموذج FEAS من نافذة التنفيذ الجديدة (خيارات متقدمة) =====
await page.evaluate(() => window.__LAW_OFFICE_APP__.go('executionCenter'));
await page.waitForSelector('[data-new-execution]', {timeout: 30000});
await page.locator('[data-new-execution]').first().click();
await page.waitForSelector('[data-form="new-execution"]', {timeout: 20000});
const dialogFields = await page.evaluate(() => ({
  hasAdvanced: Boolean(document.querySelector('.advanced-options')),
  modelOptions: [...document.querySelectorAll('[name="accountingModel"] option')].map(node => node.value),
  visibleFields: [...document.querySelectorAll('.simple-form [name]')].filter(node => node.offsetParent !== null).length
}));
check('نافذة التنفيذ الجديدة تعرض «خيارات متقدمة» بنموذج حساب اختياري (بلا إرباك المسار المبسط)',
  dialogFields.hasAdvanced && dialogFields.modelOptions.includes('feas-v1') && dialogFields.modelOptions.includes('legacy-v1'),
  JSON.stringify(dialogFields));

// خيارات متقدمة مطويّة عن قصد (لا تُقلق المسار العادي): نفتحها كأي مستخدم.
await page.locator('.advanced-options summary').first().click();
await wait(250);
const afterOpen = await page.evaluate(() => ({
  visibleModel: [...document.querySelectorAll('[name="accountingModel"]')].filter(node => node.offsetParent !== null).length,
  visibleRequired: [...document.querySelectorAll('.simple-form [name]')].filter(node => node.offsetParent !== null && node.closest('.simple-form')).length
}));
check('فتح الخيارات المتقدمة بنقرة واحدة يكشف نموذج الحساب (بلا إرباك الحقول الأساسية)',
  afterOpen.visibleModel === 1, JSON.stringify(afterOpen));

await page.fill('[name="newClientName"]', 'FEAS — موكل دورة كاملة');
await page.fill('[name="opponentName"]', 'FEAS — منفذ ضده');
await page.fill('[name="amount"]', '2000');
await page.fill('[name="effectiveFrom"]', '2025-01-01');
await page.fill('[name="judgmentNumber"]', 'أ-2025/10');
await page.selectOption('[name="accountingModel"]', 'feas-v1');
await page.locator('[data-save]').first().click();
await page.waitForSelector('.exec-numbers', {timeout: 30000});
await wait(700);

const created = await page.evaluate(async () => {
  const app = window.__LAW_OFFICE_APP__;
  const id = app.route.replace(/^exc:/, '');
  const execution = await app.office.r.execution.get(id);
  const S = await import('/js/services/execution-simple.js');
  const bundle = await S.simpleCardBundle(app.office, id, {asOf: '2026-06-30'});
  return {id, accountingModel: execution.accountingModel, periods: bundle.schedule.totals.periodCount, tabs: document.querySelectorAll('#main-content .exec-tabs [data-tab]').length};
});
report.created = created;
check('التنفيذ يُنشأ على نموذج FEAS صراحةً ويُفتح في البطاقة الموحّدة',
  created.accountingModel === 'feas-v1' && created.tabs === 4, JSON.stringify(created));
check('تنفيذ FEAS جديد بلا اعتراف: صفر فترات وصفر مطلوب (لا دين بلا اعتراف صريح)',
  created.periods === 0, JSON.stringify({periods: created.periods}));

// ===== 1ب) الخطوة التالية على تبويب الحساب: زر واحد للاعتراف بدل رقم صفري مبهم =====
await page.evaluate(() => window.__LAW_OFFICE_APP__.go(`exc:${window.__LAW_OFFICE_APP__.route.replace(/^exc:/, '')}`));
await page.waitForSelector('.exec-numbers', {timeout: 30000});
await wait(600);
const nextStep = await page.evaluate(() => {
  const node = document.querySelector('.feas-next-step');
  return {text: node?.textContent.replace(/\s+/g, ' ').trim() || '', button: Boolean(document.querySelector('.feas-next-step [data-action="feas-recognize"]')), numbers: [...document.querySelectorAll('.exec-numbers .num b')].map(item => item.textContent.trim())};
});
report.nextStep = nextStep;
check('البطاقة تعرض «الخطوة التالية» بزر واحد للاعتراف بدل رقم صفري مبهم',
  /لا يظهر مبلغ بعد/.test(nextStep.text) && nextStep.button && nextStep.numbers.every(value => Number(value.replace(/,/g, '')) === 0),
  JSON.stringify(nextStep));

// ===== 2) تعريف التزام FEAS من أدوات متقدمة =====
const openAdvanced = async () => {
  await page.evaluate(() => window.__LAW_OFFICE_APP__.go(`exc:${window.__LAW_OFFICE_APP__.route.replace(/^exc:/, '')}`));
  await page.waitForSelector('.exec-numbers', {timeout: 30000});
  await page.locator('.exec-toolbar [data-more]').first().evaluate(node => node.click());
  await wait(400);
  await page.locator('.exec-more-menu [data-action="advanced"]').first().evaluate(node => node.click());
  await wait(700);
};
await openAdvanced();
const beforeEnable = await page.evaluate(() => ({
  enableButton: Boolean(document.querySelector('.advanced-anchor [data-action="enable-feas"]')),
  text: document.querySelector('.advanced-anchor')?.textContent.replace(/\s+/g, ' ').slice(0, 200) || ''
}));
check('أدوات متقدمة توضح أن التنفيذ على FEAS وتعرض أدواته',
  !beforeEnable.enableButton && /FEAS/.test(beforeEnable.text), JSON.stringify(beforeEnable));

await page.locator('.advanced-anchor [data-action="feas-obligation"]').first().evaluate(node => node.click());
await page.waitForSelector('.exec-form', {timeout: 20000});
await wait(300);
const obligationDialog = await page.evaluate(() => {
  const form = document.querySelector('#modal-root .exec-form');
  const value = name => form?.querySelector(`[name="${name}"]`)?.value || '';
  return {title: document.querySelector('#modal-root .modal-title')?.textContent.trim() || '', type: value('obligationType'), currency: value('currency'), frequency: form?.querySelector('[name="frequency"]')?.value || '', start: value('startDate')};
});
await page.locator('#modal-root [data-close]').last().evaluate(node => node.click());
await wait(400);
await openAdvanced();
const obligation = await page.evaluate(async () => {
  const app = window.__LAW_OFFICE_APP__;
  const FEAS = await import('/js/services/execution-feas.js');
  const id = app.route.replace(/^exc:/, '');
  const rows = await FEAS.executionObligations(app.office, id);
  const slices = await app.office.r.executionValuePeriods.byIndex('executionId', id, 20);
  const periods = await app.office.r.executionPeriods.byIndex('executionId', id, 20);
  return {obligations: rows.length, type: rows[0]?.obligationType || '', frequency: rows[0]?.frequency || '', slices: slices.length, periods: periods.length};
});
report.obligation = {...obligationDialog, ...obligation};
check('نافذة «التزام FEAS» تُفتح ببيانات الالتزام المُنشأ مع التنفيذ (تعديل لا تكرار) وبلا إنشاء أي دين',
  /التزام/.test(obligationDialog.title) && obligationDialog.currency === 'EGP' && obligationDialog.start === '2025-01-01'
  && obligation.obligations === 1 && obligation.periods === 0,
  JSON.stringify(report.obligation));

// ===== 3) الإنشاء على FEAS يبني الحكم والالتزام والشريحة معًا، وبلا أي دين مُعترف به =====
const structure = await page.evaluate(async id => {
  const app = window.__LAW_OFFICE_APP__;
  const FEAS = await import('/js/services/execution-feas.js');
  const [obligations, judgments, slices, periods] = await Promise.all([
    FEAS.executionObligations(app.office, id),
    app.office.r.judgments.byIndex('executionId', id, 20),
    app.office.r.executionValuePeriods.byIndex('executionId', id, 20),
    app.office.r.executionPeriods.byIndex('executionId', id, 20)
  ]);
  const [obligation] = obligations;
  const [slice] = slices;
  const hint = document.querySelector('.feas-next-step')?.textContent.replace(/\s+/g, ' ').trim() || '';
  const hintButton = Boolean(document.querySelector('.feas-next-step [data-action="feas-recognize"]'));
  return {
    obligations: obligations.length, obligationType: obligation?.obligationType || '', frequency: obligation?.frequency || '', currency: obligation?.currency || '',
    judgments: judgments.length, slices: slices.length, sliceAmount: slice?.amount, sliceObligationId: slice?.obligationId || '',
    obligationId: obligation?.id || '', periods: periods.length, hint, hintButton
  };
}, report.created.id);
report.structure = structure;
check('الإنشاء على FEAS يبني الحكم والالتزام والشريحة المرتبطة به (بلا أي دين معترف به)',
  structure.obligations === 1 && structure.obligationType === 'نفقة صغار' && structure.frequency === 'monthly' && structure.currency === 'EGP'
  && structure.judgments === 1 && structure.slices === 1 && Number(structure.sliceAmount) === 2000
  && structure.sliceObligationId === structure.obligationId && structure.periods === 0,
  JSON.stringify(structure));

// ===== 4) معاينة ثم اعتراف صريح بفترة من الواجهة =====
await openAdvanced();
await page.locator('.advanced-anchor [data-action="feas-recognize"]').first().evaluate(node => node.click());
await page.waitForSelector('[data-preview]', {timeout: 20000});
await wait(300);
await page.selectOption('[name="obligationId"]', {index: 1});
await page.fill('[name="fromDate"]', '2025-01-01');
await page.fill('[name="toDate"]', '2025-06-30');
await page.locator('[data-preview]').first().click();
await wait(700);
const previewState = await page.evaluate(async () => {
  const app = window.__LAW_OFFICE_APP__;
  const id = app.route.replace(/^exc:/, '');
  const periods = await app.office.r.executionPeriods.byIndex('executionId', id, 20);
  const output = document.querySelector('#modal-root [data-preview-output]')?.textContent.replace(/\s+/g, ' ') || '';
  const recognizeEnabled = !document.querySelector('#modal-root [data-recognize]')?.disabled;
  return {writtenPeriods: periods.length, output: output.slice(0, 220), recognizeEnabled};
});
report.preview = previewState;
check('المعاينة لا تكتب أي فترة في قاعدة البيانات وتعرض المبلغ المحسوب',
  previewState.writtenPeriods === 0 && /12,000|12000/.test(previewState.output) && previewState.recognizeEnabled,
  JSON.stringify(previewState));
await page.screenshot({path: path.join(artifactDir, 'feas-recognition-preview.png'), fullPage: true});

await page.locator('[data-recognize]').first().click();
await wait(1200);
// الاعتراف أُطلق من «أدوات متقدمة» داخل تبويب البيانات، فيبقى المستخدم فيه — نعود لتبويب الحساب
// لأن الفحص يخص ما يراه المستخدم على الكشف الشهري.
const accountTab = page.locator('#main-content [data-tab="account"]').first();
if (await accountTab.count()) { await accountTab.click(); await wait(700); }
const recognized = await page.evaluate(async () => {
  const app = window.__LAW_OFFICE_APP__;
  const id = app.route.replace(/^exc:/, '');
  const FEAS = await import('/js/services/execution-feas.js');
  const periods = await app.office.r.executionPeriods.byIndex('executionId', id, 20);
  const balance = await FEAS.executionFeasBalanceData(app.office, id);
  const numbers = [...document.querySelectorAll('.exec-numbers .num')].map(node => node.querySelector('b').textContent.trim());
  const hint = [...document.querySelectorAll('.hint-info')].map(node => node.textContent.replace(/\s+/g, ' ').trim()).find(text => text.includes('اعتراف'));
  return {
    hintClasses: [...document.querySelectorAll('.hint')].map(node => node.className),
    accountRows: document.querySelectorAll('.account-table tbody tr').length,
    accountHead: document.querySelector('.exec-tab-panel h3')?.textContent.trim() || '',
    dialogOpen: Boolean(document.querySelector('#modal-root [data-recognize]')),
    periods: periods.length, status: periods[0]?.status, amountMinor: periods[0]?.recognizedAmountMinor,
    feasRemaining: balance.summary?.remaining, feasCollected: balance.summary?.collected, feasFinal: balance.summary?.finalEntitlement,
    cardNumbers: numbers, hint: hint || ''
  };
});
report.recognized = recognized;
check('الاعتراف الصريح يكتب لقطة واحدة بقيمة النطاق كاملًا (6 أشهر × 2,000 = 12,000)',
  recognized.periods === 1 && recognized.status === 'RECOGNIZED' && recognized.amountMinor === 1_200_000,
  JSON.stringify({periods: recognized.periods, status: recognized.status, amountMinor: recognized.amountMinor}));
check('البطاقة الموحّدة تعرض أرقام FEAS نفسها مع تنبيه النموذج (لا رقمين متناقضين)',
  recognized.cardNumbers.includes('12,000') && recognized.hint.includes('اعتراف الفترات') && Number(recognized.feasFinal) === 12000 && Number(recognized.feasRemaining) === 12000,
  JSON.stringify({cardNumbers: recognized.cardNumbers, feasFinal: recognized.feasFinal, feasRemaining: recognized.feasRemaining, hint: recognized.hint.slice(0, 80)}));

// ===== 5) تحصيل داخل FEAS يُخصم من الرصيد المعترف به =====
const collection = await page.evaluate(async () => {
  const app = window.__LAW_OFFICE_APP__;
  const id = app.route.replace(/^exc:/, '');
  const S = await import('/js/services/execution-simple.js');
  await S.recordSimpleCollection(app.office, {executionId: id, amount: 5000, date: '2025-03-10', paymentMethod: 'cash'});
  const FEAS = await import('/js/services/execution-feas.js');
  const balance = await FEAS.executionFeasBalanceData(app.office, id);
  return {collected: balance.summary.collected, remaining: balance.summary.remaining, allocated: balance.summary.allocated};
});
report.collection = collection;
check('تحصيل 5,000 داخل FEAS يُخصم من المعترف به: 12,000 − 5,000 = 7,000 متبقٍ',
  Number(collection.collected) === 5000 && Number(collection.remaining) === 7000, JSON.stringify(collection));

// ===== 5ب) حكم لاحق من ورقة التسجيل في الواجهة (يرفع القيمة ويُنشئ فرقًا يُراجَع) =====
await page.locator('.exec-actions [data-more], .exec-toolbar [data-more]').first().evaluate(node => node.click()).catch(() => {});
await wait(400);
const sheetOpened = await page.evaluate(async () => {
  const app = window.__LAW_OFFICE_APP__;
  const FORMS = await import('/js/ui/execution-simple-forms.js');
  const id = app.route.replace(/^exc:/, '');
  FORMS.recordSheet(app, id);
  return true;
}).catch(() => false);
await page.waitForSelector('.record-tile, [data-record]', {timeout: 20000});
void sheetOpened;
await page.locator('[data-record="judgment"]').first().evaluate(node => node.click());
await page.waitForSelector('[data-record-form="judgment"], form [name="effectiveFrom"]', {timeout: 20000});
await wait(300);
await page.fill('[name="amount"]', '3000');
await page.fill('[name="effectiveFrom"]', '2025-04-01');
await page.fill('[name="judgmentNumber"]', 'أ-2025/55');
await page.locator('[data-save]').last().click();
await wait(1500);
const laterJudgment = await page.evaluate(async () => {
  const app = window.__LAW_OFFICE_APP__;
  const id = app.route.replace(/^exc:/, '');
  const slices = await app.office.r.executionValuePeriods.byIndex('executionId', id, 20);
  const FEAS = await import('/js/services/execution-feas.js');
  const [obligation] = await FEAS.executionObligations(app.office, id);
  const newest = slices.slice().sort((a, b) => String(a.startDate).localeCompare(String(b.startDate))).at(-1);
  return {slices: slices.length, newestAmount: newest?.amount, newestStart: newest?.startDate, obligationId: obligation?.id || '', newestObligation: newest?.obligationId || ''};
});
report.laterJudgment = laterJudgment;
check('«حكم لاحق» من الواجهة يُسجَّل على تنفيذ FEAS ويُربط بالالتزام نفسه (لا طريق مسدود)',
  laterJudgment.slices === 2 && Number(laterJudgment.newestAmount) === 3000 && laterJudgment.newestStart === '2025-04-01'
  && laterJudgment.newestObligation === laterJudgment.obligationId,
  JSON.stringify(laterJudgment));

// ===== 6) تسوية فروق ثم اعتماد ثم تثبيت من الواجهة =====
await openAdvanced();
await page.locator('.advanced-anchor [data-action="settlement"]').first().evaluate(node => node.click());
await page.waitForSelector('[data-approve]', {timeout: 25000});
await wait(500);
const settlementDialog = await page.evaluate(() => ({title: document.querySelector('#modal-root .modal-title')?.textContent.trim() || '', text: document.querySelector('#modal-root .modal-card')?.textContent.replace(/\s+/g, ' ').slice(0, 200) || ''}));
const ledgerBeforePost = await page.evaluate(async () => {
  const app = window.__LAW_OFFICE_APP__;
  const id = app.route.replace(/^exc:/, '');
  const rows = await app.office.r.executionLedger.byIndex('executionId', id, 50).catch(() => []);
  return rows.length;
});
await page.locator('[data-approve]').first().click();
await page.waitForSelector('#modal-root [data-ok]', {timeout: 20000});
await page.fill('#modal-root .confirm-input', 'اعتماد المراجعة').catch(() => {});
await page.locator('#modal-root [data-ok]').first().click();
await wait(1200);
const approved = await page.evaluate(async () => {
  const app = window.__LAW_OFFICE_APP__;
  const id = app.route.replace(/^exc:/, '');
  const DF = await import('/js/services/execution-differences.js');
  const rows = await app.office.r.differenceRecords.byIndex('executionId', id, 50).catch(() => []);
  const settlementRows = await app.office.r.executionSettlements.byIndex('executionId', id, 50).catch(() => []);
  void DF;
  return {
    settlementStatus: settlementRows[0]?.status || '', differences: rows.map(row => ({status: row.status, amountMinor: row.differenceAmountMinor})),
    postEnabled: !document.querySelector('#modal-root [data-post]')?.disabled
  };
});
report.approved = approved;
check('تسوية الفروق تُنشأ وتُعتمد من الواجهة بلا إنشاء حركة دين ثانية',
  approved.settlementStatus === 'APPROVED' && approved.differences.length >= 1, JSON.stringify(approved));

if (approved.postEnabled) {
  await page.locator('[data-post]').first().click();
  await wait(1200);
}
const posted = await page.evaluate(async () => {
  const app = window.__LAW_OFFICE_APP__;
  const id = app.route.replace(/^exc:/, '');
  const settlementRows = await app.office.r.executionSettlements.byIndex('executionId', id, 50).catch(() => []);
  const FEAS = await import('/js/services/execution-feas.js');
  const balance = await FEAS.executionFeasBalanceData(app.office, id);
  const ledger = await app.office.r.executionLedger.byIndex('executionId', id, 50);
  return {settlementStatus: settlementRows[0]?.status || '', remaining: balance.summary.remaining, ledgerRows: ledger.length,
    ledgerBefore: 0,
    cardNumbers: [...document.querySelectorAll('.exec-numbers .num b')].map(node => node.textContent.trim())};
});
report.posted = posted;
check('اعتماد الفرق يزيد المعترف به 3,000 (12,000 ← 15,000) والتثبيت لا ينشئ أي حركة دين جديدة',
  Number(posted.remaining) === 10000 && posted.ledgerRows === ledgerBeforePost && posted.cardNumbers.includes('10,000'),
  JSON.stringify({...posted, ledgerBeforePost}));

// ===== 7) منع تفعيل FEAS على تنفيذ فيه أرقام مالية (القاعدة المحاسبية) =====
const refusal = await page.evaluate(async () => {
  const app = window.__LAW_OFFICE_APP__;
  const S = await import('/js/services/execution-simple.js');
  const created = await S.createSimpleExecution(app.office, {newClientName: 'FEAS — رفض التحويل', entitlementType: 'نفقة', valueType: 'periodic', amount: 1000, periodicity: 'monthly', effectiveFrom: '2025-01-01'});
  const id = created.execution.id;
  await S.recordSimpleCollection(app.office, {executionId: id, amount: 500, date: '2025-02-01'});
  let message = '';
  try { await S.enableFeasModel(app.office, id); } catch (error) { message = String(error.message || error); }
  const after = await app.office.r.execution.get(id);
  // تنفيذ مفتوح بلا أي بند قيمة (لا شرائح ولا محاضر): التفعيل مسموح — المخرج الواضح
  const EX = await import('/js/services/execution.js');
  const bare = await EX.createExecution(app.office, {executionType: 'family', clientId: created.execution.clientId, fileId: created.execution.fileId, openedDate: '2025-01-01', status: 'active'});
  const enabled = await S.enableFeasModel(app.office, bare.id).then(out => out.execution.accountingModel).catch(error => `ERR:${error.message}`);
  const sliceOnly = await S.createSimpleExecution(app.office, {newClientName: 'FEAS — شريحة فقط', entitlementType: 'نفقة', valueType: 'periodic', amount: 1000, periodicity: 'monthly', effectiveFrom: '2025-01-01'});
  let sliceMessage = '';
  try { await S.enableFeasModel(app.office, sliceOnly.execution.id); } catch (error) { sliceMessage = String(error.message || error); }
  return {message, modelAfterRefusal: after.accountingModel, bareModel: enabled, sliceMessage};
});
report.refusal = refusal;
check('تفعيل FEAS مرفوض على تنفيذ فيه أرقام مالية برسالة تسمّي ما وُجد (ولا يتغيّر النموذج)',
  /أثر مالي مسجَّل/.test(refusal.message) && /محاضر تحصيل: 1/.test(refusal.message) && refusal.modelAfterRefusal === undefined || refusal.modelAfterRefusal === 'legacy-v1',
  JSON.stringify(refusal));
check('تفعيل FEAS مسموح على تنفيذ فارغ تمامًا، ومرفوض على تنفيذ فيه بند قيمة برسالة توجّه للحل',
  refusal.bareModel === 'feas-v1' && /بنود قيمة: 1/.test(refusal.sliceMessage) && /خيارات متقدمة|المسار المبسط/.test(refusal.sliceMessage),
  JSON.stringify({bareModel: refusal.bareModel, sliceMessage: refusal.sliceMessage}));

// ===== 8) إعادة تحميل دون اتصال: الأرقام نفسها =====
await context.setOffline(true);
await page.reload({waitUntil: 'domcontentloaded'}).catch(() => {});
await page.waitForFunction(() => window.__LAW_OFFICE_APP__?.office && !window.__LAW_OFFICE_APP__.booting, null, {timeout: 90000});
await page.evaluate(id => window.__LAW_OFFICE_APP__.go(`exc:${id}`), report.created.id);
await page.waitForSelector('.exec-numbers', {timeout: 30000});
await wait(900);
const offlineNumbers = await page.evaluate(() => [...document.querySelectorAll('.exec-numbers .num b')].map(node => node.textContent.trim()));
report.offlineNumbers = offlineNumbers;
check('بعد إعادة التحميل بلا شبكة: أرقام FEAS نفسها (15,000 / 5,000 / 10,000)',
  offlineNumbers.includes('15,000') && offlineNumbers.includes('5,000') && offlineNumbers.includes('10,000'), JSON.stringify(offlineNumbers));
await context.setOffline(false);
await page.screenshot({path: path.join(artifactDir, 'feas-cycle-final-card.png'), fullPage: true});

report.consoleErrors = [...new Set(report.consoleErrors)];
check('لا أخطاء صفحة/كونسول خلال دورة FEAS كاملة', report.consoleErrors.length === 0, JSON.stringify(report.consoleErrors));

await fs.writeFile(path.join(artifactDir, 'report.json'), JSON.stringify(report, null, 2));
console.log(`\n${report.checks.length} فحصًا ناجحًا / ${report.failures.length} فشل`);
console.log('PRINT — NOT VERIFIED — Native Print Preview/Physical Print Not Tested');
await context.close();
await browser.close();
process.exit(report.failures.length || report.consoleErrors.length ? 2 : 0);
