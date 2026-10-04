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
await page.waitForFunction(() => document.querySelectorAll('#exec-grid tbody tr').length > 0 && !/جارٍ تحميل/.test(document.querySelector('#exec-grid')?.textContent || ''), null, {timeout: 30000});
const center = await page.evaluate(() => ({
  title: document.querySelector('#page-title').textContent,
  kpis: [...document.querySelectorAll('[data-kpi]')].map(b => `${b.dataset.kpi}=${b.querySelector('b').textContent}`),
  headers: [...document.querySelectorAll('#exec-grid thead th')].map(th => th.textContent.replace(/[↕▾⌄›]/g, '').trim()).filter(Boolean),
  rows: document.querySelectorAll('#exec-grid tbody tr').length,
  sections: [...document.querySelectorAll('[data-section-id]')].map(node => node.dataset.sectionId),
  hasTrash: Boolean(document.querySelector('[data-exec-trash]'))
}));
report.center = center;
check('مركز التنفيذ يُفتح من مسار التنقل', center.title === 'مركز التنفيذ', center.title);
for (const header of ['رقم التنفيذ', 'الموكل', 'رقم الملف', 'نوع التنفيذ', 'القيمة الحالية', 'المحصل', 'المتبقي', 'فرق الحكم', 'آخر فترة', 'آخر توكيل', 'آخر محضر', 'الحالة', 'آخر إجراء']) {
  check(`عمود الجدول العام: ${header}`, center.headers.includes(header), center.headers.join(' | '));
}
check('المؤشرات معروضة', center.kpis.length >= 10, center.kpis.join(' ، '));
check('أقسام الصفحة مطوية/مرتبة عبر نظام الأقسام', ['kpis', 'attention', 'filters', 'grid', 'settlements'].every(id => center.sections.includes(id)), center.sections.join('، '));
check('مركز التنفيذ يعرض مدخل سلة الحذف المنطقي', center.hasTrash, String(center.hasTrash));
await page.screenshot({path: path.join(artifactDir, 'execution-center.png'), fullPage: true});

// ===== بطاقة التنفيذ =====
await page.evaluate(id => window.__LAW_OFFICE_APP__.go(`exc:${id}`), seed.executionId);
await page.waitForSelector('[data-exec-trace]', {timeout: 30000, state: 'attached'});
await page.waitForFunction(() => !/جارٍ التحميل/.test(document.querySelector('[data-exec-trace]')?.textContent || 'جارٍ التحميل'), null, {timeout: 30000});
const card = await page.evaluate(() => {
  const kv = [...document.querySelectorAll('[data-section-id="balance"] .exec-kv > *')].map(node => node.textContent.trim());
  const pairs = {};
  for (let i = 0; i < kv.length; i += 2) pairs[kv[i]] = kv[i + 1];
  return {
    title: document.querySelector('#page-title').textContent,
    balance: pairs,
    periods: document.querySelectorAll('[data-section-id="values"] .exec-table tbody tr').length,
    evolution: [...document.querySelectorAll('.exec-evolution summary')].map(node => node.textContent.trim()),
    receipts: document.querySelectorAll('[data-section-id="receipts"] .exec-table tbody tr').length,
    ledger: document.querySelectorAll('[data-section-id="ledger"] .exec-table tbody tr').length,
    differences: document.querySelectorAll('[data-section-id="differences"] .exec-table tbody tr').length,
    poas: document.querySelectorAll('[data-section-id="poas"] .exec-table tbody tr').length,
    traceNodes: document.querySelectorAll('.exec-trace-node').length,
    quickActions: document.querySelectorAll('[data-quick]').length,
    alerts: [...document.querySelectorAll('.exec-alert-body')].map(node => node.textContent.trim()),
    deletionControls: {
      editExecution: document.querySelectorAll('[data-edit-execution]').length,
      deleteExecution: document.querySelectorAll('[data-delete-execution]').length,
      deleteJudgment: document.querySelectorAll('[data-delete-judgment]').length,
      deleteSlice: document.querySelectorAll('[data-delete-slice]').length,
      deletePoa: document.querySelectorAll('[data-delete-poa]').length
    }
  };
});
report.card = card;
check('الاستحقاق النهائي 42000 (3000 → 4000 بلا ازدواج)', card.balance['الاستحقاق النهائي'] === '٤٢٬٠٠٠٫٠٠', card.balance['الاستحقاق النهائي']);
check('المحصل 2000 والمتبقي 40000', card.balance['المحصل'] === '٢٬٠٠٠٫٠٠' && card.balance['المتبقي'] === '٤٠٬٠٠٠٫٠٠', `${card.balance['المحصل']} / ${card.balance['المتبقي']}`);
check('تفكيك الرصيد: 34000 أصلي + 6000 فروق', card.balance['مكوّن الرصيد الأصلي'] === '٣٤٬٠٠٠٫٠٠' && card.balance['مكوّن فروق الأحكام'] === '٦٬٠٠٠٫٠٠', `${card.balance['مكوّن الرصيد الأصلي']} / ${card.balance['مكوّن فروق الأحكام']}`);
check('12 فترة محسوبة كسولًا', card.periods === 12, String(card.periods));
check('«تطور قيمة الاستحقاق» قابل للفتح ومطوي افتراضيًا', card.evolution.length === 1, card.evolution.join(' ، '));
check('شجرة تتبع الرصيد مبنية حتى المصدر', card.traceNodes > 10, String(card.traceNodes));
check('إجراءات سريعة معروضة', card.quickActions >= 10, String(card.quickActions));
check('أزرار تعديل التنفيذ وحذف الحكم/الشريحة/التوكيل ظاهرة', card.deletionControls.editExecution >= 1 && card.deletionControls.deleteExecution === 1 && card.deletionControls.deleteJudgment >= 2 && card.deletionControls.deleteSlice >= 2 && card.deletionControls.deletePoa >= 1, JSON.stringify(card.deletionControls));
check('المحاضر والدفتر والفروق والتوكيلات معروضة', card.receipts >= 1 && card.ledger >= 1 && card.differences >= 1 && card.poas >= 1, JSON.stringify({receipts: card.receipts, ledger: card.ledger, differences: card.differences, poas: card.poas}));
await page.screenshot({path: path.join(artifactDir, 'execution-card.png'), fullPage: true});

// ===== نافذة التحصيل =====
await page.click('[data-quick="collection"]');
await page.waitForSelector('.modal-card [data-period]', {timeout: 15000});
const dialog = await page.evaluate(() => ({
  title: document.querySelector('.modal-card .modal-title').textContent,
  periods: document.querySelectorAll('.modal-card [data-period]').length,
  methods: [...document.querySelectorAll('.modal-card [name="method"] option')].map(option => option.textContent.trim())
}));
check('نافذة التحصيل تعرض الفترات وطرق التخصيص', dialog.periods === 12 && dialog.methods.length === 5, JSON.stringify(dialog));
check('FIFO ليست الطريقة الافتراضية', dialog.methods[0].includes('مباشر'), dialog.methods.join(' | '));
await page.screenshot({path: path.join(artifactDir, 'execution-collection-dialog.png'), fullPage: true});
await page.click('.modal-card [data-close]');

// ===== لقطة الرصيد =====
await page.click('[data-quick="snapshot"]');
await page.waitForSelector('.modal-card [data-snapshot] .exec-kv', {timeout: 15000});
const snapshot = await page.evaluate(() => document.querySelector('.modal-card [data-snapshot]').textContent.replace(/\s+/g, ' ').trim());
check('اللقطة تُحسب من البيانات ولا تعتمد رقمًا مخزَّنًا', snapshot.includes('٤٢٬٠٠٠٫٠٠') && snapshot.includes('٤٠٬٠٠٠٫٠٠'), snapshot.slice(0, 200));
await page.click('.modal-card [data-close]');

// ===== معاينة الطباعة (فتح المستند فقط — لا معاينة نظام ولا طابعة) =====
const printPopup = context.waitForEvent('page');
await page.click('[data-quick="print-balance"]');
const balanceModal = await page.waitForSelector('.modal-card [data-print]', {timeout: 15000});
void balanceModal;
await page.click('.modal-card [data-print]');
const popup = await printPopup.catch(() => null);
if (popup) {
  await popup.waitForFunction(() => (document.body?.innerText || '').trim().length > 0, null, {timeout: 15000}).catch(() => {});
  const text = (await popup.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
  report.printDocument = text.slice(0, 400);
  check('مستند كشف الرصيد يُبنى ويُفتح للطباعة', text.includes('٤٢٬٠٠٠٫٠٠') || text.includes('42000'), report.printDocument.slice(0, 160));
  await popup.close();
} else {
  report.failures.push({name: 'مستند كشف الرصيد يُبنى ويُفتح للطباعة', detail: 'لم تُفتح نافذة'});
}

// ===== البحث الشامل =====
const search = await page.evaluate(async id => {
  const app = window.__LAW_OFFICE_APP__;
  const {searchStore} = await import('/js/services/search-engine.js');
  const exec = await app.office.r.execution.get(id);
  const byClient = await searchStore(app.office, 'execution', 'موكل تجريبي', {limit: 20});
  const byNumber = await searchStore(app.office, 'execution', exec.internalNumber, {limit: 20});
  const byReceipt = await searchStore(app.office, 'executionReceipts', 'RC-2025-0001', {limit: 20});
  const byPoa = await searchStore(app.office, 'executionPOAs', 'POA-2026-0001', {limit: 20});
  return {number: exec.internalNumber, byClient: byClient.items.length, byNumber: byNumber.items.length, byReceipt: byReceipt.items.length, byPoa: byPoa.items.length, route: byClient.items[0]?.route || ''};
}, seed.executionId);
report.search = search;
check('البحث الشامل يجد التنفيذ باسم الموكل', search.byClient >= 1 && search.route === `exc:${seed.executionId}`, JSON.stringify(search));
check('البحث الشامل يجد التنفيذ برقمه وبالمحضر وبالتوكيل', search.byNumber >= 1 && search.byReceipt >= 1 && search.byPoa >= 1, JSON.stringify(search));

// ===== تصفية المؤشر تفتح قائمة مفلترة =====
await page.evaluate(() => window.__LAW_OFFICE_APP__.go('executionCenter'));
await page.waitForFunction(() => document.querySelectorAll('#exec-grid tbody tr').length > 0, null, {timeout: 30000});
await page.click('[data-kpi="family"]');
await page.waitForFunction(() => document.querySelectorAll('#exec-grid tbody tr[data-i]').length === 1 && /أسرة/.test(document.querySelector('[data-kpi-scope]')?.textContent || ''), null, {timeout: 20000}).catch(() => {});
const filtered = await page.evaluate(() => ({rows: document.querySelectorAll('#exec-grid tbody tr[data-i]').length, scope: document.querySelector('[data-kpi-scope]').textContent}));
await page.click('[data-kpi="negativeBalance"]');
await page.waitForFunction(() => document.querySelectorAll('#exec-grid tbody tr[data-i]').length === 0 && /لا توجد/.test(document.querySelector('#exec-grid')?.textContent || ''), null, {timeout: 20000}).catch(() => {});
// حالة الفراغ تُعرض كصف واحد داخل الجدول، لذلك نتحقق من عدم وجود صفوف بيانات فعلية.
const empty = await page.evaluate(() => ({rows: document.querySelectorAll('#exec-grid tbody tr[data-i]').length, empty: /لا توجد/.test(document.querySelector('#exec-grid')?.textContent || '')}));
report.kpiFilter = {filtered, empty};
check('المؤشر يفتح مجموعة مفلترة فعلًا', filtered.rows === 1 && filtered.scope.includes('أسرة'), JSON.stringify(filtered));
check('مؤشر بلا نتائج يعرض حالة فراغ واضحة', empty.rows === 0 && empty.empty === true, JSON.stringify(empty));

report.consoleErrors = [...new Set(report.consoleErrors)].filter(message => !/ERR_CONNECTION_CLOSED|favicon/.test(message));
await context.close();
await browser.close();
await fs.writeFile(path.join(artifactDir, 'report.json'), JSON.stringify(report, null, 2));

console.log(`\n${report.checks.length} فحصًا ناجحًا / ${report.failures.length} فشل`);
for (const item of report.failures) console.log(`FAIL — ${item.name}: ${item.detail}`);
for (const message of report.consoleErrors) console.log(`CONSOLE — ${message}`);
console.log(`PRINT — ${report.printVerification}`);
process.exit(report.failures.length || report.consoleErrors.length ? 2 : 0);
