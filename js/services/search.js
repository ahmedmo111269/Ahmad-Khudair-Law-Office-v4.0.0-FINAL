import {normalizeArabic,normalizeDigits} from '../core/search-normalizer.js';
import {scan,rowText} from './entity-query.js';

async function prefix(repo,index,prefix,limit=15){if(!prefix)return [];return repo.prefix(index,prefix,limit)}
async function exact(repo,index,key,limit=15){if(key===undefined||key===null||key==='')return [];return repo.byIndex(index,key,limit)}

export async function unifiedSearch(office,raw,limit=15){
 const q=String(raw||'').trim();
 if(q.length<2)return {clients:[],files:[],cases:[],opponents:[]};
 const n=normalizeArabic(q), d=normalizeDigits(q);
 const [clientsByName,clientsById,filesByTitle,filesByNumber,casesByNumber,casesBySubject,opponents]=await Promise.all([
  prefix(office.r.clients,'fullNameNormalized',n,limit),
  exact(office.r.clients,'nationalId',d,limit),
  prefix(office.r.files,'titleNormalized',n,limit),
  prefix(office.r.files,'fileNumber',d,limit),
  prefix(office.r.cases,'caseNumber',d,limit),
  prefix(office.r.cases,'subjectNormalized',n,limit),
  prefix(office.r.opponents,'nameNormalized',n,limit)
 ]);
 const merge=(...lists)=>[...new Map(lists.flat().map(x=>[x.id,x])).values()].slice(0,limit);
 // بحث احتوائي محدود (بمؤشر) يكمل البحث بالبادئة: أسماء الأطراف، أرقام المراحل، الهواتف، أي جزء من النص.
 const contains=(store,fn)=>scan(office,store,{limit,filter:fn}).then(r=>r.rows).catch(()=>[]);
 const [fx,cx,kx,ox]=await Promise.all([
  contains('files',f=>(f.searchText||rowText(f)).includes(n)),
  contains('clients',c=>rowText(c).includes(n)),
  contains('cases',c=>rowText(c).includes(n)),
  contains('opponents',o=>rowText(o).includes(n))
 ]);
 return {
  clients:merge(clientsByName,clientsById,cx),
  files:merge(filesByTitle,filesByNumber,fx),
  cases:merge(casesByNumber,casesBySubject,kx),
  opponents:merge(opponents,ox)
 };
}

export async function relationalContext(office,{clientId=null,fileId=null,caseId=null,limit=50}={}){
 const out={files:[],cases:[],hearings:[],procedures:[],appointments:[],judgments:[],execution:[]};
 if(clientId){
  const [fc,cc]=await Promise.all([office.r.fileClients.byIndex('clientId',clientId,limit),office.r.caseClients.byIndex('clientId',clientId,limit)]);
  const [files,cases]=await Promise.all([office.r.files.getMany(fc.map(x=>x.fileId)),office.r.cases.getMany(cc.map(x=>x.caseId))]);
  out.files=files;out.cases=cases;
 }
 if(fileId){
  out.files=await office.r.files.getMany([fileId]);
  const cc=await office.r.fileClients.byIndex('fileId',fileId,limit);
  const fc=await office.r.cases.byIndex('fileId',fileId,limit);
  out.cases=fc;
  const ids=fc.map(x=>x.id);
  if(ids.length){const [h,p,j,e]=await Promise.all([
   Promise.all(ids.map(id=>office.r.hearings.byIndex('caseId',id,limit))),Promise.all(ids.map(id=>office.r.procedures.byIndex('caseId',id,limit))),Promise.all(ids.map(id=>office.r.judgments.byIndex('caseId',id,limit))),Promise.all(ids.map(id=>office.r.execution.byIndex('caseId',id,limit)))
  ]);out.hearings=h.flat().slice(0,limit);out.procedures=p.flat().slice(0,limit);out.judgments=j.flat().slice(0,limit);out.execution=e.flat().slice(0,limit)}
 }
 if(caseId){
  out.cases=await office.r.cases.getMany([caseId]);
  const [h,p,j,e]=await Promise.all([office.r.hearings.byIndex('caseId',caseId,limit),office.r.procedures.byIndex('caseId',caseId,limit),office.r.judgments.byIndex('caseId',caseId,limit),office.r.execution.byIndex('caseId',caseId,limit)]);
  out.hearings=h;out.procedures=p;out.judgments=j;out.execution=e;
 }
 return out;
}

export async function relatedTimeline(office,{fileId=null,caseId=null,limit=100}={}){
 const out=[];
 const add=(rows,type,dateField='createdAt')=>rows.forEach(r=>out.push({type,id:r.id,date:r[dateField]||r.updatedAt||r.createdAt,title:r.summary||r.description||r.reason||r.operativeSummary||r.title||type,raw:r}));
 if(fileId){
  add((await office.r.activityLog.byIndex('entityId',fileId,1000)),'نشاط الملف','timestamp');
  add(await office.r.communications.byIndex('fileId',fileId,limit),'اتصال','date');add(await office.r.appointments.byIndex('fileId',fileId,limit),'موعد','date');add(await office.r.procedures.byIndex('fileId',fileId,limit),'إجراء','actionDate');add(await office.r.documentReferences.byIndex('fileId',fileId,limit),'مرجع مستند','date');
 }
 if(caseId){
  add((await office.r.activityLog.byIndex('entityId',caseId,1000)),'نشاط القضية','timestamp');
  add(await office.r.hearings.byIndex('caseId',caseId,limit),'جلسة','hearingDate');add(await office.r.procedures.byIndex('caseId',caseId,limit),'إجراء','actionDate');add((await office.r.caseNotes.byIndex('caseId',caseId,limit)),'ملاحظة','createdAt');add(await office.r.witnesses.byIndex('caseId',caseId,limit),'شاهد','createdAt');add(await office.r.expertReports.byIndex('caseId',caseId,limit),'تقرير خبير','reportDate');add(await office.r.judgments.byIndex('caseId',caseId,limit),'حكم','judgmentDate');add(await office.r.execution.byIndex('caseId',caseId,limit),'تنفيذ','openedDate');
 }
 return out.filter(x=>x.date).sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,limit);
}
