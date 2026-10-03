// FEAS Application Service: explicit obligation setup, period preview/recognition,
// reviewed judgment deltas, balance inputs and integrity checks. It composes the
// existing execution, value-period, ledger, allocation, settlement, POA and Activity Log stores.
import {STORE} from '../db/schema.js';
import {request, transaction} from '../db/unit-of-work.js';
import {uid} from '../core/id.js';
import {Clock} from '../core/clock.js';
import {AppError, ERR} from '../core/errors.js';
import {events} from '../core/events.js';
import {assertExpectedVersion} from './consistency.js';
import {
  FEAS_MODEL, FEAS_PERIOD_STATES, FEAS_RECOGNIZED_STATES, analyzeFeasValueChange,
  calculateFeasBalance, feasReviewFingerprint, recognitionPeriodKey, resolveExecutionClaim,
  validateFeasObligation
} from '../domain/execution-feas.js';
import {fromMinorUnits, sumMinor, toMinorUnits} from '../domain/execution-money.js';
import {isCivilDate} from '../domain/execution-calendar.js';

const MAX_CHILD_ROWS = 2000;
const only = key => globalThis.IDBKeyRange.only(key);
const activity = (entityType, entityId, action, summary, fileId = '') => ({
  id: uid(), entityType, entityId, action, timestamp: Clock.now(), summary, metadata: {}, ...(fileId ? {fileId} : {})
});
const emitChanged = (entityType, id) => events.emit('entity:changed', {entityType, id});

function requireFeasExecution(execution) {
  if (!execution || execution.isDeleted) throw new AppError(ERR.NOT_FOUND, 'سجل التنفيذ غير موجود.');
  if (execution.accountingModel !== FEAS_MODEL) throw new AppError(ERR.CONFLICT, 'هذا التنفيذ لم يُفعَّل له نموذج FEAS صراحةً؛ لم تُحوَّل السجلات القديمة تلقائيًا.');
  return execution;
}

async function getExecution(office, executionId) {
  return requireFeasExecution(await office.r.execution.get(executionId));
}

function readAll(tx, storeName, index, key) {
  return request(tx.objectStore(storeName).index(index).getAll(only(key)));
}

function recognitionId(executionId, periodKey) {
  return `FEASPERIOD::${encodeURIComponent(String(executionId))}::${periodKey}`;
}

function snapshotFingerprint(snapshot) {
  return JSON.stringify({
    obligationId: snapshot.obligationId, fromDate: snapshot.fromDate, toDate: snapshot.toDate,
    currency: snapshot.currency, recognizedAmountMinor: snapshot.recognizedAmountMinor,
    segments: snapshot.segments.map(row => [row.unitStart, row.unitEnd, row.valuePeriodId, row.judgmentId, row.coveredStart, row.coveredEnd, row.amountMinor])
  });
}

/** Create/update office-defined obligation metadata. No legal type or rate is inferred. */
export async function saveExecutionObligation(office, input = {}, id = null, expectedVersion = null) {
  const execution = await getExecution(office, input.executionId || (id ? (await office.r.executionObligations.get(id))?.executionId : ''));
  const old = id ? await office.r.executionObligations.get(id) : null;
  if (id && (!old || old.isDeleted)) throw new AppError(ERR.NOT_FOUND, 'الالتزام غير موجود.');
  if (old && old.executionId !== execution.id) throw new AppError(ERR.CONFLICT, 'لا يمكن نقل الالتزام إلى تنفيذ آخر.');
  if (old) assertExpectedVersion(old, expectedVersion, 'الالتزام');
  const data = {...(old || {}), ...input, executionId: execution.id};
  const errors = validateFeasObligation(data);
  if (Object.keys(errors).length) throw new AppError(ERR.VALIDATION, 'راجع تعريف الالتزام وسياسة الفترة.', errors);
  const siblings = await office.r.executionObligations.byIndex('executionId', execution.id, MAX_CHILD_ROWS + 1);
  if (siblings.some(row => !row.isDeleted && row.id !== old?.id && String(row.currency || '').toUpperCase() !== String(data.currency || '').toUpperCase())) throw new AppError(ERR.CONFLICT, 'توحيد العملة مطلوب في هذا التنفيذ لمنع جمع أرصدة بعملات مختلفة؛ أنشئ تنفيذًا مستقلًا إذا كانت العملة مختلفة.');
  if (old) {
    const recognizedRows = await office.r.executionPeriods.byIndex('executionId', execution.id, MAX_CHILD_ROWS + 1);
    const hasRecognized = recognizedRows.some(row => row.obligationId === old.id && !row.isDeleted && FEAS_RECOGNIZED_STATES.includes(row.status));
    const stableFields = ['obligationType', 'frequency', 'currency', 'prorationPolicy', 'startDate', 'endDate', 'anchorDate', 'customDays', 'beneficiaryPartyId'];
    const changedStableField = stableFields.some(key => String(old[key] ?? '') !== String(data[key] ?? ''));
    if (hasRecognized && changedStableField) throw new AppError(ERR.CONFLICT, 'تعريف مالي له فترات معترف بها؛ لا يُعدَّل بأثر رجعي. أنشئ التزامًا جديدًا أو سجّل شريحة قيمة/فرقًا موثقًا.');
  }
  if (data.beneficiaryPartyId) {
    const party = await office.r.executionParties.get(data.beneficiaryPartyId);
    if (!party || party.isDeleted || party.executionId !== execution.id) throw new AppError(ERR.VALIDATION, 'المستفيد المحدد لا يتبع هذا التنفيذ.', {beneficiaryPartyId: 'طرف غير موجود'});
  }
  const now = Clock.now();
  const row = {
    ...(old || {}), ...data,
    id: old?.id || uid(), executionId: execution.id,
    fileId: execution.fileId || '', clientId: execution.clientId || '',
    obligationType: String(data.obligationType).trim(), description: String(data.description || '').trim(),
    beneficiaryScope: data.beneficiaryPartyId ? 'PARTY' : (data.beneficiaryScope || 'UNSPECIFIED'),
    beneficiaryPartyId: data.beneficiaryPartyId || '', currency: String(data.currency).toUpperCase(),
    frequency: data.frequency, customDays: data.frequency === 'custom' ? Number(data.customDays) : null,
    anchorDate: ['weekly', 'custom'].includes(data.frequency) ? data.anchorDate : '',
    status: data.status === 'inactive' ? 'inactive' : 'active',
    createdAt: old?.createdAt || now, updatedAt: now, version: (old?.version || 0) + 1, isDeleted: false
  };
  await transaction(office.ctx, [STORE.executionObligations, STORE.activityLog], async tx => {
    await request(tx.objectStore(STORE.executionObligations).put(row));
    await request(tx.objectStore(STORE.activityLog).add(activity(STORE.executionObligations, row.id, old ? 'update' : 'create', `${old ? 'تحديث' : 'تعريف'} التزام تنفيذ: ${row.obligationType}`, row.fileId)));
  });
  emitChanged(STORE.executionObligations, row.id);
  return row;
}

export async function executionObligations(office, executionId, {includeInactive = false} = {}) {
  await getExecution(office, executionId);
  const rows = await office.r.executionObligations.byIndex('executionId', executionId, MAX_CHILD_ROWS);
  return rows.filter(row => !row.isDeleted && (includeInactive || row.status !== 'inactive')).sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
}

export async function executionRecognizedPeriods(office, executionId, {includeDeleted = false} = {}) {
  await getExecution(office, executionId);
  const rows = await office.r.executionPeriods.byIndex('executionId', executionId, MAX_CHILD_ROWS);
  return rows.filter(row => includeDeleted || !row.isDeleted).sort((a, b) => String(a.fromDate || '').localeCompare(String(b.fromDate || '')) || String(a.periodKey || '').localeCompare(String(b.periodKey || '')));
}

async function previewWithRows({execution, obligation, valuePeriods, fromDate, toDate}) {
  try {
    const preview = resolveExecutionClaim({obligation, valuePeriods, fromDate, toDate});
    if (preview.truncated) throw new AppError(ERR.VALIDATION, 'النطاق يتجاوز حد الفترات الآمن؛ قسّمه إلى نطاقات أصغر قبل الاعتراف.');
    return {...preview, fingerprint: snapshotFingerprint(preview)};
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(ERR.VALIDATION, error?.message || 'تعذر حساب الفترة بالسياسة المسجلة.');
  }
}

export async function projectExecutionPeriod(office, {executionId, obligationId, fromDate, toDate} = {}) {
  const execution = await getExecution(office, executionId);
  const obligation = await office.r.executionObligations.get(obligationId);
  if (!obligation || obligation.isDeleted || obligation.executionId !== executionId || obligation.status === 'inactive') throw new AppError(ERR.NOT_FOUND, 'الالتزام غير متاح لهذا التنفيذ.');
  if (!isCivilDate(fromDate) || !isCivilDate(toDate) || toDate < fromDate) throw new AppError(ERR.VALIDATION, 'أدخل نطاقًا مدنيًا صحيحًا للفترة.', {fromDate: 'مطلوب', toDate: 'مطلوب'});
  const valuePeriods = (await office.r.executionValuePeriods.byIndex('executionId', executionId, MAX_CHILD_ROWS)).filter(row => !row.isDeleted);
  return previewWithRows({execution, obligation, valuePeriods, fromDate, toDate});
}

/**
 * Recognize an explicit period. The deterministic id and unique composite index make
 * re-submission idempotent. Existing snapshots are returned unchanged, never rebuilt.
 */
export async function recognizeExecutionPeriod(office, {executionId, obligationId, fromDate, toDate, status = 'RECOGNIZED', reason = '', expectedFingerprint = ''} = {}) {
  if (!FEAS_RECOGNIZED_STATES.includes(status)) throw new AppError(ERR.VALIDATION, 'اختر «معترف» أو «مغلق» صراحةً؛ الإسقاط وحده لا يكتب فترة مالية.');
  if (!isCivilDate(fromDate) || !isCivilDate(toDate) || toDate < fromDate) throw new AppError(ERR.VALIDATION, 'أدخل تاريخي بداية ونهاية صحيحين.', {fromDate: 'مطلوب', toDate: 'مطلوب'});
  const execution = await getExecution(office, executionId);
  const obligation = await office.r.executionObligations.get(obligationId);
  if (!obligation || obligation.isDeleted || obligation.executionId !== executionId || obligation.status === 'inactive') throw new AppError(ERR.NOT_FOUND, 'الالتزام غير متاح لهذا التنفيذ.');
  const periodKey = recognitionPeriodKey(obligationId, fromDate, toDate);
  const id = recognitionId(executionId, periodKey);
  const now = Clock.now();
  const txResult = await transaction(office.ctx, [STORE.execution, STORE.executionObligations, STORE.executionValuePeriods, STORE.executionPeriods, STORE.activityLog], async tx => {
    const periodsStore = tx.objectStore(STORE.executionPeriods);
    const existing = await request(periodsStore.get(id));
    if (existing) return {row: existing, reused: true};
    const currentExecution = requireFeasExecution(await request(tx.objectStore(STORE.execution).get(executionId)));
    const currentObligation = await request(tx.objectStore(STORE.executionObligations).get(obligationId));
    if (!currentObligation || currentObligation.isDeleted || currentObligation.executionId !== executionId || currentObligation.status === 'inactive') throw new AppError(ERR.CONFLICT, 'تغير تعريف الالتزام قبل حفظ الفترة؛ أعد المعاينة.');
    const [valuePeriods, existingPeriods] = await Promise.all([
      readAll(tx, STORE.executionValuePeriods, 'executionId', executionId),
      request(periodsStore.index('executionId_obligationId_fromDate').getAll(globalThis.IDBKeyRange.bound([executionId, obligationId, '0000-01-01'], [executionId, obligationId, '9999-12-31'])))
    ]);
    const preview = await previewWithRows({execution: currentExecution, obligation: currentObligation, valuePeriods: valuePeriods.filter(row => !row.isDeleted), fromDate, toDate});
    if (!preview.segments.length) throw new AppError(ERR.VALIDATION, 'لا توجد قيمة مصدر تغطي النطاق؛ لم تُسجَّل فترة صفرية.');
    const fingerprint = snapshotFingerprint(preview);
    if (expectedFingerprint && expectedFingerprint !== fingerprint) throw new AppError(ERR.CONFLICT, 'تغيرت شرائح القيمة بعد المعاينة؛ أعد المعاينة قبل الاعتراف.');
    const overlap = existingPeriods.find(row => !row.isDeleted && FEAS_RECOGNIZED_STATES.includes(row.status) && row.periodKey !== periodKey && row.fromDate <= toDate && fromDate <= row.toDate);
    if (overlap) throw new AppError(ERR.CONFLICT, `يتداخل النطاق مع فترة معترف بها محفوظة (${overlap.fromDate} → ${overlap.toDate}). لا تُكرر الاعتراف؛ استخدم الفرق/التسوية الموثقة.`);
    const sourceValuePeriodIds = [...new Set(preview.segments.map(row => row.valuePeriodId).filter(Boolean))];
    const sourceJudgmentIds = [...new Set(preview.segments.map(row => row.judgmentId).filter(Boolean))];
    const row = {
      id, accountingModel: FEAS_MODEL, executionId, obligationId, periodKey,
      fileId: currentExecution.fileId || '', clientId: currentExecution.clientId || '',
      obligationTypeSnapshot: currentObligation.obligationType,
      beneficiaryPartyIdSnapshot: currentObligation.beneficiaryPartyId || '',
      currency: preview.currency, fromDate, toDate, status,
      recognizedAmountMinor: preview.recognizedAmountMinor,
      segmentsSnapshot: preview.segments.map(segment => ({...segment})),
      sourceValuePeriodIds, sourceJudgmentIds,
      frequencySnapshot: currentObligation.frequency,
      anchorDateSnapshot: currentObligation.anchorDate || '', customDaysSnapshot: currentObligation.customDays ?? null,
      prorationPolicySnapshot: currentObligation.prorationPolicy,
      equationSnapshot: preview.equation,
      recognitionReason: String(reason || '').trim(),
      recognizedAt: now, recognizedBy: office.ctx?.profile?.id || 'user',
      createdAt: now, updatedAt: now, version: 1, isDeleted: false
    };
    await request(periodsStore.add(row));
    await request(tx.objectStore(STORE.activityLog).add(activity(STORE.executionPeriods, id, 'recognize', `اعتراف صريح بفترة ${currentObligation.obligationType}: ${fromDate} → ${toDate} (${row.recognizedAmountMinor} وحدة صغرى)`, row.fileId)));
    return {row, reused: false};
  });
  if (!txResult.reused) emitChanged(STORE.executionPeriods, txResult.row.id);
  return txResult;
}

/** Close lifecycle state without changing any recognized amount/source snapshot. */
export async function closeExecutionPeriod(office, periodId, reason = '') {
  const initial = await office.r.executionPeriods.get(periodId);
  if (!initial || initial.isDeleted) throw new AppError(ERR.NOT_FOUND, 'فترة الاعتراف غير موجودة.');
  const execution = await getExecution(office, initial.executionId);
  const now = Clock.now();
  const row = await transaction(office.ctx, [STORE.executionPeriods, STORE.activityLog], async tx => {
    const store = tx.objectStore(STORE.executionPeriods);
    const current = await request(store.get(periodId));
    if (!current || current.isDeleted || current.executionId !== execution.id) throw new AppError(ERR.NOT_FOUND, 'فترة الاعتراف غير متاحة.');
    if (current.status === 'CLOSED') return current;
    if (current.status !== 'RECOGNIZED') throw new AppError(ERR.CONFLICT, 'لا يمكن إغلاق فترة لم تُعترف بها.');
    const next = {...current, status: 'CLOSED', closedAt: now, closeReason: String(reason || '').trim(), updatedAt: now, version: (current.version || 0) + 1};
    await request(store.put(next));
    await request(tx.objectStore(STORE.activityLog).add(activity(STORE.executionPeriods, periodId, 'close', `إغلاق فترة معترف بها ${current.periodKey}${reason ? ' — ' + reason : ''}`, current.fileId)));
    return next;
  });
  emitChanged(STORE.executionPeriods, periodId);
  return row;
}

async function readExecutionInputs(office, executionId) {
  const [execution, valuePeriods, obligations, periods, allocations, ledger, differences] = await Promise.all([
    office.r.execution.get(executionId),
    office.r.executionValuePeriods.byIndex('executionId', executionId, MAX_CHILD_ROWS),
    office.r.executionObligations.byIndex('executionId', executionId, MAX_CHILD_ROWS),
    office.r.executionPeriods.byIndex('executionId', executionId, MAX_CHILD_ROWS),
    office.r.executionAllocations.byIndex('executionId', executionId, MAX_CHILD_ROWS),
    office.r.executionLedger.byIndex('executionId', executionId, MAX_CHILD_ROWS),
    office.r.differenceRecords.byIndex('executionId', executionId, MAX_CHILD_ROWS)
  ]);
  requireFeasExecution(execution);
  return {execution, valuePeriods, obligations, periods, allocations, ledger, differences};
}

export async function executionFeasBalanceData(office, executionId, {asOf = ''} = {}) {
  const inputs = await readExecutionInputs(office, executionId);
  const summary = calculateFeasBalance({executionPeriods: inputs.periods, allocations: inputs.allocations, ledger: inputs.ledger, differences: inputs.differences, asOf});
  return {...inputs, summary};
}

function currentStateFingerprint(rows) { return feasReviewFingerprint(rows.map(row => ({
  periodKey: row.periodKey, oldValueMinor: row.oldValueMinor, newValueMinor: row.newValueMinor,
  collectedMinor: row.collectedMinor, differenceMinor: row.differenceMinor
}))); }

async function settlementImpactInTx(tx, settlement) {
  const [execution, candidate, obligations, valuePeriods, periods, allocations, differences] = await Promise.all([
    request(tx.objectStore(STORE.execution).get(settlement.executionId)),
    request(tx.objectStore(STORE.executionValuePeriods).get(settlement.sliceId)),
    readAll(tx, STORE.executionObligations, 'executionId', settlement.executionId),
    readAll(tx, STORE.executionValuePeriods, 'executionId', settlement.executionId),
    readAll(tx, STORE.executionPeriods, 'executionId', settlement.executionId),
    readAll(tx, STORE.executionAllocations, 'executionId', settlement.executionId),
    readAll(tx, STORE.differenceRecords, 'executionId', settlement.executionId)
  ]);
  requireFeasExecution(execution);
  if (!candidate || candidate.isDeleted || candidate.obligationId !== settlement.obligationId) throw new AppError(ERR.CONFLICT, 'شريحة القيمة المرشحة لم تعد متاحة للالتزام.');
  const obligation = obligations.find(row => row.id === settlement.obligationId && !row.isDeleted);
  if (!obligation) throw new AppError(ERR.CONFLICT, 'تعريف الالتزام غير متاح؛ لم يُعتمد الفرق.');
  const impact = analyzeFeasValueChange({obligation, valuePeriods: valuePeriods.filter(row => !row.isDeleted), executionPeriods: periods, allocations, differences, candidateValuePeriodId: candidate.id});
  return {execution, candidate, obligation, impact, allocations, differences};
}

function differenceRow(office, execution, settlement, impactRow, now, old = null) {
  const row = {
    ...(old || {}),
    id: old?.id || uid(), accountingModel: FEAS_MODEL,
    executionId: execution.id, settlementId: settlement.id,
    fileId: execution.fileId || '', clientId: execution.clientId || '',
    periodKey: impactRow.periodKey, executionPeriodId: impactRow.executionPeriodId, obligationId: impactRow.obligationId,
    entitlementType: impactRow.entitlementType, periodStart: impactRow.start, periodEnd: impactRow.end,
    currency: settlement.currency,
    previousJudgmentId: impactRow.previousJudgmentId, newJudgmentId: impactRow.newJudgmentId,
    previousSliceId: impactRow.previousSliceId, newSliceId: impactRow.newSliceId,
    oldValueMinor: impactRow.oldValueMinor, newValueMinor: impactRow.newValueMinor,
    differenceAmountMinor: impactRow.differenceMinor, previouslyCollectedMinor: impactRow.collectedMinor,
    oldValue: impactRow.oldValue, newValue: impactRow.newValue,
    differenceAmount: impactRow.difference, previouslyCollected: impactRow.collected,
    originalOutstanding: fromMinorUnits(Math.max(0, impactRow.oldValueMinor - impactRow.collectedMinor), settlement.currency),
    remainingAfter: fromMinorUnits(impactRow.newValueMinor - impactRow.collectedMinor, settlement.currency),
    equation: impactRow.equation, executedEarlier: impactRow.collectedMinor > 0,
    status: 'PENDING_REVIEW', postedLedgerId: '',
    createdAt: old?.createdAt || now, createdBy: office.ctx?.profile?.id || 'user',
    updatedAt: now, version: (old?.version || 0) + 1, isDeleted: false
  };
  return row;
}

/** Compare recognized snapshots with a candidate rate change. Pending rows never affect principal. */
export async function previewExecutionDifference(office, {executionId, sliceId} = {}) {
  const data = await readExecutionInputs(office, executionId);
  const candidate = data.valuePeriods.find(row => row.id === sliceId && !row.isDeleted);
  if (!candidate?.obligationId) throw new AppError(ERR.VALIDATION, 'شريحة القيمة المرشحة غير مرتبطة بالتزام FEAS.');
  const obligation = data.obligations.find(row => row.id === candidate.obligationId && !row.isDeleted);
  if (!obligation) throw new AppError(ERR.NOT_FOUND, 'الالتزام المرتبط بالشريحة غير موجود.');
  const impact = analyzeFeasValueChange({obligation, valuePeriods: data.valuePeriods, executionPeriods: data.periods, allocations: data.allocations, differences: data.differences, candidateValuePeriodId: sliceId});
  return {slice: candidate, obligation, impact};
}

export async function createExecutionSettlement(office, {executionId, sliceId, note = ''} = {}) {
  const preview = await previewExecutionDifference(office, {executionId, sliceId});
  if (!preview.impact.rows.length) throw new AppError(ERR.VALIDATION, 'لا يوجد فرق على فترة معترف بها؛ لا تُنشأ تسوية بلا أثر.');
  const existingRows = await office.r.executionSettlements.byIndex('executionId', executionId, MAX_CHILD_ROWS);
  const existing = existingRows.find(row => row.accountingModel === FEAS_MODEL && row.sliceId === sliceId && ['PENDING_REVIEW', 'REVIEWED'].includes(row.status) && !row.isDeleted);
  if (existing) return {settlement: existing, differences: await office.r.differenceRecords.byIndex('settlementId', existing.id, MAX_CHILD_ROWS), impact: preview.impact, reused: true};
  const execution = preview.impact.obligation ? (await office.r.execution.get(executionId)) : null;
  const now = Clock.now();
  const settlementId = uid();
  const totalsMinor = preview.impact.totalsMinor;
  const settlement = {
    id: settlementId, accountingModel: FEAS_MODEL, executionId,
    fileId: execution?.fileId || '', clientId: execution?.clientId || '',
    sliceId, obligationId: preview.obligation.id, entitlementType: preview.obligation.obligationType,
    currency: preview.obligation.currency,
    previousJudgmentId: preview.impact.rows[0]?.previousJudgmentId || '', newJudgmentId: preview.slice.judgmentId || '',
    status: 'PENDING_REVIEW', totals: preview.impact.totals, totalsMinor,
    affectedPeriods: preview.impact.rows.length, range: preview.impact.range,
    note: String(note || '').trim(), expectedBase: '',
    createdBy: office.ctx?.profile?.id || 'user', createdAt: now, updatedAt: now, version: 1, isDeleted: false
  };
  const differences = preview.impact.rows.map(row => differenceRow(office, execution, settlement, row, now));
  const saved = await transaction(office.ctx, [STORE.executionSettlements, STORE.differenceRecords, STORE.activityLog], async tx => {
    const settlementStore = tx.objectStore(STORE.executionSettlements);
    const currentRows = await request(settlementStore.index('executionId').getAll(only(executionId)));
    const concurrent = currentRows.find(row => row.accountingModel === FEAS_MODEL && row.sliceId === sliceId && ['PENDING_REVIEW', 'REVIEWED'].includes(row.status) && !row.isDeleted);
    if (concurrent) {
      const rows = await request(tx.objectStore(STORE.differenceRecords).index('settlementId').getAll(only(concurrent.id)));
      return {settlement: concurrent, differences: rows, reused: true};
    }
    await request(settlementStore.add(settlement));
    for (const row of differences) await request(tx.objectStore(STORE.differenceRecords).add(row));
    await request(tx.objectStore(STORE.activityLog).add(activity(STORE.executionSettlements, settlementId, 'create', `تسوية FEAS: ${differences.length} فترة اعتراف، فرق تفسيري ${totalsMinor.difference} وحدة صغرى (تنتظر المراجعة)`, settlement.fileId)));
    return {settlement, differences, reused: false};
  });
  if (!saved.reused) emitChanged(STORE.executionSettlements, settlementId);
  return {...saved, impact: preview.impact};
}

export async function readExecutionSettlement(office, settlementId) {
  const settlement = await office.r.executionSettlements.get(settlementId);
  if (!settlement || settlement.isDeleted || settlement.accountingModel !== FEAS_MODEL) throw new AppError(ERR.NOT_FOUND, 'تسوية FEAS غير موجودة.');
  const rows = await office.r.differenceRecords.byIndex('settlementId', settlementId, MAX_CHILD_ROWS);
  return {settlement, rows: rows.sort((a, b) => String(a.periodKey || '').localeCompare(String(b.periodKey || '')))};
}

/** Capture a review basis. Approval is only valid while this exact basis remains current. */
export async function reviewExecutionSettlement(office, settlementId) {
  const initial = await office.r.executionSettlements.get(settlementId);
  if (!initial || initial.isDeleted || initial.accountingModel !== FEAS_MODEL) throw new AppError(ERR.NOT_FOUND, 'تسوية FEAS غير موجودة.');
  const now = Clock.now();
  const result = await transaction(office.ctx, [
    STORE.execution, STORE.executionObligations, STORE.executionValuePeriods, STORE.executionPeriods,
    STORE.executionAllocations, STORE.differenceRecords, STORE.executionSettlements, STORE.activityLog
  ], async tx => {
    const settlements = tx.objectStore(STORE.executionSettlements), settlement = await request(settlements.get(settlementId));
    if (!settlement || settlement.isDeleted || settlement.accountingModel !== FEAS_MODEL) throw new AppError(ERR.NOT_FOUND, 'تسوية FEAS غير موجودة.');
    if (!['PENDING_REVIEW', 'REVIEWED'].includes(settlement.status)) throw new AppError(ERR.CONFLICT, 'لا يمكن مراجعة تسوية بعد اعتمادها أو رفضها.');
    const {execution, impact} = await settlementImpactInTx(tx, settlement);
    if (!impact.rows.length) throw new AppError(ERR.CONFLICT, 'لم يعد هناك فرق على الفترات المعترف بها؛ أعد الحساب أو ألغِ التسوية.');
    const rowsStore = tx.objectStore(STORE.differenceRecords);
    const oldRows = await request(rowsStore.index('settlementId').getAll(only(settlementId)));
    const oldByKey = new Map(oldRows.filter(row => ['PENDING_REVIEW', 'REVIEWED'].includes(row.status)).map(row => [row.periodKey, row]));
    const rows = impact.rows.map(row => differenceRow(office, execution, settlement, row, now, oldByKey.get(row.periodKey)));
    const currentKeys = new Set(rows.map(row => row.periodKey));
    for (const old of oldByKey.values()) if (!currentKeys.has(old.periodKey)) await request(rowsStore.put({...old, status: 'CANCELLED', supersededAt: now, updatedAt: now, version: (old.version || 0) + 1}));
    for (const row of rows) await request(row.id && oldByKey.has(row.periodKey) ? rowsStore.put(row) : rowsStore.add(row));
    const expectedBase = currentStateFingerprint(impact.rows);
    const next = {...settlement, status: 'REVIEWED', totals: impact.totals, totalsMinor: impact.totalsMinor, affectedPeriods: rows.length, range: impact.range, expectedBase, reviewedAt: now, updatedAt: now, version: (settlement.version || 0) + 1};
    await request(settlements.put(next));
    await request(tx.objectStore(STORE.activityLog).add(activity(STORE.executionSettlements, settlementId, 'review', `مراجعة تسوية FEAS: ${rows.length} فترة؛ ثُبّت أساس المقارنة قبل القرار`, settlement.fileId)));
    return {settlement: next, rows};
  });
  emitChanged(STORE.executionSettlements, settlementId);
  return result;
}

/** Approval/rejection requires REVIEWED; approval rechecks its fingerprint inside the readwrite transaction. */
export async function decideExecutionSettlement(office, settlementId, {decision, reason = ''} = {}) {
  if (!['approve', 'reject'].includes(decision)) throw new AppError(ERR.VALIDATION, 'قرار التسوية غير معروف.');
  const now = Clock.now();
  const result = await transaction(office.ctx, [
    STORE.execution, STORE.executionObligations, STORE.executionValuePeriods, STORE.executionPeriods,
    STORE.executionAllocations, STORE.differenceRecords, STORE.executionSettlements, STORE.activityLog
  ], async tx => {
    const settlements = tx.objectStore(STORE.executionSettlements), settlement = await request(settlements.get(settlementId));
    if (!settlement || settlement.isDeleted || settlement.accountingModel !== FEAS_MODEL) throw new AppError(ERR.NOT_FOUND, 'تسوية FEAS غير موجودة.');
    if (settlement.status !== 'REVIEWED' || !settlement.expectedBase) throw new AppError(ERR.CONFLICT, 'يجب تثبيت مراجعة التسوية قبل القرار.');
    const {execution, candidate, impact} = await settlementImpactInTx(tx, settlement);
    if (currentStateFingerprint(impact.rows) !== settlement.expectedBase) throw new AppError(ERR.CONFLICT, 'تغيرت القيمة أو التخصيصات بعد المراجعة؛ أعد المراجعة قبل القرار.');
    const rowsStore = tx.objectStore(STORE.differenceRecords);
    const rows = await request(rowsStore.index('settlementId').getAll(only(settlementId)));
    const status = decision === 'approve' ? 'APPROVED' : 'CANCELLED';
    const selected = rows.filter(row => row.accountingModel === FEAS_MODEL && ['PENDING_REVIEW', 'REVIEWED'].includes(row.status));
    for (const row of selected) await request(rowsStore.put({...row, status, decisionReason: String(reason || '').trim(), decidedAt: now, updatedAt: now, version: (row.version || 0) + 1}));
    const nextSettlement = {...settlement, status: decision === 'approve' ? 'APPROVED' : 'CANCELLED', decisionReason: String(reason || '').trim(), decidedAt: now, updatedAt: now, version: (settlement.version || 0) + 1};
    await request(settlements.put(nextSettlement));
    const slices = tx.objectStore(STORE.executionValuePeriods);
    if (decision === 'approve' && candidate.status === 'needs_review') {
      await request(slices.put({...candidate, status: 'active', approvedAt: now, updatedAt: now, version: (candidate.version || 0) + 1}));
    } else if (decision === 'reject' && candidate.status !== 'cancelled') {
      await request(slices.put({...candidate, status: 'cancelled', cancelledAt: now, cancelReason: String(reason || 'رُفضت التسوية المرتبطة'), updatedAt: now, version: (candidate.version || 0) + 1}));
    }
    await request(tx.objectStore(STORE.activityLog).add(activity(STORE.executionSettlements, settlementId, decision, `${decision === 'approve' ? 'اعتماد' : 'رفض'} تسوية FEAS (${selected.length} فترة؛ الفرق لا يُرحَّل كدين إضافي)${reason ? ' — ' + reason : ''}`, settlement.fileId)));
    return {settlement: nextSettlement, rows: selected};
  });
  emitChanged(STORE.executionSettlements, settlementId);
  return result;
}

/** Posting finalizes the audit state only; approved deltas already affect the derived balance exactly once. */
export async function postExecutionSettlement(office, settlementId) {
  const now = Clock.now();
  const result = await transaction(office.ctx, [STORE.differenceRecords, STORE.executionSettlements, STORE.activityLog], async tx => {
    const settlements = tx.objectStore(STORE.executionSettlements), settlement = await request(settlements.get(settlementId));
    if (!settlement || settlement.isDeleted || settlement.accountingModel !== FEAS_MODEL) throw new AppError(ERR.NOT_FOUND, 'تسوية FEAS غير موجودة.');
    const rowsStore = tx.objectStore(STORE.differenceRecords);
    const all = await request(rowsStore.index('settlementId').getAll(only(settlementId)));
    if (settlement.status === 'POSTED') return {settlement, rows: all.filter(row => row.status === 'POSTED'), reused: true};
    if (settlement.status !== 'APPROVED') throw new AppError(ERR.CONFLICT, 'لا يمكن إنهاء تسوية قبل اعتمادها.');
    const rows = all.filter(row => row.accountingModel === FEAS_MODEL && row.status === 'APPROVED');
    if (!rows.length) throw new AppError(ERR.VALIDATION, 'لا توجد فروق معتمدة لتثبيتها.');
    for (const row of rows) await request(rowsStore.put({...row, status: 'POSTED', postedAt: now, postedLedgerId: '', postedAs: 'recognized-period-delta', updatedAt: now, version: (row.version || 0) + 1}));
    const next = {...settlement, status: 'POSTED', postedAt: now, updatedAt: now, version: (settlement.version || 0) + 1};
    await request(settlements.put(next));
    await request(tx.objectStore(STORE.activityLog).add(activity(STORE.executionSettlements, settlementId, 'post', `تثبيت تسوية FEAS: ${rows.length} فرقًا تفسيريًا — بلا حركة أصل دين مكررة`, settlement.fileId)));
    return {settlement: next, rows, reused: false};
  });
  if (!result.reused) emitChanged(STORE.executionSettlements, settlementId);
  return result;
}

export async function recomputeExecutionSettlement(office, settlementId) {
  const initial = await office.r.executionSettlements.get(settlementId);
  if (!initial || initial.isDeleted || initial.accountingModel !== FEAS_MODEL) throw new AppError(ERR.NOT_FOUND, 'تسوية FEAS غير موجودة.');
  const now = Clock.now();
  const result = await transaction(office.ctx, [
    STORE.execution, STORE.executionObligations, STORE.executionValuePeriods, STORE.executionPeriods,
    STORE.executionAllocations, STORE.differenceRecords, STORE.executionSettlements, STORE.activityLog
  ], async tx => {
    const settlements = tx.objectStore(STORE.executionSettlements), settlement = await request(settlements.get(settlementId));
    if (!settlement || !['PENDING_REVIEW', 'REVIEWED'].includes(settlement.status)) throw new AppError(ERR.CONFLICT, 'لا يمكن إعادة حساب تسوية بعد اعتمادها أو رفضها.');
    const {execution, impact} = await settlementImpactInTx(tx, settlement);
    if (!impact.rows.length) throw new AppError(ERR.VALIDATION, 'لا يوجد أثر مالي على الفترات المعترف بها.');
    const differences = tx.objectStore(STORE.differenceRecords);
    const previous = await request(differences.index('settlementId').getAll(only(settlementId)));
    for (const row of previous) if (['PENDING_REVIEW', 'REVIEWED'].includes(row.status)) await request(differences.put({...row, status: 'CANCELLED', supersededAt: now, updatedAt: now, version: (row.version || 0) + 1}));
    const rows = impact.rows.map(row => differenceRow(office, execution, settlement, row, now));
    for (const row of rows) await request(differences.add(row));
    const next = {...settlement, status: 'PENDING_REVIEW', expectedBase: '', totals: impact.totals, totalsMinor: impact.totalsMinor, affectedPeriods: rows.length, range: impact.range, updatedAt: now, version: (settlement.version || 0) + 1};
    await request(settlements.put(next));
    await request(tx.objectStore(STORE.activityLog).add(activity(STORE.executionSettlements, settlementId, 'recompute', `إعادة حساب تسوية FEAS: ${rows.length} صفوف جديدة؛ السابقة محفوظة`, settlement.fileId)));
    return {settlement: next, rows};
  });
  emitChanged(STORE.executionSettlements, settlementId);
  return result;
}

export async function executionIntegrityReport(office, executionId) {
  const execution = await office.r.execution.get(executionId);
  if (!execution || execution.isDeleted) throw new AppError(ERR.NOT_FOUND, 'سجل التنفيذ غير موجود.');
  const [periods, obligations, allocations, ledger, receipts, differences, settlements, poas, valuePeriods, judgments] = await Promise.all([
    office.r.executionPeriods.byIndex('executionId', executionId, MAX_CHILD_ROWS).catch(() => []),
    office.r.executionObligations.byIndex('executionId', executionId, MAX_CHILD_ROWS).catch(() => []),
    office.r.executionAllocations.byIndex('executionId', executionId, MAX_CHILD_ROWS).catch(() => []),
    office.r.executionLedger.byIndex('executionId', executionId, MAX_CHILD_ROWS).catch(() => []),
    office.r.executionReceipts.byIndex('executionId', executionId, MAX_CHILD_ROWS).catch(() => []),
    office.r.differenceRecords.byIndex('executionId', executionId, MAX_CHILD_ROWS).catch(() => []),
    office.r.executionSettlements.byIndex('executionId', executionId, MAX_CHILD_ROWS).catch(() => []),
    office.r.executionPOAs.byIndex('executionId', executionId, MAX_CHILD_ROWS).catch(() => []),
    office.r.executionValuePeriods.byIndex('executionId', executionId, MAX_CHILD_ROWS).catch(() => []),
    office.r.judgments.byIndex('executionId', executionId, MAX_CHILD_ROWS).catch(() => [])
  ]);
  const issues = [];
  const add = (code, severity, recordType, recordId, reason, suggestion) => issues.push({code, severity, recordType, recordId, reason, suggestion});
  const livePeriods = periods.filter(row => !row.isDeleted && FEAS_RECOGNIZED_STATES.includes(row.status));
  const obligationsById = new Map(obligations.filter(row => !row.isDeleted).map(row => [row.id, row]));
  const periodKeys = new Set();
  for (let i = 0; i < livePeriods.length; i++) {
    const row = livePeriods[i];
    if (periodKeys.has(row.periodKey)) add('duplicate-period-key', 'error', STORE.executionPeriods, row.id, `يوجد مفتاح فترة اعتراف مكرر: ${row.periodKey}`, 'أوقف المزامنة أو التحرير المتوازي وراجع السجلين قبل أي تصحيح موثق.');
    periodKeys.add(row.periodKey);
    if (!obligationsById.has(row.obligationId)) add('missing-obligation', 'error', STORE.executionPeriods, row.id, 'فترة معترف بها تشير إلى التزام مفقود.', 'راجع النسخة/المزامنة واربط المصدر الصحيح دون إنشاء دين بديل.');
    if (!Number.isSafeInteger(row.recognizedAmountMinor) || row.recognizedAmountMinor < 0) add('invalid-minor-amount', 'error', STORE.executionPeriods, row.id, 'مبلغ الاعتراف ليس عدد وحدات صغرى صحيحًا.', 'أوقف الاعتماد واطلب مراجعة قيمة المصدر وتدقيق العملة.');
    if (!isCivilDate(row.fromDate) || !isCivilDate(row.toDate) || row.toDate < row.fromDate) add('invalid-civil-range', 'error', STORE.executionPeriods, row.id, 'نطاق الفترة لا يطابق تاريخًا مدنيًا صالحًا.', 'راجع تاريخ البداية والنهاية كما سُجلا؛ لا يستنتج النظام بديلًا.');
    const sources = row.sourceValuePeriodIds || [];
    if (!sources.length) add('missing-value-trace', 'error', STORE.executionPeriods, row.id, 'لقطة الاعتراف لا تحمل معرّف شريحة قيمة مصدر.', 'راجع السجل الأصلي والنسخة الاحتياطية قبل أي اعتماد.');
    for (const sourceId of sources) if (!valuePeriods.some(value => value.id === sourceId && !value.isDeleted)) add('missing-value-source', 'error', STORE.executionPeriods, row.id, `شريحة القيمة المصدر ${sourceId} غير موجودة.`, 'استعد المصدر من نسخة موثوقة ولا تعِد حساب اللقطة بصمت.');
    for (const judgmentId of row.sourceJudgmentIds || []) if (!judgments.some(judgment => judgment.id === judgmentId && !judgment.isDeleted)) add('missing-judgment-source', 'error', STORE.executionPeriods, row.id, `الحكم المصدر ${judgmentId} غير موجود.`, 'راجع سلسلة الأحكام والنسخة الاحتياطية.');
    for (let j = i + 1; j < livePeriods.length; j++) {
      const other = livePeriods[j];
      if (other.obligationId === row.obligationId && row.fromDate <= other.toDate && other.fromDate <= row.toDate) add('overlapping-recognition', 'error', STORE.executionPeriods, other.id, `الفترة تتداخل مع ${row.fromDate} → ${row.toDate} للالتزام نفسه.`, 'أوقف التخصيص وراجع الاعترافين؛ لا تحذف أي سجل مالي.');
    }
  }
  const recognizedByKey = new Map(livePeriods.map(row => [row.periodKey, row]));
  for (const row of allocations.filter(item => !item.isDeleted && item.isActive !== false)) {
    if (execution.accountingModel === FEAS_MODEL && !recognizedByKey.has(row.periodKey)) add('allocation-unknown-feas-period', 'error', STORE.executionAllocations, row.id, `التخصيص يشير إلى فترة غير معترف بها: ${row.periodKey}`, 'أعد مراجعة التخصيصات النشطة وأبقِ السطور التاريخية محفوظة.');
    if (execution.accountingModel === FEAS_MODEL && !Number.isSafeInteger(row.amountMinor)) add('allocation-no-minor-amount', 'error', STORE.executionAllocations, row.id, 'التخصيص لا يحمل مبلغًا بوحدات صغرى.', 'راجع مبلغ التحصيل والتخصيص؛ لا تحوّل السجل القديم تلقائيًا.');
  }
  const receiptById = new Map(receipts.filter(row => !row.isDeleted).map(row => [row.id, row]));
  const allocatedByReceipt = new Map();
  const receiptPeriodSeen = new Set();
  for (const allocation of allocations.filter(row => !row.isDeleted && row.isActive !== false && row.receiptId)) {
    const key = `${allocation.receiptId}|${allocation.periodKey}`;
    if (receiptPeriodSeen.has(key)) add('duplicate-receipt-allocation', 'warn', STORE.executionAllocations, allocation.id, 'يوجد أكثر من سطر تخصيص نشط للمحضر والفترة نفسيهما.', 'راجع المحضر وأعد التخصيص من المسار الرسمي إن كان التكرار غير مقصود.');
    receiptPeriodSeen.add(key);
    allocatedByReceipt.set(allocation.receiptId, (allocatedByReceipt.get(allocation.receiptId) || 0) + (Number.isSafeInteger(allocation.amountMinor) ? allocation.amountMinor : 0));
  }
  for (const [receiptId, total] of allocatedByReceipt) {
    const receipt = receiptById.get(receiptId);
    if (!receipt) add('allocation-missing-receipt', 'error', STORE.executionAllocations, receiptId, 'تخصيص فعّال لا يملك محضر تحصيل مصدرًا.', 'افحص سجل الدفتر/النسخة الاحتياطية قبل إعادة الربط.');
    else if (Number.isSafeInteger(receipt.amountMinor) && total > receipt.amountMinor) add('receipt-overallocated', 'error', STORE.executionReceipts, receiptId, 'إجمالي التخصيص يتجاوز مبلغ المحضر المسجل.', 'أوقف إعادة التخصيص حتى مطابقة كل السطور مع مصدر التحصيل.');
  }
  for (const row of ledger.filter(item => !item.isDeleted)) if (execution.accountingModel === FEAS_MODEL && !Number.isSafeInteger(row.amountMinor)) add('ledger-no-minor-amount', 'error', STORE.executionLedger, row.id, 'حركة مالية مرتبطة بـ FEAS بلا قيمة بوحدات صغرى.', 'لا تعتمد الرصيد؛ راجع الحركة وسجل تصحيحًا موثقًا بعد التحقق.');
  for (const row of settlements.filter(item => !item.isDeleted && item.accountingModel === FEAS_MODEL)) {
    if (['APPROVED', 'POSTED'].includes(row.status) && !row.expectedBase) add('approved-without-review-fingerprint', 'error', STORE.executionSettlements, row.id, 'تسوية معتمدة بلا بصمة أساس مراجعة.', 'لا ترحّلها؛ أعد المراجعة من المصدر إن أمكن.');
  }
  const liveDifferenceKeys = new Set();
  for (const row of differences.filter(item => !item.isDeleted && item.accountingModel === FEAS_MODEL && ['PENDING_REVIEW', 'REVIEWED', 'APPROVED', 'POSTED'].includes(item.status))) {
    const key = `${row.settlementId || ''}|${row.periodKey}`;
    if (row.settlementId && liveDifferenceKeys.has(key)) add('duplicate-settlement-period-delta', 'error', STORE.differenceRecords, row.id, `تسوية ${row.settlementId} تحتوي أكثر من فرق فعال للفترة ${row.periodKey}.`, 'أوقف الحساب والترحيل، وراجع سجلات التزامن والبصمات قبل أي تصحيح.');
    if (row.settlementId) liveDifferenceKeys.add(key);
  }
  for (const poa of poas.filter(row => !row.isDeleted && row.accountingModel === FEAS_MODEL)) {
    if (!Array.isArray(poa.lines) || !poa.lines.length) add('poa-without-lines', 'warn', STORE.executionPOAs, poa.id, 'لقطة التوكيل لا تحمل تفصيل بنودها.', 'افتح المستند الأصلي وقارن بنسخة موثوقة؛ لا يُنشئ التوكيل دينًا.');
    if (Number.isSafeInteger(poa.totalMinor) && Number.isSafeInteger(poa.lines?.reduce((sum, line) => sum + (line.included && Number.isSafeInteger(line.amountMinor) ? line.amountMinor : 0), 0))
      && poa.totalMinor !== poa.lines.reduce((sum, line) => sum + (line.included && Number.isSafeInteger(line.amountMinor) ? line.amountMinor : 0), 0)) add('poa-total-mismatch', 'error', STORE.executionPOAs, poa.id, 'إجمالي لقطة التوكيل لا يساوي مجموع البنود المدرجة.', 'راجع صورة التوكيل المحفوظة؛ لا يعاد حسابها من السجلات الحالية.');
  }
  return {executionId, accountingModel: execution.accountingModel || 'legacy-v1', scanned: {periods: periods.length, allocations: allocations.length, ledger: ledger.length, differences: differences.length, settlements: settlements.length, poas: poas.length}, issues};
}

export {FEAS_MODEL, FEAS_PERIOD_STATES, FEAS_RECOGNIZED_STATES, resolveExecutionClaim, calculateFeasBalance};
