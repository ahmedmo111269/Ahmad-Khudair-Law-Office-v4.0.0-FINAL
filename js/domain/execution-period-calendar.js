// Pure civil-date and obligation-period calendar.
// Dates are YYYY-MM-DD strings; this module intentionally uses neither Date nor time zones.

const MIN_YEAR = 1;
const MAX_YEAR = 9999;
const DAY_NAMES = Object.freeze(['DAY', 'WEEK', 'MONTH', 'YEAR']);

export function isCivilDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  return year >= MIN_YEAR && year <= MAX_YEAR && month >= 1 && month <= 12
    && day >= 1 && day <= daysInCivilMonth(year, month);
}

export function daysInCivilMonth(year, month) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || year < MIN_YEAR || year > MAX_YEAR || month < 1 || month > 12) {
    throw new RangeError('الشهر المدني غير صحيح.');
  }
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function isLeapYear(year) {
  return Number.isInteger(year) && year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

export function parseCivilDate(value) {
  if (!isCivilDate(value)) throw new RangeError(`تاريخ مدني غير صحيح: ${value || 'فارغ'}`);
  const [year, month, day] = value.split('-').map(Number);
  return {year, month, day};
}

export function formatCivilDate({year, month, day}) {
  if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR
      || !Number.isInteger(month) || month < 1 || month > 12
      || !Number.isInteger(day) || day < 1 || day > daysInCivilMonth(year, month)) {
    throw new RangeError('مكونات التاريخ المدني غير صحيحة.');
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Howard Hinnant's civil calendar conversion, expressed only with integer arithmetic.
function ordinalOf(iso) {
  const {year, month, day} = parseCivilDate(iso);
  let y = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400;
  const shiftedMonth = month + (month > 2 ? -3 : 9);
  const dayOfYear = Math.floor((153 * shiftedMonth + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra;
}

function dateFromOrdinal(ordinal) {
  if (!Number.isSafeInteger(ordinal)) throw new RangeError('رقم اليوم المدني غير آمن.');
  const era = Math.floor(ordinal / 146097);
  const dayOfEra = ordinal - era * 146097;
  const yearOfEra = Math.floor((dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) / 365);
  let year = yearOfEra + era * 400;
  const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const monthPrime = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * monthPrime + 2) / 5) + 1;
  const month = monthPrime + (monthPrime < 10 ? 3 : -9);
  year += month <= 2 ? 1 : 0;
  return formatCivilDate({year, month, day});
}

export function addCivilDays(iso, count) {
  if (!Number.isSafeInteger(count)) throw new RangeError('عدد الأيام يجب أن يكون عددًا صحيحًا آمنًا.');
  return dateFromOrdinal(ordinalOf(iso) + count);
}

export function daysBetweenCivil(fromDate, toDate) {
  return ordinalOf(toDate) - ordinalOf(fromDate);
}

export function daysInclusive(fromDate, toDate) {
  return toDate < fromDate ? 0 : daysBetweenCivil(fromDate, toDate) + 1;
}

/** Calendar-half-month periods (1–15 and 16–month-end), indexed from a fixed civil anchor. */
export function semiMonthlyPeriodIndex(anchor, date) {
  const a = parseCivilDate(anchor), d = parseCivilDate(date);
  const monthDelta = (d.year - a.year) * 12 + d.month - a.month;
  const anchorHalf = a.day <= 15 ? 0 : 1;
  const dateHalf = d.day <= 15 ? 0 : 1;
  return monthDelta * 2 + dateHalf - anchorHalf;
}

export function semiMonthlyPeriod(anchor, k) {
  if (!Number.isSafeInteger(k)) throw new RangeError('رقم الفترة نصف الشهرية غير صحيح.');
  const a = parseCivilDate(anchor);
  const baseMonth = a.year * 12 + a.month - 1;
  const anchorHalf = a.day <= 15 ? 0 : 1;
  const absoluteHalf = anchorHalf + k;
  const monthOffset = Math.floor(absoluteHalf / 2);
  const half = ((absoluteHalf % 2) + 2) % 2;
  const totalMonth = baseMonth + monthOffset;
  const year = Math.floor(totalMonth / 12);
  const month = ((totalMonth % 12) + 12) % 12 + 1;
  if (year < MIN_YEAR || year > MAX_YEAR) throw new RangeError('نتيجة الفترة نصف الشهرية خارج نطاق التاريخ المدني.');
  const startDay = half === 0 ? 1 : 16;
  const endDay = half === 0 ? 15 : daysInCivilMonth(year, month);
  return {k, from: formatCivilDate({year, month, day: startDay}), to: formatCivilDate({year, month, day: endDay}),
    start: formatCivilDate({year, month, day: startDay}), end: formatCivilDate({year, month, day: endDay})};
}

export function addMonthsClamped(anchor, count) {
  return addMonths(anchor, count, {monthEndPolicy: 'CLAMP_TO_LAST_DAY'});
}

/** Add months from the supplied anchor (never from a previously clamped result). */
export function addMonths(anchor, count, {monthEndPolicy = 'CLAMP_TO_LAST_DAY'} = {}) {
  if (!Number.isSafeInteger(count)) throw new RangeError('عدد الأشهر يجب أن يكون عددًا صحيحًا آمنًا.');
  if (monthEndPolicy !== 'CLAMP_TO_LAST_DAY') throw new RangeError('سياسة نهاية الشهر غير معروفة؛ التقويم يثبت يوم الارتكاز بقصّه لآخر يوم بالشهر.');
  const {year, month, day} = parseCivilDate(anchor);
  const total = year * 12 + month - 1 + count;
  const targetYear = Math.floor(total / 12);
  const targetMonth = ((total % 12) + 12) % 12 + 1;
  if (targetYear < MIN_YEAR || targetYear > MAX_YEAR) throw new RangeError('نتيجة إضافة الأشهر خارج نطاق التاريخ المدني.');
  const last = daysInCivilMonth(targetYear, targetMonth);
  if (day <= last) return formatCivilDate({year: targetYear, month: targetMonth, day});
  return formatCivilDate({year: targetYear, month: targetMonth, day: last});
}

function normalize({unit = 'MONTH', step = 1, periodBasis = 'ANNIVERSARY', monthEndPolicy = 'CLAMP_TO_LAST_DAY'} = {}) {
  const kind = String(unit || 'MONTH').toUpperCase();
  if (!DAY_NAMES.includes(kind)) throw new RangeError(`وحدة الفترة غير معروفة: ${unit}`);
  if (!Number.isSafeInteger(step) || step < 1 || step > 36500) throw new RangeError('خطوة الفترة يجب أن تكون عددًا صحيحًا موجبًا.');
  if (!['ANNIVERSARY', 'CALENDAR_MONTH'].includes(periodBasis)) throw new RangeError('أساس الفترة غير معروف.');
  if (monthEndPolicy !== 'CLAMP_TO_LAST_DAY') throw new RangeError('سياسة نهاية الشهر غير معروفة؛ التقويم يثبت يوم الارتكاز بقصّه لآخر يوم بالشهر.');
  return {unit: kind, step, periodBasis, monthEndPolicy};
}

function effectiveAnchor(anchor, options) {
  const {year, month} = parseCivilDate(anchor);
  return options.unit === 'MONTH' && options.periodBasis === 'CALENDAR_MONTH'
    ? formatCivilDate({year, month, day: 1}) : anchor;
}

function monthStep(options) {
  return options.step * (options.unit === 'YEAR' ? 12 : 1);
}

export function periodStart(anchor, k, rawOptions = {}) {
  if (!Number.isSafeInteger(k)) throw new RangeError('رقم الفترة يجب أن يكون عددًا صحيحًا.');
  const options = normalize(rawOptions);
  const basisAnchor = effectiveAnchor(anchor, options);
  if (options.unit === 'MONTH' || options.unit === 'YEAR') {
    return addMonths(basisAnchor, k * monthStep(options), {monthEndPolicy: options.monthEndPolicy});
  }
  const days = options.step * (options.unit === 'WEEK' ? 7 : 1);
  return addCivilDays(basisAnchor, k * days);
}

export function periodEnd(anchor, k, rawOptions = {}) {
  const options = normalize(rawOptions);
  const start = periodStart(anchor, k, options);
  const next = periodStart(anchor, k + 1, options);
  return addCivilDays(next, -1);
}

/** Return the zero-based anchored period containing date (negative before the anchor). */
export function periodIndexOf(anchor, date, rawOptions = {}) {
  const options = normalize(rawOptions);
  parseCivilDate(anchor); parseCivilDate(date);
  const basisAnchor = effectiveAnchor(anchor, options);
  let k;
  if (options.unit === 'MONTH' || options.unit === 'YEAR') {
    const a = parseCivilDate(basisAnchor), d = parseCivilDate(date);
    const months = (d.year - a.year) * 12 + d.month - a.month;
    k = Math.floor(months / monthStep(options));
  } else {
    const span = options.step * (options.unit === 'WEEK' ? 7 : 1);
    k = Math.floor(daysBetweenCivil(basisAnchor, date) / span);
  }
  while (periodStart(anchor, k, options) > date) k -= 1;
  while (periodStart(anchor, k + 1, options) <= date) k += 1;
  return k;
}

function periodRecord(anchor, k, options) {
  const from = periodStart(anchor, k, options);
  const to = periodEnd(anchor, k, options);
  return {k, from, to, start: from, end: to};
}

export function completedPeriods(anchor, asOf, rawOptions = {}) {
  parseCivilDate(anchor); parseCivilDate(asOf);
  const options = normalize(rawOptions);
  if (asOf < anchor) return [];
  const current = periodIndexOf(anchor, asOf, options);
  const currentPeriod = periodRecord(anchor, current, options);
  const timing = rawOptions.accrualTiming || 'AFTER_PERIOD_END';
  if (!['AFTER_PERIOD_END', 'AT_PERIOD_START'].includes(timing)) throw new RangeError('توقيت الاستحقاق غير معروف.');
  const finalIndex = timing === 'AT_PERIOD_START' ? current : (currentPeriod.to <= asOf ? current : current - 1);
  const firstIndex = Number.isSafeInteger(rawOptions.fromIndex) ? rawOptions.fromIndex : 0;
  const maxPeriods = Number.isSafeInteger(rawOptions.maxPeriods) ? Math.max(0, rawOptions.maxPeriods) : 1200;
  const out = [];
  for (let k = Math.max(0, firstIndex); k <= finalIndex && out.length < maxPeriods; k += 1) out.push(periodRecord(anchor, k, options));
  return out;
}

export function runningPeriod(anchor, asOf, rawOptions = {}) {
  parseCivilDate(anchor); parseCivilDate(asOf);
  const options = normalize(rawOptions);
  if (asOf < anchor || (rawOptions.accrualTiming || 'AFTER_PERIOD_END') === 'AT_PERIOD_START') return null;
  const k = periodIndexOf(anchor, asOf, options);
  const period = periodRecord(anchor, k, options);
  return period.from <= asOf && asOf < period.to ? period : null;
}

/** Complete periods wholly enclosed by [from,to], plus explicit partial boundary periods. */
export function periodsInRange(anchor, from, to, rawOptions = {}) {
  parseCivilDate(anchor); parseCivilDate(from); parseCivilDate(to);
  if (to < from) throw new RangeError('نطاق المدة غير صحيح.');
  const options = normalize(rawOptions);
  if (to < anchor) return {complete: [], partialAtStart: null, partialAtEnd: null, partials: []};
  const firstIndex = Math.max(0, periodIndexOf(anchor, from < anchor ? anchor : from, options));
  const lastIndex = periodIndexOf(anchor, to, options);
  const complete = [];
  let partialAtStart = null, partialAtEnd = null;
  for (let k = firstIndex; k <= lastIndex; k += 1) {
    const period = periodRecord(anchor, k, options);
    if (period.from >= from && period.to <= to) complete.push(period);
    else if (period.from <= to && from <= period.to) {
      if (period.from < from) partialAtStart = period;
      if (period.to > to) partialAtEnd = period;
    }
  }
  const partials = [...new Map([partialAtStart, partialAtEnd].filter(Boolean).map(row => [row.k, row])).values()];
  return {complete, partialAtStart, partialAtEnd, partials};
}

/** Compatibility bridge for the existing execution-frequency vocabulary. */
export function executionPeriodStart(iso, frequency, {anchorDate = iso, customDays = null, periodBasis = 'ANNIVERSARY', monthEndPolicy = 'CLAMP_TO_LAST_DAY'} = {}) {
  parseCivilDate(iso);
  const freq = String(frequency || '').toLowerCase();
  if (freq === 'daily') return periodStart(anchorDate, periodIndexOf(anchorDate, iso, {unit: 'DAY'}), {unit: 'DAY'});
  if (freq === 'weekly') return periodStart(anchorDate, periodIndexOf(anchorDate, iso, {unit: 'WEEK'}), {unit: 'WEEK'});
  if (freq === 'monthly') {
    const opts = {unit: 'MONTH', periodBasis, monthEndPolicy};
    return periodStart(anchorDate, periodIndexOf(anchorDate, iso, opts), opts);
  }
  if (freq === 'yearly') return periodStart(anchorDate, periodIndexOf(anchorDate, iso, {unit: 'YEAR', monthEndPolicy}), {unit: 'YEAR', monthEndPolicy});
  if (freq === 'custom') {
    const opts = {unit: 'DAY', step: Number(customDays)};
    return periodStart(anchorDate, periodIndexOf(anchorDate, iso, opts), opts);
  }
  if (freq === 'semiMonthly') {
    const period = semiMonthlyPeriod(anchorDate, semiMonthlyPeriodIndex(anchorDate, iso));
    return period.from;
  }
  throw new RangeError('الدورية غير معروفة.');
}

export function nextExecutionPeriodStart(startDate, frequency, {anchorDate = startDate, index = null, customDays = null, periodBasis = 'ANNIVERSARY', monthEndPolicy = 'CLAMP_TO_LAST_DAY'} = {}) {
  const freq = String(frequency || '').toLowerCase();
  if (freq === 'semiMonthly') {
    const k = semiMonthlyPeriodIndex(anchorDate, startDate);
    return semiMonthlyPeriod(anchorDate, k + 1).from;
  }
  if (index !== null) {
    const opts = freq === 'yearly' ? {unit: 'YEAR', monthEndPolicy}
      : freq === 'weekly' ? {unit: 'WEEK'}
        : freq === 'daily' ? {unit: 'DAY'}
          : freq === 'custom' ? {unit: 'DAY', step: Number(customDays)}
            : {unit: 'MONTH', periodBasis, monthEndPolicy};
    return periodStart(anchorDate, index + 1, opts);
  }
  switch (freq) {
    case 'daily': return addCivilDays(startDate, 1);
    case 'weekly': return addCivilDays(startDate, 7);
    case 'monthly': return addMonthsClamped(startDate, 1);
    case 'yearly': return addMonthsClamped(startDate, 12);
    case 'custom': return addCivilDays(startDate, Number(customDays));
    default: throw new RangeError('الدورية غير معروفة.');
  }
}

export function executionPeriodEnd(startDate, frequency, options = {}) {
  const next = nextExecutionPeriodStart(startDate, frequency, options);
  return addCivilDays(next, -1);
}

export function enumerateExecutionUnits({fromDate, toDate, frequency, anchorDate = fromDate, customDays = null, periodBasis = 'ANNIVERSARY', monthEndPolicy = 'CLAMP_TO_LAST_DAY', maxUnits = 1200} = {}) {
  parseCivilDate(fromDate); parseCivilDate(toDate);
  if (toDate < fromDate) throw new RangeError('نطاق الفترة غير صحيح.');
  if (!Number.isSafeInteger(maxUnits) || maxUnits < 1) throw new RangeError('حد الفترات غير صحيح.');
  const freq = String(frequency || '').toLowerCase();
  const opts = freq === 'daily' ? {unit: 'DAY'}
    : freq === 'weekly' ? {unit: 'WEEK'}
      : freq === 'yearly' ? {unit: 'YEAR', monthEndPolicy}
        : freq === 'monthly' ? {unit: 'MONTH', periodBasis, monthEndPolicy}
          : freq === 'custom' ? {unit: 'DAY', step: Number(customDays)} : null;
  if (!opts && freq !== 'semiMonthly') throw new RangeError('الدورية غير معروفة.');
  if (freq === 'custom' && (!Number.isSafeInteger(Number(customDays)) || Number(customDays) < 1)) throw new RangeError('عدد أيام الدورية المخصصة غير صحيح.');
  let cursor = executionPeriodStart(fromDate, freq, {anchorDate, customDays, periodBasis, monthEndPolicy});
  let k = periodIndexOf(anchorDate, cursor, opts || {});
  if (freq === 'semiMonthly') k = semiMonthlyPeriodIndex(anchorDate, cursor);
  const units = [];
  while (cursor <= toDate && units.length < maxUnits) {
    const current = freq === 'semiMonthly' ? semiMonthlyPeriod(anchorDate, k) : null;
    const start = current?.from || cursor;
    const end = current?.to || addCivilDays(periodStart(anchorDate, k + 1, opts), -1);
    const next = freq === 'semiMonthly' ? semiMonthlyPeriod(anchorDate, k + 1).from : periodStart(anchorDate, k + 1, opts);
    units.push({index: units.length, k, start, end, from: start, to: end});
    cursor = next;
    k += 1;
  }
  return {units, truncated: cursor <= toDate};
}
