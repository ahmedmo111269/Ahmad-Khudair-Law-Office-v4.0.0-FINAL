// =====================================================================
// محرك الفروق وطبقة التسوية (Difference Engine + Settlement Layer)
// ---------------------------------------------------------------------
// • ما يحدث عند إدخال حكم لاحق يمسّ فترات سابقة: يُكتشف الأثر، ويُنشأ سجل فرق
//   لكل فترة (differenceRecords) بحالة «تنتظر المراجعة» + تسوية (executionSettlements)
//   تستعرض: الفترة | القديم | الجديد | المحصل | الفرق | الرصيد.
// • لا يصبح الفرق حركة مالية فعلية إلا بعد قرار المستخدم: اعتماد ← ثم ترحيل.
// • لا ازدواج: الفرق لا يُضاف فوق قيمة الحكم الأصلي؛ محرك الاستحقاق يعرض القيمة
//   النهائية مرة واحدة والفرق أثرًا تفسيريًا عليها. الترحيل يسجّل الالتزام المعتمد
//   (DIFFERENCE_DUE) للتوثيق والتتبع والتوكيلات، لا ليُجمع فوق الاستحقاق.
// • فرق التخفيض لا يُنشئ التزامًا؛ أثره محسوب في الاستحقاق ويُسجَّل كذلك في السجل.
// =====================================================================
import {STORE} from '../db/schema.js';
import {transaction, request} from '../db/unit-of-work.js';
import {uid} from '../core/id.js';
import {Clock, localDate} from '../core/clock.js';
import {AppError, ERR} from '../core/errors.js';
import {events} from '../core/events.js';
import {num, round2, IN_REVIEW_DIFFERENCE_STATUSES, ACTIVE_DIFFERENCE_STATUSES, differenceStatusLabel, money} from '../domain/execution.js';
import {analyzeSliceImpact, netLedger} from '../domain/entitlement-engine.js';
import {executionSlices, executionAllocations, executionLedgerRows, executionDifferences, executionJudgments} from './execution.js';
import {FEAS_MODEL} from '../domain/execution-feas.js';
import {createExecutionSettlement, previewExecutionDifference, readExecutionSettlement, reviewExecutionSettlement, decideExecutionSettlement, postExecutionSettlement, recomputeExecutionSettlement} from './execution-feas.js';
import {executionSettings} from './execution-settings.js';

const logRow = (office, entityType, entityId, action, summary, {fileId = null, metadata = {}} = {}) => {
  const row = {id: uid(), entityType, entityId, action, timestamp: Clock.now(), summary, metadata};
  if (fileId) row.fileId = fileId;
  return row;
};

/** شريحة مرشحة لإحداث فرق: الشريحة المطلوبة أو أحدث شريحة لحكم معيّن. */
function resolveSlice({slices, sliceId, judgmentId}) {
  if (sliceId) return slices.find(slice => slice.id === sliceId) || null;
  if (judgmentId) return slices.filter(slice => slice.judgmentId === judgmentId).sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))[0] || null;
  return null;
}

/** معاينة الأثر بلا أي كتابة (تُستخدم في شاشة المراجعة والمحاكي). */
export async function previewImpact(office, {executionId, sliceId = '', judgmentId = '', throughDate = ''} = {}) {
  const execution = await office.r.execution.get(executionId);
  if (!execution || execution.isDeleted) throw new AppError(ERR.NOT_FOUND, 'سجل التنفيذ غير موجود.');
  if (execution.accountingModel === FEAS_MODEL) {
    const preview = await previewExecutionDifference(office, {executionId, sliceId: sliceId || (judgmentId ? (await office.r.executionValuePeriods.byIndex('linkedJudgmentId', judgmentId, 1))[0]?.id : '')});
    return {slice: preview.slice, impact: preview.impact};
  }
  const [slices, allocations] = await Promise.all([executionSlices(office, executionId), executionAllocations(office, executionId)]);
  const slice = resolveSlice({slices, sliceId, judgmentId});
  if (!slice) throw new AppError(ERR.VALIDATION, 'لا توجد شريحة قيمة مرتبطة بهذا الحكم.');
  const impact = analyzeSliceImpact({
    slices, newSlice: slice, allocations,
    throughDate: throughDate || execution.entitlementThroughDate || '',
    settings: executionSettings(office).schedule
  });
  return {slice, impact};
}

/**
 * إنشاء تسوية فروق: تُنشئ سجلات فرق لكل فترة متأثرة بحالة «تنتظر المراجعة».
 * Idempotent: إعادة الاستدعاء لنفس الشريحة وهي قيد المراجعة تُرجع التسوية القائمة.
 */
export async function createSettlement(office, {executionId, sliceId = '', judgmentId = '', note = ''} = {}) {
  const execution = await office.r.execution.get(executionId);
  if (!execution || execution.isDeleted) throw new AppError(ERR.NOT_FOUND, 'سجل التنفيذ غير موجود.');
  if (execution.accountingModel === FEAS_MODEL) {
    const id = sliceId || (judgmentId ? (await office.r.executionValuePeriods.byIndex('linkedJudgmentId', judgmentId, 1))[0]?.id : '');
    return createExecutionSettlement(office, {executionId, sliceId: id, note});
  }
  const {slice, impact} = await previewImpact(office, {executionId, sliceId, judgmentId});
  if (!impact.rows.length) throw new AppError(ERR.VALIDATION, 'لا يوجد أثر مالي على فترات سابقة لهذه الشريحة: القيم متطابقة أو لا توجد فترات متأثرة.');
  const existing = (await office.r.executionSettlements.byIndexAll('executionId', executionId))
    .find(row => row.sliceId === slice.id && IN_REVIEW_DIFFERENCE_STATUSES.includes(row.status));
  if (existing) {
    const rows = await office.r.differenceRecords.byIndexAll('settlementId', existing.id).catch(() => []);
    return {settlement: existing, differences: rows, impact, reused: true};
  }
  const now = Clock.now();
  const settlementId = uid();
  const settlement = {
    id: settlementId,
    executionId,
    fileId: execution.fileId || '',
    clientId: execution.clientId || '',
    sliceId: slice.id,
    entitlementType: slice.entitlementType,
    previousJudgmentId: impact.rows[0]?.previousJudgmentId || '',
    newJudgmentId: slice.judgmentId,
    status: 'PENDING_REVIEW',
    totals: impact.totals,
    affectedPeriods: impact.rows.length,
    range: impact.range,
    note: String(note || '').trim(),
    createdBy: office.ctx?.profile?.id || 'user',
    createdAt: now,
    updatedAt: now,
    version: 1,
    isDeleted: false
  };
  const differences = impact.rows.map(row => ({
    id: uid(),
    executionId,
    settlementId,
    fileId: execution.fileId || '',
    clientId: execution.clientId || '',
    periodKey: row.periodKey,
    entitlementType: row.entitlementType,
    periodStart: row.start,
    periodEnd: row.end,
    previousJudgmentId: row.previousJudgmentId,
    newJudgmentId: row.newJudgmentId,
    previousSliceId: row.previousSliceId,
    newSliceId: row.newSliceId,
    oldValue: round2(row.oldValue),
    newValue: round2(row.newValue),
    previouslyCollected: round2(row.collected),
    originalOutstanding: round2(row.originalOutstanding),
    differenceAmount: round2(row.difference),
    remainingAfter: round2(row.remaining),
    equation: row.equation,
    executedEarlier: Boolean(row.executedEarlier),
    status: 'PENDING_REVIEW',
    postedLedgerId: '',
    createdAt: now,
    createdBy: office.ctx?.profile?.id || 'user',
    updatedAt: now,
    version: 1,
    isDeleted: false
  }));
  await transaction(office.ctx, [STORE.executionSettlements, STORE.differenceRecords, STORE.activityLog], async tx => {
    await request(tx.objectStore(STORE.executionSettlements).put(settlement));
    const store = tx.objectStore(STORE.differenceRecords);
    for (const row of differences) await request(store.put(row));
    await request(tx.objectStore(STORE.activityLog).add(logRow(office, STORE.executionSettlements, settlementId, 'create',
      `تسوية فروق: ${differences.length} فترة متأثرة بحكم لاحق — إجمالي الفرق ${round2(impact.totals.difference)} (تنتظر المراجعة)`, {fileId: settlement.fileId})));
  });
  events.emit('entity:changed', {entityType: STORE.executionSettlements, id: settlementId});
  return {settlement, differences, impact, reused: false};
}

/** بصمة أساس المراجعة للتسوية القديمة: الفرق المعروض + المحصل الحالي لكل فترة (حماية التزامن §33). */
function legacyReviewBase(differences, collectedByPeriod) {
  return JSON.stringify(differences.filter(row => IN_REVIEW_DIFFERENCE_STATUSES.includes(row.status))
    .slice().sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .map(row => [row.id, round2(num(row.differenceAmount)), collectedByPeriod.get(row.periodKey) || 0]));
}

async function legacyCollectedByPeriod(office, executionId) {
  const map = new Map();
  for (const allocation of await executionAllocations(office, executionId)) {
    if (allocation.isDeleted || allocation.isActive === false) continue;
    map.set(allocation.periodKey, round2((map.get(allocation.periodKey) || 0) + num(allocation.amount)));
  }
  return map;
}

/** فتح المراجعة يثبّت حالة «مُراجَعة» وأساس المقارنة؛ لا يغيّر أي مبلغ. */
async function stampLegacyReview(office, settlement, differences, collectedByPeriod) {
  if (!['DRAFT', 'PENDING_REVIEW'].includes(settlement.status)) return settlement;
  const expectedBase = legacyReviewBase(differences, collectedByPeriod);
  if (settlement.reviewedAt && settlement.expectedBase === expectedBase) return settlement;
  const now = Clock.now();
  const next = {...settlement, reviewedAt: now, expectedBase, updatedAt: now, version: (settlement.version || 0) + 1};
  await transaction(office.ctx, [STORE.executionSettlements, STORE.activityLog], async tx => {
    await request(tx.objectStore(STORE.executionSettlements).put(next));
    await request(tx.objectStore(STORE.activityLog).add(logRow(office, STORE.executionSettlements, settlement.id, 'review',
      'مراجعة تسوية فروق: ثُبّت أساس المقارنة قبل القرار', {fileId: settlement.fileId})));
  });
  return next;
}

/** صفوف التسوية للمراجعة، مع إعادة قراءة المحصل الحالي لكل فترة. */
export async function settlementReview(office, settlementId) {
  const settlement = await office.r.executionSettlements.get(settlementId);
  if (!settlement || settlement.isDeleted) throw new AppError(ERR.NOT_FOUND, 'التسوية غير موجودة.');
  if (settlement.accountingModel === FEAS_MODEL) return ['PENDING_REVIEW', 'REVIEWED'].includes(settlement.status) ? reviewExecutionSettlement(office, settlementId) : readExecutionSettlement(office, settlementId);
  const differences = await office.r.differenceRecords.byIndex('settlementId', settlementId, 5000);
  const allocations = await executionAllocations(office, settlement.executionId);
  const collectedByPeriod = new Map();
  for (const allocation of allocations) {
    if (allocation.isDeleted || allocation.isActive === false) continue;
    collectedByPeriod.set(allocation.periodKey, round2((collectedByPeriod.get(allocation.periodKey) || 0) + num(allocation.amount)));
  }
  const reviewed = await stampLegacyReview(office, settlement, differences, collectedByPeriod);
  return {
    settlement: reviewed,
    rows: differences.slice().sort((a, b) => String(a.periodKey).localeCompare(String(b.periodKey))).map(row => {
      const collected = collectedByPeriod.get(row.periodKey) || 0;
      return {
        ...row,
        currentCollected: collected,
        currentRemaining: round2(Math.max(0, num(row.newValue) - collected)),
        currentOriginalOutstanding: round2(Math.max(0, num(row.oldValue) - collected))
      };
    })
  };
}

/** قرار المستخدم على التسوية: اعتماد أو رفض (كلاهما مسجّل بسبب ووقت). */
export async function decideSettlement(office, settlementId, {decision, reason = '', rowIds = null} = {}) {
  const settlement = await office.r.executionSettlements.get(settlementId);
  if (!settlement || settlement.isDeleted) throw new AppError(ERR.NOT_FOUND, 'التسوية غير موجودة.');
  if (settlement.status === 'POSTED') throw new AppError(ERR.CONFLICT, 'هذه التسوية مُرحَّلة بالفعل ولا يمكن تغيير قرارها. استخدم إجراءً موثقًا.');
  if (!['approve', 'reject'].includes(decision)) throw new AppError(ERR.VALIDATION, 'قرار التسوية غير معروف.');
  if (settlement.accountingModel === FEAS_MODEL) {
    if (rowIds?.length) throw new AppError(ERR.VALIDATION, 'تسوية FEAS تُعتمد على أساسها الكامل بعد المراجعة؛ لا يُدعم اعتماد صفوف جزئية.');
    return decideExecutionSettlement(office, settlementId, {decision, reason});
  }
  const all = await office.r.differenceRecords.byIndex('settlementId', settlementId, 5000);
  if (decision === 'approve') {
    // §32/§33: لا اعتماد بلا مراجعة، ولا اعتماد على أساس تغيّر بعد المراجعة (REJECT_RECALCULATE).
    if (!settlement.reviewedAt || !settlement.expectedBase) throw new AppError(ERR.CONFLICT, 'افتح مراجعة التسوية قبل اعتمادها؛ لا يجوز الانتقال من المسودة إلى الاعتماد مباشرة.');
    const currentBase = legacyReviewBase(all, await legacyCollectedByPeriod(office, settlement.executionId));
    if (currentBase !== settlement.expectedBase) throw new AppError(ERR.CONFLICT, 'تغيّر المحصل أو الفروق بعد المراجعة؛ أعد المراجعة قبل الاعتماد.');
  }
  const selected = rowIds ? all.filter(row => rowIds.includes(row.id)) : all;
  if (!selected.length) throw new AppError(ERR.VALIDATION, 'لا توجد صفوف لتطبيق القرار عليها.');
  const now = Clock.now();
  const nextStatus = decision === 'approve' ? 'APPROVED' : 'CANCELLED';
  await transaction(office.ctx, [STORE.differenceRecords, STORE.executionSettlements, STORE.activityLog], async tx => {
    const store = tx.objectStore(STORE.differenceRecords);
    for (const row of selected) await request(store.put({...row, status: nextStatus, decisionReason: String(reason || '').trim(), decidedAt: now, updatedAt: now, version: (row.version || 0) + 1}));
    const remaining = all.filter(row => !selected.includes(row));
    const allDecided = remaining.every(row => ACTIVE_DIFFERENCE_STATUSES.includes(row.status) || row.status === 'CANCELLED');
    await request(tx.objectStore(STORE.executionSettlements).put({
      ...settlement, status: allDecided ? (decision === 'approve' ? 'APPROVED' : 'CANCELLED') : settlement.status,
      decisionReason: String(reason || '').trim(), decidedAt: now, updatedAt: now, version: (settlement.version || 0) + 1
    }));
    await request(tx.objectStore(STORE.activityLog).add(logRow(office, STORE.executionSettlements, settlementId, decision === 'approve' ? 'approve' : 'reject',
      `${decision === 'approve' ? 'اعتماد' : 'رفض'} تسوية فروق (${selected.length} فترة، إجمالي ${round2(selected.reduce((sum, row) => sum + num(row.differenceAmount), 0))})${reason ? ' — ' + reason : ''}`,
      {fileId: settlement.fileId})));
  });
  events.emit('entity:changed', {entityType: STORE.executionSettlements, id: settlementId});
  return settlementReview(office, settlementId);
}

/**
 * ترحيل التسوية المعتمدة: يسجّل الالتزام المعتمد لكل فرق موجب كحركة DIFFERENCE_DUE
 * مرتبطة بسجل الفرق والحكم المصدر، ويعلّم الصفوف POSTED. فروق التخفيض تُعلَّم
 * مُرحَّلة بلا التزام مالي لأنها تخفيض في الاستحقاق لا دين جديد.
 */
export async function postSettlement(office, settlementId) {
  const settlement = await office.r.executionSettlements.get(settlementId);
  if (!settlement || settlement.isDeleted) throw new AppError(ERR.NOT_FOUND, 'التسوية غير موجودة.');
  if (settlement.accountingModel === FEAS_MODEL) {
    const result = await postExecutionSettlement(office, settlementId);
    return {posted: result.rows, rows: await settlementReview(office, settlementId)};
  }
  if (settlement.status !== 'APPROVED') throw new AppError(ERR.CONFLICT, 'لا يمكن ترحيل تسوية قبل اعتمادها من المستخدم.');
  const rows = (await office.r.differenceRecords.byIndex('settlementId', settlementId, 5000)).filter(row => row.status === 'APPROVED');
  if (!rows.length) throw new AppError(ERR.VALIDATION, 'لا توجد فروق معتمدة قابلة للترحيل.');
  const now = Clock.now();
  const posted = [];
  await transaction(office.ctx, [STORE.differenceRecords, STORE.executionLedger, STORE.executionSettlements, STORE.activityLog], async tx => {
    const ledger = tx.objectStore(STORE.executionLedger);
    const differenceStore = tx.objectStore(STORE.differenceRecords);
    for (const row of rows) {
      if (num(row.differenceAmount) <= 0.001) {
        await request(differenceStore.put({...row, status: 'POSTED', postedAt: now, postedLedgerId: '', postedAs: 'reduction', updatedAt: now, version: (row.version || 0) + 1}));
        continue;
      }
      const entry = {
        id: uid(), executionId: row.executionId, fileId: row.fileId || '', clientId: row.clientId || '',
        type: 'DIFFERENCE_DUE', category: 'obligation', amount: round2(num(row.differenceAmount)), currency: 'جنيه',
        date: localDate(), receiptId: '', differenceRecordId: row.id, poaId: '', judgmentId: row.newJudgmentId || '', periodKey: row.periodKey,
        documentReferenceId: '', paymentMethod: '', includeInPoa: false, sourceType: 'difference', sourceId: row.id,
        adjustsLedgerId: '', adjustDirection: '', reason: 'ترحيل فرق استحقاق معتمد من تسوية',
        notes: `القديم ${row.oldValue} → الجديد ${row.newValue} — المحصل سابقًا ${row.previouslyCollected}`,
        createdBy: office.ctx?.profile?.id || 'user', createdAt: now, updatedAt: now, version: 1, isDeleted: false
      };
      posted.push(entry);
      await request(ledger.put(entry));
      await request(differenceStore.put({...row, status: 'POSTED', postedAt: now, postedLedgerId: entry.id, postedAs: 'obligation', updatedAt: now, version: (row.version || 0) + 1}));
    }
    await request(tx.objectStore(STORE.executionSettlements).put({...settlement, status: 'POSTED', postedAt: now, updatedAt: now, version: (settlement.version || 0) + 1}));
    await request(tx.objectStore(STORE.activityLog).add(logRow(office, STORE.executionSettlements, settlementId, 'post',
      `ترحيل تسوية فروق: ${posted.length} التزامًا معتمدًا بإجمالي ${round2(posted.reduce((sum, row) => sum + row.amount, 0))}`, {fileId: settlement.fileId})));
  });
  events.emit('entity:changed', {entityType: STORE.executionSettlements, id: settlementId});
  return {posted, rows: await settlementReview(office, settlementId)};
}

/** تحديث مسودة تسوية بعد تغيّر التحصيلات (قبل الاعتماد فقط) — الصفوف القديمة تُلغى لا تُحذف. */
export async function recomputeSettlement(office, settlementId) {
  const settlement = await office.r.executionSettlements.get(settlementId);
  if (!settlement || settlement.isDeleted) throw new AppError(ERR.NOT_FOUND, 'التسوية غير موجودة.');
  if (settlement.accountingModel === FEAS_MODEL) return recomputeExecutionSettlement(office, settlementId);
  if (!IN_REVIEW_DIFFERENCE_STATUSES.includes(settlement.status)) throw new AppError(ERR.CONFLICT, 'لا يمكن إعادة حساب تسوية بعد اعتمادها أو رفضها.');
  const {slice, impact} = await previewImpact(office, {executionId: settlement.executionId, sliceId: settlement.sliceId});
  const previous = await office.r.differenceRecords.byIndexAll('settlementId', settlementId);
  const now = Clock.now();
  const rows = impact.rows.map(row => ({
    id: uid(), executionId: settlement.executionId, settlementId, fileId: settlement.fileId || '', clientId: settlement.clientId || '',
    periodKey: row.periodKey, entitlementType: row.entitlementType, periodStart: row.start, periodEnd: row.end,
    previousJudgmentId: row.previousJudgmentId, newJudgmentId: row.newJudgmentId, previousSliceId: row.previousSliceId, newSliceId: row.newSliceId,
    oldValue: round2(row.oldValue), newValue: round2(row.newValue), previouslyCollected: round2(row.collected),
    originalOutstanding: round2(row.originalOutstanding), differenceAmount: round2(row.difference), remainingAfter: round2(row.remaining),
    equation: row.equation, executedEarlier: Boolean(row.executedEarlier), status: 'PENDING_REVIEW', postedLedgerId: '',
    createdAt: now, createdBy: office.ctx?.profile?.id || 'user', updatedAt: now, version: 1, isDeleted: false
  }));
  await transaction(office.ctx, [STORE.differenceRecords, STORE.executionSettlements, STORE.activityLog], async tx => {
    const store = tx.objectStore(STORE.differenceRecords);
    for (const row of previous) if (IN_REVIEW_DIFFERENCE_STATUSES.includes(row.status)) await request(store.put({...row, status: 'CANCELLED', supersededBy: settlementId, updatedAt: now, version: (row.version || 0) + 1}));
    for (const row of rows) await request(store.put(row));
    await request(tx.objectStore(STORE.executionSettlements).put({...settlement, totals: impact.totals, affectedPeriods: rows.length, range: impact.range, updatedAt: now, version: (settlement.version || 0) + 1}));
    await request(tx.objectStore(STORE.activityLog).add(logRow(office, STORE.executionSettlements, settlementId, 'update', `إعادة حساب تسوية الفروق (${rows.length} فترة) — الصفوف السابقة محفوظة بحالة ملغاة`, {fileId: settlement.fileId})));
  });
  return settlementReview(office, settlementId);
}

/** فروق غير مسددة (معتمدة/مرحّلة) وفروق تنتظر المراجعة — لمؤشرات المركز. */
export async function differencesSummary(office, executionId) {
  const rows = await executionDifferences(office, executionId);
  const sum = list => round2(list.reduce((total, row) => total + num(row.differenceAmount), 0));
  const pending = rows.filter(row => IN_REVIEW_DIFFERENCE_STATUSES.includes(row.status));
  const approved = rows.filter(row => row.status === 'APPROVED');
  const posted = rows.filter(row => row.status === 'POSTED');
  return {
    rows, pending, approved, posted,
    pendingAmount: sum(pending), approvedAmount: sum(approved), postedAmount: sum(posted),
    label: rows.length ? `${differenceStatusLabel(rows[0].status)} — ${money(sum(rows))}` : ''
  };
}

export {netLedger};
