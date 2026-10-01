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
import * as EX from '../services/execution.js';
import * as L from '../services/execution-ledger.js';
import * as DF from '../services/execution-differences.js';
import * as POA from '../services/execution-poa.js';
import * as B from '../services/execution-balance.js';
import * as PR from '../services/execution-print.js';

const options = (list, selected = '', emptyLabel = '') => `${emptyLabel ? `<option value="">${esc(emptyLabel)}</option>` : ''}${list.map(([value, label]) => `<option value="${esc(value)}"${String(value) === String(selected) ? ' selected' : ''}>${esc(label)}</option>`).join('')}`;
const field = (label, html, hint = '') => `<label class="exec-field"><span>${esc(label)}</span>${html}${hint ? `<small class="muted">${esc(hint)}</small>` : ''}</label>`;
const run = async (action, success) => {
  try {
    const out = await action();
    if (success) toast(typeof success === 'function' ? success(out) : success);
    return out;
  } catch (error) { toast(userError(error), 'error'); return null; }
};

// ===== تنفيذ: إنشاء/تعديل =====
export async function executionDialog(app, {execution = null} = {}) {
  const {openEntityForm} = await import('./form.js');
  openEntityForm(app, 'execution', {
    id: execution?.id || null,
    preset: execution ? {} : {executionType: 'family', openedDate: localDate(), status: 'active'},
    title: execution ? 'تعديل بيانات التنفيذ' : 'فتح تنفيذ جديد',
    onSaved: () => app.refresh()
  });
}

// ===== طرف تنفيذ =====
export async function partyDialog(app, executionId, {party = null, clients = [], opponents = []} = {}) {
  const card = modal(`<h2 class="modal-title">${party ? 'تعديل طرف تنفيذ' : 'إضافة طرف تنفيذ'}</h2>
  <p class="muted small">الصفة (مستحق / منفذ ضده) يسجلها المستخدم كما هي في الملف؛ البرنامج ينظم ولا يفرض وصفًا قانونيًا.</p>
  <form class="exec-form">
    ${field('الجهة', `<select name="side">${options([['creditor', 'مستحق (دائن)'], ['debtor', 'منفذ ضده (مدين)']], party?.side || 'creditor')}</select>`)}
    ${field('ربط بموكل مسجل', `<select name="clientId">${options(clients.map(c => [c.id, c.fullName]), party?.clientId || '', '— إدخال يدوي —')}</select>`)}
    ${field('ربط بخصم مسجل', `<select name="opponentId">${options(opponents.map(o => [o.id, o.name]), party?.opponentId || '', '— بلا —')}</select>`)}
    ${field('الاسم كما يظهر', `<input name="name" value="${esc(party?.name || '')}" placeholder="يُملأ تلقائيًا من الربط إن وُجد">`)}
    ${field('الصفة النصية', `<input name="role" value="${esc(party?.role || '')}" placeholder="مثال: مستحق عن نفسه / وصي / منفذ ضده">`)}
    ${field('النصيب (اختياري)', `<input name="share" type="number" step="0.01" min="0" value="${party?.share ?? ''}">`, 'لا يُوزَّع تلقائيًا على الفترات بلا طلب صريح')}
    ${field('ملاحظات', `<textarea name="notes" rows="2">${esc(party?.notes || '')}</textarea>`)}
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
export async function judgmentDialog(app, executionId, {judgment = null, previous = null, slices = []} = {}) {
  const types = [...new Set([...(slices || []).map(s => s.entitlementType), 'نفقة شهرية', 'نفقة أبناء', 'تعويض'])];
  const card = modal(`<h2 class="modal-title">${judgment ? 'تعديل بيانات حكم' : 'تسجيل حكم في سلسلة التنفيذ'}</h2>
  <p class="muted small">تاريخ الحكم ≠ تاريخ سريان القيمة: أدخل تاريخ السريان بنفسك، ولا يُستنتج تلقائيًا من تاريخ الحكم.</p>
  <form class="exec-form exec-form-grid">
    ${field('نوع الاستحقاق', `<input name="entitlementType" list="exec-types" value="${esc(judgment?.entitlementType || previous?.entitlementType || '')}" required><datalist id="exec-types">${types.map(t => `<option value="${esc(t)}"></option>`).join('')}</datalist>`)}
    ${field('نوع الحكم', `<select name="judgmentKind">${options([['original', 'حكم أصلي'], ['later', 'حكم لاحق / استئناف'], ['correction', 'تصحيح'], ['other', 'أخرى']], judgment?.judgmentKind || (previous ? 'later' : 'original'))}</select>`)}
    ${field('تاريخ الحكم', `<input name="judgmentDate" type="date" value="${esc(judgment?.judgmentDate || localDate())}" required>`)}
    ${field('رقم الحكم', `<input name="judgmentNumber" value="${esc(judgment?.judgmentNumber || '')}">`)}
    ${field('رقم الدعوى', `<input name="lawsuitNumber" value="${esc(judgment?.lawsuitNumber || '')}">`)}
    ${field('رقم الاستئناف', `<input name="appealNumber" value="${esc(judgment?.appealNumber || '')}">`)}
    ${field('المحكمة', `<input name="court" value="${esc(judgment?.court || '')}">`)}
    ${field('نوع القيمة', `<select name="valueType">${options(VALUE_TYPES, judgment?.valueType || 'periodic')}</select>`)}
    ${field('القيمة', `<input name="amount" type="number" step="0.01" min="0" value="${judgment?.amount ?? ''}" placeholder="مثال: 3000">`)}
    ${field('الدورية', `<select name="periodicity">${options(PERIODICITIES, judgment?.periodicity || 'monthly')}</select>`)}
    ${field('تاريخ سريان القيمة (إنذار سريان)', `<input name="effectiveFrom" type="date" value="${esc(judgment?.effectiveFrom || '')}">`, 'اتركه فارغًا إن لم يكن محددًا — البرنامج لا يخمّنه')}
    ${field('تاريخ انتهاء السريان (اختياري)', `<input name="effectiveTo" type="date" value="${esc(judgment?.effectiveTo || '')}">`)}
    ${field('منطوق الحكم (ملخص)', `<textarea name="operativeSummary" rows="2">${esc(judgment?.operativeSummary || '')}</textarea>`)}
    ${field('ملاحظات', `<textarea name="notes" rows="2">${esc(judgment?.notes || '')}</textarea>`)}
  </form>
  <div class="form-actions"><button type="button" class="primary" data-save>${judgment ? 'حفظ البيانات الوصفية' : 'تسجيل الحكم'}</button>
  ${judgment ? '' : '<button type="button" class="ghost" data-save-slice>تسجيل الحكم + إنشاء شريحة قيمة</button>'}
  <button type="button" class="ghost" data-close>إلغاء</button></div>`);
  card.querySelector('[data-close]').onclick = closeModal;
  const collect = () => ({...formData(card.querySelector('form')), executionId});
  const saveJudgment = async () => {
    if (judgment) return run(() => EX.updateExecutionJudgment(app.office, judgment.id, collect()), 'تم حفظ بيانات الحكم');
    return run(() => EX.addExecutionJudgment(app.office, {...collect(), previousJudgmentId: previous?.id || ''}), 'تم تسجيل الحكم في السلسلة');
  };
  card.querySelector('[data-save]').onclick = async () => { const out = await saveJudgment(); if (out) { closeModal(); await app.refresh(); } };
  card.querySelector('[data-save-slice]')?.addEventListener('click', async () => {
    const data = collect();
    const created = await run(async () => {
      const row = await EX.addExecutionJudgment(app.office, {...data, previousJudgmentId: previous?.id || ''});
      if (!data.amount || num(data.amount) <= 0) throw new Error('أدخل قيمة الحكم لإنشاء شريحة قيمة.');
      const slice = await EX.saveValueSlice(app.office, {
        executionId, judgmentId: row.id, entitlementType: data.entitlementType, valueType: data.valueType,
        periodicity: data.periodicity, amount: data.amount, startDate: data.effectiveFrom || data.judgmentDate,
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
export async function sliceDialog(app, executionId, {slices = [], judgments = []} = {}) {
  const card = modal(`<h2 class="modal-title">شريحة قيمة جديدة</h2>
  <p class="muted small">لا تُعدَّل شريحة تاريخية أبدًا: التغيير يُسجَّل كشريحة جديدة، والقديمة تبقى كما هي في السجل.</p>
  <form class="exec-form exec-form-grid">
    ${field('نوع الاستحقاق', `<input name="entitlementType" value="${esc(slices.at(-1)?.entitlementType || '')}" required list="exec-types-2"><datalist id="exec-types-2">${[...new Set(slices.map(s => s.entitlementType))].map(t => `<option value="${esc(t)}"></option>`).join('')}</datalist>`)}
    ${field('الحكم المصدر', `<select name="judgmentId" required>${options(judgments.map(j => [j.id, `حكم ${j.judgmentNumber || '—'} ${j.judgmentDate || ''} (${num(j.amount) ? money(j.amount) : 'بلا قيمة'})`]), '', 'اختر الحكم')}</select>`)}
    ${field('نوع القيمة', `<select name="valueType">${options(VALUE_TYPES, 'periodic')}</select>`)}
    ${field('القيمة', `<input name="amount" type="number" step="0.01" min="0.01" required>`)}
    ${field('الدورية', `<select name="periodicity">${options(PERIODICITIES, 'monthly')}</select>`)}
    ${field('بداية سريان القيمة', `<input name="startDate" type="date" value="${localDate()}" required>`)}
    ${field('نهاية السريان (اختياري)', `<input name="endDate" type="date">`)}
    ${field('ملاحظات', `<textarea name="notes" rows="2"></textarea>`)}
  </form>
  <div class="form-actions"><button type="button" class="primary" data-save>إنشاء الشريحة ومعاينة أثرها</button><button type="button" class="ghost" data-close>إلغاء</button></div>`);
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
  const card = modal(`<h2 class="modal-title">${receipt ? 'بيانات محضر تحصيل' : 'تسجيل تحصيل / محضر'}</h2>
  <p class="muted small">المبلغ يُخصَّص على الفترات باختيارك. لا يفترض البرنامج قاعدة «الأقدم أولًا» إلا إذا اخترتها صراحةً.</p>
  <form class="exec-form exec-form-grid">
    ${field('المبلغ', `<input name="amount" type="number" step="0.01" min="0.01" value="${receipt?.amount ?? ''}" required ${receipt ? 'readonly' : ''}>`)}
    ${field('التاريخ', `<input name="date" type="date" value="${esc(receipt?.date || localDate())}" required ${receipt ? 'readonly' : ''}>`)}
    ${field('طريقة التخصيص', `<select name="method">${options(ALLOCATION_METHODS, receipt?.allocationMethod || 'DIRECT')}</select>`)}
    ${field('المحصّل', `<input name="collectorName" value="${esc(receipt?.collectorName || '')}">`)}
    ${field('جهة التحصيل', `<input name="collectionSide" value="${esc(receipt?.collectionSide || '')}" placeholder="محكمة / مكتب / جهة">`)}
    ${field('طريقة الدفع', `<input name="paymentMethod" value="${esc(receipt?.paymentMethod || '')}" placeholder="نقدًا / تحويل / شيك">`)}
    ${field('مرجع / توكيل', `<select name="poaId">${options(poas.map(p => [p.id, `${p.poaNumber || ''} ${p.total ? money(p.total) : ''}`]), receipt?.poaId || '', '— بلا —')}</select>`)}
    ${field('مرجع آخر', `<input name="reference" value="${esc(receipt?.reference || '')}">`)}
    ${field('ملاحظات', `<textarea name="notes" rows="2">${esc(receipt?.notes || '')}</textarea>`)}
  </form>
  <div class="exec-alloc" ${receipt ? 'hidden' : ''}>
    <div class="exec-alloc-head"><b>تخصيص المبلغ على الفترات</b><span class="muted small">اترك المبالغ فارغة مع «مباشر» ليوزّعها البرنامج على الأقدم مع تسجيل تنبيه صريح، أو أدخل المبالغ يدويًا.</span></div>
    <div class="exec-alloc-rows">${periods.slice(0, 60).map(period => `<label class="exec-alloc-row"><span>${esc(period.periodKey)}${period.partyId ? ' · طرف مرتبط' : ''}</span><small class="muted">المتبقي ${money(period.remaining)}${period.originalAmount !== period.finalAmount ? ` (أصلي ${money(period.originalOutstanding)} + فرق ${money(period.differencePart)})` : ''}</small><input type="number" step="0.01" min="0" data-period="${esc(period.periodKey)}" placeholder="0"></label>`).join('') || '<p class="muted">لا توجد فترات متبقية — سيُسجَّل المبلغ بلا تخصيص حتى تراجع الفترات.</p>'}</div>
    ${periods.length > 60 ? '<p class="muted small">يُعرض أول 60 فترة؛ استخدم التخصيص المباشر للتوزيع أو راجع الفترات في البطاقة.</p>' : ''}
  </div>
  <div class="form-actions"><button type="button" class="primary" data-save>${receipt ? 'حفظ البيانات الوصفية' : 'تسجيل التحصيل'}</button><button type="button" class="ghost" data-close>إلغاء</button></div>`);
  card.querySelector('[data-close]').onclick = closeModal;
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
  <p class="muted small">المصروفات منفصلة عن أصل الاستحقاق. «يدخل في إجمالي التوكيل» قرارك أنت، ويُخزَّن كما اخترته.</p>
  <form class="exec-form exec-form-grid">
    ${field('النوع', `<select name="type">${options(EXPENSE_TYPES, 'EXECUTION_FEE')}</select>`)}
    ${field('المبلغ', `<input name="amount" type="number" step="0.01" min="0.01" required>`)}
    ${field('التاريخ', `<input name="date" type="date" value="${localDate()}" required>`)}
    ${field('مرجع', `<input name="documentReferenceId" placeholder="رقم إيصال / مرجع">`)}
    ${field('يدخل في إجمالي التوكيل', `<select name="includeInPoa">${options([['true', 'نعم — يُدرج عند طلبه'], ['false', 'لا — يبقى موثقًا فقط']], 'false')}</select>`)}
    ${field('ملاحظات', `<textarea name="notes" rows="2"></textarea>`)}
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
    ${field('الإجراء', `<select name="kind">${options([['REVERSAL', 'عكس كامل/جزئي (REVERSAL)'], ['ADJUSTMENT', 'تصحيح بالزيادة أو النقصان (ADJUSTMENT)']])}</select>`)}
    ${field('المبلغ', `<input name="amount" type="number" step="0.01" min="0.01" value="${entry.netAmount ?? entry.amount}" required>`)}
    ${field('اتجاه التصحيح', `<select name="direction">${options([['increase', 'زيادة'], ['decrease', 'نقصان']], 'increase')}</select>`, 'يُستخدم مع التصحيح فقط')}
    ${field('السبب (إلزامي)', `<textarea name="reason" rows="2" required placeholder="مثال: سُجّل مرتين / رسوم فعلية أعلى"></textarea>`)}
    ${field('تاريخ الإجراء', `<input name="date" type="date" value="${localDate()}">`)}
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
    ${field('طريقة التخصيص', `<select name="method">${options(ALLOCATION_METHODS, receipt.allocationMethod || 'MANUAL')}</select>`)}
  </form>
  <div class="exec-alloc-rows">${periods.slice(0, 80).map(period => `<label class="exec-alloc-row"><span>${esc(period.periodKey)}</span><small class="muted">المتاح ${money(remainingByKey.get(period.periodKey) ?? period.remaining)}</small><input type="number" step="0.01" min="0" data-period="${esc(period.periodKey)}" value="${currentByKey.get(period.periodKey) ?? ''}"></label>`).join('')}</div>
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
  const total = round2(rows.reduce((sum, row) => sum + num(row.differenceAmount), 0));
  const card = modal(`<h2 class="modal-title">اعتماد تسوية فروق — ${esc(settlement.entitlementType || '')}</h2>
  <p class="muted small">لا تُسجَّل أي حركة مالية قبل قرارك. كل صف يوضح القيمة القديمة والجديدة والمحصل سابقًا والرصيد الناتج.</p>
  <div class="exec-kv"><span>الحالة</span><b>${esc(statusLabel)}</b><span>عدد الفترات</span><b>${rows.length}</b><span>إجمالي الفرق</span><b>${money(total)}</b>${settlement.note ? `<span>ملاحظة</span><b>${esc(settlement.note)}</b>` : ''}</div>
  <div class="exec-table-wrap"><table class="exec-table"><thead><tr><th>الفترة</th><th>قديم</th><th>جديد</th><th>محصل سابقًا</th><th>الفرق</th><th>الرصيد بعد الفرق</th><th>المعادلة</th></tr></thead>
  <tbody>${rows.map(row => `<tr class="${row.coverageRemoved ? 'exec-row-warn' : ''}"><td>${esc(row.periodKey)}</td><td>${money(row.oldValue)}</td><td>${money(row.newValue)}</td><td>${money(row.currentCollected ?? row.previouslyCollected)}</td><td>${money(row.differenceAmount)}</td><td>${money(row.currentRemaining ?? row.remainingAfter)}</td><td class="muted small">${esc(row.equation || '')}</td></tr>`).join('')}</tbody></table></div>
  <div class="exec-actions-row">
    <button type="button" class="primary" data-approve>اعتماد التسوية</button>
    <button type="button" class="ghost" data-reject>رفض التسوية</button>
    <button type="button" class="ghost" data-recompute>إعادة حساب</button>
    <button type="button" class="primary" data-post${settlement.status === 'APPROVED' ? '' : ' disabled'}>ترحيل الفروق المعتمدة إلى الحركات</button>
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
    const reason = await askedReason('اعتماد فروق هذه التسوية؟ سيصبح الفرق قابلاً للترحيل إلى الحركات المالية.', 'اعتماد', 'سبب الاعتماد (اختياري)');
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
    const out = await run(() => DF.postSettlement(app.office, settlementId), (result) => `تم ترحيل ${result.posted.length} التزامًا معتمدًا إلى الحركات`);
    if (out) { closeModal(); await app.refresh(); }
  };
  return card;
}

// ===== توكيل تنفيذ =====
export async function poaDialog(app, executionId, {previousPoaId = ''} = {}) {
  const draft = await POA.buildPoaDraft(app.office, {executionId, previousPoaId, includeDifferences: true});
  const totals = draft.totals;
  const anyLine = (key) => draft.lines.find(line => line.key === key) || {};
  const differencesLine = anyLine('differences');
  const expensesLine = anyLine('expenses');
  const previousLine = anyLine('previousBalance');
  const card = modal(`<h2 class="modal-title">${previousPoaId ? 'إعادة توكيل تنفيذ' : 'إنشاء توكيل تنفيذ'}</h2>
  <p class="muted small">كل مبلغ في المسودة يحمل مصدره. الإجمالي يتغيّر بحسب ما تختار إدراجه، ولا يقدّر البرنامج أي رسم أو دمغة.</p>
  <div class="exec-kv">
    <span>فترة التوكيل</span><b>${esc(draft.fromDate)} → ${esc(draft.toDate)} (${draft.periodRows.length} فترة)</b>
    <span>قيمة الفترات الجديدة</span><b>${money(totals.newPeriodValue)}</b>
    <span>الرصيد السابق الخارج عن الفترة</span><b>${money(totals.previousBalance)}</b>
    <span>فروق أحكام معتمدة متاحة</span><b>${money(totals.differences)}</b>
    <span>مصروفات مُعلَّمة للدخول</span><b>${money(totals.expenses)}</b>
    ${previousPoaId ? `<span>الرصيد المشتق قبل الفترة</span><b>${money(totals.derivedPreviousBalance ?? 0)}</b>` : ''}
  </div>
  <form class="exec-form exec-form-grid">
    ${field('رقم التوكيل / المرجع', `<input name="poaNumber" placeholder="اتركه فارغًا ليُرقَّم داخليًا POA-سنة-رقم">`)}
    ${field('تاريخ التوكيل', `<input name="date" type="date" value="${localDate()}">`)}
    ${field('من تاريخ', `<input name="fromDate" type="date" value="${esc(draft.fromDate)}">`)}
    ${field('إلى تاريخ', `<input name="toDate" type="date" value="${esc(draft.toDate)}">`)}
    ${field('الدمغة الفعلية (إن وُجدت)', `<input name="stampAmount" type="number" step="0.01" min="0">`, 'قيمة يدوية فقط')}
    ${field('مبلغ آخر', `<input name="extraAmount" type="number" step="0.01" min="0">`)}
    ${field('وصف المبلغ الآخر', `<input name="extraLabel" placeholder="مثال: أمانة تسليم">`)}
    ${field('ملاحظات', `<textarea name="notes" rows="2"></textarea>`)}
  </form>
  <div class="exec-include">
    <label><input type="checkbox" data-include="previousBalance" ${previousLine.included !== false ? 'checked' : ''}> إدراج الرصيد السابق (${money(totals.previousBalance)})</label>
    <label><input type="checkbox" data-include="differences" ${differencesLine.amount ? 'checked' : ''} ${differencesLine.amount ? '' : 'disabled'}> إدراج فروق الأحكام المعتمدة (${money(differencesLine.amount || 0)})</label>
    <label><input type="checkbox" data-include="expenses"> إدراج المصروفات المُعلَّمة للدخول (${money(totals.expenses)})</label>
    <span class="exec-total">الإجمالي الحالي: <b data-total>${money(totals.total)}</b></span>
  </div>
  <div class="form-actions"><button type="button" class="primary" data-save>حفظ التوكيل</button><button type="button" class="ghost" data-save-print>حفظ وطباعة</button><button type="button" class="ghost" data-close>إلغاء</button></div>`);
  card.querySelector('[data-close]').onclick = closeModal;
  const recalcTotal = () => {
    const include = key => card.querySelector(`[data-include="${key}"]`)?.checked;
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
    const stamp = round2(num(data.stampAmount));
    const extra = round2(num(data.extraAmount));
    if (stamp > 0) extraLines.push({key: 'stamp', label: 'دمغة (قيمة فعلية)', amount: stamp, included: true, sourceType: 'manual', sourceIds: [], detail: 'قيمة يدوية أدخلها المستخدم'});
    if (extra > 0) extraLines.push({key: 'extra', label: data.extraLabel || 'مبلغ آخر', amount: extra, included: true, sourceType: 'manual', sourceIds: [], detail: 'قيمة يدوية أدخلها المستخدم'});
    const allLines = [...lines, ...extraLines];
    const total = round2(allLines.reduce((sum, line) => sum + num(line.amount), 0));
    return run(() => POA.saveExecutionPoa(app.office, {
      executionId, previousPoaId: draft.previousPoaId, poaNumber: data.poaNumber, date: data.date, fromDate: data.fromDate, toDate: data.toDate,
      baseAmount: data.fromDate !== draft.fromDate || data.toDate !== draft.toDate ? undefined : totals.newPeriodValue,
      previousBalance: include.previousBalance ? totals.previousBalance : 0,
      differencesAmount: include.differences ? totals.differences : 0,
      expensesAmount: include.expenses ? totals.expenses : 0,
      stampAmount: stamp, total: total || recalcTotal(), lines: allLines, notes: data.notes,
      judgmentIds: draft.periodRows.map(row => row.judgmentId).filter(Boolean)
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
    ${field('نوع الإجراء', `<select name="kind">${options(ACTION_KINDS, action?.kind || 'seizure')}</select>`)}
    ${field('التاريخ', `<input name="date" type="date" value="${esc(action?.date || localDate())}" required>`)}
    ${field('الرقم / المرجع', `<input name="referenceNumber" value="${esc(action?.referenceNumber || '')}">`)}
    ${field('الجهة', `<input name="authority" value="${esc(action?.authority || '')}">`)}
    ${field('الرقم القضائي', `<input name="judicialNumber" value="${esc(action?.judicialNumber || '')}">`)}
    ${field('رقم العرائض', `<input name="petitionNumber" value="${esc(action?.petitionNumber || '')}">`)}
    ${field('الحالة', `<input name="status" value="${esc(action?.status || 'done')}">`)}
    ${field('ملاحظات', `<textarea name="notes" rows="2">${esc(action?.notes || '')}</textarea>`)}
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
  <form class="exec-form"><label class="exec-field"><span>التاريخ</span><input name="date" type="date" value="${localDate()}" required></label></form>
  <div data-snapshot class="exec-snapshot"></div>
  <div class="form-actions"><button type="button" class="primary" data-calc>حساب</button><button type="button" class="ghost" data-close>إغلاق</button></div>`);
  card.querySelector('[data-close]').onclick = closeModal;
  const calculate = async () => {
    const date = formData(card.querySelector('form')).date;
    const out = await run(() => B.balanceSnapshot(app.office, executionId, date));
    if (!out) return;
    const s = out.summary;
    const laterSlices = s.recordedLaterSlices || [];
    card.querySelector('[data-snapshot]').innerHTML = `
      <div class="exec-kv"><span>التاريخ</span><b>${esc(out.date)}</b><span>الاستحقاق النهائي</span><b>${money(s.finalEntitlement)}</b>
      <span>المحصل</span><b>${money(s.collected)}</b><span>الرصيد</span><b>${money(s.remaining)}</b>
      <span>رصيد أصلي</span><b>${money(s.originalOutstanding)}</b><span>فروق أحكام</span><b>${money(s.differencePart)}</b>
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
    ${field('نوع الاستحقاق', `<select name="entitlementType">${options(types.map(t => [t, t]))}</select>`)}
    ${field('القيمة المقترحة', `<input name="amount" type="number" step="0.01" min="0.01" required>`)}
    ${field('سريان مقترح', `<input name="effectiveFrom" type="date" value="${localDate()}" required>`)}
    ${field('حتى تاريخ', `<input name="throughDate" type="date" value="${esc(slices.at(-1)?.endDate || '')}">`)}
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
    ${field('الحكم الأول', `<select name="first">${options(judgments.map(j => [j.id, `حكم ${j.judgmentNumber || '—'} ${j.judgmentDate || ''}`]))}</select>`)}
    ${field('الحكم الثاني', `<select name="second">${options(judgments.map(j => [j.id, `حكم ${j.judgmentNumber || '—'} ${j.judgmentDate || ''}`]))}</select>`)}
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
  <form class="exec-form"><label class="exec-field"><span>حتى تاريخ (اختياري)</span><input name="asOf" type="date"></label></form>
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
