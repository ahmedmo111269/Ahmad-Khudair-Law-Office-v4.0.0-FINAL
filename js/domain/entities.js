import {formatDate as fmtDate,formatDateTime as fmtDateTime} from '../core/format.js';
import {formatFileNumber} from '../core/file-number.js';
// تعريف موحّد لكل كيانات البرنامج: الحقول والمجموعات والأعمدة الظاهرة في الجداول.
// النماذج وصفحات السجل والجداول والتقارير تعتمد كلها على هذا الملف بدل تكرار الحقول في كل صفحة.
// كل الحقول اختيارية ما عدا اسم الشخص وربط السجل بأصله (req:true).
//
// t (النوع): text | textarea | number | date | time | select | lookup | ref | phones | bool | readonly
// lk: فئة القائمة في مخزن lookups (قابلة للتعديل من الإعدادات)، ref: المخزن المرجعي، opts: قيم ثابتة تقنية.
// grid: يظهر كعمود افتراضي في الجداول، g: مجموعة الحقل في النموذج.

export const STATUS_LABELS={open:'مفتوح',closed:'منتهٍ',pending:'قيد الانتظار',done:'تم',cancelled:'ملغي',active:'نشط',inactive:'غير نشط',not_started:'لم يبدأ',suspended:'موقوف',completed:'مكتمل',judged:'صدر حكم',unpaid:'غير مدفوع',partial:'مدفوع جزئيًا',paid:'مدفوع',normal:'عادي',urgent:'عاجل',critical:'حرج',principal:'موكل',opponent:'خصم',incoming:'وارد',outgoing:'صادر',client:'موكل مسجل',other:'طرف آخر',create:'إنشاء',update:'تعديل',delete:'حذف منطقي',archive:'أرشفة',restore:'استعادة',reopen:'إعادة فتح'};
export const label=v=>STATUS_LABELS[v]??v;

const PRIORITY=[['normal','عادي'],['urgent','عاجل'],['critical','حرج']];
const BOOL=[['true','نعم'],['false','لا']];

// ===== حقول الملف حسب النوع (حقول مسطحة قابلة للفهرسة والبحث، وليست JSON واحدًا) =====
export const FILE_TYPE_GROUPS={
 civil:{label:'بيانات النزاع المدني / التجاري / العمالي',fields:[
  {k:'civilDisputeNature',l:'طبيعة النزاع',t:'lookup',lk:'civilDisputeNature'},
  {k:'civilSubject',l:'موضوع النزاع',t:'textarea'},
  {k:'civilRequests',l:'الطلبات',t:'textarea'},
  {k:'employerName',l:'جهة العمل / الطرف التجاري',t:'text'},
  {k:'legalNotes',l:'ملاحظات قانونية',t:'textarea'}]},
 criminal:{label:'البيانات الجنائية',fields:[
  {k:'crimProcedureType',l:'نوع الإجراء',t:'lookup',lk:'criminalProcedureType'},
  {k:'clientCapacity',l:'صفة الموكل',t:'lookup',lk:'criminalCapacity'},
  {k:'criminalStatus',l:'الحالة الجنائية',t:'lookup',lk:'criminalStatus'},
  {k:'incidentDate',l:'تاريخ الواقعة',t:'date'},
  {k:'incidentPlace',l:'مكان الواقعة',t:'text'},
  {k:'charge',l:'الاتهام / الوصف',t:'text'},
  {k:'legalArticles',l:'المواد القانونية',t:'text'},
  {k:'arrestingAuthority',l:'جهة الضبط',t:'text'},
  {k:'policeStation',l:'قسم / مركز الشرطة',t:'text'},
  {k:'prosecution',l:'النيابة',t:'text'},
  {k:'crimCourt',l:'المحكمة',t:'lookup',lk:'court'},
  {k:'incidentSummary',l:'ملخص الواقعة',t:'textarea'}]},
 family:{label:'بيانات الأسرة',fields:[
  {k:'familyCaseType',l:'نوع القضية',t:'lookup',lk:'familyCaseType'},
  {k:'partiesRelation',l:'العلاقة بين الأطراف',t:'text'},
  {k:'maritalStatus',l:'الحالة الاجتماعية',t:'lookup',lk:'maritalStatus'},
  {k:'marriageDate',l:'تاريخ الزواج',t:'date'},
  {k:'divorceDate',l:'تاريخ الطلاق (إن وجد)',t:'date'},
  {k:'hasChildren',l:'يوجد أطفال؟',t:'bool'},
  {k:'childrenCount',l:'عدد الأطفال',t:'number'},
  {k:'childrenDetails',l:'بيانات الأطفال',t:'textarea'},
  {k:'familyFinancialNotes',l:'ملاحظات مالية (نص فقط بدون حسابات)',t:'textarea'}]},
 admin:{label:'بيانات مجلس الدولة / النزاع الإداري',fields:[
  {k:'adminDisputeType',l:'نوع النزاع',t:'lookup',lk:'adminDisputeType'},
  {k:'adminAuthority',l:'الجهة الإدارية',t:'text'},
  {k:'hasDecision',l:'يوجد قرار إداري؟',t:'bool'},
  {k:'decisionNumber',l:'رقم القرار',t:'text'},
  {k:'decisionDate',l:'تاريخ القرار',t:'date'},
  {k:'decisionIssuer',l:'مُصدر القرار',t:'text'},
  {k:'decisionSummary',l:'ملخص القرار',t:'textarea'}]},
 execution:{label:'بيانات التنفيذ',fields:[
  {k:'execBondType',l:'نوع السند التنفيذي',t:'lookup',lk:'executionBondType'},
  {k:'execBondNumber',l:'رقم السند',t:'text'},
  {k:'execBondDate',l:'تاريخ السند',t:'date'},
  {k:'execSubject',l:'موضوع التنفيذ',t:'textarea'}]},
 consultation:{label:'بيانات الاستشارة',fields:[
  {k:'consultationSubject',l:'موضوع الاستشارة',t:'textarea'},
  {k:'consultationAnswer',l:'الرأي / الرد',t:'textarea'}]},
 other:{label:'بيانات إضافية',fields:[
  {k:'procedureSubject',l:'موضوع الإجراء',t:'textarea'}]}
};
// يربط نوع الملف (قيمة قابلة للتعديل من القوائم) بمجموعة الحقول بالكلمات المفتاحية.
export function fileTypeGroup(type=''){
 const t=String(type||'');
 if(/جنائ|جنح|جناي/.test(t))return 'criminal';
 if(/أسر|اسر|أحوال|احوال/.test(t))return 'family';
 if(/مجلس الدولة|إدار|ادار/.test(t))return 'admin';
 if(/تنفيذ/.test(t))return 'execution';
 if(/استشار/.test(t))return 'consultation';
 if(/مدني|تجاري|عمال|تسوية|صلح|إيجار|ايجار/.test(t))return 'civil';
 return t?'other':'';
}
export const allFileTypeFields=()=>Object.values(FILE_TYPE_GROUPS).flatMap(g=>g.fields);

const phonesField={k:'phones',l:'أرقام الهاتف',t:'phones',g:'الاتصال'};

export const ENTITIES={
 clients:{label:'موكل',plural:'الموكلون',title:r=>r.fullName,route:'client',dateField:'createdAt',dateIndex:'createdAt',fields:[
  {k:'fullName',l:'الاسم الكامل',t:'text',req:true,grid:true,g:'البيانات الأساسية'},
  {k:'clientCode',l:'الملف الرئيسي',t:'readonly',grid:true,g:'البيانات الأساسية'},
  {k:'clientType',l:'نوع الشخص',t:'lookup',lk:'clientType',grid:true,g:'البيانات الأساسية'},
  {k:'nationalId',l:'الرقم القومي',t:'text',grid:true,g:'البيانات الأساسية'},
  {k:'idType',l:'نوع إثبات آخر',t:'lookup',lk:'idType',g:'البيانات الأساسية'},
  {k:'idNumber',l:'رقم الإثبات الآخر',t:'text',g:'البيانات الأساسية'},
  {k:'nationality',l:'الجنسية',t:'text',g:'البيانات الأساسية'},
  {k:'gender',l:'النوع',t:'select',opts:[['ذكر','ذكر'],['أنثى','أنثى']],g:'البيانات الأساسية'},
  {k:'birthDate',l:'تاريخ الميلاد',t:'date',g:'البيانات الأساسية'},
  {k:'occupation',l:'المهنة',t:'text',g:'البيانات الأساسية'},
  {k:'maritalStatus',l:'الحالة الاجتماعية',t:'lookup',lk:'maritalStatus',g:'البيانات الأساسية'},
  {...phonesField,grid:true},
  {k:'email',l:'البريد الإلكتروني',t:'text',g:'الاتصال'},
  {k:'governorate',l:'المحافظة',t:'text',g:'الاتصال'},
  {k:'city',l:'المدينة / المركز',t:'text',grid:true,g:'الاتصال'},
  {k:'address',l:'العنوان',t:'textarea',grid:true,g:'الاتصال'},
  {k:'workAddress',l:'عنوان العمل',t:'textarea',g:'الاتصال'},
  {k:'commercialRegister',l:'السجل التجاري',t:'text',g:'بيانات الشركات والجهات'},
  {k:'taxNumber',l:'الرقم الضريبي',t:'text',g:'بيانات الشركات والجهات'},
  {k:'legalRepresentative',l:'الممثل القانوني',t:'text',g:'بيانات الشركات والجهات'},
  {k:'referredBy',l:'عن طريق',t:'text',g:'أخرى'},
  {k:'status',l:'الحالة',t:'select',opts:[['active','نشط'],['inactive','غير نشط']],grid:true,g:'أخرى'},
  {k:'notes',l:'ملاحظات',t:'textarea',g:'أخرى'},
  {k:'createdAt',l:'تاريخ الإضافة',t:'readonly',dt:'date',grid:true}]},
 opponents:{label:'خصم',plural:'الخصوم',title:r=>r.name,route:'opponent',dateField:'createdAt',fields:[
  {k:'name',l:'الاسم',t:'text',req:true,grid:true,g:'البيانات الأساسية'},
  {k:'opponentType',l:'نوع الشخص',t:'lookup',lk:'clientType',grid:true,g:'البيانات الأساسية'},
  {k:'capacity',l:'الصفة الغالبة',t:'lookup',lk:'partyRole',grid:true,g:'البيانات الأساسية'},
  {k:'nationalId',l:'الرقم القومي',t:'text',grid:true,g:'البيانات الأساسية'},
  {...phonesField,grid:true},
  {k:'address',l:'العنوان',t:'textarea',grid:true,g:'الاتصال'},
  {k:'lawyerName',l:'محامي الخصم',t:'text',grid:true,g:'محامي الخصم'},
  {k:'lawyerPhone',l:'هاتف محامي الخصم',t:'text',g:'محامي الخصم'},
  {k:'notes',l:'ملاحظات',t:'textarea',g:'أخرى'},
  {k:'createdAt',l:'تاريخ الإضافة',t:'readonly',dt:'date'}]},
 files:{label:'ملف',plural:'الملفات',title:r=>`${formatFileNumber(r)||''} — ${r.title||''}`.replace(/^ — /,''),route:'file',dateField:'openedAt',dateIndex:'openedAt',fields:[
  {k:'fileNumber',l:'رقم الملف الفرعي',t:'readonly',grid:true,g:'البيانات الأساسية'},
  {k:'title',l:'عنوان الملف',t:'text',grid:true,g:'البيانات الأساسية'},
  {k:'fileType',l:'نوع الملف',t:'lookup',lk:'fileType',grid:true,g:'البيانات الأساسية'},
  {k:'mainCategory',l:'التصنيف الرئيسي',t:'lookup',lk:'fileMainCategory',g:'البيانات الأساسية'},
  {k:'subCategory',l:'التصنيف الفرعي',t:'text',g:'البيانات الأساسية'},
  {k:'status',l:'الحالة',t:'lookup',lk:'fileStatus',grid:true,g:'البيانات الأساسية'},
  {k:'priority',l:'الأولوية',t:'select',opts:PRIORITY,grid:true,g:'البيانات الأساسية'},
  {k:'openedAt',l:'تاريخ الفتح',t:'date',grid:true,g:'البيانات الأساسية'},
  {k:'responsibleLawyer',l:'المحامي المسؤول',t:'lookup',lk:'lawyer',grid:true,g:'فريق العمل'},
  {k:'coLawyers',l:'المحامون المشاركون',t:'text',g:'فريق العمل'},
  {k:'staff',l:'الموظفون المسؤولون',t:'text',g:'فريق العمل'},
  {k:'nextStep',l:'الخطوة التالية',t:'text',g:'المتابعة'},
  {k:'nextStepDate',l:'تاريخ الخطوة التالية',t:'date',g:'المتابعة'},
  {k:'closedAt',l:'تاريخ الانتهاء',t:'date',g:'المتابعة'},
  {k:'closeReason',l:'سبب الانتهاء',t:'text',g:'المتابعة'},
  {k:'notes',l:'ملاحظات',t:'textarea',g:'المتابعة'},
  {k:'partyNames',l:'الأطراف',t:'readonly',grid:true},
  {k:'lastActivityAt',l:'آخر تحديث',t:'readonly',dt:'date',grid:true}]},
 cases:{label:'قضية / مرحلة',plural:'القضايا والمراحل',title:r=>`${r.stageType||r.numberType||'مرحلة'} ${r.caseNumber||''}${r.caseYear?'/'+r.caseYear:''}`,route:'case',dateField:'filingDate',dateIndex:'filingDate',fields:[
  {k:'fileId',l:'الملف',t:'ref',ref:'files',req:true,grid:true,g:'الربط'},
  {k:'stageType',l:'نوع المرحلة',t:'lookup',lk:'stageType',grid:true,g:'بيانات المرحلة'},
  {k:'numberType',l:'نوع الرقم',t:'lookup',lk:'numberType',grid:true,g:'بيانات المرحلة'},
  {k:'lifecycle',l:'حالة المرحلة في المسار',t:'select',opts:[['planned','مخططة'],['active','جارية'],['done','منتهية'],['skipped','متخطاة']],g:'بيانات المرحلة'},
  {k:'outcome',l:'نتيجة المرحلة',t:'lookup',lk:'stageOutcome',g:'بيانات المرحلة'},
  {k:'caseNumber',l:'الرقم',t:'text',grid:true,g:'بيانات المرحلة'},
  {k:'caseYear',l:'السنة',t:'number',grid:true,g:'بيانات المرحلة'},
  {k:'courtId',l:'المحكمة / الجهة',t:'lookup',lk:'court',grid:true,g:'بيانات المرحلة'},
  {k:'chamber',l:'الدائرة',t:'text',grid:true,g:'بيانات المرحلة'},
  {k:'degree',l:'درجة التقاضي',t:'lookup',lk:'litigationDegree',grid:true,g:'بيانات المرحلة'},
  {k:'stageOrder',l:'ترتيب المرحلة في الملف',t:'number',g:'بيانات المرحلة'},
  {k:'filingDate',l:'تاريخ القيد',t:'date',grid:true,g:'بيانات المرحلة'},
  {k:'status',l:'الحالة',t:'lookup',lk:'stageStatus',grid:true,g:'بيانات المرحلة'},
  {k:'clientCapacity',l:'صفة الموكل',t:'lookup',lk:'partyRole',g:'الأطراف والموضوع'},
  {k:'opponentCapacity',l:'صفة الخصم',t:'lookup',lk:'partyRole',g:'الأطراف والموضوع'},
  {k:'subject',l:'الموضوع',t:'textarea',grid:true,g:'الأطراف والموضوع'},
  {k:'requests',l:'الطلبات',t:'textarea',g:'الأطراف والموضوع'},
  {k:'policeStation',l:'قسم / مركز الشرطة',t:'text',g:'بيانات جنائية (إن وجدت)'},
  {k:'prosecution',l:'النيابة',t:'text',g:'بيانات جنائية (إن وجدت)'},
  {k:'notes',l:'ملاحظات',t:'textarea',g:'الأطراف والموضوع'}]},
 hearings:{label:'جلسة',plural:'الجلسات',title:r=>`جلسة ${fmtDate(r.hearingDate)}`,route:'rec:hearings',dateField:'hearingDate',dateIndex:'hearingDate',calendar:true,fields:[
  {k:'caseId',l:'القضية / المرحلة',t:'ref',ref:'cases',req:true,grid:true,g:'الربط'},
  {k:'fileId',l:'الملف',t:'readonly',ref:'files',grid:true},
  {k:'hearingDate',l:'تاريخ الجلسة',t:'date',grid:true,g:'بيانات الجلسة'},
  {k:'hearingTime',l:'الوقت',t:'time',grid:true,g:'بيانات الجلسة'},
  {k:'court',l:'المحكمة',t:'lookup',lk:'court',grid:true,g:'بيانات الجلسة'},
  {k:'chamber',l:'الدائرة',t:'text',grid:true,g:'بيانات الجلسة'},
  {k:'type',l:'نوع الجلسة',t:'lookup',lk:'hearingType',grid:true,g:'بيانات الجلسة'},
  {k:'reason',l:'سبب الجلسة / المطلوب',t:'text',grid:true,g:'بيانات الجلسة'},
  {k:'attendance',l:'الحضور',t:'lookup',lk:'attendance',g:'ما تم في الجلسة'},
  {k:'result',l:'القرار',t:'textarea',grid:true,g:'ما تم في الجلسة'},
  {k:'previousHearingId',l:'الجلسة السابقة (اختياري)',t:'hearingSelect',g:'بيانات الجلسة'},
  {k:'status',l:'حالة الجلسة',t:'lookup',lk:'hearingStatus',grid:true,g:'بيانات الجلسة'},
  {k:'adjournedTo',l:'التأجيل إلى',t:'date',grid:true,g:'ما تم في الجلسة'},
  {k:'adjournReason',l:'سبب التأجيل',t:'text',g:'ما تم في الجلسة'},
  {k:'nextAction',l:'المطلوب للجلسة القادمة',t:'text',g:'ما تم في الجلسة'},
  {k:'notes',l:'ملاحظات',t:'textarea',g:'ما تم في الجلسة'}]},
 serviceRecords:{label:'إعلان / إنذار',plural:'المحضرين والإعلانات',title:r=>`${formatFileNumber(r.internalNumber)||r.noticeNumber||'إعلان'} — ${r.partyName||''}`,route:'rec:serviceRecords',dateField:'serviceDate',dateIndex:'serviceDate',calendar:true,fields:[
  {k:'internalNumber',l:'رقم الإعلان (تسلسلي المكتب)',t:'readonly',grid:true,g:'البيانات الأساسية'},
  {k:'fileId',l:'الملف',t:'ref',ref:'files',req:true,grid:true,g:'الربط'},
  {k:'caseId',l:'المرحلة',t:'ref',ref:'cases',grid:true,g:'الربط'},
  {k:'hearingId',l:'الجلسة المرتبطة',t:'hearingSelect',grid:false,g:'الربط'},
  {k:'partyId',l:'الطرف المطلوب إعلانه (اختياري)',t:'partySelect',g:'بيانات الطرف'},
  {k:'partyName',l:'المعلن إليه',t:'text',grid:true,g:'بيانات الطرف'},
  {k:'partyRole',l:'صفة المعلن إليه',t:'text',grid:true,g:'بيانات الطرف'},
  {k:'actionType',l:'نوع الإجراء',t:'lookup',lk:'serviceAction',grid:true,g:'البيانات الأساسية'},
  {k:'type',l:'نوع الإعلان / الإنذار',t:'lookup',lk:'serviceType',grid:true,g:'البيانات الأساسية'},
  {k:'createdAt',l:'تاريخ إنشاء الطلب',t:'readonly',dt:'date',grid:true,g:'البيانات الأساسية'},
  {k:'submittedAt',l:'تاريخ تقديمه للمحضرين',t:'date',grid:true,g:'بيانات الإعلان'},
  {k:'noticeNumber',l:'رقم الإعلان / الإنذار',t:'text',grid:true,g:'بيانات الإعلان'},
  {k:'year',l:'السنة',t:'number',grid:true,g:'بيانات الإعلان'},
  {k:'court',l:'المحكمة / الجهة',t:'lookup',lk:'court',grid:true,g:'بيانات المحضرين'},
  {k:'section',l:'قسم المحضرين',t:'lookup',lk:'bailiffSection',grid:true,g:'بيانات المحضرين'},
  {k:'office',l:'مكتب المحضرين',t:'lookup',lk:'bailiffOffice',grid:true,g:'بيانات المحضرين'},
  {k:'bailiffId',l:'المحضر',t:'bailiffSelect',g:'بيانات المحضرين'},
  {k:'bailiffName',l:'اسم المحضر (لقطة وقت التسجيل)',t:'readonly',grid:true,g:'بيانات المحضرين'},
  {k:'serviceDate',l:'تاريخ الإعلان / المحاولة',t:'date',grid:true,g:'بيانات الإعلان'},
  {k:'status',l:'حالة الإعلان',t:'lookup',lk:'serviceStatus',grid:true,g:'النتيجة والمتابعة'},
  {k:'result',l:'نتيجة الإعلان',t:'lookup',lk:'serviceResult',grid:true,g:'النتيجة والمتابعة'},
  {k:'previousServiceId',l:'إعادة إعلان لسجل سابق',t:'serviceSelect',g:'الربط'},
  {k:'governorate',l:'المحافظة',t:'text',grid:true,g:'محل الإعلان'},
  {k:'district',l:'المركز / القسم',t:'text',grid:true,g:'محل الإعلان'},
  {k:'area',l:'المنطقة',t:'text',g:'محل الإعلان'},
  {k:'address',l:'العنوان بالتفصيل',t:'textarea',g:'محل الإعلان'},
  {k:'alternativeAddress',l:'عنوان بديل',t:'textarea',g:'محل الإعلان'},
  {k:'addressNotes',l:'ملاحظات عن محل الإعلان',t:'textarea',g:'محل الإعلان'},
  {k:'notes',l:'ملاحظات',t:'textarea',grid:true,g:'النتيجة والمتابعة'}]},
 bailiffs:{label:'محضر',plural:'المحضرون',title:r=>r.name||'محضر',route:'rec:bailiffs',fields:[
  {k:'name',l:'اسم المحضر',t:'text',req:true,grid:true,g:'البيانات الأساسية'},
  {k:'court',l:'المحكمة',t:'lookup',lk:'court',grid:true,g:'بيانات العمل'},
  {k:'section',l:'قسم المحضرين',t:'lookup',lk:'bailiffSection',grid:true,g:'بيانات العمل'},
  {k:'office',l:'مكتب المحضرين',t:'lookup',lk:'bailiffOffice',grid:true,g:'بيانات العمل'},
  {k:'phone',l:'الهاتف',t:'text',grid:true,g:'الاتصال'},
  {k:'email',l:'البريد الإلكتروني',t:'text',g:'الاتصال'},
  {k:'isActive',l:'نشط',t:'bool',grid:true,g:'أخرى'},
  {k:'notes',l:'ملاحظات',t:'textarea',g:'أخرى'}]},

 procedures:{label:'عمل إداري',plural:'الأعمال الإدارية',title:r=>r.description||r.type||'عمل إداري',route:'rec:procedures',dateField:'internalDueDate',dateIndex:'internalDueDate',calendar:true,fields:[
  {k:'fileId',l:'الملف',t:'ref',ref:'files',req:true,grid:true,g:'الربط'},
  {k:'caseId',l:'القضية / المرحلة (اختياري)',t:'ref',ref:'cases',grid:true,g:'الربط'},
  {k:'type',l:'نوع العمل',t:'lookup',lk:'procedureType',grid:true,g:'بيانات العمل'},
  {k:'description',l:'الوصف',t:'textarea',grid:true,g:'بيانات العمل'},
  {k:'actionDate',l:'تاريخ العمل',t:'date',grid:true,g:'بيانات العمل'},
  {k:'internalDueDate',l:'موعد المتابعة',t:'date',grid:true,g:'بيانات العمل'},
  {k:'status',l:'الحالة',t:'select',opts:[['open','مفتوح'],['pending','قيد الانتظار'],['done','تم'],['cancelled','ملغي']],grid:true,g:'بيانات العمل'},
  {k:'priority',l:'الأولوية',t:'select',opts:PRIORITY,grid:true,g:'بيانات العمل'},
  {k:'assignedTo',l:'المكلّف',t:'lookup',lk:'lawyer',grid:true,g:'بيانات العمل'},
  {k:'result',l:'النتيجة',t:'textarea',g:'النتيجة'},
  {k:'nextAction',l:'الإجراء التالي',t:'text',g:'النتيجة'},
  {k:'notes',l:'ملاحظات',t:'textarea',g:'النتيجة'}]},
 appointments:{label:'موعد',plural:'المواعيد',title:r=>r.title||'موعد',route:'rec:appointments',dateField:'date',dateIndex:'date',calendar:true,fields:[
  {k:'title',l:'عنوان الموعد',t:'text',grid:true,g:'بيانات الموعد'},
  {k:'date',l:'التاريخ',t:'date',grid:true,g:'بيانات الموعد'},
  {k:'time',l:'الوقت',t:'time',grid:true,g:'بيانات الموعد'},
  {k:'location',l:'المكان',t:'text',grid:true,g:'بيانات الموعد'},
  {k:'withWhom',l:'مع',t:'text',grid:true,g:'بيانات الموعد'},
  {k:'status',l:'الحالة',t:'lookup',lk:'appointmentStatus',grid:true,g:'بيانات الموعد'},
  {k:'clientId',l:'الموكل',t:'ref',ref:'clients',grid:true,g:'الربط (ملف أو موكل)'},
  {k:'fileId',l:'الملف',t:'ref',ref:'files',grid:true,g:'الربط (ملف أو موكل)'},
  {k:'notes',l:'ملاحظات',t:'textarea',g:'بيانات الموعد'}]},
 communications:{label:'اتصال',plural:'الاتصالات',title:r=>r.subject||'اتصال',route:'rec:communications',dateField:'date',dateIndex:'date',calendar:true,fields:[
  {k:'date',l:'التاريخ',t:'date',grid:true,g:'بيانات الاتصال'},
  {k:'time',l:'الوقت',t:'time',g:'بيانات الاتصال'},
  {k:'channel',l:'الوسيلة',t:'lookup',lk:'commChannel',grid:true,g:'بيانات الاتصال'},
  {k:'direction',l:'الاتجاه',t:'select',opts:[['incoming','وارد'],['outgoing','صادر']],grid:true,g:'بيانات الاتصال'},
  {k:'contactName',l:'اسم المتصل / المتصل به',t:'text',grid:true,g:'بيانات الاتصال'},
  {k:'phone',l:'الهاتف',t:'text',g:'بيانات الاتصال'},
  {k:'subject',l:'الموضوع',t:'text',grid:true,g:'بيانات الاتصال'},
  {k:'summary',l:'الملخص',t:'textarea',g:'بيانات الاتصال'},
  {k:'followUpDate',l:'تاريخ المتابعة',t:'date',grid:true,g:'بيانات الاتصال'},
  {k:'clientId',l:'الموكل',t:'ref',ref:'clients',grid:true,g:'الربط (ملف أو موكل)'},
  {k:'fileId',l:'الملف',t:'ref',ref:'files',grid:true,g:'الربط (ملف أو موكل)'}]},
 caseNotes:{label:'ملاحظة',plural:'الملاحظات',title:r=>String(r.content||'ملاحظة').slice(0,40),route:'rec:caseNotes',dateField:'createdAt',dateIndex:'createdAt',fields:[
  {k:'fileId',l:'الملف',t:'ref',ref:'files',req:true,grid:true,g:'الربط'},
  {k:'caseId',l:'القضية / المرحلة (اختياري)',t:'ref',ref:'cases',g:'الربط'},
  {k:'category',l:'التصنيف',t:'lookup',lk:'noteCategory',grid:true,g:'الملاحظة'},
  {k:'content',l:'نص الملاحظة',t:'textarea',grid:true,g:'الملاحظة'},
  {k:'createdAt',l:'تاريخ الإضافة',t:'readonly',dt:'date',grid:true}]},
 powersOfAttorney:{label:'توكيل',plural:'التوكيلات',title:r=>`توكيل ${r.poaNumber||''}`,route:'rec:powersOfAttorney',dateField:'issuedDate',dateIndex:'issuedDate',fields:[
  {k:'clientId',l:'الموكل',t:'ref',ref:'clients',req:true,grid:true,g:'الربط'},
  {k:'fileId',l:'الملف (اختياري)',t:'ref',ref:'files',g:'الربط'},
  {k:'poaNumber',l:'رقم التوكيل',t:'text',grid:true,g:'بيانات التوكيل'},
  {k:'poaLetter',l:'الحرف',t:'text',g:'بيانات التوكيل'},
  {k:'poaYear',l:'السنة',t:'number',grid:true,g:'بيانات التوكيل'},
  {k:'type',l:'نوع التوكيل',t:'lookup',lk:'poaType',grid:true,g:'بيانات التوكيل'},
  {k:'notaryOffice',l:'مكتب التوثيق',t:'text',grid:true,g:'بيانات التوكيل'},
  {k:'issuedDate',l:'تاريخ التحرير',t:'date',grid:true,g:'بيانات التوكيل'},
  {k:'expiryDate',l:'تاريخ الانتهاء (إن وجد)',t:'date',g:'بيانات التوكيل'},
  {k:'attorneys',l:'المحامون الموكَّلون',t:'text',g:'بيانات التوكيل'},
  {k:'status',l:'الحالة',t:'lookup',lk:'poaStatus',grid:true,g:'بيانات التوكيل'},
  {k:'physicalLocation',l:'مكان حفظ الأصل',t:'text',g:'بيانات التوكيل'},
  {k:'scope',l:'نطاق التوكيل',t:'textarea',g:'بيانات التوكيل'},
  {k:'notes',l:'ملاحظات',t:'textarea',g:'بيانات التوكيل'}]},
 witnesses:{label:'شاهد',plural:'الشهود',title:r=>r.name||'شاهد',route:'rec:witnesses',dateField:'createdAt',fields:[
  {k:'caseId',l:'القضية / المرحلة',t:'ref',ref:'cases',req:true,grid:true,g:'الربط'},
  {k:'name',l:'الاسم',t:'text',grid:true,g:'بيانات الشاهد'},
  {k:'side',l:'شاهد لصالح',t:'text',grid:true,g:'بيانات الشاهد'},
  {...phonesField,g:'بيانات الشاهد',grid:true},
  {k:'address',l:'العنوان',t:'text',g:'بيانات الشاهد'},
  {k:'testimonySummary',l:'ملخص الشهادة',t:'textarea',g:'بيانات الشاهد'},
  {k:'notes',l:'ملاحظات',t:'textarea',g:'بيانات الشاهد'}]},
 expertReports:{label:'تقرير خبير',plural:'الخبراء',title:r=>r.expertName||'تقرير خبير',route:'rec:expertReports',dateField:'reportDate',dateIndex:'reportDate',calendar:true,fields:[
  {k:'caseId',l:'القضية / المرحلة',t:'ref',ref:'cases',req:true,grid:true,g:'الربط'},
  {k:'expertName',l:'اسم الخبير',t:'text',grid:true,g:'بيانات الخبير'},
  {k:'expertOffice',l:'مكتب الخبراء',t:'text',grid:true,g:'بيانات الخبير'},
  {k:'assignmentDate',l:'تاريخ الإحالة',t:'date',g:'بيانات الخبير'},
  {k:'sessionDate',l:'موعد جلسة الخبير',t:'date',grid:true,g:'بيانات الخبير'},
  {k:'reportDate',l:'تاريخ التقرير',t:'date',grid:true,g:'بيانات الخبير'},
  {k:'status',l:'الحالة',t:'text',grid:true,g:'بيانات الخبير'},
  {k:'summary',l:'ملخص التقرير',t:'textarea',g:'بيانات الخبير'},
  {k:'notes',l:'ملاحظات',t:'textarea',g:'بيانات الخبير'}]},
 judgments:{label:'حكم',plural:'الأحكام',title:r=>`حكم ${fmtDate(r.judgmentDate)}`,route:'rec:judgments',dateField:'judgmentDate',dateIndex:'judgmentDate',calendar:true,fields:[
  {k:'caseId',l:'القضية / المرحلة',t:'ref',ref:'cases',req:true,grid:true,g:'الربط'},
  {k:'fileId',l:'الملف',t:'readonly',ref:'files',grid:true},
  {k:'judgmentDate',l:'تاريخ الحكم',t:'date',grid:true,g:'بيانات الحكم'},
  {k:'judgmentNumber',l:'رقم الحكم',t:'text',g:'بيانات الحكم'},
  {k:'court',l:'المحكمة',t:'lookup',lk:'court',grid:true,g:'بيانات الحكم'},
  {k:'chamber',l:'الدائرة',t:'text',g:'بيانات الحكم'},
  {k:'stage',l:'المرحلة',t:'lookup',lk:'stageType',grid:true,g:'بيانات الحكم'},
  {k:'judgmentType',l:'نوع الحكم',t:'lookup',lk:'judgmentType',grid:true,g:'بيانات الحكم'},
  {k:'operativeSummary',l:'منطوق الحكم',t:'textarea',grid:true,g:'بيانات الحكم'},
  {k:'judgmentStatus',l:'حالة الحكم',t:'lookup',lk:'judgmentStatus',grid:true,g:'بعد الحكم'},
  {k:'isAppealed',l:'هل طُعن عليه؟',t:'bool',grid:true,g:'بعد الحكم'},
  {k:'nextStage',l:'المرحلة التالية',t:'lookup',lk:'stageType',g:'بعد الحكم'},
  {k:'notes',l:'ملاحظات',t:'textarea',g:'بعد الحكم'}]},
 execution:{label:'تنفيذ',plural:'التنفيذ',title:r=>`تنفيذ ${r.executionNumber||''}`,route:'rec:execution',dateField:'openedDate',dateIndex:'openedDate',fields:[
  {k:'caseId',l:'القضية / المرحلة',t:'ref',ref:'cases',req:true,grid:true,g:'الربط'},
  {k:'executionNumber',l:'رقم التنفيذ',t:'text',grid:true,g:'بيانات التنفيذ'},
  {k:'executionYear',l:'السنة',t:'number',grid:true,g:'بيانات التنفيذ'},
  {k:'bondType',l:'نوع السند',t:'lookup',lk:'executionBondType',grid:true,g:'بيانات التنفيذ'},
  {k:'executionOffice',l:'جهة التنفيذ',t:'text',grid:true,g:'بيانات التنفيذ'},
  {k:'against',l:'المنفذ ضده',t:'text',grid:true,g:'بيانات التنفيذ'},
  {k:'openedDate',l:'تاريخ الفتح',t:'date',grid:true,g:'بيانات التنفيذ'},
  {k:'stage',l:'المرحلة',t:'text',grid:true,g:'بيانات التنفيذ'},
  {k:'status',l:'الحالة',t:'select',opts:[['not_started','لم يبدأ'],['active','جارٍ'],['suspended','موقوف'],['completed','مكتمل'],['cancelled','ملغي']],grid:true,g:'بيانات التنفيذ'},
  {k:'notes',l:'ملاحظات',t:'textarea',g:'بيانات التنفيذ'}]},
 fees:{label:'أتعاب',plural:'الأتعاب',title:r=>`أتعاب ${r.agreedAmount||''}`,route:'rec:fees',dateField:'createdAt',dateIndex:'createdAt',fields:[
  {k:'fileId',l:'الملف',t:'ref',ref:'files',req:true,grid:true,g:'الربط'},
  {k:'agreementType',l:'نوع الاتفاق',t:'lookup',lk:'feeAgreementType',grid:true,g:'بيانات الأتعاب'},
  {k:'agreedAmount',l:'المبلغ المتفق عليه',t:'number',grid:true,g:'بيانات الأتعاب'},
  {k:'currency',l:'العملة',t:'text',grid:true,g:'بيانات الأتعاب'},
  {k:'paymentStatus',l:'حالة السداد',t:'select',opts:[['unpaid','غير مدفوع'],['partial','مدفوع جزئيًا'],['paid','مدفوع']],grid:true,g:'بيانات الأتعاب'},
  {k:'notes',l:'ملاحظات',t:'textarea',g:'بيانات الأتعاب'},
  {k:'createdAt',l:'تاريخ الإضافة',t:'readonly',dt:'date',grid:true}]},
 feePayments:{label:'دفعة أتعاب',plural:'دفعات الأتعاب',title:r=>`دفعة ${r.amount||''}`,route:'rec:feePayments',dateField:'date',dateIndex:'date',fields:[
  {k:'feeId',l:'الأتعاب',t:'ref',ref:'fees',req:true,grid:true,g:'الربط'},
  {k:'amount',l:'المبلغ',t:'number',grid:true,g:'الدفعة'},
  {k:'date',l:'التاريخ',t:'date',grid:true,g:'الدفعة'},
  {k:'method',l:'طريقة السداد',t:'text',grid:true,g:'الدفعة'},
  {k:'notes',l:'ملاحظات',t:'textarea',g:'الدفعة'}]},
 documentReferences:{label:'مستند',plural:'المستندات',title:r=>r.title||'مستند',route:'rec:documentReferences',dateField:'date',dateIndex:'date',fields:[
  {k:'fileId',l:'الملف',t:'ref',ref:'files',req:true,grid:true,g:'الربط'},
  {k:'title',l:'اسم المستند',t:'text',grid:true,g:'بيانات المستند'},
  {k:'type',l:'النوع',t:'lookup',lk:'documentType',grid:true,g:'بيانات المستند'},
  {k:'date',l:'التاريخ',t:'date',grid:true,g:'بيانات المستند'},
  {k:'isOriginal',l:'أصل؟',t:'bool',grid:true,g:'بيانات المستند'},
  {k:'physicalLocation',l:'مكان الحفظ',t:'text',grid:true,g:'بيانات المستند'},
  {k:'notes',l:'ملاحظات',t:'textarea',g:'بيانات المستند'}]},
 fileParties:{label:'طرف',plural:'أطراف الملفات',title:r=>r.name||'طرف',route:'rec:fileParties',dateField:'createdAt',fields:[
  {k:'fileId',l:'الملف',t:'ref',ref:'files',req:true,grid:true,g:'الربط'},
  {k:'partyKind',l:'نوع الطرف',t:'select',opts:[['client','موكل مسجل'],['opponent','خصم مسجل'],['other','طرف آخر']],grid:true,g:'الطرف'},
  {k:'clientId',l:'الموكل',t:'ref',ref:'clients',g:'الطرف'},
  {k:'opponentId',l:'الخصم',t:'ref',ref:'opponents',g:'الطرف'},
  {k:'name',l:'الاسم',t:'text',grid:true,g:'الطرف'},
  {k:'role',l:'الصفة في هذا الملف',t:'lookup',lk:'partyRole',grid:true,g:'الطرف'},
  {k:'roleGroup',l:'مجموعة العرض',t:'lookup',lk:'partyRoleGroup',g:'الطرف'},
  {k:'sequence',l:'الترتيب داخل المجموعة',t:'number',g:'الطرف'},
  {k:'isPrimary',l:'طرف أساسي',t:'bool',g:'الطرف'},
  {k:'isActive',l:'طرف نشط',t:'bool',g:'الطرف'},
  {k:'phone',l:'الهاتف',t:'readonly',grid:true},
  {k:'notes',l:'ملاحظات',t:'textarea',grid:true,g:'الطرف'}]},
 fileRelations:{label:'علاقة ملف',plural:'علاقات الملفات',title:r=>r.relationType||'علاقة',route:'rec:fileRelations',dateField:'createdAt',fields:[
  {k:'sourceFileId',l:'الملف',t:'ref',ref:'files',req:true,grid:true,g:'العلاقة'},
  {k:'relationType',l:'نوع العلاقة',t:'lookup',lk:'fileRelationType',grid:true,g:'العلاقة'},
  {k:'targetFileId',l:'الملف المرتبط',t:'ref',ref:'files',req:true,grid:true,g:'العلاقة'},
  {k:'notes',l:'ملاحظات',t:'textarea',grid:true,g:'العلاقة'}]},
 // v14 — مركز العمل: المهام المستقلة فقط (الجلسات/الأعمال/المواعيد تبقى كيانات أصلية). التسميات الظاهرة تُبدَّل بإعدادات المستخدم عبر workItemFieldOverrides.
 workItems:{label:'مهمة',plural:'المهام وعناصر العمل',title:r=>r.title||'مهمة',route:'actionCenter',dateField:'dueDate',dateIndex:'dueDate',fields:[
  {k:'title',l:'عنوان المهمة',t:'text',req:true,grid:true,g:'المهمة'},
  {k:'description',l:'الوصف / الملاحظات',t:'textarea',grid:true,g:'المهمة'},
  {k:'dueDate',l:'الموعد',t:'date',grid:true,g:'الموعد'},
  {k:'dueTime',l:'الوقت (اختياري)',t:'time',g:'الموعد'},
  {k:'priority',l:'الأولوية',t:'select',opts:[['urgent','عاجل جدًا'],['high','مرتفعة'],['medium','متوسطة'],['low','منخفضة']],grid:true,g:'التصنيف'},
  {k:'status',l:'الحالة',t:'select',opts:[['notStarted','لم يبدأ'],['inProgress','قيد التنفيذ'],['waiting','بانتظار'],['postponed','مؤجل'],['done','مكتمل'],['cancelled','ملغى']],grid:true,g:'التصنيف'},
  {k:'type',l:'النوع',t:'lookup',lk:'workItemType',grid:true,g:'التصنيف'},
  {k:'tags',l:'الوسوم (افصل بفاصلة)',t:'text',grid:true,g:'التصنيف'},
  {k:'fileId',l:'الملف (اختياري)',t:'ref',ref:'files',g:'الربط (اختياري)'},
  {k:'caseId',l:'القضية / المرحلة (اختياري)',t:'ref',ref:'cases',g:'الربط (اختياري)'},
  {k:'clientId',l:'الموكل (اختياري)',t:'ref',ref:'clients',g:'الربط (اختياري)'},
  {k:'recurFreq',l:'التكرار',t:'select',opts:[['daily','يوميًا'],['weekly','أسبوعيًا'],['monthly','شهريًا'],['yearly','سنويًا']],newOnly:true,g:'التكرار (اختياري)'},
  {k:'recurInterval',l:'كل كم مرة (1 = كل مرة)',t:'number',newOnly:true,g:'التكرار (اختياري)'},
  {k:'recurUntil',l:'ينتهي في (اختياري)',t:'date',newOnly:true,g:'التكرار (اختياري)'}]},
 activityLog:{label:'نشاط',plural:'سجل النشاط',title:r=>r.summary||'نشاط',dateField:'timestamp',dateIndex:'timestamp',readOnly:true,fields:[
  {k:'timestamp',l:'الوقت',t:'readonly',dt:'datetime',grid:true},
  {k:'entityType',l:'نوع السجل',t:'readonly',grid:true},
  {k:'action',l:'العملية',t:'readonly',grid:true},
  {k:'summary',l:'الوصف',t:'readonly',grid:true},
  {k:'fileId',l:'الملف',t:'readonly',ref:'files',grid:true}]}
};
export const ENTITY_LABEL=Object.fromEntries(Object.entries(ENTITIES).map(([k,v])=>[k,v.label]));

export {fmtDate,fmtDateTime};
export const phonesOf=r=>[...(Array.isArray(r?.phones)?r.phones:[]),r?.phone,r?.phone1,r?.phone2].filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i);

// الحالة الإدارية للملف (ليست قاعدة قانونية)
export const CLOSED_FILE_STATUSES=['closed','منتهٍ','منتهي','مؤرشف'];
export const isClosedFile=f=>Boolean(f?.isArchived)||CLOSED_FILE_STATUSES.includes(f?.status);

// عرض القيمة كنص للجدول/السجل
export function displayValue(field,row,refs){
 const v=row?.[field.k];
 // أرقام الملفات تُعرض دائمًا بالصيغة الموحدة (2/2026) وليس بالكود التقني (CL-/LF-/SR-)
 if(field.k==='fileNumber'||field.k==='clientCode'||field.k==='internalNumber'){const t=formatFileNumber(v);return t||''}
 if(field.t==='phones')return phonesOf(row).join(' ، ');
 if(field.ref){const lbl=refs?.get?.(v);return lbl||(v?'—':'')}
 if(v===undefined||v===null||v==='')return '';
 if(field.t==='bool')return v===true||v==='true'?'نعم':v===false||v==='false'?'لا':String(v);
 if(field.t==='date'||field.dt==='date')return fmtDate(v);
 if(field.dt==='datetime')return fmtDateTime(v);
 if(field.opts){const o=field.opts.find(x=>x[0]===String(v));if(o)return o[1]}
 if(field.k==='entityType')return ENTITY_LABEL[v]||v;
 return String(label(v));
}
// نوع العمود في الجدول (لعوامل التصفية)
export function columnType(f){if(f.t==='number')return 'number';if(f.t==='date'||f.dt==='date'||f.dt==='datetime')return 'date';if(f.t==='bool')return 'bool';return 'text'}
