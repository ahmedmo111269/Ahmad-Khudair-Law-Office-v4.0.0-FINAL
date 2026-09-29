// عارض الخط الزمني الموحد: يبني من مخرجات services/timeline.js قائمة زمنية تفاعلية
// (فلاتر بالنوع، فاصل «الآن»، فتح السجل بنقرة). لا يستعلم بنفسه — يستقبل البيانات جاهزة.
import {esc} from '../ui/dom.js';
import {formatDateTime,formatDate} from '../core/format.js';
import {formatNumber} from '../core/format.js';

export const TIMELINE_KINDS=[
 ['جلسة','hearings','calendar','◷'],
 ['حكم','judgments','landmark','🔨'],
 ['إجراء/مهمة','procedures','clipboard','📝'],
 ['موعد','appointments','clock','⏰'],
 ['اتصال','communications','phone','📞'],
 ['ملاحظة','caseNotes','note','🗒️'],
 ['مرجع مستند','documentReferences','file','📎'],
 ['تنفيذ','execution','hammer','🏛️'],
 ['أتعاب','fees','wallet','💰'],
 ['نشاط','activityLog','','≋']
];
const storeOf=type=>TIMELINE_KINDS.find(k=>k[0]===type)?.[1]||'';
const iconOf=type=>TIMELINE_KINDS.find(k=>k[0]===type)?.[3]||'•';
const futureOf=type=>['جلسة','موعد'].includes(type);

export function timelineSummary(t){
 if(!t)return {counts:[],total:0};
 const counts=TIMELINE_KINDS.map(([type])=>[type,t.counts?.[type==='إجراء/مهمة'?'procedures':type==='مرجع مستند'?'documentReferences':type]??t.timeline.filter(x=>x.type===type).length]).filter(([,n])=>n>0);
 return {counts,total:t.timeline.length};
}

export function timelineHtml(t,{compact=false}={}){
 if(!t||!t.timeline||!t.timeline.length)return `<div class="empty tl-empty"><h3>لا يوجد خط زمني بعد</h3><p>ستظهر هنا كل الجلسات والأعمال والمواعيد والاتصالات والأحكام الخاصة بهذا السجل بتسلسل زمني واحد.</p></div>`;
 const now=new Date();
 const {counts,total}=timelineSummary(t);
 const future=t.timeline.filter(x=>x.date&&new Date(x.date)>=now);
 const past=t.timeline.filter(x=>!(x.date&&new Date(x.date)>=now));
 const row=x=>{
  const st=storeOf(x.type);
  const dt=/T/.test(String(x.date))?formatDateTime(x.date):formatDate(x.date);
  const isOpen=Boolean(st)&&x.type!=='نشاط';
  return `<${isOpen?'button':'div'} type="button" class="tl-item tl-f${futureOf(x.type)?'f':'p'}${isOpen?' tl-open':''}"${isOpen?` data-open-rec="${st}:${esc(x.entityId||'')}"`:''}>
   <span class="tl-dot" aria-hidden="true">${iconOf(x.type)}</span>
   <span class="tl-when"><time>${esc(dt||'—')}</time></span>
   <span class="tl-body"><b><span class="tl-kind">${esc(x.type)}</span> ${esc(x.title)}</b>${x.detail?`<small>${esc(x.detail)}</small>`:''}</span>
  </${isOpen?'button':'div'}>`;
 };
 return `<div class="tl-summary">${counts.map(([k,n])=>`<span class="tl-chip" data-tl-filter="${esc(k)}">${iconOf(k)} ${esc(k)} <b>${formatNumber(n)}</b></span>`).join('')}<span class="tl-chip tl-all on" data-tl-filter="">الكل <b>${formatNumber(total)}</b></span></div>
 ${t.truncated?'<div class="notice" role="status">الخط الزمني يعرض حتى 200 حدث أحدث؛ الأحداث الأقدم محفوظة كاملة في قاعدة البيانات.</div>':''}
 ${t.future?`<div class="tl-next">التالي: <button class="link" data-open-rec="${esc(storeOf(t.future.type))}:${esc(t.future.entityId||'')}">${esc(t.future.title)} — ${esc(formatDate(t.future.date))}</button></div>`:''}
 <div class="tl-wrap" data-tl-wrap>
  ${future.length?`<h4 class="tl-seg">القادم</h4>${future.slice(0,compact?5:50).map(row).join('')}`:''}
  ${future.length&&past.length?'<div class="tl-now" aria-hidden="true"><span>الآن</span></div>':''}
  ${past.length?`<h4 class="tl-seg">السابق</h4>${past.slice(0,compact?15:150).map(row).join('')}`:''}
 </div>
 ${total>(compact?20:200)?'<p class="muted small">يُعرض أحدث جزء من الخط الزمني؛ استخدم تبويبات الجلسات والإجراءات للوصول للسجلات الأقدم.</p>':''}`;
}

export function bindTimeline(root,{onOpen}={}){
 root.querySelectorAll('[data-open-rec]').forEach(b=>b.onclick=()=>{const r=b.dataset.openRec;if(r&&onOpen&&!r.endsWith(':'))onOpen(r)});
 // فلترة بالنوع: إخفاء العناصر المطابقة داخليًا دون إعادة بناء
 root.querySelectorAll('[data-tl-filter]').forEach(ch=>ch.onclick=()=>{
  const k=ch.dataset.tlFilter;
  root.querySelectorAll('[data-tl-filter]').forEach(x=>x.classList.toggle('on',x===ch));
  root.querySelectorAll('[data-tl-wrap] .tl-item').forEach(it=>{
   const show=!k||it.querySelector('.tl-kind')?.textContent===k;
   it.hidden=!show;
  });
  root.querySelectorAll('[data-tl-wrap] .tl-seg, [data-tl-wrap] .tl-now').forEach(seg=>{seg.hidden=Boolean(k)});
 });
}
