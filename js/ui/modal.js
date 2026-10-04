// نافذة منبثقة موحدة: كل نافذة (بما فيها النماذج) تحمل أزرار رجوع / إغلاق / الرئيسية أعلى اليسار.
// إتاحة وصول: فخ تركيز داخل النافذة (Tab يدور بين عناصرها) واستعادة التركيز للعنصر الذي فتحها عند الإغلاق.
const NAV='<div class="modal-nav nav-cluster" role="group" aria-label="التنقل"><button type="button" class="ghost" data-modal-back title="رجوع">↩ رجوع</button><button type="button" class="ghost" data-close title="إغلاق">✕ إغلاق</button><button type="button" class="ghost" data-modal-home title="الرئيسية">⌂ الرئيسية</button></div>';
const FOCUSABLE='a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
let lastTrigger=null,trapHandler=null;
let openOnTop=false;
/** النافذة التالية تُفتح فوق النافذة الحالية بدل استبدالها (خطوة داخل ورقة التسجيل). */
export function modalOpensOnTop(){openOnTop=true}

export function modal(html,{stacked=false}={}){
 const root=document.querySelector('#modal-root');
 lastTrigger=document.activeElement instanceof HTMLElement?document.activeElement:null;
 const useStacked=stacked||openOnTop;openOnTop=false;
 if(!useStacked)root.innerHTML=`<div class="modal-backdrop"><div class="modal-card" role="dialog" aria-modal="true">${NAV}${html}</div></div>`;
 else root.insertAdjacentHTML('beforeend',`<div class="modal-backdrop is-stacked"><div class="modal-card" role="dialog" aria-modal="true">${NAV}${html}</div></div>`);
 const card=root.querySelectorAll('.modal-card')[root.querySelectorAll('.modal-card').length-1];
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
/**
 * نافذة مكدَّسة (خطوة داخل نافذة): إغلاقها يعيد المستخدم إلى النافذة التي تحتها
 * («رجوع») ولا يمسح كل شيء — لذلك ورقة التسجيل تبقى مفتوحة عند اختيار نوع.
 */
export function stackedModal(html){
 const card=modal(html,{stacked:true});
 card.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>closeModal()));
 return card;
}
/** إغلاق آخر نافذة فقط (المكدَّسة) مع الإبقاء على ما تحتها. */
export function closeTopModal(){
 const root=document.querySelector('#modal-root');
 const cards=root.querySelectorAll('.modal-card');
 const target=cards[cards.length-1];
 if(!target)return false;
 target.closest('.modal-backdrop')?.remove();
 try{document.dispatchEvent(new CustomEvent('modal:closed'))}catch{}
 return true;
}
export function closeAllModals(){
 document.querySelector('#modal-root').innerHTML='';
 if(trapHandler){document.removeEventListener('keydown',trapHandler,true);trapHandler=null}
 try{if(lastTrigger&&document.contains(lastTrigger))lastTrigger.focus({preventScroll:true})}catch{}
 lastTrigger=null;
 try{document.dispatchEvent(new CustomEvent('modal:closed'))}catch{}
}
export function closeModal(){
 const root=document.querySelector('#modal-root');
 // سلوك قديم كما هو: الإغلاق يمسح النافذة الحالية وكل طبقاتها غير المكدَّسة.
 // الطبقة المكدَّسة صراحةً (ورقة التسجيل ← نموذج فوقها) وحدها تُقلَّم وحدها،
 // فلا تتغير دلالات closeModal لأي مسار قديم (نحو 52 موضع نداء).
 const cards=root.querySelectorAll('.modal-card');
 const topBackdrop=cards.length?cards[cards.length-1].closest('.modal-backdrop'):null;
 if(cards.length>1&&topBackdrop?.classList.contains('is-stacked')){
  topBackdrop.remove();
  try{document.dispatchEvent(new CustomEvent('modal:closed'))}catch{}
  return;
 }
 root.innerHTML='';
 if(trapHandler){document.removeEventListener('keydown',trapHandler,true);trapHandler=null}
 try{if(lastTrigger&&document.contains(lastTrigger))lastTrigger.focus({preventScroll:true})}catch{}
 lastTrigger=null;
 try{document.dispatchEvent(new CustomEvent('modal:closed'))}catch{}
}
export function confirmBox(message,{okText='تأكيد',input=false,placeholder='',label='السبب / ملاحظة',value=''}={}){
 // تأكيد عادي بسلوكه القديم: يحلّ محل النافذة المفتوحة، وإغلاقه ينظّف الجذر —
 // لأن مسارات قائمة تعتمد على أن النافذة السابقة اختفت بعده (فتح المسار التالي مباشرة).
 return new Promise(resolve=>{
  const card=modal(`<h2 class="modal-title">تأكيد</h2><p>${message}</p>${input?`<label>${label}<textarea class="confirm-input" rows="2" placeholder="${placeholder}">${String(value).replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"})[c])}</textarea></label>`:''}<div class="form-actions"><button class="primary" type="button" data-ok>${okText}</button><button class="ghost" type="button" data-cancel>إلغاء</button></div>`);
  const done=v=>{closeModal();resolve(v)};
  card.querySelector('[data-ok]').onclick=()=>done(input?{ok:true,value:card.querySelector('.confirm-input').value}:true);
  card.querySelector('[data-cancel]').onclick=()=>done(input?{ok:false}:false);
  card.querySelectorAll('[data-close],[data-modal-back],[data-modal-home]').forEach(b=>b.addEventListener('click',()=>resolve(input?{ok:false}:false)));
 });
}
export function toast(msg,type='ok'){import('./toast.js').then(m=>m.toast(msg,type)).catch(()=>{})}
