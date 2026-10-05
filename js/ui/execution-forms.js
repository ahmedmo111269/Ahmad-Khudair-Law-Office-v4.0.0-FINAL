// =====================================================================
// نوافذ إجراءات التنفيذ — كل نافذة تستدعي خدمة تطبيقية ولا تكتب شيئًا بنفسها.
// القاعدة: لا كتابة مالية مباشرة، وكل تصحيح مالي يمر عبر عكس/تصحيح موثق.
// =====================================================================
import {esc, formData} from '../ui/dom.js';
import {modal, closeModal, confirmBox} from '../ui/modal.js';
import {toast} from '../ui/toast.js';
import {userError} from '../core/errors.js';
import {localDate, Clock} from '../core/clock.js';
import {formatFileNumber} from '../core/file-number.js';
import {money, round2, num, ALLOCATION_METHODS, ALLOCATION_METHOD_LABELS, EXPENSE_TYPES, LEDGER_TYPE_LABELS, LEDGER_TYPES, POA_STATUS_LABELS, DIFFERENCE_STATUS_LABELS, ACTION_KINDS, ACTION_KIND_LABELS, PERIODICITIES, PERIODICITY_LABELS, VALUE_TYPES, VALUE_TYPE_LABELS, EXECUTION_METHODS, EXECUTION_METHOD_LABELS, EXECUTION_STATUSES, EXECUTION_STATUS_LABELS, EXECUTION_TYPES, EXECUTION_TYPE_LABELS} from '../domain/execution.js';
import {FEAS_MODEL, FEAS_FREQUENCIES, FEAS_PERIOD_BASES, FEAS_PERIOD_START_POLICIES, FEAS_MID_CHANGE_POLICIES, FEAS_END_POLICIES, FEAS_ACCRUAL_TIMINGS, FEAS_MONTH_END_POLICIES} from '../domain/execution-feas.js';
import {currencyFractionDigits, fromMinorUnits, sumMinor, toMinorUnits} from '../domain/execution-money.js';
import * as EX from '../services/execution.js';
import * as L from '../services/execution-ledger.js';
import * as DF from '../services/execution-differences.js';
import * as POA from '../services/execution-poa.js';
import * as B from '../services/execution-balance.js';
import * as PR from '../services/execution-print.js';
import * as FEAS from '../services/execution-feas.js';

const options = (list, selected = '', emptyLabel = '') => `${emptyLabel ? `<option value="">${esc(emptyLabel)}</option>` : ''}${list.map(([value, label]) => `<option value="${esc(value)}"${String(value) === String(selected) ? ' selected' : ''}>${esc(label)}</option>`).join('')}`;
const field = (label, html, hint = '', key = '') => `<label class="exec-field"${key ? ` data-field="${esc(key)}"` : ''}><span>${esc(label)}</span>${html}${hint ? `<small class="exec-hint">${esc(hint)}</small>` : ''}</label>`;
const run = async (action, success) => {
  try {
    const out = await action();
    if (success) toast(typeof success === 'function' ? success(out) : success);
    return out;
  } catch (error) { toast(userError(error), 'error'); return null; }
};

// ===== تنفيذ: إنشاء/تعديل — نموذج موجّه: كل خانة تحتها شرح ماذا تكتب =====
export async function executionDialog(app, {execution = null} = {}) {
  const office = app.office;
  const [filesPage, clientsPage] = await Promise.all([
    office.r.files.page({index: 'openedAt', direction: 'prev', limit: 100}).catch(() => ({items: []})),
    office.r.clients.page({index: 'createdAt', direction: 'prev', limit: 100}).catch(() => ({items: []}))
  ]);
  const files = (filesPage.items || []).filter(row => !row.isDeleted);
  const clients = (clientsPage.items || []).filter(row => !row.isDeleted);
  // ضمان ظهور القيم الحالية في القوائم حتى لو خرجت من آخر 100 سجل
  if (execution?.fileId && !files.some(row => row.id === execution.fileId)) {
    const current = await office.r.files.get(execution.fileId).catch(() => null);
    if (current) files.unshift(current);
  }
  if (execution?.clientId && !clients.some(row => row.id === execution.clientId)) {
    const current = await office.r.clients.get(execution.clientId).catch(() => null);
    if (current) clients.unshift(current);
  }
  const v = execution || {};
  const fileOptions = files.map(row => `<option value="${esc(row.id)}"${row.id === v.fileId ? ' selected' : ''}>${esc(formatFileNumber(row.fileNumber))} — ${esc(row.title || '')}</option>`).join('');
  const clientOptions = clients.map(row => `<option value="${esc(row.id)}"${row.id === v.clientId ? ' selected' : ''}>${esc(row.fullName || row.name || '')}</option>`).join('');
  const value = (key, fallback = '') => esc(v[key] ?? fallback);
  const card = modal(`<h2 class="modal-title">${execution ? 'تعديل بيانات التنفيذ' : 'فتح تنفيذ جديد'}</h2>
  <p class="exec-form-banner"><b>اقرأ قبل التعبئة:</b> هذه النافذة تُعرِّف <b>هوية التنفيذ فقط</b> — لا تُدخل فيها أي مبلغ. المبالغ تُسجَّل بعد الحفظ في مرحلتين فقط: «+ حكم» ثم «شريحة قيمة جديدة»، وفق دليل <b>«ابدأ هنا — 6 مراحل»</b> في مركز التنفيذ. كل خانة تحتها سطر يخبرك ماذا تكتب.</p>
  <form class="exec-form">
    <h4 class="exec-sub">أولاً — التعريف بالتنفيذ <span class="muted">(الخانات المعلَّمة بـ * مطلوبة)</span></h4>
    <div class="exec-form-grid">
      ${field('نوع التنفيذ *', `<select name="executionType" required>${options(EXECUTION_TYPES, v.executionType || 'family')}</select>`, 'اختر حسب نوع القضية أمام قلم التنفيذ: «تنفيذ أحكام الأسرة» للنفقات والمعاشات وأحكام الأحوال، وما عداه مدني أو جزائي.', 'executionType')}
      ${field('الملف القانوني المرتبط *', `<select name="fileId" required><option value="">— اختر الملف —</option>${fileOptions}</select>`, files.length ? 'الملف الذي تُحفظ أوراق هذا التنفيذ فيه — مطلوب، ولا يُفتح تنفيذ بلا ملف. مثال: ملف «تنفيذ نفقة».' : 'لا توجد ملفات بعد: أنشئ ملفًا من صفحة الملفات أولًا ثم عد لفتح التنفيذ.', 'fileId')}
      ${field('رقم التنفيذ الرسمي', `<input name="officialNumber" value="${value('officialNumber')}" placeholder="مثال: 1200/2025">`, 'رقم بند التنفيذ كما يظهر بالقلم. اتركه فارغًا إن لم يصدر بعد.', 'officialNumber')}
      ${field('جهة التنفيذ', `<input name="authority" value="${value('authority')}" placeholder="مثال: قلم تنفيذ الأسرة — المنصورة">`, 'اسم القلم أو المحكمة أو إدارة التنفيذ المختصة.', 'authority')}
      ${field('تاريخ فتح التنفيذ', `<input name="openedDate" type="date" value="${value('openedDate', localDate())}">`, 'يوم فتح ملف التنفيذ فعليًا — يُستخدم لترقيم السنة في الأرقام الداخلية.', 'openedDate')}
    </div>
    <h4 class="exec-sub">ثانيًا — السند والتواريخ المساعدة <span class="muted">(اختياري)</span></h4>
    <div class="exec-form-grid">
      ${field('تاريخ الحكم', `<input name="judgmentDate" type="date" value="${value('judgmentDate')}">`, 'تاريخ الحكم المُنفَّذ كما في ورقته. لا يُستخدم في أي حساب مالي — المبلغ يبدأ من «تاريخ السريان» الذي تسجّله مع الحكم.', 'judgmentDate')}
      ${field('نوع السند التنفيذي', `<input name="bondType" list="exec-bondtypes" value="${value('bondType')}" placeholder="اختر أو اكتب"><datalist id="exec-bondtypes"><option value="حكم نهائي"></option><option value="محرر موثق"></option><option value="ورقة تجارية"></option><option value="أمر أداء"></option></datalist>`, 'الورقة التي يبني عليها التنفيذ: حكم نهائي، محرر موثق، ورقة تجارية…', 'bondType')}
      ${field('تاريخ الصيغة التنفيذية', `<input name="executoryFormulaDate" type="date" value="${value('executoryFormulaDate')}">`, 'تاريخ اعتماد الصيغة التنفيذية إن وُجدت مستندًا.', 'executoryFormulaDate')}
      ${field('تاريخ استلام الصيغة', `<input name="formulaReceiptDate" type="date" value="${value('formulaReceiptDate')}">`, 'يوم وصول الصيغة إلى قلم التنفيذ.', 'formulaReceiptDate')}
      ${field('طريقة التنفيذ', `<select name="executionMethod">${options(EXECUTION_METHODS, v.executionMethod || '', '— غير محدد —')}</select>`, 'كيف يتم التحصيل الفعلي: جهة العمل، بنك ناصر، المحضرون…', 'executionMethod')}
    </div>
    <h4 class="exec-sub">ثالثًا — الربط والمتابعة</h4>
    <div class="exec-form-grid">
      ${field('الموكل (صاحب الحق)', `<select name="clientId"><option value="">— غير محدد —</option>${clientOptions}</select>`, 'يظهر اسمه في التقارير والبحث وكشف الرصيد. يمكن ربطه لاحقًا من تعديل البيانات.', 'clientId')}
      ${field('حالة التنفيذ', `<select name="status">${options(EXECUTION_STATUSES, v.status || 'active')}</select>`, 'حالة المتابعة الآن كما هي في الملف: جارٍ، موقوف، تحصيل جزئي، مكتمل… تُغيَّر يدويًا.', 'status')}
      ${field('موعد المتابعة القادم', `<input name="nextReviewDate" type="date" value="${value('nextReviewDate')}">`, 'موعد تذكيرك الذاتي — يظهر في قسم «يحتاج انتباهي» عند حلوله.', 'nextReviewDate')}
      ${field('حساب الاستحقاقات حتى تاريخ', `<input name="entitlementThroughDate" type="date" value="${value('entitlementThroughDate')}">`, 'حتى متى تُبنى الفترات (مثال: 2025-12-31). بعدها لا يضيف النظام فترات جديدة.', 'entitlementThroughDate')}
      <p class="muted small">يُحسب الجدول وفق نسخة إعدادات المكتب المؤرخة؛ الفترات لا تُقسَّم بالأيام. رسوم التنفيذ والمصروفات تبقى منفصلة عن أصل الاستحقاق.</p>
    </div>
    <h4 class="exec-sub">رابعًا — إعداد الحساب <span class="muted">(اتركه كما هو إن كنت لأول مرة)</span></h4>
    <div class="exec-form-grid">
      ${field('نموذج الحساب', `<select name="accountingModel">${options([['legacy-v1', 'المسار المبسط (موصى به)'], ['feas-v1', 'FEAS — اعتراف صريح ولقطات']], v.accountingModel || 'legacy-v1')}</select>`, 'المسار المبسط: تسجّل حكمًا وشريحة وتحصيلًا فيحسب الرصيد فورًا. FEAS: نظام لقطات الاعتراف الصريح للمتمرسين — اختره عند الفتح فقط ولا يتغيّر بعد الحفظ.', 'accountingModel')}
      ${field('ملاحظات', `<textarea name="notes" rows="2">${value('notes')}</textarea>`, 'أي ملاحظة تحرية عن الملف — لا تُستخدم في الحساب.', 'notes')}
    </div>
  </form>
  <div class="form-actions"><button type="button" class="primary" data-save>${execution ? 'حفظ التعديلات' : 'حفظ وفتح بطاقة التنفيذ'}</button><button type="button" class="ghost" data-close>إلغاء</button></div>`);
  card.querySelector('[data-close]').onclick = closeModal;
  const showErrors = errors => {
    card.querySelectorAll('.field-error').forEach(node => node.remove());
    card.querySelectorAll('.has-error').forEach(node => node.classList.remove('has-error'));
    for (const [key, message] of Object.entries(errors || {})) {
      const fd = card.querySelector(`[data-field="${key}"]`);
      if (!fd) continue;
      fd.classList.add('has-error');
      fd.insertAdjacentHTML('beforeend', `<small class="field-error" role="alert">${esc(message)}</small>`);
    }
    card.querySelector('.has-error')?.scrollIntoView({behavior: 'smooth', block: 'center'});
  };
  card.querySelector('[data-save]').onclick = async () => {
    const data = formData(card.querySelector('form'));
    try {
      const row = await EX.saveExecution(office, data, execution?.id || null, execution?.version ?? null);
      closeModal();
      toast(execution ? 'تم حفظ تعديلات التنفيذ' : `تم فتح التنفيذ ${row.internalNumber || ''} — الخطوة التالية: «+ طرف تنفيذ» ثم «+ حكم»`);
      await app.refresh();
    } catch (error) {
      showErrors(error?.details);
      toast(userError(error), 'error');
    }
  };
  return card;
}

// ===== إعداد FEAS: التزامات واعتراف صريح =====
export async function executionObligationDialog(app, executionId, {obligation = null, parties = []} = {}) {
  if (!parties.length) parties = await EX.executionPartyRows(app.office, executionId).catch(() => []);
  const card = modal(`<h2 class="modal-title">${obligation ? 'تعديل تعريف التزام FEAS' : 'تعريف التزام FEAS'}</h2>
  <p class="muted small">أدخل قاعدة المكتب كما هي موثقة. لا تُستنتج قيمة أو دورية أو عملة أو تاريخ، والتعريف وحده لا ينشئ دينًا.</p>
  <form class="exec-form exec-form-grid">
    ${field('نوع الالتزام كما سجّله المكتب', `<input name="obligationType" value="${esc(obligation?.obligationType || '')}" required placeholder="مثال: نفقة شهرية">`, 'اسم الالتزام كما في المنطوق (نفقة شهرية، معاش…). به تُجمَّع الفترات.', 'obligationType')}
    ${field('الوصف', `<input name="description" value="${esc(obligation?.description || '')}">`, 'تفصيل اختياري لطبيعة الالتزام.', 'description')}
    ${field('المستحق (اختياري)', `<select name="beneficiaryPartyId">${options(parties.filter(row => !row.isDeleted && row.isActive !== false && row.side !== 'debtor').map(row => [row.id, `${row.name} — ${row.role || 'مستحق'}`]), obligation?.beneficiaryPartyId || '', '— غير محدد —')}</select>`, 'إن لم يُحدَّد طرف، لا يُخمن النظام مستفيدًا.', 'beneficiaryPartyId')}
    ${field('الدورية (اختيار صريح)', `<select name="frequency">${options(FEAS_FREQUENCIES, obligation?.frequency || '', 'اختر الدورية')}</select>`, 'تكرار الالتزام: شهري، أسبوعي، مخصص… اختر كما في المنطوق.', 'frequency')}
    ${field('العملة — رمز ISO ثلاثي الأحرف', `<input name="currency" value="${esc(obligation?.currency || '')}" maxlength="3" pattern="[A-Za-z]{3}" required placeholder="مثال: EGP">`, 'ثلاث لاتينية فقط: EGP للجنيه المصري. لا يُحوَّل الرمز العربي «جنيه» تلقائيًا.', 'currency')}
    ${field('تاريخ بداية الالتزام / الارتكاز الأصلي *', `<input name="startDate" type="date" value="${esc(obligation?.startDate || obligation?.anchorDate || '')}" required>`, 'هذا الارتكاز ثابت لكل الفترات؛ التاريخ الساري التالي لا يعيد ضبطه.', 'startDate')}
    ${field('تاريخ نهاية الالتزام (اختياري)', `<input name="endDate" type="date" value="${esc(obligation?.endDate || '')}">`, 'إذا انتهى الحكم في منتصف فترة فسيطلب النظام قرارًا صريحًا قبل الاعتراف.', 'endDate')}
    ${field('التاريخ المرجعي للدورية الأسبوعية/المخصصة', `<input name="anchorDate" type="date" value="${esc(obligation?.anchorDate || obligation?.startDate || '')}">`, 'للأسبوعي والمخصص: يُحفظ الارتكاز مرة واحدة ولا ينجرف مع الفترات اللاحقة.', 'anchorDate')}
    ${field('عدد أيام الدورية المخصصة', `<input name="customDays" type="number" step="1" min="1" max="36500" value="${obligation?.customDays ?? ''}">`, 'يُستخدم فقط عند اختيار الدورية المخصصة.', 'customDays')}
    ${field('أساس الشهر', `<select name="periodBasis">${options(FEAS_PERIOD_BASES, obligation?.periodBasis || 'ANNIVERSARY')}</select>`, 'ANNIVERSARY: يوم الارتكاز إلى ما قبل الارتكاز التالي. CALENDAR_MONTH: الشهر التقويمي كاملًا.', 'periodBasis')}
    ${field('سياسة بداية فترة ناقصة', `<select name="startPolicy">${options(FEAS_PERIOD_START_POLICIES, obligation?.startPolicy || 'ASK')}</select>`, 'تُستخدم فقط إذا اختير شهر تقويمي أو وقعت البداية داخل فترة أخرى؛ ASK يمنع أي افتراض.', 'startPolicy')}
    ${field('سياسة حكم لاحق يبدأ منتصف فترة', `<select name="midChangePolicy">${options(FEAS_MID_CHANGE_POLICIES, obligation?.midChangePolicy || 'ASK')}</select>`, 'مع ASK تُعرض البدائل ويُحفظ القرار والسبب قبل الاعتراف.', 'midChangePolicy')}
    ${field('سياسة نهاية الحكم منتصف فترة', `<select name="endPolicy">${options(FEAS_END_POLICIES, obligation?.endPolicy || 'ASK')}</select>`, 'مع ASK لا تُحتسب الفترة الناقصة حتى اختيار صريح.', 'endPolicy')}
    ${field('توقيت الاستحقاق', `<select name="accrualTiming">${options(FEAS_ACCRUAL_TIMINGS, obligation?.accrualTiming || 'AFTER_PERIOD_END')}</select>`, 'إعداد مكتب موثق، وليس استنتاجًا قانونيًا.', 'accrualTiming')}
    ${field('سياسة اليوم غير الموجود في الشهر', `<select name="monthEndPolicy">${options(FEAS_MONTH_END_POLICIES, obligation?.monthEndPolicy || 'CLAMP_TO_LAST_DAY')}</select>`, 'قص تاريخ الفترة إلى آخر يوم بالشهر من دون انجراف.', 'monthEndPolicy')}
    ${field('ملاحظات تعريفية', `<textarea name="notes" rows="2">${esc(obligation?.notes || '')}</textarea>`, 'أي ملاحظة عن التعريف.', 'notes')}
  </form>
  <div class="form-actions"><button type="button" class="primary" data-save>${obligation ? 'حفظ تعريف الالتزام' : 'تعريف الالتزام'}</button><button type="button" class="ghost" data-close>إلغاء</button></div>`);
  card.querySelector('[data-close]').onclick = closeModal;
  card.querySelector('[data-save]').onclick = async () => {
    const data = formData(card.querySelector('form'));
    const out = await run(() => FEAS.saveExecutionObligation(app.office, {...data, executionId}, obligation?.id || null, obligation?.version ?? null), obligation ? 'تم حفظ تعريف الالتزام' : 'تم تعريف الالتزام — لا ينشأ دين حتى الاعتراف بفترة');
    if (out) { closeModal(); await app.refresh(); }
  };
  return card;
}

export async function recognitionDialog(app, executionId, obligations = []) {
  const active = obligations.filter(row => !row.isDeleted && row.status !== 'inactive');
  const choiceLabels = {
    KEEP_OLD_VALUE: 'القيمة القديمة للفترة كاملة', USE_NEW_VALUE: 'القيمة الجديدة للفترة كاملة',
    INCLUDE_FULL: 'احتساب الفترة كاملة', EXCLUDE: 'استبعاد الفترة', MANUAL: 'مبلغ يدوي كامل',
    RANGE_START: 'قرار حد بداية النطاق', RANGE_END: 'قرار حد نهاية النطاق'
  };
  const kindLabels = {
    RANGE_START: 'الفترة تتقاطع مع بداية النطاق', RANGE_END: 'الفترة تتقاطع مع نهاية النطاق', RANGE_BOUNDARY: 'الفترة تتقاطع مع حدود النطاق',
    START_DATE: 'بداية الالتزام داخل فترة', MID_CHANGE: 'حكم لاحق في منتصف فترة', END_DATE: 'نهاية الحكم في منتصف فترة'
  };
  const card = modal(`<h2 class="modal-title">معاينة / اعتراف صريح بالفترات</h2>
  <p class="muted small">المعاينة لا تكتب دينًا. يُعرض كل خيار للفترة الناقصة، ولا يُحتسب شيء بصمت أو بتناسب يومي. كل فترة كاملة تُحفظ بلقطة مستقلة.</p>
  <form class="exec-form exec-form-grid">
    ${field('الالتزام', `<select name="obligationId" required>${options(active.map(row => [row.id, `${row.obligationType} · ${row.frequency} · ${row.currency}`]), '', 'اختر الالتزام')}</select>`, 'أي التزام تريد معاينة فتراته.', 'obligationId')}
    ${field('من تاريخ', `<input name="fromDate" type="date" required>`, 'يوم بداية نطاق المعاينة.', 'fromDate')}
    ${field('إلى تاريخ', `<input name="toDate" type="date" required>`, 'يوم نهاية نطاق المعاينة.', 'toDate')}
    ${field('حالة الفترة بعد الاعتراف', `<select name="status">${options([['RECOGNIZED', 'معترف بها'], ['CLOSED', 'معترف بها ومغلقة']], 'RECOGNIZED')}</select>`, '«مغلقة» إذا انتهت نهائيًا ولا تتغير بعد الاعتراف.', 'status')}
    ${field('سبب / مرجع الاعتراف', `<textarea name="reason" rows="2" placeholder="مرجع القرار أو المستند"></textarea>`, 'سبب الاعتراف العام — وتُسجَّل أسباب القرارات الفردية لكل فترة.', 'reason')}
  </form>
  <div class="exec-actions-row"><button type="button" class="ghost" data-preview>معاينة دون كتابة</button><button type="button" class="primary" data-recognize disabled>حفظ لقطات الاعتراف</button><button type="button" class="ghost" data-close>إلغاء</button></div>
  <div class="exec-feas-preview" data-preview-output><p class="muted small">أدخل الالتزام والنطاق ثم اطلب المعاينة.</p></div>`);
  let preview = null;
  let pendingDecisions = [];
  const output = card.querySelector('[data-preview-output]');
  const recognizeButton = card.querySelector('[data-recognize]');
  const upsertDecision = (list, item) => {
    const index = list.findIndex(row => row.periodKey === item.periodKey && row.kind === item.kind);
    if (index >= 0) list[index] = {...list[index], ...item}; else list.push(item);
  };
  const collectDecisionDraft = () => {
    const next = pendingDecisions.map(row => ({...row}));
    const get = (periodKey, kind) => next.find(row => row.periodKey === periodKey && row.kind === kind);
    for (const control of output.querySelectorAll('[data-decision-choice]')) {
      const current = get(control.dataset.periodKey, control.dataset.kind) || {periodKey: control.dataset.periodKey, kind: control.dataset.kind};
      upsertDecision(next, {...current, choice: control.value});
    }
    for (const reason of output.querySelectorAll('[data-decision-reason]')) {
      const current = get(reason.dataset.decisionReason, reason.dataset.kind) || {periodKey: reason.dataset.decisionReason, kind: reason.dataset.kind};
      upsertDecision(next, {...current, reason: reason.value.trim()});
    }
    for (const amount of output.querySelectorAll('[data-decision-amount]')) {
      const current = get(amount.dataset.decisionAmount, amount.dataset.kind) || {periodKey: amount.dataset.decisionAmount, kind: amount.dataset.kind};
      const obligation = active.find(row => row.id === card.querySelector('[name="obligationId"]').value);
      upsertDecision(next, {...current, ...(amount.value ? {amountMinor: toMinorUnits(amount.value, obligation?.currency || 'EGP')} : {})});
    }
    return next;
  };
  const labelChoice = value => choiceLabels[value] || value;
  const renderPreview = out => {
    const unresolved = out.decisions || [];
    const scenarioHtml = (out.sideBySideScenarios || []).length
      ? `<h4>مقارنة خيارات الفترة الناقصة</h4><div class="exec-table-wrap"><table class="exec-table"><thead><tr><th>الفترة</th><th>نوع القرار</th><th>الخيار</th><th>قيمة الفترة كاملة</th><th>المعادلة</th></tr></thead><tbody>${out.sideBySideScenarios.map(row => `<tr><td>${esc(row.periodKey)}</td><td>${esc(kindLabels[row.kind] || row.kind)}</td><td>${esc(labelChoice(row.choice))}</td><td>${row.amountMinor === null ? 'يلزم إدخال مبلغ يدوي' : `${esc(String(row.amountMinor))} وحدة صغرى`}</td><td>${esc(row.equation)}</td></tr>`).join('')}</tbody></table></div>` : '';
    const decisionHtml = unresolved.length
      ? `<h4>قرارات مطلوبة قبل الاعتراف</h4><div class="exec-decision-list">${unresolved.map((decision, index) => {
        const existing = pendingDecisions.find(row => row.periodKey === decision.periodKey && row.kind === decision.kind) || {};
        const choices = (decision.options || []).filter(value => !['MANUAL_AMOUNT', 'REASON'].includes(value));
        const select = choices.length ? `<label class="exec-field"><span>الاختيار</span><select required data-decision-choice data-period-key="${esc(decision.periodKey)}" data-kind="${esc(decision.kind)}">${options(choices.map(value => [value, labelChoice(value)]), existing.choice || '', 'اختر قرارًا')}</select></label>` : '';
        const reason = `<label class="exec-field"><span>سبب القرار</span><textarea rows="2" required data-decision-reason="${esc(decision.periodKey)}" data-kind="${esc(decision.kind)}">${esc(existing.reason || '')}</textarea></label>`;
        const manual = (existing.choice === 'MANUAL' || (decision.options || []).includes('MANUAL_AMOUNT'))
          ? `<label class="exec-field"><span>المبلغ اليدوي الكامل بوحدات العملة الصغرى/العملة</span><input type="number" step="any" min="0" data-decision-amount="${esc(decision.periodKey)}" data-kind="${esc(decision.kind)}" value="${existing.amountMinor != null ? esc(String(fromMinorUnits(existing.amountMinor, active.find(row => row.id === card.querySelector('[name="obligationId"]').value)?.currency || 'EGP'))) : ''}"></label>` : '';
        return `<section class="exec-decision-card"><b>${esc(kindLabels[decision.kind] || decision.kind)}: ${esc(decision.fromDate)} → ${esc(decision.toDate)}</b><p>${esc(decision.reason)}</p>${select}${reason}${manual}</section>`;
      }).join('')}</div>` : '';
    const unitRows = (out.periods || []).map(period => `<tr><td>${esc(period.fromDate)} → ${esc(period.toDate)}</td><td>${esc(period.periodKey)}</td><td>${esc(String(period.amountMinor))}</td><td>${esc(period.equation)}</td></tr>`).join('');
    const partialNote = (out.partials || []).length ? `<p class="warning">توجد حدود نطاق غير مكتملة؛ لن تُعترف قبل قرار صريح.</p>` : '';
    const futureNote = (out.notYetCompletePeriods || []).length ? `<p class="warning">الفترات الجارية/المستقبلية معلوماتية فقط؛ لا يُحفظ الاعتراف قبل اكتمال الفترة بعد ${esc(out.asOf || '')}.</p>` : '';
    output.innerHTML = `<div class="exec-kv"><span>نطاق المعاينة</span><b>${esc(out.fromDate)} → ${esc(out.toDate)}</b><span>العملة</span><b>${esc(out.currency)}</b><span>المبلغ من الفترات المحسومة</span><b>${money(fromMinorUnits(out.recognizedAmountMinor, out.currency))}</b><span>الوحدات الصغرى</span><b>${esc(String(out.recognizedAmountMinor))}</b><span>الفترات الكاملة</span><b>${(out.periods || []).length}</b></div><p class="muted small">${esc(out.equation || '')}</p>${scenarioHtml}${decisionHtml}${partialNote}${futureNote}<h4>الفترات الكاملة ولقطاتها المقترحة</h4><div class="exec-table-wrap"><table class="exec-table"><thead><tr><th>الحدود</th><th>المعرّف الثابت</th><th>المبلغ بوحدات صغرى</th><th>المعادلة</th></tr></thead><tbody>${unitRows || '<tr><td colspan="4" class="muted">لا توجد فترة كاملة محسومة بالقيمة الحالية.</td></tr>'}</tbody></table></div>`;
    recognizeButton.disabled = !out.periods?.length || Boolean(out.decisions?.length) || Boolean(out.partials?.length) || Boolean(out.notYetCompletePeriods?.length) || !out.fingerprint;
    for (const input of output.querySelectorAll('[data-decision-choice], [data-decision-reason], [data-decision-amount]')) {
      input.addEventListener('input', () => { preview = null; recognizeButton.disabled = true; });
      input.addEventListener('change', () => { preview = null; recognizeButton.disabled = true; });
    }
  };
  card.querySelector('[data-close]').onclick = closeModal;
  card.querySelector('[data-preview]').onclick = async () => {
    pendingDecisions = collectDecisionDraft();
    const data = formData(card.querySelector('form'));
    const out = await run(() => FEAS.projectExecutionPeriod(app.office, {executionId, obligationId: data.obligationId, fromDate: data.fromDate, toDate: data.toDate, periodDecisions: pendingDecisions}));
    preview = out;
    if (!out) { recognizeButton.disabled = true; return; }
    renderPreview(out);
  };
  card.querySelector('[data-recognize]').onclick = async () => {
    if (!preview?.fingerprint) return toast('أعد المعاينة قبل الاعتراف', 'error');
    const data = formData(card.querySelector('form'));
    const out = await run(() => FEAS.recognizeExecutionPeriod(app.office, {
      executionId, obligationId: data.obligationId, fromDate: data.fromDate, toDate: data.toDate,
      status: data.status, reason: data.reason, periodDecisions: pendingDecisions, expectedFingerprint: preview.fingerprint
    }), result => result.reused ? 'كل الفترات معترف بها مسبقًا؛ أُعيدت اللقطات نفسها دون تكرار' : `حُفظت ${result.rows?.length || 1} لقطة اعتراف مستقلة`);
    if (out) { closeModal(); await app.refresh(); }
  };
  return card;
}

export async function closeRecognizedPeriod(app, period) {
  const answer = await confirmBox(`إغلاق فترة الاعتراف ${period.fromDate} → ${period.toDate}؟ لن تتغير لقطة المبلغ أو مصادرها.`, {okText: 'إغلاق', input: true, label: 'سبب الإغلاق (اختياري)'});
  if (!answer || answer.ok !== true) return;
  const out = await run(() => FEAS.closeExecutionPeriod(app.office, period.id, String(answer.value || '')), 'تم إغلاق الفترة دون تغيير مبلغ اللقطة');
  if (out) await app.refresh();
}

// ===== طرف تنفيذ =====
export async function partyDialog(app, executionId, {party = null, clients = [], opponents = []} = {}) {
  const card = modal(`<h2 class="modal-title">${party ? 'تعديل طرف تنفيذ' : 'إضافة طرف تنفيذ'}</h2>
  <p class="muted small">الصفة (مستحق / منفذ ضده) يسجلها المستخدم كما هي في الملف؛ البرنامج ينظم ولا يفرض وصفًا قانونيًا.</p>
  <form class="exec-form">
    ${field('جهة الطرف', `<select name="side">${options([['creditor', 'مستحق (دائن)'], ['debtor', 'منفذ ضده (مدين)']], party?.side || 'creditor')}</select>`, '«مستحق» = صاحب الحق (الموكل). «منفذ ضده» = من يُنفَّذ الحكم ضده.', 'side')}
    ${field('ربط بموكل مسجل', `<select name="clientId">${options(clients.map(c => [c.id, c.fullName]), party?.clientId || '', '— إدخال يدوي للاسم —')}</select>`, 'اختر الموكل من القائمة إن كان مسجلًا، وإلا اتركه واكتب الاسم يدويًا في خانة الاسم.', 'clientId')}
    ${field('ربط بخصم مسجل', `<select name="opponentId">${options(opponents.map(o => [o.id, o.name]), party?.opponentId || '', '— بلا —')}</select>`, 'اختر الخصم من القائمة إن كان مسجلًا — يفيد التقارير والربط لاحقًا.', 'opponentId')}
    ${field('الاسم كما يظهر', `<input name="name" value="${esc(party?.name || '')}" placeholder="يُملأ تلقائيًا من الربط إن وُجد">`, 'اتركه فارغًا إن اخترت موكلًا/خصمًا مسجلًا بالأعلى — يُنسخ اسمه تلقائيًا.', 'name')}
    ${field('الصفة النصية', `<input name="role" value="${esc(party?.role || '')}" placeholder="مثال: مستحق عن نفسه / وصي / منفذ ضده">`, 'الصفة كما ترد في المستندات: زوجة، وصي على قاصر، شركة…', 'role')}
    ${field('النصيب (اختياري)', `<input name="share" type="number" step="0.01" min="0" value="${party?.share ?? ''}">`, 'نسبة أو مبلغ نصيب الطرف إن كان مجزأًا (مثال: 50). لا يُوزَّع على الفترات إلا بطلبك الصريح.', 'share')}
    ${field('ملاحظات', `<textarea name="notes" rows="2">${esc(party?.notes || '')}</textarea>`, 'أي ملاحظة عن الطرف — لا تدخل الحساب.', 'notes')}
  </form>
  <div class="form-actions"><button type="button" class="primary" data-save>${party ? 'حفظ' : 'إضافة'}</button><button type="button" class="ghost" data-close>إلغاء</button></div>`);
  card.querySelector('[data-close]').onclick = closeModal;
  card.querySelector('[data-save]').onclick = async () => {
    const data = formData(card.querySelector('form'));
    const out = await run(() => EX.saveExecutionParty(app.office, {...data, executionId}, party?.id || null), party ? 'تم تحديث الطرف' : 'تمت إضافة الطرف');
    if (out) { closeModal(); await app.refresh(); }
  };
  return card;
}

// ===== حكم جديد + شريحة قيمة =====
export async function judgmentDialog(app, executionId, {judgment = null, previous = null, slices = [], obligations = [], accountingModel = ''} = {}) {
  const isFeas = accountingModel === FEAS_MODEL;
  const types = [...new Set([...(slices || []).map(s => s.entitlementType), 'نفقة شهرية', 'نفقة أبناء', 'تعويض'])];
  const card = modal(`<h2 class="modal-title">${judgment ? 'تعديل بيانات حكم' : 'تسجيل حكم في سلسلة التنفيذ'}</h2>
  <p class="exec-form-banner"><b>الأسرار الثلاثة قبل التعبئة:</b> ① تاريخ الحكم ≠ تاريخ سريان القيمة — أنت تدخل تاريخ السريان بنفسه. ② «القيمة» وال«الدورية» هما مفتاح الحساب لاحقًا. ③ الأسرع: اضغط <b>«تسجيل الحكم + إنشاء شريحة قيمة»</b> فيُنجز الخطوتين 3 و4 معًا.</p>
  <form class="exec-form exec-form-grid">
    ${field('نوع الاستحقاق', `<input name="entitlementType" list="exec-types" value="${esc(judgment?.entitlementType || previous?.entitlementType || '')}" required><datalist id="exec-types">${types.map(t => `<option value="${esc(t)}"></option>`).join('')}</datalist>`, 'اكتب النوع كما نص عليه المنطوق: نفقة شهرية، نفقة أبناء، معاش، تعويض…', 'entitlementType')}
    ${accountingModel === FEAS_MODEL ? field('التزام FEAS المرتبط للشريحة', `<select name="obligationId">${options(obligations.filter(row => !row.isDeleted && row.status !== 'inactive').map(row => [row.id, `${row.obligationType} · ${row.currency}`]), '', 'اختر الالتزام عند إنشاء شريحة')}</select>`, 'التزام منفصل عن الحكم، يحدد العملة والدورية والسياسة.', 'obligationId') : ''}
    ${field('نوع الحكم', `<select name="judgmentKind">${options([['original', 'حكم أصلي'], ['later', 'حكم لاحق / استئناف'], ['correction', 'تصحيح'], ['other', 'أخرى']], judgment?.judgmentKind || (previous ? 'later' : 'original'))}</select>`, 'الأول في السلسلة = «أصلي». أي حكم بعده (استئناف أو تعديل) = «لاحق».', 'judgmentKind')}
    ${field('تاريخ الحكم', `<input name="judgmentDate" type="date" value="${esc(judgment?.judgmentDate || localDate())}" required>`, 'يوم صدور الحكم كما في ورقته — لا يُستخدم في الحساب المالي.', 'judgmentDate')}
    ${field('رقم الحكم', `<input name="judgmentNumber" value="${esc(judgment?.judgmentNumber || '')}" placeholder="مثال: 101/2025">`, 'رقم كتاب الحكم/التنفيذ كما هو مكتوب.', 'judgmentNumber')}
    ${field('رقم الدعوى', `<input name="lawsuitNumber" value="${esc(judgment?.lawsuitNumber || '')}">`, 'رقم الدعوى بالمحكمة (إن وُجد).', 'lawsuitNumber')}
    ${field('رقم الاستئناف', `<input name="appealNumber" value="${esc(judgment?.appealNumber || '')}">`, 'رقم مستأنف الحكم — اتركه فارغًا إن لم يوجد.', 'appealNumber')}
    ${field('المحكمة', `<input name="court" value="${esc(judgment?.court || '')}">`, 'اسم المحكمة الصادرة منها (مثال: محكمة الأسرة بالمنصورة).', 'court')}
    ${field(isFeas ? 'نوع القيمة (اختيار صريح)' : 'نوع القيمة', `<select name="valueType" ${isFeas && !judgment ? 'required' : ''}>${options(VALUE_TYPES, isFeas && !judgment ? '' : (judgment?.valueType || 'periodic'), isFeas && !judgment ? 'اختر نوع القيمة' : '')}</select>`, '«مبلغ دوري» يتكرر كل دورية (النفقة الشهرية). «مبلغ ثابت» يُستحق مرة واحدة (تعويض).', 'valueType')}
    ${field('قيمة الحكم (بالجنيه)', `<input name="amount" type="number" step="any" min="0" value="${judgment?.amount ?? ''}" placeholder="مثال: 3000">`, 'رقم المبلغ فقط بدون رموز: 3000 يعني 3,000 جنيه. لا يُقاس به وحده إلا بعد تحديد الدورية وتاريخ السريان.', 'amount')}
    ${isFeas ? '<p class="muted small">الدورية وسياسة الجزء تؤخذان صراحةً من تعريف التزام FEAS المرتبط.</p>' : field('الدورية (تكرار المبلغ)', `<select name="periodicity">${options(PERIODICITIES, judgment?.periodicity || 'monthly')}</select>`, 'معظم أحكام الأسرة «شهرية». اختر حسب المنطوق: يومية، أسبوعية، نصف شهرية، شهرية، سنوية.', 'periodicity')}
    ${field('تاريخ سريان القيمة', `<input name="effectiveFrom" type="date" value="${esc(judgment?.effectiveFrom || '')}">`, 'أهم خانة: من أي يوم يبدأ المبلغ؟ (مثال: 01/07/2025). ليس تاريخ الحكم! اتركه فارغًا إن لم يحدد المنطوق يومًا.', 'effectiveFrom')}
    ${field('تاريخ انتهاء السريان (اختياري)', `<input name="effectiveTo" type="date" value="${esc(judgment?.effectiveTo || '')}">`, 'يوم انتهاء المبلغ إن كان محددًا في الحكم — وإلا يُستكمل حتى تاريخ حساب الاستحقاقات.', 'effectiveTo')}
    ${field('منطوق الحكم (ملخص)', `<textarea name="operativeSummary" rows="2">${esc(judgment?.operativeSummary || '')}</textarea>`, 'سطر أو سطران ملخصًا للمنطوق كما تراه في الورقة — للعرض فقط.', 'operativeSummary')}
    ${field('ملاحظات', `<textarea name="notes" rows="2">${esc(judgment?.notes || '')}</textarea>`, 'أي ملاحظة — لا تدخل الحساب.', 'notes')}
  </form>
  <div class="form-actions"><button type="button" class="primary" data-save>${judgment ? 'حفظ البيانات الوصفية' : 'تسجيل الحكم'}</button>
  ${judgment ? '' : '<button type="button" class="ghost" data-save-slice>تسجيل الحكم + إنشاء شريحة قيمة (خطوتان في ضغطة)</button>'}
  <button type="button" class="ghost" data-close>إلغاء</button></div>`);
  card.querySelector('[data-close]').onclick = closeModal;
  const collect = () => ({...formData(card.querySelector('form')), executionId});
  const saveJudgment = async () => {
    const data = collect();
    if (isFeas && !data.valueType) return toast('اختر نوع القيمة صراحةً قبل تسجيل الحكم في مسار FEAS.', 'error');
    if (judgment) return run(() => EX.updateExecutionJudgment(app.office, judgment.id, data), 'تم حفظ بيانات الحكم');
    return run(() => EX.addExecutionJudgment(app.office, {...data, previousJudgmentId: previous?.id || ''}), 'تم تسجيل الحكم في السلسلة');
  };
  card.querySelector('[data-save]').onclick = async () => { const out = await saveJudgment(); if (out) { closeModal(); await app.refresh(); } };
  card.querySelector('[data-save-slice]')?.addEventListener('click', async () => {
    const data = collect();
    if (!data.amount || num(data.amount) <= 0) return toast('أدخل قيمة الحكم لإنشاء شريحة قيمة.', 'error');
    if (!data.effectiveFrom) return toast('أدخل تاريخ سريان القيمة صراحةً؛ لا يُستخدم تاريخ الحكم بديلًا.', 'error');
    if (isFeas && !data.obligationId) return toast('اختر التزام FEAS المرتبط قبل إنشاء شريحة القيمة.', 'error');
    if (isFeas && !['fixed', 'periodic'].includes(data.valueType)) return toast('اختر نوع القيمة صراحةً قبل إنشاء شريحة FEAS.', 'error');
    const created = await run(async () => {
      const row = await EX.addExecutionJudgment(app.office, {...data, previousJudgmentId: previous?.id || ''});
      const slice = await EX.saveValueSlice(app.office, {
        executionId, judgmentId: row.id, entitlementType: data.entitlementType, obligationId: data.obligationId || '', valueType: data.valueType,
        periodicity: data.periodicity, amount: data.amount, startDate: data.effectiveFrom,
        endDate: data.effectiveTo || ''
      });
      return {row, slice};
    }, 'تم تسجيل الحكم وشريحة القيمة');
    if (created) {
      closeModal();
      await app.refresh();
      const impact = created.slice?.__impact;
      if (impact && impact.rows?.length) {
        const message = `يوجد ${impact.rows.length} فترة متأثرة بإجمالي فرق ${money(impact.totals.difference)}. تُراجع من شاشة «فروق الاستحقاق والتسويات» ولا تُرحَّل قبل اعتمادك.`;
        modal(`<h2 class="modal-title">أثر الشريحة على الفترات</h2><p>${esc(message)}</p><div class="form-actions"><button type="button" class="primary" data-review>فتح مراجعة التسوية</button><button type="button" class="ghost" data-close>لاحقًا</button></div>`).querySelector('[data-close]').onclick = closeModal;
        const reviewCard = document.querySelector('#modal-root .modal-card');
        reviewCard?.querySelector('[data-review]')?.addEventListener('click', async () => {
          closeModal();
          await run(async () => {
            const {settlement} = await DF.createSettlement(app.office, {executionId, sliceId: created.slice.id, note: 'من شريحة قيمة جديدة'});
            await settlementReviewDialog(app, settlement.id);
          }, 'فُتحت التسوية للمراجعة');
        });
      }
    }
  });
  return card;
}

// ===== شريحة قيمة مستقلة =====
async function feasValueSliceDialog(app, executionId, {slices = [], judgments = [], obligations = []} = {}) {
  const active = obligations.filter(row => !row.isDeleted && row.status !== 'inactive');
  const card = modal(`<h2 class="modal-title">شريحة قيمة FEAS جديدة</h2>
  <p class="muted small">يجب ربط الشريحة بالتزام وحكم مصدر. تاريخ السريان مطلوب كما أدخله المكتب؛ لا يُشتق من تاريخ الحكم. الشريحة وحدها لا تنشئ دينًا.</p>
  <form class="exec-form exec-form-grid">
    ${field('التزام FEAS', `<select name="obligationId" required>${options(active.map(row => [row.id, `${row.obligationType} · ${row.currency}`]), '', 'اختر الالتزام')}</select>`, 'الالتزام الذي حدّد العملة والدورية — اختره من القائمة المعرَّفة سابقًا.', 'obligationId')}
    ${field('الحكم المصدر', `<select name="judgmentId" required>${options(judgments.filter(row => !row.isDeleted).map(row => [row.id, `حكم ${row.judgmentNumber || '—'} ${row.judgmentDate || ''} (${row.entitlementType || ''})`]), '', 'اختر الحكم')}</select>`, 'الحكم الذي استندت إليه القيمة — لا شريحة بلا حكم مصدر.', 'judgmentId')}
    ${field('نوع القيمة (اختيار صريح)', `<select name="valueType" required>${options(VALUE_TYPES, '', 'اختر نوع القيمة')}</select>`, 'دوري = يتكرر كل دورية. ثابت = مرة واحدة. الاختيار إلزامي ولا يُفترض.', 'valueType')}
    ${field('قيمة الشريحة', `<input name="amount" type="number" step="any" min="0" required placeholder="مثال: 3000">`, 'المبلغ بوحدة العملة المعرَّفة في الالتزام (مثال: 3000 جنيهه) — تُتحقق الدقة دون تقريب صامت.', 'amount')}
    ${field('تاريخ بداية السريان', `<input name="startDate" type="date" required>`, 'يوم بداية المبلغ كما في المستند (ليس تاريخ الحكم).', 'startDate')}
    ${field('تاريخ نهاية السريان (اختياري)', `<input name="endDate" type="date">`, 'يوم الانتهاء إن كان محددًا، وإلا حتى تاريخ حساب الاستحقاقات.', 'endDate')}
    ${field('مرجع المصدر', `<input name="sourceReference" placeholder="مرجع الحكم/المستند كما سجّله المكتب">`, 'رقم الحكم أو المستند المُستند إليه — للتتبّع.', 'sourceReference')}
    ${field('ملاحظات', `<textarea name="notes" rows="2"></textarea>`, 'أي ملاحظة — لا تدخل الحساب.', 'notes')}
  </form>
  <div class="form-actions"><button type="button" class="primary" data-save>حفظ الشريحة</button><button type="button" class="ghost" data-close>إلغاء</button></div>`);
  card.querySelector('[data-close]').onclick = closeModal;
  card.querySelector('[data-save]').onclick = async () => {
    const data = formData(card.querySelector('form'));
    const out = await run(() => EX.saveValueSlice(app.office, {...data, executionId}), row => row?.__impact?.rows?.length ? `تنتظر المراجعة: ${row.__impact.rows.length} فترة معترف بها متأثرة` : row?.status === 'needs_review' ? 'شريحة تنتظر مراجعة الفرق' : 'تم حفظ شريحة المصدر؛ لا ينشأ دين بها وحدها');
    if (!out) return;
    closeModal(); await app.refresh();
    if (out.__impact?.rows?.length) {
      const result = await run(() => DF.createSettlement(app.office, {executionId, sliceId: out.id, note: 'شريحة FEAS جديدة'}), 'أُنشئت تسوية تفسيرية للمراجعة');
      if (result?.settlement) await settlementReviewDialog(app, result.settlement.id);
    }
  };
  return card;
}

export async function sliceDialog(app, executionId, {slices = [], judgments = [], obligations = [], accountingModel = ''} = {}) {
  if (!accountingModel) accountingModel = (await app.office.r.execution.get(executionId))?.accountingModel || '';
  if (accountingModel === FEAS_MODEL) return feasValueSliceDialog(app, executionId, {slices, judgments, obligations});
  const card = modal(`<h2 class="modal-title">شريحة قيمة جديدة — هنا يدخل المبلغ</h2>
  <p class="exec-form-banner"><b>ما الشريحة؟</b> هي التي تُحوِّل قيمة الحكم إلى فترات محسوبة (3,000 شهريًا من 01/01/2025 ← 12 فترة تلقائيًا). لا تُعدَّل شريحة تاريخية بعد الحفظ: التغيير شريحة جديدة والقديمة تبقى في السجل.</p>
  <form class="exec-form exec-form-grid">
    ${field('نوع الاستحقاق', `<input name="entitlementType" value="${esc(slices.at(-1)?.entitlementType || '')}" required list="exec-types-2"><datalist id="exec-types-2">${[...new Set(slices.map(s => s.entitlementType))].map(t => `<option value="${esc(t)}"></option>`).join('')}</datalist>`, 'نفس نوع الاستحقاق كما في الحكم (مثال: نفقة شهرية) — به تُجمَّع الفترات.', 'entitlementType')}
    ${field('الحكم المصدر', `<select name="judgmentId" required>${options(judgments.map(j => [j.id, `حكم ${j.judgmentNumber || '—'} ${j.judgmentDate || ''} (${num(j.amount) ? money(j.amount) : 'بلا قيمة'})`]), '', 'اختر الحكم')}</select>`, 'الحكم الذي استندت إليه هذه القيمة — مطلوب، ولا يمكن شريحة بلا حكم.', 'judgmentId')}
    ${field('نوع القيمة', `<select name="valueType">${options(VALUE_TYPES, 'periodic')}</select>`, 'دوري = يتكرر (شهريًا…). ثابت = مبلغ يُستحق مرة واحدة ولا يتكرر.', 'valueType')}
    ${field('قيمة الاستحقاق (بالجنيه)', `<input name="amount" type="number" step="0.01" min="0.01" required placeholder="مثال: 3000">`, 'المبلغ لكل دورية واحدة: 3000 مع «شهرية» = 3,000 جنيه كل شهر.', 'amount')}
    ${field('الدورية (تكرار المبلغ)', `<select name="periodicity">${options(PERIODICITIES, 'monthly')}</select>`, 'يحدد كم مرة يتكرر المبلغ: شهرية (الأكثر شيوعًا في الأسرة)، نصف شهرية، أسبوعية…', 'periodicity')}
    ${field('بداية سريان القيمة', `<input name="startDate" type="date" value="${localDate()}" required>`, 'يوم بدء المبلغ فعليًا (مثال: 01/01/2025) — الفترات تُبنى من هنا.', 'startDate')}
    ${field('نهاية السريان (اختياري)', `<input name="endDate" type="date">`, 'اتركه فارغًا لاستمرار المبلغ حتى تاريخ حساب الاستحقاقات، أو حدّد يوم الانتهاء.', 'endDate')}
    ${field('مرجع المصدر', `<input name="sourceReference" value="${esc(slices.at(-1)?.sourceReference || '')}" placeholder="مثال: الحكم 101/2025">`, 'رقم المستند أو الحكم الذي بُنيت عليه الشريحة — للتتبّع لاحقًا.', 'sourceReference')}
    ${field('ملاحظات', `<textarea name="notes" rows="2"></textarea>`, 'أي ملاحظة — لا تدخل الحساب.', 'notes')}
  </form>
  <div class="form-actions"><button type="button" class="primary" data-save>إنشاء الشريحة (ومنها يُحسب الاستحقاق)</button><button type="button" class="ghost" data-close>إلغاء</button></div>`);
  card.querySelector('[data-close]').onclick = closeModal;
  card.querySelector('[data-save]').onclick = async () => {
    const data = formData(card.querySelector('form'));
    const out = await run(() => EX.saveValueSlice(app.office, {...data, executionId}), (row) => (row?.__impact?.rows?.length ? `شريحة جديدة: ${row.__impact.rows.length} فترة متأثرة بفرق ${money(row.__impact.totals.difference)}` : 'تمت إضافة شريحة القيمة'));
    if (out) { closeModal(); await app.refresh(); }
  };
  return card;
}

// ===== محضر تحصيل + التخصيص =====
export async function collectionDialog(app, executionId, {receipt = null, poas = []} = {}) {
  const context = await L.allocationContext(app.office, executionId);
  const periods = context.outstanding.periods.filter(period => period.remaining > 0.001);
  const totalRemaining = round2(periods.reduce((sum, period) => sum + num(period.remaining), 0));
  const card = modal(`<h2 class="modal-title">${receipt ? 'بيانات محضر تحصيل' : 'تسجيل تحصيل / محضر'}</h2>
  <p class="exec-form-banner"><b>أبسط طريقة:</b> اكتب «المبلغ» و«التاريخ» فقط ← اضغط <b>«توزيع على الأقدم أولًا»</b> لتملأ الجدول أمامك (تراجع وتعديل) ← ثم «تسجيل التحصيل». الرصيد يُخصم تلقائيًا: المتبقي = الاستحقاق − المحصل.</p>
  <form class="exec-form exec-form-grid">
    ${field('المبلغ المحصل (بالجنيه)', `<input name="amount" type="number" step="0.01" min="0.01" value="${receipt?.amount ?? ''}" required ${receipt ? 'readonly' : ''} placeholder="مثال: 9000">`, 'الكمية النقدية الفعلية كما في المحضر/الإيصال (رقم فقط).', 'amount')}
    ${field('تاريخ التحصيل', `<input name="date" type="date" value="${esc(receipt?.date || localDate())}" required ${receipt ? 'readonly' : ''}>`, 'يوم الاستلام الفعلي للمبلغ — يُرتَّب به في الدفتر.', 'date')}
    ${field('طريقة التخصيص', `<select name="method">${options(ALLOCATION_METHODS, receipt?.allocationMethod || 'DIRECT')}</select>`, '«مباشر»: بالمبلغ لكل فترة بالأسفل. «الأقدم فالأحدث»: توزيع آلي على أقدم الفترات. «يدوي»: مبلغ محدد لكل فترة بقرارك.', 'method')}
    ${field('المحصّل', `<input name="collectorName" value="${esc(receipt?.collectorName || '')}" placeholder="اسم من نُقدَّم له">`, 'اسم الشخص أو القائم بالتحصيل كما في المحضر.', 'collectorName')}
    ${field('جهة التحصيل', `<input name="collectionSide" value="${esc(receipt?.collectionSide || '')}" placeholder="قلم تنفيذ الأسرة — المنصورة">`, 'الجهة التي نُفِّذ التحصيل من خلالها.', 'collectionSide')}
    ${field('طريقة الدفع', `<input name="paymentMethod" value="${esc(receipt?.paymentMethod || '')}" placeholder="نقدًا / تحويل / شيك">`, 'كيف وصل المبلغ: نقدًا، إنستاباي، شيك…', 'paymentMethod')}
    ${field('التوكيل المرتبط', `<select name="poaId">${options(poas.map(p => [p.id, `${p.poaNumber || ''} ${p.total ? money(p.total) : ''}`]), receipt?.poaId || '', '— بلا —')}</select>`, 'اختر التوكيل إن نُفِّذ التحصيل بمقتضاه — اختياري.', 'poaId')}
    ${field('مرجع / رقم مستند', `<input name="reference" value="${esc(receipt?.reference || '')}" placeholder="رقم إيصال / محضر">`, 'رقم المستند المُثبت للتحصيل — للتتبّع.', 'reference')}
    ${field('ملاحظات', `<textarea name="notes" rows="2">${esc(receipt?.notes || '')}</textarea>`, 'أي ملاحظة عن المحضر — لا تدخل الحساب.', 'notes')}
  </form>
  <div class="exec-alloc" ${receipt ? 'hidden' : ''}>
    <div class="exec-alloc-head"><b>② توزيع المبلغ على الفترات</b>
      <span class="badge">مجموع المتبقي: ${money(totalRemaining)}</span>
      <button type="button" class="ghost small" data-fill-oldest title="يملأ خانات التوزيع أمامك من الأقدم — ثم راجعها قبل الحفظ">↕ توزيع على الأقدم أولًا</button>
      <span class="muted small">اترك الخانات فارغة مع «مباشر» ليوزّعها البرنامج على الأقدم مع تنبيه، أو وزّعها بنفسك.</span>
    </div>
    <div class="exec-alloc-rows">${periods.slice(0, 60).map(period => `<label class="exec-alloc-row"><span>${esc(period.periodKey)}${period.partyId ? ' · طرف مرتبط' : ''}</span><small class="muted">المتبقي ${money(period.remaining)}${period.originalAmount !== period.finalAmount ? ` (أصلي ${money(period.originalOutstanding)} + فرق ${money(period.differencePart)})` : ''}</small><input type="number" step="0.01" min="0" data-period="${esc(period.periodKey)}" data-remaining="${num(period.remaining)}" placeholder="0"><small class="exec-hint">اكتب هنا المبلغ المخصّص لهذه الفترة من هذا المحضر (لا يزيد عن المتبقي أعلاه) — واتركه فارغًا إن لم تخصّص شيئًا.</small></label>`).join('') || '<p class="muted">لا توجد فترات متبقية — سيُسجَّل المبلغ بلا تخصيص حتى تراجع الفترات.</p>'}</div>
    ${periods.length > 60 ? '<p class="muted small">يُعرض أول 60 فترة؛ استخدم التخصيص المباشر للتوزيع أو راجع الفترات في البطاقة.</p>' : ''}
  </div>
  <div class="form-actions"><button type="button" class="primary" data-save>${receipt ? 'حفظ البيانات الوصفية' : 'تسجيل التحصيل'}</button><button type="button" class="ghost" data-close>إلغاء</button></div>`);
  card.querySelector('[data-close]').onclick = closeModal;
  // توزيع أمامي على الأقدم أولًا: يملأ الخانات فقط (لا يكتب شيئًا) فيراجع المستخدم قبل الحفظ
  card.querySelector('[data-fill-oldest]')?.addEventListener('click', () => {
    const amountInput = card.querySelector('[name="amount"]');
    let left = round2(num(amountInput?.value));
    if (!(left > 0)) { toast('اكتب المبلغ أولًا ثم اضغط التوزيع', 'error'); amountInput?.focus(); return; }
    const inputs = [...card.querySelectorAll('[data-period]')];
    inputs.forEach(input => { input.value = ''; });
    for (const input of inputs) {
      if (left <= 0.001) break;
      const room = round2(num(input.dataset.remaining));
      if (room <= 0.001) continue;
      const take = Math.min(left, room);
      input.value = String(take);
      left = round2(left - take);
    }
    toast(left > 0.001 ? `وزُيع ${money(round2(num(amountInput.value) - left))} — المتبقي ${money(left)} لم يكفِ كل الفترات` : 'تم التوزيع على الأقدم أولًا — راجع الخانات ثم سجّل');
  });
  card.querySelector('[data-save]').onclick = async () => {
    const data = formData(card.querySelector('form'));
    if (receipt) {
      const out = await run(() => L.updateReceiptDetails(app.office, receipt.id, data), 'تم تحديث بيانات المحضر');
      if (out) { closeModal(); await app.refresh(); }
      return;
    }
    const targets = [...card.querySelectorAll('[data-period]')].map(input => ({periodKey: input.dataset.period, amount: num(input.value)})).filter(line => line.amount > 0);
    const out = await run(() => L.recordCollection(app.office, {
      executionId, amount: data.amount, date: data.date, collectorName: data.collectorName,
      collectionSide: data.collectionSide, paymentMethod: data.paymentMethod, reference: data.reference,
      notes: data.notes, poaId: data.poaId, allocation: {method: data.method, targets}
    }), (row) => `محضر ${row.receipt.receiptNumber}: ${money(row.receipt.amount)}${row.unallocated ? ` — ${money(row.unallocated)} بلا تخصيص` : ''}`);
    if (out) { closeModal(); await app.refresh(); }
  };
  return card;
}

// ===== مصروف فعلي =====
export async function expenseDialog(app, executionId) {
  const card = modal(`<h2 class="modal-title">تسجيل مصروف فعلي</h2>
  <p class="muted small">المصروفات منفصلة عن أصل الاستحقاق (لا تزيد الرصيد ولا تنقصه). «يدخل في إجمالي التوكيل» قرارك أنت، ويُخزَّن كما اخترته.</p>
  <form class="exec-form exec-form-grid">
    ${field('نوع المصروف', `<select name="type">${options(EXPENSE_TYPES, 'EXECUTION_FEE')}</select>`, 'اختر الأقرب: رسم تنفيذ، دمغة، مصروف تحصيل، أو مصروف آخر.', 'type')}
    ${field('المبلغ (بالجنيه)', `<input name="amount" type="number" step="0.01" min="0.01" required placeholder="مثال: 600">`, 'قيمة المصروف الفعلية كما في الإيصال.', 'amount')}
    ${field('التاريخ', `<input name="date" type="date" value="${localDate()}" required>`, 'يوم دفع المصروف.', 'date')}
    ${field('رقم الإيصال / المرجع', `<input name="documentReferenceId" placeholder="مثال: إيصال 778">`, 'رقم مستند يثبت المصروف.', 'documentReferenceId')}
    ${field('يدخل في إجمالي التوكيل', `<select name="includeInPoa">${options([['true', 'نعم — يُدرج عند إنشاء التوكيل'], ['false', 'لا — يبقى موثقًا فقط']], 'false')}</select>`, '«نعم» يجعل مبلغ المصروف يظهر كسطر في التوكيل القادم. اختيارك يُحفظ كما هو.', 'includeInPoa')}
    ${field('ملاحظات', `<textarea name="notes" rows="2"></textarea>`, 'أي تفصيل عن المصروف.', 'notes')}
  </form>
  <div class="form-actions"><button type="button" class="primary" data-save>تسجيل المصروف</button><button type="button" class="ghost" data-close>إلغاء</button></div>`);
  card.querySelector('[data-close]').onclick = closeModal;
  card.querySelector('[data-save]').onclick = async () => {
    const data = formData(card.querySelector('form'));
    const out = await run(() => L.recordExpense(app.office, {...data, executionId, includeInPoa: data.includeInPoa === 'true'}), 'تم تسجيل المصروف');
    if (out) { closeModal(); await app.refresh(); }
  };
  return card;
}

// ===== عكس / تصحيح حركة =====
export async function ledgerCorrectDialog(app, executionId, entry) {
  const card = modal(`<h2 class="modal-title">${entry.type === 'REVERSAL' ? 'حركة عكس' : entry.type === 'ADJUSTMENT' ? 'تصحيح حركة' : 'حركة مالية'} — ${esc(LEDGER_TYPE_LABELS[entry.type] || entry.type)}</h2>
  <p class="muted small">الحركة الأصلية لا تُعدَّل ولا تُحذف: العكس والتصحيح سجلان جديدان مرتبطان بها.</p>
  <div class="exec-kv"><span>المبلغ الأصلي</span><b>${money(entry.amount)}</b><span>الصافي الحالي</span><b>${money(entry.netAmount ?? entry.amount)}</b><span>التاريخ</span><b>${esc(entry.date || '')}</b>${entry.reason ? `<span>السبب المسجل</span><b>${esc(entry.reason)}</b>` : ''}</div>
  <form class="exec-form exec-form-grid">
    ${field('الإجراء', `<select name="kind">${options([['REVERSAL', 'عكس كامل/جزئي (REVERSAL)'], ['ADJUSTMENT', 'تصحيح بالزيادة أو النقصان (ADJUSTMENT)']])}</select>`, '«عكس» يلغي أثر الحركة كاملة/جزئيًا. «تصحيح» يزيد أو ينقص مبلغها. كلاهما سجل جديد لا يمس الأصل.', 'kind')}
    ${field('المبلغ', `<input name="amount" type="number" step="0.01" min="0.01" value="${entry.netAmount ?? entry.amount}" required>`, 'قيمة العكس أو التصحيح — لا تتجاوز الأصل.', 'amount')}
    ${field('اتجاه التصحيح', `<select name="direction">${options([['increase', 'زيادة'], ['decrease', 'نقصان']], 'increase')}</select>`, 'يُستخدم مع التصحيح فقط: هل نزيد المبلغ أم ننقصه؟', 'direction')}
    ${field('السبب (إلزامي)', `<textarea name="reason" rows="2" required placeholder="مثال: سُجّل مرتين / رسوم فعلية أعلى"></textarea>`, 'اكتب لماذا تُصحَّح الحركة — يُحفظ في السجل ولا يمكن بعده تعديله.', 'reason')}
    ${field('تاريخ الإجراء', `<input name="date" type="date" value="${localDate()}">`, 'يوم العكس/التصحيح (افتراضيًا اليوم).', 'date')}
  </form>
  <div class="form-actions"><button type="button" class="primary" data-save>تسجيل الإجراء المالي</button><button type="button" class="ghost" data-close>إلغاء</button></div>`);
  card.querySelector('[data-close]').onclick = closeModal;
  card.querySelector('[data-save]').onclick = async () => {
    const data = formData(card.querySelector('form'));
    const action = data.kind === 'REVERSAL'
      ? () => L.reverseLedgerEntry(app.office, {executionId, ledgerId: entry.id, amount: data.amount, reason: data.reason, date: data.date})
      : () => L.adjustLedgerEntry(app.office, {executionId, ledgerId: entry.id, amount: data.amount, direction: data.direction, reason: data.reason, date: data.date});
    const out = await run(action, 'تم تسجيل الإجراء المالي');
    if (out) { closeModal(); await app.refresh(); }
  };
  return card;
}

// ===== إعادة تخصيص محضر =====
export async function reallocateDialog(app, receipt) {
  const context = await L.allocationContext(app.office, receipt.executionId);
  const periods = context.outstanding.periods.filter(period => period.remaining > 0.001 || context.allocations.some(a => a.receiptId === receipt.id && a.periodKey === period.periodKey));
  const current = await L.allocationsFor(app.office, {receiptId: receipt.id});
  const currentByKey = new Map(current.map(row => [row.periodKey, num(row.amount)]));
  const remainingByKey = new Map(periods.map(period => [period.periodKey, round2(period.remaining + (currentByKey.get(period.periodKey) || 0))]));
  const card = modal(`<h2 class="modal-title">إعادة تخصيص المحضر ${esc(receipt.receiptNumber || '')} (${money(receipt.amount)})</h2>
  <p class="muted small">التخصيص السابق يبقى محفوظًا بحالة «غير فعّال» في السجل، ويُكتب التخصيص الجديد.</p>
  <form class="exec-form">
    ${field('طريقة التخصيص', `<select name="method">${options(ALLOCATION_METHODS, receipt.allocationMethod || 'MANUAL')}</select>`, '«يدوي»: تكتب مبلغ كل فترة بنفسك. «الأقدم فالأحدث»: توزيع آلي على أقدم الفترات. «بالتناسب»: يوزع على كل الفترات بنسب متبقّيها.', 'method')}
  </form>
  <div class="exec-alloc-rows">${periods.slice(0, 80).map(period => `<label class="exec-alloc-row"><span>${esc(period.periodKey)}</span><small class="muted">المتاح ${money(remainingByKey.get(period.periodKey) ?? period.remaining)}</small><input type="number" step="0.01" min="0" data-period="${esc(period.periodKey)}" value="${currentByKey.get(period.periodKey) ?? ''}"><small class="exec-hint">اكتب هنا المبلغ الجديد المخصّص لهذه الفترة بعد إعادة التوزيع (لا يزيد عن المتاح أعلاه).</small></label>`).join('')}</div>
  <div class="form-actions"><button type="button" class="primary" data-save>حفظ التخصيص الجديد</button><button type="button" class="ghost" data-close>إلغاء</button></div>`);
  card.querySelector('[data-close]').onclick = closeModal;
  card.querySelector('[data-save]').onclick = async () => {
    const method = formData(card.querySelector('form')).method;
    const targets = [...card.querySelectorAll('[data-period]')].map(input => ({periodKey: input.dataset.period, amount: num(input.value)})).filter(line => line.amount > 0);
    const out = await run(() => L.reallocateReceipt(app.office, receipt.id, {method, targets}), 'تم تحديث التخصيص');
    if (out) { closeModal(); await app.refresh(); }
  };
  return card;
}

// ===== مراجعة تسوية الفروق =====
export async function settlementReviewDialog(app, settlementId) {
  const review = await DF.settlementReview(app.office, settlementId);
  const {settlement, rows} = review;
  const statusLabel = DIFFERENCE_STATUS_LABELS[settlement.status] || settlement.status;
  const isFeas = settlement.accountingModel === FEAS_MODEL;
  const total = round2(rows.reduce((sum, row) => sum + num(row.differenceAmount), 0));
  const card = modal(`<h2 class="modal-title">اعتماد تسوية فروق — ${esc(settlement.entitlementType || '')}</h2>
  <p class="muted small">${isFeas ? 'الفروق تفسيرية لقيمة اللقطة المعترف بها؛ الاعتماد والتثبيت لا ينشئان حركة دين ثانية. تُراجع بصمة المقارنة قبل القرار.' : 'لا تُسجَّل أي حركة مالية قبل قرارك. كل صف يوضح القيمة القديمة والجديدة والمحصل سابقًا والرصيد الناتج.'}</p>
  <div class="exec-kv"><span>الحالة</span><b>${esc(statusLabel)}</b><span>عدد الفترات</span><b>${rows.length}</b><span>إجمالي الفرق</span><b>${money(total)}</b>${settlement.note ? `<span>ملاحظة</span><b>${esc(settlement.note)}</b>` : ''}</div>
  <div class="exec-table-wrap"><table class="exec-table"><thead><tr><th>الفترة</th><th>قديم</th><th>جديد</th><th>محصل سابقًا</th><th>الفرق</th><th>الرصيد بعد الفرق</th><th>المعادلة</th></tr></thead>
  <tbody>${rows.map(row => `<tr class="${row.coverageRemoved ? 'exec-row-warn' : ''}"><td>${esc(row.periodKey)}</td><td>${money(row.oldValue)}</td><td>${money(row.newValue)}</td><td>${money(row.currentCollected ?? row.previouslyCollected)}</td><td>${money(row.differenceAmount)}</td><td>${money(row.currentRemaining ?? row.remainingAfter)}</td><td class="muted small">${esc(row.equation || '')}</td></tr>`).join('')}</tbody></table></div>
  <div class="exec-actions-row">
    <button type="button" class="primary" data-approve>اعتماد التسوية</button>
    <button type="button" class="ghost" data-reject>رفض التسوية</button>
    <button type="button" class="ghost" data-recompute>إعادة حساب</button>
    <button type="button" class="primary" data-post${settlement.status === 'APPROVED' ? '' : ' disabled'}>${isFeas ? 'تثبيت حالة التسوية (بلا حركة دين)' : 'ترحيل الفروق المعتمدة إلى الحركات'}</button>
    <button type="button" class="ghost" data-close>إغلاق</button>
  </div>`);
  card.querySelector('[data-close]').onclick = closeModal;
  const refreshDialog = async (message) => { closeModal(); if (message) toast(message); await settlementReviewDialog(app, settlementId); };
  const askedReason = async (message, okText, label) => {
    const answer = await confirmBox(message, {okText, input: true, label});
    if (!answer || answer.ok !== true) return null;
    return String(answer.value || '');
  };
  card.querySelector('[data-approve]').onclick = async () => {
    const reason = await askedReason(isFeas ? 'اعتماد الفروق التفسيرية لهذه التسوية؟ سيؤثر القرار في الرصيد المشتق مرة واحدة، بلا حركة دين إضافية.' : 'اعتماد فروق هذه التسوية؟ سيصبح الفرق قابلاً للترحيل إلى الحركات المالية.', 'اعتماد', 'سبب الاعتماد (اختياري)');
    if (reason === null) return;
    const out = await run(() => DF.decideSettlement(app.office, settlementId, {decision: 'approve', reason}), 'تم اعتماد التسوية');
    if (out) await refreshDialog();
  };
  card.querySelector('[data-reject]').onclick = async () => {
    const reason = await askedReason('رفض التسوية يلغي صفوف الفروق (بلا حركة مالية). هل تريد المتابعة؟', 'رفض', 'سبب الرفض');
    if (reason === null) return;
    const out = await run(() => DF.decideSettlement(app.office, settlementId, {decision: 'reject', reason}), 'تم رفض التسوية بلا أي حركة مالية');
    if (out) await refreshDialog();
  };
  card.querySelector('[data-recompute]').onclick = async () => {
    const out = await run(() => DF.recomputeSettlement(app.office, settlementId), 'أُعيد حساب التسوية والصفوف القديمة محفوظة بحالة ملغاة');
    if (out) await refreshDialog();
  };
  card.querySelector('[data-post]').onclick = async () => {
    const out = await run(() => DF.postSettlement(app.office, settlementId), result => isFeas ? `ثُبّتت حالة ${result.posted.length} فرقًا تفسيريًا دون إنشاء حركة دين` : `تم ترحيل ${result.posted.length} التزامًا معتمدًا إلى الحركات`);
    if (out) { closeModal(); await app.refresh(); }
  };
  return card;
}

// ===== توكيل تنفيذ =====
export async function poaDialog(app, executionId, {previousPoaId = ''} = {}) {
  const draft = await POA.buildPoaDraft(app.office, {executionId, previousPoaId, includeDifferences: true});
  const totals = draft.totals;
  const isFeas = draft.accountingModel === FEAS_MODEL;
  const currency = draft.currency || '';
  const fractionDigits = isFeas ? currencyFractionDigits(currency) : 2;
  const amountStep = isFeas ? String(10 ** -fractionDigits) : '0.01';
  const showMoney = value => isFeas ? `${Number(value || 0).toLocaleString('ar-EG', {minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits})} ${currency}` : money(value);
  const anyLine = (key) => draft.lines.find(line => line.key === key) || {};
  const differencesLine = anyLine('differences');
  const expensesLine = anyLine('expenses');
  const previousLine = anyLine('previousBalance');
  const card = modal(`<h2 class="modal-title">${previousPoaId ? 'إعادة توكيل تنفيذ' : 'إنشاء توكيل تنفيذ'}</h2>
  <p class="muted small">كل مبلغ في المسودة يحمل مصدره. ${isFeas ? 'هذا مستند لقطة لا ينشئ دينًا ولا يغيّر الرصيد؛ فروق الاعتراف مدمجة في كل فترة ولا تُجمع مرة ثانية.' : 'الإجمالي يتغيّر بحسب ما تختار إدراجه.'} لا يقدّر البرنامج أي رسم أو دمغة.</p>
  <div class="exec-kv">
    <span>فترة التوكيل</span><b>${esc(draft.fromDate)} → ${esc(draft.toDate)} (${draft.periodRows.length} فترة)</b>
    <span>قيمة الفترات الجديدة</span><b>${showMoney(totals.newPeriodValue)}</b>
    <span>الرصيد السابق الخارج عن الفترة</span><b>${showMoney(totals.previousBalance)}</b>
    <span>فروق أحكام معتمدة متاحة</span><b>${showMoney(totals.differences)}</b>
    <span>مصروفات مُعلَّمة للدخول</span><b>${showMoney(totals.expenses)}</b>
    ${previousPoaId ? `<span>الرصيد المشتق قبل الفترة</span><b>${showMoney(totals.derivedPreviousBalance ?? 0)}</b>` : ''}
  </div>
  <form class="exec-form exec-form-grid">
    ${field('رقم التوكيل / المرجع', `<input name="poaNumber" placeholder="اتركه فارغًا ليُرقَّم داخليًا POA-سنة-رقم">`, 'إن كان للتوكيل رقم خارجي اكتبه، وإلا اتركه فارغًا ليلتقط الرقم الداخلي.', 'poaNumber')}
    ${field('تاريخ التوكيل', `<input name="date" type="date" value="${isFeas ? '' : localDate()}" ${isFeas ? 'required' : ''}>`, 'يوم إصدار التوكيل فعليًا.', 'date')}
    ${field('من تاريخ (بداية فترة التوكيل)', `<input name="fromDate" type="date" value="${esc(draft.fromDate)}" ${isFeas ? 'required readonly' : ''}>`, 'الفترة التي يغطيها التوكيل من فيها — «الفترات الجديدة» تُحسب داخلها.', 'fromDate')}
    ${field('إلى تاريخ (نهاية فترة التوكيل)', `<input name="toDate" type="date" value="${esc(draft.toDate)}" ${isFeas ? 'required readonly' : ''}>`, 'نهاية الفترة المطلوبة في التوكيل.', 'toDate')}
    ${field('الدمغة الفعلية (إن وُجدت)', `<input name="stampAmount" type="number" step="${amountStep}" min="0">`, 'قيمة دمغة دفعتها فعليًا — رقم يدوي لا يقدّره البرنامج.', 'stampAmount')}
    ${field('مبلغ آخر (إن وُجد)', `<input name="extraAmount" type="number" step="${amountStep}" min="0">`, 'أي مبلغ إضافي تدفعه برهن التوكيل (أمانة تسليم مثلًا).', 'extraAmount')}
    ${field('وصف المبلغ الآخر', `<input name="extraLabel" placeholder="مثال: أمانة تسليم">`, 'تسمية المبلغ الإضافي ليظهر بها في التوكيل.', 'extraLabel')}
    ${field('ملاحظات', `<textarea name="notes" rows="2"></textarea>`, 'أي ملاحظة تُطبع مع التوكيل.', 'notes')}
  </form>
  <div class="exec-include">
    <label><input type="checkbox" data-include="previousBalance" ${previousLine.included !== false ? 'checked' : ''}> إدراج الرصيد السابق (${showMoney(totals.previousBalance)})<small class="exec-hint">متبقي من قبل فترة التوكيل الحالية — فعّله ليُدرج في الإجمالي، وألغِه إن كنت تُصدر توكيلًا للفترات الجديدة فقط.</small></label>
    <label><input type="checkbox" data-include="differences" ${isFeas ? 'disabled' : `${differencesLine.amount ? 'checked' : ''} ${differencesLine.amount ? '' : 'disabled'}`}> ${isFeas ? 'الفروق التفسيرية مدمجة في قيم الفترات — لا تُضاف منفصلة' : `إدراج فروق الأحكام المعتمدة (${showMoney(differencesLine.amount || 0)})`}<small class="exec-hint">${isFeas ? 'في FEAS الفرق جزء من قيمة الفترة نفسها ولا يُدرَج مبلغًا مستقلًا.' : 'زيادة الحكم اللاحق المعتمدة كمبلغ مستقل — ألغِه إن كانت الزيادة مطبّقة أصلًا داخل الفترات.'}</small></label>
    <label><input type="checkbox" data-include="expenses" ${totals.expenses > 0 && !isFeas ? 'checked' : ''}> إدراج المصروفات المُعلَّمة للدخول (${showMoney(totals.expenses)})<small class="exec-hint">مصروفات وُسمي سابقاً بـ«تدخل التوكيل» فقط؛ المصروفات غير المعلّمة لا تدخل مهما كان مقدارها.</small></label>
    <span class="exec-total">الإجمالي الحالي: <b data-total>${showMoney(totals.total)}</b></span>
  </div>
  <div class="form-actions"><button type="button" class="primary" data-save>حفظ التوكيل</button><button type="button" class="ghost" data-save-print>حفظ وطباعة</button><button type="button" class="ghost" data-close>إلغاء</button></div>`);
  card.querySelector('[data-close]').onclick = closeModal;
  const recalcTotal = () => {
    const include = key => card.querySelector(`[data-include="${key}"]`)?.checked;
    if (isFeas) {
      try {
        let minor = totals.newPeriodValueMinor + (include('previousBalance') ? totals.previousBalanceMinor : 0)
          + (include('expenses') ? totals.expensesMinor : 0)
          + toMinorUnits(card.querySelector('[name="stampAmount"]').value || '0', currency)
          + toMinorUnits(card.querySelector('[name="extraAmount"]').value || '0', currency);
        card.querySelector('[data-total]').textContent = showMoney(fromMinorUnits(minor, currency));
        return minor;
      } catch (error) {
        card.querySelector('[data-total]').textContent = 'راجع دقة العملة';
        return null;
      }
    }
    let total = totals.newPeriodValue + round2(num(card.querySelector('[name="stampAmount"]').value)) + round2(num(card.querySelector('[name="extraAmount"]').value));
    if (include('previousBalance')) total += num(totals.previousBalance);
    if (include('differences')) total += num(totals.differences);
    if (include('expenses')) total += num(totals.expenses);
    card.querySelector('[data-total]').textContent = money(round2(total));
    return round2(total);
  };
  card.querySelectorAll('[data-include],[name="stampAmount"],[name="extraAmount"]').forEach(input => input.addEventListener('input', recalcTotal));
  const save = async () => {
    const data = formData(card.querySelector('form'));
    const include = {previousBalance: card.querySelector('[data-include="previousBalance"]')?.checked, differences: card.querySelector('[data-include="differences"]')?.checked, expenses: card.querySelector('[data-include="expenses"]')?.checked};
    const lines = draft.lines.map(line => ({...line, included: line.key === 'previousBalance' ? Boolean(include.previousBalance) : line.key === 'differences' ? Boolean(include.differences) : line.key === 'expenses' ? Boolean(include.expenses) : line.included})).filter(line => line.included && num(line.amount) > 0);
    const extraLines = [];
    let stamp = round2(num(data.stampAmount));
    let extra = round2(num(data.extraAmount));
    let stampMinor = null, extraMinor = null;
    if (isFeas) {
      try {
        stampMinor = toMinorUnits(data.stampAmount || '0', currency);
        extraMinor = toMinorUnits(data.extraAmount || '0', currency);
        stamp = fromMinorUnits(stampMinor, currency);
        extra = fromMinorUnits(extraMinor, currency);
      } catch (error) { toast(userError(error), 'error'); return null; }
    }
    if (stamp > 0) extraLines.push({key: 'stamp', label: 'دمغة (قيمة فعلية)', amount: stamp, ...(isFeas ? {amountMinor: stampMinor} : {}), included: true, sourceType: 'manual', sourceIds: [], detail: 'قيمة يدوية أدخلها المستخدم'});
    if (extra > 0) extraLines.push({key: 'extra', label: data.extraLabel || 'مبلغ آخر', amount: extra, ...(isFeas ? {amountMinor: extraMinor} : {}), included: true, sourceType: 'manual', sourceIds: [], detail: 'قيمة يدوية أدخلها المستخدم'});
    const allLines = [...lines, ...extraLines];
    const total = round2(allLines.reduce((sum, line) => sum + num(line.amount), 0));
    const totalMinor = isFeas ? sumMinor(allLines, line => line.amountMinor) : null;
    return run(() => POA.saveExecutionPoa(app.office, {
      executionId, previousPoaId: draft.previousPoaId, poaNumber: data.poaNumber, date: data.date, fromDate: data.fromDate, toDate: data.toDate, currency,
      ...(isFeas ? {accountingModel: FEAS_MODEL, totalMinor, sourceFingerprint: draft.sourceFingerprint, idempotencyKey: draft.idempotencyKey} : {}),
      baseAmount: isFeas ? fromMinorUnits(totals.newPeriodValueMinor, currency) : data.fromDate !== draft.fromDate || data.toDate !== draft.toDate ? undefined : totals.newPeriodValue,
      previousBalance: include.previousBalance ? totals.previousBalance : 0,
      differencesAmount: include.differences ? totals.differences : 0,
      expensesAmount: include.expenses ? totals.expenses : 0,
      stampAmount: stamp, total: isFeas ? fromMinorUnits(totalMinor, currency) : (total || recalcTotal()), lines: allLines, notes: data.notes,
      judgmentIds: [...new Set(draft.periodRows.flatMap(row => row.sourceJudgmentIds || (row.judgmentId ? [row.judgmentId] : []))) ]
    }), (row) => `تم حفظ التوكيل ${row.poaNumber}`);
  };
  card.querySelector('[data-save]').onclick = async () => { const out = await save(); if (out) { closeModal(); await app.refresh(); } };
  card.querySelector('[data-save-print]').onclick = async () => {
    const out = await save();
    if (out) { closeModal(); await run(() => PR.printPoa(app.office, out.id), 'فُتح مستند التوكيل للطباعة'); await app.refresh(); }
  };
  return card;
}

// ===== إجراء تنفيذ =====
export async function actionDialog(app, executionId, {action = null} = {}) {
  const card = modal(`<h2 class="modal-title">${action ? 'تعديل إجراء' : 'تسجيل إجراء تنفيذ'}</h2>
  <p class="muted small">الإجراءات تنظيمية: يسجّلها المكتب بترتيبه الفعلي، ولا يفرض البرنامج سير عمل قانونيًا.</p>
  <form class="exec-form exec-form-grid">
    ${field('نوع الإجراء', `<select name="kind">${options(ACTION_KINDS, action?.kind || 'seizure')}</select>`, 'ما الذي جرى فعليًا: حجز، إعلان بيع، جلسة بيع، تبديد، رقم عرائض، رقم قضائي…', 'kind')}
    ${field('تاريخ الإجراء', `<input name="date" type="date" value="${esc(action?.date || localDate())}" required>`, 'يوم وقوع الإجراء.', 'date')}
    ${field('الرقم / المرجع', `<input name="referenceNumber" value="${esc(action?.referenceNumber || '')}" placeholder="مثال: ح-22/2025">`, 'رقم المحضر أو المرجع الخاص بالإجراء.', 'referenceNumber')}
    ${field('الجهة', `<input name="authority" value="${esc(action?.authority || '')}" placeholder="قلم تنفيذ الأسرة — المنصورة">`, 'الجهة التي نفّذت الإجراء.', 'authority')}
    ${field('الرقم القضائي', `<input name="judicialNumber" value="${esc(action?.judicialNumber || '')}">`, 'الرقم القضائي إن صدر للإجراء.', 'judicialNumber')}
    ${field('رقم العرائض', `<input name="petitionNumber" value="${esc(action?.petitionNumber || '')}">`, 'رقم العريضة المرتبطة إن وُجد.', 'petitionNumber')}
    ${field('حالة الإجراء', `<input name="status" value="${esc(action?.status || 'done')}" placeholder="تم / قيد التنفيذ">`, 'نص قصير يوضح هل انتهى الإجراء أم لا.', 'status')}
    ${field('ملاحظات', `<textarea name="notes" rows="2">${esc(action?.notes || '')}</textarea>`, 'تفاصيل الإجراء كما تسجلها المكتب.', 'notes')}
  </form>
  <div class="form-actions"><button type="button" class="primary" data-save>${action ? 'حفظ' : 'تسجيل الإجراء'}</button><button type="button" class="ghost" data-close>إلغاء</button></div>`);
  card.querySelector('[data-close]').onclick = closeModal;
  card.querySelector('[data-save]').onclick = async () => {
    const data = formData(card.querySelector('form'));
    const out = await run(() => EX.saveExecutionAction(app.office, {...data, executionId}, action?.id || null), action ? 'تم تحديث الإجراء' : 'تم تسجيل الإجراء');
    if (out) { closeModal(); await app.refresh(); }
  };
  return card;
}

// ===== لقطة الرصيد في تاريخ =====
export async function snapshotDialog(app, executionId) {
  const card = modal(`<h2 class="modal-title">الرصيد في تاريخ</h2>
  <p class="muted small">يُعاد الحساب من الفترات والحركات التي تاريخها حتى ذلك اليوم؛ لا يعتمد على أي رقم مخزَّن.</p>
  <form class="exec-form"><label class="exec-field" data-field="date"><span>حتى تاريخ (متى تريد الرصيد؟)</span><input name="date" type="date" value="${localDate()}" required><small class="exec-hint">يُعاد الحساب من الفترات والحركات التي تاريخها حتى هذا اليوم — مفيد لمعرفة «كم كان المتبقي في تاريخ معيّن».</small></label></form>
  <div data-snapshot class="exec-snapshot"></div>
  <div class="form-actions"><button type="button" class="primary" data-calc>حساب</button><button type="button" class="ghost" data-close>إغلاق</button></div>`);
  card.querySelector('[data-close]').onclick = closeModal;
  const calculate = async () => {
    const date = formData(card.querySelector('form')).date;
    const out = await run(() => B.balanceSnapshot(app.office, executionId, date));
    if (!out) return;
    const s = out.summary;
    const laterSlices = s.recordedLaterSlices || [];
    const snapshotMoney = value => value === null || value === undefined ? '—' : s.accountingModel === FEAS_MODEL
      ? `${Number(value).toLocaleString('ar-EG', {minimumFractionDigits: currencyFractionDigits(s.currency), maximumFractionDigits: currencyFractionDigits(s.currency)})} ${esc(s.currency || '')}`.trim()
      : money(value);
    card.querySelector('[data-snapshot]').innerHTML = `
      ${s.integrityBlocked ? `<p class="exec-alert exec-alert-error">${esc(s.integrityMessage || 'تعذر التحقق من سلامة الرصيد؛ لم تُعرض أرقام جزئية.')}</p>` : ''}
      <div class="exec-kv"><span>التاريخ</span><b>${esc(out.date)}</b><span>الاستحقاق النهائي</span><b>${snapshotMoney(s.finalEntitlement)}</b>
      <span>المحصل</span><b>${snapshotMoney(s.collected)}</b><span>الرصيد</span><b>${snapshotMoney(s.remaining)}</b>
      <span>رصيد أصلي</span><b>${snapshotMoney(s.originalOutstanding)}</b><span>فروق أحكام</span><b>${snapshotMoney(s.differencePart)}</b>
      <span>عدد الفترات</span><b>${s.periodCount}</b></div>
      <ul class="exec-equations">${(s.equations || []).map(line => `<li>${esc(line)}</li>`).join('')}</ul>
      <p class="muted small">${esc(out.note)}</p>
      ${laterSlices.length ? `<p class="muted small">تنبيه: ${laterSlices.length} شريحة سُجلت لاحقًا وتاريخ سريانها سابق لهذا التاريخ وقد تكون مشمولة في الحساب.</p>` : ''}`;
  };
  card.querySelector('[data-calc]').onclick = calculate;
  await calculate();
  return card;
}

// ===== محاكي «ماذا لو» =====
export async function simulatorDialog(app, executionId, {slices = []} = {}) {
  const types = [...new Set(slices.map(s => s.entitlementType))];
  const card = modal(`<h2 class="modal-title">محاكاة «ماذا لو» — بلا أي كتابة</h2>
  <p class="muted small">يحسب البرنامج أثر قيمة مقترحة على الفترات فقط. لا يُسجَّل حكم ولا حركة ولا يتغير الرصيد.</p>
  <form class="exec-form exec-form-grid">
    ${field('نوع الاستحقاق', `<select name="entitlementType">${options(types.map(t => [t, t]))}</select>`, 'أي نوع استحقاق تريد تجربة تغييره.', 'entitlementType')}
    ${field('القيمة المقترحة (بالجنيه)', `<input name="amount" type="number" step="0.01" min="0.01" required placeholder="مثال: 4000">`, 'القيمة الجديدة التي تريد رؤية أثرها — لن تُحفظ.', 'amount')}
    ${field('سريان مقترح', `<input name="effectiveFrom" type="date" value="${localDate()}" required>`, 'من أي يوم سترتفع/تنخفض القيمة — للتجربة فقط.', 'effectiveFrom')}
    ${field('حتى تاريخ', `<input name="throughDate" type="date" value="${esc(slices.at(-1)?.endDate || '')}">`, 'نطاق الحساب في المحاكاة — اختياري.', 'throughDate')}
  </form>
  <div data-simulation class="exec-simulation"></div>
  <div class="form-actions"><button type="button" class="primary" data-run>تشغيل المحاكاة</button><button type="button" class="ghost" data-close>إغلاق</button></div>`);
  card.querySelector('[data-close]').onclick = closeModal;
  card.querySelector('[data-run]').onclick = async () => {
    const data = formData(card.querySelector('form'));
    const out = await run(() => B.simulateValueChange(app.office, {...data, executionId, periodicity: slices.find(s => s.entitlementType === data.entitlementType)?.periodicity || 'monthly'}));
    if (!out) return;
    card.querySelector('[data-simulation]').innerHTML = `
      <div class="exec-kv"><span>الفرق المتوقع</span><b>${money(out.totals.difference)}</b><span>الإجمالي قبل</span><b>${money(out.totals.beforeTotal)}</b><span>الإجمالي بعد</span><b>${money(out.totals.afterTotal)}</b><span>الفترات المتأثرة</span><b>${out.rows.length}</b></div>
      <p class="muted small">${esc(out.warning)}</p>
      <div class="exec-table-wrap"><table class="exec-table"><thead><tr><th>الفترة</th><th>قديم</th><th>مقترح</th><th>الفرق</th></tr></thead><tbody>
      ${out.rows.map(row => `<tr><td>${esc(row.periodKey)}</td><td>${money(row.oldValue)}</td><td>${money(row.newValue)}</td><td>${money(row.difference)}</td></tr>`).join('')}</tbody></table></div>`;
  };
  return card;
}

// ===== مقارنة حكمين =====
export async function comparisonDialog(app, executionId, {judgments = []} = {}) {
  const card = modal(`<h2 class="modal-title">مقارنة حكمين</h2>
  <form class="exec-form exec-form-grid">
    ${field('الحكم الأول (الأقدم)', `<select name="first">${options(judgments.map(j => [j.id, `حكم ${j.judgmentNumber || '—'} ${j.judgmentDate || ''}`]))}</select>`, 'الحكم الذي سُجّل أولًا في السلسلة.', 'first')}
    ${field('الحكم الثاني (اللاحق)', `<select name="second">${options(judgments.map(j => [j.id, `حكم ${j.judgmentNumber || '—'} ${j.judgmentDate || ''}`]))}</select>`, 'الحكم اللاحق/الاستئناف — تُقارن القيمتان وأثره على الفترات.', 'second')}
  </form>
  <div data-comparison></div>
  <div class="form-actions"><button type="button" class="primary" data-run>مقارنة</button><button type="button" class="ghost" data-close>إغلاق</button></div>`);
  card.querySelector('[data-close]').onclick = closeModal;
  card.querySelector('[data-run]').onclick = async () => {
    const data = formData(card.querySelector('form'));
    const out = await run(() => B.compareJudgments(app.office, executionId, data.first, data.second));
    if (!out) return;
    card.querySelector('[data-comparison]').innerHTML = `
      <div class="exec-table-wrap"><table class="exec-table"><thead><tr><th>البند</th><th>الأول</th><th>الثاني</th></tr></thead><tbody>
      ${out.rows.map(row => `<tr><td>${esc(row.label)}</td><td>${esc(String(row.first))}</td><td>${esc(String(row.second))}</td></tr>`).join('')}</tbody></table></div>
      ${out.impact.length ? `<p class="muted small">الفترات المتأثرة بالحكم الثاني: ${out.impact.length} فترة بإجمالي فرق ${money(out.impact.reduce((sum, row) => sum + num(row.difference), 0))}. تُدار المراجعة من شاشة التسويات.</p>` : '<p class="muted small">لا يوجد أثر مالي مسجل للفرق بين الحكمين حتى الآن.</p>'}`;
  };
  return card;
}

// ===== طباعة الرصيد =====
export async function printBalanceDialog(app, executionId) {
  const card = modal(`<h2 class="modal-title">طباعة كشف الرصيد</h2>
  <p class="muted small">يُبنى الكشف من البيانات المسجلة، ويُعرض أولًا قبل الطباعة.</p>
  <form class="exec-form"><label class="exec-field" data-field="asOf"><span>حتى تاريخ (اختياري)</span><input name="asOf" type="date"><small class="exec-hint">اتركه فارغًا لحساب الرصيد حتى اليوم، أو حدّد تاريخًا لطباعة رصيد تاريخ معيّن.</small></label></form>
  <div class="form-actions"><button type="button" class="primary" data-print>فتح للمعاينة والطباعة</button><button type="button" class="ghost" data-close>إلغاء</button></div>`);
  card.querySelector('[data-close]').onclick = closeModal;
  card.querySelector('[data-print]').onclick = async () => {
    const asOf = formData(card.querySelector('form')).asOf;
    const out = await run(() => PR.printBalanceStatement(app.office, executionId, {asOf}), 'فُتح كشف الرصيد للطباعة');
    if (out !== null) closeModal();
  };
  return card;
}

export { EX, L, DF, POA, B, PR, money, round2, num, formatFileNumber, esc, localDate, Clock, LEDGER_TYPES, LEDGER_TYPE_LABELS, POA_STATUS_LABELS, EXECUTION_METHODS, EXECUTION_METHOD_LABELS, EXECUTION_STATUSES, EXECUTION_STATUS_LABELS, EXECUTION_TYPE_LABELS, ACTION_KIND_LABELS, VALUE_TYPE_LABELS, PERIODICITY_LABELS, ALLOCATION_METHOD_LABELS };
