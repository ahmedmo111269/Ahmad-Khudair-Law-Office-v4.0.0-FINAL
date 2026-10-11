// =====================================================================
// اختبارات مساحة عمل صفحة الملف (إعادة التصميم Data-First) — متصفح حقيقي
// ---------------------------------------------------------------------
// تغطي المتطلبات الإلزامية 1-15: التبويب الافتراضي، هوية القضية والأطراف من
// البيانات الحقيقية، الملفات بلا رقم قضائي، الأشرطة القابلة للطي، تسلسل
// الدعوى/الاستئناف/النقض، تبويبات الجلسات والأعمال، بقية التبويبات، الحفظ
// والتعديل، النماذج غير المحفوظة، عزل ملفات متعددة، البحث والفرز والتصدير،
// RTL/الثيمات/المقاسات، عدم تكرار الأحداث، وعدم تأثر قائمة الملفات.
// البيانات كلها تركيبية داخل ملف متصفح مؤقت يُغلق في النهاية — لا تُلمس قاعدة
// بيانات المكتب الحقيقية عند المستخدم.
// =====================================================================
import {chromium} from 'playwright';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const repository=path.resolve(new URL('../../',import.meta.url).pathname);
const base=(process.env.FPW_BASE_URL||'http://127.0.0.1:8080').replace(/\/$/,'');
const artifactDir=path.join(repository,'.cache','file-workspace-browser');
await fs.mkdir(artifactDir,{recursive:true});
const require=createRequire(import.meta.url);
const {default:slim,inflate}=await import('@sparticuz/chromium');
await inflate(path.resolve(path.dirname(require.resolve('@sparticuz/chromium')),'../bin/al2023.tar.br'));
process.env.LD_LIBRARY_PATH=path.join(process.env.TMPDIR||'/tmp','al2023','lib');
const browser=await chromium.launch({executablePath:await slim.executablePath(),headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const report={date:new Date().toISOString(),browser:browser.version(),base,checks:[],errors:[]};
const context=await browser.newContext({viewport:{width:1440,height:950},locale:'ar-EG',permissions:['clipboard-read','clipboard-write']});
const page=await context.newPage();
page.on('pageerror',e=>report.errors.push('pageerror: '+e.message));
page.on('console',m=>{if(m.type()==='error'&&!/ERR_CONNECTION_CLOSED|service worker/i.test(m.text()))report.errors.push('console: '+m.text())});
const verify=async(name,fn)=>{await fn();report.checks.push(name);console.log(`VERIFIED — ${name}`)};
const go=async route=>{await page.evaluate(r=>window.__LAW_OFFICE_APP__.go(r),route);await page.waitForTimeout(1400)};
const tabText=()=>page.evaluate(()=>(document.querySelector('#file-tab')?.textContent||'').replace(/\s+/g,' ').trim());
const headText=()=>page.evaluate(()=>(document.querySelector('#file-head')?.textContent||'').replace(/\s+/g,' ').trim());
// التبويبات الأساسية تحمل aria-selected، وعناصر القوائم المنسدلة تحمل aria-checked — كلاهما «نشط».
const activeTabCheck=(k,expected=true)=>page.evaluate(({k,expected})=>{
 const el=document.querySelector(`.file-tabs-bar [data-tab="${k}"]`);
 if(!el)return false;
 const on=el.getAttribute('aria-selected')==='true'||el.getAttribute('aria-checked')==='true';
 return on===expected;
},{k,expected});
const openGridTools=async()=>{
 const shell=page.locator('#file-tab .dg').first();
 if(await shell.locator(':scope > .dg-shell-head + .dg-body > .dg-tools-summary [aria-expanded="false"], :scope .dg-tools-summary-toggle[aria-expanded="false"]').first().count())
  await shell.locator('.dg-tools-summary-toggle').first().click();
 else if(await shell.locator('.dg-tools-panel[hidden]').count())
  await shell.locator('.dg-tools-summary-toggle').first().click();
 await page.waitForTimeout(400);
};

try{
 await page.goto(`${base}/index.html`,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__LAW_OFFICE_APP__?.office&&!window.__LAW_OFFICE_APP__.booting,null,{timeout:120000});
 await page.waitForFunction(()=>document.querySelector('#main-content')?.children.length>0,null,{timeout:120000});
 const suffix=String(Date.now()).slice(-12);

 // ---------- بيانات تركيبية: ملف بثلاث مراحل (دعوى ← استئناف ← نقض) + ملف بلا قضية ----------
 const fx=await page.evaluate(async suffix=>{
  const app=window.__LAW_OFFICE_APP__;
  const CF=await import('/js/services/client-files.js');
  const {saveEntity}=await import('/js/services/entity-save.js');
  await CF.seedTaxonomy(app.office);
  const client=await app.office.saveClient({fullName:'محمد عبد الرحمن السيد',nationalId:'29'+suffix});
  const file=await CF.createLegalFileInClientFile(app.office,{clientId:client.id,categoryId:'civil',fileTypeId:'civil.lawsuit',title:'صحة توقيع — عقد بيع ابتدائي',openedAt:'2026-01-12',steps:[]});
  await saveEntity(app.office,'fileParties',{fileId:file.id,partyKind:'opponent',name:'شركة النيل للمقاولات',role:'مدعى عليه',roleGroup:'الخصوم',sequence:1});
  await saveEntity(app.office,'fileParties',{fileId:file.id,partyKind:'other',name:'ورثة المرحوم أحمد خليل',role:'مدعى عليهم',roleGroup:'أطراف أخرى',sequence:2});
  const s1=await app.office.createCase({fileId:file.id,stageType:'دعوى',numberType:'رقم دعوى',caseNumber:'1234',caseYear:'2026',courtId:'محكمة بنها الابتدائية',chamber:'دائرة 3 مدني',degree:'أول درجة',subject:'صحة توقيع عقد بيع ابتدائي',requests:'الحكم بصحة التوقيع',filingDate:'2026-01-20',status:'متداولة',lifecycle:'done',stageOrder:1,clientCapacity:'مدعٍ',opponentCapacity:'مدعى عليه'},[]);
  const s2=await app.office.createCase({fileId:file.id,stageType:'استئناف',numberType:'رقم استئناف',caseNumber:'78',caseYear:'2026',courtId:'محكمة استئناف طنطا مأمورية بنها',degree:'ثاني درجة',subject:'استئناف الحكم الابتدائي',filingDate:'2026-06-02',status:'متداولة',lifecycle:'active',stageOrder:2},[]);
  const s3=await app.office.createCase({fileId:file.id,stageType:'نقض',numberType:'رقم طعن',caseNumber:'3456',caseYear:'2026',courtId:'محكمة النقض',degree:'نقض / طعن',filingDate:'2026-09-15',lifecycle:'planned',stageOrder:3},[]);
  const row=await app.office.r.files.get(file.id);
  await app.office.saveFile({...row,currentStageId:s2.id,responsibleLawyer:'أحمد محمد خضير'},file.id,row.version);
  await saveEntity(app.office,'hearings',{fileId:file.id,caseId:s1.id,hearingDate:'2026-03-05',hearingTime:'09:30',court:'محكمة بنها الابتدائية',type:'مرافعة',result:'تأجيل لتقديم المستندات',adjournedTo:'2026-11-12'});
  await saveEntity(app.office,'hearings',{fileId:file.id,caseId:s2.id,hearingDate:'2026-11-12',hearingTime:'10:00',court:'محكمة استئناف طنطا مأمورية بنها',type:'مرافعة',reason:'نظر الاستئناف'});
  await saveEntity(app.office,'judgments',{fileId:file.id,caseId:s1.id,judgmentDate:'2026-05-20',judgmentType:'حكم نهائي',operativeSummary:'رفض الدعوى',court:'محكمة بنها الابتدائية'});
  await saveEntity(app.office,'procedures',{fileId:file.id,caseId:s2.id,type:'متابعة',description:'متابعة تقرير الخبير بمكتب الخبراء',internalDueDate:'2026-10-11',status:'pending'});
  await saveEntity(app.office,'procedures',{fileId:file.id,type:'إعلان',description:'إعلان صحيفة الاستئناف',internalDueDate:'2026-10-20',status:'open',priority:'high'});
  await saveEntity(app.office,'procedures',{fileId:file.id,type:'شهادة',description:'استخراج شهادة من الجدول',actionDate:'2026-08-14',status:'done',result:'تم الاستخراج'});
  await saveEntity(app.office,'serviceRecords',{fileId:file.id,caseId:s1.id,actionType:'إعلان',serviceDate:'2026-10-02',status:'تم الإعلان'});
  // ملف ثانٍ مرتبط (علاقة مسجلة) لاختبار عرض العلاقات في التسلسل
  const rel=await CF.createLegalFileInClientFile(app.office,{clientId:client.id,categoryId:'civil',fileTypeId:'civil.lawsuit',title:'ملف تنفيذ الحكم',openedAt:'2026-07-01',steps:[]});
  await saveEntity(app.office,'fileRelations',{sourceFileId:file.id,targetFileId:rel.id,relationType:'تنفيذ حكم',notes:'ملف تنفيذ'});
  // ملف ثالث بلا أي رقم قضائي (طبيعة إدارية)
  const tax=await CF.taxonomy(app.office);
  const cat2=tax.categories.find(c=>c.id!=='civil')||tax.categories[0];
  const t2=tax.typesOf(cat2.id)[0];
  const client2=await app.office.saveClient({fullName:'هدى إبراهيم منصور',nationalId:'28'+suffix});
  const plain=await CF.createLegalFileInClientFile(app.office,{clientId:client2.id,categoryId:cat2.id,fileTypeId:t2?.id||'',title:'مراجعة عقد إيجار — استشارة',openedAt:'2026-03-02',steps:[]});
  const fnum=r=>{const m=/^(?:LF|CL)-(\d{4})-(\d+)$/.exec(r);return r?`${Number(m[2])}/${m[1]}`:''};
  return {suffix,file,plain,rel,stages:{s1,s2,s3},fileNo:fnum(file.fileNumber),plainNo:fnum(plain.fileNumber)};
 },suffix);
 report.fixture='Synthetic records in an ephemeral browser profile only';

 // (1) الافتراضي = نظرة عامة
 await verify('1) فتح الملف يفتح «نظرة عامة» افتراضيًا',async()=>{
  await go('files');
  await go(`file:${fx.file.id}`);
  assert.ok(await activeTabCheck('summary'),'نظرة عامة هي التبويب النشط');
  const order=await page.locator('.file-tabs-bar .file-subtabs [role="tab"]').evaluateAll(ns=>ns.map(b=>b.dataset.tab));
  assert.deepEqual(order,['summary','hearings','procedures','judicial'],'التبويبات الأساسية الأربعة بترتيبها');
  assert.ok((await tabText()).startsWith('الملخص التنفيذي'),'الملخص التنفيذي أول ما يراه المحامي في نظرة عامة');
 });

 // (2) الهوية من البيانات الحقيقية
 await verify('2) رقم الملف الفرعي وعنوان القضية والأطراف من البيانات الحقيقية',async()=>{
  const head=await headText();
  assert.ok(head.includes(`ملف فرعي: ${fx.fileNo}`),`رقم الملف الفرعي الحقيقي: ${fx.fileNo}`);
  assert.ok(head.includes('الاستئناف رقم 78 لسنة 2026 — استئناف الحكم الابتدائي'),'العنوان القانوني للمرحلة الحالية مبني من الحقول');
  assert.ok(head.includes('محكمة استئناف طنطا مأمورية بنها · ثاني درجة'),'سطر المحكمة/الدرجة كاملًا دون قص');
  assert.ok(head.includes('محمد عبد الرحمن السيد')&&head.includes('شركة النيل للمقاولات')&&head.includes('ورثة المرحوم أحمد خليل'),'كل الأطراف ظاهرون');
  const roles=await page.locator('.fid-party .fid-party-role').allTextContents();
  assert.deepEqual(roles.slice(0,3),['الموكل','الخصم','أطراف أخرى'],'ترتيب المجموعات: موكل ← خصم ← أطراف');
  const nameSize=await page.locator('.fid-party-name').first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize));
  const roleSize=await page.locator('.fid-party-role').first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize));
  assert.ok(nameSize>roleSize+2,`اسم الطرف (${nameSize}px) أكبر من النص الثانوي (${roleSize}px)`);
  const titleSize=await page.locator('.fid-title').evaluate(el=>parseFloat(getComputedStyle(el).fontSize));
  assert.ok(titleSize>=20,`حجم خط العنوان القانوني ${titleSize}px`);
 });

 // (3) ملف بلا رقم قضائي
 await verify('3) ملف بلا دعوى: نوع الملف ووصفه دون اختلاق بيانات قضائية',async()=>{
  await go(`file:${fx.plain.id}`);
  const head=await headText();
  assert.ok(head.includes(`ملف فرعي: ${fx.plainNo}`));
  assert.ok(head.includes('مراجعة عقد إيجار — استشارة'),'عنوان الملف كما هو');
  assert.ok(head.includes('لا توجد أرقام قضائية مسجلة (ملف بلا قضية)'),'إفصاح صريح بلا اختلاق');
  assert.ok(!/رقم \d+ لسنة/.test(head),'لا رقم دعوى مُختلَق');
  const txt=await tabText();
  assert.ok(txt.includes('لا توجد مرحلة أو رقم قضائي مسجل'),'قسم البيانات يفصح بعدم وجود مرحلة');
  assert.ok(txt.includes('بلا مراحل مسجلة'),'قسم التسلسل يفصح بعدم وجود مراحل');
 });

 // (4) الشريطان القابلان للطي
 await verify('4) فتح وإغلاق شريطي البيانات والمرحلة مع حفظ تفضيل الطي',async()=>{
  await go(`file:${fx.file.id}`);
  const data=page.locator('.fp-case-data'),seq=page.locator('.fp-stage-seq');
  assert.equal(await data.evaluate(el=>el.dataset.collapseCollapsed),'false','بيانات الدعوى مفتوح افتراضيًا');
  assert.equal(await seq.evaluate(el=>el.dataset.collapseCollapsed),'false','التسلسل مفتوح افتراضيًا');
  await data.locator(':scope > .panel-head .collapse-toggle').click();await page.waitForTimeout(250);
  assert.equal(await data.evaluate(el=>el.dataset.collapseCollapsed),'true','طي شريط البيانات');
  assert.ok(await data.locator(':scope > .panel-head [data-collapse-alert],:scope > .panel-head .collapse-summary').first().isVisible(),'الملخص يبقى ظاهرًا عند الطي');
  await seq.locator(':scope > .panel-head .collapse-toggle').click();await page.waitForTimeout(250);
  assert.equal(await seq.evaluate(el=>el.dataset.collapseCollapsed),'true','طي شريط التسلسل');
  await data.locator(':scope > .panel-head .collapse-toggle').click();await page.waitForTimeout(250);
  assert.equal(await data.evaluate(el=>el.dataset.collapseCollapsed),'false','إعادة فتح شريط البيانات');
  // تفضيل الطي محفوظ بعد إعادة التحميل
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__LAW_OFFICE_APP__?.office&&!window.__LAW_OFFICE_APP__.booting,null,{timeout:120000});
  await page.waitForTimeout(1600);
  assert.equal(await page.locator('.fp-stage-seq').evaluate(el=>el.dataset.collapseCollapsed),'true','حالة طي التسلسل محفوظة بعد إعادة التحميل');
  await page.locator('.fp-stage-seq').locator(':scope > .panel-head .collapse-toggle').click();await page.waitForTimeout(250);
 });

 // (5) تسلسل دعوى ← استئناف ← نقض + العلاقات
 await verify('5) تسلسل المراحل الحقيقي: دعوى ثم استئناف ثم نقض مع تمييز الحالية وبيانات كل مرحلة',async()=>{
  const names=await page.locator('.fss-chain .fss-stage-name').allTextContents();
  assert.deepEqual(names,['دعوى','استئناف','نقض'],'ترتيب التسلسل كما سُجل');
  const current=await page.locator('.fss-chain .fss-stage.is-current .fss-stage-name').textContent();
  assert.equal(current.trim(),'استئناف','المرحلة الحالية مميزة بصريًا');
  assert.ok((await page.locator('.fss-current-v').textContent()).includes('1234/2026')||(await page.locator('.fss-current-v').textContent()).includes('استئناف'),'شريط المرحلة الحالية');
  const stage2=page.locator('.fss-chain .fss-stage').nth(1);
  assert.ok((await stage2.textContent()).includes('محكمة استئناف طنطا مأمورية بنها'),'اسم المحكمة كامل دون قص');
  assert.ok((await stage2.textContent()).includes('الجلسات (1)')&&(await stage2.textContent()).includes('2026-11-12'.split('-').reverse().join('/')),'جلسات المرحلة الاستئنافية');
  const stage1=page.locator('.fss-chain .fss-stage').nth(0);
  assert.ok((await stage1.textContent()).includes('الأحكام (1)'),'أحكام المرحلة الابتدائية');
  assert.ok((await page.locator('.fp-stage-seq').textContent()).includes('ملفات مرتبطة بعلاقات مسجلة (1)'),'العلاقات المسجلة ظاهرة');
  // فتح المرحلة من التسلسل
  await page.locator('.fss-chain .fss-stage').nth(2).locator('[data-open-case]').click();
  await page.waitForTimeout(1200);
  assert.ok(String(await page.evaluate(()=>window.__LAW_OFFICE_APP__.route)).startsWith(`case:${fx.stages.s3.id}`),'فتح بيانات مرحلة النقض');
  await go(`file:${fx.file.id}`);
 });

 // (6) تبويب الجلسات
 await verify('6) تبويب الجلسات: جدول كامل + إضافة + بحث وفرز',async()=>{
  await page.locator('.file-tabs-bar [data-tab="hearings"]').click();await page.waitForTimeout(1200);
  const rows=await page.locator('#file-tab .dg tbody tr[data-i]').count();
  // جلستان مسجلتان + جلسة ثالثة أنشأها النظام تلقائيًا من «التأجيل إلى» (سلوك قائم في operations)
  assert.equal(rows,3,'جلسات الملف (المسجلة + المنشأة من التأجيل)');
  const txt=await tabText();
  assert.ok(txt.includes('تاريخ الجلسة')&&txt.includes('القرار')&&txt.includes('التأجيل إلى'),'أعمدة الجلسات كاملة');
  // بحث فوري داخل الجدول (لوحة أدوات الجدول قابلة للطي — تُفتح أولًا)
  await openGridTools();
  await page.locator('#file-tab .dg-quick').fill('استئناف');await page.waitForTimeout(700);
  const filtered=await page.locator('#file-tab .dg tbody tr[data-i]').count();
  assert.ok(filtered>=1&&filtered<rows,`البحث الفوري يصفّي الجلسات (${filtered})`);
  await page.locator('#file-tab .dg-quick').fill('');await page.waitForTimeout(700);
  assert.equal(await page.locator('#file-tab .dg tbody tr[data-i]').count(),rows,'مسح البحث يعيد الصفوف');
  // فتح سجل جلسة من الجدول
  await page.locator('#file-tab .dg tbody tr[data-i]').first().click();await page.waitForTimeout(1200);
  assert.ok(String(await page.evaluate(()=>window.__LAW_OFFICE_APP__.route)).startsWith('rec:hearings:'),'فتح سجل الجلسة');
  await go(`file:${fx.file.id}`);
  await page.locator('.file-tabs-bar [data-tab="hearings"]').click();await page.waitForTimeout(900);
 });

 // (7) تبويب الأعمال الإدارية
 await verify('7) تبويب الأعمال الإدارية: خط زمني + جدول + حالات الإنجاز',async()=>{
  await page.locator('.file-tabs-bar [data-tab="procedures"]').click();await page.waitForTimeout(1200);
  const txt=await tabText();
  assert.ok(txt.includes('إعلان صحيفة الاستئناف')&&txt.includes('متابعة تقرير الخبير'),'الأعمال ظاهرة');
  assert.ok(txt.includes('مفتوح')&&txt.includes('قيد الانتظار')&&txt.includes('تم'),'حالات الإنجاز بارزة');
  assert.equal(await page.locator('#file-tab .timeline li[data-open]').count(),3,'الخط الزمني للأعمال');
  await page.locator('#file-tab details.rec-section summary').click();await page.waitForTimeout(800);
  assert.equal(await page.locator('#file-tab .dg tbody tr[data-i]').count(),3,'جدول الأعمال الكامل');
 });

 // (8) بقية التبويبات
 await verify('8) كل تبويب آخر يُفتح وبه محتواه وأدواته',async()=>{
  const tabs=await page.locator('.file-tabs-bar [data-tab]').evaluateAll(ns=>ns.map(b=>b.dataset.tab));
  for(const t of tabs){
   await page.evaluate(k=>document.querySelector(`.file-tabs-bar [data-tab="${k}"]`).click(),t);
   await page.waitForTimeout(800);
   const len=(await tabText()).length;
   assert.ok(len>40,`تبويب ${t} له محتوى (${len})`);
   assert.ok(await activeTabCheck(t),`تبويب ${t} نشط`);
  }
 });

 // (9) إضافة وتعديل وحفظ ثم تحقق بعد إعادة الفتح
 await verify('9) إضافة عمل إداري من التبويب وحفظه ثم التحقق بعد إعادة الفتح',async()=>{
  await page.evaluate(k=>document.querySelector(`.file-tabs-bar [data-tab="${k}"]`).click(),'procedures');
  await page.waitForTimeout(900);
  await page.locator('#file-tab [data-add]').first().click();await page.waitForTimeout(900);
  const form=page.locator('.entity-form[data-store="procedures"]');
  await form.waitFor({state:'visible',timeout:8000});
  await form.locator('[name="description"]').fill('عمل اختبار محفوظ '+fx.suffix);
  await form.locator('[name="status"]').selectOption('open');
  await form.locator('button[type="submit"], .form-actions button.primary').first().click();
  await page.waitForTimeout(1800);
  assert.ok((await tabText()).includes('عمل اختبار محفوظ '+fx.suffix),'العمل المحفوظ ظاهر بعد الحفظ');
  await page.evaluate(()=>window.__LAW_OFFICE_APP__.go('dashboard'));await page.waitForTimeout(900);
  await go(`file:${fx.file.id}`);
  await page.evaluate(k=>document.querySelector(`.file-tabs-bar [data-tab="${k}"]`).click(),'procedures');
  await page.waitForTimeout(1000);
  assert.ok((await tabText()).includes('عمل اختبار محفوظ '+fx.suffix),'العمل محفوظ بعد مغادرة الصفحة والعودة');
 });

 // (10) النماذج غير المحفوظة عند تبديل التبويب
 await verify('10) بيانات نموذج غير محفوظة لا تُفقد عند تبديل التبويبات',async()=>{
  await page.evaluate(k=>document.querySelector(`.file-tabs-bar [data-tab="${k}"]`).click(),'typeData');
  await page.waitForTimeout(900);
  // لوحة نموذج نوع العمل قابلة للطي — تُفتح أولًا
  if(await page.locator('#file-tab .panel').first().evaluate(el=>el.dataset.collapseCollapsed)==='true')
   await page.locator('#file-tab .panel').first().locator(':scope > .panel-head .collapse-toggle').click();
  await page.waitForTimeout(400);
  const input=page.locator('#file-tab [data-meta]').first();
  await input.fill('مسودة غير محفوظة '+fx.suffix);
  await page.evaluate(k=>document.querySelector(`.file-tabs-bar [data-tab="${k}"]`).click(),'hearings');
  await page.waitForTimeout(800);
  await page.evaluate(k=>document.querySelector(`.file-tabs-bar [data-tab="${k}"]`).click(),'typeData');
  await page.waitForTimeout(800);
  assert.equal(await page.locator('#file-tab [data-meta]').first().inputValue(),'مسودة غير محفوظة '+fx.suffix,'الكاش يحتفظ بقيم النموذج');
 });

 // (11) عزل الملفات
 await verify('11) لا اختلاط بين بيانات ملفين عند التنقل',async()=>{
  await go(`file:${fx.plain.id}`);
  let head=await headText();
  assert.ok(head.includes(fx.plainNo)&&!head.includes(fx.fileNo),'رأس الملف الثاني فقط');
  assert.ok(!head.includes('شركة النيل للمقاولات'),'لا أطراف ملف آخر');
  await go(`file:${fx.file.id}`);
  head=await headText();
  assert.ok(head.includes(fx.fileNo)&&!head.includes(fx.plainNo),'رأس الملف الأول فقط');
  await page.evaluate(k=>document.querySelector(`.file-tabs-bar [data-tab="${k}"]`).click(),'parties');
  await page.waitForTimeout(800);
  assert.ok(!(await tabText()).includes('هدى إبراهيم منصور'),'أطراف التبويب معزولة');
 });

 // (12) البحث/الفرز/التصدير في قسم يدعمها
 await verify('12) البحث والفرز والتصدير في جدول الجلسات',async()=>{
  await page.evaluate(k=>document.querySelector(`.file-tabs-bar [data-tab="${k}"]`).click(),'hearings');
  await page.waitForTimeout(900);
  await openGridTools();
  // فرز بزر الفرز في ترويسة عمود التاريخ (تصاعدي ثم تنازلي)
  const sortBtn=page.locator('#file-tab .dg th[data-key="hearingDate"] .dg-sort');
  await sortBtn.click();await page.waitForTimeout(700);
  const first1=(await page.locator('#file-tab .dg tbody tr[data-i] td[data-k="hearingDate"]').first().textContent()).trim();
  await sortBtn.click();await page.waitForTimeout(700);
  const first2=(await page.locator('#file-tab .dg tbody tr[data-i] td[data-k="hearingDate"]').first().textContent()).trim();
  assert.notEqual(first1,first2,`الفرز يغيّر الترتيب (${first1} ← ${first2})`);
  // الطباعة: مستند الطباعة المولّد يحمل بيانات الجدول (نافذة الطباعة تُحاكى والتُقط محتواها)
  const printHtml=await page.evaluate(async()=>{
   let html='';const orig=window.open;
   window.open=()=>({opener:null,closed:false,focus(){},print(){},close(){},document:{open(){},write(h){html+=h},close(){}}});
   document.querySelector('#file-tab .dg-print').click();
   await new Promise(r=>setTimeout(r,1800));
   window.open=orig;return html;
  });
  assert.ok(/<table/.test(printHtml)&&/جلسة|تاريخ الجلسة/.test(printHtml),'مستند الطباعة يحمل جدول الجلسات');
  // التصدير: قائمة صيغ موجودة وتُنتج تنزيلًا
  const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#file-tab .dg-export').selectOption('csv')]);
  assert.ok(String(download.suggestedFilename()).length>0,'تنزيل ملف التصدير CSV');
 });

 // (13) RTL + الثيمات + المقاسات
 await verify('13) RTL والثيمات وثلاثة مقاسات بلا تمرير أفقي',async()=>{
  for(const [w,h,label] of [[360,740,'360×740'],[768,1024,'768×1024'],[1440,950,'1440×950']]){
   await page.setViewportSize({width:w,height:h});
   await go(`file:${fx.file.id}`);
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth+2);
   assert.equal(overflow,false,`لا تمرير أفقي عند ${label}`);
   assert.equal(await page.evaluate(()=>document.documentElement.dir),'rtl');
   assert.ok(await page.locator('.file-head [data-file-quick]').isVisible(),'زر الإضافة ظاهر');
   assert.ok(await page.locator('.file-tabs-bar [data-tab="summary"]').isVisible(),'التبويب الافتراضي ظاهر');
  }
  await page.setViewportSize({width:1440,height:950});
  for(const theme of ['elegantLight','luxuryGold']){
   await page.evaluate(t=>window.__LAW_OFFICE_APP__&&import('/js/core/preferences.js').then(m=>m.prefs.set('akl:prefs:theme'.replace('akl:prefs:',''),{preset:t,followSystem:false})),theme);
   await page.evaluate(t=>{document.documentElement.setAttribute('data-theme',t)},theme);
   await page.waitForTimeout(300);
   const colors=await page.evaluate(()=>{const s=getComputedStyle(document.querySelector('.fid-title'));return s.color});
   assert.ok(colors,`العنوان مرئي بثيم ${theme}`);
  }
  await page.evaluate(()=>document.documentElement.removeAttribute('data-theme'));
 });

 // (14) لا أخطاء JS ولا تكرار مكونات/أحداث
 await verify('14) تنقل متكرر بلا تكرار مكونات ولا أخطاء JavaScript',async()=>{
  const before=report.errors.length;
  for(let i=0;i<3;i++){
   await page.evaluate(k=>document.querySelector(`.file-tabs-bar [data-tab="${k}"]`).click(),'summary');await page.waitForTimeout(500);
   await page.evaluate(k=>document.querySelector(`.file-tabs-bar [data-tab="${k}"]`).click(),'hearings');await page.waitForTimeout(500);
  }
  assert.equal(await page.locator('#file-tab .dg').count(),1,'جدول واحد فقط بعد تنقل متكرر');
  await page.evaluate(k=>document.querySelector(`.file-tabs-bar [data-tab="${k}"]`).click(),'summary');await page.waitForTimeout(700);
  assert.equal(await page.locator('#file-tab .cp-fc').count(),1,'قمرة واحدة فقط');
  assert.equal(await page.locator('#file-tab .fp-case-data').count(),1,'شريط بيانات واحد');
  assert.equal(await page.locator('#file-tab .stage-path').count(),1,'شريط إدارة مراحل واحد');
  assert.equal(report.errors.length,before,'لا أخطاء جديدة أثناء التنقل');
 });

 // (15) آخر تبويب لكل ملف + الافتراض لملف جديد
 await verify('15) التفضيل لكل ملف: نفس الملف يستعيد تبويبه وملف جديد يفتح نظرة عامة',async()=>{
  await go(`file:${fx.file.id}`);
  await page.evaluate(k=>document.querySelector(`.file-tabs-bar [data-tab="${k}"]`).click(),'judgments');
  await page.waitForTimeout(700);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__LAW_OFFICE_APP__?.office&&!window.__LAW_OFFICE_APP__.booting,null,{timeout:120000});
  await page.waitForTimeout(1600);
  assert.ok(await activeTabCheck('judgments'),'نفس الملف يستعيد آخر تبويب له');
  await go(`file:${fx.plain.id}`);
  assert.ok(await activeTabCheck('summary'),'ملف آخر يفتح نظرة عامة لا تبويب الملف السابق');
 });

 // (16) سلوكان قائمان لم يتأثرا: الشريط الثابت عند التمرير + وضع التركيز
 await verify('16) الشريط الثابت عند التمرير ووضع التركيز يعملان كما كانا',async()=>{
  await go(`file:${fx.file.id}`);
  await page.evaluate(()=>document.querySelector('.file-tabs-bar [data-tab="summary"]').click());
  await page.waitForTimeout(900);
  assert.equal(await page.locator('[data-file-sticky]').isVisible(),false,'الشريط مخفي في أعلى الصفحة');
  await page.evaluate(()=>window.scrollTo(0,1200));await page.waitForTimeout(1000);
  assert.ok(await page.locator('[data-file-sticky]').evaluate(el=>el.classList.contains('is-on')),'الشريط الثابت يظهر عند التمرير');
  assert.equal(await page.locator('[data-file-sticky]').isVisible(),true,'الشريط الثابت مرئي');
  await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(400);
  await page.locator('[data-file-focus]').click();await page.waitForTimeout(400);
  assert.equal(await page.evaluate(()=>document.querySelector('#main-content').classList.contains('file-focus-mode')),true);
  assert.equal(await page.locator('#file-tab .cp-fc').isVisible(),true,'قمرة الملف لا تختفي في وضع التركيز');
  assert.equal(await page.locator('#file-tab .cp-fc-stats').isVisible(),false,'الإحصاءات الثانوية تُختصر في التركيز');
  await page.locator('[data-file-focus]').click();await page.waitForTimeout(300);
  assert.equal(await page.evaluate(()=>document.querySelector('#main-content').classList.contains('file-focus-mode')),false);
 });

 // (17) قائمة «كل الأقسام» (⋯) في شريط الأدوات: فتح/إغلاق/Escape/نقر خارجي/تنقل فعلي
 await verify('17) قائمة «كل الأقسام» تعمل وتُغلق بـEscape والنقر خارجها وتنقل فعليًا',async()=>{
  await go(`file:${fx.file.id}`);
  const btn=page.locator('[data-tabs-menu]');
  assert.equal(await btn.count(),1,'زر قائمة «كل الأقسام» واحد فقط');
  await btn.click();await page.waitForTimeout(300);
  const menu=page.locator('.ftb-menu-all');
  assert.equal(await menu.isVisible(),true,'القائمة تفتح');
  assert.equal(await menu.locator('[data-menu-tab]').count(),15,'كل الأقسام داخل القائمة');
  await page.keyboard.press('Escape');await page.waitForTimeout(300);
  assert.equal(await menu.isVisible(),false,'Escape يغلق القائمة');
  await btn.click();await page.waitForTimeout(300);
  await page.mouse.click(700,600);await page.waitForTimeout(300);
  assert.equal(await menu.isVisible(),false,'النقر خارجها يغلقها');
  await btn.click();await page.waitForTimeout(300);
  await menu.locator('[data-menu-tab="judgments"]').click();await page.waitForTimeout(900);
  assert.ok(await activeTabCheck('judgments'),'عنصر القائمة ينقل فعليًا إلى التبويب');
  assert.equal(await menu.isVisible(),false,'القائمة تُغلق بعد الاختيار');
 });

 // (18) شريط التبويبات: التبويبات الأساسية ظاهرة والأقسام الأخرى داخل قوائم منسدلة
 await verify('18) التبويبات الأساسية ظاهرة (4) وبقية الأقسام داخل قوائم منسدلة بلا تكرار',async()=>{
  await go(`file:${fx.file.id}`);
  const primary=await page.locator('.file-tabs-bar .file-subtabs [role="tab"]').evaluateAll(ns=>ns.map(b=>b.dataset.tab));
  assert.deepEqual(primary,['summary','hearings','procedures','judicial'],'الأساسية الظاهرة: نظرة عامة، الجلسات، الأعمال الإدارية، المراحل والإجراءات');
  const groups=await page.locator('.ftb-group').evaluateAll(ns=>ns.map(g=>({id:g.dataset.group,label:g.querySelector('.ftb-group-btn .tab-label')?.textContent?.trim(),items:[...g.querySelectorAll('.ftb-item')].map(i=>i.dataset.tab)})));
  assert.ok(groups.length>=4,`عدد القوائم المنسدلة: ${groups.length}`);
  const grouped=groups.flatMap(g=>g.items);
  const allIds=await page.locator('.file-tabs-bar [data-tab]').evaluateAll(ns=>ns.map(b=>b.dataset.tab));
  assert.equal(new Set(allIds).size,allIds.length,'كل قسم يظهر مرة واحدة فقط في الشريط — لا تكرار');
  assert.equal(allIds.length,15,`كل الأقسام متاحة من الشريط (${allIds.length})`);
  assert.equal([...primary,...grouped].length,15,'الأساسية + القوائم = كل الأقسام');
  // كل قسم محفوظ في النظام يملك تبويبًا فعليًا
  const macro=await page.evaluate(async()=>{
   const {getPageLayout}=await import('/js/ui/page-layout.js');
   return getPageLayout('file-details').sections.map(s=>s.id);
  });
  assert.deepEqual([...macro].sort(),[...allIds].sort(),'قائمة التخصيص المركزي تطابق أقسام الشريط');
  // المخفي من «تخصيص الصفحة» يخرج من الشريط والقوائم ويبقى في «كل الأقسام» مُعلَّمًا
  await page.evaluate(async()=>{const {saveSectionLayout}=await import('/js/core/display-prefs.js');saveSectionLayout('file-details',{hidden:['notes']})});
  await go(`file:${fx.file.id}`);
  const notesInBar=await page.locator('.file-tabs-bar [data-tab="notes"]').count();
  assert.equal(notesInBar,0,'القسم المخفي يخرج من الشريط والقوائم');
  await page.locator('[data-tabs-menu]').click();await page.waitForTimeout(300);
  const hiddenItem=page.locator('.ftb-menu-all [data-menu-tab="notes"]');
  assert.equal(await hiddenItem.count(),1,'يبقى متاحًا في قائمة «كل الأقسام» — لا وظيفة تصبح غير قابلة للوصول');
  assert.ok((await hiddenItem.textContent()).includes('مخفي'),'مُعلَّم بكلمة «مخفي»');
  await hiddenItem.click();await page.waitForTimeout(900);
  assert.equal((await page.locator('[data-tab-shell-title]').textContent()).trim(),'الملاحظات','ويمكن فتحه عند الحاجة من القائمة');
  assert.equal(await page.locator('.ftb-menu-all [data-menu-tab="notes"]').getAttribute('aria-checked'),'true','عنصر القسم المخفي مُعلَّم كنشط داخل القائمة');
  await page.evaluate(async()=>{const {saveSectionLayout}=await import('/js/core/display-prefs.js');saveSectionLayout('file-details',{hidden:[]})});
  await go(`file:${fx.file.id}`);
 });

 // (19) القوائم المنسدلة: الاختيار يفتح القسم الصحيح ويُميّز الحالي + سلوك لوحة المفاتيح
 await verify('19) القوائم المنسدلة: تحديد القسم النشط بصريًا وفتح القسم الصحيح + لوحة المفاتيح',async()=>{
  await go(`file:${fx.file.id}`);
  const group=page.locator('.ftb-group[data-group="gJudgments"]');
  const trigger=group.locator('.ftb-group-btn');
  assert.equal(await trigger.getAttribute('aria-expanded'),'false','القائمة مغلقة ابتداءً');
  await trigger.click();await page.waitForTimeout(300);
  assert.equal(await trigger.getAttribute('aria-expanded'),'true','الزر يفتح القائمة');
  const menu=group.locator('.ftb-menu');
  assert.equal(await menu.isVisible(),true,'القائمة ظاهرة');
  const labels=await menu.locator('.ftb-item .ftb-item-label').allTextContents();
  assert.deepEqual(labels,['الأحكام','المحضرين والإعلانات'],'عناصر القائمة هي أقسام المجموعة الفعلية');
  // تنقل بالأسهم داخل القائمة (الفتح يضع التركيز على العنصر الأول)
  assert.equal(await page.evaluate(()=>document.activeElement?.dataset?.tab||''),'judgments','الفتح يضع التركيز على العنصر الأول');
  await page.keyboard.press('ArrowDown');await page.waitForTimeout(150);
  assert.equal(await page.evaluate(()=>document.activeElement?.dataset?.tab||''),'serviceRecords','↓ ينتقل إلى العنصر التالي');
  await page.keyboard.press('ArrowUp');await page.waitForTimeout(150);
  assert.equal(await page.evaluate(()=>document.activeElement?.dataset?.tab||''),'judgments','↑ يعود إلى العنصر السابق');
  await page.keyboard.press('Escape');await page.waitForTimeout(250);
  assert.equal(await menu.isVisible(),false,'Escape يغلق القائمة');
  assert.equal(await page.evaluate(()=>document.activeElement?.dataset?.tabGroup||''),'gJudgments','التركيز يعود إلى زر المجموعة');
  // اختيار عنصر من القائمة
  await trigger.click();await page.waitForTimeout(250);
  await menu.locator('[data-tab="judgments"]').click();await page.waitForTimeout(900);
  assert.ok(await activeTabCheck('judgments'),'القسم المختار فُتح فعلًا');
  assert.equal(await menu.isVisible(),false,'القائمة أُغلقت بعد الاختيار');
  assert.equal(await group.getAttribute('class').then(c=>c.includes('is-active')),true,'المجموعة النشطة مميزة بصريًا');
  assert.equal((await trigger.locator('.ftb-active-name').textContent()).trim(),'الأحكام','اسم القسم المفتوح ظاهر في زر المجموعة');
  const item=menu.locator('[data-tab="judgments"]');
  assert.equal(await item.getAttribute('aria-checked'),'true','العنصر النشط مُعلَّم بـaria-checked');
  assert.equal(await item.getAttribute('class').then(c=>c.includes('is-on')),true,'العنصر النشط مميز بصريًا');
  assert.equal((await page.locator('[data-tab-shell-title]').textContent()).trim(),'الأحكام','عنوان لوحة المحتوى يطابق القسم');
  // مجموعة أخرى لا تحتفظ بحالة نشطة كاذبة
  assert.equal(await page.locator('.ftb-group[data-group="gParties"]').getAttribute('class').then(c=>c.includes('is-active')),false,'بقية المجموعات غير نشطة');
 });

 // (20) القوائم لا تُقطع عند حواف الشاشة (RTL) على سطح المكتب والهاتف
 await verify('20) القوائم المنسدلة لا تُقطع عند حواف الشاشة في RTL (مكتب/هاتف)',async()=>{
  for(const [w,h] of [[1440,950],[768,1024],[360,740]]){
   await page.setViewportSize({width:w,height:h});
   await go(`file:${fx.file.id}`);
   // نقيس تخطيط شريط التبويبات نفسه: نعود إلى «نظرة عامة» (بلا جدول عريض) ثم نقيس
   await page.evaluate(()=>document.querySelector('.file-tabs-bar [data-tab="summary"]')?.click());
   await page.waitForTimeout(700);
   const ids=await page.locator('.ftb-group').evaluateAll(ns=>ns.map(g=>g.dataset.group));
   for(const id of ids){
    await page.evaluate(g=>document.querySelector(`.ftb-group[data-group="${g}"] .ftb-group-btn`).click(),id);
    await page.waitForTimeout(220);
    const box=await page.evaluate(g=>{const m=document.querySelector(`.ftb-group[data-group="${g}"] .ftb-menu`);const r=m.getBoundingClientRect();return {open:!m.hidden,left:r.left,right:r.right,top:r.top,width:r.width,vw:window.innerWidth}},id);
    assert.equal(box.open,true,`القائمة ${id} تُفتح عند ${w}px`);
    assert.ok(box.left>=-1&&box.right<=box.vw+1,`القائمة ${id} داخل الشاشة عند ${w}px (${Math.round(box.left)}..${Math.round(box.right)} / ${box.vw})`);
    await page.keyboard.press('Escape');await page.waitForTimeout(150);
   }
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth+2);
   assert.equal(overflow,false,`لا تمرير أفقي للصفحة عند ${w}px`);
   const primaryVisible=await page.locator('.file-tabs-bar .file-subtabs [role="tab"]:visible').count();
   assert.equal(primaryVisible>=4,true,`التبويبات الأساسية ظاهرة كلها عند ${w}px`);
  }
  await page.setViewportSize({width:1440,height:950});
 });

 // (23) الشريط الملتصق: التنقل يبقى ظاهرًا أثناء التمرير دون حجب المحتوى
 await verify('23) شريط التبويبات ملتصق أثناء التمرير بلا تراكب مع الشرائط الأخرى (مكتب/هاتف)',async()=>{
  // تحقق إضافي: لا تراكم طبقات مربك — ترتيب z: التنقل > شريط الصفحة > التبويبات > الشريط المختصر
  for(const [w,h] of [[1440,900],[834,1024],[390,780]]){
   await page.setViewportSize({width:w,height:h});
   await go(`file:${fx.file.id}`);
   await page.evaluate(()=>document.querySelector('.file-tabs-bar [data-tab="summary"]')?.click());
   await page.waitForTimeout(700);
   await page.evaluate(()=>window.scrollTo(0,1400));
   await page.waitForTimeout(800);
   const geo=await page.evaluate(()=>{
    const r=s=>{const el=document.querySelector(s);if(!el)return null;const b=el.getBoundingClientRect();return {top:Math.round(b.top),bottom:Math.round(b.bottom),h:Math.round(b.height),visible:b.height>0&&b.top<window.innerHeight&&b.bottom>0}};
    const z=s=>{const el=document.querySelector(s);return el?Number(getComputedStyle(el).zIndex)||0:0};
    return {tn:r('#sidebar.tn-bar'),topbar:r('.topbar'),tabs:r('.file-tabs-bar'),sticky:r('[data-file-sticky].is-on'),
     z:{tn:z('#sidebar.tn-bar'),topbar:z('.topbar'),tabs:z('.file-tabs-bar'),sticky:z('[data-file-sticky]')}};
   });
   assert.ok(geo.tabs&&geo.tabs.visible,`شريط التبويبات ظاهر أثناء التمرير عند ${w}px`);
   assert.ok(geo.tabs.top>=0,`الشريط غير مقصوص أعلى الشاشة عند ${w}px (top=${geo.tabs.top})`);
   if(geo.tn)assert.ok(geo.tabs.top>=geo.tn.bottom-1,`الشريط أسفل شريط التنقل عند ${w}px`);
   if(geo.topbar&&geo.topbar.h&&geo.tabs.top>60)assert.ok(geo.tabs.top>=geo.topbar.bottom-1,`الشريط لا يغطي شريط الصفحة عند ${w}px`);
   if(geo.sticky&&geo.sticky.visible)assert.ok(geo.tabs.top>=geo.sticky.bottom-1,`الشريط لا يغطي الشريط المختصر عند ${w}px`);
   assert.ok(geo.z.tn>geo.z.tabs&&geo.z.topbar>geo.z.tabs,`ترتيب الطبقات صحيح عند ${w}px (${JSON.stringify(geo.z)})`);
   // التنقل يبقى فعالًا أثناء الالتصاق
   await page.evaluate(()=>document.querySelector('.file-tabs-bar [data-tab="hearings"]')?.click());
   await page.waitForTimeout(900);
   assert.ok(await activeTabCheck('hearings'),`التبويب يعمل أثناء التمرير عند ${w}px`);
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth+2);
   assert.equal(overflow,false,`لا تمرير أفقي عند ${w}px`);
  }
  await page.setViewportSize({width:1440,height:950});
 });

 // (24) بنية دلالية ووصول كامل بلوحة المفاتيح إلى كل الأقسام الخمسة عشر
 await verify('24) البنية الدلالية (a11y) ووصول لوحة المفاتيح إلى كل الأقسام بلا استثناء',async()=>{
  await go(`file:${fx.file.id}`);
  await page.evaluate(()=>document.querySelector('.file-tabs-bar [data-tab="summary"]')?.click());
  await page.waitForTimeout(800);
  const a11y=await page.evaluate(()=>{
   const bar=document.querySelector('.file-tabs-bar');
   const row=bar.querySelector('.file-subtabs');
   const tabs=[...row.querySelectorAll('[role="tab"]')];
   return {
    tablist:row.getAttribute('role'),
    tabs:tabs.map(t=>({tab:t.dataset.tab,sel:t.getAttribute('aria-selected'),controls:t.getAttribute('aria-controls'),label:t.getAttribute('aria-label')||''})),
    panel:{role:document.querySelector('#file-tab')?.getAttribute('role'),labelledby:document.querySelector('#file-tab')?.getAttribute('aria-labelledby')},
    groups:[...bar.querySelectorAll('.ftb-group')].map(g=>{
     const btn=g.querySelector('.ftb-group-btn'),menu=g.querySelector('.ftb-menu');
     return {id:g.dataset.group,haspopup:btn.getAttribute('aria-haspopup'),expanded:btn.getAttribute('aria-expanded'),controls:btn.getAttribute('aria-controls'),
      menuId:menu.id,menuRole:menu.getAttribute('role'),
      items:[...menu.querySelectorAll('[role="menuitemradio"]')].map(i=>({tab:i.dataset.tab,checked:i.getAttribute('aria-checked'),controls:i.getAttribute('aria-controls')}))};
    }),
    tools:{focus:Boolean(bar.querySelector('[data-file-focus]')),customize:Boolean(bar.querySelector('[data-order-file-tabs]')),all:Boolean(bar.querySelector('[data-tabs-menu]'))}
   };
  });
  assert.equal(a11y.tablist,'tablist','صف التبويبات tablist');
  assert.equal(a11y.tabs.length,4,'4 تبويبات أساسية بدور tab');
  for(const t of a11y.tabs){
   assert.equal(t.controls,'file-tab',`${t.tab} مرتبط بلوحة المحتوى`);
   assert.ok(t.label.length>1,`${t.tab} له اسم مقروء`);
  }
  assert.equal(a11y.panel.role,'tabpanel','لوحة المحتوى tabpanel');
  assert.equal(a11y.panel.labelledby,'file-tabs-nav','اللوحة مرتبطة بشريط التبويبات');
  assert.equal(a11y.groups.length,4,'4 مجموعات منسدلة');
  const allItems=[];
  for(const g of a11y.groups){
   assert.equal(g.haspopup,'menu',`${g.id} يعلن أنه قائمة`);
   assert.equal(g.expanded,'false','مغلقة ابتداءً');
   assert.ok(g.menuId&&g.menuId===g.controls,`${g.id} مرتبط بقائمته`);
   assert.equal(g.menuRole,'menu',`${g.id} قائمة بدور menu`);
   assert.ok(g.items.length>=2,`${g.id} يحتوي أقسامه`);
   for(const i of g.items){assert.equal(i.controls,'file-tab',`${i.tab} مرتبط بلوحة المحتوى`);allItems.push(i.tab)}
  }
  assert.equal(new Set(allItems).size,11,'11 قسمًا داخل القوائم (15 - 4 أساسية)');
  assert.equal(a11y.groups.flatMap(g=>g.items).filter(i=>i.checked==='true').length,0,'لا عنصر مُعلَّم كنشط والقسم الأساسي هو المفتوح');
  assert.ok(a11y.tools.focus&&a11y.tools.customize&&a11y.tools.all,'أدوات العرض الثلاثة في الشريط');
  // لوحة المفاتيح: Tab يصل إلى كل التبويبات الأساسية وأزرار المجموعات، وEnter يفتح القائمة
  await page.evaluate(()=>document.querySelector('.file-tabs-bar [data-tab="summary"]')?.focus());
  const reached=[];
  for(let i=0;i<10;i++){
   await page.keyboard.press('Tab');
   const info=await page.evaluate(()=>{const a=document.activeElement;return {tab:a?.dataset?.tab||'',group:a?.dataset?.tabGroup||'',tool:a?.dataset?.tabsMenu!==undefined||a?.dataset?.orderFileTabs!==undefined||a?.dataset?.fileFocus!==undefined}});
   if(info.tab)reached.push(info.tab);
   if(info.tool)reached.push('tool');
  }
  for(const t of ['hearings','procedures','judicial'])assert.ok(reached.includes(t),`لوحة المفاتيح تصل إلى تبويب ${t}`);
  assert.ok(reached.includes('tool'),'لوحة المفاتيح تصل إلى أدوات العرض');
  const groupBtn=page.locator('.ftb-group[data-group="gFollow"] .ftb-group-btn');
  await groupBtn.focus();
  await page.keyboard.press('Enter');await page.waitForTimeout(300);
  assert.equal(await page.locator('.ftb-group[data-group="gFollow"] .ftb-menu').isVisible(),true,'Enter يفتح قائمة المجموعة');
  // كل أقسام القائمة قابلة للوصول بالأسهم وتُفتح بـEnter
  const menuItems=await page.locator('.ftb-group[data-group="gFollow"] .ftb-menu [role="menuitemradio"]').evaluateAll(ns=>ns.map(n=>n.dataset.tab));
  assert.deepEqual(menuItems,['relations','timeline','activity'],'أقسام قائمة الارتباطات والمتابعة');
  let idx=0;
  for(const t of menuItems){
   await page.evaluate(i=>{const items=[...document.querySelectorAll('.ftb-group[data-group="gFollow"] .ftb-menu [role="menuitemradio"]')];items[i]?.focus()},idx);
   await page.keyboard.press('Enter');await page.waitForTimeout(700);
   assert.ok(await activeTabCheck(t),`Enter يفتح القسم ${t} من القائمة`);
   await groupBtn.focus();
   await page.keyboard.press('Enter');await page.waitForTimeout(250);
   idx+=1;
  }
  await page.keyboard.press('Escape');await page.waitForTimeout(200);
 });

 // (25) الروابط المباشرة: ?tab= لقسم أساسي ولقسم داخل قائمة منسدلة
 await verify('25) رابط مباشر ?tab= يفتح القسم الصحيح حتى داخل قائمة منسدلة ويُعلّم مجموعته',async()=>{
  // قسم أساسي
  await go(`file:${fx.file.id}?tab=procedures`);
  await page.waitForTimeout(1200);
  assert.ok(await activeTabCheck('procedures'),'?tab=procedures يفتح تبويب الأعمال الإدارية');
  // قسم داخل قائمة «البيانات والمراجع»
  await go(`file:${fx.file.id}?tab=notes`);
  await page.waitForTimeout(1200);
  assert.equal((await page.locator('[data-tab-shell-title]').textContent()).trim(),'الملاحظات','?tab=notes يفتح قسم الملاحظات');
  assert.equal(await page.locator('.ftb-group[data-group="gRecords"]').getAttribute('class').then(c=>c.includes('is-active')),true,'مجموعة القسم المفتوح مميزة');
  assert.equal((await page.locator('.ftb-group[data-group="gRecords"] .ftb-active-name').textContent()).trim(),'الملاحظات','اسم القسم المفتوح ظاهر في الزر');
  const item=page.locator('.ftb-group[data-group="gRecords"] [data-tab="notes"]');
  assert.equal(await item.getAttribute('aria-checked'),'true','العنصر داخل القائمة مُعلَّم كنشط');
  // قسم من قائمة أخرى (للتحقق أن التعليم ينتقل بين المجموعات)
  await go(`file:${fx.file.id}?tab=relations`);
  await page.waitForTimeout(1200);
  assert.equal(await page.locator('.ftb-group[data-group="gFollow"]').getAttribute('class').then(c=>c.includes('is-active')),true,'مجموعة الارتباطات نشطة');
  assert.equal(await page.locator('.ftb-group[data-group="gRecords"]').getAttribute('class').then(c=>c.includes('is-active')),false,'المجموعة السابقة فقدت التعليل');
  assert.equal(await page.locator('.ftb-group[data-group="gFollow"] [data-tab="relations"]').getAttribute('aria-checked'),'true');
 });

 // (26) الطباعة: الشريط غير ملتصق والمحتوى كامل بلا قوائم مفتوحة عابرة
 await verify('26) وضع الطباعة: الشريط يتحول إلى static ولا تظهر قائمة مفتوحة',async()=>{
  await go(`file:${fx.file.id}`);
  await page.evaluate(()=>document.querySelector('.file-tabs-bar [data-tab="summary"]')?.click());
  await page.waitForTimeout(800);
  await page.emulateMedia({media:'print'});
  await page.waitForTimeout(400);
  const printState=await page.evaluate(()=>{
   const bar=document.querySelector('.file-tabs-bar');
   const id=document.querySelector('.file-id');
   return {pos:getComputedStyle(bar).position,visible:Boolean(id&&id.getBoundingClientRect().height),
    shellTitle:(document.querySelector('[data-tab-shell-title]')?.textContent||'').trim(),
    tables:[...document.querySelectorAll('#file-tab table')].length};
  });
  assert.equal(printState.pos,'static','الشريط لا يلتصق في الطباعة');
  assert.equal(printState.visible,true,'رأس الهوية يُطبع');
  assert.equal(printState.shellTitle,'نظرة عامة','عنوان القسم المطبوع');
  await page.emulateMedia({media:'screen'});
  await page.waitForTimeout(300);
  const back=await page.evaluate(()=>getComputedStyle(document.querySelector('.file-tabs-bar')).position);
  assert.equal(back,'sticky','يعود الالتصاق بعد الطباعة');
 });

 // (27) «⚙ تخصيص الصفحة» من الشريط + عدم تكرار المستمعات بعد تنقل متكرر
 await verify('27) تخصيص الصفحة من الشريط يعمل، والقوائم لا تتكرر مستمعاتها بعد التنقل المتكرر',async()=>{
  await go(`file:${fx.file.id}`);
  await page.locator('[data-order-file-tabs]').click();
  await page.waitForTimeout(600);
  const rows=page.locator('#modal-root .pl-row');
  await rows.first().waitFor({state:'visible',timeout:8000});
  assert.equal(await rows.count(),15,'كل الأقسام داخل نافذة التخصيص');
  // الأسماء تحمل أيقونة القسم في بدايتها — نقارن النص بلا أيقونة
  const names=(await rows.locator('.pl-name').allTextContents()).map(x=>x.replace(/^[^\p{L}]+/u,'').trim());
  assert.deepEqual(names.slice(0,4),['نظرة عامة','الجلسات','الأعمال الإدارية','المراحل والإجراءات القضائية'],'ترتيب الأقسام الافتراضي');
  await page.locator('#modal-root [data-pl-done]').click();
  await page.waitForTimeout(400);
  assert.equal(await page.locator('#modal-root .pl-row').count(),0,'النافذة أُغلقت');
  // تنقل متكرر: قائمة واحدة لكل مجموعة ولا فتح مزدوج
  for(let i=0;i<3;i++){
   await page.evaluate(()=>document.querySelector('.ftb-group[data-group="gParties"] .ftb-group-btn').click());
   await page.waitForTimeout(120);
   await page.keyboard.press('Escape');
   await page.waitForTimeout(120);
  }
  await page.locator('.ftb-group[data-group="gParties"] .ftb-group-btn').click();
  await page.waitForTimeout(250);
  assert.equal(await page.locator('.ftb-menu:visible').count(),1,'قائمة واحدة مفتوحة فقط');
  assert.equal(await page.locator('.ftb-menu').count(),5,'5 قوائم: 4 مجموعات + كل الأقسام — بلا تكرار للعناصر');
  await page.locator('.ftb-group[data-group="gParties"] [data-tab="parties"]').click();
  await page.waitForTimeout(800);
  assert.equal((await page.locator('[data-tab-shell-title]').textContent()).trim(),'الأطراف والصفات','الاختيار يفتح القسم مرة واحدة');
  assert.equal(await page.locator('#file-tab .party-toolbar').count(),1,'محتوى القسم مرة واحدة بلا تكرار');
 });

 // (21) الملخص التنفيذي: كل عنصر ملخص مرتبط بمصدره الأصلي وبلا بيانات مُختلقة
 await verify('21) الملخص التنفيذي: روابط إلى السجلات الأصلية وحالات فارغة صادقة',async()=>{
  await go(`file:${fx.file.id}`);
  // نظرة عامة افتراضيًا للقياس (لا يهم تبويب الجلسة السابقة)
  await page.evaluate(()=>document.querySelector('.file-tabs-bar [data-tab="summary"]')?.click());
  await page.waitForTimeout(900);
  const fc=page.locator('.fx-grid .fx-card');
  assert.equal(await fc.count(),4,'أربع بطاقات ملخص (جلسة قادمة/آخر عمل/المرحلة الحالية/الجلسة السابقة)');
  assert.ok((await fc.nth(0).textContent()).includes('أقرب جلسة قادمة'));
  assert.ok((await fc.nth(1).textContent()).includes('آخر عمل إداري مسجل'));
  assert.ok((await fc.nth(2).textContent()).includes('المرحلة الحالية'));
  assert.ok((await fc.nth(3).textContent()).includes('الجلسة السابقة'));
  // «عرض الجلسة» يفتح سجل الجلسة الأصلي نفسه
  await fc.nth(0).locator('[data-open]').click();await page.waitForTimeout(1200);
  const hearingRoute=String(await page.evaluate(()=>window.__LAW_OFFICE_APP__.route));
  assert.ok(hearingRoute.startsWith('rec:hearings:'),`«عرض الجلسة» يفتح سجل الجلسة: ${hearingRoute}`);
  await go(`file:${fx.file.id}`);
  await page.evaluate(()=>document.querySelector('.file-tabs-bar [data-tab="summary"]')?.click());
  await page.waitForTimeout(900);
  // «عرض العمل» يفتح سجل العمل الإداري الأصلي
  await page.locator('.fx-grid .fx-card').nth(1).locator('[data-open]').click();await page.waitForTimeout(1200);
  const procRoute=String(await page.evaluate(()=>window.__LAW_OFFICE_APP__.route));
  assert.ok(procRoute.startsWith('rec:procedures:'),`«عرض العمل» يفتح سجل العمل: ${procRoute}`);
  await go(`file:${fx.file.id}`);
  await page.evaluate(()=>document.querySelector('.file-tabs-bar [data-tab="summary"]')?.click());
  await page.waitForTimeout(900);
  // «فتح بيانات المرحلة» يفتح سجل المرحلة الأصلي
  await page.locator('.fx-grid .fx-card').nth(2).locator('[data-open-case]').click();await page.waitForTimeout(1200);
  assert.ok(String(await page.evaluate(()=>window.__LAW_OFFICE_APP__.route)).startsWith(`case:${fx.stages.s2.id}`),'«فتح بيانات المرحلة» يفتح المرحلة الحالية');
  await go(`file:${fx.file.id}`);
  // روابط التبويبات تنقل فعلًا للقسم المعني
  await page.locator('.fx-grid .fx-card').nth(1).locator('[data-tab-jump="procedures"]').click();await page.waitForTimeout(900);
  assert.ok(await activeTabCheck('procedures'),'«الأعمال» تنقل إلى تبويب الأعمال الإدارية');
  await go(`file:${fx.file.id}`);
  // الملف بلا بيانات: حالات فارغة صادقة بلا تواريخ أو أرقام مُختلقة
  await go(`file:${fx.plain.id}`);
  const emptyCards=await page.locator('.fx-grid .fx-card').allTextContents();
  assert.ok(emptyCards[0].includes('لا توجد جلسات مسجلة'),'حالة فارغة للجلسات');
  assert.ok(emptyCards[1].includes('لا توجد أعمال إدارية مسجلة'),'حالة فارغة للأعمال');
  assert.ok(emptyCards[2].includes('لا توجد مرحلة أو رقم قضائي مسجل'),'حالة فارغة للمراحل');
  assert.ok(!/\d{2}\/\d{2}\/\d{4}/.test(emptyCards.slice(0,3).join(' ')),'لا تواريخ مُختلقة في الحالات الفارغة');
  await go(`file:${fx.file.id}`);
 });

 // (22) منع تكرار البيانات: لا نسخة ثانية من الجلسات/الأعمال داخل «نظرة عامة»
 await verify('22) «نظرة عامة» لوحة متابعة: مؤشرات مكررة القديمة أُزيلت والملخصات مرتبطة بالمصادر',async()=>{
  // نظرة عامة افتراضيًا (بلا تفضيل تبويب سابق يحجب القياس)
  await go(`file:${fx.file.id}`);
  await page.evaluate(()=>document.querySelector('.file-tabs-bar [data-tab="summary"]')?.click());
  await page.waitForTimeout(900);
  const tab=page.locator('#file-tab');
  assert.equal(await tab.locator('.fp-metrics').count(),0,'لا شريط مؤشرات مكرر فوق بطاقات الملخص');
  assert.equal(await tab.locator('.file-hearing-cards').count(),0,'لا قائمة جلسات ثانية داخل الملخص (الجلسات في تبويبها)');
  assert.equal(await tab.locator('#file-tab .dg').count(),0,'لا جداول كاملة مكررة داخل نظرة عامة');
  assert.equal(await tab.locator('.cp-fc').count(),1,'قمرة واحدة للخطوة التالية');
  // بيانات الجلسة تُقرأ من سجلها: لا نماذج تحرير داخل الملخص التنفيذي
  assert.equal(await tab.locator('.fx-grid input,.fx-grid select,.fx-grid textarea').count(),0,'بطاقات الملخص للقراءة والتنقل فقط — بلا حقول تحرير');
  //كل قيمة معروضة في الملخص التنفيذي موجودة فعلًا في السجل الأصلي للجلسة
  const hearingDate=(await page.locator('.fx-grid .fx-card').nth(0).locator('.fx-title').textContent()).trim().split(' ')[0];
  const matches=await page.evaluate(async({fileId,date})=>{
   const app=window.__LAW_OFFICE_APP__;
   const res=await app.office.r.hearings.byIndex('fileId',fileId,200);
   const fmt=v=>{const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v||'').slice(0,10));return m?`${m[3]}/${m[2]}/${m[1]}`:''};
   return (res||[]).filter(h=>fmt(h.hearingDate)===date).length;
  },{fileId:fx.file.id,date:hearingDate});
  assert.ok(matches>=1,`تاريخ الجلسة المعروض (${hearingDate}) موجود في سجل الجلسات الأصلي`);
 });

 // لقطات مرجعية
 await go(`file:${fx.file.id}`);
 await page.screenshot({path:path.join(artifactDir,'overview.png'),fullPage:true});
 await page.evaluate(k=>document.querySelector(`.file-tabs-bar [data-tab="${k}"]`).click(),'hearings');await page.waitForTimeout(900);
 await page.screenshot({path:path.join(artifactDir,'hearings.png'),fullPage:true});

 report.status='PASS';
 await fs.writeFile(path.join(artifactDir,'report.json'),JSON.stringify(report,null,2)+'\n');
 console.log(`PASS — file workspace checks: ${report.checks.length} verified, ${report.errors.length} page errors.`);
 if(report.errors.length)console.log(report.errors.join('\n'));
}catch(error){
 report.status='FAIL';report.failure=String(error?.stack||error);
 await fs.writeFile(path.join(artifactDir,'report.json'),JSON.stringify(report,null,2)+'\n');
 console.error('FAIL —',error);
 process.exitCode=1;
}finally{
 await context.close().catch(()=>{});
 await browser.close().catch(()=>{});
}
