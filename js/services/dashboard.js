import {STORE} from '../db/schema.js';
import {localDate,addDays,isActiveProcedure} from '../core/clock.js';
export async function dashboardBrief(office){
 const today=localDate();
 const add=addDays;
 const tomorrow=add(today,1), weekEnd=add(today,7);
 const day=new Date(today+'T00:00:00'), dow=day.getDay(), monday=add(today, dow===0?-6:1-dow), nextMonday=add(monday,7), nextSunday=add(monday,13);
 const monthStart=today.slice(0,8)+'01', nextMonth=localDate(new Date(day.getFullYear(),day.getMonth()+1,1));
 const [todayHearings,upcomingHearings,overdue,upcomingProcedures]=await Promise.all([
  office.r.hearings.reportRange({index:'hearingDate',lower:today,upper:today,limit:100}),
  office.r.hearings.reportRange({index:'hearingDate',lower:tomorrow,upper:weekEnd,limit:100}),
  office.r.procedures.reportRange({index:'internalDueDate',lower:'0000-01-01',upper:today,limit:100,filter:x=>isActiveProcedure(x)&&x.internalDueDate&&x.internalDueDate<today}),
  office.r.procedures.reportRange({index:'internalDueDate',lower:tomorrow,upper:weekEnd,limit:100,filter:isActiveProcedure})
 ]);
 const overdueProcedures=overdue;
 // attach case numbers so the dashboard can show which case a hearing belongs to
 const caseIds=[...todayHearings,...upcomingHearings].map(x=>x.caseId).filter(Boolean);
 const cases=caseIds.length?await office.r.cases.getMany(caseIds):[];const cm=new Map(cases.map(c=>[c.id,c]));
 for(const h of [...todayHearings,...upcomingHearings]){const c=cm.get(h.caseId);if(c)h.caseNumber=`${c.caseNumber||''}/${c.caseYear||''}`}
 return {todayHearings,upcomingHearings,overdueProcedures,upcomingProcedures,periods:{today,tomorrow,weekEnd,monday,nextMonday,nextSunday,monthStart,nextMonth}};
}
