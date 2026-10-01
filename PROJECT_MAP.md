# v5.5.0 — خريطة نظام العرض الموحّد (بطاقات + جداول + تخطيط أقسام)

- `js/core/display-prefs.js` (جديد) — **طبقة DisplayPreferences المركزية**: مفتاح `ui:display-prefs` عبر `prefs` الموجود (بلا مخزن IndexedDB جديد). الشكل `{version,global:{card,grid},pages:{[pageId]:{display,sections:{order,hidden,legacyMigrated}}},cards:{[key]:partial}}`. دوال: `resolveCardDisplay/resolvePageDisplay/resolveGridDisplay` (دمج على مستوى الحقل **البطاقة ← الصفحة ← العام ← الافتراضي**)، `setCardDisplay/clearCardDisplay/setPageDisplay/setGlobalDisplay/resetPagePreferences/resetAllDisplay` (إعادة ضبط العرض تُبقي ترتيب الأقسام)، `stepCardFontSize` (A−/A+ ضمن الحدود)، أقسام: `getSectionLayout/saveSectionLayout/markSectionsLegacyMigrated/isSectionsLegacyMigrated`. الثوابت: `CARD_FONT_SIZES/LABELS`, `CARD_DENSITIES/LABELS`, `FIELD_LAYOUTS/LABELS`, `GRID_FONT_SIZES/LABELS`, `GRID_DENSITIES/LABELS`, `DISPLAY_DEFAULTS`. `_resetDisplayPrefsForTests` للاختبارات.
- `js/ui/card-display.js` (جديد) — `applyCardDisplay(cardEl,key,pageId)` يضبط السمات الحيّة (`data-cfont/cdensity/clayout/csecondary/cborders`) **بلا إعادة رسم**، `cardDisplayButtonMarkup`, `openCardDisplayPanel/closeCardDisplayPanel` (popover على السطح، bottom-sheet ≤640px؛ إغلاق بـ Esc/نقر خارجي؛ `role=radiogroup`؛ A−/A+؛ إعادة ضبط للبطاقة)، `bindCardDisplay(root)` يربط كل الأزرار.
- `js/ui/page-layout.js` (جديد) — **SectionLayoutManager + Registry**: `registerPageLayout({pageId,title,sections})` (idempotent، ديناميكي لـ`rec:<store>`)، `getPageLayout/listRegisteredLayouts`، `resolveSectionOrder/orderedSections/hiddenSectionIds/isSectionHidden`، `migrateLegacySectionOrder(pageId,legacyKey)` (مرة واحدة مع `legacyMigrated`)، `applyPageLayout(root,pageId)` (إعادة ترتيب **تحفظ مواقع العناصر غير المسجّلة** عبر علامات `<!--pl-slot-->`؛ no-op عند عدم التغيّر؛ `.section-hidden` للمخفي؛ يجمع لكل أب على حدة)، `applyPageDisplay(root,pageId)` (سمات الجذر + كل `.ux-card[data-display-key]`)، `openPageCustomizer(app,{pageId,root,onChanged})` (نافذة ترتيب بالسحب + ▲▼، إظهار/إخفاء، فتح/طي/تثبيت عبر `collapse-state` الموجود، إعدادات عرض الصفحة، استعادة الافتراضي).
- `js/ui/card.js` — `card()` يقبل `pageId`/`sectionId`/`display`؛ يبثّ `data-display-key`/`data-page-id`/`data-section-id` وسمات العرض المحلولة وقت البناء + زر ⚙ (`data-card-display`)؛ `bindCards` يستدعي `bindCardDisplay`. `display:false` يلغي زر الإعدادات.
- `js/ui/datagrid.js` — `renderSelbar` يستثني `id==='open'` من الإجراءات الجماعية (إصلاح تكرار «فتح المحدد» في المصدر؛ يبقى `.dg-open-sel` المدمج نسخة واحدة)، احتياط عرض عام عبر `resolveGridDisplay()` عند غياب إعداد محفوظ (تمييز `''` المصرَّح عن الغائب بـ`'density' in saved`)، وإعادة الضبط تستعيد العام وتزامن الـ`select`.
- `js/modules/list-page.js` — `bulkFor` لم يعد يُصدر «فتح»؛ تسجيل `registerPageLayout({pageId:store, sections:[filters, grid(canHide:false)]})`؛ `data-section-id="filters"/"grid"`؛ زر «⚙ تخصيص الصفحة» + `openPageCustomizer`.
- `js/modules/home.js` — تخطيط `dashboard` (favs,kpis,work,shortcuts,agenda,**recents**)؛ «آخر ما فُتح» أُعيد بناؤه كبطاقة `home:recents` **مطوية افتراضيًا وفي الآخر**؛ `pageId:'dashboard'` لبطاقاته؛ زر ⚙ + ربط.
- `js/modules/record-page.js` — تخطيطات `client-details`/`opponent-details` + `rec:<store>` ديناميكي عبر `recordSectionsFor`؛ `section()` يبثّ `data-section-id`؛ `orderedClientSectionKeys` عبر `migrateLegacySectionOrder('client-sections:order')` + `resolveSectionOrder`؛ **حُذف** `clientSectionOrderDialog`؛ أزرار «⚙ تخصيص الصفحة» في رؤوس الموكل/الخصم/السجل.
- `js/modules/file-page.js` — تخطيط `file-details` من `TABS` (summary `canHide:false`)؛ `orderedFileTabs` عبر `migrateLegacySectionOrder('file-tabs:order')`؛ التبويبات تحمل `data-section-id`؛ حارس يعيد التبويب النشط إلى `summary` إذا أُخفي؛ **حُذف** `fileTabOrderDialog` واستُبدل بـ`openPageCustomizer`.
- `js/modules/client-file.js` — تخطيط `client-file` (stats,recent-files,followup,hearings,procedures,stopped)؛ `panel(title,body,sectionId)`؛ `data-section-id="stats"`؛ زر «⚙ تخصيص الصفحة» في `cf-actions` + ربط.
- `js/modules/settings.js` — لوحة «العرض والقراءة» في تبويب العامة (`renderDisplaySettings`): شرائح عامة للبطاقات (خط/كثافة/نمط حقول) + مربعَي الثانوية/الحدود + خط/كثافة الجداول، تطبيق فوري عبر `applyPageDisplay`، وزر «إعادة إعدادات العرض بالكامل» مؤكَّد بـ`confirmBox` → `resetAllDisplay`.
- `js/app.js` — `recordRoute` يعيد `layoutId` (client-details/opponent-details/file-details/rec:cases/client-file/rec:<store>)؛ `go()` بعد `bindCards` يضبط `this.__layoutId=page.layoutId||baseRoute` ثم `applyPageDisplay(main,…)` فـ`applyPageLayout(main,…)` (نقل DOM فقط، بلا إعادة Query).
- `css/display.css` (جديد) — رموز `--cd-*`، هرم طباعة (`.kv dt` مقابل `.kv dd` مقابل `.info-s`)، زر ⚙ (30px/40px لمس)، popover/bottom-sheet، ونافذة التخصيص. رُبط في `index.html` بعد `workbench.css`. `sw.js` — كاش `ahmad-khudair-law-office-v5.5.0-offline1` + `display.css` + الوحدات الثلاث الجديدة. `APP_VERSION=5.5.0` (بلا تغيير Schema).
- `js/tests/display-prefs-tests.js` (جديد، 20 اختبارًا) — الأولوية والحفظ وإعادة الضبط و A−/A+، فصل العرض عن التخطيط، عدم تكرار «فتح المحدد» واستدعاء `onBulk('open')` مرة، احتياط عرض الجدول العام، سمات/تطبيق/لوحة البطاقة، تسجيل الصفحات وكون `recents` آخرًا، حلّ الترتيب/الإخفاء/الترحيل لمرة واحدة، إعادة ترتيب DOM مع حفظ مواقع غير المسجّل، ونافذة التخصيص ▲▼. سُجّل في `tools/node-tests/run-tests.mjs` و`tests.html`: **170/170 ناجحة**؛ `tools/release-audit.mjs` PASS للصياغة وتطابق الاستيراد/التصدير (173 ملفًا/122 JavaScript، بلا تحذيرات). **NOT VERIFIED**: اختبار بصري على متصفح/جهاز حقيقي، والسحب باللمس، وقياس أداء على قاعدة إنتاجية.

# v5.4.0 — خريطة Universal DataGrid ومسار البيانات

- `js/core/grid-query.js` — Query Model محايد بالإصدار 1: `createGridQuery`, `matchesGridQuery`, `applyGridQuery`, `sortGridRows`، تطبيع عربي/أرقام، أنواع فلاتر، أشجار AND/OR متداخلة، ترتيب متعدد وحالة cursor. التجميع لا ينشئ أي إجماليات تلقائية.
- `js/ui/grid-columns.js` — `defineGridColumns` و`defaultColumnOrder`: يحافظ على `label/get/text` القديمة ويطبّع تعريفات `title`, `type`, `index`, `searchable/sortable/filterable`, حدود العرض وسائر خصائص العمود.
- `js/db/grid-data-provider.js` — `createIndexedDbDataProvider(repository,{resolveScope,indexForSort,countProvider})`: يمرر cursor/حدود الفهرس/الإشارة إلى `Repository.page()` ويحتفظ بصفحة واحدة؛ يعيد `rows`, `nextCursor`, `hasMore`, `totalExact` وحالة قابلية الفرز. لا ينفذ count شاملًا افتراضيًا. `js/ui/grid-data-provider.js` يوفّر `createArrayDataProvider` للبيانات المحدودة فقط.
- `js/ui/datagrid.js` — `mountGrid(root,{provider|dataProvider,columns,...})` يبني Query Model موحدًا، يلغي الطلب السابق ويتجاهل نتائجه المتأخرة، ويعرض تحميل/خطأ/إعادة محاولة وpagination 25/50/100. تغيّر query يعيد مؤشر cursor. التحديد في `Set` مفاتيح مستقرة مع `Map` للصفوف المحددة عبر الصفحات. المجاميع تتطلب `column.aggregate` أو `options.aggregations` صراحة؛ تذييل provider لا يعرض إجماليًا غير معلوم.
- `js/db/repository.js` — `page()` يقبل `key/lower/upper` وحدودًا مفتوحة، يتحقق من توافق cursor مع index والاتجاه، ويدعم إلغاء cursor الجاري عبر `AbortSignal`. Schema لم يتغير.
- `js/services/entity-query.js` — `entityGridScope` يبقي نطاق التاريخ والبحث العابر للعلاقات في طبقة الخدمة؛ `createEntityGridProvider` يكيّف مستودع الكيان للعقد المحايد. مسوح `scan` المرتبطة بالبحث تقبل AbortSignal. `js/modules/list-page.js` يقرأ الصفحة المطلوبة فقط، ثم ينفذ `resolveRefs` على صفحتها؛ أحداث إضافة/تعديل/تغيير نطاق تعيد القائمة إلى الصفحة الأولى.
- `css/workbench.css` — حالات التحميل والخطأ، تذييل pagination وملاحظات الصفحة الحالية، RTL وتخطيط هاتف، تخفيف حركة spinner.
- `sw.js` — كاش `ahmad-khudair-law-office-v5.4.0-offline1` ويضم `grid-query.js` و`grid-data-provider.js` و`grid-columns.js` ومحوّل المصفوفات.
- `js/tests/grid-provider-tests.js` — Query Model، Array/IndexedDB providers، نطاقات index/missing-index، cursor متكرر/ثابت، الإلغاء، تنقل DataGrid والتحديد وتغيير الحجم والفلاتر ومنع مجموع سنة القضية. أُضيف إلى `tests.html` و`tools/node-tests/run-tests.mjs`; التحقق المسجل لهذه النسخة: 150/150؛ فحص الصياغة وفحص `tools/release-audit.mjs` PASS (168 ملفًا/118 JavaScript، دون تحذيرات)؛ التفاصيل في `docs/RELEASE-AUDIT.json`. Schema 13 والبيانات التجريبية والعلاقات كما هي.

# v5.3.0 — خريطة سلوك الطي وحالة الواجهة

- `js/ui/collapse-state.js` — مخزن مركزي محلي بمفتاح `ui:collapse-state`: الأوضاع الافتراضية الأربعة، والحالة الحالية والمثبتة المستقلة لكل مفتاح مستقر، دوال الحل/الحفظ/التثبيت/المسح وإعادة الضبط. يسبق `pinnedCollapsed` ثم `currentCollapsed` الافتراضي عند استعادة عنصر.
- `js/ui/collapsible.js` — تعزيز اللوحات `.panel` وعناصر `<details>` ومجموعات البحث: مفاتيح بنطاق الصفحة/السجل ومعرّفات دلالية، حفظ مستقل، حالة `aria` ومنطقة محتوى، زر pin، وأدوات جماعية غير دائمة افتراضيًا (الحفظ اختياري). استعادة عامة من الإعدادات لا تمس بيانات المكتب.
- `js/ui/card.js` — بطاقات `.ux-card` تدعم الحالة نفسها والرأس القابل للنقر والتثبيت وملخص البطاقة مع استثناء إجراءات الرأس.
- `js/ui/datagrid.js` — غلاف جدول مستقل قابل للطي مع عدد نتائج موجز، وأدوات/فلاتر داخل لوحة ملخص مطوية افتراضيًا تبين عدد الفلاتر والعرض الحالي. حالات الأدوات والفلاتر والقسم منفصلة، مثبتة ومتوافقة مع الحالة القديمة. البحث/الفلاتر/الفرز/الأعمدة/العروض/التصدير تعمل بلا إعادة قراءة البيانات بسبب الطي؛ حالة العرض النشط محفوظة. كل استدعاءات الجداول لها مفتاح collapse ثابت أو مفتاح الصفحة/التخزين.
- وحدات `home`, `action-center`, `client-file`, `file-page`, `integrity`, `repair`, `service-records`, `analytics`, `reports`, `list-page`, `search` — طبّقت طي الإحصاءات وملخصات الفلاتر مع هويات ثابتة، وحفظ اختيار الفلاتر السريعة للمحضرين لكل ملف، وحفظ بحث/فترة القوائم محليًا.
- `js/modules/settings.js` — اختيار الافتراضي وعرض شرح الوضع وعدد الحالات المثبتة وإعادة ضبط جميع حالات العرض بتأكيد. `js/app.js` يهيّئ تفضيلات IndexedDB قبل رسم أول صفحة.
- `css/workbench.css` — أنماط متجاوبة RTL، رؤوس وأزرار لمس، ملخص الجدول، عدم تجاوز العرض، و`prefers-reduced-motion`. `sw.js` — كاش `ahmad-khudair-law-office-v5.3.0-offline1` وملف `collapse-state.js` ضمن الأصول.
- `js/tests/collapse-state-tests.js` — اختبارات مستقلة/مثبتة، الافتراضيات، Details، أدوات الجماعي، DataGrid، استعادة الحالة بعد إعادة التركيب وحفظ البحث، رفض إعادة الحالة القديمة عند الاستعادة العامة، ومحاكاة قبول من 20 خطوة للتنقل والافتراضي والتثبيت والطي الجماعي. `tests.html` و`tools/node-tests/run-tests.mjs`: **141/141 ناجحًا**. Schema 13 لا يتغير. الاختبار البصري اليدوي على جهاز حقيقي غير منفذ في هذه البيئة.

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

## v5.2.0 — نقل القائمة الجانبية إلى شريط تنقل أفقي علوي (Top Navigation)
- `js/ui/nav-model.js` (جديد) — **المصدر الوحيد لعناصر التنقل**: `NAV_GROUPS` (6 مجموعات / 27 مسارًا — نفس المسارات والأسماء والأيقونات السابقة بلا أي تغيير)، `NAV_GROUPS[].tab` (اسم مختصر للتبويب) و`icon` للتبويب، مفتاح التخصيص `ui:topnav-config`، ومنطق خالص قابل للاختبار: `defaultNavConfig/normalizeNavConfig` (يتجاهل المجهول، يستكمل الناقص، يمنع إخفاء كل التبويبات أو كل عناصر قسم)، `orderedGroups/orderedTabIds/groupItems/itemRoutesInOrder/groupIdForRoute/groupById/moveInList/planOverflow/countLabel/sectionsLabel`.
- `js/ui/topnav.js` (جديد) — **الشريط العلوي**: `buildTopNav()` (ويبقى الاسم القديم `buildSidebar` متاحًا) يبني داخل `#sidebar` بنية `#tn-inner` (شعار + `#tn-strip` تبويبات + `#tn-more` + `#tn-all` + `#tn-cust` + `#tn-toggle` + شريحة قاعدة البيانات `#sb-db-name`) و`#tn-panels` (لوحة لكل تبويب `#tn-panel-<id>` + لوحة «المزيد» + لوحة «كل الأقسام»). الوظائف: `openPanel/closePanel`، `setActiveRoute` (يُبرز التبويب الأب والعنصر معًا)، `toggleCollapsed/isCollapsed` (الوضع المطوي `body.topnav-collapsed` وإزاحة `--topnav-h` للشريط العلوي)، `toggleMobile/closeMobile` (لوحة «كل الأقسام» + خلفية تعتيم على الهاتف)، `openNavCustomizer`. التفاعل: نقرة/لمس، فتح عند المرور بالمؤشر (أجهزة المؤشر الدقيق فقط)، أسهم/Home/End/Escape، إغلاق خارجي وإغلاق عند خروج التركيز، توزيع تلقائي بين الشريط و«المزيد» حسب المساحة الفعلية (ResizeObserver + قياس فعلي)، عكس شارة «مركز العمل» على التبويب الأب، وتمرير الشريط أفقيًا داخل حدوده فقط على الهاتف.
- `js/ui/nav-customize.js` (جديد) — **شاشة التحكم الكامل**: إظهار/إخفاء أي تبويب أو عنصر، وترتيبه ▲▼، وترتيب التبويبات، و«استعادة الترتيب الافتراضي»، مع حفظ فوري في `ui:topnav-config` ورسم الجدول من التكوين المطبَّع نفسه. تُفتح من زر «تخصيص» في الشريط ومن الإعدادات.
- `css/topnav.css` (جديد) — تنسيق الشريط من توكنز `themes.css` وحدها: `#app` عمود بعرض كامل، شريط Sticky بعرض المساحة، تبويبات بحالة نشطة واضحة (خلفية + خط ذهبي + أيقونة)، لوحات Dropdown بحدود وظلال المشروع، وضع مطوي قصير جدًا مع زر إظهار، استجابة 1280/1100/900/640، خلفية تعتيم للهاتف، إخفاء في الطباعة، واحترام `prefers-reduced-motion` و`data-effects=off`. كل تجاوزات الشريط الجانبي القديم بمحدِّدات `#sidebar.tn-bar` الأعلى تخصيصًا وبلا أي `!important`.
- `js/ui/sidebar.js` — صار **جسر توافق** يعيد تصدير الواجهة القديمة نفسها (`NAV_GROUPS`, `buildSidebar`, `initSidebarState`, `toggleCollapsed`, `isCollapsed`, `toggleMobile`, `closeMobile`, `isDesktop`, `setActiveRoute`) من `topnav.js`، فلم تتغيّر أي وحدة تستوردها (app.js، الإعدادات، اختبارات البطاقات/الشريط).
- `index.html` — `#sidebar` صار `<nav class="tn-bar" data-nav="top">` مع رابط `css/topnav.css` بعد `workbench.css`؛ `js/app.js` — ربط التنقل بتفويض واحد على `#sidebar` (يبقى صالحًا بعد أي إعادة رسم)، و`Escape` يغلق لوحة الهاتف، ونصوص الاختصارات محدّثة؛ `js/modules/settings.js` — لوحة «شريط التنقل العلوي» (طي + تخصيص)؛ `js/modules/appearance.js` — تسمية لون الشريط؛ `js/ui/icons.js` — `decorateNav` يخدم `.tn-item` أيضًا.
- الاختبارات: `js/tests/topnav-tests.js` (جديد، 17 اختبارًا: تغطية 27 مسارًا، الأيقونات، تطبيع التخصيص ومنع الإخفاء الكامل، الترتيب والنقل، `planOverflow`، بناء الشريط واللوحات و`aria`، التبويب/العنصر النشط، الفتح والإغلاق، الطي والحفظ، التخصيص، انتقال التبويبات إلى «المزيد» عند ضيق المساحة، توافق الواجهة القديمة) — `tests.html` و`tools/node-tests/run-tests.mjs` → **128/128** (بما فيها 111 اختبارًا سابقًا بلا أي تعديل). `sw.js` — كاش `v5.2.0-offline1` + الأصول الجديدة. `APP_VERSION=5.2.0` (لا تغيير في Schema 13 ولا في أي منطق بيانات).

## v5.0.0 — الترقية الشاملة للواجهة (شريط جانبي + أرقام ملفات + نظام بطاقات + بيانات تجريبية)
- `js/ui/sidebar.js` — **الشريط الجانبي الجديد**: `NAV_GROUPS` (6 مجموعات / 26 مسارًا بأيقونات موحدة)، `buildSidebar` يبني القشرة في `#sidebar`، سطح مكتب كامل ↔ مطوي (تلميحات `data-tip`)، درج جوال بخلفية تعتيم وإغلاق تلقائي، حفظ الحالة في `ui:sidebar-collapsed` و`ui:nav-groups`، `setActiveRoute` يميز `aria-current`، `initSidebarState` يستعيد الحالة عند الإقلاع. `css/sidebar.css` عرضه.
- `js/core/file-number.js` — **مصدر عرض أرقام الملفات الوحيد**: `parseFileNumber` (CL/LF/SR + الصيغة القديمة `2026/0001` + أرقام عربية، ولا يُفسَّر رقم قضية رسمي `1545/2026` كرقم ملف)، `formatFileNumber` (`2/2026`)، `fileNumberKind/fileKindLabel` (رئيسي/فرعي/إعلان)، `fileNumberChip` (شارة `.fno` بالكود التقني في التلميح فقط)، `formatOfficialNumber` للأرقام القضائية الرسمية. لا يُعدّل الأكواد المخزنة ولا العلاقات.
- `js/ui/card.js` + `css/cards.css` — **نظام البطاقات الموحّد**: `card()` (أحجام/نغمات/طي محفوظ `ui:cards`/ترتيب ثابت)، `cardLoading/cardEmpty/cardError/cardSuccess`، `cardAction/cardMenu` (قائمة ⋯ بإغلاق خارجي وEscape)، `statusBadge`، `bindCards(root)` يربط الطي والقوائم؛ شرائح `.fno fno-main/fno-sub/fno-service` للأرقام.
- `js/services/demo-seed.js` — **البيانات التجريبية**: `seedDemoData(office,{onProgress})` حتمي (mulberry32، بذرة 20260929): 50 ملفًا عبر الأقسام الـ14 بعداد سنوات (10/18/22 عبر 3 سنوات)، 20 موكلًا بتاريخ إنشاء مرجَّع بالسنة، مراحل بدورة حياة وأرقام رسمية عبر `office.saveCase`، سلاسل جلسات بتأجيلات مضمونة اليوم/هذا الأسبوع، أعمال/مواعيد/اتصالات/ملاحظات/أحكام/تنفيذ/خبراء/توكيلات/أتعاب+دفعات/مستندات/إعلانات+محضرون/علاقات/أصول/إغلاق وأرشفة — كلها عبر الخدمات الحقيقية (`createLegalFileInClientFile`، `setStageLifecycle`، `saveEntity`، `addFeePayment`، `archiveFile`، `closeFile`…). يُستدعى تلقائيًا من `app.js#maybeSeedDemo` على قاعدة فارغة فقط (مفتاح `demoSeed` في meta)، ويدويًا من الإعدادات.
- `js/modules/home.js` — لوحة الرئيسية أعيد بناؤها على نظام البطاقات (4 بطاقات + اختصارات + أجندة، طي محفوظ `home:*`).
- `js/app.js` — القشرة الجديدة: `#sidebar` فارغ يبنيه `buildSidebar`، `maybeSeedDemo` بعد الصيانة، `go()` يربط `setActiveRoute`/`bindCards`/`closeMobile`.
- `js/modules/settings.js` — لوحة «البيانات التجريبية» (زر `[data-demo-seed]` + تقدم + نتيجة).
- توحيد عرض الأرقام في: `js/domain/entities.js` (`displayValue` للـ fileNumber/clientCode/internalNumber يغطي كل الأعمدة)، `client-file.js`، `file-page.js`، `record-page.js`، `services/entity-query.js`، `services/search-engine.js`، `modules/search.js`، `ui/lookup.js`، `modules/action-center.js`، `services/action-center.js`، `modules/service-records.js` — لا تظهر أكواد `CL-/LF-` للمستخدم خارج الحاجة التقنية.
- `js/ui/icons.js` — أيقونات جديدة + `ROUTE_ICONS` لكل مسارات الشريط الجانبي.
- الاختبارات: `js/tests/file-number-tests.js`، `js/tests/card-sidebar-tests.js`، `js/tests/demo-seed-tests.js` (ضمن `tests.html`)، و`tools/node-tests/` (harness فوق `fake-indexeddb` + `linkedom` يشغّل كل المجموعات خارج المتصفح: 101/104؛ الفشل الثلاث قصور بيئة مثبت مطابقته على `f40691c`).
- `sw.js` — كاش `v5.0.0-offline1` + الأصول الجديدة كلها. لا تغيير في Schema (13) ولا منطق قانوني.

## v4.7.0 — محرك البحث المركزي والجداول الاحترافية
- `js/services/search-engine.js` — **المحرك المركزي للبحث** (المصدر الوحيد): `searchAll(office,q,{stores,perStore})` و`searchStore` فوق مخازن `allSearchStores()` (20 مخزنًا) مع تكتيك ثلاثي: فهارس الأكواد (`CL/LF`) → فهارس الأرقام (fileNumber/caseNumber/nationalId) → مسح Cursor مبكر التوقف بحد `perStore` ووسم `more`. صافٍ قابل للاختبار: `tokenizeQuery/normalizeCodeToken/looksLikeCode/codeValue/looksLikeNumber/digitsOf/matchTokens/scoreHit` فوق `core/search-normalizer.js`. سجل البحث والبحوث المحفوظة تفضيلات مستخدم في IDB (`ui:search-history` حد 8، `ui:search-save` حد 20).
- `js/modules/search.js` — صفحة البحث الشامل: مجموعات مصنفة حسب النوع بشارة عدد و«المزيد»، فتح نتيجة → `app.go(route)` للسجل المرتبط، تمييز `<mark>`، فلاتر (نطاق/فترة/مدى مخصص بحقل التاريخ الصحيح لكل قسم)، سجل + محفوظات + شرائح، تنقل أسهم/Enter. `services/search.js` القديمة احتُفظ بها لخدمة الرئيسية (`relationalContext/relatedTimeline`).
- `js/ui/palette.js` — لوحة الأوامر تبحث حيًا عبر `searchAll` (استيراد ديناميكي للمحرك عند أول ضغطة) بدل مسح الفهارس الثابت.
- `js/ui/datagrid.js` — **إعادة بناء كاملة**: فرز متعدد (Shift+نقر) بخطة مفاتيح مسبقة، بحث أعمدة، فلاتر نوعية + شروط AND/OR، تثبيت عمودين، تحديد صفوف + شريط إجراءات جماعية، طرق عرض محفوظة (`grid:<storageKey>` في IDB مع سقوط لـ localStorage)، إعادة ضبط، كثافات/خط/بطاقات/ملء شاشة، تمرير افتراضي >600 صف، تصدير/طباعة «المعروض أو المحدد فقط» خلف بوابة الحساس. `list-page.js` يمرر `selectable:true,exportName`.
- `js/ui/modal.js` — حصر التركيز داخل النافذة (Tab cycle) واستعادته للزر الاستدعائي عند الإغلاق؛ نفس API.
- `js/modules/home.js` — شارة عدد عناصر العمل على زر «مركز العمل» بالشريط الجانبي.
- `css/pro.css` — قسم «16) الجداول الاحترافية v4.7» (شرائط التحديد، التثبيت اللاصق، بحث الأعمدة) و«17) صفحة البحث v4.7» (hero، شرائح النطاق، المحفوظات، مجموعات النتائج) و«18) شارة عناصر العمل».
- `sw.js` — كاش `v4.7.0-offline1` + `js/services/search-engine.js` في الأصول المسبقة.
- الاختبارات: `js/tests/search-table-tests.js` (18 اختبارًا: المحرك على قاعدة حقيقية مؤقتة + الجدول على DOM) ضمن `tests.html` → **69/69**؛ E2E تكاملي (`/tmp/pw/e2e-node.mjs`) → **19/19**.

## v4.6.0 — تجربة استخدام احترافية (UX/UI/أداء، بلا تغيير Schema)
- `js/ui/palette.js` — لوحة أوامر عالمية (Ctrl+K): أوامر ثابتة (تنقل + إجراءات سريعة)، نتائج حية عبر `services/search.js`، و«آخر ما فُتح»؛ منطق الترشيح/التمييز مفصول (`filterCommands`/`scoreCommand`/`highlightMatch`) لقابلية الاختبار. `modal.js` يبث حدث `modal:closed` لمزامنة أي نافذة.
- `js/services/recents.js` — حلقة «آخر ما فُتح» (12 عنصرًا) في تفضيلات المستخدم؛ تُسجَّل من صفحات السجل (`record-page.js`، `file-page.js`) وتُعرض في الرئيسية واللوحة والبحث.
- `js/modules/timeline-view.js` — عارض الخط الزمني الموحد فوق `services/timeline.js` (التي كانت خدمة بلا واجهة): تبويب في صفحة الملف + قسم في صفحة القضية، فلاتر بالنوع، فاصل «الآن»، فتح الحدث بنقرة.
- `js/modules/home.js` + `services/dashboard.js` — تحية حسب الوقت (`format.js: greetingKey/longDateAr`)، شريط 7 مؤشرات تفاعلية، صفوف عمل قابلة للنقر، واستعلامات مواعيد/متابعات/ملفات صامتة إضافية بحدود معلنة.
- `css/pro.css` — طبقة مكونات 4.6 كلها من التوكنز: إشعارات (`ui/toast.js` أُعيد بناؤه: حاوية/أيقونات/إغلاق/تراكم)، هياكل تحميل (Skeletons في `app.js` و`file-page.js`)، KPI، شرائح آخر ما فُتح، الخط الزمني، لوحة الأوامر، كيبورد `kbd`، تركيز `:focus-visible`، خلفية الشريط الجانبي، ظهور أزرار التنقل على الهاتف، `content-visibility` للأداء، واحترام `prefers-reduced-motion` و`data-effects=off`.
- `js/app.js` — Ctrl+K للوحة (بدل الانتقال لصفحة البحث)، `?` مساعدة اختصارات، Alt+1…9 تنقل سريع، طي مجموعات الشريط الجانبي (`ui:nav-groups`)، `aria-current`، عنوان تبويب ديناميكي، خلفية جوال للقائمة.
- `js/ui/form.js` — حفظ بـ Ctrl+Enter وتركيز أول خطأ؛ `js/services/entity-query.js` — مذكّرة `rowText` (WeakMap) لتسريع البحث الفوري؛ `js/modules/search.js` — أسهم/Enter وتمييز مطابقة وآخر ما فُتح في الفراغ؛ `js/modules/quick-add.js` — أيقونات Lucide وفلترة فورية.
- `sw.js` — كاش v4.6.0 + أصول جديدة (pro.css, palette, recents, timeline-view, pagination.js الذي كان غائبًا عن التخزين المسبق).
- الاختبارات: `js/tests/ux-tests.js` (11 اختبارًا جديدًا) ضمن `tests.html` → 51 اختبارًا.


## v4.5.0 — Parties, Hearing Chains, Bailiffs and Service Records (schema v13)
- `js/services/legal-files.js` — party groups, role/sequence ordering, explicit duplicate-client confirmation, safe removal and file relationships.
- `js/services/operations.js` — predecessor-linked hearing cycles and atomic independent follow-up session creation on adjournment dates.
- `js/services/service-records.js` — transactional service/notice records, internal numbering, bailiff registry, relaunch links, and bounded file-scoped cycle reads.
- `js/modules/service-records.js` — file tab, quick filters, status summaries, bailiff administration and service-history UI.
- `js/modules/file-page.js` / `record-page.js` — grouped/reorderable parties, upcoming/prior hearings, hearing/service timelines, related-file creation, configurable file-tab order, and saved client-record section order.
- `js/modules/reports.js` — local saved report definitions, with service-record/bailiff datasets.
- `js/ui/datagrid.js` — persisted filter state, date predicates, resizable columns, font sizing and fullscreen controls; `js/ui/collapsible.js` persists card collapse preferences.
- `js/services/maintenance.js` — resumable, additive schema-13 backfill; `witnesses` store remains intact while its UI/navigation is retired.
- `js/services/integrity.js` — deep-health checks cover new party/file/service/bailiff relations; `js/services/backup.js` export/inspect/replace-restore keeps the same safety contract.
- Regression suites: `js/tests/service-and-relations-tests.js` and `js/tests/backup-and-integrity-tests.js`, invoked by `tests.html`. Actual outcomes and environment limits are in `TEST-REPORT.md`.

## v4.4.0 polish
- `js/ui/combobox.js` — global styled dropdown for every `<input list>` (delegated, initialized in app.js).
- Datagrid: filter chips, collapsible groups, totals footer, mobile tools toggle. Themes: 9 presets (`LIGHT_PRESETS`).

## v4.3.0 Client File architecture (schema v12)
- `js/domain/taxonomy-defaults.js` — seed categories/file types/stage types/field sets/templates, relation types, extra lookups.
- `js/services/client-files.js` — taxonomy cache, client file (CL codes), legal file creation (LF codes), stage ops, related files, assets, v12 migration.
- `js/modules/client-file.js` — client file dashboard (`cfile:<clientId>`), 3-step wizard, stage path bar, related-file menu.
- `js/modules/taxonomy-editor.js` — settings tab for categories/types/templates/fields.
- `css/client-file.css` — styles for the above. Stores added: clientFiles, taxonomy, caseTemplates, assets, fileAssets.

## Current release
5.2.0 — نقل القائمة الجانبية إلى شريط تنقل أفقي علوي موسّع بعرض الشاشة، بطي وتخصيص كامل للتبويبات (إظهار/إخفاء/ترتيب)، ولوحات منسدلة منظمة لكل قسم، و«المزيد» تلقائي عند ضيق المساحة. `APP_VERSION=5.2.0`, `SCHEMA_VERSION=13`.
5.1.0 — طاولة عمل المحامي: شريط يتمدد عند الطي، جداول بتصفية من عنوان العمود وفرز متعدد وطرق عرض، بطاقات بهرم معلومات، أجندة يوم/أسبوع/شهر/قائمة، و50 ملفًا تجريبيًا معلَّمًا تبقى في القاعدة. `APP_VERSION=5.1.0`, `SCHEMA_VERSION=13`.

## Architecture
`UI → App/Services → Domain → Repository → IndexedDB`

## Stores
36 IndexedDB stores: clients, staff, files, cases, fileClients, caseClients, opponents, caseOpponents, caseRelations, powersOfAttorney, hearings, procedures, appointments, communications, caseNotes, witnesses (historical only; UI retired), expertReports, judgments, execution, fees, feePayments, documentReferences, activityLog, lookups, settings, fileNumberCounters, meta, fileParties, fileRelations, clientFiles, taxonomy, caseTemplates, assets, fileAssets, serviceRecords, bailiffs. Schema v13 declares 159 indexes; integrity audit verifies each declaration at runtime.

## Completed operational areas
Clients / Files / Cases / Opponents / POA / Hearings / Procedures / Appointments / Communications / Notes / Expert Reports / Judgments / Execution / Fees / Payments / Document References / File Parties & Relations / Bailiffs & Service Records / Search / Reports / Backup / Multi-DB / Doctor / PWA shell. Witness records remain in the database for history/integrity but are absent from user-facing routes and lists.

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

## v4.0.1 — Bug-fix release
- `js/ui/pagination.js`: `pagingState / currentCursor / applyPageResult / nextPage / prevPage / resetPaging` — مكدس مؤشرات موحد لكل شاشات القوائم؛ `Repository.page()` يعيد `nextCursor` فقط (direction = ترتيب الفرز).
- `js/core/clock.js`: `localDate()` و`addDays()` للتاريخ المحلي، و`isActiveProcedure()` (الحالات `open`/`pending`).
- `js/ui/lookup.js`: البحث المساعد يبحث في أكثر من فهرس لكل مخزن (رقم + اسم/عنوان).
- `App.setContext()` يعيد ضبط حالة التصفح عند تغيير قاعدة البيانات.
- `tools/release-audit.mjs`: فحص ES modules وتطابق imports/exports والإصدار مع CHANGELOG.


## نظام المظهر والتفضيلات (4.2.0)
- `css/themes.css`: Design Tokens والثيمات الأربعة (`data-theme` على `<html>`).
- `css/luxe.css`: طبقة التصميم الفاخر، وتقرأ كل قيمها من التوكنز.
- `js/ui/theme.js`: محرك الثيمات، والتخصيص، والثيمات المخصصة، وفحص التباين.
- `js/ui/theme-menu.js`: قائمة التبديل السريع في الهيدر.
- `js/modules/appearance.js`: استوديو المظهر داخل الإعدادات.
- `js/core/preferences.js`: تفضيلات المستخدم في IndexedDB (`akl-preferences`).
- `js/core/format.js`: التنسيق الموحّد (تاريخ DD/MM/YYYY، وأرقام، وعملة).
- `js/ui/date-input.js`: إدخال التاريخ يوم/شهر/سنة فوق input[type=date].
- `js/ui/icons.js`: أيقونات خطية بأسلوب Lucide.
