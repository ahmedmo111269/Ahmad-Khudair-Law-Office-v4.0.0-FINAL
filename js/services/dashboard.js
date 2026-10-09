import {localDate,addDays,isActiveProcedure} from '../core/clock.js';
import {isClosedFile} from '../domain/entities.js';
import {overlayId} from '../domain/work-items.js';

import {executionAttentionBrief} from './execution-work.js';

export async function dashboardBrief(office){
 const today=localDate();
 const add=addDays;
 const tomorrow=add(today,1), weekEnd=add(today,7), d3=add(today,3);
 const day=new Date(today+'T00:00:00'), dow=day.getDay(), monday=add(today, dow===0?-6:1-dow), nextMonday=add(monday,7), nextSunday=add(monday,13);
 const monthStart=today.slice(0,8)+'01', nextMonth=localDate(new Date(day.getFullYear(),day.getMonth()+1,1));
 const staleCutoff=`${add(today,-30)}T23:59:59`;
 // «توكيل ينتهي قريبًا» خطر صامت على المكتب: لا يُنذر أحد، وقد تُقام جلسة
 // بتوكيل منتهٍ. القراءة كلها على فهرس expiryDate القائم (نطاق مغلق)، فالتكلفة
 // ثابتة مهما كبر المخزن، ولا تُقرأ سجلات بلا تاريخ انتهاء أصلًا.
 const poaSoonStart=today,poaSoonEnd=add(today,30);
 // ---------------------------------------------------------------------
 // Wave 7 — دمج الاستعلامات: 9 reportRange ← 6 في الحالة العامة.
 // الاستعلام المدموج يقرأ نطاقًا واحدًا أوسع، وتُقسَّم النتائج في الذاكرة.
 // كل مقطع يحتفظ بحدّه القديم (slice(0,100) / slice(0,60)) وبمرشحه.
 // المقطع الأول (اليوم / المتأخر) دقيق دائمًا: ترتيبه في الفهرس يسبق الثاني.
 // إذا بلغ الاستعلام المدموج حدّه (200/120) ونضب المقطع الثاني، يُستكمل
 // باستعلام follow-up هو الاستعلام القديم نفسه، فالنتائج لا تتغير.
 // ---------------------------------------------------------------------
 const [hearingsRange,proceduresRange,appointmentsNext3,followupsThisWeek,staleFiles,poaRange]=await Promise.all([
  office.r.hearings.reportRange({index:'hearingDate',lower:today,upper:weekEnd,limit:200}),
  office.r.procedures.reportRange({index:'internalDueDate',lower:'0000-01-01',upper:weekEnd,limit:200,filter:x=>isActiveProcedure(x)&&Boolean(x.internalDueDate)}),
  office.r.appointments.reportRange({index:'date',lower:today,upper:d3,limit:100,filter:x=>x.status!=='done'&&x.status!=='cancelled'}),
  office.r.communications.reportRange({index:'followUpDate',lower:today,upper:weekEnd,limit:100,filter:x=>x.followUpRequired===true||x.followUpRequired==='true'}),
  office.r.files.reportRange({index:'lastActivityAt',lower:'0000-01-01',upper:staleCutoff,limit:100,filter:x=>!isClosedFile(x)}),
  office.r.powersOfAttorney.reportRange({index:'expiryDate',lower:'0000-01-01',upper:poaSoonEnd,limit:120})
 ]);
 const dayOf=v=>String(v||'').slice(0,10);
 // الجلسات: «اليوم» ثم «غدًا…نهاية الأسبوع» (نفس تقسيم الاستعلامين القديمين).
 // المقطع الأول (اليوم / المتأخر) دقيق دائمًا: جميع صفوفه تأتي قبل
 // المقطع الثاني في ترتيب الفهرس. المقطع الثاني (القادم / قريب الانتهاء)
 // ينضب إذا بلغ الاستعلام المدموج حدّه — عندها يُستكمل باستعلام
 // follow-up هو الاستعلام القديم نفسه، فالنتائج لا تتغير حرفيًا.
 let todayHearings=hearingsRange.filter(h=>dayOf(h.hearingDate)===today).slice(0,100);
 let upcomingHearings=hearingsRange.filter(h=>dayOf(h.hearingDate)>today).slice(0,100);
 if(hearingsRange.length>=200&&upcomingHearings.length<100)
  upcomingHearings=await office.r.hearings.reportRange({index:'hearingDate',lower:tomorrow,upper:weekEnd,limit:100});
 // الأعمال الإدارية: متأخرة (< اليوم) ← قادمة (≥ غدًا)؛ موعد «اليوم» لم يكن في أيٍّ منهما.
 const overdue=proceduresRange.filter(p=>dayOf(p.internalDueDate)<today).slice(0,100);
 let upcomingProcedures=proceduresRange.filter(p=>dayOf(p.internalDueDate)>=tomorrow).slice(0,100);
 if(proceduresRange.length>=200&&upcomingProcedures.length<100)
  upcomingProcedures=await office.r.procedures.reportRange({index:'internalDueDate',lower:tomorrow,upper:weekEnd,limit:100,filter:isActiveProcedure});
 // التوكيلات: منتهية (< اليوم وغير مؤرشفة) ← قريبة الانتهاء (≥ اليوم، من غير فلتر الأرشفة كما كان).
 let expiredPoa=poaRange.filter(p=>dayOf(p.expiryDate)<today&&!p.isArchived).slice(0,60);
 let expiringPoa=poaRange.filter(p=>dayOf(p.expiryDate)>=today).slice(0,60);
 if(poaRange.length>=120){
  if(expiringPoa.length<60)
   expiringPoa=await office.r.powersOfAttorney.reportRange({index:'expiryDate',lower:poaSoonStart,upper:poaSoonEnd,limit:60});
  // المنتهية: لا يُستكمل هذا المقطع إلا إذا ضغطت صفوف الأرشيف الجزء الأول
  // من القراءة المدموجة، أي لا يوجد صف «قريب الانتهاء» بداخلها.
  if(expiredPoa.length<60&&!poaRange.some(p=>dayOf(p.expiryDate)>=today))
   expiredPoa=await office.r.powersOfAttorney.reportRange({index:'expiryDate',lower:'0000-01-01',upper:add(today,-1),limit:60,filter:x=>!x.isArchived});
 }
 // Wave 7 — عدّاد التأجيل المتكرر (postponeCount) يعيش في طبقة work-items (الـ overlay
 // فوق سجل العمل الإداري)، وكانت الرئيسية تقرأ جدول الأعمال مباشرة فبقي العدّاد غائبًا.
 // قراءة جماعية واحدة (getManyRaw في معاملة واحدة — لا N+1) للمعرّفات الظاهرة فقط.
 const overdueProcedures=overdue;
 if(overdueProcedures.length){
  const overlays=await office.r.workItems.getManyRaw(overdueProcedures.map(p=>overlayId('procedures',p.id)));
  const byOverlay=new Map(overlays.map(o=>[o.id,o]));
  for(const p of overdueProcedures)p.postponeCount=Number(byOverlay.get(overlayId('procedures',p.id))?.postponeCount||0);
 }
 // attach case numbers so the dashboard can show which case a hearing belongs to
 const caseIds=[...todayHearings,...upcomingHearings].map(x=>x.caseId).filter(Boolean);
 const cases=caseIds.length?await office.r.cases.getMany(caseIds):[];const cm=new Map(cases.map(c=>[c.id,c]));
 for(const h of [...todayHearings,...upcomingHearings]){const c=cm.get(h.caseId);if(c){h.caseNumber=`${c.caseNumber||''}/${c.caseYear||''}`;h.fileId=h.fileId||c.fileId||''}}
 // اسم الموكل يظهر في البطاقة مباشرة: قرار «أجدّد التوكيل لمن؟» لا يحتمل نقرتين.
 const poaClientIds=[...new Set([...expiringPoa,...expiredPoa].map(p=>p.clientId).filter(Boolean))];
 if(poaClientIds.length){
  const clients=await office.r.clients.getMany(poaClientIds);
  const byId=new Map(clients.map(c=>[c.id,c.fullName||'']));
  for(const p of [...expiringPoa,...expiredPoa])p.clientName=byId.get(p.clientId)||'';
 }
 // التنفيذ: ما يحتاج قرارًا الآن فقط (عاجل/مستحق) — قراءة مفهرسة محدودة، ولا يفشل المكتب إن تعذّرت.
 const executionAttention=await executionAttentionBrief(office,{today}).catch(()=>[]);
 return {todayHearings,upcomingHearings,overdueProcedures,upcomingProcedures,appointmentsNext3,followupsThisWeek,staleFiles,expiringPoa,expiredPoa,executionAttention,periods:{today,tomorrow,weekEnd,d3,monday,nextMonday,nextSunday,monthStart,nextMonth}};
}
