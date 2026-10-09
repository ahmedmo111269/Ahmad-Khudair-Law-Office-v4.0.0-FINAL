import {esc} from './dom.js';
import {icon} from './icons.js';
import {resolveCollapseState,saveCollapseState,toggleCollapsePin,isCollapsePinned,clearCollapseState} from './collapse-state.js';

const titleOf=el=>el?.querySelector?.('h2,h3,h4')?.textContent?.trim()||el?.querySelector?.(':scope > summary')?.textContent?.trim()||'';
const token=value=>String(value||'').trim().toLocaleLowerCase().replace(/\s+/g,'-').replace(/[^\p{L}\p{N}_.:-]/gu,'').slice(0,100)||'section';
const semanticAttrs=['collapseId','sec','actionSection','group','tab','grid','route','store'];
const prefersReducedMotion=()=>{try{return Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches)}catch{return false}};
const isMobileView=()=>{try{return Boolean(globalThis.matchMedia?.('(max-width:700px)').matches)}catch{return false}};

/**
 * فتح مؤقت لمنطقة مطوية يُنتقل إلى محتواها (نتيجة بحث، تنبيه نقص، خطأ تحقق،
 * إضافة سريعة، تنقل لوحة مفاتيح) — يُوسّع سلسلة المناطق الآباء دون تغيير تفضيل
 * المستخدم المحفوظ (persist:false)، ثم يمرّر إلى العنصر ويضع عليه التركيز.
 */
export function openCollapseTransient(target,{scroll=true,focus=true}={}){
 const el=typeof target==='string'?document.querySelector(target):target;
 if(!el)return false;
 const chain=[];
 for(let node=el;node&&node.nodeType===1;node=node.parentElement){
  if(node.dataset?.collapseReady==='true')chain.push(node);
  else if(node.tagName==='DETAILS'&&!node.open)node.open=true;
 }
 for(const region of chain)region.dispatchEvent(new CustomEvent('collapse:bulk',{detail:{collapsed:false,persist:false,target:'all'}}));
 const reduce=prefersReducedMotion();
 if(scroll||focus)requestAnimationFrame(()=>{
  if(scroll)el.scrollIntoView?.({block:'nearest',behavior:reduce?'auto':'smooth'});
  if(focus){try{el.focus?.({preventScroll:true})}catch{try{el.focus?.()}catch{}}}
 });
 return true;
}
/** حارس تركيز: أي عنصر يستقبل التركيز داخل جسم مطوي يُفتح مؤقتًا — لا يُفقد التنقل بلوحة المفاتيح. */
document.addEventListener('focusin',e=>{
 const el=e.target;
 if(!el?.closest)return;
 const hidden=el.closest?.('.panel-collapse-body[aria-hidden="true"],.collapse-region[aria-hidden="true"],.ux-card-body[aria-hidden="true"]');
 if(hidden)openCollapseTransient(el,{scroll:false,focus:false});
});

/**
 * ملخص حي موجز يبقى ظاهرًا في رأس المنطقة حتى بعد الطي (مثل «٣ جلسات، القادمة ٢٥/١٠»).
 * يُحدَّث من المكوّن المالك للبيانات فقط — لا قيم افتراضية ولا أرقام غير مستندة لبيانات.
 */
export function updateCollapseSummary(target,text){
 const region=typeof target==='string'?document.querySelector(`[data-collapse-key="${CSS.escape(target)}"]`):target;
 if(!region)return;
 // قبل/بعد تحسين اللوحة: الرأس قد يكون .panel-head (قبل) أو .panel-collapse-head (بعد).
 let s=region.querySelector(':scope > .panel-head .collapse-summary,:scope > .panel-collapse-head .collapse-summary,:scope > .ux-card-head .collapse-summary');
 if(!s){
  const header=region.querySelector(':scope > .panel-head,:scope > .panel-collapse-head,:scope > .ux-card-head');
  if(!header)return;
  s=document.createElement('span');s.className='collapse-summary';s.dataset.collapseSummary='';
  const title=header.querySelector('h2,h3,h4');
  if(title)title.after(s);else header.append(s);
 }
 s.textContent=String(text||'');
 s.hidden=!text;
 s.setAttribute('title',String(text||''));
}
/** عناصر الرأس الدائمة: الملخص، الشارات، وعلامات التنبيه التي لا تختفي عند الطي. */
const PERSISTENT_HEAD='.badge,.count,.collapse-summary,[data-collapse-summary],[data-collapse-alert]';
function semanticValue(el){
 for(const key of semanticAttrs)if(el?.dataset?.[key])return `${key}:${el.dataset[key]}`;
 return '';
}
function collapseKeyFor(el,scope,kind,title){
 if(el.dataset.collapseKey)return el.dataset.collapseKey;
 const semantic=semanticValue(el);
 const titleToken=token(title);
 const boundary=el.closest('#main-content, #file-tab');
 const parent=el.parentElement;
 const selector=kind==='panel'?'.panel':kind==='section'?'details':kind==='search-group'?'.search-group':'';
 const candidates=selector?[...(boundary||el.ownerDocument).querySelectorAll(selector)] : [el];
 const sameTitle=candidates
  .filter(candidate=>candidate.parentElement===parent&&!candidate.id&&!semanticValue(candidate))
  .filter(candidate=>{
   const header=candidate.matches('.panel')?candidate.querySelector(':scope > .panel-head,:scope > .section-head'):candidate.querySelector(':scope > summary');
   return token(titleOf(header))===titleToken;
  });
 const duplicate=sameTitle.length>1?`:n${sameTitle.indexOf(el)+1}`:'';
 const explicit=el.id||semantic||`${titleToken}${duplicate}`;
 const parents=[];
 for(let p=el.parentElement;p&&p!==el.getRootNode()?.host;p=p.parentElement){
  const ownTitle=p.matches?.('.panel')?titleOf(p.querySelector(':scope > .panel-head,:scope > .section-head')):'';
  const value=semanticValue(p)||p.dataset.collapseKey||p.dataset.cardKey||p.id||(ownTitle?`panel:${ownTitle}`:'');
  if(value)parents.unshift(token(value));
  if(p===boundary)break;
 }
 return `${kind}:${token(scope)}:${parents.length?parents.join('/')+':':''}${token(explicit)}`;
}
function updatePinButton(button,key){
 if(!button)return;
 const pinned=isCollapsePinned(key);
 button.classList.toggle('is-pinned',pinned);
 button.setAttribute('aria-pressed',String(pinned));
 button.setAttribute('aria-label',pinned?'إلغاء تثبيت الحالة':'تثبيت الحالة الحالية');
 button.title=pinned?'إلغاء تثبيت الحالة':'تثبيت الحالة الحالية';
}
export const syncCollapsePin=updatePinButton;
export function collapsePinMarkup(key,pinned=false,className='collapse-pin'){
 return `<button type="button" class="${className}${pinned?' is-pinned':''}" data-collapse-pin="${esc(key)}" aria-label="${pinned?'إلغاء تثبيت الحالة':'تثبيت الحالة الحالية'}" aria-pressed="${Boolean(pinned)}" title="${pinned?'إلغاء تثبيت الحالة':'تثبيت الحالة الحالية'}">${icon('pin')}</button>`;
}
export function bindCollapsePin(button,key,getCollapsed,onChange){
 if(!button||button.dataset.pinBound)return;
 button.dataset.pinBound='true';
 button.addEventListener('click',event=>{
  event.preventDefault();event.stopPropagation();
  toggleCollapsePin(key,Boolean(getCollapsed?.()));
  updatePinButton(button,key);
  onChange?.(isCollapsePinned(key));
 });
}
function updatePanel(panel,collapsed,button,heading,bodyId){
 panel.classList.toggle('card-collapsed',collapsed);
 button.setAttribute('aria-expanded',String(!collapsed));
 button.setAttribute('aria-controls',bodyId);
 button.setAttribute('aria-label',`${collapsed?'توسيع':'طي'} القسم: ${heading}`);
 button.title=collapsed?'توسيع القسم':'طي القسم';
 button.querySelector('.collapse-caret').textContent=collapsed?'›':'⌄';
 const body=panel.querySelector(':scope > .panel-collapse-body');
 if(body){body.hidden=collapsed;body.setAttribute('aria-hidden',String(collapsed))}
}
function addPanelCollapse(panel,scope,index,legacyState){
 if(panel.dataset.collapseReady)return;
 let header=panel.querySelector(':scope > .panel-head,:scope > .section-head');
 if(!header){
  const title=panel.querySelector(':scope > h2,:scope > h3,:scope > h4');
  if(!title)return;
  header=document.createElement('div');header.className='panel-collapse-head';
  panel.insertBefore(header,title);header.append(title);
 }else header.classList.add('panel-collapse-head');
 const heading=titleOf(header)||`قسم ${index+1}`;
 const key=collapseKeyFor(panel,scope,'panel',heading);
 const oldKey=panel.id||`${scope}:${index}:${heading}`;
 const configured=panel.dataset.collapseDefault==='open'||panel.dataset.collapseDefault==='collapsed';
 const fallback=panel.dataset.collapseDefault==='open'?false:true;
 const legacy=typeof legacyState?.[oldKey]==='boolean'?legacyState[oldKey]:undefined;
 const init={fallback,configured,legacy};
 const collapsed=resolveCollapseState(key,{fallback,configured,legacy});
 // الملخص الحي والشارات وعلامات التنبيه عناصر رأس دائمة: تبقى ظاهرة بعد الطي.
 [...panel.children].filter(child=>child!==header&&child.matches?.(PERSISTENT_HEAD)).forEach(child=>header.append(child));
 if(panel.dataset.collapseSummary&&!header.querySelector('.collapse-summary')){
  const s=document.createElement('span');s.className='collapse-summary';s.dataset.collapseSummary='';
  s.textContent=panel.dataset.collapseSummary;header.append(s);
 }
 const body=document.createElement('div');body.className='panel-collapse-body';
 body.id=`collapse-region-${token(key)}`;body.setAttribute('role','region');body.setAttribute('aria-label',heading);
 [...panel.children].filter(child=>child!==header).forEach(child=>body.append(child));
 panel.append(body);
 const button=document.createElement('button');button.type='button';button.className='ghost small card-collapse-toggle collapse-toggle';
 button.innerHTML=`<span class="collapse-caret" aria-hidden="true">${collapsed?'›':'⌄'}</span>`;
 const pin=document.createElement('button');pin.type='button';pin.className='collapse-pin';pin.innerHTML=icon('pin');
 header.append(pin,button);
 panel.dataset.collapseReady='true';panel.dataset.collapseKey=key;panel.dataset.collapseType='panel';panel.dataset.collapseCollapsed=String(collapsed);
 updatePanel(panel,collapsed,button,heading,body.id);
 const apply=(next,persist)=>{
  panel.dataset.collapseCollapsed=String(next);updatePanel(panel,next,button,heading,body.id);
  if(persist){saveCollapseState(key,next);syncCollapsePin(pin,key)}
 };
 button.addEventListener('click',()=>{
  const next=!panel.classList.contains('card-collapsed');
  apply(next,true);
  accordionCloseSiblings(panel,next);
 });
 panel.addEventListener('collapse:bulk',event=>{
  const detail=event.detail||{};
  apply(Boolean(detail.collapsed),detail.persist!==false);
 });
 panel.addEventListener('collapse:reset',()=>{
  clearCollapseState(key);
  apply(resolveCollapseState(key,init),false);
  syncCollapsePin(pin,key);
 });
 header.addEventListener('click',event=>{
  if(event.target.closest('button,a,input,select,textarea,[data-no-collapse]'))return;
  button.click();
 });
 bindCollapsePin(pin,key,()=>panel.classList.contains('card-collapsed'));
}
/** وضع الأكورديون على الهاتف: فتح قسم واحد داخل الحاوية الموسومة data-collapse-accordion. */
function accordionCloseSiblings(region,nowCollapsed){
 if(nowCollapsed)return;
 const box=region.closest?.('[data-collapse-accordion]');
 if(!box||!isMobileView())return;
 for(const sibling of box.querySelectorAll('[data-collapse-ready="true"]')){
  if(sibling===region||sibling.dataset.collapseCollapsed==='true')continue;
  sibling.dispatchEvent(new CustomEvent('collapse:bulk',{detail:{collapsed:true,persist:false,target:'all'}}));
 }
}
function addDetailsCollapse(details,scope,index){
 if(details.dataset.collapseReady)return;
 const summary=details.querySelector(':scope > summary');if(!summary)return;
 const heading=summary.querySelector('[data-collapse-title]')?.textContent?.trim()||summary.querySelector('span')?.textContent?.trim()||summary.textContent.trim()||`قسم ${index+1}`;
 const key=collapseKeyFor(details,scope,'section',heading);
 const configured=details.dataset.collapseDefault==='open'||details.dataset.collapseDefault==='collapsed';
 const fallback=details.dataset.collapseDefault==='open'?false:true;
 const collapsed=resolveCollapseState(key,{fallback,configured});
 details.dataset.collapseReady='true';details.dataset.collapseKey=key;details.dataset.collapseType='details';details.dataset.collapseCollapsed=String(collapsed);
 details.open=!collapsed;
 const body=document.createElement('div');body.className='collapse-region details-collapse-body';body.id=`collapse-region-${token(key)}`;body.setAttribute('role','region');body.setAttribute('aria-label',heading);
 [...details.children].filter(child=>child!==summary).forEach(child=>body.append(child));details.append(body);
 const button=document.createElement('button');button.type='button';button.className='collapse-pin';button.innerHTML=icon('pin');
 summary.append(button);
 const sync=()=>{
  const isClosed=!details.open;
  details.dataset.collapseCollapsed=String(isClosed);
  summary.setAttribute('aria-expanded',String(details.open));
  summary.setAttribute('aria-controls',body.id);
  body.setAttribute('aria-hidden',String(isClosed));
 };
 summary.setAttribute('aria-controls',body.id);sync();
 let ignoreInitial=true,programmaticOpen=null;setTimeout(()=>{ignoreInitial=false},0);
 details.addEventListener('toggle',()=>{
  sync();
  if(ignoreInitial)return;
  if(programmaticOpen!==null&&details.open===programmaticOpen){programmaticOpen=null;return}
  programmaticOpen=null;
  saveCollapseState(key,!details.open);syncCollapsePin(button,key);
 });
 details.addEventListener('collapse:bulk',event=>{
  const detail=event.detail||{};const next=Boolean(detail.collapsed);const open=!next;
  if(details.open!==open){programmaticOpen=open;details.open=open}
  sync();
  if(detail.persist!==false){saveCollapseState(key,next);syncCollapsePin(button,key)}
 });
 details.addEventListener('collapse:reset',()=>{
  clearCollapseState(key);
  const next=resolveCollapseState(key,{fallback,configured});const open=!next;
  if(details.open!==open){programmaticOpen=open;details.open=open}
  sync();syncCollapsePin(button,key);
 });
 bindCollapsePin(button,key,()=>!details.open);
}
function addSearchGroupCollapse(group,scope,index){
 if(group.dataset.collapseReady)return;
 const header=group.querySelector(':scope > .section-head');
 const title=titleOf(header);
 if(!header||!title)return;
 const key=collapseKeyFor(group,scope,'search-group',title);
 const collapsed=resolveCollapseState(key,{fallback:true});
 const rows=[...group.children].filter(x=>x!==header);
 const body=document.createElement('div');body.className='collapse-region search-group-content';body.id=`collapse-region-${token(key)}`;
 rows.forEach(x=>body.append(x));group.append(body);
 const button=document.createElement('button');button.type='button';button.className='ghost small collapse-toggle';button.innerHTML=`<span class="collapse-caret" aria-hidden="true">${collapsed?'›':'⌄'}</span>`;
 const pin=document.createElement('button');pin.type='button';pin.className='collapse-pin';pin.innerHTML=icon('pin');
 header.append(pin,button);
 group.dataset.collapseReady='true';group.dataset.collapseKey=key;group.dataset.collapseType='group';group.dataset.collapseCollapsed=String(collapsed);
 const apply=next=>{group.dataset.collapseCollapsed=String(next);body.hidden=next;body.setAttribute('aria-hidden',String(next));button.setAttribute('aria-expanded',String(!next));button.setAttribute('aria-controls',body.id);button.setAttribute('aria-label',`${next?'توسيع':'طي'} نتائج ${title}`);button.title=next?'توسيع النتائج':'طي النتائج';button.querySelector('.collapse-caret').textContent=next?'›':'⌄'};
 apply(collapsed);
 button.addEventListener('click',()=>{const next=group.dataset.collapseCollapsed!=='true';apply(next);saveCollapseState(key,next);syncCollapsePin(pin,key);accordionCloseSiblings(group,next)});
 group.addEventListener('collapse:bulk',event=>{const detail=event.detail||{};const next=Boolean(detail.collapsed);apply(next);if(detail.persist!==false){saveCollapseState(key,next);syncCollapsePin(pin,key)}});
 group.addEventListener('collapse:reset',()=>{clearCollapseState(key);apply(resolveCollapseState(key,{fallback:true}),false);syncCollapsePin(pin,key)});
 header.addEventListener('click',event=>{if(event.target.closest('button,a,input,select,textarea,[data-no-collapse]'))return;button.click()});
 bindCollapsePin(pin,key,()=>group.dataset.collapseCollapsed==='true');
}

function addPageCollapseTools(root){
 let control=[...root.children].find(child=>child.classList?.contains('collapse-page-tools'))||null;
 const items=[...root.querySelectorAll('[data-collapse-ready="true"]')];
 if(items.length<2){control?.remove();return}
 if(control){const count=control.querySelector('.collapse-page-count');if(count)count.textContent=`${items.length} عناصر`;return}
 control=document.createElement('details');control.className='collapse-page-tools';
 control.innerHTML=`<summary><span>الأقسام والجداول</span><small class="collapse-page-count">${items.length} عناصر</small></summary><div class="collapse-page-actions"><button type="button" class="ghost small" data-collapse-bulk="open">فتح الكل</button><button type="button" class="ghost small" data-collapse-bulk="closed">طي الكل</button><button type="button" class="ghost small" data-collapse-reset title="إعادة كل الأقسام للحالة الافتراضية ومسح تفضيلاتها المحفوظة في هذه الصفحة">استعادة الافتراضي</button><label><input type="checkbox" data-collapse-bulk-save> حفظ هذه الحالة</label><small class="muted">بدون تفعيل الحفظ، يقتصر التغيير على العرض الحالي. يمكن تثبيت العناصر منفردة من رمز الدبوس.</small></div>`;
 const anchor=root.querySelector('.page-head,.record-head,.hero')||null;
 if(anchor?.parentElement)anchor.after(control);else root.prepend(control);
 control.addEventListener('click',event=>{
  const all=[...root.querySelectorAll('[data-collapse-ready="true"]')];
  if(event.target.closest('[data-collapse-reset]')){
   for(const item of all)item.dispatchEvent(new CustomEvent('collapse:reset'));
   control.open=false;
   return;
  }
  const button=event.target.closest('[data-collapse-bulk]');if(!button)return;
  const collapsed=button.dataset.collapseBulk==='closed';
  const persist=Boolean(control.querySelector('[data-collapse-bulk-save]')?.checked);
  const detail={collapsed,persist,target:'all'};
  for(const item of all)item.dispatchEvent(new CustomEvent('collapse:bulk',{detail}));
  control.open=false;
 });
}

/** Add accessible, independently persisted collapse controls to data panels and sections. */
export function enhanceCollapsiblePanels(root,scope='page',options={}){
 if(!root?.querySelectorAll)return;
 const legacy=prefsLegacyPanels();
 [...root.querySelectorAll('.panel')].forEach((panel,index)=>addPanelCollapse(panel,scope,index,legacy));
 [...root.querySelectorAll('details:not(.collapse-page-tools):not([data-collapse-ignore])')].forEach((details,index)=>addDetailsCollapse(details,scope,index));
 [...root.querySelectorAll('.search-group')].forEach((group,index)=>addSearchGroupCollapse(group,scope,index));
 if(options.bulk!==false)addPageCollapseTools(root);
}
function prefsLegacyPanels(){
 // Read-only migration path for v5.2's original panel preference map.
 try{return JSON.parse(localStorage.getItem('akl:prefs:ui:collapsed-panels')||'null')||{}}catch{return {}}
}
