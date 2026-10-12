// إعداد محتوى كل بطاقة/قسم على حدة: ترتيب وإظهار/إخفاء عناصر العرض فقط.
// القيم المحفوظة تفضيلات واجهة في ui:display-prefs؛ لا تُكتب إلى سجلات المكتب.
import {getComponentContent,resolveComponentContent} from '../core/display-prefs.js';

const defaultOrders=new WeakMap();
const ITEM_SELECTORS='[data-display-part],.kv-item,.info-row,.fx-card,.stat-card,.lf-card,.exec-quick-card,.qn-card';
const IGNORE_SELECTOR='[data-display-ignore],.panel-head,.ux-card-head,.sec-actions,.head-actions,.record-actions-menu,.record-actions-disclosure,.record-case-identity-head,.cp-exec-head,.uxc-gear-bar,.uxc-gear,.ux-card-toggle,.ux-card-pin,.collapse-pin,header,footer,summary,nav,button,a,input,select,textarea,label,[role="toolbar"]';
const COMPONENT_SELECTOR='[data-uxc-id]';

function parentComponent(el){
 let node=el?.parentElement||null;
 while(node){if(node.hasAttribute?.('data-uxc-id'))return node;node=node.parentElement}
 return null;
}
function componentTitle(el){
 return el?.dataset?.uxcTitle||el?.querySelector?.('.ux-card-title h3,.panel-head h3,.panel-head h2,.fx-eyebrow,.sp-head>b,h3,h2,b')?.textContent?.trim()||'';
}
function autoItemKey(el){
 const explicit=String(el.dataset.displayItem||'').trim();
 if(explicit)return explicit;
 const componentId=String(el.dataset.uxcId||'').trim();
 if(componentId)return `component:${componentId}`;
 const semantic=String(el.dataset.displayPart||el.dataset.collapseKey||el.dataset.collapseId||el.id||'').trim();
 if(semantic)return `${el.localName||'item'}:${semantic}`;
 const classes=[...(el.classList||[])].filter(Boolean).sort().join('.');
 const siblings=[...(el.parentElement?.children||[])].filter(sibling=>sibling.localName===el.localName&&[...(sibling.classList||[])].filter(Boolean).sort().join('.')===classes);
 return `part:${el.localName||'item'}:${classes||'plain'}:${Math.max(1,siblings.indexOf(el)+1)}`;
}
function inferredLabel(el,index=0){
 return String(
  el?.dataset?.displayLabel||
  el?.getAttribute?.('aria-label')||
  el?.getAttribute?.('title')||
  el?.querySelector?.('dt,.fx-title,.fx-eyebrow,h3,h4,strong,b,.info-k')?.textContent||
  componentTitle(el)||
  (el?.classList?.[0]||`جزء ${index+1}`)
 ).trim().replace(/\s+/g,' ').slice(0,120);
}
function markItem(el,{key='',label=''}={}){
 if(!el?.dataset)return;
 if(!el.dataset.displayItem)el.dataset.displayItem=key||autoItemKey(el);
 if(!el.dataset.displayLabel)el.dataset.displayLabel=label||inferredLabel(el);
}
function isIgnored(el){
 return !el||el.matches?.(IGNORE_SELECTOR)||el.closest?.('[data-display-ignore]');
}
function contentHost(root){
 const direct=[...(root?.children||[])];
 return direct.find(el=>el.matches?.('.ux-card-body,.sec-body,.fp-kv,.panel-body,.record-tab-panels,.record-tab-panel-content'))||root;
}

/** يضع معرّفات مستقرة على حقول العرض والمكوّنات الفرعية مرة واحدة. */
export function prepareComponentContent(root){
 if(!root?.querySelectorAll||root.classList?.contains('uxc-preview'))return [];
 let index=0;
 // الحقول/الأجزاء المعروفة: بيانات KV، صفوف المعلومات، البطاقات التابعة…
 for(const item of root.querySelectorAll(ITEM_SELECTORS)){
  if(isIgnored(item)||parentComponent(item)!==root)continue;
  markItem(item,{label:inferredLabel(item,index)});index++;
 }
 // البطاقة أو القسم المتداخل يمكن ترتيبه/إخفاؤه من الحاوية الأم، مع بقاء تخصيصه الداخلي مستقلًا.
 for(const item of root.querySelectorAll(COMPONENT_SELECTOR)){
  if(item===root||isIgnored(item)||parentComponent(item)!==root)continue;
  markItem(item,{label:componentTitle(item)||inferredLabel(item,index)});index++;
 }
 // في المكونات التي لا تحمل حقولًا معنونة، نوفر تحكمًا على مستوى كتل المحتوى المباشرة.
 if(!root.querySelector('[data-display-item]')){
  const host=contentHost(root);
  const blocks=[...(host?.children||[])].filter(el=>!isIgnored(el)&&!el.matches?.('.uxc-gear-bar'));
  blocks.forEach((item,i)=>markItem(item,{label:inferredLabel(item,i)}));
 }
 return componentContentItems(root,{prepare:false});
}

/** العناصر التي يملك هذا المكوّن التحكم بها مباشرةً؛ لا تتداخل تفضيلات المكوّنات المتداخلة. */
export function componentContentItems(root,{prepare=true}={}){
 if(!root?.querySelectorAll)return [];
 if(prepare)prepareComponentContent(root);
 const items=[],seen=new Set();
 for(const item of root.querySelectorAll('[data-display-item]')){
  if(isIgnored(item)||parentComponent(item)!==root)continue;
  let id=String(item.dataset.displayItem||'').trim();
  if(!id)continue;
  if(seen.has(id)){
   let suffix=2;while(seen.has(`${id}:${suffix}`))suffix++;
   id=`${id}:${suffix}`;
   item.dataset.displayItem=id;
  }
  seen.add(id);
  items.push({id,label:String(item.dataset.displayLabel||inferredLabel(item,items.length)).trim(),el:item,parent:item.parentElement});
 }
 return items;
}

/** تطبيق الإظهار والإخفاء وإعادة الترتيب بلا إعادة رسم للبيانات. */
export function applyComponentContent(root,componentId){
 if(!root||!componentId)return [];
 const items=componentContentItems(root),available=items.map(item=>item.id),availableSet=new Set(available);
 // احفظ ترتيب DOM الأصلي قبل أي نقل؛ حتى يعيد مسح التخصيص الترتيب الافتراضي
 // بدل اعتبار الترتيب المعدّل هو الافتراضي الجديد.
 const defaultOrder=[...(defaultOrders.get(root)||[])],known=new Set(defaultOrder);
 for(const id of available)if(!known.has(id)){defaultOrder.push(id);known.add(id)}
 defaultOrders.set(root,defaultOrder);
 const saved=getComponentContent(componentId),resolved=resolveComponentContent(componentId,available);
 const layout={
  order:saved.order.length?resolved.order:defaultOrder.filter(id=>availableSet.has(id)),
  hidden:resolved.hidden
 };
 const hidden=new Set(layout.hidden),rank=new Map(layout.order.map((id,index)=>[id,index]));
 const groups=new Map();
 for(const item of items){
  const isHidden=hidden.has(item.id);
  item.el.classList.toggle('ux-content-hidden',isHidden);
  item.el.dataset.contentHidden=String(isHidden);
  if(!groups.has(item.parent))groups.set(item.parent,[]);
  groups.get(item.parent).push(item);
 }
 for(const [parent,group] of groups){
  const sorted=[...group].sort((a,b)=>(rank.get(a.id)??Number.MAX_SAFE_INTEGER)-(rank.get(b.id)??Number.MAX_SAFE_INTEGER));
  if(sorted.every((item,index)=>item===group[index]))continue;
  const slots=group.map(item=>{
   const marker=document.createComment('ux-content-slot');
   parent.insertBefore(marker,item.el);parent.removeChild(item.el);return marker;
  });
  sorted.forEach((item,index)=>parent.insertBefore(item.el,slots[index]||null));
  slots.forEach(marker=>marker.remove());
 }
 return items;
}
