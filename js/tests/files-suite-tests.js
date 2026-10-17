// ============================================================
// اختبارات مجموعة الملفات (البنود 1–100) — منطق صرف + خدمات حقيقية
// على IndexedDB وهمي. لا تُختبر الواجهة هنا؛ تُختبر العقود التي تستند
// إليها الواجهة: الاستعلام، الحجب والتشابه، التنبيهات، الجودة، العلاقات،
// سجلات الإدارة، مساحات العمل، والتصدير الآمن.
// ============================================================
import {upgradeSchema,SCHEMA,STORES} from '../db/schema.js';
import {closeFile,archiveFile,reopenFile} from '../services/legal-files.js';
import {saveEntity} from '../services/entity-save.js';
import {DatabaseContext} from '../db/database-context.js';
import {Office} from '../services/office.js';
import {SCHEMA_VERSION} from '../core/constants.js';
import {clearWorkspaces,getWorkspaces,saveWorkspace,renameWorkspace,duplicateWorkspace,deleteWorkspace,applyWorkspaceToList,builtInWorkspaces,exportSettingsTemplate,importSettingsTemplate,sanitizeGridState,EXPORT_FORMAT} from '../services/workspace-views.js';
import {
 getChecklistTemplate,getFileChecklist,toggleChecklistItem,resetFileChecklist,
 saveChecklistTemplate,resetChecklistTemplate,defaultChecklist,
 listAdminDecisions,addAdminDecision,deleteAdminDecision,
 recordFieldChanges,listFieldHistory,clearFieldHistory,setFieldHistoryEnabled,
 saveReportSnapshot,listReportSnapshots,deleteReportSnapshot,
 recordFileVisit,getFileVisits,updateVisitTab,removeFileVisit,clearFileVisits
} from '../services/files-admin.js';
import {
 loadFilePortfolio,buildAttention,fileDistribution,workloadByProcedureType,workloadByMonth,
 comparePeriods,buildQualityReport,detectDuplicateFiles,buildRelationAudit,compareFileBundles,
 buildFreshness,searchPortfolio,administrativeCompleteness,buildVerifiableSummary,contextOf
} from '../services/files-hub.js';
import {mountGrid} from '../ui/datagrid.js';
import {modal,closeModal} from '../ui/modal.js';
import {fsBarChart,reviewImpact} from '../ui/files-ui.js';
import {filesWorkspaceHtml,bindFilesChrome,paintFilesWorkspace} from '../modules/files-workspace.js';
import {openFilesCenter,openFileChecklist,openFileQuickDrawer} from '../modules/files-suite.js';
import {
 parseFileQuery,normalizeNumberCode,numberVariants,scoreFile,rankFiles,
 highlightParts,matchExcerpt,administrativeState
} from '../core/files-query.js';

function openDb(name,version=SCHEMA_VERSION){
 return new Promise((resolve,reject)=>{
  const request=indexedDB.open(name,version);
  request.onupgradeneeded=event=>upgradeSchema(request.result,event.target.transaction);
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error);
 });
}
const put=(office,store,row)=>office.r[store].put({isDeleted:false,version:1,createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z',...row});

function seedPortfolio(){
 const files=[
  {id:'f1',fileNumber:'2026/000001',title:'نزاع تجاري — شركة النور',fileType:'مدني',status:'open',openedAt:'2026-02-01',responsibleLawyer:'',nextStep:'متابعة المستندات',nextStepDate:'2020-01-01',lastActivityAt:'2020-01-01',updatedAt:'2020-01-01',notes:'ملاحظات داخلية عن مستندات الشركة'},
  {id:'f2',fileNumber:'2026/000002',title:'نزاع تجاري — شركة النور',fileType:'مدني',status:'منتهٍ',openedAt:'2026-03-01',responsibleLawyer:'أ. سامي',lastActivityAt:'2026-09-01',updatedAt:'2026-09-01',notes:''},
  {id:'f3',fileNumber:'2026/000003',title:'قضية أسرة',fileType:'أسرة',status:'open',openedAt:'2025-01-01',responsibleLawyer:'أ. هدى',lastActivityAt:'2026-09-20',updatedAt:'2026-09-20',notes:''}
 ];
 const parties=[
  {id:'p1',fileId:'f1',partyKind:'client',clientId:'c1',name:'أحمد محمود',role:'مدعٍ',sequence:1},
  {id:'p2',fileId:'f1',partyKind:'opponent',name:'شركة النور',role:'مدعى عليه',sequence:2},
  {id:'p3',fileId:'f2',partyKind:'client',clientId:'c1',name:'أحمد محمود',role:'مدعٍ',sequence:1},
  {id:'p4',fileId:'f2',partyKind:'opponent',name:'شركة النور',role:'مدعى عليه',sequence:2},
  {id:'p5',fileId:'f3',partyKind:'client',clientId:'c2',name:'منى علي',role:'مدعية',sequence:1}
 ];
 const stages=[
  {id:'s1',fileId:'f1',stageType:'ابتدائي',caseNumber:'1200',caseYear:'2026',status:'open',courtId:'المحكمة التجارية'},
  {id:'s2',fileId:'f2',stageType:'استئناف',caseNumber:'1200',caseYear:'2026',status:'closed',courtId:'محكمة الاستئناف'}
 ];
 const relations=[
  {id:'r1',sourceFileId:'f1',targetFileId:'f2',relationType:'استئناف',createdAt:'2026-03-01'},
  {id:'r2',sourceFileId:'f2',targetFileId:'f2',relationType:'ذاتي',createdAt:'2026-03-02'},
  {id:'r3',sourceFileId:'f1',targetFileId:'missing',relationType:'مرتبط',createdAt:'2026-03-03'},
  {id:'r4',sourceFileId:'f1',targetFileId:'f2',relationType:'استئناف',createdAt:'2026-03-04'}
 ];
 const procedures=[
  {id:'pr1',fileId:'f1',type:'إعلان',status:'open',internalDueDate:'2020-01-01',actionDate:'2026-08-01'},
  {id:'pr2',fileId:'f1',type:'إعلان',status:'done',internalDueDate:'2026-08-01',actionDate:'2026-08-02'},
  {id:'pr3',fileId:'f2',type:'تنفيذ',status:'open',internalDueDate:'2026-10-01',actionDate:'2026-09-01'}
 ];
 const hearings=[{id:'h1',fileId:'f1',hearingDate:'2026-09-10',status:'done'},{id:'h2',fileId:'f1',hearingDate:'2026-10-22',status:'scheduled'}];
 const serviceRecords=[{id:'sr1',fileId:'f1',serviceDate:'2026-09-02',status:'done'}];
 const by=(rows,key)=>rows.reduce((map,row)=>{(map[row[key]]=map[row[key]]||[]).push(row);return map},{});
 const fileById=new Map(files.map(file=>[file.id,file]));
 const relationsByFile=new Map();
 for(const relation of relations){
  for(const fileId of [relation.sourceFileId,relation.targetFileId]){
   if(!relationsByFile.has(fileId))relationsByFile.set(fileId,[]);
   relationsByFile.get(fileId).push(relation);
  }
 }
 return {
  files,fileById,partiesByFile:new Map(Object.entries(by(parties,'fileId'))),
  stagesByFile:new Map(Object.entries(by(stages,'fileId'))),
  proceduresByFile:new Map(Object.entries(by(procedures,'fileId'))),
  relations,relationsByFile,hearings,serviceRecords,adminByFile:new Map(),
  more:{files:false,parties:false,stages:false,relations:false,procedures:false,hearings:false,serviceRecords:false,adminRows:false},
  limits:{files:5000,parties:30000,stages:5000,relations:5000,procedures:5000,hearings:5000,serviceRecords:3000,adminRows:5000},
  generatedAt:'2026-10-17T00:00:00.000Z'
 };
}

export async function runFilesSuiteTests(test,expect){
 // ===== 1) الاستعلام الصرف =====
 test('files-query: تطبيع رقم الملف وصيغه',()=>{
  expect(normalizeNumberCode('٠٠٠٤/٢٠٢٦')).toBe('4/2026');
  const variants=numberVariants('4/2026');
  expect(variants.includes('4/2026')).toBe(true);
  expect(variants.includes('2026/4')).toBe(true);
  expect(variants.includes('42026')).toBe(true);
 });
 test('files-query: تحليل المعايير الصريحة والنص الحر',()=>{
  const parsed=parseFileQuery('نوع:مدني حالة:open أحمد 2026');
  expect(parsed.criteria.type).toBe('مدني');
  expect(parsed.criteria.status).toBe('open');
  expect(parsed.tokens.includes('احمد')).toBe(true);
  expect(parsed.ignoredKeys.length).toBe(0);
 });
 test('files-query: مفتاح غير معروف يُعلن ولا يُسقط البحث',()=>{
  const parsed=parseFileQuery('فرع:القاهرة أحمد');
  expect(parsed.ignoredKeys.includes('فرع')).toBe(true);
  expect(parsed.tokens.includes('احمد')).toBe(true);
 });
 const p=seedPortfolio();
 const f1=p.fileById.get('f1');
 test('files-query: مطابقة معيار الموكل من الأطراف لا من نسخة',()=>{
  expect(scoreFile(f1,parseFileQuery('موكل:احمد'),contextOf(p,'f1'))>0).toBe(true);
  expect(scoreFile(f1,parseFileQuery('موكل:مني'),contextOf(p,'f1'))).toBe(0);
 });
 test('files-query: ترتيب النتائج يحافظ على السجلات المطابقة فقط',()=>{
  const ranked=rankFiles(p.files,parseFileQuery('تجاري'),file=>contextOf(p,file.id));
  expect(ranked.length).toBe(2);
  expect(ranked.every(item=>item.score>0)).toBe(true);
 });
 test('files-query: التمييز النصي لا يغيّر النص الأصلي',()=>{
  const parts=highlightParts('نزاع تجاري — شركة النور',parseFileQuery('تجاري'));
  expect(parts.map(item=>item.text).join('')).toBe('نزاع تجاري — شركة النور');
  expect(parts.some(item=>item.hit)).toBe(true);
 });
 test('files-query: المقتطف محدود حول أول تطابق',()=>{
  const excerpt=matchExcerpt(`مقدمة طويلة ${'كلمة '.repeat(40)}تجاري${' كلمة'.repeat(40)}`,parseFileQuery('تجاري'));
  expect(Boolean(excerpt)).toBe(true);
  expect(excerpt.text.length<200).toBe(true);
 });
 test('files-query: الحالة الإدارية تميّز الأرشيف والحذف والإنهاء',()=>{
  expect(administrativeState({status:'open'})).toBe('open');
  expect(administrativeState({status:'منتهٍ'})).toBe('closed');
  expect(administrativeState({isArchived:true,status:'open'})).toBe('archived');
  expect(administrativeState({isDeleted:true})).toBe('deleted');
 });

 // ===== 2) مركز الملفات: تنبيه/جودة/تشابه/علاقات/إحصاء =====
 test('hub: التنبيهات تحمل سببًا وأولوية ومصدرًا ورابط تبويب',()=>{
  const items=buildAttention(p,{today:'2026-10-17'});
  const forF1=items.filter(item=>item.fileId==='f1');
  expect(forF1.some(item=>item.reasonCode==='overdueStep'&&item.priority==='high')).toBe(true);
  expect(forF1.some(item=>item.reasonCode==='missingResponsible')).toBe(true);
  expect(forF1.every(item=>item.reason&&item.source&&item.tab)).toBe(true);
  // الملف المنتهي لا يظهر في طابور الانتباه التشغيلي.
  expect(items.some(item=>item.fileId==='f2')).toBe(false);
 });
 test('hub: تنبيه «نشاط قديم» لا يظهر بلا تاريخ مسجل',()=>{
  const items=buildAttention({...p,files:[{id:'x',title:'بلا تاريخ',status:'open'}],partiesByFile:new Map([['x',[{}]]]),stagesByFile:new Map([['x',[{}]]]),adminByFile:new Map()},{today:'2026-10-17'});
  expect(items.some(item=>item.reasonCode==='stale')).toBe(false);
 });
 test('hub: الاكتمال الإداري لا يدّعي اكتمالًا قانونيًا',()=>{
  const result=administrativeCompleteness(f1,{parties:contextOf(p,'f1').parties,stages:contextOf(p,'f1').stages});
  expect(result.percent>0).toBe(true);
  expect(result.percent<100).toBe(true);
  expect(result.disclaimer.includes('ليس اكتمالًا قانونيًا')).toBe(true);
  expect(result.missing.some(item=>item.key==='responsibleLawyer')).toBe(true);
 });
 test('hub: جودة البيانات تصنّف الخطأ المؤكد عن النقص عن التنبيه',()=>{
  const report=buildQualityReport(p,{today:'2026-10-17'});
  expect(report.issues.some(item=>item.code==='relation-self'&&item.level==='error')).toBe(true);
  expect(report.issues.some(item=>item.code==='relation-missing-target'&&item.level==='error')).toBe(true);
  expect(report.issues.some(item=>item.code==='lawyer'&&item.level==='missing')).toBe(true);
  expect(report.issues.some(item=>item.code==='relation-duplicate'&&item.level==='warning')).toBe(true);
  expect(report.byLevel.error>0).toBe(true);
 });
 test('hub: التشابه يكتشف العنوان/الرقم/الموكل دون دمج',()=>{
  const result=detectDuplicateFiles(p);
  expect(result.candidates.length>0).toBe(true);
  expect(result.candidates[0].reasons.length>0).toBe(true);
  expect(result.note.includes('لا دمج')).toBe(true);
  expect(result.scanned.comparisons<1000).toBe(true);
 });
 test('hub: تدقيق العلاقات يعزل اليتيمة والمكررة والذاتية',()=>{
  const audit=buildRelationAudit(p);
  expect(audit.total).toBe(4);
  expect(audit.broken.length).toBe(1);
  expect(audit.self.length).toBe(1);
  expect(audit.duplicates.length).toBe(1);
  expect(audit.note.includes('لا يصلح ولا يحذف')).toBe(true);
 });
 test('hub: التوزيعات والأحمال تعتمد على الحقول المسجلة',()=>{
  const types=fileDistribution(p,{key:'fileType'});
  expect(types[0].count).toBe(2);
  const workload=workloadByProcedureType(p);
  const announcement=workload.find(row=>row.type==='إعلان');
  expect(announcement.total).toBe(2);
  expect(announcement.done).toBe(1);
  const months=workloadByMonth(p,{months:3,today:'2026-10-17'});
  expect(months.length).toBe(3);
  expect(months.at(-1).hearings).toBe(1);
 });
 test('hub: مقارنة الفترات تعلن غياب الأساس ولا تقسم على صفر',()=>{
  const result=comparePeriods(p.files,{dateField:'openedAt',periodA:{from:'2026-01-01',to:'2026-12-31'},periodB:{from:'2025-01-01',to:'2025-12-31'}});
  expect(result.a).toBe(2);
  expect(result.b).toBe(1);
  expect(result.percent).toBe(-50);
  const zero=comparePeriods([],{dateField:'openedAt',periodA:{from:'2026-01-01',to:'2026-01-31'},periodB:{from:'2026-02-01',to:'2026-02-28'}});
  expect(zero.percent).toBe(null);
  expect(zero.a).toBe(0);
 });
 test('hub: الحداثة تفصل النشاط القانوني عن التعديل التقني',()=>{
  const rows=buildFreshness(p,{today:'2026-10-17',staleDays:45});
  const f1row=rows.find(row=>row.fileId==='f1');
  expect(f1row.status).toBe('stale');
  expect(f1row.lastLegal).toBe('2020-01-01');
  expect(f1row.note.includes('منفصلان')).toBe(true);
 });
 test('hub: الحداثة تفصل النشاط القانوني عن التعديل التقني وعن زيارة المستخدم',()=>{
  const rows=buildFreshness(p,{today:'2026-10-17',visits:[{fileId:'f1',at:'2026-10-16T09:00:00Z'}]});
  const row=rows.find(item=>item.fileId==='f1');
  expect(row.lastReview.startsWith('2026-10-16')).toBe(true);
  expect(row.status).toBe('stale');
  const newer=buildFreshness({...p,visits:undefined,files:[{id:'x',title:'طازج',status:'open',lastActivityAt:'2026-10-16'}]},{today:'2026-10-17'});
  expect(newer[0].status).toBe('fresh');
 });
 test('hub: البحث المركب يرتب ويقتطع ويحافظ على المصدر',()=>{
  const result=searchPortfolio(p,parseFileQuery('موكل:احمد'),{limit:10});
  expect(result.total).toBe(2);
  expect(result.rows.length).toBe(2);
  expect(result.source.includes('files')).toBe(true);
  expect(result.rows[0].parties.length>0).toBe(true);
 });
 test('hub: الملخص القابل للتحقق يعدد المصادر والنواقص',()=>{
  const summary=buildVerifiableSummary(p,'f1');
  expect(summary.lines.some(line=>line.source==='files.fileNumber'&&line.available)).toBe(true);
  expect(summary.lines.some(line=>line.label==='المحامي المسؤول'&&!line.available)).toBe(true);
  expect(summary.missingCount>0).toBe(true);
  expect(summary.disclaimer.includes('لا يخترع')).toBe(true);
 });
 test('hub: مقارنة الملفين تُظهر الفروق والأطراف الأحادية',()=>{
  const a={id:'f1',file:{...f1,title:'أ'},parties:[{name:'أحمد',role:'مدعٍ'}],stages:[{stageType:'ابتدائي',caseNumber:'1',caseYear:'2026'}]};
  const b={id:'f2',file:{...p.fileById.get('f2'),title:'ب'},parties:[{name:'منى',role:'مدعية'}],stages:[]};
  const result=compareFileBundles(a,b);
  expect(result.fields.some(field=>!field.same)).toBe(true);
  expect(result.parties.onlyA.length).toBe(1);
  expect(result.parties.onlyB.length).toBe(1);
  expect(result.stages.onlyA.length).toBe(1);
  expect(result.note.includes('لا تغيّر أي سجل')).toBe(true);
 });

 // ===== 3) خدمات الإدارة على قاعدة فعلية =====
 const dbName=`AhmadKhudairLawOfficeDB__test__files_suite__${Date.now()}`;
 const db=await openDb(dbName);
 const ctx=new DatabaseContext(db,{id:'fs1',databaseName:dbName,displayName:'اختبار الملفات'},{deviceId:'files-suite-test'});
 const office=new Office(ctx);
 try{
  await put(office,'files',{id:'F1',fileNumber:'2026/000010',title:'ملف اختبار',fileType:'مدني',status:'open',openedAt:'2026-01-01',responsibleLawyer:'أ. سامي',nextStep:'متابعة إعلان',nextStepDate:'2026-09-01',lastActivityAt:'2026-10-01',updatedAt:'2026-10-01'});
  await office.r.fileParties.put({id:'P1',fileId:'F1',partyKind:'client',clientId:'C1',name:'أحمد محمود',role:'مدعٍ',sequence:1,isActive:true,isDeleted:false,version:1,createdAt:'2026-01-01',updatedAt:'2026-01-01'});
  await office.r.cases.put({id:'S1',fileId:'F1',stageType:'ابتدائي',caseNumber:'10',caseYear:'2026',status:'open',isDeleted:false,version:1,createdAt:'2026-01-01',updatedAt:'2026-01-01'});
  await office.r.procedures.put({id:'PR1',fileId:'F1',type:'إعلان',status:'open',internalDueDate:'2026-09-01',actionDate:'2026-09-01',isDeleted:false,version:1,createdAt:'2026-01-01',updatedAt:'2026-01-01'});
  await office.r.fileRelations.put({id:'R1',sourceFileId:'F1',targetFileId:'F2',relationType:'مرتبط',isDeleted:false,version:1,createdAt:'2026-01-01',updatedAt:'2026-01-01'});
  await put(office,'files',{id:'F2',fileNumber:'2026/000011',title:'ملف آخر',fileType:'مدني',status:'open',openedAt:'2026-01-02',responsibleLawyer:'أ. هدى',lastActivityAt:'2026-10-02',updatedAt:'2026-10-02'});

  // اللقطة الكاملة: كل الأطراف والمراحل والعلاقات تُقرأ من المخازن الأصلية.
  const portfolio=await loadFilePortfolio(office);
  test('office: لقطة الملفات تقرأ الأطراف والمراحل والعلاقات والإجراءات',()=>{
   expect(portfolio.files.length).toBe(2);
   expect((portfolio.partiesByFile.get('F1')||[]).length).toBe(1);
   expect((portfolio.stagesByFile.get('F1')||[]).length).toBe(1);
   expect((portfolio.proceduresByFile.get('F1')||[]).length).toBe(1);
   expect(portfolio.relations.length).toBe(1);
   expect(portfolio.more.files).toBe(false);
  });
  test('office: تنبيهات اللقطة تلتقط الموعد الإداري المنقضي',()=>{
   const items=buildAttention(portfolio,{today:'2026-10-17'});
   expect(items.some(item=>item.fileId==='F1'&&item.reasonCode==='overdueStep')).toBe(true);
  });
  test('office: بحث المركز يجد بالموكل من fileParties',()=>{
   const result=searchPortfolio(portfolio,parseFileQuery('موكل:احمد'));
   expect(result.total).toBe(1);
   expect(result.rows[0].file.id).toBe('F1');
  });

  // ===== قوائم التحقق =====
  test('files-admin: قالب التحقق الافتراضي يُحفظ في settings بلا تغيير مخطط',async()=>{
   const template=await getChecklistTemplate(office,'default');
   expect(template.items.length).toBe(defaultChecklist('default').length);
   expect(template.custom).toBe(false);
   const saved=await saveChecklistTemplate(office,'default',[{id:'a',label:'بند أول'},{id:'b',label:'بند ثان'}]);
   expect(saved.items.length).toBe(2);
   const stored=await office.r.settings.get('fileAdmin:checklist-template:default');
   expect(Boolean(stored)).toBe(true);
   expect(stored.value.items.length).toBe(2);
   // الإصدار يزيد ولا يمس أي مخزن قانوني.
   expect(Number(stored.version)).toBe(1);
  });
  test('files-admin: إنجاز بند لا يعدّل سجل الملف',async()=>{
   await saveChecklistTemplate(office,'default',[{id:'a',label:'بند أول'},{id:'b',label:'بند ثان'}]);
   const before=await office.r.files.get('F1');
   await toggleChecklistItem(office,'F1','a',{done:true});
   const checklist=await getFileChecklist(office,'F1','default');
   expect(checklist.items.find(item=>item.id==='a').done).toBe(true);
   expect(checklist.done).toBe(1);
   const after=await office.r.files.get('F1');
   expect(after.version).toBe(before.version);
   expect(after.updatedAt).toBe(before.updatedAt);
   await resetFileChecklist(office,'F1');
   expect((await getFileChecklist(office,'F1','default')).done).toBe(0);
  });
  test('files-admin: بند أُزيل من القالب يبقى محفوظًا كسجل قديم',async()=>{
   await saveChecklistTemplate(office,'default',[{id:'a',label:'بند أول'},{id:'b',label:'بند ثان'}]);
   await toggleChecklistItem(office,'F1','b',{done:true});
   await saveChecklistTemplate(office,'default',[{id:'a',label:'بند أول'}]);
   const checklist=await getFileChecklist(office,'F1','default');
   expect(checklist.items.some(item=>item.id==='b'&&item.legacy)).toBe(true);
   expect(checklist.items.find(item=>item.id==='b').done).toBe(true);
  });
  test('files-admin: القرارات الإدارية حذف منطقي بلا مسح',async()=>{
   const item=await addAdminDecision(office,'F1',{text:'قرار متابعة إداري',author:'المدير'});
   expect((await listAdminDecisions(office,'F1')).length).toBe(1);
   await deleteAdminDecision(office,'F1',item.id,{reason:'تجربة'});
   expect((await listAdminDecisions(office,'F1')).length).toBe(0);
   const row=await office.r.settings.get('fileAdmin:decisions:F1');
   expect(row.value.items[0].deleted).toBe(true);
   expect(row.value.items[0].deleteReason).toBe('تجربة');
  });
  test('files-admin: تاريخ الحقول يختصر القيم الطويلة ويحترم الإيقاف',async()=>{
   const long='x'.repeat(700);
   await recordFieldChanges(office,'F1',[{field:'title',label:'العنوان',before:'قديم',after:long}],{source:'test'});
   const history=await listFieldHistory(office,'F1');
   expect(history[0].changes[0].after.length).toBe(500);
   expect(history[0].changes[0].truncated).toBe(true);
   await setFieldHistoryEnabled(false);
   const skipped=await recordFieldChanges(office,'F1',[{field:'title',label:'العنوان',before:'أ',after:'ب'}],{source:'test'});
   expect(skipped).toBe(null);
   await setFieldHistoryEnabled(true);
   await clearFieldHistory(office,'F1');
   expect((await listFieldHistory(office,'F1')).length).toBe(0);
  });
  test('files-admin: لقطات التقرير بحد خمس ولا تنسخ القاعدة',async()=>{
   for(let index=0;index<6;index++)await saveReportSnapshot(office,'F1',{sections:{lines:[{label:'سطر',value:String(index)}]}},{note:`لقطة ${index}`});
   const snapshots=await listReportSnapshots(office,'F1');
   expect(snapshots.length).toBe(5);
   expect(snapshots.map(item=>item.note).includes('لقطة 5')).toBe(true);
   await deleteReportSnapshot(office,'F1',snapshots[0].id);
   expect((await listReportSnapshots(office,'F1')).length).toBe(4);
   expect(Array.isArray(snapshots[0].sections.lines)).toBe(true);
  });
  test('files-admin: سجل الزيارات تفضيل محدود ومنفصل عن النشاط',async()=>{
   clearFileVisits({scope:'test'});
   for(let index=0;index<45;index++)recordFileVisit(`F${index}`,{scope:'test',tab:'summary',title:`ملف ${index}`});
   expect(getFileVisits('test').length).toBe(40);
   updateVisitTab('F44','hearings',{scope:'test'});
   expect(getFileVisits('test').find(item=>item.fileId==='F44').tab).toBe('hearings');
   removeFileVisit('F44',{scope:'test'});
   expect(getFileVisits('test').some(item=>item.fileId==='F44')).toBe(false);
   const activity=await office.r.activityLog.all(10);
   expect(activity.length).toBe(0);
  });

  // ===== مساحات العمل والتصدير =====
  test('workspaces: حفظ/تسمية/نسخ/حذف مساحة على التفضيلات فقط',()=>{
   clearWorkspaces();
   const first=saveWorkspace({name:'مراجعة الأسبوع',list:{chip:'action',q:'تجاري'},tab:'summary'});
   expect(getWorkspaces().length).toBe(1);
   const renamed=renameWorkspace(first.id,'مراجعة أسبوعية');
   expect(renamed.name).toBe('مراجعة أسبوعية');
   const copy=duplicateWorkspace(first.id);
   expect(copy.name.includes('نسخة')).toBe(true);
   expect(getWorkspaces().length).toBe(2);
   deleteWorkspace(copy.id);
   expect(getWorkspaces().length).toBe(1);
   expect(builtInWorkspaces().length>=6).toBe(true);
  });
  test('workspaces: التطبيق يغيّر عرض القائمة فقط',()=>{
   const st={q:'قديم',preset:'year',chip:'pinned',status:'closed',from:'2020-01-01',to:'2020-12-31'};
   applyWorkspaceToList(st,{list:{q:'',preset:'all',chip:'action',status:'all'}});
   expect(st.chip).toBe('action');
   expect(st.status).toBe('all');
   expect(st.q).toBe('');
  });
  test('workspaces: لقطة الجدول تمر بمفاتيح بيضاء فقط',()=>{
   const clean=sanitizeGridState({hidden:['title','x'],order:['title'],density:'compact',fontSize:'large',cards:true,appear:{background:'url(javascript:alert(1))',color:'#fff'},sort:[{key:'openedAt',dir:'desc'}],unknown:'drop',widths:{title:120}});
   expect(clean.hidden.length).toBe(2);
   expect(clean.density).toBe('compact');
   expect(clean.appear.color).toBe('#fff');
   expect(clean.appear.background).toBe(undefined);
   expect(clean.unknown).toBe(undefined);
  });
  test('workspaces: التصدير لا يحتوي أي سجل ولا بيانات موكل',()=>{
   const {json,payload}=exportSettingsTemplate({gridState:{cards:true,hidden:['title']},workspaces:getWorkspaces()});
   expect(payload.containsOfficeRecords).toBe(false);
   expect(payload.format).toBe(EXPORT_FORMAT);
   expect(json.includes('أحمد محمود')).toBe(false);
   expect(json.includes('nationalId')).toBe(false);
   expect(json.includes('"fileNumber"')).toBe(false);
  });
  test('workspaces: الاستيراد يرفض ملفًا يعلن احتواءه سجلات',()=>{
   let rejected=false;
   try{importSettingsTemplate({format:EXPORT_FORMAT,version:1,containsOfficeRecords:true,workspaces:[]})}catch{rejected=true}
   expect(rejected).toBe(true);
  });
  test('workspaces: الاستيراد لا يحذف ولا يستبدل المساحات القائمة',()=>{
   clearWorkspaces();
   saveWorkspace({name:'قائمة',list:{chip:'active'}});
   const payload={format:EXPORT_FORMAT,version:1,containsOfficeRecords:false,workspaces:[{name:'قائمة',list:{chip:'action'},kind:'files'},{name:'مستوردة جديدة',list:{chip:'stale'}}]};
   const result=importSettingsTemplate(payload);
   expect(result.importedWorkspaces).toBe(2);
   expect(result.renamed.length).toBe(1);
   expect(getWorkspaces().length).toBe(3);
   expect(getWorkspaces().some(item=>item.name==='قائمة')).toBe(true);
  });
  // ===== 3.5) الجدول: تحديد كل النتائج وطرق العرض =====
 test('datagrid: تحديد كل النتائج يحدد صفوف الاستعلام لا الصفحة فقط',async()=>{
  const host=document.createElement('div');document.body.append(host);
  const rows=[{id:'a',t:'أول'},{id:'b',t:'ثانٍ'},{id:'c',t:'ثالث'}];
  const grid=mountGrid(host,{rows,columns:[{key:'t',label:'T'}],storageKey:'fs-test-grid',selectable:true,title:'تحديد'});
  host.querySelector('.dg-select-results').click();
  await new Promise(resolve=>setTimeout(resolve,10));
  expect(grid.getSelection().length).toBe(3);
  expect(grid.getSelectionCount()).toBe(3);
  expect(grid.getPageInfo().shown).toBe(3);
  host.remove();
 });
 test('datagrid: طرق العرض المحفوظة تدعم إعادة التسمية والنسخ والحذف',()=>{
  const host=document.createElement('div');document.body.append(host);
  const rows=[{id:'a',t:'أول'}];
  const grid=mountGrid(host,{rows,columns:[{key:'t',label:'T'}],storageKey:'fs-test-views',selectable:true,title:'عرض'});
  grid.saveSavedView('عرض تجريبي');
  expect(grid.getSavedViews().length).toBe(1);
  expect(grid.getActiveView()).toBe('عرض تجريبي');
  expect(grid.renameSavedView('عرض تجريبي','عرض جديد')).toBe(true);
  expect(grid.getSavedViews()[0].name).toBe('عرض جديد');
  const copy=grid.duplicateSavedView('عرض جديد');
  expect(grid.getSavedViews().length).toBe(2);
  expect(grid.deleteSavedView(copy)).toBe(1);
  expect(grid.getSavedViews().length).toBe(1);
  host.remove();
 });

 // ===== 3.6) واجهة المركز والمراجعة (DOM حقيقي خفيف) =====
 const uiApp={ctx,office,go:route=>{uiApp.lastRoute=route},back:()=>{},refresh:()=>{},__lists:{files:{q:'',preset:'all',chip:'all',status:'all'}}};
 test('ui: مركز الملفات يرسم ويبدّل التبويبات ويبحث مركّبًا',async()=>{
  const card=await openFilesCenter(uiApp);
  expect(Boolean(card)).toBe(true);
  const body=card.querySelector('.fs-sheet-body');
  expect(body.textContent.includes('ما يحتاج انتباهي')).toBe(true);
  card.querySelector('[data-center-tab="quality"]').click();
  expect(body.textContent.includes('جودة البيانات')).toBe(true);
  const input=body.querySelector('[data-center-q]');
  input.value='موكل:احمد';
  input.dispatchEvent(new Event('input',{bubbles:true}));
  await new Promise(resolve=>setTimeout(resolve,230));
  expect(body.textContent.includes('نتيجة مطابقة')).toBe(true);
  expect(body.textContent.includes('أقرب ملف مطابق')).toBe(true);
  expect(Boolean(body.querySelector('[data-summary-file]'))).toBe(true);
  closeModal();
 });
 test('ui: قائمة التحقق تحفظ البند دون تغيير الملف',async()=>{
  await resetFileChecklist(office,'F1');
  const card=await openFileChecklist(uiApp,'F1');
  const box=[...card.querySelectorAll('[data-ck-item]')][0];
  expect(Boolean(box)).toBe(true);
  box.checked=true;
  box.dispatchEvent(new Event('change',{bubbles:true}));
  await new Promise(resolve=>setTimeout(resolve,30));
  const checklist=await getFileChecklist(office,'F1');
  expect(checklist.items.some(item=>item.done)).toBe(true);
  closeModal();
 });
 test('ui: أزرار مركز الملفات في شريط القائمة تفتح اللوحة فعلًا',async()=>{
  const host=document.createElement('div');document.body.append(host);
  host.innerHTML=filesWorkspaceHtml({st:{q:'',preset:'all',chip:'all',status:'all'},presets:[['all','الكل']],chips:[['all','الكل']],hasDate:false});
  bindFilesChrome(uiApp,{root:host,st:uiApp.__lists.files,getGrid:()=>null,load:()=>{},syncFilterSummary:()=>{},saveListView:()=>{}});
  host.querySelector('[data-fw-center]').click();
  await new Promise(resolve=>setTimeout(resolve,80));
  expect(document.body.textContent.includes('مركز الملفات')).toBe(true);
  closeModal();
  host.remove();
 });
 test('datagrid: runBulk ينفّذ على كل الصفوف المحددة عبر onBulk',async()=>{
  const host=document.createElement('div');document.body.append(host);
  let received=null;
  const grid=mountGrid(host,{rows:[{id:'a',t:'أ'},{id:'b',t:'ب'}],columns:[{key:'t',label:'T'}],storageKey:'fs-test-bulk',selectable:true,title:'جماعي',onBulk:(id,rows)=>{received={id,ids:rows.map(row=>row.id)}}});
  await grid.selectAllResults();
  expect(await grid.runBulk('archive')).toBe(true);
  expect(received.id).toBe('archive');
  expect(received.ids.length).toBe(2);
  host.remove();
 });
 test('ui: شريط الإجراءات الجماعية يظهر مع التحديد ويحمل الأرشفة والإنهاء',()=>{
  const host=document.createElement('div');document.body.append(host);
  host.innerHTML=filesWorkspaceHtml({st:{q:'',preset:'all',chip:'all',status:'all'},presets:[['all','الكل']],chips:[['all','الكل']],hasDate:false});
  paintFilesWorkspace(host,{q:'',chip:'all'}, {getUi:()=>({selected:2,cards:false,filterCount:0})});
  const bar=host.querySelector('[data-fw-bulkbar]');
  expect(bar.hidden).toBe(false);
  expect(Boolean(bar.querySelector('[data-fw-bulk="archive"]'))).toBe(true);
  expect(Boolean(bar.querySelector('[data-fw-bulk="close"]'))).toBe(true);
  paintFilesWorkspace(host,{q:'',chip:'all'}, {getUi:()=>({selected:0,cards:false,filterCount:0})});
  expect(bar.hidden).toBe(true);
  host.remove();
 });
 test('ui: المعاينة السريعة تعرض المصدر وتفتح أدوات الملف',async()=>{
  const drawer=await openFileQuickDrawer(uiApp,'F1');
  expect(Boolean(drawer?.wrap)).toBe(true);
  expect(drawer.wrap.textContent.includes('أحمد محمود')).toBe(true);
  expect(Boolean(drawer.wrap.querySelector('[data-preview-edit]'))).toBe(true);
  expect(Boolean(drawer.wrap.querySelector('[data-preview-checklist]'))).toBe(true);
  expect(Boolean(drawer.wrap.querySelector('[data-preview-summary]'))).toBe(true);
  expect(drawer.wrap.textContent.includes('المصدر: files')).toBe(true);
  drawer.close();
 });
 test('ui: مخطط الأعمدة يربط كل عمود بقيمة التوزيع للتنقل',()=>{
  const html=fsBarChart({rows:[{label:'مدني',count:3},{label:'جنائي',count:1}],onAction:'dist'});
  expect(html.includes('data-dist-key="مدني"')).toBe(true);
  expect(html.includes('data-fs-key="جنائي"')).toBe(true);
 });
 test('ui: مراجعة الأثر تُعرض مكدَّسة ولا تفقد النموذج عند الإلغاء',async()=>{
  modal('<div id="keep-form"><input name="x" value="قيمة"></div>');
  const pending=reviewImpact({title:'اختبار النطاق',scope:['سجل واحد'],okText:'تنفيذ'});
  expect(document.querySelectorAll('#modal-root .modal-card').length).toBe(2);
  document.querySelector('[data-fs-impact-cancel]').click();
  const answer=await pending;
  expect(answer).toBe(false);
  expect(Boolean(document.querySelector('#keep-form'))).toBe(true);
  expect(document.querySelector('#keep-form input').value).toBe('قيمة');
  closeModal();
 });

 // ===== 4) حراسة سلامة البيانات =====
  test('data-safety: سجلات الإدارة لا تغيّر إصدار الملف أو نشاطه',async()=>{
   const before=await office.r.files.get('F1');
   await addAdminDecision(office,'F1',{text:'قرار سلامة'});
   await toggleChecklistItem(office,'F1','a',{done:true});
   const after=await office.r.files.get('F1');
   expect(after.version).toBe(before.version);
   expect(after.updatedAt).toBe(before.updatedAt);
   expect(after.lastActivityAt).toBe(before.lastActivityAt);
  });
  test('data-safety: الإنهاء والأرشفة يحفظان السبب ويعودان بلا فقد بيانات',async()=>{
   const before=await office.r.files.get('F2');
   const closed=await closeFile(office,'F2',{closeReason:'إنهاء اختباري'});
   expect(closed.status).toBe('منتهٍ');
   expect(closed.closeReason).toBe('إنهاء اختباري');
   expect(Boolean(closed.closedAt)).toBe(true);
   expect(closed.version).toBe((before.version||0)+1);
   // مسار تراجع الجدول: يعيد الحالة ويصفّر حقلي الإنهاء، ويبقي بقية السجل.
   await saveEntity(office,'files',{...closed,status:before.status,closedAt:'',closeReason:''},'F2');
   const restored=await office.r.files.get('F2');
   expect(restored.status).toBe('open');
   expect(restored.closedAt).toBe('');
   expect(restored.title).toBe(before.title);
   const archived=await archiveFile(office,'F2','أرشفة اختبارية');
   expect(archived.isArchived).toBe(true);
   expect(archived.statusBeforeArchive).toBe('open');
   expect(archived.archivedReason).toBe('أرشفة اختبارية');
   const reopened=await reopenFile(office,'F2','تراجع');
   expect(reopened.isArchived).toBe(false);
   expect(reopened.status).toBe('open');
   expect(reopened.reopenReason).toBe('تراجع');
  });
  test('data-safety: سجلات الإدارة تستخدم settings ولا تضيف مخزنًا أو إصدارًا',()=>{
   expect(SCHEMA_VERSION).toBe(18);
   expect(db.objectStoreNames.contains('settings')).toBe(true);
   expect(db.objectStoreNames.contains('fileAdmin')).toBe(false);
   expect(STORES.length).toBe(Object.keys(SCHEMA).length);
  });
 }catch(error){
  test('files-suite setup',()=>{throw error});
 }
}
