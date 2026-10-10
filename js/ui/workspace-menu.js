// قوائم منسدلة عامة لواجهة مساحة العمل (RTL): فتح/إغلاق سريع، محاذاة يمين،
// إغلاق بالنقر خارجها أو Escape، ودعم لوحة المفاتيح ومكدّس الطبقات العلوية.
import {open as overlayOpen} from './overlay-stack.js';

let current=null;

export function closeWorkspaceMenu(){
 if(!current)return;
 try{current.release?.()}catch{/* متجاهَل */}
 document.removeEventListener('mousedown',current.outside,true);
 document.removeEventListener('keydown',current.onKey,true);
 if(current.owned)current.el.remove();
 else{
  current.el.hidden=true;
  current.el.classList.remove('is-open');
  current.el.style.top='';
  current.el.style.left='';
  current.el.style.width='';
  current.el.style.maxHeight='';
 }
 current.btn?.setAttribute('aria-expanded','false');
 try{current.onClose?.()}catch{/* متجاهَل */}
 current=null;
}

export function isWorkspaceMenuOpen(){return Boolean(current)}
export function workspaceMenuEl(){return current?.el||null}

export function positionMenu(el,anchor,{width=320,maxHeight=null}={}){
 const r=anchor.getBoundingClientRect();
 const w=Math.min(Math.max(180,width),window.innerWidth-16);
 el.style.width=w+'px';
 el.style.position='fixed';
 el.style.zIndex='240';
 let left=r.right-w;
 if(left<8)left=8;
 if(left+w>window.innerWidth-8)left=window.innerWidth-8-w;
 const cap=maxHeight||Math.min(window.innerHeight-16,Math.floor(window.innerHeight*0.72));
 el.style.maxHeight=cap+'px';
 const h=el.offsetHeight||Math.min(cap,240);
 let top=r.bottom+4;
 if(top+h>window.innerHeight-8)top=Math.max(8,r.top-h-4);
 if(top+h>window.innerHeight-8)top=Math.max(8,window.innerHeight-h-8);
 el.style.left=left+'px';
 el.style.top=top+'px';
}

export function openWorkspaceMenu(btn,opts={}){
 if(!btn)return null;
 if(current?.btn===btn){closeWorkspaceMenu();return null}
 closeWorkspaceMenu();
 let el=opts.el||null;
 let owned=false;
 if(!el){
  el=document.createElement('div');
  el.className=opts.className||'fw-pop';
  el.setAttribute('role',opts.role||'menu');
  if(opts.label)el.setAttribute('aria-label',opts.label);
  el.innerHTML=opts.html||'';
  document.body.append(el);
  owned=true;
 }else{
  el.hidden=false;
  el.classList.add('is-open');
  if(!el.getAttribute('role'))el.setAttribute('role',opts.role||'dialog');
 }
 el.classList.add('fw-pop');
 positionMenu(el,btn,{width:opts.width||Math.min(380,el.scrollWidth||320),maxHeight:opts.maxHeight});
 btn.setAttribute('aria-expanded','true');
 const outside=e=>{
  if(el.contains(e.target)||btn.contains(e.target))return;
  if(e.target?.closest?.('.dg-pop,.theme-menu,.modal-backdrop'))return;
  closeWorkspaceMenu();
 };
 const onKey=e=>{
  if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeWorkspaceMenu();btn.focus();return}
  if(/INPUT|TEXTAREA|SELECT/.test(e.target?.tagName||''))return;
  if(e.key!=='ArrowDown'&&e.key!=='ArrowUp'&&e.key!=='Home'&&e.key!=='End')return;
  const items=[...el.querySelectorAll('button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])')]
   .filter(x=>x.offsetParent!==null||x===document.activeElement);
  if(!items.length)return;
  e.preventDefault();
  const i=items.indexOf(document.activeElement);
  let n=0;
  if(e.key==='ArrowDown')n=i<0?0:(i+1)%items.length;
  else if(e.key==='ArrowUp')n=i<=0?items.length-1:i-1;
  else if(e.key==='End')n=items.length-1;
  items[n]?.focus();
 };
 const release=overlayOpen('workspace-menu',()=>{closeWorkspaceMenu();return true});
 setTimeout(()=>document.addEventListener('mousedown',outside,true),0);
 document.addEventListener('keydown',onKey,true);
 current={el,btn,outside,onKey,release,owned,onClose:opts.onClose};
 const focus=el.querySelector('input,select,button,textarea');
 try{focus?.focus({preventScroll:true})}catch{try{focus?.focus()}catch{}}
 return el;
}
