// الإعدادات: معلومات الإصدار، إدارة القوائم (lookups) القابلة للتعديل، وأدوات صيانة غير مدمرة.
import {esc} from '../ui/dom.js';
import {toast} from '../ui/toast.js';
import {confirmBox} from '../ui/modal.js';
import {LOOKUP_CATEGORIES} from '../domain/lookup-defaults.js';
import {lookupRows,saveLookupValue,removeLookupValue,moveLookupValue,seedLookups} from '../services/lookups.js';
import {rebuildAllFileSearchText} from '../services/legal-files.js';
import {migrateLegacyParties} from '../services/maintenance.js';
import {userError} from '../core/errors.js';
import {renderAppearance,bindAppearance} from './appearance.js';
import {COLLAPSE_MODES,COLLAPSE_MODE_LABELS,getCollapsePreferences,setDefaultCollapseState,resetCollapseStates,countPinnedCollapseStates} from '../ui/collapse-state.js';
import {CARD_FONT_SIZES,CARD_FONT_LABELS,CARD_DENSITIES,CARD_DENSITY_LABELS,FIELD_LAYOUTS,FIELD_LAYOUT_LABELS,GRID_FONT_SIZES,GRID_FONT_LABELS,GRID_DENSITIES,GRID_DENSITY_LABELS,resolvePageDisplay,resolveGridDisplay,setGlobalDisplay,resetAllDisplay} from '../core/display-prefs.js';
import {applyPageDisplay} from '../ui/page-layout.js';
import {getStyleCounts,resetUniversalDefaults,resetAllComponentOverrides,applyAllComponentStyles} from '../core/component-style.js';
import {openGlobalStyleCustomizer,openTypeDefaultCustomizer} from '../ui/component-customizer.js';

const COLLAPSE_DESCRIPTIONS={
 collapsed:'العناصر الجديدة غير المهيأة — الأقسام والبطاقات — تبدأ مطوية؛ تبقى الجداول الرئيسية ظاهرة. الحالات التي اخترتها سابقًا لا تتغير.',
 open:'العناصر الجديدة غير المهيأة — الأقسام والبطاقات — تبدأ مفتوحة؛ تبقى الجداول الرئيسية ظاهرة. الحالات التي اخترتها سابقًا لا تتغير.',
 last:'يُستعاد آخر وضع محفوظ لكل عنصر؛ العنصر الجديد يبدأ مطويًا، وتبقى الجداول الرئيسية ظاهرة لتجربة البيانات أولًا.',
 pinned:'كل تغيير تقوم به يُثبّت لهذا العنصر فلا يغيّره تعديل الوضع الافتراضي؛ يمكنك إلغاء تثبيت أي عنصر من رأسه.'
};

export async function renderSettings(app){
 const tab=app.__settingsTab||'appearance';
 const tabs=`<div class="tabs" role="tablist"><button role="tab" data-stab="appearance" class="${tab==='appearance'?'active':''}">🎨 المظهر والثيمات</button><button role="tab" data-stab="taxonomy" class="${tab==='taxonomy'?'active':''}">📂 الأقسام وأنواع الأعمال</button><button role="tab" data-stab="general" class="${tab==='general'?'active':''}">القوائم والنظام</button></div>`;
 if(tab==='appearance')return `<div class="page-head"><div><h2>الإعدادات</h2><p class="muted small">خصّص المظهر بالكامل — التغييرات تُطبَّق فورًا وتُحفظ على هذا الجهاز لهذا المستخدم.</p></div></div>${tabs}<div id="appearance-root">${renderAppearance()}</div>`;
 if(tab==='taxonomy'){const {renderTaxonomyEditor}=await import('./taxonomy-editor.js');return `<div class="page-head"><div><h2>الإعدادات</h2><p class="muted small">الأقسام وأنواع الأعمال والمسارات المقترحة والحقول الخاصة — كلها بيانات قابلة للتعديل دون برمجة.</p></div></div>${tabs}${await renderTaxonomyEditor(app)}`}
 return (await renderGeneral(app)).replace('<!--TABS-->',tabs);
}
const gseg=(name,current,options,labels,label)=>`<div class="pl-field"><span class="ux-dp-lbl">${label}</span><div class="ux-seg" role="radiogroup" aria-label="${label}" data-gseg="${name}">${options.map(v=>`<button type="button" role="radio" aria-checked="${v===current}" class="${v===current?'on':''}" data-v="${v}">${labels[v]||v}</button>`).join('')}</div></div>`;
function renderDisplaySettings(){
 const card=resolvePageDisplay('');
 const grid=resolveGridDisplay();
 return `<section class="panel display-settings" data-collapse-id="display-settings" data-collapse-default="open"><div class="panel-head"><h3>العرض والقراءة — الإعداد العام</h3><span class="muted small">الافتراضي لكل البطاقات والجداول</span></div>
  <p class="muted small">هذه القيم هي المستوى العام من سلسلة الأولويات: <b>البطاقة ← الصفحة ← العام ← الافتراضي</b>. أي بطاقة أو صفحة خصّصتها تحتفظ بتخصيصها، وما لم تُخصّصه يتبع هذا الإعداد. التغييرات تُحفظ فورًا ولا تمس أي بيانات.</p>
  <div class="pl-display">
   ${gseg('fontSize',card.fontSize,CARD_FONT_SIZES,CARD_FONT_LABELS,'حجم الخط الافتراضي للبطاقات والأقسام')}
   ${gseg('density',card.density,CARD_DENSITIES,CARD_DENSITY_LABELS,'كثافة العرض الافتراضية')}
   ${gseg('fieldLayout',card.fieldLayout,FIELD_LAYOUTS,FIELD_LAYOUT_LABELS,'طريقة عرض البيانات الافتراضية (عدد الحقول في السطر)')}
   <label class="ux-dp-check"><input type="checkbox" data-gtog="secondary" ${card.secondary?'checked':''}> إظهار البيانات الثانوية افتراضيًا</label>
   <label class="ux-dp-check"><input type="checkbox" data-gtog="borders" ${card.borders?'checked':''}> إظهار الحدود الفاصلة افتراضيًا</label>
   ${gseg('gridFontSize',grid.fontSize,GRID_FONT_SIZES,GRID_FONT_LABELS,'حجم خط الجداول الافتراضي (عندما لا يوجد إعداد محفوظ للجدول)')}
   <label class="collapse-setting-select">كثافة صفوف الجداول الافتراضية
    <select data-ggrid-density aria-label="كثافة صفوف الجداول الافتراضية">${GRID_DENSITIES.map(v=>`<option value="${v}"${v===grid.density?' selected':''}>${GRID_DENSITY_LABELS[v]}</option>`).join('')}</select>
   </label>
  </div>
  <div class="collapse-setting-actions"><button type="button" class="ghost danger" data-display-reset-all>↺ إعادة إعدادات العرض بالكامل</button></div>
  <p class="muted small">إعادة الضبط تمسح الإعداد العام وتخصيصات العرض لكل البطاقات والصفحات، وتُبقي ترتيب الأقسام وإعدادات كل جدول المحفوظة لديه. لا يُحذف أي سجل أو بيان.</p>
 </section>`;
}
/** لوحة تثبيت التطبيق: زر رسمي عند توفره، وخطوات بديلة دائمًا، وحالة واضحة. */
function renderInstallPanel(app){
 const state=app?.pwaInstall?.state?.()||{installed:false,canPrompt:false};
 const status=state.installed?'التطبيق مثبَّت على هذا الجهاز — يفتح من أيقونته ويعمل دون إنترنت.':state.canPrompt?'جهازك جاهز للتثبيت بنقرة واحدة.':'إن لم يظهر زر التثبيت، استخدم الخطوات اليدوية من قائمة المتصفح (⋮).';
 return `<section class="panel install-panel"><div class="panel-head"><h3>📲 تثبيت التطبيق على الهاتف</h3><span class="muted small" data-install-state>${state.installed?'مثبَّت':'غير مثبَّت'}</span></div>
  <p class="muted small">التثبيت يضيف أيقونة مستقلة وشاشة كاملة وفتحًا أسرع — بلا أي نقل لبيانات المكتب خارج الجهاز، وبدون إنترنت بعد التثبيت الأول.</p>
  <div class="action-stack"><button type="button" class="primary" data-install-app>تثبيت التطبيق الآن</button><button type="button" class="ghost" data-install-help>كيف أثبّته يدويًا؟</button></div>
  <p class="muted small">${status}</p>
 </section>`;
}
const uxcCountsText=()=>{
 const c=getStyleCounts();
 return `${c.components} عنصرًا بتخصيص مستقل · ${c.types} افتراضي نوع محفوظ · العام: ${c.global?'مخصص':'افتراضي'}`;
};
const UNIVERSAL_TYPES=['card','section','stage','page','panel','component'];
const UNIVERSAL_TYPE_NAMES={card:'البطاقات',section:'الأقسام',stage:'المراحل',page:'الصفحات',panel:'اللوحات',component:'المكونات الأخرى'};
function renderUniversalStyleSettings(){
 return `<section class="panel universal-style-settings" data-collapse-id="universal-style-settings" data-collapse-default="open"><div class="panel-head"><h3>التخصيص الكامل — النظام المركزي</h3><span class="muted small" data-uxc-counts>${uxcCountsText()}</span></div>
  <p class="muted small">نظام تخصيص واحد لكل عنصر في البرنامج عبر <b>Component ID + Component Type + Scoped Preferences</b>. كل بطاقة أو قسم أو مرحلة أو صفحة أو لوحة لها زر «⚙ تخصيص العرض» مستقل: النصوص بأنواعها الخمسة عشر، الألوان، الخلفية، الحدود، الحواف، الظلال، المسافات، والحجم — بسلسلة أولويات <b>العنصر ← افتراضي النوع ← الصفحة ← العام ← تصميم النظام</b>. تعديل عنصر لا ينتقل تلقائيًا لأي عنصر آخر؛ الانتقال يتم بأمر صريح من داخل لوحة العنصر («تطبيق على…» أو «حفظ كإعداد افتراضي»). إعدادات كل جدول تبقى داخل أدوات الجدول نفسه (🎨 في رأس الجدول).</p>
  <div class="action-stack">
   <button type="button" class="ghost" data-uxc-global>🎨 الافتراضي العام لكل العناصر (النصوص والخط)</button>
   <div class="head-actions">${UNIVERSAL_TYPES.map(t=>`<button type="button" class="ghost small" data-uxc-type="${t}">افتراضي ${UNIVERSAL_TYPE_NAMES[t]}</button>`).join('')}</div>
  </div>
  <div class="collapse-setting-actions">
   <button type="button" class="ghost danger" data-uxc-reset-defaults>↺ إعادة الافتراضي العام وافتراضيات الأنواع</button>
   <button type="button" class="ghost danger" data-uxc-reset-overrides>↺ مسح تخصيصات كل العناصر</button>
  </div>
  <p class="muted small">إعادة الضبط هنا تمسح مستويات الوراثة الأعم فقط أو Overrides العناصر — بحسب الزر — ولا تحذف أي بيانات أو سجلات، ولا تمس إعدادات الجداول المحفوظة لكل جدول ولا ترتيب الأقسام.</p>
 </section>`;
}
async function renderGeneral(app){
 const cat=app.__lookupCat=app.__lookupCat||'fileType';
 const rows=await lookupRows(app.office,cat);
 return `<div class="page-head"><div><h2>الإعدادات</h2><p class="muted small">إعدادات التشغيل المحلية والقوائم التي تظهر في النماذج.</p></div></div><!--TABS-->
 ${renderDisplaySettings()}
 ${renderUniversalStyleSettings()}
 ${renderCollapseSettings()}
 <section class="panel"><div class="panel-head"><h3>القوائم القابلة للتعديل</h3><span class="muted small">القيم تظهر كاقتراحات في النماذج ويمكن دائمًا كتابة قيمة أخرى. حذف قيمة لا يغيّر السجلات القديمة التي استخدمتها.</span></div>
  <div class="lookup-admin"><label>القائمة<select id="lk-cat">${Object.entries(LOOKUP_CATEGORIES).map(([k,v])=>`<option value="${k}"${k===cat?' selected':''}>${esc(v.label)}</option>`).join('')}</select></label>
  <form id="lk-add" class="inline-form"><input name="value" placeholder="قيمة جديدة" aria-label="قيمة جديدة"><button class="primary">إضافة</button></form></div>
  <ol class="lookup-list">${rows.map((r,i)=>`<li data-id="${r.id}"><span class="lk-val">${esc(r.value)}</span><span class="lk-actions"><button type="button" class="link" data-lk="up" ${i===0?'disabled':''} aria-label="أعلى">▲</button><button type="button" class="link" data-lk="down" ${i===rows.length-1?'disabled':''} aria-label="أسفل">▼</button><button type="button" class="link" data-lk="edit">تعديل</button><button type="button" class="link danger" data-lk="del">حذف</button></span></li>`).join('')||'<li class="muted">القائمة فارغة.</li>'}</ol>
 </section>
 <div class="grid2"><section class="panel"><h3>الإصدار</h3><p>التطبيق: ${esc(app.constants.APP_VERSION)}</p><p>Schema: ${app.constants.SCHEMA_VERSION}</p><p>قاعدة البيانات: ${esc(app.registry.active?.displayName||'')}</p></section>
 <section class="panel"><h3>صيانة (لا تحذف أي بيانات)</h3><div class="action-stack"><button class="ghost" data-maint="preV12">⬇ تنزيل نسخة الأمان التلقائية (قبل ترقية ملف الموكل)</button><button class="ghost" data-maint="index">إعادة بناء فهرس البحث للملفات</button><button class="ghost" data-maint="parties">ترحيل روابط الموكلين القديمة إلى أطراف الملفات</button><button class="ghost" data-maint="seed">استكمال القوائم الافتراضية الناقصة</button></div><p class="muted small" id="maint-status"></p></section>
 ${renderInstallPanel(app)}
 <section class="panel"><h3>الخصوصية</h3><p>البيانات مخزنة محليًا في متصفح الجهاز. لا توجد خدمة تحليل أو API خارجية في النسخة الأساسية.</p></section>
 <section class="panel"><h3>شريط التنقل العلوي</h3><p class="muted small">التبويبات أعلى البرنامج بعرض الشاشة كاملًا: يمكنك طيّ الشريط ليصبح قصيرًا جدًا (ويُحفظ الطي لهذا المستخدم)، وتخصيص التبويبات نفسها — إظهار وإخفاء وترتيب التبويبات وعناصرها.</p><div class="action-stack"><button type="button" class="ghost" data-sidebar-toggle>طي / توسيع الشريط</button><button type="button" class="ghost" data-nav-cust>تخصيص التبويبات وترتيبها</button></div></section>
 <section class="panel"><h3>البيانات التجريبية</h3><p class="muted small">إضافة 50 ملفًا قانونيًا تجريبيًا معلَّمة بـ〔تجريبي〕 (بكل الأقسام والأنواع والمراحل تقريبًا) مع موكلين وخصوم وجلسات وأعمال وأحكام وأتعاب وإعلانات ومحضرين وعلاقات وملفات رئيسية وفرعية، ومحاكم من بينها قليوب وطوخ وبنها وشبرا. الإضافة بحتة — لا تحذف ولا تعدّل أي سجل قائم، ولا تُمسح تلقائيًا بعد الاختبار.</p><div class="action-stack"><button class="primary" data-demo-seed>+ تحميل البيانات التجريبية الآن</button></div><p class="muted small" id="demo-status"></p></section>
 <section class="panel danger-zone"><h3>🗑 مسح البيانات</h3>
   <p class="muted small">يمسح <b>كل</b> سجلات المكتب داخل قاعدة البيانات النشطة (<b>${esc(app.registry.active?.displayName || '')}</b>): الموكلون، الملفات، القضايا، الجلسات، الأعمال، الأحكام، التنفيذ، الأتعاب، الإعلانات، الملاحظات، ومركز العمل. القوائم والإعدادات والقوالب تبقى سليمة، وترقيم الملفات يبدأ من جديد. القاعدة نفسها لا تُحذف — ولن يُعاد زرع البيانات التجريبية تلقائيًا بعدها.</p>
   <div class="action-stack">
     <button type="button" class="ghost" data-backup-then-clear>⬇ تنزيل نسخة احتياطية أولًا</button>
     <button type="button" class="ghost danger" data-clear-execution>مسح قسم التنفيذ فقط</button>
     <button type="button" class="ghost danger" data-clear-all>مسح كل البيانات…</button>
   </div>
   <p class="muted small" id="clear-status"></p>
 </section></div>`;
}
function renderCollapseSettings(){
 const config=getCollapsePreferences();
 const pinned=countPinnedCollapseStates();
 const labels={collapsed:'مطوي',open:'مفتوح',last:'آخر حالة',pinned:'تثبيت حالتي'};
 return `<section class="panel collapse-settings" data-collapse-id="collapse-settings" data-collapse-default="open"><div class="panel-head"><h3>سلوك طي الأقسام والجداول</h3><span class="badge" data-collapse-pinned-count>${pinned} حالة مثبتة</span></div>
  <p class="muted small">الوضع الافتراضي يؤثر على العناصر الجديدة أو التي لا تملك حالة محفوظة. لكل بطاقة وجدول وقسم حالة مستقلة، وتُحفظ في تفضيلات هذا المستخدم على هذا الجهاز.</p>
  <label class="collapse-setting-select">الوضع الافتراضي
   <select id="collapse-default-state" aria-describedby="collapse-default-help">${COLLAPSE_MODES.map(mode=>`<option value="${mode}"${config.defaultState===mode?' selected':''}>${labels[mode]||COLLAPSE_MODE_LABELS[mode]}</option>`).join('')}</select>
  </label>
  <p id="collapse-default-help" class="muted small" data-collapse-mode-status>${COLLAPSE_DESCRIPTIONS[config.defaultState]||COLLAPSE_DESCRIPTIONS.collapsed}</p>
  <div class="collapse-setting-actions"><button type="button" class="ghost" data-collapse-reset>استعادة الوضع الافتراضي للأقسام</button></div>
  <p class="muted small">استعادة الوضع الافتراضي تمسح الحالات الحالية والمثبتة لكل العناصر، وتُبقي اختيارك للوضع الافتراضي. لا تؤثر على بيانات الملفات.</p>
 </section>`;
}

export function bindSettings(app){
 const root=document.querySelector('#main-content');const cat=app.__lookupCat;
 root.querySelectorAll('[data-stab]').forEach(b=>b.onclick=()=>{app.__settingsTab=b.dataset.stab;app.refresh()});
 // الإعداد العام للعرض: تطبيق فوري على الصفحة الحالية + حفظ عبر DisplayPreferences
 const liveApply=()=>applyPageDisplay(document.querySelector('#main-content'),app.__layoutId||'settings');
 root.querySelectorAll('[data-gseg] button').forEach(b=>b.addEventListener('click',()=>{
  const group=b.closest('[data-gseg]').dataset.gseg;
  if(group==='gridFontSize')setGlobalDisplay('grid',{fontSize:b.dataset.v});
  else setGlobalDisplay('card',{[group]:b.dataset.v});
  b.closest('[data-gseg]').querySelectorAll('button').forEach(x=>{const on=x===b;x.classList.toggle('on',on);x.setAttribute('aria-checked',String(on))});
  liveApply();
 }));
 root.querySelectorAll('[data-gtog]').forEach(box=>box.addEventListener('change',()=>{
  setGlobalDisplay('card',{[box.dataset.gtog]:box.checked});
  liveApply();
 }));
 root.querySelector('[data-ggrid-density]')?.addEventListener('change',e=>{
  setGlobalDisplay('grid',{density:e.currentTarget.value});
 });
 root.querySelector('[data-display-reset-all]')?.addEventListener('click',async()=>{
  if(!await confirmBox('إعادة إعدادات العرض بالكامل إلى الافتراضي؟ يمسح الإعداد العام وتخصيصات الخط والكثافة لكل البطاقات والصفحات. لا يمس ترتيب الأقسام ولا إعدادات الجداول المحفوظة ولا أي بيانات.',{okText:'إعادة إعدادات العرض'}))return;
  resetAllDisplay();liveApply();toast('تمت إعادة إعدادات العرض إلى الافتراضي');
 });
 // التخصيص الكامل: الافتراضي العام وافتراضيات الأنواع وإعادة الضبط الواسعة (بتأكيد)
 root.querySelector('[data-uxc-global]')?.addEventListener('click',()=>openGlobalStyleCustomizer());
 root.querySelectorAll('[data-uxc-type]').forEach(b=>b.addEventListener('click',()=>openTypeDefaultCustomizer(b.dataset.uxcType)));
 const uxcRefresh=()=>{const c=root.querySelector('[data-uxc-counts]');if(c)c.textContent=uxcCountsText()};
 root.querySelector('[data-uxc-reset-defaults]')?.addEventListener('click',async()=>{
  if(!await confirmBox('إعادة الافتراضي العام وافتراضيات الأنواع في نظام التخصيص الكامل؟ تخصيصات كل عنصر الفردية (Overrides) وتخصيصات الصفحات تبقى كما هي. لا يمس أي بيانات.',{okText:'إعادة الافتراضيات العامة'}))return;
  resetUniversalDefaults();applyAllComponentStyles(document);uxcRefresh();toast('أُعيدت الافتراضيات العامة إلى وضعها الأصلي');
 });
 root.querySelector('[data-uxc-reset-overrides]')?.addEventListener('click',async()=>{
  if(!await confirmBox('مسح تخصيصات العرض لكل العناصر (بطاقات/أقسام/مراحل/صفحات)؟ عملية واسعة النطاق: تمسح Override كل عنصر فيعود إلى الإعداد الموروث (نوع ← صفحة ← عام ← افتراضي)، وتُبقي الافتراضي العام وافتراضيات الأنواع وإعدادات الجداول المحفوظة. لا يحذف أو يغير أي بيانات أو سجلات.',{okText:'مسح تخصيصات العناصر'}))return;
  resetAllComponentOverrides();applyAllComponentStyles(document);uxcRefresh();toast('أُعيدت كل العناصر إلى الإعداد الموروث');
 });
 root.querySelector('#collapse-default-state')?.addEventListener('change',e=>{
  const mode=e.currentTarget.value;setDefaultCollapseState(mode);
  const note=root.querySelector('[data-collapse-mode-status]');
  if(note)note.textContent=COLLAPSE_DESCRIPTIONS[mode]||COLLAPSE_DESCRIPTIONS.collapsed;
  toast('تم حفظ الوضع الافتراضي لطي الأقسام');
 });
 root.querySelector('[data-collapse-reset]')?.addEventListener('click',async()=>{
  if(!await confirmBox('إعادة جميع الأقسام والبطاقات والجداول إلى وضعها الافتراضي؟ سيُلغى تثبيت الحالات، دون المساس بأي بيانات.',{okText:'استعادة الوضع الافتراضي'}))return;
  resetCollapseStates();toast('تمت استعادة حالات الواجهة إلى الوضع الافتراضي');await app.refresh();
 });
 if((app.__settingsTab||'appearance')==='appearance'){bindAppearance(app);return}
 if(app.__settingsTab==='taxonomy'){import('./taxonomy-editor.js').then(m=>m.bindTaxonomyEditor(app));return}
 root.querySelector('#lk-cat').onchange=e=>{app.__lookupCat=e.target.value;app.refresh()};
 root.querySelector('#lk-add').onsubmit=async e=>{e.preventDefault();try{await saveLookupValue(app.office,cat,e.target.value.value);toast('تمت الإضافة');app.refresh()}catch(err){toast(userError(err),'error')}};
 root.querySelectorAll('[data-lk]').forEach(b=>b.onclick=async()=>{
  const li=b.closest('li');const id=li.dataset.id;const act=b.dataset.lk;
  try{
   if(act==='up'||act==='down'){await moveLookupValue(app.office,cat,id,act==='up'?-1:1);app.refresh()}
   else if(act==='del'){if(await confirmBox(`حذف «${esc(li.querySelector('.lk-val').textContent)}» من القائمة؟ السجلات التي تستخدمها تبقى كما هي.`,{okText:'حذف'})){await removeLookupValue(app.office,id);toast('تم الحذف');app.refresh()}}
   else if(act==='edit'){const r=await confirmBox('تعديل القيمة (السجلات القديمة تحتفظ بالقيمة السابقة):',{okText:'حفظ',input:true});if(r.ok&&r.value.trim()){await saveLookupValue(app.office,cat,r.value,id);toast('تم الحفظ');app.refresh()}}
  }catch(err){toast(userError(err),'error')}
 });
 const status=root.querySelector('#maint-status');
 root.querySelectorAll('[data-maint]').forEach(b=>b.onclick=async()=>{
  b.disabled=true;
  try{
   if(b.dataset.maint==='preV12'){const {preV12Backup}=await import('../services/client-files.js');const {downloadJSON}=await import('../services/backup.js');const row=await preV12Backup(app.office);if(!row?.data){status.textContent='لا توجد نسخة أمان تلقائية (القاعدة كانت فارغة أو أُنشئت على الإصدار الجديد).'}else{downloadJSON(row.data,`pre-v12-backup-${String(row.createdAt).slice(0,10)}.json`);status.textContent='تم تنزيل النسخة. يمكن استعادتها من صفحة النسخ الاحتياطي.'}}
   if(b.dataset.maint==='index'){const n=await rebuildAllFileSearchText(app.office,d=>status.textContent=`تمت معالجة ${d} ملف…`);status.textContent=`تمت إعادة بناء فهرس ${n} ملف.`}
   if(b.dataset.maint==='parties'){const n=await migrateLegacyParties(app.office);status.textContent=`تم ترحيل ${n} رابط.`}
   if(b.dataset.maint==='seed'){const n=await seedLookups(app.office);status.textContent=n?`أضيفت ${n} قيمة افتراضية.`:'كل القوائم مكتملة.'}
  }catch(err){toast(userError(err),'error')}finally{b.disabled=false}
 });
 root.querySelector('[data-sidebar-toggle]')?.addEventListener('click',async()=>{const {toggleCollapsed,isDesktop,toggleMobile}=await import('../ui/sidebar.js');isDesktop()?toggleCollapsed():toggleMobile();toast('تم تحديث شريط التنقل')});
 root.querySelector('[data-nav-cust]')?.addEventListener('click',async()=>{const {openNavCustomizer}=await import('../ui/sidebar.js');openNavCustomizer()});
 root.querySelector('[data-demo-seed]')?.addEventListener('click',async e=>{
  const btn=e.currentTarget;const ds=root.querySelector('#demo-status');btn.disabled=true;
  try{
   const {seedDemoData}=await import('../services/demo-seed.js');
   const rep=await seedDemoData(app.office,{onProgress:({done,total,label})=>{if(ds)ds.textContent=`جارٍ الزرع… ${label} (${done}/${total})`}});
   if(ds)ds.textContent=`تمت الإضافة: ${rep.files} ملفًا، ${rep.clients} موكلًا، ${rep.hearings} جلسة، ${rep.procedures} عملًا إداريًا، ${rep.judgments} حكمًا، ${rep.fees} أتعابًا، ${rep.serviceRecords} إعلانًا — في ${Math.round(rep.ms/1000)} ثانية.`;
   toast(`تم تحميل ${rep.files} ملفًا تجريبيًا بنجاح`,'ok',{duration:5000});
  }catch(err){toast(userError(err),'error');if(ds)ds.textContent='تعذر زرع البيانات: '+userError(err)}
  finally{btn.disabled=false}
 });
 bindDangerZone(app,root);
 root.querySelector('[data-install-app]')?.addEventListener('click',()=>import('../ui/install-prompt.js').then(m=>m.installApp(app)));
 root.querySelector('[data-install-help]')?.addEventListener('click',()=>import('../ui/install-prompt.js').then(m=>m.openInstallHelp()));
}

/** منطقة المسح: تأكيد مزدوج + سبب مسجَّل + نسخة اختيارية قبل التنفيذ. */
function bindDangerZone(app,root){
 const status=root.querySelector('#clear-status');
 const say=text=>{if(status)status.textContent=text};
 root.querySelector('[data-backup-then-clear]')?.addEventListener('click',async()=>{
  try{
   const {exportDatabase,downloadJSON}=await import('../services/backup.js');
   const payload=await exportDatabase(app.office.ctx);
   downloadJSON(payload,`backup-${String(localDate()).replace(/-/g,'')}.json`);
   say('نُزّلت نسخة احتياطية كاملة. استعدها من صفحة النسخ الاحتياطي متى شئت.');
  }catch(err){toast(userError(err),'error')}
 });
 root.querySelector('[data-clear-execution]')?.addEventListener('click',async()=>{
  const answer=await confirmBox('مسح كل بيانات قسم التنفيذ (التنفيذات وأحكامها وشرائح القيمة ومحاضر التحصيل والتوكيلات)؟ بقية أقسام المكتب تبقى كما هي. اكتب سبب المسح ليُحفظ في السجل.',{okText:'مسح قسم التنفيذ',input:true,label:'سبب المسح'});
  if(!answer?.ok)return;
  if(!String(answer.value||'').trim()){toast('السبب مطلوب','error');return}
  try{
   const {clearExecutionData}=await import('../services/data-admin.js');
   const out=await clearExecutionData(app.office,{reason:answer.value});
   const total=Object.values(out.counts).reduce((sum,value)=>sum+Number(value||0),0);
   say(`تم مسح ${total} سجلًا من قسم التنفيذ.`);
   toast('تم مسح قسم التنفيذ','ok');
   await app.refresh();
  }catch(err){toast(userError(err),'error')}
 });
 root.querySelector('[data-clear-all]')?.addEventListener('click',async()=>{
  const dbName=String(app.registry.active?.displayName||app.registry.active?.name||'').trim();
  const warning=await confirmBox(`سياسة المسح: سيُمسح كل سجلات المكتب داخل «${dbName}» نهائيًا من هذا الجهاز. لا تراجع بعد التنفيذ إلا باستعادة نسخة احتياطية. أكّد أولًا.`,{okText:'فهمت — تابع',danger:true});
  if(!warning)return;
  const answer=await confirmBox(`اكتب اسم قاعدة البيانات بالضبط للتأكيد: ${dbName}`,{okText:'متابعة',input:true,label:'اسم قاعدة البيانات',danger:true});
  if(!answer?.ok)return;
  if(String(answer.value||'').trim()!==dbName){toast('الاسم غير مطابق — لم يُمسح شيء','error');return}
  const reason=await confirmBox('اكتب سبب المسح ليُحفظ في سجل النشاط (اختياري).',{okText:'تنفيذ المسح',input:true,label:'سبب المسح',danger:true});
  if(!reason?.ok)return;
  try{
   const {clearAllData}=await import('../services/data-admin.js');
   const out=await clearAllData(app.office,{reason:reason.value,confirmName:dbName});
   const total=Object.values(out.counts).reduce((sum,value)=>sum+Number(value||0),0);
   say(`تم مسح ${total} سجلًا من كل الأقسام.`);
   toast(`تم مسح كل البيانات (${total} سجلًا)`,'ok',{duration:5000});
   await app.refresh();
  }catch(err){toast(userError(err),'error')}
 });
}
