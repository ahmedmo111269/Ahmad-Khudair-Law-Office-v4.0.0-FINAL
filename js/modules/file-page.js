// صفحة الملف القانوني الداخلي (الوحدة الأساسية). الرقم الداخلي مستقل عن أي رقم قضائي، والملف قد لا يحتوي قضية أصلًا.
// التبويبات: ملخص، الأطراف، البيانات القضائية (المراحل/الأرقام)، الجلسات، الإجراءات، الأحكام، الملاحظات، العلاقات،
// بيانات إضافية (حسب النوع)، الأتعاب والمستندات، سجل النشاط.
import {linkedTasksPanelHtml,bindLinkedTasksPanel} from '../ui/work-links.js';
import {esc} from '../ui/dom.js';
import {toast} from '../ui/toast.js';
import {modal,closeModal,confirmBox} from '../ui/modal.js';
import {openEntityForm} from '../ui/form.js';
import {mountGrid} from '../ui/datagrid.js';
import {legalFileColumns} from '../ui/grid-columns.js';
import {createGridRelations} from '../services/grid-relations.js';
import {ENTITIES,FILE_TYPE_GROUPS,fileTypeGroup,label,fmtDate,isClosedFile,displayValue} from '../domain/entities.js';
import {resolveRefs,fileStages,fileChildren,refLabel} from '../services/entity-query.js';
import {fileParties,fileRelations,archiveFile,reopenFile,closeFile,removeParty,moveParty} from '../services/legal-files.js';
import {deleteEntity} from '../services/entity-save.js';
import {kvHtml,bindRefLinks,notFound} from './record-page.js';
import {sectionGrid,openRow} from './list-page.js';
import {userError} from '../core/errors.js';
import {localDate} from '../core/clock.js';
import {dateSignal,fileSignal} from '../ui/signals.js';
import {card,statusBadge,infoStack,detailsBlock} from '../ui/card.js';
import {bindCards} from '../ui/card.js';
import {isFavorite,toggleFavorite} from '../services/favorites.js';
import {hearingCycle} from '../services/operations.js';
import {taxonomy,saveFileMeta,reclassifyFile,fileAssets,ASSET_KINDS,saveAsset,linkAsset,unlinkAsset,findAssets,assetDetails} from '../services/client-files.js';
import {stagePathHtml,bindStagePath,metaInput,hydrateLookups} from './client-file.js';
import {renderFileServiceTab,bindFileServiceTab} from './service-records.js';
import {enhanceCollapsiblePanels} from '../ui/collapsible.js';
import {buildFileTimeline} from '../services/timeline.js';
import {timelineHtml,bindTimeline} from './timeline-view.js';
import {trackRecent} from '../services/recents.js';
import {formatFileNumber,fileNumberChip} from '../core/file-number.js';
import {registerPageLayout,resolveSectionOrder,hiddenSectionIds,migrateLegacySectionOrder,openPageCustomizer} from '../ui/page-layout.js';
import {notesForEntity,completeQuickNote,deleteQuickNote} from '../services/quick-notes.js';
import {openQuickNoteCapture,openQuickNoteEditor} from './quick-notes.js';

const TABS=[['summary','ملخص','◈'],['timeline','الخط الزمني','⏳'],['parties','الأطراف','⚖'],['judicial','البيانات القضائية','▣'],['hearings','الجلسات','◷'],['procedures','الأعمال الإدارية','☷'],['judgments','الأحكام','⚖'],['notes','الملاحظات','▤'],['relations','العلاقات','↔'],['serviceRecords','المحضرين والإعلانات','📬'],['typeData','بيانات نوع العمل','▧'],['assets','العقارات والمركبات','⌂'],['extra','بيانات إضافية (قديمة)','▤'],['money','الأتعاب والمستندات','＄'],['activity','سجل النشاط','≋']];
const BASE_KEYS=['fileNumber','title','fileType','mainCategory','subCategory','status','priority','openedAt','responsibleLawyer','coLawyers','staff','nextStep','nextStepDate','closedAt','closeReason','notes','lastActivityAt'];
// تبويبات الملف = أقسام صفحة في النظام المركزي الواحد (SectionLayoutManager):
// نفس التخزين ونفس نافذة «تخصيص الصفحة» لكل الصفحات — لا نظام ترتيب ثانٍ.
// الترتيب القديم في file-tabs:order يُرحَّل مرة واحدة إلى المخزن الموحّد.
registerPageLayout({pageId:'file-details',title:'أقسام الملف القانوني',sections:TABS.map(([id,title,icon])=>({id,title,icon,canHide:id!=='summary'}))});
function orderedFileTabs(){
 migrateLegacySectionOrder('file-details','file-tabs:order');
 const rank=new Map(resolveSectionOrder('file-details').map((k,i)=>[k,i]));
 return [...TABS].sort((a,b)=>(rank.get(a[0])??0)-(rank.get(b[0])??0));
}

export async function filePage(app,id){
 const f=await app.office.r.files.get(id);
 if(!f||f.isDeleted)return notFound('الملف');
 trackRecent('file:'+id,`${formatFileNumber(f.fileNumber)||'ملف'} — ${f.title||'بدون عنوان'}`.trim(),{icon:'folder',sub:f.title?'':'ملف قانوني',scope:app.ctx?.profile?.id||''});
 const [parties,stages,serviceCount]=await Promise.all([fileParties(app.office,id),fileStages(app.office,id),app.office.r.serviceRecords.countIndex('fileId_recordState',[id,'active'])]);
 const tax=await taxonomy(app.office);const cat=tax.byId.get(f.categoryId),ftype=tax.byId.get(f.fileTypeId);
 const cfRow=f.clientFileId?await app.office.r.clientFiles.get(f.clientFileId):null;
 app.__file={id,f,parties,stages,tax,serviceCount};
 app.__fileTab=app.__fileTab&&app.__fileTab.id===id?app.__fileTab:{id,tab:'summary'};
 // إذا أخفى المستخدم التبويب النشط من «تخصيص الصفحة»، نعود إلى الملخص (لا بيانات تُفقَد).
 if(hiddenSectionIds('file-details').has(app.__fileTab.tab))app.__fileTab.tab='summary';
 const clients=parties.filter(p=>p.partyKind==='client'),opps=parties.filter(p=>p.partyKind==='opponent');
 const cur=stages.find(s=>s.id===f.currentStageId)||stages.at(-1);
 return `${cfRow?`<nav class="crumbs" aria-label="المسار"><button class="link" data-route="client:${esc(cfRow.clientId)}">الموكل</button><span class="sep">‹</span><button class="link" data-route="cfile:${esc(cfRow.clientId)}">الملف الرئيسي ${esc(formatFileNumber(cfRow.clientCode))}</button>${cat?`<span class="sep">‹</span><button class="link" data-route="cfile:${esc(cfRow.clientId)}?cat=${esc(cat.id)}">${esc(cat.icon||'')} ${esc(cat.name)}</button>`:''}${ftype?`<span class="sep">‹</span><span>${esc(ftype.name)}</span>`:''}</nav>`:''}<div class="record-head file-head" style="--cat:${esc(cat?.color||'var(--primary)')}"><div><small class="muted">ملف فرعي — الرقم الداخلي للمكتب (مستقل عن أرقام القضايا الرسمية)</small><h2>${fileNumberChip(f)} ${esc(f.title||'')}</h2>
  <p class="badges">${cat?`<span class="badge type cat-badge">${esc(cat.icon||'')} ${esc(cat.name)}${ftype?' · '+esc(ftype.name):''}</span>`:f.fileType?`<span class="badge type">${esc(f.fileType)}</span>`:''}${f.needsClassification?'<button class="badge warn" data-reclass title="تم تصنيف الملف تلقائيًا من بيانات قديمة">⚠ راجع التصنيف</button>':''}<span class="badge ${isClosedFile(f)?'closed':'open'}">${esc(label(f.status||'open'))}</span>${f.isArchived?`<span class="badge warn">مؤرشف${f.archivedReason?' — '+esc(f.archivedReason):''}</span>`:''}${f.priority&&f.priority!=='normal'?`<span class="badge warn">${esc(label(f.priority))}</span>`:''}${f.responsibleLawyer?`<span class="badge">المحامي: ${esc(f.responsibleLawyer)}</span>`:''}</p>
  <p class="muted small">${clients.length?`الموكل: ${clients.map(p=>`${esc(p.name)} (${esc(p.role||'موكل')})`).join('، ')}`:'لا يوجد موكل مرتبط بعد'}${opps.length?` — الخصم: ${opps.map(p=>esc(p.name)).join('، ')}`:''}${cur?` — المرحلة الحالية: ${esc(refLabel('cases',cur))}`:' — لا توجد أرقام قضائية (ملف بلا قضية)'}</p></div>
  <div class="head-actions"><button class="ghost" data-file-task>+ مهمة</button><button class="ghost" data-file-pin aria-pressed="${isFavorite('file:'+id,app.ctx?.profile?.id||'')}">${isFavorite('file:'+id,app.ctx?.profile?.id||'')?'★ إلغاء التثبيت':'☆ تثبيت'}</button><button class="ghost" data-file-edit>تعديل البيانات</button><button class="ghost" data-reclass>تغيير القسم / النوع</button>${f.isArchived||isClosedFile(f)?'<button class="ghost" data-file-reopen>إعادة فتح</button>':'<button class="ghost" data-file-close>إنهاء الملف</button><button class="ghost" data-file-archive>أرشفة</button>'}</div></div>
 ${stagePathHtml(stages,f.currentStageId||cur?.id,id)}
 <nav class="tabs file-tabs" role="tablist" aria-label="أقسام الملف القانوني">${orderedFileTabs().map(([k,l,icon])=>{const count=k==='parties'?parties.length:k==='judicial'?stages.length:k==='serviceRecords'?serviceCount:null;return `<button type="button" role="tab" data-tab="${k}" data-section-id="${k}" title="${esc(l)}" aria-label="${esc(l)}${count!==null?` — ${count}`:''}" aria-selected="${app.__fileTab.tab===k}" class="${app.__fileTab.tab===k?'active':''}${count?' has-data':''}"><span class="tab-icon" aria-hidden="true">${icon}</span><span class="tab-label">${esc(l)}</span>${count!==null?` <small>${count}</small>`:''}</button>`}).join('')}</nav><div class="file-tab-controls"><button type="button" class="link" data-order-file-tabs title="ترتيب الأقسام وإظهارها وإعدادات العرض">⚙ تخصيص الصفحة</button></div>
 <div id="file-tab" role="tabpanel"></div>`;
}

export async function bindFilePage(app,id){
 const root=document.querySelector('#main-content');const {f}=app.__file;
 root.querySelector('[data-order-file-tabs]')?.addEventListener('click',()=>openPageCustomizer(app,{pageId:'file-details',root,onChanged:()=>{
  if(hiddenSectionIds('file-details').has(app.__fileTab.tab)){app.__fileTab.tab='summary';renderTab(app).catch(e=>app.fail(e))}
 }}));
 root.querySelector('[data-file-edit]').onclick=()=>openEntityForm(app,'files',{id});
 root.querySelector('[data-file-task]')?.addEventListener('click',async()=>{const {openLinkedTaskForm}=await import('../ui/work-actions.js');openLinkedTaskForm(app,'files',id,{onSaved:async()=>{toast('تمت إضافة المهمة المرتبطة');await app.refresh()}})});
 root.querySelector('[data-file-pin]')?.addEventListener('click',async e=>{
  const on=await toggleFavorite({route:'file:'+id,title:`${formatFileNumber(f.fileNumber)||'ملف'} — ${f.title||''}`.trim()},app.ctx?.profile?.id||'');
  e.currentTarget.textContent=on?'★ إلغاء التثبيت':'☆ تثبيت';
  e.currentTarget.setAttribute('aria-pressed',String(on));
  toast(on?'ثُبّت الملف في الرئيسية':'أُلغي التثبيت');
 });
 root.querySelector('[data-file-archive]')?.addEventListener('click',async()=>{const r=await confirmBox('أرشفة الملف؟ يبقى الملف وكل بياناته محفوظة ويمكن إعادة فتحه في أي وقت.',{okText:'أرشفة',input:true,placeholder:'سبب الأرشفة (اختياري)'});if(!r.ok)return;try{await archiveFile(app.office,id,r.value);toast('تمت الأرشفة');app.refresh()}catch(e){toast(userError(e),'error')}});
 root.querySelector('[data-file-reopen]')?.addEventListener('click',async()=>{const r=await confirmBox('إعادة فتح الملف؟',{okText:'إعادة فتح',input:true,placeholder:'سبب إعادة الفتح (اختياري)'});if(!r.ok)return;try{await reopenFile(app.office,id,r.value);toast('تمت إعادة فتح الملف');app.refresh()}catch(e){toast(userError(e),'error')}});
 root.querySelector('[data-file-close]')?.addEventListener('click',async()=>{const r=await confirmBox('تسجيل انتهاء الملف (حالة إدارية فقط)؟',{okText:'إنهاء',input:true,placeholder:'سبب الانتهاء (اختياري)'});if(!r.ok)return;try{await closeFile(app.office,id,{closeReason:r.value});toast('تم تسجيل انتهاء الملف');app.refresh()}catch(e){toast(userError(e),'error')}});
 root.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{app.__fileTab.tab=b.dataset.tab;root.querySelectorAll('[data-tab]').forEach(x=>{x.classList.toggle('active',x===b);x.setAttribute('aria-selected',x===b)});renderTab(app).catch(e=>app.fail(e))});
 bindStagePath(app,f,app.__file.stages);
 root.querySelectorAll('[data-reclass]').forEach(b=>b.onclick=()=>reclassDialog(app,f));
 await renderTab(app);
}

const reload=app=>app.refresh();
const stageOptions=stages=>stages.map(s=>({id:s.id,label:refLabel('cases',s)}));
async function showHearingCycle(app,hearingId){
 if(!hearingId){toast('لا توجد جلسة لعرض دورتها.','error');return}
 try{
  const cycle=await hearingCycle(app.office,hearingId);
  const card=modal(`<h2 class="modal-title">دورة الجلسات</h2><p class="muted small">تسلسل تنظيمي مبني على روابط الجلسات المسجلة، ولا يستنتج إجراءً قانونيًا.</p>${cycle.hasBranches?'<div class="notice">توجد أكثر من جلسة تالية في بعض أجزاء السلسلة؛ عُرضت الفروع كما سُجلت.</div>':''}<ol class="hearing-cycle">${cycle.items.map((h,i)=>`<li style="--depth:${Math.min(6,h.__depth||0)}"><button type="button" data-hearing="${esc(h.id)}"><time>${fmtDate(h.hearingDate)||'بدون تاريخ'}${h.hearingTime?' '+esc(h.hearingTime):''}</time><b>${esc(h.type||'جلسة')}${h.generatedFromAdjournment?' · منشأة من التأجيل':''}</b><small>${esc(h.court||'')}${h.chamber?' · '+esc(h.chamber):''}${h.result?' — '+esc(h.result):h.adjournedTo?' — تأجيل إلى '+fmtDate(h.adjournedTo):''}</small></button>${i<cycle.items.length-1?'<span class="cycle-arrow" aria-hidden="true">↓</span>':''}</li>`).join('')||'<li class="muted">لا توجد جلسات في هذه الدورة.</li>'}</ol>`);
  card.querySelectorAll('[data-hearing]').forEach(b=>b.onclick=()=>{closeModal();app.go('rec:hearings:'+b.dataset.hearing)});
 }catch(err){toast(userError(err),'error')}
}
function partyGroupsHtml(parties){
 const groups=new Map();
 for(const p of parties){const name=String(p.roleGroup||p.role||'أطراف أخرى');if(!groups.has(name))groups.set(name,[]);groups.get(name).push(p)}
 const ordered=[...groups.entries()].sort((a,b)=>a[0].localeCompare(b[0],'ar'));
 return ordered.map(([group,rows])=>{
  rows.sort((a,b)=>(Number(a.sequence)||Number.MAX_SAFE_INTEGER)-(Number(b.sequence)||Number.MAX_SAFE_INTEGER)||String(a.createdAt||'').localeCompare(String(b.createdAt||''))||String(a.name||'').localeCompare(String(b.name||''),'ar'));
  return `<details class="party-group" open><summary><span>${esc(group)}</span><span class="count">${rows.length}</span></summary><ol class="party-list">${rows.map((p,i)=>`<li class="party-item${p.isActive===false?' is-inactive':''}" data-party="${esc(p.id||'')}"><span class="party-sequence">${i+1}</span><div class="party-main"><b>${esc(p.partyName||p.name||'طرف')}</b><div class="party-badges"><span class="badge type">${esc(p.role||'طرف')}</span>${(p.isClient??p.partyKind==='client')?'<span class="badge open">موكل المكتب</span>':''}${p.isPrimary?'<span class="badge">طرف أساسي</span>':''}${p.isActive===false?'<span class="badge warn">غير نشط</span>':''}</div>${p.notes?`<small>${esc(p.notes)}</small>`:''}</div><div class="party-actions"><button type="button" class="link" data-party-move="-1" data-id="${esc(p.id||'')}" ${!p.id||i===0?'disabled':''} aria-label="تقديم الطرف">▲</button><button type="button" class="link" data-party-move="1" data-id="${esc(p.id||'')}" ${!p.id||i===rows.length-1?'disabled':''} aria-label="تأخير الطرف">▼</button><button type="button" class="ghost small" data-party-edit="${esc(p.id||'')}" data-client="${esc(p.clientId||'')}" data-kind="${esc(p.partyKind||'other')}" data-name="${esc(p.partyName||p.name||'')}" data-role="${esc(p.role||'')}" data-group="${esc(p.roleGroup||group)}" data-sequence="${Number(p.sequence)||i+1}">تعديل</button><button type="button" class="link danger" data-party-remove="${esc(p.id||'')}" ${p.id?'':'disabled'}>إزالة</button></div></li>`).join('')}</ol></details>`;
 }).join('')||'<div class="empty"><h3>لا توجد أطراف مسجلة لهذا الملف.</h3><p>أضف موكلًا مسجلًا أو طرفًا خارجيًا، ثم حدّد صفته ومجموعة عرضه.</p></div>';
}

async function renderTab(app){
 await renderTabContent(app);
 const el=document.querySelector('#file-tab');
 if(app.__fileTab.tab==='summary'&&el){
  const html=await linkedTasksPanelHtml(app.office,{fileId:app.__file.id},{title:'مهام الملف',collapseId:'file-work',centerRoute:`actionCenter?fileId=${encodeURIComponent(app.__file.id)}`});
  el.insertAdjacentHTML('beforeend',html);
  bindLinkedTasksPanel(app,el,{relatedType:'files',relatedId:app.__file.id});
 }
 const main=document.querySelector('#main-content');
 enhanceCollapsiblePanels(main,`file:${app.__file.id}:${app.__fileTab.tab}`);
 bindCards(el);
}
async function renderTabContent(app){
 const el=document.querySelector('#file-tab');const {id,f,parties,stages}=app.__file;const tab=app.__fileTab.tab;const office=app.office;
 el.innerHTML='<div class="skel-page" role="status" aria-label="جارٍ التحميل"><div class="skel skel-row"><div class="skel-card skel"></div><div class="skel-card skel"></div><div class="skel-card skel"></div><div class="skel-card skel"></div></div><div class="skel skel-block"></div></div>';
 const needStage=what=>`<div class="notice">لإضافة ${what} يجب أولًا إضافة رقم قضائي / مرحلة في تبويب «البيانات القضائية». الملف نفسه لا يحتاج قضية.</div>`;
 if(tab==='summary'){
  const today=localDate();
  const [hearingResult,procedures]=await Promise.all([fileChildren(office,id,'hearings'),office.r.procedures.byIndex('fileId',id,2000)]);
  const hearings=hearingResult.rows;
  const upcoming=hearings.filter(h=>h.hearingDate>=today).sort((a,b)=>String(a.hearingDate||'').localeCompare(String(b.hearingDate||''))||String(a.hearingTime||'').localeCompare(String(b.hearingTime||''))).slice(0,2);
  const last=hearings.filter(h=>h.hearingDate<today).sort((a,b)=>String(b.hearingDate||'').localeCompare(String(a.hearingDate||'')))[0];
  const openProc=procedures.filter(p=>!p.status||['open','pending'].includes(p.status));
  const refs=new Map();
  const cur=stages.find(s=>s.id===f.currentStageId)||stages.at(-1);
  const nextH=upcoming[0];
  const sig=nextH?dateSignal(nextH.hearingDate):null;
  const fsig=fileSignal(f);
  const clientParty=parties.find(p=>p.clientId);
  const snap=card({icon:'folder',title:f.title||'ملف',size:'full',collapsible:true,persistKey:'file:snap:'+id,pageId:'file-details',badge:statusBadge(fsig?.text||label(f.status||'نشط'),fsig?.tone||'ok'),
   body:infoStack([
    {k:'رقم الملف',v:formatFileNumber(f.fileNumber)||'—',sub:f.fileType||''},
    {k:'الموكل',v:clientParty?.name||clientParty?.partyName||'غير مرتبط',sub:clientParty?.role||''},
    {k:'المرحلة الحالية',v:cur?refLabel('cases',cur):'بلا رقم قضائي'},
    nextH?{k:'الجلسة القادمة',v:`${fmtDate(nextH.hearingDate)} — ${nextH.hearingTime||'بدون وقت'}`,sub:[nextH.court,nextH.chamber].filter(Boolean).join(' · '),tone:sig?.tone||''}: {k:'الجلسة القادمة',v:'لا توجد جلسة قادمة'},
    {k:'الحالة',html:statusBadge(fsig?.text||label(f.status||'نشط'),fsig?.tone||'ok')+(sig?statusBadge(sig.text==='اليوم'?'جلسة اليوم':sig.text==='غدًا'?'جلسة غدًا':'جلسة '+sig.text,sig.tone):'')+(openProc.length?statusBadge(`${openProc.length} عمل مطلوب`,'warn'):'')}
   ])+`<div class="snap-actions"><button type="button" class="ghost small" data-tab-jump="hearings">الجلسات</button><button type="button" class="ghost small" data-tab-jump="procedures">الأعمال</button><button type="button" class="ghost small" data-tab-jump="relations">العلاقات</button>${clientParty?.clientId?`<button type="button" class="ghost small" data-route="client:${esc(clientParty.clientId)}">فتح الموكل</button>`:''}</div>`+detailsBlock('عرض التفاصيل الإضافية',`<p class="muted small">الأطراف ${parties.length} · المراحل ${stages.length} · الأعمال المفتوحة ${openProc.length}${last?` · آخر جلسة ${fmtDate(last.hearingDate)}`:''}</p>`)
  });
  el.innerHTML=`${snap}<section class="panel file-stats-panel" data-collapse-id="file-summary-stats"><div class="panel-head"><h3>ملخص الملف</h3><span class="badge">4 مؤشرات</span></div><div class="stats-grid"><div class="stat-card"><strong>${stages.length}${stages.length>=500?'+':''}</strong><span>أرقام / مراحل</span></div><div class="stat-card"><strong>${hearings.length}${hearingResult.more?'+':''}</strong><span>جلسات</span></div><div class="stat-card"><strong>${openProc.length}</strong><span>أعمال مفتوحة</span></div><div class="stat-card"><strong>${parties.length}</strong><span>أطراف</span></div></div></section>
   ${hearingResult.more?'<div class="notice" role="status">تعرض هذه الصفحة حتى 5,000 جلسة مرتبطة بالملف. قد توجد سجلات إضافية؛ لم تُحذف أو تُغيّر أي بيانات.</div>':''}
   <div class="grid2 file-hearing-cards"><section class="panel"><div class="panel-head"><h3>الجلسات القادمة</h3><span class="badge">${upcoming.length} / 2</span></div>${upcoming.map((h,i)=>{const hs=dateSignal(h.hearingDate);return `<button class="hearing-preview" data-open="hearings:${esc(h.id)}"><span class="hearing-order">${i+1}</span><span><b>${fmtDate(h.hearingDate)}</b> ${esc(h.hearingTime||'')}${hs?` <span class="ux-badge ux-badge--${hs.tone}">${hs.text==='اليوم'?'جلسة اليوم':hs.text==='غدًا'?'جلسة غدًا':'جلسة '+esc(hs.text)}</span>`:''}<small>${esc(h.court||'')}${h.chamber?' · '+esc(h.chamber):''}${h.reason?' — '+esc(h.reason):''}</small></span><span aria-hidden="true">↗</span></button>`}).join('')||'<p class="muted empty-inline">لا توجد جلسات قادمة مسجلة.</p>'}</section>
   <section class="panel"><div class="panel-head"><h3>الجلسة السابقة</h3></div>${last?`<button class="hearing-preview" data-open="hearings:${esc(last.id)}"><span class="hearing-order">‹</span><span><b>${fmtDate(last.hearingDate)}</b><small>${esc(last.result||'لم يُسجل القرار')}${last.adjournedTo?' — التأجيل إلى '+fmtDate(last.adjournedTo):''}</small></span><span aria-hidden="true">↗</span></button>`:'<p class="muted empty-inline">لا توجد جلسات سابقة مسجلة.</p>'}<button class="ghost small" data-show-hearing-cycle>عرض دورة الجلسات</button></section></div>
   ${stages.length?`<section class="panel"><h3>تسلسل المراحل</h3><ol class="stage-chain">${stages.map(s=>`<li><button class="link" data-open-case="${s.id}">${esc(s.stageType||s.numberType||'مرحلة')}<br><small>${esc(s.caseNumber||'بدون رقم')}${s.caseYear?'/'+esc(s.caseYear):''}</small></button></li>`).join('')}</ol></section>`:''}
   <section class="panel"><div class="panel-head"><h3>البيانات الأساسية</h3><button class="ghost" data-file-edit2>تعديل</button></div>${detailsBlock('عرض كل الحقول',kvHtml(ENTITIES.files.fields.filter(x=>BASE_KEYS.includes(x.k)),f,refs)+(f.archivedAt?`<p class="muted small">أُرشف في ${fmtDate(f.archivedAt)}${f.archivedReason?' — السبب: '+esc(f.archivedReason):''}</p>`:'')+(f.reopenedAt?`<p class="muted small">أُعيد فتحه في ${fmtDate(f.reopenedAt)}${f.reopenReason?' — '+esc(f.reopenReason):''}</p>`:''))}</section>
   <div class="sec-actions"><button class="ghost danger" data-file-delete>حذف منطقي للملف</button></div>`;
  el.querySelector('[data-file-edit2]').onclick=()=>openEntityForm(app,'files',{id});
  el.querySelectorAll('[data-tab-jump]').forEach(b=>b.onclick=()=>{app.__fileTab.tab=b.dataset.tabJump;renderTab(app).catch(e=>app.fail(e))});
  el.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>app.go('rec:'+b.dataset.open));
  el.querySelectorAll('[data-open-case]').forEach(b=>b.onclick=()=>app.go('case:'+b.dataset.openCase));
  el.querySelector('[data-show-hearing-cycle]')?.addEventListener('click',()=>showHearingCycle(app,upcoming[0]?.id||last?.id||''));
  el.querySelector('[data-file-delete]').onclick=async()=>{if(!await confirmBox('حذف منطقي للملف؟ لا يُسمح إذا كان للملف قضايا/مراحل غير محذوفة. البيانات لا تُمحى نهائيًا.',{okText:'حذف منطقي'}))return;try{await deleteEntity(office,'files',id);toast('تم الحذف المنطقي');app.go('files')}catch(e){toast(userError(e),'error')}};
  return;
 }
 if(tab==='timeline'){
  try{
   const t=await buildFileTimeline(office,id);
   el.innerHTML=`<section class="panel tl-panel"><div class="panel-head"><h3>الخط الزمني الموحد للملف</h3><span class="muted small">كل ما جرى في هذا الملف: جلسات، أحكام، أعمال، مواعيد، اتصالات، ملاحظات، مستندات، أتعاب — بتسلسل واحد.</span></div>${timelineHtml(t)}</section>`;
   bindTimeline(el,{onOpen:r=>app.go(r.startsWith('rec:')?r:'rec:'+r)});
  }catch(err){el.innerHTML=`<div class="error-box" role="alert"><h2>تعذر بناء الخط الزمني</h2><p>${esc(userError(err))}</p></div>`}
  return;
 }
 if(tab==='parties'){
  const active=parties.filter(p=>p.isActive!==false).length;
  el.innerHTML=`<div class="party-toolbar"><div><h3>الأطراف <span class="count">${parties.length}</span></h3><p class="muted small">الأطراف مجمّعة حسب الصفة/المجموعة. رتّبها بأزرار التحريك؛ الموكل المسجل يبقى مرتبطًا بسجله دون نسخ بياناته.</p></div><button class="primary" data-add-party>+ إضافة طرف</button></div><div class="party-summary"><span>الإجمالي: <b>${parties.length}</b></span><span>نشط: <b>${active}</b></span><span>موكل المكتب: <b>${parties.filter(p=>p.isClient??p.partyKind==='client').length}</b></span></div><div class="party-groups">${partyGroupsHtml(parties)}</div>`;
  el.querySelector('[data-add-party]').onclick=()=>openEntityForm(app,'fileParties',{preset:{fileId:id},onSaved:()=>reload(app)});
  el.querySelectorAll('[data-party-edit]').forEach(b=>b.onclick=()=>{
   const partyId=b.dataset.partyEdit;
   if(partyId)openEntityForm(app,'fileParties',{id:partyId,onSaved:()=>reload(app)});
   else openEntityForm(app,'fileParties',{title:'إضافة رابط طرف قديم إلى إدارة الأطراف',preset:{fileId:id,partyKind:b.dataset.kind||'client',clientId:b.dataset.client||'',name:b.dataset.name||'',role:b.dataset.role||'',roleGroup:b.dataset.group||'',sequence:Number(b.dataset.sequence)||1},onSaved:()=>reload(app)});
  });
  el.querySelectorAll('[data-party-move]').forEach(b=>b.onclick=async()=>{try{await moveParty(office,b.dataset.id,Number(b.dataset.partyMove));toast('تم تحديث ترتيب الأطراف');reload(app)}catch(err){toast(userError(err),'error')}});
  el.querySelectorAll('[data-party-remove]').forEach(b=>b.onclick=async()=>{const p=parties.find(x=>x.id===b.dataset.partyRemove);if(!p)return;if(!await confirmBox(`إزالة «${esc(p.partyName||p.name)}» من هذا الملف فقط؟ سيظل سجل الموكل/الشخص محفوظًا.`,{okText:'إزالة الطرف'}))return;try{await removeParty(office,p.id);toast('تمت إزالة الطرف');reload(app)}catch(err){toast(userError(err),'error')}});
  return;
 }
 if(tab==='judicial'){
  el.innerHTML=`<div class="sec-actions"><button class="primary" data-add-stage>+ رقم قضائي / مرحلة</button><span class="muted small">مثال: محضر ← تحقيق ← جنحة ← استئناف داخل نفس الملف. كل مرحلة لها نوع رقم ورقم وسنة ومحكمة ودائرة ودرجة.</span></div>${stages.length?`<ol class="stage-chain">${stages.map(s=>`<li><button class="link" data-open-case="${s.id}">${esc(s.stageType||s.numberType||'مرحلة')}<br><small>${esc(s.caseNumber||'بدون رقم')}${s.caseYear?'/'+esc(s.caseYear):''}</small></button></li>`).join('')}</ol>`:''}<div data-grid></div>`;
  const clientRole=parties.find(p=>p.partyKind==='client')?.role||'';
  el.querySelector('[data-add-stage]').onclick=()=>openEntityForm(app,'cases',{preset:{fileId:id,stageOrder:stages.length+1,clientCapacity:clientRole},title:'إضافة رقم قضائي / مرحلة',onSaved:()=>reload(app)});
  el.querySelectorAll('[data-open-case]').forEach(b=>b.onclick=()=>app.go('case:'+b.dataset.openCase));
  await sectionGrid(app,el.querySelector('[data-grid]'),'cases',stages,{storageKey:'file:stages'});
  return;
 }
 if(tab==='hearings'||tab==='judgments'){
  const store=tab,childResult=await fileChildren(office,id,store),rows=childResult.rows;
  const what=store==='hearings'?'جلسة':'حكم';
  const limitNotice=childResult.more?'<div class="notice" role="status">تعرض الصفحة حتى 5,000 سجل مرتبط؛ قد توجد سجلات إضافية. لم تُحذف أو تُغيّر أي بيانات.</div>':'';
  el.innerHTML=stages.length?`${limitNotice}<div class="sec-actions"><button class="primary" data-add>+ ${what}</button>${store==='hearings'?'<button class="ghost" data-hearing-cycle>عرض دورة الجلسات</button>':''}</div><div data-grid></div>`:`${needStage(what)}${limitNotice}<div data-grid></div>`;
  el.querySelector('[data-add]')?.addEventListener('click',()=>{const cur=stages.at(-1);openEntityForm(app,store,{stageOptions:stageOptions(stages),preset:{caseId:cur?.id||'',...(store==='hearings'?{fileId:id,court:cur?.courtId||'',chamber:cur?.chamber||''}:{fileId:id,court:cur?.courtId||'',chamber:cur?.chamber||'',stage:cur?.stageType||''})},onSaved:()=>reload(app)})});
  el.querySelector('[data-hearing-cycle]')?.addEventListener('click',()=>showHearingCycle(app,rows[0]?.id||''));
  rows.sort((a,b)=>String(b[store==='hearings'?'hearingDate':'judgmentDate']||'').localeCompare(String(a[store==='hearings'?'hearingDate':'judgmentDate']||'')));
  await sectionGrid(app,el.querySelector('[data-grid]'),store,rows,{storageKey:'file:'+store});
  return;
 }
 if(tab==='procedures'){
  const rows=(await office.r.procedures.byIndex('fileId',id,2000)).sort((a,b)=>String(b.actionDate||b.internalDueDate||b.createdAt).localeCompare(String(a.actionDate||a.internalDueDate||a.createdAt)));
  el.innerHTML=`<div class="sec-actions"><button class="primary" data-add>+ إجراء / عمل إداري</button><span class="muted small">الإجراءات مستقلة عن المراحل وعن الملف، ويمكن ربطها بمرحلة اختياريًا.</span></div>
   <ol class="timeline">${rows.slice(0,60).map(p=>`<li data-open="${p.id}"><time>${fmtDate(p.actionDate||p.internalDueDate)||'—'}</time><div><b>${esc(p.type||'إجراء')}</b> ${esc(p.description||'')}<small class="muted"> ${esc(label(p.status||''))}${p.result?' — '+esc(p.result):''}</small></div></li>`).join('')||'<li class="muted">لا توجد إجراءات مسجلة.</li>'}</ol>
   <details class="rec-section"><summary>عرض جدول الإجراءات</summary><div data-grid></div></details>`;
  el.querySelector('[data-add]').onclick=()=>openEntityForm(app,'procedures',{preset:{fileId:id},stageOptions:stageOptions(stages),onSaved:()=>reload(app)});
  el.querySelectorAll('.timeline [data-open]').forEach(li=>li.onclick=()=>app.go('rec:procedures:'+li.dataset.open));
  await sectionGrid(app,el.querySelector('[data-grid]'),'procedures',rows,{storageKey:'file:procedures'});
  return;
 }
 if(tab==='notes'){
  // caseNotes remains the canonical store: historical rows and new Quick Notes are
  // rendered together through the same operational panel, not as a second Notes UI.
  const rows=(await notesForEntity(office,'LEGAL_FILE',id,{limit:100})).sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
  el.innerHTML=`<section class="panel file-quick-notes" data-collapse-default="open"><div class="panel-head"><h3>📝 الملاحظات السريعة المرتبطة</h3><div class="sec-actions"><button class="primary" data-quick-file-add>+ ملاحظة سريعة</button></div></div><p class="muted small">ملاحظات تشغيلية مستقلة عن الحكم أو الإجراء. السجلات التاريخية محفوظة في caseNotes وتظهر هنا دون نسخ أو حذف.</p><div data-quick-file-list></div></section>`;
  renderFileQuickNotes(el.querySelector('[data-quick-file-list]'),rows,app,id);
  el.querySelector('[data-quick-file-add]').onclick=()=>openQuickNoteCapture(app,{context:[{entityType:'LEGAL_FILE',entityId:id}],onSaved:()=>reload(app)});
  return;
 }
 if(tab==='serviceRecords'){
  el.innerHTML=await renderFileServiceTab(app,f,stages);
  await bindFileServiceTab(app,f,stages,parties);
  return;
 }
 if(tab==='relations'){
  const rels=await fileRelations(office,id);
  const rows=rels.map(r=>({...r,dirLabel:r.direction==='out'?'هذا الملف ←':'← من ملف آخر'}));
  const relations=createGridRelations(office,'fileRelations');await relations.hydrate(rows);
  el.innerHTML=`<div class="sec-actions"><button class="primary" data-add>+ ربط بملف آخر</button><span class="muted small">مثال: ملف استئناف مرتبط بملف الدعوى الأصلية، أو ملف تنفيذ لحكم.</span></div><div data-grid></div>`;
  el.querySelector('[data-add]').onclick=()=>openEntityForm(app,'fileRelations',{preset:{sourceFileId:id},onSaved:()=>reload(app)});
  mountGrid(el.querySelector('[data-grid]'),{title:'علاقات الملف',storageKey:'file:relations',collapseKey:`file:${id}:relations-grid`,rows,...relations.gridOptions({fileId:id}),columns:[
   ...legalFileColumns(relations,{side:'other',fileKey:'otherLabel',fileTitle:'رقم الملف المرتبط / نوعه'}),
   {key:'dirLabel',label:'الاتجاه'},{key:'relationType',label:'نوع العلاقة'},{key:'notes',label:'ملاحظات'},{key:'createdAt',label:'تاريخ الربط',type:'date',text:r=>fmtDate(r.createdAt)}],
   onRowClick:r=>relationActions(app,r)});
  return;
 }
 if(tab==='typeData'){
  const {tax}=app.__file;const t=tax.byId.get(f.fileTypeId);const fields=t?.fields||[];
  if(!fields.length){el.innerHTML=`<div class="notice">${t?'لا توجد حقول خاصة لهذا النوع. يمكنك إضافة حقول من الإعدادات ← الأقسام وأنواع الأعمال.':'حدد نوع العمل أولًا من «تغيير القسم / النوع».'}</div>`;return}
  el.innerHTML=`<section class="panel"><div class="panel-head"><h3>بيانات ${esc(t.name)}</h3><span class="muted small">كل الحقول اختيارية</span></div><form class="entity-form" id="meta-form"><div class="form-grid">${fields.map(x=>metaInput(x,f['x_'+x.k])).join('')}</div><div class="form-actions"><button class="primary">حفظ</button></div></form></section>`;
  await hydrateLookups(app,el);
  el.querySelector('#meta-form').onsubmit=async e=>{e.preventDefault();const v={};el.querySelectorAll('[data-meta]').forEach(i=>v[i.dataset.meta]=i.value);try{await saveFileMeta(office,id,v);toast('تم الحفظ');reload(app)}catch(err){toast(userError(err),'error')}};
  return;
 }
 if(tab==='assets'){
  const rows=await fileAssets(office,id);
  el.innerHTML=`<div class="sec-actions">${Object.entries(ASSET_KINDS).map(([k,d])=>`<button class="ghost" data-new-asset="${k}">+ ${esc(d.label)}</button>`).join('')}<button class="ghost" data-link-asset>ربط أصل مسجل</button><span class="muted small">عقار أو مركبة أو جهة يمكن ربطها بأكثر من ملف دون تكرار بياناتها.</span></div>
   <div class="asset-list">${rows.map(({link,asset:a})=>`<article class="lf-card"><header><span>${esc(ASSET_KINDS[a.kind]?.icon||'📎')}</span><div><b>${esc(a.name||'')}</b><small>${esc(ASSET_KINDS[a.kind]?.label||'')}${link.role?' · '+esc(link.role):''}</small></div><button class="link danger" data-unlink="${esc(a.id)}">إلغاء الربط</button></header>${assetDetails(a)?`<p class="small muted">${esc(assetDetails(a))}</p>`:''}</article>`).join('')||'<p class="muted">لا توجد أصول مرتبطة.</p>'}</div>`;
  el.querySelectorAll('[data-new-asset]').forEach(b=>b.onclick=()=>assetDialog(app,id,b.dataset.newAsset));
  el.querySelector('[data-link-asset]').onclick=()=>linkAssetDialog(app,id);
  el.querySelectorAll('[data-unlink]').forEach(b=>b.onclick=async()=>{if(!await confirmBox('إلغاء ربط الأصل بهذا الملف؟ (بيانات الأصل لا تُحذف)',{okText:'إلغاء الربط'}))return;await unlinkAsset(office,id,b.dataset.unlink);reload(app)});
  return;
 }
 if(tab==='extra'){
  const g=fileTypeGroup(f.fileType);const def=FILE_TYPE_GROUPS[g];
  const otherData=Object.entries(FILE_TYPE_GROUPS).filter(([k])=>k!==g).map(([,d])=>({d,html:kvHtml(d.fields,f,new Map())})).filter(x=>!x.html.includes('class="muted"'));
  el.innerHTML=`<section class="panel"><div class="panel-head"><h3>${esc(def?.label||'بيانات حسب نوع الملف')}</h3><button class="primary" data-edit-extra>تعديل</button></div>${def?kvHtml(def.fields,f,new Map()):'<p class="muted">حدد نوع الملف من «تعديل البيانات» لتظهر الحقول الخاصة به.</p>'}</section>
   ${otherData.map(x=>`<section class="panel"><h3>${esc(x.d.label)} <small class="muted">(من نوع سابق — محفوظة ولم تُحذف)</small></h3>${x.html}</section>`).join('')}`;
  el.querySelector('[data-edit-extra]').onclick=()=>openEntityForm(app,'files',{id,typeFieldsOnly:true,title:'تعديل البيانات حسب نوع الملف'});
  return;
 }
 if(tab==='money'){
  const [fees,docs,poas,appts,comms]=await Promise.all([office.r.fees.byIndex('fileId',id,1000),office.r.documentReferences.byIndex('fileId',id,1000),office.r.powersOfAttorney.byIndex('fileId',id,1000),office.r.appointments.byIndex('fileId',id,1000),office.r.communications.byIndex('fileId',id,1000)]);
  const blocks=[['fees','الأتعاب',fees],['documentReferences','المستندات',docs],['powersOfAttorney','التوكيلات المرتبطة',poas],['appointments','المواعيد',appts],['communications','الاتصالات',comms]];
  el.innerHTML=blocks.map(([s,l,rows])=>`<details class="rec-section" ${rows.length?'open':''}><summary><span>${l}</span><span class="count">${rows.length}</span></summary><div class="sec-actions"><button class="ghost" data-add="${s}">+ إضافة</button></div><div data-grid="${s}"></div></details>`).join('');
  const client=parties.find(p=>p.clientId)?.clientId||'';
  el.querySelectorAll('[data-add]').forEach(b=>b.onclick=()=>openEntityForm(app,b.dataset.add,{preset:{fileId:id,...(['powersOfAttorney','appointments','communications'].includes(b.dataset.add)&&client?{clientId:client}:{})},onSaved:()=>reload(app)}));
  await Promise.all(blocks.map(([s,,rows])=>sectionGrid(app,el.querySelector(`[data-grid="${s}"]`),s,rows,{storageKey:'file:'+s})));
  return;
 }
 if(tab==='activity'){
  const [a,b]=await Promise.all([office.r.activityLog.byIndex('fileId',id,2000),office.r.activityLog.byIndex('entityId',id,500)]);
  const rows=[...new Map([...a,...b].map(x=>[x.id,x])).values()].sort((x,y)=>String(y.timestamp).localeCompare(String(x.timestamp)));
  el.innerHTML='<div data-grid></div>';
  await sectionGrid(app,el.querySelector('[data-grid]'),'activityLog',rows,{title:`سجل نشاط الملف ${formatFileNumber(f.fileNumber)}`,storageKey:'file:activity',collapseKey:`file:${id}:activity-grid`});
 }
}

function partyActions(app,p){
 const route=p.clientId?'client:'+p.clientId:p.opponentId?'opponent:'+p.opponentId:null;
 const card=modal(`<h2 class="modal-title">${esc(p.name)} <small class="muted">${esc(p.role||'')}</small></h2><div class="action-stack">${route?'<button class="primary" data-a="open">فتح سجل الشخص</button>':''}${p.id?'<button class="ghost" data-a="edit">تعديل الصفة / البيانات</button><button class="ghost danger" data-a="remove">إزالة من الملف</button>':'<p class="muted">رابط قديم من الإصدار السابق؛ سيُرحّل تلقائيًا.</p>'}</div>`);
 card.querySelector('[data-a="open"]')?.addEventListener('click',()=>{closeModal();app.go(route)});
 card.querySelector('[data-a="edit"]')?.addEventListener('click',()=>{closeModal();openEntityForm(app,'fileParties',{id:p.id,onSaved:()=>app.refresh()})});
 card.querySelector('[data-a="remove"]')?.addEventListener('click',async()=>{closeModal();if(!await confirmBox(`إزالة ${esc(p.name)} من أطراف هذا الملف؟ (سجل الشخص نفسه لا يُحذف)`,{okText:'إزالة'}))return;try{await removeParty(app.office,p.id);toast('تمت الإزالة');app.refresh()}catch(e){toast(userError(e),'error')}});
}
function relationActions(app,r){
 const card=modal(`<h2 class="modal-title">${esc(r.relationType||'علاقة')}</h2><p>${esc(r.otherLabel)}</p><div class="action-stack"><button class="primary" data-a="open">فتح الملف المرتبط</button><button class="ghost" data-a="edit">تعديل</button><button class="ghost danger" data-a="remove">إلغاء الربط</button></div>`);
 card.querySelector('[data-a="open"]').onclick=()=>{closeModal();app.go('file:'+r.otherFileId)};
 card.querySelector('[data-a="edit"]').onclick=()=>{closeModal();openEntityForm(app,'fileRelations',{id:r.id,onSaved:()=>app.refresh()})};
 card.querySelector('[data-a="remove"]').onclick=async()=>{closeModal();if(!await confirmBox('إلغاء الربط بين الملفين؟ (حذف منطقي للعلاقة فقط)',{okText:'إلغاء الربط'}))return;try{await deleteEntity(app.office,'fileRelations',r.id);toast('تم إلغاء الربط');app.refresh()}catch(e){toast(userError(e),'error')}};
}
export {openRow,displayValue,bindRefLinks};

async function reclassDialog(app,f){
 const tax=await taxonomy(app.office);
 const card=modal(`<h2 class="modal-title">تغيير القسم / نوع العمل</h2><p class="muted small">لا تُحذف أي بيانات: الحقول السابقة تبقى محفوظة، ويُسجل التغيير في سجل النشاط.</p><form id="rc"><label>القسم<select name="cat">${tax.categories.map(c=>`<option value="${esc(c.id)}" ${c.id===f.categoryId?'selected':''}>${esc(c.icon||'')} ${esc(c.name)}</option>`).join('')}</select></label><label>نوع العمل<select name="type"></select></label><div class="form-actions"><button class="primary">حفظ</button><button type="button" class="ghost" data-cancel>إلغاء</button></div></form>`);
 const form=card.querySelector('#rc'),fill=()=>{form.type.innerHTML='<option value="">— بدون نوع —</option>'+tax.typesOf(form.cat.value).map(t=>`<option value="${esc(t.id)}" ${t.id===f.fileTypeId?'selected':''}>${esc(t.name)}</option>`).join('')};fill();form.cat.onchange=fill;
 card.querySelector('[data-cancel]').onclick=closeModal;
 form.onsubmit=async e=>{e.preventDefault();try{await reclassifyFile(app.office,f.id,form.cat.value,form.type.value||null);closeModal();toast('تم التحديث');app.refresh()}catch(err){toast(userError(err),'error')}};
}
function assetDialog(app,fileId,kind){
 const d=ASSET_KINDS[kind];
 const card=modal(`<h2 class="modal-title">${esc(d.icon)} ${esc(d.label)} جديد</h2><form id="as" class="entity-form"><div class="form-grid">${d.fields.map(([k,l])=>`<div class="field"><label>${esc(l)}<input name="${esc(k)}"></label></div>`).join('')}<div class="field"><label>صفته في الملف<input name="__role" placeholder="مثل: محل النزاع، المركبة المضبوطة"></label></div></div><div class="form-actions"><button class="primary">حفظ وربط</button><button type="button" class="ghost" data-cancel>إلغاء</button></div></form>`);
 card.querySelector('[data-cancel]').onclick=closeModal;
 card.querySelector('#as').onsubmit=async e=>{e.preventDefault();const v=Object.fromEntries(new FormData(e.target));const role=v.__role;delete v.__role;try{const a=await saveAsset(app.office,kind,v);await linkAsset(app.office,fileId,a.id,role);closeModal();toast('تم الحفظ والربط');app.refresh()}catch(err){toast(userError(err),'error')}};
}
function linkAssetDialog(app,fileId){
 const card=modal(`<h2 class="modal-title">ربط أصل مسجل</h2><input type="search" id="as-q" placeholder="ابحث بالعنوان، اللوحة، رقم الشاسيه، الجهة…"><div id="as-r" class="cf-lines"></div>`);
 const q=card.querySelector('#as-q'),r=card.querySelector('#as-r');let t=0;
 const run=async()=>{const rows=await findAssets(app.office,q.value);r.innerHTML=rows.map(a=>`<button class="cf-line" data-id="${esc(a.id)}"><span class="cf-line-icon">${esc(ASSET_KINDS[a.kind]?.icon||'')}</span><span class="cf-line-main"><b>${esc(a.name)}</b><small>${esc(assetDetails(a))}</small></span></button>`).join('')||'<p class="muted small">لا نتائج.</p>'};
 q.oninput=()=>{clearTimeout(t);t=setTimeout(run,250)};run();
 r.onclick=async e=>{const b=e.target.closest('[data-id]');if(!b)return;try{await linkAsset(app.office,fileId,b.dataset.id);closeModal();toast('تم الربط');app.refresh()}catch(err){toast(userError(err),'error')}};
}


function renderFileQuickNotes(host, rows, app, fileId) {
  host.replaceChildren();
  if (!rows.length) { const empty=document.createElement('p'); empty.className='muted'; empty.textContent='لا توجد ملاحظات سريعة مرتبطة بهذا الملف.'; host.append(empty); return; }
  rows.forEach(note => {
    const article=document.createElement('article'); article.className='qn-card'; article.dataset.noteId=note.id;
    const head=document.createElement('div'); head.className='qn-card-head'; const title=document.createElement('button'); title.type='button'; title.className='qn-title'; title.textContent=note.title||'ملاحظة بلا عنوان'; head.append(title); const meta=document.createElement('span'); meta.className='qn-meta'; meta.textContent=`${note.lifecycle==='DONE'?'منجزة':'مفتوحة'} · ${note.priority||'NORMAL'}`; head.append(meta); article.append(head);
    const body=document.createElement('p'); body.className='qn-body'; body.textContent=note.content||'—'; article.append(body);
    const actions=document.createElement('div'); actions.className='qn-actions'; const edit=document.createElement('button'); edit.type='button'; edit.className='ghost qn-action'; edit.textContent='تعديل'; edit.onclick=()=>openQuickNoteEditor(app,note.id,{onSaved:()=>reload(app)}); const done=document.createElement('button'); done.type='button'; done.className='ghost qn-action'; done.textContent=note.lifecycle==='DONE'?'إعادة فتح':'إنجاز'; done.onclick=async()=>{try{if(note.lifecycle==='DONE'){const {reopenQuickNote}=await import('../services/quick-notes.js');await reopenQuickNote(app.office,note.id)}else await completeQuickNote(app.office,note.id);reload(app)}catch(error){toast(userError(error),'error')}}; const del=document.createElement('button'); del.type='button'; del.className='danger qn-action'; del.textContent='سلة'; del.onclick=async()=>{if(await confirmBox('نقل الملاحظة إلى السلة؟')){try{await deleteQuickNote(app.office,note.id);reload(app)}catch(error){toast(userError(error),'error')}}}; actions.append(edit,done,del); article.append(actions); host.append(article);
  });
}
