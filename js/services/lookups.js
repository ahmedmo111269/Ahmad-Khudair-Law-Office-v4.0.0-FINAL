// خدمة القوائم القابلة للتعديل (مخزن lookups الموجود أصلًا في البنية).
// كل صف: {id, category, value, order, isDeleted}. القيم الافتراضية تُزرع مرة واحدة لكل فئة فارغة.
import {LOOKUP_CATEGORIES} from '../domain/lookup-defaults.js';
import {uid} from '../core/id.js';
import {Clock} from '../core/clock.js';
import {transaction,request} from '../db/unit-of-work.js';
import {STORE} from '../db/schema.js';
import {AppError,ERR} from '../core/errors.js';
import {events} from '../core/events.js';

const cache=new Map(); // `${token}|${category}` -> values[]
const key=(office,cat)=>`${office.ctx.token}|${cat}`;
export function clearLookupCache(){cache.clear()}
events.on('entity:changed',p=>{if(p?.entityType===STORE.lookups)cache.clear()});
events.on('db:restored',()=>cache.clear()); // الاستعادة فوق القاعدة الحالية تستبدل صفوف lookups بلا entity:changed

export async function lookupRows(office,category){
 const rows=await office.r.lookups.byIndex('category',category,5000);
 return rows.filter(r=>!r.isDeleted).sort((a,b)=>(a.order??0)-(b.order??0)||String(a.value).localeCompare(String(b.value),'ar'));
}
export async function getLookup(office,category){
 const k=key(office,category);if(cache.has(k))return cache.get(k);
 let values=(await lookupRows(office,category)).map(r=>r.value);
 if(!values.length)values=[...(LOOKUP_CATEGORIES[category]?.values||[])];
 cache.set(k,values);return values;
}
export async function getLookups(office,categories){const out={};await Promise.all([...new Set(categories)].map(async c=>{out[c]=await getLookup(office,c)}));return out}

// countByIndex يتجاهل المحذوف منطقيًا؛ نحتاج عدًّا شاملًا لمعرفة إن كانت الفئة زُرعت من قبل.
async function rawCount(office,category){const db=office.ctx.db;return new Promise((res,rej)=>{const r=db.transaction(STORE.lookups).objectStore(STORE.lookups).index('category').count(IDBKeyRange.only(category));r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
// زرع القيم الافتراضية للفئات التي لم تُزرع من قبل (العد يشمل المحذوف منطقيًا حتى لا تعود قيمة حذفها المستخدم).
export async function seedLookups(office){
 const add=[];
 for(const [category,def] of Object.entries(LOOKUP_CATEGORIES)){
  if(await rawCount(office,category))continue;
  def.values.forEach((value,i)=>add.push({id:uid(),category,value,order:i+1,isDeleted:false,createdAt:Clock.now(),updatedAt:Clock.now()}));
 }
 if(!add.length)return 0;
 await transaction(office.ctx,[STORE.lookups],async tx=>{const s=tx.objectStore(STORE.lookups);for(const r of add)await request(s.put(r))});
 cache.clear();return add.length;
}

export async function saveLookupValue(office,category,value,id=null){
 const v=String(value||'').trim();if(!v)throw new AppError(ERR.VALIDATION,'القيمة مطلوبة.');
 const rows=await lookupRows(office,category);
 if(rows.some(r=>r.value===v&&r.id!==id))throw new AppError(ERR.CONFLICT,'القيمة موجودة بالفعل في القائمة.');
 const problem=LOOKUP_CATEGORIES[category]?.check?.(v,rows,id); // تحقق خاص بالفئة (مثل حالات المهام) يسري على كل مسارات الإضافة
 if(problem)throw new AppError(ERR.VALIDATION,problem);
 const old=id?await office.r.lookups.get(id):null;
 const row={...(old||{}),id:id||uid(),category,value:v,order:old?.order??((rows.at(-1)?.order||0)+1),isDeleted:false,createdAt:old?.createdAt||Clock.now(),updatedAt:Clock.now()};
 await transaction(office.ctx,[STORE.lookups,STORE.activityLog],async tx=>{await request(tx.objectStore(STORE.lookups).put(row));await request(tx.objectStore(STORE.activityLog).add(office.activity('lookups',row.id,id?'update':'create')))});
 cache.clear();events.emit('entity:changed',{entityType:STORE.lookups,id:row.id});return row;
}
// حذف منطقي فقط: القيم المستخدمة في السجلات القديمة تبقى محفوظة كما هي في السجلات.
export async function removeLookupValue(office,id){
 const old=await office.r.lookups.get(id);if(!old)throw new AppError(ERR.NOT_FOUND,'القيمة غير موجودة.');
 old.isDeleted=true;old.deletedAt=Clock.now();old.updatedAt=old.deletedAt;
 await transaction(office.ctx,[STORE.lookups,STORE.activityLog],async tx=>{await request(tx.objectStore(STORE.lookups).put(old));await request(tx.objectStore(STORE.activityLog).add(office.activity('lookups',id,'delete')))});
 cache.clear();events.emit('entity:changed',{entityType:STORE.lookups,id});
}
export async function moveLookupValue(office,category,id,dir){
 const rows=await lookupRows(office,category);const i=rows.findIndex(r=>r.id===id),j=i+(dir<0?-1:1);
 if(i<0||j<0||j>=rows.length)return;
 rows.forEach((r,n)=>r.order=n+1);[rows[i].order,rows[j].order]=[rows[j].order,rows[i].order];
 await transaction(office.ctx,[STORE.lookups],async tx=>{const s=tx.objectStore(STORE.lookups);for(const r of rows){r.updatedAt=Clock.now();await request(s.put(r))}});
 cache.clear();
}
