import {STORE} from '../db/schema.js';
import {formatDate,formatDateTime,formatTime,formatNumber} from '../core/format.js';

const MAX_LINKS=500;
const d=v=>formatDate(v);
const dt=v=>formatDateTime(v);

async function idx(r,store,index,key,limit=MAX_LINKS){return r[store]?.byIndex(index,key,limit)||[]}
async function many(r,store,ids){return r[store]?.getMany(ids)||[]}

function item(date,type,title,detail='',entityId=''){
  return {date:date||'',type,title,detail,entityId};
}
function sortTimeline(items){return items.filter(x=>x.date).sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,200)}

export async function buildFileTimeline(office,fileId){
  const r=office.r;
  const f=await r.files.get(fileId); if(!f) return null;
  const cs=await idx(r,STORE.cases,'fileId',fileId);
  const [procedures,appointments,communications,notes,docs,fees,activities]=await Promise.all([
    idx(r,STORE.procedures,'fileId',fileId),idx(r,STORE.appointments,'fileId',fileId),idx(r,STORE.communications,'fileId',fileId),
    idx(r,STORE.caseNotes,'fileId',fileId),idx(r,STORE.documentReferences,'fileId',fileId),idx(r,STORE.fees,'fileId',fileId),idx(r,STORE.activityLog,'entityId',fileId)
  ]);
  const hearings=[],judgments=[],execution=[];
  const caseIds=cs.filter(x=>!x.isDeleted).map(x=>x.id);
  for(let i=0;i<caseIds.length;i+=20){
    const batch=caseIds.slice(i,i+20);
    const parts=await Promise.all(batch.map(caseId=>Promise.all([
      idx(r,STORE.hearings,'caseId',caseId),idx(r,STORE.judgments,'caseId',caseId),idx(r,STORE.execution,'caseId',caseId)
    ])));
    parts.forEach(([h,j,e])=>{hearings.push(...h);judgments.push(...j);execution.push(...e)})
  }
  const [procedureCount,appointmentCount,communicationCount,noteCount,docCount,feeCount,activityCount,hearingCount,judgmentCount,executionCount]=await Promise.all([
    r[STORE.procedures].countByIndex('fileId',fileId),r[STORE.appointments].countByIndex('fileId',fileId),r[STORE.communications].countByIndex('fileId',fileId),
    r[STORE.caseNotes].countByIndex('fileId',fileId),r[STORE.documentReferences].countByIndex('fileId',fileId),r[STORE.fees].countByIndex('fileId',fileId),r[STORE.activityLog].countByIndex('entityId',fileId),
    Promise.all(caseIds.map(caseId=>r[STORE.hearings].countByIndex('caseId',caseId))).then(a=>a.reduce((n,v)=>n+v,0)),
    Promise.all(caseIds.map(caseId=>r[STORE.judgments].countByIndex('caseId',caseId))).then(a=>a.reduce((n,v)=>n+v,0)),
    Promise.all(caseIds.map(caseId=>r[STORE.execution].countByIndex('caseId',caseId))).then(a=>a.reduce((n,v)=>n+v,0))
  ]);
  const timeline=[];
  procedures.forEach(x=>timeline.push(item(x.actionDate||x.createdAt,'إجراء/مهمة',x.description||x.type||'إجراء',`الحالة: ${x.status||''}${x.internalDueDate?' — الاستحقاق: '+d(x.internalDueDate):''}`,x.id)));
  appointments.forEach(x=>timeline.push(item((x.date||'')+'T'+(x.time||'00:00'),'موعد',x.title||'موعد',x.location||'',x.id)));
  communications.forEach(x=>timeline.push(item(x.date||x.createdAt,'اتصال',x.subject||'اتصال',x.summary||'',x.id)));
  notes.forEach(x=>timeline.push(item(x.createdAt,'ملاحظة',x.category||'ملاحظة',x.content||'',x.id)));
  docs.forEach(x=>timeline.push(item(x.date,'مرجع مستند',x.title||'مرجع مستند',x.physicalLocation||'',x.id)));
  hearings.forEach(x=>timeline.push(item(x.hearingDate+'T'+(x.hearingTime||'00:00'),'جلسة',`جلسة ${formatDate(x.hearingDate)}`,[x.reason,x.result,x.whatHappened].filter(Boolean).join(' — '),x.id)));
  judgments.forEach(x=>timeline.push(item(x.judgmentDate,'حكم',x.judgmentNumber||'حكم',x.operativeSummary||'',x.id)));
  execution.forEach(x=>timeline.push(item(x.openedDate||x.createdAt,'تنفيذ',x.executionNumber||'تنفيذ',[x.status,x.stage,x.lastAction].filter(Boolean).join(' — '),x.id)));
  activities.forEach(x=>timeline.push(item(x.timestamp,'نشاط',x.summary||x.action||'نشاط','سجل النظام',x.id)));
  fees.forEach(x=>timeline.push(item(x.createdAt,'أتعاب','اتفاق أتعاب',`${formatNumber(x.agreedAmount)} ${x.currency||''}`.trim(),x.id)));
  const allDates=timeline.map(x=>x.date).filter(Boolean).sort();
  const now=new Date();
  const future=timeline.filter(x=>new Date(x.date)>=now).sort((a,b)=>String(a.date).localeCompare(String(b.date)))[0]||null;
  const last=timeline.filter(x=>new Date(x.date)<now).sort((a,b)=>String(b.date).localeCompare(String(a.date)))[0]||null;
  return {file:f,cases:cs.filter(x=>!x.isDeleted),timeline:sortTimeline(timeline),last,future,counts:{procedures:procedureCount,appointments:appointmentCount,communications:communicationCount,hearings:hearingCount,judgments:judgmentCount,execution:executionCount,notes:noteCount,documentReferences:docCount,fees:feeCount,activities:activityCount},range:{first:allDates[0]||null,last:allDates.at(-1)||null}};
}

export async function buildCaseTimeline(office,caseId){
  const r=office.r;
  const c=await r.cases.get(caseId); if(!c) return null;
  const [h,p,w,e,j,x,a]=await Promise.all([
    idx(r,STORE.hearings,'caseId',caseId),idx(r,STORE.procedures,'caseId',caseId),idx(r,STORE.witnesses,'caseId',caseId),
    idx(r,STORE.expertReports,'caseId',caseId),idx(r,STORE.judgments,'caseId',caseId),idx(r,STORE.execution,'caseId',caseId),idx(r,STORE.activityLog,'entityId',caseId)
  ]);
  const timeline=[];
  h.forEach(v=>timeline.push(item(v.hearingDate+'T'+(v.hearingTime||'00:00'),'جلسة',`جلسة ${formatDate(v.hearingDate)}`,[v.reason,v.result,v.whatHappened,v.nextAction].filter(Boolean).join(' — '),v.id)));
  p.forEach(v=>timeline.push(item(v.actionDate||v.createdAt,'إجراء/مهمة',v.description||v.type||'إجراء',`الحالة: ${v.status||''}${v.internalDueDate?' — الاستحقاق: '+d(v.internalDueDate):''}`,v.id)));
  w.forEach(v=>timeline.push(item(v.createdAt,'شاهد',v.name||'شاهد',v.side||'',v.id)));
  e.forEach(v=>timeline.push(item(v.reportDate,'خبير',v.expertName||'تقرير خبير',v.summary||'',v.id)));
  j.forEach(v=>timeline.push(item(v.judgmentDate,'حكم',v.judgmentNumber||'حكم',v.operativeSummary||'',v.id)));
  x.forEach(v=>timeline.push(item(v.openedDate||v.createdAt,'تنفيذ',v.executionNumber||'تنفيذ',[v.status,v.stage,v.lastAction,v.nextAction].filter(Boolean).join(' — '),v.id)));
  a.forEach(v=>timeline.push(item(v.timestamp,'نشاط',v.summary||v.action||'نشاط','سجل النظام',v.id)));
  const future=timeline.filter(v=>v.date&&new Date(v.date)>=new Date()).sort((a,b)=>String(a.date).localeCompare(String(b.date)))[0]||null;
  const last=timeline.filter(v=>v.date&&new Date(v.date)<new Date()).sort((a,b)=>String(b.date).localeCompare(String(a.date)))[0]||null;
  return {case:c,timeline:sortTimeline(timeline),last,future,counts:{hearings:h.length,procedures:p.length,witnesses:w.length,experts:e.length,judgments:j.length,execution:x.length}};
}

export {d,dt};
