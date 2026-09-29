// الصفحة الرئيسية: تحية + مؤشرات العمل + آخر ما فُتح + إجراءات سريعة + أجندة بتقويم شهري.
// كل بطاقة وكل صف قابل للنقر: قاعدة المنتج — أي معلومة تظهر على الشاشة تفتح سجلها بنقرة.
import {esc} from '../ui/dom.js';
import {mountCalendar} from '../ui/calendar.js';
import {mountGrid} from '../ui/datagrid.js';
import {agenda,agendaMarks,resolveRefs} from '../services/entity-query.js';
import {fmtDate,label} from '../domain/entities.js';
import {localDate} from '../core/clock.js';
import {formatDate,formatNumber,longDateAr,greetingKey,GREETINGS} from '../core/format.js';
import {getRecent} from '../services/recents.js';

let __lastBrief=null;
const KPI=(k,n,txt,route,accent='')=>`<button class="kpi${accent?` kpi-${accent}`:''}" data-kpi="${esc(route)}"><b>${formatNumber(n)}${n>=100?'+':''}</b><span>${esc(txt)}</span></button>`;
export async function homePage(app){
 const {dashboardBrief}=await import('../services/dashboard.js');
 const r=await dashboardBrief(app.office);__lastBrief=r;
 const d=v=>formatDate(v);
 const today=localDate();
 const [h,m]=today.split('-').map(Number);
 const g=GREETINGS[greetingKey()];
 const recents=getRecent().slice(0,8);
 const kpis=[
  KPI('t',r.todayHearings.length,'جلسات اليوم','hearings?preset=today'),
  KPI('o',r.overdueProcedures.length,'أعمال متأخرة','procedures?preset=overdue',r.overdueProcedures.length?'warn':''),
  KPI('w',r.upcomingHearings.length,'جلسات هذا الأسبوع','hearings?preset=week'),
  KPI('p',r.upcomingProcedures.length,'أعمال هذا الأسبوع','procedures?preset=week'),
  KPI('a',r.appointmentsNext3.length,'مواعيد خلال 3 أيام','appointments?preset=upcoming'),
  KPI('f',r.followupsThisWeek.length,'متابعات اتصال','communications?preset=week'),
  KPI('s',r.staleFiles.length,'ملفات بلا نشاط','actionCenter',r.staleFiles.length?'warn':'')
 ];
 return `<div class="hero hero-home"><div><h2>${g}، مكتب الأستاذ أحمد محمد خضير</h2><p class="hero-date">${longDateAr()}</p></div>
  <div class="hero-quick"><button class="primary" data-quick-add>+ إضافة</button><button class="ghost" data-goto="actionCenter">مركز العمل</button><button class="ghost" data-goto="reports?type=hearings&preset=today">تقرير اليوم</button></div></div>
 <div class="kpi-strip" role="group" aria-label="ملخص العمل">${kpis.join('')}</div>
 ${recents.length?`<section class="recents-bar" aria-label="آخر ما فُتح"><span class="recents-lbl">آخر ما فُتح:</span><div class="recents-chips">${recents.map(x=>`<button class="recent-chip" data-recent="${esc(x.route)}"><span class="rc-ic" aria-hidden="true">${esc(x.icon==='calendar'?'📅':x.icon==='users'?'👤':x.icon==='gavel'?'⚖':'📁')}</span><span class="rc-t">${esc(x.title)}</span></button>`).join('')}</div></section>`:''}
 <div class="dashboard-grid">
  <section class="panel priority-panel"><div class="panel-head"><h3>جلسات اليوم</h3><button class="link" data-dashboard-report="hearings|today">تقرير الجلسات</button></div>${r.todayHearings.length?r.todayHearings.slice(0,12).map(x=>`<button class="work-row work-click" data-open-rec="hearings:${esc(x.id)}"><b>${esc(x.hearingTime||'بدون وقت')}</b><span>${esc(x.reason||x.type||'جلسة')}</span><small>${d(x.hearingDate)}${x.caseNumber?` — ${esc(x.caseNumber)}`:''}</small></button>`).join(''):'<p class="muted">لا توجد جلسات مسجلة اليوم.</p>'}</section>
  <section class="panel"><div class="panel-head"><h3>الأعمال الإدارية المتأخرة</h3><button class="link" data-dashboard-report="procedures|overdue">تقرير الأعمال</button></div>${r.overdueProcedures.length?r.overdueProcedures.slice(0,12).map(x=>`<button class="work-row work-click" data-open-rec="procedures:${esc(x.id)}"><b>${esc(x.internalDueDate||'')}</b><span>${esc(x.description||x.type||'إجراء')}</span><small>${esc(x.priority||'normal')}</small></button>`).join(''):'<p class="muted">لا توجد أعمال إدارية متأخرة.</p>'}</section>
  <section class="panel"><div class="panel-head"><h3>الجلسات القادمة</h3><button class="link" data-dashboard-report="hearings|week">هذا الأسبوع</button></div>${r.upcomingHearings.length?r.upcomingHearings.slice(0,12).map(x=>`<button class="work-row work-click" data-open-rec="hearings:${esc(x.id)}"><b>${d(x.hearingDate)}</b><span>${esc(x.hearingTime||'')} — ${esc(x.reason||x.type||'جلسة')}</span><small>${esc(x.caseNumber||'')}</small></button>`).join(''):'<p class="muted">لا توجد جلسات قادمة ضمن الفترة المعروضة.</p>'}</section>
  <section class="panel"><div class="panel-head"><h3>أعمال إدارية قادمة</h3><button class="link" data-dashboard-report="procedures|week">هذا الأسبوع</button></div>${r.upcomingProcedures.length?r.upcomingProcedures.slice(0,12).map(x=>`<button class="work-row work-click" data-open-rec="procedures:${esc(x.id)}"><b>${d(x.internalDueDate)}</b><span>${esc(x.description||x.type||'إجراء')}</span><small>${esc(label(x.status||'pending'))}</small></button>`).join(''):'<p class="muted">لا توجد أعمال إدارية قادمة ضمن الفترة المعروضة.</p>'}</section>
 </div>
 <section class="panel daily-shortcuts"><div class="panel-head"><h3>تقارير العمل السريع</h3></div><div class="shortcut-grid"><button data-dashboard-report="hearings|tomorrow">جلسات غدًا</button><button data-dashboard-report="hearings|nextWeek">جلسات الأسبوع التالي</button><button data-dashboard-report="hearings|month">جلسات هذا الشهر</button><button data-dashboard-report="procedures|tomorrow">أعمال غدًا</button><button data-dashboard-report="procedures|nextWeek">أعمال الأسبوع التالي</button><button data-dashboard-report="procedures|month">أعمال هذا الشهر</button><button data-route-report="clients">الموكلون</button><button data-route-report="cases">القضايا</button></div></section>
 <section class="panel agenda"><div class="panel-head"><h3>الأجندة</h3><span class="muted small">اضغط على أي يوم لعرض كل ما فيه: الجلسات، الأعمال الإدارية، المواعيد، المتابعات، الأحكام، الخبراء، وخطوات الملفات.</span></div><div class="agenda-layout"><div id="home-calendar"></div><div class="agenda-day"><h4 id="agenda-title"></h4><div id="agenda-grid"></div></div></div></section>`;
}

export function bindHome(app){
 // شارة عناصر العمل على زر «مركز العمل» في الشريط الجانبي — عدّاد حي من بيانات لوحة اليوم
 const acBtn=document.querySelector('#sidebar [data-route="actionCenter"]');
 if(acBtn&&__lastBrief){
  const b=__lastBrief;
  const n=b.todayHearings.length+b.overdueProcedures.length+b.appointmentsNext3.length+b.followupsThisWeek.length+b.staleFiles.length;
  acBtn.querySelector('.nav-badge')?.remove();
  if(n)acBtn.insertAdjacentHTML('beforeend',`<span class="nav-badge"${n>99?` title="${n}"`:''}>${n>99?'99+':n}</span>`);
 }
 document.querySelectorAll('[data-dashboard-report]').forEach(b=>b.onclick=()=>{const [type,preset]=b.dataset.dashboardReport.split('|');app.go('reports?type='+encodeURIComponent(type)+'&preset='+encodeURIComponent(preset))});
 document.querySelectorAll('[data-route-report]').forEach(b=>b.onclick=()=>app.go('reports?type='+encodeURIComponent(b.dataset.routeReport)));
 document.querySelectorAll('[data-kpi]').forEach(b=>b.onclick=()=>app.go(b.dataset.kpi));
 document.querySelectorAll('[data-goto]').forEach(b=>b.onclick=()=>app.go(b.dataset.goto));
 document.querySelector('[data-quick-add]')?.addEventListener('click',()=>import('./quick-add.js').then(m=>m.openQuickAdd(app)));
 document.querySelectorAll('[data-open-rec]').forEach(b=>b.onclick=()=>app.go('rec:'+b.dataset.openRec));
 document.querySelectorAll('[data-recent]').forEach(b=>b.onclick=()=>app.go(b.dataset.recent));
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
