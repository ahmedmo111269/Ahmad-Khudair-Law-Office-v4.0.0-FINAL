// تقويم شهري: الشهر بالأرقام (1–12) والسنة (من الحالية تنازليًا) كقوائم قابلة للكتابة يدويًا،
// تمييز اليوم الحالي واليوم المختار، ونقاط بعدد العناصر في كل يوم. الأسبوع يبدأ السبت.
import {localDate} from '../core/clock.js';
const MONTHS=['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
const DAYS=['السبت','الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة'];
let seq=0;

export function mountCalendar(root,{selected=localDate(),onSelect=null,onMonthChange=null}={}){
 const id=++seq;
 const now=new Date();const thisYear=now.getFullYear();
 let [y,m]=selected.split('-').map(Number);let sel=selected;let marks=new Map();
 root.classList.add('cal');
 root.innerHTML=`<div class="cal-head">
  <button type="button" class="ghost cal-prev" aria-label="الشهر السابق">›</button>
  <label class="cal-field">الشهر<input class="cal-month" inputmode="numeric" list="cal-months-${id}" autocomplete="off" aria-label="الشهر"></label>
  <span class="cal-mname"></span>
  <label class="cal-field">السنة<input class="cal-year" inputmode="numeric" list="cal-years-${id}" autocomplete="off" aria-label="السنة"></label>
  <button type="button" class="ghost cal-next" aria-label="الشهر التالي">‹</button>
  <button type="button" class="ghost cal-today">اليوم</button>
  <datalist id="cal-months-${id}">${MONTHS.map((n,i)=>`<option value="${i+1}">${n}</option>`).join('')}</datalist>
  <datalist id="cal-years-${id}">${Array.from({length:61},(_,i)=>`<option value="${thisYear+1-i}"></option>`).join('')}</datalist>
 </div><div class="cal-grid" role="grid"></div>`;
 const $=s=>root.querySelector(s);
 function draw(){
  $('.cal-month').value=m;$('.cal-year').value=y;$('.cal-mname').textContent=`${MONTHS[m-1]} ${y}`;
  const first=new Date(y,m-1,1),days=new Date(y,m,0).getDate();
  const offset=(first.getDay()+1)%7; // السبت = 0
  const today=localDate();
  let html=DAYS.map(d=>`<div class="cal-dow" role="columnheader"><span class="full">${d}</span><span class="short">${d.slice(0,2)}</span></div>`).join('');
  for(let i=0;i<offset;i++)html+='<div class="cal-pad"></div>';
  for(let d=1;d<=days;d++){
   const iso=`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;const c=marks.get(iso)||0;
   html+=`<button type="button" class="cal-day${iso===today?' is-today':''}${iso===sel?' is-selected':''}${c?' has-items':''}" data-date="${iso}" aria-label="${d} ${MONTHS[m-1]}${c?` — ${c} عنصر`:''}"><span>${d}</span>${c?`<i class="cal-dot">${c>99?'99+':c}</i>`:''}</button>`;
  }
  $('.cal-grid').innerHTML=html;
 }
 async function change(ny,nm){
  if(nm<1){nm=12;ny--}if(nm>12){nm=1;ny++}
  y=ny;m=nm;draw();
  if(onMonthChange){try{marks=await onMonthChange(y,m)||new Map()}catch{marks=new Map()}draw()}
 }
 $('.cal-prev').onclick=()=>change(y,m-1);
 $('.cal-next').onclick=()=>change(y,m+1);
 $('.cal-today').onclick=()=>{const t=localDate();sel=t;const [ty,tm]=t.split('-').map(Number);change(ty,tm);onSelect?.(t)};
 const readInputs=()=>{const nm=Number(String($('.cal-month').value).replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)));const ny=Number(String($('.cal-year').value).replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)));if(nm>=1&&nm<=12&&ny>=1900&&ny<=2200&&(nm!==m||ny!==y))change(ny,nm)};
 $('.cal-month').addEventListener('change',readInputs);$('.cal-year').addEventListener('change',readInputs);
 $('.cal-month').addEventListener('keydown',e=>{if(e.key==='Enter')readInputs()});$('.cal-year').addEventListener('keydown',e=>{if(e.key==='Enter')readInputs()});
 $('.cal-grid').addEventListener('click',e=>{const b=e.target.closest('.cal-day');if(!b)return;sel=b.dataset.date;draw();onSelect?.(sel)});
 change(y,m);
 return {select(iso){sel=iso;const [ny,nm]=iso.split('-').map(Number);change(ny,nm)},refresh(){change(y,m)},get selected(){return sel}};
}
