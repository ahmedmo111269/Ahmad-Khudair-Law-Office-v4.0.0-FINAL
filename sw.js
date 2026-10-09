// =====================================================================
// Service Worker — قشرة التطبيق الكاملة للعمل دون اتصال (Android/PWA)
// ---------------------------------------------------------------------
// الاستراتيجية (وليست "خزّن كل شيء للأبد"):
//   1) قشرة التطبيق والملفات الثابتة: تُخزَّن كلها مسبقًا (Precache) في كاش
//      واحد مُرقَّم بإصدار، وتُخدَم من الكاش فورًا — بلا انتظار شبكة ولا
//      مهلة 2.5 ثانية لكل ملف كما كان سابقًا. التحديث يحدث بترقية رقم
//      الإصدار أدناه، فيُستبدل الكاش كاملًا مرة واحدة (بلا خليط نسخ).
//   2) طلب تنقّل غير مخزَّن (رابط مباشر/تحديث الصفحة): شبكة، ثم القشرة.
//   3) ملفات التطبيق غير المخزَّنة مسبقًا: شبكة ثم كاش (Runtime).
//   4) أي شيء آخر — صور المعاينة، الطلبات المشفّرة، النطاقات الخارجية،
//      طلبات Range (تنزيل/طباعة) — لا يُعترض ولا يُخزَّن إطلاقًا.
//   5) بيانات المكتب (IndexedDB) لا تدخل Cache Storage أبدًا — فصل تام بين
//      كاش التطبيق وبيانات المستخدم.
// الترقية الآمنة: التثبيت الأول يستلم السيطرة فورًا (جهاز جديد = Offline من
// أول استخدام). أما التحديث فوق نسخة قائمة فلا يستولي على جلسة مفتوحة؛
// يُرقّى بأمر صريح من التطبيق (SKIP_WAITING) عند قبول المستخدم أو عند
// الإقلاع التالي — منعًا لتبديل الكود تحت يدي المستخدم أثناء العمل.
// =====================================================================
const CACHE='ahmad-khudair-law-office-v6.2.1-wave7-p1-not-now';
const CACHE_PREFIX='ahmad-khudair-law-office-';
const SHELL='./index.html';
const RUNTIME_TIMEOUT_MS=6000;
// الملفات التي تُخزَّن مسبقًا. تفشُل الملفات الفردية وحدها دون إسقاط التثبيت
// كله (ملف ناقص واحد لا يجب أن يُبطل العمل دون اتصال).
const ASSETS=[
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/app.css",
  "./css/base.css",
  "./css/cards.css",
  "./css/client-file.css",
  "./css/components.css",
  "./css/layout.css",
  "./css/luxe.css",
  "./css/pro.css",
  "./css/service-records.css",
  "./css/sidebar.css",
  "./css/workbench.css",
  "./css/display.css",
  "./css/component-style.css",
  "./css/work-center.css",
  "./css/execution.css",
  "./css/exec-workcenter.css",
  "./css/sync.css",
  "./css/quick-notes.css",
  "./css/topnav.css",
  "./css/topbar.css",
  "./css/cockpit.css",
  "./css/mobile-pwa.css",
  "./icons/app-icon.svg",
  "./css/themes.css",
  "./css/ui.css",
  "./js/app.js",
  "./js/services/focus-engine.js",
  "./js/services/home-visit.js",
  "./js/ui/cockpit.js",
  "./js/services/client-workspace.js",
  "./js/core/clock.js",
  "./js/core/constants.js",
  "./js/core/feature-flags.js",
  "./js/ui/loading.js",
  "./js/ui/status.js",
  "./js/core/errors.js",
  "./js/core/events.js",
  "./js/core/file-number.js",
  "./js/core/format.js",
  "./js/core/display-prefs.js",
  "./js/core/component-style.js",
  "./js/core/grid-query.js",
  "./js/core/grid-print-context.js",
  "./js/core/id.js",
  "./js/core/device-id.js",
  "./js/core/network-status.js",
  "./js/core/online-capabilities.js",
  "./js/core/preferences.js",
  "./js/core/search-normalizer.js",
  "./js/core/store.js",
  "./js/db/database-context.js",
  "./js/db/database-manager.js",
  "./js/db/database-registry.js",
  "./js/db/health.js",
  "./js/db/grid-data-provider.js",
  "./js/db/quota.js",
  "./js/db/repository.js",
  "./js/db/schema.js",
  "./js/db/unit-of-work.js",
  "./js/domain/entities.js",
  "./js/domain/execution.js",
  "./js/domain/execution-calendar.js",
  "./js/domain/execution-period-calendar.js",
  "./js/domain/execution-money.js",
  "./js/domain/execution-feas.js",
  "./js/domain/execution-schedule.js",
  "./js/domain/entitlement-engine.js",
  "./js/domain/work-items.js",
  "./js/domain/work-sources.js",
  "./js/domain/lookup-defaults.js",
  "./js/domain/normalizers.js",
  "./js/domain/policies.js",
  "./js/domain/taxonomy-defaults.js",
  "./js/domain/validators.js",
  "./js/modules/work-center.js",
  "./js/modules/analytics.js",
  "./js/modules/appearance.js",
  "./js/modules/client-file.js",
  "./js/modules/databases.js",
  "./js/modules/sync.js",
  "./js/modules/file-page.js",
  "./js/modules/home.js",
  "./js/modules/integrity.js",
  "./js/modules/list-page.js",
  "./js/modules/quick-add.js",
  "./js/modules/quick-notes.js",
  "./js/modules/reminders.js",
  "./js/modules/procedures-extras.js",
  "./js/modules/record-page.js",
  "./js/modules/repair.js",
  "./js/modules/reports.js",
  "./js/modules/search.js",
  "./js/modules/service-records.js",
  "./js/modules/execution-center.js",
  "./js/modules/settings.js",
  "./js/modules/taxonomy-editor.js",
  "./js/services/work-config.js",
  "./js/services/work-hides.js",
  "./js/services/my-day.js",
  "./js/services/tomorrow-prep.js",
  "./js/services/work-insights.js",
  "./js/services/work-items.js",
  "./js/services/work-query.js",
  "./js/services/work-statuses.js",
  "./js/services/analytics.js",
  "./js/services/backup.js",
  "./js/services/client-files.js",
  "./js/services/client-duplicates.js",
  "./js/services/consistency.js",
  "./js/services/dashboard.js",
  "./js/services/demo-seed.js",
  "./js/services/demo-data.js",
  "./js/services/favorites.js",
  "./js/ui/demo-cleanup.js",
  "./js/services/entity-query.js",
  "./js/services/grid-relations.js",
  "./js/services/entity-save.js",
  "./js/services/finance.js",
  "./js/services/generic.js",
  "./js/services/integrity.js",
  "./js/services/judicial.js",
  "./js/services/legal-files.js",
  "./js/services/lifecycle.js",
  "./js/services/execution.js",
  "./js/services/execution-feas.js",
  "./js/services/execution-ledger.js",
  "./js/services/execution-differences.js",
  "./js/services/execution-poa.js",
  "./js/services/execution-demo.js",
  "./js/services/execution-balance.js",
  "./js/services/execution-print.js",
  "./js/services/execution-migration.js",
  "./js/services/execution-period-migration.js",
  "./js/services/execution-simple.js",
  "./js/services/execution-work.js",
  "./js/services/execution-settings.js",
  "./js/services/execution-cache.js",
  "./js/services/data-admin.js",
  "./js/services/print-paginate.js",
  "./js/services/lookups.js",
  "./js/services/maintenance.js",
  "./js/services/index-audit.js",
  "./js/services/performance.js",
  "./js/services/office.js",
  "./js/services/operations.js",
  "./js/services/pwa-updates.js",
  "./js/services/sync-engine.js",
  "./js/services/sync-transport.js",
  "./js/services/sync-crypto.js",
  "./js/services/recents.js",
  "./js/services/repair.js",
  "./js/services/search.js",
  "./js/services/search-engine.js",
  "./js/services/quick-notes.js",
  "./js/services/service-records.js",
  "./js/services/timeline.js",
  "./js/ui/sidebar.js",
  "./js/ui/nav-model.js",
  "./js/ui/nav-customize.js",
  "./js/ui/topnav.js",
  "./js/ui/signals.js",
  "./js/ui/calendar.js",
  "./js/ui/card.js",
  "./js/ui/work-actions.js",
  "./js/ui/work-badge.js",
  "./js/ui/work-card.js",
  "./js/ui/work-drawer.js",
  "./js/ui/work-grid.js",
  "./js/ui/work-links.js",
  "./js/ui/work-panels.js",
  "./js/ui/work-views.js",
  "./js/ui/card-display.js",
  "./js/ui/collapsible.js",
  "./js/ui/collapse-state.js",
  "./js/ui/component-customizer.js",
  "./js/ui/page-layout.js",
  "./js/ui/combobox.js",
  "./js/ui/datagrid.js",
  "./js/ui/grid-columns.js",
  "./js/ui/grid-data-provider.js",
  "./js/ui/date-input.js",
  "./js/ui/dom.js",
  "./js/ui/form.js",
  "./js/ui/record-preview.js",
  "./js/ui/execution-work-view.js",
  "./js/ui/execution-forms.js",
  "./js/ui/execution-simple-forms.js",
  "./js/ui/execution-horizon-picker.js",
  "./js/ui/execution-summary-card.js",
  "./js/ui/icons.js",
  "./js/ui/install-prompt.js",
  "./js/ui/overlay-stack.js",
  "./js/core/history-nav.js",
  "./js/ui/lookup.js",
  "./js/ui/modal.js",
  "./js/ui/pagination.js",
  "./js/ui/palette.js",
  "./js/ui/theme-menu.js",
  "./js/ui/theme.js",
  "./js/ui/toast.js",
  "./js/modules/timeline-view.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-192.png",
  "./icons/maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./js/db/write-epoch.js",
  "./js/db/write-broadcast.js",
  "./js/services/search-cache.js",
  "./js/services/search-shape.js",
  "./js/core/storage-persistence.js",
  "./js/services/pwa-install.js",
];
const PRECACHE=new Set(ASSETS);
const APP_ASSET=/\.(?:js|mjs|css|svg|png|webmanifest|html|json)$/i;

async function precacheAll(){
 const cache=await caches.open(CACHE);
 const results=await Promise.allSettled(ASSETS.map(asset=>cache.add(new Request(asset,{cache:'reload'}))));
 const failed=ASSETS.filter((asset,index)=>results[index].status==='rejected');
 if(failed.length)console.warn('[SW] تعذّر تخزين بعض الملفات مسبقًا:',failed);
 return {total:ASSETS.length,cached:ASSETS.length-failed.length,failed};
}

self.addEventListener('install',event=>{
 event.waitUntil((async()=>{
  await precacheAll();
  // تثبيت أول على الجهاز: بلا نسخة نشطة سابقة، فالاستيلاء الفوري آمن ويجعل
  // أول جلسة قادرة على العمل دون اتصال. أما التحديث فوق نسخة قائمة فينتظر.
  if(!self.registration.active)await self.skipWaiting();
 })());
});

self.addEventListener('activate',event=>{
 event.waitUntil((async()=>{
  const keys=await caches.keys();
  await Promise.all(keys.filter(key=>key!==CACHE&&key.startsWith(CACHE_PREFIX)).map(key=>caches.delete(key)));
  await self.clients.claim();
 })());
});

self.addEventListener('message',event=>{
 const data=event.data||{};
 if(data.type==='SKIP_WAITING'){self.skipWaiting();return}
 if(data.type==='PWA_INFO'&&event.ports&&event.ports[0])event.ports[0].postMessage({version:CACHE,assets:ASSETS.length});
});

function sameScope(url){
 try{return url.href.startsWith(self.registration.scope)}catch{return url.origin===self.location.origin}
}

async function navigationResponse(request){
 const cache=await caches.open(CACHE);
 const exact=await cache.match(request,{ignoreSearch:true});
 if(exact)return exact;
 const shell=await cache.match(SHELL,{ignoreSearch:true});
 if(shell)return shell;
 try{
  const response=await fetch(request);
  if(response&&response.ok&&response.type==='basic')cache.put(request,response.clone());
  return response;
 }catch{
  return shell||Response.error();
 }
}

async function assetResponse(request){
 const cache=await caches.open(CACHE);
 const hit=await cache.match(request,{ignoreSearch:true});
 if(hit)return hit;
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),RUNTIME_TIMEOUT_MS);
 try{
  const response=await fetch(request,{signal:controller.signal});
  if(response&&response.ok&&response.type==='basic')cache.put(request,response.clone());
  return response;
 }catch{
  return (await cache.match(request,{ignoreSearch:true}))||Response.error();
 }finally{clearTimeout(timer)}
}

self.addEventListener('fetch',event=>{
 const request=event.request;
 if(request.method!=='GET')return;
 if(request.headers.get('range'))return; // تنزيل نسخة احتياطية/طباعة: تمرير مباشر
 const url=new URL(request.url);
 if(url.origin!==self.location.origin||!sameScope(url))return;
 if(request.mode==='navigate'){event.respondWith(navigationResponse(request));return}
 if(url.search||url.pathname.includes('/api/')||!APP_ASSET.test(url.pathname))return;
 event.respondWith(assetResponse(request));
});
