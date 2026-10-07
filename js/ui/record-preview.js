// معاينة آمنة وسريعة من DataGrid — تعرض حقولًا إدارية مختارة وتعيد الاستخدام إلى المسارات والخدمات الحالية.
import {modal,closeModal} from './modal.js';
import {esc} from './dom.js';
import {ENTITIES,displayValue} from '../domain/entities.js';
import {formatFileNumber} from '../core/file-number.js';
import {contextualQuickActions,runQuickAction} from '../modules/quick-add.js';

const PRIVATE_FIELD=/national.?id|idNumber|passport|birth|address|email|phone|mobile|notes|content|operativeSummary|city|governorate|workAddress|taxNumber|commercialRegister|legalRepresentative/i;
const KIND_ROUTE={clients:'client',opponents:'opponent',files:'file',cases:'case'};
const RELATED_LABEL={fileId:'الملف القانوني',clientId:'الموكل',opponentId:'الخصم',caseId:'القضية / المرحلة',currentStageId:'المرحلة الحالية'};

function recordRoute(store,row){
 const fixed=KIND_ROUTE[store];if(fixed)return `${fixed}:${row.id}`;
 const route=ENTITIES[store]?.route;
 return route?.startsWith('rec:')?`${route}:${row.id}`:null;
}
function valueFor(field,row){
 const value=field.t==='phones'?Array.isArray(row.phones)?row.phones.join('، '):row.phones:displayValue(field,row,new Map());
 return String(value??'').trim();
}
function displayFields(store,row){
 const fields=(ENTITIES[store]?.fields||[]).filter(field=>field.grid&&!field.ref&&!PRIVATE_FIELD.test(field.k));
 const out=[];
 for(const field of fields){const value=valueFor(field,row);if(!value)continue;out.push({label:field.l,value});if(out.length===8)break}
 return out;
}

async function linkedReferences(app,store,row){
 const office=app.office,items=[],seen=new Set();
 const add=async(kind,id,label)=>{
  if(!id||seen.has(`${kind}:${id}`))return;seen.add(`${kind}:${id}`);
  const storeName={file:'files',client:'clients',opponent:'opponents',case:'cases'}[kind];
  const record=await office.r[storeName]?.get(id).catch(()=>null);if(!record||record.isDeleted)return;
  let title='';
  if(kind==='file')title=`${formatFileNumber(record.fileNumber)||record.fileNumber||'ملف'}${record.title?` · ${record.title}`:''}`;
  else if(kind==='client')title=record.fullName||'موكل';
  else if(kind==='opponent')title=record.name||'خصم';
  else title=`${record.caseNumber||'قضية'}${record.court?' · '+record.court:''}`;
  items.push({kind,id,label,title});
 };
 if(store==='files'){
  await add('case',row.currentStageId,'المرحلة الحالية');
  const [parties,legacy]=await Promise.all([office.r.fileParties.byIndex('fileId',row.id,12),office.r.fileClients.byIndex('fileId',row.id,5)]);
  const clientId=parties.find(item=>item.clientId&&item.isPrimary)?.clientId||parties.find(item=>item.clientId)?.clientId||legacy[0]?.clientId;
  await add('client',clientId,'الموكل');
 }else{
  await add('file',row.fileId,'الملف القانوني');
  await add('case',row.caseId||row.stageId,'القضية / المرحلة');
  await add('client',row.clientId,'الموكل');
  await add('opponent',row.opponentId,'الخصم');
 }
 if(store==='clients'&&!items.some(item=>item.kind==='file')){
  const clientFiles=await office.r.clientFiles.byIndex('clientId',row.id,6);
  let files=[];
  for(const clientFile of clientFiles.slice(0,3))files.push(...await office.r.files.byIndex('clientFileId',clientFile.id,3));
  for(const file of files.slice(0,6)){
   if(seen.has(`file:${file.id}`))continue;seen.add(`file:${file.id}`);
   items.push({kind:'file',id:file.id,label:'ملف مرتبط',title:`${formatFileNumber(file.fileNumber)||file.fileNumber||'ملف'}${file.title?` · ${file.title}`:''}`});
  }
 }
 return items.slice(0,8);
}

export async function openRecordPreview(app,store,row,{onSaved=null}={}){
 if(!row||!ENTITIES[store])return null;
 const entity=ENTITIES[store];
 const title=String(entity.title?.(row)||row.fullName||row.name||entity.label||'سجل');
 const fields=displayFields(store,row);
 const links=await linkedReferences(app,store,row);
 const context={type:'record',store,id:row.id,record:row,fileId:row.fileId||'',caseId:row.caseId||row.stageId||'',clientId:row.clientId||''};
 const actions=contextualQuickActions(app,context);
 const route=recordRoute(store,row);
 const titleLine=`<h2 class="modal-title">${esc(title)}</h2><p class="muted small">${esc(entity.label||store)}${row.isArchived?' · مؤرشف':''}</p>`;
 const idLine=row.fileNumber?`<span class="rp-code">${esc(formatFileNumber(row.fileNumber)||row.fileNumber)}</span>`:row.caseNumber?`<span class="rp-code">${esc(row.caseNumber)}</span>`:'';
 const card=modal(`<div class="record-preview" data-store="${esc(store)}" data-record-id="${esc(row.id)}">
  <div class="rp-head">${titleLine}${idLine}</div>
  ${fields.length?`<dl class="rp-fields">${fields.map(field=>`<div><dt>${esc(field.label)}</dt><dd>${esc(field.value)}</dd></div>`).join('')}</dl>`:'<p class="muted small">لا توجد حقول عرض مختصرة لهذا النوع؛ افتح السجل للاطلاع الكامل.</p>'}
  ${links.length?`<section class="rp-links" aria-label="السجلات المرتبطة"><h3>مرتبط بـ</h3><div>${links.map(link=>`<button type="button" class="ghost small" data-preview-link="${esc(link.kind)}:${esc(link.id)}"><span>${esc(link.label)}</span><b>${esc(link.title)}</b></button>`).join('')}</div></section>`:''}
  ${actions.length?`<section class="rp-actions" aria-label="إجراءات سريعة"><h3>إجراءات في السياق</h3><div>${actions.map((action,index)=>`<button type="button" class="ghost small" data-preview-action="${index}">${esc(action.label)}</button>`).join('')}</div></section>`:''}
  <div class="form-actions rp-footer">${route?`<button type="button" class="primary" data-preview-open>فتح السجل الكامل</button>`:''}<button type="button" class="ghost" data-close>إغلاق</button></div>
 </div>`);
 card.classList.add('record-preview-card');
 card.querySelector('[data-preview-open]')?.addEventListener('click',()=>{closeModal();app.go(route)});
 card.querySelectorAll('[data-preview-link]').forEach(button=>button.addEventListener('click',()=>{const [kind,id]=button.dataset.previewLink.split(':');closeModal();app.go(`${kind}:${id}`)}));
 card.querySelectorAll('[data-preview-action]').forEach(button=>button.addEventListener('click',async()=>{
  const action=actions[Number(button.dataset.previewAction)];if(!action)return;
  closeModal();
  try{await runQuickAction(app,action.kind,{context:action.context||context})}catch(error){app.fail?.(error)}
 }));
 if(onSaved)card.dataset.onSaved='true';
 return card;
}
