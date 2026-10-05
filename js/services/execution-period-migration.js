// Idempotent v2 calendar migration. It adds stable period identity metadata and
// relinks only allocations with one unambiguous temporal overlap. Receipts,
// recognized snapshots, previously issued POAs, and ledger rows are read-only.
import {STORE} from '../db/schema.js';
import {Clock} from '../core/clock.js';
import {uid} from '../core/id.js';
import {transaction, request} from '../db/unit-of-work.js';
import {addCivilDays, daysInCivilMonth, enumerateExecutionUnits, isCivilDate, parseCivilDate} from '../domain/execution-period-calendar.js';
import {executionSettings} from './execution-settings.js';

export const EXECUTION_PERIOD_MIGRATION_ID = 'execution-period-calendar-v2';
export const EXECUTION_PERIOD_MIGRATION_VERSION = 2;
const MAX_ROWS = 4999; // Repository.byIndex is capped at 5,000; reserve one row to detect overflow.
const ACTIVE = row => row && !row.isDeleted && !['cancelled', 'superseded', 'needs_review', 'voided'].includes(String(row.status || '').toLowerCase());
const compareSlice = (a, b) => String(a.startDate || '').localeCompare(String(b.startDate || ''))
  || Number(a.sequence || 0) - Number(b.sequence || 0)
  || String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
  || String(a.id || '').localeCompare(String(b.id || ''));
const stablePeriodKey = (itemId, anchorDate, k) => `${encodeURIComponent(itemId)}::${anchorDate}::${k}`;

function oldPeriodBounds(start, frequency, customDays) {
  if (!isCivilDate(start)) return null;
  const {year, month, day} = parseCivilDate(start);
  const monthStart = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`;
  const monthEnd = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(daysInCivilMonth(year, month)).padStart(2, '0')}`;
  switch (String(frequency || 'monthly')) {
    case 'daily': return {from: start, to: start};
    case 'weekly': return {from: start, to: addCivilDays(start, 6)};
    case 'semiMonthly': return day <= 15
      ? {from: monthStart, to: `${monthStart.slice(0, 8)}15`}
      : {from: `${monthStart.slice(0, 8)}16`, to: monthEnd};
    case 'monthly': return {from: monthStart, to: monthEnd};
    case 'yearly': return {from: start, to: `${String(year).padStart(4, '0')}-12-31`};
    case 'custom': {
      const step = Number(customDays);
      if (!Number.isSafeInteger(step) || step < 1 || step > 36500) return null;
      return {from: start, to: addCivilDays(start, step - 1)};
    }
    default: return null;
  }
}

function groupsFor(executionId, slices) {
  const groups = new Map();
  for (const slice of slices.filter(ACTIVE).sort(compareSlice)) {
    const type = String(slice.entitlementType || '').trim();
    if (!type || !isCivilDate(slice.startDate)) continue;
    const itemId = String(slice.itemId || `${executionId}::${type}`);
    const groupKey = `${itemId}::${String(slice.valueType || 'periodic') === 'fixed' ? 'fixed' : 'periodic'}`;
    if (!groups.has(groupKey)) groups.set(groupKey, {itemId, entitlementType: type, slices: []});
    groups.get(groupKey).slices.push(slice);
  }
  for (const group of groups.values()) {
    group.slices.sort(compareSlice);
    group.anchorDate = group.slices.find(row => isCivilDate(row.anchorDate))?.anchorDate
      || group.slices.find(row => isCivilDate(row.anchor))?.anchor
      || group.slices[0]?.startDate;
    group.periodicity = group.slices[0]?.periodicity || 'monthly';
    group.customDays = Number(group.slices[0]?.customDays) || null;
  }
  return [...groups.values()];
}

async function pageAllExecutions(office, maxExecutions) {
  const rows = [];
  let cursor = null;
  do {
    const page = await office.r.execution.page({index: 'openedDate', direction: 'next', cursor, limit: 100});
    rows.push(...(page.items || []).filter(row => !row.isDeleted));
    cursor = page.nextCursor || null;
    if (!page.hasMore || rows.length >= maxExecutions) break;
  } while (cursor);
  return rows.slice(0, maxExecutions);
}

/** Add immutable anchor/item metadata and relink only uniquely mapped legacy allocations. */
export async function migrateExecutionPeriodV2(office, {maxExecutions = 2500} = {}) {
  office.ctx.assert();
  const marker = await office.r.meta.get(EXECUTION_PERIOD_MIGRATION_ID).catch(() => null);
  if (marker?.version === EXECUTION_PERIOD_MIGRATION_VERSION && marker.completedAt) return {...marker, reused: true};
  const executions = await pageAllExecutions(office, Math.max(1, Math.min(Number(maxExecutions) || 2500, 10000)));
  const settings = executionSettings(office).schedule;
  const stamp = Clock.now();
  const actorId = office.ctx?.profile?.id || 'user';
  const before = {executions: executions.length, slices: 0, allocations: 0, receipts: 0, recognizedSnapshots: 0, poas: 0};
  const after = {...before};
  const executionReports = [];
  const conflictRows = [];
  let taggedSlices = 0, reboundAllocations = 0;

  for (const execution of executions) {
    const [slicesRaw, allocationsRaw, receipts, snapshots, poas] = await Promise.all([
      office.r.executionValuePeriods.byIndex('executionId', execution.id, MAX_ROWS + 1).catch(() => []),
      office.r.executionAllocations.byIndex('executionId', execution.id, MAX_ROWS + 1).catch(() => []),
      office.r.executionReceipts.byIndex('executionId', execution.id, MAX_ROWS + 1).catch(() => []),
      office.r.executionPeriods.byIndex('executionId', execution.id, MAX_ROWS + 1).catch(() => []),
      office.r.executionPOAs.byIndex('executionId', execution.id, MAX_ROWS + 1).catch(() => [])
    ]);
    if ([slicesRaw, allocationsRaw].some(rows => rows.length > MAX_ROWS)) {
      executionReports.push({executionId: execution.id, skipped: true, reason: 'حد القراءة الآمن؛ لم تُنفذ إعادة ربط جزئية.', before: {slices: slicesRaw.length, allocations: allocationsRaw.length}});
      continue;
    }
    const slices = slicesRaw.filter(row => !row.isDeleted);
    const allocations = allocationsRaw.filter(row => !row.isDeleted);
    before.slices += slices.length; before.allocations += allocations.length;
    before.receipts += receipts.filter(row => !row.isDeleted).length;
    before.recognizedSnapshots += snapshots.filter(row => !row.isDeleted && ['RECOGNIZED', 'CLOSED'].includes(row.status)).length;
    before.poas += poas.filter(row => !row.isDeleted).length;

    const groups = groupsFor(execution.id, slices);
    const groupByType = new Map();
    for (const group of groups) {
      const list = groupByType.get(group.entitlementType) || [];
      list.push(group); groupByType.set(group.entitlementType, list);
    }
    const engineRow = Number(execution.engineVersion || 0) < Number(settings.engineVersion || 2)
      ? {...execution, previousEngineVersion: execution.engineVersion || 1, engineVersion: settings.engineVersion || 2, engineVersionMigratedAt: stamp, engineVersionMigrationId: EXECUTION_PERIOD_MIGRATION_ID}
      : null;
    const updatedSlices = [];
    for (const group of groups) {
      for (const slice of group.slices) {
        const next = {...slice};
        let changed = false;
        if (!next.itemId) { next.itemId = group.itemId; changed = true; }
        if (!isCivilDate(next.anchorDate)) { next.anchorDate = group.anchorDate; changed = true; }
        // Keep the original legacy anchor untouched; anchorDate is the v2 explicit field.
        if (changed) { next.periodCalendarVersion = 2; next.periodCalendarMigratedAt = stamp; updatedSlices.push(next); taggedSlices += 1; }
      }
    }

    const allocationUpdates = [];
    for (const allocation of allocations) {
      const oldKey = String(allocation.periodKey || '');
      if (!oldKey || oldKey.startsWith('feas::')) continue;
      if (groups.some(group => oldKey.startsWith(`${encodeURIComponent(group.itemId)}::${group.anchorDate}::`))) continue;
      const separator = oldKey.lastIndexOf('::');
      const legacyStart = separator >= 0 ? oldKey.slice(separator + 2) : '';
      const legacyType = separator >= 0 ? oldKey.slice(0, separator) : '';
      const bounds = oldPeriodBounds(legacyStart, (groupByType.get(legacyType) || [])[0]?.periodicity, (groupByType.get(legacyType) || [])[0]?.customDays);
      const candidates = [];
      if (bounds) {
        for (const group of groupByType.get(legacyType) || []) {
          const walk = enumerateExecutionUnits({
            fromDate: bounds.from, toDate: bounds.to, frequency: group.periodicity,
            anchorDate: group.anchorDate, customDays: group.customDays,
            periodBasis: settings.periodBasis, monthEndPolicy: settings.monthEndPolicy, maxUnits: 32
          });
          for (const unit of walk.units) {
            if (unit.k < 0 || unit.start > bounds.to || bounds.from > unit.end) continue;
            candidates.push({group, unit});
          }
        }
      }
      if (candidates.length === 1) {
        const {group, unit} = candidates[0];
        const nextKey = stablePeriodKey(group.itemId, group.anchorDate, unit.k);
        allocationUpdates.push({...allocation, periodKey: nextKey,
          periodMigration: {version: EXECUTION_PERIOD_MIGRATION_VERSION, fromKey: oldKey, toKey: nextKey, migratedAt: stamp, reason: 'تداخل زمني وحيد مع فترة الارتكاز الجديدة'}});
        reboundAllocations += 1;
      } else {
        const conflictId = `${EXECUTION_PERIOD_MIGRATION_ID}::${encodeURIComponent(execution.id)}::${encodeURIComponent(allocation.id)}`;
        const conflict = {
          id: conflictId, key: conflictId, kind: 'execution-period-allocation', status: 'OPEN',
          executionId: execution.id, allocationId: allocation.id, oldPeriodKey: oldKey,
          legacyRange: bounds || null,
          candidatePeriodKeys: candidates.map(({group, unit}) => stablePeriodKey(group.itemId, group.anchorDate, unit.k)),
          reason: candidates.length ? 'أكثر من فترة جديدة تتداخل زمنيًا مع مفتاح التخصيص القديم.' : 'تعذر العثور على فترة واحدة مطابقة لمفتاح التخصيص القديم.',
          createdAt: stamp, createdBy: actorId
        };
        conflictRows.push(conflict);
      }
    }

    if (updatedSlices.length || allocationUpdates.length || engineRow) {
      await transaction(office.ctx, [STORE.execution, STORE.executionValuePeriods, STORE.executionAllocations], async tx => {
        if (engineRow) await request(tx.objectStore(STORE.execution).put(engineRow));
        const slicesStore = tx.objectStore(STORE.executionValuePeriods);
        const allocationsStore = tx.objectStore(STORE.executionAllocations);
        for (const row of updatedSlices) await request(slicesStore.put(row));
        for (const row of allocationUpdates) await request(allocationsStore.put(row));
      });
    }
    for (const conflict of conflictRows.filter(row => row.executionId === execution.id)) {
      const existing = await office.r.meta.get(conflict.id).catch(() => null);
      if (!existing) await office.r.meta.put(conflict);
    }
    after.slices += slices.length; after.allocations += allocations.length;
    after.receipts += receipts.filter(row => !row.isDeleted).length;
    after.recognizedSnapshots += snapshots.filter(row => !row.isDeleted && ['RECOGNIZED', 'CLOSED'].includes(row.status)).length;
    after.poas += poas.filter(row => !row.isDeleted).length;
    executionReports.push({executionId: execution.id, before: {slices: slices.length, allocations: allocations.length}, after: {slices: slices.length, allocations: allocations.length}, taggedSlices: updatedSlices.length, reboundAllocations: allocationUpdates.length});
  }

  const conflictIds = conflictRows.map(row => row.id);
  const report = {
    id: EXECUTION_PERIOD_MIGRATION_ID, key: EXECUTION_PERIOD_MIGRATION_ID,
    version: EXECUTION_PERIOD_MIGRATION_VERSION, engineVersion: settings.engineVersion || 2,
    completedAt: Clock.now(), actorId, source: 'ترقية تقويم التنفيذ v2 — تثبيت الارتكاز وربط التخصيصات ذات التداخل الزمني الوحيد',
    before, after, taggedSlices, reboundAllocations, conflicts: conflictIds.length, conflictIds,
    historicalImmutable: {receipts: before.receipts === after.receipts, recognizedSnapshots: before.recognizedSnapshots === after.recognizedSnapshots, poas: before.poas === after.poas},
    executions: executionReports, reused: false
  };
  await office.r.meta.put(report);
  await transaction(office.ctx, [STORE.activityLog], async tx => {
    await request(tx.objectStore(STORE.activityLog).add({
      id: uid(), entityType: 'executionPeriodMigration', entityId: EXECUTION_PERIOD_MIGRATION_ID,
      action: 'migration', timestamp: report.completedAt,
      summary: `ترحيل تقويم التنفيذ v2: تثبيت ${taggedSlices} ارتكازًا، إعادة ربط ${reboundAllocations} تخصيصًا، وتعليق ${conflictIds.length} حالة للمراجعة.`,
      actorId, metadata: {version: report.version, engineVersion: report.engineVersion, before, after, conflictIds},
      ...(office.ctx?.profile?.id ? {profileId: office.ctx.profile.id} : {})
    }));
  });
  return report;
}

export async function executionPeriodMigrationReport(office) {
  const report = await office.r.meta.get(EXECUTION_PERIOD_MIGRATION_ID).catch(() => null);
  if (!report) return null;
  const conflicts = [];
  for (const id of report.conflictIds || []) {
    const row = await office.r.meta.get(id).catch(() => null);
    if (row) conflicts.push(row);
  }
  return {...report, conflicts};
}
