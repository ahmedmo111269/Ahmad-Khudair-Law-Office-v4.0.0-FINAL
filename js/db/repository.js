import {AppError,ERR} from '../core/errors.js';
import {MAX_PAGE_SIZE} from '../core/constants.js';
const MAX_REPORT_ROWS=5000;

export class Repository{
 constructor(ctx,store){this.ctx=ctx;this.store=store}
 async get(id){this.ctx.assert();return req(this.ctx.db.transaction(this.store,'readonly').objectStore(this.store).get(id))}
 async getMany(ids=[]){this.ctx.assert();const unique=[...new Set((ids||[]).filter(Boolean))];if(!unique.length)return [];const tx=this.ctx.db.transaction(this.store,'readonly'),s=tx.objectStore(this.store);return new Promise((resolve,reject)=>{const out=[];let left=unique.length;for(const id of unique){const r=s.get(id);r.onerror=()=>reject(r.error);r.onsuccess=()=>{if(r.result&&!r.result.isDeleted)out.push(r.result);if(--left===0)resolve(out)}}})}
 async all(limit=5000){this.ctx.assert();if(limit>100000)throw new AppError(ERR.VALIDATION,'حد القراءة كبير جدًا. استخدم pagination بدل القراءة الكاملة.');return req(this.ctx.db.transaction(this.store,'readonly').objectStore(this.store).getAll(null,limit))}
 async put(row){this.ctx.assert();return req(this.ctx.db.transaction(this.store,'readwrite').objectStore(this.store).put(row))}
 async add(row){this.ctx.assert();return req(this.ctx.db.transaction(this.store,'readwrite').objectStore(this.store).add(row))}
 async delete(id){this.ctx.assert();return req(this.ctx.db.transaction(this.store,'readwrite').objectStore(this.store).delete(id))}
 async byIndex(index,key,limit=5000){this.ctx.assert();if(limit<1||limit>5000)throw new AppError(ERR.VALIDATION,'حد القراءة المفهرسة غير مسموح.');const tx=this.ctx.db.transaction(this.store,'readonly'),s=tx.objectStore(this.store);if(!s.indexNames.contains(index))return[];const src=s.index(index);return new Promise((resolve,reject)=>{const out=[],c=src.openCursor(IDBKeyRange.only(key));c.onerror=()=>reject(c.error);c.onsuccess=()=>{const cur=c.result;if(!cur||out.length>=limit){resolve(out);return}if(!cur.value.isDeleted)out.push(cur.value);cur.continue()}})}
 async range(index,lower=undefined,upper=undefined,limit=100,direction='next'){this.ctx.assert();if(limit<1||limit>MAX_PAGE_SIZE)throw new AppError(ERR.VALIDATION,'حجم القراءة غير مسموح.');const tx=this.ctx.db.transaction(this.store,'readonly'),s=tx.objectStore(this.store);if(!s.indexNames.contains(index))return[];const src=s.index(index);let range; if(lower!==undefined&&upper!==undefined) range=IDBKeyRange.bound(lower,upper); else if(lower!==undefined) range=IDBKeyRange.lowerBound(lower); else if(upper!==undefined) range=IDBKeyRange.upperBound(upper); const out=[];return new Promise((resolve,reject)=>{const c=src.openCursor(range,direction==='prev'?'prev':'next');c.onerror=()=>reject(c.error);c.onsuccess=()=>{const cur=c.result;if(!cur||out.length>=limit){resolve(out);return}if(!cur.value.isDeleted)out.push(cur.value);cur.continue()}})}

 async reportRange({index,lower,upper,limit=5000,direction='next',filter=null}={}){
  this.ctx.assert(); if(limit<1||limit>MAX_REPORT_ROWS)throw new AppError(ERR.VALIDATION,'حجم التقرير غير مسموح.');
  const tx=this.ctx.db.transaction(this.store,'readonly'),s=tx.objectStore(this.store);
  if(!s.indexNames.contains(index)){
    // No index for this field: bounded full scan with an in-memory range check (keeps reports working instead of silently empty).
    const inRange=v=>{if(v===undefined||v===null)return false;try{if(lower!==undefined&&indexedDB.cmp(v,lower)<0)return false;if(upper!==undefined&&indexedDB.cmp(v,upper)>0)return false;return true}catch{return false}};
    return new Promise((resolve,reject)=>{const out=[],c=s.openCursor(null,direction==='prev'?'prev':'next');c.onerror=()=>reject(c.error);c.onsuccess=()=>{const cur=c.result;if(!cur||out.length>=limit){resolve(out);return}const v=cur.value;if(!v.isDeleted&&inRange(v[index])&&(!filter||filter(v)))out.push(v);cur.continue()}});
  }
  const src=s.index(index); let range; if(lower!==undefined&&upper!==undefined)range=IDBKeyRange.bound(lower,upper); else if(lower!==undefined)range=IDBKeyRange.lowerBound(lower); else if(upper!==undefined)range=IDBKeyRange.upperBound(upper);
  return new Promise((resolve,reject)=>{const out=[],c=src.openCursor(range,direction==='prev'?'prev':'next');c.onerror=()=>reject(c.error);c.onsuccess=()=>{const cur=c.result;if(!cur||out.length>=limit){resolve(out);return}if(!cur.value.isDeleted&&(!filter||filter(cur.value)))out.push(cur.value);cur.continue()}});
 }
 async count(){this.ctx.assert();return req(this.ctx.db.transaction(this.store,'readonly').objectStore(this.store).count())}
 async prefix(index,prefix,limit=10){this.ctx.assert();if(!prefix||limit<1||limit>MAX_PAGE_SIZE)return[];const tx=this.ctx.db.transaction(this.store,'readonly'),s=tx.objectStore(this.store);if(!s.indexNames.contains(index))return[];const src=s.index(index),range=IDBKeyRange.bound(prefix,prefix+'\uffff');return new Promise((resolve,reject)=>{const out=[];const c=src.openCursor(range);c.onerror=()=>reject(c.error);c.onsuccess=()=>{const cur=c.result;if(!cur||out.length>=limit){resolve(out);return}if(!cur.value.isDeleted)out.push(cur.value);cur.continue()}})}
 /**
  * Keyset (cursor) pagination.
  * direction: 'next' = ascending index order, 'prev' = descending index order.
  * cursor: opaque token returned as nextCursor by the previous call; iteration resumes strictly after it.
  * Backward navigation is handled by the caller keeping a stack of cursors (see ui/pagination.js).
  */
 async page({index=null,key=undefined,cursor=null,limit=25,direction='next',filter=null}={}){
   if(limit<1||limit>MAX_PAGE_SIZE)throw new AppError(ERR.VALIDATION,'حجم الصفحة غير مسموح.');
   this.ctx.assert();
   const tx=this.ctx.db.transaction(this.store,'readonly'),s=tx.objectStore(this.store);
   if(index&&!s.indexNames.contains(index))index=null; // unknown index: fall back to primary-key (ULID = creation) order
   const src=index?s.index(index):s;
   let decoded=null;
   if(cursor){
     try{decoded=typeof cursor==='string'?decodeCursor(cursor):cursor}catch{throw new AppError(ERR.VALIDATION,'مؤشر التصفح غير صالح.')}
     if(decoded?.sessionToken!==this.ctx.token)throw new AppError(ERR.STALE,'انتهت صلاحية مؤشر التصفح بعد تغيير قاعدة البيانات.');
   }
   const range=key===undefined?undefined:IDBKeyRange.only(key);
   const dir=direction==='prev'?'prev':'next';
   const sign=dir==='next'?1:-1;
   // >0 when the cursor row is after the saved position in the iteration direction.
   const position=cur=>{let c=indexedDB.cmp(cur.key,decoded.key);if(c===0&&index)c=indexedDB.cmp(cur.primaryKey,decoded.primaryKey);return c*sign};
   const items=[];
   return new Promise((resolve,reject)=>{
     let positioned=!decoded,jumped=false;
     const c=src.openCursor(range,dir);
     c.onerror=()=>reject(c.error);
     const finish=hasMore=>{
       const visible=items.slice(0,limit);
       const last=visible[visible.length-1];
       resolve({items:visible.map(x=>x.value),nextCursor:hasMore&&last?encodeCursor({sessionToken:this.ctx.token,index,key:last.meta.key,primaryKey:last.meta.primaryKey}):null,prevCursor:null,hasMore,hasPrev:Boolean(decoded)});
     };
     c.onsuccess=()=>{
       const cur=c.result;
       if(!cur){finish(false);return}
       if(!positioned){
         const p=position(cur);
         if(p===0){positioned=true;cur.continue();return}
         if(p<0){
           if(!jumped){jumped=true;try{if(index)cur.continuePrimaryKey(decoded.key,decoded.primaryKey);else cur.continue(decoded.key);return}catch{/* fall back to linear skipping */}}
           cur.continue();return;
         }
         positioned=true;
       }
       const v=cur.value;
       if(!v.isDeleted&&(!filter||filter(v)))items.push({value:v,meta:{key:cur.key,primaryKey:cur.primaryKey}});
       if(items.length>limit){finish(true);return}
       cur.continue();
     };
   });
 }
 async countByIndex(index,key){this.ctx.assert();const tx=this.ctx.db.transaction(this.store,'readonly'),s=tx.objectStore(this.store);if(!s.indexNames.contains(index))return 0;const src=s.index(index);return new Promise((resolve,reject)=>{let count=0;const c=src.openCursor(IDBKeyRange.only(key));c.onerror=()=>reject(c.error);c.onsuccess=()=>{const cur=c.result;if(!cur){resolve(count);return}if(!cur.value.isDeleted)count++;cur.continue()}})}
 async sumByIndex(index,key,field){this.ctx.assert();const tx=this.ctx.db.transaction(this.store,'readonly'),s=tx.objectStore(this.store);if(!s.indexNames.contains(index))return 0;const src=s.index(index);return new Promise((resolve,reject)=>{let sum=0;const c=src.openCursor(IDBKeyRange.only(key));c.onerror=()=>reject(c.error);c.onsuccess=()=>{const cur=c.result;if(!cur){resolve(sum);return}if(!cur.value.isDeleted)sum+=Number(cur.value[field]||0);cur.continue()}})}
 async sumAll(field){this.ctx.assert();const tx=this.ctx.db.transaction(this.store,'readonly'),s=tx.objectStore(this.store);return new Promise((resolve,reject)=>{let sum=0;const c=s.openCursor();c.onerror=()=>reject(c.error);c.onsuccess=()=>{const cur=c.result;if(!cur){resolve(sum);return}if(!cur.value.isDeleted)sum+=Number(cur.value[field]||0);cur.continue()}})}
}
// UTF-8 safe base64 (index keys often contain Arabic text, which plain btoa() rejects).
function encodeCursor(v){const bytes=new TextEncoder().encode(JSON.stringify(v));let bin='';for(const b of bytes)bin+=String.fromCharCode(b);return btoa(bin)}
function decodeCursor(s){const bin=atob(s);const bytes=Uint8Array.from(bin,ch=>ch.charCodeAt(0));return JSON.parse(new TextDecoder().decode(bytes))}
function req(r){return new Promise((res,rej)=>{r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
