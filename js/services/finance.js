import {STORE} from '../db/schema.js';
import {uid} from '../core/id.js';
import {Clock} from '../core/clock.js';
import {transaction,request} from '../db/unit-of-work.js';
import {AppError,ERR} from '../core/errors.js';
import {events} from '../core/events.js';

export async function saveFee(office,input,id=null){
 const old=id?await office.r.fees.get(id):null;
 if(id&&!old) throw new AppError(ERR.NOT_FOUND,'الأتعاب غير موجودة.');
 if(!input.fileId) throw new AppError(ERR.VALIDATION,'يجب اختيار الملف.');
 const file=await office.r.files.get(input.fileId);
 if(!file||file.isDeleted) throw new AppError(ERR.NOT_FOUND,'الملف غير موجود أو محذوف.');
 const amount=Number(input.agreedAmount||0);
 if(!Number.isFinite(amount)||amount<0) throw new AppError(ERR.VALIDATION,'قيمة الأتعاب غير صحيحة.');
 const now=Clock.now();
 const row={...(old||{}),...input,id:id||uid(),agreedAmount:amount,paymentStatus:input.paymentStatus||old?.paymentStatus||'unpaid',createdAt:old?.createdAt||now,updatedAt:now,version:(old?.version||0)+1,isArchived:old?.isArchived||false,isDeleted:false,deletedAt:null};
 const out=await transaction(office.ctx,[STORE.fees,STORE.files,STORE.activityLog],async tx=>{
   await request(tx.objectStore(STORE.fees).put(row));
   file.updatedAt=now;file.lastActivityAt=now;file.version=(file.version||0)+1;
   await request(tx.objectStore(STORE.files).put(file));
   await request(tx.objectStore(STORE.activityLog).add({id:uid(),entityType:STORE.fees,entityId:row.id,action:id?'update':'create',timestamp:now,summary:id?'تحديث الأتعاب':'إنشاء الأتعاب',metadata:{},fileId:file.id}));
   return row;
 });
 events.emit('entity:changed',{entityType:STORE.fees,id:out.id});events.emit('entity:changed',{entityType:STORE.files,id:file.id});return out;
}

export async function addFeePayment(office,input){
 const fee=await office.r.fees.get(input.feeId);if(!fee||fee.isDeleted)throw new AppError(ERR.NOT_FOUND,'الأتعاب غير موجودة.');
 const amount=Number(input.amount);if(!Number.isFinite(amount)||amount<=0)throw new AppError(ERR.VALIDATION,'قيمة الدفعة يجب أن تكون أكبر من صفر.');
 const paid=await office.r.feePayments.sumByIndex('feeId',fee.id,'amount');
 if(paid+amount>Number(fee.agreedAmount||0))throw new AppError(ERR.CONFLICT,'قيمة الدفعة تتجاوز المتبقي من الأتعاب.');
 const now=Clock.now(),row={...input,id:uid(),amount,createdAt:now,updatedAt:now,version:1,isArchived:false,isDeleted:false,deletedAt:null};
 const out=await transaction(office.ctx,[STORE.feePayments,STORE.fees,STORE.files,STORE.activityLog],async tx=>{
  await request(tx.objectStore(STORE.feePayments).add(row));
  const nextPaid=paid+amount;const nextStatus=nextPaid>=Number(fee.agreedAmount||0)?'paid':'partial';fee.paymentStatus=nextStatus;fee.updatedAt=now;fee.version=(fee.version||0)+1;
  await request(tx.objectStore(STORE.fees).put(fee));
  const file=await request(tx.objectStore(STORE.files).get(fee.fileId));if(file&&!file.isDeleted){file.updatedAt=now;file.lastActivityAt=now;file.version=(file.version||0)+1;await request(tx.objectStore(STORE.files).put(file));}
  await request(tx.objectStore(STORE.activityLog).add({id:uid(),entityType:STORE.feePayments,entityId:row.id,action:'create',timestamp:now,summary:'تسجيل دفعة أتعاب',metadata:{},fileId:fee.fileId}));return row;
 });
 events.emit('entity:changed',{entityType:STORE.feePayments,id:out.id});events.emit('entity:changed',{entityType:STORE.fees,id:fee.id});return out;
}

export async function feeSummary(office,fileId=null){
 let fees;
 if(fileId) fees=await office.r.fees.byIndex('fileId',fileId,5000);
 else fees=await office.r.fees.all(5000);
 fees=fees.filter(x=>!x.isDeleted&&(!fileId||x.fileId===fileId));
 let agreed=0,paid=0;for(const f of fees){agreed+=Number(f.agreedAmount||0);paid+=await office.r.feePayments.sumByIndex('feeId',f.id,'amount')}
 return {count:fees.length,agreed,paid,remaining:Math.max(0,agreed-paid)};
}
