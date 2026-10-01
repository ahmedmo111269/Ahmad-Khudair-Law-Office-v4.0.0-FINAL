// =====================================================================
// ترحيل بيانات التنفيذ القديمة — غير مدمر، Idempotent، ولا يخترع بيانات
// ---------------------------------------------------------------------
// ما تفعله هذه الهجرة:
//  1) تضمن وجود الحقول الإضافية على سجلات التنفيذ القديمة (مخزن execution نفسه،
//     نفس المعرّفات ونفس العلاقات).
//  2) تكمل fileId من المرحلة القضائية إن كانت المرحلة معروفة (حقيقة موجودة في
//     البيانات نفسها، لا استنتاج خارجي).
//  3) تضع علامة «يحتاج مراجعة» مع أسباب واضحة عند نقص بيانات لا يصح تخمينها
//     (نوع التنفيذ، الرقم الرسمي، الحكم، القيمة، التواريخ).
//  4) لا تنشئ أحكامًا ولا شرائح قيمة ولا حركات مالية ولا تُغيّر أي تاريخ مالي.
// =====================================================================
import {STORE} from '../db/schema.js';
import {Clock} from '../core/clock.js';
import {transaction, request} from '../db/unit-of-work.js';
import {normalizeArabic} from '../core/search-normalizer.js';
import {isIsoDate, EXECUTION_REVIEW_REASONS, EXECUTION_TYPE_LABELS} from '../domain/execution.js';

export const EXECUTION_MIGRATION_ID = 'execution-migration-v1';
export const EXECUTION_MIGRATION_VERSION = 1;

async function readBatch(office, afterId, limit) {
  office.ctx.assert();
  const tx = office.ctx.db.transaction(STORE.execution, 'readonly');
  const store = tx.objectStore(STORE.execution);
  const range = afterId ? IDBKeyRange.lowerBound(afterId, true) : undefined;
  return new Promise((resolve, reject) => {
    const rows = [];
    const cursor = store.openCursor(range, 'next');
    cursor.onerror = () => reject(cursor.error);
    cursor.onsuccess = () => {
      const current = cursor.result;
      if (!current || rows.length >= limit) { resolve(rows); return; }
      rows.push(current.value);
      current.continue();
    };
  });
}

/** مسح واحد للسجلات القديمة يضيف الحقول الناقصة فقط. */
export async function migrateExecutionData(office, {batchSize = 200} = {}) {
  const marker = (await office.r.meta.get(EXECUTION_MIGRATION_ID)) || {id: EXECUTION_MIGRATION_ID, key: EXECUTION_MIGRATION_ID};
  const report = {scanned: 0, updated: 0, flagged: 0, complete: Boolean(marker.complete), alreadyComplete: Boolean(marker.complete)};
  if (marker.complete) return report;
  let cursor = marker.cursor || null;
  let touched = 0;
  while (true) {
    const batch = await readBatch(office, cursor, Math.max(25, Math.min(batchSize, 500)));
    if (!batch.length) {
      marker.complete = true;
      marker.cursor = null;
      marker.updatedAt = Clock.now();
      await office.r.meta.put(marker);
      report.complete = true;
      break;
    }
    const changed = [];
    for (const row of batch) {
      report.scanned += 1;
      const reasons = [];
      const next = {...row};
      if (!EXECUTION_TYPE_LABELS[next.executionType]) reasons.push('missing_execution_type');
      if (!next.authority && !next.executionOffice) reasons.push('missing_authority');
      if (!next.officialNumber && !next.executionNumber) reasons.push('missing_official_number');
      if (!next.judgmentDate && !next.bondDate) reasons.push('missing_judgment');
      if (!next.clientId) reasons.push('legacy_record');
      // إكمال رابط الملف من المرحلة القضائية إن كان الرابط ناقصًا فقط
      if (!next.fileId && next.caseId) {
        const stage = await office.r.cases.get(next.caseId);
        if (stage?.fileId) next.fileId = stage.fileId;
      }
      if (!next.internalNumber) next.internalNumber = next.executionNumber ? String(next.executionNumber) : '';
      if (next.officialNumber === undefined) next.officialNumber = next.executionNumber ? String(next.executionNumber) : '';
      if (next.entitlementThroughDate === undefined) next.entitlementThroughDate = '';
      if (next.prorationPolicy === undefined) next.prorationPolicy = 'days';
      if (next.clientId === undefined) next.clientId = '';
      if (next.executionMethod === undefined) next.executionMethod = '';
      if (next.nextReviewDate === undefined) next.nextReviewDate = '';
      if (next.notesNormalized === undefined) next.notesNormalized = normalizeArabic(String(next.notes || ''));
      // نص بحث مشتق من حقول السجل نفسه (لا يُخترع أي رقم أو تاريخ غير موجود)
      if (!next.searchTextNormalized) {
        next.searchTextNormalized = normalizeArabic([
          next.internalNumber, next.officialNumber, next.executionNumber, next.authority, next.executionOffice,
          EXECUTION_TYPE_LABELS[next.executionType] || '', next.notes
        ].filter(Boolean).join(' '));
      }
      const reviewReasons = reasons.filter(reason => reason !== 'legacy_record');
      if (reviewReasons.length) {
        next.needsReview = true;
        next.reviewReasons = [...new Set([...(next.reviewReasons || []), ...reviewReasons])];
        report.flagged += 1;
      }
      const changedFields = Object.keys(next).filter(key => JSON.stringify(next[key]) !== JSON.stringify(row[key]));
      if (changedFields.length) {
        next.updatedAt = row.updatedAt || Clock.now();
        next.executionMigrationAt = Clock.now();
        next.executionMigrationVersion = EXECUTION_MIGRATION_VERSION;
        changed.push(next);
      }
    }
    if (changed.length) {
      await transaction(office.ctx, [STORE.execution], async tx => {
        const store = tx.objectStore(STORE.execution);
        for (const row of changed) await request(store.put(row));
      });
      report.updated += changed.length;
    }
    cursor = batch.at(-1).id;
    marker.cursor = cursor;
    marker.updatedAt = Clock.now();
    marker.scanned = (marker.scanned || 0) + batch.length;
    marker.updated = (marker.updated || 0) + changed.length;
    await office.r.meta.put(marker);
    touched += batch.length;
    if (batch.length < Math.max(25, Math.min(batchSize, 500))) {
      marker.complete = true;
      marker.cursor = null;
      marker.updatedAt = Clock.now();
      await office.r.meta.put(marker);
      report.complete = true;
      break;
    }
    if (touched > 20000) break; // حد أمان لكل تشغيل؛ تُستأنف من cursor في التشغيل التالي
  }
  return report;
}

/** أسباب المراجعة كعبارات عربية للعرض. */
export const reviewReasonLabels = reasons => (reasons || []).map(reason => EXECUTION_REVIEW_REASONS[reason] || reason);

/** فحص قراءة فقط: ما الذي سيحتاج مراجعة في البيانات الحالية (بلا كتابة). */
export async function executionReviewReport(office, {limit = 500} = {}) {
  const rows = [];
  let cursor = null;
  while (rows.length < limit) {
    const page = await office.r.execution.page({limit: Math.min(100, limit - rows.length), cursor, index: 'openedDate', direction: 'prev'});
    for (const execution of page.items) {
      const reasons = [];
      if (!EXECUTION_TYPE_LABELS[execution.executionType]) reasons.push('missing_execution_type');
      if (!execution.authority && !execution.executionOffice) reasons.push('missing_authority');
      if (!execution.officialNumber && !execution.executionNumber) reasons.push('missing_official_number');
      const slices = await office.r.executionValuePeriods.byIndexAll('executionId', execution.id).catch(() => []);
      if (!slices.filter(slice => !slice.isDeleted && slice.status !== 'cancelled').length) reasons.push('missing_value');
      const judgments = await office.r.judgments.byIndexAll('executionId', execution.id).catch(() => []);
      if (!judgments.length) reasons.push('missing_judgment');
      if (reasons.length) rows.push({execution, reasons, reasonLabels: reviewReasonLabels(reasons)});
    }
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return rows;
}

export {isIsoDate};
