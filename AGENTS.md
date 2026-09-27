# قواعد المشروع

- التطبيق Vanilla JavaScript ES Modules فقط، بلا React/Vue/Angular وبلا Bundler.
- كل المسارات نسبية حتى يعمل المشروع على GitHub Pages داخل subpath.
- لا تستخدم `location.reload()` أو `location.href` لتحديث الواجهة.
- لا تحذف قاعدة بيانات أو سجلات في صمت.
- العمليات متعددة السجلات يجب أن تستخدم Transaction/Unit of Work.
- كل عمليات الكتابة تمر عبر Application Services ثم Repositories.
- لا تضع بيانات شخصية خام داخل ActivityLog metadata.
- Soft Delete منفصل عن Archive.
- File هو وحدة العمل الإدارية، Case هو الوحدة القضائية، والعلاقة بين الموكلين والملفات والقضايا Many-to-Many.
- كل معرفات السجلات التشغيلية String، وتستخدم مولدًا محليًا على نمط ULID.
- يجب اختبار التطبيع العربي والتحقق والتبديل بين قواعد البيانات.
- عند إضافة ميزة جوهرية حدّث PROJECT_MAP وCHANGELOG.
