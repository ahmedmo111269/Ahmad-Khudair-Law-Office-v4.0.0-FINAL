// Chromium verification for the Quick Notes surface: capture entry points, context links,
// safe rendering, lifecycle/trash actions, cursor pagination and manual drag ordering.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {chromium} from 'playwright';

const repository = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const configuredBase = process.env.QN_BASE_URL || process.env.GRID_BASE_URL || '';
const mime = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json'};
let server = null;
let base = configuredBase.replace(/\/$/, '');
if (!base) {
  server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const file = path.resolve(repository, relative);
      if (!file.startsWith(repository + path.sep) && file !== path.join(repository, 'index.html')) { res.writeHead(403).end(); return; }
      const body = await readFile(file);
      res.writeHead(200, {'content-type': mime[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store'});
      res.end(body);
    } catch { res.writeHead(404).end('not found'); }
  });
  await new Promise(resolve => server.listen(0, '0.0.0.0', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
}

const report = {scenario: 'quick-notes-ui', base, checks: [], failures: [], consoleErrors: [], status: 'NOT RUN'};
const check = async (name, fn) => {
  try { await fn(); report.checks.push({name, status: 'VERIFIED — Chromium'}); console.log(`VERIFIED — ${name}`); }
  catch (error) { report.failures.push({name, detail: String(error?.stack || error).slice(0, 1200)}); console.log(`FAILED — ${name}\n  ${String(error?.message || error)}`); }
};
const assert = (condition, message) => { if (!condition) throw new Error(message); };

let browser;
try {
  if (process.env.GRID_BROWSER_EXECUTABLE || process.env.QN_BROWSER_EXECUTABLE) {
    browser = await chromium.launch({executablePath: process.env.QN_BROWSER_EXECUTABLE || process.env.GRID_BROWSER_EXECUTABLE, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage']});
  } else {
    const {default: slim, inflate} = await import('@sparticuz/chromium');
    const require = createRequire(import.meta.url);
    await inflate(path.resolve(path.dirname(require.resolve('@sparticuz/chromium')), '../bin/al2023.tar.br'));
    process.env.LD_LIBRARY_PATH = [path.join(process.env.TMPDIR || '/tmp', 'al2023', 'lib'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');
    browser = await chromium.launch({executablePath: await slim.executablePath(), headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage']});
  }
  report.browser = browser.version();
  const context = await browser.newContext({viewport: {width: 1280, height: 900}, serviceWorkers: 'block', locale: 'ar-EG'});
  const page = await context.newPage();
  page.on('pageerror', error => report.consoleErrors.push(`PAGEERROR ${error.message}`));
  page.on('console', message => { if (message.type() === 'error' && !/ERR_CONNECTION|ERR_INTERNET|fonts\.(googleapis|gstatic)|net::ERR_/.test(message.text())) report.consoleErrors.push(`CONSOLE ${message.text()}`); });

  const waitQuick = async () => {
    await page.waitForSelector('#quick-notes-root', {timeout: 30000});
    await page.waitForFunction(() => document.querySelector('[data-quick-list]')?.getAttribute('aria-busy') === 'false', null, {timeout: 30000});
    // Input changes are debounced by the UI; wait past that debounce as well
    // as the IndexedDB read so the assertion never inspects the previous page.
    await page.waitForTimeout(360);
  };
  const go = async route => { await page.evaluate(value => window.__LAW_OFFICE_APP__.go(value), route); if (route === 'quickNotes') await waitQuick(); };
  const closeModal = async () => { if (await page.locator('#modal-root .modal-card').count()) { await page.locator('#modal-root [data-qn-cancel],#modal-root [data-cancel]').first().click(); await page.waitForTimeout(100); } };
  const rowById = id => page.evaluate(async noteId => (await window.__LAW_OFFICE_APP__.office.r.caseNotes.getManyRaw([noteId]))[0] || null, id);
  const card = id => page.locator(`.qn-card[data-note-id="${id}"]`);

  await page.goto(`${base}/index.html`, {waitUntil: 'domcontentloaded'});
  await page.waitForFunction(() => window.__LAW_OFFICE_APP__ && !window.__LAW_OFFICE_APP__.booting && window.__LAW_OFFICE_APP__.office, null, {timeout: 90000});

  await check('Quick Notes page renders RTL with list, filters and agenda panels open by default', async () => {
    await go('quickNotes');
    const state = await page.evaluate(() => ({dir: document.querySelector('#quick-notes-root')?.dir, list: document.querySelector('.quick-notes-list-panel')?.classList.contains('card-collapsed'), side: document.querySelector('.quick-notes-side')?.classList.contains('card-collapsed'), toolbar: document.querySelector('.quick-notes-toolbar')?.classList.contains('card-collapsed')}));
    assert(state.dir === 'rtl', 'الواجهة ليست RTL');
    assert(!state.list && !state.side && !state.toolbar, 'أحد أقسام Quick Notes مخفي افتراضيًا');
  });

  const uiTitle = `QN_BROWSER_UI_${Date.now()}`;
  const unsafeText = 'نص <img src=x onerror=alert(1)> محلي';
  let uiId = '';
  await check('Ctrl+Shift+N opens the capture modal and saves plain text without HTML injection', async () => {
    await page.keyboard.press('Control+Shift+N');
    await page.waitForSelector('.modal-card [data-qn-form]');
    const form = page.locator('.modal-card [data-qn-form]');
    await form.locator('[name=title]').fill(uiTitle);
    await form.locator('[name=content]').fill(unsafeText);
    await form.locator('[name=priority]').selectOption('HIGH');
    await form.locator('[name=tagIds]').fill('واجهة، اختبار');
    await form.locator('[name=checklistText]').fill('[ ] مراجعة المستند\n[x] إرسال الموعد');
    await form.locator('button[type=submit]').click();
    await page.waitForSelector('#modal-root .modal-card', {state: 'detached', timeout: 30000});
    await page.waitForTimeout(300);
    const row = await page.evaluate(async title => {
      const result = await window.__LAW_OFFICE_APP__.office.r.caseNotes.page({index: 'updatedAt', direction: 'prev', limit: 100, includeDeleted: true});
      return result.items.find(item => item.title === title) || null;
    }, uiTitle);
    assert(row?.content === unsafeText && row?.contentFormat === 'plain', 'لم تُحفظ قيمة النص الخام بصيغة plain');
    assert(row?.checklist?.length === 2 && row.checklist[1].done === true, 'قائمة التحقق لم تحفظ البنود وحالتها');
    uiId = row.id;
    await page.selectOption('[data-quick-status]', 'ALL');
    await page.locator('[data-quick-query]').fill(uiTitle);
    await waitQuick();
    const noteCard = card(uiId);
    assert(await noteCard.count() === 1, 'بطاقة الملاحظة غير ظاهرة');
    assert(await noteCard.locator('.qn-body img').count() === 0, 'تم إنشاء عنصر HTML من محتوى غير موثوق');
    assert((await noteCard.locator('.qn-body').textContent()).includes(unsafeText), 'النص المعروض تغيّر أو لم يظهر');
    assert(await noteCard.locator('.qn-check-item input').count() === 2, 'قائمة التحقق غير ظاهرة في البطاقة');
    await noteCard.locator('.qn-check-item input').first().check();
    await page.waitForFunction(async id => (await window.__LAW_OFFICE_APP__.office.r.caseNotes.get(id))?.checklist?.[0]?.done === true, uiId, {timeout: 10000});
  });

  await check('Quick Notes edit, star, complete, soft-delete, trash and restore work through the UI', async () => {
    const noteCard = card(uiId);
    await noteCard.locator('[data-note-action="star"]').click();
    await page.waitForFunction(async id => (await window.__LAW_OFFICE_APP__.office.r.caseNotes.get(id))?.isStarred === true, uiId, {timeout: 10000});
    await noteCard.locator('[data-note-action="open"]').first().click();
    await page.waitForSelector('.modal-card [data-qn-form]');
    await page.locator('.modal-card [name=title]').fill(`${uiTitle}_EDITED`);
    await page.locator('.modal-card button[type=submit]').click();
    await page.waitForSelector('#modal-root .modal-card', {state: 'detached'});
    await page.waitForFunction(async id => (await window.__LAW_OFFICE_APP__.office.r.caseNotes.get(id))?.title.endsWith('_EDITED'), uiId, {timeout: 10000});
    await card(uiId).locator('[data-note-action="complete"]').click();
    await page.waitForFunction(async id => (await window.__LAW_OFFICE_APP__.office.r.caseNotes.get(id))?.lifecycle === 'DONE', uiId, {timeout: 10000});
    await card(uiId).locator('[data-note-action="delete"]').click();
    await page.waitForSelector('.modal-card [data-ok]');
    await page.locator('.modal-card [data-ok]').click();
    await page.waitForFunction(async id => (await window.__LAW_OFFICE_APP__.office.r.caseNotes.getManyRaw([id]))[0]?.isDeleted === true, uiId, {timeout: 10000});
    await page.locator('[data-quick-query]').fill('');
    await waitQuick();
    await page.selectOption('[data-quick-status]', 'TRASH');
    await waitQuick();
    assert(await card(uiId).count() === 1, 'الملاحظة لا تظهر في السلة');
    await card(uiId).locator('[data-note-action="restore"]').click();
    await page.waitForFunction(async id => (await window.__LAW_OFFICE_APP__.office.r.caseNotes.getManyRaw([id]))[0]?.isDeleted === false, uiId, {timeout: 10000});
  });

  await check('Command Center opens Quick Capture', async () => {
    await go('dashboard');
    await page.click('#command-btn');
    await page.waitForSelector('.pal-q');
    await page.locator('.pal-q').fill('ملاحظة سريعة');
    await page.waitForSelector('.pal-item');
    await page.locator('.pal-item').filter({hasText: 'Ctrl+Shift+N'}).first().click();
    await page.waitForSelector('.modal-card [data-qn-form]');
    await closeModal();
  });

  let fileId = '';
  await check('A file context is shown as an approved, checked proposal in the capture modal', async () => {
    fileId = await page.evaluate(async () => (await window.__LAW_OFFICE_APP__.office.r.files.page({index: 'createdAt', direction: 'next', limit: 1})).items[0]?.id || '');
    assert(fileId, 'لم يوجد ملف زرعته بيانات الاختبار');
    await go(`file:${fileId}`);
    await page.waitForSelector('[data-tab="notes"]');
    await page.click('[data-tab="notes"]');
    await page.waitForSelector('[data-quick-file-add]');
    await page.click('[data-quick-file-add]');
    await page.waitForSelector('.modal-card [data-qn-form]');
    const contextBox = page.locator(`.modal-card input[name="contextLink"][value="LEGAL_FILE::${fileId}"]`);
    assert(await contextBox.count() === 1 && await contextBox.isChecked(), 'السياق الحالي لم يظهر كمقترح معتمد مبدئيًا');
    await closeModal();
  });

  const pagePrefix = `QN_BROWSER_PAGE_${Date.now()}_`;
  const dragPrefix = `QN_BROWSER_DRAG_${Date.now()}_`;
  await page.evaluate(async ({pagePrefix, dragPrefix}) => {
    const {saveQuickNote} = await import('/js/services/quick-notes.js');
    const office = window.__LAW_OFFICE_APP__.office;
    for (let index = 0; index < 45; index += 1) await saveQuickNote(office, {title: `${pagePrefix}${index}`, content: `pagination ${index}`});
    for (let index = 0; index < 3; index += 1) await saveQuickNote(office, {title: `${dragPrefix}${index}`, content: `drag ${index}`});
  }, {pagePrefix, dragPrefix});

  await check('Quick Notes pagination loads a second cursor page without duplicating the first page', async () => {
    await go('quickNotes');
    await page.selectOption('[data-quick-status]', 'ALL');
    await page.selectOption('[data-quick-sort]', 'manual');
    await page.locator('[data-quick-query]').fill(pagePrefix);
    await waitQuick();
    const firstCount = await page.locator('.qn-card').count();
    assert(firstCount === 40, `عدد الصفحة الأولى ${firstCount} وليس 40`);
    assert(await page.locator('[data-quick-more]').isVisible(), 'زر تحميل المزيد غير ظاهر');
    await page.click('[data-quick-more]');
    await page.waitForFunction(count => document.querySelectorAll('.qn-card').length > count, firstCount, {timeout: 30000});
    const secondCount = await page.locator('.qn-card').count();
    assert(secondCount === 45, `بعد الصفحة الثانية ظهر ${secondCount} صفًا`);
    assert(await page.locator('[data-quick-more]').isHidden(), 'زر تحميل المزيد بقي ظاهرًا رغم اكتمال النتائج');
    assert(new Set(await page.locator('.qn-card').evaluateAll(nodes => nodes.map(node => node.dataset.noteId))).size === 45, 'تداخلت نتائج pagination');
  });

  await check('Manual drag ordering changes the persisted order of the visible notes', async () => {
    await page.locator('[data-quick-query]').fill(dragPrefix);
    await waitQuick();
    assert(await page.locator('.qn-card').count() === 3, 'ملاحظات السحب التجريبية غير معزولة بالبحث');
    const before = await page.locator('.qn-card').evaluateAll(nodes => nodes.map(node => node.dataset.noteId));
    const beforeKeys = await page.evaluate(async ids => (await window.__LAW_OFFICE_APP__.office.r.caseNotes.getManyRaw(ids)).map(row => row.sortKey), before);
    await page.evaluate(() => {
      const cards = [...document.querySelectorAll('[data-quick-list] .qn-card')];
      const source = cards[0], target = cards[2];
      const dataTransfer = new DataTransfer();
      source.dispatchEvent(new DragEvent('dragstart', {bubbles: true, cancelable: true, dataTransfer}));
      target.dispatchEvent(new DragEvent('dragover', {bubbles: true, cancelable: true, dataTransfer}));
      target.dispatchEvent(new DragEvent('drop', {bubbles: true, cancelable: true, dataTransfer}));
      source.dispatchEvent(new DragEvent('dragend', {bubbles: true, cancelable: true, dataTransfer}));
    });
    await page.waitForFunction(async ({ids, beforeKeys}) => {
      const rows = await window.__LAW_OFFICE_APP__.office.r.caseNotes.getManyRaw(ids);
      const keys = rows.map(row => row.sortKey);
      return keys.some((key, index) => key !== beforeKeys[index]);
    }, {ids: before, beforeKeys}, {timeout: 10000});
    const after = await page.locator('.qn-card').evaluateAll(nodes => nodes.map(node => node.dataset.noteId));
    assert(after[0] === before[1] && after[1] === before[2] && after[2] === before[0], `ترتيب السحب غير متوقع؛ قبل: ${before} بعد: ${after}`);
    const persisted = await page.evaluate(async ids => {
      const rows = await window.__LAW_OFFICE_APP__.office.r.caseNotes.getManyRaw(ids);
      return rows.map(row => row.sortKey);
    }, after);
    assert(new Set(persisted).size === 3, 'مفاتيح الترتيب المتجاورة ليست فريدة');
  });

  await check('Mobile Quick Notes remains RTL, exposes the shell FAB and has no horizontal overflow', async () => {
    await page.setViewportSize({width: 390, height: 844});
    await go('quickNotes');
    const metrics = await page.evaluate(() => ({dir: document.querySelector('#quick-notes-root')?.dir, fab: getComputedStyle(document.querySelector('#quick-note-fab')).display !== 'none', width: document.documentElement.scrollWidth, viewport: window.innerWidth}));
    assert(metrics.dir === 'rtl' && metrics.fab, 'FAB أو RTL غير متاح على الهاتف');
    assert(metrics.width <= metrics.viewport + 1, `تمرير أفقي: ${metrics.width} > ${metrics.viewport}`);
    await page.click('#quick-note-fab');
    await page.waitForSelector('.modal-card [data-qn-form]');
    await closeModal();
  });

  report.status = report.failures.length ? 'FAIL' : 'PASS';
  if (report.consoleErrors.length) report.failures.push({name: 'No unexpected JavaScript errors', detail: JSON.stringify(report.consoleErrors)});
  if (report.failures.length) report.status = 'FAIL';
  console.log(JSON.stringify(report, null, 2));
  await context.close();
} catch (error) {
  report.status = 'FAIL';
  report.failures.push({name: 'quick-notes browser harness', detail: String(error?.stack || error)});
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
}
if (report.failures.length) process.exitCode = 1;
