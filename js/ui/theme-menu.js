// قائمة سريعة في الهيدر للتبديل بين الثيمات دون مغادرة الصفحة.
import {PRESETS,getConfig,setTheme,customThemes,applyCustomTheme} from './theme.js';
import {esc} from './dom.js';
export const swatch=c=>`<span class="swatch" aria-hidden="true"><i style="background:${c.bg}"></i><i style="background:${c.surface}"></i><i style="background:${c.primary}"></i></span>`;
export function bindThemeMenu(app){
 const btn=document.querySelector('#theme-btn');if(!btn)return;
 let menu=null;
 const close=()=>{menu?.remove();menu=null;btn.setAttribute('aria-expanded','false');document.removeEventListener('mousedown',outside,true)};
 const outside=e=>{if(menu&&!menu.contains(e.target)&&!btn.contains(e.target))close()};
 btn.addEventListener('click',()=>{
  if(menu)return close();
  const cfg=getConfig();
  menu=document.createElement('div');menu.className='theme-menu';menu.setAttribute('role','menu');
  menu.innerHTML=Object.entries(PRESETS).map(([k,p])=>`<button role="menuitemradio" aria-checked="${!cfg.customId&&cfg.preset===k}" class="${!cfg.customId&&cfg.preset===k?'on':''}" data-preset="${k}">${swatch(p.c)}<span><b>${esc(p.ar)}</b><br><small class="muted">${esc(p.name)}</small></span></button>`).join('')
   +(customThemes().length?'<hr>'+customThemes().map(t=>`<button role="menuitemradio" class="${cfg.customId===t.id?'on':''}" data-custom="${esc(t.id)}">${swatch({...PRESETS[t.config.preset]?.c,...t.config.colors})}<span><b>${esc(t.name)}</b><br><small class="muted">ثيم مخصص</small></span></button>`).join(''):'')
   +'<hr><button data-open-settings>🎨 <span>تخصيص المظهر…</span></button>';
  document.body.append(menu);
  const r=btn.getBoundingClientRect();const w=menu.offsetWidth;
  menu.style.top=(r.bottom+6)+'px';menu.style.left=Math.max(8,Math.min(r.left,innerWidth-w-8))+'px';
  btn.setAttribute('aria-expanded','true');
  setTimeout(()=>document.addEventListener('mousedown',outside,true),0);
  menu.addEventListener('click',e=>{
   const b=e.target.closest('button');if(!b)return;
   if(b.dataset.preset)setTheme({preset:b.dataset.preset,colors:{},customId:null});
   else if(b.dataset.custom)applyCustomTheme(b.dataset.custom);
   else if(b.hasAttribute('data-open-settings')){app.__settingsTab='appearance';app.go('settings')}
   close();
  });
  menu.addEventListener('keydown',e=>{if(e.key==='Escape'){close();btn.focus()}});
  menu.querySelector('button.on,button')?.focus();
 });
}
