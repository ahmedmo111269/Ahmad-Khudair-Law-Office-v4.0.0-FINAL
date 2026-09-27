# v4.0.0 — FINAL

## v2.2.0 — LARGE DATASET HARDENING
- Converted secondary generic list screens to bounded Cursor Pagination (25 rows/page).
- Removed unbounded full-list reads from the generic page presentation path.
- Dashboard overdue procedure query uses the compound status/due-date index.
- Recent Activity uses reverse timestamp pagination instead of loading the entire Activity Log.
- Added performance diagnostics service for database counts and repeatable search benchmarks.

# ⚖️ مكتب الأستاذ / أحمد محمد خضير المحامي
## نظام إدارة ومتابعة دورة الملفات القانونية

تطبيق ويب محلي Offline-first لإدارة دورة العمل داخل مكتب المحاماة. يعمل على GitHub Pages ولا يحتاج إلى Backend أو API أو Firebase أو Supabase.

## النطاق
هذه النسخة تجمع الأساس والوظائف التشغيلية الرئيسية: الموكلون، الملفات، القضايا، الخصوم، التوكيلات، الجلسات، الإجراءات والمهام، المواعيد، الاتصالات، الملاحظات، الأحكام، التنفيذ، الأتعاب، دفعات الأتعاب، مراجع المستندات، البحث، النسخ الاحتياطي، وقواعد البيانات المتعددة.

لا يحتوي المشروع على حاسبات الاستئناف أو النقض أو المواعيد القانونية أو المواعيد العمالية أو متجمد النفقات أو مستحقات العمال؛ هذه تطبيقات مستقلة.

## التشغيل
1. ارفع محتويات المجلد إلى Repository.
2. اجعل GitHub Pages يعمل من branch `main` ومجلد `/root`.
3. افتح `index.html` عبر GitHub Pages. يفضل HTTPS؛ بعض خصائص PWA/Storage لا تعمل من `file://`.

## التخزين
كل قاعدة بيانات مستقلة لها اسم داخلي يبدأ بـ `AhmadKhudairLawOfficeDB__`. سجل القواعد في localStorage، والبيانات التشغيلية في IndexedDB. حذف ملف القاعدة من Registry لا يحذف قاعدة IndexedDB نفسها.

## الهوية والبيانات
كل السجلات التشغيلية تستخدم IDs نصية محلية، وتحتوي على createdAt/updatedAt/version، مع soft delete حيث يلزم. البحث العربي يحتفظ بالقيمة الأصلية ويستخدم قيمة normalized مستقلة.

## قواعد مهمة
- File وحدة العمل الإدارية، وCase وحدة العمل القضائية.
- العلاقات بين الموكل والملف/القضية Many-to-Many.
- رقم الملف يولد بواسطة Counter داخل نفس Transaction مع إنشاء الملف.
- حذف ملف له قضية غير محذوفة ممنوع.
- archive وclosed وsoft delete حالات مختلفة.
- لا تعتمد الواجهة على `location.reload()` لتحديث الحالة.

## الاختبارات
افتح `tests.html` من GitHub Pages لتشغيل اختبارات التطبيع والتحقق الأساسية. اختبارات المتصفح وIndexedDB المتقدمة يجب تنفيذها في بيئة HTTP/HTTPS.

## ملاحظة الأداء
البنية تفصل Repository عن Storage Adapter وتدعم إضافة SQLite/Backend مستقبلًا. هذه النسخة لا تدعي أن تحميل كل سجلات المتجر في الذاكرة مناسب لملايين السجلات؛ مرحلة Performance Hardening يجب أن تستبدل الاستعلامات الكبيرة بcursor/keyset pagination وتنفذ اختبارات 100K+ على الأجهزة المستهدفة.


### v1.5.0
تتضمن النسخة وحدات الشهود وتقارير الخبراء والأحكام والتنفيذ، مع ربطها بالقضية وتحديث النشاط والملف والمعاملة الذرية.


### v1.7.0
تمت إضافة الأتعاب والمدفوعات والتقارير التشغيلية.


### v2.0.0 — Backup / Database Manager / Doctor
- النسخ الاحتياطي الكامل Backup v2 مع سلامة SHA-256 عند توفر Web Crypto.
- الاستعادة الكاملة ذرية داخل transaction واحدة، مع رفض النسخ الناقصة أو غير السليمة قبل الاستبدال.
- مدير قواعد بيانات متعدد: إنشاء، تبديل، تعديل الفترة/الاسم، أرشفة وإعادة تفعيل، وتصدير قاعدة محددة.
- Database Doctor لفحص stores وعدد السجلات والعلاقات اليتيمة.
- وضع Recovery عند تلف سجل Registry، مع محاولة اكتشاف قواعد `AhmadKhudairLawOfficeDB__*` واعتماد قاعدة موجودة دون حذفها.
