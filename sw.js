// Cache-first install of the complete local ES-module graph, followed by network-first updates.
// Pre-caching only js/app.js is insufficient: the browser fetches its imports as separate requests,
// so an offline reload immediately after installation otherwise fails before boot.
const CACHE='ahmad-khudair-law-office-v5.9.0-sync-secure';
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
  "./css/sync.css",
  "./css/topnav.css",
  "./icons/app-icon.svg",
  "./css/themes.css",
  "./css/ui.css",
  "./js/app.js",
  "./js/core/clock.js",
  "./js/core/constants.js",
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
  "./js/modules/record-page.js",
  "./js/modules/repair.js",
  "./js/modules/reports.js",
  "./js/modules/search.js",
  "./js/modules/service-records.js",
  "./js/modules/execution-center.js",
  "./js/modules/settings.js",
  "./js/modules/taxonomy-editor.js",
  "./js/services/work-config.js",
  "./js/services/work-insights.js",
  "./js/services/work-items.js",
  "./js/services/work-query.js",
  "./js/services/work-statuses.js",
  "./js/services/analytics.js",
  "./js/services/backup.js",
  "./js/services/client-files.js",
  "./js/services/consistency.js",
  "./js/services/dashboard.js",
  "./js/services/demo-seed.js",
  "./js/services/favorites.js",
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
  "./js/services/execution-ledger.js",
  "./js/services/execution-differences.js",
  "./js/services/execution-poa.js",
  "./js/services/execution-balance.js",
  "./js/services/execution-print.js",
  "./js/services/execution-migration.js",
  "./js/services/lookups.js",
  "./js/services/maintenance.js",
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
  "./js/ui/execution-forms.js",
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
const NETWORK_TIMEOUT_MS=2500;
function isApplicationAsset(url){
  if(url.pathname.endsWith('/api')||url.pathname.includes('/api/'))return false;
  if(url.search)return false;
  return url.pathname==='/'||url.pathname.endsWith('/index.html')||/\.(?:html|js|mjs|css|svg|png|webmanifest)$/.test(url.pathname);
}
self.addEventListener('fetch',e=>{
  const req=e.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(url.origin!==self.location.origin||!isApplicationAsset(url))return;
  e.respondWith((async()=>{
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),NETWORK_TIMEOUT_MS);
    try{
      const res=await fetch(req,{signal:controller.signal});
      if(res&&res.ok&&res.type==='basic'){
        const cache=await caches.open(CACHE);
        await cache.put(req,res.clone());
      }
      return res;
    }catch{
      const cached=await caches.match(req,{ignoreSearch:true});
      if(cached)return cached;
      if(req.mode==='navigate')return (await caches.match('./index.html'))||Response.error();
      return Response.error();
    }finally{clearTimeout(timeout)}
  })());
});
