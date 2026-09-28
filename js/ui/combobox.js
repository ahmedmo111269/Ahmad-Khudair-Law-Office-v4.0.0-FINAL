// قائمة منسدلة موحدة وأنيقة لكل حقول <input list> في البرنامج (بديل عن نافذة datalist الأصلية
// التي يختلف شكلها بين المتصفحات وتظهر بشكل سيئ على الهاتف). تعمل تلقائيًا بالتفويض على مستوى المستند:
// بحث عربي مُطبّع (أ/إ/آ، ة/ه، ى/ي، الأرقام الهندية)، تمييز الجزء المطابق، تنقل بالأسهم و Enter و Esc،
// وتحدّث نفسها عندما تتغير الخيارات (مثل حقول البحث عن موكل التي تُملأ من القاعدة أثناء الكتابة).
import {normalizeArabic} from '../core/search-normalizer.js';

const MAX=60;
let pop=null,input=null,list=null,items=[],active=-1,observer=null,showAll=false;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function ensurePop(){
 if(pop)return pop;
 pop=document.createElement('div');pop.className='cbx-pop';pop.setAttribute('role','listbox');pop.hidden=true;pop.id='cbx-pop';
 pop.addEventListener('mousedown',e=>e.preventDefault()); // لا تفقد التركيز قبل الاختيار
 pop.addEventListener('click',e=>{const o=e.target.closest('.cbx-opt');if(o)choose(Number(o.dataset.i))});
 document.body.append(pop);return pop;
}
function options(){return list?[...list.querySelectorAll('option')].map(o=>({value:o.value,label:o.label&&o.label!==o.value?o.label:''})).filter(o=>o.value!==''):[]}
function mark(text,q){if(!q)return esc(text);const n=normalizeArabic(text),i=n.indexOf(q);if(i<0)return esc(text);
 // الطول في النص المطبع يطابق الأصلي تقريبًا (التطبيع حرف بحرف)، وعند الاختلاف نكتفي بعدم التمييز
 if(n.length!==text.length)return esc(text);return esc(text.slice(0,i))+'<mark>'+esc(text.slice(i,i+q.length))+'</mark>'+esc(text.slice(i+q.length))}
function render(){
 if(!input||!list)return close();
 const q=showAll?'':normalizeArabic(input.value.trim());
 const all=options();
 const starts=[],contains=[];
 for(const o of all){const n=normalizeArabic(o.value+' '+o.label);if(!q)starts.push(o);else if(n.startsWith(q))starts.push(o);else if(n.includes(q))contains.push(o)}
 items=[...starts,...contains].slice(0,MAX);
 const exact=items.length===1&&items[0].value===input.value;
 if(!items.length||exact){pop.hidden=true;input.setAttribute('aria-expanded','false');return}
 active=Math.min(active,items.length-1);
 pop.innerHTML=items.map((o,i)=>`<div class="cbx-opt${i===active?' on':''}${o.value===input.value?' sel':''}" role="option" id="cbx-o${i}" data-i="${i}" aria-selected="${i===active}"><span>${mark(o.value,q)}</span>${o.label?`<small>${esc(o.label)}</small>`:''}</div>`).join('')+(all.length>MAX&&!q?`<div class="cbx-more">اكتب للبحث في ${all.length} خيارًا</div>`:'');
 pop.hidden=false;input.setAttribute('aria-expanded','true');place();
 if(active>=0)input.setAttribute('aria-activedescendant','cbx-o'+active);else input.removeAttribute('aria-activedescendant');
}
function place(){
 if(!input||pop.hidden)return;
 const r=input.getBoundingClientRect(),vh=window.innerHeight,below=vh-r.bottom,above=r.top;
 const up=below<220&&above>below;const maxH=Math.max(140,Math.min(320,(up?above:below)-12));
 Object.assign(pop.style,{width:Math.max(r.width,180)+'px',maxHeight:maxH+'px',left:Math.max(6,Math.min(r.left,window.innerWidth-Math.max(r.width,180)-6))+'px',top:(up?Math.max(6,r.top-Math.min(maxH,pop.scrollHeight)-4):r.bottom+4)+'px'});
 pop.classList.toggle('up',up);
}
function choose(i){
 const o=items[i];if(!o||!input)return;
 const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,o.value);
 input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
 close();
}
function open(el){
 const id=el.getAttribute('list')||el.dataset.cbxList;if(!id)return;
 const dl=document.getElementById(id);if(!dl)return;
 // انقل الربط من list إلى data-cbx-list لإخفاء نافذة المتصفح الأصلية مع الإبقاء على المرجع
 if(el.hasAttribute('list')){el.dataset.cbxList=id;el.removeAttribute('list')}
 input=el;list=dl;active=-1;showAll=Boolean(el.value);ensurePop();
 el.setAttribute('role','combobox');el.setAttribute('aria-autocomplete','list');el.setAttribute('aria-controls','cbx-pop');el.setAttribute('autocomplete','off');
 observer?.disconnect();observer=new MutationObserver(()=>render());observer.observe(dl,{childList:true,subtree:true});
 render();
}
function close(){if(pop){pop.hidden=true}input?.setAttribute('aria-expanded','false');observer?.disconnect();observer=null;input=null;list=null;items=[];active=-1}

export function initCombobox(){
 if(window.__cbxInit)return;window.__cbxInit=true;
 document.addEventListener('focusin',e=>{const el=e.target;if(el instanceof HTMLInputElement&&(el.hasAttribute('list')||el.dataset.cbxList))open(el);else if(input&&el!==input)close()});
 document.addEventListener('focusout',e=>{if(e.target===input)setTimeout(()=>{if(document.activeElement!==input)close()},120)});
 document.addEventListener('input',e=>{if(e.target===input&&e.isTrusted){showAll=false;active=-1;render()}});
 document.addEventListener('click',e=>{if(e.target===input&&pop?.hidden){showAll=true;render()}});
 document.addEventListener('keydown',e=>{
  if(e.target!==input)return;
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();if(pop.hidden){showAll=true;render();return}const n=items.length;active=e.key==='ArrowDown'?(active+1)%n:(active<=0?n-1:active-1);render();pop.querySelector('.cbx-opt.on')?.scrollIntoView?.({block:'nearest'})}
  else if(e.key==='Enter'&&!pop.hidden&&active>=0){e.preventDefault();e.stopPropagation();choose(active)}
  else if(e.key==='Escape'&&!pop.hidden){e.preventDefault();e.stopPropagation();pop.hidden=true}
  else if(e.key==='Tab'&&!pop.hidden&&active>=0)choose(active);
 },true);
 window.addEventListener('resize',place);document.addEventListener('scroll',()=>place(),true);
}
export const __test={open,close,render:()=>render(),get items(){return items},choose};
