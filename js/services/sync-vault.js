// مخزن أسرار محلي للجهاز فقط: رمز الوصول ومفتاح AES غير القابل للاستخراج.
// لا تُكتب الأسرار إلى localStorage أو نسخة المكتب الاحتياطية أو الحزم المتبادلة.
const DB_NAME='akl-sync-vault';
const DB_VERSION=1;
const STORE='credentials';
let dbPromise=null;

function openVault(){
 if(dbPromise)return dbPromise;
 dbPromise=new Promise((resolve,reject)=>{
  if(!globalThis.indexedDB)return reject(new Error('التخزين المحلي الآمن غير متاح في هذا المتصفح.'));
  const request=indexedDB.open(DB_NAME,DB_VERSION);
  request.onupgradeneeded=()=>{
   const db=request.result;
   if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE,{keyPath:'id'});
  };
  request.onsuccess=()=>{
   const db=request.result;
   db.onversionchange=()=>db.close();
   resolve(db);
  };
  request.onerror=()=>reject(request.error||new Error('تعذر فتح مخزن أسرار المزامنة.'));
  request.onblocked=()=>reject(new Error('مخزن المزامنة مشغول في نافذة أخرى؛ أغلق نافذة أقدم ثم أعد المحاولة.'));
 }).catch(error=>{dbPromise=null;throw error});
 return dbPromise;
}
function txRequest(request){return new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result??null);request.onerror=()=>reject(request.error||new Error('فشل الوصول إلى مخزن أسرار المزامنة.'))})}

export async function saveRelayCredential(profileId,{token,key,workspaceId}={}){
 const id=`relay:${String(profileId||'')}`;
 if(id==='relay:')throw new Error('قاعدة البيانات النشطة غير معروفة.');
 if(typeof token!=='string'||token.length<32)throw new Error('رمز وصول الخادم يجب أن يكون طويلًا (32 حرفًا على الأقل).');
 if(!key||key.type!=='secret'||key.algorithm?.name!=='AES-GCM')throw new Error('مفتاح تشفير المزامنة غير صالح.');
 const db=await openVault();
 await new Promise((resolve,reject)=>{
  const tx=db.transaction(STORE,'readwrite');
  tx.objectStore(STORE).put({id,profileId:String(profileId),token,key,workspaceId:String(workspaceId),updatedAt:new Date().toISOString()});
  tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||new Error('تعذر حفظ بيانات اتصال المزامنة.'));tx.onabort=()=>reject(tx.error||new Error('أُلغي حفظ بيانات اتصال المزامنة.'));
 });
}
export async function readRelayCredential(profileId){
 const db=await openVault();
 return txRequest(db.transaction(STORE,'readonly').objectStore(STORE).get(`relay:${String(profileId||'')}`));
}
export async function deleteRelayCredential(profileId){
 const db=await openVault();
 await new Promise((resolve,reject)=>{
  const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).delete(`relay:${String(profileId||'')}`);
  tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||new Error('تعذر حذف بيانات اتصال المزامنة.'));
 });
}
