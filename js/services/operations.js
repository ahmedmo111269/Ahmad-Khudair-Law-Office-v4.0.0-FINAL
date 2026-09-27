import {STORE} from '../db/schema.js';
import {transaction,request} from '../db/unit-of-work.js';
import {uid} from '../core/id.js';
import {Clock} from '../core/clock.js';
import {AppError,ERR} from '../core/errors.js';
import {events} from '../core/events.js';

// الأصل المطلوب لكل نوع: الجلسة ← قضية/مرحلة، العمل الإداري والملاحظة ← ملف، الموعد والاتصال ← ملف أو موكل.
const parentByStore={hearings:['caseId'],procedures:['fileId'],appointments:['fileId','clientId'],communications:['fileId','clientId'],caseNotes:['fileId']};
const activityName={hearings:'جلسة',procedures:'إجراء/مهمة',appointments:'موعد',communications:'اتصال',caseNotes:'ملاحظة'};

export async function saveOperational(office,store,input,id=null){
  if(!parentByStore[store]) throw new AppError(ERR.VALIDATION,'نوع السجل غير مدعوم.');
  const old=id?await office.r[store].get(id):null;
  if(id&&!old) throw new AppError(ERR.NOT_FOUND,'السجل غير موجود.');
  const row={...(old||{}),...input,id:id||uid(),createdAt:old?.createdAt||Clock.now(),updatedAt:Clock.now(),version:(old?.version||0)+1,isArchived:old?.isArchived||false,isDeleted:old?.isDeleted||false,deletedAt:old?.deletedAt||null};
  // العمل الإداري/الملاحظة المربوطة بقضية فقط تأخذ ملف القضية تلقائيًا
  if(!row.fileId&&row.caseId&&store!=='hearings'){const c=await office.r.cases.get(row.caseId);if(c)row.fileId=c.fileId}
  if(!parentByStore[store].some(k=>row[k])) throw new AppError(ERR.VALIDATION,parentByStore[store].length>1?'يجب ربط السجل بملف أو موكل.':store==='hearings'?'يجب اختيار القضية / المرحلة.':'يجب اختيار الملف.',Object.fromEntries(parentByStore[store].map(k=>[k,'مطلوب'])));
  const stores=[store,STORE.activityLog];
  const fileId=store==='hearings'?await caseFileId(office,row.caseId):row.fileId||null;
  if(store==='hearings')row.fileId=fileId;
  if(fileId) stores.push(STORE.files);
  const result=await transaction(office.ctx,[...new Set(stores)],async tx=>{
    await request(tx.objectStore(store).put(row));
    if(fileId){const f=await request(tx.objectStore(STORE.files).get(fileId));if(f&&!f.isDeleted){f.lastActivityAt=row.updatedAt;f.updatedAt=row.updatedAt;f.version=(f.version||0)+1;await request(tx.objectStore(STORE.files).put(f))}}
    await request(tx.objectStore(STORE.activityLog).add({id:uid(),entityType:store,entityId:row.id,action:id?'update':'create',timestamp:Clock.now(),summary:`${id?'تحديث':'إنشاء'} ${activityName[store]}`,metadata:{},...(fileId?{fileId}:{})}));
    return row;
  });
  events.emit('entity:changed',{entityType:store,id:result.id});
  if(fileId) events.emit('entity:changed',{entityType:STORE.files,id:fileId});
  return result;
}

async function caseFileId(office,caseId){
  const c=await office.r.cases.get(caseId);
  if(!c||c.isDeleted) throw new AppError(ERR.NOT_FOUND,'القضية غير موجودة أو محذوفة.');
  const f=await office.r.files.get(c.fileId);
  if(!f||f.isDeleted) throw new AppError(ERR.CONFLICT,'الملف المرتبط بالقضية غير متاح.');
  return c.fileId;
}

export async function listOperational(office,store){
  const page=await office.r[store].page({limit:100,direction:'prev'});
  return page.items;
}
