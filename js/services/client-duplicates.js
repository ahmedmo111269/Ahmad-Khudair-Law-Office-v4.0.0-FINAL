// كشف مرشحي تكرار الموكلين بقراءات مفهرسة محدودة؛ لا يكتب شيئًا ولا يقرر بدل المستخدم.
import {normalizeArabic,normalizeDigits} from '../core/search-normalizer.js';
const clampLimit=value=>Math.max(1,Math.min(20,Number(value)||6));
const tokensOf=value=>normalizeArabic(value).split(/\s+/).filter(Boolean);

function editSimilarity(a,b){
 const aa=Array.from(a),bb=Array.from(b);
 if(!aa.length||!bb.length)return 0;
 if(aa.length>80||bb.length>80)return 0;
 let previous=Array.from({length:bb.length+1},(_,i)=>i);
 for(let i=1;i<=aa.length;i++){
  const current=[i];
  for(let j=1;j<=bb.length;j++)current[j]=Math.min(current[j-1]+1,previous[j]+1,previous[j-1]+(aa[i-1]===bb[j-1]?0:1));
  previous=current;
 }
 return 1-previous[bb.length]/Math.max(aa.length,bb.length);
}
function tokenSimilarity(a,b){
 const left=tokensOf(a),right=tokensOf(b);
 if(!left.length||!right.length)return 0;
 const rightSet=new Set(right);
 const common=new Set(left.filter(token=>rightSet.has(token)));
 return common.size/(new Set([...left,...right]).size||1);
}
function nameScore(query,row){
 const candidate=normalizeArabic(row.fullNameNormalized||row.fullName||'');
 if(!query||!candidate)return 0;
 if(query===candidate)return 1;
 return Math.max(editSimilarity(query,candidate),tokenSimilarity(query,candidate));
}

/**
 * Find likely duplicates for a new client. National-ID matches are exact; name matches are suggestions.
 * Queries are bounded index lookups (one exact key and at most two short name prefixes).
 */
export async function findPotentialClientDuplicates(office,{fullName='',nationalId='',excludeId='',limit=6}={}){
 const max=clampLimit(limit),name=normalizeArabic(fullName),idNumber=normalizeDigits(nationalId).replace(/\D/g,'');
 const candidates=new Map();
 const add=rows=>{for(const row of rows||[])if(row&&!row.isDeleted&&row.id!==excludeId)candidates.set(row.id,row)};
 if(idNumber.length>=4){
  try{add(await office.r.clients.byIndex('nationalId',idNumber,Math.max(25,max*4)))}catch{}
 }
 const nameTokens=tokensOf(name);
 const probes=[...new Set([nameTokens[0],nameTokens.length>1?nameTokens.at(-1):''].filter(token=>token?.length>=3))].slice(0,2);
 for(const token of probes){
  try{add(await office.r.clients.prefix('fullNameNormalized',token.slice(0,Math.min(token.length,4)),Math.max(20,max*4)))}catch{}
 }
 const rows=[];
 for(const row of candidates.values()){
  const nationalIdMatch=Boolean(idNumber&&normalizeDigits(row.nationalId||'').replace(/\D/g,'')===idNumber);
  const normalizedRow=normalizeArabic(row.fullNameNormalized||row.fullName||'');
  const exactName=Boolean(name&&normalizedRow===name);
  const score=nameScore(name,row);
  if(!nationalIdMatch&&!exactName&&(!name||score<(nameTokens.length===1?.82:.62)))continue;
  const reason=nationalIdMatch?'الرقم القومي مطابق':exactName?'الاسم مطابق بعد التطبيع':'اسم مشابه — راجع السجل قبل المتابعة';
  rows.push({id:row.id,fullName:row.fullName||'',clientCode:row.clientCode||'',nationalIdSuffix:normalizeDigits(row.nationalId||'').slice(-4),score,nationalIdMatch,exactName,reason});
 }
 rows.sort((a,b)=>Number(b.nationalIdMatch)-Number(a.nationalIdMatch)||Number(b.exactName)-Number(a.exactName)||b.score-a.score||a.fullName.localeCompare(b.fullName,'ar'));
 return rows.slice(0,max);
}

export function clientDuplicateKey({fullName='',nationalId=''}={}){
 return `${normalizeArabic(fullName)}|${normalizeDigits(nationalId).replace(/\D/g,'')}`;
}
