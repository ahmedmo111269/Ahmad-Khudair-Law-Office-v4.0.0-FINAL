// Browser verification for app-shell caching, offline boot/local saves, network transitions and sync consent.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {chromium} from 'playwright';

const repository = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.webmanifest':'application/manifest+json','.json':'application/json'};
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const file = path.resolve(repository, relative);
    if (!file.startsWith(repository + path.sep) && file !== path.join(repository, 'index.html')) { res.writeHead(403).end(); return; }
    const body = await readFile(file);
    res.writeHead(200, {'content-type': mime[path.extname(file)] || 'application/octet-stream', 'cache-control':'no-store'});
    res.end(body);
  } catch { res.writeHead(404).end('not found'); }
});
await new Promise(resolve => server.listen(0, '0.0.0.0', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
const report = {scenario:'offline-first-and-sync-consent',base,checks:[],failures:[],consoleErrors:[],expectedOfflineNetworkErrors:[],status:'NOT RUN'};
const check = (name, condition, detail='') => condition ? report.checks.push({name,status:'VERIFIED — Chromium',detail}) : report.failures.push({name,detail});
try {
  if (process.env.GRID_BROWSER_EXECUTABLE) {
    browser = await chromium.launch({executablePath:process.env.GRID_BROWSER_EXECUTABLE,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  } else {
    const {default: slim, inflate} = await import('@sparticuz/chromium');
    const require = createRequire(import.meta.url);
    await inflate(path.resolve(path.dirname(require.resolve('@sparticuz/chromium')), '../bin/al2023.tar.br'));
    const libPath = path.join(process.env.TMPDIR || '/tmp', 'al2023', 'lib');
    process.env.LD_LIBRARY_PATH = [libPath, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');
    browser = await chromium.launch({executablePath:await slim.executablePath(),headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  }
  report.browser = browser.version();
  const context = await browser.newContext({viewport:{width:1365,height:950},serviceWorkers:'allow',acceptDownloads:true});
  const page = await context.newPage();
  const downloads=[];
  const downloadEvents=[];
  page.on('download', download => { downloads.push(download.suggestedFilename()); downloadEvents.push(download); });
  page.on('pageerror', error => report.consoleErrors.push(error.message));
  page.on('console', message => {
    if (message.type()!=='error') return;
    const text=message.text();
    if (/net::ERR_(?:CONNECTION_CLOSED|INTERNET_DISCONNECTED)/.test(text)) report.expectedOfflineNetworkErrors.push(text);
    else report.consoleErrors.push(text);
  });
  await page.goto(`${base}/index.html`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(() => window.__LAW_OFFICE_APP__ && !window.__LAW_OFFICE_APP__.booting && window.__LAW_OFFICE_APP__.office, null, {timeout:90000});
  await page.waitForFunction(async () => {
    const registrations = await navigator.serviceWorker?.getRegistrations?.() || [];
    return registrations.some(registration => registration.active?.state === 'activated');
  }, null, {timeout:60000}).catch(() => {});
  const swInstalled = await page.evaluate(async () => {
    const registrations = await navigator.serviceWorker?.getRegistrations?.() || [];
    const keys = await caches.keys();
    // اسم الكاش يحمل رقم الإصدار ويتغيّر مع كل إصدار (sw.js). نتحقق من وجود كاش
    // التطبيق الحالي فعلاً وباحتوائه على غلاف التطبيق، لا من لاحقة إصدار محددة.
    const appCaches=[];
    for (const key of keys.filter(item => item.startsWith('ahmad-khudair-law-office-v'))) {
      const cache=await caches.open(key);
      const urls=(await cache.keys()).map(request => new URL(request.url).pathname);
      if (urls.includes('/index.html') && urls.includes('/js/app.js')) appCaches.push(key);
    }
    return {active:registrations.some(registration => registration.active?.state === 'activated'), cache:appCaches.length>0, cacheName:appCaches[0]||''};
  });
  check('PWA service worker installs and application-shell cache is present', swInstalled.active && swInstalled.cache, JSON.stringify(swInstalled));
  await page.evaluate(() => window.__LAW_OFFICE_APP__.go('dashboard'));
  await page.waitForFunction(() => document.querySelector('#page-title')?.textContent === 'الرئيسية');

  await context.setOffline(true);
  await page.reload({waitUntil:'domcontentloaded',timeout:45000});
  await page.waitForFunction(() => window.__LAW_OFFICE_APP__ && !window.__LAW_OFFICE_APP__.booting && window.__LAW_OFFICE_APP__.office, null, {timeout:60000});
  const offlineBoot = await page.evaluate(async () => {
    const app = window.__LAW_OFFICE_APP__;
    const local = await app.office.saveClient({fullName:'اختبار حفظ محلي بلا إنترنت'});
    await app.go('clients');
    const clientsTitle = document.querySelector('#page-title')?.textContent;
    await app.go('files');
    const filesTitle = document.querySelector('#page-title')?.textContent;
    const fetched = await app.office.r.clients.get(local.id);
    return {online:navigator.onLine, badge:document.querySelector('#network-badge')?.textContent, client:fetched?.fullName, clientId:local.id, clientTitle:clientsTitle, filesTitle};
  });
  check('Offline cold reload opens the cached application shell', offlineBoot.online === false && offlineBoot.client === 'اختبار حفظ محلي بلا إنترنت', JSON.stringify(offlineBoot));
  check('Offline clients/files local pages render', offlineBoot.clientTitle === 'الموكلون' && offlineBoot.filesTitle === 'الملفات', JSON.stringify(offlineBoot));

  const routeResults = await page.evaluate(async routes => {
    const app=window.__LAW_OFFICE_APP__, results=[];
    for(const route of routes){
      await app.go(route);
      results.push({route,title:document.querySelector('#page-title')?.textContent||'',error:Boolean(document.querySelector('#main-content .error-box'))});
    }
    return results;
  }, ['actionCenter','clients','files','hearings','procedures','judgments','executionCenter','execution','search','reports','analytics','backup','settings']);
  const routesRendered=routeResults.every(item=>item.title&&!item.error);
  check('Offline Work Center, local search, reports, operations and settings pages render', routesRendered, JSON.stringify(routeResults));
  await page.evaluate(() => window.__LAW_OFFICE_APP__.go('search'));
  await page.locator('#advanced-q').fill('اختبار حفظ محلي بلا إنترنت');
  await page.waitForTimeout(3000);
  await page.evaluate(()=>{for(const section of document.querySelectorAll('#advanced-results [data-collapse-ready="true"][data-collapse-collapsed="true"]'))section.querySelector('.collapse-toggle')?.click()});
  await page.waitForTimeout(250);
  const searchOutput=await page.locator('#advanced-results').innerText();
  const searchFound=await page.locator('#advanced-results [data-group="clients"]').count();
  check('Offline full-text search finds the locally saved client', searchFound>0, searchOutput.slice(0,500));

  await page.evaluate(() => window.__LAW_OFFICE_APP__.go('backup'));
  const originalProfileId = await page.evaluate(() => window.__LAW_OFFICE_APP__.ctx.profile.id);
  const exportButton=page.locator('#do-export');
  if(!(await exportButton.isVisible())) await page.locator('#main-content .panel .card-collapse-toggle').first().click();
  await page.waitForFunction(() => Boolean(document.querySelector('#do-export')));
  const backupDownloadPromise=page.waitForEvent('download',{timeout:45000});
  await exportButton.click();
  const backupDownload=await backupDownloadPromise;
  const backupPath=await backupDownload.path();
  const backupPayload=JSON.parse(await readFile(backupPath,'utf8'));
  const backupHasOfflineClient=backupPayload.stores?.clients?.some(row=>row.id===offlineBoot.clientId&&row.fullName==='اختبار حفظ محلي بلا إنترنت');
  check('Offline full backup exports the locally saved record', backupHasOfflineClient, JSON.stringify({filename:backupDownload.suggestedFilename(),schema:backupPayload.schemaVersion,total:backupPayload.manifest?.totalRecords,clientFound:Boolean(backupHasOfflineClient)}));

  let restoreDialogSeen=false;
  page.once('dialog',async dialog=>{restoreDialogSeen=true;await dialog.accept('Offline restore verification')});
  await page.locator('#restore-new-file').setInputFiles(backupPath);
  await page.waitForFunction(profileName => window.__LAW_OFFICE_APP__?.registry?.active?.displayName===profileName, 'Offline restore verification', {timeout:90000});
  const restoredClient=await page.evaluate(async clientId=>{
    const app=window.__LAW_OFFICE_APP__,row=await app.office.r.clients.get(clientId);
    return {profile:app.registry.active.displayName,client:row?.fullName};
  },offlineBoot.clientId);
  check('Offline restore-to-new-database restores the exported local record', restoreDialogSeen && restoredClient.client==='اختبار حفظ محلي بلا إنترنت', JSON.stringify(restoredClient));
  await page.evaluate(async()=>await window.__LAW_OFFICE_APP__.maintenance);
  await page.evaluate(async profileId=>{const app=window.__LAW_OFFICE_APP__;await app.switchDb(profileId);await app.refresh()},originalProfileId);
  await page.waitForFunction(profileId=>window.__LAW_OFFICE_APP__?.ctx?.profile?.id===profileId,originalProfileId,{timeout:30000});

  const beforeHistory = await page.evaluate(async () => (await (await import('/js/services/sync-engine.js')).syncHistory(window.__LAW_OFFICE_APP__.ctx)).length);
  const downloadsBeforeSync = downloads.length;
  await context.setOffline(false);
  await page.waitForFunction(() => document.querySelector('#network-badge')?.textContent.includes('متصل'), null, {timeout:15000});
  await page.waitForTimeout(500);
  const afterReconnect = await page.evaluate(async () => {
    const engine = await import('/js/services/sync-engine.js');
    return {history:(await engine.syncHistory(window.__LAW_OFFICE_APP__.ctx)).length,status:await engine.syncStatus(window.__LAW_OFFICE_APP__.ctx)};
  });
  check('Reconnect updates network state without starting sync automatically', afterReconnect.history === beforeHistory && afterReconnect.status.pendingChanges > 0, JSON.stringify({beforeHistory,afterHistory:afterReconnect.history,pending:afterReconnect.status.pendingChanges}));

  await page.evaluate(() => window.__LAW_OFFICE_APP__.go('sync'));
  await page.waitForSelector('#sync-now');
  await page.click('#sync-now');
  await page.waitForSelector('.modal-card [data-confirm-sync]');
  const summary = await page.locator('.modal-card').innerText();
  check('Sync confirmation summary is shown before any change', summary.includes('التغييرات المحلية') && summary.includes('التغييرات الواردة') && summary.includes('تأكيد المزامنة') && summary.includes('إلغاء'), summary.slice(0,300));
  await page.click('.modal-card [data-cancel-sync]');
  await page.waitForTimeout(250);
  const afterCancel = await page.evaluate(async () => {
    const engine = await import('/js/services/sync-engine.js');
    return {history:(await engine.syncHistory(window.__LAW_OFFICE_APP__.ctx)).length,bootstrap:(await engine.syncStatus(window.__LAW_OFFICE_APP__.ctx)).baselineComplete};
  });
  check('Cancel performs no sync, no baseline write, and no backup download', afterCancel.history === beforeHistory && afterCancel.bootstrap === false && downloads.length === downloadsBeforeSync, JSON.stringify({afterCancel,downloads,downloadsBeforeSync}));

  const transferPassphrase='Browser Transfer Passphrase 2026';
  await page.click('#sync-now');
  await page.waitForSelector('.modal-card [data-confirm-sync]');
  await page.click('.modal-card [data-confirm-sync]');
  await page.waitForSelector('.modal-card [data-sync-passphrase]');
  await page.locator('.modal-card [data-sync-passphrase]').fill(transferPassphrase);
  await page.locator('.modal-card [data-sync-passphrase-repeat]').fill(transferPassphrase);
  const preSyncBackupPromise=page.waitForEvent('download',{timeout:90000,predicate:download=>download.suggestedFilename().startsWith('law-office-pre-sync-')});
  await page.click('.modal-card [data-passphrase-submit]');
  const preSyncBackup=await preSyncBackupPromise;
  const exportComplete=await page.waitForFunction(()=>{
    const button=document.querySelector('#sync-now'),progress=document.querySelector('#sync-progress')?.textContent||'';
    return Boolean(button&&!button.disabled&&progress.includes('اكتمل خط الأساس.'));
  },null,{timeout:90000}).then(()=>true).catch(()=>false);
  const newDownloadEvents=downloadEvents.slice(downloadsBeforeSync);
  if(!exportComplete||newDownloadEvents.length<2){
    const debug=await page.evaluate(async()=>{
      const app=window.__LAW_OFFICE_APP__,engine=await import('/js/services/sync-engine.js');
      return {progress:document.querySelector('#sync-progress')?.textContent,buttonDisabled:document.querySelector('#sync-now')?.disabled,status:await engine.syncStatus(app.ctx),history:await engine.syncHistory(app.ctx),toast:document.querySelector('[role="status"].toast')?.textContent};
    });
    report.failures.push({name:'Confirmed sync outgoing package download',detail:JSON.stringify({debug,downloads})});
  }else{
    const encryptedDownload=newDownloadEvents[1];
    const syncBackupPayload=JSON.parse(await readFile(await preSyncBackup.path(),'utf8'));
    const encryptedPayload=JSON.parse(await readFile(await encryptedDownload.path(),'utf8'));
    const cryptoModule=await import('../../js/services/sync-crypto.js');
    const decryptedBundle=await cryptoModule.decryptSyncEnvelope(encryptedPayload,transferPassphrase);
    const completedSync=await page.evaluate(async()=>{
      const app=window.__LAW_OFFICE_APP__,engine=await import('/js/services/sync-engine.js');
      return {status:await engine.syncStatus(app.ctx),history:await engine.syncHistory(app.ctx)};
    });
    const backupPrecedesBaseline=!syncBackupPayload.stores?.syncState?.some(row=>row.id==='initialBaseline'&&row.complete===true);
    check('Explicitly confirmed sync downloads backup before baseline writes', backupPrecedesBaseline && syncBackupPayload.stores?.clients?.some(row=>row.id===offlineBoot.clientId), JSON.stringify({backupName:preSyncBackup.suggestedFilename(),baselineWasCompleteInBackup:!backupPrecedesBaseline}));
    check('Outgoing transport file is encrypted and can be opened only with the shared passphrase', encryptedPayload.format===cryptoModule.ENCRYPTED_SYNC_FORMAT && decryptedBundle.format==='AhmadKhudairLawOfficeSync' && decryptedBundle.changes.length===500 && decryptedBundle.hasMore===true && !JSON.stringify(encryptedPayload).includes('اختبار حفظ محلي بلا إنترنت'), JSON.stringify({filename:encryptedDownload.suggestedFilename(),encryptedFormat:encryptedPayload.format,changes:decryptedBundle.changes.length,hasMore:decryptedBundle.hasMore}));
    check('Confirmed export initializes the baseline and records sync history', completedSync.status.baselineComplete && completedSync.history.some(row=>row.action==='sync-export'), JSON.stringify({baseline:completedSync.status.baselineComplete,pending:completedSync.status.pendingChanges,history:completedSync.history.length}));
  }

  check('No JavaScript exceptions or unexpected browser-console errors', report.consoleErrors.length===0, JSON.stringify(report.consoleErrors));
  report.status = report.failures.length ? 'FAIL' : 'PASS';
  console.log(JSON.stringify(report,null,2));
  await context.close();
} catch (error) {
  report.status='FAIL'; report.failures.push({name:'browser scenario',detail:error?.stack || String(error)});
  console.log(JSON.stringify(report,null,2));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
if(report.failures.length) process.exitCode = 1;
