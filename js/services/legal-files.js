// خدمة الملف القانوني الداخلي: الأطراف متعددة الصفات، العلاقات بين الملفات، نص البحث الموحد، الأرشفة وإعادة الفتح.
// الملف (files) هو الوحدة الأساسية؛ القضايا/المراحل (cases) أرقام قضائية اختيارية تتبعه.
import {STORE} from '../db/schema.js';
import {transaction,request} from '../db/unit-of-work.js';
import {uid} from '../core/id.js';
import {Clock} from '../core/clock.js';
import {AppError,ERR} from '../core/errors.js';
import {events} from '../core/events.js';
import {normalizeArabic,normalizeDigits} from '../core/search-normalizer.js';
import {clientData,fileData,opponentData} from '../domain/normalizers.js';
import {allFileTypeFields,phonesOf,isClosedFile} from '../domain/entities.js';

const FILE_TEXT_FIELDS=['fileNumber','title','fileType','mainCategory','subCategory','status','responsibleLawyer','coLawyers','staff','nextStep','closeReason','archivedReason','notes'];
const STAGE_TEXT_FIELDS=['caseNumber','caseYear','numberType','stageType','courtId','chamber','degree','status','subject','policeStation','prosecution'];

export function partyDisplay(p){return `${p.role?p.role+': ':''}${p.name||''}`}

// نص البحث المطبّع للملف: يُعاد بناؤه بعد حفظ الملف أو أطرافه أو مراحله. لا يُستخدم كمصدر للبيانات.
export async function refreshFileSearchText(office,fileId){
 if(!fileId)return null;
 const f=await office.r.files.get(fileId);if(!f)return null;
 const [parties,stages]=await Promise.all([office.r.fileParties.byIndex('fileId',fileId,500),office.r.cases.byIndex('fileId',fileId,500)]);
 const bits=[];
 for(const k of FILE_TEXT_FIELDS)bits.push(f[k]);
 for(const fld of allFileTypeFields())if(typeof f[fld.k]==='string')bits.push(f[fld.k]);
 for(const [k,v] of Object.entries(f))if(k.startsWith('x_')&&(typeof v==='string'||typeof v==='number'))bits.push(String(v));
 if(f.typeSnapshot)bits.push(f.typeSnapshot.category,f.typeSnapshot.type);
 for(const p of parties)bits.push(p.name,p.role,p.phone);
 for(const s of stages)for(const k of STAGE_TEXT_FIELDS)bits.push(s[k]);
 const text=normalizeArabic(bits.filter(v=>v!==undefined&&v!==null&&v!=='').join(' | '));
 const partyNames=parties.map(partyDisplay).join('، ');
 if(f.searchText===text&&f.partyNames===partyNames)return f;
 // حقل مشتق: لا نرفع رقم الإصدار حتى لا يتعارض مع نموذج تعديل مفتوح.
 f.searchText=text;f.partyNames=partyNames;f.searchIndexedAt=Clock.now();
 await office.r.files.put(f);
 return f;
}
export async function rebuildAllFileSearchText(office,onProgress=null){
 let cursor=null,done=0;
 do{const page=await office.r.files.page({limit:100,cursor});for(const f of page.items){await refreshFileSearchText(office,f.id);done++}onProgress?.(done);cursor=page.nextCursor}while(cursor);
 return done;
}

// إنشاء ملف جديد (الخطوة الأولى) مع الموكل وصفته في معاملة واحدة، مع إنشاء موكل جديد بالاسم إن لزم.
export async function createLegalFile(office,input){
 const x={...input};
 const clientId=x.clientId||'';const newClientName=String(x.newClientName||'').trim();const newClientPhone=String(x.newClientPhone||'').trim();
 const role=x.clientRole||'موكل';
 for(const k of ['clientId','clientRole','newClientName','newClientPhone'])delete x[k];
 if(x.openedAt&&!/^\d{4}-\d{2}-\d{2}$/.test(x.openedAt))throw new AppError(ERR.VALIDATION,'تاريخ الفتح غير صحيح.');
 const now=Clock.now();
 const newClient=!clientId&&newClientName?{...clientData({fullName:newClientName,phones:newClientPhone?[newClientPhone]:[],phone:newClientPhone}),id:uid(),status:'active',createdAt:now,updatedAt:now,version:1,isArchived:false,isDeleted:false,deletedAt:null}:null;
 const row={...fileData(x),id:uid(),status:x.status||'مفتوح',priority:x.priority||'normal',openedAt:x.openedAt||Clock.today(),createdAt:now,updatedAt:now,lastActivityAt:now,version:1,isArchived:false,isDeleted:false,deletedAt:null};
 const year=row.openedAt.slice(0,4);
 const out=await transaction(office.ctx,[STORE.files,STORE.fileNumberCounters,STORE.fileClients,STORE.fileParties,STORE.clients,STORE.activityLog],async tx=>{
  let client=null;
  if(newClient){await request(tx.objectStore(STORE.clients).add(newClient));await request(tx.objectStore(STORE.activityLog).add(office.activity('clients',newClient.id,'create')));client=newClient}
  else if(clientId){client=await request(tx.objectStore(STORE.clients).get(clientId));if(!client||client.isDeleted)throw new AppError(ERR.NOT_FOUND,'الموكل غير موجود.')}
  if(!row.title?.trim()){row.title=[row.fileType||'ملف',client?.fullName].filter(Boolean).join(' — ');row.titleNormalized=normalizeArabic(row.title)}
  const cs=tx.objectStore(STORE.fileNumberCounters);const counter=await request(cs.get('file:'+year));const next=(counter?.lastNumber||0)+1;
  row.fileNumber=`${year}/${String(next).padStart(4,'0')}`;
  await request(cs.put({id:'file:'+year,year,lastNumber:next,updatedAt:now}));
  await request(tx.objectStore(STORE.files).add(row));
  if(client){
   await request(tx.objectStore(STORE.fileClients).put({id:`${row.id}::${client.id}`,fileId:row.id,clientId:client.id,role:'principal',createdAt:now}));
   await request(tx.objectStore(STORE.fileParties).put({id:uid(),fileId:row.id,partyKind:'client',clientId:client.id,opponentId:null,name:client.fullName,phone:phonesOf(client)[0]||'',role,createdAt:now,updatedAt:now,version:1,isDeleted:false}));
  }
  await request(tx.objectStore(STORE.activityLog).add(office.activity('files',row.id,'create',row.id)));
  return row;
 });
 events.emit('entity:changed',{entityType:'files',id:out.id});
 await refreshFileSearchText(office,out.id);
 return out;
}

// حفظ طرف في ملف. الطرف قد يكون موكلًا مسجلًا أو خصمًا مسجلًا أو طرفًا آخر بالاسم فقط.
// إذا كُتب اسم جديد لموكل/خصم غير مسجل يُنشأ سجله تلقائيًا (بالاسم فقط، وباقي البيانات لاحقًا).
export async function saveParty(office,input,id=null){
 const x={...input};const old=id?await office.r.fileParties.get(id):null;
 if(id&&!old)throw new AppError(ERR.NOT_FOUND,'الطرف غير موجود.');
 const fileId=x.fileId||old?.fileId;if(!fileId)throw new AppError(ERR.VALIDATION,'يجب ربط الطرف بملف.',{fileId:'الملف مطلوب'});
 const file=await office.r.files.get(fileId);if(!file||file.isDeleted)throw new AppError(ERR.NOT_FOUND,'الملف غير موجود.');
 const kind=x.partyKind||old?.partyKind||(x.clientId?'client':x.opponentId?'opponent':'other');
 const name=String(x.name||'').trim();const now=Clock.now();
 let person=null,newPerson=null;
 if(kind==='client'){
  if(x.clientId)person=await office.r.clients.get(x.clientId);
  else if(name)newPerson={...clientData({fullName:name}),id:uid(),status:'active',createdAt:now,updatedAt:now,version:1,isArchived:false,isDeleted:false,deletedAt:null,phones:[]};
  else throw new AppError(ERR.VALIDATION,'اختر الموكل أو اكتب اسمه.',{clientId:'مطلوب'});
 }else if(kind==='opponent'){
  if(x.opponentId)person=await office.r.opponents.get(x.opponentId);
  else if(name)newPerson={...opponentData({name}),id:uid(),createdAt:now,updatedAt:now,version:1,isArchived:false,isDeleted:false,deletedAt:null,phones:[]};
  else throw new AppError(ERR.VALIDATION,'اختر الخصم أو اكتب اسمه.',{opponentId:'مطلوب'});
 }else if(!name)throw new AppError(ERR.VALIDATION,'اسم الطرف مطلوب.',{name:'مطلوب'});
 if(person&&person.isDeleted)throw new AppError(ERR.NOT_FOUND,'الشخص المختار محذوف.');
 const p=person||newPerson;
 const row={...(old||{}),...x,id:id||uid(),fileId,partyKind:kind,
  clientId:kind==='client'?p.id:null,opponentId:kind==='opponent'?p.id:null,
  name:kind==='client'?p.fullName:kind==='opponent'?p.name:name,
  phone:p?phonesOf(p)[0]||'':(x.phone||old?.phone||''),role:x.role||old?.role||(kind==='client'?'موكل':kind==='opponent'?'خصم':''),
  createdAt:old?.createdAt||now,updatedAt:now,version:(old?.version||0)+1,isDeleted:false};
 const stores=[STORE.fileParties,STORE.fileClients,STORE.files,STORE.activityLog,STORE.clients,STORE.opponents];
 await transaction(office.ctx,stores,async tx=>{
  if(newPerson){const st=kind==='client'?STORE.clients:STORE.opponents;await request(tx.objectStore(st).add(newPerson));await request(tx.objectStore(STORE.activityLog).add(office.activity(st,newPerson.id,'create',fileId)))}
  await request(tx.objectStore(STORE.fileParties).put(row));
  if(kind==='client')await request(tx.objectStore(STORE.fileClients).put({id:`${fileId}::${row.clientId}`,fileId,clientId:row.clientId,role:'principal',createdAt:now}));
  file.lastActivityAt=now;file.updatedAt=now;file.version=(file.version||0)+1;await request(tx.objectStore(STORE.files).put(file));
  await request(tx.objectStore(STORE.activityLog).add(office.activity('fileParties',row.id,id?'update':'create',fileId)));
 });
 events.emit('entity:changed',{entityType:'fileParties',id:row.id});
 await refreshFileSearchText(office,fileId);
 return row;
}
export async function removeParty(office,id){
 const old=await office.r.fileParties.get(id);if(!old)throw new AppError(ERR.NOT_FOUND,'الطرف غير موجود.');
 const now=Clock.now();old.isDeleted=true;old.deletedAt=now;old.updatedAt=now;old.version=(old.version||0)+1;
 const others=old.clientId?(await office.r.fileParties.byIndex('fileId',old.fileId,500)).filter(p=>p.id!==id&&p.clientId===old.clientId):[];
 await transaction(office.ctx,[STORE.fileParties,STORE.fileClients,STORE.activityLog],async tx=>{
  await request(tx.objectStore(STORE.fileParties).put(old));
  if(old.clientId&&!others.length)await request(tx.objectStore(STORE.fileClients).delete(`${old.fileId}::${old.clientId}`));
  await request(tx.objectStore(STORE.activityLog).add(office.activity('fileParties',id,'delete',old.fileId)));
 });
 events.emit('entity:changed',{entityType:'fileParties',id});
 await refreshFileSearchText(office,old.fileId);
}
// أطراف الملف مع دمج روابط الموكلين القديمة (fileClients) التي لم تُرحّل بعد.
export async function fileParties(office,fileId){
 const [parties,links]=await Promise.all([office.r.fileParties.byIndex('fileId',fileId,500),office.r.fileClients.byIndex('fileId',fileId,500)]);
 const have=new Set(parties.map(p=>p.clientId).filter(Boolean));
 const missing=links.filter(l=>!have.has(l.clientId));
 if(missing.length){const cs=await office.r.clients.getMany(missing.map(l=>l.clientId));for(const c of cs)parties.push({id:null,legacy:true,fileId,partyKind:'client',clientId:c.id,name:c.fullName,phone:phonesOf(c)[0]||'',role:'موكل'})}
 return parties;
}

export async function saveRelation(office,input,id=null){
 const old=id?await office.r.fileRelations.get(id):null;
 const x={...(old||{}),...input};
 if(!x.sourceFileId||!x.targetFileId)throw new AppError(ERR.VALIDATION,'اختر الملفين.',{targetFileId:'الملف المرتبط مطلوب'});
 if(x.sourceFileId===x.targetFileId)throw new AppError(ERR.VALIDATION,'لا يمكن ربط الملف بنفسه.');
 const [a,b]=await office.r.files.getMany([x.sourceFileId,x.targetFileId]).then(rows=>[rows.find(r=>r.id===x.sourceFileId),rows.find(r=>r.id===x.targetFileId)]);
 if(!a||!b)throw new AppError(ERR.NOT_FOUND,'أحد الملفين غير موجود.');
 const now=Clock.now();
 const row={...x,id:id||uid(),createdAt:old?.createdAt||now,updatedAt:now,version:(old?.version||0)+1,isDeleted:false};
 await transaction(office.ctx,[STORE.fileRelations,STORE.activityLog],async tx=>{
  await request(tx.objectStore(STORE.fileRelations).put(row));
  await request(tx.objectStore(STORE.activityLog).add(office.activity('fileRelations',row.id,id?'update':'create',row.sourceFileId)));
  await request(tx.objectStore(STORE.activityLog).add(office.activity('fileRelations',row.id,id?'update':'create',row.targetFileId)));
 });
 events.emit('entity:changed',{entityType:'fileRelations',id:row.id});return row;
}
export async function fileRelations(office,fileId){
 const [out,inc]=await Promise.all([office.r.fileRelations.byIndex('sourceFileId',fileId,500),office.r.fileRelations.byIndex('targetFileId',fileId,500)]);
 return [...out.map(r=>({...r,direction:'out',otherFileId:r.targetFileId})),...inc.map(r=>({...r,direction:'in',otherFileId:r.sourceFileId}))];
}

// الأرشفة مع السبب، وإعادة الفتح. الحالة إدارية فقط.
export async function archiveFile(office,id,reason=''){
 const f=await office.r.files.get(id);if(!f||f.isDeleted)throw new AppError(ERR.NOT_FOUND,'الملف غير موجود.');
 const now=Clock.now();
 if(!f.isArchived)f.statusBeforeArchive=f.status||'';
 Object.assign(f,{isArchived:true,archivedAt:now,archivedReason:String(reason||'').trim(),status:'مؤرشف',updatedAt:now,version:(f.version||0)+1});
 await putFileWithActivity(office,f,'archive');await refreshFileSearchText(office,id);return f;
}
export async function reopenFile(office,id,reason=''){
 const f=await office.r.files.get(id);if(!f||f.isDeleted)throw new AppError(ERR.NOT_FOUND,'الملف غير موجود.');
 const now=Clock.now();const prev=f.statusBeforeArchive;
 Object.assign(f,{isArchived:false,archivedAt:null,status:prev&&!isClosedFile({status:prev})?prev:'مفتوح',reopenedAt:now,reopenReason:String(reason||'').trim(),updatedAt:now,lastActivityAt:now,version:(f.version||0)+1});
 await putFileWithActivity(office,f,'reopen');await refreshFileSearchText(office,id);return f;
}
export async function closeFile(office,id,{closedAt='',closeReason=''}={}){
 const f=await office.r.files.get(id);if(!f||f.isDeleted)throw new AppError(ERR.NOT_FOUND,'الملف غير موجود.');
 const now=Clock.now();Object.assign(f,{status:'منتهٍ',closedAt:closedAt||Clock.today(),closeReason:String(closeReason||'').trim(),updatedAt:now,lastActivityAt:now,version:(f.version||0)+1});
 await putFileWithActivity(office,f,'update');await refreshFileSearchText(office,id);return f;
}
async function putFileWithActivity(office,f,action){
 await transaction(office.ctx,[STORE.files,STORE.activityLog],async tx=>{await request(tx.objectStore(STORE.files).put(f));await request(tx.objectStore(STORE.activityLog).add(office.activity('files',f.id,action,f.id)))});
 events.emit('entity:changed',{entityType:'files',id:f.id});
}
export const normalizeQuery=q=>normalizeArabic(normalizeDigits(q||''));
