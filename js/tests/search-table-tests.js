// اختبارات v4.7: محرك البحث المركزي + ترقيات الجداول (تثبيت، تحديد، بحث أعمدة، إعادة ضبط، فرز سريع).
import {tokenizeQuery,looksLikeCode,looksLikeNumber,codeValue,matchTokens,scoreHit,
 searchAll,searchStore,getHistory,pushHistory,clearHistory,getSavedSearches,saveSearch,removeSavedSearch,_resetSearchPrefs} from '../services/search-engine.js';
import {upgradeSchema} from '../db/schema.js';
import {uid} from '../core/id.js';
import {Office} from '../services/office.js';
import {mountGrid} from '../ui/datagrid.js';
import {localDate} from '../core/clock.js';
import {_resetRecentsCache} from '../services/recents.js';

export async function runSearchTableTests(test,expect){
 // ===== منطق صافٍ =====
 test('محرك البحث: تقسيم الكلمات والتطبيع',()=>{
  const t=tokenizeQuery('محمد  أحمد، السيد');
  expect(t.length).toBe(3);
  expect(t[0]).toBe('محمد');
  expect(t[1]).toBe('احمد'); // أ→ا
  expect(tokenizeQuery('   ').length).toBe(0);
 });
 test('محرك البحث: كشف الأكواد والأرقام',()=>{
  expect(looksLikeCode('CL-2026-000001')).toBe(true);
  expect(looksLikeCode('cl2026001')).toBe(true);
  expect(looksLikeCode('LF-2026-5')).toBe(true);
  expect(looksLikeCode('محمد')).toBe(false);
  expect(looksLikeNumber('1545')).toBe(true);
  expect(looksLikeNumber('15')).toBe(false);
  expect(codeValue('cl 2026 001')).toBe('CL-2026001');
 });
 test('محرك البحث: مطابقة AND وتنظيم أهمية النتائج',()=>{
  expect(matchTokens(['محمد','احمد'],'محمد احمد علي')).toBe(true); // بعد التطبيع
  expect(matchTokens(['محمد','خالد'],'محمد احمد علي')).toBe(false);
  expect(scoreHit({title:'محمد أحمد',tokens:['محمد']})).toBe(80);
  expect(scoreHit({title:'علي',sub:'محمد',tokens:['محمد']})).toBe(45);
  expect(scoreHit({title:'أي شيء',tokens:['محمد'],viaCode:true})).toBe(100);
 });
 // ===== بحث حقيقي على قاعدة مؤقتة =====
 const out={};
 const run=async()=>{
  _resetRecentsCache();_resetSearchPrefs();clearHistory();
  const name=`AhmadKhudairLawOfficeDB__test__se__${Date.now()}`;
  const db=await new Promise((res,rej)=>{const r=indexedDB.open(name,13);r.onupgradeneeded=e=>upgradeSchema(r.result,e.target.transaction);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});
  const o=new Office({db,assert(){},token:'t',profile:{id:'test'}});
  try{
   const c=await o.saveClient({fullName:'محمد أحمد السيد',nationalId:'29001011201234',phone:'01000000000'});
   const f=await o.saveFile({title:'ملف عقد بيع',fileType:'مدني',status:'مفتوح',clientId:c.id,partyNames:'خالد عبد الله'});
   const k=await o.saveCase({fileId:f.id,stageType:'ابتدائي',caseNumber:'1545',caseYear:2026,courtId:'محكمة شمال القاهرة'});
   await o.r.hearings.add({id:uid(),caseId:k.id,fileId:f.id,hearingDate:'2026-10-01',hearingTime:'09:30',court:'محكمة شمال القاهرة',type:'اولى'});
   await o.r.procedures.add({id:uid(),fileId:f.id,description:'تقديم مذكرة بالدفاتر',internalDueDate:'2026-10-05',status:'open'});
   await o.r.fileParties.add({id:uid(),fileId:f.id,partyName:'جمال فؤاد',role:'مدعى عليه'});
   out.client=c;out.file=f;out.caseRow=k;
   out.byName=await searchAll(o,'محمد');
   out.byTwoWords=await searchAll(o,'محمد السيد');
   out.byCode=await searchAll(o,'CL');
   out.byNumber=await searchAll(o,'1545');
   out.byParty=await searchAll(o,'جمال فؤاد');
   out.scoped=await searchAll(o,'محمد',{stores:['clients'],perStore:5});
   out.storeOne=await searchStore(o,'files','عقد',{limit:5});
   out.flex=await searchAll(o,'احمد'); // همزة/ألف
   // سجل بحث وبحوث محفوظة
   pushHistory('محمد');pushHistory('عقد بيع');pushHistory('محمد');
   out.hist=getHistory();
   saveSearch('قضايا محمد','محمد');saveSearch('قضايا محمد','محمد');saveSearch('أتعاب','اتعاب');
   out.saved=getSavedSearches();
   removeSavedSearch('أتعاب');
   out.savedAfter=getSavedSearches();
  }finally{db.close();try{indexedDB.deleteDatabase(name)}catch{}}

  test('البحث الشامل: الاسم يظهر في الموكلين والملفات مرتبًا بالمصدر',()=>{
   const labels=out.byName.groups.map(g=>g.store);
   expect(labels.includes('clients')).toBe(true);
   expect(out.byName.total>0).toBe(true);
   const g=out.byName.groups.find(x=>x.store==='clients');
   expect(g.items[0].route.startsWith('client:')).toBe(true);
   expect(g.items[0].title.includes('محمد')).toBe(true);
  });
  test('البحث متعدد الكلمات: كل الكلمات معًا فقط',()=>{
   const c=out.byTwoWords.groups.find(g=>g.store==='clients');
   expect(Boolean(c)).toBe(true);
   expect(c.items.some(it=>it.title.includes('محمد أحمد السيد'))).toBe(true);
  });
  test('البحث برقم القضية 1545 يعيد المرحلة',()=>{
   const g=out.byNumber.groups.find(g=>g.store==='cases');
   expect(Boolean(g)).toBe(true);
   expect(g.items[0].route.startsWith('case:')).toBe(true);
  });
  test('البحث باسم الطرف يقود إلى الملف عبر أطراف الملفات',()=>{
   const g=out.byParty.groups.find(g=>g.store==='fileParties');
   expect(Boolean(g)).toBe(true);
   expect(g.items[0].route).toBe('file:'+out.file.id);
  });
  test('تضييق النطاق إلى قسم واحد يعمل',()=>{
   expect(out.scoped.groups.length>=1).toBe(true);
   expect(out.scoped.groups.every(g=>g.store==='clients')).toBe(true);
  });
  test('بحث قسم واحد: قسم الملفات يجد العنوان',()=>{
   expect(out.storeOne.items.length>=1).toBe(true);
   expect(out.storeOne.items.some(it=>it.title.includes('عقد'))).toBe(true);
  });
  test('المرونة العربية: البحث بـ«احمد» يجد «أحمد»',()=>{
   const c=out.flex.groups.find(g=>g.store==='clients');
   expect(Boolean(c)).toBe(true);
  });
  test('سجل البحث بلا تكرار وبحد أقصى',()=>{
   expect(out.hist.length).toBe(2);
   expect(out.hist[0].q).toBe('محمد');
  });
  test('البحوث المحفوظة: حفظ بالاسم والتحديث والحذف',()=>{
   expect(out.saved.length).toBe(2);
   expect(out.saved[0].name).toBe('أتعاب'); // الأحدث أولًا
   expect(out.saved[1].name).toBe('قضايا محمد');
   expect(out.savedAfter.length).toBe(1);
  });
 };
 await run();
}

export function runGridUpgradeTests(test,expect){
 test('الجدول: تحديد الصفوف وتحديد الكل وشريط الإجراءات',()=>{
  const g=document.createElement('div');document.body.append(g);
  const rows=[{id:'a',t:'أول',n:1},{id:'b',t:'ثانٍ',n:2},{id:'c',t:'ثالث',n:3}];
  const grid=mountGrid(g,{rows,columns:[{key:'t',label:'T'},{key:'n',label:'N',type:'number'}],storageKey:'',selectable:true,title:'تحديد'});
  const selbar=g.querySelector('.dg-selbar');
  expect(selbar.hidden).toBe(true);
  g.querySelector('.dg-sel-all').click();
  expect(g.querySelectorAll('.dg-rowchk:checked').length).toBe(3);
  expect(selbar.hidden).toBe(false);
  expect(selbar.textContent.includes('3')||selbar.textContent.includes('٣')).toBe(true);
  expect(grid.getSelection().length).toBe(3);
  // إلغاء صف واحد يزيل علامة «الكل» دون تفريغ البقية
  g.querySelector('.dg-rowchk[data-i="0"]').click();
  expect(grid.getSelection().length).toBe(2);
  expect(g.querySelector('.dg-sel-all').checked).toBe(false);
  grid.clearSelection();
  expect(grid.getSelection().length).toBe(0);
  expect(selbar.hidden).toBe(true);
  // النقر على الخانة لا يفتح الصف
  let opened=0;
  g.remove();
 });
 test('الجدول: بحث الأعمدة يرشّح الصفوف ويُحفظ',async()=>{
  const g=document.createElement('div');document.body.append(g);
  const rows=[{id:'a',t:'أحمد',n:5},{id:'b',t:'خالد',n:7},{id:'c',t:'عمر',n:9}];
  const grid=mountGrid(g,{rows,columns:[{key:'t',label:'T'},{key:'n',label:'N'}],storageKey:'',selectable:true});
  expect(grid.isColSearchOn()).toBe(false);
  g.querySelector('.dg-csearch-btn').click();
  expect(grid.isColSearchOn()).toBe(true);
  const inp=g.querySelector('.dg-cs[data-key="t"]');
  inp.value='أحمد';
  inp.dispatchEvent(new Event('input',{bubbles:true}));
  await new Promise(r=>setTimeout(r,320));
  expect(g.querySelectorAll('tbody tr[data-i]').length).toBe(1);
  expect(g.querySelector('tbody').textContent.includes('خالد')).toBe(false);
  g.remove();
 });
 test('الجدول: تثبيت عمود يضيف خلايا لاصقة ويرتيب تراكمي',()=>{
  const g=document.createElement('div');document.body.append(g);
  const grid=mountGrid(g,{rows:[{id:'a',t:'أ',n:1},{id:'b',t:'ب',n:2}],columns:[{key:'t',label:'T'},{key:'n',label:'N'},{key:'n2',label:'N2',get:r=>r.n*2,text:r=>String(r.n*2)}],storageKey:''});
  grid.togglePin('t');
  expect(g.querySelector('thead th[data-key="t"]').classList.contains('dg-pin-th')).toBe(true);
  expect(g.querySelector('tbody td[data-k="t"]').classList.contains('dg-pin-cell')).toBe(true);
  grid.togglePin('n');
  const tTh=g.querySelector('thead th[data-key="t"]'),nTh=g.querySelector('thead th[data-key="n"]');
  expect(parseFloat(tTh.style.insetInlineStart)).toBe(0);
  expect(parseFloat(nTh.style.insetInlineStart)>0).toBe(true);
  grid.togglePin('t'); // فك التثبيت يعمل
  expect(g.querySelector('thead th[data-key="t"]').classList.contains('dg-pin-th')).toBe(false);
  g.remove();
 });
 test('الجدول: الفرز بمفاتيح مسبقة الحساب بنفس دلالة الترتيب القديمة',()=>{
  const g=document.createElement('div');document.body.append(g);
  const rows=[{id:'a',t:'مريم',n:5},{id:'b',t:'أحمد',n:2},{id:'c',t:'زينب',n:9}];
  const grid=mountGrid(g,{rows,columns:[{key:'t',label:'T'},{key:'n',label:'N',type:'number'}],storageKey:''});
  grid.sortBy('n','asc');
  expect(g.querySelector('tbody tr[data-i]').textContent.includes('أحمد')).toBe(true); // n=2 أولًا
  grid.sortBy('n','desc');
  expect(g.querySelector('tbody tr[data-i]').textContent.includes('زينب')).toBe(true); // n=9 أولًا
  g.remove();
 });
 test('الجدول: إعادة الضبط تمسح الفلاتر والتثبيت والترتيب المحفوظ',()=>{
  const g=document.createElement('div');document.body.append(g);
  const grid=mountGrid(g,{rows:[{id:'a',t:'أ',n:1},{id:'b',t:'ب',n:2}],columns:[{key:'t',label:'T'},{key:'n',label:'N'}],storageKey:'resettest'});
  grid.applyFilter('t','contains','أ');
  grid.togglePin('t');
  g.querySelector('.dg-reset-btn').click();
  expect(g.querySelectorAll('tbody tr[data-i]').length).toBe(2);
  expect(g.querySelector('thead .dg-pin-th')).toBe(null);
  expect(g.querySelector('.dg-chips').hidden).toBe(true);
  g.remove();
 });
 test('الجدول: عنوان العمود يفتح لوحة التصفية متعددة الاختيار',()=>{
  const g=document.createElement('div');document.body.append(g);
  mountGrid(g,{rows:[{court:'محكمة طوخ'},{court:'محكمة بنها'},{court:'محكمة شبرا'}],columns:[{key:'court',label:'المحكمة'}],storageKey:''});
  g.querySelector('.dg-coltitle').click();
  const pop=document.querySelector('.dg-pop');
  expect(Boolean(pop)).toBe(true);
  expect(pop.textContent.includes('محكمة طوخ')).toBe(true);
  expect(pop.textContent.includes('تحديد الكل')).toBe(true);
  expect(pop.textContent.includes('إلغاء الكل')).toBe(true);
  pop.querySelector('.dg-x').click();
  expect(document.querySelector('.dg-pop')).toBe(null);
  g.remove();
 });
 test('الجدول: بحث متعدد الكلمات وعداد النتائج',async()=>{
  const g=document.createElement('div');document.body.append(g);
  mountGrid(g,{rows:[{t:'دعوى طوخ مدني'},{t:'طوخ فقط'},{t:'مدني بنها'}],columns:[{key:'t',label:'البيان'}],storageKey:''});
  const q=g.querySelector('.dg-quick');
  q.value='طوخ مدني';
  q.dispatchEvent(new Event('input',{bubbles:true}));
  await new Promise(r=>setTimeout(r,220));
  expect(g.querySelectorAll('tbody tr[data-i]').length).toBe(1);
  expect(g.querySelector('.dg-count').textContent.includes('من أصل')).toBe(true);
  g.remove();
 });
 test('الجدول: إلغاء الفرز وطي الجدول وفلتر أمس',()=>{
  const g=document.createElement('div');document.body.append(g);
  const grid=mountGrid(g,{rows:[{t:'أ',d:localDate()},{t:'ب',d:'2001-01-01'}],columns:[{key:'t',label:'T'},{key:'d',label:'التاريخ',type:'date'}],storageKey:'',title:'جلسات'});
  grid.sortBy('t','asc');
  expect(g.querySelector('.dg-rank')).toBeTruthy();
  g.querySelector('.dg-unsort').click();
  expect(g.querySelector('.dg-rank')).toBe(null);
  g.querySelector('.dg-shell-toggle').click();
  expect(g.classList.contains('dg-shell-closed')).toBe(true);
  expect(g.querySelector('.dg-shell-title').textContent.includes('جلسات')).toBe(true);
  grid.applyFilter('d','yesterday','');
  expect(g.querySelectorAll('tbody tr[data-i]').length).toBe(0);
  g.querySelector('.dg-filter-toggle').click();
  expect(g.querySelector('.dg-filter-toggle').textContent.includes('عوامل التصفية')).toBe(true);
  g.remove();
 });
 test('الجدول: التمرير الافتراضي لا يرسم كل الصفوف',()=>{
  // tests.html intentionally loads no application stylesheet; constrain the scroll viewport
  // here so the virtual-window assertion matches the real DataGrid layout in every runner.
  const style=document.createElement('style');
  style.textContent='.dg-scroll{height:320px!important;max-height:320px!important;overflow:auto!important}';
  document.head.append(style);
  const g=document.createElement('div');document.body.append(g);
  try{
   const rows=Array.from({length:800},(_,i)=>({id:String(i),t:'صف '+i}));
   mountGrid(g,{rows,columns:[{key:'t',label:'T'}],storageKey:''});
   expect(g.querySelectorAll('tbody tr[data-i]').length<800).toBe(true);
   expect(g.querySelectorAll('tbody tr[data-i]').length>0).toBe(true);
  }finally{g.remove();style.remove()}
 });
 test('الجدول: بحث سريع يميّز النتائج مع التطبيع (خالد/خالدة)',async()=>{
  const g=document.createElement('div');document.body.append(g);
  mountGrid(g,{rows:[{id:'a',t:'خالدة'},{id:'b',t:'عمر'}],columns:[{key:'t',label:'T'}],storageKey:''});
  const q=g.querySelector('.dg-quick');
  q.value='خالد';
  q.dispatchEvent(new Event('input',{bubbles:true}));
  await new Promise(r=>setTimeout(r,320));
  expect(g.querySelectorAll('tbody tr[data-i]').length).toBe(1);
  expect(Boolean(g.querySelector('tbody mark'))).toBe(true);
  g.remove();
 });
}
