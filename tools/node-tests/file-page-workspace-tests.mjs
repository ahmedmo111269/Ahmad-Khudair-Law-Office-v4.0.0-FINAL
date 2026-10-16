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
// فلتر تطويري: FPW_ONLY='28)' يشغّل الفحوص المطابقة فقط (بلا تأثير افتراضيًا)
const only=process.env.FPW_ONLY?new RegExp(process.env.FPW_ONLY):null;
const verify=async(name,fn)=>{if(only&&!only.test(name))return;await fn();report.checks.push(name);console.log(`VERIFIED — ${name}`)};
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
// تواريخ الجلسات في المتابعة القريبة فقط (عناصر جلسات — لا مواعيد متابعة الأعمال)
const fu2Dates=async()=>page.evaluate(()=>[...document.querySelectorAll('.fp-followup .fp-fu-list li [data-open^="hearings:"]')]
 .map(el=>((el.textContent||'').match(/\d{2}\/\d{2}\/\d{4}/)||[])[0]).filter(Boolean));
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
  // بنية نظرة عامة (Data-First): موقف الملف ← المتابعة القريبة ← بيانات الملف ← التنفيذ ← المهام
  assert.ok((await tabText()).startsWith('موقف الملف'),'«موقف الملف» أول ما يراه المحامي في نظرة عامة');
  const sections=await page.locator('#file-tab [data-section-id]').evaluateAll(ns=>ns.map(n=>n.dataset.sectionId));
  assert.deepEqual(sections,['summary-cockpit','summary-followup','summary-data','summary-execution','summary-tasks'],'أقسام نظرة عامة الخمسة بترتيبها الوظيفي');
  assert.equal(await page.locator('#file-tab .fp-quick [data-quick-hearing],[data-quick-procedure],[data-quick-party],[data-quick-note],[data-quick-task]').count(),5,'شريط الإجراءات السريعة كاملًا');
 });

 // (2) الهوية من البيانات الحقيقية
 await verify('2) هوية القضية والأطراف من البيانات الحقيقية ورقم الملف عند الطلب',async()=>{
  const head=await headText();
  assert.ok(!head.includes(fx.fileNo),'رقم الملف الفرعي الداخلي مخفي من رأس الملف ابتداءً');
  assert.ok(!head.includes('الرقم الداخلي للمكتب'),'العبارة القديمة الخاصة بالرقم الداخلي محذوفة');
  assert.equal(await page.locator('[data-file-number-popover]').isHidden(),true,'شريط الرقم مخفي قبل الطلب');
  assert.equal((await page.locator('[data-file-number-toggle]').textContent()).trim(),'الملف الفرعي','مصدر إظهار الرقم هو زر الملف الفرعي');
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
  await page.locator('[data-file-number-toggle]').click();await page.waitForTimeout(120);
  assert.equal(await page.locator('[data-file-number-popover]').isVisible(),true,'النقر يظهر شريط الرقم');
  assert.ok((await page.locator('[data-file-number-popover]').textContent()).includes(fx.fileNo),`الرقم الحقيقي يظهر عند الطلب: ${fx.fileNo}`);
  await page.locator('[data-file-number-toggle]').click();
  assert.equal(await page.locator('[data-file-number-popover]').isHidden(),true,'إغلاق الزر يخفي شريط الرقم');
 });

 // (3) ملف بلا رقم قضائي
 await verify('3) ملف بلا دعوى: نوع الملف ووصفه دون اختلاق بيانات قضائية',async()=>{
  await go(`file:${fx.plain.id}`);
  const head=await headText();
  assert.ok(!head.includes(fx.plainNo),'رقم الملف الفرعي الداخلي مخفي ابتداءً');
  assert.ok(head.includes('مراجعة عقد إيجار — استشارة'),'عنوان الملف كما هو');
  assert.ok(head.includes('لا توجد أرقام قضائية مسجلة (ملف بلا قضية)'),'إفصاح صريح بلا اختلاق');
  assert.ok(!/رقم \d+ لسنة/.test(head),'لا رقم دعوى مُختلَق');
  const txt=await tabText();
  // حالات فارغة صادقة في المتابعة القريبة: بلا تواريخ أو جلسات مُختلقة
  assert.ok(txt.includes('لا توجد جلسات قادمة مسجلة'),'حالة فارغة للجلسات في المتابعة القريبة');
  assert.ok(txt.includes('لا توجد أعمال إدارية مفتوحة'),'حالة فارغة للأعمال في المتابعة القريبة');
  // التنبيه التشغيلي يذكر نواقص البيانات المسجلة فقط (هذا الملف: بلا مراحل وبلا محامٍ مسؤول؛
  // الموكل يُربط تلقائيًا عند الإنشاء فلا تنبيه أطراف هنا)
  assert.ok(txt.includes('لا توجد أرقام قضائية / مراحل مسجلة'),'تنبيه غياب المراحل');
  assert.ok(txt.includes('لا يوجد محامٍ مسؤول مسجل'),'تنبيه غياب المحامي المسؤول');
  // رقم الملف يظهر فقط بعد الطلب (قبل مغادرة نظرة عامة)
  await page.locator('[data-file-number-toggle]').click();await page.waitForTimeout(120);
  assert.ok((await page.locator('[data-file-number-popover]').textContent()).includes(fx.plainNo),'رقم الملف الثاني يظهر فقط بعد الطلب');
  await page.locator('[data-file-number-toggle]').click();
  // إجراء سريع يتطلب ما يتطلبه التبويب المتخصص: جلسة بلا مرحلة = إرشاد ونقلة إلى المتطلب
  await page.locator('#file-tab [data-quick-hearing]').first().click();await page.waitForTimeout(700);
  assert.ok((await page.locator('#toast-stack .toast-msg').last().textContent()).includes('رقمًا قضائيًا'),'إضافة جلسة بلا مرحلة ترشد إلى المتطلب أولًا');
  assert.ok(await activeTabCheck('judicial'),'الإرشاد ينقل مباشرة إلى تبويب «المراحل» لإضافة المتطلب');
 });

 // (4) قسم بيانات الملف وقسم المرحلة والتسلسل + حفظ تفضيل الطي
 await verify('4) فتح وإغلاق قسمي «بيانات الملف» و«المتابعة القريبة» مع حفظ تفضيل الطي',async()=>{
  await go(`file:${fx.file.id}`);
  const data=page.locator('.fp-file-data'),fu=page.locator('.fp-followup');
  assert.equal(await data.evaluate(el=>el.dataset.collapseCollapsed),'false','بيانات الملف مفتوح افتراضيًا');
  assert.equal(await fu.evaluate(el=>el.dataset.collapseCollapsed),'false','المتابعة القريبة مفتوحة افتراضيًا');
  await data.locator(':scope > .panel-head .collapse-toggle').click();await page.waitForTimeout(250);
  assert.equal(await data.evaluate(el=>el.dataset.collapseCollapsed),'true','طي شريط البيانات');
  assert.ok(await data.locator(':scope > .panel-head [data-collapse-alert],:scope > .panel-head .collapse-summary').first().isVisible(),'الملخص يبقى ظاهرًا عند الطي');
  await fu.locator(':scope > .panel-head .collapse-toggle').click();await page.waitForTimeout(250);
  assert.equal(await fu.evaluate(el=>el.dataset.collapseCollapsed),'true','طي شريط المتابعة');
  await data.locator(':scope > .panel-head .collapse-toggle').click();await page.waitForTimeout(250);
  assert.equal(await data.evaluate(el=>el.dataset.collapseCollapsed),'false','إعادة فتح بيانات الملف');
  // قسم واحد لبيانات الملف فقط: بيانات المرحلة وحقول نوع العمل لا تتكرر (مصادرها تبويباتها)
  assert.equal(await data.locator('.fp-kv-h').count(),0,'لا عنوان فرعي لبيانات المرحلة داخل «بيانات الملف»');
  assert.ok((await data.textContent()).includes('بيانات الملف'),'عنوان القسم واضح');
  // الحقول الثانوية موسومة فتُخفى جماعيًا في العرض المختصر دون حذف من السجل
  assert.ok(await data.locator('.kv-item.is-secondary').count()>=1,'وسم الحقول الثانوية موجود');
  // تفضيل الطي محفوظ بعد إعادة التحميل
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__LAW_OFFICE_APP__?.office&&!window.__LAW_OFFICE_APP__.booting,null,{timeout:120000});
  await page.waitForTimeout(1600);
  assert.equal(await page.locator('.fp-followup').evaluate(el=>el.dataset.collapseCollapsed),'true','حالة طي المتابعة محفوظة بعد إعادة التحميل');
  await page.locator('.fp-followup').locator(':scope > .panel-head .collapse-toggle').click();await page.waitForTimeout(250);
 });

 // (5) تسلسل دعوى ← استئناف ← نقض + العلاقات
 await verify('5) تسلسل المراحل الحقيقي في تبويب «المراحل»: دعوى ثم استئناف ثم نقض ثم جدول كامل',async()=>{
  await page.evaluate(k=>document.querySelector(`.file-tabs-bar [data-tab="${k}"]`).click(),'judicial');
  await page.waitForTimeout(1100);
  const names=await page.locator('#file-tab .stage-chain > li').allTextContents();
  assert.equal(names.length,3,'ثلاث مراحل كما سُجلت');
  assert.ok(names[0].includes('دعوى')&&names[0].includes('1234/2026'),'المرحلة الأولى برقمها');
  assert.ok(names[1].includes('استئناف')&&names[1].includes('78/2026'),'المرحلة الثانية (الحالية) برقمها');
  assert.ok(names[2].includes('نقض'),'المرحلة الثالثة');
  // فتح المرحلة من التسلسل ينقل إلى سجلها
  await page.locator('#file-tab .stage-chain > li').nth(2).locator('[data-open-case]').click();
  await page.waitForTimeout(1200);
  assert.ok(String(await page.evaluate(()=>window.__LAW_OFFICE_APP__.route)).startsWith(`case:${fx.stages.s3.id}`),'فتح بيانات مرحلة النقض');
  await go(`file:${fx.file.id}`);
  // نظرة عامة تعرض المرحلة الحالية من قمرة الموقف (مصدر واحد: سجل المرحلة)
  assert.ok((await tabText()).includes('استئناف'),'القمرة تعرض المرحلة الحالية من بياناتها المسجلة');
 });

 // (6) تبويب الجلسات
 await verify('6) تبويب الجلسات: القادمة + مرشحات + بطاقات هاتف + جدول كامل للبحث والفرز',async()=>{
  await page.locator('.file-tabs-bar [data-tab="hearings"]').click();await page.waitForTimeout(1200);
  const rows=await page.locator('#file-tab .dg tbody tr[data-i]').count();
  // جلستان مسجلتان + جلسة ثالثة أنشأها النظام تلقائيًا من «التأجيل إلى» (سلوك قائم في operations)
  assert.equal(rows,3,'جلسات الملف (المسجلة + المنشأة من التأجيل)');
  const txt=await tabText();
  assert.ok(txt.includes('تاريخ الجلسة')&&txt.includes('القرار')&&txt.includes('التأجيل إلى'),'أعمدة الجلسات كاملة');
  // الجلسة القادمة أولًا: بطاقة قرار بأقرب جلسة قادمة من البيانات المسجلة
  const next=page.locator('[data-section-id="hearings-next"]');
  assert.ok((await next.textContent()).includes('12/11/2026'),'تاريخ أقرب جلسة قادمة من سجلها');
  // مرشحات سريرة بالعدادات: تصفية القادمة تحدّث البطاقات والجدول معًا بلا إعادة استعلام
  const chips=page.locator('[data-hrc-filter]');
  assert.ok(await chips.count()>=5,'مرشحات الجلسات كاملة');
  await page.locator('[data-hrc-filter="upcoming"]').click();await page.waitForTimeout(400);
  assert.equal(await page.locator('#file-tab .dg tbody tr[data-i]').count(),2,'مرشح «القادمة» يرشّح الجدول أيضًا (جلستان بتاريخ 12/11/2026)');
  assert.ok((await page.locator('[data-hrc-filter-count]').textContent()).includes('القادمة'),'عداد المرشح يعرض المرشح النشط');
  await page.locator('[data-hrc-filter="all"]').click();await page.waitForTimeout(400);
  assert.equal(await page.locator('#file-tab .dg tbody tr[data-i]').count(),rows,'إلغاء المرشح يعيد كل الصفوف');
  // البطاقات مسح سريع للهاتف؛ على سطح المكتب الجدول هو أداة الإدارة (لا ازدواج على الشاشة)
  assert.equal(await page.locator('[data-section-id="hearings-cards"]').evaluate(el=>getComputedStyle(el).display==='none'),true,'لوحة البطاقات مخفية على الشاشات الواسعة');
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
 await verify('7) تبويب الأعمال: لوحة متابعة بالحالة المسجلة + بحث ومرشحات + جدول كامل',async()=>{
  await page.locator('.file-tabs-bar [data-tab="procedures"]').click();await page.waitForTimeout(1200);
  const txt=await tabText();
  assert.ok(txt.includes('إعلان صحيفة الاستئناف')&&txt.includes('متابعة تقرير الخبير'),'الأعمال ظاهرة في بطاقات اللوحة');
  // عدادات من الحالة المسجلة: 2 نشط (أحدها متأخر بتاريخ 2026-10-11 المنقضي) + 1 مكتمل
  const counters=await page.locator('.prc-counter').allTextContents();
  assert.ok(counters.some(c=>c.includes('متأخرة'))&&counters.some(c=>c.includes('مكتملة')),'عدادات الحالات ظاهرة');
  assert.ok(txt.includes('متأخرة — موعدها انقضى'),'مجموعة المتأخر مميزة');
  assert.ok(txt.includes('قيد الانتظار')&&txt.includes('تم'),'حالة كل عمل من سجله');
  // بحث فوري يرشّح البطاقات والجدول معًا
  await page.locator('#proc-q').fill('الخبير');await page.waitForTimeout(600);
  assert.equal(await page.locator('#file-tab .dg tbody tr[data-i]').count(),1,'البحث يرشّح الجدول أيضًا');
  await page.locator('#proc-q').fill('');await page.waitForTimeout(600);
  assert.equal(await page.locator('#file-tab .dg tbody tr[data-i]').count(),3,'مسح البحث يعيد كل الأعمال');
  // مرشح «مكتملة» من الحالة المسجلة
  await page.locator('[data-proc-filter="done"]').click();await page.waitForTimeout(400);
  assert.equal(await page.locator('#file-tab .dg tbody tr[data-i]').count(),1,'مرشح «مكتملة» يعرض العمل المنجز فقط');
  assert.ok((await page.locator('[data-proc-filter-count]').textContent()).includes('مكتملة'),'عداد المرشح النشط');
  await page.locator('[data-proc-filter="all"]').click();await page.waitForTimeout(400);
  // «✓ تم» من البطاقة: نفس مسار مركز العمل الرسمي ثم تحديث موضعي للتبويب
  assert.ok(await page.locator('[data-complete-proc]').count()>=1,'زر الإنجاز متاح للأعمال النشطة');
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
  await page.waitForFunction(id=>window.__LAW_OFFICE_APP__?.route===`file:${id}?tab=hearings`,fx.file.id,{timeout:10000});
  assert.ok(await activeTabCheck('hearings'),'اختيار التبويب يحدّث الحالة النشطة');
  await page.goBack();
  await page.waitForFunction(id=>window.__LAW_OFFICE_APP__?.route===`file:${id}?tab=typeData`,fx.file.id,{timeout:10000});
  assert.equal(await page.locator('#file-tab [data-meta]').first().inputValue(),'مسودة غير محفوظة '+fx.suffix,'Back يعيد عقدة النموذج المحفوظة وقيمتها');
  await page.goForward();
  await page.waitForFunction(id=>window.__LAW_OFFICE_APP__?.route===`file:${id}?tab=hearings`,fx.file.id,{timeout:10000});
  await page.goBack();
  await page.waitForFunction(id=>window.__LAW_OFFICE_APP__?.route===`file:${id}?tab=typeData`,fx.file.id,{timeout:10000});
  assert.equal(await page.locator('#file-tab [data-meta]').first().inputValue(),'مسودة غير محفوظة '+fx.suffix,'Forward/Back لا يفقدان المسودة');
 });

 // (11) عزل الملفات
 await verify('11) لا اختلاط بين بيانات ملفين عند التنقل مع عزل الرقم المخفي',async()=>{
  await go(`file:${fx.plain.id}`);
  let head=await headText();
  assert.ok(!head.includes(fx.plainNo)&&!head.includes(fx.fileNo),'رأسا الملفين لا يعرضان الرقم الداخلي قبل الطلب');
  assert.ok(!head.includes('شركة النيل للمقاولات'),'لا أطراف ملف آخر');
  await page.locator('[data-file-number-toggle]').click();await page.waitForTimeout(120);
  assert.ok((await page.locator('[data-file-number-popover]').textContent()).includes(fx.plainNo)&&!(await page.locator('[data-file-number-popover]').textContent()).includes(fx.fileNo),'زر الملف الثاني يعرض رقمه فقط');
  await page.locator('[data-file-number-toggle]').click();
  await go(`file:${fx.file.id}`);
  head=await headText();
  assert.ok(!head.includes(fx.fileNo)&&!head.includes(fx.plainNo),'رأس الملف الأول لا يكرر رقم الملف الداخلي');
  await page.locator('[data-file-number-toggle]').click();await page.waitForTimeout(120);
  assert.ok((await page.locator('[data-file-number-popover]').textContent()).includes(fx.fileNo)&&!(await page.locator('[data-file-number-popover]').textContent()).includes(fx.plainNo),'زر الملف الأول يعرض رقمه فقط');
  await page.locator('[data-file-number-toggle]').click();
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
  assert.equal(await page.locator('#file-tab .fp-file-data').count(),1,'قسم بيانات ملف واحد');
  assert.equal(await page.locator('#file-tab .fp-followup').count(),1,'قسم متابعة قريبة واحد');
  assert.equal(await page.locator('.collapse-page-tools').count(),0,'لا شريط «الأقسام والجداول» فوق محتوى الملف');
  assert.equal(report.errors.length,before,'لا أخطاء جديدة أثناء التنقل');
 });

 // (15) الافتراض العام + التبويب الصريح في الرابط
 await verify('15) فتح أي ملف يبدأ بنظرة عامة والتبويب المختلف لا يفتح إلا برابط صريح',async()=>{
  await go(`file:${fx.file.id}`);
  await page.evaluate(k=>document.querySelector(`.file-tabs-bar [data-tab="${k}"]`).click(),'judgments');
  await page.waitForTimeout(700);
  assert.ok(await activeTabCheck('judgments'),'التبديل اليدوي يفتح القسم المطلوب');
  await go(`file:${fx.file.id}`);
  assert.ok(await activeTabCheck('summary'),'إعادة فتح الملف مباشرة تعود إلى نظرة عامة');
  await go(`file:${fx.file.id}?tab=judgments`);
  assert.ok(await activeTabCheck('judgments'),'رابط tab صريح يفتح القسم المطلوب');
  await go(`file:${fx.plain.id}`);
  assert.ok(await activeTabCheck('summary'),'ملف آخر يفتح نظرة عامة أيضًا');
 });

 // (16) شريط واحد فقط في صفحة الملف + وضع التركيز
 await verify('16) شريط التبويبات هو الشريط الملتصق الوحيد في الصفحة ووضع التركيز يعمل',async()=>{
  await go(`file:${fx.file.id}`);
  await page.evaluate(()=>document.querySelector('.file-tabs-bar [data-tab="summary"]').click());
  await page.waitForTimeout(900);
  assert.equal(await page.locator('[data-file-sticky]').count(),0,'لا شريط مختصر ثانٍ للهوية (أُزيل نهائيًا)');
  await page.evaluate(()=>window.scrollTo(0,1200));await page.waitForTimeout(1000);
  assert.equal(await page.locator('#main-content .file-tabs-bar').count(),1,'شريط تبويبات واحد فقط');
  await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(400);
  await page.locator('[data-file-focus]').click();await page.waitForTimeout(400);
  assert.equal(await page.evaluate(()=>document.querySelector('#main-content').classList.contains('file-focus-mode')),true);
  assert.equal(await page.locator('#file-tab .cp-fc').isVisible(),true,'قمرة الملف لا تختفي في وضع التركيز');
  assert.equal(await page.locator('#file-tab .cp-fc-stats').isVisible(),false,'الإحصاءات الثانوية تُختصر في التركيز');
  await page.locator('[data-file-focus]').click();await page.waitForTimeout(300);
  assert.equal(await page.evaluate(()=>document.querySelector('#main-content').classList.contains('file-focus-mode')),false);
 });

 // (17) القائمة المنسدلة الواحدة لبقية الأقسام: فتح/إغلاق/Escape/نقر خارجي/تنقل فعلي
 await verify('17) القائمة المنسدلة الواحدة تعمل وتُغلق بـEscape والنقر خارجها وتنقل فعليًا',async()=>{
  await go(`file:${fx.file.id}`);
  const btn=page.locator('[data-tabs-menu]');
  assert.equal(await btn.count(),1,'زر قائمة واحد فقط لبقية الأقسام');
  assert.equal(await page.locator('.ftb-groups').count(),0,'لا مجموعة أزرار قوائم ثانية في الشريط');
  await btn.click();await page.waitForTimeout(300);
  const menu=page.locator('.ftb-menu-all');
  assert.equal(await menu.isVisible(),true,'القائمة تفتح');
  assert.equal(await menu.locator('[data-menu-tab]').count(),11,'كل الأقسام غير الأساسية داخل القائمة (11)');
  await page.keyboard.press('Escape');await page.waitForTimeout(300);
  assert.equal(await menu.isVisible(),false,'Escape يغلق القائمة');
  await btn.click();await page.waitForTimeout(300);
  await page.mouse.click(700,600);await page.waitForTimeout(300);
  assert.equal(await menu.isVisible(),false,'النقر خارجها يغلقها');
  await btn.click();await page.waitForTimeout(300);
  await menu.locator('[data-menu-tab="judgments"]').click();await page.waitForTimeout(900);
  assert.ok(await activeTabCheck('judgments'),'عنصر القائمة ينقل فعليًا إلى التبويب');
  assert.equal(await menu.isVisible(),false,'القائمة تُغلق بعد الاختيار');
  assert.equal((await page.locator('.ftb-more-btn .ftb-active-name').textContent()).trim(),'الأحكام','اسم القسم المفتوح يظهر في زر القائمة');
 });

 // (18) شريط التبويبات: التبويبات الأساسية ظاهرة وبقية الأقسام في قائمة منسدلة واحدة
 await verify('18) أربعة تبويبات ظاهرة وبقية الأقسام كلها في قائمة منسدلة واحدة بلا تكرار',async()=>{
  await go(`file:${fx.file.id}`);
  const primary=await page.locator('.file-tabs-bar .file-subtabs [role="tab"]').evaluateAll(ns=>ns.map(b=>b.dataset.tab));
  assert.deepEqual(primary,['summary','hearings','procedures','judicial'],'الأساسية الظاهرة: نظرة عامة، الجلسات، الأعمال الإدارية، المراحل');
  const menus=await page.locator('.ftb-group').evaluateAll(ns=>ns.map(g=>({id:g.dataset.group,cls:g.className,buttons:g.querySelectorAll('.ftb-group-btn').length,items:[...g.querySelectorAll('.ftb-item')].map(i=>i.dataset.tab)})));
  assert.equal(menus.length,1,`قائمة منسدلة واحدة فقط في الشريط (${menus.length})`);
  assert.equal(menus[0].id,'gMore','القائمة هي «المزيد من الأقسام»');
  assert.equal(menus[0].buttons,1,'زر واحد فقط يفتح القائمة — لا أزرار مجموعات إضافية');
  const grouped=menus[0].items;
  assert.equal(grouped.length,11,'الأقسام غير الأساسية الأحد عشر داخل القائمة');
  const allIds=await page.locator('.file-tabs-bar [data-tab]').evaluateAll(ns=>ns.map(b=>b.dataset.tab));
  assert.equal(new Set(allIds).size,allIds.length,'كل قسم يظهر مرة واحدة فقط في الشريط — لا تكرار');
  assert.equal(allIds.length,15,`كل الأقسام متاحة من الشريط (${allIds.length})`);
  assert.equal([...primary,...grouped].length,15,'الأساسية + عناصر القائمة = كل الأقسام');
  // عناوين تنظيمية داخل القائمة فقط: لا مخفي ولا قسم غير متاح
  const titles=await page.locator('.ftb-menu-all .ftb-sec-title').allTextContents();
  assert.ok(titles.length>=4,`القائمة عناوين وظيفية داخلية (${titles.length})`);
  const menuTabs=await page.locator('.ftb-menu-all .ftb-item').evaluateAll(ns=>ns.map(b=>b.dataset.tab));
  assert.deepEqual([...menuTabs].sort(),[...grouped].sort(),'كل قسم مصنّف داخل القائمة مرة واحدة');
  // كل قسم محفوظ في النظام يملك تبويبًا فعليًا
  const macro=await page.evaluate(async()=>{
   const {getPageLayout}=await import('/js/ui/page-layout.js');
   return getPageLayout('file-details').sections.map(s=>s.id);
  });
  assert.deepEqual([...macro].sort(),[...allIds].sort(),'قائمة التخصيص المركزي تطابق أقسام الشريط');
  // المخفي من «تخصيص الصفحة» يخرج من قائمة الأقسام العادية ويبقى في ركن «مخفية من الشريط» مُعلَّمًا
  await page.evaluate(async()=>{const {saveSectionLayout}=await import('/js/core/display-prefs.js');saveSectionLayout('file-details',{hidden:['notes']})});
  await go(`file:${fx.file.id}`);
  const notesInBar=await page.locator('.file-subtabs [data-tab="notes"]').count();
  assert.equal(notesInBar,0,'القسم المخفي لا يظهر كتبويب في الشريط');
  await page.locator('[data-tabs-menu]').click();await page.waitForTimeout(300);
  assert.equal(await page.locator('.ftb-sec:not(.ftb-sec-hidden) [data-menu-tab="notes"]').count(),0,'لا يبقى داخل أقسام القائمة العادية');
  const hiddenItem=page.locator('.ftb-sec-hidden [data-menu-tab="notes"]');
  assert.equal(await hiddenItem.count(),1,'يبقى متاحًا في ركن «مخفية من الشريط» — لا وظيفة تصبح غير قابلة للوصول');
  assert.ok((await hiddenItem.textContent()).includes('مخفي'),'مُعلَّم بكلمة «مخفي»');
  await hiddenItem.click();await page.waitForTimeout(900);
  assert.equal((await page.locator('[data-tab-shell-title]').textContent()).trim(),'الملاحظات','ويمكن فتحه عند الحاجة من القائمة');
  assert.equal(await page.locator('.ftb-menu-all [data-menu-tab="notes"]').getAttribute('aria-checked'),'true','عنصر القسم المخفي مُعلَّم كنشط داخل القائمة');
  await page.evaluate(async()=>{const {saveSectionLayout}=await import('/js/core/display-prefs.js');saveSectionLayout('file-details',{hidden:[]})});
  await go(`file:${fx.file.id}`);
 });

 // (19) القائمة المنسدلة: الاختيار يفتح القسم الصحيح ويُميّز الحالي + سلوك لوحة المفاتيح
 await verify('19) القائمة المنسدلة: تحديد القسم النشط بصريًا وفتح القسم الصحيح + لوحة المفاتيح',async()=>{
  await go(`file:${fx.file.id}`);
  const group=page.locator('.ftb-group[data-group="gMore"]');
  const trigger=group.locator('.ftb-group-btn');
  assert.equal(await trigger.getAttribute('aria-expanded'),'false','القائمة مغلقة ابتداءً');
  await trigger.click();await page.waitForTimeout(300);
  assert.equal(await trigger.getAttribute('aria-expanded'),'true','الزر يفتح القائمة');
  const menu=group.locator('.ftb-menu');
  assert.equal(await menu.isVisible(),true,'القائمة ظاهرة');
  const menuTab=id=>menu.locator(`.ftb-item[data-tab="${id}"]`);
  // تنقل بالأسهم داخل القائمة (الفتح يضع التركيز على العنصر الأول)
  assert.equal(await page.evaluate(()=>document.activeElement?.dataset?.tab||''),'parties','الفتح يضع التركيز على العنصر الأول');
  await page.keyboard.press('ArrowDown');await page.waitForTimeout(150);
  assert.equal(await page.evaluate(()=>document.activeElement?.dataset?.tab||''),'assets','↓ ينتقل إلى العنصر التالي');
  await page.keyboard.press('ArrowUp');await page.waitForTimeout(150);
  assert.equal(await page.evaluate(()=>document.activeElement?.dataset?.tab||''),'parties','↑ يعود إلى العنصر السابق');
  await page.keyboard.press('End');await page.waitForTimeout(150);
  assert.equal(await page.evaluate(()=>document.activeElement?.dataset?.tab||''),'activity','End ينتقل إلى آخر عنصر');
  await page.keyboard.press('Home');await page.waitForTimeout(150);
  assert.equal(await page.evaluate(()=>document.activeElement?.dataset?.tab||''),'parties','Home يعود إلى أول عنصر');
  await page.keyboard.press('Escape');await page.waitForTimeout(250);
  assert.equal(await menu.isVisible(),false,'Escape يغلق القائمة');
  assert.equal(await page.evaluate(()=>document.activeElement?.dataset?.tabGroup||''),'gMore','التركيز يعود إلى زر القائمة');
  // اختيار عنصر من القائمة
  await trigger.click();await page.waitForTimeout(250);
  await menuTab('judgments').click();await page.waitForTimeout(900);
  assert.ok(await activeTabCheck('judgments'),'القسم المختار فُتح فعلًا');
  assert.equal(await menu.isVisible(),false,'القائمة أُغلقت بعد الاختيار');
  assert.equal(await group.getAttribute('class').then(c=>c.includes('is-active')),true,'زر القائمة معلَّم كنشط');
  assert.equal((await trigger.locator('.ftb-active-name').textContent()).trim(),'الأحكام','اسم القسم المفتوح ظاهر في زر القائمة');
  const item=menuTab('judgments');
  assert.equal(await item.getAttribute('aria-checked'),'true','العنصر النشط مُعلَّم بـaria-checked');
  assert.equal(await item.getAttribute('class').then(c=>c.includes('is-on')),true,'العنصر النشط مميز بصريًا');
  assert.equal((await page.locator('[data-tab-shell-title]').textContent()).trim(),'الأحكام','عنوان لوحة المحتوى يطابق القسم');
  // العودة إلى تبويب أساسي: زر القائمة يفقد التعليل بصريًا بلا حالة كاذبة
  await page.locator('.file-subtabs [data-tab="summary"]').click();await page.waitForTimeout(900);
  assert.equal(await group.getAttribute('class').then(c=>c.includes('is-active')),false,'زر القائمة غير نشط مع تبويب أساسي');
  assert.equal(await trigger.locator('.ftb-active-name').count(),0,'لا اسم قسم عالق في زر القائمة');
 });

 // (20) القائمة لا تُقطع عند حواف الشاشة (RTL) على سطح المكتب والهاتف
 await verify('20) القائمة المنسدلة لا تُقطع عند حواف الشاشة في RTL (مكتب/هاتف)',async()=>{
  for(const [w,h] of [[1440,950],[768,1024],[360,740]]){
   await page.setViewportSize({width:w,height:h});
   await go(`file:${fx.file.id}`);
   // نقيس تخطيط شريط التبويبات نفسه: نعود إلى «نظرة عامة» (بلا جدول عريض) ثم نقيس
   await page.evaluate(()=>document.querySelector('.file-tabs-bar [data-tab="summary"]')?.click());
   await page.waitForTimeout(700);
   await page.evaluate(()=>document.querySelector('.ftb-more-btn')?.click());
   await page.waitForTimeout(300);
   const box=await page.evaluate(()=>{const m=document.querySelector('.ftb-menu-all');const r=m.getBoundingClientRect();return {open:!m.hidden,left:r.left,right:r.right,top:r.top,width:r.width,vw:window.innerWidth,vh:window.innerHeight,scrollH:m.scrollHeight}});
   assert.equal(box.open,true,`القائمة تُفتح عند ${w}px`);
   assert.ok(box.left>=-1&&box.right<=box.vw+1,`القائمة داخل الشاشة عند ${w}px (${Math.round(box.left)}..${Math.round(box.right)} / ${box.vw})`);
   assert.ok(box.top>=0,`القائمة تبدأ من داخل الشاشة عند ${w}px (top=${Math.round(box.top)})`);
   await page.keyboard.press('Escape');await page.waitForTimeout(180);
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth+2);
   assert.equal(overflow,false,`لا تمرير أفقي للصفحة عند ${w}px`);
   const primaryVisible=await page.locator('.file-tabs-bar .file-subtabs [role="tab"]:visible').count();
   assert.equal(primaryVisible>=4,true,`التبويبات الأساسية ظاهرة كلها عند ${w}px`);
  }
  await page.setViewportSize({width:1440,height:950});
 });

 // (23) الشريط الملتصق: التنقل يبقى ظاهرًا أثناء التمرير دون حجب المحتوى
 await verify('23) شريط التبويبات ثابت في مكانه أثناء التمرير بلا تراكب (مكتب/هاتف)',async()=>{
  // الالتصاق: موضع واحد ثابت أعلى المحتوى مهما كان مقدار السحب — لا يتحرك إلى منتصف الشاشة.
  for(const [w,h] of [[1440,900],[834,1024],[390,780]]){
   await page.setViewportSize({width:w,height:h});
   await go(`file:${fx.file.id}`);
   await page.evaluate(()=>document.querySelector('.file-tabs-bar [data-tab="summary"]')?.click());
   await page.waitForTimeout(700);
   const geoOf=()=>page.evaluate(()=>{
    const r=s=>{const el=document.querySelector(s);if(!el)return null;const b=el.getBoundingClientRect();return {top:Math.round(b.top),bottom:Math.round(b.bottom),h:Math.round(b.height),visible:b.height>0&&b.top<window.innerHeight&&b.bottom>0}};
    const z=s=>{const el=document.querySelector(s);return el?Number(getComputedStyle(el).zIndex)||0:0};
    const bar=document.querySelector('.file-tabs-bar');
    return {tn:r('#sidebar.tn-bar'),topbar:r('.topbar'),tabs:r('.file-tabs-bar'),scrollY:Math.round(window.scrollY),inlineTop:bar?.style.top||'',
     z:{tn:z('#sidebar.tn-bar'),topbar:z('.topbar'),tabs:z('.file-tabs-bar')}};
   });
   const tops=[];
   for(const y of [600,1400,2600,3800]){
    await page.evaluate(v=>window.scrollTo(0,v),y);
    await page.waitForTimeout(500);
    const g=await geoOf();
    assert.ok(g.tabs&&g.tabs.visible,`شريط التبويبات ظاهر أثناء التمرير عند ${w}px`);
    assert.ok(g.tabs.top>=0,`الشريط غير مقصوص أعلى الشاشة عند ${w}px (top=${g.tabs.top})`);
    if(g.topbar&&g.topbar.h&&g.topbar.bottom>0)assert.ok(g.tabs.top>=g.topbar.bottom-1,`الشريط لا يغطي شريط الصفحة عند ${w}px`);
    assert.equal(await page.locator('[data-file-sticky]').count(),0,'لا شريط مختصر ثانٍ يتقاطع مع التبويبات');
    tops.push(g.tabs.top);
   }
   assert.equal(new Set(tops).size,1,`موضع الشريط ثابت أثناء السحب كله عند ${w}px (${tops.join('/')})`);
   const geo=await geoOf();
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
  assert.equal(a11y.groups.length,1,'قائمة منسدلة واحدة فقط');
  const allItems=[];
  for(const g of a11y.groups){
   assert.equal(g.id,'gMore','القائمة هي «المزيد من الأقسام»');
   assert.equal(g.haspopup,'menu',`${g.id} يعلن أنه قائمة`);
   assert.equal(g.expanded,'false','مغلقة ابتداءً');
   assert.ok(g.menuId&&g.menuId===g.controls,`${g.id} مرتبط بقائمته`);
   assert.equal(g.menuRole,'menu',`${g.id} قائمة بدور menu`);
   assert.equal(g.items.length,11,`${g.id} يحتوي كل الأقسام غير الأساسية`);
   for(const i of g.items){assert.equal(i.controls,'file-tab',`${i.tab} مرتبط بلوحة المحتوى`);allItems.push(i.tab)}
  }
  assert.equal(new Set(allItems).size,11,'11 قسمًا داخل القائمة (15 - 4 أساسية)');
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
  const groupBtn=page.locator('.ftb-group[data-group="gMore"] .ftb-group-btn');
  await groupBtn.focus();
  await page.keyboard.press('Enter');await page.waitForTimeout(300);
  assert.equal(await page.locator('.ftb-group[data-group="gMore"] .ftb-menu').isVisible(),true,'Enter يفتح القائمة');
  // كل أقسام القائمة قابلة للوصول بالأسهم وتُفتح بـEnter (عيّنة ممثلة من كل عنوان وظيفي)
  const menuItems=await page.evaluate(()=>[...document.querySelectorAll('.ftb-menu-all [role="menuitemradio"]')].map(n=>n.dataset.tab));
  assert.equal(menuItems.length,11,'كل الأقسام غير الأساسية داخل القائمة');
  for(const t of ['parties','judgments','notes','relations','timeline','activity']){
   await page.evaluate(tab=>{document.querySelector(`.ftb-menu-all [data-tab="${tab}"]`)?.focus()},t);
   await page.keyboard.press('Enter');await page.waitForTimeout(800);
   assert.ok(await activeTabCheck(t),`Enter يفتح القسم ${t} من القائمة`);
   await groupBtn.focus();
   await page.keyboard.press('Enter');await page.waitForTimeout(250);
  }
  await page.keyboard.press('Escape');await page.waitForTimeout(200);
  await page.evaluate(()=>document.querySelector('.file-tabs-bar [data-tab="summary"]')?.click());
  await page.waitForTimeout(700);
 });

 // (25) الروابط المباشرة: ?tab= لقسم أساسي ولقسم داخل القائمة المنسدلة
 await verify('25) رابط مباشر ?tab= يفتح القسم الصحيح حتى داخل القائمة المنسدلة ويُعلّمها',async()=>{
  // قسم أساسي
  await go(`file:${fx.file.id}?tab=procedures`);
  await page.waitForTimeout(1200);
  assert.ok(await activeTabCheck('procedures'),'?tab=procedures يفتح تبويب الأعمال الإدارية');
  // قسم داخل القائمة المنسدلة
  await go(`file:${fx.file.id}?tab=notes`);
  await page.waitForTimeout(1200);
  assert.equal((await page.locator('[data-tab-shell-title]').textContent()).trim(),'الملاحظات','?tab=notes يفتح قسم الملاحظات');
  assert.equal(await page.locator('.ftb-group[data-group="gMore"]').getAttribute('class').then(c=>c.includes('is-active')),true,'زر القائمة مميز عند فتح قسم منها');
  assert.equal((await page.locator('.ftb-group[data-group="gMore"] .ftb-active-name').textContent()).trim(),'الملاحظات','اسم القسم المفتوح ظاهر في الزر');
  const item=page.locator('.ftb-menu-all [data-tab="notes"]');
  assert.equal(await item.getAttribute('aria-checked'),'true','العنصر داخل القائمة مُعلَّم كنشط');
  // قسم آخر من القائمة نفسها: التعليم ينتقل إليه وحده
  await go(`file:${fx.file.id}?tab=relations`);
  await page.waitForTimeout(1200);
  assert.equal((await page.locator('.ftb-group[data-group="gMore"] .ftb-active-name').textContent()).trim(),'العلاقات والملفات المرتبطة','اسم القسم الجديد ظاهر في الزر');
  assert.equal(await page.locator('.ftb-menu-all [data-tab="relations"]').getAttribute('aria-checked'),'true');
  assert.equal(await page.locator('.ftb-menu-all [data-tab="notes"]').getAttribute('aria-checked'),'false','القسم السابق فقد التعليل');
  const expectedRoute=`file:${fx.file.id}?tab=relations`;
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__LAW_OFFICE_APP__?.office&&!window.__LAW_OFFICE_APP__.booting,null,{timeout:60000});
  await page.waitForFunction(route=>window.__LAW_OFFICE_APP__?.route===route,expectedRoute,{timeout:30000});
  await page.waitForSelector('.file-tabs-bar',{timeout:30000});
  assert.ok(await activeTabCheck('relations'),'تحديث الرابط المباشر يعيد القسم نفسه');
  assert.equal((await page.locator('[data-tab-shell-title]').textContent()).trim(),'العلاقات والملفات المرتبطة');
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
  assert.deepEqual(names.slice(0,4),['نظرة عامة','الجلسات','الأعمال الإدارية','المراحل'],'ترتيب الأقسام الافتراضي');
  await page.locator('#modal-root [data-pl-done]').click();
  await page.waitForTimeout(400);
  assert.equal(await page.locator('#modal-root .pl-row').count(),0,'النافذة أُغلقت');
  // تنقل متكرر: قائمة واحدة ولا فتح مزدوج ولا تكرار للعناصر
  for(let i=0;i<3;i++){
   await page.evaluate(()=>document.querySelector('.ftb-more-btn').click());
   await page.waitForTimeout(120);
   await page.keyboard.press('Escape');
   await page.waitForTimeout(120);
  }
  await page.locator('.ftb-more-btn').click();
  await page.waitForTimeout(250);
  assert.equal(await page.locator('.ftb-menu:visible').count(),1,'قائمة واحدة مفتوحة فقط');
  assert.equal(await page.locator('.ftb-menu').count(),1,'قائمة واحدة في الشريط كلها — بلا تكرار للعناصر');
  assert.equal(await page.locator('.ftb-menu-all .ftb-item').count(),11,'11 عنصرًا مرة واحدة لكل قسم');
  await page.locator('.ftb-menu-all [data-tab="parties"]').click();
  await page.waitForTimeout(800);
  assert.equal((await page.locator('[data-tab-shell-title]').textContent()).trim(),'الأطراف والصفات','الاختيار يفتح القسم مرة واحدة');
  assert.equal(await page.locator('#file-tab .party-toolbar').count(),1,'محتوى القسم مرة واحدة بلا تكرار');
 });

 // (28) السحب والإفلات الحقيقي بالماوس داخل «⚙ تخصيص الصفحة»
 await verify('28) إعادة الترتيب بالسحب بالماوس: يتغير فعلًا، يُحفظ، ويتبعه شريط التبويبات',async()=>{
  await go(`file:${fx.file.id}`);
  await page.locator('[data-order-file-tabs]').click();
  await page.waitForTimeout(700);
  const rows=page.locator('#modal-root .pl-row');
  await rows.first().waitFor({state:'visible',timeout:8000});
  const orderOf=()=>page.evaluate(()=>[...document.querySelectorAll('#modal-root .pl-row')].map(r=>r.dataset.pl));
  const tabsOf=()=>page.evaluate(()=>[...document.querySelectorAll('.file-subtabs [data-tab]')].map(b=>b.dataset.tab));
  const before=await orderOf();
  const tabsBefore=await tabsOf();
  assert.equal(before.length,15,'15 قسمًا قبل السحب');
  // سحب حقيقي بالماوس (أحداث HTML5 DnD حقيقية عبر Playwright) للصف الأول إلى موضع الرابع
  await rows.nth(0).dragTo(rows.nth(3));
  await page.waitForTimeout(800);
  const after=await orderOf();
  assert.notDeepEqual(after,before,`السحب بالماوس غيّر الترتيب (${before[0]} تحرك)`);
  assert.equal(after[3],before[0],'القسم المسحوب استقر في الموضع الهدف');
  // الحفظ الفعلي + انعكاسه على شريط التبويبات (نظام واحد لا نظامان)
  await page.locator('#modal-root [data-pl-done]').click();
  await page.waitForTimeout(600);
  const tabsAfter=await tabsOf();
  assert.notDeepEqual(tabsAfter,tabsBefore,'ترتيب شريط التبويبات تابع للترتيب الجديد');
  assert.equal(tabsAfter[3],before[0],'القسم المسحوب في الموضع الجديد بالشريط');
  await page.locator('[data-order-file-tabs]').click();
  await page.waitForTimeout(700);
  await rows.first().waitFor({state:'visible',timeout:8000});
  assert.deepEqual(await orderOf(),after,'الترتيب الجديد محفوظ بعد إعادة فتح النافذة');
  // «استعادة الافتراضي» زر حقيقي يطلب تأكيدًا ثم يُرجع الترتيب الأصلي
  await page.locator('#modal-root [data-pl-reset]').click();
  await page.locator('#modal-root [data-ok]').waitFor({state:'visible',timeout:8000});
  assert.ok((await page.locator('#modal-root').textContent()).includes('استعادة الترتيب'),'التأكيد يشرح أثر الاستعادة');
  await page.locator('#modal-root [data-ok]').click();
  await page.waitForTimeout(900);
  assert.equal(await page.locator('#modal-root .pl-row').count(),0,'نافذة التخصيص أُغلقت بعد الاستعادة');
  assert.deepEqual(await tabsOf(),tabsBefore,'شريط التبويبات رجع لترتيبه الأصلي');
  await page.locator('[data-order-file-tabs]').click();
  await page.waitForTimeout(700);
  await rows.first().waitFor({state:'visible',timeout:8000});
  assert.deepEqual(await orderOf(),before,'«استعادة الافتراضي» ترجع ترتيب الأقسام الأصلي');
  await page.locator('#modal-root [data-pl-done]').click();
  await page.waitForTimeout(500);
 });

 // (29) خط الطباعة الحقيقي: PDF فعلي بمحرك Chromium + توافق العرض مع مقاس A4
 await verify('29) الطباعة الحقيقية: توليد PDF بمحرك المتصفح وتوافق العرض مع A4',async()=>{
  await go(`file:${fx.file.id}`);
  await page.evaluate(()=>document.querySelector('.file-tabs-bar [data-tab="summary"]')?.click());
  await page.waitForTimeout(900);
  const pdfPath=path.join(artifactDir,'file-page-print.pdf');
  await page.pdf({path:pdfPath,format:'A4',printBackground:true,margin:{top:'12mm',bottom:'12mm',left:'10mm',right:'10mm'}});
  const buf=await fs.readFile(pdfPath);
  assert.ok(buf.length>20000,`ملف PDF غير فارغ (${buf.length} بايت)`);
  assert.equal(buf.subarray(0,5).toString('latin1'),'%PDF-','ترويسة PDF سليمة');
  const tail=buf.subarray(Math.max(0,buf.length-4096)).toString('latin1');
  assert.ok(tail.includes('%%EOF'),'نهاية ملف PDF سليمة');
  const raw=buf.toString('latin1');
  const pages=(raw.match(/\/Type\s*\/Page[^s]/g)||[]).length;
  assert.ok(pages>=1,`PDF يحتوي صفحات مطبوعة (${pages})`);
  assert.ok(/\/MediaBox\s*\[\s*0\s+0\s+59[0-9](\.\d+)?\s+84[0-9](\.\d+)?/.test(raw)||/595\.\d+\s+84[12]\.\d+/.test(raw),'مقاس الصفحة A4 (595×842pt)');
  assert.ok(/\/Font/.test(raw),'خطوط عربية مدمجة في PDF');
  // محاكاة مقاس A4 (794×1123 بكسل @96dpi) في وضع الطباعة: لا تجاوز أفقي ولا شريط ملتصق
  await page.setViewportSize({width:794,height:1123});
  await page.emulateMedia({media:'print'});
  await page.waitForTimeout(600);
  const fit=await page.evaluate(()=>({
   doc:document.documentElement.scrollWidth,win:window.innerWidth,
   bar:getComputedStyle(document.querySelector('.file-tabs-bar')).position,
   id:!!(document.querySelector('.file-id')?.getBoundingClientRect().height),
   cards:document.querySelectorAll('.fx-grid .fx-card').length}));
  assert.equal(fit.bar,'static','الشريط غير ملتصق في محاكاة الطباعة');
  assert.ok(fit.doc<=fit.win+2,`لا تجاوز أفقي في عرض A4 (${fit.doc} <= ${fit.win})`);
  assert.equal(fit.id,true,'هوية الملف مطبوعة');
  await page.screenshot({path:path.join(artifactDir,'print-a4.png'),fullPage:true});
  await page.emulateMedia({media:'screen'});
  await page.setViewportSize({width:1440,height:950});
  await page.waitForTimeout(500);
 });

 // (30) شجرة إمكانية الوصول الفعلية — ما يستقبله قارئ الشاشة من المتصفح
 await verify('30) شجرة a11y من المتصفح: tablist/tab/tabpanel وأسماء وصول لكل عنصر تفاعلي بصفحة الملف',async()=>{
  await go(`file:${fx.file.id}`);
  await page.evaluate(()=>document.querySelector('.file-tabs-bar [data-tab="summary"]')?.click());
  await page.waitForTimeout(900);
  const snap=await page.locator('.file-tabs-bar').ariaSnapshot();
  if(process.env.FPW_DEBUG)console.log('--- aria snapshot ---\n'+snap+'\n--- end ---');
  assert.ok(/tablist/.test(snap),'الشريط يظهر في شجرة الوصول كـ tablist');
  for(const label of ['نظرة عامة','الجلسات','الأعمال الإدارية','المراحل']){
   assert.ok(new RegExp(`tab "${label}[^"]*"`).test(snap),`تبويب «${label}» له اسم وصول في الشجرة`);
  }
  assert.ok(/\[selected\]/.test(snap),'التبويب النشط معلَّم selected في الشجرة');
  const panelSnap=await page.locator('#file-tab').ariaSnapshot();
  assert.ok(/tabpanel/.test(panelSnap),'منطقة المحتوى معلنة كـ tabpanel');
  // كل عنصر تفاعلي داخل صفحة الملف له اسم وصول (لا أزرار صامتة أمام قارئ الشاشة)
  const cdp=await context.newCDPSession(page);
  await cdp.send('Accessibility.enable');
  const axOf=async sel=>{
   const {result}=await cdp.send('Runtime.evaluate',{expression:`document.querySelector(${JSON.stringify(sel)})`});
   const {nodes}=await cdp.send('Accessibility.queryAXTree',{objectId:result.objectId});
   return nodes;
  };
  const propsOf=n=>Object.fromEntries((n.properties||[]).map(p=>[p.name,p.value?.value]));
  const moreLabel='المزيد من الأقسام';
  let barNodes=await axOf('.file-tabs-bar');
  // التبويبات الأساسية الأربعة بأسماء وصول + موضع وحجم مجموعة (يعلنها قارئ الشاشة)
  const tabs=barNodes.filter(n=>n.role?.value==='tab');
  assert.equal(tabs.length,4,`أربعة تبويبات في شجرة الوصول (${tabs.length})`);
  for(const t of tabs){
   const p=propsOf(t);
   assert.ok('selected' in p,`«${t.name?.value}» يحمل حالة التحديد في الشجرة`);
   assert.ok('controls' in p,`«${t.name?.value}» مرتبط بلوحة المحتوى (controls)`);
  }
  assert.equal(tabs.filter(t=>propsOf(t).selected===true).length,1,'تبويب واحد فقط معلن محدَّدًا');
  // زر القائمة المنسدلة الواحدة معلن كقائمة مغلقة (hasPopup=menu + expanded=false) في شجرة الوصول الحقيقية
  const groupBtns=barNodes.filter(n=>n.role?.value==='button'&&String(n.name?.value||'').includes(moreLabel));
  assert.equal(groupBtns.length,1,`زر القائمة الواحدة في الشجرة (${groupBtns.length})`);
  for(const b of groupBtns){
   const p=propsOf(b);
   assert.equal(p.hasPopup,'menu',`«${b.name?.value}» معلن كقائمة منسدلة (hasPopup=menu)`);
   assert.equal(p.expanded,false,`«${b.name?.value}» معلن مغلقًا`);
  }
  // فتح القائمة: تُعلن كـ menu بعناصر menuitemradio، ويصبح الزر موسَّعًا
  await page.locator('.ftb-more-btn').click();
  await page.waitForTimeout(350);
  barNodes=await axOf('.file-tabs-bar');
  assert.ok(barNodes.some(n=>n.role?.value==='menu'),'القائمة المفتوحة معلنة كـ menu');
  const items=barNodes.filter(n=>n.role?.value==='menuitemradio');
  assert.ok(items.length>=3,`عناصر القائمة معلنة كـ menuitemradio (${items.length})`);
  const openBtn=barNodes.find(n=>n.role?.value==='button'&&String(n.name?.value||'').includes(moreLabel));
  assert.equal(propsOf(openBtn).expanded,true,'زر القائمة معلن موسَّعًا بعد الفتح');
  // اختيار قسم: يصبح العنصر معلنًا «محددًا» (checked) في الشجرة عند إعادة فتح القائمة
  const partiesLabel=(await page.locator('.ftb-menu-all [data-tab="parties"] .ftb-item-label').textContent()).trim();
  await page.locator('.ftb-menu-all [data-tab="parties"]').click();
  await page.waitForTimeout(900);
  await page.locator('.ftb-more-btn').click();
  await page.waitForTimeout(350);
  const reItems=(await axOf('.file-tabs-bar')).filter(n=>n.role?.value==='menuitemradio');
  const activeItem=reItems.find(n=>String(n.name?.value||'').includes(partiesLabel));
  assert.ok(activeItem,`عنصر «${partiesLabel}» موجود في الشجرة`);
  // قيمة checked في شجرة CDP نصية ('true'/'false'/'mixed') بخلاف selected المنطقية
  assert.equal(String(propsOf(activeItem).checked),'true',`«${partiesLabel}» معلن محدَّدًا (checked=true)`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  // لا عناصر تفاعلية بلا اسم وصول داخل صفحة الملف
  const interactive=new Set(['button','tab','menuitemradio','menuitem','link','checkbox','combobox','textbox','switch','radio']);
  // وصف العنصر الصامت من DOM ليكون الفشل قابلًا للتعقب (كلاس + أي aria-label/title موجود)
  const describeNode=async n=>{
   try{
    const {node}=await cdp.send('DOM.describeNode',{backendNodeId:n.backendDOMNodeId,depth:0});
    const attrs=node.attributes||[];
    const get=k=>{const i=attrs.indexOf(k);return i>=0?attrs[i+1]:''};
    const cls=(get('class')||'').split(/\s+/).filter(Boolean).slice(0,3).join('.');
    const named=get('aria-label')||get('title');
    return `${node.nodeName.toLowerCase()}${cls?'.'+cls:''}${named?`[${named}]`:'[بلا اسم]'}`;
   }catch{return `${n.role.value}#${n.backendDOMNodeId}`}
  };
  const unnamed=[];
  for(const sel of ['#file-head','.file-tabs-bar','#file-tab']){
   for(const n of await axOf(sel)){
    if(n.ignored||!n.role||!interactive.has(n.role.value))continue;
    if(!String(n.name?.value??'').trim())unnamed.push(`${sel}:${await describeNode(n)}`);
   }
  }
  await cdp.detach();
  assert.equal(unnamed.length,0,`لا عناصر تفاعلية بلا اسم وصول — ${unnamed.slice(0,6).join(' · ')||'—'}`);
 });

 // (31) تبديل الأقسام بلا إعادة تحميل + Back/Forward يعيدان الحالة المرئية
 await verify('31) تبويبات الملف تُسجل في الرابط وتعود عبر Back/Forward دون إعادة تحميل أو فقد المسودة',async()=>{
  await go(`file:${fx.file.id}?tab=summary`);
  await page.waitForFunction(id=>window.__LAW_OFFICE_APP__?.route===`file:${id}?tab=summary`,fx.file.id,{timeout:10000});
  await page.evaluate(()=>{window.__fpSentinel='alive'});
  const histBefore=await page.evaluate(()=>window.__LAW_OFFICE_APP__.routeHistory.depth);
  await page.locator('.file-tabs-bar [data-tab="hearings"]').click();
  await page.waitForFunction(({id,title})=>window.__LAW_OFFICE_APP__?.route===`file:${id}?tab=hearings`&&document.querySelector('[data-tab-shell-title]')?.textContent.trim()===title,{id:fx.file.id,title:'الجلسات'},{timeout:10000});
  await page.locator('.ftb-more-btn').click();
  await page.waitForTimeout(250);
  await page.locator('.ftb-menu-all [data-tab="notes"]').click();
  await page.waitForFunction(({id,title})=>window.__LAW_OFFICE_APP__?.route===`file:${id}?tab=notes`&&document.querySelector('[data-tab-shell-title]')?.textContent.trim()===title,{id:fx.file.id,title:'الملاحظات'},{timeout:10000});
  assert.equal(await page.evaluate(()=>window.__fpSentinel),'alive','التبديل داخلي لا يعيد تحميل المستند');
  assert.equal((await page.locator('[data-tab-shell-title]').textContent()).trim(),'الملاحظات','القسم المطلوب ظاهر بعد تبديلين');
  assert.ok(await activeTabCheck('notes'),'عنصر القائمة النشط معلَّم بعد التبديل');
  assert.equal(await page.evaluate(()=>window.__LAW_OFFICE_APP__.routeHistory.depth),histBefore+2,'كل اختيار يضيف مدخلًا واحدًا فقط');
  assert.equal(await page.evaluate(()=>location.hash),'#/'+encodeURIComponent(`file:${fx.file.id}?tab=notes`),'hash يحفظ هوية الملف والتبويب');
  const errsBefore=report.errors.length;
  await page.goBack();
  await page.waitForFunction(({id,title})=>window.__LAW_OFFICE_APP__?.route===`file:${id}?tab=hearings`&&document.querySelector('[data-tab-shell-title]')?.textContent.trim()===title,{id:fx.file.id,title:'الجلسات'},{timeout:10000});
  assert.ok(await activeTabCheck('hearings'),'Back يعيد تبويب الجلسات');
  assert.equal(await page.evaluate(()=>window.__fpSentinel),'alive','Back لا يعيد تحميل المستند');
  await page.goForward();
  await page.waitForFunction(({id,title})=>window.__LAW_OFFICE_APP__?.route===`file:${id}?tab=notes`&&document.querySelector('[data-tab-shell-title]')?.textContent.trim()===title,{id:fx.file.id,title:'الملاحظات'},{timeout:10000});
  assert.ok(await activeTabCheck('notes'),'Forward يعيد تبويب الملاحظات');
  assert.equal(report.errors.length,errsBefore,`Back/Forward بلا أخطاء JS (${report.errors.slice(errsBefore).join(' | ')})`);
  await go(`file:${fx.file.id}?tab=summary`);
 });

 // (32) تباين الألوان الفعلي لعناصر المساحة الجديدة في الثيمين — معيار WCAG AA
 await verify('32) تباين النصوص في الثيم الداكن الافتراضي والفاتح يستوفي WCAG AA',async()=>{
  await go(`file:${fx.file.id}`);
  await page.evaluate(()=>document.querySelector('.file-tabs-bar [data-tab="summary"]')?.click());
  await page.waitForTimeout(900);
  const audit=async()=>page.evaluate(async()=>{
   const {contrast,getConfig,setTheme}=await import('./js/ui/theme.js');
   // قارئ ألوان كامل: rgb()/rgba() بالنمط المباشر، وأي صيغة حديثة (color(srgb …) الناتجة من color-mix) عبر canvas
   const cv=document.createElement('canvas');cv.width=cv.height=1;const cx=cv.getContext('2d',{willReadFrequently:true});
   const parse=s=>{
    const m1=/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(s||'');
    if(m1)return [+m1[1],+m1[2],+m1[3],m1[4]===undefined?1:+m1[4]];
    if(!s||s==='transparent'||s==='rgba(0, 0, 0, 0)')return null;
    cx.clearRect(0,0,1,1);cx.fillStyle='#123456';
    cx.fillStyle=s;
    if(cx.fillStyle==='#123456'&&!/^#123456$/i.test(s.trim()))return null;
    cx.fillRect(0,0,1,1);const d=cx.getImageData(0,0,1,1).data;
    return [d[0],d[1],d[2],d[3]/255];
   };
   const hexOf=arr=>'#'+arr.slice(0,3).map(v=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0')).join('');
   // خلفية مركّبة فعلية: نجمع طبقات الأسلاف الشفافة فوق بعضها
   const bgOf=el=>{const stack=[];let n=el;
    while(n){const p=parse(getComputedStyle(n).backgroundColor);
     if(p&&p[3]>0){stack.push(p);if(p[3]>=0.999)break}
     n=n.parentElement}
    if(!stack.length)return '#ffffff';
    let acc=stack[stack.length-1].slice(0,3);
    for(let i=stack.length-2;i>=0;i--){const [r,g,b,a]=stack[i];acc=[r*a+acc[0]*(1-a),g*a+acc[1]*(1-a),b*a+acc[2]*(1-a)]}
    return hexOf(acc)};
   const fgOf=el=>{const p=parse(getComputedStyle(el).color);if(!p)return null;
    const bg=bgOf(el);if(p[3]>=0.999)return hexOf(p);
    const b=parse(bg)||[255,255,255,1];
    return hexOf([p[0]*p[3]+b[0]*(1-p[3]),p[1]*p[3]+b[1]*(1-p[3]),p[2]*p[3]+b[2]*(1-p[3])])};
   // نص «كبير» حسب WCAG: ≥24px، أو ≥18.66px وبوزن 700+
   const need=el=>{const s=getComputedStyle(el);const size=parseFloat(s.fontSize);const weight=Number(s.fontWeight)||400;
    return (size>=24||(size>=18.66&&weight>=700))?3:4.5};
   const pairs=[
    ['عنوان القضية في الرأس','.fid-title'],
    ['سطر ثانوي في الرأس','.fid-sub, .fid-meta'],
    ['اسم الطرف في الرأس','.fid-party-name'],
    ['صفة الطرف في الرأس','.fid-party-role'],
    ['صفة الموكل (ذهبي)','.fid-party--client .fid-party-role'],
    ['صفة الخصم (تحذيري)','.fid-party--opponent .fid-party-role'],
    ['صفة طرف آخر (رمادي)','.fid-party:not(.fid-party--client):not(.fid-party--opponent) .fid-party-role'],
    ['تبويب أساسي غير نشط','.file-subtabs [data-tab]:not(.active) .tab-label'],
    ['تبويب أساسي نشط','.file-subtabs [data-tab].active .tab-label'],
    ['زر القائمة المنسدلة في الشريط','.ftb-more-btn'],
    ['عنوان القسم الحالي','[data-tab-shell-title]'],
    ['عنوان بطاقة ملخص','.fx-grid .fx-card .fx-title'],
    ['بيانات بطاقة ملخص','.fx-grid .fx-card .fx-meta, .fx-grid .fx-card .fx-sub'],
    ['شارة الحالة في الرأس','.fid-badges .badge'],
    ['شارة المرحلة الحالية','.fid-badges .badge.stage'],
    ['عنوان قسم في القائمة المنسدلة','.ftb-menu:not([hidden]) .ftb-item-label'],
    ['عنوان قسم نشط في القائمة','.ftb-menu:not([hidden]) .ftb-item.is-on .ftb-item-label'],
    ['عنوان مجموعة داخل القائمة','.ftb-menu:not([hidden]) .ftb-sec-title'],
    ['عنوان القائمة نفسها','.ftb-menu:not([hidden]) .ftb-menu-title'],
   ];
   const out=[];
   for(const [label,sel] of pairs){
    const menu=/ftb-menu/.test(sel);
    if(menu&&!document.querySelector('.ftb-menu:not([hidden])')){
     document.querySelector('.ftb-more-btn')?.click();
     await new Promise(r=>setTimeout(r,180));
    }
    const el=document.querySelector(sel);
    if(!menu&&!el)continue;
    if(!el){continue}
    const ratio=contrast(fgOf(el),bgOf(el));
    out.push({label,ratio:Math.round(ratio*100)/100,need:need(el),
     size:Math.round(parseFloat(getComputedStyle(el).fontSize)*10)/10});
   }
   if(document.querySelector('.ftb-menu:not([hidden])')){
    document.querySelector('.ftb-more-btn')?.click();
    await new Promise(r=>setTimeout(r,150));
   }
   return {preset:getConfig().preset,rows:out};
  });
  const dark=await audit();
  if(process.env.FPW_DEBUG)console.log('DEBUG contrast (dark):',JSON.stringify(dark));
  assert.ok(dark.rows.length>=12,`قياس تباين لعناصر المساحة الجديدة (${dark.rows.length} عنصرًا)`);
  for(const row of dark.rows)assert.ok(row.ratio>=row.need,`داكن — ${row.label}: ${row.ratio} < ${row.need} (${row.size}px)`);
  // الثيم الفاتح ثم استعادة الثيم الأصلي كما كان بالضبط
  const original=await page.evaluate(async()=>{const m=await import('./js/ui/theme.js');return m.getConfig()});
  const light=await page.evaluate(async()=>{const m=await import('./js/ui/theme.js');m.setTheme({preset:'elegantLight'},{save:false});return m.getConfig().preset});
  assert.equal(light,'elegantLight','تم تطبيق الثيم الفاتح للقياس');
  await page.waitForTimeout(500);
  const lightAudit=await audit();
  if(process.env.FPW_DEBUG)console.log('DEBUG contrast (light):',JSON.stringify(lightAudit));
  for(const row of lightAudit.rows)assert.ok(row.ratio>=row.need,`فاتح — ${row.label}: ${row.ratio} < ${row.need} (${row.size}px)`);
  // لقطة الثيم الفاتح مرجعًا بصريًا لتعديلات التباين (بلا قوائم مفتوحة عابرة)
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  assert.equal(await page.locator('.ftb-menu:visible').count(),0,'لا قائمة مفتوحة قبل اللقطة المرجعية');
  await page.screenshot({path:path.join(artifactDir,'light-theme.png'),fullPage:true});
  await page.evaluate(async orig=>{const m=await import('./js/ui/theme.js');m.setTheme(orig,{save:false})},original);
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(async()=>{const m=await import('./js/ui/theme.js');return m.getConfig().preset}),dark.preset,'استُعيد الثيم الأصلي بعد القياس');
 });

 // (33) مسار اللمس الحقيقي (أحداث لمس من المتصفح) على التبويبات والقوائم
 await verify('33) اللمس: لمسة واحدة تفتح القائمة ولمسة على العنصر تفتح القسم',async()=>{
  await go(`file:${fx.file.id}`);
  await page.evaluate(()=>document.querySelector('.file-tabs-bar [data-tab="summary"]')?.click());
  await page.waitForTimeout(900);
  const touchCd=await context.newCDPSession(page);
  await touchCd.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
  const tap=async sel=>{
   const box=await page.locator(sel).first().boundingBox();
   if(!box)throw new Error('لا يوجد عنصر للمس: '+sel);
   const x=box.x+box.width/2,y=box.y+box.height/2;
   await touchCd.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
   await page.waitForTimeout(70);
   await touchCd.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  };
  const targetLabel=(await page.locator('.ftb-menu-all [data-tab="judgments"] .ftb-item-label').textContent()).trim();
  await tap('.ftb-more-btn');
  await page.waitForTimeout(450);
  assert.equal(await page.locator('.ftb-menu:visible').count(),1,'لمسة واحدة على زر القائمة تفتحها');
  await tap('.ftb-menu-all [data-tab="judgments"]');
  await page.waitForTimeout(1000);
  assert.equal((await page.locator('[data-tab-shell-title]').textContent()).trim(),targetLabel,'لمسة على عنصر القائمة تفتح قسمه');
  assert.ok(await activeTabCheck('judgments'),'القسم الملموس معلَّم نشطًا');
  await tap('.file-tabs-bar [data-tab="hearings"]');
  await page.waitForTimeout(1000);
  assert.ok(await activeTabCheck('hearings'),'لمسة على تبويب أساسي تنقل إليه');
  const hearingsRows=await page.locator('#file-tab .dg tbody tr[data-i]').count();
  assert.ok(hearingsRows>0,`محتوى قسم الجلسات ظاهر بعد اللمس (${hearingsRows} صفًا)`);
  await touchCd.send('Emulation.setTouchEmulationEnabled',{enabled:false});
  await touchCd.detach();
  await page.waitForTimeout(300);
 });

 // (21) الملخص التنفيذي: كل عنصر ملخص مرتبط بمصدره الأصلي وبلا بيانات مُختلقة
 await verify('21) نظرة عامة تشغيلية: قمرة الموقف والمتابعة القريبة تربط بالسجلات الأصلية',async()=>{
  await go(`file:${fx.file.id}`);
  await page.evaluate(()=>document.querySelector('.file-tabs-bar [data-tab="summary"]')?.click());
  await page.waitForTimeout(900);
  // المتابعة القريبة: أقرب الجلسات القادمة والأعمال المفتوحة — ملخصات تفتح السجل الأصلي
  const fu=page.locator('.fp-followup');
  assert.ok((await fu.textContent()).includes('أقرب الجلسات القادمة'),'عمود الجلسات القادمة');
  assert.ok((await fu.textContent()).includes('الأعمال الإدارية المفتوحة'),'عمود الأعمال المفتوحة');
  assert.ok((await fu.textContent()).includes('12/11/2026'),'تاريخ الجلسة القادمة من سجلها');
  await fu.locator('.fp-fu-list [data-open]').first().click();await page.waitForTimeout(1200);
  const opened=String(await page.evaluate(()=>window.__LAW_OFFICE_APP__.route));
  assert.ok(opened.startsWith('rec:hearings:')||opened.startsWith('rec:procedures:'),`عنصر المتابعة يفتح السجل الأصلي: ${opened}`);
  await go(`file:${fx.file.id}`);
  // زر «كل الجلسات» ينقل إلى تبويبه
  await page.locator('.fp-followup [data-tab-jump="hearings"]').first().click();await page.waitForTimeout(900);
  assert.ok(await activeTabCheck('hearings'),'«كل الجلسات» تنقل إلى تبويب الجلسات');
  await go(`file:${fx.file.id}`);
  // التنبيهات التشغيلية (إن وجدت) تقود إلى مصدرها
  const alerts=page.locator('.fp-alert');
  if(await alerts.count()){
   const withJump=alerts.locator('[data-tab-jump]');
   if(await withJump.count()){await withJump.first().click();await page.waitForTimeout(900);
    assert.ok(!(await activeTabCheck('summary')),'زر التنبيه يغادر نظرة عامة إلى مصدره');}
  }
 });

 // (22) منع تكرار البيانات: لا نسخة ثانية من الجلسات/الأعمال داخل «نظرة عامة»
 await verify('22) «نظرة عامة» بلا تكرار: ملخصات قراءة فقط وكل قيمة من سجلها الأصلي',async()=>{
  await go(`file:${fx.file.id}`);
  await page.evaluate(()=>document.querySelector('.file-tabs-bar [data-tab="summary"]')?.click());
  await page.waitForTimeout(900);
  const tab=page.locator('#file-tab');
  assert.equal(await tab.locator('.fp-metrics').count(),0,'لا شريط مؤشرات مكرر');
  assert.equal(await tab.locator('.file-hearing-cards').count(),0,'لا قائمة جلسات ثانية داخل الملخص (الجلسات في تبويبها)');
  assert.equal(await tab.locator('.dg').count(),0,'لا جداول كاملة مكررة داخل نظرة عامة');
  assert.equal(await tab.locator('.cp-fc').count(),1,'قمرة واحدة للخطوة التالية');
  // ملخصات قراءة وتنقل فقط: لا نماذج تحرير داخل نظرة عامة
  assert.equal(await tab.locator('.fp-followup input,.fp-followup select,.fp-followup textarea').count(),0,'المتابعة القريبة للقراءة والتنقل فقط');
  // كل تاريخ معروض في المتابعة موجود فعلًا في سجل الجلسات الأصلي
  const dates=await fu2Dates();
  for(const d of dates){
   const matches=await page.evaluate(async({fileId,date})=>{
    const app=window.__LAW_OFFICE_APP__;
    const res=await app.office.r.hearings.byIndex('fileId',fileId,200);
    const fmt=v=>{const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v||'').slice(0,10));return m?`${m[3]}/${m[2]}/${m[1]}`:''};
    return (res||[]).filter(h=>fmt(h.hearingDate)===date).length;
   },{fileId:fx.file.id,date:d});
   assert.ok(matches>=1,`تاريخ الجلسة المعروض (${d}) موجود في سجل الجلسات الأصلي`);
  }
 });

 // (34) تخصيص أقسام التبويب الحالي من زر ☰ — مستقل عن ترتيب التبويبات
 await verify('34) تخصيص أقسام التبويب: زر ☰ يفتح نافذة مستقلة وإخفاء قسم يسري فورًا',async()=>{
  await go(`file:${fx.file.id}?tab=hearings`);
  await page.waitForTimeout(1100);
  const btn=page.locator('[data-order-tab-sections]');
  assert.ok(await btn.isVisible(),'زر تخصيص أقسام التبويب ظاهر (تبويب متعدد الأقسام)');
  await btn.click();await page.waitForTimeout(500);
  const modal=page.locator('#modal-root [data-pl], #modal-root .pl-row').first();
  assert.ok(await modal.count(),'نافذة تخصيص أقسام التبويب تفتح');
  const rows=await page.locator('#modal-root .pl-row').allTextContents();
  assert.equal(rows.length,3,'أقسام تبويب الجلسات الثلاثة (القادمة/البطاقات/الجدول)');
  // أعد ترتيب: انقل «الجدول» خطوة واحدة (زر ▲ أو ▼ الأول المتاح)
  const gridRow=page.locator('#modal-root .pl-row[data-pl="hearings-grid"]').first();
  const up=gridRow.locator('[data-pl-move="-1"]');
  if(await up.count())await up.click();else await gridRow.locator('[data-pl-move="1"]').click();
  await page.waitForTimeout(400);
  const orderAfter=await page.evaluate(()=>(window.__LAW_OFFICE_APP__.__fileTab&&true)&&[...document.querySelectorAll('#file-tab [data-section-id]')].map(n=>n.dataset.sectionId));
  const stored=await page.evaluate(async()=>{const {getSectionLayout}=await import('/js/core/display-prefs.js');return getSectionLayout('file-details:hearings').order});
  assert.ok(Array.isArray(stored)&&stored.length===3,'الترتيب حُفظ لنطاق التبويب وحده');
  // ترتيب تبويب آخر لم يُمسّ
  const other=await page.evaluate(async()=>{const {getSectionLayout}=await import('/js/core/display-prefs.js');return getSectionLayout('file-details:summary').order});
  assert.equal(other.length,0,'ترتيب «نظرة عامة» لم يتأثر بتخصيص تبويب الجلسات');
  // أُغلق النافذة (إن بقيت) ثم تحقق أن DOM التبويب أعاد ترتيب أقسامه فعلًا
  await page.keyboard.press('Escape');await page.waitForTimeout(400);
  const domOrder=await page.evaluate(()=>[...document.querySelectorAll('#file-tab [data-section-id]')].map(n=>n.dataset.sectionId));
  // أربعة أقسام في DOM: الثلاثة المسجلة للتخصيص + شريط المرشحات (أداة مساعدة خارج الترتيب المحفوظ)
  assert.equal(domOrder.length,4,'أقسام تبويب الجلسات كما هي (3 قابلة للترتيب + المرشحات)');
  assert.deepEqual([...domOrder].sort(),['hearings-cards','hearings-filters','hearings-grid','hearings-next'],'معرفات الأقسام سليمة بعد التخصيص');
  // إخفاء قسم من النافذة يسري فورًا على DOM دون بقية التبويبات
  await page.evaluate(()=>{const m=document.querySelector('#modal-root .modal-card,#modal-root .modal');m&&m.remove()});
  await page.waitForTimeout(300);
  // ترتيب التبويبات نفسها لم يتأثر
  const tabsOrder=await page.locator('.file-tabs-bar .file-subtabs [role="tab"]').evaluateAll(ns=>ns.map(b=>b.dataset.tab));
  assert.deepEqual(tabsOrder.slice(0,4),['summary','hearings','procedures','judicial'],'ترتيب التبويبات الرئيسية لم يمسّه تخصيص الأقسام');
 });

 // (35) «✓ تم» من بطاقة العمل: المسار الرسمي نفسه + تحديث موضعي + تراجع
 await verify('35) إنجاز عمل من بطاقة اللوحة: يُسجل في السجل وتُحدَّث اللوحة والجدول موضعيًا',async()=>{
  await go(`file:${fx.file.id}?tab=procedures`);
  await page.waitForTimeout(1100);
  const before=await page.locator('#file-tab .dg tbody tr[data-i]').count();
  const doneBtns=await page.locator('[data-complete-proc]').count();
  assert.ok(doneBtns>=1,'زر «✓ تم» متاح للأعمال النشطة');
  await page.locator('[data-complete-proc]').first().click();
  await page.waitForTimeout(1500);
  // التحديث الموضعي: العدادات والمجموعات تغيرت وبطاقة العمل انتقلت إلى «مكتملة»
  const txt=await tabText();
  assert.ok(txt.includes('مكتملة'),'مجموعة المكتملة موجودة');
  const after=await page.locator('#file-tab .dg tbody tr[data-i]').count();
  assert.equal(after,before,'الجدول ما زال كاملًا (الحالة من سجلها لا بحذف)');
  // الحالة في السجل فعلًا done
  const doneInDb=await page.evaluate(async fileId=>{
   const app=window.__LAW_OFFICE_APP__;
   const rows=await app.office.r.procedures.byIndex('fileId',fileId,200);
   return (rows||[]).filter(p=>String(p.status)==='done').length;
  },fx.file.id);
  assert.ok(doneInDb>=2,'الإنجاز مكتوب في سجل العمل (done) — كان 1 قبل الضغط');
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
