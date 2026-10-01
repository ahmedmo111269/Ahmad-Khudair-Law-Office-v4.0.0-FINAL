// =====================================================================
// مركز العمل — الإعدادات والحالة المحفوظة (تفضيلات المستخدم عبر prefs الموجودة؛ بلا مخزن/نظام إعدادات جديد).
//   ui:workcenter-config : تسميات/ألوان الحالات والأولويات، المصادر المفعّلة، عتبات القواعد الذكية.
//   ui:workcenter-state  : آخر نطاق/عرض/فلاتر (يُستعاد بعد التحديث).
//   ui:workcenter-views  : العروض المحفوظة (Saved Views).
// طي/فتح الأقسام يُحفظ في نظام collapse-state الموجود، وإعدادات الجدول في تفضيلات DataGrid الموجودة.
// =====================================================================
import {prefs} from '../core/preferences.js';
import {uid} from '../core/id.js';
import {Clock} from '../core/clock.js';
import {validColor, PRIORITY_KEYS, WORK_RANGES, WORK_VIEWS, CORE_STATUS_KEYS, STATUS_KINDS} from '../domain/work-items.js';
import {allWorkSources} from '../domain/work-sources.js';

export const WORK_CONFIG_KEY = 'ui:workcenter-config';
export const WORK_STATE_KEY = 'ui:workcenter-state';
export const WORK_VIEWS_KEY = 'ui:workcenter-views';
export const MAX_SAVED_VIEWS = 30;

export const DEFAULT_WORK_CONFIG = Object.freeze({
  version: 1, statuses: {}, customStatuses: [], priorities: {}, sources: {}, lookback: {},
  staleFileDays: 30, summaryWindowDays: 45, upcomingDays: 14, urgentWithinDays: 2,
  attention: {rules: {}}, notifications: {enabled: true, maxVisible: 3}
});

const num = (value, min, max, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(Math.max(Math.round(n), min), max) : fallback;
};
const isObject = value => value && typeof value === 'object' && !Array.isArray(value);
const lookOf = value => {
  if (!isObject(value)) return null;
  const out = {};
  const label = String(value.label ?? '').trim().slice(0, 30);
  if (label) out.label = label;
  const color = validColor(value.color);
  if (color) out.color = color;
  return Object.keys(out).length ? out : null;
};

/** تنظيف أي إعداد قادم من التخزين أو النموذج؛ لا يقبل مفاتيح غريبة ولا ألوانًا غير صالحة. */
export function sanitizeWorkConfig(raw) {
  const src = isObject(raw) ? raw : {};
  const out = {...DEFAULT_WORK_CONFIG, statuses: {}, customStatuses: [], priorities: {}, sources: {}, lookback: {}, attention: {rules: {}}, notifications: {...DEFAULT_WORK_CONFIG.notifications}};
  for (const key of CORE_STATUS_KEYS) { const look = lookOf(src.statuses?.[key]); if (look) out.statuses[key] = look; }
  for (const key of PRIORITY_KEYS) { const look = lookOf(src.priorities?.[key]); if (look) out.priorities[key] = look; }
  const seen = new Set(CORE_STATUS_KEYS);
  for (const status of Array.isArray(src.customStatuses) ? src.customStatuses : []) {
    if (!isObject(status) || !/^c_[a-z0-9_]{1,24}$/.test(String(status.key || '')) || seen.has(status.key)) continue;
    const label = String(status.label ?? '').trim().slice(0, 30);
    if (!label || !STATUS_KINDS[status.kind]) continue;
    seen.add(status.key);
    out.customStatuses.push({key: status.key, label, kind: status.kind, color: validColor(status.color) || '#475569'});
    if (out.customStatuses.length >= 12) break;
  }
  for (const source of allWorkSources()) if (isObject(src.sources) && source.type in src.sources) out.sources[source.type] = Boolean(src.sources[source.type]);
  for (const source of allWorkSources()) if (isObject(src.lookback) && Number.isFinite(Number(src.lookback[source.type]))) out.lookback[source.type] = num(src.lookback[source.type], 7, 3650, 90);
  out.staleFileDays = num(src.staleFileDays, 7, 730, DEFAULT_WORK_CONFIG.staleFileDays);
  out.summaryWindowDays = num(src.summaryWindowDays, 7, 120, DEFAULT_WORK_CONFIG.summaryWindowDays);
  out.upcomingDays = num(src.upcomingDays, 3, 60, DEFAULT_WORK_CONFIG.upcomingDays);
  out.urgentWithinDays = num(src.urgentWithinDays, 0, 14, DEFAULT_WORK_CONFIG.urgentWithinDays);
  if (isObject(src.attention?.rules)) for (const [key, value] of Object.entries(src.attention.rules)) if (/^[a-zA-Z]{2,30}$/.test(key)) out.attention.rules[key] = Boolean(value);
  if (isObject(src.notifications)) {
    out.notifications.enabled = src.notifications.enabled !== false;
    out.notifications.maxVisible = num(src.notifications.maxVisible, 1, 6, 3);
  }
  return out;
}

export const getWorkConfig = () => sanitizeWorkConfig(prefs.get(WORK_CONFIG_KEY, null));
export async function saveWorkConfig(patch = {}) {
  const current = getWorkConfig();
  const next = sanitizeWorkConfig({...current, ...patch,
    statuses: {...current.statuses, ...(patch.statuses || {})}, priorities: {...current.priorities, ...(patch.priorities || {})},
    sources: {...current.sources, ...(patch.sources || {})}, lookback: {...current.lookback, ...(patch.lookback || {})},
    attention: {rules: {...current.attention.rules, ...(patch.attention?.rules || {})}},
    notifications: {...current.notifications, ...(patch.notifications || {})}});
  await prefs.set(WORK_CONFIG_KEY, next);
  return next;
}
export const resetWorkConfig = () => prefs.set(WORK_CONFIG_KEY, null);

// ---------- حالة الصفحة (تُحفظ وتُستعاد) ----------
export const DEFAULT_WORK_STATE = Object.freeze({range: 'today', from: '', to: '', view: 'cards', q: '', filters: {}, pageSize: 25});
const RANGE_KEYS = WORK_RANGES.map(([key]) => key);
const VIEW_KEYS = WORK_VIEWS.map(([key]) => key);
const strArr = (value, max = 30) => Array.isArray(value) ? [...new Set(value.map(v => String(v).slice(0, 80)).filter(Boolean))].slice(0, max) : [];

export function sanitizeWorkFilters(raw) {
  const f = isObject(raw) ? raw : {};
  const out = {};
  const kinds = strArr(f.kinds, 3).filter(k => ['open', 'done', 'cancelled'].includes(k));
  if (kinds.length) out.kinds = kinds;
  for (const key of ['statuses', 'priorities', 'sources', 'types', 'tags']) { const list = strArr(f[key]); if (list.length) out[key] = list; }
  if (out.priorities) out.priorities = out.priorities.filter(p => PRIORITY_KEYS.includes(p));
  if (out.priorities && !out.priorities.length) delete out.priorities;
  if (f.pinned) out.pinned = true;
  if (['any', 'only'].includes(f.archived)) out.archived = f.archived;
  for (const key of ['fileId', 'caseId', 'clientId', 'relatedId', 'quadrant']) if (f[key]) out[key] = String(f[key]).slice(0, 60);
  return out;
}
export function sanitizeWorkState(raw) {
  const s = isObject(raw) ? raw : {};
  return {
    range: RANGE_KEYS.includes(s.range) ? s.range : DEFAULT_WORK_STATE.range,
    from: /^\d{4}-\d{2}-\d{2}$/.test(s.from || '') ? s.from : '', to: /^\d{4}-\d{2}-\d{2}$/.test(s.to || '') ? s.to : '',
    view: VIEW_KEYS.includes(s.view) ? s.view : DEFAULT_WORK_STATE.view,
    q: String(s.q ?? '').slice(0, 120), filters: sanitizeWorkFilters(s.filters),
    pageSize: [25, 50, 100].includes(Number(s.pageSize)) ? Number(s.pageSize) : DEFAULT_WORK_STATE.pageSize
  };
}
export const getWorkState = () => sanitizeWorkState(prefs.get(WORK_STATE_KEY, null));
export async function saveWorkState(patch = {}) {
  const next = sanitizeWorkState({...getWorkState(), ...patch});
  await prefs.set(WORK_STATE_KEY, next);
  return next;
}

// ---------- العروض المحفوظة ----------
export function listWorkViews() {
  const list = prefs.get(WORK_VIEWS_KEY, []);
  return (Array.isArray(list) ? list : []).filter(v => isObject(v) && v.id && v.name).map(v => ({id: String(v.id), name: String(v.name).slice(0, 60), state: sanitizeWorkState(v.state), createdAt: v.createdAt || ''}));
}
export async function saveWorkView(name, state, id = null) {
  const title = String(name || '').trim().slice(0, 60);
  if (!title) throw new Error('اسم العرض مطلوب.');
  const list = listWorkViews();
  const clean = sanitizeWorkState(state);
  const at = id ? list.findIndex(v => v.id === id) : -1;
  if (at >= 0) list[at] = {...list[at], name: title, state: clean};
  else {
    if (list.length >= MAX_SAVED_VIEWS) throw new Error(`الحد الأقصى للعروض المحفوظة ${MAX_SAVED_VIEWS}.`);
    list.push({id: uid(), name: title, state: clean, createdAt: Clock.now()});
  }
  await prefs.set(WORK_VIEWS_KEY, list);
  return list;
}
export async function removeWorkView(id) {
  const list = listWorkViews().filter(v => v.id !== id);
  await prefs.set(WORK_VIEWS_KEY, list);
  return list;
}
