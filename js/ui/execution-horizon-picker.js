// =====================================================================
// «المطلوب حتى تاريخ» — شاشة اختيار أفق الحساب (Horizon Picker)
// ---------------------------------------------------------------------
// • الاختصارات تُحسب من تاريخ ارتكاز الفترة (عادة المكتب في النفقات) لا من
//   اليوم: [+شهر] = نهاية فترة الارتكاز الأولى، [+3 شهور] = نهاية الثالثة…
// • تُعرض دائمًا: عدد الفترات الداخلة + المعادلة + تنبيه «تقديري» عند تجاوز
//   اليوم، وتنبيه صريح عند القصّ بالتاريخ الفعلي — لا رقم منسوب لتاريخ آخر.
// • وحدة مستقلة: لا تُكتب أي بيانات هنا، بل تُبلّغ الصفحة بالتاريخ المختار.
// =====================================================================
import {esc} from './dom.js';
import {prefs} from '../core/preferences.js';
import {localDate} from '../core/clock.js';
import {isCivilDate, addCivilDays, daysInCivilMonth} from '../domain/execution-period-calendar.js';
import {amountEquation} from '../domain/execution-schedule.js';
import {fromMinorUnits} from '../domain/execution-money.js';

const display = iso => (isCivilDate(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');
const money = (minor, currency = 'EGP') => fromMinorUnits(minor || 0, currency).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});

/** آخر يوم في الشهر المدني الذي يقع فيه التاريخ. */
function monthEnd(iso) {
  if (!isCivilDate(iso)) return '';
  const year = Number(iso.slice(0, 4)), month = Number(iso.slice(5, 7));
  return `${iso.slice(0, 4)}-${iso.slice(5, 7)}-${String(daysInCivilMonth(year, month)).padStart(2, '0')}`;
}

/** تاريخ ارتكاز المكتب: بداية أول فترة محسوبة، وإلا اليوم. */
export function executionAnchorDate(bundle) {
  const rows = bundle?.schedule?.rows || [];
  if (rows.length) return rows[0].fromDate;
  const slice = (bundle?.slices || []).find(row => !row.isDeleted && isCivilDate(row.startDate));
  return slice?.startDate || localDate();
}

/**
 * نهايات الفترات المقترحة باختصارات: تُشتق من ارتكاز الفترة بنفس محرك التقويم
 * (نهاية الفترة رقم k من الارتكاز)، فلا تتناقض الاختصارات مع الجدول.
 */
export function horizonPresets(bundle) {
  const anchor = executionAnchorDate(bundle);
  const rows = bundle?.schedule?.rows || [];
  const endOfPeriod = k => rows[k]?.toDate || '';
  return [
    {key: 'today', label: 'اليوم', date: localDate(), hint: 'تاريخ الحساب الفعلي اليوم'},
    {key: 'month-end', label: 'نهاية الشهر', date: monthEnd(anchor), hint: `آخر يوم في شهر ارتكاز الفترة (${display(anchor)})`},
    {key: 'plus-1', label: '+شهر', date: endOfPeriod(0) || monthEnd(anchor), hint: 'نهاية فترة واحدة من الارتكاز'},
    {key: 'plus-3', label: '+3 شهور', date: endOfPeriod(2) || '', hint: 'نهاية ثلاث فترات من الارتكاز'},
    {key: 'plus-12', label: '+سنة', date: endOfPeriod(11) || '', hint: 'نهاية اثنتي عشرة فترة من الارتكاز'}
  ].filter(preset => isCivilDate(preset.date));
}

/** ملخّص الحساب عند تاريخ: عدد الفترات + المعادلة + تنبيه التقدير/القصّ. */
export function horizonSummary(bundle) {
  const schedule = bundle?.schedule || {};
  const currency = schedule.currency || 'EGP';
  const rows = (schedule.rows || []).filter(row => Number(row.dueMinor || 0) > 0);
  const days = bundle?.today || localDate();
  const estimated = rows.filter(row => row.fromDate > days);
  return {
    asOf: schedule.asOf || '',
    requestedAsOf: schedule.requestedAsOf || schedule.asOf || '',
    effectiveAsOf: schedule.effectiveAsOf || schedule.asOf || '',
    horizonCapped: Boolean(schedule.horizonCapped),
    horizonShowWarning: schedule.horizonShowWarning ?? Boolean(schedule.horizonCapped),
    horizonNote: schedule.horizonNote || '',
    estimateNote: schedule.estimateNote || (estimated.length
      ? `تقديري — ${estimated.length} فترة لم تُستحق بعد وتُعرض بمبلغها المتوقع.` : ''),
    estimatedPeriods: estimated.length,
    periods: rows.length,
    dueMinor: schedule.totals?.dueMinor || 0,
    equation: amountEquation(rows.map(row => ({amountMinor: row.dueMinor})), currency),
    nextPeriodStart: (schedule.rows || []).at(-1)?.toDate ? addCivilDays((schedule.rows || []).at(-1).toDate, 1) : '',
    currency
  };
}

/** صف التحكم: حقل التاريخ + الاختصارات + مفتاح «احسب حتى تاريخ مستقبلي». */
export function horizonPickerMarkup(bundle, {asOf = '', allowFuture = false} = {}) {
  const summary = horizonSummary(bundle);
  const presets = horizonPresets(bundle);
  return `<div class="horizon-picker" data-horizon-picker>
    <div class="horizon-row">
      <label class="horizon-date">المطلوب حتى
        <input type="date" data-asof value="${esc(asOf || summary.effectiveAsOf || localDate())}" aria-label="المطلوب حتى تاريخ">
      </label>
      <div class="quick-chips horizon-chips" role="group" aria-label="اختصارات تاريخ الحساب">
        ${presets.map(preset => `<button type="button" class="chip" data-horizon-preset="${esc(preset.key)}" data-date="${esc(preset.date)}" title="${esc(preset.hint)}">${esc(preset.label)}</button>`).join('')}
      </div>
      <label class="check-line horizon-future"><input type="checkbox" data-horizon-future${allowFuture ? ' checked' : ''}> احسب حتى تاريخ مستقبلي (تقديري)</label>
      ${asOf && asOf !== (bundle?.today || localDate()) ? '<button type="button" class="ghost small" data-asof-today>↺ ارجع إلى اليوم</button>' : ''}
    </div>
    <div class="horizon-info" data-horizon-info>
      <b>${summary.periods}</b> فترة داخلة في الحساب · مطلوب حتى <b>${display(summary.effectiveAsOf)}</b> = <b>${money(summary.dueMinor, summary.currency)}</b> ج.م
      ${summary.equation ? `<span class="muted small">(المعادلة: ${esc(summary.equation)})</span>` : ''}
    </div>
    ${summary.horizonCapped && summary.horizonShowWarning ? `<p class="hint hint-warn" data-horizon-capped>⚠ ${esc(summary.horizonNote || `لم يُحسب بعد ${display(summary.effectiveAsOf)}.`)}</p>` : ''}
    ${summary.effectiveAsOf && summary.effectiveAsOf < (bundle?.today || localDate()) ? `<p class="hint hint-warn" data-horizon-past>⚠ تاريخ الحساب <b>${display(summary.effectiveAsOf)}</b> أقدم من اليوم (${display(bundle?.today || localDate())}) — الأرقام تمثل ما استحق حتى هذا التاريخ فقط، والفترات اللاحقة غير محسوبة.</p>` : ''}
    ${summary.estimatedPeriods ? `<p class="hint hint-info" data-horizon-estimate>ⓘ ${esc(summary.estimateNote)}</p>` : ''}
    <p class="muted small" data-horizon-hint>الاختصارات محسوبة من ارتكاز الفترة (${display(executionAnchorDate(bundle))}) — واختيار تاريخ مستقبلي يعرض فترات لم تُستحق بعد بوسم «تقديري».</p>
  </div>`;
}

/**
 * ربط التحكم: تغيير التاريخ أو الضغط على اختصار يُبلّغ الصفحة بالتاريخ الجديد
 * و«هل يسمح بالمستقبل». لا كتابة ولا إعادة رسم هنا — الصفحة تتولى ذلك.
 */
export function bindHorizonPicker(container, {onApply} = {}) {
  const picker = container.querySelector('[data-horizon-picker]');
  if (!picker) return false;
  const dateInput = picker.querySelector('[data-asof]');
  const futureBox = picker.querySelector('[data-horizon-future]');
  const today = localDate();
  /**
   * قاعدة العرض: اختيار تاريخ مستقبلي = طلب صريح للحساب عنده (فلا قصّ صامت)،
   * لكن إلغاء المستخدم لمفتاح «احسب حتى تاريخ مستقبلي» قرار صريح أيضًا ويُحترم.
   */
  const apply = async (date, {fromToggle = false} = {}) => {
    const value = String(date || '');
    if (!fromToggle && value > today && futureBox && !futureBox.checked) futureBox.checked = true;
    const allowFuture = Boolean(futureBox?.checked);
    if (dateInput) dateInput.value = value;
    await onApply?.({date: value, allowFuture});
  };
  picker.querySelectorAll('[data-horizon-preset]').forEach(button => button.addEventListener('click', () => apply(button.dataset.date)));
  dateInput?.addEventListener('change', () => apply(dateInput.value));
  futureBox?.addEventListener('change', () => apply(dateInput?.value || '', {fromToggle: true}));
  return true;
}

/** تفضيل «تاريخ الحساب»: لكل تنفيذ على حدة (افتراضي) أو موحّد لكل التنفيذات. */
export const ASOF_SCOPE_KEY = 'ui:exec:asof-scope:v1';
export const asOfScope = () => (prefs.get(ASOF_SCOPE_KEY, 'per-execution') === 'global' ? 'global' : 'per-execution');
export const asOfKeyFor = executionId => `ui:exec:asof:${executionId}`;

/**
 * التاريخ الفعلي المطلوب للتنفيذ:
 * • الوضع الافتراضي (لكل تنفيذ): المحلي أولًا، ولا يُستخدم الموحّد إلا إذا كان المحلي فارغًا.
 * • الوضع الموحّد (اختيار صريح من الإعدادات): الموحّد أولًا ثم المحلي — فلا يُخفى رقم.
 */
export function resolveAsOf(executionId, globalKey = '') {
  const local = prefs.get(asOfKeyFor(executionId), '') || '';
  const global = prefs.get(globalKey, '') || '';
  return asOfScope() === 'global' ? (global || local) : (local || global);
}
