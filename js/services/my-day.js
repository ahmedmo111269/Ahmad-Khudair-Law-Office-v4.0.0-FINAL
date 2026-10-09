// =====================================================================
// «يومي» (My Day): Picked items for today, stored in preferences only.
//   - no record is modified and no new Store: picks live in prefs.
//   • Expiry: picks are keyed by the local date — they expire automatically
//     at the end of the day (reading them on a later date yields nothing).
//   • The pure core (picksForDate) is testable without IndexedDB.
// =====================================================================
import {prefs} from '../core/preferences.js';
import {localDate} from '../core/clock.js';

export const PICKS_KEY = 'ui:my-day:picks';

/** Today's date (local) as YYYY-MM-DD — the expiry key of the picks. */
export function todayKey(now = new Date()) {
  return localDate(now);
}

/** Pure core: read the pick ids from a raw prefs value, honoring the daily expiry. */
export function picksForDate(raw, dateKey) {
  if (!raw || typeof raw !== 'object' || raw.date !== dateKey) return [];
  if (!Array.isArray(raw.ids)) return [];
  const seen = new Set();
  const ids = [];
  for (const id of raw.ids) {
    if (typeof id !== 'string' || !id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/** The current picks (empty once the day has ended). */
export function getPicks(now = new Date()) {
  return picksForDate(prefs.get(PICKS_KEY, null), todayKey(now));
}

/** Is this item picked for today? */
export function isPicked(id, now = new Date()) {
  if (!id) return false;
  return getPicks(now).includes(id);
}

async function savePicks(ids, now) {
  await prefs.set(PICKS_KEY, {date: todayKey(now), ids});
}

/** Pick an item for today (idempotent). */
export async function pickForToday(id, now = new Date()) {
  if (!id) return;
  const ids = getPicks(now);
  if (ids.includes(id)) return;
  ids.push(id);
  await savePicks(ids, now);
}

/** Remove an item from today's picks (no-op when absent). */
export async function unpickForToday(id, now = new Date()) {
  if (!id) return;
  const ids = getPicks(now);
  const next = ids.filter(x => x !== id);
  if (next.length !== ids.length) await savePicks(next, now);
}

/** Drop picks whose items no longer exist (housekeeping, bounded by the pick list). */
export async function pruneMissingPicks(exists, now = new Date()) {
  const ids = getPicks(now);
  const next = [];
  for (const id of ids) if (await exists(id)) next.push(id);
  if (next.length !== ids.length) await savePicks(next, now);
  return ids.length - next.length;
}
