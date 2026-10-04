// =====================================================================
// فحص سلوكي حقيقي لقسم التنفيذ في Chromium (يتطلب خدمة ملفات محلية).
// التشغيل:  npm run test:execution-browser
// متغيرات:  GRID_BASE_URL (افتراضي http://127.0.0.1:8000)
// ---------------------------------------------------------------------
// يُنشئ تنفيذ أسرة (3000 → 4000 مع حكم لاحق) عبر الخدمات التطبيقية نفسها، ثم:
// يفتح مركز التنفيذ، يفحص أعمدة الجدول وأرقام الرصيد، يفتح البطاقة، يفتح نوافذ
// التحصيل واللقطة والطباعة، ويتأكد من ظهور التنفيذ في البحث الشامل.
// ملاحظة صريحة: لا يقود هذا الفحص معاينة الطباعة الأصلية للنظام ولا طابعة فعلية
// — يُسجَّل ذلك في التقرير بوصفه NOT VERIFIED.
// — حُدِّث هذا الفحص بعد تبسيط الواجهة: يقيس نفس القدرات (الأرقام، الفترات،
//   التتبع، البحث الشامل، التصفية) عبر واجهة المركز/البطاقة الجديدة، ويستخدم
//   تنفيذًا مبنيًا بالخدمة القديمة نفسها ليثبت توافق البيانات القديمة.
// =====================================================================
import {chromium} from 'playwright';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const base = (process.env.GRID_BASE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
const artifactDir = path.join(repository, '.cache', 'execution-browser');
await fs.mkdir(artifactDir, {recursive: true});

const report = {
  scenario: 'execution-center', date: new Date().toISOString(), base,
  checks: [], failures: [], consoleErrors: [],
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

const check = (name, condition, detail = '') => {
  if (condition) report.checks.push({name, status: 'VERIFIED — Browser DOM/Service call', detail});
  else report.failures.push({name, detail});
};

const context = await browser.newContext({viewport: {width: 1440, height: 1000}, serviceWorkers: 'block'});
const page = await context.newPage();
page.on('pageerror', error => report.consoleErrors.push(`pageerror: ${error.message}`));
page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(`console: ${message.text()}`); });
await page.goto(`${base}/index.html`);
await page.waitForFunction(() => window.__LAW_OFFICE_APP__ && !window.__LAW_OFFICE_APP__.booting, null, {timeout: 60000});

const seed = await page.evaluate(async () => {
  const app = window.__LAW_OFFICE_APP__;
  const EX = await import('/js/services/execution.js');
  const L = await import('/js/services/execution-ledger.js');
  const DF = await import('/js/services/execution-differences.js');
  const PA = await import('/js/services/execution-poa.js');
  const {createLegalFile} = await import('/js/services/legal-files.js');
  const office = app.office;
  const client = await office.saveClient({fullName: 'موكل تجريبي للتنفيذ'});
  const file = await createLegalFile(office, {clientId: client.id, title: 'ملف تنفيذ أسرة', fileType: 'أسرة'});
  const execution = await EX.createExecution(office, {executionType: 'family', clientId: client.id, fileId: file.id, openedDate: '2025-01-05', status: 'active', entitlementThroughDate: '2025-12-31', authority: 'محكمة الأسرة', officialNumber: '1201/2025'});
  const j1 = await EX.addExecutionJudgment(office, {executionId: execution.id, entitlementType: 'نفقة شهرية', judgmentKind: 'original', judgmentNumber: '10/2025', judgmentDate: '2025-01-10', valueType: 'periodic', periodicity: 'monthly', amount: 3000, effectiveFrom: '2025-01-01'});
  await EX.saveValueSlice(office, {executionId: execution.id, judgmentId: j1.id, entitlementType: 'نفقة شهرية', valueType: 'periodic', periodicity: 'monthly', amount: 3000, startDate: '2025-01-01'});
  const j2 = await EX.addExecutionJudgment(office, {executionId: execution.id, entitlementType: 'نفقة شهرية', judgmentKind: 'later', judgmentNumber: '44/2025', judgmentDate: '2025-07-20', valueType: 'periodic', periodicity: 'monthly', amount: 4000, effectiveFrom: '2025-07-01', previousJudgmentId: j1.id});
  const s2 = await EX.saveValueSlice(office, {executionId: execution.id, judgmentId: j2.id, entitlementType: 'نفقة شهرية', valueType: 'periodic', periodicity: 'monthly', amount: 4000, startDate: '2025-07-01'});
  await L.recordCollection(office, {executionId: execution.id, amount: 2000, date: '2025-03-01', allocation: {method: 'MANUAL', targets: [{periodKey: 'نفقة شهرية::2025-01-01', amount: 2000}]}});
  const settlement = await DF.createSettlement(office, {executionId: execution.id, sliceId: s2.id});
  const poa = await PA.saveExecutionPoa(office, {executionId: execution.id, previousPoaId: '', total: 9000, baseAmount: 9000, lines: [{key: 'period:نفقة شهرية::2025-01-01', label: 'فترة', amount: 9000, included: true, sourceType: 'period', sourceIds: []}]});
  return {executionId: execution.id, settlementId: settlement.settlement.id, poaId: poa.id};
});

// ===== مركز التنفيذ =====
await page.evaluate(() => window.__LAW_OFFICE_APP__.go('executionCenter'));
await page.waitForFunction(() => document.querySelectorAll('#exec-grid tbody tr[data-i]').length > 0, null, {timeout: 30000});
await page.waitForTimeout(1500);
const center = await page.evaluate(() => ({
  title: document.querySelector('#page-title').textContent,
  counters: [...document.querySelectorAll('[data-counters] .counter')].map(node => `${node.dataset.count}=${node.querySelector('b').textContent}`),
  headers: [...document.querySelectorAll('#exec-grid thead th')].map(th => th.textContent.replace(/[↕▾⌄›]/g, '').trim()).filter(Boolean),
  keys: [...document.querySelectorAll('#exec-grid thead th[data-key]')].map(th => th.dataset.key),
  rows: document.querySelectorAll('#exec-grid tbody tr[data-i]').length,
  sections: [...document.querySelectorAll('[data-section-id]')].map(node => node.dataset.sectionId),
  hasTrash: Boolean(document.querySelector('[data-exec-trash]')),
  hasNew: Boolean(document.querySelector('[data-new-execution]'))
}));
report.center = center;
check('مركز التنفيذ يُفتح من مسار التنقل', center.title === 'مركز التنفيذ', center.title);
for (const header of ['رقم التنفيذ', 'الموكل', 'المنفذ ضده', 'رقم الملف', 'المطلوب حتى اليوم', 'المدفوع', 'المتبقي', 'آخر إجراء', 'الإجراء التالي']) {
  check(`عمود الجدول العام: ${header}`, center.headers.includes(header), center.headers.join(' | '));
}
check('أربعة عدّادات قابلة للنقر (جارٍ · متأخرات · يحتاج متابعة · مكتمل السداد)', center.counters.length === 4, center.counters.join(' ، '));
check('أقسام الصفحة ثلاث فقط: عدّادات · بحث · جدول', JSON.stringify(center.sections.slice(0, 3)) === JSON.stringify(['numbers', 'filters', 'grid']), center.sections.join('،'));
check('مركز التنفيذ يعرض مدخل سلة الحذف المنطقي وزر التنفيذ الجديد', center.hasTrash && center.hasNew, JSON.stringify({trash: center.hasTrash, add: center.hasNew}));
await page.screenshot({path: path.join(artifactDir, 'execution-center.png'), fullPage: true});

// ===== بطاقة التنفيذ (بيانات مبنية بالخدمة القديمة — توافق كامل) =====
await page.evaluate(id => window.__LAW_OFFICE_APP__.go(`exc:${id}`), seed.executionId);
await page.waitForSelector('.exec-numbers', {timeout: 30000});
await page.waitForTimeout(1200);
const card = await page.evaluate(id => {
  const labels = [...document.querySelectorAll('.exec-numbers .num')];
  const numbers = Object.fromEntries(labels.map(node => [node.querySelector('span').textContent.trim(), node.querySelector('b').textContent.trim()]));
  return {
    title: document.querySelector('#main-content h2').textContent.trim(),
    numbers,
    tabs: [...document.querySelectorAll('#main-content .exec-tabs [data-tab]')].map(node => node.textContent.trim()),
    periods: document.querySelectorAll('.account-table tbody tr').length,
    paid: document.querySelectorAll('.account-table .pstatus-paid').length,
    partial: document.querySelectorAll('.account-table .pstatus-partial').length,
    unpaid: document.querySelectorAll('.account-table .pstatus-unpaid').length,
    traceButtons: document.querySelectorAll('[data-trace]').length,
    progress: document.querySelector('.progress > span')?.getAttribute('style') || '',
    hints: document.querySelectorAll('.completion-bar .hint').length,
    toolbar: [...document.querySelectorAll('.exec-toolbar [data-record],.exec-toolbar [data-open-duration],.exec-toolbar [data-open-statement],.exec-toolbar [data-more]')].map(node => node.textContent.trim()),
    id: window.__LAW_OFFICE_APP__.route
  };
}, seed.executionId);
report.card = card;
check('رقم التنفيذ الداخلي يظهر في البطاقة', card.title.includes('EX-'), card.title);
const dueLabel = Object.keys(card.numbers).find(key => key.startsWith('المطلوب حتى')) || '';
check('الأرقام الثلاثة تطابق محرك الحساب القديم: مطلوب 42,000 · مدفوع 2,000 · متبقي 40,000',
  card.numbers[dueLabel] === '42,000' && card.numbers['المدفوع'] === '2,000' && card.numbers['المتبقي'] === '40,000',
  JSON.stringify(card.numbers));
check('كشف شهري واحد: 12 فترة بلا فترات مخزّنة', card.periods === 12, String(card.periods));
check('حالات الفترات: مسدد/جزئي/غير مسدد بلا فترات وهمية', card.partial === 1 && card.unpaid === 11 && card.paid === 0, JSON.stringify({paid: card.paid, partial: card.partial, unpaid: card.unpaid}));
check('أربعة تبويبات فقط وكل الأرقام قابلة للتفسير بنقرة', card.tabs.length === 4 && card.traceButtons >= 3, JSON.stringify({tabs: card.tabs, trace: card.traceButtons}));
check('شريط الأزرار الثابت أعلى البطاقة: تسجيل · احسب مدة · كشف/توكيل · المزيد', card.toolbar.length === 4 && card.toolbar[0].includes('تسجيل'), card.toolbar.join(' | '));
await page.screenshot({path: path.join(artifactDir, 'execution-card.png'), fullPage: true});

// ===== تفسير الرقم بنقرة (Trace) =====
await page.locator('[data-trace="remaining"]').first().click();
await page.waitForSelector('#modal-root .modal-title', {timeout: 15000});
const trace = await page.evaluate(() => document.querySelector('#modal-root').textContent.replace(/\s+/g, ' ').trim());
report.trace = trace.slice(0, 300);
check('المتبقي يُفسَّر بمعادلة مقروءة (مطلوب − مخصّص)', trace.includes('المتبقي = المطلوب − المخصّص') && /40,000/.test(trace), report.trace.slice(0, 160));
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

// ===== السجل الموحّد =====
await page.locator('#main-content .exec-tabs [data-tab="log"]').first().evaluate(node => node.click());
await page.waitForTimeout(900);
const log = await page.evaluate(() => ({
  items: document.querySelectorAll('[data-log-item]').length,
  text: document.querySelector('[data-log-list]')?.textContent.replace(/\s+/g, ' ').trim().slice(0, 600) || '',
  groups: [...new Set([...document.querySelectorAll('[data-log-item]')].map(node => node.dataset.type))],
  editButtons: document.querySelectorAll('[data-log-item] [data-edit]').length,
  voidButtons: document.querySelectorAll('[data-log-item] [data-void]').length,
  rowsCarryingVoidMarker: [...document.querySelectorAll('[data-log-item]')].filter(node => node.hasAttribute('data-void')).length
}));
report.log = log;
check('السجل الموحّد يعرض المحاضر والأحكام والتوكيلات في خط زمني واحد', log.items >= 5 && /RC-2025-0001/.test(log.text) && /POA-/.test(log.text), log.text.slice(0, 200));
check('كل سجل يُعدَّل أو يُلغى من صفه نفسه', log.editButtons >= 2 && log.voidButtons >= 3, JSON.stringify({edit: log.editButtons, void: log.voidButtons}));
check('صف السجل لا يحمل سمة الإلغاء نفسها (نقرة الصف لا تفتح نافذة إلغاء)', log.rowsCarryingVoidMarker === 0, String(log.rowsCarryingVoidMarker));
await page.screenshot({path: path.join(artifactDir, 'execution-log.png'), fullPage: true});

// ===== التوكيل المحفوظ بالسجل القديم يظهر كما هو =====
await page.locator('#main-content .exec-tabs [data-tab="poa"]').first().evaluate(node => node.click());
await page.waitForTimeout(800);
const poaTab = await page.evaluate(() => document.querySelector('.exec-tab-panel')?.textContent.replace(/\s+/g, ' ').trim().slice(0, 500) || '');
report.poaTab = poaTab;
check('توكيل قديم محفوظ (Snapshot) يظهر بمبلغه في تبويب التوكيل والطباعة', /9,000\.00/.test(poaTab) && /POA-/.test(poaTab), poaTab.slice(0, 200));
check('قاعدة منع الازدواج معلنة في التبويب', poaTab.includes('منع الازدواج'), poaTab.slice(0, 200));

// ===== بيانات الحكم والقيمة (السجلات القديمة) =====
await page.locator('#main-content .exec-tabs [data-tab="data"]').first().evaluate(node => node.click());
await page.waitForTimeout(800);
const dataTab = await page.evaluate(() => document.querySelector('.exec-tab-panel')?.textContent.replace(/\s+/g, ' ').trim().slice(0, 700) || '');
report.dataTab = dataTab;
check('الأحكام والبنود القديمة معروضة بلا تحويل ولا فقدان', /10\/2025/.test(dataTab) && /44\/2025/.test(dataTab) && /3,000/.test(dataTab) && /4,000/.test(dataTab), dataTab.slice(0, 260));

// ===== نموذج التحصيل الجديد يُفتح على تنفيذ قديم (لا شيء يمنع التسجيل) =====
await page.locator('[data-record]').first().evaluate(node => node.click());
await page.waitForSelector('#modal-root .record-tile', {timeout: 15000});
const tiles = await page.evaluate(() => document.querySelectorAll('#modal-root .record-tile').length);
await page.locator('#modal-root .record-tile[data-record="collection"]').evaluate(node => node.click());
await page.waitForSelector('#modal-root [data-form="collection"]', {timeout: 15000});
const dialog = await page.evaluate(() => ({
  tiles: document.querySelectorAll('#modal-root .record-tile').length,
  fields: [...document.querySelectorAll('#modal-root [data-form="collection"] input, #modal-root [data-form="collection"] select, #modal-root [data-form="collection"] textarea')].map(node => node.name),
  required: [...document.querySelectorAll('#modal-root [data-form="collection"] .req')].length,
  cards: document.querySelectorAll('#modal-root .modal-card').length,
  stacked: document.querySelectorAll('#modal-root .modal-backdrop.is-stacked').length
}));
report.collectionDialog = {...dialog, tiles};
check('ست أيقونات تسجيل كبيرة فوق البطاقة', tiles === 6, String(tiles));
check('نموذج التحصيل: حقل مبلغ واحد إلزامي والباقي اختياري', dialog.required === 1 && dialog.fields.includes('amount') && dialog.fields.includes('date'), JSON.stringify(dialog));
check('النموذج يُفتح فوق ورقة التسجيل (لا يستبدلها) فيمكن التسجيل تلو التسجيل', dialog.cards === 2 && dialog.stacked === 1, JSON.stringify(dialog));
await page.screenshot({path: path.join(artifactDir, 'execution-collection-dialog.png'), fullPage: true});
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

// ===== معاينة الطباعة (فتح المستند فقط — لا معاينة نظام ولا طابعة) =====
const printPopup = context.waitForEvent('page');
await page.locator('.exec-toolbar [data-open-statement]').first().evaluate(node => node.click());
await page.waitForSelector('#modal-root [data-form="statement"]', {timeout: 15000});
await page.locator('#modal-root [data-form="statement"] button[type="submit"]').evaluate(node => node.click());
const popup = await printPopup.catch(() => null);
if (popup) {
  await popup.waitForFunction(() => (document.body?.innerText || '').includes('كشف حساب'), null, {timeout: 20000}).catch(() => {});
  const text = (await popup.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
  report.printDocument = text.slice(0, 400);
  check('مستند كشف الحساب يُبنى ويُفتح للطباعة بالأرقام نفسها', /42,000/.test(text) && /40,000/.test(text), report.printDocument.slice(0, 200));
} else {
  report.failures.push({name: 'مستند كشف الحساب يُبنى ويُفتح للطباعة بالأرقام نفسها', detail: 'لم تُفتح نافذة'});
}
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

// ===== البحث الشامل =====
const search = await page.evaluate(async id => {
  const app = window.__LAW_OFFICE_APP__;
  const {searchStore} = await import('/js/services/search-engine.js');
  const exec = await app.office.r.execution.get(id);
  const byClient = await searchStore(app.office, 'execution', 'موكل تجريبي', {limit: 20});
  const byNumber = await searchStore(app.office, 'execution', exec.internalNumber, {limit: 20});
  const byReceipt = await searchStore(app.office, 'executionReceipts', 'RC-2025-0001', {limit: 20});
  const byPoa = await searchStore(app.office, 'executionPOAs', 'POA-', {limit: 20});
  return {number: exec.internalNumber, byClient: byClient.items.length, byNumber: byNumber.items.length, byReceipt: byReceipt.items.length, byPoa: byPoa.items.length, route: byClient.items[0]?.route || ''};
}, seed.executionId);
report.search = search;
check('البحث الشامل يجد التنفيذ باسم الموكل', search.byClient >= 1 && search.route === `exc:${seed.executionId}`, JSON.stringify(search));
check('البحث الشامل يجد التنفيذ برقمه وبالمحضر وبالتوكيل', search.byNumber >= 1 && search.byReceipt >= 1 && search.byPoa >= 1, JSON.stringify(search));

// ===== تصفية العدّادات =====
await page.evaluate(() => window.__LAW_OFFICE_APP__.go('executionCenter'));
await page.waitForFunction(() => document.querySelectorAll('#exec-grid tbody tr[data-i]').length > 0, null, {timeout: 30000});
await page.waitForTimeout(1200);
const number = search.number;
await page.locator('[data-counters] .counter[data-count="overdue"]').click();
await page.waitForTimeout(1500);
const overdueVisible = await page.evaluate(num => [...document.querySelectorAll('#exec-grid tbody tr[data-i]')].some(row => row.textContent.includes(num)), number);
await page.locator('[data-counters] .counter[data-count="completed"]').click();
await page.waitForTimeout(1500);
const completedVisible = await page.evaluate(num => [...document.querySelectorAll('#exec-grid tbody tr[data-i]')].some(row => row.textContent.includes(num)), number);
const emptyState = await page.evaluate(() => /لا توجد/.test(document.querySelector('#exec-grid')?.textContent || ''));
report.counterFilter = {overdueVisible, completedVisible, emptyState};
check('عدّاد «عليه متأخرات» يعرض التنفيذ المتأخر', overdueVisible === true, String(overdueVisible));
check('عدّاد «مكتمل السداد» يستبعده (ويظهر فراغ واضح إن لم يكن هناك مكتمل)', completedVisible === false, String(completedVisible));
await page.locator('[data-counters] .counter[data-count="completed"]').click();
await page.waitForTimeout(1200);

report.consoleErrors = [...new Set(report.consoleErrors)].filter(message => !/ERR_CONNECTION_CLOSED|favicon/.test(message));
await context.close();
await browser.close();
await fs.writeFile(path.join(artifactDir, 'report.json'), JSON.stringify(report, null, 2));

console.log(`\n${report.checks.length} فحصًا ناجحًا / ${report.failures.length} فشل`);
for (const item of report.failures) console.log(`FAIL — ${item.name}: ${item.detail}`);
for (const message of report.consoleErrors) console.log(`CONSOLE — ${message}`);
console.log(`PRINT — ${report.printVerification}`);
process.exit(report.failures.length || report.consoleErrors.length ? 2 : 0);
