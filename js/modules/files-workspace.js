// مساحة عمل الملفات — أربعة أقسام: الشريط العام (خارج هذه الوحدة) + شريط الصفحة + شريط الجدول + البيانات.
// لا تُنشئ محرك بيانات جديدًا: البحث والفلاتر والجدول تبقى عبر list-page + datagrid.
import {esc} from '../ui/dom.js';
import {icon} from '../ui/icons.js';
import {openPalette} from '../ui/palette.js';
import {openQuickAdd} from './quick-add.js';
import {openThemeMenuAt} from '../ui/theme-menu.js';
import {openWorkspaceMenu,closeWorkspaceMenu} from '../ui/workspace-menu.js';

const timeCount=st=>(st.preset&&st.preset!=='all'?1:0)+(st.chip&&st.chip!=='all'?1:0)+((st.from||st.to)&&st.preset==='custom'?0:0);

export function filesWorkspaceHtml({st,presets,chips,hasDate}){
 const q=esc(st.q||'');
 const chipsHtml=`<div class="list-status-chips" role="group" aria-label="حالات الملفات السريعة">${chips.map(([k,l])=>`<button type="button" class="chip${st.chip===k?' active':''}" data-file-chip="${k}" aria-pressed="${st.chip===k}">${esc(l)}</button>`).join('')}</div>`;
 const presetsHtml=hasDate?`<div class="preset-bar" role="group" aria-label="فترة تاريخ الفتح">${presets.map(([k,l])=>`<button type="button" class="chip${st.preset===k?' active':''}" data-preset="${k}">${esc(l)}</button>`).join('')}</div>
  <div class="custom-range"${st.preset==='custom'?'':' hidden'}><label>من<input type="date" id="list-from" value="${esc(st.from||'')}"></label><label>إلى<input type="date" id="list-to" value="${esc(st.to||'')}"></label><button type="button" class="ghost" data-range-apply>عرض</button></div>`:'';
 return `<div class="fw" data-files-workspace>
 <header class="fw-pagebar" data-fw-pagebar>
  <button type="button" class="primary fw-addfile" data-list-add title="إنشاء ملف قانوني جديد — نفس مسار الإنشاء المعتمد (تحقق وترقيم تلقائي وتنقّل)">${icon('plus')}<span class="fw-addfile-lbl">إضافة ملف جديد</span></button>
  <h2 class="fw-title">الملفات</h2>
  <button type="button" class="ghost icon-btn fw-icon" data-fw-search aria-label="بحث شامل" title="لوحة الأوامر — البحث الشامل">${icon('search')}</button>
  <button type="button" class="primary fw-quickadd" data-fw-quick-add title="إضافة سريعة لأي سجل">+ إضافة</button>
  <button type="button" class="ghost fw-back" data-fw-back title="رجوع">↩ <span class="fw-lbl">رجوع</span></button>
  <button type="button" class="ghost icon-btn fw-icon" data-fw-home aria-label="الرئيسية" title="الرئيسية">${icon('home')}</button>
  <button type="button" class="ghost fw-morebtn" data-fw-page-more aria-haspopup="true" aria-expanded="false">المزيد</button>
 </header>
 <div class="fw-panel" data-fw-panel="page-more" hidden role="menu" aria-label="المزيد">
  <button type="button" role="menuitem" data-fw-themes>${icon('palette')} الثيمات</button>
  <button type="button" role="menuitem" data-qa-custom>إجراءات الصف</button>
  <button type="button" role="menuitem" data-customize-page>تخصيص الصفحة</button>
 </div>
 <div class="fw-toolbar" role="toolbar" aria-label="أدوات جدول الملفات" data-fw-toolbar>
  <button type="button" class="ghost fw-tb-btn" data-fw-display aria-haspopup="true" aria-expanded="false">إعدادات العرض</button>
  <button type="button" class="ghost fw-tb-btn" data-fw-filters aria-haspopup="true" aria-expanded="false">الفلاتر <span class="fw-badge" data-fw-grid-count hidden></span></button>
  <button type="button" class="ghost fw-tb-btn" data-fw-time aria-haspopup="true" aria-expanded="false">فلاتر الوقت <span class="fw-badge" data-fw-time-count hidden></span></button>
  <input id="list-q" type="search" class="fw-search list-search" value="${q}" placeholder="بحث فوري في الملفات…" autocomplete="off" aria-label="بحث فوري في الملفات">
  <button type="button" class="ghost fw-tb-btn" data-fw-clear title="مسح بحث الصفحة وفلاتر الوقت وفلاتر الجدول — دون المساس بإعدادات العرض أو التحديد">مسح الفلاتر</button>
  <button type="button" class="ghost fw-tb-btn" data-fw-cards aria-pressed="false" title="تبديل جدول / بطاقات">بطاقات</button>
  <button type="button" class="ghost fw-tb-btn" data-fw-io aria-haspopup="true" aria-expanded="false">المزيد</button>
  <button type="button" class="ghost fw-tb-btn fw-sel-clear" data-fw-sel-clear hidden title="مسح تحديد الصفوف المحددة فقط — لا يمس البحث ولا الفلاتر ولا إعدادات العرض">${icon('x')}<span>مسح التحديد</span><span class="fw-badge" data-fw-sel-count hidden></span></button>
 </div>
 <div class="fw-panel fw-time-panel" data-fw-panel="time" hidden role="dialog" aria-label="فلاتر الوقت">
  <section class="fw-group"><h3>حالة الملف</h3>${chipsHtml}</section>
  ${hasDate?`<section class="fw-group"><h3>فترة تاريخ الفتح</h3><p class="muted small">تعمل مع البحث وفلاتر الجدول ولا تلغيها.</p>${presetsHtml}</section>`:''}
 </div>
 <div class="fw-strip">
  <span class="list-status muted small" aria-live="polite"></span>
  <span class="fw-sr" data-list-filter-count></span>
  <div class="list-filter-summary" id="list-filter-summary" aria-live="polite"></div>
 </div>
 <div id="list-grid" class="fw-grid" data-section-id="grid"></div>
</div>`;
}

export function paintFilesWorkspace(root,st,grid){
 if(!root?.querySelector?.('[data-files-workspace]'))return;
 grid=grid||root.querySelector('#list-grid')?.__grid||null;
 const nTime=timeCount(st);
 const timeBadge=root.querySelector('[data-fw-time-count]');
 if(timeBadge){timeBadge.textContent=nTime?String(nTime):'';timeBadge.hidden=!nTime}
 const ui=typeof grid?.getUi==='function'?grid.getUi():null;
 const nGrid=Number(ui?.filterCount||0);
 const gridBadge=root.querySelector('[data-fw-grid-count]');
 if(gridBadge){gridBadge.textContent=nGrid?String(nGrid):'';gridBadge.hidden=!nGrid}
 const nSel=Number(ui?.selected||0);
 const selBtn=root.querySelector('[data-fw-sel-clear]');
 if(selBtn){
  selBtn.hidden=!nSel;
  const cnt=selBtn.querySelector('[data-fw-sel-count]');
  if(cnt){cnt.textContent=nSel?String(nSel):'';cnt.hidden=!nSel}
  selBtn.setAttribute('aria-label',nSel?`مسح التحديد — ${nSel} صف محدد`:'مسح التحديد');
 }
 const cardsBtn=root.querySelector('[data-fw-cards]');
 if(cardsBtn){
  const cards=Boolean(ui?.cards);
  cardsBtn.textContent=cards?'جدول':'بطاقات';
  cardsBtn.setAttribute('aria-pressed',String(cards));
  cardsBtn.title=cards?'عرض جدول':'عرض بطاقات';
 }
 const nList=(String(st.q||'').trim()?1:0)+nTime+(st.status&&st.status!=='all'?1:0);
 const clearBtn=root.querySelector('[data-fw-clear]');
 if(clearBtn){
  const on=nList+nGrid>0;
  clearBtn.classList.toggle('is-active',on);
  clearBtn.disabled=false;
 }
}

export function bindFilesChrome(app,{root,st,getGrid,load,syncFilterSummary,saveListView}){
 if(!root?.querySelector?.('[data-files-workspace]'))return;
 const gridOf=()=>getGrid?.()||root.querySelector('#list-grid')?.__grid||null;
 const closeAll=()=>{closeWorkspaceMenu();document.querySelectorAll('.dg-pop .dg-x').forEach(x=>x.click())};
 const panel=name=>root.querySelector(`[data-fw-panel="${name}"]`);

 root.querySelector('[data-fw-search]')?.addEventListener('click',()=>{closeAll();openPalette(app)});
 root.querySelector('[data-fw-quick-add]')?.addEventListener('click',()=>{closeAll();openQuickAdd(app)});
 root.querySelector('[data-fw-back]')?.addEventListener('click',()=>{closeAll();app.back()});
 root.querySelector('[data-fw-home]')?.addEventListener('click',()=>{closeAll();app.go('dashboard')});

 root.querySelector('[data-fw-page-more]')?.addEventListener('click',e=>{
  const btn=e.currentTarget;
  // إغلاق قوائم الجدول العائمة حتى لا تتداخل طبقات القوائم فوق بعضها.
  document.querySelectorAll('.dg-pop .dg-x').forEach(x=>x.click());
  openWorkspaceMenu(btn,{el:panel('page-more'),width:240,role:'menu',label:'المزيد'});
 });
 root.querySelector('[data-fw-themes]')?.addEventListener('click',e=>{
  e.preventDefault();
  const more=root.querySelector('[data-fw-page-more]')||e.currentTarget;
  closeWorkspaceMenu();
  openThemeMenuAt(app,more);
 });
 // عناصر قائمة «المزيد» التي تفتح نافذة منبثقة (إجراءات الصف/تخصيص الصفحة):
 // أغلق القائمة أولًا وإلّا بقيت عائمة خلف النافذة وصار النقر التالي على زر «المزيد» إغلاقًا بدل فتح.
 root.querySelector('[data-fw-panel="page-more"]')?.addEventListener('click',e=>{
  if(e.target.closest('[data-qa-custom],[data-customize-page]'))closeWorkspaceMenu();
 });

 root.querySelector('[data-fw-time]')?.addEventListener('click',e=>{
  // لا تبقى قوائم الجدول (dg-pop) عائمة فوق لوحة الوقت أو حاجبة لزرها — تُغلق أولًا.
  document.querySelectorAll('.dg-pop .dg-x').forEach(x=>x.click());
  openWorkspaceMenu(e.currentTarget,{el:panel('time'),width:Math.min(520,window.innerWidth-16),role:'dialog',label:'فلاتر الوقت'});
 });
 root.querySelector('[data-fw-display]')?.addEventListener('click',e=>{
  closeWorkspaceMenu();
  gridOf()?.openDisplayMenu?.(e.currentTarget);
 });
 root.querySelector('[data-fw-filters]')?.addEventListener('click',e=>{
  closeWorkspaceMenu();
  gridOf()?.openFiltersMenu?.(e.currentTarget);
 });
 root.querySelector('[data-fw-io]')?.addEventListener('click',e=>{
  closeWorkspaceMenu();
  gridOf()?.openExportMenu?.(e.currentTarget);
 });
 root.querySelector('[data-fw-cards]')?.addEventListener('click',()=>{
  closeAll();
  const g=gridOf();
  if(!g)return;
  g.toggleCards();
  paintFilesWorkspace(root,st,g);
 });
 root.querySelector('[data-fw-sel-clear]')?.addEventListener('click',()=>{
  closeAll();
  const g=gridOf();
  if(!g)return;
  g.clearSelection();// يمسح التحديد الفعلي وحده: يحدّث الصفوف والعدّاد فورًا ولا يمس بحثًا ولا فلترًا
  paintFilesWorkspace(root,st,g);
 });
 root.querySelector('[data-fw-clear]')?.addEventListener('click',()=>{
  closeAll();
  st.q='';st.preset='all';st.from='';st.to='';st.chip='all';st.status='all';
  const q=root.querySelector('#list-q');if(q)q.value='';
  root.querySelectorAll('[data-preset]').forEach(x=>x.classList.toggle('active',x.dataset.preset==='all'));
  root.querySelectorAll('[data-file-chip]').forEach(x=>{const on=x.dataset.fileChip==='all';x.classList.toggle('active',on);x.setAttribute('aria-pressed',String(on))});
  const cr=root.querySelector('.custom-range');if(cr)cr.hidden=true;
  saveListView?.();
  syncFilterSummary?.();
  const g=gridOf();
  if(g?.clearQueryFilters)g.clearQueryFilters();
  else load?.();
  paintFilesWorkspace(root,st,g);
 });

 const onChrome=()=>paintFilesWorkspace(root,st,gridOf());
 root.addEventListener('click',e=>{
  if(e.target.closest('[data-preset],[data-file-chip],[data-range-apply],[data-fs-clear]')){
   setTimeout(onChrome,0);
  }
 });
 paintFilesWorkspace(root,st,gridOf());
 return {paint:onChrome};
}
