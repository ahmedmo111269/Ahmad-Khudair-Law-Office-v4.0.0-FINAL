# v4.0.1 — Bug-fix release

لا يوجد تغيير في بنية قاعدة البيانات (`SCHEMA_VERSION` ما زال 10)، والبيانات الحالية تعمل كما هي.

### 4.3.0 — ملف الموكل والتصنيف المرن للأعمال (Schema v12)

- **ملف موكل واحد لكل موكل** بكود فريد `CL-YYYY-NNNNNN` (مسار `cfile:<clientId>`): بطاقة تعريف، إحصاءات (إجمالي/نشطة/منتهية/متوقفة)، بطاقات الأقسام، آخر الملفات، ملفات تحتاج متابعة (+45 يومًا بلا نشاط)، آخر الجلسات والأعمال الإدارية، بحث داخل ملف الموكل، وتنقل قسم ← نوع (بطاقات على الهاتف وجدول على الكمبيوتر).
- **14 قسمًا بأنواع أعمالها** (جنائي، مدني، أسرة، مجلس الدولة، اقتصادي، محليات، ضرائب، تأمينات، شهر عقاري، شركات، تحكيم، مرور، تراخيص، أخرى) — بيانات في مخزن `taxonomy` وليست كودًا، وقابلة للتعديل من الإعدادات ← «الأقسام وأنواع الأعمال» (أقسام، أنواع، مسارات مقترحة، حقول خاصة).
- **رقم ملف قانوني فريد** `LF-YYYY-NNNNNN` لكل ملف جديد (الملفات القديمة تحتفظ بأرقامها).
- **معالج إضافة ملف بثلاث خطوات**: القسم ← النوع ← بيانات أساسية، مع خيار «المسار المقترح» أو «البدء يدويًا» وتعديل المراحل (إضافة/حذف/ترتيب/تعطيل) قبل الإنشاء.
- **شريط مراحل مرن** داخل الملف: مراحل مخططة/جارية/منتهية/متخطاة، مرحلة حالية `currentStageId` منفصلة عن حالة الملف، إضافة مرحلة غير متوقعة في أي موضع، نتيجة لكل مرحلة، تقديم/تأخير، حذف المراحل المخططة الفارغة فقط.
- **ملفات مرتبطة بعلاقات مكتوبة** (نشأ عن، استئناف لـ، تنفيذ لـ، تظلم من، …) مع اقتراحات ذكية حسب النوع والنتيجة (مثل: محضر نتيجته «إحالة» ← إنشاء جنحة/جناية)، ونقل روابط الأطراف دون نسخ بياناتهم.
- **العقارات والمركبات والشركات** كأصول مستقلة قابلة للربط بعدة ملفات (`assets` + `fileAssets`).
- تبويب «بيانات نوع العمل» بحقول ديناميكية حسب النوع (`x_*`) ومفهرسة في البحث؛ إعادة تصنيف الملف دون فقد أي بيانات.
- البحث العام يدعم كود الموكل `CL-…` (يعرض الموكل وكل ملفاته) ورقم `LF-…`.
- **ترحيل غير مدمر**: عند فتح القاعدة يُنشأ ملف موكل لكل موكل، وتُصنَّف الملفات القديمة تلقائيًا من نوعها النصي (مع الاحتفاظ بالقيمة الأصلية في `typeSnapshot` وعلامة «راجع التصنيف» عند عدم التأكد). لا يُحذف أو يُعدل أي حقل قائم.
- 10 اختبارات جديدة في `tests.html` (`js/tests/client-file-tests.js`).

### 4.2.0 — نظام الثيمات الفاخر وتوحيد التاريخ

- **Design Tokens** مركزية في `css/themes.css` (ألوان، خطوط، مسافات، ظلال، استدارة، كثافة)، وكل ألوان CSS القديمة صارت متغيرات.
- **4 ثيمات**: Luxury Dark Gold (الافتراضي)، Elegant Light، Midnight Blue، Warm Charcoal، وكلها تحقق WCAG AA في تباين النص (عليها اختبار).
- **استوديو المظهر** (الإعدادات ← المظهر والثيمات): الألوان، الخط العربي والإنجليزي وخط العناوين، الحجم والسماكة، الاستدارة، الكثافة، الظلال والتوهج، اتباع وضع الجهاز، ثيمات مخصصة باسم، تصدير واستيراد JSON، وإعادة ضبط. التطبيق فوري بدون إعادة تحميل.
- قائمة ثيمات سريعة في الهيدر، وأيقونات خطية للقائمة الجانبية.
- **التفضيلات** في IndexedDB مستقلة (`akl-preferences`) ومربوطة بالمستخدم، مع مرآة في localStorage لمنع وميض الألوان عند الإقلاع.
- **التاريخ يوم/شهر/سنة** في كل البرنامج عبر `js/core/format.js`، وحقول التاريخ تُدخل وتُعرض DD/MM/YYYY (مع زر التقويم)، والتخزين يبقى ISO.
- **الجداول**: تمييز نتائج البحث (مع مراعاة أ/ا، ى/ي، ة/ه)، ترتيب الأعمدة بالسحب، حفظ الفرز والأعمدة لكل جدول، طرق عرض محفوظة باسم (فلاتر + فرز + أعمدة)، كثافة العرض، تمييز الصف المحدد والتنقل بالأسهم، Virtual Scrolling فوق 600 صف، واستبعاد الأعمدة الحساسة من التصدير إلا عند اختيار «تصدير كامل».

## أخطاء كانت تمنع تشغيل البرنامج
- `js/modules/judicial.js`: رموز LaTeX (`\vert{}\vert{}`) وُضعت بدل `||` فتسببت في SyntaxError منع تحميل التطبيق بالكامل (الشاشة الرئيسية كانت تبقى فارغة).
- `js/services/backup.js`: كان يستورد `SCHEMA_VERSION` من `db/schema.js` وهو غير مُصدَّر هناك؛ أصبح يستورده من `core/constants.js`.
- `tools/release-audit.mjs`: كان يفحص ملفات الـ ES Modules كـ CommonJS فلم يكتشف الخطأ السابق. أصبح يفحصها كـ modules ويتحقق من تطابق الـ named imports/exports، ومن ملفات HTML، ومن تطابق الإصدار مع CHANGELOG.

### أخطاء وظيفية
- Pagination: إعادة كتابة `Repository.page()` (keyset صحيح في الاتجاهين) واستخدام مكدس مؤشرات موحد في `ui/pagination.js`؛ زر «السابق» كان يعيد صفحة خاطئة أو مقلوبة، ومؤشرات التصفح كانت تفشل مع المفاتيح العربية (`btoa` لا يدعم Unicode).
- قوائم التنفيذ والأتعاب وتقاريرهما كانت فارغة دائمًا لأنها تستعلم عن فهارس غير موجودة (`execution.openedDate`, `fees.createdAt`)؛ المستودع يرجع الآن لترتيب المفتاح الأساسي/فحص محدود بدل النتيجة الفارغة.
- فلاتر قوائم الموكلين/الملفات/القضايا لم تكن تعمل (`dataset` لسمات بلا قيمة = سلسلة فارغة)، والبحث السريع كان يفقد التركيز مع كل حرف.
- صفحة الأتعاب: الصفوف بلا `<tr>` وزر «إضافة/تعديل» غير مربوط؛ أضيف تسجيل الدفعات وعرض المدفوع.
- لم يكن في الواجهة أي طريقة لربط موكل بملف/قضية أو خصم بقضية؛ أضيفت حقول الربط وأزرار «فتح ملف للموكل» و«إضافة قضية للملف».
- حقول البحث المساعد (lookup) كانت تمسح الاختيار أحيانًا؛ أصبحت تبحث بالرقم أو الاسم/العنوان.
- الإجراءات بحالة `open` (الحالة الافتراضية في النموذج) لم تكن تظهر كمتأخرة في الرئيسية ومركز العمل والتقارير.
- التواريخ «اليوم/الشهر» كانت تُحسب بتوقيت UTC فتظهر يومًا خاطئًا بعد منتصف الليل بتوقيت مصر.
- فحص السلامة ومركز الإصلاح كانا يعتبران الحقول الاختيارية الفارغة (مثل `fileId` في التوكيل) علاقات يتيمة، وكان «الإصلاح» سيحذف تلك السجلات. أصبح يتجاهل القيم الفارغة، والحذف المنطقي يسجل `deletedBy`.
- تغيير نوع التقرير كان يُلغى فورًا؛ أزرار `data-route` داخل الصفحات (مثل «مركز العمل» في الرئيسية) لم تكن تعمل.
- تبديل قاعدة البيانات كان يعرض رسالة خطأ «تم إغلاق الاتصال» في كل مرة، وحالة التصفح القديمة كانت تسبب خطأ بعد التبديل؛ الاستعادة إلى قاعدة جديدة أصبحت تغلق الاتصال السابق وتعيد السجل لحالته عند الفشل.
- Service Worker كان cache-first بلا إصدار فيبقي المستخدم على JavaScript قديم للأبد؛ أصبح network-first مع حذف الكاش القديم.
- `index.html`: نص `${...}` حرفي كان يظهر في تذييل الطباعة.
- `js/tests/transaction-tests.js`: اختبار التراجع كان يقرأ من اتصال مغلق فيفشل دائمًا.

# v4.0.0 — FINAL

## Final release gate
- Finalized the application version after the RC quality-gate cycle.
- Confirmed the production architecture remains offline-first with IndexedDB, cursor pagination, indexed queries, multi-database profiles, backup/restore, and soft-delete lifecycle controls.
- No new database schema migration was introduced for the final release.
- Documented known platform limitations and the scope of browser-level testing.

## 4.0.0-RC10

### Data-safety hardening
- Fixed `Repository.countByIndex()` so counts exclude soft-deleted records, matching the application read model.
- Kept the operation cursor-based instead of relying on IndexedDB `count()` when logical deletion must be respected.
- Updated the release audit gate to validate the actual RC10 version.

## 4.0.0-RC9
- Hardened fee/payment aggregation for large datasets.
- Added cursor-based sumByIndex/sumAll repository helpers.
- Removed the 1000-payment validation cap.
- File-scoped fee summaries now use the fileId index.

# v4.0.0-RC6 — BACKUP & DATABASE SAFETY

- Export now uses one IndexedDB readonly transaction across all stores for a consistent backup snapshot.
- Backup manifest now records and validates `totalRecords` plus per-store counts.
- Restore validation rejects inconsistent manifests before any write.
- No schema change.


## 4.0.0-RC2
- إصلاح التنقل السابق/التالي في صفحات العمليات والقضاء والخصوم والتوكيلات باستخدام cursor الصحيح بدل العودة للصفحة الأولى.
- تفعيل تبويب الفرز والتصفية في قوائم الموكلين والملفات والقضايا بعد أن كان معروضًا دون ربط كامل.
- إضافة خطة اختبار يدوي للمسار الحرج قبل الإنتاج.
# v3.0.0 — OFFICE DATA INTEGRITY & AUDIT

- Enhanced Database Doctor: schema/index checks, required-field checks, orphan relations, soft-delete consistency.
- Added read-only audit viewer for recent ActivityLog entries.
- No automatic repair or destructive mutation.
- Application version 3.0.0; schema remains 9.

## v2.7.0 — WORK QUEUE & ACTION CENTER
- Added indexed Work Queue / Action Center for today, overdue, next 3 days, week, follow-ups and stale open files.
- Added `files.nextStepDate` index and schema version 9.
- Added direct navigation from work items to case/file/client records.
- Added dedicated Action Center navigation and dashboard shortcut.

## v2.5.0 — RELATIONAL REPORTS & WORKFLOW INTELLIGENCE
- Added relational report types: client files, client cases, case hearings, file procedures.
- Added Repository.getMany() for bounded batched entity retrieval.
- Relation reports use junction/index queries instead of loading entire stores.
- Added relation selectors with normalized autocomplete.
- Preserved AND/OR conditions, multi-sort, grouping and selected columns.
- Kept daily dashboard separate from statistical reporting.

## v2.2.0 — LARGE DATASET HARDENING
- Converted secondary generic list screens to bounded Cursor Pagination (25 rows/page).
- Removed unbounded full-list reads from the generic page presentation path.
- Dashboard overdue procedure query uses the compound status/due-date index.
- Recent Activity uses reverse timestamp pagination instead of loading the entire Activity Log.
- Added performance diagnostics service for database counts and repeatable search benchmarks.

## v1.9.0 — Backup / Database Manager / Doctor — 2026-09-27
- Backup v2 كامل مع SHA-256 عند توفر Web Crypto.
- Restore كامل ذري داخل transaction واحدة مع رفض النسخ الناقصة.
- Database Manager: إنشاء، تبديل، تعديل، أرشفة/إعادة تفعيل، وتصدير قواعد متعددة.
- Database Doctor: counts + orphan relation diagnostics.
- تحديث الإصدار إلى 1.9.0.

# CHANGELOG

## 1.8.0 - 2026-09-27
- Added unified client/file/case record views.
- Added operational Timeline projection in record views.
- Added reverse navigation between client, file and case records.
- Added file statistics and linked data summaries.
- Added judicial/execution summaries inside case records.
- Improved mobile record layout.


## v1.6.0
- Finance transactions, fee validation, operational reports, and reporting navigation.
## 1.5.0 — JUDICIAL + EXECUTION

- إضافة الشهود وتقارير الخبراء والأحكام والتنفيذ كوحدات تشغيلية مرتبطة بالقضية.
- إضافة خدمة معاملات ذرية للسجلات القضائية وتحديث القضية والملف والنشاط.
- إضافة حالات انتقال أساسية للتنفيذ.

# Changelog

## 1.0.0 — 2026-09-26
- Unified operational build from scratch.
- Added multi-database registry/context.
- Added IndexedDB schema for complete office lifecycle entities.
- Added clients, files, cases and relationships foundation.
- Added operational modules for hearings, procedures, appointments, communications, opponents, POA, notes, witnesses, experts, judgments, execution, fees, payments and document references.
- Added search, backup/restore, database doctor, quota estimate and PWA shell.
- Added browser test page.

## 1.3.0 — Lifecycle Operations
- Added opponent conflict-check workflow and case-opponent linking service.
- Added dedicated powers-of-attorney workflow.
- Added schema indexes for case-opponent role and POA expiry date.
- Hardened repository cursor pagination path and retry UI without page reload.

## 1.4.0 — Operational Workflow
- Added linked operational screens for hearings, procedures/tasks, appointments, communications and case notes.
- Added atomic operational save service with Activity Log and file activity touch.
- Added linked selectors for cases, files and clients.
- Added operational search/filtering and edit flows.
- Added hearing next-date and communication follow-up indexes.

## 1.7.0 — Search & Operations Hardening
- Indexed prefix search for Arabic-normalized fields.
- Dedicated unified search module with debounce and stale-result protection.
- Dashboard brief uses bounded indexed reads for daily operational items.
- Added timeline/search service foundation.

## v2.0.0 — PERFORMANCE CORE
- Hardened Repository cursor pagination with opaque session-bound cursors.
- Cursor now carries database session token, index key, primary key, and direction.
- Added `Repository.listPage()` / `Office.listPage()` path for keyset-style browsing.
- Added `subjectNormalized` index to cases for Arabic subject prefix search.
- Added case subject normalization to create/update flows.
- Unified search now uses indexed prefix queries instead of loading entire primary stores into memory.
- Added page-size enforcement through the existing `MAX_PAGE_SIZE` contract.
- Legacy `Office.list()` remains for bounded compatibility paths; large operational lists are being migrated to paged/indexed access.

## v2.1.0 — UI PAGINATION
- نقل قوائم الموكلين والملفات والقضايا إلى Cursor Pagination حقيقية.
- أزرار السابق/التالي مع مؤشرات مرتبطة بقاعدة البيانات الحالية.
- منع تحميل جميع السجلات للعرض في الشاشات الرئيسية.
- البحث المحلي داخل الصفحة أصبح فلترة للصفحة الحالية فقط، بينما البحث الموحد يعتمد على الفهارس.
- إضافة واجهة Pagination مشتركة.


## v2.3.0 — WORKFLOW UI & REPORT CENTER
- إزالة بطاقات إجماليات الموكلين/الملفات/القضايا من الصفحة الرئيسية والتركيز على العمل اليومي والأسبوعي.
- لوحة رئيسية عملية للجلسات اليوم، الجلسات القادمة، الأعمال الإدارية المتأخرة والقادمة، مع اختصارات للتقارير.
- إضافة أزرار رجوع وإغلاق على الصفحات، وزر رجوع وإغلاق واضح داخل النماذج المنبثقة.
- إضافة تبويب فرز وتصفية في قوائم البيانات الرئيسية، مع بحث وحالة وأولوية وفترة زمنية واتجاه فرز.
- إنشاء مركز تقارير موحد يدعم تقارير الجلسات والأعمال الإدارية والمواعيد والاتصالات والأحكام والخبراء والتنفيذ والأتعاب والملفات والقضايا والموكلين.
- إضافة فترات اليوم، غدًا، هذا الأسبوع، الأسبوع التالي، هذا الشهر، الشهر التالي، وفترة مخصصة.
- دعم التصفية المركبة داخل مركز التقارير: نص + حالة + أولوية + فترة + فرز.
- إضافة إخراج TXT وWord متوافق (.doc) وExcel متوافق (.xls) وطباعة PDF عبر حوار الطباعة.
- إضافة مشاركة التقرير كنص عبر WhatsApp وTelegram.
- تحسين التقرير الخاص بالأعمال الإدارية المتأخرة ليعتمد على الفهرس المركب للحالة/التاريخ.


## v2.4.0 — ADVANCED REPORT ENGINE
- تحويل مركز التقارير إلى منشئ تقارير متقدم.
- شروط مركبة متعددة مع AND / OR.
- فرز متعدد المستويات.
- اختيار أعمدة التقرير.
- تجميع النتائج حسب أي حقل متاح للتقرير.
- ملخص بعدد السجلات وإجماليات الحقول الرقمية عند توفرها.
- إضافة تقرير «قضايا موكل» مع اختيار الموكل عبر بحث عربي سريع دون تحميل جميع الموكلين.
- إضافة حالة «المتأخر» للأعمال الإدارية.
- رفع حد قراءة التقارير إلى 5000 مستقلًا عن حد الصفحة العادية.
- الحفاظ على تقارير اليوم/غدًا/الأسبوع/الشهر والفترة المخصصة.
- الإخراج TXT وWord/Excel المتوافقين والطباعة إلى PDF والمشاركة النصية.

## v2.6.0 — UNIFIED FILE TIMELINE & WORK QUEUE
- Added unified lifecycle timeline service for Files and Cases.
- File records now surface last activity and next upcoming activity across operational and judicial data.
- Added timeline aggregation for hearings, procedures/tasks, appointments, communications, notes, document references, judgments, execution, fees and activity log.
- Case records now show unified timeline across hearings, procedures, witnesses, experts, judgments, execution and activity log.
- Replaced repeated client/opponent reads with batched `getMany()` reads where applicable.
- Added explicit back/close actions to record pages.
- Preserved separation between daily workflow dashboard and statistics/reports.
- APP_VERSION updated to 2.6.0.

## v2.8.0 — GLOBAL RELATIONAL SEARCH
- Reworked global search with indexed name, ID, file-number and case-number lookup.
- Added entity filter tabs and direct navigation to client/file/case records.
- Added bounded relationalContext service for client/file/case relationship expansion.
- Fixed activity timeline lookup to use entityId index instead of scanning entityType buckets.
- Updated application version to 2.8.0.

## v2.9.0 — STATISTICS & ANALYTICS CENTER
- Added a dedicated Statistics & Analytics Center separate from the daily dashboard.
- Added dataset and period filters for clients, files, cases, hearings, and procedures.
- Added grouped distribution and daily trend analysis.
- Added a 10,000-row analytical scan ceiling with explicit UI warning.
- Kept analytics out of the main daily-work dashboard.

## v3.1.0 — DATA REPAIR & RECOVERY CENTER
- Added repair-plan preview before mutations.
- Added mandatory backup-before-repair workflow.
- Added safe repair for normalized search fields and missing soft-delete audit metadata.
- Destructive orphan-relation deletion requires explicit confirmation.
- Repair operations are transactional.


## v3.2.0 — LARGE DATASET HARDENING
- Removed full-list reads from operational/judicial/phase3 list pages.
- Added cursor pagination to operational and judicial datasets and opponents/POA.
- Added indexed autocomplete for client/file/case relation fields.
- Conflict checking now uses normalized prefix indexes instead of loading all clients/opponents.
- Preserved soft-delete filtering and batch relation fetches.

## v3.3.0 — TRANSACTIONAL WORKFLOW & CONSISTENCY
- strengthened transactional boundaries for core save/archive/restore/soft-delete operations
- moved case creation file lookup inside the same transaction boundary
- added optional optimistic concurrency guard via expectedVersion
- added consistency helpers for version checking
- added browser rollback/concurrency test contract with failure injection
- documented ADR-015

## v3.4.0 — BACKUP & DATABASE MANAGEMENT HARDENING
- Backup format v3 with schema/application metadata, manifest counts and SHA-256 stores digest.
- Pre-restore validation and integrity inspection.
- Restore-to-new-database workflow.
- In-place restore now creates a safety backup before replacement and requires explicit confirmation.
- Schema/backup version mismatch is rejected without writing.
- Recovery-failed profile state preserved for failed new-database restore.

## v3.5.0 — DATABASE SWITCHING & MULTI-TAB HARDENING
- Added per-window database context/session token safeguards.
- Hardened database switching: open new context before closing old context.
- Added cross-tab BroadcastChannel source isolation and database switch/migration/closing events.
- Added registry reload on external localStorage changes.
- Added multi-tab/database switching ADR-016.
- APP_VERSION bumped to 3.5.0; SCHEMA_VERSION remains 9.

## v3.6.0 — COMPLETE DATA ACCESS AUDIT
- Replaced Database Doctor/Integrity/Repair full-store `getAll()` scans with cursor streaming.
- Preserved bounded issue reporting while avoiding loading entire stores into arrays.
- Parent ID sets are built incrementally for referential checks.
- Legacy operational/generic list paths now use bounded repository pagination instead of `office.list()`.
- APP_VERSION updated to 3.6.0.
- JavaScript syntax audit passed.

## 3.7.0 — INDEX & QUERY OPTIMIZATION
- رفع APP_VERSION إلى 3.7.0 وSCHEMA_VERSION إلى 10.
- إضافة Compound Indexes لعلاقات مختارة واستعلامات العلاقة + التاريخ.
- تحويل Repository.byIndex من getAll إلى Cursor محدود.
- إضافة خدمة auditIndexes لمراجعة حالة الفهارس.
- إضافة ADR-017 لتوثيق قواعد اختيار الفهارس.

## 3.8.0 — PRODUCTION UX & ERROR HANDLING
- Unified AppError normalization for IndexedDB/storage failures.
- User-safe error screens with retry, home and diagnostics actions.
- Added local/offline status indicator.
- Added reusable busy/empty-state UI helpers.
- Added ADR-018.

## 4.0.0-RC2 — FULL PRODUCTION TEST / RELEASE CANDIDATE
- رفع إصدار التطبيق إلى `4.0.0-RC2`.
- مراجعة آلية لصياغة JavaScript لجميع الملفات.
- تحسين مشغل الاختبارات لدعم assertions الخاصة بالاستثناءات المستخدمة في اختبارات المعاملات والتزامن.
- إصلاح تكرار تعريف `reload()` في Database Registry.
- تحسين `ensureDefault()` حتى لا يحاول تشغيل قاعدة مؤرشفة إذا لم توجد قاعدة نشطة، وإنشاء قاعدة نشطة جديدة عند الحاجة.
- إزالة تاريخ ثابت من قاعدة المكتب الافتراضية؛ الفترة الزمنية الافتراضية أصبحت غير محددة.
- إضافة Checklist رسمي لمعايير Release Candidate.
- إضافة ملف Known Limitations لمنع المبالغة في ادعاءات الجاهزية أو التشفير أو التصدير.
- إضافة ADR-020 الخاص بمعايير جودة Release Candidate.

## 4.0.0-RC3 — RELATIONAL-RECORDS-FILTERS
- Hardened Clients / Files / Cases filtering so filters are applied by the IndexedDB cursor query rather than only hiding the currently rendered 25 rows.
- Added Arabic/digit normalization to primary list search predicates.
- Reset pagination cursor safely when filters/search change.
- Preserved cursor pagination for large datasets.
- Client record now displays phone data using the current phone/phones representations.
- File record counts for procedures, appointments, communications, notes, document references, fees, and activity are calculated from indexed counts rather than the timeline fetch cap.
- Kept timeline rendering bounded; counts are no longer falsely limited by the 500-row relationship read cap.
- Syntax verification passed for modified modules.

## v4.0.0-RC4 — END-TO-END RECORD INTEGRITY
- Improved Client Record relational display: linked files and cases now resolve to human-readable identifiers/titles instead of exposing raw IDs as the primary label.
- Added linked-case section to Client Record with direct navigation.
- File/Case timeline counters now use indexed count queries for the full relationship set, while timeline rendering remains bounded for UI safety.
- Preserved cursor-based reads and bounded timeline rendering for large datasets.
- Added final pre-release focus on end-to-end relational integrity.

## 4.0.0-RC5 — REPORTS & EXPORT HARDENING
- Fixed relational report parameter ordering so `ملفات موكل`, `قضايا موكل`, `جلسات قضية`, and `أعمال ملف` query the intended relationship and target ID correctly.
- Custom report periods now normalize reversed start/end dates instead of producing an invalid range.
- Report condition comparisons use the same core Arabic normalization family for Arabic letters, diacritics, tatweel, and whitespace.
- APP_VERSION updated to `4.0.0-RC5`.
- JavaScript syntax audit passed for the complete source tree.
