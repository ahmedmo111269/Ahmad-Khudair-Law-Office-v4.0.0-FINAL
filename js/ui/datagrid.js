// جدول بيانات عام بأسلوب Microsoft Access:
// فرز من رأس العمود (Shift للفرز المتعدد)، تصفية لكل عمود (شرط + قائمة القيم المميزة)، تصفية مركّبة و/أو،
// تجميع حسب عمود، اختيار الأعمدة، عرض تدريجي للصفوف، طباعة، وتصدير Excel/Word/CSV/TXT. تمرير أفقي ورأسي مع رأس ثابت.
import {esc} from './dom.js';
import {normalizeArabic} from '../core/search-normalizer.js';
import {APP_NAME} from '../core/constants.js';

const OPS={
 text:[['contains','يحتوي'],['notContains','لا يحتوي'],['eq','يساوي'],['neq','لا يساوي'],['starts','يبدأ بـ'],['ends','ينتهي بـ'],['empty','فارغ'],['notEmpty','غير فارغ']],
 number:[['eq','='],['neq','≠'],['gt','أكبر من'],['gte','أكبر من أو يساوي'],['lt','أصغر من'],['lte','أصغر من أو يساوي'],['between','بين'],['empty','فارغ'],['notEmpty','غير فارغ']],
 date:[['eq','في يوم'],['before','قبل'],['after','بعد'],['between','بين'],['empty','فارغ'],['notEmpty','غير فارغ']],
 bool:[['isTrue','نعم'],['isFalse','لا'],['empty','فارغ']]
};
const NOVAL=['empty','notEmpty','isTrue','isFalse'];
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
  switch(op){case'eq':return d===v1;case'before':return Boolean(d)&&d<v1;case'after':return d>v1;case'between':{const [a,b]=[v1||'0000',v2||'9999'].sort();return Boolean(d)&&d>=a&&d<=b}case'empty':return !d;case'notEmpty':return Boolean(d)}
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
 const o={title:'',emptyText:'لا توجد سجلات.',pageSize:300,storageKey:'',onRowClick:null,...opts};
 const cols=o.columns.map(c=>({type:'text',get:r=>r[c.key],text:r=>String(c.get?c.get(r)??'':r[c.key]??''),...c}));
 const byKey=new Map(cols.map(c=>[c.key,c]));
 let rows=o.rows||[];
 const saved=(()=>{try{return JSON.parse(localStorage.getItem('grid:'+o.storageKey)||'null')}catch{return null}})();
 const st={sort:[],filters:new Map(),adv:{logic:'and',rules:[]},quick:'',groupBy:'',hidden:new Set(saved?.hidden||cols.filter(c=>c.hidden).map(c=>c.key)),shown:o.pageSize,cards:false};
 let view=[];
 root.classList.add('dg');
 root.innerHTML=`<div class="dg-toolbar">
  <input class="dg-quick" type="search" placeholder="تصفية داخل النتائج…" aria-label="تصفية داخل النتائج">
  <button type="button" class="ghost dg-adv-btn">تصفية مركّبة</button>
  <label class="dg-group-lbl">تجميع حسب <select class="dg-groupby"><option value="">بدون</option>${cols.map(c=>`<option value="${esc(c.key)}">${esc(c.label)}</option>`).join('')}</select></label>
  <button type="button" class="ghost dg-cols-btn">الأعمدة</button>
  <button type="button" class="ghost dg-cards-btn" title="تبديل العرض">بطاقات</button>
  <button type="button" class="ghost dg-clear" hidden>مسح التصفية</button>
  <span class="dg-count" aria-live="polite"></span>
  <span class="dg-spacer"></span>
  <button type="button" class="ghost dg-print">طباعة</button>
  <select class="dg-export" aria-label="تصدير"><option value="">تصدير…</option><option value="xls">Excel</option><option value="doc">Word</option><option value="csv">CSV</option><option value="txt">نص TXT</option></select>
 </div>
 <div class="dg-adv" hidden></div>
 <div class="dg-scroll" tabindex="0"><table class="dg-table"><thead></thead><tbody></tbody></table></div>
 <div class="dg-more"></div>`;
 const $=s=>root.querySelector(s);
 const visibleCols=()=>cols.filter(c=>!st.hidden.has(c.key));
 const persist=()=>{if(o.storageKey)try{localStorage.setItem('grid:'+o.storageKey,JSON.stringify({hidden:[...st.hidden]}))}catch{}};

 function compute(){
  const q=n(st.quick);
  const vc=cols;
  let out=rows.filter(r=>{
   if(q&&!vc.some(c=>n(c.text(r)).includes(q)))return false;
   for(const [k,f] of st.filters){const c=byKey.get(k);if(!c)continue;if(f.set&&!f.set.has(c.text(r)||EMPTY))return false;if(f.op&&(NOVAL.includes(f.op)||f.v1!==''||f.v2!=='')&&!testOp(c,r,f.op,f.v1,f.v2))return false}
   const rules=st.adv.rules.filter(x=>byKey.get(x.key)&&(NOVAL.includes(x.op)||x.v1!==''));
   if(rules.length){const res=rules.map(x=>testOp(byKey.get(x.key),r,x.op,x.v1,x.v2));if(st.adv.logic==='or'?!res.some(Boolean):!res.every(Boolean))return false}
   return true;
  });
  const sorts=st.sort.map(s=>({c:byKey.get(s.key),d:s.dir==='desc'?-1:1})).filter(s=>s.c);
  const g=st.groupBy&&byKey.get(st.groupBy);
  out.sort((a,b)=>{if(g){const x=cmp(g,a,b);if(x)return x}for(const s of sorts){const x=cmp(s.c,a,b)*s.d;if(x)return x}return 0});
  view=out;
 }
 function renderHead(){
  const sortMark=k=>{const i=st.sort.findIndex(s=>s.key===k);if(i<0)return '';return `<span class="dg-sortmark">${st.sort[i].dir==='asc'?'▲':'▼'}${st.sort.length>1?i+1:''}</span>`};
  $('thead').innerHTML=`<tr>${visibleCols().map(c=>`<th data-key="${esc(c.key)}" class="${st.filters.has(c.key)?'dg-filtered':''}"><div class="dg-th"><button type="button" class="dg-sort" title="فرز (Shift للفرز المتعدد)">${esc(c.label)} ${sortMark(c.key)}</button><button type="button" class="dg-fbtn" aria-label="تصفية ${esc(c.label)}" title="تصفية وفرز">▾</button></div></th>`).join('')}</tr>`;
 }
 function cellHtml(c,r){const t=c.text(r);return `<td data-label="${esc(c.label)}"${c.type==='number'?' class="num"':''}>${esc(t)}</td>`}
 function renderBody(){
  const vc=visibleCols();
  const shown=view.slice(0,st.shown);
  const g=st.groupBy&&byKey.get(st.groupBy);
  let html='',last=null;
  const counts=g?view.reduce((m,r)=>{const k=g.text(r)||EMPTY;m.set(k,(m.get(k)||0)+1);return m},new Map()):null;
  shown.forEach((r,i)=>{
   if(g){const k=g.text(r)||EMPTY;if(k!==last){html+=`<tr class="dg-grouprow"><th colspan="${vc.length}">${esc(g.label)}: ${esc(k)} <small>(${counts.get(k)})</small></th></tr>`;last=k}}
   html+=`<tr data-i="${i}" tabindex="0"${o.onRowClick?' class="dg-click"':''}>${vc.map(c=>cellHtml(c,r)).join('')}</tr>`;
  });
  if(!view.length)html=`<tr><td colspan="${Math.max(1,vc.length)}" class="dg-empty">${esc(rows.length?'لا توجد صفوف مطابقة للتصفية.':o.emptyText)}</td></tr>`;
  $('tbody').innerHTML=html;
  $('.dg-count').textContent=view.length===rows.length?`${rows.length} سجل`:`${view.length} من ${rows.length} سجل`;
  const rest=view.length-shown.length;
  $('.dg-more').innerHTML=rest>0?`<button type="button" class="ghost dg-showmore">عرض ${Math.min(rest,o.pageSize)} صف إضافي (متبقٍ ${rest})</button>`:'';
  $('.dg-clear').hidden=!(st.filters.size||st.adv.rules.length||st.quick||st.sort.length);
  root.classList.toggle('dg-cards',st.cards);
  $('.dg-cards-btn').textContent=st.cards?'جدول':'بطاقات';
 }
 function render(){compute();renderHead();renderBody()}

 // ===== أحداث =====
 let qt=0;
 $('.dg-quick').addEventListener('input',e=>{clearTimeout(qt);qt=setTimeout(()=>{st.quick=e.target.value;st.shown=o.pageSize;compute();renderBody()},120)});
 $('.dg-groupby').addEventListener('change',e=>{st.groupBy=e.target.value;render()});
 $('.dg-clear').addEventListener('click',()=>{st.filters.clear();st.adv.rules=[];st.quick='';st.sort=[];$('.dg-quick').value='';renderAdv();render()});
 $('.dg-cards-btn').addEventListener('click',()=>{st.cards=!st.cards;renderBody()});
 $('.dg-print').addEventListener('click',()=>printGrid());
 $('.dg-export').addEventListener('change',e=>{const v=e.target.value;e.target.value='';if(v)exportGrid(v)});
 $('.dg-more').addEventListener('click',e=>{if(e.target.closest('.dg-showmore')){st.shown+=o.pageSize;renderBody()}});
 $('thead').addEventListener('click',e=>{
  const th=e.target.closest('th');if(!th)return;const key=th.dataset.key;
  if(e.target.closest('.dg-fbtn')){openFilter(th,key);return}
  if(e.target.closest('.dg-sort')){
   const i=st.sort.findIndex(s=>s.key===key);
   if(e.shiftKey){if(i<0)st.sort.push({key,dir:'asc'});else if(st.sort[i].dir==='asc')st.sort[i].dir='desc';else st.sort.splice(i,1)}
   else{const cur=i>=0?st.sort[i].dir:null;st.sort=cur==='asc'?[{key,dir:'desc'}]:cur==='desc'?[]:[{key,dir:'asc'}]}
   render();
  }
 });
 const clickRow=tr=>{const r=view[Number(tr.dataset.i)];if(r&&o.onRowClick)o.onRowClick(r)};
 $('tbody').addEventListener('click',e=>{const tr=e.target.closest('tr[data-i]');if(tr)clickRow(tr)});
 $('tbody').addEventListener('keydown',e=>{if(e.key==='Enter'){const tr=e.target.closest('tr[data-i]');if(tr)clickRow(tr)}});

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
  const distinct=new Map();for(const r of rows){const t=c.text(r)||EMPTY;distinct.set(t,(distinct.get(t)||0)+1)}
  const values=[...distinct.entries()].sort((a,b)=>String(a[0]).localeCompare(String(b[0]),'ar',{numeric:true})).slice(0,1000);
  pop=document.createElement('div');pop.className='dg-pop';pop.setAttribute('role','dialog');pop.setAttribute('aria-label','تصفية '+c.label);
  pop.innerHTML=`<div class="dg-pop-head"><b>${esc(c.label)}</b><button type="button" class="link dg-x" aria-label="إغلاق">✕</button></div>
   <div class="dg-pop-sort"><button type="button" class="ghost" data-dir="asc">فرز تصاعدي ▲</button><button type="button" class="ghost" data-dir="desc">فرز تنازلي ▼</button></div>
   <label class="dg-pop-cond">شرط<select class="dg-op">${OPS[type].map(([v,l])=>`<option value="${v}"${v===f.op?' selected':''}>${l}</option>`).join('')}</select></label><div class="dg-vals">${valueInputs(type,f.op,f.v1,f.v2)}</div>
   <div class="dg-pop-list"><input type="search" class="dg-lsearch" placeholder="بحث في القيم…"><label class="dg-all"><input type="checkbox" class="dg-allbox" ${!f.set?'checked':''}> تحديد الكل</label><div class="dg-checks">${values.map(([v,cnt])=>`<label><input type="checkbox" value="${esc(v)}" ${!f.set||f.set.has(v)?'checked':''}> <span>${esc(v)}</span> <small>${cnt}</small></label>`).join('')}</div>${distinct.size>1000?'<small class="muted">تُعرض أول 1000 قيمة.</small>':''}</div>
   <div class="dg-pop-actions"><button type="button" class="primary dg-apply">تطبيق</button><button type="button" class="ghost dg-reset">مسح تصفية العمود</button></div>`;
  place(pop,th);
  const q=s=>pop.querySelector(s);
  q('.dg-x').onclick=closePop;
  pop.querySelectorAll('[data-dir]').forEach(b=>b.onclick=()=>{st.sort=[{key,dir:b.dataset.dir}];closePop();render()});
  q('.dg-op').onchange=e=>{q('.dg-vals').innerHTML=valueInputs(type,e.target.value,q('.dg-v1')?.value||'',q('.dg-v2')?.value||'')};
  q('.dg-lsearch').oninput=e=>{const s=n(e.target.value);pop.querySelectorAll('.dg-checks label').forEach(l=>l.hidden=Boolean(s)&&!n(l.textContent).includes(s))};
  q('.dg-allbox').onchange=e=>pop.querySelectorAll('.dg-checks label:not([hidden]) input').forEach(i=>i.checked=e.target.checked);
  q('.dg-reset').onclick=()=>{st.filters.delete(key);closePop();st.shown=o.pageSize;render()};
  q('.dg-apply').onclick=()=>{
   const op=q('.dg-op').value,v1=q('.dg-v1')?.value??'',v2=q('.dg-v2')?.value??'';
   const boxes=[...pop.querySelectorAll('.dg-checks input')];const checked=boxes.filter(b=>b.checked).map(b=>b.value);
   const set=checked.length===boxes.length?null:new Set(checked);
   const hasCond=NOVAL.includes(op)||v1!==''||v2!=='';
   if(!set&&!hasCond)st.filters.delete(key);else st.filters.set(key,{op:hasCond?op:'',v1,v2,set});
   closePop();st.shown=o.pageSize;render();
  };
  pop.addEventListener('keydown',e=>{if(e.key==='Escape')closePop();if(e.key==='Enter'&&e.target.matches('input:not([type=checkbox])'))q('.dg-apply').click()});
  q('.dg-op').focus();
 }
 // ===== الأعمدة =====
 $('.dg-cols-btn').addEventListener('click',e=>{
  closePop();pop=document.createElement('div');pop.className='dg-pop';
  pop.innerHTML=`<div class="dg-pop-head"><b>الأعمدة الظاهرة</b><button type="button" class="link dg-x">✕</button></div><div class="dg-checks">${cols.map(c=>`<label><input type="checkbox" value="${esc(c.key)}" ${st.hidden.has(c.key)?'':'checked'}> ${esc(c.label)}</label>`).join('')}</div><div class="dg-pop-actions"><button type="button" class="ghost dg-allcols">إظهار الكل</button></div>`;
  place(pop,e.currentTarget);
  pop.querySelector('.dg-x').onclick=closePop;
  pop.querySelectorAll('.dg-checks input').forEach(i=>i.onchange=()=>{if(i.checked)st.hidden.delete(i.value);else st.hidden.add(i.value);persist();renderHead();renderBody()});
  pop.querySelector('.dg-allcols').onclick=()=>{st.hidden.clear();persist();closePop();render()};
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
 $('.dg-adv-btn').addEventListener('click',()=>{const el=$('.dg-adv');el.hidden=!el.hidden;if(!el.hidden){if(!st.adv.rules.length)st.adv.rules.push({key:cols[0].key,op:OPS[cols[0].type||'text'][0][0],v1:'',v2:''});renderAdv()}});
 $('.dg-adv').addEventListener('click',e=>{
  if(e.target.closest('.dg-radd')){readAdv();const c=visibleCols()[0]||cols[0];st.adv.rules.push({key:c.key,op:OPS[c.type||'text'][0][0],v1:'',v2:''});renderAdv()}
  else if(e.target.closest('.dg-rdel')){readAdv();st.adv.rules.splice(Number(e.target.closest('.dg-rule').dataset.i),1);renderAdv()}
  else if(e.target.closest('.dg-rapply')){readAdv();st.shown=o.pageSize;render()}
  else if(e.target.closest('.dg-rclear')){st.adv.rules=[];renderAdv();render()}
 });
 $('.dg-adv').addEventListener('change',e=>{
  if(e.target.matches('.dg-rkey')){readAdv();const r=st.adv.rules[Number(e.target.closest('.dg-rule').dataset.i)];r.op=OPS[byKey.get(r.key)?.type||'text'][0][0];r.v1='';r.v2='';renderAdv()}
  else if(e.target.matches('.dg-rop')){readAdv();renderAdv()}
 });

 // ===== الطباعة والتصدير =====
 function matrix(){const vc=visibleCols();return {head:vc.map(c=>c.label),body:view.map(r=>vc.map(c=>c.text(r)))}}
 function tableHtml(){const {head,body}=matrix();return `<table border="1" cellspacing="0" cellpadding="4" dir="rtl"><thead><tr>${head.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${body.map(r=>`<tr>${r.map(v=>`<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`}
 function docHtml(forPrint){
  const now=new Date();const stamp=`${String(now.getDate()).padStart(2,'0')}/${String(now.getMonth()+1).padStart(2,'0')}/${now.getFullYear()}`;
  const filt=[st.quick&&`بحث: ${st.quick}`,...[...st.filters.keys()].map(k=>`تصفية: ${byKey.get(k)?.label}`),st.adv.rules.length&&`شروط مركبة: ${st.adv.rules.length}`,st.groupBy&&`تجميع: ${byKey.get(st.groupBy)?.label}`].filter(Boolean).join(' — ');
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(o.title||'تقرير')}</title><style>body{font-family:"Noto Sans Arabic","Segoe UI",Tahoma,sans-serif;margin:18px;color:#111}h1{font-size:18px;margin:0 0 4px}p{margin:2px 0;font-size:12px;color:#444}table{border-collapse:collapse;width:100%;font-size:11px;margin-top:10px}th{background:#eef1f5}th,td{border:1px solid #999;padding:4px 6px;text-align:right;vertical-align:top}thead{display:table-header-group}tr{page-break-inside:avoid}${forPrint?'@page{size:A4 landscape;margin:10mm}':''}</style></head><body><h1>${esc(APP_NAME)}</h1><p><b>${esc(o.title||'تقرير')}</b> — عدد السجلات: ${view.length} — تاريخ الطباعة: ${stamp}</p>${filt?`<p>${esc(filt)}</p>`:''}${tableHtml()}${forPrint?'<script>window.onload=()=>{window.print()}<\/script>':''}</body></html>`;
 }
 function printGrid(){const w=window.open('','_blank');if(!w){alert('اسمح بالنوافذ المنبثقة للطباعة.');return}w.document.open();w.document.write(docHtml(true));w.document.close()}
 function download(content,name,type){const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000)}
 function exportGrid(kind){
  const base=(o.exportName||o.title||'report').replace(/[\\/:*?"<>|]+/g,'-');const {head,body}=matrix();
  if(kind==='csv'){const q=v=>`"${String(v??'').replace(/"/g,'""')}"`;download('\ufeff'+[head,...body].map(r=>r.map(q).join(',')).join('\r\n'),base+'.csv','text/csv;charset=utf-8')}
  else if(kind==='txt'){download('\ufeff'+[head,...body].map(r=>r.map(v=>String(v??'').replace(/[\t\r\n]+/g,' ')).join('\t')).join('\r\n'),base+'.txt','text/plain;charset=utf-8')}
  else if(kind==='xls'){download('\ufeff'+`<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" dir="rtl"><head><meta charset="utf-8"><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>Sheet1</x:Name><x:WorksheetOptions><x:DisplayRightToLeft/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--></head><body>${tableHtml()}</body></html>`,base+'.xls','application/vnd.ms-excel;charset=utf-8')}
  else if(kind==='doc'){download('\ufeff'+docHtml(false),base+'.doc','application/msword;charset=utf-8')}
 }

 render();
 return {
  setRows(r){rows=r||[];st.shown=o.pageSize;render()},
  getView:()=>view,
  get rows(){return rows},
  applyFilter(key,op,v1,v2=''){st.filters.set(key,{op,v1,v2,set:null});render()},
  sortBy(key,dir='asc'){st.sort=[{key,dir}];render()},
  exportData:kind=>exportGrid(kind),
  docHtml:()=>docHtml(false)
 };
}
