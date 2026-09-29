import './harness.mjs';
globalThis.window.scrollTo = globalThis.window.scrollTo || (()=>{});
globalThis.scrollTo = globalThis.window.scrollTo;
import fs from 'node:fs';
// linkedom: إتاحة أصناف العناصر التي تستخدمها بعض الوحدات في instanceof
for (const k of ['HTMLInputElement','HTMLSelectElement','HTMLTextAreaElement','HTMLAnchorElement','HTMLButtonElement','SVGElement','DocumentFragment','NodeList','Storage','HTMLFormElement','HTMLTableElement']) {
  try { if (!(k in globalThis) && globalThis.window?.[k]) globalThis[k] = globalThis.window[k]; } catch {}
}
const html = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script type="module"'));
document.body.innerHTML = body;
const {NAV_ROUTES} = await import('../../js/ui/nav-model.js');
const errs = [];
process.on('uncaughtException', e => errs.push('uncaught: ' + (e?.message || e)));
await import('../../js/app.js');
const app = globalThis.window.__LAW_OFFICE_APP__;
await new Promise(r => setTimeout(r, 4000));
const bar = document.querySelector('#sidebar');
const routes = [...bar.querySelectorAll('[data-route]')].map(b => b.dataset.route);
const missing = NAV_ROUTES.filter(r => !routes.includes(r));
console.log('--- smoke ---');
console.log('bar class:', bar.className, '| data-nav:', bar.getAttribute('data-nav'));
console.log('tabs:', [...bar.querySelectorAll('.tn-tab[data-tab]')].map(t => t.dataset.tab).join(','));
console.log('panels:', [...bar.querySelectorAll('.tn-panel')].map(p => p.id).join(','));
console.log('routes reachable:', routes.length, '| missing:', JSON.stringify(missing));
console.log('active tab:', [...bar.querySelectorAll('.tn-tab.active')].map(t => t.dataset.tab).join(','));
console.log('page title:', document.querySelector('#page-title')?.textContent);
console.log('main content length:', document.querySelector('#main-content')?.innerHTML.length);
console.log('db badge:', document.querySelector('#db-badge')?.textContent, '| nav db:', document.querySelector('#sb-db-name')?.textContent);
console.log('--app booted:', !!app, '| route:', app?.route);
console.log('errors:', JSON.stringify(errs.slice(0, 5)));
// التنقل عبر الشريط كما يفعل المستخدم: افتح تبويب «البيانات» ثم اضغط «الملفات»
bar.querySelector('.tn-tab[data-tab="data"]').click();
await new Promise(r => setTimeout(r, 50));
console.log('panel data open:', document.querySelector('#tn-panel-data').hidden === false);
bar.querySelector('#tn-panel-data .tn-item[data-route="files"]').click();
await new Promise(r => setTimeout(r, 800));
console.log('after click -> route:', app?.route, '| title:', document.querySelector('#page-title')?.textContent, '| panel closed:', document.querySelector('#tn-panel-data').hidden);
console.log('active tab now:', [...bar.querySelectorAll('.tn-tab.active')].map(t => t.dataset.tab).join(','));
console.log('errors:', JSON.stringify(errs.slice(0, 5)));
process.exit(0);
