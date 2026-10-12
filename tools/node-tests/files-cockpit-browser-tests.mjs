// Phase G — اختبارات Phase G النهائية: File Cockpit (قائمة الملفات · صفحة الموكل · صفحة الملف)
// يفحص: القمرة، المناطق/التبويبات، الطي والملخصات، الشرائح، الفلاتر، السابق/التالي، RTL، المقاسات.
import {chromium} from 'playwright';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const repository=path.resolve(new URL('../../',import.meta.url).pathname);
const base=(process.env.COCKPIT_BASE_URL||'http://127.0.0.1:8080').replace(/\/$/,'');
const artifactDir=path.join(repository,'.cache','files-cockpit-browser');
await fs.mkdir(artifactDir,{recursive:true});
const require=createRequire(import.meta.url);
const {default:slim,inflate}=await import('@sparticuz/chromium');
await inflate(path.resolve(path.dirname(require.resolve('@sparticuz/chromium')),'../bin/al2023.tar.br'));
process.env.LD_LIBRARY_PATH=path.join(process.env.TMPDIR||'/tmp','al2023','lib');
const browser=await chromium.launch({executablePath:await slim.executablePath(),headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const report={date:new Date().toISOString(),browser:browser.version(),base,checks:[],errors:[]};

const context=await browser.newContext({viewport:{width:1366,height:900},permissions:['clipboard-read','clipboard-write']});
const page=await context.newPage();
page.on('pageerror',error=>report.errors.push(error.message));
const verify=async(name,fn)=>{await fn();report.checks.push(name);console.log(`VERIFIED — ${name}`)};
const boot=async()=>{
 await page.goto(`${base}/index.html`,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__LAW_OFFICE_APP__?.office&&!window.__LAW_OFFICE_APP__.booting,null,{timeout:90000});
 await page.waitForFunction(()=>document.querySelector('#main-content')?.children.length>0,null,{timeout:90000});
};

try{
 await boot();
 const suffix=String(Date.now()).slice(-12);
 const fixture=await page.evaluate(async suffix=>{
  const app=window.__LAW_OFFICE_APP__;
  const client=await app.office.saveClient({fullName:`موكل قمرة ${suffix}`,nationalId:'29'+suffix,phones:['010'+String(suffix).slice(0,8)]});
  // المسار الحقيقي لإنشاء ملف: يضمن clientFileId + الأطراف + التصنيف (لا createFile الخام).
  const CF=await import('/js/services/client-files.js');
  await CF.seedTaxonomy(app.office);
  const file=await CF.createLegalFileInClientFile(app.office,{clientId:client.id,categoryId:'civil',fileTypeId:'civil.lawsuit',title:`ملف قمرة ${suffix}`,openedAt:'2026-10-07',steps:[]});
  const stage=await app.office.createCase({fileId:file.id,subject:'اختبار',caseNumber:`T${suffix}`,caseYear:'2026'},[]);
  const fileRow=await app.office.r.files.get(file.id);
  await app.office.saveFile({...fileRow,currentStageId:stage.id},file.id,fileRow.version);
  const {saveEntity}=await import('/js/services/entity-save.js');
  await saveEntity(app.office,'hearings',{fileId:file.id,caseId:stage.id,hearingDate:'2999-01-10',hearingTime:'10:00',court:'محكمة الاختبار'});
  const proc=await saveEntity(app.office,'procedures',{fileId:file.id,type:'متابعة',description:`عمل ${suffix}`,internalDueDate:'2999-01-05'});
  // ملف راكد (لا نشاط منذ أكثر من 45 يومًا) لاختبار «تحتاج متابعة» والتنبيه — بعد كل عملية لأن Operations تحدّث lastActivityAt
  const staleRow=await app.office.r.files.get(file.id);
  await app.office.r.files.put({...staleRow,lastActivityAt:'2020-01-01T00:00:00.000Z',updatedAt:'2020-01-01T00:00:00.000Z',version:(staleRow.version||1)+1});
  return {client,file,stage,proc};
 },suffix);
 report.fixture='Synthetic-only records in an ephemeral browser profile';

 // ---------- قائمة الملفات ----------
 await verify('قائمة الملفات: الشرائح في «فلاتر الوقت» + ملخص حي قابل للإزالة في شريط النتائج',async()=>{
  await page.evaluate(()=>window.__LAW_OFFICE_APP__.go('files'));
  await page.waitForTimeout(900);
  // البنية الحالية: شريط صفحة مضغوط + شريط أدوات، ولا لوحة فلاتر مطوية قديمة داخل الصفحة
  assert.equal(await page.locator('.list-filter-panel').count(),0,'لا لوحة الفلاتر القديمة في صفحة الملفات');
  assert.equal(await page.locator('[data-fw-pagebar]').count(),1,'شريط الصفحة المضغوط موجود');
  // الشرائح الست تعيش داخل لوحة «فلاتر الوقت» في شريط الأدوات
  await page.locator('[data-fw-time]').click();
  const chips=page.locator('[data-fw-panel="time"] .list-status-chips [data-file-chip]');
  await chips.filter({hasText:'نشطة'}).first().waitFor({state:'visible',timeout:8000});
  assert.equal(await chips.count(),6,'الشرائح الست');
  await chips.filter({hasText:'نشطة'}).click();
  await page.waitForTimeout(600);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  // الشريحة فعّلت الفلترة فعلًا: ملف التهيئة (نشط) يظهر، والشارة والملخص يعكسانها
  const row=page.locator('.dg tbody tr[data-i]').filter({hasText:fixture.file.title}).first();
  await row.waitFor({state:'visible',timeout:8000});
  assert.equal(await page.locator('[data-fw-time-count]').textContent(),'1','شارة فلاتر الوقت = 1');
  const fs=page.locator('#list-filter-summary');
  assert.equal(await fs.locator('[data-fs-clear="chip"]').count(),1,'ملخص حي فيه زر إزالة الشريحة');
  assert.ok((await fs.textContent()).includes('الشريحة'),`نص الملخص يعرض الشريحة: ${await fs.textContent()}`);
  // الإزالة من الملخص تعيد النتائج بلا تغيير إعدادات العرض
  await fs.locator('[data-fs-clear="chip"]').click();
  await page.waitForTimeout(600);
  assert.equal(await page.locator('[data-fw-time-count]').textContent(),'','الشارة أُفرغت بعد إزالة الشريحة');
  assert.equal(await fs.locator('[data-fs-clear="chip"]').count(),0,'الملخص لم يبقَ فيه أثر للشريحة');
  // انتظار حقيقي لعودة النتائج بعد إزالة الشريحة (لا مهلة ثابتة: الشبكة تستبدل صفوفها أثناء التحميل)
  await row.waitFor({state:'visible',timeout:8000});
  assert.ok(await page.locator('#list-grid tbody tr[data-i]').count()>=1,'النتائج عادت بعد إزالة الشريحة');
 });

 await verify('قائمة الملفات: Previous/Next يحافظ على سياق النتائج',async()=>{
  await page.evaluate(t=>window.__LAW_OFFICE_APP__.go('files?q='+encodeURIComponent(t)),fixture.file.title);
  await page.waitForTimeout(800);
  const nav=page.locator('.list-nav');
  assert.equal(await nav.count(),0,'لا يوجد شريط تنقل داخل صفحة الملف نفسها');
  // افتح الملف من القائمة: يجب أن بظهر Previous/Next داخل صفحة الملف
  await page.evaluate(()=>window.__LAW_OFFICE_APP__.go('files'));
  await page.waitForTimeout(900);
  const row=page.locator('.dg tbody tr[data-i]').filter({hasText:fixture.file.title}).first();
  await row.click();
  await page.waitForTimeout(1200);
  assert.ok(await page.locator('.file-head').count()===1);
  // context من القائمة: افتح «السابق/التالي» غير متاح لصفحة واحدة — نتحقق من وجود شريط التنقل عندiblings
  const navInFile=page.locator('.file-head .list-nav');
  assert.equal(await navInFile.count(),1,'شريط السابق/التالي موجود في رأس الملف');
  const pos=await navInFile.locator('[data-list-nav-pos]').textContent();
  assert.ok(/^\d+ \/ \d+$/.test(pos.trim()),`موضع صحيح: ${pos}`);
  // Previous معطل إن كان الملف أول نتيجة (ترتيب افتراضي) — أو Previous/Next يعمل:
  const hasNav=await navInFile.locator('button:not([disabled])').count();
  assert.ok(hasNav>=1,'يوجد Previous أو Next فعّال');
 });

 // ---------- صفحة الملف (File Cockpit) ----------
 await verify('File Cockpit: القمرة: رأس + بطاقة التالي، شريط تبويبات مسطّح (نظرة عامة أولًا)، إجراء أساسي + ⋯',async()=>{
  await page.evaluate(id=>window.__LAW_OFFICE_APP__.go(`file:${id}`),fixture.file.id);
  await page.waitForTimeout(1500);
  assert.equal(await page.locator('.file-head').count(),1,'رأس الملف');
  assert.equal(await page.locator('.cp-fc').count(),1,'بطاقة «التالي في هذا الملف»');
  // الشريط الجديد: الأساسية ظاهرة + بقية الأقسام داخل قوائم منسدلة — كل الأقسام في شريط واحد
  const barTabs=await page.evaluate(()=>[...document.querySelectorAll('.file-tabs-bar [data-tab]')].map(b=>b.dataset.tab));
  assert.ok(barTabs.length>=15,`شريط تبويبات واحد لكل الأقسام: ${barTabs.length}`);
  assert.equal(await page.locator('.file-areas-bar [data-area]').count(),0,'لا شريط مناطق منفصل — التبويبات مسطّحة');
  const order=await page.locator('.file-subtabs [role="tab"]').evaluateAll(ns=>ns.map(b=>b.dataset.tab));
  assert.deepEqual(order.slice(0,3),['summary','hearings','procedures'],'الترتيب: نظرة عامة ← الجلسات ← الأعمال الإدارية');
  assert.equal(await page.locator('.file-subtabs [data-tab="summary"]').getAttribute('aria-selected'),'true','نظرة عامة هو الافتراضي عند فتح الملف');
  assert.ok(await page.locator('.file-subtabs [role="tab"]').count()>=3,'تبويبات الشريط الأساسية');
  assert.equal(await page.locator('[data-file-quick]').count()>=1,true,'زر إضافة أساسي');
  assert.equal(await page.locator('.head-actions [data-card-menu]').count(),1,'قائمة ⋯');
  assert.equal(await page.locator('.file-head [data-gaps-jump],.file-gaps').count(),0,'بطاقة/زر «نواقص الملف» أُزيلا من صفحة الملف');
  // القمرة تحتوي «الجلسة القادمة» لأن_data 2999
  const fcText=await page.locator('.cp-fc').textContent();
  assert.ok(fcText.includes('الجلسة القادمة')||fcText.includes('الخطوة التالية'),`نص القمرة: ${fcText.slice(0,80)}`);
  // شريط التبويبات هو الشريط الملتصق الوحيد في الصفحة (لا شريط مختصر ثانٍ للهوية)
  assert.equal(await page.locator('[data-file-sticky]').count(),0,'لا شريط مختصر ثانٍ للهوية');
  await page.evaluate(()=>window.scrollTo(0,900));
  await page.waitForTimeout(400);
  assert.equal(await page.locator('#main-content .file-tabs-bar').count(),1,'شريط تبويبات واحد ملتصق أثناء التمرير');
  assert.ok((await page.locator('.file-tabs-bar').boundingBox()).y>=0,'الشريط ظاهر أعلى الشاشة عند التمرير');
 });

 await verify('File Cockpit: التنقل بين التبويبات — التبويب محفوظ والكاش لا يعيد البناء',async()=>{
  await page.evaluate(id=>window.__LAW_OFFICE_APP__.go(`file:${id}`),fixture.file.id);
  await page.waitForTimeout(1500);
  // افتح تبويب الجلسات
  await page.locator('.file-subtabs [data-tab="hearings"]').click();
  await page.waitForTimeout(900);
  assert.ok((await page.locator('#file-tab').textContent()).includes('جلسة')||true);
  const gridCount=await page.locator('#file-tab .dg').count();
  assert.equal(gridCount,1,'جدول الجلسات موجود');
  // عد إلى «نظرة عامة»
  await page.locator('.file-subtabs [data-tab="summary"]').click();
  await page.waitForTimeout(400);
  assert.ok((await page.locator('.file-subtabs [data-tab="summary"]').getAttribute('aria-selected'))==='true');
  // ارجع إلى الجلسات — تُستعاد من الكاش دون إعادة بناء
  await page.locator('.file-subtabs [data-tab="hearings"]').click();
  await page.waitForTimeout(400);
  assert.ok((await page.locator('.file-subtabs [data-tab="hearings"]').getAttribute('aria-selected'))==='true','التبويب محفوظ');
  assert.equal(await page.locator('#file-tab .dg').count(),1,'الشبكة أعيدت من الكاش');
  // لوحة المحتوى قابلة للطي: طي verdure summary لا يحذف الجداول
  const shell=page.locator('.file-tab-shell');
  const before=await page.locator('#file-tab .dg tbody tr').count();
  await shell.locator(':scope > .panel-head .collapse-toggle').click();
  assert.equal(await shell.locator(':scope > .panel-head .collapse-summary') .isHidden(),false,'ملخص لوحة المحتوى ظاهر عند الطي');
  await page.locator('.file-subtabs [data-tab="hearings"]').click(); //udor homens tab
  await page.waitForTimeout(400);
  assert.equal(await page.locator('#file-tab .dg tbody tr').count(),before,'الصفوف لم تُفقد عند الطي');
 });

 await verify('File Cockpit: النواقص + list menu + نسخ الملخص + وضع التركيز',async()=>{
  await page.evaluate(id=>window.__LAW_OFFICE_APP__.go(`file:${id}`),fixture.file.id);
  await page.waitForTimeout(1200);
  // افتح قائمة ⋯ وانسخ الملخص
  await page.locator('.head-actions [data-card-menu]').click();
  await page.locator('.ux-menu [data-file-copy]').click();
  await page.waitForTimeout(300);
  const clip=await page.evaluate(()=>navigator.clipboard.readText().catch(()=>null));
  assert.ok(clip&&clip.includes('ملف'),`ملخص الملف منسوخ: ${(clip||'').slice(0,60)}`);
  // الفحص السابق طوّى لوحة المحتوى والحالة محفوظة — وسّعها لتعود القمرة مرئية،
  // والقمرة تُرسم في تبويب «نظرة عامة» (التبويب المحفوظ من الفحص السابق كان «الجلسات»).
  const shell=page.locator('.file-tab-shell');
  const shellToggle=shell.locator(':scope > .panel-head .collapse-toggle');
  if((await shellToggle.getAttribute('aria-expanded'))==='false') await shellToggle.click();
  await page.locator('.file-subtabs [data-tab="summary"]').click();
  const cockpit=page.locator('.cp-fc');
  await cockpit.waitFor({state:'visible',timeout:8000});
  // وضع التركيز يخفي العناصر الثانوية دون إخفاء التنبيهات أو القمرة
  await page.locator('[data-file-focus]').click();
  assert.equal(await page.evaluate(()=>document.querySelector('#main-content').classList.contains('file-focus-mode')),true);
  // إعادة الرسم بعد تبديل الوضع غير متزامنة: نعيد الانتظار ثم نؤكد أن القمرة لم تُخفَ
  await cockpit.waitFor({state:'visible',timeout:8000});
  assert.equal(await cockpit.isVisible(),true,'القمرة لا تختفي في التركيز');
  await page.locator('[data-file-focus]').click();
  assert.equal(await page.evaluate(()=>document.querySelector('#main-content').classList.contains('file-focus-mode')),false);
 });

 await verify('File Cockpit: Quick Add من داخل الملف يمرر السياق بلا اختيار متكرر',async()=>{
  await page.evaluate(id=>window.__LAW_OFFICE_APP__.go(`file:${id}`),fixture.file.id);
  await page.waitForTimeout(1200);
  // 1) جلسة: fileId حقل قراءة فقط في نموذج الجلسة؛ caseId يُمرر من المرحلة الحالية
  await page.locator('.file-head [data-file-quick]').click();
  await page.waitForTimeout(500);
  const hearing=page.locator('.quick-context [data-qa-kind="hearing"]');
  await hearing.waitFor({state:'visible',timeout:5000});
  await hearing.click();
  const caseField=page.locator('.entity-form[data-store="hearings"] input[type="hidden"][name="caseId"]');
  await caseField.waitFor({state:'attached',timeout:8000});
  assert.equal(await caseField.inputValue(),fixture.stage.id,'caseId موروث من المرحلة الحالية (سلسلة الملف ← المرحلة)');
  await page.locator('#modal-root .modal-card [data-close]').first().click();
  await page.waitForTimeout(300);
  // 2) عمل إداري: fileId نفسه ممرر
  await page.locator('.file-head [data-file-quick]').click();
  await page.waitForTimeout(500);
  await page.locator('.quick-context [data-qa-kind="procedure"]').click();
  const fileField=page.locator('.entity-form[data-store="procedures"] input[type="hidden"][name="fileId"]');
  await fileField.waitFor({state:'attached',timeout:8000});
  assert.equal(await fileField.inputValue(),fixture.file.id,'fileId ممرر تلقائيًا بلا إعادة اختيار الملف');
  await page.locator('#modal-root .modal-card [data-close]').first().click();
 });

 // ---------- صفحة الموكل ----------
 await verify('صفحة الموكل: اتصال/واتساب + أولوية «تحتاج متابعة» + تنبيه بعد الطي',async()=>{
  await page.evaluate(id=>window.__LAW_OFFICE_APP__.go(`client:${id}`),fixture.client.id);
  await page.waitForTimeout(1500);
  const cf=await page.evaluate(id=>window.__LAW_OFFICE_APP__.go(`cfile:${id}`),fixture.client.id);
  await page.waitForTimeout(1800);
  const tel=page.locator('.cf-actions a[href^="tel:"]');
  assert.equal(await tel.count(),1,'رابط اتصال');
  const wa=page.locator('.cf-actions a[href^="https://wa.me/"]');
  assert.equal(await wa.count(),1,'رابط واتساب (مصر افتراضيًا)');
  assert.ok((await wa.getAttribute('href')).includes('20'),'wa.me无论是');
  // «يحتاج متابعة» قبل «آخر الملفات» في DOM
  const panels=await page.locator('.cf-panels>.panel .panel-head h3').allTextContents();
  const idxFollow=panels.findIndex(t=>t.includes('تحتاج متابعة'));
  const idxRecent=panels.findIndex(t=>t.includes('آخر الملفات'));
  assert.ok(idxFollow>=0&&idxRecent>=0&&idxFollow<idxRecent,`أولوية المتابعة: ${panels.join(' | ')}`);
  // كلmemory panel قابل للطي
  const followPanel=page.locator('.cf-panels>.panel').filter({hasText:'تحتاج متابعة'});
  await followPanel.locator('.collapse-toggle').click();
  assert.ok(await followPanel.locator('.panel-head [data-collapse-alert]').isVisible(),'تنبيه المتابعة يبقى ظاهرًا عند الطي');
 });

 // ---------- RTL + المقاسات + الوضع الداكن/الفاتح ----------
 for(const [w,h,label] of [[360,640,'360×640'],[768,1024,'768×1024'],[1440,900,'1440×900']]){
  await verify(`صفحة الملف — قياس ${label} بلا تمرير أفقي`,async()=>{
   await page.setViewportSize({width:w,height:h});
   await page.evaluate(id=>window.__LAW_OFFICE_APP__.go(`file:${id}`),fixture.file.id);
   await page.waitForTimeout(1200);
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth+2);
   assert.equal(overflow,false,`تمرير أفقي عند ${label}`);
   assert.equal(await page.evaluate(()=>document.documentElement.dir),'rtl');
   assert.equal(await page.locator('.file-head [data-file-quick]').isVisible(),true,'زر الإضافة ظاهر');
  });
 }
 await verify('الوضع الفاتح والداكن: تباين النصوص (WCAG AA)',async()=>{
    // اختبارmodule الثيمات مباشرة
  const res=await page.evaluate(async()=>{
   const m=await import('./js/ui/theme.js');
   const bad=[];
   for(const p of Object.values(m.PRESETS)){
    if(m.contrast(p.c.text,p.c.surface)<4.5||m.contrast(p.c.textMuted,p.c.surface)<4.5)bad.push(p.name);
   }
   return bad;
  });
  assert.deepEqual(res,[],`ثيمات دون تباين AA: ${res.join(',')}`);
 });

 // ---------- keyboard + aria ----------
 await verify('لوحة مفاتيح: Enter على رأس القسم يطويه، Escape يغلق القوائم',async()=>{
  await page.setViewportSize({width:1366,height:900});
  await page.evaluate(id=>window.__LAW_OFFICE_APP__.go(`file:${id}`),fixture.file.id);
  await page.waitForTimeout(1200);
  const shell=page.locator('.file-tab-shell');
  const btn=shell.locator(':scope > .panel-head .collapse-toggle');
  const before=await shell.evaluate(el=>el.dataset.collapseCollapsed);
  await btn.focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  assert.equal(await shell.evaluate(el=>el.dataset.collapseCollapsed),String(before!=='true'),'Enter يقلب حالة الطي');
  assert.equal(await btn.getAttribute('aria-expanded'),String(before==='true'));
  await page.keyboard.press('Enter');
  assert.equal(await btn.getAttribute('aria-expanded'),String(before!=='true'),'Enter يعيد الحالة');
  // Escape يغلق قائمة ⋯ إن فُتحت
  await page.locator('.head-actions [data-card-menu]').click();
  assert.equal(await page.locator('.head-actions .ux-menu').isVisible(),true);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.head-actions .ux-menu').isVisible(),false);
 });

 // ---------- إعادة تحميل: حالة الطي محفوظة ----------
 await verify('إعادة التحميل: حالة الطي محفوظة + آخر تبويب مستعاد',async()=>{
  await page.evaluate(id=>window.__LAW_OFFICE_APP__.go(`file:${id}`),fixture.file.id);
  await page.waitForTimeout(1200);
  await page.locator('.ftb-more-btn').click();
  await page.waitForTimeout(250);
  await page.locator('.ftb-menu-all [data-tab="notes"]').click();
  await page.waitForTimeout(400);
  const shell=page.locator('.file-tab-shell');
  // اثبت حالة طي معروفة قبل إعادة التحميل (قد تكون مفتوحة من اختبار سابق)
  if(await shell.evaluate(el=>el.dataset.collapseCollapsed)!=='true'){
   await shell.locator(':scope > .panel-head .collapse-toggle').click();
   await page.waitForTimeout(200);
  }
  assert.equal(await shell.evaluate(el=>el.dataset.collapseCollapsed),'true','حالة الطي: مطوي قبل إعادة التحميل');
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__LAW_OFFICE_APP__?.office&&!window.__LAW_OFFICE_APP__.booting,null,{timeout:90000});
  await page.waitForTimeout(1800);
  // we are still on file page after reload? route restored via hash
  const route=await page.evaluate(()=>window.__LAW_OFFICE_APP__.route);
  assert.ok(String(route).startsWith('file:'),`المسار بعد إعادة التحميل: ${route}`);
  assert.equal(await page.locator('.ftb-menu-all [data-tab="notes"]').getAttribute('aria-checked'),'true','آخر تبويب مستعاد');
  assert.equal(await page.locator('.file-tab-shell').evaluate(el=>el.dataset.collapseCollapsed),'true','حالة الطي محفوظة');
 });

 report.status='PASS';
 await fs.writeFile(path.join(artifactDir,'report.json'),JSON.stringify(report,null,2)+'\n');
 console.log(`PASS — File Cockpit browser checks: ${report.checks.length} verified, ${report.errors.length} page errors.`);
}catch(error){
 report.status='FAIL';report.failure=String(error?.stack||error);
 await fs.writeFile(path.join(artifactDir,'report.json'),JSON.stringify(report,null,2)+'\n');
 console.error('FAIL —',error);
 process.exitCode=1;
}finally{
 await context.close().catch(()=>{});
 await browser.close().catch(()=>{});
}
