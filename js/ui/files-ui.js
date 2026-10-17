// عناصر واجهة مشتركة لمجموعة الملفات — تُبقي كل اللوحات على لغة بصرية واحدة،
// وتُعيد استخدام modal/overlay-stack/toast القائمة، ولا تنشئ نوافذ موازية.
import {esc} from './dom.js';
import {modal,stackedModal,closeModal} from './modal.js';
import {open as overlayOpen} from './overlay-stack.js';
import {toast} from './toast.js';
import {formatNumber} from '../core/format.js';

export const fsNum=value=>formatNumber(Number(value)||0);

export function fsState({title,body,actions='',className='',wide=false}){
 const card=modal(`<div class="fs-sheet ${wide?'fs-sheet--wide':''} ${esc(className)}"><header class="fs-sheet-head"><h2>${esc(title)}</h2><div class="fs-sheet-head-actions">${actions}</div></header><div class="fs-sheet-body">${body}</div></div>`);
 card.classList.add('fs-modal-card');
 return card;
}

export function fsBadge(label,tone='neutral'){
 return `<span class="fs-badge fs-badge--${esc(tone)}">${esc(label)}</span>`;
}

export function fsStat({label,value,sub='',tone='neutral',action=''}){
 const inner=`<span class="fs-stat-l">${esc(label)}</span><b class="fs-stat-v fs-tone-${esc(tone)}">${typeof value==='number'?fsNum(value):esc(value)}</b>${sub?`<small class="fs-stat-s">${esc(sub)}</small>`:''}`;
 return action
  ?`<button type="button" class="fs-stat is-action" data-fs-action="${esc(action)}">${inner}</button>`
  :`<div class="fs-stat">${inner}</div>`;
}

export function fsEmpty(message,{action='',label=''}={}){
 return `<div class="fs-empty" role="status"><p>${esc(message)}</p>${action?`<button type="button" class="ghost small" data-fs-action="${esc(action)}">${esc(label||'فتح')}</button>`:''}</div>`;
}

export function fsMissing(label='غير مسجل'){
 return `<span class="fs-missing">${esc(label)}</span>`;
}

export function fsNotice(text,tone='info'){
 return `<div class="fs-notice fs-notice--${esc(tone)}" role="status">${esc(text)}</div>`;
}

/** شريط تقدم صريح المصدر (اكتمال إداري). */
export function fsMeter({value=0,label='',caption=''}={}){
 const percent=Math.max(0,Math.min(100,Math.round(Number(value)||0)));
 return `<div class="fs-meter" role="group" aria-label="${esc(label||'مؤشر')} ${percent}%">
  <div class="fs-meter-head"><span>${esc(label)}</span><b>${percent}%</b></div>
  <div class="fs-meter-track" role="img" aria-label="${esc(label)} ${percent} بالمئة"><span style="inline-size:${percent}%"></span></div>
  ${caption?`<small class="muted">${esc(caption)}</small>`:''}
 </div>`;
}

/** أعمدة أفقية بسيطة بلا مكتبات — تُقرأ نصيًا أيضًا. */
export function fsBarChart({rows=[],labelKey='label',valueKey='count',onAction='',caption=''}={}){
 const max=Math.max(1,...rows.map(row=>Number(row[valueKey])||0));
 return `<div class="fs-bars" role="list" aria-label="${esc(caption||'توزيع')}">${rows.map(row=>{
  const value=Number(row[valueKey])||0;
  const pct=Math.round(value/max*100);
  return `<div class="fs-bar-row" role="listitem">
   ${onAction?`<button type="button" class="link fs-bar-label" data-fs-action="${esc(onAction)}" data-dist-key="${esc(row.value??row[labelKey]??'')}" data-fs-key="${esc(row.value??row[labelKey]??'')}">${esc(row[labelKey]??'غير مسجل')}</button>`:`<span class="fs-bar-label">${esc(row[labelKey]??'غير مسجل')}</span>`}
   <span class="fs-bar-track"><span style="inline-size:${pct}%"></span></span>
   <b class="fs-bar-value">${fsNum(value)}</b>
  </div>`;
 }).join('')}</div>`;
}

/** كعكة CSS مع وسيلة نصية (لا اعتماد على اللون وحده). */
export function fsDonut({rows=[],labelKey='label',valueKey='count',caption=''}={}){
 const total=rows.reduce((sum,row)=>sum+(Number(row[valueKey])||0),0);
 if(!total)return fsEmpty('لا توجد بيانات لعرضها.');
 let at=0;
 const stops=[];
 const colors=['#8a6d1f','#2f6f8f','#8f3b4b','#4a7a4d','#6b5a9e','#a26b2f','#51707a','#7b7b7b','#a18d3c'];
 rows.forEach((row,index)=>{
  const value=Number(row[valueKey])||0;
  const from=at/total*360,to=(at+value)/total*360;
  stops.push(`${colors[index%colors.length]} ${from.toFixed(2)}deg ${to.toFixed(2)}deg`);
  at+=value;
 });
 return `<div class="fs-donut-wrap"><div class="fs-donut" role="img" aria-label="${esc(caption||'توزيع')}: ${rows.map(row=>`${row[labelKey]} ${row[valueKey]}`).join('، ')}" style="background:conic-gradient(${stops.join(',')})"><span>${fsNum(total)}</span></div>
  <ul class="fs-legend">${rows.map((row,index)=>`<li><i style="background:${colors[index%colors.length]}" aria-hidden="true"></i><span>${esc(row[labelKey]??'غير مسجل')}</span><b>${fsNum(row[valueKey])}</b></li>`).join('')}</ul></div>`;
}

/** لوحة جانبية حقيقية (Drawer) مع إغلاق وزر رجوع آمن. */
let currentDrawer=null;
export function openFsDrawer({title,sub='',body='',side='start',className='',onClose=null}={}){
 closeFsDrawer();
 const wrap=document.createElement('div');
 wrap.className=`fs-drawer-wrap fs-drawer--${side==='end'?'end':'start'} ${className}`;
 wrap.innerHTML=`<div class="fs-drawer-backdrop" data-fs-drawer-close></div>
  <aside class="fs-drawer" role="dialog" aria-modal="false" aria-label="${esc(title)}">
   <header class="fs-drawer-head"><div><b>${esc(title)}</b>${sub?`<small>${esc(sub)}</small>`:''}</div><button type="button" class="ghost icon-only" data-fs-drawer-close aria-label="إغلاق اللوحة">✕</button></header>
   <div class="fs-drawer-body">${body}</div>
  </aside>`;
 document.body.append(wrap);
 const release=overlayOpen('files-drawer',()=>{closeFsDrawer();return true});
 const key=e=>{if(e.key==='Escape'){e.preventDefault();closeFsDrawer()}};
 document.addEventListener('keydown',key,true);
 const close=()=>{
  if(currentDrawer!==handle)return;
  document.removeEventListener('keydown',key,true);
  try{release?.()}catch{}
  wrap.remove();
  currentDrawer=null;
  try{onClose?.()}catch{}
 };
 const handle={wrap,close,refresh:html=>{const host=wrap.querySelector('.fs-drawer-body');if(host)host.innerHTML=html}};
 wrap.querySelectorAll('[data-fs-drawer-close]').forEach(button=>button.addEventListener('click',close));
 currentDrawer=handle;
 return handle;
}
export function closeFsDrawer(){
 currentDrawer?.close?.();
 currentDrawer=null;
}
export function isFsDrawerOpen(){return Boolean(currentDrawer)}

/**
 * مراجعة أثر قبل أي إجراء مؤثر (إغلاق/أرشفة/جماعي). لا ينفّذ شيئًا؛ يعيد قرار المستخدم.
 */
export function reviewImpact({title='مراجعة قبل التنفيذ',summary='',scope=[],effects=[],caveats=[],okText='تأكيد التنفيذ',danger=false,reason=null}={}){
 return new Promise(resolve=>{
  // إن كانت هناك نافذة مفتوحة (مثل نموذج تعديل الملف) تُعرض المراجعة فوقها
  // كنافذة مكدَّسة حتى لا يُفقد ما كتبه المستخدم إذا اختار الإلغاء.
  const stacked=Boolean(document.querySelector('#modal-root .modal-card'));
  const html=`<div class="fs-impact">
   <h2 class="modal-title">${esc(title)}</h2>
   ${summary?`<p>${esc(summary)}</p>`:''}
   ${scope.length?`<section class="fs-impact-block"><h3>نطاق السجلات المتأثرة</h3><ul>${scope.map(item=>`<li>${esc(item)}</li>`).join('')}</ul></section>`:''}
   ${effects.length?`<section class="fs-impact-block"><h3>ما الذي سيتغير</h3><ul>${effects.map(item=>`<li>${esc(item)}</li>`).join('')}</ul></section>`:''}
   ${caveats.length?`<section class="fs-impact-block fs-impact-note"><h3>قيود وملاحظات</h3><ul>${caveats.map(item=>`<li>${esc(item)}</li>`).join('')}</ul></section>`:''}
   ${reason?`<label class="fs-reason">${esc(reason.label||'السبب (اختياري)')}<textarea data-fs-impact-reason rows="2" placeholder="${esc(reason.placeholder||'')}"></textarea></label>`:''}
   <p class="muted small">لن يُنفَّذ أي تغيير قبل نقرك على زر التأكيد. الإلغاء لا يغيّر أي سجل.</p>
   <div class="form-actions"><button type="button" class="${danger?'danger':'primary'}" data-fs-impact-ok>${esc(okText)}</button><button type="button" class="ghost" data-fs-impact-cancel>إلغاء</button></div>
  </div>`;
  const card=stacked?stackedModal(html):modal(html);
  let settled=false;
  const finish=value=>{
   if(settled)return;
   settled=true;
   document.removeEventListener('modal:closed',onClosed);
   resolve(value);
   // closeModal بعد الحل: النافذة المكدَّسة تُغلق وحدها فيبقى النموذج تحتها.
   closeModal();
  };
  const onClosed=()=>{if(settled)return;settled=true;resolve(reason?{ok:false,value:''}:false)};
  document.addEventListener('modal:closed',onClosed);
  card.querySelector('[data-fs-impact-ok]')?.addEventListener('click',()=>{
   const text=card.querySelector('[data-fs-impact-reason]')?.value||'';
   finish(reason?{ok:true,value:text}:true);
  });
  card.querySelector('[data-fs-impact-cancel]')?.addEventListener('click',()=>finish(reason?{ok:false,value:''}:false));
  card.querySelectorAll('[data-close],[data-modal-back],[data-modal-home]').forEach(button=>button.addEventListener('click',()=>finish(reason?{ok:false,value:''}:false)));
 });
}

/**
 * تأكيد داخل ورقة مفتوحة: يُعرض كنافذة مكدَّسة حتى تبقى الورقة تحته،
 * بخلاف confirmBox الذي يستبدل النافذة كاملة ويفقد سياق اللوحة.
 */
export function fsConfirm(message,{okText='تأكيد',input=false,label='السبب / ملاحظة',placeholder='',value='',danger=false}={}){
 return new Promise(resolve=>{
  const stacked=Boolean(document.querySelector('#modal-root .modal-card'));
  const html=`<h2 class="modal-title">تأكيد</h2><p>${esc(message)}</p>${input?`<label>${esc(label)}<textarea class="confirm-input" rows="2" placeholder="${esc(placeholder)}">${esc(value)}</textarea></label>`:''}<div class="form-actions"><button type="button" class="${danger?'danger':'primary'}" data-fs-confirm-ok>${esc(okText)}</button><button type="button" class="ghost" data-fs-confirm-cancel>إلغاء</button></div>`;
  const card=stacked?stackedModal(html):modal(html);
  let settled=false;
  const onClosed=()=>{
   if(settled)return;
   settled=true;
   document.removeEventListener('modal:closed',onClosed);
   resolve(input?{ok:false}:false);
  };
  document.addEventListener('modal:closed',onClosed);
  const finish=v=>{
   if(settled)return;
   settled=true;
   document.removeEventListener('modal:closed',onClosed);
   resolve(v);
   closeModal();
  };
  card.querySelector('[data-fs-confirm-ok]')?.addEventListener('click',()=>finish(input?{ok:true,value:card.querySelector('.confirm-input')?.value||''}:true));
  card.querySelector('[data-fs-confirm-cancel]')?.addEventListener('click',()=>finish(input?{ok:false}:false));
 });
}

/** تنزيل ملف JSON محلي (تفضيلات فقط). */
export function downloadJson(filename,payload){
 const blob=new Blob([typeof payload==='string'?payload:JSON.stringify(payload,null,2)],{type:'application/json;charset=utf-8'});
 const url=URL.createObjectURL(blob);
 const a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),1500);
}

/** قراءة ملف نصي محلي بحد أقصى — بلا أي رفع شبكي. */
export function pickJsonFile({maxBytes=512000}={}){
 return new Promise(resolve=>{
  const input=document.createElement('input');
  input.type='file';input.accept='application/json,.json';
  input.onchange=async()=>{
   const file=input.files?.[0];
   if(!file)return resolve(null);
   if(file.size>maxBytes){toast('الملف أكبر من الحد المسموح.','error');return resolve(null)}
   try{resolve({name:file.name,text:await file.text()})}
   catch{toast('تعذر قراءة الملف.','error');resolve(null)}
  };
  input.click();
 });
}

export function fsCopy(text,label='تم النسخ'){
 const body=String(text??'');
 if(!body.trim()){toast('لا يوجد نص لنسخه','error');return}
 const fallback=()=>{
  const ta=document.createElement('textarea');ta.value=body;document.body.append(ta);ta.select();
  try{document.execCommand('copy');toast(label)}catch{toast('تعذر النسخ','error')}
  ta.remove();
 };
 if(navigator.clipboard?.writeText)navigator.clipboard.writeText(body).then(()=>toast(label)).catch(fallback);
 else fallback();
}

export function fsPrintHtml({title,body,subtitle='',footer=''}){
 const win=window.open('','_blank');
 if(!win){toast('اسمح بالنوافذ المنبثقة للطباعة.','error');return false}
 win.opener=null;
 win.document.open();
 win.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(title)}</title>
 <style>
  @page{size:A4;margin:14mm}
  body{font-family:Tahoma,"Noto Sans Arabic",Arial,sans-serif;color:#111;background:#fff;line-height:1.8;font-size:12px}
  h1{font-size:19px;margin:0 0 4px} h2{font-size:15px;margin:18px 0 6px;border-bottom:1px solid #bbb;padding-bottom:3px}
  h3{font-size:13px;margin:12px 0 4px} .muted{color:#555} .small{font-size:10.5px}
  table{width:100%;border-collapse:collapse;margin:6px 0 12px}
  th,td{border:1px solid #999;padding:5px 7px;text-align:right;vertical-align:top}
  th{background:#eee} .missing{color:#777;font-style:italic} .badge{border:1px solid #999;border-radius:8px;padding:1px 6px;font-size:10px}
  .cover{border-bottom:2px solid #222;margin-bottom:10px;padding-bottom:8px} .grid{display:grid;grid-template-columns:1fr 1fr;gap:4px 18px}
  .kv{display:flex;gap:8px;border-bottom:1px dotted #ccc;padding:2px 0}.kv b{min-width:120px}
  footer{margin-top:20px;border-top:1px solid #ccc;padding-top:6px;font-size:10px;color:#555}
  mark{background:#fff2a8;color:inherit} .avoid{page-break-inside:avoid}
 </style></head><body>
 <div class="cover"><h1>${esc(title)}</h1>${subtitle?`<p>${esc(subtitle)}</p>`:''}<p class="small muted">${esc(footer||'مكتب الأستاذ أحمد محمد خضير المحامي — تقرير إداري داخلي')}</p></div>
 ${body}
 <footer>${esc(footer||'')} — طُبع من نظام «الديوان». البيانات المعروضة هي القيم المسجلة وقت الطباعة، ولم تُستنبط أي نتائج قانونية.</footer>
 </body></html>`);
 win.document.close();
 setTimeout(()=>{try{win.focus();win.print()}catch{}},240);
 return true;
}
