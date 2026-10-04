// =====================================================================
// فحص سلوكي حقيقي لقسم التنفيذ المبسّط في Chromium (يتطلب خدمة ملفات محلية).
// التشغيل:  GRID_BASE_URL=http://127.0.0.1:8000 node execution-simple-browser-tests.mjs
// ---------------------------------------------------------------------
// يقيس الرحلات الثمانية المطلوبة بعدد نقرات فعلي: إنشاء/فتح البطاقة، قراءة
// المدفوع والمتبقي بلا نقر، تحصيل، إجراء، حساب مدة، حكم لاحق، كشف/توكيل،
// تعديل/إلغاء من الصف. لا يقود هذا الفحص معاينة الطباعة الأصلية للنظام ولا
// طابعة فعلية — يُستبدل window.print بعدّاد، ويُسجَّل ذلك في التقرير.
// =====================================================================
import {chromium} from 'playwright';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const base = (process.env.GRID_BASE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
const artifactDir = path.join(repository, '.cache', 'execution-simple-browser');
await fs.mkdir(artifactDir, {recursive: true});

const report = {
  suite: 'execution-simple-browser',
  date: new Date().toISOString(),
  base,
  checks: [],
  failures: [],
  errors: [],
  clicks: {},
  screenshots: [],
  printVerification: 'NOT VERIFIED — Print Preview/Physical Print Not Tested (window.print is stubbed and counted)'
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

const context = await browser.newContext({viewport: {width: 1440, height: 1000}, serviceWorkers: 'block', locale: 'ar-EG'});
await context.addInitScript(() => {
  window.__printDocs = [];
  window.print = () => { window.__printRequested = (window.__printRequested || 0) + 1; };
  const originalOpen = window.open;
  window.open = (url, name, features) => {
    try { window.__printDocs.push(String(url || '').slice(0, 30)); } catch { /* noop */ }
    return originalOpen ? originalOpen.call(window, url, name, features) : null;
  };
});
await context.route('https://fonts.googleapis.com/**', route => route.fulfill({body: '', contentType: 'text/css'}));
const page = await context.newPage();
const popups = [];
context.on('page', popup => { popups.push(popup); popup.on('pageerror', error => report.errors.push(`popup: ${error.message}`)); });
page.on('pageerror', error => { report.errors.push(`pageerror: ${error.message}`); console.log(`  ! pageerror: ${error.message}`); });
page.on('console', message => {
  if (message.type() !== 'error') return;
  const text = message.text();
  if (/ERR_CONNECTION_CLOSED|favicon|fonts\.google/.test(text)) return;
  report.errors.push(`console: ${text}`);
  console.log(`  ! console: ${text.slice(0, 180)}`);
});

const clicks = (key, n) => { report.clicks[key] = (report.clicks[key] || 0) + n; };
/** نقرة حقيقية على العنصر نفسه (بلا مطاردة إحداثيات مع شبكات متحركة). */
const tap = async locator => { await locator.first().evaluate(node => node.click()); };
const closeAllModals = async () => {
  for (let i = 0; i < 6; i += 1) {
    if (!await page.locator('#modal-root .modal-card').count()) return;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
  }
  const closers = page.locator('#modal-root [data-close]');
  for (let i = 0; i < await closers.count(); i += 1) await closers.nth(i).click({force: true}).catch(() => {});
  await page.waitForTimeout(300);
};
const shot = async (name) => { const file = path.join(artifactDir, name); await page.screenshot({path: file, fullPage: false}); report.screenshots.push(name); return file; };
const money = text => Number(String(text).replace(/[^\d.-]/g, ''));
const modal = () => page.locator('#modal-root');
const cardNumbers = async () => {
  const nodes = page.locator('.exec-numbers .num b');
  return {due: money(await nodes.nth(0).textContent()), paid: money(await nodes.nth(1).textContent()), remaining: money(await nodes.nth(2).textContent())};
};

await page.goto(`${base}/index.html`, {waitUntil: 'domcontentloaded'});
await page.waitForFunction(() => window.__LAW_OFFICE_APP__?.office && !window.__LAW_OFFICE_APP__.booting && !document.querySelector('.error-box'), null, {timeout: 60000});
await page.evaluate(() => window.__LAW_OFFICE_APP__.maintenance);
await page.evaluate(() => window.__LAW_OFFICE_APP__.go('executionCenter'));
await page.waitForSelector('#exec-grid tbody tr[data-i]', {timeout: 30000});

/* ---------------------------------------------------------------- S1 */
let exampleId = '';
await verify('مركز التنفيذ يعرض شبكة حقيقية بعدّادات قابلة للنقر', async () => {
  const counters = await page.locator('[data-counters] .counter').count();
  assert.equal(counters, 4, `عدد العدّادات ${counters}`);
  await page.waitForFunction(() => !/…/.test(document.querySelector('[data-counters]')?.textContent || ''), null, {timeout: 30000});
  const rows = await page.locator('#exec-grid tbody tr[data-i]').count();
  assert.ok(rows >= 1, 'لا صفوف في الشبكة');
  const headers = await page.locator('#exec-grid thead th[data-key]').evaluateAll(nodes => nodes.map(node => node.dataset.key));
  for (const key of ['internalNumber', 'clientName', 'opponentName', 'fileNumber', 'dueUntilToday', 'paidTotal', 'remainingTotal', 'lastActionLabel', 'nextActionLabel']) {
    assert.ok(headers.includes(key), `عمود مفقود: ${key}`);
  }
  await shot('01-center-desktop.png');
});
await verify('العدّاد يصفّي الشبكة على التنفيذات المتأخرة', async () => {
  const before = await page.locator('#exec-grid tbody tr[data-i]').count();
  await page.locator('[data-counters] .counter[data-count="overdue"]').click();
  await page.waitForTimeout(1200);
  const filtered = await page.locator('#exec-grid tbody tr[data-i]').count();
  assert.ok(filtered <= before, `${filtered} > ${before}`);
  assert.equal(await page.locator('[data-counters] .counter[data-count="overdue"].is-active').count(), 1);
  await page.locator('[data-counters] .counter[data-count="overdue"]').click();
  await page.waitForTimeout(1200);
  assert.equal(await page.locator('#exec-grid tbody tr[data-i]').count(), before);
});

// مثال عملي جاهز: نفس مسار المستخدم (زر ← بطاقة)
let exampleNumber = '';
await verify('زر «مثال عملي جاهز» يبني المثال ويفتح بطاقته', async () => {
  await page.locator('[data-demo-example]').click();
  clicks('S0-example', 1);
  await page.waitForSelector('.exec-numbers', {timeout: 30000});
  await page.waitForFunction(() => /EX-\d{4}-\d+/.test(document.querySelector('#main-content h2')?.textContent || ''), null, {timeout: 30000});
  const title = await page.locator('#main-content h2').first().textContent();
  exampleNumber = (title.match(/EX-\d{4}-\d+/) || [''])[0];
  assert.ok(exampleNumber, `لا يظهر رقم تنفيذ في العنوان: ${title}`);
  exampleId = await page.evaluate(() => window.__LAW_OFFICE_APP__.route.replace('exc:', ''));
});

/* ---------------------------------------------------------------- S4 */
await verify('S4 — المدفوع والمتبقي يظهران فور فتح البطاقة بلا أي نقرة (وحتى اليوم)', async () => {
  const numbers = await cardNumbers();
  assert.equal(numbers.due, 42000, `المطلوب حتى اليوم ${numbers.due}`);
  assert.equal(numbers.paid, 9000, `المدفوع ${numbers.paid}`);
  assert.equal(numbers.remaining, 33000, `المتبقي ${numbers.remaining}`);
  const today = await page.evaluate(async () => {
    const {localDate} = await import('./js/core/clock.js');
    return localDate();
  });
  const label = await page.locator('.exec-numbers .num').first().textContent();
  assert.ok(label.includes(`${today.slice(8, 10)}/${today.slice(5, 7)}/${today.slice(0, 4)}`), `المطلوب حتى تاريخ غير متوقع: ${label}`);
});
await verify('S4 — «تاريخ الاستحقاق حتى» يوقف توليد الفترات: لا فترات بعد 31/12/2025 مهما تغيّر تاريخ الحساب', async () => {
  await page.locator('[data-asof]').fill('2026-10-04');
  await page.locator('[data-asof]').dispatchEvent('change');
  await page.waitForTimeout(1500);
  const rows = await page.evaluate(async id => {
    const app = window.__LAW_OFFICE_APP__;
    const S = await import('./js/services/execution-simple.js');
    const bundle = await S.simpleCardBundle(app.office, id, {asOf: '2026-10-04'});
    const last = bundle.schedule.rows.at(-1);
    return {count: bundle.schedule.rows.length, last: last?.toDate, due: bundle.schedule.totals.dueMinor};
  }, exampleId);
  assert.equal(rows.count, 12, `عدد الفترات ${rows.count}`);
  assert.equal(rows.last, '2025-12-31', `آخر فترة تنتهي في ${rows.last}`);
  assert.equal(rows.due, 4200000, `المطلوب ${rows.due}`);
  const today = await page.evaluate(async () => (await import('./js/core/clock.js')).localDate());
  await page.locator('[data-asof]').fill(today);
  await page.locator('[data-asof]').dispatchEvent('change');
  await page.waitForTimeout(1800);
  const restored = await cardNumbers();
  assert.equal(restored.due, 42000, `المطلوب بعد الإرجاع إلى اليوم ${restored.due}`);
});
await verify('S4 — الكشف الشهري يعرض 12 شهرًا بحالة ✔/✗ بلا أي نقرة إضافية', async () => {
  const rows = page.locator('.account-table tbody tr');
  assert.equal(await rows.count(), 12, 'عدد الأشهر المعروضة');
  const paid = await page.locator('.account-table .pstatus-paid').count();
  const unpaid = await page.locator('.account-table .pstatus-unpaid').count();
  assert.equal(paid, 3, `صفوف مسددة ${paid}`);
  assert.equal(unpaid, 9, `صفوف غير مسددة ${unpaid}`);
  assert.equal(await page.locator('.exec-tab').count(), 4);
  assert.equal(await page.locator('.exec-toolbar [data-record]').count(), 1);
  await shot('02-card-account.png');
});
await verify('S4 — زر واحد يفسّر المتبقي بمعادلة مقروءة (Trace)', async () => {
  clicks('trace', 1);
  await page.locator('.exec-numbers [data-trace="remaining"]').click();
  await page.waitForSelector('#modal-root .modal-title', {timeout: 10000});
  const text = await modal().textContent();
  assert.ok(text.includes('المتبقي = المطلوب − المخصّص'), 'لا تظهر المعادلة');
  await shot('03-trace-remaining.png');
  await closeAllModals();
  assert.equal(await page.locator('#modal-root .modal-card').count(), 0, 'نافذة التفسير لم تُغلق');
});

/* ---------------------------------------------------------------- S2 */
await verify('S2 — تسجيل تحصيل من صفر: ≤ 5 نقرات والنتيجة تظهر في الرقم والسجل', async () => {
await closeAllModals();
  const before = await cardNumbers();
  const beforeClicks = report.clicks['S2'] || 0;
  await page.locator('.exec-toolbar [data-record]').first().click();                       // 1
  await page.waitForSelector('#modal-root .record-tile', {timeout: 10000});
  const tiles = await modal().locator('.record-tile').count();
  assert.equal(tiles, 6, `عدد أيقونات التسجيل ${tiles}`);
  await shot('04-record-sheet.png');
  await modal().locator('.record-tile[data-record="collection"]').click();                 // 2
  await page.waitForSelector('#modal-root [data-form="collection"]', {timeout: 10000});
  await modal().locator('[name="amount"]').fill('5000');
  await modal().locator('[data-save]').click();                                            // 3
  await page.waitForSelector('#modal-root [data-form="collection"]', {state: 'detached', timeout: 15000});
  await page.waitForTimeout(1800);
  const after = await cardNumbers();
  clicks('S2', 3 - beforeClicks);
  assert.equal(after.remaining, before.remaining - 5000, `المتبقي بعد التحصيل ${after.remaining}`);
  assert.ok(after.paid >= before.paid + 5000, `المدفوع بعد التحصيل ${after.paid}`);
  void beforeClicks;
});
await verify('S2 — المحضر الجديد يظهر في تبويب السجل باسمه وتاريخه', async () => {
await closeAllModals();
  clicks('S2-log', 1);
  await tap(page.locator('.exec-tab[data-tab="log"]'));
  await page.waitForTimeout(700);
  const log = await page.locator('[data-log-list]').textContent();
  assert.ok(/RC-\d{4}-\d+/.test(log), 'لا يظهر رقم محضر في السجل');
  assert.ok(log.includes('5,000.00') || log.includes('5,000'), 'لا يظهر مبلغ التحصيل في السجل');
  await shot('05-log.png');
});

/* ---------------------------------------------------------------- S3 */
await verify('S3 — تسجيل إجراء (نوع + تاريخ) من نفس الزر: ≤ 5 نقرات', async () => {
await closeAllModals();
  const beforeClicks = report.clicks['S3'] || 0;
  await page.locator('.exec-toolbar [data-record]').first().click();                       // 1
  await page.waitForSelector('#modal-root .record-tile', {timeout: 10000});
  await modal().locator('.record-tile[data-record="action"]').click();                     // 2
  await page.waitForSelector('#modal-root [data-form="action"]', {timeout: 10000});
  await modal().locator('[name="kind"]').fill('إعلان');
  await modal().locator('[name="referenceNumber"]').fill('إعلان 77/2026');
  await modal().locator('[data-save]').click();                                            // 3
  await page.waitForSelector('#modal-root [data-form="action"]', {state: 'detached', timeout: 15000});
  await page.waitForTimeout(1800);
  clicks('S3', 3 - beforeClicks);
  const numbered = await page.evaluate(async id => {
    const app = window.__LAW_OFFICE_APP__;
    const rows = await app.office.r.executionActions.byIndex('executionId', id);
    return rows.map(row => row.kindLabel || row.kind);
  }, exampleId);
  assert.ok(numbered.includes('إعلان'), `الإجراءات المسجلة: ${numbered.join(' | ')}`);
  const lines = await page.locator('.exec-lines').textContent();
  assert.ok(lines.includes('آخر إجراء'), 'سطر آخر إجراء مفقود');
  await shot('06-card-after-records.png');
});

/* ---------------------------------------------------------------- S5 */
await verify('S5 — «احسب مدة» بنقرتين: المستحق والمدفوع والمتبقي عن المدة', async () => {
await closeAllModals();
  const beforeClicks = report.clicks['S5'] || 0;
  await page.locator('.exec-toolbar [data-open-duration]').first().click();                // 1
  await page.waitForSelector('#modal-root [data-form="duration"]', {timeout: 10000});
  await modal().locator('[name="fromDate"]').fill('2025-04-01');
  await modal().locator('[name="toDate"]').fill('2025-09-30');
  await modal().locator('[data-save]').click();                                            // 2
  await page.waitForSelector('#modal-root .result-numbers', {timeout: 15000});
  const text = await modal().textContent();
  clicks('S5', 2 - beforeClicks);
  assert.ok(text.includes('المستحق عن المدة'), 'عنوان المستحق مفقود');
  assert.ok(text.includes('21,000.00'), `المستحق عن المدة لا يساوي 21,000 — النص: ${text.replace(/\s+/g, ' ').slice(0, 240)}`);
  assert.ok(text.includes('رصيد سابق للمدة'), 'رصيد سابق مفقود');
  assert.ok(text.includes('الإجمالي المطلوب'), 'الإجمالي مفقود');
  await shot('07-duration.png');
  await closeAllModals();
});

/* ---------------------------------------------------------------- S8 */
await verify('S8 — تعديل تحصيل من صفه نفسه مع بقاء الأثر (تاريخ التعديل محفوظ)', async () => {
  await closeAllModals();
  await tap(page.locator('.exec-tab[data-tab="log"]'));
  await page.waitForTimeout(700);
  clicks('S8-edit', 2);
  const receiptRow = page.locator('[data-log-item]', {hasText: 'تحصيل'}).first();
  await tap(receiptRow.locator('[data-edit]'));                                              // 1
  await page.waitForSelector('#modal-root [data-form="collection"]', {timeout: 10000});
  await modal().locator('[name="amount"]').fill('6000');
  await modal().locator('[name="reason"]').fill('تصحيح مبلغ المحضر');
  await modal().locator('[data-save]').click();                                              // 2
  await page.waitForSelector('#modal-root [data-form="collection"]', {state: 'detached', timeout: 15000});
  await page.waitForTimeout(1800);
  const log = await page.locator('[data-log-list]').textContent();
  assert.ok(log.includes('6,000'), 'المبلغ المعدّل لا يظهر في السجل');
});
await verify('S8 — الإلغاء لا يحذف: السجل يبقى مشطوبًا بسبب مكتوب وقابل للتراجع', async () => {
  const item = page.locator('[data-log-item]', {hasText: 'تحصيل'}).first();
  await tap(item.locator('[data-void]'));                                                     // 1
  await page.waitForSelector('#modal-root .confirm-input', {timeout: 10000});
  await modal().locator('.confirm-input').fill('قيد مزدوج');
  await tap(modal().locator('[data-ok]'));                                                     // 2
  await page.waitForTimeout(2500);
  await tap(page.locator('[data-log-voided]'));
  await page.waitForTimeout(700);
  const voided = await page.locator('[data-log-item].is-voided').count();
  assert.ok(voided >= 1, 'لا يوجد سجل مشطوب ظاهر بعد الإلغاء');
  await shot('08-log-voided.png');
  await tap(page.locator('[data-log-voided]'));
  await page.waitForTimeout(400);
});

/* ---------------------------------------------------------------- S6 */
await verify('S6 — حكم لاحق بأقل من 6 مدخلات مع معاينة فورية قبل الحفظ', async () => {
await closeAllModals();
  const before = await cardNumbers();
  const beforeClicks = report.clicks['S6'] || 0;
  await page.locator('.exec-toolbar [data-record]').first().click();                          // 1
  await page.waitForSelector('#modal-root .record-tile', {timeout: 10000});
  await modal().locator('.record-tile[data-record="judgment"]').click();                      // 2
  await page.waitForSelector('#modal-root [data-form="later-judgment"]', {timeout: 10000});
  await modal().locator('[name="entitlementType"]').fill('نفقة شهرية');
  await modal().locator('[name="amount"]').fill('5000');
  await modal().locator('[name="effectiveFrom"]').fill('2025-10-01');
  await modal().locator('[name="judgmentNumber"]').fill('700/2025');
  await modal().locator('[name="court"]').fill('محكمة استئناف الأسرة');
  await page.waitForTimeout(1200);
  const preview = await modal().locator('[data-preview]').textContent();
  assert.ok(preview.trim().length > 10, `لا توجد معاينة قبل الحفظ: ${preview}`);
  await shot('09-later-judgment-preview.png');
  await modal().locator('[data-save]').click();                                               // 3
  await page.waitForSelector('#modal-root [data-form="later-judgment"]', {state: 'detached', timeout: 15000});
  await page.waitForTimeout(1800);
  clicks('S6', 3 - beforeClicks);
  const after = await cardNumbers();
  assert.ok(after.due > before.due, `الاستحقاق لم يزد: ${before.due} → ${after.due}`);
  const rows = await page.evaluate(async id => {
    const app = window.__LAW_OFFICE_APP__;
    const S = await import('./js/services/execution-simple.js');
    const bundle = await S.simpleCardBundle(app.office, id, {});
    return bundle.schedule.rows.filter(row => row.fromDate >= '2025-10-01').map(row => `${row.label}:${row.dueMinor}`);
  }, exampleId);
  assert.ok(rows.length >= 3, `صفوف الربع الأخير: ${rows.join(', ')}`);
});

/* ---------------------------------------------------------------- S7 */
await verify('S7 — توكيل بمدة: نصاب الأرقام ظاهر والمعادلة مكتوبة، وإصداره لا يغيّر المتبقي', async () => {
  await closeAllModals();
  const before = await cardNumbers();
  const beforeClicks = report.clicks['S7'] || 0;
  await page.locator('.exec-toolbar [data-record]').first().click();                          // 1
  await page.waitForSelector('#modal-root .record-tile', {timeout: 10000});
  await modal().locator('.record-tile[data-record="poa"]').click();                           // 2
  await page.waitForSelector('#modal-root [data-form="poa"]', {timeout: 10000});
  await modal().locator('[name="fromDate"]').fill('2025-10-01');
  await modal().locator('[name="toDate"]').fill('2025-12-31');
  await page.waitForTimeout(900);
  const preview = await modal().textContent();
  assert.ok(preview.includes('قاعدة منع الازدواج'), 'قاعدة منع الازدواج غير معروضة');
  const figures = await page.locator('#modal-root [data-preview]').textContent();
  assert.ok(/[\d,]+/.test(figures || ''), `لا تظهر أرقام في معاينة التوكيل: ${figures}`);
  await shot('10-poa.png');
  await modal().locator('[data-save]').click();                                               // 3
  await page.waitForTimeout(3000);
  await closeAllModals();
  await page.waitForTimeout(800);
  clicks('S7', 3 - beforeClicks);
  const after = await cardNumbers();
  assert.equal(after.remaining, before.remaining, `إصدار التوكيل غيّر المتبقي: ${before.remaining} → ${after.remaining}`);
  const poaCount = await page.evaluate(async id => {
    const app = window.__LAW_OFFICE_APP__;
    const rows = await app.office.r.executionPOAs.byIndex('executionId', id);
    return rows.length;
  }, exampleId);
  assert.ok(poaCount >= 2, `عدد التوكيلات المحفوظة ${poaCount}`);
});
await verify('S7 — «كشف / توكيل» يبني مستند كشف حقيقيًا في نافذة طباعة (بلا طابعة فعلية)', async () => {
  await closeAllModals();
  const before = popups.length;
  await tap(page.locator('.exec-toolbar [data-open-statement]'));                             // 1
  await page.waitForSelector('#modal-root [data-form="statement"]', {timeout: 10000});
  await modal().locator('[name="mode"]').selectOption('monthly');
  await tap(modal().locator('button[type="submit"]'));                                        // 2
  await page.waitForFunction(n => true, null, {timeout: 1000}).catch(() => {});
  const deadline = Date.now() + 20000;
  while (popups.length <= before && Date.now() < deadline) await page.waitForTimeout(300);
  assert.ok(popups.length > before, 'لم تُفتح نافذة طباعة');
  const popup = popups[popups.length - 1];
  await popup.waitForLoadState('domcontentloaded').catch(() => {});
  const deadline2 = Date.now() + 15000;
  let text = '';
  while (Date.now() < deadline2) {
    text = await popup.evaluate(() => document.body.innerText).catch(() => '');
    if (text.includes('الفترة') && text.includes('المتبقي')) break;
    await page.waitForTimeout(400);
  }
  assert.ok(text.includes('كشف حساب تنفيذ'), `عنوان الكشف مفقود: ${text.slice(0, 120)}`);
  assert.ok(text.includes('المطلوب حتى'), 'لا يظهر تاريخ الحساب في الكشف');
  assert.ok(/\d[\d,]{2,}\.\d{2} ج\.م/.test(text), 'لا تظهر مبالغ بالعملة في الكشف');
  assert.ok(text.includes('الفترة') && text.includes('الحالة'), 'لا يظهر جدول الفترات في الكشف');
  assert.ok((text.match(/\d{2}\/\d{2}\/\d{4} – \d{2}\/\d{2}\/\d{4}/g) || []).length >= 12, 'عدد فترات الكشف أقل من 12');
  report.printVerification = 'VERIFIED — HTML statement built and written into a print window (no printer, no native preview)';
  // لا نُغلق نافذة الطباعة داخل العزل: الطباعة الأصلية غير مُختبَرة هنا
  await closeAllModals();
});

/* ---------------------------------------------------------------- الموبايل */
await verify('الموبايل: الشريط الثابت أسفل الشاشة وأيقونات التسجيل تعمل باللمس', async () => {
  await closeAllModals();
  const errorsBefore = report.errors.length;
  await page.setViewportSize({width: 390, height: 844});
  await page.waitForTimeout(1200);
  await page.evaluate(id => window.__LAW_OFFICE_APP__.go(`exc:${id}`), exampleId);
  await page.waitForSelector('.exec-toolbar', {timeout: 30000});
  await page.waitForTimeout(1600);
  const box = await page.locator('.exec-toolbar').boundingBox();
  const viewport = page.viewportSize();
  assert.ok(box, 'شريط الأزرار غير مرئي على الموبايل');
  assert.ok(box.y + box.height <= viewport.height + 1, `الشريط ليس داخل الشاشة: ${JSON.stringify(box)}`);
  assert.ok(box.y > viewport.height - 160, `الشريط ليس مثبتًا أسفل الشاشة: y=${box.y}`);
  await page.screenshot({path: path.join(artifactDir, '11-mobile-card.png')});
  report.screenshots.push('11-mobile-card.png');
  await page.locator('.exec-toolbar [data-record]').first().click();
  await page.waitForSelector('#modal-root .record-tile', {timeout: 10000});
  assert.equal(await modal().locator('.record-tile').count(), 6, 'أيقونات التسجيل لا تظهر على الموبايل');
  await page.screenshot({path: path.join(artifactDir, '12-mobile-record-sheet.png')});
  report.screenshots.push('12-mobile-record-sheet.png');
  await closeAllModals();
  assert.equal(report.errors.length, errorsBefore, report.errors.slice(errorsBefore).join(' | '));
  await page.setViewportSize({width: 1440, height: 1000});
  await page.waitForTimeout(800);
});
await verify('لوحة المفاتيح: Ctrl+Shift+T يفتح أيقونات التسجيل على البطاقة', async () => {
await closeAllModals();
  await page.keyboard.down('Control'); await page.keyboard.down('Shift');
  await page.keyboard.press('KeyT');
  await page.keyboard.up('Shift'); await page.keyboard.up('Control');
  await page.waitForSelector('#modal-root .record-tile', {timeout: 10000});
  assert.equal(await modal().locator('.record-tile').count(), 6);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
});

await verify('لا أخطاء صفحة/كونسول خلال كل الرحلات', async () => {
  assert.deepEqual(report.errors, []);
});

await browser.close();
await fs.writeFile(path.join(artifactDir, 'report.json'), JSON.stringify(report, null, 1), 'utf8');
console.log(`\nعدد النقرات المقيسة: ${JSON.stringify(report.clicks)}`);
console.log(`نتائج: ${report.checks.filter(check => check.status === 'PASS').length} ناجح · ${report.failures.length} فشل`);
if (report.failures.length) { console.log(report.failures.join('\n')); process.exitCode = 1; }
