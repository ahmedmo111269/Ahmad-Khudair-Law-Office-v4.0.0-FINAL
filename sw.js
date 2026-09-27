// Network-first service worker: always serve the latest deployed files when online,
// fall back to the cache when offline. (The previous cache-first strategy kept serving
// stale JavaScript forever after an update.)
const CACHE='ahmad-khudair-law-office-v4.0.1';
const ASSETS=['./','./index.html','./manifest.webmanifest','./css/base.css','./css/layout.css','./css/components.css','./css/themes.css','./js/app.js'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  const req=e.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(url.origin!==self.location.origin)return;
  e.respondWith(fetch(req).then(res=>{
    if(res&&res.ok&&res.type==='basic'){const copy=res.clone();caches.open(CACHE).then(c=>c.put(req,copy))}
    return res;
  }).catch(async()=>(await caches.match(req))||(req.mode==='navigate'?caches.match('./index.html'):Response.error())));
});
