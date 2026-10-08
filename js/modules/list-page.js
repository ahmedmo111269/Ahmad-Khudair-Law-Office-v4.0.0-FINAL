// صفحة قائمة عامة لأي كيان: زر إضافة، بحث فوري شامل، فترات جاهزة، تقويم للكيانات المرتبطة بتاريخ، وجدول Access.
// القوائم الرئيسية تعرض صفحات cursor من 25/50/100 سجلًا؛ التقارير والأقسام تبقى محدودة بحسب حاجتها.
import {esc} from '../ui/dom.js';
import {mountGrid} from '../ui/datagrid.js';
import {legalFileColumns} from '../ui/grid-columns.js';
import {createGridRelations,gridPageContext,hasLegalFileColumns} from '../services/grid-relations.js';
import {mountCalendar} from '../ui/calendar.js';
import {openEntityForm} from '../ui/form.js';
import {toast} from '../ui/toast.js';
import {ENTITIES,FILE_TYPE_GROUPS,displayValue,columnType,phonesOf} from '../domain/entities.js';
import {createEntityGridProvider,resolveRefs,presetRange,PRESETS,scan} from '../services/entity-query.js';
import {fmtDate} from '../domain/entities.js';
import {formatFileNumber} from '../core/file-number.js';
import {prefs} from '../core/preferences.js';
import {registerPageLayout,openPageCustomizer} from '../ui/page-layout.js';
import {PROCEDURES_EXTRAS} from './procedures-extras.js';

// ===== سجل إضافات القائمة =====
// صفحة قائمة عامة تستضيف لوحات مخصصة فوق الجدول (ملخص/إحصاء/لوحة حالات)
// دون تحويل listPage إلى كود خاص بكياان. الوحدة تصدّر كائن extras وتُسجّل هنا،
// ولا تستورد list-page (لا حلقات استيراد).
const LIST_EXTRAS = new Map();
export function registerListExtras(store, extras) {
  if (store && extras) LIST_EXTRAS.set(store, extras);
}
export function listExtrasFor(store) { return LIST_EXTRAS.get(store) || null; }
registerListExtras('procedures', PROCEDURES_EXTRAS);

export function columnsFor(store,refs,{extra=[],relations=null}={}){
 const ent=ENTITIES[store];
 let fields=[...ent.fields];
 if(store==='files')fields=[...fields,...Object.values(FILE_TYPE_GROUPS).flatMap(g=>g.fields.map(f=>({...f,grid:false})))];
 const cols=fields.map(f=>({key:f.k,label:f.l,type:f.ref?'text':columnType(f),hidden:!f.grid||(store==='files'&&['fileType','partyNames'].includes(f.k)),index:f.ref?false:undefined,
  get:r=>f.t==='phones'?phonesOf(r).join(' '):f.ref?refs.get(r[f.k])||'':r[f.k],
  text:r=>displayValue(f,r,refs)}));
 if(store==='files')cols.push({key:'isArchived',label:'مؤرشف',type:'bool',hidden:true,get:r=>Boolean(r.isArchived),text:r=>r.isArchived?'نعم':'لا'});
 let shared=[];
 if(hasLegalFileColumns(store)){
  const keys=store==='files'?{fileKey:'fileNumber'}:store==='clients'?{fileKey:'legalFiles',clientKey:'fullName'}:store==='opponents'?{fileKey:'legalFiles',opponentKey:'name'}:store==='fileRelations'?{fileKey:'sourceFileId'}:{};
  shared=legalFileColumns(relations,keys);
  if(store==='fileRelations')shared.push(...legalFileColumns(relations,{side:'target',fileKey:'targetFileId',clientKey:'targetClientId',opponentKey:'targetOpponentId',fileTitle:'رقم الملف المرتبط / نوعه',clientTitle:'الموكل (الملف المرتبط)',opponentTitle:'الخصم (الملف المرتبط)'}));
 }
 const replaced=new Set(shared.map(column=>column.key));
 return [...shared,...cols.filter(column=>!replaced.has(column.key)),...extra];
}
export function routeFor(store,row){const r=ENTITIES[store]?.route;if(!r)return null;return r.startsWith('rec:')?`${r}:${row.id}`:`${r}:${row.id}`}
export function openRow(app,store,row){const r=routeFor(store,row);if(r)app.go(r)}

// شبكة داخل قسم (صفحات السجل): صفوف معروفة مسبقًا
export async function sectionGrid(app,el,store,rows,{storageKey,title,extra=[],collapseKey,printContext}={}){
 const relations=createGridRelations(app.office,store);
 const [refs]=await Promise.all([resolveRefs(app.office,rows,ENTITIES[store].fields),relations.hydrate(rows)]);
 const pageKey=String(app.route||'page').split('?')[0];
 const gridStorageKey=storageKey||`sec:${pageKey.split(':')[0]}:${store}`;
 return mountGrid(el,{columns:columnsFor(store,refs,{extra,relations}),rows,title:title||ENTITIES[store].plural,storageKey:gridStorageKey,collapseKey:collapseKey||`${pageKey}:grid:${gridStorageKey}`,pageSize:100,onRowClick:r=>openRow(app,store,r),emptyText:'لا توجد سجلات.',selectable:true,...relations.gridOptions(printContext||gridPageContext(app.route)),...gridActions(app,store,()=>app.refresh())});
}

const LIST_VIEW_KEY=store=>`ui:list-view:${store}`;
const state=app=>(app.__lists=app.__lists||{});
function listFilterCount(st){return (String(st.q||'').trim()?1:0)+(st.preset&&st.preset!=='all'?1:0)+(st.status&&st.status!=='all'?1:0)}
function saveListView(store,st){prefs.set(LIST_VIEW_KEY(store),{q:st.q||'',preset:st.preset||'all',from:st.from||'',to:st.to||'',showCal:Boolean(st.showCal),status:st.status||'all'})}


export function listPage(app,store,query){
 const ent=ENTITIES[store];
 const extras=listExtrasFor(store);
 // اشتراك القائمة في نظام ترتيب الأقسام المركزي (تعريف واحد يعمل لكل القوائم)
 registerPageLayout({pageId:store,title:ent.plural,sections:[
  ...(extras?[{id:'extras',title:extras.title||'ملخص وإجراءات سريعة',icon:extras.icon||'◈'}]:[]),
  {id:'filters',title:'عوامل التصفية والفترات'},
  {id:'grid',title:'جدول السجلات',canHide:false}]});
 const saved=prefs.get(LIST_VIEW_KEY(store),{})||{};
 const st=state(app)[store]=state(app)[store]||{q:saved.q||'',preset:saved.preset||'all',from:saved.from||'',to:saved.to||'',showCal:saved.showCal??Boolean(ent.calendar),status:saved.status||'all'};
 if(query?.get('preset')){st.preset=query.get('preset');st.from=query.get('from')||'';st.to=query.get('to')||''}
 if(query?.get('q')!==null&&query?.get('q')!==undefined)st.q=query.get('q');
 saveListView(store,st);
 const hasDate=Boolean(ent.dateField);
 const presetLabel=store==='procedures'?[...PRESETS.slice(0,1),['overdue','المتأخرة'],...PRESETS.slice(1)]:PRESETS;
 return `<div class="page-head list-head"><div><h2>${esc(ent.plural)}</h2><p class="muted small">اضغط على أي صف لفتح صفحته. البحث يشمل كل الحقول${['hearings','procedures','judgments','execution','expertReports','fees','caseNotes','documentReferences','appointments','communications','powersOfAttorney','cases'].includes(store)?' وبيانات الملف والقضية والموكل المرتبطة':''}.</p></div>
  <div class="head-actions"><button class="ghost" data-customize-page title="ترتيب الأقسام وإظهارها وإعدادات العرض">⚙ تخصيص الصفحة</button><button class="ghost" data-qa-custom title="إظهار أو إخفاء إجراءات الصف">إجراءات الصف</button><button class="primary" data-list-add>+ إضافة ${esc(ent.label)}</button></div></div>
 ${extras?`<section class="panel list-extras-panel" data-section-id="extras" data-collapse-id="list-extras-${esc(store)}" data-collapse-default="open"><div class="panel-head"><h3>${esc(extras.heading||'◈ ملخص سريع')}</h3><span class="muted small">${esc(extras.hint||'')}</span></div><div id="list-extras" aria-live="polite"><p class="muted small">جارٍ تحميل الملخص…</p></div></section>`:''}
 <section class="panel list-filter-panel" data-section-id="filters" data-collapse-id="list-filters-${esc(store)}"><div class="panel-head"><h3>🔍 عوامل التصفية والفترات</h3><span class="badge" data-list-filter-count>${listFilterCount(st)?`${listFilterCount(st)} فلاتر نشطة`:'لا توجد فلاتر نشطة'}</span></div>
 <div class="list-controls">
  <input id="list-q" type="search" class="list-search" value="${esc(st.q)}" placeholder="بحث فوري شامل…" autocomplete="off" aria-label="بحث">
  ${hasDate?`<div class="preset-bar" role="group" aria-label="الفترة">${presetLabel.map(([k,l])=>`<button type="button" class="chip${st.preset===k?' active':''}" data-preset="${k}">${l}</button>`).join('')}</div>
  <div class="custom-range"${st.preset==='custom'?'':' hidden'}><label>من<input type="date" id="list-from" value="${esc(st.from)}"></label><label>إلى<input type="date" id="list-to" value="${esc(st.to)}"></label><button type="button" class="ghost" data-range-apply>عرض</button></div>
  ${ent.calendar?`<button type="button" class="ghost" data-cal-toggle aria-expanded="${st.showCal}">📅 التقويم</button>`:''}`:''}
 </div></section>
 ${ent.calendar?`<div class="list-cal"${st.showCal?'':' hidden'}><div id="list-calendar"></div></div>`:''}
 <div class="list-status muted small" aria-live="polite"></div>
 <div id="list-grid" data-section-id="grid"></div>`;
}

export function bindListPage(app,store){
 const ent=ENTITIES[store];const st=state(app)[store];
 const extras=listExtrasFor(store);
 if(!st.status)st.status='all';
 const root=document.querySelector('#main-content');
 let grid=null;
 const gridRefs=new Map(); // تسميات المراجع؛ سجلات العلاقات تبقى في WeakMap مستقلة
 const relations=createGridRelations(app.office,store);
 const status=root.querySelector('.list-status');
 const filterBadge=root.querySelector('[data-list-filter-count]');
 const syncFilterSummary=()=>{const n=listFilterCount(st);if(filterBadge)filterBadge.textContent=n?`${n} فلاتر نشطة`:'لا توجد فلاتر نشطة'};
 // مرشّح الحالة (شرائح الملخص) يُركّب مع مرشّح الفترة دون إلغاء أحدهما للآخر.
 const statusFilter=()=>{
  if(!extras?.statusFilter||!st.status||st.status==='all')return null;
  try{return extras.statusFilter(st.status)}catch{return null}
 };
 const currentScope=()=>{
  const [from,to]=st.preset==='overdue'?['0000-01-01',yesterday()]:presetRange(st.preset,st.from,st.to);
  const presetFilter=st.preset==='overdue'?(row=>!row.status||['open','pending'].includes(row.status)):null;
  const extraFilter=statusFilter();
  const filter=presetFilter||extraFilter?(row=>(!presetFilter||presetFilter(row))&&(!extraFilter||extraFilter(row))):null;
  return {from,to,filter};
 };
 const scopeSummary=()=>{
  const {from,to}=currentScope();
  const parts=[];
  if(String(st.q||'').trim())parts.push(`بحث: ${st.q.trim()}`);
  if(from||to)parts.push(`الفترة: ${fmtDate(from)||'…'} — ${fmtDate(to)||'…'}`);
  return parts.join(' · ');
 };
 async function load(){
  saveListView(store,st);syncFilterSummary();
  if(!grid){
   const provider=createEntityGridProvider(app.office,store,{
    getBaseQuery:()=>({q:st.q,...currentScope(),dateField:ent.dateField}),
    prepareQuery:(query,{columns})=>relations.loadFilterLabels(query,columns),
    prepareRows:async(pageRows,{signal})=>{await Promise.all([resolveRefs(app.office,pageRows,ent.fields,gridRefs),relations.hydrate(pageRows,{signal})])}
   });
   grid=mountGrid(root.querySelector('#list-grid'),{
    columns:columnsFor(store,gridRefs,{relations}),rows:[],dataProvider:provider,pageSize:25,
    ...relations.gridOptions(()=>({filters:scopeSummary()?[scopeSummary()]:[]})),
    title:ent.plural,storageKey:'list:'+store,collapseKey:`list:${store}:grid`,
    // References are already hydrated before the provider applies filters/search.
    onProviderState:({phase,error})=>{
     if(phase==='loading')status.textContent='جارٍ تحميل الصفحة المطلوبة…';
     else if(phase==='ready')status.textContent=scopeSummary();
     else if(phase==='error')status.textContent=`تعذر تحميل الصفحة: ${error?.message||'خطأ في التخزين المحلي'}`;
    },
    onRowClick:r=>openRow(app,store,r),
    emptyText:'لا توجد سجلات مطابقة. غيّر البحث أو الفترة، أو أضف سجلًا جديدًا.',
    selectable:true,exportName:ent.plural,
    ...gridActions(app,store,()=>load().catch(err=>app.fail(err)))
   });
  }else await grid.reload({resetPage:true});
 }
 root.querySelector('[data-list-add]').onclick=async()=>store==='files'?(await import('./client-file.js')).startNewLegalFile(app):openEntityForm(app,store,{onSaved:async(row,isNew)=>{if(isNew&&store==='files')return app.go('file:'+row.id);if(isNew&&['clients','opponents','cases'].includes(store))return app.go(routeFor(store,row));await load()}});
 root.querySelector('[data-qa-custom]')?.addEventListener('click',()=>customizeRowActions().then(()=>load()).catch(err=>app.fail(err)));
 root.querySelector('[data-customize-page]')?.addEventListener('click',()=>openPageCustomizer(app,{pageId:store,root}));
 let t=0;
 root.querySelector('#list-q').addEventListener('input',e=>{clearTimeout(t);st.q=e.target.value;saveListView(store,st);syncFilterSummary();t=setTimeout(()=>load().catch(err=>app.fail(err)),250)});
 // «/» يقفز لبحث القائمة من أي موضع في الصفحة، وEsc يمسحه
 root.addEventListener('keydown',e=>{
  const q=root.querySelector('#list-q');if(!q)return;
  if(e.key==='/'&&!/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)){e.preventDefault();q.focus();q.select()}
  else if(e.key==='Escape'&&e.target===q&&q.value){q.value='';st.q='';saveListView(store,st);syncFilterSummary();load().catch(err=>app.fail(err))}
 });
 root.querySelectorAll('[data-preset]').forEach(b=>b.onclick=()=>{st.preset=b.dataset.preset;root.querySelectorAll('[data-preset]').forEach(x=>x.classList.toggle('active',x===b));root.querySelector('.custom-range').hidden=st.preset!=='custom';saveListView(store,st);syncFilterSummary();if(st.preset!=='custom')load().catch(err=>app.fail(err))});
 root.querySelector('[data-range-apply]')?.addEventListener('click',()=>{st.from=root.querySelector('#list-from').value;st.to=root.querySelector('#list-to').value;saveListView(store,st);syncFilterSummary();load().catch(err=>app.fail(err))});
 root.querySelector('[data-cal-toggle]')?.addEventListener('click',e=>{st.showCal=!st.showCal;e.currentTarget.setAttribute('aria-expanded',st.showCal);root.querySelector('.list-cal').hidden=!st.showCal;saveListView(store,st)});
 if(ent.calendar){
  mountCalendar(root.querySelector('#list-calendar'),{selected:st.preset==='custom'&&st.from&&st.from===st.to?st.from:undefined,
   onMonthChange:async(y,m)=>{const first=`${y}-${String(m).padStart(2,'0')}-01`,last=`${y}-${String(m).padStart(2,'0')}-31`;const {rows}=await scan(app.office,store,{index:ent.dateIndex||ent.dateField,lower:first,upper:last+'\uffff',limit:3000,direction:'next'});const mm=new Map();for(const r of rows){const d=String(r[ent.dateField]||'').slice(0,10);mm.set(d,(mm.get(d)||0)+1)}return mm},
   onSelect:d=>{st.preset='custom';st.from=d;st.to=d;root.querySelectorAll('[data-preset]').forEach(x=>x.classList.toggle('active',x.dataset.preset==='custom'));const cr=root.querySelector('.custom-range');cr.hidden=false;cr.querySelector('#list-from').value=d;cr.querySelector('#list-to').value=d;saveListView(store,st);syncFilterSummary();load().catch(err=>app.fail(err))}});
 }
 if(extras?.mount){
  const host=root.querySelector('#list-extras');
  const setStatus=value=>{st.status=value||'all';saveListView(store,st);syncFilterSummary();load().catch(err=>app.fail(err))};
  const ctx={app,office:app.office,st,reload:()=>load().catch(err=>app.fail(err)),setStatus,root};
  Promise.resolve(extras.mount(host,ctx)).catch(error=>{console.error('list extras',error);if(host)host.innerHTML=`<p class="muted small">تعذر تحميل الملخص السريع. ${esc(error?.message||'')}</p>`});
 }
 load().catch(err=>app.fail(err));
}
function yesterday(){const d=new Date();d.setDate(d.getDate()-1);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}

const QA_KEY='ui:qa-actions';
const QA_ALL=[
 ['preview','معاينة سريعة'],['open','فتح السجل'],['file','فتح الملف'],['client','فتح الموكل'],
 ['add-hearing','إضافة جلسة'],['add-procedure','إضافة عمل إداري'],['add-note','إضافة ملاحظة'],
 ['add-service','إضافة إعلان/محضر'],['add-judgment','إضافة حكم'],['relations','فتح العلاقات'],['copy','نسخ الرقم']
];
function qaAllowed(){const saved=prefs.get(QA_KEY);return Array.isArray(saved)&&saved.length?new Set(saved):null}
export function rowMenuFor(store,row){
 const allow=qaAllowed();
 const items=[];
 const add=(id,label,danger=false)=>{if(!allow||allow.has(id))items.push({id,label,danger})};
 add('preview','معاينة سريعة');
 add('open',store==='files'?'فتح الملف':'فتح السجل');
 if(row.fileId&&store!=='files')add('file','فتح الملف');
 if(row.clientId)add('client','فتح الموكل');
 if(store==='files'||row.fileId){
  add('add-hearing','إضافة جلسة');
  add('add-procedure','إضافة عمل إداري');
  add('add-note','إضافة ملاحظة');
  add('add-service','إضافة إعلان/محضر');
  add('add-judgment','إضافة حكم');
  add('relations','فتح العلاقات');
 }
 if(row.fileNumber||row.caseNumber||row.poaNumber)add('copy','نسخ الرقم');
 return items;
}
function fileIdOf(store,row){return store==='files'?row.id:row.fileId||''}
async function copyText(v){
 const text=String(v||'').trim();if(!text){toast('لا يوجد رقم لنسخه','error');return}
 try{await navigator.clipboard.writeText(text);toast('تم النسخ')}catch{
  const ta=document.createElement('textarea');ta.value=text;document.body.append(ta);ta.select();
  try{document.execCommand('copy');toast('تم النسخ')}catch{toast('تعذر النسخ','error')}ta.remove();
 }
}
async function handleRowAction(app,store,id,row,reload){
 const fid=fileIdOf(store,row);
 if(id==='preview'){const {openRecordPreview}=await import('../ui/record-preview.js');return openRecordPreview(app,store,row)}
 if(id==='open')return openRow(app,store,row);
 if(id==='file'&&fid)return app.go('file:'+fid);
 if(id==='client'&&row.clientId)return app.go('client:'+row.clientId);
 if(id==='relations'&&fid){app.__fileTab={id:fid,tab:'relations'};return app.go('file:'+fid)}
 if(id==='copy')return copyText(formatFileNumber(row.fileNumber)||row.fileNumber||row.caseNumber||row.poaNumber||row.noticeNumber||'');
 const preset={fileId:fid||undefined,caseId:row.caseId||row.currentStageId||undefined,clientId:row.clientId||undefined};
 if(id==='add-note'){
  const noteTypes={clients:'CLIENT',files:'LEGAL_FILE',cases:'CASE',hearings:'HEARING',procedures:'PROCEDURE',judgments:'JUDGMENT',execution:'EXECUTION',powersOfAttorney:'POA',serviceRecords:'SERVICE_RECORD',expertReports:'EXPERT_REPORT',appointments:'APPOINTMENT',communications:'COMMUNICATION',fees:'FEE',documentReferences:'DOCUMENT_REFERENCE'};
  const entityType=noteTypes[store];
  const context=entityType ? [{entityType,entityId:row.id,relationType:'CONTEXT'}] : (fid ? [{entityType:'LEGAL_FILE',entityId:fid,relationType:'CONTEXT'}] : []);
  const {openQuickNoteCapture}=await import('./quick-notes.js');
  return openQuickNoteCapture(app,{context,onSaved:()=>reload?.()});
 }
 const map={ 'add-hearing':'hearings','add-procedure':'procedures','add-service':'serviceRecords','add-judgment':'judgments' };
 if(map[id]){
  if(id==='add-hearing'&&!preset.caseId){if(fid){app.__fileTab={id:fid,tab:'hearings'};return app.go('file:'+fid)}toast('أضف الجلسة من ملف له مرحلة قضائية','error');return}
  if((id==='add-judgment')&&!preset.caseId){toast('الحكم يرتبط بمرحلة قضائية. افتح الملف وأضف المرحلة أولًا.','error');return}
  return openEntityForm(app,map[id],{preset,onSaved:()=>reload?.()});
 }
}
function bulkFor(store){
 // «فتح المحدد» ليس إجراءً جماعيًا هنا: الجدول الموحّد يوفره مرة واحدة كزر مدمج
 // في شريط التحديد (dg-open-sel) ويستدعي onBulk('open',…) نفسه — لا تكرار للزر.
 const items=[];
 if(store==='files')items.push({id:'archive',label:'أرشفة',danger:true,confirm:'أرشفة الملفات المحددة؟ تبقى كل البيانات محفوظة ويمكن إعادة فتح الملف لاحقًا.',okText:'أرشفة'});
 if(store==='procedures')items.push({id:'done',label:'تعليم كمنجَز',confirm:'تعليم الأعمال المحددة كمنجَزة؟ يمكن تعديل الحالة لاحقًا من سجل كل عمل.',okText:'تعليم كمنجَز'});
 return items;
}
async function handleBulk(app,store,id,rows,reload){
 if(id==='open'){
  const {modal}=await import('../ui/modal.js');
  const card=modal(`<h2 class="modal-title">السجلات المحددة (${rows.length})</h2><div class="action-stack">${rows.slice(0,30).map(r=>{const route=routeFor(store,r)||'';return `<button type="button" class="ghost" data-open-one="${esc(route)}">${esc(ENTITIES[store].title?.(r)||r.title||r.fullName||'سجل')}</button>`}).join('')}</div><p class="muted small">اختر سجلًا لفتحه. لم يُغيَّر أي بيان.</p>`);
  card.querySelectorAll('[data-open-one]').forEach(b=>b.onclick=()=>{import('../ui/modal.js').then(m=>m.closeModal());app.go(b.dataset.openOne)});
  return;
 }
 if(id==='archive'&&store==='files'){
  const {archiveFile}=await import('../services/legal-files.js');
  let n=0;
  for(const r of rows){if(r.isArchived)continue;await archiveFile(app.office,r.id,'أرشفة جماعية من الجدول');n++}
  toast(n?`تمت أرشفة ${n} ملفًا`:'الملفات المحددة مؤرشفة بالفعل');
  return reload?.();
 }
 if(id==='done'&&store==='procedures'){
  const {saveEntity}=await import('../services/entity-save.js');
  for(const r of rows)await saveEntity(app.office,'procedures',{...r,status:'done'},r.id);
  toast('تم تحديث حالة الأعمال المحددة');
  return reload?.();
 }
}
export function gridActions(app,store,reload){
 return {rowMenu:row=>rowMenuFor(store,row),onRowAction:(id,row)=>handleRowAction(app,store,id,row,reload),bulkActions:bulkFor(store),onBulk:(id,rows)=>handleBulk(app,store,id,rows,reload)};
}
export async function customizeRowActions(){
 const current=qaAllowed();
 const card=(await import('../ui/modal.js')).modal(`<h2 class="modal-title">تخصيص إجراءات الصف</h2><p class="muted small">أخفِ ما لا تحتاجه حتى لا يزدحم الصف. النقر بزر الفأرة الأيمن يبقى متاحًا للإجراءات الظاهرة.</p><div class="action-stack">${QA_ALL.map(([id,label])=>`<label><input type="checkbox" value="${id}" ${!current||current.has(id)?'checked':''}> ${label}</label>`).join('')}</div><div class="form-actions"><button type="button" class="primary" data-save-qa>حفظ</button><button type="button" class="ghost" data-reset-qa>إظهار الكل</button></div>`);
 card.querySelector('[data-save-qa]').onclick=async()=>{const ids=[...card.querySelectorAll('input:checked')].map(i=>i.value);await prefs.set(QA_KEY,ids);(await import('../ui/modal.js')).closeModal();toast('حُفظت إجراءات الصف')};
 card.querySelector('[data-reset-qa]').onclick=async()=>{await prefs.remove(QA_KEY);(await import('../ui/modal.js')).closeModal();toast('عادت الإجراءات إلى الوضع الكامل')};
}
