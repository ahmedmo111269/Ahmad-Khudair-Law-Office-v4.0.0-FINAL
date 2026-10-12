// إعداد محتوى كل بطاقة/قسم على حدة: ترتيب وإظهار/إخفاء عناصر العرض فقط.
// القيم المحفوظة تفضيلات واجهة في ui:display-prefs؛ لا تُكتب إلى سجلات المكتب.
import {getComponentContent,resolveComponentContent} from '../core/display-prefs.js';

const defaultOrders=new WeakMap();
// صفوف المعلومات الشائعة في وحدات التطبيق، إضافة إلى الحقول المعلّمة صراحةً.
// العناصر التفاعلية لا تدخل تلقائيًا إلا إذا كانت عنصر بيانات اختياريًا معلّمًا.
const ITEM_SELECTORS=[
 '[data-display-part]','[data-display-field]','.kv-item','.info-row','.stat-card','.stat','.kpi','.wc-kpi',
 '.cf-line','.lf-card','.exec-quick-card','.qn-card','.fx-card','.record-case-field',
 '.cf-meta > div','.cf-stats > *','.stats-grid > .stat-card','.quick-head > span',
 '.quick-lines > span','.quick-numbers > .num','.record-case-grid > *','dl > div'
].join(',');
const IGNORE_SELECTOR='[data-display-ignore],.panel-head,.ux-card-head,.sec-actions,.head-actions,.record-actions-menu,.record-actions-disclosure,.record-case-identity-head,.cp-exec-head,.uxc-gear-bar,.uxc-gear,.ux-card-toggle,.ux-card-pin,.ux-card-actions,.collapse-pin,.form-actions,.filter-row,.dg-toolbar,.dg-tools-panel,header,footer,summary,nav,form,[role="toolbar"]';
const INTERACTIVE_SELECTOR='button,a,input,select,textarea,label,[role="button"],[role="tab"],[role="menuitem"]';
const OPTIONAL_INTERACTIVE_SELECTOR='[data-display-optional],[data-display-field],[data-display-part],.kpi,.wc-kpi,.cf-line';
const COMPONENT_SELECTOR='[data-uxc-id]';

function parentComponent(el){
 let node=el?.parentElement||null;
 while(node){if(node.hasAttribute?.('data-uxc-id'))return node;node=node.parentElement}
 return null;
}
function componentTitle(el){
 return el?.dataset?.uxcTitle||el?.querySelector?.('.ux-card-title h3,.panel-head h3,.panel-head h2,.fx-eyebrow,.sp-head>b,h3,h2,b')?.textContent?.trim()||'';
}
function labelText(el){
 const selectors=['dt','.info-k','.stat-label','.kpi-label','.cf-line-main b','.fx-title','.fx-eyebrow','h3','h4','.label','span','strong','b'];
 for(const selector of selectors){
  const node=el?.matches?.(selector)?el:el?.querySelector?.(selector);
  const text=node?.textContent?.trim();
  if(text)return text;
 }
 return '';
}
function inferredLabel(el,index=0){
 return String(
  el?.dataset?.displayLabel||el?.getAttribute?.('aria-label')||el?.getAttribute?.('title')||
  labelText(el)||componentTitle(el)||(el?.classList?.[0]||`جزء ${index+1}`)
 ).trim().replace(/\s+/g,' ').slice(0,120);
}
function safeKey(value){
 return String(value||'').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'-').replace(/^-+|-+$/g,'').slice(0,80);
}
function autoItemKey(el){
 const explicit=String(el.dataset.displayItem||'').trim();
 if(explicit)return explicit;
 const field=String(el.dataset.displayField||el.dataset.fieldKey||'').trim();
 if(field)return `field:${field}`;
 const part=String(el.dataset.displayPart||'').trim();
 if(part)return `part:${part}`;
 const semantic=String(el.dataset.collapseKey||el.dataset.collapseId||el.id||'').trim();
 if(semantic)return `${el.localName||'item'}:${semantic}`;
 const label=safeKey(inferredLabel(el));
 if(label)return `label:${label}`;
 const classes=[...(el.classList||[])].filter(Boolean).sort().join('.');
 const siblings=[...(el.parentElement?.children||[])].filter(sibling=>sibling.localName===el.localName&&[...(sibling.classList||[])].filter(Boolean).sort().join('.')===classes);
 return `part:${el.localName||'item'}:${classes||'plain'}:${Math.max(1,siblings.indexOf(el)+1)}`;
}
function hasProtectedAction(el){
 if(!el?.querySelectorAll)return false;
 const controls=[...el.querySelectorAll(INTERACTIVE_SELECTOR)];
 return controls.some(control=>{
  if(control.matches?.(IGNORE_SELECTOR)||control.closest?.('[data-display-ignore]'))return false;
  if(control.matches?.('[data-display-optional]')||control.closest?.('[data-display-optional],.kpi,.wc-kpi,.cf-line'))return false;
  return true;
 });
}
function isIgnored(el){
 if(!el)return true;
 if(el.closest?.('[data-display-ignore]')||el.matches?.(IGNORE_SELECTOR)||el.hasAttribute?.('data-display-required'))return true;
 if(el.matches?.(INTERACTIVE_SELECTOR)&&!el.matches?.(OPTIONAL_INTERACTIVE_SELECTOR))return true;
 // لا نسمح بإخفاء حقل/مكوّن يحتوي إجراء أو رابطًا مهمًا، إلا إذا وُسِم صراحةً كاختياري.
 if(!el.matches?.(OPTIONAL_INTERACTIVE_SELECTOR)&&!el.hasAttribute?.('data-display-optional')&&!el.hasAttribute?.('data-display-preserve-actions')&&hasProtectedAction(el))return true;
 return false;
}
function contentHost(root){
 const direct=[...(root?.children||[])];
 return direct.find(el=>el.matches?.('.ux-card-body,.sec-body,.fp-kv,.panel-body,.record-tab-panels,.record-tab-panel-content'))||root;
}
function markItem(el,{key='',label=''}={}){
 if(!el?.dataset)return;
 if(!el.dataset.displayItem)el.dataset.displayItem=key||autoItemKey(el);
 if(!el.dataset.displayLabel)el.dataset.displayLabel=label||inferredLabel(el);
}

/** يضع معرّفات مستقرة على حقول العرض والمكوّنات الفرعية مرة واحدة. */
export function prepareComponentContent(root){
 if(!root?.querySelectorAll||root.classList?.contains('uxc-preview'))return [];
 let index=0;
 // حقول وشرائح المؤشرات وبطاقات البيانات المعروفة: التخصيص يخص الحاوية المالكة مباشرةً.
 for(const item of root.querySelectorAll(ITEM_SELECTORS)){
  if(isIgnored(item)||parentComponent(item)!==root)continue;
  markItem(item,{label:inferredLabel(item,index)});index++;
 }
 // البطاقة/القسم المتداخل قابل للترتيب والإخفاء من الحاوية الأم، مع بقاء محتواه مستقلًا.
 for(const item of root.querySelectorAll(COMPONENT_SELECTOR)){
  if(item===root||isIgnored(item)||parentComponent(item)!==root)continue;
  markItem(item,{label:componentTitle(item)||inferredLabel(item,index)});index++;
 }
 // المكونات البسيطة التي ليس لها صفوف دلالية: وفّر عناصر مباشرة بدل خيارات شكلية فارغة.
 const host=contentHost(root);
 const blocks=[...(host?.children||[])].filter(el=>!isIgnored(el)&&!el.matches?.('.uxc-gear-bar'));
 for(const item of blocks){
  if(item.hasAttribute?.('data-display-item')||item.querySelector?.('[data-display-item]'))continue;
  if(item.querySelector?.(INTERACTIVE_SELECTOR)&&!item.matches?.(OPTIONAL_INTERACTIVE_SELECTOR))continue;
  markItem(item,{label:inferredLabel(item,index)});index++;
 }
 return componentContentItems(root,{prepare:false});
}

/** العناصر التي يملك هذا المكوّن التحكم بها مباشرةً؛ لا تتداخل تفضيلات المكونات المتداخلة. */
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
  items.push({
   id,
   label:String(item.dataset.displayLabel||inferredLabel(item,items.length)).trim(),
   el:item,
   parent:item.parentElement,
   defaultHidden:item.dataset.displayDefaultHidden==='true'
  });
 }
 return items;
}

function effectiveLayout(componentId,items){
 const available=items.map(item=>item.id),saved=getComponentContent(componentId);
 const resolved=resolveComponentContent(componentId,available);
 const hidden=new Set(resolved.hidden);
 // الحقول الفارغة من السجل متاحة للإضافة، لكنها لا تزاحم الشاشة قبل اختيار المستخدم.
 // عند أول حفظ عبر لوحة التخصيص تُحفظ هذه الحالة صراحةً ضمن قائمة hidden.
 if(!saved.order.length&&!saved.hidden.length){
  for(const item of items)if(item.defaultHidden)hidden.add(item.id);
 }
 return {order:resolved.order,hidden:[...hidden]};
}

/** تطبيق الإظهار/الإخفاء وإعادة الترتيب بلا إعادة رسم أو تعديل للبيانات. */
export function applyComponentContent(root,componentId){
 if(!root||!componentId)return [];
 const items=componentContentItems(root),available=items.map(item=>item.id),availableSet=new Set(available);
 // احفظ ترتيب DOM الأصلي قبل أي نقل؛ مسح التخصيص يعيد هذا الترتيب الافتراضي.
 const defaultOrder=[...(defaultOrders.get(root)||[])],known=new Set(defaultOrder);
 for(const id of available)if(!known.has(id)){defaultOrder.push(id);known.add(id)}
 defaultOrders.set(root,defaultOrder);
 const saved=getComponentContent(componentId),resolved=effectiveLayout(componentId,items);
 const layout={
  order:saved.order.length?resolved.order:defaultOrder.filter(id=>availableSet.has(id)),
  hidden:resolved.hidden
 };
 const hidden=new Set(layout.hidden),rank=new Map(layout.order.map((id,index)=>[id,index]));
 const groups=new Map();
 for(const item of items){
  const isHidden=hidden.has(item.id);
  const preservedAction=item.el.hasAttribute('data-display-preserve-actions')&&item.el.querySelector('[data-display-action]');
  if(preservedAction){
   // إخفاء المعلومة فقط؛ يبقى إجراء فتح السجل متاحًا بعنوان عام قابل للوصول.
   item.el.classList.remove('ux-content-hidden');
   item.el.querySelectorAll('[data-display-hide-target]').forEach(target=>target.classList.toggle('ux-content-hidden',isHidden));
   item.el.querySelectorAll('[data-display-action-fallback]').forEach(target=>{target.hidden=!isHidden});
  }else item.el.classList.toggle('ux-content-hidden',isHidden);
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

/** تخطيط فعّال للوحة التخصيص ومعاينة حقولها؛ يحتفظ بالعناصر الأصلية كما هي. */
export function resolveComponentContentView(componentId,items){
 return effectiveLayout(componentId,items||[]);
}
