// اختبارات عرض صفحة الملف (الإصدار الثاني — Data-First): الدوال النقية للجلسات
// والأعمال الإدارية والتنبيهات، تخطيطات أقسام التبويبات المستقلة (file-details:<tab>)
// وسلسلة وراثة إعدادات العرض، وتطبيق تخصيص القوالب المشتركة على كل النسخ،
// ووسم الحقول الثانوية في kvHtml. كلها بلا بيانات مكتب — دوال عرض وتفضيلات فقط.
import {
 splitHearings,HEARING_FILTERS,groupProcedures,PROCEDURE_FILTERS,fileAttentionAlerts
} from '../modules/file-page.js';
import {
 _resetDisplayPrefsForTests,resolvePageDisplay,setPageDisplay,saveSectionLayout,
 getComponentContent,setComponentContent
} from '../core/display-prefs.js';
import {
 registerPageLayout,getPageLayout,discoverPageLayout,resolveSectionOrder,applyPageLayout,hiddenSectionIds
} from '../ui/page-layout.js';
import {applyComponentContentToAll} from '../ui/component-content.js';
import {kvHtml} from '../modules/record-page.js';
import {localDate,addDays} from '../core/clock.js';
import {ENTITIES} from '../domain/entities.js';

const clean=()=>{_resetDisplayPrefsForTests()};

// بيانات مساعدة: جلسات وأعمال بأزمنة نسبية إلى اليوم (لا تواريخ مطلقة تتقادم).
const H=(over,o={})=>({id:o.id||'h'+Math.random().toString(36).slice(2,7),hearingDate:addDays(localDate(),over),...o});
const P=(o={})=>({id:o.id||'p'+Math.random().toString(36).slice(2,7),...o});

export function runFilePageDisplayTests(test,expect){
 // ===== splitHearings: فصل القادم عن السابق بحدود اليوم المسجل =====
 test('ملف/جلسات: القادمة = تاريخ ≥ اليوم وبلا قرار؛ القرار أو التاريخ الفائت يجعلها سابقة',()=>{
  const today=localDate();
  const upcoming=H(1,{id:'u1'});
  const todayH=H(0,{id:'u2',hearingTime:'10:00'});
  const decidedFuture=H(2,{id:'d1',result:'حجز للحكم'});
  const pastH=H(-3,{id:'p1'});
  const noDate={id:'n1',result:''};
  const {upcoming:up,past:ps}=splitHearings([upcoming,todayH,decidedFuture,pastH,noDate],today);
  expect(up.length).toBe(2);
  expect(up.map(h=>h.id).join(',')).toBe('u2,u1'); // الأقرب أولًا (اليوم قبل الغد)
  expect(ps.length).toBe(3); // ذات قرار (ولو مستقبلًا) + فائتة + بلا تاريخ
  expect(ps[0].id).toBe('d1'); // الأحدث تاريخًا أولًا (قرار مسجل بتاريخ مستقبل = أحدث سجلًا)
 });
 test('ملف/جلسات: بلا صفوف ولا قيم مفقودة — لا استثناءات',()=>{
  expect(splitHearings(null,'2026-01-01').upcoming.length).toBe(0);
  expect(splitHearings([{}],'2026-01-01').past.length).toBe(1);
 });

 // ===== HEARING_FILTERS: مرشحات من الحقول المسجلة فقط =====
 test('ملف/جلسات: مرشحات الكل/القادمة/السابقة/بلا قرار/بلا تاريخ/مؤجلة',()=>{
  const t=localDate();
  const rows=[
   H(1,{id:'a'}),                 // قادمة
   H(-1,{id:'b',result:'تأجيل'}), // سابقة بقرار
   H(-2,{id:'c'}),                // سابقة بلا قرار
   {id:'d'},                      // بلا تاريخ بلا قرار
   H(3,{id:'e',adjournedTo:addDays(t,10)}), // قادمة مؤجلة لاحقًا
  ];
  const fn=k=>HEARING_FILTERS.find(([key])=>key===k)[2];
  expect(rows.filter(h=>fn('all')(h,t)).length).toBe(5);
  expect(rows.filter(h=>fn('upcoming')(h,t)).map(h=>h.id).join(',')).toBe('a,e');
  expect(rows.filter(h=>fn('past')(h,t)).map(h=>h.id).join(',')).toBe('b,c,d');
  expect(rows.filter(h=>fn('noResult')(h,t)).map(h=>h.id).join(',')).toBe('a,c,d,e');
  expect(rows.filter(h=>fn('noDate')(h,t)).map(h=>h.id).join(',')).toBe('d');
  expect(rows.filter(h=>fn('adjourned')(h,t)).map(h=>h.id).join(',')).toBe('e');
 });

 // ===== groupProcedures: الحالة المسجلة هي المصدر — لا استنتاج تواريخ =====
 test('ملف/أعمال: التجميع بالحالة المسجلة (open/pending/done/cancelled) بلا اختراع حالات',()=>{
  const t=localDate();
  const groups=groupProcedures([
   P({id:'o1',status:'open'}),
   P({id:'o2',status:'pending',internalDueDate:addDays(t,3)}),
   P({id:'d1',status:'done',internalDueDate:addDays(t,-5)}),
   P({id:'c1',status:'cancelled'}),
   P({id:'x1'}), // بلا حالة = مفتوح افتراضيًا
  ],t);
  expect(groups.open.length).toBe(3);      // o1 + o2 + x1 (قيد الانتظار بموعد مستقبلي = مفتوح متابعة)
  expect(groups.open.map(p=>p.id).join(',')).toBe('o2,o1,x1'); // الأقرب استحقاقًا أولًا وبلا موعد أخيرًا
  expect(groups.done.map(p=>p.id).join(',')).toBe('d1');
  expect(groups.cancelled.map(p=>p.id).join(',')).toBe('c1');
  expect(groups.overdue.length).toBe(0);   // المتأخر المنتهي done لا يُعد متأخرًا
 });
 test('ملف/أعمال: متأخر = موعد متابعة مسجل فعلًا وانقضى والعمل ما زال مفتوحًا/قيد الانتظار',()=>{
  const t=localDate();
  const groups=groupProcedures([
   P({id:'v1',status:'open',internalDueDate:addDays(t,-1)}),
   P({id:'v2',status:'pending',internalDueDate:t}),
   P({id:'v3',status:'open',internalDueDate:addDays(t,1)}),
   P({id:'v4',status:'done',internalDueDate:addDays(t,-30)}),
   P({id:'v5',status:'open'}), // بلا موعد متابعة: مفتوح بلا افتراض استحقاق
  ],t);
  expect(groups.overdue.map(p=>p.id).join(',')).toBe('v1'); // الأمس فقط
  expect(groups.open.map(p=>p.id).join(',')).toBe('v2,v3,v5'); // الأقرب استحقاقًا أولًا وبلا موعد أخيرًا
 });
 test('ملف/أعمال: بلا صفوف — مجموعات فارغة لا استثناءات',()=>{
  const groups=groupProcedures(null,'2026-01-01');
  expect(groups.overdue.length+groups.open.length+groups.done.length+groups.cancelled.length).toBe(0);
 });

 // ===== PROCEDURE_FILTERS: مرشحات مشتقة من موعد المتابعة والحالة =====
 test('ملف/أعمال: مرشحات مفتوحة/متأخرة/اليوم/خلال ٧ أيام/بلا موعد/مكتملة/ملغاة',()=>{
  const fn=k=>PROCEDURE_FILTERS.find(([key])=>key===k)[2];
  const rows=[
   P({id:'a',status:'open',internalDueDate:addDays(localDate(),-2)}),  // متأخرة
   P({id:'b',status:'pending',internalDueDate:localDate()}),           // اليوم
   P({id:'c',status:'open',internalDueDate:addDays(localDate(),5)}),   // خلال الأسبوع
   P({id:'d',status:'open',internalDueDate:addDays(localDate(),9)}),   // بعد الأسبوع
   P({id:'e',status:'open'}),                                          // بلا موعد
   P({id:'f',status:'done',internalDueDate:addDays(localDate(),-1)}),  // مكتملة (متأخرة سابقًا)
   P({id:'g',status:'cancelled'}),
  ];
  const pick=k=>rows.filter(p=>fn(k)(p)).map(p=>p.id).join(',');
  expect(pick('all')).toBe('a,b,c,d,e,f,g');
  expect(pick('active')).toBe('a,b,c,d,e');
  expect(pick('overdue')).toBe('a');
  expect(pick('today')).toBe('b');
  expect(pick('week')).toBe('b,c');
  expect(pick('noDue')).toBe('e');
  expect(pick('done')).toBe('f');
  expect(pick('cancelled')).toBe('g');
 });

 // ===== fileAttentionAlerts: تنبيهات من البيانات المسجلة فقط =====
 test('ملف/تنبيهات: جلسة اليوم + أعمال متأخرة + نواقص بيانات — كل تنبيه بدرجة وإجراء',()=>{
  const today=localDate();
  const alerts=fileAttentionAlerts({
   f:{responsibleLawyer:'أ.خ'},
   parties:[],
   stages:[],
   hearings:[H(0,{id:'h1'})],
   procedures:[P({status:'open',internalDueDate:addDays(today,-1)})],
   today,
  });
  const tones=alerts.map(a=>a.tone);
  expect(tones.includes('danger')).toBe(true);  // جلسة اليوم
  expect(alerts.some(a=>a.text.includes('متأخرة'))).toBe(true);
  expect(alerts.some(a=>a.text.includes('أطراف'))).toBe(true);
  expect(alerts.every(a=>a.tone&&a.text)).toBe(true);
 });
 test('ملف/تنبيهات: ملف منتهٍ وما زال به أعمال مفتوحة — تنبيه متابعة',()=>{
  const today=localDate();
  const alerts=fileAttentionAlerts({
   f:{status:'closed',responsibleLawyer:'أ.خ'},
   parties:[{role:'موكل'}],
   stages:[{id:'s1'}],
   hearings:[],
   procedures:[P({status:'open',internalDueDate:addDays(today,2)})],
   today,
  });
  expect(alerts.some(a=>a.text.includes('منتهٍ'))).toBe(true);
 });
 test('ملف/تنبيهات: ملف مكتمل البيانات بلا مواعيد حرجة — لا تنبيهات',()=>{
  const today=localDate();
  const alerts=fileAttentionAlerts({
   f:{responsibleLawyer:'أ.خ'},
   parties:[{role:'موكل'}],
   stages:[{id:'s1'}],
   hearings:[H(30,{id:'far'})],
   procedures:[],
   today,
  });
  expect(alerts.length).toBe(0);
 });

 // ===== تخطيطات أقسام التبويبات: صفحة مستقلة لكل تبويب =====
 test('ملف/أقسام: لكل تبويب تخطيط مسجل مستقل باسم file-details:<tab>',async()=>{
  clean();
  await import('../modules/file-page.js');
  for(const tab of ['summary','hearings','procedures','judicial','parties','judgments','serviceRecords','money','relations','typeData','assets','timeline','notes','extra','activity']){
   const layout=getPageLayout(`file-details:${tab}`);
   expect(Boolean(layout)).toBe(true);
   expect(layout.sections.length>0).toBe(true);
  }
  // الترتيب الافتراضي لتبويب الجلسات: القادمة ← البطاقات ← الجدول
  expect(resolveSectionOrder('file-details:hearings').join(',')).toBe('hearings-next,hearings-cards,hearings-grid');
  // نظرة عامة: الموقف أولًا والمهام أخيرًا
  const sum=resolveSectionOrder('file-details:summary');
  expect(sum[0]).toBe('summary-cockpit');
  expect(sum.at(-1)).toBe('summary-tasks');
 });

 test('ملف/أقسام: ترتيب/إخفاء قسم داخل تبويب واحد لا يمس التبويبات ولا بقية التبويبات',async()=>{
  clean();
  await import('../modules/file-page.js');
  saveSectionLayout('file-details:hearings',{order:['hearings-grid','hearings-cards','hearings-next'],hidden:['hearings-cards']});
  expect(resolveSectionOrder('file-details:hearings').join(',')).toBe('hearings-grid,hearings-cards,hearings-next');
  expect(hiddenSectionIds('file-details:hearings').has('hearings-cards')).toBe(true);
  // بقية التبويبات لم تتأثر
  expect(resolveSectionOrder('file-details:summary')[0]).toBe('summary-cockpit');
  expect(hiddenSectionIds('file-details:summary').size).toBe(0);
  // وترتيب التبويبات نفسها (file-details) لم يتغير
  expect(resolveSectionOrder('file-details')[0]).toBe('summary');
 });

 test('ملف/أقسام: applyPageLayout يرتب أقسام التبويب في DOM ويخفي المخفي فقط',async()=>{
  clean();
  await import('../modules/file-page.js');
  const host=document.createElement('div');
  host.innerHTML=`<div id="file-tab">
   <section data-section-id="hearings-next">n</section>
   <p>عنصر غير مسجل يبقى بين الأقسام</p>
   <section data-section-id="hearings-cards">c</section>
   <section data-section-id="hearings-grid">g</section>
  </div>`;
  document.body.append(host);
  saveSectionLayout('file-details:hearings',{order:['hearings-grid','hearings-cards','hearings-next'],hidden:['hearings-cards']});
  applyPageLayout(host,'file-details:hearings');
  const ids=[...host.querySelectorAll('[data-section-id]')].map(e=>e.dataset.sectionId);
  expect(ids.join(',')).toBe('hearings-grid,hearings-cards,hearings-next');
  expect(host.querySelector('[data-section-id="hearings-cards"]').classList.contains('section-hidden')).toBe(true);
  expect(host.querySelector('[data-section-id="hearings-grid"]').classList.contains('section-hidden')).toBe(false);
  host.remove();
 });

 test('ملف/أقسام: صفحة الملف «مغلقة» — لا يُدمج فيها ما يُكتشف من DOM',async()=>{
  clean();
  await import('../modules/file-page.js');
  const before=getPageLayout('file-details').sections.length;
  const host=document.createElement('div');
  host.innerHTML='<section class="panel" data-section-id="summary-cockpit"><h3>موقف الملف</h3></section><section class="panel" data-section-id="whatever-dom"><h3>لوحة عابرة</h3></section>';
  const discovered=discoverPageLayout(host,'file-details','أقسام الملف');
  expect(discovered.sections.length).toBe(before);          // لا إضافة من DOM
  expect(discovered.sections.some(s=>s.id==='whatever-dom')).toBe(false);
  // صفحة التبويب مسجلة يدويًا بأقسامها المعروفة — لا تلتقط أقسام DOM العابرة
  expect(getPageLayout('file-details:hearings').sections.map(s=>s.id).includes('whatever-dom')).toBe(false);
  host.remove();
 });

 // ===== وراثة إعدادات العرض: بطاقة ← تبويب ← صفحة الملف ← عام =====
 test('ملف/عرض: تفضيل صفحة الملف يُورَّث في تبويباتها، وتفضيل التبويب يتجاوزه محليًا',async()=>{
  clean();
  await import('../modules/file-page.js');
  // الصفحة الأم تضبط الكثافة
  setPageDisplay('file-details',{density:'roomy'});
  expect(resolvePageDisplay('file-details:hearings').density).toBe('roomy'); // وراثة للتبويب
  // التبويب يضبط كثافة خاصة
  setPageDisplay('file-details:hearings',{density:'compact'});
  expect(resolvePageDisplay('file-details:hearings').density).toBe('compact');
  // ولا يتسرب إعداد التبويب إلى الصفحة الأم ولا إلى بقية التبويبات
  expect(resolvePageDisplay('file-details').density).toBe('roomy');
  expect(resolvePageDisplay('file-details:procedures').density).toBe('roomy');
 });

 // ===== قوالب البطاقات المشتركة: تخصيص واحد يسري على كل النسخ =====
 test('ملف/قوالب: applyComponentContentToAll يطبق ترتيب الأجزاء على كل نسخ القالب',()=>{
  clean();
  const host=document.createElement('div');
  host.innerHTML=`<article data-uxc-id="tpl:file:hrc-test" data-uxc-type="card">
   <div data-display-item="field:a" data-display-label="أ">أ</div>
   <div data-display-item="field:b" data-display-label="ب">ب</div>
  </article>
  <article data-uxc-id="tpl:file:hrc-test" data-uxc-type="card">
   <div data-display-item="field:a" data-display-label="أ">أ</div>
   <div data-display-item="field:b" data-display-label="ب">ب</div>
  </article>`;
  document.body.append(host);
  setComponentContent('tpl:file:hrc-test',{order:['field:b','field:a'],hidden:['field:a']});
  applyComponentContentToAll('tpl:file:hrc-test',host);
  const cards=[...host.querySelectorAll('[data-uxc-id="tpl:file:hrc-test"]')];
  expect(cards.length).toBe(2);
  for(const c of cards){
   const order=[...c.querySelectorAll('[data-display-item]')].map(e=>e.dataset.displayItem);
   expect(order.join(',')).toBe('field:b,field:a');      // «ب» صار أولًا في كل النسخ
   expect(c.querySelector('[data-display-item="field:a"]').classList.contains('ux-content-hidden')).toBe(true);
  }
  // الحفظ نفسه قرئ كما هو من التفضيلات
  expect(getComponentContent('tpl:file:hrc-test').order.join(',')).toBe('field:b,field:a');
  host.remove();
 });

 // ===== الحقول الثانوية في kvHtml =====
 test('ملف/بيانات: kvHtml يوسم الحقول الثانوية فتُخفى جماعيًا في العرض المختصر',()=>{
  const f=ENTITIES.files.fields.filter(x=>['title','staff'].includes(x.k));
  expect(f.length).toBe(2);
  const html=kvHtml(f,{title:'ملف اختبار',staff:'م. مساعد'},{},{secondary:['staff']});
  const host=document.createElement('div');
  host.innerHTML=html;
  const secondary=host.querySelector('.kv-item.is-secondary');
  expect(Boolean(secondary)).toBe(true);
  expect(secondary.dataset.displayItem).toBe('field:staff');
  // الحقل الأساسي بلا وسم
  expect(host.querySelector('[data-display-item="field:title"]').classList.contains('is-secondary')).toBe(false);
  host.remove();
 });
}
