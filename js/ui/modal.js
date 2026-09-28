// نافذة منبثقة موحدة: كل نافذة (بما فيها النماذج) تحمل أزرار رجوع / إغلاق / الرئيسية أعلى اليسار.
const NAV='<div class="modal-nav nav-cluster" role="group" aria-label="التنقل"><button type="button" class="ghost" data-modal-back title="رجوع">↩ رجوع</button><button type="button" class="ghost" data-close title="إغلاق">✕ إغلاق</button><button type="button" class="ghost" data-modal-home title="الرئيسية">⌂ الرئيسية</button></div>';
export function modal(html){
 const root=document.querySelector('#modal-root');
 root.innerHTML=`<div class="modal-backdrop"><div class="modal-card" role="dialog" aria-modal="true">${NAV}${html}</div></div>`;
 root.querySelectorAll('[data-close],[data-modal-back]').forEach(b=>b.addEventListener('click',()=>closeModal()));
 root.querySelector('[data-modal-home]')?.addEventListener('click',()=>{closeModal();window.__LAW_OFFICE_APP__?.go('dashboard')});
 return root.querySelector('.modal-card');
}
export function closeModal(){document.querySelector('#modal-root').innerHTML=''}
export function confirmBox(message,{okText='تأكيد',input=false,placeholder='',label='السبب / ملاحظة',value=''}={}){
 return new Promise(resolve=>{
  const card=modal(`<h2 class="modal-title">تأكيد</h2><p>${message}</p>${input?`<label>${label}<textarea class="confirm-input" rows="2" placeholder="${placeholder}">${String(value).replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"})[c])}</textarea></label>`:''}<div class="form-actions"><button class="primary" type="button" data-ok>${okText}</button><button class="ghost" type="button" data-cancel>إلغاء</button></div>`);
  const done=v=>{closeModal();resolve(v)};
  card.querySelector('[data-ok]').onclick=()=>done(input?{ok:true,value:card.querySelector('.confirm-input').value}:true);
  card.querySelector('[data-cancel]').onclick=()=>done(input?{ok:false}:false);
  card.querySelectorAll('[data-close],[data-modal-back],[data-modal-home]').forEach(b=>b.addEventListener('click',()=>resolve(input?{ok:false}:false)));
 });
}
