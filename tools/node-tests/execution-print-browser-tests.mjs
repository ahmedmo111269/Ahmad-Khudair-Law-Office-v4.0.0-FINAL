// فحص طباعة حقيقي في Chromium: كشف حساب متعدد السنوات + توكيل متعدد الصفحات.
// يقيس الترقيم المقيس (كم صفحة أنتجها المستند) ثم يُنتج PDF فعليًا من مسار طباعة
// Chromium ويقارن عدد الصفحات المادية بعدد الصفحات المُرقَّمة — فلا نكتب PASS لما لم يُنفَّذ.
//
// ما لا يغطيه هذا الفحص (يبقى NOT VERIFIED): معاينة الطباعة الأصلية في المتصفح
// (Native Print Preview) والطابعة الورقية.
import {chromium} from 'playwright';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const base = (process.env.PRINT_BASE_URL || process.env.GRID_BASE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
const artifactDir = path.join(repository, '.cache', 'execution-print-browser');
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

const report = {scenario: 'execution-print-pagination', browser: browser.version(), date: new Date().toISOString(), checks: [], failures: [], consoleErrors: []};
const check = (name, ok, detail = '') => {
  if (ok) report.checks.push({name, status: 'PASS', detail});
  else { report.failures.push({name, detail}); console.log(`FAIL — ${name}: ${detail}`); }
  return ok;
};
const countPdfPages = buffer => (buffer.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;

const context = await browser.newContext({viewport: {width: 1366, height: 900}, locale: 'ar-EG'});
const page = await context.newPage();
page.on('pageerror', error => report.consoleErrors.push(String(error.message || error)));
page.on('console', message => { if (message.type() === 'error' && !/favicon|ERR_CONNECTION|ERR_INTERNET|ERR_NAME/.test(message.text())) report.consoleErrors.push(message.text()); });

await page.goto(`${base}/index.html`);
await page.waitForFunction(() => window.__LAW_OFFICE_APP__ && !window.__LAW_OFFICE_APP__.booting, null, {timeout: 90000});

// ===== تجهيز البيانات: 33 فترة مكتملة حتى 05/10/2026 + فترة أكتوبر الجارية للإعلام =====
const seed = await page.evaluate(async () => {
  const app = window.__LAW_OFFICE_APP__, office = app.office;
  const S = await import('/js/services/execution-simple.js');
  const created = await S.createSimpleExecution(office, {
    newClientName: 'طباعة — موكل كشف متعدد السنوات', opponentName: 'طباعة — منفذ ضده',
    entitlementType: 'نفقة شهرية', valueType: 'periodic', amount: 2500, periodicity: 'monthly',
    effectiveFrom: '2024-01-01', effectiveTo: '2026-12-31', judgmentNumber: 'ط-2024/77', court: 'محكمة الأسرة', judgmentDate: '2024-01-10'
  });
  const id = created.execution.id;
  await S.recordSimpleCollection(office, {executionId: id, amount: 30_000, date: '2024-06-15', paymentMethod: 'CASH', notes: 'دفعة 2024'});
  await S.recordSimpleCollection(office, {executionId: id, amount: 12_000, date: '2025-03-20', paymentMethod: 'TRANSFER', notes: 'دفعة 2025'});
  await S.recordSubsequentJudgment(office, {executionId: id, entitlementType: 'نفقة شهرية', amount: 3_000, effectiveFrom: '2026-01-01', judgmentKind: 'APPEAL', judgmentNumber: 'ط-2025/91', court: 'استئناف الأسرة', judgmentDate: '2025-12-20', confirmedIncrease: true});
  await S.recordSimpleExpense(office, {executionId: id, typeLabel: 'رسوم تنفيذ', amount: 750, date: '2024-02-05', includeInPoa: true, label: 'رسوم تنفيذ'});
  const draft = await S.simplePoaDraft(office, id, {fromDate: '2024-01-01', toDate: '2026-12-31', includePreviousBalance: true});
  const poa = await S.saveSimplePoa(office, id, draft, {date: '2026-01-05', notes: 'توكيل طباعة', printNow: false});
  const bundle = await S.simpleCardBundle(office, id, {asOf: '2026-12-31'});
  return {
    executionId: id, poaId: poa.poa?.id || poa.id || '',
    totals: {due: bundle.schedule.totals.dueMinor, paid: bundle.schedule.totals.paidMinor, remaining: bundle.schedule.totals.remainingMinor, periods: bundle.schedule.totals.periodCount}
  };
});
report.seed = seed;
check('المستحق يضم 33 فترة مكتملة حتى أفق 05/10/2026، ولا يستحق أكتوبر الجاري',
  seed.totals.periods === 33 && seed.totals.due === (2500 * 24 + 3000 * 9) * 100
  && seed.totals.paid === 42_000 * 100 && seed.totals.remaining === 45_000 * 100,
  JSON.stringify(seed.totals));

// ===== كشف الحساب: فتح مسار الطباعة من الواجهة ثم قياس الصفحات =====
const [statementPopup] = await Promise.all([
  context.waitForEvent('page'),
  page.evaluate(async id => {
    const S = await import('/js/services/execution-simple.js');
    return S.printSimpleStatement(window.__LAW_OFFICE_APP__.office, id, {mode: 'monthly', asOf: '2026-12-31'});
  }, seed.executionId)
]);
await statementPopup.waitForLoadState('domcontentloaded');
await statementPopup.waitForFunction(() => document.documentElement.dataset.printPages, null, {timeout: 30000});
const statement = await statementPopup.evaluate(() => {
  const pages = [...document.querySelectorAll('.print-page')];
  return {
    pageCount: Number(document.documentElement.dataset.printPages || 0),
    rows: Number(document.documentElement.dataset.printRows || 0),
    footers: pages.map(node => node.querySelector('.page-foot .page-no')?.textContent.trim() || ''),
    tablesPerPage: pages.map(node => node.querySelectorAll('table').length),
    headRowsPerPage: pages.map(node => node.querySelectorAll('table thead tr').length),
    rowCounts: pages.map(node => node.querySelectorAll('table tbody tr').length),
    periodRows: pages.reduce((sum, node) => sum + [...node.querySelectorAll('table')]
      .filter(table => (table.querySelector('thead')?.textContent || '').includes('الفترة'))
      .reduce((inner, table) => inner + table.querySelectorAll('tbody tr').length, 0), 0),
    totalsText: [...document.querySelectorAll('tr.total')].map(node => node.textContent.replace(/\s+/g, ' ').trim()),
    bodyText: document.body.innerText.replace(/\s+/g, ' ')
  };
});
report.statement = statement;

const statementPdf = await statementPopup.pdf({format: 'A4', printBackground: true});
await fs.writeFile(path.join(artifactDir, 'statement-3years.pdf'), statementPdf);
const statementPdfPages = countPdfPages(statementPdf);
report.statementPdfPages = statementPdfPages;

check('كشف 36 شهرًا انقسم إلى أكثر من صفحة واحدة بترقيم متسلسل صحيح',
  statement.pageCount >= 2 && statement.footers.every((text, index) => text === `صفحة ${index + 1} من ${statement.pageCount}`),
  JSON.stringify({pages: statement.pageCount, footers: statement.footers}));
check('33 فترة مكتملة + صف أكتوبر الجاري المعلوماتي + الإجمالي ظاهرة مرة واحدة، والرؤوس تتكرر',
  statement.periodRows === 35 && statement.headRowsPerPage.every(count => count >= 1),
  JSON.stringify({periodRows: statement.periodRows, rowsPerPage: statement.rowCounts, heads: statement.headRowsPerPage}));
check('عدد صفحات PDF الفعلي يطابق عدد الصفحات المُرقَّمة (لا قطع ولا صفحة زائدة)',
  statementPdfPages === statement.pageCount, `${statementPdfPages} صفحة PDF مقابل ${statement.pageCount} صفحة مرقّمة`);
check('إجمالي الكشف صحيح: 87,000 مستحق · 42,000 مدفوع · 45,000 متبقٍ، والمصروف مستقل',
  statement.totalsText.length === 1 && /87,000/.test(statement.totalsText[0]) && /42,000/.test(statement.totalsText[0]) && /45,000/.test(statement.totalsText[0]),
  statement.totalsText[0] || '');
check('كشف الطباعة يفصل asOf عن أفق الاستحقاق ويُظهر الفترة الجارية بصفر فقط',
  statement.bodyText.includes('تاريخ الحساب الفعلي: 31/12/2026') && statement.bodyText.includes('أفق الفترات: 05/10/2026')
  && /01\/10\/2026 – 31\/10\/2026 0\.00/.test(statement.bodyText),
  statement.bodyText.slice(0, 180));
check('حافة الطباعة: المصروف يظهر كسطر مستقل ولا يزيد أصل النفقة',
  /رسوم تنفيذ/.test(statement.bodyText) && /منفصلة عن أصل الدين/.test(statement.bodyText),
  statement.bodyText.slice(0, 120));
await statementPopup.screenshot({path: path.join(artifactDir, 'statement-page-1.png')});

// ===== التوكيل: نفس مسار الطباعة والترقيم على مستند التوكيل القائم =====
let poa = null, poaPdfPages = 0;
if (seed.poaId) {
  const [poaPopup] = await Promise.all([
    context.waitForEvent('page'),
    page.evaluate(async poaId => {
      const S = await import('/js/services/execution-simple.js');
      return S.printSimplePoa(window.__LAW_OFFICE_APP__.office, poaId);
    }, seed.poaId)
  ]);
  await poaPopup.waitForLoadState('domcontentloaded');
  await poaPopup.waitForFunction(() => document.documentElement.dataset.printPages, null, {timeout: 30000});
  poa = await poaPopup.evaluate(() => {
    const pages = [...document.querySelectorAll('.print-page')];
    return {
      pageCount: Number(document.documentElement.dataset.printPages || 0),
      footers: pages.map(node => node.querySelector('.page-foot .page-no')?.textContent.trim() || ''),
      rows: Number(document.documentElement.dataset.printRows || 0),
      text: document.body.innerText.replace(/\s+/g, ' ')
    };
  });
  const poaPdf = await poaPopup.pdf({format: 'A4', printBackground: true});
  await fs.writeFile(path.join(artifactDir, 'poa-3years.pdf'), poaPdf);
  poaPdfPages = countPdfPages(poaPdf);
  report.poa = poa;
  report.poaPdfPages = poaPdfPages;
  check('التوكيل يُطبع بترقيم صفحات مطابق لعدد صفحات PDF الفعلي',
    poa.pageCount >= 1 && poaPdfPages === poa.pageCount && poa.footers.every((text, index) => text === `صفحة ${index + 1} من ${poa.pageCount}`),
    JSON.stringify({pages: poa.pageCount, pdfPages: poaPdfPages, footers: poa.footers}));
  check('التوكيل يعرض الرصيد السابق والإجمالي وبند المصروفات وخطوط الفترة',
    /الرصيد السابق/.test(poa.text) && /الإجمالي/.test(poa.text) && /مصروفات/.test(poa.text) && /فترة التوكيل/.test(poa.text),
    poa.text.slice(0, 260));
} else {
  check('التوكيل المحفوظ متاح للطباعة', false, 'لم يُحفظ توكيل في التجهيز');
}

// ===== كشف السنوات بمدى مخصص (من/إلى) لا يطبع صفوفًا خارج المدى =====
const [rangePopup] = await Promise.all([
  context.waitForEvent('page'),
  page.evaluate(async id => {
    const S = await import('/js/services/execution-simple.js');
    return S.printSimpleStatement(window.__LAW_OFFICE_APP__.office, id, {mode: 'range', fromDate: '2025-01-01', toDate: '2025-12-31', asOf: '2026-12-31'});
  }, seed.executionId)
]);
await rangePopup.waitForLoadState('domcontentloaded');
await rangePopup.waitForFunction(() => document.documentElement.dataset.printPages, null, {timeout: 30000});
const range = await rangePopup.evaluate(() => ({
  rows: Number(document.documentElement.dataset.printRows || 0),
  periodRows: [...document.querySelectorAll('table')].filter(table => (table.querySelector('thead')?.textContent || '').includes('الفترة')).reduce((sum, table) => sum + table.querySelectorAll('tbody tr').length, 0),
  text: document.body.innerText.replace(/\s+/g, ' ')
}));
const rangeRows = range.periodRows;
report.range = {rows: range.rows, periodRows: range.periodRows};
check('كشف مدة مخصصة يطبع 12 شهرًا فقط مع تفصيل المدة',
  rangeRows === 13 && /تفصيل المدة/.test(range.text) && /01\/01\/2025/.test(range.text),
  JSON.stringify({periodRows: rangeRows, declaredRows: range.rows}));

// ===== كشف الرصيد (مسار «أدوات متقدمة» القديم) يأخذ الترقيم نفسه بلا مسار ثانٍ =====
const [balancePopup] = await Promise.all([
  context.waitForEvent('page'),
  page.evaluate(async id => {
    const PR = await import('/js/services/execution-print.js');
    return PR.printBalanceStatement(window.__LAW_OFFICE_APP__.office, id, {asOf: '2026-12-31'});
  }, seed.executionId)
]);
await balancePopup.waitForLoadState('domcontentloaded');
await balancePopup.waitForFunction(() => document.documentElement.dataset.printPages || document.documentElement.dataset.printError, null, {timeout: 30000});
const balance = await balancePopup.evaluate(() => ({
  pages: Number(document.documentElement.dataset.printPages || 0),
  error: document.documentElement.dataset.printError || '',
  footers: [...document.querySelectorAll('.print-page .page-foot .page-no')].map(node => node.textContent.trim()),
  text: document.body.innerText.replace(/\s+/g, ' ')
}));
const balancePdf = await balancePopup.pdf({format: 'A4', printBackground: true});
const balancePdfPages = countPdfPages(balancePdf);
report.balance = {pages: balance.pages, pdfPages: balancePdfPages, error: balance.error};
check('كشف الرصيد القديم يمرّ بنفس مسار الطباعة والترقيم (صفحات مطابقة لـPDF فعلي)',
  !balance.error && balance.pages >= 1 && balancePdfPages === balance.pages
  && balance.footers.every((text, index) => text === `صفحة ${index + 1} من ${balance.pages}`),
  JSON.stringify({pages: balance.pages, pdfPages: balancePdfPages, error: balance.error, footers: balance.footers}));

report.consoleErrors = [...new Set(report.consoleErrors)];
check('لا أخطاء صفحة/كونسول خلال مسارات الطباعة', report.consoleErrors.length === 0, JSON.stringify(report.consoleErrors));

await fs.writeFile(path.join(artifactDir, 'report.json'), JSON.stringify(report, null, 2));
console.log(`\n${report.checks.length} فحصًا ناجحًا / ${report.failures.length} فشل`);
console.log(`PRINT — VERIFIED — Chromium print pipeline PDF (statement ${statementPdfPages} صفحة · توكيل ${poaPdfPages} صفحة)`);
console.log('PRINT — NOT VERIFIED — Native Print Preview dialog and physical printer were not exercised');
await context.close();
await browser.close();
process.exit(report.failures.length || report.consoleErrors.length ? 2 : 0);
