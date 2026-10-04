// ============================================================
// محرك البحث المركزي للبرنامج بالكامل (v4.7)
// نقطة واحدة تبحث في كل مخازن البيانات: موكلون، ملفات، قضايا، خصوم، جلسات،
// أعمال، مواعيد، اتصالات، ملاحظات، أحكام، خبراء، تنفيذ، أتعاب، دفعات، مستندات،
// توكيلات، إعلانات، محضرون، وأطراف الملفات (فائدة: البحث باسم أي طرف يقود للملف).
//
// مبادئ الأداء:
// - لا getAll ولا تحميل مخازن كاملة أبدًا: قراءة cursor محدودة بحد لكل قسم مع توقف مبكر.
// - مسارات سريعة بالفهارس للأرقام والأكواد (CL-/LF-/الرقم القومي/رقم القضية/الرقم الداخلي)
//   قبل اللجوء للمسح الاحتوائي.
// - البحث متعدد الكلمات = كل الكلمات موجودة (AND) مع تطبيع عربي مرن (أ/إ/آ، ة/ه، ى/ي، الأرقام).
// - rowText مذكّرة لكل صف (WeakMap) فلا يعاد تطبيع الصف نفسه مع كل ضغطة مفتاح.
// ============================================================
import {normalizeArabic,normalizeDigits} from '../core/search-normalizer.js';
import {ENTITIES} from '../domain/entities.js';
import {rowText} from './entity-query.js';
import {prefs} from '../core/preferences.js';
import {formatFileNumber as fileNumber} from '../core/file-number.js';
import {parseQuickNoteQuery, matchesQuickNoteQuery} from './quick-notes.js';

// ===== 1) منطق صافٍ قابل للاختبار =====
export function tokenizeQuery(q){
 return String(q||'').trim().split(/[\s،,;؛+]+/).map(t=>normalizeArabic(normalizeDigits(t))).filter(Boolean).slice(0,8);
}
export function normalizeCodeToken(t){return normalizeDigits(String(t)).toUpperCase().replace(/[\s-]+/g,'')}
/** هل اللفظ يشبه كودًا داخليًا CL-… أو LF-… ؟ */
export function looksLikeCode(t){const c=normalizeCodeToken(t);return /^(CL|LF)\d/.test(c)}
/** هل اللفظ رقمي خالص بطول يصلح للبحث بالفهارس (٣+ أرقام)؟ */
export function looksLikeNumber(t){return /^\d{3,}$/.test(normalizeDigits(String(t)).replace(/\D/g,''))}
/** صيغة الكود القياسية: CL2026001 → CL-2026001 */
export function codeValue(t){const c=normalizeCodeToken(t);const m=/^(CL|LF)(\d.+)$/.exec(c);return m?`${m[1]}-${m[2]}`:c}
export function digitsOf(t){return normalizeDigits(String(t)).replace(/\D/g,'')}
/** كل الكلمات موجودة في النص (AND) */
export function matchTokens(tokens,hay){const h=String(hay||'');return tokens.every(t=>h.includes(t))}
/** ترتيب أهمية النتيجة داخل مجموعتها */
export function scoreHit({title='',sub='',viaCode=false,tokens=[]}){
 const t=normalizeArabic(title),s=normalizeArabic(sub||'');
 if(viaCode)return 100;
 if(tokens.length&&t.startsWith(tokens[0]))return 80;
 if(tokens.every(x=>t.includes(x)))return 60;
 if(tokens.every(x=>s.includes(x)||t.includes(x)))return 45;
 return 30;
}

// ===== 2) أقسام البحث =====
const fdate=v=>String(v||'').slice(0,10);
export const SEARCH_SOURCES=[
 {store:'clients',icon:'users',weight:100,title:r=>r.fullName||'موكل',sub:r=>[r.clientCode&&`ملف رئيسي: ${fileNumber(r.clientCode)}`,r.nationalId&&(r.nationalId),(Array.isArray(r.phones)?r.phones[0]:r.phone)||''].filter(Boolean).join(' · ')},
 {store:'files',icon:'folder',weight:95,title:r=>`${fileNumber(r.fileNumber)} ${r.title||''}`.trim()||'ملف',sub:r=>[r.fileType,r.status,r.responsibleLawyer].filter(Boolean).join(' · ')},
 {store:'cases',icon:'gavel',weight:90,title:r=>`${r.stageType||r.numberType||'مرحلة'} ${r.caseNumber||''}${r.caseYear?'/'+r.caseYear:''}`.trim(),sub:r=>[r.courtId,r.chamber,r.degree,r.status].filter(Boolean).join(' · ')},
 {store:'opponents',icon:'userX',weight:85,title:r=>r.name||'خصم',sub:r=>[r.capacity,r.nationalId].filter(Boolean).join(' · ')},
 {store:'hearings',icon:'calendar',weight:80,title:r=>`جلسة ${fdate(r.hearingDate)}${r.hearingTime?' '+r.hearingTime:''}`,sub:r=>[r.court,r.chamber,r.reason,r.result].filter(Boolean).join(' · ')},
 {store:'procedures',icon:'clipboard',weight:75,title:r=>r.description||r.type||'عمل إداري',sub:r=>[r.type,r.internalDueDate&&('استحقاق '+fdate(r.internalDueDate)),r.status].filter(Boolean).join(' · ')},
 {store:'workItems',icon:'clipboard',weight:77,title:r=>r.title||'مهمة',sub:r=>[r.type,r.dueDate&&('موعد '+fdate(r.dueDate)),r.status].filter(Boolean).join(' · '),extra:r=>r.kind==='native',routeOf:r=>`actionCenter?item=${encodeURIComponent(r.id)}`,note:'المهام'},
 {store:'serviceRecords',icon:'stamp',weight:70,title:r=>`${r.internalNumber||r.noticeNumber||'إعلان'} ${r.partyName||''}`.trim(),sub:r=>[r.actionType,r.status,r.serviceDate&&fdate(r.serviceDate)].filter(Boolean).join(' · '),extra:r=>r.recordState!=='deleted'},
 {store:'fileParties',icon:'users',weight:65,title:r=>r.partyName||r.name||'طرف',sub:r=>[r.role,r.roleGroup].filter(Boolean).join(' · '),routeOf:r=>r.fileId?`file:${r.fileId}`:r.clientId?`client:${r.clientId}`:r.opponentId?`opponent:${r.opponentId}`:'',note:'الأطراف'},
 {store:'judgments',icon:'landmark',weight:60,title:r=>`حكم ${fdate(r.judgmentDate)}${r.judgmentNumber?' '+(r.judgmentNumber):''}`.trim(),sub:r=>[r.judgmentType,r.court,r.judgmentStatus].filter(Boolean).join(' · ')},
 {store:'fees',icon:'wallet',weight:55,title:r=>`أتعاب ${r.agreedAmount??''} ${r.currency||''}`.trim(),sub:r=>[r.status,r.createdAt&&fdate(r.createdAt)].filter(Boolean).join(' · ')},
 {store:'feePayments',icon:'wallet',weight:50,title:r=>`دفعة ${r.amount??''}`,sub:r=>[r.method,r.date&&fdate(r.date)].filter(Boolean).join(' · ')},
 {store:'appointments',icon:'clock',weight:48,title:r=>r.title||'موعد',sub:r=>[fdate(r.date),r.time,r.location].filter(Boolean).join(' · ')},
 {store:'communications',icon:'phone',weight:46,title:r=>r.subject||'اتصال',sub:r=>[fdate(r.date),r.channel,r.contactName].filter(Boolean).join(' · ')},
 {store:'caseNotes',icon:'note',weight:82,label:'الملاحظات السريعة',title:r=>r.title||String(r.content||'ملاحظة').slice(0,60),sub:r=>[r.noteType||r.category,r.priority,r.dueAt&&('استحقاق '+fdate(r.dueAt)),r.createdAt&&fdate(r.createdAt)].filter(Boolean).join(' · '),routeOf:r=>`quickNotes?note=${encodeURIComponent(r.id)}`,note:'الملاحظات السريعة'},
 {store:'expertReports',icon:'microscope',weight:42,title:r=>r.expertName||'تقرير خبير',sub:r=>[fdate(r.reportDate),r.expertOffice].filter(Boolean).join(' · ')},
 {store:'execution',icon:'hammer',weight:40,title:r=>`تنفيذ ${r.executionNumber||''}`.trim()||'تنفيذ',sub:r=>[r.status,fdate(r.openedDate)].filter(Boolean).join(' · ')},
 {store:'powersOfAttorney',icon:'stamp',weight:38,title:r=>`توكيل ${r.poaNumber||''}`.trim()||'توكيل',sub:r=>[r.status,fdate(r.issuedDate)].filter(Boolean).join(' · ')},
 {store:'documentReferences',icon:'file',weight:36,title:r=>r.title||'مستند',sub:r=>[fdate(r.date),r.physicalLocation].filter(Boolean).join(' · ')},
 {store:'bailiffs',icon:'scale',weight:34,title:r=>r.name||'محضر',sub:r=>[r.court,r.phone].filter(Boolean).join(' · ')},
 // ===== قسم التنفيذ: نتائج فرعية تفتح صفحة التنفيذ ذاتها =====
 {store:'executionReceipts',icon:'wallet',weight:33,title:r=>`محضر تحصيل ${r.receiptNumber||''}`.trim()||'محضر تحصيل',sub:r=>[r.amount,r.date&&fdate(r.date),r.collectorName].filter(Boolean).join(' · '),routeOf:r=>r.executionId?`exc:${r.executionId}`:'',note:'محاضر التحصيل'},
 {store:'executionPOAs',icon:'stamp',weight:32,title:r=>`توكيل تنفيذ ${r.poaNumber||''}`.trim()||'توكيل تنفيذ',sub:r=>[r.total,r.date&&fdate(r.date)].filter(Boolean).join(' · '),routeOf:r=>r.executionId?`exc:${r.executionId}`:'',note:'توكيلات التنفيذ'},
 {store:'executionActions',icon:'hammer',weight:31,title:r=>`${r.kindLabel||r.kind||'إجراء تنفيذ'} ${r.referenceNumber||''}`.trim(),sub:r=>[fdate(r.date),r.authority,r.status].filter(Boolean).join(' · '),routeOf:r=>r.executionId?`exc:${r.executionId}`:'',note:'إجراءات التنفيذ'},
 {store:'executionParties',icon:'users',weight:30,title:r=>r.name||'طرف تنفيذ',sub:r=>[r.side==='debtor'?'منفذ ضده':'مستحق',r.role].filter(Boolean).join(' · '),routeOf:r=>r.executionId?`exc:${r.executionId}`:'',note:'أطراف التنفيذ'},
 {store:'executionValuePeriods',icon:'chart',weight:29,title:r=>`شريحة قيمة: ${r.amount||''} ${r.entitlementType||''}`.trim(),sub:r=>[r.valueType==='fixed'?'ثابت':'دوري',r.periodicity,r.startDate&&fdate(r.startDate)].filter(Boolean).join(' · '),routeOf:r=>r.executionId?`exc:${r.executionId}`:'',note:'شرائح القيمة'},
 {store:'executionObligations',icon:'chart',weight:28,title:r=>`التزام FEAS: ${r.obligationType||''}`.trim(),sub:r=>[r.frequency,r.currency,r.status].filter(Boolean).join(' · '),routeOf:r=>r.executionId?`exc:${r.executionId}`:'',note:'التزامات FEAS'},
 {store:'executionPeriods',icon:'calendar',weight:27,title:r=>`فترة معترف بها ${r.periodKey||''}`.trim(),sub:r=>[r.obligationTypeSnapshot,r.fromDate&&fdate(r.fromDate),r.toDate&&fdate(r.toDate),r.status].filter(Boolean).join(' · '),routeOf:r=>r.executionId?`exc:${r.executionId}`:'',note:'فترات FEAS المعترف بها'},
 {store:'differenceRecords',icon:'scale',weight:26,title:r=>`فرق استحقاق ${r.periodKey||''}`.trim(),sub:r=>[r.oldValue&&('قديم '+r.oldValue),r.newValue&&('جديد '+r.newValue),r.status].filter(Boolean).join(' · '),routeOf:r=>r.executionId?`exc:${r.executionId}`:'',note:'فروق الاستحقاق'}
];
export const PRIMARY_STORES=['clients','files','cases','opponents','hearings','procedures'];
export const allSearchStores=()=>SEARCH_SOURCES.map(s=>s.store);
const SRC=Object.fromEntries(SEARCH_SOURCES.map(s=>[s.store,s]));

// فهارس المسار السريع لكل مخزن: [index, kind] — kind: code|digits|text
const FAST_INDEXES={
 clients:[['clientCode','code'],['nationalId','digits'],['fullNameNormalized','text']],
 files:[['fileNumber','code'],['fileNumber','digits'],['titleNormalized','text']],
 cases:[['caseNumber','digits'],['subjectNormalized','text']],
 opponents:[['nameNormalized','text']],
 serviceRecords:[['internalNumber','digits']],
 powersOfAttorney:[['poaNumber','digits']],
 execution:[['searchTextNormalized','text']],
 executionObligations:[['obligationType','text']],
 executionPeriods:[['periodKey','text']],
 executionReceipts:[['receiptNumber','digits']],
 executionPOAs:[['poaNumber','digits']]
};
const numberishFields={clients:['nationalId','phone','clientCode'],files:['fileNumber'],cases:['caseNumber','caseYear'],opponents:['nationalId'],serviceRecords:['internalNumber','noticeNumber'],powersOfAttorney:['poaNumber'],judgments:['judgmentNumber','lawsuitNumber','appealNumber'],execution:['executionNumber','officialNumber','internalNumber'],feePayments:['receiptNumber'],documentReferences:['referenceNumber'],executionReceipts:['receiptNumber'],executionPOAs:['poaNumber'],executionActions:['referenceNumber','judicialNumber','petitionNumber'],differenceRecords:['periodKey'],executionObligations:['obligationType','description'],executionPeriods:['periodKey','obligationTypeSnapshot','fromDate','toDate']};

function rowMatches(src,r,tokens,code,numDigits){
 if(src.extra&&!src.extra(r))return false;
 if(r.isDeleted)return false;
 // كود صريح: تطابق بادئة على الحقول الرقمية/الكودية يكفي
 if(code){const cv=codeValue(code);const c2=normalizeCodeToken(cv);
  for(const k of numberishFields[src.store]||[]){const v=normalizeCodeToken(r[k]||'');if(v&&(v.startsWith(c2)||c2.startsWith(v)))return true}}
 if(numDigits.length>=4){for(const k of numberishFields[src.store]||[]){const v=normalizeCodeToken(r[k]||'');if(v&&v.includes(numDigits))return true}}
 if(!tokens.length)return Boolean(code||numDigits);
 return matchTokens(tokens,rowText(r));
}

async function prefixFast(office,store,tokens,code,numDigits,limit){
 const specs=FAST_INDEXES[store];if(!specs)return new Map();
 const out=new Map();
 for(const [idx,kind] of specs){
  let q='';
  if(kind==='code'&&code)q=codeValue(code);
  else if(kind==='digits'&&(numDigits||code))q=numDigits||digitsOf(code);
  else if(kind==='text'&&tokens.length)q=tokens[0];
  if(!q)continue;
  try{
   for(const r of await office.r[store].prefix(idx,q,limit)){
    if(rowMatches(SRC[store],r,tokens,code,numDigits))out.set(r.id,r);
   }
  }catch{/* فهرس غير متاح في بيانات قديمة: نتجاهل ونكمل */}
 }
 return out;
}

/** مسح محدود بتوقف مبكر: يكفي أن تكتمل النتائج ليتوقف المؤشر */
function boundedScan(office,store,{tokens,code,numDigits,limit,predicate=null}){
 const src=SRC[store];
 const tx=office.ctx.db.transaction(store,'readonly');
 const os=tx.objectStore(store);
 return new Promise((resolve,reject)=>{
  const hits=[];let stopped=false;
  const c=os.openCursor(null,'prev');
  c.onerror=()=>reject(c.error);
  c.onsuccess=()=>{
   const cur=c.result;
   if(!cur||hits.length>=limit){if(cur)stopped=true;resolve({hits,stopped});return}
   const r=cur.value;
   if((predicate ? predicate(r) : rowMatches(src,r,tokens,code,numDigits)))hits.push(r);
   cur.continue();
  };
 });
}

/**
 * بحث قسم واحد: مسار سريع بالفهارس + مسح احتوائي محدود، دمج وإزالة تكرار.
 * يرجع {items, more}
 */
export async function searchStore(office,store,raw,{limit=8}={}){
 const src=SRC[store];if(!src||!office?.r?.[store])return {items:[],more:false};
 const parsedNotes = store === 'caseNotes' ? parseQuickNoteQuery(raw) : null;
 const tokens=parsedNotes ? tokenizeQuery(parsedNotes.text.join(' ')) : tokenizeQuery(raw);
 const code=tokens.map(t=>looksLikeCode(t)?t:'').filter(Boolean)[0]||'';
 const numDigits=digitsOf(tokens.find(t=>looksLikeNumber(t))||'');
 if(!tokens.length&&!code&&!numDigits&&!(parsedNotes&&(parsedNotes.states.size||parsedNotes.tag||parsedNotes.file||parsedNotes.client||parsedNotes.priority||parsedNotes.color||parsedNotes.type)))return {items:[],more:false};
 const ent=ENTITIES[store]||{};
 let prefixMap=new Map(),scanHits=[],stopped=false,scanError=false;
 try{prefixMap=await prefixFast(office,store,tokens,code,numDigits,limit);if(parsedNotes)prefixMap=new Map([...prefixMap].filter(([,row])=>matchesQuickNoteQuery(row,parsedNotes)))}catch{}
 try{const r=await boundedScan(office,store,{tokens,code,numDigits,limit,predicate:parsedNotes?row=>matchesQuickNoteQuery(row,parsedNotes):null});scanHits=r.hits;stopped=r.stopped}catch{scanError=true}
 // دمج: نتائج الفهارس أولًا (أعلى ترتيبًا) ثم المسح، مع إزالة التكرار
 const merged=[...new Map([...prefixMap,...scanHits.map(r=>[r.id,r])]).values()].slice(0,limit);
 const items=merged.map(r=>{
  const viaCode=Boolean(code||numDigits)&&[...(numberishFields[store]||[])].some(k=>{const v=normalizeCodeToken(r[k]||'');if(!v)return false;const cv=code?normalizeCodeToken(codeValue(code)):'';return (cv&&(v.startsWith(cv)||cv.startsWith(v)))||(numDigits.length>=4&&v.includes(numDigits))});
  const title=src.title(r)||ent.title?.(r)||'';
  return {id:r.id,row:r,store,icon:src.icon,route:src.routeOf?src.routeOf(r):`${ent.route||'rec:'+store}:${r.id}`,title,sub:src.sub?src.sub(r):'',score:scoreHit({title,sub:src.sub?src.sub(r):'',viaCode,tokens})};
 }).sort((a,b)=>b.score-a.score);
 return {items,more:stopped||scanError?stopped:false,partial:scanError};
}

/**
 * البحث الشامل في كل الأقسام (أو مجموعة محددة).
 * يرجع مجموعات مرتبة حسب الأهمية وعدد النتائج.
 */
export async function searchAll(office,raw,{stores=allSearchStores(),perStore=8}={}){
 const t0=(typeof performance!=='undefined'&&performance.now?performance.now():Date.now());
 const list=stores.filter(s=>SRC[s]);
 const results=await Promise.all(list.map(async store=>{
  try{return {store,...await searchStore(office,store,raw,{limit:perStore})}}
  catch{return {store,items:[],more:false,partial:true}}
 }));
 const groups=results.filter(r=>r.items.length)
  .map(r=>{const src=SRC[r.store];return {store:r.store,label:SRC[r.store].label||ENTITIES[r.store]?.plural||r.store,icon:src.icon,note:src.note||'',items:r.items,more:r.more,partial:r.partial}})
  .sort((a,b)=>(SRC[b.store].weight-SRC[a.store].weight)||(b.items.length-a.items.length));
 const t1=(typeof performance!=='undefined'&&performance.now?performance.now():Date.now());
 return {groups,total:groups.reduce((n,g)=>n+g.items.length,0),tookMs:Math.round(t1-t0),partial:groups.some(g=>g.partial)};
}

// ===== 3) عمليات بحث محفوظة وسجل بحث (في تفضيلات المستخدم) =====
const HKEY='ui:search-history',SKEY='ui:search-saved';
const HCAP=8,SCAP=20;
export function getHistory(){const v=prefs.get(HKEY,[]);return Array.isArray(v)?v:[]}
export function pushHistory(q){
 const s=String(q||'').trim();if(s.length<2)return getHistory();
 let h=getHistory().filter(x=>x.q!==s);
 h.unshift({q:s,at:new Date().toISOString()});
 h=h.slice(0,HCAP);prefs.set(HKEY,h);return h;
}
export function clearHistory(){prefs.set(HKEY,[])}
export function getSavedSearches(){const v=prefs.get(SKEY,[]);return Array.isArray(v)?v:[]}
export function saveSearch(name,q){
 const s=String(q||'').trim();if(s.length<2)return getSavedSearches();
 const nm=String(name||'').trim()||s;
 let sv=getSavedSearches().filter(x=>x.name!==nm);
 sv.unshift({name:nm,q:s,at:new Date().toISOString()});
 sv=sv.slice(0,SCAP);prefs.set(SKEY,sv);return sv;
}
export function removeSavedSearch(name){const sv=getSavedSearches().filter(x=>x.name!==name);prefs.set(SKEY,sv);return sv}
/** للاختبار */
export function _resetSearchPrefs(){prefs.set(HKEY,[]);prefs.set(SKEY,[])}
