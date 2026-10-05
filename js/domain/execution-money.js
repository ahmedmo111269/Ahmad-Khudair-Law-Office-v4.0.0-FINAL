// FEAS money primitives: integer minor units only for persisted/accounting operations.
// Monetary amounts are stored and combined as integer minor units.
const CURRENCY_DIGITS = Object.freeze({
  BHD: 3, IQD: 3, JOD: 3, KWD: 3, OMR: 3, TND: 3,
  CLF: 4,
  BIF: 0, CLP: 0, DJF: 0, GNF: 0, ISK: 0, JPY: 0, KMF: 0, KRW: 0, PYG: 0, RWF: 0, UGX: 0, VND: 0, VUV: 0, XAF: 0, XOF: 0, XPF: 0,
  EGP: 2, USD: 2, EUR: 2, GBP: 2, SAR: 2, AED: 2
});

export function currencyFractionDigits(currency = 'EGP', explicitDigits = undefined) {
  if (explicitDigits !== undefined && explicitDigits !== null && explicitDigits !== '') {
    const digits = Number(explicitDigits);
    if (!Number.isInteger(digits) || digits < 0 || digits > 6) throw new RangeError('دقة العملة غير صحيحة.');
    return digits;
  }
  const code = String(currency || 'EGP').trim().toUpperCase();
  const knownDigits = CURRENCY_DIGITS[code];
  if (knownDigits === undefined) throw new RangeError(`دقة العملة ${code} غير معرفة؛ أضف دقتها صراحةً قبل استخدام حسابات FEAS.`);
  return knownDigits;
}

function decimalText(value) {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('المبلغ ليس رقمًا صالحًا.');
    return String(value);
  }
  return String(value ?? '').trim().replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit))).replace(/٫/g, '.');
}

/** Parse a human-entered major-unit amount without silently rounding extra decimals. */
export function toMinorUnits(value, currency = 'EGP', {fractionDigits = undefined, allowNegative = false} = {}) {
  const digits = currencyFractionDigits(currency, fractionDigits);
  const text = decimalText(value);
  const match = /^([+-]?)(\d+)(?:\.(\d*))?$/.exec(text);
  if (!match) throw new TypeError('أدخل مبلغًا عشريًا صحيح الصيغة.');
  const negative = match[1] === '-';
  if (negative && !allowNegative) throw new RangeError('المبلغ لا يقبل قيمة سالبة هنا.');
  const whole = match[2].replace(/^0+(?=\d)/, '');
  const fraction = match[3] || '';
  const kept = fraction.slice(0, digits);
  const excess = fraction.slice(digits);
  if (/[1-9]/.test(excess)) throw new RangeError(`دقة ${currency} تسمح بـ ${digits} منزلة عشرية فقط؛ لم يُقرَّب المبلغ تلقائيًا.`);
  const scale = 10n ** BigInt(digits);
  const fractionalMinor = BigInt((kept + '0'.repeat(digits)).slice(0, digits) || '0');
  const valueMinor = BigInt(whole) * scale + fractionalMinor;
  const signed = negative ? -valueMinor : valueMinor;
  if (signed > BigInt(Number.MAX_SAFE_INTEGER) || signed < BigInt(Number.MIN_SAFE_INTEGER)) throw new RangeError('المبلغ يتجاوز حد الدقة الآمن.');
  return Number(signed);
}

export function fromMinorUnits(value, currency = 'EGP', {fractionDigits = undefined} = {}) {
  const digits = currencyFractionDigits(currency, fractionDigits);
  if (!Number.isSafeInteger(value)) throw new TypeError('المبلغ بوحدات صغرى يجب أن يكون عددًا صحيحًا آمنًا.');
  return value / (10 ** digits);
}

export function addMinor(...values) {
  let total = 0n;
  for (const value of values) {
    if (!Number.isSafeInteger(value)) throw new TypeError('كل مبالغ التجميع يجب أن تكون وحدات صغرى صحيحة.');
    total += BigInt(value);
  }
  if (total > BigInt(Number.MAX_SAFE_INTEGER) || total < BigInt(Number.MIN_SAFE_INTEGER)) throw new RangeError('إجمالي المبلغ يتجاوز حد الدقة الآمن.');
  return Number(total);
}

export function sumMinor(rows, get = row => row) {
  let total = 0n;
  for (const row of rows || []) {
    const value = get(row);
    if (!Number.isSafeInteger(value)) throw new TypeError('كل مبالغ التجميع يجب أن تكون وحدات صغرى صحيحة.');
    total += BigInt(value);
  }
  if (total > BigInt(Number.MAX_SAFE_INTEGER) || total < BigInt(Number.MIN_SAFE_INTEGER)) throw new RangeError('إجمالي المبلغ يتجاوز حد الدقة الآمن.');
  return Number(total);
}

export function minorEquation(left, right, result) {
  for (const value of [left, right, result]) if (!Number.isSafeInteger(value)) throw new TypeError('المعادلة تتطلب مبالغ بوحدات صغرى.');
  return `${left} + ${right} = ${result} وحدة صغرى`;
}
