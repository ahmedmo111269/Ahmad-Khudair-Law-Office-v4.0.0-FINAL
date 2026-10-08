// ============================================================
// كاش مفاتيح البحث (Search Key Cache) — موجة 3
// ------------------------------------------------------------
// المشكلة المقاسة في تقرير الموجة السابقة: البحث الاحتوائي كان يقرأ المخزن
// كاملًا من IndexedDB عند كل ضغطة مفتاح. على 20,000 موكل كانت القراءة وحدها
// ≈ 455 ms من أصل ≈ 540 ms، أي أن التكلفة في «الوصول إلى الصفوف» لا في «طَيّ النص».
//
// الفكرة: القرار «هل يطابق هذا السجل؟» لا يحتاج السجل كاملًا، يحتاج نصّه المطبَّع فقط.
// نبني مرة واحدة لكل جلسة مصفوفة مضغوطة [{id, t, c, ok}] لكل مخزن (بمسح مؤشر
// واحد)، ثم تُقرأ كل استعلامات بعدها من الذاكرة: ميلي ثوانٍ بدل نصف ثانية،
// ويستفيد المستخدم مع كل ضغطة مفتاح في نفس الجلسة.
//
// لماذا هو آمن على بيانات المكتب؟
//  • لا يُكتب شيء في المخزن: ذاكرة فقط، قابلة للإسقاط في أي لحظة.
//  • لا «مدة صلاحية» ولا مهلة: كل معاملة كتابة معتمدة ترفع عدّاد مخزنها
//    (js/db/write-epoch.js)، وأي اختلاف في العدّاد يُبطل المصفوفة وتُعاد بناؤها
//    من المخزن قبل الاستخدام — فلا نتيجة تقادمة ممكنة أصلًا.
//  • إبطال بين النوافذ عبر نفس القناة الموجودة (BroadcastChannel).
//  • سقف صارم: مخزن أضخم من MAX_CACHED_ROWS أو ميزانية ذاكرة ممتلئة ⇒ لا كاش،
//    ويستمر مسار IndexedDB القديم كما هو. تحسين سرعة لا يغيّر دلالة.
//  • المرشَّحات تُتحقَّق على الصفوف الحقيقية بعد جلبها (في search-engine)، فلا
//    نتيجة خاطئة يمكن أن تظهر للمستخدم.
// ============================================================
import {rowText} from './entity-query.js';
import {normalizeCodeToken, numberishFieldsFor} from './search-shape.js';
import {readEpoch} from '../db/write-epoch.js';
import {isOn} from '../core/feature-flags.js';

/** أقصى عدد صفوف تُخزَّن لها مفاتيح بحث في مخزن واحد. */
export const MAX_CACHED_ROWS = 60000;
/** ميزانية تقريبية لكل الكاشات في الجلسة (بايت). */
export const MEMORY_BUDGET = 24 * 1024 * 1024;

/** ctx -> Map<cacheKey, record> — يُهمل السياق كله تلقائيًا عند تبديل القاعدة. */
const CACHES = new WeakMap();
/** cacheKey -> {map} لإسقاط محاسب عند التبديل أو امتلاء الميزانية. */
const HOLDERS = new Map();
/** ترتيب الاستخدام الأخير. */
const LRU = [];
let usedBytes = 0;
// العمليات الجماعية (زرع تجريبي، استعادة نسخة، تطبيق مزامنة، إعادة بناء فهرس)
// تكتب آلاف الصفوف في ثوانٍ: كل كتابة تُبطل الكاش، فيُعاد بناؤه ليُبطل فورًا —
// ضياع صريح للوقت. أثناء التعليق لا يُستخدم الكاش إطلاقًا، ويعود المسار القديم
// نفسه. التعليق عدّادي ومقفول بمدة عبر withSuspendedSearchCache.
const SUSPENSIONS = new Set();

export function searchCacheSuspended() { return SUSPENSIONS.size > 0 }
export function suspendSearchCache(reason = 'bulk') {
  SUSPENSIONS.add(reason);
  return () => resumeSearchCache(reason);
}
export function resumeSearchCache(reason = 'bulk') { SUSPENSIONS.delete(reason) }

/** تشغيل عملية جماعية بلا كاش، مع ضمان رفع التعليق ولو فشل العمل. */
export async function withSuspendedSearchCache(reason, fn) {
  const release = suspendSearchCache(reason);
  try { return await fn(); } finally { release(); }
}

function tableFor(ctx) {
  if (!ctx || (typeof ctx !== 'object' && typeof ctx !== 'function')) return null;
  let map = CACHES.get(ctx);
  if (!map) { map = new Map(); try { CACHES.set(ctx, map); } catch { return null; } }
  return map;
}

function dropKey(key) {
  const holder = HOLDERS.get(key);
  if (!holder) return 0;
  const bytes = holder.record?.bytes || 0;
  HOLDERS.delete(key);
  try { holder.map.delete(key); } catch { /* سياق أُغلق */ }
  const position = LRU.indexOf(key);
  if (position >= 0) LRU.splice(position, 1);
  return bytes;
}

/** يفرّغ الأقدم حتى تدخل needed بايت في الميزانية؛ false إذا لم تتسع أبدًا. */
function makeRoom(needed) {
  while (LRU.length && usedBytes + needed > MEMORY_BUDGET) usedBytes -= dropKey(LRU[0]);
  return usedBytes + needed <= MEMORY_BUDGET;
}

function touch(key) {
  const i = LRU.indexOf(key);
  if (i >= 0) LRU.splice(i, 1);
  LRU.push(key);
}

function entryBytes(entry) {
  let size = 56 + (entry.id ? entry.id.length : 0) + (entry.t ? entry.t.length * 2 : 0);
  if (entry.c) size += entry.c.length * 18;
  return size;
}

function abortError() { const error = new Error('أُلغيت قراءة كاش البحث.'); error.name = 'AbortError'; return error; }

/**
 * يرجع {entries, epoch, rows} لمخزن، أو null إذا تعذّر الأمان/الاتساع
 * (مخزن ضخم، سياق بلا قاعدة، ميزانية ممتلئة) فيكمل المستدعي بمسار IndexedDB.
 */
export async function getSearchKeys(ctx, store, {shape = 'std', fields = null, signal = null} = {}) {
  if (!isOn('searchKeyCache') || searchCacheSuspended()) return null; // مفتاح الإيقاف الآمن: المسار القديم كما هو تمامًا
  if (!ctx?.db || typeof store !== 'string') return null;
  if (signal?.aborted) throw abortError();
  const map = tableFor(ctx);
  if (!map) return null;
  const key = `${ctx.profile?.databaseName || 'db'}|${store}|${shape}`;
  const epoch = readEpoch(ctx, store);
  const hit = map.get(key);
  if (hit) {
    if (hit.overflow) return null;
    if (hit.epoch === epoch) { touch(key); return hit; }
    usedBytes -= dropKey(key);
  }

  const built = await buildKeys(ctx, store, fields === null ? numberishFieldsFor(store) : fields, signal);
  if (!built || built.overflow) {
    if (built?.overflow) { map.set(key, {overflow: true, epoch, bytes: 0, rows: 0}); HOLDERS.set(key, {map, record: map.get(key)}); }
    return null;
  }
  const record = {overflow: false, epoch, entries: built.entries, bytes: built.bytes, rows: built.entries.length, builtAt: Date.now()};
  if (!makeRoom(record.bytes)) return null;
  usedBytes -= dropKey(key);
  map.set(key, record);
  HOLDERS.set(key, {map, record});
  usedBytes += record.bytes;
  touch(key);
  return record;
}

/** قراءة مؤشر واحدة بترتيب تنازلي (الأحدث أولًا) — نفس ترتيب المسح القديم حرفيًا. */
function buildKeys(ctx, store, numberFields, signal) {
  try { ctx.assert?.(); } catch { return Promise.resolve(null); }
  return new Promise((resolve, reject) => {
    let tx;
    try { tx = ctx.db.transaction(store, 'readonly'); } catch (error) { reject(error); return; }
    const entries = [];
    let bytes = 0, settled = false;
    const finish = action => { if (settled) return; settled = true; signal?.removeEventListener?.('abort', onAbort); action(); };
    const onAbort = () => { try { tx.abort(); } catch { /* منتهية */ } finish(() => reject(abortError())); };
    signal?.addEventListener?.('abort', onAbort, {once: true});
    tx.onabort = () => finish(() => reject(signal?.aborted ? abortError() : (tx.error || new Error('تعذّر بناء كاش البحث.'))));
    const cursor = tx.objectStore(store).openCursor(null, 'prev');
    cursor.onerror = () => finish(() => reject(cursor.error));
    cursor.onsuccess = () => {
      if (settled) return;
      const cur = cursor.result;
      if (!cur) { finish(() => resolve({entries, bytes})); return; }
      if (entries.length >= MAX_CACHED_ROWS) { finish(() => resolve({overflow: true})); return; }
      const row = cur.value;
      let text = '';
      try { text = rowText(row); } catch { text = ''; }
      let codes = null;
      if (numberFields && numberFields.length) {
        codes = [];
        for (const field of numberFields) {
          const value = row?.[field];
          if (value === undefined || value === null || value === '') continue;
          codes.push(normalizeCodeToken(String(value)));
        }
      }
      const extra = EXTRA_PREDICATES[store];
      const ok = !row?.isDeleted && (!extra || safePredicate(extra, row));
      const entry = {id: String(row?.id ?? cur.primaryKey ?? ''), t: text, c: codes, ok};
      entries.push(entry);
      bytes += entryBytes(entry);
      cur.continue();
    };
  });
}

function safePredicate(fn, row) { try { return Boolean(fn(row)); } catch { return true; } }

/**
 * قيود «الصف الصالح» نفسها التي يطبقها محرك البحث قبل المطابقة (حذف منطقي/حالة
 * خاصة)، حتى تُحسب النتائج وعدد ما بقي منها بنفس الدلالة حرفيًا.
 */
export const EXTRA_PREDICATES = {
  workItems: row => row.kind === 'native',
  serviceRecords: row => row.recordState !== 'deleted'
};

/**
 * مطابقة المصفوفة في الذاكرة: {ids, stopped, scanned}.
 * `stopped` لها دلالة المسح القديم نفسها: «ما زال بعد الصف الذي اكتمل عنده الحدّ
 * صفٌّ واحد على الأقل في المخزن» — أي أن عدد النتائج قد يتجاوز الحد.
 */
export function matchKeys(entries, {tokens = [], code = '', numDigits = '', limit = 8} = {}) {
  if (!entries) return null;
  const hits = [];
  let stopped = false;
  const c2 = code ? normalizeCodeToken(code) : '';
  const digits = numDigits ? String(numDigits) : '';
  const useDigits = digits.length >= 4;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry.ok) continue;
    if (matchEntry(entry, tokens, c2, digits, useDigits)) {
      hits.push(entry.id);
      if (hits.length >= limit) { stopped = i < entries.length - 1; break; }
    }
  }
  return {ids: hits, stopped, scanned: entries.length};
}

function matchEntry(entry, tokens, c2, digits, useDigits) {
  if (c2 && entry.c) { for (const value of entry.c) if (value && (value.startsWith(c2) || c2.startsWith(value))) return true; }
  if (useDigits && entry.c) { for (const value of entry.c) if (value && value.includes(digits)) return true; }
  // فرع دالي كما في المحرك الأصلي: بلا كلمات بحث تكفي وجود كود/رقم. لا يُصلَح
  // هنا — الدقة مع السلوك القائم أهمّ من «تحسين» يغيّر نتائج مستخدم حالي.
  if (!tokens.length) return Boolean(c2 || digits);
  for (let i = 0; i < tokens.length; i++) if (!entry.t.includes(tokens[i])) return false;
  return true;
}

/** هل الكاش جاهز (دافئ) لمخزن؟ يُستخدم لضبط تأخير البحث أثناء الكتابة السريعة. */
export function isWarm(ctx, store, {shape = 'std'} = {}) {
  try {
    const map = ctx && CACHES.get(ctx);
    const record = map && map.get(`${ctx.profile?.databaseName || 'db'}|${store}|${shape}`);
    return Boolean(record && !record.overflow && record.epoch === readEpoch(ctx, store));
  } catch { return false; }
}

export function searchCacheStats(ctx) {
  const empty = {caches: 0, rows: 0, bytes: 0, usedBytes, budget: MEMORY_BUDGET, maxRows: MAX_CACHED_ROWS, stores: []};
  try {
    const map = ctx && CACHES.get(ctx);
    if (!map) return empty;
    const stores = [];
    let rows = 0, bytes = 0;
    for (const [key, record] of map) {
      rows += record.rows || 0;
      bytes += record.bytes || 0;
      stores.push({store: String(key).split('|')[1] || key, rows: record.rows || 0, bytes: record.bytes || 0, overflow: Boolean(record.overflow)});
    }
    return {caches: map.size, rows, bytes, usedBytes, budget: MEMORY_BUDGET, maxRows: MAX_CACHED_ROWS, stores};
  } catch { return {...empty, error: true}; }
}

export function clearSearchCache(ctx) {
  try {
    const map = ctx && CACHES.get(ctx);
    if (!map) return 0;
    let freed = 0;
    for (const key of [...map.keys()]) freed += dropKey(key);
    usedBytes = Math.max(0, usedBytes - freed);
    return freed;
  } catch { return 0; }
}

/** للاختبارات فقط: إعادة ضبط الحالة العامة بين مجموعات الاختبار. */
export function _resetSearchCacheForTests() {
  HOLDERS.clear();
  LRU.length = 0;
  usedBytes = 0;
}
