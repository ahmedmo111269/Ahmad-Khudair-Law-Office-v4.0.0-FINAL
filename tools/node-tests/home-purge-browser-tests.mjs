// =====================================================================
// فحص متصفح حقيقي لـ«مكتب اليوم»: إزالة قسم «آخر التحركات» وقسم «تنظيف نهائي»:
// - حذف ملاحظات السلة نهائيًا (مع تأكيد، وإلغاء لا يحذف شيئًا، والملاحظات خارج السلة تبقى).
// - حذف المهام المنجزة نهائيًا (مع تعليقاتها، والمهام غير المنجزة تبقى).
// البيانات تُزرع عبر الخدمات الرسمية داخل المتصفح، وتُحذف عبر الأزرار نفسها.
// التشغيل: node home-purge-browser-tests.mjs  (أو GRID_BASE_URL + GRID_BROWSER_EXECUTABLE)
// =====================================================================
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const repository = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const mime = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json'};
let server = null;
let base = (process.env.GRID_BASE_URL || '').replace(/\/$/, '');
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
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
}

const failures = [];
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({name, ok: Boolean(ok)});
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

const context = await browser.newContext({viewport: {width: 1280, height: 900}, serviceWorkers: 'block', locale: 'ar-EG'});
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(error.message));

const settle = (ms = 400) => page.waitForTimeout(ms);
// الأعداد تُنسَّق بالأرقام الهندية (٢)؛ نحوّلها إلى ASCII قبل المقارنة.
const ascii = s => String(s ?? '').replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
const go = async (route) => {
  await page.evaluate(r => window.__LAW_OFFICE_APP__.go(r), route);
  await page.waitForSelector('[data-purge-notes-count]', {timeout: 30000});
  await page.waitForFunction(() => document.querySelector('[data-purge-notes-count]')?.textContent?.trim() !== 'جارٍ الحساب…', null, {timeout: 30000});
  await settle(300);
};
const countText = async () => page.evaluate(() => ({
  notes: document.querySelector('[data-purge-notes-count]')?.textContent?.trim(),
  tasks: document.querySelector('[data-purge-tasks-count]')?.textContent?.trim(),
  notesDisabled: document.querySelector('[data-purge-notes]')?.disabled,
  tasksDisabled: document.querySelector('[data-purge-tasks]')?.disabled
}));
const confirmModal = async (accept) => {
  await page.waitForSelector('#modal-root [data-ok],#modal-root [data-cancel]', {timeout: 10000});
  await page.locator(accept ? '#modal-root [data-ok]' : '#modal-root [data-cancel]').first().click();
  await settle(500);
};

try {
  await page.goto(`${base}/index.html`, {waitUntil: 'domcontentloaded'});
  await page.waitForFunction(() => window.__LAW_OFFICE_APP__ && !window.__LAW_OFFICE_APP__.booting && window.__LAW_OFFICE_APP__.office, null, {timeout: 90000});
  await go('dashboard');

  // 1) قسم «آخر التحركات» أُزيل تمامًا من الرئيسية
  const removed = await page.evaluate(() => ({
    section: Boolean(document.querySelector('[data-section-id="activity"]')),
    title: /آخر التحركات|ما الذي حدث/.test(document.querySelector('#main-content')?.textContent || '')
  }));
  check('قسم «آخر التحركات» غير موجود في الرئيسية', !removed.section && !removed.title, JSON.stringify(removed));

  // 2) قسم «تنظيف نهائي» موجود بالزرين، ومعطّلان عند عدم وجود شيء
  const initial = await countText();
  check('قسم «تنظيف نهائي» يعرض زر الملاحظات وزر المهام', await page.evaluate(() => Boolean(document.querySelector('[data-purge-notes]') && document.querySelector('[data-purge-tasks]'))));
  check('الزران معطّلان عند عدم وجود ملاحظات في السلة أو مهام منجزة', initial.notesDisabled === true && initial.tasksDisabled === true, JSON.stringify(initial));

  // 3) زرع البيانات عبر الخدمات الرسمية
  const seeded = await page.evaluate(async () => {
    const office = window.__LAW_OFFICE_APP__.office;
    const qn = await import('/js/services/quick-notes.js');
    const wi = await import('/js/services/work-items.js');
    const keepNote = await qn.saveQuickNote(office, {title: 'ملاحظة خارج السلة'});
    const trashA = await qn.saveQuickNote(office, {title: 'ملاحظة سلة أ'});
    const trashB = await qn.saveQuickNote(office, {title: 'ملاحظة سلة ب'});
    await qn.deleteQuickNote(office, trashA.id);
    await qn.deleteQuickNote(office, trashB.id);
    const openTask = await wi.saveWorkItem(office, {title: 'مهمة مفتوحة تبقى'});
    const doneA = await wi.saveWorkItem(office, {title: 'مهمة منجزة أ'});
    await wi.completeItem(office, doneA.id);
    await wi.addComment(office, doneA.id, {body: 'تعليق على مهمة منجزة'});
    const doneB = await wi.saveWorkItem(office, {title: 'مهمة منجزة ب'});
    await wi.completeItem(office, doneB.id);
    return {keepNoteId: keepNote.id, trashIds: [trashA.id, trashB.id], openTaskId: openTask.id, doneIds: [doneA.id, doneB.id], doneAId: doneA.id};
  });
  await go('dashboard');
  const afterSeed = await countText();
  check('العدّادان يعكسان البيانات المزروعة (ملاحظتان في السلة، مهمتان منجزتان)', ascii(afterSeed.notes).includes('2') && ascii(afterSeed.tasks).includes('2'), JSON.stringify(afterSeed));

  // 4) الإلغاء لا يحذف شيئًا
  await page.locator('[data-purge-notes]').click();
  await confirmModal(false);
  await go('dashboard');
  const afterCancel = await page.evaluate(() => document.querySelector('[data-purge-notes-count]')?.textContent?.trim());
  check('إلغاء تأكيد الملاحظات لا يحذف شيئًا', ascii(afterCancel).includes('2'), afterCancel);

  // 5) حذف ملاحظات السلة نهائيًا بعد التأكيد
  await page.locator('[data-purge-notes]').click();
  await confirmModal(true);
  await go('dashboard');
  const notesState = await page.evaluate(async ({keepNoteId, trashIds}) => {
    const office = window.__LAW_OFFICE_APP__.office;
    const qn = await import('/js/services/quick-notes.js');
    const trashLeft = (await qn.pageQuickNotes(office, {status: 'TRASH', limit: 100})).rows.length;
    const keep = await office.r.caseNotes.get(keepNoteId);
    const purgedRaw = await office.r.caseNotes.getManyRaw(trashIds);
    return {trashLeft, keepExists: Boolean(keep && !keep.isDeleted), purgedGone: purgedRaw.every(row => !row || row.isDeleted === true)};
  }, seeded);
  check('حُذفت ملاحظات السلة نهائيًا (لا تظهر في السلة ولا في البيانات الحية)', notesState.trashLeft === 0 && notesState.purgedGone, JSON.stringify(notesState));
  check('الملاحظة خارج السلة لم تتأثر', notesState.keepExists, JSON.stringify(notesState));
  const afterNotes = await countText();
  check('زر الملاحظات يصبح معطّلًا بعد الحذف', afterNotes.notes === 'السلة فارغة' && afterNotes.notesDisabled === true, JSON.stringify(afterNotes));

  // 6) حذف المهام المنجزة نهائيًا مع تعليقاتها، والمفتوحة تبقى
  await page.locator('[data-purge-tasks]').click();
  await confirmModal(true);
  await go('dashboard');
  const tasksState = await page.evaluate(async ({openTaskId, doneIds, doneAId}) => {
    const office = window.__LAW_OFFICE_APP__.office;
    const wi = await import('/js/services/work-items.js');
    const left = await wi.countCompletedWorkItems(office);
    const openRow = await office.r.workItems.get(openTaskId);
    const doneLive = (await office.r.workItems.getManyRaw(doneIds)).filter(row => row && !row.isDeleted).length;
    const comments = (await office.r.workItemComments.byIndexRaw('workItemId', doneAId)).filter(c => !c.isDeleted).length;
    return {left, openStillThere: Boolean(openRow), doneLive, commentsLive: comments};
  }, seeded);
  check('حُذفت المهام المنجزة نهائيًا', tasksState.left === 0 && tasksState.doneLive === 0, JSON.stringify(tasksState));
  check('المهمة غير المنجزة تبقى', tasksState.openStillThere, JSON.stringify(tasksState));
  check('تعليقات المهمة المنجزة حُذفت معها', tasksState.commentsLive === 0, JSON.stringify(tasksState));
  const afterTasks = await countText();
  check('زر المهام يصبح معطّلًا بعد الحذف', afterTasks.tasks === 'لا توجد مهام منجزة' && afterTasks.tasksDisabled === true, JSON.stringify(afterTasks));

  // 7) لا أخطاء JavaScript أثناء الفحص
  check('لا أخطاء JavaScript أثناء الفحص', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
} catch (error) {
  failures.push(`exception: ${error.message}`);
  console.log('EXCEPTION', error.stack || error.message);
} finally {
  await browser.close();
  if (server) server.close();
}
console.log(`\n${checks.length - failures.length}/${checks.length} فحصًا ناجحًا`);
process.exit(failures.length ? 1 : 0);
