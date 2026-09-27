// صيانة خفيفة بعد فتح أي قاعدة بيانات (بما فيها القواعد المستعادة من نسخة أقدم):
// 1) زرع القوائم الافتراضية للفئات التي لم تُزرع. 2) ترحيل روابط الموكلين القديمة (fileClients) إلى أطراف الملف (fileParties).
// 3) بناء نص البحث للملفات التي لا تملكه. كل الخطوات لا تحذف أي بيانات ويمكن تكرارها بأمان.
import {STORE} from '../db/schema.js';
import {Clock} from '../core/clock.js';
import {transaction,request} from '../db/unit-of-work.js';
import {seedLookups} from './lookups.js';
import {refreshFileSearchText} from './legal-files.js';
import {phonesOf} from '../domain/entities.js';

const META_ID='maintenance';
export const MAINTENANCE_VERSION=1;

export async function runMaintenance(office){
 const meta=(await office.r.meta.get(META_ID))||{id:META_ID,key:META_ID};
 const report={lookups:0,parties:0,indexed:0};
 report.lookups=await seedLookups(office);
 if(!meta.partiesMigrated)report.parties=await migrateLegacyParties(office);
 report.indexed=await indexMissingSearchText(office);
 await office.r.meta.put({...meta,partiesMigrated:true,maintenanceVersion:MAINTENANCE_VERSION,lastRunAt:Clock.now()});
 return report;
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
