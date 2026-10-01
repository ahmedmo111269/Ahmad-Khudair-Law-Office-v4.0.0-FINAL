// صفحات السجل: الموكل، الخصم، القضية/المرحلة، وصفحة عامة لأي سجل (rec:store:id).
// كل صفحة: قسم بيانات كاملة قابل للطي مع زر تعديل، وأقسام جداول قابلة للطي للسجلات المرتبطة.
import {esc} from '../ui/dom.js';
import {toast} from '../ui/toast.js';
import {confirmBox} from '../ui/modal.js';
import {openEntityForm} from '../ui/form.js';
import {ENTITIES,displayValue,label,fmtDate,phonesOf} from '../domain/entities.js';
import {resolveRefs,clientRelated,opponentRelated,refLabel} from '../services/entity-query.js';
import {deleteEntity} from '../services/entity-save.js';
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
import {registerPageLayout,resolveSectionOrder,migrateLegacySectionOrder,openPageCustomizer} from '../ui/page-layout.js';

export function kvHtml(fields,row,refs,{skipEmpty=true}={}){
 const items=fields.map(f=>{const v=displayValue(f,row,refs);if(skipEmpty&&!v)return '';const link=f.ref&&row[f.k]?` data-open-ref="${esc(f.ref)}:${esc(row[f.k])}"`:'';return `<div class="kv-item${f.t==='textarea'?' wide':''}"><dt>${esc(f.l)}</dt><dd${link}>${link?`<button type="button" class="link">${esc(v)}</button>`:esc(v)}</dd></div>`}).join('');
 return items?`<dl class="kv">${items}</dl>`:'<p class="muted">لا توجد بيانات مسجلة بعد. اضغط «تعديل البيانات» لإضافتها.</p>';
}
export function section(key,title,count,body,{open=true,add=''}={}){
 return `<details class="rec-section" data-sec="${esc(key)}" data-section-id="${esc(key)}" ${open?'open':''}><summary><span>${esc(title)}</span>${count!==null&&count!==undefined?`<span class="count">${count}</span>`:''}</summary>${add?`<div class="sec-actions">${add}</div>`:''}<div class="sec-body">${body}</div></details>`;
}
const refRoute={files:'file',cases:'case',clients:'client',opponents:'opponent'};
function relatedCount(r,key,rows){return `${rows.length}${r.more?.[key]?'+':''}`}
function relatedLimitNotice(r){
 const labels={files:'الملفات',cases:'القضايا',hearings:'الجلسات',powersOfAttorney:'التوكيلات',appointments:'المواعيد',communications:'الاتصالات'};
 const limited=Object.keys(labels).filter(key=>r.more?.[key]);
 if(!limited.length)return '';
 return `<div class="notice" role="status"><b>عرض محدود:</b> قد توجد سجلات مرتبطة إضافية. عُرضت ${limited.map(key=>esc(labels[key])).join('، ')} حتى حد الصفحة؛ استخدم القوائم والبحث العام للوصول إلى بقية السجلات. لم تُحذف أو تُغيّر أي بيانات.</div>`;
}
const CLIENT_SECTIONS=[['data','البيانات الكاملة'],['files','الملفات'],['cases','القضايا والمراحل'],['poa','التوكيلات'],['hearings','الجلسات'],['appointments','المواعيد'],['communications','الاتصالات']];
// أقسام صفحة الموكل ضمن نظام ترتيب الأقسام المركزي (SectionLayoutManager).
// الترتيب القديم المحفوظ في client-sections:order يُرحَّل مرة واحدة إلى المخزن الموحّد.
registerPageLayout({pageId:'client-details',title:'صفحة الموكل',sections:CLIENT_SECTIONS.map(([id,title])=>({id,title}))});
// صفحة الخصم: نفس النظام بأقسامها.
registerPageLayout({pageId:'opponent-details',title:'صفحة الخصم',sections:[{id:'data',title:'البيانات الكاملة'},{id:'files',title:'الملفات'},{id:'cases',title:'القضايا والمراحل'},{id:'hearings',title:'الجلسات'}]});
function orderedClientSectionKeys(){
 migrateLegacySectionOrder('client-details','client-sections:order');
 return resolveSectionOrder('client-details');
}
export function bindRefLinks(app,root){root.querySelectorAll('[data-open-ref]').forEach(el=>el.addEventListener('click',()=>{const [s,id]=el.dataset.openRef.split(':');if(refRoute[s])app.go(`${refRoute[s]}:${id}`);else app.go(`rec:${s}:${id}`)}))}

async function confirmDelete(app,store,id){
 if(!await confirmBox(`حذف منطقي لهذا السجل (${esc(ENTITIES[store].label)})؟ يبقى محفوظًا في قاعدة البيانات ويمكن مراجعته من مركز الإصلاح، ولا يُحذف نهائيًا.`,{okText:'حذف منطقي'}))return;
 try{await deleteEntity(app.office,store,id);toast('تم الحذف المنطقي');app.back()}catch(e){toast(userError(e),'error')}
}

// ===== صفحة الموكل =====
export async function clientPage(app,id){
 const c=await app.office.r.clients.get(id);
 if(!c||c.isDeleted)return notFound('الموكل');
 trackRecent('client:'+id,c.fullName||'موكل',{icon:'users',sub:c.clientCode?formatFileNumber(c.clientCode):''});
 app.__rec={store:'clients',id,related:await clientRelated(app.office,id)};
 const r=app.__rec.related;
 const refs=await resolveRefs(app.office,[c],ENTITIES.clients.fields);
 const parts={
  data:section('data','البيانات الكاملة',null,kvHtml(ENTITIES.clients.fields,c,refs)+'<div class="sec-actions end"><button class="primary" data-rec-edit>تعديل البيانات</button></div>',{open:false}),
  files:section('files','الملفات',relatedCount(r,'files',r.files),'<div data-grid="files"></div>',{add:'<button class="ghost" data-add="files">+ ملف جديد لهذا الموكل</button>'}),
  cases:section('cases','القضايا والمراحل',relatedCount(r,'cases',r.cases),'<div data-grid="cases"></div>'),
  poa:section('poa','التوكيلات',relatedCount(r,'powersOfAttorney',r.poas),'<div data-grid="powersOfAttorney"></div>',{add:'<button class="ghost" data-add="powersOfAttorney">+ توكيل</button>'}),
  hearings:section('hearings','الجلسات',relatedCount(r,'hearings',r.hearings),'<div data-grid="hearings"></div>'),
  appointments:section('appointments','المواعيد',relatedCount(r,'appointments',r.appointments),'<div data-grid="appointments"></div>',{open:false,add:'<button class="ghost" data-add="appointments">+ موعد</button>'}),
  communications:section('communications','الاتصالات',relatedCount(r,'communications',r.communications),'<div data-grid="communications"></div>',{open:false,add:'<button class="ghost" data-add="communications">+ اتصال</button>'})
 };
 return `<div class="record-head"><div><small class="muted">موكل</small><h2>${esc(c.fullName)}</h2><p class="badges">${c.clientCode?fileNumberChip(c):''}${phonesOf(c).map(p=>`<span class="badge">☎ ${esc(p)}</span>`).join('')}${c.nationalId?`<span class="badge">ر.ق ${esc(c.nationalId)}</span>`:''}<span class="badge">${esc(label(c.status||'active'))}</span></p></div>
 <div class="head-actions"><button class="primary" data-route="cfile:${esc(id)}">📂 فتح ملف الموكل</button><button class="ghost" data-customize-page title="ترتيب الأقسام وإظهارها وحالة الطي وإعدادات العرض">⚙ تخصيص الصفحة</button><button class="ghost" data-rec-edit>تعديل البيانات</button><button class="ghost danger" data-rec-delete>حذف منطقي</button></div></div>${relatedLimitNotice(r)}${orderedClientSectionKeys().map(key=>parts[key]).join('')}`;
}
export async function bindClientPage(app,id){
 const root=document.querySelector('#main-content');const r=app.__rec.related;
 root.querySelector('[data-customize-page]')?.addEventListener('click',()=>openPageCustomizer(app,{pageId:'client-details',root}));
 root.querySelectorAll('[data-rec-edit]').forEach(b=>b.onclick=()=>openEntityForm(app,'clients',{id}));
 root.querySelector('[data-rec-delete]').onclick=()=>confirmDelete(app,'clients',id);
 root.querySelectorAll('[data-add]').forEach(b=>b.onclick=async()=>{const s=b.dataset.add;if(s==='files'){const {openLegalFileWizard}=await import('./client-file.js');return openLegalFileWizard(app,{clientId:id})}openEntityForm(app,s,{preset:{clientId:id}})});
 const roleCol={key:'clientRole',label:'صفة الموكل',get:x=>x.clientRole,text:x=>x.clientRole||''};
 await Promise.all([
  sectionGrid(app,root.querySelector('[data-grid="files"]'),'files',r.files,{storageKey:'client:files',extra:[roleCol]}),
  sectionGrid(app,root.querySelector('[data-grid="cases"]'),'cases',r.cases,{storageKey:'client:cases'}),
  sectionGrid(app,root.querySelector('[data-grid="powersOfAttorney"]'),'powersOfAttorney',r.poas,{storageKey:'client:poa'}),
  sectionGrid(app,root.querySelector('[data-grid="hearings"]'),'hearings',r.hearings,{storageKey:'client:hearings'}),
  sectionGrid(app,root.querySelector('[data-grid="appointments"]'),'appointments',r.appointments,{storageKey:'client:appointments'}),
  sectionGrid(app,root.querySelector('[data-grid="communications"]'),'communications',r.communications,{storageKey:'client:communications'})
 ]);
}

// ===== صفحة الخصم =====
export async function opponentPage(app,id){
 const o=await app.office.r.opponents.get(id);
 if(!o||o.isDeleted)return notFound('الخصم');
 trackRecent('opponent:'+id,o.name||'خصم',{icon:'userX',sub:o.capacity||''});
 app.__rec={store:'opponents',id,related:await opponentRelated(app.office,id)};
 const r=app.__rec.related;
 const refs=await resolveRefs(app.office,[o],ENTITIES.opponents.fields);
 return `<div class="record-head"><div><small class="muted">خصم</small><h2>${esc(o.name)}</h2><p class="badges">${phonesOf(o).map(p=>`<span class="badge">☎ ${esc(p)}</span>`).join('')}${o.capacity?`<span class="badge">${esc(o.capacity)}</span>`:''}</p></div>
 <div class="head-actions"><button class="ghost" data-customize-page title="ترتيب الأقسام وإظهارها وحالة الطي وإعدادات العرض">⚙ تخصيص الصفحة</button><button class="ghost" data-rec-edit>تعديل البيانات</button><button class="ghost danger" data-rec-delete>حذف منطقي</button></div></div>
 ${section('data','البيانات الكاملة',null,kvHtml(ENTITIES.opponents.fields,o,refs)+'<div class="sec-actions end"><button class="primary" data-rec-edit>تعديل البيانات</button></div>',{open:false})}
 ${relatedLimitNotice(r)}${section('files','الملفات',relatedCount(r,'files',r.files),'<div data-grid="files"></div>')}
 ${section('cases','القضايا والمراحل',relatedCount(r,'cases',r.cases),'<div data-grid="cases"></div>')}
 ${section('hearings','الجلسات',relatedCount(r,'hearings',r.hearings),'<div data-grid="hearings"></div>')}`;
}
export async function bindOpponentPage(app,id){
 const root=document.querySelector('#main-content');const r=app.__rec.related;
 root.querySelector('[data-customize-page]')?.addEventListener('click',()=>openPageCustomizer(app,{pageId:'opponent-details',root}));
 root.querySelectorAll('[data-rec-edit]').forEach(b=>b.onclick=()=>openEntityForm(app,'opponents',{id}));
 root.querySelector('[data-rec-delete]').onclick=()=>confirmDelete(app,'opponents',id);
 const roleCol={key:'opponentRole',label:'صفة الخصم',get:x=>x.opponentRole,text:x=>x.opponentRole||''};
 await Promise.all([
  sectionGrid(app,root.querySelector('[data-grid="files"]'),'files',r.files,{storageKey:'opp:files',extra:[roleCol]}),
  sectionGrid(app,root.querySelector('[data-grid="cases"]'),'cases',r.cases,{storageKey:'opp:cases'}),
  sectionGrid(app,root.querySelector('[data-grid="hearings"]'),'hearings',r.hearings,{storageKey:'opp:hearings'})
 ]);
}

// ===== صفحة عامة لأي سجل + القضية/المرحلة =====
const CASE_CHILDREN=[['hearings','الجلسات'],['judgments','الأحكام'],['procedures','الأعمال الإدارية'],['expertReports','الخبراء'],['serviceRecords','المحضرين والإعلانات'],['execution','التنفيذ']];
/** أقسام صفحة السجل العامة حسب المتجر — تُسجَّل في نظام ترتيب الأقسام المركزي. */
function recordSectionsFor(store){
 const secs=[{id:'data',title:'البيانات الكاملة'}];
 if(store==='hearings')secs.push({id:'hearing-cycle',title:'دورة الجلسات'});
 if(store==='serviceRecords')secs.push({id:'service-cycle',title:'دورة الإعلان / الإنذار'});
 if(store==='cases'){secs.push({id:'case-timeline',title:'الخط الزمني الموحد للقضية'});CASE_CHILDREN.forEach(([id,title])=>secs.push({id,title}))}
 if(store==='fees')secs.push({id:'payments',title:'الدفعات'});
 secs.push({id:'activity',title:'سجل النشاط'});
 return secs;
}
async function createRelatedFromRecord(app,row,store){
 const file=row.fileId?await app.office.r.files.get(row.fileId):null;
 const clientFile=file?.clientFileId?await app.office.r.clientFiles.get(file.clientFileId):null;
 if(!file||!clientFile?.clientId){toast('لا يمكن إنشاء ملف موكل مرتبط تلقائيًا لأن الملف الحالي غير مرتبط بملف موكل.','error');return}
 openLegalFileWizard(app,{clientId:clientFile.clientId,related:{fileId:file.id,relationCode:'RELATED_TO',title:`${formatFileNumber(file.fileNumber)||''} — ${file.title||ENTITIES.files.title(file)}`}});
}
export async function recordPage(app,store,id){
 const ent=ENTITIES[store];if(!ent)return notFound('السجل');
 registerPageLayout({pageId:`rec:${store}`,title:`صفحة ${ent.label}`,sections:recordSectionsFor(store)});
 const row=await app.office.r[store].get(id);
 if(!row||row.isDeleted)return notFound(ent.label);
 const refs=await resolveRefs(app.office,[row],ent.fields);
 const hearingSequence=store==='hearings'?await hearingCycle(app.office,id):null;
 const serviceSequence=store==='serviceRecords'?await serviceCycle(app.office,id):null;
 const children={};
 if(store==='cases')await Promise.all(CASE_CHILDREN.map(async([s])=>{children[s]=await app.office.r[s].byIndex('caseId',id,2000)}));
 if(store==='fees')children.feePayments=await app.office.r.feePayments.byIndex('feeId',id,2000);
 const activity=await app.office.r.activityLog.byIndex('entityId',id,200);
 const caseTimeline=store==='cases'?await buildCaseTimeline(app.office,id):null;
 app.__rec={store,id,row,children,activity,hearingSequence,serviceSequence,caseTimeline};
 trackRecent(`rec:${store}:${id}`,ent.title(row)||ent.label,{icon:{hearings:'calendar',appointments:'clock',communications:'phone',fees:'wallet',judgments:'landmark',procedures:'clipboard',caseNotes:'note',serviceRecords:'file',expertReports:'microscope',execution:'hammer'}[store]||'file',sub:ent.label});
 const parentBtns=ent.fields.filter(f=>f.ref&&row[f.k]).map(f=>`<button class="ghost" data-open-ref="${esc(f.ref)}:${esc(row[f.k])}">فتح ${esc(f.l.replace(/\s*\(.*\)/,''))}: ${esc(refs.get(row[f.k])||'')}</button>`).join('');
 const extraBtns=[
  store==='hearings'?'<button class="ghost" data-show-hearing-cycle>عرض دورة الجلسات</button><button class="ghost" data-next-hearing>+ الجلسة التالية</button><button class="ghost" data-hearing-service>+ إعلان مرتبط بالجلسة</button>':'',
  store==='serviceRecords'? '<button class="ghost" data-show-service-cycle>عرض دورة الإعلان</button><button class="primary" data-service-reannounce>+ إنشاء إعادة إعلان</button>':'',
  store==='cases'?'<button class="ghost" data-add="hearings">+ جلسة</button><button class="ghost" data-add="judgments">+ حكم</button><button class="ghost" data-case-service>+ إعلان / إنذار</button>':'',
  ['cases','hearings','judgments'].includes(store)&&row.fileId?'<button class="ghost" data-create-related-file>⤴ إنشاء ملف مستقل مرتبط</button>':'',
  store==='fees'? '<button class="ghost" data-add="feePayments">+ دفعة</button>':''
 ].join('');
 return `<div class="record-head"><div><small class="muted">${esc(ent.label)}</small><h2>${esc(ent.title(row)||ent.label)}</h2><div class="parent-links">${parentBtns}</div></div>
 <div class="head-actions">${extraBtns}<button class="ghost" data-customize-page title="ترتيب الأقسام وإظهارها وحالة الطي وإعدادات العرض">⚙ تخصيص الصفحة</button><button class="ghost" data-rec-edit>تعديل</button><button class="ghost danger" data-rec-delete>حذف منطقي</button></div></div>
 ${section('data','البيانات الكاملة',null,kvHtml(ent.fields,row,refs)+'<div class="sec-actions end"><button class="primary" data-rec-edit>تعديل البيانات</button></div>',{open:true})}
 ${store==='hearings'?section('hearing-cycle','دورة الجلسات',hearingSequence?.items.length||0,`<ol class="hearing-cycle">${(hearingSequence?.items||[]).map((h,i)=>`<li style="--depth:${Math.min(6,h.__depth||0)}"><button type="button" data-cycle-hearing="${esc(h.id)}"><time>${fmtDate(h.hearingDate)||'بدون تاريخ'}${h.hearingTime?' '+esc(h.hearingTime):''}</time><b>${esc(h.type||'جلسة')}</b><small>${esc(h.court||'')}${h.chamber?' · '+esc(h.chamber):''}${h.result?' — '+esc(h.result):h.adjournedTo?' — تأجيل إلى '+fmtDate(h.adjournedTo):''}</small></button>${i<(hearingSequence?.items.length||0)-1?'<span class="cycle-arrow">↓</span>':''}</li>`).join('')}</ol>`,{open:true}):''}
 ${store==='serviceRecords'?section('service-cycle','دورة الإعلان / الإنذار',serviceSequence?.records.length||0,`${serviceSequence?.hasBranches?'<p class="notice">توجد أكثر من إعادة مرتبطة بسجل واحد؛ عُرضت الفروع كما سُجلت.</p>':''}${serviceSequence?.more?'<p class="notice">تعرض دورة الملف أول 5000 سجل نشط؛ استخدم التقرير العام لتضييق نطاق السجلات الأقدم.</p>':''}<ol class="hearing-cycle service-cycle">${(serviceSequence?.records||[]).map((r,i)=>`<li style="--depth:${Math.min(6,r.__depth||0)}"><button type="button" data-cycle-service="${esc(r.id)}"><time>${fmtDate(r.createdAt)||'بدون تاريخ'}${r.serviceDate?' — '+fmtDate(r.serviceDate):''}</time><b>${esc(r.actionType||r.type||'إعلان')} · ${esc(r.internalNumber||'')}</b><small>${esc(r.partyName||'')} ${r.partyRole?'— '+esc(r.partyRole):''} · ${esc(r.status||'')}</small></button>${i<(serviceSequence?.records.length||0)-1?'<span class="cycle-arrow">↓</span>':''}</li>`).join('')}</ol>`,{open:true}):''}
 ${store==='cases'?section('case-timeline','الخط الزمني الموحد للقضية',caseTimeline?.timeline.length||0,`<div data-case-timeline>${timelineHtml(caseTimeline,{compact:true})}</div>`,{open:Boolean(caseTimeline&&caseTimeline.timeline.length>0)}):''}
 ${store==='cases'?CASE_CHILDREN.map(([s,l])=>section(s,l,children[s].length,`<div data-grid="${s}"></div>`,{open:children[s].length>0,add:`<button class="ghost" data-add="${s}">+ إضافة</button>`})).join(''):''}
 ${store==='fees'?section('payments','الدفعات',children.feePayments.length,'<div data-grid="feePayments"></div>',{add:'<button class="ghost" data-add="feePayments">+ دفعة</button>'}):''}
 ${section('activity','سجل النشاط',activity.length,'<div data-grid="activityLog"></div>',{open:false})}`;
}
export async function bindRecordPage(app,store,id){
 const root=document.querySelector('#main-content');const {row,children,activity}=app.__rec;
 root.querySelector('[data-customize-page]')?.addEventListener('click',()=>openPageCustomizer(app,{pageId:`rec:${store}`,root}));
 root.querySelectorAll('[data-rec-edit]').forEach(b=>b.onclick=()=>openEntityForm(app,store,{id}));
 root.querySelector('[data-rec-delete]').onclick=()=>confirmDelete(app,store,id);
 bindRefLinks(app,root);
 root.querySelector('[data-show-hearing-cycle]')?.addEventListener('click',()=>root.querySelector('[data-sec="hearing-cycle"]')?.scrollIntoView({behavior:'smooth',block:'center'}));
 root.querySelector('[data-show-service-cycle]')?.addEventListener('click',()=>root.querySelector('[data-sec="service-cycle"]')?.scrollIntoView({behavior:'smooth',block:'center'}));
 root.querySelectorAll('[data-cycle-hearing]').forEach(b=>b.onclick=()=>app.go('rec:hearings:'+b.dataset.cycleHearing));
 root.querySelectorAll('[data-cycle-service]').forEach(b=>b.onclick=()=>app.go('rec:serviceRecords:'+b.dataset.cycleService));
 root.querySelector('[data-service-reannounce]')?.addEventListener('click',()=>createReannouncement(app,row));
 root.querySelector('[data-hearing-service]')?.addEventListener('click',()=>openEntityForm(app,'serviceRecords',{preset:{fileId:row.fileId,caseId:row.caseId,hearingId:id},onSaved:()=>app.refresh()}));
 root.querySelector('[data-case-service]')?.addEventListener('click',()=>openEntityForm(app,'serviceRecords',{preset:{fileId:row.fileId,caseId:id},onSaved:()=>app.refresh()}));
 root.querySelector('[data-create-related-file]')?.addEventListener('click',()=>createRelatedFromRecord(app,row,store));
 bindTimeline(root.querySelector('[data-case-timeline]')||root,{onOpen:r=>app.go(r.startsWith('rec:')?r:'rec:'+r)});
 root.querySelectorAll('[data-add]').forEach(b=>b.onclick=()=>{const s=b.dataset.add;const preset=store==='cases'?{caseId:id,fileId:row.fileId,...(s==='hearings'?{court:row.courtId||'',chamber:row.chamber||''}:{}),...(s==='judgments'?{court:row.courtId||'',chamber:row.chamber||'',stage:row.stageType||''}:{})}:store==='fees'?{feeId:id}:{};openEntityForm(app,s,{preset})});
 root.querySelector('[data-next-hearing]')?.addEventListener('click',()=>openEntityForm(app,'hearings',{preset:{fileId:row.fileId,caseId:row.caseId,previousHearingId:row.id,hearingDate:row.adjournedTo||'',court:row.court||'',chamber:row.chamber||'',type:row.type||'',reason:row.nextAction||row.reason||'',relatedPartyIds:row.relatedPartyIds||[]},title:'إضافة الجلسة التالية'}));
 const jobs=[];
 for(const [s,rows] of Object.entries(children))jobs.push(sectionGrid(app,root.querySelector(`[data-grid="${s}"]`),s,rows,{storageKey:`rec:${store}:${s}`}));
 jobs.push(sectionGrid(app,root.querySelector('[data-grid="activityLog"]'),'activityLog',activity.sort((a,b)=>String(b.timestamp).localeCompare(String(a.timestamp))),{storageKey:`rec:${store}:activity`}));
 await Promise.all(jobs);
}
export function notFound(what){return `<div class="empty"><h3>${esc(what)} غير موجود</h3><p>ربما حُذف منطقيًا أو أن الرابط قديم.</p></div>`}
export {refLabel,routeFor,fmtDate};
