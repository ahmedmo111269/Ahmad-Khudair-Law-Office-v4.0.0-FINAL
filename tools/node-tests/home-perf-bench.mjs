// ============================================================
// مقياس أداء «مكتب اليوم» (الرئيسية) —icional الحقيقي في Chromium:
//   • عدد استعلامات IndexedDB (حسب الدالة والمستودع) أثناء dashboardBrief/render/action.
//   • زمن أول Render للصفحة الرئيسية.
//   • زمن Action-to-Next (النقر على «✓ تم» حتى تغيّر «الخطوة التالية»).
//   • أي قراءة كاملة (all/count/sumAll) أو قراءة جماعية (>50 معرّف) تُسجَّل كملاحظة.
//
// الاستخدام:
//   node ../static-preview-server.mjs &            # من جذر المستودع (المنفذ 8080)
//   BENCH_DATASET=20    BENCH_LABEL=before node home-perf-bench.mjs
//   BENCH_DATASET=1000  BENCH_LABEL=before node home-perf-bench.mjs
//   BENCH_DATASET=5000  BENCH_LABEL=before node home-perf-bench.mjs   (5000 عنصر + 500 ملف)
// الناتج: .cache/bench/home-perf-<label>-<dataset>.json (غير مُتتبَّع في Git)
// ============================================================
import {chromium} from 'playwright';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';

const repository = path.resolve(new URL('../../', import.meta.url).pathname);
const base = (process.env.BENCH_BASE_URL || 'http://127.0.0.1:8080').replace(/\/$/, '');
const N = Number(process.env.BENCH_DATASET || 20);
const FILES = Number(process.env.BENCH_FILES ?? (N >= 5000 ? 500 : Math.round(N / 10)));
const label = process.env.BENCH_LABEL || 'run';
const require = createRequire(import.meta.url);
const {default: slim, inflate} = await import('@sparticuz/chromium');
await inflate(path.resolve(path.dirname(require.resolve('@sparticuz/chromium')), '../bin/al2023.tar.br'));
process.env.LD_LIBRARY_PATH = path.join(process.env.TMPDIR || '/tmp', 'al2023', 'lib');
const browser = await chromium.launch({executablePath: await slim.executablePath(), headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage']});
const context = await browser.newContext({viewport: {width: 1440, height: 900}, locale: 'ar'});
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));
const outDir = path.join(repository, '.cache', 'bench');
await fs.mkdir(outDir, {recursive: true});
const result = {dataset: N, files: FILES, label, browser: browser.version(), date: new Date().toISOString(), phases: {}, pageErrors: [], notes: []};

try {
  await page.goto(`${base}/index.html`, {waitUntil: 'domcontentloaded'});
  await page.waitForFunction(() => window.__LAW_OFFICE_APP__?.office && !window.__LAW_OFFICE_APP__.booting, null, {timeout: 120000});
  await page.waitForTimeout(800);

  // ===== 0) تفريغ قاعدة البيانات عبر مسار المسح الشامل المعتمد (يمنع إعادة زرع البيانات التجريبية) =====
  result.clearMs = await page.evaluate(async () => {
    const t = performance.now();
    const app = window.__LAW_OFFICE_APP__;
    const {clearAllData} = await import('/js/services/data-admin.js');
    const name = String(app.office.ctx?.profile?.displayName || app.office.ctx?.profile?.name || '').trim();
    await clearAllData(app.office, {reason: 'bench reset', confirmName: name});
    return Math.round(performance.now() - t);
  });

  // ===== 1) زرع البيانات: N عنصر عمل + FILES ملف =====
  result.seedMs = await page.evaluate(async ({N, FILES}) => {
    const t = performance.now();
    const app = window.__LAW_OFFICE_APP__, db = app.office.ctx.db;
    const today = new Date(); const pad = n => String(n).padStart(2, '0');
    const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
    const now = new Date().toISOString();
    const dueFor = i => iso(addDays(today, (i % 30) - 12));           // من -12 إلى +17 يومًا
    const rows = {workItems: [], procedures: [], hearings: [], appointments: [], communications: [], files: [], activityLog: []};
    const FILE_ID = FILES > 0 ? 'bench-f-00000000' : '';
    for (let i = 0; i < N; i++) {
      const id = `bench-wi-${String(i).padStart(8, '0')}`;
      const due = i % 17 === 0 ? '' : dueFor(i);
      const done = i % 23 === 0 && due === iso(today);
      rows.workItems.push({
        id, kind: 'native', sourceType: 'task', sourceId: id, title: `〔bench〕 مهمة ${i}`, description: '',
        dueDate: due, dueTime: i % 3 === 0 && due ? '10:00' : '', status: done ? 'done' : (i % 19 === 0 ? 'postponed' : 'notStarted'),
        priority: i % 9 === 0 ? 'urgent' : 'medium', tags: [], fileId: '', caseId: '', clientId: '', relatedType: '', relatedId: '',
        originalDueDate: '', postponeCount: i % 4 === 0 ? 1 + (i % 3) : 0, commentCount: 0, pinnedAt: i % 41 === 0 ? now : null, quadrant: null,
        completedAt: done ? now : null, completedBy: done ? 'user' : null, archivedAt: null, isArchived: false, isDeleted: false,
        createdAt: now, updatedAt: now, version: 1, createdBy: 'user', assigneeId: null, visibility: 'office'
      });
      if (i % 5 === 0) {
        const pid = `bench-pr-${String(i).padStart(8, '0')}`;
        rows.procedures.push({id: pid, fileId: FILE_ID, caseId: '', type: 'متابعة', description: `〔bench〕 عمل إداري ${i}`, actionDate: due, internalDueDate: due, status: done ? 'done' : 'open', priority: i % 9 === 0 ? 'urgent' : 'medium', result: '', notes: '', createdAt: now, updatedAt: now, version: 1, isDeleted: false, isArchived: false});
        if (i % 4 === 0) rows.workItems.push({id: `procedures::${pid}`, kind: 'overlay', sourceType: 'procedures', sourceId: pid, dueDate: due, status: 'postponed', priority: null, tags: [], pinnedAt: null, quadrant: null, originalDueDate: due, postponeCount: 1 + (i % 3), commentCount: 0, completedAt: null, completedBy: null, completedFor: null, cancelledAt: null, cancelledFor: null, statusBeforeComplete: null, archivedAt: null, isArchived: false, isDeleted: false, createdAt: now, updatedAt: now, version: 1});
      }
      if (i % 7 === 0) rows.hearings.push({id: `bench-h-${String(i).padStart(8, '0')}`, caseId: '', fileId: FILE_ID, hearingDate: due || iso(today), hearingTime: i % 3 === 0 ? '11:00' : '', court: 'محكمة البداية', chamber: '', type: 'جلسة', reason: `〔bench〕 جلسة ${i}`, result: done ? 'تم' : '', status: done ? 'done' : 'scheduled', createdAt: now, updatedAt: now, version: 1, isDeleted: false});
      if (i % 11 === 0) rows.appointments.push({id: `bench-ap-${String(i).padStart(8, '0')}`, fileId: FILE_ID, title: `〔bench〕 موعد ${i}`, date: due || iso(today), time: '', location: '', withWhom: '', status: done ? 'done' : 'scheduled', createdAt: now, updatedAt: now, version: 1, isDeleted: false});
      if (i % 13 === 0) rows.communications.push({id: `bench-co-${String(i).padStart(8, '0')}`, fileId: FILE_ID, subject: `〔bench〕 متابعة ${i}`, date: due || iso(today), followUpDate: due, followUpRequired: true, contactName: '', channel: 'هاتف', createdAt: now, updatedAt: now, version: 1, isDeleted: false});
      rows.activityLog.push({id: `bench-al-${String(i).padStart(8, '0')}`, entityType: 'workItems', entityId: id, action: 'create', timestamp: now, summary: `إنشاء 〔bench〕 ${i}`, metadata: {}, fileId: null});
    }
    for (let i = 0; i < FILES; i++) {
      const id = `bench-f-${String(i).padStart(8, '0')}`;
      const title = `〔bench〕 ملف ${i}`;
      rows.files.push({id, fileNumber: `2026/${String(i + 1).padStart(6, '0')}`, title, titleNormalized: title, fileType: 'مدني', status: 'open', priority: 'medium', partyNames: '', searchText: title, lastActivityAt: i % 4 === 0 ? now : '2020-01-01T00:00:00', openedAt: iso(today), createdAt: now, updatedAt: now, version: 1, isDeleted: false, isArchived: false});
    }
    for (const [store, list] of Object.entries(rows)) {
      for (let s = 0; s < list.length; s += 1000) {
        const chunk = list.slice(s, s + 1000);
        await new Promise((res, rej) => {
          const tx = db.transaction(store, 'readwrite');
          tx.oncomplete = res; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error);
          const os = tx.objectStore(store);
          for (const r of chunk) os.put(r);
        });
      }
    }
    return Math.round(performance.now() - t);
  }, {N, FILES});

  // ===== 2) تدقيق الاستعلامات — لفّ دوال القراءة في المستودعات =====
  await page.evaluate(() => {
    const app = window.__LAW_OFFICE_APP__;
    const READS = ['get', 'getMany', 'getManyRaw', 'all', 'byIndex', 'byIndexRaw', 'byIndexKey', 'byIndexAll', 'countIndex', 'range', 'reportRange', 'count', 'prefix', 'page', 'countByIndex', 'sumByIndex', 'sumAll'];
    const stats = {};
    window.__bench = {
      stats, phase: 'idle',
      reset() { for (const k of Object.keys(stats)) delete stats[k]; },
      snapshot() { return JSON.parse(JSON.stringify(stats)); }
    };
    for (const [store, repo] of Object.entries(app.office.r)) {
      for (const m of READS) {
        if (typeof repo[m] !== 'function') continue;
        const orig = repo[m].bind(repo);
        repo[m] = async (...args) => {
          const key = `${store}.${m}`, t = performance.now();
          const out = await orig(...args);
          const rows = Array.isArray(out) ? out.length : (out && Array.isArray(out.items) ? out.items.length : (typeof out === 'number' ? out : 0));
          const s = stats[key] ||= {calls: 0, rows: 0, ms: 0};
          s.calls++; s.rows += rows; s.ms += performance.now() - t;
          if (window.__bench.phase !== 'idle') {
            if (m === 'all' || m === 'sumAll' || m === 'count' || m === 'scan') s.fullScan = (s.fullScan || 0) + 1;
            if (m === 'get' || m === 'getMany' || m === 'getManyRaw') s.batch = Math.max(s.batch || 0, Array.isArray(args[0]) ? args[0].length : 1);
          }
          return out;
        };
      }
    }
  });

  const runPhase = async (name, fn) => {
    await page.evaluate(n => { window.__bench.phase = n; window.__bench.reset(); }, name);
    const out = await page.evaluate(async src => {
      const t0 = performance.now();
      const f = (0, eval)(`(${src})`);
      const value = await f();
      return {ms: Math.round(performance.now() - t0), value};
    }, fn.toString());
    const stats = await page.evaluate(() => window.__bench.snapshot());
    await page.evaluate(() => { window.__bench.phase = 'idle'; });
    let calls = 0, rows = 0; const byMethod = {};
    for (const [k, v] of Object.entries(stats)) {
      calls += v.calls; rows += v.rows;
      const [store, m] = k.split('.');
      byMethod[m] = byMethod[m] || {calls: 0, rows: 0, stores: {}};
      byMethod[m].calls += v.calls; byMethod[m].rows += v.rows;
      byMethod[m].stores[store] = v.calls;
      if (v.fullScan) result.notes.push(`[${name}] FullScan: ${k} ×${v.fullScan}`);
      if (v.batch > 50) result.notes.push(`[${name}] Batch>50: ${k} reads up to ${v.batch} ids at once`);
    }
    result.phases[name] = {ms: out.ms, queries: calls, rows, byMethod, detail: out.value ?? null};
    return out.value;
  };

  // ===== 3) dashboardBrief =====
  result.briefCounts = await runPhase('dashboardBrief', async () => {
    const {dashboardBrief} = await import('/js/services/dashboard.js');
    const r = await dashboardBrief(window.__LAW_OFFICE_APP__.office);
    return {
      todayHearings: r.todayHearings.length, upcomingHearings: r.upcomingHearings.length,
      overdueProcedures: r.overdueProcedures.length, upcomingProcedures: r.upcomingProcedures.length,
      appointmentsNext3: r.appointmentsNext3.length, followupsThisWeek: r.followupsThisWeek.length,
      staleFiles: r.staleFiles.length, expiringPoa: r.expiringPoa.length, expiredPoa: r.expiredPoa.length,
      executionAttention: r.executionAttention.length,
      postponedOverdue: r.overdueProcedures.filter(p => Number(p.postponeCount || 0) > 0).length
    };
  });

  // ===== 4) أول Render للرئيسية (go('dashboard') + bindHome) =====
  await page.evaluate(() => window.__LAW_OFFICE_APP__.go('clients'));
  await page.waitForTimeout(400);
  result.homeRender = await runPhase('homeRender', async () => {
    const app = window.__LAW_OFFICE_APP__;
    await app.go('dashboard');
    await new Promise(res => {
      const t0 = Date.now();
      const poll = () => {
        const title = document.querySelector('#agenda-title')?.textContent || '';
        const cal = document.querySelector('#home-calendar .cal-grid');
        const grid = document.querySelector('#agenda-grid .dg-body');
        if ((title && cal && grid) || Date.now() - t0 > 20000) return res();
        setTimeout(poll, 50);
      };
      poll();
    });
    return {focusTitle: document.querySelector('.cp-focus h2')?.textContent || '', queueRows: document.querySelectorAll('.cp-attn .cp-row').length};
  });

  // ===== 5) Action-to-Next: «✓ تم» على أول عمل متأخر في الطابور =====
  result.actionToNext = await runPhase('actionToNext', async () => {
    const app = window.__LAW_OFFICE_APP__;
    // إن كانت «الخطوة التالية» عملًا إداريًا: نقر «✓ تم» في بطاقتها (السيناريو المثالي).
    // وإلا: «✓ تم» لأول صف في طابور القرارات.
    let btn = document.querySelector('.cp-focus [data-complete-proc]') || document.querySelector('[data-complete-proc]');
    if (!btn) return {skipped: 'no complete button'};
    const before = document.querySelector('.cp-focus h2')?.textContent || '';
    const rowTitle = btn.closest('.cp-row')?.querySelector('.cp-row-text b')?.textContent
      || btn.closest('.cp-focus')?.querySelector('h2')?.textContent || '';
    const fromFocusCard = Boolean(btn.closest('.cp-focus'));
    const kpiOverdueBefore = document.querySelector('.kpi-panel .kpi-warn b')?.textContent || '';
    const t0 = performance.now();
    btn.click();
    let doneAt = 0, nextTitle = '', removed = false;
    await new Promise(res => {
      const poll = () => {
        const now = document.querySelector('.cp-focus h2')?.textContent || '';
        const stillThere = [...document.querySelectorAll('.cp-attn .cp-row-text b, .cp-focus h2')].some(el => el.textContent === rowTitle);
        if ((!stillThere || now !== before) || performance.now() - t0 > 30000) {
          doneAt = performance.now() - t0; nextTitle = now; removed = !stillThere; return res();
        }
        setTimeout(poll, 25);
      };
      poll();
    });
    return {before, rowTitle, nextTitle, fromFocusCard, removed, nextChanged: nextTitle !== before, ms: Math.round(doneAt), positional: typeof app.__refreshAfterAction === 'function' && app.route === 'dashboard'};
  });

  result.pageErrors = pageErrors;
} catch (error) {
  result.error = String(error?.stack || error);
} finally {
  await browser.close();
}

const file = path.join(outDir, `home-perf-${label}-${N}.json`);
await fs.writeFile(file, JSON.stringify(result, null, 2));
console.log(`\n=== home-perf [${label}] dataset=${N} files=${FILES} ===`);
if (result.error) console.log('ERROR', result.error);
for (const [name, p] of Object.entries(result.phases)) {
  console.log(`${name}: ${p.ms}ms · queries=${p.queries} · rows=${p.rows}`);
  const top = Object.entries(p.byMethod).sort((a, b) => b[1].calls - a[1].calls).slice(0, 8).map(([m, v]) => `${m}:${v.calls}`).join(' ');
  console.log(`   ${top}`);
}
if (result.briefCounts) console.log('brief:', JSON.stringify(result.briefCounts));
if (result.actionToNext) console.log('actionToNext:', JSON.stringify(result.actionToNext));
if (result.notes.length) console.log('notes:', result.notes.join(' | '));
if (pageErrors.length) console.log('PAGE ERRORS:', pageErrors.slice(0, 5));
console.log(`saved: ${file}`);
process.exit(result.error ? 1 : 0);
