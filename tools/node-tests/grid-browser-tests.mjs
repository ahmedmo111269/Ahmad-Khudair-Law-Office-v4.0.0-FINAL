// Real Chromium DOM/popup/PDF regression checks. This does NOT drive the native
// Print Preview dialog or a physical printer; always report that limitation.
import {chromium} from 'playwright';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {SCHEMA_VERSION} from '../../js/core/constants.js';

const repository=fileURLToPath(new URL('../../',import.meta.url));
const base=(process.env.GRID_BASE_URL||'http://127.0.0.1:8000').replace(/\/$/,'');
const scenario=process.env.GRID_BROWSER_SCENARIO||'full';
assert.ok(['full','offline'].includes(scenario),'GRID_BROWSER_SCENARIO must be full or offline');
const artifactDir=path.join(repository,'.cache','grid-browser');
await fs.mkdir(artifactDir,{recursive:true});
let browser;
if(process.env.GRID_BROWSER_EXECUTABLE){
 browser=await chromium.launch({executablePath:process.env.GRID_BROWSER_EXECUTABLE,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
}else{
 // Portable npm-packaged fallback for offline/CI hosts without a Playwright
 // browser installation. No app/runtime dependency and no binaries in Git.
 const {default:slim,inflate}=await import('@sparticuz/chromium');
 const require=createRequire(import.meta.url);
 await inflate(path.resolve(path.dirname(require.resolve('@sparticuz/chromium')),'../bin/al2023.tar.br'));
 const libPath=path.join(process.env.TMPDIR||'/tmp','al2023','lib');
 process.env.LD_LIBRARY_PATH=[libPath,process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');
 browser=await chromium.launch({executablePath:await slim.executablePath(),headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
}
const report={scenario,browser:browser.version(),date:new Date().toISOString(),checks:[],errors:[],printVerification:'NOT VERIFIED — Print Preview/Physical Print Not Tested'};
const verify=async(name,fn,status='VERIFIED — Browser DOM/Popup or PDF output')=>{await fn();report.checks.push({name,status});console.log(`VERIFIED — ${name}`)};

async function unitSuite(baseline=''){
 const context=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block'});
 const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
 if(baseline){
  await page.route('**/js/**',async route=>{
   const file=new URL(route.request().url()).pathname.slice(1);let body;
   try{body=execFileSync('git',['show',`${baseline}:${file}`],{cwd:repository,encoding:'utf8',stdio:['ignore','pipe','ignore']})}catch{await route.continue();return}
   await route.fulfill({body,contentType:'application/javascript'});
  });
  await page.route('**/tests.html',async route=>{
   let body=execFileSync('git',['show',`${baseline}:tests.html`],{cwd:repository,encoding:'utf8'});
   // Some pre-existing tests replace document.body, removing the old reporter.
   body=body.replace("const r=await run();document.querySelector('#out').innerHTML=","const r=await run();let output=document.querySelector('#out');if(!output){output=document.createElement('div');output.id='out';document.body.append(output)}output.innerHTML=");
   await route.fulfill({body,contentType:'text/html'});
  });
 }
 await page.goto(`${base}/tests.html`);await page.waitForSelector('#out ol',{timeout:60000});
 const summary=await page.locator('#out p').textContent(),failures=await page.locator('#out .fail').allTextContents();
 const result={summary,failures,errors};await context.close();return result;
}

async function reveal(locator){
 await locator.evaluate(element=>{for(let node=element;node;node=node.parentElement){if(node.dataset.collapseReady==='true')node.dispatchEvent(new CustomEvent('collapse:bulk',{detail:{collapsed:false,persist:false}}));if(node.tagName==='DETAILS')node.open=true}});
}
async function openTools(locator){
 await locator.waitFor({state:'attached'});await reveal(locator);
 if(await locator.locator('.dg-shell-toggle').getAttribute('aria-expanded')==='false')await locator.locator('.dg-shell-toggle').click();
 if(await locator.locator('.dg-tools-summary-toggle').getAttribute('aria-expanded')==='false')await locator.locator('.dg-tools-summary-toggle').click();
}
async function printPopup(locator,{screenshot='',button='.dg-print'}={}){
 await openTools(locator);
 const opened=locator.page().context().waitForEvent('page');await locator.locator(button).click();const popup=await opened;
 popup.on('pageerror',error=>report.errors.push(error.message));
 await popup.waitForFunction(()=>document.querySelector('.dg-print-header')&&window.__printRequested>0,null,{timeout:20000});
 const data=await popup.evaluate(()=>({
  fields:Object.fromEntries([...document.querySelectorAll('.dg-print-context div')].map(node=>[node.querySelector('dt').textContent,node.querySelector('dd').textContent])),
  title:document.querySelector('h1').textContent,
  columns:[...document.querySelectorAll('thead th')].map(node=>node.dataset.column),
  rows:[...document.querySelectorAll('tbody tr')].map(row=>row.textContent),
  cells:[...document.querySelectorAll('tbody tr')].map(row=>[...row.cells].map(cell=>cell.textContent)),
  meta:document.querySelector('.dg-print-meta')?.textContent||'',
  filters:document.querySelector('.dg-print-filters')?.textContent||'',
  scriptClosed:document.scripts.length===1,theadDisplay:getComputedStyle(document.querySelector('thead')).display,
  contextHeaders:document.querySelectorAll('.dg-print-header').length
 }));
 if(screenshot)await popup.screenshot({path:path.join(artifactDir,screenshot),fullPage:true});
 await popup.close();return data;
}
async function appContext(serviceWorkers='block'){
 const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true,serviceWorkers});
 await context.addInitScript(()=>{window.print=()=>{window.__printRequested=(window.__printRequested||0)+1}});
 await context.route('https://fonts.googleapis.com/**',route=>route.fulfill({body:'',contentType:'text/css'}));
 return context;
}
async function waitForApp(page){
 await page.waitForFunction(()=>window.__LAW_OFFICE_APP__?.office&&!window.__LAW_OFFICE_APP__.booting&&!document.querySelector('.error-box'),null,{timeout:60000});
 await page.evaluate(()=>window.__LAW_OFFICE_APP__.maintenance);
}
async function snapshotOffice(page){
 // Raw, read-only snapshots of the bounded synthetic fixture include tombstones.
 // This is test evidence, never a runtime DataGrid getAll/query implementation.
 return page.evaluate(async()=>{
  const ctx=window.__LAW_OFFICE_APP__.office.ctx;ctx.assert();
  const stores=[...ctx.db.objectStoreNames],tx=ctx.db.transaction(stores,'readonly');
  const rows=await Promise.all(stores.map(store=>new Promise((resolve,reject)=>{
   const request=tx.objectStore(store).getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  })));
  ctx.assert();return Object.fromEntries(stores.map((store,index)=>[store,rows[index]]));
 });
}
async function waitGrid(page,marker){
 await page.waitForFunction(marker=>{
  const root=document.querySelector('#list-grid');
  return root&&!root.querySelector('.dg-state.is-loading,.dg-state.is-error')&&root.querySelector('tbody tr[data-i] td[data-k="type"]')?.textContent===marker;
 },marker,{timeout:20000});
}
async function referenceFilter(page,key,id){
 await openTools(page.locator('#list-grid'));
 await page.locator(`#list-grid th[data-key="${key}"] .dg-fbtn`).click();
 await page.locator('.dg-ref-choice').selectOption(id);await page.locator('.dg-pop .dg-apply').click();
}
async function clearReferenceFilter(page,key){
 await page.locator(`#list-grid th[data-key="${key}"] .dg-fbtn`).click();await page.locator('.dg-pop .dg-reset').click();
}
const printedMarkers=output=>output.cells.map(cells=>cells[output.columns.indexOf('type')]);

async function verifyCursorButtons(){
 const context=await appContext(),page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));
 try{
  await page.goto(`${base}/index.html`,{waitUntil:'domcontentloaded'});await waitForApp(page);
  const dates=await page.evaluate(async()=>{
   const {createGridFixture,seedGridDateRows}=await import('./js/tests/grid-context-tests.js');
   const fixture=window.__gridFixture=await createGridFixture(),ordered=await seedGridDateRows(fixture),app=window.__LAW_OFFICE_APP__;
   app.ctx=fixture.ctx;app.office=fixture.office;
   return {from:ordered[0].hearingDate,to:ordered.at(-1).hearingDate,markers:ordered.map(row=>row.type)};
  });
  const before=await snapshotOffice(page),go=route=>page.evaluate(route=>window.__LAW_OFFICE_APP__.go(route),route);
  const grid=page.locator('#list-grid');
  await go('hearings');await waitGrid(page,'ملف مشترك');await openTools(grid);
  await grid.locator('tbody tr[data-i]').filter({has:page.locator('td[data-k="type"]',{hasText:'طلب'})}).locator('.dg-rowchk').check();
  await grid.locator('.dg-page-next').click();await waitGrid(page,'DATED-207');await grid.locator('.dg-rowchk[data-i="0"]').check();
  const selectedCount=await grid.locator('.dg-sel-count').textContent();
  let output=await printPopup(grid,{button:'.dg-sel-print'});
  await verify('Application buttons: cross-page selection prints both original rows and honest metadata',async()=>{
   assert.deepEqual(printedMarkers(output),['طلب','DATED-207']);assert.ok(output.meta.includes('عبر الصفحات'));assert.ok(!output.meta.includes('الصفحة الحالية'));
   assert.ok(!('الموكل' in output.fields));assert.equal(await grid.locator('.dg-sel-count').textContent(),selectedCount);
   assert.ok((await grid.locator('.dg-provider-note').textContent()).includes('أوامر المحدد'));
  });
  await referenceFilter(page,'clientId','c1');await waitGrid(page,'ملف مشترك');
  const queryPrefs=await page.evaluate(async()=>{const {prefs}=await import('./js/core/preferences.js');return JSON.stringify(prefs.get('grid:list:hearings'))});
  output=await printPopup(grid,{button:'.dg-sel-print'});
  await verify('Application buttons: off-client-filter selection is complete and cannot acquire a false client header',async()=>{
   assert.deepEqual(printedMarkers(output),['طلب','DATED-207']);assert.ok(!('الموكل' in output.fields));assert.ok(output.columns.includes('clientId'));
   assert.ok(output.rows.some(row=>row.includes('موكل آخر')));assert.ok(output.filters.includes('لا تُطبق مجددًا'));assert.ok(output.filters.includes('فاطمة'));
   assert.equal(await grid.locator('.dg-sel-count').textContent(),selectedCount);
   assert.equal(await page.evaluate(async()=>{const {prefs}=await import('./js/core/preferences.js');return JSON.stringify(prefs.get('grid:list:hearings'))}),queryPrefs);
  });
  await clearReferenceFilter(page,'clientId');await waitGrid(page,'ملف مشترك');
  await referenceFilter(page,'fileId','f1');await waitGrid(page,'مرافعة');output=await printPopup(grid,{button:'.dg-sel-print'});
  await verify('Application buttons: off-file-filter selection cannot acquire a false file or official-case header',()=>{
   assert.deepEqual(printedMarkers(output),['طلب','DATED-207']);assert.ok(!('رقم الملف / نوع الملف' in output.fields));assert.ok(!('رقم الدعوى / القضية' in output.fields));assert.ok(!('الموكل' in output.fields));
  });
  await grid.locator('.dg-sel-clear').click();await grid.locator('.dg-reset-btn').click();await waitGrid(page,'ملف مشترك');
  await reveal(page.locator('.list-filter-panel'));await page.locator('[data-preset="custom"]').click();
  const displayDate=value=>value.split('-').reverse().join('/');
  await page.locator('#list-from__dmy').fill(displayDate(dates.from));await page.locator('#list-to__dmy').fill(displayDate(dates.to));
  await page.locator('[data-range-apply]').click();await waitGrid(page,'DATED-229');await openTools(grid);
  await grid.locator('th[data-key="hearingDate"] .dg-sort').click();await waitGrid(page,'DATED-000');output=await printPopup(grid);
  await verify('Application buttons: date-range current-page print has 25 ASC rows and no invented client context',()=>{
   assert.deepEqual(printedMarkers(output),dates.markers.slice(0,25));assert.ok(output.meta.includes('الصفحة الحالية'));assert.ok(!('الموكل' in output.fields));assert.ok(output.filters.includes(displayDate(dates.from)));assert.ok(output.filters.includes(displayDate(dates.to)));
  });
  report.cursorButtons={selectionRows:2,dateRows:230,directions:{}};
  for(const direction of ['asc','desc']){
   const expected=direction==='asc'?dates.markers:[...dates.markers].reverse();
   if(direction==='desc'){await grid.locator('th[data-key="hearingDate"] .dg-sort').click();await waitGrid(page,expected[0])}
   const actual=[];let pages=0;
   do{
    await waitGrid(page,expected[actual.length]);
    actual.push(...await grid.locator('tbody tr[data-i] td[data-k="type"]').allTextContents());pages++;
    if(!await grid.locator('.dg-page-next').isEnabled())break;
    assert.ok(pages<=10,'Date cursor did not terminate');await grid.locator('.dg-page-next').click();
   }while(true);
   assert.deepEqual(actual,expected);assert.equal(new Set(actual).size,230);assert.equal(pages,10);
   assert.ok(!(await grid.locator('.dg-provider-note').textContent()).includes('الفرز الكامل غير متاح'));
   report.cursorButtons.directions[direction]={pages,rows:actual.length};
  }
  await verify('Application buttons: indexed date-range ASC/DESC cursor pagination visits all 230 rows exactly once per direction',()=>{
   assert.deepEqual(report.cursorButtons.directions,{asc:{pages:10,rows:230},desc:{pages:10,rows:230}});
  });
  await verify(`Cursor-button scenarios preserve all raw fixture records, tombstones, IDs and Schema ${SCHEMA_VERSION}`,async()=>{
   assert.deepEqual(await snapshotOffice(page),before);assert.equal(await page.evaluate(()=>window.__gridFixture.db.version),SCHEMA_VERSION);
  });
  await page.evaluate(()=>window.__gridFixture.dispose());
 }finally{await context.close()}
}

async function verifyOffline(){
 const source=await fs.readFile(path.join(repository,'sw.js'),'utf8'),cacheName=source.match(/const CACHE='([^']+)'/)[1];
 const assets=[...source.matchAll(/^\s+"(\.\/[^"\n]*)",?\s*$/gm)].map(match=>match[1]);assert.ok(assets.length>100);
 // Follow actual static, side-effect, re-export and literal dynamic imports.
 // Unused helper files are not runtime dependencies and need no cache changes.
 const runtimeGraph=new Set(),pending=['js/app.js'];
 const importPatterns=[/\b(?:import|export)\s+[^'";]*?\bfrom\s*['"](\.\.?\/[^'"]+)['"]/g,/\bimport\s*['"](\.\.?\/[^'"]+)['"]/g,/\bimport\(\s*['"](\.\.?\/[^'"]+)['"]\s*\)/g];
 while(pending.length){
  const file=pending.pop();if(runtimeGraph.has(file))continue;runtimeGraph.add(file);
  const text=await fs.readFile(path.join(repository,file),'utf8');
  for(const pattern of importPatterns)for(const match of text.matchAll(pattern)){
   const dependency=path.posix.normalize(path.posix.join(path.posix.dirname(file),match[1]));
   if(dependency.endsWith('.js'))pending.push(dependency);
  }
 }
 const runtimeFiles=[...runtimeGraph].sort(),missingRuntime=runtimeFiles.filter(file=>!assets.includes('./'+file));
 assert.deepEqual(missingRuntime,[],'Service-worker precache is missing runtime modules');
 const modules=['js/core/grid-print-context.js','js/services/grid-relations.js','js/db/grid-data-provider.js','js/ui/datagrid.js','js/services/timeline.js'];
 const context=await appContext('allow'),page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));
 let offline=false;const responses=[],consoleErrors=[],failedRequests=[];
 page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text())});
 page.on('requestfailed',request=>failedRequests.push({url:request.url(),error:request.failure()?.errorText}));
 page.on('response',response=>{if(offline&&response.url().startsWith(`${base}/`))responses.push({path:new URL(response.url()).pathname,status:response.status(),serviceWorker:response.fromServiceWorker()})});
 try{
  // Seed obsolete release caches BEFORE any service-worker registration. All
  // browser storage belongs to this fresh, isolated test context.
  await page.goto(`${base}/manifest.webmanifest`);
  const oldCaches=['ahmad-khudair-law-office-v5.6.0-offline1','ahmad-khudair-law-office-v5.6.0-grid-context1','ahmad-khudair-law-office-v5.6.0-grid-context2'];
  await page.evaluate(async names=>{for(const name of names){const cache=await caches.open(name);await cache.put('./__grid-stale-cache__.js',new Response('obsolete test cache'))}},oldCaches);
  await page.goto(`${base}/index.html`,{waitUntil:'domcontentloaded'});await waitForApp(page);
  await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller),null,{timeout:60000});
  const cacheState=await page.evaluate(async({cacheName,assets,modules,base})=>{
   const registration=await navigator.serviceWorker.ready,cache=await caches.open(cacheName),missing=[],contents={};
   for(const asset of assets){const response=await cache.match(new URL(asset,`${base}/`));if(!response?.ok)missing.push(asset)}
   for(const module of modules){const response=await cache.match(new URL(module,`${base}/`));contents[module]=response?await response.text():null}
   return {keys:await caches.keys(),missing,contents,controller:navigator.serviceWorker.controller.scriptURL,scope:registration.scope,stale:Boolean(await caches.match(new URL('./__grid-stale-cache__.js',`${base}/`)))};
  },{cacheName,assets,modules,base});
  await verify('Service Worker: installation controls the page, removes prior caches, and precaches the current complete runtime graph',async()=>{
   assert.deepEqual(cacheState.keys,[cacheName]);assert.deepEqual(cacheState.missing,[]);assert.equal(cacheState.stale,false);
   for(const module of modules)assert.equal(cacheState.contents[module],await fs.readFile(path.join(repository,module),'utf8'),`Stale cached module: ${module}`);
  },'VERIFIED — Service Worker/cache output');
  const profile=await page.evaluate(async()=>{
   const {createGridFixture}=await import('./js/tests/grid-context-tests.js'),{SCHEMA_VERSION}=await import('./js/core/constants.js'),fixture=await createGridFixture(),app=window.__LAW_OFFICE_APP__;
   const profile=app.registry.adoptExisting({databaseName:fixture.name,version:SCHEMA_VERSION,displayName:'اختبار الجداول دون اتصال'});
   for(const other of app.registry.data.profiles)if(other.id!==profile.id)app.registry.archive(other.id);
   await app.switchDb(profile.id);const maintenance=await app.maintenance;await app.maybeSeedDemo();fixture.ctx.close();
   return {id:profile.id,databaseName:profile.databaseName,maintenance};
  });
  assert.ok(!profile.maintenance?.clientFilesError,'Fixture maintenance must finish before offline integrity assertions');
  const before=await snapshotOffice(page);offline=true;await context.setOffline(true);
  const navigation=await page.reload({waitUntil:'domcontentloaded'});await waitForApp(page);
  const after=await snapshotOffice(page),bootChanges=[];
  const normalized=structuredClone(after),prior=structuredClone(before);
  // runMaintenance() predates this feature and updates this timestamp on every
  // boot. Account for ONLY that field; never ignore an entire store or record.
  const oldMaintenance=prior.meta.find(row=>row.id==='maintenance'),newMaintenance=normalized.meta.find(row=>row.id==='maintenance');
  assert.ok(oldMaintenance&&newMaintenance);
  if(oldMaintenance.lastRunAt!==newMaintenance.lastRunAt)bootChanges.push({store:'meta',id:'maintenance',field:'lastRunAt',before:oldMaintenance.lastRunAt,after:newMaintenance.lastRunAt});
  delete oldMaintenance.lastRunAt;delete newMaintenance.lastRunAt;
  // The execution-section migration is a one-time, additive, idempotent boot step:
  // on the FIRST boot of a database it writes one meta row plus one activity entry
  // (withIssues/scanned counters and a per-execution before/after report), and on
  // every later boot it must write nothing at all. Allow exactly that row and its
  // own log entry here, and prove idempotency with a second reload below.
  const priorMigration=prior.meta.find(row=>row.id==='executionSimpleMigration');
  const newMigration=normalized.meta.find(row=>row.id==='executionSimpleMigration');
  if(!priorMigration&&newMigration){
   assert.equal(newMigration.version,1,'executionSimpleMigration version');
   assert.equal(newMigration.hasMore,false,'first migration run must finish within its page cap for this fixture');
   assert.ok(newMigration.completedAt,'first migration run must stamp completedAt');
   bootChanges.push({store:'meta',id:'executionSimpleMigration',field:'(one-time additive row)',before:null,after:{scanned:newMigration.scanned,withIssues:newMigration.withIssues}});
   normalized.meta=normalized.meta.filter(row=>row.id!=='executionSimpleMigration');
  }
  const isMigrationLog=row=>row.entityType==='meta'&&row.entityId==='executionSimpleMigration'&&row.action==='execution_simple_migration';
  const priorLog=(prior.activityLog||[]).filter(isMigrationLog);
  const newLog=(normalized.activityLog||[]).filter(isMigrationLog);
  assert.ok(priorLog.length<=1,`fixture has duplicate execution migration logs: ${priorLog.length}`);
  assert.ok(newLog.length<=1,`one-time migration must log at most once, got ${newLog.length}`);
  if(priorLog.length){
   assert.deepEqual(newLog,priorLog,'an already-recorded execution migration log must remain unchanged on offline reload');
  }else if(newLog.length){
   bootChanges.push({store:'activityLog',action:'execution_simple_migration',field:'(one-time additive entry)',before:0,after:newLog.length});
  }
  normalized.activityLog=(normalized.activityLog||[]).filter(row=>!isMigrationLog(row));
  prior.activityLog=(prior.activityLog||[]).filter(row=>!isMigrationLog(row));
  await verify(`Offline reload: app boots from the controlled cache with the same office/Schema ${SCHEMA_VERSION} and only the existing maintenance timestamp update`,async()=>{
   assert.equal(navigation.fromServiceWorker(),true);assert.equal(await page.evaluate(()=>navigator.onLine),false);
   assert.equal(await page.evaluate(()=>window.__LAW_OFFICE_APP__.ctx.profile.id),profile.id);
   assert.equal(await page.evaluate(()=>window.__LAW_OFFICE_APP__.ctx.db.name),profile.databaseName);assert.equal(await page.evaluate(()=>window.__LAW_OFFICE_APP__.ctx.db.version),SCHEMA_VERSION);
   assert.deepEqual(normalized,prior);assert.ok((await page.locator('#network-badge').textContent()).includes('عدم الاتصال'));
   for(const module of modules)assert.ok(responses.some(response=>response.path.endsWith('/'+module)&&response.serviceWorker&&response.status===200),`Module not served offline by SW: ${module}`);
  },'VERIFIED — Offline browser/cache output');
  const stripVolatileBoot=snapshot=>{
   const copy=structuredClone(snapshot);
   const maintenance=copy.meta?.find(row=>row.id==='maintenance');
   if(maintenance)delete maintenance.lastRunAt;
   return copy;
  };
  const firstBootSnapshot=await snapshotOffice(page);
  await page.reload({waitUntil:'domcontentloaded'});await waitForApp(page);
  const secondBootSnapshot=await snapshotOffice(page);
  const firstStable=stripVolatileBoot(firstBootSnapshot),secondStable=stripVolatileBoot(secondBootSnapshot);
  const secondChanges=[];
  for(const store of Object.keys(secondStable)){
   if(JSON.stringify(firstStable[store])!==JSON.stringify(secondStable[store]))secondChanges.push(store);
  }
  await verify('Second offline boot re-runs the one-time execution migration as a strict no-op (idempotent, nothing rewritten)',async()=>{
   assert.deepEqual(secondChanges,[]);
   const migration=secondBootSnapshot.meta.find(row=>row.id==='executionSimpleMigration');
   assert.equal(migration.completedAt,firstBootSnapshot.meta.find(row=>row.id==='executionSimpleMigration')?.completedAt);
  },'VERIFIED — Offline browser/cache output');
  report.bootChanges=bootChanges;
  const go=route=>page.evaluate(route=>window.__LAW_OFFICE_APP__.go(route),route);
  await go('cfile:c1?cat=civil');let output=await printPopup(page.locator('.lf-grid'));
  assert.equal(output.fields['الموكل'],'فاطمة محمد إبراهيم محمد');assert.ok(!output.columns.includes('clientId'));
  await go('file:f1');await page.locator('[data-tab="hearings"]').click();output=await printPopup(page.locator('#file-tab .dg'));
  await verify('Offline application buttons: client-file and file-hearing popup documents resolve original context without an online route warm-up',()=>{
   assert.equal(output.fields['الموكل'],'فاطمة محمد إبراهيم محمد');assert.equal(output.fields['رقم الملف / نوع الملف'],'2/2026 — دعوى');assert.equal(output.fields['رقم الدعوى / القضية'],'4661/2026');assert.equal(output.rows.length,1);
  },'VERIFIED — Offline DOM/popup output');
  await verify('Offline table navigation and popup printing preserve every raw office store after boot',async()=>{
   // Reference is the snapshot taken right after the most recent boot; no reload happens
   // between the two reads, so nothing at all may differ (not even the migration row).
   assert.deepEqual(await snapshotOffice(page),secondBootSnapshot);assert.deepEqual(report.errors,[]);
  },'VERIFIED — Offline data integrity output');
  report.offline={cache:cacheName,precachedAssets:assets.length,runtimeModules:runtimeFiles.length,verifiedModules:modules,oldCachesRemoved:oldCaches,bootChanges,responses,profileId:profile.id,schema:SCHEMA_VERSION};
 }catch(error){
  report.offlineFailure={message:error.message,responses,consoleErrors,failedRequests,state:await page.evaluate(()=>({
   ready:document.readyState,app:Boolean(window.__LAW_OFFICE_APP__),booting:window.__LAW_OFFICE_APP__?.booting,
   office:Boolean(window.__LAW_OFFICE_APP__?.office),error:document.querySelector('.error-box')?.textContent||'',
   controller:navigator.serviceWorker.controller?.scriptURL,body:document.body.textContent.slice(0,1500)
  })).catch(()=>null)};
  throw error;
 }finally{await context.close()}
}

async function verifyFullSuite(){
 report.unitSuite=await unitSuite();
 if(process.env.GRID_BASELINE){
  report.baseline=await unitSuite(process.env.GRID_BASELINE);
  const regressions=report.unitSuite.failures.filter(failure=>!report.baseline.failures.includes(failure));
  await verify('Full browser suite has no new failures relative to the supplied base commit',()=>{assert.equal(regressions.length,0,regressions.join('\n'));assert.equal(report.unitSuite.errors.length,0)});
 }else if(report.unitSuite.failures.length){
  throw new Error(`Browser unit-suite failures (set GRID_BASELINE to compare pre-existing failures):\n${report.unitSuite.failures.join('\n')}`);
 }
 const context=await appContext();
 const page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));
 await page.goto(`${base}/index.html`,{waitUntil:'domcontentloaded'});
 await waitForApp(page);
 await page.evaluate(async()=>{
  const {createGridFixture}=await import('./js/tests/grid-context-tests.js');
  const fixture=window.__gridFixture=await createGridFixture(),app=window.__LAW_OFFICE_APP__;
  window.__originalAppContext=app.ctx;app.ctx=fixture.ctx;app.office=fixture.office;
  window.__gridBefore=await fixture.snapshot();
 });
 const go=async route=>{await page.evaluate(route=>window.__LAW_OFFICE_APP__.go(route),route)};
 const client='فاطمة محمد إبراهيم محمد';
 await go('cfile:c1?cat=civil');
 let output=await printPopup(page.locator('.lf-grid'),{screenshot:'client-files-print.png'});
 await verify('Client-file page print popup: original client once in context, no redundant client column',()=>{assert.equal(output.fields['الموكل'],client);assert.equal(output.title,'ملفات الموكل');assert.ok(!output.columns.includes('clientId'));assert.ok(!output.rows.some(row=>row.includes(client)));assert.equal(output.scriptClosed,true)});
 await go('file:f1');await page.locator('[data-tab="hearings"]').click();
 output=await printPopup(page.locator('#file-tab .dg'));
 await verify('File hearings popup: distinct internal file/type and official case number',()=>{assert.equal(output.fields['الموكل'],client);assert.equal(output.fields['رقم الملف / نوع الملف'],'2/2026 — دعوى');assert.equal(output.fields['رقم الدعوى / القضية'],'4661/2026');assert.equal(output.rows.length,1)});
 await page.locator('[data-tab="procedures"]').click();output=await printPopup(page.locator('#file-tab .dg'));
 await verify('File administrative work popup receives the same centralized PrintContext',()=>{assert.equal(output.fields['الموكل'],client);assert.equal(output.fields['رقم الملف / نوع الملف'],'2/2026 — دعوى');assert.equal(output.rows.length,1)});
 await page.locator('[data-tab="judgments"]').click();output=await printPopup(page.locator('#file-tab .dg'));
 await verify('File judgment popup resolves case-only row links',()=>{assert.equal(output.fields['الموكل'],client);assert.equal(output.fields['رقم الدعوى / القضية'],'4661/2026');assert.equal(output.rows.length,1)});
 await page.locator('[data-tab="serviceRecords"]').click();output=await printPopup(page.locator('#file-tab .dg'));
 await verify('File service records popup preserves the client/file context',()=>{assert.equal(output.fields['الموكل'],client);assert.equal(output.rows.length,1)});
 await page.locator('[data-tab="relations"]').click();await page.waitForSelector('#file-tab th[data-key="otherLabel"]');
 const relationValues=await page.locator('#file-tab td[data-k="clientId"]').allTextContents();
 output=await printPopup(page.locator('#file-tab .dg'));
 await verify('File relations table has real linked-file clients/opponents without confusing print scope',()=>{assert.ok(relationValues[0].includes('أحمد محمود علي'));assert.equal(output.fields['رقم الملف / نوع الملف'],'2/2026 — دعوى');assert.ok(output.columns.includes('opponentId'))});
 await page.locator('[data-tab="activity"]').click();await page.waitForSelector('#file-tab th[data-key="entityType"]');
 const auditFiles=await page.locator('#file-tab td[data-k="fileId"]').allTextContents();output=await printPopup(page.locator('#file-tab .dg'));
 await verify('File activity resolves historical entity-only links without copying names into audit records',()=>{assert.ok(auditFiles.every(text=>text.includes('2/2026')));assert.equal(output.fields['الموكل'],client)});
 await go('client:c1');await page.waitForSelector('[data-grid="files"] tbody tr[data-i]',{state:'attached'});
 output=await printPopup(page.locator('[data-grid="files"]'));
 await verify('Client details files use original client context while retaining a co-client column for joint files',()=>{assert.equal(output.fields['الموكل'],client);assert.ok(output.columns.includes('clientId'));assert.ok(output.rows.some(row=>row.includes('أحمد محمود علي')))});
 await go('clients');await page.waitForSelector('#list-grid tbody tr[data-i]');
 output=await printPopup(page.locator('#list-grid'));
 await verify('General client directory print has no fabricated single-client header',()=>{assert.ok(!('الموكل' in output.fields));assert.ok(output.columns.includes('fullName'));assert.equal(output.rows.length,4)});
 await go('reports?type=hearings&preset=all');await page.waitForSelector('#report-grid tbody tr[data-i]');
 output=await printPopup(page.locator('#report-grid'));
 await verify('General report print keeps several clients in rows, not one false context',()=>{assert.ok(!('الموكل' in output.fields));assert.equal(output.rows.length,3);assert.ok(output.columns.includes('clientId'))});
 await openTools(page.locator('#report-grid'));
 await page.locator('#report-grid th[data-key="clientId"] .dg-fbtn').click();
 await page.locator('.dg-ref-choice').selectOption('c1');await page.locator('.dg-pop .dg-apply').click();
 output=await printPopup(page.locator('#report-grid'));
 await verify('Client-filtered report print uses the selected client ID and reports active filters',()=>{assert.equal(output.fields['الموكل'],client);assert.equal(output.rows.length,2);assert.ok(output.filters.includes(client));assert.ok(output.rows.some(row=>row.includes('أحمد محمود علي')))});
 await go('bailiffs');await page.waitForSelector('#list-grid tbody tr[data-i]');output=await printPopup(page.locator('#list-grid'));
 await verify('Unrelated table print omits client/file/case fields instead of printing empty labels',()=>{assert.deepEqual(Object.keys(output.fields),['تاريخ الطباعة']);assert.equal(output.rows.length,1)});
 await go('integrity');
 await page.locator('#load-audit').evaluate(element=>{for(let parent=element.parentElement;parent;parent=parent.parentElement)if(parent.dataset.collapseReady==='true')parent.dispatchEvent(new CustomEvent('collapse:bulk',{detail:{collapsed:false,persist:false}}))});
 await page.locator('#audit-type').selectOption('files');await page.locator('#load-audit').click();
 await page.waitForSelector('#audit-results th[data-key="fileId"]',{state:'attached'});output=await printPopup(page.locator('#audit-results'));
 await verify('Audit history reuses the same grid/print pipeline and resolves old entity-only file records',async()=>{
  assert.equal(await page.locator('#audit-results').getAttribute('data-grid-id'),'grid:integrity:audit');
  assert.ok(output.rows[0].includes('2/2026'));assert.ok(!('الموكل' in output.fields));assert.ok(output.filters.includes('200'));assert.ok(output.columns.includes('opponentId'));
 });
 await go('files');await page.waitForSelector('#list-grid tbody tr[data-i]');await openTools(page.locator('#list-grid'));
 const keys=await page.locator('#list-grid thead th[data-key]').evaluateAll(nodes=>nodes.map(node=>node.dataset.key));
 await verify('Legal file table exposes three independent columns, not concatenated file titles',()=>{assert.deepEqual(keys.slice(0,3),['fileNumber','clientId','opponentId'])});
 await page.locator('#list-grid .dg-cols-btn').click();
 await page.locator('.dg-cols-list input[value="title"]').uncheck();
 await page.locator('.dg-cols-list li[data-k="opponentId"] [data-mv="-1"]').click();await page.locator('.dg-pop .dg-x').click();
 await page.locator('#list-grid th[data-key="opponentId"] .dg-resizer').press('ArrowLeft');
 await page.locator('#list-grid th[data-key="fileNumber"] .dg-sort').click();
 await page.locator('#list-grid .dg-state.is-loading').waitFor({state:'hidden'});
 const filePrefs=await page.evaluate(async()=>{const {prefs}=await import('./js/core/preferences.js');return JSON.stringify(prefs.get('grid:list:files'))});
 output=await printPopup(page.locator('#list-grid'));
 await verify('Print respects chosen columns/order/widths and does not change persisted grid preferences',async()=>{
  assert.ok(!output.columns.includes('title'));assert.deepEqual(output.columns.slice(0,3),['fileNumber','opponentId','clientId']);
  assert.equal(await page.evaluate(async()=>{const {prefs}=await import('./js/core/preferences.js');return JSON.stringify(prefs.get('grid:list:files'))}),filePrefs);
 });
 await go('hearings');await page.waitForSelector('#list-grid tbody tr[data-i]');
 await verify('File-table preferences do not leak into the hearings table',async()=>{
  assert.ok(await page.locator('#list-grid th[data-key="clientId"]').count());
  assert.deepEqual(await page.locator('#list-grid thead th[data-key]').evaluateAll(nodes=>nodes.slice(0,3).map(node=>node.dataset.key)),['fileId','clientId','opponentId']);
 });
 // caseNotes is intentionally excluded: since v5.11.0 the legacy route is an alias to the
 // single Quick Notes surface (PAGES.caseNotes=PAGES.quickNotes), which mounts #quick-notes-root
 // instead of the shared DataGrid. Its own browser suite (quick-notes-browser) covers it.
 const otherLists=['opponents','cases','procedures','judgments','communications','powersOfAttorney','serviceRecords','appointments','fees','feePayments','execution','expertReports','documentReferences'];
 await verify('Every other file-associated list mounts with three real shared columns and an independent stable grid ID',async()=>{
  for(const store of otherLists){
   await go(store);await page.waitForSelector('#list-grid th[data-key]',{state:'attached'});await page.locator('#list-grid .dg-state.is-loading').waitFor({state:'hidden'});
   assert.equal(await page.locator('#list-grid').getAttribute('data-grid-id'),`grid:list:${store}`);
   const labels=await page.locator('#list-grid th[data-key]').evaluateAll(nodes=>nodes.slice(0,3).map(node=>node.querySelector('.dg-coltitle').textContent));
   assert.deepEqual(labels,['رقم الملف / نوع الملف','الموكل','الخصم'],store);
  }
 });
 await verify('Legacy caseNotes route opens the single Quick Notes surface, not a second notes list',async()=>{
  await go('caseNotes');
  await page.waitForSelector('#quick-notes-root');
  assert.equal(await page.locator('#list-grid').count(),0);
 });
 await go('search?q=4661&scope=cases');await page.waitForSelector('[data-group="cases"] .dg tbody tr[data-i]',{state:'attached'});
 await verify('File-associated search results use the existing DataGrid and real shared columns',async()=>{assert.equal(await page.locator('[data-group="cases"] .dg').getAttribute('data-grid-id'),'grid:search:cases')});
 await page.locator('#advanced-q').press('ArrowDown');
 await verify('Search keyboard highlight and Enter still open the original source route',async()=>{
  assert.ok(await page.locator('[data-group="cases"] tr.kbd-focus').isVisible());
  await page.locator('#advanced-q').press('Enter');await page.waitForFunction(()=>window.__LAW_OFFICE_APP__.route==='case:ca1');
 });
 await go('files');await page.waitForSelector('#list-grid tbody tr[data-i]');await openTools(page.locator('#list-grid'));
 await page.locator('#list-grid td[data-k="opponentId"] .dg-cell-more').first().click();
 await verify('Compact +N popup retains all opponents, unregistered parties and inactive-role details',async()=>{
  assert.equal(await page.locator('.dg-cell-details li').count(),6);
  assert.ok((await page.locator('.dg-cell-details').textContent()).includes('غير نشط'));await page.locator('.dg-pop .dg-x').click();
 });
 await page.locator('#list-grid .dg-rowchk[data-i="0"]').check();output=await printPopup(page.locator('#list-grid'),{button:'.dg-sel-print'});
 await verify('Selected-rows Print uses the same popup/context pipeline without inferring a client from one row',()=>{assert.equal(output.rows.length,1);assert.ok(!('الموكل' in output.fields))});
 await page.setViewportSize({width:390,height:844});await openTools(page.locator('#list-grid'));
 await page.locator('#list-grid .dg-cards-btn').click();
 await verify('Responsive grid presentation retains file/client/opponent labels on mobile',async()=>{
  assert.ok(await page.locator('#list-grid.dg-cards td[data-label="الخصم"]').count());
  assert.ok(await page.locator('#list-grid.dg-cards td[data-label="الموكل"]').count());
  assert.equal(await page.locator('#list-grid .dg-scroll').evaluate(element=>element.getBoundingClientRect().width<=window.innerWidth),true);
 });
 await page.screenshot({path:path.join(artifactDir,'mobile-grid.png'),fullPage:true});
 await page.setViewportSize({width:1440,height:1000});
 const html=await page.evaluate(async()=>{
  const fixture=window.__gridFixture,{createGridRelations}=await import('./js/services/grid-relations.js'),{legalFileColumns}=await import('./js/ui/grid-columns.js'),{mountGrid}=await import('./js/ui/datagrid.js');
  const rows=Array.from({length:720},(_,index)=>({...fixture.rows.hearings[0],id:`pdf-${index}`,marker:`ROW-${index}`}));
  const relations=createGridRelations(fixture.office,'hearings');await relations.hydrate(rows);
  const root=document.createElement('div');root.id='browser-multipage';document.querySelector('#main-content').append(root);
  const columns=[...legalFileColumns(relations).filter(column=>column.contextRole!=='opponent'),{key:'marker',label:'REPEATED HEADER',width:180},{key:'hearingDate',label:'التاريخ',type:'date',width:150}];
  const grid=mountGrid(root,{rows,columns,storageKey:'browser:multipage',title:'جدول اختبار متعدد الصفحات',...relations.gridOptions({fileId:'f1'})});fixture.grids.push({root,grid});
  window.__multiGrid=grid;return grid.getPrintDocument();
 });
 await verify('Actual browser virtual scrolling keeps compact row heights stable and reaches the last of 720 rows',async()=>{
  assert.ok(await page.locator('#browser-multipage tbody tr[data-i]').count()<720);
  await page.locator('#browser-multipage .dg-scroll').evaluate(element=>{element.scrollTop=element.scrollHeight;element.dispatchEvent(new Event('scroll'))});
  await page.waitForSelector('#browser-multipage tr[data-i="719"]',{state:'attached'});
 });
 const printed=await context.newPage();await printed.setContent(html,{waitUntil:'load'});
 const buffer=await printed.pdf({path:path.join(artifactDir,'multipage.pdf'),preferCSSPageSize:true,printBackground:true});
 const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
 const pdfTask=getDocument({data:new Uint8Array(buffer),useSystemFonts:true}),pdf=await pdfTask.promise;
 const pages=[],arabicPages=[];
 for(let number=1;number<=pdf.numPages;number++){
  const page=await pdf.getPage(number),text=await page.getTextContent();pages.push(text.items.map(item=>item.str).join(' '));
  // Chromium's fallback Arabic font maps shaped glyphs in visual order. Use
  // NFKC and allow either glyph direction for extraction only, never for data.
  arabicPages.push(text.items.map(item=>item.str).join('').normalize('NFKC').replace(/\s/g,''));
 }
 const clientNeedles=['فاطمة',Array.from('فاطمة').reverse().join('')];
 report.pdf={pages:pdf.numPages,rows:720,headerCounts:pages.map(text=>(text.match(/REPEATED HEADER/g)||[]).length),clientPages:arabicPages.map((text,index)=>clientNeedles.some(needle=>text.includes(needle))?index+1:null).filter(Boolean)};
 await verify('Multi-page Chromium PDF contains every row and repeats the table header, not the client context',()=>{
  assert.ok(pdf.numPages>1);assert.ok(report.pdf.headerCounts.every(count=>count===1));assert.deepEqual(report.pdf.clientPages,[1]);
  for(let index=0;index<720;index++)assert.ok(pages.some(text=>new RegExp(`ROW-${index}(?!\\d)`).test(text)),`Missing ROW-${index}`);
 });
 await pdfTask.destroy();await printed.close();
 await verify(`All browser navigation/display/query/print actions leave every office store and Schema ${SCHEMA_VERSION} unchanged`,async()=>{
  assert.equal(await page.evaluate(()=>window.__gridFixture.snapshot()),await page.evaluate(()=>window.__gridBefore));
  assert.equal(await page.evaluate(()=>window.__gridFixture.db.version),SCHEMA_VERSION);assert.deepEqual(report.errors,[]);
 });
 await page.evaluate(()=>window.__gridFixture.dispose());await context.close();
 await verifyCursorButtons();await verifyOffline();
}

try{
 if(scenario==='offline')await verifyOffline();else await verifyFullSuite();
}catch(error){report.failure=error.stack||error.message;console.error(report.failure);process.exitCode=1}
finally{await browser.close();await fs.writeFile(path.join(artifactDir,'report.json'),JSON.stringify(report,null,2));console.log(report.printVerification);console.log(`Evidence (not committed): ${artifactDir}`)}
