# v5.14.0 — حذف كل البيانات التجريبية بزر واحد + إصلاح تغطية الشريط العلوي

**2026-10-06 — طلب المستخدم: زر واحد يمسح كل البيانات التجريبية دفعة واحدة، وإصلاح تداخل الشريط العلوي (Overlapping UI Header) على الشاشات الصغيرة. لا تغيير في `SCHEMA_VERSION=18` ولا في المخازن.**

| المسار | الدور والتكامل |
|---|---|
| `js/services/demo-data.js` (جديد) | `scanDemoData` (فحص قراءة فقط) · `removeDemoData` (حذف دفعة واحدة) · `hasDemoData` · `demoScanSummary` · `isDemoMarkedRow` · `DEMO_DELETABLE_STORES`/`DEMO_OWNED_STORES`/`DEMO_PROTECTED_STORES`. التعرّف على البيانات التجريبية بأربع قواعد: الوسم 〔تجريبي〕 ← الإشارة المباشرة من أي سجل ← الاستخدام الحصري للسجلات المساعدة ← لحظة الزرع (±90 ثانية). الحذف داخل معاملة واحدة وبالحذف المنطقي (`isDeleted`/`deletionReason`) مع صف Activity Log واحد داخل المعاملة نفسها وبلا بيانات شخصية خام. لا يُمس: القوائم · الإعدادات · التصنيفات · القوالب · ترقيم الملفات · سجل النشاط · المزامنة · أي سجل حقيقي. |
| `js/ui/demo-cleanup.js` (جديد) | `startDemoCleanup` (فحص ← تأكيد بالأعداد لكل مخزن ← تنفيذ بتقدّم ← إشعار) · `bindDemoCleanup` · `refreshDemoCount`. مسار واحد يخدم الإعدادات والرئيسية ولوحة الأوامر. |
| `js/modules/settings.js` · `js/modules/home.js` · `js/ui/palette.js` | ثلاث نقاط دخول: لوحة «البيانات التجريبية» في الإعدادات (عدد حي + زر + شرح ما يُحذف وما لا يُمس) · لافتة الرئيسية (تظهر عند وجود `meta.demoSeed.seeded` أو فحص سريع للسجلات الموسومة) · أمر «حذف كل البيانات التجريبية» في لوحة الأوامر. |
| `js/tests/demo-cleanup-tests.js` (جديد) | 13 اختبارًا: زرع حقيقي بـ`seedDemoData` ثم فحص (تأكيد أنه قراءة فقط) ← حذف ← تدقيق المخازن، سيناريو مختلط يثبت بقاء موكل ومهمة وخصم حقيقيين، وملفات التنفيذ التجريبية وحدها بلا بقايا. |
| `css/workbench.css` | `.demo-cleanup-panel` و`.demo-data-panel` (صف أفقي على الشاشات الكبيرة، أعمدة بعرض كامل على الهاتف). |
| `js/services/favorites.js` | `removeFavorite` — تنظيف التثبيتات التي تشير إلى سجلات محذوفة. |
| `css/topbar.css` (جديد) | طبقة إصلاح التجاوب: ارتفاع تلقائي (`height:auto` + `min-height:fit-content` + `overflow:hidden`) · `flex-wrap:wrap` · استثناء `.top-actions` صراحة من قاعدة كتلة العنوان (كان يُبطل شبكة الهاتف) · شبكة 3 أعمدة للأزرار وصف مستقل لأزرار التنقل ≤640px · الشريط `static` على الهاتف · رأس صفحة عمودي بأزرار متساوية. يُحمَّل آخرًا في `index.html`. |
| `js/ui/topnav.js` | قياس دقيق لـ`--topnav-h` (`Math.ceil(getBoundingClientRect().height)`) ولا يُكتب إلا إذا كان > 0، مع إعادة قياس على `load`/`resize`/`visualViewport.resize`. |
| `sw.js` | الكاش `ahmad-khudair-law-office-v5.14.0-android-pwa` + precache: `css/topbar.css` · `js/services/demo-data.js` · `js/ui/demo-cleanup.js`. |
| `js/core/constants.js` | `APP_VERSION = 5.14.0`. |

**تحقق فعلي منفَّذ:** `run-tests.mjs` **500/500** · تجاوب الشريط: 17 عرضًا × 5 مسارات بلا تداخل وبلا تمرير أفقي (وسطح المكتب مطابق للأساس) · مسار زر الحذف مُختبر في Chromium حتى الإشعار وسجل النشاط وإعادة الزرع.

---

# v5.13.6 — جاهزية Android / PWA (Installable Offline-first Web App)

**2026-10-06 — موجز Android/PWA Production Readiness؛ لا تغيير في `SCHEMA_VERSION=18` ولا في المخازن ولا في منطق الأعمال.**

| المسار | الدور والتكامل |
|---|---|
| `js/core/history-nav.js` (جديد) | `RouteHistory` + `hashForRoute`/`routeFromHash`/`routeFromStateOrLocation`. يسجّل كل انتقال في تاريخ المتصفح بحالة `{akl:'route'}` ويكتب المسار في `#/…`؛ مدخل حماية `{akl:'overlay'}` لكل طبقة علوية؛ رجوع برمجي بنمطين (`silent` لتحرير مدخل حماية، `navigate` لزر «رجوع» الداخلي) فلا يُفسَّر كرجوع مستخدم ولا يُخصم العمق مرتين؛ وعند غياب أي مدخل برنامجي يعود السلوك لنظام Android (خروج). |
| `js/ui/overlay-stack.js` (جديد) | مكدّس الطبقات العلوية: `open(key, closer)`/`release`/`closeTop`/`isOpen` — الطبقة الأولى فقط تضيف مدخل حماية، والطبقات المكدسة تشترك فيه وتُغلق واحدة واحدة، والطبقة اليتيمة تُزال ولا تستهلك ضغطة رجوع. |
| `js/app.js` | `startHistoryNav()` (ربط `RouteHistory` + `bindOverlayStack`)، `startStorageHardening()` (تخزين دائم + مراقبة مساحة + رسائل أخطاء التخزين على `error`/`unhandledrejection`)، `record()` في كل `go()`، `back()` عبر تاريخ المتصفح، `reloadForUpdate()` لإعادة تحميل واحدة عند قبول التحديث، ومزامنة `aria-expanded` لزر قائمة الهاتف. `App.history` الداخلي بقي كاحتياط فقط. |
| `js/ui/modal.js` · `js/ui/topnav.js` · `js/ui/work-drawer.js` · `js/ui/datagrid.js` | كل طبقة تسجّل نفسها في المكدّس عند الفتح وتُفرّح نفسها عند الإغلاق: النوافذ وطبقاتها المكدسة · لوحة تنقل الهاتف (`!isDesktop()`) · درج تفاصيل العمل · قوائم الجدول (تصفية عمود/تفاصيل خلية/مظهر الجدول) — فيعمل زر الرجوع في Android كما يعمل زر ✕. |
| `js/services/pwa-updates.js` | لا استيلاء تلقائي: التحديث المنتظر يُعلَن مرة واحدة بزر «تحديث الآن»، ويُقبل بـ`SKIP_WAITING` ثم إعادة تحميل واحدة، وبعدها رسالة تؤكد أن بيانات المكتب كما هي. |
| `js/services/pwa-install.js` + `js/ui/install-prompt.js` (جديدان) | التقاط `beforeinstallprompt`، حالة التثبيت (standalone)، زر تثبيت رسمي في الإعدادات، خطوات يدوية بديلة، وتلميح واحد في الشاشة الرئيسية بعد استخدام فعلي (3 زيارات) مع «لاحقًا». بلا تتبّع وبلا إرسال أي بيانات. |
| `js/core/storage-persistence.js` (جديد) | `ensurePersistentStorage` (طلب تخزين دائم مرة واحدة) · `watchStorage` (تنبيه عند 70/85/95% من الحد) · `storageErrorHint` (رسائل عربية لـQuota/Abort/Version/InvalidState/Blocked). |
| `js/modules/settings.js` · `js/modules/home.js` | لوحة «📲 تثبيت التطبيق» في الإعدادات (زر رسمي + مساعدة)، وتلميح التثبيت الاختياري في الشاشة الرئيسية. |
| `sw.js` | استراتيجية مقصودة: قشرة وملفات ثابتة Cache-first من كاش مُرقَّم بالإصدار (`v5.13.6-android-pwa`) · تنقّل غير مخزَّن = شبكة ثم القشرة · ملف تطبيق = شبكة ثم كاش بمهلة 6 ثوانٍ · النطاقات الخارجية وطلبات `Range` و`?query` لا تُعترض ولا تُخزَّن. تثبيت أول يستولي فورًا، وتحديث فوق نسخة قائمة ينتظر `SKIP_WAITING`. الملف الفردي الفاشل في الـprecache لا يُسقط التثبيت. |
| `manifest.webmanifest` | هوية مستقرة: `id:'./'`، الاسم الرسمي، `lang/dir`، `display:standalone` + `display_override`، `orientation:any`، ألوان الهوية (`#0B0B0B`، ويتبع الثيم الحالي من `theme-color` عند التشغيل)، أيقونات 192/512 PNG + Maskable 192/512 + Apple 180، ولقطتا شاشة للهاتف. |
| `icons/*.png` (جديدة) + `tools/node-tests/make-pwa-icons.mjs` | توليد أيقونات Android من شعار المشروع نفسه بلا اعتماد خارجي (`npm run icons:pwa`)، مع safe area 20% للأيقونة القابلة للقص. |
| `css/mobile-pwa.css` (جديد) | مناطق آمنة (`env(safe-area-inset-*)`) · وضع مستقل (`display-mode: standalone`) · أهداف لمس ≈44px محصورة في `(pointer:coarse)` · `scroll-margin-block` للحقول مع لوحة المفاتيح · تنسيقات شاشة الإقلاع وتلميح التثبيت. |
| `index.html` | `mobile-web-app-capable` · `apple-touch-icon` · أيقونة 192 · شاشة إقلاع بمحتوى حقيقي بدل صفحة فارغة · دعم الفتح المباشر على مسار (`#/…`). |
| `js/tests/pwa-tests.js` (جديد) | 15 اختبارًا للمنطق الصافي (تاريخ التنقل · الطبقات · حالة الشبكة · رسائل التخزين · التثبيت · التحديث) تُشغَّل من `run-tests.mjs` ومن `tests.html`. |
| `tools/node-tests/android-pwa-browser-tests.mjs` (جديد) | 28 فحصًا في Chromium بمحاكاة هاتف Android (manifest · `Page.getInstallabilityErrors` · Service Worker وكاش القشرة الكامل · مناطق آمنة · أهداف لمس · **زر الرجوع** · رابط مباشر وتحديث · بقاء البيانات بعد إعادة التشغيل · **إقلاع وتنقّل وكتابة دون اتصال** · **تحديث إصدار آمن** · سطح المكتب بلا تغيير). `npm run test:android-pwa`. |
| `tools/node-tests/make-pwa-screenshots.mjs` (جديد) | لقطات manifest من تشغيل حقيقي بمقاس 1080×1920 (`npm run screenshots:pwa`) — `screenshots/home-mobile.jpg` و`screenshots/files-mobile.jpg`. |
| `.nojekyll` (جديد) | يمنع Jekyll على GitHub Pages من استثناء المجلدات التي تبدأ بنقطة، فتُخدَم ملفات مثل `.well-known/assetlinks.json` عند التغليف كـTWA. |
| `tools/release-audit.mjs` | كان يُفسِّر كلمة `import` داخل تعليق كسطر استيراد فيُفشل الإصدار خطأً (`execution-calendar.js`). صار يُزيل التعليقات قبل الفحص ويكتشف الاستيراد بلا `from` — البوابة **PASS** و1091 استيرادًا مفحوصًا. |
| `docs/ANDROID-PWA.md` (جديد) | دليل التشغيل على Android: التثبيت، زر الرجوع، العمل دون اتصال، التحديث، مسار التغليف (PWABuilder/TWA)، وحدود التحقق. |
| `js/core/constants.js` | `APP_VERSION = 5.13.6`. |

**تحقق فعلي منفَّذ:** `run-tests.mjs` **487/487** · `android-pwa-browser` **28/28** · `release-audit` **PASS** (1091 استيرادًا) · `grid-browser` (وضع offline الكامل + تكافؤ الأصل) ناجح · `offline-sync` و`execution-browser` (34/34) و`quick-notes` و`work-center` ناجحة. **NOT VERIFIED:** جهاز Android حقيقي وChrome حقيقي (الاختبار بمحاكاة Chromium موبايل)، ومعاينة الطباعة الأصلية والطباعة الورقية.

---

# v5.13.2 — خريطة «الإعدادات تعمل» وأفق الحساب الصريح

**2026-10-05 — إصلاح محدود فوق v5.13.1 أدناه؛ لا تغيير في `SCHEMA_VERSION=18` ولا في المخازن ولا في مسار FEAS.**

| المسار | الدور والتكامل |
|---|---|
| `js/services/execution-simple.js` | فصل `asOf` المعلن عن `periodThroughDate` (أفق الفترات) داخل `simpleSchedule`، وفي الكشف/الطباعة صار التاريخ المستقبلي المطلوب صراحةً هو الأفق نفسه موسومًا «تقديري» (لا كشف يعلن تاريخًا ويحسب غيره)؛ `claimHorizon`/`simpleScheduleHorizon` تقبلان `allowFuture`؛ `horizonTransparency` يخرج `requestedAsOf`/`effectiveAsOf`/`periodThroughDate`/`horizonCapReasons`/`horizonShowWarning`/`horizonNote`/`estimatedPeriods`؛ `simpleDurationClaim` و`simplePoaDraft` و`simpleStatementDocument` تحترم النطاق المستقبلي عند الطلب الصريح وتعلن القصّ بسببه؛ جدول التوكيل يُبنى حتى نهاية النطاق (كان عند اليوم فحسب)؛ `simpleStatementDocument` تقبل `allowFuture` وتوسم الكشف المستقبلي «تقديري». |
| `js/services/execution-cache.js` | `executionCache.clearExecution(id)` لإبطال مخصوص لتنفيذ واحد (تُنادى من كتابة شرائح القيمة)؛ مفتاح جديد يشمل `periodThrough`، وإبطال عند أي كتابة على كيان تنفيذي (أُضيفت `executionSettlements` و`executionAdjustments` وكل ما يبدأ بـ`execution`)، فلا يبقى رقم اعتراف قديم بعد اعتماد فرق في FEAS. |
| `js/ui/execution-horizon-picker.js` | شاشة «المطلوب حتى»: اختصارات من ارتكاز الفترة، مفتاح «احسب حتى تاريخ مستقبلي» يحترم الإلغاء الصريح، بيانات الفترات الداخلة والمعادلة، وإنذار القصّ/التقدير/التاريخ الأقدم من اليوم. |
| `js/ui/execution-summary-card.js` | بطاقة الملخص السريع: الموكل/النوع/طريقة التنفيذ + الأرقام الثلاثة القابلة للتفسير + المعادلة + أزرار العمل و«⚙ إعدادات التنفيذ» داخل البطاقة. |
| `js/modules/execution-center.js` | تاريخ حساب لكل تنفيذ (`asOfKeyFor`/`resolveAsOf` ونطاق موحّد اختياري)؛ قرار المستقبل لكل بطاقة في جلسة العرض (`detailAllowFuture`)؛ `bindAll` لكل العناصر بدل `querySelector` المفرد فتعمل روابط الإعدادات كلها؛ تمرير `allowFuture` للطباعة؛ سطر الفترة الجارية يصف حالها بحسب توقيت الاستحقاق الفعلي. |
| `js/ui/execution-simple-forms.js` | «احسب مدة» فيها مساران: الجدول المسجَّل (الافتراضي) و**مذكرة بمبلغ يدوي** (مبلغ + دورية + رسوم/دمغة) تعمل بلا تسجيل قيمة وتُعلن أنها لا تُنشئ استحقاقًا؛ نافذة إعدادات كاملة قابلة للتعديل (قواعد + سبع قوائم + نطاق تاريخ الحساب + قوالب + سجل النسخ) بتحقق عربي ورسالة فشل داخل النموذج؛ «احسب مدة» و«التوكيل»: قراءة قرارات المربعات بأي قيمة تفعيل غير فارغة، ومزامنة خيار المستقبل عند اختيار تاريخ لاحق، ومعاينة توكيل بمعادلة الفترات ورسوم/دمغة يدوية ومصدر الرصيد السابق، مع تعطيل الرسوم اليدوية في مسار FEAS. |
| `js/domain/execution-schedule.js` | `amountEquation` تعرض الأعداد بفواصل الآلاف (`3 × 3,000 = 9,000`) فتطابق المعادلة المعروضة في كل الشاشات؛ `valueTimeline` يحترم `defaultCurrency` في البنود بلا عملة صريحة. |
| `js/services/execution-settings.js` | `RULE_KEYS` صار يضم `allocationOrder` و`defaultCurrency`، فتغييرهما يرفع نسخة القواعد ويُسجَّل في سجل النسخ ويُبطل الذاكرة — لا خيار بلا أثر. |
| `sw.js` + `js/core/constants.js` | `APP_VERSION = 5.13.2`، و`CACHE=…-v5.13.2-execution-settings-and-horizon` مع إضافة الوحدات الثلاث الجديدة إلى precache (كان غيابها يُفشل الإقلاع بلا شبكة). |
| `tools/node-tests/execution-practical-tests.mjs` | 15 فحصًا جديدًا (15–29): الأرقام المرجعية 3,000/9,000 والمعادلة، عزل تاريخ البطاقات، رسوم/دمغة التوكيل 9,600، الانعكاس الفوري للإعدادات، إبطال الذاكرة، رسائل الفشل والتحقق، الأساس التقويمي، وأثر ترتيب التوزيع والعملة الافتراضية. |
| `tools/node-tests/dom-forms.mjs` | `TestFormData` يطابق المتصفح في قيمة مربع الاختيار الافتراضية (`on`) فلا تنجح الاختبارات على سلوك لا يراه المستخدم. |
| `tools/node-tests/execution-settings-browser-tests.mjs` (جديد) | 10 فحوص Chromium حقيقية لرحلة الشكوى نفسها (ثمانية مكتبي — منها «لا زر ميت» ومذكرة الحساب اليدوي — + فحصا موبايل بعرض 390px): الأرقام المرجعية 3,000/9,000 · الإعدادات من البطاقة وانعكاسها الفوري · التوكيل 9,600 · قوالب الطباعة · بلا أخطاء كونسول. `npm run test:execution-settings-browser`، ولقطاته في `docs/execution-ux-shots/v5.13.2-*.png`. |

**التحقق المنفذ فعليًا:** `run-tests.mjs` = **470/470**؛ `execution-practical-tests.mjs` = **45/45**؛ Chromium: `execution-settings-browser` 10/10 · `execution-print-browser` **13/13** · `execution-simple-browser` 20/20 · `execution-browser` 34/34 · `execution-feas-browser` 10/10 · `execution-feas-cycle` 19/19 · `offline-sync` و`quick-notes` ناجحان. يبقى `grid-browser` فشلًا قائمًا على `main` في تخصيص الجدول (خارج نطاق التنفيذ). **NOT VERIFIED:** معاينة الطباعة الأصلية والطباعة الورقية ومتصفحات غير Chromium.

---

# v5.13.1 — إصلاح مركز التنفيذ فقط (BUG-1..7) تراكمي

**2026-10-05 — النطاق: Execution Center فقط، المحرك سليم — إصلاح واجهة + أفق + توكيل.**

| المسار | الدور والتكامل |
|---|---|
| `js/modules/execution-center.js` | كل الروابط `querySelectorAll.forEach` (مركز + بطاقة + runningPeriodNote)، ثوابت `ASOF_MODE_KEY` و`asOfKeyFor(id)`، قراءة `localAsOf/globalAsOf/effectiveAsOf` مع `allowFuture:true`، `summarySectionMarkup` يعرض `requestedAsOf/effectiveAsOf` وتنبيه `horizonCapped` وشارة «تقديري»، و`bindContainer` يربط `data-settings/data-help` داخل الملاحظة الجارية. |
| `js/services/execution-simple.js` | `claimHorizon(...,{allowFuture})` و`simpleScheduleHorizon` — قصّ فقط إذا `allowFuture:false`، `simpleSchedule({allowFuture})` يعيد حقول شفافية + `horizonNote`، `simpleCardBundle` افتراضي `allowFuture:true` ويستخدم `executionCache` بمفتاح يشمل `ruleVersion`، وكل كتابات (تحصيل/إجراء/مصروف/حكم لاحق/توكيل/إلغاء/تعديل/حالة) تمسح `executionCache.clearExecution(id)`، و`simplePoaDraft({fees,stamps,allowFuture})` يلتقط آخر تبديد/حجز ويحوّل الرسوم عبر `toMinorUnits`. |
| `js/domain/execution-schedule.js` | `buildPoaFigures({schedule,fromDate,toDate,feesMinor,stampsMinor,previousAction,...})` — يضيف `feesLine/stampsLine` بتلميح «النظام لا يفترض رسومًا ولا دمغة — أدخلها أنت»، و`periodEquations` (متساوية/مختلفة/جزئية)، و`previousNote` مرتبط بمحضر برقم وتاريخ، و`totalMinor = previous+period+expenses+fees+stamps` ومعادلات تشمل التفصيل. |
| `js/ui/execution-simple-forms.js` | `executionSettingsDialog` بمعالجة `try/catch` كاملة + تعطيل زر + `data-error` + `toast` + اختيار وضع `asofMode per/global` وقوائم قابلة للتعديل يدويًا (بما فيها `borneBy, laterJudgmentKinds, templates, followUpThresholds`) + يستخدم `app.refresh()`، و`simplePoaDialog` يضيف حقلي `fees/stamps` ومعاينة بالربط والمعادلة والرسوم. |
| `js/services/execution-cache.js` (جديد) | LRU 200 مدخل، مفتاح `${executionId}|${asOf}|${allowFuture}|${ruleVersion}|${engineVersion}`، يستمع لـ `execution:cache-invalidated` و`execution:configuration-changed`، `get/set/clear/clearExecution/key`. |
| `docs/EXECUTION.md` | قسم 7 يوثق BUG-1..7 وقبول `allowFuture`. |
| `CHANGELOG.md` | إدخال تراكمي يوثق كل إصلاح وقبول 1 فترة/4 فترات/مقصوص. |

**التحقق:** `claimHorizon` allowTrue لا يقصّ، allowFalse يقصّ إلى اليوم؛ `simpleSchedule` 2026-11-04 ⇒ 1 فترة 3000، 2027-01-04 ⇒ 3 فترات ANNIVERSARY / 4 فترات CALENDAR_MONTH بلا قصّ صامت؛ `execution-cache` LRU ويُبطل عند تغيير الإعدادات؛ `buildPoaFigures` يظهر معادلة ورسوم يدوية وربط بمحضر. لا `SCHEMA_VERSION` جديد، لا bundler، مسارات نسبية، لا `location.reload`.

---

# v5.13.1 — خريطة إصلاح حساب التنفيذ وإدارة البيانات

**2026-10-05 — إصلاح محدود: توقيت الاستحقاق صار خيارًا، وقاعدة «لا شاشة فارغة»، وأدوات مسح البيانات والملفات التجريبية. لا تغيير في `SCHEMA_VERSION=18` ولا في المخازن.**

| المسار | الدور والتكامل |
|---|---|
| `js/domain/execution-schedule.js` | `ACCRUAL_TIMINGS` و`ACCRUAL_TIMING_LABELS` جديدان؛ `DEFAULT_SCHEDULE_SETTINGS.accrualTiming = AT_PERIOD_START`؛ `settingsWith()` يتحقق من القيمة بدل تثبيتها. `claimForRange` يضيف صفوف الفترات الجارية بمبالغها المتوقعة (`notYetComplete` موسَّع بـ`label`/`paidMinor`/`status`) ومجموع `runningProjectedMinor`، ويفصل المطالبة (ما انقضى) عن الاستحقاق (توقيت المكتب). `buildPoaFigures` يخرج `runningPeriods` معلوماتية لا تدخل الإجمالي. |
| `js/services/execution-settings.js` | `cleanSchedule()` يحترم `accrualTiming` المحفوظ بدل إجباره؛ القيمة تدخل نسخة القواعد المؤرخة (`RULE_KEYS`) وتُبطل cache عند تغييرها. |
| `js/ui/execution-simple-forms.js` | نافذة الإعدادات: خياران حقيقيان لتوقيت الاستحقاق مع شرح. نافذة «احسب مدة»: صفوف الفترات الجارية بمبالغها + بند «متوقع فترات جارية». نافذة التوكيل: سطر الفترات الجارية المعلوماتي. |
| `js/modules/execution-center.js` | `runningPeriodNote()` سطر الفترة الجارية أعلى الأرقام الثلاثة؛ إنذار تاريخ الحساب القديم وزر `↺ ارجع إلى اليوم`؛ `refreshCounters()` تُحسب عند كل دخول للصفحة (كانت مرة واحدة لكل جلسة)؛ زرّا «📁 ملفات تنفيذ تجريبية» و«🗑 مسح بيانات التنفيذ»؛ `maybeSeedExecutionDemo()` يزرع مرة واحدة في قاعدة فارغة التنفيذات. |
| `js/ui/form.js` | إنشاء `execution` من أي مدخل عام يُوجَّه إلى `newExecutionDialog` (لا تنفيذ بلا حكم ولا بند قيمة). |
| `js/services/data-admin.js` (جديد) | `clearAllData` (تأكيد مزدوج + سبب + معاملة واحدة + سطر شاهد) · `clearExecutionData` · `seedExecutionDemoFiles` (4 ملفات 〔تجريبي〕) · `removeExecutionDemoFiles` · `executionDemoStatus`. المسح بـ`captureChanges:false` موثَّق. |
| `js/modules/settings.js` | منطقة «🗑 مسح البيانات»: نسخة احتياطية أولًا · مسح قسم التنفيذ فقط · مسح شامل بتأكيد مزدوج واسم القاعدة. |
| `tools/node-tests/execution-practical-tests.mjs` (جديد) | 29 فحصًا عمليًا يقود التطبيق الحقيقي: النوافذ، النماذج، التبويبات الأربعة، كل رحلات التسجيل، المسح، والملفات التجريبية. `npm run test:execution-practical`. |
| `tools/node-tests/dom-forms.mjs` (جديد) | تكملة بيئة الاختبار: `FormData` لـlinkedom وأصناف العناصر الناقصة + `mountAppShell()`. |
| `sw.js` | `CACHE=…-v5.13.1-execution-accrual-and-data-admin`، وإضافة `data-admin.js` والوحدات الناقصة (`feature-flags`, `loading`, `status`, `index-audit`, `performance`) إلى precache. |
| `js/core/constants.js` | `APP_VERSION = 5.13.1`. |

**التحقق المنفذ فعليًا:** `node tools/node-tests/run-tests.mjs` = **470/470**؛ `node tools/node-tests/execution-practical-tests.mjs` = **29/29**. **NOT VERIFIED:** الطباعة الورقية، متصفحات غير Chromium.

# v5.13.0 — خريطة تقويم التنفيذ والاستحقاق الثابت

**2026-10-05 — تحديث محدود لطبقة التقويم والاستحقاق والتخصيص فوق تجربة v5.12.0 أدناه؛ لا إعادة بناء لقسم التنفيذ ولا تغيير Schema 18/المخازن.** الافتراضات ممارسة مكتب مؤرخة بحسب إفادة المستخدم، وليست قاعدة قانونية مضمّنة.

| المسار | الدور والتكامل |
|---|---|
| `js/domain/execution-period-calendar.js` | مصدر الحقيقة النقي للتواريخ المدنية `YYYY-MM-DD` وللفترات MONTH/YEAR/WEEK/DAY؛ `ANNIVERSARY` أو `CALENDAR_MONTH`، ارتكاز ثابت ومعرّف `(itemId, anchorDate, k)`، نهاية شهر `CLAMP_TO_LAST_DAY`، فترات مكتملة فقط؛ بلا DOM/IndexedDB/Date/timezone وبلا تناسب أيام. |
| `js/domain/execution-schedule.js`, `js/domain/entitlement-engine.js`, `js/domain/execution-feas.js` | أفق استحقاق منفصل عن `asOf` الحساب الفعلي (`unitAsOf`/`periodThroughDate`)، المبلغ الدوري الكامل بعد نهاية الفترة، الجارية للإعلام فقط، قرارات صريحة للحدود/تغير القيمة، FIFO على المستحق فقط، والدائن/الدفع المسبق منفصل. الإعدادات القديمة لـ`prorationPolicy` تُتجاهل ولا تُطبَّق. |
| `js/services/execution-settings.js` | v2 مؤرخة في 2026-10-05: `ANNIVERSARY`, `ASK` لتغير المبلغ ونهاية الحكم منتصف الفترة، `AFTER_PERIOD_END`, `CLAMP_TO_LAST_DAY`. تُحفظ v1 كما هي؛ سبب/فاعل/تاريخ في Activity Log، رفع `engineVersion`، وإبطال cache. |
| `js/services/execution-period-migration.js` | هجرة v2 idempotent غير مدمرة: تثبيت `itemId/anchorDate`، إعادة ربط تخصيص فقط عند تداخل فريد، التعارضات الملتبسة للمراجعة، تقرير قبل/بعد؛ لا كتابة على التحصيل أو الدفتر أو الاعترافات/اللقطات أو التوكيلات الصادرة. |
| `js/services/execution-simple.js`, `js/services/execution-feas.js`, `js/services/execution-poa.js`, `js/services/execution-print.js` | حفظ قرارات «احسب مدة» وFEAS، وقرار الحكم اللاحق في المحرك القديم (`MID_CHANGE`/`END_DATE`) مع السبب والفاعل والتاريخ؛ لا افتراض تلقائي مع `ASK`، والاختيار اليدوي مبلغ كامل بلا تناسب. تمرير القرار إلى Snapshot/Activity Log/Trace والكشف والتوكيل المطبوع؛ قرارات FEAS تبقى في مسار الاعتراف المنفصل. `asOf` تاريخ الحساب الفعلي، وأفق الفترة مستقل. |
| `js/ui/execution-simple-forms.js`, `js/ui/execution-forms.js`, `js/domain/entities.js` | عرض سيناريوهات منتصف فترة الحكم اللاحق ونهاية السريان جنبًا إلى جنب، وإظهار حقول القرار والسبب والمبلغ اليدوي عند `ASK`/`MANUAL`؛ إبقاء FEAS في واجهة الاعتراف المنفصلة، وإزالة اختيارات التناسب بالأيام وإظهار تسميات FIFO/LIFO على المسارات القديمة والجديدة. |
| `js/app.js`, `js/core/constants.js`, `sw.js` | ترقية إعدادات المكتب ثم هجرة تقويم v2 عند الإقلاع؛ `APP_VERSION=5.13.0`، precache للتقويم والهجرة واسم cache جديد. |
| `js/tests/execution-tests.js`, `js/tests/execution-simple-tests.js`, `js/tests/execution-ui-tests.js`, `tools/node-tests/execution-simple-browser-tests.mjs` | Goldens 2026 (0.00 في 05/10، 3,000 في 04/11، 9,000 في 04/01)، تقويم وحدود/قرارات FEAS، قراري `MID_CHANGE` و`END_DATE` في المحرك القديم (رفض غياب الاختيار، الحفظ والفاعل والتاريخ وظهور Trace)، تقارير الهجرة والمحافظة على snapshots/POAs، والمدة والكشف والتوكيل والطباعة؛ يشمل اختبار Chromium تفاعليًا للمقارنة والحفظ. |

**سبب الجذر المؤكد لاختباري الهجرة اللذين كانا يفشلان:** الهجرة طلبت 5,001 صف عبر `Repository.byIndex` ذي سقف 5,000؛ الرفض كان يُخفى بـ`catch(() => [])` فظهرت تقارير صفرية. صُحح الحد إلى استعلام 5,000 مع حجز صف لاكتشاف تجاوز السقف.

**التحقق المنفذ فعليًا:** `node tools/node-tests/run-tests.mjs` = **469/469**؛ `execution-simple-browser-tests.mjs` = **20/20** (يتضمن اختبار Chromium لمقارنة MID_CHANGE/END_DATE وحفظهما وظهورهما في Trace)؛ `execution-browser-tests.mjs` = **34/34**؛ `execution-feas-browser-tests.mjs` = **10/10**؛ `execution-feas-cycle-browser-tests.mjs` = **19/19**؛ `execution-print-browser-tests.mjs` = **12/12** (PDF كشف صفحتان/توكيل 4 صفحات). `grid-browser-tests.mjs` مع خط أساس الفرع الأب `99c92980` أكّد **عدم وجود إخفاقات جديدة**: 5 إخفاقات وحدة متطابقة في الطرفين (الحالي 455/460، وخط الأساس 446/451)؛ واختبارات التكامل/التصفح والطباعة غير الأصلية وService Worker والهجرة دون اتصال **38/38 VERIFIED**. عُدّل اختبار الإقلاع غير المتصل ليستوعب تشغيل الهجرة مرة واحدة عند تبديل قاعدة الملف الشخصي، ثم يتحقق من عدم تغيّر سجلها في الإقلاع التالي. **NOT VERIFIED:** معاينة الطباعة الأصلية/الطابعة الورقية، متصفحات غير Chromium، وقارئ شاشة.

# v5.12.0 — خريطة تبسيط قسم التنفيذ (طبقة استخدام فوق المحرك نفسه)

**2026-10-04 — إعادة بناء طبقة الاستخدام في «مركز التنفيذ» و«بطاقة التنفيذ» فقط؛ المحرك النقي والمخازن القائمة أُعيد استخدامها حرفيًا. `SCHEMA_VERSION=18` والـ56 مخزنًا و308 فهارس كما هي، بلا مخزن مالي موازٍ وبلا حذف أو تحويل لأي سجل.** التقرير الكامل بالمعطيات والصور: [`docs/EXECUTION-SIMPLE-UX-REPORT.md`](docs/EXECUTION-SIMPLE-UX-REPORT.md).

| المسار | الدور والتكامل |
|---|---|
| `js/domain/execution-schedule.js` (جديد، نقي) | `buildExecutionSchedule` (فترات مشتقة وقت العرض من بنود القيمة/الأحكام + المحاضر + التخصيصات + الدفتر + الإعدادات)، الحالات `paid/partial/unpaid/nothing_due`، `claimForRange`، `buildPoaFigures` (لقطة التوكيل)، الرصيد السابق، الدفعة الزائدة، `pinnedRequestedByUnit` — بلا DOM وبلا IndexedDB |
| `js/services/execution-simple.js` (جديد) | الخدمة التطبيقية الموحّدة: `loadExecutionBundle`/`listExecutionRows`، كل كتابات الواجهة الجديدة (`saveCollection`/`saveActionRecord`/`saveExpense`/`saveLaterJudgment`/`savePoa`/`saveNote`/`createSimpleExecution`/`editRecord`/`voidRecord`/`restoreRecord`)، `durationClaim`، `statementData`، `capSlicesAtHorizon` + `feasRecognizedThrough` + **`feasScheduleSlices`** (FEAS بلا اعتراف ⇒ لا دَين؛ وغير FEAS كما كان) (أفق الاستحقاق)، **`enableFeasModel` + `executionFinancialFootprint`** (تحويل تنفيذ فارغ إلى FEAS برفض عربي لما فيه أرقام)، **`planFeasCollectionTargets`** (تخصيص تحصيلات FEAS بصفوف صريحة على الفترات المعترف بها)، `completionHints`، و`migrateSimpleExecutionData` (Idempotent غير مدمّر، ترقيم 100/صفحة، تقرير قبل/بعد) |
| `js/services/execution-settings.js` (جديد) | `executionSettings`/`saveExecutionSettings`/`resetExecutionSettings`: أساس الشهر، الشهر الجزئي، التقريب، ترتيب التخصيص، اعتماد الحكم اللاحق (مغلق افتراضيًا)، قوالب الطباعة، والقوائم القابلة للتحرير (`actionKindOptions`/`expenseTypeOptions`/`entitlementOptions`/`collectionMethodOptions`) — **لا ثوابت قانونية في الكود** |
| `js/modules/execution-center.js` | المركز: 4 عدّادات قابلة للنقر (`جارٍ`/`عليه متأخرات`/`يحتاج متابعة`/`مكتمل السداد`) + بحث + جدول واحد بأعمدة العمل اليومي، وزر **🧪 مثال عملي جاهز**؛ البطاقة: شريط أوامر ثابت (`+ تسجيل`/`🧮 احسب مدة`/`🖨 كشف/توكيل`/`⋮`، ومثبَّت أسفل الشاشة على الهاتف) + 4 تبويبات (`الحساب`/`السجل`/`الحكم والبيانات`/`التوكيل والطباعة`)، ثلاثة أرقام أعلى (`المطلوب حتى …`/`المدفوع`/`المتبقي` + شريط تقدّم) كل رقم زر يشرح معادلته، سجل موحّد، سلة تنفيذ، ويستمع إلى `exec:record` (اختصار `Ctrl+Shift+T`) |
| `js/ui/execution-simple-forms.js` (جديد) | 13 نافذة بلغة المحامي: ورقة «+ تسجيل» بالست أيقونات (تحصيل/إجراء/مصروف/حكم لاحق/توكيل/ملاحظة) تُكدَّس فوقها النماذج وتُرجع محدَّثة بعد الحفظ، `احسب مدة` (فترات جاهزة + السابق + الإجمالي + نسخ/طباعة/توكيل بهذه المدة)، كشف/توكيل بالمعاينة، تعديل/إلغاء بسبب، إعدادات التنفيذ، وتقرير الترحيل قبل/بعد |
| `js/ui/modal.js` | نوافذ مكدَّسة (`modalOpensOnTop`/`stackedModal`/`closeTopModal`/`closeAllModals`) وإغلاق يمسح الجذر فعليًا — إضافة لا تغيّر سلوك النوافذ القديمة |
| `css/execution.css` | أصناف الطبقة الجديدة (`.exec-numbers`, `.counter-grid`, `.account-table` بحالاتها, `.exec-log`/`.log-item`, `.exec-tabs`, `.record-tile`, `.alloc-preview`, `.finished-*`) + إصلاح تثبيت شريط الجوال (`.exec-toolbar.is-pinned-bottom`) + قواعد الطباعة |
| `js/app.js`, `sw.js` | تمرير ترحيل التنفيذ مرة واحدة في الإقلاع، واختصار `Ctrl+Shift+T` مع سطر في جدول الاختصارات؛ precache للملفات الأربعة الجديدة + `execution-schedule.js` مع `CACHE=…-v5.12.0-simple-execution` |
| `tools/node-tests/execution-simple-browser-tests.mjs` (جديد) | 19 فحص Chromium تقيس رحلات §16 بالنقرات الفعلية (S0–S8 + الشرح بنقرة + RTL/موبايل) وتكتب لقطات وتقرير JSON |
| `tools/node-tests/execution-feas-cycle-browser-tests.mjs` (جديد) | 19 فحص Chromium تقيس **دورة FEAS كاملة من الواجهة الجديدة**: إنشاء بخيارات متقدمة ← خطوة تالية ← التزام (تعديل لا تكرار) ← معاينة بلا كتابة ← اعتراف ← أرقام موحّدة ← تحصيل يُخصَّص ← حكم لاحق ← تسوية فروق واعتماد وتثبيت ← رفض تفعيل FEAS على ما فيه أرقام ← إعادة تحميل بلا شبكة |
| `tools/node-tests/execution-browser-tests.mjs` · `execution-feas-browser-tests.mjs` · `grid-browser-tests.mjs` | فحوص الواجهة الجديدة على **بيانات ابنية بالخدمة القديمة** (توافق 42,000/2,000/40,000 وتوكيل 9,000)، وسلوك FEAS (9,000/1,000/8,000 بلا مساس)، وتغطية `grid-browser` لترحيل الإقلاع المرة الواحدة: أول إقلاع يكتب صف meta واحدًا وسجل نشاط واحدًا فقط، والإقلاع الثاني **لا يكتب شيئًا** |
| `js/services/print-paginate.js` (جديد) | ترقيم الصفحات لكل مستندات التنفيذ: `PRINT_PAGE_STYLES` (@page A4 + تكرار الرؤوس + منع قطع الصفوف)، `PRINT_PAGINATOR_SCRIPT` (قياس فعلي داخل نافذة الطباعة، تقسيم الجداول صفًّا صفًّا، تقسيم النص الطويل عند الأسطر، تذييل «صفحة N من M»، سقف 2000 صف، وفشل آمن بـ`data-print-error`)، و`wrapForPrint` نصية بحتة وIdempotent |
| `js/services/execution-print.js` | الترقيم الموحّد في موضع واحد لكل المسارات (`openDocumentForPrint` + `printPoa` + `printBalanceStatement`) |
| `tools/node-tests/execution-print-browser-tests.mjs` (جديد) | فحص طباعة حقيقي: كشف 36 شهرًا وتوكيل 3 سنوات وكشف رصيد ⇒ مقارنة عدد الصفحات المُرقَّمة بعدد صفحات PDF فعلي من مسار Chromium + حفظ الملفات في `.cache` |
| `js/tests/execution-simple-tests.js` · `js/tests/execution-ui-tests.js` (جديدان) | 44 اختبارًا ذهبيًا للمحرك/الخدمة (+3 لبطاقة العرض) و**9** اختبارات واجهة (تكديس ورقة التسجيل، سلوك النوافذ، «صف السجل لا يفتح الإلغاء»، قاعدة منع الازدواج في التوكيل، أفق الاستحقاق) |

## نتائج التحقق
Node **458/458** · رحلات التنفيذ المبسّط في Chromium **19/19** · التنفيذ على بيانات قديمة **34/34** · FEAS+Offline **10/10** · قسم الطباعة **11/11** (كشف 2/2 وتوكيل 4/4 وكشف رصيد مطابق لصفحات PDF) · `grid-browser` كامل **38 فحصًا/0 خطأ وبلا أي فشل جديد مقابل `GRID_BASELINE=da2c024`** (الفشول الخمسة قديمة). **NOT VERIFIED:** نافذة المعاينة الأصلية/الطابعة الورقية، متصفحات غير Chromium، قارئ الشاشة، أداء بمئات الآلاف من السجلات.

# v5.11.0 — خريطة الملاحظات السريعة والحذف الآمن لمجمع التنفيذ

**2026-10-04 — إضافة تشغيلية فوق البنية القائمة، بلا نظام Notes/Tasks/References/Search/Sync موازٍ.** `caseNotes` هو المخزن canonical للملاحظات، و`quickNoteLinks` للروابط المعتمدة و`caseNoteDrafts` للمسودات المحلية. الترحيل v18 additive فقط؛ لا backfill ولا حذف أو تغيير للمعرفات القائمة.

| المسار | الدور والتكامل |
|---|---|
| `js/services/quick-notes.js` | خدمة الملاحظة: تطبيع عربي/أرقام، lifecycle والحالة الفعالة، Archive/Trash/Restore/Snooze/Reminder، روابط ذرية، cursor pagination، أجندة/Needs Action، تحويل idempotent إلى Work Center وترتيب يدوي متوافق مع الصفوف التاريخية |
| `js/modules/quick-notes.js`, `css/quick-notes.css` | شاشة RTL/Mobile-First، Quick Capture، الاقتراحات التي تحتاج اعتمادًا، عرض آمن عبر `textContent`، Inbox/Triage/Agenda وFAB |
| `js/db/schema.js` | توسيع `caseNotes` وفهارس الحالة/الأولوية/الموعد/التذكير، وإضافة مخزني الروابط والمسودات في v18 |
| `js/services/execution.js`, `js/modules/execution-center.js` | حذف منطقي ذري لمجمع التنفيذ والتوابع القابلة للحذف، حواجز الأثر المالي وسلة/استعادة انتقائية، أزرار التعديل والحذف |
| `js/services/search-engine.js`, `js/services/work-items.js`, `js/modules/file-page.js`, `js/modules/record-page.js` | استخدام البحث/مركز العمل/الملفات/السجلات القائمة، مع روابط سياقية approved only؛ لا نسخ لمحتوى الملاحظة إلى سجل آخر |
| `tools/node-tests/quick-notes-browser-tests.mjs` | فحص Chromium للالتقاط الآمن، الدورة، الترقيم، السحب، Command Center، السياق، RTL والموبايل |

**NOT VERIFIED:** Archive/Reminder/Agenda/Needs Action dedicated browser flows، الطباعة الفعلية، المتصفحات/الأجهزة غير Chromium، وبيانات الإنتاج. النقر على FAB الهاتف مغطى ضمن فحص Chromium العام. نتائج التشغيل التفصيلية في `TEST-REPORT.md`.

# v5.10.0 — خريطة تحديث واجهة مركز التنفيذ (شرح لكل خانة + مسار مرحلي + مثال قابل للزرع)

**2026-10-03 — تعليمي/تشغيلي بلا تغيير Schema أو مسارات أو خدمات قراءة-كتابة.** المطلوب: أن يفهم المستخدم ماذا يكتب في كل خانة وكيف يُحسب الرصيد، مع مثال عملي وبيانات تجريبية تبقى في التطبيق. `SCHEMA_VERSION=17` و`APP_VERSION=5.10.0` كما هما.

## الطبقات والملفات

`js/modules/execution-center.js` (الدليل والمثال والمسار) ← `js/ui/execution-forms.js` (شرح كل خانة) ← `js/services/execution-demo.js` (بيانات المثال) ← `css/execution.css` (أنماط الشرح والأقسام التعليمية) ← `sw.js` (precache).

| الملف | الدور |
|---|---|
| `js/modules/execution-center.js` | `GUIDE_STEPS` و`guideSectionMarkup` (دليل «ابدأ هنا» 6 مراحل: ماذا تسجل/ما الناتج/أي زر)، `EXAMPLE_ROWS` و`exampleSectionMarkup` (مثال 12×3,000 + 6×1,000 − 9,000 = 33,000 بمعادلة ①−②=③)، `pathSectionMarkup` (مسار البطاقة 6 مراحل مع ✓/○ وN من 6 وزر تسجيل مباشر)، أزرار `data-demo-seed-exec`/`data-demo-open` |
| `js/ui/execution-forms.js` | `field(label, html, hint, key)` تطبع `<small class="exec-hint">` تحت كل خانة — **115 استدعاءً كلها موصوفة**؛ شرح خانات جدول التوزيع داخل `.exec-alloc-row` (تحصيل + إعادة توزيع) وخانات إدراج التوكيل الثلاثة `.exec-include`؛ `showErrors` يعلّم `.has-error` على الخانة |
| `js/services/execution-demo.js` | `seedFamilyExecutionExample(office,id?)`: نموذج أسرة كامل معلَّم بـ〔تجريبي〕 إضافة-only idempotent (id ثابت `executionFamilyDemo`)، و`backdate()` يضبط `createdAt/updatedAt` تاريخيًا (حالة معرفة حتى 30/06/2025 = رصيد 9,000، توكيل 9,000+24,000=33,000) — نمط `demo-seed.js` نفسه |
| `js/services/execution-poa.js` | تفسير رفض إعادة التوكيل بلا فترة متبقية (يسمّي تاريخي نهاية التوكيل وبداية الاستحقاق)، وحراسة حفظ `toDate < fromDate` في المسار القديم (كما يرفضه FEAS) |
| `css/execution.css` | `.exec-steps/.exec-step`، `.exec-example/.exec-big-eq/.exec-eq-box`، `.exec-path/.exec-path-step(is-done)`، `.exec-hint` (بما فيها امتدادها تحت صفوف التوزيع واختيارات التوكيل)، `.exec-form-banner`، `.exec-field.has-error`، استجابة ≤640px |
| `sw.js` | إضافة `./js/services/execution-demo.js` إلى ASSETS فقط (الاسم `ahmad-khudair-law-office-v5.10.0-feas-offline` ثابت — نمط timeline.js) |
| `js/tests/execution-tests.js` | +3 اختبارات الزارع (بناء الأرقام الدقيقة، التوكيل عبر `balanceAsOf` وضع المعرفة، عدم التكرار) — الملف الآن **68 اختبارًا** |

## نتائج التحقق

Node **377/377**؛ Chromium تنفيذ **32/32** وFEAS **10/10**؛ `grid-browser` مع `GRID_BASELINE=b418f937` بلا إخفاق جديد (نفس الخمسة القديمة) بما فيها فحص SW/precache الكامل؛ تدقيق Chromium مؤقت على 22 نافذة: كل خانة عليها شرح وصفر خانة يتيمة. **NOT VERIFIED:** اعتماد قانوني، طابعة فعلية، متصفحات غير Chromium.

# v5.10.0 — خريطة محرك الأسرة FEAS · Schema 17

**2026-10-03 — محرك حساب أسري قابل للتدقيق وإعادة البناء، مع الاعتراف الصريح بالفترات.** العقد التفصيلي: [`docs/FEAS-AUDIT-DESIGN-DELTA.md`](docs/FEAS-AUDIT-DESIGN-DELTA.md). `APP_VERSION=5.10.0`, `SCHEMA_VERSION=17`, **56 مخزنًا و308 فهارس**. الترحيل v17 إضافي فقط: مخزنا الالتزام والفترة + فهارس المصدر ومنع الازدواج؛ لا backfill مالي ولا تحويل لسجلات v5.8 القديمة.

**القاعدة:** تظل التنفيذات القديمة على مسارها حتى يختار المكتب FEAS صراحةً. لا تاريخ افتراضي، ولا رسم/مدة/قاعدة قانونية مخمّنة. تعريف التزام أو شريحة قيمة أو توكيل لا ينشئ دينًا؛ الرصيد مشتق من لقطات الاعتراف التي حفظها المستخدم، وليس من حقل رصيد مخزّن.

## الطبقات والملفات

`js/modules/execution-center.js` (بطاقة FEAS) ← `js/ui/execution-forms.js` ← `js/services/execution-feas.js` + خدمات التنفيذ/الدفتر/التخصيص/الفروق/التوكيل الحالية ← `js/domain/execution-feas.js`, `execution-money.js`, `execution-calendar.js` ← Repository / Unit of Work ← مخازن IndexedDB الحالية.

| الملف | الدور |
|---|---|
| `js/domain/execution-calendar.js` | تواريخ مدنية، وحدات دورية وحدّها؛ بلا اعتماد على UTC/المنطقة كقاعدة استحقاق |
| `js/domain/execution-money.js` | تحويل عملات مسموح بها إلى وحدات صغرى، جمع آمن، رفض التقريب الصامت، وتناسب مضبوط |
| `js/domain/execution-feas.js` | حل شرائح المصدر، مفاتيح الاعتراف، حساب الرصيد من snapshots/deltas/التخصيصات، بصمة المراجعة، ورفض التكرار أو اختلاف العملة |
| `js/services/execution-feas.js` | تعريف الالتزامات، المعاينة، الاعتراف/الإغلاق، تسوية فروق مراجَعة، Snapshot POA، وفحص سلامة المصادر |
| `js/services/execution.js` | ربط FEAS بسلسلة الأحكام والشرائح الحالية، `executionBundle`, وإيقاف عرض الإجمالي عند تجاوز سقف القراءة أو خلل الحساب/فحص السلامة |
| `js/services/execution-ledger.js` | أحداث append-only، التحصيل والتخصيص، idempotency، غير المخصص/الائتمان والتصحيح الموثق، مع حد قراءة محافظ |
| `js/services/execution-differences.js` | فرق تفسيري بموافقة موثقة وبصمة أساس؛ فرق الحكم لا يُجمع فوق القيمة المعترف بها الجديدة ولا يتحول إلى أصل ثانٍ |
| `js/services/execution-poa.js` | إصدار POA Snapshot مستقلة، مصادر/مبالغ minor units، idempotency، ومنع تعديل لقطة FEAS بعد الإصدار |
| `js/services/execution-balance.js` | كشف الرصيد واللقطة التاريخية والتتبع؛ مسارات FEAS تستدعي فحص السلامة قبل إخراج الرصيد |
| `js/modules/execution-center.js` و`js/ui/execution-forms.js` | اختيار نموذج الحساب الصريح، التزام/اعتراف، حقل نوع قيمة بلا اختيار افتراضي في حكم FEAS، والتحقق قبل حفظ الشريحة؛ لا دورية واجهة مضللة |
| `js/db/schema.js`, `js/core/constants.js` | ترقية v17 والإصدار 5.10.0؛ 56 مخزنًا/308 فهارس، لا حذف أو إعادة كتابة للسجلات القائمة |
| `js/tests/execution-tests.js` · `tools/node-tests/execution-feas-browser-tests.mjs` | Golden/سلامة/ازدواج بوحدات Node، ومسار واجهة FEAS في Chromium |

## قواعد الرصيد والتكامل

- `execution.accountingModel === 'feas-v1'` فقط يفعّل FEAS؛ لا ترحيل تلقائي ولا خلط مع `legacy-v1`.
- فترة FEAS لا تدخل الرصيد إلا كسجل اعتراف محفوظ في `executionPeriods` بحالة `RECOGNIZED`/`CLOSED`، وبمبلغ minor units، نطاق مدني، عملة، بصمة، ومعرّفات شرائح وأحكام المصدر. المعاينة لا تحفظ دينًا، والاعتراف لا يعاد توليده تلقائيًا.
- الفرق المعتمد تفسير للتغير: يُحتسب على الفترة المعترف بها مرة واحدة، ولا يضاف فوق أصل جديد. تكرار دلتا لنفس فترة التسوية أو فساد المصدر يمنع عرض الأرقام الجزئية، ويظهر تنبيه.
- التحصيل والإيصال والتخصيص والدفتر كيانات منفصلة. تظهر المبالغ غير المخصصة والائتمان؛ المصروفات خارج أصل الاستحقاق. idempotency مفهرس على `executionLedger.idempotencyKey` و`executionReceipts.idempotencyKey`.
- إنشاء POA لا يكتب دفترًا أو التزامًا. Snapshot الإصدار تحفظ خطوطها ومصادرها؛ الحالة `CARRIED` لا تدخل الرصيد ولا تسمح بتعديل لقطة FEAS.
- تُعاد الاستفادة من Universal DataGrid وGlobal Search وWork Center وActivity Log وPrintContext وBackup/Restore وSync وOffline الموجودة؛ لا محرك/مخزن بديل ولا `getAll` عام، وكل قراءات دفتر FEAS محدودة بـ2000 صف لكل مجموعة ثم ترفض الحساب الجزئي.
- `sw.js` precache يشمل وحدات FEAS الجديدة في `ahmad-khudair-law-office-v5.10.0-feas-offline` حتى يظل مسار التنفيذ متاحًا بعد إعادة تحميل Offline.

## نتائج التحقق الفعلية وحدودها

Node **374/374 PASS**؛ FEAS Golden/Integrity ضمنها؛ فحص صياغة جميع ملفات JS/MJS ناجح؛ Chromium التنفيذ القديم **32/32** وFEAS **10/10** (بما فيه إقلاع بطاقة FEAS بعد إعادة تحميل Offline)؛ Offline/Backup/Restore/Sync Chromium **14/14**؛ اختبار Work Center على **305,000 سجل اصطناعي 8/8** و`getAll=0`؛ قياس FEAS اصطناعي عند حد **2000 لقطة** وفحص سلامة بلا أخطاء: **556.4ms** في fake-indexeddb/Node. التفاصيل والقيود في [`TEST-REPORT.md`](TEST-REPORT.md).

**NOT VERIFIED:** اعتماد قانوني أو قاعدة رسم/مدة، جهاز/متصفح فعلي غير Chromium، ومعاينة Print Preview/طابعة فعلية، بيانات مكتب إنتاجية، ملايين السجلات على أجهزة حقيقية. القياس المخبري اصطناعي وليس ضمانًا للأجهزة.

# v5.9.0 — خريطة المزامنة الآمنة والعمل Offline-First · Schema 16

**2026-10-03 — مزامنة يدوية مشفّرة فوق قاعدة المكتب الحالية.** العقد وخطوات الاستخدام والقيود: [`docs/SYNC-OFFLINE-FIRST.md`](docs/SYNC-OFFLINE-FIRST.md)؛ اختبارات التنفيذ وما لم يُتحقق منه: [`TEST-REPORT.md`](TEST-REPORT.md). `APP_VERSION=5.9.0`, `SCHEMA_VERSION=16`, **54 مخزنًا و284 فهرسًا**.

**المبدأ:** التطبيق يعمل محليًا بـIndexedDB؛ الاتصال اختياري. لا تبدأ المزامنة إلا بتأكيد المستخدم بعد مراجعة الملخص والتعارضات وBackup سابق للتطبيق. لا قاعدة/محرك/Activity Log ثانٍ، ولا Last Write Wins.

## الطبقات والملفات

`js/modules/sync.js` (المراجعة والتأكيد) ← `js/services/sync-engine.js` (دفعات وتعارضات وقراءة/كتابة) ← `SyncTransportAdapter` / `js/services/sync-transport.js` (ملف يدوي) ← `js/db/database-context.js` + Storage Adapter/Repository ← مخازن IndexedDB الحالية.

| الملف | الدور |
|---|---|
| `js/core/device-id.js` | Device ID ثابت محليًا |
| `js/core/network-status.js` | حالة الاتصال فقط؛ لا تطلق عملية مزامنة |
| `js/core/online-capabilities.js` | تعريف القدرات المحلية ومزايا الإنترنت الاختيارية |
| `js/db/database-context.js` | إضافة Change ID/تسلسل إلى عمليات الكتابة في المعاملة نفسها؛ tombstone للحذف |
| `js/services/sync-engine.js` | خط أساس تاريخي عند الموافقة، تغيير صادر/وارد، batching، vectors، preview، تعارض وحسم وتاريخ |
| `js/services/sync-crypto.js` | حزمة نقل `AES-256-GCM`، اشتقاق `PBKDF2-HMAC-SHA-256` ×310,000، ملح/IV عشوائيان؛ لا تخزين لكلمة المرور |
| `js/services/sync-transport.js` | واجهة `SyncTransportAdapter` الحالية لملفات JSON مشفّرة؛ رفض sync plaintext، وتصدير/استيراد يدوي |
| `js/modules/sync.js` + `css/sync.css` | واجهة حالة الاتصال/المزامنة، مراجعة الملخص والتعارض، كلمة المرور، الموافقة/الإلغاء والسجل |
| `js/tests/sync-tests.js` · `tools/node-tests/offline-sync-browser-tests.mjs` | تغطية Node/`tests.html` وتدفق Chromium فعلي Offline/Sync/Encryption |
| `docs/SYNC-OFFLINE-FIRST.md` | دليل النقل اليدوي والتحذيرات والحدود |

## المخازن والترقية (v16)

- أربع مخازن في قاعدة المكتب نفسها: `syncChanges` سجل append-only للتغييرات/التجميع (8 فهارس)، `syncState` لحالة الجهاز/الخط الأساس، `syncConflicts` للاحتفاظ بالقيمتين وقرار المستخدم (7 فهارس)، `syncPeers` لحالة النظير (فهرسان). **17 فهرسًا جديدًا**؛ لا قاعدة بيانات جديدة.
- `SCHEMA_MIGRATIONS` v16 إضافية غير هدامة من v15؛ يبقى ترحيل v15 ومخازن البيانات كما هي. لا تنشأ baseline أو تغييرات تاريخية قبل التأكيد؛ المعالجة على دفعات ومؤشرات قابلة للاستئناف.
- `DatabaseContext` يعيد استخدام Activity Log وStorage Adapter الموجودين. `applied` يميز رؤوس الحالة المطبقة لمنع تعارض وارد غير معتمد من استبدال أحدث قيمة محلية. السجلات/التعارضات المحسومة تبقى للتدقيق.

## نقاط التكامل والحدود

- `js/app.js`, `js/ui/nav-model.js`, `index.html`: صفحة «المزامنة» وشارة الشبكة؛ `js/services/backup.js` ينشئ Backup الحالي قبل تطبيق الدفعة. لا حدث `online` يبدأ النقل.
- `sw.js`: الكاش `ahmad-khudair-law-office-v5.9.0-sync-secure` يحوي Application Shell و131 وحدة JS/19 CSS وأصول التطبيق الثابتة، لا بيانات IndexedDB؛ يضيف وحدة التشفير ضمن الأصول.
- الملف الوارد محدود بـ12 MiB؛ الدفعات بحد أقصى 500 تغيير أو 6 MiB تقريبًا وواجهة `hasMore` لمتابعتها. لا خادم أو Google Drive أو نقل حي في الإصدار الحالي.
- النقل AES-256-GCM؛ نسخة Backup الحالية JSON غير مشفّرة، وتعرض الواجهة هذا القيد. لا يُخزن التطبيق كلمة المرور.

## نتائج التحقق

Node **370/370**؛ اختبار Offline/Sync Chromium **PASS** (إقلاع Offline، البحث، Backup/Restore، عدم التلقائية، موافقة/إلغاء، Backup قبل baseline، حزمة مشفرة من 500 تغيير ودفعة تالية)؛ `grid-browser` لا إخفاقات جديدة مقارنة بالأساس `2e167cce` مع خمسة إخفاقات أقدم معلومة؛ `execution-browser` **32/32**. اختبار التثبيت على جهاز فعلي والطباعة الورقية ومتصفح غير Chromium **NOT VERIFIED**. التفاصيل: [`TEST-REPORT.md`](TEST-REPORT.md).

# v5.8.0 — خريطة قسم التنفيذ (Execution) · Schema 15

**2026-10-01 — قسم تنفيذ فوق بيانات المكتب القائمة (التنفيذ المدني والجزائي والأسرة).** العقد والتفصيل والقرارات وما لم يُتحقق منه: [`docs/EXECUTION.md`](docs/EXECUTION.md). `APP_VERSION=5.8.0`, `SCHEMA_VERSION=15`, **50 مخزنًا و267 فهرسًا**.

**المبدأ:** كل رقم مالي مشتق من سجل بمصدره ومعادلته؛ لا حقل رصيد يُحرَّر يدويًا؛ الفترات تُبنى عند الطلب؛ الدفتر Append-Only؛ التنبيهات تنظيمية لا قانونية.

## الطبقات والملفات

`js/modules/execution-center.js` (صفحة + بطاقة) ← `js/ui/execution-forms.js` (نوافذ الإجراءات) ← `js/services/execution*.js` (أوامر وقراءات مقيّدة بالمؤشرات) ← `js/domain/execution.js` + `js/domain/entitlement-engine.js` (منطق نقي) ← Repository ← IndexedDB.

| الملف | الدور |
|---|---|
| `js/domain/execution.js` | القوائم المرجعية (نوع التنفيذ/الدورية/القيمة/الدفتر/الحالات/طرق التخصيص/حالات الفروق/أنواع التوكيل/أنواع الإجراءات/سياسات التناسب)، أدوات العملة والتواريخ، معادلات الفترات، المدققات، `EXECUTION_LIMITS` |
| `js/domain/entitlement-engine.js` | الشرائح المرشحة، بناء الفترات، `balanceAsOf`/`balanceSummary` (وضعا المعرفة/الأثر)، `outstandingPeriods`، `allocationPlan`، `analyticalAllocation`، `balanceTrace`، `analyzeSliceImpact`، `simulateValueChange`، `executionAlerts` |
| `js/services/execution.js` | التنفيذات/الأطراف/الأحكام/الشرائح/الإجراءات + `executionBundle`/`summarizeExecution`/`executionListRow`/`hydrateExecutionRows`/`listExecutionRows`/`executionCenterStats`/`refreshExecutionSearchText`/`createResultFile` |
| `js/services/execution-ledger.js` | القيود والمصروفات والعكس والتصحيح والتحصيل وإعادة التخصيص و`allocationContext`/`ledgerBreakdown` |
| `js/services/execution-differences.js` | أثر الشريحة، التسويات (`createSettlement`→`decideSettlement`→`postSettlement`)، `settlementReview`، `recomputeSettlement` |
| `js/services/execution-poa.js` | مسودة التوكيل بمصادر كل مبلغ، الحفظ، إعادة التوكيل، `poaDetail`، ترقيم `POA-YYYY-NNNN` |
| `js/services/execution-balance.js` | الرصيد وشجرة التتبع، اللقطة التاريخية، مقارنة حكمين، المحاكي، الخط الزمني، التنبيهات، صفوف المؤشرات |
| `js/services/execution-print.js` | قوالب `executionTemplates` (توكيل/كشف رصيد) وبناء المستند والطباعة على مسار الطباعة القائم |
| `js/services/execution-migration.js` | ترحيل v15 غير المدمر + تقرير المراجعة |
| `js/modules/execution-center.js` | `executionCenterPage/bindExecutionCenter`, `executionDetailPage/bindExecutionDetail`, `EXECUTION_LIST_COLUMNS` |
| `js/ui/execution-forms.js` | 15 نافذة إجراء (تنفيذ/طرف/حكم/شريحة/تحصيل/مصروف/عكس/إعادة تخصيص/تسوية/توكيل/إجراء/لقطة/محاكي/مقارنة/طباعة) |
| `css/execution.css` | أنماط `.exec-*` على متغيرات الثيم القائمة |
| `js/tests/execution-tests.js` · `tools/node-tests/execution-browser-tests.mjs` | 61 اختبارًا (Node + `tests.html`) · 32 فحصًا في Chromium حقيقي |

## المخازن والترحيل (v15)

- مخازن جديدة: `executionParties`, `executionValuePeriods` (شرائح القيمة), `executionLedger`, `executionAllocations`, `executionReceipts`, `executionActions`, `executionPOAs`, `differenceRecords`, `executionSettlements`, `executionAdjustments`, `executionTemplates`.
- حقول مضافة على القائم: `execution` (نوع/جهة/رقم رسمي/حتى تاريخ الاستحقاق/سياسة التناسب/تاريخ المراجعة/`needsReview`/`searchTextNormalized`/`sequence`) و`judgments` (سلسلة: `executionId`, `sequence`, `judgmentKind`, `previousJudgmentId`, `effectiveFrom/To`).
- `SCHEMA_MIGRATIONS` v15 و`migrationPlan(from,to)`: **إضافي فقط** (`destructive:false`, `backfill:false`)، ولا اختراع تواريخ: الناقص يُعلَّم للمراجعة بالعربية مع سبب، بعلامة `execution-migration-v1` وسقف 20,000 صفًا وidempotent.
- لا صفوف فترات مخزّنة: `buildEntitlementPeriods` تبنيها عند الطلب بمفتاح `نوع::YYYY-MM-DD`.

## نقاط التكامل مع بقية التطبيق

- `js/app.js`: `PAGES.executionCenter` + مسار البطاقة `exc:<id>` (store التمييز `executionCenter`)، و`store:'executionCenter'` للبطاقة.
- `js/ui/nav-model.js`: مسار `executionCenter` («مركز التنفيذ») بجانب سجل التنفيذ العام (28 مسارًا).
- `js/domain/entities.js`: حقول `execution` وثمانية كيانات تنفيذ للنموذج الموحّد؛ `js/services/entity-save.js`: حالات المخازن الجديدة (المالية منها ترفض التعديل المباشر برسالة عربية).
- `js/services/search-engine.js`: مصادر التنفيذ الستة و`FAST_INDEXES`؛ `js/services/entity-query.js`: `rowText`؛ فهرس `execution.searchTextNormalized`.
- `js/services/maintenance.js`: `migrateExecutionData` ← `report.execution`؛ `js/services/integrity.js`: الحقول الدنيا وقواعد العلاقات لمخازن التنفيذ؛ `js/services/backup.js`: يغطيها تلقائيًا عبر `STORES`.
- `js/modules/quick-add.js`: إضافة تنفيذ سريعة؛ `sw.js`: precache لكل ملفات التنفيذ + `css/execution.css` بذاكرة `v5.8.0-execution`؛ `index.html`: ملف الأنماط.

## قواعد للتطوير اللاحق

- لا تكتب من الواجهة مباشرة: كل تعديل يمر بخدمة تطبيقية وبمعاملة واحدة وسجل نشاط بلا بيانات شخصية خام في `metadata`.
- لا تُعدَّل شريحة أو حركة تاريخية: الجديد شريحة/عكس/تصحيح مرتبط بالأصل.
- لا تجمع القيمة الجديدة على القديمة (لا ازدواج)؛ ولا تفترض FIFO قاعدة قانونية.
- الفترات لا تُخزَّن ولا تُنشأ مسبقًا؛ أي رقم جديد يحتاج `equation` ومصدرًا ظاهرًا.

# v5.7.0 — خريطة مركز العمل (Work Center / Command Center) · Schema 14

**2026-10-01 — طبقة تشغيل فوق بيانات المكتب الموجودة (`actionCenter`).** العقد التفصيلي وقرارات التصميم والقياسات وما لم يُتحقق منه: [`docs/WORK-CENTER.md`](docs/WORK-CENTER.md). `APP_VERSION=5.7.0`, `SCHEMA_VERSION=14`.

**المبدأ:** عنصر العمل (Work Item) إما صف مستقل (مهمة) أو **إسقاط** لسجل أصلي (جلسة/عمل إداري/موعد/متابعة اتصال/خطوة الملف التالية). لا تُنسخ أي بيانات قانونية؛ العرض يربط وقت القراءة. حذف أو أرشفة المصدر لا يحذف عنصر العمل («المصدر غير متاح حاليًا»).

## الطبقات والملفات

`js/modules/work-center.js` (الصفحة) ← `js/ui/work-*.js` (عرض) ← `js/services/work-*.js` (أوامر/استعلام/استنتاج) ← `js/domain/work-*.js` (نقي) ← Repository ← IndexedDB.

| الملف | الدور |
|---|---|
| `js/domain/work-items.js` | نقي: الحالات والأولويات والنطاقات والعروض، `sortKey`، ربع أيزنهاور، مُوسِّع التكرار، مدققات الإدخال، `canActOn` (مقعد الصلاحيات)، `overlayId`/`parseOverlayId`، `dayPartOf` |
| `js/domain/work-sources.js` | محوّلات المصادر (hearings, procedures, appointments, communications, files, serviceRecords)، `registerWorkSource`، بناة النماذج `buildProjectedItem/buildNativeItem/buildOrphanItem`، `itemPassesFilters` |
| `js/services/work-config.js` | إعدادات/حالة/عروض محفوظة عبر `prefs` الموجودة (`ui:workcenter-config|state|views`)؛ `getWorkConfig()` يدمج الحالات المخصصة من لقطة Lookups |
| `js/services/work-statuses.js` | الحالات المخصصة عبر **Lookups** (`workItemStatus`): لقطة بالذاكرة `ensureWorkStatuses`، `createCustomStatus/renameCustomStatus/removeCustomStatus`، تُبطَل عند `entity:changed`/`db:switched`/`db:restored` |
| `js/services/work-items.js` | كل الأوامر (حفظ، إنجاز، تأجيل، إعادة جدولة، حالة، أولوية، تثبيت، وسوم، أرشفة/استعادة، حذف منطقي/تراجع، تعليقات، تكرار، `bulkApply`) بمعاملة واحدة وكتابة عبر `saveOperational` |
| `js/services/work-query.js` | محرك الاستعلام: مجاري بفهارس + دمج k-way + مؤشر `wc1:`، `queryWorkItems/getWorkItem/countWorkItems/workSummary/searchScope/nowAndNext` |
| `js/services/work-insights.js` | `ATTENTION_RULES`، الاقتراحات، المراجعة اليومية/الأسبوعية، الإنتاجية، الملفات الراكدة |
| `js/ui/work-card.js` `work-actions.js` `work-drawer.js` `work-views.js` `work-grid.js` `work-panels.js` `work-links.js` | البطاقة، ورقة الإجراءات والنماذج، المجلّد، العروض الأحد عشر، قائمة DataGrid، المراجعات/الإعدادات/الإنتاجية، لوحة «المهام المرتبطة» في صفحات السجلات |
| `css/work-center.css` | أنماط `.wc-*` (جوال أولًا ثم أعمدة على الشاشات الواسعة) |
| `js/tests/work-center-tests.js` | 70 اختبارًا (Node + `tests.html`) |
| `tools/node-tests/work-center-browser-tests.mjs` | Chromium حقيقي: `WC_BROWSER_SCENARIO=functional|mobile|perf|offline|all`، و`WC_PERF_SCALE` لتكبير بذرة الأداء |

حُذف وحل محله: `js/modules/action-center.js`, `js/services/action-center.js` (وكانا يخصان صفحة القوائم الخمس القديمة؛ ما ورد عنهما أدناه في v2.7.0 تاريخي).

## المخازن والترحيل (v14)

- `workItems` — صف لكل مهمة مستقلة (`kind:'native'`, `sourceType:'task'`, `id=uid()`) أو لكل **طبقة** فوق سجل أصلي (`kind:'overlay'`)؛ 18 فهرسًا (`kind`, `dueDate`, `status`, `completedAt`, `pinnedAt`, `archivedAt`, `sourceType`, `sourceId`, `fileId`, `caseId`, `clientId`, `relatedId`, `recurrenceId`, `createdAt`, `updatedAt` + `kind_dueDate`, `recurrenceId_occurrenceDate`, `status_dueDate`).
- `workItemComments` (3 فهارس) و`workItemRecurrences` (4 فهارس).
- الطبقة تحمل فقط ما لا يملكه السجل الأصلي: تثبيت، وسوم، حالة تشغيلية، تجاوز أولوية، عدّاد التأجيل والموعد الأصلي، الإنجاز/الإلغاء/الأرشفة. **استثناء مقصود من قاعدة `uid()`:** معرّفها حتمي `"<sourceType>::<sourceId>"` (يمنع سباق إنشاء طبقتين لمصدر واحد، ويتحقق منه `deepHealth`).
- الترحيل الرسمي: `SCHEMA_MIGRATIONS` + `migrationPlan(from,to)` في `js/db/schema.js`؛ **إضافي فقط** (مخازن وفهارس عبر `upgradeSchema`)، `destructive:false`, `backfill:false`. النسخ الاحتياطية v13 القديمة تُقبل. `repair.js` لا يمس المخازن الجديدة عمدًا.

## نقاط التكامل مع بقية التطبيق

- `js/app.js`: `PAGES.actionCenter` ← `workCenterPage/bindWorkCenter`؛ المسار الثابت `rec:workItems:ID` يفتح مجلّد العنصر؛ شارة الشريط (`scheduleWorkBadge`)؛ مرجع الاختصارات؛ `resetViewState` يمسح `__wc`.
- `js/domain/entities.js`: `ENTITIES.workItems` (للنموذج الموحّد `openEntityForm`)؛ `js/ui/form.js`: حقول `newOnly` وتبديل خيارات الأولوية/الحالة من إعدادات المستخدم وإشعار «إنشاء مهمة متابعة» بعد نتيجة/تأجيل جلسة.
- `js/services/entity-save.js`: `case 'workItems'`؛ `js/services/operations.js`: خياران `extraStores`/`withinTransaction`؛ `js/db/repository.js`: `getManyRaw` و`byIndexRaw` (قراءتان تشملان المحذوف منطقيًا: للطبقات ولقيم القوائم المتقاعدة).
- `js/domain/lookup-defaults.js`: أربع فئات `workItemType/workItemTag/workItemPostponeReason/workItemStatus` وخطاف تحقق اختياري `check` لكل فئة؛ `js/services/lookups.js`: `saveLookupValue` يستدعي الخطاف ويمسح ذاكرته عند `db:restored`؛ `js/modules/databases.js`: يعلن `db:restored` بعد الاستعادة فوق القاعدة الحالية.
- `js/services/search-engine.js`: مصدر `workItems` (المهام المستقلة فقط، `routeOf` → `actionCenter?item=ID`) — **لا محرك بحث ثانٍ**.
- `js/services/integrity.js`: قواعد علاقات ومدقّق `work-item-invalid`؛ `js/services/grid-relations.js`: `workItems` ضمن `hasLegalFileColumns` (أعمدة الملف/الموكل/الخصم المركزية في قائمة DataGrid).
- `js/ui/palette.js`: أوامر مركز العمل و«+ مهمة مرتبطة بالصفحة الحالية» و«ترحيل أعمال اليوم» (بتأكيد).
- `js/modules/record-page.js`, `file-page.js`, `home.js`: أزرار «+ مهمة» ولوحات «المهام المرتبطة» والشارة.
- `sw.js`: الأصول الجديدة في precache وذاكرة `ahmad-khudair-law-office-v5.7.0-work-center2`؛ `index.html`: `css/work-center.css`.
- `css/pro.css` و`css/ui.css`: إصلاح أيقونة زر لوحة الأوامر `#command-btn` في الشريط العلوي (كانت `svg` بلا حجم: 137px عند 1280 و0 بين 901 و1200)؛ حذف بقايا `font-size:0` و`::after` 🔍 القديمة.

## قواعد للتطوير اللاحق

- لا تنسخ اسمًا/رقمًا/محكمة إلى `workItems`؛ خزّن معرّفات فقط (والعنوان المشتق يُحسب عند العرض).
- أي كتابة عبر `work-items.js` (معاملة واحدة)؛ لا `put` مباشر من الواجهة؛ لا بيانات شخصية خام في `metadata`.
- لا `getAll` ولا «تحميل الكل ثم التصفية»: استعلام مفهرس + مؤشر + سقف + إلغاء. تبديل العرض لا يعيد الجلب (`rt.cache`)، وأي تغيّر بيانات يمسحها (`rt.reload()` الافتراضي).
- مصدر جديد = `registerWorkSource`؛ قاعدة تنبيه = عنصر في `ATTENTION_RULES`؛ حالات/ألوان/تسميات من إعدادات مركز العمل (prefs)، والأنواع/الوسوم/أسباب التأجيل من Lookups.
- لا حاسبات مواعيد قانونية، ولا خدمات خارجية، ولا `location.reload()`.

---

# v5.6.0 — تحديث مستقل للجداول: أعمدة الملف / الأطراف وPrintContext

**2026-10-01 — Universal DataGrid الموجود فقط؛ بلا تغيير Schema 13 أو البطاقات أو نظام التخصيص العام.** عقد التطوير والتغطية وإعادة تشغيل الاختبارات: [`docs/DATAGRID-CONTEXT.md`](docs/DATAGRID-CONTEXT.md).

- `js/core/file-number.js` — أُضيف `formatLegalFile()` لعرض **الرقم الداخلي / النوع فقط**، دون عنوان حر أو موكل، مع بقاء `formatOfficialNumber()` مستقلًا للأرقام القضائية الرسمية.
- `js/ui/grid-columns.js` — `legalFileColumns()` المصدر المركزي لأعمدة `legalFile/client/opponent` الحقيقية؛ عقد عام `items/references/referenceLabel/compactLimit/contextRole/contextSide/printOmitWhenContext`. `gridPreferenceKey()` يمنع تكرار namespace ويحفظ المفاتيح القديمة. المراجع المشتقة `index:false` حتى لا يوصف فرز ID على أنه فرز عالمي للأسماء.
- `js/services/grid-relations.js` **(جديد)** — Read adapter فقط، يضم `hydrate/items/references/loadFilterLabels/resolvePrintContext`؛ نماذج WeakMap دون تعديل السجلات. يحل `fileParties` وكل الأطراف غير المحذوفة والأدوار/غير النشطين والروابط التاريخية وملكية `clientFiles` والروابط عبر القضية/دفعات الأتعاب وسجل النشاط ذي `entityType/entityId` فقط. أدلة الأشخاص تجمع ملفاتهم. `gridPageContext()` و`constrainedReferenceId()` يستندان إلى IDs، وOR محافظ؛ لا استنتاج سياق من اسم ظاهر أو صف وحيد؛ الاستنتاج من الفلتر يتحقق أيضًا من هوية كل صف مطبوع بعد hydration جديد، بما فيه التحديد خارج الفلتر وتغير عضوية الأطراف.
- `js/core/grid-print-context.js` **(جديد)** — `createPrintContext/describeGridFilters/printColumns`؛ العميل/الملف/الرقم القضائي/العنوان/الفلاتر/التاريخ منفصلة عن صفوف العرض. إزالة عمود الموكل من الطباعة فقط عند تطابق كل قيمه بالهوية والاسم مع الترويسة؛ لا فقد لموكل إضافي ولا حذف نصوص يدوية ولا جدول بلا أعمدة.
- `js/ui/datagrid.js` — نفس `mountGrid()`؛ أسماء مضغوطة ثم `+N` وتفاصيل كاملة آمنة قابلة للكيبورد، وفلاتر مرجعية بهويات حقيقية، مع بقاء البحث والفرز والتخصيص والمشاهد والتصدير. مسار مركزي لجميع أزرار/API الطباعة وWord: لقطة query/rows/columns/widths/date قبل انتظار القراءة، popup خلال gesture، fail-closed، ترويسة RTL باسم المكتب خارج الجدول، عناوين `thead` متكررة، والتصدير/الطباعة العادية للصفحة الحالية فقط عند provider، بينما طباعة المحدد تحفظ الاختيار عبر الصفحات وتصف فلاتر العرض دون إعادة تطبيقها. واجهات `getGridId/getVisibleColumns/applyReferenceFilter/clearFilter/print/getPrintContext/getPrintDocument`، وتوافق `docHtml()` المتزامن بلا محلّل.
- `js/core/grid-query.js` — شروط الهوية `valueType:'reference'` مستقلة عن facets `setValueType:'reference'`؛ محفوظة في الاستعلام/المشاهد، ولا تختلط شروط الاسم بالهوية.
- `js/db/repository.js`, `js/db/grid-data-provider.js`, `js/services/entity-query.js` — bookmarks اختيارية لكل صف ودفعات تحضير 100 سجل قبل المطابقة/الحد، استئناف بعد آخر صف مدرج لا نهاية الدفعة، تقارير تحضير محدودة، وإلغاء الطلبات القديمة. لا getAll عالمي جديد ولا فهارس أو مخطط جديد؛ نطاق التاريخ المفهرس يحترم اتجاه ASC/DESC، والفرز المشتق البعيد معلن كفرز الصفحة.
- مواضع الربط: `list-page.js` و`sectionGrid()`؛ `client-file.js`؛ `file-page.js` بما فيه العلاقة بالملف الآخر والنشاط؛ `record-page.js` بمفاتيح نشاط حسب نوع الأب؛ `service-records.js`؛ أجندة `home.js`؛ `reports.js`؛ مجموعات `search.js` المرتبطة بالملفات (نفس DataGrid، `grid:search:<store>`، route/تمييز/فترة/حراسة generation، وكشف مؤقت للصف المطوي عند التنقل بالأسهم دون تغيير التفضيلات)؛ وسجل التدقيق `integrity.js` الذي أعيد استخدام DataGrid فيه بدل جدول HTML يدوي. الطبيب/خطة الإصلاح/معاينة المظهر والجداول غير المرتبطة لا تُعطى أعمدة أطراف؛ الإحصاءات رسوم ومجاميع غير معدّلة.
- `css/workbench.css` — أنماط scoped داخل `.dg` للأسماء المضغوطة والتفاصيل والتجاوب، وتركيز صفوف شبكة البحث. ارتفاع ثابت للصفوف الافتراضية، ومنع virtualization للكثافة الجوالة متغيرة الارتفاع.
- `sw.js` — كاش `ahmad-khudair-law-office-v5.6.0-grid-context3`، مع التخزين المسبق للوحدتين التشغيليتين الجديدتين وتبعية `js/services/timeline.js` الموجودة التي أثبت فحص Offline غيابها؛ لا تغيير في منطق/واجهة الخط الزمني.
- `js/tests/grid-context-tests.js` **(جديد، 32 اختبارًا)** — مصادر أصلية/Many-to-Many/أسماء متشابهة/هويات/عرض/تصدير/طباعة/مشاهد/provider/سلامة كل المخازن. مسجل في مشغّل Node و`tests.html`. إصلاح reporter فقط إذا حذفت الاختبارات القديمة جسم الصفحة.
- `tools/node-tests/grid-browser-tests.mjs` **(جديد)** — Chromium حقيقي، سياقات/قواعد اصطناعية مستقلة، فحص مسارات التطبيق وأزراره ونوافذ الطباعة الأصلية وPDF متعدد الصفحات ومقارنة خط الأساس بواسطة `git show` دون تبديل الفرع. التحديد/فرز نطاق التاريخ يستخدمان أزرار القائمة وprovider الحقيقي على fixture مستقل ذي 230 سجلًا. سياق آخر يسمح بـService Workers، يفحص الرسم المحلي للاستيرادات ومطابقة الكاش وتنظيفه وreload دون اتصال ووثائق السياق؛ snapshots خام قبل/بعد، مع استثناء حقل lastRunAt السابق فقط عبر boot. `GRID_BROWSER_SCENARIO=offline` يشغّل الفحوص الأربعة وحدها. تبعيات المتصفح وPDF أدوات تطوير فقط. `.cache/grid-browser` مستبعد من Git وrelease audit. النتائج: Node **226/226**؛ اختبارات السياق الجديدة في Chromium **32/32**؛ مجموعة المتصفح كلها **221/226** مقابل خط الأساس **189/194** بنفس الإخفاقات الخمسة السابقة؛ **36** تحققًا متصفحيًا (6 إضافية لأزرار التحديد/الفترة/الاستمرار و4 لـPWA/Offline)؛ كاش 121 أصلًا يغطي رسم 99 وحدة تطبيق؛ PDF **26 صفحة / 720 صفًا**، والترويسة السياقية أول صفحة فقط. انظر `TEST-REPORT.md`.

**NOT VERIFIED — Print Preview/Physical Print Not Tested** — نوافذ HTML وPDF الآلي لا تثبت معاينة الطباعة الأصلية أو إخراج الطابعة.

# v5.6.0 — خريطة نظام التخصيص الكامل والمستقل لكل عنصر (Universal Component Styles)

- `js/core/component-style.js` (جديد) — **النواة المركزية**: مفتاح `ui:component-styles` عبر `prefs` الموجود، حالة `{version,components:{[id]:{type,pageId,style,updatedAt}},typeDefaults,global}`. ثوابت: `COMPONENT_TYPES` (card/section/stage/page/panel/grid/component)، `TEXT_ROLES` (15 نوع نص) + تسمياتها وعيناتها، `ROLE_PROPS` (fs,color,fw,lh,ls,align,tt,td,op,ff)، `ROLE_BOX_EXTRAS` (legalNumber/badge/status تملك bg,bc,bw,br,pad — البند 17)، `STYLE_LIMITS` (حدود آمنة: قاعدة 11–28، أدوار 9–42، lh .9–2.6، op .25–1، radius 0–40، padding 0–48…)، `SHADOWS/FONT_FAMILIES/BORDER_STYLES` + تسميات عربية. تطبيع `sanitizeStyle/sanitizeBase/sanitizeBox/sanitizeRole` (hex فقط، quantize+clamp، **null صريح = علامة مسح الخاصية** تمر للدمج). الدمج `mergePatch` (لكل خاصية؛ الفارغ يُحذف). السلسلة `styleLevels(id,{type,pageId})` → [element, typeDefault, page (تُتخطى للصفحات), global] و`resolveComponentStyle` (دمج لكل خاصية على حدة) و`resolveStyleSources` («موروث من…»). الكتّاب: `set/get/clearComponentStyle`, `clearComponentStyleProp(path)`, `set/clear/getTypeDefault`, `set/clear/getGlobalStyle`. النسخ: `copyComponentStyle` (الفعّال المحلول)، `getStyleClipboard`, `applyStyleToComponentIds(ids,style,{replace})` — تُستدعى فقط بأمر صريح. السجل `noteComponent/knownComponents` (لأوامر «تطبيق على…»). الاستعادة: `resetComponentStyle`, `resetPageComponentStyles(pageId,{includeElements})`, `resetUniversalDefaults` (عام+أنواع، تُبقي Overrides العناصر), `resetAllComponentOverrides` (عكسه). `getComponentStyleState/getStyleCounts`. الترجمة `computeStyleApplication(style,{type})` → `{vars(--uxc-<role>-<prop>, --cd-fs/--cd-lbl, --uxc-pad, --cd-gap*, --uxc-accent), tokens(data-uxc-has), inline(خلفية color-mix/حدود/حواف/ظل/هوامش/…)}`. التطبيق `applyComponentStyle(el,id,{type,pageId,cardKey,styleOverride})` — متغيرات على العنصر، صندوق على العنصر (وللمرحلة على زرّها المرئي)، تنظيف المتغيرات القديمة WeakMap، **المقياس الأساسي دائمًا**: حر `fontSize/15.5` أو درجات النظام القديم `PRESET_SCALE{sm:.9,md:1,lg:1.13,xl:1.27}×resolveCardDisplay/resolvePageDisplay` → `--cd-fs/--cd-lbl`. `applyStyleVars` (نصوص فقط للمعاينات)، `applyAllComponentStyles(root)` (كل `[data-uxc-id]` عدا `.uxc-preview`)، `resolveBaseScale`. اختبارات: `_reloadComponentStylesForTests` (محاكاة إعادة الفتح بلا مسح)، `_resetComponentStylesForTests`.
- `js/ui/component-customizer.js` (جديد) — **اللوحة العالمية والاكتشاف**: `registerCustomizableComponent({id,type,title,pageId,selector,gear})` (أي مكوّن مستقبلي بلا نظام ثانٍ)، `getRegisteredComponent`. `openComponentCustomizer({scope:element|type|global,…})` → modal بأربعة تبويبات (أساسي/النصوص/متقدم/إجراءات) + معاينة حيّة `[data-uxc-role]` داخل `.uxc-preview` + رقائق id/type + شارات «موروث من» + ↺ لكل خاصية. أساسي يضم **إعدادات العرض الخشنة الموجودة** (كثافة/نمط حقول/ثانوية/حدود عبر `setCardDisplay/setPageDisplay` + تطبيق ديناميكي) إلى جانب التحكم الحر. إجراءات: إعادة العنصر على خطوتَي تأكيد (4 ثوانٍ)، إعادة الصفحة/العام بـ`confirmBox`، نسخ/لصق (تأكيد+استبدال/دمج)، «تطبيق على…» (بحث + تحديد سريع نوع/صفحة/كل الصفحات/لا شيء + checkboxes من `knownComponents` عدا الحالي + تأكيد بالعدد)، «حفظ كافتراضي» للنوع/العام (يعطّل+toast إذا لا تخصيص). `commit()` → حفظ حسب النطاق → `refreshApplied` (العنصر الحي + `applyAllComponentStyles` + المعاينة + مزامنة العناصر) — debounced 120–250ms للـinput وflush عند change. `bindCustomizableComponents(root)`: (1) `.ux-card[data-display-key]`→`card:<key>`، (2) `[data-section-id]` غير البطاقة→`section:<pageId>:<secId>` + حقن ⚙ (في `.panel-head`/`summary` إن انتمت، وإلا عائم)، (3) كل `[data-uxc-id]` موسوم/مسجّل (+الجذر نفسه — جذر الصفحة)، idempotent عبر seen/`.uxc-gear`. `applyUniversalStyles(root,pageId)` (نقطة دخول app.js): توسم الجذر `data-uxc-page` + `page:<id>` + `noteComponent` ثم الربط. `openCustomizerForElement(el,trigger)` (اشتقاق id من `data-uxc-id` أو displayKey)، `openGlobalStyleCustomizer`, `openTypeDefaultCustomizer(type)`, `closeComponentCustomizer`.
- `css/component-style.css` (جديد) — قواعد الأدوار **مبوّبة**: `[data-uxc-has~="ROLE.PROP"]` قبل كل selector (لكل selector في القوائم) فلا يُمس عنصر بلا تخصيص؛ 15 دورًا × خصائص (+box extras للرقم القضائي/الشارات/الحالات، باستثناء `.fno b`)؛ `--uxc-accent`؛ أنماط `.uxc-gear` و`.uxc-gear-host`؛ عرض `.modal-card:has(.uxc-modal)` min(780px,100%)؛ كل صفوف اللوحة (تبويبات/أكورديون/منزلقات/منتقيات ألوان/معاينة/قائمة التطبيق)؛ `.dg-head-gear` و`.dg-appear-pop` و`.dg .dg-table td{color:var(--dg-text,inherit)}` و`.dg.dg-customrowbg tbody td{background-color:var(--dg-row-bg)}`؛ استهلاك `.uxc-preview-box` لـ`--uxc-pad/--cd-gap`؛ استجابة ≤640px + طباعة + reduced-motion. رُبط في `index.html` بعد `display.css`.
- `js/ui/card-display.js` (أُعيدت كتابته — **نفس الصادرات**) — `applyCardDisplay` كما هي؛ `openCardDisplayPanel` تفوّض إلى `openCustomizerForElement`؛ `closeCardDisplayPanel` تغلق فقط إن كانت `.uxc-modal`؛ `bindCardDisplay/cardDisplayButtonMarkup` بلا تغيير واجهة — لا كسر للمستدعين.
- `js/ui/card.js` — `card()` يبثّ الآن `data-uxc-id="card:<displayKey>"` و`data-uxc-type="card"` ضمن displayAttrs.
- `js/app.js` — `go()`: بعد `applyPageDisplay/applyPageLayout` يستدعي `applyUniversalStyles(main,pageId)` (نقل أنماط فقط، بلا إعادة رسم أو Query).
- `js/ui/page-layout.js` — زر «🎨 تخصيص عرض الصفحة» (`data-pl-style`) يفتح `openComponentCustomizer({id:'page:'+pageId,type:'page',el:host})` عبر **import ديناميكي** (لا دورة استيراد)؛ «استعادة الافتراضي» تمسح أيضًا `clearComponentStyle('page:'+pageId)`.
- `js/modules/client-file.js` — `stagePathHtml(stages,currentId,fileId='')` تبث `data-uxc-id="stage:<id>" data-uxc-type="stage"` على كل `li` و`data-uxc-id="stagepath:<fileId>" data-uxc-type="section" data-uxc-gear` على الجذر؛ نافذة المرحلة تضم إجراء `data-a="style"` → إغلاق + `openCustomizerForElement(li)`. `js/modules/file-page.js` يمرر `f.id`.
- `js/ui/datagrid.js` — **مظهر لكل جدول داخل النظام الموجود**: `sanitizeAppear/hexOk/numOk`، `st.appear` يُقرأ من المحفوظ، زر `.dg-head-gear` 🎨 في رأس الجدول بعد التثبيت، `applyAppear()` يضبط `--dg-fpx/--dg-head-bg/--dg-head-color/--dg-text/--dg-row-bg/--dg-rowpad/--dg-borderc` + class `dg-customrowbg` (fontPx 10–20 خطوة .5، rowPad 2–18)، popover بالمنزلقات ومنتقيات الألوان + hex + ↺ لكل عنصر + «إعادة المظهر»، persist/reset وسيناريوهات المشاهد (snapshot/restore) تشمل `appear`، وتغيير الحشو/الخط يعيد `rowH=0` للـvirtualization. خطافات CSS: `ui.css` (`.dg-font-* td{font-size:var(--dg-fpx,…)}`)، `luxe.css` (حشو th/td `var(--dg-rowpad,…)`، خلفية thead `var(--dg-head-bg,…)`، حدود `.dg-scroll` `var(--dg-borderc,…)`)، `workbench.css` (`.dg-coltitle` لون `var(--dg-head-color,…)`).
- `js/modules/settings.js` — `renderUniversalStyleSettings()` في تبويب العامة (بين لوحتَي العرض والطي): زر الافتراضي العام + أزرار افتراضيات الأنواع الستة + رقاقة عدّادات `getStyleCounts` + زرّا إعادة ضبط خطيران بـ`confirmBox` (`resetUniversalDefaults` / `resetAllComponentOverrides`) مع `applyAllComponentStyles` فوريًا؛ الربط قبل معالج `#collapse-default-state` (أي قبل early-return لتبويب المظهر).
- `sw.js`/`js/core/constants.js`/`index.html` — كاش `ahmad-khudair-law-office-v5.6.0-offline1` + الأصول الثلاثة الجديدة؛ `APP_VERSION='5.6.0'`؛ ربط `css/component-style.css` بعد `display.css`. بلا تغيير Schema.
- `js/tests/component-style-tests.js` (جديد، 24 اختبارًا) — التطبيع/الحدود، الاستقلال، السلسلة لكل خاصية، القاعدة الذهبية، المصادر، مسح خاصية، تطبيق DOM، تكامل القياس الحر/الدرجات، المرحلة، حفظ كافتراضي، النسخ/التطبيق الصريح، إعادات الضبط، الاكتشاف/الحقن/idempotence، التسجيل العام، جذر الصفحة، تدفقات اللوحة الأربعة، مظهر الجدول (حفظ/استعادة/استقلال/إعادة)، سلامة البيانات (مفتاح واحد جديد)، والسيناريو النهائي بند 30 مع `_reloadComponentStylesForTests`. سُجّل في `tools/node-tests/run-tests.mjs` و`tests.html`: **194/194 ناجحة**؛ `tools/release-audit.mjs` PASS (177 ملفًا/125 JavaScript). **NOT VERIFIED**: اختبار بصري على متصفح/جهاز حقيقي، الاستجابة عند التكبير الأقصى، وقياس أداء على قاعدة إنتاجية.

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
39 IndexedDB stores: clients, staff, files, cases, fileClients, caseClients, opponents, caseOpponents, caseRelations, powersOfAttorney, hearings, procedures, appointments, communications, caseNotes, witnesses (historical only; UI retired), expertReports, judgments, execution, fees, feePayments, documentReferences, activityLog, lookups, settings, fileNumberCounters, meta, fileParties, fileRelations, clientFiles, taxonomy, caseTemplates, assets, fileAssets, serviceRecords, bailiffs, **workItems, workItemComments, workItemRecurrences (v14 — Work Center)**. Schema v14 declares 184 indexes (159 in v13 + 25); integrity audit verifies each declaration at runtime. (The "Current release" lines above this section are historical.)

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
- `js/services/action-center.js`: indexed daily/weekly work queue aggregation. *(حُذف في v5.7.0 واستُبدل بـ`js/services/work-query.js`.)*
- `js/modules/action-center.js`: Action Center UI with tabs and direct record navigation. *(حُذف في v5.7.0 واستُبدل بـ`js/modules/work-center.js`.)*
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
