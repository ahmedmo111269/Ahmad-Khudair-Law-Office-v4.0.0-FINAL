// ============================================================
// شكل «مفاتيح الأرقام والكودات» لكل مخزن — طبقة مشتركة صغيرة.
// ------------------------------------------------------------
// وُجدت هذه التعريفات داخل محرك البحث؛ نُقلت هنا لسببين:
//  1) كاش مفاتيح البحث (js/services/search-cache.js) يحتاجها ولا يجوز أن
//     يستورد محرك البحث (حلقة استيراد: المحرك يستورد الكاش).
//  2) أي شاشة «اقتراحات» لاحقًا تحتاج التطابق نفسه بلا نسخ المنطق.
// محرك البحث يعيد تصدير normalizeCodeToken للتوافق مع كل مستورديه الحاليين
// والاختبارات القائمة — لا تغيير في السلوك، فقط في الموضع.
// ============================================================
import {normalizeDigits} from '../core/search-normalizer.js';

/** توحيد الكود: أرقام إنجليزية، أحرف كبيرة، بلا مسافات ولا شرطات. */
export function normalizeCodeToken(value) {
  return normalizeDigits(String(value ?? '')).toUpperCase().replace(/[\s-]+/g, '');
}

/**
 * الحقول التي يُبحث فيها «بالكود/الرقم» بدل النص: فهرسة هذه القيم في كاش
 * البحث هي ما يجعل البحث برقم قومي أو رقم ملف أو رقم قضية يعمل من الذاكرة
 * بنفس دلالة المسح الكامل.
 */
export const NUMBERISH_FIELDS = Object.freeze({
  clients: ['nationalId', 'phone', 'clientCode'],
  files: ['fileNumber'],
  cases: ['caseNumber', 'caseYear'],
  opponents: ['nationalId'],
  serviceRecords: ['internalNumber', 'noticeNumber'],
  powersOfAttorney: ['poaNumber'],
  judgments: ['judgmentNumber', 'lawsuitNumber', 'appealNumber'],
  execution: ['executionNumber', 'officialNumber', 'internalNumber'],
  feePayments: ['receiptNumber'],
  documentReferences: ['referenceNumber'],
  executionReceipts: ['receiptNumber'],
  executionPOAs: ['poaNumber'],
  executionActions: ['referenceNumber', 'judicialNumber', 'petitionNumber'],
  differenceRecords: ['periodKey'],
  executionObligations: ['obligationType', 'description'],
  executionPeriods: ['periodKey', 'obligationTypeSnapshot', 'fromDate', 'toDate']
});

export function numberishFieldsFor(store) {
  return NUMBERISH_FIELDS[store] || null;
}
