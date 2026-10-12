import {chromium} from 'playwright';
import {createRequire} from 'node:module';
import path from 'node:path';
const base='http://127.0.0.1:8080';
const require=createRequire(import.meta.url);
const {default:slim,inflate}=await import('@sparticuz/chromium');
await inflate(path.resolve(path.dirname(require.resolve('@sparticuz/chromium')),'../bin/al2023.tar.br'));
process.env.LD_LIBRARY_PATH=path.join(process.env.TMPDIR||'/tmp','al2023','lib');
const browser=await chromium.launch({executablePath:await slim.executablePath(),headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
for(const cfg of [{w:1440,h:900,m:false},{w:412,h:915,m:true}]){
 const context=await browser.newContext({viewport:{width:cfg.w,height:cfg.h},isMobile:cfg.m,hasTouch:cfg.m,locale:'ar-EG'});
 const page=await context.newPage();
 await page.goto(`${base}/index.html`,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__LAW_OFFICE_APP__?.office&&!window.__LAW_OFFICE_APP__.booting,null,{timeout:120000});
 await page.waitForFunction(()=>document.querySelector('#main-content')?.children.length>0,null,{timeout:120000});
 const id=await page.evaluate(async()=>{
  const app=window.__LAW_OFFICE_APP__;
  const CF=await import('/js/services/client-files.js');
  const {saveEntity}=await import('/js/services/entity-save.js');
  await CF.seedTaxonomy(app.office);
  const client=await app.office.saveClient({fullName:'فاطمة محمد ابراهيم محمد',nationalId:'29'+String(Date.now()).slice(-12)});
  const cf=await CF.ensureClientFile(app.office,client.id);
  const file=await CF.createLegalFileInClientFile(app.office,{clientId:client.id,clientFileId:cf.id,categoryId:'civil',fileTypeId:'civil.lawsuit',title:'صحة توقيع',openedAt:'2026-01-12',steps:[]});
  await saveEntity(app.office,'fileParties',{fileId:file.id,partyKind:'opponent',name:'شركة النيل للمقاولات',role:'مدعى عليه',roleGroup:'الخصوم',sequence:1});
  const s1=await app.office.createCase({fileId:file.id,stageType:'دعوى',caseNumber:'1234',caseYear:'2026',courtId:'محكمة بنها الابتدائية',filingDate:'2026-01-20',status:'متداولة',lifecycle:'active',stageOrder:1},[]);
  const row=await app.office.r.files.get(file.id);
  await app.office.saveFile({...row,currentStageId:s1.id},file.id,row.version);
  return file.id;
 });
 await page.evaluate(id=>window.__LAW_OFFICE_APP__.go('file:'+id),id);
 await page.waitForTimeout(2000);
 const info=await page.evaluate(()=>{
  const bar=document.querySelector('.file-tabs-bar');
  const row=bar.querySelector('.file-subtabs');
  const btns=[...row.querySelectorAll('.subtab-btn')].map(b=>{const r=b.getBoundingClientRect();return {t:b.dataset.tab,left:Math.round(r.left),w:Math.round(r.width)}});
  const cs=getComputedStyle(row);
  const more=bar.querySelector('.ftb-more-btn').getBoundingClientRect();
  const tools=bar.querySelector('.ftb-tools').getBoundingClientRect();
  return {barH:Math.round(bar.getBoundingClientRect().height),rowH:Math.round(row.getBoundingClientRect().height),rowDisplay:cs.display,rowJustify:cs.justifyContent,rowFlex:cs.flex,rowWidth:Math.round(row.getBoundingClientRect().width),barWidth:Math.round(bar.getBoundingClientRect().width),btns,more:{left:Math.round(more.left),w:Math.round(more.width)},tools:{left:Math.round(tools.left),w:Math.round(tools.width)},label:(()=>{const l=bar.querySelector('.ftb-more-btn .tab-label'),s=bar.querySelector('.ftb-more-btn .tab-label-short');return {full:l?getComputedStyle(l).display:null,short:s?getComputedStyle(s).display:null}})()};
 });
 console.log(cfg.w,JSON.stringify(info,null,1));
 await context.close();
}
await browser.close();
