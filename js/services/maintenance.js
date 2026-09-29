// صيانة خفيفة بعد فتح أي قاعدة بيانات (بما فيها القواعد المستعادة من نسخة أقدم):
// 1) زرع القوائم الافتراضية للفئات التي لم تُزرع. 2) ترحيل روابط الموكلين القديمة (fileClients) إلى أطراف الملف (fileParties).
// 3) بناء نص البحث للملفات التي لا تملكه. كل الخطوات لا تحذف أي بيانات ويمكن تكرارها بأمان.
import {STORE} from '../db/schema.js';
import {Clock} from '../core/clock.js';
import {transaction,request} from '../db/unit-of-work.js';
import {seedLookups} from './lookups.js';
import {seedTaxonomy,migrateToClientFiles} from './client-files.js';
import {refreshFileSearchText} from './legal-files.js';
import {phonesOf} from '../domain/entities.js';
import {PARTY_ROLE_GROUP_MAP} from '../domain/taxonomy-defaults.js';

const META_ID='maintenance';
const SCHEMA13_META='schema13-data-backfill-v2';
export const MAINTENANCE_VERSION=2;

export async function runMaintenance(office){
 const meta=(await office.r.meta.get(META_ID))||{id:META_ID,key:META_ID};
 const report={lookups:0,parties:0,indexed:0};
 report.lookups=await seedLookups(office);
 try{report.taxonomy=await seedTaxonomy(office);report.clientFiles=await migrateToClientFiles(office)}catch(e){console.error('clientFiles migration',e);report.clientFilesError=String(e?.message||e)}
 if(!meta.partiesMigrated)report.parties=await migrateLegacyParties(office);
 report.schema13=await migrateSchema13Data(office);
 report.indexed=await indexMissingSearchText(office);
 await office.r.meta.put({...meta,partiesMigrated:true,maintenanceVersion:MAINTENANCE_VERSION,lastRunAt:Clock.now()});
 return report;
}

/** Incremental, idempotent backfill for additive schema v13 fields; never deletes or renumbers historical records. */
export async function migrateSchema13Data(office,batchSize=500){
 const marker=(await office.r.meta.get(SCHEMA13_META))||{id:SCHEMA13_META,key:SCHEMA13_META};
 const result={parties:0,hearings:0,serviceRecords:0,bailiffs:0,complete:Boolean(marker.complete)};
 if(marker.complete)return result;
 const targets=[
  {store:STORE.fileParties,result:'parties',cursor:'partyCursor',done:'partiesComplete',needs:p=>p.partyName===undefined||p.partyType===undefined||p.roleGroup===undefined||p.sequence===undefined||p.isClient===undefined||p.isActive===undefined||p.activeStatus===undefined,map:p=>({...p,partyName:p.partyName??p.name??'',partyType:p.partyType??(p.partyKind==='other'?'external':p.partyKind||'external'),roleGroup:p.roleGroup??PARTY_ROLE_GROUP_MAP[p.role]??'أطراف أخرى',sequence:Number(p.sequence)>0?Number(p.sequence):1,isClient:p.isClient??(p.partyKind==='client'),isActive:p.isActive??!p.isDeleted,activeStatus:(p.isActive??!p.isDeleted)?'active':'inactive'})},
  {store:STORE.hearings,result:'hearings',cursor:'hearingCursor',done:'hearingsComplete',needs:h=>h.stageId===undefined,map:h=>({...h,stageId:h.caseId||null})},
  {store:STORE.serviceRecords,result:'serviceRecords',cursor:'serviceRecordCursor',done:'serviceRecordsComplete',needs:r=>r.recordState===undefined,map:r=>({...r,recordState:r.isDeleted?'deleted':'active'})},
  {store:STORE.bailiffs,result:'bailiffs',cursor:'bailiffCursor',done:'bailiffsComplete',needs:b=>b.activeStatus===undefined,map:b=>({...b,activeStatus:b.isActive===false?'inactive':'active'})}
 ];
 for(const target of targets){
  if(marker[target.done])continue;
  let cursor=marker[target.cursor]||null;
  while(true){
   const batch=await readPrimaryBatch(office,target.store,cursor,batchSize);
   if(!batch.length){marker[target.done]=true;marker[target.cursor]=null;marker.updatedAt=Clock.now();await office.r.meta.put(marker);break}
   const changed=batch.filter(target.needs).map(target.map);
   if(changed.length)await transaction(office.ctx,[target.store],async tx=>{const s=tx.objectStore(target.store);for(const row of changed)await request(s.put(row))});
   cursor=batch.at(-1).id;marker[target.cursor]=cursor;marker.updatedAt=Clock.now();await office.r.meta.put(marker);
   result[target.result]+=changed.length;
   if(batch.length<batchSize){marker[target.done]=true;marker[target.cursor]=null;marker.updatedAt=Clock.now();await office.r.meta.put(marker);break}
  }
 }
 if(targets.every(target=>marker[target.done])){marker.complete=true;marker.completedAt=Clock.now();result.complete=true;await office.r.meta.put(marker)}
 return result;
}

async function readPrimaryBatch(office,store,afterId,limit){
 office.ctx.assert();const tx=office.ctx.db.transaction(store,'readonly'),s=tx.objectStore(store),range=afterId?IDBKeyRange.lowerBound(afterId,true):undefined;
 return new Promise((resolve,reject)=>{const rows=[],c=s.openCursor(range,'next');c.onerror=()=>reject(c.error);c.onsuccess=()=>{const cur=c.result;if(!cur||rows.length>=limit){resolve(rows);return}rows.push(cur.value);if(rows.length>=limit){resolve(rows);return}cur.continue()}});
}

export async function migrateLegacyParties(office){
 let cursor=null,moved=0;
 do{
  const page=await office.r.fileClients.page({limit:100,cursor});
  const batch=[];
  for(const link of page.items){
   const existing=await office.r.fileParties.byIndex('clientId',link.clientId,1000);
   if(existing.some(p=>p.fileId===link.fileId))continue;
   const c=await office.r.clients.get(link.clientId);if(!c||c.isDeleted)continue;
   batch.push({id:`legacy::${link.fileId}::${link.clientId}`,fileId:link.fileId,partyKind:'client',clientId:c.id,opponentId:null,name:c.fullName,phone:phonesOf(c)[0]||'',role:'موكل',createdAt:link.createdAt||Clock.now(),updatedAt:Clock.now(),version:1,isDeleted:false,migratedFrom:'fileClients'});
  }
  if(batch.length){await transaction(office.ctx,[STORE.fileParties],async tx=>{const s=tx.objectStore(STORE.fileParties);for(const r of batch)await request(s.put(r))});moved+=batch.length}
  cursor=page.nextCursor;
 }while(cursor);
 return moved;
}

async function indexMissingSearchText(office,max=2000){
 let cursor=null,done=0;
 do{
  const page=await office.r.files.page({limit:100,cursor,filter:f=>!f.searchIndexedAt});
  for(const f of page.items){await refreshFileSearchText(office,f.id);if(++done>=max)return done}
  cursor=page.nextCursor;
 }while(cursor);
 return done;
}
