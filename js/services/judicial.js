import {STORE} from '../db/schema.js';
import {uid} from '../core/id.js';
import {Clock} from '../core/clock.js';
import {transaction,request} from '../db/unit-of-work.js';
import {AppError,ERR} from '../core/errors.js';
import {events} from '../core/events.js';

const parent={witnesses:'caseId',expertReports:'caseId',judgments:'caseId',execution:'caseId'};

export async function saveJudicial(office,store,input,id=null){
  if(!parent[store]) throw new AppError(ERR.VALIDATION,'نوع السجل غير مدعوم.');
  const old=id?await office.r[store].get(id):null;
  if(id&&!old) throw new AppError(ERR.NOT_FOUND,'السجل غير موجود.');
  const parentRow=await office.r.cases.get(input.caseId);
  if(!parentRow||parentRow.isDeleted) throw new AppError(ERR.NOT_FOUND,'القضية غير موجودة أو محذوفة.');
  const row={...(old||{}),...input,id:id||uid(),createdAt:old?.createdAt||Clock.now(),updatedAt:Clock.now(),version:(old?.version||0)+1,isArchived:old?.isArchived||false,isDeleted:old?.isDeleted||false,deletedAt:old?.deletedAt||null};
  if(store==='execution'&&!row.status) row.status='not_started';
  const f=await office.r.files.get(parentRow.fileId);
  if(!f||f.isDeleted) throw new AppError(ERR.CONFLICT,'الملف المرتبط بالقضية غير متاح.');
  const result=await transaction(office.ctx,[store,STORE.cases,STORE.files,STORE.activityLog],async tx=>{
    await request(tx.objectStore(store).put(row));
    parentRow.updatedAt=row.updatedAt; parentRow.lastActivityAt=row.updatedAt; parentRow.version=(parentRow.version||0)+1;
    await request(tx.objectStore(STORE.cases).put(parentRow));
    f.updatedAt=row.updatedAt; f.lastActivityAt=row.updatedAt; f.version=(f.version||0)+1;
    await request(tx.objectStore(STORE.files).put(f));
    await request(tx.objectStore(STORE.activityLog).add({id:uid(),entityType:store,entityId:row.id,action:id?'update':'create',timestamp:Clock.now(),summary:`${id?'تحديث':'إنشاء'} ${store}`,metadata:{}}));
    return row;
  });
  events.emit('entity:changed',{entityType:store,id:result.id});
  events.emit('entity:changed',{entityType:STORE.cases,id:parentRow.id});
  events.emit('entity:changed',{entityType:STORE.files,id:f.id});
  return result;
}

export async function listByCase(office,store,caseId){
  return (await office.r[store].byIndex('caseId',caseId,5000)).filter(x=>!x.isDeleted).sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')));
}

export async function advanceExecution(office,id,nextStatus,notes=''){
  const old=await office.r.execution.get(id);
  if(!old) throw new AppError(ERR.NOT_FOUND,'ملف التنفيذ غير موجود.');
  const allowed={not_started:['active','cancelled'],active:['suspended','completed','cancelled'],suspended:['active','cancelled'],completed:[],cancelled:[]};
  if(!(allowed[old.status||'not_started']||[]).includes(nextStatus)) throw new AppError(ERR.CONFLICT,'انتقال حالة التنفيذ غير مسموح.');
  return saveJudicial(office,STORE.execution,{...old,status:nextStatus,notes:notes||old.notes||''},id);
}
