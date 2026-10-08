// ============================================================
// أساس ذكاء التخزين المؤقت في البرنامج — طبقة إبطال واحدة لكل كاشات القراءة.
// ------------------------------------------------------------
// المشكلة: أي Cache في الواجهة (نص بحث جاهز، معرّفات مرشّحة، تسميات مراجع)
// يجب أن يكون آمنًا تمامًا: قراءة بيانات قديمة بعد تعديل = نتائج بحث ناقصة
// بصمت، وهذا أسوأ من البطء.
//
// الحل: عدّاد واحد لكل (سياق قاعدة بيانات × مخزن). أي معاملة كتابة اعتمادَت
// ترفعه، وكل مستخدم للـ Cache يخزّن رقم العدّاد مع نتيجته؛ إذا اختلف →
// النتيجة مهملة وتُعاد بنائها. لا انتهاء صلاحية زمني، لا مهلة، لا احتمال
// لقراءة بيانات تقادمة.
//
// نقاط الرفع (كلها مغلّفة في try/catch حتى لا تُفشل الكتابة أبدًا):
//  1) DatabaseContext: يلفّ db.transaction — يغطي كل مسار كتابة في البرنامج
//     (Repository، UnitOfWork، الاستعادة، الإصلاح، المزامنة، الصيانة).
//  2) Repository.put/add/delete و unit-of-work.transaction: تغطية إضافية
//     للسياقات البسيطة في الاختبارات (كائن ctx خفيف بلا proxy).
//  3) رسالة بين النوافذ عبر BroadcastChannel: نافذة أخرى كتبت → كل الكاشات
//     في هذه النافذة صارت قديمة (عدّاد عام).
// ============================================================

/** ctx -> Map<storeName, epoch> — WeakMap فلا يبقى شيء في الذاكرة بعد تبديل القاعدة. */
const BY_CONTEXT = new WeakMap();
/** يكتبه المستمع عند وصول تعديل من نافذة أخرى أو عند «لا أعرف أي مخزن». */
let GLOBAL_BUMP = 0;
const LISTENERS = new Set();
const SELF = '@all';

function tableFor(ctx) {
  if (!ctx || (typeof ctx !== 'object' && typeof ctx !== 'function')) return null;
  let map = BY_CONTEXT.get(ctx);
  if (!map) { map = new Map(); try { BY_CONTEXT.set(ctx, map); } catch { return null; } }
  return map;
}

function bumpKey(map, key) { map.set(key, (map.get(key) || 0) + 1); }

/**
 * رفع عدّاد الكتابة لمخازن معيّنة داخل سياق قاعدة بيانات معيّن.
 * آمنة الاستدعاء مع ctx وهمي/فارغ (تتجاهل بصمت) ولا ترمي أي خطأ أبدًا.
 */
export function bumpWriteEpoch(ctx, stores) {
  try {
    const list = typeof stores === 'string' ? [stores] : Array.isArray(stores) ? stores : stores ? Array.from(stores) : [];
    const map = tableFor(ctx);
    if (!map) return;
    // التتبّع دقيق لكل مخزن: كتابة في «الجلسات» لا تُبطل كاش «الموكلين».
    // من يحتاج إبطالًا شاملًا (استعادة قاعدة، تبديل، رسالة نافذة أخرى) يستخدم
    // invalidateContext/bumpGlobalEpoch صراحةً، لا هذا المسار.
    for (const name of list.length ? list : [SELF]) if (name) bumpKey(map, String(name));
    for (const fn of LISTENERS) { try { fn(ctx, list); } catch { /* مراقب تشخيصي لا يُفشل العمل */ } }
  } catch { /* لا يُكسر مسار كتابة بسبب الكاش */ }
}

/** عدّاد مخزن معيّن (يضم العدّاد العام حتى تُبطَل النتائج بأي كتابة خارجية). */
export function readEpoch(ctx, store) {
  let local = 0;
  try {
    const map = ctx && BY_CONTEXT.get(ctx);
    if (map) local = (map.get(String(store)) || 0) + (map.get(SELF) || 0);
  } catch { local = 0; }
  return local + GLOBAL_BUMP;
}

/** عدّاد عام واحد لكل الكتابات في كل السياقات — لمن لا يفرّق بين المخازن. */
export function globalEpoch() { return GLOBAL_BUMP; }

/** تسجيل مراقب للتشخيص/الواجهة؛ يرجع دالة إلغاء التسجيل. */
export function onWriteEpoch(listener) {
  LISTENERS.add(listener);
  return () => LISTENERS.delete(listener);
}

/** إبطال كل ما هو مبني على هذا السياق (بعد استعادة/تبديل/حذف قاعدة). */
export function invalidateContext(ctx) { bumpWriteEpoch(ctx, [SELF]); }

/** إبطال شامل (نافذة أخرى كتبت، أو استعادة فوق القاعدة نفسها). */
export function bumpGlobalEpoch() { GLOBAL_BUMP += 1; }

/** للأداء التشخيصي والاختبارات: هل هناك سجل لهذا السياق؟ */
export function hasEpochTracking(ctx) { try { return BY_CONTEXT.has(ctx); } catch { return false; } }

export function _resetWriteEpochsForTests() { GLOBAL_BUMP = 0; LISTENERS.clear(); }
