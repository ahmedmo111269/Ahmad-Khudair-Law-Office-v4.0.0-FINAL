// =====================================================================
// خدمة التنفيذ المبسّطة (Application Service)
// ---------------------------------------------------------------------
// • الشاشات الجديدة لا تستدعي إلا هذه الخدمة: نموذج واحد للإنشاء، ونموذج
//   تسجيل واحد (تحصيل/إجراء/مصروف/حكم لاحق/توكيل/ملاحظة)، وحساب مشتق.
// • لا حذف فعلي: الإلغاء = حالة مسجلة بسبب، والتعديل = نسخة قديمة محفوظة.
// • كل الكتابات داخل Transaction على الـ stores القائمة (بلا مخزن موازٍ)،
//   وكل عملية تُسجَّل في Activity Log القائم.
// • المبالغ تُحسب بالوحدات الصغرى (القروش) ولا تُخزَّن أرصدة قابلة للتحرير.
// =====================================================================
import {STORE} from '../db/schema.js';
import {transaction, request} from '../db/unit-of-work.js';
import {uid} from '../core/id.js';
import {Clock, localDate} from '../core/clock.js';
import {AppError, ERR} from '../core/errors.js';
import {events} from '../core/events.js';
import {isCivilDate, addCivilDays} from '../domain/execution-calendar.js';
import {buildExecutionSchedule, claimForRange, previewValueChange, buildPoaFigures, currencyCode, minorFromRow, monthLabel, PERIOD_STATUS} from '../domain/execution-schedule.js';
import {addMinor, fromMinorUnits, sumMinor, toMinorUnits} from '../domain/execution-money.js';
import {executionSettings} from './execution-settings.js';
import {addExecutionJudgment, saveValueSlice, createExecution, saveExecutionParty, cancelValueSlice, deleteExecutionJudgment, refreshExecutionSearchText} from './execution.js';
import {saveEntity} from './entity-save.js';
import {createLegalFile} from './legal-files.js';

const MAX_CHILD_ROWS = 3000;
const RAW_LIMIT = 5000;
const IDB = () => globalThis.IDBKeyRange;
const now = () => Clock.now();
const only = key => IDB().only(key);
const emitChanged = (entityType, id) => events.emit('entity:changed', {entityType, id});

const activityRow = (office, entityType, entityId, action, summary, fileId = '', metadata = {}) => ({
  id: uid(), entityType, entityId, action, timestamp: now(), summary, metadata: {...metadata, ...(fileId ? {} : {})}, ...(fileId ? {fileId} : {})
});

function requireAmount(value, currency, {allowZero = false, label = 'المبلغ'} = {}) {
  let minor;
  try { minor = toMinorUnits(value, currencyCode(currency)); } catch (error) { throw new AppError(ERR.VALIDATION, `${label}: ${error.message}`, {amount: error.message}); }
  if (!allowZero && !(minor > 0)) throw new AppError(ERR.VALIDATION, `${label} يجب أن يكون أكبر من صفر.`, {amount: 'مطلوب'});
  return minor;
}

async function requireExecution(office, executionId) {
  const execution = await office.r.execution.get(executionId);
  if (!execution || execution.isDeleted) throw new AppError(ERR.NOT_FOUND, 'سجل التنفيذ غير موجود.');
  return execution;
}

async function childrenRaw(office, store, executionId, limit = MAX_CHILD_ROWS) {
  return office.r[store].byIndexRaw('executionId', executionId, Math.min(limit, RAW_LIMIT));
}

/** قراءة كل ما يلزم لحساب الجدول (مشتق، بلا أي كتابة). */
export async function executionSimpleInputs(office, executionId, {includeDeletedChildren = false} = {}) {
  const execution = await requireExecution(office, executionId);
  const read = store => (includeDeletedChildren ? childrenRaw(office, store, executionId) : office.r[store].byIndex('executionId', executionId, MAX_CHILD_ROWS));
  const [slices, receipts, allocations, ledger, parties, actions, judgments, poas, periods, differences] = await Promise.all([
    read(STORE.executionValuePeriods).catch(() => []),
    read(STORE.executionReceipts).catch(() => []),
    read(STORE.executionAllocations).catch(() => []),
    read(STORE.executionLedger).catch(() => []),
    read(STORE.executionParties).catch(() => []),
    read(STORE.executionActions).catch(() => []),
    read(STORE.judgments).catch(() => []),
    read(STORE.executionPOAs).catch(() => []),
    read(STORE.executionPeriods).catch(() => []),
    read(STORE.differenceRecords).catch(() => [])
  ]);
  return {execution, slices, receipts, allocations, ledger, parties, actions, judgments, poas, periods, differences};
}

/** الجدول المشتق + الأرقام الثلاثة (كتابة صفر). */
export async function simpleSchedule(office, executionId, {asOf = '', fromDate = ''} = {}) {
  const inputs = await executionSimpleInputs(office, executionId);
  const settings = executionSettings(office);
  const schedule = buildExecutionSchedule({
    slices: capSlicesAtHorizon(inputs.execution, inputs.slices, feasRecognizedThrough(inputs.periods)), receipts: inputs.receipts, allocations: inputs.allocations, ledger: inputs.ledger,
    settings: settings.schedule, asOf: isCivilDate(asOf) ? asOf : localDate(), fromDate
  });
  schedule.expenses = expensesFrom(inputs.ledger, settings);
  return {...inputs, schedule, settings};
}

/**
 * أقصى تاريخ يُحسب إليه الاستحقاق: إذا سجّل المكتب «تاريخ الاستحقاق حتى» على
 * التنفيذ فلا يتجاوزه أي حساب (لا فترات وهمية بعد نهاية المدة المسجلة).
 * يُستخدم في كل مسارات الحساب: الجدول، صفوف القائمة، المدة، والتوكيل.
 */
export function claimHorizon(execution, asOf = '') {
  const requested = isCivilDate(asOf) ? asOf : localDate();
  const through = isCivilDate(execution?.entitlementThroughDate) ? execution.entitlementThroughDate : '';
  return through && through < requested ? through : requested;
}

/**
 * «تاريخ الاستحقاق حتى» يوقف توليد الفترات عند تاريخه فقط — ولا يمنع تسجيل
 * تحصيل متأخر بعده. لذلك نُقصّ نهاية البنود المفتوحة بدل قصّ تاريخ الحساب:
 * التحصيلات تبقى داخلة في التوزيع لأن تاريخ الحساب لم يتغيّر.
 */
export function capSlicesAtHorizon(execution, slices = [], extraThrough = '') {
  const declared = isCivilDate(execution?.entitlementThroughDate) ? execution.entitlementThroughDate : '';
  const extra = isCivilDate(extraThrough) ? extraThrough : '';
  const through = declared && extra ? (declared < extra ? declared : extra) : (declared || extra);
  if (!through) return slices;
  return (slices || []).map(slice => {
    const end = isCivilDate(slice?.endDate) ? slice.endDate : '';
    if (end && end <= through) return slice;
    return {...slice, endDate: through};
  });
}

/**
 * آخر نهاية فترة **معترف بها** (RECOGNIZED/CLOSED) في مسار FEAS القديم.
 * التنفيذ المسجَّل بنموذج FEAS تبقى فتراته المعترف بها هي المرجع، فلا نبني
 * حسابًا جديدًا يمتد بعدها ويربك المستخدم برقمين مختلفين لنفس التنفيذ.
 */
export function feasRecognizedThrough(periods = []) {
  const ends = (periods || [])
    .filter(row => !row.isDeleted && ['RECOGNIZED', 'CLOSED'].includes(String(row.status || '')))
    .map(row => (isCivilDate(row.toDate) ? row.toDate : ''))
    .filter(Boolean)
    .sort();
  return ends.at(-1) || '';
}

/** المصروفات كسطور قابلة للعرض والاختيار في التوكيل (منفصلة عن أصل الدين). */
export function expensesFrom(ledger = [], settings = null) {
  const borneLabels = Object.fromEntries((settings?.lists?.borneBy) || [['debtor', 'المنفذ ضده'], ['client', 'الموكل'], ['office', 'المكتب']]);
  const typeLabels = Object.fromEntries((settings?.lists?.expenseTypes) || []);
  return ledger
    .filter(row => !row.isDeleted && String(row.status || '') !== 'voided' && (row.category === 'expense' || ['EXECUTION_FEE', 'STAMP', 'COLLECTION_FEE', 'OTHER_EXPENSE'].includes(row.type)))
    .map(row => ({
      id: row.id, type: row.type, label: row.label || typeLabels[row.type] || 'مصروف', amount: Number(row.amount || 0),
      amountMinor: minorFromRow(row, row.currency), date: row.date || '', includeInPoa: Boolean(row.includeInPoa),
      borneBy: row.borneBy || '', borneByLabel: borneLabels[row.borneBy] || '', notes: row.notes || ''
    }))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

export function periodStatusLabel(status) {
  return ({paid: '✔ مسدد', partial: '◐ جزئي', unpaid: '✗ لم يُدفع', nothing_due: '· لا استحقاق'})[status] || '';
}

/** حالة التنفيذ المشتقة: جارٍ / عليه متأخرات / مكتمل السداد (+ ما يضبطه المستخدم يدويًا). */
export function derivedStatus(execution, schedule, today = localDate()) {
  const manual = String(execution?.lifecycleOverride || '');
  if (manual === 'suspended' || manual === 'closed') return {key: manual, label: manual === 'suspended' ? 'متوقف' : 'مغلق', manual: true};
  const totals = schedule?.totals || {};
  if (totals.dueMinor > 0 && totals.remainingMinor <= 0) return {key: 'completed', label: 'مكتمل السداد'};
  const overdue = (schedule?.rows || []).some(row => row.status !== PERIOD_STATUS.PAID && row.toDate < today);
  if (overdue) return {key: 'overdue', label: 'عليه متأخرات'};
  return {key: 'running', label: 'جارٍ'};
}

/**
 * ملخص صف القائمة: الأرقام الثلاثة + آخر إجراء + الإجراء التالي + الأسماء.
 * يُحسب فقط للتنفيذات المعروضة في الصفحة (لا مسح لكل السجل).
 */
export async function hydrateSimpleRows(office, executions = []) {
  const settings = executionSettings(office);
  const today = localDate();
  const rows = await Promise.all((executions || []).map(async execution => {
    const [slices, receipts, allocations, ledger, parties, actions, periods] = await Promise.all([
      office.r.executionValuePeriods.byIndex('executionId', execution.id, MAX_CHILD_ROWS).catch(() => []),
      office.r.executionReceipts.byIndex('executionId', execution.id, MAX_CHILD_ROWS).catch(() => []),
      office.r.executionAllocations.byIndex('executionId', execution.id, MAX_CHILD_ROWS).catch(() => []),
      office.r.executionLedger.byIndex('executionId', execution.id, MAX_CHILD_ROWS).catch(() => []),
      office.r.executionParties.byIndex('executionId', execution.id, MAX_CHILD_ROWS).catch(() => []),
      office.r.executionActions.byIndex('executionId', execution.id, MAX_CHILD_ROWS).catch(() => []),
      office.r.executionPeriods.byIndex('executionId', execution.id, MAX_CHILD_ROWS).catch(() => [])
    ]);
    const schedule = buildExecutionSchedule({slices: capSlicesAtHorizon(execution, slices, feasRecognizedThrough(periods)), receipts, allocations, ledger, settings: settings.schedule, asOf: today});
    const status = derivedStatus(execution, schedule, today);
    const creditor = parties.find(party => party.side === 'creditor') || null;
    const debtor = parties.find(party => party.side === 'debtor') || null;
    const sortedActions = [...actions].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    const lastAction = sortedActions.find(action => String(action.date || '') <= today) || sortedActions[0] || null;
    const planned = [...actions].filter(action => action.nextActionDate).sort((a, b) => String(a.nextActionDate).localeCompare(String(b.nextActionDate)));
    const nextAction = planned.find(action => String(action.nextActionDate) >= today) || planned.at(-1) || null;
    return {
      execution, schedule, status, creditor, debtor, lastAction, nextAction,
      nextActionLabel: nextAction ? `${nextAction.nextAction || 'إجراء'} ${nextAction.nextActionDate}` : '',
      lastActionLabel: lastAction ? `${lastAction.kindLabel || lastAction.kind || 'إجراء'} ${lastAction.date || ''}` : '',
      summary: schedule.totals
    };
  }));
  return rows;
}

/** حزمة البطاقة: كل ما تحتاجه شاشة واحدة (بلا أي قراءة داخل الواجهة). */
export async function simpleCardBundle(office, executionId, {asOf = ''} = {}) {
  const data = await simpleSchedule(office, executionId, {asOf});
  const execution = data.execution;
  const [client, file] = await Promise.all([
    execution.clientId ? office.r.clients.get(execution.clientId).catch(() => null) : null,
    execution.fileId ? office.r.files.get(execution.fileId).catch(() => null) : null
  ]);
  const activeParties = data.parties.filter(party => !party.isDeleted);
  const creditor = activeParties.find(party => party.side === 'creditor') || null;
  const debtor = activeParties.find(party => party.side === 'debtor') || null;
  const actions = [...data.actions].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const today = localDate();
  const planned = data.actions.filter(action => action.nextActionDate).sort((a, b) => String(a.nextActionDate).localeCompare(String(b.nextActionDate)));
  const nextAction = planned.find(action => String(action.nextActionDate) >= today) || planned.at(-1) || null;
  const lastAction = actions.find(action => String(action.date || '') <= today) || actions[0] || null;
  const poas = [...data.poas].sort((a, b) => String(a.date || '').localeCompare(String(b.date || ''))).reverse();
  return {
    ...data, client, file, creditor, debtor, actions, lastAction, nextAction, poas,
    expenses: expensesFrom(data.ledger, data.settings),
    status: derivedStatus(execution, data.schedule, today),
    hints: completionHints(data.schedule, {execution, judgments: data.judgments, slices: data.slices}),
    today
  };
}

/** كتابة حالة يدوية (متوقف/مغلق) مع سبب — وهي الوحيدة التي يضبطها المستخدم بنفسه. */
export async function setExecutionLifecycle(office, executionId, {state = 'running', reason = ''} = {}) {
  office.ctx.assert();
  const execution = await requireExecution(office, executionId);
  const value = ['suspended', 'closed'].includes(state) ? state : '';
  if (value && !String(reason || '').trim()) throw new AppError(ERR.VALIDATION, 'سبب الإيقاف/الإغلاق مطلوب.', {reason: 'مطلوب'});
  const row = {...execution, lifecycleOverride: value, lifecycleReason: value ? String(reason).trim() : '', updatedAt: now(), version: (execution.version || 0) + 1};
  await transaction(office.ctx, [STORE.execution, STORE.activityLog], async tx => {
    await request(tx.objectStore(STORE.execution).put(row));
    await request(tx.objectStore(STORE.activityLog).add(activityRow(office, STORE.execution, executionId, value ? 'close' : 'reopen',
      value === 'closed' ? `إغلاق ملف التنفيذ — ${reason}` : value === 'suspended' ? `إيقاف التنفيذ — ${reason}` : 'إعادة التنفيذ إلى «جارٍ»', execution.fileId || '')));
  });
  emitChanged(STORE.execution, executionId);
  return row;
}

/* =============================== الإنشاء =============================== */

/**
 * نموذج واحد ينشئ: التنفيذ + الأطراف + الحكم + بند القيمة/الجدول.
 * الإلزامي فقط: الموكل، المبلغ، النوع (دوري/مقطوع)، تاريخ السريان للدوري.
 */
export async function createSimpleExecution(office, input = {}) {
  office.ctx.assert();
  const settings = executionSettings(office);
  const currency = currencyCode(input.currency, settings.schedule.defaultCurrency);
  const executionType = ['civil', 'criminal', 'family'].includes(input.executionType) ? input.executionType : 'family';
  const valueType = input.valueType === 'fixed' ? 'fixed' : 'periodic';
  const entitlementType = String(input.entitlementType || '').trim() || (valueType === 'fixed' ? 'مبلغ مقطوع' : 'نفقة');
  const amountMinor = requireAmount(input.amount, currency, {label: 'المبلغ'});
  const effectiveFrom = isCivilDate(input.effectiveFrom) ? input.effectiveFrom : (valueType === 'fixed' ? (isCivilDate(input.judgmentDate) ? input.judgmentDate : localDate()) : '');
  if (valueType === 'periodic' && !isCivilDate(effectiveFrom)) throw new AppError(ERR.VALIDATION, 'تاريخ السريان مطلوب للمبلغ الدوري.', {effectiveFrom: 'مطلوب'});
  const effectiveTo = isCivilDate(input.effectiveTo) ? input.effectiveTo : '';
  if (effectiveTo && effectiveTo < effectiveFrom) throw new AppError(ERR.VALIDATION, 'تاريخ الانتهاء قبل تاريخ السريان.', {effectiveTo: 'تاريخ غير صحيح'});

  // 1) الموكل: قائم أو جديد بالاسم فقط
  let client = null;
  if (input.clientId) {
    client = await office.r.clients.get(input.clientId);
    if (!client || client.isDeleted) throw new AppError(ERR.NOT_FOUND, 'الموكل المحدد غير موجود.');
  } else if (String(input.newClientName || '').trim()) {
    client = await office.saveClient({fullName: String(input.newClientName).trim(), phones: input.newClientPhone ? [String(input.newClientPhone).trim()] : [], status: 'active'});
  }
  if (!client) throw new AppError(ERR.VALIDATION, 'اختر الموكل أو اكتب اسمًا جديدًا.', {clientId: 'مطلوب'});

  // 2) المنفذ ضده: قائم أو جديد بالاسم (اختياري — يُكمل لاحقًا بلا مانع)
  let opponent = null;
  if (input.opponentId) {
    opponent = await office.r.opponents.get(input.opponentId).catch(() => null);
    if (!opponent || opponent.isDeleted) throw new AppError(ERR.NOT_FOUND, 'المنفذ ضده المحدد غير موجود.');
  } else if (String(input.opponentName || '').trim()) {
    opponent = await saveEntity(office, 'opponents', {name: String(input.opponentName).trim(), capacity: 'منفذ ضده'});
  }

  // 3) الملف: قائم، أو يُنشأ تلقائيًا باسم الموكل (التنفيذ يحتاج ملفًا قانونيًا في هذا النظام)
  let file = null;
  if (input.fileId) {
    file = await office.r.files.get(input.fileId);
    if (!file || file.isDeleted) throw new AppError(ERR.NOT_FOUND, 'الملف المحدد غير موجود.');
  } else {
    const fileType = executionType === 'family' ? 'أسرة' : executionType === 'criminal' ? 'جزائي' : 'مدني';
    file = await createLegalFile(office, {
      clientId: client.id, fileType, status: 'نشط', priority: 'normal', openedAt: localDate(),
      title: `تنفيذ — ${client.fullName}${opponent ? ` ضد ${opponent.name}` : ''}`
    });
  }

  // 4) رأس التنفيذ
  const execution = await createExecution(office, {
    executionType, clientId: client.id, fileId: file.id,
    openedDate: isCivilDate(input.openedDate) ? input.openedDate : localDate(),
    officialNumber: String(input.officialNumber || '').trim(),
    authority: String(input.authority || '').trim(),
    executionMethod: String(input.executionMethod || '').trim(),
    entitlementThroughDate: effectiveTo,
    prorationPolicy: 'days',
    status: 'active',
    notes: String(input.notes || '').trim()
  });

  // 5) الأطراف تُملأ تلقائيًا — لا تظهر «0 طرف» بعد اليوم
  await saveExecutionParty(office, {executionId: execution.id, side: 'creditor', clientId: client.id, name: client.fullName, role: 'من يستحق (الموكل)', sequence: 1});
  if (opponent) await saveExecutionParty(office, {executionId: execution.id, side: 'debtor', opponentId: opponent.id, name: opponent.name, role: 'من يُنفَّذ ضده', sequence: 2});

  // 6) الحكم + بند القيمة (المحرك يبني الجدول الشهري فورًا من هذه البيانات)
  const judgment = await addExecutionJudgment(office, {
    executionId: execution.id, entitlementType, judgmentKind: 'original',
    judgmentDate: isCivilDate(input.judgmentDate) ? input.judgmentDate : (effectiveFrom || localDate()),
    judgmentNumber: String(input.judgmentNumber || '').trim(), caseYear: String(input.judgmentYear || '').trim(),
    court: String(input.court || '').trim(), valueType, periodicity: valueType === 'fixed' ? 'fixed' : (input.periodicity || 'monthly'),
    amount: fromMinorUnits(amountMinor, currency), effectiveFrom, effectiveTo,
    operativeSummary: String(input.operativeSummary || '').trim(), notes: 'أُنشئ من نموذج التنفيذ المبسّط'
  });
  const slice = await saveValueSlice(office, {
    executionId: execution.id, judgmentId: judgment.id, entitlementType, valueType,
    periodicity: valueType === 'fixed' ? 'fixed' : (input.periodicity || 'monthly'),
    amount: fromMinorUnits(amountMinor, currency), currency, startDate: effectiveFrom, endDate: effectiveTo,
    sourceReference: judgment.judgmentNumber ? `الحكم ${judgment.judgmentNumber}` : 'الحكم الأصلي'
  });
  // حفظ الوحدات الصغرى على شريحة القيمة: دقة قرش كاملة بلا كسور عائمة لاحقًا.
  const storedSlice = {...slice, amountMinor, currency, valueType};
  await transaction(office.ctx, [STORE.executionValuePeriods, STORE.activityLog], async tx => {
    await request(tx.objectStore(STORE.executionValuePeriods).put(storedSlice));
    await request(tx.objectStore(STORE.activityLog).add(activityRow(office, STORE.executionValuePeriods, storedSlice.id, 'create', `بند قيمة: ${entitlementType} ${fromMinorUnits(amountMinor, currency)} ${currency} من ${effectiveFrom}`, execution.fileId || '')));
  });
  await refreshExecutionSearchText(office, execution.id).catch(() => null);
  emitChanged(STORE.execution, execution.id);
  return {execution, client, opponent, file, judgment, slice: storedSlice};
}

/* =============================== التسجيلات =============================== */

/**
 * معاينة التخصيص قبل الحفظ (نفس محرك الجدول): «سيُخصَّص: …».
 * لا كتابة ولا تخزين — النتيجة مشتقة بالكامل.
 */
export async function previewSimpleCollection(office, {executionId, amount, date = '', target = 'auto', periodKey = '', asOf = ''} = {}) {
  const inputs = await executionSimpleInputs(office, executionId);
  const settings = executionSettings(office);
  // أفق المعاينة = الأبعد بين تاريخ التحصيل واليوم: يرى المحامي أثر المبلغ على كل المتبقي.
  const receiptDate = isCivilDate(date) ? date : localDate();
  const horizon = isCivilDate(asOf) ? asOf : (receiptDate > localDate() ? receiptDate : localDate());
  const currency = currencyCode(inputs.slices.find(slice => slice.currency)?.currency, settings.schedule.defaultCurrency);
  const amountMinor = requireAmount(amount, currency, {label: 'مبلغ التحصيل'});
  const candidate = {id: '__preview__', date: isCivilDate(date) ? date : localDate(), amountMinor, amount: fromMinorUnits(amountMinor, currency)};
  const candidateAllocation = target === 'period' && periodKey
    ? [{id: '__preview_pin__', receiptId: '__preview__', periodKey, amountMinor, method: 'DIRECT', isActive: true}]
    : [];
  const base = buildExecutionSchedule({slices: inputs.slices, receipts: inputs.receipts, allocations: inputs.allocations, ledger: inputs.ledger, settings: settings.schedule, asOf: horizon});
  const withNew = buildExecutionSchedule({
    slices: inputs.slices, receipts: [...inputs.receipts, candidate],
    allocations: [...inputs.allocations, ...candidateAllocation], ledger: inputs.ledger, settings: settings.schedule, asOf: horizon
  });
  const lines = [];
  for (const row of withNew.rows) {
    const before = base.rows.find(item => item.fromDate === row.fromDate);
    const delta = addMinor(row.paidMinor, -(before?.paidMinor || 0));
    if (delta !== 0) lines.push({label: row.label, fromDate: row.fromDate, amountMinor: delta, amount: fromMinorUnits(delta, currency)});
  }
  const creditDelta = addMinor(withNew.totals.creditMinor, -base.totals.creditMinor);
  return {
    currency, amountMinor, lines, creditMinor: Math.max(0, creditDelta),
    remainingAfterMinor: withNew.totals.remainingMinor, remainingBeforeMinor: base.totals.remainingMinor,
    allocationsAfter: withNew.rows.filter(row => row.paidMinor > 0).map(row => ({label: row.label, fromDate: row.fromDate, paidMinor: row.paidMinor, status: row.status})),
    equations: [
      `سيُخصَّص: ${lines.length ? lines.map(line => `${line.label} ${fromMinorUnits(line.amountMinor, currency)}`).join(' · ') : 'لا يوجد استحقاق بعد — يُحفظ كتحصيل غير مخصص'}`,
      `المتبقي بعد التحصيل = ${fromMinorUnits(withNew.totals.remainingMinor, currency)} ${currency}`,
      creditDelta > 0 ? `رصيد دائن (دفعة مقدمة) = ${fromMinorUnits(creditDelta, currency)} ${currency}` : ''
    ].filter(Boolean)
  };
}

/**
 * تسجيل تحصيل: الإلزامي المبلغ فقط (التاريخ افتراضي اليوم).
 * - الافتراضي: تخصيص تلقائي «الأقدم أولًا» محسوب ومشتق (لا يُخزَّن ليتبع أي تغيير لاحق).
 * - «يخص شهرًا محددًا» أو إعادة التخصيص: يُثبَّت كسطر تخصيص محفوظ (DIRECT).
 * - الزائد رصيد دائن مرئي ولا يُرفض. وقبل إدخال القيمة يُحفظ التحصيل غير مخصص.
 */
export async function recordSimpleCollection(office, input = {}) {
  office.ctx.assert();
  const execution = await requireExecution(office, input.executionId);
  const settings = executionSettings(office);
  const date = isCivilDate(input.date) ? input.date : localDate();
  const inputs = await executionSimpleInputs(office, input.executionId);
  const currency = currencyCode(inputs.slices.find(slice => slice.currency)?.currency, settings.schedule.defaultCurrency);
  const amountMinor = requireAmount(input.amount, currency, {label: 'مبلغ التحصيل'});
  const preview = await previewSimpleCollection(office, {executionId: input.executionId, amount: fromMinorUnits(amountMinor, currency), date, target: input.target, periodKey: input.periodKey, asOf: input.asOf});
  let pins = [];
  if (input.target === 'period') {
    if (!input.periodKey) throw new AppError(ERR.VALIDATION, 'اختر الشهر/الفترة التي يخصها التحصيل.', {periodKey: 'مطلوب'});
    const pinLine = preview.lines.find(line => line.fromDate === String(input.periodKey).split('::').at(-1));
    const capacity = pinLine?.amountMinor || 0;
    if (capacity <= 0) throw new AppError(ERR.VALIDATION, 'الشهر المحدد مسدد بالكامل أو لا يوجد استحقاق فيه؛ اختر شهرًا آخر أو اترك «تلقائي».', {periodKey: 'لا يوجد متبقٍ في هذه الفترة'});
    pins = [{periodKey: input.periodKey, amountMinor: capacity}];
  }
  const receiptId = uid(), ledgerId = uid();
  const year = date.slice(0, 4);
  const out = await transaction(office.ctx, [STORE.executionReceipts, STORE.executionLedger, STORE.executionAllocations, STORE.fileNumberCounters, STORE.activityLog], async tx => {
    const counters = tx.objectStore(STORE.fileNumberCounters);
    const counter = await request(counters.get(`receipt:${year}`));
    const next = (counter?.lastNumber || 0) + 1;
    await request(counters.put({id: `receipt:${year}`, year, kind: 'receipt', lastNumber: next, updatedAt: now()}));
    const receiptNumber = String(input.receiptNumber || '').trim() || `RC-${year}-${String(next).padStart(4, '0')}`;
    const receipt = {
      id: receiptId, executionId: execution.id, fileId: execution.fileId || '', clientId: execution.clientId || '',
      receiptNumber, date, amount: fromMinorUnits(amountMinor, currency), amountMinor, currency,
      receiptType: input.receiptType || 'محضر تحصيل',
      collectorName: String(input.collectorName || '').trim(),
      payerName: String(input.payerName || '').trim(),
      collectionSide: String(input.collectionSide || '').trim(),
      paymentMethod: String(input.paymentMethod || '').trim(),
      reference: String(input.reference || '').trim(),
      allocationMethod: input.target === 'period' ? 'DIRECT' : 'AUTO',
      allocationTarget: input.target === 'period' ? input.periodKey : 'auto',
      notes: String(input.notes || '').trim(),
      status: 'posted', revisions: [],
      createdBy: office.ctx?.profile?.id || 'user', createdAt: now(), updatedAt: now(), version: 1, isDeleted: false
    };
    const ledgerRow = {
      id: ledgerId, executionId: execution.id, fileId: execution.fileId || '', clientId: execution.clientId || '',
      type: 'COLLECTION', category: 'collection', amount: receipt.amount, amountMinor, currency, date,
      receiptId, sourceType: 'receipt', sourceId: receiptId, paymentMethod: receipt.paymentMethod,
      notes: receipt.notes, createdBy: receipt.createdBy, createdAt: now(), updatedAt: now(), version: 1, isDeleted: false
    };
    await request(tx.objectStore(STORE.executionReceipts).add(receipt));
    await request(tx.objectStore(STORE.executionLedger).add(ledgerRow));
    const allocationRows = [];
    for (const pin of pins) {
      const row = {
        id: uid(), executionId: execution.id, ledgerId, receiptId, periodKey: pin.periodKey,
        amount: fromMinorUnits(pin.amountMinor, currency), amountMinor, currency,
        method: 'DIRECT', mode: 'direct', isActive: true, createdBy: receipt.createdBy,
        createdAt: now(), updatedAt: now(), version: 1, isDeleted: false
      };
      allocationRows.push(row);
      await request(tx.objectStore(STORE.executionAllocations).add(row));
    }
    await request(tx.objectStore(STORE.activityLog).add(activityRow(office, STORE.executionReceipts, receiptId, 'create',
      `تحصيل ${receipt.amount} ${currency} (${receiptNumber}) بتاريخ ${date} — تخصيص: ${input.target === 'period' ? `شهر ${input.periodKey}` : 'تلقائي الأقدم أولًا'}`, execution.fileId || '')));
    return {receipt, ledger: ledgerRow, allocations: allocationRows};
  });
  emitChanged(STORE.executionReceipts, receiptId);
  emitChanged(STORE.execution, execution.id);
  return {...out, preview};
}

/** إجراء تنفيذ: الإلزامي النوع والتاريخ. «الإجراء التالي» اختياري ولا ترتيب إلزامي. */
export async function recordSimpleAction(office, input = {}) {
  office.ctx.assert();
  const execution = await requireExecution(office, input.executionId);
  const settings = executionSettings(office);
  const kind = String(input.kind || '').trim();
  if (!kind) throw new AppError(ERR.VALIDATION, 'نوع الإجراء مطلوب.', {kind: 'مطلوب'});
  if (!isCivilDate(input.date)) throw new AppError(ERR.VALIDATION, 'تاريخ الإجراء مطلوب.', {date: 'مطلوب'});
  const kindLabel = (settings.lists.actionKinds.find(([key]) => key === kind) || [kind, kind])[1];
  const row = {
    id: uid(), executionId: execution.id, fileId: execution.fileId || '', clientId: execution.clientId || '',
    kind, kindLabel, date: input.date,
    referenceNumber: String(input.referenceNumber || '').trim(),
    authority: String(input.authority || '').trim(),
    result: String(input.result || '').trim() || 'تم تسجيل الإجراء',
    nextAction: String(input.nextAction || '').trim(),
    nextActionDate: isCivilDate(input.nextActionDate) ? input.nextActionDate : '',
    notes: String(input.notes || '').trim(),
    documentReferenceId: String(input.documentReferenceId || '').trim(),
    status: 'posted', createdBy: office.ctx?.profile?.id || 'user', createdAt: now(), updatedAt: now(), version: 1, isDeleted: false
  };
  await transaction(office.ctx, [STORE.executionActions, STORE.activityLog], async tx => {
    await request(tx.objectStore(STORE.executionActions).add(row));
    await request(tx.objectStore(STORE.activityLog).add(activityRow(office, STORE.executionActions, row.id, 'create', `إجراء تنفيذ: ${kindLabel} بتاريخ ${row.date}${row.referenceNumber ? ` — ${row.referenceNumber}` : ''}`, execution.fileId || '')));
  });
  emitChanged(STORE.executionActions, row.id);
  emitChanged(STORE.execution, execution.id);
  let workItem = null;
  if (input.createFollowUp && row.nextActionDate) {
    workItem = await createExecutionFollowUp(office, {execution, action: row}).catch(() => null);
  }
  return {...row, workItem};
}

/** متابعة في مركز العمل — تُنشأ بطلب صريح من المستخدم فقط (لا تلقائيًا). */
export async function createExecutionFollowUp(office, {execution, action}) {
  const {saveWorkItem} = await import('./work-items.js');
  const title = `${action.nextAction || 'متابعة تنفيذ'} — ${execution.internalNumber || execution.officialNumber || 'تنفيذ'}`;
  return saveWorkItem(office, {
    title, dueDate: action.nextActionDate, status: 'notStarted', priority: 'medium',
    fileId: execution.fileId || '', notes: `من إجراء التنفيذ بتاريخ ${action.date} (${action.kindLabel || action.kind}).`
  });
}

/** مصروف/رسم: منفصل دائمًا عن أصل الدين، ويدخل التوكيل بالاختيار فقط. */
export async function recordSimpleExpense(office, input = {}) {
  office.ctx.assert();
  const execution = await requireExecution(office, input.executionId);
  const settings = executionSettings(office);
  const date = isCivilDate(input.date) ? input.date : localDate();
  const type = String(input.type || '').trim() || 'OTHER_EXPENSE';
  const typeRow = settings.lists.expenseTypes.find(([key]) => key === type);
  const label = String(input.label || '').trim() || typeRow?.[1] || 'مصروف';
  const currency = currencyCode(input.currency, settings.schedule.defaultCurrency);
  const amountMinor = requireAmount(input.amount, currency, {label: 'مبلغ المصروف'});
  const row = {
    id: uid(), executionId: execution.id, fileId: execution.fileId || '', clientId: execution.clientId || '',
    type, category: 'expense', label, amount: fromMinorUnits(amountMinor, currency), amountMinor, currency, date,
    includeInPoa: Boolean(input.includeInPoa), borneBy: String(input.borneBy || '').trim(),
    documentReferenceId: String(input.documentReferenceId || '').trim(),
    notes: String(input.notes || '').trim(), sourceType: 'expense',
    createdBy: office.ctx?.profile?.id || 'user', createdAt: now(), updatedAt: now(), version: 1, isDeleted: false
  };
  await transaction(office.ctx, [STORE.executionLedger, STORE.activityLog], async tx => {
    await request(tx.objectStore(STORE.executionLedger).add(row));
    await request(tx.objectStore(STORE.activityLog).add(activityRow(office, STORE.executionLedger, row.id, 'create', `مصروف/رسم: ${label} ${row.amount} ${currency} بتاريخ ${date}${row.includeInPoa ? ' — يدخل التوكيل' : ''}`, execution.fileId || '')));
  });
  emitChanged(STORE.executionLedger, row.id);
  return row;
}

/**
 * حكم لاحق (زيادة/تخفيض): حكم جديد + بند قيمة جديد يسري من التاريخ الذي يدخله المستخدم.
 * الشريحة القديمة تبقى محفوظة، والمحرك يقسّم بها الشهور ويظهر الفرق مرة واحدة.
 */
export async function recordSubsequentJudgment(office, input = {}) {
  office.ctx.assert();
  const execution = await requireExecution(office, input.executionId);
  const settings = executionSettings(office);
  const currency = currencyCode(input.currency, settings.schedule.defaultCurrency);
  const amountMinor = requireAmount(input.amount, currency, {label: 'القيمة الجديدة'});
  if (!isCivilDate(input.effectiveFrom)) throw new AppError(ERR.VALIDATION, 'تاريخ سريان الحكم اللاحق مطلوب (من مستند الحكم).', {effectiveFrom: 'مطلوب'});
  const inputs = await executionSimpleInputs(office, input.executionId);
  const entitlementType = String(input.entitlementType || '').trim();
  const previousSlice = inputs.slices.find(slice => slice.id === input.previousSliceId)
    || inputs.slices.filter(slice => !input.entitlementType || String(slice.entitlementType) === entitlementType).sort((a, b) => String(a.startDate).localeCompare(String(b.startDate))).at(-1)
    || null;
  if (!entitlementType && !previousSlice) throw new AppError(ERR.VALIDATION, 'أدخل اسم البند (نوع الاستحقاق).', {entitlementType: 'مطلوب'});
  const type = entitlementType || previousSlice.entitlementType;
  const previousAmountMinor = previousSlice ? minorFromRow(previousSlice, previousSlice.currency || currency) : 0;
  const isDecrease = previousAmountMinor > 0 && amountMinor < previousAmountMinor;
  if (isDecrease && !input.confirmedDecrease) throw new AppError(ERR.VALIDATION, 'هذا الحكم يخفض القيمة. راجع الأثر ثم أكّد الحفظ صراحةً.', {confirm: 'مطلوب تأكيد التخفيض'});
  const judgment = await addExecutionJudgment(office, {
    executionId: execution.id, entitlementType: type, judgmentKind: 'later',
    previousJudgmentId: inputs.judgments.slice().sort((a, b) => Number(a.sequence || 0) - Number(b.sequence || 0)).at(-1)?.id || '',
    judgmentDate: isCivilDate(input.judgmentDate) ? input.judgmentDate : input.effectiveFrom,
    judgmentNumber: String(input.judgmentNumber || '').trim(), caseYear: String(input.judgmentYear || '').trim(),
    appealNumber: String(input.appealNumber || '').trim(), court: String(input.court || '').trim(),
    valueType: previousSlice?.valueType === 'fixed' ? 'fixed' : 'periodic',
    periodicity: input.periodicity || previousSlice?.periodicity || 'monthly',
    amount: fromMinorUnits(amountMinor, currency), effectiveFrom: input.effectiveFrom,
    effectiveTo: isCivilDate(input.effectiveTo) ? input.effectiveTo : '',
    notes: String(input.notes || '').trim()
  });
  const slice = await saveValueSlice(office, {
    executionId: execution.id, judgmentId: judgment.id, entitlementType: type,
    valueType: previousSlice?.valueType === 'fixed' ? 'fixed' : 'periodic',
    periodicity: input.periodicity || previousSlice?.periodicity || 'monthly',
    amount: fromMinorUnits(amountMinor, currency), currency, startDate: input.effectiveFrom,
    endDate: isCivilDate(input.effectiveTo) ? input.effectiveTo : '',
    sourceReference: judgment.judgmentNumber ? `الحكم ${judgment.judgmentNumber}` : 'حكم لاحق'
  });
  const storedSlice = {...slice, amountMinor, currency};
  await transaction(office.ctx, [STORE.executionValuePeriods, STORE.activityLog], async tx => {
    await request(tx.objectStore(STORE.executionValuePeriods).put(storedSlice));
    await request(tx.objectStore(STORE.activityLog).add(activityRow(office, STORE.executionValuePeriods, storedSlice.id, 'create',
      `حكم لاحق: ${type} ${fromMinorUnits(amountMinor, currency)} ${currency} من ${input.effectiveFrom}${isDecrease ? ' (تخفيض)' : ''}`, execution.fileId || '')));
  });
  await refreshExecutionSearchText(office, execution.id).catch(() => null);
  emitChanged(STORE.executionValuePeriods, storedSlice.id);
  return {judgment, slice: storedSlice};
}

/** ملاحظة مرتبطة بالتنفيذ — تعيش في نظام الملاحظات السريعة القائم (لا سجل ثانٍ). */
export async function recordSimpleNote(office, input = {}) {
  office.ctx.assert();
  const execution = await requireExecution(office, input.executionId);
  const body = String(input.body || '').trim();
  if (!body) throw new AppError(ERR.VALIDATION, 'اكتب نص الملاحظة.', {body: 'مطلوب'});
  const {saveQuickNote} = await import('./quick-notes.js');
  const note = await saveQuickNote(office, {title: String(input.title || '').trim() || 'ملاحظة تنفيذ', body, lifecycle: 'OPEN'}, {
    links: [{entityType: 'EXECUTION', entityId: execution.id}]
  });
  emitChanged(STORE.caseNotes, note.id);
  return note;
}

/* ========================= التعديل والإلغاء والتدقيق ========================= */

/**
 * تعديل مبلغ/بيانات محضر تحصيل: يحفظ النسخة القديمة على المحضر نفسه،
 * ويكتب حركة عكسية للحركة القديمة + حركة جديدة (الدفتر Append-Only لا يُخترق).
 */
export async function updateSimpleReceipt(office, {receiptId, amount, date, paymentMethod, reference, notes, reason = ''} = {}) {
  office.ctx.assert();
  const receipt = await office.r.executionReceipts.get(receiptId);
  if (!receipt || receipt.isDeleted) throw new AppError(ERR.NOT_FOUND, 'محضر التحصيل غير موجود.');
  if (receipt.status === 'voided') throw new AppError(ERR.CONFLICT, 'المحضر ملغي؛ لا يُعدَّل.');
  const execution = await requireExecution(office, receipt.executionId);
  const settings = executionSettings(office);
  const currency = currencyCode(receipt.currency, settings.schedule.defaultCurrency);
  const amountMinor = amount === undefined || amount === '' ? minorFromRow(receipt, currency) : requireAmount(amount, currency, {label: 'المبلغ'});
  const nextDate = isCivilDate(date) ? date : receipt.date;
  const previous = {amount: receipt.amount, amountMinor: minorFromRow(receipt, currency), date: receipt.date, paymentMethod: receipt.paymentMethod, reference: receipt.reference, notes: receipt.notes};
  const row = {
    ...receipt, amount: fromMinorUnits(amountMinor, currency), amountMinor, date: nextDate,
    paymentMethod: paymentMethod === undefined ? receipt.paymentMethod : String(paymentMethod || '').trim(),
    reference: reference === undefined ? receipt.reference : String(reference || '').trim(),
    notes: notes === undefined ? receipt.notes : String(notes || '').trim(),
    revisions: [...(receipt.revisions || []), {at: now(), by: office.ctx?.profile?.id || 'user', reason: String(reason || '').trim() || 'تعديل تحصيل', before: previous}],
    updatedAt: now(), version: (receipt.version || 0) + 1
  };
  const ledgerRow = await office.r.executionLedger.get(receipt.ledgerId).catch(() => null);
  await transaction(office.ctx, [STORE.executionReceipts, STORE.executionLedger, STORE.activityLog], async tx => {
    await request(tx.objectStore(STORE.executionReceipts).put(row));
    if (ledgerRow && !ledgerRow.isDeleted) {
      const reversal = {
        id: uid(), executionId: receipt.executionId, fileId: receipt.fileId || '', clientId: receipt.clientId || '',
        type: 'REVERSAL', category: 'correction', amount: ledgerRow.amount, amountMinor: minorFromRow(ledgerRow, currency), currency,
        date: nextDate, receiptId: receiptId, sourceType: 'correction', sourceId: receiptId, adjustsLedgerId: ledgerRow.id,
        reason: `تعديل محضر ${receipt.receiptNumber}${reason ? ` — ${reason}` : ''}`, notes: '',
        createdBy: office.ctx?.profile?.id || 'user', createdAt: now(), updatedAt: now(), version: 1, isDeleted: false
      };
      const fresh = {
        ...ledgerRow, id: uid(), amount: row.amount, amountMinor, date: nextDate, paymentMethod: row.paymentMethod,
        notes: row.notes, sourceId: receiptId, createdBy: office.ctx?.profile?.id || 'user', createdAt: now(), updatedAt: now(), version: 1
      };
      await request(tx.objectStore(STORE.executionLedger).add(reversal));
      await request(tx.objectStore(STORE.executionLedger).add(fresh));
      const nextReceipt = {...row, ledgerId: fresh.id};
      await request(tx.objectStore(STORE.executionReceipts).put(nextReceipt));
      Object.assign(row, nextReceipt);
    }
    await request(tx.objectStore(STORE.activityLog).add(activityRow(office, STORE.executionReceipts, receiptId, 'update',
      `تعديل تحصيل ${receipt.receiptNumber}: ${previous.amount} → ${row.amount}${reason ? ` — ${reason}` : ''}`, execution.fileId || '', {before: previous.amount, after: row.amount})));
  });
  emitChanged(STORE.executionReceipts, receiptId);
  return row;
}

/** إعادة تخصيص محضر: تُحفظ كنسخة جديدة، والقديمة تُعلَّم «مُستبدلة» ولا تُمحى. */
export async function reallocateSimpleReceipt(office, {receiptId, target = 'auto', periodKey = ''} = {}) {
  office.ctx.assert();
  const receipt = await office.r.executionReceipts.get(receiptId);
  if (!receipt || receipt.isDeleted) throw new AppError(ERR.NOT_FOUND, 'محضر التحصيل غير موجود.');
  const execution = await requireExecution(office, receipt.executionId);
  const current = await office.r.executionAllocations.byIndex('receiptId', receiptId, MAX_CHILD_ROWS);
  const active = current.filter(row => !row.isDeleted && row.isActive !== false);
  const stamp = now();
  await transaction(office.ctx, [STORE.executionAllocations, STORE.executionReceipts, STORE.activityLog], async tx => {
    for (const row of active) {
      await request(tx.objectStore(STORE.executionAllocations).put({...row, isActive: false, supersededAt: stamp, supersededReason: 'إعادة تخصيص', updatedAt: stamp, version: (row.version || 0) + 1}));
    }
    if (target === 'period') {
      if (!isCivilDate(String(periodKey).split('::').at(-1))) throw new AppError(ERR.VALIDATION, 'اختر الفترة المطلوبة.', {periodKey: 'مطلوب'});
      const preview = await previewSimpleCollection(office, {executionId: receipt.executionId, amount: receipt.amount, date: receipt.date, target, periodKey});
      const line = preview.lines.find(item => item.fromDate === String(periodKey).split('::').at(-1));
      if (!line || line.amountMinor <= 0) throw new AppError(ERR.VALIDATION, 'لا يوجد متبقٍ في هذه الفترة.', {periodKey: 'غير متاح'});
      const pin = {
        id: uid(), executionId: receipt.executionId, ledgerId: receipt.ledgerId, receiptId,
        periodKey, amount: fromMinorUnits(line.amountMinor, currencyCode(receipt.currency)), amountMinor: line.amountMinor,
        currency: currencyCode(receipt.currency), method: 'DIRECT', mode: 'direct', isActive: true,
        createdBy: office.ctx?.profile?.id || 'user', createdAt: stamp, updatedAt: stamp, version: 1, isDeleted: false
      };
      await request(tx.objectStore(STORE.executionAllocations).add(pin));
    }
    await request(tx.objectStore(STORE.executionReceipts).put({...receipt, allocationMethod: target === 'period' ? 'DIRECT' : 'AUTO', allocationTarget: target === 'period' ? periodKey : 'auto', updatedAt: stamp, version: (receipt.version || 0) + 1}));
    await request(tx.objectStore(STORE.activityLog).add(activityRow(office, STORE.executionAllocations, receiptId, 'reallocate',
      target === 'period' ? `إعادة تخصيص ${receipt.receiptNumber} إلى ${periodKey}` : `إعادة تخصيص ${receipt.receiptNumber} إلى التلقائي (الأقدم أولًا)`, execution.fileId || '')));
  });
  emitChanged(STORE.executionAllocations, receiptId);
  return true;
}

/**
 * إلغاء (بدل الحذف): كل نوع له حالة إلغاء مسجلة بسبب + حركة عكسية للمال.
 * لا حذف فعلي لأي سجل، ويبقى الظاهر في السجل مشطوبًا مع إمكانية التراجع.
 */
export async function voidSimpleRecord(office, {kind, id, reason = ''} = {}) {
  office.ctx.assert();
  const why = String(reason || '').trim();
  if (!why) throw new AppError(ERR.VALIDATION, 'سبب الإلغاء مطلوب (يبقى في السجل).', {reason: 'مطلوب'});
  const stamp = now();
  const by = office.ctx?.profile?.id || 'user';
  if (kind === 'receipt') {
    const receipt = await office.r.executionReceipts.get(id);
    if (!receipt || receipt.isDeleted) throw new AppError(ERR.NOT_FOUND, 'المحضر غير موجود.');
    if (receipt.status === 'voided') throw new AppError(ERR.CONFLICT, 'المحضر ملغي بالفعل.');
    const execution = await requireExecution(office, receipt.executionId);
    const ledgerRow = await office.r.executionLedger.get(receipt.ledgerId).catch(() => null);
    await transaction(office.ctx, [STORE.executionReceipts, STORE.executionLedger, STORE.executionAllocations, STORE.activityLog], async tx => {
      await request(tx.objectStore(STORE.executionReceipts).put({...receipt, status: 'voided', voidedAt: stamp, voidReason: why, updatedAt: stamp, version: (receipt.version || 0) + 1}));
      if (ledgerRow && !ledgerRow.isDeleted) {
        await request(tx.objectStore(STORE.executionLedger).add({
          id: uid(), executionId: receipt.executionId, fileId: receipt.fileId || '', clientId: receipt.clientId || '',
          type: 'REVERSAL', category: 'correction', amount: ledgerRow.amount, amountMinor: minorFromRow(ledgerRow, currencyCode(receipt.currency)),
          currency: currencyCode(receipt.currency), date: localDate(), receiptId: receipt.id, sourceType: 'correction', sourceId: receipt.id,
          adjustsLedgerId: ledgerRow.id, reason: `إلغاء محضر ${receipt.receiptNumber} — ${why}`, createdBy: by,
          createdAt: stamp, updatedAt: stamp, version: 1, isDeleted: false
        }));
      }
      for (const pin of await request(tx.objectStore(STORE.executionAllocations).index('receiptId').getAll(only(receipt.id)))) {
        if (pin.isActive === false || pin.isDeleted) continue;
        await request(tx.objectStore(STORE.executionAllocations).put({...pin, isActive: false, supersededAt: stamp, supersededReason: why, updatedAt: stamp, version: (pin.version || 0) + 1}));
      }
      await request(tx.objectStore(STORE.activityLog).add(activityRow(office, STORE.executionReceipts, id, 'void', `إلغاء تحصيل ${receipt.receiptNumber} (${receipt.amount}) — ${why}`, execution.fileId || '')));
    });
    emitChanged(STORE.executionReceipts, id);
    return {kind, id, undone: true};
  }
  if (kind === 'expense') {
    const entry = await office.r.executionLedger.get(id);
    if (!entry || entry.isDeleted) throw new AppError(ERR.NOT_FOUND, 'المصروف غير موجود.');
    if (entry.status === 'voided') throw new AppError(ERR.CONFLICT, 'المصروف ملغي بالفعل.');
    const execution = await requireExecution(office, entry.executionId);
    await transaction(office.ctx, [STORE.executionLedger, STORE.activityLog], async tx => {
      await request(tx.objectStore(STORE.executionLedger).add({
        id: uid(), executionId: entry.executionId, fileId: entry.fileId || '', clientId: entry.clientId || '',
        type: 'REVERSAL', category: 'correction', amount: entry.amount, amountMinor: minorFromRow(entry),
        currency: currencyCode(entry.currency), date: localDate(), sourceType: 'correction', sourceId: id,
        adjustsLedgerId: id, reason: `إلغاء ${entry.label || entry.type} — ${why}`, createdBy: by,
        createdAt: stamp, updatedAt: stamp, version: 1, isDeleted: false
      }));
      await request(tx.objectStore(STORE.executionLedger).put({...entry, status: 'voided', voidedAt: stamp, voidReason: why, updatedAt: stamp, version: (entry.version || 0) + 1}));
      await request(tx.objectStore(STORE.activityLog).add(activityRow(office, STORE.executionLedger, id, 'void', `إلغاء مصروف ${entry.label || entry.type} (${entry.amount}) — ${why}`, execution.fileId || '')));
    });
    emitChanged(STORE.executionLedger, id);
    return {kind, id, undone: true};
  }
  if (kind === 'action') {
    const row = await office.r.executionActions.get(id);
    if (!row || row.isDeleted) throw new AppError(ERR.NOT_FOUND, 'الإجراء غير موجود.');
    const execution = await requireExecution(office, row.executionId);
    await transaction(office.ctx, [STORE.executionActions, STORE.activityLog], async tx => {
      await request(tx.objectStore(STORE.executionActions).put({...row, status: 'voided', voidedAt: stamp, voidReason: why, isDeleted: false, deletedAt: stamp, deletionReason: why, updatedAt: stamp, version: (row.version || 0) + 1}));
      await request(tx.objectStore(STORE.activityLog).add(activityRow(office, STORE.executionActions, id, 'void', `إلغاء إجراء ${row.kindLabel || row.kind} — ${why}`, execution.fileId || '')));
    });
    emitChanged(STORE.executionActions, id);
    return {kind, id, undone: true};
  }
  if (kind === 'slice') {
    const row = await cancelValueSlice(office, id, why);
    return {kind, id, undone: true, row};
  }
  if (kind === 'judgment') {
    const row = await deleteExecutionJudgment(office, id, {reason: why});
    return {kind, id, undone: true, row};
  }
  if (kind === 'poa') {
    const poa = await office.r.executionPOAs.get(id);
    if (!poa || poa.isDeleted) throw new AppError(ERR.NOT_FOUND, 'التوكيل غير موجود.');
    const execution = await requireExecution(office, poa.executionId);
    await transaction(office.ctx, [STORE.executionPOAs, STORE.activityLog], async tx => {
      await request(tx.objectStore(STORE.executionPOAs).put({...poa, status: 'cancelled', voidedAt: stamp, voidReason: why, updatedAt: stamp, version: (poa.version || 0) + 1}));
      await request(tx.objectStore(STORE.activityLog).add(activityRow(office, STORE.executionPOAs, id, 'void', `إلغاء توكيل ${poa.poaNumber || ''} — ${why}`, execution.fileId || '')));
    });
    emitChanged(STORE.executionPOAs, id);
    return {kind, id, undone: true};
  }
  if (kind === 'note') {
    const {saveQuickNote} = await import('./quick-notes.js');
    const note = await saveQuickNote(office, {lifecycle: 'DONE', body: `[ملغاة] ${why}`}, {id}).catch(() => null);
    return {kind, id, undone: true, note};
  }
  throw new AppError(ERR.VALIDATION, 'نوع السجل المطلوب إلغاؤه غير معروف.');
}

/** تعديل إجراء: يبقى السجل، وتُحفظ النسخة القديمة على الصف نفسه. */
export async function updateSimpleAction(office, {actionId, patch = {}, reason = ''} = {}) {
  office.ctx.assert();
  const row = await office.r.executionActions.get(actionId);
  if (!row || row.isDeleted) throw new AppError(ERR.NOT_FOUND, 'الإجراء غير موجود.');
  const settings = executionSettings(office);
  const kind = patch.kind ? String(patch.kind).trim() : row.kind;
  const next = {
    ...row, ...patch, kind, date: isCivilDate(patch.date) ? patch.date : row.date,
    kindLabel: (settings.lists.actionKinds.find(([key]) => key === kind) || [kind, row.kindLabel || kind])[1],
    nextActionDate: patch.nextActionDate === undefined ? row.nextActionDate : (isCivilDate(patch.nextActionDate) ? patch.nextActionDate : ''),
    revisions: [...(row.revisions || []), {at: now(), by: office.ctx?.profile?.id || 'user', reason: String(reason || '').trim() || 'تعديل إجراء', before: {kind: row.kind, date: row.date, referenceNumber: row.referenceNumber, notes: row.notes}}],
    updatedAt: now(), version: (row.version || 0) + 1
  };
  await transaction(office.ctx, [STORE.executionActions, STORE.activityLog], async tx => {
    await request(tx.objectStore(STORE.executionActions).put(next));
    await request(tx.objectStore(STORE.activityLog).add(activityRow(office, STORE.executionActions, actionId, 'update', `تعديل إجراء ${next.kindLabel}${reason ? ` — ${reason}` : ''}`, next.fileId || '')));
  });
  emitChanged(STORE.executionActions, actionId);
  return next;
}

/** تراجع فوري (Toast): يعيد آخر عملية إلغاء إلى حالتها السابقة داخل نافذة قصيرة. */
export async function undoVoidSimpleRecord(office, {kind, id} = {}) {
  office.ctx.assert();
  const stamp = now();
  if (kind === 'receipt') {
    const receipt = await office.r.executionReceipts.get(id);
    if (!receipt) throw new AppError(ERR.NOT_FOUND, 'المحضر غير موجود.');
    await transaction(office.ctx, [STORE.executionReceipts, STORE.activityLog], async tx => {
      await request(tx.objectStore(STORE.executionReceipts).put({...receipt, status: 'posted', voidedAt: null, voidReason: '', updatedAt: stamp, version: (receipt.version || 0) + 1}));
      await request(tx.objectStore(STORE.activityLog).add(activityRow(office, STORE.executionReceipts, id, 'restore', `تراجع عن إلغاء تحصيل ${receipt.receiptNumber}`, receipt.fileId || '')));
    });
    emitChanged(STORE.executionReceipts, id);
    return true;
  }
  if (kind === 'expense') {
    const entry = await office.r.executionLedger.get(id);
    if (!entry) throw new AppError(ERR.NOT_FOUND, 'المصروف غير موجود.');
    await transaction(office.ctx, [STORE.executionLedger, STORE.activityLog], async tx => {
      await request(tx.objectStore(STORE.executionLedger).put({...entry, status: 'posted', voidedAt: null, voidReason: '', updatedAt: stamp, version: (entry.version || 0) + 1}));
      await request(tx.objectStore(STORE.activityLog).add(activityRow(office, STORE.executionLedger, id, 'restore', `تراجع عن إلغاء مصروف ${entry.label || entry.type}`, entry.fileId || '')));
    });
    emitChanged(STORE.executionLedger, id);
    return true;
  }
  if (kind === 'action') {
    const row = await office.r.executionActions.get(id);
    if (!row) throw new AppError(ERR.NOT_FOUND, 'الإجراء غير موجود.');
    await transaction(office.ctx, [STORE.executionActions, STORE.activityLog], async tx => {
      await request(tx.objectStore(STORE.executionActions).put({...row, status: 'posted', voidedAt: null, voidReason: '', isDeleted: false, deletedAt: null, deletionReason: '', updatedAt: stamp, version: (row.version || 0) + 1}));
      await request(tx.objectStore(STORE.activityLog).add(activityRow(office, STORE.executionActions, id, 'restore', `تراجع عن إلغاء إجراء ${row.kindLabel || row.kind}`, row.fileId || '')));
    });
    emitChanged(STORE.executionActions, id);
    return true;
  }
  return false;
}

/* ========================= آلة المدة والطباعة ========================= */

/** معاينة أثر حكم لاحق قبل الحفظ (What-If بلا كتابة). */
export async function previewSubsequentJudgment(office, executionId, {amount, effectiveFrom, effectiveTo = '', entitlementType = '', previousSliceId = '', asOf = ''} = {}) {
  const inputs = await executionSimpleInputs(office, executionId);
  const settings = executionSettings(office);
  const horizon = isCivilDate(asOf) ? asOf : localDate();
  const type = String(entitlementType || '').trim()
    || inputs.slices.slice().sort((a, b) => String(a.startDate).localeCompare(String(b.startDate))).at(-1)?.entitlementType || '';
  const preview = previewValueChange({
    slices: inputs.slices, receipts: inputs.receipts, allocations: inputs.allocations,
    settings: settings.schedule, asOf: horizon,
    candidate: {entitlementType: type, amount, startDate: effectiveFrom, endDate: isCivilDate(effectiveTo) ? effectiveTo : '', valueType: 'periodic', periodicity: 'monthly'},
    previousSliceId
  });
  return preview;
}

/** «احسب مدة»: المستحق/المدفوع/المتبقي عن مدة + رصيد سابق + الإجمالي. */
export async function simpleDurationClaim(office, executionId, {fromDate, toDate} = {}) {
  const inputs = await executionSimpleInputs(office, executionId);
  const settings = executionSettings(office);
  const horizon = claimHorizon(inputs.execution, toDate);
  const claim = claimForRange({
    slices: capSlicesAtHorizon(inputs.execution, inputs.slices), receipts: inputs.receipts, allocations: inputs.allocations,
    settings: settings.schedule, fromDate, toDate: horizon, asOf: claimHorizon(inputs.execution, '')
  });
  claim.currencyLabel = claim.totals.currency;
  claim.requestedToDate = toDate;
  claim.horizonCapped = Boolean(toDate && horizon && horizon < toDate);
  return claim;
}

/** مسودة توكيل: رصيد سابق + فترة جديدة + فروق مضمّنة (بلا ازدواج) + مصروفات مختارة. */
export async function simplePoaDraft(office, executionId, {fromDate, toDate, includePreviousBalance = true, expenseIds = []} = {}) {
  const inputs = await executionSimpleInputs(office, executionId);
  const settings = executionSettings(office);
  const cappedTo = claimHorizon(inputs.execution, toDate);
  const schedule = buildExecutionSchedule({
    slices: capSlicesAtHorizon(inputs.execution, inputs.slices), receipts: inputs.receipts, allocations: inputs.allocations, ledger: inputs.ledger,
    settings: settings.schedule, asOf: cappedTo || localDate()
  });
  const expenses = expensesFrom(inputs.ledger, settings);
  const draft = buildPoaFigures({schedule, fromDate, toDate: cappedTo, includePreviousBalance, expenses, expenseIds});
  draft.requestedToDate = toDate;
  draft.horizonCapped = Boolean(toDate && cappedTo && cappedTo < toDate);
  const suggestedFrom = inputs.slices.length
    ? (schedule.rows.find(row => row.remainingMinor > 0)?.fromDate || fromDate)
    : fromDate;
  return {...draft, suggestedFrom, execution: inputs.execution, expenses};
}

/** حفظ التوكيل موقّعًا كنسخة غير قابلة للتعديل (Snapshot) + طبعه عبر PrintContext. */
export async function saveSimplePoa(office, executionId, draft = {}, {date = '', notes = '', printNow = true} = {}) {
  const POA = await import('./execution-poa.js');
  const execution = await requireExecution(office, executionId);
  const lines = (draft.lines || []).map(line => ({
    kind: line.kind, label: line.label, fromDate: line.fromDate || '', toDate: line.toDate || '',
    amount: fromMinorUnits(line.amountMinor, draft.currency), amountMinor: line.amountMinor, included: true, note: line.note || ''
  }));
  const poa = await POA.saveExecutionPoa(office, {
    executionId, previousPoaId: draft.previousPoaId || '', poaNumber: String(draft.poaNumber || '').trim(),
    date: isCivilDate(date) ? date : localDate(),
    fromDate: draft.fromDate, toDate: draft.toDate, currency: draft.currency,
    baseAmount: fromMinorUnits(draft.periodDueMinor, draft.currency),
    previousBalance: fromMinorUnits(draft.previousAppliedMinor, draft.currency),
    differencesAmount: fromMinorUnits(draft.differencesMinor, draft.currency),
    expensesAmount: fromMinorUnits(draft.expensesMinor, draft.currency),
    stampAmount: 0, total: fromMinorUnits(draft.totalMinor, draft.currency),
    lines, judgmentIds: [], notes: String(notes || '').trim()
  });
  emitChanged(STORE.executionPOAs, poa.id);
  if (printNow) {
    const PR = await import('./execution-print.js');
    await PR.printPoa(office, poa.id).catch(() => null);
  }
  void execution;
  return poa;
}

/**
 * كشف حساب بسيط (ملخص/تفصيلي شهري/عن مدة) → HTML يُطبع عبر PrintContext القائم.
 * التواريخ DD/MM/YYYY والأرقام بفواصل آلاف والعملة ظاهرة.
 */
export async function simpleStatementDocument(office, executionId, {mode = 'monthly', fromDate = '', toDate = '', asOf = ''} = {}) {
  const inputs = await executionSimpleInputs(office, executionId);
  const settings = executionSettings(office);
  const schedule = buildExecutionSchedule({
    slices: capSlicesAtHorizon(inputs.execution, inputs.slices), receipts: inputs.receipts, allocations: inputs.allocations, ledger: inputs.ledger,
    settings: settings.schedule, asOf: isCivilDate(asOf) ? asOf : localDate()
  });
  const execution = inputs.execution;
  const [client, file] = await Promise.all([
    execution.clientId ? office.r.clients.get(execution.clientId).catch(() => null) : null,
    execution.fileId ? office.r.files.get(execution.fileId).catch(() => null) : null
  ]);
  const currency = schedule.currency;
  const money = minor => `${fromMinorUnits(minor, currency).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})} ج.م`;
  const date = iso => (isCivilDate(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');
  const scope = mode === 'range' && isCivilDate(fromDate) && isCivilDate(toDate) ? {fromDate, toDate} : null;
  const claim = scope ? claimForRange({slices: inputs.slices, receipts: inputs.receipts, allocations: inputs.allocations, settings: settings.schedule, fromDate: scope.fromDate, toDate: scope.toDate, asOf: schedule.asOf}) : null;
  const rows = (claim ? claim.rows : schedule.rows);
  const expenses = expensesFrom(inputs.ledger, settings);
  const parts = [];
  parts.push(`<header><h1>كشف حساب تنفيذ</h1><p class="muted">${execution.internalNumber || execution.officialNumber || 'تنفيذ بلا رقم'} — ${date(schedule.asOf)}</p></header>`);
  parts.push(`<section class="grid2">
    <div><b>الموكل:</b> ${client?.fullName || '—'}</div>
    <div><b>المنفذ ضده:</b> ${inputs.parties.find(party => party.side === 'debtor')?.name || '—'}</div>
    <div><b>رقم الملف:</b> ${file?.fileNumber || '—'}</div>
    <div><b>الرقم القضائي:</b> ${execution.officialNumber || '—'}</div>
    <div><b>الحكم:</b> ${inputs.judgments.map(judgment => judgment.judgmentNumber).filter(Boolean).join(' · ') || '—'}</div>
    <div><b>جهة التنفيذ:</b> ${execution.authority || '—'}</div>
  </section>`);
  parts.push(`<section class="numbers">
    <div><span>المطلوب حتى ${date(schedule.asOf)}</span><b>${money(claim ? claim.totals.dueMinor : schedule.totals.dueMinor)}</b></div>
    <div><span>المدفوع</span><b>${money(claim ? claim.totals.paidMinor : schedule.totals.paidMinor)}</b></div>
    <div><span>المتبقي</span><b>${money(claim ? claim.totals.remainingMinor : schedule.totals.remainingMinor)}</b></div>
  </section>`);
  if (mode !== 'summary') {
    parts.push(`<table><thead><tr><th>الفترة</th><th>المستحق</th><th>المدفوع</th><th>المتبقي</th><th>الحالة</th></tr></thead><tbody>
      ${rows.map(row => `<tr><td>${date(row.fromDate)}${row.fromDate !== row.toDate ? ` – ${date(row.toDate)}` : ''}</td><td>${money(row.dueMinor)}</td><td>${money(row.paidMinor)}</td><td>${money(row.remainingMinor)}</td><td>${periodStatusLabel(row.status)}</td></tr>`).join('')}
      <tr class="total"><td>الإجمالي</td><td>${money(sumMinor(rows, row => row.dueMinor))}</td><td>${money(sumMinor(rows, row => row.paidMinor))}</td><td>${money(sumMinor(rows, row => row.remainingMinor))}</td><td></td></tr>
    </tbody></table>`);
  }
  if (expenses.length) {
    parts.push(`<section><h3>المصروفات والرسوم (منفصلة عن أصل الدين)</h3><table><thead><tr><th>البيان</th><th>التاريخ</th><th>المبلغ</th><th>يدخل التوكيل</th></tr></thead><tbody>
      ${expenses.map(expense => `<tr><td>${expense.label}</td><td>${date(expense.date)}</td><td>${money(expense.amountMinor)}</td><td>${expense.includeInPoa ? 'نعم' : 'لا'}</td></tr>`).join('')}
    </tbody></table></section>`);
  }
  if (claim) parts.push(`<section><h3>تفصيل المدة</h3><ul>${claim.equations.map(line => `<li>${line}</li>`).join('')}</ul></section>`);
  parts.push(`<footer>طُبع في ${date(localDate())} — الأرقام مشتقة من سجلات المكتب (المطلوب − المخصّص = المتبقي).</footer>`);
  return {html: `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>كشف حساب</title>
    <style>
      body{font-family:'Segoe UI',Tahoma,sans-serif;padding:24px;color:#111}
      h1{font-size:20px;margin:0 0 4px} h3{margin:18px 0 6px;font-size:15px}
      table{width:100%;border-collapse:collapse;margin-top:8px;font-size:12px}
      th,td{border:1px solid #999;padding:6px;text-align:center}
      thead th{background:#f1f1f1} tr.total td{font-weight:700;background:#fafafa}
      .grid2{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:12px 0;font-size:13px}
      .numbers{display:flex;gap:16px;margin:12px 0}
      .numbers>div{border:1px solid #bbb;border-radius:8px;padding:8px 14px;min-width:150px;text-align:center}
      .numbers span{display:block;font-size:12px;color:#555} .numbers b{font-size:17px}
      footer{margin-top:18px;font-size:11px;color:#666} .muted{color:#666;font-size:12px}
      @media print{body{padding:0}}
    </style></head><body>${parts.join('')}</body></html>`, totals: schedule.totals, currency, rows};
}

/** طباعة كشف الحساب/التوكيل عبر PrintContext القائم (بلا نظام طباعة ثانٍ). */
export async function printSimpleStatement(office, executionId, options = {}) {
  const PR = await import('./execution-print.js');
  const doc = await simpleStatementDocument(office, executionId, options);
  PR.openDocumentForPrint(doc.html);
  return doc;
}

/* ========================= الهجرة غير المدمرة ========================= */

export const SIMPLE_MIGRATION_ID = 'executionSimpleMigration';
export const SIMPLE_MIGRATION_VERSION = 1;

/**
 * ترحيل غير مدمّر وIdempotent:
 * - لا يحوّل ولا يحذف أي سجل قائم (الاعترافات/الفروق تبقى كما هي).
 * - يبني تقرير «قبل/بعد» لكل تنفيذ: أرقام المسار القديم مقابل الجدول المشتق الجديد،
 *   ويحدد التنفيذات الناقصة (بلا دورية/سارية) ليعرض لها شريط الإكمال بدل الخطأ.
 */
export async function migrateSimpleExecutionData(office, {limit = 300} = {}) {
  office.ctx.assert();
  const meta = await office.r.meta.get(SIMPLE_MIGRATION_ID).catch(() => null);
  if (meta?.version === SIMPLE_MIGRATION_VERSION && meta.completedAt) return {...meta, reused: true};
  // نمرّ على كل التنفيذات في جلسة واحدة (صفحات بحد أقصى 100 لكل قراءة)، مع سقف آمن
  // حتى لا يتعطل الإقلاع في قاعدة ضخمة؛ وما زاد يبقى بلا completedAt ليُكمل لاحقًا.
  const cap = Math.max(100, Math.min(Number(limit) || 300, 1000));
  const executions = [];
  let cursor = null, hasMore = false;
  do {
    const page = await office.r.execution.page({index: 'openedDate', direction: 'prev', cursor, limit: 100});
    executions.push(...(page.items || []).filter(row => !row.isDeleted));
    cursor = page.nextCursor || null;
    hasMore = Boolean(page.hasMore);
  } while (cursor && hasMore && executions.length < cap);
  const settings = executionSettings(office);
  const today = localDate();
  const report = [];
  for (const execution of executions) {
    const [slices, receipts, allocations, ledger, judgments] = await Promise.all([
      office.r.executionValuePeriods.byIndex('executionId', execution.id, MAX_CHILD_ROWS).catch(() => []),
      office.r.executionReceipts.byIndex('executionId', execution.id, MAX_CHILD_ROWS).catch(() => []),
      office.r.executionAllocations.byIndex('executionId', execution.id, MAX_CHILD_ROWS).catch(() => []),
      office.r.executionLedger.byIndex('executionId', execution.id, MAX_CHILD_ROWS).catch(() => []),
      office.r.judgments.byIndex('executionId', execution.id, MAX_CHILD_ROWS).catch(() => [])
    ]);
    const schedule = buildExecutionSchedule({slices, receipts, allocations, ledger, settings: settings.schedule, asOf: today});
    const incomplete = [];
    if (!slices.length) incomplete.push({code: 'no_value', label: 'لا توجد قيمة مسجلة', hints: judgments.filter(row => !row.valueType || !row.amount).map(row => row.judgmentNumber || row.id)});
    else if (!slices.some(slice => slice.periodicity && slice.periodicity !== 'fixed')) incomplete.push({code: 'no_periodicity', label: 'القيمة بلا دورية — حدّد الدورية وتاريخ السريان لتظهر الحسابات', hints: []});
    report.push({
      executionId: execution.id, internalNumber: execution.internalNumber || execution.officialNumber || '',
      before: {slices: slices.length, receipts: receipts.length, allocations: allocations.length, ledger: ledger.length},
      after: {due: schedule.totals.dueMinor, paid: schedule.totals.paidMinor, remaining: schedule.totals.remainingMinor, credit: schedule.totals.creditMinor, periods: schedule.totals.periodCount},
      incomplete
    });
  }
  const summary = {
    id: SIMPLE_MIGRATION_ID, key: SIMPLE_MIGRATION_ID, version: SIMPLE_MIGRATION_VERSION,
    completedAt: hasMore ? '' : now(), scanned: report.length, hasMore: Boolean(hasMore),
    withIssues: report.filter(row => row.incomplete.length).length, report
  };
  await office.r.meta.put(summary).catch(() => null);
  if (!hasMore) {
    await office.log?.(STORE.meta, SIMPLE_MIGRATION_ID, 'execution_simple_migration').catch(() => null);
  }
  return {...summary, reused: false};
}

/** تنفيذات تحتاج إكمال بيانات (شريط لطيف في البطاقة، لا رسالة خطأ). */
export function completionHints(schedule, {execution, judgments = [], slices = []} = {}) {
  const hints = [];
  const live = (slices || []).filter(slice => !slice.isDeleted && !['cancelled', 'superseded'].includes(String(slice.status || '')));
  const periodic = live.filter(slice => String(slice.valueType || 'periodic') !== 'fixed');
  if (!live.length) {
    const candidate = judgments.find(judgment => Number(judgment.amount || 0) > 0) || null;
    hints.push({
      code: 'no_value', severity: 'info',
      message: candidate
        ? `الحكم ${candidate.judgmentNumber || ''} مسجّل بلا دورية ولا جدول. حدّد الدورية وتاريخ السريان لتظهر الحسابات.`
        : 'لم تُحدَّد قيمة النفقة بعد. أدخل القيمة والدورية.',
      action: 'value', actionLabel: candidate ? 'أدخل القيمة والدورية' : 'أدخل القيمة والدورية'
    });
  } else if (periodic.length && !periodic.some(slice => slice.periodicity && slice.periodicity !== 'fixed')) {
    hints.push({code: 'no_periodicity', severity: 'info', message: 'القيمة مسجلة بلا دورية. حدّد الدورية وتاريخ السريان لتظهر الحسابات.', action: 'value', actionLabel: 'حدّد الدورية'});
  }
  if (!judgments.some(judgment => String(judgment.judgmentNumber || '').trim())) hints.push({code: 'missing_judgment_number', severity: 'muted', message: 'أكمل: رقم الحكم', action: 'judgment', actionLabel: 'أكمل رقم الحكم'});
  if (!judgments.some(judgment => String(judgment.court || '').trim())) hints.push({code: 'missing_court', severity: 'muted', message: 'أكمل: المحكمة', action: 'judgment', actionLabel: 'أكمل المحكمة'});
  if (schedule?.totals?.periodCount === 0 && live.length) hints.push({code: 'no_periods', severity: 'info', message: 'لا توجد فترات محسوبة بعد — راجع تاريخ السريان.', action: 'value', actionLabel: 'راجع تاريخ السريان'});
  void execution;
  return hints;
}

export const SIMPLE_PERIOD_STATUS = PERIOD_STATUS;
export {monthLabel, addCivilDays};
