// تفضيلات المستخدم (الثيم، الأعمدة، الفلاتر المحفوظة...) في IndexedDB مستقلة عن قواعد بيانات المكتب،
// حتى لا يتغير المظهر عند التبديل بين قواعد البيانات. نسخة مرآة في localStorage للتطبيق الفوري قبل الرسم.
const DB='akl-preferences',STORE='prefs',MIRROR='akl:prefs:';
/** بادئة مرآة localStorage — تُصدَّر حتى تقرأها طبقة تفضيلات العرض المركزية فقط. */
export const MIRROR_PREFIX=MIRROR;
const userId=(()=>{try{let u=localStorage.getItem('akl:userId');if(!u){u='user-'+Math.random().toString(36).slice(2,10);localStorage.setItem('akl:userId',u)}return u}catch{return 'local-user'}})();
const cache=new Map();
let dbp=null;
function open(){
 if(dbp)return dbp;
 dbp=new Promise((res,rej)=>{if(!globalThis.indexedDB)return rej(Error('no idb'));const r=indexedDB.open(DB,1);
  r.onupgradeneeded=()=>{const db=r.result;if(!db.objectStoreNames.contains(STORE)){const s=db.createObjectStore(STORE,{keyPath:'key'});s.createIndex('userId','userId')}};
  r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)}).catch(e=>{dbp=null;throw e});
 return dbp;
}
const k=name=>`${userId}:${name}`;
export const prefs={
 userId,
 get(name,def=null){
  if(cache.has(name))return cache.get(name);
  try{const raw=localStorage.getItem(MIRROR+name);if(raw!==null){const v=JSON.parse(raw);cache.set(name,v);return v}}catch{}
  return def;
 },
 async set(name,value){
  cache.set(name,value);
  try{if(value===null||value===undefined)localStorage.removeItem(MIRROR+name);else localStorage.setItem(MIRROR+name,JSON.stringify(value))}catch{}
  try{const db=await open();await new Promise((res,rej)=>{const tx=db.transaction(STORE,'readwrite');const s=tx.objectStore(STORE);
   if(value===null||value===undefined)s.delete(k(name));else s.put({key:k(name),userId,name,value,updatedAt:new Date().toISOString()});
   tx.oncomplete=res;tx.onerror=()=>rej(tx.error)})}catch{}
 },
 remove(name){return this.set(name,null)},
 /** يحمّل كل تفضيلات المستخدم من IndexedDB (المصدر الأساسي) ويحدّث المرآة */
 async init(){
  try{const db=await open();const rows=await new Promise((res,rej)=>{const r=db.transaction(STORE).objectStore(STORE).index('userId').getAll(userId);r.onsuccess=()=>res(r.result||[]);r.onerror=()=>rej(r.error)});
   const seen=new Set();
   for(const row of rows){seen.add(row.name);cache.set(row.name,row.value);try{localStorage.setItem(MIRROR+row.name,JSON.stringify(row.value))}catch{}}
   // ترحيل ما يوجد في المرآة فقط إلى IndexedDB
   for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key?.startsWith(MIRROR)){const name=key.slice(MIRROR.length);if(!seen.has(name))this.set(name,this.get(name))}}
  }catch{}
 }
};
