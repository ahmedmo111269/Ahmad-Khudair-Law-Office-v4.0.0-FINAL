// جدول بيانات عام بأسلوب Microsoft Access الاحترافي:
// فرز متعدد المستويات بمفاتيح مسبقة الحساب (سريع مع آلاف الصفوف)، تصفية لكل عمود (شرط + قيم مميزة)،
// تصفية مركّبة و/أو، بحث داخل الأعمدة، تثبيت أعمدة (Sticky في RTL/LTR)، تحديد صفوف وإجراءات جماعية آمنة
// (تصدير/طباعة المحدد فقط)، تجميع، اختيار الأعمدة بالسحب، كثافة وحجم خط، عرض بطاقات، ملء الشاشة،
// طرق عرض محفوظة، إعادة ضبط، طباعة وتصدير Excel/Word/CSV/TXT، وتمرير افتراضي فوق 600 صف.
import {esc} from './dom.js';
import {normalizeArabic} from '../core/search-normalizer.js';
import {applyGridQuery,createGridQuery,sortGridRows,GRID_FILTER_OPERATORS,isValueFreeGridFilter} from '../core/grid-query.js';
import {defineGridColumns,gridPreferenceKey} from './grid-columns.js';
import {createPrintContext,printColumns} from '../core/grid-print-context.js';
import {APP_NAME} from '../core/constants.js';
import {prefs} from '../core/preferences.js';
import {formatDate} from '../core/format.js';
import {toast} from './toast.js';
import {resolveCollapseState,saveCollapseState,clearCollapseState,getCollapseRecord,isCollapsePinned,getCollapsePreferences} from './collapse-state.js';
import {collapsePinMarkup,bindCollapsePin,syncCollapsePin} from './collapsible.js';
import {resolveGridDisplay} from '../core/display-prefs.js';
import {open as overlayOpen} from './overlay-stack.js';

let gridInstance=0;
// قوائم الجدول المنبثقة (تصفية عمود/تفاصيل خلية/مظهر الجدول) طبقة علوية:
// زر الرجوع في Android يغلقها وحدها، تمامًا كما يفعل زر ✕.
let releasePopGuard=null;
function armPopGuard(){
 if(releasePopGuard)return;
 releasePopGuard=overlayOpen('grid-pop',()=>{const x=document.querySelector('.dg-pop .dg-x');if(!x)return false;x.click();return true});
}
function disarmPopGuard(){const release=releasePopGuard;releasePopGuard=null;try{release?.()}catch{/* متجاهَل */}}

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
function highlighters(q){return String(q||'').trim().split(/\s+/).filter(Boolean).map(highlighter).filter(Boolean)}
function markHtml(text,re){
 const res=Array.isArray(re)?re:(re?[re]:[]);
 if(!res.length)return esc(text);
 const s=String(text);const ranges=[];
 for(const rx of res){rx.lastIndex=0;let m;while((m=rx.exec(s))){if(!m[0]){rx.lastIndex++;continue}ranges.push([m.index,m.index+m[0].length])}}
 if(!ranges.length)return esc(s);
 ranges.sort((a,b)=>a[0]-b[0]||b[1]-a[1]);
 const merged=[];for(const r of ranges){const last=merged.at(-1);if(!last||r[0]>last[1])merged.push([r[0],r[1]]);else last[1]=Math.max(last[1],r[1])}
 let out='',i=0;for(const [a,b] of merged){out+=esc(s.slice(i,a))+'<mark>'+esc(s.slice(a,b))+'</mark>';i=b}return out+esc(s.slice(i));
}
const OPS=GRID_FILTER_OPERATORS;
const NOVAL=['empty','notEmpty','isTrue','isFalse','today','yesterday','thisWeek','thisMonth','thisYear'];
const n=v=>normalizeArabic(String(v??''));
const EMPTY='(فارغ)';

// ===== مظهر الجدول (إعدادات عرض مستقلة لكل جدول ضمن Universal DataGrid) =====
// تُحفظ داخل مفتاح الجدول نفسه grid:<storageKey> وتُطبق كـ CSS Variables على
// جذر الجدول — تغيير محلي فوري بلا إعادة رسم وبلا أي مساس بالبيانات.
const hexOk=v=>typeof v==='string'&&/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v.trim())?v.trim().toLowerCase():'';
const numOk=(v,min,max,step)=>{const n=Number(v);if(!Number.isFinite(n))return null;const q=Math.round(n/step)*step;return Math.round(Math.min(max,Math.max(min,q))*100)/100};
function sanitizeAppear(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return {};
 const a={};
 const fp=numOk(raw.fontPx,10,20,.5);if(fp!==null)a.fontPx=fp;
 const rp=numOk(raw.rowPad,2,18,1);if(rp!==null)a.rowPad=rp;
 for(const k of ['headBg','headColor','textColor','rowBg','borderColor']){const c=hexOk(raw[k]);if(c)a[k]=c}
 return a;
}

export function mountGrid(root,opts){
 const o={title:'',emptyText:'لا توجد سجلات.',pageSize:300,storageKey:'',onRowClick:null,selectable:false,...opts};
 const provider=o.dataProvider||o.provider||null;
 if(provider&&typeof provider.getRows!=='function')throw new TypeError('DataGrid provider must implement getRows(query, context).');
 const cols=defineGridColumns(o.columns||[]);
 const byKey=new Map(cols.map(c=>[c.key,c]));
 let rows=o.rows||[];
 const instance=++gridInstance;
 const PK=gridPreferenceKey(o.gridId||o.storageKey);
 const legacy=(()=>{if(!PK)return null;try{return JSON.parse(localStorage.getItem(PK)||'null')}catch{return null}})();
 const saved=(PK&&prefs.get(PK))||legacy||{};
 const collapseScope=String(o.collapseKey||o.gridId||o.storageKey||`anonymous:${instance}`);
 const shellCollapseKey=`datagrid:${collapseScope}:section`;
 const toolsCollapseKey=`datagrid:${collapseScope}:tools`;
 const filterCollapseKey=`datagrid:${collapseScope}:filters`;
 const order=(Array.isArray(saved.order)?saved.order:[]).filter(k=>byKey.has(k));cols.forEach(c=>{if(!order.includes(c.key))order.push(c.key)});
 const st={sort:(Array.isArray(saved.sort)?saved.sort:[]).filter(x=>byKey.has(x.key)),filters:new Map((Array.isArray(saved.filters)?saved.filters:[]).filter(([k])=>byKey.has(k)).map(([k,f])=>[k,{...f,set:f?.set?new Set(f.set):null}])),adv:saved.adv&&Array.isArray(saved.adv.rules)?saved.adv:{logic:'and',rules:[]},quick:saved.quick||'',groupBy:byKey.has(saved.groupBy)?saved.groupBy:'',hidden:new Set(saved.hidden||cols.filter(c=>c.hidden).map(c=>c.key)),widths:{...(saved.widths||{})},fontSize:['small','medium','large'].includes(saved.fontSize)?saved.fontSize:(resolveGridDisplay().fontSize||'medium'),filterCollapsed:resolveCollapseState(filterCollapseKey,{fallback:true,legacy:typeof saved.filterCollapsed==='boolean'?saved.filterCollapsed:undefined}),shown:o.pageSize,cards:Boolean(saved.cards),density:['','compact','normal','comfortable','mobile'].includes(saved.density)?saved.density:(resolveGridDisplay().density||''),views:Array.isArray(saved.views)?saved.views:[],sel:-1,activeView:String(saved.activeView||''),
  pinned:(Array.isArray(saved.pinned)?saved.pinned:[]).filter(k=>byKey.has(k)).slice(0,MAX_PINS),
  colSearch:saved.colSearch&&typeof saved.colSearch==='object'&&!Array.isArray(saved.colSearch)?{...saved.colSearch}:{},
  colSearchOn:Boolean(saved.colSearchOn),selected:new Set(),
  searchCol:byKey.has(saved.searchCol)?saved.searchCol:'',
  span:['wide','full'].includes(saved.span)?saved.span:'',
  tableWidth:Math.max(100,Math.min(220,Number(saved.tableWidth)||100)),
  appear:sanitizeAppear(saved.appear),
  shellCollapsed:resolveCollapseState(shellCollapseKey,{fallback:false,legacy:typeof saved.shellCollapsed==='boolean'?saved.shellCollapsed:undefined,primary:true}),
  toolsCollapsed:resolveCollapseState(toolsCollapseKey,{fallback:true,legacy:typeof saved.toolsCollapsed==='boolean'?saved.toolsCollapsed:undefined}),
  remotePageSize:[25,50,100].includes(Number(saved.remotePageSize))?Number(saved.remotePageSize):([25,50,100].includes(Number(o.pageSize))?Number(o.pageSize):25),
  qaOn:saved.qaOn!==false};
 if(!st.views.some(v=>v?.name===st.activeView))st.activeView='';
 const remote=Boolean(provider);
 const pageCursors=[null];let pageIndex=0,providerSequence=0,providerController=null,providerObserver=null;
 let providerMeta={loading:false,error:'',total:null,totalExact:false,hasMore:false,nextCursor:null,sortStatus:null};
 const selectedRowsByKey=new Map();
 const rowKey=row=>String(o.getRowId?.(row)??row?.id??row);
 const isRowSelected=row=>st.selected.has(rowKey(row));
 const selectedRows=()=>[...st.selected].map(key=>selectedRowsByKey.get(key)).filter(Boolean);
 // One-time migration of pre-central grid collapse settings. After this point the
 // shared store is authoritative, so temporary bulk changes cannot leak through
 // the older grid-view preference object.
 const migrateLegacyCollapse=!getCollapsePreferences().legacyDisabled;
 for(const [key,field,property] of [[filterCollapseKey,'filterCollapsed','filterCollapsed'],[toolsCollapseKey,'toolsCollapsed','toolsCollapsed'],[shellCollapseKey,'shellCollapsed','shellCollapsed']]){
  if(migrateLegacyCollapse&&!getCollapseRecord(key)&&typeof saved[field]==='boolean')saveCollapseState(key,st[property]);
 }
 let hl=null;const collapsed=new Set();
 let view=[];
 root.classList.add('dg');
 root.dataset.gridId=PK||`grid:anonymous:${instance}`;
 const bodyId=`dg-body-${instance}`,toolsId=`dg-tools-${instance}`;
 root.dataset.collapseReady='true';root.dataset.collapseType='grid';root.dataset.collapseKey=shellCollapseKey;root.dataset.collapseCollapsed=String(st.shellCollapsed);
 root.innerHTML=`<div class="dg-shell-head"><button type="button" class="dg-shell-toggle" aria-expanded="${st.shellCollapsed?'false':'true'}" aria-controls="${bodyId}"><span class="dg-caret" aria-hidden="true">${st.shellCollapsed?'›':'⌄'}</span><span class="dg-shell-title">${esc(o.title||'الجدول')}</span><span class="dg-shell-count"></span></button>${collapsePinMarkup(shellCollapseKey,isCollapsePinned(shellCollapseKey),'collapse-pin dg-shell-pin')}<button type="button" class="dg-head-gear" title="تخصيص مظهر الجدول" aria-label="تخصيص مظهر الجدول" aria-haspopup="dialog">🎨</button></div><div class="dg-body" id="${bodyId}"><div class="dg-tools-summary"><button type="button" class="dg-tools-summary-toggle" aria-expanded="${st.toolsCollapsed?'false':'true'}" aria-controls="${toolsId}"><span class="dg-tools-label">🔍 عوامل التصفية والتخصيص</span><span class="dg-tools-active"></span><span class="dg-tools-view"></span><span class="dg-tools-caret" aria-hidden="true">${st.toolsCollapsed?'›':'⌄'}</span></button>${collapsePinMarkup(toolsCollapseKey,isCollapsePinned(toolsCollapseKey),'collapse-pin dg-tools-pin')}</div><div class="dg-tools-panel" id="${toolsId}"${st.toolsCollapsed?' hidden':''}><div class="dg-toolbar"><button type="button" class="ghost dg-filter-toggle" aria-expanded="${!st.filterCollapsed}" aria-label="${st.filterCollapsed?'فتح':'طي'} عوامل التصفية" title="إظهار أو إخفاء عوامل التصفية">${st.filterCollapsed?'›':'⌄'} عوامل التصفية</button>${collapsePinMarkup(filterCollapseKey,isCollapsePinned(filterCollapseKey),'collapse-pin dg-filter-pin')}
  <input class="dg-quick" type="search" placeholder="بحث فوري في النتائج… ( / )" aria-label="بحث داخل النتائج">
  <select class="dg-scope" aria-label="نطاق البحث" title="بحث في كل الأعمدة أو عمود محدد"><option value="">كل الأعمدة</option>${cols.filter(c=>c.searchable).map(c=>`<option value="${esc(c.key)}">${esc(c.label)}</option>`).join('')}</select>
  <button type="button" class="ghost dg-adv-btn">تصفية مركّبة</button>
  <button type="button" class="ghost dg-csearch-btn" title="صف بحث تحت كل عمود" aria-pressed="${st.colSearchOn}">بحث الأعمدة</button>
  <label class="dg-group-lbl">تجميع حسب <select class="dg-groupby"><option value="">بدون</option>${cols.map(c=>`<option value="${esc(c.key)}">${esc(c.label)}</option>`).join('')}</select></label>
  <button type="button" class="ghost dg-cols-btn">تخصيص الجدول</button>
  <button type="button" class="ghost dg-views-btn" title="حفظ واسترجاع الفلاتر والفرز باسم">★ طرق العرض</button>
  <button type="button" class="ghost dg-unsort" title="إلغاء جميع عمليات الفرز">إلغاء الفرز</button>
  <button type="button" class="ghost dg-reset-btn" title="إعادة ضبط كل إعدادات هذا الجدول">↺ إعادة ضبط</button>
  <select class="dg-density" aria-label="كثافة العرض" title="كثافة العرض"><option value="">كثافة: حسب الثيم</option><option value="compact">مضغوط</option><option value="normal">عادي</option><option value="comfortable">مريح</option><option value="mobile">مناسب للموبايل</option></select>
  <select class="dg-span" aria-label="اتساع الجدول" title="اتساع الجدول"><option value="">عرض عادي</option><option value="wide">عرض واسع</option><option value="full">ملء العرض</option></select>
  <label class="dg-width-lbl" title="تكبير أو تصغير عرض الجدول يدويًا">العرض <input type="range" class="dg-width" min="100" max="220" step="10" value="${st.tableWidth}" aria-label="عرض الجدول بالنسبة المئوية"></label>
  <select class="dg-font" aria-label="حجم خط الجدول" title="حجم الخط"><option value="small">خط صغير</option><option value="medium">خط متوسط</option><option value="large">خط كبير</option></select>
  <button type="button" class="ghost dg-cards-btn" title="تبديل العرض">بطاقات</button><button type="button" class="ghost dg-fullscreen" title="ملء الشاشة" aria-pressed="false">⛶ ملء الشاشة</button>
  <span class="dg-filter-actions"><button type="button" class="primary small dg-filter-apply">تطبيق</button><button type="button" class="ghost small dg-clear" hidden>مسح الكل</button><button type="button" class="ghost small dg-save-filter">حفظ التصفية</button><button type="button" class="ghost small dg-filter-close">إغلاق</button></span>
  <span class="dg-count" aria-live="polite"></span>
  <span class="dg-spacer"></span>
  <button type="button" class="ghost dg-print">طباعة</button>
  <select class="dg-export" aria-label="تصدير"><option value="">تصدير…</option><option value="xls">Excel</option><option value="doc">Word</option><option value="csv">CSV</option><option value="txt">نص TXT</option><optgroup label="يشمل البيانات الحساسة"><option value="xls:full">Excel كامل</option><option value="csv:full">CSV كامل</option></optgroup></select>
 </div>
 <div class="dg-selbar" hidden><b class="dg-sel-count"></b><span class="dg-bulk-slot"></span><button type="button" class="ghost small dg-sel-export">Excel المحدد</button><button type="button" class="ghost small dg-sel-csv">CSV المحدد</button><button type="button" class="ghost small dg-sel-print">طباعة المحدد</button><button type="button" class="ghost small dg-open-sel">فتح المحدد</button><button type="button" class="link dg-sel-clear">مسح التحديد</button></div>
 <div class="dg-chips" hidden aria-label="التصفية النشطة"></div>
 <div class="dg-adv" hidden></div></div>
 <div class="dg-scroll" tabindex="0"><table class="dg-table"><thead></thead><tbody></tbody><tfoot></tfoot></table></div>
 <div class="dg-state" role="status" aria-live="polite" hidden></div>
 <div class="dg-footbar"><span class="dg-foot-count"></span><span class="dg-provider-note"></span>
  <div class="dg-pagebar" hidden><button type="button" class="ghost small dg-page-prev">السابق</button><span class="dg-page-label"></span><label>صفوف الصفحة <select class="dg-page-size" aria-label="عدد الصفوف في الصفحة"><option value="25">25</option><option value="50">50</option><option value="100">100</option></select></label><button type="button" class="ghost small dg-page-next">التالي</button></div>
  <div class="dg-more"></div>
 </div></div>`;
 const $=s=>root.querySelector(s);
 root.classList.toggle('dg-filter-open',!st.filterCollapsed);
 root.classList.toggle('dg-shell-closed',st.shellCollapsed);
 root.classList.toggle('dg-tools-collapsed',st.toolsCollapsed);
 $('.dg-quick').value=st.quick;$('.dg-groupby').value=st.groupBy;$('.dg-font').value=st.fontSize;$('.dg-page-size').value=String(st.remotePageSize);
 if($('.dg-scope'))$('.dg-scope').value=st.searchCol||'';
 if($('.dg-span'))$('.dg-span').value=st.span||'';
 if($('.dg-width'))$('.dg-width').value=st.tableWidth;
 $('.dg-csearch-btn').classList.toggle('dg-chip-active',st.colSearchOn);
 // مظهر الجدول المحفوظ: متغيرات CSS على الجذر — كل جدول يحتفظ بإعداداته الخاصة
 const applyAppear=()=>{
  const a=st.appear||{},sx=root.style;
  const set=(k,v)=>{if(v)sx.setProperty(k,v);else sx.removeProperty(k)};
  set('--dg-fpx',a.fontPx?`${a.fontPx}px`:'');
  set('--dg-head-bg',a.headBg||'');
  set('--dg-head-color',a.headColor||'');
  set('--dg-text',a.textColor||'');
  set('--dg-row-bg',a.rowBg||'');
  set('--dg-rowpad',a.rowPad!=null?`${a.rowPad}px`:'');
  set('--dg-borderc',a.borderColor||'');
  root.classList.toggle('dg-customrowbg',Boolean(a.rowBg));
 };
 applyAppear();
 const visibleCols=()=>order.map(k=>byKey.get(k)).filter(c=>c&&!st.hidden.has(c.key));
 const persist=()=>{if(PK)prefs.set(PK,{hidden:[...st.hidden],order:[...order],sort:st.sort,density:st.density,cards:st.cards,views:st.views,activeView:st.activeView,filters:[...st.filters].map(([k,f])=>[k,{...f,set:f.set?[...f.set]:null}]),adv:st.adv,quick:st.quick,groupBy:st.groupBy,widths:st.widths,fontSize:st.fontSize,pinned:[...st.pinned],colSearch:st.colSearch,colSearchOn:st.colSearchOn,searchCol:st.searchCol,span:st.span,tableWidth:st.tableWidth,qaOn:st.qaOn,remotePageSize:st.remotePageSize,appear:st.appear})};
 const makeQuery=()=>createGridQuery({
  search:{text:st.quick,column:st.searchCol},
  filters:{logic:'and',rules:[
   ...[...st.filters].map(([key,f])=>({key,op:f.op||'',v1:f.v1||'',v2:f.v2||'',set:f.set?[...f.set]:null,valueType:f.valueType,setValueType:f.setValueType})),
   ...Object.entries(st.colSearch).filter(([,value])=>value).map(([key,value])=>({key,op:'contains',v1:value}))
  ]},
  advanced:{logic:st.adv.logic,rules:st.adv.rules.filter(rule=>byKey.has(rule.key)&&(isValueFreeGridFilter(rule.op)||rule.v1!==''||rule.v2!==''))},
  sort:st.sort,
  groupBy:st.groupBy,
  columnSearch:{},
  pagination:{mode:'cursor',size:st.remotePageSize,cursor:pageCursors[pageIndex]??null,direction:'next',page:pageIndex+1}
 });
 function changeQuery({resetPage=true}={}){
  if(resetPage&&remote){pageIndex=0;pageCursors.splice(1);pageCursors[0]=null}
  persist();
  if(remote)loadProviderRows();else render();
 }
 async function loadProviderRows(){
  if(!remote||!root.isConnected)return;
  const sequence=++providerSequence;
  try{providerController?.abort()}catch{}
  providerController=typeof AbortController==='function'?new AbortController():null;
  const signal=providerController?.signal;
  const query=makeQuery();
  providerMeta={...providerMeta,loading:true,error:''};
  o.onProviderState?.({phase:'loading',query,meta:providerMeta});
  renderBody();
  try{
   const result=await provider.getRows(query,{columns:cols,signal});
   if(sequence!==providerSequence||!root.isConnected)return;
   const nextRows=Array.isArray(result)?result:(Array.isArray(result?.rows)?result.rows:[]);
   await o.onRowsLoaded?.(nextRows,query,result||{});
   if(sequence!==providerSequence||!root.isConnected)return;
   rows=nextRows;
   providerMeta={loading:false,error:'',total:result?.total!==null&&result?.total!==undefined&&Number.isFinite(Number(result.total))?Number(result.total):null,totalExact:Boolean(result?.totalExact),hasMore:Boolean(result?.hasMore),nextCursor:result?.nextCursor||null,sortStatus:result?.sortStatus||null,page:pageIndex+1,pageSize:st.remotePageSize};
   rows.forEach(row=>{const key=rowKey(row);if(st.selected.has(key))selectedRowsByKey.set(key,row)});
   render();
   o.onProviderState?.({phase:'ready',query,rows,meta:providerMeta});
  }catch(error){
   if(sequence!==providerSequence||error?.name==='AbortError'||!root.isConnected)return;
   providerMeta={...providerMeta,loading:false,error:String(error?.message||'تعذر تحميل البيانات.')};
   renderBody();
   o.onProviderState?.({phase:'error',query,error,meta:providerMeta});
  }
 }
 const virtualOn=()=>view.length>VIRTUAL_THRESHOLD&&!st.groupBy&&!st.cards&&st.density!=='mobile';
 let rowH=0,vStart=-1;
 const allSelected=()=>view.length>0&&view.every(isRowSelected);

 const showQa=()=>Boolean(o.rowMenu)&&st.qaOn;
 const extraCols=()=>(o.selectable?1:0)+(showQa()?1:0);
 const fmtN=v=>Number(v||0).toLocaleString('ar-EG');
 function activeFilterCount(){
  let n=st.filters.size+(st.quick?1:0)+(Object.values(st.colSearch).some(Boolean)?1:0);
  n+=st.adv.rules.filter(x=>byKey.get(x.key)&&(isValueFreeGridFilter(x.op)||x.v1!==''||x.v2!=='')).length;
  return n;
 }
 function updateCollapseSummary(count=activeFilterCount()){
  const n=Number(count)||0;
  const active=$('.dg-tools-active');if(active)active.textContent=n?`— ${fmtN(n)} فلاتر نشطة`:'— لا توجد فلاتر نشطة';
  const currentView=$('.dg-tools-view');if(currentView)currentView.textContent=`العرض: ${st.activeView||'الافتراضي'}`;
  const shellCount=$('.dg-shell-count');
  const shownSummary=remote?(providerMeta.totalExact&&providerMeta.total!==null?`${fmtN(providerMeta.total)} نتيجة`:`${fmtN(view.length)} في الصفحة ${fmtN(pageIndex+1)}`):`${fmtN(view.length)} نتيجة`;
  if(shellCount)shellCount.textContent=`— ${shownSummary}${n?` · ${fmtN(n)} فلاتر نشطة`:''}${st.activeView?` · ${st.activeView}`:''}`;
 }
 function applyChrome(){
  root.style.setProperty('--dg-w',(st.tableWidth||100)+'%');
  root.classList.toggle('dg-span-wide',st.span==='wide'||st.span==='full');
  root.classList.toggle('dg-span-full',st.span==='full');
  root.classList.toggle('dg-shell-closed',st.shellCollapsed);
  root.classList.toggle('dg-tools-collapsed',st.toolsCollapsed);
  root.classList.toggle('dg-tools-open',!st.toolsCollapsed);
  root.classList.toggle('dg-filter-open',!st.filterCollapsed);
  root.dataset.collapseCollapsed=String(st.shellCollapsed);
  const shellButton=$('.dg-shell-toggle');
  shellButton?.setAttribute('aria-expanded',String(!st.shellCollapsed));
  const shellCaret=shellButton?.querySelector('.dg-caret');if(shellCaret)shellCaret.textContent=st.shellCollapsed?'›':'⌄';
  const shellBody=$('.dg-body');if(shellBody){shellBody.setAttribute('aria-hidden',String(st.shellCollapsed));if(st.shellCollapsed)shellBody.setAttribute('inert','');else shellBody.removeAttribute('inert')}
  const toolsPanel=$('.dg-tools-panel');if(toolsPanel){toolsPanel.hidden=st.toolsCollapsed;toolsPanel.setAttribute('aria-hidden',String(st.toolsCollapsed));if(st.toolsCollapsed)toolsPanel.setAttribute('inert','');else toolsPanel.removeAttribute('inert')}
  const toolsButton=$('.dg-tools-summary-toggle');
  toolsButton?.setAttribute('aria-expanded',String(!st.toolsCollapsed));
  const activeSummary=$('.dg-tools-active')?.textContent?.trim()||'لا توجد فلاتر نشطة';
  const viewSummary=$('.dg-tools-view')?.textContent?.trim()||`العرض: ${st.activeView||'الافتراضي'}`;
  toolsButton?.setAttribute('aria-label',`${st.toolsCollapsed?'فتح':'طي'} عوامل التصفية والتخصيص؛ ${activeSummary}؛ ${viewSummary}`);
  const filterButton=$('.dg-filter-toggle');
  const nFilt=activeFilterCount();
  if(filterButton){filterButton.setAttribute('aria-expanded',String(!st.filterCollapsed));filterButton.setAttribute('aria-label',`${st.filterCollapsed?'فتح':'طي'} عوامل التصفية؛ ${nFilt?`${fmtN(nFilt)} فلاتر نشطة`:'لا توجد فلاتر نشطة'}`);filterButton.textContent=`${st.filterCollapsed?'›':'⌄'} عوامل التصفية${nFilt?` (${fmtN(nFilt)} نشطة)`:''}`}
  const toolsCaret=$('.dg-tools-caret');if(toolsCaret)toolsCaret.textContent=st.toolsCollapsed?'›':'⌄';
  syncCollapsePin($('.dg-shell-pin'),shellCollapseKey);
  syncCollapsePin($('.dg-tools-pin'),toolsCollapseKey);
  syncCollapsePin($('.dg-filter-pin'),filterCollapseKey);
 }
 function menuItems(row){try{const items=(typeof o.rowMenu==='function'?o.rowMenu(row):o.rowMenu)||[];return Array.isArray(items)?items:[];}catch{return []}}
 function compute(){
  hl=highlighters(st.quick||o.highlightText);vStart=-1;
  const query=makeQuery();
  // Array-backed feature grids use the same query engine locally; database-backed
  // grids have already applied the query while streaming a single cursor page.
  view=remote?(st.groupBy?sortGridRows(rows,query.sort,cols,[st.groupBy]):[...rows]):applyGridQuery(rows,query,cols);
 }
 function columnWidth(c,widths=st.widths){return Math.max(c.minWidth,Math.min(c.maxWidth,Number(widths?.[c.key])||c.width||c.minWidth))}
 function renderHead(){
  const sortMark=k=>{const i=st.sort.findIndex(s=>s.key===k);if(i<0)return '<span class="dg-sortidle" aria-hidden="true">↕</span>';return `<span class="dg-sortmark">${st.sort[i].dir==='asc'?'▲':'▼'}<b class="dg-rank">${i+1}</b></span>`};
  const vc=visibleCols();
  const selTh=o.selectable?`<th class="dg-sel-th"><input type="checkbox" class="dg-sel-all" aria-label="تحديد كل النتائج الحالية"${allSelected()?' checked':''}${view.length?'':' disabled'}></th>`:'';
  const qaTh=showQa()?'<th class="dg-qa-th" aria-label="إجراءات"></th>':'';
  $('thead').innerHTML=`<tr class="dg-hrow">${selTh}${vc.map(c=>{const w=columnWidth(c);const pin=c.pinnable&&st.pinned.includes(c.key);
   const title=c.filterable?`<button type="button" class="dg-coltitle" title="تصفية عمود ${esc(c.label)}">${esc(c.label)}${pin?'<span class="dg-pinmark" title="مثبّت">📌</span>':''}</button>`:`<span class="dg-coltitle">${esc(c.label)}${pin?'<span class="dg-pinmark" title="مثبّت">📌</span>':''}</span>`;
   return `<th data-key="${esc(c.key)}" style="width:${w}px;min-width:${w}px;max-width:${c.maxWidth}px" class="${st.filters.has(c.key)?'dg-filtered':''}${pin?' dg-pin-th':''}"><div class="dg-th">${title}${c.sortable?`<button type="button" class="dg-sort" title="فرز: تصاعدي ثم تنازلي ثم إلغاء. Shift للفرز المتعدد" aria-label="فرز ${esc(c.label)}">${sortMark(c.key)}</button>`:''}${c.filterable?`<button type="button" class="dg-fbtn" aria-label="تصفية ${esc(c.label)}" title="تصفية العمود">▾</button>`:''}</div>${c.resizable===false?'':`<span class="dg-resizer" role="separator" tabindex="0" aria-label="تغيير عرض ${esc(c.label)}"></span>`}</th>`}).join('')}${qaTh}</tr>
   ${st.colSearchOn?`<tr class="dg-csrow">${o.selectable?'<th class="dg-sel-th"></th>':''}${vc.map(c=>`<th data-cs="${esc(c.key)}">${c.searchable?`<input type="search" class="dg-cs" data-key="${esc(c.key)}" value="${esc(st.colSearch[c.key]||'')}" placeholder="بحث…" aria-label="بحث في ${esc(c.label)}">`:''}</th>`).join('')}${showQa()?'<th></th>':''}</tr>`:''}`;
  const all=$('.dg-sel-all');
  if(all){all.indeterminate=view.some(isRowSelected)&&!allSelected()}
  layoutPins();
 }
 function cellHtml(c,r){
  const t=c.text(r),items=c.items?c.items(r).map(item=>typeof item==='object'?item:{text:String(item)}).filter(item=>item.text):null;
  const marked=text=>hl?markHtml(text,hl):esc(text);
  let content=marked(t);
  if(items){
   const shown=items.slice(0,c.compactLimit),remaining=items.length-shown.length;
   const details=remaining>0||items.some(item=>item.detail);
   const width=columnWidth(c);
   content=`<span class="dg-cell-list" style="max-width:min(100%,${Math.max(1,width-20)}px)"><span class="dg-cell-entries">${shown.map(item=>`<span class="dg-cell-item">${marked(item.text)}</span>`).join('')}</span><span class="dg-cell-list-foot">${details?`<button type="button" class="link dg-cell-more" data-column="${esc(c.key)}" aria-label="عرض التفاصيل الكاملة: ${esc(c.label)}">${remaining?`<bdi dir="ltr">+${remaining}</bdi>`:'التفاصيل'}</button>`:''}</span></span>`;
  }
  return `<td data-k="${esc(c.key)}" data-label="${esc(c.label)}"${!t?' data-empty="true"':''}${c.type==='number'?' class="num"':''} title="${esc(t)}">${content}</td>`;
 }
 const rowHtml=(r,i,vc)=>{
  const sel=o.selectable&&isRowSelected(r);
  const qa=showQa()?`<td class="dg-qa" data-label="إجراءات"><button type="button" class="ghost small dg-qa-btn" data-i="${i}" aria-label="إجراءات سريعة">⋯</button></td>`:'';
  return `<tr data-i="${i}" tabindex="0" class="${o.onRowClick?'dg-click':''}${st.sel===i?' dg-selected':''}${sel?' dg-checked':''}">${o.selectable?`<td class="dg-sel-td"><input type="checkbox" class="dg-rowchk" data-i="${i}" aria-label="تحديد الصف"${sel?' checked':''}></td>`:''}${vc.map(c=>cellHtml(c,r)).join('')}${qa}</tr>`;
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
  const h=rowH||36;
  const top=Number(sc.scrollTop)||0;
  const vh=Number(sc.clientHeight)||Number(sc.offsetHeight)||600;
  const start=Math.max(0,Math.floor(top/h)-15);
  if(!force&&start===vStart)return;vStart=start;
  const end=Math.min(view.length,start+Math.ceil(vh/h)+30);
  let html=`<tr class="dg-vpad" aria-hidden="true"><td colspan="${vc.length+extraCols()}" style="height:${start*h}px"></td></tr>`;
  for(let i=start;i<end;i++)html+=rowHtml(view[i],i,vc);
  html+=`<tr class="dg-vpad" aria-hidden="true"><td colspan="${vc.length+extraCols()}" style="height:${(view.length-end)*h}px"></td></tr>`;
  $('tbody').innerHTML=html;
  if(!rowH){const tr=$('tbody tr[data-i]');if(tr&&tr.offsetHeight){rowH=tr.offsetHeight;vStart=-1;renderWindow(true)}}
  layoutPins();
 }
 function renderBody(){
  const vc=visibleCols();
  const colSpan=vc.length+extraCols();
  const shown=remote?view:view.slice(0,st.shown);
  const g=st.groupBy&&byKey.get(st.groupBy);
  let html='',last=null;
  const counts=g?view.reduce((m,r)=>{const k=g.text(r)||EMPTY;m.set(k,(m.get(k)||0)+1);return m},new Map()):null;
  shown.forEach((r,i)=>{
   if(g){const k=g.text(r)||EMPTY;if(k!==last){html+=`<tr class="dg-grouprow${collapsed.has(k)?' dg-collapsed':''}" data-g="${esc(k)}" tabindex="0" title="اضغط للطي / الفتح"><th colspan="${colSpan}"><span class="dg-gcaret">${collapsed.has(k)?'◂':'▾'}</span> ${esc(g.label)}: ${esc(k)} <small>(${fmtN(counts.get(k))})</small></th></tr>`;last=k}if(collapsed.has(k))return}
   html+=rowHtml(r,i,vc);
  });
  if(!view.length){
   const hasQuery=Boolean(st.quick||st.filters.size||st.adv.rules.length||Object.values(st.colSearch).some(Boolean));
   const message=hasQuery?'لا توجد نتائج تطابق البحث أو عوامل التصفية.':o.emptyText;
   html=`<tr><td colspan="${Math.max(1,colSpan)}" class="dg-empty">${esc(message)}</td></tr>`;
  }
  if(view.length&&virtualOn())renderWindow(true);else{$('tbody').innerHTML=html;layoutPins()}
  const countText=remote
   ?(providerMeta.totalExact&&providerMeta.total!==null?`${fmtN(providerMeta.total)} نتيجة`:`${fmtN(view.length)} في هذه الصفحة${providerMeta.hasMore?' · توجد صفحات أخرى':''}`)
   :(view.length===rows.length&&!o.more?`${fmtN(rows.length)} نتيجة`:`${fmtN(view.length)} نتيجة من أصل ${fmtN(rows.length)}${o.more?'+':''}`);
  $('.dg-count').textContent=countText;
  const nFilt=activeFilterCount();updateCollapseSummary(nFilt);
  $('.dg-filter-toggle').textContent=`${st.filterCollapsed?'›':'⌄'} عوامل التصفية${nFilt?` (${fmtN(nFilt)} نشطة)`:''}`;
  const rest=virtualOn()?0:view.length-shown.length;
  $('.dg-more').innerHTML=!remote&&rest>0?`<button type="button" class="ghost dg-showmore">عرض ${Math.min(rest,o.pageSize)} صف إضافي (متبقٍ ${rest})</button>`:'';
  $('.dg-clear').hidden=!(st.filters.size||st.adv.rules.length||st.quick||st.sort.length||Object.values(st.colSearch).some(Boolean));
  renderChips();renderFoot(vc);
  renderSelbar();
  root.classList.toggle('dg-cards',st.cards);
  ['compact','normal','comfortable','mobile'].forEach(d=>root.classList.toggle('dg-d-'+d,st.density===d));$('.dg-density').value=st.density;
  applyChrome();
  ['small','medium','large'].forEach(d=>root.classList.toggle('dg-font-'+d,st.fontSize===d));$('.dg-font').value=st.fontSize;
  $('.dg-views-btn').classList.toggle('dg-chip-active',Boolean(st.activeView));
  $('.dg-cards-btn').textContent=st.cards?'جدول':'بطاقات';
  $('.dg-filter-toggle').setAttribute('aria-expanded',String(!st.filterCollapsed));
  $('.dg-fullscreen').setAttribute('aria-pressed',String(root.classList.contains('dg-fullscreen')));$('.dg-fullscreen').textContent=root.classList.contains('dg-fullscreen')?'⛶ خروج من الشاشة':'⛶ ملء الشاشة';
  const state=$('.dg-state');
  if(remote&&providerMeta.loading){state.hidden=false;state.className='dg-state is-loading';state.textContent='جارٍ تحميل صفحة البيانات…';}
  else if(remote&&providerMeta.error){
   const offline=typeof navigator!=='undefined'&&navigator.onLine===false;
   state.hidden=false;state.className=`dg-state ${offline?'is-offline':'is-error'}`;
   state.innerHTML=`<span>${offline?'أنت غير متصل. تُقرأ البيانات محليًا لكن تعذّر إكمال هذا الاستعلام.':`تعذّر تحميل البيانات: ${esc(providerMeta.error)}`}</span><button type="button" class="ghost small dg-retry">إعادة المحاولة</button>`;
  }else{state.hidden=true;state.className='dg-state';state.textContent=''}
  const pagebar=$('.dg-pagebar');pagebar.hidden=!remote;
  if(remote){
   $('.dg-page-prev').disabled=pageIndex<=0||providerMeta.loading;
   $('.dg-page-next').disabled=!providerMeta.hasMore||!providerMeta.nextCursor||providerMeta.loading;
   $('.dg-page-label').textContent=providerMeta.totalExact&&providerMeta.total!==null?`صفحة ${fmtN(pageIndex+1)} · ${fmtN(providerMeta.total)} نتيجة`:`صفحة ${fmtN(pageIndex+1)}`;
   $('.dg-page-size').value=String(st.remotePageSize);
   const sortStatus=providerMeta.sortStatus;
   const providerNotes=['الطباعة والتصدير العاديان للصفحة الحالية فقط.'];
   if(o.selectable)providerNotes.push('أوامر المحدد تشمل الصفوف المحددة عبر الصفحات.');
   if(sortStatus?.global===false)providerNotes.push('الفرز الكامل غير متاح لهذا العمود؛ يلزم فهرس مناسب.');
   if(st.groupBy)providerNotes.push('التجميع وأعداده للصفحة الحالية فقط.');
   if(o.aggregatePageOnly&&(cols.some(column=>column.aggregate)||o.aggregations?.length))providerNotes.push('الإجماليات المعلنة تخص الصفحة الحالية فقط.');
   $('.dg-provider-note').textContent=providerNotes.join(' ');
   $('.dg-export').title='تصدير صفوف الصفحة الحالية فقط';$('.dg-print').title='طباعة صفوف الصفحة الحالية فقط';
   $('.dg-foot-count').textContent=providerMeta.totalExact&&providerMeta.total!==null
    ?`إجمالي النتائج: ${fmtN(providerMeta.total)}`
    :`يعرض ${fmtN(view.length)} سجلًا في الصفحة الحالية${providerMeta.hasMore?' — توجد صفحات أخرى':''}`;
  }else{
   $('.dg-provider-note').textContent='';
   $('.dg-foot-count').textContent=view.length?`عدد الصفوف المعروضة: ${fmtN(view.length)}`:'';
  }
 }
 function renderSelbar(){
  const sb=$('.dg-selbar');const cnt=st.selected.size;
  sb.hidden=!(o.selectable&&cnt);
  if(cnt){sb.querySelector('.dg-sel-count').textContent=`تم تحديد ${fmtN(cnt)} صف — الإجراءات على الصفوف المحددة`}
  const slot=sb.querySelector('.dg-bulk-slot');
  // «فتح المحدد» إجراء مدمج واحد في الجدول الموحّد (زر .dg-open-sel الثابت في شريط التحديد).
  // أي إجراء جماعي قادم من الصفحة بنفس المعرف open يُستبعد هنا من مصدره المركزي حتى
  // لا يظهر زران مكرران بنفس الوظيفة في أي جدول (كان سبب التكرار: الزر المدمج + bulkActions معًا).
  if(slot)slot.innerHTML=(o.bulkActions||[]).filter(a=>a&&a.id!=='open').map(a=>`<button type="button" class="ghost small dg-bulk${a.danger?' danger':''}" data-bulk="${esc(a.id)}">${esc(a.label)}</button>`).join('');
 }
 function renderChips(){
  const chips=[];
  if(st.quick)chips.push(['q','',`بحث: «${st.quick}»`]);
  const csCount=Object.values(st.colSearch).filter(Boolean).length;
  if(csCount)chips.push(['c','',`بحث الأعمدة (${csCount})`]);
  for(const [k,f] of st.filters){const c=byKey.get(k);if(!c)continue;let t;const value=(v,reference)=>v===EMPTY?EMPTY:reference?c.referenceLabel?.(v)||v:v;
   if(f.set)t=[...f.set].slice(0,3).map(v=>value(v,f.setValueType==='reference'||f.valueType==='reference')).join('، ')+(f.set.size>3?` +${f.set.size-3}`:'');
   else{const op=(OPS[c.type]||OPS.text).find(x=>x[0]===f.op)?.[1]||f.op;t=`${op} ${value(f.v1||'',f.valueType==='reference')}${f.v2?' – '+f.v2:''}`}
   chips.push(['f',k,`${c.label}: ${t}`]);
  }
  const rules=st.adv.rules.filter(x=>byKey.get(x.key));if(rules.length)chips.push(['a','',`تصفية مركّبة (${rules.length} ${st.adv.logic==='or'?'أيٌّ منها':'كلها'})`]);
  st.sort.forEach((x,i)=>{const c=byKey.get(x.key);if(c)chips.push(['s',x.key,`فرز ${i+1}: ${c.label} ${x.dir==='asc'?'▲':'▼'}`])});
  const el=$('.dg-chips');el.hidden=!chips.length;
  el.innerHTML=chips.map(([t,k,l])=>`<span class="dg-fchip dg-fchip-${t}"><span>${esc(l)}</span><button type="button" data-rm="${t}" data-k="${esc(k)}" aria-label="إزالة ${esc(l)}">✕</button></span>`).join('')+(chips.length>1?'<button type="button" class="link dg-chips-clear">مسح الكل</button>':'');
 }
 function renderFoot(vc){
  if(remote&&!o.aggregatePageOnly){$('tfoot').innerHTML='';return}
  const aggregates=new Map();
  for(const column of vc){
   const config=column.aggregate;
   if(config){const operation=typeof config==='string'?config:config?.operation||config?.type;if(operation)aggregates.set(column.key,operation)}
  }
  for(const aggregate of (Array.isArray(o.aggregations)?o.aggregations:[])){
   if(aggregate?.key&&aggregate?.operation)aggregates.set(aggregate.key,aggregate.operation);
  }
  if(!aggregates.size||!view.length||st.cards){$('tfoot').innerHTML='';return}
  const fmt=value=>Number.isInteger(value)?value.toLocaleString('ar-EG'):value.toLocaleString('ar-EG',{maximumFractionDigits:2});
  $('tfoot').innerHTML=`<tr class="dg-total">${o.selectable?'<td></td>':''}${vc.map((column,index)=>{
   const operation=aggregates.get(column.key);
   if(!operation)return `<td>${index===0?`ملخص ${fmtN(view.length)} صف` :''}</td>`;
   if(operation==='count')return `<td class="num">${fmt(view.filter(row=>!['',null,undefined].includes(column.get(row))).length)}</td>`;
   if(!['sum','average','avg'].includes(operation)||column.type!=='number')return '<td>—</td>';
   const values=view.map(row=>Number(column.get(row))).filter(Number.isFinite);
   const value=operation==='sum'?values.reduce((sum,item)=>sum+item,0):(values.length?values.reduce((sum,item)=>sum+item,0)/values.length:0);
   return `<td class="num" title="${operation==='sum'?'مجموع معلن صراحة':'متوسط معلن صراحة'}">${fmt(value)}</td>`;
  }).join('')}</tr>`;
 }
 function render(){compute();renderHead();renderBody()}

 // ===== أحداث =====
 let qt=0;
 $('.dg-quick').addEventListener('input',()=>{const el=$('.dg-quick');clearTimeout(qt);qt=setTimeout(()=>{if(!root.isConnected||!el)return;st.quick=el.value;st.shown=o.pageSize;changeQuery()},120)});
 $('.dg-groupby').addEventListener('change',e=>{st.groupBy=e.target.value;collapsed.clear();changeQuery()});
 $('.dg-page-prev').addEventListener('click',()=>{if(!remote||pageIndex<=0)return;pageIndex--;loadProviderRows()});
 $('.dg-page-next').addEventListener('click',()=>{if(!remote||!providerMeta.hasMore||!providerMeta.nextCursor)return;pageCursors[pageIndex+1]=providerMeta.nextCursor;pageIndex++;loadProviderRows()});
 $('.dg-page-size').addEventListener('change',e=>{const size=Number(e.target.value);if(![25,50,100].includes(size))return;st.remotePageSize=size;changeQuery()});
 $('.dg-state').addEventListener('click',e=>{if(e.target.closest('.dg-retry'))loadProviderRows()});
 $('.dg-filter-toggle').addEventListener('click',()=>{st.filterCollapsed=!st.filterCollapsed;if(st.filterCollapsed)closePop();saveCollapseState(filterCollapseKey,st.filterCollapsed);persist();applyChrome()});
 $('.dg-filter-close')?.addEventListener('click',()=>{st.filterCollapsed=true;closePop();saveCollapseState(filterCollapseKey,true);persist();applyChrome()});
 $('.dg-filter-apply')?.addEventListener('click',()=>{st.shown=o.pageSize;changeQuery();toast('تم تطبيق التصفية')});
 $('.dg-save-filter')?.addEventListener('click',()=>$('.dg-views-btn')?.click());
 $('.dg-unsort')?.addEventListener('click',()=>{st.sort=[];st.activeView='';changeQuery()});
 $('.dg-scope')?.addEventListener('change',e=>{st.searchCol=e.target.value;st.shown=o.pageSize;changeQuery()});
 $('.dg-span')?.addEventListener('change',e=>{st.span=e.target.value;persist();applyChrome()});
 $('.dg-width')?.addEventListener('input',e=>{st.tableWidth=Number(e.target.value)||100;applyChrome()});
 $('.dg-width')?.addEventListener('change',()=>persist());
 $('.dg-shell-toggle')?.addEventListener('click',()=>{st.shellCollapsed=!st.shellCollapsed;if(st.shellCollapsed)closePop();saveCollapseState(shellCollapseKey,st.shellCollapsed);persist();applyChrome()});
 $('.dg-tools-summary-toggle')?.addEventListener('click',()=>{st.toolsCollapsed=!st.toolsCollapsed;if(st.toolsCollapsed)closePop();saveCollapseState(toolsCollapseKey,st.toolsCollapsed);persist();applyChrome()});
 bindCollapsePin($('.dg-shell-pin'),shellCollapseKey,()=>st.shellCollapsed);
 bindCollapsePin($('.dg-tools-pin'),toolsCollapseKey,()=>st.toolsCollapsed);
 bindCollapsePin($('.dg-filter-pin'),filterCollapseKey,()=>st.filterCollapsed);
 root.addEventListener('collapse:bulk',event=>{
  const detail=event.detail||{};const next=Boolean(detail.collapsed);const save=detail.persist!==false;
  if(next&&(detail.target==='tools'||detail.target==='filters'||detail.target==='section'||detail.target==='all'))closePop();
  if(detail.target==='tools'||detail.target==='all'){st.toolsCollapsed=next;if(save)saveCollapseState(toolsCollapseKey,next)}
  if(detail.target==='filters'||detail.target==='all'){st.filterCollapsed=next;if(save)saveCollapseState(filterCollapseKey,next)}
  if(detail.target==='section'||detail.target==='all'){st.shellCollapsed=next;if(save)saveCollapseState(shellCollapseKey,next)}
  if(save)persist();applyChrome();
 });
 root.addEventListener('collapse:reset',()=>{
  clearCollapseState(shellCollapseKey);clearCollapseState(toolsCollapseKey);clearCollapseState(filterCollapseKey);
  st.shellCollapsed=resolveCollapseState(shellCollapseKey,{fallback:false,primary:true});
  st.toolsCollapsed=resolveCollapseState(toolsCollapseKey,{fallback:true});
  st.filterCollapsed=resolveCollapseState(filterCollapseKey,{fallback:true});
  applyChrome();
 });
 $('.dg-font').addEventListener('change',e=>{st.fontSize=e.target.value;persist();renderBody()});
 $('.dg-fullscreen').addEventListener('click',async()=>{if(document.fullscreenElement===root){try{await document.exitFullscreen()}catch{}root.classList.remove('dg-fullscreen')}else if(root.requestFullscreen){try{await root.requestFullscreen()}catch{root.classList.toggle('dg-fullscreen')}}else root.classList.toggle('dg-fullscreen');renderBody()});
 root.addEventListener('fullscreenchange',()=>{root.classList.toggle('dg-fullscreen',document.fullscreenElement===root);renderBody()});
 $('thead').addEventListener('pointerdown',e=>{const handle=e.target.closest('.dg-resizer');if(!handle)return;e.preventDefault();const th=handle.closest('th'),key=th?.dataset.key;if(!key)return;const startX=e.clientX,startW=th.getBoundingClientRect().width,rtl=(root.closest('[dir]')?.dir||document.documentElement.dir)==='rtl';let w=startW;const move=ev=>{w=Math.max(byKey.get(key).minWidth,Math.min(byKey.get(key).maxWidth,startW+(rtl?startX-ev.clientX:ev.clientX-startX)));th.style.width=w+'px';th.style.minWidth=w+'px';th.style.maxWidth=w+'px'};const end=()=>{document.removeEventListener('pointermove',move,true);document.removeEventListener('pointerup',end,true);document.removeEventListener('pointercancel',end,true);st.widths[key]=Math.round(w);persist();renderBody()};document.addEventListener('pointermove',move,true);document.addEventListener('pointerup',end,true);document.addEventListener('pointercancel',end,true)});
 $('thead').addEventListener('keydown',e=>{const handle=e.target.closest('.dg-resizer');if(!handle||!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();const th=handle.closest('th'),key=th.dataset.key,rtl=(root.closest('[dir]')?.dir||document.documentElement.dir)==='rtl',delta=(e.key==='ArrowRight'?1:-1)*(rtl?-1:1)*12,w=Math.max(byKey.get(key).minWidth,Math.min(byKey.get(key).maxWidth,(Number(st.widths[key])||th.getBoundingClientRect().width)+delta));st.widths[key]=w;persist();renderHead();[...$('thead').querySelectorAll('th')].find(x=>x.dataset.key===key)?.querySelector('.dg-resizer')?.focus()});
 $('.dg-clear').addEventListener('click',()=>{st.filters.clear();st.adv.rules=[];st.quick='';st.sort=[];st.colSearch={};st.activeView='';$('.dg-quick').value='';renderAdv();changeQuery()});
 $('.dg-chips').addEventListener('click',e=>{
  if(e.target.closest('.dg-chips-clear')){$('.dg-clear').click();return}
  const b=e.target.closest('[data-rm]');if(!b)return;const t=b.dataset.rm,k=b.dataset.k;
  if(t==='q'){st.quick='';$('.dg-quick').value=''}else if(t==='c'){st.colSearch={};renderHead()}else if(t==='f')st.filters.delete(k);else if(t==='a'){st.adv.rules=[];renderAdv()}else if(t==='s'){st.sort=st.sort.filter(x=>x.key!==k)}
  st.activeView='';changeQuery();
 });

 const toggleGroup=tr=>{const k=tr.dataset.g;collapsed.has(k)?collapsed.delete(k):collapsed.add(k);renderBody()};
 $('tbody').addEventListener('click',e=>{const tr=e.target.closest('.dg-grouprow');if(tr){e.stopPropagation();toggleGroup(tr)}},true);
 $('tbody').addEventListener('keydown',e=>{const tr=e.target.closest?.('.dg-grouprow');if(tr&&(e.key==='Enter'||e.key===' ')){e.preventDefault();toggleGroup(tr)}});
 root.addEventListener('keydown',e=>{if(e.key==='/'&&!/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)){e.preventDefault();$('.dg-quick').focus()}});
 $('.dg-cards-btn').addEventListener('click',()=>{st.cards=!st.cards;persist();renderBody()});
 $('.dg-density').addEventListener('change',e=>{st.density=e.target.value;rowH=0;persist();renderBody()});
 // ===== 🎨 تخصيص مظهر الجدول — popover داخل Universal DataGrid (البند: إعدادات الجدول تبقى ضمن الجدول) =====
 $('.dg-head-gear')?.addEventListener('click',e=>{
  closePop();pop=document.createElement('div');pop.className='dg-pop dg-appear-pop';pop.setAttribute('role','dialog');pop.setAttribute('aria-label','تخصيص مظهر الجدول');
  const ctl=(key,label,inner)=>`<div class="uxc-ctl" data-ap="${key}"><span class="uxc-ctl-lbl">${label}</span><div class="uxc-ctl-in">${inner}<button type="button" class="link uxc-clear" data-apc="${key}" title="إعادة هذه القيمة للوضع الافتراضي" aria-label="إعادة ${label} للافتراضي" hidden>↺</button></div></div>`;
  const rng=(key,label,min,max,step,val)=>ctl(key,label,`<input type="range" data-apr="${key}" min="${min}" max="${max}" step="${step}" value="${val??min}" aria-label="${label}"><output data-apo>${val!=null?val+'px':'—'}</output>`);
  const clr=(key,label,val)=>ctl(key,label,`<input type="color" data-apcolor="${key}" value="${val||'#d4af37'}" aria-label="${label}"><input type="text" class="uxc-hex" data-aphex="${key}" value="${val||''}" placeholder="افتراضي" maxlength="7" dir="ltr" spellcheck="false" aria-label="${label} — hex">`);
  pop.innerHTML=`<div class="dg-pop-head"><b>🎨 مظهر الجدول — إعدادات هذا الجدول وحده</b><button type="button" class="link dg-x" aria-label="إغلاق">✕</button></div>
   <div class="dg-appear">
    ${rng('fontPx','حجم خط الخلايا',10,20,.5,st.appear.fontPx)}
    ${rng('rowPad','ارتفاع الصف (حشو)',2,18,1,st.appear.rowPad)}
    ${clr('headBg','خلفية رأس الجدول',st.appear.headBg)}
    ${clr('headColor','لون نص الرأس',st.appear.headColor)}
    ${clr('textColor','لون نص الخلايا',st.appear.textColor)}
    ${clr('rowBg','لون خلفية الصفوف',st.appear.rowBg)}
    ${clr('borderColor','لون حدود الجدول',st.appear.borderColor)}
   </div>
   <p class="muted small">تُحفظ القيم ضمن إعدادات هذا الجدول المحفوظة لديه — الجداول الأخرى لا تتغير، ولا تُعاد قراءة أي بيانات. الحجم/الكثافة/الأعمدة/الفرز/التصفية/طرق العرض تبقى في أدوات الجدول نفسها.</p>
   <div class="dg-pop-actions"><button type="button" class="ghost dg-appear-reset">↺ إعادة مظهر الجدول</button></div>`;
  place(pop,e.currentTarget);
  const drawValues=()=>{
   pop.querySelectorAll('[data-ap]').forEach(row=>{
    const k=row.dataset.ap,v=st.appear[k];
    const r=row.querySelector('[data-apr]');if(r){if(v!=null)r.value=String(v);const ot=row.querySelector('[data-apo]');if(ot)ot.textContent=v!=null?v+'px':'—'}
    const c=row.querySelector('[data-apcolor]');if(c)c.value=v||'#d4af37';
    const h=row.querySelector('[data-aphex]');if(h)h.value=v||'';
    const cb=row.querySelector('[data-apc]');if(cb)cb.hidden=v==null||v==='';
   });
  };
  const setKey=(key,value)=>{
   if(value===null||value===undefined||value==='')delete st.appear[key];else st.appear[key]=value;
   persist();applyAppear();
   if(key==='rowPad'||key==='fontPx'){rowH=0;if(virtualOn())renderBody()}
   drawValues();
  };
  pop.querySelector('.dg-x').onclick=closePop;
  armPopGuard();
  pop.querySelector('.dg-appear-reset').onclick=()=>{st.appear={};persist();applyAppear();rowH=0;renderBody();drawValues();toast('أُعيد مظهر هذا الجدول إلى الافتراضي — إعدادات الأعمدة والفلاتر كما هي')};
  pop.addEventListener('input',ev=>{
   const r=ev.target.closest('[data-apr]');
   if(r){const ot=r.closest('[data-ap]')?.querySelector('[data-apo]');if(ot)ot.textContent=r.value+'px';clearTimeout(r._apt);const k=r.dataset.apr,v=Number(r.value);r._apt=setTimeout(()=>setKey(k,v),140);return}
   const c=ev.target.closest('[data-apcolor]');
   if(c){const h=c.closest('[data-ap]')?.querySelector('[data-aphex]');if(h)h.value=c.value;clearTimeout(c._apt);const k=c.dataset.apcolor,v=c.value;c._apt=setTimeout(()=>setKey(k,v),120);return}
   const h=ev.target.closest('[data-aphex]');
   if(h){const v=h.value.trim().toLowerCase();if(v===''||/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/.test(v)){clearTimeout(h._apt);const k=h.dataset.aphex;h._apt=setTimeout(()=>{setKey(k,v||null);const cc=pop.querySelector(`[data-apcolor="${k}"]`);if(cc&&v)cc.value=v},250)}}
  });
  pop.addEventListener('change',ev=>{
   const r=ev.target.closest('[data-apr]');if(r){clearTimeout(r._apt);setKey(r.dataset.apr,Number(r.value));return}
   const c=ev.target.closest('[data-apcolor]');if(c){clearTimeout(c._apt);setKey(c.dataset.apcolor,c.value)}
  });
  pop.addEventListener('click',ev=>{
   const cb=ev.target.closest('[data-apc]');
   if(cb)setKey(cb.dataset.apc,null);
  });
  drawValues();
 });
 let raf=0;$('.dg-scroll').addEventListener('scroll',()=>{if(!virtualOn()||raf)return;raf=requestAnimationFrame(()=>{raf=0;renderWindow(false)})},{passive:true});
 $('.dg-print').addEventListener('click',()=>printGrid());
 $('.dg-export').addEventListener('change',e=>{const v=e.target.value;e.target.value='';if(v)Promise.resolve(exportGrid(v)).catch(error=>toast(`تعذر التصدير: ${error?.message||''}`,'error'))});
 $('.dg-more').addEventListener('click',e=>{if(e.target.closest('.dg-showmore')){st.shown+=o.pageSize;renderBody()}});
 // بحث الأعمدة: تبديل الصف + إدخال مباشر بلا فقدان تركيز
 $('.dg-csearch-btn').addEventListener('click',()=>{st.colSearchOn=!st.colSearchOn;$('.dg-csearch-btn').classList.toggle('dg-chip-active',st.colSearchOn);$('.dg-csearch-btn').setAttribute('aria-pressed',String(st.colSearchOn));persist();render();if(st.colSearchOn)root.querySelector('.dg-cs')?.focus()});
 $('thead').addEventListener('input',e=>{const inp=e.target.closest('.dg-cs');if(!inp)return;const key=inp.dataset.key;clearTimeout(inp._t);inp._t=setTimeout(()=>{const v=inp.value.trim();if(v)st.colSearch[key]=v;else delete st.colSearch[key];st.shown=o.pageSize;changeQuery()},240)});
 // التحديد والإجراءات الجماعية (تصدير/طباعة المحدد فقط — لا إتلاف بيانات)
 $('thead').addEventListener('change',e=>{
  const all=e.target.closest('.dg-sel-all');if(!all)return;
  if(all.checked)view.forEach(r=>{const key=rowKey(r);st.selected.add(key);selectedRowsByKey.set(key,r)});else view.forEach(r=>{const key=rowKey(r);st.selected.delete(key);selectedRowsByKey.delete(key)});
  renderHead();renderBody();
 });
 $('tbody').addEventListener('change',e=>{
  const chk=e.target.closest('.dg-rowchk');if(!chk)return;
  const r=view[Number(chk.dataset.i)];if(!r)return;
  const key=rowKey(r);
  if(chk.checked){st.selected.add(key);selectedRowsByKey.set(key,r)}else{st.selected.delete(key);selectedRowsByKey.delete(key)}
  chk.closest('tr')?.classList.toggle('dg-checked',chk.checked);
  const all=$('.dg-sel-all');if(all){all.checked=allSelected();all.indeterminate=view.some(isRowSelected)&&!allSelected()}
  renderSelbar();
 });
 $('.dg-sel-clear').addEventListener('click',()=>{st.selected.clear();selectedRowsByKey.clear();renderHead();renderBody()});
 $('.dg-sel-export').addEventListener('click',()=>exportGrid('xls',selectedRows()));
 $('.dg-sel-csv').addEventListener('click',()=>exportGrid('csv',selectedRows()));
 $('.dg-sel-print').addEventListener('click',()=>printGrid(selectedRows()));
 // إعادة ضبط الجدول بالكامل (إعدادات العرض فقط — لا تمس أي بيانات)
 $('.dg-reset-btn').addEventListener('click',()=>{
  if(PK){prefs.remove(PK);try{localStorage.removeItem(PK)}catch{}}
  clearCollapseState(filterCollapseKey);clearCollapseState(toolsCollapseKey);clearCollapseState(shellCollapseKey);
  st.filterCollapsed=resolveCollapseState(filterCollapseKey,{fallback:true});
  st.toolsCollapsed=resolveCollapseState(toolsCollapseKey,{fallback:true});
  st.shellCollapsed=resolveCollapseState(shellCollapseKey,{fallback:false,primary:true});
  st.filters.clear();st.adv={logic:'and',rules:[]};st.quick='';st.sort=[];st.groupBy='';st.hidden=new Set(cols.filter(c=>c.hidden).map(c=>c.key));st.remotePageSize=25;
  const freshDisplay=resolveGridDisplay();
  order.splice(0,order.length,...cols.map(c=>c.key));st.widths={};st.fontSize=freshDisplay.fontSize||'medium';st.density=freshDisplay.density||'';st.cards=false;st.colSearch={};st.colSearchOn=false;st.pinned=[];st.views=[];st.activeView='';st.searchCol='';st.span='';st.tableWidth=100;st.qaOn=true;st.appear={};applyAppear();rowH=0;
  $('.dg-quick').value='';$('.dg-groupby').value='';$('.dg-font').value=st.fontSize;$('.dg-density').value=st.density;$('.dg-page-size').value='25';$('.dg-csearch-btn').classList.remove('dg-chip-active');if($('.dg-scope'))$('.dg-scope').value='';if($('.dg-span'))$('.dg-span').value='';if($('.dg-width'))$('.dg-width').value=100;
  renderAdv();changeQuery();toast('أُعيد ضبط الجدول إلى الإعدادات الافتراضية');
 });
 $('thead').addEventListener('click',e=>{
  const th=e.target.closest('th');if(!th)return;const key=th.dataset.key;if(!key)return;
  if(byKey.get(key)?.filterable&&(e.target.closest('.dg-fbtn')||e.target.closest('.dg-coltitle'))){openFilter(th,key);return}
  if(byKey.get(key)?.sortable&&e.target.closest('.dg-sort')){
   const i=st.sort.findIndex(s=>s.key===key);
   if(e.shiftKey){if(i<0)st.sort.push({key,dir:'asc'});else if(st.sort[i].dir==='asc')st.sort[i].dir='desc';else st.sort.splice(i,1)}
   else{const cur=i>=0?st.sort[i].dir:null;st.sort=cur==='asc'?[{key,dir:'desc'}]:cur==='desc'?[]:[{key,dir:'asc'}]}
   changeQuery();
  }
 });
 const selectRow=tr=>{st.sel=Number(tr.dataset.i);root.querySelectorAll('tr.dg-selected').forEach(x=>x.classList.remove('dg-selected'));tr.classList.add('dg-selected')};
 const clickRow=tr=>{selectRow(tr);const r=view[Number(tr.dataset.i)];if(r&&o.onRowClick)o.onRowClick(r)};
 $('tbody').addEventListener('click',e=>{const more=e.target.closest('.dg-cell-more');if(more){e.stopPropagation();const row=view[Number(more.closest('tr').dataset.i)],column=byKey.get(more.dataset.column);if(row&&column)openCellDetails(more,column,row);return}const qa=e.target.closest('.dg-qa-btn');if(qa){e.stopPropagation();const r=view[Number(qa.dataset.i)];if(r)openMenu(qa,r,qa.getBoundingClientRect().left,qa.getBoundingClientRect().bottom+4);return}const tr=e.target.closest('tr[data-i]');if(tr&&!e.target.closest('.dg-sel-td')&&!e.target.closest('.dg-qa'))clickRow(tr)});
 $('tbody').addEventListener('keydown',e=>{const tr=e.target.closest('tr[data-i]');if(!tr)return;
  if(e.key==='Enter'&&e.target!==tr){const inp=e.target.closest('input,button,a,select,textarea');if(inp)return}
  if(e.key==='Enter'){clickRow(tr)}
  else if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();let nx=e.key==='ArrowDown'?tr.nextElementSibling:tr.previousElementSibling;while(nx&&!nx.dataset.i)nx=e.key==='ArrowDown'?nx.nextElementSibling:nx.previousElementSibling;if(nx){selectRow(nx);nx.focus()}}
 });

 // ===== نافذة تصفية العمود =====
 let pop=null;
 const closePop=()=>{pop?.remove();pop=null;document.removeEventListener('mousedown',outside,true);disarmPopGuard()};
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
 function openCellDetails(anchor,column,row){
  closePop();pop=document.createElement('div');pop.className='dg-pop';pop.setAttribute('role','dialog');pop.setAttribute('aria-label',column.label);
  pop.innerHTML=`<div class="dg-pop-head"><b>${esc(column.label)}</b><button type="button" class="link dg-x" aria-label="إغلاق">✕</button></div><ul class="dg-cell-details">${column.items(row).map(item=>`<li><b>${esc(item.text)}</b>${item.detail?`<small>${esc(item.detail)}</small>`:''}</li>`).join('')}</ul>`;
  place(pop,anchor);pop.querySelector('.dg-x').onclick=()=>{closePop();anchor.focus()};
  armPopGuard();
  pop.addEventListener('keydown',event=>{if(event.key==='Escape'){closePop();anchor.focus()}});pop.querySelector('.dg-x').focus();
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
  const refFacet=Boolean(c.references);
  const distinct=new Map();
  for(const r of rows){
   const entries=refFacet?(c.references(r).length?c.references(r):[{id:EMPTY,label:EMPTY}]):[{id:c.text(r)||EMPTY,label:c.text(r)||EMPTY}];
   for(const entry of entries){const previous=distinct.get(entry.id);distinct.set(entry.id,{label:entry.label,count:(previous?.count||0)+1})}
  }
  if(f.valueType==='reference'&&f.op==='eq'&&f.v1&&!distinct.has(f.v1))distinct.set(f.v1,{label:c.referenceLabel?.(f.v1)||f.v1,count:0});
  const values=[...distinct.entries()].sort((a,b)=>a[1].label.localeCompare(b[1].label,'ar',{numeric:true})).slice(0,1000);
  const referenceChoice=refFacet?`<label class="dg-pop-cond">اختيار محدد بالهوية<select class="dg-ref-choice" aria-label="اختيار ${esc(c.label)} محدد"><option value="">بدون اختيار محدد</option>${values.filter(([id])=>id!==EMPTY).map(([id,entry])=>`<option value="${esc(id)}"${f.valueType==='reference'&&f.v1===id?' selected':''}>${esc(entry.label)}</option>`).join('')}</select></label>`:'';
  pop=document.createElement('div');pop.className='dg-pop';pop.setAttribute('role','dialog');pop.setAttribute('aria-label','تصفية '+c.label);
  const presets=type==='date'?`<div class="dg-presets" aria-label="فترات جاهزة">${[['today','اليوم'],['yesterday','أمس'],['thisWeek','هذا الأسبوع'],['thisMonth','هذا الشهر'],['thisYear','السنة الحالية']].map(([k,l])=>`<button type="button" class="chip" data-preset-op="${k}">${l}</button>`).join('')}</div>`:'';
  pop.innerHTML=`<div class="dg-pop-head"><b>${esc(c.label)}</b><button type="button" class="link dg-x" aria-label="إغلاق">✕</button></div>
   <div class="dg-pop-sort"><button type="button" class="ghost" data-dir="asc">فرز تصاعدي ▲</button><button type="button" class="ghost" data-dir="desc">فرز تنازلي ▼</button><button type="button" class="ghost" data-dir="none">بدون فرز</button><button type="button" class="ghost dg-pintoggle" title="يبقى العمود ظاهرًا أثناء التمرير الأفقي">${pinned?'📌 إلغاء التثبيت':'📌 تثبيت العمود'}</button></div>
   ${presets}
   ${referenceChoice}<label class="dg-pop-cond">شرط نصي<select class="dg-op">${OPS[type].map(([v,l])=>`<option value="${v}"${v===f.op?' selected':''}>${l}</option>`).join('')}</select></label><div class="dg-vals">${valueInputs(type,f.op,f.valueType==='reference'?'':f.v1,f.v2)}</div>
   ${remote?'<small class="dg-facet-note">القيم الظاهرة من الصفحة الحالية فقط؛ شرط التصفية يطبّق على نتائج الاستعلام كلها.</small>':''}
   <div class="dg-pop-list"><input type="search" class="dg-lsearch" placeholder="بحث في القيم…"><div class="dg-list-tools"><button type="button" class="link dg-checkall">تحديد الكل</button><button type="button" class="link dg-checknone">إلغاء الكل</button></div><label class="dg-all"><input type="checkbox" class="dg-allbox" ${!f.set?'checked':''}> تحديد الكل</label><div class="dg-checks">${values.map(([v,entry])=>`<label><input type="checkbox" value="${esc(v)}" ${!f.set||f.set.has(f.setValueType==='reference'||f.valueType==='reference'?v:entry.label)?'checked':''}> <span>${esc(entry.label)}</span> <small>${entry.count}</small></label>`).join('')}</div>${distinct.size>1000?'<small class="muted">تُعرض أول 1000 قيمة.</small>':''}</div>
   <div class="dg-pop-actions"><button type="button" class="primary dg-apply">تطبيق</button><button type="button" class="ghost dg-reset">مسح تصفية العمود</button></div>`;
  place(pop,th);
  const q=s=>pop.querySelector(s);
  q('.dg-x').onclick=closePop;
  armPopGuard();
  pop.querySelectorAll('[data-dir]').forEach(b=>b.onclick=()=>{if(b.dataset.dir==='none')st.sort=st.sort.filter(s=>s.key!==key);else st.sort=[{key,dir:b.dataset.dir}];closePop();changeQuery()});
  pop.querySelectorAll('[data-preset-op]').forEach(b=>b.onclick=()=>{st.filters.set(key,{op:b.dataset.presetOp,v1:'',v2:'',set:null});closePop();st.shown=o.pageSize;changeQuery()});
  q('.dg-checkall').onclick=()=>{pop.querySelectorAll('.dg-checks label:not([hidden]) input').forEach(i=>i.checked=true);q('.dg-allbox').checked=true};
  q('.dg-checknone').onclick=()=>{pop.querySelectorAll('.dg-checks input').forEach(i=>i.checked=false);q('.dg-allbox').checked=false};
  q('.dg-pintoggle').onclick=()=>{togglePin(key);closePop()};
  q('.dg-op').onchange=e=>{if(q('.dg-ref-choice'))q('.dg-ref-choice').value='';q('.dg-vals').innerHTML=valueInputs(type,e.target.value,q('.dg-v1')?.value||'',q('.dg-v2')?.value||'')};
  q('.dg-ref-choice')?.addEventListener('change',()=>{q('.dg-vals').innerHTML=valueInputs(type,'eq','','');q('.dg-op').value='eq'});
  q('.dg-vals').addEventListener('input',()=>{if(q('.dg-ref-choice'))q('.dg-ref-choice').value='' });
  q('.dg-lsearch').oninput=e=>{const s=n(e.target.value);pop.querySelectorAll('.dg-checks label').forEach(l=>l.hidden=Boolean(s)&&!n(l.textContent).includes(s))};
  q('.dg-allbox').onchange=e=>pop.querySelectorAll('.dg-checks label:not([hidden]) input').forEach(i=>i.checked=e.target.checked);
  q('.dg-reset').onclick=()=>{st.filters.delete(key);closePop();st.shown=o.pageSize;changeQuery()};
  q('.dg-apply').onclick=()=>{
   const identity=q('.dg-ref-choice')?.value;
   if(identity){st.filters.set(key,{op:'eq',v1:identity,v2:'',set:null,valueType:'reference'});closePop();st.shown=o.pageSize;changeQuery();return}
   const op=q('.dg-op').value,v1=q('.dg-v1')?.value??'',v2=q('.dg-v2')?.value??'';
   const boxes=[...pop.querySelectorAll('.dg-checks input')];const checked=boxes.filter(b=>b.checked).map(b=>b.value);
   const set=checked.length===boxes.length?null:new Set(checked);
   const hasCond=NOVAL.includes(op)||v1!==''||v2!=='';
   if(!set&&!hasCond)st.filters.delete(key);else st.filters.set(key,{op:hasCond?op:'',v1,v2,set,...(refFacet&&set?{setValueType:'reference'}:{})});
   closePop();st.shown=o.pageSize;changeQuery();
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
  pop.innerHTML=`<div class="dg-pop-head"><b>الأعمدة — إظهار وترتيب وتثبيت</b><button type="button" class="link dg-x">✕</button></div><small class="muted">اسحب العمود لتغيير ترتيبه، و📌 لتثبيته أثناء التمرير الأفقي (حتى ${MAX_PINS} أعمدة). يُحفظ كل شيء لهذا الجدول.</small><ul class="dg-cols-list">${listHtml()}</ul><div class="dg-pop-actions"><button type="button" class="ghost dg-allcols">إظهار الكل</button><button type="button" class="ghost dg-resetw">إعادة الحجم الافتراضي</button><button type="button" class="ghost dg-resetcols">الترتيب الافتراضي</button></div>`;
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
  pop.querySelector('.dg-resetw')?.addEventListener('click',()=>{st.widths={};refresh()});
 });
 // ===== طرق العرض المحفوظة (فلاتر + فرز + أعمدة باسم) =====
 const snapshot=()=>({quick:st.quick,filters:[...st.filters].map(([k,f])=>[k,{...f,set:f.set?[...f.set]:null}]),adv:JSON.parse(JSON.stringify(st.adv)),sort:[...st.sort],groupBy:st.groupBy,hidden:[...st.hidden],order:[...order],widths:{...st.widths},fontSize:st.fontSize,density:st.density,cards:st.cards,filterCollapsed:st.filterCollapsed,pinned:[...st.pinned],colSearch:{...st.colSearch},colSearchOn:st.colSearchOn,searchCol:st.searchCol,span:st.span,tableWidth:st.tableWidth,qaOn:st.qaOn,appear:{...st.appear}});
 function restore(v){
  st.quick=v.quick||'';$('.dg-quick').value=st.quick;
  st.filters=new Map((v.filters||[]).filter(([k])=>byKey.has(k)).map(([k,f])=>[k,{...f,set:f.set?new Set(f.set):null}]));
  st.adv=v.adv||{logic:'and',rules:[]};st.sort=(v.sort||[]).filter(x=>byKey.has(x.key));st.groupBy=byKey.has(v.groupBy)?v.groupBy:'';$('.dg-groupby').value=st.groupBy;
  if(v.hidden)st.hidden=new Set(v.hidden);
  if(v.order){const ord=v.order.filter(k=>byKey.has(k));cols.forEach(c=>{if(!ord.includes(c.key))ord.push(c.key)});order.splice(0,order.length,...ord)}
  st.widths={...(v.widths||st.widths)};st.fontSize=['small','medium','large'].includes(v.fontSize)?v.fontSize:st.fontSize;st.density=v.density||st.density;st.cards=v.cards===undefined?st.cards:Boolean(v.cards);st.filterCollapsed=Boolean(v.filterCollapsed);saveCollapseState(filterCollapseKey,st.filterCollapsed);syncCollapsePin($('.dg-filter-pin'),filterCollapseKey);root.classList.toggle('dg-filter-open',!st.filterCollapsed);
  st.pinned=(Array.isArray(v.pinned)?v.pinned:[]).filter(k=>byKey.has(k)).slice(0,MAX_PINS);st.colSearch=v.colSearch&&typeof v.colSearch==='object'?{...v.colSearch}:{};st.colSearchOn=Boolean(v.colSearchOn);
  st.searchCol=byKey.has(v.searchCol)?v.searchCol:'';st.span=['wide','full'].includes(v.span)?v.span:'';st.tableWidth=Math.max(100,Math.min(220,Number(v.tableWidth)||100));st.qaOn=v.qaOn!==false;
  if($('.dg-scope'))$('.dg-scope').value=st.searchCol;if($('.dg-span'))$('.dg-span').value=st.span;if($('.dg-width'))$('.dg-width').value=st.tableWidth;
  st.appear=sanitizeAppear(v.appear);applyAppear();rowH=0;
  st.shown=o.pageSize;renderAdv();$('.dg-adv').hidden=!st.adv.rules.length||st.filterCollapsed;changeQuery();
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
 $('.dg-adv-btn').addEventListener('click',()=>{const el=$('.dg-adv');el.hidden=!el.hidden;if(!el.hidden){st.filterCollapsed=false;saveCollapseState(filterCollapseKey,false);root.classList.add('dg-filter-open');if(!st.adv.rules.length)st.adv.rules.push({key:cols[0].key,op:OPS[cols[0].type||'text'][0][0],v1:'',v2:''});renderAdv()}persist();applyChrome()});
 $('.dg-adv').addEventListener('click',e=>{
  if(e.target.closest('.dg-radd')){readAdv();const c=visibleCols()[0]||cols[0];st.adv.rules.push({key:c.key,op:OPS[c.type||'text'][0][0],v1:'',v2:''});renderAdv()}
  else if(e.target.closest('.dg-rdel')){readAdv();st.adv.rules.splice(Number(e.target.closest('.dg-rule').dataset.i),1);renderAdv()}
  else if(e.target.closest('.dg-rapply')){readAdv();st.shown=o.pageSize;changeQuery()}
  else if(e.target.closest('.dg-rclear')){st.adv.rules=[];renderAdv();changeQuery()}
 });
 $('.dg-adv').addEventListener('change',e=>{
  if(e.target.matches('.dg-rkey')){readAdv();const r=st.adv.rules[Number(e.target.closest('.dg-rule').dataset.i)];r.op=OPS[byKey.get(r.key)?.type||'text'][0][0];r.v1='';r.v2='';renderAdv()}
  else if(e.target.matches('.dg-rop')){readAdv();renderAdv()}
 });

 // ===== الطباعة والتصدير =====
 const exportColumns=full=>visibleCols().filter(c=>full||!(c.sensitive||SENSITIVE.test(c.key)));
 function matrix(full=true,srcRows=null,columns=null){
  const src=srcRows===null?view:srcRows,vc=columns||exportColumns(full);
  return {head:vc.map(c=>c.label),body:src.map(r=>vc.map(c=>c.text(r)))};
 }
 function tableHtml(full=false,srcRows=null,columns=null,widths=null){
  const vc=columns||exportColumns(full),{head,body}=matrix(full,srcRows,vc);
  const totalWidth=vc.reduce((sum,c)=>sum+columnWidth(c,widths),0)||1;
  const colgroup=widths?`<colgroup>${vc.map(c=>`<col style="width:${(columnWidth(c,widths)/totalWidth*100).toFixed(2)}%">`).join('')}</colgroup>`:'';
  return `<table border="1" cellspacing="0" cellpadding="4" dir="rtl">${colgroup}<thead><tr>${head.map((h,i)=>`<th data-column="${esc(vc[i].key)}">${esc(h)}</th>`).join('')}</tr></thead><tbody>${body.map(r=>`<tr>${r.map(v=>`<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
 }
 function documentSnapshot(forPrint=false,full=false,srcRows=null){
  const snapshot={src:[...(srcRows===null?view:srcRows)],query:makeQuery(),columns:exportColumns(full),widths:{...st.widths},date:new Date(),selected:srcRows!==null,remote,tableTitle:o.title||'تقرير'};
  snapshot.contextInput=typeof o.printContext==='function'?o.printContext({query:snapshot.query,rows:snapshot.src,date:snapshot.date}):(o.printContext||{});
  return snapshot;
 }
 async function resolveDocumentContext(snapshot){
  const context=await snapshot.contextInput;
  const value=o.resolvePrintContext?await o.resolvePrintContext({context,query:snapshot.query,columns:cols,rows:snapshot.src,date:snapshot.date}):context;
  return createPrintContext(value,{tableTitle:snapshot.tableTitle,query:snapshot.query,columns:cols,date:snapshot.date});
 }
 function buildDocument(snapshot,context,{forPrint=false,autoPrint=false}={}){
  const vc=forPrint?printColumns(snapshot.columns,snapshot.src,context):snapshot.columns;
  const field=(label,value)=>value?`<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`:'';
  const clientNames=context.clients.map(client=>client.name).join('، ');
  const fields=field(context.clients.length>1?'الموكلون':'الموكل',clientNames)+field('رقم الملف / نوع الملف',context.legalFile?.label)+field('رقم الدعوى / القضية',context.caseNumber)+field('تاريخ الطباعة',context.dateLabel);
  const selection=snapshot.selected?` — الصفوف المحددة: ${snapshot.src.length}`:'';
  const pageNote=snapshot.remote?snapshot.selected?' — صفوف محددة عبر الصفحات؛ ليست كل النتائج':` — الصفحة الحالية: ${snapshot.query.pagination.page} (ليست جميع صفحات النتائج)`:'';
  const filters=context.filters.length?`<p class="dg-print-filters"><b>${snapshot.selected?'فلاتر العرض وقت الطباعة (لا تُطبق مجددًا على الصفوف المحددة):':'فلاتر العرض وقت الطباعة:'}</b> ${esc(context.filters.join(' — '))}</p>`:'';
  const officeName=APP_NAME.replace(/^⚖️\s*/, '');
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(context.tableTitle)}</title><style>
   body{font-family:"Noto Sans Arabic","Segoe UI",Tahoma,sans-serif;margin:18px;color:#111;font-size:12px}
   .dg-print-header{border-bottom:2px solid #26364b;padding-bottom:10px;margin-bottom:12px;break-inside:avoid}
   .dg-print-office{font-size:17px;font-weight:700;margin:0 0 8px;color:#26364b}h1{font-size:16px;margin:0 0 10px}
   .dg-print-context{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px 22px;margin:0 0 8px}
   .dg-print-context div{display:flex;gap:6px;align-items:baseline}.dg-print-context dt{font-weight:700;white-space:nowrap}.dg-print-context dd{margin:0;overflow-wrap:anywhere}
   p{margin:4px 0;line-height:1.6}.dg-print-meta,.dg-print-filters{font-size:11px;color:#444}
   table{border-collapse:collapse;width:100%;table-layout:fixed;font-size:11px;margin-top:10px}th{background:#eef1f5;font-weight:700}
   th,td{border:1px solid #999;padding:5px 6px;text-align:right;vertical-align:top;white-space:pre-line;overflow-wrap:anywhere}
   thead{display:table-header-group}tbody{display:table-row-group}tr{break-inside:avoid;page-break-inside:avoid}
   ${forPrint?'@page{size:A4 landscape;margin:10mm}':''}
  </style></head><body><header class="dg-print-header"><p class="dg-print-office">${esc(officeName)}</p><h1>${esc(context.tableTitle)}</h1><dl class="dg-print-context">${fields}</dl><p class="dg-print-meta">عدد السجلات: ${snapshot.src.length}${selection}${pageNote}</p>${filters}</header>${tableHtml(true,snapshot.src,vc,snapshot.widths)}${autoPrint?'<script>window.addEventListener("load",()=>{window.focus();window.print()},{once:true});</script>':''}</body></html>`;
 }
 // Backward compatible synchronous HTML for a context-free grid; ID-resolved
 // contexts are asynchronous. Word export and print share the same document path.
 function docHtml(forPrint=false,full=false,srcRows=null){
  const snapshot=documentSnapshot(forPrint,full,srcRows);
  if(o.resolvePrintContext||typeof o.printContext==='function')return resolveDocumentContext(snapshot).then(context=>buildDocument(snapshot,context,{forPrint}));
  return buildDocument(snapshot,createPrintContext(snapshot.contextInput,{tableTitle:snapshot.tableTitle,query:snapshot.query,columns:cols,date:snapshot.date}),{forPrint});
 }
 async function printGrid(srcRows=null){
  if(remote&&(providerMeta.loading||providerMeta.error)){toast('انتظر اكتمال تحميل الصفحة قبل الطباعة.','error');return false}
  const snapshot=documentSnapshot(true,true,srcRows);
  // Open during the user's gesture, BEFORE awaiting IndexedDB: popup blockers
  // otherwise prevent printing in real browsers.
  const w=window.open('','_blank');if(!w){alert('اسمح بالنوافذ المنبثقة للطباعة.');return false}
  try{
   w.opener=null;w.document.open();w.document.write('<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><title>إعداد الطباعة</title><body><p>جارٍ إعداد بيانات الطباعة…</p></body></html>');w.document.close();
   const context=await resolveDocumentContext(snapshot);
   if(w.closed)return false;
   w.document.open();w.document.write(buildDocument(snapshot,context,{forPrint:true,autoPrint:true}));w.document.close();return true;
  }catch(error){try{w.close()}catch{}toast(`تعذر إعداد الطباعة: ${error?.message||'خطأ في قراءة السياق'}`,'error');return false}
 }
 function download(content,name,type){const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000)}
 function exportGrid(kind,srcRows=null){
  const full=kind.endsWith(':full');kind=kind.replace(':full','');
  const base=((o.exportName||o.title||'report')+'-'+formatDate(new Date()).replace(/\//g,'-')).replace(/[\\/:*?"<>|]+/g,'-');const {head,body}=matrix(full,srcRows);
  if(kind==='csv'){const q=v=>`"${String(v??'').replace(/"/g,'""')}"`;download('\ufeff'+[head,...body].map(r=>r.map(q).join(',')).join('\r\n'),base+'.csv','text/csv;charset=utf-8')}
  else if(kind==='txt'){download('\ufeff'+[head,...body].map(r=>r.map(v=>String(v??'').replace(/[\t\r\n]+/g,' ')).join('\t')).join('\r\n'),base+'.txt','text/plain;charset=utf-8')}
  else if(kind==='xls'){download('\ufeff'+`<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" dir="rtl"><head><meta charset="utf-8"><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>Sheet1</x:Name><x:WorksheetOptions><x:DisplayRightToLeft/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--></head><body>${tableHtml(full,srcRows)}</body></html>`,base+'.xls','application/vnd.ms-excel;charset=utf-8')}
  else if(kind==='doc'){const html=docHtml(false,false,srcRows);if(html?.then)return html.then(content=>download('\ufeff'+content,base+'.doc','application/msword;charset=utf-8'));download('\ufeff'+html,base+'.doc','application/msword;charset=utf-8')}
 }

 let menuEl=null;
 function closeMenu(){menuEl?.remove();menuEl=null}
 function openMenu(anchor,row,x,y){
  closeMenu();
  const items=menuItems(row);if(!items.length)return;
  menuEl=document.createElement('div');menuEl.className='dg-ctx';menuEl.setAttribute('role','menu');
  menuEl.innerHTML=items.map(it=>`<button type="button" role="menuitem" data-act="${esc(it.id)}" class="${it.danger?'is-danger':''}">${esc(it.label)}</button>`).join('');
  document.body.append(menuEl);
  const w=menuEl.offsetWidth||180,h=menuEl.offsetHeight||items.length*36;
  menuEl.style.left=Math.max(8,Math.min(x??8,window.innerWidth-w-8))+'px';
  menuEl.style.top=Math.max(8,Math.min(y??8,window.innerHeight-h-8))+'px';
  menuEl.addEventListener('click',ev=>{const b=ev.target.closest('[data-act]');if(!b)return;const id=b.dataset.act;closeMenu();o.onRowAction?.(id,row)});
 }
 $('tbody').addEventListener('contextmenu',e=>{const tr=e.target.closest('tr[data-i]');if(!tr)return;const row=view[Number(tr.dataset.i)];if(!row||!menuItems(row).length)return;e.preventDefault();openMenu(tr,row,e.clientX,e.clientY)});
 const onDocDown=e=>{if(!root.isConnected){document.removeEventListener('mousedown',onDocDown,true);document.removeEventListener('keydown',onDocKey);return}if(menuEl&&!menuEl.contains(e.target)&&!e.target.closest?.('.dg-qa-btn'))closeMenu()};
 const onDocKey=e=>{if(!root.isConnected){document.removeEventListener('mousedown',onDocDown,true);document.removeEventListener('keydown',onDocKey);return}if(e.key==='Escape')closeMenu()};
 document.addEventListener('mousedown',onDocDown,true);
 document.addEventListener('keydown',onDocKey);
 if(remote&&typeof MutationObserver==='function'&&document.documentElement){
  providerObserver=new MutationObserver(()=>{if(root.isConnected)return;providerSequence++;try{providerController?.abort()}catch{}providerObserver?.disconnect()});
  providerObserver.observe(document.documentElement,{childList:true,subtree:true});
 }
 $('.dg-selbar').addEventListener('click',async e=>{
  const b=e.target.closest('[data-bulk]');if(!b)return;
  const act=(o.bulkActions||[]).find(a=>a.id===b.dataset.bulk);if(!act)return;
  const picked=selectedRows();if(!picked.length)return;
  if(act.confirm){const {confirmBox}=await import('./modal.js');const ok=await confirmBox(act.confirm,{okText:act.okText||act.label||'تأكيد'});if(!ok)return}
  try{await o.onBulk?.(act.id,picked)}catch(err){toast(err?.message||'تعذر تنفيذ الإجراء','error')}
 });
 $('.dg-open-sel')?.addEventListener('click',async()=>{
  const picked=selectedRows().slice(0,20);if(!picked.length)return;
  if(o.onBulk){try{await o.onBulk('open',picked)}catch(err){toast(err?.message||'تعذر الفتح','error')}return}
  if(picked[0]&&o.onRowClick)o.onRowClick(picked[0]);
 });
 renderAdv();$('.dg-adv').hidden=!st.adv.rules.length||st.filterCollapsed;
 render();
 if(remote)loadProviderRows();
 return {
  setRows(r,meta){if(remote){provider.setRows?.(r||[]);pageIndex=0;pageCursors.splice(1);pageCursors[0]=null;return loadProviderRows()}rows=r||[];if(meta&&typeof meta==='object'&&'more' in meta)o.more=Boolean(meta.more);st.shown=o.pageSize;render()},
  getView:()=>view,
  get rows(){return rows},
  getQuery:()=>makeQuery(),
  reload({resetPage=true}={}){if(remote){if(resetPage){pageIndex=0;pageCursors.splice(1);pageCursors[0]=null}return loadProviderRows()}render();return Promise.resolve()},
  applyFilter(key,op,v1,v2=''){st.filters.set(key,{op,v1,v2,set:null});changeQuery()},
  applyReferenceFilter(key,id){if(!byKey.get(key)?.references)throw new TypeError('The column has no identity-backed references.');st.filters.set(key,{op:'eq',v1:String(id),v2:'',set:null,valueType:'reference'});changeQuery()},
  clearFilter(key){st.filters.delete(key);changeQuery()},
  getGridId:()=>root.dataset.gridId,
  getVisibleColumns:()=>visibleCols(),
  sortBy(key,dir='asc'){st.sort=[{key,dir}];changeQuery()},
  togglePin(key){togglePin(key)},
  getSelection(){return selectedRows()},
  destroy(){providerSequence++;try{providerController?.abort()}catch{}providerObserver?.disconnect();document.removeEventListener('mousedown',onDocDown,true);document.removeEventListener('keydown',onDocKey);closePop();closeMenu()},
  clearSelection(){st.selected.clear();selectedRowsByKey.clear();renderHead();renderBody()},
  setColSearch(key,val){if(val)st.colSearch[key]=val;else delete st.colSearch[key];changeQuery()},
  isColSearchOn(){return st.colSearchOn},
  exportData:kind=>exportGrid(kind),
  docHtml:()=>docHtml(false),
  print:srcRows=>printGrid(srcRows??null),
  async getPrintContext({srcRows=null}={}){return resolveDocumentContext(documentSnapshot(true,true,srcRows))},
  async getPrintDocument({srcRows=null,autoPrint=false}={}){const snapshot=documentSnapshot(true,true,srcRows);return buildDocument(snapshot,await resolveDocumentContext(snapshot),{forPrint:true,autoPrint})}
 };
}
