# v3.0.0 — OFFICE DATA INTEGRITY & AUDIT

- Enhanced Database Doctor: schema/index checks, required-field checks, orphan relations, soft-delete consistency.
- Added read-only audit viewer for recent ActivityLog entries.
- No automatic repair or destructive mutation.
- Application version 3.0.0; schema remains 9.

## v2.2.0 — LARGE DATASET HARDENING
- Converted secondary generic list screens to bounded Cursor Pagination (25 rows/page).
- Removed unbounded full-list reads from the generic page presentation path.
- Dashboard overdue procedure query uses the compound status/due-date index.
- Recent Activity uses reverse timestamp pagination instead of loading the entire Activity Log.
- Added performance diagnostics service for database counts and repeatable search benchmarks.

# PROJECT MAP

## Current release
2.5.0 — Relational Reports & Workflow Intelligence.

## Architecture
`UI → App/Services → Domain → Repository → IndexedDB`

## Stores
clients, staff, files, cases, fileClients, caseClients, opponents, caseOpponents, caseRelations, powersOfAttorney, hearings, procedures, appointments, communications, caseNotes, witnesses, expertReports, judgments, execution, fees, feePayments, documentReferences, activityLog, lookups, settings, fileNumberCounters, meta.

## Completed operational areas
Clients / Files / Cases / Opponents / POA / Hearings / Procedures / Appointments / Communications / Notes / Witnesses / Expert Reports / Judgments / Execution / Fees / Payments / Document References / Search / Backup / Multi-DB / Doctor / PWA shell.

## Important constraints
- No legal-deadline calculators in this application.
- No external backend or analytics.
- Data is local to the browser profile unless exported.
- Do not silently delete databases or records.
- Do not use reload as application state management.

## v1.9.0 Backup / Database Manager / Doctor
- Backup v2 كامل للقاعدة النشطة مع digest للتحقق من سلامة ملف النسخة عند توفر Web Crypto.
- Restore كامل ذري داخل transaction واحدة، وليس merge جزئيًا.
- Database Manager لإنشاء/تبديل/أرشفة/إعادة تفعيل القواعد مع بقاء IndexedDB القديمة.
- Database Doctor لفحص stores والعلاقات اليتيمة.
- Recovery Mode عند تلف Registry مع اكتشاف قواعد IndexedDB ذات البادئة المعروفة.

## Known next hardening work
- استبدال `Office.list()` و`Office.search()` ومسارات القوائم الكبيرة باستعلامات IndexedDB cursor/keyset حقيقية، دون `getAll(100000)` في المسارات الرئيسية.
- Hardened opaque cursor يحتوي sortBy + sortValue + lastId + databaseSessionToken.
- Compound indexes إضافية فقط عند وجود Query Pattern موثق.
- Conflict check UI وإدارة علاقات أغنى.
- Timeline كاملة موحدة.
- Benchmarks فعلية لـ 10K/100K/500K+ على الأجهزة المستهدفة.
- توسعة PWA asset precache واستراتيجية تحديث آمنة.

## v1.4.0 Operational Workflow
The operational layer now provides dedicated UI and application service flows for hearings, procedures/tasks, appointments, communications and case notes. Each supported save uses one IndexedDB transaction for the operational record, ActivityLog, and related File activity update when applicable. Future modules can extend the same service pattern.


## v1.5.0
أضيفت وحدات الشهود وتقارير الخبراء والأحكام والتنفيذ مع خدمة `judicial.js` وربطها بالقضية والملف وActivity Log داخل Transaction.


## v1.7.0 additions
- Financial services: fees and fee payments with transactional updates.
- Operational reports and print entry point.


## v1.8.0 Record Layer
- `js/modules/records.js`: unified client, file and case record views.
- Record views are projections over existing stores; no duplicate Timeline store is introduced.
- Cross-navigation uses route tokens `client:<id>`, `file:<id>`, `case:<id>`.
- Timeline is derived from ActivityLog and operational records where applicable.

## v2.0 performance hardening
- `js/db/repository.js`: session-bound keyset cursor pagination; no broad read is required by `page()`.
- `js/services/office.js`: `listPage()` service boundary and indexed unified search.
- `js/domain/normalizers.js`: normalized case subject field.
- `js/db/schema.js`: `cases.subjectNormalized` index.
- `js/core/constants.js`: application/schema version 2.0.0 / 8.

Performance rule: UI list screens should migrate from `Office.list()` to `Office.listPage()` or an index-specific query before production datasets exceed the bounded compatibility threshold.

## v2.1 Performance/UI Pagination
- Main entity lists use `Office.listPage()` and `Repository.page()`.
- Main list pages: clients, files, cases.
- Pagination state is kept per store in `app.__pages` and reset naturally by database context changes.
- Repository returns semantic `nextCursor` and `prevCursor` based on natural display order.


## v2.3 Workflow / Reports
- الصفحة الرئيسية = work queue وليست dashboard إحصائيًا.
- مركز التقارير هو المسار الأساسي للبحث والفرز والتصفية والإخراج.
- تقارير التاريخ تستخدم indexes حسب store.
- مشاركة WhatsApp/Telegram تتم كنص؛ ملفات التصدير المحلية تستخدم تنزيل المتصفح.


## v2.4 Report Engine
`js/services/reports.js` هو محرك بناء التقارير: تعريف أنواع وحقول التقارير، شروط AND/OR، الفرز متعدد المستويات، التجميع، الملخصات، وعلاقة «قضايا موكل».
`js/modules/reports.js` هو واجهة المنشئ: اختيار النوع والفترة والشروط والأعمدة والتجميع ثم المعاينة والإخراج.
`js/db/repository.js` يفصل حد قراءة التقارير (5000) عن حد pagination (100).

## v2.5.0 Relational Reports
- `reports.js` now supports client→files, client→cases, case→hearings, and file→procedures reports.
- `Repository.getMany()` batches linked entity reads within one readonly transaction.
- Relation selectors use indexed autocomplete; no full-store dropdown loading.

## v2.6.0 additions
- `js/services/timeline.js`: unified lifecycle timeline aggregation for file/case records.
- `js/modules/records.js`: enriched File/Case records with last/next work queue and unified timeline; batched related entity reads.
- `css/components.css`: work queue and timeline enhancements.


## v2.7.0
- `js/services/action-center.js`: indexed daily/weekly work queue aggregation.
- `js/modules/action-center.js`: Action Center UI with tabs and direct record navigation.
- `files.nextStepDate` indexed; schema version 9.
- Dedicated `actionCenter` route; dashboard links to the center.

## v2.8 Search
- Global indexed search: `js/services/search.js`, `js/modules/search.js`.
- Search uses normalized prefix indexes and exact national-ID index; no full-store search.
- Search result navigation routes directly to `client:<id>`, `file:<id>`, `case:<id>`.
- `relationalContext()` provides bounded relation expansion for client/file/case workflows.


## v2.9.0 — Statistics & Analytics Center
- Added `js/services/analytics.js` for scoped analytical scans.
- Added `js/modules/analytics.js` and dedicated `analytics` route/menu.
- Statistics remain separate from daily dashboard.
- Supported datasets: clients, files, cases, hearings, procedures.
- Period filters: today, last 30 days, month, year, custom.
- Group distribution and daily trend views; 10,000-row scan ceiling with explicit warning.
- `APP_VERSION` updated to 2.9.0; schema remains 9 because no persistence/index migration was required.

## v3.1 Repair & Recovery
- `js/services/repair.js`: repair plan, backup-before-repair, transactional repair application.
- `js/modules/repair.js`: preview and confirmation UI.
- Safe repairs are limited to deterministic normalization and soft-delete audit metadata.
- Orphan relation deletion is destructive and requires explicit confirmation after backup.


## v3.2.0 — LARGE DATASET HARDENING
- Removed full-list reads from operational/judicial/phase3 list pages.
- Added cursor pagination to operational and judicial datasets and opponents/POA.
- Added indexed autocomplete for client/file/case relation fields.
- Conflict checking now uses normalized prefix indexes instead of loading all clients/opponents.
- Preserved soft-delete filtering and batch relation fetches.

## v3.3 Consistency Layer
- `js/services/consistency.js`: optimistic concurrency guard and version helper.
- `js/services/office.js`: core writes and lifecycle mutations use explicit transactions; optional `expectedVersion` prevents stale overwrites.
- `js/tests/transaction-tests.js`: browser-level rollback and concurrency contracts.
- `docs/adr/015-transactional-workflow-consistency.md`: transaction boundary decision.

## v3.4.0
- Backup service: `js/services/backup.js` — versioned payload, manifest, SHA-256, preflight inspection, safe restore.
- Database UI: `js/modules/databases.js` — restore-to-new, inspect-before-restore, safety backup before in-place restore.
- ADR: `docs/adr/ADR-016-backup-restore-safety.md`.

## v3.6.0 Performance Audit
- Integrity and Health scans use IndexedDB cursors; no full-store `getAll()` in diagnostic scans.
- Repair plan generation uses cursor streaming; issue plan remains bounded.
- Operational legacy list and generic CRUD list are bounded to 100 records via Repository.page().
- Remaining `Repository.all()` / `byIndex()` APIs are explicit bounded compatibility APIs; callers should prefer page/range/prefix for large datasets.

## v3.7.0 — Index & Query Optimization
- Schema Version 10.
- Compound indexes: junction reverse lookups, case/file + date, activity entity + timestamp.
- byIndex uses bounded cursor rather than getAll.
- index-audit service available for schema/index verification.
- ADR-017 documents index/query selection rules.

## v3.8 Production UX
- `js/core/errors.js`: normalized platform/storage/IndexedDB errors.
- `js/ui/status.js`: busy and empty-state helpers.
- `js/app.js`: safe global failure UI, retry and diagnostics routing.
- `ADR-018`: production UX and error contract.

## v4.0.0-RC2 — Release Candidate Quality Gates
- `docs/RELEASE-CANDIDATE-CHECKLIST.md`: مصفوفة فحوصات RC وما تبقى من اختبارات قبول ميداني.
- `docs/KNOWN-LIMITATIONS.md`: القيود التشغيلية والأمنية والتصديرية المعلنة.
- `docs/adr/020-release-candidate-quality-gates.md`: قرار فصل الاختبارات الآلية عن قبول الإنتاج.
- `js/tests/runner.js`: assertions للاستثناءات لدعم اختبارات المعاملات.
- `js/db/database-registry.js`: Registry أكثر أمانًا عند غياب قاعدة نشطة، مع إزالة التكرار في `reload()`.

## RC3 additions
- Primary list filtering is now query-level for Clients / Files / Cases: `modules/pages.js` passes a bounded predicate into `Repository.page()` and resets the cursor when filters change.
- Arabic search predicates use `core/search-normalizer.js`.
- Record aggregate counts use `Repository.countByIndex()` where a bounded relationship fetch would otherwise undercount.

## RC5 — Reports Hardening
- `js/services/reports.js`: relational report lookup contract corrected to `(office, relation, id, limit)`; custom date ranges are normalized; report condition text comparison uses Arabic normalization.
- `js/core/constants.js`: `APP_VERSION = 4.0.0-RC5`.
- No schema change; `SCHEMA_VERSION` remains 10.


## RC10 hardening
- Repository indexed counts respect `isDeleted`.
- Release audit version gate tracks RC10.
