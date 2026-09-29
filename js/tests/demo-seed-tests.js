// اختبار تكاملي لزرع البيانات التجريبية: 50 ملفًا، ترقيم مستقل لكل سنة ونوع،
// علاقات سليمة، وبيانات تغطي كل الأنواع تقريبًا — على قاعدة مؤقتة تُحذف بعد الاختبار.
import {upgradeSchema} from '../db/schema.js';
import {Office} from '../services/office.js';
import {seedDemoData} from '../services/demo-seed.js';
import {seedTaxonomy} from '../services/client-files.js';
import {seedLookups} from '../services/lookups.js';
import {parseFileNumber,formatFileNumber} from '../core/file-number.js';

export async function runDemoSeedTests(test,expect){
 const name=`AhmadKhudairLawOfficeDB__test__seed__${Date.now()}`;
 const db=await new Promise((res,rej)=>{const r=indexedDB.open(name,13);r.onupgradeneeded=e=>upgradeSchema(r.result,e.target.transaction);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});
 const o=new Office({db,assert(){},token:'t',profile:{id:'seed-test'}});
 let report=null,err=null;
 // لقطة كاملة من كل المخازن قبل إغلاق الاتصال — الاختبارات تُنفَّذ لاحقًا على اللقطة
 const snap={};
 try{
  await seedLookups(o);
  await seedTaxonomy(o);
  report=await seedDemoData(o);
  for(const s of ['files','clients','cases','hearings','procedures','fees','feePayments','fileRelations','serviceRecords','bailiffs','assets','fileAssets','clientFiles','fileParties','fileNumberCounters']){
   snap[s]=await o.r[s].all(5000);
  }
 }catch(e){err=e}
 finally{db.close();try{indexedDB.deleteDatabase(name)}catch{}}
 const files=(snap.files||[]).filter(f=>!f.isDeleted);
 const clients=(snap.clients||[]).filter(c=>!c.isDeleted);

 test('بيانات تجريبية: الزرع يكتمل بلا أخطاء',()=>{if(err)throw Error(String(err?.stack||err))});
 test('بيانات تجريبية: 50 ملفًا قانونيًا بالضبط',()=>{expect(report.files).toBe(50);expect(files.length).toBe(50)});
 test('بيانات تجريبية: موكلون وأكواد ملف رئيسي بصيغة صحيحة',()=>{
  expect(clients.length>=20).toBe(true);
  for(const c of clients){
   if(!c.clientCode)throw Error('موكل بلا كود رئيسي: '+c.fullName);
   const p=parseFileNumber(c.clientCode);
   if(p?.kind!=='main')throw Error('كود رئيسي غير صالح: '+c.clientCode);
  }
 });
 test('بيانات تجريبية: كل رقم ملف فرعي يعرض بصيغة موحدة (لا LF- ظاهرة للمستخدم)',()=>{
  for(const f of files){
   const p=parseFileNumber(f.fileNumber);
   if(p?.kind!=='sub')throw Error('رقم فرعي غير صالح: '+f.fileNumber);
   const shown=formatFileNumber(f.fileNumber);
   if(!/^\d+\/\d{4}$/.test(shown))throw Error('عرض غير موحد: '+shown);
  }
 });
 test('بيانات تجريبية: الترقيم يبدأ من 1 لكل سنة ومستقل بين الرئيسي والفرعي',()=>{
  const byYear=new Map();
  for(const f of files){const p=parseFileNumber(f.fileNumber);const k='sub:'+p.year;byYear.set(k,[...(byYear.get(k)||[]),p.seq])}
  for(const c of clients){const p=parseFileNumber(c.clientCode);const k='main:'+p.year;byYear.set(k,[...(byYear.get(k)||[]),p.seq])}
  if(byYear.size<4)throw Error('سنوات ترقيم قليلة: '+byYear.size);
  for(const [k,seqs] of byYear){
   const sorted=[...seqs].sort((a,b)=>a-b);
   if(sorted[0]!==1)throw Error(k+' لا يبدأ من 1');
   for(let i=1;i<sorted.length;i++)if(sorted[i]!==sorted[i-1]+1)throw Error(k+' تسلسل غير متصل');
  }
 });
 test('بيانات تجريبية: تغطية جميع الأقسام الأربعة عشر',()=>{
  const cats=new Set(files.map(f=>f.categoryId));
  for(const c of ['criminal','civil','family','stateCouncil','economic','local','tax','insurance','realEstate','corporate','arbitration','traffic','licenses','other']){
   if(!cats.has(c))throw Error('قسم غير مغطى: '+c);
  }
 });
 test('بيانات تجريبية: مراحل بحالات متنوعة (جارية/منتهية/مخططة)',()=>{
  if(report.stages<10)throw Error('مراحل منتهية قليلة: '+report.stages);
  const lifecycles=new Set((snap.cases||[]).filter(c=>!c.isDeleted).map(c=>c.lifecycle));
  expect(lifecycles.has('active')).toBe(true);
  expect(lifecycles.has('done')).toBe(true);
  expect(lifecycles.has('planned')).toBe(true);
 });
 test('بيانات تجريبية: أرقام قضائية رسمية منفصلة عن رقم الملف الداخلي',()=>{
  const numbered=(snap.cases||[]).filter(c=>!c.isDeleted&&c.caseNumber);
  if(numbered.length<10)throw Error('أرقام قضائية قليلة: '+numbered.length);
 });
 test('بيانات تجريبية: جلسات وأعمال ومواعيد واتصالات وملاحظات',()=>{
  expect(report.hearings>=40).toBe(true);
  expect(report.procedures>=40).toBe(true);
  expect(report.appointments>=10).toBe(true);
  expect(report.communications>=12).toBe(true);
  expect(report.notes>=20).toBe(true);
 });
 test('بيانات تجريبية: أحكام وتنفيذ وخبراء وتوكيلات وأتعاب ودفعات ومستندات',()=>{
  expect(report.judgments>=5).toBe(true);
  expect(report.execution>=3).toBe(true);
  expect(report.experts>=5).toBe(true);
  expect(report.poas>=8).toBe(true);
  expect(report.fees>=30).toBe(true);
  expect(report.payments>=10).toBe(true);
  expect(report.documents>=40).toBe(true);
 });
 test('بيانات تجريبية: إعلانات ومحضرون وعلاقات ملفات وأصول',()=>{
  expect(report.bailiffs).toBe(3);
  expect(report.serviceRecords>=10).toBe(true);
  expect(report.relations>=3).toBe(true);
  expect(report.assets>=3).toBe(true);
 });
 test('بيانات تجريبية: الجلسات والأعمال مرتبطة بملفات موجودة (لا علاقات يتيمة)',()=>{
  const fileIds=new Set(files.map(f=>f.id));
  for(const h of (snap.hearings||[]).filter(x=>!x.isDeleted)){if(!fileIds.has(h.fileId))throw Error('جلسة يتيمة: '+h.id)}
  for(const p of (snap.procedures||[]).filter(x=>!x.isDeleted&&x.fileId)){if(!fileIds.has(p.fileId))throw Error('عمل إداري يتيم: '+p.id)}
 });
 test('بيانات تجريبية: الدفعات لا تتجاوز الأتعاب المتفق عليها',()=>{
  for(const fee of (snap.fees||[]).filter(f=>!f.isDeleted)){
   const pays=(snap.feePayments||[]).filter(p=>!p.isDeleted&&p.feeId===fee.id);
   const sum=pays.reduce((a,p)=>a+Number(p.amount||0),0);
   if(sum>Number(fee.agreedAmount||0)+0.001)throw Error('دفعات تتجاوز الأتعاب: '+fee.id);
  }
 });
 test('بيانات تجريبية: نص البحث مبني لكل الملفات',()=>{
  for(const f of files){if(!f.searchText)throw Error('ملف بلا نص بحث: '+f.fileNumber)}
 });
 test('بيانات تجريبية: سلسلة جلسات متصلة داخل الملف الواحد',()=>{
  const withPrev=(snap.hearings||[]).filter(h=>!h.isDeleted&&h.previousHearingId);
  if(withPrev.length<10)throw Error('سلاسل جلسات قليلة: '+withPrev.length);
  const byId=new Map((snap.hearings||[]).map(h=>[h.id,h]));
  for(const h of withPrev){
   const prev=byId.get(h.previousHearingId);
   if(!prev)throw Error('جلسة سابقة مفقودة: '+h.id);
   if(prev.fileId!==h.fileId)throw Error('سلسلة جلسات تعبر بين ملفين');
  }
 });
}
