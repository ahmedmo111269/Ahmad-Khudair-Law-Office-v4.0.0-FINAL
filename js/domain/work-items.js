// =====================================================================
// مركز العمل — نموذج «عنصر العمل» (Work Item): ثوابت وقواعد نقية بلا IndexedDB ولا DOM.
// ---------------------------------------------------------------------
// • عنصر العمل إمّا صف مستقل في workItems (kind='native': مهمة جديدة) أو إسقاط/طبقة فوق سجل أصلي
//   (kind='overlay': جلسة، عمل إداري، موعد، متابعة اتصال، خطوة ملف…). لا تُنسخ أي بيانات قانونية:
//   الموكل/الخصم/القضية/المحكمة تُقرأ بالمعرّفات عند العرض فقط (مصدر وحيد للحقيقة).
// • كل ما هنا قابل للاختبار دون قاعدة بيانات. القيم الظاهرة (تسميات/ألوان) تُدمج مع إعدادات المستخدم.
// =====================================================================
import {addDays} from '../core/clock.js';

export const WORK_KIND = Object.freeze({native: 'native', overlay: 'overlay'});
export const OVERLAY_SEP = '::';
/** معرّف الطبقة التشغيلية فوق سجل أصلي: حتمي، فلا يمكن أن تتكرر طبقتان لسجل واحد. */
export const overlayId = (sourceType, sourceId) => `${sourceType}${OVERLAY_SEP}${sourceId}`;
export function parseOverlayId(id) {
  const text = String(id || '');
  const at = text.indexOf(OVERLAY_SEP);
  return at > 0 ? {sourceType: text.slice(0, at), sourceId: text.slice(at + OVERLAY_SEP.length)} : null;
}
/** يظهر هذا التاريخ كـ«بلا موعد» ويُرتّب أخيرًا. */
export const NO_DATE_KEY = '9999-99-99';
export const NO_TIME_KEY = '99:99';

// ---------- الحالات ----------
// kind: open = لا يزال مطلوبًا · done = مكتمل · cancelled = ملغى. «مؤرشف» ليس حالة بل علم منفصل (archivedAt).
export const DEFAULT_WORK_STATUSES = Object.freeze([
  Object.freeze({key: 'notStarted', label: 'لم يبدأ', kind: 'open', icon: '○', color: '#64748b'}),
  Object.freeze({key: 'inProgress', label: 'قيد التنفيذ', kind: 'open', icon: '◐', color: '#2563eb'}),
  Object.freeze({key: 'waiting', label: 'بانتظار', kind: 'open', icon: '⏳', color: '#7c3aed'}),
  Object.freeze({key: 'postponed', label: 'مؤجل', kind: 'open', icon: '⏭', color: '#b45309'}),
  Object.freeze({key: 'done', label: 'مكتمل', kind: 'done', icon: '✓', color: '#15803d'}),
  Object.freeze({key: 'cancelled', label: 'ملغى', kind: 'cancelled', icon: '✕', color: '#b91c1c'})
]);
export const CORE_STATUS_KEYS = Object.freeze(DEFAULT_WORK_STATUSES.map(s => s.key));
export const ARCHIVED_LABEL = 'مؤرشف';
export const STATUS_KINDS = Object.freeze({open: 'مفتوح', done: 'مكتمل', cancelled: 'ملغى'});

// ---------- الأولويات ----------
// اللون وحده لا يكفي: لكل مستوى أيضًا رمز نصي (mark) وأيقونة وتسمية.
export const DEFAULT_WORK_PRIORITIES = Object.freeze([
  Object.freeze({key: 'urgent', label: 'عاجل جدًا', icon: '🔴', mark: '!!!', rank: 4, color: '#dc2626'}),
  Object.freeze({key: 'high', label: 'مرتفعة', icon: '🟠', mark: '!!', rank: 3, color: '#ea580c'}),
  Object.freeze({key: 'medium', label: 'متوسطة', icon: '🟡', mark: '!', rank: 2, color: '#a16207'}),
  Object.freeze({key: 'low', label: 'منخفضة', icon: '🟢', mark: '–', rank: 1, color: '#15803d'})
]);
export const PRIORITY_KEYS = Object.freeze(DEFAULT_WORK_PRIORITIES.map(p => p.key));
export const DEFAULT_PRIORITY = 'medium';

// ---------- أنواع المصادر ----------
export const TASK_SOURCE = 'task';
export const SOURCE_LABELS = Object.freeze({
  task: 'مهمة', hearings: 'جلسة', procedures: 'عمل إداري', appointments: 'موعد',
  communications: 'متابعة اتصال', files: 'خطوة تالية للملف', serviceRecords: 'إعلان / إنذار'
});

// ---------- النطاقات الزمنية وطرق العرض ----------
export const WORK_RANGES = Object.freeze([
  ['today', 'اليوم'], ['tomorrow', 'غدًا'], ['week', 'هذا الأسبوع'], ['nextWeek', 'الأسبوع القادم'],
  ['month', 'هذا الشهر'], ['nextMonth', 'الشهر القادم'], ['year', 'السنة'], ['overdue', 'متأخر'],
  ['custom', 'مخصص'], ['all', 'الكل']
]);
export const WORK_VIEWS = Object.freeze([
  ['cards', 'بطاقات'], ['list', 'قائمة'], ['kanban', 'كانبان'], ['matrix', 'مصفوفة الأولويات'],
  ['calendar', 'تقويم'], ['overdue', 'المتأخر'], ['upcoming', 'القادم'], ['completed', 'المنجز'],
  ['attention', 'يحتاج انتباهي'], ['productivity', 'الإنتاجية']
]);
export const SNOOZE_OPTIONS = Object.freeze([
  ['tomorrow', 'غدًا'], ['twoDays', 'بعد يومين'], ['nextWeek', 'الأسبوع القادم'], ['nextMonth', 'الشهر القادم'], ['custom', 'تاريخ مخصص']
]);
export const COMMENT_TYPES = Object.freeze([
  ['note', 'ملاحظة'], ['comment', 'تعليق'], ['update', 'تحديث'], ['result', 'نتيجة'],
  ['postponeReason', 'سبب التأجيل'], ['instruction', 'تعليمات']
]);
export const COMMENT_TYPE_KEYS = Object.freeze(COMMENT_TYPES.map(([key]) => key));
export const QUADRANTS = Object.freeze([
  Object.freeze({key: 'q1', label: 'مهم وعاجل', hint: 'افعله الآن', important: true, urgent: true}),
  Object.freeze({key: 'q2', label: 'مهم وغير عاجل', hint: 'خطّط له', important: true, urgent: false}),
  Object.freeze({key: 'q3', label: 'عاجل وغير مهم', hint: 'اختصره أو فوّضه', important: false, urgent: true}),
  Object.freeze({key: 'q4', label: 'غير مهم وغير عاجل', hint: 'أجّله أو أعد النظر فيه', important: false, urgent: false})
]);
export const AGING_BUCKETS = Object.freeze([
  Object.freeze({key: 'd1', label: 'تأخر يومًا', from: 1, to: 1}),
  Object.freeze({key: 'd2_3', label: 'تأخر 2–3 أيام', from: 2, to: 3}),
  Object.freeze({key: 'd4_7', label: 'تأخر 4–7 أيام', from: 4, to: 7}),
  Object.freeze({key: 'd8_30', label: 'تأخر 8–30 يومًا', from: 8, to: 30}),
  Object.freeze({key: 'd31', label: 'تأخر أكثر من 30 يومًا', from: 31, to: Infinity})
]);
export const DAY_PARTS = Object.freeze([
  ['morning', 'صباحًا'], ['hearings', 'الجلسات'], ['admin', 'الأعمال الإدارية'], ['followups', 'المتابعات'], ['undated', 'بلا موعد']
]);

// ---------- التواريخ والأوقات ----------
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const isIsoDate = value => typeof value === 'string' && DATE_RE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00`)) && new Date(`${value}T00:00:00`).getDate() === Number(value.slice(8, 10));
export const normalizeTime = value => {
  const text = String(value ?? '').trim().replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
  const padded = /^\d:\d{2}$/.test(text) ? `0${text}` : text;
  return TIME_RE.test(padded) ? padded : '';
};
const dayNumber = day => Math.round(new Date(`${day}T00:00:00Z`).getTime() / 86400000);
/** عدد الأيام من a إلى b (موجب إذا كان b بعد a). */
export const dayDiff = (a, b) => dayNumber(b) - dayNumber(a);
export const dateOnly = value => String(value || '').slice(0, 10);

export function snoozeTarget(option, today, custom = '') {
  switch (option) {
    case 'tomorrow': return addDays(today, 1);
    case 'twoDays': return addDays(today, 2);
    case 'nextWeek': return addDays(today, 7);
    case 'nextMonth': {
      const d = new Date(`${today}T00:00:00`), want = d.getMonth() + 1, day = d.getDate();
      d.setDate(1); d.setMonth(want);
      const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(day, last));
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    case 'custom': return isIsoDate(custom) ? custom : '';
    default: return '';
  }
}

/** مفتاح الترتيب الكلي: التاريخ ثم الوقت ثم الأولوية (الأعلى أولًا) ثم المعرّف. نص قابل للمقارنة المباشرة ويصلح مؤشرًا للصفحات. */
export function sortKeyOf({dueDate, dueTime, priority, id}, priorityRankOf = priorityRank) {
  return `${isIsoDate(dueDate) ? dueDate : NO_DATE_KEY}|${normalizeTime(dueTime) || NO_TIME_KEY}|${9 - priorityRankOf(priority)}|${id}`;
}
export const keyDate = key => String(key || '').slice(0, 10);

// ---------- الإعدادات المدموجة (تسميات/ألوان/حالات مخصصة) ----------
export function mergeStatuses(config = {}) {
  const overrides = config.statuses || {};
  const base = DEFAULT_WORK_STATUSES.map(status => ({...status, ...cleanLook(overrides[status.key])}));
  const custom = (Array.isArray(config.customStatuses) ? config.customStatuses : [])
    .filter(s => s && /^c_[a-z0-9_]{1,24}$/.test(String(s.key || '')) && String(s.label || '').trim() && STATUS_KINDS[s.kind])
    .map(s => ({key: s.key, label: String(s.label).trim().slice(0, 30), kind: s.kind, icon: s.kind === 'done' ? '✓' : s.kind === 'cancelled' ? '✕' : '●', color: validColor(s.color) || '#475569', custom: true}));
  return [...base, ...custom];
}
export function mergePriorities(config = {}) {
  const overrides = config.priorities || {};
  return DEFAULT_WORK_PRIORITIES.map(priority => ({...priority, ...cleanLook(overrides[priority.key])}));
}
function cleanLook(value) {
  const out = {};
  if (value && typeof value === 'object') {
    const label = String(value.label ?? '').trim().slice(0, 30);
    if (label) out.label = label;
    const color = validColor(value.color);
    if (color) out.color = color;
  }
  return out;
}
export const validColor = value => /^#[0-9a-fA-F]{6}$/.test(String(value || '')) ? String(value).toLowerCase() : '';

export function statusInfo(key, config = {}) {
  return mergeStatuses(config).find(s => s.key === key) || {key, label: String(key || 'غير معروف'), kind: 'open', icon: '●', color: '#475569', unknown: true};
}
export function statusKindOf(key, config = {}) {
  return statusInfo(key, config).kind;
}
export function isOpenStatus(key, config = {}) {
  return statusKindOf(key, config) === 'open';
}
export function priorityInfo(key, config = {}) {
  const list = mergePriorities(config);
  return list.find(p => p.key === key) || list.find(p => p.key === DEFAULT_PRIORITY);
}
export function priorityRank(key) {
  return DEFAULT_WORK_PRIORITIES.find(p => p.key === key)?.rank || 2;
}
export const validPriority = key => PRIORITY_KEYS.includes(key) ? key : DEFAULT_PRIORITY;

// ---------- تصنيف المواعيد ----------
/** overdue | today | tomorrow | week (خلال 7 أيام) | later | undated */
export function classifyDue(dueDate, today) {
  if (!isIsoDate(dueDate)) return 'undated';
  const diff = dayDiff(today, dueDate);
  if (diff < 0) return 'overdue';
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff <= 7) return 'week';
  return 'later';
}
export function agingBucket(dueDate, today) {
  if (!isIsoDate(dueDate)) return null;
  const late = dayDiff(dueDate, today);
  if (late < 1) return null;
  return AGING_BUCKETS.find(bucket => late >= bucket.from && late <= bucket.to) || AGING_BUCKETS.at(-1);
}
export const daysLate = (dueDate, today) => isIsoDate(dueDate) ? Math.max(0, dayDiff(dueDate, today)) : 0;

/**
 * مصفوفة أيزنهاور: الأهمية من الأولوية (عاجل جدًا/مرتفعة = مهم) والاستعجال من قرب الموعد (متأخر أو خلال يومين).
 * التصنيف اليدوي (item.quadrant) يتفوق على التلقائي. بلا موعد = غير عاجل.
 */
export function classifyQuadrant(item, today, {urgentWithinDays = 2} = {}) {
  if (QUADRANTS.some(q => q.key === item?.quadrant)) return item.quadrant;
  const important = priorityRank(item?.priority) >= 3;
  const due = item?.dueDate;
  const urgent = isIsoDate(due) && dayDiff(today, due) <= urgentWithinDays;
  return important ? (urgent ? 'q1' : 'q2') : (urgent ? 'q3' : 'q4');
}

// ---------- التحقق والتطبيع للمهام المستقلة ----------
const clean = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const cleanText = (value, max) => String(value ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);
export const MAX_TITLE = 200;
export const MAX_DESCRIPTION = 5000;

export function normalizeTags(value) {
  const list = Array.isArray(value) ? value : String(value ?? '').split(/[,،\n]/);
  const out = [];
  for (const tag of list) {
    const text = clean(tag, 40);
    if (text && !out.includes(text)) out.push(text);
    if (out.length >= 20) break;
  }
  return out;
}

/** {errors, data}: التطبيع لا يكتب أي بيانات قانونية؛ الروابط معرّفات فقط. */
export function validateNativeInput(input = {}, {statuses = DEFAULT_WORK_STATUSES.map(s => s.key)} = {}) {
  const errors = {};
  const title = clean(input.title, MAX_TITLE);
  if (!title) errors.title = 'عنوان المهمة مطلوب';
  if (clean(input.title, 10000).length > MAX_TITLE) errors.title = `العنوان أطول من ${MAX_TITLE} حرفًا`;
  const dueDate = String(input.dueDate ?? '').trim();
  if (dueDate && !isIsoDate(dueDate)) errors.dueDate = 'تاريخ غير صحيح';
  const rawTime = String(input.dueTime ?? '').trim();
  const dueTime = normalizeTime(rawTime);
  if (rawTime && !dueTime) errors.dueTime = 'وقت غير صحيح';
  if (input.dueTime && !dueDate && dueTime) errors.dueDate = 'حدد التاريخ مع الوقت';
  const status = String(input.status || 'notStarted');
  if (!statuses.includes(status)) errors.status = 'حالة غير معروفة';
  if (input.priority && !PRIORITY_KEYS.includes(input.priority)) errors.priority = 'أولوية غير معروفة';
  const description = cleanText(input.description, MAX_DESCRIPTION);
  const data = {
    title, description, type: clean(input.type, 60), dueDate, dueTime: dueDate ? dueTime : '',
    status, priority: validPriority(input.priority), tags: normalizeTags(input.tags),
    fileId: clean(input.fileId, 40), caseId: clean(input.caseId, 40), clientId: clean(input.clientId, 40), opponentId: clean(input.opponentId, 40),
    relatedType: clean(input.relatedType, 40), relatedId: clean(input.relatedId, 40)
  };
  if (data.relatedId && !data.relatedType) errors.relatedType = 'نوع السجل المرتبط مطلوب';
  return {errors, data};
}

// ---------- التكرار (Recurrence) — تعريف + توليد افتراضي نقي ----------
export const RECURRENCE_FREQS = Object.freeze([['daily', 'يوميًا'], ['weekly', 'أسبوعيًا'], ['monthly', 'شهريًا'], ['yearly', 'سنويًا']]);
export const WEEKDAYS = Object.freeze(['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']);
export const RECURRENCE_MAX_OCCURRENCES = 400;
export const RECURRENCE_LOOKBACK_DAYS = 30;

export function normalizeRule(rule = {}) {
  const freq = RECURRENCE_FREQS.some(([key]) => key === rule.freq) ? rule.freq : 'weekly';
  const interval = Math.min(Math.max(parseInt(rule.interval, 10) || 1, 1), 99);
  const byWeekday = [...new Set((Array.isArray(rule.byWeekday) ? rule.byWeekday : []).map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6))].sort();
  const byMonthDay = Number.isInteger(Number(rule.byMonthDay)) && Number(rule.byMonthDay) >= 1 && Number(rule.byMonthDay) <= 31 ? Number(rule.byMonthDay) : 0;
  const until = isIsoDate(rule.until) ? rule.until : '';
  const count = Number.isInteger(Number(rule.count)) && Number(rule.count) > 0 ? Math.min(Number(rule.count), 1000) : 0;
  return {freq, interval, byWeekday, byMonthDay, until, count};
}
export function describeRule(rule) {
  const r = normalizeRule(rule), every = r.interval > 1 ? `كل ${r.interval} ` : '';
  const label = {daily: r.interval > 1 ? 'أيام' : 'يوميًا', weekly: r.interval > 1 ? 'أسابيع' : 'أسبوعيًا', monthly: r.interval > 1 ? 'أشهر' : 'شهريًا', yearly: r.interval > 1 ? 'سنوات' : 'سنويًا'}[r.freq];
  const days = r.freq === 'weekly' && r.byWeekday.length ? ` (${r.byWeekday.map(d => WEEKDAYS[d]).join('، ')})` : '';
  const end = r.until ? ` حتى ${r.until}` : r.count ? ` (${r.count} مرة)` : '';
  return `${every}${label}${days}${end}`.trim();
}

const parts = day => ({y: Number(day.slice(0, 4)), m: Number(day.slice(5, 7)), d: Number(day.slice(8, 10))});
const fmt = (y, m, d) => `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const lastDayOf = (y, m) => new Date(y, m, 0).getDate();
const weekdayOf = day => new Date(`${day}T00:00:00`).getDay();

/**
 * يولّد تواريخ التكرار داخل [from,to] (شاملة) دون المساس بأي مخزن.
 * تبدأ من startDate وتنتهي عند until أو count أو الحد الأقصى؛ التكرار لا يعتمد على آخر إنجاز.
 */
export function expandRecurrence(ruleInput, startDate, from, to, {limit = RECURRENCE_MAX_OCCURRENCES} = {}) {
  if (!isIsoDate(startDate) || !isIsoDate(from) || !isIsoDate(to) || from > to) return [];
  const rule = normalizeRule(ruleInput), out = [];
  const hardEnd = rule.until && rule.until < to ? rule.until : to;
  if (startDate > hardEnd) return [];
  let produced = 0;                      // عدد الأحداث المنتجة منذ البداية (يلزم فقط مع count)
  const wantsCount = rule.count > 0;
  const emit = day => {
    if (day < startDate || day > hardEnd) return day > hardEnd ? 'stop' : 'skip';
    produced++;
    if (wantsCount && produced > rule.count) return 'stop';
    if (day >= from) { out.push(day); if (out.length >= limit) return 'stop'; }
    return 'ok';
  };
  const s = parts(startDate);
  if (rule.freq === 'daily') {
    let n = wantsCount ? 0 : Math.max(0, Math.ceil(dayDiff(startDate, from) / rule.interval));
    for (let guard = 0; guard < 20000; guard++, n++) {
      const day = addDays(startDate, n * rule.interval);
      if (emit(day) === 'stop') break;
    }
  } else if (rule.freq === 'weekly') {
    const days = rule.byWeekday.length ? rule.byWeekday : [weekdayOf(startDate)];
    const weekStart = addDays(startDate, -weekdayOf(startDate));   // الأحد الذي يبدأ منه أسبوع البداية
    let w = wantsCount ? 0 : Math.max(0, Math.floor(dayDiff(weekStart, from) / (7 * rule.interval)) - 1);
    for (let guard = 0; guard < 5000; guard++, w++) {
      const base = addDays(weekStart, w * 7 * rule.interval);
      if (base > hardEnd) break;
      let stop = false;
      for (const dow of days) { const r = emit(addDays(base, dow)); if (r === 'stop') { stop = true; break; } }
      if (stop) break;
    }
  } else if (rule.freq === 'monthly') {
    const dom = rule.byMonthDay || s.d;
    let n = wantsCount ? 0 : Math.max(0, Math.floor(((parts(from).y - s.y) * 12 + (parts(from).m - s.m)) / rule.interval) - 1);
    for (let guard = 0; guard < 5000; guard++, n++) {
      const total = (s.m - 1) + n * rule.interval, y = s.y + Math.floor(total / 12), m = (total % 12) + 1;
      const day = fmt(y, m, Math.min(dom, lastDayOf(y, m)));
      if (day > hardEnd && fmt(y, m, 1) > hardEnd) break;
      if (emit(day) === 'stop') break;
    }
  } else {
    let n = wantsCount ? 0 : Math.max(0, Math.floor((parts(from).y - s.y) / rule.interval) - 1);
    for (let guard = 0; guard < 2000; guard++, n++) {
      const y = s.y + n * rule.interval;
      const day = fmt(y, s.m, Math.min(s.d, lastDayOf(y, s.m)));
      if (fmt(y, 1, 1) > hardEnd) break;
      if (emit(day) === 'stop') break;
    }
  }
  return out;
}

// ---------- النص القابل للبحث (يطابق منطق البحث الشامل: تطبيع عربي + كل الكلمات) ----------
/** يجمع حقول عنصر العمل والمراجع المقروءة حيًّا (لا يُخزَّن). */
export function workSearchFields(item = {}, refs = {}) {
  return [
    item.title, item.description, item.notes, item.typeLabel, item.sourceLabel, item.statusLabel,
    (item.tags || []).join(' '), item.dueDate,
    refs.fileLabel, refs.fileTitle, refs.caseNumber, refs.court,
    ...(refs.clients || []), ...(refs.opponents || []), ...(refs.comments || [])
  ].filter(Boolean).join(' ');
}

/** يُبدّل خيارات الأولوية/الحالة في تعريف نموذج المهمة بالتسميات المخصصة (لا يغيّر ENTITIES الثابت). */
export function workItemFieldOverrides(fields, config = {}) {
  const priorities = mergePriorities(config).map(p => [p.key, `${p.icon} ${p.label}`]);
  const statuses = mergeStatuses(config).map(s => [s.key, `${s.icon} ${s.label}`]);
  return fields.map(field => field.k === 'priority' ? {...field, opts: priorities} : field.k === 'status' ? {...field, opts: statuses} : field);
}
