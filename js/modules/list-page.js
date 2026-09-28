// صفحة قائمة عامة لأي كيان: زر إضافة، بحث فوري شامل، فترات جاهزة، تقويم للكيانات المرتبطة بتاريخ، وجدول Access.
// القراءة محدودة (1000 صف افتراضيًا مع «تحميل المزيد») ولا تُحمَّل المخازن كاملة في الذاكرة.
import {esc} from '../ui/dom.js';
import {mountGrid} from '../ui/datagrid.js';
import {mountCalendar} from '../ui/calendar.js';
import {openEntityForm} from '../ui/form.js';
import {ENTITIES,FILE_TYPE_GROUPS,displayValue,columnType,phonesOf} from '../domain/entities.js';
import {loadRows,resolveRefs,presetRange,PRESETS,scan,DEFAULT_LIMIT,MAX_LIMIT} from '../services/entity-query.js';
import {fmtDate} from '../domain/entities.js';

export function columnsFor(store,refs,{extra=[]}={}){
 const ent=ENTITIES[store];
 let fields=[...ent.fields];
 if(store==='files')fields=[...fields,...Object.values(FILE_TYPE_GROUPS).flatMap(g=>g.fields.map(f=>({...f,grid:false})))];
 const cols=fields.map(f=>({key:f.k,label:f.l,type:f.ref?'text':columnType(f),hidden:!f.grid,
  get:r=>f.t==='phones'?phonesOf(r).join(' '):f.ref?refs.get(r[f.k])||'':r[f.k],
  text:r=>displayValue(f,r,refs)}));
 if(store==='files')cols.push({key:'isArchived',label:'مؤرشف',type:'bool',hidden:true,get:r=>Boolean(r.isArchived),text:r=>r.isArchived?'نعم':'لا'});
 return [...cols,...extra];
}
export function routeFor(store,row){const r=ENTITIES[store]?.route;if(!r)return null;return r.startsWith('rec:')?`${r}:${row.id}`:`${r}:${row.id}`}
export function openRow(app,store,row){const r=routeFor(store,row);if(r)app.go(r)}

// شبكة داخل قسم (صفحات السجل): صفوف معروفة مسبقًا
export async function sectionGrid(app,el,store,rows,{storageKey,title,extra=[]}={}){
 const refs=await resolveRefs(app.office,rows,ENTITIES[store].fields);
 return mountGrid(el,{columns:columnsFor(store,refs,{extra}),rows,title:title||ENTITIES[store].plural,storageKey:storageKey||'sec:'+store,pageSize:100,onRowClick:r=>openRow(app,store,r),emptyText:'لا توجد سجلات.'});
}

const state=app=>(app.__lists=app.__lists||{});

export function listPage(app,store,query){
 const ent=ENTITIES[store];
 const st=state(app)[store]=state(app)[store]||{q:'',preset:'all',from:'',to:'',limit:DEFAULT_LIMIT,showCal:Boolean(ent.calendar)};
 if(query?.get('preset')){st.preset=query.get('preset');st.from=query.get('from')||'';st.to=query.get('to')||''}
 if(query?.get('q')!==null&&query?.get('q')!==undefined)st.q=query.get('q');
 const hasDate=Boolean(ent.dateField);
 const presetLabel=store==='procedures'?[...PRESETS.slice(0,1),['overdue','المتأخرة'],...PRESETS.slice(1)]:PRESETS;
 return `<div class="page-head list-head"><div><h2>${esc(ent.plural)}</h2><p class="muted small">اضغط على أي صف لفتح صفحته. البحث يشمل كل الحقول${['hearings','procedures','judgments','execution','witnesses','expertReports','fees','caseNotes','documentReferences','appointments','communications','powersOfAttorney','cases'].includes(store)?' وبيانات الملف والقضية والموكل المرتبطة':''}.</p></div>
  <div class="head-actions"><button class="primary" data-list-add>+ إضافة ${esc(ent.label)}</button></div></div>
 <div class="list-controls">
  <input id="list-q" type="search" class="list-search" value="${esc(st.q)}" placeholder="بحث فوري شامل…" autocomplete="off" aria-label="بحث">
  ${hasDate?`<div class="preset-bar" role="group" aria-label="الفترة">${presetLabel.map(([k,l])=>`<button type="button" class="chip${st.preset===k?' active':''}" data-preset="${k}">${l}</button>`).join('')}</div>
  <div class="custom-range"${st.preset==='custom'?'':' hidden'}><label>من<input type="date" id="list-from" value="${esc(st.from)}"></label><label>إلى<input type="date" id="list-to" value="${esc(st.to)}"></label><button type="button" class="ghost" data-range-apply>عرض</button></div>
  ${ent.calendar?`<button type="button" class="ghost" data-cal-toggle aria-expanded="${st.showCal}">📅 التقويم</button>`:''}`:''}
 </div>
 ${ent.calendar?`<div class="list-cal"${st.showCal?'':' hidden'}><div id="list-calendar"></div></div>`:''}
 <div class="list-status muted small" aria-live="polite"></div>
 <div id="list-grid"></div>`;
}

export function bindListPage(app,store){
 const ent=ENTITIES[store];const st=state(app)[store];
 const root=document.querySelector('#main-content');
 let grid=null,seq=0;
 const gridRefs=new Map(); // خريطة تسميات مشتركة يقرأ منها الجدول وتتحدث مع كل تحميل
 const status=root.querySelector('.list-status');
 async function load(){
  const my=++seq;
  status.textContent='جارٍ التحميل…';
  const [from,to]=st.preset==='overdue'?['0000-01-01',yesterday()]:presetRange(st.preset,st.from,st.to);
  const filter=st.preset==='overdue'?(x=>!x.status||['open','pending'].includes(x.status)):null;
  const {rows,more}=await loadRows(app.office,store,{q:st.q,from,to,limit:st.limit,filter});
  if(my!==seq)return;
  await resolveRefs(app.office,rows,ENTITIES[store].fields,gridRefs);
  if(my!==seq)return;
  if(!grid)grid=mountGrid(root.querySelector('#list-grid'),{columns:columnsFor(store,gridRefs),rows,title:ent.plural,storageKey:'list:'+store,onRowClick:r=>openRow(app,store,r),emptyText:'لا توجد سجلات مطابقة. غيّر البحث أو الفترة، أو أضف سجلًا جديدًا.'});
  else grid.setRows(rows);
  status.innerHTML=more?`تم عرض أول ${rows.length} سجل. <button type="button" class="link" data-more>تحميل المزيد</button> أو ضيّق البحث/الفترة.`:(st.q||from||to?`${rows.length} نتيجة${from||to?` — الفترة: ${fmtDate(from)||'…'} إلى ${fmtDate(to)||'…'}`:''}`:'');
 }
 root.querySelector('[data-list-add]').onclick=async()=>store==='files'?(await import('./client-file.js')).startNewLegalFile(app):openEntityForm(app,store,{onSaved:async(row,isNew)=>{if(isNew&&store==='files')return app.go('file:'+row.id);if(isNew&&['clients','opponents','cases'].includes(store))return app.go(routeFor(store,row));await load()}});
 let t=0;
 root.querySelector('#list-q').addEventListener('input',e=>{clearTimeout(t);t=setTimeout(()=>{st.q=e.target.value;st.limit=DEFAULT_LIMIT;load().catch(err=>app.fail(err))},250)});
 root.querySelectorAll('[data-preset]').forEach(b=>b.onclick=()=>{st.preset=b.dataset.preset;root.querySelectorAll('[data-preset]').forEach(x=>x.classList.toggle('active',x===b));root.querySelector('.custom-range').hidden=st.preset!=='custom';if(st.preset!=='custom'){st.limit=DEFAULT_LIMIT;load().catch(err=>app.fail(err))}});
 root.querySelector('[data-range-apply]')?.addEventListener('click',()=>{st.from=root.querySelector('#list-from').value;st.to=root.querySelector('#list-to').value;load().catch(err=>app.fail(err))});
 root.querySelector('[data-cal-toggle]')?.addEventListener('click',e=>{st.showCal=!st.showCal;e.currentTarget.setAttribute('aria-expanded',st.showCal);root.querySelector('.list-cal').hidden=!st.showCal});
 status.addEventListener('click',e=>{if(e.target.closest('[data-more]')){st.limit=Math.min(MAX_LIMIT,st.limit+DEFAULT_LIMIT);load().catch(err=>app.fail(err))}});
 if(ent.calendar){
  mountCalendar(root.querySelector('#list-calendar'),{selected:st.preset==='custom'&&st.from&&st.from===st.to?st.from:undefined,
   onMonthChange:async(y,m)=>{const first=`${y}-${String(m).padStart(2,'0')}-01`,last=`${y}-${String(m).padStart(2,'0')}-31`;const {rows}=await scan(app.office,store,{index:ent.dateIndex||ent.dateField,lower:first,upper:last+'\uffff',limit:3000,direction:'next'});const mm=new Map();for(const r of rows){const d=String(r[ent.dateField]||'').slice(0,10);mm.set(d,(mm.get(d)||0)+1)}return mm},
   onSelect:d=>{st.preset='custom';st.from=d;st.to=d;root.querySelectorAll('[data-preset]').forEach(x=>x.classList.toggle('active',x.dataset.preset==='custom'));const cr=root.querySelector('.custom-range');cr.hidden=false;cr.querySelector('#list-from').value=d;cr.querySelector('#list-to').value=d;load().catch(err=>app.fail(err))}});
 }
 load().catch(err=>app.fail(err));
}
function yesterday(){const d=new Date();d.setDate(d.getDate()-1);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
