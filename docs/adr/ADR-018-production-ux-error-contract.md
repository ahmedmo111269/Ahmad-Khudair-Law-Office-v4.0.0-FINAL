# ADR-018 — Production UX & Error Contract

## القرار
تُحوّل أخطاء المنصة والمتصفح وقاعدة البيانات إلى `AppError` برموز مستقرة، وتعرض الواجهة رسالة عربية آمنة مع إعادة المحاولة ومسار التشخيص.

## القواعد
- لا تعرض Stack Trace أو تفاصيل تقنية للمستخدم العادي.
- `QuotaExceededError` → STO_QUOTA_EXCEEDED.
- `InvalidStateError` → DB_CONTEXT_STALE.
- `TransactionInactiveError`/`AbortError` → TX_ROLLBACK.
- `ConstraintError` → DB_CONFLICT.
- أي خطأ غير معروف → APP_UNKNOWN.
- البيانات محلية؛ حالة الشبكة لا تمنع التشغيل الأساسي.
- لا يُفترض وجود اتصال إنترنت لتنفيذ عمليات IndexedDB المحلية.
