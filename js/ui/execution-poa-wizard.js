// =====================================================================
// معالج التوكيل من 3 خطوات — بديل نافذة «إنشاء توكيل» الواحدة الطويلة
// ---------------------------------------------------------------------
// 1/3 المدة      : من/إلى + اختصارات (آخر 3/6/12 شهرًا · من آخر توكيل · مخصص)
// 2/3 المكوّنات  : ☑ الرصيد السابق بمصدره · ☑ الفترات (9 × 3,000 = 27,000) ·
//                  ☐ المصروفات · [رسوم] [دمغة]
// 3/3 المعاينة    : ملخص المعادلات + رجوع + حفظ وطباعة
// • لا مسار حسابي موازٍ: كل خطوة تقرأ `simplePoaDraft` نفسه، والحفظ يمر
//   بـ`saveSimplePoa` نفسه، والطباعة بـ`printPoa` نفسه.
// • القالب من الإعدادات: lists.templates.poaBody بمتغيرات {{client}} {{periods}} {{total}} {{fees}}.
// =====================================================================
import {esc} from './dom.js';
import {modal, closeModal} from './modal.js';
import {toast} from './toast.js';
import {localDate} from '../core/clock.js';
import {userError} from '../core/errors.js';
import {fromMinorUnits, toMinorUnits} from '../domain/execution-money.js';
import {isCivilDate, addCivilDays, periodStart, periodIndexOf} from '../domain/execution-period-calendar.js';
import * as S from '../services/execution-simple.js';
import {acquirePrintWindow} from '../services/execution-print.js';
import {anchorOf, calendarForPeriodicity} from './execution-horizon-picker.js';

const display = iso => (isCivilDate(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');
const amount = (minor, currency = 'EGP') => fromMinorUnits(Number(minor || 0), currency)
  .toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});

const STEP_TITLES = Object.freeze(['المدة', 'المكوّنات', 'المعاينة']);

/** اختصارات المدة: تُحسب من الارتكاز لا من اليوم (عادة المكتب في النفقات). */
export function durationShortcuts({anchor, lastPoa = null, today = localDate()} = {}) {
  const out = [];
  const anchorDate = anchor?.anchorDate || '';
  const options = calendarForPeriodicity(anchor?.periodicity || 'monthly', {periodBasis: anchor?.periodBasis, customDays: anchor?.customDays});
  if (isCivilDate(anchorDate)) {
    const reference = today > anchorDate ? today : anchorDate;
    let currentK = 0;
    try { currentK = Math.max(0, periodIndexOf(anchorDate, reference, options)); } catch { currentK = 0; }
    const labels = {3: 'آخر 3 أشهر', 6: 'آخر 6 أشهر', 12: 'آخر 12 شهرًا'};
    for (const months of [3, 6, 12]) {
      const from = (() => { try { return periodStart(anchorDate, Math.max(0, currentK - months + 1), options); } catch { return ''; } })();
      if (isCivilDate(from)) out.push({id: `last${months}`, label: labels[months], fromDate: from, toDate: today, hint: `من بداية الفترة ${display(from)} إلى اليوم`});
    }
  }
  if (lastPoa && isCivilDate(lastPoa.toDate)) {
    out.push({id: 'fromLastPoa', label: 'من آخر توكيل', fromDate: addCivilDays(lastPoa.toDate, 1), toDate: today, hint: `يبدأ بعد نهاية التوكيل ${lastPoa.poaNumber || 'السابق'} (${display(lastPoa.toDate)})`});
  }
  out.push({id: 'custom', label: 'مخصص', fromDate: '', toDate: '', hint: 'أدخل المدة يدويًا'});
  return out;
}

function progressMarkup(step) {
  return `<ol class="wiz-steps" role="list">${STEP_TITLES.map((title, index) => {
    const n = index + 1;
    const state = n === step ? 'is-current' : n < step ? 'is-done' : 'is-todo';
    return `<li class="wiz-step ${state}" aria-current="${n === step}"><span class="wiz-no">${n}</span><span>3/${n} ${esc(title)}</span></li>`;
  }).join('')}</ol>`;
}

/**
 * يفتح المعالج. `options.previousPoaId` يربط التوكيل الجديد بسابقه (إعادة إصدار).
 */
export async function poaWizard(app, executionId, {bundle = null, fromDate = '', toDate = '', previousPoaId = '', notes = '', carryOver = null} = {}) {
  const data = bundle || await S.simpleCardBundle(app.office, executionId, {allowFuture: true});
  const settings = data.settings || {};
  const anchor = anchorOf(data);
  const today = localDate();
  const lastPoa = (data.poas || []).find(row => String(row.status || '') !== 'cancelled') || null;
  const shortcuts = durationShortcuts({anchor, lastPoa, today});
  const firstUnpaid = (data.schedule.rows || []).find(row => Number(row.remainingMinor || 0) > 0)?.fromDate
    || data.schedule.rows?.[0]?.fromDate || today;
  // قرار الرصيد السابق من carry-over: لا يُدرج إلا بموافقة صريحة، والمبلغ
  // المُعدَّل صراحةً يدخل كتجاوز موثّق (يظهر الفرق في ملاحظة المستند).
  const carryInclude = carryOver?.decided ? Boolean(carryOver.include) : true;
  const carryOverride = carryOver?.decided && carryOver.include && carryOver.overridden
    ? fromMinorUnits(Number(carryOver.amountMinor || 0), bundle?.schedule?.currency || 'EGP') : null;
  const state = {
    step: 1,
    fromDate: isCivilDate(fromDate) ? fromDate : (previousPoaId && lastPoa?.toDate ? addCivilDays(lastPoa.toDate, 1) : (lastPoa?.toDate ? addCivilDays(lastPoa.toDate, 1) : firstUnpaid)),
    toDate: isCivilDate(toDate) ? toDate : today,
    includePreviousBalance: carryInclude,
    previousBalanceOverride: carryOverride,
    includePeriods: true,
    expenseIds: (data.expenses || []).filter(expense => expense.includeInPoa).map(expense => expense.id),
    fees: '0', stamps: '0',
    poaNumber: '', date: today, notes: String(notes || ''),
    previousPoaId: previousPoaId || '',
    rangeDecisions: [],
    draft: null, error: ''
  };
  // المدة لا يجوز أن تُفتح مقلوبة (كانت نافذة التوكيل ترمي RangeError بلا تفسير).
  if (state.toDate < state.fromDate) state.toDate = state.fromDate;

  const card = modal(`<h2 class="modal-title">📄 إنشاء توكيل — 3 خطوات</h2>
    <div data-wiz-progress>${progressMarkup(1)}</div>
    <div class="wiz-body" data-wiz-body><p class="muted">جارٍ التحضير…</p></div>
    <div class="form-actions" data-wiz-actions></div>`);
  const body = card.querySelector('[data-wiz-body]');
  const actions = card.querySelector('[data-wiz-actions]');
  const progress = card.querySelector('[data-wiz-progress]');
  const customBody = String(settings?.lists?.templates?.poaBody || '').trim();

  const computeDraft = async () => {
    state.draft = await S.simplePoaDraft(app.office, executionId, {
      fromDate: state.fromDate, toDate: state.toDate,
      includePreviousBalance: state.includePreviousBalance,
      previousBalanceOverride: state.previousBalanceOverride,
      expenseIds: state.expenseIds, rangeDecisions: state.rangeDecisions,
      fees: state.fees, stamps: state.stamps, allowFuture: true
    });
    return state.draft;
  };

  const renderActions = () => {
    actions.innerHTML = `${state.step > 1 ? '<button type="button" class="ghost" data-wiz-back>↩ رجوع</button>' : ''}
      ${state.step < 3 ? '<button type="button" class="primary" data-wiz-next>التالي ←</button>' : ''}
      ${state.step === 3 ? '<button type="button" class="primary" data-wiz-save>💾 حفظ وطباعة</button><button type="button" class="ghost" data-wiz-print-only>طباعة بلا حفظ</button>' : ''}
      <button type="button" class="ghost" data-close>إلغاء</button>`;
    actions.querySelector('[data-wiz-back]')?.addEventListener('click', () => { state.step -= 1; render().catch(() => {}); });
    actions.querySelector('[data-wiz-next]')?.addEventListener('click', async () => {
      if (state.step === 1 && (!isCivilDate(state.fromDate) || !isCivilDate(state.toDate) || state.toDate < state.fromDate)) {
        toast('اختر مدة صحيحة: تاريخ البداية قبل النهاية.', 'error'); return;
      }
      if (state.step === 2) {
        const missing = collectBoundaryDecisions();
        if (missing) { toast(missing, 'error'); return; }
      }
      state.step += 1;
      await render();
    });
    actions.querySelector('[data-wiz-save]')?.addEventListener('click', () => save(true));
    actions.querySelector('[data-wiz-print-only]')?.addEventListener('click', () => save(false));
  };

  /** قرارات الفترات الحدّية: لا تُحفظ بلا اختيار صريح وسبب (بلا اعتماد صامت). */
  const collectBoundaryDecisions = () => {
    const hosts = [...body.querySelectorAll('[data-range-poa]')];
    if (!hosts.length) return '';
    const decisions = hosts.map(host => {
      const choice = host.querySelector('[data-poa-choice]')?.value || '';
      const reason = String(host.querySelector('[data-poa-reason]')?.value || '').trim();
      const rawAmount = host.querySelector('[data-poa-amount]')?.value || '';
      let amountMinor = null;
      if (choice === 'MANUAL') {
        try { amountMinor = toMinorUnits(rawAmount, state.draft?.currency || 'EGP'); } catch { amountMinor = null; }
      }
      return {
        periodKey: host.dataset.periodKey, kind: host.dataset.kind, itemId: host.dataset.itemId || '',
        anchorDate: host.dataset.anchorDate || '', k: Number(host.dataset.k || 0),
        fromDate: host.dataset.fromDate, toDate: host.dataset.toDate, choice, reason,
        ...(choice === 'MANUAL' ? {amountMinor} : {})
      };
    });
    const invalid = decisions.find(row => !row.choice);
    if (invalid) return `اختر قرارًا صريحًا للفترة ${display(invalid.fromDate)} ← ${display(invalid.toDate)} (إدراج كاملة / استبعاد / مبلغ يدوي).`;
    const noReason = decisions.find(row => !row.reason);
    if (noReason) return `اكتب سبب القرار للفترة ${display(noReason.fromDate)} ← ${display(noReason.toDate)} — يُحفظ السبب في سجل النشاط.`;
    const badManual = decisions.find(row => row.choice === 'MANUAL' && !(Number.isSafeInteger(row.amountMinor) && row.amountMinor >= 0));
    if (badManual) return 'أدخل مبلغًا كاملًا صحيحًا للفترة اليدوية (لا يُحسب مبلغ بنسبة الأيام).';
    state.rangeDecisions = decisions;
    return '';
  };

  const step1 = () => `<fieldset><legend>1/3 المدة</legend>
    <div class="form-grid">
      <label class="field">من <b class="req">*</b><input type="date" name="fromDate" value="${esc(state.fromDate)}"></label>
      <label class="field">إلى <b class="req">*</b><input type="date" name="toDate" value="${esc(state.toDate)}"></label>
      <label class="field">تاريخ التوكيل<input type="date" name="date" value="${esc(state.date)}"></label>
      <label class="field">رقم التوكيل (اختياري — يُولَّد تلقائيًا إن تُرك فارغًا)<input name="poaNumber" value="${esc(state.poaNumber)}" placeholder="لا تكتب رقم توكيل سابق"></label>
    </div>
    <div class="quick-chips" data-wiz-shortcuts>
      ${shortcuts.map(item => `<button type="button" class="chip" data-shortcut="${esc(item.id)}" data-from="${esc(item.fromDate)}" data-to="${esc(item.toDate)}" title="${esc(item.hint || '')}">${esc(item.label)}</button>`).join('')}
    </div>
    <p class="muted small">الارتكاز: <b>${esc(display(anchor.anchorDate))}</b>${anchor.entitlementType ? ` · ${esc(anchor.entitlementType)}` : ''} — الاختصارات تُحسب منه لا من اليوم.
      ${lastPoa ? `آخر توكيل: ${esc(lastPoa.poaNumber || 'بلا رقم')} حتى ${esc(display(lastPoa.toDate))}.` : 'لا توكيل سابق على هذا التنفيذ.'}</p>
    ${state.error ? `<p class="hint hint-warn">${esc(state.error)}</p>` : ''}
  </fieldset>`;

  const step2 = draft => {
    const currency = draft.currency;
    const periodEquation = (draft.periodEquations?.[0]) || `${draft.lines.filter(line => line.kind === 'period').length} فترة = ${amount(draft.periodDueMinor, currency)}`;
    const prevSource = draft.previousAction
      ? `مرتبط بمحضر ${draft.previousAction.kindLabel || draft.previousAction.kind || 'تبديد'}${draft.previousAction.referenceNumber ? ` رقم ${esc(draft.previousAction.referenceNumber)}` : ''}${draft.previousAction.date ? ` بتاريخ ${esc(display(draft.previousAction.date))}` : ''}`
      : 'لا يوجد محضر تبديد/حجز مرتبط — الرصيد السابق هو متبقٍ غير مسدد من فترات أقدم.';
    const partials = draft.partials || [];
    return `<fieldset><legend>2/3 المكوّنات</legend>
      <label class="check-line"><input type="checkbox" name="includePreviousBalance" ${state.includePreviousBalance ? 'checked' : ''}>
        <b>الرصيد السابق</b> — محسوب ${amount(draft.previousBalanceMinor, currency)} ج.م${draft.previousOverridden ? ` · <b>مُدرج ${amount(draft.previousAppliedMinor, currency)} ج.م</b>` : ''}
        <small class="muted">${esc(prevSource)} · جزء من المتبقي ولا يُضاف عليه مرتين.</small></label>
      ${carryOver?.decided ? `<p class="hint ${carryOver.include ? 'hint-ok' : 'hint-warn'} small">قرارك في الرصيد السابق: ${carryOver.include ? `إدراج ${amount(carryOver.amountMinor, currency)} ج.م` : 'تجاهل'}${carryOver.reason ? ` — ${esc(carryOver.reason)}` : ''} (مسجَّل في سجل النشاط).</p>` : ''}
      <label class="field" data-prev-override>المبلغ المُدرج فعلًا (ج.م)<input name="previousBalanceOverride" inputmode="decimal" value="${esc(state.previousBalanceOverride ?? '')}" placeholder="اتركه فارغًا لاستخدام المحسوب">
        <small class="hint">يُستخدم عند سداد جزء خارج النظام — يُذكر الفرق في المستند ولا يُحسب صامتًا.</small></label>
      <label class="check-line"><input type="checkbox" name="includePeriods" ${state.includePeriods ? 'checked' : ''}>
        <b>فترات المدة</b> — <code>${esc(periodEquation)}</code>
        <small class="muted">مستحق ${amount(draft.periodDueMinor, currency)} − محصّل داخل المدة ${amount(draft.periodPaidMinor, currency)} = <b>مطلوب ${amount(draft.periodClaimMinor ?? draft.periodDueMinor, currency)}</b> ج.م</small></label>
      <fieldset data-expenses><legend>المصروفات (تُدرج باختيارك — منفصلة عن أصل الدين)</legend>
        ${(data.expenses || []).length ? data.expenses.map(expense => `<label class="check-line">
          <input type="checkbox" name="expense" value="${esc(expense.id)}" ${state.expenseIds.includes(expense.id) ? 'checked' : ''}>
          ${esc(expense.label)} — ${amount(expense.amountMinor, currency)} ج.م · ${esc(display(expense.date))}${expense.borneByLabel ? ` (يتحمله: ${esc(expense.borneByLabel)})` : ''}</label>`).join('')
          : '<p class="muted small">لا توجد مصروفات مسجلة على هذا التنفيذ.</p>'}
      </fieldset>
      <div class="form-grid">
        <label class="field">رسوم (إدخال يدوي)<input name="fees" inputmode="decimal" value="${esc(state.fees)}">
          <small class="hint">النظام لا يفترض رسومًا — أدخلها حسب واقع الملف.</small></label>
        <label class="field">دمغة (إدخال يدوي)<input name="stamps" inputmode="decimal" value="${esc(state.stamps)}">
          <small class="hint">النظام لا يفترض دمغة — أدخلها حسب واقع الملف.</small></label>
        <label class="field span2">ملاحظات التوكيل (تُطبع في المستند)<input name="notes" value="${esc(state.notes)}" placeholder="مثال: توكيل بمحضر التبديد رقم …"></label>
      </div>
      ${partials.length ? `<section class="hint hint-warn"><b>فترة حدّية لا تُقسَّم بالأيام — يلزم قرار صريح وسبب.</b>
        ${partials.map(row => `<div class="form-grid" data-range-poa data-period-key="${esc(row.periodKey)}" data-kind="${esc(row.kind)}" data-item-id="${esc(row.itemId || '')}" data-anchor-date="${esc(row.anchorDate || '')}" data-k="${esc(String(row.k ?? ''))}" data-from-date="${esc(row.fromDate)}" data-to-date="${esc(row.toDate)}">
          <p class="small">${esc(display(row.fromDate))} – ${esc(display(row.toDate))} — الفترة الكاملة ${amount(row.dueMinor || 0, currency)} ج.م.</p>
          <label class="field">القرار<select data-poa-choice>
            <option value="">— اختر صراحةً —</option>
            <option value="INCLUDE_FULL"${row.choice === 'INCLUDE_FULL' ? ' selected' : ''}>إدراج الفترة كاملة</option>
            <option value="EXCLUDE"${row.choice === 'EXCLUDE' ? ' selected' : ''}>استبعاد الفترة</option>
            <option value="MANUAL"${row.choice === 'MANUAL' ? ' selected' : ''}>مبلغ كامل يدوي</option>
          </select></label>
          <label class="field">سبب القرار<textarea data-poa-reason rows="2" placeholder="سبب القرار — يُحفظ في سجل النشاط">${esc(row.reason || '')}</textarea></label>
          <label class="field" data-poa-manual ${row.choice === 'MANUAL' ? '' : 'hidden'}>المبلغ الكامل<input data-poa-amount type="number" min="0" step="0.01" inputmode="decimal" value="${row.amountMinor === null || row.amountMinor === undefined ? '' : esc(String(fromMinorUnits(row.amountMinor, currency)))}"></label>
        </div>`).join('')}</section>` : ''}
      ${(draft.runningPeriods || []).length ? `<p class="hint hint-info small">فترات جارية ظاهرة بمبلغها المتوقع <b>ولا تدخل في الإجمالي</b>: ${draft.runningPeriods.map(row => `${esc(row.label || `${display(row.fromDate)} – ${display(row.toDate)}`)} = ${amount(row.projectedMinor || 0, currency)} ج.م`).join(' · ')}</p>` : ''}
    </fieldset>`;
  };

  const step3 = draft => {
    const currency = draft.currency;
    const claim = draft.periodClaimMinor ?? draft.periodDueMinor;
    const rows = [
      ['الرصيد السابق', draft.previousAppliedMinor, draft.previousNote || ''],
      ['فترات المدة (المطلوب بعد خصم المحصّل)', claim, (draft.periodEquations?.[0]) || ''],
      ['مصروفات مختارة', draft.expensesMinor, ''],
      ['رسوم (يدوي)', draft.feesMinor, 'النظام لا يفترض رسومًا'],
      ['دمغة (يدوي)', draft.stampsMinor, 'النظام لا يفترض دمغة']
    ];
    return `<fieldset><legend>3/3 المعاينة</legend>
      <div class="exec-kv">
        <span>الموكل (المستحق)</span><b>${esc(data.creditor?.name || data.client?.fullName || '—')}</b>
        <span>المنفذ ضده</span><b>${esc(data.debtor?.name || '—')}</b>
        <span>مدة التوكيل</span><b>${esc(display(state.fromDate))} ← ${esc(display(state.toDate))}</b>
        <span>تاريخ التوكيل</span><b>${esc(display(state.date))}</b>
        <span>رقم التوكيل</span><b>${esc(state.poaNumber || 'يُولَّد تلقائيًا عند الحفظ')}</b>
        ${state.previousPoaId ? '<span>نوع التوكيل</span><b>إعادة إصدار مرتبطة بتوكيل سابق</b>' : ''}
      </div>
      <table class="exec-table mini-table"><thead><tr><th>المكوّن</th><th>المبلغ</th><th>المصدر / المعادلة</th></tr></thead><tbody>
        ${rows.map(([label, minor, note]) => `<tr><td>${esc(label)}</td><td style="text-align:left">${amount(minor, currency)} ج.م</td><td class="muted small">${esc(note || '')}</td></tr>`).join('')}
        <tr class="total"><td><b>إجمالي التوكيل</b></td><td style="text-align:left"><b>${amount(draft.totalMinor, currency)} ج.م</b></td><td class="muted small">${esc(draft.equation || '')}</td></tr>
      </tbody></table>
      <details open><summary>بنود التوكيل (${draft.lines.length})</summary><ul class="plain-list">${draft.lines.map(line => `<li>${esc(line.label)} — <b>${amount(line.amountMinor, currency)} ج.م</b>${line.equation ? ` <span class="muted small">(${esc(line.equation)})</span>` : ''}</li>`).join('')}</ul></details>
      ${customBody ? `<details><summary>معاينة نص التوكيل من الإعدادات (lists.templates.poaBody)</summary><pre class="wiz-template">${esc(renderCustomBody(draft, data, state))}</pre></details>`
        : '<p class="muted small">لم يُضبط نص توكيل مخصص في الإعدادات — يُستخدم قالب «توكيل بالتنفيذ» المخزّن. يمكنك تحرير النص من إعدادات التنفيذ (poaBody).</p>'}
      <p class="muted small">قاعدة منع الازدواج: إصدار التوكيل لا يغيّر المتبقي أبدًا — المتبقي داخل المدة ${amount(draft.periodRemainingMinor, currency)} ج.م.</p>
    </fieldset>`;
  };

  const renderCustomBody = (draft, bundleData, wizardState) => customBody
    .replace(/\{\{\s*client\s*\}\}/g, bundleData.creditor?.name || bundleData.client?.fullName || '')
    .replace(/\{\{\s*debtor\s*\}\}/g, bundleData.debtor?.name || '')
    .replace(/\{\{\s*periods\s*\}\}/g, draft.lines.filter(line => line.kind === 'period')
      .map(line => `${line.label}: ${amount(line.amountMinor, draft.currency)} ج.م`).join('\n'))
    .replace(/\{\{\s*total\s*\}\}/g, `${amount(draft.totalMinor, draft.currency)} ج.م`)
    .replace(/\{\{\s*fees\s*\}\}/g, `${amount(draft.feesMinor, draft.currency)} ج.م`)
    .replace(/\{\{\s*stamps\s*\}\}/g, `${amount(draft.stampsMinor, draft.currency)} ج.م`)
    .replace(/\{\{\s*expenses\s*\}\}/g, `${amount(draft.expensesMinor, draft.currency)} ج.م`)
    .replace(/\{\{\s*previousBalance\s*\}\}/g, `${amount(draft.previousAppliedMinor, draft.currency)} ج.م`)
    .replace(/\{\{\s*fromDate\s*\}\}/g, display(wizardState.fromDate))
    .replace(/\{\{\s*toDate\s*\}\}/g, display(wizardState.toDate))
    .replace(/\{\{\s*poaNumber\s*\}\}/g, wizardState.poaNumber || 'يُولَّد تلقائيًا')
    .replace(/\{\{\s*equation\s*\}\}/g, draft.equation || '')
    .replace(/\{\{\s*judgments\s*\}\}/g, (bundleData.judgments || []).map(row => row.judgmentNumber).filter(Boolean).join(' · '));

  const readForm = () => {
    const from = body.querySelector('[name="fromDate"]'); if (from) state.fromDate = from.value;
    const to = body.querySelector('[name="toDate"]'); if (to) state.toDate = to.value;
    const date = body.querySelector('[name="date"]'); if (date) state.date = date.value;
    const poaNumber = body.querySelector('[name="poaNumber"]'); if (poaNumber) state.poaNumber = poaNumber.value;
    const prev = body.querySelector('[name="includePreviousBalance"]'); if (prev) state.includePreviousBalance = prev.checked;
    const prevOverride = body.querySelector('[name="previousBalanceOverride"]');
    if (prevOverride) state.previousBalanceOverride = String(prevOverride.value || '').trim() || null;
    const periods = body.querySelector('[name="includePeriods"]'); if (periods) state.includePeriods = periods.checked;
    const fees = body.querySelector('[name="fees"]'); if (fees) state.fees = fees.value || '0';
    const stamps = body.querySelector('[name="stamps"]'); if (stamps) state.stamps = stamps.value || '0';
    const notesField = body.querySelector('[name="notes"]'); if (notesField) state.notes = notesField.value;
    const expenseBoxes = [...body.querySelectorAll('[name="expense"]')];
    if (expenseBoxes.length) state.expenseIds = expenseBoxes.filter(box => box.checked).map(box => box.value);
  };

  const render = async () => {
    readForm();
    progress.innerHTML = progressMarkup(state.step);
    state.error = '';
    try {
      if (state.step === 1) {
        body.innerHTML = step1();
      } else {
        // إلغاء اختيار «الفترات» يعني توكيلًا بالرصيد السابق وحده — لا يُحسب صامتًا.
        const draft = await computeDraft();
        if (!state.includePeriods) {
          draft.periodClaimMinor = 0; draft.periodDueMinor = 0; draft.periodPaidMinor = 0;
          draft.lines = draft.lines.filter(line => line.kind !== 'period');
          draft.totalMinor = (draft.previousAppliedMinor || 0) + (draft.expensesMinor || 0) + (draft.feesMinor || 0) + (draft.stampsMinor || 0);
        }
        body.innerHTML = state.step === 2 ? step2(draft) : step3(draft);
      }
      bindStep();
      renderActions();
    } catch (error) {
      state.error = userError(error);
      body.innerHTML = `<p class="hint hint-warn">${esc(state.error)}</p>
        <p class="muted small">راجع المدة: يجب أن تكون داخل فترات محسوبة على هذا التنفيذ.</p>`;
      renderActions();
    }
  };

  const bindStep = () => {
    body.querySelectorAll('[data-shortcut]').forEach(button => button.addEventListener('click', () => {
      if (button.dataset.from) state.fromDate = button.dataset.from;
      if (button.dataset.to) state.toDate = button.dataset.to;
      render().catch(() => {});
    }));
    body.querySelectorAll('[data-poa-choice]').forEach(select => select.addEventListener('change', () => {
      const host = select.closest('[data-range-poa]');
      const manual = host?.querySelector('[data-poa-manual]');
      if (manual) manual.hidden = select.value !== 'MANUAL';
    }));
    const rerender = () => { clearTimeout(rerender.timer); rerender.timer = setTimeout(() => render().catch(() => {}), 250); };
    body.querySelectorAll('[name="includePreviousBalance"],[name="includePeriods"],[name="expense"]').forEach(input => input.addEventListener('change', rerender));
    body.querySelectorAll('[name="fees"],[name="stamps"],[name="previousBalanceOverride"]').forEach(input => input.addEventListener('input', rerender));
  };

  const save = async (persist) => {
    const button = actions.querySelector('[data-wiz-save],[data-wiz-print-only]');
    if (button) button.disabled = true;
    // النافذة تُحجز داخل النقرة قبل أي قراءة (وإلا منعها المتصفح بعد الـ await).
    const printWindow = acquirePrintWindow('توكيل بالتنفيذ');
    try {
      readForm();
      const missing = collectBoundaryDecisions();
      if (missing) throw new Error(missing);
      const draft = await computeDraft();
      if (!state.includePeriods) {
        draft.periodClaimMinor = 0; draft.periodDueMinor = 0; draft.periodPaidMinor = 0;
        draft.lines = draft.lines.filter(line => line.kind !== 'period');
        draft.totalMinor = (draft.previousAppliedMinor || 0) + (draft.expensesMinor || 0) + (draft.feesMinor || 0) + (draft.stampsMinor || 0);
      }
      if (!(Number(draft.totalMinor) > 0)) throw new Error('إجمالي التوكيل صفر — اختر مكوّنًا واحدًا على الأقل أو أدخل مبلغًا فعليًا.');
      if (!persist) {
        // طباعة بلا حفظ: كشف عن نفس المدة (لا يُنشئ توكيلًا ولا يغيّر رصيدًا).
        await S.printSimpleStatement(app.office, executionId, {mode: 'range', fromDate: state.fromDate, toDate: state.toDate, window: printWindow});
        toast('فُتح الكشف للطباعة بلا حفظ توكيل', 'ok');
        return;
      }
      await S.saveSimplePoa(app.office, executionId, {...draft, poaNumber: state.poaNumber, previousPoaId: state.previousPoaId, notes: state.notes},
        {date: state.date, notes: state.notes, printNow: true, printWindow});
      closeModal();
      toast('حُفظ التوكيل كنسخة غير قابلة للتعديل وفُتح للطباعة', 'ok');
      document.dispatchEvent(new CustomEvent('exec:record-saved', {detail: {}}));
      await app.refresh();
    } catch (error) {
      if (printWindow) { try { printWindow.close(); } catch { /* تجاهل */ } }
      toast(userError(error), 'error');
      if (button) button.disabled = false;
    }
  };

  await render();
  return card;
}
