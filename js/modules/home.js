// مكتب اليوم (الرئيسية) — v6 — Daily Cockpit
// ---------------------------------------------------------------------
// من «لوحة مؤشرات» إلى «مكتب يجيب عن الأسئلة الخمسة»:
//   1) الآن .......... ما الذي يجب فعله الآن؟ (الخطوة التالية بإجراء واحد)
//   2) يحتاج انتباهك .. ما الذي يحتاج قرارًا؟ (طابور مرتب بالأهمية + فلاتر)
//   3) جدول اليوم .... ما الذي يقع اليوم بالترتيب الزمني؟
//   4) ما حدث؟ ....... آخر تحركات السجل
//   5) ملخص وتفاصيل .. المؤشرات، الأجندة، التقارير، والمثبّتات — كما كانت
// كل بيانات الصفحة تأتي من dashboardBrief() الموجودة؛ محرّك التركيز دالة نقيّة فوقها.
// كل عنصر يعرض معلومة يفتح سجلها بنقرة (قاعدة المنتج).
import {esc} from '../ui/dom.js';
import {mountCalendar} from '../ui/calendar.js';
import {mountGrid} from '../ui/datagrid.js';
import {legalFileColumns} from '../ui/grid-columns.js';
import {createGridRelations} from '../services/grid-relations.js';
import {agenda,agendaMarks,resolveRefs} from '../services/entity-query.js';
import {fmtDate,label} from '../domain/entities.js';
import {localDate,addDays} from '../core/clock.js';
import {formatDate,formatNumber,longDateAr,greetingKey,GREETINGS} from '../core/format.js';
import {getRecent} from '../services/recents.js';
import {getFavorites} from '../services/favorites.js';
import {prefs,scopedPreferenceKey} from '../core/preferences.js';
import {dateSignal} from '../ui/signals.js';
import {card,cardEmpty,statusBadge} from '../ui/card.js';
import {registerPageLayout,openPageCustomizer} from '../ui/page-layout.js';
import {buildFocusModel} from '../services/focus-engine.js';
import {focusHtml,attentionHtml,timelineHtml,activityHtml,sinceHtml,bindCockpit} from '../ui/cockpit.js';
import {HOME_LIMITS} from '../services/work-config.js';
import {readStoredSeen,markHomeSeen,sinceChanges} from '../services/home-visit.js';

// أقسام الصفحة في نظام ترتيب الأقسام المركزي (ترتيب/إظهار من «تخصيص الصفحة»).
registerPageLayout({pageId:'dashboard',title:'مكتب اليوم',sections:[
 {id:'focus',title:'الآن — الخطوة التالية',icon:'◉'},
 {id:'today',title:'جدول اليوم',icon:'◷'},
 {id:'attention',title:'يحتاج انتباهك',icon:'⚑'},
 {id:'since',title:'منذ آخر زيارة',icon:'⟲'},
 {id:'kpis',title:'ملخص العمل',icon:'◈'},
 {id:'activity',title:'ما الذي حدث؟',icon:'≋'},
 {id:'favs',title:'مثبّتات',icon:'★'},
 {id:'agenda',title:'الأجندة',icon:'📅'},
 {id:'shortcuts',title:'تقارير العمل السريع',icon:'▤'},
 {id:'recents',title:'آخر ما فُتح',icon:'🕘'}]});

let __lastBrief=null;
// «منذ آخر زيارة»: خط الأساس يُحسب مرة عند دخول مكتب اليوم، لا عند كل إعادة رسم داخل الصفحة نفسها.
let homeSession=null; // {scope, baseline}
let leaveApp=null, leaveBound=false;
export const homeScope=app=>app?.ctx?.profile?.id||app?.office?.ctx?.profile?.id||'';
function homeBaseline(scope){
 if(!homeSession||homeSession.scope!==scope)homeSession={scope,baseline:readStoredSeen(scope)};
 return homeSession.baseline;
}
/** يُستدعى عند مغادرة مكتب اليوم (تنقل داخلي أو إخفاء التبويب): يسجل وقت الزيارة في التفضيلات فقط. */
export async function leaveHome(app){
 const scope=homeScope(app);
 homeSession=null;
 await markHomeSeen(scope).catch(()=>false);
}
function bindHomeLeave(app){
 leaveApp=app;
 if(leaveBound)return;leaveBound=true;
 const hide=()=>{if(leaveApp?.route==='dashboard')leaveHome(leaveApp)};
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')hide()});
 window.addEventListener('pagehide',hide);
}
const KPI=(k,n,txt,route,accent='')=>`<button class="kpi${accent?` kpi-${accent}`:''}" data-kpi="${esc(route)}"><b>${formatNumber(n)}${n>=100?'+':''}</b><span>${esc(txt)}</span></button>`;

export async function homePage(app){
 const {dashboardBrief}=await import('../services/dashboard.js');
 const r=await dashboardBrief(app.office);__lastBrief=r;
 const today=localDate();
 const nowHM=new Date().toTimeString().slice(0,5);
 const g=GREETINGS[greetingKey()];
 const scope=app.ctx?.profile?.id||app.office?.ctx?.profile?.id||'';
 const recents=getRecent(scope).slice(0,8);
 const favs=getFavorites(scope).slice(0,8);
 const last=prefs.get(scopedPreferenceKey('ui:last-route',scope));
 const focus=buildFocusModel(r,{today,now:nowHM});
 // «منذ آخر زيارة»: أول تشغيل بلا خط أساس ⇒ لا قسم. لا كتابة هنا؛ الكتابة عند المغادرة فقط.
 const sinceBase=homeBaseline(scope);
 const sinceRaw=sinceBase?await app.office.r.activityLog.reportRange({index:'timestamp',lower:sinceBase,upper:'\uffff',direction:'prev',limit:HOME_LIMITS.sinceLastVisit+1}).catch(()=>[]):[];
 const since=sinceChanges(sinceRaw,sinceBase);
 // «ما الذي حدث؟» — آخر تحركات السجل (قراءة محدودة بالفهرس الزمني، بلا مسح كامل).
 const activity=await app.office.r.activityLog.reportRange({index:'timestamp',lower:'0000-01-01',upper:'\uffff',direction:'prev',limit:6}).catch(()=>[]);
 let demoBanner='';
 // تلميح تثبيت واحد وغير مزعج: يظهر بعد استخدام فعلي فقط، ومرة واحدة، وله «لاحقًا» تُسكِته.
 let installHint='';
 try{if(app.pwaInstall?.shouldHint?.()){app.pwaInstall.markHintShown();installHint=`<div class="notice install-hint" role="status"><span><b>📲 تثبيت التطبيق</b> يمكنك تثبيت البرنامج على الهاتف فيعمل من أيقونته الخاصة وبلا إنترنت — بياناتك تبقى على جهازك.</span><span class="install-hint-actions"><button class="primary" type="button" data-install-now>تثبيت الآن</button><button class="ghost" type="button" data-install-later>لاحقًا</button></span></div>`}}catch{}
 try{
  const meta=await app.office.r.meta.get('demoSeed');
  const probe=meta?.seeded?true:await import('../services/demo-data.js').then(m=>m.hasDemoData(app.office)).catch(()=>false);
  if(probe)demoBanner=`<div class="notice demo-banner" role="status"><b>بيانات تجريبية</b> السجلات المعلَّمة بـ〔تجريبي〕 للاختبار فقط. زر واحد يحذفها كلها مع كل ما يرتبط بها.</div><div class="notice demo-cleanup-panel"><span class="demo-cleanup-txt" data-demo-count>جارٍ فحص البيانات التجريبية…</span><button type="button" class="ghost danger" data-demo-cleanup title="حذف كل السجلات التجريبية وكل ما يرتبط بها دفعة واحدة">🗑 حذف كل البيانات التجريبية</button></div>`}catch{}
 const kpis=[
  KPI('t',r.todayHearings.length,'جلسات اليوم','hearings?preset=today'),
  KPI('o',r.overdueProcedures.length,'أعمال متأخرة','procedures?preset=overdue',r.overdueProcedures.length?'warn':''),
  KPI('w',r.upcomingHearings.length,'جلسات هذا الأسبوع','hearings?preset=week'),
  KPI('p',r.upcomingProcedures.length,'أعمال هذا الأسبوع','procedures?preset=week'),
  KPI('a',r.appointmentsNext3.length,'مواعيد خلال 3 أيام','appointments?preset=upcoming'),
  KPI('f',r.followupsThisWeek.length,'متابعات اتصال','communications?preset=week'),
  KPI('s',r.staleFiles.length,'ملفات بلا نشاط','actionCenter',r.staleFiles.length?'warn':''),
  KPI('x',(r.expiringPoa?.length||0)+(r.expiredPoa?.length||0),'توكيلات منتهية أو تنتهي خلال ٣٠ يومًا','powersOfAttorney',(r.expiredPoa?.length||r.expiringPoa?.length)?'warn':'')
 ];
 const dayLabel=longDateAr();
 // سطر الحالة: أهم ثلاثة أرقام في جملة واحدة قابلة للقراءة من أول نظرة.
 const decisions=focus.counts.critical+focus.counts.high;
 const summaryParts=[
  r.todayHearings.length?`<b>${formatNumber(r.todayHearings.length)}</b> جلسة اليوم`:'لا جلسات اليوم',
  r.overdueProcedures.length?`<b class="is-warn">${formatNumber(r.overdueProcedures.length)}</b> عمل متأخر`:'لا أعمال متأخرة',
  decisions?`<b>${formatNumber(decisions)}</b> يحتاج قرارك`:'لا قرارات عاجلة'
 ];
 return `${demoBanner}${installHint}
 <header class="cp-hero">
  <div class="cp-hero-text">
   <span class="cp-eyebrow">مكتب اليوم</span>
   <h2>${g}، مكتب الأستاذ أحمد محمد خضير</h2>
   <p class="hero-date">${dayLabel}</p>
   <p class="cp-summary">${summaryParts.join('<span aria-hidden="true"> · </span>')}</p>
  </div>
  <div class="cp-hero-actions">
   <button class="primary" data-quick-add>+ إضافة</button>
   <button class="ghost" data-goto="actionCenter">مركز العمل</button>
   <button class="ghost" data-goto="reports?type=hearings&preset=today">تقرير اليوم</button>
   ${last?.route&&last.route!=='dashboard'?`<button class="ghost resume-chip" data-goto="${esc(last.route)}">متابعة: ${esc(last.title||'آخر صفحة')}</button>`:''}
   <button class="ghost" data-customize-page title="ترتيب الأقسام وإظهارها وإعدادات العرض">⚙ تخصيص</button>
  </div>
 </header>
 ${favs.length?card({icon:'folder',title:'مثبّتات',size:'full',collapsible:true,persistKey:'home:favs',sectionId:'favs',pageId:'dashboard',badge:statusBadge(String(favs.length),'info'),body:`<div class="fav-row">${favs.map(x=>`<button class="recent-chip" data-goto="${esc(x.route)}">${esc(x.title)}</button>`).join('')}</div>`}):''}
 <div class="cp-stage">
  ${focusHtml(focus,{dayLabel})}
  ${timelineHtml(focus,{dayLabel:`يوم ${fmtDate(today)}`})}
 </div>
 ${attentionHtml(focus)}
 ${sinceHtml(since)}
 <section class="panel kpi-panel" data-collapse-id="home-kpis" data-section-id="kpis"><div class="panel-head"><h3>ملخص العمل</h3><span class="badge">${kpis.length} مؤشرات</span></div><div class="kpi-strip" role="group" aria-label="ملخص العمل">${kpis.join('')}</div></section>
 ${activityHtml(activity)}
${card({icon:'report',title:'تقارير العمل السريع',size:'full',cls:'daily-shortcuts',collapsible:true,persistKey:'home:shortcuts',sectionId:'shortcuts',pageId:'dashboard',
  body:`<div class="shortcut-grid"><button data-dashboard-report="hearings|tomorrow">جلسات غدًا</button><button data-dashboard-report="hearings|nextWeek">جلسات الأسبوع التالي</button><button data-dashboard-report="hearings|month">جلسات هذا الشهر</button><button data-dashboard-report="procedures|tomorrow">أعمال غدًا</button><button data-dashboard-report="procedures|nextWeek">أعمال الأسبوع التالي</button><button data-dashboard-report="procedures|month">أعمال هذا الشهر</button><button data-route-report="clients">الموكلون</button><button data-route-report="cases">القضايا</button></div>`})}
 ${card({icon:'calendar',title:'الأجندة',size:'lg',cls:'agenda',collapsible:true,persistKey:'home:agenda',sectionId:'agenda',pageId:'dashboard',
  actions:`<div class="agenda-modes" role="group" aria-label="طريقة عرض الأجندة"><button type="button" data-agenda-mode="day">يوم</button><button type="button" data-agenda-mode="week">أسبوع</button><button type="button" data-agenda-mode="month">شهر</button><button type="button" data-agenda-mode="list">قائمة</button></div>`,
  body:`<div class="agenda-layout" id="agenda-layout"><div id="home-calendar"></div><div class="agenda-day"><h4 id="agenda-title"></h4><div id="agenda-grid"></div></div></div>`})}
 ${recents.length?card({icon:'clock',title:'آخر ما فُتح',size:'full',cls:'recents-section',collapsible:true,collapsed:true,persistKey:'home:recents',sectionId:'recents',pageId:'dashboard',summary:'السجلات التي فتحتها مؤخرًا — تُفتح بنقرة، والقسم مطوي افتراضيًا لتبقى الصفحة نظيفة',badge:statusBadge(String(recents.length),'info'),
  body:`<div class="recents-bar"><div class="recents-chips">${recents.map(x=>`<button class="recent-chip" data-recent="${esc(x.route)}"><span class="rc-ic" aria-hidden="true">${esc(x.icon==='calendar'?'📅':x.icon==='users'?'👤':x.icon==='gavel'?'⚖':'📁')}</span><span class="rc-t">${esc(x.title)}</span></button>`).join('')}</div></div>`}):''}`;
}

export function bindHome(app){
 // شريط الأعداد والطابور: فلترة بالأهمية بلا إعادة رسم.
 bindCockpit(document.querySelector('#main-content'),app);
 bindHomeLeave(app);
 // شارة «مركز العمل» في الشريط الجانبي: عدّاد حي من محرك مركز العمل نفسه (المتأخر + اليوم)، بلا استعلام مكرر.
 import('../ui/work-badge.js').then(m=>m.scheduleWorkBadge(app,{force:true})).catch(()=>{});
 // حذف البيانات التجريبية دفعة واحدة: زر واحد في اللافتة أعلى الصفحة الرئيسية.
 if(document.querySelector('[data-demo-cleanup]'))import('../ui/demo-cleanup.js').then(m=>{
  m.refreshDemoCount(app);
  return m.bindDemoCleanup(app,{statusEl:document.querySelector('[data-demo-count]'),onDone:()=>app.refresh()});
 }).catch(e=>console.error('demo cleanup',e));
 document.querySelectorAll('[data-dashboard-report]').forEach(b=>b.onclick=()=>{const [type,preset]=b.dataset.dashboardReport.split('|');app.go('reports?type='+encodeURIComponent(type)+'&preset='+encodeURIComponent(preset))});
 document.querySelectorAll('[data-route-report]').forEach(b=>b.onclick=()=>app.go('reports?type='+encodeURIComponent(b.dataset.routeReport)));
 document.querySelectorAll('[data-kpi]').forEach(b=>b.onclick=()=>app.go(b.dataset.kpi));
 document.querySelectorAll('[data-goto]').forEach(b=>b.onclick=()=>app.go(b.dataset.goto));
 document.querySelector('[data-quick-add]')?.addEventListener('click',()=>import('./quick-add.js').then(m=>m.openQuickAdd(app)));
 document.querySelector('[data-install-now]')?.addEventListener('click',async()=>{const m=await import('../ui/install-prompt.js');await m.installApp(app);document.querySelector('.install-hint')?.remove()});
 document.querySelector('[data-install-later]')?.addEventListener('click',()=>{app.pwaInstall?.dismissHint?.();document.querySelector('.install-hint')?.remove()});
 document.querySelector('[data-customize-page]')?.addEventListener('click',()=>openPageCustomizer(app,{pageId:'dashboard'}));
 document.querySelectorAll('[data-open-rec]').forEach(b=>b.onclick=()=>app.go('rec:'+b.dataset.openRec));
 document.querySelectorAll('[data-recent]').forEach(b=>b.onclick=()=>app.go(b.dataset.recent));
 const refs=new Map();
 const relations=createGridRelations(app.office,'agenda');
 const cols=[
  ...legalFileColumns(relations),
  {key:'kind',label:'النوع'},{key:'date',label:'التاريخ',type:'date',text:r=>fmtDate(r.date)},{key:'time',label:'الوقت'},
  {key:'title',label:'البيان'},{key:'details',label:'التفاصيل'},{key:'status',label:'الحالة',text:r=>label(r.status)||''},
  {key:'caseId',label:'القضية / المرحلة',get:r=>refs.get(r.caseId)||'',text:r=>refs.get(r.caseId)||''}];
 const grid=mountGrid(document.querySelector('#agenda-grid'),{columns:cols,rows:[],title:'الأجندة',storageKey:'home:agenda',collapseKey:'home:agenda:grid',emptyText:'لا توجد عناصر في هذه الفترة.',
  ...relations.gridOptions(()=>{const [from,to]=rangeOf(app.__agendaMode,app.__agendaDay);return {filters:[`الفترة: ${fmtDate(from)} — ${fmtDate(to)}`]}}),
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
  await Promise.all([resolveRefs(app.office,rows,[{k:'caseId',ref:'cases'}],refs),relations.hydrate(rows)]);
  grid.setRows(rows);
 };
 document.querySelectorAll('[data-agenda-mode]').forEach(b=>b.onclick=()=>{app.__agendaMode=b.dataset.agendaMode;prefs.set('ui:agenda-mode',app.__agendaMode);showDay(app.__agendaDay).catch(e=>app.fail(e))});
 mountCalendar(document.querySelector('#home-calendar'),{selected:app.__agendaDay,onMonthChange:(y,m)=>agendaMarks(app.office,y,m),onSelect:d=>showDay(d).catch(e=>app.fail(e))});
 showDay(app.__agendaDay).catch(e=>app.fail(e));
}
