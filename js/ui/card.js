// =====================================================================
// نظام البطاقات الموحّد (Card System) — v5.0
// =====================================================================
// طبقة واحدة لكل البطاقات في التطبيق: الرئيسية، صفحة الملف، صفحة الموكل،
// الجلسات، الأعمال الإدارية، الأحكام، العلاقات، الإعلانات، التقارير…
//
// البناء البصري: العنوان ← المعلومة الأساسية ← التفاصيل ← الإجراءات.
// الأحجام: sm (معلومة سريعة) • md (تشغيلية) • lg (تفاصيل) • full (عرض كامل).
// الحالات: loading / empty / error / success.
// الفتح والطي يُحفظ في تفضيلات المستخدم (مفتاح 'ui:cards').
import {esc} from './dom.js';
import {icon} from './icons.js';
import {prefs} from '../core/preferences.js';

const PREF_KEY='ui:cards';

/** حجم افتراضي منطقي لكل سياق استخدام — يحمي من «بطاقة ضخمة لمعلومة بسيطة». */
export const CARD_SIZE={sm:'ux-card--sm',md:'ux-card--md',lg:'ux-card--lg',full:'ux-card--full'};

/**
 * بناء بطاقة موحدة.
 * opts: {title, icon, badge (html), actions (html), body (html), footer (html),
 *        size: 'sm'|'md'|'lg'|'full', tone: ''|'warn'|'danger'|'ok',
 *        collapsible: bool, persistKey: string, collapsed: bool, id, cls, dense}
 */
export function card(o={}){
 const size=CARD_SIZE[o.size]||CARD_SIZE.md;
 const parts=['ux-card',size];
 if(o.tone)parts.push(`ux-card--${o.tone}`);
 if(o.dense)parts.push('ux-card--dense');
 if(o.cls)parts.push(o.cls);
 const collapseId=o.persistKey||o.id||'';
 const persisted=o.collapsible&&collapseId?prefs.get(PREF_KEY,{})?.[collapseId]:null;
 const collapsed=o.collapsible&&(persisted??Boolean(o.collapsed));
 if(collapsed)parts.push('is-collapsed');
 const head=`<header class="ux-card-head"${o.collapsible?` data-card-head="${esc(collapseId)}"`:''}>
  <div class="ux-card-title">${o.icon?`<span class="ux-card-ic" aria-hidden="true">${o.icon.startsWith('<')?o.icon:icon(o.icon)}</span>`:''}<h3>${esc(o.title||'')}</h3>${o.badge?`<span class="ux-card-badge">${o.badge}</span>`:''}</div>
  ${o.actions?`<div class="ux-card-actions">${o.actions}</div>`:''}
  ${o.collapsible?`<button type="button" class="ux-card-toggle" aria-expanded="${!collapsed}" aria-label="${collapsed?'توسيع':'طي'} البطاقة: ${esc(o.title||'')}">${icon('chevron')}</button>`:''}
 </header>`;
 return `<section class="${parts.join(' ')}"${o.id?` id="${esc(o.id)}"`:''}${collapseId&&o.collapsible?` data-card-key="${esc(collapseId)}"`:''}>
  ${head}<div class="ux-card-body">${o.body??''}</div>${o.footer?`<footer class="ux-card-foot">${o.footer}</footer>`:''}</section>`;
}

/** حالة تحميل داخل بطاقة (هيكل عظمي). */
export function cardLoading({lines=3,withHeader=true}={}){
 return `<div class="ux-state ux-state-loading" role="status" aria-label="جارٍ التحميل">${withHeader?'<div class="skel skel-line w40"></div>':''}${Array.from({length:lines},(_,i)=>`<div class="skel skel-line ${i%2?'w70':'w90'}"></div>`).join('')}</div>`;
}
/** حالة فراغ: رسالة واضحة + إجراء اختياري بدل مساحة ميتة. */
export function cardEmpty(msg,{icon:ic='folder',action=''}={}){
 return `<div class="ux-state ux-state-empty"><span class="ux-state-ic" aria-hidden="true">${icon(ic)}</span><p>${esc(msg)}</p>${action?`<div class="ux-state-action">${action}</div>`:''}</div>`;
}
/** حالة خطأ مع زر إعادة محاولة اختياري. */
export function cardError(msg,{retryAttr='data-card-retry'}={}){
 return `<div class="ux-state ux-state-error" role="alert"><span class="ux-state-ic" aria-hidden="true">${icon('shield')}</span><p>${esc(msg)}</p><button type="button" class="ghost small" ${retryAttr}>إعادة المحاولة</button></div>`;
}
/** حالة نجاح قصيرة (بعد عملية). */
export function cardSuccess(msg){
 return `<div class="ux-state ux-state-success" role="status"><span class="ux-state-ic" aria-hidden="true">${icon('check')}</span><p>${esc(msg)}</p></div>`;
}

/** زر إجراء موحّد داخل البطاقات — نفس الشكل والمكان في كل التطبيق. */
export function cardAction(label,{kind='ghost',icon:ic='',attr=''}={}){
 return `<button type="button" class="${kind==='primary'?'primary':kind==='danger'?'ghost danger-btn':'ghost'} small" ${attr}>${ic?icon(ic)+' ':''}${esc(label)}</button>`;
}

/** قائمة إجراءات موحدة (⋯) لتقليل عدد الأزرار الظاهرة في البطاقة. */
export function cardMenu(items,{attr='data-card-menu'}={}){
 return `<div class="ux-menu-wrap"><button type="button" class="ghost small icon-only" ${attr} aria-haspopup="menu" aria-label="إجراءات إضافية">${icon('dots')}</button>
  <div class="ux-menu" role="menu" hidden>${items.map(it=>`<button type="button" role="menuitem" class="ux-menu-item${it.danger?' is-danger':''}" ${it.attr||''}>${it.icon?icon(it.icon)+' ':''}${esc(it.label)}</button>`).join('')}</div></div>`;
}

/** شارة حالة موحدة (نشط/منتهٍ/عاجل…) — بديل متسق عن .badge القديمة داخل البطاقات. */
export function statusBadge(text,tone=''){
 return `<span class="ux-badge${tone?` ux-badge--${tone}`:''}">${esc(text)}</span>`;
}
/** تسلسل معلومة: عنوان صغير ثم القيمة ثم سطر فرعي. html اختياري للقيمة المنسّقة. */
export function infoStack(rows=[]){
 return `<div class="info-stack">${rows.filter(Boolean).map(r=>`<div class="info-row${r.tone?` is-${esc(r.tone)}`:''}"><span class="info-k">${esc(r.k||'')}</span><strong class="info-v">${r.html||esc(r.v||'—')}</strong>${r.sub?`<small class="info-s">${esc(r.sub)}</small>`:''}</div>`).join('')}</div>`;
}
export function detailsBlock(summary,html,{open=false}={}){
 return `<details class="ux-details"${open?' open':''}><summary>${esc(summary)}</summary><div class="ux-details-body">${html}</div></details>`;
}

/** تفعيل فتح/طي البطاقات + قوائم الإجراءات داخل جذر معيّن. */
export function bindCards(root=document){
 root.querySelectorAll('.ux-card-toggle').forEach(btn=>{
  if(btn.dataset.bound)return;btn.dataset.bound='1';
  btn.addEventListener('click',()=>{
   const cardEl=btn.closest('.ux-card');const key=cardEl?.dataset.cardKey||'';
   const next=!cardEl.classList.contains('is-collapsed');
   cardEl.classList.toggle('is-collapsed',next);
   btn.setAttribute('aria-expanded',String(!next));
   if(key){const state=prefs.get(PREF_KEY,{})||{};if(next)state[key]=true;else delete state[key];prefs.set(PREF_KEY,state)}
  });
 });
 // النقر على عنوان بطاقة قابلة للطي يفتحها/يطويها أيضًا
 root.querySelectorAll('.ux-card-head[data-card-head]').forEach(head=>{
  if(head.dataset.bound)return;head.dataset.bound='1';
  head.addEventListener('click',e=>{
   if(e.target.closest('button,a,input,select,textarea'))return;
   head.querySelector('.ux-card-toggle')?.click();
  });
 });
 // قوائم الإجراءات: فتح/إغلاق + إغلاق عند النقر خارجها
 root.querySelectorAll('[data-card-menu]').forEach(btn=>{
  if(btn.dataset.bound)return;btn.dataset.bound='1';
  const menu=btn.nextElementSibling;
  btn.addEventListener('click',e=>{e.stopPropagation();const open=menu.hidden;root.querySelectorAll('.ux-menu:not([hidden])').forEach(m=>{if(m!==menu)m.hidden=true});menu.hidden=!open;if(open)menu.querySelector('.ux-menu-item')?.focus()});
  menu.addEventListener('click',()=>{menu.hidden=true});
 });
}
const onOutside=e=>{if(!e.target.closest('.ux-menu-wrap'))document.querySelectorAll('.ux-menu:not([hidden])').forEach(m=>m.hidden=true)};
document.addEventListener('click',onOutside);
document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelectorAll('.ux-menu:not([hidden])').forEach(m=>m.hidden=true)});
