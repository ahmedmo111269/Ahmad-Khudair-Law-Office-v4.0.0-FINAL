# قسم التنفيذ — العقد التنفيذي والقرارات · v5.8.0 / Schema 15

**2026-10-01.** قسم التنفيذ **إضافة فوق النظام القائم** (موكلون، ملفات، علاقات، أحكام، سجل النشاط، الجداول، البحث، التخصيص، الطباعة، المخزّن) — بلا تطبيق موازٍ ولا بيانات وهمية. كل رقم معروض في الواجهة محسوب من سجل، وكل كتابة تمر عبر خدمة تطبيقية.

المصادر: `CHANGELOG.md` (v5.8.0) · `PROJECT_MAP.md` (v5.8.0) · `TEST-REPORT.md` (v5.8.0).

---

## 1) الطبقات والملفات

`js/modules/execution-center.js` (الصفحة والبطاقة) ← `js/ui/execution-forms.js` (النوافذ) ← `js/services/execution*.js` (أوامر وقراءات) ← `js/domain/execution.js` + `js/domain/entitlement-engine.js` (منطق نقي) ← Repository ← IndexedDB.

| الملف | الدور |
|---|---|
| `js/domain/execution.js` | الأنواع والقوائم المرجعية (نوع التنفيذ، الدورية، نوع القيمة، أنواع الدفتر، الحالات، طرق التخصيص، حالات الفروق، أنواع التوكيل، أنواع الإجراءات، سياسات التناسب)، أدوات الأرقام والعملة، حساب التواريخ ومعادلات الفترات، `validateValueSlice/validateLedgerEntry/validateExecution/validateAllocationLines`، `EXECUTION_LIMITS` |
| `js/domain/entitlement-engine.js` | نقي بالكامل: `eligibleSlices`, `buildEntitlementPeriods`, `periodsForEntitlement`, `balanceAsOf`, `balanceSummary`, `outstandingPeriods`, `allocationPlan`, `analyticalAllocation`, `balanceTrace`, `analyzeSliceImpact`, `compareJudgments` (حساب الأثر), `simulateValueChange`, `executionAlerts` |
| `js/services/execution.js` | التنفيذات والأطراف والأحكام وشرائح القيمة والإجراءات، `executionBundle` (حزمة قراءة واحدة للبطاقة)، `summarizeExecution`, `executionListRow/hydrateExecutionRows/listExecutionRows`, `executionCenterStats`, `refreshExecutionSearchText`, `createResultFile` |
| `js/services/execution-ledger.js` | الدفتر Append-Only: `addLedgerEntry`, `recordExpense`, `reverseLedgerEntry`, `adjustLedgerEntry`, `recordCollection/recordDirectCollection`, `reallocateReceipt`, `updateReceiptDetails`, `ledgerBreakdown`, `allocationContext`, `allocationsFor` |
| `js/services/execution-differences.js` | `previewImpact`, `createSettlement`, `settlementReview`, `decideSettlement`, `postSettlement`, `recomputeSettlement`, `differencesSummary` |
| `js/services/execution-poa.js` | `buildPoaDraft`, `saveExecutionPoa`, `reissuePoaDraft`, `poaDetail` + ترقيم `POA-YYYY-NNNN` عبر عدّاد الملفات |
| `js/services/execution-balance.js` | `executionBalance` (رصيد + شجرة تتبع)، `balanceSnapshot`، `compareJudgments`، `simulateValueChange`، `executionTimeline`، `executionAlertsFor`، `executionsForKpi` |
| `js/services/execution-print.js` | قوالب نصية بمتغيّرات (`executionTemplates`) + `buildPoaDocument` و`buildBalanceDocument` و`printPoa/printBalanceStatement` على مسار الطباعة القائم (فتح نافذة أثناء النقر ثم كتابة المستند) |
| `js/services/execution-migration.js` | `migrateExecutionData`، `executionReviewReport`، `reviewReasonLabels` |
| `js/modules/execution-center.js` | `executionCenterPage/bindExecutionCenter` و`executionDetailPage/bindExecutionDetail` و`EXECUTION_LIST_COLUMNS` |
| `js/ui/execution-forms.js` | نوافذ: تنفيذ، طرف، حكم، شريحة قيمة، تحصيل، مصروف، عكس/تصحيح، إعادة تخصيص، مراجعة تسوية، توكيل/إعادة توكيل، إجراء، لقطة، محاكي، مقارنة، كشف رصيد |
| `css/execution.css` | أنماط `.exec-*` بالمتغيرات القائمة |
| `js/tests/execution-tests.js` | 61 اختبارًا نقيًا/تكامليًا (Node و`tests.html`) |
| `tools/node-tests/execution-browser-tests.mjs` | فحص سلوكي في Chromium حقيقي (32 فحصًا) |

---

## 2) المخازن (v15 — إضافة فقط)

50 مخزنًا و267 فهرسًا بعد الترقية. الجديد: `executionParties`, `executionValuePeriods`, `executionLedger`, `executionAllocations`, `executionReceipts`, `executionActions`, `executionPOAs`, `differenceRecords`, `executionSettlements`, `executionAdjustments`, `executionTemplates` — إضافة إلى الحقول الجديدة على `execution` (السجل العام) و`judgments` (سلسلة الأحكام: `sequence`, `executionId`, `judgmentKind`, `previousJudgmentId`, `effectiveFrom`).

- بدون `getAll` على المخازن الكبيرة: كل القراءات عبر مؤشرات و`page()` (cursor) والسقوف (`EXECUTION_LIMITS = {periods:1200, childRows:2000, centerSample:300, timeline:200, migrationBatch:200}`).
- **لا صفوف فترات مخزّنة**: الفترات تُبنى عند الطلب من الشرائح، والتحقق من ذلك اختبار صريح (قاعدة فيها 12 فترة محسوبة = صفر صفوف فترات).
- الترحيل `migrationPlan()` v15: `destructive:false`, `backfill:false`؛ لا اختراع تواريخ — السجلات الناقصة تُعلَّم `needsReview` مع سبب (`missing_execution_type/authority/official_number/judgment/value/legacy_record`)، بعلامة `execution-migration-v1` وسقف 20,000 صفًا لكل تشغيل (idempotent).

---

## 3) المحرّكات والقواعد المالية

1. **شريحة القيمة**: قيمة تُثبَّت في شريحة لها `startDate` (و`endDate` اختياري) ومرتبطة بحكم. **لا تُعدَّل شريحة تاريخية**: التغيير شريحة جديدة بترتيب `sequence` حتمي (المتسلسل ← وقت التسجيل ← المعرّف)، ونهاية الشريحة السابقة تُشتق من بداية التالية بلا مساس بها.
2. **الفترات**: `buildEntitlementPeriods` تُنتج مفتاحًا حتميًا `نوع الاستحقاق::YYYY-MM-DD` وتناسبًا بالأيام (`prorationPolicy` قابل للاختيار على التنفيذ). لا تُمدَّد الفترات بعد `entitlementThroughDate`.
3. **عدم ازدواج الحساب**: الحكم اللاحق لا يُجمع على القديم — الفترة الواحدة لها قيمة أصلية وقيمة نهائية واحدة. 3000 ← 4000 (من 2025-07) = استحقاق نهائي 42,000، الاستحقاق الأصلي 36,000، الفرق 6,000، و1000 لكل فترة متأثرة. الفروق تُسجَّل في `differenceRecords` بحالات `DRAFT → PENDING_REVIEW → APPROVED → POSTED` أو `CANCELLED`، و**لا حركة مالية قبل قرار المستخدم** (الاعتماد ثم الترحيل).
4. **الدفتر Append-Only**: `COLLECTION, DIFFERENCE_DUE, EXECUTION_FEE, STAMP, COLLECTION_FEE, OTHER_EXPENSE, ADJUSTMENT, REVERSAL`. لا `UPDATE`/`DELETE` لحركة: `addLedgerEntry` ترفض معرّفًا صريحًا وترفض تسجيل `DIFFERENCE_DUE` يدويًا؛ العكس والتصحيح صفوف جديدة مرتبطة بالأصل ولا تتجاوزه. تُثبَّت الرسوم والدمغة والمصروفات **منفصلة** عن أصل الاستحقاق، و«هل تدخل مجموع التوكيل» قرار المستخدم (`includeInPoa`).
5. **التخصيص**: طرق `DIRECT/MANUAL/FIFO/PROPORTIONAL/BY_PARTY` — **FIFO ليست افتراضيًا قانونيًا** ولا تُفرض؛ التخصيص الافتراضي «مباشر حسب المستند»، وعند التوزيع التلقائي يُسجَّل تحذير `direct_default_order` صريحًا. حراسة كاملة: لا تخصيص لفترة غير موجودة (`ERR.VALIDATION` قبل أي كتابة)، لا تجاوز المتبقي، لا ازدواج حجز، وإعادة التخصيص تُبطل السابق (`isActive:false`) وتكتب الجديد.
6. **محضر التحصيل**: `RC-YYYY-NNNN` يعرض الإجمالي ← التوزيع على الفترات ← الرصيد الناتج، وتُخزَّن فيه البيانات الوصفية فقط (من عدّل بيانات المحضر لا يعيد كتابة التوزيع).
7. **التوكيل**: يبدأ من الفترات الجديدة + رصيد سابق + فروق معتمدة + مصروفات مُعلَّمة + دمغة/مبلغ يدوي، وكل مبلغ يحمل مصدره (`sourceType/sourceIds/detail`). إعادة التوكيل تربط `previousPoaId` وتُظهر الرصيد السابق (إجمالي التوكيل السابق) والرصيد المشتق قبل الفترة **جنبًا إلى جنب** (27,000 + 30,000 = 57,000، بلا دمج خفي). الإدراج في توكيل يُعلّم المكوّن بمعرّف التوكيل فلا يُدرج مرتين.
8. **الرصيد**: `الاستحقاق النهائي = Σ القيم النهائية`، `الرصيد = الاستحقاق النهائي − المحصل`، ويُفكَّك إلى `رصيد أصلي + فروق أحكام`، مع `unallocated` محسوب تحليليًا على الأقدم بوسم «يحتاج تخصيصًا صريحًا». كل الأرقام مشتقة؛ **لا حقل رصيد قابل للتحرير** في أي نموذج.
9. **اللقطة التاريخية** (`balanceSnapshot`) تُعاد من البيانات التي تاريخها حتى اليوم المطلوب (`mode:'effective'`)، وتُعلن الشرائح المسجّلة لاحقًا بتاريخ سريان أسبق في `recordedLaterSlices`. وضع المعرفة (`mode:'knowledge'`) متاح للمقارنة ويعتمد `T23:59:59.999Z` لكل تاريخ.
10. **المحاكي**: `simulateValueChange` يحسب ويعيد صفوف الفرق بلا أي كتابة (اختبار: قاعدة البيانات لا تتغير).
11. **التنبيهات تنظيمية فقط**: صياغتها «يحتاج انتباهي / راجع / لم يُسجَّل بعد» — لا وصف مخالفة ولا تأكيد استحقاق قانوني.

---

## 4) الواجهة والمسارات

- `executionCenter` — مركز التنفيذ: مؤشرات قابلة للنقر (12 مؤشرًا)، «يحتاج انتباهي»، بحث وتصفية (نوع/حالة/نص يشمل الأرقام المشتقة)، جدول عام بـ16 عمودًا (رقم التنفيذ، الموكل، رقم الملف، النوع، الحكم/السلسلة، القيمة الحالية، آخر فترة، المحصل، المتبقي، فرق الحكم، آخر توكيل، آخر محضر، الحالة، الجهة، تاريخ الفتح، آخر إجراء) **بلا دمج رقم الملف والموكل والخصم في خلية**، وقسم «تسويات وفروق تنتظر قرارًا».
- `exc:<id>` — بطاقة التنفيذ: بيانات التنفيذ، الرصيد المفكَّك معادلاته، التنبيهات، 13 إجراءً سريعًا، سلسلة الأحكام، شرائح القيمة و«تطور قيمة الاستحقاق» (مطوي)، الفترات، التحصيل والمحاضر، الدفتر، الفروق والتسويات، التوكيلات، إجراءات التنفيذ، شجرة تتبع الرصيد، والخط الزمني **من سجل النشاط القائم**.
- الأقسام الكبيرة مسجّلة في نظام تخطيط الصفحات وتُفتح مطوية افتراضيًا (`data-collapse-default="collapsed"` لغير الرصيد والتنبيهات الأساسية)، وتخضع لنظام الطي/التخصيص نفسه.
- جدول المركز **مزوّد بيانات (provider)** على مخزن التنفيذ: `page({index:'openedDate'})` بترقيم cursor، ثم هيدرة صف الصفحة فقط (12 ملخصًا محسوبًا)، والتصفية الأساسية تُقيَّم أثناء مسح المؤشر والمؤشر/البحث النصي بعد الهيدرة — فلا حساب لكل المخزن.
- الطباعة من مسار الطباعة القائم: كشف الرصيد + توكيل التنفيذ (قوالب `executionTemplates` قابلة للتعديل من الإعدادات) مع معاينة قبل الطباعة.
- البحث الشامل: مصادر جديدة (التنفيذات، الشرائح، المحاضر، الدفتر، التوكيلات، الفروق) ومسار `exc:<id>`، و`refreshExecutionSearchText` يخزّن نصًا مطبَّعًا فقط لتغطية اسم الموكل ورقم الملف وأرقام الحكم/الاستئناف/القضائي/العرائض/التوكيل/المحضر.

---

## 5) القرارات المعمارية (ملزمة لأي تطوير لاحق)

- لا تعديل صامت لحركة تاريخية؛ لا حقل رصيد كمصدر للحقيقة؛ لا حساب بلا معادلة معروضة ومصدر ومحرّك.
- تاريخ الحكم ≠ تاريخ سريان القيمة: لا استنتاج تلقائي لأي تاريخ.
- ممارسة المكتب ليست قاعدة قانونية: التوكيل والإجراءات والتناسب كلها اختيارات مسجّلة للمستخدم.
- أصل الاستحقاق لا يختلط بالرسوم/الدمغة/المصروفات.
- التنفيذ الجزائي الناتج عن التبديد = **ملف قانوني مستقل** بعلاقة (`createResultFile`) بلا تغيير ترقيم الملف الأصلي.
- الحدود المعروفة: سقف 1200 فترة لكل استحقاق في الحساب الواحد (يُعلن `truncated`)، ومؤشرات المركز على عيّنة معلنة (الأحدث، 300)، وبعض أعمدة «آخر توكيل/آخر محضر/آخر إجراء» تظهر «—» قبل وجود سجلات.
- **NOT VERIFIED — Print Preview/Physical Print Not Tested**: فُتح مستند الطباعة وفحص محتواه نصيًا في Chromium، ولم تُختبر معاينة النظام ولا طباعة ورقية.
