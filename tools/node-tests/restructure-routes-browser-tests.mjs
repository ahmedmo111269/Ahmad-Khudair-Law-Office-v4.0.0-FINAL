// W5 browser smoke: open every route key captured by W0 through the existing App.go/PAGES surface.
// Uses one ephemeral Chromium profile and writes its report only under .cache.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {chromium} from 'playwright';

const repository=path.resolve(fileURLToPath(new URL('../../',import.meta.url)));
const baseline=JSON.parse(await readFile(path.join(repository,'docs/RESTRUCTURE-BASELINE.json'),'utf8'));
const configuredBase=(process.env.RESTRUCTURE_BASE_URL||process.env.GRID_BASE_URL||'').replace(/\/$/,'');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2'};
let server=null,base=configuredBase;
if(!base){
 server=createServer(async(req,res)=>{
  try{
   const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
   const file=path.resolve(repository,pathname==='/'?'index.html':pathname.replace(/^\/+/,''));
   if(!file.startsWith(repository+path.sep)&&file!==path.join(repository,'index.html')){res.writeHead(403).end();return}
   const body=await fs.readFile(file);
   res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream','cache-control':'no-store','service-worker-allowed':'/'});res.end(body);
  }catch{res.writeHead(404).end('not found')}
 });
 await new Promise(resolve=>server.listen(0,'0.0.0.0',resolve));
 base=`http://127.0.0.1:${server.address().port}`;
}
const require=createRequire(import.meta.url);
let browser;
try{
 const {default:slim,inflate}=await import('@sparticuz/chromium');
 await inflate(path.resolve(path.dirname(require.resolve('@sparticuz/chromium')),'../bin/al2023.tar.br'));
 process.env.LD_LIBRARY_PATH=[path.join(process.env.TMPDIR||'/tmp','al2023','lib'),process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');
 browser=await chromium.launch({executablePath:await slim.executablePath(),headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
}catch(error){server?.close();throw error}
const report={date:new Date().toISOString(),browser:browser.version(),base,fixture:'ephemeral browser profile; app database only; no real user data',routes:[],dynamicRoutes:[],pageErrors:[],consoleErrors:[],status:'NOT RUN'};
const ignored=/ERR_CONNECTION|ERR_INTERNET|fonts\.(googleapis|gstatic)|net::ERR_/;
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block',locale:'ar-EG'});
 const page=await context.newPage();
 page.on('pageerror',error=>report.pageErrors.push(error.message));
 page.on('console',message=>{if(message.type()==='error'&&!ignored.test(message.text()))report.consoleErrors.push(message.text())});
 await page.goto(`${base}/index.html`,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__LAW_OFFICE_APP__?.office&&!window.__LAW_OFFICE_APP__.booting,null,{timeout:90000});
 await page.waitForFunction(()=>document.querySelector('#main-content')?.children.length>0,null,{timeout:90000});
 const routes=baseline.routing.staticRoutes;
 assert.equal(routes.length,32,'W0 static route inventory should still have 32 keys');
 for(const route of routes){
  const result=await page.evaluate(async value=>{
   const app=window.__LAW_OFFICE_APP__;
   await app.go(value,{replace:true,forceRender:true});
   await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
   return {route:app.route,title:document.querySelector('#page-title')?.textContent||'',contentLength:document.querySelector('#main-content')?.innerHTML.length||0,error:Boolean(document.querySelector('#main-content .error-box'))};
  },route);
  await page.waitForTimeout(100);
  assert.equal(result.route.split('?')[0],route,`App.go did not preserve the static route key: ${route} -> ${result.route}`);
  assert.ok(result.title,`Missing page title for ${route}`);
  assert.ok(result.contentLength>80,`No usable page content rendered for ${route}`);
  assert.equal(result.error,false,`Application error screen rendered for ${route}`);
  report.routes.push({...result,status:'PASS'});
  console.log(`PASS — ${route} — ${result.title}`);
 }
 // Dynamic deep-link patterns get a tiny legal fixture in this disposable Chromium profile only.
 const fixtures=await page.evaluate(async()=>{
  const app=window.__LAW_OFFICE_APP__,office=app.office;
  const {saveEntity}=await import('/js/services/entity-save.js');
  const {createLegalFile}=await import('/js/services/legal-files.js');
  const {ensureClientFile}=await import('/js/services/client-files.js');
  const {saveQuickNote}=await import('/js/services/quick-notes.js');
  const {saveWorkItem}=await import('/js/services/work-items.js');
  const suffix=Date.now().toString(36);
  const client=await office.saveClient({fullName:`W5 route fixture ${suffix}`});
  const opponent=await saveEntity(office,'opponents',{name:`W5 route opponent ${suffix}`});
  const file=await createLegalFile(office,{clientId:client.id,title:`W5 route file ${suffix}`,fileType:'مدني'});
  const caseRow=await office.createCase({fileId:file.id,caseNumber:`W5-${suffix}`,caseYear:String(new Date().getFullYear()),subject:`W5 route case ${suffix}`},[]);
  const execution=await saveEntity(office,'execution',{executionType:'civil',caseId:caseRow.id,fileId:file.id,clientId:client.id,openedDate:new Date().toISOString().slice(0,10)});
  await ensureClientFile(office,client.id);
  const appointment=await saveEntity(office,'appointments',{title:`W5 route appointment ${suffix}`,fileId:file.id,clientId:client.id,date:new Date().toISOString().slice(0,10),time:'10:00'});
  const note=await saveQuickNote(office,{title:`W5 route note ${suffix}`,content:'Ephemeral dynamic-route smoke fixture',fileId:file.id,caseId:caseRow.id,clientId:client.id});
  const item=await saveWorkItem(office,{title:`W5 route task ${suffix}`,dueDate:new Date().toISOString().slice(0,10),fileId:file.id,caseId:caseRow.id});
  return {client:client.id,opponent:opponent.id,file:file.id,case:caseRow.id,execution:execution.id,clientFile:client.id,genericRecord:`rec:appointments:${appointment.id}`,workItem:`rec:workItems:${item.id}`,quickNote:`rec:caseNotes:${note.id}`};
 });
 report.dynamicFixtures={createdIn:'ephemeral Chromium profile only',count:8};
 const dynamicRoutes=[
  ['client',`client:${fixtures.client}`],['opponent',`opponent:${fixtures.opponent}`],['file',`file:${fixtures.file}`],['case',`case:${fixtures.case}`],['execution',`exc:${fixtures.execution}`],['client-file',`cfile:${fixtures.clientFile}`],['generic-record',fixtures.genericRecord],['work-item',fixtures.workItem],['quick-note-compatibility',fixtures.quickNote]
 ];
 for(const [kind,route] of dynamicRoutes){
  const result=await page.evaluate(async value=>{
   const app=window.__LAW_OFFICE_APP__;
   await app.go(value,{replace:true,forceRender:true});
   await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
   return {route:app.route,title:document.querySelector('#page-title')?.textContent||'',contentLength:document.querySelector('#main-content')?.innerHTML.length||0,error:Boolean(document.querySelector('#main-content .error-box'))};
  },route);
  await page.waitForTimeout(150);
  assert.equal(result.route.split('?')[0],route,`App.go did not preserve dynamic route ${kind}: ${route} -> ${result.route}`);
  assert.ok(result.title,`Missing dynamic page title for ${kind}`);
  assert.ok(result.contentLength>80,`No usable dynamic page content rendered for ${kind}`);
  assert.equal(result.error,false,`Application error screen rendered for ${kind}: ${route}`);
  report.dynamicRoutes.push({kind,...result,status:'PASS'});
  console.log(`PASS — ${kind} — ${route}`);
 }
 assert.deepEqual(report.pageErrors,[],'uncaught page errors during static and dynamic route coverage');
 assert.deepEqual(report.consoleErrors,[],'console errors during static and dynamic route coverage');
 report.status='PASS';
 await context.close();
}catch(error){
 report.status='FAIL';report.failure=String(error?.stack||error);
}finally{
 const artifact=path.join(repository,'.cache','restructure-w5');
 await fs.mkdir(artifact,{recursive:true});
 await fs.writeFile(path.join(artifact,'static-route-smoke.json'),JSON.stringify(report,null,2));
 await browser?.close().catch(()=>{});
 if(server)await new Promise(resolve=>server.close(resolve));
}
console.log(`\n${report.routes.length}/${baseline.routing.staticRoutes.length} static routes + ${report.dynamicRoutes.length}/${baseline.routing.dynamicRoutes.length} dynamic route patterns opened; ${report.pageErrors.length} page errors; ${report.status}`);
if(report.status!=='PASS')process.exitCode=1;
