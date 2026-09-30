// الصفحة الرئيسية: تحية + مؤشرات العمل + آخر ما فُتح + إجراءات سريعة + أجندة بتقويم شهري.
// كل بطاقة وكل صف قابل للنقر: قاعدة المنتج — أي معلومة تظهر على الشاشة تفتح سجلها بنقرة.
import {esc} from '../ui/dom.js';
import {mountCalendar} from '../ui/calendar.js';
import {mountGrid} from '../ui/datagrid.js';
import {agenda,agendaMarks,resolveRefs} from '../services/entity-query.js';
import {fmtDate,label} from '../domain/entities.js';
import {localDate,addDays} from '../core/clock.js';
import {formatDate,formatNumber,longDateAr,greetingKey,GREETINGS} from '../core/format.js';
import {getRecent} from '../services/recents.js';
import {getFavorites} from '../services/favorites.js';
import {prefs} from '../core/preferences.js';
import {dateSignal} from '../ui/signals.js';
import {card,cardEmpty,statusBadge} from '../ui/card.js';

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
 const favs=getFavorites().slice(0,8);
 const last=prefs.get('ui:last-route');
 let demoBanner='';
 try{const meta=await app.office.r.meta.get('demoSeed');if(meta?.seeded)demoBanner=`<div class="notice demo-banner" role="status"><b>بيانات تجريبية</b> السجلات المعلَّمة بـ〔تجريبي〕 للاختبار فقط، ولن تُحذف تلقائيًا. احذفها بنفسك عندما تنتهي.</div>`}catch{}
 const workRow=(route,main,mid,sub,sig)=>`<button class="work-row work-click" data-open-rec="${esc(route)}"><b>${esc(main||'—')}</b><span>${esc(mid||'')}</span><small>${esc(sub||'')}${sig?` · ${esc(sig.text)}`:''}</small></button>`;
 const kpis=[
  KPI('t',r.todayHearings.length,'جلسات اليوم','hearings?preset=today'),
  KPI('o',r.overdueProcedures.length,'أعمال متأخرة','procedures?preset=overdue',r.overdueProcedures.length?'warn':''),
  KPI('w',r.upcomingHearings.length,'جلسات هذا الأسبوع','hearings?preset=week'),
  KPI('p',r.upcomingProcedures.length,'أعمال هذا الأسبوع','procedures?preset=week'),
  KPI('a',r.appointmentsNext3.length,'مواعيد خلال 3 أيام','appointments?preset=upcoming'),
  KPI('f',r.followupsThisWeek.length,'متابعات اتصال','communications?preset=week'),
  KPI('s',r.staleFiles.length,'ملفات بلا نشاط','actionCenter',r.staleFiles.length?'warn':'')
 ];
 return `${demoBanner}<div class="hero hero-home"><div><h2>${g}، مكتب الأستاذ أحمد محمد خضير</h2><p class="hero-date">${longDateAr()}</p></div>
  <div class="hero-quick"><button class="primary" data-quick-add>+ إضافة</button><button class="ghost" data-goto="actionCenter">مركز العمل</button><button class="ghost" data-goto="reports?type=hearings&preset=today">تقرير اليوم</button>${last?.route&&last.route!=='dashboard'?`<button class="ghost resume-chip" data-goto="${esc(last.route)}">متابعة: ${esc(last.title||'آخر صفحة')}</button>`:''}</div></div>
 ${favs.length?card({icon:'folder',title:'مثبّتات',size:'full',collapsible:true,persistKey:'home:favs',badge:statusBadge(String(favs.length),'info'),body:`<div class="fav-row">${favs.map(x=>`<button class="recent-chip" data-goto="${esc(x.route)}">${esc(x.title)}</button>`).join('')}</div>`}):''}
 <section class="panel kpi-panel" data-collapse-id="home-kpis"><div class="panel-head"><h3>ملخص العمل</h3><span class="badge">${kpis.length} مؤشرات</span></div><div class="kpi-strip" role="group" aria-label="ملخص العمل">${kpis.join('')}</div></section>
 ${recents.length?`<section class="recents-bar" aria-label="آخر ما فُتح"><span class="recents-lbl">آخر ما فُتح:</span><div class="recents-chips">${recents.map(x=>`<button class="recent-chip" data-recent="${esc(x.route)}"><span class="rc-ic" aria-hidden="true">${esc(x.icon==='calendar'?'📅':x.icon==='users'?'👤':x.icon==='gavel'?'⚖':'📁')}</span><span class="rc-t">${esc(x.title)}</span></button>`).join('')}</div></section>`:''}
 <div class="dashboard-grid ux-grid ux-grid--2">
  ${card({icon:'calendar',title:'جلسات اليوم',tone:r.todayHearings.length?'':'',badge:statusBadge(String(r.todayHearings.length),r.todayHearings.length?'info':''),actions:`<button class="link" data-dashboard-report="hearings|today">تقرير الجلسات</button>`,collapsible:true,persistKey:'home:todayHearings',
   body:r.todayHearings.length?r.todayHearings.slice(0,12).map(x=>workRow('hearings:'+x.id,x.hearingTime||'بدون وقت',x.reason||x.type||'جلسة',`${d(x.hearingDate)}${x.caseNumber?' — قضية '+x.caseNumber:''}`,{text:'جلسة اليوم'})).join(''):cardEmpty('لا توجد جلسات مسجلة اليوم.',{icon:'calendar'})})}
  ${card({icon:'clipboard',title:'الأعمال الإدارية المتأخرة',tone:r.overdueProcedures.length?'warn':'',badge:statusBadge(String(r.overdueProcedures.length),r.overdueProcedures.length?'danger':''),actions:`<button class="link" data-dashboard-report="procedures|overdue">تقرير الأعمال</button>`,collapsible:true,persistKey:'home:overdue',
   body:r.overdueProcedures.length?r.overdueProcedures.slice(0,12).map(x=>workRow('procedures:'+x.id,d(x.internalDueDate)||'بدون تاريخ',x.description||x.type||'إجراء',label(x.priority||'normal'),{text:'عمل مطلوب'})).join(''):cardEmpty('لا توجد أعمال إدارية متأخرة.',{icon:'check'})})}
  ${card({icon:'calendar',title:'الجلسات القادمة',badge:statusBadge(String(r.upcomingHearings.length),''),actions:`<button class="link" data-dashboard-report="hearings|week">هذا الأسبوع</button>`,collapsible:true,persistKey:'home:upcomingHearings',
   body:r.upcomingHearings.length?r.upcomingHearings.slice(0,12).map(x=>{const sig=dateSignal(x.hearingDate);return workRow('hearings:'+x.id,d(x.hearingDate),`${x.hearingTime||''} — ${x.reason||x.type||'جلسة'}`,x.caseNumber?`قضية ${x.caseNumber}`:'',sig?{text:sig.text==='اليوم'?'جلسة اليوم':sig.text==='غدًا'?'جلسة غدًا':'جلسة '+sig.text}:null)}).join(''):cardEmpty('لا توجد جلسات قادمة ضمن الفترة المعروضة.',{icon:'calendar'})})}
  ${card({icon:'clipboard',title:'أعمال إدارية قادمة',badge:statusBadge(String(r.upcomingProcedures.length),''),actions:`<button class="link" data-dashboard-report="procedures|week">هذا الأسبوع</button>`,collapsible:true,persistKey:'home:upcomingProcedures',
   body:r.upcomingProcedures.length?r.upcomingProcedures.slice(0,12).map(x=>{const sig=dateSignal(x.internalDueDate);return workRow('procedures:'+x.id,d(x.internalDueDate),x.description||x.type||'إجراء',label(x.status||'pending'),sig?{text:'عمل '+sig.text}:null)}).join(''):cardEmpty('لا توجد أعمال إدارية قادمة ضمن الفترة المعروضة.',{icon:'clipboard'})})}
 </div>
 ${card({icon:'report',title:'تقارير العمل السريع',size:'full',cls:'daily-shortcuts',collapsible:true,persistKey:'home:shortcuts',
  body:`<div class="shortcut-grid"><button data-dashboard-report="hearings|tomorrow">جلسات غدًا</button><button data-dashboard-report="hearings|nextWeek">جلسات الأسبوع التالي</button><button data-dashboard-report="hearings|month">جلسات هذا الشهر</button><button data-dashboard-report="procedures|tomorrow">أعمال غدًا</button><button data-dashboard-report="procedures|nextWeek">أعمال الأسبوع التالي</button><button data-dashboard-report="procedures|month">أعمال هذا الشهر</button><button data-route-report="clients">الموكلون</button><button data-route-report="cases">القضايا</button></div>`})}
 ${card({icon:'calendar',title:'الأجندة',size:'lg',cls:'agenda',collapsible:true,persistKey:'home:agenda',
  actions:`<div class="agenda-modes" role="group" aria-label="طريقة عرض الأجندة"><button type="button" data-agenda-mode="day">يوم</button><button type="button" data-agenda-mode="week">أسبوع</button><button type="button" data-agenda-mode="month">شهر</button><button type="button" data-agenda-mode="list">قائمة</button></div>`,
  body:`<div class="agenda-layout" id="agenda-layout"><div id="home-calendar"></div><div class="agenda-day"><h4 id="agenda-title"></h4><div id="agenda-grid"></div></div></div>`})}`;
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
 const grid=mountGrid(document.querySelector('#agenda-grid'),{columns:cols,rows:[],title:'الأجندة',storageKey:'home:agenda',collapseKey:'home:agenda:grid',emptyText:'لا توجد عناصر في هذه الفترة.',
  onRowClick:r=>app.go(r.store==='files'?'file:'+r.id:`rec:${r.store}:${r.id}`)});
 app.__agendaDay=app.__agendaDay||localDate();
 app.__agendaMode=app.__agendaMode||prefs.get('ui:agenda-mode','day')||'day';
 const weekStart=day=>{const dow=new Date(day+'T00:00:00').getDay();return addDays(day,-((dow+1)%7))};
 const rangeOf=(mode,day)=>{
  if(mode==='week'){const a=weekStart(day);return [a,addDays(a,6)]}
  if(mode==='month'){const [y,m]=day.split('-');const last=new Date(Number(y),Number(m),0).getDate();return [`${y}-${m}-01`,`${y}-${m}-${String(last).padStart(2,'0')}`]}
  if(mode==='list')return [localDate(),addDays(localDate(),21)];
  return [day,day];
 };
 const paintModes=()=>{document.querySelectorAll('[data-agenda-mode]').forEach(b=>b.classList.toggle('on',b.dataset.agendaMode===app.__agendaMode));document.querySelector('#agenda-layout')?.classList.toggle('is-list',app.__agendaMode==='list')};
 const showDay=async d=>{
  app.__agendaDay=d;paintModes();
  const [from,to]=rangeOf(app.__agendaMode,d);
  const title=app.__agendaMode==='day'?`عناصر يوم ${fmtDate(d)}`:app.__agendaMode==='week'?`أسبوع ${fmtDate(from)} — ${fmtDate(to)}`:app.__agendaMode==='month'?`شهر ${fmtDate(from).slice(3)}`:`القادمة حتى ${fmtDate(to)}`;
  document.querySelector('#agenda-title').textContent=title;
  const rows=await agenda(app.office,from,to);
  await resolveRefs(app.office,rows,[{k:'fileId',ref:'files'},{k:'caseId',ref:'cases'}],refs);
  grid.setRows(rows);
 };
 document.querySelectorAll('[data-agenda-mode]').forEach(b=>b.onclick=()=>{app.__agendaMode=b.dataset.agendaMode;prefs.set('ui:agenda-mode',app.__agendaMode);showDay(app.__agendaDay).catch(e=>app.fail(e))});
 mountCalendar(document.querySelector('#home-calendar'),{selected:app.__agendaDay,onMonthChange:(y,m)=>agendaMarks(app.office,y,m),onSelect:d=>showDay(d).catch(e=>app.fail(e))});
 showDay(app.__agendaDay).catch(e=>app.fail(e));
}
