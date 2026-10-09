// اختبارات طبقة تجربة الاستخدام (v4.6): آخر ما فُتح، لوحة الأوامر، التحية والتاريخ، الخط الزمني، الإشعارات، ومذكّرة البحث.
import {trackRecent,getRecent,removeRecent,clearRecent,_resetRecentsCache} from '../services/recents.js';
import {highlightMatch,scoreCommand,filterCommands,staticCommands} from '../ui/palette.js';
import {getFavorites,toggleFavorite,removeFavorite} from '../services/favorites.js';
import {greetingKey,longDateAr,GREETINGS} from '../core/format.js';
import {timelineHtml,timelineSummary,bindTimeline} from '../modules/timeline-view.js';
import {toast,clearToasts} from '../ui/toast.js';
import {rowText} from '../services/entity-query.js';
import {FILE_LIST_CHIPS,listNavFor,listNavHtml} from '../modules/list-page.js';

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
 test('آخر ما فُتح والمفضلة: معزولان بين ملفات المكتب النشطة',async()=>{
  _resetRecentsCache();clearRecent('office-a');clearRecent('office-b');
  trackRecent('client:a','موكل أ',{scope:'office-a'});trackRecent('client:b','موكل ب',{scope:'office-b'});
  expect(getRecent('office-a').map(item=>item.route)).toContain('client:a');
  expect(getRecent('office-a').some(item=>item.route==='client:b')).toBe(false);
  await removeFavorite('file:a','office-a');await removeFavorite('file:b','office-b');
  await toggleFavorite({route:'file:a',title:'ملف أ'},'office-a');
  await toggleFavorite({route:'file:b',title:'ملف ب'},'office-b');
  expect(getFavorites('office-a').some(item=>item.route==='file:a')).toBe(true);
  expect(getFavorites('office-a').some(item=>item.route==='file:b')).toBe(false);
  await removeFavorite('file:a','office-a');await removeFavorite('file:b','office-b');
  clearRecent('office-a');clearRecent('office-b');_resetRecentsCache();
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
 test('لوحة الأوامر: تبحث عن جميع كلمات العبارة دون اشتراط تتابعها',()=>{
  expect(scoreCommand({label:'جلسة جديدة',sub:'ملف موكل'},'جلسة موكل')>0).toBe(true);
 });
 test('لوحة الأوامر: تعرض إجراءات سريعة مرتبطة بالملف الحالي',()=>{
  const app={route:'file:file-test',go(){}};
  const cmds=staticCommands(app);
  expect(cmds.some(command=>command.group==='في السياق الحالي'&&command.label==='جلسة في الملف')).toBe(true);
  expect(cmds.some(command=>command.id==='qa:quick-add')).toBe(true);
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
  document.body.innerHTML='<div id="app"><aside id="sidebar"></aside><main><section id="main-content"></section></main></div><div id="modal-root"></div>';
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
 test('شرائح قائمة الملفات: كل criterion يستند إلى بيانات فعلية',()=>{
  // كل شريحة لها ids: «الكل» و«مثبتة» و«جلسة قادمة» تعتمدان على سياق، others على بيانات السجل
  const names=FILE_LIST_CHIPS.map(([k])=>k);
  expect(names).toContain('all');expect(names).toContain('active');expect(names).toContain('action');
  expect(names).toContain('hearing');expect(names).toContain('stale');expect(names).toContain('pinned');
  const byId=new Map(FILE_LIST_CHIPS.map(([k,,fn])=>[k,fn]));
  const open={id:'a',status:'open'},closed={id:'b',status:'closed'},archived={id:'c',status:'open',isArchived:true};
  expect(byId.get('all')(open)).toBe(true);
  expect(byId.get('active')(open)).toBe(true);
  expect(byId.get('active')(closed)).toBe(false);
  expect(byId.get('active')(archived)).toBe(false);
  // «تحتاج إجراء»: خطوة تالية بلا موعد أو موعدها اليوم/ماضٍ
  expect(byId.get('action')({...open,nextStep:'متابعة',nextStepDate:''})).toBe(true);
  expect(byId.get('action')({...open,nextStep:'متابعة',nextStepDate:'2999-01-01'})).toBe(false);
  expect(byId.get('action')({...open,nextStep:'',nextStepDate:''})).toBe(false);
  // «راكدة»: لا نشاط منذ 45 يومًا
  expect(byId.get('stale')({...open,lastActivityAt:'2020-01-01T00:00:00.000Z'})).toBe(true);
  expect(byId.get('stale')({...open,lastActivityAt:new Date().toISOString()})).toBe(false);
  expect(byId.get('stale')({...closed,lastActivityAt:'2020-01-01T00:00:00.000Z'})).toBe(false);
 });
 test('سابق/تالي القائمة: يحدد ids الدفعة الظاهرة',()=>{
  const app={__listNav:{store:'files',ids:['a','b','c']}};
  expect(listNavFor(app,'files','a')).toBeTruthy();
  expect(listNavFor(app,'files','a').prevId).toBe(null);
  expect(listNavFor(app,'files','a').nextId).toBe('b');
  expect(listNavFor(app,'files','b').prevId).toBe('a');
  expect(listNavFor(app,'files','b').nextId).toBe('c');
  expect(listNavFor(app,'files','c').nextId).toBe(null);
  expect(listNavFor(app,'files','zzz')).toBe(null);
  expect(listNavFor(app,'clients','a')).toBe(null);
  expect(listNavFor(null,'files','a')).toBe(null);
  const html=listNavHtml(app,'files','b');
  expect(html.includes('data-list-nav-id="a"')).toBe(true);
  expect(html.includes('data-list-nav-id="c"')).toBe(true);
  expect(html.includes('2 / 3')).toBe(true);
  expect(listNavHtml({__listNav:null},'files','a')).toBe('');
 });
}
