// =====================================================================
// شاشة «المطلوب حتى تاريخ» — اختيار أفق الحساب من تاريخ الارتكاز
// ---------------------------------------------------------------------
// • الاختصارات تُحسب من **تاريخ ارتكاز البند** (عادة المكتب في النفقات) لا من
//   تاريخ اليوم، لأن فترة النفقة تبدأ من يوم الحكم/السريان لا من يوم الفتح.
// • لا مسار حساب موازٍ: المعاينة تستدعي نفس `simpleSchedule` الذي يغذّي البطاقة،
//   فلا يظهر رقم في هذه الشاشة يختلف عن رقم البطاقة.
// • القاعدة المعلنة دائمًا: عدد الفترات + المعادلة + تحذير «تقديري» إن كان
//   التاريخ مستقبليًا (الفترات لم تُستحق بعد).
// =====================================================================
import {esc} from './dom.js';
import {modal, closeModal} from './modal.js';
import {toast} from './toast.js';
import {prefs} from '../core/preferences.js';
import {localDate} from '../core/clock.js';
import {userError} from '../core/errors.js';
import {fromMinorUnits} from '../domain/execution-money.js';
import {
  isCivilDate, addCivilDays, addMonthsClamped, parseCivilDate, formatCivilDate, daysInCivilMonth,
  periodEnd, periodIndexOf, periodStart
} from '../domain/execution-period-calendar.js';
import * as S from '../services/execution-simple.js';

const display = iso => (isCivilDate(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');
const grouped = (minor, currency = 'EGP') => fromMinorUnits(Number(minor || 0), currency)
  .toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});

// خريطة الدورية ← وحدة التقويم: من محرك الجدول نفسه (مصدر واحد للحقيقة).
export {calendarForPeriodicity} from '../domain/execution-schedule.js';
import {calendarForPeriodicity} from '../domain/execution-schedule.js';

/** آخر يوم في الشهر المدني لتاريخ معيّن. */
export function endOfMonth(iso) {
  if (!isCivilDate(iso)) return '';
  const {year, month} = parseCivilDate(iso);
  return formatCivilDate({year, month, day: daysInCivilMonth(year, month)});
}

/**
 * تاريخ الارتكاز الفعلي للحساب: أول بند قيمة (أو أول فترة في الجدول)،
 * لأن الفترات كلها مشتقة منه ولا يُعاد ضبطه بعد ذلك.
 */
export function anchorOf(bundle) {
  const slices = (bundle?.slices || []).filter(slice => !slice.isDeleted && !['cancelled', 'superseded'].includes(String(slice.status || '')));
  const periodic = slices.filter(slice => slice.valueType !== 'fixed');
  const first = (periodic[0] || slices[0] || null);
  const rows = bundle?.schedule?.rows || [];
  const anchorDate = (first && isCivilDate(first.anchorDate) ? first.anchorDate
    : (first && isCivilDate(first.startDate) ? first.startDate : '')) || rows[0]?.fromDate || bundle?.execution?.openedDate || '';
  return {
    anchorDate: isCivilDate(anchorDate) ? anchorDate : '',
    periodicity: first?.periodicity || 'monthly',
    entitlementType: first?.entitlementType || '',
    amountMinor: Number(first?.amountMinor || (first?.amount ? Math.round(Number(first.amount) * 100) : 0)) || 0,
    currency: bundle?.schedule?.currency || first?.currency || 'EGP',
    periodBasis: bundle?.settings?.schedule?.periodBasis || 'ANNIVERSARY',
    accrualTiming: bundle?.settings?.schedule?.accrualTiming || 'AT_PERIOD_START',
    customDays: first?.customDays || null,
    sliceCount: slices.length
  };
}

/** نهاية الفترة رقم `k` المحسوبة من الارتكاز (بلا أي انجراف). */
export function anchoredPeriodEnd(anchorDate, k, options) {
  try { return periodEnd(anchorDate, k, options); } catch { return ''; }
}

/**
 * اختصارات الأفق. كلها تُحسب من **الارتكاز**:
 * «+شهر» = نهاية الفترة الجارية، «+3 شهور» = نهاية الفترة الثالثة بعدها، وهكذا.
 */
export function horizonShortcuts({anchor, today = localDate(), extraPeriods = 0} = {}) {
  const anchorDate = anchor?.anchorDate || '';
  const out = [];
  out.push({id: 'today', label: 'اليوم', date: today, hint: 'تاريخ الحساب الفعلي'});
  if (!isCivilDate(anchorDate)) {
    out.push({id: 'monthEnd', label: 'نهاية الشهر', date: endOfMonth(today), hint: 'آخر يوم في الشهر الجاري'});
    return out;
  }
  const options = calendarForPeriodicity(anchor.periodicity, {periodBasis: anchor.periodBasis, customDays: anchor.customDays});
  const reference = today > anchorDate ? today : anchorDate;
  let currentK = 0;
  try { currentK = Math.max(0, periodIndexOf(anchorDate, reference, options)); } catch { currentK = 0; }
  const runningEnd = anchoredPeriodEnd(anchorDate, currentK, options);
  out.push({id: 'monthEnd', label: 'نهاية الشهر', date: endOfMonth(reference), hint: 'آخر يوم في شهر التقويم (لا يتبع الارتكاز)'});
  // «+N شهور» = N فترات محسوبة من اليوم (الفترة الجارية أولى منها):
  // +شهر ⇒ نهاية الفترة الجارية، +3 شهور ⇒ نهاية الفترة الثالثة، +سنة ⇒ الثانية عشرة.
  // تُحسب بإضافة N−1 شهرًا إلى المرجع ثم أخذ نهاية الفترة الحاضنة لذلك التاريخ،
  // فتصحّ مع أي دورية (شهرية/سنوية/أسبوعية) بلا تقريب يدوي.
  for (const count of [1, 3, 12]) {
    const target = count === 1 ? reference : (() => { try { return addMonthsClamped(reference, count - 1); } catch { return reference; } })();
    let k = currentK;
    try { k = Math.max(0, periodIndexOf(anchorDate, target, options)); } catch { k = currentK; }
    const end = anchoredPeriodEnd(anchorDate, k, options);
    const label = count === 1 ? '+شهر' : count === 3 ? '+3 شهور' : '+سنة';
    out.push({id: `plus${count}`, label, date: end, hint: `${count} فترة من اليوم — نهاية الفترة رقم ${k + 1} من الارتكاز (${display(periodStartSafe(anchorDate, k, options))} ← ${display(end)})`});
  }
  if (Number(extraPeriods) > 0) {
    const end = anchoredPeriodEnd(anchorDate, currentK + Number(extraPeriods) - 1, options);
    out.push({id: 'extra', label: `+${extraPeriods} فترة`, date: end, hint: 'حسب طلبك'});
  }
  // إزالة التواريخ المكررة (نهاية الفترة الجارية = +شهر) مع إبقاء أول تسمية.
  const seen = new Set();
  return out.filter(row => {
    if (!isCivilDate(row.date) || seen.has(row.date)) return false;
    seen.add(row.date);
    return true;
  });
}

function periodStartSafe(anchorDate, k, options) {
  try { return periodStart(anchorDate, k, options); } catch { return anchorDate; }
}

/** شرح مبسّط لقاعدة الفترات (يُعرض في الإعدادات وفي هذه الشاشة). */
export function periodBasisExplanation({anchor, today = localDate()} = {}) {
  const anchorDate = anchor?.anchorDate || '';
  const basis = String(anchor?.periodBasis || 'ANNIVERSARY');
  if (!isCivilDate(anchorDate)) {
    return basis === 'CALENDAR_MONTH'
      ? 'CALENDAR_MONTH ⇒ شهر تقويمي كامل (01 → آخر يوم في الشهر).'
      : 'ANNIVERSARY ⇒ دورة شهرية من يوم الارتكاز إلى اليوم السابق لذكرى الشهر التالي.';
  }
  const options = calendarForPeriodicity(anchor.periodicity, {periodBasis: basis, customDays: anchor.customDays});
  const reference = today > anchorDate ? today : anchorDate;
  let k = 0;
  try { k = Math.max(0, periodIndexOf(anchorDate, reference, options)); } catch { k = 0; }
  const from = periodStartSafe(anchorDate, k, options);
  const to = anchoredPeriodEnd(anchorDate, k, options);
  return basis === 'CALENDAR_MONTH'
    ? `CALENDAR_MONTH ⇒ «${display(from)} إلى ${display(to)}» — شهر تقويمي كامل (الارتكاز أول الشهر).`
    : `ANNIVERSARY ⇒ «من ${display(from)} إلى ${display(to)}» (الارتكاز إلى ما قبله في الشهر التالي).`;
}

/**
 * معاينة الأفق: نفس محرك البطاقة، بلا حساب موازٍ.
 * يعيد عدد الفترات الداخلة والمعادلة والمبالغ وتحذير «تقديري».
 */
export async function horizonPreview(office, executionId, {asOf, allowFuture = true} = {}) {
  const data = await S.simpleSchedule(office, executionId, {asOf: isCivilDate(asOf) ? asOf : localDate(), allowFuture});
  const schedule = data.schedule;
  const rows = schedule.rows || [];
  const complete = rows.filter(row => row.status !== 'RUNNING' && !row.needsDecision);
  const running = rows.filter(row => row.status === 'RUNNING');
  const totals = schedule.totals;
  const counts = new Map();
  for (const row of complete) {
    const amount = Number(row.dueMinor || 0);
    counts.set(amount, (counts.get(amount) || 0) + 1);
  }
  const unique = [...counts.keys()];
  const currency = schedule.currency;
  const equation = unique.length === 1
    ? `${complete.length} × ${grouped(unique[0], currency)} = ${grouped(totals.dueMinor, currency)}`
    : [...counts.entries()].map(([amount, count]) => `${count} × ${grouped(amount, currency)}`).join(' + ') + ` = ${grouped(totals.dueMinor, currency)}`;
  const today = localDate();
  const future = isCivilDate(asOf) && asOf > today;
  // الفترات التي لم تُستحق بعد = التي تنتهي بعد اليوم (لا «الجارية» فقط).
  const dueCount = complete.filter(row => isCivilDate(row.toDate) && row.toDate <= today).length;
  const futureCount = Math.max(0, complete.length - dueCount);
  return {
    asOf: isCivilDate(asOf) ? asOf : today,
    effectiveAsOf: schedule.effectiveAsOf || schedule.asOf,
    requestedAsOf: schedule.requestedAsOf || schedule.asOf,
    horizonCapped: Boolean(schedule.horizonCapped),
    horizonNote: schedule.horizonNote || '',
    periodCount: complete.length,
    runningCount: running.length,
    dueCount, futureCount,
    dueMinor: totals.dueMinor, paidMinor: totals.paidMinor, remainingMinor: totals.remainingMinor,
    projectedMinor: running.reduce((sum, row) => sum + Number(row.projectedMinor || 0), 0),
    currency, equation,
    isFuture: future || futureCount > 0,
    futureNote: futureCount > 0
      ? `الفترات من ${dueCount + 1} إلى ${dueCount + futureCount} لم تُستحق بعد — هذا تقدير للمطالبة المستقبلية.`
      : '',
    firstFuturePeriod: rows.find(row => isCivilDate(row.toDate) && row.toDate > today) || null
  };
}

/** شريط الأفق المصغّر (يُستدعى داخل بطاقة الملخص السريع). */
export function horizonBarMarkup({asOf, anchor, shortcuts = [], allowFuture = true, preview = null, compact = false} = {}) {
  const chips = shortcuts.map(item => `<button type="button" class="chip" data-horizon-shortcut="${esc(item.date)}" title="${esc(item.hint || '')}">${esc(item.label)}</button>`).join('');
  const countLine = preview
    ? `<p class="muted small" data-horizon-counts>الفترات الداخلة في الحساب: <b>${preview.periodCount}</b>${preview.runningCount ? ` · جارية ${preview.runningCount}` : ''}<br>
        مطلوب حتى ${esc(display(preview.asOf))} = <b>${grouped(preview.dueMinor, preview.currency)} ج.م</b><br>
        <span class="equation-inline">(المعادلة: ${esc(preview.equation)})</span></p>`
    : '<p class="muted small" data-horizon-counts>اختر تاريخًا ليظهر عدد الفترات والمعادلة.</p>';
  const warn = preview?.isFuture
    ? `<p class="hint hint-warn small" data-horizon-warn>ⓘ ${esc(preview.futureNote || 'تاريخ مستقبلي — تقدير للمطالبة، لا استحقاق قائم.')}${allowFuture ? '' : ' (الحساب مقصوص إلى اليوم)'}</p>`
    : (preview?.horizonCapped ? `<p class="hint hint-warn small" data-horizon-warn>⚠ ${esc(preview.horizonNote || 'أفق الحساب مقصوص.')}</p>` : '');
  return `<div class="horizon-picker${compact ? ' is-compact' : ''}" data-horizon-picker>
    <div class="horizon-row">
      <label class="field">المطلوب حتى
        <input type="date" name="horizonDate" data-horizon-date value="${esc(isCivilDate(asOf) ? asOf : '')}" aria-label="المطلوب حتى تاريخ">
      </label>
      <div class="quick-chips" data-horizon-shortcuts>${chips}</div>
      <label class="check-line"><input type="checkbox" data-horizon-future ${allowFuture ? 'checked' : ''}> احسب حتى تاريخ مستقبلي (تقديري)</label>
    </div>
    <hr class="sep">
    ${countLine}
    ${warn}
    ${anchor?.anchorDate ? `<p class="muted small" data-horizon-basis>الارتكاز: <b>${esc(display(anchor.anchorDate))}</b> · ${esc(periodBasisExplanation({anchor}))}</p>` : ''}
  </div>`;
}

/**
 * النافذة الكاملة «المطلوب حتى تاريخ»: اختصارات + معاينة حية + تطبيق على البطاقة.
 * التطبيق يحفظ التاريخ في مفتاح التنفيذ نفسه (لا مفتاح عام يخلط التنفيذات).
 */
export async function openHorizonPicker(app, executionId, {bundle = null, onApply = null} = {}) {
  const data = bundle || await S.simpleCardBundle(app.office, executionId, {allowFuture: true});
  const anchor = anchorOf(data);
  const today = localDate();
  const current = data.schedule.requestedAsOf || data.schedule.asOf || today;
  const card = modal(`<h2 class="modal-title">⚙ تغيير تاريخ «المطلوب حتى»</h2>
    <p class="muted small">الاختصارات تُحسب من <b>تاريخ الارتكاز</b> ${anchor.anchorDate ? `(${esc(display(anchor.anchorDate))})` : '(غير محدد — أدخل قيمة النفقة أولًا)'} لا من اليوم: هذه عادة المكتب في النفقات.</p>
    <div data-horizon-host>${horizonBarMarkup({asOf: current, anchor, shortcuts: horizonShortcuts({anchor, today}), allowFuture: true})}</div>
    <div class="form-actions">
      <button type="button" class="primary" data-horizon-apply>تطبيق على البطاقة</button>
      <button type="button" class="ghost" data-horizon-reset>↺ ارجع إلى اليوم</button>
      <button type="button" class="ghost" data-close>إغلاق</button>
    </div>`);
  const host = card.querySelector('[data-horizon-host]');
  const dateInput = () => host.querySelector('[data-horizon-date]');
  const futureInput = () => host.querySelector('[data-horizon-future]');
  const countsHost = () => host.querySelector('[data-horizon-counts]');
  let timer = 0;
  const refresh = async () => {
    const asOf = dateInput()?.value || '';
    const allowFuture = Boolean(futureInput()?.checked);
    if (!isCivilDate(asOf)) return;
    const counts = countsHost();
    if (counts) counts.innerHTML = 'جارٍ الحساب…';
    try {
      const preview = await horizonPreview(app.office, executionId, {asOf, allowFuture});
      if (!card.isConnected) return;
      host.innerHTML = horizonBarMarkup({asOf, anchor, shortcuts: horizonShortcuts({anchor, today}), allowFuture, preview});
      bind();
    } catch (error) {
      if (counts) counts.textContent = userError(error);
    }
  };
  const bind = () => {
    host.querySelectorAll('[data-horizon-shortcut]').forEach(button => button.addEventListener('click', () => {
      const input = dateInput();
      if (input) input.value = button.dataset.horizonShortcut;
      refresh().catch(() => {});
    }));
    dateInput()?.addEventListener('change', () => { clearTimeout(timer); refresh().catch(() => {}); });
    futureInput()?.addEventListener('change', () => { clearTimeout(timer); refresh().catch(() => {}); });
  };
  bind();
  await refresh();
  card.querySelector('[data-horizon-apply]')?.addEventListener('click', async () => {
    const asOf = dateInput()?.value || '';
    const allowFuture = Boolean(futureInput()?.checked);
    if (!isCivilDate(asOf)) { toast('اختر تاريخًا صحيحًا', 'error'); return; }
    try {
      await prefs.set(`ui:exec:asof:${executionId}`, asOf);
      await prefs.set('ui:exec:asof:v1', asOf);
      closeModal();
      if (typeof onApply === 'function') await onApply({asOf, allowFuture});
      else await app.refresh();
    } catch (error) { toast(userError(error), 'error'); }
  });
  card.querySelector('[data-horizon-reset]')?.addEventListener('click', async () => {
    try {
      await prefs.set(`ui:exec:asof:${executionId}`, '');
      closeModal();
      if (typeof onApply === 'function') await onApply({asOf: today, allowFuture: true});
      else await app.refresh();
    } catch (error) { toast(userError(error), 'error'); }
  });
  return card;
}

export const horizonUtils = Object.freeze({display, grouped, endOfMonth, addCivilDays, anchoredPeriodEnd});
