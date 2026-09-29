import {STORE,STORES,SCHEMA} from '../db/schema.js';

const REQUIRED={
  clients:['id','fullName','createdAt','updatedAt','isDeleted'],
  files:['id','fileNumber','title','status','openedAt','createdAt','updatedAt','isDeleted'],
  cases:['id','fileId','caseNumber','caseYear','status','createdAt','updatedAt','isDeleted'],
  fileClients:['id','fileId','clientId'],caseClients:['id','caseId','clientId'],
  caseOpponents:['id','caseId','opponentId'],caseRelations:['id','sourceCaseId','targetCaseId'],
  hearings:['id','caseId','hearingDate'],procedures:['id','fileId','status'],
  appointments:['id','date'],communications:['id','fileId'],caseNotes:['id','fileId','content'],
  witnesses:['id','caseId','name'],expertReports:['id','caseId','reportDate'],judgments:['id','caseId','judgmentDate'],
  execution:['id','caseId','status'],fees:['id','fileId','agreedAmount'],feePayments:['id','feeId','amount','date'],
  documentReferences:['id','fileId','title'],powersOfAttorney:['id','clientId'],activityLog:['id','entityType','entityId','action','timestamp'],
  fileParties:['id','fileId','partyKind','role'],fileRelations:['id','sourceFileId','targetFileId'],
  serviceRecords:['id','fileId','actionType','status'],bailiffs:['id','name']
};
const OPEN=(db,name,mode='readonly')=>db.transaction(name,mode).objectStore(name);
const scan=(db,name,visit,{maxRows=Infinity}={})=>new Promise((resolve,reject)=>{const s=OPEN(db,name);const c=s.openCursor();let n=0;c.onerror=()=>reject(c.error);c.onsuccess=()=>{const cur=c.result;if(!cur||n>=maxRows){resolve(n);return}n++;try{visit(cur.value);cur.continue()}catch(e){reject(e)}}});
const has=(obj,k)=>obj[k]!==undefined&&obj[k]!==null&&String(obj[k]).trim()!=='';

export async function deepHealth(ctx,{scanRows=true,maxIssues=500}={}){
  ctx.assert();
  const out={ok:true,checkedAt:new Date().toISOString(),database:ctx.profile.databaseName,schema:ctx.db.version,issues:[],counts:{},schemaIssues:[],dataIssues:[],relationIssues:[],softDeleteIssues:[],summary:{}};
  for(const name of STORES){
    if(!ctx.db.objectStoreNames.contains(name)){out.schemaIssues.push({type:'missing-store',store:name});continue}
    const expected=SCHEMA[name]?.indexes||{};const tx=ctx.db.transaction(name,'readonly');const s=tx.objectStore(name);
    for(const index of Object.keys(expected))if(!s.indexNames.contains(index))out.schemaIssues.push({type:'missing-index',store:name,index});
    try{out.counts[name]=await new Promise((r,j)=>{const q=s.count();q.onsuccess=()=>r(q.result);q.onerror=()=>j(q.error)})}catch(e){out.schemaIssues.push({type:'store-read',store:name,message:e.message})}
  }
  if(scanRows){
    const sets={};
    for(const n of ['clients','files','cases','opponents','fees','staff','fileParties','fileRelations','hearings','serviceRecords','bailiffs']){sets[n]=new Set();if(!out.schemaIssues.some(x=>x.store===n&&x.type==='missing-store'))await scan(ctx.db,n,row=>{if(row?.id)sets[n].add(row.id)})}
    const relationRules=[
      ['fileClients','fileId','files','clientId','clients'],['caseClients','caseId','cases','clientId','clients'],['caseOpponents','caseId','cases','opponentId','opponents'],
      ['caseRelations','sourceCaseId','cases','targetCaseId','cases'],['powersOfAttorney','clientId','clients','fileId','files'],
      ['fileParties','fileId','files','clientId','clients'],['fileParties','opponentId','opponents'],
      ['fileRelations','sourceFileId','files','targetFileId','files'],
      ['hearings','caseId','cases','fileId','files'],['hearings','previousHearingId','hearings'],
      ['procedures','fileId','files','caseId','cases'],['appointments','clientId','clients','fileId','files'],['communications','clientId','clients','fileId','files'],
      ['caseNotes','fileId','files','caseId','cases'],['witnesses','caseId','cases'],['expertReports','caseId','cases'],['judgments','caseId','cases'],['execution','caseId','cases'],
      ['serviceRecords','fileId','files','caseId','cases'],['serviceRecords','hearingId','hearings','partyId','fileParties'],
      ['serviceRecords','previousServiceId','serviceRecords','bailiffId','bailiffs'],
      ['fees','fileId','files'],['feePayments','feeId','fees'],['documentReferences','fileId','files']
    ];
    for(const rule of relationRules){
      if(out.relationIssues.length>=maxIssues)break;
      const [store,a,as,b,bs]=rule;if(!ctx.db.objectStoreNames.contains(store))continue;
      await scan(ctx.db,store,row=>{
        if(out.relationIssues.length>=maxIssues)return;
        if(a&&row[a]&&!sets[as]?.has(row[a]))out.relationIssues.push({store,id:row.id,field:a,value:row[a],expected:as});
        if(b&&row[b]&&!sets[bs]?.has(row[b])&&out.relationIssues.length<maxIssues)out.relationIssues.push({store,id:row.id,field:b,value:row[b],expected:bs});
      });
    }
    for(const [name,fields] of Object.entries(REQUIRED)){
      if(!ctx.db.objectStoreNames.contains(name))continue;
      await scan(ctx.db,name,row=>{if(out.dataIssues.length>=maxIssues)return;const missing=fields.filter(k=>!has(row,k));if(missing.length)out.dataIssues.push({type:'missing-required',store:name,id:row.id,fields:missing})});
    }
    for(const name of ['clients','files','cases','opponents']){
      if(!ctx.db.objectStoreNames.contains(name))continue;
      await scan(ctx.db,name,row=>{if(out.softDeleteIssues.length>=maxIssues)return;if(row.isDeleted&&(!row.deletedAt||!row.deletedBy))out.softDeleteIssues.push({type:'deleted-without-audit',store:name,id:row.id});if(row.isDeleted===false&&row.deletedAt)out.softDeleteIssues.push({type:'active-with-delete-date',store:name,id:row.id})});
    }
  }
  out.summary={stores:Object.keys(out.counts).length,schemaIssues:out.schemaIssues.length,dataIssues:out.dataIssues.length,relationIssues:out.relationIssues.length,softDeleteIssues:out.softDeleteIssues.length};
  out.ok=Object.values(out.summary).slice(1).every(v=>v===0);
  out.issues=[...out.schemaIssues,...out.dataIssues,...out.relationIssues,...out.softDeleteIssues].slice(0,maxIssues);
  return out;
}

export async function auditPage(ctx,{entityType='',limit=200}={}){
  ctx.assert();const s=OPEN(ctx.db,STORE.activityLog);const idx=s.index('timestamp');
  return new Promise((resolve,reject)=>{const rows=[];const c=idx.openCursor(null,'prev');c.onerror=()=>reject(c.error);c.onsuccess=()=>{const cur=c.result;if(!cur||rows.length>=Math.min(limit,500)){resolve(rows);return}const v=cur.value;if(!entityType||v.entityType===entityType)rows.push(v);cur.continue()}});
}
