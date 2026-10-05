// =====================================================================
// تصدير كشف حساب التنفيذ — CSV (UTF-8 مع BOM) وPDF عبر مسار الطباعة القائم
// ---------------------------------------------------------------------
// • بلا أي مكتبة خارجية: CSV نصّ + BOM، وPDF هو نافذة الطباعة نفسها
//   (`printSimpleStatement`) التي ينتج منها «حفظ كـPDF» في المتصفح.
// • الأعمدة: رقم التنفيذ · الموكل · من · إلى · المعادلة · المستحق · المدفوع ·
//   المتبقي · الحالة.
// • BOM إلزامي: بدونه يفتح Excel العربي أعمدةً ملتصقة ورموزًا مشوّهة.
// =====================================================================
import {localDate} from '../core/clock.js';
import {isCivilDate} from '../domain/execution-calendar.js';
import {fromMinorUnits} from '../domain/execution-money.js';
import {PERIOD_STATUS, PERIOD_STATUS_LABELS} from '../domain/execution-schedule.js';
import {simpleStatementDocument} from './execution-simple.js';

export const UTF8_BOM = '\uFEFF';

export const STATEMENT_CSV_COLUMNS = Object.freeze([
  'رقم التنفيذ', 'الموكل', 'من', 'إلى', 'المعادلة', 'المستحق', 'المدفوع', 'المتبقي', 'الحالة'
]);

const display = iso => (isCivilDate(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
const decimal = (minor, currency = 'EGP') => fromMinorUnits(Number(minor || 0), currency).toFixed(2);

/** تحويل قيمة إلى حقل CSV آمن (فاصلة منقوشة + أقواس عند الحاجة). */
export function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /["\n\r,;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function rowsToCsv(rows) {
  return (rows || []).map(row => (row || []).map(csvCell).join(',')).join('\r\n');
}

/**
 * يبني صفوف CSV من مستند الكشف نفسه (نفس المحرك، لا حساب ثانٍ).
 * `options` تُمرَّر كما هي إلى `simpleStatementDocument`.
 */
export async function buildStatementCsv(office, executionId, options = {}) {
  const doc = await simpleStatementDocument(office, executionId, options);
  const schedule = doc.schedule || null;
  const currency = doc.currency || 'EGP';
  const execution = doc.execution || {};
  const clientName = doc.clientName || '';
  const header = [...STATEMENT_CSV_COLUMNS];
  const lines = [header];
  for (const row of (doc.rows || [])) {
    const equation = row.trace?.equation || (row.units || []).map(unit => unit.entitlementType).filter(Boolean).join(' + ') || '';
    lines.push([
      execution.internalNumber || execution.officialNumber || '',
      clientName,
      display(row.fromDate), display(row.toDate),
      equation.replace(/\s+/g, ' ').trim(),
      decimal(row.dueMinor, currency), decimal(row.paidMinor, currency), decimal(row.remainingMinor, currency),
      (PERIOD_STATUS_LABELS[row.status] || row.status || '').replace(/[✔◐✗·⏳⚠]\s*/, '')
    ]);
  }
  const totals = schedule?.totals || doc.totals || {};
  lines.push(['الإجمالي', clientName, '', '', `${(doc.rows || []).length} فترة`,
    decimal(totals.dueMinor, currency), decimal(totals.paidMinor, currency), decimal(totals.remainingMinor, currency), '']);
  const csv = UTF8_BOM + rowsToCsv(lines);
  return {csv, rows: lines, currency, count: (doc.rows || []).length, totals};
}

/** اسم ملف آمن من رقم التنفيذ والتاريخ. */
export function statementFileName(executionNumber = '', suffix = 'statement') {
  const safe = String(executionNumber || 'execution').replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'execution';
  return `${safe}-${suffix}-${localDate()}`;
}

/** تنزيل نص كملف — بلا مكتبات (Blob + رابط مؤقت). */
export function downloadTextFile({filename, text, mime = 'text/csv;charset=utf-8'}) {
  if (typeof document === 'undefined' || typeof Blob === 'undefined') return false;
  const blob = new Blob([text], {type: mime});
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // تحرير الرابط بعد بدء التنزيل (لا قبله وإلا أُلغي في بعض المتصفحات).
  setTimeout(() => { try { URL.revokeObjectURL(url); } catch { /* تجاهل */ } }, 4000);
  return true;
}

/** تصدير CSV جاهز للفتح في Excel (UTF-8 + BOM). */
export async function exportStatementCsv(office, executionId, options = {}) {
  const {csv} = await buildStatementCsv(office, executionId, options);
  const doc = await simpleStatementDocument(office, executionId, {...options, mode: options.mode || 'monthly'});
  const name = statementFileName(doc.execution?.internalNumber || doc.execution?.officialNumber || '', 'csv');
  const ok = downloadTextFile({filename: `${name}.csv`, text: csv});
  return {ok, filename: `${name}.csv`, csv};
}

/** تصدير PDF عبر مسار الطباعة القائم (نافذة الطباعة ← «حفظ كـPDF»). */
export async function exportStatementPdf(office, executionId, options = {}) {
  const {printSimpleStatement} = await import('./execution-simple.js');
  return printSimpleStatement(office, executionId, options);
}

export const PERIOD_STATUS_EXPORT = PERIOD_STATUS;
