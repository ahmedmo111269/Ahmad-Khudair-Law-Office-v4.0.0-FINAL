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

export function kvHtml(fields,row,refs,{skipEmpty=true}={}){
 const items=fields.map(f=>{const v=displayValue(f,row,refs);if(skipEmpty&&!v)return '';const link=f.ref&&row[f.k]?` data-open-ref="${esc(f.ref)}:${esc(row[f.k])}"`:'';return `<div class="kv-item${f.t==='textarea'?' wide':''}"><dt>${esc(f.l)}</dt><dd${link}>${link?`<button type="button" class="link">${esc(v)}</button>`:esc(v)}</dd></div>`}).join('');
 return items?`<dl class="kv">${items}</dl>`:'<p class="muted">لا توجد بيانات مسجلة بعد. اضغط «تعديل البيانات» لإضافتها.</p>';
}
export function section(key,title,count,body,{open=true,add=''}={}){
 return `<details class="rec-section" data-sec="${esc(key)}" ${open?'open':''}><summary><span>${esc(title)}</span>${count!==null&&count!==undefined?`<span class="count">${count}</span>`:''}</summary>${add?`<div class="sec-actions">${add}</div>`:''}<div class="sec-body">${body}</div></details>`;
}
const refRoute={files:'file',cases:'case',clients:'client',opponents:'opponent'};
export function bindRefLinks(app,root){root.querySelectorAll('[data-open-ref]').forEach(el=>el.addEventListener('click',()=>{const [s,id]=el.dataset.openRef.split(':');if(refRoute[s])app.go(`${refRoute[s]}:${id}`);else app.go(`rec:${s}:${id}`)}))}

async function confirmDelete(app,store,id){
 if(!await confirmBox(`حذف منطقي لهذا السجل (${esc(ENTITIES[store].label)})؟ يبقى محفوظًا في قاعدة البيانات ويمكن مراجعته من مركز الإصلاح، ولا يُحذف نهائيًا.`,{okText:'حذف منطقي'}))return;
 try{await deleteEntity(app.office,store,id);toast('تم الحذف المنطقي');app.back()}catch(e){toast(userError(e),'error')}
}

// ===== صفحة الموكل =====
export async function clientPage(app,id){
 const c=await app.office.r.clients.get(id);
 if(!c||c.isDeleted)return notFound('الموكل');
 app.__rec={store:'clients',id,related:await clientRelated(app.office,id)};
 const r=app.__rec.related;
 const refs=await resolveRefs(app.office,[c],ENTITIES.clients.fields);
 return `<div class="record-head"><div><small class="muted">موكل</small><h2>${esc(c.fullName)}</h2><p class="badges">${phonesOf(c).map(p=>`<span class="badge">☎ ${esc(p)}</span>`).join('')}${c.nationalId?`<span class="badge">ر.ق ${esc(c.nationalId)}</span>`:''}<span class="badge">${esc(label(c.status||'active'))}</span></p></div>
 <div class="head-actions"><button class="ghost" data-rec-edit>تعديل البيانات</button><button class="ghost danger" data-rec-delete>حذف منطقي</button></div></div>
 ${section('data','البيانات الكاملة',null,kvHtml(ENTITIES.clients.fields,c,refs)+'<div class="sec-actions end"><button class="primary" data-rec-edit>تعديل البيانات</button></div>',{open:false})}
 ${section('files','الملفات',r.files.length,'<div data-grid="files"></div>',{add:'<button class="ghost" data-add="files">+ ملف جديد لهذا الموكل</button>'})}
 ${section('cases','القضايا والمراحل',r.cases.length,'<div data-grid="cases"></div>')}
 ${section('poa','التوكيلات',r.poas.length,'<div data-grid="powersOfAttorney"></div>',{add:'<button class="ghost" data-add="powersOfAttorney">+ توكيل</button>'})}
 ${section('hearings','الجلسات',r.hearings.length,'<div data-grid="hearings"></div>')}
 ${section('appointments','المواعيد',r.appointments.length,'<div data-grid="appointments"></div>',{open:false,add:'<button class="ghost" data-add="appointments">+ موعد</button>'})}
 ${section('communications','الاتصالات',r.communications.length,'<div data-grid="communications"></div>',{open:false,add:'<button class="ghost" data-add="communications">+ اتصال</button>'})}`;
}
export async function bindClientPage(app,id){
 const root=document.querySelector('#main-content');const r=app.__rec.related;
 root.querySelectorAll('[data-rec-edit]').forEach(b=>b.onclick=()=>openEntityForm(app,'clients',{id}));
 root.querySelector('[data-rec-delete]').onclick=()=>confirmDelete(app,'clients',id);
 root.querySelectorAll('[data-add]').forEach(b=>b.onclick=()=>{const s=b.dataset.add;openEntityForm(app,s,{preset:{clientId:id}})});
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
 app.__rec={store:'opponents',id,related:await opponentRelated(app.office,id)};
 const r=app.__rec.related;
 const refs=await resolveRefs(app.office,[o],ENTITIES.opponents.fields);
 return `<div class="record-head"><div><small class="muted">خصم</small><h2>${esc(o.name)}</h2><p class="badges">${phonesOf(o).map(p=>`<span class="badge">☎ ${esc(p)}</span>`).join('')}${o.capacity?`<span class="badge">${esc(o.capacity)}</span>`:''}</p></div>
 <div class="head-actions"><button class="ghost" data-rec-edit>تعديل البيانات</button><button class="ghost danger" data-rec-delete>حذف منطقي</button></div></div>
 ${section('data','البيانات الكاملة',null,kvHtml(ENTITIES.opponents.fields,o,refs)+'<div class="sec-actions end"><button class="primary" data-rec-edit>تعديل البيانات</button></div>',{open:false})}
 ${section('files','الملفات',r.files.length,'<div data-grid="files"></div>')}
 ${section('cases','القضايا والمراحل',r.cases.length,'<div data-grid="cases"></div>')}
 ${section('hearings','الجلسات',r.hearings.length,'<div data-grid="hearings"></div>')}`;
}
export async function bindOpponentPage(app,id){
 const root=document.querySelector('#main-content');const r=app.__rec.related;
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
const CASE_CHILDREN=[['hearings','الجلسات'],['judgments','الأحكام'],['procedures','الأعمال الإدارية'],['expertReports','الخبراء'],['witnesses','الشهود'],['execution','التنفيذ']];
export async function recordPage(app,store,id){
 const ent=ENTITIES[store];if(!ent)return notFound('السجل');
 const row=await app.office.r[store].get(id);
 if(!row||row.isDeleted)return notFound(ent.label);
 const refs=await resolveRefs(app.office,[row],ent.fields);
 const children={};
 if(store==='cases')await Promise.all(CASE_CHILDREN.map(async([s])=>{children[s]=await app.office.r[s].byIndex('caseId',id,2000)}));
 if(store==='fees')children.feePayments=await app.office.r.feePayments.byIndex('feeId',id,2000);
 const activity=await app.office.r.activityLog.byIndex('entityId',id,200);
 app.__rec={store,id,row,children,activity};
 const parentBtns=ent.fields.filter(f=>f.ref&&row[f.k]).map(f=>`<button class="ghost" data-open-ref="${esc(f.ref)}:${esc(row[f.k])}">فتح ${esc(f.l.replace(/\s*\(.*\)/,''))}: ${esc(refs.get(row[f.k])||'')}</button>`).join('');
 const extraBtns=[
  store==='hearings'?'<button class="ghost" data-next-hearing>+ الجلسة التالية</button>':'',
  store==='cases'?'<button class="ghost" data-add="hearings">+ جلسة</button><button class="ghost" data-add="judgments">+ حكم</button>':'',
  store==='fees'?'<button class="ghost" data-add="feePayments">+ دفعة</button>':''
 ].join('');
 return `<div class="record-head"><div><small class="muted">${esc(ent.label)}</small><h2>${esc(ent.title(row)||ent.label)}</h2><div class="parent-links">${parentBtns}</div></div>
 <div class="head-actions">${extraBtns}<button class="ghost" data-rec-edit>تعديل</button><button class="ghost danger" data-rec-delete>حذف منطقي</button></div></div>
 ${section('data','البيانات الكاملة',null,kvHtml(ent.fields,row,refs)+'<div class="sec-actions end"><button class="primary" data-rec-edit>تعديل البيانات</button></div>',{open:true})}
 ${store==='cases'?CASE_CHILDREN.map(([s,l])=>section(s,l,children[s].length,`<div data-grid="${s}"></div>`,{open:children[s].length>0,add:`<button class="ghost" data-add="${s}">+ إضافة</button>`})).join(''):''}
 ${store==='fees'?section('payments','الدفعات',children.feePayments.length,'<div data-grid="feePayments"></div>',{add:'<button class="ghost" data-add="feePayments">+ دفعة</button>'}):''}
 ${section('activity','سجل النشاط',activity.length,'<div data-grid="activityLog"></div>',{open:false})}`;
}
export async function bindRecordPage(app,store,id){
 const root=document.querySelector('#main-content');const {row,children,activity}=app.__rec;
 root.querySelectorAll('[data-rec-edit]').forEach(b=>b.onclick=()=>openEntityForm(app,store,{id}));
 root.querySelector('[data-rec-delete]').onclick=()=>confirmDelete(app,store,id);
 bindRefLinks(app,root);
 root.querySelectorAll('[data-add]').forEach(b=>b.onclick=()=>{const s=b.dataset.add;const preset=store==='cases'?{caseId:id,fileId:row.fileId,...(s==='hearings'?{court:row.courtId||'',chamber:row.chamber||''}:{}),...(s==='judgments'?{court:row.courtId||'',chamber:row.chamber||'',stage:row.stageType||''}:{})}:store==='fees'?{feeId:id}:{};openEntityForm(app,s,{preset})});
 root.querySelector('[data-next-hearing]')?.addEventListener('click',()=>openEntityForm(app,'hearings',{preset:{caseId:row.caseId,hearingDate:row.adjournedTo||'',court:row.court||'',chamber:row.chamber||'',reason:row.nextAction||''},title:'إضافة الجلسة التالية'}));
 const jobs=[];
 for(const [s,rows] of Object.entries(children))jobs.push(sectionGrid(app,root.querySelector(`[data-grid="${s}"]`),s,rows,{storageKey:`rec:${store}:${s}`}));
 jobs.push(sectionGrid(app,root.querySelector('[data-grid="activityLog"]'),'activityLog',activity.sort((a,b)=>String(b.timestamp).localeCompare(String(a.timestamp))),{storageKey:'rec:activity'}));
 await Promise.all(jobs);
}
export function notFound(what){return `<div class="empty"><h3>${esc(what)} غير موجود</h3><p>ربما حُذف منطقيًا أو أن الرابط قديم.</p></div>`}
export {refLabel,routeFor,fmtDate};
