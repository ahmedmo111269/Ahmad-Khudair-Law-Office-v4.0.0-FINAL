import {unifiedSearch} from '../services/search.js';
import {esc} from '../ui/dom.js';
import {highlightMatch} from '../ui/palette.js';
import {getRecent} from '../services/recents.js';
import {icon,ROUTE_ICONS} from '../ui/icons.js';

const TYPES=[['all','الكل'],['clients','الموكلون'],['files','الملفات'],['cases','القضايا'],['opponents','الخصوم']];
const TYPE_ROUTE={clients:'client',files:'file',cases:'case',opponents:'opponent'};
const TYPE_ICON={clients:'users',files:'folder',cases:'gavel',opponents:'userX'};
const title=x=>x.fullName||(x.fileNumber?`${x.fileNumber} — ${x.title||''}`:x.title)||x.name||x.caseNumber||x.subject||'بدون عنوان';
const meta=(type,x)=>{
 if(type==='clients') return [x.clientCode,x.nationalId&&`رقم قومي: ${x.nationalId}`,x.phone||x.phone1].filter(Boolean).join(' — ');
 if(type==='files') return [x.fileNumber,x.fileType||x.workType,x.status,x.partyNames].filter(Boolean).join(' — ');
 if(type==='cases') return [x.stageType||x.numberType,x.caseNumber&&`رقم ${x.caseNumber}`,x.caseYear,x.courtId,x.status].filter(Boolean).join(' / ');
 return [x.capacity,x.phone].filter(Boolean).join(' — ');
};
const hl=(t,q)=>highlightMatch(t,q).map(p=>p.hl?`<mark>${esc(p.t)}</mark>`:esc(p.t)).join('');
function resultRow(type,x,q){
 const r=`${TYPE_ROUTE[type]}:${x.id}`;
 const action=r?`<button class="link" data-search-open="${esc(r)}">فتح السجل</button>`:'<span class="muted">عرض</span>';
 return `<div class="search-result"><span class="sr-ic" aria-hidden="true">${icon(TYPE_ICON[type]||'file')}</span><div><b>${hl(title(x),q)}</b><small>${esc(meta(type,x)||'')}</small></div>${action}</div>`;
}
function group(type,label,rows,q){return `<section class="search-group"><div class="section-head"><h3>${label}</h3><span class="badge">${rows.length}</span></div>${rows.length?rows.map(x=>resultRow(type,x,q)).join(''):'<p class="muted">لا نتائج.</p>'}</section>`}
function recentsHtml(){
 const rows=getRecent().slice(0,6);
 if(!rows.length)return '';
 return `<section class="search-group"><div class="section-head"><h3>آخر ما فُتح</h3></div><div class="recents-chips">${rows.map(x=>`<button class="recent-chip" data-search-open="${esc(x.route)}"><span aria-hidden="true">↗</span> ${esc(x.title)}</button>`).join('')}</div></section>`;
}

export async function renderSearch(app){return `<div class="page-head"><div><h2>البحث الموحد</h2><p>بحث مفهرس داخل قاعدة البيانات الحالية، مع انتقال مباشر إلى السجلات والعلاقات.</p></div><div class="head-actions"><button class="ghost" data-page-back>رجوع</button><button class="ghost" data-page-close>إغلاق</button></div></div><section class="panel search-panel"><div class="toolbar search-toolbar"><input id="advanced-q" minlength="2" autocomplete="off" autofocus placeholder="اسم موكل، رقم قومي، رقم قضية، رقم ملف، اسم خصم…"><button class="ghost" id="search-clear">مسح</button></div><div class="filter-tabs" id="search-types">${TYPES.map(([v,l],i)=>`<button class="${i===0?'active':''}" data-search-type="${v}">${l}</button>`).join('')}</div><div id="advanced-status" class="muted">اكتب حرفين على الأقل لبدء البحث — أو انتقل بـ ↑↓ و Enter.</div><div id="advanced-results"></div></section>`}

export function bindSearch(app){
 const input=document.querySelector('#advanced-q'),out=document.querySelector('#advanced-results'),status=document.querySelector('#advanced-status'),clear=document.querySelector('#search-clear');
 let timer=0,seq=0,type='all';
 const render=(r,q)=>{const groups=type==='all'?[group('clients','الموكلون',r.clients,q),group('files','الملفات',r.files,q),group('cases','القضايا',r.cases,q),group('opponents','الخصوم',r.opponents,q)]:group(type,{clients:'الموكلون',files:'الملفات',cases:'القضايا',opponents:'الخصوم'}[type],r[type],q);out.innerHTML=groups;};
 const run=async()=>{
  const q=input.value.trim();clearTimeout(timer);const my=++seq;
  if(q.length<2){status.textContent='اكتب حرفين على الأقل لبدء البحث — أو انتقل بـ ↑↓ و Enter.';out.innerHTML=recentsHtml();return}
  status.textContent='جارٍ البحث…';
  timer=setTimeout(async()=>{
   try{
    const r=await unifiedSearch(app.office,q,15);if(my!==seq)return;
    const total=r.clients.length+r.files.length+r.cases.length+r.opponents.length;
    status.textContent=total?`تم العثور على ${total} نتيجة في قاعدة البيانات الحالية.`:'لم يتم العثور على نتائج مطابقة — تأكد من الكتابة (أ/إ/آ وة/ه تُعامل كواحدة).';
    render(r,q);
   }catch(e){if(my!==seq)return;status.textContent='تعذر تنفيذ البحث.';out.innerHTML=`<div class="error-box">${esc(e.message||e)}</div>`}
  },180);
 };
 input?.addEventListener('input',run);
 input?.addEventListener('keydown',e=>{
  const items=[...out.querySelectorAll('[data-search-open]')];
  if(!items.length)return;
  const cur=items.findIndex(x=>x.classList.contains('kbd-focus'));
  if(e.key==='ArrowDown'){e.preventDefault();const nx=items[Math.max(0,cur+1)]||items[0];items.forEach(x=>x.classList.remove('kbd-focus'));nx.classList.add('kbd-focus');nx.scrollIntoView({block:'nearest'})}
  else if(e.key==='ArrowUp'){e.preventDefault();const nx=items[Math.max(0,cur-1)]||items[0];items.forEach(x=>x.classList.remove('kbd-focus'));nx.classList.add('kbd-focus');nx.scrollIntoView({block:'nearest'})}
  else if(e.key==='Enter'){e.preventDefault();(items.find(x=>x.classList.contains('kbd-focus'))||items[0]).click()}
 });
 clear?.addEventListener('click',()=>{input.value='';seq++;out.innerHTML=recentsHtml();status.textContent='اكتب حرفين على الأقل لبدء البحث.';input.focus()});
 document.querySelectorAll('[data-search-type]').forEach(b=>b.addEventListener('click',()=>{type=b.dataset.searchType;document.querySelectorAll('[data-search-type]').forEach(x=>x.classList.toggle('active',x===b));run()}));
 out?.addEventListener('click',e=>{const b=e.target.closest('[data-search-open]');if(b)app.go(b.dataset.searchOpen)});
 // الحالة الفارغة: آخر ما فُتح بدل شاشة بيضاء
 out.innerHTML=recentsHtml();
 setTimeout(()=>input?.focus(),30);
}
