// لوحة ملف الموكل + معالج إضافة ملف قانوني + شريط المراحل.
// التدرج: الموكل ← ملف الموكل ← القسم ← نوع العمل ← الملف القانوني ← المرحلة ← التفاصيل.
import {esc} from '../ui/dom.js';
import {toast} from '../ui/toast.js';
import {modal,closeModal,confirmBox} from '../ui/modal.js';
import {mountGrid} from '../ui/datagrid.js';
import {legalFileColumns} from '../ui/grid-columns.js';
import {createGridRelations} from '../services/grid-relations.js';
import {formatDate,formatDateTime,longDateAr} from '../core/format.js';
import {clientWorkspaceHtml,bindCockpit} from '../ui/cockpit.js';
import {buildFocusModel} from '../services/focus-engine.js';
import {clientWorkspaceData} from '../services/client-workspace.js';
import {formatFileNumber,fileNumberChip} from '../core/file-number.js';
import {userError} from '../core/errors.js';
import {Clock} from '../core/clock.js';
import {phonesOf,isClosedFile,label} from '../domain/entities.js';
import {RELATED_SUGGESTIONS,GENERIC_RELATED,RELATION_TYPES,LIFECYCLE} from '../domain/taxonomy-defaults.js';
import {lookupRows} from '../services/lookups.js';
import {ensureClientFile,clientFileSummary,clientFileEvents,taxonomy,createLegalFileInClientFile,saveClientFile,archiveClientFile,reopenClientFile,
 addStage,setCurrentStage,setStageLifecycle,moveStage,removePlannedStage} from '../services/client-files.js';
import {registerPageLayout,openPageCustomizer} from '../ui/page-layout.js';
import {openCustomizerForElement} from '../ui/component-customizer.js';

// لوحة ملف الموكل ضمن نظام ترتيب الأقسام المركزي — نفس النظام لكل الصفحات.
registerPageLayout({pageId:'client-file',title:'ملف الموكل',sections:[
 {id:'stats',title:'ملخص ملف الموكل'},
 {id:'followup',title:'ملفات تحتاج متابعة'},
 {id:'recent-files',title:'آخر الملفات التي تم التعامل معها'},
 {id:'hearings',title:'آخر الجلسات'},
 {id:'procedures',title:'آخر الأعمال الإدارية'},
 {id:'stopped',title:'الملفات المتوقفة',defaultHidden:false}]});

const plural=(n,one,two,few,many)=>n===0?`لا ${many}`:n===1?`${one} واحد`:n===2?two:n<=10?`${n} ${few}`:`${n} ${many}`;
const filesWord=n=>plural(n,'ملف','ملفان','ملفات','ملف');
const statusClass=f=>isClosedFile(f)?'closed':['متوقف','موقوف','محفوظ مؤقتًا'].includes(f.status)?'warn':'open';
const rel=v=>{if(!v)return '—';const d=(Date.now()-new Date(v))/864e5;if(d<1)return 'اليوم';if(d<2)return 'أمس';if(d<30)return `منذ ${Math.floor(d)} يوم`;return formatDate(v)};

// ======================= لوحة ملف الموكل =======================
export async function clientFilePage(app,clientId,query){
 const client=await app.office.r.clients.get(clientId);
 if(!client||client.isDeleted)return `<div class="empty"><h3>الموكل غير موجود</h3></div>`;
 const cf=await ensureClientFile(app.office,clientId);
 const s=await clientFileSummary(app.office,cf.id);
 const fresh=await app.office.r.clients.get(clientId);
 const catId=query?.get('cat')||'',typeId=query?.get('type')||'',q=query?.get('q')||'';
 app.__cfile={client:fresh,cf,s,catId,typeId,q};
 const tax=s.tax,cat=catId?tax.byId.get(catId):null,type=typeId?tax.byId.get(typeId):null;
 const crumb=[`<button class="link" data-go="client:${esc(clientId)}">${esc(fresh.fullName)}</button>`,`<button class="link" data-go="cfile:${esc(clientId)}">ملف الموكل</button>`];
 if(cat)crumb.push(`<button class="link" data-go="cfile:${esc(clientId)}?cat=${esc(cat.id)}">${esc(cat.icon||'')} ${esc(cat.name)}</button>`);
 if(type)crumb.push(`<span>${esc(type.name)}</span>`);
 const phone=phonesOf(fresh)[0];
 // أزرار اتصال مباشرة عند وجود رقم صالح فقط — tel: للهاتف وwa.me للواتساب (روابط قياسية بلا خدمة خارجية).
 const phoneHref=phone?String(phone).replace(/[^\d+]/g,''):'';
 const waHref=phoneHref?`https://wa.me/${phoneHref.replace(/^\+/,'').replace(/^0/,'20')}`:'';
 const head=`<div class="cfile-page"><nav class="crumbs" aria-label="المسار">${crumb.join('<span class="sep">‹</span>')}</nav>
 <section class="cf-hero">
  <div class="cf-id"><div class="cf-avatar" aria-hidden="true">${esc((fresh.fullName||'؟').trim().charAt(0))}</div>
   <div><h2>${esc(fresh.fullName)}</h2><p class="cf-code">${fileNumberChip({clientCode:cf.clientCode||fresh.clientCode})}<span class="badge ${cf.isArchived?'warn':'open'}">${esc(cf.status||'نشط')}</span>${fresh.clientType?`<span class="badge">${esc(fresh.clientType)}</span>`:''}${s.needsFollowUp.length?`<span class="badge warn" data-collapse-alert title="ملفات تحتاج متابعة — مرفوعة للأعلى في الصفحة">⚠ ${s.needsFollowUp.length} ملفات تحتاج متابعة</span>`:''}</p>
   <dl class="cf-meta">${phone?`<div><dt>الهاتف</dt><dd><a href="tel:${esc(phoneHref)}" dir="ltr">${esc(phone)}</a></dd></div>`:''}<div><dt>المحامي المسؤول</dt><dd>${esc(cf.responsibleLawyer||'—')}</dd></div><div><dt>فتح الملف</dt><dd>${formatDate(cf.openedAt)}</dd></div><div><dt>آخر نشاط</dt><dd>${rel(s.files[0]?.lastActivityAt||cf.lastActivityAt)}</dd></div></dl></div></div>
  <div class="cf-actions">${phoneHref?`<a class="ghost" href="tel:${esc(phoneHref)}" aria-label="اتصال بالموكل">📞 اتصال</a>`:''}${waHref?`<a class="ghost" href="${esc(waHref)}" target="_blank" rel="noopener" aria-label="مراسلة الموكل عبر واتساب">🟢 واتساب</a>`:''}<button class="primary" data-new-lf>+ ملف قانوني جديد</button><button class="ghost" data-customize-page title="ترتيب الأقسام وإظهارها وإعدادات العرض">⚙ تخصيص الصفحة</button><button class="ghost" data-cf-edit>تعديل ملف الموكل</button>${cf.isArchived?'<button class="ghost" data-cf-reopen>إعادة فتح</button>':'<button class="ghost" data-cf-archive>أرشفة</button>'}</div>
 </section>
 <section class="panel cf-stats-panel" data-collapse-id="client-file-stats" data-section-id="stats"><div class="panel-head"><h3>ملخص ملف الموكل</h3><span class="badge">${s.total} ملف</span></div><div class="cf-stats">
  <div class="stat"><b>${s.total}</b><span>إجمالي الملفات</span></div>
  <div class="stat stat-ok"><b>${s.active}</b><span>نشطة</span></div>
  <div class="stat stat-muted"><b>${s.closed}</b><span>منتهية</span></div>
  <div class="stat stat-warn"><b>${s.stopped}</b><span>متوقفة</span></div>
 </div></section>
 <div class="cf-search"><input type="search" id="cf-q" placeholder="ابحث داخل ملف الموكل: رقم الملف، الاسم، النوع، رقم القضية…" value="${esc(q)}" aria-label="بحث داخل ملف الموكل"></div>`;
 if(q)return head+`<section class="panel"><div class="panel-head"><h3>نتائج البحث داخل الملف</h3></div><div id="cf-files"></div></section></div>`;
 // مركز عمل الموكل (الشاشة الرئيسية للموكل فقط): الخطوة التالية عبر كل ملفاته.
 let ws='';
 if(!cat&&!q){
  try{
   const d=await clientWorkspaceData(app.office,{clientId,clientName:fresh.fullName,summary:s});
   const model=buildFocusModel(d.brief,{today:d.today,now:new Date().toTimeString().slice(0,5)});
   ws=clientWorkspaceHtml({model,recentDone:d.recentDone,clientName:fresh.fullName,dayLabel:longDateAr(),clientId,executions:d.executions,fileLabelOf:id=>d.fileLabels?.get(id)||''});
  }catch(e){console.error('client workspace',e)}
 }
 if(!cat){
  const used=tax.categories.filter(c=>s.byCategory.get(c.id));
  const empty=!s.total;
  return head+ws+`
  ${empty?`<div class="empty cf-empty"><h3>لا توجد ملفات قانونية بعد</h3><p>ابدأ بإضافة أول ملف لهذا الموكل — جنائي، مدني، أسرة، مجلس دولة، محليات، ضرائب… أو أي نوع تضيفه من الإعدادات.</p><button class="primary" data-new-lf>+ إضافة ملف قانوني</button></div>`:`
  <h3 class="cf-section-title">أقسام الأعمال</h3>
  <div class="cat-grid">${used.map(c=>catCard(c,s.byCategory.get(c.id),clientId)).join('')}
   <button class="cat-card cat-add" data-new-lf><span class="cat-icon">＋</span><b>ملف في قسم آخر</b><small>${tax.categories.length-used.length} قسمًا متاحًا</small></button></div>
  <div class="grid2 cf-panels" data-collapse-accordion>
   ${panel('ملفات تحتاج متابعة',s.needsFollowUp.map(f=>fileLine(f,tax,'لا نشاط منذ '+rel(f.lastActivityAt))).join('')||'<p class="muted small">لا توجد ملفات متأخرة المتابعة 👌</p>','followup',s.needsFollowUp.length?`${s.needsFollowUp.length} ملفات`:'')}
   ${panel('آخر الملفات التي تم التعامل معها',s.files.slice(0,6).map(f=>fileLine(f,tax)).join(''),'recent-files')}
   <section class="panel" data-section-id="hearings"><div class="panel-head"><h3>آخر الجلسات</h3></div><div id="cf-hearings"><div class="loading small">…</div></div></section>
   <section class="panel" data-section-id="procedures"><div class="panel-head"><h3>آخر الأعمال الإدارية</h3></div><div id="cf-procs"><div class="loading small">…</div></div></section>
   ${s.stoppedFiles.length?panel('الملفات المتوقفة',s.stoppedFiles.map(f=>fileLine(f,tax)).join(''),'stopped'):''}
  </div>`}</div>`;
 }
 const types=tax.typesOf(cat.id);
 const typeCounts=types.map(t=>[t,s.files.filter(f=>f.categoryId===cat.id&&f.fileTypeId===t.id).length]);
 const untyped=s.files.filter(f=>f.categoryId===cat.id&&!f.fileTypeId).length;
 return head+`<div class="page-head"><div><h2>${esc(cat.icon||'')} ${esc(cat.name)}${type?` — ${esc(type.name)}`:''}</h2><p class="muted small">${esc(cat.description||'')}</p></div><button class="primary" data-new-lf data-cat="${esc(cat.id)}" ${type?`data-type="${esc(type.id)}"`:''}>+ ${type?esc(type.name):'ملف'} جديد</button></div>
 <div class="type-chips" role="tablist"><button class="chip ${!type?'active':''}" data-go="cfile:${esc(clientId)}?cat=${esc(cat.id)}">الكل <small>${s.byCategory.get(cat.id)||0}</small></button>${typeCounts.filter(([,n])=>n).map(([t,n])=>`<button class="chip ${type?.id===t.id?'active':''}" data-go="cfile:${esc(clientId)}?cat=${esc(cat.id)}&type=${esc(t.id)}">${esc(t.name)} <small>${n}</small></button>`).join('')}${untyped?`<span class="chip">بدون نوع <small>${untyped}</small></span>`:''}</div>
 <div id="cf-files"></div></div>`;
}
const panel=(title,body,sectionId='',badge='')=>`<section class="panel"${sectionId?` data-section-id="${sectionId}"`:''}><div class="panel-head"><h3>${title}</h3>${badge?`<span class="badge warn" data-collapse-alert>${esc(badge)}</span>`:''}</div><div class="cf-lines">${body||'<p class="muted small">لا يوجد.</p>'}</div></section>`;
function catCard(c,n,clientId){return `<button class="cat-card" data-go="cfile:${esc(clientId)}?cat=${esc(c.id)}" style="--cat:${esc(c.color||'var(--primary)')}"><span class="cat-icon">${esc(c.icon||'📁')}</span><b>${esc(c.name)}</b><small>${filesWord(n)}</small></button>`}
function fileLine(f,tax,note=''){const t=tax.byId.get(f.fileTypeId),c=tax.byId.get(f.categoryId);return `<button class="cf-line" data-go="file:${esc(f.id)}"><span class="cf-line-icon">${esc(c?.icon||'📁')}</span><span class="cf-line-main"><b>${esc(f.title||'')}</b><small>${fileNumberChip(f,{withKind:false})} · ${esc(t?.name||f.fileType||'')}${f.__stage?` · ${esc(f.__stage.stageType||'')}`:''}${f.__shared?' · ملف مشترك':''}</small></span><span class="badge ${statusClass(f)}">${esc(label(f.status||''))}</span>${note?`<small class="muted">${esc(note)}</small>`:''}</button>`}
function fileCard(f,tax){const t=tax.byId.get(f.fileTypeId),c=tax.byId.get(f.categoryId),st=f.__stage;return `<article class="lf-card" style="--cat:${esc(c?.color||'var(--primary)')}"><header><span>${esc(c?.icon||'📁')}</span><div><b>${esc(f.title||'')}</b><small>${fileNumberChip(f,{withKind:false})}</small></div><span class="badge ${statusClass(f)}">${esc(label(f.status||''))}</span></header>
 <dl><div><dt>النوع</dt><dd>${esc(t?.name||f.fileType||'—')}</dd></div><div><dt>المرحلة الحالية</dt><dd>${esc(st?.stageType||'—')}</dd></div>${st?.courtId?`<div><dt>المحكمة</dt><dd>${esc(st.courtId)}</dd></div>`:''}<div><dt>آخر نشاط</dt><dd>${rel(f.lastActivityAt)}</dd></div></dl>
 <button class="ghost small" data-go="file:${esc(f.id)}">فتح</button></article>`}

export async function bindClientFilePage(app,clientId){
 const root=document.querySelector('#main-content .cfile-page');if(!root)return;const {s,catId,typeId,q,cf}=app.__cfile;const tax=s.tax;
 bindCockpit(root,app);
 // بعد «✓ تم» في مركز عمل الموكل: تحديث موضعي لقسم «مركز عمل الموكل» فقط — بلا إعادة بناء الصفحة.
 if(root.querySelector('.cp-client-ws')){
  app.__refreshAfterAction=async()=>{
   if(!app.route||!app.route.startsWith('cfile:'))return app.refresh();
   const wsEl=root.querySelector('.cp-client-ws');if(!wsEl)return app.refresh();
   const scrollY=window.scrollY;
   try{
    const d=await clientWorkspaceData(app.office,{clientId,clientName:app.__cfile.client.fullName,summary:app.__cfile.s});
    const model=buildFocusModel(d.brief,{today:d.today,now:new Date().toTimeString().slice(0,5)});
    const tpl=document.createElement('template');
    tpl.innerHTML=clientWorkspaceHtml({model,recentDone:d.recentDone,clientName:app.__cfile.client.fullName,dayLabel:longDateAr(),clientId,executions:d.executions,fileLabelOf:id=>d.fileLabels?.get(id)||''}).trim();
    wsEl.replaceWith(tpl.content.firstElementChild);
    bindCockpit(root,app);
    root.querySelectorAll('.cp-client-ws [data-route]').forEach(b=>b.onclick=()=>app.go(b.dataset.route));
    window.scrollTo(0,scrollY);
   }catch(err){app.fail(err)}
  };
 }
 root.addEventListener('click',e=>{const b=e.target.closest('[data-go]');if(b){e.preventDefault();app.go(b.dataset.go)}});
 root.querySelectorAll('[data-new-lf]').forEach(b=>b.onclick=()=>openLegalFileWizard(app,{clientId,categoryId:b.dataset.cat||catId||'',fileTypeId:b.dataset.type||typeId||''}));
 root.querySelector('[data-customize-page]')?.addEventListener('click',()=>openPageCustomizer(app,{pageId:'client-file',root}));
 root.querySelector('[data-cf-edit]')?.addEventListener('click',()=>editClientFile(app,cf));
 root.querySelector('[data-cf-archive]')?.addEventListener('click',async()=>{const r=await confirmBox('أرشفة ملف الموكل؟ لا تُحذف أي ملفات، ويمكن إعادة فتحه في أي وقت. (تُرفض الأرشفة إذا وُجدت ملفات نشطة)',{okText:'أرشفة',input:true,label:'السبب (اختياري)'});if(!r.ok)return;try{await archiveClientFile(app.office,cf.id,r.value);toast('تمت الأرشفة');app.refresh()}catch(err){toast(userError(err),'error')}});
 root.querySelector('[data-cf-reopen]')?.addEventListener('click',async()=>{await reopenClientFile(app.office,cf.id);toast('تمت إعادة الفتح');app.refresh()});
 const qi=root.querySelector('#cf-q');let t=0;
 qi?.addEventListener('input',()=>{clearTimeout(t);t=setTimeout(()=>{const v=qi.value.trim();app.go(`cfile:${clientId}${v?'?q='+encodeURIComponent(v):catId?'?cat='+catId:''}`,{replace:true}).then(()=>{const n=document.querySelector('#cf-q');if(n){n.focus();n.setSelectionRange(n.value.length,n.value.length)}})},350)});
 const grid=root.querySelector('#cf-files');
 if(grid){
  let list=s.files;
  if(q){const {normalizeArabic}=await import('../core/search-normalizer.js');const n=normalizeArabic(q);list=list.filter(f=>normalizeArabic([formatFileNumber(f.fileNumber),f.fileNumber,f.title,f.fileType,f.mainCategory,f.searchText].join(' ')).includes(n))}
  else{list=list.filter(f=>f.categoryId===catId&&(!typeId||f.fileTypeId===typeId))}
  grid.innerHTML=`<div class="lf-cards">${list.map(f=>fileCard(f,tax)).join('')||'<p class="muted">لا توجد ملفات.</p>'}</div><div class="lf-grid"></div>`;
  const relations=createGridRelations(app.office,'files');await relations.hydrate(list);
  mountGrid(grid.querySelector('.lf-grid'),{title:'ملفات الموكل',storageKey:'cfile:files',collapseKey:`client-file:${clientId}:files-grid`,rows:list,onRowClick:f=>app.go('file:'+f.id),emptyText:'لا توجد ملفات.',...relations.gridOptions({clientId,filters:[q&&`بحث: ${q}`,catId&&`القسم: ${tax.byId.get(catId)?.name||''}`,typeId&&`النوع: ${tax.byId.get(typeId)?.name||''}`].filter(Boolean)}),columns:[
   ...legalFileColumns(relations,{fileKey:'fileNumber'}),{key:'title',label:'عنوان الملف'},{key:'type',label:'النوع',hidden:true,get:f=>tax.byId.get(f.fileTypeId)?.name||f.fileType||''},
   {key:'cat',label:'القسم',get:f=>tax.byId.get(f.categoryId)?.name||'',hidden:Boolean(catId)},
   {key:'stage',label:'المرحلة الحالية',get:f=>f.__stage?.stageType||''},{key:'court',label:'المحكمة',get:f=>f.__stage?.courtId||''},
   {key:'caseNo',label:'رقم القضية الرسمي',get:f=>relations.officialNumber(f)},
   {key:'status',label:'الحالة',get:f=>label(f.status||'')},{key:'lastActivityAt',label:'آخر نشاط',type:'date',get:f=>f.lastActivityAt,text:f=>formatDate(f.lastActivityAt)}]});
 }
 if(root.querySelector('#cf-hearings')){
  const ev=await clientFileEvents(app.office,s.files);const fname=id=>s.files.find(f=>f.id===id)?.title||'';
  const h=root.querySelector('#cf-hearings'),p=root.querySelector('#cf-procs');
  if(h)h.innerHTML=`<div class="cf-lines">${ev.hearings.map(x=>`<button class="cf-line" data-go="rec:hearings:${esc(x.id)}"><span class="cf-line-icon">📅</span><span class="cf-line-main"><b>${formatDate(x.hearingDate)} ${esc(x.hearingTime||'')}</b><small>${esc(fname(x.fileId))}${x.decision?' · '+esc(x.decision):''}</small></span></button>`).join('')||'<p class="muted small">لا توجد جلسات.</p>'}</div>`;
  if(p)p.innerHTML=`<div class="cf-lines">${ev.procedures.map(x=>`<button class="cf-line" data-go="rec:procedures:${esc(x.id)}"><span class="cf-line-icon">📌</span><span class="cf-line-main"><b>${esc(x.procedureType||x.title||'عمل إداري')}</b><small>${esc(fname(x.fileId))}${x.internalDueDate?' · '+formatDate(x.internalDueDate):''}</small></span><span class="badge">${esc(label(x.status||''))}</span></button>`).join('')||'<p class="muted small">لا توجد أعمال إدارية.</p>'}</div>`;
 }
}
async function editClientFile(app,cf){
 const lawyers=(await lookupRows(app.office,'lawyer')).map(r=>r.value),sts=(await lookupRows(app.office,'clientFileStatus')).map(r=>r.value);
 const card=modal(`<h2 class="modal-title">تعديل الملف الرئيسي ${esc(formatFileNumber(cf.clientCode))}</h2><form class="entity-form" id="cf-form"><div class="form-grid">
  <div class="field"><label>الحالة<input name="status" list="cf-sts" value="${esc(cf.status||'')}"></label><datalist id="cf-sts">${sts.map(v=>`<option value="${esc(v)}">`).join('')}</datalist></div>
  <div class="field"><label>المحامي المسؤول<input name="responsibleLawyer" list="cf-law" value="${esc(cf.responsibleLawyer||'')}"></label><datalist id="cf-law">${lawyers.map(v=>`<option value="${esc(v)}">`).join('')}</datalist></div>
  <div class="field"><label>تاريخ فتح الملف<input type="date" name="openedAt" value="${esc(cf.openedAt||'')}"></label></div>
  <div class="field span2"><label>ملاحظات<textarea name="notes">${esc(cf.notes||'')}</textarea></label></div></div>
  <div class="form-actions"><button class="primary">حفظ</button><button type="button" class="ghost" data-cancel>إلغاء</button></div></form>`);
 card.querySelector('[data-cancel]').onclick=closeModal;
 card.querySelector('#cf-form').onsubmit=async e=>{e.preventDefault();const fd=Object.fromEntries(new FormData(e.target));try{await saveClientFile(app.office,cf.id,fd);closeModal();toast('تم الحفظ');app.refresh()}catch(err){toast(userError(err),'error')}};
}

// ======================= معالج إضافة ملف قانوني =======================
/** opts: {clientId, categoryId, fileTypeId, related:{fileId,relationCode,label}, allowedTypes:[]} */
export async function openLegalFileWizard(app,opts={}){
 const tax=await taxonomy(app.office);
 const [roles,lawyers]=await Promise.all([lookupRows(app.office,'partyRole'),lookupRows(app.office,'lawyer')]);
 const st={step:opts.fileTypeId?3:opts.categoryId?2:1,categoryId:opts.categoryId||'',fileTypeId:opts.fileTypeId||'',useTemplate:true,steps:null,clientId:opts.clientId||'',meta:{}};
 if(st.fileTypeId&&!st.categoryId)st.categoryId=tax.byId.get(st.fileTypeId)?.parentId||'';
 const client=st.clientId?await app.office.r.clients.get(st.clientId):null;
 const card=modal('<div id="lfw"></div>');card.classList.add('wizard-card');
 const el=card.querySelector('#lfw');
 const cats=()=>tax.categories.filter(c=>c.isActive!==false);
 const typesOf=c=>tax.typesOf(c).filter(t=>t.isActive!==false&&(!opts.allowedTypes||opts.allowedTypes.includes(t.id)));
 const stepsFromTemplate=()=>(tax.templateFor(st.fileTypeId)?.steps||[]).map(s=>({...s,include:!s.optional||false}));
 function header(){const cat=tax.byId.get(st.categoryId),type=tax.byId.get(st.fileTypeId);
  return `<h2 class="modal-title">إضافة ملف قانوني${client?` — ${esc(client.fullName)}`:''}</h2>
  ${opts.related?`<p class="notice small">سيُنشأ الملف مرتبطًا بـ <b>${esc(opts.related.title||'')}</b> بعلاقة «${esc(RELATION_TYPES[opts.related.relationCode]?.label||'مرتبط بـ')}» مع ربط أطرافه (بدون تكرار بياناتهم).</p>`:''}
  <ol class="wz-steps"><li class="${st.step>=1?'on':''}"><button type="button" data-wz-step="1">١. القسم${cat?`: <b>${esc(cat.name)}</b>`:''}</button></li><li class="${st.step>=2?'on':''}"><button type="button" data-wz-step="2" ${cat?'':'disabled'}>٢. نوع العمل${type?`: <b>${esc(type.name)}</b>`:''}</button></li><li class="${st.step>=3?'on':''}"><span>٣. البيانات الأساسية</span></li></ol>`}
 function draw(){
  if(st.step===1){el.innerHTML=header()+`<div class="cat-grid wz-grid">${cats().map(c=>`<button type="button" class="cat-card${c.id===st.categoryId?' on':''}" data-cat="${esc(c.id)}" style="--cat:${esc(c.color||'var(--primary)')}"><span class="cat-icon">${esc(c.icon||'📁')}</span><b>${esc(c.name)}</b><small>${esc(c.description||'')}</small></button>`).join('')}</div>`}
  else if(st.step===2){const types=typesOf(st.categoryId);el.innerHTML=header()+`<div class="type-grid">${types.map(t=>`<button type="button" class="type-card${t.id===st.fileTypeId?' on':''}" data-type="${esc(t.id)}"><b>${esc(t.name)}</b>${tax.templateFor(t.id)?`<small>${tax.templateFor(t.id).steps.map(s=>esc(s.name)).join(' ← ')}</small>`:'<small class="muted">بدون مسار مقترح</small>'}</button>`).join('')}<button type="button" class="type-card" data-type=""><b>بدون نوع محدد</b><small class="muted">يمكن التحديد لاحقًا</small></button></div>`}
  else{
   if(!st.steps){st.steps=st.useTemplate?stepsFromTemplate():[]}
   const type=tax.byId.get(st.fileTypeId),cat=tax.byId.get(st.categoryId);const fields=type?.fields||[];
   const stageNames=tax.stagesOf(st.categoryId).map(s=>s.name);
   const hasTpl=Boolean(tax.templateFor(st.fileTypeId));
   el.innerHTML=header()+`<form id="lfw-form" class="entity-form" novalidate><div class="form-grid">
    <div class="field span2"><label>اسم الملف <small class="muted">(اختياري — يُقترح تلقائيًا)</small><input name="title" placeholder="${esc(`${type?.name||cat?.name||''} — ${client?.fullName||''}`)}" value="${esc(st.title||'')}"></label></div>
    <div class="field"><label>صفة الموكل في هذا الملف<input name="clientRole" list="lfw-roles" value="${esc(st.clientRole||'')}" placeholder="مثل: مدعٍ، متهم، مجني عليه، متظلم"></label><datalist id="lfw-roles">${roles.map(r=>`<option value="${esc(r.value)}">`).join('')}</datalist></div>
    <div class="field"><label>المحامي المسؤول<input name="responsibleLawyer" list="lfw-law" value="${esc(st.responsibleLawyer||'')}"></label><datalist id="lfw-law">${lawyers.map(r=>`<option value="${esc(r.value)}">`).join('')}</datalist></div>
    <div class="field"><label>تاريخ فتح الملف<input type="date" name="openedAt" value="${esc(st.openedAt||Clock.today())}"></label></div>
   </div>
   <fieldset class="wz-path"><legend>مسار العمل</legend>
    ${hasTpl?`<div class="ts-seg" role="radiogroup"><button type="button" class="${st.useTemplate?'on':''}" data-tpl="1">استخدام المسار المقترح</button><button type="button" class="${!st.useTemplate?'on':''}" data-tpl="0">البدء يدويًا</button></div><p class="muted small">المسار اقتراح إداري فقط — احذف أو أضف أو غيّر أي مرحلة، ويمكن تعديله لاحقًا في أي وقت.</p>`:'<p class="muted small">لا يوجد مسار مقترح لهذا النوع. أضف المراحل التي تريدها (أو اتركها فارغة).</p>'}
    <ol class="wz-stage-list">${st.steps.map((s,i)=>`<li data-i="${i}" class="${s.include?'':'off'}"><label class="wz-inc"><input type="checkbox" ${s.include?'checked':''} data-inc aria-label="تضمين"></label><input class="wz-name" value="${esc(s.name)}" aria-label="اسم المرحلة">${s.optional?'<small class="muted">عند الحاجة</small>':''}<button type="button" class="link" data-mv="-1" ${i?'':'disabled'} aria-label="أعلى">▲</button><button type="button" class="link" data-mv="1" ${i<st.steps.length-1?'':'disabled'} aria-label="أسفل">▼</button><button type="button" class="link danger" data-del aria-label="حذف">✕</button></li>`).join('')}</ol>
    <div class="wz-add"><input id="wz-new" list="wz-stage-names" placeholder="+ مرحلة: اختر أو اكتب اسمًا جديدًا"><datalist id="wz-stage-names">${stageNames.map(n=>`<option value="${esc(n)}">`).join('')}</datalist><button type="button" class="ghost" data-add-stage>إضافة</button></div>
   </fieldset>
   ${fields.length?`<details class="form-group"><summary>بيانات ${esc(type.name)} (اختياري — يمكن إكمالها لاحقًا)</summary><div class="form-grid">${fields.map(f=>metaInput(f,st.meta[f.k])).join('')}</div></details>`:''}
   <div class="form-actions"><button class="primary" type="submit">إنشاء الملف</button><button type="button" class="ghost" data-wz-back>رجوع</button></div></form>`;
   hydrateLookups(app,el);
  }
 }
 const readForm=()=>{const f=el.querySelector('#lfw-form');if(!f)return;const fd=new FormData(f);for(const k of ['title','clientRole','responsibleLawyer','openedAt'])st[k]=fd.get(k)||'';el.querySelectorAll('[data-meta]').forEach(i=>st.meta[i.dataset.meta]=i.value);el.querySelectorAll('.wz-stage-list li').forEach(li=>{const s=st.steps[Number(li.dataset.i)];s.name=li.querySelector('.wz-name').value;s.include=li.querySelector('[data-inc]').checked})};
 el.addEventListener('click',async e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.dataset.cat!==undefined){st.categoryId=b.dataset.cat;st.fileTypeId='';st.steps=null;st.step=typesOf(st.categoryId).length?2:3;draw();return}
  if(b.dataset.type!==undefined){st.fileTypeId=b.dataset.type;st.steps=null;st.useTemplate=true;st.step=3;draw();return}
  if(b.dataset.wzStep){readForm();st.step=Number(b.dataset.wzStep);draw();return}
  if(b.hasAttribute('data-wz-back')){readForm();st.step=typesOf(st.categoryId).length?2:1;draw();return}
  if(b.dataset.tpl!==undefined){readForm();st.useTemplate=b.dataset.tpl==='1';st.steps=st.useTemplate?stepsFromTemplate():[];draw();return}
  const li=b.closest('.wz-stage-list li');
  if(li){readForm();const i=Number(li.dataset.i);if(b.dataset.mv){const j=i+Number(b.dataset.mv);[st.steps[i],st.steps[j]]=[st.steps[j],st.steps[i]]}else if(b.hasAttribute('data-del'))st.steps.splice(i,1);draw();return}
  if(b.hasAttribute('data-add-stage')){readForm();const v=el.querySelector('#wz-new').value.trim();if(v){st.steps.push({name:v,include:true,optional:false,stageTypeId:tax.stagesOf(st.categoryId).find(s=>s.name===v)?.id||null});draw();el.querySelector('#wz-new')?.focus()}return}
 });
 el.addEventListener('change',e=>{if(e.target.matches('[data-inc]'))e.target.closest('li').classList.toggle('off',!e.target.checked)});
 el.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.id==='wz-new'){e.preventDefault();el.querySelector('[data-add-stage]').click()}});
 el.addEventListener('submit',async e=>{
  e.preventDefault();readForm();const btn=el.querySelector('button[type=submit]');btn.disabled=true;
  try{
   const f=await createLegalFileInClientFile(app.office,{clientId:st.clientId,categoryId:st.categoryId,fileTypeId:st.fileTypeId||null,title:st.title,clientRole:st.clientRole,responsibleLawyer:st.responsibleLawyer,openedAt:st.openedAt,
    steps:st.steps.filter(s=>s.include&&s.name.trim()),templateId:st.useTemplate?tax.templateFor(st.fileTypeId)?.id:null,meta:st.meta,related:opts.related||null});
   closeModal();toast(`تم إنشاء الملف الفرعي ${formatFileNumber(f.fileNumber)}`);app.go('file:'+f.id);
  }catch(err){toast(userError(err),'error');btn.disabled=false}
 });
 draw();
}
export function metaInput(f,v=''){
 const type=f.t==='number'?'number':f.t==='date'?'date':'text';
 if(f.t==='textarea')return `<div class="field span2"><label>${esc(f.l)}<textarea data-meta="${esc(f.k)}" name="x_${esc(f.k)}">${esc(v??'')}</textarea></label></div>`;
 return `<div class="field"><label>${esc(f.l)}<input type="${type}" data-meta="${esc(f.k)}" name="x_${esc(f.k)}" value="${esc(v??'')}" ${f.lk?`list="lk-${esc(f.lk)}" data-lk="${esc(f.lk)}"`:''}></label></div>`;
}
export async function hydrateLookups(app,root){
 const cats=[...new Set([...root.querySelectorAll('[data-lk]')].map(i=>i.dataset.lk))];
 for(const c of cats){if(root.querySelector(`#lk-${CSS.escape(c)}`))continue;const rows=await lookupRows(app.office,c);const dl=document.createElement('datalist');dl.id='lk-'+c;dl.innerHTML=rows.map(r=>`<option value="${esc(r.value)}">`).join('');root.append(dl)}
}

// ======================= شريط المراحل داخل الملف القانوني =======================
const ICON={done:'✓',active:'●',planned:'○',skipped:'⤼'};
// كل مرحلة لها هوية ثابتة في نظام التخصيص الكامل (stage:<caseId>) — تخصيصها
// مستقل تمامًا عن بقية المراحل، وشريط المراحل نفسه مكوّن قابل للتخصيص (stagepath:<fileId>).
export function stagePathHtml(stages,currentId,fileId=''){
 const live=stages.filter(s=>!s.isDeleted);
 return `<section class="stage-path" aria-label="مراحل الملف"${fileId?` data-uxc-id="stagepath:${esc(fileId)}" data-uxc-type="section" data-uxc-title="شريط المراحل" data-uxc-gear`:''}>
  <div class="sp-head"><b>المراحل</b><span class="muted small">اضغط على أي مرحلة لإدارتها — المسار اقتراح وليس إلزامًا</span><span class="sp-actions"><button class="ghost small" data-sp-add>+ مرحلة</button><button class="ghost small" data-sp-related>⤴ إنشاء ملف مرتبط</button></span></div>
  <ol class="sp-list">${live.map(s=>{const lc=s.lifecycle||(s.id===currentId?'active':'done');return `<li class="sp-${lc}${s.id===currentId?' sp-current':''}" data-uxc-id="stage:${esc(s.id)}" data-uxc-type="stage" data-uxc-title="${esc(s.stageType||s.nameSnapshot||'مرحلة')}"><button type="button" data-sp="${esc(s.id)}" title="${esc(LIFECYCLE[lc]||'')}"><i>${ICON[lc]||'•'}</i><span>${esc(s.stageType||s.nameSnapshot||'مرحلة')}</span>${s.caseNumber?`<small>${esc(s.caseNumber)}${s.caseYear?'/'+esc(s.caseYear):''}</small>`:s.outcome?`<small>${esc(s.outcome)}</small>`:''}</button></li>`}).join('')||'<li class="muted small sp-empty">لا توجد مراحل. أضف أول مرحلة عندما تحتاجها.</li>'}</ol></section>`;
}
export function bindStagePath(app,file,stages){
 const root=document.querySelector('.stage-path');if(!root)return;
 const run=async p=>{try{await p;app.refresh()}catch(err){toast(userError(err),'error')}};
 root.querySelector('[data-sp-add]').onclick=async()=>{
  const tax=await taxonomy(app.office);const names=tax.stagesOf(file.categoryId||'other').map(s=>s);
  const card=modal(`<h2 class="modal-title">إضافة مرحلة</h2><form id="sp-form"><label>اسم المرحلة<input name="name" list="sp-names" required placeholder="اختر أو اكتب أي اسم"></label><datalist id="sp-names">${names.map(n=>`<option value="${esc(n.name)}">`).join('')}</datalist>
   <label>الموضع<select name="after"><option value="">في النهاية</option>${stages.filter(s=>!s.isDeleted).map(s=>`<option value="${esc(s.id)}">بعد: ${esc(s.stageType||'')}</option>`).join('')}</select></label>
   <label class="ts-switch"><span>اجعلها المرحلة الحالية</span><input type="checkbox" name="current"></label>
   <div class="form-actions"><button class="primary">إضافة</button><button type="button" class="ghost" data-cancel>إلغاء</button></div></form>`);
  card.querySelector('[data-cancel]').onclick=closeModal;
  card.querySelector('#sp-form').onsubmit=e=>{e.preventDefault();const fd=new FormData(e.target);const nm=String(fd.get('name')).trim();closeModal();run(addStage(app.office,file.id,{name:nm,stageTypeId:names.find(n=>n.name===nm)?.id||null,afterId:fd.get('after')||null,makeCurrent:fd.get('current')==='on'}))};
 };
 root.querySelector('[data-sp-related]').onclick=e=>openRelatedMenu(app,file,e.currentTarget);
 root.querySelectorAll('[data-sp]').forEach(b=>b.onclick=async()=>{
  const s=stages.find(x=>x.id===b.dataset.sp);const lc=s.lifecycle||'done';const i=stages.findIndex(x=>x.id===s.id);
  const outcomes=(await lookupRows(app.office,'stageOutcome')).map(r=>r.value);
  const card=modal(`<h2 class="modal-title">${esc(s.stageType||'مرحلة')} <small class="badge">${esc(LIFECYCLE[lc]||'')}</small></h2>
   <div class="sp-menu">
    ${s.id!==file.currentStageId?'<button class="ghost" data-a="current">● اجعلها المرحلة الحالية</button>':''}
    ${lc!=='done'?'<button class="ghost" data-a="done">✓ إنهاء المرحلة</button>':''}
    ${lc!=='skipped'?'<button class="ghost" data-a="skipped">⤼ تخطي (لم تحدث)</button>':''}
    ${lc!=='planned'?'<button class="ghost" data-a="planned">○ إرجاعها لمخططة</button>':''}
    <button class="ghost" data-a="up" ${i?'':'disabled'}>▲ تقديم</button><button class="ghost" data-a="down" ${i<stages.length-1?'':'disabled'}>▼ تأخير</button>
    <button class="ghost" data-a="open">✎ البيانات القضائية للمرحلة (الرقم، المحكمة، الدائرة…)</button>
    <button class="ghost" data-a="style" title="تخصيص شكل هذه المرحلة وحدها — لا يتأثر أي مرحلة أخرى">🎨 تخصيص عرض هذه المرحلة</button>
    ${!s.caseNumber&&!s.filingDate?'<button class="ghost danger" data-a="remove">✕ حذف المرحلة</button>':''}
   </div>
   <form id="sp-out" class="inline-form"><label>النتيجة / التصرف<input name="outcome" list="sp-outs" value="${esc(s.outcome||'')}" placeholder="اختر أو اكتب — «أخرى» مسموحة دائمًا"></label><datalist id="sp-outs">${outcomes.map(o=>`<option value="${esc(o)}">`).join('')}</datalist><button class="primary">حفظ النتيجة</button></form>`);
  card.querySelector('#sp-out').onsubmit=e=>{e.preventDefault();closeModal();run(setStageLifecycle(app.office,file.id,s.id,lc,{outcome:new FormData(e.target).get('outcome')}))};
  card.querySelector('.sp-menu').onclick=e=>{const a=e.target.closest('[data-a]')?.dataset.a;if(!a)return;closeModal();
   if(a==='current')run(setCurrentStage(app.office,file.id,s.id));
   else if(['done','skipped','planned'].includes(a))run(setStageLifecycle(app.office,file.id,s.id,a));
   else if(a==='up'||a==='down')run(moveStage(app.office,file.id,s.id,a==='up'?-1:1));
   else if(a==='open')app.go('case:'+s.id);
   else if(a==='style'){const li=document.querySelector(`[data-uxc-id="stage:${CSS.escape(s.id)}"]`);if(li)openCustomizerForElement(li);else toast('تعذر العثور على عنصر المرحلة في الصفحة الحالية','error')}
   else if(a==='remove')confirmBox(`حذف مرحلة «${esc(s.stageType)}» من المسار؟`,{okText:'حذف'}).then(ok=>ok&&run(removePlannedStage(app.office,file.id,s.id)));
  };
 });
}
export async function openRelatedMenu(app,file,anchor){
 const tax=await taxonomy(app.office);
 const clientLink=file.clientFileId?await app.office.r.clientFiles.get(file.clientFileId):null;
 const result=file.x_result||'';
 const sugg=RELATED_SUGGESTIONS.filter(s=>s.when.fileType===file.fileTypeId&&(!s.when.result||s.when.result===result));
 const card=modal(`<h2 class="modal-title">إنشاء ملف مرتبط بـ ${esc(formatFileNumber(file.fileNumber)||file.title||'')}</h2>
  <p class="muted small">الملف الجديد يُنشأ داخل ملف نفس الموكل، وتُربط أطرافه تلقائيًا، ويبقى الملف الحالي كما هو بكل بياناته.</p>
  ${sugg.length?`<h4>مقترح بناءً على بيانات الملف</h4><div class="sp-menu">${sugg.map((s,i)=>`<button class="primary" data-s="${i}">${esc(s.label)}</button>`).join('')}</div>`:''}
  <h4>أو اختر نوع العلاقة</h4><div class="sp-menu">${GENERIC_RELATED.map((g,i)=>`<button class="ghost" data-g="${i}">${esc(g.label)} <small class="muted">(${esc(RELATION_TYPES[g.relation].label)})</small></button>`).join('')}</div>`);
 card.addEventListener('click',e=>{const b=e.target.closest('button[data-s],button[data-g]');if(!b)return;closeModal();
  const related={fileId:file.id,relationCode:'',title:`${formatFileNumber(file.fileNumber)} — ${file.title}`};
  let o={clientId:clientLink?.clientId||'',related};
  if(b.dataset.s!==undefined){const s=sugg[Number(b.dataset.s)];related.relationCode=s.relation;o={...o,categoryId:s.targetCategory,allowedTypes:s.targetTypes,fileTypeId:s.targetTypes.length===1?s.targetTypes[0]:''}}
  else{const g=GENERIC_RELATED[Number(b.dataset.g)];related.relationCode=g.relation;o.categoryId=file.categoryId||''}
  if(!o.clientId){toast('هذا الملف غير مرتبط بموكل بعد. أضف الموكل في الأطراف أولًا.','error');return}
  openLegalFileWizard(app,o);
 });
 void anchor;void tax;
}
export {formatDateTime};

// ======================= اختيار الموكل ثم المعالج (من «+ إضافة» وقائمة الملفات) =======================
export async function startNewLegalFile(app){
 const {openEntityForm}=await import('../ui/form.js');
 const {normalizeArabic}=await import('../core/search-normalizer.js');
 const card=modal(`<h2 class="modal-title">ملف قانوني جديد</h2><p class="muted small">كل ملف يتبع ملف موكل. اختر الموكل أو أضف موكلًا جديدًا.</p>
  <input type="search" id="pc-q" placeholder="اسم الموكل أو رقم الملف الرئيسي (مثل 2/2026) أو الرقم القومي" autocomplete="off" aria-label="بحث عن موكل">
  <div id="pc-r" class="cf-lines pc-results"></div>
  <div class="form-actions"><button class="primary" data-pc-new>+ موكل جديد</button><button class="ghost" data-pc-legacy title="النموذج الكامل بدون معالج">النموذج الكامل</button></div>`);
 const q=card.querySelector('#pc-q'),r=card.querySelector('#pc-r');let t=0,seq=0;
 const recent=async()=>{try{const x=await app.office.r.clients.reportRange({index:'createdAt',direction:'prev',limit:8});return Array.isArray(x)?x:(x.rows||[])}catch{return []}};
 const draw=(rows,title)=>{r.innerHTML=(title?`<small class="muted">${title}</small>`:'')+(rows.filter(c=>!c.isDeleted).map(c=>`<button class="cf-line" data-id="${esc(c.id)}"><span class="cf-avatar sm">${esc((c.fullName||'؟').charAt(0))}</span><span class="cf-line-main"><b>${esc(c.fullName)}</b><small>${fileNumberChip(c,{withKind:true})} ${esc(phonesOf(c)[0]||'')}</small></span></button>`).join('')||'<p class="muted small">لا نتائج — أضف موكلًا جديدًا.</p>')};
 const run=async()=>{const my=++seq;const v=q.value.trim();if(v.length<2){const rows=await recent();if(my===seq)draw(rows,'أحدث الموكلين');return}
  const n=normalizeArabic(v),code=v.toUpperCase();
  // البحث برقم ملف رئيسي بصيغة العرض (2/2026) يترجم داخليًا إلى الكود التقني للفهرس
  let codeQ=/^CL/.test(code)?code:'';
  if(!codeQ){const p=/^(\d{1,6})\s*\/\s*(\d{4})$/.exec(v);if(p)codeQ=`CL-${p[2]}-${String(Number(p[1])).padStart(6,'0')}`}
  const [a,b,c]=await Promise.all([app.office.r.clients.prefix('fullNameNormalized',n,10),codeQ?app.office.r.clients.prefix('clientCode',codeQ,10).catch(()=>[]):[],/^\d{4,}/.test(v)?app.office.r.clients.prefix('nationalId',v,10).catch(()=>[]):[]]);
  if(my===seq)draw([...new Map([...b,...c,...a].map(x=>[x.id,x])).values()])};
 q.oninput=()=>{clearTimeout(t);t=setTimeout(run,180)};run();setTimeout(()=>q.focus(),30);
 q.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();r.querySelector('[data-id]')?.click()}};
 r.onclick=e=>{const b=e.target.closest('[data-id]');if(!b)return;closeModal();openLegalFileWizard(app,{clientId:b.dataset.id})};
 card.querySelector('[data-pc-new]').onclick=()=>{closeModal();openEntityForm(app,'clients',{preset:{fullName:/\d|CL/i.test(q.value)?'':q.value.trim()},onSaved:async(row,isNew)=>{if(isNew)setTimeout(()=>openLegalFileWizard(app,{clientId:row.id}),60)}})};
 card.querySelector('[data-pc-legacy]').onclick=()=>{closeModal();openEntityForm(app,'files',{onSaved:async(row,isNew)=>{if(isNew)return app.go('file:'+row.id)}})};
}
