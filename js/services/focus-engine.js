// =====================================================================
// محرّك التركيز — «ما الذي يحتاج انتباهي؟» و«ما الذي يجب فعله الآن؟»
// ---------------------------------------------------------------------
// دالة نقيّة (Pure) لا تقرأ قاعدة البيانات ولا تكتب فيها: تأخذ لقطة
// dashboardBrief() الموجودة أصلًا، وتعيد ترتيبًا واحدًا موحّدًا لكل ما يحتاج
// قرارًا من المحامي: جلسات، أعمال متأخرة، توكيلات، مواعيد، متابعات، ملفات راكدة.
//
// الخرج:
//   next      → الخطوة التالية المقترحة (أقرب جلسة قادمة اليوم، ثم أعلى عنصر عاجل)
//   attention → كل العناصر مرتبة: الأشد خطرًا أولًا، ثم الأقرب زمنيًا
//   timeline  → جدول اليوم بالترتيب الزمني (مع علامة «مضى» للأوقات السابقة للآن)
//   counts    → عدّادات الشدة لعرض الملخص وفلاتر الطابور
// =====================================================================
import {formatFileNumber} from '../core/file-number.js';
import {addDays} from '../core/clock.js';

/** درجات الشدة: الترتيب يعتمد على rank، والعرض على label/tone. */
export const SEVERITY={
 critical:{rank:4,label:'عاجل',tone:'danger'},
 high:{rank:3,label:'مهم',tone:'warn'},
 normal:{rank:2,label:'قادم',tone:'info'},
 info:{rank:1,label:'للمراجعة',tone:''}
};

const dayOf=v=>String(v||'').slice(0,10);
const timeOf=v=>/^\d{1,2}:\d{2}/.test(String(v||''))?String(v).slice(0,5).padStart(5,'0'):'';

/** مفتاح ترتيب زمني: التاريخ ثم الوقت (الفاقد للوقت يأتي بعد أوقات اليوم). */
const sortKey=(date,time)=>`${dayOf(date)||'9999-99-99'}T${time||'99:99'}`;

function item(o){
 return {
  id:o.id,kind:o.kind,severity:o.severity,
  title:o.title||'',meta:o.meta||'',
  date:dayOf(o.date),time:o.time||'',
  when:o.when||'',
  route:o.route,actionLabel:o.actionLabel||'فتح',
  sort:sortKey(o.date,o.time),
  daysLeft:o.daysLeft??null
 };
}

/**
 * @param {object} brief  لقطة dashboardBrief()
 * @param {{today:string, now?:string}} ctx  today = YYYY-MM-DD، now = HH:MM
 */
export function buildFocusModel(brief,{today,now=''}={}){
 const b=brief||{};
 const items=[];
 const add=o=>items.push(item(o));

 // ---- الجلسات
 for(const h of b.todayHearings||[]){
  const t=timeOf(h.hearingTime);
  add({id:`h:${h.id}`,kind:'hearing',severity:'critical',date:today,time:t,
   title:h.reason||h.type||'جلسة',
   meta:h.caseNumber?`قضية ${h.caseNumber}`:'',
   when:t?`اليوم ${t}`:'اليوم — بدون وقت',
   route:`rec:hearings:${h.id}`,actionLabel:'فتح الجلسة',daysLeft:0});
 }
 for(const h of b.upcomingHearings||[]){
  const d=dayOf(h.hearingDate);
  if(!d||d===today)continue; // اليوم تم أخذه أعلاه
  const isTomorrow=d===addDays(today,1);
  add({id:`h:${h.id}`,kind:'hearing',severity:isTomorrow?'high':'normal',date:d,time:timeOf(h.hearingTime),
   title:h.reason||h.type||'جلسة',
   meta:h.caseNumber?`قضية ${h.caseNumber}`:'',
   when:isTomorrow?`غدًا${timeOf(h.hearingTime)?' '+timeOf(h.hearingTime):''}`:formatDayShort(d),
   route:`rec:hearings:${h.id}`,actionLabel:'فتح الجلسة',daysLeft:diffDays(today,d)});
 }

 // ---- الأعمال الإدارية
 for(const p of b.overdueProcedures||[]){
  const urgent=['urgent','critical','عاجل'].includes(String(p.priority||'').toLowerCase());
  add({id:`p:${p.id}`,kind:'procedure',severity:urgent?'critical':'high',date:p.internalDueDate,
   title:p.description||p.type||'عمل إداري',
   meta:'متأخر عن موعده الداخلي',
   when:`كان موعده ${dayOf(p.internalDueDate)}`,
   route:`rec:procedures:${p.id}`,actionLabel:'تنفيذ',daysLeft:diffDays(today,p.internalDueDate)});
 }
 for(const p of b.upcomingProcedures||[]){
  add({id:`p:${p.id}`,kind:'procedure',severity:'normal',date:p.internalDueDate,
   title:p.description||p.type||'عمل إداري',
   meta:p.type&&p.description?p.type:'',
   when:formatDayShort(p.internalDueDate),
   route:`rec:procedures:${p.id}`,actionLabel:'تنفيذ',daysLeft:diffDays(today,p.internalDueDate)});
 }

 // ---- التوكيلات
 for(const p of b.expiredPoa||[]){
  add({id:`a:${p.id}`,kind:'poa',severity:'critical',date:p.expiryDate,
   title:`توكيل ${p.poaNumber||'—'}${p.clientName?' — '+p.clientName:''}`,
   meta:'منتهٍ — لا تُقام به جلسة قبل التجديد',
   when:`انتهى ${dayOf(p.expiryDate)}`,
   route:`rec:powersOfAttorney:${p.id}`,actionLabel:'فتح التوكيل',daysLeft:diffDays(today,p.expiryDate)});
 }
 for(const p of b.expiringPoa||[]){
  const left=diffDays(today,p.expiryDate);
  add({id:`a:${p.id}`,kind:'poa',severity:left!==null&&left<=7?'critical':'high',date:p.expiryDate,
   title:`توكيل ${p.poaNumber||'—'}${p.clientName?' — '+p.clientName:''}`,
   meta:'يحتاج تجديدًا',
   when:left===0?'ينتهي اليوم':`ينتهي خلال ${left} يوم`,
   route:`rec:powersOfAttorney:${p.id}`,actionLabel:'فتح التوكيل',daysLeft:left});
 }

 // ---- المواعيد والمتابعات
 for(const a of b.appointmentsNext3||[]){
  const d=dayOf(a.date);
  const isToday=d===today;
  add({id:`ap:${a.id}`,kind:'appointment',severity:isToday?'high':'normal',date:d,time:timeOf(a.time),
   title:a.title||'موعد',
   meta:a.location||a.withWhom||'',
   when:isToday?`اليوم${timeOf(a.time)?' '+timeOf(a.time):''}`:formatDayShort(d),
   route:`rec:appointments:${a.id}`,actionLabel:'فتح الموعد',daysLeft:diffDays(today,d)});
 }
 for(const c of b.followupsThisWeek||[]){
  const d=dayOf(c.followUpDate);
  const isToday=d===today;
  add({id:`c:${c.id}`,kind:'followup',severity:isToday?'high':'normal',date:d,
   title:c.subject||'متابعة اتصال',
   meta:c.contactName||'',
   when:isToday?'متابعة اليوم':formatDayShort(d),
   route:`rec:communications:${c.id}`,actionLabel:'فتح المتابعة',daysLeft:diffDays(today,d)});
 }

 // ---- ملفات راكدة (للمراجعة فقط)
 for(const f of b.staleFiles||[]){
  add({id:`f:${f.id}`,kind:'file',severity:'info',date:dayOf(f.lastActivityAt),
   title:`${formatFileNumber(f.fileNumber)||'ملف'} — ${f.title||'بدون عنوان'}`.trim(),
   meta:'لا نشاط منذ أكثر من ٣٠ يومًا',
   when:'راكد',
   route:`file:${f.id}`,actionLabel:'مراجعة الملف',daysLeft:null});
 }

 const attention=items.slice().sort((a,b)=>
  (SEVERITY[b.severity].rank-SEVERITY[a.severity].rank)||
  (a.sort<b.sort?-1:a.sort>b.sort?1:0));

 // ---- جدول اليوم: حصراً ما يقع اليوم
 const timeline=items
  .filter(x=>x.date===today&&(x.kind==='hearing'||x.kind==='appointment'||x.kind==='followup'))
  .sort((a,b)=>(a.time||'99:99').localeCompare(b.time||'99:99'))
  .map(x=>({...x,past:Boolean(x.time&&now&&x.time<now)}));

 // ---- الخطوة التالية: أقرب جلسة لم تمضِ اليوم، وإلا أعلى عنصر عاجل/مهم
 const nextHearing=timeline.find(x=>x.kind==='hearing'&&!x.past);
 const nextUrgent=attention.find(x=>x.severity==='critical'||x.severity==='high');
 const next=nextHearing||nextUrgent||null;

 const counts={critical:0,high:0,normal:0,info:0};
 for(const x of items)counts[x.severity]++;

 return {next,attention,timeline,counts,total:items.length};
}

function diffDays(from,to){
 const a=dayOf(from),b=dayOf(to);
 if(!a||!b)return null;
 return Math.round((new Date(b+'T00:00:00')-new Date(a+'T00:00:00'))/86400000);
}

function formatDayShort(d){
 const v=dayOf(d);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(v))return '';
 const [y,m,day]=v.split('-');
 return `${day}/${m}/${y}`;
}
