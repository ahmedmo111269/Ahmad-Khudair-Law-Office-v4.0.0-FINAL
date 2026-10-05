// =====================================================================
// بطاقة الملخص السريع — أعلى بطاقة التنفيذ (قبل «الأرقام الثلاثة»)
// ---------------------------------------------------------------------
// الهدف: كل ما يحتاجه المحامي في نظرة واحدة، بلا تمرير وبلا نوافذ:
//   الموكل · نوع النفقة · طريقة التنفيذ | المستحق حتى [تاريخ] · المحصّل · الرصيد
//   آخر إجراء · المعادلة | أزرار تستدعي **نفس النوافذ القائمة** (لا مسارات موازية).
// كل رقم قابل للنقر ⇒ نفس `traceDialog` الحالية.
// =====================================================================
import {esc} from './dom.js';
import {localDate} from '../core/clock.js';
import {isCivilDate} from '../domain/execution-calendar.js';
import {fromMinorUnits} from '../domain/execution-money.js';
import {PERIOD_STATUS} from '../domain/execution-schedule.js';
import {EXECUTION_TYPE_LABELS} from '../domain/execution.js';

const display = iso => (isCivilDate(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');
const money = (minor, currency = 'EGP') => `${fromMinorUnits(Number(minor || 0), currency).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})} ج.م`;
const short = (minor, currency = 'EGP') => fromMinorUnits(Number(minor || 0), currency).toLocaleString('en-US', {maximumFractionDigits: 0});

/** نوع النفقة الفعلي من بنود القيمة (آخر بند نشط — وهو المعمول به الآن). */
export function entitlementLabelOf(bundle) {
  const slices = (bundle?.slices || []).filter(slice => !slice.isDeleted && !['cancelled', 'superseded'].includes(String(slice.status || '')));
  const active = slices.at(-1) || null;
  if (!active) return '';
  const amount = Number(active.amountMinor || Math.round(Number(active.amount || 0) * 100));
  const every = active.valueType === 'fixed' ? 'مبلغ مقطوع'
    : active.periodicity === 'monthly' ? 'شهريًا'
      : active.periodicity === 'weekly' ? 'أسبوعيًا'
        : active.periodicity === 'semiMonthly' ? 'نصف شهري'
          : active.periodicity === 'yearly' ? 'سنويًا' : (active.periodicity || '');
  return `${active.entitlementType || 'بند'}${amount ? ` — ${fromMinorUnits(amount, bundle?.schedule?.currency || 'EGP').toLocaleString('en-US', {maximumFractionDigits: 2})} ${every}` : ''}`;
}

/** المعادلة المختصرة: «عدد الفترات × القيمة = المستحق» (أو تجميع عند اختلاف القيم). */
export function summaryEquation(bundle) {
  const schedule = bundle?.schedule;
  if (!schedule) return '';
  const currency = schedule.currency;
  const rows = (schedule.rows || []).filter(row => row.status !== PERIOD_STATUS.RUNNING && !row.needsDecision && Number(row.dueMinor || 0) > 0);
  if (!rows.length) return `لا فترات مستحقة حتى ${display(schedule.requestedAsOf || schedule.asOf)}`;
  const counts = new Map();
  for (const row of rows) counts.set(Number(row.dueMinor || 0), (counts.get(Number(row.dueMinor || 0)) || 0) + 1);
  const two = minor => fromMinorUnits(Number(minor || 0), currency).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  const parts = [...counts.entries()].map(([amount, count]) => `${count} × ${two(amount)}`);
  return `${parts.join(' + ')} = ${two(schedule.totals.dueMinor)}`;
}

/**
 * markup البطاقة. `uiMode = 'simple'` يخفي الأدوات المتقدمة (الافتراضي).
 * كل الأزرار تحمل data-* تُربط في `bindExecutionSummaryCard` بنفس النوافذ القائمة.
 */
export function executionSummaryCardMarkup(bundle, {uiMode = 'simple'} = {}) {
  const schedule = bundle?.schedule || {totals: {}, rows: []};
  const totals = schedule.totals || {};
  const currency = schedule.currency || 'EGP';
  const execution = bundle?.execution || {};
  const today = localDate();
  const requestedAsOf = schedule.requestedAsOf || schedule.asOf || today;
  const effectiveAsOf = schedule.effectiveAsOf || schedule.asOf || requestedAsOf;
  const isFuture = isCivilDate(requestedAsOf) && requestedAsOf > today;
  const creditor = bundle?.creditor?.name || bundle?.client?.fullName || '';
  const debtor = bundle?.debtor?.name || '';
  const lastAction = bundle?.lastAction || null;
  const nextAction = bundle?.nextAction || null;
  const running = (schedule.rows || []).filter(row => row.status === PERIOD_STATUS.RUNNING);
  const projected = running.reduce((sum, row) => sum + Number(row.projectedMinor || 0), 0);
  const simple = String(uiMode) !== 'advanced';
  const equation = summaryEquation(bundle);
  return `<section class="panel exec-quick-card${simple ? ' is-simple' : ' is-advanced'}" data-section-id="quickCard" data-execution-card="${esc(execution.id || '')}" aria-label="الملخص السريع">
    <div class="qc-head">
      <span class="qc-item"><b>الموكل:</b> ${esc(creditor || '—')}</span>
      ${debtor ? `<span class="qc-item"><b>ضد:</b> ${esc(debtor)}</span>` : ''}
      <span class="qc-item"><b>نوع النفقة:</b> ${esc(entitlementLabelOf(bundle) || 'لم تُسجَّل بعد')}</span>
      <span class="qc-item"><b>طريقة التنفيذ:</b> ${esc(execution.executionMethod || EXECUTION_TYPE_LABELS[execution.executionType] || '—')}</span>
      <span class="qc-spacer"></span>
      <button type="button" class="chip qc-mode" data-uimode-toggle title="تبديل بين العرض المبسّط والمتقدم" aria-pressed="${simple}">${simple ? 'مبسّط' : 'متقدّم'}</button>
    </div>
    <hr class="qc-sep">
    <div class="qc-numbers">
      <button type="button" class="qc-num" data-trace="due" title="اضغط لعرض كيف حُسب">
        <span>المستحق حتى ${esc(display(requestedAsOf))}${schedule.horizonCapped ? ` <small>(فعليًا ${esc(display(effectiveAsOf))})</small>` : ''}${isFuture ? ' <em class="qc-est">تقديري</em>' : ''}</span>
        <b>${short(totals.dueMinor, currency)}</b><small>ج.م</small>
      </button>
      <button type="button" class="qc-num" data-trace="paid" title="اضغط لعرض كيف حُسب">
        <span>المحصّل</span><b>${short(totals.paidMinor, currency)}</b>
        <small>${Number(totals.creditMinor || 0) > 0 ? `منه رصيد دائن ${short(totals.creditMinor, currency)}` : 'ج.م'}</small>
      </button>
      <button type="button" class="qc-num qc-primary" data-trace="remaining" title="اضغط لعرض كيف حُسب">
        <span>الرصيد</span><b>${short(totals.remainingMinor, currency)}</b><small>ج.م</small>
      </button>
    </div>
    <hr class="qc-sep">
    <div class="qc-lines">
      <p class="qc-line">آخر إجراء: <b>${esc(lastAction ? `${lastAction.kindLabel || lastAction.kind} — ${display(lastAction.date)}` : 'لا يوجد بعد')}</b>
        ${nextAction ? ` · التالي: <b>${esc(nextAction.nextAction || 'إجراء')} — ${display(nextAction.nextActionDate)}</b>` : ''}</p>
      <p class="qc-line">المعادلة: <b data-equation>${esc(equation)}</b>
        <button type="button" class="link" data-trace="due">[اضغط للتفاصيل]</button></p>
      ${projected > 0 ? `<p class="qc-line qc-note">⏳ فترة جارية لم تكتمل${running.length > 1 ? ` (${running.length})` : ''}: قيمتها المتوقعة <b>${money(projected, currency)}</b>${running[0]?.toDate ? ` وتُستحق في <b>${display(running[0].toDate)}</b>` : ''} — لا تدخل في المستحق أعلاه.</p>` : ''}
    </div>
    <hr class="qc-sep">
    <div class="qc-actions" role="group" aria-label="إجراءات سريعة">
      <button type="button" class="ghost" data-qc="duration" title="Alt+5">🧮 احسب مدة</button>
      <button type="button" class="ghost" data-qc="poa" title="Alt+4">📄 توكيل جديد</button>
      <button type="button" class="primary" data-qc="collection" title="Alt+1">💰 محضر تحصيل</button>
      <button type="button" class="ghost" data-qc="action" title="Alt+2">⚡ إجراء</button>
      ${simple ? '' : '<button type="button" class="ghost" data-qc="expense" title="Alt+3">🧾 مصروف</button>'}
      <button type="button" class="ghost" data-qc="print" title="Alt+6">🖨 طباعة</button>
      <button type="button" class="ghost" data-qc="horizon" title="Alt+H">⚙ تغيير تاريخ «المطلوب حتى»</button>
    </div>
  </section>`;
}

/**
 * ربط أزرار البطاقة. `handlers` هي **نفس الدوال القائمة** في بطاقة التنفيذ
 * (traceDialog · durationDialog · simplePoaDialog · simpleCollectionDialog …)
 * فلا يُنشأ مسار موازٍ ولا منطق حسابي ثانٍ.
 */
export function bindExecutionSummaryCard(container, handlers = {}) {
  if (!container) return () => {};
  const call = (name, event) => {
    const fn = handlers[name];
    if (typeof fn !== 'function') return;
    try {
      const out = fn(event);
      if (out && typeof out.catch === 'function') out.catch(() => {});
    } catch { /* لا يُسقط النقرة */ }
  };
  const off = [];
  const on = (selector, type, fn) => {
    container.querySelectorAll(selector).forEach(node => {
      node.addEventListener(type, fn);
      off.push(() => node.removeEventListener(type, fn));
    });
  };
  on('[data-trace]', 'click', event => call('trace', event));
  on('[data-qc]', 'click', event => {
    const key = event.currentTarget.dataset.qc;
    call(key, event);
  });
  on('[data-uimode-toggle]', 'click', event => call('uiMode', event));
  return () => { for (const remove of off) { try { remove(); } catch { /* انتهت العقدة */ } } };
}

export const summaryCardHelpers = Object.freeze({display, money, short, entitlementLabelOf, summaryEquation});
