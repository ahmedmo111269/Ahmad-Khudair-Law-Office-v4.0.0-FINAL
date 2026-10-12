// أداة تطويرية: لقطات سريعة لصفحة الملف على الهاتف وسطح المكتب (لا تُشغَّل في CI).
import {chromium} from 'playwright';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';

const repository=path.resolve(new URL('../../',import.meta.url).pathname);
const base=(process.env.SHOT_BASE_URL||'http://127.0.0.1:8080').replace(/\/$/,'');
const outDir=path.join(repository,'.cache','shots');
await fs.mkdir(outDir,{recursive:true});
const require=createRequire(import.meta.url);
const {default:slim,inflate}=await import('@sparticuz/chromium');
await inflate(path.resolve(path.dirname(require.resolve('@sparticuz/chromium')),'../bin/al2023.tar.br'));
process.env.LD_LIBRARY_PATH=path.join(process.env.TMPDIR||'/tmp','al2023','lib');
const browser=await chromium.launch({executablePath:await slim.executablePath(),headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const seed=async page=>{
 await page.goto(`${base}/index.html`,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__LAW_OFFICE_APP__?.office&&!window.__LAW_OFFICE_APP__.booting,null,{timeout:120000});
 await page.waitForFunction(()=>document.querySelector('#main-content')?.children.length>0,null,{timeout:120000});
 const id=await page.evaluate(async()=>{
  const app=window.__LAW_OFFICE_APP__;
  const CF=await import('/js/services/client-files.js');
  const {saveEntity}=await import('/js/services/entity-save.js');
  await CF.seedTaxonomy(app.office);
  const suffix=String(Date.now()).slice(-12);
  const client=await app.office.saveClient({fullName:'فاطمة محمد ابراهيم محمد',nationalId:'29'+suffix});
  const cfile=await CF.ensureClientFile(app.office,client.id);
  const file=await CF.createLegalFileInClientFile(app.office,{clientId:client.id,clientFileId:cfile.id,categoryId:'civil',fileTypeId:'civil.lawsuit',title:'صحة توقيع — عقد بيع ابتدائي',openedAt:'2026-01-12',steps:[]});
  await saveEntity(app.office,'fileParties',{fileId:file.id,partyKind:'opponent',name:'شركة النيل للمقاولات',role:'مدعى عليه',roleGroup:'الخصوم',sequence:1});
  const s1=await app.office.createCase({fileId:file.id,stageType:'دعوى',numberType:'رقم دعوى',caseNumber:'1234',caseYear:'2026',courtId:'محكمة بنها الابتدائية',chamber:'دائرة 3 مدني',degree:'أول درجة',subject:'صحة توقيع عقد بيع ابتدائي',filingDate:'2026-01-20',status:'متداولة',lifecycle:'active',stageOrder:1,clientCapacity:'مدعٍ',opponentCapacity:'مدعى عليه'},[]);
  const row=await app.office.r.files.get(file.id);
  await app.office.saveFile({...row,currentStageId:s1.id,responsibleLawyer:'أحمد محمد خضير'},file.id,row.version);
  await saveEntity(app.office,'hearings',{fileId:file.id,caseId:s1.id,hearingDate:'2026-11-12',hearingTime:'10:00',court:'محكمة بنها الابتدائية',type:'مرافعة',reason:'نظر الدعوى'});
  await saveEntity(app.office,'procedures',{fileId:file.id,type:'متابعة',description:'متابعة تقرير الخبير بمكتب الخبراء',internalDueDate:'2026-10-11',status:'pending'});
  return file.id;
 });
 await page.evaluate(id=>window.__LAW_OFFICE_APP__.go('file:'+id),id);
 await page.waitForTimeout(2500);
 return id;
};
const one=async(name,config)=>{
 const context=await browser.newContext({...config,locale:'ar-EG'});
 const page=await context.newPage();
 const id=await seed(page);
 await page.screenshot({path:path.join(outDir,`${name}-top.png`)});
 await page.evaluate(()=>document.querySelector('.ftb-more-btn')?.click());
 await page.waitForTimeout(500);
 await page.screenshot({path:path.join(outDir,`${name}-menu.png`)});
 await page.keyboard.press('Escape');
 await page.evaluate(()=>window.scrollTo(0,900));
 await page.waitForTimeout(600);
 await page.screenshot({path:path.join(outDir,`${name}-scrolled.png`)});
 await page.evaluate(()=>window.scrollTo(0,2400));
 await page.waitForTimeout(600);
 await page.screenshot({path:path.join(outDir,`${name}-data.png`)});
 const menuInfo=await page.evaluate(()=>{
  const m=document.querySelector('.ftb-menu-all');
  if(!m)return null;
  const r=m.getBoundingClientRect();
  return {sections:[...m.querySelectorAll('.ftb-sec-title')].map(x=>x.textContent.trim()),items:[...m.querySelectorAll('.ftb-item')].map(x=>x.dataset.tab),hiddenItems:[...m.querySelectorAll('.ftb-sec-hidden .ftb-item')].map(x=>x.dataset.tab),box:{left:Math.round(r.left),right:Math.round(r.right),top:Math.round(r.top),vw:window.innerWidth,vh:window.innerHeight}};
 });
 console.log(name+' menu',JSON.stringify(menuInfo));
 const probe=await page.evaluate(()=>{
  const bar=document.querySelector('.file-tabs-bar');
  const r=bar?.getBoundingClientRect();
  return {barTop:r?.top,barHeight:r?.height,scrollY:window.scrollY,sticky:bar?getComputedStyle(bar).position:'',inlineTop:bar?bar.style.top:'',
   primary:[...document.querySelectorAll('.file-subtabs [data-tab]')].map(b=>b.textContent.replace(/\s+/g,' ').trim()),
   groups:[...document.querySelectorAll('.ftb-group-btn')].map(b=>b.textContent.replace(/\s+/g,' ').trim()),
   crumbs:(document.querySelector('.file-overview-crumbs')?.textContent||'').replace(/\s+/g,' ').trim(),
   crumbsHeight:document.querySelector('.file-overview-crumbs')?.getBoundingClientRect().height,
   hasGaps:!!document.querySelector('.file-gaps'),hasGapsBadge:!!document.querySelector('[data-gaps-jump]'),
   hasCollapseTools:!!document.querySelector('.collapse-page-tools'),
   caseDataHeads:[...document.querySelectorAll('.fp-data .fp-kv-h')].map(h=>h.textContent.trim())};
 });
 console.log(name,JSON.stringify(probe,null,1));
 await fs.writeFile(path.join(outDir,`${name}-dom.html`),await page.content());
 await context.close();
};
await one('mobile',{viewport:{width:412,height:915},deviceScaleFactor:2,isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (Linux; Android 13; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Mobile Safari/537.36'});
await one('desktop',{viewport:{width:1440,height:900}});
await browser.close();
console.log('shots written to',outDir);
