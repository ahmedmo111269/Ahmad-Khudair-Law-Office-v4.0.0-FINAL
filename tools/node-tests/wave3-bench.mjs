// ============================================================
// مقياس موجة 3 — بحث بذاكرة مقابل مسح مخزن، صيانة بإشارة أمان، وذاكرة
// المعرّفات المرتبطة. كل الأرقام من نفس المتصفح ونفس القاعدة ونفس الخادم،
// والفرق وحده ما تغيّر (علم searchKeyCache أو خيار الصيانة) — لا خادمين.
//
// الاستخدام:
//   node ../static-preview-server.mjs &                     # من جذر المستودع
//   BENCH_BASE_URL=http://127.0.0.1:8080 BENCH_N=20000 node wave3-bench.mjs
// الناتج: .cache/bench/wave3-<label>.json (غير مُتتبَّع في Git)
// ============================================================
import {chromium} from 'playwright';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';

const repository=path.resolve(new URL('../../',import.meta.url).pathname);
const base=(process.env.BENCH_BASE_URL||'http://127.0.0.1:8080').replace(/\/$/,'');
const N=Number(process.env.BENCH_N||20000);
const label=process.env.BENCH_LABEL||'run';
const runs=Number(process.env.BENCH_RUNS||3);
const require=createRequire(import.meta.url);
const {default:slim,inflate}=await import('@sparticuz/chromium');
await inflate(path.resolve(path.dirname(require.resolve('@sparticuz/chromium')),'../bin/al2023.tar.br'));
process.env.LD_LIBRARY_PATH=path.join(process.env.TMPDIR||'/tmp','al2023','lib');
const browser=await chromium.launch({executablePath:await slim.executablePath(),headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const context=await browser.newContext({viewport:{width:1440,height:900}});
const page=await context.newPage();
const pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));
const ready=()=>page.waitForFunction(()=>!document.querySelector('.boot-splash')&&document.querySelector('#main-content')?.children.length>0&&window.__LAW_OFFICE_APP__?.office,null,{timeout:600000});
const med=list=>{const s=[...list].sort((a,b)=>a-b);return Math.round(s[Math.floor(s.length/2)])};

try{
 await page.goto(`${base}/index.html`,{waitUntil:'domcontentloaded'});
 await ready();
 // صيانة الفهرسة الثقيلة تعمل بعد أول شاشة في الخلفية؛ تُنتظر هنا مرة واحدة
 // قبل القياس حتى لا تُبطل الكاش بكتابتها أثناء قياس البحث (وهي مقاسة قسم 4).
 await page.evaluate(async()=>{await window.__LAW_OFFICE_APP__.scheduleSearchIndexMaintenance()});

 // ===== 1) الملء: موكلون وملفات بحجم حقيقي (دفعات 2000 في معاملة واحدة) =====
 const seedMs=await page.evaluate(async({N})=>{
  const t=performance.now();
  const app=window.__LAW_OFFICE_APP__,db=app.office.ctx.db,now=new Date().toISOString();
  const names=['محمد','أحمد','علي','محمود','حسن','إبراهيم','خالد','سامح','عمرو','فاطمة'];
  const surn=['السيد','عبد الله','خضير','فؤاد','النجار','الشرقاوي','جاد','حسين'];
  for(let start=0;start<N;start+=2000){
   const end=Math.min(N,start+2000);
   await new Promise((res,rej)=>{
    const tx=db.transaction(['clients','files'],'readwrite',{captureChanges:false});
    tx.oncomplete=res;tx.onerror=()=>rej(tx.error);tx.onabort=()=>rej(tx.error);
    const cs=tx.objectStore('clients'),fsx=tx.objectStore('files');
    for(let i=start;i<end;i++){
     const id=`bench-c-${String(i).padStart(8,'0')}`;
     const full=`${names[i%names.length]} ${names[(i*7)%names.length]} ${surn[i%surn.length]} ${i}`;
     cs.put({id,fullName:full,fullNameNormalized:full.replace(/أ|إ|آ/g,'ا'),nationalId:String(29000000000000+i),clientCode:`CL2026${String(i).padStart(7,'0')}`,phones:['0100'+String(1000000+i)],status:'active',createdAt:now,updatedAt:now,version:1,isDeleted:false});
     const title=`قضية ${surn[(i*3)%surn.length]} رقم ${i} عقد بيع`;
     fsx.put({id:`bench-f-${String(i).padStart(8,'0')}`,fileNumber:`2026/${String(i+1).padStart(6,'0')}`,title,titleNormalized:title.replace(/أ|إ|آ/g,'ا'),fileType:'مدني',status:'open',searchText:`${title} ${full}`.replace(/أ|إ|آ/g,'ا'),partyNames:full,lastActivityAt:now,createdAt:now,updatedAt:now,version:1,isDeleted:false});
    }
   });
  }
  return Math.round(performance.now()-t);
 },{N});

 // ===== 2) البحث: بلا كاش (مسح المخزن) ثم بالكاش (البناء + الاستخدام الدافئ) =====
 const queries={noMatch:'كلمة غير موجودة إطلاقا',word:'عقد بيع',nameAndNumber:'محمد 1234',code:'CL2026'};
 const search=await page.evaluate(async({queries,runs})=>{
  const mod=await import('./js/services/search-engine.js');
  const flags=await import('./js/core/feature-flags.js');
  const cache=await import('./js/services/search-cache.js');
  const app=window.__LAW_OFFICE_APP__;
  const time=async fn=>{const t=performance.now();const r=await fn();return{ms:performance.now()-t,r}};
  const out={};
  for(const [key,q] of Object.entries(queries)){
   flags.setFlag('searchKeyCache',false);
   cache.clearSearchCache(app.ctx);
   const plain=[];let total=0;
   for(let i=0;i<runs;i++){const {ms,r}=await time(()=>mod.searchAll(app.office,q,{stores:mod.PRIMARY_STORES,perStore:8}));plain.push(ms);total=r.total}
   flags.setFlag('searchKeyCache',true);
   cache.clearSearchCache(app.ctx);
   const build=(await time(()=>mod.searchAll(app.office,q,{stores:mod.PRIMARY_STORES,perStore:8}))).ms;
   const warm=[];let warmTotal=0;
   for(let i=0;i<runs;i++){const {ms,r}=await time(()=>mod.searchAll(app.office,q,{stores:mod.PRIMARY_STORES,perStore:8}));warm.push(ms);warmTotal=r.total}
   out[key]={noCacheMedianMs:Math.round(plain.sort((a,b)=>a-b)[Math.floor(plain.length/2)]),cacheBuildMs:Math.round(build),warmMedianMs:Math.round(warm.sort((a,b)=>a-b)[Math.floor(warm.length/2)]),resultsNoCache:total,resultsWarm:warmTotal,agree:total===warmTotal};
  }
  // البحث الشامل في كل الأقسام (الشاشة الكاملة)
  const full=async enable=>{
   flags.setFlag('searchKeyCache',enable);cache.clearSearchCache(app.ctx);
   const times=[];
   for(let i=0;i<2;i++)times.push((await time(()=>mod.searchAll(app.office,'كلمة غير موجودة إطلاقا',{stores:mod.allSearchStores(),perStore:6}))).ms);
   return Math.round(times.sort((a,b)=>a-b)[Math.floor(times.length/2)]);
  };
  out.allStoresNoCacheMs=await full(false);
  out.allStoresWarmMs=await full(true);
  out.stats=mod.searchEngineStats(app.office);
  return out;
 },{queries,runs});

 // ===== 3) بحث جدول القائمة: ذاكرة المعرّفات المرتبطة (الصفحة 2 بلا إعادة مسح) =====
 const related=await page.evaluate(async()=>{
  const eq=await import('./js/services/entity-query.js');
  const app=window.__LAW_OFFICE_APP__;
  const time=async fn=>{const t=performance.now();const r=await fn();return{ms:performance.now()-t,r}};
  const first=await time(()=>eq.loadRows(app.office,'hearings',{q:'محمد',limit:100}));
  const second=await time(()=>eq.loadRows(app.office,'hearings',{q:'محمد',limit:100}));
  return {firstMs:Math.round(first.ms),secondMs:Math.round(second.ms),memoEntries:eq.relatedIdsStats(app.ctx).entries,rows:first.r.rows.length,rowsAgain:second.r.rows.length};
 });

 // ===== 4) الصيانة: المسار الحرج، ثم فهرسة البحث باردة ثم دافئة =====
 const maintenance=await page.evaluate(async()=>{
  const m=await import('./js/services/maintenance.js');
  const time=async fn=>{const t=performance.now();const r=await fn();return{ms:performance.now()-t,r}};
  const critical=await time(()=>m.runMaintenance(window.__LAW_OFFICE_APP__.office,{searchIndex:false}));
  const cold=await time(()=>m.indexMissingSearchText(window.__LAW_OFFICE_APP__.office));
  const warm=await time(()=>m.indexMissingSearchText(window.__LAW_OFFICE_APP__.office));
  return {criticalMs:Math.round(critical.ms),indexColdMs:Math.round(cold.ms),indexWarmMs:Math.round(warm.ms),coldIndexed:cold.r,warmIndexed:warm.r};
 });

 const counts=await page.evaluate(async()=>{const o=window.__LAW_OFFICE_APP__.office;return {clients:await o.r.clients.count(),files:await o.r.files.count()}});
 const out={date:new Date().toISOString(),label,base,N,counts,seedMs,search,related,maintenance,pageErrors};
 const dir=path.join(repository,'.cache','bench');
 await fs.mkdir(dir,{recursive:true});
 await fs.writeFile(path.join(dir,`wave3-${label}-${N}.json`),JSON.stringify(out,null,2));
 console.log(JSON.stringify(out,null,2));
}finally{await context.close().catch(()=>{});await browser.close().catch(()=>{})}
