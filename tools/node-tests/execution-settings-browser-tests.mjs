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

const modalCount = () => page.locator('#modal-root .modal-card').count();
/** عدد القوائم/القوائم المنسدلة الظاهرة (زر «المزيد» يفتح قائمة لا نافذة). */
const openMenuCount = () => page.evaluate(() => [...document.querySelectorAll('[class*="menu"],[class*="dropdown"],[class*="popover"],[role="menu"]')]
  .filter(node => node.offsetParent !== null).length);
/** ينقر عنصرًا ويتوقع أثرًا مرئيًا (نافذة أو قائمة) — ثم يُغلقه بلا أثر. */
const expectModal = async selector => {
  const node = page.locator(selector).first();
  assert.ok(await node.count(), `عنصر مفقود: ${selector}`);
  const before = {modals: await modalCount(), menus: await openMenuCount()};
  await node.click({force: true});
  await page.waitForTimeout(900);
  const after = {modals: await modalCount(), menus: await openMenuCount()};
  const opened = after.modals > before.modals || after.menus > before.menus;
  const title = after.modals ? ((await page.locator('#modal-root .modal-title').first().textContent().catch(() => '')) || '').trim().slice(0, 30) : 'قائمة';
  if (!opened) return {opened: false, title: '', before, after};
  await page.evaluate(() => { for (const b of document.querySelectorAll('#modal-root [data-close], #modal-root [data-cancel]')) b.click(); });
  await page.keyboard.press('Escape').catch(() => {});
  await page.locator('body').click({position: {x: 6, y: 6}}).catch(() => {});
  await page.waitForTimeout(500);
  return {opened: true, title};
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

await verify('تنفيذ 3,000 من اليوم: المطلوب صفر يوم البداية (بعد اكتمال الفترة)، و«+شهر» يعطي «مطلوب حتى 04/11/2026» = 3,000', async () => {
  assert.equal((await numbers()).due, 0, 'المطلوب في يوم الفتح يجب أن يكون صفرًا');
  assert.ok((await page.locator('.exec-summary').textContent()).includes('فترة جارية'), 'الفترة الجارية غير ظاهرة يوم البداية');
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
  assert.equal((await numbers()).due, 0, 'المطلوب بعد الرجوع إلى اليوم');
  await page.locator('.exec-summary [data-settings]').first().click();
  await page.waitForSelector('#modal-root [data-form="settings"]', {timeout: 15000});
  assert.equal(await page.locator('#modal-root [data-form="settings"] [name="accrualTiming"] option').count(), 2, 'خيارا توقيت الاستحقاق');
  for (const name of ['periodBasis', 'startPolicy', 'midChangePolicy', 'endPolicy', 'allocationOrder', 'defaultCurrency', 'entitlementTypes', 'executionMethods', 'collectionMethods', 'actionKinds', 'expenseTypes', 'borneBy', 'laterJudgmentKinds']) {
    assert.equal(await page.locator(`#modal-root [data-form="settings"] [name="${name}"]`).count(), 1, `حقل غير قابل للتعديل: ${name}`);
  }
  assert.equal(await page.locator('#modal-root [data-form="settings"] [data-templates]').count(), 1, 'زر قوالب الطباعة');
  await shot('03-settings-dialog.png');
  // تغيير حقيقي: «من بداية الفترة» ⇒ الفترة التي تبدأ اليوم تُستحق فورًا.
  await page.locator('#modal-root [data-form="settings"] [name="accrualTiming"]').selectOption('AT_PERIOD_START');
  await page.locator('#modal-root [data-form="settings"] [data-save]').click();
  await wait(1600);
  assert.equal(await page.locator('#modal-root [data-form="settings"]').count(), 0, 'النافذة لم تُغلق بعد الحفظ الناجح');
  assert.equal((await numbers()).due, 3000, 'توقيت «من بداية الفترة» يجب أن يستحق الفترة اليوم');
  // إعادة القاعدة الافتراضية من الشاشة نفسها.
  await page.locator('.exec-summary [data-settings]').first().click();
  await page.waitForSelector('#modal-root [data-form="settings"]', {timeout: 15000});
  await page.locator('#modal-root [data-form="settings"] [name="accrualTiming"]').selectOption('AFTER_PERIOD_END');
  await page.locator('#modal-root [data-form="settings"] [data-save]').click();
  await wait(1600);
  assert.equal((await numbers()).due, 0, 'الأرقام لم تعد بعد إعادة الإعداد الافتراضي');
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

await verify('«احسب مدة» بمبلغ يدوي: مذكرة 12,600 بمعادلاتها ولا تُغيّر الرصيد المسجَّل', async () => {
  await page.evaluate(id => window.__LAW_OFFICE_APP__.go(`exc:${id}`), executionId);
  await page.waitForSelector('.exec-numbers', {timeout: 30000});
  await page.waitForTimeout(900);
  const before = await numbers();
  await page.locator('.exec-quick-card [data-open-duration]').click();
  await page.waitForSelector('#modal-root [data-form="duration"]', {timeout: 15000});
  const form = '#modal-root [data-form="duration"]';
  await page.locator(`${form} [name="fromDate"]`).fill('2026-10-05');
  await page.locator(`${form} [name="toDate"]`).fill('2027-01-04');
  await page.locator(`${form} [name="manualAmount"]`).fill('4000');
  await page.locator(`${form} [name="manualFees"]`).fill('500');
  await page.locator(`${form} [name="manualStamps"]`).fill('100');
  await page.locator(`${form} [data-use-manual]`).check();
  await page.locator(`${form} [data-save]`).click();
  await page.waitForTimeout(1200);
  const result = (await page.locator(`${form} [data-result]`).textContent()).replace(/\s+/g, ' ');
  assert.ok(result.includes('12,600'), `الإجمالي اليدوي غير صحيح: ${result.slice(0, 220)}`);
  assert.ok(/3/.test(result), `عدد الفترات غير ظاهر: ${result.slice(0, 160)}`);
  assert.ok(result.includes('مذكرة'), 'تنبيه «مذكرة يدوية لا تغيّر الرصيد» مفقود');
  await page.screenshot({path: path.join(artifactDir, '07-manual-memo.png')});
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  const after = await numbers();
  assert.deepEqual(after, before, `الرصيد المسجَّل تأثر بالمذكرة: ${JSON.stringify({before, after})}`);
});

await verify('لا زر ميت في مركز التنفيذ: كل عنصر تحكم يفتح نافذته (القائمة والبطاقة)', async () => {
  await page.evaluate(() => window.__LAW_OFFICE_APP__.go('executionCenter'));
  await page.waitForSelector('#exec-grid tbody tr[data-i]', {timeout: 30000});
  await page.waitForTimeout(1200);
  const listReport = {};
  for (const selector of ['[data-new-execution]', '[data-help]', '[data-customize-page]', '[data-exec-trash]', '[data-settings]', '[data-exec-clear]']) {
    const out = await expectModal(selector).catch(error => ({opened: false, title: error.message}));
    listReport[selector] = `${out.opened ? 'فعّال' : 'ميت'}${out.title ? ` — ${out.title}` : ''}`;
    assert.ok(out.opened, `زر بلا أثر في صفحة القائمة: ${selector}`);
  }
  await page.evaluate(id => window.__LAW_OFFICE_APP__.go(`exc:${id}`), executionId);
  await page.waitForSelector('.exec-numbers', {timeout: 30000});
  await page.waitForTimeout(1000);
  const cardReport = {};
  for (const selector of ['[data-more]', '[data-open-duration]', '[data-open-statement]', '[data-record]', '[data-action="collection"]', '.exec-summary [data-settings]']) {
    const out = await expectModal(selector).catch(error => ({opened: false, title: error.message}));
    cardReport[selector] = `${out.opened ? 'فعّال' : 'ميت'}${out.title ? ` — ${out.title}` : ''}`;
    assert.ok(out.opened, `زر بلا أثر في البطاقة: ${selector}`);
  }
  report.controlSweep = {list: listReport, card: cardReport};
});

await verify('لا أخطاء صفحة/كونسول خلال الرحلة كلها', async () => { assert.deepEqual(report.errors, []); });

/* ======================= الموبايل: نفس الرحلات بعرض ضيق =======================
   المكتب يستخدم الهاتف فعليًا؛ نتحقق أن الأفق والإعدادات والتوكيل تبقى صالحة
   للعمل بلمسة واحدة وبلا عناصر خارجة عن الشاشة. */
const mobile = await browser.newContext({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, serviceWorkers: 'block', locale: 'ar-EG'});
await mobile.route('https://fonts.googleapis.com/**', route => route.fulfill({body: '', contentType: 'text/css'}));
const phone = await mobile.newPage();
const phoneErrors = [];
phone.on('pageerror', error => phoneErrors.push(`pageerror: ${error.message}`));
phone.on('console', message => { if (message.type() === 'error' && !/favicon|fonts\.google/.test(message.text())) phoneErrors.push(`console: ${message.text()}`); });
const phoneWait = ms => phone.waitForTimeout(ms);

await phone.goto(`${base}/index.html`, {waitUntil: 'domcontentloaded'});
await phone.waitForFunction(() => window.__LAW_OFFICE_APP__?.office && !window.__LAW_OFFICE_APP__.booting && !document.querySelector('.error-box'), null, {timeout: 60000});
const phoneExecutionId = await phone.evaluate(async () => {
  const app = window.__LAW_OFFICE_APP__;
  const S = await import('./js/services/execution-simple.js');
  const {localDate} = await import('./js/core/clock.js');
  const created = await S.createSimpleExecution(app.office, {
    newClientName: 'عميل فحص الموبايل', opponentName: 'خصم فحص الموبايل', entitlementType: 'نفقة صغار',
    valueType: 'periodic', periodicity: 'monthly', amount: '3000', effectiveFrom: localDate(),
    judgmentNumber: '888/2026', court: 'محكمة الأسرة', executionType: 'family'
  });
  return created.execution.id;
});
await phone.evaluate(id => window.__LAW_OFFICE_APP__.go(`exc:${id}`), phoneExecutionId);
await phone.waitForSelector('.exec-numbers', {timeout: 30000});
await phoneWait(1000);

await verify('الموبايل: البطاقة والأرقام والأفق ظاهرة بلا عناصر خارجة عن الشاشة', async () => {
  const due = money(await phone.locator('.exec-numbers .num b').nth(0).textContent());
  assert.equal(due, 0, `المطلوب على الهاتف يوم البداية ${due}`);
  for (const selector of ['[data-horizon-picker] [data-asof]', '[data-horizon-preset="plus-1"]', '.exec-quick-card [data-settings]', '.exec-quick-card [data-action="poa"]']) {
    assert.equal(await phone.locator(selector).first().isVisible(), true, `عنصر غير مرئي على الهاتف: ${selector}`);
  }
  const overflow = await phone.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth));
  assert.ok(overflow <= 8, `الشاشة تتجاوز العرض بـ${overflow}px`);
  await phone.screenshot({path: path.join(artifactDir, '05-mobile-card.png')});
});

await verify('الموبايل: اختيار 04/01/2027 يعطي 9,000، والإعدادات تُفتح وتُحفظ بلمسة', async () => {
  await phone.locator('[data-horizon-picker] [data-asof]').fill('2027-01-04');
  await phone.locator('[data-horizon-picker] [data-asof]').dispatchEvent('change');
  await phoneWait(1400);
  const due = money(await phone.locator('.exec-numbers .num b').nth(0).textContent());
  assert.equal(due, 9000, `المطلوب على الهاتف حتى 04/01/2027 = ${due}`);
  await phone.locator('.exec-quick-card [data-settings]').click();
  await phone.waitForSelector('#modal-root [data-form="settings"]', {timeout: 15000});
  const saveVisible = await phone.locator('#modal-root [data-form="settings"] [data-save]').isVisible();
  assert.ok(saveVisible, 'زر الحفظ غير مرئي على الهاتف');
  await phone.locator('#modal-root [data-form="settings"] [name="accrualTiming"]').selectOption('AT_PERIOD_START');
  await phone.locator('#modal-root [data-form="settings"] [data-save]').click();
  await phoneWait(1800);
  assert.equal(await phone.locator('#modal-root [data-form="settings"]').count(), 0, 'النافذة لم تُغلق على الهاتف');
  const stored = await phone.evaluate(async () => {
    const app = window.__LAW_OFFICE_APP__;
    const S = await import('./js/services/execution-settings.js');
    return S.executionSettings(app.office).schedule.accrualTiming;
  });
  assert.equal(stored, 'AT_PERIOD_START', 'الإعداد لم يُحفظ من الهاتف');
  await phone.screenshot({path: path.join(artifactDir, '06-mobile-settings-saved.png')});
  assert.deepEqual(phoneErrors, [], `أخطاء على الهاتف: ${phoneErrors.join(' | ')}`);
});

await mobile.close();

report.consoleErrors = [...new Set(report.errors)];
await fs.writeFile(path.join(artifactDir, 'report.json'), JSON.stringify(report, null, 2));
console.log(`\n${report.checks.filter(row => row.status === 'PASS').length} فحصًا ناجحًا / ${report.failures.length} فشل`);
console.log('PRINT — NOT VERIFIED — Native Print Preview/Physical Print Not Tested');
await context.close();
await browser.close();
process.exit(report.failures.length || report.errors.length ? 2 : 0);
