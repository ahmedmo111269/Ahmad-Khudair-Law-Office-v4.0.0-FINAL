// لوحة الأوامر العالمية (Ctrl+K): بحث فوري + إجراءات سريعة + تنقل + آخر ما فُتح — دون لمس الفأرة.
// المنطق الصافي (filterCommands/highlightMatch) مفصول ليكون قابلًا للاختبار.
import {esc} from './dom.js';
import {normalizeArabic,normalizeDigits} from '../core/search-normalizer.js';
import {icon,ROUTE_ICONS} from './icons.js';
import {ENTITIES} from '../domain/entities.js';
import {getRecent} from '../services/recents.js';
import {closeModal,modal} from './modal.js';

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
 nav('caseNotes','الملاحظات',ROUTE_ICONS.caseNotes,'ملاحظات');
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
 quick('مواعيد','appointments','clock','موعد جديد');
 quick('اتصال','communications','phone','اتصال جديد');
 quick('ملاحظة','caseNotes','note','ملاحظة جديدة');
 quick('أتعاب','fees','wallet','اتعاب جديدة');
 cmds.push({id:'qa:search',label:'بحث موحد شامل',icon:'search',group:'إجراءات سريعة',keywords:'بحث',run:()=>app.go('search')});
 cmds.push({id:'qa:backup',label:'إنشاء نسخة احتياطية الآن',icon:'save',group:'إجراءات سريعة',keywords:'نسخة احتياط',run:()=>app.go('backup')});
 return cmds;
}

function recentCommands(){
 return getRecent().map(r=>({id:'rec:'+r.route,label:r.title,sub:r.sub||'',iconKey:r.icon||'file',group:'آخر ما فُتح',rec:true,run:()=>window.__LAW_OFFICE_APP__?.go(r.route)}));
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
  const recents=recentCommands().map(c=>({...c,scoreHint:0}));
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
