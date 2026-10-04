// =====================================================================
// قسم التنفيذ — المفردات والحساب الأساسي (نقي، بلا IndexedDB وبلا DOM)
// ---------------------------------------------------------------------
// هذا الملف لا يقود رأيًا قانونيًا: لا يفترض واجب حجز أو بيع أو تبديد،
// ولا يستنتج تاريخ سريان من تاريخ حكم، ولا يحوّل اسم نوع استحقاق إلى طريقة
// حساب. كل ما هنا: تواريخ، دوريات، مبالغ، وحالات — كما أدخلها المستخدم.
// =====================================================================

export const EXECUTION_TYPES = Object.freeze([
  ['civil', 'التنفيذ المدني'],
  ['criminal', 'التنفيذ الجنائي'],
  ['family', 'تنفيذ أحكام الأسرة']
]);
export const EXECUTION_TYPE_LABELS = Object.freeze(Object.fromEntries(EXECUTION_TYPES));
/** كل ما ليس مدنيًا أو جنائيًا يُعرض «غير محدد» ولا يُخترع له تصنيف. */
export const executionTypeLabel = value => EXECUTION_TYPE_LABELS[value] || (value ? String(value) : 'غير محدد');
export const isFamilyExecution = row => String(row?.executionType || '') === 'family';

export const PERIODICITIES = Object.freeze([
  ['daily', 'يومية'],
  ['weekly', 'أسبوعية'],
  ['semiMonthly', 'نصف شهرية'],
  ['monthly', 'شهرية'],
  ['yearly', 'سنوية'],
  ['custom', 'دورية مخصصة']
]);
export const PERIODICITY_LABELS = Object.freeze(Object.fromEntries(PERIODICITIES));
export const periodicityLabel = value => PERIODICITY_LABELS[value] || (value ? String(value) : '');

export const VALUE_TYPES = Object.freeze([
  ['periodic', 'مبلغ دوري'],
  ['fixed', 'مبلغ ثابت (لا يتكرر)']
]);
export const VALUE_TYPE_LABELS = Object.freeze(Object.fromEntries(VALUE_TYPES));
export const valueTypeLabel = value => VALUE_TYPE_LABELS[value] || '';

export const SLICE_STATUSES = Object.freeze([
  ['active', 'سارية'],
  ['superseded', 'استُبدلت بحكم لاحق'],
  ['cancelled', 'ملغاة'],
  ['needs_review', 'تحتاج مراجعة']
]);
export const SLICE_STATUS_LABELS = Object.freeze(Object.fromEntries(SLICE_STATUSES));
export const sliceStatusLabel = value => SLICE_STATUS_LABELS[value] || (value ? String(value) : '');

// أنواع الحركات المالية: COLLECTION نقد داخل، DIFFERENCE_DUE التزام معتمد،
// المصروفات كلفة تنفيذ منفصلة عن أصل الدين، ADJUSTMENT/REVERSAL تصحيح وعكس.
export const LEDGER_TYPES = Object.freeze([
  ['COLLECTION', 'تحصيل', 'collection'],
  ['DIFFERENCE_DUE', 'فرق استحقاق معتمد (حكم لاحق)', 'obligation'],
  ['EXECUTION_FEE', 'رسم تنفيذ', 'expense'],
  ['STAMP', 'دمغة', 'expense'],
  ['COLLECTION_FEE', 'مصروف تحصيل', 'expense'],
  ['OTHER_EXPENSE', 'مصروف آخر', 'expense'],
  ['ADJUSTMENT', 'تصحيح حركة', 'correction'],
  ['REVERSAL', 'عكس حركة', 'correction']
]);
export const LEDGER_TYPE_LABELS = Object.freeze(Object.fromEntries(LEDGER_TYPES.map(([k, l]) => [k, l])));
export const LEDGER_CATEGORY = Object.freeze(Object.fromEntries(LEDGER_TYPES.map(([k, , c]) => [k, c])));
export const LEDGER_CATEGORIES = Object.freeze(['collection', 'obligation', 'expense', 'correction']);
export const ledgerTypeLabel = value => LEDGER_TYPE_LABELS[value] || (value ? String(value) : '');
export const isExpenseType = type => LEDGER_CATEGORY[type] === 'expense';
export const isCollectionType = type => LEDGER_CATEGORY[type] === 'collection';
export const EXPENSE_TYPES = Object.freeze(LEDGER_TYPES.filter(([, , c]) => c === 'expense').map(([k]) => k));

export const ALLOCATION_METHODS = Object.freeze([
  ['DIRECT', 'مباشر حسب المستند'],
  ['MANUAL', 'يدوي (مبالغ محددة)'],
  ['FIFO', 'الأقدم فالأحدث'],
  ['PROPORTIONAL', 'بالتناسب مع المتبقي'],
  ['BY_PARTY', 'حسب المستحق ثم الأقدم']
]);
export const ALLOCATION_METHOD_LABELS = Object.freeze(Object.fromEntries(ALLOCATION_METHODS));
export const allocationMethodLabel = value => ALLOCATION_METHOD_LABELS[value] || (value ? String(value) : '');

export const DIFFERENCE_STATUSES = Object.freeze([
  ['DRAFT', 'مسودة'],
  ['PENDING_REVIEW', 'تنتظر المراجعة'],
  ['APPROVED', 'معتمدة'],
  ['POSTED', 'مُرحّلة إلى الحركات'],
  ['CANCELLED', 'ملغاة / مرفوضة']
]);
export const DIFFERENCE_STATUS_LABELS = Object.freeze(Object.fromEntries(DIFFERENCE_STATUSES));
export const differenceStatusLabel = value => DIFFERENCE_STATUS_LABELS[value] || (value ? String(value) : '');
export const IN_REVIEW_DIFFERENCE_STATUSES = Object.freeze(['DRAFT', 'PENDING_REVIEW']);
export const ACTIVE_DIFFERENCE_STATUSES = Object.freeze(['APPROVED', 'POSTED']);

export const SETTLEMENT_STATUSES = DIFFERENCE_STATUSES;
export const SETTLEMENT_STATUS_LABELS = DIFFERENCE_STATUS_LABELS;
export const settlementStatusLabel = differenceStatusLabel;

export const EXECUTION_STATUSES = Object.freeze([
  ['not_started', 'لم يبدأ'],
  ['active', 'جارٍ'],
  ['suspended', 'موقوف'],
  ['partial', 'تحصيل جزئي'],
  ['completed', 'مكتمل'],
  ['cancelled', 'ملغي']
]);
export const EXECUTION_STATUS_LABELS = Object.freeze(Object.fromEntries(EXECUTION_STATUSES));
export const executionStatusLabel = value => EXECUTION_STATUS_LABELS[value] || (value ? String(value) : 'لم يبدأ');

export const EXECUTION_METHODS = Object.freeze([
  ['employer', 'جهة العمل'],
  ['nasser_bank', 'بنك ناصر'],
  ['bailiffs', 'المحضرون / إدارة التنفيذ'],
  ['other', 'أخرى']
]);
export const EXECUTION_METHOD_LABELS = Object.freeze(Object.fromEntries(EXECUTION_METHODS));
export const executionMethodLabel = value => EXECUTION_METHOD_LABELS[value] || (value ? String(value) : '');

export const POA_KINDS = Object.freeze([
  ['first', 'توكيل أول'],
  ['reissue', 'إعادة توكيل']
]);
export const POA_KIND_LABELS = Object.freeze(Object.fromEntries(POA_KINDS));
export const poaKindLabel = value => POA_KIND_LABELS[value] || 'توكيل';

export const POA_STATUSES = Object.freeze([
  ['draft', 'مسودة'],
  ['active', 'ساري'],
  ['done', 'منتهٍ'],
  ['cancelled', 'ملغي']
]);
export const POA_STATUS_LABELS = Object.freeze(Object.fromEntries(POA_STATUSES));
export const poaStatusLabel = value => POA_STATUS_LABELS[value] || (value ? String(value) : '');

// أنواع الإجراءات: أكواد قديمة محفوظة للتواكب + أكواد الواجهة المبسطة.
// القائمة نفسها قابلة للتعديل من إعدادات التنفيذ (settings) ولا يفترض البرنامج ترتيبًا قانونيًا.
export const ACTION_KINDS = Object.freeze([
  ['summons', 'تكليف بالوفاء'],
  ['notice', 'إعلان'],
  ['seizure', 'حجز'],
  ['sale_notice', 'إعلان بيع'],
  ['sale_session', 'جلسة بيع'],
  ['dissipation', 'محضر تبديد'],
  ['petition_number', 'رقم عرائض'],
  ['judicial_number', 'رقم قضائي'],
  ['petition', 'عريضة'],
  ['misdemeanor', 'جنحة'],
  ['refusal_record', 'محضر امتناع'],
  ['request', 'طلب / تظلم'],
  ['other', 'إجراء آخر']
]);
export const ACTION_KIND_LABELS = Object.freeze(Object.fromEntries(ACTION_KINDS));
export const actionKindLabel = value => ACTION_KIND_LABELS[value] || (value ? String(value) : '');
/** «رقم عرائض بلا رقم قضائي» تنبيه تنظيمي اختياري — لا يصبح قاعدة إلزامية. */
export const PETITION_KIND = 'petition_number';
export const JUDICIAL_KIND = 'judicial_number';

export const PRORATION_POLICIES = Object.freeze([
  ['days', 'تقسيم أيام الفترة عند بداية/نهاية غير كاملة'],
  ['periodStart', 'الاعتماد على قيمة الفترة كاملة عند بدايتها']
]);
export const PRORATION_LABELS = Object.freeze(Object.fromEntries(PRORATION_POLICIES));
export const DEFAULT_PRORATION = 'days';

export const EXECUTION_REVIEW_REASONS = Object.freeze({
  missing_execution_type: 'نوع التنفيذ غير محدد',
  missing_authority: 'جهة التنفيذ غير مسجلة',
  missing_official_number: 'رقم التنفيذ الرسمي غير مسجل',
  missing_judgment: 'لا يوجد حكم مربوط بالتنفيذ',
  missing_value: 'لا يوجد مبلغ أو شريحة قيمة',
  missing_dates: 'لا يوجد تاريخ كافٍ لبناء فترة',
  legacy_record: 'سجل تنفيذ قديم أُضيفت إليه الحقول الجديدة دون تغيير بياناته'
});

// ===== أدوات أرقام وتواريخ =====
export const num = value => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
export const round2 = value => Math.round((num(value) + Number.EPSILON) * 100) / 100;
export const money = value => round2(value).toLocaleString('ar-EG', {minimumFractionDigits: 2, maximumFractionDigits: 2});
/** معادلة مقروءة بلا التباس: 6 × 4000 = 24000 */
export function equationText(parts) {
  return parts.filter(part => part !== '' && part !== null && part !== undefined).join(' ');
}
// تحقق صارم: الصيغة صحيحة AND اليوم موجود فعلًا في التقويم (2026-02-30 و2025-13-01 مرفوضان).
export function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1) return false;
  return d <= daysInMonth(y, m - 1);
}
export function isIsoMonth(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}$/.test(value)) return false;
  const [y, m] = value.split('-').map(Number);
  return y >= 1900 && y <= 2200 && m >= 1 && m <= 12;
}
export const monthOf = iso => String(iso || '').slice(0, 7);
export const utcOf = iso => Date.UTC(Number(String(iso).slice(0, 4)), Number(String(iso).slice(5, 7)) - 1, Number(String(iso).slice(8, 10)));
export const isoOfUtc = ms => { const d = new Date(ms); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}` };
export const DAY_MS = 86400000;
export function daysBetweenInclusive(from, to) {
  if (!isIsoDate(from) || !isIsoDate(to)) return 0;
  return Math.round((utcOf(to) - utcOf(from)) / DAY_MS) + 1;
}
export function daysInMonth(year, monthIndex) { return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate(); }
export function monthStart(iso) { return `${String(iso).slice(0, 7)}-01`; }
export function monthEnd(iso) {
  const y = Number(String(iso).slice(0, 4)), m = Number(String(iso).slice(5, 7));
  return `${String(iso).slice(0, 7)}-${String(daysInMonth(y, m - 1)).padStart(2, '0')}`;
}
export function addDaysIso(iso, n) { return isoOfUtc(utcOf(iso) + n * DAY_MS); }
export function addMonthsIso(iso, n) {
  const y = Number(String(iso).slice(0, 4)), m = Number(String(iso).slice(5, 7)), d = Number(String(iso).slice(8, 10));
  const total = (y * 12 + (m - 1)) + n;
  const ny = Math.floor(total / 12), nm = (total % 12 + 12) % 12;
  const nd = Math.min(d, daysInMonth(ny, nm));
  return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(nd).padStart(2, '0')}`;
}
export const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` };
export const maxIso = (a, b) => (!a ? b : !b ? a : a > b ? a : b);
export const minIso = (a, b) => (!a ? b : !b ? a : a < b ? a : b);

// ===== الدوريات ومفاتيح الفترات =====
/**
 * بداية الفترة التي تقع فيها `iso` حسب الدورية.
 * anchorIso: مرجع ثابت للدورات المخصصة (وأي دورية تحتاج نقطة انطلاق) — يُسجله المستخدم.
 * يومية: اليوم نفسه. أسبوعية: بداية الأسبوع (السبت، بداية الأسبوع في مصر) من المرجع.
 */
export function periodStartFor(iso, periodicity, anchorIso = '', customDays = 30) {
  if (!isIsoDate(iso)) return '';
  switch (periodicity) {
    case 'daily': return iso;
    case 'weekly': {
      const anchor = isIsoDate(anchorIso) ? anchorIso : '2024-01-06'; // السبت بداية الأسبوع
      const diff = Math.floor((utcOf(iso) - utcOf(anchor)) / DAY_MS);
      const offset = ((diff % 7) + 7) % 7;
      return addDaysIso(iso, -offset);
    }
    case 'semiMonthly': return Number(String(iso).slice(8, 10)) >= 16 ? `${String(iso).slice(0, 7)}-16` : `${String(iso).slice(0, 7)}-01`;
    case 'yearly': return `${String(iso).slice(0, 4)}-01-01`;
    case 'custom': {
      const anchor = isIsoDate(anchorIso) ? anchorIso : monthStart(iso);
      const span = Math.max(1, Math.floor(num(customDays) || 30));
      if (iso <= anchor) return anchor;
      const offset = Math.floor((utcOf(iso) - utcOf(anchor)) / DAY_MS);
      return addDaysIso(anchor, Math.floor(offset / span) * span);
    }
    case 'monthly':
    default: return monthStart(iso);
  }
}
export function nextPeriodStart(startIso, periodicity, customDays = 30) {
  switch (periodicity) {
    case 'daily': return addDaysIso(startIso, 1);
    case 'weekly': return addDaysIso(startIso, 7);
    case 'semiMonthly': {
      const day = Number(String(startIso).slice(8, 10));
      return day <= 1 ? `${String(startIso).slice(0, 7)}-16` : monthStart(addMonthsIso(startIso, 1));
    }
    case 'yearly': return `${Number(String(startIso).slice(0, 4)) + 1}-01-01`;
    case 'custom': return addDaysIso(startIso, Math.max(1, Math.floor(num(customDays) || 1)));
    case 'monthly':
    default: return addMonthsIso(startIso, 1);
  }
}
export function periodEndFor(startIso, periodicity, customDays = 30) {
  const next = nextPeriodStart(startIso, periodicity, customDays);
  return addDaysIso(next, -1);
}
/** مفتاح فترة حتمي: <نوع الاستحقاق>::<بداية الفترة> — لا تُخزَّن الفترات، تُشتق. */
export const periodKeyOf = (entitlementKey, startIso) => `${String(entitlementKey || 'مستحق')}::${startIso}`;
export function parsePeriodKey(key) {
  const parts = String(key || '').split('::');
  if (parts.length < 2 || !parts.slice(0, -1).join('::').trim() || !isIsoDate(parts.at(-1))) return null;
  return {entitlementKey: parts.slice(0, -1).join('::'), start: parts.at(-1)};
}
/**
 * توليد كسول ومحدود للفترات: لا ملايين السجلات مقدمًا، فقط النطاق المطلوب مع سقف صريح.
 * يرجع {periods:[{key,start,end,index}], truncated}
 */
export function enumeratePeriods({from, to, periodicity = 'monthly', customDays = 30, anchor = '', maxPeriods = 1200} = {}) {
  const out = [];
  if (!isIsoDate(from) || !isIsoDate(to) || to < from) return {periods: out, truncated: false};
  let cursor = periodStartFor(from, periodicity, anchor, customDays);
  let guard = 0;
  while (cursor <= to && out.length < maxPeriods) {
    const end = periodEndFor(cursor, periodicity, customDays);
    out.push({key: cursor, start: cursor, end, index: out.length});
    const next = nextPeriodStart(cursor, periodicity, customDays);
    if (next <= cursor) break; // حماية من حلقة لا نهائية
    cursor = next;
    if (++guard > maxPeriods + 10) break;
  }
  return {periods: out, truncated: out.length >= maxPeriods && cursor <= to};
}

// ===== تحقق الحقول (رسائل عربية مفهومة) =====
const REQ = 'مطلوب';
export function validateValueSlice(input = {}, {existing = []} = {}) {
  const errors = {};
  if (!String(input.entitlementType || '').trim()) errors.entitlementType = 'نوع الاستحقاق مطلوب.';
  if (!String(input.judgmentId || '').trim()) errors.judgmentId = 'الحكم المصدر مطلوب لكل شريحة قيمة.';
  if (!isIsoDate(input.startDate)) errors.startDate = 'تاريخ سريان القيمة مطلوب (لا يُستنتج من تاريخ الحكم).';
  if (input.endDate && !isIsoDate(input.endDate)) errors.endDate = 'تاريخ انتهاء السريان غير صحيح.';
  if (input.endDate && isIsoDate(input.endDate) && isIsoDate(input.startDate) && input.endDate < input.startDate) errors.endDate = 'تاريخ النهاية قبل تاريخ البداية.';
  const valueType = input.valueType === 'fixed' ? 'fixed' : 'periodic';
  if (!(num(input.amount) > 0)) errors.amount = 'قيمة الاستحقاق يجب أن تكون أكبر من صفر.';
  if (valueType === 'periodic' && !PERIODICITY_LABELS[input.periodicity]) errors.periodicity = 'دورية الاستحقاق مطلوبة للمبلغ الدوري.';
  if (input.periodicity === 'custom' && !(num(input.customDays) > 0)) errors.customDays = 'عدد أيام الدورية المخصصة مطلوب.';
  // تداخل الشرائح لنفس نوع الاستحقاق: يُسمح فقط إذا كانت هناك نهاية صريحة لشريحة سابقة (استبدال مقصود).
  for (const slice of existing) {
    if (slice.id && slice.id === input.id) continue;
    if (slice.isDeleted || slice.status === 'cancelled') continue;
    if (String(slice.entitlementType || '') !== String(input.entitlementType || '')) continue;
    const aStart = input.startDate, aEnd = input.endDate || '9999-12-31';
    const bStart = slice.startDate, bEnd = slice.endDate || '9999-12-31';
    if (isIsoDate(aStart) && isIsoDate(bStart) && aStart <= bEnd && bStart <= aEnd) {
      errors.startDate = `تعارض مع شريحة قائمة (${slice.startDate}${slice.endDate ? ' → ' + slice.endDate : ' → مفتوحة'}). عدّل تاريخ النهاية للشريحة السابقة أولًا أو أنشئ الشريحة الجديدة بتاريخ لاحق.`;
      break;
    }
  }
  return errors;
}

export function validateLedgerEntry(input = {}) {
  const errors = {};
  if (!String(input.executionId || '').trim()) errors.executionId = REQ;
  if (!LEDGER_TYPE_LABELS[input.type]) errors.type = 'نوع الحركة المالية غير معروف.';
  if (!(num(input.amount) > 0)) errors.amount = 'المبلغ يجب أن يكون أكبر من صفر.';
  if (!isIsoDate(input.date)) errors.date = 'تاريخ الحركة مطلوب.';
  if (input.type === 'REVERSAL' && !String(input.adjustsLedgerId || '').trim()) errors.adjustsLedgerId = 'العكس يجب أن يشير إلى الحركة الأصلية.';
  if (input.type === 'ADJUSTMENT' && !String(input.adjustsLedgerId || '').trim()) errors.adjustsLedgerId = 'التصحيح يجب أن يشير إلى الحركة الأصلية.';
  if ((input.type === 'ADJUSTMENT' || input.type === 'REVERSAL') && !String(input.reason || '').trim()) errors.reason = 'سبب التصحيح أو العكس مطلوب.';
  return errors;
}

export function validateExecution(input = {}) {
  const errors = {};
  if (!EXECUTION_TYPE_LABELS[input.executionType]) errors.executionType = 'نوع التنفيذ مطلوب.';
  if (!String(input.fileId || '').trim() && !String(input.caseId || '').trim()) errors.fileId = 'يجب ربط التنفيذ بملف قانوني أو بمرحلة قضائية.';
  if (input.executoryFormulaDate && !isIsoDate(input.executoryFormulaDate)) errors.executoryFormulaDate = 'تاريخ الصيغة التنفيذية غير صحيح.';
  if (input.formulaReceiptDate && !isIsoDate(input.formulaReceiptDate)) errors.formulaReceiptDate = 'تاريخ استلام الصيغة غير صحيح.';
  if (input.judgmentDate && !isIsoDate(input.judgmentDate)) errors.judgmentDate = 'تاريخ الحكم غير صحيح.';
  if (input.caseYear && !/^\d{4}$/.test(String(input.caseYear))) errors.caseYear = 'السنة غير صحيحة.';
  return errors;
}

export function validateAllocationLines({lines = [], amount = 0, outstanding = new Map()} = {}) {
  const errors = [];
  const total = round2(lines.reduce((sum, line) => sum + num(line.amount), 0));
  if (total > round2(num(amount)) + 0.001) errors.push({code: 'over_ledger', message: `إجمالي التخصيص (${money(total)}) أكبر من مبلغ الحركة (${money(amount)}).`});
  const seen = new Map();
  for (const line of lines) {
    if (!(num(line.amount) > 0)) { errors.push({code: 'non_positive', periodKey: line.periodKey, message: 'مبلغ التخصيص يجب أن يكون أكبر من صفر.'}); continue; }
    const key = `${line.periodKey}|${line.executionPartyId || ''}`;
    const previous = seen.get(key);
    if (previous) { errors.push({code: 'duplicate', periodKey: line.periodKey, message: `تخصيص مكرر لنفس الفترة (${line.periodKey}) — لا يُسمح بتخصيص المبلغ نفسه مرتين.`}); continue; }
    seen.set(key, line);
    if (outstanding.size && !outstanding.has(line.periodKey)) {
      errors.push({code: 'unknown_period', periodKey: line.periodKey, message: `لا توجد فترة استحقاق بهذا المفتاح داخل التنفيذ (${line.periodKey}).`});
      continue;
    }
    const remaining = outstanding.has(line.periodKey) ? num(outstanding.get(line.periodKey).remaining) : Infinity;
    if (num(line.amount) > remaining + 0.001) errors.push({code: 'over_period', periodKey: line.periodKey, message: `التخصيص على الفترة ${line.periodKey} (${money(line.amount)}) أكبر من المتبقي عليها (${money(remaining)}).`});
  }
  return errors;
}

// ===== حدود القراءة والحساب =====
// لا تُنشأ فترات مسبقًا: هذه الحدود تمنع أي استعلام غير محكوم على بيانات ضخمة.
export const EXECUTION_LIMITS = Object.freeze({
  periods: 1200,          // أقصى عدد فترات محسوبة لتنفيذ واحد في طلب واحد
  childRows: 2000,        // أقصى صفوك فرعية (حركات/تخصيصات/فترات/فروق) في طلب واحد
  centerSample: 300,      // أقصى تنفيذات تُفحص لتجميع المؤشرات في طلب واحد
  timeline: 200,          // أقصى وقائع في السجل الزمني
  migrationBatch: 200     // دُفعة ترحيل بيانات التنفيذ القديمة
});
