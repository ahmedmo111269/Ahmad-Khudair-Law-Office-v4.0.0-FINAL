import {STORES, SCHEMA_VERSION} from '../db/schema.js';
import {APP_VERSION} from '../core/constants.js';
import {AppError, ERR} from '../core/errors.js';

export const BACKUP_FORMAT='AhmadKhudairLawOfficeBackup';
export const BACKUP_VERSION=3;

function readStoresSnapshot(db){
  return new Promise((resolve,reject)=>{
    const rows=Object.fromEntries(STORES.map(s=>[s,[]]));
    let finished=0, settled=false;
    const tx=db.transaction(STORES,'readonly');
    const fail=err=>{if(settled)return;settled=true;reject(err||new Error('تعذر إنشاء لقطة النسخة الاحتياطية.'))};
    tx.onerror=()=>fail(tx.error||new Error('تعذر تصدير قاعدة البيانات.'));
    tx.onabort=()=>fail(tx.error||new Error('تم إلغاء تصدير قاعدة البيانات.'));
    tx.oncomplete=()=>{if(!settled){settled=true;resolve(rows)}};
    for(const storeName of STORES){
      const req=tx.objectStore(storeName).openCursor();
      req.onsuccess=()=>{
        const c=req.result;
        if(c){rows[storeName].push(c.value);c.continue()}
        else finished++;
      };
      req.onerror=()=>fail(req.error||new Error(`تعذر قراءة ${storeName}`));
    }
  });
}
async function digest(text){
  if(globalThis.crypto?.subtle){const bytes=new TextEncoder().encode(text);const hash=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('')}
  return null;
}
function counts(stores){return Object.fromEntries(STORES.map(s=>[s,Array.isArray(stores[s])?stores[s].length:0]))}

export async function exportDatabase(ctx){
  ctx.assert();
  const data={format:BACKUP_FORMAT,version:BACKUP_VERSION,applicationVersion:APP_VERSION,schemaVersion:SCHEMA_VERSION,
    database:{...ctx.profile},exportedAt:new Date().toISOString(),stores:{}};
  data.stores=await readStoresSnapshot(ctx.db);
  data.manifest={storeNames:[...STORES],recordCounts:counts(data.stores),totalRecords:Object.values(counts(data.stores)).reduce((a,b)=>a+b,0)};
  data.integrity={algorithm:'SHA-256',storesDigest:await digest(JSON.stringify(data.stores))};
  return data;
}

function validatePayload(payload){
  if(!payload||payload.format!==BACKUP_FORMAT)throw new AppError(ERR.VALIDATION,'ملف النسخة الاحتياطية غير صالح أو ليس من هذا البرنامج.');
  if(Number(payload.version)!==BACKUP_VERSION)throw new AppError(ERR.VALIDATION,`إصدار ملف النسخة ${payload.version||'غير معروف'} غير مدعوم. أنشئ نسخة جديدة من الإصدار الحالي.`);
  if(Number(payload.schemaVersion)!==SCHEMA_VERSION)throw new AppError(ERR.VALIDATION,`إصدار بنية البيانات في النسخة (${payload.schemaVersion||'غير معروف'}) لا يطابق الإصدار الحالي (${SCHEMA_VERSION}). لم يتم تعديل القاعدة.`);
  if(!payload.stores||typeof payload.stores!=='object')throw new AppError(ERR.VALIDATION,'النسخة لا تحتوي على مخازن البيانات.');
  for(const s of STORES)if(!Array.isArray(payload.stores[s]))throw new AppError(ERR.VALIDATION,`النسخة ناقصة: ${s}`);
  for(const key of Object.keys(payload.stores))if(!STORES.includes(key))throw new AppError(ERR.VALIDATION,`مخزن غير معروف في النسخة: ${key}`);
  if(payload.manifest){
    if(!Array.isArray(payload.manifest.storeNames)||payload.manifest.storeNames.length!==STORES.length||STORES.some(s=>!payload.manifest.storeNames.includes(s)))throw new AppError(ERR.VALIDATION,'بيان المخازن في النسخة غير متوافق مع بنية البرنامج.');
    const actual=counts(payload.stores);
    for(const s of STORES)if(Number(payload.manifest.recordCounts?.[s])!==actual[s])throw new AppError(ERR.VALIDATION,`عدد السجلات المعلن للمخزن ${s} لا يطابق البيانات الفعلية.`);
    const total=Object.values(actual).reduce((a,b)=>a+b,0);
    if(payload.manifest.totalRecords!=null&&Number(payload.manifest.totalRecords)!==total)throw new AppError(ERR.VALIDATION,'إجمالي السجلات المعلن لا يطابق البيانات الفعلية.');
  }
  return true;
}
async function verifyIntegrity(payload){
  if(!payload.integrity?.storesDigest)return {verified:false,reason:'لا توجد بصمة سلامة في الملف.'};
  const actual=await digest(JSON.stringify(payload.stores));
  if(actual&&actual!==payload.integrity.storesDigest)throw new AppError(ERR.VALIDATION,'فشل التحقق من سلامة ملف النسخة: البصمة لا تطابق البيانات.');
  return {verified:Boolean(actual),reason:actual?'تم التحقق من SHA-256.':'تعذر حساب SHA-256 في هذا المتصفح.'};
}

export async function inspectBackup(payload){
  validatePayload(payload); const integrity=await verifyIntegrity(payload);
  return {valid:true,integrity,applicationVersion:payload.applicationVersion,schemaVersion:payload.schemaVersion,exportedAt:payload.exportedAt,database:payload.database||{},recordCounts:counts(payload.stores)};
}

export async function importDatabase(ctx,payload,{mode='replace'}={}){
  ctx.assert();
  await inspectBackup(payload);
  if(mode!=='replace')throw new AppError(ERR.VALIDATION,'وضع الاستعادة المدعوم حاليًا هو الاستبدال الكامل فقط.');
  const tx=ctx.db.transaction(STORES,'readwrite');
  try{for(const s of STORES){const st=tx.objectStore(s);st.clear();for(const row of payload.stores[s])st.put(row)}}
  catch(err){try{tx.abort()}catch{};throw new AppError(ERR.TX,'تعذر تجهيز عملية الاستعادة. لم يتم اعتماد التغيير.',err)}
  await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||new Error('فشلت الاستعادة'));tx.onabort=()=>reject(tx.error||new Error('تم إلغاء الاستعادة'))});
  return {stores:counts(payload.stores),exportedAt:payload.exportedAt};
}

export function downloadJSON(data,name){const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500)}
