// عرض وإدخال التاريخ بصيغة يوم/شهر/سنة في كل الحقول، مع الإبقاء على input[type=date] الأصلي
// (قيمته ISO) حتى لا تتغير أي شيفرة تقرأ النماذج. يعمل تلقائيًا على أي حقل تاريخ يُضاف للصفحة.
import {formatDate,parseDisplayDate} from '../core/format.js';
const desc=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');
function enhance(native){
 if(native.dataset.dmy||native.closest('[data-native-date]'))return;
 native.dataset.dmy='1';
 const wrap=document.createElement('span');wrap.className='dmy';
 const txt=document.createElement('input');
 txt.type='text';txt.className='dmy-text '+(native.className||'');txt.inputMode='numeric';txt.autocomplete='off';
 txt.placeholder='يوم/شهر/سنة';txt.dir='ltr';txt.maxLength=10;
 if(native.getAttribute('aria-label'))txt.setAttribute('aria-label',native.getAttribute('aria-label'));
 if(native.id){txt.id=native.id+'__dmy';const lbl=document.querySelector(`label[for="${CSS.escape(native.id)}"]`);if(lbl)lbl.htmlFor=txt.id}
 txt.disabled=native.disabled;txt.readOnly=native.readOnly;txt.required=native.required;
 const btn=document.createElement('button');btn.type='button';btn.className='dmy-btn';btn.tabIndex=-1;btn.setAttribute('aria-label','اختيار من التقويم');btn.textContent='📅';
 native.parentNode.insertBefore(wrap,native);wrap.append(txt,btn,native);
 native.classList.add('dmy-native');native.tabIndex=-1;native.setAttribute('aria-hidden','true');
 const sync=()=>{if(document.activeElement!==txt)txt.value=formatDate(desc.get.call(native))};
 Object.defineProperty(native,'value',{configurable:true,get(){return desc.get.call(this)},set(v){desc.set.call(this,v);sync()}});
 sync();
 const fire=()=>{native.dispatchEvent(new Event('input',{bubbles:true}));native.dispatchEvent(new Event('change',{bubbles:true}))};
 txt.addEventListener('input',()=>{
  // إدراج الشرطات تلقائيًا أثناء الكتابة
  let v=txt.value.replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[^\d\/]/g,'');
  if(/^\d{3}$/.test(v))v=v.slice(0,2)+'/'+v.slice(2);if(/^\d{2}\/\d{3}$/.test(v))v=v.slice(0,5)+'/'+v.slice(5);
  txt.value=v;const iso=parseDisplayDate(v);
  wrap.classList.toggle('dmy-invalid',Boolean(v)&&!iso);
  if(iso||!v){if(desc.get.call(native)!==iso){desc.set.call(native,iso);fire()}}
 });
 txt.addEventListener('blur',()=>{if(!wrap.classList.contains('dmy-invalid'))txt.value=formatDate(desc.get.call(native))});
 native.addEventListener('change',()=>{wrap.classList.remove('dmy-invalid');txt.value=formatDate(desc.get.call(native))});
 btn.addEventListener('click',()=>{if(native.disabled||native.readOnly)return;try{native.showPicker()}catch{native.focus();native.click()}});
 new MutationObserver(()=>{txt.disabled=native.disabled;txt.readOnly=native.readOnly}).observe(native,{attributes:true,attributeFilter:['disabled','readonly']});
}
export function installDateInputs(root=document.body){
 const scan=n=>{if(n.nodeType!==1)return;if(n.matches?.('input[type=date]'))enhance(n);n.querySelectorAll?.('input[type=date]').forEach(enhance)};
 scan(root);
 new MutationObserver(ms=>{for(const m of ms)m.addedNodes.forEach(scan)}).observe(root,{childList:true,subtree:true});
}
