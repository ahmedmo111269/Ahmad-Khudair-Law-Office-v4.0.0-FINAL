// اختبارات نظام الطي المركزي: الافتراضي والحالة الحالية والتثبيت والطي الجماعي.
import {
 _resetCollapseStateForTests,getCollapseRecord,resolveCollapseState,saveCollapseState,
 toggleCollapsePin,isCollapsePinned,setDefaultCollapseState,clearCollapseState,
 resetCollapseStates,COLLAPSE_PREF_KEY
} from '../ui/collapse-state.js';
import {enhanceCollapsiblePanels} from '../ui/collapsible.js';
import {mountGrid} from '../ui/datagrid.js';
import {card,bindCards} from '../ui/card.js';
import {prefs} from '../core/preferences.js';

export function runCollapseStateTests(test,expect){
 test('طي الأقسام: الوضع الافتراضي يطبق على العناصر الجديدة مع استثناء الجدول الرئيسي',()=>{
  _resetCollapseStateForTests();
  expect(resolveCollapseState('panel:new')).toBe(true);
  expect(resolveCollapseState('grid:main',{fallback:false,primary:true})).toBe(false);
  setDefaultCollapseState('open');
  expect(resolveCollapseState('panel:new-open')).toBe(false);
  setDefaultCollapseState('last');
  expect(resolveCollapseState('panel:last',{fallback:false})).toBe(false);
  setDefaultCollapseState('pinned');
  expect(resolveCollapseState('panel:pinned',{fallback:true})).toBe(true);
 });
 test('طي الأقسام: الحالات الحالية مستقلة ولا تغلق الأقسام الشقيقة',()=>{
  _resetCollapseStateForTests();
  saveCollapseState('page:one',false);
  saveCollapseState('page:two',true);
  expect(resolveCollapseState('page:one')).toBe(false);
  expect(resolveCollapseState('page:two')).toBe(true);
  setDefaultCollapseState('collapsed');
  expect(resolveCollapseState('page:one')).toBe(false);
  expect(resolveCollapseState('page:two')).toBe(true);
 });
 test('طي الأقسام: الحالة المثبتة تتغلب على تغيير الافتراضي ويمكن فكها',()=>{
  _resetCollapseStateForTests();
  saveCollapseState('page:pinned',false);
  toggleCollapsePin('page:pinned',false);
  expect(isCollapsePinned('page:pinned')).toBe(true);
  setDefaultCollapseState('collapsed');
  expect(resolveCollapseState('page:pinned')).toBe(false);
  toggleCollapsePin('page:pinned',false);
  expect(isCollapsePinned('page:pinned')).toBe(false);
  expect(resolveCollapseState('page:pinned')).toBe(false);
 });
 test('طي الأقسام: وضع تثبيت حالتي يثبت التغيير التالي تلقائيًا',()=>{
  _resetCollapseStateForTests();
  setDefaultCollapseState('pinned');
  saveCollapseState('page:auto-pin',false);
  expect(isCollapsePinned('page:auto-pin')).toBe(true);
  expect(getCollapseRecord('page:auto-pin').pinnedCollapsed).toBe(false);
  toggleCollapsePin('page:auto-pin',false);
  expect(isCollapsePinned('page:auto-pin')).toBe(false);
  saveCollapseState('page:auto-pin',true);
  expect(isCollapsePinned('page:auto-pin')).toBe(false);
  expect(getCollapseRecord('page:auto-pin').currentCollapsed).toBe(true);
 });
 test('طي الأقسام: الإعداد الصريح وعرض البيانات الرئيسة يعلوان الافتراضي المطوي',()=>{
  _resetCollapseStateForTests();
  expect(resolveCollapseState('grid:main',{fallback:false,primary:true})).toBe(false);
  expect(resolveCollapseState('panel:configured',{fallback:false,configured:true})).toBe(false);
  expect(resolveCollapseState('panel:generic',{fallback:false})).toBe(true);
 });
 test('طي الأقسام: استعادة عنصر واحد أو الكل تحترم الوضع الافتراضي',()=>{
  _resetCollapseStateForTests();
  saveCollapseState('one',false);saveCollapseState('two',false);
  clearCollapseState('one');
  expect(resolveCollapseState('one')).toBe(true);
  expect(resolveCollapseState('two')).toBe(false);
  setDefaultCollapseState('open');resetCollapseStates();
  expect(resolveCollapseState('two')).toBe(false);
  expect(getCollapseRecord('two')).toBe(null);
 });
 test('طي الأقسام: عنوان اللوحة وزر الدبوس يعملان والطي الجماعي المؤقت لا يحفظ',()=>{
  _resetCollapseStateForTests();
  const root=document.createElement('div');
  root.innerHTML='<section class="panel" data-collapse-id="one"><div class="panel-head"><h3>لوحة أولى</h3><span class="badge">8 عناصر</span></div><p>المحتوى الأول</p></section>'+
   '<section class="panel" data-collapse-id="two"><div class="panel-head"><h3>لوحة ثانية</h3></div><p>المحتوى الثاني</p></section>';
  document.body.append(root);
  enhanceCollapsiblePanels(root,'test-panels',{bulk:false});
  const first=root.querySelector('[data-collapse-id="one"]');
  expect(first.dataset.collapseCollapsed).toBe('true');
  expect(first.querySelector('.panel-collapse-head .badge').textContent).toBe('8 عناصر');
  first.querySelector('.collapse-toggle').click();
  expect(first.dataset.collapseCollapsed).toBe('false');
  first.querySelector('.collapse-pin').click();
  expect(isCollapsePinned(first.dataset.collapseKey)).toBe(true);
  const second=root.querySelector('[data-collapse-id="two"]');
  second.dispatchEvent(new CustomEvent('collapse:bulk',{detail:{collapsed:false,persist:false}}));
  expect(second.dataset.collapseCollapsed).toBe('false');
  expect(getCollapseRecord(second.dataset.collapseKey)).toBe(null);
  expect(localStorage.getItem(`akl:prefs:${COLLAPSE_PREF_KEY}`)!==null).toBe(true);
  root.remove();
 });
 test('طي الأقسام: أدوات فتح وطي الكل تظهر عند وجود عنصرين مستقلين فأكثر',()=>{
  _resetCollapseStateForTests();
  const root=document.createElement('div');
  root.innerHTML=Array.from({length:2},(_,i)=>`<section class="panel" data-collapse-id="bulk-${i}"><div class="panel-head"><h3>لوحة ${i+1}</h3></div><p>محتوى</p></section>`).join('');
  document.body.append(root);enhanceCollapsiblePanels(root,'bulk-test');
  const control=root.querySelector('.collapse-page-tools');
  expect(Boolean(control)).toBe(true);
  expect(control.querySelector('.collapse-page-count').textContent).toBe('2 عناصر');
  control.querySelector('[data-collapse-bulk="open"]').click();
  expect([...root.querySelectorAll('.panel')].every(panel=>panel.dataset.collapseCollapsed==='false')).toBe(true);
  expect([...root.querySelectorAll('.panel')].every(panel=>getCollapseRecord(panel.dataset.collapseKey)===null)).toBe(true);
  const save=control.querySelector('[data-collapse-bulk-save]');save.click();
  control.open=true;control.querySelector('[data-collapse-bulk="closed"]').click();
  expect([...root.querySelectorAll('.panel')].every(panel=>panel.dataset.collapseCollapsed==='true')).toBe(true);
  expect([...root.querySelectorAll('.panel')].every(panel=>getCollapseRecord(panel.dataset.collapseKey)?.currentCollapsed===true)).toBe(true);
  root.remove();
 });
 test('طي الأقسام: الأقسام الأصلية Details تحمل منطقة وصول وتبقى مستقلة عن زر التثبيت',()=>{
  _resetCollapseStateForTests();
  const root=document.createElement('div');
  root.innerHTML='<details class="rec-section" data-sec="hearings" open><summary><span>الجلسات</span><span class="count">3</span></summary><div class="sec-body">محتوى الجلسات</div></details>';
  document.body.append(root);enhanceCollapsiblePanels(root,'record:test',{bulk:false});
  const details=root.querySelector('details');const summary=details.querySelector('summary');const pin=summary.querySelector('.collapse-pin');
  expect(Boolean(details.open)).toBe(false);
  expect(summary.getAttribute('aria-expanded')).toBe('false');
  expect(details.querySelector('.details-collapse-body').getAttribute('role')).toBe('region');
  pin.click();
  expect(Boolean(details.open)).toBe(false);
  expect(isCollapsePinned(details.dataset.collapseKey)).toBe(true);
  root.remove();
 });
 test('البطاقات: العنوان يبدّل الحالة، والإجراءات والتثبيت مستقلان، والحالة تعود بعد إعادة التركيب',()=>{
  _resetCollapseStateForTests();
  const persistKey=`collapse-card-${Date.now()}`;
  const root=document.createElement('div');root.innerHTML=card({title:'بطاقة اختبار',persistKey,body:'<p>بيانات مهمة</p>',actions:'<button type="button" data-card-action>إجراء مستقل</button>'});document.body.append(root);bindCards(root);
  let cardEl=root.querySelector('.ux-card');
  expect(cardEl.classList.contains('is-collapsed')).toBe(true);
  cardEl.querySelector('h3').click();
  expect(cardEl.classList.contains('is-collapsed')).toBe(false);
  cardEl.querySelector('[data-card-action]').click();
  expect(cardEl.classList.contains('is-collapsed')).toBe(false);
  cardEl.querySelector('.ux-card-pin').click();
  expect(isCollapsePinned(cardEl.dataset.collapseKey)).toBe(true);
  cardEl.dispatchEvent(new CustomEvent('collapse:bulk',{detail:{collapsed:true,persist:false}}));
  expect(cardEl.classList.contains('is-collapsed')).toBe(true);
  expect(getCollapseRecord(cardEl.dataset.collapseKey).pinnedCollapsed).toBe(false);
  root.remove();
  const reopened=document.createElement('div');reopened.innerHTML=card({title:'بطاقة اختبار',persistKey,body:'<p>بيانات مهمة</p>'});document.body.append(reopened);bindCards(reopened);
  expect(reopened.querySelector('.ux-card').classList.contains('is-collapsed')).toBe(false);
  reopened.remove();
 });
 test('مسار قبول من 20 خطوة: تنقل وافتراضيات وتثبيت وطي جماعي واستعادة',()=>{
  _resetCollapseStateForTests();
  setDefaultCollapseState('collapsed');
  const render=scope=>{const root=document.createElement('div');root.innerHTML=['one','two','three'].map(id=>`<section class="panel" data-collapse-id="${id}"><div class="panel-head"><h3>${id}</h3></div><p>${id} content</p></section>`).join('');document.body.append(root);enhanceCollapsiblePanels(root,scope,{bulk:false});return root};
  let page=render('flow:file:alpha');
  const one=page.querySelector('[data-collapse-id="one"]'),two=page.querySelector('[data-collapse-id="two"]');
  expect(one.dataset.collapseCollapsed).toBe('true');                                      // 1: default collapsed
  one.querySelector('.collapse-toggle').click();                                             // 2: open one
  expect(one.dataset.collapseCollapsed).toBe('false');                                      // 3: current state
  expect(two.dataset.collapseCollapsed).toBe('true');                                       // 4: sibling independent
  one.querySelector('.collapse-pin').click();                                                // 5: pin open
  const oneKey=one.dataset.collapseKey;
  page.remove();
  page=render('flow:reports');                                                              // 6: navigate away
  expect(page.querySelector('[data-collapse-id="one"]').dataset.collapseCollapsed).toBe('true'); // 7: separate page scope
  page.remove();
  setDefaultCollapseState('open');                                                          // 8: change default
  page=render('flow:file:alpha');                                                           // 9: return to file
  expect(page.querySelector('[data-collapse-id="one"]').dataset.collapseCollapsed).toBe('false'); // 10: pin wins
  expect(page.querySelector('[data-collapse-id="two"]').dataset.collapseCollapsed).toBe('false'); // 11: unchosen item follows new default
  page.querySelector('[data-collapse-id="three"]')?.dispatchEvent(new CustomEvent('collapse:bulk',{detail:{collapsed:true,persist:false}})); // 12: temporary close
  const three=page.querySelector('[data-collapse-id="three"]'),threeKey=three.dataset.collapseKey;
  expect(getCollapseRecord(threeKey)).toBe(null);                                           // 13: no preference written
  page.remove();
  page=render('flow:file:alpha');
  expect(page.querySelector('[data-collapse-id="one"]').dataset.collapseCollapsed).toBe('false'); // 14: pinned state survives remount
  expect(page.querySelector('[data-collapse-id="three"]').dataset.collapseCollapsed).toBe('false'); // 15: temporary bulk state does not survive
  const all=[...page.querySelectorAll('[data-collapse-ready="true"]')];
  all.forEach(item=>item.dispatchEvent(new CustomEvent('collapse:bulk',{detail:{collapsed:true,persist:false}}))); // 16: collapse all temporarily
  expect(all.every(item=>item.dataset.collapseCollapsed==='true')).toBe(true);              // 17: visible bulk action
  expect(getCollapseRecord(oneKey).pinnedCollapsed).toBe(false);                           // 18: pin not overwritten
  page.remove();page=render('flow:file:alpha');
  expect(page.querySelector('[data-collapse-id="one"]').dataset.collapseCollapsed).toBe('false'); // 19: reopen restores pin
  const target=page.querySelector('[data-collapse-id="one"]');
  target.dispatchEvent(new CustomEvent('collapse:bulk',{detail:{collapsed:true,persist:true}}));
  expect(getCollapseRecord(oneKey).pinnedCollapsed).toBe(true);                            // 20: explicit saved bulk updates pin
  page.remove();resetCollapseStates();
  expect(getCollapseRecord(oneKey)).toBe(null);
  expect(resolveCollapseState(oneKey,{fallback:true})).toBe(false);
 });
 test('طي الأقسام: عناصر DataGrid القديمة لا تستعيد حالتها بعد الاستعادة العامة',async()=>{
  await prefs.set(COLLAPSE_PREF_KEY,{version:1,defaultState:'last',legacyDisabled:false,items:{}});
  const storageKey=`collapse-reset-grid-${Date.now()}`,collapseKey=`test:reset-grid:${storageKey}`;
  await prefs.set(`grid:${storageKey}`,{filterCollapsed:false,toolsCollapsed:false,shellCollapsed:true});
  let root=document.createElement('div');document.body.append(root);
  mountGrid(root,{title:'جدول قديم',storageKey,collapseKey,rows:[],columns:[{key:'name',label:'البيان'}]});
  expect(root.querySelector('.dg-tools-panel').hidden).toBe(false);
  expect(root.classList.contains('dg-shell-closed')).toBe(true);
  root.remove();resetCollapseStates();
  root=document.createElement('div');document.body.append(root);
  mountGrid(root,{title:'جدول قديم',storageKey,collapseKey,rows:[],columns:[{key:'name',label:'البيان'}]});
  expect(root.querySelector('.dg-tools-panel').hidden).toBe(true);
  expect(root.querySelector('.dg-filter-toggle').getAttribute('aria-expanded')).toBe('false');
  expect(root.classList.contains('dg-shell-closed')).toBe(false);
  root.remove();
 });
 test('شبكة البيانات: الأدوات والفلاتر تبدأ مطوية، وتبقى الحالة والبحث بعد إعادة التركيب',async()=>{
  _resetCollapseStateForTests();
  const storageKey=`collapse-grid-${Date.now()}`,collapseKey=`test:grid:${storageKey}`;
  await prefs.set(`grid:${storageKey}`,{views:[{name:'عرض محفوظ'}],activeView:'عرض محفوظ'});
  let root=document.createElement('div');document.body.append(root);
  let grid=mountGrid(root,{title:'جلسات الاختبار',storageKey,collapseKey,rows:[{id:'1',name:'جلسة أولى'},{id:'2',name:'جلسة ثانية'}],columns:[{key:'name',label:'البيان'}]});
  const toolsKey=`datagrid:${collapseKey}:tools`,filterKey=`datagrid:${collapseKey}:filters`,shellKey=`datagrid:${collapseKey}:section`;
  expect(root.querySelector('.dg-tools-panel').hidden).toBe(true);
  expect(root.querySelector('.dg-tools-active').textContent.includes('لا توجد فلاتر نشطة')).toBe(true);
  expect(root.querySelector('.dg-tools-view').textContent.includes('عرض محفوظ')).toBe(true);
  expect(root.classList.contains('dg-shell-closed')).toBe(false);
  root.querySelector('.dg-tools-summary-toggle').click();
  const quick=root.querySelector('.dg-quick');quick.value='أولى';quick.dispatchEvent(new Event('input',{bubbles:true}));
  await new Promise(resolve=>setTimeout(resolve,160));
  expect(grid.getView().length).toBe(1);
  expect(root.querySelector('.dg-tools-active').textContent.includes('فلاتر نشطة')).toBe(true);
  root.querySelector('.dg-filter-toggle').click();
  expect(root.querySelector('.dg-filter-toggle').getAttribute('aria-expanded')).toBe('true');
  root.querySelector('.dg-tools-pin').click();
  expect(isCollapsePinned(toolsKey)).toBe(true);
  const rowBeforeCollapse=root.querySelector('tbody tr[data-i]');
  root.querySelector('.dg-shell-toggle').click();
  expect(root.querySelector('tbody tr[data-i]')===rowBeforeCollapse).toBe(true);
  expect(root.classList.contains('dg-shell-closed')).toBe(true);
  expect(root.querySelector('.dg-shell-count').textContent.includes('نتيجة')).toBe(true);
  root.remove();
  root=document.createElement('div');document.body.append(root);
  grid=mountGrid(root,{title:'جلسات الاختبار',storageKey,collapseKey,rows:[{id:'1',name:'جلسة أولى'},{id:'2',name:'جلسة ثانية'}],columns:[{key:'name',label:'البيان'}]});
  expect(root.querySelector('.dg-tools-panel').hidden).toBe(false);
  expect(root.querySelector('.dg-quick').value).toBe('أولى');
  expect(root.querySelector('.dg-tools-view').textContent.includes('عرض محفوظ')).toBe(true);
  expect(prefs.get(`grid:${storageKey}`).activeView).toBe('عرض محفوظ');
  expect(root.querySelector('.dg-filter-toggle').getAttribute('aria-expanded')).toBe('true');
  expect(root.classList.contains('dg-shell-closed')).toBe(true);
  const before=getCollapseRecord(toolsKey);
  root.dispatchEvent(new CustomEvent('collapse:bulk',{detail:{collapsed:true,persist:false,target:'all'}}));
  expect(root.querySelector('.dg-tools-panel').hidden).toBe(true);
  expect(getCollapseRecord(toolsKey).currentCollapsed).toBe(before.currentCollapsed);
  expect(getCollapseRecord(toolsKey).pinnedCollapsed).toBe(before.pinnedCollapsed);
  expect(grid.getView().length).toBe(1);
  root.dispatchEvent(new CustomEvent('collapse:bulk',{detail:{collapsed:false,persist:true,target:'all'}}));
  expect(root.querySelector('.dg-tools-panel').hidden).toBe(false);
  expect(getCollapseRecord(toolsKey).pinnedCollapsed).toBe(false);
  expect(getCollapseRecord(filterKey).currentCollapsed).toBe(false);
  expect(getCollapseRecord(shellKey).currentCollapsed).toBe(false);
  root.remove();
 });
}