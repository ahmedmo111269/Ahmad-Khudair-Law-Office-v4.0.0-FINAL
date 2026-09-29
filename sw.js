// Cache-first install of the complete local ES-module graph, followed by network-first updates.
// Pre-caching only js/app.js is insufficient: the browser fetches its imports as separate requests,
// so an offline reload immediately after installation otherwise fails before boot.
const CACHE='ahmad-khudair-law-office-v4.7.0-offline1';
const ASSETS=[
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/app.css",
  "./css/base.css",
  "./css/client-file.css",
  "./css/components.css",
  "./css/layout.css",
  "./css/luxe.css",
  "./css/pro.css",
  "./css/service-records.css",
  "./css/themes.css",
  "./css/ui.css",
  "./js/app.js",
  "./js/core/clock.js",
  "./js/core/constants.js",
  "./js/core/errors.js",
  "./js/core/events.js",
  "./js/core/format.js",
  "./js/core/id.js",
  "./js/core/preferences.js",
  "./js/core/search-normalizer.js",
  "./js/core/store.js",
  "./js/db/database-context.js",
  "./js/db/database-manager.js",
  "./js/db/database-registry.js",
  "./js/db/health.js",
  "./js/db/quota.js",
  "./js/db/repository.js",
  "./js/db/schema.js",
  "./js/db/unit-of-work.js",
  "./js/domain/entities.js",
  "./js/domain/lookup-defaults.js",
  "./js/domain/normalizers.js",
  "./js/domain/policies.js",
  "./js/domain/taxonomy-defaults.js",
  "./js/domain/validators.js",
  "./js/modules/action-center.js",
  "./js/modules/analytics.js",
  "./js/modules/appearance.js",
  "./js/modules/client-file.js",
  "./js/modules/databases.js",
  "./js/modules/file-page.js",
  "./js/modules/home.js",
  "./js/modules/integrity.js",
  "./js/modules/list-page.js",
  "./js/modules/quick-add.js",
  "./js/modules/record-page.js",
  "./js/modules/repair.js",
  "./js/modules/reports.js",
  "./js/modules/search.js",
  "./js/modules/service-records.js",
  "./js/modules/settings.js",
  "./js/modules/taxonomy-editor.js",
  "./js/services/action-center.js",
  "./js/services/analytics.js",
  "./js/services/backup.js",
  "./js/services/client-files.js",
  "./js/services/consistency.js",
  "./js/services/dashboard.js",
  "./js/services/entity-query.js",
  "./js/services/entity-save.js",
  "./js/services/finance.js",
  "./js/services/generic.js",
  "./js/services/integrity.js",
  "./js/services/judicial.js",
  "./js/services/legal-files.js",
  "./js/services/lifecycle.js",
  "./js/services/lookups.js",
  "./js/services/maintenance.js",
  "./js/services/office.js",
  "./js/services/operations.js",
  "./js/services/recents.js",
  "./js/services/repair.js",
  "./js/services/search.js",
  "./js/services/search-engine.js",
  "./js/services/service-records.js",
  "./js/ui/calendar.js",
  "./js/ui/collapsible.js",
  "./js/ui/combobox.js",
  "./js/ui/datagrid.js",
  "./js/ui/date-input.js",
  "./js/ui/dom.js",
  "./js/ui/form.js",
  "./js/ui/icons.js",
  "./js/ui/lookup.js",
  "./js/ui/modal.js",
  "./js/ui/pagination.js",
  "./js/ui/palette.js",
  "./js/ui/theme-menu.js",
  "./js/ui/theme.js",
  "./js/ui/toast.js",
  "./js/modules/timeline-view.js",
];
self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',e=>{
  const req=e.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(url.origin!==self.location.origin)return;
  e.respondWith((async()=>{
    try{
      const res=await fetch(req);
      if(res&&res.ok&&res.type==='basic'){
        const cache=await caches.open(CACHE);
        await cache.put(req,res.clone());
      }
      return res;
    }catch{
      return (await caches.match(req))||(req.mode==='navigate'?await caches.match('./index.html'):Response.error());
    }
  })());
});
