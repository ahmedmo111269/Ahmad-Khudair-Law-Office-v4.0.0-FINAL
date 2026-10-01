// =====================================================================
// SectionLayoutManager + PageLayoutRegistry — نظام مركزي واحد لأقسام الصفحات
// ---------------------------------------------------------------------
// • registerPageLayout({pageId, sections}) — أي صفحة تشترك بتعريف واحد فقط.
// • الترتيب والإظهار يُحفظان في DisplayPreferences (ui:display-prefs) عبر
//   prefs الموجودة — لا مخزن جديد ولا مساس بقاعدة بيانات المكتب.
// • حالة الفتح/الطي والتثبيت ليست مخزنة هنا: يُعاد استخدامها من نظام الطي
//   المركزي الموجود (collapse-state + أحداث collapse:bulk) — لا نظام ثانٍ.
// • التغييرات تُطبق على DOM مباشرة (نقل العناصر/إخفاؤها) — بلا إعادة رسم
//   للصفحة وبلا إعادة Query للبيانات.
// • UX: سحب وإفلات + أزرار ▲▼ (للهاتف واللمس) + إظهار/إخفاء + فتح/طي + تثبيت.
import {esc} from './dom.js';
import {modal,closeModal,confirmBox} from './modal.js';
import {toast} from './toast.js';
import {prefs} from '../core/preferences.js';
import {
 getSectionLayout,saveSectionLayout,markSectionsLegacyMigrated,isSectionsLegacyMigrated,
 resolvePageDisplay,setPageDisplay,resetPagePreferences,
 CARD_FONT_SIZES,CARD_FONT_LABELS,CARD_DENSITIES,CARD_DENSITY_LABELS,stepCardFontSize
} from '../core/display-prefs.js';
import {applyCardDisplay} from './card-display.js';
import {clearComponentStyle} from '../core/component-style.js';
import {isCollapsePinned,toggleCollapsePin} from './collapse-state.js';
import {syncCollapsePin} from './collapsible.js';

// ===== PageLayoutRegistry =====
const registry=new Map();

/**
 * تسجيل أقسام صفحة. التعريف ثابت (قائمة الأقسام)، أما الترتيب/الإظهار
 * فتفضيلات محفوظة separately. يمكن استدعاؤها أكثر من مرة (idempotent).
 * sections: [{id,title,icon?,canHide=true,defaultHidden=false}]
 */
export function registerPageLayout(def){
 const pageId=String(def?.pageId||'');
 if(!pageId)return null;
 const seen=new Set();
 const sections=(Array.isArray(def.sections)?def.sections:[])
  .filter(s=>s&&s.id&&!seen.has(String(s.id))&&seen.add(String(s.id)))
  .map(s=>({id:String(s.id),title:String(s.title||s.id),icon:String(s.icon||''),canHide:s.canHide!==false,defaultHidden:Boolean(s.defaultHidden)}));
 const entry={pageId,title:String(def.title||pageId),sections};
 registry.set(pageId,entry);
 return entry;
}
export const getPageLayout=pageId=>registry.get(String(pageId||''))||null;
export const listRegisteredLayouts=()=>[...registry.values()];

/** الترتيب الفعّال: المحفوظ أولًا (المطابق للأقسام المسجلة) ثم الباقي بالترتيب الافتراضي. */
export function resolveSectionOrder(pageId){
 const layout=getPageLayout(pageId);
 if(!layout)return [];
 const ids=layout.sections.map(s=>s.id);
 const saved=getSectionLayout(pageId);
 const order=(saved.order||[]).filter(id=>ids.includes(id));
 for(const id of ids)if(!order.includes(id))order.push(id);
 return order;
}
export function orderedSections(pageId){
 const layout=getPageLayout(pageId);
 if(!layout)return [];
 const byId=new Map(layout.sections.map(s=>[s.id,s]));
 return resolveSectionOrder(pageId).map(id=>byId.get(id)).filter(Boolean);
}
export function hiddenSectionIds(pageId){
 const layout=getPageLayout(pageId);
 if(!layout)return new Set();
 const ids=new Set(layout.sections.map(s=>s.id));
 return new Set((getSectionLayout(pageId).hidden||[]).filter(id=>ids.has(id)));
}
export const isSectionHidden=(pageId,id)=>hiddenSectionIds(pageId).has(id);

/** ترحيل لمرة واحدة من مفتاح ترتيب قديم (مثل client-sections:order) إلى المخزن المركزي. */
export function migrateLegacySectionOrder(pageId,legacyPrefKey){
 if(!pageId||!legacyPrefKey||isSectionsLegacyMigrated(pageId))return false;
 const legacy=prefs.get(legacyPrefKey,null);
 markSectionsLegacyMigrated(pageId);
 if(!Array.isArray(legacy)||!legacy.length)return false;
 const layout=getPageLayout(pageId);
 if(!layout)return false;
 const valid=new Set(layout.sections.map(s=>s.id));
 const order=[...new Set(legacy.map(String).filter(id=>valid.has(id)))];
 if(!order.length)return false;
 saveSectionLayout(pageId,{order});
 return true;
}

// ===== التطبيق على DOM =====
const sectionEls=(root,pageId)=>{
 const layout=getPageLayout(pageId);
 if(!layout||!root?.querySelectorAll)return [];
 const ids=new Set(layout.sections.map(s=>s.id));
 return [...root.querySelectorAll('[data-section-id]')].filter(el=>ids.has(el.dataset.sectionId));
};

/**
 * إعادة ترتيب/إخفاء أقسام صفحة على DOM مباشرة.
 * لا تحرّك شيئًا إذا كان الترتيب الحالي مطابقًا (بلا reflow غير ضروري)،
 * وتعيد الترتيب داخل كل أب على حدة حتى تعمل مع الصفحات متعددة الحاويات.
 */
export function applyPageLayout(root,pageId){
 const layout=getPageLayout(pageId);
 if(!layout||!root?.querySelectorAll)return;
 const order=resolveSectionOrder(pageId);
 if(!order.length)return;
 const rank=new Map(order.map((id,i)=>[id,i]));
 const hidden=hiddenSectionIds(pageId);
 const items=sectionEls(root,pageId);
 for(const el of items)el.classList.toggle('section-hidden',hidden.has(el.dataset.sectionId));
 const groups=new Map();
 for(const el of items){
  const parent=el.parentElement;
  if(!parent)continue;
  if(!groups.has(parent))groups.set(parent,[]);
  groups.get(parent).push(el);
 }
 for(const [parent,els] of groups){
  const sorted=[...els].sort((a,b)=>rank.get(a.dataset.sectionId)-rank.get(b.dataset.sectionId));
  if(sorted.every((el,i)=>el===els[i]))continue; // نفس الترتيب الحالي — لا حركة
  // إعادة ترتيب تحفظ المواقع: نستبدل كل قسم بعلامة مكان، ثم نضع الأقسام
  // بالترتيب الجديد في نفس مواقعها الأصلية — فلا تقفز العناصر غير المسجّلة
  // (مثل التقويم أو شريط الحالة) إلى الأعلى ولا يختل تخطيط الصفحة.
  const marks=els.map(el=>{const m=document.createComment('pl-slot');parent.insertBefore(m,el);parent.removeChild(el);return m});
  sorted.forEach((el,i)=>parent.insertBefore(el,marks[i]||null));
  marks.forEach(m=>m.remove());
 }
}

/** تطبيق إعدادات عرض الصفحة (الصفحة ← العام ← الافتراضي) على جذر المحتوى + بطاقاته. */
export function applyPageDisplay(root,pageId=''){
 if(!root)return null;
 const resolved=resolvePageDisplay(pageId);
 root.dataset.cfont=resolved.fontSize;
 root.dataset.cdensity=resolved.density;
 root.dataset.clayout=resolved.fieldLayout;
 root.dataset.csecondary=resolved.secondary?'on':'off';
 root.dataset.cborders=resolved.borders?'on':'off';
 root.querySelectorAll?.('.ux-card[data-display-key]').forEach(cardEl=>{
  applyCardDisplay(cardEl,cardEl.dataset.displayKey,pageId||cardEl.dataset.pageId||'');
 });
 return resolved;
}

// ===== «تخصيص الصفحة» =====
const pageSeg=(name,current,options,labels,label)=>`<div class="pl-field"><span class="ux-dp-lbl">${esc(label)}</span><div class="ux-seg" role="radiogroup" aria-label="${esc(label)}" data-plseg="${esc(name)}">${options.map(value=>`<button type="button" role="radio" aria-checked="${value===current}" class="${value===current?'on':''}" data-v="${esc(value)}">${esc(labels[value]||value)}</button>`).join('')}</div></div>`;

/**
 * فتح نافذة «تخصيص الصفحة»: ترتيب (سحب + ▲▼)، إظهار/إخفاء، فتح/طي، تثبيت،
 * إعدادات عرض الصفحة، واستعادة الافتراضي. التغييرات فورية ومحفوظة.
 */
export function openPageCustomizer(app,{pageId,root,onChanged}={}){
 const layout=getPageLayout(pageId);
 if(!layout){toast('لا توجد أقسام مسجلة لهذه الصفحة','error');return null}
 const host=root||document.querySelector('#main-content')||document.body;
 const elOf=id=>host.querySelector(`[data-section-id="${CSS.escape(id)}"]`);
 const card=modal(`
  <h2 class="modal-title">تخصيص الصفحة — ${esc(layout.title)}</h2>
  <p class="muted small">رتّب الأقسام بالسحب أو بأزرار ▲▼ (تعمل على اللمس)، وأظهر أو أخفِ ما لا تحتاجه، وافتح أو اطوِ أي قسم، وثبّت حالته بالدبوس. كل التغييرات تفضيلات عرض تُحفظ فورًا لهذا المستخدم — لا تُغيَّر أي بيانات.</p>
  <div class="pl-display">
   <div class="pl-field"><span class="ux-dp-lbl">حجم الخط في هذه الصفحة</span>
    <div class="ux-dp-stepper"><button type="button" class="ghost small" data-pl-fstep="-1" aria-label="تصغير خط الصفحة">A−</button><span data-pl-fontseg></span><button type="button" class="ghost small" data-pl-fstep="1" aria-label="تكبير خط الصفحة">A+</button></div>
   </div>
   ${pageSeg('density',resolvePageDisplay(pageId).density,CARD_DENSITIES,CARD_DENSITY_LABELS,'كثافة العرض في هذه الصفحة')}
  </div>
  <ol class="pl-list" id="pl-list"></ol>
  <p class="muted small pl-hint">اسحب من المقبض ⋮⋮ لإعادة الترتيب. الأقسام المخفية تبقى بياناتها كما هي ويمكن إظهارها من هنا دائمًا.</p>
  <div class="form-actions">
   <button type="button" class="ghost" data-pl-style title="اللوحة العالمية: النصوص والألوان والخلفية والحدود والظلال والمسافات لهذه الصفحة">🎨 تخصيص عرض الصفحة</button>
   <button type="button" class="ghost danger" data-pl-reset>↺ استعادة الافتراضي لهذه الصفحة</button>
   <button type="button" class="primary" data-pl-done>تم</button>
  </div>`);
 const list=card.querySelector('#pl-list');
 const fontSegHost=card.querySelector('[data-pl-fontseg]');
 const densitySeg=card.querySelector('[data-plseg="density"]');

 const change=detail=>{applyPageDisplay(host,pageId);applyPageLayout(host,pageId);draw();onChanged?.(detail)};

 function draw(){
  const display=resolvePageDisplay(pageId);
  fontSegHost.innerHTML=`<div class="ux-seg" role="radiogroup" aria-label="حجم خط الصفحة" data-plseg="fontSize">${CARD_FONT_SIZES.map(v=>`<button type="button" role="radio" aria-checked="${v===display.fontSize}" class="${v===display.fontSize?'on':''}" data-v="${v}">${esc(CARD_FONT_LABELS[v])}</button>`).join('')}</div>`;
  densitySeg.querySelectorAll('button').forEach(b=>{const on=b.dataset.v===display.density;b.classList.toggle('on',on);b.setAttribute('aria-checked',String(on))});
  const hidden=hiddenSectionIds(pageId);
  list.innerHTML=orderedSections(pageId).map((section,index,total)=>{
   const el=elOf(section.id);
   const collapsible=Boolean(el?.dataset?.collapseKey);
   const collapsed=collapsible&&el.dataset.collapseCollapsed==='true';
   const pinned=collapsible&&isCollapsePinned(el.dataset.collapseKey);
   const isHidden=hidden.has(section.id);
   return `<li class="pl-row${isHidden?' is-off':''}" data-pl="${esc(section.id)}" draggable="true">
    <span class="pl-handle" title="اسحب لإعادة الترتيب" aria-hidden="true">⋮⋮</span>
    <span class="pl-name">${section.icon?`<span class="pl-ic" aria-hidden="true">${esc(section.icon)}</span>`:''}${esc(section.title)}</span>
    <span class="pl-moves">
     <button type="button" class="link" data-pl-move="-1" ${index===0?'disabled':''} aria-label="تحريك ${esc(section.title)} لأعلى" title="تحريك لأعلى">▲</button>
     <button type="button" class="link" data-pl-move="1" ${index===total.length-1?'disabled':''} aria-label="تحريك ${esc(section.title)} لأسفل" title="تحريك لأسفل">▼</button>
    </span>
    ${collapsible?`<button type="button" class="ghost small" data-pl-collapse aria-label="${collapsed?'فتح':'طي'} القسم: ${esc(section.title)}">${collapsed?'▸ مطوي':'▾ مفتوح'}</button>
    <button type="button" class="link pl-pin${pinned?' is-pinned':''}" data-pl-pin aria-pressed="${pinned}" aria-label="${pinned?'إلغاء تثبيت':'تثبيت'} حالة: ${esc(section.title)}" title="${pinned?'إلغاء تثبيت الحالة':'تثبيت الحالة الحالية'}">📌</button>`:''}
    ${section.canHide?`<label class="pl-vis" title="إظهار أو إخفاء القسم"><input type="checkbox" data-pl-vis ${isHidden?'':'checked'} aria-label="إظهار القسم: ${esc(section.title)}"> <span aria-hidden="true">👁</span></label>`:''}
   </li>`;
  }).join('');
 }

 const move=(id,delta)=>{
  const order=resolveSectionOrder(pageId);
  const i=order.indexOf(id),j=i+delta;
  if(i<0||j<0||j>=order.length)return;
  order.splice(i,1);order.splice(j,0,id);
  saveSectionLayout(pageId,{order});
  change({type:'order',id});
 };

 list.addEventListener('click',e=>{
  const row=e.target.closest('[data-pl]');
  if(!row)return;
  const id=row.dataset.pl;
  const mv=e.target.closest('[data-pl-move]');
  if(mv&&!mv.disabled){move(id,Number(mv.dataset.plMove));return}
  if(e.target.closest('[data-pl-collapse]')){
   const el=elOf(id);
   if(!el?.dataset?.collapseKey)return;
   const next=el.dataset.collapseCollapsed!=='true';
   el.dispatchEvent(new CustomEvent('collapse:bulk',{detail:{collapsed:next,persist:true}}));
   draw();
   return;
  }
  if(e.target.closest('[data-pl-pin]')){
   const el=elOf(id);
   if(!el?.dataset?.collapseKey)return;
   toggleCollapsePin(el.dataset.collapseKey,el.dataset.collapseCollapsed==='true');
   syncCollapsePin(el.querySelector('.collapse-pin'),el.dataset.collapseKey);
   draw();
   return;
  }
 });
 list.addEventListener('change',e=>{
  const box=e.target.closest('[data-pl-vis]');
  if(!box)return;
  const id=box.closest('[data-pl]')?.dataset.pl;
  if(!id)return;
  const hidden=new Set(hiddenSectionIds(pageId));
  if(box.checked)hidden.delete(id);else hidden.add(id);
  saveSectionLayout(pageId,{hidden:[...hidden]});
  change({type:'visibility',id,hidden:!box.checked});
 });
 // سحب وإفلات (سطح المكتب) — مع ▲▼ دائمًا كبديل يعمل باللمس ولوحة المفاتيح
 let dragId=null;
 list.addEventListener('dragstart',e=>{
  const row=e.target.closest('[data-pl]');
  dragId=row?.dataset.pl||null;
  row?.classList.add('dragging');
  try{e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',dragId||'')}catch{}
 });
 list.addEventListener('dragover',e=>{
  e.preventDefault();
  list.querySelectorAll('.drag-over').forEach(x=>x.classList.remove('drag-over'));
  e.target.closest('[data-pl]')?.classList.add('drag-over');
 });
 list.addEventListener('dragend',()=>list.querySelectorAll('.dragging,.drag-over').forEach(x=>x.classList.remove('dragging','drag-over')));
 list.addEventListener('drop',e=>{
  e.preventDefault();
  const target=e.target.closest('[data-pl]')?.dataset.pl;
  list.querySelectorAll('.dragging,.drag-over').forEach(x=>x.classList.remove('dragging','drag-over'));
  if(!dragId||!target||dragId===target){dragId=null;return}
  const order=resolveSectionOrder(pageId);
  const from=order.indexOf(dragId),to=order.indexOf(target);
  if(from<0||to<0){dragId=null;return}
  order.splice(from,1);order.splice(to,0,dragId);
  dragId=null;
  saveSectionLayout(pageId,{order});
  change({type:'order'});
 });
 // إعدادات عرض الصفحة
 card.addEventListener('click',async e=>{
  const segBtn=e.target.closest('[data-plseg] button');
  if(segBtn){
   const group=segBtn.closest('[data-plseg]')?.dataset.plseg;
   if(group==='fontSize')setPageDisplay(pageId,{fontSize:segBtn.dataset.v});
   else if(group==='density')setPageDisplay(pageId,{density:segBtn.dataset.v});
   change({type:'display'});
   return;
  }
  const step=e.target.closest('[data-pl-fstep]');
  if(step){
   const current=resolvePageDisplay(pageId).fontSize;
   setPageDisplay(pageId,{fontSize:stepCardFontSize(current,Number(step.dataset.plFstep))});
   change({type:'display'});
   return;
  }
  if(e.target.closest('[data-pl-style]')){
   // اللوحة العالمية الموحدة — إعدادات الصفحة المستقلة (page:<pageId>) في نظام
   // التخصيص الكامل: لا تمس صفحة أخرى، ولا تتجاوز Override أي عنصر داخلها.
   const {openComponentCustomizer}=await import('./component-customizer.js');
   openComponentCustomizer({id:`page:${pageId}`,type:'page',title:layout.title,el:host,pageId:''});
   return;
  }
  if(e.target.closest('[data-pl-done]')){closeModal();return}
  if(e.target.closest('[data-pl-reset]')){
   const ok=await confirmBox('استعادة الترتيب والإظهار وإعدادات العرض الافتراضية لهذه الصفحة؟ هذا يمسح تفضيلات العرض المحفوظة لها فقط — لا يُحذف أو يتغير أي بيانات أو سجلات.',{okText:'استعادة الافتراضي'});
   if(!ok)return;
   resetPagePreferences(pageId);
   clearComponentStyle(`page:${pageId}`); // مستوى الصفحة في نظام التخصيص الكامل — عناصر الصفحة تحتفظ بـ Override الخاص بها
   change({type:'reset'});
   toast('تمت استعادة إعدادات الصفحة الافتراضية');
  }
 });
 draw();
 return card;
}
