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
import {PARTY_ROLE_GROUP_MAP} from '../domain/taxonomy-defaults.js';

const FILE_TEXT_FIELDS=['fileNumber','title','fileType','mainCategory','subCategory','status','responsibleLawyer','coLawyers','staff','nextStep','closeReason','archivedReason','notes'];
const STAGE_TEXT_FIELDS=['caseNumber','caseYear','numberType','stageType','courtId','chamber','degree','status','subject','policeStation','prosecution'];

export function partyDisplay(p){return `${p.role?p.role+': ':''}${p.name||''}`}

// نص البحث المطبّع للملف: يُعاد بناؤه بعد حفظ الملف أو أطرافه أو مراحله. لا يُستخدم كمصدر للبيانات.
export async function refreshFileSearchText(office,fileId){
 if(!fileId)return null;
 const f=await office.r.files.get(fileId);if(!f)return null;
 const [parties,stages]=await Promise.all([office.r.fileParties.byIndexAll('fileId',fileId),office.r.cases.byIndex('fileId',fileId,500)]);
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
   await request(tx.objectStore(STORE.fileParties).put({id:uid(),fileId:row.id,partyKind:'client',partyType:'client',clientId:client.id,opponentId:null,name:client.fullName,partyName:client.fullName,phone:phonesOf(client)[0]||'',role,roleGroup:PARTY_ROLE_GROUP_MAP[role]||'موكلو المكتب',sequence:1,isClient:true,isPrimary:true,isActive:true,activeStatus:'active',notes:'',createdAt:now,updatedAt:now,version:1,isDeleted:false,deletedAt:null}));
  }
  await request(tx.objectStore(STORE.activityLog).add(office.activity('files',row.id,'create',row.id)));
  return row;
 });
 events.emit('entity:changed',{entityType:'files',id:out.id});
 await refreshFileSearchText(office,out.id);
 return out;
}

// Save one party link. Registered clients remain referenced by clientId; external party data stays on this file link.
export async function saveParty(office,input,id=null){
 const x={...input};const allowDuplicate=Boolean(x.allowDuplicate);delete x.allowDuplicate;const old=id?await office.r.fileParties.get(id):null;
 if(id&&!old)throw new AppError(ERR.NOT_FOUND,'الطرف غير موجود.');
 const fileId=x.fileId||old?.fileId;if(!fileId)throw new AppError(ERR.VALIDATION,'يجب ربط الطرف بملف.',{fileId:'الملف مطلوب'});
 const file=await office.r.files.get(fileId);if(!file||file.isDeleted)throw new AppError(ERR.NOT_FOUND,'الملف غير موجود.');
 const kind=x.partyKind||old?.partyKind||(x.clientId?'client':x.opponentId?'opponent':'other');
 const role=String(x.role||old?.role||(kind==='client'?'موكل':kind==='opponent'?'خصم':'طرف آخر')).trim();
 const roleChanged=Boolean(old&&old.role!==role);const requestedGroup=String(x.roleGroup||'').trim();
 const group=String(requestedGroup&&!(roleChanged&&requestedGroup===old?.roleGroup)?requestedGroup:(roleChanged?PARTY_ROLE_GROUP_MAP[role]:old?.roleGroup)||PARTY_ROLE_GROUP_MAP[role]||'أطراف أخرى').trim();
 const name=String(x.partyName||x.name||old?.partyName||old?.name||'').trim();const now=Clock.now();
 let person=null,newPerson=null;
 if(kind==='client'){
  if(x.clientId)person=await office.r.clients.get(x.clientId);
  else if(name)newPerson={...clientData({fullName:name}),id:uid(),status:'active',createdAt:now,updatedAt:now,version:1,isArchived:false,isDeleted:false,deletedAt:null,phones:[]};
  else throw new AppError(ERR.VALIDATION,'اختر الموكل أو اكتب اسمه.',{clientId:'مطلوب'});
 }else if(kind==='opponent'){
  if(x.opponentId)person=await office.r.opponents.get(x.opponentId);
  else if(name)newPerson={...opponentData({name}),id:uid(),createdAt:now,updatedAt:now,version:1,isArchived:false,isDeleted:false,deletedAt:null,phones:[]};
  else throw new AppError(ERR.VALIDATION,'اختر الخصم أو اكتب اسمه.',{name:'مطلوب'});
 }else if(!name)throw new AppError(ERR.VALIDATION,'اسم الطرف مطلوب.',{name:'مطلوب'});
 if(person&&person.isDeleted)throw new AppError(ERR.NOT_FOUND,'الشخص المختار محذوف.');
 if(x.clientId&&!person)throw new AppError(ERR.NOT_FOUND,'الموكل المختار غير موجود.');
 if(x.opponentId&&!person)throw new AppError(ERR.NOT_FOUND,'الخصم المختار غير موجود.');
 const p=person||newPerson;const personId=kind==='client'?p.id:kind==='opponent'?p.id:'';
 const row={...(old||{}),...x,id:id||uid(),fileId,partyKind:kind,partyType:kind==='other'?'external':kind,
  clientId:kind==='client'?p.id:null,opponentId:kind==='opponent'?p.id:null,
  name:kind==='client'?p.fullName:kind==='opponent'?p.name:name,
  partyName:kind==='client'?p.fullName:kind==='opponent'?p.name:name,
  phone:p?phonesOf(p)[0]||'':(x.phone||old?.phone||''),role,roleGroup:group,
  isClient:kind==='client',isPrimary:x.isPrimary===undefined?Boolean(old?.isPrimary):Boolean(x.isPrimary),
  isActive:x.isActive===undefined?(old?.isActive!==false):Boolean(x.isActive),activeStatus:(x.isActive===undefined?(old?.isActive!==false):Boolean(x.isActive))?'active':'inactive',notes:String(x.notes??old?.notes??''),
  createdAt:old?.createdAt||now,updatedAt:now,version:(old?.version||0)+1,isDeleted:false};
 const stores=[STORE.fileParties,STORE.fileClients,STORE.files,STORE.activityLog,STORE.clients,STORE.opponents];
 await transaction(office.ctx,stores,async tx=>{
  const partyStore=tx.objectStore(STORE.fileParties);
  if(kind==='client'&&personId&&!allowDuplicate){
   const dupe=await request(partyStore.index('fileId_clientId_role').get([fileId,personId,role]));
   if(dupe&&!dupe.isDeleted&&dupe.id!==id)throw new AppError(ERR.CONFLICT,'يوجد الموكل نفسه بهذه الصفة في هذا الملف. يمكن المتابعة إذا كان التكرار مقصودًا.',{duplicateParty:true,partyId:dupe.id});
  }
  if(newPerson){const st=kind==='client'?STORE.clients:STORE.opponents;await request(tx.objectStore(st).add(newPerson));await request(tx.objectStore(STORE.activityLog).add(office.activity(st,newPerson.id,'create',fileId)))}
  if(old?.clientId&&old.clientId!==row.clientId){
   const linked=await request(partyStore.index('fileId').getAll(IDBKeyRange.only(fileId)));
   const remains=linked.some(p=>p.id!==old.id&&p.clientId===old.clientId&&!p.isDeleted);
   if(!remains)await request(tx.objectStore(STORE.fileClients).delete(`${fileId}::${old.clientId}`));
  }
  const movedGroup=Boolean(old&&old.roleGroup!==group);
  const sequenceUnchangedWhileMoving=movedGroup&&Number(x.sequence)===Number(old.sequence);
  if(!Number.isFinite(Number(x.sequence))||Number(x.sequence)<1||sequenceUnchangedWhileMoving){
   if(old&&!movedGroup&&Number(old.sequence)>0)row.sequence=Number(old.sequence);
   else{
    const range=IDBKeyRange.bound([fileId,group,0],[fileId,group,Number.MAX_SAFE_INTEGER]);
    const last=await request(partyStore.index('fileId_roleGroup_sequence').openCursor(range,'prev'));
    row.sequence=(Number(last?.value?.sequence)||0)+1;
   }
  }else row.sequence=Math.floor(Number(x.sequence));
  await request(partyStore.put(row));
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
 const now=Clock.now();old.isDeleted=true;old.isActive=false;old.activeStatus='inactive';old.deletedAt=now;old.updatedAt=now;old.version=(old.version||0)+1;
 const all=old.clientId?await office.r.fileParties.byIndexAll('fileId',old.fileId):[];
 const others=all.filter(p=>p.id!==id&&p.clientId===old.clientId&&!p.isDeleted);
 await transaction(office.ctx,[STORE.fileParties,STORE.fileClients,STORE.activityLog],async tx=>{
  await request(tx.objectStore(STORE.fileParties).put(old));
  if(old.clientId&&!others.length)await request(tx.objectStore(STORE.fileClients).delete(`${old.fileId}::${old.clientId}`));
  await request(tx.objectStore(STORE.activityLog).add(office.activity('fileParties',id,'delete',old.fileId)));
 });
 events.emit('entity:changed',{entityType:'fileParties',id});
 await refreshFileSearchText(office,old.fileId);
}
/** ترتيب الطرف داخل مجموعته مع ضغط التسلسل إلى 1..N؛ لا يغير الصفة أو أي سجل شخصي. */
export async function moveParty(office,id,direction){
 const party=await office.r.fileParties.get(id);if(!party||party.isDeleted)throw new AppError(ERR.NOT_FOUND,'الطرف غير موجود.');
 const group=party.roleGroup||PARTY_ROLE_GROUP_MAP[party.role]||'أطراف أخرى';
 const rows=(await office.r.fileParties.byIndexAll('fileId',party.fileId)).filter(p=>!p.isDeleted&&(p.roleGroup||PARTY_ROLE_GROUP_MAP[p.role]||'أطراف أخرى')===group)
  .sort((a,b)=>(Number(a.sequence)||Number.MAX_SAFE_INTEGER)-(Number(b.sequence)||Number.MAX_SAFE_INTEGER)||String(a.createdAt||'').localeCompare(String(b.createdAt||''))||String(a.id).localeCompare(String(b.id)));
 const from=rows.findIndex(p=>p.id===id),to=from+Math.sign(Number(direction)||0);if(from<0||to<0||to>=rows.length)return party;
 [rows[from],rows[to]]=[rows[to],rows[from]];const now=Clock.now();
 await transaction(office.ctx,[STORE.fileParties,STORE.activityLog],async tx=>{
  const s=tx.objectStore(STORE.fileParties);
  for(let i=0;i<rows.length;i++){rows[i].sequence=i+1;rows[i].roleGroup=group;rows[i].updatedAt=now;rows[i].version=(rows[i].version||0)+1;await request(s.put(rows[i]))}
  await request(tx.objectStore(STORE.activityLog).add(office.activity('fileParties',id,'reorder',party.fileId)));
 });
 events.emit('entity:changed',{entityType:'fileParties',id});return rows[to];
}
// أطراف الملف مع دمج روابط الموكلين القديمة (fileClients) التي لم تُرحّل بعد.
export async function fileParties(office,fileId){
 const [parties,links]=await Promise.all([office.r.fileParties.byIndexAll('fileId',fileId),office.r.fileClients.byIndexAll('fileId',fileId)]);
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
