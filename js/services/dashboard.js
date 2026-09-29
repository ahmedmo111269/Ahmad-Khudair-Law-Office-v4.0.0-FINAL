import {localDate,addDays,isActiveProcedure} from '../core/clock.js';
import {isClosedFile} from '../domain/entities.js';

export async function dashboardBrief(office){
 const today=localDate();
 const add=addDays;
 const tomorrow=add(today,1), weekEnd=add(today,7), d3=add(today,3);
 const day=new Date(today+'T00:00:00'), dow=day.getDay(), monday=add(today, dow===0?-6:1-dow), nextMonday=add(monday,7), nextSunday=add(monday,13);
 const monthStart=today.slice(0,8)+'01', nextMonth=localDate(new Date(day.getFullYear(),day.getMonth()+1,1));
 const staleCutoff=`${add(today,-30)}T23:59:59`;
 const [todayHearings,upcomingHearings,overdue,upcomingProcedures,appointmentsNext3,followupsThisWeek,staleFiles]=await Promise.all([
  office.r.hearings.reportRange({index:'hearingDate',lower:today,upper:today,limit:100}),
  office.r.hearings.reportRange({index:'hearingDate',lower:tomorrow,upper:weekEnd,limit:100}),
  office.r.procedures.reportRange({index:'internalDueDate',lower:'0000-01-01',upper:today,limit:100,filter:x=>isActiveProcedure(x)&&x.internalDueDate&&x.internalDueDate<today}),
  office.r.procedures.reportRange({index:'internalDueDate',lower:tomorrow,upper:weekEnd,limit:100,filter:isActiveProcedure}),
  office.r.appointments.reportRange({index:'date',lower:today,upper:d3,limit:100,filter:x=>x.status!=='done'&&x.status!=='cancelled'}),
  office.r.communications.reportRange({index:'followUpDate',lower:today,upper:weekEnd,limit:100,filter:x=>x.followUpRequired===true||x.followUpRequired==='true'}),
  office.r.files.reportRange({index:'lastActivityAt',lower:'0000-01-01',upper:staleCutoff,limit:100,filter:x=>!isClosedFile(x)})
 ]);
 const overdueProcedures=overdue;
 // attach case numbers so the dashboard can show which case a hearing belongs to
 const caseIds=[...todayHearings,...upcomingHearings].map(x=>x.caseId).filter(Boolean);
 const cases=caseIds.length?await office.r.cases.getMany(caseIds):[];const cm=new Map(cases.map(c=>[c.id,c]));
 for(const h of [...todayHearings,...upcomingHearings]){const c=cm.get(h.caseId);if(c)h.caseNumber=`${c.caseNumber||''}/${c.caseYear||''}`}
 return {todayHearings,upcomingHearings,overdueProcedures,upcomingProcedures,appointmentsNext3,followupsThisWeek,staleFiles,periods:{today,tomorrow,weekEnd,d3,monday,nextMonday,nextSunday,monthStart,nextMonth}};
}
