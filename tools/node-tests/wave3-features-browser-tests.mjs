// ============================================================
// تحقّق متصفحي لميزات موجة 3 التي لا يغطيها Node:
//   1) اختصارات البيان (manifest shortcuts) تفتح شاشات حقيقية فعلًا.
//   2) «تراجع» بعد الحذف المنطقي من شاشة السجل: modal + إشعار + عودة السجل.
//   3) بطاقة/KPI «توكيلات تحتاج إجراءً» تُعرض وتنقر إلى سجل التوكيل.
//   4) سطر حالة البحث يشرح مصدر النتائج، ويتبع مفتاح FLAG فعلًا.
// التشغيل: node tools/node-tests/wave3-features-browser-tests.mjs
//   QN_BASE_URL-like override: W3_BASE_URL=http://127.0.0.1:8080
// ============================================================
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {chromium} from 'playwright';

const repository = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const mime = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg'};
let server = null;
let base = (process.env.W3_BASE_URL || process.env.GRID_BASE_URL || '').replace(/\/$/, '');
if (!base) {
  server = createServer(async (req, res) => {
    try {
      const relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '');
      const file = path.resolve(repository, relative === '' || relative === 'index.html' ? 'index.html' : relative);
      if (file !== repository && !file.startsWith(repository + path.sep)) { res.writeHead(403).end(); return; }
      res.writeHead(200, {'content-type': mime[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store'});
      res.end(await readFile(file));
    } catch { res.writeHead(404).end('not found'); }
  });
  await new Promise(resolve => server.listen(0, '0.0.0.0', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
}

const report = {scenario: 'wave3-features-ui', base, checks: [], failures: [], consoleErrors: [], status: 'NOT RUN'};
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const check = async (name, fn) => {
  try { await fn(); report.checks.push({name, status: 'VERIFIED'}); console.log(`VERIFIED — ${name}`); }
  catch (error) { report.failures.push({name, detail: String(error?.stack || error).slice(0, 1200)}); console.log(`FAILED — ${name}\n  ${String(error?.message || error)}`); }
};

let browser;
try {
  if (process.env.W3_BROWSER_EXECUTABLE || process.env.GRID_BROWSER_EXECUTABLE) {
    browser = await chromium.launch({executablePath: process.env.W3_BROWSER_EXECUTABLE || process.env.GRID_BROWSER_EXECUTABLE, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage']});
  } else {
    const {default: slim, inflate} = await import('@sparticuz/chromium');
    const require = createRequire(import.meta.url);
    await inflate(path.resolve(path.dirname(require.resolve('@sparticuz/chromium')), '../bin/al2023.tar.br'));
    process.env.LD_LIBRARY_PATH = [path.join(process.env.TMPDIR || '/tmp', 'al2023', 'lib'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');
    browser = await chromium.launch({executablePath: await slim.executablePath(), headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage']});
  }
  report.browser = browser.version();
  const context = await browser.newContext({viewport: {width: 1360, height: 900}, serviceWorkers: 'block', locale: 'ar-EG'});
  const page = await context.newPage();
  page.on('pageerror', error => report.consoleErrors.push(`PAGEERROR ${error.message}`));
  page.on('console', message => { if (message.type() === 'error' && !/ERR_CONNECTION|net::ERR_/.test(message.text())) report.consoleErrors.push(`CONSOLE ${message.text()}`); });
  const go = async route => { await page.evaluate(value => window.__LAW_OFFICE_APP__.go(value), route); await page.waitForTimeout(420); };
  const boot = async () => {
    await page.goto(`${base}/index.html`, {waitUntil: 'domcontentloaded'});
    await page.waitForFunction(() => window.__LAW_OFFICE_APP__ && !window.__LAW_OFFICE_APP__.booting && window.__LAW_OFFICE_APP__.office, null, {timeout: 90000});
  };

  // البيانات تُزرع عبر طبقة الخدمة نفسها (لا كتابة خام): ما يُختبَر هو ما يراه المستخدم.
  await boot();
  const seed = await page.evaluate(async () => {
    const app = window.__LAW_OFFICE_APP__;
    const {saveEntity} = await import('./js/services/entity-save.js');
    const shift = n => { const x = new Date(); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
    const stamp = Date.now();
    const client = await saveEntity(app.office, 'clients', {fullName: 'موكل التوكيل المعلَّق ' + stamp, nationalId: '29' + String(stamp).slice(-12), phones: ['01000000000']});
    const poa = await saveEntity(app.office, 'powersOfAttorney', {clientId: client.id, poaNumber: 'WAVE3' + String(stamp).slice(-5), type: 'خاص', issuedDate: shift(-300), expiryDate: shift(9), status: 'active'});
    const appointment = await saveEntity(app.office, 'appointments', {clientId: client.id, title: 'موعد للحضور أمام المحكمة ' + stamp, date: shift(2), time: '11:00', status: 'scheduled'});
    return {client: client.id, stamp, poaNumber: poa.poaNumber, poa: poa.id, appointment: appointment.id};
  });
  assert(seed.appointment && seed.poa, 'لم يُزرَع ما تحتاجه الجولة');

  await check('بيان التطبيق: اختصارات صحيحة البنية ومطلعة من جذر نسبي', async () => {
    const manifest = await (await fetch(`${base}/manifest.webmanifest`)).json();
    const list = manifest.shortcuts || [];
    assert(list.length >= 2 && list.length <= 4, `عدد الاختصارات ${list.length} — Chrome يقبل 4 كحد أقصى`);
    for (const shortcut of list) {
      assert(shortcut.name && shortcut.short_name && shortcut.description, `اختصار ناقص: ${JSON.stringify(shortcut)}`);
      assert(String(shortcut.url).startsWith('./#'), `الرابط يجب أن يكون داخل النطاق، نسبيًا يبدأ بـ ./#: ${shortcut.url}`);
      assert((shortcut.icons || []).every(i => String(i.src).startsWith('./icons/')), 'أيقونة اختصار خارج مسار الأيقونات');
      assert(shortcut.short_name.length <= 12, `الاسم القصير طويل ويُبتر: ${shortcut.short_name}`);
    }
  });

  const manifestShortcuts = await (await fetch(`${base}/manifest.webmanifest`)).json();
  const titleFor = {'actionCenter': 'مركز العمل', 'search': 'البحث', 'hearings': 'الجلسات', 'quickNotes': 'الملاحظات', 'caseNotes': 'الملاحظات'};
  const shortcutTargets = (manifestShortcuts.shortcuts || [])
    .map(shortcut => ({url: shortcut.url, route: String(shortcut.url).split('#/')[1] || '', hash: String(shortcut.url).replace(/^\.\//, '')}))
    .filter(entry => titleFor[entry.route.split('?')[0]] !== undefined);
  assert(shortcutTargets.length >= 3, 'لا اختصارات قابلة للقياس في البيان');
  for (const {route, hash} of shortcutTargets) {
    const titlePart = titleFor[route.split('?')[0]];
    const url = './' + hash;
    await check(`فتح مباشر من رابط الاختصار ${url} يعرض «${titlePart}» بلا أخطاء صفحة`, async () => {
      const before = report.consoleErrors.length;
      await page.goto(base + '/' + url.replace(/^\.\//, ''), {waitUntil: 'domcontentloaded'});
      await page.waitForFunction(() => window.__LAW_OFFICE_APP__ && !window.__LAW_OFFICE_APP__.booting, null, {timeout: 90000});
      await page.waitForTimeout(900);
      const state = await page.evaluate(() => ({title: document.querySelector('#page-title')?.textContent || '', hash: location.hash}));
      assert(state.title.includes(titlePart), `العنوان الفعلي: «${state.title}»`);
      assert(decodeURIComponent(state.hash.replace(/^#\//, '')) === route, `المسار لم يُحفَظ: ${state.hash} مقابل ${route}`);
      assert(report.consoleErrors.length === before, 'أخطاء كونسول/صفحة أثناء الفتح المباشر');
      if (url.includes('preset=')) {
        // الاختصار لا يفتح الشاشة فحسب: مرشّح الفترة يجب أن يكون مطبَّقًا عند الفتح المباشر
        const chips = await page.evaluate(() => [...document.querySelectorAll('[data-preset].active')].map(b => b.textContent.trim()));
        assert(chips.includes('اليوم'), `مرشّح الفترة لم يُطبَّق عند الفتح المباشر؛ الرقائق النشطة: ${JSON.stringify(chips)}`);
      }
    });
  }

  await check('بطاقة وKPI «توكيلات تحتاج إجراءً» تعرض التوكيل القادم مع اسم الموكل', async () => {
    await go('dashboard');
    await page.waitForTimeout(900);
    const view = await page.evaluate(() => {
      const main = document.querySelector('#main-content');
      const kpi = [...document.querySelectorAll('[data-kpi="powersOfAttorney"]')].map(el => el.textContent.replace(/\s+/g, ' ').trim()).join(' | ');
      const rows = [...document.querySelectorAll('[data-open-rec]')].filter(el => String(el.dataset.openRec || '').startsWith('powersOfAttorney:')).length;
      return {text: (main && main.textContent || '').replace(/\s+/g, ' '), kpi, rows};
    });
    assert(view.text.includes('توكيلات تحتاج إجراءً'), 'لا بطاقة «توكيلات تحتاج إجراءً» في الرئيسية');
    assert(view.text.includes(seed.poaNumber), `البطاقة لا تعرض رقم التوكيل المزروع (${seed.poaNumber})`);
    assert(view.text.includes('موكل التوكيل المعلَّق'), 'اسم الموكل لا يظهر في البطاقة');
    assert(view.rows >= 1, 'لا صف توكيل قابل للنقر في البطاقة');
    assert(/\d|١|٢|٣|٤|٥|٦|٧|٨|٩/.test(view.kpi), `لا عدّاد في KPI التوكيلات: ${view.kpi}`);
  });

  await check('نقرة على صف التوكيل تفتح سجل التوكيل نفسه', async () => {
    // بطاقات الرئيسية مطوية افتراضيًا (سلوك البيت)، فالنقر يبدأ بتوسيع البطاقة
    await page.click('[data-card-key="home:poaExpiry"] .ux-card-toggle');
    await page.waitForTimeout(300);
    assert(await page.evaluate(() => !document.querySelector('[data-card-key="home:poaExpiry"]').classList.contains('is-collapsed')), 'لم تتوسع البطاقة');
    const target = await page.evaluate(() => {
      const el = [...document.querySelectorAll('[data-open-rec]')].find(x => String(x.dataset.openRec || '').startsWith('powersOfAttorney:'));
      return el ? el.dataset.openRec : '';
    });
    assert(target.startsWith('powersOfAttorney:'), `لا صف توكيل (${target})`);
    await page.click(`[data-open-rec="${target}"]`);
    await page.waitForTimeout(700);
    const state = await page.evaluate(() => ({title: document.querySelector('#page-title')?.textContent || '', hash: location.hash, body: document.querySelector('#main-content')?.textContent || ''}));
    assert(state.title.includes('توكيل'), `لم تُفتح صفحة التوكيل: ${state.title}`);
    assert(decodeURIComponent(state.hash.replace(/^#\//, '')) === `rec:${target}`, `المسار لم يُحدَّث صحيحًا: ${state.hash}`);
    assert(state.body.includes(seed.poaNumber), 'لم يُعرض رقم التوكيل داخل صفحته');
  });


  await check('حذف منطقي من شاشة السجل ثم «تراجع»: السجل يعود حيًّا ويُقيَّد في النشاط', async () => {
    await go(`rec:appointments:${seed.appointment}`);
    assert(await page.locator('[data-rec-delete]').count() > 0, 'لا زر حذف منطقي في الشاشة');
    await page.click('[data-rec-delete]');
    await page.waitForSelector('#modal-root [data-ok]', {timeout: 10000});
    await page.click('#modal-root [data-ok]');
    await page.waitForSelector('.toast-act', {timeout: 10000});
    const deleted = await page.evaluate(async id => {
      const office = window.__LAW_OFFICE_APP__.office;
      const raw = await office.r.appointments.getManyRaw([id]);
      const row = await office.r.appointments.get(id);
      const client = raw[0]?.clientId;
      const listed = client ? await office.r.appointments.byIndex('clientId', client, 50) : [];
      return {isDeleted: Boolean(raw[0]?.isDeleted), getReturnsSoftDeleted: Boolean(row), listed: listed.some(x => x.id === id)};
    }, seed.appointment);
    assert(deleted.isDeleted, 'لم يُوضع علَم الحذف المنطقي');
    assert(!deleted.listed, 'السجل المحذوف ما زال يظهر في القائمة المفهرسة');
    await page.click('.toast-act');
    await page.waitForTimeout(900);
    const after = await page.evaluate(async id => {
      const row = await window.__LAW_OFFICE_APP__.office.r.appointments.getManyRaw([id]);
      const log = await window.__LAW_OFFICE_APP__.office.r.activityLog.byIndex('entityId', id, 20);
      return {alive: Boolean(await window.__LAW_OFFICE_APP__.office.r.appointments.get(id)), restored: log.some(x => x.action === 'restore'), deletedFlag: Boolean(row[0]?.isDeleted)};
    }, seed.appointment);
    assert(after.alive && !after.deletedFlag, 'لم يعد السجل بعد التراجع');
    assert(after.restored, 'لم يُسجَّل التراجع في سجل النشاط');
  });

  await check('التراجع متاح فقط داخل نافذة الإشعار: بعد الاختفاء يبقى الحذف كما هو', async () => {
    await go(`rec:appointments:${seed.appointment}`);
    await page.click('[data-rec-delete]');
    await page.waitForSelector('#modal-root [data-ok]', {timeout: 10000});
    await page.click('#modal-root [data-ok]');
    await page.waitForTimeout(200);
    const first = await page.locator('.toast-act').count();
    await page.evaluate(() => {
      const toast = [...document.querySelectorAll('.toast')].find(el => el.querySelector('.toast-act'));
      toast?.querySelector('.toast-x')?.click();
    });
    await page.waitForTimeout(200);
    const later = await page.locator('.toast-act').count();
    assert(first > 0 && later === 0, 'زر التراجع لا يختفي بإغلاق الإشعار');
    const stillDeleted = await page.evaluate(async id => Boolean((await window.__LAW_OFFICE_APP__.office.r.appointments.getManyRaw([id]))[0]?.isDeleted), seed.appointment);
    assert(stillDeleted, 'إغلاق الإشعار أرجع السجل — لا يجوز');
    await page.evaluate(async id => { const m = await import('./js/services/entity-save.js'); await m.restoreEntity(window.__LAW_OFFICE_APP__.office, 'appointments', id); }, seed.appointment);
  });

  const statusAfter = async query => {
    await page.fill('#advanced-q', '');
    await page.waitForTimeout(120);
    await page.fill('#advanced-q', query);
    await page.waitForFunction(() => /عُرضت|لم يتم/.test(document.querySelector('#advanced-status')?.textContent || ''), null, {timeout: 30000});
    return page.evaluate(() => document.querySelector('#advanced-status').textContent);
  };
  await check('سطر حالة البحث يشرح مصدر النتائج ويتبع مفتاح FLAG فعلًا', async () => {
    await go('search');
    await page.waitForSelector('#advanced-q', {timeout: 15000});
    const query = 'موكل التوكيل المعلَّق';
    const warm = await statusAfter(query);
    assert(/عُرضت/.test(warm), `لم تُعرض نتائج: ${warm.slice(0, 160)}`);
    assert(/فهرس الجلسة|مسح المخزن/.test(warm), `لا إيصال بمصدر النتائج: ${warm.slice(0, 200)}`);
    await page.evaluate(async () => { const m = await import('./js/core/feature-flags.js'); m.setFlag('searchKeyCache', false); });
    const off = await statusAfter(query);
    assert(/مسح المخزن/.test(off) && !/فهرس الجلسة/.test(off), `مع تعطيل المفتاح يجب أن يذكر المسح: ${off.slice(0, 200)}`);
    await page.evaluate(async () => { const m = await import('./js/core/feature-flags.js'); m.setFlag('searchKeyCache', true); });
    await statusAfter(query); // أول بحث بعد إعادة المفتاح يبني الفهرس
    const back = await statusAfter(query);
    assert(/فهرس الجلسة/.test(back), `بعد البناء التالي يجب أن يقرأ من الفهرس: ${back.slice(0, 200)}`);
  });

  await check('لا أخطاء تطبيق في الكونسول طوال الجولة', () => assert(report.consoleErrors.length === 0, report.consoleErrors.join(' | ')));

  report.status = report.failures.length ? 'FAIL' : 'PASS';
} finally {
  if (browser) await browser.close();
  if (server) server.close();
  await import('node:fs/promises').then(async fs => {
    await fs.mkdir(path.join(repository, '.cache/wave3-browser'), {recursive: true});
    await fs.writeFile(path.join(repository, '.cache/wave3-browser/report.json'), JSON.stringify(report, null, 2));
  });
}
console.log(`\n${report.checks.length} فحصًا ناجحًا · ${report.failures.length} فشل · الحالة ${report.status}`);
process.exit(report.failures.length ? 1 : 0);
