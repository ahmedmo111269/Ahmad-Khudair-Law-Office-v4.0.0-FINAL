import {bumpWriteEpoch} from './write-epoch.js';
import {notifyWritesAcrossTabs} from './write-broadcast.js';

// معاملة ذرية واحدة فوق عدة مخازن: إما أن تُعتمد كلها أو يتراجع عنها كلها.
// عند الاعتماد تُرفع عدّادات الكتابة للمخازن الملموسة، فتُبطل كاشات القراءة
// الكسولة في القراءة التالية (لا إعادة بناء داخل معاملة الكتابة نفسها).
// hardDelete مخصص للإزالة النهائية المؤكدة: يُحذف الصف محليًا مع تسجيل Tombstone
// سببي للمزامنة؛ بقية عمليات delete تبقى Tombstones قابلة للاستعادة.
export function transaction(ctx,stores,fn,{captureChanges=true,hardDelete=false}={}){ctx.assert();return new Promise((resolve,reject)=>{const names=[...new Set(stores)];const tx=ctx.rawDb&&ctx.rawDb!==ctx.db?ctx.db.transaction(names,'readwrite',{captureChanges,hardDelete}):ctx.db.transaction(names,'readwrite');let out;tx.oncomplete=()=>{bumpWriteEpoch(ctx,names);notifyWritesAcrossTabs(ctx);resolve(out)};tx.onerror=()=>reject(tx.error||Error('فشلت العملية وتم التراجع عنها'));tx.onabort=()=>reject(tx.error||Error('تم التراجع عن العملية'));Promise.resolve().then(()=>fn(tx)).then(v=>out=v).catch(e=>{try{tx.abort()}catch{}reject(e)})})}
export function request(r){return new Promise((res,rej)=>{r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
