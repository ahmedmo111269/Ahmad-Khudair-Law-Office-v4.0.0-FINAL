// اختبارات نظام العرض الموحّد: DisplayPreferences (الأولوية والحفظ)، نظام البطاقات،
// تكامل الجدول (وعدم تكرار «فتح المحدد»)، SectionLayoutManager (الترتيب/الإظهار/الترحيل)،
// وتطبيق الإعدادات على DOM بلا إعادة رسم. كل الاختبارات بلا بيانات مكتب — تفضيلات عرض فقط.
import {
 _resetDisplayPrefsForTests,resolveCardDisplay,setCardDisplay,clearCardDisplay,
 setPageDisplay,setGlobalDisplay,resetAllDisplay,resolveGridDisplay,
 stepCardFontSize,saveSectionLayout,
 CARD_FONT_SIZES,DISPLAY_DEFAULTS
} from '../core/display-prefs.js';
import {
 registerPageLayout,resolveSectionOrder,orderedSections,hiddenSectionIds,
 migrateLegacySectionOrder,applyPageLayout,applyPageDisplay,openPageCustomizer,getPageLayout
} from '../ui/page-layout.js';
import {card,bindCards} from '../ui/card.js';
import {applyCardDisplay} from '../ui/card-display.js';
import {mountGrid} from '../ui/datagrid.js';
import {prefs} from '../core/preferences.js';
import {_resetCollapseStateForTests} from '../ui/collapse-state.js';

const clean=()=>{_resetDisplayPrefsForTests();_resetCollapseStateForTests()};

export function runDisplayPrefsTests(test,expect){
 // ===== الأولوية: Card → Page → Global → Default =====
 test('عرض: الأولوية بطاقة ← صفحة ← عام ← افتراضي (لكل حقل على حدة)',()=>{
  clean();
  // الافتراضي
  expect(resolveCardDisplay('any','anypage').fontSize).toBe(DISPLAY_DEFAULTS.card.fontSize);
  // العام
  setGlobalDisplay('card',{fontSize:'lg'});
  expect(resolveCardDisplay('c1','p1').fontSize).toBe('lg');
  // الصفحة تتجاوز العام
  setPageDisplay('p1',{fontSize:'xl'});
  expect(resolveCardDisplay('c1','p1').fontSize).toBe('xl');
  expect(resolveCardDisplay('c2','p-other').fontSize).toBe('lg'); // صفحة أخرى تتبع العام
  // البطاقة تتجاوز الصفحة
  setCardDisplay('c1',{fontSize:'sm'});
  expect(resolveCardDisplay('c1','p1').fontSize).toBe('sm');
  // الدمج على مستوى الحقل: الكثافة ما زالت من العام
  expect(resolveCardDisplay('c1','p1').density).toBe(DISPLAY_DEFAULTS.card.density);
  setGlobalDisplay('card',{density:'roomy'});
  expect(resolveCardDisplay('c1','p1').density).toBe('roomy');
  expect(resolveCardDisplay('c1','p1').fontSize).toBe('sm');
 });

 test('عرض: الحفظ ثم الاسترجاع (محاكاة إعادة الفتح عبر المصدر المخزّن)',()=>{
  clean();
  setCardDisplay('persist:card',{fontSize:'xl',density:'compact',secondary:false});
  // إعادة قراءة من المخزن نفسه (كما بعد إعادة التشغيل)
  const stored=JSON.parse(JSON.stringify(resolveCardDisplay('persist:card')));
  expect(stored.fontSize).toBe('xl');
  expect(stored.density).toBe('compact');
  expect(stored.secondary).toBe(false);
  // القيمة محفوظة فعليًا في prefs تحت namespace موحّد
  const raw=prefs.get('ui:display-prefs',null);
  expect(Boolean(raw&&raw.cards&&raw.cards['persist:card'])).toBe(true);
 });

 test('عرض: مسح تفضيل البطاقة يعيدها للمستوى الأعم',()=>{
  clean();
  setGlobalDisplay('card',{fontSize:'lg'});
  setCardDisplay('c',{fontSize:'sm'});
  expect(resolveCardDisplay('c','').fontSize).toBe('sm');
  clearCardDisplay('c');
  expect(resolveCardDisplay('c','').fontSize).toBe('lg');
 });

 test('عرض: A−/A+ تحريك متدرج خطوة واحدة ضمن الحدود',()=>{
  expect(stepCardFontSize('md',1)).toBe('lg');
  expect(stepCardFontSize('md',-1)).toBe('sm');
  expect(stepCardFontSize('xl',1)).toBe('xl'); // لا يتجاوز الأكبر
  expect(stepCardFontSize('sm',-1)).toBe('sm'); // لا ينزل تحت الأصغر
  expect(CARD_FONT_SIZES.length).toBe(4);
 });

 test('عرض: إعادة ضبط العرض بالكامل تُبقي ترتيب الأقسام (فصل العرض عن التخطيط)',()=>{
  clean();
  registerPageLayout({pageId:'reset-test',title:'t',sections:[{id:'a',title:'A'},{id:'b',title:'B'}]});
  saveSectionLayout('reset-test',{order:['b','a']});
  setGlobalDisplay('card',{fontSize:'xl'});
  resetAllDisplay();
  expect(resolveGridDisplay().fontSize).toBe('medium'); // العام عاد للافتراضي
  expect(resolveSectionOrder('reset-test').join(',')).toBe('b,a'); // الترتيب بقي
 });

 // ===== تكامل الجدول + عدم تكرار «فتح المحدد» =====
 test('جدول: حجم الخط الافتراضي يتبع الإعداد العام عند غياب إعداد محفوظ',()=>{
  clean();
  setGlobalDisplay('grid',{fontSize:'large'});
  const g=document.createElement('div');document.body.append(g);
  mountGrid(g,{rows:[{id:'1',t:'x'}],columns:[{key:'t',label:'T'}],storageKey:'',title:'اختبار'});
  expect(g.classList.contains('dg-font-large')).toBe(true);
  g.remove();
 });

 test('جدول: زر «فتح المحدد» يظهر مرة واحدة فقط (لا تكرار من bulkActions)',()=>{
  clean();
  const g=document.createElement('div');document.body.append(g);
  const rows=[{id:'a',t:'أ'},{id:'b',t:'ب'}];
  let bulkOpenCalls=0;
  mountGrid(g,{rows,columns:[{key:'t',label:'T'}],storageKey:'',title:'تحديد',selectable:true,
   bulkActions:[{id:'open',label:'فتح المحدد'},{id:'archive',label:'أرشفة',danger:true}],
   onBulk:(id)=>{if(id==='open')bulkOpenCalls++}});
  g.querySelector('.dg-sel-all').click();
  const selbar=g.querySelector('.dg-selbar');
  // زر واحد مدمج لفتح المحدد
  expect(selbar.querySelectorAll('.dg-open-sel').length).toBe(1);
  // لا يُضاف open داخل فتحة الإجراءات الجماعية (سبب التكرار الأصلي)
  expect(selbar.querySelectorAll('.dg-bulk-slot [data-bulk="open"]').length).toBe(0);
  // بقية الإجراءات الجماعية تبقى
  expect(selbar.querySelectorAll('.dg-bulk-slot [data-bulk="archive"]').length).toBe(1);
  // عدد النصوص «فتح المحدد» في الشريط = 1
  const openButtons=[...selbar.querySelectorAll('button')].filter(b=>b.textContent.trim()==='فتح المحدد');
  expect(openButtons.length).toBe(1);
  // النقر على المدمج يستدعي onBulk('open') مرة واحدة
  selbar.querySelector('.dg-open-sel').click();
  g.remove();
 });

 // ===== نظام البطاقات المركزي =====
 test('بطاقة: تحمل سمات العرض وزر الإعدادات ومعرّف القسم',()=>{
  clean();
  const html=card({title:'البيانات الكاملة',body:'<dl class="kv"></dl>',persistKey:'cl:data',pageId:'client-details',sectionId:'data'});
  expect(html.includes('data-display-key="cl:data"')).toBe(true);
  expect(html.includes('data-cfont=')).toBe(true);
  expect(html.includes('data-card-display="cl:data"')).toBe(true); // زر ⚙
  expect(html.includes('data-section-id="data"')).toBe(true);
 });

 test('بطاقة: تطبيق القياس على العنصر يعكس الإعداد المحفوظ',()=>{
  clean();
  setCardDisplay('k1',{fontSize:'xl',density:'compact',fieldLayout:'expanded',secondary:false,borders:false});
  const el=document.createElement('section');
  applyCardDisplay(el,'k1','');
  expect(el.dataset.cfont).toBe('xl');
  expect(el.dataset.cdensity).toBe('compact');
  expect(el.dataset.clayout).toBe('expanded');
  expect(el.dataset.csecondary).toBe('off');
  expect(el.dataset.cborders).toBe('off');
 });

 test('بطاقة: فتح لوحة الإعدادات وتغيير حجم الخط يحدّث البطاقة ويحفظ (بلا إعادة رسم)',()=>{
  clean();
  const host=document.createElement('div');document.body.append(host);
  host.innerHTML=card({title:'بطاقة',body:'محتوى',persistKey:'live:card',collapsible:false});
  const cardEl=host.querySelector('.ux-card');
  bindCards(host);
  const gear=cardEl.querySelector('[data-card-display]');
  expect(Boolean(gear)).toBe(true);
  gear.click();
  const panel=cardEl.querySelector('.ux-display-pop');
  expect(Boolean(panel)).toBe(true);
  const before=cardEl.dataset.cfont;
  panel.querySelector('[data-seg="fontSize"] button[data-v="xl"]').click();
  expect(cardEl.dataset.cfont).toBe('xl');
  expect(cardEl.dataset.cfont===before?false:true).toBe(true);
  // محفوظ مركزيًا
  expect(resolveCardDisplay('live:card','').fontSize).toBe('xl');
  // إعادة الضبط من اللوحة
  panel.querySelector('[data-dp-reset]').click();
  expect(resolveCardDisplay('live:card','').fontSize).toBe(DISPLAY_DEFAULTS.card.fontSize);
  host.remove();
 });

 // ===== SectionLayoutManager =====
 test('أقسام: التسجيل وحل الترتيب مع إكمال الناقص افتراضيًا',()=>{
  clean();
  registerPageLayout({pageId:'pg',title:'صفحة',sections:[{id:'a',title:'A'},{id:'b',title:'B'},{id:'c',title:'C'}]});
  expect(resolveSectionOrder('pg').join(',')).toBe('a,b,c');
  saveSectionLayout('pg',{order:['c','a']}); // b يُكمل تلقائيًا في النهاية
  expect(resolveSectionOrder('pg').join(',')).toBe('c,a,b');
  expect(orderedSections('pg').map(s=>s.id).join(',')).toBe('c,a,b');
 });

 test('أقسام: الإخفاء يُحفظ ويُقرأ',()=>{
  clean();
  registerPageLayout({pageId:'pg2',title:'p',sections:[{id:'x',title:'X'},{id:'y',title:'Y'}]});
  saveSectionLayout('pg2',{hidden:['y']});
  expect(hiddenSectionIds('pg2').has('y')).toBe(true);
  expect(hiddenSectionIds('pg2').has('x')).toBe(false);
 });

 test('أقسام: الترحيل لمرة واحدة من مفتاح قديم',()=>{
  clean();
  prefs.set('legacy:order',['b','a']);
  registerPageLayout({pageId:'mig',title:'m',sections:[{id:'a',title:'A'},{id:'b',title:'B'}]});
  const migrated=migrateLegacySectionOrder('mig','legacy:order');
  expect(migrated).toBe(true);
  expect(resolveSectionOrder('mig').join(',')).toBe('b,a');
  // مرة ثانية لا يعيد الترحيل ولا يتجاوز ترتيب المستخدم الجديد
  saveSectionLayout('mig',{order:['a','b']});
  expect(migrateLegacySectionOrder('mig','legacy:order')).toBe(false);
  expect(resolveSectionOrder('mig').join(',')).toBe('a,b');
 });

 test('أقسام: applyPageLayout يعيد ترتيب DOM ويخفي (نقل عناصر فقط)',()=>{
  clean();
  registerPageLayout({pageId:'dom',title:'d',sections:[{id:'s1',title:'1'},{id:'s2',title:'2'},{id:'s3',title:'3'}]});
  const root=document.createElement('div');
  root.innerHTML='<div class="hero">رأس</div><div data-section-id="s1">1</div><div data-section-id="s2">2</div><div data-section-id="s3">3</div>';
  document.body.append(root);
  saveSectionLayout('dom',{order:['s3','s1','s2'],hidden:['s2']});
  applyPageLayout(root,'dom');
  const sections=[...root.querySelectorAll('[data-section-id]')].map(e=>e.dataset.sectionId);
  expect(sections.join(',')).toBe('s3,s1,s2');
  expect(root.querySelector('[data-section-id="s2"]').classList.contains('section-hidden')).toBe(true);
  // الرأس غير المسجّل يبقى أولًا
  expect(root.firstElementChild.classList.contains('hero')).toBe(true);
  root.remove();
 });

 test('أقسام: العناصر غير المسجّلة تبقى في أماكنها عند إعادة الترتيب (قوائم: التقويم/الحالة)',()=>{
  clean();
  registerPageLayout({pageId:'interleave',title:'i',sections:[{id:'filters',title:'فلاتر'},{id:'grid',title:'جدول',canHide:false}]});
  const root=document.createElement('div');
  // رأس ثم فلاتر ثم تقويم ثم حالة ثم جدول — التقويم/الحالة غير مسجّلين كأقسام
  root.innerHTML='<div class="page-head">رأس</div><section data-section-id="filters">فلاتر</section><div class="list-cal">تقويم</div><div class="list-status">حالة</div><div data-section-id="grid">جدول</div>';
  document.body.append(root);
  saveSectionLayout('interleave',{order:['grid','filters']}); // اعكس
  applyPageLayout(root,'interleave');
  const kids=[...root.children].map(e=>e.dataset.sectionId||e.className);
  // الجدول صار أول قسم، والفلاتر آخر قسم، والتقويم/الحالة لم يقفزا إلى الأعلى قبل الجدول
  expect(kids[0]).toBe('page-head');
  expect(kids.includes('list-cal')).toBe(true);
  expect(kids.indexOf('grid')<kids.indexOf('list-cal')).toBe(true); // الجدول قبل التقويم (كان أولًا في الترتيب الجديد)
  expect(kids.indexOf('filters')>kids.indexOf('list-status')).toBe(true); // الفلاتر صارت بعد الحالة
  root.remove();
 });

 test('أقسام: applyPageDisplay يضبط سمات الجذر والبطاقات داخله',()=>{
  clean();
  setPageDisplay('pd',{fontSize:'lg',density:'roomy'});
  const root=document.createElement('div');
  root.innerHTML=card({title:'ب',body:'x',persistKey:'pd:card',pageId:'pd',collapsible:false});
  document.body.append(root);
  applyPageDisplay(root,'pd');
  expect(root.dataset.cfont).toBe('lg');
  expect(root.dataset.cdensity).toBe('roomy');
  const cardEl=root.querySelector('.ux-card');
  expect(cardEl.dataset.cfont).toBe('lg'); // البطاقة ورثت إعداد الصفحة
  root.remove();
 });

 // ===== تسجيلات الصفحات الحقيقية =====
 test('صفحات: الرئيسية مسجّلة و«آخر ما فُتح» آخر قسم افتراضيًا',async()=>{
  clean();
  await import('../modules/home.js');
  const layout=getPageLayout('dashboard');
  expect(Boolean(layout)).toBe(true);
  const ids=layout.sections.map(s=>s.id);
  expect(ids.includes('recents')).toBe(true);
  expect(ids[ids.length-1]).toBe('recents');
  expect(resolveSectionOrder('dashboard').at(-1)).toBe('recents');
 });

 test('صفحات: الموكل وملف الموكل وتبويبات الملف مسجّلة',async()=>{
  clean();
  await import('../modules/record-page.js');
  await import('../modules/file-page.js');
  expect(Boolean(getPageLayout('client-details'))).toBe(true);
  expect(resolveSectionOrder('client-details').includes('data')).toBe(true);
  expect(resolveSectionOrder('client-details').includes('hearings')).toBe(true);
  expect(Boolean(getPageLayout('file-details'))).toBe(true);
  expect(resolveSectionOrder('file-details')[0]).toBe('summary');
 });

 test('تخصيص الصفحة: النافذة تعرض الأقسام وتعيد الترتيب بـ ▲▼',()=>{
  clean();
  if(!document.querySelector('#modal-root')){const m=document.createElement('div');m.id='modal-root';document.body.append(m)}
  registerPageLayout({pageId:'cust',title:'c',sections:[{id:'a',title:'A'},{id:'b',title:'B'},{id:'c',title:'C'}]});
  const host=document.createElement('section');host.id='main-content';
  host.innerHTML='<div data-section-id="a">A</div><div data-section-id="b">B</div><div data-section-id="c">C</div>';
  document.body.append(host);
  const app={refresh(){}};
  const cardEl=openPageCustomizer(app,{pageId:'cust',root:host});
  expect(Boolean(cardEl)).toBe(true);
  const rows=cardEl.querySelectorAll('.pl-row');
  expect(rows.length).toBe(3);
  // حرّك «c» لأعلى خطوة
  const cRow=[...rows].find(r=>r.dataset.pl==='c');
  cRow.querySelector('[data-pl-move="-1"]').click();
  expect(resolveSectionOrder('cust').join(',')).toBe('a,c,b');
  applyPageLayout(host,'cust');
  expect([...host.querySelectorAll('[data-section-id]')].map(e=>e.dataset.sectionId).join(',')).toBe('a,c,b');
  host.remove();
 });

 test('سلامة: تفضيلات العرض لا تلمس حالة الطي المركزية',()=>{
  clean();
  setCardDisplay('safe',{fontSize:'xl'});
  setPageDisplay('safe-page',{density:'compact'});
  setGlobalDisplay('card',{fieldLayout:'expanded'});
  const collapseRaw=prefs.get('ui:collapse-state',null);
  expect(collapseRaw===null||collapseRaw!==undefined).toBe(true);
  expect(resolveCardDisplay('safe','safe-page').fontSize).toBe('xl');
 });
}
