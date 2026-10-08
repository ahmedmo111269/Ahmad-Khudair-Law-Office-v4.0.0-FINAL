// =====================================================================
// مركز عمل الموكل — يجمع إشارات كل ملفات الموكل في لقطة واحدة
// ---------------------------------------------------------------------
// الشكل الناتج مطابق لشكل dashboardBrief() حتى يُمرَّر إلى محرك التركيز
// (focus-engine) دون منطق مكرر. القراءة كلها عبر الفهارس الموجودة
// (fileId / clientId)، بحدود ثابتة لكل موكل (MAX_FILES) لضمان الأداء.
// لا كتابة هنا، ولا منطق قانوني: الأهلية والتواريخ من الحقول القائمة فقط.
// =====================================================================
import {localDate,addDays,isActiveProcedure} from '../core/clock.js';
import {formatFileNumber} from '../core/file-number.js';

const MAX_FILES=60;
const HORIZON_DAYS=30;

export async function clientWorkspaceData(office,{clientId,clientName='',summary}){
 const today=localDate();
 const in30=addDays(today,HORIZON_DAYS),in14=addDays(today,14);
 const dOf=v=>String(v||'').slice(0,10);
 const files=(summary?.files||[]).slice(0,MAX_FILES);
 const fileIds=files.map(f=>f.id);
 const labelOf=new Map(files.map(f=>[f.id,[formatFileNumber(f.fileNumber),f.title].filter(Boolean).join(' — ')]));

 const [hearingParts,procParts,appts,comms,poas]=await Promise.all([
  Promise.all(fileIds.map(id=>office.r.hearings.byIndex('fileId',id,200))),
  Promise.all(fileIds.map(id=>office.r.procedures.byIndex('fileId',id,300))),
  office.r.appointments.byIndex('clientId',clientId,300),
  office.r.communications.byIndex('clientId',clientId,300),
  office.r.powersOfAttorney.byIndex('clientId',clientId,100)
 ]);
 const hearings=hearingParts.flat().filter(h=>!h.isDeleted).map(h=>({...h,__fileLabel:labelOf.get(h.fileId)||''}));
 const procs=procParts.flat().filter(p=>!p.isDeleted).map(p=>({...p,__fileLabel:labelOf.get(p.fileId)||''}));

 const todayHearings=hearings.filter(h=>dOf(h.hearingDate)===today&&!h.result);
 const upcomingHearings=hearings.filter(h=>{const d=dOf(h.hearingDate);return d>today&&d<=in30&&!h.result});

 const active=procs.filter(p=>isActiveProcedure(p));
 const overdueProcedures=active.filter(p=>dOf(p.internalDueDate)&&dOf(p.internalDueDate)<today)
  .sort((a,b)=>dOf(a.internalDueDate).localeCompare(dOf(b.internalDueDate)));
 const upcomingProcedures=active.filter(p=>{const d=dOf(p.internalDueDate);return d&&d>=today&&d<=in30});

 const recentDone=procs.filter(p=>p.status==='done')
  .sort((a,b)=>String(b.completedAt||b.updatedAt||'').localeCompare(String(a.completedAt||a.updatedAt||'')))
  .slice(0,6)
  .map(p=>({id:p.id,title:p.description||p.type||'عمل إداري',fileLabel:p.__fileLabel}));

 const appointmentsNext3=appts.filter(a=>{const d=dOf(a.date);return d>=today&&d<=in14&&a.status!=='done'&&a.status!=='cancelled'})
  .map(a=>({...a,__fileLabel:''}));
 const followupsThisWeek=comms.filter(c=>(c.followUpRequired===true||c.followUpRequired==='true')&&dOf(c.followUpDate)>=today&&dOf(c.followUpDate)<=in14)
  .map(c=>({...c,__fileLabel:''}));

 const expiringPoa=poas.filter(p=>!p.isArchived&&dOf(p.expiryDate)>=today&&dOf(p.expiryDate)<=in30).map(p=>({...p,clientName}));
 const expiredPoa=poas.filter(p=>!p.isArchived&&dOf(p.expiryDate)&&dOf(p.expiryDate)<today).map(p=>({...p,clientName}));

 const staleFiles=(summary?.needsFollowUp||[]).slice(0,10);

 return {
  brief:{todayHearings,upcomingHearings,overdueProcedures,upcomingProcedures,appointmentsNext3,followupsThisWeek,staleFiles,expiringPoa,expiredPoa},
  recentDone,today,
  truncated:(summary?.files?.length||0)>MAX_FILES
 };
}
