// Tests the bounded duplicate-check workflow and explicit, transactional National ID override.
import {upgradeSchema} from '../db/schema.js';
import {Office} from '../services/office.js';
import {findPotentialClientDuplicates,clientDuplicateKey} from '../services/client-duplicates.js';
import {saveEntity} from '../services/entity-save.js';

export async function runClientDuplicateTests(test,expect){
 const name=`AhmadKhudairLawOfficeDB__test__dup__${Date.now()}`;
 const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(name,18);r.onupgradeneeded=e=>upgradeSchema(r.result,e.target.transaction);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
 const office=new Office({db,assert(){},token:'client-duplicate-test',profile:{id:'client-duplicate-test'}});
 const out={};
 try{
  const first=await office.saveClient({fullName:'أحمد محمد علي',nationalId:'٢٩٠٠١٠١١٢٠١٢٣٤',phones:['01000000000']});
  await office.saveClient({fullName:'أحمد محمود علي',nationalId:'٢٩٠٠١٠١١٢٠١٢٣٥'});
  await office.saveClient({fullName:'سعيد حسن',nationalId:'٢٩٠٠١٠١١٢٠١٢٣٦'});
  for(let index=0;index<30;index++)await office.r.clients.put({id:`deleted-duplicate-${index}`,fullName:'سجل محذوف',nationalId:'29001011201237',isDeleted:true});
  const deletedBucketActive=await office.saveClient({fullName:'سجل فعال بعد المحذوف',nationalId:'29001011201237'});
  try{await office.saveClient({fullName:'محاولة بعد محذوفات كثيرة',nationalId:'29001011201237'});out.deletedBucketGuard=false}catch(error){out.deletedBucketGuard=error?.details?.duplicateIds?.includes(deletedBucketActive.id)||false}
  const concurrent=await Promise.allSettled([
   office.saveClient({fullName:'سجل سباق أول',nationalId:'29001011201238'}),
   office.saveClient({fullName:'سجل سباق ثان',nationalId:'29001011201238'})
  ]);
  out.concurrentWins=concurrent.filter(result=>result.status==='fulfilled').length;
  out.concurrentConflicts=concurrent.filter(result=>result.status==='rejected'&&result.reason?.details?.duplicateClient).length;
  out.exact=await findPotentialClientDuplicates(office,{fullName:'احمد محمد علي',nationalId:'29001011201234'});
  out.fuzzy=await findPotentialClientDuplicates(office,{fullName:'احمد محمود عا'});
  out.none=await findPotentialClientDuplicates(office,{fullName:'منى عبدالسلام الشاذلي'});
  try{await office.saveClient({fullName:'اسم آخر',nationalId:'29001011201234'});out.guard=false}catch(error){out.guard=error?.details?.duplicateClient===true;out.guardIds=error?.details?.duplicateIds||[]}
  try{await office.saveClient({fullName:'محاولة تجاوز غير مقصود',nationalId:'29001011201234',allowDuplicate:true});out.dataFlagBypass=false}catch(error){out.dataFlagBypass=error?.details?.duplicateClient===true}
  out.allowed=await saveEntity(office,'clients',{fullName:'موكل مستقل بالإقرار',nationalId:'29001011201234'},null,null,{allowDuplicate:true});
  out.activity=await office.r.activityLog.byIndex('entityId',out.allowed.id,5);
  out.first=first;
 }finally{db.close();try{indexedDB.deleteDatabase(name)}catch{}}
 test('مرشح التكرار: تطبيع الرقم القومي والاسم العربي يلتقط الموكل المطابق',()=>{
  expect(out.exact.some(row=>row.id===out.first.id&&row.nationalIdMatch&&row.exactName)).toBe(true);
  expect(clientDuplicateKey({fullName:'أحمد  محمد',nationalId:'١٢٣'})).toBe(clientDuplicateKey({fullName:'احمد محمد',nationalId:'123'}));
  expect(JSON.stringify(out.exact).includes(out.first.nationalId)).toBe(false);
  expect(out.exact.find(row=>row.id===out.first.id).nationalIdSuffix).toBe(out.first.nationalId.slice(-4));
 });
 test('مرشح التكرار: تشابه الاسم اقتراح فقط ولا يطابق الأشخاص المختلفين تلقائيًا',()=>{
  expect(out.fuzzy.some(row=>row.fullName==='أحمد محمود علي'&&!row.nationalIdMatch&&row.score>=0.62)).toBe(true);
  expect(out.none.length).toBe(0);
 });
 test('الرقم القومي المتكرر مرفوض افتراضيًا مع معرّفات المرشحين',()=>{expect(out.guard).toBe(true);expect(out.guardIds.includes(out.first.id)).toBe(true)});
 test('حارس الرقم القومي يتجاوز دفعات السجلات المحذوفة منطقيًا',()=>expect(out.deletedBucketGuard).toBe(true));
 test('سباق حفظ موكلين بالرقم نفسه يحسم داخل المعاملة الذرية',()=>{expect(out.concurrentWins).toBe(1);expect(out.concurrentConflicts).toBe(1)});
 test('تجاوز حارس الرقم القومي لا يتم بعلم داخل بيانات النموذج',()=>expect(out.dataFlagBypass).toBe(true));
 test('التجاوز الصريح يمر من خدمة الحفظ القائمة ولا يضيف بيانات شخصية إلى Activity Log',()=>{
  expect(out.allowed.nationalId).toBe('29001011201234');
  expect(Object.prototype.hasOwnProperty.call(out.allowed,'allowDuplicate')).toBe(false);
  expect(out.activity.length).toBe(1);
  expect(JSON.stringify(out.activity[0].metadata)).toBe('{}');
  expect(JSON.stringify(out.activity[0]).includes(out.allowed.nationalId)).toBe(false);
 });
}
