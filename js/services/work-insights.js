// =====================================================================
// مركز العمل — الاستنتاجات الوصفية: «يحتاج انتباهي»، الاقتراحات، المراجعة اليومية/الأسبوعية، الإنتاجية.
// ---------------------------------------------------------------------
// • قواعد صريحة وقابلة للتوسع (سجل ATTENTION_RULES) — لا ذكاء اصطناعي خارجي ولا اتصال بالإنترنت.
// • لا حسابات مواعيد قانونية ولا أحكام قانونية: كل ما هنا عدّ وتجميع وقرب مواعيد مسجّلة أصلًا.
// • كل الاستعلامات تمر عبر work-query (فهارس + حدود) ولا تحمّل كل السجلات.
// =====================================================================
import {Clock, addDays, localDate} from '../core/clock.js';
import {isClosedFile} from '../domain/entities.js';
import {dayDiff, priorityRank} from '../domain/work-items.js';
import {queryWorkItems, workSummary} from './work-query.js';
import {getWorkConfig} from './work-config.js';
import {ensureWorkStatuses} from './work-statuses.js';

/** سجل القواعد: أضف قاعدة جديدة بإدراج عنصر هنا فقط. test(item, ctx) → سبب نصي أو null. */
export const ATTENTION_RULES = [
  {key: 'overdue', label: 'متأخر', severity: 4, test: (it, c) => it.isOpen && it.dueDate && it.dueDate < c.today ? `متأخر ${dayDiff(it.dueDate, c.today)} يومًا` : null},
  {key: 'urgentSoon', label: 'عاجل ويقترب', severity: 3, test: (it, c) => it.isOpen && priorityRank(it.priority) >= 3 && it.dueDate && dayDiff(c.today, it.dueDate) >= 0 && dayDiff(c.today, it.dueDate) <= c.config.urgentWithinDays ? 'أولوية مرتفعة وموعده قريب' : null},
  {key: 'hearingSoon', label: 'جلسة قريبة', severity: 3, test: (it, c) => it.isOpen && it.sourceType === 'hearings' && it.dueDate && dayDiff(c.today, it.dueDate) >= 0 && dayDiff(c.today, it.dueDate) <= 3 ? 'جلسة خلال 3 أيام — راجع التجهيز' : null},
  {key: 'repeatedPostpone', label: 'تأجل مرارًا', severity: 2, test: it => it.isOpen && it.postponeCount >= 3 ? `أُجّل ${it.postponeCount} مرات — قرّر إنجازه أو إنهاءه` : null},
  {key: 'highNoDate', label: 'بلا موعد', severity: 2, test: it => it.isOpen && !it.dueDate && priorityRank(it.priority) >= 3 ? 'أولوية مرتفعة بلا موعد' : null},
  {key: 'sourceMissing', label: 'المصدر غير متاح', severity: 1, test: it => it.isOpen && !it.sourceAvailable ? 'المصدر غير متاح حاليًا' : null}
];

export function attentionReasons(item, ctx) {
  const enabled = ctx.config?.attention?.rules || {};
  const out = [];
  for (const rule of ATTENTION_RULES) {
    if (enabled[rule.key] === false) continue;
    const text = rule.test(item, ctx);
    if (text) out.push({key: rule.key, label: rule.label, text, severity: rule.severity});
  }
  return out;
}

/** ملفات مفتوحة بلا نشاط منذ N يومًا (فهرس lastActivityAt؛ حد أقصى للمسح والنتائج). */
export async function staleFiles(office, {today = Clock.today(), days = getWorkConfig().staleFileDays, limit = 12, maxScan = 1500} = {}) {
  const upper = `${addDays(today, -days)}T23:59:59`;
  const out = [];
  let cursor = null, scanned = 0;
  while (out.length < limit && scanned < maxScan) {
    const page = await office.r.files.page({index: 'lastActivityAt', upper, direction: 'prev', limit: 100, cursor, filter: f => !isClosedFile(f)});
    scanned += page.items.length;
    for (const f of page.items) { if (out.length < limit) out.push(f); }
    if (!page.hasMore) break;
    cursor = page.nextCursor;
  }
  return out.map(f => ({file: f, idleDays: dayDiff(String(f.lastActivityAt || '').slice(0, 10) || today, today)}));
}

/** عناصر «يحتاج انتباهي»: نافذة محدودة [اليوم − العمق، اليوم + 7] + بلا موعد؛ ثم تُرتَّب بالأشد. */
export async function attentionItems(office, {today = Clock.today(), limit = 40, signal = null} = {}) {
  await ensureWorkStatuses(office);
  const config = getWorkConfig();
  const page = await queryWorkItems(office, {range: 'custom', from: '', to: addDays(today, 7), kinds: ['open'], undated: true}, {limit: 1500, signal});
  const ctx = {today, config};
  const rows = [];
  for (const item of page.items) {
    const reasons = attentionReasons(item, ctx);
    if (reasons.length) rows.push({item, reasons, severity: Math.max(...reasons.map(r => r.severity))});
  }
  rows.sort((a, b) => b.severity - a.severity || String(a.item.dueDate || '9999').localeCompare(String(b.item.dueDate || '9999')));
  return {rows: rows.slice(0, limit), total: rows.length, capped: page.hasMore, files: await staleFiles(office, {today})};
}

// ---------- الاقتراحات الذكية (قواعد بلا ذكاء خارجي) ----------
export function buildSuggestions(summary, {staleCount = 0} = {}) {
  const out = [];
  const add = (key, tone, text, action = null) => out.push({key, tone, text, action});
  if (summary.overdue > 0) add('overdue', 'warn', `لديك ${summary.overdue} عنصرًا متأخرًا. ابدأ بالأقدم أو أعد جدولة ما لم يعد عاجلًا.`, {type: 'range', range: 'overdue'});
  if (summary.hearingsToday > 0) add('hearingsToday', 'warn', `لديك ${summary.hearingsToday} جلسة اليوم. راجع تجهيزها قبل الانتقال.`, {type: 'range', range: 'today'});
  if ((summary.hearingsTomorrow || 0) > 0) add('hearingsTomorrow', 'info', `لديك ${summary.hearingsTomorrow} جلسة غدًا. حضّر المستندات الليلة.`, {type: 'range', range: 'tomorrow'});
  if (summary.postponed >= 3) add('postponed', 'info', `${summary.postponed} عناصر مؤجلة. راجعها وقرّر ما يُنجز وما يُلغى.`, {type: 'view', view: 'attention'});
  if (summary.undated >= 5) add('undated', 'info', `${summary.undated} عنصرًا بلا موعد. حدّد مواعيدها لتظهر في الفترات الزمنية.`, {type: 'range', range: 'all'});
  if (staleCount > 0) add('stale', 'info', `${staleCount} ملفًا بلا نشاط منذ مدة. تحقق إن كان يلزمها إجراء.`, {type: 'view', view: 'attention'});
  if (summary.todayCount === 0 && summary.overdue === 0) add('free', 'ok', 'يومك خالٍ من الالتزامات المسجّلة. وقت مناسب لتخطيط الأسبوع القادم.', {type: 'range', range: 'nextWeek'});
  return out;
}

// ---------- المراجعة اليومية والأسبوعية ----------
export async function dailyReview(office, {today = Clock.today(), signal = null} = {}) {
  const [done, openToday, tomorrow, overdue] = await Promise.all([
    queryWorkItems(office, {drive: 'completed', from: today, to: today}, {limit: 200, signal}),
    queryWorkItems(office, {range: 'custom', from: today, to: today, kinds: ['open']}, {limit: 200, signal}),
    queryWorkItems(office, {range: 'custom', from: addDays(today, 1), to: addDays(today, 1), kinds: ['open']}, {limit: 200, signal}),
    queryWorkItems(office, {range: 'overdue', kinds: ['open']}, {limit: 100, signal})
  ]);
  // الجلسات لا تُرحَّل جماعيًا: التأجيل الرسمي يُسجَّل في سجل كل جلسة على حدة.
  const carryOver = openToday.items.filter(item => item.caps.postpone && item.sourceType !== 'hearings');
  return {today, done: done.items, openToday: openToday.items, tomorrow: tomorrow.items, overdue: overdue.items, overdueMore: overdue.hasMore, carryOver};
}

export async function weeklyReview(office, {today = Clock.today(), signal = null} = {}) {
  const monday = addDays(today, -((new Date(`${today}T00:00:00`).getDay() + 6) % 7));
  const sunday = addDays(monday, 6), nextMonday = addDays(monday, 7), nextSunday = addDays(monday, 13);
  const [done, overdue, next, postponed, stale] = await Promise.all([
    queryWorkItems(office, {drive: 'completed', from: monday, to: sunday}, {limit: 500, signal}),
    queryWorkItems(office, {range: 'overdue', kinds: ['open']}, {limit: 100, signal}),
    queryWorkItems(office, {range: 'custom', from: nextMonday, to: nextSunday, kinds: ['open']}, {limit: 500, signal}),
    queryWorkItems(office, {drive: 'status', statuses: ['postponed'], kinds: ['open']}, {limit: 100, signal}),
    staleFiles(office, {today})
  ]);
  const byDay = new Map();
  for (const item of next.items) byDay.set(item.dueDate, (byDay.get(item.dueDate) || 0) + 1);
  return {monday, sunday, done: done.items, overdue: overdue.items, overdueMore: overdue.hasMore, next: next.items, nextByDay: byDay,
    nextHearings: next.items.filter(i => i.sourceType === 'hearings'), postponed: postponed.items.filter(i => i.postponeCount >= 2), stale};
}

// ---------- الإنتاجية (وصفية فقط: بلا تقييم أو أحكام على الأداء) ----------
export async function productivity(office, {today = Clock.today(), days = 14, signal = null} = {}) {
  const from = addDays(today, -(days - 1));
  const [done, summary] = await Promise.all([
    queryWorkItems(office, {drive: 'completed', from, to: today}, {limit: 3000, signal}),
    workSummary(office, {today, signal})
  ]);
  const perDay = new Map();
  for (let i = 0; i < days; i++) perDay.set(addDays(from, i), 0);
  const bySource = {};
  for (const item of done.items) {
    const day = item.completedAt ? localDate(new Date(item.completedAt)) : '';
    if (perDay.has(day)) perDay.set(day, perDay.get(day) + 1);
    bySource[item.sourceLabel] = (bySource[item.sourceLabel] || 0) + 1;
  }
  const series = [...perDay].map(([date, count]) => ({date, count}));
  const total = series.reduce((n, d) => n + d.count, 0);
  return {days, from, to: today, series, total, average: Math.round((total / days) * 10) / 10, bySource, summary, capped: done.hasMore};
}
