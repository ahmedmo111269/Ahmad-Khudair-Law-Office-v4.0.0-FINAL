// جدول بيانات عام بأسلوب Microsoft Access الاحترافي:
// فرز متعدد المستويات بمفاتيح مسبقة الحساب (سريع مع آلاف الصفوف)، تصفية لكل عمود (شرط + قيم مميزة)،
// تصفية مركّبة و/أو، بحث داخل الأعمدة، تثبيت أعمدة (Sticky في RTL/LTR)، تحديد صفوف وإجراءات جماعية آمنة
// (تصدير/طباعة المحدد فقط)، تجميع، اختيار الأعمدة بالسحب، كثافة وحجم خط، عرض بطاقات، ملء الشاشة،
// طرق عرض محفوظة، إعادة ضبط، طباعة وتصدير Excel/Word/CSV/TXT، وتمرير افتراضي فوق 600 صف.
import {esc} from './dom.js';
import {normalizeArabic} from '../core/search-normalizer.js';
import {APP_NAME} from '../core/constants.js';
import {prefs} from '../core/preferences.js';
import {formatDate} from '../core/format.js';
import {localDate,addDays} from '../core/clock.js';
import {toast} from './toast.js';

// أعمدة لا تُصدَّر افتراضيًا (خصوصية الموكلين) إلا باختيار "تصدير كامل"
const SENSITIVE=/nationalId|idNumber|passport|phone|mobile|email|address|birth|partyName|bailiffName/i;
const VIRTUAL_THRESHOLD=600;
const MAX_PINS=2;
// تمييز نتائج البحث مع مراعاة اختلافات الكتابة العربية (أ/ا، ى/ي، ة/ه، التشكيل)
const AR_EQ={'ا':'[اأإآٱ]','ي':'[يى]','ى':'[يى]','ه':'[هة]','ة':'[هة]','و':'[وؤ]'};
const DIG='0123456789',ADIG='٠١٢٣٤٥٦٧٨٩';
function highlighter(q){
 const t=String(q||'').trim();if(!t)return null;
 const parts=[...normalizeArabic(t)].map(ch=>{if(ch===' ')return '\\s+';if(AR_EQ[ch])return AR_EQ[ch];const d=DIG.indexOf(ch);if(d>=0)return `[${ch}${ADIG[d]}]`;return ch.replace(/[.*+?^${}()|[\]\\\/]/g,'\\$&')});
 try{return new RegExp(parts.join('[\\u064B-\\u065F\\u0670ـ]*'),'gi')}catch{return null}
}
const markHtml=(text,re)=>{if(!re)return esc(text);let out='',last=0;const s=String(text);re.lastIndex=0;let m;while((m=re.exec(s))){if(!m[0]){re.lastIndex++;continue}out+=esc(s.slice(last,m.index))+'<mark>'+esc(m[0])+'</mark>';last=m.index+m[0].length}return out+esc(s.slice(last))};

const OPS={
 text:[['contains','يحتوي'],['notContains','لا يحتوي'],['eq','يساوي'],['neq','لا يساوي'],['starts','يبدأ بـ'],['ends','ينتهي بـ'],['empty','فارغ'],['notEmpty','غير فارغ']],
 number:[['eq','='],['neq','≠'],['gt','أكبر من'],['gte','أكبر من أو يساوي'],['lt','أصغر من'],['lte','أصغر من أو يساوي'],['between','بين'],['empty','فارغ'],['notEmpty','غير فارغ']],
 date:[['eq','في يوم'],['before','قبل'],['after','بعد'],['onOrBefore','في أو قبل'],['onOrAfter','في أو بعد'],['between','بين'],['today','اليوم'],['thisWeek','هذا الأسبوع'],['thisMonth','هذا الشهر'],['empty','فارغ'],['notEmpty','غير فارغ']],
 bool:[['isTrue','نعم'],['isFalse','لا'],['empty','فارغ']]
};
const NOVAL=['empty','notEmpty','isTrue','isFalse','today','thisWeek','thisMonth'];
const n=v=>normalizeArabic(String(v??''));
const EMPTY='(فارغ)';

function testOp(col,row,op,v1,v2){
 const type=col.type||'text';
 const raw=col.get(row);
 if(type==='number'){
  const x=raw===''||raw===null||raw===undefined?NaN:Number(raw),a=Number(v1),b=Number(v2);
  switch(op){case'eq':return x===a;case'neq':return x!==a;case'gt':return x>a;case'gte':return x>=a;case'lt':return x<a;case'lte':return x<=a;case'between':return x>=Math.min(a,b)&&x<=Math.max(a,b);case'empty':return Number.isNaN(x);case'notEmpty':return !Number.isNaN(x)}
  return true;
 }
 if(type==='date'){
  const d=String(raw||'').slice(0,10);
  switch(op){case'eq':return d===v1;case'before':return Boolean(d)&&d<v1;case'after':return d>v1;case'onOrBefore':return Boolean(d)&&d<=v1;case'onOrAfter':return d>=v1;case'between':{const [a,b]=[v1||'0000',v2||'9999'].sort();return Boolean(d)&&d>=a&&d<=b}case'today':return d===localDate();case'thisWeek':{const t=localDate(),dow=new Date(t+'T00:00:00').getDay(),monday=addDays(t,dow===0?-6:1-dow);return Boolean(d)&&d>=monday&&d<=addDays(monday,6)}case'thisMonth':return Boolean(d)&&d.slice(0,7)===localDate().slice(0,7);case'empty':return !d;case'notEmpty':return Boolean(d)}
  return true;
 }
 if(type==='bool'){const t=raw===true||raw==='true';const f=raw===false||raw==='false';if(op==='isTrue')return t;if(op==='isFalse')return f;if(op==='empty')return !t&&!f;return true}
 const s=n(col.text(row)),q=n(v1);
 switch(op){case'contains':return s.includes(q);case'notContains':return !s.includes(q);case'eq':return s===q;case'neq':return s!==q;case'starts':return s.startsWith(q);case'ends':return s.endsWith(q);case'empty':return !s;case'notEmpty':return Boolean(s)}
 return true;
}
const cmp=(col,a,b)=>{
 const t=col.type||'text';let x=col.get(a),y=col.get(b);
 const ex=x===''||x===null||x===undefined,ey=y===''||y===null||y===undefined;
 if(ex||ey)return ex&&ey?0:ex?1:-1; // الفارغ دائمًا في الآخر
 if(t==='number')return Number(x)-Number(y);
 if(t==='date')return String(x).localeCompare(String(y));
 return String(col.text(a)).localeCompare(String(col.text(b)),'ar',{numeric:true});
};

export function mountGrid(root,opts){
 const o={title:'',emptyText:'لا توجد سجلات.',pageSize:300,storageKey:'',onRowClick:null,selectable:false,...opts};
 const cols=o.columns.map(c=>({type:'text',get:r=>r[c.key],text:r=>String(c.get?c.get(r)??'':r[c.key]??''),...c}));
 const byKey=new Map(cols.map(c=>[c.key,c]));
 let rows=o.rows||[];
 const PK='grid:'+(o.storageKey||'');
 const legacy=(()=>{try{return JSON.parse(localStorage.getItem('grid:'+o.storageKey)||'null')}catch{return null}})();
 const saved=(o.storageKey&&prefs.get(PK))||legacy||{};
 const order=(Array.isArray(saved.order)?saved.order:[]).filter(k=>byKey.has(k));cols.forEach(c=>{if(!order.includes(c.key))order.push(c.key)});
 const st={sort:(Array.isArray(saved.sort)?saved.sort:[]).filter(x=>byKey.has(x.key)),filters:new Map((Array.isArray(saved.filters)?saved.filters:[]).filter(([k])=>byKey.has(k)).map(([k,f])=>[k,{...f,set:f?.set?new Set(f.set):null}])),adv:saved.adv&&Array.isArray(saved.adv.rules)?saved.adv:{logic:'and',rules:[]},quick:saved.quick||'',groupBy:byKey.has(saved.groupBy)?saved.groupBy:'',hidden:new Set(saved.hidden||cols.filter(c=>c.hidden).map(c=>c.key)),widths:{...(saved.widths||{})},fontSize:['small','medium','large'].includes(saved.fontSize)?saved.fontSize:'medium',filterCollapsed:Boolean(saved.filterCollapsed),shown:o.pageSize,cards:Boolean(saved.cards),density:saved.density||'',views:Array.isArray(saved.views)?saved.views:[],sel:-1,activeView:'',
  pinned:(Array.isArray(saved.pinned)?saved.pinned:[]).filter(k=>byKey.has(k)).slice(0,MAX_PINS),
  colSearch:saved.colSearch&&typeof saved.colSearch==='object'&&!Array.isArray(saved.colSearch)?{...saved.colSearch}:{},
  colSearchOn:Boolean(saved.colSearchOn),selected:new Set()};
 let hl=null;const collapsed=new Set();
 let view=[];
 root.classList.add('dg');
 root.innerHTML=`<div class="dg-toolbar"><button type="button" class="ghost dg-tools-btn" aria-expanded="false" title="أدوات الجدول">⚙︎ أدوات</button><button type="button" class="ghost dg-filter-toggle" aria-expanded="true" title="إظهار أو إخفاء أدوات التصفية">▾ تصفية</button>
  <input class="dg-quick" type="search" placeholder="تصفية داخل النتائج… ( / )" aria-label="تصفية داخل النتائج">
  <button type="button" class="ghost dg-adv-btn">تصفية مركّبة</button>
  <button type="button" class="ghost dg-csearch-btn" title="صف بحث تحت كل عمود" aria-pressed="${st.colSearchOn}">بحث الأعمدة</button>
  <label class="dg-group-lbl">تجميع حسب <select class="dg-groupby"><option value="">بدون</option>${cols.map(c=>`<option value="${esc(c.key)}">${esc(c.label)}</option>`).join('')}</select></label>
  <button type="button" class="ghost dg-cols-btn">الأعمدة</button>
  <button type="button" class="ghost dg-views-btn" title="حفظ واسترجاع الفلاتر والفرز باسم">★ طرق العرض</button>
  <button type="button" class="ghost dg-reset-btn" title="إعادة ضبط كل إعدادات هذا الجدول">⭯ إعادة ضبط</button>
  <select class="dg-density" aria-label="كثافة العرض" title="كثافة العرض"><option value="">كثافة: حسب الثيم</option><option value="compact">مضغوط</option><option value="normal">عادي</option><option value="comfortable">مريح</option></select>
  <select class="dg-font" aria-label="حجم خط الجدول" title="حجم الخط"><option value="small">خط صغير</option><option value="medium">خط متوسط</option><option value="large">خط كبير</option></select>
  <button type="button" class="ghost dg-cards-btn" title="تبديل العرض">بطاقات</button><button type="button" class="ghost dg-fullscreen" title="ملء الشاشة" aria-pressed="false">⛶ ملء الشاشة</button>
  <button type="button" class="ghost dg-clear" hidden>مسح التصفية</button>
  <span class="dg-count" aria-live="polite"></span>
  <span class="dg-spacer"></span>
  <button type="button" class="ghost dg-print">طباعة</button>
  <select class="dg-export" aria-label="تصدير"><option value="">تصدير…</option><option value="xls">Excel</option><option value="doc">Word</option><option value="csv">CSV</option><option value="txt">نص TXT</option><optgroup label="يشمل البيانات الحساسة"><option value="xls:full">Excel كامل</option><option value="csv:full">CSV كامل</option></optgroup></select>
 </div>
 <div class="dg-selbar" hidden><b class="dg-sel-count"></b><button type="button" class="ghost small dg-sel-export">Excel المحدد</button><button type="button" class="ghost small dg-sel-csv">CSV المحدد</button><button type="button" class="ghost small dg-sel-print">طباعة المحدد</button><button type="button" class="link dg-sel-clear">مسح التحديد</button></div>
 <div class="dg-chips" hidden aria-label="التصفية النشطة"></div>
 <div class="dg-adv" hidden></div>
 <div class="dg-scroll" tabindex="0"><table class="dg-table"><thead></thead><tbody></tbody><tfoot></tfoot></table></div>
 <div class="dg-more"></div>`;
 const $=s=>root.querySelector(s);
 root.classList.toggle('dg-filter-open',!st.filterCollapsed);
 $('.dg-quick').value=st.quick;$('.dg-groupby').value=st.groupBy;$('.dg-font').value=st.fontSize;
 $('.dg-csearch-btn').classList.toggle('dg-chip-active',st.colSearchOn);
 const visibleCols=()=>order.map(k=>byKey.get(k)).filter(c=>c&&!st.hidden.has(c.key));
 const persist=()=>{if(o.storageKey)prefs.set(PK,{hidden:[...st.hidden],order:[...order],sort:st.sort,density:st.density,cards:st.cards,views:st.views,filters:[...st.filters].map(([k,f])=>[k,{...f,set:f.set?[...f.set]:null}]),adv:st.adv,quick:st.quick,groupBy:st.groupBy,widths:st.widths,fontSize:st.fontSize,filterCollapsed:st.filterCollapsed,pinned:[...st.pinned],colSearch:st.colSearch,colSearchOn:st.colSearchOn})};
 const virtualOn=()=>view.length>VIRTUAL_THRESHOLD&&!st.groupBy&&!st.cards;
 let rowH=0,vStart=-1;
 const allSelected=()=>view.length>0&&view.every(r=>st.selected.has(r));

 function compute(){
  const q=n(st.quick);hl=highlighter(st.quick);vStart=-1;
  const vc=cols;
  const csEntries=Object.entries(st.colSearch).filter(([k,v])=>v&&byKey.has(k));
  let out=rows.filter(r=>{
   if(q&&!vc.some(c=>n(c.text(r)).includes(q)))return false;
   for(const [k,f] of st.filters){const c=byKey.get(k);if(!c)continue;if(f.set&&!f.set.has(c.text(r)||EMPTY))return false;if(f.op&&(NOVAL.includes(f.op)||f.v1!==''||f.v2!=='')&&!testOp(c,r,f.op,f.v1,f.v2))return false}
   for(const [k,cv] of csEntries){const c=byKey.get(k);if(!n(c.text(r)).includes(n(cv)))return false}
   const rules=st.adv.rules.filter(x=>byKey.get(x.key)&&(NOVAL.includes(x.op)||x.v1!==''));
   if(rules.length){const res=rules.map(x=>testOp(byKey.get(x.key),r,x.op,x.v1,x.v2));if(st.adv.logic==='or'?!res.some(Boolean):!res.every(Boolean))return false}
   return true;
  });
  // فرز بمفاتيح مسبقة الحساب: كل عمود يُقيَّم مرة واحدة لكل صف بدل إعادة الحساب في كل مقارنة.
  const g=st.groupBy&&byKey.get(st.groupBy);
  const sorts=st.sort.map(s=>({c:byKey.get(s.key),dir:s.dir==='desc'?-1:1})).filter(s=>s.c);
  const plan=g?[{c:g,dir:1},...sorts]:sorts;
  if(plan.length){
   const keyFor=(c,r)=>{const t=c.type||'text';const x=c.get(r);const empty=x===''||x===null||x===undefined;
    if(t==='number')return {e:empty?1:0,v:empty?0:Number(x),num:true};
    return {e:empty?1:0,v:empty?'':(t==='date'?String(x):String(c.text(r))),num:false}};
   out=out.map(r=>({r,k:plan.map(s=>keyFor(s.c,r))}))
    .sort((A,B)=>{for(let i=0;i<plan.length;i++){const a=A.k[i],b=B.k[i];if(a.e!==b.e)return a.e-b.e;if(a.v!==b.v){const x=a.num?(a.v-b.v)*plan[i].dir:a.v.localeCompare(b.v,'ar',{numeric:true})*plan[i].dir;if(x)return x}}return 0})
    .map(x=>x.r);
  }
  view=out;
 }
 function renderHead(){
  const sortMark=k=>{const i=st.sort.findIndex(s=>s.key===k);if(i<0)return '';return `<span class="dg-sortmark">${st.sort[i].dir==='asc'?'▲':'▼'}${st.sort.length>1?i+1:''}</span>`};
  const vc=visibleCols();
  const selTh=o.selectable?`<th class="dg-sel-th"><input type="checkbox" class="dg-sel-all" aria-label="تحديد كل الصفوف المعروضة"${allSelected()?' checked':''}${view.length?'':' disabled'}></th>`:'';
  $('thead').innerHTML=`<tr class="dg-hrow">${selTh}${vc.map(c=>{const w=Math.max(90,Math.min(900,Number(st.widths[c.key])||0));const pin=st.pinned.includes(c.key);
   return `<th data-key="${esc(c.key)}" ${w?`style="width:${w}px;min-width:${w}px;max-width:${w}px"`:''} class="${st.filters.has(c.key)?'dg-filtered':''}${pin?' dg-pin-th':''}"><div class="dg-th"><button type="button" class="dg-sort" title="فرز (Shift للفرز المتعدد)">${esc(c.label)} ${sortMark(c.key)}${pin?'<span class="dg-pinmark" title="مثبّت">📌</span>':''}</button><button type="button" class="dg-fbtn" aria-label="تصفية ${esc(c.label)}" title="تصفية وفرز وتثبيت">▾</button></div><span class="dg-resizer" role="separator" tabindex="0" aria-label="تغيير عرض ${esc(c.label)}"></span></th>`}).join('')}</tr>
   ${st.colSearchOn?`<tr class="dg-csrow">${o.selectable?'<th class="dg-sel-th"></th>':''}${vc.map(c=>`<th data-cs="${esc(c.key)}"><input type="search" class="dg-cs" data-key="${esc(c.key)}" value="${esc(st.colSearch[c.key]||'')}" placeholder="بحث…" aria-label="بحث في ${esc(c.label)}"></th>`).join('')}</tr>`:''}`;
  const all=$('.dg-sel-all');
  if(all){all.indeterminate=st.selected.size>0&&!allSelected()}
  layoutPins();
 }
 function cellHtml(c,r){const t=c.text(r);return `<td data-k="${esc(c.key)}" data-label="${esc(c.label)}"${c.type==='number'?' class="num"':''} title="${esc(t)}">${hl?markHtml(t,hl):esc(t)}</td>`}
 const rowHtml=(r,i,vc)=>{
  const sel=o.selectable&&st.selected.has(r);
  return `<tr data-i="${i}" tabindex="0" class="${o.onRowClick?'dg-click':''}${st.sel===i?' dg-selected':''}${sel?' dg-checked':''}">${o.selectable?`<td class="dg-sel-td"><input type="checkbox" class="dg-rowchk" data-i="${i}" aria-label="تحديد الصف"${sel?' checked':''}></td>`:''}${vc.map(c=>cellHtml(c,r)).join('')}</tr>`;
 };
 // تثبيت الأعمدة: إزاحات تراكمية للخلايا المثبتة (تعمل في RTL وLTR عبر inset-inline-start)
 function layoutPins(){
  const table=$('.dg-table');if(!table)return;
  const vc=visibleCols();
  const pins=vc.filter(c=>st.pinned.includes(c.key));
  table.classList.toggle('dg-has-pin',pins.length>0&&!st.cards);
  if(!pins.length)return;
  let offset=0;
  for(const c of pins){
   const w=(Number(st.widths[c.key])||0)||table.querySelector(`thead th[data-key="${CSS.escape(c.key)}"]`)?.getBoundingClientRect().width||140;
   table.querySelectorAll(`thead th[data-key="${CSS.escape(c.key)}"], tbody td[data-k="${CSS.escape(c.key)}"]`).forEach(el=>{el.style.insetInlineStart=Math.round(offset)+'px';el.classList.add('dg-pin-cell')});
   offset+=w;
  }
 }
 function renderWindow(force){
  const sc=$('.dg-scroll'),vc=visibleCols();
  const h=rowH||36,start=Math.max(0,Math.floor(sc.scrollTop/h)-15);
  if(!force&&start===vStart)return;vStart=start;
  const end=Math.min(view.length,start+Math.ceil((sc.clientHeight||600)/h)+30);
  let html=`<tr class="dg-vpad" aria-hidden="true"><td colspan="${vc.length+(o.selectable?1:0)}" style="height:${start*h}px"></td></tr>`;
  for(let i=start;i<end;i++)html+=rowHtml(view[i],i,vc);
  html+=`<tr class="dg-vpad" aria-hidden="true"><td colspan="${vc.length+(o.selectable?1:0)}" style="height:${(view.length-end)*h}px"></td></tr>`;
  $('tbody').innerHTML=html;
  if(!rowH){const tr=$('tbody tr[data-i]');if(tr&&tr.offsetHeight){rowH=tr.offsetHeight;vStart=-1;renderWindow(true)}}
  layoutPins();
 }
 function renderBody(){
  const vc=visibleCols();
  const colSpan=vc.length+(o.selectable?1:0);
  const shown=view.slice(0,st.shown);
  const g=st.groupBy&&byKey.get(st.groupBy);
  let html='',last=null;
  const counts=g?view.reduce((m,r)=>{const k=g.text(r)||EMPTY;m.set(k,(m.get(k)||0)+1);return m},new Map()):null;
  shown.forEach((r,i)=>{
   if(g){const k=g.text(r)||EMPTY;if(k!==last){html+=`<tr class="dg-grouprow${collapsed.has(k)?' dg-collapsed':''}" data-g="${esc(k)}" tabindex="0" title="اضغط للطي / الفتح"><th colspan="${colSpan}"><span class="dg-gcaret">${collapsed.has(k)?'◂':'▾'}</span> ${esc(g.label)}: ${esc(k)} <small>(${counts.get(k)})</small></th></tr>`;last=k}if(collapsed.has(k))return}
   html+=rowHtml(r,i,vc);
  });
  if(!view.length)html=`<tr><td colspan="${Math.max(1,colSpan)}" class="dg-empty">${esc(rows.length?'لا توجد صفوف مطابقة للتصفية.':o.emptyText)}</td></tr>`;
  if(view.length&&virtualOn())renderWindow(true);else{$('tbody').innerHTML=html;layoutPins()}
  $('.dg-count').textContent=view.length===rows.length?`${rows.length} سجل`:`${view.length} من ${rows.length} سجل`;
  const rest=virtualOn()?0:view.length-shown.length;
  $('.dg-more').innerHTML=rest>0?`<button type="button" class="ghost dg-showmore">عرض ${Math.min(rest,o.pageSize)} صف إضافي (متبقٍ ${rest})</button>`:'';
  $('.dg-clear').hidden=!(st.filters.size||st.adv.rules.length||st.quick||st.sort.length);
  renderChips();renderFoot(vc);
  renderSelbar();
  root.classList.toggle('dg-cards',st.cards);
  ['compact','normal','comfortable'].forEach(d=>root.classList.toggle('dg-d-'+d,st.density===d));$('.dg-density').value=st.density;
  ['small','medium','large'].forEach(d=>root.classList.toggle('dg-font-'+d,st.fontSize===d));$('.dg-font').value=st.fontSize;
  $('.dg-views-btn').classList.toggle('dg-chip-active',Boolean(st.activeView));
  $('.dg-cards-btn').textContent=st.cards?'جدول':'بطاقات';
  $('.dg-filter-toggle').setAttribute('aria-expanded',String(!st.filterCollapsed));$('.dg-filter-toggle').textContent=st.filterCollapsed?'▸ تصفية':'▾ تصفية';
  $('.dg-fullscreen').setAttribute('aria-pressed',String(root.classList.contains('dg-fullscreen')));$('.dg-fullscreen').textContent=root.classList.contains('dg-fullscreen')?'⛶ خروج من الشاشة':'⛶ ملء الشاشة';
 }
 function renderSelbar(){
  const sb=$('.dg-selbar');const cnt=st.selected.size;
  sb.hidden=!(o.selectable&&cnt);
  if(cnt){sb.querySelector('.dg-sel-count').textContent=`تم تحديد ${cnt} ${cnt===1?'صف':cnt===2?'صفّين':'صفوف'} — الإجراءات على نتائج العرض الحالية فقط`}
 }
 function renderChips(){
  const chips=[];
  if(st.quick)chips.push(['q','',`بحث: «${st.quick}»`]);
  const csCount=Object.values(st.colSearch).filter(Boolean).length;
  if(csCount)chips.push(['c','',`بحث الأعمدة (${csCount})`]);
  for(const [k,f] of st.filters){const c=byKey.get(k);if(!c)continue;let t;if(f.set)t=[...f.set].slice(0,3).map(v=>v===EMPTY?'(فارغ)':v).join('، ')+(f.set.size>3?` +${f.set.size-3}`:'');else{const op=(OPS[c.type]||OPS.text).find(x=>x[0]===f.op)?.[1]||f.op;t=`${op} ${f.v1||''}${f.v2?' – '+f.v2:''}`}chips.push(['f',k,`${c.label}: ${t}`])}
  const rules=st.adv.rules.filter(x=>byKey.get(x.key));if(rules.length)chips.push(['a','',`تصفية مركّبة (${rules.length} ${st.adv.logic==='or'?'أيٌّ منها':'كلها'})`]);
  st.sort.forEach((x,i)=>{const c=byKey.get(x.key);if(c)chips.push(['s',x.key,`فرز ${i+1}: ${c.label} ${x.dir==='asc'?'▲':'▼'}`])});
  const el=$('.dg-chips');el.hidden=!chips.length;
  el.innerHTML=chips.map(([t,k,l])=>`<span class="dg-fchip dg-fchip-${t}"><span>${esc(l)}</span><button type="button" data-rm="${t}" data-k="${esc(k)}" aria-label="إزالة ${esc(l)}">✕</button></span>`).join('')+(chips.length>1?'<button type="button" class="link dg-chips-clear">مسح الكل</button>':'');
 }
 function renderFoot(vc){
  const pre=o.selectable?'<td></td>':'';
  const nums=vc.filter(c=>c.type==='number'&&c.sum!==false);
  if(!nums.length||!view.length||st.cards){$('tfoot').innerHTML='';return}
  const fmt=v=>Number.isInteger(v)?v.toLocaleString('ar-EG'):v.toLocaleString('ar-EG',{maximumFractionDigits:2});
  $('tfoot').innerHTML=`<tr class="dg-total">${pre}${vc.map((c,i)=>{if(!nums.includes(c))return `<td>${i===0?`الإجمالي (${view.length})`:''}</td>`;const vals=view.map(r=>Number(c.get(r))).filter(Number.isFinite);const sum=vals.reduce((a,b)=>a+b,0);return `<td class="num" title="المتوسط: ${vals.length?fmt(sum/vals.length):'—'}">${fmt(sum)}</td>`}).join('')}</tr>`;
 }
 function render(){compute();renderHead();renderBody()}

 // ===== أحداث =====
 let qt=0;
 $('.dg-quick').addEventListener('input',e=>{clearTimeout(qt);qt=setTimeout(()=>{st.quick=e.target.value;st.shown=o.pageSize;persist();compute();renderBody()},120)});
 $('.dg-groupby').addEventListener('change',e=>{st.groupBy=e.target.value;persist();render()});
 $('.dg-filter-toggle').addEventListener('click',()=>{st.filterCollapsed=!st.filterCollapsed;root.classList.toggle('dg-filter-open',!st.filterCollapsed);persist();renderBody()});
 $('.dg-font').addEventListener('change',e=>{st.fontSize=e.target.value;persist();renderBody()});
 $('.dg-fullscreen').addEventListener('click',async()=>{if(document.fullscreenElement===root){try{await document.exitFullscreen()}catch{}root.classList.remove('dg-fullscreen')}else if(root.requestFullscreen){try{await root.requestFullscreen()}catch{root.classList.toggle('dg-fullscreen')}}else root.classList.toggle('dg-fullscreen');renderBody()});
 root.addEventListener('fullscreenchange',()=>{root.classList.toggle('dg-fullscreen',document.fullscreenElement===root);renderBody()});
 $('thead').addEventListener('pointerdown',e=>{const handle=e.target.closest('.dg-resizer');if(!handle)return;e.preventDefault();const th=handle.closest('th'),key=th?.dataset.key;if(!key)return;const startX=e.clientX,startW=th.getBoundingClientRect().width,rtl=(root.closest('[dir]')?.dir||document.documentElement.dir)==='rtl';let w=startW;const move=ev=>{w=Math.max(90,Math.min(900,startW+(rtl?startX-ev.clientX:ev.clientX-startX)));th.style.width=w+'px';th.style.minWidth=w+'px';th.style.maxWidth=w+'px'};const end=()=>{document.removeEventListener('pointermove',move,true);document.removeEventListener('pointerup',end,true);document.removeEventListener('pointercancel',end,true);st.widths[key]=Math.round(w);persist();renderBody()};document.addEventListener('pointermove',move,true);document.addEventListener('pointerup',end,true);document.addEventListener('pointercancel',end,true)});
 $('thead').addEventListener('keydown',e=>{const handle=e.target.closest('.dg-resizer');if(!handle||!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();const th=handle.closest('th'),key=th.dataset.key,rtl=(root.closest('[dir]')?.dir||document.documentElement.dir)==='rtl',delta=(e.key==='ArrowRight'?1:-1)*(rtl?-1:1)*12,w=Math.max(90,Math.min(900,(Number(st.widths[key])||th.getBoundingClientRect().width)+delta));st.widths[key]=w;persist();renderHead();[...$('thead').querySelectorAll('th')].find(x=>x.dataset.key===key)?.querySelector('.dg-resizer')?.focus()});
 $('.dg-clear').addEventListener('click',()=>{st.filters.clear();st.adv.rules=[];st.quick='';st.sort=[];st.colSearch={};st.activeView='';persist();$('.dg-quick').value='';renderAdv();render()});
 $('.dg-chips').addEventListener('click',e=>{
  if(e.target.closest('.dg-chips-clear')){$('.dg-clear').click();return}
  const b=e.target.closest('[data-rm]');if(!b)return;const t=b.dataset.rm,k=b.dataset.k;
  if(t==='q'){st.quick='';$('.dg-quick').value=''}else if(t==='c'){st.colSearch={};persist();renderHead()}else if(t==='f')st.filters.delete(k);else if(t==='a'){st.adv.rules=[];renderAdv()}else if(t==='s'){st.sort=st.sort.filter(x=>x.key!==k)}
  st.activeView='';persist();render();
 });
 $('.dg-tools-btn').addEventListener('click',e=>{const on=root.classList.toggle('dg-tools-open');e.currentTarget.setAttribute('aria-expanded',on)});
 const toggleGroup=tr=>{const k=tr.dataset.g;collapsed.has(k)?collapsed.delete(k):collapsed.add(k);renderBody()};
 $('tbody').addEventListener('click',e=>{const tr=e.target.closest('.dg-grouprow');if(tr){e.stopPropagation();toggleGroup(tr)}},true);
 $('tbody').addEventListener('keydown',e=>{const tr=e.target.closest?.('.dg-grouprow');if(tr&&(e.key==='Enter'||e.key===' ')){e.preventDefault();toggleGroup(tr)}});
 $('.dg-groupby').addEventListener('change',()=>collapsed.clear());
 root.addEventListener('keydown',e=>{if(e.key==='/'&&!/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)){e.preventDefault();$('.dg-quick').focus()}});
 $('.dg-cards-btn').addEventListener('click',()=>{st.cards=!st.cards;persist();renderBody()});
 $('.dg-density').addEventListener('change',e=>{st.density=e.target.value;rowH=0;persist();renderBody()});
 let raf=0;$('.dg-scroll').addEventListener('scroll',()=>{if(!virtualOn()||raf)return;raf=requestAnimationFrame(()=>{raf=0;renderWindow(false)})},{passive:true});
 $('.dg-print').addEventListener('click',()=>printGrid());
 $('.dg-export').addEventListener('change',e=>{const v=e.target.value;e.target.value='';if(v)exportGrid(v)});
 $('.dg-more').addEventListener('click',e=>{if(e.target.closest('.dg-showmore')){st.shown+=o.pageSize;renderBody()}});
 // بحث الأعمدة: تبديل الصف + إدخال مباشر بلا فقدان تركيز
 $('.dg-csearch-btn').addEventListener('click',()=>{st.colSearchOn=!st.colSearchOn;$('.dg-csearch-btn').classList.toggle('dg-chip-active',st.colSearchOn);$('.dg-csearch-btn').setAttribute('aria-pressed',String(st.colSearchOn));persist();render();if(st.colSearchOn)root.querySelector('.dg-cs')?.focus()});
 $('thead').addEventListener('input',e=>{const inp=e.target.closest('.dg-cs');if(!inp)return;const key=inp.dataset.key;clearTimeout(inp._t);inp._t=setTimeout(()=>{const v=inp.value.trim();if(v)st.colSearch[key]=v;else delete st.colSearch[key];st.shown=o.pageSize;persist();compute();renderBody()},250)});
 // التحديد والإجراءات الجماعية (تصدير/طباعة المحدد فقط — لا إتلاف بيانات)
 $('thead').addEventListener('change',e=>{
  const all=e.target.closest('.dg-sel-all');if(!all)return;
  if(all.checked)view.forEach(r=>st.selected.add(r));else view.forEach(r=>st.selected.delete(r));
  renderHead();renderBody();
 });
 $('tbody').addEventListener('change',e=>{
  const chk=e.target.closest('.dg-rowchk');if(!chk)return;
  const r=view[Number(chk.dataset.i)];if(!r)return;
  chk.checked?st.selected.add(r):st.selected.delete(r);
  chk.closest('tr')?.classList.toggle('dg-checked',chk.checked);
  const all=$('.dg-sel-all');if(all){all.checked=allSelected();all.indeterminate=st.selected.size>0&&!allSelected()}
  renderSelbar();
 });
 $('.dg-sel-clear').addEventListener('click',()=>{st.selected.clear();renderHead();renderBody()});
 $('.dg-sel-export').addEventListener('click',()=>exportGrid('xls',[...st.selected]));
 $('.dg-sel-csv').addEventListener('click',()=>exportGrid('csv',[...st.selected]));
 $('.dg-sel-print').addEventListener('click',()=>printGrid([...st.selected]));
 // إعادة ضبط الجدول بالكامل (إعدادات العرض فقط — لا تمس أي بيانات)
 $('.dg-reset-btn').addEventListener('click',()=>{
  if(o.storageKey)prefs.remove(PK);
  st.filters.clear();st.adv={logic:'and',rules:[]};st.quick='';st.sort=[];st.groupBy='';st.hidden=new Set(cols.filter(c=>c.hidden).map(c=>c.key));
  order.splice(0,order.length,...cols.map(c=>c.key));st.widths={};st.fontSize='medium';st.density='';st.cards=false;st.colSearch={};st.colSearchOn=false;st.pinned=[];st.views=[];st.activeView='';st.filterCollapsed=false;
  root.classList.add('dg-filter-open');$('.dg-quick').value='';$('.dg-groupby').value='';$('.dg-font').value='medium';$('.dg-csearch-btn').classList.remove('dg-chip-active');
  renderAdv();render();toast('أُعيد ضبط الجدول إلى الإعدادات الافتراضية');
 });
 $('thead').addEventListener('click',e=>{
  const th=e.target.closest('th');if(!th)return;const key=th.dataset.key;if(!key)return;
  if(e.target.closest('.dg-fbtn')){openFilter(th,key);return}
  if(e.target.closest('.dg-sort')){
   const i=st.sort.findIndex(s=>s.key===key);
   if(e.shiftKey){if(i<0)st.sort.push({key,dir:'asc'});else if(st.sort[i].dir==='asc')st.sort[i].dir='desc';else st.sort.splice(i,1)}
   else{const cur=i>=0?st.sort[i].dir:null;st.sort=cur==='asc'?[{key,dir:'desc'}]:cur==='desc'?[]:[{key,dir:'asc'}]}
   persist();render();
  }
 });
 const selectRow=tr=>{st.sel=Number(tr.dataset.i);root.querySelectorAll('tr.dg-selected').forEach(x=>x.classList.remove('dg-selected'));tr.classList.add('dg-selected')};
 const clickRow=tr=>{selectRow(tr);const r=view[Number(tr.dataset.i)];if(r&&o.onRowClick)o.onRowClick(r)};
 $('tbody').addEventListener('click',e=>{const tr=e.target.closest('tr[data-i]');if(tr&&!e.target.closest('.dg-sel-td'))clickRow(tr)});
 $('tbody').addEventListener('keydown',e=>{const tr=e.target.closest('tr[data-i]');if(!tr)return;
  if(e.key==='Enter'&&e.target!==tr){const inp=e.target.closest('input,button,a,select,textarea');if(inp)return}
  if(e.key==='Enter'){clickRow(tr)}
  else if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();let nx=e.key==='ArrowDown'?tr.nextElementSibling:tr.previousElementSibling;while(nx&&!nx.dataset.i)nx=e.key==='ArrowDown'?nx.nextElementSibling:nx.previousElementSibling;if(nx){selectRow(nx);nx.focus()}}
 });

 // ===== نافذة تصفية العمود =====
 let pop=null;
 const closePop=()=>{pop?.remove();pop=null;document.removeEventListener('mousedown',outside,true)};
 const outside=e=>{if(pop&&!pop.contains(e.target))closePop()};
 function place(el,anchor){
  document.body.append(el);
  const r=anchor.getBoundingClientRect(),w=Math.min(330,window.innerWidth-16);
  el.style.width=w+'px';
  let left=r.right-w;if(left<8)left=8;if(left+w>window.innerWidth-8)left=window.innerWidth-8-w;
  el.style.left=left+'px';
  const top=r.bottom+4,h=el.offsetHeight;el.style.top=Math.max(8,Math.min(top,window.innerHeight-h-8))+'px';
  setTimeout(()=>document.addEventListener('mousedown',outside,true),0);
 }
 function valueInputs(type,op,v1='',v2=''){
  if(NOVAL.includes(op))return '';
  const it=type==='number'?'number':type==='date'?'date':'text';
  return `<input class="dg-v1" type="${it}" value="${esc(v1)}" placeholder="القيمة">${op==='between'?`<input class="dg-v2" type="${it}" value="${esc(v2)}" placeholder="إلى">`:''}`;
 }
 function openFilter(th,key){
  closePop();
  const c=byKey.get(key),type=c.type||'text',f=st.filters.get(key)||{op:OPS[type][0][0],v1:'',v2:'',set:null};
  const pinned=st.pinned.includes(key);
  const distinct=new Map();for(const r of rows){const t=c.text(r)||EMPTY;distinct.set(t,(distinct.get(t)||0)+1)}
  const values=[...distinct.entries()].sort((a,b)=>String(a[0]).localeCompare(String(b[0]),'ar',{numeric:true})).slice(0,1000);
  pop=document.createElement('div');pop.className='dg-pop';pop.setAttribute('role','dialog');pop.setAttribute('aria-label','تصفية '+c.label);
  pop.innerHTML=`<div class="dg-pop-head"><b>${esc(c.label)}</b><button type="button" class="link dg-x" aria-label="إغلاق">✕</button></div>
   <div class="dg-pop-sort"><button type="button" class="ghost" data-dir="asc">فرز تصاعدي ▲</button><button type="button" class="ghost" data-dir="desc">فرز تنازلي ▼</button><button type="button" class="ghost dg-pintoggle" title="يبقى العمود ظاهرًا أثناء التمرير الأفقي">${pinned?'📌 إلغاء التثبيت':'📌 تثبيت العمود'}</button></div>
   <label class="dg-pop-cond">شرط<select class="dg-op">${OPS[type].map(([v,l])=>`<option value="${v}"${v===f.op?' selected':''}>${l}</option>`).join('')}</select></label><div class="dg-vals">${valueInputs(type,f.op,f.v1,f.v2)}</div>
   <div class="dg-pop-list"><input type="search" class="dg-lsearch" placeholder="بحث في القيم…"><label class="dg-all"><input type="checkbox" class="dg-allbox" ${!f.set?'checked':''}> تحديد الكل</label><div class="dg-checks">${values.map(([v,cnt])=>`<label><input type="checkbox" value="${esc(v)}" ${!f.set||f.set.has(v)?'checked':''}> <span>${esc(v)}</span> <small>${cnt}</small></label>`).join('')}</div>${distinct.size>1000?'<small class="muted">تُعرض أول 1000 قيمة.</small>':''}</div>
   <div class="dg-pop-actions"><button type="button" class="primary dg-apply">تطبيق</button><button type="button" class="ghost dg-reset">مسح تصفية العمود</button></div>`;
  place(pop,th);
  const q=s=>pop.querySelector(s);
  q('.dg-x').onclick=closePop;
  pop.querySelectorAll('[data-dir]').forEach(b=>b.onclick=()=>{st.sort=[{key,dir:b.dataset.dir}];closePop();persist();render()});
  q('.dg-pintoggle').onclick=()=>{togglePin(key);closePop()};
  q('.dg-op').onchange=e=>{q('.dg-vals').innerHTML=valueInputs(type,e.target.value,q('.dg-v1')?.value||'',q('.dg-v2')?.value||'')};
  q('.dg-lsearch').oninput=e=>{const s=n(e.target.value);pop.querySelectorAll('.dg-checks label').forEach(l=>l.hidden=Boolean(s)&&!n(l.textContent).includes(s))};
  q('.dg-allbox').onchange=e=>pop.querySelectorAll('.dg-checks label:not([hidden]) input').forEach(i=>i.checked=e.target.checked);
  q('.dg-reset').onclick=()=>{st.filters.delete(key);closePop();st.shown=o.pageSize;persist();render()};
  q('.dg-apply').onclick=()=>{
   const op=q('.dg-op').value,v1=q('.dg-v1')?.value??'',v2=q('.dg-v2')?.value??'';
   const boxes=[...pop.querySelectorAll('.dg-checks input')];const checked=boxes.filter(b=>b.checked).map(b=>b.value);
   const set=checked.length===boxes.length?null:new Set(checked);
   const hasCond=NOVAL.includes(op)||v1!==''||v2!=='';
   if(!set&&!hasCond)st.filters.delete(key);else st.filters.set(key,{op:hasCond?op:'',v1,v2,set});
   closePop();st.shown=o.pageSize;persist();render();
  };
  pop.addEventListener('keydown',e=>{if(e.key==='Escape')closePop();if(e.key==='Enter'&&e.target.matches('input:not([type=checkbox])'))q('.dg-apply').click()});
  q('.dg-op').focus();
 }
 /** تثبيت/فك تثبيت عمود (بحد أقصى عمودين) — يُحفظ مع إعدادات الجدول */
 function togglePin(key){
  const i=st.pinned.indexOf(key);
  if(i>=0)st.pinned.splice(i,1);
  else{if(st.pinned.length>=MAX_PINS)st.pinned.shift();st.pinned.push(key)}
  persist();renderHead();renderBody();
 }
 // ===== الأعمدة =====
 $('.dg-cols-btn').addEventListener('click',e=>{
  closePop();pop=document.createElement('div');pop.className='dg-pop';
  const listHtml=()=>order.map((k,i)=>{const c=byKey.get(k);const pinned=st.pinned.includes(k);return `<li draggable="true" data-k="${esc(k)}"><span class="dg-handle" title="اسحب لإعادة الترتيب">⋮⋮</span><label><input type="checkbox" value="${esc(k)}" ${st.hidden.has(k)?'':'checked'}> ${esc(c.label)}</label><button type="button" class="link dg-pinb${pinned?' dg-chip-active':''}" data-pin="${esc(k)}" title="${pinned?'إلغاء تثبيت':'تثبيت'} العمود (${MAX_PINS} كحد أقصى)">📌</button><button type="button" class="link dg-mv" data-mv="-1" ${i===0?'disabled':''} aria-label="تحريك لأعلى">▲</button><button type="button" class="link dg-mv" data-mv="1" ${i===order.length-1?'disabled':''} aria-label="تحريك لأسفل">▼</button></li>`}).join('');
  pop.innerHTML=`<div class="dg-pop-head"><b>الأعمدة — إظهار وترتيب وتثبيت</b><button type="button" class="link dg-x">✕</button></div><small class="muted">اسحب العمود لتغيير ترتيبه، و📌 لتثبيته أثناء التمرير الأفقي (حتى ${MAX_PINS} أعمدة). يُحفظ كل شيء لهذا الجدول.</small><ul class="dg-cols-list">${listHtml()}</ul><div class="dg-pop-actions"><button type="button" class="ghost dg-allcols">إظهار الكل</button><button type="button" class="ghost dg-resetcols">الترتيب الافتراضي</button></div>`;
  place(pop,e.currentTarget);
  const ul=pop.querySelector('.dg-cols-list');
  const refresh=()=>{ul.innerHTML=listHtml();persist();renderHead();renderBody()};
  pop.querySelector('.dg-x').onclick=closePop;
  ul.addEventListener('change',ev=>{const i=ev.target;if(i.type!=='checkbox')return;if(i.checked)st.hidden.delete(i.value);else st.hidden.add(i.value);persist();renderHead();renderBody()});
  ul.addEventListener('click',ev=>{const p=ev.target.closest('.dg-pinb');if(p){togglePin(p.dataset.pin);p.classList.toggle('dg-chip-active',st.pinned.includes(p.dataset.pin));return}const b=ev.target.closest('.dg-mv');if(!b)return;const k=b.closest('li').dataset.k,i=order.indexOf(k),j=i+Number(b.dataset.mv);if(j<0||j>=order.length)return;order.splice(i,1);order.splice(j,0,k);refresh()});
  let dragK=null;
  ul.addEventListener('dragstart',ev=>{const li=ev.target.closest('li');dragK=li?.dataset.k;li?.classList.add('dragging');ev.dataTransfer.effectAllowed='move';try{ev.dataTransfer.setData('text/plain',dragK)}catch{}});
  ul.addEventListener('dragover',ev=>{ev.preventDefault();ul.querySelectorAll('.drag-over').forEach(x=>x.classList.remove('drag-over'));ev.target.closest('li')?.classList.add('drag-over')});
  ul.addEventListener('dragend',()=>{ul.querySelectorAll('.dragging,.drag-over').forEach(x=>x.classList.remove('dragging','drag-over'))});
  ul.addEventListener('drop',ev=>{ev.preventDefault();const to=ev.target.closest('li')?.dataset.k;if(!dragK||!to||dragK===to)return;const from=order.indexOf(dragK),target=order.indexOf(to);order.splice(from,1);order.splice(target,0,dragK);dragK=null;refresh()});
  pop.querySelector('.dg-allcols').onclick=()=>{st.hidden.clear();refresh()};
  pop.querySelector('.dg-resetcols').onclick=()=>{order.splice(0,order.length,...cols.map(c=>c.key));refresh()};
 });
 // ===== طرق العرض المحفوظة (فلاتر + فرز + أعمدة باسم) =====
 const snapshot=()=>({quick:st.quick,filters:[...st.filters].map(([k,f])=>[k,{...f,set:f.set?[...f.set]:null}]),adv:JSON.parse(JSON.stringify(st.adv)),sort:[...st.sort],groupBy:st.groupBy,hidden:[...st.hidden],order:[...order],widths:{...st.widths},fontSize:st.fontSize,density:st.density,cards:st.cards,filterCollapsed:st.filterCollapsed,pinned:[...st.pinned],colSearch:{...st.colSearch},colSearchOn:st.colSearchOn});
 function restore(v){
  st.quick=v.quick||'';$('.dg-quick').value=st.quick;
  st.filters=new Map((v.filters||[]).filter(([k])=>byKey.has(k)).map(([k,f])=>[k,{...f,set:f.set?new Set(f.set):null}]));
  st.adv=v.adv||{logic:'and',rules:[]};st.sort=(v.sort||[]).filter(x=>byKey.has(x.key));st.groupBy=byKey.has(v.groupBy)?v.groupBy:'';$('.dg-groupby').value=st.groupBy;
  if(v.hidden)st.hidden=new Set(v.hidden);
  if(v.order){const ord=v.order.filter(k=>byKey.has(k));cols.forEach(c=>{if(!ord.includes(c.key))ord.push(c.key)});order.splice(0,order.length,...ord)}
  st.widths={...(v.widths||st.widths)};st.fontSize=['small','medium','large'].includes(v.fontSize)?v.fontSize:st.fontSize;st.density=v.density||st.density;st.cards=v.cards===undefined?st.cards:Boolean(v.cards);st.filterCollapsed=Boolean(v.filterCollapsed);root.classList.toggle('dg-filter-open',!st.filterCollapsed);
  st.pinned=(Array.isArray(v.pinned)?v.pinned:[]).filter(k=>byKey.has(k)).slice(0,MAX_PINS);st.colSearch=v.colSearch&&typeof v.colSearch==='object'?{...v.colSearch}:{};st.colSearchOn=Boolean(v.colSearchOn);
  st.shown=o.pageSize;renderAdv();$('.dg-adv').hidden=!st.adv.rules.length||st.filterCollapsed;persist();render();
 }
 $('.dg-views-btn').addEventListener('click',e=>{
  closePop();pop=document.createElement('div');pop.className='dg-pop';
  const draw=()=>{pop.innerHTML=`<div class="dg-pop-head"><b>طرق العرض المحفوظة</b><button type="button" class="link dg-x">✕</button></div>
   <div class="dg-views">${st.views.map((v,i)=>`<div class="dg-view"><button type="button" class="ghost${st.activeView===v.name?' dg-chip-active':''}" data-vi="${i}">★ ${esc(v.name)}</button><button type="button" class="link" data-vup="${i}" title="تحديث بالحالة الحالية">⟳</button><button type="button" class="link danger" data-vdel="${i}" aria-label="حذف">✕</button></div>`).join('')||'<p class="muted small">لا توجد طرق عرض محفوظة. طبّق الفلاتر والفرز ثم احفظها باسم لتسترجعها بنقرة.</p>'}</div>
   <form class="dg-vsave" style="display:flex;gap:6px"><input name="nm" placeholder="اسم العرض، مثل: جلسات الأسبوع" required style="flex:1"><button class="primary">حفظ</button></form>`;
   pop.querySelector('.dg-x').onclick=closePop;
   pop.querySelector('.dg-vsave').onsubmit=ev=>{ev.preventDefault();const nm=ev.target.nm.value.trim();if(!nm)return;const i=st.views.findIndex(v=>v.name===nm);const v={name:nm,state:snapshot(),at:new Date().toISOString()};if(i>=0)st.views[i]=v;else st.views.push(v);st.activeView=nm;persist();draw();renderBody()};
  };
  draw();place(pop,e.currentTarget);
  pop.addEventListener('click',ev=>{const b=ev.target.closest('button');if(!b)return;
   if(b.dataset.vi!==undefined){const v=st.views[Number(b.dataset.vi)];st.activeView=v.name;closePop();restore(v.state)}
   else if(b.dataset.vup!==undefined){st.views[Number(b.dataset.vup)].state=snapshot();persist();draw()}
   else if(b.dataset.vdel!==undefined){const [v]=st.views.splice(Number(b.dataset.vdel),1);if(st.activeView===v?.name)st.activeView='';persist();draw();renderBody()}});
 });
 // ===== التصفية المركّبة =====
 function renderAdv(){
  const el=$('.dg-adv');
  const opsFor=k=>OPS[byKey.get(k)?.type||'text'];
  el.innerHTML=`<div class="dg-adv-head"><b>تصفية مركّبة</b><label>تطابق <select class="dg-logic"><option value="and"${st.adv.logic==='and'?' selected':''}>كل الشروط (و)</option><option value="or"${st.adv.logic==='or'?' selected':''}>أي شرط (أو)</option></select></label></div>
   ${st.adv.rules.map((r,i)=>`<div class="dg-rule" data-i="${i}"><select class="dg-rkey">${cols.map(c=>`<option value="${esc(c.key)}"${c.key===r.key?' selected':''}>${esc(c.label)}</option>`).join('')}</select><select class="dg-rop">${opsFor(r.key).map(([v,l])=>`<option value="${v}"${v===r.op?' selected':''}>${l}</option>`).join('')}</select><span class="dg-rvals">${valueInputs(byKey.get(r.key)?.type,r.op,r.v1,r.v2)}</span><button type="button" class="link dg-rdel" aria-label="حذف الشرط">✕</button></div>`).join('')||'<p class="muted">لا توجد شروط. أضف شرطًا.</p>'}
   <div class="dg-adv-actions"><button type="button" class="ghost dg-radd">+ شرط</button><button type="button" class="primary dg-rapply">تطبيق</button><button type="button" class="ghost dg-rclear">مسح الشروط</button></div>`;
 }
 const readAdv=()=>{const el=$('.dg-adv');st.adv.logic=el.querySelector('.dg-logic')?.value||'and';el.querySelectorAll('.dg-rule').forEach(div=>{const r=st.adv.rules[Number(div.dataset.i)];r.key=div.querySelector('.dg-rkey').value;r.op=div.querySelector('.dg-rop').value;r.v1=div.querySelector('.dg-v1')?.value??'';r.v2=div.querySelector('.dg-v2')?.value??''})};
 $('.dg-adv-btn').addEventListener('click',()=>{const el=$('.dg-adv');el.hidden=!el.hidden;if(!el.hidden){st.filterCollapsed=false;root.classList.add('dg-filter-open');if(!st.adv.rules.length)st.adv.rules.push({key:cols[0].key,op:OPS[cols[0].type||'text'][0][0],v1:'',v2:''});renderAdv()}persist()});
 $('.dg-adv').addEventListener('click',e=>{
  if(e.target.closest('.dg-radd')){readAdv();const c=visibleCols()[0]||cols[0];st.adv.rules.push({key:c.key,op:OPS[c.type||'text'][0][0],v1:'',v2:''});renderAdv()}
  else if(e.target.closest('.dg-rdel')){readAdv();st.adv.rules.splice(Number(e.target.closest('.dg-rule').dataset.i),1);renderAdv()}
  else if(e.target.closest('.dg-rapply')){readAdv();st.shown=o.pageSize;persist();render()}
  else if(e.target.closest('.dg-rclear')){st.adv.rules=[];renderAdv();persist();render()}
 });
 $('.dg-adv').addEventListener('change',e=>{
  if(e.target.matches('.dg-rkey')){readAdv();const r=st.adv.rules[Number(e.target.closest('.dg-rule').dataset.i)];r.op=OPS[byKey.get(r.key)?.type||'text'][0][0];r.v1='';r.v2='';renderAdv()}
  else if(e.target.matches('.dg-rop')){readAdv();renderAdv()}
 });

 // ===== الطباعة والتصدير =====
 function matrix(full=true,srcRows=null){const src=srcRows||view;const vc=visibleCols().filter(c=>full||!(c.sensitive||SENSITIVE.test(c.key)));return {head:vc.map(c=>c.label),body:src.map(r=>vc.map(c=>c.text(r)))}}
 function tableHtml(full=false,srcRows=null){const {head,body}=matrix(full,srcRows);return `<table border="1" cellspacing="0" cellpadding="4" dir="rtl"><thead><tr>${head.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${body.map(r=>`<tr>${r.map(v=>`<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`}
 function docHtml(forPrint,full=false,srcRows=null){
  const now=new Date();const stamp=`${String(now.getDate()).padStart(2,'0')}/${String(now.getMonth()+1).padStart(2,'0')}/${now.getFullYear()}`;
  const src=srcRows||view;
  const filt=[st.quick&&`بحث: ${st.quick}`,...[...st.filters.keys()].map(k=>`تصفية: ${byKey.get(k)?.label}`),st.adv.rules.length&&`شروط مركبة: ${st.adv.rules.length}`,st.groupBy&&`تجميع: ${byKey.get(st.groupBy)?.label}`,srcRows&&`صفوف محددة: ${srcRows.length}`].filter(Boolean).join(' — ');
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(o.title||'تقرير')}</title><style>body{font-family:"Noto Sans Arabic","Segoe UI",Tahoma,sans-serif;margin:18px;color:#111}h1{font-size:18px;margin:0 0 4px}p{margin:2px 0;font-size:12px;color:#444}table{border-collapse:collapse;width:100%;font-size:11px;margin-top:10px}th{background:#eef1f5}th,td{border:1px solid #999;padding:4px 6px;text-align:right;vertical-align:top}thead{display:table-header-group}tr{page-break-inside:avoid}${forPrint?'@page{size:A4 landscape;margin:10mm}':''}</style></head><body><h1>${esc(APP_NAME)}</h1><p><b>${esc(o.title||'تقرير')}</b> — عدد السجلات: ${src.length} — تاريخ الطباعة: ${stamp}</p>${filt?`<p>${esc(filt)}</p>`:''}${tableHtml(full,srcRows)}${forPrint?'<script>window.onload=()=>{window.print()}<\\/script>':''}</body></html>`;
 }
 function printGrid(srcRows=null){const w=window.open('','_blank');if(!w){alert('اسمح بالنوافذ المنبثقة للطباعة.');return}w.document.open();w.document.write(docHtml(true,false,srcRows));w.document.close()}
 function download(content,name,type){const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000)}
 function exportGrid(kind,srcRows=null){
  const full=kind.endsWith(':full');kind=kind.replace(':full','');
  const base=((o.exportName||o.title||'report')+'-'+formatDate(new Date()).replace(/\//g,'-')).replace(/[\\/:*?"<>|]+/g,'-');const {head,body}=matrix(full,srcRows);
  if(kind==='csv'){const q=v=>`"${String(v??'').replace(/"/g,'""')}"`;download('\ufeff'+[head,...body].map(r=>r.map(q).join(',')).join('\r\n'),base+'.csv','text/csv;charset=utf-8')}
  else if(kind==='txt'){download('\ufeff'+[head,...body].map(r=>r.map(v=>String(v??'').replace(/[\t\r\n]+/g,' ')).join('\t')).join('\r\n'),base+'.txt','text/plain;charset=utf-8')}
  else if(kind==='xls'){download('\ufeff'+`<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" dir="rtl"><head><meta charset="utf-8"><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>Sheet1</x:Name><x:WorksheetOptions><x:DisplayRightToLeft/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--></head><body>${tableHtml(full,srcRows)}</body></html>`,base+'.xls','application/vnd.ms-excel;charset=utf-8')}
  else if(kind==='doc'){download('\ufeff'+docHtml(false,false,srcRows),base+'.doc','application/msword;charset=utf-8')}
 }

 renderAdv();$('.dg-adv').hidden=!st.adv.rules.length||st.filterCollapsed;
 render();
 return {
  setRows(r){rows=r||[];st.shown=o.pageSize;render()},
  getView:()=>view,
  get rows(){return rows},
  applyFilter(key,op,v1,v2=''){st.filters.set(key,{op,v1,v2,set:null});render()},
  sortBy(key,dir='asc'){st.sort=[{key,dir}];render()},
  togglePin(key){togglePin(key)},
  getSelection(){return [...st.selected]},
  clearSelection(){st.selected.clear();renderHead();renderBody()},
  setColSearch(key,val){if(val)st.colSearch[key]=val;else delete st.colSearch[key];compute();renderBody()},
  isColSearchOn(){return st.colSearchOn},
  exportData:kind=>exportGrid(kind),
  docHtml:()=>docHtml(false)
 };
}
