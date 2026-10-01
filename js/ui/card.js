// =====================================================================
// نظام البطاقات الموحّد (Card System) — v5.0
// =====================================================================
// طبقة واحدة لكل البطاقات في التطبيق: الرئيسية، صفحة الملف، صفحة الموكل،
// الجلسات، الأعمال الإدارية، الأحكام، العلاقات، الإعلانات، التقارير…
//
// البناء البصري: العنوان ← المعلومة الأساسية ← التفاصيل ← الإجراءات.
// الأحجام: sm (معلومة سريعة) • md (تشغيلية) • lg (تفاصيل) • full (عرض كامل).
// الحالات: loading / empty / error / success.
// الفتح والطي يُحفظان مركزيًا لكل بطاقة في تفضيلات المستخدم (ui:collapse-state)، مع ترحيل قراءة المفتاح القديم ui:cards.
// إعدادات العرض (الخط/الكثافة/طريقة العرض) تأتي من DisplayPreferences المركزي
// بأولوية: البطاقة ← الصفحة ← العام ← الافتراضي (ui/core/display-prefs.js).
import {esc} from './dom.js';
import {icon} from './icons.js';
import {prefs} from '../core/preferences.js';
import {resolveCollapseState,saveCollapseState,isCollapsePinned} from './collapse-state.js';
import {collapsePinMarkup,bindCollapsePin,syncCollapsePin} from './collapsible.js';
import {resolveCardDisplay} from '../core/display-prefs.js';
import {cardDisplayButtonMarkup,bindCardDisplay} from './card-display.js';

const LEGACY_PREF_KEY='ui:cards';

/** حجم افتراضي منطقي لكل سياق استخدام — يحمي من «بطاقة ضخمة لمعلومة بسيطة». */
export const CARD_SIZE={sm:'ux-card--sm',md:'ux-card--md',lg:'ux-card--lg',full:'ux-card--full'};

/**
 * بناء بطاقة موحدة.
 * opts: {title, icon, badge (html), actions (html), body (html), footer (html),
 *        size: 'sm'|'md'|'lg'|'full', tone: ''|'warn'|'danger'|'ok',
 *        collapsible: false disables collapsing (enabled by default), persistKey: stable key,
 *        collapsed: explicit initial state, id, cls, dense, summary,
 *        display: false disables the per-card display settings (enabled by default),
 *        displayKey: stable key for display prefs (defaults to persistKey),
 *        pageId: page scope for the Card → Page → Global → Default override chain,
 *        sectionId: registers the card as a reorderable page section}
 */
export function card(o={}){
 const size=CARD_SIZE[o.size]||CARD_SIZE.md;
 const parts=['ux-card',size];
 if(o.tone)parts.push(`ux-card--${o.tone}`);
 if(o.dense)parts.push('ux-card--dense');
 if(o.cls)parts.push(o.cls);
 const collapsible=o.collapsible!==false;
 const collapseId=o.persistKey||o.id||`card:${String(o.title||'محتوى').trim()}`;
 const collapseKey=`card:${collapseId}`;
 const old=prefs.get(LEGACY_PREF_KEY,{})||{};
 const legacy=typeof old[collapseId]==='boolean'?old[collapseId]:undefined;
 const collapsed=collapsible?resolveCollapseState(collapseKey,{fallback:o.collapsed??true,legacy,configured:o.collapsed!==undefined}):false;
 const pinned=collapsible&&isCollapsePinned(collapseKey);
 if(collapsed)parts.push('is-collapsed');
 // إعدادات العرض الفعالة لهذه البطاقة (بطاقة ← صفحة ← عام ← افتراضي)
 const displayEnabled=o.display!==false;
 const displayKey=String(o.displayKey||collapseId);
 const pageId=String(o.pageId||'');
 const disp=displayEnabled?resolveCardDisplay(displayKey,pageId):null;
 // الهوية الثابتة في نظام التخصيص الكامل: card:<displayKey> — لا تعتمد على الموضع أو الترتيب
 const displayAttrs=disp?` data-display-key="${esc(displayKey)}" data-uxc-id="card:${esc(displayKey)}" data-uxc-type="card"${pageId?` data-page-id="${esc(pageId)}"`:''} data-cfont="${esc(disp.fontSize)}" data-cdensity="${esc(disp.density)}" data-clayout="${esc(disp.fieldLayout)}" data-csecondary="${disp.secondary?'on':'off'}" data-cborders="${disp.borders?'on':'off'}"`:'';
 const bodyId=`ux-card-body-${String(collapseId).replace(/[^\p{L}\p{N}_-]/gu,'-')}`;
 const head=`<header class="ux-card-head"${collapsible?` data-card-head="${esc(collapseId)}"`:''}>
  <div class="ux-card-title">${o.icon?`<span class="ux-card-ic" aria-hidden="true">${o.icon.startsWith('<')?o.icon:icon(o.icon)}</span>`:''}<h3>${esc(o.title||'')}</h3>${o.badge?`<span class="ux-card-badge">${o.badge}</span>`:''}${o.summary?`<span class="ux-card-summary muted small">${esc(o.summary)}</span>`:''}</div>
  ${o.actions?`<div class="ux-card-actions">${o.actions}</div>`:''}
  ${displayEnabled?cardDisplayButtonMarkup(displayKey,o.title||''):''}
  ${collapsible?`${collapsePinMarkup(collapseKey,pinned,'collapse-pin ux-card-pin')}<button type="button" class="ux-card-toggle" aria-expanded="${!collapsed}" aria-controls="${esc(bodyId)}" aria-label="${collapsed?'توسيع':'طي'} البطاقة: ${esc(o.title||'')}">${icon('chevron')}</button>`:''}
 </header>`;
 return `<section class="${parts.join(' ')}"${o.id?` id="${esc(o.id)}"`:''}${o.sectionId?` data-section-id="${esc(o.sectionId)}"`:''}${displayAttrs}${collapsible?` data-card-key="${esc(collapseId)}" data-collapse-key="${esc(collapseKey)}" data-collapse-type="card" data-collapse-ready="true" data-collapse-collapsed="${collapsed}"`:''}>
  ${head}<div class="ux-card-body"${collapsible?` id="${esc(bodyId)}" aria-hidden="${collapsed}"`:''}>${o.body??''}</div>${o.footer?`<footer class="ux-card-foot"${collapsible?` aria-hidden="${collapsed}"`:''}>${o.footer}</footer>`:''}</section>`;
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
   const cardEl=btn.closest('.ux-card');const key=cardEl?.dataset.collapseKey||'';
   const next=!cardEl.classList.contains('is-collapsed');
   cardEl.classList.toggle('is-collapsed',next);
   cardEl.dataset.collapseCollapsed=String(next);
   const body=cardEl.querySelector('.ux-card-body');const foot=cardEl.querySelector('.ux-card-foot');
   body?.setAttribute('aria-hidden',String(next));foot?.setAttribute('aria-hidden',String(next));
   btn.setAttribute('aria-expanded',String(!next));
   btn.setAttribute('aria-label',`${next?'توسيع':'طي'} البطاقة: ${cardEl.querySelector('h3')?.textContent?.trim()||''}`);
   if(key){saveCollapseState(key,next);syncCollapsePin(cardEl.querySelector('.ux-card-pin'),key)}
  });
 });
 root.querySelectorAll('.ux-card[data-collapse-key]').forEach(cardEl=>{
  if(cardEl.dataset.bulkCollapseBound)return;cardEl.dataset.bulkCollapseBound='true';
  cardEl.addEventListener('collapse:bulk',event=>{
   const detail=event.detail||{};const next=Boolean(detail.collapsed);
   cardEl.classList.toggle('is-collapsed',next);cardEl.dataset.collapseCollapsed=String(next);
   const body=cardEl.querySelector('.ux-card-body'),foot=cardEl.querySelector('.ux-card-foot'),toggle=cardEl.querySelector('.ux-card-toggle');
   body?.setAttribute('aria-hidden',String(next));foot?.setAttribute('aria-hidden',String(next));
   toggle?.setAttribute('aria-expanded',String(!next));
   toggle?.setAttribute('aria-label',`${next?'توسيع':'طي'} البطاقة: ${cardEl.querySelector('h3')?.textContent?.trim()||''}`);
   if(detail.persist!==false){saveCollapseState(cardEl.dataset.collapseKey,next);syncCollapsePin(cardEl.querySelector('.ux-card-pin'),cardEl.dataset.collapseKey)}
  });
 });
 root.querySelectorAll('.ux-card-pin').forEach(button=>{
  const cardEl=button.closest('.ux-card');const key=cardEl?.dataset.collapseKey||'';
  bindCollapsePin(button,key,()=>cardEl?.classList.contains('is-collapsed'));
 });
 // النقر على عنوان بطاقة قابلة للطي يفتحها/يطويها أيضًا
 root.querySelectorAll('.ux-card-head[data-card-head]').forEach(head=>{
  if(head.dataset.bound)return;head.dataset.bound='1';
  head.addEventListener('click',e=>{
   if(e.target.closest('button,a,input,select,textarea,[data-no-collapse]'))return;
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
 // إعدادات العرض (⚙) — نظام البطاقات المركزي، تغيير محلي بلا إعادة رسم للصفحة
 bindCardDisplay(root);
}
const onOutside=e=>{if(!e.target.closest('.ux-menu-wrap'))document.querySelectorAll('.ux-menu:not([hidden])').forEach(m=>m.hidden=true)};
document.addEventListener('click',onOutside);
document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelectorAll('.ux-menu:not([hidden])').forEach(m=>m.hidden=true)});
