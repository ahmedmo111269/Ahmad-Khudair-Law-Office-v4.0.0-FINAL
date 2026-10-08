// اختبار حجم كبير في Chromium: يملأ قاعدة المكتب بـ N موكل وN ملف (سجلات حقيقية الشكل، مفهرسة)،
// ثم يقيس زمن الإقلاع الدافئ (إعادة فتح القاعدة المليئة) وزمن البحث الشامل لكل فئة استعلام.
// الاستخدام: BENCH_BASE_URL=http://127.0.0.1:8080 BENCH_N=20000 BENCH_LABEL=after node scale-bench.mjs
// الناتج: .cache/bench/scale-<label>-<N>.json (غير مُتتبَّع في Git).
import {chromium} from 'playwright';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';

const repository=path.resolve(new URL('../../',import.meta.url).pathname);
const base=(process.env.BENCH_BASE_URL||'http://127.0.0.1:8080').replace(/\/$/,'');
const N=Number(process.env.BENCH_N||20000);
const label=process.env.BENCH_LABEL||'run';
const reloads=Number(process.env.BENCH_RELOADS||3);
const require=createRequire(import.meta.url);
const {default:slim,inflate}=await import('@sparticuz/chromium');
await inflate(path.resolve(path.dirname(require.resolve('@sparticuz/chromium')),'../bin/al2023.tar.br'));
process.env.LD_LIBRARY_PATH=path.join(process.env.TMPDIR||'/tmp','al2023','lib');
const browser=await chromium.launch({executablePath:await slim.executablePath(),headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const context=await browser.newContext({viewport:{width:1440,height:900}});
const page=await context.newPage();
const pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));

const ready=()=>page.waitForFunction(()=>!document.querySelector('.boot-splash')&&document.querySelector('#main-content')?.children.length>0&&window.__LAW_OFFICE_APP__?.office,null,{timeout:600000});
const med=a=>{const s=[...a].sort((x,y)=>x-y);return s[Math.floor(s.length/2)]};

try{
 await page.goto(`${base}/index.html`,{waitUntil:'domcontentloaded'});
 await ready();
 // ===== 1) الملء: دفعات 2000 سجل لكل معاملة =====
 const seedStart=Date.now();
 await page.evaluate(async N=>{
  const app=window.__LAW_OFFICE_APP__;const db=app.office.ctx.db;
  const now=new Date().toISOString();
  const names=['محمد','أحمد','علي','محمود','حسن','إبراهيم','خالد','سامح','عمرو','فاطمة'];
  const surn=['السيد','عبد الله','خضير','فؤاد','النجار','الشرقاوي','جاد','حسين'];
  for(let start=0;start<N;start+=2000){
   const end=Math.min(N,start+2000);
   await new Promise((res,rej)=>{
    const tx=db.transaction(['clients','files'],'readwrite');
    tx.oncomplete=res;tx.onerror=()=>rej(tx.error);tx.onabort=()=>rej(tx.error);
    const cs=tx.objectStore('clients'),fs=tx.objectStore('files');
    for(let i=start;i<end;i++){
     const id=`bench-c-${String(i).padStart(8,'0')}`;
     const full=`${names[i%names.length]} ${names[(i*7)%names.length]} ${surn[i%surn.length]} ${i}`;
     cs.put({id,fullName:full,fullNameNormalized:full.replace(/أ|إ|آ/g,'ا'),nationalId:String(29000000000000+i),clientCode:`CL${2026}${String(i).padStart(7,'0')}`,phones:['0100'+String(1000000+i)],status:'active',createdAt:now,updatedAt:now,version:1,isDeleted:false});
     const title=`قضية ${surn[(i*3)%surn.length]} رقم ${i} عقد بيع`;
     fs.put({id:`bench-f-${String(i).padStart(8,'0')}`,fileNumber:`${2026}/${String(i+1).padStart(6,'0')}`,title,titleNormalized:title.replace(/أ|إ|آ/g,'ا'),fileType:'مدني',status:'open',searchText:`${title} ${full}`.replace(/أ|إ|آ/g,'ا'),partyNames:full,searchIndexedAt:now,createdAt:now,updatedAt:now,version:1,isDeleted:false});
    }
   });
  }
 },N);
 const seedMs=Date.now()-seedStart;

 // ===== 2) الإقلاع الدافئ: إعادة فتح القاعدة المليئة =====
 const boots=[];
 for(let i=0;i<reloads;i++){
  const t=Date.now();
  await page.reload({waitUntil:'domcontentloaded'});
  await ready();
  boots.push(Date.now()-t);
 }

 // ===== 2b) صيانة الإقلاع (تُنفَّذ عند كل فتح): قياس منفصل لأنها تمسح الملفات كلها =====
 const maintenanceMs=[];
 for(let i=0;i<2;i++){
  maintenanceMs.push(await page.evaluate(async()=>{const {runMaintenance}=await import('./js/services/maintenance.js');const t=performance.now();await runMaintenance(window.__LAW_OFFICE_APP__.office);return Math.round(performance.now()-t)}));
 }

 // ===== 3) البحث الشامل بعد الإقلاع =====
 const queries={noMatch:'كلمة غير موجودة إطلاقا',word:'عقد بيع',nameAndNumber:'محمد 1234',code:'CL2026'};
 const search={};
 for(const [k,q] of Object.entries(queries)){
  const times=[];let total=0;
  for(let i=0;i<3;i++){
   const r=await page.evaluate(async q=>{
    const mod=await import('./js/services/search-engine.js');
    const app=window.__LAW_OFFICE_APP__;
    const {allSearchStores}=mod;
    const t=performance.now();
    const res=await mod.searchAll(app.office,q,{stores:mod.PRIMARY_STORES,perStore:8});
    return {ms:performance.now()-t,total:res.total};
   },q);
   times.push(r.ms);total=r.total;
  }
  search[k]={medianMs:Math.round(med(times)),results:total};
 }
 // البحث الكامل في كل الأقسام (الشاشة الكاملة تستدعيه بعد الأقسام الرئيسية)
 const fullTimes=[];
 for(let i=0;i<2;i++){
  fullTimes.push(await page.evaluate(async()=>{const mod=await import('./js/services/search-engine.js');const t=performance.now();await mod.searchAll(window.__LAW_OFFICE_APP__.office,'كلمة غير موجودة إطلاقا',{stores:mod.allSearchStores(),perStore:6});return performance.now()-t}));
 }
 const counts=await page.evaluate(async()=>{const o=window.__LAW_OFFICE_APP__.office;return {clients:await o.r.clients.count(),files:await o.r.files.count()}});

 const out={date:new Date().toISOString(),label,base,N,counts,seedMs,warmBootMs:boots,warmBootMedianMs:med(boots),maintenanceMs,search,fullNoMatchMs:Math.round(med(fullTimes)),pageErrors};
 const dir=path.join(repository,'.cache','bench');await fs.mkdir(dir,{recursive:true});
 await fs.writeFile(path.join(dir,`scale-${label}-${N}.json`),JSON.stringify(out,null,2));
 console.log(JSON.stringify(out,null,2));
}finally{await context.close().catch(()=>{});await browser.close().catch(()=>{})}
