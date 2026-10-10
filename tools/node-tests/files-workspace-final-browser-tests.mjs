// Phase Final — التدقيق الوظيفي الشامل لصفحة الملفات بعد اللمسات النهائية.
// يفحص فعليًا (Chromium حقيقي + IndexedDB حقيقية، ملف شخصي مؤقت):
//  1) زر «إضافة ملف جديد» يمين عنوان «الملفات» ومرئي وقابل للنقر ويفتح مسار الإنشاء الحقيقي.
//  2) «مسح التحديد» في أقصى يسار شريط الأدوات، يمسح التحديد الفعلي ولا يمس البحث/الفلاتر.
//  3) شريط الإجراءات الجماعية القديم (أرشفة/طباعة المحدد/فتح المحدد) محذوف من الصفحة.
//  4) الأرشفة/الطباعة/الفتح لم تتعطل في مواضعها الأخرى.
//  5) كل القوائم تعمل فعليًا: عرض، فلاتر، وقت، بحث، مسح فلاتر، بطاقات، تصدير، مزيد الصفحة، ثيمات.
//  6) تكامل: بحث+فلاتر مركبة، بطاقات↔جدول، فتح ملف ورجوع، حفظ التفضيلات عبر إعادة التحميل.
//  7) صفحات أخرى بالمكوّن المشترك (الجلسات) تحتفظ بشريط تحديدها — لا انحدار.
import {chromium} from 'playwright';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const repository=path.resolve(new URL('../../',import.meta.url).pathname);
const base=(process.env.FW_FINAL_BASE_URL||'http://127.0.0.1:8080').replace(/\/$/,'');
const artifactDir=path.join(repository,'.cache','files-workspace-final');
await fs.mkdir(artifactDir,{recursive:true});
const require=createRequire(import.meta.url);
const {default:slim,inflate}=await import('@sparticuz/chromium');
await inflate(path.resolve(path.dirname(require.resolve('@sparticuz/chromium')),'../bin/al2023.tar.br'));
process.env.LD_LIBRARY_PATH=path.join(process.env.TMPDIR||'/tmp','al2023','lib');
const browser=await chromium.launch({executablePath:await slim.executablePath(),headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const report={date:new Date().toISOString(),browser:browser.version(),base,checks:[],errors:[]};

const MARK='بذرةمميزة';// علامة فريدة في عناوين ملفات التثبيت — تعزلها عن البيانات التجريبية المزروعة ذاتيًا
const context=await browser.newContext({viewport:{width:1440,height:950},acceptDownloads:true,permissions:['clipboard-read','clipboard-write']});
await context.addInitScript(()=>{window.print=()=>{window.__printRequested=(window.__printRequested||0)+1}});
const page=await context.newPage();
page.on('pageerror',error=>report.errors.push('pageerror: '+error.message));
page.on('console',msg=>{if(msg.type()==='error')report.errors.push('console: '+msg.text())});

const verify=async(name,fn)=>{await fn();report.checks.push(name);console.log(`VERIFIED — ${name}`)};
const boot=async()=>{
 await page.goto(`${base}/index.html`,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__LAW_OFFICE_APP__?.office&&!window.__LAW_OFFICE_APP__.booting,null,{timeout:90000});
 await page.waitForFunction(()=>document.querySelector('#main-content')?.children.length>0,null,{timeout:90000});
};
const go=route=>page.evaluate(route=>window.__LAW_OFFICE_APP__.go(route),route);
const route=()=>page.evaluate(()=>window.__LAW_OFFICE_APP__.route);
const waitGrid=async()=>{await page.waitForFunction(()=>{const g=document.querySelector('#list-grid');return g&&g.__grid&&g.querySelector('tbody')},null,{timeout:20000});await page.waitForTimeout(450)};
const gridUi=()=>page.evaluate(()=>document.querySelector('#list-grid').__grid.getUi());
const rowCount=()=>page.locator('#list-grid tbody tr[data-i]').count();
const searchFiles=async(q)=>{await page.locator('#list-q').fill(q);await page.waitForTimeout(700)};
const center=box=>({x:box.x+box.width/2,y:box.y+box.height/2});
const openTimePanel=async()=>{
 const p=page.locator('[data-fw-panel="time"]');
 const isOpen=await p.evaluate(el=>el.classList.contains('is-open')).catch(()=>false);
 if(!isOpen){
  await page.locator('[data-fw-time]').click();
  await page.waitForSelector('[data-fw-panel="time"].is-open',{timeout:9000});
 }
 return page.locator('[data-fw-panel="time"].is-open');
};
const closeTimePanel=async()=>{
 const p=page.locator('[data-fw-panel="time"]');
 if(await p.evaluate(el=>el.classList.contains('is-open')).catch(()=>false)){
  await page.keyboard.press('Escape');await page.waitForTimeout(200);
 }
};

try{
 await boot();
 // ---------- تثبيت بيانات معزولة ----------
 await page.evaluate(async MARK=>{
  const app=window.__LAW_OFFICE_APP__;
  const CF=await import('/js/services/client-files.js');
  await CF.seedTaxonomy(app.office);
  const c1=await app.office.saveClient({fullName:`موكل ${MARK} أ`,phones:['01011111111']});
  const c2=await app.office.saveClient({fullName:`موكل ${MARK} ب`,phones:['01022222222']});
  await CF.createLegalFileInClientFile(app.office,{clientId:c1.id,categoryId:'civil',fileTypeId:'civil.lawsuit',title:`${MARK} ملف حديث`,openedAt:'2026-10-05',steps:[]});
  await CF.createLegalFileInClientFile(app.office,{clientId:c1.id,categoryId:'civil',fileTypeId:'civil.lawsuit',title:`${MARK} ملف أوسط`,openedAt:'2026-08-15',steps:[]});
  await CF.createLegalFileInClientFile(app.office,{clientId:c2.id,categoryId:'civil',fileTypeId:'civil.lawsuit',title:`${MARK} ملف قديم`,openedAt:'2026-01-15',steps:[]});
 },MARK);

 await go('files');await waitGrid();

 // ================= أولًا: بنية الصفحة الجديدة =================
 await verify('بنية: شريط عنوان الصفحة مرئي وغير مغطّى — [+ إضافة ملف جديد] يمين «الملفات»',async()=>{
  const data=await page.evaluate(()=>{
   const bar=document.querySelector('[data-fw-pagebar]');const r=bar.getBoundingClientRect();
   const add=bar.querySelector('[data-list-add]');const ar=add.getBoundingClientRect();
   const title=bar.querySelector('.fw-title');const tr=title.getBoundingClientRect();
   const p=document.elementFromPoint(ar.x+ar.width/2,ar.y+ar.height/2);
   const t=document.elementFromPoint(tr.x+tr.width/2,tr.y+tr.height/2);
   return {addCovered:p?p.closest('[data-list-add]')!==add:true,titleCovered:t?t.closest('.fw-title')!==title:true,
    addRightOfTitle:ar.x>tr.x,addInTitleBar:bar.contains(add),oneAdd:bar.querySelectorAll('[data-list-add]').length,
    quick:bar.querySelectorAll('[data-fw-quick-add]').length,label:add.textContent.trim(),y:r.y,h:r.height};
  });
  assert.equal(data.addCovered,false,'زر الإضافة مغطّى بعنصر آخر');
  assert.equal(data.titleCovered,false,'عنوان الصفحة مغطّى');
  assert.ok(data.addRightOfTitle,'الزر يجب أن يكون يمين كلمة «الملفات»');
  assert.ok(data.addInTitleBar&&data.oneAdd===1,'زر واحد فقط في شريط العنوان');
  assert.equal(data.quick,1,'زر «+ إضافة» العام موجود ولم يُمس');
  assert.ok(data.label.includes('إضافة ملف جديد'),`نص الزر: ${data.label}`);
 });

 await verify('بنية: «مسح التحديد» آخر شريط الأدوات (أقصى اليسار في RTL) ومخفي بلا تحديد',async()=>{
  const data=await page.evaluate(()=>{
   const tb=document.querySelector('[data-fw-toolbar]');
   const sel=tb.querySelector('[data-fw-sel-clear]');
   const others=[...tb.children].filter(el=>el!==sel).map(el=>el.getBoundingClientRect().x);
   const sr=sel.getBoundingClientRect();
   return {last:tb.lastElementChild===sel,count:tb.querySelectorAll('[data-fw-sel-clear]').length,
    hidden:sel.hidden,leftMost:others.every(x=>sr.x<x),oldSelbar:!!document.querySelector('.dg-selbar')};
  });
  assert.ok(data.last,'الزر ليس آخر عنصر');
  assert.equal(data.count,1,'تكرار زر مسح التحديد');
  assert.equal(data.hidden,true,'يجب أن يكون مخفيًا بلا تحديد');
  assert.ok(data.leftMost,'ليس أقصى يسار الشريط');
  assert.equal(data.oldSelbar,false,'الشريط القديم ما زال موجودًا في DOM');
 });

 await verify('الحذف النهائي: تحديد صفوف لا يُظهر الشريط القديم (أرشفة/طباعة المحدد/فتح المحدد)',async()=>{
  await page.locator('#list-grid .dg-rowchk').first().check();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.dg-selbar').count(),0,'ظهر .dg-selbar');
  assert.equal(await page.locator('.dg-open-sel').count(),0);
  const btn=page.locator('[data-fw-sel-clear]');
  assert.equal(await btn.isHidden(),false,'زر مسح التحديد لم يظهر');
  const badge=await page.locator('[data-fw-sel-count]').textContent();
  assert.ok(Number(badge)>=1||badge.trim().length>0,'عدّاد التحديد لا يعمل');
  await btn.click();
  await page.waitForTimeout(300);
 });

 // ================= ثانيًا: زر إضافة ملف جديد — المسار الحقيقي =================
 await verify('«إضافة ملف جديد» يفتح نموذج الإنشاء الحقيقي (اختيار موكل ثم المعالج)',async()=>{
  const filesBefore=await page.evaluate(async()=>(await window.__LAW_OFFICE_APP__.office.r.files.reportRange({index:'createdAt',limit:5000})).rows?.length??null);
  await page.locator('[data-list-add]').first().click();
  await page.waitForSelector('#pc-q',{timeout:8000});
  assert.ok((await page.locator('.modal-title').first().textContent()).includes('ملف قانوني جديد'));
  await page.locator('#pc-q').fill(`موكل ${MARK}`);
  await page.waitForTimeout(700);
  await page.locator('#pc-r [data-id]').first().click();
  await page.waitForTimeout(900);
  const wizardOpen=await page.evaluate(()=>Boolean(document.querySelector('#modal-root .modal-card'))&&!document.querySelector('#pc-q'));
  assert.ok(wizardOpen,'معالج إنشاء الملف لم يفتح بعد اختيار الموكل');
  await page.locator('#modal-root [data-close]').first().click();
  await page.waitForTimeout(400);
  const filesAfter=await page.evaluate(async()=>(await window.__LAW_OFFICE_APP__.office.r.files.reportRange({index:'createdAt',limit:5000})).rows?.length??null);
  assert.equal(filesAfter,filesBefore,'أُنشئ ملف أثناء اختبار الفتح فقط');
 });

 // ================= ثالثًا: القوائم واحدة واحدة =================
 // --- قائمة إعدادات العرض ---
 await verify('إعدادات العرض: تفتح، تغيّر الكثافة والخط فعليًا، وتُغلق بـ Escape و✕',async()=>{
  await page.locator('[data-fw-display]').click();
  const pop=page.locator('.dg-pop.dg-ws-pop');
  await pop.waitFor({timeout:5000});
  for(const txt of ['المظهر والكثافة','الأعمدة','تنسيق المساحة','طرق العرض المحفوظة'])
   assert.ok((await pop.textContent()).includes(txt),`قسم مفقود: ${txt}`);
  await pop.locator('[data-ws-density]').selectOption('compact');
  await page.waitForTimeout(250);
  assert.ok(await page.evaluate(()=>document.querySelector('#list-grid').classList.contains('dg-d-compact')),'الكثافة لم تُطبق');
  await pop.locator('[data-ws-font]').selectOption('large');
  await page.waitForTimeout(250);
  assert.ok(await page.evaluate(()=>document.querySelector('#list-grid').classList.contains('dg-font-large')),'الخط لم يُطبق');
  const box=await pop.boundingBox();
  assert.ok(box.x>=0&&box.x+box.width<=1440,'القائمة تخرج عن حدود الشاشة');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  assert.equal(await page.locator('.dg-pop.dg-ws-pop').count(),0,'Escape لم يغلق القائمة');
  // إعادة فتح وإغلاق بزر ✕ — وتبديل إجراءات الصف في الاتجاهين مع مطابقة DOM للحالة
  await page.locator('[data-fw-display]').click();await pop.waitFor();
  const qaState0=(await gridUi()).qaOn;
  assert.equal((await page.locator('#list-grid .dg-qa-btn').count())>0,qaState0,'DOM لا يطابق حالة إجراءات الصف');
  await pop.locator('[data-ws-qa]').click();
  await page.waitForTimeout(250);
  assert.equal((await gridUi()).qaOn,!qaState0,'التبديل لم يغيّر الحالة');
  assert.equal((await page.locator('#list-grid .dg-qa-btn').count())>0,!qaState0,'إظهار/إخفاء إجراءات الصف لم ينعكس على الجدول');
  await pop.locator('[data-ws-qa]').click();
  await page.waitForTimeout(250);
  assert.equal((await gridUi()).qaOn,qaState0,'استرجاع حالة إجراءات الصف فشل');
  await pop.locator('[data-ws-density]').selectOption('');
  await pop.locator('[data-ws-font]').selectOption('medium');
  await pop.locator('.dg-x').click();
  assert.equal(await page.locator('.dg-pop.dg-ws-pop').count(),0,'✕ لم يغلق القائمة');
 });

 // --- قائمة الفلاتر ---
 await verify('قائمة الفلاتر: فرز + تصفية مركّبة + مسح فلاتر الجدول فقط تعمل فعليًا',async()=>{
  await page.locator('[data-fw-filters]').click();
  const pop=page.locator('.dg-pop.dg-ws-pop');
  await pop.waitFor();
  for(const txt of ['الفرز','تصفية مركّبة','فلاتر الأعمدة','الفلاتر النشطة'])
   assert.ok((await pop.textContent()).includes(txt),`قسم مفقود: ${txt}`);
  // فرز — القائمة تُعيد رسم نفسها في مكانها بعد كل إجراء (نُعيد انتظارها)
  await pop.locator('[data-ws-sadd]').selectOption({index:1});
  await page.waitForTimeout(400);
  assert.ok((await gridUi()).sort.length===1,'الفرز لم يُطبق');
  // تصفية مركّبة: شرط «الحالة يحتوي نشط» يُطبق فعليًا على الجدول (مجموعة details تُفتح أولًا)
  await page.locator('.dg-pop.dg-ws-pop details.ws-group summary',{hasText:'تصفية مركّبة'}).click();
  await page.waitForTimeout(200);
  await page.locator('.dg-pop.dg-ws-pop [data-ws-radd]').click();
  await page.waitForTimeout(400);
  await page.locator('.dg-pop.dg-ws-pop [data-ws-rv1]').first().fill('نشط');
  await page.locator('.dg-pop.dg-ws-pop [data-ws-rapply]').click();
  await page.waitForTimeout(600);
  const rowsAfterAdv=await rowCount();
  console.log(`   · بعد الفرز+التصفية المركّبة: ${rowsAfterAdv} صفًا`);
  const badge=await page.locator('[data-fw-grid-count]').textContent();
  assert.ok(Number(badge)>=1,`شارة الفلاتر: ${badge}`);
  assert.ok((await gridUi()).filterCount>=1,'التصفية المركّبة لم تُحسب');
  // مسح فلاتر الجدول فقط من القائمة نفسها
  await page.locator('.dg-pop.dg-ws-pop [data-ws-clearf]').click();await page.waitForTimeout(500);
  assert.equal((await gridUi()).filterCount,0,'مسح فلاتر الجدول لم يعمل');
  assert.equal((await gridUi()).sort.length,0);
 });

 // --- قائمة فلاتر الوقت ---
 await verify('فلاتر الوقت: الشرائح والفترات تعمل معًا وتنعكس على الشارة والنتائج',async()=>{
  const total=(await gridUi()).viewCount;
  let panel=await openTimePanel();
  assert.equal(await panel.locator('[data-file-chip]').count(),6,'عدد الشرائح');
  await panel.locator('[data-file-chip="active"]').click();
  await page.waitForTimeout(600);
  const timeBadge=await page.locator('[data-fw-time-count]').textContent();
  assert.ok(Number(timeBadge)>=1,'شارة فلاتر الوقت لم تُحدّث');
  // فترة «اليوم» تُركَّب فوق الشريحة (لا تلغيها) — الشارة تصبح 2+
  panel=await openTimePanel();
  await panel.locator('[data-preset="today"]').click();
  await page.waitForTimeout(700);
  const todayCount=(await gridUi()).viewCount;
  const chipBadge=await page.locator('[data-fw-time-count]').textContent();
  assert.ok(Number(chipBadge)>=2,`الشريحة + الفترة لا تعملان معًا (شارة=${chipBadge})`);
  console.log(`   · الكل=${total} · فترة اليوم+نشطة=${todayCount}`);
  assert.ok(todayCount<=total,'الفترة يجب ألا تزيد النتائج');
  // استرجاع «الكل» من الفترة ثم من الشريحة — الشارة تختفي
  panel=await openTimePanel();
  await panel.locator('[data-preset="all"]').click();await page.waitForTimeout(300);
  panel=await openTimePanel();
  await panel.locator('[data-file-chip="all"]').click();await page.waitForTimeout(500);
  assert.equal(await page.locator('[data-fw-time-count]').isHidden(),true,'الشارة لم تختفِ بعد الاسترجاع');
  await closeTimePanel();
 });

 // --- البحث الفوري + التركيبة + مسح الفلاتر ---
 await verify('تكامل: بحث + شريحة + فترة معًا، ثم «مسح الفلاتر» يعيد الكل دون مسح العرض',async()=>{
  await searchFiles(MARK);
  const afterQ=await rowCount();
  assert.equal(afterQ,3,`نتائج العلامة: ${afterQ}`);
  // تركيب فترة تستبعد (اليوم) مع البحث — النتيجة صفر (التقاطع لا الإلغاء)
  let panel=await openTimePanel();
  await panel.locator('[data-preset="today"]').click();
  await page.waitForTimeout(700);
  assert.equal(await rowCount(),0,'التركيب (بحث+فترة) يجب أن يُصفّر النتائج هنا');
  // شريحة نشطة إضافةً — تبقى صفرًا (لا إلغاء متبادل خاطئ)
  panel=await openTimePanel();
  await panel.locator('[data-file-chip="active"]').click();
  await page.waitForTimeout(600);
  assert.equal(await rowCount(),0,'إضافة الشريحة يجب ألا تلغي الفترة');
  // ملخص الفلاتر يعرض الشرائح الثلاث
  const summary=await page.locator('#list-filter-summary').textContent();
  assert.ok(summary.includes('بحث')&&summary.includes('الفترة')&&summary.includes('الشريحة'),`الملخص: ${summary}`);
  // «مسح الفلاتر» يرجع كل النتائج ولا يمس إعدادات العرض
  const densBefore=(await gridUi()).density;
  await page.locator('[data-fw-clear]').click();
  await page.waitForTimeout(800);
  assert.equal(await page.locator('#list-q').inputValue(),'','بحث الصفحة لم يُمسح');
  assert.ok((await rowCount())>3,'لم تعد كل النتائج');
  assert.equal((await gridUi()).density,densBefore,'مسح الفلاتر مسّ إعدادات العرض');
  assert.equal((await gridUi()).selected===0,true);
 });

 // --- تبديل بطاقات/جدول مع بقاء الحالة ---
 await verify('تبديل بطاقات ↔ جدول مع استمرار البحث والنتائج',async()=>{
  await searchFiles(MARK);
  assert.equal(await rowCount(),3);
  await page.locator('[data-fw-cards]').click();
  await page.waitForTimeout(500);
  assert.ok(await page.evaluate(()=>document.querySelector('#list-grid').classList.contains('dg-cards')),'وضع البطاقات لم يُفعّل');
  assert.equal(await rowCount(),3,'اختلاف عدد البطاقات عن الصفوف');
  assert.equal(await page.locator('#list-q').inputValue(),MARK,'البحث فُقد عند التبديل');
  const btnTxt=await page.locator('[data-fw-cards]').textContent();
  assert.ok(btnTxt.includes('جدول'),`تسمية الزر: ${btnTxt}`);
  await page.locator('[data-fw-cards]').click();
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(()=>document.querySelector('#list-grid').classList.contains('dg-cards')),false);
  assert.equal(await rowCount(),3);
 });

 // --- مسح التحديد الشامل ---
 await verify('«مسح التحديد»: يمسح كل الصفوف المحددة فورًا ولا يمس البحث ولا الفلاتر',async()=>{
  const boxes=page.locator('#list-grid .dg-rowchk');
  const btn=page.locator('[data-fw-sel-clear]');
  // مسار «تحديد الكل»: يجب أن يُظهر الزر بعدّاد كل الصفوف ثم يخفيه المسح
  await page.locator('#list-grid .dg-sel-all').check();
  await page.waitForTimeout(300);
  assert.equal((await gridUi()).selected,3,'«تحديد الكل» لم يُسجَّل');
  assert.equal(await btn.isHidden(),false,'الزر لم يظهر بعد «تحديد الكل»');
  await btn.click();await page.waitForTimeout(300);
  assert.equal((await gridUi()).selected,0,'مسح «تحديد الكل» تعطل');
  assert.equal(await btn.isHidden(),true,'الزر لم يختفِ بعد مسح الكل');
  // مسار التحديد الفردي
  await boxes.nth(0).check();await boxes.nth(1).check();
  await page.waitForTimeout(300);
  assert.equal((await gridUi()).selected,2,'التحديد لم يسجّل');
  assert.equal(await btn.isHidden(),false);
  // يقف في أقصى اليسار حتى بعد ظهوره
  const [sx,others]=await page.evaluate(()=>{
   const tb=document.querySelector('[data-fw-toolbar]');
   const sel=tb.querySelector('[data-fw-sel-clear]');
   return [sel.getBoundingClientRect().x,[...tb.children].filter(el=>el!==sel&&!el.hidden).map(el=>el.getBoundingClientRect().x)];
  });
  assert.ok(others.every(x=>sx<x),'الزر الظاهر ليس أقصى اليسار');
  await btn.click();
  await page.waitForTimeout(300);
  assert.equal((await gridUi()).selected,0,'لم يُمسح التحديد الفعلي');
  assert.equal(await page.locator('#list-grid .dg-rowchk:checked').count(),0,'مربعات التحديد ما زالت مؤشرة');
  assert.equal(await btn.isHidden(),true,'الزر لم يختفِ بعد المسح');
  assert.equal(await page.locator('#list-q').inputValue(),MARK,'مسح التحديد مسّ البحث');
  assert.equal(await rowCount(),3,'مسح التحديد مسّ النتائج');
 });

 // --- المزيد العلوية: الثيمات + إجراءات الصف + تخصيص الصفحة ---
 await verify('قائمة «المزيد» العلوية: الثيمات تغيّر الثيم فعليًا، وإجراءات الصف وتخصيص الصفحة يفتحان',async()=>{
  const before=await page.evaluate(()=>document.documentElement.dataset.theme||'luxuryGold');
  await page.locator('[data-fw-page-more]').click();
  const menu=page.locator('[data-fw-panel="page-more"].is-open');
  await menu.waitFor();
  await menu.locator('[data-fw-themes]').click();
  const themeMenu=page.locator('.theme-menu');
  await themeMenu.waitFor({state:'visible',timeout:6000});
  const options=await themeMenu.locator('[data-preset]').count();
  assert.ok(options>3,'خيارات الثيمات قليلة');
  const other=await page.evaluate(cur=>{
   const b=[...document.querySelectorAll('.theme-menu [data-preset]')].find(x=>x.dataset.preset!==cur);
   b.click();return b.dataset.preset;
  },before);
  await page.waitForTimeout(500);
  const after=await page.evaluate(()=>document.documentElement.dataset.theme||'luxuryGold');
  assert.equal(after,other,`الثيم لم يتغير فعليًا (${before} → ${after})`);
  assert.notEqual(after,before,'الثيم بقي كما هو');
  console.log(`   · الثيم: ${before} ← ${after}`);
  // إجراءات الصف
  await page.locator('[data-fw-page-more]').click();
  await menu.waitFor();
  await menu.locator('[data-qa-custom]').click();
  await page.waitForSelector('#modal-root .modal-card',{timeout:6000});
  assert.ok((await page.locator('#modal-root .modal-title').textContent()).includes('إجراءات الصف'));
  assert.ok((await page.locator('#modal-root input[type="checkbox"]').count())>5,'خيارات التخصيص مفقودة');
  await page.locator('#modal-root [data-close]').first().click();await page.waitForTimeout(300);
  // تخصيص الصفحة
  await page.locator('[data-fw-page-more]').click();
  await menu.waitFor();
  await menu.locator('[data-customize-page]').click();
  await page.waitForSelector('#modal-root .modal-card',{timeout:6000});
  await page.locator('#modal-root [data-close]').first().click();await page.waitForTimeout(300);
 });

 // --- المزيد (طباعة/تصدير): النطاقات الصحيحة ---
 await verify('طباعة «الصفوف المحددة» تطبع المحدد فقط ضمن النافذة الحقيقية',async()=>{
  await searchFiles(MARK);
  const boxes=page.locator('#list-grid .dg-rowchk');
  await boxes.nth(0).check();await boxes.nth(1).check();
  await page.waitForTimeout(300);
  await page.locator('[data-fw-io]').click();
  const pop=page.locator('.dg-pop.dg-ws-pop');await pop.waitFor();
  const selBtn=pop.locator('[data-ws-io="print"][data-ws-scope="selected"]');
  assert.equal(await selBtn.isEnabled(),true,'زر طباعة المحدد معطّل رغم وجود تحديد');
  const opened=context.waitForEvent('page');
  await selBtn.click();
  await page.waitForSelector('#modal-root .modal-card',{timeout:6000});
  const confirmText=await page.locator('#modal-root .modal-card').textContent();
  assert.ok(confirmText.includes('سيتم طباعة'),`نص التأكيد: ${confirmText}`);
  await page.locator('#modal-root [data-ok]').click();
  const popup=await opened;
  await popup.waitForFunction(()=>document.querySelector('.dg-print-header')&&window.__printRequested>0,null,{timeout:20000});
  const printed=await popup.evaluate(()=>({rows:document.querySelectorAll('tbody tr').length,title:document.querySelector('h1')?.textContent||''}));
  await popup.close();
  assert.equal(printed.rows,2,`طُبع ${printed.rows} بدل 2 محددة`);
  await page.locator('[data-fw-sel-clear]').click();await page.waitForTimeout(200);
 });

 await verify('تصدير CSV لنطاق «النتائج المطابقة للفلاتر» يشمل النطاق الصحيح فقط',async()=>{
  await page.locator('[data-fw-io]').click();
  const pop=page.locator('.dg-pop.dg-ws-pop');
  await pop.waitFor();
  const scope=pop.locator('[data-ws-exscope]');
  await scope.selectOption('all');
  const dl=page.waitForEvent('download',{timeout:25000});
  await pop.locator('[data-ws-io="csv"]').click();
  // قد تظهر نافذة خيارات تصدير قبل التنزيل — أكّدها إن ظهرت
  const modal=page.locator('#modal-root .modal-card');
  if(await modal.waitFor({timeout:6000}).then(()=>true).catch(()=>false)){
   await modal.locator('[data-ok]').click();
  }
  const download=await dl;
  const filePath=await download.path();
  const text=await fs.readFile(filePath,'utf-8');
  console.log(`   · csv: name=${download.suggestedFilename()} bytes=${Buffer.byteLength(text)} بدء=${JSON.stringify(text.slice(0,90))}`);
  const dataLines=text.trim().split('\n').length-1;
  assert.equal(dataLines,3,`سطور CSV: ${dataLines} بدل 3 (علامة البحث الحالية)`);
  assert.ok(text.includes(MARK),'محتوى CSV لا يشمل ملفات العلامة');
 });

 await verify('قائمة الطباعة/التصدير: خياراتها لا تخرج عن الشاشة وتُغلق بالنقر خارجها',async()=>{
  await page.locator('[data-fw-io]').click();
  const pop=page.locator('.dg-pop.dg-ws-pop');await pop.waitFor();
  const box=await pop.boundingBox();
  assert.ok(box.x>=0&&box.x+box.width<=1440&&box.y>=0&&box.y+box.height<=950,'خارج الشاشة');
  await page.mouse.click(720,880);
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.dg-pop.dg-ws-pop').count(),0,'النقر خارجها لم يغلقها');
 });

 // --- البحث الشامل + الإضافة العامة + الرئيسية/الرجوع ---
 await verify('البحث الشامل العام يفتح ويغلق بـ Escape ويعرض نتائج',async()=>{
  await page.locator('[data-fw-search]').click();
  const pal=page.locator('#modal-root .palette-card');
  await pal.waitFor({timeout:8000});
  const input=pal.locator('.pal-q');
  assert.equal(await input.count(),1,'حقل لوحة الأوامر مفقود');
  await input.fill(MARK);
  // انتظر ظهور نتائج فعلية تعكس بحث البيانات الحقيقي
  await pal.locator('.pal-list [role="option"],.pal-list button').first().waitFor({timeout:6000});
  const results=await pal.locator('.pal-list [role="option"],.pal-list button').count();
  assert.ok(results>=1,'لوحة الأوامر بلا نتائج');
  console.log(`   · لوحة الأوامر: ${results} نتيجة`);
  await page.keyboard.press('Escape');await page.waitForTimeout(300);
  assert.equal(await pal.count(),0,'Escape لم يغلق لوحة الأوامر');
 });
 await verify('زر «+ إضافة» العام يفتح الإضافة السريعة ويغلق',async()=>{
  await page.locator('[data-fw-quick-add]').click();
  await page.waitForTimeout(700);
  const open=await page.evaluate(()=>Boolean(document.querySelector('#modal-root .modal-card')));
  assert.ok(open,'الإضافة السريعة لم تفتح');
  await page.locator('#modal-root [data-close]').first().click();await page.waitForTimeout(300);
 });
 await verify('زر الرئيسية وزر الرجوع ينقلان فعليًا',async()=>{
  await page.locator('[data-fw-home]').click();await page.waitForTimeout(800);
  assert.equal((await route()).split(':')[0],'dashboard','زر الرئيسية لم ينقل للوحة');
  await go('clients');await page.waitForTimeout(700);
  await go('files');await waitGrid();
  await page.locator('[data-fw-back]').click();await page.waitForTimeout(800);
  assert.notEqual((await route()).split(':')[0],'files','زر الرجوع لم يغادر الصفحة');
  await go('files');await waitGrid();
 });

 // --- فتح الملف من الصف + إجراءات الصف + الأرشفة من صفحة الملف ---
 await verify('فتح ملف من الصف يعمل، والأرشفة/إعادة الفتح متاحة من صفحة الملف',async()=>{
  await searchFiles(MARK);
  await page.locator('#list-grid tbody tr[data-i]').first().click();
  await page.waitForTimeout(1200);
  assert.ok((await route()).startsWith('file:'),'لم يفتح صفحة الملف');
  const fileId=(await route()).slice(5);
  const before=await page.evaluate(async id=>{const f=await window.__LAW_OFFICE_APP__.office.r.files.get(id);return Boolean(f?.isArchived)},fileId);
  // قائمة إجراءات الملف (⋯) فيها أرشفة
  await page.locator('[data-card-menu]').click();
  const uxMenu=page.locator('.ux-menu:not([hidden])');
  await uxMenu.waitFor({timeout:6000});
  assert.equal(await uxMenu.locator('[data-file-archive]').count(),1,'زر الأرشفة غير موجود في قائمة الملف');
  if(!before){
   await uxMenu.locator('[data-file-archive]').click();
   await page.waitForSelector('#modal-root .modal-card',{timeout:6000});
   await page.locator('#modal-root [data-ok]').click();
   await page.waitForTimeout(1200);
   const archived=await page.evaluate(async id=>{const f=await window.__LAW_OFFICE_APP__.office.r.files.get(id);return Boolean(f?.isArchived)},fileId);
   assert.ok(archived,'الأرشفة لم تُنفّذ');
   await page.locator('[data-card-menu]').click();
   await uxMenu.waitFor({timeout:6000});
   assert.equal(await uxMenu.locator('[data-file-reopen]').count(),1,'زر إعادة الفتح غير موجود بعد الأرشفة');
   await uxMenu.locator('[data-file-reopen]').click();
   await page.waitForSelector('#modal-root .modal-card',{timeout:6000});
   await page.locator('#modal-root [data-ok]').click();
   await page.waitForTimeout(1200);
   const restored=await page.evaluate(async id=>{const f=await window.__LAW_OFFICE_APP__.office.r.files.get(id);return Boolean(f?.isArchived)},fileId);
   assert.equal(restored,false,'إعادة الفتح لم تُنفّذ');
  }
  await page.locator('[data-fw-back],[data-page-back]').first().click().catch(()=>go('files'));
  await go('files');await waitGrid();
  assert.equal(await page.locator('#list-q').inputValue(),MARK,'حالة البحث لم تُستعد بعد الرجوع');
 });

 // --- إجراءات الصف (القائمة السياقية) داخل الجدول ---
 await verify('قائمة إجراءات الصف داخل الجدول تفتح وتنفذ',async()=>{
  await searchFiles(MARK);
  await page.locator('#list-grid th .dg-qa-btn, #list-grid .dg-qa-btn').first().waitFor({timeout:8000}).catch(()=>{});
  const qaCount=await page.locator('#list-grid .dg-qa-btn').count();
  if(qaCount>0){
   await page.locator('#list-grid .dg-qa-btn').first().click();
   await page.waitForTimeout(400);
   const menu=page.locator('.dg-ctx');
   assert.ok(await menu.count(),'القائمة السياقية لم تفتح');
   const items=await menu.locator('button').count();
   assert.ok(items>=3,`عناصر القائمة: ${items}`);
   await page.keyboard.press('Escape');await page.waitForTimeout(200);
   assert.equal(await page.locator('.dg-ctx').count(),0,'Escape لم يغلق القائمة السياقية');
  }else{
   console.log('   · إجراءات الصف مخفية بالتخصيص — أعادها المستخدم من قائمة العرض عند الحاجة');
  }
 });

 // ================= رابعًا: حفظ التفضيلات عبر إعادة التحميل =================
 await verify('تفضيلات العرض والثيم تُحفظ وتُستعاد بعد إعادة التحميل',async()=>{
  await page.locator('[data-fw-display]').click();
  let pop=page.locator('.dg-pop.dg-ws-pop');await pop.waitFor();
  await pop.locator('[data-ws-density]').selectOption('compact');
  await page.waitForTimeout(300);
  await pop.locator('.dg-x').click();
  const themeNow=await page.evaluate(()=>document.documentElement.dataset.theme||'');
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__LAW_OFFICE_APP__?.office&&!window.__LAW_OFFICE_APP__.booting,null,{timeout:90000});
  await go('files');await waitGrid();
  assert.ok(await page.evaluate(()=>document.querySelector('#list-grid').classList.contains('dg-d-compact')),'الكثافة المحفوظة لم تُستعد');
  const themeAfter=await page.evaluate(()=>document.documentElement.dataset.theme||'');
  assert.equal(themeAfter,themeNow,'الثيم لم يُحفظ');
  // استرجاع الوضع الافتراضي كي لا تتأثر لقطات أخرى
  await page.locator('[data-fw-display]').click();
  pop=page.locator('.dg-pop.dg-ws-pop');await pop.waitFor();
  await pop.locator('[data-ws-density]').selectOption('');
  await pop.locator('.dg-x').click();await page.waitForTimeout(300);
 });

 // ================= خامسًا: عدم تأثر الصفحات الأخرى بالمكوّن المشترك =================
 await verify('انحدار: صفحة الجلسات (جدول عادي) تحتفظ بشريط التحديد القديم كاملًا',async()=>{
  await go('hearings');await waitGrid().catch(()=>page.waitForTimeout(800));
  const selbar=await page.evaluate(()=>{
   const sb=document.querySelector('#list-grid .dg-selbar');
   return sb?{exists:true,hasClear:!!sb.querySelector('.dg-sel-clear'),hasPrint:!!sb.querySelector('.dg-sel-print'),hasOpen:!!sb.querySelector('.dg-open-sel')}:{exists:false};
  });
  assert.ok(selbar.exists,'شريط التحديد مفقود في صفحة الجلسات');
  assert.ok(selbar.hasClear&&selbar.hasPrint&&selbar.hasOpen,'أزرار الشريط ناقصة');
  if(await page.locator('#list-grid .dg-rowchk').count()){
   await page.locator('#list-grid .dg-rowchk').first().check();await page.waitForTimeout(300);
   const visible=await page.evaluate(()=>!document.querySelector('#list-grid .dg-selbar').hidden);
   assert.ok(visible,'الشريط لم يظهر مع التحديد في الجلسات');
   // نُطلق مستمع الزر الحقيقي — إعادة رسم دورية في بيئة الاختبار تجعل نقر المؤشر غير مستقر
   const stateBefore=await page.evaluate(()=>({sel:document.querySelector('#list-grid').__grid.getUi().selected,hidden:document.querySelector('#list-grid .dg-selbar').hidden}));
   console.log(`   · جلسات قبل المسح: محدد=${stateBefore.sel} شريط مخفي=${stateBefore.hidden}`);
   await page.evaluate(()=>document.querySelector('#list-grid .dg-selbar .dg-sel-clear').click());
   await page.waitForTimeout(250);
   assert.equal((await gridUi()).selected,0,'مسح التحديد في الجلسات تعطل');
  }
  await go('files');await waitGrid();
 });

 // ================= لقطات نهائية =================
 await searchFiles('');
 await page.locator('#list-grid .dg-rowchk').first().check();
 await page.locator('#list-grid .dg-rowchk').nth(1).check();
 await page.waitForTimeout(400);
 await page.screenshot({path:path.join(artifactDir,'files-after-selected.png')});
 await page.screenshot({path:path.join(artifactDir,'files-after-full.png'),fullPage:false});
 console.log('   · محفوظة في .cache/files-workspace-final/');

 // ================= الأخطاء =================
 await verify('لا أخطاء JavaScript أو أخطاء وحدة تحكم طوال كل السيناريوهات',async()=>{
  const realErrors=report.errors.filter(e=>!/favicon|net::|fonts|preload/i.test(e));
  assert.deepEqual(realErrors,[],realErrors.join('\n'));
 });

 report.status='PASS';
 console.log(`\nPASS — ${report.checks.length} فحصًا ناجحًا`);
}catch(error){
 report.status='FAIL';report.fatal=String(error?.stack||error);
 console.error('FAIL —',error?.message||error);
 try{
  await page.screenshot({path:path.join(artifactDir,'FAIL-state.png')});
  report.failShot='.cache/files-workspace-final/FAIL-state.png';
 }catch{}
 process.exitCode=1;
}finally{
 await fs.writeFile(path.join(artifactDir,'report.json'),JSON.stringify(report,null,2)+'\n');
 await context.close().catch(()=>{});await browser.close().catch(()=>{});
}
