import {STORE,STORES} from '../db/schema.js';
import {exportDatabase,downloadJSON} from './backup.js';
import {normalizeArabic} from '../core/search-normalizer.js';

const READONLY_REPAIRS=new Set(['soft-delete-audit','normalize-search-fields']);
const RELATION_RULES=[
 ['fileClients','fileId','files','clientId','clients'],['caseClients','caseId','cases','clientId','clients'],
 ['caseOpponents','caseId','cases','opponentId','opponents'],['caseRelations','sourceCaseId','cases','targetCaseId','cases'],
 ['powersOfAttorney','clientId','clients','fileId','files'],['hearings','caseId','cases'],['procedures','fileId','files','caseId','cases'],
 ['appointments','clientId','clients','fileId','files'],['communications','clientId','clients','fileId','files'],['caseNotes','fileId','files'],
 ['witnesses','caseId','cases'],['expertReports','caseId','cases'],['judgments','caseId','cases'],['execution','caseId','cases'],
 ['fees','fileId','files'],['feePayments','feeId','fees'],['documentReferences','fileId','files']
];
const REQUIRED_NORM={clients:['fullName','fullNameNormalized'],files:['title','titleNormalized'],opponents:['name','nameNormalized']};
const scan=(db,name,visit)=>new Promise((resolve,reject)=>{const tx=db.transaction(name,'readonly');const c=tx.objectStore(name).openCursor();c.onerror=()=>reject(c.error);c.onsuccess=()=>{const cur=c.result;if(!cur){resolve();return}try{visit(cur.value);cur.continue()}catch(e){reject(e)}}});

export async function buildRepairPlan(ctx,{max=300}={}){
 ctx.assert(); const plan={createdAt:new Date().toISOString(),items:[],counts:{safe:0,destructive:0}};
 const ids={}; for(const s of ['clients','files','cases','opponents','fees']){ids[s]=new Set();await scan(ctx.db,s,row=>{if(row?.id)ids[s].add(row.id)})}
 for(const [store,fields] of Object.entries(REQUIRED_NORM)) await scan(ctx.db,store,row=>{
   if(plan.items.length>=max)return;const source=fields[0],target=fields[1];if(row[source]&&(!row[target]||row[target]!==normalizeArabic(row[source])))plan.items.push({kind:'normalize-search-fields',safe:true,store,id:row.id,field:target,from:row[target]||null,to:normalizeArabic(row[source]),description:`تحديث الحقل المفهرس ${target}`});
 });
 for(const store of ['clients','files','cases','opponents']) await scan(ctx.db,store,row=>{
   if(plan.items.length>=max)return;if(row.isDeleted===true&&(!row.deletedAt||!row.deletedBy))plan.items.push({kind:'soft-delete-audit',safe:true,store,id:row.id,description:'استكمال بيانات تدقيق الحذف المنطقي',changes:{deletedAt:row.deletedAt||row.updatedAt||new Date().toISOString(),deletedBy:row.deletedBy||'system-repair'}});
 });
 for(const [store,a,as,b,bs] of RELATION_RULES){if(plan.items.length>=max)break;await scan(ctx.db,store,row=>{if(plan.items.length>=max)return;if(a&&row[a]&&!ids[as]?.has(row[a]))plan.items.push({kind:'orphan-relation',safe:false,store,id:row.id,field:a,value:row[a],description:`علاقة يتيمة: ${a}`});if(b&&row[b]&&!ids[bs]?.has(row[b])&&plan.items.length<max)plan.items.push({kind:'orphan-relation',safe:false,store,id:row.id,field:b,value:row[b],description:`علاقة يتيمة: ${b}`})})}
 plan.counts.safe=plan.items.filter(x=>x.safe).length;plan.counts.destructive=plan.items.filter(x=>!x.safe).length;return plan;
}

export async function backupBeforeRepair(ctx,filename){const data=await exportDatabase(ctx);downloadJSON(data,filename||`law-office-before-repair-${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.json`);return data}

export async function applyRepair(ctx,plan,{includeDestructive=false}={}){
 ctx.assert(); if(!plan?.items?.length) return {updated:0,deleted:0};
 const items=plan.items.filter(x=>x.safe||includeDestructive); const grouped=new Map(); for(const item of items){if(!grouped.has(item.store))grouped.set(item.store,[]);grouped.get(item.store).push(item)}
 const tx=ctx.db.transaction([...grouped.keys()],'readwrite');let updated=0,deleted=0;
 try{for(const [store,rows] of grouped){const s=tx.objectStore(store);for(const item of rows){if(item.kind==='orphan-relation'){s.delete(item.id);deleted++;continue}const req=s.get(item.id);req.onsuccess=()=>{const row=req.result;if(!row)return;if(item.kind==='normalize-search-fields')row[item.field]=item.to;if(item.kind==='soft-delete-audit')Object.assign(row,item.changes);s.put(row);updated++};}}
 }catch(e){try{tx.abort()}catch{}throw e}
 await new Promise((res,rej)=>{tx.oncomplete=res;tx.onerror=()=>rej(tx.error||new Error('فشل الإصلاح'));tx.onabort=()=>rej(tx.error||new Error('تم إلغاء الإصلاح'))});
 return {updated,deleted};
}
