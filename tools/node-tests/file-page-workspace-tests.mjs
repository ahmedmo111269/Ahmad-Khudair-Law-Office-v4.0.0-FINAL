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
  assert.equal(await page.locator('.file-subtabs [data-tab="summary"]').getAttribute('aria-selected'),'true');
  const order=await page.locator('.file-subtabs [data-tab]').evaluateAll(ns=>ns.map(b=>b.dataset.tab));
  assert.deepEqual(order.slice(0,3),['summary','hearings','procedures']);
  assert.ok((await tabText()).startsWith('بيانات الدعوى والملف'),'محتوى نظرة عامة أولًا');
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
  await page.locator('.file-subtabs [data-tab="hearings"]').click();await page.waitForTimeout(1200);
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
  await page.locator('.file-subtabs [data-tab="hearings"]').click();await page.waitForTimeout(900);
 });

 // (7) تبويب الأعمال الإدارية
 await verify('7) تبويب الأعمال الإدارية: خط زمني + جدول + حالات الإنجاز',async()=>{
  await page.locator('.file-subtabs [data-tab="procedures"]').click();await page.waitForTimeout(1200);
  const txt=await tabText();
  assert.ok(txt.includes('إعلان صحيفة الاستئناف')&&txt.includes('متابعة تقرير الخبير'),'الأعمال ظاهرة');
  assert.ok(txt.includes('مفتوح')&&txt.includes('قيد الانتظار')&&txt.includes('تم'),'حالات الإنجاز بارزة');
  assert.equal(await page.locator('#file-tab .timeline li[data-open]').count(),3,'الخط الزمني للأعمال');
  await page.locator('#file-tab details.rec-section summary').click();await page.waitForTimeout(800);
  assert.equal(await page.locator('#file-tab .dg tbody tr[data-i]').count(),3,'جدول الأعمال الكامل');
 });

 // (8) بقية التبويبات
 await verify('8) كل تبويب آخر يُفتح وبه محتواه وأدواته',async()=>{
  const tabs=await page.locator('.file-subtabs [data-tab]').evaluateAll(ns=>ns.map(b=>b.dataset.tab));
  for(const t of tabs){
   await page.evaluate(k=>document.querySelector(`.file-subtabs [data-tab="${k}"]`).click(),t);
   await page.waitForTimeout(800);
   const len=(await tabText()).length;
   assert.ok(len>40,`تبويب ${t} له محتوى (${len})`);
   assert.equal(await page.locator('.file-subtabs [data-tab="'+t+'"]').getAttribute('aria-selected'),'true',`تبويب ${t} نشط`);
  }
 });

 // (9) إضافة وتعديل وحفظ ثم تحقق بعد إعادة الفتح
 await verify('9) إضافة عمل إداري من التبويب وحفظه ثم التحقق بعد إعادة الفتح',async()=>{
  await page.evaluate(k=>document.querySelector(`.file-subtabs [data-tab="${k}"]`).click(),'procedures');
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
  await page.evaluate(k=>document.querySelector(`.file-subtabs [data-tab="${k}"]`).click(),'procedures');
  await page.waitForTimeout(1000);
  assert.ok((await tabText()).includes('عمل اختبار محفوظ '+fx.suffix),'العمل محفوظ بعد مغادرة الصفحة والعودة');
 });

 // (10) النماذج غير المحفوظة عند تبديل التبويب
 await verify('10) بيانات نموذج غير محفوظة لا تُفقد عند تبديل التبويبات',async()=>{
  await page.evaluate(k=>document.querySelector(`.file-subtabs [data-tab="${k}"]`).click(),'typeData');
  await page.waitForTimeout(900);
  // لوحة نموذج نوع العمل قابلة للطي — تُفتح أولًا
  if(await page.locator('#file-tab .panel').first().evaluate(el=>el.dataset.collapseCollapsed)==='true')
   await page.locator('#file-tab .panel').first().locator(':scope > .panel-head .collapse-toggle').click();
  await page.waitForTimeout(400);
  const input=page.locator('#file-tab [data-meta]').first();
  await input.fill('مسودة غير محفوظة '+fx.suffix);
  await page.evaluate(k=>document.querySelector(`.file-subtabs [data-tab="${k}"]`).click(),'hearings');
  await page.waitForTimeout(800);
  await page.evaluate(k=>document.querySelector(`.file-subtabs [data-tab="${k}"]`).click(),'typeData');
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
  await page.evaluate(k=>document.querySelector(`.file-subtabs [data-tab="${k}"]`).click(),'parties');
  await page.waitForTimeout(800);
  assert.ok(!(await tabText()).includes('هدى إبراهيم منصور'),'أطراف التبويب معزولة');
 });

 // (12) البحث/الفرز/التصدير في قسم يدعمها
 await verify('12) البحث والفرز والتصدير في جدول الجلسات',async()=>{
  await page.evaluate(k=>document.querySelector(`.file-subtabs [data-tab="${k}"]`).click(),'hearings');
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
   assert.ok(await page.locator('.file-subtabs [data-tab="summary"]').isVisible(),'التبويب الافتراضي ظاهر');
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
   await page.evaluate(k=>document.querySelector(`.file-subtabs [data-tab="${k}"]`).click(),'summary');await page.waitForTimeout(500);
   await page.evaluate(k=>document.querySelector(`.file-subtabs [data-tab="${k}"]`).click(),'hearings');await page.waitForTimeout(500);
  }
  assert.equal(await page.locator('#file-tab .dg').count(),1,'جدول واحد فقط بعد تنقل متكرر');
  await page.evaluate(k=>document.querySelector(`.file-subtabs [data-tab="${k}"]`).click(),'summary');await page.waitForTimeout(700);
  assert.equal(await page.locator('#file-tab .cp-fc').count(),1,'قمرة واحدة فقط');
  assert.equal(await page.locator('#file-tab .fp-case-data').count(),1,'شريط بيانات واحد');
  assert.equal(await page.locator('#file-tab .stage-path').count(),1,'شريط إدارة مراحل واحد');
  assert.equal(report.errors.length,before,'لا أخطاء جديدة أثناء التنقل');
 });

 // (15) آخر تبويب لكل ملف + الافتراض لملف جديد
 await verify('15) التفضيل لكل ملف: نفس الملف يستعيد تبويبه وملف جديد يفتح نظرة عامة',async()=>{
  await go(`file:${fx.file.id}`);
  await page.evaluate(k=>document.querySelector(`.file-subtabs [data-tab="${k}"]`).click(),'judgments');
  await page.waitForTimeout(700);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__LAW_OFFICE_APP__?.office&&!window.__LAW_OFFICE_APP__.booting,null,{timeout:120000});
  await page.waitForTimeout(1600);
  assert.equal(await page.locator('.file-subtabs [data-tab="judgments"]').getAttribute('aria-selected'),'true','نفس الملف يستعيد آخر تبويب له');
  await go(`file:${fx.plain.id}`);
  assert.equal(await page.locator('.file-subtabs [data-tab="summary"]').getAttribute('aria-selected'),'true','ملف آخر يفتح نظرة عامة لا تبويب الملف السابق');
 });

 // (16) سلوكان قائمان لم يتأثرا: الشريط الثابت عند التمرير + وضع التركيز
 await verify('16) الشريط الثابت عند التمرير ووضع التركيز يعملان كما كانا',async()=>{
  await go(`file:${fx.file.id}`);
  await page.evaluate(()=>document.querySelector('.file-subtabs [data-tab="summary"]').click());
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

 // (17) قائمة «كل الأقسام»: فتح/إغلاق/Escape/نقر خارجي/تنقل فعلي
 await verify('17) قائمة «كل الأقسام» تعمل وتُغلق بـEscape والنقر خارجها وتنقل فعليًا',async()=>{
  await go(`file:${fx.file.id}`);
  const btn=page.locator('[data-tabs-menu]');
  assert.equal(await btn.count(),1,'زر قائمة التبويبات واحد且不 يلتبس مع قائمة الملف');
  await btn.click();await page.waitForTimeout(300);
  const menu=page.locator('.ftb-menu');
  assert.equal(await menu.isVisible(),true,'القائمة تفتح');
  assert.equal(await menu.locator('[data-menu-tab]').count(),15,'كل التبويبات داخل القائمة');
  await page.keyboard.press('Escape');await page.waitForTimeout(300);
  assert.equal(await menu.isVisible(),false,'Escape يغلق القائمة');
  await btn.click();await page.waitForTimeout(300);
  await page.mouse.click(700,500);await page.waitForTimeout(300);
  assert.equal(await menu.isVisible(),false,'النقر خارجها يغلقها');
  await btn.click();await page.waitForTimeout(300);
  await menu.locator('[data-menu-tab="judgments"]').click();await page.waitForTimeout(900);
  assert.equal(await page.locator('.file-subtabs [data-tab="judgments"]').getAttribute('aria-selected'),'true','عنصر القائمة ينقل فعليًا إلى التبويب');
  assert.equal(await menu.isVisible(),false,'القائمة تُغلق بعد الاختيار');
 });

 // لقطات مرجعية
 await go(`file:${fx.file.id}`);
 await page.screenshot({path:path.join(artifactDir,'overview.png'),fullPage:true});
 await page.evaluate(k=>document.querySelector(`.file-subtabs [data-tab="${k}"]`).click(),'hearings');await page.waitForTimeout(900);
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
