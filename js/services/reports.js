import {STORE} from '../db/schema.js';
import {localDate,addDays,ACTIVE_PROCEDURE_STATUSES} from '../core/clock.js';

const dayAdd=addDays;
const today=()=>localDate();

export function periodRange(preset,from,to){
 const t=today(),d=new Date(t+'T00:00:00'),dow=d.getDay(),monday=dayAdd(t,dow===0?-6:1-dow);
 switch(preset){
  case'tomorrow':return [dayAdd(t,1),dayAdd(t,1)];
  case'week':return [monday,dayAdd(monday,6)];
  case'nextWeek':return [dayAdd(monday,7),dayAdd(monday,13)];
  case'month':return [t.slice(0,8)+'01',localDate(new Date(d.getFullYear(),d.getMonth()+1,0))];
  case'nextMonth':return [localDate(new Date(d.getFullYear(),d.getMonth()+1,1)),localDate(new Date(d.getFullYear(),d.getMonth()+2,0))];
  case'custom':{const a=from||t,b=to||from||t;return a<=b?[a,b]:[b,a];}
  default:return [t,t];
 }
}

export const REPORT_SPECS={
 hearings:{title:'تقرير الجلسات',store:STORE.hearings,index:'hearingDate',dateField:'hearingDate'},
 procedures:{title:'تقرير الأعمال الإدارية',store:STORE.procedures,index:'internalDueDate',dateField:'internalDueDate'},
 appointments:{title:'تقرير المواعيد',store:STORE.appointments,index:'date',dateField:'date'},
 communications:{title:'تقرير الاتصالات',store:STORE.communications,index:'date',dateField:'date'},
 judgments:{title:'تقرير الأحكام',store:STORE.judgments,index:'judgmentDate',dateField:'judgmentDate'},
 expertReports:{title:'تقرير الخبراء',store:STORE.expertReports,index:'reportDate',dateField:'reportDate'},
 execution:{title:'تقرير التنفيذ',store:STORE.execution,index:'openedDate',dateField:'openedDate'},
 fees:{title:'تقرير الأتعاب',store:STORE.fees,index:'createdAt',dateField:'createdAt'},
 files:{title:'تقرير الملفات',store:STORE.files,index:'lastActivityAt',dateField:'lastActivityAt'},
 cases:{title:'تقرير القضايا',store:STORE.cases,index:'filingDate',dateField:'filingDate'},
 clients:{title:'تقرير الموكلين',store:STORE.clients,index:'createdAt',dateField:'createdAt'},
 clientFiles:{title:'ملفات موكل',store:STORE.files,index:'lastActivityAt',dateField:'lastActivityAt',relation:'clientFiles'},clientCases:{title:'قضايا موكل',store:STORE.cases,index:'filingDate',dateField:'filingDate',relation:'clientCases'},caseHearings:{title:'جلسات قضية',store:STORE.hearings,index:'hearingDate',dateField:'hearingDate',relation:'caseHearings'},fileProcedures:{title:'أعمال ملف',store:STORE.procedures,index:'internalDueDate',dateField:'internalDueDate',relation:'fileProcedures'}
};

export const FIELD_DEFS={
 hearings:[['hearingDate','تاريخ الجلسة','date'],['hearingTime','الوقت','text'],['caseId','القضية','text'],['reason','السبب','text'],['result','النتيجة','text'],['nextAction','الإجراء التالي','text'],['type','نوع الجلسة','text']],
 procedures:[['internalDueDate','موعد المتابعة','date'],['fileId','الملف','text'],['caseId','القضية','text'],['description','الوصف','text'],['status','الحالة','text'],['priority','الأولوية','text'],['nextAction','الإجراء التالي','text'],['type','النوع','text']],
 appointments:[['date','التاريخ','date'],['time','الوقت','text'],['title','العنوان','text'],['clientId','الموكل','text'],['fileId','الملف','text'],['location','المكان','text'],['status','الحالة','text']],
 communications:[['date','التاريخ','date'],['clientId','الموكل','text'],['fileId','الملف','text'],['channel','الوسيلة','text'],['direction','الاتجاه','text'],['subject','الموضوع','text'],['followUpDate','المتابعة','date']],
 judgments:[['judgmentDate','تاريخ الحكم','date'],['caseId','القضية','text'],['judgmentNumber','رقم الحكم','text'],['court','المحكمة','text'],['operativeSummary','المنطوق','text']],
 expertReports:[['reportDate','تاريخ التقرير','date'],['caseId','القضية','text'],['expertName','الخبير','text'],['summary','الملخص','text']],
 execution:[['openedDate','تاريخ الفتح','date'],['caseId','القضية','text'],['executionNumber','رقم التنفيذ','text'],['status','الحالة','text'],['stage','المرحلة','text'],['nextAction','الإجراء التالي','text']],
 fees:[['createdAt','التاريخ','date'],['fileId','الملف','text'],['agreementType','نوع الاتفاق','text'],['agreedAmount','المبلغ المتفق','number'],['currency','العملة','text'],['paymentStatus','حالة السداد','text']],
 files:[['fileNumber','رقم الملف','text'],['title','العنوان','text'],['status','الحالة','text'],['priority','الأولوية','text'],['stage','المرحلة','text'],['lastActivityAt','آخر نشاط','date']],
 cases:[['caseNumber','رقم القضية','text'],['caseYear','السنة','number'],['courtId','المحكمة','text'],['subject','الموضوع','text'],['status','الحالة','text'],['filingDate','تاريخ القيد','date'],['stage','المرحلة','text']],
 clients:[['fullName','الاسم','text'],['nationalId','الرقم القومي','text'],['phone','الهاتف','text'],['status','الحالة','text'],['createdAt','تاريخ الإنشاء','date']],
 clientFiles:[['fileNumber','رقم الملف','text'],['title','العنوان','text'],['status','الحالة','text'],['priority','الأولوية','text'],['stage','المرحلة','text'],['lastActivityAt','آخر نشاط','date']],clientCases:[['caseNumber','رقم القضية','text'],['caseYear','السنة','number'],['courtId','المحكمة','text'],['subject','الموضوع','text'],['status','الحالة','text'],['filingDate','تاريخ القيد','date'],['stage','المرحلة','text']],caseHearings:[['hearingDate','تاريخ الجلسة','date'],['hearingTime','الوقت','text'],['reason','السبب','text'],['result','النتيجة','text'],['nextAction','الإجراء التالي','text'],['type','نوع الجلسة','text']],fileProcedures:[['internalDueDate','موعد المتابعة','date'],['description','الوصف','text'],['status','الحالة','text'],['priority','الأولوية','text'],['nextAction','الإجراء التالي','text'],['type','النوع','text']]
};

export const DEFAULT_COLUMNS={
 hearings:['hearingDate','hearingTime','caseId','reason','result','nextAction'],
 procedures:['internalDueDate','fileId','caseId','description','status','priority','nextAction'],
 appointments:['date','time','title','clientId','fileId','location','status'],
 communications:['date','clientId','fileId','channel','direction','subject','followUpDate'],
 judgments:['judgmentDate','caseId','judgmentNumber','court','operativeSummary'],
 expertReports:['reportDate','caseId','expertName','summary'],
 execution:['openedDate','caseId','executionNumber','status','stage','nextAction'],
 fees:['createdAt','fileId','agreementType','agreedAmount','currency','paymentStatus'],
 files:['fileNumber','title','status','priority','lastActivityAt'],
 cases:['caseNumber','caseYear','courtId','subject','status','filingDate'],
 clients:['fullName','nationalId','phone','status','createdAt'],
 clientFiles:['fileNumber','title','status','priority','lastActivityAt'],
 clientCases:['caseNumber','caseYear','courtId','subject','status','filingDate'],
 caseHearings:['hearingDate','hearingTime','reason','result','nextAction','type'],
 fileProcedures:['internalDueDate','description','status','priority','nextAction','type']
};

export function columnsFor(type){return DEFAULT_COLUMNS[type]||['id']}

const valueText=v=>String(v??'').replace(/[أإآٱ]/g,'ا').replace(/ى/g,'ي').replace(/[ًٌٍَُِّْـ]/g,'').replace(/\s+/g,' ').trim().toLocaleLowerCase('ar-EG');
export function conditionMatch(row,c){
 if(!c||!c.field)return true;
 const a=row[c.field],b=c.value;
 if(c.operator==='isEmpty')return a===undefined||a===null||String(a)==='';
 if(c.operator==='isNotEmpty')return !(a===undefined||a===null||String(a)==='');
 if(c.operator==='contains')return valueText(a).includes(valueText(b));
 if(c.operator==='notContains')return !valueText(a).includes(valueText(b));
 if(c.operator==='startsWith')return valueText(a).startsWith(valueText(b));
 if(c.operator==='equals')return valueText(a)===valueText(b);
 if(c.operator==='notEquals')return valueText(a)!==valueText(b);
 if(c.operator==='gt')return Number(a)>Number(b);
 if(c.operator==='gte')return Number(a)>=Number(b);
 if(c.operator==='lt')return Number(a)<Number(b);
 if(c.operator==='lte')return Number(a)<=Number(b);
 return true;
}
export function matchConditions(row,conditions=[],logic='AND'){
 const active=(conditions||[]).filter(c=>c?.field&&((c.value??'')!==''||['isEmpty','isNotEmpty'].includes(c.operator)));
 if(!active.length)return true;
 const vals=active.map(c=>conditionMatch(row,c));
 return logic==='OR'?vals.some(Boolean):vals.every(Boolean);
}

function sortRows(rows,sorts=[]){
 const s=(sorts||[]).filter(x=>x?.field);
 if(!s.length)return rows;
 return [...rows].sort((a,b)=>{for(const x of s){const av=a[x.field],bv=b[x.field];if(av===bv)continue;const aa=av==null?'':String(av),bb=bv==null?'':String(bv);const n=aa.localeCompare(bb,'ar-EG',{numeric:true,sensitivity:'base'});if(n)return x.direction==='desc'?-n:n}return String(a.id).localeCompare(String(b.id))});
}

async function relationRows(office,relation,id,limit=5000){
 if(!id)return [];
 const map={
  clientFiles:[STORE.fileClients,'clientId','fileId',STORE.files],
  clientCases:[STORE.caseClients,'clientId','caseId',STORE.cases],
  caseHearings:[STORE.hearings,'caseId','id',STORE.hearings],
  fileProcedures:[STORE.procedures,'fileId','id',STORE.procedures]
 }[relation];
 if(!map)return [];
 const [linkStore,linkIndex,targetKey,targetStore]=map;
 if(relation==='caseHearings'||relation==='fileProcedures')return office.r[targetStore].byIndex(linkIndex,id,limit);
 const links=await office.r[linkStore].byIndex(linkIndex,id,limit);
 const ids=links.map(x=>x[targetKey]).filter(Boolean);
 return office.r[targetStore].getMany(ids);
}

function rangeMatch(row,dateField,lo,hi){const d=String(row[dateField]||'').slice(0,10);return d>=String(lo).slice(0,10)&&d<=String(hi).slice(0,10)}

export async function generateReport(office,{type='hearings',preset='today',from,to,filters={},conditions=[],conditionLogic='AND',sorts=[],groupBy='',columns=null,limit=5000,clientId=null,relationId=null}={}){
 const spec=REPORT_SPECS[type]||REPORT_SPECS.hearings;
 let [lo,hi]=periodRange(preset,from,to);
 if(type==='procedures'&&preset==='overdue'){lo='0000-01-01';hi=dayAdd(today(),-1);filters={...(filters||{}),status:ACTIVE_PROCEDURE_STATUSES};}
 if(spec.dateField==='createdAt'||spec.dateField==='lastActivityAt'){lo+='T00:00:00';hi+='T23:59:59.999';}
 let rows;
 if(spec.relation) rows=await relationRows(office, spec.relation, type==='clientFiles'||type==='clientCases'?clientId:relationId, limit);
 else rows=await office.r[spec.store].reportRange({index:spec.index,lower:lo,upper:hi,limit,direction:'next',filter:x=>matchLegacyFilters(x,filters)&&matchConditions(x,conditions,conditionLogic)});
 if(spec.relation) rows=rows.filter(x=>rangeMatch(x,spec.dateField,lo,hi)&&matchLegacyFilters(x,filters)&&matchConditions(x,conditions,conditionLogic));
 rows=sortRows(rows,sorts.length?sorts:[{field:spec.dateField,direction:'asc'}]);
 const groups=groupBy?groupRows(rows,groupBy):null;
 return {title:spec.title,type,preset,from:lo,to:hi,rows,limit,filters,conditions,conditionLogic,sorts,groupBy,groups,columns:columns?.length?columns:columnsFor(type),clientId,relationId};
}

function matchLegacyFilters(x,f){for(const [k,v] of Object.entries(f||{})){if(v===undefined||v===null||v==='')continue;if(k==='q'){if(!JSON.stringify(x).toLocaleLowerCase('ar-EG').includes(String(v).toLocaleLowerCase('ar-EG')))return false;}else if(['status','priority','clientId','fileId','caseId'].includes(k)&&(Array.isArray(v)?!v.includes(x[k]):x[k]!==v))return false;}return true}
function groupRows(rows,field){const m=new Map();for(const row of rows){const key=String(row[field]??'غير محدد');if(!m.has(key))m.set(key,[]);m.get(key).push(row)}return [...m.entries()].map(([key,items])=>({key,items}))}

export function reportSummary(rows,columns){const numeric=columns.filter(c=>rows.some(r=>typeof r[c]==='number'));return {count:rows.length,totals:Object.fromEntries(numeric.map(c=>[c,rows.reduce((s,r)=>s+(Number(r[c])||0),0)]))}}
