// =====================================================================
// واجهة محرك الفترات — «+ فترة يدوية» و«اقتراح الفترة التالية» وشرح القاعدة
// ---------------------------------------------------------------------
// • المعادلة تحت كل فترة دائمًا (قاعدة شفافية مطلوبة).
// • الفترة اليدوية شريحة مقطوعة مستقلة: لا تعدّل الفترات الآلية.
// • الاقتراح = آخر نهاية + 1 بنفس القاعدة، ولا يُحفظ إلا بقرار المستخدم.
// =====================================================================
import {esc} from './dom.js';
import {modal, closeModal, confirmBox} from './modal.js';
import {toast} from './toast.js';
import {localDate} from '../core/clock.js';
import {userError} from '../core/errors.js';
import {fromMinorUnits} from '../domain/execution-money.js';
import {isCivilDate} from '../domain/execution-calendar.js';
import * as MP from '../services/execution-manual-periods.js';
import {periodRuleExplanation} from '../services/execution-manual-periods.js';
import {anchorOf} from './execution-horizon-picker.js';

const display = iso => (isCivilDate(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');
const amount = (minor, currency = 'EGP') => fromMinorUnits(Number(minor || 0), currency)
  .toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});

/** سطر المعادلة تحت أي فترة (آلية أو يدوية) — يُستدعى من جدول الحساب. */
export function periodEquationLine(row, currency = 'EGP') {
  if (!row) return '';
  const due = Number(row.dueMinor || 0);
  const paid = Number(row.paidMinor || 0);
  const remaining = Number(row.remainingMinor || 0);
  const base = row.trace?.equation || '';
  const paidPart = paid ? ` − محصّل ${amount(paid, currency)}` : '';
  return `${base}${paidPart ? `${base ? ' · ' : ''}${amount(due, currency)}${paidPart} = ${amount(remaining, currency)}` : ''}`;
}

/** ملاحظة مصدر القيمة: من أي بند/حكم جاءت هذه الفترة، وهل ارتبطت بحركة سابقة. */
export function periodSourceNote(row, bundle) {
  if (!row) return '';
  const slices = bundle?.slices || [];
  const judgments = bundle?.judgments || [];
  const sliceIds = new Set((row.units || []).flatMap(unit => (unit.parts || []).map(part => part.sliceId).filter(Boolean)));
  const sources = slices.filter(slice => sliceIds.has(slice.id));
  if (!sources.length) return row.trace?.sources?.length ? 'مشتقة من بند قيمة مسجَّل' : '';
  return sources.map(slice => {
    const judgment = judgments.find(item => item.id === (slice.judgmentId || slice.linkedJudgmentId));
    const manual = MP.isManualSlice(slice);
    const kind = manual ? 'فترة يدوية' : (judgment?.judgmentKind === 'later' ? 'حكم لاحق' : 'حكم');
    const ref = manual
      ? String(slice.sourceReference || '').split('|').slice(1).join(' · ')
      : (judgment?.judgmentNumber ? `رقم ${judgment.judgmentNumber}` : (judgment?.court || ''));
    return `${slice.entitlementType || 'بند'} — ${kind}${ref ? ` ${ref}` : ''}`;
  }).join(' · ');
}

/** هل هذه الفترة مرتبطة بحركة سابقة (محضر تحصيل)؟ — تُستخدم في تأكيد التعديل. */
export function periodLinkedReceipts(row, bundle) {
  if (!row) return [];
  const receipts = new Map((bundle?.receipts || []).map(receipt => [receipt.id, receipt]));
  const lines = row.lines || [];
  const out = [];
  for (const line of lines) {
    const receipt = receipts.get(line.receiptId);
    if (!receipt) continue;
    out.push({receipt, amountMinor: Number(line.amountMinor || 0), mode: line.mode || 'auto'});
  }
  return out;
}

/**
 * تأكيد قبل تعديل فترة مرتبطة بحركة سابقة.
 * الخيار الافتراضي «سجّل تصحيحًا جديدًا بدل التعديل» ولا يلمس الأصل
 * (حركة عكسية + حركة جديدة في الدفتر Append-Only، والنسخة القديمة محفوظة).
 * الخيار الثاني «عدّل الأصلي مع تسجيل السبب» تعديل وصفي فقط (مرجع/ملاحظات/
 * طريقة/تاريخ) بلا تغيير المبلغ — لأن تغيير المبلغ مساره التصحيح حتمًا.
 * كل قرار يُسجَّل في Activity Log.
 */
export function confirmPeriodEdit(app, bundle, row) {
  const linked = periodLinkedReceipts(row, bundle);
  if (!linked.length) return Promise.resolve({mode: 'correction', reason: '', linked: []});
  const currency = bundle?.schedule?.currency || 'EGP';
  const list = linked.map(item => `${item.receipt.receiptNumber || 'محضر'} بتاريخ ${display(item.receipt.date)} بمبلغ ${amount(item.amountMinor, currency)}`).join(' · ');
  return new Promise(resolve => {
    const card = modal(`<h2 class="modal-title">⚠ هذه الفترة مرتبطة بحركة سابقة</h2>
      <p class="hint hint-warn">هذه الفترة مرتبطة بحركة سابقة (${esc(list)}). التعديل المباشر يغيّر السجل الأصلي.</p>
      <p class="muted small">«التصحيح الجديد» يُبقي الأصل كما هو: حركة عكسية + حركة جديدة في الدفتر، والنسخة السابقة محفوظة على المحضر.
        «تعديل الأصلي» وصفي فقط (مرجع / ملاحظات / طريقة التحصيل / تاريخ) ولا يغيّر المبلغ.</p>
      <form class="simple-form" data-form="period-edit-confirm">
        <label class="field span2">السبب (يُحفظ في سجل النشاط) <b class="req">*</b>
          <textarea name="reason" rows="2" placeholder="مثال: تصحيح رقم المحضر أو تصويب تخصيص الفترة">${esc(`تصحيح على الفترة ${display(row.fromDate)} ← ${display(row.toDate)}`)}</textarea></label>
        <div class="form-actions">
          <button type="button" class="primary" data-mode="correction">سجّل تصحيحًا جديدًا بدل التعديل</button>
          <button type="button" class="ghost" data-mode="direct">عدّل الأصلي مع تسجيل السبب</button>
          <button type="button" class="ghost" data-close>إلغاء</button>
        </div>
      </form>`);
    const form = card.querySelector('[data-form="period-edit-confirm"]');
    const finish = async mode => {
      const reason = String(form.querySelector('[name="reason"]').value || '').trim();
      if (!reason) { toast('السبب مطلوب — يُحفظ القرار في سجل النشاط', 'error'); form.querySelector('[name="reason"]').focus(); return; }
      closeModal();
      try {
        await import('../services/execution-simple.js').then(m => m.logExecutionDecision(app.office, {
          executionId: bundle.execution.id,
          action: mode === 'correction' ? 'period-correction' : 'period-direct-edit',
          summary: `${mode === 'correction' ? 'تصحيح جديد بدل التعديل' : 'تعديل الأصلي'} للفترة ${display(row.fromDate)} ← ${display(row.toDate)} — ${reason}`,
          metadata: {mode, reason, periodKey: row.periodKeys?.[0] || row.fromDate, linkedReceipts: linked.map(item => item.receipt.id)}
        }));
      } catch (error) { console.info('period-edit decision log failed', error); }
      resolve({mode, reason, linked});
    };
    card.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => finish(button.dataset.mode)));
    card.querySelectorAll('[data-close],[data-modal-back]').forEach(button => button.addEventListener('click', () => resolve({mode: 'cancel', reason: '', linked})));
  });
}

/**
 * تعديل محضر مرتبط بفترة: يمر بالتأكيد أولًا، ثم ينفّذ المسار المختار.
 * `openEdit(receipt, reason)` = نموذج التعديل القائم (تصحيح: عكس + حركة جديدة).
 */
export async function editLinkedReceipt(app, bundle, row, receipt, {openEdit = null} = {}) {
  const decision = await confirmPeriodEdit(app, bundle, row);
  if (decision.mode === 'cancel') return null;
  const SIMPLE = await import('../services/execution-simple.js');
  if (decision.mode === 'direct') {
    // تعديل وصفي على الأصل — بلا تغيير مبلغ (تغيير المبلغ مساره التصحيح).
    try {
      await SIMPLE.editReceiptDescriptive(app.office, {receiptId: receipt.id, reason: decision.reason});
      toast('عُدِّل السجل الأصلي وصفيًا وسُجِّل السبب — المبلغ لم يتغير', 'ok');
      await app.refresh();
    } catch (error) { toast(userError(error), 'error'); }
    return decision;
  }
  if (typeof openEdit === 'function') await openEdit(receipt, decision.reason);
  return decision;
}

/** نافذة «+ فترة يدوية». */
export async function manualPeriodDialog(app, executionId, {bundle = null} = {}) {
  const data = bundle || await import('../services/execution-simple.js').then(m => m.simpleCardBundle(app.office, executionId, {allowFuture: true}));
  const anchor = anchorOf(data);
  const suggestion = await MP.suggestNextPeriod(app.office, executionId, {bundle: data}).catch(() => ({available: false}));
  const card = modal(`<h2 class="modal-title">➕ فترة يدوية</h2>
    <p class="muted small">تُضاف إلى الحساب كبند مستقل <b>ولا تعدّل الفترات الآلية</b>. السبب إلزامي ويُطبع مع الكشف.</p>
    <p class="hint hint-info small">قاعدة الفترات: ${esc(periodRuleExplanation({anchorDate: anchor.anchorDate, periodBasis: anchor.periodBasis, periodicity: anchor.periodicity}))}</p>
    <form class="simple-form" data-form="manual-period">
      <div class="form-grid">
        <label class="field">من <b class="req">*</b><input type="date" name="fromDate" value="${esc(suggestion?.fromDate || localDate())}"></label>
        <label class="field">إلى <b class="req">*</b><input type="date" name="toDate" value="${esc(suggestion?.toDate || localDate())}"></label>
        <label class="field">المبلغ (ج.م) <b class="req">*</b><input name="amount" inputmode="decimal" value="${suggestion?.amountMinor ? esc(amount(suggestion.amountMinor, suggestion.currency)) : ''}"></label>
        <label class="field">البند<input name="entitlementType" value="${esc(suggestion?.entitlementType || anchor.entitlementType || '')}" placeholder="مثال: نفقة صغار"></label>
        <label class="field span2">السبب <b class="req">*</b><textarea name="reason" rows="2" placeholder="مثال: فرق محضر تبديد رقم 452 لسنة 2026 لم يُدرج في الفترات الآلية"></textarea></label>
      </div>
      <div class="alloc-preview" data-preview aria-live="polite"><span class="muted small">المعادلة تظهر هنا…</span></div>
      ${suggestion?.available ? `<div class="form-actions"><button type="button" class="ghost" data-use-suggestion>💡 استخدام اقتراح الفترة التالية (${esc(display(suggestion.fromDate))} ← ${esc(display(suggestion.toDate))})</button></div>` : ''}
      <div class="form-actions">
        <button type="submit" class="primary" data-save>حفظ الفترة اليدوية</button>
        <button type="button" class="ghost" data-close>إلغاء</button>
      </div>
    </form>`);
  const form = card.querySelector('[data-form="manual-period"]');
  const preview = form.querySelector('[data-preview]');
  const renderPreview = () => {
    const from = form.querySelector('[name="fromDate"]').value;
    const to = form.querySelector('[name="toDate"]').value;
    const raw = String(form.querySelector('[name="amount"]').value || '').trim();
    const numeric = Number(String(raw).replace(/[^\d.-]/g, ''));
    if (!isCivilDate(from) || !(numeric > 0)) { preview.innerHTML = '<span class="muted small">أدخل المدة والمبلغ لتظهر المعادلة.</span>'; return; }
    preview.innerHTML = `<b>المعادلة:</b> فترة يدوية ${esc(display(from))} ← ${esc(display(to || from))} = <b>${esc(amount(Math.round(numeric * 100)))} ج.م</b>
      <br><span class="muted small">تُحفظ كشريحة مقطوعة ببند مستقل — الفترات الآلية لا تتغير.</span>`;
  };
  form.addEventListener('input', renderPreview);
  form.addEventListener('change', renderPreview);
  renderPreview();
  card.querySelector('[data-use-suggestion]')?.addEventListener('click', () => {
    if (!suggestion?.available) return;
    form.querySelector('[name="fromDate"]').value = suggestion.fromDate;
    form.querySelector('[name="toDate"]').value = suggestion.toDate;
    if (suggestion.amountMinor) form.querySelector('[name="amount"]').value = amount(suggestion.amountMinor, suggestion.currency);
    if (suggestion.entitlementType) form.querySelector('[name="entitlementType"]').value = suggestion.entitlementType;
    renderPreview();
    toast('استُخدم اقتراح الفترة التالية — راجع السبب ثم احفظ', 'info');
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form).entries());
    const button = form.querySelector('[data-save]');
    button.disabled = true;
    try {
      const out = await MP.createManualPeriod(app.office, {
        executionId, fromDate: values.fromDate, toDate: values.toDate,
        amount: values.amount, reason: values.reason, entitlementType: values.entitlementType
      });
      closeModal();
      toast(`أُضيفت فترة يدوية: ${out.equation}`, 'ok');
      document.dispatchEvent(new CustomEvent('exec:record-saved', {detail: {}}));
      await app.refresh();
    } catch (error) {
      toast(userError(error), 'error');
      button.disabled = false;
    }
  });
  return card;
}

/** نافذة «اقتراح الفترة التالية» — تعرض الاقتراح ومعادلته ولا تحفظ صامتًا. */
export async function nextPeriodDialog(app, executionId, {bundle = null} = {}) {
  const data = bundle || await import('../services/execution-simple.js').then(m => m.simpleCardBundle(app.office, executionId, {allowFuture: true}));
  const suggestion = await MP.suggestNextPeriod(app.office, executionId, {bundle: data});
  if (!suggestion.available) {
    return modal(`<h2 class="modal-title">💡 اقتراح الفترة التالية</h2><p class="hint hint-warn">${esc(suggestion.reason || 'لا يوجد اقتراح متاح.')}</p>
      <div class="form-actions"><button type="button" class="ghost" data-close>إغلاق</button></div>`);
  }
  const card = modal(`<h2 class="modal-title">💡 اقتراح الفترة التالية</h2>
    <div class="exec-kv">
      <span>الارتكاز</span><b>${esc(display(suggestion.anchorDate))}</b>
      <span>القاعدة</span><b>${esc(suggestion.periodBasis)} · ${esc(suggestion.periodicity)}</b>
      <span>من</span><b>${esc(display(suggestion.fromDate))}</b>
      <span>إلى</span><b>${esc(display(suggestion.toDate))}</b>
      <span>المبلغ</span><b>${esc(amount(suggestion.amountMinor, suggestion.currency))} ج.م</b>
    </div>
    <p class="hint hint-info"><b>المعادلة:</b> ${esc(suggestion.equation)}</p>
    ${suggestion.alreadyInSchedule ? '<p class="hint hint-warn">هذه الفترة محسوبة بالفعل داخل الجدول الآلي — لا تحتاج إضافتها يدويًا (إضافتها تُنشئ ازدواجًا).</p>'
      : '<p class="muted small">إن كانت خارج الجدول الآلي (مثلاً بعد تاريخ الاستحقاق حتى) أضفها كفترة يدوية بسبب واضح.</p>'}
    <div class="form-actions">
      ${suggestion.alreadyInSchedule ? '' : '<button type="button" class="primary" data-add-manual>إضافة كفترة يدوية</button>'}
      <button type="button" class="ghost" data-close>إغلاق</button>
    </div>`);
  card.querySelector('[data-add-manual]')?.addEventListener('click', () => {
    closeModal();
    manualPeriodDialog(app, executionId, {bundle: data}).catch(() => {});
  });
  return card;
}

/** قائمة الفترات اليدوية مع إلغاء بسبب (لا حذف صامت). */
export async function manualPeriodsDialog(app, executionId, {bundle = null} = {}) {
  const rows = await MP.listManualPeriods(app.office, executionId);
  const currency = bundle?.schedule?.currency || 'EGP';
  const card = modal(`<h2 class="modal-title">🗂 الفترات اليدوية</h2>
    ${rows.length ? `<ul class="plain-list">${rows.map(slice => `<li>
        <b>${esc(slice.entitlementType)}</b> — ${esc(amount(Math.round(Number(slice.amount || 0) * 100), currency))} ج.م
        · ${esc(display(slice.startDate))} ← ${esc(display(slice.endDate || slice.startDate))}
        <small class="muted">${esc(String(slice.sourceReference || '').split('|').slice(1).join(' · ') || slice.notes || '')}</small>
        ${['cancelled', 'superseded'].includes(String(slice.status || '')) ? '<span class="badge danger">ملغاة</span>'
          : `<button type="button" class="ghost small danger" data-cancel-slice="${esc(slice.id)}">إلغاء بسبب</button>`}
      </li>`).join('')}</ul>` : '<p class="muted">لا فترات يدوية مسجلة.</p>'}
    <div class="form-actions"><button type="button" class="ghost" data-close>إغلاق</button></div>`);
  card.querySelectorAll('[data-cancel-slice]').forEach(button => button.addEventListener('click', async () => {
    const answer = await confirmBox('إلغاء هذه الفترة اليدوية؟ تبقى في السجل التاريخي بحالة «ملغاة» ولا تُحذف.', {okText: 'إلغاء الفترة', input: true, label: 'سبب الإلغاء'});
    if (!answer?.ok) return;
    if (!String(answer.value || '').trim()) { toast('السبب مطلوب', 'error'); return; }
    try {
      await MP.cancelManualPeriod(app.office, button.dataset.cancelSlice, answer.value);
      toast('أُلغيت الفترة اليدوية', 'ok');
      await app.refresh();
    } catch (error) { toast(userError(error), 'error'); }
  }));
  return card;
}
