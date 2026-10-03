// =====================================================================
// فحص متصفح FEAS الحقيقي في Chromium: لقطة اعتراف، رصيد قابل لإعادة البناء،
// اختيار صريح لنوع القيمة والتحقق من نموذج الحكم قبل حفظ الشريحة.
// التشغيل: npm run test:execution-feas-browser
// متغير: GRID_BASE_URL (افتراضي http://127.0.0.1:8000)
// =====================================================================
import {chromium} from 'playwright';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const base = (process.env.GRID_BASE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
const artifactDir = path.join(repository, '.cache', 'execution-feas-browser');
await fs.mkdir(artifactDir, {recursive: true});
const report = {scenario: 'execution-feas-ui-offline', date: new Date().toISOString(), base, checks: [], failures: [], consoleErrors: [], expectedOfflineNetworkErrors: []};
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
const check = (name, condition, detail = '') => {
  if (condition) report.checks.push({name, status: 'VERIFIED — Browser DOM/Service call', detail});
  else report.failures.push({name, detail});
};

const context = await browser.newContext({viewport: {width: 1440, height: 1000}, serviceWorkers: 'allow'});
const page = await context.newPage();
let offline = false;
page.on('pageerror', error => report.consoleErrors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  if (message.type() !== 'error') return;
  const text = `console: ${message.text()}`;
  if (offline && /ERR_(?:CONNECTION_CLOSED|INTERNET_DISCONNECTED)/.test(text)) report.expectedOfflineNetworkErrors.push(text);
  else report.consoleErrors.push(text);
});
await page.goto(`${base}/index.html`);
await page.waitForFunction(() => window.__LAW_OFFICE_APP__ && !window.__LAW_OFFICE_APP__.booting, null, {timeout: 60000});
await page.waitForFunction(async () => {
  const registrations = await navigator.serviceWorker?.getRegistrations?.() || [];
  return Boolean(navigator.serviceWorker?.controller && registrations.some(registration => registration.active?.state === 'activated'));
}, null, {timeout: 90000});
const serviceWorker = await page.evaluate(async () => {
  const keys = await caches.keys();
  const cacheName = keys.find(key => key.includes('v5.10.0-feas-offline')) || '';
  const cache = cacheName ? await caches.open(cacheName) : null;
  const paths = cache ? (await cache.keys()).map(request => new URL(request.url).pathname) : [];
  return {controlled: Boolean(navigator.serviceWorker.controller), cacheName, paths};
});
report.serviceWorker = {controlled: serviceWorker.controlled, cacheName: serviceWorker.cacheName, feasAssets: serviceWorker.paths.filter(path => /execution-(?:calendar|money|feas)\.js$/.test(path))};
check('Service Worker controls the FEAS app and precaches its module graph', serviceWorker.controlled && Boolean(serviceWorker.cacheName)
  && ['/js/domain/execution-calendar.js', '/js/domain/execution-money.js', '/js/domain/execution-feas.js', '/js/services/execution-feas.js'].every(path => serviceWorker.paths.includes(path)), JSON.stringify(report.serviceWorker));

const seed = await page.evaluate(async () => {
  const app = window.__LAW_OFFICE_APP__;
  const EX = await import('/js/services/execution.js');
  const L = await import('/js/services/execution-ledger.js');
  const FEAS = await import('/js/services/execution-feas.js');
  const {createLegalFile} = await import('/js/services/legal-files.js');
  const office = app.office;
  const client = await office.saveClient({fullName: 'موكل اختبار FEAS'});
  const file = await createLegalFile(office, {clientId: client.id, title: 'ملف اختبار FEAS', fileType: 'أسرة'});
  const execution = await EX.createExecution(office, {
    executionType: 'family', accountingModel: 'feas-v1', clientId: client.id, fileId: file.id,
    openedDate: '2025-01-05', status: 'active', authority: 'محكمة الأسرة', officialNumber: 'FEAS/2025/1'
  });
  const obligation = await FEAS.saveExecutionObligation(office, {
    executionId: execution.id, obligationType: 'نفقة كما وردت بالمصدر', frequency: 'monthly',
    prorationPolicy: 'days', currency: 'EGP', startDate: '2025-01-01'
  });
  const judgment = await EX.addExecutionJudgment(office, {
    executionId: execution.id, entitlementType: obligation.obligationType, judgmentKind: 'original',
    judgmentDate: '2025-01-10', judgmentNumber: 'FEAS/1', valueType: 'periodic', amount: 3000, effectiveFrom: '2025-01-01'
  });
  await EX.saveValueSlice(office, {
    executionId: execution.id, obligationId: obligation.id, judgmentId: judgment.id,
    valueType: 'periodic', amount: '3000.00', startDate: '2025-01-01'
  });
  const preview = await FEAS.projectExecutionPeriod(office, {executionId: execution.id, obligationId: obligation.id, fromDate: '2025-01-01', toDate: '2025-03-31'});
  const recognized = await FEAS.recognizeExecutionPeriod(office, {
    executionId: execution.id, obligationId: obligation.id, fromDate: '2025-01-01', toDate: '2025-03-31', expectedFingerprint: preview.fingerprint
  });
  await L.recordCollection(office, {
    executionId: execution.id, amount: '1000.00', date: '2025-03-01', idempotencyKey: 'browser-feas-receipt-1',
    allocation: {method: 'MANUAL', targets: [{periodKey: recognized.row.periodKey, amountMinor: 100000}]}
  });
  return {executionId: execution.id, obligationId: obligation.id, judgmentId: judgment.id, periodKey: recognized.row.periodKey};
});
report.seed = seed;

await page.evaluate(id => window.__LAW_OFFICE_APP__.go(`exc:${id}`), seed.executionId);
await page.waitForSelector('[data-section-id="feas"]', {timeout: 30000, state: 'attached'});
await page.waitForFunction(() => !/جارٍ التحميل/.test(document.querySelector('[data-section-id="balance"]')?.textContent || 'جارٍ التحميل'), null, {timeout: 30000});
const initial = await page.evaluate(async id => {
  const app = window.__LAW_OFFICE_APP__;
  const pairs = [...document.querySelectorAll('[data-section-id="balance"] .exec-kv > *')].map(node => node.textContent.trim());
  const balance = {};
  for (let i = 0; i < pairs.length; i += 2) balance[pairs[i]] = pairs[i + 1];
  const judgments = await app.office.r.judgments.byIndex('executionId', id, 50);
  const slices = await app.office.r.executionValuePeriods.byIndex('executionId', id, 50);
  return {balance, judgments: judgments.length, slices: slices.length, section: document.querySelector('[data-section-id="feas"]')?.textContent || ''};
}, seed.executionId);
report.initial = initial;
check('صفحة التنفيذ تعرض قسم FEAS ولقطة فترة معترفًا بها', /محرك الأسرة FEAS/.test(initial.section) && /2025-01-01/.test(initial.section), initial.section.slice(0, 240));
check('الرصيد يعاد بناؤه: 9000.00 استحقاق، 1000.00 تحصيل، 8000.00 متبقٍ',
  initial.balance['الاستحقاق النهائي']?.includes('٩٬٠٠٠٫٠٠') && initial.balance['المحصل']?.includes('١٬٠٠٠٫٠٠') && initial.balance['المتبقي']?.includes('٨٬٠٠٠٫٠٠'),
  JSON.stringify(initial.balance));
check('فحص السلامة لا يحجب البيانات السليمة', !/تعذر|فحص السلامة وجد/.test(initial.balance['الاستحقاق النهائي'] || ''), JSON.stringify(initial.balance));
await page.screenshot({path: path.join(artifactDir, 'execution-feas-card.png'), fullPage: true});

// نموذج الحكم: FEAS لا يختار دوريًا تلقائيًا ولا يعرض حقل دورية مضللًا.
await page.click('[data-quick="judgment"]');
await page.waitForSelector('.modal-card [name="valueType"]', {timeout: 15000});
const formState = await page.evaluate(() => ({
  valueType: document.querySelector('.modal-card [name="valueType"]')?.value,
  periodicityField: Boolean(document.querySelector('.modal-card [name="periodicity"]')),
  valueTypeRequired: document.querySelector('.modal-card [name="valueType"]')?.required || false,
  options: [...document.querySelectorAll('.modal-card [name="valueType"] option')].map(option => ({value: option.value, label: option.textContent.trim()}))
}));
report.formState = formState;
check('نوع القيمة يبدأ بلا اختيار ويُطلب صراحةً', formState.valueType === '' && formState.valueTypeRequired, JSON.stringify(formState));
check('لا تعرض الواجهة دورية توحي بأنها تحكم التزام FEAS', !formState.periodicityField, JSON.stringify(formState));
const beforeInvalidSave = initial.judgments;
await page.click('.modal-card [data-save-slice]');
await page.waitForTimeout(150);
const afterInvalidSave = await page.evaluate(async id => (await window.__LAW_OFFICE_APP__.office.r.judgments.byIndex('executionId', id, 50)).length, seed.executionId);
check('التحقق يوقف حفظ شريحة ناقصة قبل تسجيل حكم يتيم', afterInvalidSave === beforeInvalidSave, `${beforeInvalidSave} → ${afterInvalidSave}`);

// إدخال صريح وصحيح: شريحة لاحقة تبدأ بعد آخر فترة معترف بها، لذلك لا تغيّر الرصيد الحالي.
await page.fill('.modal-card [name="entitlementType"]', 'نفقة كما وردت بالمصدر');
await page.selectOption('.modal-card [name="obligationId"]', seed.obligationId);
await page.selectOption('.modal-card [name="valueType"]', 'periodic');
await page.fill('.modal-card [name="amount"]', '3500.00');
await page.fill('.modal-card [name="effectiveFrom"]', '2025-04-01');
await page.click('.modal-card [data-save-slice]');
await page.waitForSelector('.modal-card', {state: 'detached', timeout: 20000});
await page.waitForFunction(async id => (await window.__LAW_OFFICE_APP__.office.r.judgments.byIndex('executionId', id, 50)).length === 2, seed.executionId, {timeout: 20000});
await page.waitForFunction(() => !/جارٍ التحميل/.test(document.querySelector('[data-section-id="balance"]')?.textContent || 'جارٍ التحميل'), null, {timeout: 20000});
const afterValidSave = await page.evaluate(async id => {
  const app = window.__LAW_OFFICE_APP__;
  const rows = [...document.querySelectorAll('[data-section-id="balance"] .exec-kv > *')].map(node => node.textContent.trim());
  const balance = {};
  for (let i = 0; i < rows.length; i += 2) balance[rows[i]] = rows[i + 1];
  return {balance, judgments: (await app.office.r.judgments.byIndex('executionId', id, 50)).length,
    slices: (await app.office.r.executionValuePeriods.byIndex('executionId', id, 50)).length};
}, seed.executionId);
report.afterValidSave = afterValidSave;
check('اختيار صريح ينشئ سجل الحكم والشريحة اللاحقة', afterValidSave.judgments === 2 && afterValidSave.slices === 2, JSON.stringify(afterValidSave));
check('إضافة الشريحة وحدها لا تضيف استحقاقًا أو تغيّر لقطة الاعتراف', afterValidSave.balance['الاستحقاق النهائي']?.includes('٩٬٠٠٠٫٠٠') && afterValidSave.balance['المتبقي']?.includes('٨٬٠٠٠٫٠٠'), JSON.stringify(afterValidSave.balance));
await page.screenshot({path: path.join(artifactDir, 'execution-feas-explicit-value-type.png'), fullPage: true});

// Cold reload the actual FEAS card without a network; this proves the new domain/service modules are in the existing PWA shell.
offline = true;
await context.setOffline(true);
await page.reload({waitUntil: 'domcontentloaded', timeout: 45000});
await page.waitForFunction(() => window.__LAW_OFFICE_APP__ && !window.__LAW_OFFICE_APP__.booting && window.__LAW_OFFICE_APP__.office, null, {timeout: 60000});
await page.evaluate(id => window.__LAW_OFFICE_APP__.go(`exc:${id}`), seed.executionId);
await page.waitForSelector('[data-section-id="feas"]', {timeout: 30000, state: 'attached'});
await page.waitForFunction(() => !/جارٍ التحميل/.test(document.querySelector('[data-section-id="balance"]')?.textContent || 'جارٍ التحميل'), null, {timeout: 30000});
const offlineCard = await page.evaluate(() => {
  const nodes = [...document.querySelectorAll('[data-section-id="balance"] .exec-kv > *')].map(node => node.textContent.trim());
  const balance = {};
  for (let i = 0; i < nodes.length; i += 2) balance[nodes[i]] = nodes[i + 1];
  return {online: navigator.onLine, serviceWorker: Boolean(navigator.serviceWorker.controller), final: balance['الاستحقاق النهائي'], collected: balance['المحصل'], remaining: balance['المتبقي']};
});
report.offlineCard = offlineCard;
check('Cold Offline reload opens the FEAS card and rebuilds the same local balance', offlineCard.online === false && offlineCard.serviceWorker
  && offlineCard.final?.includes('٩٬٠٠٠٫٠٠') && offlineCard.collected?.includes('١٬٠٠٠٫٠٠') && offlineCard.remaining?.includes('٨٬٠٠٠٫٠٠'), JSON.stringify(offlineCard));
await page.screenshot({path: path.join(artifactDir, 'execution-feas-card-offline.png'), fullPage: true});

offline = false;
const uniqueConsoleErrors = [...new Set(report.consoleErrors)].filter(message => !/favicon/.test(message));
report.expectedOfflineNetworkErrors.push(...uniqueConsoleErrors.filter(message => /ERR_(?:CONNECTION_CLOSED|INTERNET_DISCONNECTED)/.test(message)));
report.consoleErrors = uniqueConsoleErrors.filter(message => !/ERR_(?:CONNECTION_CLOSED|INTERNET_DISCONNECTED)/.test(message));
await context.close();
await browser.close();
await fs.writeFile(path.join(artifactDir, 'report.json'), JSON.stringify(report, null, 2));
console.log(`\n${report.checks.length} فحصًا ناجحًا / ${report.failures.length} فشل`);
for (const item of report.failures) console.log(`FAIL — ${item.name}: ${item.detail}`);
for (const message of report.consoleErrors) console.log(`CONSOLE — ${message}`);
process.exit(report.failures.length || report.consoleErrors.length ? 2 : 0);
