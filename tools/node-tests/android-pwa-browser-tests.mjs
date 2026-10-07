// =====================================================================
// اختبار Android/PWA في متصفح حقيقي (chromium مُمكَّن للهاتف)
// ---------------------------------------------------------------------
// يفحص ما لا يُفحص في Node:
//   • صلاحية manifest + شروط التثبيت (CDP Page.getInstallabilityErrors)
//   • Service Worker: التثبيت، الاستيلاء بعد إعادة التحميل، السيطرة على الطلب
//   • الإقلاع دون اتصال (Offline restart) والتنقّل بين الشاشات كذلك
//   • زر الرجوع: إغلاق الطبقات، ثم العودة بين الشاشات، ثم الخروج
//   • بقاء IndexedDB و localStorage بعد إعادة التشغيل
//   • تحديث الإصدار بترقية كاش Service Worker مع بقاء البيانات كما هي
// هذا اختبار محاكاة هاتف (Chromium mobile emulation) وليس جهازًا حقيقيًا؛
// التقرير النهائي يذكر ذلك صراحة.
import {chromium} from 'playwright';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const repository=path.resolve(new URL('../../',import.meta.url).pathname);
const base=(process.env.GRID_BASE_URL||'http://127.0.0.1:8000').replace(/\/$/,'');
const artifactDir=path.join(repository,'.cache','android-pwa');
await fs.mkdir(artifactDir,{recursive:true});

const require=createRequire(import.meta.url);
const {default:slim,inflate}=await import('@sparticuz/chromium');
await inflate(path.resolve(path.dirname(require.resolve('@sparticuz/chromium')),'../bin/al2023.tar.br'));
process.env.LD_LIBRARY_PATH=path.join(process.env.TMPDIR||'/tmp','al2023','lib');
const browser=await chromium.launch({executablePath:await slim.executablePath(),headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});

const report={date:new Date().toISOString(),browser:browser.version(),environment:'Chromium mobile emulation (Android-like) — NOT a physical Android device',checks:[],errors:[],limitations:[]};
const verify=async(name,fn,status='VERIFIED — real browser output (emulated Android viewport)')=>{await fn();report.checks.push({name,status});console.log(`VERIFIED — ${name}`)};

const phone={viewport:{width:412,height:915},deviceScaleFactor:2.625,isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (Linux; Android 13; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'};
const boot=async(page)=>{
  await page.goto(`${base}/index.html`,{waitUntil:'domcontentloaded'});
  const ready=()=>page.waitForFunction(()=>window.__LAW_OFFICE_APP__?.office&&!window.__LAW_OFFICE_APP__.booting,null,{timeout:90000});
  try{await ready()}catch(error){
   const state=await page.evaluate(()=>({
    title:document.title,readyState:document.readyState,
    hasApp:Boolean(window.__LAW_OFFICE_APP__),booting:window.__LAW_OFFICE_APP__?.booting,
    office:Boolean(window.__LAW_OFFICE_APP__?.office),recovery:Boolean(window.__LAW_OFFICE_APP__?.registry?.recoveryMode),
    hash:location.hash,registry:localStorage.getItem('AhmadKhudairLawOffice::Registry::v1')?.slice(0,300),
    error:document.querySelector('.error-box')?.textContent?.slice(0,300)||'',body:document.body.textContent.slice(0,300)
   })).catch(()=>null);
   throw new Error(`app did not boot: ${JSON.stringify(state)} :: ${error.message}`);
  }
  await page.waitForFunction(()=>window.__LAW_OFFICE_APP__.route&&document.querySelector('#main-content').children.length>0,null,{timeout:90000});
};
const counts=page=>page.evaluate(async()=>{
  const r=window.__LAW_OFFICE_APP__.office.r,out={};
  for(const store of ['clients','files','cases','hearings','procedures','settings'])out[store]=await r[store].count();
  return out;
});

// =====================================================================
// 1) manifest + معايير التثبيت + الطبقات الآمنة على مقاس الهاتف
// =====================================================================
{
 const context=await browser.newContext(phone);
 const page=await context.newPage();
 const consoleErrors=[];
 page.on('pageerror',error=>report.errors.push(error.message));
 page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text())});
 await boot(page);
 const cdp=await context.newCDPSession(page);

 await verify('Manifest: fetchable, valid, installable identity (name/id/start_url/scope/display)',async()=>{
  const manifest=await cdp.send('Page.getAppManifest');
  assert.equal(manifest.errors?.length||0,0,`manifest errors: ${JSON.stringify(manifest.errors)}`);
  const raw=manifest.parsed?.manifest??manifest.parsed?.data??manifest.data;
  const parsed=typeof raw==='string'?JSON.parse(raw):raw;
  assert.ok(parsed&&parsed.name,`unreadable manifest payload: ${JSON.stringify(Object.keys(manifest))}`);
  assert.ok(parsed.name.includes('خضير'),'official office name');
  assert.equal(parsed.lang,'ar');assert.equal(parsed.dir,'rtl');
  assert.equal(parsed.display,'standalone');
  assert.equal(parsed.start_url,'./');assert.equal(parsed.scope,'./');assert.equal(parsed.id,'./');
  assert.ok(parsed.icons.some(icon=>icon.sizes==='192x192'&&icon.purpose==='any'),'192 any icon');
  assert.ok(parsed.icons.some(icon=>icon.sizes==='512x512'&&icon.purpose==='maskable'),'512 maskable icon');
  report.manifest={name:parsed.name,id:parsed.id,icons:parsed.icons.length};
 });

 await verify('Installability: no Chrome installability errors and icons resolve',async()=>{
  const {installabilityErrors}=await cdp.send('Page.getInstallabilityErrors');
  assert.deepEqual(installabilityErrors,[],JSON.stringify(installabilityErrors));
  for(const asset of ['icons/icon-192.png','icons/icon-512.png','icons/maskable-192.png','icons/maskable-512.png']){
   const response=await page.request.get(`${base}/${asset}`);
   assert.equal(response.status(),200,asset);
   assert.equal(response.headers()['content-type'],'image/png',`${asset} content-type`);
  }
  report.installabilityErrors=installabilityErrors;
 });

 await verify('Service worker: registers, takes control, and precaches the whole runtime graph',async()=>{
  await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller),null,{timeout:60000});
  const state=await page.evaluate(async()=>{
   const registration=await navigator.serviceWorker.ready;
   const keys=await caches.keys();
   const cache=await caches.open(keys[0]);
   const entries=(await cache.keys()).length;
   const persisted=navigator.storage?.persisted?await navigator.storage.persisted():null;
   return {scope:registration.scope,keys,entries,controller:navigator.serviceWorker.controller.scriptURL,persisted};
  });
  assert.equal(state.keys.length,1,'exactly one application cache');
  assert.ok(state.keys[0].startsWith('ahmad-khudair-law-office-'),state.keys[0]);
  assert.ok(state.entries>150,`precached entries: ${state.entries}`);
  assert.ok(state.controller.endsWith('/sw.js'));
  report.serviceWorker={cache:state.keys[0],entries:state.entries,scope:state.scope,persisted:state.persisted};
 });

 await verify('Safe areas: viewport-fit=cover, no layout under system bars, no horizontal page scroll',async()=>{
  const layout=await page.evaluate(()=>{
   const viewport=document.querySelector('meta[name=viewport]')?.getAttribute('content')||'';
   const barTop=document.querySelector('#sidebar.tn-bar').getBoundingClientRect().top;
   const toast=getComputedStyle(document.querySelector('#toast-stack')).bottom;
   return {viewport,barTop,docScroll:document.documentElement.scrollWidth-window.innerWidth,toastBottom:toast};
  });
  assert.ok(layout.viewport.includes('viewport-fit=cover'),'viewport-fit=cover');
  assert.equal(layout.barTop,0,'navigation bar starts at the very top (no hidden content)');
  assert.equal(layout.docScroll,0,'no horizontal scrolling of the page');
 });

 await verify('Touch: primary controls on a phone reach the ~44px target and inputs are keyboard-safe',async()=>{
  const audit=await page.evaluate(async()=>{
   const visit=async route=>{window.__LAW_OFFICE_APP__.go(route);await new Promise(r=>setTimeout(r,1400));
    const items=[...document.querySelectorAll('.top-actions button,.tn-tab,.tn-btn,.primary,.ghost')]
     .filter(el=>el.offsetParent!==null)
     .map(el=>({h:Math.round(el.getBoundingClientRect().height),label:(el.textContent||'').trim().slice(0,16)}));
    return {route,total:items.length,tooSmall:items.filter(x=>x.h<40)};
   };
   const out=[];for(const route of ['dashboard','files','settings'])out.push(await visit(route));
   const field=document.querySelector('#main-content input:not([type=checkbox]):not([type=radio]),#main-content select');
   const margins=field?getComputedStyle(field).scrollMarginBlockStart:null;
   return {out,margins};
  });
  const bad=audit.out.filter(x=>x.tooSmall.length);
  assert.deepEqual(bad,[],`small touch targets: ${JSON.stringify(bad)}`);
  assert.ok(audit.margins!=='0px'&&audit.margins!==null,'focused fields keep scroll margin for the on-screen keyboard');
  report.touch=audit.out.map(x=>({route:x.route,controls:x.total}));
 });

 await verify('Mobile DataGrid + RTL: table scrolls inside its own container, page never overflows, Arabic layout stays RTL',async()=>{
  await page.evaluate(()=>window.__LAW_OFFICE_APP__.go('files'));
  await page.waitForTimeout(2200);
  const grid=await page.evaluate(()=>{
   const scroll=document.querySelector('#main-content .dg-scroll,.dg-scroll');
   const head=document.querySelector('.dg thead th');
   return {
    dir:document.documentElement.dir,
    hasGrid:Boolean(scroll),
    innerScroll:scroll?scroll.scrollWidth>scroll.clientWidth:false,
    pageOverflow:document.documentElement.scrollWidth-window.innerWidth,
    headerRight:head?Math.round(head.getBoundingClientRect().right):0,
    viewport:window.innerWidth,
    rows:document.querySelectorAll('.dg tbody tr').length,
    tools:document.querySelectorAll('.dg-toolbar button').length
   };
  });
  assert.equal(grid.dir,'rtl','Arabic RTL layout is preserved');
  assert.equal(grid.hasGrid,true,'the DataGrid is present on the phone screen');
  assert.equal(grid.innerScroll,true,'long Arabic tables scroll horizontally inside their container');
  assert.equal(grid.pageOverflow,0,'the page itself never scrolls horizontally');
  assert.ok(grid.rows>0,`no rows rendered (${grid.rows})`);
  assert.ok(grid.tools>0,'grid toolbar is reachable on the phone');
  assert.ok(grid.headerRight<=grid.viewport+1,'table starts from the right in RTL');
  report.mobileGrid=grid;
 });

 await verify('Landscape orientation: no overflow, no lost navigation, layout still usable',async()=>{
  await page.setViewportSize({width:915,height:412});
  await page.evaluate(()=>window.__LAW_OFFICE_APP__.go('dashboard'));
  await page.waitForTimeout(1800);
  const state=await page.evaluate(()=>({
   overflow:document.documentElement.scrollWidth-window.innerWidth,
   navVisible:Boolean(document.querySelector('#sidebar.tn-bar')?.getBoundingClientRect().height>0),
   title:document.querySelector('#page-title').textContent,
   error:Boolean(document.querySelector('.error-box'))
  }));
  assert.equal(state.overflow,0,'no horizontal overflow in landscape');
  assert.equal(state.navVisible,true,'navigation stays visible in landscape');
  assert.equal(state.error,false,'no error screen in landscape');
  await page.setViewportSize({width:412,height:915});
  await page.waitForTimeout(600);
 });

 await verify('Mobile navigation panel: Android back closes the phone nav drawer too',async()=>{
  await page.evaluate(()=>document.querySelector('#mobile-menu')?.click());
  await page.waitForTimeout(600);
  const opened=await page.evaluate(()=>Boolean(document.querySelector('#sidebar .tn-panel:not([hidden])')));
  assert.equal(opened,true,'the phone navigation panel opens');
  await page.goBack();
  await page.waitForTimeout(700);
  const closed=await page.evaluate(()=>({panel:Boolean(document.querySelector('#sidebar .tn-panel:not([hidden])')),route:window.__LAW_OFFICE_APP__.route}));
  assert.equal(closed.panel,false,'back closes the navigation panel');
  assert.equal(closed.route,'dashboard','back does not leave the current screen');
 });

 await verify('Android back button: closes overlay, returns between screens, then leaves the app',async()=>{
  await page.evaluate(()=>window.__LAW_OFFICE_APP__.go('dashboard'));
  await page.waitForTimeout(1600);
  await page.evaluate(()=>window.__LAW_OFFICE_APP__.go('files'));
  await page.waitForTimeout(2000);
  await page.evaluate(()=>document.querySelector('#quick-add')?.click());
  await page.waitForFunction(()=>document.querySelector('#modal-root .modal-card'),null,{timeout:15000});
  const route=await page.evaluate(()=>window.__LAW_OFFICE_APP__.route);
  const depthWithOverlay=await page.evaluate(()=>window.__LAW_OFFICE_APP__.routeHistory.depth);
  assert.equal(depthWithOverlay>0,true,'an open overlay is protected by a history entry');
  await page.goBack();
  await page.waitForTimeout(500);
  const afterModal=await page.evaluate(()=>({modal:Boolean(document.querySelector('#modal-root .modal-card')),route:window.__LAW_OFFICE_APP__.route,url:location.hash}));
  assert.equal(afterModal.modal,false,'back closes the open modal');
  assert.equal(afterModal.route,route,'back never loses the current screen');
  assert.equal(afterModal.url,'#/files','the address keeps the screen route');
  await page.goBack();
  await page.waitForTimeout(1500);
  const afterScreenBack=await page.evaluate(()=>({route:window.__LAW_OFFICE_APP__.route,title:document.querySelector('#page-title').textContent}));
  assert.equal(afterScreenBack.route,'dashboard','back returns to the previous screen, not out of the app');
  const depth=await page.evaluate(()=>window.__LAW_OFFICE_APP__.routeHistory?.depth);
  assert.equal(depth,depthWithOverlay-2,'exactly one history entry consumed per back press (no leaks, no dead presses)');
  report.backButton={afterModal,afterScreenBack,depthWithOverlay,depth};
 });

 await verify('Screen state survives back: an open form closes, but the page behind keeps its filters and data',async()=>{
  await page.evaluate(()=>window.__LAW_OFFICE_APP__.go('files'));
  await page.waitForTimeout(2200);
  // حالة صفحة حقيقية: نص البحث داخل الجدول
  await page.evaluate(()=>{const input=document.querySelector('.dg-quick');input.value='ملف تجريبي';input.dispatchEvent(new Event('input',{bubbles:true}))});
  await page.waitForTimeout(1200);
  const beforeClose=await page.evaluate(()=>({route:window.__LAW_OFFICE_APP__.route,quick:document.querySelector('.dg-quick')?.value,rows:document.querySelectorAll('.dg tbody tr').length}));
  // نموذج مفتوح فيه بيانات غير محفوظة، ثم زر الرجوع
  await page.evaluate(()=>document.querySelector('#quick-add')?.click());
  await page.waitForSelector('#modal-root .modal-card',{timeout:15000});
  const typed=await page.evaluate(()=>{
   const field=document.querySelector('#modal-root .modal-card input[type=text],#modal-root .modal-card input:not([type=button]):not([type=submit])');
   if(!field)return false;
   field.value='بيانات غير محفوظة للاختبار';field.dispatchEvent(new Event('input',{bubbles:true}));
   return true;
  });
  assert.equal(typed,true,'the open form accepts input');
  await page.goBack();
  await page.waitForTimeout(700);
  const afterBack=await page.evaluate(()=>({
   modal:Boolean(document.querySelector('#modal-root .modal-card')),
   route:window.__LAW_OFFICE_APP__.route,
   quick:document.querySelector('.dg-quick')?.value,
   error:Boolean(document.querySelector('.error-box'))
  }));
  assert.equal(afterBack.modal,false,'back closes the form (same as the visible close button)');
  assert.equal(afterBack.error,false,'no error state after back');
  assert.equal(afterBack.route,beforeClose.route,'back keeps the same screen');
  assert.equal(afterBack.quick,beforeClose.quick,'the page filter is untouched by opening/closing a form');
  report.backKeepsPageState={beforeClose,afterBack};
 });

 await verify('Storage pressure: a QuotaExceededError surfaces as Arabic guidance, never as a raw browser error',async()=>{
  const before=await page.evaluate(()=>document.querySelectorAll('#toast-stack .toast').length);
  await page.evaluate(()=>{
   // حدث تخزين حقيقي الشكل بلا رفض فعلي: لا نلوّث سلة الأخطاء في التشخيص.
   const error=new DOMException('quota','QuotaExceededError');
   window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection',{promise:Promise.resolve(),reason:error}));
  });
  await page.waitForTimeout(900);
  const text=await page.evaluate(()=>document.querySelector('#toast-stack')?.textContent||'');
  assert.ok(text.includes('نسخة احتياطية'),`Arabic storage guidance not shown: ${text.slice(0,120)}`);
  assert.equal(text.includes('QuotaExceededError'),false,'no raw technical error text is shown to the user');
  report.quotaToast=text.slice(0,160);
  assert.ok(before>=0);
 });

 await verify('Direct link + refresh: deep route opens without server routing and survives reload',async()=>{
  await page.goto(`${base}/index.html#/${encodeURIComponent('clients')}`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__LAW_OFFICE_APP__?.office&&!window.__LAW_OFFICE_APP__.booting,null,{timeout:90000});
  assert.equal(await page.evaluate(()=>window.__LAW_OFFICE_APP__.route),'clients');
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__LAW_OFFICE_APP__?.office&&!window.__LAW_OFFICE_APP__.booting,null,{timeout:90000});
  assert.equal(await page.evaluate(()=>window.__LAW_OFFICE_APP__.route),'clients','refresh keeps the same screen');
  assert.equal(await page.evaluate(()=>document.querySelector('.error-box')),null,'no error screen after refresh');
  await page.evaluate(()=>window.__LAW_OFFICE_APP__.go('dashboard'));
  await page.waitForTimeout(500);
 });

 // بيانات مرجعية للاختبارات التالية + لقطة إعدادات
 await page.evaluate(async()=>{
  const app=window.__LAW_OFFICE_APP__;
  const {uid}=await import('./js/core/id.js');
  await app.office.r.clients.put({id:uid(),fullName:'اختبار Android PWA',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),version:1});
 });
 report.beforeRestart=await counts(page);
 await page.evaluate(()=>{localStorage.setItem('akl:pwa:e2e','keep')});

 // ---- إعادة تشغيل التطبيق: البيانات تبقى ----
 await page.close();
 await new Promise(resolve=>setTimeout(resolve,500)); // إغلاق اتصال IndexedDB غير متزامن في Chromium
 const page2=await context.newPage();
 page2.on('pageerror',error=>report.errors.push(error.message));
 await boot(page2);
 await verify('App restart: IndexedDB and preferences survive a full page/app restart',async()=>{
  const after=await counts(page2);
  assert.deepEqual(after,report.beforeRestart,`stores changed: ${JSON.stringify({before:report.beforeRestart,after})}`);
  assert.equal(await page2.evaluate(()=>localStorage.getItem('akl:pwa:e2e')),'keep');
  assert.equal(await page2.evaluate(()=>Boolean(window.__LAW_OFFICE_APP__.routeHistory)),true,'history controller is rebuilt on boot');
 });
 await page2.close();

 // ---- إغلاق كامل + إقلاع دون اتصال ----
 await context.setOffline(true);
 const page3=await context.newPage();
 page3.on('pageerror',error=>report.errors.push(error.message));
 const offlineStart=Date.now();
 await page3.goto(`${base}/index.html`,{waitUntil:'domcontentloaded'});
 await page3.waitForFunction(()=>window.__LAW_OFFICE_APP__?.office&&!window.__LAW_OFFICE_APP__.booting,null,{timeout:90000});
 const offlineMs=Date.now()-offlineStart;
 await verify('Offline restart: the app boots from cache with no network and keeps every local record',async()=>{
  assert.equal(await page3.evaluate(()=>navigator.onLine),false);
  const after=await counts(page3);
  assert.deepEqual(after,report.beforeRestart);
  const badge=await page3.textContent('#network-badge');
  assert.ok(badge.includes('عدم الاتصال'),badge);
  assert.equal(await page3.isVisible('.error-box').catch(()=>false),false,'no technical error screen when offline');
  report.offlineBootMs=offlineMs;
 });
 await verify('Offline navigation: screens, dashboard and local search open with no network',async()=>{
  for(const route of ['files','clients','dashboard','actionCenter','search']){
   await page3.evaluate(r=>window.__LAW_OFFICE_APP__.go(r),route);
   await page3.waitForTimeout(1600);
   const info=await page3.evaluate(()=>({title:document.querySelector('#page-title').textContent,error:Boolean(document.querySelector('.error-box')),html:document.querySelector('#main-content').innerHTML.length}));
   assert.equal(info.error,false,`${route} showed an error box offline`);
   assert.ok(info.html>200,`${route} rendered nothing offline`);
  }
 });
 await verify('Offline local work: a local write is saved offline and survives an offline reload',async()=>{
  const before=await counts(page3);
  const key=await page3.evaluate(async()=>{
   const app=window.__LAW_OFFICE_APP__,{uid}=await import('./js/core/id.js');
   const id=uid();
   await app.office.r.clients.put({id,fullName:'عميل أُنشئ دون اتصال',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),version:1});
   return id;
  });
  // فرصة قصيرة لالتزام المعاملة قبل إعادة التحميل (IndexedDB تُثبّت بعد نجاح الطلب).
  await page3.waitForTimeout(600);
  await page3.reload({waitUntil:'domcontentloaded'});
  await page3.waitForFunction(()=>window.__LAW_OFFICE_APP__?.office&&!window.__LAW_OFFICE_APP__.booting,null,{timeout:90000});
  const after=await counts(page3);
  assert.equal(after.clients,before.clients+1,`offline write persisted across an offline reload (before=${before.clients}, after=${after.clients})`);
  const row=await page3.evaluate(id=>window.__LAW_OFFICE_APP__.office.r.clients.get(id),key);
  assert.equal(row.fullName,'عميل أُنشئ دون اتصال');
  report.offlineWrite={store:'clients',id:key};
 });
 await page3.screenshot({path:path.join(artifactDir,'offline-files.png')}).catch(()=>{});
 await page3.close();
 await context.setOffline(false);

 // ---- تحديث التطبيق: كاش جديد مع بقاء البيانات ----
 await verify('App update (version A -> B): new release downloads and waits, then activates on request with data intact',async()=>{
  const page=await context.newPage();
  const before=await (async()=>{await boot(page);return counts(page)})();
  const previousCache=await page.evaluate(async()=>(await caches.keys())[0]);
  await page.evaluate(async()=>{ // كاش إصدار قديم متروك من نسخة سابقة + كاش غير تابع للتطبيق
   const stale=await caches.open('ahmad-khudair-law-office-v0-obsolete');
   await stale.put('./__obsolete__.js',new Response('old release'));
  });
  // "نشر نسخة جديدة" فعليًا: تغيير ملف sw.js على القرص كما يحدث عند النشر على GitHub Pages.
  const swPath=path.join(repository,'sw.js');
  const original=await fs.readFile(swPath,'utf8');
  const bumped=original.replace(/const CACHE='([^']+)'/,(_m,name)=>`const CACHE='${name}-e2e-update'`);
  assert.notEqual(bumped,original,'the release cache name must be bumped for a new deployment');
  try{
   await fs.writeFile(swPath,bumped);
   const discovery=await page.evaluate(async()=>{
    const registration=await navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'});
    await registration.update();
    const deadline=Date.now()+45000;
    while(Date.now()<deadline){
     const keys=await caches.keys();
     if(keys.some(key=>key.endsWith('-e2e-update')))return {found:true,keys,waiting:Boolean(registration.waiting)};
     await new Promise(resolve=>setTimeout(resolve,400));
    }
    const keys=await caches.keys();
    return {found:false,keys,waiting:Boolean(registration.waiting)};
   });
   assert.equal(discovery.found,true,`new release never precached: ${JSON.stringify(discovery)}`);
   assert.equal(discovery.waiting,true,'A new release must WAIT (no silent takeover of the open session)');
   assert.equal(discovery.keys.includes(previousCache),true,'the running release cache must stay active until the user accepts');
   const stillWorking=await page.evaluate(()=>({route:window.__LAW_OFFICE_APP__.route,title:document.querySelector('#page-title').textContent}));
   assert.ok(stillWorking.route&&stillWorking.title,'the running version keeps working while the update waits');
   report.updateWaiting={keys:discovery.keys,previousCache,waiting:true};
   // قبول المستخدم (زر «تحديث الآن»): SKIP_WAITING ثم إعادة تحميل واحدة.
   await page.evaluate(async()=>{
    const registration=await navigator.serviceWorker.ready;
    const waiting=registration.waiting||(await navigator.serviceWorker.getRegistration())?.waiting;
    waiting?.postMessage({type:'SKIP_WAITING'});
    await new Promise(resolve=>setTimeout(resolve,900));
   });
   await page.reload({waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>window.__LAW_OFFICE_APP__?.office&&!window.__LAW_OFFICE_APP__.booting,null,{timeout:90000});
   const state=await page.evaluate(async()=>({keys:await caches.keys(),stale:Boolean(await caches.match(new URL('./__obsolete__.js',location.href).href)),controller:Boolean(navigator.serviceWorker.controller)}));
   assert.ok(state.keys.some(key=>key.endsWith('-e2e-update')),`new cache active: ${JSON.stringify(state.keys)}`);
   assert.equal(state.keys.includes(previousCache),false,'previous release cache removed after activation');
   assert.equal(state.keys.includes('ahmad-khudair-law-office-v0-obsolete'),false,'unrelated old release cache removed');
   assert.equal(state.stale,false,'obsolete cached content is gone');
   assert.equal(state.controller,true,'the page is controlled by the new worker');
   const after=await counts(page);
   assert.deepEqual(after,before,'application update must not change any office data');
   report.updateTest={before:previousCache,cachesAfter:state.keys,dataIntact:true,waitedForUser:true};
  }finally{
   await fs.writeFile(swPath,original); // استعادة الملف كما هو (لا تغيير في المستودع)
  }
  // استعادة عامل الإنتاج بعد اختبار نسخة e2e المؤقتة: أعِد قراءة sw.js بعد استرجاعه،
  // فعّل النسخة الأصلية صراحةً، ثم أكّد أن بقية الرحلات لا تبدأ بعامل اختبار قديم.
  await page.evaluate(async()=>{
   const registration=await navigator.serviceWorker.getRegistration();
   if(!registration)return;
   await registration.update();
   const deadline=Date.now()+60000;
   while(!registration.waiting&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,200));
   if(!registration.waiting)throw new Error('restored production worker was not discovered after the A→B test');
   const changed=new Promise(resolve=>{
    navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true});
    registration.waiting.postMessage({type:'SKIP_WAITING'});
    setTimeout(resolve,20000);
   });
   await changed;
  });
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller),null,{timeout:60000});
  await page.close();
 });

 await verify('Mobile file handling: backup export downloads a real .json file and import uses the Android file picker',async()=>{
  const page=await context.newPage();
  await boot(page);
  await page.evaluate(()=>window.__LAW_OFFICE_APP__.go('backup'));
  await page.waitForTimeout(1800);
  const pickers=await page.evaluate(()=>[...document.querySelectorAll('#main-content input[type=file]')].map(input=>({id:input.id,accept:input.getAttribute('accept'),visible:input.offsetParent!==null})));
  assert.equal(pickers.length,3,'inspect + restore-to-new + restore-in-place pickers exist');
  assert.ok(pickers.every(picker=>picker.accept==='application/json'),'pickers restrict to JSON backup files');
  assert.ok(pickers.every(picker=>picker.visible),'pickers are visible and touchable on the phone screen');
  const [download]=await Promise.all([
   page.waitForEvent('download',{timeout:60000}),
   page.evaluate(()=>document.querySelector('#do-export').click())
  ]);
  assert.ok(download.suggestedFilename().endsWith('.json'),download.suggestedFilename());
  const saved=await download.path();
  const size=(await fs.stat(saved)).size;
  assert.ok(size>1000,`exported backup looks empty: ${size} bytes`);
  const payload=JSON.parse(await fs.readFile(saved,'utf8'));
  assert.ok(payload.database||payload.tables||payload.data,'backup payload has no recognizable structure');
  assert.equal(await page.evaluate(()=>document.querySelector('.error-box')),null,'no error screen during export');
  report.mobileFileHandling={pickers:pickers.length,filename:download.suggestedFilename(),bytes:size};
  await page.close();
 });

 await verify('Performance and leaks on a phone: no unbounded heap growth, no detached DOM, no duplicate navigation entries',async()=>{
  const page=await context.newPage();
  await boot(page);
  const client=await context.newCDPSession(page);
  const heap=async()=>{await client.send('HeapProfiler.collectGarbage');return page.evaluate(()=>({used:performance.memory?.usedJSHeapSize||0,nodes:document.querySelectorAll('*').length,bodyChildren:document.body.children.length,historyDepth:history.length}))};
  const routes=['dashboard','files','clients','hearings','reports','search','actionCenter','dashboard'];
  const cycle=async(times)=>{for(let i=0;i<times;i++)for(const route of routes){await page.evaluate(r=>window.__LAW_OFFICE_APP__.go(r),route);await page.waitForTimeout(420)}};
  await cycle(1);
  const first=await heap();
  await cycle(2);
  const second=await heap();
  await cycle(3);
  const third=await heap();
  const growthMB=(second.used-first.used)/1048576;
  const laterGrowthMB=(third.used-second.used)/1048576;
  const timing=await page.evaluate(()=>{const nav=performance.getEntriesByType('navigation')[0];return {domContentLoaded:Math.round(nav.domContentLoadedEventEnd),load:Math.round(nav.loadEventEnd),transferKB:Math.round(nav.transferSize/1024),appReadyMs:window.__LAW_OFFICE_APP__?.bootMs ?? null}});
  assert.ok(Math.abs(third.nodes-second.nodes)<=Math.max(40,second.nodes*0.05),`DOM node count keeps growing: ${second.nodes} -> ${third.nodes}`);
  assert.ok(Math.abs(third.bodyChildren-second.bodyChildren)<=3,`body children keep growing: ${second.bodyChildren} -> ${third.bodyChildren}`);
  assert.ok(laterGrowthMB<12,`heap keeps growing between equal work windows: ${first.used} -> ${second.used} -> ${third.used}`);
  assert.ok(third.historyDepth-first.historyDepth<=routes.length*6+4,`navigation history entries grow unbounded: ${first.historyDepth} -> ${third.historyDepth}`);
  report.performance={timing,nodes:[first.nodes,second.nodes,third.nodes],heapMB:[first.used,second.used,third.used].map(v=>Math.round(v/1048576*10)/10),growthMB:Math.round(growthMB*10)/10,laterGrowthMB:Math.round(laterGrowthMB*10)/10,historyDepth:[first.historyDepth,second.historyDepth,third.historyDepth]};
  await page.close();
 });

 // الصفحة السابقة أُغلقت في فحص الأداء، وهذه الفحوص تحتاج جلسة هاتف جديدة
 const p=await context.newPage();
 p.on('pageerror',error=>report.errors.push(error.message));
 await boot(p);

 await verify('Command palette: Android back closes it too, without leaving the screen',async()=>{
  await p.evaluate(()=>window.__LAW_OFFICE_APP__.go('dashboard'));
  await p.waitForTimeout(1200);
  const routeBefore=await p.evaluate(()=>window.__LAW_OFFICE_APP__.route);
  await p.keyboard.press('Control+k');
  await p.waitForTimeout(900);
  assert.equal(await p.evaluate(()=>Boolean(document.querySelector('#modal-root .palette-card'))),true,'the command palette opens from the phone keyboard shortcut');
  const depthWithPalette=await p.evaluate(()=>window.__LAW_OFFICE_APP__.routeHistory?.depth ?? -1);
  assert.ok(depthWithPalette>0,'the palette is protected by a history entry');
  await p.goBack();
  await p.waitForTimeout(800);
  const afterBack=await p.evaluate(()=>({palette:Boolean(document.querySelector('#modal-root .palette-card')),route:window.__LAW_OFFICE_APP__.route}));
  assert.equal(afterBack.palette,false,'back closes the command palette (same as Esc)');
  assert.equal(afterBack.route,routeBefore,'back keeps the current screen');
  report.commandPalette={routeBefore,depthWithPalette,afterBack};
 });

 await verify('Failure recovery: a corrupted/removed application cache recovers on the next online start (data intact)',async()=>{
  const before=await counts(p);
  const removed=await p.evaluate(async()=>{const keys=await caches.keys();for(const key of keys)await caches.delete(key);return keys.length});
  assert.ok(removed>0,'there was an application cache to remove');
  // Clear conditional browser responses as well: otherwise a 304 may reuse the prior
  // module graph without exercising the Service Worker's recovery fetch path.
  const recoveryCdp=await context.newCDPSession(p);
  await recoveryCdp.send('Network.clearBrowserCache');
  await recoveryCdp.detach();
  // reload() is intentional here: goto(index.html) can be a same-URL no-op in the SPA,
  // which would skip the online boot and leave the cache-recovery assertion meaningless.
  await p.reload({waitUntil:'domcontentloaded'});
  await p.waitForFunction(()=>window.__LAW_OFFICE_APP__?.office&&!window.__LAW_OFFICE_APP__.booting,null,{timeout:90000});
  await p.evaluate(()=>{const app=window.__LAW_OFFICE_APP__;return app.go('files')});
  await p.waitForTimeout(3000);
  const healed=await p.evaluate(async()=>{
   const keys=await caches.keys(),cachesState=[];
   for(const key of keys)cachesState.push({key,entries:(await(await caches.open(key)).keys()).length});
   const controller=navigator.serviceWorker.controller;
   const active=controller?await new Promise(resolve=>{const channel=new MessageChannel();channel.port1.onmessage=event=>resolve(event.data);controller.postMessage({type:'PWA_INFO'},[channel.port2]);setTimeout(()=>resolve(null),700)}):null;
   const selected=cachesState[0]||{key:'',entries:0};
   return {keys:keys.length,entries:selected.entries,key:selected.key,caches:cachesState,activeVersion:active?.version||null,controller:controller?.scriptURL||null};
  });
  const after=await counts(p);
  assert.deepEqual(after,before,'office data is intact after losing the whole application cache');
  assert.ok(healed.entries>60,`the cache did not rebuild itself while online: ${JSON.stringify(healed)}`);
  assert.ok(healed.key.startsWith('ahmad-khudair-law-office-'),`unexpected cache name: ${healed.key}`);
  report.cacheRecovery={removed,healed,before,after};
 });

 await verify('Failure recovery: an invalid backup file is refused safely, with a clear Arabic message and no data loss',async()=>{
  await p.evaluate(()=>window.__LAW_OFFICE_APP__.go('backup'));
  await p.waitForTimeout(1800);
  const before=await counts(p);
  const pickers=await p.evaluate(()=>[...document.querySelectorAll('#main-content input[type=file]')].map(i=>i.id));
  assert.ok(pickers.includes('restore-new-file')&&pickers.includes('inspect-file'),`backup pickers missing: ${pickers}`);
  await p.setInputFiles('#inspect-file',{name:'broken.json',mimeType:'application/json',buffer:Buffer.from('{"hello":"world"}')});
  await p.waitForTimeout(1600);
  const toast=await p.evaluate(()=>document.querySelector('#toast-stack')?.textContent||'');
  const state=await p.evaluate(()=>({fatal:Boolean(document.querySelector('.error-box')),pickerReset:document.querySelector('#inspect-file').value==='',booted:Boolean(window.__LAW_OFFICE_APP__.office)}));
  const after=await counts(p);
  assert.deepEqual(after,before,'data changed after refusing an invalid backup');
  assert.equal(state.fatal,false,'a refused backup must not produce a fatal error screen');
  assert.equal(state.booted,true,'the application stays alive after a refused backup');
  assert.ok(toast.length>0,`no user-facing feedback for an invalid backup: "${toast}"`);
  assert.ok(!/Error|undefined|Network|fetch/.test(toast),`raw technical text shown to the user: "${toast.slice(0,160)}"`);
  report.invalidBackup={toast:toast.slice(0,200),pickerReset:state.pickerReset};
 });

 await verify('Mobile form with the keyboard open: the focused field and the save action are both reachable',async()=>{
  await p.evaluate(()=>window.__LAW_OFFICE_APP__.go('files'));
  await p.waitForTimeout(2200);
  await p.evaluate(()=>document.querySelector('#quick-add')?.click());
  await p.waitForSelector('#modal-root .quick-item',{timeout:20000});
  const opened=await p.evaluate(()=>{
   const item=[...document.querySelectorAll('#modal-root .quick-item')].find(b=>(b.textContent||'').includes('موكل'))||document.querySelector('#modal-root .quick-item');
   item?.click();return (item?.textContent||'').trim().slice(0,20);
  });
  await p.waitForSelector('#modal-root .modal-card form',{timeout:20000});
  await p.waitForTimeout(900);
  await p.setViewportSize({width:412,height:360}); // شاشة قصيرة = لوحة مفاتيح مفتوحة
  await p.waitForTimeout(800);
  const first=await p.evaluate(()=>{
   const card=document.querySelector('#modal-root .modal-card');
   const fields=[...card.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]),select,textarea')].filter(el=>el.offsetParent!==null);
   if(!fields.length)return {fields:0};
   const target=fields[fields.length-1];
   target.focus();
   const rect=target.getBoundingClientRect();
   return {fields:fields.length,fieldTop:Math.round(rect.top),fieldBottom:Math.round(rect.bottom),viewport:window.innerHeight,scrollable:card.scrollHeight>card.clientHeight+4,fieldType:target.type||target.tagName};
  });
  assert.ok(first.fields>0,'the form exposes fillable fields on a phone');
  assert.ok(first.fieldTop>=-2&&first.fieldBottom<=first.viewport+2,`the focused field is hidden when the keyboard opens: ${JSON.stringify(first)}`);
  assert.equal(first.scrollable,true,'a long form stays scrollable inside the card so nothing is unreachable');
  const save=await p.evaluate(()=>{
   const card=document.querySelector('#modal-root .modal-card');
   card.scrollTop=card.scrollHeight;
   const buttons=[...card.querySelectorAll('button')].filter(b=>b.offsetParent!==null);
   const saveButton=buttons.find(b=>(b.textContent||'').trim()==='حفظ')
    ||buttons.find(b=>b.type==='submit'&&!/رجوع|إغلاق|الرئيسية/.test(b.textContent||''))
    ||buttons.find(b=>b.closest('.form-actions'));
   if(!saveButton)return {found:false,candidates:buttons.map(b=>(b.textContent||'').trim().slice(0,20))};
   const rect=saveButton.getBoundingClientRect();
   return {found:true,top:Math.round(rect.top),bottom:Math.round(rect.bottom),label:(saveButton.textContent||'').trim().slice(0,24),viewport:window.innerHeight,scrollTop:card.scrollTop,scrollHeight:card.scrollHeight,clientHeight:card.clientHeight};
  });
  assert.equal(save.found,true,'the save action exists inside the phone form');
  assert.ok(save.top<save.viewport&&save.bottom>0,`the save action cannot be reached with the keyboard open: ${JSON.stringify(save)}`);
  await p.evaluate(()=>document.querySelector('#modal-root [data-close]')?.click());
  await p.setViewportSize({width:412,height:915});
  await p.waitForTimeout(700);
  assert.equal(await p.evaluate(()=>Boolean(document.querySelector('#modal-root .modal-card'))),false,'the form closes cleanly');
  report.mobileForm={opened,fields:first.fields,fieldType:first.fieldType,fieldVisible:true,scrollable:first.scrollable,save};
 });

 await verify('Arabic typography does not depend on any external font or CDN: text stays readable with every third-party request blocked',async()=>{
  const page2=await context.newPage();
  const blocked=[];
  await page2.route('**/*',route=>{const url=route.request().url();if(url.startsWith(base)||url.startsWith('blob:')||url.startsWith('data:'))return route.continue();blocked.push(new URL(url).origin);return route.abort()});
  await boot(page2);
  const typography=await page2.evaluate(()=>{
   const body=getComputedStyle(document.body);
   const heading=getComputedStyle(document.querySelector('h1,h2,.p-head h2')||document.body);
   const sample=[...document.querySelectorAll('#main-content h1,#main-content h2,#main-content p,#main-content td,.btn,button')].find(el=>el.offsetParent!==null&&(el.textContent||'').trim().length>3&&el.getBoundingClientRect().width>0);
   const rect=sample?.getBoundingClientRect();
   const arabic=document.body.textContent.match(/[\u0600-\u06FF]/g)||[];
   return {bodyFont:body.fontFamily,headingFont:heading.fontFamily,textWidth:sample?Math.round(rect.width):0,textHeight:sample?Math.round(rect.height):0,sampleText:sample?(sample.textContent||'').trim().slice(0,40):null,arabicGlyphs:arabic.length,lineHeight:body.lineHeight,fontsStatus:document.fonts?.status||'unknown'};
  });
  assert.ok(typography.arabicGlyphs>50,'Arabic text is present on the phone screen');
  assert.ok(typography.textWidth>0&&typography.textHeight>0,'Arabic text still occupies real space with fonts blocked (no invisible text)');
  assert.ok(/,-|-apple-system|system-ui|sans-serif|serif/.test(typography.bodyFont),`font stack has no local fallback: ${typography.bodyFont}`);
  assert.deepEqual(report.errors.filter(Boolean),[],'no uncaught error while third-party requests are blocked');
  report.typography={...typography,blockedOrigins:[...new Set(blocked)]};
  await page2.close();
 });
 await p.close();

 await verify('No application regression in the console during the whole phone journey',async()=>{
  assert.deepEqual(report.errors,[],report.errors.join('\n'));
  report.limitations.push(`Console errors captured: ${consoleErrors.length}`);
  report.consoleErrors=consoleErrors.slice(0,20);
 });
 await context.close();
}

// =====================================================================
// 2) واجهات سطح المكتب يجب ألا تتأثر (نفس منطق الرجوع على شاشة كبيرة)
// =====================================================================
{
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 const page=await context.newPage();
 await boot(page);
 await verify('Desktop (mouse/keyboard) is unaffected: no touch-only changes and back still exits from home',async()=>{
  const coarse=await page.evaluate(()=>matchMedia('(pointer:coarse)').matches);
  assert.equal(coarse,false,'desktop pointer must not match the coarse-pointer touch rules');
  await page.evaluate(()=>window.__LAW_OFFICE_APP__.go('files'));
  await page.waitForTimeout(1800);
  assert.equal(await page.evaluate(()=>window.__LAW_OFFICE_APP__.route),'files');
  const navBackDisabled=await page.evaluate(()=>document.querySelector('#nav-back').disabled);
  assert.equal(navBackDisabled,false,'in-app back button is enabled after navigating');
  await page.evaluate(()=>document.querySelector('#nav-back').click());
  await page.waitForTimeout(1500);
  assert.equal(await page.evaluate(()=>window.__LAW_OFFICE_APP__.route),'dashboard','in-app back returns to the previous screen');
 });
 await context.close();
}

// =====================================================================
// 3) إعادة تشغيل المتصفح/الجهاز فعليًا: ملف تعريف دائم (persistent profile)
//    يُغلق المتصفح بالكامل ثم يُعاد فتحه على نفس ملف التعريف — أقرب محاكاة
//    متاحة لإعادة تشغيل الجهاز بلا جهاز حقيقي.
// =====================================================================
{
 const profileDir=path.join(process.env.TMPDIR||'/tmp',`akl-restart-${Date.now()}`);
 const launchOptions={executablePath:await slim.executablePath(),headless:true,args:['--no-sandbox','--disable-dev-shm-usage'],...phone,locale:'ar'};
 const firstContext=await chromium.launchPersistentContext(profileDir,launchOptions);
 const firstPage=firstContext.pages()[0]||await firstContext.newPage();
 firstPage.on('pageerror',error=>report.errors.push(error.message));
 await firstPage.goto(`${base}/index.html`,{waitUntil:'domcontentloaded'});
 await firstPage.waitForFunction(()=>window.__LAW_OFFICE_APP__?.office&&!window.__LAW_OFFICE_APP__.booting,null,{timeout:90000});
 await firstPage.waitForTimeout(2500);
 const marker=`إعادة تشغيل ${Date.now()}`;
 await firstPage.evaluate(async label=>{
  const app=window.__LAW_OFFICE_APP__;
  const {uid}=await import('./js/core/id.js');
  await app.office.r.clients.put({id:uid(),fullName:label,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),version:1});
  localStorage.setItem('akl:pwa:restart-marker',label);
 },marker);
 const beforeRestart=await counts(firstPage);
 await firstContext.close(); // إغلاق المتصفح بالكامل (ليس مجرد تاب)

 const secondContext=await chromium.launchPersistentContext(profileDir,launchOptions);
 const secondPage=secondContext.pages()[0]||await secondContext.newPage();
 secondPage.on('pageerror',error=>report.errors.push(error.message));
 await verify('Full browser/device restart (persistent profile): IndexedDB, preferences and the app cache all survive',async()=>{
  await secondPage.goto(`${base}/index.html`,{waitUntil:'domcontentloaded'});
  await secondPage.waitForFunction(()=>window.__LAW_OFFICE_APP__?.office&&!window.__LAW_OFFICE_APP__.booting,null,{timeout:90000});
  await secondPage.waitForTimeout(1500);
  const afterRestart=await counts(secondPage);
  assert.deepEqual(afterRestart,beforeRestart,`stores changed across a full browser restart: ${JSON.stringify({beforeRestart,afterRestart})}`);
  assert.equal(await secondPage.evaluate(()=>localStorage.getItem('akl:pwa:restart-marker')),marker,'preferences survive a full browser restart');
  const found=await secondPage.evaluate(async label=>{
   const rows=await window.__LAW_OFFICE_APP__.office.r.clients.all();
   return rows.some(row=>row.fullName===label);
  },marker);
  assert.equal(found,true,'the record written before the restart is still readable after it');
  const cacheState=await secondPage.evaluate(async()=>{const keys=await caches.keys();if(!keys.length)return {keys:0,entries:0};const cache=await caches.open(keys[0]);return {keys:keys.length,entries:(await cache.keys()).length}});
  assert.ok(cacheState.entries>60,`the application cache did not survive the restart: ${JSON.stringify(cacheState)}`);
  report.deviceRestart={beforeRestart,afterRestart,cacheState,preferenceKept:true};
 });

 await verify('Offline right after a full restart: the app still boots with no network and keeps every record',async()=>{
  await secondContext.setOffline(true);
  const offlinePage=await secondContext.newPage();
  offlinePage.on('pageerror',error=>report.errors.push(error.message));
  const started=Date.now();
  await offlinePage.goto(`${base}/index.html`,{waitUntil:'domcontentloaded'});
  await offlinePage.waitForFunction(()=>window.__LAW_OFFICE_APP__?.office&&!window.__LAW_OFFICE_APP__.booting,null,{timeout:90000});
  const ms=Date.now()-started;
  const offlineCounts=await counts(offlinePage);
  assert.deepEqual(offlineCounts,report.deviceRestart.afterRestart,'records are intact when the first start after a device restart has no network');
  await offlinePage.evaluate(()=>window.__LAW_OFFICE_APP__.go('files'));
  await offlinePage.waitForTimeout(2200);
  assert.equal(await offlinePage.evaluate(()=>Boolean(document.querySelector('.dg'))),true,'the DataGrid opens offline right after a restart');
  report.offlineAfterRestart={ms,offlineCounts};
  await offlinePage.close();
 });
 await secondContext.close();
 await fs.rm(profileDir,{recursive:true,force:true}).catch(()=>{});
}

await browser.close();
await fs.writeFile(path.join(artifactDir,'report.json'),JSON.stringify(report,null,2));
console.log(`\n${report.checks.length} checks verified — report: .cache/android-pwa/report.json`);
