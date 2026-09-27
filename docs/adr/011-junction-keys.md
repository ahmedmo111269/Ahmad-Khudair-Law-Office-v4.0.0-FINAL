# ADR-011 — Junction keys
## Context
الموكل قد يرتبط بملف أو قضية بعلاقة واحدة حالية في النسخة الأساسية.
## Decision
تستخدم علاقات FileClient وCaseClient مفتاحًا مركبًا منطقيًا `parentId::clientId`.
## Consequences
يمنع التكرار ويبسّط الاستعلامات. إذا أصبحت الأدوار المتعددة لنفس الطرف مطلوبة مستقبلًا يضاف role إلى المفتاح عبر migration.
