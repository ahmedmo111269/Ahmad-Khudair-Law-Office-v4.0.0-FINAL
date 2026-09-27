import {generateReport,FIELD_DEFS,DEFAULT_COLUMNS,reportSummary} from '../services/reports.js';
import {esc} from '../ui/dom.js';

const types={hearings:'الجلسات',procedures:'الأعمال الإدارية',appointments:'المواعيد',communications:'الاتصالات',judgments:'الأحكام',expertReports:'تقارير الخبراء',execution:'التنفيذ',fees:'الأتعاب',files:'الملفات',cases:'القضايا',clients:'الموكلون',clientFiles:'ملفات موكل',clientCases:'قضايا موكل',caseHearings:'جلسات قضية',fileProcedures:'أعمال ملف'};
const ops=[['contains','يحتوي على'],['notContains','لا يحتوي على'],['startsWith','يبدأ بـ'],['equals','يساوي'],['notEquals','لا يساوي'],['gt','أكبر من'],['gte','أكبر من أو يساوي'],['lt','أصغر من'],['lte','أصغر من أو يساوي'],['isEmpty','فارغ'],['isNotEmpty','غير فارغ']];
const sortLabels=['الأقدم/الأصغر أولًا','الأحدث/الأكبر أولًا'];

export async function reportsPage(app,query=new URLSearchParams()){
 const type=query.get('type')||'hearings',preset=query.get('preset')||'today';
 const defs=FIELD_DEFS[type]||FIELD_DEFS.hearings;
 const cols=DEFAULT_COLUMNS[type]||[];
 return `<div class="page-head"><div><h2>مركز التقارير المتقدم</h2><p>اختيار البيانات ثم الشروط والفرز والتجميع والأعمدة والإخراج.</p></div><div class="head-actions"><button class="ghost" data-page-back>رجوع</button><button class="ghost" data-page-close>إغلاق</button></div></div>
 <section class="panel report-builder">
  <div class="filter-grid">
   <label>نوع التقرير<select id="report-type">${Object.entries(types).map(([k,v])=>`<option value="${k}" ${k===type?'selected':''}>${v}</option>`).join('')}</select></label>
   <label>الفترة<select id="report-preset">${[['today','اليوم'],['tomorrow','غدًا'],['week','هذا الأسبوع'],['nextWeek','الأسبوع التالي'],['month','هذا الشهر'],['nextMonth','الشهر التالي'],['custom','مخصص بين تاريخين'],['overdue','المتأخر (للأعمال الإدارية)']].map(([k,v])=>`<option value="${k}" ${k===preset?'selected':''}>${v}</option>`).join('')}</select></label>
   <label>من تاريخ<input id="report-from" type="date"></label><label>إلى تاريخ<input id="report-to" type="date"></label>
   ${['clientFiles','clientCases'].includes(type)?`<label class="wide">الموكل<input id="report-client" list="report-client-list" placeholder="اكتب اسم الموكل لاختيار سجل محدد…"><datalist id="report-client-list"></datalist><input id="report-client-id" type="hidden"></label>`:''}${type==='caseHearings'||type==='fileProcedures'?`<label class="wide">${type==='caseHearings'?'القضية':'الملف'}<input id="report-relation" list="report-relation-list" placeholder="اكتب للبحث…"><datalist id="report-relation-list"></datalist><input id="report-relation-id" type="hidden"></label>`:''}
  </div>
  <details open><summary>الشروط المركبة</summary><div class="report-conditions" id="report-conditions"></div><div class="report-builder-actions"><button class="ghost" id="add-condition">+ شرط</button><select id="condition-logic"><option value="AND">كل الشروط (AND)</option><option value="OR">أي شرط (OR)</option></select></div></details>
  <details><summary>الفرز المتعدد</summary><div id="report-sorts"></div><button class="ghost" id="add-sort">+ مستوى فرز</button></details>
  <details><summary>الأعمدة والتجميع</summary><div class="report-columns" id="report-columns">${cols.map(c=>`<label><input type="checkbox" data-column="${c}" checked> ${esc(fieldLabel(defs,c))}</label>`).join('')}</div><div class="filter-grid"><label>التجميع حسب<select id="report-group"><option value="">بدون تجميع</option>${defs.map(([f,l])=>`<option value="${f}">${esc(l)}</option>`).join('')}</select></label><label>عنوان التقرير<input id="report-title" placeholder="يترك فارغًا لاستخدام العنوان الافتراضي"></label></div></details>
  <div class="filter-actions"><button class="primary" id="generate-report">إنشاء التقرير</button><button class="ghost" id="clear-report-filters">إعادة ضبط</button></div>
 </section><section class="panel" id="report-result"><p class="muted">حدد الشروط ثم اضغط «إنشاء التقرير».</p></section></div>`;
}

export function bindReports(app){
 const $=s=>document.querySelector(s), result=$('#report-result');
 const typeEl=$('#report-type');
 const resetPeriod=()=>{const custom=$('#report-preset')?.value==='custom';if($('#report-from'))$('#report-from').disabled=!custom;if($('#report-to'))$('#report-to').disabled=!custom};
 typeEl?.addEventListener('change',()=>app.refresh());
 $('#report-preset')?.addEventListener('change',resetPeriod);resetPeriod();
 buildConditions();buildSorts();
 $('#add-condition')?.addEventListener('click',()=>{addCondition();});
 $('#add-sort')?.addEventListener('click',()=>{addSort();});
 $('#generate-report')?.addEventListener('click',()=>runReport(app));
 $('#clear-report-filters')?.addEventListener('click',()=>app.refresh());
 $('#report-client')?.addEventListener('input',async e=>{const q=e.target.value.trim();const list=$('#report-client-list');if(q.length<2){list.innerHTML='';$('#report-client-id').value='';return}const rows=await app.office.r.clients.prefix('fullNameNormalized',normalize(q),10);list.innerHTML=rows.map(x=>`<option value="${esc(x.fullName)}" data-id="${esc(x.id)}"></option>`).join('');const hit=rows.find(x=>x.fullName===q);if(hit)$('#report-client-id').value=hit.id;});
 $('#report-client')?.addEventListener('change',e=>{const opt=[...$('#report-client-list').options].find(o=>o.value===e.target.value);$('#report-client-id').value=opt?.dataset.id||''});
 $('#report-relation')?.addEventListener('input',async e=>{const q=e.target.value.trim(),list=$('#report-relation-list'),isCase=$('#report-type').value==='caseHearings';if(q.length<2){list.innerHTML='';$('#report-relation-id').value='';return}const repo=isCase?app.office.r.cases:app.office.r.files;const index=isCase?'caseNumber':'titleNormalized';const value=isCase?q.replace(/\D/g,''):normalize(q);const rows=await repo.prefix(index,value,10);list.innerHTML=rows.map(x=>`<option value="${esc(isCase?`${x.caseNumber||''}/${x.caseYear||''} — ${x.courtId||''}`:`${x.fileNumber||''} — ${x.title||''}`)}" data-id="${esc(x.id)}"></option>`).join('');});
 $('#report-relation')?.addEventListener('change',e=>{const opt=[...$('#report-relation-list').options].find(o=>o.value===e.target.value);$('#report-relation-id').value=opt?.dataset.id||''});
 document.querySelector('[data-page-back]')?.addEventListener('click',()=>app.back());document.querySelector('[data-page-close]')?.addEventListener('click',()=>app.go('dashboard'));
 function buildConditions(){const root=$('#report-conditions');if(!root)return;root.innerHTML='';addCondition();}
 function addCondition(){const root=$('#report-conditions'),defs=FIELD_DEFS[$('#report-type').value]||FIELD_DEFS.hearings;const div=document.createElement('div');div.className='report-condition';div.innerHTML=`<select data-c-field>${defs.map(([f,l])=>`<option value="${f}">${esc(l)}</option>`).join('')}</select><select data-c-op>${ops.map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select><input data-c-value placeholder="القيمة"><button class="danger ghost" data-remove-condition>حذف</button>`;div.querySelector('[data-remove-condition]').onclick=()=>{if(root.children.length>1)div.remove()};root.appendChild(div)}
 function buildSorts(){const root=$('#report-sorts');if(!root)return;root.innerHTML='';addSort();}
 function addSort(){const root=$('#report-sorts'),defs=FIELD_DEFS[$('#report-type').value]||FIELD_DEFS.hearings;const div=document.createElement('div');div.className='report-sort-row';div.innerHTML=`<select data-s-field>${defs.map(([f,l])=>`<option value="${f}">${esc(l)}</option>`).join('')}</select><select data-s-direction><option value="asc">${sortLabels[0]}</option><option value="desc">${sortLabels[1]}</option></select><button class="danger ghost" data-remove-sort>حذف</button>`;div.querySelector('[data-remove-sort]').onclick=()=>{if(root.children.length>1)div.remove()};root.appendChild(div)}
 async function runReport(app){
  const type=$('#report-type').value,preset=$('#report-preset').value;
  const conditions=[...document.querySelectorAll('.report-condition')].map(x=>({field:x.querySelector('[data-c-field]').value,operator:x.querySelector('[data-c-op]').value,value:x.querySelector('[data-c-value]').value}));
  const sorts=[...document.querySelectorAll('.report-sort-row')].map(x=>({field:x.querySelector('[data-s-field]').value,direction:x.querySelector('[data-s-direction]').value}));
  const columns=[...document.querySelectorAll('[data-column]:checked')].map(x=>x.dataset.column);
  if(!columns.length){result.innerHTML='<div class="error-box">اختر عمودًا واحدًا على الأقل.</div>';return}
  if(['clientFiles','clientCases'].includes(type)&&!$('#report-client-id')?.value){result.innerHTML='<div class="error-box">اختر موكلًا محددًا أولًا.</div>';return}if(['caseHearings','fileProcedures'].includes(type)&&!$('#report-relation-id')?.value){result.innerHTML='<div class="error-box">اختر السجل المرتبط أولًا.</div>';return}
  result.innerHTML='<div class="loading">جارٍ إنشاء التقرير…</div>';
  try{const r=await generateReport(app.office,{type,preset,from:$('#report-from')?.value,to:$('#report-to')?.value,conditions,conditionLogic:$('#condition-logic').value,sorts,groupBy:$('#report-group').value,columns,limit:5000,clientId:$('#report-client-id')?.value,relationId:$('#report-relation-id')?.value});r.title=$('#report-title')?.value.trim()||r.title;renderResult(r,result)}catch(e){result.innerHTML=`<div class="error-box">${esc(e.message||e)}</div>`}
 }
}

function fieldLabel(defs,key){return defs.find(x=>x[0]===key)?.[1]||key}
function normalize(s){return String(s||'').replace(/[أإآٱ]/g,'ا').replace(/ى/g,'ي').replace(/[\u064B-\u065F\u0670]/g,'').replace(/ـ/g,'').replace(/\s+/g,' ').trim()}
function formatValue(v){if(v===true)return'نعم';if(v===false)return'لا';return v==null?'':String(v)}
function renderResult(r,root){
 const defs=FIELD_DEFS[r.type]||FIELD_DEFS.hearings,labels=Object.fromEntries(defs.map(x=>[x[0],x[1]])),cols=r.columns,summary=reportSummary(r.rows,cols);
 const rowsHtml=r.groupBy&&r.groups? r.groups.map(g=>`<tr class="group-row"><th colspan="${cols.length}">${esc(labels[r.groupBy]||r.groupBy)}: ${esc(g.key)} — ${g.items.length} سجل</th></tr>${g.items.map(rowHtml).join('')}`).join('') : r.rows.map(rowHtml).join('');
 function rowHtml(x){return `<tr>${cols.map(c=>`<td>${esc(formatValue(x[c]))}</td>`).join('')}</tr>`}
 root.innerHTML=`<div class="report-head"><div><h3>${esc(r.title)}</h3><p class="muted">الفترة: ${esc(r.from)} إلى ${esc(r.to)} · النتائج: ${r.rows.length}${r.rows.length>=r.limit?' · تم بلوغ حد العرض 5000':''}</p></div><div class="report-actions"><button data-export="txt">TXT</button><button data-export="word">Word</button><button data-export="excel">Excel</button><button data-export="pdf">PDF</button><button data-share="whatsapp">واتساب</button><button data-share="telegram">تليجرام</button></div></div><div class="report-summary"><strong>عدد السجلات: ${summary.count}</strong>${Object.entries(summary.totals).map(([k,v])=>`<span>${esc(labels[k]||k)}: ${v}</span>`).join('')}</div><div class="table-wrap"><table id="report-table"><thead><tr>${cols.map(c=>`<th>${esc(labels[c]||c)}</th>`).join('')}</tr></thead><tbody>${rowsHtml}</tbody></table></div>`;
 const payload=JSON.stringify({title:r.title,cols,labels,rows:r.rows,from:r.from,to:r.to,groupBy:r.groupBy});root.dataset.report=payload;root.querySelectorAll('[data-export]').forEach(b=>b.onclick=()=>exportReport(root.dataset.report,b.dataset.export));root.querySelector('[data-share="whatsapp"]')?.addEventListener('click',()=>shareReport(root.dataset.report,'whatsapp'));root.querySelector('[data-share="telegram"]')?.addEventListener('click',()=>shareReport(root.dataset.report,'telegram'));
}
function dataObj(json){return JSON.parse(json)}
function reportText(r){const lines=[r.title,`الفترة: ${r.from} إلى ${r.to}`,`عدد السجلات: ${r.rows.length}`,'',r.cols.map(c=>r.labels[c]||c).join('\t')];return lines.concat(r.rows.map(x=>r.cols.map(c=>formatValue(x[c])).join('\t'))).join('\n')}
function download(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
function exportReport(json,kind){const r=dataObj(json),text=reportText(r),base='تقرير-'+new Date().toISOString().slice(0,10);if(kind==='txt')download(new Blob(['\ufeff'+text],{type:'text/plain;charset=utf-8'}),base+'.txt');else if(kind==='word'){const html=`<!doctype html><html dir="rtl"><meta charset="utf-8"><h2>${esc(r.title)}</h2><p>${esc(r.from)} — ${esc(r.to)}</p><table border="1"><tr>${r.cols.map(c=>`<th>${esc(r.labels[c]||c)}</th>`).join('')}</tr>${r.rows.map(x=>`<tr>${r.cols.map(c=>`<td>${esc(formatValue(x[c]))}</td>`).join('')}</tr>`).join('')}</table></html>`;download(new Blob(['\ufeff'+html],{type:'application/msword'}),base+'.doc');}else if(kind==='excel'){const html=`<html dir="rtl"><meta charset="utf-8"><table border="1"><tr>${r.cols.map(c=>`<th>${esc(r.labels[c]||c)}</th>`).join('')}</tr>${r.rows.map(x=>`<tr>${r.cols.map(c=>`<td>${esc(formatValue(x[c]))}</td>`).join('')}</tr>`).join('')}</table></html>`;download(new Blob(['\ufeff'+html],{type:'application/vnd.ms-excel'}),base+'.xls');}else if(kind==='pdf')window.print()}
function shareReport(json,where){const r=dataObj(json),t=reportText(r),short=t.length>3500?t.slice(0,3500)+'…':t,u=where==='whatsapp'?`https://wa.me/?text=${encodeURIComponent(short)}`:`https://t.me/share/url?url=&text=${encodeURIComponent(short)}`;window.open(u,'_blank','noopener,noreferrer')}
