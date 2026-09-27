import {uid} from '../core/id.js';import {Clock} from '../core/clock.js';import {normalizeArabic} from '../core/search-normalizer.js';
const normalized={opponents:'name',communications:'subject',caseNotes:'content',documentReferences:'title'};
export async function saveGeneric(office,store,input,id=null,normalizedField=null){
 const old=id?await office.r[store].get(id):null;
 const field=normalizedField||normalized[store]; const row={...(old||{}),...input,id:id||uid(),createdAt:old?.createdAt||Clock.now(),updatedAt:Clock.now(),version:(old?.version||0)+1,isArchived:old?.isArchived||false,isDeleted:old?.isDeleted||false,deletedAt:old?.deletedAt||null};
 if(field) row[field+'Normalized']=normalizeArabic(row[field]||'');
 await office.r[store].put(row);await office.log(store,row.id,id?'update':'create',row.fileId||null);return row;
}
