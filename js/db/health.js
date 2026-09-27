import {STORES,STORE} from './schema.js';

function scan(db,storeName,visit,{maxRows=Infinity}={}){return new Promise((resolve,reject)=>{const tx=db.transaction(storeName,'readonly');const c=tx.objectStore(storeName).openCursor();let n=0;c.onerror=()=>reject(c.error);c.onsuccess=()=>{const cur=c.result;if(!cur||n>=maxRows){resolve(n);return}n++;try{visit(cur.value);cur.continue()}catch(e){reject(e)}}})}
function count(db,storeName){return new Promise((resolve,reject)=>{const tx=db.transaction(storeName,'readonly');const q=tx.objectStore(storeName).count();q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)})}

export async function health(ctx,{includeOrphans=true}={}){
  ctx.assert();
  const out={ok:true,database:ctx.profile.databaseName,schema:ctx.db.version,checkedAt:new Date().toISOString(),stores:{},issues:[],orphanRelations:[]};
  for(const s of STORES){try{out.stores[s]=await count(ctx.db,s)}catch(err){out.ok=false;out.stores[s]='error';out.issues.push({type:'store-read',store:s,message:err.message})}}
  if(includeOrphans){
    const ids={clients:new Set(),files:new Set(),cases:new Set(),opponents:new Set(),fees:new Set()};
    for(const n of Object.keys(ids)) await scan(ctx.db,n,row=>{if(row?.id)ids[n].add(row.id)});
    const checks=[
      [STORE.fileClients,'fileId','files','clientId','clients'],[STORE.caseClients,'caseId','cases','clientId','clients'],
      [STORE.caseOpponents,'caseId','cases','opponentId','opponents'],[STORE.caseRelations,'sourceCaseId','cases','targetCaseId','cases'],
      [STORE.powersOfAttorney,'clientId','clients','fileId','files'],[STORE.hearings,'caseId','cases'],[STORE.procedures,'fileId','files','caseId','cases'],
      [STORE.appointments,'clientId','clients','fileId','files'],[STORE.communications,'clientId','clients','fileId','files'],[STORE.caseNotes,'fileId','files'],
      [STORE.witnesses,'caseId','cases'],[STORE.expertReports,'caseId','cases'],[STORE.judgments,'caseId','cases'],[STORE.execution,'caseId','cases'],
      [STORE.fees,'fileId','files'],[STORE.feePayments,'feeId','fees'],[STORE.documentReferences,'fileId','files']
    ];
    for(const [store,a,aSet,b,bSet] of checks){
      if(out.orphanRelations.length>=200)break;
      await scan(ctx.db,store,row=>{if(out.orphanRelations.length>=200)return;if(a&&row[a]&&!ids[aSet]?.has(row[a]))out.orphanRelations.push({store,id:row.id,field:a,value:row[a]});if(b&&row[b]&&!ids[bSet]?.has(row[b])&&out.orphanRelations.length<200)out.orphanRelations.push({store,id:row.id,field:b,value:row[b]})},{maxRows:Infinity});
    }
  }
  if(out.orphanRelations.length){out.ok=false;out.issues.push({type:'orphans',count:out.orphanRelations.length})}
  const total=Object.values(out.stores).filter(v=>typeof v==='number').reduce((a,b)=>a+b,0);
  out.totalRecords=total;
  return out;
}
