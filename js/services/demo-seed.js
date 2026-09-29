// =====================================================================
// زرع البيانات التجريبية — إضافة بحتة، لا تحذف ولا تعدّل أي سجل قائم.
// =====================================================================
// يُستخدم مرة واحدة للقاعدة الفارغة تمامًا (50 ملفًا قانونيًا بكل الأقسام
// والأنواع والمراحل تقريبًا، مع موكلين وخصوم وجلسات وأعمال وأحكام وأتعاب
// وإعلانات ومحضرين وعلاقات ملفات وأصول) حتى يستطيع المكتب تجربة النظام
// ببيانات واقعية الشكل. كل الإنشاء يمر عبر خدمات التطبيق نفسها
// (العدادات، الفهارس، سجل النشاط، نص البحث) فتبقى البيانات متسقة 100%.
import {Clock} from '../core/clock.js';
import {ensureClientFile,createLegalFileInClientFile,taxonomy,setStageLifecycle,setCurrentStage,saveAsset,linkAsset} from './client-files.js';
import {saveEntity} from './entity-save.js';
import {closeFile,archiveFile} from './legal-files.js';
import {addFeePayment} from './finance.js';

// ---------- مولّد عشوائي حتمي (نفس البيانات في كل تشغيل) ----------
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
const rng=mulberry32(20260929);
const int=(a,b)=>a+Math.floor(rng()*(b-a+1));
const pick=arr=>arr[Math.floor(rng()*arr.length)];
const chance=p=>rng()<p;
const p2=n=>String(n).padStart(2,'0');
const iso=(y,m,d)=>`${y}-${p2(m)}-${p2(d)}`;
const addDaysISO=(s,n)=>{const d=new Date(s+'T00:00:00');d.setDate(d.getDate()+n);return iso(d.getFullYear(),d.getMonth()+1,d.getDate())};
const todayISO=()=>Clock.today();
const thisYear=Number(todayISO().slice(0,4));

// ---------- مستودعات أسماء وقيم واقعية الشكل ----------
const FIRST_M=['أحمد','محمد','مصطفى','عبدالرحمن','خالد','عمرو','حسن','طارق','كريم','يوسف','سامح','هشام','إبراهيم','محمود','وليد'];
const FIRST_F=['منى','سارة','هدى','فاطمة','إيمان','نهى','رانيا','داليا','مريم','أمل','سهى','جيهان'];
const LAST=['عبدالسلام','الشاذلي','عبدالله','الجندي','أبوالمجد','سلطان','البدري','عاشور','الحويني','غانم','الدسوقي','عبدالحليم','شلبي','النجار','عبدالعزيز','فرحات','الشرقاوي','مرعي'];
const GOV=[['القاهرة','مدينة نصر'],['الجيزة','الدقي'],['الإسكندرية','سيدي جابر'],['الدقهلية','المنصورة'],['الشرقية','الزقازيق'],['الغربية','طنطا'],['القليوبية','بنها'],['المنوفية','شبين الكوم']];
const COURTS=['محكمة شمال القاهرة الابتدائية','محكمة جنوب القاهرة الابتدائية','محكمة الجيزة الابتدائية','محكمة الإسكندرية الابتدائية','محكمة المنصورة الابتدائية','محكمة استئناف القاهرة','محكمة استئناف الإسكندرية','محكمة القضاء الإداري','المحكمة الإدارية العليا','محكمة الأسرة بالمنصورة','محكمة طنطا الاقتصادية'];
const CHAMBERS=['الدائرة 3 مدني','الدائرة 7 تجاري','الدائرة 2 جنح مستأنف','الدائرة 12 كلي','الدائرة 5 أحوال','الدائرة 9 عمال','الدائرة 4 إداري','الدائرة 6 استئناف'];
const LAWYERS=['أ. أحمد محمد خضير','أ. محمد عبدالمقصود','أ. سارة العدل','أ. كريم فتحي'];
const OCC=['مهندس','طبيب','مدرس','محاسب','موظف حكومي','تاجر','صاحب شركة','مقاول','ربة منزل','مدير موارد بشرية','صيدلي','سائق'];
const STREETS=['شارع التحرير','شارع الجمهورية','شارع النصر','شارع فيصل','شارع الجلاء','كورنيش النيل','شارع بورسعيد'];

const phone=()=>`01${pick(['0','1','2','5'])}${String(int(10000000,99999999))}`;
const nationalIdUsed=new Set();
function nationalId(year){
 for(let i=0;i<50;i++){
  const c=pick(['2','3']);
  const yy=String(year%100).padStart(2,'0');
  const id=c+yy+p2(int(1,12))+p2(int(1,28))+p2(int(1,50))+String(int(1000,9999))+pick(['1','2','3','4']);
  if(!nationalIdUsed.has(id)){nationalIdUsed.add(id);return id}
 }
 return null;
}
const personName=(gender)=>gender==='أنثى'?`${pick(FIRST_F)} ${pick(LAST)} ${pick(LAST)}`:`${pick(FIRST_M)} ${pick(LAST)} ${pick(LAST)}`;
const company=['شركة ','مؤسسة '][0];
const companyNames=['النور للمقاولات','الدلتا للتجارة','المستقبل للاستيراد والتصدير','الأهرام للتوريدات','الوادي الأخضر للتنمية الزراعية','سيناء للتعدين','النيل للصناعات الغذائية','الشرق للأمن والحراسة'];

// ---------- خطة توزيع الملفات الخمسين على الأقسام والأنواع والسنوات ----------
// [القسم, النوع, عدد الملفات]
const PLAN=[
 ['criminal','criminal.report',1],['criminal','criminal.misdemeanor',3],['criminal','criminal.felony',1],['criminal','criminal.violation',1],['criminal','criminal.prosecutionDecision',1],
 ['civil','civil.lawsuit',3],['civil','civil.paymentOrder',1],['civil','civil.grievance',1],['civil','civil.temporaryOrder',1],
 ['family','family.settlement',1],['family','family.lawsuit',2],['family','family.hisba',1],['family','family.appeal',1],
 ['stateCouncil','sc.dispute',1],['stateCouncil','sc.lawsuit',2],['stateCouncil','sc.appeal',1],
 ['economic','eco.lawsuit',2],['economic','eco.criminal',1],
 ['local','local.reconciliation',2],['local','local.buildingLicense',1],['local','local.violation',1],
 ['tax','tax.claim',1],['tax','tax.grievance',1],['tax','tax.lawsuit',1],
 ['insurance','ins.pension',1],['insurance','ins.insurance',1],['insurance','ins.lawsuit',1],
 ['realEstate','re.signature',1],['realEstate','re.validity',1],['realEstate','re.registration',1],
 ['corporate','corp.formation',1],['corporate','corp.assembly',1],['corporate','corp.liquidation',1],
 ['arbitration','arb.case',2],
 ['traffic','tr.violation',1],['traffic','tr.accident',1],['traffic','tr.license',1],
 ['licenses','lic.shop',1],['licenses','lic.renewal',1],
 ['other','other.consultation',1],['other','other.contract',1]
];
// 50 ملفًا: السنوات 2024 (10) و2025 (18) و2026 (22) لإظهار ترقيم مستقل لكل سنة
const YEARS_PLAN=[...Array(10).fill(thisYear-2),...Array(18).fill(thisYear-1),...Array(22).fill(thisYear)];

const SUBJECTS={
 'criminal.report':['بلاغ سرقة محتويات محل تجاري','محضر نصب عبر الإنترنت','محضر تبديد أمانة إيصالات','محضر مشاجرة وإصابة','بلاغ شيك بدون رصيد'],
 'criminal.misdemeanor':['جنحة شيك بدون رصيد','جنحة تبديد منقولات زوجية','جنحة ضرب وإحداث عاهة','جنحة نصب واحتيال'],
 'criminal.felony':['جناية حيازة بقصد الاتجار','جناية شروع في سرقة بالإكراه'],
 'criminal.violation':['مخالفة بناء بدون ترخيص','مخالفة إشغال طريق'],
 'criminal.prosecutionDecision':['قرار نيابة بالحفظ — تظلم','قرار إخلاء سبيل بضمان'],
 'civil.lawsuit':['دعوى صحة ونفاذ عقد بيع','دعوى تعويض عن ضرر','دعوى إخلاء عين مؤجرة','دعوى ندب خبير حسابات','دعوى براءة ذمة'],
 'civil.paymentOrder':['أمر أداء شيك','أمر أداء فاتورة توريد'],
 'civil.grievance':['تظلم من قرار حجز إداري','تظلم من أمر تقدير'],
 'civil.temporaryOrder':['أمر وقتي منع تعرض','طلب وضع أختام'],
 'family.settlement':['طلب تسوية منازعة أسرية'],
 'family.lawsuit':['دعوى نفقة زوجية','دعوى خلع','دعوى رؤية صغير','دعوى مصروفات دراسية'],
 'family.hisba':['طلب تعيين وصي على قاصر'],
 'family.appeal':['استئناف حكم نفقة'],
 'sc.dispute':['طلب فض منازعات عقد إداري'],
 'sc.lawsuit':['دعوى إلغاء قرار جزاء','دعوى بدل مخاطر','دعوى تسوية معاش إداري'],
 'sc.appeal':['طعن على حكم تأديبي'],
 'eco.lawsuit':['دعوى تعويض تجاري','دعوى فسخ عقد توريد'],
 'eco.criminal':['قضية غسل أموال — دفاع'],
 'local.reconciliation':['تصالح مخالفة بناء عقار','تصالح تغيير نشاط وحدة'],
 'local.buildingLicense':['ترخيص بناء دور إضافي'],
 'local.violation':['مخالفة هدم بدون ترخيص'],
 'tax.claim':['مطالبة ضريبة قيمة مضافة'],
 'tax.grievance':['تظلم ربط ضريبة دخل'],
 'tax.lawsuit':['دعوى طعن ضريبي'],
 'ins.pension':['تسوية معاش مبكر'],
 'ins.insurance':['ضم مدة خدمة سابقة'],
 'ins.lawsuit':['دعوى مستحقات تأمينية'],
 're.signature':['صحة توقيع عقد بيع سيارة'],
 're.validity':['صحة ونفاذ عقد بيع شقة'],
 're.registration':['تسجيل عقد قسمة عقار'],
 'corp.formation':['تأسيس شركة ذات مسؤولية محدودة'],
 'corp.assembly':['محضر جمعية عادية اعتماد ميزانية'],
 'corp.liquidation':['تصفية شركة تضامن'],
 'arb.case':['تحكيم نزاع مقاولات','تحكيم تجاري عقد توزيع'],
 'tr.violation':['مخالفة رادار — تظلم'],
 'tr.accident':['حادث طريق — تعويض'],
 'tr.license':['تجديد رخصة سيارة ملاكي'],
 'lic.shop':['رخصة تشغيل محل تجاري'],
 'lic.renewal':['تجديد رخصة مزاولة نشاط'],
 'other.consultation':['استشارة عقد مشاركة','استشارة نزاع عمالي'],
 'other.contract':['صياغة عقد إيجار تجاري','صياغة عقد مقاولة']
};
const NOTE_POOL=['الموكل يطلب متابعة أسبوعية.','تم التواصل مع الموكل وإبلاغه بالمستجدات.','مستندات الملف كاملة ومطابقة.','يُفضَّل عدم التواصل بعد الخامسة مساءً.','الخصم يميل للتسوية الودية.','هناك جلسة قريبة — تجهيز حافظة المستندات.'];
const STEP_POOL=['مراجعة المستندات','إعداد مذكرة','متابعة القلم','استخراج صورة رسمية','إعلان الخصم'];

// حقول المجموعات النوعية (x_) — تُملأ كلها بقيم واقعية الشكل حسب اسم الحقل
function metaFor(fields,year,r){
 const meta={};
 for(const f of fields||[]){
  const k=f.k;let v='';
  switch(true){
   case /refNumber|claimNumber|licenseNumber|insuranceNumber|taxRegNumber|registryNumber|decisionNumber/.test(k):v=String(int(100,9999));break;
   case /Year$/.test(k)&&f.t==='number':v=year;break;
   case /refDate|decisionDate|resultDate|issuedDate|expiryDate|assignmentDate|marriageDate|incidentDate|openedDate|reportDate|judgmentDate|serviceDate|submittedAt/.test(k)&&f.t==='date':v=r||iso(year,int(1,12),int(1,28));break;
   case k==='court'||k==='crimCourt':v=pick(COURTS);break;
   case k==='chamber':v=pick(CHAMBERS);break;
   case k==='policeStation':v=`قسم ${pick(['أول','ثانٍ','ثالث'])} ${pick(['المنصورة','طنطا','مدينة نصر','الدقي'])}`;break;
   case k==='prosecution':v=`نيابة ${pick(['المنصورة الكلية','غرب طنطا','شمال القاهرة','الدقي'])} ${chance(.5)?'الجزئية':'الكلية'}`;break;
   case k==='charge':v=pick(['نصب','تبديد أمانة','شيك بدون رصيد','ضرب','سرقة','إتلاف عمد']);break;
   case k==='legalArticles':v='المواد '+pick(['336','341','242','318'])+' من قانون العقوبات';break;
   case k==='subject'||k==='consultationSubject'||k==='civilSubject'||k==='execSubject'||k==='incidentSummary'||k==='decisionSummary'||k==='contestedDecision'||k==='procedureSubject':v='موضوع '+pick(['عقد بيع','عقد توريد','عقد إيجار','قرار إداري','مطالبة مالية','نزاع شراكة'])+' — مطالبة بالحقوق القانونية كاملة مع التعويض.';break;
   case k==='civilRequests'||k==='consultationAnswer':v='قبول الطلب شكلًا وفي الموضوع بأحقية الموكل مع إلزام المصاريف.';break;
   case k==='authority'||k==='adminAuthority'||k==='settlementOffice'||k==='insuranceOffice'||k==='taxOffice'||k==='executionOffice':v=pick(['مكتب تسويات الأسرة','هيئة التأمينات الاجتماعية','مأمورية ضرائب أول','حي شرق','هيئة الاستثمار','قلم التنفيذ']);break;
   case k==='result'||k==='requestStatus'||k==='criminalStatus':v=pick(['قيد النظر','مقبول','مقدم','قيد الفحص']);break;
   case k==='employerName':v='شركة '+pick(companyNames);break;
   case k==='partiesRelation':v='زوجان';break;
   case k==='childrenCount':v=int(1,3);break;
   case k==='hasChildren'||k==='hasDecision':v=true;break;
   case k==='decisionIssuer':v='رئيس الحي';break;
   case k==='execBondType':v=pick(['حكم نهائي','محرر موثق','ورقة تجارية']);break;
   case k==='violationType':v='بناء دور مخالف بدون ترخيص';break;
   case k==='licenseType':v=pick(['رخصة بناء','رخصة تشغيل','رخصة مزاولة']);break;
   case k==='taxType':v=pick(['دخل','قيمة مضافة','عقارية']);break;
   case k==='taxYears':v=`${year-2} حتى ${year-1}`;break;
   case k==='arbitrationType':v='مؤسسي';break;
   case k==='center':v='مركز القاهرة الإقليمي للتحكيم';break;
   case k==='tribunal':v='هيئة ثلاثية';break;
   case k==='arbitrators':v='المحكم: أ. '+pick(LAST);break;
   case k==='award':v='حكم تحكيمي بإلزام الطرف الآخر بالتعويض';break;
   case k==='postAward':v='جارٍ استصدار الأمر التنفيذي';break;
   case k==='hisbaKind':v='تعيين وصي';break;
   case k==='appealKind':v='طعن';break;
   case k==='courtKind':v='محكمة القضاء الإداري';break;
   case k==='propertyHint':v='عقار رقم '+int(1,120)+' — '+pick(STREETS);break;
   case k==='plateHint':v='ملاكي — '+pick(['د ع ط','س ص م','ق و ن'])+' '+int(1000,9999);break;
   case k==='trafficUnit':v='وحدة مرور '+pick(['المنصورة','أول طنطا','مدينة نصر']);break;
   case k==='registryOffice':v='مكتب شهر عقاري '+pick(['المنصورة','طنطا','أول القاهرة']);break;
   case k==='companyAction':v=pick(['تأسيس','تعديل عقد','محضر جمعية','تصفية']);break;
   case k==='nextAction':v='متابعة بعد '+int(7,21)+' يومًا';break;
   case k==='decision':v='قبول الطلب';break;
   case k==='custody'||k==='clientCapacity':v=pick(['مخلى سبيله','محبوس احتياطيًا','مدعٍ']);break;
   case k==='crimProcedureType':v='جنحة مباشرة';break;
   case k==='startedAs':v='محضر محال';break;
   case k==='reportKind':v=pick(['جنح','إداري','بلاغ']);break;
   case k==='maritalStatus':v=pick(['متزوج','أعزب','مطلق']);break;
   case k==='familyCaseType':v=pick(['نفقة','خلع','رؤية','حضانة']);break;
   case k==='familyFinancialNotes'||k==='legalNotes'||k==='childrenDetails':v='بيانات استرشادية فقط — لا تتضمن أي حسابات قانونية.';break;
   case k==='adminDisputeType':v='قرار جزاء';break;
   case k==='contestedJudgment':v='الحكم الصادر بجلسة '+iso(year,int(1,6),int(1,28));break;
   default:v='';
  }
  if(v!==''&&v!==undefined&&v!==null)meta[k]=v;
 }
 return meta;
}

// =====================================================================
export async function seedDemoData(office,{onProgress}={}){
 const t0=Date.now();
 const report={clients:0,opponents:0,files:0,stages:0,hearings:0,procedures:0,appointments:0,communications:0,notes:0,judgments:0,execution:0,experts:0,poas:0,fees:0,payments:0,documents:0,serviceRecords:0,bailiffs:0,relations:0,assets:0,ms:0};
 const tax=await taxonomy(office);
 const today=todayISO();
 const progress=(done,total,label)=>onProgress?.({done,total,label});

 // ---------- 1) الموكلون (20 موزعين على 3 سنوات لترقيم مستقل لكل سنة) ----------
 const clients=[];
 const clientYears=[...Array(4).fill(thisYear-2),...Array(7).fill(thisYear-1),...Array(9).fill(thisYear)];
 for(let i=0;i<20;i++){
  const yr=clientYears[i];
  const isCompany=i%6===5;
  const gender=i%3===1?'أنثى':'ذكر';
  const fullName=isCompany?`${company}${pick(companyNames)}`:personName(gender);
  const [gov,city]=pick(GOV);
  const birthYear=int(1958,1999);
  const row=await office.saveClient({
   fullName,
   clientType:isCompany?'شخص اعتباري':'شخص طبيعي',
   nationalId:isCompany?'':nationalId(birthYear),
   nationality:'مصري',gender:isCompany?'':gender,
   birthDate:isCompany?'':iso(birthYear,int(1,12),int(1,28)),
   occupation:isCompany?'':pick(OCC),maritalStatus:isCompany?'':pick(['متزوج','أعزب','مطلق','أرمل']),
   phones:[phone(),chance(.4)?phone():''].filter(Boolean),
   email:chance(.6)?`user${int(10,99)}@example.com`:'',
   governorate:gov,city,address:`${pick(STREETS)} — ${city} — ${gov}`,
   workAddress:chance(.5)?`عنوان العمل: ${pick(STREETS)} — ${city}`:'',
   commercialRegister:isCompany?String(int(1000,99999)):'',taxNumber:isCompany?String(int(100000,999999)):'',
   legalRepresentative:isCompany?personName('ذكر'):'',
   referredBy:chance(.5)?pick(['إحالة من موكل سابق','معارف المكتب','بحث إلكتروني','']):'' ,
   status:'active',notes:i%4===0?'موكل منذ سنوات — تعامل طويل الأمد.':''
  });
  // سنة إنشاء حقيقية متفاوتة حتى يظهر ترقيم الملفات لكل سنة
  row.createdAt=iso(yr,int(1,11),int(1,28))+'T09:30:00.000Z';
  await office.r.clients.put(row);
  await ensureClientFile(office,row.id);
  clients.push(row);report.clients++;
  progress(i+1,90,'الموكلون');
 }

 // ---------- 2) الخصوم ----------
 const opponents=[];
 for(let i=0;i<12;i++){
  const isCompany=i%4===3;
  const o=await saveEntity(office,'opponents',{
   name:isCompany?`${company}${pick(companyNames)}`:personName(i%2?'أنثى':'ذكر'),
   opponentType:isCompany?'شخص اعتباري':'شخص طبيعي',
   capacity:pick(['مدعى عليه','خصم تجاري','جهة إدارية','مؤجر','شريك']),
   nationalId:isCompany?'':nationalId(int(1955,1990)),
   phones:[phone()],address:`${pick(STREETS)} — ${pick(GOV)[1]}`,
   lawyerName:chance(.5)?'أ. '+pick(LAST)+' المحامي':'',lawyerPhone:chance(.5)?phone():'',
   notes:''
  });
  opponents.push(o);report.opponents++;
 }

 // ---------- 3) المحضرون ----------
 const bailiffs=[];
 for(let i=0;i<3;i++){
  const b=await saveEntity(office,'bailiffs',{
   name:'محضر '+pick(['أول','ثانٍ','ثالث'])+' — '+pick(['حسن عبدالتواب','سيد رمضان','محمود عبده']),
   court:pick(COURTS.slice(0,5)),section:pick(['قلم محضري أول','قلم محضري ثانٍ']),office:pick(['مكتب محضري المحكمة','مكتب محضرين جزئي']),
   phone:phone(),email:'',isActive:true,notes:'متاح غالبًا في الفترة الصباحية.'
  });
  bailiffs.push(b);report.bailiffs++;
 }

 // ---------- 4) الملفات القانونية الخمسون ----------
 const plan=[];
 let idx=0;
 for(const [catId,typeId,count] of PLAN){
  for(let k=0;k<count;k++){
   plan.push({catId,typeId,year:YEARS_PLAN[Math.min(idx,YEARS_PLAN.length-1)]});idx++;
  }
 }
 while(plan.length<50)plan.push({catId:'other',typeId:'other.general',year:thisYear});
 plan.length=Math.min(plan.length,50);

 const files=[];
 const usedSubjects={};
 for(let i=0;i<plan.length;i++){
  const {catId,typeId,year}=plan[i];
  const cat=tax.byId.get(catId);if(!cat)continue;
  const type=tax.byId.get(typeId)&&tax.byId.get(typeId).parentId===catId?tax.byId.get(typeId):(tax.typesOf(catId)[0]||null);
  const client=pick(clients);
  const subjects=SUBJECTS[typeId]||SUBJECTS['other.contract']||['عمل قانوني'];
  usedSubjects[typeId]=(usedSubjects[typeId]||0)%subjects.length;
  const subject=subjects[usedSubjects[typeId]++];
  const title=`${subject} — ${client.fullName.split(' ')[0]} ${client.fullName.split(' ')[1]||''}`.trim();
  const openedAt=iso(year,year===thisYear?int(1,Math.max(1,Number(today.slice(5,7)))):int(1,12),int(1,28));
  const tpl=type?tax.templateFor(type.id):null;
  let steps=(tpl?.steps||[]).map(s=>({name:s.name,stageTypeId:s.stageTypeId||null,optional:Boolean(s.optional)}));
  steps=steps.filter(s=>!s.optional||chance(.65));
  if(!steps.length)steps=[{name:'متابعة',stageTypeId:null,optional:false}];
  const fields=type?tax.fieldsFor(type.id):[];
  const related=null;
  let file;
  try{
   file=await createLegalFileInClientFile(office,{
    clientId:client.id,categoryId:cat.id,fileTypeId:type?.id||null,
    title,status:pick(['نشط','نشط','نشط','تحت المتابعة','متوقف']),
    priority:pick(['normal','normal','normal','urgent','critical']),
    openedAt,responsibleLawyer:pick(LAWYERS),clientRole:pick(['موكل','مدعٍ','متهم','مستأنف','طاعن']),
    steps,meta:metaFor(fields,year,openedAt),related,
    notes:pick(NOTE_POOL)
   });
  }catch(e){console.error('seed file',typeId,e);continue}
  files.push({file,client,year,catId,typeId,steps:steps.length});
  report.files++;
  progress(20+i,90,'الملفات');
 }

 // ---------- 5) علاقات ملفات (استئناف/تنفيذ/نشأ عن) — ملفات إضافية ضمن الخمسين ----------
 // نختار ملفات أساسًا ذات طابع قضائي ونربط بها ملفات أخرى موجودة عبر خدمة العلاقات مباشرة
 const relCodes=['APPEAL_OF','EXECUTION_OF','ORIGINATED_FROM','RELATED_TO','GRIEVANCE_OF'];
 const litigation=files.filter(f=>/lawsuit|misdemeanor|felony|settlement|appeal|claim/.test(f.typeId));
 for(let i=0;i+1<Math.min(litigation.length,10);i+=2){
  const a=litigation[i],b=litigation[i+1];
  if(a.file.id===b.file.id)continue;
  try{
   await saveEntity(office,'fileRelations',{sourceFileId:b.file.id,targetFileId:a.file.id,relationCode:relCodes[i/2%relCodes.length],notes:'علاقة تجريبية لربط الملفين.'});
   report.relations++;
  }catch{}
 }

 // ---------- 6) المراحل: أرقام قضائية وتقدم المراحل ----------
 const hearingQueue=[]; // {file, stage, year}
 for(const rec of files){
  const rows=(await office.r.cases.byIndex('fileId',rec.file.id,200)).sort((a,b)=>(a.stageOrder||0)-(b.stageOrder||0));
  if(!rows.length)continue;
  rec.stageRows=rows;
  // تقدم واقعي: ملفات منتهية تمر بكل المراحل، ونشطة في منتصف المسار
  const doneCount=rec.file.status==='منتهٍ'?rows.length:Math.min(rows.length,rec.year<thisYear?int(1,Math.max(1,rows.length)):int(0,Math.max(0,rows.length-1)));
  for(let s=0;s<doneCount&&s<rows.length;s++){
   try{await setStageLifecycle(office,rec.file.id,rows[s].id,'done',{outcome:pick(['لصالح الموكل','ضد الموكل','جزئي','حفظ','إحالة','صلح','']),endedAt:iso(rec.year,int(2,12),int(1,28))})}catch{}
   report.stages++;
  }
  if(doneCount<rows.length&&doneCount>0){try{await setCurrentStage(office,rec.file.id,rows[doneCount].id)}catch{}}
  // رقم قضائي رسمي للمراحل التي وصلت للمحكمة (منفصل عن رقم الملف الداخلي)
  let freshRows=(await office.r.cases.byIndex('fileId',rec.file.id,200)).sort((a,b)=>(a.stageOrder||0)-(b.stageOrder||0));
  const numbered=freshRows.filter(s=>s.lifecycle!=='planned'&&/دعوى|جنحة|جناية|استئناف|طعن|حكم|تحكيم|قضية|مخالفة/.test(s.stageType||''));
  for(const st of numbered){
   try{
    await office.saveCase({id:st.id,fileId:rec.file.id,stageType:st.stageType,numberType:pick(['كلى','جزئي','أحوال','إدارى','تجارى','اقتصادى']),
     caseNumber:String(int(120,24000)),caseYear:String(st.startedAt?Number(String(st.startedAt).slice(0,4)):rec.year),
     courtId:pick(COURTS),chamber:pick(CHAMBERS),degree:pick(['ابتدائي','استئناف','نقض']),
     filingDate:st.startedAt||iso(rec.year,int(1,10),int(1,28)),subject:rec.file.title},st.id);
   }catch{}
  }
  // إعادة القراءة بعد الحفظ حتى تحمل المراحل الأرقام القضائية الجديدة في الذاكرة أيضًا
  freshRows=(await office.r.cases.byIndex('fileId',rec.file.id,200)).sort((a,b)=>(a.stageOrder||0)-(b.stageOrder||0));
  rec.stageRows=freshRows;
  for(const st of freshRows.filter(s=>s.caseNumber))hearingQueue.push({file:rec.file,stage:st,year:rec.year});
 }

 // ---------- 7) الجلسات (سلاسل بتأجيل، وجلسات اليوم والأسبوع للوحة) ----------
 const timePool=['09:00','09:30','10:00','10:30','11:00','11:30','12:00','12:30'];
 let todayCount=0,weekCount=0;
 for(const {file,stage,year} of hearingQueue){
  const n=int(2,4);
  let prev=null;
  let date=addDaysISO(stage.filingDate||iso(year,3,1),int(14,30));
  for(let h=0;h<n;h++){
   const isLast=h===n-1;
   const inFuture=date>today;
   const adjourn=isLast&&!inFuture&&file.status!=='منتهٍ'&&chance(.7);
   let adjournedTo='';
   if(adjourn){
    adjournedTo=addDaysISO(today,int(3,40));
    if(todayCount<3&&h===n-1){adjournedTo=today;todayCount++}
    else if(weekCount<4&&chance(.5)){adjournedTo=addDaysISO(today,int(1,7));weekCount++}
   }
   try{
    const row=await saveEntity(office,'hearings',{
     caseId:stage.id,hearingDate:date,hearingTime:pick(timePool),
     court:stage.courtId||pick(COURTS),chamber:stage.chamber||pick(CHAMBERS),
     type:pick(['جلسة مرافعة','جلسة إجرائية','جلسة حكم','جلسة تحضير']),
     reason:pick(['مرافعة','تقديم مستندات','سماع شهود','النطق بالحكم','تأجيل إداري']),
     attendance:chance(.6)?pick(['حضر الموكل والمحامي','حضر المحامي فقط','لم يحضر أحد']):'',
     result:inFuture?'':pick(['تأجيل للاطلاع','حجزت للحكم','قررت المحكمة ندب خبير','رفض الطلب','أجابت المحكمة للطلب']),
     status:inFuture?'مجدولة':'منعقدة',
     previousHearingId:prev||'',adjournedTo,adjournReason:adjournedTo?'استكمال المرافعة':'',
     nextAction:adjournedTo?'حضور الجلسة القادمة':''
    });
    prev=row.id;report.hearings++;
   }catch(e){console.error('seed hearing',e)}
   date=addDaysISO(date,int(18,35));
  }
 }
 // جلسات مؤكدة اليوم إن لم تكفِ
 if(todayCount===0&&hearingQueue.length){
  const {stage}=hearingQueue[0];
  try{await saveEntity(office,'hearings',{caseId:stage.id,hearingDate:today,hearingTime:'10:00',court:stage.courtId||pick(COURTS),chamber:stage.chamber||'',type:'جلسة مرافعة',reason:'مرافعة',status:'مجدولة',result:'',previousHearingId:'',adjournedTo:'',nextAction:''});report.hearings++}catch{}
 }

 // ---------- 8) الأعمال الإدارية (منها متأخر وقادم لتغذية مركز العمل) ----------
 const statusPool=['open','open','pending','done','done'];
 for(const rec of files){
  const n=chance(.85)?int(1,3):0;
  for(let k=0;k<n;k++){
   const st=pick(statusPool);
   const due=st==='done'?addDaysISO(today,-int(2,60)):k===0&&rec.file.status!=='منتهٍ'?addDaysISO(today,int(-6,10)):addDaysISO(rec.file.openedAt||today,int(10,200));
   try{
    await saveEntity(office,'procedures',{
     fileId:rec.file.id,caseId:rec.stageRows?.find(s=>s.lifecycle==='active')?.id||'',
     type:pick(['مذكرة','متابعة قلم','استخراج شهادة','إعلان','تجديد','مراجعة']),
     description:`${pick(STEP_POOL)} — ${rec.file.title.slice(0,40)}`,
     actionDate:addDaysISO(due,-int(0,5)),internalDueDate:due,status:st,
     priority:pick(['normal','normal','urgent']),assignedTo:pick(LAWYERS),
     result:st==='done'?'تم الإنجاز':'',nextAction:st==='done'?'':'المتابعة مع القلم',notes:''
    });report.procedures++;
   }catch{}
  }
 }

 // ---------- 9) مواعيد واتصالات وملاحظات ----------
 for(let i=0;i<14;i++){
  const rec=pick(files),c=rec.client;
  const when=addDaysISO(today,int(i<5?0:1,i<5?3:25));
  try{
   await saveEntity(office,'appointments',{title:pick(['مقابلة موكّل','توقيع مستندات','اجتماع تسوية','استلام أوراق']),
    date:when,time:pick(timePool),location:pick(['مكتب المحاماة','المحكمة','مقر العميل']),withWhom:c.fullName,
    status:when>today?'pending':'done',fileId:rec.file.id,clientId:c.id,notes:''});
   report.appointments++;
  }catch{}
 }
 for(let i=0;i<16;i++){
  const rec=pick(files),c=rec.client;
  const when=addDaysISO(today,-int(0,40));
  const follow=chance(.5);
  try{
   await saveEntity(office,'communications',{date:when,time:pick(timePool),
    channel:pick(['هاتف','واتساب','بريد إلكتروني','زيارة مكتب']),direction:pick(['incoming','outgoing']),
    contactName:c.fullName,phone:'',subject:pick(['متابعة حالة الملف','استفسار عن الجلسة','طلب مستند','إبلاغ بتطورات']),
    summary:'تم التواصل بشأن '+rec.file.title.slice(0,50),
    followUpRequired:follow,followUpDate:follow?addDaysISO(today,int(1,6)):'',
    fileId:rec.file.id,clientId:c.id});
   report.communications++;
  }catch{}
 }
 for(const rec of files){
  if(!chance(.7))continue;
  try{
   await saveEntity(office,'caseNotes',{fileId:rec.file.id,caseId:'',category:pick(['قانونية','إدارية','مالية','داخلية']),content:`${pick(NOTE_POOL)} (${rec.file.title.slice(0,40)})`});
   report.notes++;
  }catch{}
 }

 // ---------- 10) أحكام وتنفيذ وخبراء ----------
 const judgedStages=[];
 for(const rec of files){
  const stage=(rec.stageRows||[]).find(s=>s.caseNumber&&/حكم|استئناف|دعوى|جنحة|جناية|طعن/.test(s.stageType||''));
  if(!stage||stage.lifecycle==='planned')continue;
  if(!chance(rec.file.status==='منتهٍ'?.9:.45))continue;
  const jd=addDaysISO(stage.filingDate||iso(rec.year,6,1),int(40,160))<today?addDaysISO(stage.filingDate||iso(rec.year,6,1),int(40,160)):addDaysISO(today,-int(5,90));
  try{
   const j=await saveEntity(office,'judgments',{caseId:stage.id,judgmentDate:jd,judgmentNumber:String(int(100,9000)),
    court:stage.courtId||pick(COURTS),chamber:stage.chamber||'',stage:stage.stageType,
    judgmentType:pick(['حضوري','غيابي','حضوري اعتباري']),
    operativeSummary:pick(['قضت المحكمة بقبول الدعوى وإجابة الطلبات.','قضت المحكمة برفض الدعوى.','قضت المحكمة بندب خبير.','حكمت المحكمة بإلزام المدعى عليه بالتعويض.']),
    judgmentStatus:pick(['نهائي','ابتدائي','مطعون فيه']),isAppealed:chance(.35),nextStage:chance(.35)?'استئناف':'',notes:''});
   report.judgments++;judgedStages.push({rec,stage,j});
  }catch{}
 }
 for(let i=0;i<Math.min(6,judgedStages.length);i++){
  const {rec,stage}=judgedStages[i];
  try{
   await saveEntity(office,'execution',{caseId:stage.id,executionNumber:String(int(100,8000)),executionYear:Number(String(stage.filingDate||rec.year).slice(0,4)),
    bondType:pick(['حكم نهائي','محرر موثق']),executionOffice:pick(['قلم تنفيذ المنصورة','قلم تنفيذ طنطا']),
    against:pick(opponents).name,openedDate:addDaysISO(today,-int(10,120)),stage:'إجراءات التنفيذ',
    status:pick(['active','active','completed','suspended']),notes:''});
   report.execution++;
  }catch{}
 }
 for(let i=0;i<7;i++){
  const rec=pick(files.filter(f=>f.stageRows?.some(s=>s.caseNumber)))||pick(files);
  const stage=(rec.stageRows||[]).find(s=>s.caseNumber)||rec.stageRows?.[0];
  if(!stage)continue;
  try{
   await saveEntity(office,'expertReports',{caseId:stage.id,expertName:'م. '+pick(LAST),expertOffice:pick(['مكتب خبراء المنصورة','مكتب خبراء طنطا','الإدارة العامة للخبراء']),
    assignmentDate:addDaysISO(today,-int(60,200)),sessionDate:addDaysISO(today,int(-20,20)),reportDate:chance(.5)?addDaysISO(today,-int(1,30)):'',
    status:pick(['جارٍ','مودَع','مؤجَّل']),summary:'تقرير فني/محاسبي في موضوع النزاع.',notes:''});
   report.experts++;
  }catch{}
 }

 // ---------- 11) توكيلات ----------
 for(let i=0;i<10;i++){
  const c=pick(clients);
  const y=pick([thisYear-2,thisYear-1,thisYear]);
  try{
   await saveEntity(office,'powersOfAttorney',{clientId:c.id,fileId:chance(.6)?pick(files.filter(f=>f.client.id===c.id))?.file.id||'':'',
    poaNumber:String(int(1000,40000)),poaLetter:pick(['أ','ب','ج','']),poaYear:y,
    type:pick(['عام','خاص','قضايا','بنوك','شهر عقاري']),notaryOffice:pick(['توثيق المنصورة','توثيق طنطا','توثيق مدينة نصر']),
    issuedDate:iso(y,int(1,12),int(1,28)),expiryDate:chance(.3)?iso(y+2,int(1,12),int(1,28)):'',
    attorneys:pick(LAWYERS)+' و'+pick(LAWYERS),status:pick(['سارٍ','سارٍ','منتهٍ']),
    physicalLocation:pick(['خزينة المكتب — درج 2','ملف الموكل','']),scope:'تمثيل الموكل أمام المحاكم بجميع درجاتها.',notes:''});
   report.poas++;
  }catch{}
 }

 // ---------- 12) أتعاب ودفعات ----------
 for(const rec of files){
  if(!chance(.85))continue;
  const agreed=pick([5000,7500,10000,15000,20000,30000,50000]);
  try{
   const fee=await saveEntity(office,'fees',{fileId:rec.file.id,agreementType:pick(['مقطوع','مقطوع + نسبة','بالجلسة']),
    agreedAmount:agreed,currency:'ج.م',paymentStatus:'unpaid',notes:''});
   report.fees++;
   const paidShare=pick([0,.3,.5,.75,1]);
   if(paidShare>0){
    const first=Math.round(agreed*paidShare*(chance(.5)?1:.6));
    await addFeePayment(office,{feeId:fee.id,amount:Math.max(500,first),date:addDaysISO(today,-int(5,120)),method:pick(['نقدي','تحويل بنكي','شيك','إنستاباي']),notes:'دفعة أولى'});
    report.payments++;
    if(paidShare===1&&first<agreed){
     await addFeePayment(office,{feeId:fee.id,amount:agreed-first,date:addDaysISO(today,-int(1,30)),method:'نقدي',notes:'دفعة أخيرة'});
     report.payments++;
    }
   }
  }catch{}
 }

 // ---------- 13) مستندات ----------
 for(const rec of files){
  const n=chance(.8)?int(1,3):0;
  for(let k=0;k<n;k++){
   try{
    await saveEntity(office,'documentReferences',{fileId:rec.file.id,title:pick(['عقد البيع','صورة البطاقة','التوكيل الأصلي','حافظة المستندات','صحيفة الدعوى','محضر الجلسة','تقرير الخبير','إيصال الأمانة']),
     type:pick(['عقد','حكم','محرر رسمي','مستند تقديم','مراسلة']),date:addDaysISO(rec.file.openedAt||today,int(0,60)),
     isOriginal:chance(.5),physicalLocation:pick(['خزينة المكتب — درج 1','خزينة المكتب — درج 3','ملف ورقي']),notes:''});
    report.documents++;
   }catch{}
  }
 }

 // ---------- 14) أطراف إضافية (خصوم مسجلون وأطراف أخرى) ----------
 for(const rec of files){
  if(!/lawsuit|misdemeanor|felony|settlement|appeal|claim|dispute|accident|signature|validity|economic|arb/.test(rec.typeId))continue;
  if(!chance(.8))continue;
  const opp=pick(opponents);
  try{
   await saveEntity(office,'fileParties',{fileId:rec.file.id,partyKind:'opponent',opponentId:opp.id,
    role:/criminal|misdemeanor|felony/.test(rec.catId)?pick(['متهم','مجني عليه']):pick(['مدعى عليه','مطعون ضده','مستأنف ضده']),
    isPrimary:true,isActive:true,notes:''});
  }catch{}
  if(chance(.3)){
   try{await saveEntity(office,'fileParties',{fileId:rec.file.id,partyKind:'other',name:personName('ذكر'),role:pick(['شاهد','كفيل','ضامن','وكيل']) ,isPrimary:false,isActive:true,notes:''})}catch{}
  }
 }

 // ---------- 15) إعلانات وإنذارات ----------
 for(let i=0;i<12;i++){
  const rec=pick(files);
  const parties=(await office.r.fileParties.byIndex('fileId',rec.file.id,50)).filter(p=>p.partyKind!=='client');
  const party=parties[0]||null;
  const submitted=addDaysISO(today,-int(1,80));
  const served=chance(.7)?addDaysISO(submitted,int(2,14)):'';
  try{
   await saveEntity(office,'serviceRecords',{fileId:rec.file.id,caseId:rec.stageRows?.find(s=>s.caseNumber)?.id||'',
    actionType:i%3===0?'إنذار':'إعلان',type:pick(['إعلان بصحيفة دعوى','إنذار على يد محضر','إعادة إعلان','إعلان حكم']),
    partyId:party?.id||'',partyName:party?.partyName||pick(opponents).name,partyRole:party?.role||'خصم',
    submittedAt:submitted,serviceDate:served,status:served?pick(['تم الإعلان','تم الإعلان','غير ناجح']):'مسودة',
    result:served?pick(['أُعلن لشخصه','أُعلن لجهة الإدارة','امتنع عن الاستلام']):'',
    bailiffId:pick(bailiffs).id,court:'',section:'',office:'',
    governorate:pick(GOV)[0],district:pick(GOV)[1],area:pick(STREETS),
    noticeNumber:chance(.6)?String(int(1000,9000)):'',notes:''});
   report.serviceRecords++;
  }catch{}
 }

 // ---------- 16) أصول (عقارات ومركبات) ----------
 const assetDefs=[
  ['property',{name:'عقار سكني — '+pick(STREETS),propertyType:'شقة',governorate:pick(GOV)[0],city:pick(GOV)[1],village:'',basin:'',parcel:'',propertyNumber:String(int(1,200)),unit:String(int(1,12)),area:int(80,220)+' م²',address:pick(STREETS)}],
  ['property',{name:'أرض زراعية — حوض الرمل',propertyType:'أرض',governorate:'الدقهلية',city:'المنصورة',village:'كفر البدماص',basin:'حوض الرمل',parcel:String(int(10,90)),propertyNumber:'',unit:'',area:'3 قراريط',address:''}],
  ['vehicle',{name:'سيارة ملاكي هيونداي إلنترا',plate:'د ع ط '+int(1000,9999),vehicleType:'ملاكي',make:'هيونداي',model:'إلنترا 2021',chassis:'KMH'+int(100000000,999999999),engine:'G4FG'+int(100000,999999),licenseInfo:'سارية حتى '+iso(thisYear+1,6,1)}]
 ];
 for(const [kind,data] of assetDefs){
  try{
   const a=await saveAsset(office,kind,data);
   const rec=pick(files);await linkAsset(office,rec.file.id,a.id,'محل النزاع');
   report.assets++;
  }catch{}
 }

 // ---------- 17) خطوات تالية + إنهاء وأرشفة لبعض الملفات ----------
 let closed=0,archived=0;
 for(const rec of files){
  const f=await office.r.files.get(rec.file.id);if(!f)continue;
  if(!['منتهٍ','مؤرشف'].includes(f.status)){
   f.nextStep=pick(STEP_POOL);f.nextStepDate=addDaysISO(today,int(-4,20));
   await office.r.files.put(f);
  }
  if(f.status==='متوقف'&&closed<4){try{await closeFile(office,f.id,{closedAt:addDaysISO(today,-int(3,60)),closeReason:'تم الإنهاء تجريبيًا — تسوية ودية.'});closed++}catch{}}
 }
 // أرشفة ملفين بلا مراحل قضائية (الأرشفة لا تحذف شيئًا)
 for(const rec of files){
  if(archived>=2)break;
  const st=await office.r.cases.byIndex('fileId',rec.file.id,5);
  if(st.length===0&&rec.file.status!=='منتهٍ'){
   try{await archiveFile(office,rec.file.id,'تجربة الأرشفة — بيانات كاملة محفوظة.');archived++}catch{}
  }
 }

 report.ms=Date.now()-t0;
 return report;
}
