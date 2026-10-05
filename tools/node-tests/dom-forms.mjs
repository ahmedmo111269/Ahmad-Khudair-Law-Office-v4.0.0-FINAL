// تكملة بيئة الاختبار: linkedom لا يوفر FormData ولا بعض أصناف العناصر.
// كلها فجوات في بيئة الاختبار فقط — لا تمس كود التطبيق.
import fs from 'node:fs';

for (const k of ['HTMLInputElement', 'HTMLSelectElement', 'HTMLTextAreaElement', 'HTMLAnchorElement', 'HTMLButtonElement', 'SVGElement', 'DocumentFragment', 'NodeList', 'Storage', 'HTMLFormElement', 'HTMLTableElement']) {
  try { if (!(k in globalThis) && globalThis.window?.[k]) globalThis[k] = globalThis.window[k]; } catch {}
}
globalThis.window.scrollTo = globalThis.window.scrollTo || (() => {});
globalThis.scrollTo = globalThis.window.scrollTo;

class TestFormData {
  constructor(form) {
    this.m = new Map();
    if (!form) return;
    for (const el of form.querySelectorAll('input,select,textarea')) {
      const name = el.getAttribute('name');
      if (!name || el.hasAttribute('disabled')) continue;
      const type = (el.getAttribute('type') || '').toLowerCase();
      if ((type === 'checkbox' || type === 'radio') && !el.checked) continue;
      this.m.set(name, el.value ?? '');
    }
  }
  append(k, v) { this.m.set(k, v); }
  set(k, v) { this.m.set(k, v); }
  get(k) { return this.m.get(k) ?? null; }
  has(k) { return this.m.has(k); }
  entries() { return this.m.entries(); }
  keys() { return this.m.keys(); }
  values() { return this.m.values(); }
  [Symbol.iterator]() { return this.m.entries(); }
}
globalThis.FormData = TestFormData;
globalThis.window.FormData = TestFormData;

/** يبني جسم index.html الحقيقي حتى يُقلع التطبيق كما في المتصفح. */
export async function mountAppShell() {
  const html = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script type="module"'));
  document.body.innerHTML = body;
  await import('../../js/app.js');
  const app = globalThis.window.__LAW_OFFICE_APP__;
  for (let i = 0; i < 60 && (!app || app.booting); i += 1) await new Promise(r => setTimeout(r, 200));
  if (!app?.office) throw new Error('تعذّر إقلاع التطبيق في بيئة الاختبار');
  return app;
}
