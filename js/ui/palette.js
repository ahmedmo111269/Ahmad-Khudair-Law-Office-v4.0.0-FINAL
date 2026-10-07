// لوحة الأوامر العالمية (Ctrl+K): بحث فوري + إجراءات سريعة + تنقل + آخر ما فُتح — دون لمس الفأرة.
// المنطق الصافي (filterCommands/highlightMatch) مفصول ليكون قابلًا للاختبار.
import {esc} from './dom.js';
import {normalizeArabic,normalizeDigits} from '../core/search-normalizer.js';
import {icon,ROUTE_ICONS} from './icons.js';
import {ENTITIES} from '../domain/entities.js';
import {getRecent} from '../services/recents.js';
import {closeModal,modal} from './modal.js';
import {openQuickAdd,contextualQuickActions,runQuickAction} from '../modules/quick-add.js';

// ===== منطق صافي قابل للاختبار =====
export function highlightMatch(label,q){
 const t=String(label||''),s=String(q||'').trim();
 if(!s)return [{t,hl:false}];
 const n=normalizeArabic(t),nq=normalizeArabic(normalizeDigits(s));
 const i=n.indexOf(nq);
 if(i<0)return [{t,hl:false}];
 // خُذ بالطول الأصلي للنص الأصلي (التنفيذ العربي لا يغيّر الأطوال عمليًا)
 return [{t:t.slice(0,i),hl:false},{t:t.slice(i,i+nq.length),hl:true},{t:t.slice(i+nq.length),hl:false}];
}
export function scoreCommand(cmd,q){
 const s=String(q||'').trim();
 if(!s)return cmd.rec?2:1; // بدون بحث: آخر ما فُتح أولًا ثم الإجراءات
 const n=normalizeArabic(normalizeDigits(s));
 const label=normalizeArabic(cmd.label||''),sub=normalizeArabic((cmd.sub||'')+' '+(cmd.keywords||''));
 if(label.startsWith(n))return 100;
 if(label.includes(n))return 70;
 if(sub.includes(n))return 40;
 const tokens=n.split(/\s+/).filter(Boolean);
 if(tokens.length>1&&tokens.every(token=>label.includes(token)||sub.includes(token)))return 30;
 return 0;
}
export function filterCommands(commands,q,{limit=14}={}){
 return commands.map(c=>({c,score:scoreCommand(c,q)})).filter(x=>x.score>0)
  .sort((a,b)=>b.score-a.score||String(a.c.label).localeCompare(String(b.c.label),'ar'))
  .slice(0,limit).map(x=>x.c);
}

// ===== بناء الأوامر =====
export function staticCommands(app){
 const cmds=[];
 const nav=(route,label,iconKey,keywords='')=>cmds.push({id:'nav:'+route,label,icon:iconKey,group:'التنقل',keywords,run:()=>app.go(route)});
 nav('dashboard','الرئيسية',ROUTE_ICONS.dashboard,'لوحة الأجندة');
 nav('actionCenter','مركز العمل',ROUTE_ICONS.actionCenter,'مهام متابعة متأخر');
 nav('files','الملفات',ROUTE_ICONS.files,'legal files');
 nav('clients','الموكلون',ROUTE_ICONS.clients,'موكلين');
 nav('opponents','الخصوم',ROUTE_ICONS.opponents,'خصوم');
 nav('cases','القضايا والمراحل',ROUTE_ICONS.cases,'قضايا');
 nav('powersOfAttorney','التوكيلات',ROUTE_ICONS.powersOfAttorney,'توكيل');
 nav('hearings','الجلسات',ROUTE_ICONS.hearings,'جلسات محكمة');
 nav('procedures','الأعمال الإدارية',ROUTE_ICONS.procedures,'مهام إجراءات');
 nav('serviceRecords','المحضرون والإعلانات','stamp','إعلان إنذار محضر');
 nav('bailiffs','دليل المحضرين','scale','محضرين');
 nav('appointments','المواعيد',ROUTE_ICONS.appointments,'مواعيد');
 nav('communications','الاتصالات',ROUTE_ICONS.communications,'هاتف اتصال');
  nav('quickNotes','الملاحظات السريعة',ROUTE_ICONS.caseNotes,'ملاحظات سريعة التقاط inbox');
 nav('judgments','الأحكام',ROUTE_ICONS.judgments,'أحكام');
 nav('expertReports','الخبراء',ROUTE_ICONS.expertReports,'خبراء تقارير');
 nav('execution','التنفيذ',ROUTE_ICONS.execution,'تنفيذ');
 nav('fees','الأتعاب',ROUTE_ICONS.fees,'فلوس أتعاب دفعات');
 nav('documentReferences','المستندات',ROUTE_ICONS.documentReferences,'مستندات وثائق');
 nav('search','البحث الموحد',ROUTE_ICONS.search,'بحث شامل');
 nav('reports','التقارير',ROUTE_ICONS.reports,'تقارير');
 nav('analytics','الإحصاءات',ROUTE_ICONS.analytics,'إحصاءات تحليل');
 nav('integrity','سلامة البيانات',ROUTE_ICONS.integrity,'فحص تدقيق');
 nav('repair','الإصلاح والاسترداد',ROUTE_ICONS.repair,'إصلاح');
 nav('databases','قواعد البيانات',ROUTE_ICONS.databases,'قواعد تبديل');
 nav('backup','النسخ الاحتياطي',ROUTE_ICONS.backup,'نسخة احتياطية تصدير');
 nav('settings','الإعدادات',ROUTE_ICONS.settings,'إعدادات مظهر ثيم');
 // إجراءات سريعة
 const quick=(label,store,iconKey,keywords='')=>cmds.push({id:'qa:'+store,label:`${label} (إضافة جديدة)`,icon:iconKey,group:'إجراءات سريعة',keywords,kbd:'+',run:async()=>{
  if(store==='files'){const {startNewLegalFile}=await import('../modules/client-file.js');return startNewLegalFile(app)}
  const {openEntityForm}=await import('./form.js');
  openEntityForm(app,store);
 }});
 quick('ملف قانوني','files','folder','ملف جديد قضية');
 quick('موكل','clients','users','موكل جديد شخص');
 quick('خصم','opponents','userX','خصم جديد');
 quick('جلسة','hearings','calendar','جلسة جديدة');
 quick('عمل إداري','procedures','clipboard','مهمة إجراء جديد');
 quick('مهمة (مركز العمل)','workItems','clipboard','مهمة جديدة تذكير متابعة task');
 quick('مواعيد','appointments','clock','موعد جديد');
 quick('اتصال','communications','phone','اتصال جديد');
  cmds.push({id:'qa:quick-note',label:'ملاحظة سريعة (Ctrl+Shift+N)',icon:'note',group:'إجراءات سريعة',keywords:'ملاحظة التقاط quick note inbox',kbd:'Ctrl⇧N',run:async()=>{const {openQuickNoteCapture}=await import('../modules/quick-notes.js');return openQuickNoteCapture(app)}});
 quick('أتعاب','fees','wallet','اتعاب جديدة');
 // مركز العمل: تنقل مباشر + أوامر تعدّل بيانات تطلب تأكيدًا قبل التنفيذ
 const wc=(id,label,route,keywords='')=>cmds.push({id:'wc:'+id,label,icon:ROUTE_ICONS.actionCenter,group:'مركز العمل',keywords:'مركز العمل '+keywords,run:()=>app.go(route)});
 wc('today','مركز العمل — اليوم','actionCenter?range=today','اليوم');
 wc('overdue','مركز العمل — المتأخر','actionCenter?range=overdue','متأخر');
 wc('week','مركز العمل — هذا الأسبوع','actionCenter?range=week','أسبوع');
 wc('kanban','مركز العمل — كانبان','actionCenter?view=kanban','لوحة حالات');
 wc('matrix','مركز العمل — مصفوفة أيزنهاور','actionCenter?view=matrix','أولويات');
 wc('attention','مركز العمل — يحتاج انتباهي','actionCenter?view=attention','تنبيه');
 wc('review-day','مراجعة نهاية اليوم','actionCenter?review=day','ملخص اليوم');
 wc('review-week','مراجعة الأسبوع','actionCenter?review=week','ملخص الأسبوع');
 cmds.push({id:'wc:carry',label:'ترحيل أعمال اليوم المتبقية إلى غدًا (يعدّل البيانات — بتأكيد)',icon:ROUTE_ICONS.actionCenter,group:'مركز العمل',keywords:'ترحيل تأجيل غدًا مركز العمل',kbd:'تأكيد',run:async()=>{
  const [{dailyReview},{bulkApply},{confirmBox},{toast}]=await Promise.all([import('../services/work-insights.js'),import('../services/work-items.js'),import('./modal.js'),import('./toast.js')]);
  const data=await dailyReview(app.office);
  if(!data.carryOver.length)return toast('لا عناصر غير منجزة قابلة للترحيل اليوم.','info');
  if(!await confirmBox(`ترحيل ${data.carryOver.length} عنصرًا غير منجز إلى غدًا؟ يُحفظ الموعد الأصلي ويزيد عدّاد التأجيل. الجلسات لا تُرحَّل.`,{okText:'ترحيل إلى غدًا'}))return;
  const out=await bulkApply(app.office,data.carryOver,'postpone',{option:'tomorrow',reason:'ترحيل من لوحة الأوامر'});
  toast(`تم ترحيل ${out.done.length}${out.failed.length?` — تعذّر ${out.failed.length}`:''}`,out.failed.length?'warn':'ok');app.refresh();
 }});
 cmds.push({id:'wc:linked',label:'+ مهمة مرتبطة بالصفحة الحالية',icon:'clipboard',group:'مركز العمل',keywords:'مهمة مرتبطة ملف موكل جلسة',kbd:'+',run:async()=>{
  const route=String(app.route||'').split('?')[0];
  const m=/^(client|file|case):(.+)$/.exec(route),r=/^rec:([A-Za-z]+):(.+)$/.exec(route);
  const target=m?[{client:'clients',file:'files',case:'cases'}[m[1]],m[2]]:r&&r[1]!=='workItems'?[r[1],r[2]]:null;
  const {toast}=await import('./toast.js');
  if(!target)return toast('افتح ملفًا أو موكلًا أو قضية أو سجلًا (جلسة/عمل/حكم/إعلان…) لإنشاء مهمة مرتبطة به.','info');
  const {openLinkedTaskForm}=await import('./work-actions.js');openLinkedTaskForm(app,target[0],target[1]);
 }});
 cmds.push({id:'qa:quick-add',label:'قائمة الإضافة السريعة',icon:'plus',group:'إجراءات سريعة',keywords:'إضافة جديد نموذج',run:()=>openQuickAdd(app)});
 for(const [index,action] of contextualQuickActions(app).entries())cmds.push({id:`ctx:${index}:${action.kind}`,label:action.label,icon:action.icon,group:'في السياق الحالي',keywords:`إضافة مرتبطة ${action.label}`,run:()=>runQuickAction(app,action.kind,{context:action.context})});
 cmds.push({id:'qa:search',label:'بحث موحد شامل',icon:'search',group:'إجراءات سريعة',keywords:'بحث',run:()=>app.go('search')});
 cmds.push({id:'qa:backup',label:'إنشاء نسخة احتياطية الآن',icon:'save',group:'إجراءات سريعة',keywords:'نسخة احتياط',run:()=>app.go('backup')});
 // تنظيف البيانات التجريبية: نفس المسار المستخدم في الرئيسية والإعدادات (فحص ← تأكيد ← حذف في معاملة واحدة)
 cmds.push({id:'qa:demo-clean',label:'حذف كل البيانات التجريبية (بتأكيد)',icon:'x',group:'إجراءات سريعة',keywords:'تجريبي بيانات تجريبية حذف مسح تنظيف demo seed',kbd:'تأكيد',run:async()=>{
  const {startDemoCleanup}=await import('./demo-cleanup.js');
  return startDemoCleanup(app,{onDone:()=>app.refresh()});
 }});
 return cmds;
}

function recentCommands(scope=''){
 return getRecent(scope).map(r=>({id:'rec:'+r.route,label:r.title,sub:r.sub||'',iconKey:r.icon||'file',group:'آخر ما فُتح',rec:true,run:()=>window.__LAW_OFFICE_APP__?.go(r.route)}));
}

// ===== الواجهة =====
let paletteEl=null;
try{document.addEventListener('modal:closed',()=>{paletteEl=null})}catch{}
export function openPalette(app){
 if(paletteEl){paletteEl.querySelector('.pal-q')?.focus();return paletteEl}
 // حماية من فقدان البيانات: لا تفتح اللوحة فوق نموذج/نافذة مفتوحة (modal() يستبدل محتوى #modal-root)
 if(document.querySelector('#modal-root .modal-card')){import('./toast.js').then(m=>m.toast('أغلق النافذة المفتوحة أولًا ثم افتح لوحة الأوامر','warn'));return null}
 const statics=staticCommands(app);
 const overlay=modal(`<h2 class="modal-title pal-title">${icon('search')} لوحة الأوامر <small class="muted small">ابحث أو اختر — Enter للتنفيذ، Esc للإغلاق</small></h2>
  <div class="pal-wrap">
   <input class="pal-q" type="text" placeholder="اكتب للبحث: اسم موكل، رقم ملف، أو أمر مثل «جلسة»…" autocomplete="off" aria-label="بحث لوحة الأوامر">
   <div class="pal-list" role="listbox" aria-label="النتائج"></div>
   <div class="pal-foot muted small"><span>↑↓ للتنقل</span><span>Enter للفتح</span><span>Esc للإغلاق</span></div>
  </div>`);
 overlay.classList.add('palette-card');
 paletteEl=overlay;
 const input=overlay.querySelector('.pal-q'),list=overlay.querySelector('.pal-list');
 let items=[],active=0,seq=0,timer=0;
 const closePalette=()=>{paletteEl=null;closeModal()};
 overlay.addEventListener('click',e=>{if(e.target===overlay.closest('.modal-backdrop'))closePalette()});
 const draw=()=>{
  if(!items.length){list.innerHTML=`<div class="pal-empty muted">لا نتائج مطابقة — جرّب كلمة أخرى أو رقمًا.</div>`;return}
  let html='',lastGroup=null;
  items.forEach((c,i)=>{
   if(c.group!==lastGroup){html+=`<div class="pal-group">${esc(c.group)}</div>`;lastGroup=c.group}
   const parts=highlightMatch(c.label,input.value.trim());
   const labelHtml=parts.map(p=>p.hl?`<mark>${esc(p.t)}</mark>`:esc(p.t)).join('');
   html+=`<button type="button" class="pal-item${i===active?' on':''}" data-i="${i}" role="option" aria-selected="${i===active}" id="pal-opt-${i}">
     ${icon(c.iconKey||c.icon||'file')}
     <span class="pal-label"><b>${labelHtml}</b>${c.sub?`<small>${esc(c.sub)}</small>`:''}</span>
     ${c.kbd?`<kbd>${esc(c.kbd)}</kbd>`:''}</button>`;
  });
  list.innerHTML=html;
  list.querySelector('.pal-item.on')?.scrollIntoView({block:'nearest'});
 };
 const runItem=c=>{paletteEl=null;closeModal();try{c.run()}catch(e){console.error('palette action',e);app.fail?.(e)}};
  const build=()=>{
  const q=input.value.trim();
  const recents=recentCommands(app.ctx?.profile?.id||'').map(c=>({...c,scoreHint:0}));
  if(q.length>=2){
   const my=++seq;list.innerHTML=`<div class="pal-empty muted">جارٍ البحث…</div>`;
   clearTimeout(timer);
   timer=setTimeout(async()=>{
    let live=[];
    try{
     const {searchAll,PRIMARY_STORES}=await import('../services/search-engine.js');
     const r=await searchAll(app.office,q,{stores:PRIMARY_STORES,perStore:3});
     live=r.groups.flatMap(g=>g.items.map(it=>({
      id:`live:${g.store}:${it.id}`,group:'نتائج من قاعدة البيانات',iconKey:g.icon,icon:'',
      label:it.title,sub:it.sub,run:()=>app.go(it.route)
     })));
    }catch{live=[]}
    if(my!==seq)return;
    items=filterCommands([...live,...statics,...recents],q,{limit:18});
    active=0;draw();
   },150);
   items=filterCommands([...statics,...recents],q,{limit:18});active=0;draw();
  }else{
   clearTimeout(timer);seq++;
   items=filterCommands([...recents,...statics],'' ,{limit:16});active=0;draw();
  }
 };
 input.addEventListener('input',build);
 input.addEventListener('keydown',e=>{
  if(e.key==='ArrowDown'){e.preventDefault();active=Math.min(items.length-1,active+1);draw()}
  else if(e.key==='ArrowUp'){e.preventDefault();active=Math.max(0,active-1);draw()}
  else if(e.key==='Enter'){e.preventDefault();const c=items[active];if(c)runItem(c)}
  else if(e.key==='Escape'){e.preventDefault();closePalette()}
 });
 list.addEventListener('click',e=>{const b=e.target.closest('.pal-item');if(!b)return;const c=items[Number(b.dataset.i)];if(c)runItem(c)});
 list.addEventListener('mousemove',e=>{const b=e.target.closest('.pal-item');if(!b)return;const i=Number(b.dataset.i);if(i!==active){active=i;list.querySelectorAll('.pal-item.on').forEach(x=>x.classList.remove('on'));b.classList.add('on')}});
 // توقيف إغلاق المودال العام مؤقتًا حتى لا يسبق لوحة المفاتيح
 setTimeout(()=>input.focus(),30);
 build();
 return overlay;
}
export function closePalette(){if(paletteEl){paletteEl=null;closeModal()}}
export function paletteOpen(){return Boolean(paletteEl)}
