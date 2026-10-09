// =====================================================================
// الإخفاء المؤقت للعرض (work-hides): «إبقاء بلا موعد» و«ليس الآن».
//   - no record is modified: display-hiding only.
//   • التخزين في التفضيلات (prefs) مع «until» — ينتهي تلقائيًا (نهاية اليوم).
//   • النواة (isHideActive/filterVisibleItems) دالة نقية — قابلة للاختبار بلا IndexedDB.
// =====================================================================
import {prefs} from '../core/preferences.js';
import {localDate} from '../core/clock.js';

export const TEMP_HIDDEN_KEY = 'ui:wc:temp-hidden';

/** Critical items must never be hidden by «Not Now». */
export function canHideNotNow(item, today = localDate()) {
  if (!item || item.isDone || item.isCancelled || item.isOpen === false || !item.dueDate) return false;
  if (item.sourceType === 'hearings' && String(item.dueDate || '').slice(0, 10) === today) return false;
  if (item.dueDate && String(item.dueDate).slice(0, 10) < today && item.isOpen !== false) return false;
  if (item.sourceType === 'execution' && (item.priority === 'urgent' || item.severity === 'critical' || item.isUrgent === true || item.raw?.isUrgent === true)) return false;
  const poaExpiry = item.expiryDate || item.raw?.expiryDate || '';
  if ((item.kind === 'poa' || item.sourceType === 'powersOfAttorney') && poaExpiry && poaExpiry < today && !(item.isArchived || item.raw?.isArchived)) return false;
  return true;
}

/** نهاية اليوم الحالي (بالتوقيت المحلي) — expiry تلقائي للإخفاء المؤقت. */
export function endOfTodayISO(now = new Date()) {
  const d = new Date(now.getTime());
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

/** هل الإخفاء ما زال ساريًا؟ (دالة نقية) */
export function isHideActive(entry, now = Date.now()) {
  if (!entry || typeof entry !== 'object') return false;
  const until = Date.parse(entry.until || '');
  return Number.isFinite(until) && until > now;
}

/** تصفية العناصر المخفية مؤقتًا من قائمة (دالة نقية). */
export function filterVisibleItems(items, hiddenMap, now = Date.now()) {
  if (!hiddenMap || typeof hiddenMap !== 'object') return items;
  return items.filter(i => !isHideActive(hiddenMap[i.id], now));
}

/** خريطة الإخفاء الحالية (من التفضيلات). */
export function tempHiddenMap() {
  const m = prefs.get(TEMP_HIDDEN_KEY, null);
  return m && typeof m === 'object' ? m : {};
}

/** هل العنصر مخفي مؤقتًا الآن؟ */
export function isTemporarilyHidden(id, now = Date.now()) {
  if (!id) return false;
  return isHideActive(tempHiddenMap()[id], now);
}

/** إخفاء مؤقت لعنصر (افتراضيًا حتى نهاية اليوم) — كتابة في التفضيلات فقط. */
export async function hideTemporarily(id, {scope = 'all', reason = '', now = new Date()} = {}) {
  if (!id) return;
  const map = tempHiddenMap();
  map[id] = {until: endOfTodayISO(now), scope, reason, at: now.toISOString()};
  await prefs.set(TEMP_HIDDEN_KEY, map);
}

/** إلغاء الإخفاء المؤقت (إن وُجد). */
export async function unhideTemporarily(id) {
  if (!id) return;
  const map = tempHiddenMap();
  if (map[id]) { delete map[id]; await prefs.set(TEMP_HIDDEN_KEY, map); }
}

/** تنظيف الإدخالات المنتهية (يُستدعى عند الكتابة). */
export async function pruneExpiredHides(now = Date.now()) {
  const map = tempHiddenMap();
  let changed = false;
  for (const [id, entry] of Object.entries(map)) {
    if (!isHideActive(entry, now)) { delete map[id]; changed = true; }
  }
  if (changed) await prefs.set(TEMP_HIDDEN_KEY, map);
  return changed;
}
