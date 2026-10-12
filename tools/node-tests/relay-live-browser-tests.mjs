// Live end-to-end verification: the browser client talks to the actual Python/SQLite relay.
import {createServer} from 'node:http';
import {createServer as createTcpServer} from 'node:net';
import {readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {chromium} from 'playwright';

const repository=path.resolve(fileURLToPath(new URL('../../',import.meta.url)));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.webmanifest':'application/manifest+json','.json':'application/json'};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function freePort(){
 const server=createTcpServer();
 await new Promise((resolve,reject)=>server.listen(0,'127.0.0.1',resolve).once('error',reject));
 const port=server.address().port;
 await new Promise(resolve=>server.close(resolve));
 return port;
}

const staticServer=createServer(async(req,res)=>{
 try{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const relative=pathname==='/'?'index.html':pathname.replace(/^\/+/,''),file=path.resolve(repository,relative);
  if(!file.startsWith(repository+path.sep)&&file!==path.join(repository,'index.html')){res.writeHead(403).end();return}
  const body=await readFile(file);
  res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream','cache-control':'no-store'});res.end(body);
 }catch{res.writeHead(404).end('not found')}
});
await new Promise((resolve,reject)=>staticServer.listen(0,'127.0.0.1',resolve).once('error',reject));
const appOrigin=`http://127.0.0.1:${staticServer.address().port}`;
const relayPort=await freePort(),relayOrigin=`http://127.0.0.1:${relayPort}`;
const workspace=`workspace_${randomBytes(18).toString('hex')}`;
const tokenA=randomBytes(36).toString('base64url'),tokenB=randomBytes(36).toString('base64url');
const passphrase=`AKL relay browser ${randomBytes(8).toString('hex')}`;
const tempDir=await import('node:fs/promises').then(fs=>fs.mkdtemp(path.join(os.tmpdir(),'akl-relay-e2e-')));
const relayDb=path.join(tempDir,'relay.sqlite3');
const relayProcess=spawn('python3',['server/sync_relay.py'],{
 cwd:repository,
 env:{...process.env,PYTHONUNBUFFERED:'1',AKL_SYNC_HOST:'127.0.0.1',AKL_SYNC_PORT:String(relayPort),AKL_SYNC_DB:relayDb,AKL_SYNC_ALLOWED_ORIGINS:appOrigin,AKL_SYNC_TOKENS:JSON.stringify({[workspace]:[tokenA,tokenB]})},
 stdio:['ignore','pipe','pipe']
});
let relayLogs='';
relayProcess.stdout.on('data',chunk=>relayLogs+=chunk.toString());
relayProcess.stderr.on('data',chunk=>relayLogs+=chunk.toString());
let browser=null;
const report={scenario:'browser-to-live-python-sqlite-relay',appOrigin,relayOrigin,checks:[],failures:[],pageErrors:[],status:'NOT RUN'};
const check=(name,condition,detail='')=>condition?report.checks.push({name,status:'VERIFIED — Chromium + live relay',detail}):report.failures.push({name,detail});
let contexts=[];
try{
 let ready=false;
 for(let attempt=0;attempt<100;attempt++){
  if(relayProcess.exitCode!==null)throw new Error(`Python relay exited before health check. ${relayLogs}`);
  try{
   const response=await fetch(`${relayOrigin}/v1/health`);
   if(response.ok&&(await response.json()).service==='akl-sync-relay'){ready=true;break}
  }catch{}
  await sleep(150);
 }
 if(!ready)throw new Error(`Python relay did not become ready. ${relayLogs}`);
 if(process.env.GRID_BROWSER_EXECUTABLE)browser=await chromium.launch({executablePath:process.env.GRID_BROWSER_EXECUTABLE,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 else{
  const {default:slim,inflate}=await import('@sparticuz/chromium');
  const require=createRequire(import.meta.url);
  await inflate(path.resolve(path.dirname(require.resolve('@sparticuz/chromium')),'../bin/al2023.tar.br'));
  process.env.LD_LIBRARY_PATH=[path.join(process.env.TMPDIR||'/tmp','al2023','lib'),process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');
  browser=await chromium.launch({executablePath:await slim.executablePath(),headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 }
 report.browser=browser.version();
 async function openDevice(name){
  const context=await browser.newContext({viewport:{width:1365,height:950},serviceWorkers:'allow',acceptDownloads:true});
  contexts.push(context);
  const page=await context.newPage();
  page.on('pageerror',error=>report.pageErrors.push(`${name}: ${error.message}`));
  await page.goto(`${appOrigin}/index.html`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__LAW_OFFICE_APP__&&!window.__LAW_OFFICE_APP__.booting&&window.__LAW_OFFICE_APP__.office,null,{timeout:90000});
  await page.evaluate(async()=>{
   const app=window.__LAW_OFFICE_APP__,profile=app.registry.add({displayName:'قاعدة اختبار مرحّل فارغة'});
   await app.switchDb(profile.id);
   await app.go('sync',{replace:true});
  });
  await page.waitForSelector('#sync-relay-form');
  await page.evaluate(async({endpoint,workspaceId,token,passphrase})=>{
   const app=window.__LAW_OFFICE_APP__;
   const relay=await import('/js/services/sync-relay.js');
   await relay.configureSyncRelay(app.ctx.profile.id,{endpoint,workspaceId,token,passphrase,autoSync:false});
   await app.refresh();
  },{endpoint:relayOrigin,workspaceId:workspace,token:name==='A'?tokenA:tokenB,passphrase});
  await page.waitForSelector('#sync-relay-run');
  return {context,page,name};
 }
 const deviceA=await openDevice('A'),deviceB=await openDevice('B');
 const recordA=await deviceA.page.evaluate(async()=>{
  const app=window.__LAW_OFFICE_APP__;
  return await app.office.saveClient({fullName:'Relay live E2E record from device A'});
 });
 const recordB=await deviceB.page.evaluate(async()=>{
  const app=window.__LAW_OFFICE_APP__;
  return await app.office.saveClient({fullName:'Relay live E2E record from device B'});
 });

 async function testConnection(device){
  await device.page.locator('#sync-relay-test').click();
  await device.page.waitForFunction(()=>{
   const text=document.querySelector('#sync-relay-progress')?.textContent||'';
   return text.startsWith('نجح الاتصال')||text.startsWith('فشل الاختبار');
  },null,{timeout:30000});
  return device.page.locator('#sync-relay-progress').textContent();
 }
 async function runManualSync(device){
  const baseline=await device.page.evaluate(async()=>{
   const app=window.__LAW_OFFICE_APP__,engine=await import('/js/services/sync-engine.js');
   return !(await engine.syncStatus(app.ctx)).baselineComplete;
  });
  await device.page.locator('#sync-relay-run').click();
  if(baseline){
   const confirmation=device.page.locator('#modal-root [data-relay-baseline-yes]');
   await confirmation.waitFor({state:'visible',timeout:30000});
   await confirmation.click();
  }
  await device.page.waitForFunction(()=>{
   const button=document.querySelector('#sync-relay-run'),progress=document.querySelector('#sync-relay-progress')?.textContent||'';
   return Boolean(button&&!button.disabled&&(progress.includes('لم يُجر اختبار اتصال')||progress.startsWith('لم تكتمل الدورة')));
  },null,{timeout:120000});
  const progress=await device.page.locator('#sync-relay-progress').textContent();
  if(progress.startsWith('لم تكتمل الدورة'))throw new Error(`${device.name} relay sync failed: ${progress}`);
 }
 async function imported(device,id,expectedName){
  return device.page.evaluate(async({id,expectedName})=>{
   const app=window.__LAW_OFFICE_APP__,row=await app.office.r.clients.get(id);
   const engine=await import('/js/services/sync-engine.js'),status=await engine.syncStatus(app.ctx);
   return {name:row?.fullName,matched:row?.fullName===expectedName,baselineComplete:status.baselineComplete,unresolvedConflicts:status.unresolvedConflicts};
  },{id,expectedName});
 }
 async function relaySummary(token){
  const response=await fetch(`${relayOrigin}/v1/relay/${workspace}/packages?after=0&limit=5`,{headers:{Authorization:`Bearer ${token}`,Origin:appOrigin}});
  if(!response.ok)throw new Error(`Relay summary returned HTTP ${response.status}`);
  return response.json();
 }
 const connectionA=await testConnection(deviceA);
 check('Device A authenticates against the live relay before its first package exists',connectionA.startsWith('نجح الاتصال')&&connectionA.includes('لا توجد حزمة'),connectionA);

 await runManualSync(deviceA);
 const uploadedA=await fetch(`${relayOrigin}/v1/relay/${workspace}/packages?after=0&limit=5`,{headers:{Authorization:`Bearer ${tokenA}`,Origin:appOrigin}}).then(r=>r.json());
 check('Device A creates its baseline and uploads encrypted packages to the live SQLite relay',uploadedA.total>0&&uploadedA.items.every(item=>Boolean(item.sealed?.ciphertext)),JSON.stringify({total:uploadedA.total,baseline:(await imported(deviceA,recordA.id,'Relay live E2E record from device A')).baselineComplete}));
 const connectionB=await testConnection(deviceB);
 check('Device B authenticates and decrypts a live package using the shared phrase',connectionB.startsWith('نجح الاتصال')&&connectionB.includes('تم التحقق من عبارة التشفير'),connectionB);

 await runManualSync(deviceB);
 const aToB=await imported(deviceB,recordA.id,'Relay live E2E record from device A');
 check('Device B downloads and decrypts device A data into its independent IndexedDB',aToB.matched&&aToB.baselineComplete,JSON.stringify(aToB));
 check('Shared built-in catalog rows with different seed timestamps do not create false sync conflicts',aToB.unresolvedConflicts===0,JSON.stringify({unresolvedConflicts:aToB.unresolvedConflicts}));

 await runManualSync(deviceA);
 const bToA=await imported(deviceA,recordB.id,'Relay live E2E record from device B');
 check('Device A receives device B changes on the next relay pull without cursor skipping',bToA.matched&&bToA.baselineComplete,JSON.stringify(bToA));

 await deviceA.page.evaluate(async({endpoint,workspaceId})=>{
  const app=window.__LAW_OFFICE_APP__,relay=await import('/js/services/sync-relay.js');
  await relay.configureSyncRelay(app.ctx.profile.id,{endpoint,workspaceId,autoSync:true});
  relay.triggerAutomaticSyncRelay(app.ctx.profile.id,'configuration');
 },{endpoint:relayOrigin,workspaceId:workspace});
 const beforeOffline=await relaySummary(tokenA);
 await deviceA.context.setOffline(true);
 await deviceA.page.waitForFunction(()=>document.querySelector('#network-badge')?.textContent.includes('عدم الاتصال'),null,{timeout:15000});
 const queuedOffline=await deviceA.page.evaluate(async()=>await window.__LAW_OFFICE_APP__.office.saveClient({fullName:'Relay live E2E queued while offline'}));
 await sleep(7000); // exceeds event debounce/backoff so the automatic worker has an offline opportunity
 const stillOffline=await relaySummary(tokenA);
 check('Automatic relay retains offline writes locally and sends no package while disconnected',stillOffline.total===beforeOffline.total,JSON.stringify({before:beforeOffline.total,after:stillOffline.total,queuedId:queuedOffline.id}));
 await deviceA.context.setOffline(false);
 await deviceA.page.waitForFunction(()=>document.querySelector('#network-badge')?.textContent.includes('متصل'),null,{timeout:15000});
 let afterReconnect=stillOffline;
 for(let attempt=0;attempt<80&&afterReconnect.total<=stillOffline.total;attempt++){
  await sleep(250);
  afterReconnect=await relaySummary(tokenA);
 }
 await runManualSync(deviceB);
 const offlineImport=await imported(deviceB,queuedOffline.id,'Relay live E2E queued while offline');
 check('Automatic relay uploads the queued change after reconnection; the second device can decrypt it',afterReconnect.total>stillOffline.total&&offlineImport.matched,JSON.stringify({before:stillOffline.total,after:afterReconnect.total,offlineImport}));
 check('No uncaught browser JavaScript exceptions',report.pageErrors.length===0,JSON.stringify(report.pageErrors));
 report.status=report.failures.length?'FAIL':'PASS';
 console.log(JSON.stringify(report,null,2));
}catch(error){
 report.status='FAIL';report.failures.push({name:'live relay browser scenario',detail:error?.stack||String(error),relayLogs});
 console.log(JSON.stringify(report,null,2));
 process.exitCode=1;
}finally{
 for(const context of contexts)await context.close().catch(()=>{});
 await browser?.close().catch(()=>{});
 relayProcess.kill('SIGTERM');
 await new Promise(resolve=>{if(relayProcess.exitCode!==null)return resolve();const timer=setTimeout(resolve,3000);relayProcess.once('exit',()=>{clearTimeout(timer);resolve()})});
 await new Promise(resolve=>staticServer.close(resolve));
 await import('node:fs/promises').then(fs=>fs.rm(tempDir,{recursive:true,force:true}));
}
