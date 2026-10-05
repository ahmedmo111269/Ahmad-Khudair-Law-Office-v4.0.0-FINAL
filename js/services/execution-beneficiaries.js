// =====================================================================
// متعدد المستحقين — توزيع بند/محضر على أكثر من مستحق
// ---------------------------------------------------------------------
// ⚠️ أثر السكيمة (موثّق بدقة، ولا تغيير صامت):
//   • لا مخزن جديد ولا فهرس جديد ⇒ SCHEMA_VERSION يبقى 18.
//   • الإضافة **حقول على الصف القائم** (IndexedDB لا يفرض شكلًا ثابتًا):
//       executionReceipts.beneficiaries : [{partyId, beneficiaryName, beneficiaryShare, amountMinor}]
//       executionReceipts.beneficiaryName / beneficiaryShare : نسخة مسطّحة للتوافق
//       executionValuePeriods.beneficiaries : نفس الشكل لبند القيمة
//   • السجلات القديمة بلا `beneficiaries` ⇒ تُقرأ كمستحق واحد 100% (المستحق
//     الرئيسي في executionParties). لا يُعاد كتابة أي صف قديم تلقائيًا.
//   • الترحيل `backfillReceiptBeneficiaries` **اختياري وصريح**، يضيف الحقل
//     فقط حيث لا يوجد، ولا يغيّر أي مبلغ ولا أي تخصيص ولا أي محضر.
//   • الشرط الحاسم: مجموع الحصص = مبلغ المحضر بالوحدات الصغرى (لا تقريب صامت).
// =====================================================================
import {uid} from '../core/id.js';
import {Clock} from '../core/clock.js';
import {AppError, ERR} from '../core/errors.js';
import {events} from '../core/events.js';
import {transaction, request} from '../db/unit-of-work.js';
import {STORE} from '../db/schema.js';
import {addMinor, fromMinorUnits, sumMinor, toMinorUnits} from '../domain/execution-money.js';
import {executionCache} from './execution-cache.js';
import {logExecutionDecision} from './execution-simple.js';

export const BENEFICIARY_SCHEMA_NOTE = Object.freeze({
  schemaVersionUnchanged: 18,
  newStores: [],
  newIndexes: [],
  additiveFields: [
    'executionReceipts.beneficiaries',
    'executionReceipts.beneficiaryName',
    'executionReceipts.beneficiaryShare',
    'executionValuePeriods.beneficiaries'
  ],
  legacyRead: 'صف بلا beneficiaries ⇒ مستحق واحد بنسبة 100% (المستحق الرئيسي في executionParties)',
  migration: 'backfillReceiptBeneficiaries — اختياري وصريح، يضيف الحقل حيث لا يوجد ولا يغيّر أي مبلغ'
});

const now = () => Clock.now();
const shareOf = row => {
  const value = Number(row?.beneficiaryShare);
  return Number.isFinite(value) ? value : 0;
};

/** المستحقون المسجلون على التنفيذ (من executionParties) + الموكل كافتراضي. */
export async function beneficiaryOptions(office, executionId) {
  const parties = await office.r.executionParties.byIndex('executionId', executionId, 200).catch(() => []);
  const creditors = parties.filter(party => !party.isDeleted && party.side !== 'debtor');
  const execution = await office.r.execution.get(executionId).catch(() => null);
  const out = creditors.map(party => ({
    partyId: party.id, name: party.name || party.role || 'مستحق', role: party.role || '',
    clientId: party.clientId || '', share: shareOf(party)
  }));
  if (!out.length && execution?.clientId) {
    const client = await office.r.clients.get(execution.clientId).catch(() => null);
    if (client) out.push({partyId: '', name: client.fullName || 'الموكل', role: 'الموكل', clientId: client.id, share: 100});
  }
  return out;
}

/**
 * يبني توزيعًا صحيحًا: مجموع الحصص 100% ومجموع المبالغ = المبلغ الكلي بالضبط.
 * الباقي من التقريب يذهب إلى آخر سطر (قاعدة صريحة، لا توزيع صامت).
 */
export function buildBeneficiarySplit({entries = [], totalMinor = 0, currency = 'EGP'} = {}) {
  const rows = (entries || []).filter(row => row && String(row.beneficiaryName || row.name || '').trim());
  if (!rows.length) throw new AppError(ERR.VALIDATION, 'أضف مستحقًا واحدًا على الأقل.', {beneficiaries: 'مطلوب'});
  if (!Number.isSafeInteger(totalMinor) || totalMinor < 0) throw new AppError(ERR.VALIDATION, 'المبلغ الكلي غير صحيح.', {amount: 'مطلوب'});
  const shares = rows.map(row => {
    const raw = row.beneficiaryShare ?? row.share;
    const value = Number(String(raw ?? '').replace(',', '.'));
    if (!Number.isFinite(value) || value < 0) throw new AppError(ERR.VALIDATION, `نسبة غير صحيحة للمستحق «${row.beneficiaryName || row.name}».`, {beneficiaryShare: 'غير صحيح'});
    return value;
  });
  const shareTotal = shares.reduce((sum, value) => sum + value, 0);
  if (Math.abs(shareTotal - 100) > 0.001) {
    throw new AppError(ERR.VALIDATION, `مجموع النسب ${shareTotal.toFixed(2)}% ويجب أن يكون 100% بالضبط.`, {beneficiaryShare: `${shareTotal}%`});
  }
  let assigned = 0;
  const split = rows.map((row, index) => {
    const isLast = index === rows.length - 1;
    const amountMinor = isLast ? Math.max(0, totalMinor - assigned) : Math.floor((totalMinor * shares[index]) / 100);
    assigned = addMinor(assigned, amountMinor);
    return {
      id: row.id || uid(),
      partyId: row.partyId || '',
      clientId: row.clientId || '',
      beneficiaryName: String(row.beneficiaryName || row.name || '').trim(),
      beneficiaryShare: shares[index],
      amountMinor,
      amount: fromMinorUnits(amountMinor, currency),
      currency
    };
  });
  const sum = sumMinor(split, row => row.amountMinor);
  if (sum !== totalMinor) throw new AppError(ERR.VALIDATION, `مجموع الحصص ${fromMinorUnits(sum, currency)} لا يساوي مبلغ المحضر ${fromMinorUnits(totalMinor, currency)}.`, {amount: 'غير متطابق'});
  return split;
}

/** قراءة توزيع محضر: القديم بلا beneficiaries ⇒ مستحق واحد 100%. */
export function receiptBeneficiaries(receipt, {fallbackName = '', currency = 'EGP'} = {}) {
  const rows = Array.isArray(receipt?.beneficiaries) ? receipt.beneficiaries.filter(Boolean) : [];
  if (rows.length) return rows;
  const name = String(receipt?.beneficiaryName || receipt?.payerName || fallbackName || '').trim();
  const totalMinor = Number.isSafeInteger(receipt?.amountMinor) ? receipt.amountMinor : Math.round(Number(receipt?.amount || 0) * 100);
  if (!name) return [];
  return [{id: receipt?.id || '', partyId: '', beneficiaryName: name, beneficiaryShare: 100, amountMinor: totalMinor, amount: fromMinorUnits(totalMinor, currency), currency}];
}

/** حفظ توزيع محضر قائم (يعدّل الصف نفسه ويسجّل السبب والنسخة السابقة). */
export async function saveReceiptBeneficiaries(office, {receiptId, entries = [], reason = ''} = {}) {
  office.ctx.assert();
  const receipt = await office.r.executionReceipts.get(receiptId);
  if (!receipt || receipt.isDeleted) throw new AppError(ERR.NOT_FOUND, 'محضر التحصيل غير موجود.');
  if (String(receipt.status || '') === 'voided') throw new AppError(ERR.CONFLICT, 'المحضر ملغى؛ لا يُوزَّع.');
  const currency = receipt.currency || 'EGP';
  const totalMinor = Number.isSafeInteger(receipt.amountMinor) ? receipt.amountMinor : toMinorUnits(receipt.amount || 0, currency);
  const split = buildBeneficiarySplit({entries, totalMinor, currency});
  const reasonText = String(reason || '').trim();
  if (!reasonText) throw new AppError(ERR.VALIDATION, 'سبب توزيع المحضر مطلوب — يُحفظ في سجل النشاط.', {reason: 'مطلوب'});
  const previous = Array.isArray(receipt.beneficiaries) ? receipt.beneficiaries.map(row => ({...row})) : [];
  const updated = {
    ...receipt,
    beneficiaries: split,
    beneficiaryName: split.length === 1 ? split[0].beneficiaryName : split.map(row => row.beneficiaryName).join(' · '),
    beneficiaryShare: split.length === 1 ? split[0].beneficiaryShare : null,
    revisions: [...(receipt.revisions || []), {at: now(), reason: reasonText, field: 'beneficiaries', previous}],
    updatedAt: now(), version: (receipt.version || 0) + 1
  };
  await transaction(office.ctx, [STORE.executionReceipts, STORE.activityLog], async tx => {
    await request(tx.objectStore(STORE.executionReceipts).put(updated));
    await request(tx.objectStore(STORE.activityLog).add({
      id: uid(), entityType: STORE.executionReceipts, entityId: receipt.id, action: 'beneficiary-split',
      timestamp: now(), summary: `توزيع المحضر ${receipt.receiptNumber || ''} على ${split.length} مستحق — ${reasonText}`,
      metadata: {decidedBy: office.ctx?.profile?.id || 'user', reason: reasonText, count: split.length, totalMinor},
      ...(receipt.fileId ? {fileId: receipt.fileId} : {})
    }));
  });
  executionCache.clearExecution(receipt.executionId);
  events.emit('entity:changed', {entityType: STORE.executionReceipts, id: receipt.id});
  return updated;
}

/** حفظ توزيع بند قيمة (من · نسبة · مبلغ) — إضافة حقل، بلا تغيير في الفترات الآلية. */
export async function saveSliceBeneficiaries(office, {sliceId, entries = [], reason = ''} = {}) {
  office.ctx.assert();
  const slice = await office.r.executionValuePeriods.get(sliceId);
  if (!slice || slice.isDeleted) throw new AppError(ERR.NOT_FOUND, 'بند القيمة غير موجود.');
  const currency = slice.currency || 'EGP';
  const totalMinor = Number.isSafeInteger(slice.amountMinor) ? slice.amountMinor : toMinorUnits(slice.amount || 0, currency);
  const split = buildBeneficiarySplit({entries, totalMinor, currency});
  const reasonText = String(reason || '').trim();
  if (!reasonText) throw new AppError(ERR.VALIDATION, 'سبب توزيع البند مطلوب.', {reason: 'مطلوب'});
  const updated = {...slice, beneficiaries: split, updatedAt: now(), version: (slice.version || 0) + 1};
  await transaction(office.ctx, [STORE.executionValuePeriods, STORE.activityLog], async tx => {
    await request(tx.objectStore(STORE.executionValuePeriods).put(updated));
    await request(tx.objectStore(STORE.activityLog).add({
      id: uid(), entityType: STORE.executionValuePeriods, entityId: slice.id, action: 'beneficiary-split',
      timestamp: now(), summary: `توزيع بند ${slice.entitlementType} على ${split.length} مستحق — ${reasonText}`,
      metadata: {decidedBy: office.ctx?.profile?.id || 'user', reason: reasonText, count: split.length},
      ...(slice.fileId ? {fileId: slice.fileId} : {})
    }));
  });
  executionCache.clearExecution(slice.executionId);
  events.emit('entity:changed', {entityType: STORE.executionValuePeriods, id: slice.id});
  return updated;
}

/**
 * ترحيل اختياري صريح: يضيف `beneficiaries` للمحاضر التي لا تحملها،
 * بنسبة 100% للمستحق الرئيسي. لا يغيّر مبلغًا ولا تخصيصًا ولا حالة.
 */
export async function backfillReceiptBeneficiaries(office, {limit = 500, dryRun = true} = {}) {
  office.ctx.assert();
  const cap = Math.max(1, Math.min(Number(limit) || 500, 5000));
  let cursor = null, hasMore = false, scanned = 0;
  const rows = [];
  do {
    const page = await office.r.executionReceipts.page({index: 'date', direction: 'prev', cursor, limit: 100}).catch(() => ({items: [], hasMore: false}));
    rows.push(...(page.items || []));
    cursor = page.nextCursor || null;
    hasMore = Boolean(page.hasMore);
  } while (cursor && hasMore && rows.length < cap);
  const targets = rows.filter(receipt => !receipt.isDeleted && !Array.isArray(receipt.beneficiaries)).slice(0, cap);
  const report = {dryRun: Boolean(dryRun), scanned: rows.length, candidates: targets.length, updated: 0, skippedAll: rows.length - targets.length, scannedAll: !hasMore, at: now()};
  if (dryRun || !targets.length) return report;
  for (const receipt of targets) {
    const creditors = await beneficiaryOptions(office, receipt.executionId).catch(() => []);
    const primary = creditors[0] || null;
    const name = primary?.name || String(receipt.payerName || receipt.beneficiaryName || '').trim();
    if (!name) { report.updated += 0; continue; }
    const currency = receipt.currency || 'EGP';
    const totalMinor = Number.isSafeInteger(receipt.amountMinor) ? receipt.amountMinor : toMinorUnits(receipt.amount || 0, currency);
    const updated = {
      ...receipt,
      beneficiaries: [{id: uid(), partyId: primary?.partyId || '', clientId: primary?.clientId || '', beneficiaryName: name, beneficiaryShare: 100, amountMinor: totalMinor, amount: fromMinorUnits(totalMinor, currency), currency}],
      beneficiaryName: name, beneficiaryShare: 100,
      updatedAt: now(), version: (receipt.version || 0) + 1
    };
    await office.r.executionReceipts.put(updated);
    report.updated += 1;
  }
  await logExecutionDecision(office, {executionId: targets[0]?.executionId || '', action: 'beneficiary-backfill',
    summary: `ترحيل توزيع المستحقين: ${report.updated} محضر من ${report.candidates}`, metadata: {count: report.updated, candidates: report.candidates}}).catch(() => null);
  executionCache.clear();
  return report;
}
