// نافذة منبثقة موحدة: كل نافذة (بما فيها النماذج) تحمل أزرار رجوع / إغلاق / الرئيسية أعلى اليسار.
// إتاحة وصول: فخ تركيز داخل النافذة (Tab يدور بين عناصرها) واستعادة التركيز للعنصر الذي فتحها عند الإغلاق.
const NAV='<div class="modal-nav nav-cluster" role="group" aria-label="التنقل"><button type="button" class="ghost" data-modal-back title="رجوع">↩ رجوع</button><button type="button" class="ghost" data-close title="إغلاق">✕ إغلاق</button><button type="button" class="ghost" data-modal-home title="الرئيسية">⌂ الرئيسية</button></div>';
const FOCUSABLE='a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
let lastTrigger=null,trapHandler=null;
export function modal(html){
 const root=document.querySelector('#modal-root');
 lastTrigger=document.activeElement instanceof HTMLElement?document.activeElement:null;
 root.innerHTML=`<div class="modal-backdrop"><div class="modal-card" role="dialog" aria-modal="true">${NAV}${html}</div></div>`;
 const card=root.querySelector('.modal-card');
 root.querySelectorAll('[data-close],[data-modal-back]').forEach(b=>b.addEventListener('click',()=>closeModal()));
 root.querySelector('[data-modal-home]')?.addEventListener('click',()=>{closeModal();window.__LAW_OFFICE_APP__?.go('dashboard')});
 // فخ التركيز: Tab / Shift+Tab يدوران داخل النافذة فقط
 if(trapHandler)document.removeEventListener('keydown',trapHandler,true);
 trapHandler=e=>{
  if(e.key!=='Tab')return;
  const items=card? [...card.querySelectorAll(FOCUSABLE)].filter(el=>el.offsetParent!==null||el===document.activeElement):[];
  if(!items.length)return;
  const first=items[0],last=items.at(-1);
  if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}
  else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
  else if(!card.contains(document.activeElement)){e.preventDefault();first.focus()}
 };
 document.addEventListener('keydown',trapHandler,true);
 return card;
}
export function closeModal(){
 document.querySelector('#modal-root').innerHTML='';
 if(trapHandler){document.removeEventListener('keydown',trapHandler,true);trapHandler=null}
 try{if(lastTrigger&&document.contains(lastTrigger))lastTrigger.focus({preventScroll:true})}catch{}
 lastTrigger=null;
 try{document.dispatchEvent(new CustomEvent('modal:closed'))}catch{}
}
export function confirmBox(message,{okText='تأكيد',input=false,placeholder='',label='السبب / ملاحظة',value=''}={}){
 return new Promise(resolve=>{
  const card=modal(`<h2 class="modal-title">تأكيد</h2><p>${message}</p>${input?`<label>${label}<textarea class="confirm-input" rows="2" placeholder="${placeholder}">${String(value).replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"})[c])}</textarea></label>`:''}<div class="form-actions"><button class="primary" type="button" data-ok>${okText}</button><button class="ghost" type="button" data-cancel>إلغاء</button></div>`);
  const done=v=>{closeModal();resolve(v)};
  card.querySelector('[data-ok]').onclick=()=>done(input?{ok:true,value:card.querySelector('.confirm-input').value}:true);
  card.querySelector('[data-cancel]').onclick=()=>done(input?{ok:false}:false);
  card.querySelectorAll('[data-close],[data-modal-back],[data-modal-home]').forEach(b=>b.addEventListener('click',()=>resolve(input?{ok:false}:false)));
 });
}
export function toast(msg,type='ok'){import('./toast.js').then(m=>m.toast(msg,type)).catch(()=>{})}
