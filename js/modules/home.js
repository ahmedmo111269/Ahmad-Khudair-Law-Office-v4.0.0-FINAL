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
import {registerPageLayout,openPageCustomizer,applyPageDisplay,applyPageLayout} from '../ui/page-layout.js';
import {enhanceCollapsiblePanels} from '../ui/collapsible.js';
import {applyUniversalStyles} from '../ui/component-customizer.js';
import {buildFocusModel} from '../services/focus-engine.js';
import {focusHtml,attentionHtml,timelineHtml,activityHtml,sinceHtml,bindCockpit} from '../ui/cockpit.js';
import {HOME_LIMITS,getWorkConfig} from '../services/work-config.js';
import {tomorrowPrepCandidate} from '../services/tomorrow-prep.js';
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
 // عند مغادرة «مكتب اليوم» لا يعود hook التحديث الموضعي يتدخل.
 app.__refreshAfterAction=null;
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

/**
 * تحميل بيانات مكتب اليوم مرة واحدة (brief + «منذ آخر زيارة» + «ما الذي حدث؟»).
 * البيانات نفسها في أول عرض للصفحة وفي التحديث بعد أي إجراء.
 */
async function loadHomeData(app){
 const {dashboardBrief}=await import('../services/dashboard.js');
 const r=await dashboardBrief(app.office);__lastBrief=r;
 const today=localDate();
 const nowHM=new Date().toTimeString().slice(0,5);
 const focus=buildFocusModel(r,{today,now:nowHM});
 app.__homeFocusModel=focus;
 // «منذ آخر زيارة»: أول تشغيل بلا خط أساس ⇒ لا قسم. لا كتابة هنا؛ الكتابة عند المغادرة فقط.
 const scope=homeScope(app);
 const sinceBase=homeBaseline(scope);
 const sinceRaw=sinceBase?await app.office.r.activityLog.reportRange({index:'timestamp',lower:sinceBase,upper:'\uffff',direction:'prev',limit:HOME_LIMITS.sinceLastVisit+1}).catch(()=>[]):[];
 const since=sinceChanges(sinceRaw,sinceBase);
 // «ما الذي حدث؟» — آخر 6 حركات (قراءة محدودة بالفهرس الزمني، بلا مسح كامل).
 // إذا وُجدت 6 حركات على الأقل بعد خط الأساس، فآخر 6 حركات "الكل" هي نفسها — استعلام واحد يكفي.
 let activity;
 if(sinceRaw.length>=6)activity=sinceRaw.slice(0,6);
 else activity=await app.office.r.activityLog.reportRange({index:'timestamp',lower:'0000-01-01',upper:'\uffff',direction:'prev',limit:6}).catch(()=>[]);
 return {r,focus,since,activity,today,nowHM,scope};
}

/** شرائط مؤشرات «ملخص العمل» — نفس القائمة في أول render وفي التحديث الموضعي. */
function buildKpis(r){
 return [
  KPI('t',r.todayHearings.length,'جلسات اليوم','hearings?preset=today'),
  KPI('o',r.overdueProcedures.length,'أعمال متأخرة','procedures?preset=overdue',r.overdueProcedures.length?'warn':''),
  KPI('w',r.upcomingHearings.length,'جلسات هذا الأسبوع','hearings?preset=week'),
  KPI('p',r.upcomingProcedures.length,'أعمال هذا الأسبوع','procedures?preset=week'),
  KPI('a',r.appointmentsNext3.length,'مواعيد خلال 3 أيام','appointments?preset=upcoming'),
  KPI('f',r.followupsThisWeek.length,'متابعات اتصال','communications?preset=week'),
  KPI('s',r.staleFiles.length,'ملفات بلا نشاط','actionCenter',r.staleFiles.length?'warn':''),
  KPI('x',(r.expiringPoa?.length||0)+(r.expiredPoa?.length||0),'توكيلات منتهية أو تنتهي خلال ٣٠ يومًا','powersOfAttorney',(r.expiredPoa?.length||r.expiringPoa?.length)?'warn':'')
 ];
}

/** قسم «ملخص العمل» كـ HTML — نفسه في أول render وفي التحديث الموضعي. */
function kpisSectionHtml(r){
 const kpis=buildKpis(r);
 return `<section class="panel kpi-panel" data-collapse-id="home-kpis" data-section-id="kpis"><div class="panel-head"><h3>ملخص العمل</h3><span class="badge">${kpis.length} مؤشرات</span></div><div class="kpi-strip" role="group" aria-label="ملخص العمل">${kpis.join('')}</div></section>`;
}

/** سطر الحالة في الـ hero — أهم ثلاثة أرقام في جملة واحدة. */
function summaryHtml(r,focus){
 const decisions=focus.counts.critical+focus.counts.high;
 const summaryParts=[
  r.todayHearings.length?`<b>${formatNumber(r.todayHearings.length)}</b> جلسة اليوم`:'لا جلسات اليوم',
  r.overdueProcedures.length?`<b class="is-warn">${formatNumber(r.overdueProcedures.length)}</b> عمل متأخر`:'لا أعمال متأخرة',
  decisions?`<b>${formatNumber(decisions)}</b> يحتاج قرارك`:'لا قرارات عاجلة'
 ];
 return summaryParts.join('<span aria-hidden="true"> · </span>');
}

/** إشارة صغيرة فقط قبل الغد: تظهر بعد الوقت المضبوط ومع فجوة تشغيلية واضحة. */
function tomorrowPrepHtml(brief){
 const prep=tomorrowPrepCandidate(brief,{now:new Date().toTimeString().slice(0,5),after:getWorkConfig().tomorrowPrepAfter});
 if(!prep)return '';
 const hearing=prep.item;
 const gap=prep.kind==='missingFile'?'لا يوجد ملف مرتبط':'لا يوجد وقت محدد';
 const title=hearing.reason||hearing.type||'جلسة';
 return `<aside class="notice home-tomorrow-prep" data-home-tomorrow-prep role="status"><span><b>تحضير الغد</b> — جلسة غدًا «${esc(title)}» ${gap}; راجع بياناتها قبل الجلسة.</span><button type="button" class="ghost small" data-route="rec:hearings:${esc(hearing.id)}">فتح الجلسة</button></aside>`;
}

export async function homePage(app){
 const {r,focus,since,activity,today,scope}=await loadHomeData(app);
 const g=GREETINGS[greetingKey()];
 const recents=getRecent(scope).slice(0,8);
 const favs=getFavorites(scope).slice(0,8);
 const last=prefs.get(scopedPreferenceKey('ui:last-route',scope));
 let demoBanner='';
 // تلميح تثبيت واحد وغير مزعج: يظهر بعد استخدام فعلي فقط، ومرة واحدة، وله «لاحقًا» تُسكِته.
 let installHint='';
 try{if(app.pwaInstall?.shouldHint?.()){app.pwaInstall.markHintShown();installHint=`<div class="notice install-hint" role="status"><span><b>📲 تثبيت التطبيق</b> يمكنك تثبيت البرنامج على الهاتف فيعمل من أيقونته الخاصة وبلا إنترنت — بياناتك تبقى على جهازك.</span><span class="install-hint-actions"><button class="primary" type="button" data-install-now>تثبيت الآن</button><button class="ghost" type="button" data-install-later>لاحقًا</button></span></div>`}}catch{}
 try{
  const meta=await app.office.r.meta.get('demoSeed');
  const probe=meta?.seeded?true:await import('../services/demo-data.js').then(m=>m.hasDemoData(app.office)).catch(()=>false);
  if(probe)demoBanner=`<div class="notice demo-banner" role="status"><b>بيانات تجريبية</b> السجلات المعلَّمة بـ〔تجريبي〕 للاختبار فقط. زر واحد يحذفها كلها مع كل ما يرتبط بها.</div><div class="notice demo-cleanup-panel"><span class="demo-cleanup-txt" data-demo-count>جارٍ فحص البيانات التجريبية…</span><button type="button" class="ghost danger" data-demo-cleanup title="حذف كل السجلات التجريبية وكل ما يرتبط بها دفعة واحدة">🗑 حذف كل البيانات التجريبية</button></div>`}catch{}
 const dayLabel=longDateAr();
 const tomorrowPrep=tomorrowPrepHtml(r);
 return `${demoBanner}${installHint}${tomorrowPrep}
 <header class="cp-hero">
  <div class="cp-hero-text">
   <span class="cp-eyebrow">مكتب اليوم</span>
   <h2>${g}، مكتب الأستاذ أحمد محمد خضير</h2>
   <p class="hero-date">${dayLabel}</p>
   <p class="cp-summary">${summaryHtml(r,focus)}</p>
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
  ${focusHtml(focus,{dayLabel,focusMode:Boolean(app.__homeFocusMode)})}
  ${timelineHtml(focus,{dayLabel:`يوم ${fmtDate(today)}`})}
 </div>
 ${attentionHtml(focus)}
 ${sinceHtml(since)}
 ${kpisSectionHtml(r)}
 ${activityHtml(activity)}
${card({icon:'report',title:'تقارير العمل السريع',size:'full',cls:'daily-shortcuts',collapsible:true,persistKey:'home:shortcuts',sectionId:'shortcuts',pageId:'dashboard',
  body:`<div class="shortcut-grid"><button data-dashboard-report="hearings|tomorrow">جلسات غدًا</button><button data-dashboard-report="hearings|nextWeek">جلسات الأسبوع التالي</button><button data-dashboard-report="hearings|month">جلسات هذا الشهر</button><button data-dashboard-report="procedures|tomorrow">أعمال غدًا</button><button data-dashboard-report="procedures|nextWeek">أعمال الأسبوع التالي</button><button data-dashboard-report="procedures|month">أعمال هذا الشهر</button><button data-route-report="clients">الموكلون</button><button data-route-report="cases">القضايا</button></div>`})}
 ${card({icon:'calendar',title:'الأجندة',size:'lg',cls:'agenda',collapsible:true,persistKey:'home:agenda',sectionId:'agenda',pageId:'dashboard',
  actions:`<div class="agenda-modes" role="group" aria-label="طريقة عرض الأجندة"><button type="button" data-agenda-mode="day">يوم</button><button type="button" data-agenda-mode="week">أسبوع</button><button type="button" data-agenda-mode="month">شهر</button><button type="button" data-agenda-mode="list">قائمة</button></div>`,
  body:`<div class="agenda-layout" id="agenda-layout"><div id="home-calendar"></div><div class="agenda-day"><h4 id="agenda-title"></h4><div id="agenda-grid"></div></div></div>`})}
 ${recents.length?card({icon:'clock',title:'آخر ما فُتح',size:'full',cls:'recents-section',collapsible:true,collapsed:true,persistKey:'home:recents',sectionId:'recents',pageId:'dashboard',summary:'السجلات التي فتحتها مؤخرًا — تُفتح بنقرة، والقسم مطوي افتراضيًا لتبقى الصفحة نظيفة',badge:statusBadge(String(recents.length),'info'),
  body:`<div class="recents-bar"><div class="recents-chips">${recents.map(x=>`<button class="recent-chip" data-recent="${esc(x.route)}"><span class="rc-ic" aria-hidden="true">${esc(x.icon==='calendar'?'📅':x.icon==='users'?'👤':x.icon==='gavel'?'⚖':'📁')}</span><span class="rc-t">${esc(x.title)}</span></button>`).join('')}</div></div>`}):''}`;
}

/** Toggle «Focus» on the existing Next Step Card only — no timer and no new screen. */
function bindHomeFocusMode(root,app){
 root?.querySelectorAll?.('[data-focus-mode]').forEach(button=>{button.onclick=()=>{
  app.__homeFocusMode=!app.__homeFocusMode;
  const model=app.__homeFocusModel,old=root.matches?.('[data-section-id="focus"]')?root:root.querySelector('[data-section-id="focus"]');
  if(!model||!old)return;
  const scrollY=window.scrollY;
  const tpl=document.createElement('template');
  tpl.innerHTML=focusHtml(model,{dayLabel:longDateAr(),focusMode:Boolean(app.__homeFocusMode)}).trim();
  const node=tpl.content.firstElementChild;if(!node)return;
  old.replaceWith(node);
  bindCockpit(node,app);
  node.querySelectorAll('[data-route]').forEach(b=>b.onclick=()=>app.go(b.dataset.route));
  node.querySelectorAll('[data-quick-add]').forEach(b=>b.onclick=()=>import('./quick-add.js').then(m=>m.openQuickAdd(app)));
  bindHomeFocusMode(node,app);
  applyUniversalStyles(node,'dashboard');
  node.querySelector('[data-focus-mode]')?.focus?.({preventScroll:true});
  window.scrollTo(0,scrollY);
 }});
}

// الأقسام التي يُحدَّث كل منها موضعًا بعد أي إجراء (بلا إعادة بناء الصفحة).
const DYNAMIC_SECTIONS=['focus','today','attention','since','kpis','activity'];

/**
 * تحديث موضعي بعد «✓ تم» (أو «تراجع»): يُعاد تحميل البيانات ويُستبدل كل قسم
 * متأثر بـ DOM جديد في مكانه — بلا innerHTML للصفحة، ولا فقدان لموضع التمرير
 * أو التصفية النشطة، أو التركيز، أو حالة الطي، أو محتوى الأجندة.
 */
async function positionalHomeRefresh(app){
 if(app.route!=='dashboard')return app.refresh();
 const main=document.querySelector('#main-content');if(!main)return app.refresh();
 const scrollY=window.scrollY;
 const activeFilter=main.querySelector('.cp-count.is-on')?.dataset.attnFilter||'all';
 const activeEl=document.activeElement;
 const activeInDynamic=Boolean(activeEl&&activeEl.closest?.('.cp-hero,.cp-stage,[data-section-id="focus"],[data-section-id="today"],[data-section-id="attention"],[data-section-id="since"],[data-section-id="kpis"],[data-section-id="activity"]'));
 try{
  const {r,focus,since,activity,today}=await loadHomeData(app);
  const dayLabel=longDateAr();
  const html={
   focus:focusHtml(focus,{dayLabel,focusMode:Boolean(app.__homeFocusMode)}),
   today:timelineHtml(focus,{dayLabel:`يوم ${fmtDate(today)}`}),
   attention:attentionHtml(focus),
   since:sinceHtml(since),
   kpis:kpisSectionHtml(r),
   activity:activityHtml(activity)
  };
  for(const id of DYNAMIC_SECTIONS){
   const next=html[id];
   const old=main.querySelector(`[data-section-id="${id}"]`);
   if(!next){old?.remove();continue}
   const tpl=document.createElement('template');tpl.innerHTML=next.trim();
   const node=tpl.content.firstElementChild;if(!node)continue;
   if(old)old.replaceWith(node);else main.append(node);
  }
  const oldPrep=main.querySelector('[data-home-tomorrow-prep]'),prepHtml=tomorrowPrepHtml(r);
  if(!prepHtml)oldPrep?.remove();
  else{const tpl=document.createElement('template');tpl.innerHTML=prepHtml.trim();const node=tpl.content.firstElementChild;if(oldPrep)oldPrep.replaceWith(node);else main.insertBefore(node,main.querySelector('.cp-hero')||main.firstChild)}
  const sum=main.querySelector('.cp-hero .cp-summary');if(sum)sum.innerHTML=summaryHtml(r,focus);
  // إعادة الربط: bindCockpit للعُقد الجديدة، وonclick (idempotent) للباقي.
  bindCockpit(main,app);
  bindHomeFocusMode(main,app);
  main.querySelectorAll('[data-route]').forEach(b=>b.onclick=()=>app.go(b.dataset.route));
  main.querySelectorAll('[data-kpi]').forEach(b=>b.onclick=()=>app.go(b.dataset.kpi));
  main.querySelectorAll('[data-quick-add]').forEach(b=>b.onclick=()=>import('./quick-add.js').then(m=>m.openQuickAdd(app)));
  const kpiSec=main.querySelector('[data-section-id="kpis"]');if(kpiSec)enhanceCollapsiblePanels(kpiSec,'dashboard',{bulk:false});
  // نظام العرض: حالة الأقسام (إظهار/ترتيب) + التخصيص + الإعدادات.
  applyPageDisplay(main,'dashboard');
  applyPageLayout(main,'dashboard');
  applyUniversalStyles(main,'dashboard');
  // الأجندة (عرض متأثر بالإجراء) — تحديثها بنفس اليوم.
  app.__homeShowDay?.(app.__agendaDay)?.catch?.(()=>{});
  import('../ui/work-badge.js').then(m=>m.scheduleWorkBadge(app,{force:true})).catch(()=>{});
  if(activeFilter!=='all'){
   const chip=main.querySelector(`[data-attn-filter="${activeFilter}"]`);
   if(chip)chip.click();
  }
  window.scrollTo(0,scrollY);
  if(activeInDynamic){
   const nf=main.querySelector('[data-section-id="focus"] [data-complete-proc],[data-section-id="focus"] .cp-primary,[data-section-id="focus"] button');
   nf?.focus?.({preventScroll:true});
  }else if(activeEl&&document.contains(activeEl)){try{activeEl.focus({preventScroll:true})}catch{}}
 }catch(err){app.fail(err)}
}

export function bindHome(app){
 // شريط الأعداد والطابور: فلترة بالأهمية بلا إعادة رسم.
 bindCockpit(document.querySelector('#main-content'),app);
 bindHomeFocusMode(document.querySelector('#main-content'),app);
 bindHomeLeave(app);
 // بعد أي إجراء («✓ تم» / «تراجع»): تحديث موضعي بدل app.refresh() — بدون إعادة بناء الصفحة.
 app.__refreshAfterAction=()=>positionalHomeRefresh(app);
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
 app.__homeShowDay=showDay;
 showDay(app.__agendaDay).catch(e=>app.fail(e));
}
