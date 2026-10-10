// اختبارات مساحة عمل الملفات (Four-Zone Files Workspace)
import {listPage} from '../modules/list-page.js';
import {filesWorkspaceHtml,paintFilesWorkspace} from '../modules/files-workspace.js';
import {FILE_LIST_CHIPS} from '../modules/list-page.js';
import {mountGrid} from '../ui/datagrid.js';
import {openWorkspaceMenu,closeWorkspaceMenu,isWorkspaceMenuOpen} from '../ui/workspace-menu.js';
import {PRESETS} from '../services/entity-query.js';

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

 test('صفحة الملفات: ترتيب شريط الصفحة من اليمين إلى اليسار',()=>{
  const root=parse(listPage(mockApp(),'files',null));
  const bar=root.querySelector('[data-fw-pagebar]');
  expect(Boolean(bar)).toBe(true);
  const keys=[...bar.children].map(el=>{
   if(el.matches('.fw-title'))return 'title';
   if(el.hasAttribute('data-list-add'))return 'addfile';
   if(el.hasAttribute('data-fw-search'))return 'search';
   if(el.hasAttribute('data-fw-quick-add'))return 'quick';
   if(el.hasAttribute('data-fw-back'))return 'back';
   if(el.hasAttribute('data-fw-home'))return 'home';
   if(el.hasAttribute('data-fw-page-more'))return 'more';
   return el.className;
  });
  expect(keys.join('|')).toBe('title|addfile|search|quick|back|home|more');
 });

 test('صفحة الملفات: ترتيب شريط أدوات الجدول السبعة',()=>{
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
   return el.className;
  });
  expect(keys.join('|')).toBe('display|filters|time|search|clear|cards|io');
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
  expect(html.includes('data-fw-home')).toBe(true);
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
