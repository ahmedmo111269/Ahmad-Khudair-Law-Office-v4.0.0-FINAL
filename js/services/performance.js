import {STORE} from '../db/schema.js';

export async function databaseStats(office){
 const stores=Object.values(STORE);const out={};
 for(const name of stores) out[name]=await office.r[name].count();
 return out;
}

export async function benchmarkQueries(office,{query='محمد',runs=5}={}){
 const samples=[];
 for(let i=0;i<runs;i++){
  const t=performance.now();
  await office.search(query);
  samples.push(Math.round((performance.now()-t)*100)/100);
 }
 const avg=samples.reduce((a,b)=>a+b,0)/samples.length;
 return {query,runs,samples,averageMs:Math.round(avg*100)/100};
}
