import {initCombobox} from './ui/combobox.js';
import {clientFilePage,bindClientFilePage} from './modules/client-file.js';
import * as constants from './core/constants.js';
import {APP_NAME} from './core/constants.js';
import {DatabaseRegistry} from './db/database-registry.js';
import {DatabaseManager} from './db/database-manager.js';
import {Office} from './services/office.js';
import {appStore} from './core/store.js';
import {events} from './core/events.js';
import {toast} from './ui/toast.js';
import {esc,$} from './ui/dom.js';
import {closeModal,modal} from './ui/modal.js';
import {normalizeError,userError} from './core/errors.js';
import {ENTITIES} from './domain/entities.js';
import {homePage,bindHome} from './modules/home.js';
import {listPage,bindListPage} from './modules/list-page.js';
import {clientPage,bindClientPage,opponentPage,bindOpponentPage,recordPage,bindRecordPage} from './modules/record-page.js';
import {filePage,bindFilePage} from './modules/file-page.js';
import {openQuickAdd} from './modules/quick-add.js';
import {quickNotesPage,bindQuickNotes,openQuickNoteCapture,bindQuickNoteGlobalEvents} from './modules/quick-notes.js';
import {renderDatabases,bindDatabases,renderBackup,bindBackup,renderRecovery,bindRecovery} from './modules/databases.js';
import {reportsPage,bindReports} from './modules/reports.js';
import {renderSearch,bindSearch} from './modules/search.js';
import {workCenterPage,bindWorkCenter,scheduleWorkBadge} from './modules/work-center.js';
import {executionCenterPage,bindExecutionCenter,executionDetailPage,bindExecutionDetail} from './modules/execution-center.js';
import {analyticsPage,bindAnalytics} from './modules/analytics.js';
import {integrityPage,bindIntegrity} from './modules/integrity.js';
import {repairPage,bindRepair} from './modules/repair.js';
import {renderSettings,bindSettings} from './modules/settings.js';
import {renderSyncPage,bindSyncPage} from './modules/sync.js';
import {syncStatus} from './services/sync-engine.js';
import {networkStatus,ONLINE,OFFLINE} from './core/network-status.js';
import {PWAUpdateService} from './services/pwa-updates.js';
import {runMaintenance} from './services/maintenance.js';
import {initTheme} from './ui/theme.js';
import {bindThemeMenu} from './ui/theme-menu.js';
import {enhanceCollapsiblePanels} from './ui/collapsible.js';
import {prefs} from './core/preferences.js';
import {decorateNav} from './ui/icons.js';
import {installDateInputs} from './ui/date-input.js';
import {openPalette,closePalette,paletteOpen} from './ui/palette.js';
import {icon} from './ui/icons.js';
import {buildSidebar,initSidebarState,toggleCollapsed,toggleMobile,closeMobile,isDesktop,setActiveRoute} from './ui/sidebar.js';
import {bindCards} from './ui/card.js';
import {applyPageDisplay,applyPageLayout} from './ui/page-layout.js';
import {applyUniversalStyles} from './ui/component-customizer.js';
import {Clock} from './core/clock.js';

// صفحات القوائم العامة (كل كيان له صفحة قائمة بنفس النمط)
const LIST_STORES=['clients','opponents','files','cases','powersOfAttorney','hearings','procedures','serviceRecords','appointments','communications','caseNotes','expertReports','judgments','execution','fees','feePayments','documentReferences','bailiffs'];
const PAGES={
 dashboard:{title:'الرئيسية',render:app=>homePage(app),bind:app=>bindHome(app)},
 search:{title:'البحث',render:app=>renderSearch(app),bind:app=>bindSearch(app)},
 reports:{title:'التقارير',render:(app,q)=>reportsPage(app,q),bind:app=>bindReports(app)},
 actionCenter:{title:'مركز العمل',render:(app,q)=>workCenterPage(app,q),bind:(app,q)=>bindWorkCenter(app,q)},
 quickNotes:{title:'الملاحظات السريعة',render:(app,q)=>quickNotesPage(app,q),bind:(app,q)=>bindQuickNotes(app,q),layoutId:'quickNotes',store:'caseNotes'},
 executionCenter:{title:'مركز التنفيذ',render:app=>executionCenterPage(app),bind:app=>bindExecutionCenter(app),layoutId:'executionCenter'},
 analytics:{title:'الإحصاءات',render:(app,q)=>analyticsPage(app,q),bind:app=>bindAnalytics(app)},
 integrity:{title:'سلامة البيانات والتدقيق',render:app=>integrityPage(app),bind:app=>bindIntegrity(app)},
 repair:{title:'مركز الإصلاح والاسترداد',render:app=>repairPage(app),bind:app=>bindRepair(app)},
 databases:{title:'قواعد البيانات',render:app=>renderDatabases(app),bind:app=>bindDatabases(app)},
 backup:{title:'النسخ الاحتياطي',render:app=>renderBackup(app),bind:app=>bindBackup(app)},
 sync:{title:'المزامنة',render:app=>renderSyncPage(app),bind:app=>bindSyncPage(app)},
 settings:{title:'الإعدادات',render:app=>renderSettings(app),bind:app=>bindSettings(app)}
};
for(const s of LIST_STORES)PAGES[s]={title:ENTITIES[s].plural,render:(app,q)=>listPage(app,s,q),bind:app=>bindListPage(app,s)};
// المسار القديم caseNotes يبقى رابط توافق إلى شاشة الملاحظات السريعة، لا شاشة Notes ثانية.
PAGES.caseNotes=PAGES.quickNotes;

// صفحات السجل: client:ID, opponent:ID, file:ID, case:ID, rec:STORE:ID
function recordRoute(route){
 let m=/^(client|opponent|file|case):(.+)$/.exec(route);
 if(m){const map={client:['clients',clientPage,bindClientPage,'سجل الموكل'],opponent:['opponents',opponentPage,bindOpponentPage,'سجل الخصم'],file:['files',filePage,bindFilePage,'الملف'],case:['cases',(a,id)=>recordPage(a,'cases',id),(a,id)=>bindRecordPage(a,'cases',id),'القضية / المرحلة']}[m[1]];const layouts={client:'client-details',opponent:'opponent-details',file:'file-details',case:'rec:cases'};return {title:map[3],render:app=>map[1](app,m[2]),bind:app=>map[2](app,m[2]),store:map[0],layoutId:layouts[m[1]]}}
 // بطاقة التنفيذ: مسار ثابت يُستخدم من الجدول والبحث والخط الزمني
 m=/^exc:(.+)$/.exec(route);
 if(m)return {title:'بطاقة التنفيذ',render:app=>executionDetailPage(app,m[1]),bind:app=>bindExecutionDetail(app,m[1]),store:'executionCenter',layoutId:'execution:card'};
 m=/^cfile:(.+)$/.exec(route);
 if(m)return {title:'ملف الموكل',render:(app,q)=>clientFilePage(app,m[1],q),bind:app=>bindClientFilePage(app,m[1]),store:'clients',layoutId:'client-file'};
 m=/^rec:([A-Za-z]+):(.+)$/.exec(route);
 // المهمة المستقلة لا صفحة سجل عامة لها: تُفتح في مجلّد مركز العمل (رابط ثابت rec:workItems:ID).
 if(m&&m[1]==='workItems')return {title:'مركز العمل',render:app=>workCenterPage(app,new URLSearchParams({item:m[2]})),bind:app=>bindWorkCenter(app,new URLSearchParams({item:m[2]})),store:'actionCenter',layoutId:'actionCenter'};
 // Old caseNotes record URLs open the single Quick Notes surface and its editor;
 // they never expose the retired generic Notes screen as a second system.
 if(m&&m[1]==='caseNotes')return {title:'الملاحظات السريعة',render:app=>quickNotesPage(app,new URLSearchParams({status:'ALL',note:m[2]})),bind:(app,q)=>bindQuickNotes(app,new URLSearchParams({status:'ALL',note:m[2]})),store:'caseNotes',layoutId:'quickNotes'};
 if(m&&m[1]!=='witnesses'&&ENTITIES[m[1]])return {title:ENTITIES[m[1]].label,render:app=>recordPage(app,m[1],m[2]),bind:app=>bindRecordPage(app,m[1],m[2]),store:m[1],layoutId:'rec:'+m[1]};
 return null;
}

class App{
 constructor(){this.constants=constants;this.registry=new DatabaseRegistry();this.manager=new DatabaseManager(this.registry);this.ctx=null;this.office=null;this.route='dashboard';this.history=[];this.boundCrossTab=false;this.busy=false;this.navSeq=0;this.booting=true;this.pendingRoute=null}
 async boot(){document.title=APP_NAME;this.bindShell();this.bindCrossTab();try{await prefs.init();if(this.registry.recoveryMode){const candidates=await this.registry.scanRecoverableDatabases();this.booting=false;$('#page-title').textContent='وضع الاسترداد';$('#main-content').innerHTML=renderRecovery(candidates);bindRecovery(this,candidates);return}this.setContext(await this.manager.openActive());await this.maintenance;await this.maybeSeedDemo();this.registry.data.lastBootAt=new Date().toISOString();this.registry.data.lastCleanShutdown=false;this.registry.save();window.addEventListener('pagehide',()=>{this.registry.data.lastCleanShutdown=true;this.registry.save()});this.booting=false;const route=this.pendingRoute||'dashboard';this.pendingRoute=null;await this.go(route)}catch(e){this.booting=false;this.fail(e)}}
 /** زرع بيانات تجريبية مرة واحدة فقط في قاعدة فارغة تمامًا — إضافة بحتة، لا تحذف شيئًا. */
 async maybeSeedDemo(){
  try{
   const office=this.office;if(!office)return;
   const meta=await office.r.meta.get('demoSeed');
   if(meta)return;
   const [clients,files]=await Promise.all([office.r.clients.count(),office.r.files.count()]);
   if(clients>0||files>0){await office.r.meta.put({id:'demoSeed',key:'demoSeed',seeded:false,skippedAt:Clock.now(),reason:'db-not-empty'});return}
   const {seedDemoData}=await import('./services/demo-seed.js');
   const report=await seedDemoData(office);
   await office.r.meta.put({id:'demoSeed',key:'demoSeed',seeded:true,at:Clock.now(),files:report.files,clients:report.clients});
   toast(`تم تحميل بيانات تجريبية جاهزة للتجربة: ${report.files} ملفًا قانونيًا و${report.clients} موكلًا. يمكنك حذفها سجلًا سجلًا في أي وقت.`,'ok',{duration:6500});
  }catch(e){console.error('demo seed',e)}
 }
 bindCrossTab(){if(this.boundCrossTab)return;this.boundCrossTab=true;events.on('db:switched',async p=>{if(!p?.profileId)return;/* local emit from this tab's own switch: manager already holds the target */if(this.manager.current?.profile?.id===p.profileId&&!this.manager.current.closed)return;try{this.registry.reload?.();if(this.registry.active?.id!==p.profileId)return;if(this.ctx?.profile?.id===p.profileId)return;await this.switchDb(p.profileId,{remote:true});toast('تم تبديل قاعدة البيانات من نافذة أخرى');await this.refresh()}catch(e){console.error('remote db switch',e);toast('تعذر مزامنة تبديل قاعدة البيانات من نافذة أخرى','error')}});events.on('db:migration:starting',p=>{if(p?.profileId===this.registry.active?.id&&this.ctx)toast('تجري ترقية قاعدة البيانات...');});events.on('db:closing',p=>{if(p?.profileId===this.ctx?.profile?.id&&this.ctx&&!this.ctx.closed&&this.manager.current===this.ctx){this.ctx.closed=true;toast('تم إغلاق اتصال قاعدة البيانات. أعد فتح القاعدة أو أعد تحميل الصفحة.','error')}});window.addEventListener('storage',e=>{if(e.key===constants.REGISTRY_KEY&&e.newValue){try{this.registry.reload?.();$('#db-badge').textContent=this.registry.active?.displayName||''}catch{}}});}
 bindShell(){
  // شريط التنقل العلوي الموحّد v6: يُبنى من تعريف واحد (ui/nav-model.js) كتبويبات
  // أفقية بعرض مساحة البرنامج، مع لوحات منظمة لكل تبويب، وطي، وتخصيص كامل.
  buildSidebar();initSidebarState();
  $('#mobile-menu').onclick=()=>{isDesktop()?toggleCollapsed():toggleMobile()};
  $('#quick-add').onclick=()=>openQuickAdd(this);
  $('#quick-note-fab')?.addEventListener('click',()=>openQuickNoteCapture(this));
  bindQuickNoteGlobalEvents(this);
  initCombobox();
  $('#command-btn').innerHTML=`${icon('search')} <span>لوحة الأوامر</span> <kbd>Ctrl K</kbd>`;
  $('#command-btn').onclick=()=>openPalette(this);
  $('#nav-back').onclick=()=>this.back();
  $('#nav-close').onclick=()=>this.closePage();
  $('#nav-home').onclick=()=>this.go('dashboard');
  // تفويض واحد لكل عناصر التنقل، فيبقى صالحًا بعد أي إعادة رسم للشريط (التخصيص مثلًا)
  $('#sidebar')?.addEventListener('click',e=>{const b=e.target.closest?.('[data-route]');if(b?.dataset.route)this.go(b.dataset.route)});
  this.initShortcuts();
  this.bindNetworkAwareness();
 }
 bindNetworkAwareness(){
  networkStatus.start();
  this.networkUnsubscribe=networkStatus.subscribe(({status,changed})=>{
   updateNetworkBadge(status);
   if(!changed)return;
   if(status===OFFLINE){toast('📵 لا يوجد اتصال بالإنترنت — البرنامج يعمل بوضع Offline.','info',{duration:5200});return}
   const context=this.ctx;
   if(!context){toast('🟢 عاد الاتصال بالإنترنت.','ok');return}
   syncStatus(context).then(state=>{
    if(!networkStatus.isOnline())return;
    if(state.pendingChanges||state.unresolvedConflicts){
     toast(`🟢 عاد الاتصال. توجد ${state.pendingChanges} تغييرات جاهزة للمزامنة؛ لم تبدأ تلقائيًا.`, 'info', {duration:7500,action:()=>this.go('sync'),actionLabel:'مزامنة الآن'});
    }else toast('🟢 عاد الاتصال بالإنترنت.','ok');
   }).catch(()=>toast('🟢 عاد الاتصال بالإنترنت.','ok'));
  },{immediate:true});
  this.pwaUpdates=new PWAUpdateService({network:networkStatus,notify:(message,type='info')=>toast(message,type,{duration:6000})});
  this.pwaUpdates.start().catch(error=>console.info('PWA update service unavailable',error));
 }
 // اختصارات لوحة المفاتيح: Ctrl+K اللوحة، ? المساعدة، Alt+رقم للتنقل السريع
 initShortcuts(){
  document.addEventListener('keydown',e=>{
   const typing=/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)||e.target.isContentEditable;
   if((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key.toLowerCase()==='n'){e.preventDefault();openQuickNoteCapture(this);return}
   if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();paletteOpen()?closePalette():openPalette(this);return}
   if((e.ctrlKey||e.metaKey)&&e.key==='\\'){e.preventDefault();isDesktop()?toggleCollapsed():toggleMobile();return}
   if(e.key==='Escape'&&!document.querySelector('.dg-pop')){
    if(!isDesktop()&&closeMobile())return; // إغلاق لوحة تنقل الهاتف المفتوحة إن وُجدت
    if(paletteOpen()){closePalette();return}closeModal();return}
   if(e.altKey&&!e.ctrlKey&&!e.metaKey&&/^[1-9]$/.test(e.key)){e.preventDefault();const routes=['dashboard','actionCenter','files','clients','cases','hearings','procedures','search','reports'];const r=routes[Number(e.key)-1];if(r)this.go(r);return}
   if(!typing&&(e.key==='?')&&!e.ctrlKey&&!e.metaKey&&!e.altKey){e.preventDefault();if(!document.querySelector('#modal-root .modal-card'))this.showShortcutsHelp()}
  });
 }
 showShortcutsHelp(){
  const rows=[['Ctrl + K','لوحة الأوامر: بحث وإجراءات وتنقل فوري'],['Ctrl + \\','طي أو فتح شريط التنقل العلوي'],['/','بحث داخل الجدول المعروض'],['Alt + 1…9','الرئيسية، مركز العمل، الملفات، الموكلون، القضايا، الجلسات، الأعمال، البحث، التقارير'],['N','مهمة جديدة (داخل مركز العمل وخارج الحقول)'],['T / W / M','مركز العمل: اليوم / هذا الأسبوع / هذا الشهر'],['?','هذه المساعدة'],['Esc','إغلاق النافذة أو اللوحة'],['Ctrl + Enter','حفظ النموذج المفتوح'],['نقرة عنوان العمود','تصفية العمود'],['نقرة سهم الفرز','فرز تصاعدي ثم تنازلي ثم إلغاء'],['Shift + سهم الفرز','فرز متعدد المستويات'],['سحب ▢ في رأس العمود','تغيير عرض العمود']];
  modal(`<h2 class="modal-title">اختصارات لوحة المفاتيح</h2><div class="kbd-help">${rows.map(([k,d])=>`<div class="kbd-row"><kbd>${esc(k)}</kbd><span>${esc(d)}</span></div>`).join('')}</div><p class="muted small">كل الجداول تدعم التنقل بالأسهم و Enter لفتح الصف، والطباعة والتصدير من أدوات الجدول.</p>`);
 }
 async go(route,opts={}){
  // Navigation handlers are bound before the initial IndexedDB open completes. Queue any early click
  // instead of rendering a page with a null Office context; recovery mode intentionally has no context.
  if(!this.office&&(this.booting||this.registry.recoveryMode)){if(this.booting)this.pendingRoute=route;return}
  const my=++this.navSeq;
  closeModal();document.querySelectorAll('.dg-pop').forEach(p=>p.remove());
  if(this.route&&this.route!==route&&!opts.replace)this.history.push(this.route);
  this.history=this.history.slice(-50);this.route=route;appStore.set({route});
  const baseRoute=route.split('?')[0];const query=new URLSearchParams(route.includes('?')?route.split('?')[1]:'');
  const page=recordRoute(baseRoute)||PAGES[baseRoute]||PAGES.dashboard;
  const navKey=page.store||baseRoute; // صفحة السجل تُبرز قائمة كيانها في شريط التنقل العلوي
  setActiveRoute(navKey);
  $('#page-title').textContent=page.title;
  document.title=`${page.title} — ${constants.APP_NAME}`;
  $('#nav-back').disabled=!this.history.length;
  const main=$('#main-content');const scrollTop=opts.replace?window.scrollY:0;
  if(!opts.replace)main.innerHTML='<div class="skel-page" role="status" aria-live="polite" aria-label="جارٍ التحميل"><div class="skel skel-hero"></div><div class="skel-row"><div class="skel skel-card"></div><div class="skel skel-card"></div><div class="skel skel-card"></div><div class="skel skel-card"></div></div><div class="skel skel-block"></div><div class="skel skel-block"></div></div>';
  try{
   const html=await page.render(this,query);
   if(my!==this.navSeq)return; // انتقال أحدث بدأ أثناء التحميل
   main.innerHTML=html;
   await page.bind?.(this,query);
   enhanceCollapsiblePanels(main,baseRoute);
   bindCards(main);
   // نظام العرض الموحّد: إعدادات عرض الصفحة (الصفحة ← العام ← الافتراضي) ثم ترتيب/إظهار
   // الأقسام المحفوظ — نقل DOM فقط، بلا إعادة رسم وبلا إعادة قراءة أي بيانات.
   this.__layoutId=page.layoutId||baseRoute;
   applyPageDisplay(main,this.__layoutId);
   applyPageLayout(main,this.__layoutId);
   // نظام التخصيص الكامل والمستقل: كل عنصر (صفحة/قسم/بطاقة/مرحلة/مكون مسجل)
   // تُطبق إعداداته المحفوظة بهويته الثابتة — نقل أنماط فقط، بلا إعادة رسم.
   applyUniversalStyles(main,this.__layoutId);
   main.querySelectorAll('[data-route]').forEach(b=>b.onclick=()=>this.go(b.dataset.route));
   main.querySelectorAll('[data-page-back]').forEach(b=>b.onclick=()=>this.back());
   main.querySelectorAll('[data-page-close]').forEach(b=>b.onclick=()=>this.closePage());
   closeMobile(); // على الهاتف: تُغلق لوحة التنقل تلقائيًا بعد اختيار الصفحة
   if(baseRoute!=='dashboard')prefs.set('ui:last-route',{route,title:page.title,at:Date.now()});
   if(baseRoute!=='actionCenter'&&!/^rec:workItems:/.test(baseRoute))scheduleWorkBadge(this);
   if(opts.replace)window.scrollTo(0,scrollTop);else window.scrollTo(0,0);
  }catch(e){if(my===this.navSeq)this.fail(e)}
 }
 closePage(){
  // إغلاق الصفحة الحالية: الرجوع إلى أقرب صفحة قائمة/رئيسية مختلفة، وإلا الرئيسية.
  const base=this.route.split('?')[0];
  while(this.history.length){const r=this.history.pop();if(r.split('?')[0]!==base)return this.go(r,{replace:true})}
  return this.go('dashboard',{replace:true});
 }
 async switchDb(id,opts={}){const previousId=this.ctx?.profile?.id||this.registry.active?.id;try{const next=await this.manager.switchTo(id);this.setContext(next);return next}catch(e){if(!opts.remote&&previousId&&this.registry.active?.id!==previousId){this.registry.data.activeProfileId=previousId;this.registry.save()}throw e}}
 setContext(ctx){
  this.ctx=ctx;this.office=new Office(ctx);this.resetViewState();$('#db-badge').textContent=this.registry.active?.displayName||ctx?.profile?.displayName||'';
  const sbDb=document.querySelector('#sb-db-name');if(sbDb)sbDb.textContent=this.registry.active?.displayName||ctx?.profile?.displayName||'';
  // صيانة غير مدمرة بعد فتح القاعدة (زرع القوائم، ترحيل روابط الموكلين، فهرس البحث)
  const office=this.office;this.maintenance=runMaintenance(office).catch(e=>console.error('maintenance',e));
 }
 resetViewState(){/* paging cursors and cached view state are bound to a DB session; drop them when the database changes */for(const k of ['__lists','__rec','__file','__fileTab','__report','__agendaDay','__wc'])delete this[k]}
 back(){const r=this.history.pop()||'dashboard';return this.go(r,{replace:true})}
 refresh(){return this.go(this.route,{replace:true})}
 fail(e){const err=normalizeError(e);console.error(err.code,err,e);const retry=this.route||'dashboard';$('#main-content').innerHTML=`<div class="error-box" role="alert"><h2>تعذر تنفيذ العملية</h2><p>${esc(userError(err))}</p><div class="error-actions"><button class="primary" data-retry>إعادة المحاولة</button><button class="ghost" data-error-home>الرئيسية</button><button class="ghost" data-error-diagnostics>سلامة البيانات</button></div><small class="muted">رمز التشخيص: ${esc(err.code)}</small></div>`;document.querySelector('[data-retry]')?.addEventListener('click',()=>this.go(retry,{replace:true}));document.querySelector('[data-error-home]')?.addEventListener('click',()=>this.go('dashboard'));document.querySelector('[data-error-diagnostics]')?.addEventListener('click',()=>this.go('integrity'))}
}
const app=new App();
function updateNetworkBadge(status=networkStatus.getState()){
 const e=document.querySelector('#network-badge');if(!e)return;
 const online=status===ONLINE;
 e.textContent=online?'🟢 متصل':'⚪ عدم الاتصال';
 e.setAttribute('aria-label',online?'متصل بالشبكة؛ البيانات محلية':'عدم الاتصال؛ البرنامج يعمل محليًا');
 e.title=online?'الاتصال بالشبكة متاح؛ بيانات المكتب محفوظة محليًا':'لا يوجد اتصال بالإنترنت — استمر في العمل محليًا';
 e.classList.toggle('is-offline',!online);e.classList.toggle('is-online',online);
}
window.addEventListener('error',e=>{console.error('window error',e.error||e.message)});window.addEventListener('unhandledrejection',e=>{console.error('unhandled rejection',e.reason)});updateNetworkBadge();window.__LAW_OFFICE_APP__=app;initTheme();decorateNav();installDateInputs(document.body);bindThemeMenu(app);app.boot();
