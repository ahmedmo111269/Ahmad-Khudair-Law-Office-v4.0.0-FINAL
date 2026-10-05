# Execution Audit & Design Delta — مركز التنفيذ / FEAS · 2026-10-05

هذا تدقيق فعلي للكود الحالي (commit الأساس `aa77c2f`، `SCHEMA_VERSION=18`) قبل أي تعديل، ثم سجل التعديلات الضيقة التي نتجت عنه. **لا مخزن جديد، ولا ترقية مخطط، ولا تحويل لأي سجل.**
أداة إدارة وحساب لمدخلات المكتب، وليست رأيًا قانونيًا.

## A. الموجود بالفعل (أُعيد استخدامه كما هو)

| المطلوب | الموجود فعلًا |
|---|---|
| تقويم مدني Pure | `js/domain/execution-period-calendar.js` (بلا DOM/IDB/Date-timezone؛ anchor + k، قصّ بلا انجراف) |
| Money بالوحدات الصغرى | `js/domain/execution-money.js` (يرفض التقريب الصامت والعملة المجهولة) |
| Period/Value resolver | `resolveExecutionClaim` في `js/domain/execution-feas.js` — الفترة الكاملة = قيمة الوحدة، والجزئية تُعرض كقرار (`decisions`) ولا تُحتسب |
| Balance Engine مركزي | `calculateFeasBalance` (FEAS) عبر `services/execution-balance.js`؛ البطاقة والكشف والتوكيل والملخص تستدعيه |
| Difference Engine | `analyzeFeasValueChange`: `new − (recognized + approvedDelta)` — لا يعيد فرقًا سبق اعتماده |
| Settlement lifecycle (FEAS) | `PENDING_REVIEW → REVIEWED(expectedBase) → APPROVED → POSTED`، ورفض الاعتماد عند تغيّر البصمة |
| Allocation | `planFeasAllocation` (DIRECT/MANUAL/FIFO/LIFO/PROPORTIONAL/BY_PARTY) بحدود الإيصال والفترة |
| POA Snapshot | `services/execution-poa.js` — لقطة idempotent لا تكتب حركة ولا دينًا |
| Idempotency | فهارس فريدة `executionLedger.idempotencyKey` و`executionReceipts.idempotencyKey` و`executionPeriods(executionId,obligationId,periodKey)` |
| Integrity | `executionIntegrityReport` (تداخل، مفاتيح مكررة، تخصيص زائد، مصادر مفقودة، فرق مكرر، توكيل غير متسق) — الأخطاء تحجب الرصيد بدل عرض رقم جزئي |
| Stores | `executionObligations`, `executionPeriods`, `executionValuePeriods`, `executionReceipts`, `executionAllocations`, `executionLedger`, `executionPOAs`, `executionActions`, `executionSettlements`, `differenceRecords`, `judgments` — كلها في `STORE`/المخطط، وبالتالي في Backup/Restore وSync تلقائيًا |
| التكامل | Universal DataGrid، Global Search، Work Center، Activity Log، PrintContext، Offline (Service Worker) — مستخدمة من مركز التنفيذ الحالي |

## B. الموجود جزئيًا
- **Cache:** ذاكرة حساب داخل الجلسة (`services/execution-cache.js`) تُبطل عند أي تغيير؛ لا يوجد `executionSummaryCache` دائم. القرار السابق (موثق في `FEAS-AUDIT-DESIGN-DELTA.md`) هو عدم حفظ رصيد دائم منافس للمصدر؛ أُبقي عليه.
- **executionRules:** القواعد مخزنة كإعدادات مؤرخة بنسخة (`services/execution-settings.js`, `ruleVersion`) لا كمخزن مستقل — يؤدي الوظيفة.
- **POA قديم:** لم يكن هناك أي كشف لتوكيل صدر قبل تحصيل/فرق/اعتراف لاحق. ← **أُضيف (انظر F).**
- **التحصيل غير المخصص:** ظاهر في الرصيد (`unallocatedMinor`) لكنه لم يكن بندًا في مركز السلامة. ← **أُضيف.**

## C. المكسور / D. المتعارض
1. **مسار التسوية القديم (legacy-v1):** `decideSettlement` كان يسمح بالانتقال `PENDING_REVIEW → APPROVED` بلا مرحلة مراجعة وبلا `expectedBase`، خلافًا للقاعدة §32/§33. (مسار FEAS كان سليمًا.) ← **أُصلح.**
2. **فرق بلا حكم مصدر:** لم يكن مفحوصًا في Integrity. ← **أُضيف فحص.**
3. البحث الساكن عن `prorate|daysInMonth|/30|/31|daysPassed|CALENDAR_MONTH`: لا يوجد أي تناسب أيام في محرك الاستحقاق. الموجود: `daysInMonth` كدالة تقويم مساعدة، و`customDays = 30` كقيمة افتراضية لدورية «مخصصة» يختارها المستخدم، و`CALENDAR_MONTH` كخيار مكتب صريح (لا افتراضي؛ الافتراضي `ANNIVERSARY`)، و`RETIRED_SCHEDULE_KEYS` تُسقط إعدادات تناسب قديمة. **صفر استخدام غير مقصود.**
4. **ازدواج الفرق:** فُحص فعليًا — FEAS: `Effective = Σrecognized + ΣapprovedDelta`، والفرق المكرر لنفس (settlement, period) يوقف الحساب. legacy: `DIFFERENCE_DUE` تُعرض في `differencesPostedInLedger` فقط ولا تدخل `finalEntitlement`. لا يوجد مسار يجمع Value Period النهائية + Difference.

## E/F. ما أُعيد استخدامه وما عُدّل
- `js/services/execution-differences.js`: فتح المراجعة (`settlementReview`) للتسوية القديمة يثبّت `reviewedAt` + `expectedBase` (بصمة الفروق + المحصل الحالي لكل فترة) ويسجل في Activity Log؛ الاعتماد يرفض إن لم تُراجع أو تغيّر الأساس (`CONFLICT` = REJECT_RECALCULATE). الرفض يظل ممكنًا دون مراجعة (لا أثر مالي).
- `js/services/execution-feas.js` (`executionIntegrityReport`): فحوص قراءة فقط جديدة: `difference-without-judgment` (error)، `receipt-unallocated` (warn)، `poa-stale` (warn — لا يعدل اللقطة؛ يقترح توكيلًا جديدًا، ويختفي إن وُجد توكيل `supersedes`).

## G. Migration
لا حاجة لـ Migration جديدة: لا مخزن ولا حقل إلزامي جديد. الحقول `reviewedAt/expectedBase` اختيارية؛ التسويات القديمة المعتمدة تاريخيًا لا تُمسّ ولا تُعلَّم خطأً.

## H. Store جديد فعلًا
لا شيء. كل كيان في المواصفة له Store قائم (انظر A).

## I. المخاطر على البيانات الحالية
- تسوية legacy في حالة `PENDING_REVIEW` الآن تتطلب فتح المراجعة قبل الاعتماد — واجهة `execution-forms.js` تفعل ذلك أصلًا (تفتح المراجعة ثم الاعتماد)، فلا تغيير في سلوك المستخدم.
- تحذير `poa-stale` قد يظهر لتوكيلات FEAS تاريخية صدرت قبل تحصيلات لاحقة — مقصود ومعلن، وليس خطأً حاجبًا.

## Source of Truth
`Receipt→executionReceipts` · `Allocation→executionAllocations` · `Judgment→judgments` · `Obligation→executionObligations` · `Value Schedule→executionValuePeriods` · `Recognized Period→executionPeriods` · `Settlement→executionSettlements` · `Difference→differenceRecords` · `POA Snapshot→executionPOAs` · `Balance→derived (calculateFeasBalance)` · `Cache→in-memory execution-cache (غير مصدر)` · `Activity→activityLog` · `Work→workItems`.

## نتائج التحقق الفعلية (2026-10-05، Node v22.22.3، Xeon 2.6GHz ×2)

| الفحص | النتيجة |
|---|---|
| `node tools/node-tests/feas-golden-tests.mjs` (جديد، محرك نقي) | **16/16 PASS** — النتيجة محفوظة في `docs/feas-golden-results.json` |
| §35 المثال الذهبي | **PASS**: 47,000 قبل الحكم B ← أثر معلق 14,000 (الرصيد المعتمد يبقى 47,000، المتوقع 61,000) ← بعد الاعتماد 71,000 مستحق فعّال / 61,000 رصيد؛ إعادة التحليل بعد الاعتماد = 0 فرق؛ تكرار الفرق يوقف الحساب (لا 75,000) |
| G1–G12 (محرك نقي) | **PASS** (G1, G2, G3, G4, G5, G6, G7, G8, G9, G10, G11, G12) |
| Property: 5,000 حالة تتابع فترات + 200 حالة قيمة وحدة؛ 2,000×2 حالة تخصيص | **PASS** |
| `cd tools/node-tests && node run-tests.mjs` | **472/472 PASS** (470 أساس + 2 جديدان: حارس المراجعة/التزامن، وتوكيل قديم) |
| Chromium: execution-browser / feas-cycle / feas / simple | **34/34 · 19/19 · 10/10 · 20/20 PASS** |
| Chromium: offline-sync-browser (Offline + Backup/Restore + Sync موافقة) | **PASS** |
| Benchmark محرك نقي: 5,000 تنفيذ × 300 سجل = 1.5M سجل | كل الأرصدة 2,216.6ms؛ متوسط 0.443ms/تنفيذ؛ أسوأ تنفيذ 12.96ms؛ checksum مطابق. **حساب فقط — بلا IndexedDB** |

### NOT VERIFIED
- أداء IndexedDB حقيقي على 1M سجل (القياس أعلاه حساب نقي فقط).
- G13–G16 كسيناريوهات FEAS مستقلة: مغطاة جزئيًا بمجموعات Backup/Restore وOffline وSync العامة (PASS أعلاه) وidempotency التحصيل/التوكيل في `run-tests.mjs`، لكن لا يوجد اختبار «Backup→Restore→Recalculate→Compare» مخصص لمثال §35 ولا Conflict مالي FEAS مخصص.
- Migration لمفاتيح الفترات القديمة (`legacyPeriodRef → anchor+k` بدرجة ثقة): الموجود هو `execution-period-migration.js` (v2، غير مدمر)؛ لم يُضف نموذج confidence/NEEDS_REVIEW جديد.
- `executionSummaryCache` دائم + مقارنة CACHE_MISMATCH: غير منفذ عمدًا (لا رصيد مخزن).
- Work Item تلقائي لـ«توكيل قديم»/«تحصيل غير مخصص»: التحذير يظهر في مركز السلامة؛ إنشاء Work Item آلي لم يُضف.
- معاينة الطباعة الأصلية والطابعة، متصفحات غير Chromium، أجهزة فعلية.
