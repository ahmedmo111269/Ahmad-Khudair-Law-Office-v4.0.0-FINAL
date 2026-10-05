// =====================================================================
// نوافذ قسم التنفيذ المبسّطة — نموذج واحد للتسجيل وست أيقونات كبيرة.
// ---------------------------------------------------------------------
// • الحقول الإلزامية قليلة ومعلَّمة، والتحقق «ناعم» إلا خطأ جسيم (مبلغ ≤ 0، تاريخ غير صالح).
// • كل نافذة تعرض معاينة حية (تخصيص/فرق) قبل الحفظ.
// • لا شاشة تسجيل موازية: كل كتابة تمر عبر services/execution-simple.js.
// =====================================================================
import {esc} from './dom.js';
import {modal, modalOpensOnTop, closeModal, confirmBox} from './modal.js';
import {toast} from './toast.js';
import {formatFileNumber} from '../core/file-number.js';
import {localDate} from '../core/clock.js';
import {userError} from '../core/errors.js';
import {fromMinorUnits, toMinorUnits} from '../domain/execution-money.js';
import {addCivilDays, isCivilDate, enumerateExecutionUnits} from '../domain/execution-calendar.js';
import {PERIOD_STATUS} from '../domain/execution-schedule.js';
import * as S from '../services/execution-simple.js';
import {executionSettings, saveExecutionSettings, resetExecutionSettings, actionKindOptions, expenseTypeOptions, entitlementOptions, collectionMethodOptions, executionMethodOptions, borneByLabelOf} from '../services/execution-settings.js';
import {EXECUTION_TYPE_LABELS, executionTypeLabel} from '../domain/execution.js';
import {prefs} from '../core/preferences.js';
import {ASOF_SCOPE_KEY, asOfKeyFor} from './execution-horizon-picker.js';


/**
 * مفتاح اختيار (مربع/زر راديو): قيمته في المتصفح «on» عند غياب value، لكن
 * الاعتماد على النص هشّ (قيمة مخصّصة، بيئات اختبار، تعريب…) — أي قيمة غير
 * فارغة تفعيل صريح، والغياب تعطيل.
 */
const flag = value => value !== undefined && value !== null && value !== '' && value !== 'off' && value !== 'false';

/** المفتاح الموحّد لتاريخ الحساب — مطابق لما تستخدمه بطاقة التنفيذ في مركز التنفيذ. */
const ASOF_KEY = 'ui:exec:asof:v1';

const money = minor => `${fromMinorUnits(minor, 'EGP').toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
const displayDate = iso => (isCivilDate(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');
const statusLabel = status => ({paid: '✔ مسدد', partial: '◐ جزئي', unpaid: '✗ لم يُدفع', nothing_due: '—'})[status] || '';

/** حفظ عام مختصر: يعرض الخطأ بلغة بسيطة ويغلق النافذة عند النجاح. */
async function runSave(app, action, successMessage, {keepOpen = false} = {}) {
  try {
    const out = await action();
    if (!keepOpen) closeModal();
    toast(successMessage, 'ok', {actionLabel: 'تراجع', action: async () => { await app.refresh(); }});
    // إشعار ورقة التسجيل (إن كانت مفتوحة) لتحديث أرقامها بلا إغلاق.
    document.dispatchEvent(new CustomEvent('exec:record-saved', {detail: {}}));
    await app.refresh();
    return out;
  } catch (error) {
    toast(userError(error), 'error');
    return null;
  }
}

function clientPickerOptions(clients, selected = '') {
  return `<option value="">— اختر الموكل —</option>${clients.map(client => `<option value="${esc(client.id)}"${client.id === selected ? ' selected' : ''}>${esc(client.fullName)}</option>`).join('')}`;
}

/* =========================== تنفيذ جديد (S1) =========================== */
/**
 * شاشة واحدة: لصالح من؟ / الحكم والمطلوب / طريقة التنفيذ.
 * الإلزامي: الموكل، المبلغ، النوع، تاريخ السريان للدوري — والباقي اختياري.
 */
export async function newExecutionDialog(app, {preset = {}} = {}) {
  const settings = executionSettings(app.office);
  const clientsPage = await app.office.r.clients.page({index: 'createdAt', direction: 'prev', limit: 100}).catch(() => ({items: []}));
  const clients = clientsPage.items || [];
  // عند التوجيه من مدخل عام (ملف/موكل محدد): نضمن ظهور الموكل المقصود في القائمة
  // حتى لو لم يكن ضمن أحدث 100 موكل.
  const presetClientId = String(preset?.clientId || '').trim();
  if (presetClientId && !clients.some(client => client.id === presetClientId)) {
    const presetClient = await app.office.r.clients.get(presetClientId).catch(() => null);
    if (presetClient && !presetClient.isDeleted) clients.unshift(presetClient);
  }
  const card = modal(`<h2 class="modal-title">تنفيذ جديد</h2>
    <p class="muted small">الأسفار المعلَّمة بـ<span class="req">*</span> فقط. بعد الحفظ تُفتح البطاقة والجدول الشهري جاهزًا.</p>
    <form class="simple-form" data-form="new-execution">
      <fieldset><legend>1) لصالح من؟</legend>
        <div class="form-grid">
          <label class="field">الموكل <b class="req">*</b>
            <select name="clientId">${clientPickerOptions(clients, presetClientId)}</select>
          </label>
          <label class="field">أو اسم موكل جديد
            <input name="newClientName" placeholder="اكتب الاسم ليُضاف فورًا">
          </label>
          <label class="field">المنفذ ضده (اختياري)
            <input name="opponentName" placeholder="اسم الخصم">
          </label>
        </div>
      </fieldset>
      <fieldset><legend>2) الحكم والمطلوب</legend>
        <div class="form-grid">
          <label class="field">البند
            <input name="entitlementType" list="ent-types" value="${esc(preset.entitlementType || 'نفقة صغار')}">
            <datalist id="ent-types">${entitlementOptions(settings).map(item => `<option value="${esc(item)}"></option>`).join('')}</datalist>
          </label>
          <label class="field">النوع <b class="req">*</b>
            <select name="valueType">
              <option value="periodic" selected>دوري (يتكرر)</option>
              <option value="fixed">مبلغ مقطوع (مرة واحدة)</option>
            </select>
          </label>
          <label class="field">المبلغ (ج.م) <b class="req">*</b>
            <input name="amount" inputmode="decimal" placeholder="مثال: 3000">
          </label>
          <label class="field" data-periodicity-field>الدورية
            <select name="periodicity">
              <option value="monthly" selected>شهري</option>
              <option value="weekly">أسبوعي</option>
              <option value="semiMonthly">نصف شهري</option>
              <option value="yearly">سنوي</option>
            </select>
          </label>
          <label class="field" data-effective-field>يسري من <b class="req">*</b>
            <input name="effectiveFrom" type="date" value="${esc(preset.effectiveFrom || localDate())}">
          </label>
          <label class="field">ينتهي في (اختياري)
            <input name="effectiveTo" type="date">
          </label>
          <label class="field">رقم الحكم
            <input name="judgmentNumber" placeholder="مثال: 101/2025">
          </label>
          <label class="field">المحكمة
            <input name="court" placeholder="مثال: محكمة الأسرة بالمنصورة">
          </label>
          <label class="field">تاريخ الحكم (اختياري)
            <input name="judgmentDate" type="date">
          </label>
        </div>
      </fieldset>
      <details class="advanced-options">
        <summary>خيارات متقدمة (اختياري)</summary>
        <div class="form-grid">
          <label class="field">نموذج الحساب
            <select name="accountingModel">
              <option value="legacy-v1" selected>المسار المبسط (موصى به)</option>
              <option value="feas-v1">FEAS — اعتراف صريح بفترات ولقطات</option>
            </select>
            <small class="hint">المسار المبسط: تسجّل الحكم والمبلغ فيُبنى الجدول فورًا. FEAS للمتمرسين: لا يُحتسب أي مبلغ إلا باعتراف صريح بكل فترة. يُختار هنا فقط ولا يتغيّر بعد الحفظ على سجل فيه أرقام.</small>
          </label>
          <label class="field">رقم التنفيذ الرسمي
            <input name="officialNumber" placeholder="اختياري">
          </label>
          <label class="field">تاريخ الفتح
            <input name="openedDate" type="date" value="${esc(localDate())}">
          </label>
        </div>
      </details>
      <fieldset><legend>3) طريقة التنفيذ</legend>
        <div class="form-grid">
          <label class="field">نوع التنفيذ
            <select name="executionType">
              <option value="family" selected>تنفيذ أحكام الأسرة</option>
              <option value="civil">التنفيذ المدني</option>
              <option value="criminal">التنفيذ الجنائي</option>
            </select>
          </label>
          <label class="field">طريقة التنفيذ
            <input name="executionMethod" list="exec-methods" placeholder="اختياري">
            <datalist id="exec-methods">${executionMethodOptions(settings).map(item => `<option value="${esc(item)}"></option>`).join('')}</datalist>
          </label>
          <label class="field">جهة التنفيذ
            <input name="authority" placeholder="قلم التنفيذ / إدارة التنفيذ">
          </label>
          <label class="field">ملاحظات
            <input name="notes">
          </label>
        </div>
      </fieldset>
      <div class="form-actions">
        <button type="submit" class="primary" data-save>حفظ وفتح البطاقة</button>
        <button type="button" class="ghost" data-close>إلغاء</button>
      </div>
    </form>`);
  const form = card.querySelector('[data-form="new-execution"]');
  const syncValueType = () => {
    const fixed = form.querySelector('[name="valueType"]').value === 'fixed';
    form.querySelector('[data-periodicity-field]').style.display = fixed ? 'none' : '';
    form.querySelector('[data-effective-field]').querySelector('b').style.display = fixed ? 'none' : '';
    form.querySelector('[data-effective-field]').querySelector('b').textContent = fixed ? '' : '*';
  };
  form.querySelector('[name="valueType"]').addEventListener('change', syncValueType);
  syncValueType();
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    const saveButton = form.querySelector('[data-save]');
    saveButton.disabled = true;
    try {
      const created = await S.createSimpleExecution(app.office, data);
      closeModal();
      toast('تم إنشاء التنفيذ وبنى النظام الجدول الشهري تلقائيًا', 'ok');
      await app.go(`exc:${created.execution.id}`);
    } catch (error) {
      toast(userError(error), 'error');
      saveButton.disabled = false;
    }
  });
  return card;
}

/* ===================== ورقة التسجيل: ست أيقونات (S2/S3) ===================== */
/**
 * ورقة التسجيل: 6 أيقونات كبيرة. اختيار أيٍّ منها يفتح نموذجه **فوق الورقة**
 * لا بدلًا منها، فبعد الحفظ ترجع إلى الورقة وتُحدَّث أرقامها فورًا لتسجيل شيء
 * آخر — أو تُغلق بضغطة واحدة. التسجيل لا يتوقف على أي شرط مسبق.
 */
export function recordSheet(app, executionId, {bundle = null} = {}) {
  let data = bundle;
  const card = modal(`<h2 class="modal-title">تسجيل على التنفيذ</h2>
    <div data-sheet-body>${sheetBody(data)}</div>`);
  const open = {
    collection: () => simpleCollectionDialog(app, executionId, {bundle: data}),
    action: () => simpleActionDialog(app, executionId),
    expense: () => simpleExpenseDialog(app, executionId),
    judgment: () => subsequentJudgmentDialog(app, executionId, {bundle: data}),
    poa: () => simplePoaDialog(app, executionId, {bundle: data}),
    note: () => simpleNoteDialog(app, executionId)
  };
  const bindTiles = host => {
    host.querySelectorAll('[data-record]').forEach(button => button.addEventListener('click', async () => {
      modalOpensOnTop(); // النموذج يُفتح فوق الورقة، و«رجوع/إغلاق» يعيد إليها
      await open[button.dataset.record]?.().catch(error => toast(userError(error), 'error'));
    }));
  };
  bindTiles(card);
  // بعد أي حفظ: أعِد قراءة الأرقام الحقيقية وحدّث الورقة في مكانها (بلا إغلاق ولا فقدان خطوة).
  const onSaved = async () => {
    if (!card.isConnected) { document.removeEventListener('exec:record-saved', onSaved); return; }
    try { data = await S.simpleCardBundle(app.office, executionId); } catch { /* تبقى الأرقام السابقة */ }
    const host = card.querySelector('[data-sheet-body]');
    if (!host) return;
    host.innerHTML = sheetBody(data);
    bindTiles(host);
  };
  document.addEventListener('exec:record-saved', onSaved);
  return card;
}

function sheetBody(data) {
  const totals = data?.schedule?.totals || null;
  const currency = data?.schedule?.currency || 'EGP';
  const line = totals
    ? `<p class="muted small" data-sheet-numbers>المطلوب <b>${fromMinorUnits(totals.dueMinor, currency).toLocaleString('en-US', {maximumFractionDigits: 2})}</b> · المدفوع <b>${fromMinorUnits(totals.paidMinor, currency).toLocaleString('en-US', {maximumFractionDigits: 2})}</b> · المتبقي <b>${fromMinorUnits(totals.remainingMinor, currency).toLocaleString('en-US', {maximumFractionDigits: 2})}</b> ج.م</p>`
    : '';
  return `<p class="muted small">اختر نوع ما تريد تسجيله — كل نموذج قصير، والإزامي فيه حقول قليلة.</p>
    ${line}
    <div class="record-picker" role="group" aria-label="أنواع التسجيل">
      <button type="button" class="record-tile" data-record="collection"><span aria-hidden="true">💰</span><b>تحصيل</b><small>مبلغ قُبض فعلًا</small></button>
      <button type="button" class="record-tile" data-record="action"><span aria-hidden="true">📄</span><b>إجراء</b><small>إعلان · حجز · عريضة</small></button>
      <button type="button" class="record-tile" data-record="expense"><span aria-hidden="true">🧾</span><b>مصروف / رسم</b><small>منفصل عن أصل الدين</small></button>
      <button type="button" class="record-tile" data-record="judgment"><span aria-hidden="true">⚖️</span><b>حكم لاحق</b><small>زيادة أو تخفيض</small></button>
      <button type="button" class="record-tile" data-record="poa"><span aria-hidden="true">🖨</span><b>توكيل</b><small>مدة ورصيد سابق</small></button>
      <button type="button" class="record-tile" data-record="note"><span aria-hidden="true">📝</span><b>ملاحظة</b><small>متابعة سريعة</small></button>
    </div>
    <div class="form-actions"><button type="button" class="ghost" data-close>إغلاق</button></div>`;
}

/* ============================ نموذج التحصيل (S2) ============================ */
export async function simpleCollectionDialog(app, executionId, {bundle = null, receipt = null, periodKey = ''} = {}) {
  const data = bundle || await S.simpleCardBundle(app.office, executionId);
  const settings = data.settings || executionSettings(app.office);
  const currency = data.schedule.currency;
  const openPeriods = data.schedule.rows.filter(row => row.remainingMinor > 0);
  const presetKey = String(periodKey || '').includes('::') ? String(periodKey) : (periodKey ? openPeriods.map(row => `${row.units[0].entitlementType}::${row.fromDate}`).find(key => key.endsWith(`::${periodKey}`)) || '' : '');
  const card = modal(`<h2 class="modal-title">${receipt ? 'تعديل تحصيل' : 'تسجيل تحصيل'}</h2>
    <form class="simple-form" data-form="collection">
      <div class="form-grid">
        <label class="field">المبلغ (ج.م) <b class="req">*</b>
          <input name="amount" inputmode="decimal" value="${receipt ? esc(receipt.amount) : ''}" autofocus>
        </label>
        <label class="field">التاريخ
          <input name="date" type="date" value="${esc(receipt?.date || data.today)}">
        </label>
        <label class="field">يخصّ
          <select name="target">
            <option value="auto"${presetKey ? '' : ' selected'}>تلقائي — الأقدم أولًا</option>
            ${openPeriods.map(row => { const key = `${row.units[0].entitlementType}::${row.fromDate}`; return `<option value="${esc(key)}"${key === presetKey ? ' selected' : ''}>${esc(row.label)} — متبقٍ ${money(row.remainingMinor)}</option>`; }).join('')}
            <option value="advance">دفعة مقدّمة (رصيد دائن)</option>
          </select>
        </label>
        <label class="field">طريقة التحصيل
          <input name="paymentMethod" list="collect-methods" value="${esc(receipt?.paymentMethod || '')}">
          <datalist id="collect-methods">${collectionMethodOptions(settings).map(item => `<option value="${esc(item)}"></option>`).join('')}</datalist>
        </label>
        <label class="field">رقم المحضر / المستند
          <input name="reference" value="${esc(receipt?.reference || '')}">
        </label>
        <label class="field">الدافع
          <input name="payerName" value="${esc(receipt?.payerName || '')}">
        </label>
        <label class="field">المحصّل / الجهة
          <input name="collectorName" value="${esc(receipt?.collectorName || '')}">
        </label>
        <label class="field span2">ملاحظات
          <input name="notes" value="${esc(receipt?.notes || '')}">
        </label>
        ${receipt ? '<label class="field span2">سبب التعديل (يبقى في السجل)<input name="reason" placeholder="مثال: تصحيح رقم المحضر"></label>' : ''}
      </div>
      <div class="alloc-preview" data-preview aria-live="polite"><span class="muted small">اكتب المبلغ لتظهر معاينة التخصيص…</span></div>
      <div class="form-actions">
        <button type="submit" class="primary" data-save>${receipt ? 'حفظ التعديل' : 'حفظ التحصيل'}</button>
        <button type="button" class="ghost" data-close>إلغاء</button>
      </div>
    </form>`);
  const form = card.querySelector('[data-form="collection"]');
  const previewHost = form.querySelector('[data-preview]');
  let previewTimer = 0;
  const renderPreview = async () => {
    const amount = form.querySelector('[name="amount"]').value.trim();
    const date = form.querySelector('[name="date"]').value;
    const targetValue = form.querySelector('[name="target"]').value;
    if (!amount || !(toMinorUnitsSafe(amount, currency) > 0)) { previewHost.innerHTML = '<span class="muted small">اكتب المبلغ لتظهر معاينة التخصيص…</span>'; return; }
    if (targetValue === 'advance') { previewHost.innerHTML = '<span class="muted small">دفعة مقدّمة: تُحفظ كرصيد دائن وتُطبَّق تلقائيًا على الاستحقاقات القادمة.</span>'; return; }
    try {
      const preview = await S.previewSimpleCollection(app.office, {
        executionId, amount, date, asOf: data.schedule.asOf,
        target: targetValue === 'auto' ? 'auto' : 'period', periodKey: targetValue === 'auto' ? '' : targetValue
      });
      previewHost.innerHTML = `<b>سيُخصَّص:</b> ${preview.lines.length ? preview.lines.map(line => `${esc(line.label)} ${money(line.amountMinor)}`).join(' · ') : '<span class="muted">لا يوجد استحقاق بعد — يُحفظ غير مخصص</span>'}
        <span class="preview-result">المتبقي بعد التحصيل: <b>${money(preview.remainingAfterMinor)}</b></span>
        ${preview.creditMinor > 0 ? `<span class="badge ok">رصيد دائن: ${money(preview.creditMinor)}</span>` : ''}`;
    } catch (error) { previewHost.innerHTML = `<span class="muted small">${esc(userError(error))}</span>`; }
  };
  form.addEventListener('input', () => { clearTimeout(previewTimer); previewTimer = setTimeout(() => renderPreview().catch(() => {}), 200); });
  form.addEventListener('change', () => renderPreview().catch(() => {}));
  if (receipt) setTimeout(() => renderPreview().catch(() => {}), 0);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form).entries());
    const save = form.querySelector('[data-save]');
    save.disabled = true;
    if (receipt) {
      const out = await runSave(app, () => S.updateSimpleReceipt(app.office, {receiptId: receipt.id, ...values}), 'تم تعديل التحصيل وأُعيد الحساب فورًا');
      if (!out) save.disabled = false;
      return;
    }
    const target = values.target === 'period' ? 'period' : values.target === 'advance' ? 'advance' : 'auto';
    const out = await runSave(app, () => S.recordSimpleCollection(app.office, {
      executionId, amount: values.amount, date: values.date, paymentMethod: values.paymentMethod,
      reference: values.reference, payerName: values.payerName, collectorName: values.collectorName, notes: values.notes,
      target, periodKey: target === 'period' ? values.target : '', asOf: data.schedule.asOf
    }), 'تم تسجيل التحصيل');
    if (!out) save.disabled = false;
  });
  return card;
}

function toMinorUnitsSafe(value, currency) { try { return toMinorUnits(value, currency); } catch { return 0; } }

/* ============================ نموذج الإجراء (S3) ============================ */
export async function simpleActionDialog(app, executionId, {action = null} = {}) {
  const settings = executionSettings(app.office);
  const kinds = actionKindOptions(settings);
  const card = modal(`<h2 class="modal-title">${action ? 'تعديل إجراء' : 'تسجيل إجراء'}</h2>
    <form class="simple-form" data-form="action">
      <div class="form-grid">
        <label class="field">النوع <b class="req">*</b>
          <input name="kind" list="action-kinds" value="${esc(action?.kindLabel || '')}" placeholder="اكتب أو اختر" autofocus>
          <datalist id="action-kinds">${kinds.map(([, label]) => `<option value="${esc(label)}"></option>`).join('')}</datalist>
        </label>
        <label class="field">التاريخ <b class="req">*</b>
          <input name="date" type="date" value="${esc(action?.date || localDate())}">
        </label>
        <label class="field">الرقم (محضر/عريضة/جنحة/دعوى)
          <input name="referenceNumber" value="${esc(action?.referenceNumber || '')}">
        </label>
        <label class="field">الجهة
          <input name="authority" value="${esc(action?.authority || '')}">
        </label>
        <label class="field">النتيجة
          <select name="result">
            ${['تم تسجيل الإجراء', 'تم', 'لم يتم', 'مؤجل', 'ملغي'].map(option => `<option${(action?.result || 'تم تسجيل الإجراء') === option ? ' selected' : ''}>${option}</option>`).join('')}
          </select>
        </label>
        <label class="field">الإجراء التالي (اختياري)
          <input name="nextAction" value="${esc(action?.nextAction || '')}" placeholder="مثال: جلسة بيع">
        </label>
        <label class="field">تاريخ الإجراء التالي
          <input name="nextActionDate" type="date" value="${esc(action?.nextActionDate || '')}">
        </label>
        <label class="field span2">ملاحظات
          <input name="notes" value="${esc(action?.notes || '')}">
        </label>
        ${action ? '<label class="field span2">سبب التعديل<input name="reason" placeholder="يبقى في السجل"></label>' : ''}
      </div>
      <label class="check-line"><input type="checkbox" name="createFollowUp"> إنشاء متابعة في مركز العمل (اختياري — لا تُنشأ تلقائيًا)</label>
      <div class="form-actions">
        <button type="submit" class="primary" data-save>${action ? 'حفظ التعديل' : 'تم تسجيل الإجراء'}</button>
        <button type="button" class="ghost" data-close>إلغاء</button>
      </div>
    </form>`);
  const form = card.querySelector('[data-form="action"]');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form).entries());
    const kindLabel = values.kind;
    const matchedKind = kinds.find(([, label]) => label === kindLabel)?.[0];
    const kind = matchedKind || String(kindLabel || '').trim();
    if (!kind) return toast('اكتب نوع الإجراء أو اختره من القائمة', 'error');
    const save = form.querySelector('[data-save]');
    save.disabled = true;
    const payload = {...values, kind, executionId, createFollowUp: flag(values.createFollowUp)};
    const out = action
      ? await runSave(app, () => S.updateSimpleAction(app.office, {actionId: action.id, patch: payload, reason: values.reason}), 'تم تعديل الإجراء')
      : await runSave(app, () => S.recordSimpleAction(app.office, payload), 'تم تسجيل الإجراء');
    if (!out) save.disabled = false;
    else if (out.workItem) toast('أُنشئت متابعة في مركز العمل', 'ok');
  });
  return card;
}

/* ============================ مصروف / رسم ============================ */
export async function simpleExpenseDialog(app, executionId, {expense = null} = {}) {
  const settings = executionSettings(app.office);
  const types = expenseTypeOptions(settings);
  const card = modal(`<h2 class="modal-title">تسجيل مصروف / رسم</h2>
    <p class="muted small">المصروفات لا تزيد أصل الدين أبدًا، وتظهر في سطر مستقل في الأرقام العليا.</p>
    <form class="simple-form" data-form="expense">
      <div class="form-grid">
        <label class="field">النوع
          <input name="typeLabel" list="expense-types" value="${esc(expense?.label || types[0]?.[1] || '')}" placeholder="اختر أو اكتب">
          <datalist id="expense-types">${types.map(([, label]) => `<option value="${esc(label)}"></option>`).join('')}</datalist>
        </label>
        <label class="field">المبلغ (ج.م) <b class="req">*</b>
          <input name="amount" inputmode="decimal" value="${expense ? esc(expense.amount) : ''}" autofocus>
        </label>
        <label class="field">التاريخ
          <input name="date" type="date" value="${esc(expense?.date || localDate())}">
        </label>
        <label class="field">يدخل في إجمالي التوكيل؟
          <select name="includeInPoa">
            <option value="true"${expense?.includeInPoa ? ' selected' : ''}>نعم</option>
            <option value="false"${expense && !expense.includeInPoa ? ' selected' : ''}>لا</option>
          </select>
        </label>
        <label class="field">على من يتحمله؟
          <select name="borneBy">
            <option value="">— بدون تحديد —</option>
            ${(settings.lists.borneBy || []).map(([key, label]) => `<option value="${esc(key)}">${esc(label)}</option>`).join('')}
          </select>
        </label>
        <label class="field">مرجع المستند
          <input name="documentReferenceId">
        </label>
        <label class="field span2">ملاحظات
          <input name="notes">
        </label>
      </div>
      <div class="form-actions">
        <button type="submit" class="primary" data-save>حفظ المصروف</button>
        <button type="button" class="ghost" data-close>إلغاء</button>
      </div>
    </form>`);
  const form = card.querySelector('[data-form="expense"]');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form).entries());
    const matched = types.find(([, label]) => label === values.typeLabel);
    const save = form.querySelector('[data-save]');
    save.disabled = true;
    const out = await runSave(app, () => S.recordSimpleExpense(app.office, {
      executionId, type: matched?.[0] || 'OTHER_EXPENSE', label: matched?.[1] || values.typeLabel,
      amount: values.amount, date: values.date, includeInPoa: values.includeInPoa === 'true',
      borneBy: values.borneBy, documentReferenceId: values.documentReferenceId, notes: values.notes
    }), 'تم تسجيل المصروف (منفصل عن أصل الدين)');
    if (!out) save.disabled = false;
  });
  return card;
}

/* ====================== حكم لاحق بمعاينة حية (S6) ====================== */
export async function subsequentJudgmentDialog(app, executionId, {bundle = null} = {}) {
  const data = bundle || await S.simpleCardBundle(app.office, executionId);
  const settings = data.settings || executionSettings(app.office);
  const current = data.slices.filter(slice => !['cancelled', 'superseded'].includes(String(slice.status || ''))).at(-1) || null;
  const card = modal(`<h2 class="modal-title">حكم لاحق (زيادة أو تخفيض)</h2>
    <form class="simple-form" data-form="later-judgment">
      <div class="form-grid">
        <label class="field">البند
          <input name="entitlementType" value="${esc(current?.entitlementType || 'نفقة صغار')}">
        </label>
        <label class="field">القيمة الجديدة (ج.م) <b class="req">*</b>
          <input name="amount" inputmode="decimal" autofocus>
        </label>
        <label class="field">يسري من <b class="req">*</b>
          <input name="effectiveFrom" type="date" value="${esc(current ? addCivilDays(current.startDate, 1) : localDate())}">
        </label>
        <label class="field">ينتهي في (اختياري)
          <input name="effectiveTo" type="date">
        </label>
        <label class="field">نوع الحكم
          <select name="judgmentKind">
            ${(settings.lists.laterJudgmentKinds || [['appeal', 'استئناف']]).map(([key, label]) => `<option value="${key}">${esc(label)}</option>`).join('')}
          </select>
        </label>
        <label class="field">رقم الحكم
          <input name="judgmentNumber">
        </label>
        <label class="field">المحكمة
          <input name="court">
        </label>
        <label class="field">تاريخ الحكم
          <input name="judgmentDate" type="date">
        </label>
        <label class="field span2">ملاحظة
          <input name="notes">
        </label>
      </div>
      <div class="alloc-preview" data-preview aria-live="polite"><span class="muted small">اكتب القيمة الجديدة وتاريخ السريان لتظهر معاينة الأثر شهرًا بشهر…</span></div>
      <div class="exec-decision-list" data-decision-fields></div>
      <label class="check-line" data-confirm-line hidden><input type="checkbox" name="confirmedDecrease"> أُقرّ بأن هذا الحكم يخفض القيمة وأريد الحفظ</label>
      <div class="form-actions">
        <button type="submit" class="primary" data-save>حفظ الحكم اللاحق</button>
        <button type="button" class="ghost" data-close>إلغاء</button>
      </div>
    </form>`);
  const form = card.querySelector('[data-form="later-judgment"]');
  const previewHost = form.querySelector('[data-preview]');
  const confirmLine = form.querySelector('[data-confirm-line]');
  const decisionHost = form.querySelector('[data-decision-fields]');
  const choiceLabels = {KEEP_OLD_VALUE: 'القيمة القديمة كاملة', USE_NEW_VALUE: 'القيمة الجديدة كاملة', INCLUDE_FULL: 'الفترة كاملة', EXCLUDE: 'استبعاد الفترة', MANUAL: 'مبلغ كامل يدوي'};
  const scenarioSummary = (preview, scenarios) => {
    const rows = scenarios.map(([choice, key]) => {
      const result = preview.scenarios?.[key];
      if (!result) return '';
      const manualAmount = key === 'END_MANUAL' ? preview.manualEndAmountMinor : preview.manualPeriodAmountMinor;
      const awaitingManual = choice === 'MANUAL' && !Number.isSafeInteger(manualAmount);
      return `<tr><td>${esc(choiceLabels[choice] || choice)}</td><td>${awaitingManual ? 'أدخل مبلغًا كاملًا للاحتساب' : money(result.newDueMinor)}</td><td>${awaitingManual ? '—' : money(result.differenceMinor)}</td></tr>`;
    }).join('');
    return rows ? `<table class="mini-table"><thead><tr><th>الخيار</th><th>المطلوب بعده</th><th>فرق المطلوب</th></tr></thead><tbody>${rows}</tbody></table>` : '';
  };
  const decisionPanel = (period, {kind, title, choiceName, reasonName, amountName, policy, choices}) => {
    if (!period) return '';
    if (data.execution?.accountingModel === 'feas-v1') return `<p class="muted small">${esc(title)}: سيُطلب القرار والسبب لكل فترة عند معاينة/اعتراف FEAS.</p>`;
    if (!['ASK', 'MANUAL'].includes(policy)) return `<p class="muted small">${esc(title)} تُحسم حاليًا وفق إعداد المكتب ${esc(policy)}؛ البدائل أعلاه للمقارنة.</p>`;
    const existing = new FormData(form);
    const selected = String(existing.get(choiceName) || (policy === 'MANUAL' ? 'MANUAL' : ''));
    const manualVisible = selected === 'MANUAL';
    return `<section class="exec-decision-card" data-period-decision>
      <b>${esc(title)} — ${esc(period.fromDate)} → ${esc(period.toDate)}</b>
      <label class="field">القرار<select name="${choiceName}" data-boundary-choice="${kind}" required>
        <option value="">— اختر صراحةً —</option>${choices.map(choice => `<option value="${choice}"${selected === choice ? ' selected' : ''}>${esc(choiceLabels[choice] || choice)}</option>`).join('')}
      </select></label>
      <label class="field">سبب القرار<textarea name="${reasonName}" rows="2" required>${esc(existing.get(reasonName) || '')}</textarea></label>
      <label class="field" data-manual-for="${kind}"${manualVisible ? '' : ' hidden'}>المبلغ الكامل يدويًا (ج.م)
        <input name="${amountName}" type="number" min="0" step="0.01" value="${esc(existing.get(amountName) || '')}"${manualVisible ? ' required' : ''}>
      </label>
    </section>`;
  };
  const toggleManualFields = () => {
    for (const select of decisionHost.querySelectorAll('[data-boundary-choice]')) {
      const manual = decisionHost.querySelector(`[data-manual-for="${select.dataset.boundaryChoice}"]`);
      const input = manual?.querySelector('input');
      if (manual) manual.hidden = select.value !== 'MANUAL';
      if (input) input.required = select.value === 'MANUAL';
    }
  };
  let timer = 0;
  const renderPreview = async () => {
    const amount = form.querySelector('[name="amount"]').value.trim();
    const effectiveFrom = form.querySelector('[name="effectiveFrom"]').value;
    const effectiveTo = form.querySelector('[name="effectiveTo"]').value;
    if (!amount || !isCivilDate(effectiveFrom)) {
      previewHost.innerHTML = '<span class="muted small">اكتب القيمة الجديدة وتاريخ السريان لتظهر معاينة الأثر شهرًا بشهر…</span>';
      decisionHost.innerHTML = ''; return;
    }
    if (data.execution?.accountingModel === 'feas-v1') {
      confirmLine.hidden = true;
      previewHost.innerHTML = '<span class="muted small">هذا التنفيذ يتبع FEAS؛ قرارات الفترات تُطلب في مسار الاعتراف المنفصل، ولا تُطبَّق معاينة المحرك القديم هنا.</span>';
      decisionHost.innerHTML = ''; return;
    }
    try {
      const preview = await S.previewSubsequentJudgment(app.office, executionId, {amount, effectiveFrom, effectiveTo,
        manualPeriodAmount: form.querySelector('[name="manualPeriodAmount"]')?.value || '',
        manualEndAmount: form.querySelector('[name="manualEndAmount"]')?.value || '',
        entitlementType: form.querySelector('[name="entitlementType"]').value, asOf: data.schedule.asOf});
      const currentMinor = current ? toMinorUnitsSafe(current.amount, preview.currency) : 0;
      const newMinor = toMinorUnitsSafe(amount, preview.currency);
      const decrease = currentMinor > 0 && newMinor < currentMinor;
      confirmLine.hidden = !decrease;
      const scenarios = [
        ...(preview.midPeriod ? [[['KEEP_OLD_VALUE', 'KEEP_OLD_VALUE'], ['USE_NEW_VALUE', 'USE_NEW_VALUE'], ['MANUAL', 'MANUAL']]] : []),
        ...(preview.midEndPeriod ? [[['INCLUDE_FULL', 'INCLUDE_FULL'], ['EXCLUDE', 'EXCLUDE'], ['MANUAL', 'END_MANUAL']]] : [])
      ].flat();
      const panels = [
        decisionPanel(preview.midPeriod, {kind: 'MID_CHANGE', title: 'قرار الحكم اللاحق الذي يبدأ منتصف الفترة',
          choiceName: 'midPeriodChoice', reasonName: 'midPeriodReason', amountName: 'manualPeriodAmount',
          policy: settings.schedule.midChangePolicy, choices: ['KEEP_OLD_VALUE', 'USE_NEW_VALUE', 'MANUAL']}),
        decisionPanel(preview.midEndPeriod, {kind: 'END_DATE', title: 'قرار نهاية الحكم التي تقع منتصف الفترة',
          choiceName: 'endPeriodChoice', reasonName: 'endPeriodReason', amountName: 'manualEndAmount',
          policy: settings.schedule.endPolicy, choices: ['INCLUDE_FULL', 'EXCLUDE', 'MANUAL']})
      ].filter(Boolean).join('');
      decisionHost.innerHTML = panels;
      toggleManualFields();
      if (preview.rows.length === 0 && !scenarios.length) { previewHost.innerHTML = '<span class="muted small">لا يوجد تغيير في الاستحقاق بهذه القيمة/التاريخ.</span>'; return; }
      previewHost.innerHTML = `<b>الأثر شهرًا بشهر:</b>
        <table class="mini-table"><thead><tr><th>الشهر</th><th>القيمة الحالية</th><th>الجديدة</th><th>الفرق</th></tr></thead><tbody>
        ${preview.rows.map(row => `<tr><td>${esc(row.label)}</td><td>${money(row.oldMinor)}</td><td>${money(row.newMinor)}</td><td class="${row.differenceMinor < 0 ? 'neg' : 'pos'}">${money(row.differenceMinor)}</td></tr>`).join('')}
        </tbody><tfoot><tr><td>الإجمالي</td><td>${money(preview.totals.oldDueMinor)}</td><td>${money(preview.totals.newDueMinor)}</td><td class="${preview.totals.differenceMinor < 0 ? 'neg' : 'pos'}">${money(preview.totals.differenceMinor)}</td></tr></tfoot></table>
        ${scenarios.length ? `<h4>مقارنة خيارات الحدود — بلا تناسب بالأيام</h4>${scenarioSummary(preview, scenarios)}` : ''}
        ${decrease ? `<p class="warn-line">تخفيض: أي مبلغ مدفوع يتجاوز الاستحقاق الجديد يظهر كـ«دفعة زائدة / رصيد دائن» بلا رد تلقائي.</p>` : ''}
        <p class="muted small">${esc(preview.equations.join(' — '))}</p>`;
    } catch (error) { previewHost.innerHTML = `<span class="muted small">${esc(userError(error))}</span>`; decisionHost.innerHTML = ''; }
  };
  form.addEventListener('input', event => {
    if (event.target.closest('[data-period-decision]')) return;
    clearTimeout(timer); timer = setTimeout(() => renderPreview().catch(() => {}), 200);
  });
  form.addEventListener('change', event => {
    if (event.target.closest('[data-period-decision]')) {
      toggleManualFields();
      if (event.target.matches('[name="manualPeriodAmount"], [name="manualEndAmount"]')) renderPreview().catch(() => {});
      return;
    }
    renderPreview().catch(() => {});
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form).entries());
    const save = form.querySelector('[data-save]');
    save.disabled = true;
    const out = await runSave(app, () => S.recordSubsequentJudgment(app.office, {
      executionId, entitlementType: values.entitlementType, amount: values.amount, effectiveFrom: values.effectiveFrom,
      effectiveTo: values.effectiveTo, judgmentNumber: values.judgmentNumber, court: values.court,
      judgmentDate: values.judgmentDate, notes: values.notes, confirmedDecrease: flag(values.confirmedDecrease),
      midPeriodChoice: values.midPeriodChoice, midPeriodReason: values.midPeriodReason, manualPeriodAmount: values.manualPeriodAmount,
      endPeriodChoice: values.endPeriodChoice, endPeriodReason: values.endPeriodReason, manualEndAmount: values.manualEndAmount,
      previousSliceId: current?.id || ''
    }), 'تم تسجيل الحكم اللاحق وأُعيد بناء الجدول');
    if (!out) save.disabled = false;
  });
  return card;
}

/* ============================ ملاحظة ============================ */
export function simpleNoteDialog(app, executionId) {
  const card = modal(`<h2 class="modal-title">ملاحظة على التنفيذ</h2>
    <form class="simple-form" data-form="note">
      <label class="field span2">النص <b class="req">*</b><textarea name="body" rows="3" autofocus></textarea></label>
      <div class="form-actions">
        <button type="submit" class="primary" data-save>حفظ الملاحظة</button>
        <button type="button" class="ghost" data-close>إلغاء</button>
      </div>
    </form>`);
  const form = card.querySelector('[data-form="note"]');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form).entries());
    const save = form.querySelector('[data-save]');
    save.disabled = true;
    const out = await runSave(app, () => S.recordSimpleNote(app.office, {executionId, body: values.body}), 'تم تسجيل الملاحظة');
    if (!out) save.disabled = false;
  });
  return card;
}

/* ======================= احسب مدة (S5) ======================= */
export async function durationDialog(app, executionId = '', {bundle = null, lockExecution = false, fromDate = '', toDate = ''} = {}) {
  const presetFrom = isCivilDate(fromDate) ? fromDate : '';
  const presetAmount = (bundle?.slices || []).filter(slice => !['cancelled', 'superseded'].includes(String(slice.status || ''))).at(-1)?.amount || '';
  const presetTo = isCivilDate(toDate) ? toDate : '';
  const clientsDefault = lockExecution ? executionId : '';
  const executions = lockExecution ? [] : (await app.office.r.execution.page({index: 'openedDate', direction: 'prev', limit: 100}).catch(() => ({items: []}))).items || [];
  const today = localDate();
  const shortcuts = [
    {key: 'last3', label: 'آخر 3 أشهر', from: addCivilDays(today, -90), to: today},
    {key: 'last6', label: 'آخر 6 أشهر', from: addCivilDays(today, -180), to: today},
    {key: 'last12', label: 'آخر 12 شهرًا', from: addCivilDays(today, -365), to: today},
    {key: 'year', label: 'السنة الحالية', from: `${today.slice(0, 4)}-01-01`, to: today}
  ];
  const card = modal(`<h2 class="modal-title">🧮 احسب مبلغ مدة</h2>
    ${executions.length ? `<label class="field">التنفيذ
      <select name="executionId">${executions.map(row => `<option value="${esc(row.id)}"${row.id === clientsDefault ? ' selected' : ''}>${esc(row.internalNumber || row.officialNumber || 'تنفيذ')}</option>`).join('')}</select>
    </label>` : '<p class="muted small">حساب على التنفيذ المفتوح.</p>'}
    <div class="quick-chips">${shortcuts.map(shortcut => `<button type="button" class="chip" data-from="${esc(shortcut.from)}" data-to="${esc(shortcut.to)}">${esc(shortcut.label)}</button>`).join('')}
      <button type="button" class="chip" data-custom>من تاريخ إلى تاريخ</button></div>
    <form class="simple-form" data-form="duration">
      <div class="form-grid">
        <label class="field">من <b class="req">*</b><input name="fromDate" type="date" value="${esc(presetFrom || `${today.slice(0, 4)}-01-01`)}"></label>
        <label class="field">إلى <b class="req">*</b><input name="toDate" type="date" value="${esc(presetTo || today)}"></label>
      </div>
      <fieldset data-manual-calc>
        <legend>💰 الحساب بمبلغ يدوي (بدلًا من الجدول المسجَّل)</legend>
        <p class="muted small">مذكرة حساب سريعة بالمبلغ والدورية الذين تكتبهما — تعمل حتى لو لم تُسجَّل قيمة على التنفيذ. لا تُنشئ استحقاقًا ولا تغيّر الرصيد المسجَّل.</p>
        <div class="form-grid">
          <label class="field">المبلغ (ج.م)<input name="manualAmount" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(presetAmount)}" placeholder="مثال: 3,000"></label>
          <label class="field">الدورية
            <select name="manualPeriodicity">
              <option value="monthly" selected>شهري</option>
              <option value="weekly">أسبوعي</option>
              <option value="semiMonthly">نصف شهري</option>
              <option value="yearly">سنوي</option>
            </select>
          </label>
          <label class="field">رسوم التنفيذ (اختياري)<input name="manualFees" type="number" min="0" step="0.01" inputmode="decimal" placeholder="مثال: 500"></label>
          <label class="field">دمغة (اختياري)<input name="manualStamps" type="number" min="0" step="0.01" inputmode="decimal" placeholder="مثال: 100"></label>
        </div>
        <label class="check-line"><input type="checkbox" name="useManual" data-use-manual> استخدم هذا الحساب اليدوي في النتيجة</label>
      </fieldset>
      <label class="check-line"><input type="checkbox" name="allowFuture" data-allow-future> احسب حتى تاريخ مستقبلي (تقديري)</label>
      <p class="hint hint-info small" data-future-hint>إن كان تاريخ النهاية بعد اليوم: النظام ينفّذ التاريخ الذي اخترته ويتضمن الفترات المنتهية داخله، ويعلّم الفترات التي لم تنتهِ بعد بأنها <b>تقديرية</b> — بلا قصّ صامت إلى اليوم.</p>
      <div class="alloc-preview" data-result aria-live="polite"><span class="muted small">اختر المدة ثم اضغط احسب.</span></div>
      <div class="form-actions">
        <button type="submit" class="primary" data-save>احسب</button>
        <button type="button" class="ghost" data-copy hidden>نسخ</button>
        <button type="button" class="ghost" data-print hidden>طباعة</button>
        <button type="button" class="ghost" data-poa hidden>إنشاء توكيل بهذه المدة</button>
      </div>
    </form>`);
  const form = card.querySelector('[data-form="duration"]');
  const resultHost = form.querySelector('[data-result]');
  // اقتراح مبدئي لمبلغ الحساب اليدوي من آخر بند قيمة مسجَّل (عرض فقط — لا يُنشئ شيئًا).
  if (presetAmount && !form.querySelector('[name="manualAmount"]').value) form.querySelector('[name="manualAmount"]').value = presetAmount;
  const futureBox = form.querySelector('[data-allow-future]');
  const currentId = () => (lockExecution ? executionId : (form.closest('.modal-card').querySelector('[name="executionId"]')?.value || executionId));
  // اختيار تاريخ نهاية مستقبلي = طلب صريح: يُفعَّل خيار «تقديري» تلقائيًا
  // حتى لا يُقَصّ النطاق إلى اليوم في صمت (وهو جوهر الشكوى المبلَّغة).
  const syncFutureBox = () => {
    const to = form.querySelector('[name="toDate"]')?.value || '';
    if (to && to > localDate() && futureBox && !futureBox.checked) futureBox.checked = true;
    const hint = form.querySelector('[data-future-hint]');
    if (hint) hint.innerHTML = to && to > localDate()
      ? (futureBox?.checked
        ? 'النطاق يمتد بعد اليوم: ستُحتسب الفترات المنتهية داخل النطاق، وتظهر الفترات التي لم تنتهِ بعد بوسم <b>تقديري</b> بمبلغها المتوقع.'
        : 'النطاق يمتد بعد اليوم والخيار غير مفعَّل: سيتوقف الحساب عند اليوم ويظهر التاريخ الفعلي صراحةً بدل رقم منسوب لتاريخ آخر.')
      : 'حدّد تاريخ نهاية بعد اليوم لإظهار خيار الحساب المستقبلي (تقديري).';
  };
  form.querySelector('[name="toDate"]')?.addEventListener('change', syncFutureBox);
  futureBox?.addEventListener('change', syncFutureBox);
  syncFutureBox();
  card.querySelectorAll('[data-from]').forEach(button => button.addEventListener('click', () => {
    form.querySelector('[name="fromDate"]').value = button.dataset.from;
    form.querySelector('[name="toDate"]').value = button.dataset.to;
    if (futureBox) futureBox.checked = button.dataset.to > localDate();
    syncFutureBox();
    resultHost.innerHTML = '<span class="muted small">اختر المدة ثم اضغط احسب.</span>';
    form.requestSubmit();
  }));
  /** عرض نتيجة الحساب اليدوي: مذكرة بأرقامها ومعادلاتها — بلا أي كتابة على السجل. */
  const renderManualDuration = calc => {
    const money0 = minor => `${fromMinorUnits(minor, 'EGP').toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    const label = {monthly: 'شهريًا', weekly: 'أسبوعيًا', semiMonthly: 'نصف شهري', yearly: 'سنويًا'}[calc.periodicity] || '';
    const rows = calc.units.map(unit => `<tr><td>${displayDate(unit.fromDate)} – ${displayDate(unit.toDate)}</td><td>${money0(calc.amountMinor)}</td></tr>`).join('');
    const equations = [
      `قيمة الفترة = ${money0(calc.amountMinor)} ج.م ${label}`,
      `عدد الفترات من ${displayDate(form.querySelector('[name="fromDate"]').value)} إلى ${displayDate(form.querySelector('[name="toDate"]').value)} = ${calc.units.length}`,
      `إجمالي الفترات = ${calc.units.length} × ${money0(calc.amountMinor)} = ${money0(calc.totalMinor)} ج.م`,
      calc.feesMinor ? `رسوم التنفيذ (إدخال يدوي) = ${money0(calc.feesMinor)} ج.م` : '',
      calc.stampsMinor ? `الدمغة (إدخال يدوي) = ${money0(calc.stampsMinor)} ج.م` : '',
      `الإجمالي = ${money0(calc.grandMinor)} ج.م`
    ].filter(Boolean);
    resultHost.dataset.currency = 'EGP';
    resultHost.innerHTML = `<div class="result-numbers">
        <div><span>قيمة الفترة (${esc(label)})</span><b>${money0(calc.amountMinor)}</b></div>
        <div><span>عدد الفترات</span><b>${calc.units.length}</b></div>
        <div><span>إجمالي الفترات</span><b>${money0(calc.totalMinor)}</b></div>
        ${calc.feesMinor ? `<div><span>رسوم (يدوي)</span><b>${money0(calc.feesMinor)}</b></div>` : ''}
        ${calc.stampsMinor ? `<div><span>دمغة (يدوي)</span><b>${money0(calc.stampsMinor)}</b></div>` : ''}
        <div class="total"><span>الإجمالي المطلوب</span><b>${money0(calc.grandMinor)}</b></div>
      </div>
      <p class="hint hint-info small">هذه <b>مذكرة حساب يدوي</b> بالأرقام التي أدخلتها: لا تُنشئ استحقاقًا مسجَّلًا ولا تغيّر «المطلوب/المدقوع» على التنفيذ. أما «طباعة كشف» و«توكيل» فيعتمدان على بيانات التنفيذ المسجَّلة وحدها.</p>
      <table class="mini-table"><thead><tr><th>الفترة</th><th>المبلغ</th></tr></thead><tbody>${rows}
        <tr class="total"><td><b>إجمالي الفترات</b></td><td><b>${money0(calc.totalMinor)}</b></td></tr>
        ${calc.feesMinor ? `<tr><td>رسوم التنفيذ (يدوي)</td><td>${money0(calc.feesMinor)}</td></tr>` : ''}
        ${calc.stampsMinor ? `<tr><td>الدمغة (يدوي)</td><td>${money0(calc.stampsMinor)}</td></tr>` : ''}
        <tr class="total"><td><b>الإجمالي النهائي</b></td><td><b>${money0(calc.grandMinor)}</b></td></tr>
      </tbody></table>
      <ol class="small">${equations.map(line => `<li>${esc(line)}</li>`).join('')}</ol>`;
    form.querySelector('[data-save]').textContent = 'احسب';
    form.querySelector('[data-copy]').hidden = false;
    form.querySelector('[data-print]').hidden = true;
    form.querySelector('[data-poa]').hidden = true;
    form.querySelector('[data-copy]').onclick = async () => {
      try { await navigator.clipboard.writeText(equations.join('\n')); toast('نُسخ الملخص'); } catch { toast('تعذر النسخ تلقائيًا', 'error'); }
    };
  };
  /**
   * الحساب اليدوي: عدد فترات النطاق بالمحرك النقي نفسه × المبلغ الذي أدخله المكتب,
   * ثم + رسوم/دمغة يدوية. لا يستنتج النظام مبلغًا ولا ينشئ استحقاقًا — مذكرة فقط.
   */
  const manualDuration = values => {
    const amountMinor = toMinorUnits(values.manualAmount || '', 'EGP');
    if (!amountMinor || amountMinor <= 0) throw new Error('أدخل مبلغًا يدويًا أكبر من صفر (أو ألغِ خيار الحساب اليدوي).');
    if (!isCivilDate(values.fromDate) || !isCivilDate(values.toDate) || values.toDate < values.fromDate) throw new Error('نطاق المدة غير صحيح: راجع تاريخي البداية والنهاية.');
    const periodicity = values.manualPeriodicity || 'monthly';
    const {units} = enumerateExecutionUnits({fromDate: values.fromDate, toDate: values.toDate, frequency: periodicity});
    if (!units.length) throw new Error('لا توجد فترات في النطاق المحدد.');
    const feesMinor = toMinorUnits(values.manualFees || '', 'EGP') || 0;
    const stampsMinor = toMinorUnits(values.manualStamps || '', 'EGP') || 0;
    const totalMinor = amountMinor * units.length;
    return {amountMinor, feesMinor, stampsMinor, totalMinor, grandMinor: totalMinor + feesMinor + stampsMinor, periodicity, units};
  };
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form).entries());
    try {
      if (flag(values.useManual)) return renderManualDuration(manualDuration(values));
      const pendingControls = [...resultHost.querySelectorAll('[data-range-decision]')];
      let rangeDecisions = [];
      if (pendingControls.length) {
        const decisions = pendingControls.map(host => {
          const choice = host.querySelector('[data-range-choice]')?.value || '';
          const amountInput = host.querySelector('[data-range-amount]');
          const amountMinor = choice === 'MANUAL' ? toMinorUnits(amountInput?.value || '', resultHost.dataset.currency || 'EGP') : null;
          return {periodKey: host.dataset.periodKey, kind: host.dataset.kind, itemId: host.dataset.itemId, anchorDate: host.dataset.anchorDate,
            k: Number(host.dataset.k), fromDate: host.dataset.fromDate, toDate: host.dataset.toDate, choice,
            reason: host.querySelector('[data-range-reason]')?.value || '', ...(choice === 'MANUAL' ? {amountMinor} : {})};
        });
        if (decisions.some(row => row.choice)) {
          if (decisions.some(row => !row.choice)) throw new Error('اختر قرارًا لكل فترة حدّية قبل الحفظ.');
          const saved = await S.recordSimpleDurationDecisions(app.office, currentId(), {fromDate: values.fromDate, toDate: values.toDate, decisions});
          rangeDecisions = saved.decisions;
        }
      }
      const claim = await S.simpleDurationClaim(app.office, currentId(), {
        fromDate: values.fromDate, toDate: values.toDate, rangeDecisions,
        allowFuture: flag(values.allowFuture)
      });
      const currency = claim.totals.currency;
      resultHost.dataset.currency = currency;
      const amount = minor => `${fromMinorUnits(minor, currency).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
      const boundaryHtml = claim.partials.length ? `<section class="hint hint-warning"><b>الفترة الحدّية لا تُحتسب بنسبة الأيام.</b><p class="small">اختر قرارًا صريحًا لكل فترة؛ القرار وسببه وتاريخه والمستخدم سيُحفظ في سجل النشاط.</p>
        ${claim.partials.map(decision => `<div class="form-grid" data-range-decision data-period-key="${esc(decision.periodKey)}" data-kind="${esc(decision.kind)}" data-item-id="${esc(decision.itemId || '')}" data-anchor-date="${esc(decision.anchorDate || '')}" data-k="${esc(decision.k)}" data-from-date="${esc(decision.fromDate)}" data-to-date="${esc(decision.toDate)}">
          <p class="small">${displayDate(decision.fromDate)} – ${displayDate(decision.toDate)} — قيمة الفترة الكاملة ${amount(decision.dueMinor)}.</p>
          <label class="field">القرار<select data-range-choice><option value="">— اختر صراحةً —</option><option value="INCLUDE_FULL">احتساب الفترة كاملة</option><option value="EXCLUDE">استبعاد الفترة</option><option value="MANUAL">قيمة كاملة يدوية</option></select></label>
          <label class="field">سبب القرار<textarea data-range-reason rows="2" placeholder="سبب القرار" required></textarea></label>
          <label class="field" data-manual-wrap hidden>المبلغ الكامل يدويًا<input data-range-amount type="number" min="0" step="0.01" inputmode="decimal"></label>
        </div>`).join('')}</section>` : '';
      const sideBySideHtml = claim.sideBySideScenarios.length ? `<details><summary>مقارنة الخيارات بلا تناسب</summary><table class="mini-table"><thead><tr><th>الفترة</th><th>الخيار</th><th>قيمة الفترة</th><th>المدفوع</th><th>المتبقي</th></tr></thead><tbody>${claim.sideBySideScenarios.map(row => `<tr><td>${esc(row.periodKey)}</td><td>${esc(row.choice)}</td><td>${row.amountMinor === null ? '—' : amount(row.amountMinor)}</td><td>${row.paidMinor === null ? '—' : amount(row.paidMinor)}</td><td>${row.remainingMinor === null ? '—' : amount(row.remainingMinor)}</td></tr>`).join('')}</tbody></table></details>` : '';
      const statusNotes = [
        ...claim.decisionRows.map(row => `تحتاج الفترة ${displayDate(row.fromDate)} – ${displayDate(row.toDate)} قرارًا مستقلًا بشأن القيمة: ${row.reason}`),
        ...claim.notYetComplete.map(row => `فترة جارية ${displayDate(row.fromDate)} – ${displayDate(row.toDate)} بمبلغ متوقع ${amount(row.projectedMinor || 0)} تُستحق في ${displayDate(row.toDate)} — معلوماتية ولا تدخل في المستحق.`),
        claim.horizonCapped ? `لم يُحسب بعد ${displayDate(claim.requestedToDate || claim.toDate)}: أفق الحساب الفعلي ${displayDate(claim.effectiveAsOf || claim.toDate)}. ${claim.horizonNote || ''}`
          : (claim.estimateNote || '')
      ].filter(Boolean);
      resultHost.innerHTML = `<div class="result-numbers">
          <div><span>المستحق عن المدة</span><b>${amount(claim.totals.dueMinor)}</b></div>
          <div><span>المدفوع عنها</span><b>${amount(claim.totals.paidMinor)}</b></div>
          <div><span>المتبقي عنها</span><b>${amount(claim.totals.remainingMinor)}</b></div>
          <div><span>رصيد سابق للمدة</span><b>${amount(claim.totals.beforeMinor)}</b></div>
          ${claim.totals.runningProjectedMinor ? `<div><span>متوقع فترات جارية (غير مستحق)</span><b>${amount(claim.totals.runningProjectedMinor)}</b></div>` : ''}
          <div class="total"><span>الإجمالي المطلوب</span><b>${amount(claim.totals.totalRequiredMinor)}</b></div>
        </div>
        ${boundaryHtml}${statusNotes.length ? `<ul class="hint hint-info small">${statusNotes.map(note => `<li>${esc(note)}</li>`).join('')}</ul>` : ''}
        <table class="mini-table"><thead><tr><th>الفترة</th><th>المستحق</th><th>المدفوع</th><th>المتبقي</th><th>الحالة</th></tr></thead><tbody>
        ${claim.rows.map(row => `<tr><td>${esc(row.label)}</td><td>${amount(row.dueMinor)}</td><td>${amount(row.paidMinor)}</td><td>${amount(row.remainingMinor)}</td><td>${statusLabel(row.status)}</td></tr>`).join('')}
        ${claim.notYetComplete?.length ? claim.notYetComplete.map(row => `<tr class="is-running"><td>${esc(row.label || `${displayDate(row.fromDate)} – ${displayDate(row.toDate)}`)}</td><td>${amount(row.projectedMinor || 0)} <span class="muted">(متوقع)</span></td><td>${amount(row.paidMinor || 0)}</td><td>${amount(Math.max(0, (row.projectedMinor || 0) - (row.paidMinor || 0)))}</td><td>${statusLabel(row.status || 'RUNNING')}</td></tr>`).join('') : ''}
        </tbody></table>${sideBySideHtml}<ol class="small">${claim.equations.map(line => `<li>${esc(line)}</li>`).join('')}</ol>`;
      resultHost.querySelectorAll('[data-range-choice]').forEach(select => select.addEventListener('change', () => {
        const manual = select.value === 'MANUAL';
        const wrap = select.closest('[data-range-decision]').querySelector('[data-manual-wrap]');
        const amountInput = wrap.querySelector('[data-range-amount]');
        wrap.hidden = !manual;
        amountInput.required = manual;
      }));
      const canFinalize = !claim.partials.length && !claim.decisionRows.length && !claim.notYetComplete.length;
      form.querySelector('[data-save]').textContent = claim.partials.length ? 'احفظ القرارات واحسب' : 'احسب';
      form.querySelector('[data-copy]').hidden = false;
      form.querySelector('[data-print]').hidden = false;
      form.querySelector('[data-print]').disabled = Boolean(claim.partials.length || claim.decisionRows.length);
      form.querySelector('[data-poa]').hidden = false;
      form.querySelector('[data-poa]').disabled = !canFinalize;
      form.querySelector('[data-copy]').onclick = async () => {
        const text = claim.equations.join('\\n');
        try { await navigator.clipboard.writeText(text); toast('نُسخ الملخص'); } catch { toast('تعذر النسخ تلقائيًا', 'error'); }
      };
      form.querySelector('[data-print]').onclick = () => app.office && S.printSimpleStatement(app.office, currentId(), {mode: 'range', fromDate: values.fromDate, toDate: values.toDate, rangeDecisions: claim.decisions, allowFuture: flag(futureBox?.checked)}).catch(error => toast(userError(error), 'error'));
      form.querySelector('[data-poa]').onclick = () => simplePoaDialog(app, currentId(), {fromDate: values.fromDate, toDate: values.toDate, rangeDecisions: claim.decisions}).catch(error => toast(userError(error), 'error'));
    } catch (error) { resultHost.innerHTML = `<span class="muted small">${esc(userError(error))}</span>`; }
  });
  return card;
}

/* ======================= التوكيل والطباعة (S7) ======================= */
/** وصف مصدر الرصيد السابق: محضر تبديد/حجز مسجَّل على التنفيذ، أو تصريح بعدم وجوده. */
function previousSourceHint(data) {
  const source = S.previousBalanceSource(data?.actions || []);
  return source
    ? `الرصيد السابق مرتبط بمصدر مسجَّل: ${source.label} — يُدرج بالسطر المستقل عند تفعيل الخيار أعلاه.`
    : 'لا يوجد محضر تبديد/حجز مرتبط: يظهر الرصيد السابق من الفترات غير المسددة قبل بداية النطاق، وإن لم يوجد فهو صفر.';
}
export async function simplePoaDialog(app, executionId, {fromDate = '', toDate = '', bundle = null, rangeDecisions = []} = {}) {
  const data = bundle || await S.simpleCardBundle(app.office, executionId);
  const today = localDate();
  const firstUnpaid = data.schedule.rows.find(row => row.remainingMinor > 0)?.fromDate || data.schedule.rows[0]?.fromDate || today;
  const lastPoa = data.poas[0] || null;
  const start = isCivilDate(fromDate) ? fromDate : (lastPoa?.toDate ? addCivilDays(lastPoa.toDate, 1) : firstUnpaid);
  const feasModel = String(data.execution?.accountingModel || '') === 'feas-v1';
  const card = modal(`<h2 class="modal-title">إنشاء توكيل</h2>
    <form class="simple-form" data-form="poa">
      <div class="form-grid">
        <label class="field">من <b class="req">*</b><input name="fromDate" type="date" value="${esc(start)}"></label>
        <label class="field">إلى <b class="req">*</b><input name="toDate" type="date" value="${esc(isCivilDate(toDate) ? toDate : today)}"></label>
        <label class="field">رقم التوكيل (اختياري)<input name="poaNumber" value="${esc(lastPoa?.poaNumber || '')}"></label>
        <label class="field">تاريخ التوكيل<input name="date" type="date" value="${esc(today)}"></label>
      </div>
      <p class="hint hint-info" data-no-double-count>قاعدة منع الازدواج: «الرصيد السابق جزء من المتبقي ولا يُضاف عليه مرة ثانية» — إصدار التوكيل لا يغيّر المتبقي أبدًا.</p>
      <label class="check-line"><input type="checkbox" name="includePreviousBalance" checked> إدراج الرصيد السابق غير المسدد (جزء من المتبقي — لا يُضاف عليه مرتين)</label>
      <p class="muted small" data-previous-source>${esc(previousSourceHint(data))}</p>
      <label class="check-line"><input type="checkbox" name="allowFuture" data-poa-future${esc(isCivilDate(toDate) && toDate > today ? ' checked' : '')}> احتساب الفترات المستقبلية داخل النطاق (تقديري)</label>
      <p class="hint hint-info small" data-poa-future-hint>إن كان تاريخ النهاية بعد اليوم فسيُفعَّل هذا الخيار تلقائيًا: النظام ينفّذ النطاق الذي اخترته ويعلّم الفترات القادمة بأنها <b>تقديرية</b> — بلا قصّ صامت إلى اليوم.</p>
      <label class="check-line"><input type="checkbox" name="includeRunningPeriods" data-poa-running> إدراج الفترات التي لم تنتهِ بعد كاملةً (قرار صريح — تقديري)</label>
      <fieldset data-expenses><legend>مصروفات تُدرج في التوكيل</legend>
        ${data.expenses.length ? data.expenses.map(expense => `<label class="check-line"><input type="checkbox" name="expense" value="${esc(expense.id)}"${expense.includeInPoa ? ' checked' : ''}> ${esc(expense.label)} — ${money(expense.amountMinor)} ${esc(expense.date)}${expense.borneByLabel ? ` (يتحمله: ${esc(expense.borneByLabel)})` : ''}</label>`).join('') : '<p class="muted small">لا توجد مصروفات مسجلة.</p>'}
      </fieldset>
      <fieldset${feasModel ? ' data-feas-disabled' : ''}><legend>رسوم ودمغة (إدخال يدوي — لا يزيدان أصل الدين)</legend>
        <div class="form-grid">
          <label class="field">رسوم (إدخال يدوي)<input name="fees" inputmode="decimal" placeholder="0.00"${feasModel ? ' disabled' : ''}></label>
          <label class="field">دمغة (إدخال يدوي)<input name="stamps" inputmode="decimal" placeholder="0.00"${feasModel ? ' disabled' : ''}></label>
        </div>
        <p class="muted small">${feasModel
          ? 'هذا التنفيذ على نموذج FEAS (اعتراف صريح بفترات): الرسوم والدمغة اليدوية هنا لا تُطبَّق عليه، ويُدار ما يخصّه من مسار الاعتراف نفسه.'
          : 'النظام لا يفترض رسومًا ولا دمغة — أدخلها أنت حسب واقع الملف. تُضاف إلى إجمالي التوكيل كسطرين مستقلين ولا تزيد أصل الالتزام الدوري.'}</p>
      </fieldset>
      <div class="alloc-preview" data-preview aria-live="polite"></div>
      <div class="form-actions">
        <button type="submit" class="primary" data-save>حفظ وطباعة</button>
        <button type="button" class="ghost" data-print-only>طباعة بلا حفظ</button>
        <button type="button" class="ghost" data-close>إلغاء</button>
      </div>
    </form>`);
  const form = card.querySelector('[data-form="poa"]');
  const previewHost = form.querySelector('[data-preview]');
  let activeRangeDecisions = Array.isArray(rangeDecisions) ? rangeDecisions : [];
  const manualMinor = (value, currency) => {
    const text = String(value ?? '').trim();
    if (!text) return 0;
    const parsed = toMinorUnitsSafe(text, currency);
    if (!parsed) return 0;
    return parsed;
  };
  const currentDraft = async () => {
    const values = Object.fromEntries(new FormData(form).entries());
    const expenseIds = [...form.querySelectorAll('[name="expense"]:checked')].map(input => input.value);
    const currency = data.schedule?.currency || 'EGP';
    const draft = await S.simplePoaDraft(app.office, executionId, {
      fromDate: values.fromDate, toDate: values.toDate,
      includePreviousBalance: flag(values.includePreviousBalance), expenseIds, rangeDecisions: activeRangeDecisions,
      allowFuture: flag(values.allowFuture),
      includeRunningPeriods: flag(values.includeRunningPeriods),
      feesMinor: manualMinor(values.fees, currency), stampsMinor: manualMinor(values.stamps, currency)
    });
    return {draft, values, expenseIds};
  };
  const render = async () => {
    try {
      const {draft} = await currentDraft();
      const currency = draft.currency;
      const amount = minor => `${fromMinorUnits(minor, currency).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
      const boundaries = draft.partials || [];
      const boundaryHtml = boundaries.length ? `<section class="hint hint-warning"><b>الفترة الحدّية لا تُقسَّم بالأيام.</b><p class="small">اختر قرارًا كاملًا لكل فترة واذكر السبب؛ يُحفظ القرار في سجل النشاط وبنسخة التوكيل.</p>
        ${boundaries.map(row => `<div class="form-grid" data-range-poa data-period-key="${esc(row.periodKey)}" data-kind="${esc(row.kind)}" data-item-id="${esc(row.itemId || '')}" data-anchor-date="${esc(row.anchorDate || '')}" data-k="${esc(row.k)}" data-from-date="${esc(row.fromDate)}" data-to-date="${esc(row.toDate)}">
          <p class="small">${displayDate(row.fromDate)} – ${displayDate(row.toDate)} — الفترة الكاملة ${amount(row.dueMinor || 0)}.</p>
          <label class="field">القرار<select data-poa-choice><option value="">— اختر صراحةً —</option><option value="INCLUDE_FULL">إدراج الفترة كاملة</option><option value="EXCLUDE">استبعاد الفترة</option><option value="MANUAL">مبلغ كامل يدوي</option></select></label>
          <label class="field">سبب القرار<textarea data-poa-reason rows="2" placeholder="سبب القرار" required></textarea></label>
          <label class="field" data-poa-manual hidden>المبلغ الكامل<input data-poa-amount type="number" min="0" step="0.01" inputmode="decimal"></label>
        </div>`).join('')}</section>` : '';
      const scenarioRows = draft.rangeScenarios || [];
      const scenarioHtml = scenarioRows.length ? `<details><summary>مقارنة خيارات الحدّ بلا تناسب</summary><table class="mini-table"><thead><tr><th>الفترة</th><th>الخيار</th><th>القيمة</th></tr></thead><tbody>${scenarioRows.map(row => `<tr><td>${esc(row.periodKey)}</td><td>${esc(row.choice)}</td><td>${row.amountMinor === null ? '—' : amount(row.amountMinor)}</td></tr>`).join('')}</tbody></table></details>` : '';
      const lineRows = (draft.lines || []).filter(line => Number(line.amountMinor || 0) > 0);
      const linesHtml = lineRows.length ? `<details open><summary>بنود التوكيل ومعادلة كل بند (${lineRows.length})</summary>
        <table class="mini-table"><thead><tr><th>البند</th><th>المبلغ</th><th>المعادلة / المصدر</th></tr></thead><tbody>
        ${lineRows.map(line => `<tr><td>${esc(line.label || '')}</td><td>${amount(line.amountMinor)}</td><td class="muted small">${esc([line.equation, line.note, line.source?.label].filter(Boolean).join(' — '))}</td></tr>`).join('')}
        </tbody></table></details>` : '';
      const manual = Number(draft.manualAdjustmentsMinor || 0);
      previewHost.innerHTML = `${boundaryHtml}<div class="result-numbers">
          <div><span>رصيد سابق${draft.previousSource ? ' (مرتبط بمحضر)' : ''}</span><b>${amount(draft.previousAppliedMinor)}</b></div>
          <div><span>فترة التوكيل</span><b>${amount(draft.periodDueMinor)}</b>${draft.periodsEquation ? `<small class="muted">${esc(draft.periodsEquation)}</small>` : ''}</div>
          <div><span>مصروفات مختارة</span><b>${amount(draft.expensesMinor)}</b></div>
          ${manual ? `<div><span>رسوم + دمغة (يدوي)</span><b>${amount(manual)}</b></div>` : ''}
          <div class="total"><span>إجمالي التوكيل</span><b>${amount(draft.totalMinor)}</b></div>
        </div>
        ${draft.previousSource ? `<p class="hint hint-info small">الرصيد السابق ${amount(draft.previousAppliedMinor)} — ${esc(draft.previousSource.label)}. وهو جزء من المتبقي ولا يُضاف عليه مرة ثانية.</p>` : ''}
        ${(draft.feesMinor || draft.stampsMinor) ? `<p class="muted small">رسوم ${amount(draft.feesMinor || 0)} · دمغة ${amount(draft.stampsMinor || 0)} — إدخال يدوي من المكتب، ولا تزيدان أصل الدين.</p>` : ''}
        ${(draft.runningPeriods?.length) ? `<p class="hint hint-warning small"><b>${draft.runningPeriods.length} فترة لم تنتهِ بعد</b> ظاهرة بمبلغها المتوقع <b>ولا تدخل في الإجمالي</b>: ${draft.runningPeriods.map(row => `${esc(row.label || `${displayDate(row.fromDate)} – ${displayDate(row.toDate)}`)} = ${amount(row.projectedMinor || 0)}`).join(' · ')} — لإدراجها كاملةً فعّل «إدراج الفترات التي لم تنتهِ بعد» (قرار صريح).</p>` : ''}
        ${draft.runningIncluded?.length ? `<p class="hint hint-info small">أُدرجت بقرار صريح ${draft.runningIncluded.length} فترة لم تنتهِ بعد (تقديري) بمبلغ ${amount(draft.runningIncluded.reduce((sum, row) => sum + row.amountMinor, 0))}.</p>` : ''}
        ${draft.horizonCapped ? `<p class="hint hint-warning small">⚠ ${esc(draft.horizonNote || '')}</p>` : ''}
        ${draft.estimateNote && !draft.horizonCapped ? `<p class="hint hint-info small">ⓘ ${esc(draft.estimateNote)}</p>` : ''}
        ${linesHtml}${scenarioHtml}<p class="muted small">${esc(draft.equations.join(' — '))}</p>
        <p class="muted small">إصدار التوكيل لا يغيّر المتبقي: ${amount(draft.periodRemainingMinor)} متبقٍ داخل الفترة.</p>`;
      previewHost.querySelectorAll('[data-poa-choice]').forEach(select => select.addEventListener('change', () => {
        const wrap = select.closest('[data-range-poa]').querySelector('[data-poa-manual]');
        const amountInput = wrap.querySelector('[data-poa-amount]');
        wrap.hidden = select.value !== 'MANUAL';
        amountInput.required = select.value === 'MANUAL';
      }));
    } catch (error) { previewHost.innerHTML = `<span class="muted small">${esc(userError(error))}</span>`; }
  };
  // اختيار نهاية مستقبلية = طلب صريح، مثله مثل نافذة «احسب مدة»: نفعّل خيار
  // النطاق المستقبلي تلقائيًا حتى لا يُقصّ النطاق إلى اليوم بلا إعلان، ويبقى
  // بإمكان المستخدم إلغاؤه صراحةً فيُعلن التاريخ الفعلي بدل رقم منسوب لغيره.
  const futureBox = form.querySelector('[data-poa-future]');
  const futureHint = form.querySelector('[data-poa-future-hint]');
  const syncFuture = ({autoCheck = false} = {}) => {
    const to = form.querySelector('[name="toDate"]')?.value || '';
    if (autoCheck && to > localDate() && futureBox && !futureBox.checked) futureBox.checked = true;
    if (futureHint) futureHint.innerHTML = to && to > localDate() && !futureBox?.checked
      ? 'تاريخ النهاية بعد اليوم والخيار غير مفعَّل: سيتوقف الحساب عند اليوم ويظهر التاريخ الفعلي صراحةً بدل رقم منسوب لتاريخ آخر.'
      : 'إن كان تاريخ النهاية بعد اليوم فسيُفعَّل هذا الخيار تلقائيًا: النظام ينفّذ النطاق الذي اخترته ويعلّم الفترات القادمة بأنها <b>تقديرية</b> — بلا قصّ صامت إلى اليوم.';
  };
  form.addEventListener('change', event => {
    if (event.target.closest('[data-range-poa]')) return;
    if (event.target?.name === 'toDate') syncFuture({autoCheck: true});
    render().catch(() => {});
  });
  form.addEventListener('input', event => {
    if (event.target.closest('[data-range-poa]')) return;
    render().catch(() => {});
  });
  await render();
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const save = form.querySelector('[data-save]');
    save.disabled = true;
    try {
      let {draft, values} = await currentDraft();
      if (draft.partials?.length) {
        const controls = [...previewHost.querySelectorAll('[data-range-poa]')];
        const decisions = controls.map(host => {
          const choice = host.querySelector('[data-poa-choice]')?.value || '';
          const amountMinor = choice === 'MANUAL' ? toMinorUnits(host.querySelector('[data-poa-amount]')?.value || '', draft.currency) : null;
          return {periodKey: host.dataset.periodKey, kind: host.dataset.kind, itemId: host.dataset.itemId, anchorDate: host.dataset.anchorDate,
            k: Number(host.dataset.k), fromDate: host.dataset.fromDate, toDate: host.dataset.toDate, choice,
            reason: host.querySelector('[data-poa-reason]')?.value || '', ...(choice === 'MANUAL' ? {amountMinor} : {})};
        });
        if (decisions.some(row => !row.choice)) throw new Error('اختر قرارًا صريحًا لكل فترة حدّية قبل إصدار التوكيل.');
        const saved = await S.recordSimpleDurationDecisions(app.office, executionId, {fromDate: values.fromDate, toDate: values.toDate, decisions});
        activeRangeDecisions = saved.decisions;
        ({draft, values} = await currentDraft());
        if (draft.partials?.length) throw new Error('بقيت فترة حدّية بلا قرار صالح؛ لم يُحفظ التوكيل.');
      }
      await S.saveSimplePoa(app.office, executionId, {...draft, poaNumber: values.poaNumber}, {date: values.date, printNow: true});
      closeModal();
      toast('حُفظ التوكيل كنسخة غير قابلة للتعديل وفُتح للطباعة', 'ok');
      document.dispatchEvent(new CustomEvent('exec:record-saved', {detail: {}}));
      await app.refresh();
    } catch (error) { toast(userError(error), 'error'); save.disabled = false; }
  });
  form.querySelector('[data-print-only]').addEventListener('click', async () => {
    try {
      const {draft, values} = await currentDraft();
      if (draft.partials?.length) throw new Error('احسم حدود الفترات قبل طباعة هذا النطاق.');
      await S.printSimpleStatement(app.office, executionId, {mode: 'range', fromDate: values.fromDate, toDate: values.toDate, rangeDecisions: activeRangeDecisions, allowFuture: flag(values.allowFuture)});
      void draft;
    } catch (error) { toast(userError(error), 'error'); }
  });
  return card;
}

export async function statementDialog(app, executionId) {
  const card = modal(`<h2 class="modal-title">🖨 كشف حساب / طباعة</h2>
    <form class="simple-form" data-form="statement">
      <div class="form-grid">
        <label class="field">نوع الكشف
          <select name="mode">
            <option value="summary">ملخص</option>
            <option value="monthly" selected>تفصيلي شهري</option>
            <option value="range">عن مدة معينة</option>
          </select>
        </label>
        <label class="field">من (للمدة)<input name="fromDate" type="date" value="${esc(`${localDate().slice(0, 4)}-01-01`)}"></label>
        <label class="field">إلى (للمدة)<input name="toDate" type="date" value="${esc(localDate())}"></label>
        <label class="field">تاريخ الحساب<input name="asOf" type="date" value="${esc(localDate())}"></label>
      </div>
      <div class="form-actions">
        <button type="submit" class="primary">طباعة</button>
        <button type="button" class="ghost" data-close>إلغاء</button>
      </div>
    </form>`);
  card.querySelector('[data-form="statement"]').addEventListener('submit', async event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.target).entries());
    try {
      await S.printSimpleStatement(app.office, executionId, {mode: values.mode, fromDate: values.fromDate, toDate: values.toDate, asOf: values.asOf, allowFuture: isCivilDate(values.asOf) && values.asOf > localDate()});
      toast('فُتح الكشف للطباعة');
    } catch (error) { toast(userError(error), 'error'); }
  });
  return card;
}

/* ================== إكمال بيانات القيمة (شريط لطيف) ================== */
/** «حدّد الدورية وتاريخ السريان لتظهر الحسابات» — يفتح نموذج القيمة مباشرة. */
export async function valueSetupDialog(app, executionId, {bundle = null} = {}) {
  const data = bundle || await S.simpleCardBundle(app.office, executionId);
  const settings = data.settings || executionSettings(app.office);
  const lastJudgment = data.judgments.slice().sort((a, b) => Number(a.sequence || 0) - Number(b.sequence || 0)).at(-1) || null;
  const activeSlice = data.slices.filter(slice => !['cancelled', 'superseded'].includes(String(slice.status || ''))).at(-1) || null;
  const editingJudgment = Boolean(inputValue(lastJudgment?.amount)) && !activeSlice;
  const card = modal(`<h2 class="modal-title">قيمة النفقة</h2>
    <p class="muted small">أدخل القيمة والدورية وتاريخ السريان — يُبنى الجدول الشهري فورًا بلا أي خطوة إضافية.</p>
    <form class="simple-form" data-form="value">
      <div class="form-grid">
        <label class="field">البند
          <input name="entitlementType" list="ent-types2" value="${esc(activeSlice?.entitlementType || lastJudgment?.entitlementType || 'نفقة صغار')}">
          <datalist id="ent-types2">${entitlementOptions(settings).map(item => `<option value="${esc(item)}"></option>`).join('')}</datalist>
        </label>
        <label class="field">القيمة (ج.م) <b class="req">*</b>
          <input name="amount" inputmode="decimal" value="${esc(lastJudgment?.amount || '')}" autofocus>
        </label>
        <label class="field">النوع
          <select name="valueType"><option value="periodic" selected>دوري</option><option value="fixed">مبلغ مقطوع</option></select>
        </label>
        <label class="field">الدورية
          <select name="periodicity"><option value="monthly" selected>شهري</option><option value="weekly">أسبوعي</option><option value="semiMonthly">نصف شهري</option><option value="yearly">سنوي</option></select>
        </label>
        <label class="field">يسري من <b class="req">*</b>
          <input name="effectiveFrom" type="date" value="${esc(lastJudgment?.effectiveFrom || activeSlice?.startDate || localDate())}">
        </label>
        <label class="field">ينتهي في (اختياري)<input name="effectiveTo" type="date" value="${esc(lastJudgment?.effectiveTo || activeSlice?.endDate || '')}"></label>
      </div>
      <div class="form-actions">
        <button type="submit" class="primary" data-save>حفظ وبناء الجدول</button>
        <button type="button" class="ghost" data-close>إلغاء</button>
      </div>
    </form>`);
  const form = card.querySelector('[data-form="value"]');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form).entries());
    const save = form.querySelector('[data-save]');
    save.disabled = true;
    const finish = async () => { closeModal(); toast('تم بناء الجدول الشهري', 'ok'); document.dispatchEvent(new CustomEvent('exec:record-saved', {detail: {}})); await app.refresh(); };
    try {
      if (editingJudgment) {
        const {updateExecutionJudgment, saveValueSlice} = await import('../services/execution.js');
        await updateExecutionJudgment(app.office, lastJudgment.id, {
          entitlementType: values.entitlementType, amount: values.amount, valueType: values.valueType,
          periodicity: values.valueType === 'fixed' ? 'fixed' : values.periodicity,
          effectiveFrom: values.effectiveFrom, effectiveTo: values.effectiveTo || ''
        });
        await saveValueSlice(app.office, {
          executionId, judgmentId: lastJudgment.id, entitlementType: values.entitlementType, valueType: values.valueType,
          periodicity: values.valueType === 'fixed' ? 'fixed' : values.periodicity, amount: values.amount,
          startDate: values.effectiveFrom, endDate: values.effectiveTo || '', sourceReference: 'قيمة الحكم'
        });
        await finish();
      } else {
        const out = await S.recordSubsequentJudgment(app.office, {
          executionId, entitlementType: values.entitlementType, amount: values.amount, effectiveFrom: values.effectiveFrom,
          effectiveTo: values.effectiveTo, judgmentNumber: lastJudgment?.judgmentNumber || '', court: lastJudgment?.court || '',
          confirmedDecrease: true, notes: 'بند قيمة جديد'
        });
        void out;
        await finish();
      }
    } catch (error) { toast(userError(error), 'error'); save.disabled = false; }
  });
  return card;
}

const inputValue = value => (value === undefined || value === null ? '' : String(value));

/* ================== إعدادات التنفيذ: تعديل يدوي كامل وواضح ==================
   كل خيار هنا يقود حسابًا حقيقيًا أو قائمة حقيقية في مركز التنفيذ:
   لا خيار معروض بلا أثر. الكتابة تمر عبر services/execution-settings.js
   ثم تُبطل ذاكرة الحساب فورًا فتتغير الأرقام بلا إعادة تحميل. */

/** قارئ قوائم نصية (سطر لكل عنصر) مع تحقق عربي واضح. */
function readListLines(value, {label, required = true} = {}) {
  const rows = String(value || '').split(/\r?\n/).map(row => row.trim()).filter(Boolean);
  if (required && !rows.length) throw new Error(`«${label}» لا يمكن أن تكون فارغة — اكتب عنصرًا واحدًا على الأقل.`);
  const unique = [...new Set(rows)];
  if (unique.length !== rows.length) throw new Error(`«${label}» فيها عنصر مكرر — أزل التكرار.`);
  return unique;
}

/** قارئ أزواج «الكود=الاسم» مع تحقق الكود (بلا مسافات ولا تكرار). */
function readCodePairs(value, {label} = {}) {
  const rows = String(value || '').split(/\r?\n/).map(row => row.trim()).filter(Boolean);
  if (!rows.length) throw new Error(`«${label}» لا يمكن أن تكون فارغة — اكتب «الكود=الاسم» في سطر.`);
  const seen = new Set();
  return rows.map(row => {
    const index = row.indexOf('=');
    const code = (index >= 0 ? row.slice(0, index) : row).trim();
    const name = (index >= 0 ? row.slice(index + 1) : row).trim() || code;
    if (!code) throw new Error(`«${label}»: سطر بلا كود — اكتب «الكود=الاسم».`);
    if (/\s/.test(code)) throw new Error(`«${label}»: الكود «${code}» لا يقبل مسافات.`);
    if (seen.has(code)) throw new Error(`«${label}»: الكود «${code}» مكرر — لكل عنصر كود واحد.`);
    seen.add(code);
    return [code, name];
  });
}

const CURRENCY_CHOICES = Object.freeze([['EGP', 'جنيه مصري (ج.م)'], ['USD', 'دولار أمريكي'], ['EUR', 'يورو'], ['GBP', 'جنيه إسترليني'], ['SAR', 'ريال سعودي'], ['AED', 'درهم إماراتي'], ['KWD', 'دينار كويتي'], ['JOD', 'دينار أردني']]);

/** وصف مختصر لأثر كل قاعدة — بلغة غير تقنية. */
const RULE_HINTS = Object.freeze({
  accrualTiming: '«من بداية الفترة» يظهر المطلوب من أول يوم في الفترة الجارية، و«بعد اكتمال الفترة» لا يحتسبها إلا بعد انتهائها. في الحالتين تبقى الفترة الجارية ظاهرة بمبلغها المتوقع.',
  periodBasis: '«من يوم الارتكاز إلى ما قبل يومه التالي» يعني: تنفيذ يبدأ 05/10/2026 تكون فترته الأولى 05/10/2026 → 04/11/2026. و«شهر تقويمي كامل» يعني 01/10/2026 → 31/10/2026.',
  startPolicy: 'ما يحدث إن وقع تاريخ السريان في منتصف فترة: السؤال، أو احتساب الفترة كاملة، أو استبعادها، أو مبلغ كامل يدوي — بلا تناسب بالأيام.',
  midChangePolicy: 'ما يحدث إن بدأ حكم لاحق (زيادة/تخفيض) في منتصف فترة: إبقاء القيمة القديمة، أو استخدام الجديدة، أو مبلغ يدوي كامل.',
  endPolicy: 'ما يحدث إن وقعت نهاية الحكم في منتصف فترة: احتساب الفترة كاملة، أو استبعادها، أو مبلغ يدوي كامل.',
  allocationOrder: 'ترتيب توزيع أي تحصيل على الفترات المستحقة: الأقدم أولًا (الافتراضي)، أو الأحدث فالأقدم، أو تناسبيًا.',
  defaultCurrency: 'العملة المستخدمة لأي سجل لم تُسجَّل له عملة صريحة. لا تُحوّل النظام ولا تُبدّل أرقامًا مسجَّلة.',
  monthEndPolicy: 'قصّ يوم الارتكاز في نهاية الشهر إلى آخر يوم متاح ثم يعود إلى يومه الأصلي في الأشهر التي تسمح به — فلا انجراف. وهو الخيار الوحيد المتاح في المحرك حاليًا.',
  asOfScope: '«لكل تنفيذ على حدة» يبقي تاريخ كل بطاقة محفوظًا لها وحدها. «موحّد» يجعل تاريخًا واحدًا افتراضيًا لكل البطاقات — ولا يخفي أرقام أي بطاقة لها تاريخها الخاص.'
});

export function executionSettingsDialog(app) {
  const settings = executionSettings(app.office);
  const schedule = settings.schedule;
  const lists = settings.lists;
  const history = [...(settings.ruleHistory || [])].reverse();
  const scope = prefs.get(ASOF_SCOPE_KEY, 'per-execution') === 'global' ? 'global' : 'per-execution';
  const pairsText = rows => (rows || []).map(row => (Array.isArray(row) ? `${row[0]}=${row[1]}` : String(row))).join('\n');
  const card = modal(`<h2 class="modal-title">⚙ إعدادات مركز التنفيذ</h2>
    <p class="muted small">كل خيار هنا يعدّله المكتب بنفسه ويُحفظ فورًا في نسخة قواعد مؤرخة: لا رسم ولا دمغة ولا مدة مفروضة في الكود. النسخة الحالية <b>${esc(String(settings.ruleVersion))}</b> · المحرك <b>${esc(String(settings.engineVersion))}</b> · سارية من <b>${esc(displayDate(settings.effectiveFrom) )}</b> · المصدر: ${esc(settings.source || '—')}</p>
    <form class="simple-form" data-form="settings">
      <p class="error-line" data-settings-error role="alert" hidden></p>

      <fieldset><legend>قواعد الفترة والاستحقاق (ممارسة المكتب المؤرخة — ليست قاعدة قانونية مفروضة)</legend>
        <div class="form-grid">
          <label class="field">توقيت الاستحقاق
            <select name="accrualTiming">
              <option value="AT_PERIOD_START"${schedule.accrualTiming === 'AT_PERIOD_START' ? ' selected' : ''}>من بداية الفترة (تُستحق مقدَّمًا)</option>
              <option value="AFTER_PERIOD_END"${schedule.accrualTiming === 'AT_PERIOD_START' ? '' : ' selected'}>بعد اكتمال الفترة</option>
            </select>
          </label>
          <label class="field">أساس الفترة الشهرية
            <select name="periodBasis">
              <option value="ANNIVERSARY"${schedule.periodBasis === 'ANNIVERSARY' ? ' selected' : ''}>من يوم الارتكاز إلى ما قبل يوم الارتكاز التالي</option>
              <option value="CALENDAR_MONTH"${schedule.periodBasis === 'CALENDAR_MONTH' ? ' selected' : ''}>شهر تقويمي كامل</option>
            </select>
          </label>
          <label class="field">البداية داخل فترة ناقصة
            <select name="startPolicy">
              <option value="ASK"${schedule.startPolicy === 'ASK' ? ' selected' : ''}>اسأل المستخدم</option>
              <option value="INCLUDE_FULL"${schedule.startPolicy === 'INCLUDE_FULL' ? ' selected' : ''}>احتساب الفترة كاملة</option>
              <option value="EXCLUDE"${schedule.startPolicy === 'EXCLUDE' ? ' selected' : ''}>استبعاد الفترة</option>
              <option value="MANUAL"${schedule.startPolicy === 'MANUAL' ? ' selected' : ''}>مبلغ يدوي للفترة</option>
            </select>
          </label>
          <label class="field">تغيّر القيمة منتصف الفترة
            <select name="midChangePolicy">
              <option value="ASK"${schedule.midChangePolicy === 'ASK' ? ' selected' : ''}>اسأل المستخدم</option>
              <option value="KEEP_OLD_VALUE"${schedule.midChangePolicy === 'KEEP_OLD_VALUE' ? ' selected' : ''}>القيمة القديمة للفترة كاملة</option>
              <option value="USE_NEW_VALUE"${schedule.midChangePolicy === 'USE_NEW_VALUE' ? ' selected' : ''}>القيمة الجديدة للفترة كاملة</option>
              <option value="MANUAL"${schedule.midChangePolicy === 'MANUAL' ? ' selected' : ''}>مبلغ يدوي للفترة</option>
            </select>
          </label>
          <label class="field">نهاية الحكم منتصف الفترة
            <select name="endPolicy">
              <option value="ASK"${schedule.endPolicy === 'ASK' ? ' selected' : ''}>اسأل المستخدم</option>
              <option value="INCLUDE_FULL"${schedule.endPolicy === 'INCLUDE_FULL' ? ' selected' : ''}>احتساب الفترة كاملة</option>
              <option value="EXCLUDE"${schedule.endPolicy === 'EXCLUDE' ? ' selected' : ''}>استبعاد الفترة</option>
              <option value="MANUAL"${schedule.endPolicy === 'MANUAL' ? ' selected' : ''}>مبلغ يدوي للفترة</option>
            </select>
          </label>
        </div>
        <p class="hint hint-info small">${esc(RULE_HINTS.accrualTiming)}</p>
        <p class="hint hint-info small">${esc(RULE_HINTS.periodBasis)}</p>
        <p class="muted small">${esc(RULE_HINTS.startPolicy)}</p>
        <p class="muted small">${esc(RULE_HINTS.midChangePolicy)}</p>
        <p class="muted small">${esc(RULE_HINTS.endPolicy)}</p>
        <p class="muted small">قصّ يوم الارتكاز في نهاية الشهر: ${esc(RULE_HINTS.monthEndPolicy)}</p>
        <p class="muted small">الدقة النقدية: الحساب بالوحدات الصغرى الصحيحة (القروش) بلا تقريب ولا تناسب بالأيام.</p>
      </fieldset>

      <fieldset><legend>التوزيع والعملة</legend>
        <div class="form-grid">
          <label class="field">ترتيب تخصيص التحصيلات
            <select name="allocationOrder">
              <option value="fifo"${schedule.allocationOrder === 'fifo' ? ' selected' : ''}>الأقدم أولًا</option>
              <option value="lifo"${schedule.allocationOrder === 'lifo' ? ' selected' : ''}>الأحدث فالأقدم</option>
              <option value="proportional"${schedule.allocationOrder === 'proportional' ? ' selected' : ''}>تناسبي</option>
            </select>
          </label>
          <label class="field">العملة الافتراضية
            <select name="defaultCurrency">
              ${CURRENCY_CHOICES.map(([code, label]) => `<option value="${esc(code)}"${String(schedule.defaultCurrency || 'EGP').toUpperCase() === code ? ' selected' : ''}>${esc(label)}</option>`).join('')}
            </select>
          </label>
        </div>
        <p class="muted small">${esc(RULE_HINTS.allocationOrder)} ${esc(RULE_HINTS.defaultCurrency)}</p>
      </fieldset>

      <fieldset><legend>القوائم القابلة للتعديل (سطر لكل عنصر)</legend>
        <label class="field span2">البنود (نفقة صغار، أجرة حضانة…) <textarea name="entitlementTypes" rows="3">${esc((lists.entitlementTypes || []).join('\n'))}</textarea></label>
        <label class="field span2">طرق التنفيذ <textarea name="executionMethods" rows="2">${esc((lists.executionMethods || []).join('\n'))}</textarea></label>
        <label class="field span2">طرق التحصيل <textarea name="collectionMethods" rows="2">${esc((lists.collectionMethods || []).join('\n'))}</textarea></label>
        <label class="field span2">أنواع الإجراءات (كود=الاسم) <textarea name="actionKinds" rows="4">${esc(pairsText(lists.actionKinds))}</textarea></label>
        <label class="field span2">أنواع المصروفات والرسوم (كود=الاسم) <textarea name="expenseTypes" rows="3">${esc(pairsText(lists.expenseTypes))}</textarea></label>
        <label class="field span2">على مَن يتحمّل المصروف (كود=الاسم) <textarea name="borneBy" rows="3">${esc(pairsText(lists.borneBy))}</textarea></label>
        <label class="field span2">أنواع الأحكام اللاحقة (كود=الاسم) <textarea name="laterJudgmentKinds" rows="3">${esc(pairsText(lists.laterJudgmentKinds))}</textarea></label>
        <p class="muted small">تُستخدم هذه القوائم في نماذج التسجيل فورًا بعد الحفظ. «الكود» معرّف داخلي ثابت لا يتغير بعد الاستخدام، و«الاسم» هو ما يظهر للمستخدم.</p>
      </fieldset>

      <fieldset><legend>تاريخ الحساب «المطلوب حتى» (لكل بطاقة أم موحّد)</legend>
        <label class="check-line"><input type="radio" name="asOfScope" value="per-execution"${scope !== 'global' ? ' checked' : ''}> لكل تنفيذ على حدة (افتراضي) — تغيير تاريخ بطاقة لا يمسّ غيرها</label>
        <label class="check-line"><input type="radio" name="asOfScope" value="global"${scope === 'global' ? ' checked' : ''}> موحّد لكل التنفيذات (تاريخ واحد افتراضي)</label>
        <p class="muted small">${esc(RULE_HINTS.asOfScope)}</p>
        <div class="form-actions">
          <button type="button" class="ghost small" data-asof-reset-all>↺ ارجع بكل البطاقات إلى اليوم</button>
        </div>
      </fieldset>

      <fieldset><legend>قوالب الطباعة (التوكيل وكشف الرصيد)</legend>
        <p class="muted small">نص القالب بمتغيّرات تُملأ من السجل: {{client.name}} · {{execution.number}} · {{poa.fromDate}} · {{totals.total}} …</p>
        <div class="form-actions"><button type="button" class="ghost" data-templates>✎ تعديل قوالب الطباعة…</button></div>
      </fieldset>

      ${history.length > 1 ? `<details><summary>نسخ القواعد المحفوظة (${history.length}) — كل تعديل يحفظ نسخة مؤرخة</summary>
        <div class="exec-table-wrap"><table class="mini-table"><thead><tr><th>النسخة</th><th>سارية من</th><th>المصدر</th><th>توقيت الاستحقاق</th><th>أساس الفترة</th><th>التوزيع</th></tr></thead><tbody>
          ${history.map(row => `<tr><td>${esc(String(row.version || ''))}</td><td>${esc(displayDate(row.effectiveFrom))}</td><td>${esc(row.source || '—')}</td><td>${esc(row.rules?.accrualTiming || '—')}</td><td>${esc(row.rules?.periodBasis || '—')}</td><td>${esc(row.rules?.allocationOrder || '—')}</td></tr>`).join('')}
        </tbody></table></div></details>` : ''}

      <div class="form-actions">
        <button type="submit" class="primary" data-save>حفظ الإعدادات</button>
        <button type="button" class="ghost" data-migration-report>تقرير الترحيل (قبل/بعد)</button>
        <button type="button" class="ghost" data-reset>استعادة الافتراضي</button>
        <button type="button" class="ghost" data-close>إغلاق</button>
      </div>
    </form>`);
  const form = card.querySelector('[data-form="settings"]');
  const errorBox = form.querySelector('[data-settings-error]');
  const showError = message => {
    errorBox.hidden = !message;
    errorBox.textContent = message || '';
    if (message) errorBox.scrollIntoView?.({block: 'center'});
  };
  /** تشغيل عملية حفظ بزر معطَّل ونص «جارٍ الحفظ…» ثم إعادة التمكين دائمًا. */
  const withBusy = async (button, busyLabel, task) => {
    const label = button.textContent;
    button.disabled = true;
    button.textContent = busyLabel;
    showError('');
    try { return await task(); }
    finally { button.disabled = false; button.textContent = label; }
  };

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const save = form.querySelector('[data-save]');
    const values = Object.fromEntries(new FormData(form).entries());
    // 1) التحقق أولًا: لا يُحفظ نصف إعداد صامتًا.
    let patch;
    try {
      patch = {
        source: 'تعديل يدوي من واجهة إعدادات مركز التنفيذ',
        schedule: {
          ...schedule,
          periodBasis: values.periodBasis, startPolicy: values.startPolicy,
          midChangePolicy: values.midChangePolicy, endPolicy: values.endPolicy,
          accrualTiming: values.accrualTiming, allocationOrder: values.allocationOrder,
          defaultCurrency: String(values.defaultCurrency || 'EGP').toUpperCase()
        },
        lists: {
          ...lists,
          entitlementTypes: readListLines(values.entitlementTypes, {label: 'البنود'}),
          executionMethods: readListLines(values.executionMethods, {label: 'طرق التنفيذ'}),
          collectionMethods: readListLines(values.collectionMethods, {label: 'طرق التحصيل'}),
          actionKinds: readCodePairs(values.actionKinds, {label: 'أنواع الإجراءات'}),
          expenseTypes: readCodePairs(values.expenseTypes, {label: 'أنواع المصروفات والرسوم'}),
          borneBy: readCodePairs(values.borneBy, {label: 'على مَن يتحمّل المصروف'}),
          laterJudgmentKinds: readCodePairs(values.laterJudgmentKinds, {label: 'أنواع الأحكام اللاحقة'})
        }
      };
    } catch (error) {
      showError(userError(error));
      toast('راجع الإعدادات: توجد قيمة غير صحيحة', 'error');
      return;
    }
    // 2) الحفظ: أي فشل يبقى ظاهرًا في النافذة ولا يُغلقها (BUG-5).
    await withBusy(save, 'جارٍ الحفظ…', async () => {
      try {
        const next = await saveExecutionSettings(app.office, patch);
        const changed = Number(next.ruleVersion) > Number(settings.ruleVersion);
        toast(changed
          ? `حُفظت الإعدادات — نسخة القواعد ${next.ruleVersion}، وستتغير الأرقام فورًا`
          : 'حُفظت الإعدادات', 'ok');
        closeModal();
        await app.refresh();
      } catch (error) {
        showError(userError(error));
        toast(userError(error), 'error');
      }
    });
  });

  // نطاق تاريخ الحساب: يُحفظ فور التغيير (لا يمس أرقام البطاقات ذات التاريخ الخاص).
  form.querySelectorAll('[name="asOfScope"]').forEach(input => input.addEventListener('change', async () => {
    try {
      await prefs.set(ASOF_SCOPE_KEY, input.value === 'global' ? 'global' : 'per-execution');
      toast(input.value === 'global' ? 'صار تاريخ الحساب موحّدًا لكل التنفيذات' : 'صار تاريخ الحساب لكل تنفيذ على حدة');
      await app.refresh();
    } catch (error) { showError(userError(error)); }
  }));
  form.querySelector('[data-asof-reset-all]')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    if (!await confirmBox('إرجاع «المطلوب حتى» إلى اليوم في كل البطاقات؟ لا يُحذف أي رقم مسجَّل — الحساب وحده يعود إلى اليوم.', {okText: 'إرجاع الكل إلى اليوم'})) return;
    await withBusy(button, 'جارٍ الإرجاع…', async () => {
      try {
        await prefs.set(ASOF_KEY, '');
        const page = await app.office.r.execution.page({index: 'openedDate', direction: 'prev', limit: 300}).catch(() => ({items: []}));
        for (const row of page.items || []) await prefs.set(asOfKeyFor(row.id), '');
        toast('أُعيدت كل البطاقات إلى «المطلوب حتى اليوم»');
        await app.refresh();
      } catch (error) { showError(userError(error)); toast(userError(error), 'error'); }
    });
  });

  form.querySelector('[data-templates]')?.addEventListener('click', () => { executionTemplatesDialog(app); });
  form.querySelector('[data-migration-report]')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    await withBusy(button, 'جارٍ الفحص…', async () => {
      try {
        const {migrateSimpleExecutionData} = S;
        const {fromMinorUnits: toMoney} = await import('../domain/execution-money.js');
        const report = await migrateSimpleExecutionData(app.office);
        const rows = (report.report || []).slice(0, 60);
        modal(`<h2 class="modal-title">تقرير الترحيل — قبل/بعد لكل تنفيذ</h2>
          <p class="muted small">الترحيل لا يحوّل ولا يحذف: مسار FEAS القديم يبقى كما هو، والقيم المعروضة مشتقة من الجدول الجديد. فُحص ${report.scanned} تنفيذ، ويحتاج إكمال بيانات: ${report.withIssues}${report.hasMore ? ' (توجد صفحات أخرى تُستكمل تلقائيًا)' : ''}.</p>
          <div class="exec-table-wrap"><table class="exec-table"><thead><tr><th>التنفيذ</th><th>قبل (شرائح/محاضر/تخصيصات/دفتر)</th><th>بعد (مستحق/مدفوع/متبقٍ)</th><th>ملاحظات</th></tr></thead><tbody>
            ${rows.map(item => `<tr><td>${esc(item.internalNumber || item.executionId)}</td><td>${item.before.slices} / ${item.before.receipts} / ${item.before.allocations} / ${item.before.ledger}</td><td>${toMoney(item.after.due, 'EGP').toLocaleString('en-US', {minimumFractionDigits: 2})} / ${toMoney(item.after.paid, 'EGP').toLocaleString('en-US', {minimumFractionDigits: 2})} / ${toMoney(item.after.remaining, 'EGP').toLocaleString('en-US', {minimumFractionDigits: 2})}</td><td>${item.incomplete.length ? esc(item.incomplete.map(row => row.label).join(' · ')) : '—'}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">لا تنفيذات بعد.</td></tr>'}
          </tbody></table></div>
          <div class="form-actions"><button type="button" class="ghost" data-close data-back-settings>رجوع إلى الإعدادات</button></div>`)
          .querySelector('[data-back-settings]')?.addEventListener('click', () => { executionSettingsDialog(app); });
      } catch (error) {
        showError(userError(error));
        toast(userError(error), 'error');
      }
    });
  });

  form.querySelector('[data-reset]')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    const answer = await confirmBox('استعادة الإعدادات الافتراضية لمركز التنفيذ؟ القوالب والقوائم المخصصة ستعود إلى الافتراضي، وتُحفظ نسخة القواعد الحالية في السجل قبل ذلك.', {okText: 'استعادة الافتراضي'});
    if (!answer) return;
    await withBusy(button, 'جارٍ الاستعادة…', async () => {
      try {
        await resetExecutionSettings(app.office);
        toast('أُعيدت الإعدادات الافتراضية وسُجّلت نسخة القواعد السابقة', 'ok');
        closeModal();
        await app.refresh();
      } catch (error) {
        showError(userError(error));
        toast(userError(error), 'error');
      }
    });
  });
  void RULE_HINTS.monthEndPolicy;
  return card;
}

/** تعديل قوالب الطباعة (التوكيل وكشف الرصيد) — نص حر بمتغيّرات، مع استعادة الافتراضي. */
export async function executionTemplatesDialog(app) {
  const PR = await import('../services/execution-print.js');
  const templates = await PR.templatesFor(app.office).catch(() => []);
  const rows = (templates.length ? templates : Object.entries(PR.DEFAULT_TEMPLATES).map(([kind, value]) => ({kind, ...value}))).slice(0, 20);
  const card = modal(`<h2 class="modal-title">✎ قوالب الطباعة</h2>
    <p class="muted small">عدّل نص القالب كما تريد. المتغيّرات بين {{ }} تُملأ من السجل، وأي متغيّر غير موجود يُطبع فارغًا — ولا يُطبع مبلغ غير مسجل.</p>
    <p class="error-line" data-template-error role="alert" hidden></p>
    <form class="simple-form" data-form="templates">
      <label class="field">القالب <select name="kind">${rows.map(row => `<option value="${esc(row.kind)}">${esc(row.title || row.kind)}</option>`).join('')}</select></label>
      <label class="field">عنوان المستند <input name="title" value="${esc(rows[0]?.title || '')}"></label>
      <label class="field">نص القالب <textarea name="body" rows="12">${esc(rows[0]?.body || '')}</textarea></label>
      <div class="form-actions">
        <button type="submit" class="primary" data-save>حفظ القالب</button>
        <button type="button" class="ghost" data-reset-template>استعادة القالب الافتراضي</button>
        <button type="button" class="ghost" data-close>إغلاق</button>
      </div>
    </form>`);
  const form = card.querySelector('[data-form="templates"]');
  const errorBox = form.querySelector('[data-template-error]');
  const showError = message => { errorBox.hidden = !message; errorBox.textContent = message || ''; };
  const fill = kind => {
    const row = rows.find(item => item.kind === kind) || rows[0] || {title: '', body: ''};
    form.querySelector('[name="title"]').value = row.title || '';
    form.querySelector('[name="body"]').value = row.body || '';
    showError('');
  };
  form.querySelector('[name="kind"]')?.addEventListener('change', event => fill(event.target.value));
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const save = form.querySelector('[data-save]');
    const values = Object.fromEntries(new FormData(form).entries());
    const label = save.textContent;
    save.disabled = true; save.textContent = 'جارٍ الحفظ…';
    try {
      if (!String(values.body || '').trim()) throw new Error('نص القالب مطلوب — لا يُحفظ قالب فارغ.');
      await PR.saveTemplate(app.office, {kind: values.kind, title: values.title, body: values.body});
      toast('حُفظ القالب — سيظهر في الطباعة القادمة');
      closeModal();
      await app.refresh();
    } catch (error) {
      showError(userError(error));
      toast(userError(error), 'error');
    } finally { save.disabled = false; save.textContent = label; }
  });
  form.querySelector('[data-reset-template]')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    if (!await confirmBox('استعادة نص هذا القالب إلى الافتراضي؟', {okText: 'استعادة'})) return;
    const label = button.textContent;
    button.disabled = true; button.textContent = 'جارٍ الاستعادة…';
    try {
      await PR.resetTemplate(app.office, values.kind);
      const fresh = await PR.templatesFor(app.office).catch(() => []);
      const row = fresh.find(item => item.kind === values.kind);
      if (row) { form.querySelector('[name="title"]').value = row.title || ''; form.querySelector('[name="body"]').value = row.body || ''; }
      toast('أُعيد القالب الافتراضي');
      await app.refresh();
    } catch (error) { showError(userError(error)); toast(userError(error), 'error'); }
    finally { button.disabled = false; button.textContent = label; }
  });
  return card;
}
/* ================== دليل الاستخدام (نُقل من الصفحة إلى مساعدة) ================== */
export function executionHelpDialog(app) {
  return modal(`<h2 class="modal-title">؟ مساعدة سريعة</h2>
    <div class="help-body">
      <p><b>1) تنفيذ جديد:</b> زر <code>+ تنفيذ جديد</code> — أدخل الموكل والمبلغ والنوع وتاريخ السريان، فيُبنى الجدول الشهري تلقائيًا.</p>
      <p><b>2) تسجيل ما تم:</b> زر <code>+ تسجيل</code> ثم اختر: تحصيل · إجراء · مصروف/رسم · حكم لاحق · توكيل · ملاحظة.</p>
      <p><b>3) قراءة الأرقام:</b> أعلى البطاقة ثلاثة أرقام: المطلوب حتى التاريخ المختار · المدفوع · المتبقي. كل رقم قابل للنقر ليعرض كيف حُسب.</p>
      <p><b>4) حساب مدة:</b> زر <code>🧮 احسب مدة</code> يختار المدة ويعرض المستحق والمدفوع والمتبقي عنها + الرصيد السابق.</p>
      <p><b>5) الطباعة:</b> تبويب «التوكيل والطباعة» للكشف أو التوكيل، وأرقام الصفحات وتاريخ الطباعة تلقائيًا.</p>
      <p><b>اختصارات:</b> <code>Ctrl+Shift+T</code> يفتح ورقة التسجيل في بطاقة التنفيذ · <code>Esc</code> يغلق النافذة · <code>Enter</code> يحفظ النموذج المفتوح.</p>
      <p><b>مثال بالأرقام:</b> نفقة 3,000 شهريًا من 01/01/2025 (12 شهرًا = 36,000) ← حكم لاحق بـ4,000 من 01/07/2025 (6 × 1,000 = 6,000 فرق) ← الإجمالي 42,000 ← تحصيل 9,000 ← المتبقي 33,000. أنت تسجّل فقط: الحكم والتحصيل والمصروف، والباقي حساب تلقائي.</p>
      <p><b>المثال التجريبي:</b> زر <code>🧪 مثال عملي جاهز</code> في مركز التنفيذ يبني هذا المثال كاملًا (حكم وحكم لاحق وتحصيل ومصروف وتوكيل) في ملف واحد — إضافة بحتة لا تمس بياناتك.</p>
      <p class="muted small">الحساب يعمل في الخلفية بالأرقام الصحيحة بالقروش، وكل تعديل يُحفظ له تاريخ ومن قام به، والإلغاء يستبدل الحذف.</p>
    </div>
    <div class="form-actions">
      <button type="button" class="primary" data-demo-seed>📥 تحميل مثال تجريبي</button>
      <button type="button" class="ghost" data-close>إغلاق</button>
    </div>`);
}

export {money, displayDate, executionTypeLabel, EXECUTION_TYPE_LABELS, PERIOD_STATUS, formatFileNumber, borneByLabelOf};
