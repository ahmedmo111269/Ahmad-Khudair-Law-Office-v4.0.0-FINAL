// =====================================================================
// واجهة متعدد المستحقين — شاشة توزيع (بند + المستحق له + النسبة + المبلغ)
// ---------------------------------------------------------------------
// • خطوة توزيع المحضر بشرط: مجموع النسب = 100% ومجموع المبالغ = مبلغ المحضر.
// • لا تغيير صامت في السكيمة: الحقول إضافية على الصف القائم، والسجل القديم
//   يُقرأ كمستحق واحد 100% (التفاصيل في services/execution-beneficiaries.js).
// =====================================================================
import {esc} from './dom.js';
import {modal, closeModal, confirmBox} from './modal.js';
import {toast} from './toast.js';
import {userError} from '../core/errors.js';
import {fromMinorUnits, toMinorUnits} from '../domain/execution-money.js';
import * as B from '../services/execution-beneficiaries.js';

const amount = (minor, currency = 'EGP') => fromMinorUnits(Number(minor || 0), currency)
  .toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});

function rowMarkup(index, {beneficiaryName = '', beneficiaryShare = '', amountMinor = null, partyId = '', options = []} = {}, currency) {
  return `<tr data-ben-row="${index}">
    <td>
      <input list="ben-names" name="beneficiaryName" value="${esc(beneficiaryName)}" placeholder="اسم المستحق" aria-label="اسم المستحق">
      ${partyId ? `<input type="hidden" name="partyId" value="${esc(partyId)}">` : ''}
    </td>
    <td><input name="beneficiaryShare" inputmode="decimal" value="${esc(String(beneficiaryShare))}" placeholder="%" aria-label="النسبة"></td>
    <td style="text-align:left" data-ben-amount>${amountMinor === null ? '—' : `${amount(amountMinor, currency)} ج.م`}</td>
    <td><button type="button" class="ghost small danger" data-ben-remove aria-label="حذف السطر">✕</button></td>
  </tr>`;
}

/**
 * شاشة توزيع عامة. `totalMinor` ثابت ومعروض، والحقول تُحسب حيًّا.
 * `onSave(entries, reason)` ينفّذ الكتابة عبر الخدمة المناسبة.
 */
export function beneficiarySplitDialog(app, {title = 'توزيع على المستحقين', totalMinor = 0, currency = 'EGP', entries = [], options = [], onSave = null, note = ''} = {}) {
  let rows = (entries && entries.length ? entries : [{beneficiaryName: options[0]?.name || '', beneficiaryShare: '100', partyId: options[0]?.partyId || '', amountMinor: totalMinor}])
    .map(row => ({...row}));
  const card = modal(`<h2 class="modal-title">👥 ${esc(title)}</h2>
    <p class="muted small">المبلغ الكلي <b>${amount(totalMinor, currency)} ج.م</b> — مجموع النسب يجب أن يكون 100% ومجموع المبالغ = المبلغ الكلي بالضبط.</p>
    ${note ? `<p class="hint hint-info small">${esc(note)}</p>` : ''}
    <datalist id="ben-names">${options.map(option => `<option value="${esc(option.name)}"></option>`).join('')}</datalist>
    <form class="simple-form" data-form="beneficiaries">
      <div class="exec-table-wrap"><table class="exec-table mini-table">
        <thead><tr><th>المستحق له</th><th>النسبة %</th><th>المبلغ</th><th></th></tr></thead>
        <tbody data-ben-body>${rows.map((row, index) => rowMarkup(index, row, currency)).join('')}</tbody>
        <tfoot><tr><th>المجموع</th><th data-ben-share-total>0%</th><th style="text-align:left" data-ben-amount-total>0.00 ج.م</th><th></th></tr></tfoot>
      </table></div>
      <div class="form-actions">
        <button type="button" class="ghost" data-ben-add>+ مستحق</button>
        <button type="button" class="ghost" data-ben-even>توزيع بالتساوي</button>
        <button type="button" class="ghost" data-ben-from-amount>احسب النسب من المبالغ</button>
      </div>
      <label class="field span2">سبب التوزيع (يُحفظ في سجل النشاط) <b class="req">*</b><input name="reason" placeholder="مثال: توزيع محضر التحصيل على الأبناء الثلاثة بحسب الحكم"></label>
      <div class="alloc-preview" data-ben-preview aria-live="polite"></div>
      <div class="form-actions">
        <button type="submit" class="primary" data-save>حفظ التوزيع</button>
        <button type="button" class="ghost" data-close>إلغاء</button>
      </div>
    </form>`);
  const form = card.querySelector('[data-form="beneficiaries"]');
  const bodyEl = form.querySelector('[data-ben-body]');
  const preview = form.querySelector('[data-ben-preview]');

  const read = () => [...bodyEl.querySelectorAll('[data-ben-row]')].map(tr => ({
    beneficiaryName: tr.querySelector('[name="beneficiaryName"]').value.trim(),
    partyId: tr.querySelector('[name="partyId"]')?.value || '',
    beneficiaryShare: tr.querySelector('[name="beneficiaryShare"]').value.trim(),
    amountMinor: null
  })).filter(row => row.beneficiaryName);

  const refresh = () => {
    rows = read();
    let shareTotal = 0, amountTotal = 0, error = '';
    for (const row of rows) {
      const share = Number(String(row.beneficiaryShare).replace(',', '.'));
      if (!Number.isFinite(share) || share < 0) { error = 'نسبة غير صحيحة في أحد الأسطر.'; continue; }
      shareTotal += share;
      const minor = Math.floor((totalMinor * share) / 100);
      amountTotal += minor;
      row.amountMinor = minor;
    }
    // الباقي من التقريب على آخر سطر (قاعدة صريحة، لا تقريب صامت)
    if (rows.length && !error) {
      const last = rows[rows.length - 1];
      const others = rows.slice(0, -1).reduce((sum, row) => sum + Number(row.amountMinor || 0), 0);
      last.amountMinor = Math.max(0, totalMinor - others);
      amountTotal = rows.reduce((sum, row) => sum + Number(row.amountMinor || 0), 0);
    }
    [...bodyEl.querySelectorAll('[data-ben-row]')].forEach(tr => {
      const index = Number(tr.dataset.benRow);
      const row = rows[index];
      const cell = tr.querySelector('[data-ben-amount]');
      if (cell) cell.textContent = row?.amountMinor == null ? '—' : `${amount(row.amountMinor, currency)} ج.م`;
    });
    form.querySelector('[data-ben-share-total]').textContent = `${shareTotal.toFixed(2)}%`;
    form.querySelector('[data-ben-amount-total]').textContent = `${amount(amountTotal, currency)} ج.م`;
    const okShares = Math.abs(shareTotal - 100) <= 0.001;
    const okAmounts = amountTotal === totalMinor;
    preview.innerHTML = error ? `<span class="hint hint-warn">${esc(error)}</span>`
      : `<span class="hint ${okShares && okAmounts ? 'hint-ok' : 'hint-warn'}">
          النسب: ${shareTotal.toFixed(2)}% ${okShares ? '✔' : '(مطلوب 100%)'} · المبالغ: ${amount(amountTotal, currency)} ${okAmounts ? '✔' : `(مطلوب ${amount(totalMinor, currency)})`}</span>`;
    return {rows, shareTotal, amountTotal, valid: !error && okShares && okAmounts};
  };

  const redraw = () => {
    bodyEl.innerHTML = rows.map((row, index) => rowMarkup(index, row, currency)).join('');
    bindRows();
    refresh();
  };
  const bindRows = () => {
    bodyEl.querySelectorAll('[name="beneficiaryName"],[name="beneficiaryShare"]').forEach(input => {
      input.addEventListener('input', refresh);
      input.addEventListener('change', refresh);
    });
    bodyEl.querySelectorAll('[data-ben-remove]').forEach(button => button.addEventListener('click', () => {
      const index = Number(button.closest('[data-ben-row]').dataset.benRow);
      rows = read().filter((_, position) => position !== index);
      if (!rows.length) rows = [{beneficiaryName: '', beneficiaryShare: '100'}];
      redraw();
    }));
  };
  bindRows();
  refresh();

  form.querySelector('[data-ben-add]')?.addEventListener('click', () => {
    rows = read();
    rows.push({beneficiaryName: '', beneficiaryShare: '0'});
    redraw();
  });
  form.querySelector('[data-ben-even]')?.addEventListener('click', () => {
    rows = read();
    if (!rows.length) return;
    const each = Math.floor(10000 / rows.length) / 100;
    rows.forEach((row, index) => { row.beneficiaryShare = index === rows.length - 1 ? String(Number((100 - each * (rows.length - 1)).toFixed(2))) : String(each); });
    redraw();
  });
  form.querySelector('[data-ben-from-amount]')?.addEventListener('click', async () => {
    rows = read();
    if (!rows.length) return;
    for (const row of rows) {
      const raw = String(row.beneficiaryShare).trim();
      // إن كُتب مبلغ بدل نسبة (أكبر من 100) نحسب النسبة من المبلغ الكلي.
      const value = Number(raw.replace(',', '.'));
      if (Number.isFinite(value) && value > 100 && totalMinor > 0) {
        let minor = 0;
        try { minor = toMinorUnits(raw, currency); } catch { minor = 0; }
        row.beneficiaryShare = ((minor / totalMinor) * 100).toFixed(2);
      }
    }
    redraw();
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const state = refresh();
    if (!state.valid) { toast('صحّح النسب: المجموع يجب أن يكون 100% والمبالغ = مبلغ المحضر.', 'error'); return; }
    const reason = String(form.querySelector('[name="reason"]').value || '').trim();
    if (!reason) { toast('سبب التوزيع مطلوب', 'error'); form.querySelector('[name="reason"]').focus(); return; }
    const button = form.querySelector('[data-save]');
    button.disabled = true;
    try {
      if (typeof onSave === 'function') await onSave(state.rows, reason);
      closeModal();
      toast('حُفظ توزيع المستحقين', 'ok');
      document.dispatchEvent(new CustomEvent('exec:record-saved', {detail: {}}));
      await app.refresh();
    } catch (error) {
      toast(userError(error), 'error');
      button.disabled = false;
    }
  });
  return card;
}

/** توزيع محضر تحصيل قائم. */
export async function receiptBeneficiaryDialog(app, receipt, {fallbackName = ''} = {}) {
  const currency = receipt.currency || 'EGP';
  const totalMinor = Number.isSafeInteger(receipt.amountMinor) ? receipt.amountMinor : Math.round(Number(receipt.amount || 0) * 100);
  const options = await B.beneficiaryOptions(app.office, receipt.executionId).catch(() => []);
  const entries = B.receiptBeneficiaries(receipt, {fallbackName, currency});
  return beneficiarySplitDialog(app, {
    title: `توزيع المحضر ${receipt.receiptNumber || ''}`,
    totalMinor, currency, entries, options,
    note: 'شرط الحفظ: مجموع النسب = 100% ومجموع المبالغ = مبلغ المحضر بالضبط.',
    onSave: async (rows, reason) => B.saveReceiptBeneficiaries(app.office, {receiptId: receipt.id, entries: rows, reason})
  });
}

/** توزيع بند قيمة. */
export async function sliceBeneficiaryDialog(app, slice) {
  const currency = slice.currency || 'EGP';
  const totalMinor = Number.isSafeInteger(slice.amountMinor) ? slice.amountMinor : Math.round(Number(slice.amount || 0) * 100);
  const options = await B.beneficiaryOptions(app.office, slice.executionId).catch(() => []);
  const entries = Array.isArray(slice.beneficiaries) ? slice.beneficiaries : [];
  return beneficiarySplitDialog(app, {
    title: `توزيع بند ${slice.entitlementType || ''}`,
    totalMinor, currency, entries, options,
    note: 'التوزيع وصفي للحصص بين المستحقين — لا يغيّر قيمة البند ولا الفترات الآلية.',
    onSave: async (rows, reason) => B.saveSliceBeneficiaries(app.office, {sliceId: slice.id, entries: rows, reason})
  });
}

/** نافذة ترحيل توزيع المستحقين (اختياري وصريح، بلا تغيير صامت). */
export async function beneficiaryMigrationDialog(app) {
  const note = B.BENEFICIARY_SCHEMA_NOTE;
  const card = modal(`<h2 class="modal-title">🧭 ترحيل توزيع المستحقين</h2>
    <p class="muted small">لا مخزن جديد ولا فهرس جديد — SCHEMA_VERSION يبقى ${note.schemaVersionUnchanged}. الإضافة حقول على الصف القائم:</p>
    <ul class="plain-list">${note.additiveFields.map(field => `<li><code>${esc(field)}</code></li>`).join('')}</ul>
    <p class="hint hint-info small">قراءة السجلات القديمة: ${esc(note.legacyRead)}.</p>
    <p class="muted small">${esc(note.migration)}</p>
    <div class="form-actions">
      <button type="button" class="ghost" data-ben-dry>فحص بلا كتابة (تقرير)</button>
      <button type="button" class="primary" data-ben-run>نفّذ الترحيل</button>
      <button type="button" class="ghost" data-close>إغلاق</button>
    </div>
    <div data-ben-report class="alloc-preview"></div>`);
  const report = card.querySelector('[data-ben-report]');
  const show = out => { report.innerHTML = `<b>التقرير:</b> فُحص ${out.scanned} محضر · مرشّح للإضافة ${out.candidates} · أُضيف الحقل لـ${out.updated}${out.scannedAll ? '' : ' · (الفحص على أول 500 محضر فقط)'}${out.dryRun ? ' — <b>فحص بلا كتابة</b>' : ''}`; };
  card.querySelector('[data-ben-dry]')?.addEventListener('click', async () => {
    try { show(await B.backfillReceiptBeneficiaries(app.office, {dryRun: true})); } catch (error) { toast(userError(error), 'error'); }
  });
  card.querySelector('[data-ben-run]')?.addEventListener('click', async () => {
    const ok = await confirmBox('إضافة حقل توزيع المستحقين للمحاضر التي لا تحمله (100% للمستحق الرئيسي)؟ لا يُغيَّر أي مبلغ ولا أي تخصيص.', {okText: 'نفّذ الترحيل'});
    if (!ok) return;
    try { show(await B.backfillReceiptBeneficiaries(app.office, {dryRun: false})); toast('تم الترحيل', 'ok'); } catch (error) { toast(userError(error), 'error'); }
  });
  return card;
}
