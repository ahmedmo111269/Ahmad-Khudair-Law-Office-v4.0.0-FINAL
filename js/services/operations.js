import {STORE} from '../db/schema.js';
import {transaction,request} from '../db/unit-of-work.js';
import {uid} from '../core/id.js';
import {Clock} from '../core/clock.js';
import {AppError,ERR} from '../core/errors.js';
import {events} from '../core/events.js';

// الأصل المطلوب لكل نوع: الجلسة ← قضية/مرحلة، العمل الإداري والملاحظة ← ملف، الموعد والاتصال ← ملف أو موكل.
const parentByStore={hearings:['caseId'],procedures:['fileId'],appointments:['fileId','clientId'],communications:['fileId','clientId'],caseNotes:['fileId']};
const activityName={hearings:'جلسة',procedures:'إجراء/مهمة',appointments:'موعد',communications:'اتصال',caseNotes:'ملاحظة'};

/**
 * opts (اختياري، لمركز العمل): extraStores = مخازن إضافية تدخل المعاملة نفسها؛ withinTransaction(tx,{row,old}) = كتابة
 * إضافية (طبقة تشغيلية/سجل نشاط) تُنفَّذ داخل المعاملة نفسها فتنجح أو تُلغى مع حفظ السجل الأصلي معًا.
 */
export async function saveOperational(office,store,input,id=null,opts={}){
  if(!parentByStore[store]) throw new AppError(ERR.VALIDATION,'نوع السجل غير مدعوم.');
  if(store==='hearings')return saveHearing(office,input,id,opts);
  const old=id?await office.r[store].get(id):null;
  if(id&&!old) throw new AppError(ERR.NOT_FOUND,'السجل غير موجود.');
  const row={...(old||{}),...input,id:id||uid(),createdAt:old?.createdAt||Clock.now(),updatedAt:Clock.now(),version:(old?.version||0)+1,isArchived:old?.isArchived||false,isDeleted:old?.isDeleted||false,deletedAt:old?.deletedAt||null};
  // العمل الإداري/الملاحظة المربوطة بقضية فقط تأخذ ملف القضية تلقائيًا
  if(!row.fileId&&row.caseId&&store!=='hearings'){const c=await office.r.cases.get(row.caseId);if(c)row.fileId=c.fileId}
  if(!parentByStore[store].some(k=>row[k])) throw new AppError(ERR.VALIDATION,parentByStore[store].length>1?'يجب ربط السجل بملف أو موكل.':store==='hearings'?'يجب اختيار القضية / المرحلة.':'يجب اختيار الملف.',Object.fromEntries(parentByStore[store].map(k=>[k,'مطلوب'])));
  const stores=[store,STORE.activityLog,...(opts.extraStores||[])];
  const fileId=store==='hearings'?await caseFileId(office,row.caseId):row.fileId||null;
  if(store==='hearings')row.fileId=fileId;
  if(fileId) stores.push(STORE.files);
  const result=await transaction(office.ctx,[...new Set(stores)],async tx=>{
    await request(tx.objectStore(store).put(row));
    if(fileId){const f=await request(tx.objectStore(STORE.files).get(fileId));if(f&&!f.isDeleted){f.lastActivityAt=row.updatedAt;f.updatedAt=row.updatedAt;f.version=(f.version||0)+1;await request(tx.objectStore(STORE.files).put(f))}}
    await request(tx.objectStore(STORE.activityLog).add({id:uid(),entityType:store,entityId:row.id,action:id?'update':'create',timestamp:Clock.now(),summary:`${id?'تحديث':'إنشاء'} ${activityName[store]}`,metadata:{},...(fileId?{fileId}:{})}));
    if(opts.withinTransaction)await opts.withinTransaction(tx,{row,old});
    return row;
  });
  events.emit('entity:changed',{entityType:store,id:result.id});
  if(fileId) events.emit('entity:changed',{entityType:STORE.files,id:fileId});
  return result;
}

/** Save a hearing and, when an adjournment date is supplied, create its independent next-session record atomically. */
async function saveHearing(office,input,id=null,opts={}){
  const old=id?await office.r.hearings.get(id):null;
  if(id&&!old)throw new AppError(ERR.NOT_FOUND,'الجلسة غير موجودة.');
  const row={...(old||{}),...input,id:id||uid(),createdAt:old?.createdAt||Clock.now(),updatedAt:Clock.now(),version:(old?.version||0)+1,isArchived:old?.isArchived||false,isDeleted:old?.isDeleted||false,deletedAt:old?.deletedAt||null};
  delete row.__followUpCreated;delete row.__followUpUpdated;
  if(!row.caseId)throw new AppError(ERR.VALIDATION,'يجب اختيار القضية / المرحلة.',{caseId:'مطلوب'});
  const caseRow=await office.r.cases.get(row.caseId);
  if(!caseRow||caseRow.isDeleted)throw new AppError(ERR.NOT_FOUND,'القضية / المرحلة غير موجودة.');
  const fileId=await caseFileId(office,row.caseId);row.fileId=fileId;row.stageId=row.caseId;
  if(row.hearingDate&&!/^\d{4}-\d{2}-\d{2}$/.test(row.hearingDate))throw new AppError(ERR.VALIDATION,'تاريخ الجلسة غير صحيح.',{hearingDate:'تاريخ غير صحيح'});
  if(row.adjournedTo&&!/^\d{4}-\d{2}-\d{2}$/.test(row.adjournedTo))throw new AppError(ERR.VALIDATION,'تاريخ التأجيل غير صحيح.',{adjournedTo:'تاريخ غير صحيح'});
  if(row.previousHearingId){
    if(row.previousHearingId===row.id)throw new AppError(ERR.CONFLICT,'لا يمكن ربط الجلسة بنفسها.');
    const previous=await office.r.hearings.get(row.previousHearingId);
    if(!previous||previous.isDeleted)throw new AppError(ERR.NOT_FOUND,'الجلسة السابقة غير موجودة.');
    const previousFileId=previous.fileId||(await office.r.cases.get(previous.caseId))?.fileId;
    if(previousFileId&&previousFileId!==fileId)throw new AppError(ERR.VALIDATION,'يجب أن تكون الجلسة السابقة ضمن الملف نفسه.');
    if(previous.hearingDate&&row.hearingDate&&row.hearingDate<previous.hearingDate)throw new AppError(ERR.VALIDATION,'تاريخ الجلسة لا يسبق تاريخ الجلسة السابقة.');
    let ancestor=previous,seen=new Set();
    for(let depth=0;ancestor&&depth<1000;depth++){
      if(ancestor.id===row.id||seen.has(ancestor.id))throw new AppError(ERR.CONFLICT,'تعذر حفظ علاقة الجلسات بسبب دورة غير صحيحة.');
      seen.add(ancestor.id);if(!ancestor.previousHearingId)break;ancestor=await office.r.hearings.get(ancestor.previousHearingId);
    }
    if(ancestor?.previousHearingId&&seen.size>=1000)throw new AppError(ERR.CONFLICT,'سلسلة الجلسات أعمق من الحد الآمن للتحقق.');
  }
  const now=row.updatedAt;
  const outcome=await transaction(office.ctx,[...new Set([STORE.hearings,STORE.activityLog,STORE.files,...(opts.extraStores||[])])],async tx=>{
    const hearings=tx.objectStore(STORE.hearings);
    await request(hearings.put(row));
    let createdFollowUp=false;
    let updatedFollowUp=false;
    if(row.adjournedTo){
      const children=await request(hearings.index('previousHearingId').getAll(IDBKeyRange.only(row.id),2));
      if(children.length>1)throw new AppError(ERR.CONFLICT,'توجد أكثر من جلسة تالية مرتبطة بهذه الجلسة؛ راجع دورة الجلسات يدويًا قبل إنشاء متابعة أخرى.');
      if(!children.length){
        const follow={
          id:uid(),fileId,caseId:row.caseId,stageId:row.caseId,previousHearingId:row.id,
          hearingDate:row.adjournedTo,hearingTime:'',court:row.court||caseRow.courtId||'',chamber:row.chamber||caseRow.chamber||'',
          type:row.type||'',reason:row.nextAction||row.reason||'',relatedPartyIds:Array.isArray(row.relatedPartyIds)?[...row.relatedPartyIds]:[],
          attendance:'',result:'',adjournedTo:'',adjournReason:'',nextAction:'',notes:'',status:'مجدولة',
          generatedFromAdjournment:true,createdAt:now,updatedAt:now,version:1,isDeleted:false,isArchived:false,deletedAt:null
        };
        await request(hearings.add(follow));
        await request(tx.objectStore(STORE.activityLog).add({id:uid(),entityType:'hearings',entityId:follow.id,action:'create',timestamp:now,summary:'إنشاء جلسة تالية من تاريخ التأجيل',metadata:{},fileId}));
        createdFollowUp=true;
      }else if(children[0].generatedFromAdjournment&&children[0].hearingDate!==row.adjournedTo){
        const follow=children[0];follow.hearingDate=row.adjournedTo;follow.updatedAt=now;follow.version=(follow.version||0)+1;
        await request(hearings.put(follow));
        await request(tx.objectStore(STORE.activityLog).add({id:uid(),entityType:'hearings',entityId:follow.id,action:'update',timestamp:now,summary:'تعديل تاريخ الجلسة التالية المرتبطة بالتأجيل',metadata:{},fileId}));
        updatedFollowUp=true;
      }
    }
    const file=await request(tx.objectStore(STORE.files).get(fileId));
    if(!file||file.isDeleted)throw new AppError(ERR.CONFLICT,'الملف المرتبط بالجلسة غير متاح.');
    file.lastActivityAt=now;file.updatedAt=now;file.version=(file.version||0)+1;await request(tx.objectStore(STORE.files).put(file));
    await request(tx.objectStore(STORE.activityLog).add({id:uid(),entityType:'hearings',entityId:row.id,action:id?'update':'create',timestamp:now,summary:`${id?'تحديث':'إنشاء'} جلسة`,metadata:{},fileId}));
    if(opts.withinTransaction)await opts.withinTransaction(tx,{row,old,createdFollowUp,updatedFollowUp});
    return {row,createdFollowUp,updatedFollowUp};
  });
  events.emit('entity:changed',{entityType:STORE.hearings,id:row.id});
  if(outcome.createdFollowUp||outcome.updatedFollowUp)events.emit('entity:changed',{entityType:STORE.hearings,id:row.id,followUp:true});
  events.emit('entity:changed',{entityType:STORE.files,id:fileId});
  if(outcome.createdFollowUp)outcome.row.__followUpCreated=true;
  if(outcome.updatedFollowUp)outcome.row.__followUpUpdated=true;
  return outcome.row;
}

export async function hearingCycle(office,hearingId){
  const current=await office.r.hearings.get(hearingId);if(!current||current.isDeleted)throw new AppError(ERR.NOT_FOUND,'الجلسة غير موجودة.');
  const fileId=current.fileId||(await office.r.cases.get(current.caseId))?.fileId;
  if(!fileId)throw new AppError(ERR.NOT_FOUND,'ملف الجلسة غير موجود.');
  const direct=await office.r.hearings.byIndex('fileId',fileId,5000);
  const stages=await office.r.cases.byIndex('fileId',fileId,1000);
  const legacy=[];for(const stage of stages){if(legacy.length>=5000)break;legacy.push(...await office.r.hearings.byIndex('caseId',stage.id,Math.min(500,5000-legacy.length)))}
  const all=[...new Map([...direct,...legacy].filter(h=>!h.isDeleted).map(h=>[h.id,{...h,fileId:h.fileId||fileId}])).values()];
  const byId=new Map(all.map(h=>[h.id,h]));
  let root=current,guard=new Set([current.id]);
  while(root.previousHearingId&&byId.has(root.previousHearingId)&&!guard.has(root.previousHearingId)){
    root=byId.get(root.previousHearingId);guard.add(root.id);
  }
  const children=new Map();
  for(const h of all){if(!h.previousHearingId)continue;if(!children.has(h.previousHearingId))children.set(h.previousHearingId,[]);children.get(h.previousHearingId).push(h)}
  for(const list of children.values())list.sort((a,b)=>String(a.hearingDate||'').localeCompare(String(b.hearingDate||''))||String(a.createdAt||'').localeCompare(String(b.createdAt||'')));
  const items=[],visited=new Set();let hasBranches=false;
  const visit=(hearing,depth=0)=>{if(!hearing||visited.has(hearing.id))return;visited.add(hearing.id);items.push({...hearing,__depth:depth});const next=children.get(hearing.id)||[];if(next.length>1)hasBranches=true;for(const child of next)visit(child,depth+1)};
  visit(root);
  if(!visited.has(current.id)){items.push({...current,__depth:0});}
  return {current,root,items,hasBranches};
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
