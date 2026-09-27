import {unifiedSearch} from '../services/search.js';
import {esc} from '../ui/dom.js';

const TYPES=[['all','الكل'],['clients','الموكلون'],['files','الملفات'],['cases','القضايا'],['opponents','الخصوم']];
const title=x=>x.fullName||x.title||x.name||x.caseNumber||x.subject||'بدون عنوان';
const meta=(type,x)=>{
 if(type==='clients') return [x.nationalId&&`رقم قومي: ${x.nationalId}`,x.phone||x.phone1].filter(Boolean).join(' — ');
 if(type==='files') return [x.fileNumber,x.workType,x.status].filter(Boolean).join(' — ');
 if(type==='cases') return [x.caseNumber&&`قضية ${x.caseNumber}`,x.caseYear,x.courtId,x.status].filter(Boolean).join(' / ');
 return [x.capacity,x.phone].filter(Boolean).join(' — ');
};
const route=(type,id)=>({clients:'client',files:'file',cases:'case'}[type]||'')[type==='opponents'?0?'':'':0];
function resultRow(type,x){
 const r=type==='clients'?`client:${x.id}`:type==='files'?`file:${x.id}`:type==='cases'?`case:${x.id}`:'';
 const action=r?`<button class="link" data-search-open="${esc(r)}">فتح السجل</button>`:`<span class="muted">عرض</span>`;
 return `<div class="search-result"><div><b>${esc(title(x))}</b><small>${esc(meta(type,x)||'')}</small></div>${action}</div>`;
}
function group(type,label,rows){return `<section class="search-group"><div class="section-head"><h3>${label}</h3><span class="badge">${rows.length}</span></div>${rows.length?rows.map(x=>resultRow(type,x)).join(''):'<p class="muted">لا نتائج.</p>'}</section>`}

export async function renderSearch(app){return `<div class="page-head"><div><h2>البحث الموحد</h2><p>بحث مفهرس داخل قاعدة البيانات الحالية، مع انتقال مباشر إلى السجلات والعلاقات.</p></div><div class="head-actions"><button class="ghost" data-page-back>رجوع</button><button class="ghost" data-page-close>إغلاق</button></div></div><section class="panel search-panel"><div class="toolbar search-toolbar"><input id="advanced-q" minlength="2" autocomplete="off" autofocus placeholder="اسم موكل، رقم قومي، رقم قضية، رقم ملف، اسم خصم…"><button class="ghost" id="search-clear">مسح</button></div><div class="filter-tabs" id="search-types">${TYPES.map(([v,l],i)=>`<button class="${i===0?'active':''}" data-search-type="${v}">${l}</button>`).join('')}</div><div id="advanced-status" class="muted">اكتب حرفين على الأقل لبدء البحث.</div><div id="advanced-results"></div></section>`}

export function bindSearch(app){
 const input=document.querySelector('#advanced-q'),out=document.querySelector('#advanced-results'),status=document.querySelector('#advanced-status'),clear=document.querySelector('#search-clear');
 let timer=0,seq=0,type='all';
 const render=r=>{const groups=type==='all'?[group('clients','الموكلون',r.clients),group('files','الملفات',r.files),group('cases','القضايا',r.cases),group('opponents','الخصوم',r.opponents)]:group(type,{clients:'الموكلون',files:'الملفات',cases:'القضايا',opponents:'الخصوم'}[type],r[type]);out.innerHTML=groups;};
 const run=async()=>{const q=input.value.trim();clearTimeout(timer);const my=++seq;if(q.length<2){status.textContent='اكتب حرفين على الأقل لبدء البحث.';out.innerHTML='';return}status.textContent='جارٍ البحث…';timer=setTimeout(async()=>{try{const r=await unifiedSearch(app.office,q,15);if(my!==seq)return;const total=r.clients.length+r.files.length+r.cases.length+r.opponents.length;status.textContent=total?`تم العثور على ${total} نتيجة في قاعدة البيانات الحالية.`:'لم يتم العثور على نتائج مطابقة.';render(r)}catch(e){if(my!==seq)return;status.textContent='تعذر تنفيذ البحث.';out.innerHTML=`<div class="error-box">${esc(e.message||e)}</div>`}},180)};
 input?.addEventListener('input',run);
 clear?.addEventListener('click',()=>{input.value='';seq++;out.innerHTML='';status.textContent='اكتب حرفين على الأقل لبدء البحث.';input.focus()});
 document.querySelectorAll('[data-search-type]').forEach(b=>b.addEventListener('click',()=>{type=b.dataset.searchType;document.querySelectorAll('[data-search-type]').forEach(x=>x.classList.toggle('active',x===b));run()}));
 out?.addEventListener('click',e=>{const b=e.target.closest('[data-search-open]');if(b)app.go(b.dataset.searchOpen)});
}
