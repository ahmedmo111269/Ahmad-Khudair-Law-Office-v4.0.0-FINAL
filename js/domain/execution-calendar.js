// Civil-date arithmetic for execution periods. All calculations use UTC calendar components;
// no local timezone or clock parsing is involved.
const DAY_MS = 86_400_000;
const MIN_YEAR = 1900;
const MAX_YEAR = 2200;

export function isCivilDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < MIN_YEAR || year > MAX_YEAR || month < 1 || month > 12 || day < 1) return false;
  return day <= daysInCivilMonth(year, month);
}

export function daysInCivilMonth(year, month) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) throw new RangeError('الشهر المدني غير صحيح.');
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function utcMillis(iso) {
  if (!isCivilDate(iso)) throw new RangeError(`تاريخ مدني غير صحيح: ${iso || 'فارغ'}`);
  const [year, month, day] = iso.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

function fromUtcMillis(ms) {
  const date = new Date(ms);
  return `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export function addCivilDays(iso, count) {
  if (!Number.isInteger(count)) throw new RangeError('عدد الأيام يجب أن يكون صحيحًا.');
  return fromUtcMillis(utcMillis(iso) + count * DAY_MS);
}

export function addCivilMonths(iso, count) {
  if (!Number.isInteger(count)) throw new RangeError('عدد الأشهر يجب أن يكون صحيحًا.');
  const [year, month, day] = iso.split('-').map(Number);
  const total = year * 12 + month - 1 + count;
  const nextYear = Math.floor(total / 12), nextMonthIndex = ((total % 12) + 12) % 12;
  const nextDay = Math.min(day, daysInCivilMonth(nextYear, nextMonthIndex + 1));
  return `${String(nextYear).padStart(4, '0')}-${String(nextMonthIndex + 1).padStart(2, '0')}-${String(nextDay).padStart(2, '0')}`;
}

export function civilDaysInclusive(fromDate, toDate) {
  if (!isCivilDate(fromDate) || !isCivilDate(toDate) || toDate < fromDate) return 0;
  return Math.floor((utcMillis(toDate) - utcMillis(fromDate)) / DAY_MS) + 1;
}

function modulo(value, base) { return ((value % base) + base) % base; }

export function executionPeriodStart(iso, frequency, {anchorDate = '', customDays = null} = {}) {
  if (!isCivilDate(iso)) throw new RangeError('تاريخ بداية الفترة غير صحيح.');
  switch (frequency) {
    case 'daily': return iso;
    case 'weekly': {
      if (!isCivilDate(anchorDate)) throw new RangeError('تاريخ مرجعي صريح مطلوب للدورية الأسبوعية.');
      const offset = Math.floor((utcMillis(iso) - utcMillis(anchorDate)) / DAY_MS);
      return addCivilDays(iso, -modulo(offset, 7));
    }
    case 'semiMonthly': {
      const [year, month, day] = iso.split('-').map(Number);
      return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${day <= 15 ? '01' : '16'}`;
    }
    case 'monthly': return `${iso.slice(0, 7)}-01`;
    case 'yearly': return `${iso.slice(0, 4)}-01-01`;
    case 'custom': {
      if (!isCivilDate(anchorDate)) throw new RangeError('تاريخ مرجعي صريح مطلوب للدورية المخصصة.');
      if (!Number.isInteger(customDays) || customDays < 1 || customDays > 36500) throw new RangeError('عدد أيام الدورية المخصصة غير صحيح.');
      const offset = Math.floor((utcMillis(iso) - utcMillis(anchorDate)) / DAY_MS);
      return addCivilDays(anchorDate, Math.floor(offset / customDays) * customDays);
    }
    default: throw new RangeError('الدورية غير معروفة؛ لم تُختر قاعدة بديلة تلقائيًا.');
  }
}

export function nextExecutionPeriodStart(startDate, frequency, {customDays = null} = {}) {
  switch (frequency) {
    case 'daily': return addCivilDays(startDate, 1);
    case 'weekly': return addCivilDays(startDate, 7);
    case 'semiMonthly': return startDate.slice(-2) === '01' ? `${startDate.slice(0, 7)}-16` : `${addCivilMonths(`${startDate.slice(0, 7)}-01`, 1).slice(0, 7)}-01`;
    case 'monthly': return addCivilMonths(startDate, 1);
    case 'yearly': return `${String(Number(startDate.slice(0, 4)) + 1).padStart(4, '0')}-01-01`;
    case 'custom':
      if (!Number.isInteger(customDays) || customDays < 1) throw new RangeError('عدد أيام الدورية المخصصة غير صحيح.');
      return addCivilDays(startDate, customDays);
    default: throw new RangeError('الدورية غير معروفة؛ لم تُختر قاعدة بديلة تلقائيًا.');
  }
}

export function executionPeriodEnd(startDate, frequency, options = {}) {
  return addCivilDays(nextExecutionPeriodStart(startDate, frequency, options), -1);
}

/** Generate bounded calculation units lazily. `fromDate` and `toDate` are exact claim bounds. */
export function enumerateExecutionUnits({fromDate, toDate, frequency, anchorDate = '', customDays = null, maxUnits = 1200} = {}) {
  if (!isCivilDate(fromDate) || !isCivilDate(toDate) || toDate < fromDate) throw new RangeError('نطاق الفترة غير صحيح.');
  if (!Number.isInteger(maxUnits) || maxUnits < 1) throw new RangeError('حد الفترات غير صحيح.');
  const options = {anchorDate, customDays};
  let cursor = executionPeriodStart(fromDate, frequency, options);
  const units = [];
  while (cursor <= toDate && units.length < maxUnits) {
    const end = executionPeriodEnd(cursor, frequency, options);
    units.push({index: units.length, start: cursor, end});
    const next = nextExecutionPeriodStart(cursor, frequency, options);
    if (next <= cursor) throw new RangeError('توقفت الدورية المدنية عن التقدم.');
    cursor = next;
  }
  return {units, truncated: cursor <= toDate};
}
