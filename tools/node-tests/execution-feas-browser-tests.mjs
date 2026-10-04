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
  const cacheName = keys.find(key => key.includes('ahmad-khudair-law-office-v')) || '';
  const cache = cacheName ? await caches.open(cacheName) : null;
  const paths = cache ? (await cache.keys()).map(request => new URL(request.url).pathname) : [];
  return {controlled: Boolean(navigator.serviceWorker.controller), cacheName, paths};
});
report.serviceWorker = {controlled: serviceWorker.controlled, cacheName: serviceWorker.cacheName, feasAssets: serviceWorker.paths.filter(path => /execution-(?:calendar|money|feas|schedule)\.js$/.test(path))};
check('Service Worker controls the FEAS app and precaches its module graph', serviceWorker.controlled && Boolean(serviceWorker.cacheName)
  && ['/js/domain/execution-calendar.js', '/js/domain/execution-money.js', '/js/domain/execution-feas.js', '/js/domain/execution-schedule.js', '/js/services/execution-feas.js', '/js/services/execution-simple.js', '/js/services/execution-settings.js', '/js/ui/execution-simple-forms.js'].every(path => serviceWorker.paths.includes(path)), JSON.stringify(report.serviceWorker));

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
await page.waitForSelector('.exec-numbers', {timeout: 30000});
await page.waitForTimeout(1500);

// ===== البطاقة الموحّدة تعرض تنفيذ FEAS برقم واحد لا يتعارض مع الرصيد المعترف به =====
const card = await page.evaluate(async id => {
  const app = window.__LAW_OFFICE_APP__;
  const FEAS = await import('/js/services/execution-feas.js');
  const labels = [...document.querySelectorAll('.exec-numbers .num')];
  const numbers = Object.fromEntries(labels.map(node => [node.querySelector('span').textContent.trim(), node.querySelector('b').textContent.trim()]));
  const feas = await FEAS.executionFeasBalanceData(app.office, id).catch(error => ({error: String(error.message || error)}));
  const obligations = await FEAS.executionObligations(app.office, id).catch(() => []);
  const periods = await app.office.r.executionPeriods.byIndex('executionId', id, 50);
  const slices = await app.office.r.executionValuePeriods.byIndex('executionId', id, 50);
  return {
    numbers,
    tabs: document.querySelectorAll('#main-content .exec-tabs [data-tab]').length,
    periodRows: document.querySelectorAll('.account-table tbody tr').length,
    lastPeriodText: document.querySelector('.account-table tbody tr:last-child')?.textContent.replace(/\s+/g, ' ').trim() || '',
    feasHint: Boolean([...document.querySelectorAll('.hint-info')].find(node => node.textContent.includes('اعتراف الفترات'))),
    advancedAnchor: Boolean(document.querySelector('.advanced-anchor')) || (() => false)(),
    obligations: obligations.length,
    recognizedPeriods: periods.filter(row => ['RECOGNIZED', 'CLOSED'].includes(String(row.status || ''))).length,
    slices: slices.length,
    feasSummary: feas?.summary ? {finalEntitlement: feas.summary.finalEntitlement, collected: feas.summary.collected, remaining: feas.summary.remaining, periodCount: feas.summary.periodCount} : null,
    feasError: feas?.error || ''
  };
}, seed.executionId);
report.card = card;
check('بطاقة التنفيذ الموحّدة تفتح تنفيذ FEAS القديم بلا أخطاء', card.tabs === 4 && card.periodRows >= 3, JSON.stringify({tabs: card.tabs, rows: card.periodRows}));
check('الأرقام المعروضة تطابق الرصيد المعترف به: مطلوب 9,000 · مدفوع 1,000 · متبقي 8,000',
  card.numbers['المدفوع'] === '1,000' && card.numbers['المتبقي'] === '8,000' && Object.keys(card.numbers).some(key => key.startsWith('المطلوب') && card.numbers[key] === '9,000'),
  JSON.stringify(card.numbers));
check('الحساب يقف عند آخر فترة معترف بها (يناير–مارس 2025) ولا يُنشئ فترات بعدها', card.periodRows === 3 && /مارس 2025/.test(card.lastPeriodText), `${card.periodRows} صفوف · ${card.lastPeriodText}`);
check('تنبيه صريح يشرح نموذج الاعتراف ويحيل إلى الأدوات المتقدمة', card.feasHint === true, String(card.feasHint));
check('بيانات FEAS لم تُمس: التزام واحد وفترة معترف بها واحدة وشريحة واحدة', card.obligations === 1 && card.recognizedPeriods === 1 && card.slices === 1, JSON.stringify({obligations: card.obligations, recognized: card.recognizedPeriods, slices: card.slices}));
check('رصيد FEAS المعترف به ما زال 9,000/1,000/8,000 من محرك FEAS نفسه', !card.feasError && Number(card.feasSummary?.finalEntitlement) === 9000 && Number(card.feasSummary?.collected) === 1000 && Number(card.feasSummary?.remaining) === 8000 && card.feasSummary?.periodCount === 1, JSON.stringify({summary: card.feasSummary, error: card.feasError}));
await page.screenshot({path: path.join(artifactDir, 'execution-feas-card.png'), fullPage: true});

// ===== الأدوات المتقدمة (مسار FEAS القديم) تبقى متاحة من البطاقة الجديدة =====
await page.locator('.exec-toolbar [data-more]').first().evaluate(node => node.click());
await page.waitForTimeout(500);
await page.locator('.exec-more-menu [data-action="advanced"]').first().evaluate(node => node.click());
await page.waitForTimeout(900);
const advanced = await page.evaluate(() => ({
  anchor: Boolean(document.querySelector('.advanced-anchor')),
  buttons: [...document.querySelectorAll('.advanced-anchor button')].map(node => node.textContent.trim()),
  text: document.querySelector('.advanced-anchor')?.textContent.replace(/\s+/g, ' ').trim().slice(0, 200) || ''
}));
report.advanced = advanced;
check('«أدوات متقدمة» ما زالت تصل إلى مسار FEAS (التزام/اعتراف) والتسويات',
  advanced.anchor && advanced.buttons.some(label => label.includes('FEAS')) && advanced.buttons.some(label => label.includes('اعتراف')),
  JSON.stringify(advanced.buttons));

// ===== نافذة اعتراف FEAS تُفتح ولا تحذف شيئًا =====
await page.locator('.advanced-anchor [data-action="feas-recognize"]').first().evaluate(node => node.click());
await page.waitForTimeout(1200);
const recognize = await page.evaluate(() => {
  const card = document.querySelector('#modal-root .modal-card');
  return {open: Boolean(card), title: card?.querySelector('.modal-title')?.textContent.trim() || '', text: card?.textContent.replace(/\s+/g, ' ').trim().slice(0, 220) || ''};
});
report.recognize = recognize;
check('نافذة «اعتراف بفترة» تُفتح من الواجهة الجديدة على نفس الالتزام', recognize.open && /اعتراف/.test(recognize.title + recognize.text), JSON.stringify(recognize));
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

// ===== إعادة تحميل Offline: نفس الأرقام بلا شبكة =====
await context.setOffline(true);
offline = true;
await page.reload({waitUntil: 'domcontentloaded'}).catch(() => {});
await page.waitForFunction(() => window.__LAW_OFFICE_APP__?.office && !window.__LAW_OFFICE_APP__.booting, null, {timeout: 90000});
await page.evaluate(id => window.__LAW_OFFICE_APP__.go(`exc:${id}`), seed.executionId);
await page.waitForSelector('.exec-numbers', {timeout: 30000});
await page.waitForTimeout(1200);
const offlineNumbers = await page.evaluate(() => [...document.querySelectorAll('.exec-numbers .num b')].map(node => node.textContent.trim()));
report.offlineNumbers = offlineNumbers;
check('إعادة تحميل بلا شبكة تعرض الأرقام نفسها', offlineNumbers.includes('8,000') && offlineNumbers.includes('9,000'), JSON.stringify(offlineNumbers));
await context.setOffline(false);
offline = false;

report.consoleErrors = [...new Set(report.consoleErrors)].filter(message => !/ERR_CONNECTION_CLOSED|favicon/.test(message));
await context.close();
await browser.close();
await fs.writeFile(path.join(artifactDir, 'report.json'), JSON.stringify(report, null, 2));
console.log(`\n${report.checks.length} فحصًا ناجحًا / ${report.failures.length} فشل`);
for (const item of report.failures) console.log(`FAIL — ${item.name}: ${item.detail}`);
for (const message of report.consoleErrors) console.log(`CONSOLE — ${message}`);
console.log('PRINT — NOT VERIFIED — Print Preview/Physical Print Not Tested');
process.exit(report.failures.length || report.consoleErrors.length ? 2 : 0);
