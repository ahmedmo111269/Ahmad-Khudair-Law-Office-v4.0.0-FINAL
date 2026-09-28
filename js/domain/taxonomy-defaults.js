// الشجرة الافتراضية للأعمال: تصنيفات ← أنواع ملفات ← أنواع مراحل ← قوالب مسارات مقترحة.
// هذه **بيانات بداية** تُزرع مرة واحدة في مخزن taxonomy/caseTemplates، ثم يعدّلها المكتب من الإعدادات.
// ليست قواعد قانونية: القوالب اقتراح إداري فقط، وكل مرحلة يمكن حذفها أو تخطيها أو إضافة غيرها.
// المعرفات (id) ثابتة ولا تتغير حتى لو تغيّر الاسم، والسجلات تحتفظ بلقطة من الاسم وقت الإنشاء.

// ---- مجموعات حقول قابلة لإعادة الاستخدام (تُخزن قيمها كحقول مسطحة x_<key> على سجل الملف) ----
const F=(k,l,t='text',extra={})=>({k,l,t,...extra});
const REF=[F('authority','الجهة'),F('refNumber','الرقم'),F('refYear','السنة','number'),F('refDate','التاريخ','date'),F('subject','الموضوع','textarea')];
const RESULT=(lk)=>[F('result','النتيجة','lookup',{lk:lk||'genericResult'}),F('resultDate','تاريخ النتيجة','date')];
const PROPERTY_HINT=[F('propertyHint','العقار (يُفضّل ربطه من تبويب الأصول)','text')];
export const FIELD_SETS={
 policeReport:[F('refNumber','رقم المحضر'),F('refYear','السنة','number'),F('policeStation','القسم / المركز'),F('refDate','تاريخ المحضر','date'),F('reportKind','نوع المحضر','lookup',{lk:'reportKind'}),F('prosecution','النيابة المختصة'),F('subject','وصف مختصر للواقعة','textarea'),...RESULT('reportOutcome')],
 criminalCase:[F('refNumber','رقم القضية'),F('refYear','السنة','number'),F('policeStation','القسم / المركز'),F('prosecution','النيابة'),F('charge','الاتهام / الوصف'),F('legalArticles','المواد'),F('startedAs','بدأ الملف','lookup',{lk:'criminalOrigin'}),F('custody','موقف الموكل','lookup',{lk:'criminalStatus'})],
 prosecutionDecision:[F('authority','الجهة / النيابة'),F('refNumber','رقم القرار'),F('refDate','تاريخ القرار','date'),F('subject','موضوع القرار','textarea'),...RESULT('decisionResult')],
 lawsuit:[F('court','المحكمة','lookup',{lk:'court'}),F('refNumber','رقم الدعوى'),F('refYear','السنة','number'),F('chamber','الدائرة'),F('subject','الموضوع / الطلبات','textarea')],
 requestLike:[...REF,F('decision','القرار'),F('decisionDate','تاريخ القرار','date'),F('nextAction','الإجراء التالي')],
 grievance:[F('authority','الجهة'),F('contestedDecision','القرار محل التظلم'),F('decisionDate','تاريخ القرار','date'),F('refDate','تاريخ التظلم','date'),...RESULT(),F('nextAction','الإجراء التالي')],
 settlement:[F('refNumber','رقم الطلب'),F('refYear','السنة','number'),F('settlementOffice','مكتب التسوية'),F('refDate','تاريخ التقديم','date'),F('subject','موضوع الطلب','textarea'),...RESULT('settlementResult')],
 hisba:[F('hisbaKind','نوع الطلب','lookup',{lk:'hisbaKind'}),...REF,...RESULT()],
 disputeResolution:[F('authority','لجنة فض المنازعات'),F('refNumber','رقم الطلب'),F('refYear','السنة','number'),F('refDate','تاريخ الطلب','date'),F('adminAuthority','الجهة الإدارية'),F('contestedDecision','القرار محل النزاع'),F('subject','موضوع النزاع','textarea'),...RESULT()],
 adminLawsuit:[F('courtKind','نوع المحكمة','lookup',{lk:'adminCourtKind'}),F('refNumber','رقم الدعوى'),F('refYear','السنة','number'),F('chamber','الدائرة'),F('adminAuthority','الجهة الإدارية'),F('contestedDecision','القرار المطعون فيه'),F('subject','الطلبات','textarea')],
 adminAppeal:[F('appealKind','نوع الطعن الفعلي','lookup',{lk:'adminAppealKind'}),F('refNumber','رقم الطعن'),F('refYear','السنة','number'),F('court','المحكمة','lookup',{lk:'court'}),F('contestedJudgment','الحكم المطعون فيه')],
 buildingReconciliation:[...PROPERTY_HINT,F('violationType','نوع المخالفة'),F('authority','الجهة المختصة'),F('refNumber','رقم الطلب'),F('refDate','تاريخ الطلب','date'),F('requestStatus','حالة الطلب','lookup',{lk:'requestStatus'}),...RESULT()],
 buildingLicense:[...PROPERTY_HINT,F('licenseType','نوع الترخيص'),F('authority','الجهة'),F('refNumber','رقم الطلب'),F('refDate','تاريخ الطلب','date'),F('requestStatus','الحالة','lookup',{lk:'requestStatus'}),F('decision','القرار')],
 localGeneric:[...PROPERTY_HINT,...REF,F('requestStatus','الحالة','lookup',{lk:'requestStatus'}),...RESULT()],
 tax:[F('taxOffice','المأمورية'),F('taxType','نوع الضريبة','lookup',{lk:'taxType'}),F('taxRegNumber','رقم التسجيل / الملف الضريبي'),F('claimNumber','رقم المطالبة'),F('taxYears','السنوات محل التعامل'),F('authority','الجهة / اللجنة'),F('refDate','التاريخ','date'),...RESULT()],
 insurance:[F('insuranceOffice','مكتب التأمينات'),F('insuranceNumber','الرقم التأميني'),F('employer','جهة العمل'),...REF,...RESULT()],
 realEstate:[...PROPERTY_HINT,F('registryOffice','مكتب / مأمورية الشهر'),F('refNumber','رقم الطلب / الشهر'),F('refYear','السنة','number'),F('refDate','التاريخ','date'),F('subject','الموضوع','textarea'),...RESULT()],
 corporate:[F('companyAction','الإجراء المطلوب'),F('registryNumber','رقم السجل التجاري'),F('authority','الجهة (هيئة الاستثمار / السجل...)'),F('refNumber','رقم الطلب'),F('refDate','التاريخ','date'),F('requestStatus','الحالة','lookup',{lk:'requestStatus'})],
 arbitration:[F('arbitrationType','نوع التحكيم','lookup',{lk:'arbitrationType'}),F('center','مركز التحكيم'),F('tribunal','هيئة التحكيم'),F('arbitrators','المحكمون'),F('refNumber','رقم التحكيم'),F('refDate','تاريخ البدء','date'),F('subject','موضوع النزاع','textarea'),F('award','الحكم التحكيمي'),F('postAward','إجراءات ما بعد الحكم')],
 traffic:[F('plateHint','المركبة (يُفضّل ربطها من تبويب الأصول)'),F('trafficUnit','وحدة / إدارة المرور'),F('refNumber','رقم المخالفة / المحضر'),F('refDate','التاريخ','date'),F('subject','الوصف','textarea'),...RESULT()],
 license:[F('licenseType','نوع الرخصة'),F('authority','الجهة'),F('licenseNumber','رقم الرخصة'),F('refDate','تاريخ الطلب','date'),F('expiryDate','تاريخ الانتهاء','date'),F('requestStatus','الحالة','lookup',{lk:'requestStatus'})],
 execution:[F('bondType','نوع السند','lookup',{lk:'executionBondType'}),F('refNumber','رقم التنفيذ'),F('refYear','السنة','number'),F('authority','جهة التنفيذ / القلم'),F('subject','موضوع التنفيذ','textarea')],
 generic:[...REF,...RESULT()]
};

// ---- التصنيفات وأنواع الملفات ----
// type: [id, name, fieldSet, templateSteps?]  — الخطوة: 'اسم' أو '?اسم' (اختيارية)
const C=(id,name,icon,description,color,types,stages)=>({id,name,icon,description,color,types,stages});
export const DEFAULT_TAXONOMY=[
 C('criminal','القضايا الجنائية','⚖️','محاضر، جنح، جنايات، مخالفات، قرارات النيابة','#B5483B',[
  ['criminal.report','محضر','policeReport',['محضر','?تحقيق نيابة','?تصرف النيابة']],
  ['criminal.misdemeanor','جنحة','criminalCase',['جنحة','حكم','?معارضة','?استئناف','?معارضة استئنافية','?إشكال','?نقض','?التماس إعادة نظر','?تنفيذ']],
  ['criminal.felony','جناية','criminalCase',['جناية','حكم','?إعادة إجراءات','?استئناف','?نقض','?التماس إعادة نظر','?تنفيذ']],
  ['criminal.violation','مخالفة','criminalCase',['مخالفة','حكم / إجراء','?طعن / إجراء تالٍ','?تنفيذ']],
  ['criminal.prosecutionDecision','قرار نيابة','prosecutionDecision',['قرار','?تظلم']]
 ],['محضر','تحقيق نيابة','تصرف النيابة','جنحة','جناية','مخالفة','حكم','معارضة','استئناف','معارضة استئنافية','إعادة إجراءات','إشكال','نقض','التماس إعادة نظر','قرار','تظلم','تنفيذ']),
 C('civil','القضايا المدنية','🏛️','دعاوى، أوامر وقتية، تظلمات، طلبات على عرائض، أوامر أداء','#3C6E9E',[
  ['civil.lawsuit','دعوى','lawsuit',['دعوى','?خبراء','حكم','?استئناف','?إشكال','?نقض','?التماس إعادة نظر','?تنفيذ']],
  ['civil.temporaryOrder','أمر وقتي','requestLike',['طلب','قرار','?تظلم','?تنفيذ']],
  ['civil.grievance','تظلم','grievance',['تظلم','قرار']],
  ['civil.petition','طلب على عريضة','requestLike',['طلب','أمر','?تظلم']],
  ['civil.paymentOrder','أمر أداء','requestLike',['طلب أمر أداء','أمر','?تظلم / استئناف','?تنفيذ']],
  ['civil.other','أخرى','generic',[]]
 ],['طلب','أمر','قرار','دعوى','خبراء','حكم','استئناف','إشكال','نقض','التماس إعادة نظر','تظلم','تنفيذ']),
 C('family','قضايا الأسرة','👨‍👩‍👧','تسويات، دعاوى، حسبى، قرارات النيابة','#8E5BA8',[
  ['family.settlement','تسوية','settlement',['طلب تسوية','نتيجة التسوية']],
  ['family.lawsuit','دعوى','lawsuit',['?تسوية','دعوى','?خبراء','حكم','?استئناف','?تنفيذ']],
  ['family.hisba','حسبى','hisba',['طلب','قرار','?تظلم / طعن']],
  ['family.prosecutionDecision','قرار نيابة','prosecutionDecision',['قرار','?تظلم / طعن','?تنفيذ']],
  ['family.appeal','استئناف','lawsuit',['استئناف','حكم']],
  ['family.execution','تنفيذ','execution',['تنفيذ']]
 ],['تسوية','نتيجة التسوية','دعوى','خبراء','حكم','استئناف','طلب','قرار','تظلم / طعن','تنفيذ']),
 C('stateCouncil','مجلس الدولة','🏢','فض المنازعات، الدعاوى، المفوضين، الطعون','#2F7D6D',[
  ['sc.dispute','فض منازعات','disputeResolution',['طلب فض منازعات','توصية اللجنة']],
  ['sc.lawsuit','دعوى إدارية','adminLawsuit',['?فض منازعات','دعوى','?مفوضين','حكم','?طعن','?تنفيذ']],
  ['sc.disciplinary','دعوى تأديبية','adminLawsuit',['دعوى','?مفوضين','حكم','?طعن']],
  ['sc.appeal','طعن','adminAppeal',['طعن','?دائرة فحص','?مفوضين','حكم']],
  ['sc.execution','تنفيذ','execution',['تنفيذ']],
  ['sc.other','أخرى','generic',[]]
 ],['فض منازعات','طلب فض منازعات','توصية اللجنة','دعوى','مفوضين','محكمة إدارية','محكمة تأديبية','قضاء إداري','دائرة فحص','حكم','طعن','التماس إعادة نظر','تنفيذ']),
 C('economic','القضايا الاقتصادية','💼','دعاوى اقتصادية جنائية وتجارية','#A87B2F',[
  ['eco.lawsuit','دعوى اقتصادية','lawsuit',['دعوى','?تحضير','حكم','?استئناف / طعن','?تنفيذ']],
  ['eco.criminal','جنائي اقتصادي','criminalCase',['قضية','حكم','?استئناف / طعن','?تنفيذ']],
  ['eco.procedure','إجراءات','generic',[]],['eco.other','أخرى','generic',[]]
 ],['دعوى','تحضير','قضية','حكم','استئناف / طعن','تنفيذ']),
 C('local','المحليات','🏘️','تصالحات وتراخيص ومخالفات المباني والقرارات المحلية','#5E8B3A',[
  ['local.reconciliation','تصالح مباني','buildingReconciliation',['تقديم الطلب','معاينة','?سداد','قرار']],
  ['local.buildingLicense','ترخيص بناء','buildingLicense',['تقديم الطلب','?استيفاء','قرار','?تظلم']],
  ['local.violation','مخالفة مباني','localGeneric',[]],['local.removal','قرار إزالة','localGeneric',['قرار','?تظلم','?دعوى']],
  ['local.adminDecision','قرار إداري محلي','localGeneric',[]],['local.occupancy','إشغالات','localGeneric',[]],
  ['local.utilities','مرافق','localGeneric',[]],['local.complaint','طلب / شكوى','localGeneric',[]],['local.other','أخرى','generic',[]]
 ],['تقديم الطلب','معاينة','استيفاء','سداد','قرار','تظلم','دعوى']),
 C('tax','الضرائب','🧾','فحص وربط ومطالبات وطعون ضريبية','#7A6A3A',[
  ['tax.audit','فحص','tax',[]],['tax.assessment','ربط','tax',[]],['tax.claim','مطالبة','tax',[]],['tax.grievance','تظلم','tax',['تظلم','قرار']],
  ['tax.committee','لجنة','tax',['لجنة داخلية','?لجنة طعن']],['tax.appeal','طعن','tax',[]],['tax.lawsuit','دعوى','lawsuit',['دعوى','حكم','?طعن']],
  ['tax.execution','تنفيذ','tax',[]],['tax.requests','طلبات','tax',[]],['tax.other','أخرى','generic',[]]
 ],['فحص','ربط','لجنة داخلية','لجنة طعن','تظلم','قرار','دعوى','حكم','طعن','تنفيذ']),
 C('insurance','التأمينات والمعاشات','🛡️','معاشات واشتراكات وضم مدد ولجان','#3E7C8C',[
  ['ins.pension','معاش','insurance',[]],['ins.insurance','تأمينات','insurance',[]],['ins.contributions','اشتراكات','insurance',[]],
  ['ins.pensionSettlement','تسوية معاش','insurance',[]],['ins.periods','طلب ضم مدد','insurance',[]],['ins.grievance','تظلم','insurance',['تظلم','قرار']],
  ['ins.committee','لجنة','insurance',[]],['ins.lawsuit','دعوى','lawsuit',['دعوى','حكم','?استئناف']],['ins.execution','تنفيذ','insurance',[]],['ins.other','أخرى','generic',[]]
 ],['طلب','لجنة','تظلم','قرار','دعوى','حكم','استئناف','تنفيذ']),
 C('realEstate','السجل والشهر العقاري','📜','تسجيل وشهر وصحة توقيع وتوثيق','#8A5A44',[
  ['re.registration','تسجيل','realEstate',[]],['re.publicity','شهر','realEstate',[]],['re.signature','صحة توقيع','lawsuit',['دعوى','حكم']],
  ['re.validity','صحة ونفاذ','lawsuit',['دعوى','?خبراء','حكم','?استئناف','?شهر الحكم']],['re.requests','طلبات الشهر','realEstate',[]],
  ['re.objections','اعتراضات','realEstate',[]],['re.notarization','توثيق','realEstate',[]],['re.poa','توكيلات','realEstate',[]],['re.docs','مستندات عقارية','realEstate',[]],['re.other','أخرى','generic',[]]
 ],['طلب','بحث','قبول للشهر','دعوى','خبراء','حكم','استئناف','شهر الحكم','توثيق']),
 C('corporate','الشركات','🏭','تأسيس وتعديلات ومحاضر جمعيات وتصفية','#4C5D8A',[
  ['corp.formation','تأسيس شركة','corporate',['تجهيز المستندات','تقديم','سجل تجاري','بطاقة ضريبية','?تأمينات']],
  ['corp.amendment','تعديل عقد / نظام','corporate',[]],['corp.manager','تغيير مدير','corporate',[]],['corp.partners','تغيير شركاء','corporate',[]],
  ['corp.capital','زيادة / تخفيض رأس المال','corporate',[]],['corp.assembly','محاضر جمعيات','corporate',[]],['corp.registry','سجلات','corporate',[]],
  ['corp.tax','ضرائب','tax',[]],['corp.insurance','تأمينات','insurance',[]],['corp.license','تراخيص','license',[]],
  ['corp.liquidation','تصفية','corporate',[]],['corp.merger','اندماج','corporate',[]],['corp.other','إجراءات أخرى','generic',[]]
 ],['تجهيز المستندات','تقديم','مراجعة','سجل تجاري','بطاقة ضريبية','تأمينات','اعتماد']),
 C('arbitration','التحكيم','🤝','التحكيم المؤسسي والحر','#6B4E8C',[
  ['arb.case','تحكيم','arbitration',['طلب التحكيم','تشكيل الهيئة','المرافعات','الحكم التحكيمي','?دعوى بطلان','?تنفيذ']]
 ],['طلب التحكيم','تشكيل الهيئة','المرافعات','الحكم التحكيمي','دعوى بطلان','تنفيذ']),
 C('traffic','المرور','🚗','مخالفات وحوادث وتراخيص المركبات','#4D7FA3',[
  ['tr.violation','مخالفة مرورية','traffic',['مخالفة','?تظلم','?سداد / تصالح']],['tr.accident','حادث','traffic',['محضر','?قضية']],
  ['tr.license','ترخيص','traffic',[]],['tr.suspension','سحب رخصة','traffic',[]],['tr.impound','حجز مركبة','traffic',[]],
  ['tr.grievance','تظلم','grievance',[]],['tr.report','محضر','policeReport',[]],['tr.lawsuit','دعوى','lawsuit',[]],['tr.other','إجراءات أخرى','generic',[]]
 ],['مخالفة','محضر','تظلم','سداد / تصالح','قضية','حكم']),
 C('licenses','الرخص','📋','رخص المحال والمزاولة والنشاط','#7C8A3E',[
  ['lic.shop','رخصة محل','license',[]],['lic.practice','رخصة مزاولة','license',[]],['lic.professional','رخصة مهنية','license',[]],
  ['lic.activity','رخصة نشاط','license',[]],['lic.facility','رخصة منشأة','license',[]],['lic.renewal','تجديد','license',[]],
  ['lic.cancel','إلغاء','license',[]],['lic.grievance','تظلم','grievance',[]],['lic.lawsuit','دعوى','lawsuit',[]],['lic.other','أخرى','generic',[]]
 ],['تقديم الطلب','معاينة','استيفاء','إصدار','تظلم','دعوى']),
 C('other','أخرى','📁','أعمال غير مصنفة — يمكن إنشاء تصنيف جديد من الإعدادات','#6B6B6B',[
  ['other.consultation','استشارة','generic',[]],['other.contract','صياغة عقد','generic',[]],['other.general','عمل آخر','generic',[]]
 ],['طلب','متابعة','إنجاز'])
];

// ---- علاقات الملفات: كود ثابت + اسم + العلاقة العكسية (للعرض من الطرف الآخر) ----
export const RELATION_TYPES={
 ORIGINATED_FROM:{label:'نشأ عن',inverse:'نشأ عنه'},
 APPEAL_OF:{label:'استئناف لـ',inverse:'مستأنف في'},
 CHALLENGE_OF:{label:'طعن على',inverse:'مطعون عليه في'},
 EXECUTION_OF:{label:'تنفيذ لـ',inverse:'يُنفَّذ في'},
 GRIEVANCE_OF:{label:'تظلم من',inverse:'متظلم منه في'},
 REFERRED_FROM:{label:'إحالة من',inverse:'أحيل إلى'},
 RESULT_OF:{label:'ناتج عن',inverse:'نتج عنه'},
 CHILD_OF:{label:'فرع من',inverse:'أصل لـ'},
 CONNECTED_TO:{label:'متصل بـ',inverse:'متصل بـ'},
 RELATED_TO:{label:'مرتبط بـ',inverse:'مرتبط بـ'}
};
// اقتراحات «إنشاء ملف مرتبط» — تظهر كأزرار اختيارية فقط ولا تمنع أي شيء
export const RELATED_SUGGESTIONS=[
 {when:{fileType:'criminal.report',result:'إحالة'},label:'إنشاء ملف جنحة / جناية مرتبط',targetCategory:'criminal',targetTypes:['criminal.misdemeanor','criminal.felony'],relation:'ORIGINATED_FROM'},
 {when:{fileType:'family.settlement',result:'إحالة للمحكمة'},label:'إنشاء دعوى أسرة مرتبطة',targetCategory:'family',targetTypes:['family.lawsuit'],relation:'ORIGINATED_FROM'},
 {when:{fileType:'sc.dispute'},label:'إنشاء دعوى إدارية مرتبطة',targetCategory:'stateCouncil',targetTypes:['sc.lawsuit'],relation:'ORIGINATED_FROM'},
 {when:{fileType:'local.buildingLicense'},label:'إنشاء دعوى مرتبطة',targetCategory:'stateCouncil',targetTypes:['sc.lawsuit'],relation:'ORIGINATED_FROM'}
];
export const GENERIC_RELATED=[
 {label:'ملف استئناف / طعن',relation:'APPEAL_OF'},{label:'ملف تنفيذ',relation:'EXECUTION_OF'},{label:'ملف تظلم',relation:'GRIEVANCE_OF'},{label:'ملف ناشئ عنه',relation:'ORIGINATED_FROM'},{label:'ملف مرتبط',relation:'RELATED_TO'}
];

// قوائم إضافية تُزرع في lookups (قابلة للتعديل، وخيار «أخرى» مسموح دائمًا بالكتابة الحرة)
export const EXTRA_LOOKUPS={
 genericResult:{label:'النتائج العامة',values:['قيد النظر','مقبول','مرفوض','جزئي','حفظ','أخرى']},
 reportOutcome:{label:'نتائج المحاضر',values:['حفظ','ألا وجه لإقامة الدعوى','إحالة','تصرف آخر']},
 reportKind:{label:'أنواع المحاضر',values:['إداري','جنح','بلاغ','إثبات حالة','أخرى']},
 criminalOrigin:{label:'بداية الملف الجنائي',values:['محضر محال','جنحة مباشرة','بلاغ للنيابة','أخرى']},
 decisionResult:{label:'نتائج القرارات',values:['لصالح الموكل','ضد الموكل','جزئي','حفظ','أخرى']},
 settlementResult:{label:'نتائج التسوية',values:['حفظ','صلح','إحالة للمحكمة','أخرى']},
 hisbaKind:{label:'طلبات الحسبى',values:['تعيين وصي','عزل وصي','تعيين مراقب','طلبات الولاية على المال','قرارات','أخرى']},
 adminCourtKind:{label:'محاكم مجلس الدولة',values:['محكمة إدارية','محكمة تأديبية','محكمة القضاء الإداري','أخرى']},
 adminAppealKind:{label:'أنواع الطعن الإداري',values:['طعن','استئناف','التماس إعادة نظر','أخرى']},
 requestStatus:{label:'حالات الطلبات',values:['جديد','مقدم','قيد الفحص','مطلوب استيفاء','مقبول','مرفوض','منتهٍ']},
 taxType:{label:'أنواع الضرائب',values:['دخل','قيمة مضافة','عقارية','دمغة','خصم وإضافة','أخرى']},
 arbitrationType:{label:'أنواع التحكيم',values:['مؤسسي','حر','دولي','أخرى']},
 stageOutcome:{label:'نتائج المراحل',values:['لصالح الموكل','ضد الموكل','جزئي','حفظ','إحالة','صلح','شطب','أخرى']},
 clientFileStatus:{label:'حالات ملف الموكل',values:['نشط','تحت المتابعة','متوقف','مغلق','مؤرشف']}
};
export const LIFECYCLE={planned:'مخططة',active:'جارية',done:'منتهية',skipped:'متخطاة'};
