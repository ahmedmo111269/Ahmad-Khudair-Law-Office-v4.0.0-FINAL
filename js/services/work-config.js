// =====================================================================
// مركز العمل — الإعدادات والحالة المحفوظة (تفضيلات المستخدم عبر prefs الموجودة؛ بلا مخزن/نظام إعدادات جديد).
//   ui:workcenter-config : تسميات/ألوان الحالات الأساسية والأولويات، ألوان الحالات المخصصة، المصادر المفعّلة، عتبات القواعد الذكية.
//   الحالات المخصصة نفسها (الاسم والترتيب) في Lookups داخل قاعدة المكتب (work-statuses.js) وتُدمج في getWorkConfig() من لقطة الذاكرة.
//   ui:workcenter-state  : آخر نطاق/عرض/فلاتر (يُستعاد بعد التحديث).
//   ui:workcenter-views  : العروض المحفوظة (Saved Views).
// طي/فتح الأقسام يُحفظ في نظام collapse-state الموجود، وإعدادات الجدول في تفضيلات DataGrid الموجودة.
// =====================================================================
import {prefs} from '../core/preferences.js';
import {uid} from '../core/id.js';
import {Clock} from '../core/clock.js';
import {validColor, PRIORITY_KEYS, WORK_RANGES, WORK_VIEWS, CORE_STATUS_KEYS, DAY_LAYOUTS, isCustomStatusKey} from '../domain/work-items.js';
import {customStatusSnapshot} from './work-statuses.js';
import {allWorkSources} from '../domain/work-sources.js';

export const WORK_CONFIG_KEY = 'ui:workcenter-config';
export const WORK_STATE_KEY = 'ui:workcenter-state';
export const WORK_VIEWS_KEY = 'ui:workcenter-views';
export const MAX_SAVED_VIEWS = 30;

export const DEFAULT_WORK_CONFIG = Object.freeze({
  version: 1, statuses: {}, customStatuses: [], retiredStatuses: [], priorities: {}, sources: {}, lookback: {},
  staleFileDays: 30, summaryWindowDays: 45, upcomingDays: 14, urgentWithinDays: 2,
  tomorrowPrepAfter: '17:00',
  attention: {rules: {}}, notifications: {enabled: true, maxVisible: 2}
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
  const out = {...DEFAULT_WORK_CONFIG, statuses: {}, customStatuses: [], retiredStatuses: [], priorities: {}, sources: {}, lookback: {}, attention: {rules: {}}, notifications: {...DEFAULT_WORK_CONFIG.notifications}};
  for (const key of CORE_STATUS_KEYS) { const look = lookOf(src.statuses?.[key]); if (look) out.statuses[key] = look; }
  for (const key of PRIORITY_KEYS) { const look = lookOf(src.priorities?.[key]); if (look) out.priorities[key] = look; }
  // الحالات المخصصة: لونها فقط يُحفظ هنا (تخصيص عرض على الجهاز)؛ وجودها وتسميتها في Lookups، فلا تُحفظ قائمتها في التفضيلات.
  let customLooks = 0;
  if (isObject(src.statuses)) for (const [key, value] of Object.entries(src.statuses)) {
    if (!isCustomStatusKey(key) || customLooks >= 60) continue;
    const color = isObject(value) ? validColor(value.color) : '';
    if (color) { out.statuses[key] = {color}; customLooks++; }
  }
  for (const source of allWorkSources()) if (isObject(src.sources) && source.type in src.sources) out.sources[source.type] = Boolean(src.sources[source.type]);
  for (const source of allWorkSources()) if (isObject(src.lookback) && Number.isFinite(Number(src.lookback[source.type]))) out.lookback[source.type] = num(src.lookback[source.type], 7, 3650, 90);
  out.staleFileDays = num(src.staleFileDays, 7, 730, DEFAULT_WORK_CONFIG.staleFileDays);
  out.summaryWindowDays = num(src.summaryWindowDays, 7, 120, DEFAULT_WORK_CONFIG.summaryWindowDays);
  out.upcomingDays = num(src.upcomingDays, 3, 60, DEFAULT_WORK_CONFIG.upcomingDays);
  out.urgentWithinDays = num(src.urgentWithinDays, 0, 14, DEFAULT_WORK_CONFIG.urgentWithinDays);
  const prepTime = String(src.tomorrowPrepAfter || '').trim();
  out.tomorrowPrepAfter = /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(prepTime) ? prepTime : DEFAULT_WORK_CONFIG.tomorrowPrepAfter;
  if (isObject(src.attention?.rules)) for (const [key, value] of Object.entries(src.attention.rules)) if (/^[a-zA-Z]{2,30}$/.test(key)) out.attention.rules[key] = Boolean(value);
  if (isObject(src.notifications)) {
    out.notifications.enabled = src.notifications.enabled !== false;
    out.notifications.maxVisible = num(src.notifications.maxVisible, 1, 6, 2);
  }
  return out;
}

/** الإعدادات المدموجة: تفضيلات الجهاز + الحالات المخصصة من لقطة Lookups (تُحمَّل عبر ensureWorkStatuses عند أول استعلام/نموذج/فتح الصفحة). */
export function getWorkConfig() {
  const config = sanitizeWorkConfig(prefs.get(WORK_CONFIG_KEY, null));
  const {custom, retired} = customStatusSnapshot();
  config.customStatuses = [...custom];
  config.retiredStatuses = [...retired];
  return config;
}
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
export const DEFAULT_WORK_STATE = Object.freeze({range: 'today', from: '', to: '', view: 'cards', q: '', filters: {}, pageSize: 25, dayLayout: 'parts'});
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
  if (f.undatedOnly) out.undatedOnly = true;
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
    pageSize: [25, 50, 100].includes(Number(s.pageSize)) ? Number(s.pageSize) : DEFAULT_WORK_STATE.pageSize,
    dayLayout: DAY_LAYOUTS.some(([key]) => key === s.dayLayout) ? s.dayLayout : DEFAULT_WORK_STATE.dayLayout
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

// ---------- مكتب اليوم: نصوص الأسباب والإجراءات (مصدر واحد) ----------
// كل نص يظهر على الرئيسية أو مركز العمل يأتي من هنا فقط، ولا تُكرَّر الشروط أو النصوص داخل المكوّنات.
// reasonCode يُشتق من بيانات موجودة فعلًا (لا حقول مخترعة)، ويُحدَّد في focus-engine.js.
export const REASON_TEXT = Object.freeze({
  SESSION_TODAY: Object.freeze({title: 'جلسة اليوم', why: 'موعدها اليوم ولم تُسجَّل نتيجتها بعد'}),
  SESSION_SOON: Object.freeze({title: 'جلسة قادمة', why: 'موعدها خلال {days} يوم'}),
  SESSION_DONE: Object.freeze({title: 'جلسة مسجّلة', why: 'سُجّلت نتيجتها'}),
  OVERDUE: Object.freeze({title: 'عمل متأخر', why: 'تجاوز موعده الداخلي بـ {days} يوم'}),
  HIGH_PRIORITY: Object.freeze({title: 'أولوية عاجلة', why: 'مصنّف عاجلًا ويقترب موعده'}),
  DUE_SOON: Object.freeze({title: 'عمل قريب', why: 'موعده الداخلي خلال {days} يوم'}),
  APPT_TODAY: Object.freeze({title: 'موعد اليوم', why: 'موعد مسجّل لليوم'}),
  APPT_SOON: Object.freeze({title: 'موعد قادم', why: 'موعده خلال {days} يوم'}),
  FOLLOWUP_DUE: Object.freeze({title: 'متابعة مستحقة', why: 'تاريخ متابعة الاتصال خلال {days} يوم'}),
  EXECUTION_URGENT: Object.freeze({title: 'تنفيذ يحتاج قرارًا', why: 'إجراء تنفيذ مستحق أو متأخر'}),
  POA_EXPIRED: Object.freeze({title: 'توكيل منتهٍ', why: 'انتهى بتاريخ {date}'}),
  POA_EXPIRING: Object.freeze({title: 'توكيل قريب الانتهاء', why: 'ينتهي خلال {days} يوم'}),
  STALE_FILE: Object.freeze({title: 'ملف راكد', why: 'لا نشاط فيه منذ أكثر من {days} يومًا'}),
  CONFLICT: Object.freeze({title: 'تعارض في الموعد', why: '{count} عناصر تبدأ في {time}'})
});

/** نص السبب لعرضه: يملأ {params} من focus-engine. مفتاح غير معروف ⇒ سطر فارغ (لا تخمين). */
export function reasonText(code, params = {}) {
  const row = REASON_TEXT[code];
  if (!row) return {title: '', why: ''};
  const fill = text => String(text).replace(/\{(\w+)\}/g, (_, key) => (params[key] ?? '') === '' ? '—' : String(params[key]));
  return {title: row.title, why: fill(row.why)};
}

/**
 * خريطة الإجراء الموحدة: كل عنصر في الطابور/الخطوة التالية يأخذ إجراءه من هنا.
 * لا إجراء إلا ما تدعمه حالة السجل فعلًا (جلسة بلا نتيجة ⇒ تسجيل النتيجة، لا غير).
 */
export const ACTION_LABEL = Object.freeze({
  recordResult: 'تسجيل النتيجة',
  openHearing: 'فتح الجلسة',
  openProcedure: 'تنفيذ',
  openAppointment: 'فتح الموعد',
  openFollowup: 'فتح المتابعة',
  openPoa: 'فتح التوكيل',
  reviewFile: 'مراجعة الملف',
  openExecution: 'تنفيذ',
  openItem: 'فتح'
});
/** اختيار مفتاح الإجراء من نوع العنصر وحالته فقط (نقية). */
export function actionKeyFor(kind, state = {}) {
  if (kind === 'hearing') return state.today && !state.done ? 'recordResult' : 'openHearing';
  if (kind === 'procedure') return 'openProcedure';
  if (kind === 'poa') return 'openPoa';
  if (kind === 'appointment') return 'openAppointment';
  if (kind === 'followup') return 'openFollowup';
  if (kind === 'file') return 'reviewFile';
  if (kind === 'execution') return 'openExecution';
  return 'openItem';
}

/** حدود العرض في مكتب اليوم (إعدادات config لا قواعد قانونية). */
export const HOME_LIMITS = Object.freeze({
  queuePerGroup: 5,          // أعلى عدد في كل طبقة من الطابور قبل «عرض الكل»
  sinceLastVisit: 15,        // أقصى عدد تغييرات في «منذ آخر زيارة»
  postponeReviewAt: 3,       // عدد التأجيلات الذي ينقل العمل إلى «يحتاج مراجعة» (إشارة تشغيلية فقط)
  nowWindow: {before: 30, after: 90}  // نافذة «الآن» بالدقائق: من −30 إلى +90 دقيقة من الآن
});
