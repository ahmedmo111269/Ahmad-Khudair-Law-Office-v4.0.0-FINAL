import {isClosedFile} from '../domain/entities.js';
import {STORE} from '../db/schema.js';
import {localDate,isActiveProcedure} from '../core/clock.js';

const MAX=100;
const isoDay=localDate;
const addDays=(s,n)=>{const d=new Date(`${s}T00:00:00`);d.setDate(d.getDate()+n);return isoDay(d)};
const today=()=>isoDay(new Date());
async function range(repo,index,lower,upper,filter){return repo.reportRange({index,lower,upper,limit:MAX,filter})}

export async function actionCenterBrief(office){
  const t=today(), tomorrow=addDays(t,1), d3=addDays(t,3), week=addDays(t,7), stale=addDays(t,-30);
  const [hToday,hNext3,hNextWeek,pOverdue,pNext3,pNextWeek,appointments,followups,fileNext,staleFiles]=await Promise.all([
    range(office.r.hearings,'hearingDate',t,t),
    range(office.r.hearings,'hearingDate',tomorrow,d3),
    range(office.r.hearings,'hearingDate',addDays(t,4),week),
    range(office.r.procedures,'internalDueDate','0000-01-01',t,x=>isActiveProcedure(x)&&x.internalDueDate&&x.internalDueDate<t),
    range(office.r.procedures,'internalDueDate',t,d3,isActiveProcedure),
    range(office.r.procedures,'internalDueDate',addDays(t,4),week,isActiveProcedure),
    range(office.r.appointments,'date',t,d3,x=>x.status!=='done'&&x.status!=='cancelled'),
    range(office.r.communications,'followUpDate',t,week,x=>x.followUpRequired===true||x.followUpRequired==='true'),
    range(office.r.files,'nextStepDate',t,week,x=>!isClosedFile(x)),
    range(office.r.files,'lastActivityAt','0000-01-01',`${stale}T23:59:59`,x=>!isClosedFile(x))
  ]);
  return {today:t,windows:{tomorrow,d3,week},todayHearings:hToday,hearingsNext3:hNext3,hearingsNextWeek:hNextWeek,overdueProcedures:pOverdue,proceduresNext3:pNext3,proceduresNextWeek:pNextWeek,appointments,followups,fileNext,staleFiles};
}

export function actionRows(r){
  const rows=[];
  const push=(items,kind,dateFn,titleFn,routeFn)=>items.forEach(x=>rows.push({id:x.id,kind,date:dateFn(x)||'',title:titleFn(x),recordRoute:routeFn(x),raw:x}));
  push(r.todayHearings,'جلسة',x=>x.hearingDate+'T'+(x.hearingTime||'00:00'),x=>`جلسة ${x.hearingDate||''}`,x=>`rec:hearings:${x.id}`);
  push(r.hearingsNext3,'جلسة',x=>x.hearingDate+'T'+(x.hearingTime||'00:00'),x=>`جلسة ${x.hearingDate||''}`,x=>`rec:hearings:${x.id}`);
  push(r.overdueProcedures,'متأخر',x=>x.internalDueDate,x=>x.description||x.type||'إجراء متأخر',x=>x.fileId?`file:${x.fileId}`:'procedures');
  push(r.proceduresNext3,'إجراء',x=>x.internalDueDate,x=>x.description||x.type||'إجراء',x=>x.fileId?`file:${x.fileId}`:'procedures');
  push(r.proceduresNextWeek,'إجراء',x=>x.internalDueDate,x=>x.description||x.type||'إجراء',x=>x.fileId?`file:${x.fileId}`:'procedures');
  push(r.appointments,'موعد',x=>(x.date||'')+'T'+(x.time||'00:00'),x=>x.title||'موعد',x=>x.fileId?`file:${x.fileId}`:(x.clientId?`client:${x.clientId}`:'appointments'));
  push(r.followups,'متابعة',x=>x.followUpDate,x=>x.subject||'متابعة اتصال',x=>x.fileId?`file:${x.fileId}`:(x.clientId?`client:${x.clientId}`:'communications'));
  push(r.fileNext,'خطوة ملف',x=>x.nextStepDate,x=>x.nextStep||x.title||'خطوة تالية',x=>`file:${x.id}`);
  push(r.staleFiles,'متابعة',x=>x.lastActivityAt,x=>`لا نشاط منذ مدة: ${x.title||x.fileNumber||'ملف'}`,x=>`file:${x.id}`);
  return rows;
}
