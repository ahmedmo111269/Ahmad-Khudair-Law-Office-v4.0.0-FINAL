// =====================================================================
// فحص سلوكي حقيقي في Chromium لشاشة إعدادات مركز التنفيذ وأفق الحساب
// (يتطلب خدمة ملفات محلية).
// التشغيل:  GRID_BASE_URL=http://127.0.0.1:8000 node execution-settings-browser-tests.mjs
// ---------------------------------------------------------------------
// يثبت في متصفح فعلي الرحلات التي شكا منها المستخدم:
//   1) تنفيذ 3,000 من اليوم ← «+شهر» = 04/11/2026 = 3,000
//   2) كتابة 04/01/2027 ← 3 فترات = 9,000 والمعادلة ظاهرة (بلا قصّ صامت)
//   3) الإعدادات تُفتح من البطاقة، والحفظ ينعكس فورًا على الرقم بلا إعادة تحميل
//   4) التوكيل يُبنى على نطاقه كاملًا مع رسوم/دمغة يدوية (9,600)
//   5) قوالب الطباعة تُعدَّل وتُحفظ فعلًا من داخل الإعدادات
//   6) لا أخطاء صفحة/كونسول خلال الرحلة
// ملاحظة: لا يقود هذا الفحص معاينة الطباعة الأصلية ولا طابعة فعلية.
// =====================================================================
import {chromium} from 'playwright';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const base = (process.env.GRID_BASE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
const artifactDir = path.join(repository, '.cache', 'execution-settings-browser');
await fs.mkdir(artifactDir, {recursive: true});

const report = {
  suite: 'execution-settings-browser',
  date: new Date().toISOString(),
  base,
  checks: [],
  failures: [],
  errors: [],
  screenshots: [],
  printVerification: 'NOT VERIFIED — Print Preview/Physical Print Not Tested'
};

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
report.browser = browser.version();

const context = await browser.newContext({viewport: {width: 1440, height: 1000}, serviceWorkers: 'block', locale: 'ar-EG'});
// نُقصر الشبكة الخارجية على لا شيء: الصفحة يجب أن تعمل محليًا بالكامل.
await context.route('https://fonts.googleapis.com/**', route => route.fulfill({body: '', contentType: 'text/css'}));
const page = await context.newPage();
page.on('pageerror', error => { report.errors.push(`pageerror: ${error.message}`); console.log(`  ! pageerror: ${error.message}`); });
page.on('console', message => {
  if (message.type() !== 'error') return;
  if (/favicon|fonts\.google/.test(message.text())) return;
  report.errors.push(`console: ${message.text()}`);
  console.log(`  ! console: ${message.text().slice(0, 180)}`);
});

const wait = ms => page.waitForTimeout(ms);
const money = text => Number(String(text).replace(/[^\d.-]/g, ''));
const numbers = async () => {
  const nodes = page.locator('.exec-numbers .num b');
  return {due: money(await nodes.nth(0).textContent()), paid: money(await nodes.nth(1).textContent()), remaining: money(await nodes.nth(2).textContent())};
};
const shot = async name => { await page.screenshot({path: path.join(artifactDir, name), fullPage: false}); report.screenshots.push(name); };
const verify = async (name, fn) => {
  try {
    await fn();
    report.checks.push({name, status: 'PASS'});
    console.log(`PASS — ${name}`);
  } catch (error) {
    report.failures.push(`${name} → ${error.message}`);
    report.checks.push({name, status: 'FAIL', error: error.message});
    console.log(`FAIL — ${name} → ${error.message}`);
  }
};

await page.goto(`${base}/index.html`, {waitUntil: 'domcontentloaded'});
await page.waitForFunction(() => window.__LAW_OFFICE_APP__?.office && !window.__LAW_OFFICE_APP__.booting && !document.querySelector('.error-box'), null, {timeout: 60000});
const today = await page.evaluate(async () => (await import('./js/core/clock.js')).localDate());
report.today = today;
console.log(`\n=== فحص الإعدادات وأفق الحساب في Chromium — ${today} ===\n`);

// تنفيذ مرجعي: 3,000 شهريًا يبدأ اليوم (تاريخ ارتكاز 05 من الشهر).
const executionId = await page.evaluate(async () => {
  const app = window.__LAW_OFFICE_APP__;
  const S = await import('./js/services/execution-simple.js');
  const {localDate} = await import('./js/core/clock.js');
  const created = await S.createSimpleExecution(app.office, {
    newClientName: 'عميل فحص الإعدادات', opponentName: 'خصم فحص الإعدادات', entitlementType: 'نفقة صغار',
    valueType: 'periodic', periodicity: 'monthly', amount: '3000', effectiveFrom: localDate(),
    judgmentNumber: '777/2026', court: 'محكمة الأسرة', executionType: 'family'
  });
  return created.execution.id;
});
await page.evaluate(id => window.__LAW_OFFICE_APP__.go(`exc:${id}`), executionId);
await page.waitForSelector('.exec-numbers', {timeout: 30000});
await wait(1000);

await verify('تنفيذ 3,000 من اليوم: المطلوب 3,000، و«+شهر» يعطي «مطلوب حتى 04/11/2026» = 3,000', async () => {
  assert.equal((await numbers()).due, 3000, 'المطلوب في يوم الفتح');
  await page.locator('[data-horizon-preset="plus-1"]').click();
  await wait(1400);
  assert.equal((await numbers()).due, 3000, 'المطلوب حتى 04/11/2026');
  const info = await page.locator('[data-horizon-info]').textContent();
  assert.ok(info.includes('04/11/2026'), `التاريخ المعروض: ${info.slice(0, 140)}`);
  await shot('01-horizon-plus-month.png');
});

await verify('04/01/2027 = 3 فترات = 9,000 والاختصار ظاهر (بلا قصّ صامت)', async () => {
  await page.locator('[data-horizon-picker] [data-asof]').fill('2027-01-04');
  await page.locator('[data-horizon-picker] [data-asof]').dispatchEvent('change');
  await wait(1400);
  assert.equal((await numbers()).due, 9000, 'المطلوب حتى 04/01/2027');
  const card = await page.locator('.exec-quick-card').textContent();
  assert.ok(/3 × 3,000/.test(card), `المعادلة غير ظاهرة: ${card.slice(0, 200)}`);
  assert.equal(await page.locator('[data-horizon-capped]').count(), 0, 'ظهر إنذار قصّ بلا مبرر');
  await shot('02-horizon-2027.png');
});

await verify('الإعدادات تُفتح من البطاقة، وكل قواعدها قابلة للتعديل، والحفظ ينعكس على الرقم فورًا', async () => {
  await page.locator('[data-horizon-preset="today"]').click();
  await wait(1200);
  assert.equal((await numbers()).due, 3000, 'المطلوب بعد الرجوع إلى اليوم');
  await page.locator('.exec-summary [data-settings]').first().click();
  await page.waitForSelector('#modal-root [data-form="settings"]', {timeout: 15000});
  assert.equal(await page.locator('#modal-root [data-form="settings"] [name="accrualTiming"] option').count(), 2, 'خيارا توقيت الاستحقاق');
  for (const name of ['periodBasis', 'startPolicy', 'midChangePolicy', 'endPolicy', 'allocationOrder', 'defaultCurrency', 'entitlementTypes', 'executionMethods', 'collectionMethods', 'actionKinds', 'expenseTypes', 'borneBy', 'laterJudgmentKinds']) {
    assert.equal(await page.locator(`#modal-root [data-form="settings"] [name="${name}"]`).count(), 1, `حقل غير قابل للتعديل: ${name}`);
  }
  assert.equal(await page.locator('#modal-root [data-form="settings"] [data-templates]').count(), 1, 'زر قوالب الطباعة');
  await shot('03-settings-dialog.png');
  // تغيير حقيقي: «بعد اكتمال الفترة» ⇒ لا استحقاق اليوم مع إظهار الفترة الجارية بمبلغها.
  await page.locator('#modal-root [data-form="settings"] [name="accrualTiming"]').selectOption('AFTER_PERIOD_END');
  await page.locator('#modal-root [data-form="settings"] [data-save]').click();
  await wait(1600);
  assert.equal(await page.locator('#modal-root [data-form="settings"]').count(), 0, 'النافذة لم تُغلق بعد الحفظ الناجح');
  assert.equal((await numbers()).due, 0, 'توقيت «بعد اكتمال الفترة» يجب أن يوقف استحقاق اليوم');
  assert.ok((await page.locator('.exec-summary').textContent()).includes('فترة جارية'), 'سطر الفترة الجارية غير ظاهر');
  // إعادة القاعدة الافتراضية من الشاشة نفسها.
  await page.locator('.exec-summary [data-settings]').first().click();
  await page.waitForSelector('#modal-root [data-form="settings"]', {timeout: 15000});
  await page.locator('#modal-root [data-form="settings"] [name="accrualTiming"]').selectOption('AT_PERIOD_START');
  await page.locator('#modal-root [data-form="settings"] [data-save]').click();
  await wait(1600);
  assert.equal((await numbers()).due, 3000, 'الأرقام لم تعد بعد إعادة الإعداد');
});

await verify('التوكيل: يُبنى على نطاقه كاملًا (3 فترات) + رسوم 500 ودمغة 100 = 9,600', async () => {
  await page.locator('.exec-quick-card [data-action="poa"]').click();
  await page.waitForSelector('#modal-root [data-form="poa"]', {timeout: 15000});
  await page.locator('#modal-root [data-form="poa"] [name="fromDate"]').fill('2026-10-05');
  await page.locator('#modal-root [data-form="poa"] [name="toDate"]').fill('2027-01-04');
  await page.locator('#modal-root [data-form="poa"] [name="fees"]').fill('500');
  await page.locator('#modal-root [data-form="poa"] [name="stamps"]').fill('100');
  await wait(1500);
  const preview = await page.locator('#modal-root [data-form="poa"] [data-preview]').textContent();
  assert.ok(preview.includes('9,600'), `الإجمالي غير صحيح: ${preview.slice(0, 220)}`);
  assert.ok(/3 × 3,000/.test(preview), `معادلة الفترات مفقودة: ${preview.slice(0, 220)}`);
  assert.ok(preview.includes('رسوم') && preview.includes('دمغة'), 'سطرا الرسوم والدمغة غير ظاهرين');
  await shot('04-poa-fees-stamps.png');
  await page.keyboard.press('Escape');
  await wait(400);
});

await verify('قوالب الطباعة: تُفتح من داخل الإعدادات وتُحفظ فعلاً', async () => {
  await page.locator('.exec-summary [data-settings]').first().click();
  await page.waitForSelector('#modal-root [data-form="settings"]', {timeout: 15000});
  await page.locator('#modal-root [data-templates]').click();
  await page.waitForSelector('#modal-root [data-form="templates"]', {timeout: 15000});
  const editor = page.locator('#modal-root [data-form="templates"] textarea[name="body"]');
  const before = await editor.inputValue();
  assert.ok(before.length > 20, 'نص القالب الافتراضي فارغ');
  await editor.fill(`${before}\nسطر فحص`);
  await page.locator('#modal-root [data-form="templates"] [data-save]').click();
  await wait(1600);
  const saved = await page.evaluate(async () => {
    const app = window.__LAW_OFFICE_APP__;
    const PRINT = await import('./js/services/execution-print.js');
    const rows = await PRINT.templatesFor(app.office);
    return JSON.stringify(rows).includes('سطر فحص');
  });
  assert.ok(saved, 'القالب المعدَّل لم يُحفظ');
});

await verify('لا أخطاء صفحة/كونسول خلال الرحلة كلها', async () => { assert.deepEqual(report.errors, []); });

report.consoleErrors = [...new Set(report.errors)];
await fs.writeFile(path.join(artifactDir, 'report.json'), JSON.stringify(report, null, 2));
console.log(`\n${report.checks.filter(row => row.status === 'PASS').length} فحصًا ناجحًا / ${report.failures.length} فشل`);
console.log('PRINT — NOT VERIFIED — Native Print Preview/Physical Print Not Tested');
await context.close();
await browser.close();
process.exit(report.failures.length || report.errors.length ? 2 : 0);
