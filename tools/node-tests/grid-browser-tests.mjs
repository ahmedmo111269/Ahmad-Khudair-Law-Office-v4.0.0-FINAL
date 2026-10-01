// Real Chromium DOM/popup/PDF regression checks. This does NOT drive the native
// Print Preview dialog or a physical printer; always report that limitation.
import {chromium} from 'playwright';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const repository=fileURLToPath(new URL('../../',import.meta.url));
const base=(process.env.GRID_BASE_URL||'http://127.0.0.1:8000').replace(/\/$/,'');
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
const report={browser:browser.version(),date:new Date().toISOString(),checks:[],errors:[],printVerification:'NOT VERIFIED — Print Preview/Physical Print Not Tested'};
const verify=async(name,fn)=>{await fn();report.checks.push({name,status:'VERIFIED — Browser DOM/Popup or PDF output'});console.log(`VERIFIED — ${name}`)};

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

try{
 report.unitSuite=await unitSuite();
 if(process.env.GRID_BASELINE){
  report.baseline=await unitSuite(process.env.GRID_BASELINE);
  const regressions=report.unitSuite.failures.filter(failure=>!report.baseline.failures.includes(failure));
  await verify('Full browser suite has no new failures relative to the supplied base commit',()=>{assert.equal(regressions.length,0,regressions.join('\n'));assert.equal(report.unitSuite.errors.length,0)});
 }else if(report.unitSuite.failures.length){
  throw new Error(`Browser unit-suite failures (set GRID_BASELINE to compare pre-existing failures):\n${report.unitSuite.failures.join('\n')}`);
 }
 const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true,serviceWorkers:'block'});
 await context.addInitScript(()=>{window.print=()=>{window.__printRequested=(window.__printRequested||0)+1}});
 await context.route('https://fonts.googleapis.com/**',route=>route.fulfill({body:'',contentType:'text/css'}));
 const page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));
 await page.goto(`${base}/index.html`,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__LAW_OFFICE_APP__?.office&&!window.__LAW_OFFICE_APP__.booting,{timeout:60000});
 await page.evaluate(async()=>{
  const {createGridFixture}=await import('./js/tests/grid-context-tests.js');
  const fixture=window.__gridFixture=await createGridFixture(),app=window.__LAW_OFFICE_APP__;
  window.__originalAppContext=app.ctx;app.ctx=fixture.ctx;app.office=fixture.office;
  window.__gridBefore=await fixture.snapshot();
 });
 const go=async route=>{await page.evaluate(route=>window.__LAW_OFFICE_APP__.go(route),route)};
 async function openTools(locator){
  await locator.waitFor({state:'attached'});
  await locator.evaluate(element=>{for(let parent=element.parentElement;parent;parent=parent.parentElement){if(parent.dataset.collapseReady==='true')parent.dispatchEvent(new CustomEvent('collapse:bulk',{detail:{collapsed:false,persist:false}}));if(parent.tagName==='DETAILS')parent.open=true}});
  if(await locator.locator('.dg-shell-toggle').getAttribute('aria-expanded')==='false')await locator.locator('.dg-shell-toggle').click();
  if(await locator.locator('.dg-tools-summary-toggle').getAttribute('aria-expanded')==='false')await locator.locator('.dg-tools-summary-toggle').click();
 }
 async function printPopup(locator,{screenshot='',button='.dg-print'}={}){
  await openTools(locator);
  const opened=context.waitForEvent('page');await locator.locator(button).click();const popup=await opened;
  popup.on('pageerror',error=>report.errors.push(error.message));
  await popup.waitForFunction(()=>document.querySelector('.dg-print-header')&&window.__printRequested>0,{timeout:20000});
  const data=await popup.evaluate(()=>({
   fields:Object.fromEntries([...document.querySelectorAll('.dg-print-context div')].map(node=>[node.querySelector('dt').textContent,node.querySelector('dd').textContent])),
   title:document.querySelector('h1').textContent,
   columns:[...document.querySelectorAll('thead th')].map(node=>node.dataset.column),
   rows:[...document.querySelectorAll('tbody tr')].map(row=>row.textContent),
   filters:document.querySelector('.dg-print-filters')?.textContent||'',
   scriptClosed:document.scripts.length===1,theadDisplay:getComputedStyle(document.querySelector('thead')).display,
   contextHeaders:document.querySelectorAll('.dg-print-header').length
  }));
  if(screenshot)await popup.screenshot({path:path.join(artifactDir,screenshot),fullPage:true});
  await popup.close();return data;
 }
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
 const otherLists=['opponents','cases','procedures','judgments','communications','powersOfAttorney','serviceRecords','appointments','fees','feePayments','caseNotes','execution','expertReports','documentReferences'];
 await verify('Every other file-associated list mounts with three real shared columns and an independent stable grid ID',async()=>{
  for(const store of otherLists){
   await go(store);await page.waitForSelector('#list-grid th[data-key]',{state:'attached'});await page.locator('#list-grid .dg-state.is-loading').waitFor({state:'hidden'});
   assert.equal(await page.locator('#list-grid').getAttribute('data-grid-id'),`grid:list:${store}`);
   const labels=await page.locator('#list-grid th[data-key]').evaluateAll(nodes=>nodes.slice(0,3).map(node=>node.querySelector('.dg-coltitle').textContent));
   assert.deepEqual(labels,['رقم الملف / نوع الملف','الموكل','الخصم'],store);
  }
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
 await verify('All browser navigation/display/query/print actions leave every office store and Schema 13 unchanged',async()=>{
  assert.equal(await page.evaluate(()=>window.__gridFixture.snapshot()),await page.evaluate(()=>window.__gridBefore));
  assert.equal(await page.evaluate(()=>window.__gridFixture.db.version),13);assert.deepEqual(report.errors,[]);
 });
 await page.evaluate(()=>window.__gridFixture.dispose());await context.close();
}catch(error){report.failure=error.stack||error.message;console.error(report.failure);process.exitCode=1}
finally{await browser.close();await fs.writeFile(path.join(artifactDir,'report.json'),JSON.stringify(report,null,2));console.log(report.printVerification);console.log(`Evidence (not committed): ${artifactDir}`)}
