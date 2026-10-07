// =====================================================================
// البيانات التجريبية — فحصها وحذفها كلها دفعة واحدة
// ---------------------------------------------------------------------
// المشكلة: أزرار التحميل التجريبي (settings.js وhome.js ومركز التنفيذ) تزرع
// 50 ملفًا قانونيًا وموكلين وخصومًا وجلسات وأعمالًا وأحكامًا وأتعابًا وإعلانات
// ومركز عمل وتنفيذات… ولا يوجد زر واحد ينظّفها بعد انتهاء التجربة.
//
// هذا الملف يوفّر ذلك:
//   • scanDemoData(office)  — قراءة فقط: كم سجلًا تجريبيًا موجود الآن وفي أي مخزن.
//   • removeDemoData(office)— حذف كل السجل التجريبي وكل سجل مرتبط به في عملية واحدة.
//
// مبادئ إلزامية (بحسب قواعد المشروع):
//   • الحذف **منطقي (Soft Delete)** كبقية عمليات الحذف في النظام: Repository
//     يتجاهل isDeleted فلا يظهر السجل في أي قائمة أو بحث أو تقرير، ويُسجَّل
//     التغيير في Change Log فينتقل الحذف إلى الأجهزة الأخرى عند المزامنة.
//   • كل السجلات تُحذف داخل **معاملة واحدة** (Unit of Work): إما كاملة أو بلا أثر.
//   • **لا حذف في صمت**: يُكتب صف في Activity Log داخل المعاملة نفسها، بلا أي
//     بيانات شخصية خام (أعداد ومخازن ووسم فقط).
//   • لا تُمس القوائم ولا الإعدادات ولا القوالب ولا التصنيفات ولا ترقيم الملفات
//     ولا سجل قواعد البيانات ولا هوية القاعدة.
//   • التوسيع بالمرجع: أي سجل يشير إلى سجل تجريبي (بأي حقل معرّف) يُعدّ جزءًا من
//     الشجرة التجريبية ويُحذف معها، فلا تبقى جلسة أو عمل أو ملاحظة يتيمة.
// =====================================================================
import {STORE} from '../db/schema.js';
import {transaction, request} from '../db/unit-of-work.js';
import {uid} from '../core/id.js';
import {Clock} from '../core/clock.js';
import {events} from '../core/events.js';
import {DEMO_MARK} from './demo-seed.js';

/** مخازن تُفحص وتُحذف منها السجلات التجريبية (سجلات المكتب التشغيلية فقط). */
export const DEMO_DELETABLE_STORES = Object.freeze([
  // توابع التنفيذ أولًا ثم أصلها
  'executionLedger', 'executionAllocations', 'executionReceipts', 'executionActions', 'executionPOAs',
  'executionValuePeriods', 'executionObligations', 'executionPeriods', 'executionSettlements',
  'executionAdjustments', 'differenceRecords', 'executionParties', 'execution',
  // مركز العمل
  'workItemComments', 'workItemRecurrences', 'workItems',
  // الملاحظات السريعة وروابطها
  'quickNoteLinks', 'caseNoteDrafts', 'caseNotes',
  // سجلات الأقسام
  'hearings', 'procedures', 'judgments', 'expertReports', 'documentReferences', 'serviceRecords',
  'appointments', 'communications', 'powersOfAttorney', 'witnesses',
  // الأطراف والروابط
  'fileRelations', 'caseRelations', 'fileParties', 'fileClients', 'caseClients', 'caseOpponents',
  'fileAssets', 'assets',
  // الأتعاب ودفعاتها
  'fees', 'feePayments',
  // الأصول القانونية: الملفات والمراحل والموكلون
  'cases', 'files', 'clientFiles', 'clients', 'opponents', 'bailiffs', 'staff'
]);

/**
 * سجلات مساعدة/مرجعية لا تحمل أي حقل يعود إلى الملف (لا `fileId` ولا ما يشبهه)،
 * فيصلها الفحص عبر قاعدة «الاستخدام الحصري»: تُحذف فقط إذا كان كل من يشير إليها
 * داخل قاعدة البيانات سجلًا تجريبيًا محذوفًا معها (مثال: الأعيان والخصوم
 * والمحضرون الذين أنشأهم الزرع التجريبي وتربطهم به ملفات تجريبية وحدها).
 */
export const DEMO_OWNED_STORES = Object.freeze(['assets', 'opponents', 'bailiffs', 'staff']);
/** أقصى عمق للبحث عن معرّفات داخل قيم الحقول (مصفوفات/كائنات متداخلة). */
const MAX_ID_DEPTH = 3;
/** أقصى عدد قيم نصية تُقرأ من السجل الواحد (حماية من الحقول الضخمة). */
const MAX_VALUES_PER_ROW = 400;
/**
 * نافذة زمنية حول لحظة الزرع التجريبي: أي سجل مساعد غير مرتبط بأي سجل حقيقي
 * وكُتب في هذه النافذة (خمس دقائق) يُعدّ من نفس الزرع. الزرع يكتب عشرات السجلات
 * في ثوانٍ، فالنافذة تلتقط سجلاته غير المرتبطة (خصم/عين/محضر زُرع ولم يُربط
 * بملف) ولا تكاد تلمس أي سجل حقيقي كُتب في وقت آخر.
 */
const SEED_WINDOW_MS = 90 * 1000;

/** مخازن لا تُفحص ولا تُحذف منها أي سجلات (بيانات مرجعية/بنية تحتية). */
export const DEMO_PROTECTED_STORES = Object.freeze([
  'lookups', 'settings', 'taxonomy', 'caseTemplates', 'executionTemplates',
  'fileNumberCounters', 'activityLog', 'meta', 'syncChanges', 'syncState', 'syncConflicts', 'syncPeers'
]);

/** أقصى عدد جولات التوسيع بالمرجع (ملف ← مرحلة ← جلسة ← مهمة مرتبطة بها…). */
const MAX_CASCADE_PASSES = 6;
/** موضع البحث داخل النصوص المتداخلة (مصفوفات/كائنات) عند البحث عن الوسم. */
const MAX_VALUE_DEPTH = 3;

const nowIso = () => Clock.now();
const asId = value => (value === undefined || value === null ? '' : String(value));

/** هل يحمل هذا السجل وسم البيانات التجريبية صريحًا؟ (بأي حقل نصي متداخل) */
export function isDemoMarkedRow(row, mark = DEMO_MARK) {
  if (!row || typeof row !== 'object') return false;
  if (row.isDemo === true || row[mark] === true) return true;
  if (String(row.demoTag || '').trim()) return true;
  return valueHolds(row, mark, 0);
}

function valueHolds(value, mark, depth) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.includes(mark);
  if (typeof value !== 'object' || depth >= MAX_VALUE_DEPTH) return false;
  if (Array.isArray(value)) return value.some(item => valueHolds(item, mark, depth + 1));
  for (const key of Object.keys(value)) if (valueHolds(value[key], mark, depth + 1)) return true;
  return false;
}

/** قراءة مخزن كامل بمؤشر (بلا مادة كبيرة في الذاكرة) مع تجاهل المحذوف منطقيًا. */
function readVisibleRows(ctx, name) {
  return new Promise((resolve, reject) => {
    const rows = [];
    const tx = ctx.db.transaction(name, 'readonly');
    const cursor = tx.objectStore(name).openCursor();
    cursor.onerror = () => reject(cursor.error);
    cursor.onsuccess = () => {
      const current = cursor.result;
      if (!current) { resolve(rows); return; }
      if (!current.value?.isDeleted) rows.push(current.value);
      current.continue();
    };
  });
}

/** جمع القيم النصية من سجل (حتى عمق محدود) لاستخدامها في قاعدتي الإشارة والملكية. */
function collectStrings(value, out, depth = 0) {
  if (out.length >= MAX_VALUES_PER_ROW || value === null || value === undefined) return out;
  if (typeof value === 'string') { if (value) out.push(value); return out; }
  if (typeof value !== 'object' || depth >= MAX_ID_DEPTH) return out;
  if (Array.isArray(value)) {
    for (const item of value) { collectStrings(item, out, depth + 1); if (out.length >= MAX_VALUES_PER_ROW) break; }
    return out;
  }
  for (const key of Object.keys(value)) { collectStrings(value[key], out, depth + 1); if (out.length >= MAX_VALUES_PER_ROW) break; }
  return out;
}

/**
 * جمع شجرة البيانات التجريبية بأربع قواعد متتابعة (كلها قراءة فقط في الذاكرة):
 *   1. الوسم الصريح: أي سجل يحمل وسم 〔تجريبي〕 أو isDemo/demoTag.
 *   2. الإشارة المباشرة: أي سجل يشير إلى سجل تجريبي بأي حقل معرّف (جلسة ← ملف…).
 *   3. الاستخدام الحصري: سجل مساعد (DEMO_OWNED_STORES) لا يشير إليه إلا سجلات
 *      تجريبية — مثل عين متنازع عليها أنشأها الزرع ولا يربطها إلا ملفات تجريبية.
 *   4. لحظة الزرع: سجل مساعد غير مرتبط بأي سجل حقيقي كُتب في نفس ثواني الزرع
 *      (±5 دقائق من أي سجل تجريبي) — مثل خصم زُرع ولم يُربط بأي ملف بعد.
 * تُعاد الحلقات حتى الاستقرار أو ست جولات كحد أقصى.
 * @returns {Promise<{rows:object, selected:Map<string,Map<string,object>>, marked:Map<string,number>, ids:Set<string>, total:number, markedCount:number, relatedCount:number, byStore:object}>}
 */
async function collectDemoTree(office) {
  office.ctx.assert();
  const ctx = office.ctx;
  const rows = {};
  for (const name of DEMO_DELETABLE_STORES) rows[name] = await readVisibleRows(ctx, name);

  const selected = new Map();   // store → Map(id → row)
  const marked = new Map();     // store → عدد السجلات الموسومة مباشرة
  const ids = new Set();
  const otherIds = new Set();   // كل معرّفات السجلات غير التجريبية (لقاعدة الاستخدام الحصري)
  const bucketOf = name => {
    if (!selected.has(name)) selected.set(name, new Map());
    return selected.get(name);
  };

  // 1) السجلات الموسومة صراحةً (زرع تجريبي مباشر)
  for (const name of DEMO_DELETABLE_STORES) {
    for (const row of rows[name]) {
      const id = asId(row.id);
      if (!id) continue;
      if (isDemoMarkedRow(row)) {
        bucketOf(name).set(id, row);
        ids.add(id);
        marked.set(name, (marked.get(name) || 0) + 1);
      } else otherIds.add(id);
    }
  }

  // فهرس القيم النصية لكل سجل (يُبنى مرة واحدة)
  const values = new Map();
  for (const name of DEMO_DELETABLE_STORES) {
    for (const row of rows[name]) values.set(`${name}\u0000${asId(row.id)}`, collectStrings(row, []));
  }

  const refsSelected = key => {
    for (const value of values.get(key) || []) if (ids.has(value)) return true;
    return false;
  };
  const stampOf = row => {
    const t = Date.parse(row.createdAt || row.updatedAt || '');
    return Number.isFinite(t) ? t : 0;
  };
  let stamps = [];
  const refreshStamps = () => {
    stamps = [];
    for (const bucket of selected.values()) for (const row of bucket.values()) { const t = stampOf(row); if (t) stamps.push(t); }
    stamps.sort((a, b) => a - b);
  };
  /** هل كُتب هذا السجل في نفس لحظة الزرع (قريب من أي سجل تجريبي آخر)؟ */
  const nearSelectedDemo = t => {
    if (!t || !stamps.length) return false;
    let lo = 0;
    let hi = stamps.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (stamps[mid] === t) return true;
      if (stamps[mid] < t) lo = mid + 1;
      else hi = mid - 1;
    }
    const before = stamps[Math.max(0, Math.min(hi, stamps.length - 1))];
    const after = stamps[Math.max(0, Math.min(lo, stamps.length - 1))];
    return Math.abs(t - before) <= SEED_WINDOW_MS || Math.abs(t - after) <= SEED_WINDOW_MS;
  };

  // فهرس «من يشير إلى من» بين سجلات المكتب الظاهرة فقط
  const referrers = new Map();  // id → Set(key للسجل المُشير)
  for (const [key, list] of values) {
    const ownId = key.slice(key.indexOf('\u0000') + 1);
    for (const value of list) {
      if (value === ownId || !otherIds.has(value)) continue;
      if (!referrers.has(value)) referrers.set(value, new Set());
      referrers.get(value).add(key);
    }
  }
  /** هل كل من يشير إلى هذا السجل (إن وُجد) سجلًا تجريبيًا محذوفًا معه؟ */
  const noRealReferrers = id => {
    const list = referrers.get(id);
    if (!list?.size) return true;
    for (const key of list) {
      const bucket = selected.get(key.slice(0, key.indexOf('\u0000')));
      if (!bucket?.has(key.slice(key.indexOf('\u0000') + 1))) return false;
    }
    return true;
  };

  // 2 و3) التوسيع حتى الاستقرار
  let pass = 0;
  let grew = ids.size > 0;
  while (grew && pass < MAX_CASCADE_PASSES) {
    grew = false;
    pass += 1;
    for (const name of DEMO_DELETABLE_STORES) {
      const bucket = bucketOf(name);
      const owned = DEMO_OWNED_STORES.includes(name);
      for (const row of rows[name]) {
        const id = asId(row.id);
        if (!id || bucket.has(id)) continue;
        const key = `${name}\u0000${id}`;
        const byReference = refsSelected(key);
        const byOwnership = owned && noRealReferrers(id) && nearSelectedDemo(stampOf(row));
        if (byReference || byOwnership) {
          bucket.set(id, row);
          ids.add(id);
          grew = true;
        }
      }
    }
    if (grew) refreshStamps();
  }

  const byStore = {};
  let total = 0;
  let markedCount = 0;
  let relatedCount = 0;
  for (const [name, bucket] of selected) {
    if (!bucket.size) continue;
    const direct = marked.get(name) || 0;
    byStore[name] = {total: bucket.size, marked: direct, related: bucket.size - direct};
    total += bucket.size;
    markedCount += direct;
    relatedCount += bucket.size - direct;
  }
  return {rows, selected, marked, ids, total, markedCount, relatedCount, byStore};
}

/**
 * فحص البيانات التجريبية الموجودة حاليًا (قراءة فقط، بلا أي كتابة).
 * @returns {Promise<{total:number, marked:number, related:number, byStore:object, ids:string[]}>}
 */
export async function scanDemoData(office) {
  const tree = await collectDemoTree(office);
  return {total: tree.total, marked: tree.markedCount, related: tree.relatedCount, byStore: tree.byStore, ids: [...tree.ids]};
}

/** فحص سريع: هل توجد بيانات تجريبية أصلًا؟ (قراءة مخزنَي الملفات والموكلين فقط) */
export async function hasDemoData(office) {
  office.ctx.assert();
  for (const name of ['files', 'clients']) {
    const rows = await readVisibleRows(office.ctx, name);
    if (rows.some(row => isDemoMarkedRow(row))) return true;
  }
  return false;
}

/** صف الحذف المنطقي — بنفس شكل باقي النظام (execution.js deletedRow). */
function deletedRow(row, now, reason) {
  return {
    ...row,
    isDeleted: true,
    deletedAt: row.deletedAt || now,
    deletedBy: row.deletedBy || 'user',
    deletionReason: reason || row.deletionReason || '',
    updatedAt: now,
    version: Number(row.version || 0) + 1
  };
}

/** تنظيف الإشارات إلى سجلات محذوفة من «آخر ما فُتح» و«المثبّتات» وآخر مسار. */
async function pruneUserShortcuts(office,deletedIds) {
  if (!deletedIds.size) return 0;
  const stale = route => {
    const parts = String(route || '').split(/[/:?#&=]+/).filter(Boolean);
    return parts.some(part => deletedIds.has(decodeURIComponent(part)));
  };
  let removed = 0;
  const scope=office?.ctx?.profile?.id||'';
  try {
    const {getRecent, removeRecent} = await import('./recents.js');
    for (const item of getRecent(scope)) if (stale(item?.route)) { removeRecent(item.route,scope); removed += 1; }
  } catch { /* تفضيلات غير متاحة */ }
  try {
    const {getFavorites, removeFavorite} = await import('./favorites.js');
    for (const item of getFavorites(scope)) if (stale(item?.route)) { await removeFavorite(item.route,scope); removed += 1; }
  } catch { /* تفضيلات غير متاحة */ }
  try {
    const {prefs,scopedPreferenceKey} = await import('../core/preferences.js');
    const key=scopedPreferenceKey('ui:last-route',scope),last = prefs.get(key, null);
    if (last?.route && stale(last.route)) await prefs.set(key, null);
  } catch { /* تفضيلات غير متاحة */ }
  return removed;
}

/**
 * حذف كل البيانات التجريبية (وكل ما يرتبط بها) دفعة واحدة.
 * @param {object} office سياق المكتب النشط
 * @param {{reason?:string, onProgress?:(info:{phase:string,store?:string,done:number,total:number})=>void}} options
 * @returns {Promise<{removed:number, marked:number, related:number, byStore:object, shortcuts:number, at:string}>}
 */
export async function removeDemoData(office, {reason = '', onProgress = null} = {}) {
  office.ctx.assert();
  const report = {phase: 'scan', store: '', done: 0, total: 0};
  const say = (patch) => { try { onProgress?.({...report, ...patch}); } catch { /* متجاهَل */ } };

  say({phase: 'scan'});
  const tree = await collectDemoTree(office);
  if (!tree.total) {
    return {removed: 0, marked: 0, related: 0, byStore: {}, shortcuts: 0, at: nowIso()};
  }

  const now = nowIso();
  const cleanReason = String(reason || '').trim() || 'حذف البيانات التجريبية من إعدادات المكتب';
  const stores = [...tree.selected.keys()].filter(name => tree.selected.get(name)?.size).map(name => STORE[name]);
  const logRow = {
    id: uid(),
    entityType: STORE.meta,
    entityId: 'removeDemoData',
    action: 'remove_demo_data',
    timestamp: now,
    summary: `حذف البيانات التجريبية (${tree.total} سجلًا: ${tree.markedCount} موسوم و${tree.relatedCount} مرتبط) — ${cleanReason}`,
    // أعداد ومخازن فقط: بلا أي بيانات شخصية خام
    metadata: {reason: cleanReason, total: tree.total, marked: tree.markedCount, related: tree.relatedCount, stores: tree.byStore, at: now}
  };

  // معاملة واحدة: كل الحذوفات + صف سجل النشاط — إما كلها أو لا شيء.
  let done = 0;
  await transaction(office.ctx, [...new Set([...stores, STORE.activityLog])], async tx => {
    for (const [name, bucket] of tree.selected) {
      if (!bucket.size) continue;
      const store = tx.objectStore(STORE[name]);
      for (const [id, row] of bucket) {
        await request(store.put(deletedRow(row, now, cleanReason)));
        done += 1;
      }
      say({phase: 'remove', store: name, done, total: tree.total});
    }
    await request(tx.objectStore(STORE.activityLog).add(logRow));
  });

  // تعطيل الزرع التلقائي التجريبي بعد المسح (مثل سلوك «مسح كل البيانات»)
  await office.r.meta.put({
    id: 'demoSeed', key: 'demoSeed', seeded: false, removedAt: now, reason: 'demo-removed-by-user',
    total: tree.total, marked: tree.markedCount, related: tree.relatedCount
  }).catch(() => null);
  // إعادة تسليح أمثلة التنفيذ التجريبية (يمكن تحميلها من جديد عند الحاجة)
  await office.r.meta.delete('executionDemoSeed').catch(() => null);
  await office.r.meta.delete('executionFamilyDemo').catch(() => null);

  // الكاشات والإشارات: لا تبقى شاشة تعرض سجلًا محذوفًا
  try {
    const {clearExecutionCache} = await import('./execution-cache.js');
    clearExecutionCache('حذف البيانات التجريبية');
  } catch { /* الكاش غير محمّل */ }
  const shortcuts = await pruneUserShortcuts(office,new Set([...tree.ids].map(String)));

  events.emit('demo:removed', {total: tree.total, marked: tree.markedCount, related: tree.relatedCount, at: now});
  events.emit('entity:changed', {entityType: '*', id: 'removeDemoData'});

  return {
    removed: tree.total, marked: tree.markedCount, related: tree.relatedCount,
    byStore: tree.byStore, shortcuts, at: now
  };
}

/** نص مختصر لعرض نتيجة الفحص في الواجهة. */
export function demoScanSummary(scan) {
  if (!scan?.total) return 'لا توجد بيانات تجريبية محمّلة الآن.';
  const parts = [`${scan.total} سجلًا تجريبيًا`];
  if (scan.marked) parts.push(`${scan.marked} موسوم بـ〔تجريبي〕`);
  if (scan.related) parts.push(`${scan.related} مرتبط بها (جلسات/أعمال/ملاحظات/أتعاب…)`);
  return parts.join(' · ');
}
