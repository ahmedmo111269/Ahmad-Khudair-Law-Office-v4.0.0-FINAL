import {STORE} from '../db/schema.js';
export async function dashboardBrief(office){
 const today=new Date().toISOString().slice(0,10);
 const add=(d,n)=>{const x=new Date(d+'T00:00:00');x.setDate(x.getDate()+n);return x.toISOString().slice(0,10)};
 const tomorrow=add(today,1), weekEnd=add(today,7);
 const day=new Date(today+'T00:00:00'), dow=day.getDay(), monday=add(today, dow===0?-6:1-dow), nextMonday=add(monday,7), nextSunday=add(monday,13);
 const monthStart=today.slice(0,8)+'01', nextMonth=new Date(day.getFullYear(),day.getMonth()+1,1).toISOString().slice(0,10);
 const [todayHearings,upcomingHearings,overdue,upcomingProcedures]=await Promise.all([
  office.r.hearings.reportRange({index:'hearingDate',lower:today,upper:today,limit:100}),
  office.r.hearings.reportRange({index:'hearingDate',lower:tomorrow,upper:weekEnd,limit:100}),
  office.r.procedures.reportRange({index:'status_internalDueDate',lower:['pending',''],upper:['pending',today],limit:100}),
  office.r.procedures.reportRange({index:'internalDueDate',lower:tomorrow,upper:weekEnd,limit:100,filter:x=>x.status==='pending'})
 ]);
 const overdueProcedures=overdue.filter(x=>x.status==='pending'&&x.internalDueDate&&x.internalDueDate<today);
 return {todayHearings,upcomingHearings,overdueProcedures,upcomingProcedures,periods:{today,tomorrow,weekEnd,monday,nextMonday,nextSunday,monthStart,nextMonth}};
}
