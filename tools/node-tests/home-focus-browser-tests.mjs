// =====================================================================
// فحص متصفح حقيقي لـ«مكتب اليوم» v2: جلسة مُسجَّلة تخرج من الطابور،
// تعارض صريح بوقت متطابق، سطر «لماذا الآن؟»، «منذ آخر زيارة» (بدايتها
// الصفرية، والكتابة عند المغادرة فقط بلا كتابة في سجل النشاط، ومنع التراجع
// عن قيمة أحدث). بيانات موسومة 〔تجريبي〕 وتُحذف في النهاية عبر مسار التطبيق نفسه.
// التشغيل: GRID_BASE_URL=http://127.0.0.1:8080 GRID_BROWSER_EXECUTABLE=/path/chromium node home-focus-browser-tests.mjs
// =====================================================================
import {chromium} from 'playwright';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const base = (process.env.GRID_BASE_URL || 'http://127.0.0.1:8080').replace(/\/$/, '');
const failures = [];
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({name, ok: Boolean(ok), detail});
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures.push(name);
};

let browser;
if (process.env.GRID_BROWSER_EXECUTABLE) {
  browser = await chromium.launch({executablePath: process.env.GRID_BROWSER_EXECUTABLE, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage']});
} else {
  const {default: slim, inflate} = await import('@sparticuz/chromium');
  const require = createRequire(import.meta.url);
  await inflate(path.resolve(path.dirname(require.resolve('@sparticuz/chromium')), '../bin/al2023.tar.br'));
  process.env.LD_LIBRARY_PATH = [path.join(process.env.TMPDIR || '/tmp', 'al2023', 'lib'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');
  browser = await chromium.launch({executablePath: await slim.executablePath(), headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage']});
}
const context = await browser.newContext({viewport: {width: 1280, height: 900}, serviceWorkers: 'block', locale: 'ar'});
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));
const settle = (ms = 450) => page.waitForTimeout(ms);
const app = (fn, arg) => page.evaluate(fn, arg);
const go = async (route, ms = 500) => { await app(r => window.__LAW_OFFICE_APP__.go(r), route); await settle(ms); };

try {
  await page.goto(`${base}/index.html`);
  await page.waitForFunction(() => window.__LAW_OFFICE_APP__ && !window.__LAW_OFFICE_APP__.booting, null, {timeout: 90000});
  await settle(1000);

  // 1) أول تشغيل بلا قيمة سابقة: لا قسم «منذ آخر زيارة»
  check('أول تشغيل: لا يظهر قسم «منذ آخر زيارة»', (await page.locator('.cp-since').count()) === 0);

  // 1b) «المهام» تعرض مهمة مركز العمل نفسها، وتفتح صفها الأصلي دون تكرار سجل النشاط.
  const homeTaskId = await app(async () => {
    const office = window.__LAW_OFFICE_APP__.office;
    const {saveWorkItem} = await import('/js/services/work-items.js');
    const {localDate} = await import('/js/core/clock.js');
    const item = await saveWorkItem(office, {title: '〔تجريبي〕 مهمة رئيسية طويلة لاختبار التفاف العنوان داخل قائمة المهام دون تمرير أفقي على الهاتف', dueDate: localDate()});
    return item.id;
  });
  await go('dashboard', 700);
  const homeTaskRow = page.locator(`.cp-task-main[data-route="rec:workItems:${homeTaskId}"]`);
  check('الرئيسية تستبدل «آخر التحركات» بقسم المهام', (await page.locator('[data-section-id="tasks"]').count()) === 1 && (await page.locator('[data-section-id="activity"]').count()) === 0 && (await page.locator('.cp-activity').count()) === 0);
  check('المهمة المفتوحة من مركز العمل تظهر بموعدها في الرئيسية', (await homeTaskRow.count()) === 1 && /اليوم/.test(await homeTaskRow.textContent()));
  await homeTaskRow.click();
  await page.waitForFunction(id => window.__LAW_OFFICE_APP__?.route === `rec:workItems:${id}`, homeTaskId, {timeout: 15000});
  check('نقرة المهمة تفتح سجلها في مركز العمل', await app(() => window.__LAW_OFFICE_APP__.route) === `rec:workItems:${homeTaskId}`);
  await go('dashboard', 700);

  // 2) مغادرة الرئيسية تكتب وقت الزيارة (تفضيلات فقط) — وبلا أي كتابة في سجل النشاط
  await go('clients');
  const stamp1 = await app(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.includes('ui:home:last-seen'))) || 'null'));
  check('مغادرة الرئيسية تُسجّل lastSeen في التفضيلات', typeof stamp1 === 'string' && !Number.isNaN(Date.parse(stamp1)), String(stamp1));

  const actBefore = await app(async () => (await window.__LAW_OFFICE_APP__.office.r.activityLog.reportRange({index: 'timestamp', lower: '0000-01-01', upper: '\uffff', direction: 'prev', limit: 1000})).length);

  // 3) بيانات تجريبية بعد وقت المغادرة: عميل وملف وقضية وجلسات ومواعيد
  const seed = await app(async () => {
    const office = window.__LAW_OFFICE_APP__.office;
    const clock = await import('/js/core/clock.js');
    const {saveEntity} = await import('/js/services/entity-save.js');
    const today = clock.localDate();
    const client = await office.saveClient({fullName: '〔تجريبي〕 موكل مكتب اليوم', phone: '0500000001'});
    const clientId = client?.id || client;
    const file = await office.createFile({title: '〔تجريبي〕 ملف مكتب اليوم', fileType: 'civil', clientIds: [clientId]}, [clientId]).catch(e => ({error: e.message}));
    const fileId = file?.id;
    if (!fileId) return {error: 'file: ' + (file?.error || 'no id')};
    const kase = await saveEntity(office, 'cases', {fileId, caseNumber: '9901', caseYear: '2026', title: '〔تجريبي〕'}).catch(e => ({error: e.message}));
    const caseId = kase?.id;
    if (!caseId) return {error: 'case: ' + (kase?.error || 'no id')};
    const hDone = await saveEntity(office, 'hearings', {caseId, fileId, hearingDate: today, hearingTime: '09:00', reason: '〔تجريبي〕 جلسة مُسجّلة', result: 'تأجيل للمستندات'});
    const hOpen = await saveEntity(office, 'hearings', {caseId, fileId, hearingDate: today, hearingTime: '11:00', reason: '〔تجريبي〕 جلسة بلا نتيجة'});
    const appt = await saveEntity(office, 'appointments', {title: '〔تجريبي〕 موعد متعارض', date: today, time: '11:00', fileId, clientId});
    return {clientId, fileId, caseId, hDone: hDone?.id, hOpen: hOpen?.id, appt: appt?.id, today};
  });
  check('زرع البيانات التجريبية عبر الخدمات', !seed?.error, JSON.stringify(seed).slice(0, 200));

  const actAfter = await app(async () => (await window.__LAW_OFFICE_APP__.office.r.activityLog.reportRange({index: 'timestamp', lower: '0000-01-01', upper: '\uffff', direction: 'prev', limit: 1000})).length);
  check('المغادرة لم تكتب في سجل النشاط (الزيادة فقط من الزرع نفسه)', actAfter - actBefore > 0 && actAfter - actBefore <= 10, `${actBefore}→${actAfter}`);

  // 4) العودة للرئيسية: قسم «منذ آخر زيارة» يعرض التغييرات بعد المغادرة
  await go('dashboard', 900);
  const since = await app(() => ({count: document.querySelectorAll('.cp-since li').length, head: document.querySelector('.cp-since h2')?.textContent?.trim() || ''}));
  check('منذ آخر زيارة يعرض التغييرات بعد آخر مغادرة', since.count > 0, JSON.stringify(since));

  // 5) الجلسة المُسجَّلة: داخل الجدول بعلامة، خارج الطابور
  const rows = await app(() => ({
    doneMark: document.querySelectorAll('.cp-tl li.is-done').length,
    doneText: document.querySelector('.cp-tl li.is-done')?.textContent?.replace(/\s+/g, ' ').trim() || '',
    queueHasDone: [...document.querySelectorAll('[data-attn-list] .cp-row-main')].some(b => /جلسة مُسجّلة/.test(b.textContent)),
    conflictMarks: document.querySelectorAll('.cp-tl li.is-conflict').length,
    chip: document.querySelector('.cp-day-chips .cp-chip--warn')?.textContent?.trim() || '',
    why: document.querySelector('.cp-focus .cp-why')?.textContent?.replace(/\s+/g, ' ').trim() || '',
    groups: [...document.querySelectorAll('.cp-grp-title')].map(h => h.textContent.replace(/\s+/g, ' ').trim())
  }));
  check('الجلسة المُسجَّلة تظهر في جدول اليوم بعلامة «سُجّلت»', rows.doneMark >= 1 && /سُجّلت/.test(rows.doneText), rows.doneText.slice(0, 80));
  check('الجلسة المُسجَّلة لا تظهر في الطابور', !rows.queueHasDone);
  check('التعارض الصريح يظهر في الجدول وشريحة «تعارض»', rows.conflictMarks >= 2 && /تعارض/.test(rows.chip), `${rows.conflictMarks} · ${rows.chip}`);
  check('سطر «لماذا الآن؟» يظهر في بطاقة الخطوة التالية', /لماذا الآن/.test(rows.why), rows.why.slice(0, 90));
  check('الطابور مقسّم إلى طبقات واضحة', rows.groups.length >= 1, rows.groups.join(' | '));

  // 6) حماية الكتابة: تبويب أحدث لا يُستبدل بقيمة أقدم
  const guard = await app(async () => {
    const key = Object.keys(localStorage).find(k => k.includes('ui:home:last-seen'));
    const future = new Date(Date.now() + 3600e3).toISOString();
    localStorage.setItem(key, JSON.stringify(future));
    const v = await import('/js/services/home-visit.js');
    const scope = window.__LAW_OFFICE_APP__.ctx?.profile?.id || window.__LAW_OFFICE_APP__.office?.ctx?.profile?.id || '';
    const wrote = await v.markHomeSeen(scope, new Date());
    return {wrote, kept: JSON.parse(localStorage.getItem(key)) === future};
  });
  check('تبويب أقدم لا يستبدل قيمة lastSeen أحدث', guard.wrote === false && guard.kept, JSON.stringify(guard));

  // 7) التحديث الموضعي بعد «✓ تم»: بلا إعادة بناء الصفحة، وبـ «تراجع» (Undo) يعمل
  // عزل البيانات: نحذف البيانات التجريبية حتى تكون قائمة الانتباه
  // مستندة على بيانات هذا الفحص فقط
  await app(async () => {
    const office = window.__LAW_OFFICE_APP__.office;
    const {removeDemoData} = await import('/js/services/demo-data.js');
    await removeDemoData(office, {reason: 'عزل بيانات فحص التحديث الموضعي'});
  });
  const posSeed = await app(async fileId => {
    const office = window.__LAW_OFFICE_APP__.office;
    const clock = await import('/js/core/clock.js');
    const {saveEntity} = await import('/js/services/entity-save.js');
    const today = clock.localDate();
    const p = await saveEntity(office, 'procedures', {fileId, type: 'متابعة', description: '〔تجريبي〕 عمل متأخر «تم»', internalDueDate: clock.addDays(today, -1), status: 'open', priority: 'urgent'});
    const next = await saveEntity(office, 'procedures', {fileId, type: 'متابعة', description: '〔تجريبي〕 الخطوة التالية', internalDueDate: clock.addDays(today, -1), status: 'open', priority: 'medium'});
    return {procId: p?.id || '', nextId: next?.id || ''};
  }, seed.fileId);
  check('زرع عمل إداري متأخر عاجل', Boolean(posSeed.procId), JSON.stringify(posSeed).slice(0, 120));

  await go('dashboard', 900);
  await app(() => { const el = document.createElement('div'); el.id = 'pos-sentinel'; el.style.cssText = 'height:1600px;visibility:hidden;pointer-events:none'; document.querySelector('#main-content').append(el); window.scrollTo(0, 420); });
  const before = await app(() => ({
    hook: typeof window.__LAW_OFFICE_APP__.__refreshAfterAction,
    route: window.__LAW_OFFICE_APP__.route,
    focusTitle: document.querySelector('#cp-focus-title')?.textContent?.replace(/\s+/g, ' ').trim() || '',
    attnCount: document.querySelectorAll('[data-attn-list] .cp-row').length,
    attnHas: /عمل متأخر «تم»/.test(document.querySelector('[data-attn-list]')?.textContent || ''),
    scrollY: window.scrollY
  }));
  check('hook التحديث الموضعي مفعَّل في الرئيسية', before.hook === 'function' && before.route === 'dashboard', JSON.stringify(before));
  check('العمل المتأخر العاجل هو «الخطوة التالية»', /عمل متأخر «تم»/.test(before.focusTitle) && before.attnHas, before.focusTitle.slice(0, 80));
  const thenBefore = await page.locator('.cp-focus .cp-then li').count();
  await page.locator('.cp-focus [data-focus-mode]').click();
  const focusModeBefore = await app(() => ({pressed: document.querySelector('.cp-focus [data-focus-mode]')?.getAttribute('aria-pressed') || '', thenCount: document.querySelector('.cp-focus .cp-then')?.querySelectorAll('li').length || 0}));
  check('Focus على نفس البطاقة يعرض عنصرًا واحدًا فقط', thenBefore > 0 && focusModeBefore.pressed === 'true' && focusModeBefore.thenCount === 0, JSON.stringify({thenBefore, ...focusModeBefore}));
  await page.locator('.cp-focus [data-focus-mode]').click();
  check('يمكن الخروج من Focus فورًا بلا تحديث صفحة', (await page.locator('.cp-focus [data-focus-mode]').getAttribute('aria-pressed')) === 'false' && (await page.locator('.cp-focus .cp-then li').count()) > 0);
  await page.locator('.cp-focus [data-focus-mode]').click();
  check('يمكن إعادة Focus فورًا على البطاقة نفسها', (await page.locator('.cp-focus [data-focus-mode]').getAttribute('aria-pressed')) === 'true' && (await page.locator('.cp-focus .cp-then li').count()) === 0);
  await app(() => { document.querySelector('[data-attn-filter="critical"]')?.click(); });
  const filterBefore = await app(() => document.querySelector('.cp-count.is-on')?.dataset.attnFilter || '');
  const scrollBefore = await app(() => { window.scrollTo(0, 420); return window.scrollY; });
  const clickInfo = await app(() => {
    const btn = document.querySelector('.cp-focus [data-complete-proc]');
    if (!btn) return {clicked: false};
    btn.click();
    return {clicked: true};
  });
  check('زر «✓ تم» موجود في بطاقة الخطوة التالية', clickInfo.clicked);
  await page.waitForFunction(() => !/عمل متأخر «تم»/.test(document.querySelector('#cp-focus-title')?.textContent || ''), null, {timeout: 15000}).catch(() => {});
  await settle(600);
  const after = await app(() => ({
    sentinel: Boolean(document.querySelector('#pos-sentinel')),
    sections: {focus: document.querySelectorAll('[data-section-id="focus"]').length, attention: document.querySelectorAll('[data-section-id="attention"]').length, kpis: document.querySelectorAll('[data-section-id="kpis"]').length},
    route: window.__LAW_OFFICE_APP__.route,
    focusTitle: document.querySelector('#cp-focus-title')?.textContent?.replace(/\s+/g, ' ').trim() || '',
    attnCount: document.querySelectorAll('[data-attn-list] .cp-row').length,
    attnHas: /عمل متأخر «تم»/.test(document.querySelector('[data-attn-list]')?.textContent || ''),
    filter: document.querySelector('.cp-count.is-on')?.dataset.attnFilter || '',
    scrollY: window.scrollY,
    undoBtn: [...document.querySelectorAll('.toast .toast-act')].at(-1)?.textContent?.trim() || '',
    focusMode: document.querySelector('.cp-focus [data-focus-mode]')?.getAttribute('aria-pressed') || ''
  }));
  check('لا إعادة بناء كاملة: Sentinel و قسم واحد لكل قسم', after.sentinel && after.sections.focus === 1 && after.sections.attention === 1 && after.sections.kpis === 1, JSON.stringify(after.sections));
  check('«✓ تم» يزيل العمل من الطابور دون مغادرة الصفحة', after.route === 'dashboard' && !after.attnHas && after.attnCount === before.attnCount - 1, `${before.attnCount}→${after.attnCount}`);
  check('«الخطوة التالية» تتغير إلى العمل التالي', /الخطوة التالية/.test(after.focusTitle) && !/عمل متأخر «تم»/.test(after.focusTitle), `${before.focusTitle.slice(0, 40)} → ${after.focusTitle.slice(0, 40)}`);
  check('Focus يبقى مفعّلًا بعد «✓ تم»', after.focusMode === 'true');
  check('الفلتر النشط (الأهمية) يبقى بعد التحديث', after.filter === filterBefore && after.filter !== '', `${filterBefore}→${after.filter}`);
  check('موضع التمرير محفوظ بعد التحديث الموضعي', after.scrollY === scrollBefore, `${scrollBefore}→${after.scrollY}`);
  check('إشعار «تراجع» (Undo) يظهر بعد «✓ تم»', /تراجع/.test(after.undoBtn), after.undoBtn);
  await app(() => { [...document.querySelectorAll('.toast .toast-act')].at(-1)?.click(); });
  await page.waitForFunction(() => /عمل متأخر «تم»/.test(document.querySelector('[data-attn-list]')?.textContent || ''), null, {timeout: 15000}).catch(() => {});
  await settle(500);
  const undone = await app(() => ({
    sentinel: Boolean(document.querySelector('#pos-sentinel')),
    attnCount: document.querySelectorAll('[data-attn-list] .cp-row').length,
    attnHas: /عمل متأخر «تم»/.test(document.querySelector('[data-attn-list]')?.textContent || ''),
    filter: document.querySelector('.cp-count.is-on')?.dataset.attnFilter || '',
    focusMode: document.querySelector('.cp-focus [data-focus-mode]')?.getAttribute('aria-pressed') || ''
  }));
  check('«تراجع» يعيد العمل إلى الطابور بلا إعادة بناء', undone.sentinel && undone.attnHas && undone.attnCount === before.attnCount && undone.filter === filterBefore && undone.focusMode === 'true', JSON.stringify(undone));
  await page.locator('.cp-focus [data-focus-mode]').click();
  check('الخروج من Focus يعيد قائمة «ثم» على البطاقة نفسها', (await page.locator('.cp-focus [data-focus-mode]').getAttribute('aria-pressed')) === 'false' && (await page.locator('.cp-focus .cp-then li').count()) > 0);
  await app(() => { document.querySelector('#pos-sentinel')?.remove(); });

  // 8) تحضير الغد: بعد الوقت المضبوط فقط، ومع عنصر غدٍ وفجوة تشغيلية قابلة للتصرف.
  const prepSeed = await app(async () => {
    const office = window.__LAW_OFFICE_APP__.office;
    const clock = await import('/js/core/clock.js');
    const {createLegalFile} = await import('/js/services/legal-files.js');
    const {saveOperational} = await import('/js/services/operations.js');
    const {saveWorkConfig, getWorkConfig} = await import('/js/services/work-config.js');
    const client = await office.saveClient({fullName: '〔تجريبي〕 موكل تحضير الغد'});
    const file = await createLegalFile(office, {clientId: client.id, title: '〔تجريبي〕 ملف تحضير الغد', fileType: 'مدني'});
    const kase = await office.createCase({fileId: file.id, stageType: 'دعوى', caseNumber: '9876', caseYear: '2026'});
    const tomorrow = clock.addDays(clock.localDate(), 1);
    const hearing = await saveOperational(office, 'hearings', {caseId: kase.id, fileId: file.id, hearingDate: tomorrow, type: 'نظر', reason: '〔تجريبي〕 جلسة بلا وقت لتحضير الغد'});
    const oldTime = getWorkConfig().tomorrowPrepAfter;
    await saveWorkConfig({tomorrowPrepAfter: '23:59'});
    return {clientId: client.id, fileId: file.id, caseId: kase.id, hearingId: hearing.id, oldTime, now: new Date().toTimeString().slice(0, 5)};
  });
  await go('dashboard', 800);
  if (prepSeed.now < '23:59') check('قبل وقت الإعداد: لا يظهر تحضير الغد', (await page.locator('[data-home-tomorrow-prep]').count()) === 0);
  await app(async () => {
    const {saveWorkConfig} = await import('/js/services/work-config.js');
    await saveWorkConfig({tomorrowPrepAfter: '00:00'});
  });
  await go('dashboard', 800);
  const prepNotice = await app(() => ({
    count: document.querySelectorAll('[data-home-tomorrow-prep]').length,
    text: document.querySelector('[data-home-tomorrow-prep]')?.textContent?.replace(/\s+/g, ' ').trim() || '',
    route: document.querySelector('[data-home-tomorrow-prep] [data-route]')?.dataset.route || ''
  }));
  check('بعد وقت الإعداد: جلسة الغد بلا وقت تُظهر إشارة واحدة وفتح المصدر', prepNotice.count === 1 && /تحضير الغد/.test(prepNotice.text) && /لا يوجد وقت محدد/.test(prepNotice.text) && prepNotice.route === `rec:hearings:${prepSeed.hearingId}`, JSON.stringify(prepNotice));
  await app(async id => {
    const office = window.__LAW_OFFICE_APP__.office;
    const {saveOperational} = await import('/js/services/operations.js');
    await saveOperational(office, 'hearings', {hearingTime: '11:00'}, id, {reason: 'تحديد وقت الجلسة'});
  }, prepSeed.hearingId);
  await go('dashboard', 800);
  check('معالجة الفجوة: بعد تحديد وقت الجلسة لا تتحول الإشارة إلى لوحة ثانية', (await page.locator('[data-home-tomorrow-prep]').count()) === 0);
  await app(async oldTime => {
    const {saveWorkConfig} = await import('/js/services/work-config.js');
    await saveWorkConfig({tomorrowPrepAfter: oldTime});
  }, prepSeed.oldTime);

  // 9) Quick Add context: Home «مكتب اليوم» يضع تاريخ اليوم افتراضيًا للمهمة والموعد.
  await go('dashboard', 700);
  await page.locator('.cp-hero [data-quick-add]').click(); await page.waitForSelector('.quick-context');
  await page.locator('.quick-context [data-qa-kind="task"]').click();
  await page.waitForSelector('.entity-form[data-store="workItems"]');
  const taskDate = await page.locator('.entity-form[data-store="workItems"] [name="dueDate"]').inputValue();
  const localToday = await page.evaluate(async () => (await import('/js/core/clock.js')).localDate());
  check('Quick Add من الرئيسية يضع تاريخ اليوم للمهمة', taskDate === localToday, taskDate);
  await page.keyboard.press('Escape'); await page.waitForSelector('.entity-form', {state: 'detached'});
  await page.locator('.cp-hero [data-quick-add]').click(); await page.waitForSelector('.quick-context');
  await page.locator('.quick-context [data-qa-kind="appointment"]').click();
  await page.waitForSelector('.entity-form[data-store="appointments"]');
  const appointmentDate = await page.locator('.entity-form[data-store="appointments"] [name="date"]').inputValue();
  check('Quick Add من الرئيسية يضع تاريخ اليوم للموعد', appointmentDate === localToday, appointmentDate);
  await page.keyboard.press('Escape'); await page.waitForSelector('.entity-form', {state: 'detached'});

  // 9b) Quick Add الطبيعي: معاينة واضحة قبل النموذج، ورفض الالتباس، مع الحفاظ على السياق.
  await go('dashboard', 700);
  await page.locator('.cp-hero [data-quick-add]').click(); await page.waitForSelector('.qa-natural-input');
  await page.fill('.qa-natural-input', 'مهمة مراجعة 09/10/2026');
  const invalidNatural = await app(() => ({
    message: document.querySelector('[data-qa-natural-message]')?.textContent?.replace(/\s+/g, ' ').trim() || '',
    messageHidden: document.querySelector('[data-qa-natural-message]')?.hidden,
    previewHidden: document.querySelector('[data-qa-preview]')?.hidden,
    openDisabled: document.querySelector('[data-qa-natural-open]')?.disabled,
    invalid: document.querySelector('.qa-natural-input')?.getAttribute('aria-invalid') || '',
    formCount: document.querySelectorAll('.entity-form').length
  }));
  check('Quick Add الطبيعي يرفض التاريخ الرقمي الملتبس قبل أي نموذج', invalidNatural.message.includes('ملتبسة') && invalidNatural.messageHidden === false && invalidNatural.previewHidden === true && invalidNatural.openDisabled === true && invalidNatural.invalid === 'true' && invalidNatural.formCount === 0, JSON.stringify(invalidNatural));

  await page.fill('.qa-natural-input', 'موعد مراجعة العقد اليوم 14:05');
  const naturalPreview = await app(() => ({
    messageHidden: document.querySelector('[data-qa-natural-message]')?.hidden,
    previewHidden: document.querySelector('[data-qa-preview]')?.hidden,
    openDisabled: document.querySelector('[data-qa-natural-open]')?.disabled,
    kind: document.querySelector('[data-preview-kind]')?.textContent?.trim() || '',
    title: document.querySelector('[data-preview-title]')?.textContent?.trim() || '',
    date: document.querySelector('[data-preview-date]')?.textContent?.trim() || '',
    time: document.querySelector('[data-preview-time]')?.textContent?.trim() || '',
    formCount: document.querySelectorAll('.entity-form').length
  }));
  check('Quick Add الطبيعي يعرض معاينة واضحة بلا فتح نموذج', naturalPreview.messageHidden === true && naturalPreview.previewHidden === false && naturalPreview.openDisabled === false && naturalPreview.kind === 'موعد' && naturalPreview.title === 'مراجعة العقد' && naturalPreview.date.includes(localToday) && naturalPreview.time === '14:05' && naturalPreview.formCount === 0, JSON.stringify(naturalPreview));

  await page.locator('[data-qa-natural-open]').click(); await page.waitForSelector('.entity-form[data-store="appointments"]');
  const naturalAppointment = await app(() => ({
    title: document.querySelector('.entity-form[data-store="appointments"] [name="title"]')?.value || '',
    date: document.querySelector('.entity-form[data-store="appointments"] [name="date"]')?.value || '',
    time: document.querySelector('.entity-form[data-store="appointments"] [name="time"]')?.value || ''
  }));
  check('Quick Add الطبيعي يفتح نموذج الموعد بالمعاينة', naturalAppointment.title === 'مراجعة العقد' && naturalAppointment.date === localToday && naturalAppointment.time === '14:05', JSON.stringify(naturalAppointment));
  await page.keyboard.press('Escape'); await page.waitForSelector('.entity-form', {state: 'detached'});

  await page.locator('.cp-hero [data-quick-add]').click(); await page.waitForSelector('.qa-natural-input');
  await page.fill('.qa-natural-input', 'مهمة مراجعة العقد اليوم 09:30');
  await page.locator('[data-qa-natural-open]').click(); await page.waitForSelector('.entity-form[data-store="workItems"]');
  const naturalTask = await app(() => ({
    title: document.querySelector('.entity-form[data-store="workItems"] [name="title"]')?.value || '',
    dueDate: document.querySelector('.entity-form[data-store="workItems"] [name="dueDate"]')?.value || '',
    dueTime: document.querySelector('.entity-form[data-store="workItems"] [name="dueTime"]')?.value || ''
  }));
  check('Quick Add الطبيعي يفتح نموذج المهمة بالمعاينة', naturalTask.title === 'مراجعة العقد' && naturalTask.dueDate === localToday && naturalTask.dueTime === '09:30', JSON.stringify(naturalTask));
  await page.keyboard.press('Escape'); await page.waitForSelector('.entity-form', {state: 'detached'});

  await go(`file:${seed.fileId}`, 900);
  await page.locator('#quick-add').click(); await page.waitForSelector('.qa-natural-input');
  await page.fill('.qa-natural-input', 'موعد مراجعة العقد اليوم 16:45');
  await page.locator('[data-qa-natural-open]').click(); await page.waitForSelector('.entity-form[data-store="appointments"]');
  const contextualAppointment = await app(() => ({
    title: document.querySelector('.entity-form[data-store="appointments"] [name="title"]')?.value || '',
    date: document.querySelector('.entity-form[data-store="appointments"] [name="date"]')?.value || '',
    time: document.querySelector('.entity-form[data-store="appointments"] [name="time"]')?.value || '',
    fileId: document.querySelector('.entity-form[data-store="appointments"] input[name="fileId"]')?.value || ''
  }));
  check('Quick Add الطبيعي يحافظ على سياق الملف', contextualAppointment.title === 'مراجعة العقد' && contextualAppointment.date === localToday && contextualAppointment.time === '16:45' && contextualAppointment.fileId === seed.fileId, JSON.stringify(contextualAppointment));
  await page.keyboard.press('Escape'); await page.waitForSelector('.entity-form', {state: 'detached'});
  await go('dashboard', 700);

  // 10) قياس عرض الصفحة الحقيقي في كل نقاط القبول، للرئيسية ومركز العمل.
  const responsiveWidths = [360, 390, 768, 1024, 1280, 1440, 1600];
  for (const width of responsiveWidths) {
    await page.setViewportSize({width, height: 900}); await settle(300);
    const ov = await app(() => ({doc: document.documentElement.scrollWidth, body: document.body.scrollWidth, win: window.innerWidth}));
    check(`لا تمرير أفقي في الرئيسية عند ${width}px`, ov.doc <= ov.win && ov.body <= ov.win, JSON.stringify(ov));
  }
  await go('actionCenter', 1000); await page.waitForSelector('#wc-root', {timeout: 20000});
  for (const width of responsiveWidths) {
    await page.setViewportSize({width, height: 900}); await settle(350);
    const ov = await app(() => ({doc: document.documentElement.scrollWidth, body: document.body.scrollWidth, win: window.innerWidth}));
    check(`لا تمرير أفقي في مركز العمل عند ${width}px`, ov.doc <= ov.win && ov.body <= ov.win, JSON.stringify(ov));
  }
  await page.setViewportSize({width: 1280, height: 900});

  check('لا أخطاء JavaScript أثناء الفحص', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
} catch (e) {
  failures.push('exception: ' + e.message);
  console.log('EXCEPTION', e.message);
} finally {
  // تنظيف عبر مسار «حذف كل البيانات التجريبية» نفسه
  try {
    const out = await page.evaluate(async () => {
      const office = window.__LAW_OFFICE_APP__.office;
      const {removeDemoData, scanDemoData} = await import('/js/services/demo-data.js');
      const before = await scanDemoData(office);
      const r = await removeDemoData(office, {reason: 'تنظيف فحص مكتب اليوم v2'});
      const after = await scanDemoData(office);
      return {before: before.total, removed: r.removed, after: after.total};
    });
    console.log('cleanup', JSON.stringify(out));
    check('التنظيف: لا بيانات تجريبية متبقية', out.after === 0, JSON.stringify(out));
  } catch (e) { console.log('cleanup failed', e.message); failures.push('cleanup'); }
  await browser.close();
}
console.log(`\n${checks.length - failures.length}/${checks.length} فحصًا ناجحًا`);
process.exit(failures.length ? 1 : 0);
