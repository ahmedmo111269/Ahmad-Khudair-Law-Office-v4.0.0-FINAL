// نظام إشعارات موحّد: حاوية ثابتة، أيقونة حسب النوع، زر إغلاق، تراكم ذكي (بحد أقصى)، وحركة خفيفة تحترم تفضيل تقليل الحركة.
const ICONS={ok:'✓',error:'✕',warn:'!',info:'i'};
const TITLES={ok:'',error:'',warn:'تنبيه: ',info:''};
let stack=null;
function ensureStack(){
 if(stack&&document.body.contains(stack))return stack;
 stack=document.createElement('div');
 stack.id='toast-stack';
 stack.setAttribute('aria-live','polite');
 stack.setAttribute('aria-label','الإشعارات');
 document.body.append(stack);
 return stack;
}
export function toast(msg,type='ok',{duration=3200,action=null,actionLabel=''}={}){
 const root=ensureStack();
 // حد أقصى 4 إشعارات ظاهرة: الأقدم يُزال فورًا حتى لا تتراكم الرسائل أثناء العمليات المتتالية.
 while(root.children.length>=4)root.firstElementChild?.remove();
 const el=document.createElement('div');
 el.className=`toast t-${type}`;
 el.setAttribute('role',type==='error'?'alert':'status');
 const safe=String(msg??'');
 el.innerHTML=`<span class="toast-ic" aria-hidden="true">${ICONS[type]||ICONS.info}</span><span class="toast-msg"></span>${action?`<button type="button" class="link toast-act"></button>`:''}<button type="button" class="toast-x" aria-label="إغلاق الإشعار" title="إغلاق">✕</button>`;
 el.querySelector('.toast-msg').textContent=(TITLES[type]||'')+safe;
 if(action){const b=el.querySelector('.toast-act');b.textContent=actionLabel||'إجراء';b.onclick=()=>{dismiss();try{action()}catch(e){console.error(e)}}}
 const dismiss=()=>{if(!el.isConnected)return;el.classList.add('toast-out');setTimeout(()=>el.remove(),180)};
 el.querySelector('.toast-x').onclick=dismiss;
 root.append(el);
 // حركة الدخول في الإطار التالي حتى تعمل transition
 requestAnimationFrame(()=>el.classList.add('toast-in'));
 if(duration)setTimeout(dismiss,duration);
 return dismiss;
}
export function clearToasts(){stack?.querySelectorAll('.toast').forEach(t=>t.remove())}
