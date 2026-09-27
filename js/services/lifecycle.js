import {STORE} from '../db/schema.js';
import {uid} from '../core/id.js';
import {Clock} from '../core/clock.js';
import {normalizeArabic} from '../core/search-normalizer.js';
import {transaction,request} from '../db/unit-of-work.js';
import {AppError,ERR} from '../core/errors.js';

export async function linkOpponent(office, caseId, opponentId, role='opponent', notes='') {
  const c=await office.r.cases.get(caseId), o=await office.r.opponents.get(opponentId);
  if(!c||c.isDeleted) throw new AppError(ERR.NOT_FOUND,'القضية غير موجودة.');
  if(!o||o.isDeleted) throw new AppError(ERR.NOT_FOUND,'الخصم غير موجود.');
  const id=`${caseId}::${opponentId}`;
  const row={id,caseId,opponentId,role,notes,createdAt:Clock.now(),updatedAt:Clock.now()};
  await transaction(office.ctx,[STORE.caseOpponents,STORE.cases,STORE.activityLog],async tx=>{
    await request(tx.objectStore(STORE.caseOpponents).put(row));
    c.updatedAt=Clock.now(); c.lastActivityAt=c.updatedAt; c.version=(c.version||0)+1;
    await request(tx.objectStore(STORE.cases).put(c));
    await request(tx.objectStore(STORE.activityLog).add(office.activity('caseOpponents',id,'create')));
  });
  return row;
}

export async function unlinkOpponent(office,caseId,opponentId){
  const id=`${caseId}::${opponentId}`;
  const c=await office.r.cases.get(caseId);
  await transaction(office.ctx,[STORE.caseOpponents,STORE.cases,STORE.activityLog],async tx=>{
    await request(tx.objectStore(STORE.caseOpponents).delete(id));
    if(c){c.updatedAt=Clock.now();c.lastActivityAt=c.updatedAt;c.version=(c.version||0)+1;await request(tx.objectStore(STORE.cases).put(c));}
    await request(tx.objectStore(STORE.activityLog).add(office.activity('caseOpponents',id,'delete')));
  });
}

export async function conflictCheck(office,query){
  const n=normalizeArabic(query||''); if(!n) return [];
  const [clients,opponents]=await Promise.all([office.r.clients.prefix('fullNameNormalized',n,25),office.r.opponents.prefix('nameNormalized',n,25)]);
  const out=[];
  for(const x of clients) out.push({kind:'client',id:x.id,name:x.fullName,phone:x.phone||'',reason:'اسم موكل متشابه'});
  for(const x of opponents) out.push({kind:'opponent',id:x.id,name:x.name,phone:x.phone||'',reason:'اسم خصم متشابه'});
  return out.slice(0,50);
}

export async function createPoa(office,input){
  if(!input.clientId) throw new AppError(ERR.VALIDATION,'يجب اختيار الموكل.');
  const c=await office.r.clients.get(input.clientId); if(!c||c.isDeleted) throw new AppError(ERR.NOT_FOUND,'الموكل غير موجود.');
  const row={...input,id:uid(),createdAt:Clock.now(),updatedAt:Clock.now(),version:1,isArchived:false,isDeleted:false};
  await transaction(office.ctx,[STORE.powersOfAttorney,STORE.activityLog],async tx=>{
    await request(tx.objectStore(STORE.powersOfAttorney).add(row));
    await request(tx.objectStore(STORE.activityLog).add(office.activity('powersOfAttorney',row.id,'create')));
  }); return row;
}
