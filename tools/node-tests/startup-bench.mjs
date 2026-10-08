// قياس الإقلاع الفعلي في Chromium: عدد وحجم ملفات JS المحمّلة قبل أول شاشة قابلة للاستخدام،
// زمن الإقلاع، وزمن الانتقال إلى صفحات ثقيلة. الناتج يُكتب في .cache (غير مُتتبَّع في Git).
import {chromium} from 'playwright';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';

const repository=path.resolve(new URL('../../',import.meta.url).pathname);
const base=(process.env.BENCH_BASE_URL||'http://127.0.0.1:8080').replace(/\/$/,'');
const runs=Number(process.env.BENCH_RUNS||3);
const require=createRequire(import.meta.url);
const {default:slim,inflate}=await import('@sparticuz/chromium');
await inflate(path.resolve(path.dirname(require.resolve('@sparticuz/chromium')),'../bin/al2023.tar.br'));
process.env.LD_LIBRARY_PATH=path.join(process.env.TMPDIR||'/tmp','al2023','lib');
const browser=await chromium.launch({executablePath:await slim.executablePath(),headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});

const results=[];
try{
 for(let i=0;i<runs;i++){
  const context=await browser.newContext({viewport:{width:1440,height:900}});
  const page=await context.newPage();
  const jsRequests=[];
  page.on('response',r=>{const u=r.url();if(/\.js(\?|$)/.test(u))jsRequests.push({u:u.replace(base,'').split('?')[0]})});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const t0=Date.now();
  await page.goto(`${base}/index.html`,{waitUntil:'domcontentloaded'});
  // أول لحظة يكون فيها الجدول/اللوحة الرئيسية معروضة (لا شاشة الإقلاع)
  await page.waitForFunction(()=>!document.querySelector('.boot-splash')&&document.querySelector('#main-content')?.children.length>0,null,{timeout:120000});
  const bootMs=Date.now()-t0;
  const bootJs=jsRequests.length, bootBytes=(await Promise.all(jsRequests.map(x=>fs.stat(path.join(repository,x.u)).then(st=>st.size,()=>0)))).reduce((n,v)=>n+v,0);
  // انتقال إلى صفحات ثقيلة عبر التوجيه الداخلي
  const navTimes={};
  for(const route of ['executionCenter','analytics','integrity']){
   const s=Date.now();
   await page.evaluate(r=>window.__LAW_OFFICE_APP__.go(r),route);
   await page.waitForFunction(()=>!document.querySelector('.skel-page'),null,{timeout:120000}).catch(()=>{});
   navTimes[route]=Date.now()-s;
  }
  results.push({run:i+1,bootMs,bootJsFiles:bootJs,bootJsBytes:bootBytes,navMs:navTimes,jsFilesAfterNav:jsRequests.length,errors});
  await context.close();
 }
}finally{await browser.close().catch(()=>{})}

const med=a=>{const s=[...a].sort((x,y)=>x-y);return s[Math.floor(s.length/2)]};
const summary={
 bootMsMedian:med(results.map(r=>r.bootMs)),
 bootJsFilesMedian:med(results.map(r=>r.bootJsFiles)),
 bootJsKBMedian:Math.round(med(results.map(r=>r.bootJsBytes))/1024),
 jsFilesAfterNavMedian:med(results.map(r=>r.jsFilesAfterNav)),
 navMsMedian:Object.fromEntries(Object.keys(results[0].navMs).map(k=>[k,med(results.map(r=>r.navMs[k]))])),
 pageErrors:results.flatMap(r=>r.errors)
};
const out={date:new Date().toISOString(),base,runs,summary,results};
const dir=path.join(repository,'.cache','bench');await fs.mkdir(dir,{recursive:true});
const file=path.join(dir,process.env.BENCH_LABEL?`startup-${process.env.BENCH_LABEL}.json`:'startup.json');
await fs.writeFile(file,JSON.stringify(out,null,2));
console.log(JSON.stringify(summary,null,2));
