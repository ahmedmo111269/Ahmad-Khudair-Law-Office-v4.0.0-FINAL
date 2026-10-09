// =====================================================================
// اختبارات نظام التخصيص الكامل والمستقل لكل عنصر (Universal Component Styles)
// ---------------------------------------------------------------------
// تغطي: الاستقلال بين العناصر، سلسلة الأولويات (عنصر ← نوع ← صفحة ← عام)،
// القاعدة الذهبية (Override العنصر لا يمسّه تغيير الأعم)، التطبيع والحدود الآمنة،
// التطبيق على DOM كـ CSS Variables/Inline بلا إعادة رسم، النسخ والتطبيق الصريح،
// حفظ كافتراضي، إعادة الضبط المستقلة، الأزرار المحقونة، المراحل، الجداول
// (إعداداتها داخل DataGrid نفسه)، وسلامة البيانات (تفضيلات عرض فقط).
import {
 _resetComponentStylesForTests,resolveComponentStyle,resolveStyleSources,setComponentStyle,getComponentStyle,
 clearComponentStyle,clearComponentStyleProp,setTypeDefault,getTypeDefault,clearTypeDefault,
 setGlobalStyle,getGlobalStyle,clearGlobalStyle,copyComponentStyle,getStyleClipboard,
 applyStyleToComponentIds,applyComponentStyle,applyAllComponentStyles,computeStyleApplication,
 resolveBaseScale,noteComponent,knownComponents,getStyleCounts,resetUniversalDefaults,
 resetAllComponentOverrides,resetPageComponentStyles,sanitizeStyle,getComponentStyleState,
 _reloadComponentStylesForTests
} from '../core/component-style.js';
import {_resetDisplayPrefsForTests,setCardDisplay,resolveCardDisplay,setGlobalDisplay} from '../core/display-prefs.js';
import {_resetCollapseStateForTests} from '../ui/collapse-state.js';
import {prefs} from '../core/preferences.js';
import {card,bindCards} from '../ui/card.js';
import {applyCardDisplay} from '../ui/card-display.js';
import {registerPageLayout} from '../ui/page-layout.js';
import {bindCustomizableComponents,applyUniversalStyles,openComponentCustomizer,openCustomizerForElement,registerCustomizableComponent} from '../ui/component-customizer.js';
import {mountGrid} from '../ui/datagrid.js';
import {closeModal} from '../ui/modal.js';

const clean=()=>{
 _resetComponentStylesForTests();_resetDisplayPrefsForTests();_resetCollapseStateForTests();
 try{closeModal()}catch{}
 document.body.innerHTML='';
};
const ensureModalRoot=()=>{if(!document.querySelector('#modal-root')){const m=document.createElement('div');m.id='modal-root';document.body.append(m)}};
const tick=(ms=30)=>new Promise(r=>setTimeout(r,ms));
const cssColorMatches=(value,hex)=>{
 const actual=String(value||'').toLowerCase().replace(/\s+/g,'');
 const source=String(hex||'').trim().toLowerCase();
 if(actual.includes(source)||actual.includes(source.replace(/^#/,'')))return true;
 let digits=source.replace(/^#/,'');
 if(digits.length===3)digits=[...digits].map(char=>char+char).join('');
 if(!/^[0-9a-f]{6}$/.test(digits))return false;
 const channels=[0,2,4].map(index=>parseInt(digits.slice(index,index+2),16));
 return actual.includes(`rgb(${channels.join(',')})`)||actual.includes(`rgba(${channels.join(',')},1)`);
};

export function runComponentStyleTests(test,expect){
 // ===== التطبيع والحدود التقنية الآمنة =====
 test('تخصيص: تطبيع القيم — حدود آمنة ورفض الألوان غير الصالحة',()=>{
  clean();
  setComponentStyle('card:s1',{
   base:{fontSize:999},
   text:{primaryValue:{fs:2,color:'red'},mainTitle:{fs:20,fw:'700',lh:9,op:0}},
   box:{radius:'x',bg:'#GGGGGG',borderWidth:3,padding:100,shadow:'nope',align:'center'}
  },{type:'card'});
  const st=getComponentStyle('card:s1');
  expect(st.base.fontSize).toBe(28);            // clamped إلى الحد الأقصى الآمن
  expect(st.text.primaryValue.fs).toBe(9);      // clamped إلى الحد الأدنى
  expect(st.text.primaryValue.color).toBe(undefined); // لون غير صالح يُرفض
  expect(st.text.mainTitle.fs).toBe(20);
  expect(st.text.mainTitle.fw).toBe('700');
  expect(st.text.mainTitle.lh).toBe(2.6);
  expect(st.text.mainTitle.op).toBe(.25);
  expect(st.box.radius).toBe(undefined);
  expect(st.box.bg).toBe(undefined);
  expect(st.box.borderWidth).toBe(3);
  expect(st.box.padding).toBe(48);
  expect(st.box.shadow).toBe(undefined);
  expect(st.box.align).toBe('center');
 });

 test('تخصيص: sanitizeStyle مستقل — الأرقام القضائية تملك شكلًا خاصًا (خلفية/حدود/حواف/حشو)',()=>{
  const clean1=sanitizeStyle({text:{legalNumber:{fs:18,bg:'#aabbcc',bc:'#111111',bw:2,br:8,pad:6,color:'#123456'},fieldLabel:{bg:'#ffffff'}}});
  expect(clean1.text.legalNumber.bg).toBe('#aabbcc');
  expect(clean1.text.legalNumber.br).toBe(8);
  expect(clean1.text.fieldLabel?.bg).toBe(undefined); // types عامة لا تملك box extras
 });

 // ===== الاستقلال التام بين العناصر (القاعدة الأساسية) =====
 test('تخصيص: تعديل بطاقة لا ينتقل إلى بطاقة أو جدول أو قسم آخر',()=>{
  clean();
  setComponentStyle('card:client-main-data',{base:{fontSize:22},text:{primaryValue:{color:'#ff0000'}}},{type:'card',pageId:'client-details'});
  setComponentStyle('card:client-files',{base:{fontSize:14}},{type:'card',pageId:'client-details'});
  setComponentStyle('section:client-details:hearings',{box:{bg:'#00ff00'}},{type:'section',pageId:'client-details'});
  expect(resolveComponentStyle('card:client-main-data',{type:'card',pageId:'client-details'}).base.fontSize).toBe(22);
  expect(resolveComponentStyle('card:client-files',{type:'card',pageId:'client-details'}).base.fontSize).toBe(14);
  expect(resolveComponentStyle('card:client-files',{type:'card',pageId:'client-details'}).text?.primaryValue?.color).toBe(undefined);
  expect(resolveComponentStyle('section:client-details:hearings',{type:'section',pageId:'client-details'}).box.bg).toBe('#00ff00');
  expect(resolveComponentStyle('section:client-details:judgments',{type:'section',pageId:'client-details'}).box?.bg).toBe(undefined); // قسم الأحكام لم يتأثر بقسم الجلسات
  expect(getComponentStyle('card:client-main-data')===getComponentStyle('card:client-files')).toBe(false);
 });

 // ===== سلسلة الأولويات: عنصر ← نوع ← صفحة ← عام =====
 test('تخصيص: الأولوية عنصر ← افتراضي النوع ← الصفحة ← العام (لكل خاصية على حدة)',()=>{
  clean();
  setGlobalStyle({text:{primaryValue:{color:'#010101',fs:13},mainTitle:{color:'#020202'},fieldLabel:{color:'#010101'}}});
  setComponentStyle('page:p1',{text:{primaryValue:{color:'#030303'},fieldLabel:{color:'#040404'}}},{type:'page'});
  setTypeDefault('card',{text:{primaryValue:{color:'#050505'}}});
  // عنصر بلا Override: النوع يتجاوز الصفحة والعام
  expect(resolveComponentStyle('card:c1',{type:'card',pageId:'p1'}).text.primaryValue.color).toBe('#050505');
  // خاصية لم يمسها النوع: ترث من الصفحة
  expect(resolveComponentStyle('card:c1',{type:'card',pageId:'p1'}).text.fieldLabel.color).toBe('#040404');
  // خاصية لم تمسها الصفحة: ترث من العام
  expect(resolveComponentStyle('card:c1',{type:'card',pageId:'p1'}).text.primaryValue.fs).toBe(13);
  expect(resolveComponentStyle('card:c1',{type:'card',pageId:'p1'}).text.mainTitle.color).toBe('#020202');
  // Override العنصر يتجاوز الجميع
  setComponentStyle('card:c1',{text:{primaryValue:{color:'#060606'}}},{type:'card',pageId:'p1'});
  expect(resolveComponentStyle('card:c1',{type:'card',pageId:'p1'}).text.primaryValue.color).toBe('#060606');
  // الدمج لكل خاصية: fs ما زال من العام
  expect(resolveComponentStyle('card:c1',{type:'card',pageId:'p1'}).text.primaryValue.fs).toBe(13);
  // صفحة أخرى بلا مستوى صفحة: النوع ثم العام
  expect(resolveComponentStyle('card:c2',{type:'card',pageId:'p2'}).text.primaryValue.color).toBe('#050505');
  expect(resolveComponentStyle('card:c2',{type:'card',pageId:'p2'}).text.fieldLabel.color).toBe('#010101');
 });

 test('تخصيص: القاعدة الذهبية — تغيير الصفحة/العام لا يمس عنصرًا له Override',()=>{
  clean();
  // Global 16 / Page 18 / Card 22 (مثال المواصفة)
  setGlobalStyle({base:{fontSize:16}});
  setComponentStyle('page:client-details',{base:{fontSize:18}},{type:'page'});
  setComponentStyle('card:data',{base:{fontSize:22}},{type:'card',pageId:'client-details'});
  expect(resolveComponentStyle('card:data',{type:'card',pageId:'client-details'}).base.fontSize).toBe(22);
  // غيّرت الصفحة إلى 20 — البطاقة المخصصة لا تتأثر، وغير المخصصة تتبع الصفحة
  setComponentStyle('page:client-details',{base:{fontSize:20}},{type:'page'});
  expect(resolveComponentStyle('card:data',{type:'card',pageId:'client-details'}).base.fontSize).toBe(22);
  expect(resolveComponentStyle('card:other',{type:'card',pageId:'client-details'}).base.fontSize).toBe(20);
  // غيّرت العام — المخصصان (بطاقة وصفحة) بلا تأثير
  setGlobalStyle({base:{fontSize:12}});
  expect(resolveComponentStyle('card:data',{type:'card',pageId:'client-details'}).base.fontSize).toBe(22);
  expect(resolveComponentStyle('page:client-details',{type:'page'}).base.fontSize).toBe(20);
  expect(resolveComponentStyle('card:third',{type:'card',pageId:'other-page'}).base.fontSize).toBe(12);
 });

 test('تخصيص: مصدر كل خاصية معروف (عنصر/نوع/صفحة/عام/افتراضي)',()=>{
  clean();
  setGlobalStyle({text:{helperText:{color:'#aaaaaa'}}});
  setComponentStyle('page:p',{text:{badge:{fs:12}}},{type:'page'});
  setComponentStyle('card:x',{text:{badge:{color:'#bbbbbb'}}},{type:'card',pageId:'p'});
  const src=resolveStyleSources('card:x',{type:'card',pageId:'p'});
  expect(src.text.badge.color).toBe('element');
  expect(src.text.badge.fs).toBe('page');
  expect(src.text.helperText.color).toBe('global');
  expect(src.text.primaryValue.fs).toBe('default');
  expect(src.base.fontSize).toBe('default');
 });

 test('تخصيص: مسح خاصية واحدة يعيدها للموروث دون بقية الخصائص',()=>{
  clean();
  setTypeDefault('card',{text:{primaryValue:{color:'#cccccc',fs:19}}});
  setComponentStyle('card:y',{text:{primaryValue:{color:'#dddddd',fs:25}}},{type:'card'});
  clearComponentStyleProp('card:y','text.primaryValue.fs');
  expect(getComponentStyle('card:y').text.primaryValue.fs).toBe(undefined);
  expect(getComponentStyle('card:y').text.primaryValue.color).toBe('#dddddd');
  expect(resolveComponentStyle('card:y',{type:'card'}).text.primaryValue.fs).toBe(19); // ورث افتراضي النوع
  clearComponentStyleProp('card:y','text.primaryValue.color');
  expect(getComponentStyle('card:y')).toBe(null); // فرغ تمامًا → حُذف السجل
  expect(resolveComponentStyle('card:y',{type:'card'}).text.primaryValue.color).toBe('#cccccc');
 });

 // ===== التطبيق على DOM: CSS Variables + Inline — بلا إعادة رسم =====
 test('تخصيص: التطبيق يضبط متغيرات CSS وسمات الرموز على العنصر المعني فقط',()=>{
  clean();
  const host=document.createElement('div');document.body.append(host);
  host.innerHTML=`<section class="ux-card" data-display-key="a" data-uxc-id="card:a" data-uxc-type="card"><div class="ux-card-body"><dl class="kv"><div class="kv-item"><dt>حقل</dt><dd>قيمة</dd></div></dl></div></section>
  <section class="ux-card" data-display-key="b" data-uxc-id="card:b" data-uxc-type="card"><div class="ux-card-body"></div></section>`;
  const a=host.querySelector('[data-uxc-id="card:a"]'),b=host.querySelector('[data-uxc-id="card:b"]');
  setComponentStyle('card:a',{text:{primaryValue:{fs:20,color:'#ff0000'}},box:{bg:'#123456',radius:18}},{type:'card'});
  applyComponentStyle(a,'card:a',{type:'card',pageId:''});
  applyComponentStyle(b,'card:b',{type:'card',pageId:''});
  expect(a.style.getPropertyValue('--uxc-primaryValue-fs')).toBe('20px');
  expect(a.style.getPropertyValue('--uxc-primaryValue-color')).toBe('#ff0000');
  expect(cssColorMatches(a.style.getPropertyValue('background'),'#123456')).toBe(true);
  expect(a.style.getPropertyValue('border-radius')).toBe('18px');
  expect(a.dataset.uxcHas.includes('primaryValue.fs')).toBe(true);
  expect(a.dataset.uxcHas.includes('box.bg')).toBe(true);
  // البطاقة الثانية لم تتأثر إطلاقًا
  expect(b.style.getPropertyValue('--uxc-primaryValue-fs')).toBe('');
  expect(b.style.getPropertyValue('background')).toBe('');
  expect(b.dataset.uxcHas||'').toBe('');
  host.remove();
 });

 test('تخصيص: المقياس الحر يحل محل الدرجات القديمة ويتكامل معها',()=>{
  clean();
  const el=document.createElement('section');
  el.dataset.uxcId='card:scale';el.dataset.uxcType='card';el.dataset.displayKey='scale';
  document.body.append(el);
  // بلا تخصيص: الدرجة القديمة xl من display-prefs
  setCardDisplay('scale',{fontSize:'xl'});
  applyComponentStyle(el,'card:scale',{type:'card',cardKey:'scale',pageId:''});
  expect(el.style.getPropertyValue('--cd-fs')).toBe('1.270');
  // الحجم الحر 22px يتجاوز الدرجة
  setComponentStyle('card:scale',{base:{fontSize:22}},{type:'card'});
  applyComponentStyle(el,'card:scale',{type:'card',cardKey:'scale',pageId:''});
  expect(el.style.getPropertyValue('--cd-fs')).toBe((22/15.5).toFixed(3));
  // مسح الحر → العودة للدرجة القديمة
  clearComponentStyleProp('card:scale','base.fontSize');
  applyComponentStyle(el,'card:scale',{type:'card',cardKey:'scale',pageId:''});
  expect(el.style.getPropertyValue('--cd-fs')).toBe('1.270');
  el.remove();
 });

 test('تخصيص: المرحلة — شكل الصندوق يُطبق على زر المرحلة المرئي والمتغيرات على العنصر',()=>{
  clean();
  const li=document.createElement('li');
  li.dataset.uxcId='stage:s1';li.dataset.uxcType='stage';
  li.innerHTML='<button type="button"><i>●</i><span>استئناف</span><small>1545/2026</small></button>';
  document.body.append(li);
  setComponentStyle('stage:s1',{box:{bg:'#0000ff',accent:'#ffcc00',radius:20},text:{legalNumber:{color:'#00ff00'}}},{type:'stage'});
  applyComponentStyle(li,'stage:s1',{type:'stage',pageId:''});
  const btn=li.querySelector('button');
  expect(cssColorMatches(btn.style.getPropertyValue('background'),'#0000ff')).toBe(true);
  expect(btn.style.getPropertyValue('border-radius')).toBe('20px');
  expect(li.style.getPropertyValue('background')).toBe(''); // li نفسه بلا صندوق
  expect(li.style.getPropertyValue('--uxc-accent')).toBe('#ffcc00');
  expect(li.style.getPropertyValue('--uxc-legalNumber-color')).toBe('#00ff00');
  li.remove();
 });

 // ===== الحفظ كافتراضي + النسخ والتطبيق الصريح =====
 test('تخصيص: حفظ كافتراضي للنوع — العناصر المخصصة فرديًا لا تتأثر',()=>{
  clean();
  setComponentStyle('card:own',{text:{primaryValue:{fs:30}}},{type:'card'});
  setTypeDefault('card',{text:{primaryValue:{fs:17,color:'#999999'}}});
  expect(resolveComponentStyle('card:plain',{type:'card'}).text.primaryValue.fs).toBe(17);
  expect(resolveComponentStyle('card:own',{type:'card'}).text.primaryValue.fs).toBe(30);
  expect(resolveComponentStyle('card:own',{type:'card'}).text.primaryValue.color).toBe('#999999');
  // مسح Override العنصر → يعود لافتراضي النوع وحده
  clearComponentStyle('card:own');
  expect(resolveComponentStyle('card:own',{type:'card'}).text.primaryValue.fs).toBe(17);
  clearTypeDefault('card');
  expect(getTypeDefault('card')).toBe(null);
 });

 test('تخصيص: النسخ ثم التطبيق على أهداف محددة بأمر صريح (استبدال/دمج)',()=>{
  clean();
  noteComponent({id:'card:src',type:'card',title:'المصدر'});
  noteComponent({id:'card:d1',type:'card',title:'هدف 1'});
  noteComponent({id:'card:d2',type:'card',title:'هدف 2'});
  setComponentStyle('card:src',{base:{fontSize:20},box:{radius:6}},{type:'card'});
  setComponentStyle('card:d2',{text:{badge:{fs:11}}},{type:'card'});
  copyComponentStyle('card:src',{type:'card'});
  const cb=getStyleClipboard();
  expect(cb.fromId).toBe('card:src');
  expect(cb.style.base.fontSize).toBe(20);
  // استبدال: يمحو تخصيص d2 السابق
  const n=applyStyleToComponentIds(['card:d1','card:d2'],cb.style,{replace:true});
  expect(n).toBe(2);
  expect(getComponentStyle('card:d1').box.radius).toBe(6);
  expect(getComponentStyle('card:d2').text?.badge).toBe(undefined);
  // دمج: يبقي ما لدى الهدف ويضيف المنسوخ
  applyStyleToComponentIds(['card:d2'],{text:{badge:{fs:14}}},{replace:false});
  expect(getComponentStyle('card:d2').text.badge.fs).toBe(14);
  expect(getComponentStyle('card:d2').base.fontSize).toBe(20);
  // المصدر لم يتغير
  expect(getComponentStyle('card:src').base.fontSize).toBe(20);
  // عناصر أخرى لم تُلمس (لا تطبيق جماعي بلا أمر)
  expect(getComponentStyle('card:untouched')).toBe(null);
  expect(knownComponents({type:'card'}).length>=3).toBe(true);
 });

 // ===== إعادة الضبط المستقلة =====
 test('تخصيص: إعادة الضبط — عنصر واحد / صفحة / افتراضيات / كل العناصر',()=>{
  clean();
  setGlobalStyle({base:{fontSize:13}});
  setTypeDefault('section',{box:{gap:20}});
  setComponentStyle('page:p1',{base:{fontSize:19}},{type:'page',pageId:''});
  setComponentStyle('card:p1a',{base:{fontSize:21}},{type:'card',pageId:'p1'});
  setComponentStyle('card:p2a',{base:{fontSize:23}},{type:'card',pageId:'p2'});
  // إعادة عنصر واحد فقط
  clearComponentStyle('card:p1a');
  expect(resolveComponentStyle('card:p1a',{type:'card',pageId:'p1'}).base.fontSize).toBe(19); // ورث صفحته
  expect(getComponentStyle('card:p2a').base.fontSize).toBe(23); // الباقي لم يتأثر
  // إعادة صفحة: مستوى الصفحة + عناصرها (بأمر صريح) — الصفحات الأخرى سليمة
  const removed=resetPageComponentStyles('p1');
  expect(removed).toBe(1); // page:p1 فقط (card:p1a مسح سابقًا)
  expect(getComponentStyle('page:p1')).toBe(null);
  expect(resolveComponentStyle('card:p2a',{type:'card',pageId:'p2'}).base.fontSize).toBe(23);
  // إعادة الافتراضيات العامة: العام+الأنواع — Overrides العناصر تبقى
  resetUniversalDefaults();
  expect(getGlobalStyle()).toBeTruthy();
  expect(Object.keys(getGlobalStyle()).length).toBe(0);
  expect(getTypeDefault('section')).toBe(null);
  expect(getComponentStyle('card:p2a').base.fontSize).toBe(23);
  // مسح كل Overrides: العناصر — العام/الأنواع تبقى
  setGlobalStyle({base:{fontSize:15}});
  resetAllComponentOverrides();
  expect(getComponentStyle('card:p2a')).toBe(null);
  expect(getGlobalStyle().base.fontSize).toBe(15);
 });

 // ===== الاكتشاف والربط التلقائي (⚙ في كل مكان) =====
 test('تخصيص: applyUniversalStyles توسم الصفحة وتكتشف البطاقات والأقسام وتحقن ⚙',()=>{
  clean();
  registerPageLayout({pageId:'uxpg',title:'صفحة اختبار',sections:[{id:'sec1',title:'قسم 1'},{id:'grid',title:'الجدول'}]});
  const main=document.createElement('section');main.id='main-content';document.body.append(main);
  main.innerHTML=`${card({title:'بطاقة أ',body:'x',persistKey:'ux:a',pageId:'uxpg',sectionId:'sec1',collapsible:false})}
   <div class="panel-plain" data-section-id="sec2"><div class="panel-head"><h3>قسم لوحدي</h3></div><p>محتوى</p></div>
   <div id="list-grid" data-section-id="grid"></div>`;
  applyUniversalStyles(main,'uxpg');
  // الصفحة نفسها مكوّن
  expect(main.dataset.uxcId).toBe('page:uxpg');
  expect(main.dataset.uxcType).toBe('page');
  expect(main.dataset.uxcPage).toBe('uxpg');
  // البطاقة بهويتها الثابتة
  const cardEl=main.querySelector('.ux-card');
  expect(cardEl.dataset.uxcId).toBe('card:ux:a');
  // القسم غير البطاقة: هوية مستقرة (صفحة+قسم) وزر ⚙ محقون في رأسه
  const sec=main.querySelector('[data-section-id="sec2"]');
  expect(sec.dataset.uxcId).toBe('section:uxpg:sec2');
  expect(sec.dataset.uxcType).toBe('section');
  expect(Boolean(sec.querySelector('.panel-head .uxc-gear'))).toBe(true);
  // الحاوية بلا رأس: زر عائم
  const gridSec=main.querySelector('#list-grid');
  expect(gridSec.dataset.uxcId).toBe('section:uxpg:grid');
  expect(Boolean(gridSec.querySelector('.uxc-gear'))).toBe(true);
  // idempotent — لا أزرار مكررة عند إعادة الربط
  applyUniversalStyles(main,'uxpg');
  bindCustomizableComponents(main);
  expect(main.querySelectorAll('.uxc-gear').length).toBe(2);
  // السجل يعرف العناصر (لأوامر «تطبيق على…»)
  const ids=knownComponents().map(c=>c.id);
  expect(ids.includes('page:uxpg')).toBe(true);
  expect(ids.includes('card:ux:a')).toBe(true);
  expect(ids.includes('section:uxpg:sec2')).toBe(true);
  main.remove();
 });

 test('تخصيص: registerCustomizableComponent — أي مكون جديد يشترك بتسجيل واحد',()=>{
  clean();
  const host=document.createElement('div');document.body.append(host);
  host.innerHTML='<div class="my-widget" data-my-widget>أداة مستقبلية</div>';
  const entry=registerCustomizableComponent({id:'component:future-widget',type:'component',title:'أداة مستقبلية',selector:'[data-my-widget]'});
  expect(entry.id).toBe('component:future-widget');
  const w=host.querySelector('.my-widget');
  expect(w.dataset.uxcId).toBe('component:future-widget');
  expect(w.dataset.uxcType).toBe('component');
  bindCustomizableComponents(host);
  expect(Boolean(w.querySelector('.uxc-gear'))).toBe(true); // حصل على ⚙ تلقائيًا
  setComponentStyle('component:future-widget',{text:{mainTitle:{fs:24}}},{type:'component'});
  applyAllComponentStyles(document);
  expect(w.style.getPropertyValue('--uxc-mainTitle-fs')).toBe('24px');
  host.remove();
 });

 test('تخصيص: ⚙ لا يُوضع داخل التبويبات ولا فوق النص — يجلس في تدفق رأس القسم',()=>{
  clean();
  const main=document.createElement('section');main.id='main-content';document.body.append(main);
  main.innerHTML=`<div class="cfile-page">
   <nav class="tabs file-tabs" role="tablist"><button type="button" role="tab" data-tab="summary" data-section-id="summary"><span class="tab-label">ملخص</span></button><button type="button" role="tab" data-tab="timeline" data-section-id="timeline"><span class="tab-label">الخط الزمني</span></button></nav>
   <section class="cp-exec" data-section-id="execution"><header class="cp-exec-head"><div><h3 class="cp-exec-title">التنفيذ المرتبط بهذا الملف</h3></div></header><p>محتوى</p></section>
   <section class="plain-block" data-section-id="plain"><p>بلا رأس واضح</p><section data-section-id="inner"><div class="panel-head"><h3>قسم داخلي</h3></div></section></section>
  </div>`;
  bindCustomizableComponents(main);
  // التبويبات: لا ⚙ داخل أي زر ولا هوية مكوّن
  main.querySelectorAll('.file-tabs button').forEach(b=>{expect(Boolean(b.querySelector('.uxc-gear'))).toBe(false);expect(b.dataset.uxcId===undefined).toBe(true)});
  expect(main.querySelectorAll('.uxc-gear-host').length).toBe(0);
  // قسم التنفيذ: ⚙ آخر عنصر داخل الرأس نفسه (تدفق طبيعي لا absolute)
  const head=main.querySelector('.cp-exec-head');
  expect(head.lastElementChild.classList.contains('uxc-gear')).toBe(true);
  // قسم بلا رأس: شريط مستقل أعلى المحتوى، ولا يسرق رأس القسم الداخلي
  const plain=main.querySelector('[data-section-id="plain"]');
  expect(plain.firstElementChild.classList.contains('uxc-gear-bar')).toBe(true);
  expect(Boolean(plain.querySelector(':scope > .uxc-gear-bar > .uxc-gear'))).toBe(true);
  // القسم الداخلي يحصل على ⚙ في رأسه هو
  expect(Boolean(main.querySelector('[data-section-id="inner"] .panel-head > .uxc-gear'))).toBe(true);
  // idempotent: لا ⚙ مكررة عند إعادة الربط (cp-exec + bar + inner = 3)
  bindCustomizableComponents(main);
  expect(main.querySelectorAll('.uxc-gear').length).toBe(3);
  main.remove();
 });

 test('تخصيص: حفظ إعدادات الصفحة يُطبق على جذر المحتوى (خلفية/نص)',()=>{
  clean();
  const main=document.createElement('section');document.body.append(main);
  main.innerHTML='<div class="panel-plain" data-section-id="s"><div class="panel-head"><h3>قسم</h3></div></div>';
  setComponentStyle('page:pp',{box:{bg:'#123456'},text:{mainTitle:{color:'#abcabc'}}},{type:'page'});
  applyUniversalStyles(main,'pp');
  expect(cssColorMatches(main.style.getPropertyValue('background'),'#123456')).toBe(true);
  expect(main.style.getPropertyValue('--uxc-mainTitle-color')).toBe('#abcabc');
  expect(main.dataset.uxcHas.includes('mainTitle.color')).toBe(true);
  // قسم داخل الصفحة يرث مستوى الصفحة في الحل (JS) عند تخصيصه لاحقًا
  expect(resolveComponentStyle('section:pp:s',{type:'section',pageId:'pp'}).text.mainTitle.color).toBe('#abcabc');
  main.remove();
 });

 // ===== اللوحة العالمية =====
 test('تخصيص: اللوحة — تبويبات ومعاينة وتحكم حر يحفظ Override للعنصر',async()=>{
  clean();ensureModalRoot();
  const host=document.createElement('div');document.body.append(host);
  host.innerHTML=card({title:'بطاقة اللوحة',body:'<dl class="kv"><div class="kv-item"><dt>ح</dt><dd>ق</dd></div></dl>',persistKey:'ux:panel',collapsible:false});
  const cardEl=host.querySelector('.ux-card');
  bindCards(host);
  openCustomizerForElement(cardEl);
  const panel=document.querySelector('#modal-root .uxc-modal');
  expect(Boolean(panel)).toBe(true);
  expect(panel.querySelectorAll('[data-uxc-tab]').length).toBe(4); // أساسي/النصوص/متقدم/إجراءات
  expect(Boolean(panel.querySelector('.uxc-preview-box'))).toBe(true);
  // تبويب النصوص يعرض الأنواع الخمسة عشر المتاحة للبطاقة
  panel.querySelector('[data-uxc-tab="texts"]').click();
  expect(panel.querySelector('[data-pane="texts"]').hidden).toBe(false);
  expect(panel.querySelectorAll('.uxc-role[data-role]').length>=12).toBe(true);
  // تغيير لون القيمة الأساسية عبر hex — يحفظ للعنصر ويطبق فورًا
  const hex=panel.querySelector('[data-uxc-hex="text.primaryValue.color"]');
  hex.value='#ff8800';
  hex.dispatchEvent(new Event('input',{bubbles:true}));
  await tick(320);
  expect(getComponentStyle('card:ux:panel').text.primaryValue.color).toBe('#ff8800');
  expect(cardEl.style.getPropertyValue('--uxc-primaryValue-color')).toBe('#ff8800');
  // المعاينة داخل اللوحة تتبع الإعداد الفعّال
  const pv=panel.querySelector('.uxc-preview-box');
  expect(pv.style.getPropertyValue('--uxc-primaryValue-color')).toBe('#ff8800');
  // متقدم: الظلال والحدود
  panel.querySelector('[data-uxc-tab="advanced"]').click();
  panel.querySelector('[data-uxc-seg="box.shadow"] button[data-v="lg"]').click();
  expect(getComponentStyle('card:ux:panel').box.shadow).toBe('lg');
  expect(cardEl.style.getPropertyValue('box-shadow')).toContain('var(--shadow-lg)');
  closeModal();host.remove();
 });

 test('تخصيص: اللوحة — إجراءات: إعادة العنصر، نسخ، تطبيق على هدف محدد',async()=>{
  clean();ensureModalRoot();
  const host=document.createElement('div');document.body.append(host);
  host.innerHTML=card({title:'بطاقة ١',body:'x',persistKey:'ux:act1',collapsible:false})+card({title:'بطاقة ٢',body:'y',persistKey:'ux:act2',collapsible:false});
  bindCards(host);
  const cards=[...host.querySelectorAll('.ux-card[data-display-key]')];
  const el1=cards.find(c=>c.dataset.displayKey==='ux:act1');
  const el2=cards.find(c=>c.dataset.displayKey==='ux:act2');
  applyUniversalStyles(host,'');
  setComponentStyle('card:ux:act1',{base:{fontSize:24}},{type:'card'});
  openCustomizerForElement(el1);
  let panel=document.querySelector('#modal-root .uxc-modal');
  panel.querySelector('[data-uxc-tab="actions"]').click();
  // نسخ
  panel.querySelector('[data-uxc-copy]').click();
  expect(getStyleClipboard().fromId).toBe('card:ux:act1');
  // تطبيق على… : القائمة تعرض العناصر المعروفة عدا الحالي
  panel.querySelector('[data-uxc-applyto]').click();
  const list=panel.querySelector('[data-uxc-tlist]');
  const boxes=[...list.querySelectorAll('input')];
  const target=boxes.find(i=>i.value==='card:ux:act2');
  expect(Boolean(target)).toBe(true);
  expect(boxes.find(i=>i.value==='card:ux:act1')).toBe(undefined); // الحالي مستثنى
  target.checked=true;
  panel.querySelector('[data-uxc-apply]').click();
  // تأكيد صريح قبل أي تطبيق جماعي
  const confirm=document.querySelector('#modal-root [data-ok]');
  expect(Boolean(confirm)).toBe(true);
  confirm.click();
  await tick(10);
  expect(getComponentStyle('card:ux:act2').base.fontSize).toBe(24);
  // إعادة عنصر واحد: confirm مدمج على خطوتين
  openCustomizerForElement(el2);
  panel=document.querySelector('#modal-root .uxc-modal');
  panel.querySelector('[data-uxc-tab="actions"]').click();
  const resetBtn=panel.querySelector('[data-uxc-reset-element]');
  resetBtn.click(); // خطوة التأكيد الأولى
  expect(resetBtn.dataset.confirm).toBe('1');
  resetBtn.click(); // تنفيذ
  expect(getComponentStyle('card:ux:act2')).toBe(null);
  expect(getComponentStyle('card:ux:act1').base.fontSize).toBe(24); // المصدر لم يتأثر
  applyAllComponentStyles(document);
  expect(el2.style.getPropertyValue('--cd-fs')).toBe('1.000'); // عاد للموروث
  closeModal();host.remove();
 });

 test('تخصيص: حفظ كافتراضي للنوع من اللوحة (بأمر صريح + تأكيد)',async()=>{
  clean();ensureModalRoot();
  const host=document.createElement('div');document.body.append(host);
  host.innerHTML=card({title:'بطاقة',body:'x',persistKey:'ux:def',collapsible:false});
  bindCards(host);
  const el=host.querySelector('.ux-card');
  applyUniversalStyles(host,'');
  setComponentStyle('card:ux:def',{text:{fieldLabel:{color:'#0a0a0a'}}},{type:'card'});
  openCustomizerForElement(el);
  const panel=document.querySelector('#modal-root .uxc-modal');
  panel.querySelector('[data-uxc-tab="actions"]').click();
  panel.querySelector('[data-uxc-save-type]').click();
  const ok=document.querySelector('#modal-root [data-ok]');
  expect(Boolean(ok)).toBe(true);
  ok.click();
  await tick(10);
  expect(getTypeDefault('card').text.fieldLabel.color).toBe('#0a0a0a');
  // Override العنصر ما زال محفوظًا — لم يُنقل أو يُمسح
  expect(getComponentStyle('card:ux:def').text.fieldLabel.color).toBe('#0a0a0a');
  closeModal();host.remove();
 });

 // ===== الجداول: إعدادات المظهر داخل Universal DataGrid نفسه =====
 test('جدول: 🎨 مظهر الجدول — حفظ مستقل داخل grid prefs وتطبيق فوري',async()=>{
  clean();
  const g=document.createElement('div');document.body.append(g);
  mountGrid(g,{rows:[{id:'1',t:'أ'}],columns:[{key:'t',label:'T'}],storageKey:'uxc-grid-1',title:'جدول ١'});
  const g2=document.createElement('div');document.body.append(g2);
  mountGrid(g2,{rows:[{id:'1',t:'أ'}],columns:[{key:'t',label:'T'}],storageKey:'uxc-grid-2',title:'جدول ٢'});
  const gear=g.querySelector('.dg-head-gear');
  expect(Boolean(gear)).toBe(true);
  gear.click();
  const pop=document.querySelector('.dg-appear-pop');
  expect(Boolean(pop)).toBe(true);
  // حجم خط حر (10–20) بدل ثلاث درجات فقط
  const range=pop.querySelector('[data-apr="fontPx"]');
  range.value='17';
  range.dispatchEvent(new Event('change',{bubbles:true}));
  // لون رأس الجدول
  const headBg=pop.querySelector('[data-apcolor="headBg"]');
  headBg.value='#101010';
  headBg.dispatchEvent(new Event('change',{bubbles:true}));
  await tick(10);
  const saved=prefs.get('grid:uxc-grid-1');
  expect(saved.appear.fontPx).toBe(17);
  expect(saved.appear.headBg).toBe('#101010');
  expect(g.style.getPropertyValue('--dg-fpx')).toBe('17px');
  expect(g.style.getPropertyValue('--dg-head-bg')).toBe('#101010');
  // الجدول الثاني مستقل تمامًا
  const saved2=prefs.get('grid:uxc-grid-2');
  expect(saved2?.appear?.fontPx).toBe(undefined);
  expect(g2.style.getPropertyValue('--dg-fpx')).toBe('');
  // إعادة مظهر الجدول الأول فقط
  pop.querySelector('.dg-appear-reset').click();
  await tick(10);
  expect(prefs.get('grid:uxc-grid-1').appear.fontPx).toBe(undefined);
  expect(g.style.getPropertyValue('--dg-fpx')).toBe('');
  g.remove();g2.remove();
 });

 test('جدول: المظهر المحفوظ يُستعاد عند إعادة Mount (إعادة فتح البرنامج)',()=>{
  clean();
  prefs.set('grid:uxc-grid-3',{appear:{fontPx:15.5,rowPad:12,textColor:'#202020'}});
  const g=document.createElement('div');document.body.append(g);
  mountGrid(g,{rows:[{id:'1',t:'أ'}],columns:[{key:'t',label:'T'}],storageKey:'uxc-grid-3',title:'جدول ٣'});
  expect(g.style.getPropertyValue('--dg-fpx')).toBe('15.5px');
  expect(g.style.getPropertyValue('--dg-rowpad')).toBe('12px');
  expect(g.style.getPropertyValue('--dg-text')).toBe('#202020');
  g.remove();
 });

 // ===== سلامة البيانات =====
 test('سلامة: النظام UI فقط — مخزن مركزي واحد ولا مفاتيح مبعثرة لكل عنصر',()=>{
  clean();
  const before=new Set();
  for(let i=0;i<localStorage.length;i++)before.add(localStorage.key(i));
  setComponentStyle('card:safe',{base:{fontSize:20}},{type:'card',pageId:'pg'});
  setTypeDefault('card',{box:{radius:10}});
  setGlobalStyle({text:{badge:{fs:12}}});
  copyComponentStyle('card:safe',{type:'card'});
  applyStyleToComponentIds(['card:other'],getStyleClipboard().style,{replace:true});
  const added=[];
  for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(!before.has(k))added.push(k)}
  // المفتاح الجديد الوحيد هو namespace النظام المركزي — لا مفتاح لكل عنصر
  expect(added.join(',')).toBe('akl:prefs:ui:component-styles');
  const state=getComponentStyleState();
  expect(state.version).toBe(1);
  expect(state.components['card:safe'].style.base.fontSize).toBe(20);
  expect(state.components['card:safe'].pageId).toBe('pg');
  const counts=getStyleCounts();
  expect(counts.components).toBe(2);
  expect(counts.types).toBe(1);
 });

 test('سلامة: إعادة الضبط الواسعة لا تمس إعدادات الجداول ولا حالة الطي',()=>{
  clean();
  prefs.set('grid:keep-me',{fontSize:'large',appear:{fontPx:16}});
  setComponentStyle('card:w1',{base:{fontSize:20}},{type:'card'});
  setGlobalStyle({base:{fontSize:14}});
  resetAllComponentOverrides();
  resetUniversalDefaults();
  expect(prefs.get('grid:keep-me').fontSize).toBe('large');
  expect(prefs.get('grid:keep-me').appear.fontPx).toBe(16);
  expect(getComponentStyle('card:w1')).toBe(null);
 });

 // ===== السيناريو النهائي الكامل (البند 30) =====
 test('السيناريو النهائي: كل وحدة تحتفظ بإعداداتها بعد "إعادة الفتح" وتغيير العام',()=>{
  clean();
  // 1) بطاقة الموكل: خط كبير ولون معين
  setComponentStyle('card:client-main-data',{base:{fontSize:22},text:{primaryValue:{color:'#c00000'}}},{type:'card',pageId:'client-details'});
  // 2) بطاقة الملفات: خط مختلف
  setComponentStyle('card:client-files',{base:{fontSize:15}},{type:'card',pageId:'client-details'});
  // 3) قسم الجلسات: خلفية مختلفة (قسم الأحكام لا يتأثر)
  setComponentStyle('section:client-details:hearings',{box:{bg:'#003300'}},{type:'section',pageId:'client-details'});
  // 4) مرحلة معينة: تصميم مختلف (بقية المراحل سليمة)
  setComponentStyle('stage:case-77',{box:{accent:'#0000cc',radius:22},text:{mainTitle:{fw:'800'}}},{type:'stage'});
  // 5) صفحة معينة
  setComponentStyle('page:client-details',{text:{mainTitle:{fs:26}}},{type:'page'});
  // 6) جدول واحد — إعداداته في مخزن الجداول نفسه
  prefs.set('grid:client-files',{appear:{fontPx:16,headBg:'#222222'}});
  // 7) "أعد فتح البرنامج": إفراغ الذاكرة وإعادة القراءة من المخزن الدائم
  const persisted=prefs.get('ui:component-styles',null);
  expect(Boolean(persisted)).toBe(true);
  _reloadComponentStylesForTests();
  expect(resolveComponentStyle('card:client-main-data',{type:'card',pageId:'client-details'}).base.fontSize).toBe(22);
  expect(resolveComponentStyle('card:client-files',{type:'card',pageId:'client-details'}).base.fontSize).toBe(15);
  expect(resolveComponentStyle('section:client-details:hearings',{type:'section',pageId:'client-details'}).box.bg).toBe('#003300');
  expect(resolveComponentStyle('section:client-details:judgments',{type:'section',pageId:'client-details'}).box?.bg).toBe(undefined);
  expect(resolveComponentStyle('stage:case-77',{type:'stage'}).box.accent).toBe('#0000cc');
  expect(resolveComponentStyle('stage:case-88',{type:'stage'}).box?.accent).toBe(undefined);
  expect(prefs.get('grid:client-files').appear.headBg).toBe('#222222');
  // تغيير الإعداد العام — العناصر التي لها Override لا تتأثر
  setGlobalStyle({base:{fontSize:12},text:{primaryValue:{color:'#0f0f0f'},mainTitle:{fs:14}}});
  expect(resolveComponentStyle('card:client-main-data',{type:'card',pageId:'client-details'}).base.fontSize).toBe(22);
  expect(resolveComponentStyle('card:client-main-data',{type:'card',pageId:'client-details'}).text.primaryValue.color).toBe('#c00000');
  // خاصية لم يخصصها العنصر (mainTitle.fs) يرثها من صفحته لا من العام
  expect(resolveComponentStyle('card:client-main-data',{type:'card',pageId:'client-details'}).text.mainTitle.fs).toBe(26);
  // عنصر جديد بلا أي تخصيص يتبع العام
  expect(resolveComponentStyle('card:brand-new',{type:'card',pageId:'other'}).base.fontSize).toBe(12);
  expect(resolveComponentStyle('card:brand-new',{type:'card',pageId:'other'}).text.primaryValue.color).toBe('#0f0f0f');
  // إعادة إعدادات عنصر واحد فقط — يعود للموروث (العام=12) وحده
  clearComponentStyle('card:client-files');
  expect(resolveComponentStyle('card:client-files',{type:'card',pageId:'client-details'}).base.fontSize).toBe(12);
  expect(resolveComponentStyle('card:client-files',{type:'card',pageId:'client-details'}).text.mainTitle.fs).toBe(26); // ما زال يرث صفحته
  expect(getComponentStyle('card:client-main-data').base.fontSize).toBe(22); // جاره لم يتغير
  expect(getComponentStyle('section:client-details:hearings').box.bg).toBe('#003300');
 });
}

