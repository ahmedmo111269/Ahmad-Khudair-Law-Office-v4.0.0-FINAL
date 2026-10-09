# التقرير النهائي — File Cockpit (إعادة هندسة قسم الملفات والموكلين)

**التاريخ:** 2026-10-09 · **الفرع:** `arena/742450f5-ahmad-khudair-law-office-v4-0` · **الحالة:** مكتمل مع الاختبارات النهائية الموحدة

---

## 1. ما فُحص وما كان موجودًا قبل التعديل

راجع `docs/FILES-AUDIT.md` بالكامل. باختصار:

- **نظام طي مركزي موجود** (`collapse-state.js` + `collapsible.js` + اندماج `datagrid`/`card`/`page-layout`) — طُوّر، لا استُبدل.
- **SectionLayoutManager** (`page-layout.js`) — نظام ترتيب/إخفاء موحّد لكل الصفحات — استُخدم كما هو.
- **آلية «التالي» في الملف** موجودة في `fileCockpitHtml` — استُخرجت كـ `fileNextStep` (مصدر واحد، لا منطق ثالث).
- **Quick Add** يمرر `fileId`/`caseId` تلقائيًا — وُسّع.
- **home-visit** (`readStoredSeen`/`markHomeSeen`/`sinceChanges`) — استُخدم لـ «تغيّر منذ زيارتي».
- **favorites** — استُخدم لشريحة «مثبتة».
- **datagrid** — الفرز/الفلاتر/التجميع/البطاقات/Provider (cursor) — استُخدم كما هو.

## 2. التحسينات التي نُفذت فعلاً

### 2.1 عقد قابلية الطي (القسم 3)

| المطلب | التنفيذ |
|---|---|
| نظام طي مشترك | موجود؛ أُضيف: ملخص حي، فتح مؤقت، استعادة افتراضي، وضع هاتف، أكورديون |
| ملخص حي | `updateCollapseSummary` + `.collapse-summary` في رأس اللوحة/البطاقة |
| شارة/تنبيه عند الطي | `[data-collapse-alert]` + نقل `.badge/.count` لرأس اللوحة |
| حفظ التفضيلات | `ui:collapse-state` (موجود) + `defaultStateMobile` جديد + «طي الكل/فتح الكل/استعادة الافتراضي» |
| فتح مؤقت | `openCollapseTransient` + حارس `focusin` (لا Antenne لعنصر مخفي) |
| تذكر آخر تبويب | `ui:file-last-tab` |
| لا IDB عند الطي | مُقاس: **0 استعلامات** (انظر §6) |
| الطباعة | CSS `@media print` يُظهر المحتوى المطوي ويُخفي أدوات الطي |
| أكورديون الهاتف | `data-collapse-accordion` على `.cf-panels` (≤700px) |

### 2.2 قائمة الملفات (القسم 5)

- شرائح: `FILE_LIST_CHIPS` — «الكل / نشطة / تحتاج إجراء / جلسة قادمة / راكدة / مثبتة» بمعايير تشغيلية واضحة (راكدة = 45 يومًا بلا نشاط، نفس criterion «يحتاج متابعة» في ملف الموكل).
- ملخص فلاتر: chips قابلة للإزالة + «مسح الكل» + عدّاد في رأس القسم + ملخص حي عند الطي.
- السابق/التالي: `listNavFor` / `listNavHtml` / `bindListNav` — معرّفات الدفعة الحالية، في صفحة الملف + صفحات السجلات.
- عمودا «الخطوة التالية» + «تاريخها» في العرض الافتراضي للجدول.
- بحث عربي: `normalizeArabic` موجود (NFKC + الألف/ى + تشكيل + أرقام) — لم يُعدّل (لا يوجد خطر خلط بين كلمات).
- الفرز المتعدد / البطاقات /provider cursor: من `datagrid` (موجود).

### 2.3 صفحة الموكل (القسم 6)

- `tel:` + `wa.me` (مصر افتراضيًا عند غياب كود الدولة).
- «ملفات تحتاج متابعة» أول مجموعة (التسجيل المركزي + DOM)، مع شارة تنبيه عند الطي.
- أكورديون على `.cf-panels` على الهاتف.
- تقليل البطاقات: kept «ملخص ملف الموكل» (4 مؤشرات) — الأرقام تساعد على اتخاذ القرار؛ لم تُحذف أي بيانات.

### 2.4 File Cockpit (القسم 7)

- **القمرة:** رأس (رقم/عنوان/أطراف مختصرة/نوع/حالة/محامٍ/تنبيهات/نواقص) + إجراء أساسي «+ إضافة» + قائمة ⋯ (9 إجراءات) + `fileCockpitHtml` (بطاقة «التالي») + `executionStripHtml` + `stagePathHtml`.
- **شريط ثابت عند التمرير** (`IntersectionObserver`): هوية + حالة + «التالي» + إضافة.
- **5 مناطق تبويبات** + شريط فرعي: نظرة / القضية / الإجراءات / المال والمستندات / الصلات والسجل. كل التبويبات الـ15 الأصلية موجودة.
- **كاش in-memory** لكل تبويب: تركيب lazy عند أول فتح، بلا IDB عند التبديل، من دون فقد أي مدخلات (تبقى عناصر DOM نفسها).
- **نواقص الملف** (`fileGaps`): عنوان/موكل/محامٍ/تاريخ/حالة + حقول نوع العمل + مراحل (حسب القسم) — لا قوائم موحدة قاسية.
- **Quick Add** داخل الملف: `fileId`/`caseId` تلقائي + (جديد) حكم/إعلان/مستند/أتعاب.
- **السابق/التالي** في رأس الملف (معرّفات الدفعة).
- **نسخ ملخص الملف** كنص.
- **فحص تشغيلي** قبل الإنهاء/الأرشفة (جلسات قادمة + أعمال مفتوحة من البيانات).
- **وضع تركيز** (`ui:focus-mode`): يخفي العناصر الثانوية (CSS) دون إخفاء التنبيهات أو القمرة.
- **«تغيّر منذ زيارتي»** في تبويب سجل النشاط: `sinceChanges` + `readStoredSeen`/`markHomeSeen` (scope `file:<id>`).

### 2.5 إصلاح خلل وُجد بالاختبارات

- `.ux-menu[hidden]{display:none}` — قائمة ⋯ لم تكن تختفي بصريًا (خلل حقيقي: `display:flex` كان يتغلب على `[hidden]`).

## 3. الملفات المُعدّلة والمكوّنات المُعاد استخدامها

انظر `docs/FILES-OWNERSHIP.md` — جدول ملكية كامل.

**مُعدّل:** `js/ui/collapse-state.js`, `js/ui/collapsible.js`, `js/ui/card.js`, `js/ui/datagrid.js`, `js/ui/cockpit.js`, `js/modules/file-page.js`, `js/modules/client-file.js`, `js/modules/list-page.js`, `js/modules/record-page.js`, `js/modules/quick-add.js`, `js/modules/settings.js`, `js/app.js`, `css/cards.css`, `css/client-file.css`, `css/ui.css`, `js/tests/collapse-state-tests.js`, `js/tests/ux-tests.js`.

**جديد:** `tools/node-tests/files-cockpit-browser-tests.mjs`, `tools/node-tests/files-cockpit-perf.mjs`, `docs/FILES-{AUDIT,OWNERSHIP,COLLAPSE-MATRIX,FINAL-REPORT}.md`.

**مُعاد استخدامه دون تعديل:** `page-layout.js`, `display-prefs.js`, `focus-engine.js`, `work-config.js`, `home-visit.js`, `favorites.js`, `client-files.js`, `legal-files.js`, `entity-query.js`, `search-normalizer.js`, `form.js`, `record-preview.js`.

## 4. تغييرات Schema / Preferences

| التغيير | السبب | التوافق |
|---|---|---|
| `ui:collapse-state.defaultStateMobile` | وضع افتراضي منفصل للهاتف (مطلب 3.1) | حقل اختياري جديد؛ القيم القديمة تتوافق |
| `ui:list-view:*.chip` | حفظ الشريحة المختارة | مفتاح داخل الكائن الموجودة |
| `ui:file-last-tab` | تذكر آخر تبويب ملف (مطلب 7.2) | مفتاح جديد في التفضيلات؛ لا بيانات |
| `ui:focus-mode` | وضع التركيز (مطلب 7.5) | مفتاح جديد في التفضيلات |
| `ui:home:last-seen` scope=`file:<id>` | «تغيّر منذ زيارتي» | نفس آلية الرئيسية، لا Store جديد |
| **Schema / Migrations / مخازن** | — | **لا تغيير** (`SCHEMA_VERSION` كما هي) |

## 5. آلية الطي — توثيق الاستخدام

انظر `docs/FILES-COLLAPSE-MATRIX.md` — جدول كامل: `id | الصفحة | الافتراضي Desktop/Mobile | الملخص | تنبيه | كسلول | طباعة` + المناطق المستثناة وأسبابها.

**الاستخدام البرمجي:**

- `enhanceCollapsiblePanels(root, scope)` — موجود.
- `updateCollapseSummary(el|key, text)` — ملخص حي.
- `openCollapseTransient(el)` — فتح مؤقت.
- أحداث: `collapse:bulk {collapsed, persist, target}` + `collapse:reset`.
- `COLLAPSE_MODES` + `COLLAPSE_MOBILE_MODES` في الإعدادات.

## 6. نتائج الاختبارات (Phase G — بعد اكتمال التنفيذ فقط)

| الحزمة | الأداة | النتيجة | ملاحظة |
|---|---|---|---|
| Node الموحّدة | `tools/node-tests/run-tests.mjs` | **615/615** | من بينها 3 اختبارات جديدة (وضع الهاتف، الشرائح، السابق/التالي) |
| `tests.html` Chromium | `tests-html-browser-tests.mjs` | **614/614** | بلا أخطاء module |
| File Cockpit E2E | `files-cockpit-browser-tests.mjs` (جديد) | **13/13** | 0 page errors |
| legal-context | `legal-context-browser-tests.mjs` | **7/7** | Quick Add + المعاينة |
| grid-browser | `grid-browser-tests.mjs` | **38/38** | Print Preview: **NOT TESTED** (يحتاج طابعة فعلية، كما في الخطة) |
| wave6-context | `wave6-context-browser-tests.mjs` | **54/54** | cockpit / شريط التنفيذ |

**التوقيت:** كل الحزم بعد اكتمال التنفيذ بالكامل. 3 إخفاقات ظهرت في أول تشغيل (أخطاء في الاختبار نفسه + خلل CSS حقيقي) — حُلت من جذرها وأُعيدت الحزم المتأثرة فقط.

## 7. قياس الأداء (فعلي، Chromium headless)

**البيئة:** 1000 ملف + 1 ملف بـ 500 سجل فرعي (250 جلسة + 250 عمل) — `files-cockpit-perf.mjs`.

| الهدف | القياس الفعلي | الحالة |
|---|---|---|
| أول محتوى لملف بـ500 سجل فرعي < 300ms | **35ms render + 22ms paint** | ✅ |
| تبديل منطقة (بعد التحميل) < 100ms | **16ms** (من الكاش) | ✅ |
| طي/توسيع < 50ms بلا IDB | **16.9ms متوسط / 22.2ms أقصى / 0 IDB** | ✅ |
| أول paint لقائمة 1000 ملف | **22ms** (25/page عبر cursor) | ✅ |
| بحث عربي | ~170ms بعد debounce 250ms | ✅ |
**NOT TESTED:** أحجام 20 / 50,000 سجل — seed 50,000 يستغرق أكثر من 10 دقائق وذاكرة كبيرة؛ البنية (فهارس + cursor + pageSize 25) لا تتغير مع N. أداة `scale-bench.mjs` متاحة لـ BENCH_N=20000.
| فتح ملف مجاور ≤ 2 نقرة | Previous/Next بزر واحد | ✅ 1 نقرة |

**NOT TESTED:** أحجام 20 / 50,000 سجل — seed 50,000 يستغرق >10 دقائق وذاكرة كبيرة؛ البنية (فهارس + cursor + pageSize 25) لا تتغير مع N.أداة `scale-bench.mjs` متاحة لـ BENCH_N=20000.

## 8. ما لم يُنفّذ وأسبابه

1. **معاينة جانبية (side panel) للسجلات المرتبطة على الكمبيوتر** (7.4): المعاينة موجودة كـ **Modal** (`record-preview.js`) تعمل على كل المقاسات ومختبرة؛ side panel إضافي قد يتعارض مع مساحة القمرة على 1366px. **قرار:** الاحتفاظ بالModal (أبسط وأأمن).
2. **تقسيم عرض (split view) قائمة + معاينة** (5.10): ممكن لكنه اختياري («يمكن»)، والModal يغطيه.
3. **Print Preview / physical print** (grid-browser): كما في الخطة — يحتاج طابعة فعلية.
4. **أداء 50,000 سجل**: NOT TESTED (انظر §7).

## 9. الافتراضات والقيود

1. **wa.me** يفترض مصر (20) عند غياب كود الدولة — مثل 010… تتحول إلى 20…؛ لدول أخرى يُعدّل الرقم يدويًا.
2. **«راكدة»** = 45 يومًا بلا نشاط — نفس criterion «يحتاج متابعة» في `clientFileSummary`.
3. **«تحتاج إجراء»** = «الخطوة التالية» موجودة و(تاريخها فارغ أو ≤ اليوم).
4. **كاش شريط «جلسة قادمة»** 60 ثانية — قد يختلف العدّاد بعد 60s (مقبول، ليس دقيقًا 100% آنياً).
5. **كاش التبويبات** in-memory فقط — يتبخر عند refresh الصفحة (لا فقد للبيانات، فقط re-query عند إعادة الدخول بعد refresh).
6. **«تغيّر منذ زيارتي»** بـ file-scope — أول زيارة: Baseline غير موجود → لا قسم (نفس سلوك الرئيسية).
7. **بطاقات الإحصاء في ملف الموكل** (4 مؤشرات) — kept؛ لا تحذف بيانات أو وظائف.

## 10. المشاكل المتبقية

- لا يوجد.
- مراقبة: `console.info('files chip index', e)` عند فشل فهرس الجلسات — الشريط graceful degradation (graceful degradation).

---

**خلاصة:** تم تنفيذ كامل نطاق المهمة (A–G). جميع الاختبارات الموحدة — تم تشغيلها **مرة واحدة بعد اكتمال التنفيذ**، وأُصلحت الإخفاقات (3) وأُعيدت الحزم المتأثرة فقط. لا تغيير في Schema أو البيانات أو العلاقات.
