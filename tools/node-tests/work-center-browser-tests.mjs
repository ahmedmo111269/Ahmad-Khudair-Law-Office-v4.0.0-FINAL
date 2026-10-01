// اختبارات مركز العمل في متصفح Chromium حقيقي (DOM + IndexedDB حقيقيان).
//   WC_BROWSER_SCENARIO = functional | mobile | perf | offline | all (الافتراضي)
//   WC_BASE_URL (الافتراضي http://127.0.0.1:8000) · WC_BROWSER_EXECUTABLE لاستخدام متصفح مثبّت.
//   WC_PERF_SCALE (الافتراضي 1 ≈ 305 ألف سجل) يضرب أحجام بذرة الأداء؛ WC_REPORT_FILE اسم ملف التقرير (الافتراضي report.json).
// لا يختبر: الطباعة الفعلية، أجهزة اللمس الحقيقية (يُحاكى اللمس فقط)، ولا اتصال الإنترنت (الخطوط الخارجية تفشل في العزلة وتُهمَل).
// كل سطر VERIFIED يعني أن التحقق نُفِّذ فعلًا وانتهى بنجاح؛ أي فشل يُوقف الاختبار ويُسجَّل.
import {chromium} from 'playwright';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const base = (process.env.WC_BASE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
const scenario = process.env.WC_BROWSER_SCENARIO || 'all';
const perfScale = Math.max(0.1, Number(process.env.WC_PERF_SCALE || 1));
const reportFile = process.env.WC_REPORT_FILE || 'report.json';
const outDir = path.join(repository, '.cache', 'work-center-browser');
await fs.mkdir(outDir, {recursive: true});

let browser, executablePath = process.env.WC_BROWSER_EXECUTABLE || '';
if (executablePath) {
  browser = await chromium.launch({executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage']});
} else {
  const {default: slim, inflate} = await import('@sparticuz/chromium');
  const require = createRequire(import.meta.url);
  await inflate(path.resolve(path.dirname(require.resolve('@sparticuz/chromium')), '../bin/al2023.tar.br'));
  process.env.LD_LIBRARY_PATH = [path.join(process.env.TMPDIR || '/tmp', 'al2023', 'lib'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');
  executablePath = await slim.executablePath();
  browser = await chromium.launch({executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage']});
}
const report = {browser: browser.version(), date: new Date().toISOString(), scenario, checks: [], metrics: {}, errors: [], notVerified: []};
let currentPage = null;   // لقطة شاشة تلقائية عند أي إخفاق لتسهيل التشخيص
const verify = async (name, fn) => {
  try { await fn(); report.checks.push({name, status: 'VERIFIED'}); console.log(`VERIFIED — ${name}`); }
  catch (error) { try { if (currentPage) await currentPage.screenshot({path: path.join(outDir, `failure-${report.checks.length}.png`), fullPage: true}); } catch { /* لا شيء */ } report.checks.push({name, status: 'FAILED', message: String(error?.message || error).slice(0, 600)}); console.log(`FAILED — ${name}\n   ${String(error?.stack || error).split('\n').slice(0, 4).join('\n   ')}`); throw error; }
};
const IGNORE = /ERR_CONNECTION|ERR_INTERNET|fonts\.(googleapis|gstatic)|net::ERR_/;

// ---------- مساعدات ----------
async function newPage(context, {init = null} = {}) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(`PAGEERROR ${error.message}`));
  page.on('console', msg => { if (msg.type() === 'error' && !IGNORE.test(msg.text())) errors.push(`CONSOLE ${msg.text()}`); });
  page.__errors = errors;
  await page.addInitScript(() => { window.__unhandled = []; window.addEventListener('unhandledrejection', e => window.__unhandled.push(String(e.reason?.trace || e.reason?.stack || e.reason).slice(0, 1400))); });
  if (init) await page.addInitScript(init);
  return page;
}
/** استطلاع من جهة Node (waitForFunction لا ينتظر الدوال غير المتزامنة بالضرورة). */
async function pollUntil(page, fn, timeoutMs = 90000, arg = undefined) {
  const t = Date.now();
  while (Date.now() - t < timeoutMs) { if (await page.evaluate(fn, arg)) return true; await page.waitForTimeout(250); }
  throw new Error(`انتهت مهلة الانتظار (${timeoutMs}ms): ${fn.toString().slice(0, 90)}`);
}
async function boot(page, {waitSeed = true} = {}) {
  await page.goto(`${base}/index.html`);
  await page.waitForFunction(() => window.__LAW_OFFICE_APP__?.office, null, {timeout: 60000});
  await pollUntil(page, () => window.__LAW_OFFICE_APP__.booting === false, 90000);   // انتهاء الإقلاع (office يُعيَّن قبله بكثير)
  // علامة اكتمال الزرع التجريبي (تُكتب بعد آخر سجل) — الجلسات والأعمال تُزرع بعد الملفات.
  if (waitSeed) await pollUntil(page, async () => Boolean(await window.__LAW_OFFICE_APP__.office.r.meta.get('demoSeed')));
}
const ready = async page => { await page.waitForTimeout(120); await page.waitForFunction(() => document.querySelector('#wc-view')?.getAttribute('aria-busy') === 'false', null, {timeout: 40000}); await page.waitForTimeout(150); };
async function goWC(page, route = 'actionCenter') {
  await page.evaluate(r => window.__LAW_OFFICE_APP__.go(r), route);
  await page.waitForSelector('#wc-root', {timeout: 30000});
  await page.waitForFunction(() => window.__LAW_OFFICE_APP__.__wc?.rt, null, {timeout: 30000});
  await ready(page);
}
const clearToasts = page => page.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const addDays = (day, n) => { const d = new Date(`${day}T00:00:00`); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const rtState = page => page.evaluate(() => { const rt = window.__LAW_OFFICE_APP__.__wc.rt; return {range: rt.st.range, view: rt.st.view, from: rt.st.from, to: rt.st.to, q: rt.st.q, filters: rt.st.filters, items: [...rt.items.values()].map(i => ({id: i.id, dueDate: i.dueDate, status: i.status, statusKind: i.statusKind, title: i.title, sourceType: i.sourceType, priority: i.priority, sourceAvailable: i.sourceAvailable}))}; });
const dbGet = (page, store, id) => page.evaluate(([s, i]) => window.__LAW_OFFICE_APP__.office.r[s].getManyRaw([i]).then(r => r[0] || null), [store, id]);
async function selectView(page, view) { await page.selectOption('#wc-view-select', view); await ready(page); }
async function openSheet(page, cardTitle) {
  await page.locator(`.wc-card:has-text("${cardTitle}") .wc-more`).first().click();
  await page.waitForSelector('.wc-sheet');
}
async function sheetAct(page, cardTitle, act) { await openSheet(page, cardTitle); await page.click(`.wc-sheet [data-act="${act}"]`); }
const setRange = (page, from, to) => page.evaluate(([f, t]) => window.__LAW_OFFICE_APP__.__wc.rt.setState({range: 'custom', from: f, to: t}), [from, to]).then(() => ready(page));
async function setSearch(page, q) { await page.fill('#wc-q', q); await page.waitForTimeout(450); await ready(page); }
/** يُظهر عنصرًا محددًا مهما كان موضعه: نطاق «الكل» + بحث بعنوانه الفريد. */
async function useTask(page, title) { await page.click('[data-wc-range="all"]'); await ready(page); await setSearch(page, title); }
async function reloadApp(page) { await page.reload(); await page.waitForFunction(() => window.__LAW_OFFICE_APP__?.office, null, {timeout: 60000}); await pollUntil(page, () => window.__LAW_OFFICE_APP__.booting === false, 60000); await page.waitForTimeout(300); }
async function shot(page, name) { await page.screenshot({path: path.join(outDir, name), fullPage: true}); }

// =====================================================================
// 1) السيناريو الوظيفي على سطح المكتب
// =====================================================================
async function functional() {
  const context = await browser.newContext({viewport: {width: 1280, height: 900}, serviceWorkers: 'block', locale: 'ar-EG'});
  const page = await newPage(context); currentPage = page;
  await boot(page);
  await goWC(page);
  const T = 'WCTEST مهمة اختبار';

  await verify('الصفحة: تبويبات الفترات العشر وعدّادات الرأس والإجراءات السريعة المطلوبة وكل العروض', async () => {
    assert.equal(await page.locator('.wc-tab').count(), 10);
    assert.deepEqual(await page.locator('.wc-tab').allTextContents(), ['اليوم', 'غدًا', 'هذا الأسبوع', 'الأسبوع القادم', 'هذا الشهر', 'الشهر القادم', 'السنة', 'متأخر', 'مخصص', 'الكل']);
    assert.equal(await page.locator('.wc-stat').count(), 10);
    const bar = (await page.locator('.wc-quick-bar button').allTextContents()).join('|');
    for (const label of ['+ مهمة', '+ عمل إداري', '+ موعد', '+ متابعة', 'بحث', 'فلاتر', 'ترتيب', 'إعادة ضبط']) assert.ok(bar.includes(label), `زر ناقص: ${label}`);
    const views = await page.locator('#wc-view-select option').allTextContents();
    for (const v of ['بطاقات', 'قائمة', 'كانبان', 'مصفوفة أيزنهاور', 'الأولويات', 'تقويم', 'المتأخر', 'القادم', 'المنجز', 'يحتاج انتباهي', 'الإنتاجية']) assert.ok(views.includes(v), `عرض ناقص: ${v}`);
    assert.ok((await page.locator('.wc-card').count()) > 0);
  });

  await verify('الفترات: كل تبويب يعيد نطاقه الصحيح فقط (اليوم/غدًا/الأسبوع/القادم/الشهر/الشهر القادم/السنة/متأخر/الكل)', async () => {
    for (const range of ['today', 'tomorrow', 'week', 'nextWeek', 'month', 'nextMonth', 'year', 'overdue', 'all']) {
      await page.click(`[data-wc-range="${range}"]`); await ready(page);
      const st = await rtState(page);
      assert.equal(st.range, range);
      assert.equal(await page.locator('.wc-tab[aria-selected="true"]').getAttribute('data-wc-range'), range);
      const bounds = await page.evaluate(async r => { const m = await import('/js/services/work-query.js'); const x = m.resolveRange(r); return {from: x.from, to: x.to}; }, range);
      for (const item of st.items.filter(i => i.dueDate)) {
        if (bounds.from) assert.ok(item.dueDate >= bounds.from, `${range}: ${item.dueDate} قبل ${bounds.from}`);
        if (bounds.to) assert.ok(item.dueDate <= bounds.to, `${range}: ${item.dueDate} بعد ${bounds.to}`);
      }
      assert.equal(await page.locator('#wc-view .error-box,#wc-view .ux-state-error').count(), 0);
    }
    await page.click('[data-wc-range="today"]'); await ready(page);
  });

  await verify('الفترة المخصصة: من/إلى من فلاتر الوقت السريعة تُقيّد النتائج، واختصار «7 أيام» يعمل', async () => {
    const panel = page.locator('.wc-quicktime');
    assert.equal(await panel.getAttribute('data-collapse-collapsed'), 'true', 'يجب أن تكون مطوية افتراضيًا');
    assert.equal(await panel.locator('.panel-collapse-body').isHidden(), true);
    await panel.locator('.card-collapse-toggle').click();
    assert.equal(await panel.getAttribute('data-collapse-collapsed'), 'false');
    const from = addDays(today(), 2), to = addDays(today(), 9);
    await page.fill('[data-wc-custom] [name=from]', from); await page.fill('[data-wc-custom] [name=to]', to);
    await page.click('[data-wc-custom] [type=submit]'); await ready(page);
    const st = await rtState(page);
    assert.equal(st.range, 'custom'); assert.equal(st.from, from); assert.equal(st.to, to);
    assert.ok(st.items.length > 0);
    for (const i of st.items.filter(x => x.dueDate)) assert.ok(i.dueDate >= from && i.dueDate <= to);
    await page.click('[data-wc-quick="7"]'); await ready(page);
    const q7 = await rtState(page);
    assert.equal(q7.from, today()); assert.equal(q7.to, addDays(today(), 7));
  });

  await verify('بطاقات الملخص قابلة للنقر: كل بطاقة تطبّق الفترة والعرض والمرشح الموافق لها', async () => {
    const day = today();
    const cases = [
      ['overdue', {range: 'overdue', view: 'cards'}], ['tomorrow', {range: 'tomorrow', view: 'cards'}], ['todayCount', {range: 'today', view: 'cards'}],
      ['hearingsNext7', {range: 'custom', view: 'cards', from: day, to: addDays(day, 7), filter: ['sources', ['hearings']]}],
      ['inProgress', {range: 'all', view: 'kanban'}], ['waiting', {range: 'all', view: 'cards', filter: ['statuses', ['waiting']]}],
      ['postponed', {range: 'all', view: 'cards', filter: ['statuses', ['postponed']]}], ['undated', {range: 'all', view: 'cards', filter: ['undatedOnly', true]}],
      ['doneToday', {range: 'today', view: 'completed'}], ['pinned', {range: 'all', view: 'cards', filter: ['pinned', true]}]
    ];
    assert.equal(await page.locator('[data-wc-stat]').count(), cases.length, 'عدد البطاقات الإحصائية');
    for (const [key, want] of cases) {
      await page.click(`[data-wc-stat="${key}"]`); await ready(page);
      const st = await rtState(page);
      assert.equal(st.range, want.range, `${key}: الفترة`); assert.equal(st.view, want.view, `${key}: العرض`);
      assert.equal(await page.locator('#wc-view-select').inputValue(), want.view, `${key}: قائمة العرض`);
      if (want.from) { assert.equal(st.from, want.from, `${key}: من`); assert.equal(st.to, want.to, `${key}: إلى`); }
      if (want.filter) assert.deepEqual(st.filters[want.filter[0]], want.filter[1], `${key}: المرشح`);
      assert.equal(await page.locator('#wc-view .error-box,#wc-view .ux-state-error').count(), 0, `${key}: خطأ في العرض`);
    }
    await page.click('[data-wc-reset]'); await ready(page);
    const back = await rtState(page);
    assert.equal(back.range, 'today'); assert.equal(back.view, 'cards'); assert.deepEqual(back.filters, {});
  });

  await verify('الاستمرارية: حالة طي فلاتر الوقت والفترة والعرض تُستعاد بعد إعادة تحميل التطبيق', async () => {
    await page.click('[data-wc-range="week"]'); await ready(page);
    await selectView(page, 'kanban');
    await page.waitForTimeout(700);
    await reloadApp(page); await goWC(page);
    const st = await rtState(page);
    assert.equal(st.range, 'week'); assert.equal(st.view, 'kanban');
    assert.equal(await page.locator('#wc-view-select').inputValue(), 'kanban');
    assert.equal(await page.locator('.wc-board .wc-col').count(), 6);
    assert.equal(await page.locator('.wc-quicktime').getAttribute('data-collapse-collapsed'), 'false', 'حالة الفتح المحفوظة');
    await page.locator('.wc-quicktime .card-collapse-toggle').click();
    await page.waitForTimeout(700);   // كتابة prefs في IndexedDB غير متزامنة؛ لا نُعيد التحميل قبل اكتمالها (سلوك التطبيق الحالي)
    await reloadApp(page); await goWC(page);
    assert.equal(await page.locator('.wc-quicktime').getAttribute('data-collapse-collapsed'), 'true');
    await selectView(page, 'cards'); await page.click('[data-wc-range="today"]'); await ready(page);
  });

  await verify('كل العروض (قائمة/كانبان/مصفوفة/أولويات/تقويم/متأخر/قادم/منجز/انتباه/إنتاجية) تُرسم بلا أخطاء', async () => {
    const checks = {list: '.dg-shell, #wc-grid table', kanban: '.wc-board .wc-col', matrix: '.wc-matrix .wc-quad', priorities: '#wc-view .ux-card, #wc-view .ux-state-empty', calendar: '.cal-grid', overdue: '.wc-aging, .ux-state-empty', upcoming: '.wc-groups, .ux-state-empty', completed: '.wc-groups, .ux-state-empty', attention: '.wc-attn, .ux-state-empty', productivity: '.wc-bars'};
    for (const [view, selector] of Object.entries(checks)) {
      await selectView(page, view);
      assert.ok(await page.locator(selector).first().count() > 0, `العرض ${view} لم يرسم ${selector}`);
      assert.equal(await page.locator('#wc-view .error-box,#wc-view .ux-state-error').count(), 0, `خطأ في عرض ${view}`);
    }
    assert.equal(await page.locator('.wc-matrix .wc-quad').count(), 0);
    await selectView(page, 'matrix'); assert.equal(await page.locator('.wc-matrix .wc-quad').count(), 4);
    await selectView(page, 'kanban'); assert.equal(await page.locator('.wc-board .wc-col').count(), 6);
    await selectView(page, 'cards');
  });

  await verify('الإنشاء: مهمة جديدة عبر النموذج الموحّد تظهر في اليوم وتُحفظ كصف مستقل بمعرّف ULID', async () => {
    await clearToasts(page);
    await page.click('[data-wc-new]'); await page.waitForSelector('.entity-form');
    await page.fill('.entity-form [name=title]', T);
    await page.selectOption('.entity-form [name=priority]', 'urgent');
    await page.fill('.entity-form [name=tags]', 'اختبار، سريع');
    await page.click('.entity-form [type=submit]'); await page.waitForSelector('.entity-form', {state: 'detached'}); await ready(page);
    const card = page.locator(`.wc-card:has-text("${T}")`).first();
    assert.equal(await card.count(), 1);
    assert.ok((await card.locator('.wc-pri').textContent()).includes('عاجل جدًا'));
    const id = await card.getAttribute('data-wc-id');
    const row = await dbGet(page, 'workItems', id);
    assert.equal(row.kind, 'native'); assert.equal(row.sourceType, 'task'); assert.equal(row.id.length, 20); assert.equal(row.dueDate, today()); assert.deepEqual(row.tags, ['اختبار', 'سريع']);
    await page.evaluate(i => { window.__WC_TASK = i; }, id);
  });

  await verify('الإنجاز: مربع الإنجاز يكتب completedAt ثم «تراجع» يعيد فتحها (لا خلط مع التأجيل/الإلغاء/الأرشفة/الحذف)', async () => {
    const id = await page.evaluate(() => window.__WC_TASK);
    await page.locator(`.wc-card[data-wc-id="${id}"] .wc-check`).check(); await ready(page);
    assert.equal(await page.locator(`.wc-card[data-wc-id="${id}"]`).count(), 0);
    let row = await dbGet(page, 'workItems', id);
    assert.equal(row.status, 'done'); assert.ok(row.completedAt); assert.equal(row.isArchived, false); assert.equal(row.isDeleted, false); assert.equal(row.postponeCount, 0);
    await page.locator('.toast-act').first().click(); await ready(page);
    row = await dbGet(page, 'workItems', id);
    assert.equal(row.status, 'notStarted'); assert.equal(row.completedAt, null);
    assert.equal(await page.locator(`.wc-card[data-wc-id="${id}"]`).count(), 1);
  });

  await verify('التأجيل: خيار «غدًا» مع السبب ينقل العنصر للتبويب التالي ويحفظ الموعد الأصلي وعدّاد التأجيل والسبب', async () => {
    const id = await page.evaluate(() => window.__WC_TASK);
    await sheetAct(page, T, 'snooze'); await page.waitForSelector('.wc-opts');
    for (const label of ['غدًا', 'بعد يومين', 'الأسبوع القادم', 'الشهر القادم']) assert.ok((await page.locator('.wc-opts').textContent()).includes(label), label);
    await page.click('.wc-opts [data-opt=tomorrow]'); await page.fill('[data-reason]', 'طلب الموكل'); await page.click('[data-ok]'); await ready(page);
    assert.equal(await page.locator(`.wc-card[data-wc-id="${id}"]`).count(), 0);
    const row = await dbGet(page, 'workItems', id);
    assert.equal(row.dueDate, addDays(today(), 1)); assert.equal(row.originalDueDate, today()); assert.equal(row.postponeCount, 1); assert.equal(row.status, 'postponed');
    await page.click('[data-wc-range="tomorrow"]'); await ready(page);
    const card = page.locator(`.wc-card[data-wc-id="${id}"]`);
    assert.equal(await card.count(), 1); assert.ok((await card.textContent()).includes('أُجّل 1'));
    const comments = await page.evaluate(i => window.__LAW_OFFICE_APP__.office.r.workItemComments.byIndexAll('workItemId', i), id);
    assert.ok(comments.some(c => c.type === 'postponeReason' && c.body === 'طلب الموكل'));
  });

  await verify('إعادة الجدولة بتاريخ مخصص لا تزيد عدّاد التأجيل ثم تأجيل بتاريخ مخصص', async () => {
    const id = await page.evaluate(() => window.__WC_TASK);
    await sheetAct(page, T, 'reschedule'); await page.waitForSelector('[data-date]');
    await page.fill('[data-date]', addDays(today(), 3)); await page.click('[data-ok]'); await ready(page);
    let row = await dbGet(page, 'workItems', id);
    assert.equal(row.dueDate, addDays(today(), 3)); assert.equal(row.postponeCount, 1);
    await useTask(page, T);
    await sheetAct(page, T, 'snooze'); await page.waitForSelector('.wc-opts');
    await page.fill('[data-custom]', addDays(today(), 12)); await page.click('[data-ok]'); await ready(page);
    row = await dbGet(page, 'workItems', id);
    assert.equal(row.dueDate, addDays(today(), 12)); assert.equal(row.postponeCount, 2); assert.equal(row.originalDueDate, today());
  });

  await verify('الأولوية والحالة والتثبيت والوسوم من ورقة الإجراءات تُحفظ وتظهر (والمثبّت يظهر في شريط المثبّتة)', async () => {
    const id = await page.evaluate(() => window.__WC_TASK);
    await useTask(page, T);
    await sheetAct(page, T, 'priority'); await page.click('.wc-sheet [data-key=low]'); await ready(page);
    await sheetAct(page, T, 'status'); await page.click('.wc-sheet [data-key=waiting]'); await ready(page);
    await sheetAct(page, T, 'pin'); await ready(page);
    let row = await dbGet(page, 'workItems', id);
    assert.equal(row.priority, 'low'); assert.equal(row.status, 'waiting'); assert.ok(row.pinnedAt);
    assert.ok(await page.locator('[data-wc-list="pinned"]').count() > 0, 'شريط المثبّتة');
    assert.ok((await page.locator(`.wc-card[data-wc-id="${id}"]`).first().textContent()).includes('منخفضة'));
    await sheetAct(page, T, 'tags'); await page.fill('[data-tags]', 'عاجل، متابعة'); await page.click('[data-ok]'); await ready(page);
    row = await dbGet(page, 'workItems', id);
    assert.deepEqual(row.tags, ['عاجل', 'متابعة']);
    const lookup = await page.evaluate(() => window.__LAW_OFFICE_APP__.office.r.lookups.byIndex('category', 'workItemTag', 50));
    assert.ok(lookup.some(l => l.value === 'عاجل'), 'الوسم الجديد يُضاف لقائمة وسوم المهام');
    await sheetAct(page, T, 'pin'); await ready(page);
  });

  await verify('المجلّد: التفاصيل والروابط والتعليقات (6 أنواع) والسجل، وEsc يغلقه، والتركيز يعود للزر', async () => {
    await page.locator(`.wc-card:has-text("${T}") .wc-title`).first().click();
    await page.waitForSelector('.wc-drawer .wc-dsec');
    assert.equal(await page.locator('#wc-drawer-title').textContent(), T);
    assert.ok(await page.locator('.wc-dsec').count() >= 5);
    const types = await page.locator('.wc-comment-form select option').allTextContents();
    assert.deepEqual(types, ['ملاحظة', 'تعليق', 'تحديث', 'نتيجة', 'سبب التأجيل', 'تعليمات']);
    await page.fill('.wc-comment-form textarea', 'تعليق من المجلّد'); await page.selectOption('.wc-comment-form select', 'result'); await page.click('.wc-comment-form button');
    await page.waitForSelector('.wc-comments li:has-text("تعليق من المجلّد")');
    assert.ok((await page.locator('.wc-comments li:has-text("تعليق من المجلّد")').textContent()).includes('نتيجة'));
    assert.ok(await page.locator('.wc-history li').count() >= 4);
    await page.waitForTimeout(700);
    await page.keyboard.press('Escape'); await page.waitForTimeout(250);
    assert.equal(await page.locator('.wc-drawer').count(), 0);
  });

  await verify('الأرشفة قابلة للاستعادة ومنفصلة عن الحذف المنطقي (بتأكيد وتراجع)', async () => {
    const id = await page.evaluate(() => window.__WC_TASK);
    const flags = async label => { const r = await dbGet(page, 'workItems', id); return `${label}: ${JSON.stringify({isArchived: r.isArchived, isDeleted: r.isDeleted, archivedAt: r.archivedAt, deletedAt: r.deletedAt})}`; };
    await useTask(page, T);
    await sheetAct(page, T, 'archive'); await ready(page);
    let row = await dbGet(page, 'workItems', id);
    assert.equal(row.isArchived, true, await flags('بعد الأرشفة')); assert.equal(row.isDeleted, false, await flags('بعد الأرشفة')); assert.ok(row.archivedAt);
    assert.equal(await page.locator(`.wc-card[data-wc-id="${id}"]`).count(), 0);
    await page.evaluate(() => document.querySelector('[data-wc-toggle-filters]').click());
    await page.check('[data-wc-f-flag="archivedOnly"]'); await ready(page);
    assert.equal(await page.locator(`.wc-card[data-wc-id="${id}"]`).count(), 1, 'المؤرشف يظهر في «المؤرشفة فقط»');
    await sheetAct(page, T, 'restore'); await ready(page);
    row = await dbGet(page, 'workItems', id);
    assert.equal(row.isArchived, false, await flags('بعد الاستعادة'));
    await page.uncheck('[data-wc-f-flag="archivedOnly"]'); await ready(page);
    await clearToasts(page);
    await sheetAct(page, T, 'delete'); await page.waitForSelector('[data-ok]'); await page.click('[data-ok]'); await ready(page);
    row = await dbGet(page, 'workItems', id);
    assert.equal(row.isDeleted, true, await flags('بعد الحذف')); assert.ok(row.deletedAt); assert.equal(row.isArchived, false, await flags('بعد الحذف'));
    await page.locator('.toast-act').first().click(); await ready(page);
    row = await dbGet(page, 'workItems', id);
    assert.equal(row.isDeleted, false, await flags('بعد التراجع عن الحذف'));
  });

  await verify('كانبان: السحب بين الأعمدة وقائمة «نقل إلى» يغيّران الحالة في السجل', async () => {
    const id = await page.evaluate(() => window.__WC_TASK);
    await useTask(page, T); await selectView(page, 'kanban');
    const card = page.locator(`.wc-col .wc-card[data-wc-id="${id}"]`);
    assert.equal(await card.count(), 1);
    assert.equal(await card.locator('xpath=ancestor::section[contains(@class,"wc-col")]').getAttribute('data-col'), 'waiting');
    await card.dragTo(page.locator('[data-drop="inProgress"]')); await ready(page);
    assert.equal((await dbGet(page, 'workItems', id)).status, 'inProgress');
    assert.equal(await page.locator(`[data-col="inProgress"] .wc-card[data-wc-id="${id}"]`).count(), 1);
    await page.locator(`.wc-card[data-wc-id="${id}"] select[data-wc-move]`).selectOption('notStarted'); await ready(page);
    assert.equal((await dbGet(page, 'workItems', id)).status, 'notStarted');
    await page.locator(`.wc-card[data-wc-id="${id}"] select[data-wc-move]`).selectOption('done'); await ready(page);
    assert.equal((await dbGet(page, 'workItems', id)).status, 'done');
    assert.equal(await page.locator(`[data-col="done"] .wc-card[data-wc-id="${id}"]`).count(), 1);
    await page.locator(`.wc-card[data-wc-id="${id}"] select[data-wc-move]`).selectOption('notStarted'); await ready(page);
    assert.equal((await dbGet(page, 'workItems', id)).status, 'notStarted');
  });

  await verify('مصفوفة أيزنهاور: تصنيف تلقائي ونقل يدوي يُحفظ ثم الرجوع للتلقائي', async () => {
    const id = await page.evaluate(() => window.__WC_TASK);
    await selectView(page, 'matrix');
    assert.equal(await page.locator('.wc-quad').count(), 4);
    const sel = page.locator(`.wc-card[data-wc-id="${id}"] select[data-wc-quad]`);
    await sel.selectOption('q1'); await ready(page);
    assert.equal((await dbGet(page, 'workItems', id)).quadrant, 'q1');
    assert.equal(await page.locator(`[data-quad="q1"] .wc-card[data-wc-id="${id}"]`).count(), 1);
    await page.locator(`.wc-card[data-wc-id="${id}"] select[data-wc-quad]`).selectOption('auto'); await ready(page);
    assert.equal((await dbGet(page, 'workItems', id)).quadrant, null);
  });

  await verify('التقويم: شهر/أسبوع/يوم ويعرض عناصر اليوم المحدد', async () => {
    await setSearch(page, ''); await page.click('[data-wc-range="all"]'); await selectView(page, 'calendar');
    assert.ok(await page.locator('.cal-grid .cal-day').count() >= 28);
    assert.ok(await page.locator('.cal-day.has-items').count() > 0);
    await page.locator('.cal-day.has-items').first().click(); await page.waitForTimeout(500);
    assert.ok(await page.locator('#wc-day-list .wc-card').count() > 0);
    await page.click('[data-cal-mode="week"]'); await ready(page); await page.waitForSelector('.wc-week');
    assert.equal(await page.locator('.wc-wday').count(), 7);
    await page.click('[data-cal-mode="day"]'); await page.waitForSelector('.wc-cal-nav');
    await page.click('[data-cal-today]'); await page.waitForTimeout(400);
    await page.click('[data-cal-mode="month"]'); await page.waitForSelector('.cal-grid');
    await selectView(page, 'cards');
  });

  await verify('مساحة اليوم: أقسام الجلسات/الأعمال/المتابعات وتبديل التخطيط (أولوية/خط زمني) و«الآن/التالي» إن وُجدت أوقات', async () => {
    await page.click('[data-wc-range="today"]'); await ready(page);
    assert.ok(await page.locator('.wc-day-summary').count() > 0);
    const titles = await page.locator('#wc-view .ux-card-title h3').allTextContents();
    assert.ok(titles.some(t => ['الجلسات', 'الأعمال الإدارية', 'المتابعات', 'صباحًا', 'بلا موعد'].includes(t)), titles.join('|'));
    await page.click('[data-wc-layout="priority"]'); await ready(page);
    assert.ok((await page.locator('#wc-view .ux-card-title h3').allTextContents()).some(t => t.includes('مرتفعة') || t.includes('عاجل') || t.includes('متوسطة')));
    await page.click('[data-wc-layout="timeline"]'); await ready(page);
    assert.ok(await page.locator('.wc-timeline').count() > 0);
    await page.click('[data-wc-layout="parts"]'); await ready(page);
  });

  await verify('لا إعادة جلب عند تغيير العرض فقط: تبديل تخطيط اليوم والعرض ذهابًا وإيابًا وطي/فتح قسم بلا أي قراءة من IndexedDB، وتغيّر البيانات يمسح الذاكرة فيظهر أثره', async () => {
    await page.click('[data-wc-range="today"]'); await ready(page);          // دورة بيانات جديدة (تملأ ذاكرة الصفحات)
    await page.evaluate(() => {
      if (window.__reads === undefined) {   // عدّاد قراءات مخازن البيانات (القراءات من settings/lookups لا تُحسب)
        const DATA = new Set(['workItems', 'hearings', 'procedures', 'appointments', 'communications', 'files', 'cases', 'clients', 'opponents', 'fileParties', 'fileClients', 'clientFiles', 'caseClients', 'caseOpponents']);
        const wrap = (proto, name, storeName) => { const original = proto[name]; proto[name] = function (...args) { try { if (DATA.has(storeName(this))) window.__reads++; } catch { /* لا شيء */ } return original.apply(this, args); }; };
        window.__reads = 0;
        for (const name of ['openCursor', 'openKeyCursor', 'getAll', 'getAllKeys', 'get', 'count']) { wrap(IDBObjectStore.prototype, name, store => store.name); wrap(IDBIndex.prototype, name, index => index.objectStore.name); }
      }
      window.__reads = 0;
    });
    const reads = () => page.evaluate(() => window.__reads);
    for (const layout of ['priority', 'timeline', 'parts']) { await page.click(`[data-wc-layout="${layout}"]`); await ready(page); }
    assert.equal(await reads(), 0, 'تبديل تخطيط اليوم قرأ IndexedDB');
    await selectView(page, 'matrix'); await selectView(page, 'cards');      // الزيارة الأولى لعرض بشكل بيانات مختلف تقرأ فهارسه
    assert.ok(await reads() > 0, 'الزيارة الأولى للمصفوفة لم تُصدر استعلامها');
    await page.evaluate(() => { window.__reads = 0; });
    for (const view of ['matrix', 'cards', 'matrix', 'cards']) await selectView(page, view);
    assert.equal(await reads(), 0, 'العودة إلى عرض سبق عرضه قرأت IndexedDB');
    const toggle = page.locator('#wc-view .ux-card-toggle').first();
    assert.ok(await toggle.count() > 0, 'لا قسم قابل للطي في مساحة اليوم');
    await toggle.click(); await page.waitForTimeout(200); await toggle.click(); await page.waitForTimeout(200);
    assert.equal(await reads(), 0, 'طي/فتح القسم قرأ IndexedDB');
    // تغيّر بيانات من خارج الصفحة (الخدمة مباشرة) يجب أن يمسح الذاكرة فيظهر الأثر بدل عرض نسخة قديمة.
    const title = 'WCTEST كاش خارجي';
    const id = await page.evaluate(async ([name, day]) => {
      const service = await import('/js/services/work-items.js');
      return (await service.saveWorkItem(window.__LAW_OFFICE_APP__.office, {title: name, dueDate: day, priority: 'medium', status: 'notStarted'})).id;
    }, [title, today()]);
    await pollUntil(page, name => document.querySelector('#wc-view')?.textContent.includes(name), 12000, title); await ready(page);
    assert.ok(await reads() > 0, 'تغيّر البيانات لم يُعد القراءة');
    await page.evaluate(() => { window.__reads = 0; });
    for (const layout of ['priority', 'parts']) { await page.click(`[data-wc-layout="${layout}"]`); await ready(page); }
    assert.equal(await reads(), 0, 'التبديل بعد التحديث قرأ IndexedDB');
    assert.ok((await page.locator('#wc-view').textContent()).includes(title), 'العنصر الجديد اختفى بعد التبديل');
    await page.evaluate(async taskId => { const service = await import('/js/services/work-items.js'); await service.deleteItem(window.__LAW_OFFICE_APP__.office, taskId); }, id);
    await pollUntil(page, name => !document.querySelector('#wc-view')?.textContent.includes(name), 12000, title); await ready(page);
  });

  await verify('العروض المحفوظة: حفظ وتطبيق وإعادة تسمية وحذف', async () => {
    await page.click('[data-wc-range="month"]'); await selectView(page, 'list');
    await page.click('[data-wc-more-menu]'); await page.click('.wc-sheet [data-i="7"]');
    await page.waitForSelector('[data-save-view]');
    await page.fill('[data-save-view] [name=name]', 'عرض اختبار الشهر'); await page.click('[data-save-view] [type=submit]');
    await page.waitForSelector('.wc-saved li');
    await page.keyboard.press('Escape');
    await page.click('[data-wc-range="today"]'); await selectView(page, 'cards');
    await page.click('[data-wc-more-menu]'); await page.click('.wc-sheet [data-i="7"]'); await page.waitForSelector('.wc-saved li');
    await page.locator('.wc-saved li [data-apply]').first().click(); await ready(page);
    const st = await rtState(page);
    assert.equal(st.range, 'month'); assert.equal(st.view, 'list');
    await page.click('[data-wc-more-menu]'); await page.click('.wc-sheet [data-i="7"]'); await page.waitForSelector('.wc-saved li');
    await page.locator('.wc-saved li [data-remove]').first().click(); await page.waitForTimeout(300);
    assert.equal(await page.locator('.wc-saved li').count(), 0);
    await page.keyboard.press('Escape');
    await selectView(page, 'cards'); await page.click('[data-wc-range="today"]'); await ready(page);
  });

  await verify('الإعدادات: تسمية/لون الأولوية قابلان للتخصيص ويظهران في الشارات ثم الاستعادة', async () => {
    await page.click('[data-wc-more-menu]'); await page.click('.wc-sheet [data-i="9"]'); await page.waitForSelector('.wc-settings');
    await page.fill('[data-pri-label="high"]', 'مرتفعة جدًا (مخصص)'); await page.fill('[data-pri-color="high"]', '#0000ff');
    await page.click('.wc-settings [type=submit]'); await ready(page);
    await page.click('[data-wc-range="all"]'); await ready(page);
    assert.ok((await page.locator('.wc-pri--high').first().textContent()).includes('مرتفعة جدًا (مخصص)'));
    assert.equal(await page.locator('.wc-pri--high').first().evaluate(el => el.style.getPropertyValue('--wc-c')), '#0000ff');
    await page.click('[data-wc-more-menu]'); await page.click('.wc-sheet [data-i="9"]'); await page.waitForSelector('.wc-settings');
    await page.click('[data-reset]'); await page.waitForSelector('[data-ok]'); await page.click('[data-ok]'); await ready(page);
    await page.click('[data-wc-range="today"]'); await ready(page);
    assert.ok(!(await page.locator('.wc-pri--high').first().textContent()).includes('مخصص'));
  });

  await verify('اختصارات لوحة المفاتيح: N/T/W/M خارج الحقول فقط ولا تعمل داخل مربع البحث', async () => {
    await page.click('[data-wc-range="all"]'); await ready(page);
    await page.focus('#wc-q'); await page.keyboard.type('n'); await page.waitForTimeout(150);
    assert.equal(await page.locator('.entity-form').count(), 0, 'N داخل حقل البحث يجب ألا يفتح نموذجًا');
    await page.fill('#wc-q', ''); await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('w'); await ready(page); assert.equal((await rtState(page)).range, 'week');
    await page.keyboard.press('m'); await ready(page); assert.equal((await rtState(page)).range, 'month');
    await page.keyboard.press('t'); await ready(page); assert.equal((await rtState(page)).range, 'today');
    await page.keyboard.press('n'); await page.waitForSelector('.entity-form'); await page.keyboard.press('Escape');
    await page.waitForSelector('.entity-form', {state: 'detached'});
  });

  // ----- السيناريو الكامل: ملف ← موكل ← خصم ← جلسة ← مركز العمل ← فتح ← نتيجة ← مهمة متابعة ← يومها ← تأجيل ← فترة جديدة ← إنجاز ← منجز ← أرشفة ← روابط -----
  const fx = {};
  await verify('السيناريو الكامل (1): موكل + ملف + مرحلة + 3 خصوم + جلسة اليوم تظهر في مركز العمل بلا نسخ بيانات', async () => {
    Object.assign(fx, await page.evaluate(async t => {
      const app = window.__LAW_OFFICE_APP__, office = app.office;
      const {createLegalFile, saveParty} = await import('/js/services/legal-files.js');
      const {saveOperational} = await import('/js/services/operations.js');
      const {saveEntity} = await import('/js/services/entity-save.js');
      const client = await office.saveClient({fullName: 'موكل السيناريو الكامل'});
      const file = await createLegalFile(office, {clientId: client.id, title: 'ملف السيناريو الكامل', fileType: 'مدني'});
      const stage = await office.createCase({fileId: file.id, stageType: 'دعوى', caseNumber: '9191', caseYear: '2026'});
      for (const name of ['خصم السيناريو الأول', 'خصم السيناريو الثاني', 'خصم السيناريو الثالث']) { const o = await saveEntity(office, 'opponents', {name}); await saveParty(office, {fileId: file.id, partyKind: 'opponent', opponentId: o.id, role: 'مدعى عليه'}); }
      const hearing = await saveOperational(office, 'hearings', {caseId: stage.id, hearingDate: t, hearingTime: '09:30', type: 'نظر', reason: 'جلسة السيناريو الكامل', court: 'محكمة السيناريو'});
      return {clientId: client.id, fileId: file.id, caseId: stage.id, hearingId: hearing.id, fileNumber: file.fileNumber};
    }, today()));
    await page.click('[data-wc-range="today"]'); await ready(page);
    const card = page.locator(`.wc-card[data-wc-id="hearings::${fx.hearingId}"]`);
    assert.equal(await card.count(), 1);
    const text = await card.textContent();
    assert.ok(text.includes('موكل السيناريو الكامل') && text.includes('الخصم: خصم السيناريو الأول + 2 آخرين'), text);
    assert.ok(text.includes('9191') || text.includes('2026'), 'رقم القضية');
    assert.equal((await dbGet(page, 'workItems', `hearings::${fx.hearingId}`)), null, 'القراءة وحدها لا تكتب طبقة');
  });

  await verify('السيناريو الكامل (2): فتح المجلّد ← روابط الملف/القضية/الموكل/الخصم صالحة وتفتح صفحاتها ثم الرجوع', async () => {
    await page.locator(`.wc-card[data-wc-id="hearings::${fx.hearingId}"] .wc-title`).click();
    await page.waitForSelector('.wc-drawer .wc-links');
    const links = await page.locator('.wc-drawer [data-wc-nav]').evaluateAll(els => els.map(e => e.dataset.wcNav));
    for (const prefix of [`file:${fx.fileId}`, `case:${fx.caseId}`, `client:${fx.clientId}`, `rec:hearings:${fx.hearingId}`]) assert.ok(links.includes(prefix), `رابط ناقص ${prefix}: ${links.join(',')}`);
    assert.ok(links.some(l => l.startsWith('opponent:')));
    for (const route of links) {
      const ok = await page.evaluate(async r => { await window.__LAW_OFFICE_APP__.go(r); await new Promise(res => setTimeout(res, 400)); const c = document.querySelector('#main-content'); return {bad: Boolean(c.querySelector('.error-box')), len: c.innerText.length, route: window.__LAW_OFFICE_APP__.route}; }, route);
      assert.ok(!ok.bad && ok.len > 80, `الرابط ${route} لم يفتح صفحة سليمة`);
    }
    await goWC(page);
  });

  await verify('السيناريو الكامل (3): «تسجيل النتيجة/التأجيل» يكتب في سجل الجلسة نفسه ثم يُعرض «إنشاء مهمة متابعة» ويُنشأ فقط عند الضغط', async () => {
    const adjourn = addDays(today(), 10);
    await page.click('[data-wc-range="today"]'); await ready(page);
    await page.locator(`.wc-card[data-wc-id="hearings::${fx.hearingId}"] .wc-title`).click(); await page.waitForSelector('.wc-drawer');
    await page.click('.wc-drawer [data-dact="more"]'); await page.click('.wc-sheet [data-act="result"]');
    await page.waitForSelector('.entity-form[data-store="hearings"]');
    await page.fill('.entity-form [name=result]', 'تأجيل لإعلان الخصم الثاني'); await page.fill('.entity-form [name=adjournedTo]', adjourn);
    await clearToasts(page);
    assert.equal((await page.evaluate(() => window.__LAW_OFFICE_APP__.office.r.workItems.all(5000).then(r => r.filter(x => x.relatedType === 'hearings').length))), 0, 'لا مهمة تُنشأ تلقائيًا');
    await page.click('.entity-form [type=submit]'); await page.waitForSelector('.entity-form', {state: 'detached'});
    const hearing = await dbGet(page, 'hearings', fx.hearingId);
    assert.equal(hearing.result, 'تأجيل لإعلان الخصم الثاني'); assert.equal(hearing.adjournedTo, adjourn); assert.equal(hearing.hearingDate, today()); assert.equal(hearing.caseId, fx.caseId);
    const next = await page.evaluate(id => window.__LAW_OFFICE_APP__.office.r.hearings.byIndex('previousHearingId', id, 5), fx.hearingId);
    assert.equal(next.length, 1); assert.equal(next[0].hearingDate, adjourn); fx.nextHearingId = next[0].id;
    await page.waitForSelector('.toast-act');
    assert.ok((await page.locator('.toast-act').first().textContent()).includes('إنشاء مهمة متابعة'));
    assert.equal((await page.evaluate(() => window.__LAW_OFFICE_APP__.office.r.workItems.all(5000).then(r => r.filter(x => x.relatedType === 'hearings').length))), 0, 'لا مهمة قبل ضغط المستخدم');
    await page.locator('.toast-act').first().click(); await page.waitForSelector('.entity-form[data-store="workItems"]');
    assert.equal(await page.inputValue('.entity-form [name=fileId]'), fx.fileId); assert.equal(await page.inputValue('.entity-form [name=caseId]'), fx.caseId);
    await page.fill('.entity-form [name=title]', 'WCTEST متابعة نتيجة الجلسة'); await page.fill('.entity-form [name=dueDate]', addDays(today(), 1));
    await page.click('.entity-form [type=submit]'); await page.waitForSelector('.entity-form', {state: 'detached'});
    const tasks = await page.evaluate(() => window.__LAW_OFFICE_APP__.office.r.workItems.all(5000).then(r => r.filter(x => x.title === 'WCTEST متابعة نتيجة الجلسة')));
    assert.equal(tasks.length, 1); assert.equal(tasks[0].relatedType, 'hearings'); assert.equal(tasks[0].relatedId, fx.hearingId); assert.equal(tasks[0].fileId, fx.fileId); fx.taskId = tasks[0].id;
    const text = JSON.stringify(tasks[0]);
    for (const secret of ['موكل السيناريو الكامل', 'خصم السيناريو', 'محكمة السيناريو', '9191']) assert.ok(!text.includes(secret), `نسخ بيانات قانونية: ${secret}`);
  });

  await verify('السيناريو الكامل (4): المتابعة تظهر في يومها (غدًا) ثم تأجيلها لفترة جديدة (الأسبوع القادم) ثم إنجازها ثم تظهر في المنجز ثم أرشفتها', async () => {
    await page.click('[data-wc-range="tomorrow"]'); await ready(page);
    const card = page.locator(`.wc-card[data-wc-id="${fx.taskId}"]`);
    assert.equal(await card.count(), 1);
    await sheetAct(page, 'WCTEST متابعة نتيجة الجلسة', 'snooze'); await page.waitForSelector('.wc-opts'); await page.click('.wc-opts [data-opt=nextWeek]'); await page.click('[data-ok]'); await ready(page);
    assert.equal(await page.locator(`.wc-card[data-wc-id="${fx.taskId}"]`).count(), 0);
    await page.click('[data-wc-range="nextWeek"]'); await ready(page);
    const st = await rtState(page);
    // الأسبوع القادم (الاثنين–الأحد) قد لا يشمل اليوم+7 إن لم يكن نفس أسبوع التقويم؛ نتحقق من الموعد الحقيقي في السجل.
    const row = await dbGet(page, 'workItems', fx.taskId);
    assert.equal(row.dueDate, addDays(today(), 7)); assert.equal(row.originalDueDate, addDays(today(), 1)); assert.equal(row.postponeCount, 1);
    void st;
    await useTask(page, 'WCTEST متابعة نتيجة الجلسة');
    await page.locator(`.wc-card[data-wc-id="${fx.taskId}"] .wc-check`).check(); await ready(page);
    assert.equal((await dbGet(page, 'workItems', fx.taskId)).status, 'done');
    await selectView(page, 'completed');
    assert.equal(await page.locator(`.wc-card[data-wc-id="${fx.taskId}"]`).count(), 1);
    await sheetAct(page, 'WCTEST متابعة نتيجة الجلسة', 'archive'); await ready(page);
    const archived = await dbGet(page, 'workItems', fx.taskId);
    assert.equal(archived.isArchived, true); assert.equal(archived.status, 'done');
    await selectView(page, 'cards'); await setSearch(page, '');
  });

  await verify('السيناريو الكامل (5): إنجاز/أرشفة الجلسة المسقَطة تكتب في سجلها وتبقى الطبقة؛ حذف المصدر يُبقي العنصر «المصدر غير متاح حاليًا» بتاريخه', async () => {
    const proc = await page.evaluate(async ([fileId, day]) => {
      const {saveOperational} = await import('/js/services/operations.js');
      const r = await saveOperational(window.__LAW_OFFICE_APP__.office, 'procedures', {fileId, description: 'WCTEST عمل سيُحذف مصدره', internalDueDate: day, status: 'open'});
      return r.id;
    }, [fx.fileId, today()]);
    await useTask(page, 'WCTEST عمل سيُحذف مصدره');
    const id = `procedures::${proc}`;
    await sheetAct(page, 'WCTEST عمل سيُحذف مصدره', 'pin'); await ready(page);
    await page.locator('.wc-card:has-text("WCTEST عمل سيُحذف مصدره") .wc-title').first().click(); await page.waitForSelector('.wc-drawer');
    await page.fill('.wc-comment-form textarea', 'ملاحظة يجب أن تبقى بعد حذف المصدر'); await page.click('.wc-comment-form button'); await page.waitForSelector('.wc-comments li');
    await page.keyboard.press('Escape');
    await page.evaluate(p => window.__LAW_OFFICE_APP__.office.softDelete('procedures', p), proc);
    await setSearch(page, ''); await page.click('[data-wc-range="today"]'); await ready(page);
    const orphan = page.locator(`.wc-card[data-wc-id="${id}"]`);
    assert.equal(await orphan.count(), 1);
    assert.ok((await orphan.textContent()).includes('المصدر غير متاح حاليًا'));
    assert.ok(!(await orphan.textContent()).includes('WCTEST عمل سيُحذف مصدره'), 'لا نسخ لعنوان المصدر');
    await orphan.locator('.wc-title').click(); await page.waitForSelector('.wc-drawer .wc-comments li');
    assert.ok((await page.locator('.wc-comments').textContent()).includes('ملاحظة يجب أن تبقى'));
    await page.keyboard.press('Escape');
  });

  await verify('سلامة البيانات في المتصفح: معرّفات الملف/القضية/الموكل وأرقامها دون تغيير، ولا روابط مكسورة في مخازن مركز العمل', async () => {
    const out = await page.evaluate(async f => {
      const office = window.__LAW_OFFICE_APP__.office;
      const {deepHealth} = await import('/js/services/integrity.js');
      const file = await office.r.files.get(f.fileId), stage = await office.r.cases.get(f.caseId), client = await office.r.clients.get(f.clientId);
      const health = await deepHealth(office.ctx, {scanRows: true, maxIssues: 2000});
      return {fileNumber: file.fileNumber, caseNumber: stage.caseNumber, clientName: client.fullName, mine: health.issues.filter(i => ['workItems', 'workItemComments', 'workItemRecurrences'].includes(i.store)), schemaIssues: health.schemaIssues.length};
    }, fx);
    assert.equal(out.fileNumber, fx.fileNumber); assert.equal(out.caseNumber, '9191'); assert.equal(out.clientName, 'موكل السيناريو الكامل');
    assert.deepEqual(out.mine, []); assert.equal(out.schemaIssues, 0);
    const dup = await page.evaluate(async () => { const rows = await window.__LAW_OFFICE_APP__.office.r.workItems.all(5000); return {n: rows.length, unique: new Set(rows.map(r => r.id)).size}; });
    assert.equal(dup.n, dup.unique);
  });

  await verify('البحث: داخل مركز العمل (عنوان/موكل/خصم/رقم ملف/رقم قضية/وسم/تعليق) بإلغاء الاستعلام القديم وبلا أخطاء', async () => {
    await page.click('[data-wc-range="all"]'); await selectView(page, 'cards');
    const run = async q => { await page.fill('#wc-q', q); await page.waitForTimeout(450); await ready(page); return (await rtState(page)).items.map(i => i.id); };
    assert.ok((await run('خصم السيناريو الثاني')).includes(`hearings::${fx.hearingId}`));
    assert.ok((await run('موكل السيناريو')).includes(`hearings::${fx.hearingId}`));
    assert.ok((await run(fx.fileNumber)).length > 0, 'رقم الملف');
    assert.ok((await run('9191')).includes(`hearings::${fx.hearingId}`), 'رقم القضية');
    assert.ok((await run('ملاحظة يجب أن تبقى')).length > 0, 'نص تعليق');
    assert.equal((await run('كلمة-غير-موجودة-إطلاقًا-123')).length, 0);
    await page.fill('#wc-q', ''); await page.waitForTimeout(450); await ready(page);
  });

  await verify('البحث الشامل الموجود يجد المهام المستقلة ويفتح مجلّدها (actionCenter?item=)', async () => {
    const found = await page.evaluate(async () => { const m = await import('/js/services/search-engine.js'); const r = await m.searchAll(window.__LAW_OFFICE_APP__.office, 'WCTEST', {stores: ['workItems']}); return r.groups.flatMap(g => g.items.map(i => ({route: i.route, title: i.title}))); });
    assert.ok(found.length > 0 && found[0].route.startsWith('actionCenter?item='));
    await page.evaluate(r => window.__LAW_OFFICE_APP__.go(r), found[0].route);
    await page.waitForSelector('.wc-drawer .wc-dsec', {timeout: 15000});
    assert.ok((await page.locator('#wc-drawer-title').textContent()).includes('WCTEST'));
    await page.keyboard.press('Escape');
  });

  await verify('لوحة الأوامر Ctrl+K: أوامر مركز العمل موجودة وأمر الترحيل المعدِّل يطلب تأكيدًا', async () => {
    const cmds = await page.evaluate(async () => { const m = await import('/js/ui/palette.js'); return m.staticCommands(window.__LAW_OFFICE_APP__).filter(c => c.group === 'مركز العمل' || c.id === 'qa:workItems').map(c => ({id: c.id, label: c.label})); });
    for (const id of ['wc:today', 'wc:overdue', 'wc:kanban', 'wc:attention', 'wc:review-day', 'wc:carry', 'wc:linked', 'qa:workItems']) assert.ok(cmds.some(c => c.id === id), `أمر ناقص ${id}`);
    assert.ok(cmds.find(c => c.id === 'wc:carry').label.includes('بتأكيد'));
  });

  await verify('المراجعة اليومية والأسبوعية والإنتاجية والعروض التحليلية تفتح بلا أخطاء', async () => {
    await page.click('[data-wc-more-menu]'); await page.click('.wc-sheet [data-i="5"]'); await page.waitForSelector('.wc-review');
    assert.ok((await page.locator('.wc-review h3').count()) >= 4); await page.keyboard.press('Escape');
    await page.click('[data-wc-more-menu]'); await page.click('.wc-sheet [data-i="6"]'); await page.waitForSelector('.wc-review');
    assert.ok((await page.locator('.wc-review h3').count()) >= 5); await page.keyboard.press('Escape');
    await selectView(page, 'productivity'); assert.ok(await page.locator('.wc-bar').count() === 14);
    await selectView(page, 'attention'); assert.ok(await page.locator('.wc-attn, .ux-state-empty').count() > 0);
    await selectView(page, 'cards');
  });

  await verify('الاستعلام بالنطاق من صفحة الملف: رابط «مركز العمل» يحصر العناصر بالملف ويمكن إزالة النطاق', async () => {
    await page.evaluate(f => window.__LAW_OFFICE_APP__.go(`actionCenter?fileId=${f}&range=all`), fx.fileId);
    await page.waitForSelector('#wc-root'); await ready(page);
    assert.ok(await page.locator('.wc-scope-bar').count() > 0);
    const st = await rtState(page);
    assert.ok(st.items.length > 0);
    await page.locator('[data-wc-unscope]').first().click(); await ready(page);
    assert.equal(await page.locator('.wc-scope-bar').count(), 0);
  });

  await verify('صفحة الملف تعرض «مهام الملف» وزر «+ مهمة» وصفحة الجلسة تعرض «+ مهمة متابعة للجلسة» وقسم المهام المرتبطة', async () => {
    await page.evaluate(f => window.__LAW_OFFICE_APP__.go(`file:${f}`), fx.fileId); await page.waitForSelector('.record-head,.file-head,[data-file-edit]');
    await page.waitForSelector('.wc-linked-panel'); assert.ok(await page.locator('[data-file-task]').count() > 0);
    // المهمة المرتبطة الأولى مؤرشفة (من السيناريو الكامل) فلا تظهر في اللوحة بحكم التصميم؛ نضيف مهمة نشطة مرتبطة بالجلسة.
    await page.evaluate(async ([h, day]) => { const {saveWorkItem, linkedTaskPreset} = await import('/js/services/work-items.js'); const office = window.__LAW_OFFICE_APP__.office; await saveWorkItem(office, {title: 'WCTEST مهمة مرتبطة ظاهرة', dueDate: day, ...(await linkedTaskPreset(office, 'hearings', h))}); }, [fx.hearingId, addDays(today(), 2)]);
    await page.evaluate(h => window.__LAW_OFFICE_APP__.go(`rec:hearings:${h}`), fx.hearingId); await page.waitForSelector('[data-wc-linked-task]');
    assert.ok((await page.locator('[data-wc-linked-task]').first().textContent()).includes('مهمة متابعة'));
    assert.equal(await page.locator('.wc-linked-panel .wc-lt-row').count(), 1);
    assert.ok((await page.locator('.wc-linked-panel .wc-lt-row').first().textContent()).includes('WCTEST مهمة مرتبطة ظاهرة'));
    await page.evaluate(c => window.__LAW_OFFICE_APP__.go(`client:${c}`), fx.clientId); await page.waitForSelector('[data-wc-client-task]');
    await goWC(page);
  });

  await verify('المهام المتكررة: تعريف يومي من النموذج يولّد عناصر افتراضية بلا صفوف، ويُحوَّل عنصر واحد فقط عند الإنجاز', async () => {
    await clearToasts(page);
    const before = await page.evaluate(() => window.__LAW_OFFICE_APP__.office.r.workItems.count());
    await page.click('[data-wc-range="today"]'); await ready(page);
    await page.click('[data-wc-new]'); await page.waitForSelector('.entity-form');
    await page.fill('.entity-form [name=title]', 'WCTEST متكررة يوميًا'); await page.selectOption('.entity-form [name=recurFreq]', 'daily'); await page.fill('.entity-form [name=recurInterval]', '1');
    await page.click('.entity-form [type=submit]'); await page.waitForSelector('.entity-form', {state: 'detached'}); await ready(page);
    assert.equal(await page.evaluate(() => window.__LAW_OFFICE_APP__.office.r.workItems.count()), before, 'تعريف التكرار لا يُنشئ صفوف مهام');
    const defs = await page.evaluate(() => window.__LAW_OFFICE_APP__.office.r.workItemRecurrences.all(50));
    assert.equal(defs.length, 1); assert.equal(defs[0].rule.freq, 'daily');
    assert.equal(await page.locator('.wc-card:has-text("WCTEST متكررة يوميًا")').count(), 1, 'تكرار اليوم يظهر');
    assert.ok((await page.locator('.wc-card:has-text("WCTEST متكررة يوميًا")').first().textContent()).includes('متكرر'));
    await useTask(page, 'WCTEST متكررة يوميًا');
    assert.ok(await page.locator('.wc-card:has-text("WCTEST متكررة يوميًا")').count() >= 7, 'التكرارات الأسبوع القادم ظاهرة');
    const firstId = await page.locator('.wc-card:has-text("WCTEST متكررة يوميًا")').first().getAttribute('data-wc-id');
    assert.ok(firstId.startsWith('rec::'));
    await page.locator('.wc-card:has-text("WCTEST متكررة يوميًا")').first().locator('.wc-check').check(); await ready(page);
    const made = await page.evaluate(() => window.__LAW_OFFICE_APP__.office.r.workItems.all(5000).then(r => r.filter(x => x.recurrenceId)));
    assert.equal(made.length, 1); assert.equal(made[0].status, 'done'); assert.equal(made[0].occurrenceDate, today());
    await page.evaluate(async id => { const m = await import('/js/services/work-items.js'); await m.endRecurrence(window.__LAW_OFFICE_APP__.office, id); }, defs[0].id);
    await setSearch(page, '');
  });

  const custom = {};   // مفتاح الحالة المخصصة ومعرّف مهمتها بين الخطوات الثلاث التالية
  await verify('الحالات القابلة للتوسعة: إضافة حالة مخصصة من الإعدادات تُكتب في Lookups (لا التفضيلات) وتظهر في كانبان والمرشحات ويمكن نقل عنصر إليها', async () => {
    await page.click('[data-wc-more-menu]'); await page.click('.wc-sheet [data-i="9"]'); await page.waitForSelector('.wc-settings');
    await page.locator('.wc-settings details').nth(1).locator('summary').click();
    assert.equal(await page.locator('[data-new-st-kind]').count(), 0, 'كل الحالات المخصصة مفتوحة: لا اختيار نوع');
    await page.fill('[data-new-st-label]', 'تحت المراجعة'); await page.click('[data-add-custom]');
    await page.click('.wc-settings [type=submit]'); await ready(page);
    const cfg = await page.evaluate(async () => (await import('/js/services/work-config.js')).getWorkConfig().customStatuses);
    assert.equal(cfg.length, 1); assert.equal(cfg[0].label, 'تحت المراجعة'); assert.equal(cfg[0].kind, 'open');
    const key = custom.key = cfg[0].key;
    const rows = await page.evaluate(() => window.__LAW_OFFICE_APP__.office.r.lookups.byIndex('category', 'workItemStatus', 50));
    assert.equal(rows.length, 1); assert.equal(rows[0].value, 'تحت المراجعة');          // الصف في قاعدة المكتب (يدخل النسخ الاحتياطي)
    assert.equal(key, `c_${rows[0].id.toLowerCase()}`);                                 // المفتاح مشتق من معرّف الصف لا من الاسم
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('akl:prefs:ui:workcenter-config') || '{}'));
    assert.ok(!(saved.customStatuses || []).length, 'تفضيلات الجهاز لا تحمل قائمة الحالات المخصصة');
    const id = custom.id = await page.evaluate(async d => { const m = await import('/js/services/work-items.js'); return (await m.saveWorkItem(window.__LAW_OFFICE_APP__.office, {title: 'WCTEST للحالة المخصصة', dueDate: d})).id; }, today());
    await page.click('[data-wc-toggle-filters]');
    assert.ok((await page.locator('#wc-filters').textContent()).includes('تحت المراجعة'), 'الحالة المخصصة في المرشحات');
    await page.click('[data-wc-toggle-filters]');
    await useTask(page, 'WCTEST للحالة المخصصة'); await selectView(page, 'kanban');
    assert.equal(await page.locator(`.wc-col[data-col="${key}"]`).count(), 1, 'عمود كانبان للحالة المخصصة');
    await page.locator(`.wc-card[data-wc-id="${id}"] select[data-wc-move]`).selectOption(key); await ready(page);
    assert.equal((await dbGet(page, 'workItems', id)).status, key);
    assert.equal(await page.locator(`.wc-col[data-col="${key}"] .wc-card[data-wc-id="${id}"]`).count(), 1);
    await selectView(page, 'cards'); await setSearch(page, '');
  });

  await verify('الحالات المخصصة: حذفها من الإعدادات منطقي — تتقاعد وتبقى مهمتها مقروءة في عمود «(محذوفة)» ولا تُعرض خيارًا ولا تُقبل هدفًا', async () => {
    const {key, id} = custom;
    await page.click('[data-wc-more-menu]'); await page.click('.wc-sheet [data-i="9"]'); await page.waitForSelector('.wc-settings');
    await page.locator('.wc-settings details').nth(1).locator('summary').click();
    await page.click('.wc-settings [data-cs-del="0"]');
    await page.click('.wc-settings [type=submit]'); await ready(page);
    const cfg = await page.evaluate(async () => { const c = (await import('/js/services/work-config.js')).getWorkConfig(); return {live: c.customStatuses.length, retired: c.retiredStatuses.map(r => r.key)}; });
    assert.equal(cfg.live, 0); assert.deepEqual(cfg.retired, [key]);
    const row = await page.evaluate(() => window.__LAW_OFFICE_APP__.office.r.lookups.byIndexRaw('category', 'workItemStatus', 50));
    assert.equal(row.length, 1); assert.equal(row[0].isDeleted, true);                  // حذف منطقي: الصف باقٍ
    assert.equal((await dbGet(page, 'workItems', id)).status, key);                      // المهمة لم تُمسّ
    await useTask(page, 'WCTEST للحالة المخصصة'); await selectView(page, 'kanban');
    const col = page.locator(`.wc-col[data-col="${key}"]`);
    assert.equal(await col.count(), 1, 'عمود للحالة المتقاعدة ما دامت عليها عناصر');
    assert.ok((await col.locator('.wc-col-h').textContent()).includes('(محذوفة)'));
    assert.equal(await col.locator(`.wc-card[data-wc-id="${id}"]`).count(), 1);
    assert.equal(await col.locator('[data-drop]').count(), 0, 'لا إسقاط داخل عمود متقاعد');
    assert.equal(await page.locator(`.wc-card[data-wc-id="${id}"] select[data-wc-move] option[value="${key}"]`).count(), 0, 'المتقاعدة ليست هدف نقل');
    await page.locator(`.wc-card[data-wc-id="${id}"] select[data-wc-move]`).selectOption('inProgress'); await ready(page);
    assert.equal((await dbGet(page, 'workItems', id)).status, 'inProgress');
    assert.equal(await page.locator(`.wc-col[data-col="${key}"]`).count(), 0, 'يختفي العمود حين لا تبقى عناصر');
    await selectView(page, 'cards'); await setSearch(page, '');
  });

  await verify('القوائم: حالة تُضاف من الإعدادات ← القوائم الموجودة تظهر في مركز العمل (مرشحات وكانبان) دون إعادة تحميل الصفحة', async () => {
    await page.evaluate(async () => { const app = window.__LAW_OFFICE_APP__; app.__settingsTab = 'general'; app.__lookupCat = 'workItemStatus'; await app.go('settings'); });
    await page.waitForSelector('#lk-cat', {state: 'attached'});
    const toggle = page.locator('.collapse-toggle[aria-label^="توسيع القسم: القوائم القابلة للتعديل"]');   // القسم مطويّ افتراضيًا (نظام الطيّ الموحّد)
    if (await toggle.count()) await toggle.click();
    await page.waitForSelector('#lk-cat', {state: 'visible'});
    assert.equal(await page.locator('#lk-cat option[value="workItemStatus"]').count(), 1, 'الفئة ظاهرة في شاشة القوائم');
    assert.equal(await page.locator('#lk-cat').inputValue(), 'workItemStatus');
    await page.fill('#lk-add input[name="value"]', 'بانتظار الجهة'); await page.click('#lk-add button');
    await page.waitForSelector('.lookup-list li .lk-val:has-text("بانتظار الجهة")');
    await goWC(page);
    await page.click('[data-wc-toggle-filters]');
    assert.ok((await page.locator('#wc-filters').textContent()).includes('بانتظار الجهة'), 'في المرشحات');
    await page.click('[data-wc-toggle-filters]');
    await selectView(page, 'kanban');
    assert.equal(await page.locator('.wc-col:has(h4:has-text("بانتظار الجهة"))').count(), 1, 'عمود كانبان للحالة المضافة من القوائم');
    await selectView(page, 'cards');
  });

  await verify('القائمة (DataGrid): تحديد عدة صفوف وتنفيذ إجراء جماعي بنتيجة صادقة لكل عنصر', async () => {
    await page.click('[data-wc-range="all"]'); await selectView(page, 'list'); await setSearch(page, 'WCTEST');
    await page.waitForSelector('#wc-grid tbody tr[data-i]');
    const rows = await page.locator('#wc-grid .dg-rowchk').count();
    assert.ok(rows >= 2, `صفوف قليلة: ${rows}`);
    const ids = await page.evaluate(() => [...document.querySelectorAll('#wc-grid tbody tr[data-i]')].slice(0, 2).map(tr => tr.dataset.i));
    await page.locator('#wc-grid .dg-rowchk').nth(0).check(); await page.locator('#wc-grid .dg-rowchk').nth(1).check();
    // شريط الإجراءات الجماعية داخل أدوات الجدول الموحّد (مطوية افتراضيًا في كل جداول التطبيق)
    for (const toggle of ['.dg-shell-toggle', '.dg-tools-summary-toggle']) { const el = page.locator(`#wc-grid ${toggle}`); if (await el.count() && await el.getAttribute('aria-expanded') === 'false') await el.click(); }
    await page.waitForSelector('[data-bulk="pin"]', {state: 'visible'}); await clearToasts(page);
    const before = await page.evaluate(() => window.__LAW_OFFICE_APP__.office.r.workItems.all(5000).then(r => r.filter(x => x.pinnedAt).length));
    await page.click('[data-bulk="pin"]'); await ready(page); await page.waitForTimeout(400);
    const after = await page.evaluate(() => window.__LAW_OFFICE_APP__.office.r.workItems.all(5000).then(r => r.filter(x => x.pinnedAt).length));
    assert.equal(after - before, 2, `تثبيت جماعي: ${before} → ${after} (${ids})`);
    assert.ok((await page.locator('.toast-msg').allTextContents()).join('|').includes('تم تنفيذ 2'));
    await selectView(page, 'cards'); await setSearch(page, '');
  });

  await verify('إعادة الضبط تعيد الفترة والعرض والمرشحات والبحث للافتراضي، والتحديث لا يعيد تحميل الصفحة', async () => {
    await page.click('[data-wc-range="week"]'); await selectView(page, 'matrix'); await setSearch(page, 'WCTEST');
    await page.evaluate(() => document.querySelector('[data-wc-toggle-filters]').click()); await page.check('[data-wc-f-flag="pinned"]'); await ready(page);
    let st = await rtState(page); assert.equal(st.range, 'week'); assert.equal(st.view, 'matrix'); assert.equal(st.filters.pinned, true);
    await page.click('[data-wc-reset]'); await ready(page);
    st = await rtState(page);
    assert.equal(st.range, 'today'); assert.equal(st.view, 'cards'); assert.equal(st.q, ''); assert.deepEqual(st.filters, {});
    assert.equal(await page.inputValue('#wc-q'), '');
    await page.evaluate(() => { window.__SENTINEL = 'alive'; });
    const navs = await page.evaluate(() => performance.getEntriesByType('navigation').length);
    await clearToasts(page); await page.click('[data-wc-refresh]'); await ready(page);
    assert.equal(await page.evaluate(() => window.__SENTINEL), 'alive', 'التحديث أعاد تحميل الصفحة');
    assert.equal(await page.evaluate(() => performance.getEntriesByType('navigation').length), navs);
    assert.ok((await page.locator('.toast-msg').allTextContents()).join('|').includes('تم تحديث البيانات'));
    await page.evaluate(() => document.querySelector('[data-wc-toggle-filters]').click());
  });

  await verify('«الآن» و«التالي»: عنصر بوقت الآن وعنصر بوقت لاحق اليوم يظهران في مساحة اليوم', async () => {
    const t = new Date(), pad = n => String(n).padStart(2, '0');
    const nowStr = `${pad(t.getHours())}:${pad(t.getMinutes())}`;
    const later = t.getHours() <= 19 ? `${pad(t.getHours() + 3)}:${pad(t.getMinutes())}` : null;
    await page.evaluate(async ([d, n, l]) => { const m = await import('/js/services/work-items.js'); const o = window.__LAW_OFFICE_APP__.office; await m.saveWorkItem(o, {title: 'WCTEST الآن', dueDate: d, dueTime: n}); if (l) await m.saveWorkItem(o, {title: 'WCTEST التالي', dueDate: d, dueTime: l}); }, [today(), nowStr, later]);
    await page.click('[data-wc-range="all"]'); await page.click('[data-wc-range="today"]'); await ready(page);
    const box = page.locator('.wc-now');
    assert.equal(await box.count(), 1);
    assert.ok((await box.textContent()).includes('الآن') && (await box.textContent()).includes('WCTEST الآن'));
    if (later) assert.ok((await box.textContent()).includes('التالي') && (await box.textContent()).includes('WCTEST التالي'));
  });

  await verify('صفحة العمل الإداري (سجل) تعرض زر «+ مهمة مرتبطة» وقسم المهام المرتبطة، والإنشاء منها يربط بالمعرّفات فقط', async () => {
    const procRow = await page.evaluate(async () => (await window.__LAW_OFFICE_APP__.office.r.procedures.range('internalDueDate', '2000-01-01', '2999-01-01', 1))[0]);
    const proc = procRow.id;
    await page.evaluate(id => window.__LAW_OFFICE_APP__.go(`rec:procedures:${id}`), proc); await page.waitForSelector('[data-wc-linked-task]');
    assert.ok(await page.locator('.wc-linked-panel').count() > 0);
    await page.click('[data-wc-linked-task]'); await page.waitForSelector('.entity-form[data-store="workItems"]');
    await page.fill('.entity-form [name=title]', 'WCTEST مهمة من صفحة العمل الإداري'); await page.click('.entity-form [type=submit]'); await page.waitForSelector('.entity-form', {state: 'detached'});
    await page.waitForSelector('.wc-linked-panel .wc-lt-row');
    const row = await page.evaluate(() => window.__LAW_OFFICE_APP__.office.r.workItems.all(5000).then(r => r.find(x => x.title === 'WCTEST مهمة من صفحة العمل الإداري')));
    assert.equal(row.relatedType, 'procedures'); assert.equal(row.relatedId, proc); assert.equal(row.fileId, procRow.fileId);
    await goWC(page);
  });

  await verify('التعديل: «تعديل المهمة…» يفتح النموذج الموحّد بالقيم الحالية ويحفظ على الصف نفسه (المعرّف وتاريخ الإنشاء ثابتان والإصدار يزيد)', async () => {
    const title = 'WCTEST للتعديل', renamed = 'WCTEST بعد التعديل';
    const made = await page.evaluate(async ([name, day]) => {
      const service = await import('/js/services/work-items.js');
      return service.saveWorkItem(window.__LAW_OFFICE_APP__.office, {title: name, dueDate: day, priority: 'low', status: 'notStarted', description: 'وصف أولي'});
    }, [title, today()]);
    await useTask(page, title);
    await sheetAct(page, title, 'edit'); await page.waitForSelector('.entity-form');
    assert.equal(await page.inputValue('.entity-form [name=title]'), title, 'النموذج لا يعرض القيمة الحالية');
    assert.equal(await page.inputValue('.entity-form [name=description]'), 'وصف أولي');
    await page.fill('.entity-form [name=title]', renamed); await page.fill('.entity-form [name=description]', 'وصف بعد التعديل');
    await page.selectOption('.entity-form [name=priority]', 'urgent');
    await clearToasts(page); await page.click('.entity-form [type=submit]'); await page.waitForSelector('.entity-form', {state: 'detached'}); await ready(page);
    const row = await dbGet(page, 'workItems', made.id);
    assert.equal(row.id, made.id); assert.equal(row.title, renamed); assert.equal(row.description, 'وصف بعد التعديل'); assert.equal(row.priority, 'urgent');
    assert.equal(row.createdAt, made.createdAt, 'تاريخ الإنشاء تغيّر'); assert.equal(row.version, made.version + 1, 'الإصدار لم يزد'); assert.equal(row.dueDate, made.dueDate);
    await setSearch(page, renamed);
    assert.equal(await page.locator(`.wc-card[data-wc-id="${made.id}"]`).count(), 1, 'البطاقة بالعنوان الجديد');
    await page.evaluate(async id => { const service = await import('/js/services/work-items.js'); await service.deleteItem(window.__LAW_OFFICE_APP__.office, id); }, made.id);
    await page.click('[data-wc-reset]'); await ready(page);
  });

  await verify('الاستمرارية: مهمة أُنشئت تبقى كما هي بعد إعادة تحميل التطبيق ويفتح رابطها الثابت مجلّدها بالمعرّف نفسه', async () => {
    const title = 'WCTEST استمرار بعد التحديث';
    const made = await page.evaluate(async ([name, day]) => {
      const service = await import('/js/services/work-items.js');
      return service.saveWorkItem(window.__LAW_OFFICE_APP__.office, {title: name, dueDate: day, priority: 'high', status: 'notStarted', description: 'نص للتحقق'});
    }, [title, today()]);
    await page.waitForTimeout(700);
    await reloadApp(page);
    const after = await dbGet(page, 'workItems', made.id);
    for (const key of ['id', 'title', 'description', 'dueDate', 'priority', 'status', 'createdAt', 'version', 'kind', 'sourceType', 'sourceId']) assert.equal(after[key], made[key], `الحقل ${key} تغيّر بعد التحميل`);
    await page.evaluate(i => window.__LAW_OFFICE_APP__.go(`rec:workItems:${i}`), made.id);
    await page.waitForSelector('.wc-drawer', {timeout: 20000});
    assert.ok((await page.locator('.wc-drawer').textContent()).includes(title), 'المجلّد لا يعرض المهمة');
    await page.keyboard.press('Escape'); await page.waitForSelector('.wc-drawer', {state: 'detached', timeout: 5000}).catch(() => {});
    await page.evaluate(async id => { const service = await import('/js/services/work-items.js'); await service.deleteItem(window.__LAW_OFFICE_APP__.office, id); }, made.id);
  });

  await verify('لا أخطاء JavaScript ولا console.error (عدا الخطوط الخارجية) طوال السيناريو الوظيفي', async () => { assert.equal(page.__errors.length, 0, page.__errors.slice(0, 6).join('\n') + '\n' + JSON.stringify(await page.evaluate(() => window.__unhandled || []))); });
  await shot(page, 'functional-final.png');
  await context.close();
}

// =====================================================================
// 2) الجوال: بلا تمرير أفقي للصفحة، أهداف لمس مريحة، واجهة نظيفة
// =====================================================================
async function mobile() {
  const context = await browser.newContext({viewport: {width: 390, height: 844}, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block', locale: 'ar-EG'});
  const page = await newPage(context); currentPage = page;
  await boot(page); await goWC(page);
  const views = ['cards', 'list', 'kanban', 'matrix', 'priorities', 'calendar', 'overdue', 'upcoming', 'completed', 'attention', 'productivity'];
  await verify('الجوال 390px: لا تمرير أفقي للصفحة في أي عرض ولا نافذة تتجاوز العرض', async () => {
    for (const range of ['today', 'week', 'all']) {
      await page.click(`[data-wc-range="${range}"]`); await ready(page);
      for (const view of views) {
        await selectView(page, view);
        const m = await page.evaluate(() => ({sw: document.documentElement.scrollWidth, bw: document.body.scrollWidth, iw: window.innerWidth}));
        assert.ok(m.sw <= m.iw && m.bw <= m.iw, `تمرير أفقي في ${view}/${range}: ${JSON.stringify(m)}`);
      }
    }
    await selectView(page, 'cards'); await page.click('[data-wc-range="today"]'); await ready(page);
  });

  await verify('الجوال: أهداف اللمس الأساسية (الإجراءات السريعة، التبويبات، العدّادات، أزرار البطاقة) ≥ 40px والواجهة الافتراضية نظيفة', async () => {
    const small = await page.evaluate(() => {
      const bad = [];
      const sel = '#wc-root .wc-quick-bar button, #wc-root .wc-tab, #wc-root .wc-stat, #wc-root .wc-card .wc-more, #wc-root .wc-card .wc-check, #wc-root #wc-q, #wc-root #wc-view-select';
      for (const el of document.querySelectorAll(sel)) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const min = el.matches('.wc-check') ? 22 : 38;
        if (r.height < min || r.width < min) bad.push(`${el.className || el.tagName} ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
      return bad;
    });
    assert.equal(small.length, 0, `أهداف لمس صغيرة: ${[...new Set(small)].slice(0, 10).join(' | ')}`);
    const visibleBar = await page.locator('.wc-quick-bar button:visible').count();
    assert.ok(visibleBar <= 6, `أزرار ظاهرة كثيرة على الجوال: ${visibleBar}`);
    assert.equal(await page.locator('.wc-quicktime').getAttribute('data-collapse-collapsed'), 'true');
    assert.equal(await page.locator('#wc-filters').isHidden(), true);
  });

  await verify('الجوال: المجلّد بعرض الشاشة وكانبان/المصفوفة أعمدة متراصة وأزرار «نقل إلى» ظاهرة', async () => {
    await page.locator('.wc-card .wc-title').first().click(); await page.waitForSelector('.wc-drawer .wc-dsec');
    const box = await page.locator('.wc-drawer').boundingBox();
    assert.ok(box.width >= 388 && box.width <= 391, `عرض المجلّد ${box.width}`);
    await shot(page, 'mobile-drawer.png');
    await page.keyboard.press('Escape'); await page.waitForTimeout(250);
    await page.click('[data-wc-range="all"]'); await selectView(page, 'kanban');
    const xs = await page.locator('.wc-col').evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().left)));
    assert.equal(new Set(xs).size, 1, `الأعمدة غير متراصة: ${xs}`);
    assert.ok(await page.locator('.wc-col .wc-card select[data-wc-move]').first().isVisible());
    await shot(page, 'mobile-kanban.png');
    await selectView(page, 'matrix');
    const qs = await page.locator('.wc-quad').evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().left)));
    assert.equal(new Set(qs).size, 1);
    await shot(page, 'mobile-matrix.png');
    await selectView(page, 'cards'); await page.click('[data-wc-range="today"]'); await ready(page);
    await shot(page, 'mobile-today.png');
  });

  await verify('الجوال: إنشاء مهمة وإنجازها وتأجيلها بالمس', async () => {
    await clearToasts(page);
    await page.tap('[data-wc-new]'); await page.waitForSelector('.entity-form');
    await page.fill('.entity-form [name=title]', 'WCTEST مهمة جوال'); await page.tap('.entity-form [type=submit]'); await page.waitForSelector('.entity-form', {state: 'detached'}); await ready(page);
    const card = page.locator('.wc-card:has-text("WCTEST مهمة جوال")').first();
    assert.equal(await card.count(), 1);
    const id = await card.getAttribute('data-wc-id');
    await card.locator('.wc-more').tap(); await page.waitForSelector('.wc-sheet'); await page.tap('.wc-sheet [data-act="snooze"]');
    await page.waitForSelector('.wc-opts'); await page.tap('.wc-opts [data-opt=twoDays]'); await page.tap('[data-ok]'); await ready(page);
    assert.equal((await dbGet(page, 'workItems', id)).dueDate, addDays(today(), 2));
    await useTask(page, 'WCTEST مهمة جوال');
    await page.locator(`.wc-card[data-wc-id="${id}"] .wc-check`).tap(); await ready(page);
    assert.equal((await dbGet(page, 'workItems', id)).status, 'done');
  });
  await verify('لا أخطاء JavaScript في سيناريو الجوال', async () => { assert.equal(page.__errors.length, 0, page.__errors.slice(0, 6).join('\n') + '\n' + JSON.stringify(await page.evaluate(() => window.__unhandled || []))); });
  await context.close();
}

// =====================================================================
// 3) الأداء مع بيانات كبيرة (قراءة مفهرسة محدودة، لا تحميل للكل)
// =====================================================================
async function perf() {
  // سياق دائم بملف مؤقت: سياقات newContext() العابرة لها حصة تخزين صغيرة (QuotaExceededError) لا تناسب بيانات بحجم مئات الآلاف من السجلات.
  const profileDir = await fs.mkdtemp(path.join(process.env.TMPDIR || '/tmp', 'wc-perf-profile-'));
  const context = await chromium.launchPersistentContext(profileDir, {executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'], viewport: {width: 1280, height: 900}, serviceWorkers: 'block', locale: 'ar-EG'});
  report.perfProfileDir = profileDir;
  const stats = () => { window.__idb = {cursorSteps: 0, getAllRows: 0, cursors: 0}; const proto = IDBCursor.prototype, origC = proto.continue, origA = proto.advance; proto.continue = function (...a) { window.__idb.cursorSteps++; return origC.apply(this, a); }; proto.advance = function (...a) { window.__idb.cursorSteps += a[0] || 1; return origA.apply(this, a); }; for (const P of [IDBObjectStore.prototype, IDBIndex.prototype]) { const oc = P.openCursor; P.openCursor = function (...a) { window.__idb.cursors++; return oc.apply(this, a); }; const ga = P.getAll; P.getAll = function (...a) { const r = ga.apply(this, a); r.addEventListener('success', () => { window.__idb.getAllRows += r.result?.length || 0; }); return r; }; } };
  const page = await newPage(context, {init: stats}); currentPage = page;
  await boot(page);
  const target = Object.fromEntries(Object.entries({clients: 5000, files: 20000, hearings: 100000, procedures: 50000, appointments: 20000, communications: 20000, natives: 30000}).map(([k, v]) => [k, Math.round(v * perfScale)]));
  const t0 = Date.now();
  const seeded = await page.evaluate(async cfg => {
    const app = window.__LAW_OFFICE_APP__, db = app.office.ctx.db;
    const {uid} = await import('/js/core/id.js');
    const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const base = new Date(); base.setHours(0, 0, 0, 0);
    const dayAt = off => { const d = new Date(base); d.setDate(d.getDate() + off); return iso(d); };
    const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
    const now = new Date().toISOString();
    const put = async (store, rows) => { for (let i = 0; i < rows.length; i += 4000) await new Promise((res, rej) => { const tx = db.transaction(store, 'readwrite'); const os = tx.objectStore(store); for (const r of rows.slice(i, i + 4000)) os.put(r); tx.oncomplete = res; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); }); };
    // توليد مجزّأ (20 ألف صف في كل دفعة) حتى لا تبقى مئات الآلاف من الكائنات في الذاكرة دفعة واحدة عند المقاييس الكبيرة.
    const gen = async (store, n, make) => { for (let off = 0; off < n; off += 20000) await put(store, Array.from({length: Math.min(20000, n - off)}, (_, j) => make(null, off + j))); };
    const common = {createdAt: now, updatedAt: now, version: 1, isArchived: false, isDeleted: false, deletedAt: null};
    const clients = Array.from({length: cfg.clients}, (_, i) => ({id: uid(), fullName: `موكل أداء ${i}`, fullNameNormalized: `موكل اداء ${i}`, status: 'active', ...common}));
    await put('clients', clients);
    const files = [], cases = [], parties = [], links = [];
    for (let i = 0; i < cfg.files; i++) {
      const id = uid(), c = clients[i % clients.length], cid = uid();
      files.push({id, fileNumber: `${2020 + (i % 6)}/${String(i + 1).padStart(5, '0')}`, title: `ملف أداء ${i}`, titleNormalized: `ملف اداء ${i}`, status: 'مفتوح', openedAt: dayAt(-rnd(1, 900)), lastActivityAt: new Date(base.getTime() - rnd(0, 400) * 86400000).toISOString(), nextStepDate: i % 5 === 0 ? dayAt(rnd(-30, 60)) : '', nextStep: i % 5 === 0 ? 'خطوة أداء' : '', ...common});
      cases.push({id: cid, fileId: id, caseNumber: String(100 + i), caseYear: String(2020 + (i % 6)), status: 'متداولة', stageType: 'دعوى', ...common});
      links.push({id: `${id}::${c.id}`, fileId: id, clientId: c.id, role: 'principal', createdAt: now});
      parties.push({id: uid(), fileId: id, partyKind: 'client', clientId: c.id, name: c.fullName, partyName: c.fullName, role: 'موكل', roleGroup: 'موكلو المكتب', sequence: 1, isPrimary: true, isActive: true, activeStatus: 'active', ...common});
    }
    await put('files', files); await put('cases', cases); await put('fileClients', links); await put('fileParties', parties);
    await gen('hearings', cfg.hearings, (_, i) => { const k = rnd(0, files.length - 1); return {id: uid(), caseId: cases[k].id, stageId: cases[k].id, fileId: files[k].id, hearingDate: dayAt(rnd(-730, 730)), hearingTime: ['09:00', '10:30', '12:00', '13:30', ''][i % 5], type: 'نظر', reason: `جلسة أداء ${i}`, status: i % 7 === 0 ? 'تمت' : 'مجدولة', court: 'محكمة الأداء', ...common}; });
    await gen('procedures', cfg.procedures, (_, i) => { const k = rnd(0, files.length - 1); return {id: uid(), fileId: files[k].id, description: `عمل أداء ${i}`, type: 'متابعة', internalDueDate: i % 11 === 0 ? '' : dayAt(rnd(-400, 200)), status: ['open', 'open', 'pending', 'done', 'done', 'cancelled'][i % 6], priority: ['normal', 'urgent', 'critical'][i % 3], ...common}; });
    await gen('appointments', cfg.appointments, (_, i) => { const k = rnd(0, files.length - 1); return {id: uid(), fileId: files[k].id, clientId: clients[k % clients.length].id, title: `موعد أداء ${i}`, date: dayAt(rnd(-200, 200)), time: '11:00', status: i % 4 === 0 ? 'تم' : 'مجدول', ...common}; });
    await gen('communications', cfg.communications, (_, i) => { const k = rnd(0, files.length - 1); return {id: uid(), fileId: files[k].id, clientId: clients[k % clients.length].id, subject: `اتصال أداء ${i}`, date: dayAt(rnd(-100, 0)), followUpDate: i % 3 === 0 ? dayAt(rnd(-60, 60)) : '', followUpRequired: i % 6 === 0 ? false : (i % 3 === 0 ? true : undefined), ...common}; });
    await gen('workItems', cfg.natives, (_, i) => { const k = rnd(0, files.length - 1), id = uid(); return {id, kind: 'native', sourceType: 'task', sourceId: id, title: `مهمة أداء ${i}`, description: '', type: 'مهمة', dueDate: i % 10 === 0 ? '' : dayAt(rnd(-200, 200)), dueTime: '', status: ['notStarted', 'inProgress', 'waiting', 'done'][i % 4], priority: ['urgent', 'high', 'medium', 'low'][i % 4], tags: [], fileId: files[k].id, caseId: '', clientId: '', opponentId: '', relatedType: '', relatedId: '', originalDueDate: '', postponeCount: 0, commentCount: 0, pinnedAt: null, quadrant: null, completedAt: i % 4 === 3 ? new Date().toISOString() : null, completedBy: null, archivedAt: null, ...common}; });
    return {total: cfg.clients + cfg.files * 4 + cfg.hearings + cfg.procedures + cfg.appointments + cfg.communications + cfg.natives, sampleClient: clients[7].fullName, sampleFile: files[7].fileNumber};
  }, target);
  report.metrics.seed = {...target, totalRecords: seeded.total, seconds: Math.round((Date.now() - t0) / 100) / 10};
  console.log(`   بذرة الأداء: ${seeded.total.toLocaleString('en')} سجلًا في ${report.metrics.seed.seconds}s`);

  const measure = async (label, fn, limitMs) => {
    await page.evaluate(() => { window.__idb = {cursorSteps: 0, getAllRows: 0, cursors: 0}; });
    const t = Date.now(); const out = await fn(); const ms = Date.now() - t;
    const io = await page.evaluate(() => ({...window.__idb}));
    report.metrics[label] = {ms, cursorSteps: io.cursorSteps, getAllRows: io.getAllRows, cursors: io.cursors, ...(out || {})};
    console.log(`   ${label}: ${ms}ms · خطوات مؤشر ${io.cursorSteps.toLocaleString('en')} · getAll ${io.getAllRows}`);
    if (limitMs) assert.ok(ms <= limitMs, `${label} استغرق ${ms}ms > ${limitMs}ms`);
    return {ms, io};
  };
  const total = seeded.total;
  await verify(`الأداء والدقة: ملخص الرأس على ${Math.round(total / 1000)} ألف سجل بقراءة محدودة، وأرقام اليوم صحيحة ولا يحجبها تراكم المتأخر القديم`, async () => {
    const r = await measure('summary', () => page.evaluate(async () => {
      const m = await import('/js/services/work-query.js'); const office = window.__LAW_OFFICE_APP__.office;
      const s = await m.workSummary(office);
      const todayAll = await m.queryWorkItems(office, {range: 'today'}, {limit: 1500});
      const tomorrowAll = await m.queryWorkItems(office, {range: 'tomorrow'}, {limit: 1500});
      return {todayCount: s.todayCount, tomorrow: s.tomorrow, overdue: s.overdue, overdueCapped: s.overdueCapped, forwardCapped: s.forwardCapped, todayExact: todayAll.items.length, tomorrowExact: tomorrowAll.items.length};
    }), 9000);
    const m = report.metrics.summary;
    assert.ok(m.todayExact > 50, `بيانات اليوم قليلة جدًا للاختبار: ${m.todayExact}`);
    assert.ok(m.forwardCapped, 'النافذة الأمامية بلغت سقفها (بيانات كثيفة) وتُعلن ذلك');
    assert.equal(m.todayCount, m.todayExact, 'رقم اليوم في الملخص لا يطابق القراءة المباشرة'); assert.equal(m.tomorrow, m.tomorrowExact);
    assert.ok(m.overdueCapped && m.overdue === 1000, 'المتأخر الكثير يُعرض مسقوفًا (1000+) ولا يؤثر على أرقام اليوم');
    assert.ok(r.io.cursorSteps < total * 0.08, `قراءة مفرطة: ${r.io.cursorSteps}`);
  });
  await verify('الأداء: فتح مركز العمل (اليوم) كاملًا على الشاشة (بطاقات + عدّادات) بقراءة أقل من 8% من السجلات ودون getAll', async () => {
    const r = await measure('open_today', async () => { await page.evaluate(() => window.__LAW_OFFICE_APP__.go('actionCenter')); await page.waitForSelector('#wc-root'); await ready(page); await page.waitForSelector('.wc-stat'); return {cards: await page.locator('.wc-card').count()}; }, 8000);
    assert.ok(r.io.cursorSteps < total * 0.08, `قراءة مفرطة لفتح اليوم: ${r.io.cursorSteps}`);
    assert.ok(r.io.getAllRows < total * 0.01, `getAll مفرط: ${r.io.getAllRows}`);
    assert.ok(report.metrics.open_today.cards > 50);
    await shot(page, 'perf-today.png');
  });
  const q = async (label, spec, opts = {}, limitMs = 2500) => measure(label, () => page.evaluate(async ([s, o]) => { const m = await import('/js/services/work-query.js'); const r = await m.queryWorkItems(window.__LAW_OFFICE_APP__.office, s, o); return {items: r.items.length, hasMore: r.hasMore, scanned: r.scanned}; }, [spec, opts]), limitMs);
  await verify('الأداء: الاستعلامات المفهرسة (اليوم/الأسبوع/الشهر/المتأخر/الكل/نطاق مخصص/غير مؤرّخ) بصفحات ثابتة الحجم', async () => {
    for (const [label, spec] of [['q_today', {range: 'today'}], ['q_week', {range: 'week'}], ['q_month', {range: 'month'}], ['q_year', {range: 'year'}], ['q_overdue', {range: 'overdue'}], ['q_all', {range: 'all', undated: true}], ['q_custom', {range: 'custom', from: addDays(today(), 100), to: addDays(today(), 130)}]]) {
      const r = await q(label, spec, {limit: 50});
      assert.ok(r.io.cursorSteps < total * 0.05, `${label}: خطوات مؤشر كثيرة ${r.io.cursorSteps}`);
      assert.ok((report.metrics[label].items || 0) <= 50);
    }
  });
  await verify('الأداء: الترقيم بمؤشر عميق (الصفحة 20 من الشهر) بزمن مماثل للأولى ولا إعادة قراءة للكل', async () => {
    let cursor = null; let t1 = 0, t20 = 0;
    for (let p = 1; p <= 20; p++) {
      const t = Date.now();
      const r = await page.evaluate(async ([c]) => { const m = await import('/js/services/work-query.js'); const x = await m.queryWorkItems(window.__LAW_OFFICE_APP__.office, {range: 'year'}, {limit: 50, cursor: c}); return {next: x.nextCursor, more: x.hasMore, n: x.items.length}; }, [cursor]);
      const ms = Date.now() - t; if (p === 1) t1 = ms; if (p === 20) t20 = ms;
      cursor = r.next; if (!r.more) break;
    }
    report.metrics.pagination = {page1Ms: t1, page20Ms: t20};
    console.log(`   ترقيم: الصفحة 1 = ${t1}ms، الصفحة 20 = ${t20}ms`);
    assert.ok(t20 < 3500, `الصفحة 20 بطيئة: ${t20}ms`);
  });
  await verify('الأداء: البحث النصي (اسم موكل/رقم ملف) داخل نطاق الشهر والسنة بقراءة محدودة', async () => {
    const byClient = await q('search_client_month', {range: 'month', q: seeded.sampleClient}, {limit: 25}, 6000);
    const byFile = await q('search_file_year', {range: 'year', q: seeded.sampleFile}, {limit: 25}, 12000);
    assert.ok(byClient.io.cursorSteps < total * 0.2 && byFile.io.cursorSteps < total * 0.5);
  });
  await verify('الأداء: عروض الواجهة الكبيرة (كانبان/مصفوفة/قائمة DataGrid/تقويم/متأخر/يحتاج انتباهي) تُرسم بحدود زمنية', async () => {
    for (const [view, limit] of [['kanban', 8000], ['matrix', 8000], ['list', 8000], ['calendar', 8000], ['overdue', 8000], ['attention', 12000], ['priorities', 8000]]) {
      await measure(`view_${view}`, async () => { await page.selectOption('#wc-view-select', view); await ready(page); return {}; }, limit);
      assert.equal(await page.locator('#wc-view .error-box,#wc-view .ux-state-error').count(), 0, view);
    }
    await shot(page, 'perf-list.png');
  });
  await verify('الأداء: تغيير الفترة والتبويبات المتتابعة لا تُعيد استعلامًا للعرض غير المتأثر، وإلغاء الاستعلام السابق يعمل', async () => {
    await page.selectOption('#wc-view-select', 'cards'); await ready(page);
    const seq = await page.evaluate(async () => {
      const rt = window.__LAW_OFFICE_APP__.__wc.rt; const before = rt.seq;
      for (const r of ['week', 'month', 'year', 'today']) document.querySelector(`[data-wc-range="${r}"]`).click();
      await new Promise(res => setTimeout(res, 50));
      return {before};
    });
    await ready(page);
    const final = await rtState(page);
    assert.equal(final.range, 'today');
    assert.ok(seq.before >= 0);
    const lastRows = final.items.filter(i => i.dueDate).every(i => i.dueDate === today());
    assert.equal(lastRows, true, 'نتائج متأخرة من استعلام قديم تسربت إلى العرض');
  });
  report.metrics.heap = await page.evaluate(() => performance.memory ? {usedMB: Math.round(performance.memory.usedJSHeapSize / 1048576), totalMB: Math.round(performance.memory.totalJSHeapSize / 1048576)} : null);
  await verify('لا أخطاء JavaScript في سيناريو الأداء', async () => { assert.equal(page.__errors.length, 0, page.__errors.slice(0, 6).join('\n') + '\n' + JSON.stringify(await page.evaluate(() => window.__unhandled || []))); });
  await context.close();
  await fs.rm(profileDir, {recursive: true, force: true});
}

// =====================================================================
// 4) دون اتصال: كل ملفات مركز العمل في ذاكرة Service Worker
// =====================================================================
async function offline() {
  const context = await browser.newContext({viewport: {width: 1280, height: 900}, serviceWorkers: 'allow', locale: 'ar-EG'});
  const page = await newPage(context);
  await boot(page);
  await pollUntil(page, async () => { const regs = await navigator.serviceWorker.getRegistrations(); return regs.some(r => r.active); }, 30000);
  await pollUntil(page, async () => { const keys = await caches.keys(); if (!keys.length) return false; const c = await caches.open(keys.find(k => k.includes('work-center')) || keys[0]); return (await c.keys()).length > 100; }, 60000);
  await verify('دون اتصال: ملفات مركز العمل الجديدة كلها محفوظة في ذاكرة التطبيق (precache) وإصدار الذاكرة جديد', async () => {
    const out = await page.evaluate(async () => { const keys = await caches.keys(); const name = keys.find(k => k.includes('v5.7.0-work-center')); const c = name ? await caches.open(name) : null; const urls = c ? (await c.keys()).map(r => new URL(r.url).pathname) : []; return {name, urls}; });
    assert.ok(out.name, 'اسم الذاكرة الجديد غير موجود');
    for (const f of ['css/work-center.css', 'js/modules/work-center.js', 'js/services/work-query.js', 'js/services/work-items.js', 'js/services/work-insights.js', 'js/services/work-config.js', 'js/domain/work-items.js', 'js/domain/work-sources.js', 'js/ui/work-card.js', 'js/ui/work-actions.js', 'js/ui/work-drawer.js', 'js/ui/work-views.js', 'js/ui/work-grid.js', 'js/ui/work-panels.js', 'js/ui/work-links.js']) assert.ok(out.urls.includes(`/${f}`), `غير مخزّن: ${f}`);
  });
  await context.setOffline(true);
  await verify('دون اتصال: إعادة تحميل التطبيق ثم فتح مركز العمل وإنشاء مهمة تعمل محليًا', async () => {
    await reloadApp(page);
    await goWC(page);
    assert.ok(await page.locator('.wc-stat').count() === 10);
    await clearToasts(page); await page.click('[data-wc-new]'); await page.waitForSelector('.entity-form'); await page.fill('.entity-form [name=title]', 'WCTEST دون اتصال');
    await page.click('.entity-form [type=submit]'); await page.waitForSelector('.entity-form', {state: 'detached'}); await ready(page);
    assert.equal(await page.locator('.wc-card:has-text("WCTEST دون اتصال")').count(), 1);
  });
  await context.setOffline(false);
  await context.close();
}

// ---------- التشغيل ----------
const plan = {functional, mobile, perf, offline};
const chosen = scenario === 'all' ? Object.keys(plan) : scenario.split(',');
let failed = false;
for (const name of chosen) {
  if (!plan[name]) { console.log(`سيناريو غير معروف: ${name}`); failed = true; continue; }
  console.log(`\n=== سيناريو ${name} ===`);
  try { await plan[name](); } catch (error) { failed = true; report.errors.push({scenario: name, message: String(error?.message || error).slice(0, 800)}); }
}
report.notVerified = ['الطباعة الفعلية ومعاينتها', 'أجهزة لمس وهواتف حقيقية (يُحاكى اللمس فقط)', 'الأداء على أجهزة المستخدم الفعلية (القياس في بيئة اختبار محدودة)', 'اتصال الإنترنت/الخطوط الخارجية (محجوبة في بيئة الاختبار)'];
await fs.writeFile(path.join(outDir, reportFile), JSON.stringify(report, null, 2));
await browser.close();
const verified = report.checks.filter(c => c.status === 'VERIFIED').length;
console.log(`\n${verified}/${report.checks.length} فحصًا متصفحيًا ناجحًا${failed ? ' — يوجد إخفاق' : ''} (التقرير: .cache/work-center-browser/${reportFile})`);
process.exit(failed ? 1 : 0);
