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

  let contextFx = null;
  await check('سياق الملاحظة: فتح الموكل والملف والقضية والتنفيذ؛ ومن سجل الطرف إلى الخصم، مع إظهار المراجع المحذوفة بلا رابط', async () => {
    contextFx = await page.evaluate(async () => {
      const office = window.__LAW_OFFICE_APP__.office;
      const {createLegalFile, saveParty} = await import('/js/services/legal-files.js');
      const {saveEntity} = await import('/js/services/entity-save.js');
      const {createSimpleExecution} = await import('/js/services/execution-simple.js');
      const {saveQuickNote} = await import('/js/services/quick-notes.js');
      const client = await office.saveClient({fullName: `موكل سياق الملاحظات ${Date.now()}`});
      const file = await createLegalFile(office, {clientId: client.id, title: 'ملف سياق الملاحظات', fileType: 'مدني'});
      const stage = await office.createCase({fileId: file.id, stageType: 'دعوى', caseNumber: 'QN-CONTEXT', caseYear: '2026'});
      const opponent = await saveEntity(office, 'opponents', {name: `خصم سياق الملاحظات ${Date.now()}`});
      const party = await saveParty(office, {fileId: file.id, partyKind: 'opponent', opponentId: opponent.id, role: 'مدعى عليه'});
      const execution = await createSimpleExecution(office, {clientId: client.id, fileId: file.id, executionType: 'civil', valueType: 'fixed', amount: 1500, judgmentDate: '2026-10-11', entitlementThroughDate: '2026-10-11', officialNumber: 'QN-CONTEXT-EXEC'});
      const note = await saveQuickNote(office, {title: `QN_CONTEXT_${Date.now()}`, content: 'ملاحظة مرتبطة بسجلات فعلية'}, {links: [
        {entityType: 'CLIENT', entityId: client.id}, {entityType: 'LEGAL_FILE', entityId: file.id},
        {entityType: 'CASE', entityId: stage.id}, {entityType: 'PARTY', entityId: party.id},
        {entityType: 'EXECUTION', entityId: execution.execution.id}
      ]});
      return {clientId: client.id, fileId: file.id, caseId: stage.id, opponentId: opponent.id, opponentName: opponent.name, partyId: party.id, executionId: execution.execution.id, noteId: note.id, noteTitle: note.title};
    });
    const showContextNote = async () => {
      await go('quickNotes');
      await page.selectOption('[data-quick-status]', 'ALL');
      await page.locator('[data-quick-query]').fill(contextFx.noteTitle);
      await waitQuick();
      assert(await card(contextFx.noteId).count() === 1, 'بطاقة السياق غير ظاهرة');
    };
    const followRouteAndBack = async (route, selector) => {
      await showContextNote();
      const button = card(contextFx.noteId).locator(`[data-qn-open-context="${route}"]`);
      assert(await button.count() === 1, `رابط السياق غير ظاهر: ${route}`);
      await button.click();
      await page.waitForFunction(value => String(window.__LAW_OFFICE_APP__.route || '').split('?')[0] === value, route, {timeout: 15000});
      await page.waitForSelector(selector, {timeout: 15000});
      if(route===`exc:${contextFx.executionId}`){
        const contextNav=page.locator('.exec-head .record-context-links');
        assert(await contextNav.locator(`[data-route="client:${contextFx.clientId}"]`).count()===1,'رابط الموكل من بطاقة التنفيذ غير ظاهر');
        assert(await contextNav.locator(`[data-route="file:${contextFx.fileId}"]`).count()===1,'رابط الملف من بطاقة التنفيذ غير ظاهر');
      }
      await page.evaluate(() => window.__LAW_OFFICE_APP__.back());
      await page.waitForSelector('#quick-notes-root', {timeout: 15000});
      await page.waitForFunction(() => String(window.__LAW_OFFICE_APP__.route || '').split('?')[0] === 'quickNotes', null, {timeout: 15000});
    };
    await followRouteAndBack(`client:${contextFx.clientId}`, '.record-head h2');
    await followRouteAndBack(`file:${contextFx.fileId}`, '#file-head');
    await followRouteAndBack(`case:${contextFx.caseId}`, '.record-head h2');
    await followRouteAndBack(`exc:${contextFx.executionId}`, '.exec-head');

    await showContextNote();
    await card(contextFx.noteId).locator(`[data-qn-open-context="rec:fileParties:${contextFx.partyId}"]`).click();
    await page.waitForFunction(id => window.__LAW_OFFICE_APP__.route === `rec:fileParties:${id}`, contextFx.partyId, {timeout: 15000});
    await page.waitForSelector('.record-head .record-context-links', {timeout: 15000});
    const opponentLink = page.locator(`.record-context-links [data-open-ref="opponents:${contextFx.opponentId}"]`);
    assert(await opponentLink.count() === 1, 'رابط الخصم من سجل الطرف غير ظاهر');
    await opponentLink.click();
    await page.waitForFunction(id => window.__LAW_OFFICE_APP__.route === `opponent:${id}`, contextFx.opponentId, {timeout: 15000});
    assert((await page.locator('.record-head').textContent()).includes(contextFx.opponentName), 'صفحة الخصم لم تعرض اسم السجل المرتبط');
    await page.evaluate(() => window.__LAW_OFFICE_APP__.back());
    await page.waitForFunction(id => window.__LAW_OFFICE_APP__.route === `rec:fileParties:${id}`, contextFx.partyId, {timeout: 15000});
    await page.evaluate(() => window.__LAW_OFFICE_APP__.back());
    await page.waitForFunction(() => String(window.__LAW_OFFICE_APP__.route || '').split('?')[0] === 'quickNotes', null, {timeout: 15000});

    await page.evaluate(id => window.__LAW_OFFICE_APP__.office.softDelete('opponents', id), contextFx.opponentId);
    await page.evaluate(id => window.__LAW_OFFICE_APP__.go(`rec:fileParties:${id}`), contextFx.partyId);
    await page.waitForSelector('.record-head .record-context-links .record-context-unavailable', {timeout: 15000});
    assert(await page.locator(`.record-context-links [data-open-ref="opponents:${contextFx.opponentId}"]`).count() === 0, 'لم يُخفَ رابط الخصم المحذوف');
    assert((await page.locator('.record-context-links').textContent()).includes('السجل المرتبط غير متاح حاليًا'), 'لم تظهر حالة الخصم غير المتاح');
    assert(await page.locator(`.kv [data-open-ref="opponents:${contextFx.opponentId}"]`).count() === 0, 'ظهر رابط الخصم المحذوف داخل تفاصيل الطرف');
    await page.evaluate(id => window.__LAW_OFFICE_APP__.go(`file:${id}`), contextFx.fileId);
    await page.waitForSelector('#file-head');
    const deletedPartyChip=page.locator('#file-head [data-party-open]').filter({hasText:contextFx.opponentName}).first();
    await deletedPartyChip.click();
    await page.waitForSelector('#modal-root .modal-card');
    assert(await page.locator('#modal-root [data-a="open"]').count() === 0, 'لم يُعرض زر لخصم محذوف');
    assert((await page.locator('#modal-root .modal-card').textContent()).includes('الشخص المرتبط غير متاح حاليًا'), 'لم تظهر حالة الخصم غير المتاح داخل نافذة الأطراف');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#modal-root .modal-card',{state:'detached'});
    await go('quickNotes');
  });

  const uiTitle = `QN_BROWSER_UI_${Date.now()}`;
  const unsafeText = 'نص <img src=x onerror=alert(1)> محلي';
  let uiId = '';
  await check('Ctrl+Shift+N ignores typing fields, and outside them opens capture and saves plain text safely', async () => {
    const searchField=page.locator('[data-quick-query]');
    await searchField.focus();
    await page.keyboard.press('Control+k');
    assert(await page.locator('.palette-card').count()===0,'Ctrl+K فتح لوحة الأوامر أثناء الكتابة في حقل البحث');
    await page.keyboard.press('Control+Shift+N');
    assert(await page.locator('.modal-card [data-qn-form]').count()===0,'Ctrl+Shift+N فتح الالتقاط بينما التركيز داخل حقل البحث');
    await searchField.evaluate(input=>input.blur());
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

  await check('Trash exposes confirmed per-note permanent deletion and the empty-trash action', async () => {
    const purgeTitle = `QN_BROWSER_PURGE_${Date.now()}`;
    const purgeId = await page.evaluate(async title => {
      const {saveQuickNote, deleteQuickNote} = await import('/js/services/quick-notes.js');
      const office = window.__LAW_OFFICE_APP__.office;
      const note = await saveQuickNote(office, {title, content: 'ملاحظة اختبار للحذف النهائي'});
      await deleteQuickNote(office, note.id);
      return note.id;
    }, purgeTitle);
    await go('quickNotes');
    await page.locator('[data-quick-query]').fill(purgeTitle);
    await page.selectOption('[data-quick-status]', 'TRASH');
    await waitQuick();
    const noteCard = card(purgeId);
    assert(await noteCard.count() === 1, 'الملاحظة المحذوفة لا تظهر في السلة');
    assert(await noteCard.locator('[data-note-action="purge"]').textContent() === 'حذف نهائي', 'زر الحذف النهائي غير موجود في بطاقة السلة');
    assert(await page.locator('[data-quick-empty-trash]').isVisible(), 'زر إفراغ السلة النهائي غير ظاهر');
    await noteCard.locator('[data-note-action="purge"]').click();
    await page.waitForSelector('.modal-card [data-ok]');
    assert((await page.locator('.modal-card').textContent()).includes('لا يمكن استعادتها'), 'تأكيد الحذف النهائي لا يوضح أنه غير قابل للاستعادة');
    await page.locator('.modal-card [data-ok]').click();
    await page.waitForFunction(async id => !(await window.__LAW_OFFICE_APP__.office.r.caseNotes.getManyRaw([id])).length, purgeId, {timeout: 10000});
    await card(purgeId).waitFor({state: 'detached', timeout: 10000});
    assert(await card(purgeId).count() === 0, 'الملاحظة المحذوفة نهائيًا ما زالت ظاهرة');

    const emptyTitle = `QN_BROWSER_EMPTY_TRASH_${Date.now()}`;
    const emptyId = await page.evaluate(async title => {
      const {saveQuickNote, deleteQuickNote} = await import('/js/services/quick-notes.js');
      const office = window.__LAW_OFFICE_APP__.office;
      const note = await saveQuickNote(office, {title, content: 'اختبار إفراغ السلة'});
      await deleteQuickNote(office, note.id);
      return note.id;
    }, emptyTitle);
    await page.locator('[data-quick-query]').fill(emptyTitle);
    await page.selectOption('[data-quick-status]', 'TRASH');
    await waitQuick();
    assert(await card(emptyId).count() === 1, 'الملاحظة المحذوفة لا تظهر قبل إفراغ السلة');
    await page.locator('[data-quick-empty-trash]').click();
    await page.waitForSelector('.modal-card [data-ok]');
    assert((await page.locator('.modal-card').textContent()).includes('بلا إمكانية استعادة'), 'تأكيد إفراغ السلة لا يوضح الأثر النهائي');
    await page.locator('.modal-card [data-ok]').click();
    await page.waitForFunction(async id => !(await window.__LAW_OFFICE_APP__.office.r.caseNotes.getManyRaw([id])).length, emptyId, {timeout: 10000});
    await card(emptyId).waitFor({state: 'detached', timeout: 10000});
  });

  await check('Ctrl+K opens the Command Center, stays out of typing fields, and opens Quick Capture', async () => {
    await go('dashboard');
    await page.keyboard.press('Control+k');
    const paletteQuery=page.locator('.pal-q');
    await paletteQuery.waitFor({state:'visible'});
    await paletteQuery.focus();
    await page.keyboard.press('Control+k');
    assert(await paletteQuery.isVisible(),'Ctrl+K أغلق لوحة الأوامر أثناء الكتابة في حقل البحث');
    await paletteQuery.fill('ملاحظة سريعة');
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
    await page.waitForSelector('.ftb-group[data-group="gRecords"] .ftb-group-btn');
    await page.click('.ftb-group[data-group="gRecords"] .ftb-group-btn');
    await page.waitForSelector('.ftb-group[data-group="gRecords"] [data-tab="notes"]:visible');
    await page.click('.ftb-group[data-group="gRecords"] [data-tab="notes"]');
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
