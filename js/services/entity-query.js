// طبقة القراءة للصفحات والجداول والتقارير: قراءة محدودة بالمؤشرات (cursor) وبدون getAll على المخازن الكبيرة.
// البحث الفوري يمسح المخزن بمؤشر ويحتفظ فقط بالنتائج المطابقة حتى الحد المطلوب.
import {ENTITIES,phonesOf,fmtDate} from '../domain/entities.js';
import {normalizeArabic,normalizeDigits} from '../core/search-normalizer.js';
import {localDate,addDays,isActiveProcedure} from '../core/clock.js';

export const DEFAULT_LIMIT=1000;
export const MAX_LIMIT=5000;

const SKIP=/^(id|version|isDeleted|isArchived)$|Id$|Normalized$|^searchText$/;
export function rowText(row){
 const bits=[];
 for(const [k,v] of Object.entries(row||{})){if(SKIP.test(k)||v===null||v===undefined||v==='')continue;if(Array.isArray(v))bits.push(v.join(' '));else if(typeof v!=='object')bits.push(String(v))}
 if(row?.searchText)bits.push(row.searchText);
 return normalizeArabic(bits.join(' '));
}
export const normQ=q=>normalizeArabic(normalizeDigits(String(q||''))).trim();

// مسح محدود بمؤشر: index اختياري، range اختياري، يرجع {rows, more}
export function scan(office,store,{index=null,lower,upper,direction='prev',limit=DEFAULT_LIMIT,filter=null}={}){
 office.ctx.assert();
 limit=Math.min(Math.max(1,limit),MAX_LIMIT);
 const tx=office.ctx.db.transaction(store,'readonly'),s=tx.objectStore(store);
 let src=s,range;
 const useIndex=index&&s.indexNames.contains(index);
 if(useIndex){src=s.index(index);if(lower!==undefined&&upper!==undefined)range=IDBKeyRange.bound(lower,upper);else if(lower!==undefined)range=IDBKeyRange.lowerBound(lower);else if(upper!==undefined)range=IDBKeyRange.upperBound(upper)}
 const inRange=v=>{if(!index||useIndex)return true;const x=v[index];if(x===undefined||x===null||x==='')return false;if(lower!==undefined&&String(x)<String(lower))return false;if(upper!==undefined&&String(x)>String(upper))return false;return true};
 return new Promise((resolve,reject)=>{const rows=[];const c=src.openCursor(range,direction==='prev'?'prev':'next');c.onerror=()=>reject(c.error);c.onsuccess=()=>{const cur=c.result;if(!cur){resolve({rows,more:false});return}const v=cur.value;if(!v.isDeleted&&inRange(v)&&(!filter||filter(v))){if(rows.length>=limit){resolve({rows,more:true});return}rows.push(v)}cur.continue()}});
}

// معرّفات الملفات/القضايا/الموكلين التي تطابق نص البحث، ليظهر في جدول الجلسات مثلًا كل جلسات قضية تم البحث برقمها.
async function relatedIds(office,q,stores){
 const out={files:new Set(),cases:new Set(),clients:new Set()};
 const jobs=[];
 if(stores.includes('files'))jobs.push(scan(office,'files',{limit:300,filter:f=>(f.searchText||rowText(f)).includes(q)}).then(r=>r.rows.forEach(x=>out.files.add(x.id))));
 if(stores.includes('cases'))jobs.push(scan(office,'cases',{limit:300,filter:c=>rowText(c).includes(q)}).then(r=>r.rows.forEach(x=>out.cases.add(x.id))));
 if(stores.includes('clients'))jobs.push(scan(office,'clients',{limit:300,filter:c=>rowText(c).includes(q)}).then(r=>r.rows.forEach(x=>out.clients.add(x.id))));
 await Promise.all(jobs);return out;
}

/**
 * تحميل صفوف كيان لصفحة أو تقرير.
 * from/to: نطاق تاريخ على حقل التاريخ الأساسي للكيان (مفهرس). q: بحث فوري شامل.
 */
export async function loadRows(office,store,{q='',from='',to='',dateField=null,limit=DEFAULT_LIMIT,filter=null}={}){
 const ent=ENTITIES[store]||{};const field=dateField||ent.dateField;
 const nq=normQ(q);
 let rel=null;
 if(nq){const refs=(ent.fields||[]).filter(f=>f.ref).map(f=>f.ref);const need=['files','cases','clients'].filter(s=>refs.includes(s)&&s!==store);if(need.length)rel=await relatedIds(office,nq,need)}
 const match=v=>{
  if(filter&&!filter(v))return false;
  if(!nq)return true;
  if((store==='files'?(v.searchText||'')+' '+rowText(v):rowText(v)).includes(nq))return true;
  if(rel&&((v.fileId&&rel.files.has(v.fileId))||(v.caseId&&rel.cases.has(v.caseId))||(v.clientId&&rel.clients.has(v.clientId))))return true;
  return false;
 };
 if(from||to){
  const lower=from||'0000',upper=(to||'9999')+'\uffff';
  const index=field;
  return scan(office,store,{index,lower,upper,direction:'prev',limit,filter:match});
 }
 return scan(office,store,{direction:'prev',limit,filter:match});
}

// عرض مختصر للسجل المرجعي
export function refLabel(store,r){
 if(!r)return '';
 if(store==='files')return `${r.fileNumber||''} — ${r.title||''}`.trim();
 if(store==='cases')return [r.stageType||r.numberType||'',`${r.caseNumber||'بدون رقم'}${r.caseYear?'/'+r.caseYear:''}`,r.courtId||''].filter(Boolean).join(' — ');
 if(store==='clients')return r.fullName||'';
 if(store==='opponents')return r.name||'';
 if(store==='fees')return `أتعاب ${r.agreedAmount??''} ${r.currency||''}`.trim();
 return r.title||r.name||r.id;
}
// حلّ تسميات المراجع دفعة واحدة (getMany لكل مخزن) — Map من المعرّف إلى النص.
export async function resolveRefs(office,rows,fields=null,into=new Map()){
 const byStore={};
 const flds=fields||[];
 for(const r of rows)for(const f of flds){if(!f.ref)continue;const v=r[f.k];if(v&&!into.has(v))(byStore[f.ref]=byStore[f.ref]||new Set()).add(v)}
 await Promise.all(Object.entries(byStore).map(async([store,ids])=>{const got=await office.r[store].getMany([...ids]);for(const x of got)into.set(x.id,refLabel(store,x))}));
 return into;
}

// ===== الأجندة: كل ما يقع في يوم أو فترة =====
export const AGENDA_SOURCES=[
 {store:'hearings',index:'hearingDate',kind:'جلسة',time:'hearingTime',title:r=>[r.type,r.reason].filter(Boolean).join(' — ')||'جلسة',details:r=>[r.court,r.chamber,r.result].filter(Boolean).join(' — ')},
 {store:'procedures',index:'internalDueDate',kind:'عمل إداري',title:r=>r.description||r.type||'عمل إداري',details:r=>[r.type,r.assignedTo].filter(Boolean).join(' — '),filter:isActiveProcedure},
 {store:'appointments',index:'date',kind:'موعد',time:'time',title:r=>r.title||'موعد',details:r=>[r.location,r.withWhom].filter(Boolean).join(' — ')},
 {store:'communications',index:'followUpDate',kind:'متابعة اتصال',title:r=>r.subject||'متابعة اتصال',details:r=>[r.contactName,r.channel].filter(Boolean).join(' — ')},
 {store:'judgments',index:'judgmentDate',kind:'حكم',title:r=>r.operativeSummary||r.judgmentType||'حكم',details:r=>[r.court,r.judgmentStatus].filter(Boolean).join(' — ')},
 {store:'files',index:'nextStepDate',kind:'خطوة ملف',title:r=>r.nextStep||'الخطوة التالية',details:r=>`${r.fileNumber||''} ${r.title||''}`},
 {store:'expertReports',index:'reportDate',kind:'خبير',title:r=>r.expertName||'تقرير خبير',details:r=>r.expertOffice||''}
];
export async function agenda(office,from,to,limit=2000){
 const parts=await Promise.all(AGENDA_SOURCES.map(async src=>{
  const {rows}=await scan(office,src.store,{index:src.index,lower:from,upper:to+'\uffff',direction:'next',limit,filter:src.filter||null});
  return rows.map(r=>({id:r.id,store:src.store,kind:src.kind,date:String(r[src.index]||'').slice(0,10),time:src.time?r[src.time]||'':'',title:src.title(r),details:src.details(r),status:r.status||r.judgmentStatus||'',fileId:src.store==='files'?r.id:r.fileId||'',caseId:r.caseId||'',clientId:r.clientId||''}));
 }));
 return parts.flat().sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
}
export async function agendaMarks(office,year,month){
 const first=localDate(new Date(year,month-1,1)),last=localDate(new Date(year,month,0));
 const rows=await agenda(office,first,last,3000);const m=new Map();for(const r of rows)m.set(r.date,(m.get(r.date)||0)+1);return m;
}

// الفترات الزمنية الجاهزة (الأسبوع يبدأ الاثنين كما في لوحة الرئيسية وتقاريرها)
export function presetRange(preset,from,to){
 const t=localDate(),d=new Date(t+'T00:00:00'),dow=d.getDay(),monday=addDays(t,dow===0?-6:1-dow);
 switch(preset){
  case'today':return [t,t];
  case'tomorrow':return [addDays(t,1),addDays(t,1)];
  case'yesterday':return [addDays(t,-1),addDays(t,-1)];
  case'week':return [monday,addDays(monday,6)];
  case'nextWeek':return [addDays(monday,7),addDays(monday,13)];
  case'month':return [t.slice(0,8)+'01',localDate(new Date(d.getFullYear(),d.getMonth()+1,0))];
  case'nextMonth':return [localDate(new Date(d.getFullYear(),d.getMonth()+1,1)),localDate(new Date(d.getFullYear(),d.getMonth()+2,0))];
  case'year':return [`${d.getFullYear()}-01-01`,`${d.getFullYear()}-12-31`];
  case'upcoming':return [t,addDays(t,365*5)];
  case'past':return ['0000-01-01',addDays(t,-1)];
  case'custom':{const a=from||'',b=to||'';if(!a&&!b)return ['',''];if(a&&b&&a>b)return [b,a];return [a,b]}
  default:return ['',''];
 }
}
export const PRESETS=[['all','الكل'],['today','اليوم'],['tomorrow','غدًا'],['week','هذا الأسبوع'],['nextWeek','الأسبوع القادم'],['month','هذا الشهر'],['nextMonth','الشهر القادم'],['year','هذه السنة'],['upcoming','القادم'],['past','السابق'],['custom','فترة مخصصة']];

// ===== علاقات السجلات (لصفحات السجل) =====
// Keep detail-page fan-out bounded even when one person is linked to thousands of files/cases.
// Lists remain navigable; the page reports when the displayed relation set is capped.
const RELATED_FILES_LIMIT=200,RELATED_CASES_LIMIT=1000,RELATED_HEARINGS_LIMIT=1000;
async function relatedChildren(office,store,index,parents,{perParent=20,maxRows=1000,maxParents=RELATED_FILES_LIMIT,batchSize=25}={}){
 const source=parents.slice(0,maxParents),rows=[],seen=new Set();let more=parents.length>source.length;
 for(let i=0;i<source.length&&rows.length<maxRows;i+=batchSize){
  const batch=source.slice(i,i+batchSize),parts=await Promise.all(batch.map(p=>office.r[store].byIndex(index,p.id,perParent)));
  for(const part of parts){
   if(part.length>=perParent)more=true;
   for(const row of part){if(seen.has(row.id))continue;if(rows.length>=maxRows){more=true;break}seen.add(row.id);rows.push(row)}
   if(rows.length>=maxRows)break;
  }
 }
 if(rows.length>=maxRows)more=true;
 return {rows,more};
}
export async function clientRelated(office,clientId){
 const [parties,links,poas,appointments,communications]=await Promise.all([
  office.r.fileParties.byIndex('clientId',clientId,1000),office.r.fileClients.byIndex('clientId',clientId,1000),
  office.r.powersOfAttorney.byIndex('clientId',clientId,500),office.r.appointments.byIndex('clientId',clientId,500),office.r.communications.byIndex('clientId',clientId,500)]);
 const allFileIds=[...new Set([...parties.map(p=>p.fileId),...links.map(l=>l.fileId)])];
 const fileIds=allFileIds.slice(0,RELATED_FILES_LIMIT),files=await office.r.files.getMany(fileIds);
 const roleByFile=new Map();for(const p of parties)roleByFile.set(p.fileId,[roleByFile.get(p.fileId),p.role].filter(Boolean).join('، '));
 for(const f of files)f.clientRole=roleByFile.get(f.id)||'موكل';
 const casesResult=await relatedChildren(office,'cases','fileId',files,{perParent:20,maxRows:RELATED_CASES_LIMIT});
 const hearingsResult=await relatedChildren(office,'hearings','caseId',casesResult.rows,{perParent:10,maxRows:RELATED_HEARINGS_LIMIT,maxParents:RELATED_CASES_LIMIT});
 return {files,cases:casesResult.rows,hearings:hearingsResult.rows,poas,appointments,communications,
  more:{files:allFileIds.length>files.length||parties.length>=1000||links.length>=1000,cases:casesResult.more,hearings:hearingsResult.more||casesResult.more,
   powersOfAttorney:poas.length>=500,appointments:appointments.length>=500,communications:communications.length>=500}};
}
export async function opponentRelated(office,opponentId){
 const [parties,links]=await Promise.all([office.r.fileParties.byIndex('opponentId',opponentId,1000),office.r.caseOpponents.byIndex('opponentId',opponentId,1000)]);
 const legacyCases=await office.r.cases.getMany(links.map(l=>l.caseId));
 const allFileIds=[...new Set([...parties.map(p=>p.fileId),...legacyCases.map(c=>c.fileId)])],fileIds=allFileIds.slice(0,RELATED_FILES_LIMIT);
 const files=await office.r.files.getMany(fileIds);
 const roleByFile=new Map();for(const p of parties)roleByFile.set(p.fileId,p.role||'خصم');for(const f of files)f.opponentRole=roleByFile.get(f.id)||'خصم';
 const casesResult=await relatedChildren(office,'cases','fileId',files,{perParent:20,maxRows:RELATED_CASES_LIMIT});
 const allCases=[...new Map([...legacyCases,...casesResult.rows].map(c=>[c.id,c])).values()],cases=allCases.slice(0,RELATED_CASES_LIMIT);
 const hearingsResult=await relatedChildren(office,'hearings','caseId',cases,{perParent:10,maxRows:RELATED_HEARINGS_LIMIT,maxParents:RELATED_CASES_LIMIT});
 return {files,cases,hearings:hearingsResult.rows,more:{files:allFileIds.length>files.length||parties.length>=1000||links.length>=1000,
  cases:casesResult.more||legacyCases.length>=1000||allCases.length>cases.length,hearings:hearingsResult.more||casesResult.more||allCases.length>cases.length}};
}
export async function fileStages(office,fileId){
 const cases=await office.r.cases.byIndex('fileId',fileId,500);
 return cases.sort((a,b)=>(Number(a.stageOrder)||999)-(Number(b.stageOrder)||999)||String(a.filingDate||a.createdAt||'').localeCompare(String(b.filingDate||b.createdAt||'')));
}
export async function fileChildren(office,fileId,store){
 const stages=await office.r.cases.byIndex('fileId',fileId,500);
 if(['hearings','judgments','witnesses','expertReports','execution'].includes(store)){
  const result=await relatedChildren(office,store,'caseId',stages,{perParent:50,maxRows:5000,maxParents:500});
  result.more=result.more||stages.length>=500;
  return result;
 }
 const rows=await office.r[store].byIndex('fileId',fileId,5000);
 return {rows,more:rows.length>=5000};
}
export {fmtDate,phonesOf};
