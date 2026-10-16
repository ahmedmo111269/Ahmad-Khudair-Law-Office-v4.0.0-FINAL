// صفحات السجل: الموكل، الخصم، القضية/المرحلة، وصفحة عامة لأي سجل (rec:store:id).
// كل صفحة: قسم بيانات كاملة قابل للطي مع زر تعديل، وأقسام جداول قابلة للطي للسجلات المرتبطة.
import {esc} from '../ui/dom.js';
import {toast} from '../ui/toast.js';
import {confirmBox} from '../ui/modal.js';
import {openEntityForm} from '../ui/form.js';
import {ENTITIES,displayValue,label,fmtDate,phonesOf,entityRoute} from '../domain/entities.js';
import {resolveRefs,clientRelated,opponentRelated,refLabel} from '../services/entity-query.js';
import {fileParties as loadFileParties} from '../services/legal-files.js';
import {deleteEntity,restoreEntity} from '../services/entity-save.js';
import {sectionGrid,routeFor} from './list-page.js';
import {userError} from '../core/errors.js';
import {hearingCycle} from '../services/operations.js';
import {serviceCycle} from '../services/service-records.js';
import {createReannouncement} from './service-records.js';
import {openLegalFileWizard} from './client-file.js';
import {buildCaseTimeline} from '../services/timeline.js';
import {timelineHtml,bindTimeline} from './timeline-view.js';
import {trackRecent} from '../services/recents.js';
import {formatFileNumber,fileNumberChip} from '../core/file-number.js';
import {registerPageLayout,resolveSectionOrder,hiddenSectionIds,migrateLegacySectionOrder,openPageCustomizer} from '../ui/page-layout.js';
import {linkedTasksPanelHtml,bindLinkedTasksPanel} from '../ui/work-links.js';
import {notesForEntity} from '../services/quick-notes.js';
import {openQuickNoteCapture,openQuickNoteEditor} from './quick-notes.js';

// السجلات التي تقبل «مهمة مرتبطة» من مركز العمل (المعرّف فقط يُخزَّن في المهمة).
const TASK_LINK_STORES=['hearings','procedures','appointments','communications','judgments','serviceRecords','expertReports','execution','caseNotes','powersOfAttorney','cases'];
const taskScope=(store,id)=>store==='cases'?{caseId:id}:{relatedId:id};
const NOTE_ENTITY_TYPES={clients:'CLIENT',files:'LEGAL_FILE',cases:'CASE',fileParties:'PARTY',hearings:'HEARING',procedures:'PROCEDURE',judgments:'JUDGMENT',execution:'EXECUTION',powersOfAttorney:'POA',serviceRecords:'SERVICE_RECORD',expertReports:'EXPERT_REPORT',appointments:'APPOINTMENT',communications:'COMMUNICATION',fees:'FEE',documentReferences:'DOCUMENT_REFERENCE'};

export function kvHtml(fields,row,refs,{skipEmpty=true,includeEmptyAvailable=false,secondary=null}={}){
 // secondary: مجموعة مفاتيح حقول «ثانوية» — تُخفى جميعها عند إيقاف «البيانات الثانوية»
 // من إعدادات العرض (عرض مختصر/تفصيلي) ولا تُحذف من السجل ولا من التخصيص الفردي.
 const secondaryKeys=secondary instanceof Set?secondary:Array.isArray(secondary)?new Set(secondary.map(String)):null;
 const items=fields.map(f=>{
  const v=displayValue(f,row,refs);
  const empty=v===null||v===undefined||v==='';
  if(skipEmpty&&empty)return '';
  const hasStoredRef=Boolean(f.ref&&row?.[f.k]);
  const refsCanVerify=typeof refs?.has==='function';
  const isLiveRef=hasStoredRef&&refsCanVerify&&refs.has(row[f.k]);
  const route=isLiveRef?entityRoute(f.ref,row[f.k]):null;
  const link=route?` data-open-ref="${esc(f.ref)}:${esc(row[f.k])}"`:'';
  const unavailable=hasStoredRef&&refsCanVerify&&!isLiveRef
   ?'<small class="record-ref-unavailable muted" role="status">السجل المرتبط غير متاح حاليًا.</small>':'';
  const optionalEmpty=includeEmptyAvailable&&empty,hasAction=Boolean(link);
  const linkedValue=hasAction?`<button type="button" class="link" data-display-action aria-label="فتح السجل المرتبط: ${esc(f.l)}"><span data-display-hide-target>${esc(v)}</span><span class="record-ref-action-fallback" data-display-action-fallback hidden>فتح السجل المرتبط</span></button>`:esc(v);
  return `<div class="kv-item${f.t==='textarea'?' wide':''}${secondaryKeys?.has(f.k)?' is-secondary':''}" data-display-item="field:${esc(String(f.k))}" data-display-label="${esc(f.l)}"${optionalEmpty?' data-display-default-hidden="true"':''}${hasAction?' data-display-preserve-actions="true"':''}><dt${hasAction?' data-display-hide-target="label"':''}>${esc(f.l)}</dt><dd${link}>${empty?'<span class="muted">غير مسجل — أظهر هذا الحقل لإضافته إلى العرض</span>':hasAction?linkedValue:esc(v)}${unavailable}</dd></div>`;
 }).join('');
 return items?`<dl class="kv">${items}</dl>`:'<p class="muted">لا توجد بيانات مسجلة بعد. اضغط «تعديل البيانات» لإضافتها.</p>';
}
const recordToken=value=>String(value||'').replace(/[^a-zA-Z0-9_-]/g,'-');
const recordTabId=(pageId,key)=>`rw-tab-${recordToken(pageId)}-${recordToken(key)}`;
const recordPanelId=(pageId,key)=>`rw-panel-${recordToken(pageId)}-${recordToken(key)}`;
let recordStickyListenerBound=false;
function syncRecordTabStickyTop(root){
 const bar=root?.querySelector('.record-tabs-bar');
 if(!bar)return;
 let offset=0;
 for(const selector of ['#sidebar.tn-bar','.topbar']){
  const element=document.querySelector(selector);
  if(!element)continue;
  const style=getComputedStyle(element);
  if(style.display==='none'||style.position!=='sticky')continue;
  offset+=element.offsetHeight||0;
 }
 bar.style.top=`${Math.round(offset)}px`;
}
function ensureRecordTabStickyUpdates(){
 if(recordStickyListenerBound||typeof window==='undefined')return;
 recordStickyListenerBound=true;
 const update=()=>requestAnimationFrame(()=>syncRecordTabStickyTop(document.querySelector('#main-content')));
 window.addEventListener('resize',update,{passive:true});
 window.addEventListener('orientationchange',update,{passive:true});
}
function recordPanelAttrs(pageId,key,{active='data',count=null}={}){
 const isActive=active===key;
 const countValue=count===null||count===undefined?'':String(count);
 return `id="${recordPanelId(pageId,key)}" data-section-id="${esc(key)}" data-record-tab-panel data-record-section="${esc(key)}" data-record-count="${esc(countValue)}" role="tabpanel" aria-labelledby="${recordTabId(pageId,key)}" tabindex="0" aria-hidden="${!isActive}"${isActive?'':' hidden'}`;
}
export function section(key,title,count,body,{open=true,add='',pageId='',active='data'}={}){
 const panelAttrs=pageId?recordPanelAttrs(pageId,key,{active,count}):`data-section-id="${esc(key)}"`;
 return `<details class="rec-section record-tab-panel" data-sec="${esc(key)}" data-collapse-default="${open?'open':'collapsed'}" ${panelAttrs} ${open?'open':''}><summary><span>${esc(title)}</span>${count!==null&&count!==undefined?`<span class="count">${esc(String(count))}</span>`:''}</summary>${add?`<div class="sec-actions">${add}</div>`:''}<div class="sec-body">${body}</div></details>`;
}
function usefulTabCount(value){
 if(value===null||value===undefined||value==='')return false;
 const text=String(value);
 if(text.includes('+'))return true;
 const numeric=Number(text.replace(/[^0-9.-]/g,''));
 return Number.isFinite(numeric)&&numeric>0;
}
function recordTabLayout(pageId,sections,primaryIds){
 const byId=new Map(sections.map(section=>[section.id,section]));
 const order=resolveSectionOrder(pageId).map(id=>byId.get(id)).filter(Boolean);
 const hidden=hiddenSectionIds(pageId);
 const primarySet=new Set(primaryIds);
 const primary=order.filter(section=>primarySet.has(section.id)&&!hidden.has(section.id));
 const moreVisible=order.filter(section=>!primarySet.has(section.id)&&!hidden.has(section.id));
 const hiddenSections=order.filter(section=>hidden.has(section.id));
 return {order,primary,moreVisible,hiddenSections,allMore:[...moreVisible,...hiddenSections]};
}
function recordTabButtonHtml(pageId,section,active,{menu=false,hidden=false}={}){
 const count=usefulTabCount(section.count)?String(section.count):'';
 if(menu)return `<button type="button" role="menuitemradio" id="${recordTabId(pageId,section.id)}" aria-checked="${active===section.id}" class="ux-menu-item ftb-item${active===section.id?' is-on':''}${count?' has-data':''}${hidden?' is-hidden-section':''}" data-record-tab="${esc(section.id)}" aria-controls="${recordPanelId(pageId,section.id)}" title="${esc(section.title)}"><span class="ftb-item-ic" aria-hidden="true">${esc(section.icon||'▤')}</span><span class="ftb-item-label">${esc(section.title)}</span>${count?`<small class="ftb-n">${esc(count)}</small>`:''}${hidden?'<small class="ftb-hid">مخفي</small>':''}${active===section.id?'<span class="ftb-check" aria-hidden="true">✓</span>':''}</button>`;
 const short=section.short||section.title;
 return `<button type="button" role="tab" id="${recordTabId(pageId,section.id)}" data-record-tab="${esc(section.id)}" aria-controls="${recordPanelId(pageId,section.id)}" aria-selected="${active===section.id}" title="${esc(section.title)}" aria-label="${esc(section.title)}${count?` — ${esc(count)}`:''}" class="subtab-btn${active===section.id?' active':''}${count?' has-data':''}"><span class="tab-icon" aria-hidden="true">${esc(section.icon||'▤')}</span><span class="tab-label">${esc(section.title)}</span>${short!==section.title?`<span class="tab-label-short" aria-hidden="true">${esc(short)}</span>`:''}${count?` <small>${esc(count)}</small>`:''}</button>`;
}
function recordTabBarContents(pageId,pageTitle,sections,primaryIds,active){
 const layout=recordTabLayout(pageId,sections,primaryIds);
 const activeMore=layout.allMore.some(section=>section.id===active);
 const menuId=`rw-menu-${recordToken(pageId)}`;
 const primary=layout.primary.map(section=>recordTabButtonHtml(pageId,section,active)).join('');
 const visibleMore=layout.moreVisible.map(section=>recordTabButtonHtml(pageId,section,active,{menu:true})).join('');
 const hiddenMore=layout.hiddenSections.map(section=>recordTabButtonHtml(pageId,section,active,{menu:true,hidden:true})).join('');
 const more=layout.allMore.length?`<div class="ux-menu-wrap ftb-group ftb-more${activeMore?' is-active':''}" data-record-more>
  <button type="button" class="subtab-btn ftb-group-btn ftb-more-btn" data-record-more-toggle aria-haspopup="menu" aria-expanded="false" aria-controls="${menuId}" aria-current="${activeMore?'true':'false'}" title="بقية أقسام ${esc(pageTitle)}" aria-label="المزيد من الأقسام${activeMore?` — المفتوح: ${esc(sections.find(section=>section.id===active)?.title||'')}`:''}">
   <span class="tab-icon" aria-hidden="true">⋯</span><span class="tab-label">المزيد من الأقسام</span><span class="tab-label-short" aria-hidden="true">المزيد</span>${activeMore?`<span class="ftb-active-name">${esc(sections.find(section=>section.id===active)?.title||'')}</span>`:''}<span class="ftb-caret" aria-hidden="true">▾</span>
  </button>
  <div class="ux-menu ftb-menu ftb-menu-all record-tab-menu" id="${menuId}" data-record-tab-menu role="menu" aria-label="بقية أقسام ${esc(pageTitle)}" hidden>
   <p class="ftb-menu-title" role="presentation">كل الأقسام <small class="ftb-n">${layout.allMore.length}</small></p>
   ${layout.moreVisible.length?`<section class="ftb-sec" role="group" aria-label="أقسام إضافية"><p class="ftb-sec-title" role="presentation">أقسام إضافية</p>${visibleMore}</section>`:''}
   ${layout.hiddenSections.length?`<section class="ftb-sec ftb-sec-hidden" role="group" aria-label="أقسام مخفية"><p class="ftb-sec-title" role="presentation">مخفية من الشريط <small class="muted">— أظهرها من ⚙</small></p>${hiddenMore}</section>`:''}
  </div>
 </div>`:'';
 return `<div class="file-subtabs record-primary-tabs" role="tablist" aria-label="تبويبات ${esc(pageTitle)}">${primary}</div>${more}<div class="ftb-tools"><button type="button" class="ghost icon-only" data-customize-page title="ترتيب التبويبات وإظهارها وإعدادات العرض" aria-label="تخصيص الصفحة">⚙</button></div>`;
}
export function recordWorkspaceMarkup({pageId,pageTitle,sections,primaryTabs,head,notice='',content,active='data',instanceId=''}){
 const primaryIds=primaryTabs||sections.slice(0,4).map(section=>section.id);
 return `<div class="record-workspace" data-record-workspace data-record-page="${esc(pageId)}"${instanceId?` data-uxc-instance="${esc(instanceId)}"`:''} data-active-tab="${esc(active)}">
  ${head}${notice}
  <nav class="file-tabs-bar record-tabs-bar" data-record-tabs-bar aria-label="أقسام ${esc(pageTitle)}" style="--record-primary-count:${Math.max(1,Math.min(4,primaryIds.length))}">${recordTabBarContents(pageId,pageTitle,sections,primaryIds,active)}</nav>
  <div class="record-tab-panels" data-record-tab-panels>${content}</div>
 </div>`;
}
export function bindRecordWorkspaceTabs(app,root,pageId,pageTitle,sections,primaryTabs,{defaultTab='data',onActivate}={}){
 const workspace=root.querySelector(`[data-record-workspace][data-record-page="${CSS.escape(pageId)}"]`);
 const bar=workspace?.querySelector('[data-record-tabs-bar]');
 if(!workspace||!bar)return;
 syncRecordTabStickyTop(root);
 ensureRecordTabStickyUpdates();
 const byId=new Map(sections.map(section=>[section.id,section]));
 const panels=[...workspace.querySelectorAll('[data-record-tab-panel]')];
 const panelIds=new Set(panels.map(panel=>panel.dataset.recordSection));
 const firstVisiblePanel=()=>{const hidden=hiddenSectionIds(pageId);return resolveSectionOrder(pageId).find(id=>panelIds.has(id)&&!hidden.has(id))||panels[0]?.dataset.recordSection||''};
 let active=panelIds.has(defaultTab)&&!hiddenSectionIds(pageId).has(defaultTab)?defaultTab:firstVisiblePanel();
 const mounted=new Set();
 const renderBar=()=>{
  if(hiddenSectionIds(pageId).has(active))active=firstVisiblePanel();
  bar.innerHTML=recordTabBarContents(pageId,pageTitle,sections,primaryTabs,active);
  bar.style.setProperty('--record-primary-count',String(Math.max(1,Math.min(4,recordTabLayout(pageId,sections,primaryTabs).primary.length))));
  syncActive();
 };
 const closeMenu=({focus=false}={})=>{
  const menu=bar.querySelector('[data-record-tab-menu]');
  const trigger=bar.querySelector('[data-record-more-toggle]');
  if(menu){menu.hidden=true;menu.style.transform='';menu.style.maxHeight=''}
  trigger?.setAttribute('aria-expanded','false');
  if(focus)trigger?.focus?.({preventScroll:true});
 };
 const placeMenu=(menu,trigger)=>{
  menu.style.transform='';menu.style.maxHeight='';
  const rect=menu.getBoundingClientRect();
  if(!rect.width)return;
  const pad=8;let dx=0;
  if(rect.left<pad)dx=pad-rect.left;
  else if(rect.right>window.innerWidth-pad)dx=window.innerWidth-pad-rect.right;
  if(dx)menu.style.transform=`translateX(${Math.round(dx)}px)`;
  const available=window.innerHeight-rect.top-pad;
  if(available>120&&rect.height>available)menu.style.maxHeight=`${Math.round(available)}px`;
  void trigger;
 };
 const syncActive=()=>{
  workspace.dataset.activeTab=active;
  for(const panel of panels){
   const on=panel.dataset.recordSection===active;
   panel.hidden=!on;panel.classList.toggle('is-active',on);panel.setAttribute('aria-hidden',String(!on));
  }
  bar.querySelectorAll('[data-record-tab]').forEach(button=>{
   const on=button.dataset.recordTab===active;
   if(button.getAttribute('role')==='tab'){
    button.classList.toggle('active',on);button.setAttribute('aria-selected',String(on));
   }else{
    button.classList.toggle('is-on',on);button.setAttribute('aria-checked',String(on));
    const check=button.querySelector('.ftb-check');
    if(on&&!check){const icon=document.createElement('span');icon.className='ftb-check';icon.setAttribute('aria-hidden','true');icon.textContent='✓';button.append(icon)}
    else if(!on)check?.remove();
   }
  });
  const layout=recordTabLayout(pageId,sections,primaryTabs);
  const activeMore=layout.allMore.some(section=>section.id===active);
  const group=bar.querySelector('[data-record-more]');
  const trigger=bar.querySelector('[data-record-more-toggle]');
  group?.classList.toggle('is-active',activeMore);
  trigger?.setAttribute('aria-current',activeMore?'true':'false');
  if(trigger){
   trigger.setAttribute('aria-label',`المزيد من الأقسام${activeMore?` — المفتوح: ${byId.get(active)?.title||''}`:''}`);
   let name=trigger.querySelector('.ftb-active-name');
   if(activeMore){
    if(!name){name=document.createElement('span');name.className='ftb-active-name';trigger.insertBefore(name,trigger.querySelector('.ftb-caret'))}
    name.textContent=byId.get(active)?.title||'';
   }else name?.remove();
  }
 };
 const activate=async(id,{fromMenu=false}={})=>{
  if(!byId.has(id)||!panelIds.has(id))return false;
  active=id;syncActive();closeMenu({focus:fromMenu});
  if(!mounted.has(id)){
   mounted.add(id);
   try{await onActivate?.(id)}catch(error){mounted.delete(id);app.fail(error)}
  }
  return true;
 };
 bar.addEventListener('click',event=>{
  const customize=event.target.closest('[data-customize-page]');
  if(customize){openPageCustomizer(app,{pageId,root,onChanged:()=>{const previous=active;renderBar();if(active!==previous)void activate(active)}});return}
  const toggle=event.target.closest('[data-record-more-toggle]');
  if(toggle){
   const menu=bar.querySelector('[data-record-tab-menu]');
   if(!menu)return;
   if(menu.hidden){closeMenu();menu.hidden=false;toggle.setAttribute('aria-expanded','true');placeMenu(menu,toggle);menu.querySelector('.ftb-item')?.focus?.({preventScroll:true})}
   else closeMenu();
   return;
  }
  const tab=event.target.closest('[data-record-tab]');
  if(tab){void activate(tab.dataset.recordTab,{fromMenu:Boolean(tab.closest('[data-record-tab-menu]'))});return}
  if(!event.target.closest('[data-record-more]'))closeMenu();
 });
 bar.addEventListener('keydown',event=>{
  if(event.key==='Escape'){
   const menu=bar.querySelector('[data-record-tab-menu]');
   if(menu&&!menu.hidden){event.preventDefault();closeMenu({focus:true})}
   return;
  }
  const primary=bar.querySelector('.record-primary-tabs');
  const tabs=[...bar.querySelectorAll('.record-primary-tabs [role="tab"]')];
  const current=event.target.closest('[role="tab"],[role="menuitemradio"]');
  if(!current)return;
  if(current.getAttribute('role')==='tab'&&['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){
   if(!tabs.length)return;event.preventDefault();
   let index=tabs.indexOf(current);
   if(event.key==='Home')index=0;
   else if(event.key==='End')index=tabs.length-1;
   else{const rtl=getComputedStyle(bar).direction==='rtl';const forward=event.key==='ArrowLeft'?rtl:!rtl;index=(index+(forward?1:-1)+tabs.length)%tabs.length}
   tabs[index].focus({preventScroll:true});void activate(tabs[index].dataset.recordTab);
  }else if(current.getAttribute('role')==='menuitemradio'&&['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
   const menu=bar.querySelector('[data-record-tab-menu]');const items=[...menu.querySelectorAll('.ftb-item')];
   if(!items.length)return;event.preventDefault();let index=items.indexOf(current);
   if(event.key==='Home')index=0;else if(event.key==='End')index=items.length-1;else index=(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;
   items[index].focus({preventScroll:true});
  }
  void primary;
 });
 workspace.addEventListener('click',event=>{if(!bar.contains(event.target))closeMenu()});
 renderBar();
 void activate(active);
}

function currentContextNav(label,relations=''){
 return `<nav class="parent-links record-context-links" aria-label="سياق السجل"><span class="record-context-current" aria-current="page">أنت هنا: ${esc(label)}</span>${relations}</nav>`;
}
function recordContextNav(ent,row,refs){
 const fields=ent.fields.filter(f=>f.ref&&row?.[f.k]);
 const links=fields.filter(f=>refs?.has?.(row[f.k])&&entityRoute(f.ref,row[f.k])).map(f=>
  `<button type="button" class="ghost" data-open-ref="${esc(f.ref)}:${esc(row[f.k])}">فتح ${esc(f.l.replace(/\s*\(.*\)/,''))}: ${esc(refs.get(row[f.k])||ent.label)}</button>`
 ).join('');
 const unavailable=fields.filter(f=>typeof refs?.has==='function'&&!refs.has(row[f.k])).map(f=>
  `<span class="record-context-unavailable muted" role="status">${esc(f.l)}: السجل المرتبط غير متاح حاليًا</span>`
 ).join('');
 return currentContextNav(ent.label,links+unavailable);
}
function recordActionsDisclosure(context='',actions='',label='إجراءات'){
 const hasContent=Boolean(String(context||'').trim()||String(actions||'').trim());
 return `<details class="record-actions-disclosure" data-record-actions${hasContent?'':' data-empty="true"'}><summary><span class="record-actions-title">${esc(label)}</span><span class="record-actions-hint">السياق والأوامر</span><span class="record-actions-caret" aria-hidden="true">⌄</span></summary><div class="record-actions-content">${context||''}${actions?`<div class="head-actions record-actions-buttons">${actions}</div>`:''}</div></details>`;
}
function relatedCount(r,key,rows){return `${rows.length}${r.more?.[key]?'+':''}`}
function relatedLimitNotice(r){
 const labels={files:'الملفات',cases:'القضايا',hearings:'الجلسات',powersOfAttorney:'التوكيلات',appointments:'المواعيد',communications:'الاتصالات'};
 const limited=Object.keys(labels).filter(key=>r.more?.[key]);
 if(!limited.length)return '';
 return `<div class="notice" role="status"><b>عرض محدود:</b> قد توجد سجلات مرتبطة إضافية. عُرضت ${limited.map(key=>esc(labels[key])).join('، ')} حتى حد الصفحة؛ استخدم القوائم والبحث العام للوصول إلى بقية السجلات. لم تُحذف أو تُغيّر أي بيانات.</div>`;
}
const CLIENT_SECTIONS=[
 {id:'data',title:'البيانات الكاملة',short:'البيانات',icon:'▤'},
 {id:'files',title:'الملفات',icon:'▣'},
 {id:'cases',title:'القضايا والمراحل',short:'القضايا',icon:'⚖'},
 {id:'poa',title:'التوكيلات',icon:'✦'},
 {id:'hearings',title:'الجلسات',icon:'◷'},
 {id:'appointments',title:'المواعيد',icon:'◷'},
 {id:'communications',title:'الاتصالات',icon:'☎'}
];
const CLIENT_PRIMARY_TABS=['data','files','cases','hearings'];
const OPPONENT_SECTIONS=[
 {id:'data',title:'البيانات الكاملة',short:'البيانات',icon:'▤'},
 {id:'files',title:'الملفات',icon:'▣'},
 {id:'cases',title:'القضايا والمراحل',short:'القضايا',icon:'⚖'},
 {id:'hearings',title:'الجلسات',icon:'◷'}
];
// صفحات الأشخاص تستخدم سجل ترتيب الأقسام المركزي نفسه؛ تُرحَّل تفضيلات الموكل القديمة دون فقدها.
registerPageLayout({pageId:'client-details',title:'صفحة الموكل',sections:CLIENT_SECTIONS});
registerPageLayout({pageId:'opponent-details',title:'صفحة الخصم',sections:OPPONENT_SECTIONS});
function orderedClientSectionKeys(){
 migrateLegacySectionOrder('client-details','client-sections:order');
 return resolveSectionOrder('client-details');
}
export function bindRefLinks(app,root){root.querySelectorAll('[data-open-ref]').forEach(el=>el.addEventListener('click',()=>{const [store,id]=el.dataset.openRef.split(':');const route=entityRoute(store,id);if(route)app.go(route)}))}

async function confirmDelete(app,store,id){
 if(!await confirmBox(`حذف منطقي لهذا السجل (${esc(ENTITIES[store].label)})؟ يبقى محفوظًا في قاعدة البيانات ويمكن مراجعته من مركز الإصلاح، ولا يُحذف نهائيًا.`,{okText:'حذف منطقي'}))return;
 try{await deleteEntity(app.office,store,id)}catch(e){toast(userError(e),'error');return}
 // «تراجع» خلال ١٢ ثانية: الحذف المنطقي علَمٌ فقط، وإعادة العلم آمنة تمامًا.
 // الإشعار يُعرض قبل الرجوع ولا يُنتظَر به: فشل التنقل أو بطؤه لا يبتلع فرصة التراجع.
 toast('تم الحذف المنطقي — يمكنك التراجع الآن','warn',{duration:12000,actionLabel:'تراجع',undoable:true,undoLabel:`حذف ${ENTITIES[store]?.label||'سجل'}`,action:async()=>{
  try{await restoreEntity(app.office,store,id);toast('تم التراجع: السجل عاد كما كان');await app.refresh()}
  catch(error){toast(userError(error),'error')}
 }});
 try{app.back()}catch(e){app.fail(e)}
}
// ===== صفحة الموكل =====
export async function clientPage(app,id){
 const c=await app.office.r.clients.get(id);
 if(!c||c.isDeleted)return notFound('الموكل');
 trackRecent('client:'+id,c.fullName||'موكل',{icon:'users',sub:c.clientCode?formatFileNumber(c.clientCode):'',scope:app.ctx?.profile?.id||''});
 app.__rec={store:'clients',id,related:await clientRelated(app.office,id)};
 const r=app.__rec.related;
 const refs=await resolveRefs(app.office,[c],ENTITIES.clients.fields);
 const clientWorkPanel=await linkedTasksPanelHtml(app.office,{clientId:id},{title:'مهام الموكل',collapseId:'client-work',centerRoute:`actionCenter?clientId=${encodeURIComponent(id)}`});
 const panelCounts={files:relatedCount(r,'files',r.files),cases:relatedCount(r,'cases',r.cases),poa:relatedCount(r,'powersOfAttorney',r.poas),hearings:relatedCount(r,'hearings',r.hearings),appointments:relatedCount(r,'appointments',r.appointments),communications:relatedCount(r,'communications',r.communications)};
 const tabSections=CLIENT_SECTIONS.map(item=>({...item,count:panelCounts[item.id]??''}));
 const parts={
  data:section('data','البيانات الكاملة',null,kvHtml(ENTITIES.clients.fields,c,refs,{skipEmpty:false,includeEmptyAvailable:true})+clientWorkPanel,{pageId:'client-details',open:true}),
  files:section('files','الملفات',panelCounts.files,'<div data-grid="files"></div>',{pageId:'client-details',add:'<button class="ghost" data-add="files">+ ملف جديد لهذا الموكل</button>'}),
  cases:section('cases','القضايا والمراحل',panelCounts.cases,'<div data-grid="cases"></div>',{pageId:'client-details'}),
  poa:section('poa','التوكيلات',panelCounts.poa,'<div data-grid="powersOfAttorney"></div>',{pageId:'client-details',add:'<button class="ghost" data-add="powersOfAttorney">+ توكيل</button>'}),
  hearings:section('hearings','الجلسات',panelCounts.hearings,'<div data-grid="hearings"></div>',{pageId:'client-details'}),
  appointments:section('appointments','المواعيد',panelCounts.appointments,'<div data-grid="appointments"></div>',{pageId:'client-details',open:false,add:'<button class="ghost" data-add="appointments">+ موعد</button>'}),
  communications:section('communications','الاتصالات',panelCounts.communications,'<div data-grid="communications"></div>',{pageId:'client-details',open:false,add:'<button class="ghost" data-add="communications">+ اتصال</button>'})
 };
 const head=`<header class="record-head record-workspace-hero" aria-labelledby="client-record-title"><div class="record-workspace-identity"><span class="record-workspace-kicker">سجل الموكل</span><h2 id="client-record-title">${esc(c.fullName)}</h2><p class="badges">${c.clientCode?fileNumberChip(c):''}${phonesOf(c).map(p=>`<span class="badge">☎ ${esc(p)}</span>`).join('')}${c.nationalId?`<span class="badge">ر.ق ${esc(c.nationalId)}</span>`:''}<span class="badge">${esc(label(c.status||'active'))}</span></p></div>
  ${recordActionsDisclosure(currentContextNav('موكل'),`<button class="primary" data-route="cfile:${esc(id)}">📂 فتح ملف الموكل</button><button class="ghost" data-wc-client-task>+ مهمة</button><button class="ghost" data-rec-edit>تعديل البيانات</button><button class="ghost danger" data-rec-delete>حذف منطقي</button>`)}</header>`;
 return recordWorkspaceMarkup({pageId:'client-details',pageTitle:'سجل الموكل',sections:tabSections,primaryTabs:CLIENT_PRIMARY_TABS,head,notice:relatedLimitNotice(r),content:orderedClientSectionKeys().map(key=>parts[key]).join(''),instanceId:id});
}
export async function bindClientPage(app,id){
 const root=document.querySelector('#main-content');
 if(app.__rec?.store!=='clients'||app.__rec?.id!==id)return;
 const r=app.__rec.related;
 bindLinkedTasksPanel(app,root,{relatedType:'clients',relatedId:id});
 root.querySelector('[data-wc-client-task]')?.addEventListener('click',async()=>{const {openLinkedTaskForm}=await import('../ui/work-actions.js');openLinkedTaskForm(app,'clients',id,{onSaved:async()=>{toast('تمت إضافة المهمة');await app.refresh()}})});
 root.querySelectorAll('[data-rec-edit]').forEach(b=>b.onclick=()=>openEntityForm(app,'clients',{id}));
 root.querySelector('[data-rec-delete]')?.addEventListener('click',()=>confirmDelete(app,'clients',id));
 root.querySelectorAll('[data-add]').forEach(b=>b.onclick=async()=>{const s=b.dataset.add;if(s==='files'){const {openLegalFileWizard}=await import('./client-file.js');return openLegalFileWizard(app,{clientId:id})}openEntityForm(app,s,{preset:{clientId:id}})});
 const roleCol={key:'clientRole',label:'صفة الموكل',get:x=>x.clientRole,text:x=>x.clientRole||''};
 const panelCounts={files:relatedCount(r,'files',r.files),cases:relatedCount(r,'cases',r.cases),poa:relatedCount(r,'powersOfAttorney',r.poas),hearings:relatedCount(r,'hearings',r.hearings),appointments:relatedCount(r,'appointments',r.appointments),communications:relatedCount(r,'communications',r.communications)};
 const tabSections=CLIENT_SECTIONS.map(item=>({...item,count:panelCounts[item.id]??''}));
 const grids={
  files:()=>sectionGrid(app,root.querySelector('[data-grid="files"]'),'files',r.files,{storageKey:'client:files',extra:[roleCol]}),
  cases:()=>sectionGrid(app,root.querySelector('[data-grid="cases"]'),'cases',r.cases,{storageKey:'client:cases'}),
  poa:()=>sectionGrid(app,root.querySelector('[data-grid="powersOfAttorney"]'),'powersOfAttorney',r.poas,{storageKey:'client:poa'}),
  hearings:()=>sectionGrid(app,root.querySelector('[data-grid="hearings"]'),'hearings',r.hearings,{storageKey:'client:hearings'}),
  appointments:()=>sectionGrid(app,root.querySelector('[data-grid="appointments"]'),'appointments',r.appointments,{storageKey:'client:appointments'}),
  communications:()=>sectionGrid(app,root.querySelector('[data-grid="communications"]'),'communications',r.communications,{storageKey:'client:communications'})
 };
 bindRecordWorkspaceTabs(app,root,'client-details','سجل الموكل',tabSections,CLIENT_PRIMARY_TABS,{defaultTab:'data',onActivate:key=>grids[key]?.()});
}

// ===== صفحة الخصم =====
export async function opponentPage(app,id){
 const o=await app.office.r.opponents.get(id);
 if(!o||o.isDeleted)return notFound('الخصم');
 trackRecent('opponent:'+id,o.name||'خصم',{icon:'userX',sub:o.capacity||'',scope:app.ctx?.profile?.id||''});
 app.__rec={store:'opponents',id,related:await opponentRelated(app.office,id)};
 const r=app.__rec.related;
 const refs=await resolveRefs(app.office,[o],ENTITIES.opponents.fields);
 const counts={files:relatedCount(r,'files',r.files),cases:relatedCount(r,'cases',r.cases),hearings:relatedCount(r,'hearings',r.hearings)};
 const tabSections=OPPONENT_SECTIONS.map(item=>({...item,count:counts[item.id]??''}));
 const parts={
  data:section('data','البيانات الكاملة',null,kvHtml(ENTITIES.opponents.fields,o,refs,{skipEmpty:false,includeEmptyAvailable:true}),{pageId:'opponent-details',open:true}),
  files:section('files','الملفات',counts.files,'<div data-grid="files"></div>',{pageId:'opponent-details'}),
  cases:section('cases','القضايا والمراحل',counts.cases,'<div data-grid="cases"></div>',{pageId:'opponent-details'}),
  hearings:section('hearings','الجلسات',counts.hearings,'<div data-grid="hearings"></div>',{pageId:'opponent-details'})
 };
 const head=`<header class="record-head record-workspace-hero" aria-labelledby="opponent-record-title"><div class="record-workspace-identity"><span class="record-workspace-kicker">سجل الخصم</span><h2 id="opponent-record-title">${esc(o.name)}</h2><p class="badges">${phonesOf(o).map(p=>`<span class="badge">☎ ${esc(p)}</span>`).join('')}${o.capacity?`<span class="badge">${esc(o.capacity)}</span>`:''}</p></div>
  ${recordActionsDisclosure(currentContextNav('خصم'),'<button class="ghost" data-rec-edit>تعديل البيانات</button><button class="ghost danger" data-rec-delete>حذف منطقي</button>')}</header>`;
 return recordWorkspaceMarkup({pageId:'opponent-details',pageTitle:'سجل الخصم',sections:tabSections,primaryTabs:OPPONENT_SECTIONS.map(item=>item.id),head,notice:relatedLimitNotice(r),content:OPPONENT_SECTIONS.map(item=>parts[item.id]).join(''),instanceId:id});
}
export async function bindOpponentPage(app,id){
 const root=document.querySelector('#main-content');
 if(app.__rec?.store!=='opponents'||app.__rec?.id!==id)return;
 const r=app.__rec.related;
 root.querySelectorAll('[data-rec-edit]').forEach(b=>b.onclick=()=>openEntityForm(app,'opponents',{id}));
 root.querySelector('[data-rec-delete]')?.addEventListener('click',()=>confirmDelete(app,'opponents',id));
 const roleCol={key:'opponentRole',label:'صفة الخصم',get:x=>x.opponentRole,text:x=>x.opponentRole||''};
 const grids={
  files:()=>sectionGrid(app,root.querySelector('[data-grid="files"]'),'files',r.files,{storageKey:'opp:files',extra:[roleCol]}),
  cases:()=>sectionGrid(app,root.querySelector('[data-grid="cases"]'),'cases',r.cases,{storageKey:'opp:cases'}),
  hearings:()=>sectionGrid(app,root.querySelector('[data-grid="hearings"]'),'hearings',r.hearings,{storageKey:'opp:hearings'})
 };
 const counts={files:relatedCount(r,'files',r.files),cases:relatedCount(r,'cases',r.cases),hearings:relatedCount(r,'hearings',r.hearings)};
 const tabSections=OPPONENT_SECTIONS.map(item=>({...item,count:counts[item.id]??''}));
 bindRecordWorkspaceTabs(app,root,'opponent-details','سجل الخصم',tabSections,OPPONENT_SECTIONS.map(item=>item.id),{defaultTab:'data',onActivate:key=>grids[key]?.()});
}

// ===== صفحة عامة لأي سجل + القضية/المرحلة =====
const CASE_CHILDREN=[['hearings','الجلسات'],['judgments','الأحكام'],['procedures','الأعمال الإدارية'],['expertReports','الخبراء'],['serviceRecords','المحضرين والإعلانات'],['execution','التنفيذ']];
const RECORD_SECTION_META={
 data:{title:'البيانات الكاملة',short:'البيانات',icon:'▤'},
 'hearing-cycle':{title:'دورة الجلسات',short:'الدورة',icon:'◷'},
 'service-cycle':{title:'دورة الإعلان / الإنذار',short:'دورة الإعلان',icon:'📬'},
 'case-timeline':{title:'الخط الزمني الموحد للقضية',short:'الخط الزمني',icon:'⏳'},
 hearings:{title:'الجلسات',icon:'◷'},judgments:{title:'الأحكام',icon:'⌘'},procedures:{title:'الأعمال الإدارية',short:'الأعمال',icon:'☷'},
 expertReports:{title:'الخبراء',icon:'⚖'},serviceRecords:{title:'المحضرين والإعلانات',short:'الإعلانات',icon:'📬'},execution:{title:'التنفيذ',icon:'▣'},
 payments:{title:'الدفعات',icon:'＄'},quickNotes:{title:'الملاحظات السريعة',short:'الملاحظات',icon:'▤'},
 work:{title:'المهام المرتبطة',short:'المهام',icon:'☷'},activity:{title:'سجل النشاط',short:'النشاط',icon:'≋'}
};
/** الأقسام العامة لكل سجل؛ يبقى ترتيبها محفوظًا في نظام تخطيط الصفحات المركزي. */
export function recordSectionsFor(store){
 const ids=['data'];
 if(store==='hearings')ids.push('hearing-cycle');
 if(store==='serviceRecords')ids.push('service-cycle');
 if(store==='cases'){ids.push('case-timeline',...CASE_CHILDREN.map(([id])=>id))}
 if(store==='fees')ids.push('payments');
 if(NOTE_ENTITY_TYPES[store])ids.push('quickNotes');
 if(TASK_LINK_STORES.includes(store))ids.push('work');
 ids.push('activity');
 return ids.map(id=>({...RECORD_SECTION_META[id],id}));
}
export function primaryRecordTabs(store,sections){
 const choices=store==='cases'?['data','case-timeline','hearings','judgments']:
  store==='hearings'?['data','hearing-cycle','quickNotes','work']:
  store==='serviceRecords'?['data','service-cycle','quickNotes','work']:
  store==='fees'?['data','payments','quickNotes','work']:
  ['data','quickNotes','work','activity'];
 const available=new Set(sections.map(section=>section.id));
 return choices.filter(id=>available.has(id)).slice(0,4);
}
async function createRelatedFromRecord(app,row,store){
 const file=row.fileId?await app.office.r.files.get(row.fileId):null;
 const clientFile=file?.clientFileId?await app.office.r.clientFiles.get(file.clientFileId):null;
 if(!file||!clientFile?.clientId){toast('لا يمكن إنشاء ملف موكل مرتبط تلقائيًا لأن الملف الحالي غير مرتبط بملف موكل.','error');return}
 openLegalFileWizard(app,{clientId:clientFile.clientId,related:{fileId:file.id,relationCode:'RELATED_TO',title:`${formatFileNumber(file.fileNumber)||''} — ${file.title||ENTITIES.files.title(file)}`}});
}
function uniquePartyNames(kind,links,partyRows,records){
 const isClient=kind==='client',idField=isClient?'clientId':'opponentId',byId=new Map(records.map(record=>[record.id,record]));
 const candidates=[];
 for(const link of links||[])candidates.push({id:link[idField],record:byId.get(link[idField]),fallback:link.name||link.partyName||''});
 for(const party of partyRows||[]){
  const matches=isClient?(party.clientId||party.partyKind==='client'||party.partyType==='client'):(party.opponentId||party.partyKind==='opponent'||party.partyType==='opponent');
  if(matches)candidates.push({id:party[idField],record:byId.get(party[idField]),fallback:party.partyName||party.name||''});
 }
 const names=[],ids=new Set(),normalized=new Set();
 for(const item of candidates){
  const name=String((isClient?(item.record?.fullName||item.record?.name):(item.record?.name||item.record?.fullName))||item.fallback||'').trim();
  if(!name)continue;
  const key=name.toLocaleLowerCase().replace(/\s+/g,' '),id=String(item.id||'');
  if(id&&ids.has(id)||normalized.has(key))continue;
  if(id)ids.add(id);normalized.add(key);names.push(name);
 }
 return names;
}
async function casePartiesForDisplay(office,row){
 const [partyRowsRaw,clientLinksRaw,opponentLinksRaw]=await Promise.all([
  row.fileId?loadFileParties(office,row.fileId).catch(()=>[]):[],
  office.r.caseClients.byIndex('caseId',row.id,1000).catch(()=>[]),
  office.r.caseOpponents.byIndex('caseId',row.id,1000).catch(()=>[])
 ]);
 // legal-files.fileParties intentionally leaves lifecycle policy to its caller.
 const partyRows=(partyRowsRaw||[]).filter(party=>!party.isDeleted);
 const clientLinks=(clientLinksRaw||[]).filter(link=>!link.isDeleted),opponentLinks=(opponentLinksRaw||[]).filter(link=>!link.isDeleted);
 const clientIds=[...new Set([...clientLinks.map(link=>link.clientId),...partyRows.filter(party=>party.partyKind==='client'||party.partyType==='client'||party.clientId).map(party=>party.clientId)].filter(Boolean))];
 const opponentIds=[...new Set([...opponentLinks.map(link=>link.opponentId),...partyRows.filter(party=>party.partyKind==='opponent'||party.partyType==='opponent'||party.opponentId).map(party=>party.opponentId)].filter(Boolean))];
 const [clientsRaw,opponentsRaw]=await Promise.all([office.r.clients.getMany(clientIds),office.r.opponents.getMany(opponentIds)]);
 return {
  clients:uniquePartyNames('client',clientLinks,partyRows,(clientsRaw||[]).filter(person=>!person.isDeleted)),
  opponents:uniquePartyNames('opponent',opponentLinks,partyRows,(opponentsRaw||[]).filter(person=>!person.isDeleted))
 };
}
function caseIdentityField(id,label,value,{wide=false}={}){
 return `<div class="kv-item record-case-field${wide?' wide':''}" data-display-item="case:${esc(id)}" data-display-label="${esc(label)}"><dt>${esc(label)}</dt><dd>${value||'<span class="muted">غير مسجل</span>'}</dd></div>`;
}
function caseIdentityCardHtml(row,parties){
 const clients=parties.clients.map(name=>`<span class="record-case-party">${esc(name)}</span>`).join('')||'<span class="muted">غير محدد</span>';
 const opponents=parties.opponents.map(name=>`<span class="record-case-party">${esc(name)}</span>`).join('')||'<span class="muted">غير محدد</span>';
 const type=row.stageType||row.numberType||'';
 const number=`<strong>${esc(row.caseNumber||'—')}</strong><small>السنة: ${esc(row.caseYear||'—')}</small>`;
 const numberType=row.numberType&&row.numberType!==type?caseIdentityField('number-type','نوع الرقم',esc(row.numberType)):'';
 return `<article class="record-case-identity" aria-label="بطاقة بيانات القضية"><header class="record-case-identity-head"><div><span class="record-case-kicker">بيانات بارزة</span><h3>القضية / المرحلة</h3></div></header><dl class="record-case-grid">
  ${caseIdentityField('clients','الموكل',clients)}
  ${caseIdentityField('opponents','الخصم',opponents)}
  ${caseIdentityField('number','رقم القضية والسنة',number)}
  ${caseIdentityField('type','نوع الدعوى / المرحلة',esc(type))}
  ${numberType}
  ${caseIdentityField('subject','موضوع الدعوى',esc(row.subject||''),{wide:true})}
 </dl></article>`;
}
const CASE_IDENTITY_FIELD_KEYS=new Set(['fileId','stageType','numberType','caseNumber','caseYear','subject']);
export async function recordPage(app,store,id){
 const ent=ENTITIES[store];if(!ent)return notFound('السجل');
 const pageId=`rec:${store}`,pageTitle=`صفحة ${ent.label}`;
 const sectionDefs=recordSectionsFor(store);
 registerPageLayout({pageId,title:pageTitle,sections:sectionDefs});
 const row=await app.office.r[store].get(id);
 if(!row||row.isDeleted)return notFound(ent.label);
 const refs=await resolveRefs(app.office,[row],ent.fields);
 const caseParties=store==='cases'?await casePartiesForDisplay(app.office,row):null;
 const hearingSequence=store==='hearings'?await hearingCycle(app.office,id):null;
 const serviceSequence=store==='serviceRecords'?await serviceCycle(app.office,id):null;
 const children={};
 if(store==='cases')await Promise.all(CASE_CHILDREN.map(async([s])=>{children[s]=await app.office.r[s].byIndex('caseId',id,2000)}));
 if(store==='fees')children.feePayments=await app.office.r.feePayments.byIndex('feeId',id,2000);
 const activity=await app.office.r.activityLog.byIndex('entityId',id,200);
 const noteEntityType=NOTE_ENTITY_TYPES[store];
 const quickNotes=noteEntityType?await notesForEntity(app.office,noteEntityType,id,{limit:100}):[];
 const caseTimeline=store==='cases'?await buildCaseTimeline(app.office,id):null;
 app.__rec={store,id,row,children,activity,hearingSequence,serviceSequence,caseTimeline,quickNotes,noteEntityType};
 trackRecent(`rec:${store}:${id}`,ent.title(row)||ent.label,{icon:{hearings:'calendar',appointments:'clock',communications:'phone',fees:'wallet',judgments:'landmark',procedures:'clipboard',caseNotes:'note',serviceRecords:'file',expertReports:'microscope',execution:'hammer'}[store]||'file',sub:ent.label,scope:app.ctx?.profile?.id||''});
 const contextNav=recordContextNav(ent,row,refs);
 const extraBtns=[
  store==='hearings'?'<button class="ghost" data-show-hearing-cycle>عرض دورة الجلسات</button><button class="ghost" data-next-hearing>+ الجلسة التالية</button><button class="ghost" data-hearing-service>+ إعلان مرتبط بالجلسة</button>':'',
  store==='serviceRecords'? '<button class="ghost" data-show-service-cycle>عرض دورة الإعلان</button><button class="primary" data-service-reannounce>+ إنشاء إعادة إعلان</button>':'',
  store==='cases'?'<button class="ghost" data-add="hearings">+ جلسة</button><button class="ghost" data-add="judgments">+ حكم</button><button class="ghost" data-case-service>+ إعلان / إنذار</button>':'',
  ['cases','hearings','judgments'].includes(store)&&row.fileId?'<button class="ghost" data-create-related-file>⤴ إنشاء ملف مستقل مرتبط</button>':'',
  store==='fees'? '<button class="ghost" data-add="feePayments">+ دفعة</button>':'',
  TASK_LINK_STORES.includes(store)?`<button class="ghost" data-wc-linked-task>${store==='hearings'?'+ مهمة متابعة للجلسة':'+ مهمة مرتبطة'}</button>`:''
 ].join('');
 const notePanel=recordQuickNotesPanel(quickNotes,store,id,pageId,'data');
 const workPanel=TASK_LINK_STORES.includes(store)?await linkedTasksPanelHtml(app.office,taskScope(store,id),{title:'المهام المرتبطة',collapseId:`rec-work:${store}`,centerRoute:`actionCenter?${store==='cases'?'caseId':'relatedId'}=${encodeURIComponent(id)}`,recordTab:{sectionId:'work',pageId,panelId:recordPanelId(pageId,'work'),tabId:recordTabId(pageId,'work'),active:'data'}}):'';
 const availableFields={skipEmpty:false,includeEmptyAvailable:true};
 const fullDataBody=store==='cases'?caseIdentityCardHtml(row,caseParties)+kvHtml(ent.fields.filter(field=>!CASE_IDENTITY_FIELD_KEYS.has(field.k)),row,refs,availableFields):kvHtml(ent.fields,row,refs,availableFields);
 const bodyById={
  data:section('data','البيانات الكاملة',null,fullDataBody,{pageId,open:true}),
  quickNotes:notePanel,
  work:workPanel,
  'hearing-cycle':store==='hearings'?section('hearing-cycle','دورة الجلسات',hearingSequence?.items.length||0,`<ol class="hearing-cycle">${(hearingSequence?.items||[]).map((h,i)=>`<li style="--depth:${Math.min(6,h.__depth||0)}"><button type="button" data-cycle-hearing="${esc(h.id)}"><time>${fmtDate(h.hearingDate)||'بدون تاريخ'}${h.hearingTime?' '+esc(h.hearingTime):''}</time><b>${esc(h.type||'جلسة')}</b><small>${esc(h.court||'')}${h.chamber?' · '+esc(h.chamber):''}${h.result?' — '+esc(h.result):h.adjournedTo?' — تأجيل إلى '+fmtDate(h.adjournedTo):''}</small></button>${i<(hearingSequence?.items.length||0)-1?'<span class="cycle-arrow">↓</span>':''}</li>`).join('')}</ol>`,{pageId,open:true}):'',
  'service-cycle':store==='serviceRecords'?section('service-cycle','دورة الإعلان / الإنذار',serviceSequence?.records.length||0,`${serviceSequence?.hasBranches?'<p class="notice">توجد أكثر من إعادة مرتبطة بسجل واحد؛ عُرضت الفروع كما سُجلت.</p>':''}${serviceSequence?.more?'<p class="notice">تعرض دورة الملف أول 5000 سجل نشط؛ استخدم التقرير العام لتضييق نطاق السجلات الأقدم.</p>':''}<ol class="hearing-cycle service-cycle">${(serviceSequence?.records||[]).map((r,i)=>`<li style="--depth:${Math.min(6,r.__depth||0)}"><button type="button" data-cycle-service="${esc(r.id)}"><time>${fmtDate(r.createdAt)||'بدون تاريخ'}${r.serviceDate?' — '+fmtDate(r.serviceDate):''}</time><b>${esc(r.actionType||r.type||'إعلان')} · ${esc(r.internalNumber||'')}</b><small>${esc(r.partyName||'')} ${r.partyRole?'— '+esc(r.partyRole):''} · ${esc(r.status||'')}</small></button>${i<(serviceSequence?.records.length||0)-1?'<span class="cycle-arrow">↓</span>':''}</li>`).join('')}</ol>`,{pageId,open:true}):'',
  'case-timeline':store==='cases'?section('case-timeline','الخط الزمني الموحد للقضية',caseTimeline?.timeline.length||0,`<div data-case-timeline>${timelineHtml(caseTimeline,{compact:true})}</div>`,{pageId,open:Boolean(caseTimeline&&caseTimeline.timeline.length>0)}):'',
  activity:section('activity','سجل النشاط',activity.length,'<div data-grid="activityLog"></div>',{pageId,open:false})
 };
 if(store==='cases')for(const [childStore,title] of CASE_CHILDREN){
  bodyById[childStore]=section(childStore,title,children[childStore].length,`<div data-grid="${childStore}"></div>`,{pageId,open:children[childStore].length>0,add:`<button class="ghost" data-add="${childStore}">+ إضافة</button>`});
 }
 if(store==='fees')bodyById.payments=section('payments','الدفعات',children.feePayments.length,'<div data-grid="feePayments"></div>',{pageId,add:'<button class="ghost" data-add="feePayments">+ دفعة</button>'});
 const sectionCounts={quickNotes:quickNotes.length,activity:activity.length};
 if(store==='hearings')sectionCounts['hearing-cycle']=hearingSequence?.items.length||0;
 if(store==='serviceRecords')sectionCounts['service-cycle']=serviceSequence?.records.length||0;
 if(store==='cases'){
  sectionCounts['case-timeline']=caseTimeline?.timeline.length||0;
  for(const [childStore] of CASE_CHILDREN)sectionCounts[childStore]=children[childStore].length;
 }
 if(store==='fees')sectionCounts.payments=children.feePayments.length;
 const tabSections=sectionDefs.map(section=>({...section,count:sectionCounts[section.id]??''}));
 const head=`<header class="record-head record-workspace-hero" aria-labelledby="record-title-${recordToken(pageId)}"><div class="record-workspace-identity"><span class="record-workspace-kicker">${esc(ent.label)}</span><h2 id="record-title-${recordToken(pageId)}">${esc(ent.title(row)||ent.label)}</h2></div>
  ${recordActionsDisclosure(contextNav,`${extraBtns}<button class="ghost" data-rec-edit>تعديل</button><button class="ghost danger" data-rec-delete>حذف منطقي</button>`)}</header>`;
 const primaryTabs=primaryRecordTabs(store,tabSections);
 return recordWorkspaceMarkup({pageId,pageTitle,sections:tabSections,primaryTabs,head,content:sectionDefs.map(section=>bodyById[section.id]||'').join(''),instanceId:id});
}
export async function bindRecordPage(app,store,id){
 const root=document.querySelector('#main-content');
 // __rec قد يبقى من الصفحة السابقة إذا عُرض «غير موجود» (رابط قديم أو سجل حُذف): لا تربط القديم.
 if(app.__rec?.store!==store||app.__rec?.id!==id)return;
 const {row,children,activity,quickNotes,noteEntityType}=app.__rec;
 bindRecordQuickNotes(root,quickNotes,app,store,id,noteEntityType);
 if(TASK_LINK_STORES.includes(store)){
  const opts={relatedType:store,relatedId:id,title:store==='hearings'?'متابعة الجلسة':''};
  bindLinkedTasksPanel(app,root,opts);
  root.querySelector('[data-wc-linked-task]')?.addEventListener('click',async()=>{const {openLinkedTaskForm}=await import('../ui/work-actions.js');openLinkedTaskForm(app,store,id,{title:opts.title,onSaved:async()=>{toast('تمت إضافة المهمة المرتبطة');await app.refresh()}})});
 }
 root.querySelectorAll('[data-rec-edit]').forEach(b=>b.onclick=()=>openEntityForm(app,store,{id}));
 // محمي بـ ?. لأن الصفحة تُرسم أحيانًا بحالة «غير موجود» (رابط قديم أو سجل حُذف للتو)،
 // وكان السطر يرفع TypeError يقطع بقية الربط (الملاحظات، الدورات، الأزرار الأخرى).
 root.querySelector('[data-rec-delete]')?.addEventListener('click',()=>confirmDelete(app,store,id));
 bindRefLinks(app,root);
 root.querySelector('[data-show-hearing-cycle]')?.addEventListener('click',()=>root.querySelector('[data-record-tab="hearing-cycle"]')?.click());
 root.querySelector('[data-show-service-cycle]')?.addEventListener('click',()=>root.querySelector('[data-record-tab="service-cycle"]')?.click());
 root.querySelectorAll('[data-cycle-hearing]').forEach(b=>b.onclick=()=>app.go('rec:hearings:'+b.dataset.cycleHearing));
 root.querySelectorAll('[data-cycle-service]').forEach(b=>b.onclick=()=>app.go('rec:serviceRecords:'+b.dataset.cycleService));
 root.querySelector('[data-service-reannounce]')?.addEventListener('click',()=>createReannouncement(app,row));
 root.querySelector('[data-hearing-service]')?.addEventListener('click',()=>openEntityForm(app,'serviceRecords',{preset:{fileId:row.fileId,caseId:row.caseId,hearingId:id},onSaved:()=>app.refresh()}));
 root.querySelector('[data-case-service]')?.addEventListener('click',()=>openEntityForm(app,'serviceRecords',{preset:{fileId:row.fileId,caseId:id},onSaved:()=>app.refresh()}));
 root.querySelector('[data-create-related-file]')?.addEventListener('click',()=>createRelatedFromRecord(app,row,store));
 bindTimeline(root.querySelector('[data-case-timeline]')||root,{onOpen:r=>app.go(r.startsWith('rec:')?r:'rec:'+r)});
 root.querySelectorAll('[data-add]').forEach(b=>b.onclick=()=>{const s=b.dataset.add;const preset=store==='cases'?{caseId:id,fileId:row.fileId,...(s==='hearings'?{court:row.courtId||'',chamber:row.chamber||''}:{}),...(s==='judgments'?{court:row.courtId||'',chamber:row.chamber||'',stage:row.stageType||''}:{})}:store==='fees'?{feeId:id}:{};openEntityForm(app,s,{preset})});
 root.querySelector('[data-next-hearing]')?.addEventListener('click',()=>openEntityForm(app,'hearings',{preset:{fileId:row.fileId,caseId:row.caseId,previousHearingId:row.id,hearingDate:row.adjournedTo||'',court:row.court||'',chamber:row.chamber||'',type:row.type||'',reason:row.nextAction||row.reason||'',relatedPartyIds:row.relatedPartyIds||[]},title:'إضافة الجلسة التالية'}));
 const gridMounts={};
 if(store==='cases')for(const [childStore,rows] of Object.entries(children))gridMounts[childStore]=()=>sectionGrid(app,root.querySelector(`[data-grid="${childStore}"]`),childStore,rows,{storageKey:`rec:${store}:${childStore}`});
 if(store==='fees')gridMounts.payments=()=>sectionGrid(app,root.querySelector('[data-grid="feePayments"]'),'feePayments',children.feePayments,{storageKey:`rec:${store}:payments`});
 gridMounts.activity=()=>sectionGrid(app,root.querySelector('[data-grid="activityLog"]'),'activityLog',activity.sort((a,b)=>String(b.timestamp).localeCompare(String(a.timestamp))),{storageKey:`rec:${store}:activity`});
 const sectionDefs=recordSectionsFor(store);
 const sectionCounts={quickNotes:quickNotes.length,activity:activity.length};
 if(store==='hearings')sectionCounts['hearing-cycle']=app.__rec.hearingSequence?.items.length||0;
 if(store==='serviceRecords')sectionCounts['service-cycle']=app.__rec.serviceSequence?.records.length||0;
 if(store==='cases'){
  sectionCounts['case-timeline']=app.__rec.caseTimeline?.timeline.length||0;
  for(const [childStore,rows] of Object.entries(children))sectionCounts[childStore]=rows.length;
 }
 if(store==='fees')sectionCounts.payments=children.feePayments.length;
 const tabSections=sectionDefs.map(section=>({...section,count:sectionCounts[section.id]??''}));
 bindRecordWorkspaceTabs(app,root,`rec:${store}`,`صفحة ${ENTITIES[store].label}`,tabSections,primaryRecordTabs(store,tabSections),{defaultTab:'data',onActivate:sectionId=>gridMounts[sectionId]?.()});
}
export function notFound(what){return `<div class="empty"><h3>${esc(what)} غير موجود</h3><p>ربما حُذف منطقيًا أو أن الرابط قديم.</p></div>`}
export {refLabel,routeFor,fmtDate};


function recordQuickNotesPanel(rows,store,id,pageId,active='data') {
 if(!NOTE_ENTITY_TYPES[store])return '';
 return `<section class="panel record-quick-notes record-tab-panel" ${recordPanelAttrs(pageId,'quickNotes',{active,count:rows?.length||0})} data-record-quick-notes data-collapse-id="record-quick-notes:${esc(store)}" data-collapse-default="open"><div class="panel-head"><h3>📝 ملاحظات سريعة مرتبطة</h3><button type="button" class="primary" data-record-quick-add>+ ملاحظة سريعة</button></div><p class="muted small">روابط تشغيلية فقط — لا تُنشئ حكمًا أو إجراءً ولا تنسخ بيانات هذا السجل.</p><div data-record-quick-list></div></section>`;
}
function bindRecordQuickNotes(root,rows,app,store,id,entityType) {
  const section=root.querySelector('[data-record-quick-notes]'); if(!section)return;
  const list=section.querySelector('[data-record-quick-list]'); list.replaceChildren();
  if(!rows?.length){const empty=document.createElement('p');empty.className='muted';empty.textContent='لا توجد ملاحظات سريعة مرتبطة.';list.append(empty)}
  (rows||[]).forEach(note=>{
    const article=document.createElement('article');article.className='qn-card';
    const head=document.createElement('div');head.className='qn-card-head';const title=document.createElement('button');title.type='button';title.className='qn-title';title.textContent=note.title||'ملاحظة بلا عنوان';title.onclick=()=>openQuickNoteEditor(app,note.id,{onSaved:()=>app.refresh()});const meta=document.createElement('span');meta.className='qn-meta';meta.textContent=`${note.lifecycle==='DONE'?'منجزة':'مفتوحة'} · ${note.priority||'NORMAL'}`;head.append(title,meta);article.append(head);
    const body=document.createElement('p');body.className='qn-body';body.textContent=note.content||'—';article.append(body);
    const action=document.createElement('button');action.type='button';action.className='ghost qn-action';action.textContent=note.lifecycle==='DONE'?'إعادة فتح':'إنجاز';action.onclick=async()=>{try{const service=await import('../services/quick-notes.js');await (note.lifecycle==='DONE'?service.reopenQuickNote:service.completeQuickNote)(app.office,note.id);await app.refresh()}catch(error){toast(userError(error),'error')}};article.append(action);list.append(article);
  });
  section.querySelector('[data-record-quick-add]').onclick=()=>openQuickNoteCapture(app,{context:[{entityType,entityId:id}],onSaved:()=>app.refresh()});
}
