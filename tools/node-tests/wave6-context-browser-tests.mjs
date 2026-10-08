// =====================================================================
// WAVE 6.1 — فحص سلوكي حقيقي في Chromium لسياق التنفيذ داخل الملف والموكل،
// وسلوك «مكتب اليوم» مع تنفيذ يحتاج قرارًا، وجودة الوضع الداكن، ثم انحدار
// المسارات الأساسية (فتح → تنفيذ → حفظ → تراجع → وضع تشغيل → ملف → موكل → رئيسية).
// التشغيل:  node wave6-context-browser-tests.mjs   (يحتاج خادم ملفات محليًا)
// المتغيرات: GRID_BASE_URL (افتراضي http://127.0.0.1:8080)
// ---------------------------------------------------------------------
// بيانات الاختبار مؤقتة وموسومة 〔تجريبي〕 وتُحذف في نهاية التشغيل عبر
// services/demo-data.js نفسه (نفس مسار زر «حذف كل البيانات التجريبية»)،
// ولا يُكتب أي سجل بلا وسم ولا يُحذف أي سجل غير موسوم.
// =====================================================================
import {chromium} from 'playwright';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const base = (process.env.GRID_BASE_URL || 'http://127.0.0.1:8080').replace(/\/$/, '');
const artifactDir = path.join(repository, '.cache', 'wave6-context');
await fs.mkdir(artifactDir, {recursive: true});

const report = {scenario: 'wave6.1-context-qa', date: new Date().toISOString(), base, checks: [], failures: [], consoleErrors: [], screenshots: []};
const check = (name, condition, detail = '') => {
  if (condition) { report.checks.push({name, status: 'VERIFIED', detail}); console.log(`PASS — ${name}${detail ? ` (${detail})` : ''}`); }
  else { report.failures.push({name, detail}); console.log(`FAIL — ${name}${detail ? ` (${detail})` : ''}`); }
};
const shot = async (page, name) => {
  const file = path.join(artifactDir, `${name}.png`);
  await page.screenshot({path: file, fullPage: false});
  report.screenshots.push(path.relative(repository, file));
  return file;
};

/* ------------------------------ التشغيل ------------------------------ */
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

const context = await browser.newContext({viewport: {width: 1440, height: 1000}, serviceWorkers: 'block', locale: 'ar'});
const page = await context.newPage();
page.on('pageerror', error => report.consoleErrors.push(`pageerror: ${error.message}`));
page.on('console', message => { if (message.type() === 'error' && !/ERR_CONNECTION_CLOSED|ERR_FAILED|ERR_ABORTED|favicon|net::/.test(message.text())) report.consoleErrors.push(`console: ${message.text()}`); });

const settle = (ms = 450) => page.waitForTimeout(ms);
const app = (fn, arg) => page.evaluate(fn, arg);
const go = async (route, waitFor = 400) => {
  await page.evaluate(r => window.__LAW_OFFICE_APP__.go(r), route);
  await settle(waitFor);
};
const route = () => page.evaluate(() => window.__LAW_OFFICE_APP__.route);
const text = selector => page.evaluate(sel => document.querySelector(sel)?.textContent?.replace(/\s+/g, ' ').trim() || '', selector);
const count = selector => page.locator(selector).count();
const visible = selector => page.locator(selector).first().isVisible().catch(() => false);

/** فحص تجاوز العرض الأفقي: عرض الوثيقة مقابل نافذة العرض. */
const overflow = () => page.evaluate(() => ({
  doc: document.documentElement.scrollWidth, win: window.innerWidth,
  body: document.body.scrollWidth,
  offenders: [...document.querySelectorAll('#main-content *')]
    .filter(el => el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflowX === 'visible' && el.clientWidth > 0)
    .slice(0, 5).map(el => `${el.tagName.toLowerCase()}.${String(el.className || '').split(' ').slice(0, 2).join('.')}`)
}));

/** تباين فعلي (WCAG) لعناصر مختارة: اللون مقابل أول خلفية غير شفافة. */
const contrast = selectors => page.evaluate(list => {
  const parse = value => {
    const match = /rgba?\(([^)]+)\)/.exec(value || '');
    if (!match) return null;
    const parts = match[1].split(',').map(part => Number(part.trim()));
    return {r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1};
  };
  const over = (fg, bg) => ({r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1});
  const lum = c => {
    const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  const solidBackground = el => {
    let node = el;
    while (node && node !== document.documentElement) {
      const bg = parse(getComputedStyle(node).backgroundColor);
      if (bg && bg.a > 0.95) return bg;
      if (bg && bg.a > 0) { const parent = solidBackground(node.parentElement || document.documentElement); return over(bg, parent); }
      node = node.parentElement;
    }
    return parse(getComputedStyle(document.body).backgroundColor) || {r: 255, g: 255, b: 255, a: 1};
  };
  // الأزرار الأساسية تستعمل تدرّجًا لونيًا (background-image) لا لونًا واحدًا:
  // نعتبر أسوأ نقطة في التدرّج بدل تجاهلها.
  const backgrounds = el => {
    const image = getComputedStyle(el).backgroundImage || '';
    if (/gradient/.test(image)) {
      const colors = [];
      for (const value of image.match(/rgba?\([^)]+\)|color\(srgb[^)]+\)/g) || []) {
        const srgb = /color\(srgb([^)]+)\)/.exec(value);
        if (srgb) {
          const parts = srgb[1].trim().split(/\s+/).map(Number);
          if (parts.length >= 3 && parts.every(Number.isFinite)) colors.push({r: parts[0] * 255, g: parts[1] * 255, b: parts[2] * 255, a: 1});
          continue;
        }
        const c = parse(value);
        if (c && c.a > 0.9) colors.push(c);
      }
      if (colors.length) return colors; // التدرّج يغطّي خلفية الأب: نقيس على أسوأ نقطة فيه
    }
    return [solidBackground(el)];
  };
  return list.map(sel => {
    const el = document.querySelector(sel);
    if (!el) return {selector: sel, missing: true};
    const style = getComputedStyle(el);
    const fg = parse(style.color) || {r: 0, g: 0, b: 0, a: 1};
    const ratios = backgrounds(el).map(bg => ratio(over(fg, bg), bg));
    return {selector: sel, ratio: Math.round(Math.min(...ratios) * 100) / 100, size: style.fontSize, text: (el.textContent || '').trim().slice(0, 28)};
  });
}, selectors);

/** التنظيف: نفس مسار زر «حذف كل البيانات التجريبية» في التطبيق. */
const cleanupDemoData = async () => app(async () => {
  const office = window.__LAW_OFFICE_APP__.office;
  const {scanDemoData, removeDemoData} = await import('/js/services/demo-data.js');
  const beforeScan = await scanDemoData(office);
  const out = await removeDemoData(office, {reason: 'تنظيف فحص موجة 6.1'});
  const afterScan = await scanDemoData(office);
  return {before: beforeScan.total, removed: out.removed, after: afterScan.total};
});

try {
  /* ============================ التهيئة ============================ */
  await page.goto(`${base}/index.html`);
  await page.waitForFunction(() => window.__LAW_OFFICE_APP__ && !window.__LAW_OFFICE_APP__.booting, null, {timeout: 90000});
  await settle(1200); // زرع الإقلاع الأول إن وُجد

  /* ==================== 1) بيانات اختبار مؤقتة (موسومة) ==================== */
  const seeded = await app(async () => {
    const office = window.__LAW_OFFICE_APP__.office;
    const demo = await import('/js/services/execution-demo.js');
    const S = await import('/js/services/execution-simple.js');
    const clock = await import('/js/core/clock.js');
    const example = await demo.seedFamilyExecutionExample(office);
    const execution = example.execution;
    const today = clock.localDate();
    // تنفيذ ثانٍ على نفس الملف/الموكل: قيمة ثابتة (لا متأخرات) + إجراء مخطط قريب
    const second = await S.createSimpleExecution(office, {
      executionType: 'civil', clientId: execution.clientId, fileId: execution.fileId,
      valueType: 'fixed', amount: 5000, judgmentDate: today, effectiveFrom: today,
      officialNumber: 'QA-6.1', authority: 'قلم تنفيذ — فحص', openedDate: today,
      notes: '〔تجريبي〕 فحص موجة 6.1 — يُحذف تلقائيًا'
    });
    const secondId = second.execution?.id || second.id;
    await S.recordSimpleAction(office, {
      executionId: secondId, kind: 'request', date: today, result: 'تم',
      nextAction: 'مراجعة قلم التنفيذ', nextActionDate: clock.addDays(today, 3)
    });
    const work = await import('/js/services/execution-work.js');
    const forFile = await work.executionsForFile(office, execution.fileId, {today});
    const forClient = await work.executionsForClient(office, execution.clientId, {today});
    return {
      executionId: execution.id, clientId: execution.clientId, fileId: execution.fileId,
      secondId, today,
      fileItems: forFile.map(item => ({id: item.id, severity: item.severity, step: item.step.code, overdue: item.overdueMinor, remaining: item.remainingTotal})),
      clientIds: forClient.map(item => item.id),
      familyNumber: execution.internalNumber || execution.officialNumber || ''
    };
  });
  check('تهيئة بيانات الاختبار: تنفيذ متأخر + تنفيذ بإجراء مخطط على الملف نفسه',
    seeded.fileItems.length === 2 && seeded.clientIds.length === 2,
    JSON.stringify(seeded.fileItems));

  /* ============ 2) Execution → Dashboard Brief → مكتب اليوم ============ */
  const brief = await app(async () => {
    const office = window.__LAW_OFFICE_APP__.office;
    const {dashboardBrief} = await import('/js/services/dashboard.js');
    const {buildFocusModel} = await import('/js/services/focus-engine.js');
    const clock = await import('/js/core/clock.js');
    const today = clock.localDate();
    const b = await dashboardBrief(office);
    const model = buildFocusModel(b, {today, now: new Date().toTimeString().slice(0, 5)});
    const exec = model.attention.map((item, index) => ({...item, index})).filter(item => item.kind === 'execution');
    const todayHearings = model.attention.map((item, index) => ({...item, index})).filter(item => item.kind === 'hearing' && String(item.when || '').startsWith('اليوم'));
    return {
      briefAttention: (b.executionAttention || []).map(item => ({id: item.id, severity: item.severity, step: item.step, overdue: item.overdueMinor})),
      execCount: exec.length,
      execSeverities: exec.map(item => item.severity),
      execRoutes: exec.map(item => item.route),
      execSteps: exec.map(item => item.when),
      firstExecIndex: exec.length ? Math.min(...exec.map(item => item.index)) : -1,
      lastHearingIndex: todayHearings.length ? Math.max(...todayHearings.map(item => item.index)) : -1,
      todayHearings: todayHearings.length,
      next: model.next ? {kind: model.next.kind, title: model.next.title, when: model.next.when} : null,
      timeline: model.timeline.map(item => item.kind)
    };
  });
  check('Brief يعرض التنفيذ الذي يحتاج قرارًا (خطوته «تحصيل» ومتأخراته ظاهرة)',
    brief.briefAttention.some(item => item.id === seeded.executionId && ['critical', 'high'].includes(item.severity) && item.step === 'collect' && item.overdue > 0),
    JSON.stringify(brief.briefAttention));
  check('محرّك التركيز: بند التنفيذ يظهر بوسم «مهم» لا «عاجل» (سقف لا يتقدم على جلسات اليوم)',
    brief.execCount === 1 && brief.execSeverities.every(severity => severity === 'high'),
    `exec=${brief.execCount} sev=${JSON.stringify(brief.execSeverities)}`);
  check('بند التنفيذ يأتي بعد كل جلسات اليوم في الطابور (لا يتغلب على أولويتها)',
    brief.todayHearings > 0 && brief.firstExecIndex > brief.lastHearingIndex,
    `firstExec=${brief.firstExecIndex} lastHearing=${brief.lastHearingIndex} hearings=${brief.todayHearings}`);
  check('«الآن» يبقى على جلسة اليوم لا على التنفيذ',
    brief.next?.kind === 'hearing', JSON.stringify(brief.next));
  check('بند التنفيذ يفتح بطاقة التنفيذ من مكتب اليوم (ExecutionContext)',
    brief.execRoutes.every(value => String(value).startsWith('exc:')), JSON.stringify(brief.execRoutes));
  check('التنفيذ لا يظهر في «جدول اليوم» الزمني (ليس جلسة/موعدًا/متابعة)',
    !brief.timeline.includes('execution'), JSON.stringify(brief.timeline));

  /* ============ 3) مكتب اليوم في الواجهة: الطابور ثم فتح السياق ============ */
  await go('dashboard', 900);
  const home = await app(() => {
    const rows = [...document.querySelectorAll('#main-content .cp-row-main')].map(button => ({route: button.dataset.route, text: button.textContent.replace(/\s+/g, ' ').trim()}));
    return {rows, focusTitle: document.querySelector('#cp-focus-title')?.textContent?.trim() || '', focusKindRoute: document.querySelector('.cp-focus .cp-primary')?.dataset.route || ''};
  });
  const homeExecRow = home.rows.find(row => row.route === `exc:${seeded.executionId}`);
  const moreNote = await text('.cp-more');
  const footerExecLink = await app(() => {
    const more = document.querySelector('#main-content .cp-more');
    const link = more?.querySelector('[data-route="executionCenter"]');
    return {text: more?.textContent?.replace(/\s+/g, ' ').trim() || '', hasLink: Boolean(link), path: link?.dataset.route || ''};
  });
  check('«يحتاج انتباهك» في الرئيسية يحتوي بند التنفيذ فعلًا (صفًا ظاهرًا أو إشارة صريحة في الذيل)',
    Boolean(homeExecRow) || footerExecLink.hasLink,
    `${homeExecRow?.text || 'خارج أول 12 صفًا'} | ${footerExecLink.text}`);
  if (!homeExecRow && footerExecLink.hasLink) {
    await page.locator('#main-content .cp-more [data-route="executionCenter"]').click();
    await settle(1500);
    check('فتح السياق من مكتب اليوم يصل إلى مركز التنفيذ (وفيه التنفيذ الذي يحتاج قرارًا)',
      (await route()) === 'executionCenter' && await visible('.wc-row'), await route());
    const centerHasExecution = await page.locator(`.wc-row[data-row="${seeded.executionId}"]`).count();
    check('التنفيذ الذي يحتاج قرارًا ظاهر في طابور مركز التنفيذ بعد القدوم من مكتب اليوم', centerHasExecution === 1, `count=${centerHasExecution}`);
    await page.locator(`.wc-row[data-row="${seeded.executionId}"] [data-act="open"], .wc-row[data-row="${seeded.executionId}"] [data-open]`).first().click().catch(() => null);
    await settle(1200);
    if (!String(await route()).startsWith('exc:')) {
      await page.locator(`.wc-row[data-row="${seeded.executionId}"] .wc-row-main`).click();
      await settle(1200);
    }
    check('من الطابور إلى بطاقة التنفيذ نفسها (Open Context)',
      (await route()) === `exc:${seeded.executionId}`, await route());
    await go('dashboard', 900);
  }
  // الفلتر العملي داخل الصفوف المعروضة (سلوك قائم: الطابور مقصوص عند 12 صفًا).
  const severityMix = await app(() => [...document.querySelectorAll('#main-content .cp-row')].map(row => row.dataset.sev));
  const highShown = severityMix.filter(sev => sev === 'high').length;
  await page.locator('.cp-count--high').click();
  await settle(350);
  const filtered = await app(() => ({
    visible: [...document.querySelectorAll('#main-content .cp-row:not([hidden])')].map(row => row.dataset.sev),
    pressed: document.querySelector('.cp-count--high')?.getAttribute('aria-pressed')
  }));
  check('فلاتر الأهمية في مكتب اليوم تعمل داخل الصفوف المعروضة (لا تتغيّر الأولوية)',
    filtered.visible.length === highShown && filtered.visible.every(sev => sev === 'high') && filtered.pressed === 'true',
    `high=${highShown} visible=${JSON.stringify(filtered.visible)} of ${JSON.stringify(severityMix)}`);
  await page.locator('.cp-count--all').click();
  await settle(300);
  check('بطاقة «الآن» في الرئيسية ما زالت على الجلسة (لا التنفيذ)',
    home.focusKindRoute.startsWith('rec:hearings:'), home.focusKindRoute);
  await shot(page, '01-home-dark-desktop');

  /* ============ 4) شريط التنفيذ في كوكبيت الملف ============ */
  await go(`file:${seeded.fileId}`, 1100);
  const fileStrip = await app(() => {
    const strip = document.querySelector('#main-content .cp-exec');
    const rows = [...(strip?.querySelectorAll('.cp-exec-main') || [])].map(button => ({route: button.dataset.route, text: button.textContent.replace(/\s+/g, ' ').trim()}));
    return {exists: Boolean(strip), title: strip?.querySelector('.cp-exec-title')?.textContent?.trim() || '', pulse: strip?.querySelector('.cp-exec-pulse')?.textContent?.replace(/\s+/g, ' ').trim() || '', rows, link: strip?.querySelector('.cp-exec-head [data-route]')?.dataset.route || ''};
  });
  check('كوكبيت الملف: شريط التنفيذ ظاهر بعنوان مفهوم', fileStrip.exists && fileStrip.title.length > 0, fileStrip.title);
  check('شريط الملف يعرض التنفيذين مرتبين بالأولوية (متأخر أولًا)',
    fileStrip.rows.length === 2 && fileStrip.rows[0].route === `exc:${seeded.executionId}`,
    JSON.stringify(fileStrip.rows.map(row => row.route)));
  check('شريط الملف يعرض المتأخرات والمتبقي وعدد ما يحتاج قرارًا',
    /متأخرات/.test(fileStrip.pulse) && /المتبقي/.test(fileStrip.pulse) && /يحتاج قرارًا/.test(fileStrip.pulse), fileStrip.pulse);
  check('شريط الملف يحمل رابطًا مباشرًا لمركز التنفيذ مقصورًا على الملف',
    fileStrip.link === `executionCenter?fileId=${encodeURIComponent(seeded.fileId)}`, fileStrip.link);
  await shot(page, '02-file-strip-dark-desktop');

  const rowRoute = await page.locator('#main-content .cp-exec-main').first().getAttribute('data-route');
  await page.locator('#main-content .cp-exec-main').first().click();
  await settle(1100);
  check('نقرة الصف تفتح بطاقة التنفيذ نفسها (Relation: File → Execution)',
    (await route()) === rowRoute, `${await route()} vs ${rowRoute}`);
  const cardTitle = await text('#page-title');
  check('بطاقة التنفيذ مفتوحة من سياق الملف', cardTitle.includes('التنفيذ'), cardTitle);

  /* ============ 5) شريط التنفيذ في Client 360 ============ */
  await go(`client:${seeded.clientId}`, 500);
  await page.waitForFunction(() => document.querySelector('#main-content .cp-client-ws'), null, {timeout: 15000}).catch(() => null);
  const clientPage = await text('#page-title');
  await go(`cfile:${seeded.clientId}`, 1400);
  const clientStrip = await app(() => {
    const strip = document.querySelector('#main-content .cp-client-ws .cp-exec');
    const rows = [...(strip?.querySelectorAll('.cp-exec-main') || [])].map(button => ({route: button.dataset.route, text: button.textContent.replace(/\s+/g, ' ').trim(), main: button.querySelector('.cp-exec-text b')?.textContent.trim() || ''}));
    const sections = [...document.querySelectorAll('#main-content .cp-client-ws > *')].map(node => node.className);
    return {exists: Boolean(strip), title: strip?.querySelector('.cp-exec-title')?.textContent?.trim() || '', rows, link: strip?.querySelector('.cp-exec-head [data-route]')?.dataset.route || '', sections};
  });
  check('Client 360: شريط تنفيذ الموكل ظاهر (سياق الموكل لا نسخة من المركز)',
    clientStrip.exists && clientStrip.title.includes('الموكل'), `${clientStrip.title} | ${JSON.stringify(clientStrip.sections)}`);
  check('شريط الموكل يعرض تنفيذات الموكل مع اسم ملفها (Relation: Client → File → Execution)',
    clientStrip.rows.length === 2 && clientStrip.rows.every(row => /ملف \d/.test(row.text)),
    JSON.stringify(clientStrip.rows.map(row => row.text)));
  check('شريط الموكل يحمل رابطًا مباشرًا لمركز التنفيذ مقصورًا على الموكل',
    clientStrip.link === `executionCenter?clientId=${encodeURIComponent(seeded.clientId)}`, clientStrip.link);
  check('ترتيب أقسام مركز الموكل: التنفيذ بعد «الآن/جدول اليوم» وقبل طابور القرارات',
    clientStrip.sections.findIndex(name => name.includes('cp-exec')) > clientStrip.sections.findIndex(name => name.includes('cp-stage'))
    && clientStrip.sections.findIndex(name => name.includes('cp-exec')) < clientStrip.sections.findIndex(name => name.includes('cp-attn')),
    JSON.stringify(clientStrip.sections));
  await shot(page, '03-client-strip-dark-desktop');

  /* ============ 6) الرابط السريع: مركز التنفيذ مقصورًا ============ */
  await page.locator('#main-content .cp-client-ws .cp-exec .cp-exec-head [data-route]').click();
  await settle(1400);
  check('الرابط يفتح مركز التنفيذ (نفس الشاشة لا نسخة ثانية)', (await route()) === `executionCenter?clientId=${encodeURIComponent(seeded.clientId)}`, await route());
  await page.waitForSelector('[data-wc] .wc-row', {timeout: 20000});
  const scopedClient = await app(() => ({
    label: document.querySelector('[data-scope-label]')?.textContent?.trim() || '',
    scopeBar: Boolean(document.querySelector('[data-scope-bar]')),
    rows: [...document.querySelectorAll('.wc-row')].map(row => row.dataset.row),
    note: document.querySelector('[data-counter-note]')?.textContent?.trim() || '',
    lanes: document.querySelector('.wc-lane-all b')?.textContent?.trim() || ''
  }));
  check('مركز التنفيذ: شريط النطاق يوضح «مقصور على الموكل» مع اسمه',
    scopedClient.scopeBar && scopedClient.label.includes('الموكل'), scopedClient.label);
  check('الطابور في نطاق الموكل يحتوي تنفيذاته فقط',
    scopedClient.rows.length === 2 && scopedClient.rows.includes(seeded.executionId) && scopedClient.rows.includes(seeded.secondId),
    JSON.stringify(scopedClient.rows));
  check('ملاحظة العدّادات تشرح النطاق وطريقة التوسيع', /نطاق/.test(scopedClient.note), scopedClient.note);
  await shot(page, '04-center-scoped-dark-desktop');
  await page.locator('[data-scope-bar] [data-route="executionCenter"]').click();
  await settle(1500);
  const unscoped = await app(() => ({scopeBar: Boolean(document.querySelector('[data-scope-bar]')), count: document.querySelectorAll('.wc-row').length}));
  check('إزالة النطاق تعيد الطابور الكامل (وسجلات أخرى تظهر)', !unscoped.scopeBar && unscoped.count > 2, JSON.stringify(unscoped));

  /* ============ 7) جودة الوضع الداكن/الفاتح + Desktop/Mobile ============ */
  const setTheme = async preset => {
    await page.evaluate(async name => {
      const theme = await import('/js/ui/theme.js');
      theme.setTheme({preset: name, followSystem: false});
    }, preset);
    await settle(300);
  };
  await setTheme('luxuryGold');
  await go('executionCenter', 1400);
  await page.waitForSelector('[data-wc] .wc-row', {timeout: 20000});
  await shot(page, '05-center-dark-desktop');

  const darkProbe = await contrast([
    '.wc-hero-title', '.wc-hero-step', '.wc-hero-nums b', '.wc-hero-nums span', '.wc-lane-all b',
    '.wc-lane-all span', '.wc-sec-title', '.wc-row .wc-num', '.wc-row-step span:last-child', '.wc-row-money b',
    '.wc-row-money small', '.wc-hero-actions .primary', '.wc-toolbar input[type=search]', '.wc-pulse-item b'
  ]);
  const darkBad = darkProbe.filter(item => !item.missing && item.ratio < 4.5);
  check('الوضع الداكن (Desktop): نصوص مركز التنفيذ تحقق WCAG AA (≥ 4.5)',
    darkBad.length === 0, darkBad.map(item => `${item.selector}=${item.ratio} «${item.text}»`).join(' | ') || `أدنى نسبة ${Math.min(...darkProbe.map(item => item.ratio))}`);
  const darkOverflow = await overflow();
  check('الوضع الداكن (Desktop): لا تمرير أفقي ولا عناصر متجاوزة',
    darkOverflow.doc <= darkOverflow.win + 1 && darkOverflow.offenders.length === 0, JSON.stringify(darkOverflow));

  // نموذج مضمّن + مؤشرات الحالة
  const heroIndicator = await app(() => {
    const hero = document.querySelector('.wc-hero');
    const nums = [...hero.querySelectorAll('.wc-hero-nums > div')].map(node => ({label: node.querySelector('span')?.textContent.trim(), value: node.querySelector('b')?.textContent.trim(), alert: node.classList.contains('is-alert'), color: getComputedStyle(node.querySelector('b')).color}));
    return {nums, severity: hero.className.match(/wc-hero--(\w+)/)?.[1] || '', step: hero.querySelector('.wc-hero-step b')?.textContent.trim() || ''};
  });
  check('بطاقة «الآن» تعرض المتأخر والمدفوع والمتبقي مع تمييز المتأخر بلون الخطر',
    heroIndicator.nums.length === 3 && heroIndicator.nums[0].alert && heroIndicator.nums[0].value !== '—',
    JSON.stringify(heroIndicator.nums));
  await page.locator('[data-hero-host] [data-act]').first().click();
  await settle(400);
  const formOpen = await app(() => {
    const form = document.querySelector('[data-hero-host] form[data-form]');
    if (!form) return {exists: false};
    const style = getComputedStyle(form.querySelector('input') || form);
    return {exists: true, kind: form.dataset.form, fields: form.querySelectorAll('input,select').length, bg: style.backgroundColor, color: style.color, focusable: document.activeElement === form.querySelector('[data-first]')};
  });
  check('النموذج المضمّن يُفتح في مكانه داخل البطاقة مع تركيز أول حقل',
    formOpen.exists && formOpen.fields >= 3 && formOpen.focusable, JSON.stringify(formOpen));
  const formContrast = await contrast(['.wc-form [data-form] label.field', '.wc-form .wc-form-head b', '.wc-form .wc-form-actions .primary', '.wc-form input']);
  const formBad = formContrast.filter(item => !item.missing && item.ratio < 4.5);
  check('الوضع الداكن: نصوص النموذج المضمّن تحقق WCAG AA', formBad.length === 0, formBad.map(item => `${item.selector}=${item.ratio}`).join(' | ') || 'ok');
  await shot(page, '06-center-inline-form-dark-desktop');
  await page.keyboard.press('Escape');
  await settle(300);

  // الأقسام المطوية
  const sectionSummary = page.locator('.wc-sec > summary').first();
  const sectionRow = page.locator('.wc-sec .wc-row').first();
  const sectionName = String(await sectionSummary.textContent() || '').replace(/\s+/g, ' ').trim().slice(0, 24);
  const rowVisibleBefore = await sectionRow.isVisible();
  await sectionSummary.click();
  await settle(350);
  const collapsedState = await app(() => ({open: document.querySelector('.wc-sec').open, total: document.querySelectorAll('.wc-sec').length}));
  const rowVisibleWhenClosed = await sectionRow.isVisible();
  await sectionSummary.click();
  await settle(350);
  const rowVisibleReopened = await sectionRow.isVisible();
  check('أقسام الطابور: العنوان يطوي القسم (يختفي صفّه) ثم يعيد فتحه',
    rowVisibleBefore && collapsedState.open === false && !rowVisibleWhenClosed && rowVisibleReopened,
    `${sectionName} → open=${collapsedState.open} visible: ${rowVisibleBefore}/${rowVisibleWhenClosed}/${rowVisibleReopened} أقسام=${collapsedState.total}`);

  // الحالة الفارغة
  await page.fill('[data-search]', 'zzz-لا-نتائج-6.1');
  await settle(700);
  const emptyState = await app(() => ({empty: document.querySelector('.wc-empty')?.textContent?.replace(/\s+/g, ' ').trim() || '', rows: document.querySelectorAll('.wc-row').length}));
  check('حالة «لا نتائج» واضحة مع نص إرشادي', emptyState.rows === 0 && emptyState.empty.includes('لا نتائج'), emptyState.empty);
  await shot(page, '07-center-empty-dark-desktop');
  await page.fill('[data-search]', '');
  await settle(700);

  // وضع التشغيل (Focus Mode)
  await page.locator('[data-run-start="queue"]').first().click();
  await settle(600);
  const runState = await app(() => ({
    run: Boolean(document.querySelector('.wc-run')), step: Boolean(document.querySelector('[data-run-item]')),
    queueHidden: getComputedStyle(document.querySelector('.wc-main')).display === 'none',
    progress: document.querySelector('.wc-run-progress')?.textContent?.replace(/\s+/g, ' ').trim() || ''
  }));
  check('وضع التشغيل: خطوة واحدة ظاهرة والطابور مخفي مع شريط تقدم',
    runState.run && runState.step && runState.queueHidden && runState.progress.includes('من'), JSON.stringify(runState));
  const runContrast = await contrast(['.wc-run .wc-hero-title', '.wc-run .wc-run-nav .danger', '.wc-run-head b', '.wc-run-progress .wc-run-count b']);
  const runBad = runContrast.filter(item => !item.missing && item.ratio < 4.5);
  check('الوضع الداكن: نصوص وضع التشغيل تحقق WCAG AA', runBad.length === 0, runBad.map(item => `${item.selector}=${item.ratio}`).join(' | ') || 'ok');
  const runOverflow = await overflow();
  check('وضع التشغيل: لا تمرير أفقي', runOverflow.doc <= runOverflow.win + 1, JSON.stringify(runOverflow));
  await shot(page, '08-center-focus-mode-dark-desktop');
  // Esc من داخل حقل النموذج نفسه (الوعد المكتوب في الشريط) يجب أن يخرج من التشغيل
  await page.locator('[data-run-item] form[data-form] [data-first]').click();
  await page.keyboard.press('Escape');
  await settle(600);
  const afterEscape = await app(() => ({run: Boolean(document.querySelector('.wc-run')), mainVisible: getComputedStyle(document.querySelector('.wc-main')).display !== 'none', rows: document.querySelectorAll('.wc-queue .wc-row').length}));
  check('Esc داخل نموذج وضع التشغيل يخرج منه ويعيد الطابور كما هو مكتوب في الشريط',
    !afterEscape.run && afterEscape.mainVisible && afterEscape.rows > 0, JSON.stringify(afterEscape));

  // الوضع الفاتح
  await setTheme('elegantLight');
  await settle(700);
  await shot(page, '09-center-light-desktop');
  const lightProbe = await contrast([
    '.wc-hero-title', '.wc-hero-step', '.wc-hero-nums b', '.wc-hero-nums span', '.wc-lane-all b', '.wc-sec-title',
    '.wc-row .wc-num', '.wc-row-step span:last-child', '.wc-row-money b', '.wc-row-money small', '.wc-pulse-item b', '.wc-toolbar input[type=search]'
  ]);
  const lightBad = lightProbe.filter(item => !item.missing && item.ratio < 4.5);
  check('الوضع الفاتح (Desktop): نصوص مركز التنفيذ تحقق WCAG AA',
    lightBad.length === 0, lightBad.map(item => `${item.selector}=${item.ratio} «${item.text}»`).join(' | ') || `أدنى نسبة ${Math.min(...lightProbe.map(item => item.ratio))}`);
  const lightOverflow = await overflow();
  check('الوضع الفاتح: لا تمرير أفقي', lightOverflow.doc <= lightOverflow.win + 1, JSON.stringify(lightOverflow));

  // سياق الملف/الموكل في الوضع الفاتح
  await go(`file:${seeded.fileId}`, 1100);
  await shot(page, '10-file-strip-light-desktop');
  const lightStrip = await app(() => {
    const strip = document.querySelector('.cp-exec');
    const style = getComputedStyle(strip.querySelector('.cp-exec-text small span'));
    return {bg: getComputedStyle(strip).backgroundColor, color: style.color, rows: strip.querySelectorAll('.cp-exec-main').length};
  });
  check('شريط التنفيذ في الوضع الفاتح: خلفية ونص من متغيرات الثيم (لا ألوان ثابتة)',
    lightStrip.rows === 2 && lightStrip.bg !== 'rgba(0, 0, 0, 0)', JSON.stringify(lightStrip));
  const stripContrast = await contrast(['.cp-exec-title', '.cp-exec-pulse', '.cp-exec-text b', '.cp-exec-text small span', '.cp-exec-money b', '.cp-exec-money small', '.cp-exec-empty']);
  const stripBad = stripContrast.filter(item => !item.missing && item.ratio < 4.5);
  check('الوضع الفاتح: نصوص شريط التنفيذ تحقق WCAG AA', stripBad.length === 0, stripBad.map(item => `${item.selector}=${item.ratio}`).join(' | ') || 'ok');

  // الهاتف (390) داكن و فاتح
  await page.setViewportSize({width: 390, height: 844});
  await setTheme('luxuryGold');
  await go('executionCenter', 1500);
  await page.waitForSelector('[data-wc] .wc-row', {timeout: 20000});
  const mobile = await app(() => {
    const hero = document.querySelector('.wc-hero');
    const row = document.querySelector('.wc-row');
    return {
      heroVisible: hero.getBoundingClientRect().width <= window.innerWidth + 1,
      rowColumns: getComputedStyle(row).gridTemplateColumns,
      minTouch: Math.min(...[...document.querySelectorAll('.wc-row-actions button, .wc-hero-actions button')].map(button => button.getBoundingClientRect().height)),
      navVisible: Boolean(document.querySelector('.wc-row-nav'))
    };
  });
  const mobileOverflow = await overflow();
  check('الهاتف (390): لا تمرير أفقي في مركز التنفيذ',
    mobileOverflow.doc <= mobileOverflow.win + 1 && mobile.heroVisible, JSON.stringify(mobileOverflow));
  check('الهاتف: أزرار الإجراءات بارتفاع لمس معقول (≥ 32px)', mobile.minTouch >= 32, `min=${Math.round(mobile.minTouch)}`);
  await shot(page, '11-center-dark-mobile');
  await go(`file:${seeded.fileId}`, 1200);
  const mobileStrip = await overflow();
  const mobileStripRows = await count('.cp-exec-main');
  check('الهاتف: شريط التنفيذ في الملف بلا تجاوز أفقي',
    mobileStrip.doc <= mobileStrip.win + 1 && mobileStripRows === 2, `${JSON.stringify(mobileStrip)} rows=${mobileStripRows}`);
  await shot(page, '12-file-strip-dark-mobile');
  await go(`cfile:${seeded.clientId}`, 1500);
  const mobileClientStrip = await overflow();
  check('الهاتف: شريط تنفيذ الموكل بلا تجاوز أفقي', mobileClientStrip.doc <= mobileClientStrip.win + 1, JSON.stringify(mobileClientStrip));
  await shot(page, '13-client-strip-dark-mobile');
  await setTheme('elegantLight');
  await go('executionCenter', 1400);
  await page.waitForSelector('[data-wc] .wc-row', {timeout: 20000});
  const mobileLightOverflow = await overflow();
  check('الهاتف (الوضع الفاتح): لا تمرير أفقي', mobileLightOverflow.doc <= mobileLightOverflow.win + 1, JSON.stringify(mobileLightOverflow));
  await shot(page, '14-center-light-mobile');
  await page.setViewportSize({width: 1440, height: 1000});
  await setTheme('luxuryGold');

  /* ============ 8) انحدار المسارات الأساسية ============ */
  await go('executionCenter', 1500);
  await page.waitForSelector('[data-wc] .wc-row', {timeout: 20000});
  await page.waitForFunction(() => /تنفيذ في/.test(document.querySelector('[data-counter-note]')?.textContent || ''), null, {timeout: 20000}).catch(() => null);
  await settle(600);
  // وسم فريد لكل تشغيل: لا يتأثر الفحص بأي أثر من تشغيل سابق.
  const actionLabel = `إجراء فحص 6.1 ${Date.now()}`;
  const before = await app(async () => {
    const S = await import('/js/services/execution-simple.js');
    const office = window.__LAW_OFFICE_APP__.office;
    const id = document.querySelector('.wc-row')?.dataset.row || '';
    const item = (await S.hydrateSimpleRows(office, [await office.r.execution.get(id)]))[0];
    return {id, paid: item?.summary?.paidMinor || 0};
  });
  const beforeActions = await app(async ({id, label}) => {
    const office = window.__LAW_OFFICE_APP__.office;
    const rows = await office.r.executionActions.byIndexAll('executionId', id);
    return rows.filter(row => !row.isDeleted && row.kindLabel === label).length;
  }, {id: before.id, label: actionLabel});
  // Open → Execute → Save (إجراء من الصف نفسه، بلا مغادرة الصفحة)
  await page.locator(`.wc-row[data-row="${before.id}"] [data-act="menu"]`).first().click();
  await page.waitForSelector(`.wc-row[data-row="${before.id}"] [data-from="menu"][data-act="action"]`, {timeout: 10000});
  await page.locator(`.wc-row[data-row="${before.id}"] [data-from="menu"][data-act="action"]`).first().click();
  await page.waitForSelector(`.wc-row[data-row="${before.id}"] form[data-form="action"]`, {timeout: 10000});
  await page.locator(`.wc-row[data-row="${before.id}"] form[data-form="action"] [data-first]`).fill(actionLabel);
  await page.locator(`.wc-row[data-row="${before.id}"] form[data-form="action"]`).evaluate(form => { form.querySelector('[name="nextActionDate"]').value = ''; form.requestSubmit(); });
  // الإشعار يختفي تلقائيًا بعد 3.2 ثانية (js/ui/toast.js duration) — نقرأ نصّه ونضغط «تراجع» فورًا.
  await page.waitForSelector('#toast-stack .toast-act', {timeout: 15000}).catch(() => null);
  const afterSaveToast = await app(() => document.querySelector('#toast-stack .toast')?.textContent?.replace(/\s+/g, ' ').trim() || '');
  const afterSave = await app(async ({id, label}) => {
    const office = window.__LAW_OFFICE_APP__.office;
    const rows = await office.r.executionActions.byIndexAll('executionId', id);
    return {
      actions: rows.filter(row => !row.isDeleted && row.kindLabel === label).length,
      stillListed: Boolean(document.querySelector(`.wc-row[data-row="${id}"]`)),
      pageKept: window.__LAW_OFFICE_APP__.route
    };
  }, {id: before.id, label: actionLabel});
  check('Open → Execute → Save: الإجراء يُسجَّل من الصف ويعاد حساب الحالة بلا مغادرة',
    beforeActions === 0 && afterSave.actions === 1 && afterSave.pageKept === 'executionCenter' && /تسجيل الإجراء|تم/.test(afterSaveToast),
    `before=${beforeActions} after=${afterSave.actions} route=${afterSave.pageKept} toast=«${afterSaveToast.slice(0, 40)}»`);
  // Undo (Soft Delete): نضغط الزر الآن ثم نستطلع قاعدة البيانات بدل انتظار ثابت
  await page.locator('#toast-stack .toast', {hasText: 'تم تسجيل الإجراء'}).last().locator('.toast-act').click({timeout: 8000}).catch(() => null);
  // الشطب المنطقي يُبقي الصف قارئًا في السجل: الحالة status='voided' وisDeleted تبقى false — المعيار هو الحالة لا الحذف.
  const afterUndo = await app(async ({id, label}) => {
    const office = window.__LAW_OFFICE_APP__.office;
    const snapshot = async () => {
      const rows = await office.r.executionActions.byIndexAll('executionId', id);
      return {live: rows.filter(row => row.kindLabel === label && row.status !== 'voided').length, voided: rows.filter(row => row.kindLabel === label && row.status === 'voided').length};
    };
    for (let i = 0; i < 40; i++) {
      const state = await snapshot();
      if (state.voided === 1 && state.live === 0) return state;
      await new Promise(res => setTimeout(res, 150));
    }
    return snapshot();
  }, {id: before.id, label: actionLabel});
  check('Undo: التراجع يشطب السجل (Soft Delete) ولا يحذفه', afterUndo.live === 0 && afterUndo.voided === 1, JSON.stringify(afterUndo));
  // File → Client → Home من سياق التنفيذ
  await go(`exc:${seeded.executionId}`, 1400);
  const cardLinks = await app(() => ({
    title: document.querySelector('#page-title')?.textContent?.trim() || '',
    toFile: Boolean(document.querySelector(`#main-content [data-route="file:${window.__LAW_OFFICE_APP__.__qaFileId || ''}"]`))
  }));
  await go(`file:${seeded.fileId}`, 1000);
  const fileOk = (await text('#page-title')).includes('الملف') || (await count('.cp-exec-main')) === 2;
  await go(`cfile:${seeded.clientId}`, 1500);
  const clientOk = (await count('.cp-exec-main')) === 2;
  await go('dashboard', 1200);
  const homeOk = (await count('.cp-focus')) === 1 && (await count('[data-attn-list] .cp-row')) > 0;
  check('التنقل: التنفيذ ← الملف ← الموكل ← الرئيسية تعمل بلا خطأ',
    fileOk && clientOk && homeOk && cardLinks.title.includes('التنفيذ'), `file=${fileOk} client=${clientOk} home=${homeOk} card=«${cardLinks.title}»`);
  const finalErrors = report.consoleErrors.filter(error => !/ResizeObserver|ERR_ABORTED/.test(error));
  check('لا أخطاء JavaScript في كل المسارات المفحوصة', finalErrors.length === 0, finalErrors.slice(0, 4).join(' | ') || 'نظيف');

  /* ============ 9) التنظيف: لا بيانات اختبار في بيانات المستخدم ============ */
  const cleanup = await cleanupDemoData();
  check('التنظيف: كل بيانات الفحص التجريبية حُذفت من قاعدة البيانات',
    cleanup.after === 0 && cleanup.removed > 0, JSON.stringify(cleanup));
  await go('dashboard', 1200);
  const dashboardAfterCleanup = await app(() => ({
    exec0: !document.querySelector('.cp-row-main[data-route^="exc:"]'),
    focus: document.querySelector('#cp-focus-title')?.textContent?.trim() || ''
  }));
  check('بعد التنظيف: لا صفوف تنفيذ في الرئيسية و«الآن» يعمل طبيعيًا',
    dashboardAfterCleanup.exec0 && dashboardAfterCleanup.focus.length > 0, JSON.stringify(dashboardAfterCleanup));
} catch (error) {
  report.failures.push({name: 'استثناء غير متوقع', detail: String(error?.stack || error)});
  console.log('FAIL — استثناء غير متوقع:', error?.message || error);
  // التنظيف لا يتوقف على نجاح الفحص: لا تُترك بيانات اختبار في قاعدة بيانات المستخدم.
  try {
    const rescued = await cleanupDemoData();
    check('التنظيف بعد توقف مفاجئ: لا سجلات اختبار باقية', rescued.after === 0, JSON.stringify(rescued));
  } catch (cleanupError) {
    check('التنظيف بعد توقف مفاجئ', false, String(cleanupError?.message || cleanupError));
  }
} finally {
  await fs.writeFile(path.join(artifactDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  await browser.close();
}

console.log('\n================ WAVE 6.1 CONTEXT QA ================');
console.log(`نجحت: ${report.checks.length} · فشلت: ${report.failures.length}`);
for (const failure of report.failures) console.log(`  ✗ ${failure.name} — ${failure.detail}`);
console.log(`أدلة: ${path.relative(repository, artifactDir)}`);
process.exit(report.failures.length ? 1 : 0);
