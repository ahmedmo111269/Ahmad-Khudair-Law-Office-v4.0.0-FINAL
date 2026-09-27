// منشئ النماذج العام: يبني نموذج أي كيان من تعريفه في domain/entities.js.
// القوائم من lookups (قابلة للكتابة الحرة أيضًا)، أرقام هاتف متعددة، حقول نوع الملف تتغير تلقائيًا بتغير النوع.
import {esc} from './dom.js';
import {modal,closeModal} from './modal.js';
import {toast} from './toast.js';
import {lookupField,bindLookups} from './lookup.js';
import {ENTITIES,FILE_TYPE_GROUPS,fileTypeGroup,phonesOf} from '../domain/entities.js';
import {getLookups} from '../services/lookups.js';
import {resolveRefs} from '../services/entity-query.js';
import {saveEntity} from '../services/entity-save.js';
import {Clock} from '../core/clock.js';
import {userError,normalizeError} from '../core/errors.js';

const SEARCH_INDEX={clients:'fullNameNormalized',files:'titleNormalized',cases:'caseNumber',opponents:'nameNormalized'};
let dl=0;

// حقول الخطوة الأولى لفتح ملف جديد
const NEW_FILE_FIELDS=[
 {k:'fileType',l:'نوع الملف',t:'lookup',lk:'fileType',g:'الخطوة الأولى'},
 {k:'title',l:'عنوان الملف (اختياري — يُكوَّن تلقائيًا)',t:'text',g:'الخطوة الأولى'},
 {k:'clientId',l:'الموكل (ابحث بالاسم أو الرقم القومي)',t:'ref',ref:'clients',g:'الخطوة الأولى'},
 {k:'newClientName',l:'أو اسم موكل جديد',t:'text',g:'الخطوة الأولى'},
 {k:'newClientPhone',l:'هاتف الموكل الجديد',t:'text',g:'الخطوة الأولى'},
 {k:'clientRole',l:'صفة الموكل في هذا الملف',t:'lookup',lk:'partyRole',g:'الخطوة الأولى'},
 {k:'responsibleLawyer',l:'المحامي المسؤول',t:'lookup',lk:'lawyer',g:'الخطوة الأولى'},
 {k:'openedAt',l:'تاريخ الفتح',t:'date',g:'الخطوة الأولى'},
 {k:'status',l:'الحالة',t:'lookup',lk:'fileStatus',g:'الخطوة الأولى'},
 {k:'priority',l:'الأولوية',t:'select',opts:[['normal','عادي'],['urgent','عاجل'],['critical','حرج']],g:'الخطوة الأولى'}
];

export function formFields(store,{isNew=false,only=null}={}){
 if(store==='files'&&isNew)return NEW_FILE_FIELDS;
 let f=(ENTITIES[store]?.fields||[]).filter(x=>x.t!=='readonly');
 if(only)f=f.filter(x=>only.includes(x.k));
 return f;
}

export function fieldHtml(f,value,{refLabels=new Map(),lookups={},stageOptions=null,error=''}={}){
 const req=f.req?' <b class="req" title="مطلوب">*</b>':'';
 const err=error?`<small class="field-error" role="alert">${esc(error)}</small>`:'';
 const wrap=(inner,cls='')=>`<div class="field${cls}${f.t==='textarea'||f.t==='phones'?' span2':''}" data-field="${esc(f.k)}">${inner}${err}</div>`;
 const v=value??'';
 if(f.t==='ref'){
  if(f.k==='caseId'&&stageOptions){return wrap(`<label>${esc(f.l)}${req}<select name="caseId"><option value="">— اختر المرحلة —</option>${stageOptions.map(o=>`<option value="${esc(o.id)}"${o.id===v?' selected':''}>${esc(o.label)}</option>`).join('')}</select></label>`)}
  if(!SEARCH_INDEX[f.ref]){return wrap(`<label>${esc(f.l)}${req}<input type="hidden" name="${esc(f.k)}" value="${esc(v)}"><input value="${esc(refLabels.get(v)||'')}" readonly></label>`)}
  return wrap(lookupField({name:f.k,label:f.l+(f.req?' *':''),store:f.ref,index:SEARCH_INDEX[f.ref],value:v,displayValue:refLabels.get(v)||''}));
 }
 if(f.t==='phones'){
  const list=Array.isArray(value)?value:[];const items=list.length?list:[''];
  return wrap(`<fieldset class="phones"><legend>${esc(f.l)}</legend><div class="phone-list">${items.map(p=>`<div class="phone-row"><input name="phones" inputmode="tel" value="${esc(p)}" placeholder="رقم الهاتف"><button type="button" class="link" data-phone-del aria-label="حذف الرقم">✕</button></div>`).join('')}</div><button type="button" class="ghost small" data-phone-add>+ إضافة رقم</button></fieldset>`);
 }
 if(f.t==='textarea')return wrap(`<label>${esc(f.l)}${req}<textarea name="${esc(f.k)}" rows="2">${esc(v)}</textarea></label>`);
 if(f.t==='select')return wrap(`<label>${esc(f.l)}${req}<select name="${esc(f.k)}"><option value="">—</option>${f.opts.map(([o,l])=>`<option value="${esc(o)}"${String(v)===o?' selected':''}>${esc(l)}</option>`).join('')}${v&&!f.opts.some(o=>o[0]===String(v))?`<option value="${esc(v)}" selected>${esc(v)}</option>`:''}</select></label>`);
 if(f.t==='bool'){const s=v===true||v==='true'?'true':v===false||v==='false'?'false':'';return wrap(`<label>${esc(f.l)}<select name="${esc(f.k)}" data-bool><option value="">—</option><option value="true"${s==='true'?' selected':''}>نعم</option><option value="false"${s==='false'?' selected':''}>لا</option></select></label>`)}
 if(f.t==='lookup'){const id='dl-'+(++dl);const vals=lookups[f.lk]||[];return wrap(`<label>${esc(f.l)}${req}<input name="${esc(f.k)}" list="${id}" value="${esc(v)}" autocomplete="off" placeholder="اختر أو اكتب"><datalist id="${id}">${vals.map(x=>`<option value="${esc(x)}"></option>`).join('')}</datalist></label>`)}
 const type=f.t==='number'?'number" step="any':f.t==='date'?'date':f.t==='time'?'time':'text';
 return wrap(`<label>${esc(f.l)}${req}<input name="${esc(f.k)}" type="${type}" value="${esc(v)}"${f.t==='number'?' inputmode="decimal"':''}></label>`);
}

export function groupedHtml(fields,values,ctx,{collapsed=false}={}){
 const groups=new Map();for(const f of fields){const g=f.g||'البيانات';if(!groups.has(g))groups.set(g,[]);groups.get(g).push(f)}
 let i=0;
 return [...groups.entries()].map(([g,fs])=>`<details class="form-group" ${collapsed&&i++>0?'':'open'}><summary>${esc(g)}</summary><div class="form-grid">${fs.map(f=>fieldHtml(f,f.t==='phones'?phonesOf(values):values[f.k],{...ctx,error:ctx.errors?.[f.k]})).join('')}</div></details>`).join('');
}

export function readFields(form,fields){
 const out={};
 for(const f of fields){
  if(f.t==='phones'){const ph=[...form.querySelectorAll('[name="phones"]')].map(i=>i.value.trim()).filter(Boolean);out.phones=ph;out.phone=ph[0]||'';continue}
  const el=form.querySelector(`[name="${CSS.escape(f.k)}"]`);if(!el)continue;
  let v=el.value;
  if(f.t==='bool')v=v==='true'?true:v==='false'?false:'';
  else if(f.t==='number')v=v===''?'':Number(v);
  else if(typeof v==='string')v=v.trim();
  out[f.k]=v;
 }
 return out;
}

export function bindFormWidgets(root,office){
 bindLookups(root,office);
 root.addEventListener('click',e=>{
  if(e.target.closest('[data-phone-add]')){const list=e.target.closest('.phones').querySelector('.phone-list');const row=document.createElement('div');row.className='phone-row';row.innerHTML='<input name="phones" inputmode="tel" placeholder="رقم الهاتف"><button type="button" class="link" data-phone-del aria-label="حذف الرقم">✕</button>';list.append(row);row.querySelector('input').focus()}
  if(e.target.closest('[data-phone-del]')){const list=e.target.closest('.phone-list');const row=e.target.closest('.phone-row');if(list.children.length>1)row.remove();else row.querySelector('input').value=''}
 });
}

function typeGroupHtml(type,values,ctx){
 const g=fileTypeGroup(type);const def=FILE_TYPE_GROUPS[g];
 if(!def)return '<p class="muted small">اختر نوع الملف لإظهار الحقول الخاصة به.</p>';
 return `<h4 class="type-title">${esc(def.label)}</h4><div class="form-grid">${def.fields.map(f=>fieldHtml(f,values[f.k],ctx)).join('')}</div>`;
}

/**
 * فتح نموذج إضافة/تعديل لأي كيان داخل نافذة.
 * preset: قيم مبدئية (مثل fileId عند الإضافة من داخل الملف). stageOptions: مراحل الملف لاختيار القضية.
 */
export async function openEntityForm(app,store,{id=null,preset={},onSaved=null,title=null,only=null,stageOptions=null,typeFieldsOnly=false}={}){
 const office=app.office;const ent=ENTITIES[store];
 const old=id?await office.r[store].get(id):null;
 const isNew=!old;
 const values={...(old||{}),...preset};
 if(isNew){
  if(store==='files'){values.openedAt=values.openedAt||Clock.today();values.status=values.status||'مفتوح';values.priority=values.priority||'normal';values.clientRole=values.clientRole||'موكل'}
  if(store==='clients')values.status=values.status||'active';
  if(store==='procedures'){values.status=values.status||'open';values.priority=values.priority||'normal'}
  if(store==='fileParties')values.partyKind=values.partyKind||'client';
  if(store==='fees')values.currency=values.currency||'جنيه';
  if(['appointments','communications','feePayments','documentReferences'].includes(store))values.date=values.date||Clock.today();
 }
 let fields=typeFieldsOnly?[]:formFields(store,{isNew,only});
 const typeFields=store==='files'&&(typeFieldsOnly||!only);
 const cats=[...fields,...(typeFields?Object.values(FILE_TYPE_GROUPS).flatMap(g=>g.fields):[])].filter(f=>f.lk).map(f=>f.lk);
 const [lookups,refLabels]=await Promise.all([getLookups(office,cats),resolveRefs(office,[values],fields)]);
 const ctx={refLabels,lookups,stageOptions};
 const heading=title||(isNew?`إضافة ${ent.label}`:`تعديل ${ent.label}`);
 const typeBlock=typeFields?`<details class="form-group type-group" ${typeFieldsOnly||!isNew?'open':''}><summary>بيانات حسب نوع الملف ${isNew?'(اختياري)':''}</summary><div data-typegroup>${typeGroupHtml(values.fileType,values,ctx)}</div></details>`:'';
 const card=modal(`<h2 class="modal-title">${esc(heading)}</h2>
  ${store==='files'&&isNew?'<p class="muted small">أدخل البيانات الأساسية فقط ثم اضغط «إنشاء الملف»؛ باقي البيانات والمراحل والأطراف تُضاف من صفحة الملف.</p>':''}
  <form class="entity-form" novalidate data-store="${esc(store)}">
   ${groupedHtml(fields,values,ctx,{collapsed:false})}
   ${typeBlock}
   <div class="form-actions"><button class="primary" type="submit">${store==='files'&&isNew?'إنشاء الملف':'حفظ'}</button><button class="ghost" type="button" data-modal-back>رجوع</button></div>
  </form>`);
 const form=card.querySelector('form');
 bindFormWidgets(form,office);
 if(typeFields){
  const typeInput=form.querySelector('[name="fileType"]');
  let lastGroup=fileTypeGroup(values.fileType);
  const refresh=()=>{const g=fileTypeGroup(typeInput?.value||values.fileType);if(g===lastGroup)return;const cur={...values,...readFields(form,allTypeFieldsOf(lastGroup))};Object.assign(values,cur);lastGroup=g;form.querySelector('[data-typegroup]').innerHTML=typeGroupHtml(typeInput.value,values,ctx)};
  typeInput?.addEventListener('input',refresh);typeInput?.addEventListener('change',refresh);
 }
 if(store==='fileParties'){
  const kindSel=form.querySelector('[name="partyKind"]');
  const sync=()=>{const k=kindSel.value||'client';form.querySelector('[data-field="clientId"]').hidden=k!=='client';form.querySelector('[data-field="opponentId"]').hidden=k!=='opponent';const nameLbl=form.querySelector('[data-field="name"] label');if(nameLbl)nameLbl.firstChild.textContent=k==='other'?'اسم الطرف ':k==='client'?'أو اسم موكل جديد ':'أو اسم خصم جديد '};
  kindSel.addEventListener('change',sync);sync();
 }
 form.querySelector('input:not([type=hidden]):not([readonly]),select,textarea')?.focus();
 form.addEventListener('submit',async e=>{
  e.preventDefault();
  const btn=form.querySelector('[type=submit]');btn.disabled=true;
  form.querySelectorAll('.field-error').forEach(x=>x.remove());form.querySelectorAll('.has-error').forEach(x=>x.classList.remove('has-error'));
  try{
   const tf=typeFields?allTypeFieldsOf(fileTypeGroup(form.querySelector('[name="fileType"]')?.value??values.fileType)):[];
   const data={...preset,...readFields(form,[...fields,...tf])};
   if(store==='fileParties'){if(data.partyKind!=='client')data.clientId='';if(data.partyKind!=='opponent')data.opponentId=''}
   const row=await saveEntity(office,store,data,old?.id||null,old?.version??null);
   closeModal();toast(isNew?'تمت الإضافة':'تم الحفظ');
   if(onSaved)await onSaved(row,isNew);
   else if(isNew&&store==='files')await app.go('file:'+row.id);
   else await app.refresh();
  }catch(err){
   const n=normalizeError(err);toast(userError(n),'error');
   const details=err?.details||n?.details;
   if(details&&typeof details==='object')for(const [k,msg] of Object.entries(details)){const fd=form.querySelector(`[data-field="${CSS.escape(k)}"]`);if(fd){fd.classList.add('has-error');fd.insertAdjacentHTML('beforeend',`<small class="field-error" role="alert">${esc(msg)}</small>`)}}
   btn.disabled=false;
  }
 });
 return card;
}
function allTypeFieldsOf(group){return FILE_TYPE_GROUPS[group]?.fields||[]}
