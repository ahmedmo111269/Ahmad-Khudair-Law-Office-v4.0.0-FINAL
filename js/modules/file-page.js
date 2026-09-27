// صفحة الملف القانوني الداخلي (الوحدة الأساسية). الرقم الداخلي مستقل عن أي رقم قضائي، والملف قد لا يحتوي قضية أصلًا.
// التبويبات: ملخص، الأطراف، البيانات القضائية (المراحل/الأرقام)، الجلسات، الإجراءات، الأحكام، الملاحظات، العلاقات،
// بيانات إضافية (حسب النوع)، الأتعاب والمستندات، سجل النشاط.
import {esc} from '../ui/dom.js';
import {toast} from '../ui/toast.js';
import {modal,closeModal,confirmBox} from '../ui/modal.js';
import {openEntityForm} from '../ui/form.js';
import {mountGrid} from '../ui/datagrid.js';
import {ENTITIES,FILE_TYPE_GROUPS,fileTypeGroup,label,fmtDate,isClosedFile,displayValue} from '../domain/entities.js';
import {resolveRefs,fileStages,fileChildren,refLabel} from '../services/entity-query.js';
import {fileParties,fileRelations,archiveFile,reopenFile,closeFile,removeParty} from '../services/legal-files.js';
import {deleteEntity} from '../services/entity-save.js';
import {kvHtml,bindRefLinks,notFound} from './record-page.js';
import {sectionGrid,columnsFor,openRow} from './list-page.js';
import {userError} from '../core/errors.js';
import {localDate} from '../core/clock.js';

const TABS=[['summary','ملخص'],['parties','الأطراف'],['judicial','البيانات القضائية'],['hearings','الجلسات'],['procedures','الإجراءات'],['judgments','الأحكام'],['notes','الملاحظات'],['relations','العلاقات'],['extra','بيانات إضافية'],['money','الأتعاب والمستندات'],['activity','سجل النشاط']];
const BASE_KEYS=['fileNumber','title','fileType','mainCategory','subCategory','status','priority','openedAt','responsibleLawyer','coLawyers','staff','nextStep','nextStepDate','closedAt','closeReason','notes','lastActivityAt'];

export async function filePage(app,id){
 const f=await app.office.r.files.get(id);
 if(!f||f.isDeleted)return notFound('الملف');
 const [parties,stages]=await Promise.all([fileParties(app.office,id),fileStages(app.office,id)]);
 app.__file={id,f,parties,stages};
 app.__fileTab=app.__fileTab&&app.__fileTab.id===id?app.__fileTab:{id,tab:'summary'};
 const clients=parties.filter(p=>p.partyKind==='client'),opps=parties.filter(p=>p.partyKind==='opponent');
 const cur=stages.at(-1);
 return `<div class="record-head file-head"><div><small class="muted">ملف داخلي رقم</small><h2><span class="file-no">${esc(f.fileNumber||'')}</span> ${esc(f.title||'')}</h2>
  <p class="badges">${f.fileType?`<span class="badge type">${esc(f.fileType)}</span>`:''}<span class="badge ${isClosedFile(f)?'closed':'open'}">${esc(label(f.status||'open'))}</span>${f.isArchived?`<span class="badge warn">مؤرشف${f.archivedReason?' — '+esc(f.archivedReason):''}</span>`:''}${f.priority&&f.priority!=='normal'?`<span class="badge warn">${esc(label(f.priority))}</span>`:''}${f.responsibleLawyer?`<span class="badge">المحامي: ${esc(f.responsibleLawyer)}</span>`:''}</p>
  <p class="muted small">${clients.length?`الموكل: ${clients.map(p=>`${esc(p.name)} (${esc(p.role||'موكل')})`).join('، ')}`:'لا يوجد موكل مرتبط بعد'}${opps.length?` — الخصم: ${opps.map(p=>esc(p.name)).join('، ')}`:''}${cur?` — المرحلة الحالية: ${esc(refLabel('cases',cur))}`:' — لا توجد أرقام قضائية (ملف بلا قضية)'}</p></div>
  <div class="head-actions"><button class="ghost" data-file-edit>تعديل البيانات</button>${f.isArchived||isClosedFile(f)?'<button class="ghost" data-file-reopen>إعادة فتح</button>':'<button class="ghost" data-file-close>إنهاء الملف</button><button class="ghost" data-file-archive>أرشفة</button>'}</div></div>
 <nav class="tabs" role="tablist">${TABS.map(([k,l])=>`<button type="button" role="tab" data-tab="${k}" aria-selected="${app.__fileTab.tab===k}" class="${app.__fileTab.tab===k?'active':''}">${l}${k==='parties'?` <small>${parties.length}</small>`:k==='judicial'?` <small>${stages.length}</small>`:''}</button>`).join('')}</nav>
 <div id="file-tab" role="tabpanel"></div>`;
}

export async function bindFilePage(app,id){
 const root=document.querySelector('#main-content');const {f}=app.__file;
 root.querySelector('[data-file-edit]').onclick=()=>openEntityForm(app,'files',{id});
 root.querySelector('[data-file-archive]')?.addEventListener('click',async()=>{const r=await confirmBox('أرشفة الملف؟ يبقى الملف وكل بياناته محفوظة ويمكن إعادة فتحه في أي وقت.',{okText:'أرشفة',input:true,placeholder:'سبب الأرشفة (اختياري)'});if(!r.ok)return;try{await archiveFile(app.office,id,r.value);toast('تمت الأرشفة');app.refresh()}catch(e){toast(userError(e),'error')}});
 root.querySelector('[data-file-reopen]')?.addEventListener('click',async()=>{const r=await confirmBox('إعادة فتح الملف؟',{okText:'إعادة فتح',input:true,placeholder:'سبب إعادة الفتح (اختياري)'});if(!r.ok)return;try{await reopenFile(app.office,id,r.value);toast('تمت إعادة فتح الملف');app.refresh()}catch(e){toast(userError(e),'error')}});
 root.querySelector('[data-file-close]')?.addEventListener('click',async()=>{const r=await confirmBox('تسجيل انتهاء الملف (حالة إدارية فقط)؟',{okText:'إنهاء',input:true,placeholder:'سبب الانتهاء (اختياري)'});if(!r.ok)return;try{await closeFile(app.office,id,{closeReason:r.value});toast('تم تسجيل انتهاء الملف');app.refresh()}catch(e){toast(userError(e),'error')}});
 root.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{app.__fileTab.tab=b.dataset.tab;root.querySelectorAll('[data-tab]').forEach(x=>{x.classList.toggle('active',x===b);x.setAttribute('aria-selected',x===b)});renderTab(app).catch(e=>app.fail(e))});
 void f;
 await renderTab(app);
}

const reload=app=>app.refresh();
const stageOptions=stages=>stages.map(s=>({id:s.id,label:refLabel('cases',s)}));

async function renderTab(app){
 const el=document.querySelector('#file-tab');const {id,f,parties,stages}=app.__file;const tab=app.__fileTab.tab;const office=app.office;
 el.innerHTML='<div class="loading">جارٍ التحميل…</div>';
 const needStage=what=>`<div class="notice">لإضافة ${what} يجب أولًا إضافة رقم قضائي / مرحلة في تبويب «البيانات القضائية». الملف نفسه لا يحتاج قضية.</div>`;
 if(tab==='summary'){
  const today=localDate();
  const [hearings,procedures]=await Promise.all([fileChildren(office,id,'hearings'),office.r.procedures.byIndex('fileId',id,2000)]);
  const next=hearings.filter(h=>h.hearingDate>=today).sort((a,b)=>a.hearingDate.localeCompare(b.hearingDate))[0];
  const last=hearings.filter(h=>h.hearingDate<today).sort((a,b)=>b.hearingDate.localeCompare(a.hearingDate))[0];
  const openProc=procedures.filter(p=>!p.status||['open','pending'].includes(p.status));
  const refs=new Map();
  el.innerHTML=`<div class="stats-grid"><div class="stat-card"><strong>${stages.length}</strong><span>أرقام / مراحل</span></div><div class="stat-card"><strong>${hearings.length}</strong><span>جلسات</span></div><div class="stat-card"><strong>${openProc.length}</strong><span>أعمال مفتوحة</span></div><div class="stat-card"><strong>${parties.length}</strong><span>أطراف</span></div></div>
   <div class="grid2"><section class="panel"><h3>الجلسة القادمة</h3>${next?`<p><b>${fmtDate(next.hearingDate)}</b> ${esc(next.hearingTime||'')} — ${esc(next.court||'')} ${esc(next.reason||'')}</p><button class="link" data-open="hearings:${next.id}">فتح الجلسة</button>`:'<p class="muted">لا توجد جلسة قادمة مسجلة.</p>'}</section>
   <section class="panel"><h3>آخر جلسة</h3>${last?`<p><b>${fmtDate(last.hearingDate)}</b> — ${esc(last.result||'لم يُسجل القرار')}</p>${last.adjournedTo?`<p class="muted">التأجيل إلى ${fmtDate(last.adjournedTo)}</p>`:''}`:'<p class="muted">لا توجد جلسات سابقة.</p>'}</section></div>
   ${stages.length?`<section class="panel"><h3>تسلسل المراحل</h3><ol class="stage-chain">${stages.map(s=>`<li><button class="link" data-open-case="${s.id}">${esc(s.stageType||s.numberType||'مرحلة')}<br><small>${esc(s.caseNumber||'بدون رقم')}${s.caseYear?'/'+esc(s.caseYear):''}</small></button></li>`).join('')}</ol></section>`:''}
   <section class="panel"><div class="panel-head"><h3>البيانات الأساسية</h3><button class="ghost" data-file-edit2>تعديل</button></div>${kvHtml(ENTITIES.files.fields.filter(x=>BASE_KEYS.includes(x.k)),f,refs)}${f.archivedAt?`<p class="muted small">أُرشف في ${fmtDate(f.archivedAt)}${f.archivedReason?' — السبب: '+esc(f.archivedReason):''}</p>`:''}${f.reopenedAt?`<p class="muted small">أُعيد فتحه في ${fmtDate(f.reopenedAt)}${f.reopenReason?' — '+esc(f.reopenReason):''}</p>`:''}</section>
   <div class="sec-actions"><button class="ghost danger" data-file-delete>حذف منطقي للملف</button></div>`;
  el.querySelector('[data-file-edit2]').onclick=()=>openEntityForm(app,'files',{id});
  el.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>app.go('rec:'+b.dataset.open));
  el.querySelectorAll('[data-open-case]').forEach(b=>b.onclick=()=>app.go('case:'+b.dataset.openCase));
  el.querySelector('[data-file-delete]').onclick=async()=>{if(!await confirmBox('حذف منطقي للملف؟ لا يُسمح إذا كان للملف قضايا/مراحل غير محذوفة. البيانات لا تُمحى نهائيًا.',{okText:'حذف منطقي'}))return;try{await deleteEntity(office,'files',id);toast('تم الحذف المنطقي');app.go('files')}catch(e){toast(userError(e),'error')}};
  return;
 }
 if(tab==='parties'){
  el.innerHTML=`<div class="sec-actions"><button class="primary" data-add-party>+ إضافة طرف</button><span class="muted small">الشخص الواحد قد يكون مدعيًا في ملف ومدعى عليه في ملف آخر؛ الصفة تُسجل لكل ملف.</span></div><div data-grid></div>`;
  el.querySelector('[data-add-party]').onclick=()=>openEntityForm(app,'fileParties',{preset:{fileId:id},onSaved:()=>reload(app)});
  const refs=await resolveRefs(office,parties,ENTITIES.fileParties.fields);
  mountGrid(el.querySelector('[data-grid]'),{columns:columnsFor('fileParties',refs).filter(c=>c.key!=='fileId'),rows:parties,title:`أطراف الملف ${f.fileNumber}`,storageKey:'file:parties',onRowClick:p=>partyActions(app,p)});
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
  const store=tab;const rows=await fileChildren(office,id,store);
  const what=store==='hearings'?'جلسة':'حكم';
  el.innerHTML=stages.length?`<div class="sec-actions"><button class="primary" data-add>+ ${what}</button></div><div data-grid></div>`:`${needStage(what)}<div data-grid></div>`;
  el.querySelector('[data-add]')?.addEventListener('click',()=>{const cur=stages.at(-1);openEntityForm(app,store,{stageOptions:stageOptions(stages),preset:{caseId:cur?.id||'',...(store==='hearings'?{court:cur?.courtId||'',chamber:cur?.chamber||''}:{court:cur?.courtId||'',chamber:cur?.chamber||'',stage:cur?.stageType||''})},onSaved:()=>reload(app)})});
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
  const rows=(await office.r.caseNotes.byIndex('fileId',id,2000)).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
  el.innerHTML=`<div class="sec-actions"><button class="primary" data-add>+ ملاحظة</button></div><div data-grid></div>`;
  el.querySelector('[data-add]').onclick=()=>openEntityForm(app,'caseNotes',{preset:{fileId:id},stageOptions:stageOptions(stages),onSaved:()=>reload(app)});
  await sectionGrid(app,el.querySelector('[data-grid]'),'caseNotes',rows,{storageKey:'file:notes'});
  return;
 }
 if(tab==='relations'){
  const rels=await fileRelations(office,id);
  const others=await office.r.files.getMany(rels.map(r=>r.otherFileId));const om=new Map(others.map(x=>[x.id,x]));
  const rows=rels.map(r=>({...r,otherLabel:refLabel('files',om.get(r.otherFileId)),dirLabel:r.direction==='out'?'هذا الملف ←':'← من ملف آخر'}));
  el.innerHTML=`<div class="sec-actions"><button class="primary" data-add>+ ربط بملف آخر</button><span class="muted small">مثال: ملف استئناف مرتبط بملف الدعوى الأصلية، أو ملف تنفيذ لحكم.</span></div><div data-grid></div>`;
  el.querySelector('[data-add]').onclick=()=>openEntityForm(app,'fileRelations',{preset:{sourceFileId:id},onSaved:()=>reload(app)});
  mountGrid(el.querySelector('[data-grid]'),{title:'علاقات الملف',storageKey:'file:relations',rows,columns:[
   {key:'dirLabel',label:'الاتجاه'},{key:'relationType',label:'نوع العلاقة'},{key:'otherLabel',label:'الملف المرتبط'},{key:'notes',label:'ملاحظات'},{key:'createdAt',label:'تاريخ الربط',type:'date',text:r=>fmtDate(r.createdAt)}],
   onRowClick:r=>relationActions(app,r)});
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
  const refs=new Map();
  mountGrid(el.querySelector('[data-grid]'),{columns:columnsFor('activityLog',refs).filter(c=>c.key!=='fileId'),rows,title:`سجل نشاط الملف ${f.fileNumber}`,storageKey:'file:activity'});
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
