// =====================================================================
// بطاقة الملخص السريع لبطاقة التنفيذ (Quick Summary Card)
// ---------------------------------------------------------------------
// • تعرض أعلى بطاقة التنفيذ: الموكل · نوع النفقة · طريقة التنفيذ، ثم الأرقام
//   الثلاثة، ثم آخر إجراء والمعادلة، ثم أزرار العمل نفسها (نفس النوافذ القائمة
//   بلا مسار موازٍ). كل رقم قابل للنقر لعرض كيف حُسب.
// • لا تحسب أي رقم بنفسها: تقرأ من حزمة البطاقة المحسوبة (simpleCardBundle).
// =====================================================================
import {esc} from './dom.js';
import {formatFileNumber} from '../core/file-number.js';
import {fromMinorUnits} from '../domain/execution-money.js';
import {isCivilDate} from '../domain/execution-calendar.js';
import {amountEquation} from '../domain/execution-schedule.js';

const display = iso => (isCivilDate(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');
const money = (minor, currency = 'EGP') => `${fromMinorUnits(minor || 0, currency).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})} ج.م`;

/** أحدث بند قيمة أو حكم يوضح «نوع النفقة» المعروض. */
function entitlementLabel(bundle) {
  const slices = (bundle.slices || []).filter(row => !row.isDeleted && !['cancelled', 'superseded'].includes(String(row.status || '')));
  const slice = slices.at(-1);
  if (slice) {
    const mode = String(slice.valueType || 'periodic') === 'fixed'
      ? 'مبلغ مقطوع'
      : `${Number(slice.amount || 0).toLocaleString('en-US')} ${slice.periodicity === 'monthly' ? 'شهريًا' : (slice.periodicity || '')}`.trim();
    return `${slice.entitlementType || 'بند'} — ${mode}`;
  }
  const judgment = (bundle.judgments || []).filter(row => !row.isDeleted).at(-1);
  return judgment ? `${judgment.entitlementType || 'حكم'} — ${Number(judgment.amount || 0).toLocaleString('en-US')}` : 'لم تُسجَّل قيمة بعد';
}

/** معادلة الرقم المعروض: عدد الفترات × قيمتها (متساوية) أو مجموع الفروق (مختلفة). */
export function summaryEquation(bundle) {
  const rows = (bundle.schedule?.rows || []).filter(row => Number(row.dueMinor || 0) > 0);
  if (!rows.length) return 'لا فترات داخلة في الحساب حتى هذا التاريخ';
  const currency = bundle.schedule?.currency || 'EGP';
  const equation = amountEquation(rows.map(row => ({amountMinor: row.dueMinor})), currency);
  const running = rows.filter(row => !row.isComplete).length;
  return `${rows.length} فترة · ${equation}${running ? ` · منها ${running} لم تنتهِ بعد` : ''}`;
}

export function executionSummaryCardMarkup(bundle) {
  const {execution, client, creditor, debtor, schedule, file} = bundle;
  const currency = schedule?.currency || 'EGP';
  const totals = schedule?.totals || {};
  const lastAction = bundle.lastAction;
  const asOf = schedule?.effectiveAsOf || schedule?.asOf || '';
  const requested = schedule?.requestedAsOf || asOf;
  const estimated = Number(schedule?.estimatedPeriods || 0);
  const capped = Boolean(schedule?.horizonCapped);
  return `<div class="exec-quick-card" data-quick-card>
    <div class="quick-head">
      <span><b>الموكل:</b> ${esc(creditor?.name || client?.fullName || 'غير محدد')}</span>
      <span><b>المنفذ ضده:</b> ${esc(debtor?.name || 'غير محدد')}</span>
      <span><b>النوع:</b> ${esc(entitlementLabel(bundle))}</span>
      <span><b>طريقة التنفيذ:</b> ${esc(execution.executionMethod || 'غير محددة')}</span>
      ${file ? `<span><b>الملف:</b> ${esc(formatFileNumber(file.fileNumber))}</span>` : ''}
    </div>
    <div class="quick-numbers">
      <button type="button" class="num" data-trace="due"><span>المستحق حتى ${esc(display(asOf))}${estimated ? ' <em class="est-tag">تقديري</em>' : ''}</span><b>${money(totals.dueMinor, currency)}</b></button>
      <button type="button" class="num" data-trace="paid"><span>المحصّل</span><b>${money(totals.paidMinor, currency)}</b><small>${totals.creditMinor > 0 ? `منه رصيد دائن ${money(totals.creditMinor, currency)}` : 'من المحاضر المسجلة'}</small></button>
      <button type="button" class="num num-primary" data-trace="remaining"><span>الرصيد</span><b>${money(totals.remainingMinor, currency)}</b></button>
    </div>
    <div class="quick-lines">
      <span><b>آخر إجراء:</b> ${esc(lastAction ? `${lastAction.kindLabel || lastAction.kind || 'إجراء'} — ${display(lastAction.date)}` : 'لا يوجد بعد')}</span>
      <button type="button" class="link" data-horizon-focus>⚙ تغيير تاريخ «المطلوب حتى»</button>
    </div>
    <button type="button" class="quick-equation" data-equation-details="1" title="اضغط لعرض مصدر الرقم">المعادلة: ${esc(summaryEquation(bundle))} <span class="muted">(اضغط للتفاصيل)</span></button>
    ${capped ? `<p class="hint hint-warn small">⚠ لم يُحسب بعد ${esc(display(requested))} — ${esc(schedule?.horizonNote || '')}</p>` : ''}
    ${estimated && !capped ? `<p class="hint hint-info small">ⓘ ${esc(schedule?.estimateNote || `${estimated} فترة لم تُستحق بعد — القيمة المتوقعة ${money(schedule?.estimatedMinor, currency)}`)}</p>` : ''}
    <div class="quick-actions">
      <button type="button" class="ghost small" data-open-duration>🧮 احسب مدة</button>
      <button type="button" class="ghost small" data-action="poa">📄 توكيل جديد</button>
      <button type="button" class="ghost small" data-action="collection">💰 محضر تحصيل</button>
      <button type="button" class="ghost small" data-action="action">⚡ إجراء</button>
      <button type="button" class="ghost small" data-statement-mode="summary">🖨 طباعة</button>
      <button type="button" class="ghost small" data-settings>⚙ إعدادات التنفيذ</button>
    </div>
  </div>`;
}
