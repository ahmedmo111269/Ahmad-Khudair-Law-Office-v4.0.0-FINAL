# ADR-014 — Optimistic concurrency
## Decision
السجلات القابلة للتعديل تحمل `version`. عمليات التعديل التي تعرف النسخة المتوقعة يجب أن ترفض stale writes بدل الكتابة فوق تعديل نافذة أخرى.
