// =====================================================================
// محرّك التركيز — «ما الذي يحتاج انتباهي؟» و«ما الذي يجب فعله الآن؟»
// ---------------------------------------------------------------------
// دالة نقيّة (Pure) لا تقرأ قاعدة البيانات ولا تكتب فيها: تأخذ لقطة
// dashboardBrief() الموجودة أصلًا، وتعيد ترتيبًا واحدًا موحّدًا لكل ما يحتاج
// قرارًا من المحامي: جلسات، أعمال متأخرة، توكيلات، مواعيد، متابعات، ملفات راكدة.
//
// الخرج:
//   next      → الخطوة التالية المقترحة (أقرب جلسة قادمة اليوم لم تُسجَّل، ثم أعلى عنصر عاجل/مهم)
//   attention → العناصر غير المنجزة مرتبة: الأشد خطرًا أولًا، ثم الأقرب زمنيًا
//   timeline  → جدول اليوم بالترتيب الزمني (مع «مضى» و«مُسجَّل» و«تعارض»)
//   counts    → عدّادات الشدة لعرض الملخص وفلاتر الطابور
//   conflicts → تعارضات صريحة: عنصران أو أكثر بنفس وقت البداية اليوم
//
// كل عنصر يحمل:
//   reasonCode / reasonParams → سبب الظهور (مشتق من بيانات موجودة فقط؛ النصوص في work-config.js)
//   group → طبقة الطابور: act (يتطلب إجراء) · review (يحتاج مراجعة) · follow (للمتابعة)
//   done  → جلسة سُجّلت نتيجتها: لا تدخل الطابور ولا «الآن»، وتظهر في جدول اليوم كـ«✓ سُجّلت»
// =====================================================================
import {formatFileNumber} from '../core/file-number.js';
import {addDays} from '../core/clock.js';
import {actionKeyFor, ACTION_LABEL, HOME_LIMITS} from './work-config.js';

/** درجات الشدة: الترتيب يعتمد على rank، والعرض على label/tone. */
export const SEVERITY={
 critical:{rank:4,label:'عاجل',tone:'danger'},
 high:{rank:3,label:'مهم',tone:'warn'},
 normal:{rank:2,label:'قادم',tone:'info'},
 info:{rank:1,label:'للمراجعة',tone:''}
};

/** طبقات الطابور الثلاث — الترتيب هو ترتيب العرض. */
export const QUEUE_GROUPS=Object.freeze([
 Object.freeze({key:'act',label:'يتطلب إجراء'}),
 Object.freeze({key:'review',label:'يحتاج مراجعة'}),
 Object.freeze({key:'follow',label:'للمتابعة'})
]);

const dayOf=v=>String(v||'').slice(0,10);
const timeOf=v=>/^\d{1,2}:\d{2}/.test(String(v||''))?String(v).slice(0,5).padStart(5,'0'):'';

/** مفتاح ترتيب زمني: التاريخ ثم الوقت (الفاقد للوقت يأتي بعد أوقات اليوم). */
const sortKey=(date,time)=>`${dayOf(date)||'9999-99-99'}T${time||'99:99'}`;

function item(o){
 return {
  id:o.id,kind:o.kind,severity:o.severity,group:o.group||'follow',
  title:o.title||'',meta:[o.meta,o.ctx].filter(Boolean).join(' · '),
  date:dayOf(o.date),time:o.time||'',
  when:o.when||'',
  route:o.route,actionLabel:o.actionLabel||ACTION_LABEL.openItem,
  reasonCode:o.reasonCode,reasonParams:o.reasonParams||{},
  done:Boolean(o.done),
  sort:sortKey(o.date,o.time),
  daysLeft:o.daysLeft??null,
  postponeCount:Number(o.postponeCount||0)
 };
}

/** جلسة مُسجَّل نتيجتها: النتيجة نص غير فارغ في سجل الجلسة نفسه (لا حقل جديد). */
const hasResult=h=>String(h?.result??'').trim()!=='';

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
  const done=hasResult(h);
  add({id:`h:${h.id}`,kind:'hearing',severity:done?'info':'critical',date:today,time:t,
   group:'act',done,
   title:h.reason||h.type||'جلسة',
   meta:h.caseNumber?`قضية ${h.caseNumber}`:'',ctx:h.__fileLabel,
   when:done?(t?`اليوم ${t} · سُجّلت`:'اليوم · سُجّلت'):(t?`اليوم ${t}`:'اليوم — بدون وقت'),
   route:`rec:hearings:${h.id}`,actionLabel:ACTION_LABEL[actionKeyFor('hearing',{today:true,done})],daysLeft:0,
   reasonCode:done?'SESSION_DONE':'SESSION_TODAY',reasonParams:{time:t}});
 }
 for(const h of b.upcomingHearings||[]){
  const d=dayOf(h.hearingDate);
  if(!d||d===today)continue; // اليوم تم أخذه أعلاه
  if(hasResult(h))continue;   // جلسة مُسجَّلة لا تدخل الطابور
  const isTomorrow=d===addDays(today,1);
  const left=diffDays(today,d);
  add({id:`h:${h.id}`,kind:'hearing',severity:isTomorrow?'high':'normal',date:d,time:timeOf(h.hearingTime),
   group:'follow',
   title:h.reason||h.type||'جلسة',
   meta:h.caseNumber?`قضية ${h.caseNumber}`:'',ctx:h.__fileLabel,
   when:isTomorrow?`غدًا${timeOf(h.hearingTime)?' '+timeOf(h.hearingTime):''}`:formatDayShort(d),
   route:`rec:hearings:${h.id}`,actionLabel:ACTION_LABEL.openHearing,daysLeft:left,
   reasonCode:'SESSION_SOON',reasonParams:{days:left}});
 }

 // ---- الأعمال الإدارية
 for(const p of b.overdueProcedures||[]){
  const urgent=['urgent','critical','عاجل'].includes(String(p.priority||'').toLowerCase());
  const late=diffDays(p.internalDueDate,today);
  const postponed=Number(p.postponeCount||0);
  // التأجيل المتكرر إشارة تشغيلية: ينقل العمل إلى «يحتاج مراجعة» (لا قاعدة قانونية).
  const review=postponed>=HOME_LIMITS.postponeReviewAt;
  add({id:`p:${p.id}`,kind:'procedure',severity:urgent?'critical':'high',date:p.internalDueDate,
   group:review?'review':'act',
   title:p.description||p.type||'عمل إداري',
   meta:'متأخر عن موعده الداخلي',ctx:p.__fileLabel,
   when:`كان موعده ${dayOf(p.internalDueDate)}`,
   route:`rec:procedures:${p.id}`,actionLabel:ACTION_LABEL[actionKeyFor('procedure')],daysLeft:diffDays(today,p.internalDueDate),
   reasonCode:'OVERDUE',reasonParams:{days:late,postponed},postponeCount:postponed});
 }
 for(const p of b.upcomingProcedures||[]){
  const urgent=['urgent','critical','عاجل'].includes(String(p.priority||'').toLowerCase());
  const left=diffDays(today,p.internalDueDate);
  add({id:`p:${p.id}`,kind:'procedure',severity:'normal',date:p.internalDueDate,
   group:'follow',
   title:p.description||p.type||'عمل إداري',
   meta:p.type&&p.description?p.type:'',ctx:p.__fileLabel,
   when:formatDayShort(p.internalDueDate),
   route:`rec:procedures:${p.id}`,actionLabel:ACTION_LABEL[actionKeyFor('procedure')],daysLeft:left,
   reasonCode:urgent?'HIGH_PRIORITY':'DUE_SOON',reasonParams:{days:left}});
 }

 // ---- التوكيلات
 for(const p of b.expiredPoa||[]){
  add({id:`a:${p.id}`,kind:'poa',severity:'critical',date:p.expiryDate,
   group:'act',
   title:`توكيل ${p.poaNumber||'—'}${p.clientName?' — '+p.clientName:''}`,
   meta:'منتهٍ — لا تُقام به جلسة قبل التجديد',
   when:`انتهى ${dayOf(p.expiryDate)}`,
   route:`rec:powersOfAttorney:${p.id}`,actionLabel:ACTION_LABEL[actionKeyFor('poa')],daysLeft:diffDays(today,p.expiryDate),
   reasonCode:'POA_EXPIRED',reasonParams:{date:formatDayShort(p.expiryDate)}});
 }
 for(const p of b.expiringPoa||[]){
  const left=diffDays(today,p.expiryDate);
  add({id:`a:${p.id}`,kind:'poa',severity:left!==null&&left<=7?'critical':'high',date:p.expiryDate,
   group:'review',
   title:`توكيل ${p.poaNumber||'—'}${p.clientName?' — '+p.clientName:''}`,
   meta:'يحتاج تجديدًا',
   when:left===0?'ينتهي اليوم':`ينتهي خلال ${left} يوم`,
   route:`rec:powersOfAttorney:${p.id}`,actionLabel:ACTION_LABEL[actionKeyFor('poa')],daysLeft:left,
   reasonCode:'POA_EXPIRING',reasonParams:{days:left}});
 }

 // ---- المواعيد والمتابعات
 for(const a of b.appointmentsNext3||[]){
  const d=dayOf(a.date);
  const isToday=d===today;
  const left=diffDays(today,d);
  add({id:`ap:${a.id}`,kind:'appointment',severity:isToday?'high':'normal',date:d,time:timeOf(a.time),
   group:'follow',
   title:a.title||'موعد',
   meta:a.location||a.withWhom||'',ctx:a.__fileLabel,
   when:isToday?`اليوم${timeOf(a.time)?' '+timeOf(a.time):''}`:formatDayShort(d),
   route:`rec:appointments:${a.id}`,actionLabel:ACTION_LABEL[actionKeyFor('appointment')],daysLeft:left,
   reasonCode:isToday?'APPT_TODAY':'APPT_SOON',reasonParams:{days:left}});
 }
 for(const c of b.followupsThisWeek||[]){
  const d=dayOf(c.followUpDate);
  const isToday=d===today;
  const left=diffDays(today,d);
  add({id:`c:${c.id}`,kind:'followup',severity:isToday?'high':'normal',date:d,
   group:'follow',
   title:c.subject||'متابعة اتصال',
   meta:c.contactName||'',ctx:c.__fileLabel,
   when:isToday?'متابعة اليوم':formatDayShort(d),
   route:`rec:communications:${c.id}`,actionLabel:ACTION_LABEL[actionKeyFor('followup')],daysLeft:left,
   reasonCode:'FOLLOWUP_DUE',reasonParams:{days:left}});
 }

 // ---- ملفات راكدة (للمراجعة فقط)
 for(const f of b.staleFiles||[]){
  add({id:`f:${f.id}`,kind:'file',severity:'info',date:dayOf(f.lastActivityAt),
   group:'review',
   title:`${formatFileNumber(f.fileNumber)||'ملف'} — ${f.title||'بدون عنوان'}`.trim(),
   meta:'لا نشاط منذ أكثر من ٣٠ يومًا',ctx:'',
   when:'راكد',
   route:`file:${f.id}`,actionLabel:ACTION_LABEL[actionKeyFor('file')],daysLeft:null,
   reasonCode:'STALE_FILE',reasonParams:{days:30}});
 }

 // ---- التنفيذ: ما يحتاج قرارًا الآن (مصدره مركز التنفيذ). السقف «مهم» حتى لا يتقدم على جلسات اليوم.
 for(const e of b.executionAttention||[]){
  add({id:`e:${e.id}`,kind:'execution',severity:'high',date:e.date,
   group:'act',
   title:e.title||'تنفيذ',meta:e.label||'',
   when:e.overdueMinor>0?'متأخرات تنفيذ':'إجراء تنفيذ',
   route:`exc:${e.id}`,actionLabel:e.actionLabel||ACTION_LABEL.openExecution,daysLeft:e.date?diffDays(today,e.date):null,
   reasonCode:'EXECUTION_URGENT',reasonParams:{overdue:Number(e.overdueMinor||0)>0}});
 }

 // ---- جدول اليوم: حصراً ما يقع اليوم (المُسجَّل يبقى ظاهرًا ليعرف المحامي أنه أُنجز)
 const todayRows=items.filter(x=>x.date===today&&(x.kind==='hearing'||x.kind==='appointment'||x.kind==='followup'));

 // ---- التعارضات: عنصران أو أكثر لهما وقت بداية متطابق اليوم، وغير مُسجَّلين/ملغين.
 // لا تُحسب مدد ولا انتقالات (لا توجد نهاية زمنية في البيانات).
 const conflicts=detectSameStartConflicts(todayRows);
 const conflictIds=new Set(conflicts.flatMap(c=>c.items.map(x=>x.id)));

 const timeline=todayRows
  .sort((a,b)=>(a.time||'99:99').localeCompare(b.time||'99:99'))
  .map(x=>({...x,past:Boolean(x.time&&now&&x.time<now&&!x.done),conflict:conflictIds.has(x.id)}));

 // أي تعارض صريح يصبح سطرًا واحدًا في «يحتاج مراجعة».
 for(const c of conflicts){
  const first=c.items[0];
  items.push(item({id:`cf:${c.time}`,kind:'conflict',severity:'info',date:today,time:c.time,
   group:'review',
   title:`تعارض في ${c.time}`,meta:c.items.map(x=>x.title).join(' · '),
   when:`${c.items.length} عناصر في الوقت نفسه`,route:first.route,actionLabel:ACTION_LABEL.openItem,daysLeft:0,
   reasonCode:'CONFLICT',reasonParams:{count:c.items.length,time:c.time}}));
 }

 // الطابور: غير المُسجَّل فقط، والمرتب بالأهمية ثم الزمن.
 const open=items.filter(x=>!x.done);
 const attention=open.slice().sort((a,b)=>
  (SEVERITY[b.severity].rank-SEVERITY[a.severity].rank)||
  (a.sort<b.sort?-1:a.sort>b.sort?1:0));

 // الخطوة التالية: أقرب جلسة لم تمضِ ولم تُسجَّل اليوم، وإلا أعلى عنصر عاجل/مهم.
 const nextHearing=timeline.find(x=>x.kind==='hearing'&&!x.past&&!x.done);
 const nextUrgent=attention.find(x=>x.kind!=='conflict'&&(x.severity==='critical'||x.severity==='high'));
 const next=nextHearing||nextUrgent||null;

 const counts={critical:0,high:0,normal:0,info:0};
 for(const x of open)counts[x.severity]++;

 return {next,attention,timeline,counts,total:open.length,conflicts,
  groups:QUEUE_GROUPS.map(g=>({...g,items:attention.filter(x=>x.group===g.key)}))};
}

/**
 * تعارض صريح فقط: عناصر اليوم غير المُسجّلة التي تشترك في وقت بداية واحد.
 * @returns {Array<{time:string, items:Array}>} مرتبة زمنيًا
 */
export function detectSameStartConflicts(rows=[]){
 const byTime=new Map();
 for(const x of rows){
  if(!x.time||x.done||x.kind==='conflict')continue;
  if(!byTime.has(x.time))byTime.set(x.time,[]);
  byTime.get(x.time).push(x);
 }
 return [...byTime.entries()]
  .filter(([,list])=>list.length>1)
  .map(([time,list])=>({time,items:list}))
  .sort((a,b)=>a.time.localeCompare(b.time));
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
