// الصفحة الرئيسية: بطاقات اللوحة والتقارير السريعة كما هي، ثم أجندة بتقويم شهري وجدول لكل ما يقع في اليوم المختار.
import {esc} from '../ui/dom.js';
import {mountCalendar} from '../ui/calendar.js';
import {mountGrid} from '../ui/datagrid.js';
import {agenda,agendaMarks,resolveRefs} from '../services/entity-query.js';
import {fmtDate,label} from '../domain/entities.js';
import {localDate} from '../core/clock.js';
import {formatDate,formatDateTime,formatTime,formatNumber} from '../core/format.js';

export async function homePage(app){
 const {dashboardBrief}=await import('../services/dashboard.js');
 const r=await dashboardBrief(app.office);
 const d=v=>formatDate(v);
 return `<div class="hero hero-compact"><h2>صباح الخير، مكتب الأستاذ أحمد محمد خضير</h2></div>
 <div class="dashboard-grid">
  <section class="panel priority-panel"><div class="panel-head"><h3>جلسات اليوم</h3><button class="link" data-dashboard-report="hearings|today">تقرير الجلسات</button></div>${r.todayHearings.length?r.todayHearings.slice(0,12).map(x=>`<div class="work-row"><b>${esc(x.hearingTime||'بدون وقت')}</b><span>${esc(x.reason||x.type||'جلسة')}</span><small>${d(x.hearingDate)}</small></div>`).join(''):'<p class="muted">لا توجد جلسات مسجلة اليوم.</p>'}</section>
  <section class="panel"><div class="panel-head"><h3>الأعمال الإدارية المتأخرة</h3><button class="link" data-dashboard-report="procedures|overdue">تقرير الأعمال</button></div>${r.overdueProcedures.length?r.overdueProcedures.slice(0,12).map(x=>`<div class="work-row"><b>${esc(x.internalDueDate||'')}</b><span>${esc(x.description||x.type||'إجراء')}</span><small>${esc(x.priority||'normal')}</small></div>`).join(''):'<p class="muted">لا توجد أعمال إدارية متأخرة.</p>'}</section>
  <section class="panel"><div class="panel-head"><h3>الجلسات القادمة</h3><button class="link" data-dashboard-report="hearings|week">هذا الأسبوع</button></div>${r.upcomingHearings.length?r.upcomingHearings.slice(0,12).map(x=>`<div class="work-row"><b>${d(x.hearingDate)}</b><span>${esc(x.hearingTime||'')} — ${esc(x.reason||x.type||'جلسة')}</span><small>${esc(x.caseNumber||'')}</small></div>`).join(''):'<p class="muted">لا توجد جلسات قادمة ضمن الفترة المعروضة.</p>'}</section>
  <section class="panel"><div class="panel-head"><h3>أعمال إدارية قادمة</h3><button class="link" data-dashboard-report="procedures|week">هذا الأسبوع</button></div>${r.upcomingProcedures.length?r.upcomingProcedures.slice(0,12).map(x=>`<div class="work-row"><b>${d(x.internalDueDate)}</b><span>${esc(x.description||x.type||'إجراء')}</span><small>${esc(x.status||'pending')}</small></div>`).join(''):'<p class="muted">لا توجد أعمال إدارية قادمة ضمن الفترة المعروضة.</p>'}</section>
 </div>
 <section class="panel daily-shortcuts"><div class="panel-head"><h3>تقارير العمل السريع</h3></div><div class="shortcut-grid"><button data-dashboard-report="hearings|tomorrow">جلسات غدًا</button><button data-dashboard-report="hearings|nextWeek">جلسات الأسبوع التالي</button><button data-dashboard-report="hearings|month">جلسات هذا الشهر</button><button data-dashboard-report="procedures|tomorrow">أعمال غدًا</button><button data-dashboard-report="procedures|nextWeek">أعمال الأسبوع التالي</button><button data-dashboard-report="procedures|month">أعمال هذا الشهر</button><button data-route-report="clients">الموكلون</button><button data-route-report="cases">القضايا</button></div></section>
 <section class="panel agenda"><div class="panel-head"><h3>الأجندة</h3><span class="muted small">اضغط على أي يوم لعرض كل ما فيه: الجلسات، الأعمال الإدارية، المواعيد، المتابعات، الأحكام، الخبراء، وخطوات الملفات.</span></div><div class="agenda-layout"><div id="home-calendar"></div><div class="agenda-day"><h4 id="agenda-title"></h4><div id="agenda-grid"></div></div></div></section>`
}

export function bindHome(app){
 document.querySelectorAll('[data-dashboard-report]').forEach(b=>b.onclick=()=>{const [type,preset]=b.dataset.dashboardReport.split('|');app.go('reports?type='+encodeURIComponent(type)+'&preset='+encodeURIComponent(preset))});
 document.querySelectorAll('[data-route-report]').forEach(b=>b.onclick=()=>app.go('reports?type='+encodeURIComponent(b.dataset.routeReport)));
 const refs=new Map();
 const cols=[
  {key:'kind',label:'النوع'},{key:'date',label:'التاريخ',type:'date',text:r=>fmtDate(r.date)},{key:'time',label:'الوقت'},
  {key:'title',label:'البيان'},{key:'details',label:'التفاصيل'},{key:'status',label:'الحالة',text:r=>label(r.status)||''},
  {key:'fileId',label:'الملف',get:r=>refs.get(r.fileId)||'',text:r=>refs.get(r.fileId)||''},
  {key:'caseId',label:'القضية / المرحلة',get:r=>refs.get(r.caseId)||'',text:r=>refs.get(r.caseId)||''}];
 const grid=mountGrid(document.querySelector('#agenda-grid'),{columns:cols,rows:[],title:'أجندة اليوم',storageKey:'home:agenda',emptyText:'لا توجد عناصر في هذا اليوم.',
  onRowClick:r=>app.go(r.store==='files'?'file:'+r.id:`rec:${r.store}:${r.id}`)});
 app.__agendaDay=app.__agendaDay||localDate();
 const showDay=async d=>{
  app.__agendaDay=d;
  document.querySelector('#agenda-title').textContent=`عناصر يوم ${fmtDate(d)}`;
  const rows=await agenda(app.office,d,d);
  await resolveRefs(app.office,rows,[{k:'fileId',ref:'files'},{k:'caseId',ref:'cases'}],refs);
  grid.setRows(rows);
 };
 mountCalendar(document.querySelector('#home-calendar'),{selected:app.__agendaDay,onMonthChange:(y,m)=>agendaMarks(app.office,y,m),onSelect:d=>showDay(d).catch(e=>app.fail(e))});
 showDay(app.__agendaDay).catch(e=>app.fail(e));
}
void esc;
