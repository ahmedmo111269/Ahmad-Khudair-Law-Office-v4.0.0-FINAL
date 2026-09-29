// اختبارات طبقة تجربة الاستخدام (v4.6): آخر ما فُتح، لوحة الأوامر، التحية والتاريخ، الخط الزمني، الإشعارات، ومذكّرة البحث.
import {trackRecent,getRecent,removeRecent,clearRecent,_resetRecentsCache} from '../services/recents.js';
import {highlightMatch,scoreCommand,filterCommands} from '../ui/palette.js';
import {greetingKey,longDateAr,GREETINGS} from '../core/format.js';
import {timelineHtml,timelineSummary,bindTimeline} from '../modules/timeline-view.js';
import {toast,clearToasts} from '../ui/toast.js';
import {rowText} from '../services/entity-query.js';

export function runUxTests(test,expect){
 test('آخر ما فُتح: يضيف ويزيل التكرار ويحفظ الترتيب',()=>{
  _resetRecentsCache();clearRecent();
  trackRecent('file:1','ملف أ',{icon:'folder'});
  trackRecent('client:2','موكل ب',{icon:'users'});
  trackRecent('file:1','ملف أ محدّث',{icon:'folder'});
  const r=getRecent();
  expect(r.length).toBe(2);
  expect(r[0].route).toBe('file:1');
  expect(r[0].title).toBe('ملف أ محدّث');
  expect(r[1].route).toBe('client:2');
  removeRecent('client:2');
  expect(getRecent().length).toBe(1);
  clearRecent();
  expect(getRecent().length).toBe(0);
 });
 test('آخر ما فُتح: حد أقصى 12 عنصرًا وتجاهل غير الصالح',()=>{
  _resetRecentsCache();clearRecent();
  for(let i=0;i<20;i++)trackRecent('file:'+i,'ملف '+i,{});
  const r=getRecent();
  expect(r.length).toBe(12);
  expect(r[0].route).toBe('file:19');
  trackRecent('','عنوان بلا مسار');
  trackRecent('x:1','');
  expect(getRecent().length).toBe(12);
  clearRecent();
 });
 test('لوحة الأوامر: تمييز المطابقة مع التطبيع العربي',()=>{
  const parts=highlightMatch('أحمد محمد علي','محمد');
  expect(parts.length).toBe(3);
  expect(parts[1].hl).toBe(true);
  expect(parts[1].t).toBe('محمد');
  // إ/أ تعامل كواحدة
  const parts2=highlightMatch('إكرام','اكرام');
  expect(parts2[1].hl).toBe(true);
  // بلا مطابقة: نص واحد غير مميز
  const no=highlightMatch('خالد','محمد');
  expect(no.length).toBe(1);
  expect(no[0].hl).toBe(false);
 });
 test('لوحة الأوامر: الترتيب بالبادئة ثم الاحتواء والحد الأقصى',()=>{
  const cmds=[
   {id:1,label:'الملفات'},{id:2,label:'بحث في الملفات'},{id:3,label:'الأحكام'},
   {id:4,label:'جلسات المحكمة'},{id:5,label:'المحضرين'},{id:6,label:'الإحصاءات'}
  ];
  const out=filterCommands(cmds,'المح');
  expect(out[0].id).toBe(5); // «المحضرين» تبدأ بالمطابقة (أولوية البادئة)
  expect(out[1].id).toBe(4); // «جلسات المحكمة» تحتوي فقط
  expect(out.length).toBe(2);
  const empty=filterCommands(cmds,'');
  expect(empty.length).toBe(6); // بدون بحث: تُعرض كل الأوامر
  const limited=filterCommands(cmds,'ال', {limit:3});
  expect(limited.length).toBe(3);
 });
 test('التحية حسب الوقت والتاريخ العربي الكامل',()=>{
  expect(greetingKey(7)).toBe('morning');
  expect(greetingKey(13)).toBe('noon');
  expect(greetingKey(16)).toBe('evening');
  expect(greetingKey(2)).toBe('night');
  expect(GREETINGS.morning.length>0).toBe(true);
  const d=longDateAr(new Date(2026,8,29)); // الثلاثاء 29 سبتمبر 2026
  expect(d).toBe('الثلاثاء 29 سبتمبر 2026');
 });
 test('الخط الزمني: ملخص الأنواع وعرض فارغ أنيق',()=>{
  const empty=timelineHtml(null);
  expect(empty.includes('لا يوجد خط زمني')).toBe(true);
  const s=timelineSummary({timeline:[{type:'جلسة',date:'2026-01-01'},{type:'جلسة',date:'2026-02-01'},{type:'حكم',date:'2026-03-01'}],counts:{hearings:2,judgments:1}});
  expect(s.total).toBe(3);
  const hasHearings=s.counts.some(([k,n])=>k==='جلسة'&&n===2);
  expect(hasHearings).toBe(true);
 });
 test('الخط الزمني: يعرض القادم والسابق وفاصل الآن وروابط الفتح',()=>{
  const future='2030-01-01T09:00';
  const t={timeline:[{type:'جلسة',date:future,title:'جلسة 01/01/2030',detail:'محكمة شمال',entityId:'h1'},{type:'حكم',date:'2020-01-01',title:'حكم ابتدائي',detail:'',entityId:'j1'}],counts:{hearings:1,judgments:1},future:{type:'جلسة',date:future,title:'جلسة 01/01/2030',entityId:'h1'}};
  const html=timelineHtml(t);
  expect(html.includes('القادم')).toBe(true);
  expect(html.includes('السابق')).toBe(true);
  expect(html.includes('الآن')).toBe(true);
  expect(html.includes('data-open-rec="hearings:h1"')).toBe(true);
  expect(html.includes('data-open-rec="judgments:j1"')).toBe(true);
 });
 test('الخط الزمني: الفلترة بالنوع تخفي غير المطابق',()=>{
  document.body.innerHTML='<div id="tl-host">'+timelineHtml({timeline:[{type:'جلسة',date:'2026-01-01',title:'أ',entityId:'h1'},{type:'حكم',date:'2020-01-01',title:'ب',entityId:'j1'}],counts:{hearings:1,judgments:1}})+'</div>';
  const host=document.querySelector('#tl-host');
  bindTimeline(host,{onOpen:()=>{}});
  const chip=[...host.querySelectorAll('[data-tl-filter]')].find(c=>c.dataset.tlFilter==='جلسة');
  chip.click();
  const items=[...host.querySelectorAll('.tl-item')];
  expect(items.length).toBe(2);
  expect(items[0].hidden).toBe(false);
  expect(items[1].hidden).toBe(true);
  document.body.innerHTML='';
 });
 test('الإشعارات: إنشاء إشعار بخاصية role وزر إغلاق',async()=>{
  clearToasts();
  const dismiss=toast('تم الحفظ بنجاح','ok');
  const el=document.querySelector('#toast-stack .toast');
  expect(Boolean(el)).toBe(true);
  expect(el.getAttribute('role')).toBe('status');
  expect(el.textContent.includes('تم الحفظ بنجاح')).toBe(true);
  expect(Boolean(el.querySelector('.toast-x'))).toBe(true);
  dismiss();
  await new Promise(r=>setTimeout(r,220)); // انتظار حركة الخروج
  expect(document.querySelectorAll('#toast-stack .toast').length).toBe(0);
 });
 test('الإشعارات: الخطأ يستخدم role=alert',()=>{
  clearToasts();
  toast('فشل الحفظ','error');
  const el=document.querySelector('#toast-stack .toast');
  expect(el.getAttribute('role')).toBe('alert');
  clearToasts();
 });
 test('مذكّرة نص البحث: نتيجة ثابتة وتطبيع عربي',()=>{
  const row={id:'x',fullName:'أحمد إبراهيم',phone:'0100',caseNumber:'١٢٣٤٥'};
  const a=rowText(row),b=rowText(row);
  expect(a).toBe(b);
  expect(a.includes('احمد ابراهيم')).toBe(true);
  expect(a.includes('12345')).toBe(true);
 });
}
