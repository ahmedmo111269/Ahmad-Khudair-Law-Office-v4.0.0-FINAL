import {STORE} from '../db/schema.js';

const LIMIT=10000;
const DAY=86400000;
const iso=d=>d.toISOString().slice(0,10);
const parseDay=s=>{const d=new Date(`${s}T00:00:00`);return Number.isNaN(d.getTime())?null:d};
const addDays=(s,n)=>{const d=parseDay(s);d.setTime(d.getTime()+n*DAY);return iso(d)};
export function analyticsPeriod(kind,from,to){
 const now=new Date(),t=iso(now);
 if(kind==='today')return [t,t];
 if(kind==='month')return [`${t.slice(0,7)}-01`,`${t.slice(0,7)}-31`];
 if(kind==='year')return [`${t.slice(0,4)}-01-01`,`${t.slice(0,4)}-12-31`];
 if(kind==='custom')return [from||t,to||t];
 return [addDays(t,-29),t];
}
const configs={
 clients:{store:STORE.clients,date:'createdAt',index:'createdAt',label:'الموكلون',group:'status'},
 files:{store:STORE.files,date:'openedAt',index:'openedAt',label:'الملفات',group:'status'},
 cases:{store:STORE.cases,date:'filingDate',index:'filingDate',label:'القضايا',group:'status'},
 hearings:{store:STORE.hearings,date:'hearingDate',index:'hearingDate',label:'الجلسات',group:'type'},
 procedures:{store:STORE.procedures,date:'actionDate',index:'actionDate',label:'الإجراءات والمهام',group:'status'}
};
function between(v,lo,hi){return v&&v>=lo&&v<=hi}
export async function analyticsSnapshot(office,{dataset='cases',from,to,status='',groupBy=''}={}){
 const cfg=configs[dataset]||configs.cases;
 const lo=from||'0000-01-01',hi=to||'9999-12-31';
 const repo=office.r[cfg.store];
 const tx=office.ctx.db.transaction(cfg.store,'readonly'),s=tx.objectStore(cfg.store);
 const src=s.indexNames.contains(cfg.index)?s.index(cfg.index):s;
 const range=s.indexNames.contains(cfg.index)?IDBKeyRange.bound(lo,hi):undefined;
 const result={dataset,label:cfg.label,from:lo,to:hi,total:0,groups:{},trend:{},filters:{status},limit:LIMIT,truncated:false};
 return new Promise((resolve,reject)=>{
   const c=src.openCursor(range);c.onerror=()=>reject(c.error);c.onsuccess=()=>{
     const cur=c.result;
     if(!cur){resolve(result);return}
     const v=cur.value;
     if(!v.isDeleted && between(String(v[cfg.date]||''),lo,hi) && (!status||String(v.status||'')===status)){
       result.total++;
       const g=String(v[groupBy||cfg.group]||'غير محدد')||'غير محدد';result.groups[g]=(result.groups[g]||0)+1;
       const day=String(v[cfg.date]||'').slice(0,10);if(day)result.trend[day]=(result.trend[day]||0)+1;
       if(result.total>=LIMIT){result.truncated=true;resolve(result);return}
     }
     cur.continue();
   };
 });
}
export async function analyticsOverview(office){
 const rows=[];
 for(const [key,cfg] of Object.entries(configs)){
   const n=await office.r[cfg.store].count();
   rows.push({dataset:key,label:cfg.label,total:n});
 }
 return rows;
}
export const analyticsConfigs=configs;
