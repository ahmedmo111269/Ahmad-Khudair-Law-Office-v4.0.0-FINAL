// =====================================================================
// الشريط الجانبي الموحّد — v5.0
// =====================================================================
// • سطح المكتب: وضع كامل (أيقونة + اسم) ووضع مطوي (أيقونات فقط + تلميحات).
// • الهاتف: قائمة جانبية قابلة للفتح والإغلاق بخلفية معتمة، تُغلق تلقائيًا
//   بعد اختيار الصفحة، ولا تسبب تمريرًا أفقيًا.
// • الحالة محفوظة في تفضيلات المستخدم: الطي (ui:sidebar-collapsed)
//   وطي الأقسام (ui:nav-groups).
// • التنقل فوري بدون إعادة تحميل الصفحة، مع حالة نشطة واضحة (aria-current).
import {icon} from './icons.js';
import {prefs} from '../core/preferences.js';

export const COLLAPSE_KEY='ui:sidebar-collapsed';
export const GROUPS_KEY='ui:nav-groups';
export const MOBILE_BP='(max-width:900px)';

// أسماء عناصر القائمة بعد مراجعة التكرار والتضارب وتوحيدها في كل التطبيق.
// كل عنصر يستخدم نفس مسارات التنقل (routes) السابقة — لا تغيير في الوظائف.
export const NAV_GROUPS=[
 {id:'general',label:'عام',items:[
  {route:'dashboard',label:'الرئيسية',icon:'home'},
  {route:'actionCenter',label:'مركز العمل',icon:'target'}]},
 {id:'data',label:'البيانات الأساسية',items:[
  {route:'files',label:'الملفات',icon:'folder'},
  {route:'clients',label:'الموكلون',icon:'users'},
  {route:'opponents',label:'الخصوم',icon:'userX'},
  {route:'cases',label:'القضايا والمراحل',icon:'gavel'},
  {route:'powersOfAttorney',label:'التوكيلات',icon:'stamp'}]},
 {id:'daily',label:'العمل اليومي',items:[
  {route:'hearings',label:'الجلسات',icon:'calendar'},
  {route:'procedures',label:'الأعمال الإدارية',icon:'clipboard'},
  {route:'serviceRecords',label:'الإعلانات والمحضرون',icon:'send'},
  {route:'bailiffs',label:'دليل المحضرين',icon:'userCheck'},
  {route:'appointments',label:'المواعيد',icon:'clock'},
  {route:'communications',label:'الاتصالات',icon:'phone'},
  {route:'caseNotes',label:'الملاحظات',icon:'note'}]},
 {id:'judicial',label:'القضائي والمالي',items:[
  {route:'judgments',label:'الأحكام',icon:'landmark'},
  {route:'expertReports',label:'تقارير الخبراء',icon:'microscope'},
  {route:'execution',label:'التنفيذ',icon:'hammer'},
  {route:'fees',label:'الأتعاب والمدفوعات',icon:'wallet'},
  {route:'documentReferences',label:'المستندات',icon:'file'}]},
 {id:'insight',label:'التحليل والتقارير',items:[
  {route:'search',label:'البحث الشامل',icon:'search'},
  {route:'reports',label:'التقارير',icon:'report'},
  {route:'analytics',label:'الإحصاءات',icon:'chart'}]},
 {id:'system',label:'النظام',items:[
  {route:'integrity',label:'سلامة البيانات',icon:'shield'},
  {route:'repair',label:'الإصلاح والاسترداد',icon:'wrench'},
  {route:'databases',label:'قواعد البيانات',icon:'database'},
  {route:'backup',label:'النسخ الاحتياطي',icon:'save'},
  {route:'settings',label:'الإعدادات',icon:'settings'}]}
];

const BRAND=`<div class="brand"><span class="brand-mark" aria-hidden="true">${icon('scale')}</span><div class="brand-txt"><strong>مكتب الأستاذ</strong><span>أحمد محمد خضير المحامي</span></div></div>`;

/** بناء الشريط الجانبي داخل العنصر #sidebar (يُستدعى مرة واحدة عند الإقلاع). */
export function buildSidebar(){
 const sb=document.querySelector('#sidebar');
 if(!sb||sb.dataset.ready)return sb;
 const groupState=prefs.get(GROUPS_KEY,{})||{};
 sb.setAttribute('aria-label','التنقل الرئيسي');
 // خلفية معتمة لقائمة الهاتف: النقر خارجها يغلق القائمة
 let backdrop=document.querySelector('#sidebar-backdrop');
 if(!backdrop){backdrop=document.createElement('div');backdrop.id='sidebar-backdrop';backdrop.hidden=true;document.body.append(backdrop)}
 backdrop.onclick=()=>closeMobile();
 sb.innerHTML=`
  ${BRAND}
  <button type="button" class="sb-close icon-only" id="sb-close" aria-label="إغلاق القائمة الجانبية">${icon('x')}</button>
  <button type="button" class="sb-collapse" id="sb-collapse" aria-pressed="false" title="طي / توسيع الشريط">${icon('panelCollapse')}<span class="sb-collapse-txt">طي الشريط</span></button>
  <nav id="main-nav">${NAV_GROUPS.map(g=>{
   const open=groupState[g.label]!==false;
   return `<section class="nav-group${open?'':' is-closed'}" data-group="${g.id}">
    <button type="button" class="nav-group-head" aria-expanded="${open}" data-group-toggle="${g.id}"><span class="ng-label">${g.label}</span>${icon('chevron','ng-chev')}</button>
    <div class="nav-group-items" role="group" aria-label="${g.label}">${g.items.map(it=>`<button type="button" data-route="${it.route}" data-tip="${it.label}">${icon(it.icon)}<span class="nav-label">${it.label}</span></button>`).join('')}</div>
   </section>`;
  }).join('')}</nav>
  <div class="sb-foot"><span class="sb-db" id="sb-db-name"></span></div>`;
 sb.dataset.ready='1';
 bindSidebar();
 return sb;
}

function bindSidebar(){
 const sb=document.querySelector('#sidebar');if(!sb)return;
 // زر الطي/التوسيع على سطح المكتب
 sb.querySelector('#sb-collapse')?.addEventListener('click',()=>toggleCollapsed());
 // طي/فتح الأقسام مع حفظ التفضيل
 sb.querySelectorAll('[data-group-toggle]').forEach(head=>{
  head.addEventListener('click',()=>{
   const sec=head.closest('.nav-group');if(!sec)return;
   const closed=sec.classList.toggle('is-closed');
   head.setAttribute('aria-expanded',String(!closed));
   const g=NAV_GROUPS.find(x=>x.id===head.dataset.groupToggle);
   const state=prefs.get(GROUPS_KEY,{})||{};
   state[g?g.label:head.dataset.groupToggle]=!closed; // المفتاح بالاسم العربي للتوافق مع التفضيلات السابقة
   prefs.set(GROUPS_KEY,state);
  });
 });
 // وضع الهاتف: زر الإغلاق داخل الشريط
 sb.querySelector('#sb-close')?.addEventListener('click',()=>closeMobile());
}

export function isDesktop(){return !window.matchMedia(MOBILE_BP).matches}

/** طي/توسيع الشريط على سطح المكتب مع حفظ الحالة. */
export function toggleCollapsed(force){
 const collapsed=force!==undefined?Boolean(force):!document.body.classList.contains('sidebar-collapsed');
 document.body.classList.toggle('sidebar-collapsed',collapsed);
 if(isDesktop())prefs.set(COLLAPSE_KEY,collapsed);
 const btn=document.querySelector('#sb-collapse');
 if(btn){btn.setAttribute('aria-pressed',String(collapsed));btn.querySelector('.sb-collapse-txt').textContent=collapsed?'توسيع الشريط':'طي الشريط'}
 document.querySelector('#mobile-menu')?.setAttribute('aria-expanded',String(!collapsed));
 return collapsed;
}
export function isCollapsed(){return document.body.classList.contains('sidebar-collapsed')}

/** فتح/إغلاق قائمة الهاتف مع الخلفية المعتمة. */
export function toggleMobile(force){
 const sb=document.querySelector('#sidebar');if(!sb)return;
 const open=force!==undefined?Boolean(force):!sb.classList.contains('open');
 sb.classList.toggle('open',open);
 const bd=document.querySelector('#sidebar-backdrop');if(bd)bd.hidden=!open;
 document.body.classList.toggle('sidebar-open',open);
 document.querySelector('#mobile-menu')?.setAttribute('aria-expanded',String(open));
 if(open)sb.querySelector('#main-nav button:not([hidden])')?.focus({preventScroll:true});
}
export const closeMobile=()=>{if(!isDesktop())toggleMobile(false)};

/** تحديد العنصر النشط حسب المسار الحالي (يُستدعى من App.go). */
export function setActiveRoute(navKey){
 document.querySelectorAll('#sidebar [data-route]').forEach(b=>{
  const on=b.dataset.route===navKey;
  b.classList.toggle('active',on);
  if(on)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');
 });
 // المجموعة المحتوية على العنصر النشط تُفتح تلقائيًا حتى يظهر للمستخدم
 const active=document.querySelector(`#sidebar [data-route="${CSS.escape?.(navKey)||navKey}"]`);
 const sec=active?.closest('.nav-group.is-closed');
 if(sec){sec.classList.remove('is-closed');sec.querySelector('.nav-group-head')?.setAttribute('aria-expanded','true')}
}

/** تطبيق الحالة المحفوظة عند الإقلاع. */
export function initSidebarState(){
 const collapsed=isDesktop()&&Boolean(prefs.get(COLLAPSE_KEY,false));
 document.body.classList.toggle('sidebar-collapsed',collapsed);
 const btn=document.querySelector('#sb-collapse');
 if(btn){btn.setAttribute('aria-pressed',String(collapsed));btn.querySelector('.sb-collapse-txt').textContent=collapsed?'توسيع الشريط':'طي الشريط'}
 document.querySelector('#mobile-menu')?.setAttribute('aria-expanded',String(!collapsed));
 // عند العبور بين وضع الهاتف وسطح المكتب نزيل آثار الوضع الآخر
 window.matchMedia(MOBILE_BP).addEventListener?.('change',e=>{
  if(!e.matches)closeMobile();
 });
}
