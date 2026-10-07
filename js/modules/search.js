// صفحة البحث الشامل — الواجهة الأمامية لمحرك البحث المركزي (services/search-engine.js).
// بحث فوري متدرج: الأقسام الرئيسية أولًا ثم باقي الأقسام في الخلفية، تصنيف النتائج بالمصدر،
// تمييز المطابقة، نطاقات اختيار، عمليات بحث محفوظة، سجل بحث، وتنقل كامل بالكيبورد.
import {esc} from '../ui/dom.js';
import {mountGrid} from '../ui/datagrid.js';
import {columnsFor} from './list-page.js';
import {resolveRefs} from '../services/entity-query.js';
import {createGridRelations,hasLegalFileColumns} from '../services/grid-relations.js';
import {highlightMatch} from '../ui/palette.js';
import {getRecent} from '../services/recents.js';
import {icon} from '../ui/icons.js';
import {ENTITIES,label as statusLabel} from '../domain/entities.js';
import {SEARCH_SOURCES,PRIMARY_STORES,allSearchStores,searchAll,searchStore,
 getHistory,pushHistory,clearHistory,getSavedSearches,saveSearch,removeSavedSearch} from '../services/search-engine.js';
import {localDate} from '../core/clock.js';
import {enhanceCollapsiblePanels} from '../ui/collapsible.js';

const ALL=SEARCH_SOURCES.map(s=>s.store);
const state=app=>(app.__searchState=app.__searchState||{q:'',scope:'all',period:'all',from:'',to:''});
const hl=(t,q)=>highlightMatch(t,q).map(p=>p.hl?`<mark>${esc(p.t)}</mark>`:esc(p.t)).join('');
const inPeriod=(row,f,from,to)=>{if(f==='all')return true;const d=String(row[f]||'').slice(0,10);if(!d)return f!=='all';if(from&&d<from)return false;if(to&&d>to)return false;return true};

export async function renderSearch(app){
 const st=state(app);
 const q=new URLSearchParams(app.route.split('?')[1]||'');
 if(q.get('q')!==null&&q.get('q')!==undefined)st.q=q.get('q');
 if(q.get('scope'))st.scope=q.get('scope');
 const sources=SEARCH_SOURCES.map(s=>({v:s.store,l:ENTITIES[s.store]?.plural||s.store,i:s.icon}));
 const year=localDate().slice(0,4);
 return `<div class="page-head"><div><h2>البحث الشامل</h2><p>محرك بحث واحد لكل بيانات المكتب: أسماء وأجزاء أسماء، أرقام الملفات الرئيسية والفرعية (مثل 2/2026)، أرقام قومية، أرقام قضايا وجلسات، أطراف، أتعاب، مستندات…</p></div>
  <div class="head-actions"><button class="ghost" data-page-back>رجوع</button><button class="ghost" data-page-close>إغلاق</button></div></div>
 <section class="panel search-panel">
  <div class="search-hero">
   <span class="sh-ic" aria-hidden="true">${icon('search')}</span>
   <input id="advanced-q" autocomplete="off" autofocus spellcheck="false" value="${esc(st.q)}" placeholder="اكتب اسمًا أو جزءًا منه، أو رقم ملف مثل 2/2026، أو رقم قضية، أو رقمًا قوميًا — وكلمات متعددة للبحث الدقيق">
   <button class="ghost" id="search-clear" title="مسح (Esc)">مسح</button>
  </div>
  <section class="panel search-filter-panel" data-collapse-id="search-filters"><div class="panel-head"><h3>عوامل التصفية والفترة</h3><span class="badge" data-search-filter-summary>لا توجد فلاتر نشطة</span></div>
  <div class="scope-row" role="tablist" aria-label="نطاق البحث">
   <button class="chip ${st.scope==='all'?'active':''}" data-scope="all">الكل</button>
   ${sources.map(s=>`<button class="chip ${st.scope===s.v?'active':''}" data-scope="${s.v}"><span aria-hidden="true">${esc(s.l)}</span></button>`).join('')}
  </div>
  <div class="search-opts">
   <label>الفترة<select id="search-period">
    <option value="all" ${st.period==='all'?'selected':''}>كل التواريخ</option>
    <option value="y" ${st.period==='y'?'selected':''}>هذه السنة (${year})</option>
    <option value="custom" ${st.period==='custom'?'selected':''}>فترة مخصصة</option></select></label>
   <span class="custom-range" ${st.period==='custom'?'':'hidden'}>
    <label>من<input type="date" id="search-from" value="${esc(st.from)}"></label>
    <label>إلى<input type="date" id="search-to" value="${esc(st.to)}"></label>
   </span>
   <span class="muted small">كل الكلمات يجب أن توجد معًا (AND) — التطبيع يتعامل مع أ/إ/آ وة/ه وى/ي تلقائيًا.</span>
  </div>
  <div class="saved-bar" id="saved-bar"></div></section>
  <div id="advanced-status" class="muted small" aria-live="polite"></div>
  <div id="advanced-results"></div>
 </section>`;
}

function recentsHtml(app){
 const rows=getRecent(app.ctx?.profile?.id||'').slice(0,6);
 if(!rows.length)return '';
 return `<section class="search-group"><div class="section-head"><h3>آخر ما فُتح</h3></div><div class="recents-chips">${rows.map(x=>`<button class="recent-chip" data-search-open="${esc(x.route)}"><span aria-hidden="true">↗</span> ${esc(x.title)}</button>`).join('')}</div></section>`;
}
function syntaxHint(){
 return `<div class="search-hint"><h4>أمثلة سريعة</h4><div class="hint-chips">
  <code>أحمد محمد</code> كلمتان معًا (AND) · <code>2/2026</code> رقم ملف رئيسي أو فرعي · <code>29001011201234</code> رقم قومي · <code>1545</code> رقم قضية رسمية · <code>أحمد 2026</code> اسم وسنة
 </div><p class="muted small">اكتب حرفين على الأقل. النتائج مصنفة بالمصدر، والنقر على أي نتيجة يفتح سجلها مباشرة.</p></div>`;
}
function idleHtml(app){
 const hist=getHistory();
 return `${hist.length?`<section class="search-group"><div class="section-head"><h3>بحوثك الأخيرة</h3><button class="link" data-clear-history>مسح السجل</button></div><div class="recents-chips">${hist.map(h=>`<button class="recent-chip" data-hist="${esc(h.q)}"><span aria-hidden="true">⏱</span> ${esc(h.q)}</button>`).join('')}</div></section>`:''}
 ${recentsHtml(app)}${syntaxHint()}`;
}
function rowHtml(it,q){
 return `<button class="search-result" data-search-open="${esc(it.route)}"><span class="sr-ic" aria-hidden="true">${icon(it.icon||'file')}</span>
  <span class="sr-main"><b>${hl(it.title,q)}</b>${it.sub?`<small>${hl(it.sub,q)}</small>`:''}</span>
  <span class="sr-go" aria-hidden="true">↰</span></button>`;
}
function groupHtml(g,q,{withMore=false}={}){
 return `<section class="search-group" data-group="${esc(g.store)}"><div class="section-head"><h3>${icon(g.icon)} ${esc(g.label)}${g.note?` <small class="muted">(${esc(g.note)})</small>`:''}</h3>
  <span class="group-meta">${g.partial?'<span class="badge warn">نتائج جزئية</span>':''}<span class="badge">${g.items.length}${g.more?'+':''}</span>${g.more&&withMore?`<button class="link" data-more-store="${esc(g.store)}">المزيد في ${esc(g.label)}</button>`:''}</span></div>
  <div class="group-rows">${hasLegalFileColumns(g.store)?'<div data-search-grid><div class="loading small">جارٍ تجهيز بيانات الجدول…</div></div>':g.items.map(it=>rowHtml(it,q)).join('')}</div></section>`;
}

export function bindSearch(app){
 const root=document.querySelector('#main-content');
 const input=root.querySelector('#advanced-q'),out=root.querySelector('#advanced-results'),status=root.querySelector('#advanced-status'),clear=root.querySelector('#search-clear');
 const st=state(app);
 let seq=0,timer=0;
 const resultGrids=new Map();
 const disposeResults=()=>{resultGrids.forEach(grid=>grid.destroy());resultGrids.clear()};
 const periodFilter=it=>st.period==='all'||inPeriod(it.row,ENTITIES[it.store]?.dateField||'createdAt',st.period==='y'?`${localDate().slice(0,4)}-01-01`:st.from,st.period==='y'?`${localDate().slice(0,4)}-12-31`:st.to);
 async function mountResultGrid(group,q,element,my){
  if(!element||!hasLegalFileColumns(group.store))return;
  const rows=group.items.map(item=>item.row),hits=new Map(group.items.map(item=>[item.row.id,item]));
  const relations=createGridRelations(app.office,group.store);
  const [refs]=await Promise.all([resolveRefs(app.office,rows,ENTITIES[group.store].fields),relations.hydrate(rows)]);
  if(my!==seq||!element.isConnected)return;
  const filters=[`بحث شامل: ${q}`,st.period==='y'?'هذه السنة':st.period==='custom'?`الفترة: ${st.from||'…'} — ${st.to||'…'}`:''].filter(Boolean);
  resultGrids.set(group.store,mountGrid(element,{title:`نتائج البحث — ${group.label}`,storageKey:`search:${group.store}`,collapseKey:`search:${group.store}:grid`,rows,columns:columnsFor(group.store,refs,{relations}),pageSize:100,highlightText:q,...relations.gridOptions({filters}),onRowClick:row=>{pushHistory(q);const hit=hits.get(row.id);if(hit?.route)app.go(hit.route)}}));
 }
 const filterSummary=root.querySelector('[data-search-filter-summary]');
 const syncFilterSummary=()=>{
  if(!filterSummary)return;
  const active=[];
  if(st.scope!=='all')active.push(ENTITIES[st.scope]?.plural||st.scope);
  if(st.period==='y')active.push('هذه السنة');
  else if(st.period==='custom')active.push(st.from||st.to?`${st.from||'…'} — ${st.to||'…'}`:'فترة مخصصة');
  filterSummary.textContent=active.length?`${active.length} فلاتر نشطة · ${active.join(' · ')}`:'لا توجد فلاتر نشطة';
 };
 syncFilterSummary();
 const savedBar=root.querySelector('#saved-bar');
 const drawSaved=()=>{
  const sv=getSavedSearches();
  savedBar.innerHTML=`<button class="link" data-save-search ${st.q.trim().length<2?'disabled':''}>★ حفظ هذا البحث</button>${sv.length?'<span class="saved-lbl">المحفوظة:</span>'+sv.map(s=>`<span class="saved-chip"><button class="link" data-saved="${esc(s.name)}" title="${esc(s.q)}">${esc(s.name)}</button><button class="link danger" data-saved-del="${esc(s.name)}" aria-label="حذف ${esc(s.name)}">✕</button></span>`).join(''):''}
   <span class="save-form" hidden><input id="save-name" placeholder="اسم البحث (اختياري)" maxlength="40"><button class="primary small" data-save-ok>حفظ</button><button class="link" data-save-cancel>إلغاء</button></span>`;
 };
 drawSaved();

 const renderGroups=async(groups,q,{withMore=false,my=seq}={})=>{disposeResults();out.innerHTML=groups.map(g=>groupHtml(g,q,{withMore})).join('')||`<div class="empty"><h3>لا نتائج مطابقة</h3><p>جرّب كلمات أقل أو جزءًا من الاسم، أو تحقق من الكتابة (أ/إ وة/ه تُعامل تلقائيًا كواحدة).</p></div>`;enhanceCollapsiblePanels(out,'search:results',{bulk:false});enhanceCollapsiblePanels(root,'search');await Promise.all(groups.map(group=>mountResultGrid(group,q,out.querySelector(`[data-group="${CSS.escape(group.store)}"] [data-search-grid]`),my)))};
 const renderIdle=()=>{disposeResults();out.innerHTML=idleHtml(app);enhanceCollapsiblePanels(out,'search:idle',{bulk:false});enhanceCollapsiblePanels(root,'search')};

 const run=async()=>{
  const q=input.value.trim();st.q=q;
  const my=++seq;
  drawSaved();
  if(q.length<2){
   status.textContent='اكتب حرفين على الأقل لبدء البحث الشامل — أو انتقل بالأسهم و Enter.';
   renderIdle();
   return;
  }
  const scoped=st.scope!=='all';
  const stores=scoped?[st.scope]:PRIMARY_STORES;
  const per=scoped?24:8;
  status.textContent='جارٍ البحث في '+(scoped?ENTITIES[st.scope]?.plural:'الأقسام الرئيسية')+'…';
  disposeResults();out.innerHTML='<div class="loading small">…</div>';
  let r=await searchAll(app.office,q,{stores,perStore:per});
  if(my!==seq)return;
  const groups=r.groups.map(g=>({...g,items:g.items.filter(periodFilter)})).filter(g=>g.items.length);
  await renderGroups(groups,q,{withMore:true,my});
  if(my!==seq)return;
  if(!scoped){
   const rest=allSearchStores().filter(s=>!PRIMARY_STORES.includes(s));
   status.textContent=`${groups.reduce((n,g)=>n+g.items.length,0)} نتيجة أولية — نتابع الآن في باقي الأقسام…`;
   r=await searchAll(app.office,q,{stores:rest,perStore:6});
   if(my!==seq)return;
   for(const g of r.groups.map(g=>({...g,items:g.items.filter(periodFilter)})).filter(g=>g.items.length))groups.push(g);
   await renderGroups(groups,q,{withMore:true,my});
   if(my!==seq)return;
  }
  const total=groups.reduce((n,g)=>n+g.items.length,0);
  status.textContent=total?`عُرضت ${total} نتيجة${r.tookMs!=null?` خلال ${r.tookMs<850?r.tookMs+'ms':(r.tookMs/1000).toFixed(1)+'s'}`:''} — Enter لحفظ البحث في السجل، ↑↓ للتنقل.`:'لم يتم العثور على نتائج مطابقة — جرّب كلمات أقل أو جزءًا من الاسم.';
 };

 const commit=()=>{pushHistory(input.value.trim());const p=new URLSearchParams();p.set('q',input.value.trim());if(st.scope!=='all')p.set('scope',st.scope);app.go('search?'+p.toString(),{replace:true}).then(()=>{const n=document.querySelector('#advanced-q');if(n){n.focus();n.setSelectionRange(n.value.length,n.value.length)}})};

 // عمليات بحث محفوظة + سجل
 savedBar.addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.matches('[data-save-search]')){savedBar.querySelector('.save-form').hidden=false;savedBar.querySelector('#save-name').focus()}
  else if(b.matches('[data-save-ok]')){saveSearch(savedBar.querySelector('#save-name').value,st.q);drawSaved();out.insertAdjacentHTML('afterbegin','');toastSaved('تم حفظ البحث')}
  else if(b.matches('[data-save-cancel]')){savedBar.querySelector('.save-form').hidden=true}
  else if(b.matches('[data-saved]')){const sv=getSavedSearches().find(x=>x.name===b.dataset.saved);if(sv){input.value=sv.q;run().catch(err=>app.fail(err))}}
  else if(b.matches('[data-saved-del]')){removeSavedSearch(b.dataset.savedDel);drawSaved()}
  else if(b.matches('[data-clear-history]')){clearHistory();renderIdle()}
  else if(b.matches('[data-hist]')){input.value=b.dataset.hist;run().catch(err=>app.fail(err))}
 });
 function toastSaved(m){import('../ui/toast.js').then(t=>t.toast(m,'ok'))}

 // «المزيد» داخل المجموعة
 out.addEventListener('click',async e=>{
  const open=e.target.closest('[data-search-open]');if(open){pushHistory(input.value.trim());app.go(open.dataset.searchOpen);return}
  const more=e.target.closest('[data-more-store]');if(!more)return;
  const store=more.dataset.moreStore,q=input.value.trim(),my=seq;
  resultGrids.get(store)?.destroy();resultGrids.delete(store);
  const sec=out.querySelector(`[data-group="${CSS.escape(store)}"] .group-rows`);
  if(sec)sec.innerHTML='<div class="loading small">…</div>';
  const r=await searchStore(app.office,store,q,{limit:24});
  if(my!==seq)return;
  const g={store,label:ENTITIES[store]?.plural||store,icon:(SEARCH_SOURCES.find(s=>s.store===store)||{}).icon||'file',items:r.items.filter(periodFilter),more:r.more,partial:false};
  const section=out.querySelector(`[data-group="${CSS.escape(store)}"]`);
  if(section){section.outerHTML=groupHtml(g,q,{withMore:true});await mountResultGrid(g,q,out.querySelector(`[data-group="${CSS.escape(store)}"] [data-search-grid]`),my)}
 });

 // فلاتر النطاق والفترة
 root.querySelectorAll('[data-scope]').forEach(b=>b.onclick=()=>{st.scope=b.dataset.scope;root.querySelectorAll('[data-scope]').forEach(x=>x.classList.toggle('active',x===b));syncFilterSummary();run().catch(err=>app.fail(err))});
 root.querySelector('#search-period').onchange=e=>{st.period=e.target.value;root.querySelector('.custom-range').hidden=st.period!=='custom';syncFilterSummary();run().catch(err=>app.fail(err))};
 root.querySelector('#search-from').onchange=e=>{st.from=e.target.value;syncFilterSummary();run().catch(err=>app.fail(err))};
 root.querySelector('#search-to').onchange=e=>{st.to=e.target.value;syncFilterSummary();run().catch(err=>app.fail(err))};

 // لوحة المفاتيح: ↑↓ للتنقل، Enter للفتح أو لحفظ البحث في السجل والمسار، Esc للمسح
 input.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(()=>run().catch(err=>app.fail(err)),250)});
 input.addEventListener('keydown',e=>{
  const items=[...out.querySelectorAll('.search-result,.dg tbody tr[data-i]')];
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){
   e.preventDefault();if(!items.length)return;
   const cur=items.findIndex(x=>x.classList.contains('kbd-focus'));
   const nx=items[e.key==='ArrowDown'?Math.min(items.length-1,cur+1):Math.max(0,cur<=0?0:cur-1)];
   // A grid result may be inside a collapsed result group/table. Reveal the
   // selected row temporarily through the existing collapse controller, without
   // changing pinned or saved preferences just to navigate search results.
   if(nx.closest('.dg'))for(let parent=nx.parentElement;parent;parent=parent.parentElement)if(parent.dataset.collapseReady==='true'&&parent.dataset.collapseCollapsed==='true')parent.dispatchEvent(new CustomEvent('collapse:bulk',{detail:{collapsed:false,persist:false}}));
   items.forEach(x=>x.classList.remove('kbd-focus'));nx.classList.add('kbd-focus');nx.scrollIntoView({block:'nearest'});
  }else if(e.key==='Enter'){
   e.preventDefault();
   const cur=items.find(x=>x.classList.contains('kbd-focus'))||items[0];
   if(cur)cur.click();else commit();
  }
 });
 clear.onclick=()=>{input.value='';seq++;clearTimeout(timer);st.q='';renderIdle();status.textContent='اكتب حرفين على الأقل لبدء البحث الشامل — أو انتقل بالأسهم و Enter.';input.focus()};
 root.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.activeElement===input&&input.value){clear.click()}});
 if(st.q.trim().length>=2){run().catch(err=>app.fail(err))}
 else{renderIdle();status.textContent='اكتب حرفين على الأقل لبدء البحث الشامل — أو انتقل بالأسهم و Enter.'}
 setTimeout(()=>input.focus(),30);
}
