import * as constants from './core/constants.js';
import {APP_NAME} from './core/constants.js';
import {DatabaseRegistry} from './db/database-registry.js';
import {DatabaseManager} from './db/database-manager.js';
import {Office} from './services/office.js';
import {appStore} from './core/store.js';
import {events} from './core/events.js';
import {toast} from './ui/toast.js';
import {esc,$} from './ui/dom.js';
import {closeModal} from './ui/modal.js';
import {normalizeError,userError} from './core/errors.js';
import {ENTITIES} from './domain/entities.js';
import {homePage,bindHome} from './modules/home.js';
import {listPage,bindListPage} from './modules/list-page.js';
import {clientPage,bindClientPage,opponentPage,bindOpponentPage,recordPage,bindRecordPage} from './modules/record-page.js';
import {filePage,bindFilePage} from './modules/file-page.js';
import {openQuickAdd} from './modules/quick-add.js';
import {renderDatabases,bindDatabases,renderBackup,bindBackup,renderRecovery,bindRecovery} from './modules/databases.js';
import {reportsPage,bindReports} from './modules/reports.js';
import {renderSearch,bindSearch} from './modules/search.js';
import {actionCenterPage,bindActionCenter} from './modules/action-center.js';
import {analyticsPage,bindAnalytics} from './modules/analytics.js';
import {integrityPage,bindIntegrity} from './modules/integrity.js';
import {repairPage,bindRepair} from './modules/repair.js';
import {renderSettings,bindSettings} from './modules/settings.js';
import {runMaintenance} from './services/maintenance.js';

// صفحات القوائم العامة (كل كيان له صفحة قائمة بنفس النمط)
const LIST_STORES=['clients','opponents','files','cases','powersOfAttorney','hearings','procedures','appointments','communications','caseNotes','witnesses','expertReports','judgments','execution','fees','feePayments','documentReferences'];
const PAGES={
 dashboard:{title:'الرئيسية',render:app=>homePage(app),bind:app=>bindHome(app)},
 search:{title:'البحث',render:app=>renderSearch(app),bind:app=>bindSearch(app)},
 reports:{title:'التقارير',render:(app,q)=>reportsPage(app,q),bind:app=>bindReports(app)},
 actionCenter:{title:'مركز العمل',render:app=>actionCenterPage(app),bind:app=>bindActionCenter(app)},
 analytics:{title:'الإحصاءات',render:(app,q)=>analyticsPage(app,q),bind:app=>bindAnalytics(app)},
 integrity:{title:'سلامة البيانات والتدقيق',render:app=>integrityPage(app),bind:app=>bindIntegrity(app)},
 repair:{title:'مركز الإصلاح والاسترداد',render:app=>repairPage(app),bind:app=>bindRepair(app)},
 databases:{title:'قواعد البيانات',render:app=>renderDatabases(app),bind:app=>bindDatabases(app)},
 backup:{title:'النسخ الاحتياطي',render:app=>renderBackup(app),bind:app=>bindBackup(app)},
 settings:{title:'الإعدادات',render:app=>renderSettings(app),bind:app=>bindSettings(app)}
};
for(const s of LIST_STORES)PAGES[s]={title:ENTITIES[s].plural,render:(app,q)=>listPage(app,s,q),bind:app=>bindListPage(app,s)};

// صفحات السجل: client:ID, opponent:ID, file:ID, case:ID, rec:STORE:ID
function recordRoute(route){
 let m=/^(client|opponent|file|case):(.+)$/.exec(route);
 if(m){const map={client:['clients',clientPage,bindClientPage,'سجل الموكل'],opponent:['opponents',opponentPage,bindOpponentPage,'سجل الخصم'],file:['files',filePage,bindFilePage,'الملف'],case:['cases',(a,id)=>recordPage(a,'cases',id),(a,id)=>bindRecordPage(a,'cases',id),'القضية / المرحلة']}[m[1]];return {title:map[3],render:app=>map[1](app,m[2]),bind:app=>map[2](app,m[2]),store:map[0]}}
 m=/^rec:([A-Za-z]+):(.+)$/.exec(route);
 if(m&&ENTITIES[m[1]])return {title:ENTITIES[m[1]].label,render:app=>recordPage(app,m[1],m[2]),bind:app=>bindRecordPage(app,m[1],m[2]),store:m[1]};
 return null;
}

class App{
 constructor(){this.constants=constants;this.registry=new DatabaseRegistry();this.manager=new DatabaseManager(this.registry);this.ctx=null;this.office=null;this.route='dashboard';this.history=[];this.boundCrossTab=false;this.busy=false;this.navSeq=0}
 async boot(){document.title=APP_NAME;this.bindShell();this.bindCrossTab();try{if(this.registry.recoveryMode){const candidates=await this.registry.scanRecoverableDatabases();$('#page-title').textContent='وضع الاسترداد';$('#main-content').innerHTML=renderRecovery(candidates);bindRecovery(this,candidates);return}this.setContext(await this.manager.openActive());this.registry.data.lastBootAt=new Date().toISOString();this.registry.data.lastCleanShutdown=false;this.registry.save();window.addEventListener('pagehide',()=>{this.registry.data.lastCleanShutdown=true;this.registry.save()});await this.go('dashboard')}catch(e){this.fail(e)}}
 bindCrossTab(){if(this.boundCrossTab)return;this.boundCrossTab=true;events.on('db:switched',async p=>{if(!p?.profileId)return;/* local emit from this tab's own switch: manager already holds the target */if(this.manager.current?.profile?.id===p.profileId&&!this.manager.current.closed)return;try{this.registry.reload?.();if(this.registry.active?.id!==p.profileId)return;if(this.ctx?.profile?.id===p.profileId)return;await this.switchDb(p.profileId,{remote:true});toast('تم تبديل قاعدة البيانات من نافذة أخرى');await this.refresh()}catch(e){console.error('remote db switch',e);toast('تعذر مزامنة تبديل قاعدة البيانات من نافذة أخرى','error')}});events.on('db:migration:starting',p=>{if(p?.profileId===this.registry.active?.id&&this.ctx)toast('تجري ترقية قاعدة البيانات...');});events.on('db:closing',p=>{if(p?.profileId===this.ctx?.profile?.id&&this.ctx&&!this.ctx.closed&&this.manager.current===this.ctx){this.ctx.closed=true;toast('تم إغلاق اتصال قاعدة البيانات. أعد فتح القاعدة أو أعد تحميل الصفحة.','error')}});window.addEventListener('storage',e=>{if(e.key===constants.REGISTRY_KEY&&e.newValue){try{this.registry.reload?.();$('#db-badge').textContent=this.registry.active?.displayName||''}catch{}}});}
 bindShell(){
  $('#mobile-menu').onclick=()=>$('#sidebar').classList.toggle('open');
  $('#quick-add').onclick=()=>openQuickAdd(this);
  $('#command-btn').onclick=()=>this.go('search');
  $('#nav-back').onclick=()=>this.back();
  $('#nav-close').onclick=()=>this.closePage();
  $('#nav-home').onclick=()=>this.go('dashboard');
  document.querySelectorAll('#sidebar [data-route]').forEach(b=>b.onclick=()=>this.go(b.dataset.route));
  document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();this.go('search')}if(e.key==='Escape'&&!document.querySelector('.dg-pop'))closeModal()});
 }
 async go(route,opts={}){
  const my=++this.navSeq;
  closeModal();document.querySelectorAll('.dg-pop').forEach(p=>p.remove());
  if(this.route&&this.route!==route&&!opts.replace)this.history.push(this.route);
  this.history=this.history.slice(-50);this.route=route;appStore.set({route});
  const baseRoute=route.split('?')[0];const query=new URLSearchParams(route.includes('?')?route.split('?')[1]:'');
  const page=recordRoute(baseRoute)||PAGES[baseRoute]||PAGES.dashboard;
  const navKey=page.store||baseRoute; // صفحة السجل تُبرز قائمة كيانها في الشريط الجانبي
  document.querySelectorAll('#sidebar [data-route]').forEach(b=>b.classList.toggle('active',b.dataset.route===navKey));
  $('#page-title').textContent=page.title;
  $('#nav-back').disabled=!this.history.length;
  const main=$('#main-content');const scrollTop=opts.replace?window.scrollY:0;
  if(!opts.replace)main.innerHTML='<div class="loading" role="status" aria-live="polite">جارٍ التحميل…</div>';
  try{
   const html=await page.render(this,query);
   if(my!==this.navSeq)return; // انتقال أحدث بدأ أثناء التحميل
   main.innerHTML=html;
   await page.bind?.(this,query);
   main.querySelectorAll('[data-route]').forEach(b=>b.onclick=()=>this.go(b.dataset.route));
   main.querySelectorAll('[data-page-back]').forEach(b=>b.onclick=()=>this.back());
   main.querySelectorAll('[data-page-close]').forEach(b=>b.onclick=()=>this.closePage());
   document.querySelector('#sidebar')?.classList.remove('open');
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
  // صيانة غير مدمرة بعد فتح القاعدة (زرع القوائم، ترحيل روابط الموكلين، فهرس البحث)
  const office=this.office;this.maintenance=runMaintenance(office).catch(e=>console.error('maintenance',e));
 }
 resetViewState(){/* paging cursors and cached view state are bound to a DB session; drop them when the database changes */for(const k of ['__lists','__rec','__file','__fileTab','__report','__agendaDay'])delete this[k]}
 back(){const r=this.history.pop()||'dashboard';return this.go(r,{replace:true})}
 refresh(){return this.go(this.route,{replace:true})}
 fail(e){const err=normalizeError(e);console.error(err.code,err,e);const retry=this.route||'dashboard';$('#main-content').innerHTML=`<div class="error-box" role="alert"><h2>تعذر تنفيذ العملية</h2><p>${esc(userError(err))}</p><div class="error-actions"><button class="primary" data-retry>إعادة المحاولة</button><button class="ghost" data-error-home>الرئيسية</button><button class="ghost" data-error-diagnostics>سلامة البيانات</button></div><small class="muted">رمز التشخيص: ${esc(err.code)}</small></div>`;document.querySelector('[data-retry]')?.addEventListener('click',()=>this.go(retry,{replace:true}));document.querySelector('[data-error-home]')?.addEventListener('click',()=>this.go('dashboard'));document.querySelector('[data-error-diagnostics]')?.addEventListener('click',()=>this.go('integrity'))}
}
const app=new App();
function updateNetworkBadge(){const e=document.querySelector('#network-badge');if(!e)return;e.textContent=navigator.onLine?'محلي':'وضع عدم الاتصال';e.classList.toggle('is-offline',!navigator.onLine);e.classList.toggle('is-online',navigator.onLine)}
window.addEventListener('online',updateNetworkBadge);window.addEventListener('offline',updateNetworkBadge);window.addEventListener('error',e=>{console.error('window error',e.error||e.message)});window.addEventListener('unhandledrejection',e=>{console.error('unhandled rejection',e.reason)});updateNetworkBadge();window.__LAW_OFFICE_APP__=app;app.boot();
