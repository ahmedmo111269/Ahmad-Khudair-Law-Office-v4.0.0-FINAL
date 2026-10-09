// Phase G — قياس أداء File Cockpit: قائمة الملفات (1000 ملف)، صفحة ملف، طي/توسيع.
import {chromium} from 'playwright';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
const repository=path.resolve(new URL('../../',import.meta.url).pathname);
const base=(process.env.PERF_BASE_URL||'http://127.0.0.1:8080').replace(/\/$/,'');
const artifactDir=path.join(repository,'.cache','files-cockpit-perf');
await fs.mkdir(artifactDir,{recursive:true});
const require=createRequire(import.meta.url);
const {default:slim,inflate}=await import('@sparticuz/chromium');
await inflate(path.resolve(path.dirname(require.resolve('@sparticuz/chromium')),'../bin/al2023.tar.br'));
process.env.LD_LIBRARY_PATH=path.join(process.env.TMPDIR||'/tmp','al2023','lib');
const browser=await chromium.launch({executablePath:await slim.executablePath(),headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const context=await browser.newContext({viewport:{width:1366,height:900}});
const page=await context.newPage();
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const N=Number(process.env.PERF_N||1000);
const out={date:new Date().toISOString(),N,measures:{},pageErrors:errors};
try{
 await page.goto(`${base}/index.html`,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__LAW_OFFICE_APP__?.office&&!window.__LAW_OFFICE_APP__.booting,null,{timeout:90000});
 await page.waitForFunction(()=>document.querySelector('#main-content')?.children.length>0,null,{timeout:90000});
 // ---- seed N files + 500 sub-records on one file ----
 out.seedMs=await page.evaluate(async N=>{
  const app=window.__LAW_OFFICE_APP__;const t0=performance.now();
  const CF=await import('/js/services/client-files.js');
  await CF.seedTaxonomy(app.office);
  const client=await app.office.saveClient({fullName:'موكل القياس',nationalId:'29990001001234'});
  let file=null;
  for(let i=0;i<N;i++){
   file=await CF.createLegalFileInClientFile(app.office,{clientId:client.id,categoryId:'civil',fileTypeId:'civil.lawsuit',title:`ملف قياس ${i}`,openedAt:'2026-10-07',steps:[]});
  }
  // ملف بـ 500 سجل فرعي: 250 جلسة + 250 عمل (الجلسات تحتاج مرحلة)
  const stage=await app.office.createCase({fileId:file.id,caseNumber:'PERF-1',caseYear:'2026'},[]);
  const fileRow=await app.office.r.files.get(file.id);
  await app.office.saveFile({...fileRow,currentStageId:stage.id},file.id,fileRow.version);
  const {saveEntity}=await import('/js/services/entity-save.js');
  for(let i=0;i<250;i++){
   await saveEntity(app.office,'hearings',{fileId:file.id,caseId:stage.id,hearingDate:`2026-1${i%9}-1${i%9}`,court:'محكمة'});
   await saveEntity(app.office,'procedures',{fileId:file.id,type:'متابعة',description:`عمل ${i}`,internalDueDate:'2026-11-01'});
  }
  return Math.round(performance.now()-t0);
 },N);
 // konservativ: get last file id via files list query
 out.fileId=await page.evaluate(async()=>{const app=window.__LAW_OFFICE_APP__;const rows=await app.office.r.files.reportRange({index:'createdAt',direction:'prev',limit:1});return rows[0]?.id||''});

 // ---- 1) list first paint ----
 await page.evaluate(()=>window.__LAW_OFFICE_APP__.go('files'));
 out.listFirstPaintMs=await page.evaluate(async()=>{
  const t0=performance.now();
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  return Math.round(performance.now()-t0);
 });
 await page.waitForSelector('.dg tbody tr[data-i]',{timeout:60000});
 out.listRowsLoaded=await page.evaluate(()=>document.querySelectorAll('.dg tbody tr[data-i]').length);
 out.listTotalText=await page.evaluate(()=>document.querySelector('.dg-shell-count')?.textContent||'');

 // ---- 2) file page first content (cockpit) with 500 sub-records ----
 out.fileNavMs=await page.evaluate(async id=>{
  const app=window.__LAW_OFFICE_APP__;const t0=performance.now();
  await app.go(`file:${id}`);
  return Math.round(performance.now()-t0);
 },out.fileId);
 await page.waitForSelector('.cp-fc',{timeout:60000});
 out.cockpitPaintMs=await page.evaluate(async()=>{
  const t0=performance.now();
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  return Math.round(performance.now()-t0);
 });

 // ---- 3) tab switch after first load (cached) ----
 await page.waitForSelector('.file-subtabs [data-tab="hearings"]');
 out.tabSwitchFirstMs=await page.evaluate(async()=>{
  const app=window.__LAW_OFFICE_APP__;const t0=performance.now();
  document.querySelector('.file-subtabs [data-tab="hearings"]').click();
  await new Promise(r=>setTimeout(r,0));
  return Math.round(performance.now()-t0);
 });
 await page.waitForSelector('#file-tab .dg tbody tr[data-i]',{timeout:60000});
 out.tabSwitchBackCachedMs=await page.evaluate(async()=>{
  const app=window.__LAW_OFFICE_APP__;const t0=performance.now();
  document.querySelector('.file-subtabs [data-tab="summary"]').click();
  await new Promise(r=>setTimeout(r,0));
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  return Math.round(performance.now()-t0);
 });

 // ---- 4) collapse/expand: DOM only, no IDB ----
 out.collapseMs=await page.evaluate(async()=>{
  const times=[];
  const btn=document.querySelector('.file-tab-shell > .panel-head .collapse-toggle');
  const idbCalls=[];
  const origOpen=indexedDB.open.bind(indexedDB);
  indexedDB.open=(...a)=>{idbCalls.push(1);return origOpen(...a)};
  for(let i=0;i<5;i++){
   const t0=performance.now();
   btn.click();
   await new Promise(r=>requestAnimationFrame(r));
   times.push(performance.now()-t0);
  }
  indexedDB.open=origOpen;
  times.sort((a,b)=>a-b);
  return {medianMs:Math.round(times[2]*100)/100,maxMs:Math.round(times[4]*100)/100,idbCallsDuringCollapse:idbCalls.length};
 });

 // ---- 5) list search latency (Arabic) ----
 await page.evaluate(()=>window.__LAW_OFFICE_APP__.go('files'));
 await page.waitForSelector('.dg tbody tr[data-i]',{timeout:60000});
 out.searchMs=await page.evaluate(async()=>{
  const t0=performance.now();
  const q=document.querySelector('#list-q');
  q.value='ملف قياس 99';
  q.dispatchEvent(new Event('input',{bubbles:true}));
  await new Promise(r=>setTimeout(r,400));
  return Math.round(performance.now()-t0);
 });
 out.searchRows=await page.evaluate(()=>document.querySelectorAll('.dg tbody tr[data-i]').length);

 out.status='PASS';
 await fs.writeFile(path.join(artifactDir,'report.json'),JSON.stringify(out,null,2)+'\n');
 console.log(JSON.stringify(out,null,2));
}catch(e){
 out.status='FAIL';out.error=String(e?.stack||e);
 await fs.writeFile(path.join(artifactDir,'report.json'),JSON.stringify(out,null,2)+'\n');
 console.error('FAIL',e);process.exitCode=1;
}finally{
 await context.close().catch(()=>{});await browser.close().catch(()=>{});
}
