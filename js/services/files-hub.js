// =====================================================================
// مركز الملفات (Files Hub) — طبقة قراءة وتحليل **مشتقة** من السجلات الأصلية.
// ---------------------------------------------------------------------
// • لا يخزّن نسخة موازية من الملفات أو الأطراف أو المراحل.
// • كل استعلام محدود (bounded scan) ويعلن صراحةً إن كان هناك أكثر من الحد.
// • النتائج الإدارية (اكتمال/تنبيه/جودة/تشابه) مؤشرات تشغيلية مبنية على الحقول
//   المسجلة فقط؛ وليست حكمًا قانونيًا ولا استنتاجًا لموعد أو نتيجة.
// • العلاقات تُقرأ من fileRelations نفسها؛ والعنوان/الاسم يُقرآن من السجل الأصلي.
// =====================================================================
import {scan} from './entity-query.js';
import {fileParties,fileRelations} from './legal-files.js';
import {buildFileTimeline} from './timeline.js';
import {ENTITIES,displayValue,fmtDate,isClosedFile,fileTypeGroup,label} from '../domain/entities.js';
import {formatFileNumber} from '../core/file-number.js';
import {normalizeArabic,normalizeDigits} from '../core/search-normalizer.js';
import {localDate} from '../core/clock.js';
import {normalizeNumberCode,rankFiles,matchExcerpt} from '../core/files-query.js';

export const HUB_LIMITS=Object.freeze({
 files:5000,
 parties:30000,
 stages:5000,
 relations:5000,
 procedures:5000,
 hearings:5000,
 serviceRecords:3000,
 adminRows:5000
});

const FILE_ADMIN_PREFIX='fileAdmin:';
const dayOf=value=>String(value||'').slice(0,10);
const nowIso=()=>new Date().toISOString();
const missing=()=>({missing:true,label:'غير مسجل'});
const text=value=>String(value??'').trim();

function groupBy(rows,key){
 const map=new Map();
 for(const row of rows){
  const id=row?.[key];
  if(!id)continue;
  if(!map.has(id))map.set(id,[]);
  map.get(id).push(row);
 }
 return map;
}

function emptyPortfolio(limits=HUB_LIMITS){
 return {
  files:[],fileById:new Map(),partiesByFile:new Map(),stagesByFile:new Map(),
  proceduresByFile:new Map(),relations:[],relationsByFile:new Map(),
  adminByFile:new Map(),hearings:[],serviceRecords:[],
  more:{files:false,parties:false,stages:false,relations:false,procedures:false,hearings:false,serviceRecords:false,adminRows:false},
  limits,generatedAt:nowIso()
 };
}

/** تحميل لقطة محدودة من كل ما تحتاجه لوحات الملفات — قراءة واحدة لكل مخزن. */
export async function loadFilePortfolio(office,{limits={}}={}){
 const cap={...HUB_LIMITS,...limits};
 const out=emptyPortfolio(cap);
 const guard=async(store,storeKey,limit)=>{
  try{
   const result=await scan(office,store,{limit,direction:'prev'});
   out.more[storeKey]=Boolean(result.more);
   return result.rows||[];
  }catch(error){
   console.info('files-hub store unavailable',store,error?.message||error);
   return [];
  }
 };
 const [files,parties,stages,relations,procedures,hearings,serviceRecords]=await Promise.all([
  guard('files','files',cap.files),
  guard('fileParties','parties',cap.parties),
  guard('cases','stages',cap.stages),
  guard('fileRelations','relations',cap.relations),
  guard('procedures','procedures',cap.procedures),
  guard('hearings','hearings',cap.hearings),
  guard('serviceRecords','serviceRecords',cap.serviceRecords)
 ]);
 out.files=files;
 out.fileById=new Map(files.map(file=>[file.id,file]));
 out.partiesByFile=groupBy(parties,'fileId');
 out.stagesByFile=groupBy(stages,'fileId');
 out.proceduresByFile=groupBy(procedures,'fileId');
 out.relations=relations;
 out.relationsByFile=new Map();
 for(const relation of relations){
  for(const fileId of [relation.sourceFileId,relation.targetFileId]){
   if(!fileId)continue;
   if(!out.relationsByFile.has(fileId))out.relationsByFile.set(fileId,[]);
   out.relationsByFile.get(fileId).push(relation);
  }
 }
 out.hearings=hearings;
 out.serviceRecords=serviceRecords;
 // سجلات الإدارة الجديدة كلها في مخزن settings — قراءة واحدة، ولا تمس السجلات الأصلية.
 try{
  const rows=await office.r.settings.all(cap.adminRows);
  out.more.adminRows=rows.length>=cap.adminRows;
  for(const row of rows){
   const id=String(row?.id||'');
   if(!id.startsWith(FILE_ADMIN_PREFIX))continue;
   const kind=id.split(':')[1];
   const fileId=id.split(':')[2]||'';
   if(!fileId)continue;
   if(!out.adminByFile.has(fileId))out.adminByFile.set(fileId,{});
   out.adminByFile.get(fileId)[kind]=row.value;
  }
 }catch{/* مخزن الإعدادات غير متاح: نكمل بلا مؤشرات إدارة */ }
 return out;
}

/** سياق بحث الملف من اللقطة — يُستخدم في البحث/الترتيب والمركز. */
export function contextOf(portfolio,fileId){
 return {
  parties:portfolio.partiesByFile.get(fileId)||[],
  stages:portfolio.stagesByFile.get(fileId)||[],
  numbers:[]
 };
}

// ===== اكتمال البيانات الإدارية =====
export const COMPLETENESS_FIELDS=Object.freeze([
 {key:'openedAt',label:'تاريخ فتح الملف',tab:'summary'},
 {key:'responsibleLawyer',label:'المحامي المسؤول',tab:'summary'},
 {key:'status',label:'الحالة المسجلة',tab:'summary'},
 {key:'fileType',label:'نوع الملف',tab:'typeData'},
 {key:'nextStep',label:'الخطوة التالية المسجلة',tab:'summary'}
]);

/**
 * مؤشر اكتمال **إداري** فقط. لا يقول إن الملف مستوفٍ قانونًا.
 * النسبة = الحقول الإدارية المسجلة + وجود طرف واحد على الأقل + وجود مرحلة مسجلة (كوجود سجل فقط).
 */
export function administrativeCompleteness(file,ctx={}){
 const missingItems=[];
 let done=0,total=COMPLETENESS_FIELDS.length+2;
 for(const field of COMPLETENESS_FIELDS){
  const value=field.key==='fileType'?(file.fileType||file.typeSnapshot?.type):file[field.key];
  if(text(value)){done++;}
  else missingItems.push({key:field.key,label:field.label,tab:field.tab,kind:'field'});
 }
 const parties=ctx.parties||[];
 const stages=ctx.stages||[];
 if(parties.length)done++;else missingItems.push({key:'parties',label:'لا يوجد طرف مسجل',tab:'parties',kind:'relation'});
 if(stages.length)done++;else missingItems.push({key:'stages',label:'لا توجد مرحلة قضائية مسجلة',tab:'judicial',kind:'relation',note:'وجود المرحلة اختياري — الملف الإداري قد يعمل بلا قضية.'});
 const percent=Math.round(done/total*100);
 return {
  percent,done,total,missing:missingItems,
  label:'اكتمال البيانات الإدارية',
  disclaimer:'مؤشر إداري محسوب من الحقول المسجلة فقط، وليس اكتمالًا قانونيًا ولا ضمانًا لصحة الملف.'
 };
}

// ===== تنبيهات إدارية =====
const ATTENTION_RULES=Object.freeze({
 overdueStep:{priority:'high',label:'موعد الخطوة التالية المسجل انقضى'},
 stale:{priority:'medium',label:'لا يوجد نشاط مسجل منذ مدة'},
 missingParties:{priority:'high',label:'لا يوجد أطراف مسجلون'},
 missingResponsible:{priority:'medium',label:'المحامي المسؤول غير مسجل'},
 checklist:{priority:'low',label:'بنود تحقق إدارية غير منجزة'},
 missingStage:{priority:'low',label:'لا توجد مرحلة قضائية مسجلة'}
});

function daysSince(value,today){
 const date=dayOf(value);
 if(!date)return null;
 const diff=Date.parse(today)-Date.parse(date);
 return Number.isFinite(diff)?Math.floor(diff/864e5):null;
}

/**
 * تنبيهات «ما الذي يحتاج إلى انتباهي؟» — لكل عنصر سبب ظاهر ومصدر ورابط.
 * لا تُنشئ مواعيد قانونية ولا تفترض التزامًا لم يُسجَّل.
 */
export function buildAttention(portfolio,{today=localDate(),staleDays=45}={}){
 const items=[];
 const seen=new Set();
 const push=(file,rule,extra={})=>{
  const key=`${file.id}:${rule}`;
  if(seen.has(key))return;
  seen.add(key);
  const meta=ATTENTION_RULES[rule]||{priority:'low',label:rule};
  items.push({
   id:key,fileId:file.id,file,
   title:`${formatFileNumber(file.fileNumber)||'ملف'} — ${file.title||'بدون عنوان'}`,
   reason:meta.label,reasonCode:rule,priority:meta.priority,
   source:'files/الحقول المسجلة'+extra.sourceSuffix,
   tab:extra.tab||'summary',
   meta:extra.meta||'',
   at:extra.at||''
  });
 };
 for(const file of portfolio.files){
  if(isClosedFile(file))continue;
  const stepDate=dayOf(file.nextStepDate);
  if(stepDate&&stepDate<=today)push(file,'overdueStep',{meta:`موعد مسجل: ${fmtDate(stepDate)}`,at:stepDate});
  if(String(file.nextStep||'').trim()&&!stepDate)push(file,'overdueStep',{tab:'summary',meta:'الخطوة التالية مسجلة دون تاريخ'});
  const idle=daysSince(file.lastActivityAt||file.updatedAt,today);
  if(idle!==null&&idle>=staleDays)push(file,'stale',{meta:`آخر نشاط مسجل منذ ${idle} يومًا`,at:file.lastActivityAt||file.updatedAt});
  if(!(portfolio.partiesByFile.get(file.id)||[]).length)push(file,'missingParties',{tab:'parties'});
  if(!text(file.responsibleLawyer))push(file,'missingResponsible',{tab:'summary'});
  if(!(portfolio.stagesByFile.get(file.id)||[]).length)push(file,'missingStage',{tab:'judicial',meta:'الحقل اختياري — يظهر للتنبيه الإداري فقط'});
  const admin=portfolio.adminByFile.get(file.id)?.checklist;
  if(admin?.items&&typeof admin.items==='object'){
   const pending=Object.values(admin.items).filter(item=>item&&!item.done).length;
   if(pending)push(file,'checklist',{meta:`${pending} بند تحقق إداري غير منجز`,sourceSuffix:' + files-admin'});
  }
 }
 const rank={high:0,medium:1,low:2};
 return items.sort((a,b)=>rank[a.priority]-rank[b.priority]||String(b.at||'').localeCompare(String(a.at||'')));
}

// ===== إحصاءات وتوزيعات =====
export function fileDistribution(portfolio,{key='fileType'}={}){
 const labelOf=value=>{
  if(!value)return 'غير مسجل';
  if(key==='status')return label(value)||value;
  return String(value);
 };
 const map=new Map();
 for(const file of portfolio.files){
  const value=text(file[key])||'';
  const labelValue=labelOf(value);
  if(!map.has(labelValue))map.set(labelValue,{label:labelValue,value,count:0,ids:[],closed:0,archived:0});
  const bucket=map.get(labelValue);
  bucket.count++;
  bucket.ids.push(file.id);
  if(isClosedFile(file))bucket.closed++;
  if(file.isArchived)bucket.archived++;
 }
 return [...map.values()].sort((a,b)=>b.count-a.count||a.label.localeCompare(b.label,'ar'));
}

export function workloadByProcedureType(portfolio){
 const map=new Map();
 for(const rows of portfolio.proceduresByFile.values()){
  for(const procedure of rows){
   const type=text(procedure.type)||text(procedure.description)||'غير مسجل';
   if(!map.has(type))map.set(type,{type,open:0,done:0,late:0,total:0,dueDated:0});
   const bucket=map.get(type);
   bucket.total++;
   const status=String(procedure.status||'');
   if(['done','completed','منجز','مكتمل'].includes(status))bucket.done++;
   else bucket.open++;
   if(procedure.internalDueDate){
    bucket.dueDated++;
    if(dayOf(procedure.internalDueDate)<localDate()&&bucket.open)bucket.late++;
   }
  }
 }
 return [...map.values()].sort((a,b)=>b.total-a.total);
}

export function workloadByMonth(portfolio,{months=6,today=localDate()}={}){
 const anchor=new Date(`${today}T00:00:00`);
 const buckets=[];
 for(let i=months-1;i>=0;i--){
  const date=new Date(anchor.getFullYear(),anchor.getMonth()-i,1);
  const key=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
  buckets.push({key,label:key,hearings:0,announcements:0,procedures:0});
 }
 const byKey=new Map(buckets.map(bucket=>[bucket.key,bucket]));
 for(const hearing of portfolio.hearings){
  const bucket=byKey.get(String(hearing.hearingDate||'').slice(0,7));
  if(bucket)bucket.hearings++;
 }
 for(const record of portfolio.serviceRecords){
  const bucket=byKey.get(String(record.serviceDate||record.submittedAt||'').slice(0,7));
  if(bucket)bucket.announcements++;
 }
 for(const rows of portfolio.proceduresByFile.values()){
  for(const procedure of rows){
   const bucket=byKey.get(String(procedure.actionDate||procedure.createdAt||'').slice(0,7));
   if(bucket)bucket.procedures++;
  }
 }
 return buckets;
}

export function comparePeriods(rows,{dateField,periodA,periodB}={}){
 const inRange=(value,range)=>{
  const date=dayOf(value);
  if(!date||!range?.from||!range?.to)return false;
  return date>=range.from&&date<=range.to;
 };
 const countA=rows.filter(row=>inRange(row[dateField],periodA)).length;
 const countB=rows.filter(row=>inRange(row[dateField],periodB)).length;
 return {
  a:countA,b:countB,
  delta:countB-countA,
  percent:countA?Math.round((countB-countA)/countA*1000)/10:null,
  dateField,periodA,periodB,
  note:'العدّ يستخدم الحقل المسجل المذكور ونطاقيه المحددين فقط؛ لم تُستنتج فترات غير مسجلة.'
 };
}

// ===== جودة البيانات =====
const QUALITY_LEVELS=Object.freeze({error:'خطأ مؤكد',missing:'نقص بيانات',warning:'تنبيه للمراجعة'});

function qualityIssue(level,code,message,{file,tab,source,field='',action='' }={}){
 return {id:`${file?.id||'-'}:${code}:${field}`,level,levelLabel:QUALITY_LEVELS[level]||level,code,message,fileId:file?.id||'',title:file?`${formatFileNumber(file.fileNumber)||'ملف'} — ${file.title||'بدون عنوان'}`:'',tab:tab||'summary',source:source||'بيانات الملف',field,action};
}

const FILE_NUMBER_PATTERN=/^\d{4}\/\d{3,6}$/;
const KNOWN_STATUS=/^(مفتوح|نشط|قيد المتابعة|منتهٍ|مغلق|مؤرشف|open|active|closed|pending)$/i;

export function buildQualityReport(portfolio,{today=localDate()}={}){
 const issues=[];
 for(const file of portfolio.files){
  const parties=portfolio.partiesByFile.get(file.id)||[];
  const stages=portfolio.stagesByFile.get(file.id)||[];
  if(!text(file.fileNumber))issues.push(qualityIssue('error','file-number','رقم الملف مفقود.',{file,tab:'summary',field:'fileNumber'}));
  else if(!FILE_NUMBER_PATTERN.test(text(file.fileNumber)))issues.push(qualityIssue('warning','file-number-format','صيغة رقم الملف غير نمطية (المتوقع سنة/تسلسل).',{file,tab:'summary',field:'fileNumber',action:'راجع الترقيم مع مسؤول النظام'}));
  if(!text(file.title))issues.push(qualityIssue('missing','title','عنوان الملف غير مسجل.',{file,tab:'summary',field:'title'}));
  if(!text(file.fileType))issues.push(qualityIssue('missing','file-type','نوع الملف غير مسجل.',{file,tab:'typeData',field:'fileType'}));
  if(!text(file.status))issues.push(qualityIssue('missing','status','حالة الملف غير مسجلة.',{file,tab:'summary',field:'status'}));
  else if(!KNOWN_STATUS.test(text(file.status)))issues.push(qualityIssue('warning','status-custom','الحالة المسجلة قيمة مخصصة غير معروفة في القائمة الافتراضية.',{file,tab:'summary',field:'status',action:'تحقق من قاموس حالات الملف'}));
  if(!text(file.responsibleLawyer))issues.push(qualityIssue('missing','lawyer','المحامي المسؤول غير مسجل.',{file,tab:'summary',field:'responsibleLawyer'}));
  if(!text(file.openedAt))issues.push(qualityIssue('missing','opened-at','تاريخ الفتح غير مسجل.',{file,tab:'summary',field:'openedAt'}));
  if(!parties.length)issues.push(qualityIssue('missing','parties','لا يوجد أي طرف مسجل في الملف.',{file,tab:'parties',source:'fileParties'}));
  if(parties.some(party=>!text(party.name||party.partyName)))issues.push(qualityIssue('warning','party-name','يوجد طرف بلا اسم مسجل.',{file,tab:'parties',source:'fileParties',field:'name'}));
  if(parties.some(party=>party.phone&&!/^[\d+\-\s()]{6,}$/.test(normalizeDigits(String(party.phone)))))issues.push(qualityIssue('warning','party-phone','صيغة هاتف طرف غير نمطية.',{file,tab:'parties',source:'fileParties',field:'phone',action:'راجع الهاتف في سجل الطرف'}));
  const stageNumbers=new Set();
  for(const stage of stages){
   const numberKey=normalizeNumberCode(`${stage.caseNumber||''}/${stage.caseYear||''}`);
   if(!text(stage.caseNumber))issues.push(qualityIssue('warning','stage-number','مرحلة مسجلة بلا رقم قضائي.',{file,tab:'judicial',source:'cases',field:'caseNumber'}));
   if(numberKey&&stageNumbers.has(numberKey))issues.push(qualityIssue('warning','stage-duplicate-number','رقم قضائي مكرر داخل الملف نفسه.',{file,tab:'judicial',source:'cases',field:'caseNumber',action:'راجع المراحل؛ لا يُدمج تلقائيًا'}));
   if(numberKey)stageNumbers.add(numberKey);
  }
  const idle=daysSince(file.lastActivityAt||file.updatedAt,today);
  if(idle!==null&&idle>365)issues.push(qualityIssue('warning','stale-year','لا يوجد تحديث مسجل للملف منذ أكثر من سنة.',{file,tab:'activity',source:'lastActivityAt'}));
 }
 // العلاقات اليتيمة والمكررة
 const seenPair=new Set();
 for(const relation of portfolio.relations){
  if(relation.sourceFileId===relation.targetFileId)issues.push(qualityIssue('error','relation-self','علاقة ملف بنفسه.',{file:portfolio.fileById.get(relation.sourceFileId)||{id:relation.sourceFileId,fileNumber:'',title:''},tab:'relations',source:'fileRelations'}));
  if(!portfolio.fileById.has(relation.sourceFileId)||!portfolio.fileById.has(relation.targetFileId)){
   const known=portfolio.fileById.get(relation.sourceFileId)||{id:relation.sourceFileId,fileNumber:'',title:''};
   issues.push(qualityIssue('error','relation-missing-target','علاقة تشير إلى ملف غير موجود ضمن البيانات المحملة.',{file:known,tab:'relations',source:'fileRelations',action:'تحقق يدويًا؛ لا يُحذف الرابط تلقائيًا'}));
  }
  const pair=[relation.sourceFileId,relation.targetFileId].sort().join('::')+'::'+String(relation.relationType||'');
  if(seenPair.has(pair))issues.push(qualityIssue('warning','relation-duplicate','علاقة مكررة بين الملفين.',{file:portfolio.fileById.get(relation.sourceFileId)||{id:relation.sourceFileId,fileNumber:'',title:''},tab:'relations',source:'fileRelations',action:'راجع العلاقات قبل أي إجراء'}));
  seenPair.add(pair);
 }
 return {
  issues,
  byLevel:{
   error:issues.filter(item=>item.level==='error').length,
   missing:issues.filter(item=>item.level==='missing').length,
   warning:issues.filter(item=>item.level==='warning').length
  },
  scanned:{files:portfolio.files.length,parties:portfolio.partiesByFile.size,stages:portfolio.stagesByFile.size,relations:portfolio.relations.length},
  more:portfolio.more,
  disclaimer:'تقرير جودة إداري مبني على القيم المسجلة؛ «خطأ مؤكد» يعني مخالفة شكلية واضحة لا حكمًا قانونيًا.'
 };
}

// ===== التشابه / التكرار المحتمل =====
function similarity(a,b){
 const x=normalizeArabic(a||'').replace(/\s+/g,' ');
 const y=normalizeArabic(b||'').replace(/\s+/g,' ');
 if(!x||!y)return 0;
 if(x===y)return 1;
 const aTokens=new Set(x.split(' '));
 const bTokens=new Set(y.split(' '));
 let shared=0;
 for(const token of aTokens)if(bTokens.has(token))shared++;
 const dice=(2*shared)/(aTokens.size+bTokens.size);
 const containment=Math.min(1,Math.min(x.length,y.length)/Math.max(x.length,y.length));
 return Math.max(dice,containment*0.6);
}

/**
 * كشف تشابه إداري **بدون مقارنة كل زوج**: يُجمَّع الملفون بمفاتيح حجب صريحة
 * (رقم الملف، العنوان المطبَّع، أول 3 كلمات دالة، اسم الموكل)، ثم تُقارن
 * الأزواج داخل كل مجموعة فقط. النتيجة اقتراح مراجعة بشرية ولا تدمج شيئًا.
 */
export function detectDuplicateFiles(portfolio,{threshold=0.86,limit=200}={}){
 const files=portfolio.files;
 const partiesOf=fileId=>portfolio.partiesByFile.get(fileId)||[];
 const clientNames=fileId=>partiesOf(fileId)
  .filter(party=>party.partyKind==='client'||party.clientId)
  .map(party=>text(party.name||party.partyName)).filter(Boolean);
 const titleKey=file=>{
  const normalized=normalizeArabic(file.title||'').replace(/\s+/g,' ').trim();
  if(!normalized)return '';
  return normalized.split(' ').filter(token=>token.length>2).slice(0,3).join(' ');
 };
 const buckets=new Map();
 const addKey=(kind,value,file)=>{
  if(!value)return;
  const key=`${kind}::${value}`;
  if(!buckets.has(key))buckets.set(key,[]);
  buckets.get(key).push(file);
 };
 for(const file of files){
  const number=normalizeNumberCode(file.fileNumber||'');
  if(number)addKey('number',number,file);
  const normalizedTitle=normalizeArabic(file.title||'').replace(/\s+/g,' ').trim();
  if(normalizedTitle)addKey('title',normalizedTitle,file);
  const key=titleKey(file);
  if(key)addKey('title-prefix',key,file);
  for(const name of clientNames(file.id))addKey('client',normalizeArabic(name),file);
 }
 const seenPair=new Set();
 const candidates=[];
 const evaluate=(a,b)=>{
  if(!a||!b||a.id===b.id)return;
  const pairKey=[a.id,b.id].sort().join('::');
  if(seenPair.has(pairKey))return;
  seenPair.add(pairKey);
  const aNames=clientNames(a.id),bNames=clientNames(b.id);
  const reasons=[];
  const titleScore=similarity(a.title,b.title);
  if(titleScore>=threshold)reasons.push({type:'title',score:titleScore,source:'files.title',a:a.title||'',b:b.title||''});
  const numberSame=a.fileNumber&&normalizeNumberCode(a.fileNumber)===normalizeNumberCode(b.fileNumber);
  if(numberSame)reasons.push({type:'fileNumber',score:1,source:'files.fileNumber',a:a.fileNumber,b:b.fileNumber});
  const sharedClient=aNames.find(name=>bNames.some(other=>similarity(name,other)>=threshold));
  if(sharedClient)reasons.push({type:'client',score:1,source:'fileParties.name',a:sharedClient,b:bNames.find(name=>similarity(sharedClient,name)>=threshold)||''});
  if(reasons.length)candidates.push({a,b,reasons,score:Math.max(...reasons.map(reason=>reason.score))});
 };
 let comparisons=0;
 const cap=400000;
 for(const group of buckets.values()){
  if(group.length<2)continue;
  // مجموعة ضخمة (مثلاً موكل بآلاف الملفات) تُقارن بعنوان/رقم فقط لتجنّب انفجار تكعيبي.
  const bounded=group.slice(0,60);
  for(let i=0;i<bounded.length&&comparisons<cap;i++){
   for(let j=i+1;j<bounded.length&&comparisons<cap;j++){
    comparisons++;
    evaluate(bounded[i],bounded[j]);
    if(candidates.length>=limit)break;
   }
   if(candidates.length>=limit)break;
  }
  if(candidates.length>=limit)break;
 }
 candidates.sort((a,b)=>b.score-a.score);
 return {
  candidates:candidates.slice(0,limit),
  note:'اقتراحات تشابه إدارية فقط مبنية على مفاتيح حجب صريحة (الرقم/العنوان/أول كلمات/اسم الموكل). لا دمج ولا حذف تلقائي، وقد تفوت بعض الحالات خارج هذه المفاتيح.',
  scanned:{files:files.length,parties:portfolio.partiesByFile.size,comparisons,buckets:buckets.size},
  more:portfolio.more.files||portfolio.more.parties
 };
}

// ===== تدقيق العلاقات =====
export function buildRelationAudit(portfolio){
 const broken=[];
 const self=[];
 const duplicates=[];
 const byPair=new Map();
 for(const relation of portfolio.relations){
  if(relation.sourceFileId===relation.targetFileId)self.push(relation);
  const source=portfolio.fileById.get(relation.sourceFileId);
  const target=portfolio.fileById.get(relation.targetFileId);
  if(!source||!target)broken.push({relation,source,target,missing:[!source?'sourceFileId':null,!target?'targetFileId':null].filter(Boolean)});
  const key=[relation.sourceFileId,relation.targetFileId].sort().join('::')+'::'+String(relation.relationType||'');
  if(!byPair.has(key))byPair.set(key,[]);
  byPair.get(key).push(relation);
 }
 for(const rows of byPair.values())if(rows.length>1)duplicates.push(rows);
 return {
  broken,self,duplicates,
  total:portfolio.relations.length,
  filesWithoutRelations:portfolio.files.filter(file=>!(portfolio.relationsByFile.get(file.id)||[]).length).length,
  more:portfolio.more.relations||portfolio.more.files,
  note:'الفحص لا يصلح ولا يحذف أي رابط؛ أي تصحيح يدوي من صفحة العلاقات الأصلية.'
 };
}

// ===== خط زمني للمراحل + أحداث مرتبطة =====
export async function loadFileTimelineBundle(office,fileId){
 if(!fileId)return null;
 return buildFileTimeline(office,fileId);
}

export function timelineWithUndated(timeline=[]){
 const dated=timeline.filter(item=>text(item.date));
 const undated=timeline.filter(item=>!text(item.date));
 return {dated,undated};
}

// ===== مقارنة ملفين =====
export async function loadFileForCompare(office,fileId){
 const file=await office.r.files.get(fileId);
 if(!file||file.isDeleted)return null;
 const [parties,stages,relations,procedures]=await Promise.all([
  fileParties(office,fileId).catch(()=>[]),
  office.r.cases.byIndex('fileId',fileId,500).catch(()=>[]),
  fileRelations(office,fileId).catch(()=>[]),
  office.r.procedures.byIndex('fileId',fileId,1000).catch(()=>[])
 ]);
 const relatedFiles=[];
 if(relations.length){
  const ids=[...new Set(relations.map(relation=>relation.otherFileId).filter(Boolean))];
  const rows=await office.r.files.getMany(ids).catch(()=>[]);
  const map=new Map(rows.map(row=>[row.id,row]));
  for(const relation of relations)relatedFiles.push({relation,file:map.get(relation.otherFileId)||null});
 }
 return {id:fileId,file,parties,stages,relations,relatedFiles,procedures};
}

export const COMPARE_FIELDS=Object.freeze([
 'fileNumber','title','fileType','mainCategory','subCategory','status','priority','openedAt',
 'responsibleLawyer','coLawyers','staff','nextStep','nextStepDate','closedAt','closeReason','notes'
]);

function fieldLabel(key){
 const field=ENTITIES.files.fields.find(item=>item.k===key);
 return field?.l||key;
}

function compareValue(value){
 const body=text(value);
 return body?{available:true,value:body}:{available:false,value:'غير مسجل'};
}

export function compareFileBundles(a,b){
 const fields=COMPARE_FIELDS.map(key=>({
  key,label:fieldLabel(key),
  a:compareValue(a?.file?.[key]),b:compareValue(b?.file?.[key]),
  same:normalizeArabic(text(a?.file?.[key]))===normalizeArabic(text(b?.file?.[key]))
 }));
 const partyLines=bundle=>(bundle?.parties||[]).map(party=>({
  key:`${party.partyKind||''}:${party.clientId||party.opponentId||party.id||''}:${party.role||''}`,
  name:text(party.name||party.partyName),role:text(party.role),kind:party.partyKind||'',
  phone:text(party.phone)
 }));
 const partiesA=partyLines(a),partiesB=partyLines(b);
 const partiesOnlyA=partiesA.filter(party=>!partiesB.some(other=>similarity(party.name,other.name)>=0.95));
 const partiesOnlyB=partiesB.filter(party=>!partiesA.some(other=>similarity(party.name,other.name)>=0.95));
 const stagesA=(a?.stages||[]).map(stage=>({id:stage.id,type:stage.stageType||stage.numberType||'',number:stage.caseNumber||'',year:stage.caseYear||'',court:stage.courtId||'',status:stage.status||''}));
 const stagesB=(b?.stages||[]).map(stage=>({id:stage.id,type:stage.stageType||stage.numberType||'',number:stage.caseNumber||'',year:stage.caseYear||'',court:stage.courtId||'',status:stage.status||''}));
 const stageKey=stage=>`${normalizeArabic(stage.type)}:${normalizeNumberCode(stage.number+'/'+stage.year)}`;
 const stagesOnlyA=stagesA.filter(stage=>!stagesB.some(other=>stageKey(stage)===stageKey(other)));
 const stagesOnlyB=stagesB.filter(stage=>!stagesA.some(other=>stageKey(stage)===stageKey(other)));
 return {
  fields,parties:{a:partiesA,b:partiesB,onlyA:partiesOnlyA,onlyB:partiesOnlyB},
  stages:{a:stagesA,b:stagesB,onlyA:stagesOnlyA,onlyB:stagesOnlyB},
  sameFields:fields.filter(field=>field.same).length,
  differentFields:fields.filter(field=>!field.same).length,
  availability:{a:Boolean(a),b:Boolean(b)},
  note:'المقارنة تعرض القيم المسجلة جنبًا إلى جنب؛ لا تغيّر أي سجل ولا تستنتج تطابقًا قانونيًا.'
 };
}

// ===== حداثة البيانات وآخر نقطة =====
export function buildFreshness(portfolio,{today=localDate(),staleDays=45,visits=[]}={}){
 const reviewByFile=new Map((Array.isArray(visits)?visits:[]).filter(item=>item?.fileId).map(item=>[item.fileId,item]));
 return portfolio.files.map(file=>{
  const visit=reviewByFile.get(file.id)||file.__visits||null;
  const lastLegal=file.lastActivityAt||'';
  const lastTechnical=file.updatedAt||'';
  const lastReview=visit?.at||'';
  const days=daysSince(lastLegal||lastTechnical,today);
  return {
   fileId:file.id,title:`${formatFileNumber(file.fileNumber)||'ملف'} — ${file.title||''}`,
   lastLegal,lastTechnical,lastReview,days,
   status:days===null?'unknown':days>=staleDays?'stale':'fresh',
   note:'آخر تعديل تقني ومراجعة المستخدم مفهومان منفصلان؛ عدم التحديث لا يعني خطأ في البيانات.'
  };
 });
}

// ===== فهرس نصي للبيانات الطويلة =====
/**
 * يُبنى من القيم الأصلية عند الطلب فقط. لا يُخزَّن ولا يصبح مصدرًا للمعلومة.
 */
export async function buildLongTextIndex(office,{limit=2000}={}){
 const [notes,docs,procedures,communications]=await Promise.all([
  scan(office,'caseNotes',{limit,direction:'prev'}).catch(()=>({rows:[]})),
  scan(office,'documentReferences',{limit,direction:'prev'}).catch(()=>({rows:[]})),
  scan(office,'procedures',{limit,direction:'prev'}).catch(()=>({rows:[]})),
  scan(office,'communications',{limit,direction:'prev'}).catch(()=>({rows:[]}))
 ]);
 const entries=[];
 for(const note of notes.rows||[])entries.push({store:'caseNotes',id:note.id,fileId:note.fileId||'',title:note.title||'ملاحظة',body:note.content||'',date:note.createdAt||'',route:`rec:caseNotes:${note.id}`});
 for(const doc of docs.rows||[])entries.push({store:'documentReferences',id:doc.id,fileId:doc.fileId||'',title:doc.title||'مستند',body:[doc.notes,doc.physicalLocation,doc.type].filter(Boolean).join(' — '),date:doc.date||'',route:`rec:documentReferences:${doc.id}`});
 for(const procedure of procedures.rows||[])entries.push({store:'procedures',id:procedure.id,fileId:procedure.fileId||'',title:procedure.type||'عمل إداري',body:[procedure.description,procedure.notes,procedure.result].filter(Boolean).join(' — '),date:procedure.actionDate||procedure.createdAt||'',route:`rec:procedures:${procedure.id}`});
 for(const communication of communications.rows||[])entries.push({store:'communications',id:communication.id,fileId:communication.fileId||'',title:communication.subject||'اتصال',body:[communication.summary,communication.notes].filter(Boolean).join(' — '),date:communication.date||communication.createdAt||'',route:`rec:communications:${communication.id}`});
 return {entries,more:Boolean(notes.more||docs.more||procedures.more||communications.more),source:'السجلات الأصلية عند الطلب',note:'فهرس مؤقت قابل لإعادة البناء؛ لا يخزّن نسخة دائمة من النصوص.'};
}

// ===== ملخص إداري قابل للتحقق =====
export function buildVerifiableSummary(portfolio,fileId,{admin=null,today=localDate()}={}){
 const file=portfolio.fileById.get(fileId)||portfolio.files.find(item=>item.id===fileId);
 if(!file)return null;
 const parties=portfolio.partiesByFile.get(fileId)||[];
 const stages=portfolio.stagesByFile.get(fileId)||[];
 const completeness=administrativeCompleteness(file,{parties,stages});
 const lines=[];
 const add=(labelText,value,source)=>{
  const has=text(value);
  lines.push({label:labelText,value:has?String(value):'غير مسجل',source,available:has});
 };
 add('رقم الملف',formatFileNumber(file.fileNumber)||file.fileNumber,'files.fileNumber');
 add('العنوان',file.title,'files.title');
 add('نوع الملف',file.fileType,'files.fileType');
 add('الحالة المسجلة',label(file.status)||file.status,'files.status');
 add('تاريخ الفتح',file.openedAt?fmtDate(file.openedAt):'','files.openedAt');
 add('المحامي المسؤول',file.responsibleLawyer,'files.responsibleLawyer');
 add('الخطوة التالية',file.nextStep,'files.nextStep');
 add('تاريخ الخطوة التالية',file.nextStepDate?fmtDate(file.nextStepDate):'','files.nextStepDate');
 add('عدد الأطراف',parties.length?String(parties.length):'','fileParties');
 add('عدد المراحل',stages.length?String(stages.length):'','cases');
 if(admin?.checklist)add('بنود التحقق الإدارية',`${admin.checklist.done}/${admin.checklist.total}`, 'settings.fileAdmin.checklist');
 return {
  fileId,title:`${formatFileNumber(file.fileNumber)||'ملف'} — ${file.title||''}`,
  lines,completeness,generatedAt:nowIso(),today,
  disclaimer:'ملخص إداري من الحقول المسجلة أعلاه فقط. لا يخترع وقائع ولا يستنتج نتائج أو مواعيد قانونية.',
  missingCount:lines.filter(line=>!line.available).length
 };
}

// ===== البحث المركب =====
export function searchPortfolio(portfolio,query,{limit=200}={}){
 const ranked=rankFiles(portfolio.files,query,file=>contextOf(portfolio,file.id));
 return {
  rows:ranked.slice(0,limit).map(item=>{
   const noteExcerpt=matchExcerpt(item.row.notes||'',query);
   return {file:item.row,score:item.score,excerpt:noteExcerpt,parties:portfolio.partiesByFile.get(item.row.id)||[],stages:portfolio.stagesByFile.get(item.row.id)||[]};
  }),
  total:ranked.length,truncated:ranked.length>limit,
  source:'files + fileParties + cases (قراءة محدودة)',
  note:'المطابقة على نسخ مطبَّعة للعرض فقط، والقيم المخزنة لم تتغير.'
 };
}

export {buildFileTimeline,fileParties,fileRelations,displayValue,fileTypeGroup};
