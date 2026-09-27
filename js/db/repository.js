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
  const tx=this.ctx.db.transaction(this.store,'readonly'),s=tx.objectStore(this.store); if(!s.indexNames.contains(index))return [];
  const src=s.index(index); let range; if(lower!==undefined&&upper!==undefined)range=IDBKeyRange.bound(lower,upper); else if(lower!==undefined)range=IDBKeyRange.lowerBound(lower); else if(upper!==undefined)range=IDBKeyRange.upperBound(upper);
  return new Promise((resolve,reject)=>{const out=[],c=src.openCursor(range,direction==='prev'?'prev':'next');c.onerror=()=>reject(c.error);c.onsuccess=()=>{const cur=c.result;if(!cur||out.length>=limit){resolve(out);return}if(!cur.value.isDeleted&&(!filter||filter(cur.value)))out.push(cur.value);cur.continue()}});
 }
 async count(){this.ctx.assert();return req(this.ctx.db.transaction(this.store,'readonly').objectStore(this.store).count())}
 async prefix(index,prefix,limit=10){this.ctx.assert();if(!prefix||limit<1||limit>MAX_PAGE_SIZE)return[];const tx=this.ctx.db.transaction(this.store,'readonly'),s=tx.objectStore(this.store);if(!s.indexNames.contains(index))return[];const src=s.index(index),range=IDBKeyRange.bound(prefix,prefix+'\uffff');return new Promise((resolve,reject)=>{const out=[];const c=src.openCursor(range);c.onerror=()=>reject(c.error);c.onsuccess=()=>{const cur=c.result;if(!cur||out.length>=limit){resolve(out);return}if(!cur.value.isDeleted)out.push(cur.value);cur.continue()}})}
 async page({index=null,key=undefined,cursor=null,limit=25,direction='next',filter=null}={}){
   if(limit<1||limit>MAX_PAGE_SIZE)throw new AppError(ERR.VALIDATION,'حجم الصفحة غير مسموح.');
   this.ctx.assert();
   const tx=this.ctx.db.transaction(this.store,'readonly'),s=tx.objectStore(this.store);
   if(index&&!s.indexNames.contains(index))return {items:[],nextCursor:null,hasMore:false};
   const src=index?s.index(index):s;
   let decoded=null;
   if(cursor){try{decoded=typeof cursor==='string'?JSON.parse(atob(cursor)):cursor}catch{throw new AppError(ERR.VALIDATION,'مؤشر التصفح غير صالح.')}if(decoded?.sessionToken!==this.ctx.token)throw new AppError(ERR.STALE,'انتهت صلاحية مؤشر التصفح بعد تغيير قاعدة البيانات.');}
   const range=key===undefined?undefined:IDBKeyRange.only(key);
   const dir=direction==='prev'?'prev':'next';
   const items=[];
   return new Promise((resolve,reject)=>{
     let started=!decoded;
     const c=src.openCursor(range,dir);
     c.onerror=()=>reject(c.error);
     c.onsuccess=()=>{
       const cur=c.result;
       if(!cur){
         const visible=items.slice(0,limit);
         const natural=dir==='prev'?[...visible].reverse():visible;
         const first=natural[0],last=natural[natural.length-1];
         resolve({items:natural.map(x=>x.value),nextCursor:last?encodeCursor({sessionToken:this.ctx.token,index,key:last.meta.key,primaryKey:last.meta.primaryKey,direction:'next'}):null,prevCursor:first?encodeCursor({sessionToken:this.ctx.token,index,key:first.meta.key,primaryKey:first.meta.primaryKey,direction:'prev'}):null,hasMore:items.length>limit,hasPrev:Boolean(first)});
         return;
       }
       if(!started){
         const same=JSON.stringify(cur.key)===JSON.stringify(decoded.key)&&JSON.stringify(cur.primaryKey)===JSON.stringify(decoded.primaryKey);
         if(same)started=true;
         cur.continue();return;
       }
       const v=cur.value;
       if(!v.isDeleted&&(!filter||filter(v)))items.push({value:v,meta:{key:cur.key,primaryKey:cur.primaryKey}});
       if(items.length>=limit+1){
         const visible=items.slice(0,limit);
         const last=visible[visible.length-1];
         resolve({items:visible.map(x=>x.value),nextCursor:encodeCursor({sessionToken:this.ctx.token,index,key:last.meta.key,primaryKey:last.meta.primaryKey,direction:dir}),hasMore:true});
         return;
       }
       cur.continue();
     };
   });
 }
 async countByIndex(index,key){this.ctx.assert();const tx=this.ctx.db.transaction(this.store,'readonly'),s=tx.objectStore(this.store);if(!s.indexNames.contains(index))return 0;const src=s.index(index);return new Promise((resolve,reject)=>{let count=0;const c=src.openCursor(IDBKeyRange.only(key));c.onerror=()=>reject(c.error);c.onsuccess=()=>{const cur=c.result;if(!cur){resolve(count);return}if(!cur.value.isDeleted)count++;cur.continue()}})}
 async sumByIndex(index,key,field){this.ctx.assert();const tx=this.ctx.db.transaction(this.store,'readonly'),s=tx.objectStore(this.store);if(!s.indexNames.contains(index))return 0;const src=s.index(index);return new Promise((resolve,reject)=>{let sum=0;const c=src.openCursor(IDBKeyRange.only(key));c.onerror=()=>reject(c.error);c.onsuccess=()=>{const cur=c.result;if(!cur){resolve(sum);return}if(!cur.value.isDeleted)sum+=Number(cur.value[field]||0);cur.continue()}})}
 async sumAll(field){this.ctx.assert();const tx=this.ctx.db.transaction(this.store,'readonly'),s=tx.objectStore(this.store);return new Promise((resolve,reject)=>{let sum=0;const c=s.openCursor();c.onerror=()=>reject(c.error);c.onsuccess=()=>{const cur=c.result;if(!cur){resolve(sum);return}if(!cur.value.isDeleted)sum+=Number(cur.value[field]||0);cur.continue()}})}
}
function encodeCursor(v){return btoa(JSON.stringify(v))}
function req(r){return new Promise((res,rej)=>{r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
