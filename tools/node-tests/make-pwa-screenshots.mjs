// =====================================================================
// توليد لقطات شاشة الهاتف للـmanifest (1080x1920) من التطبيق نفسه
// ---------------------------------------------------------------------
// ملاحظة أمانة: اللقطات مأخوذة من تشغيل حقيقي للتطبيق في Chromium
// بمقاس هاتف 360×640 بكثافة 3 (أي 1080×1920 بكسل فعليًا) — لا صور مركّبة
// ولا واجهات مصمَّمة يدويًا. الحقول المعروضة بيانات عرض عامة لا بيانات مكتب.
//
// التشغيل: node make-pwa-screenshots.mjs   (من داخل tools/node-tests)
//          npm run screenshots:pwa
// يحتاج خادمًا محليًا على 127.0.0.1:8000 (نفس أسلوب بقية مجموعات الاختبار)،
// وإن لم يجده يشغّل خادمًا داخليًا مؤقتًا.
import {chromium} from 'playwright';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

const repository=path.resolve(new URL('../../',import.meta.url).pathname);
const outDir=path.join(repository,'screenshots');
await fs.mkdir(outDir,{recursive:true});
let base=(process.env.GRID_BASE_URL||'http://127.0.0.1:8000').replace(/\/$/,'');

const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.ico':'image/x-icon','.woff2':'font/woff2','.txt':'text/plain; charset=utf-8','.md':'text/markdown; charset=utf-8'};

const reachable=async url=>new Promise(resolve=>{const request=http.get(url,response=>{response.resume();resolve(response.statusCode<500)});request.on('error',()=>resolve(false));request.setTimeout(1500,()=>{request.destroy();resolve(false)})});

let temporaryServer=null;
if(!await reachable(`${base}/index.html`)){
 const server=http.createServer(async(request,response)=>{
  try{
   const url=new URL(request.url,'http://localhost');
   const file=path.join(repository,decodeURIComponent(url.pathname));
   if(!file.startsWith(repository)){response.writeHead(403).end();return}
   const stat=await fs.stat(file).catch(()=>null);
   const target=stat?.isDirectory()?path.join(file,'index.html'):file;
   const body=await fs.readFile(target);
   response.writeHead(200,{'content-type':mime[path.extname(target).toLowerCase()]||'application/octet-stream','cache-control':'no-store'});
   response.end(body);
  }catch{response.writeHead(404).end()}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 base=`http://127.0.0.1:${server.address().port}`;
 temporaryServer=server;
 console.log(`temporary static server: ${base}`);
}

const require=createRequire(import.meta.url);
const {default:slim,inflate}=await import('@sparticuz/chromium');
await inflate(path.resolve(path.dirname(require.resolve('@sparticuz/chromium')),'../bin/al2023.tar.br'));
process.env.LD_LIBRARY_PATH=path.join(process.env.TMPDIR||'/tmp','al2023','lib');
const browser=await chromium.launch({executablePath:await slim.executablePath(),headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});

// 360×640 بكثافة 3 = 1080×1920 بالضبط، بنفس مقاسات manifest
const context=await browser.newContext({
 viewport:{width:360,height:640},deviceScaleFactor:3,isMobile:true,hasTouch:true,
 locale:'ar',userAgent:'Mozilla/5.0 (Linux; Android 13; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
});
const page=await context.newPage();
const problems=[];
page.on('pageerror',error=>problems.push(error.message));
await page.goto(`${base}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>window.__LAW_OFFICE_APP__?.office&&!window.__LAW_OFFICE_APP__.booting,null,{timeout:90000});
await page.evaluate(()=>document.fonts?.ready).catch(()=>{});
await page.waitForTimeout(1200);
// إخفاء عناصر مؤقتة تخص هذه الجلسة فقط (تلميح التثبيت · شارة عدم الاتصال · إشعارات) فلا تظهر في اللقطات
await page.waitForTimeout(4200); // حتى تنتهي إشعارات الجلسة تلقائيًا قبل اللقطة
await page.addStyleTag({content:'#install-hint,.install-hint,.offline-badge,#toast-stack,.toast-stack{display:none!important}'});
await page.waitForTimeout(600);

// لقطة الجدول تبدأ من أعلى الصفوف (التمرير حتى أول صف) لا من رأس الصفحة الذي يكون فارغًا على الهاتف
const scrollToFirstGridRow=()=>page.evaluate(()=>{
 const row=document.querySelector('.dg tbody tr');
 if(row)window.scrollTo(0,Math.max(0,row.getBoundingClientRect().top+window.scrollY-90));
});
const shots=[
 {route:'dashboard',file:'home-mobile.jpg',wait:2600,label:'الشاشة الرئيسية',before:()=>page.evaluate(()=>window.scrollTo(0,0))},
 {route:'files',file:'files-mobile.jpg',wait:3200,label:'الملفات القانونية',before:scrollToFirstGridRow}
];
for(const shot of shots){
 await page.evaluate(route=>window.__LAW_OFFICE_APP__.go(route),shot.route);
 await page.waitForTimeout(shot.wait);
 await shot.before();
 await page.waitForTimeout(500);
 const target=path.join(outDir,shot.file);
 await page.screenshot({path:target,type:'jpeg',quality:86,fullPage:false});
 const {size}=await fs.stat(target);
 console.log(`${shot.label} → ${path.relative(repository,target)} (${Math.round(size/1024)} KB)`);
}

await browser.close();
if(temporaryServer)temporaryServer.close();
if(problems.length){console.error('page errors during capture:',problems);process.exit(1)}
console.log('done');
