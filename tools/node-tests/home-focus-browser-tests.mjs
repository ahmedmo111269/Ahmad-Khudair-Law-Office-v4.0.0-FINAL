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
    return {procId: p?.id || ''};
  }, seed.fileId);
  check('زرع عمل إداري متأخر عاجل', Boolean(posSeed.procId), JSON.stringify(posSeed).slice(0, 120));

  await go('dashboard', 900);
  await app(() => { const el = document.createElement('div'); el.id = 'pos-sentinel'; el.hidden = true; document.querySelector('#main-content').append(el); window.scrollTo(0, 420); });
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
  await app(() => { document.querySelector('[data-attn-filter="critical"]')?.click(); });
  const filterBefore = await app(() => document.querySelector('.cp-count.is-on')?.dataset.attnFilter || '');
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
    undoBtn: [...document.querySelectorAll('.toast .toast-act')].at(-1)?.textContent?.trim() || ''
  }));
  check('لا إعادة بناء كاملة: Sentinel و قسم واحد لكل قسم', after.sentinel && after.sections.focus === 1 && after.sections.attention === 1 && after.sections.kpis === 1, JSON.stringify(after.sections));
  check('«✓ تم» يزيل العمل من الطابور دون مغادرة الصفحة', after.route === 'dashboard' && !after.attnHas && after.attnCount === before.attnCount - 1, `${before.attnCount}→${after.attnCount}`);
  check('«الخطوة التالية» تتغير إلى العمل التالي', after.focusTitle !== before.focusTitle && !/عمل متأخر «تم»/.test(after.focusTitle), `${before.focusTitle.slice(0, 40)} → ${after.focusTitle.slice(0, 40)}`);
  check('الفلتر النشط (الأهمية) يبقى بعد التحديث', after.filter === filterBefore && after.filter !== '', `${filterBefore}→${after.filter}`);
  check('موضع التمرير محفوظ بعد التحديث الموضعي', after.scrollY === before.scrollY, `${before.scrollY}→${after.scrollY}`);
  check('إشعار «تراجع» (Undo) يظهر بعد «✓ تم»', /تراجع/.test(after.undoBtn), after.undoBtn);
  await app(() => { [...document.querySelectorAll('.toast .toast-act')].at(-1)?.click(); });
  await page.waitForFunction(() => /عمل متأخر «تم»/.test(document.querySelector('[data-attn-list]')?.textContent || ''), null, {timeout: 15000}).catch(() => {});
  await settle(500);
  const undone = await app(() => ({
    sentinel: Boolean(document.querySelector('#pos-sentinel')),
    attnCount: document.querySelectorAll('[data-attn-list] .cp-row').length,
    attnHas: /عمل متأخر «تم»/.test(document.querySelector('[data-attn-list]')?.textContent || ''),
    filter: document.querySelector('.cp-count.is-on')?.dataset.attnFilter || ''
  }));
  check('«تراجع» يعيد العمل إلى الطابور بلا إعادة بناء', undone.sentinel && undone.attnHas && undone.attnCount === before.attnCount && undone.filter === filterBefore, JSON.stringify(undone));
  await app(() => { document.querySelector('#pos-sentinel')?.remove(); });

  // 8) الهاتف: لا تمرير أفقي في الرئيسية مع الطبقات الجديدة
  await page.setViewportSize({width: 390, height: 844});
  await settle(400);
  const ov = await app(() => ({doc: document.documentElement.scrollWidth, win: window.innerWidth}));
  check('الهاتف 390: لا تمرير أفقي في الرئيسية', ov.doc <= ov.win, JSON.stringify(ov));
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
