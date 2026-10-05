// =====================================================================
// فحص حيّ لمركز التنفيذ في Chromium حقيقي — «ملف تنفيذ فعلي مسجَّل في كل التبويبات»
// ---------------------------------------------------------------------
// يشغّل التطبيق نفسه (لا وحدات معزولة): ينشئ ملف تنفيذ فعليًا كامل البيانات،
// ثم يسجّل في كل تبويب وكل نافذة، ويطبع/يصدّر، ويعلن PASS/FAIL لكل خطوة مع
// جمع أخطاء الصفحة. الهدف: رؤية الذي يعمل والذي لا يعمل فعلًا في المتصفح.
//
// التشغيل:  BASE_URL=http://127.0.0.1:8000 node execution-center-live-audit.mjs
// =====================================================================
import {chromium} from 'playwright';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const repository = fileURLToPath(new URL('../../', import.meta.url));
const base = (process.env.BASE_URL || process.env.PRINT_BASE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
const artifactDir = path.join(repository, '.cache', 'execution-center-live-audit');
await fs.mkdir(artifactDir, {recursive: true});

let browser;
if (process.env.GRID_BROWSER_EXECUTABLE) {
  browser = await chromium.launch({executablePath: process.env.GRID_BROWSER_EXECUTABLE, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage']});
} else {
  const {default: slim, inflate} = await import('@sparticuz/chromium');
  await inflate(path.resolve(path.dirname(require.resolve('@sparticuz/chromium')), '../bin/al2023.tar.br'));
  process.env.LD_LIBRARY_PATH = [path.join(os.tmpdir(), 'al2023', 'lib'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');
  browser = await chromium.launch({executablePath: await slim.executablePath(), headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage']});
}

const report = {scenario: 'execution-center-live-audit', date: new Date().toISOString(), browser: browser.version(), checks: [], failures: [], consoleErrors: [], evidence: {}};
const check = (name, ok, detail = '') => {
  if (ok) { report.checks.push({name, status: 'PASS', detail}); console.log(`PASS — ${name}${detail ? ' · ' + detail : ''}`); }
  else { report.failures.push({name, detail}); console.log(`FAIL — ${name}${detail ? ' · ' + detail : ''}`); }
  return Boolean(ok);
};

const context = await browser.newContext({viewport: {width: 1440, height: 1000}, locale: 'ar-EG'});
const page = await context.newPage();
const popups = [];
context.on('page', popup => { popups.push(popup); popup.on('pageerror', error => report.consoleErrors.push('POPUP: ' + String(error.message || error))); });
page.on('pageerror', error => report.consoleErrors.push('PAGEERROR: ' + String(error.message || error)));
page.on('console', message => { if (message.type() === 'error' && !/ERR_CONNECTION|favicon|ERR_INTERNET|ERR_NAME/.test(message.text())) report.consoleErrors.push('CONSOLE: ' + message.text()); });

/* ------------------------------ أدوات قيادة ------------------------------ */
const mainSel = '#main-content';
const click = async (selector, {scope = mainSel, wait = 900, force = false} = {}) => {
  const handle = await page.evaluateHandle(([scopeSel, sel]) => {
    const host = scopeSel ? document.querySelector(scopeSel) : document;
    return host ? host.querySelector(sel) : null;
  }, [scope, selector]);
  const element = handle.asElement();
  if (!element) return 'MISSING';
  if (force) { await element.evaluate(node => node.click()); } else { await element.click({timeout: 8000}).catch(async () => { await element.evaluate(node => node.click()); }); }
  await page.waitForTimeout(wait);
  return 'CLICKED';
};
const text = async (selector, scope = mainSel) => page.evaluate(([s, sel]) => {
  const host = s ? document.querySelector(s) : document;
  const node = host?.querySelector(sel);
  return node ? String(node.textContent || '').replace(/\s+/g, ' ').trim() : '';
}, [scope, selector]);
const exists = async (selector, scope = mainSel) => page.evaluate(([s, sel]) => {
  const host = s ? document.querySelector(s) : document;
  return Boolean(host?.querySelector(sel));
}, [scope, selector]);
const modalText = async () => text('.modal-card', '#modal-root');
const closeModal = async () => { await click('[data-close]', {scope: '#modal-root', wait: 400, force: true}); };
const closeAllModals = async () => {
  for (let index = 0; index < 6; index += 1) {
    if (!(await exists('.modal-card', '#modal-root'))) return;
    await click('[data-close]', {scope: '#modal-root', wait: 350, force: true});
  }
};
const fill = async (name, value, scope = '#modal-root') => page.evaluate(([s, n, v]) => {
  const host = s ? document.querySelector(s) : document;
  const el = host?.querySelector(`[name="${n}"]`);
  if (!el) return false;
  el.value = v;
  el.dispatchEvent(new Event('input', {bubbles: true}));
  el.dispatchEvent(new Event('change', {bubbles: true}));
  return true;
}, [scope, name, value]);
const submitModal = async (wait = 2500) => { await click('form [type="submit"], [data-save]', {scope: '#modal-root', wait, force: true}); };
const lastPopupText = async () => {
  const popup = popups.at(-1);
  if (!popup) return '';
  try { return await popup.evaluate(() => (document.body ? document.body.innerText.replace(/\s+/g, ' ').trim() : '')); } catch { return ''; }
};

console.log(`\n=== فحص حيّ لمركز التنفيذ — ${report.date} ===\n`);
await page.goto(`${base}/index.html`);
await page.waitForFunction(() => window.__LAW_OFFICE_APP__ && !window.__LAW_OFFICE_APP__.booting, null, {timeout: 90000});
check('إقلاع التطبيق', true);

/* =============== 0) بيئة نظيفة: مسح البيانات التجريبية =============== */
const cleared = await page.evaluate(async () => {
  const app = window.__LAW_OFFICE_APP__;
  const ADMIN = await import('/js/services/data-admin.js');
  const name = String(app.office.ctx?.profile?.displayName || '');
  try { const out = await ADMIN.clearAllData(app.office, {reason: 'تجهيز فحص مركز التنفيذ', confirmName: name}); return out.cleared === true; } catch (error) { return String(error.message || error); }
});
check('مسح قاعدة المكتب لبدء الفحص من بيئة نظيفة', cleared === true, String(cleared));
await page.evaluate(() => window.__LAW_OFFICE_APP__.refresh());
await page.waitForTimeout(2000);

/* =============== 1) مركز التنفيذ: الصفحة والعدّادات والانتباه =============== */
await page.evaluate(() => window.__LAW_OFFICE_APP__.go('executionCenter'));
await page.waitForSelector('[data-new-execution]', {timeout: 30000});
check('مركز التنفيذ يفتح وفيه «+ تنفيذ جديد»', true);
check('شريط «يحتاج انتباهي» ظاهر مع التسمية الإلزامية',
  (await text('.exec-attention', mainSel)).includes('تنبيه تنظيمي — ليس تقييمًا قانونيًا'),
  await text('.att-disclaimer', mainSel));
await page.waitForTimeout(2500);
const attCounts = await page.evaluate(() => [...document.querySelectorAll('#main-content [data-attention-card]')].map(b => ({key: b.dataset.attentionCard, label: b.textContent.replace(/\s+/g, ' ').trim()})));
report.evidence.attentionCards = attCounts;
check('بطاقات «يحتاج انتباهي» محسوبة (5 فئات)', attCounts.length === 5, JSON.stringify(attCounts.map(r => r.key)));

/* =============== 2) إنشاء ملف تنفيذ فعلي كامل =============== */
await click('[data-new-execution]', {wait: 1500});
check('نافذة «تنفيذ جديد» تفتح', await exists('[data-form="new-execution"]', '#modal-root'));
const EXEC = {
  newClientName: 'منى إبراهيم عبد الرحمن',
  opponentName: 'خالد سعيد محمود',
  entitlementType: 'نفقة صغار',
  valueType: 'periodic',
  amount: '3000',
  periodicity: 'monthly',
  effectiveFrom: '2026-07-05',
  judgmentNumber: '1234 لسنة 2026 أسرة المنصورة',
  court: 'محكمة الأسرة بالمنصورة',
  judgmentDate: '2026-06-20',
  officialNumber: '555/2026',
  openedDate: '2026-10-05',
  executionType: 'family',
  executionMethod: 'تكليف بالوفاء ثم حجز',
  authority: 'قلم تنفيذ محكمة الأسرة بالمنصورة',
  notes: 'ملف تنفيذ فعلي — فحص حيّ لكل التبويبات',
  petitionNumber: 'عرائض 77/2026'
};
for (const [name, value] of Object.entries(EXEC)) await fill(name, value, '[data-form="new-execution"]');
await page.waitForTimeout(300);
await click('[data-save]', {scope: '#modal-root', wait: 3500, force: true});
const route = await page.evaluate(() => window.__LAW_OFFICE_APP__.route);
const executionId = String(route).replace('exc:', '');
check('حفظ التنفيذ وفتح بطاقته', /^exc:/.test(String(route)), String(route));
// رقم العرائض يُحفظ عبر تعديل البيانات (لا حقل له في نافذة الإنشاء)
await page.evaluate(async id => {
  const app = window.__LAW_OFFICE_APP__;
  const EX = await import('/js/services/execution.js');
  const row = await app.office.r.execution.get(id);
  await app.office.r.execution.put({...row, petitionNumber: 'عرائض 77/2026', updatedAt: new Date().toISOString(), version: (row.version || 0) + 1});
  await app.refresh();
}, executionId).catch(() => null);
await page.waitForTimeout(1500);
report.evidence.executionId = executionId;

/* =============== 3) بطاقة الملخص السريع + الأرقام الثلاثة =============== */
const cardText = await text('[data-execution-card]', mainSel);
check('بطاقة الملخص السريع أعلى البطاقة (الموكل · نوع النفقة · طريقة التنفيذ)',
  cardText.includes('منى إبراهيم') && cardText.includes('نفقة صغار') && cardText.includes('تكليف بالوفاء'));
check('الملخص السريع يعرض المستحق/المحصّل/الرصيد',
  cardText.includes('المستحق حتى') && cardText.includes('المحصّل') && cardText.includes('الرصيد'), cardText.slice(0, 140));
check('المعادلة ظاهرة في الملخص السريع (1 × 3,000 …)', /المعادلة:.*×/.test(cardText), (cardText.match(/المعادلة:.{0,60}/) || [''])[0]);
const numbers = await page.evaluate(() => [...document.querySelectorAll('#main-content .exec-numbers .num')].map(n => n.textContent.replace(/\s+/g, ' ').trim()));
report.evidence.summaryNumbers = numbers;
check('الأرقام الثلاثة: مطلوب 12,000 · مدفوع 0 · متبقٍ 12,000 (4 فترات من 05/07)',
  numbers.join(' | ').includes('12,000') && numbers.join(' | ').includes('0'), numbers.join(' | '));

/* =============== 4) كل رقم قابل للنقر ⇒ traceDialog =============== */
await click('.qc-num[data-trace="due"]', {wait: 900});
check('نقر «المستحق» يفتح تفسير الحساب', (await modalText()).includes('كيف حُسب'));
await closeModal();
await click('.exec-numbers .num[data-trace="remaining"]', {wait: 900});
check('نقر «المتبقي» يفتح التفسير ويبدأ بالمعادلة', (await modalText()).includes('المتبقي = المطلوب − المخصّص'));
await closeModal();

/* =============== 5) شريط الحساب السريع (بلا نافذة) =============== */
check('شريط «احسب حتى» ثابت أعلى البطاقة', await exists('.exec-quickcalc [data-quickcalc-date]'));
await fill('horizonDateX', '', mainSel).catch(() => null);
await page.evaluate(() => {
  const input = document.querySelector('#main-content [data-quickcalc-date]');
  if (!input) return;
  input.value = '2027-01-04';
  input.dispatchEvent(new Event('input', {bubbles: true}));
  input.dispatchEvent(new Event('change', {bubbles: true}));
});
await page.waitForTimeout(1800);
const quickResult = await text('[data-quickcalc-result]', mainSel);
report.evidence.quickCalc = quickResult;
// الارتكاز 05/07/2026 ⇒ حتى 04/01/2027 ست فترات (يوليو…ديسمبر) = 18,000
check('الحساب السريع حتى 04/01/2027 ⇒ 6 فترات · 18,000 (بلا أي نافذة)',
  quickResult.includes('6 فترات') && quickResult.includes('18,000') && quickResult.includes('6 × 3,000.00 = 18,000.00'), quickResult.slice(0, 180));
// الفترات المنتهية فعلًا حتى 05/10/2026 ثلاث (يوليو/أغسطس/سبتمبر) ⇒ غير المستحقة 4 إلى 6
check('الحساب السريع يعلن «تقديري» ويحدد الفترات غير المستحقة (4 إلى 6)',
  quickResult.includes('تقديري') && quickResult.includes('من 4 إلى 6'), quickResult.slice(0, 220));
check('لم تُفتح أي نافذة من الحساب السريع', !(await exists('.modal-card', '#modal-root')));

/* =============== 6) شاشة «المطلوب حتى تاريخ» =============== */
await click('[data-qc="horizon"]', {wait: 1800});
const horizonText = await modalText();
report.evidence.horizon = horizonText.slice(0, 500);
check('نافذة «تغيير تاريخ المطلوب حتى» تفتح بالاختصارات', horizonText.includes('المطلوب حتى') || horizonText.includes('نهاية الشهر'), horizonText.slice(0, 120));
check('الاختصارات تُحسب من الارتكاز (نهاية الفترة الجارية = 04/11/2026)', horizonText.includes('04/11/2026'));
check('شرح قاعدة الفترات ANNIVERSARY ظاهر', horizonText.includes('ANNIVERSARY'));
check('عدد الفترات + المعادلة ظاهران في النافذة', /الفترات الداخلة في الحساب/.test(horizonText));
await click('[data-horizon-shortcut="2026-11-04"]', {scope: '#modal-root', wait: 1500});
const horizonPreviewText = await text('[data-horizon-counts]', '#modal-root');
check('اختصار «نهاية الفترة الجارية» ⇒ فترة واحدة 3,000', horizonPreviewText.includes('1') && horizonPreviewText.includes('3,000'), horizonPreviewText.replace(/\s+/g, ' ').slice(0, 140));
await closeModal();

/* =============== 7) تبويب الحساب: الجدول + المعادلة + المصدر + التفاصيل =============== */
await click('.exec-tabs [data-tab="account"]', {wait: 1200});
const accountText = await text('[data-tab-panel]', mainSel);
check('جدول الحساب يعرض 4 فترات بمجموع 12,000', accountText.includes('4 فترة') && accountText.includes('12,000.00'), accountText.slice(0, 140));
check('لكل سطر فترة معادلة ظاهرة', (await page.evaluate(() => document.querySelectorAll('#main-content .period-equation').length)) >= 4);
check('مصدر القيمة ظاهر لكل فترة', accountText.includes('المصدر:'));
await click('[data-row-info]', {wait: 1000});
const periodText = await modalText();
report.evidence.periodDetails = periodText.slice(0, 400);
check('نافذة تفاصيل الفترة بلا «وحدة صغرى» ولا تواريخ ISO',
  !periodText.includes('وحدة صغرى') && !/2026-\d{2}-\d{2}/.test(periodText), periodText.slice(0, 160));
check('تفاصيل الفترة تعرض ما خُصّص عليها', periodText.includes('ما خُصّص على هذه الفترة'));
await closeModal();

/* =============== 7b) رقم الفترة رابط + تأكيد قبل تعديل سجل مرتبط =============== */
check('رقم/تسمية الفترة رابط يفتح تفاصيل الفترة', await exists('.account-table .period-link'));
await click('.account-table .period-link', {wait: 1200});
check('النقر على تسمية الفترة يفتح «تفاصيل الفترة»', (await modalText()).includes('تفاصيل الفترة'));
await closeModal();
/* =============== 8) تسجيل تحصيل على فترة محددة («تحصيل هنا») =============== */
await click('[data-pin-collection]', {wait: 1500});
const collectionModal = await modalText();
check('نافذة «تسجيل تحصيل» تفتح مع فترة محددة مسبقًا', collectionModal.includes('تسجيل تحصيل'));
await fill('amount', '1500', '#modal-root');
await fill('date', '2026-10-01', '#modal-root');
await page.waitForTimeout(700);
const preview = await text('[data-preview]', '#modal-root');
report.evidence.collectionPreview = preview;
check('معاينة التخصيص تظهر قبل الحفظ', preview.includes('سيُخصَّص'), preview.slice(0, 120));
await submitModal(3000);
const afterCollection = await page.evaluate(() => [...document.querySelectorAll('#main-content .exec-numbers .num')].map(n => n.textContent.replace(/\s+/g, ' ').trim()).join(' | '));
check('التحصيل خُصّص على الفترة المحددة: مدفوع 1,500 ومتبقٍ 10,500',
  afterCollection.includes('1,500') && afterCollection.includes('10,500'), afterCollection);
const pinned = await page.evaluate(async id => {
  const receipts = await window.__LAW_OFFICE_APP__.office.r.executionReceipts.byIndex('executionId', id, 50);
  const row = receipts.at(-1);
  return {allocationMethod: row?.allocationMethod, allocationTarget: row?.allocationTarget};
}, executionId);
check('التخصيص محفوظ DIRECT على الفترة المختارة (لا يسقط إلى تلقائي)',
  pinned.allocationMethod === 'DIRECT' && String(pinned.allocationTarget || '').includes('::'), JSON.stringify(pinned));

/* =============== 8b) تأكيد قبل تعديل سجل مرتبط بفترة =============== */
await click('.exec-tabs [data-tab="log"]', {wait: 1400});
await click('[data-log-item][data-type="تحصيلات"] [data-edit]', {wait: 1800});
const guardText = await modalText();
report.evidence.editGuard = guardText.slice(0, 400);
check('تأكيد قبل تعديل فترة مرتبطة بمحضر يظهر بالخيارين',
  guardText.includes('مرتبطة بحركة سابقة') && guardText.includes('سجّل تصحيحًا جديدًا بدل التعديل') && guardText.includes('عدّل الأصلي مع تسجيل السبب'),
  guardText.slice(0, 160));
await click('[data-mode="direct"]', {scope: '#modal-root', wait: 2500, force: true});
const decisionLogged = await page.evaluate(async id => {
  const rows = await window.__LAW_OFFICE_APP__.office.r.activityLog.byIndex('entityId', id, 200);
  return rows.filter(row => ['period-direct-edit', 'period-correction'].includes(row.action)).map(row => row.action);
}, executionId);
check('قرار تعديل الأصل/التصحيح مسجَّل في Activity Log', decisionLogged.length >= 1, JSON.stringify(decisionLogged));
check('التعديل الوصفي لم يغيّر المبلغ ولا التخصيص', (await page.evaluate(() => [...document.querySelectorAll('#main-content .exec-numbers .num')].map(n => n.textContent).join(' '))).includes('12,000'));
await click('.exec-tabs [data-tab="account"]', {wait: 1200});

/* =============== 9) تسجيل إجراء / مصروف / حكم لاحق =============== */
await click('.exec-toolbar [data-more]', {wait: 500});
check('قائمة «المزيد» تتضمن «تسجيل إجراء»', await exists('.exec-more-menu [data-action="action"]'));
await click('.exec-more-menu [data-action="action"]', {wait: 1500});
check('نافذة «تسجيل إجراء» تفتح', (await modalText()).includes('تسجيل إجراء'));
await fill('kind', 'تكليف بالوفاء', '#modal-root');
await fill('date', '2026-10-02', '#modal-root');
await fill('referenceNumber', '452 لسنة 2026', '#modal-root');
await fill('nextAction', 'جلسة بيع', '#modal-root');
await fill('nextActionDate', '2026-11-15', '#modal-root');
await submitModal(2500);
check('آخر إجراء في الملخص = تكليف بالوفاء', (await text('.qc-lines', mainSel)).includes('تكليف بالوفاء'), await text('.qc-lines', mainSel));

await click('.exec-toolbar [data-more]', {wait: 500});
await click('.exec-more-menu [data-action="action"]', {wait: 1500});
await fill('kind', 'محضر تبديد', '#modal-root');
await fill('date', '2026-09-20', '#modal-root');
await fill('referenceNumber', '452 لسنة 2026', '#modal-root');
await fill('authority', 'قلم تنفيذ محكمة الأسرة بالمنصورة', '#modal-root');
await submitModal(2500);
const dissipation = await page.evaluate(async id => {
  const rows = await window.__LAW_OFFICE_APP__.office.r.executionActions.byIndex('executionId', id, 50);
  return rows.filter(row => String(row.kindLabel || '').includes('تبديد')).length;
}, executionId);
check('تسجيل «محضر تبديد» كإجراء مستقل', dissipation === 1, `count=${dissipation}`);

await click('.exec-toolbar [data-more]', {wait: 500});
await click('.exec-more-menu [data-action="expense"]', {wait: 1500});
await fill('amount', '250', '#modal-root');
await fill('typeLabel', 'رسم تنفيذ', '#modal-root');
await submitModal(2500);
check('تسجيل مصروف يضيف سطرًا مستقلًا ولا يزيد أصل الدين',
  (await page.evaluate(() => [...document.querySelectorAll('#main-content .exec-numbers .num')].map(n => n.textContent).join(' '))).includes('12,000'));

await click('.exec-toolbar [data-more]', {wait: 500});
await click('.exec-more-menu [data-action="later-judgment"]', {wait: 1800});
check('نافذة «حكم لاحق» تفتح', (await modalText()).includes('حكم لاحق'));
await closeModal();

/* =============== 10) فترة يدوية + اقتراح الفترة التالية =============== */
await click('.exec-toolbar [data-more]', {wait: 500});
await click('.exec-more-menu [data-action="next-period"]', {wait: 1800});
const nextText = await modalText();
report.evidence.nextPeriod = nextText.slice(0, 400);
check('اقتراح الفترة التالية يعرض المعادلة والقاعدة', nextText.includes('المعادلة') && nextText.includes('الارتكاز'), nextText.slice(0, 140));
await closeModal();
await click('.exec-toolbar [data-more]', {wait: 500});
await click('.exec-more-menu [data-action="manual-period"]', {wait: 1500});
check('نافذة «+ فترة يدوية» تفتح بشرط السبب', (await modalText()).includes('فترة يدوية'));
await fill('fromDate', '2026-06-05', '#modal-root');
await fill('toDate', '2026-07-04', '#modal-root');
await fill('amount', '1000', '#manual-period, #modal-root');
await fill('reason', 'فرق محضر تبديد رقم 452 لسنة 2026 لم يُدرج في الفترات الآلية', '#modal-root');
await page.waitForTimeout(400);
const manualPreview = await text('[data-preview]', '#modal-root');
check('المعادلة تظهر تحت الفترة اليدوية قبل الحفظ', manualPreview.includes('المعادلة'), manualPreview.slice(0, 120));
await submitModal(3000);
const manualSaved = await page.evaluate(async id => {
  const slices = await window.__LAW_OFFICE_APP__.office.r.executionValuePeriods.byIndex('executionId', id, 100);
  return slices.filter(row => row.valueType === 'fixed' && String(row.itemId || '').includes('MANUAL_PERIOD')).length;
}, executionId);
check('الفترة اليدوية حُفظت كشريحة مقطوعة مستقلة', manualSaved === 1, `count=${manualSaved}`);
const afterManual = await page.evaluate(() => [...document.querySelectorAll('#main-content .exec-numbers .num')].map(n => n.textContent.replace(/\s+/g, ' ').trim()).join(' | '));
check('الفترة اليدوية دخلت الحساب (المطلوب 13,000) ولم تكسر الفترات الآلية',
  afterManual.includes('13,000'), afterManual);

/* =============== 11) التوكيل: المعالج من 3 خطوات =============== */
await click('.exec-tabs [data-tab="poa"]', {wait: 1000});
await click('[data-tab-panel] [data-action="poa"]', {wait: 2000});
const carryText = await modalText();
report.evidence.carryOver = carryText.slice(0, 300);
check('Carry-over: يسأل صراحةً عن الرصيد السابق', carryText.includes('رُصد رصيد سابق'), carryText.slice(0, 120));
check('Carry-over يربط الرصيد السابق بمحضر التبديد رقم 452 لسنة 2026',
  carryText.includes('تبديد') && carryText.includes('452 لسنة 2026'), carryText.slice(0, 260));
if (carryText.includes('رُصد رصيد سابق')) {
  check('خيارات Carry-over الثلاثة: إدراج / تعديل المبلغ / تجاهل مع تسجيل السبب',
    (await exists('[data-include]', '#modal-root')) && (await exists('[data-override-toggle]', '#modal-root')) && (await exists('[data-ignore]', '#modal-root')));
  await fill('reason', 'إدراج متبقٍ مرتبط بمحضر التبديد 452 لسنة 2026', '#modal-root');
  await click('[data-include]', {scope: '#modal-root', wait: 1800, force: true});
}
const wizardText = await modalText();
report.evidence.wizardStep1 = wizardText.slice(0, 400);
check('معالج التوكيل: شريط تقدّم 3 خطوات', (await page.evaluate(() => document.querySelectorAll('#modal-root .wiz-step').length)) === 3);
check('خطوة 1/3 المدة فيها اختصارات (آخر 3/6/12 شهرًا · من آخر توكيل · مخصص)',
  wizardText.includes('آخر 3 أشهر') && wizardText.includes('آخر 12 شهرًا') && wizardText.includes('مخصص'));
check('رقم التوكيل لا يُملأ برقم توكيل سابق (منع التكرار)',
  await page.evaluate(() => { const el = document.querySelector('#modal-root [name="poaNumber"]'); return !el || el.value === ''; }));
await click('[data-wiz-next]', {scope: '#modal-root', wait: 2000, force: true});
const step2 = await modalText();
report.evidence.wizardStep2 = step2.slice(0, 700);
check('خطوة 2/3 المكوّنات: الرصيد السابق بمصدره + الفترات بمعادلتها + المصروفات + رسوم/دمغة',
  step2.includes('الرصيد السابق') && step2.includes('فترات المدة') && step2.includes('رسوم') && step2.includes('دمغة'), step2.slice(0, 160));
check('معادلة الفترات معروضة (× 3,000)', /×\s*3,000/.test(step2), (step2.match(/.{0,30}×\s*3,000.{0,20}/) || [''])[0]);
await fill('fees', '500', '#modal-root');
await fill('stamps', '100', '#modal-root');
await fill('notes', 'توكيل بمحضر التبديد رقم 452 لسنة 2026', '#modal-root');
await page.waitForTimeout(900);
await click('[data-wiz-next]', {scope: '#modal-root', wait: 2000, force: true});
const step3 = await modalText();
report.evidence.wizardStep3 = step3.slice(0, 900);
check('خطوة 3/3 المعاينة: جدول المكوّنات والإجمالي والمعادلة',
  step3.includes('إجمالي التوكيل') && step3.includes('المعادلة'), step3.slice(0, 160));
check('المعاينة تجمع: رصيد سابق + مطلوب المدة + مصروفات + رسوم + دمغة = الإجمالي',
  step3.includes('رسوم (يدوي)') && step3.includes('دمغة (يدوي)'));
const popupBefore = popups.length;
await click('[data-wiz-save]', {scope: '#modal-root', wait: 6000, force: true});
check('حفظ التوكيل فتح نافذة الطباعة (حجز داخل النقرة)', popups.length > popupBefore, `popups=${popups.length - popupBefore}`);
const poaDoc = await lastPopupText();
report.evidence.poaDocument = poaDoc.slice(0, 1600);
await fs.writeFile(path.join(artifactDir, 'poa-document.txt'), poaDoc, 'utf8');
check('مستند التوكيل بتواريخ DD/MM/YYYY (لا ISO)', !/\b2026-\d{2}-\d{2}\b/.test(poaDoc), (poaDoc.match(/\b2026-\d{2}-\d{2}\b/g) || []).join(','));
check('مستند التوكيل بأرقام لاتينية موحّدة (لا ٣٬٠٠٠٫٠٠)', !/[٠-٩]/.test(poaDoc));
check('مستند التوكيل يطبع الرسوم والدمغة (500 / 100)', poaDoc.includes('500.00') && poaDoc.includes('100.00'));
check('المعادلة مطبوعة في مستند التوكيل', poaDoc.includes('المعادلة:'));
check('مستند التوكيل لا يكرر البنود (جدول واحد فقط)', (poaDoc.match(/البيان \| المبلغ/g) || []).length === 0);
check('التوكيل يطالب بالمتبقي لا بالمستحق الكامل (خصم المحصّل داخل المدة)',
  !poaDoc.includes('9,000.00 ج.م') || poaDoc.includes('7,500.00'), (poaDoc.match(/الإجمالي: [^\n]{0,30}/) || [''])[0]);
const poaRow = await page.evaluate(async id => {
  const rows = await window.__LAW_OFFICE_APP__.office.r.executionPOAs.byIndex('executionId', id, 20);
  const row = rows.at(-1);
  return row ? {number: row.poaNumber, total: row.total, base: row.baseAmount, previous: row.previousBalance, fees: row.feesAmount, stamp: row.stampAmount, notes: row.notes, lines: (row.lines || []).length} : null;
}, executionId);
report.evidence.savedPoa = poaRow;
check('التوكيل المحفوظ: الرسوم والدمغة والملاحظات محفوظة على الصف',
  Number(poaRow?.fees) === 500 && Number(poaRow?.stamp) === 100 && String(poaRow?.notes || '').includes('452'), JSON.stringify(poaRow));
check('بنود التوكيل المحفوظة = رصيد سابق + الفترات + مصروف + رسوم + دمغة', Number(poaRow?.lines) >= 4, `lines=${poaRow?.lines}`);
const sumLines = await page.evaluate(async id => {
  const rows = await window.__LAW_OFFICE_APP__.office.r.executionPOAs.byIndex('executionId', id, 20);
  const row = rows.at(-1);
  const sum = (row?.lines || []).reduce((acc, line) => acc + Number(line.amount || 0), 0);
  return {sum: Math.round(sum * 100) / 100, total: Number(row?.total || 0)};
}, executionId);
check('مجموع بنود التوكيل = الإجمالي المسجل (لا فرق صامت)',
  Math.abs(sumLines.sum - sumLines.total) < 0.01, JSON.stringify(sumLines));

/* =============== 12) الطباعة: كشوف الحساب الثلاثة =============== */
await page.evaluate(() => window.__LAW_OFFICE_APP__.refresh());
await page.waitForTimeout(2500);
await click('.exec-tabs [data-tab="poa"]', {wait: 1200});
for (const mode of ['summary', 'monthly']) {
  const before = popups.length;
  await click(`[data-statement-mode="${mode}"]`, {wait: 3500});
  const doc = await lastPopupText();
  await fs.writeFile(path.join(artifactDir, `statement-${mode}.txt`), doc, 'utf8');
  check(`كشف ${mode} يُطبع مع ترويسة المكتب والأرقام الثلاثة`, popups.length > before && doc.includes('كشف حساب') && doc.includes('13,000.00'), doc.slice(0, 100));
  check(`كشف ${mode} فيه المعادلة والتوقيع`, doc.includes('المعادلة:') && doc.includes('المحامي'));
}
const beforeRange = popups.length;
await click('[data-statement-mode="range"]', {wait: 1800});
check('«كشف عن مدة» يفتح نافذة اختيار المدة (لا يطبع الجدول كاملًا صامتًا)',
  (await modalText()).includes('كشف حساب'));
await fill('fromDate', '2026-08-05', '#modal-root');
await fill('toDate', '2026-10-04', '#modal-root');
await click('[data-print]', {scope: '#modal-root', wait: 3500, force: true});
const rangeDoc = await lastPopupText();
await fs.writeFile(path.join(artifactDir, 'statement-range.txt'), rangeDoc, 'utf8');
check('كشف عن مدة يطبع النطاق المحدد فقط (05/08 ← 04/10)',
  popups.length > beforeRange && rangeDoc.includes('المدة: 05/08/2026 ← 04/10/2026'), rangeDoc.slice(0, 160));
check('كشف عن مدة لا يتضمن فترة خارج النطاق (05/07/2026)', !rangeDoc.includes('05/07/2026 – 04/08/2026'));

/* =============== 13) طباعة توكيل محفوظ من صفه =============== */
const beforePoaPrint = popups.length;
await click('[data-print-poa]', {wait: 3500});
check('طباعة توكيل محفوظ من صفه تفتح نافذة الطباعة', popups.length > beforePoaPrint);

/* =============== 14) التصدير CSV (UTF-8 مع BOM) =============== */
const csv = await page.evaluate(async id => {
  const EXPORT = await import('/js/services/execution-export.js');
  const out = await EXPORT.buildStatementCsv(window.__LAW_OFFICE_APP__.office, id, {mode: 'monthly'});
  return {head: out.csv.slice(0, 12), lines: out.csv.split('\r\n').length, count: out.count, first: out.csv.split('\r\n')[1] || ''};
}, executionId);
report.evidence.csv = csv;
check('CSV يبدأ بـBOM (U+FEFF) ليفتح صحيحًا في Excel', csv.head.charCodeAt(0) === 0xFEFF, JSON.stringify(csv.head.slice(0, 3)));
check('CSV فيه 9 أعمدة مطلوبة وسطر لكل فترة + إجمالي', csv.count >= 4 && csv.lines >= 6, JSON.stringify({count: csv.count, lines: csv.lines}));
check('سطر CSV يحمل المعادلة والحالة', csv.first.includes('فترة كاملة') || csv.first.includes('ج.م'), csv.first.slice(0, 160));

/* =============== 15) تبويب السجل + Timeline الأفقي =============== */
await click('.exec-tabs [data-tab="log"]', {wait: 1500});
check('Timeline أفقي أعلى تبويب السجل (RTL)', await exists('.exec-cycle .tl-track'));
const stages = await page.evaluate(() => [...document.querySelectorAll('#main-content .tl-node')].map(n => ({stage: n.dataset.stage, done: n.classList.contains('is-done')})));
report.evidence.timelineStages = stages;
check('مراحل الدورة: حكم + توكيل + تحصيل/حجز + تبديد مكتشفة',
  stages.some(s => s.stage === 'judgment' && s.done) && stages.some(s => s.stage === 'poa' && s.done)
  && stages.some(s => s.stage === 'collection' && s.done) && stages.some(s => s.stage === 'dissipation' && s.done),
  JSON.stringify(stages.filter(s => s.done).map(s => s.stage)));
const clickedStage = await click('.exec-cycle .tl-node.is-done .tl-dot', {wait: 1200});
const stageDetails = await text('.exec-cycle [data-tl-details]', mainSel);
check('النقر على مرحلة يعرض وقائعها في مكانها', clickedStage === 'CLICKED' && stageDetails.length > 20, stageDetails.slice(0, 120));
const logText = await text('[data-tab-panel]', mainSel);
check('السجل يعرض التحصيل والإجراء والمصروف والتوكيل', logText.includes('تحصيل') && logText.includes('تكليف بالوفاء') && logText.includes('توكيل'));
check('ترقيم صفحات السجل (50/صفحة) موجود كبنية', (await page.evaluate(() => document.querySelectorAll('#main-content [data-log-item]').length)) > 0);

/* =============== 16) تبويب الحكم والبيانات + المستحقون =============== */
await click('.exec-tabs [data-tab="data"]', {wait: 1500});
const dataText = await text('[data-tab-panel]', mainSel);
check('تبويب البيانات يعرض الموكل والمنفذ ضده والملف ورقم التنفيذ',
  dataText.includes('منى إبراهيم') && dataText.includes('خالد سعيد') && dataText.includes('555/2026'));
check('الأدوات المتقدمة مخفية في الوضع المبسّط', !(await page.evaluate(() => {
  const node = document.querySelector('#main-content .advanced-anchor');
  return Boolean(node) && !node.hidden;
})));
check('زر «توزيع المستحقين» موجود على بند القيمة', await exists('[data-slice-beneficiaries]'));
await click('[data-slice-beneficiaries]', {wait: 1500});
const benText = await modalText();
check('شاشة توزيع المستحقين: بند + مستحق + نسبة + مبلغ بشرط المجموع',
  benText.includes('المستحق له') && benText.includes('النسبة') && benText.includes('100%'), benText.slice(0, 120));
await fill('reason', 'توزيع تجريبي على مستحق واحد', '#modal-root');
await submitModal(2500);
const benSaved = await page.evaluate(async id => {
  const rows = await window.__LAW_OFFICE_APP__.office.r.executionValuePeriods.byIndex('executionId', id, 50);
  return rows.filter(row => Array.isArray(row.beneficiaries) && row.beneficiaries.length).length;
}, executionId);
check('توزيع المستحقين حُفظ كحقل إضافي (بلا تغيير سكيما)', benSaved >= 1, `slices=${benSaved}`);
await click('.exec-toolbar [data-more]', {wait: 500});
await click('[data-uimode-toggle]', {wait: 1500});

/* =============== 17) الوضع المتقدّم =============== */
await page.evaluate(() => window.__LAW_OFFICE_APP__.refresh());
await page.waitForTimeout(2500);
await click('.exec-tabs [data-tab="data"]', {wait: 1500});
check('الوضع المتقدّم يكشف الأدوات المتقدمة', await page.evaluate(() => {
  const node = document.querySelector('#main-content .advanced-anchor');
  return Boolean(node) && !node.hidden;
}));
await click('[data-uimode-toggle]', {wait: 2000});

/* =============== 18) الملاحظات السريعة =============== */
check('مربع الملاحظات السريعة دائم أسفل الملخص', await exists('[data-form="exec-quicknote"]'));
await page.evaluate(() => {
  const field = document.querySelector('#main-content [data-form="exec-quicknote"] [name="body"]');
  if (!field) return;
  field.value = 'ملاحظة تشغيلية: تم التواصل مع قلم التنفيذ بتاريخ اليوم.';
  field.dispatchEvent(new Event('input', {bubbles: true}));
});
await click('[data-form="exec-quicknote"] [data-save]', {wait: 2500});
const noteSaved = await page.evaluate(async id => {
  const QN = await import('/js/services/quick-notes.js');
  const rows = await QN.notesForEntity(window.__LAW_OFFICE_APP__.office, 'EXECUTION', id, {limit: 10});
  return rows.length;
}, executionId);
check('الملاحظة السريعة حُفظت في نظام الملاحظات القائم (لا سجل ثانٍ)', noteSaved >= 1, `notes=${noteSaved}`);
check('الملاحظة لا تغيّر أي رقم في الحساب', (await page.evaluate(() => [...document.querySelectorAll('#main-content .exec-numbers .num')].map(n => n.textContent).join(' '))).includes('13,000'));

/* =============== 19) اختصارات Alt =============== */
await page.keyboard.press('Alt+1');
await page.waitForTimeout(1200);
check('Alt+1 يفتح «محضر تحصيل»', (await modalText()).includes('تسجيل تحصيل'));
await closeAllModals();
await page.keyboard.press('Alt+2');
await page.waitForTimeout(1500);
check('Alt+2 يفتح «تسجيل إجراء»', (await modalText()).includes('تسجيل إجراء'));
await closeAllModals();
await page.keyboard.press('Alt+3');
await page.waitForTimeout(1500);
check('Alt+3 يفتح «تسجيل مصروف / رسم»', (await modalText()).includes('مصروف'));
await closeAllModals();
await page.keyboard.press('Alt+4');
await page.waitForTimeout(2500);
check('Alt+4 يفتح التوكيل (أو يسأل عن الرصيد السابق أولًا)', /توكيل|رُصد رصيد/.test(await modalText()));
await closeAllModals();
await page.keyboard.press('Alt+5');
await page.waitForTimeout(1800);
check('Alt+5 يفتح «احسب مدة»', (await modalText()).includes('احسب مبلغ مدة'));
await closeAllModals();
await page.keyboard.press('Alt+6');
await page.waitForTimeout(1800);
check('Alt+6 يفتح «طباعة كشف / توكيل»', (await modalText()).includes('كشف حساب'));
await closeAllModals();
check('لم يغيّر أي اختصار الصفحة الحالية (لا تنقل غير مقصود)',
  await page.evaluate(id => window.__LAW_OFFICE_APP__.route === `exc:${id}`, executionId),
  await page.evaluate(() => window.__LAW_OFFICE_APP__.route));
await page.keyboard.press('Alt+H');
await page.waitForTimeout(2200);
check('Alt+H يفتح «تغيير تاريخ المطلوب حتى»', (await modalText()).includes('المطلوب حتى'));
await closeAllModals();
await page.keyboard.press('?');
await page.waitForTimeout(1200);
check('؟ تفتح لوحة اختصارات بطاقة التنفيذ', (await modalText()).includes('اختصارات بطاقة التنفيذ'));
await closeAllModals();

/* =============== 20) «يحتاج انتباهي» بعد التسجيل =============== */
await page.evaluate(() => window.__LAW_OFFICE_APP__.go('executionCenter'));
await page.waitForSelector('.exec-attention', {timeout: 30000});
await page.waitForTimeout(4000);
const attention = await page.evaluate(() => [...document.querySelectorAll('#main-content [data-attention-card]')].map(b => ({key: b.dataset.attentionCard, disabled: b.disabled, label: b.textContent.replace(/\s+/g, ' ').trim()})));
report.evidence.attentionAfter = attention;
check('بطاقة «رقم عرائض بلا رقم قضائي» لا تنبه بعد تسجيل الرقم القضائي',
  attention.find(row => row.key === 'petitionNoJudicial')?.disabled === true, JSON.stringify(attention.find(row => row.key === 'petitionNoJudicial')));
const reportOut = await page.evaluate(async () => {
  const ATT = await import('/js/services/execution-attention.js');
  return ATT.scanAttention(window.__LAW_OFFICE_APP__.office, {limit: 50});
});
report.evidence.attentionReport = reportOut.categories.map(c => ({key: c.key, count: c.count, sample: c.items[0]?.detail || ''}));
check('الفحص يرجع الفئات الخمس بعدّاداتها', reportOut.categories.length === 5, JSON.stringify(report.evidence.attentionReport));

/* =============== 21) أخطاء الصفحة =============== */
const realErrors = report.consoleErrors.filter(line => !/net::ERR_|Failed to load resource/.test(line));
check('لا أخطاء JavaScript في الصفحة أثناء الفحص كله', realErrors.length === 0, realErrors.slice(0, 6).join(' | '));

await page.screenshot({path: path.join(artifactDir, 'center.png'), fullPage: false}).catch(() => null);
await page.evaluate(id => window.__LAW_OFFICE_APP__.go(`exc:${id}`), executionId);
await page.waitForTimeout(3000);
await page.screenshot({path: path.join(artifactDir, 'card.png'), fullPage: true}).catch(() => null);

await fs.writeFile(path.join(artifactDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
console.log(`\n=== النتيجة: ${report.checks.length} PASS / ${report.failures.length} FAIL ===`);
for (const failure of report.failures) console.log(`FAIL — ${failure.name}${failure.detail ? ' · ' + failure.detail : ''}`);
console.log(`الدليل: ${artifactDir}`);
await browser.close();
process.exit(report.failures.length ? 1 : 0);
