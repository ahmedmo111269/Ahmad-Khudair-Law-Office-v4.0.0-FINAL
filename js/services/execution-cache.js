// =====================================================================
// ذاكرة حساب مركز التنفيذ (Execution Calculation Cache)
// ---------------------------------------------------------------------
// • الغرض: عدم إعادة بناء جدول الاستحقاق لنفس التنفيذ ونفس تاريخ الحساب
//   في كل رسم. لا تحتفظ الذاكرة بأي رقم مشتق من الحفظ — كلها مشتقة وقت
//   العرض، فإبطالها لا يفقد أي بيانات.
// • المفتاح يتضمن ruleVersion وengineVersion إلزاميًا: بدون ذلك لا تنعكس
//   تغييرات الإعدادات على الأرقام (وهو جوهر شكوى «الإعدادات لا تعمل»).
// • كل كتابة على سجلات التنفيذ تُبطل الذاكرة فورًا عبر حدث entity:changed،
//   وكذلك أحداث الإعدادات execution:cache-invalidated /
//   execution:configuration-changed التي كانت تُصدَر بلا أي مستمع.
// • حد أقصى 200 مدخل بإخلاء الأقدم استخدامًا (LRU)، ولا تُخزَّن الجداول
//   الضخمة حتى لا تتضخم الذاكرة في مكتب له آلاف الفترات.
// =====================================================================
import {STORE} from '../db/schema.js';
import {events} from '../core/events.js';

export const EXECUTION_CACHE_MAX_ENTRIES = 200;
/** جداول أكبر من هذا الحد لا تُخزَّن مؤقتًا (تُحسب كل مرة — أبطأ قليلًا وأأمن ذاكرةً). */
export const EXECUTION_CACHE_MAX_ROWS = 400;

/** مخازن التنفيذ التي أي كتابة عليها تُبطل الحساب المشتق. */
export const EXECUTION_CACHE_STORES = Object.freeze([
  STORE.execution, STORE.executionValuePeriods, STORE.executionReceipts, STORE.executionAllocations,
  STORE.executionLedger, STORE.executionParties, STORE.executionActions, STORE.executionPOAs,
  STORE.executionPeriods, STORE.judgments, STORE.differenceRecords, STORE.executionObligations,
  // التسويات والتعديلات تغيّر الاعتراف/الفروق في مسار FEAS — كانت كتابتها تُصدِر
  // حدثًا لا يعرفه الإبطال فيبقى رقم الاعتراف القديم معروضًا.
  STORE.executionSettlements, STORE.executionAdjustments
].filter(Boolean));

/**
 * نطاق الذاكرة: كائن مكتب واحد (قاعدة بيانات واحدة) — فلا يتسرّب رقم تنفيذ
 * من قاعدة إلى قاعدة أخرى عند التبديل أو في الاختبارات، ولا تُخلط النسخ.
 */
const scopes = new WeakMap();
let scopeSequence = 0;
export function executionCacheScope(office) {
  if (!office || typeof office !== 'object') return 'anonymous';
  if (!scopes.has(office)) scopes.set(office, `db${++scopeSequence}:${office?.ctx?.profile?.id || office?.ctx?.profile?.displayName || ''}`);
  return scopes.get(office);
}

/**
 * مفتاح واحد لكل تركيبة حساب: القاعدة + التنفيذ + تاريخ الحساب + سياسة المستقبل
 * + نسخة القواعد + نسخة المحرك. تغيير أي منها ⇒ مفتاح جديد ⇒ رقم جديد بلا انتظار.
 */
export function executionCacheKey({scope = '', executionId = '', asOf = '', allowFuture = false, ruleVersion = 0, engineVersion = 0, fromDate = '', periodThrough = ''} = {}) {
  // periodThrough جزء من المفتاح: أفق توليد الفترات (تاريخ الاستحقاق المسجَّل أو آخر
  // فترة معترف بها في FEAS) قد يتقدّم بعد اعتماد فرق/اعتراف، فتتغيّر الأرقام فورًا
  // حتى لو لم يصل حدث إبطال — لا رقم قديم بأثر جديد.
  return [scope || '', executionId || '', asOf || '', allowFuture ? '1' : '0', String(ruleVersion || 0), String(engineVersion || 0), fromDate || '', periodThrough || ''].join('|');
}

const entries = new Map();
const stats = {hits: 0, misses: 0, stores: 0, invalidations: 0, lastInvalidationReason: ''};
const listeners = new Set();
let bound = false;

function touch(key, value) {
  // LRU: إعادة الإدراج تنقل المفتاح إلى آخر الترتيب (الأحدث استخدامًا).
  if (entries.has(key)) entries.delete(key);
  entries.set(key, value);
  while (entries.size > EXECUTION_CACHE_MAX_ENTRIES) entries.delete(entries.keys().next().value);
}

export const executionCache = {
  get(key) {
    if (!entries.has(key)) { stats.misses += 1; return null; }
    const value = entries.get(key);
    touch(key, value);
    stats.hits += 1;
    return value;
  },
  set(key, value) {
    touch(key, value);
    stats.stores += 1;
    return value;
  },
  has: key => entries.has(key),
  delete: key => entries.delete(key),
  get size() { return entries.size; },
  keys: () => [...entries.keys()],
  stats: () => ({...stats, size: entries.size}),
  resetStats() { stats.hits = 0; stats.misses = 0; stats.stores = 0; }
};

/** إفراغ الذاكرة بسبب معلن (يُسجَّل آخر سبب لأغراض الفحص والدعم). */
export function clearExecutionCache(reason = '') {
  if (entries.size) stats.invalidations += 1;
  stats.lastInvalidationReason = String(reason || '');
  entries.clear();
  for (const listener of listeners) {
    try { listener({reason: stats.lastInvalidationReason}); } catch (error) { console.info('execution cache listener failed', error); }
  }
  return stats.lastInvalidationReason;
}

/** تسجيل مستمع لإبطال الذاكرة (يُستخدم في الاختبارات وتحديث الواجهة عند الحاجة). */
export function onExecutionCacheCleared(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * ربط الإبطال بالأحداث — نداء واحد عند إقلاع التطبيق أو أول حساب.
 * قبل هذا الربط كانت أحداث إبطال cache تُصدَر بلا أي مستمع في المشروع كله.
 */
export function bindExecutionCache() {
  if (bound) return false;
  bound = true;
  const invalidate = reason => () => clearExecutionCache(reason);
  events.on('execution:cache-invalidated', invalidate('تغيّرت إعدادات التنفيذ'));
  events.on('execution:configuration-changed', invalidate('تغيّر إعداد/محرك الحساب'));
  events.on('entity:changed', payload => {
    const entityType = payload?.entityType;
    // كتابة على أي سجل تنفيذ (تحصيل/إجراء/مصروف/حكم/توكيل/إلغاء…) تُبطل الحساب
    // المشتق؛ وبعض المسارات العامة تُبطل الذاكرة كلها احتياطًا فلا يبقى رقم قديم.
    // أي كتابة على كيان تنفيذي (أو إعداداته) تُبطل الحساب المشتق — Vبما فيها
    // سجلات جديدة لم تُدرَج في القائمة بعد، فلا يبقى رقم قديم أمام كتابة جديدة.
    if (entityType && !EXECUTION_CACHE_STORES.includes(entityType)
      && !String(entityType).startsWith('execution') && String(entityType) !== 'executionSettings') return;
    clearExecutionCache(`كتابة على ${entityType || 'سجل تنفيذ'}`);
  });
  events.on('db:switched', invalidate('تبديل قاعدة البيانات'));
  events.on('execution:data-cleared', invalidate('مسح بيانات التنفيذ'));
  events.on('sync:applied', invalidate('تطبيق تغييرات مزامنة'));
  return true;
}

/** الجدول القابل للتخزين مؤقتًا: لا نخزّن جداول ضخمة (ذاكرة المكتب أولى). */
export function isCacheableSchedule(schedule) {
  return Boolean(schedule) && (schedule.rows || []).length <= EXECUTION_CACHE_MAX_ROWS;
}
