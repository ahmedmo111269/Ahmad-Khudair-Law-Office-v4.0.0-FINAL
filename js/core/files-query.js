// =====================================================================
// استعلام ملفات موحّد (Files Query) — منطق صرف بلا DOM وبلا IndexedDB.
// ---------------------------------------------------------------------
// يُستخدم في: بحث قائمة الملفات، البحث المركب، مركز الأوامر، الملخص الإداري،
// ومقارنة السجلات. القيم المخزنة لا تُعدَّل أبدًا؛ التطبيع للمطابقة فقط.
// - تطبيع الهمزات والياءات والتشكيل والتطويل والأرقام العربية/الهندية.
// - مطابقة الأرقام بصيغها الشائعة (4/2026 · 4-2026 · ٢٠٢٦/٤) دون مسح الرقم الأصلي.
// - قواعد صريحة ومحدودة لتحويل نص إلى مرشحات؛ لا استنتاج قانوني ولا تخمين حالة.
// =====================================================================
import {normalizeArabic,normalizeDigits} from './search-normalizer.js';

export const FILE_QUERY_KEYS=Object.freeze({
 'نوع':'type','النوع':'type','type':'type',
 'حالة':'status','الحالة':'status','status':'status',
 'موكل':'client','الموكل':'client','client':'client',
 'خصم':'opponent','الخصم':'opponent','opponent':'opponent',
 'سنة':'year','السنة':'year','year':'year',
 'رقم':'number','الرقم':'number','number':'number','رقم الملف':'number',
 'مرحلة':'stage','المرحلة':'stage','stage':'stage',
 'موضوع':'subject','الموضوع':'subject','subject':'subject'
});

export const FILE_CRITERIA_LABELS=Object.freeze({
 type:'النوع',status:'الحالة',client:'الموكل',opponent:'الخصم',
 year:'السنة',number:'الرقم',stage:'المرحلة',subject:'الموضوع'
});

const KEY_PATTERN=new RegExp(
 `(^|\\s)(${Object.keys(FILE_QUERY_KEYS).sort((a,b)=>b.length-a.length).map(escapeRegExp).join('|')})\\s*[:：]\\s*("[^"]*"|'[^']*'|\\S+)`,
 'gi'
);

function escapeRegExp(value){
 return String(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
}

/** كود رقمي موحّد للمقارنة: 4/2026 ← 4/2026 (مع إزالة الأصفار البادئة لكل جزء). */
export function normalizeNumberCode(value=''){
 const text=normalizeDigits(String(value||'')).normalize('NFKC').trim();
 const parts=text.match(/\d+/g);
 if(!parts)return '';
 return parts.map(part=>String(Number(part))).join('/');
}

/** كل الصيغ المعقولة لرقم مثل 4/2026 — للمطابقة فقط. */
export function numberVariants(value=''){
 const text=normalizeDigits(String(value||'')).normalize('NFKC').trim();
 const code=normalizeNumberCode(text);
 const digits=text.replace(/\D/g,'');
 const out=new Set();
 if(code)out.add(code);
 if(digits.length>=3){
  out.add(digits);
  if(code.includes('/'))out.add(code.split('/').reverse().join('/'));
 }
 const raw=text.replace(/\s+/g,'');
 if(raw)out.add(raw);
 return [...out];
}

/** استخراج الأرقام والعملات الرمزية من نص بحث حر. */
export function numberTokensOf(text=''){
 const t=normalizeDigits(String(text||''));
 const out=new Set();
 for(const match of t.matchAll(/\d+(?:\s*[/\-.]\s*\d+)*/g)){
  const value=match[0].replace(/\s+/g,'');
  const code=normalizeNumberCode(value);
  if(code)out.add(code);
  if(value!==code)out.add(value);
 }
 return [...out];
}

function splitTerms(raw=''){
 const text=String(raw||'');
 const terms=[];
 let current='';
 let quote='';
 for(const char of text){
  if(quote){
   if(char===quote){terms.push(current);current='';quote=''}
   else current+=char;
   continue;
  }
  if(char==='"'||char==="'"){quote=char;continue}
  if(/\s/.test(char)){if(current){terms.push(current);current=''}continue}
  current+=char;
 }
 if(current)terms.push(current);
 return terms.filter(Boolean);
}

/**
 * تحويل نص البحث إلى معايير صريحة + نص حر.
 * @returns {{raw:string,text:string,tokens:string[],criteria:object,labels:string[],ignoredKeys:string[]}}
 */
export function parseFileQuery(raw=''){
 const source=String(raw||'').trim();
 const criteria={};
 const labels=[];
 const ignoredKeys=[];
 let rest=source.replace(KEY_PATTERN,(full,lead,key,value)=>{
  const canonical=FILE_QUERY_KEYS[normalizeArabic(key)]||FILE_QUERY_KEYS[key];
  if(!canonical){ignoredKeys.push(key);return full}
  const clean=String(value||'').replace(/^["']|["']$/g,'').trim();
  if(!clean)return full;
  criteria[canonical]=clean;
  labels.push(`${FILE_CRITERIA_LABELS[canonical]}: ${clean}`);
  return lead||' ';
 });
 rest=rest.replace(/\s+/g,' ').trim();
 // مفاتيح غير معروفة بصيغة «كلمة: قيمة» تُعلن للمستخدم بدل تجاهلها بصمت.
 for(const match of rest.matchAll(/(^|\s)([\p{L}\p{M}]+)\s*[:：]\s*(\S+)/gu)){
  const key=match[2];
  if(FILE_QUERY_KEYS[normalizeArabic(key)]||FILE_QUERY_KEYS[key])continue;
  if(!ignoredKeys.includes(key))ignoredKeys.push(key);
 }
 const tokens=splitTerms(rest).map(normalizeArabic).filter(Boolean);
 const numberTokens=numberTokensOf(rest);
 return {raw:source,text:rest,tokens,criteria,numberTokens,labels,ignoredKeys};
}

/** هل الملف مطابق لمعيار صريح واحد؟ */
function matchCriterion(file,key,value,ctx){
 const needle=normalizeArabic(normalizeDigits(String(value||''))).trim();
 if(!needle)return true;
 const digitNeedle=normalizeNumberCode(value);
 const has=(haystack)=>normalizeArabic(normalizeDigits(String(haystack||''))).includes(needle);
 if(key==='type')return has(file.fileType)||has(file.mainCategory)||has(file.subCategory)||has(file.typeSnapshot?.type)||has(file.typeSnapshot?.category);
 if(key==='status')return has(file.status)||has(file.archivedReason);
 if(key==='subject')return has(file.title)||has(file.notes);
 if(key==='number'){
  const numbers=[file.fileNumber,file.clientCode,file.caseNumber,file.noticeNumber,file.poaNumber,...(ctx?.numbers||[])]
   .filter(v=>v!==undefined&&v!==null&&v!=='');
  const codes=numbers.map(normalizeNumberCode).filter(Boolean);
  const variants=numberVariants(value);
  return codes.some(code=>variants.includes(code)||code.includes(digitNeedle)||digitNeedle.includes(code))
   ||numbers.some(n=>has(n));
 }
 if(key==='year'){
  const year=normalizeDigits(String(value)).replace(/\D/g,'').slice(0,4);
  if(!year)return true;
  return String(file.fileNumber||'').startsWith(year+'/')
   || `${file.openedAt||''}`.startsWith(year)
   || (ctx?.stages||[]).some(stage=>`${stage.caseYear||''}`===year||`${stage.caseNumber||''}${stage.caseYear?'/'+stage.caseYear:''}`.includes(year));
 }
 if(key==='client'){
  return (ctx?.parties||[]).some(party=>(party.clientId||party.partyKind==='client')&&has(party.name||party.partyName));
 }
 if(key==='opponent'){
  return (ctx?.parties||[]).some(party=>(party.opponentId||party.partyKind==='opponent')&&has(party.name||party.partyName));
 }
 if(key==='stage'){
  return (ctx?.stages||[]).some(stage=>has(stage.stageType)||has(stage.numberType)||has(stage.caseNumber)||has(stage.subject)||has(stage.courtId));
 }
 return true;
}

function fieldValue(file,key){
 const value=file?.[key];
 if(Array.isArray(value))return value.join(' ');
 if(value===null||value===undefined)return '';
 return String(value);
}

const SEARCHABLE_FILE_FIELDS=Object.freeze([
 'fileNumber','title','fileType','mainCategory','subCategory','status','priority',
 'responsibleLawyer','coLawyers','staff','nextStep','closeReason','notes','partyNames'
]);

/** بناء نص بحث موحّد من الملف وسياقه (للأغراض البصرية/الفهرس فقط، لا يُخزَّن). */
export function fileHaystack(file,ctx={}){
 const bits=[];
 for(const key of SEARCHABLE_FILE_FIELDS)bits.push(fieldValue(file,key));
 if(file?.typeSnapshot)bits.push(file.typeSnapshot.type,file.typeSnapshot.category);
 for(const [key,value] of Object.entries(file||{}))if(key.startsWith('x_')&&(typeof value==='string'||typeof value==='number'))bits.push(String(value));
 for(const party of ctx.parties||[])bits.push(party.name,party.partyName,party.role,party.phone);
 for(const stage of ctx.stages||[])bits.push(stage.stageType,stage.numberType,stage.caseNumber,stage.caseYear,stage.subject,stage.courtId,stage.chamber);
 return normalizeArabic(normalizeDigits(bits.filter(Boolean).join(' ')));
}

const SHORT_TOKEN=2;

/**
 * مطابقة ملف بمعايير/نص. ترجع درجة (0 = غير مطابق). المطابقة النهائية للمستخدم،
 * ولا تُعدَّل أي قيمة مخزنة.
 */
export function scoreFile(file,query,ctx={}){
 if(!file)return 0;
 const parsed=typeof query==='string'?parseFileQuery(query):query;
 if(!parsed)return 0;
 const {tokens=[],criteria={},numberTokens=[]}=parsed;
 for(const [key,value] of Object.entries(criteria)){
  if(!matchCriterion(file,key,value,ctx))return 0;
 }
 if(!tokens.length&&!numberTokens.length)return 1;
 const hay=fileHaystack(file,ctx);
 const codeText=normalizeNumberCode([file.fileNumber,file.clientCode,...(ctx.numbers||[])].filter(Boolean).join(' '));
 let score=0;
 const allTokens=[...tokens,...numberTokens.map(t=>normalizeArabic(normalizeDigits(t)))];
 for(const token of allTokens){
  const normalized=normalizeArabic(normalizeDigits(token));
  if(!normalized)continue;
  let tokenScore=0;
  if(normalizeNumberCode(token)){
   const variants=numberVariants(token);
   if(variants.some(v=>codeText===v))tokenScore=140;
   else if(variants.some(v=>codeText&&(codeText.includes(v)||v.includes(codeText))))tokenScore=110;
   else if(hay.includes(normalized))tokenScore=45;
  }else if(normalized.length<=SHORT_TOKEN){
   // الرمز القصير لا يُطابق داخل كلمة أطول (منعًا للمطابقات المضللة).
   const bounded=new RegExp(`(^|\\s)${escapeRegExp(normalized)}(\\s|$)`);
   tokenScore=bounded.test(hay)?55:0;
  }else{
   const index=hay.indexOf(normalized);
   if(index<0)tokenScore=0;
   else if(index===0||hay[index-1]===' ')tokenScore=80;
   else tokenScore=55;
  }
  if(!tokenScore)return 0;
  score+=tokenScore;
 }
 // مكافأة تطابق الاسم/الرقم في الحقول التميّزية.
 const title=normalizeArabic(`${file.title||''} ${file.fileNumber||''}`);
 if(tokens.some(token=>title.includes(normalizeArabic(token))))score+=25;
 return score;
}

/** ترتيب نتائج مطابقة مع الحفاظ على ترتيب المصدر عند التساوي. */
export function rankFiles(rows,query,contextOf=()=>{}){
 return rows.map((row,index)=>({row,index,score:scoreFile(row,query,contextOf(row))}))
  .filter(item=>item.score>0)
  .sort((a,b)=>b.score-a.score||String(b.row.lastActivityAt||b.row.updatedAt||'').localeCompare(String(a.row.lastActivityAt||a.row.updatedAt||''))||a.index-b.index);
}

/** أجزاء النص المطابقة لعرضها (بدون تغيير النص الأصلي). */
export function highlightParts(text,query){
 const original=String(text??'');
 const parsed=typeof query==='string'?parseFileQuery(query):query;
 const terms=[...(parsed?.tokens||[]),parsed?.text||''].filter(Boolean);
 if(!original||!terms.length)return [{text:original,hit:false}];
 const normalized=normalizeArabic(original);
 let ranges=[];
 for(const term of terms){
  const needle=normalizeArabic(term);
  if(needle.length<2)continue;
  let from=0;
  while(from<normalized.length){
   const at=normalized.indexOf(needle,from);
   if(at<0)break;
   ranges.push([at,at+needle.length]);
   from=at+needle.length;
  }
 }
 if(!ranges.length)return [{text:original,hit:false}];
 ranges.sort((a,b)=>a[0]-b[0]);
 const merged=[];
 for(const range of ranges){
  const last=merged[merged.length-1];
  if(last&&range[0]<=last[1])last[1]=Math.max(last[1],range[1]);
  else merged.push([...range]);
 }
 const out=[];
 let at=0;
 for(const [start,end] of merged){
  if(start>at)out.push({text:original.slice(at,start),hit:false});
  out.push({text:original.slice(start,end),hit:true});
  at=end;
 }
 if(at<original.length)out.push({text:original.slice(at),hit:false});
 return out;
}

/** مقتطف حول أول تطابق في نص طويل (حدود انضباطية للعرض فقط). */
export function matchExcerpt(text,query,{radius=70}={}){
 const original=String(text??'');
 const parsed=typeof query==='string'?parseFileQuery(query):query;
 const needle=(parsed?.tokens||[]).find(token=>normalizeArabic(original).includes(normalizeArabic(token)));
 if(!needle)return null;
 const normalized=normalizeArabic(original);
 const at=normalized.indexOf(normalizeArabic(needle));
 if(at<0)return null;
 const start=Math.max(0,at-radius);
 const end=Math.min(original.length,at+needle.length+radius);
 return {text:`${start>0?'…':''}${original.slice(start,end)}${end<original.length?'…':''}`,start,needle};
}

/** حالة الملف الإدارية — دلالة عرض فقط، وليست حكمًا قانونيًا. */
export function administrativeState(file){
 if(!file)return 'unknown';
 if(file.isDeleted)return 'deleted';
 if(file.isArchived)return 'archived';
 const status=String(file.status||'');
 if(/منته|مغلق|closed/i.test(status))return 'closed';
 return 'open';
}
