// اختبارات مساحة عمل الملفات (Four-Zone Files Workspace)
import {listPage} from '../modules/list-page.js';
import {filesWorkspaceHtml,paintFilesWorkspace,bindFilesChrome,undoState} from '../modules/files-workspace.js';
import {FILE_LIST_CHIPS} from '../modules/list-page.js';
import {mountGrid} from '../ui/datagrid.js';
import {openWorkspaceMenu,closeWorkspaceMenu,isWorkspaceMenuOpen} from '../ui/workspace-menu.js';
import {PRESETS} from '../services/entity-query.js';
import {pushUndo,removeUndo,runUndo,clearUndo,undoDepth} from '../core/undo-stack.js';
import {toast,clearToasts} from '../ui/toast.js';

const mockApp=()=>({route:'files',ctx:{profile:{id:'test'}},office:{},__lists:{}});
const parse=html=>{const d=document.createElement('div');d.innerHTML=html;return d};

export function runFilesWorkspaceTests(test,expect){
 test('صفحة الملفات: الهيكل أربعة أقسام دون رأس القائمة القديم',()=>{
  const html=listPage(mockApp(),'files',null);
  expect(html.includes('data-files-workspace')).toBe(true);
  expect(html.includes('data-fw-pagebar')).toBe(true);
  expect(html.includes('data-fw-toolbar')).toBe(true);
  expect(html.includes('id="list-grid"')).toBe(true);
  expect(html.includes('page-head list-head')).toBe(false);
  expect(html.includes('list-filter-panel')).toBe(false);
  expect(html.includes('id="list-q"')).toBe(true);
  expect(html.includes('data-list-add')).toBe(true);
 });

 test('صفحة الملفات: الشريط المضغوط — إضافة ملف جديد · رجوع · عودة · المزيد فقط',()=>{
  const root=parse(listPage(mockApp(),'files',null));
  const bar=root.querySelector('[data-fw-pagebar]');
  expect(Boolean(bar)).toBe(true);
  const keys=[...bar.children].map(el=>{
   if(el.matches('.fw-title'))return 'title';
   if(el.hasAttribute('data-list-add'))return 'addfile';
   if(el.hasAttribute('data-fw-search'))return 'search';
   if(el.hasAttribute('data-fw-quick-add'))return 'quick';
   if(el.hasAttribute('data-fw-back'))return 'back';
   if(el.hasAttribute('data-fw-undo'))return 'undo';
   if(el.hasAttribute('data-fw-home'))return 'home';
   if(el.hasAttribute('data-fw-page-more'))return 'more';
   return el.className;
  });
  expect(keys.join('|')).toBe('addfile|back|undo|more');
  expect(bar.querySelector('[data-list-add]').textContent).toContain('إضافة ملف جديد');
  expect(bar.querySelectorAll('[data-list-add]').length).toBe(1);
  // العناصر المزالة من هذا الشريط انتقلت أو اختفت نهائيًا من الشريط نفسه
  expect(Boolean(bar.querySelector('.fw-title'))).toBe(false);
  expect(Boolean(bar.querySelector('[data-fw-search]'))).toBe(false);
  expect(Boolean(bar.querySelector('[data-fw-quick-add]'))).toBe(false);
  expect(Boolean(bar.querySelector('[data-fw-home]'))).toBe(false);
 });

 test('صفحة الملفات: ترتيب شريط أدوات الجدول — «مسح التحديد» أخيرًا (أقصى اليسار)',()=>{
  const root=parse(listPage(mockApp(),'files',null));
  const bar=root.querySelector('[data-fw-toolbar]');
  const keys=[...bar.children].map(el=>{
   if(el.hasAttribute('data-fw-display'))return 'display';
   if(el.hasAttribute('data-fw-filters'))return 'filters';
   if(el.hasAttribute('data-fw-time'))return 'time';
   if(el.id==='list-q')return 'search';
   if(el.hasAttribute('data-fw-clear'))return 'clear';
   if(el.hasAttribute('data-fw-cards'))return 'cards';
   if(el.hasAttribute('data-fw-io'))return 'io';
   if(el.hasAttribute('data-fw-sel-clear'))return 'selclear';
   return el.className;
  });
  expect(keys.join('|')).toBe('display|filters|time|search|clear|cards|io|selclear');
  expect(bar.querySelectorAll('[data-fw-sel-clear]').length).toBe(1);
 });

 test('صفحة الملفات: المزيد يحتوي الثيمات وإجراءات الصف وتخصيص الصفحة',()=>{
  const html=listPage(mockApp(),'files',null);
  expect(html.includes('data-fw-themes')).toBe(true);
  expect(html.includes('data-qa-custom')).toBe(true);
  expect(html.includes('data-customize-page')).toBe(true);
  expect(html.includes('data-fw-panel="time"')).toBe(true);
  expect(html.includes('data-file-chip="active"')).toBe(true);
  expect(html.includes('data-preset="today"')).toBe(true);
 });

 test('بقية القوائم لا تتأثر: الموكلون يبقون بالرأس ولوحة الفلاتر',()=>{
  const html=listPage(mockApp(),'clients',null);
  expect(html.includes('data-files-workspace')).toBe(false);
  expect(html.includes('list-head')).toBe(true);
  expect(html.includes('list-filter-panel')).toBe(true);
  expect(html.includes('+ إضافة موكل')).toBe(true);
  expect(html.includes('عوامل التصفية والفترات')).toBe(true);
 });

 test('شريط الصفحة لا يستخدم سمات الرجوع المخفية في المحتوى',()=>{
  const html=listPage(mockApp(),'files',null);
  expect(html.includes('data-page-back')).toBe(false);
  expect(html.includes('data-fw-back')).toBe(true);
  expect(html.includes('data-fw-undo')).toBe(true);
 });

 test('العودة (undo): معطّلة بلا سجل، وتتفعّل فور تسجيل إجراء قابل للعكس',()=>{
  clearUndo();
  const host=parse(listPage(mockApp(),'files',null));
  document.body.append(host);
  const st={q:'',preset:'all',from:'',to:'',chip:'all',status:'all'};
  paintFilesWorkspace(host,st,null);
  const btn=host.querySelector('[data-fw-undo]');
  expect(btn.disabled).toBe(true);
  expect(btn.classList.contains('is-ready')).toBe(false);
  let ran=0;
  const rec=pushUndo({label:'إجراء تجريبي',run:async()=>{ran++}});
  paintFilesWorkspace(host,st,null);
  expect(btn.disabled).toBe(false);
  expect(btn.classList.contains('is-ready')).toBe(true);
  expect(btn.title.includes('إجراء تجريبي')).toBe(true);
  expect(undoState().ready).toBe(true);
  removeUndo(rec);
  paintFilesWorkspace(host,st,null);
  expect(btn.disabled).toBe(true);
  expect(ran).toBe(0);
  clearUndo();
  host.remove();
 });

 test('العودة (undo): تنفيذ أعلى السجل يُفرغه ويُبطل الزر',async()=>{
  clearUndo();
  let ran=0;
  pushUndo({label:'أولًا',run:async()=>{ran++}});
  pushUndo({label:'ثانيًا',run:async()=>{ran+=10}});
  expect(undoDepth()).toBe(2);
  const done=await runUndo();
  expect(done.label).toBe('ثانيًا');
  expect(ran).toBe(10);
  expect(undoDepth()).toBe(1);
  const second=await runUndo();
  expect(second.label).toBe('أولًا');
  expect(ran).toBe(11);
  expect(await runUndo()).toBe(null);
  expect(undoState().ready).toBe(false);
  clearUndo();
 });

 test('العودة (undo): «مسح الفلاتر» تُسجَّل وترجع البحث والفترة والشرائح كما كانت',async()=>{
  clearUndo();
  const host=parse(listPage(mockApp(),'files',null));
  document.body.append(host);
  const st={q:'دعوى',preset:'today',from:'',to:'',chip:'active',status:'all'};
  let loads=0;
  const grid=mountGrid(host.querySelector('#list-grid'),{workspace:true,title:'الملفات',storageKey:'test:fw-undo-clear:'+Date.now(),rows:[{id:'1',name:'أ'}],columns:[{key:'name',label:'الاسم',searchable:true,filterable:true}]});
  bindFilesChrome(mockApp(),{root:host,st,getGrid:()=>grid,load:()=>{loads++},syncFilterSummary:()=>{},saveListView:()=>{}});
  paintFilesWorkspace(host,st,grid);
  host.querySelector('[data-fw-clear]').click();
  expect(st.q).toBe('');
  expect(st.preset).toBe('all');
  expect(st.chip).toBe('all');
  expect(undoDepth()).toBe(1);
  expect(host.querySelector('#list-q').value).toBe('');
  const undoBtn=host.querySelector('[data-fw-undo]');
  expect(undoBtn.disabled).toBe(false);
  undoBtn.click();
  await new Promise(r=>setTimeout(r,0));
  expect(st.q).toBe('دعوى');
  expect(st.preset).toBe('today');
  expect(st.chip).toBe('active');
  expect(host.querySelector('#list-q').value).toBe('دعوى');
  expect(host.querySelector('[data-preset="today"]').classList.contains('active')).toBe(true);
  expect(host.querySelector('[data-file-chip="active"]').classList.contains('active')).toBe(true);
  expect(undoDepth()).toBe(0);
  clearUndo();
  host.remove();
 });

 test('العودة (undo): إشعار يحمل عكسًا حقيقيًا يدخل السجل، والإجراء غير العكسي لا يدخل',()=>{
  clearUndo();
  toast('تم التنقل','ok',{actionLabel:'افتح',action:()=>{},duration:0});
  expect(undoDepth()).toBe(0);
  toast('تم الحذف المنطقي','warn',{actionLabel:'تراجع',undoable:true,undoLabel:'حذف سجل',action:()=>{},duration:0});
  expect(undoDepth()).toBe(1);
  expect(undoState().label).toBe('حذف سجل');
  clearUndo();
  clearToasts();
 });

 test('قائمة مساحة العمل: تفتح وتُغلق بالنقر المتكرر وEscape',()=>{
  closeWorkspaceMenu();
  const btn=document.createElement('button');
  document.body.append(btn);
  const el=openWorkspaceMenu(btn,{html:'<button type="button">عنصر</button>',width:220});
  expect(Boolean(el)).toBe(true);
  expect(isWorkspaceMenuOpen()).toBe(true);
  openWorkspaceMenu(btn,{html:'<button type="button">عنصر</button>'});
  expect(isWorkspaceMenuOpen()).toBe(false);
  openWorkspaceMenu(btn,{html:'<button type="button">ثاني</button>'});
  document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  expect(isWorkspaceMenuOpen()).toBe(false);
  btn.remove();
 });

 test('جدول مساحة العمل: يخفي الكروم الداخلي ويعرّض واجهة القوائم',()=>{
  const root=document.createElement('div');
  document.body.append(root);
  const grid=mountGrid(root,{workspace:true,title:'الملفات',storageKey:'test:fw:'+Date.now(),rows:[{id:'1',name:'ملف أ'},{id:'2',name:'ملف ب'}],columns:[{key:'name',label:'الاسم',searchable:true,filterable:true,sortable:true}]});
  expect(root.classList.contains('dg-workspace')).toBe(true);
  expect(typeof grid.openDisplayMenu).toBe('function');
  expect(typeof grid.openFiltersMenu).toBe('function');
  expect(typeof grid.openExportMenu).toBe('function');
  expect(typeof grid.clearQueryFilters).toBe('function');
  expect(typeof grid.toggleCards).toBe('function');
  expect(root.__grid).toBe(grid);
  root.remove();
 });

 test('مسح فلاتر الجدول لا يمس الكثافة ولا طرق العرض المحفوظة ولا التحديد',()=>{
  const root=document.createElement('div');
  document.body.append(root);
  const grid=mountGrid(root,{workspace:true,title:'الملفات',storageKey:'test:fw-clear:'+Date.now(),selectable:true,rows:[{id:'1',name:'أ'},{id:'2',name:'ب'}],columns:[{key:'name',label:'الاسم',searchable:true,filterable:true,sortable:true}]});
  grid.sortBy('name','asc');
  const dens=grid.getUi().density;
  const chk=root.querySelector('.dg-rowchk');
  if(chk){chk.checked=true;chk.dispatchEvent(new Event('change',{bubbles:true}))}
  const selectedBefore=grid.getSelection().length;
  grid.clearQueryFilters();
  expect(grid.getUi().density).toBe(dens);
  expect(grid.getUi().filterCount).toBe(0);
  expect(Array.isArray(grid.getUi().sort)).toBe(true);
  expect(grid.getUi().sort.length).toBe(0);
  if(selectedBefore)expect(grid.getSelection().length).toBe(selectedBefore);
  root.remove();
 });

 test('تبديل البطاقات يغيّر الحالة دون فقد واجهة الجدول',()=>{
  const root=document.createElement('div');
  document.body.append(root);
  const grid=mountGrid(root,{workspace:true,title:'الملفات',storageKey:'test:fw-cards:'+Date.now(),rows:[{id:'1',name:'أ'}],columns:[{key:'name',label:'الاسم'}]});
  expect(grid.isCards()).toBe(false);
  grid.toggleCards();
  expect(grid.isCards()).toBe(true);
  expect(root.classList.contains('dg-cards')).toBe(true);
  grid.toggleCards();
  expect(grid.isCards()).toBe(false);
  root.remove();
 });

 test('قائمة إعدادات العرض تفتح كقائمة منسدلة حقيقية',()=>{
  const root=document.createElement('div');
  document.body.append(root);
  const grid=mountGrid(root,{workspace:true,title:'الملفات',storageKey:'test:fw-disp:'+Date.now(),rows:[{id:'1',name:'أ'}],columns:[{key:'name',label:'الاسم'}]});
  const btn=document.createElement('button');
  document.body.append(btn);
  grid.openDisplayMenu(btn);
  const pop=document.querySelector('.dg-ws-pop');
  expect(Boolean(pop)).toBe(true);
  expect(pop.textContent.includes('المظهر والكثافة')).toBe(true);
  expect(pop.textContent.includes('الأعمدة')).toBe(true);
  expect(pop.textContent.includes('تنسيق المساحة')).toBe(true);
  expect(pop.textContent.includes('طرق العرض المحفوظة')).toBe(true);
  pop.querySelector('.dg-x').click();
  expect(Boolean(document.querySelector('.dg-ws-pop'))).toBe(false);
  btn.remove();root.remove();
 });

 test('قائمة الفلاتر وقائمة التصدير تحتويان المجموعات المطلوبة',()=>{
  const root=document.createElement('div');
  document.body.append(root);
  const grid=mountGrid(root,{workspace:true,title:'الملفات',storageKey:'test:fw-io:'+Date.now(),selectable:true,rows:[{id:'1',name:'أ'}],columns:[{key:'name',label:'الاسم',searchable:true,filterable:true,sortable:true}]});
  const btn=document.createElement('button');
  document.body.append(btn);
  grid.openFiltersMenu(btn);
  const filters=document.querySelector('.dg-ws-pop');
  expect(filters.textContent.includes('الفرز')).toBe(true);
  expect(filters.textContent.includes('تصفية مركّبة')).toBe(true);
  expect(filters.textContent.includes('فلاتر الأعمدة')).toBe(true);
  filters.querySelector('.dg-x').click();
  grid.openExportMenu(btn);
  const io=document.querySelector('.dg-ws-pop');
  expect(io.textContent.includes('الطباعة')).toBe(true);
  expect(io.textContent.includes('التصدير')).toBe(true);
  expect(io.textContent.includes('Excel (.xls)')).toBe(true);
  expect(io.textContent.includes('PDF (صورة الجدول)')).toBe(true);
  expect(io.textContent.includes('CSV')).toBe(true);
  io.querySelector('.dg-x').click();
  btn.remove();root.remove();
 });

 test('جمع نطاق التصدير المحلي يعيد صفوف العرض الحالي',async()=>{
  const root=document.createElement('div');
  document.body.append(root);
  const grid=mountGrid(root,{workspace:true,title:'الملفات',storageKey:'test:fw-col:'+Date.now(),rows:[{id:'1',name:'أ'},{id:'2',name:'ب'},{id:'3',name:'ج'}],columns:[{key:'name',label:'الاسم',searchable:true}]});
  const collected=await grid.collectMatchingRows({max:10});
  expect(collected.rows.length).toBe(3);
  expect(collected.truncated).toBe(false);
  root.remove();
 });

 test('وضع مساحة العمل لا يرسم شريط الإجراءات الجماعية القديم إطلاقًا',()=>{
  const root=document.createElement('div');
  document.body.append(root);
  mountGrid(root,{workspace:true,title:'الملفات',storageKey:'test:fw-noselbar:'+Date.now(),selectable:true,
   rows:[{id:'1',name:'أ'}],columns:[{key:'name',label:'الاسم'}],
   bulkActions:[{id:'archive',label:'أرشفة',danger:true}],onBulk:()=>{}});
  const chk=root.querySelector('.dg-rowchk');
  chk.checked=true;chk.dispatchEvent(new Event('change',{bubbles:true}));
  expect(Boolean(root.querySelector('.dg-selbar'))).toBe(false);
  expect(Boolean(root.querySelector('.dg-open-sel'))).toBe(false);
  root.remove();
 });

 test('الجداول العادية خارج مساحة العمل تحتفظ بشريط التحديد وإجراءاته كاملة',()=>{
  const root=document.createElement('div');
  document.body.append(root);
  mountGrid(root,{title:'الجلسات',storageKey:'test:nw-selbar:'+Date.now(),selectable:true,
   rows:[{id:'1',name:'أ'}],columns:[{key:'name',label:'الاسم'}]});
  const sb=root.querySelector('.dg-selbar');
  expect(Boolean(sb)).toBe(true);
  expect(Boolean(sb.querySelector('.dg-sel-clear'))).toBe(true);
  expect(Boolean(sb.querySelector('.dg-sel-print'))).toBe(true);
  expect(Boolean(sb.querySelector('.dg-sel-export'))).toBe(true);
  expect(Boolean(sb.querySelector('.dg-open-sel'))).toBe(true);
  root.remove();
 });

 test('«مسح التحديد» في شريط الأدوات: مخفي بلا تحديد، يظهر بعدّاد، ويمسح التحديد الفعلي',()=>{
  const host=parse(listPage(mockApp(),'files',null));
  document.body.append(host);
  const st={q:'',preset:'all',from:'',to:'',chip:'all',status:'all'};
  let grid;
  grid=mountGrid(host.querySelector('#list-grid'),{workspace:true,title:'الملفات',storageKey:'test:fw-selclear:'+Date.now(),selectable:true,
   rows:[{id:'1',name:'أ'},{id:'2',name:'ب'}],columns:[{key:'name',label:'الاسم'}],
   onChrome:()=>paintFilesWorkspace(host,st,grid)});
  bindFilesChrome(mockApp(),{root:host,st,getGrid:()=>grid});
  const btn=host.querySelector('[data-fw-sel-clear]');
  expect(btn.hidden).toBe(true);
  const boxes=[...host.querySelectorAll('.dg-rowchk')];
  boxes[0].checked=true;boxes[0].dispatchEvent(new Event('change',{bubbles:true}));
  boxes[1].checked=true;boxes[1].dispatchEvent(new Event('change',{bubbles:true}));
  expect(grid.getUi().selected).toBe(2);
  expect(btn.hidden).toBe(false);
  expect(host.querySelector('[data-fw-sel-count]').textContent).toBe('2');
  btn.click();
  expect(grid.getUi().selected).toBe(0);
  expect(grid.getSelection().length).toBe(0);
  expect(btn.hidden).toBe(true);
  // لا يمس البحث: نص البحث في شريط الأدوات يبقى كما هو
  host.remove();
 });

 test('شرائح الملفات ما زالت معرفة كما هي',()=>{
  expect(FILE_LIST_CHIPS.map(([k])=>k).join('|')).toBe('all|active|action|hearing|stale|pinned');
 });

 test('بناء HTML المساحة يستقبل الفترات والشرائح',()=>{
  const html=filesWorkspaceHtml({st:{q:'دعوى',preset:'today',chip:'active',from:'',to:''},presets:PRESETS,chips:FILE_LIST_CHIPS,hasDate:true});
  expect(html.includes('value="دعوى"')).toBe(true);
  expect(html.includes('data-preset="today"')).toBe(true);
  expect(html.includes('chip active')).toBe(true);
 });

 test('مؤشرات الشريط تتحدث دون مسح إعدادات العرض',()=>{
  const host=parse(listPage(mockApp(),'files',null));
  document.body.append(host);
  paintFilesWorkspace(host,{q:'س',preset:'all',chip:'all'}, {getUi:()=>({filterCount:2,cards:false,density:'compact'})});
  const gridBadge=host.querySelector('[data-fw-grid-count]');
  expect(gridBadge.hidden).toBe(false);
  expect(gridBadge.textContent).toBe('2');
  host.remove();
 });
}
