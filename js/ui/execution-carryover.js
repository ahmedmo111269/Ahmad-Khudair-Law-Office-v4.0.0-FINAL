// =====================================================================
// Carry-over ذكي — اقتراح الرصيد السابق عند فتح توكيل جديد
// ---------------------------------------------------------------------
// • يبحث عن آخر محضر تبديد/حجز وعن الفترات غير المسدَّدة قبل مدة التوكيل،
//   ثم **يقترح** ولا يُدرج: «رُصد رصيد سابق … — إدراجه؟»
// • الخيارات: [إدراج] [تعديل المبلغ] [تجاهل مع تسجيل السبب].
// • لا إدراج بلا موافقة صريحة، وكل قرار يُسجَّل في Activity Log.
// =====================================================================
import {esc} from './dom.js';
import {modal, closeModal} from './modal.js';
import {toast} from './toast.js';
import {userError} from '../core/errors.js';
import {fromMinorUnits, toMinorUnits} from '../domain/execution-money.js';
import {isCivilDate} from '../domain/execution-calendar.js';
import * as S from '../services/execution-simple.js';

const DISSIPATION_KINDS = Object.freeze(['dissipation', 'seizure', 'sale_notice', 'sale_session']);
const display = iso => (isCivilDate(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');
const amount = (minor, currency = 'EGP') => fromMinorUnits(Number(minor || 0), currency)
  .toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
/** «محضر تبديد» لا «محضر محضر تبديد»: التسمية المخزَّنة قد تحمل الكلمة أصلًا. */
const kindNoun = action => {
  const label = String(action?.kindLabel || action?.kind || 'تبديد').trim();
  return /^محضر/.test(label) ? label : `محضر ${label}`;
};

/**
 * يرشّح الرصيد السابق: آخر محضر تبديد/حجز + مجموع متبقٍ لفترات انتهت قبل بداية المدة.
 * قراءة فقط — لا يكتب ولا يعدّل أي رقم.
 */
export function carryOverCandidate(bundle, {fromDate = ''} = {}) {
  const schedule = bundle?.schedule;
  if (!schedule) return null;
  const currency = schedule.currency || 'EGP';
  const actions = (bundle?.actions || []).filter(action => !action.isDeleted && String(action.status || '') !== 'voided');
  const linked = actions
    .filter(action => DISSIPATION_KINDS.includes(String(action.kind || '')) || DISSIPATION_KINDS.some(key => String(action.kindLabel || '').includes(key)))
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))[0] || null;
  const before = (schedule.rows || []).filter(row => row.status !== 'RUNNING' && !row.needsDecision
    && Number(row.remainingMinor || 0) > 0 && (!fromDate || !isCivilDate(fromDate) || row.toDate < fromDate));
  const remainingMinor = before.reduce((sum, row) => sum + Number(row.remainingMinor || 0), 0);
  // لا رصيد سابق ⇒ لا اقتراح (معلومة المحضر وحدها لا تكفي لاقتراح إدراج مبلغ).
  if (!(remainingMinor > 0)) return null;
  return {
    currency, linkedAction: linked, remainingMinor,
    periodCount: before.length,
    firstPeriod: before[0]?.fromDate || '', lastPeriod: before.at(-1)?.toDate || '',
    sourceNote: linked
      ? `${kindNoun(linked)}${linked.referenceNumber ? ` رقم ${linked.referenceNumber}` : ''}${linked.date ? ` بتاريخ ${display(linked.date)}` : ''}${linked.authority ? ` — ${linked.authority}` : ''}`
      : 'لا يوجد محضر تبديد/حجز مرتبط — الرصيد من فترات غير مسددة فقط.',
    equation: `${before.length} فترة غير مسددة قبل ${fromDate ? display(fromDate) : 'مدة التوكيل'} = ${amount(remainingMinor, currency)} ج.م`
  };
}

/**
 * يسأل المستخدم صراحةً. يعيد `{include, amountMinor, reason, decided}`.
 * `decided=false` يعني أن المستخدم أغلق النافذة ⇒ لا إدراج (الافتراضي الآمن).
 */
export function askCarryOver(app, executionId, candidate) {
  return new Promise(resolve => {
    if (!candidate || !(Number(candidate.remainingMinor) > 0)) { resolve({include: false, amountMinor: 0, reason: '', decided: false, candidate}); return; }
    const currency = candidate.currency;
    const card = modal(`<h2 class="modal-title">💡 رُصد رصيد سابق</h2>
      <p class="hint hint-info"><b>رُصد رصيد سابق ${esc(amount(candidate.remainingMinor, currency))} ج.م</b>${candidate.linkedAction ? ` مرتبط بـ${esc(candidate.sourceNote)}` : ''} — إدراجه في التوكيل؟</p>
      <div class="exec-kv">
        <span>عدد الفترات</span><b>${candidate.periodCount}</b>
        <span>من</span><b>${esc(display(candidate.firstPeriod))}</b>
        <span>إلى</span><b>${esc(display(candidate.lastPeriod))}</b>
        <span>المعادلة</span><b>${esc(candidate.equation)}</b>
        <span>المصدر</span><b>${esc(candidate.sourceNote)}</b>
      </div>
      <p class="muted small">قاعدة منع الازدواج: الرصيد السابق جزء من المتبقي ولا يُضاف عليه مرة ثانية — إدراجه لا يغيّر المتبقي.</p>
      <form class="simple-form" data-form="carryover">
        <label class="field" data-override hidden>المبلغ المُدرج (ج.م)<input name="overrideAmount" inputmode="decimal" value="${esc(amount(candidate.remainingMinor, currency))}">
          <small class="hint">عدّل المبلغ إن كان جزء منه سُدد خارج النظام — يُسجَّل سبب التعديل.</small></label>
        <label class="field span2">سبب القرار (يُحفظ في سجل النشاط)<input name="reason" placeholder="مثال: إدراج متبقٍ مرتبط بمحضر التبديد"></label>
        <div class="form-actions">
          <button type="button" class="primary" data-include>إدراج</button>
          <button type="button" class="ghost" data-override-toggle>تعديل المبلغ</button>
          <button type="button" class="ghost danger" data-ignore>تجاهل مع تسجيل السبب</button>
          <button type="button" class="ghost" data-close>إغلاق</button>
        </div>
      </form>`);
    const form = card.querySelector('[data-form="carryover"]');
    const overrideField = form.querySelector('[data-override]');
    const log = async (action, summary, metadata) => {
      try { await S.logExecutionDecision(app.office, {executionId, action, summary, metadata}); } catch (error) { console.info('carry-over log failed', error); }
    };
    const finish = async result => {
      closeModal();
      await log(result.include ? 'carry-over-included' : 'carry-over-ignored',
        result.include
          ? `إدراج رصيد سابق ${amount(result.amountMinor, currency)} ج.م في التوكيل${result.reason ? ` — ${result.reason}` : ''}`
          : `تجاهل رصيد سابق ${amount(candidate.remainingMinor, currency)} ج.م${result.reason ? ` — السبب: ${result.reason}` : ''}`,
        {amountMinor: result.amountMinor, detectedMinor: candidate.remainingMinor, reason: result.reason || '',
          linkedActionId: candidate.linkedAction?.id || '', linkedActionReference: candidate.linkedAction?.referenceNumber || '',
          periodCount: candidate.periodCount});
      resolve({...result, decided: true, candidate});
    };
    card.querySelector('[data-override-toggle]')?.addEventListener('click', () => {
      overrideField.hidden = !overrideField.hidden;
      if (!overrideField.hidden) overrideField.querySelector('input')?.focus();
    });
    card.querySelector('[data-include]')?.addEventListener('click', async () => {
      const reason = String(form.querySelector('[name="reason"]').value || '').trim();
      let minor = candidate.remainingMinor;
      if (!overrideField.hidden) {
        try { minor = toMinorUnits(form.querySelector('[name="overrideAmount"]').value, currency); } catch (error) { toast(userError(error), 'error'); return; }
      }
      if (!(minor >= 0)) { toast('المبلغ غير صحيح', 'error'); return; }
      await finish({include: true, amountMinor: minor, reason, overridden: minor !== candidate.remainingMinor});
    });
    card.querySelector('[data-ignore]')?.addEventListener('click', async () => {
      const reason = String(form.querySelector('[name="reason"]').value || '').trim();
      if (!reason) { toast('اكتب سبب التجاهل — يُحفظ في سجل النشاط', 'error'); form.querySelector('[name="reason"]').focus(); return; }
      await finish({include: false, amountMinor: 0, reason});
    });
    card.querySelectorAll('[data-close],[data-modal-back]').forEach(button => button.addEventListener('click', () => {
      resolve({include: false, amountMinor: 0, reason: '', decided: false, candidate});
    }));
  });
}

/** تدفق كامل: يرشّح ثم يسأل ثم يسجّل — يُستدعى قبل فتح معالج التوكيل. */
export async function carryOverFlow(app, executionId, {bundle, fromDate = ''} = {}) {
  const candidate = carryOverCandidate(bundle, {fromDate});
  if (!candidate || !(Number(candidate.remainingMinor) > 0)) return {include: false, amountMinor: 0, reason: '', decided: false, candidate: null};
  return askCarryOver(app, executionId, candidate);
}
