// Domain-neutral query model and in-memory query primitives shared by every DataGrid.
// Providers may translate the same model to IndexedDB, SQL, or a remote API.
import { normalizeArabic, normalizeDigits } from './search-normalizer.js';

export const GRID_QUERY_VERSION = 1;
export const GRID_PAGE_SIZES = Object.freeze([25, 50, 100]);
export const GRID_FILTER_OPERATORS = Object.freeze({
  text: Object.freeze([
    ['contains', 'يحتوي'], ['notContains', 'لا يحتوي'], ['eq', 'يساوي'], ['neq', 'لا يساوي'],
    ['starts', 'يبدأ بـ'], ['ends', 'ينتهي بـ'], ['allWords', 'كل الكلمات'], ['anyWord', 'أي كلمة'],
    ['empty', 'فارغ'], ['notEmpty', 'غير فارغ']
  ]),
  number: Object.freeze([
    ['eq', 'يساوي'], ['neq', 'لا يساوي'], ['gt', 'أكبر من'], ['gte', 'أكبر من أو يساوي'],
    ['lt', 'أصغر من'], ['lte', 'أصغر من أو يساوي'], ['between', 'بين'], ['empty', 'فارغ'], ['notEmpty', 'غير فارغ']
  ]),
  date: Object.freeze([
    ['eq', 'في يوم'], ['before', 'قبل'], ['after', 'بعد'], ['onOrBefore', 'في أو قبل'],
    ['onOrAfter', 'في أو بعد'], ['between', 'من تاريخ إلى تاريخ'], ['today', 'اليوم'],
    ['yesterday', 'أمس'], ['thisWeek', 'هذا الأسبوع'], ['thisMonth', 'هذا الشهر'],
    ['thisYear', 'السنة الحالية'], ['empty', 'فارغ'], ['notEmpty', 'غير فارغ']
  ]),
  bool: Object.freeze([['isTrue', 'نعم'], ['isFalse', 'لا'], ['empty', 'فارغ']]),
  select: Object.freeze([
    ['contains', 'يحتوي'], ['eq', 'يساوي'], ['neq', 'لا يساوي'], ['empty', 'فارغ'], ['notEmpty', 'غير فارغ']
  ]),
  multiSelect: Object.freeze([
    ['contains', 'يحتوي'], ['eq', 'يساوي'], ['neq', 'لا يساوي'], ['empty', 'فارغ'], ['notEmpty', 'غير فارغ']
  ])
});

const VALUE_FREE = new Set(['empty', 'notEmpty', 'isTrue', 'isFalse', 'today', 'yesterday', 'thisWeek', 'thisMonth', 'thisYear']);
const PAGE_SIZE_DEFAULT = 25;
const numberFrom = value => {
  const normalized = normalizeDigits(String(value ?? '').trim()).replace(/[٬,\s]/g, '').replace('٫', '.');
  if (!normalized) return NaN;
  return Number(normalized);
};
const valueOf = (column, row) => {
  try { return typeof column?.get === 'function' ? column.get(row) : row?.[column?.key]; }
  catch { return undefined; }
};
const displayOf = (column, row) => {
  try {
    const value = typeof column?.text === 'function' ? column.text(row) : valueOf(column, row);
    return String(value ?? '');
  } catch { return ''; }
};
const isEmpty = value => value === undefined || value === null || value === '';
const isTrue = value => value === true || value === 'true' || value === 1 || value === '1';
const isFalse = value => value === false || value === 'false' || value === 0 || value === '0';
const typeOf = column => ['number', 'date', 'bool', 'select', 'multiSelect'].includes(column?.type) ? column.type : 'text';

export const normalizeGridText = value => normalizeArabic(normalizeDigits(String(value ?? '')));
export const isValueFreeGridFilter = operator => VALUE_FREE.has(operator);

/**
 * Normalize the portable query shape used at the UI/provider boundary.
 *
 * { search:{text,column}, filters:{logic,rules}, sort:[{key,dir}], groupBy,
 *   pagination:{mode:'cursor',size,cursor,direction} }
 */
export function createGridQuery(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const search = typeof source.search === 'string' ? { text: source.search } : (source.search || {});
  const rawPaging = source.pagination || {};
  const parsedSize = Number(rawPaging.size ?? rawPaging.pageSize ?? source.pageSize ?? PAGE_SIZE_DEFAULT);
  const size = GRID_PAGE_SIZES.includes(parsedSize) ? parsedSize : PAGE_SIZE_DEFAULT;
  const rawSort = Array.isArray(source.sort) ? source.sort : Array.isArray(source.sorting) ? source.sorting : [];
  const sort = rawSort
    .filter(item => item && typeof item.key === 'string' && item.key)
    .map(item => ({ key: item.key, dir: item.dir === 'desc' || item.direction === 'desc' ? 'desc' : 'asc', ...(item.index ? { index: item.index } : {}) }));
  const rawFilters = source.filters ?? source.filter ?? { logic: 'and', rules: [] };
  return {
    version: GRID_QUERY_VERSION,
    search: { text: String(search.text ?? ''), column: String(search.column ?? '') },
    columnSearch: source.columnSearch && typeof source.columnSearch === 'object' ? { ...source.columnSearch } : {},
    filters: normalizeFilterTree(rawFilters),
    advanced: normalizeFilterTree(source.advanced ?? { logic: 'and', rules: [] }),
    sort,
    groupBy: Array.isArray(source.groupBy) ? source.groupBy.filter(Boolean).map(String) : (source.groupBy ? [String(source.groupBy)] : []),
    pagination: {
      mode: rawPaging.mode === 'offset' ? 'offset' : 'cursor',
      size,
      cursor: rawPaging.cursor ?? source.cursor ?? null,
      direction: rawPaging.direction === 'prev' ? 'prev' : 'next',
      page: Math.max(1, Number(rawPaging.page) || 1)
    }
  };
}

function normalizeFilterTree(value) {
  if (Array.isArray(value)) return { logic: 'and', rules: value.map(normalizeFilterNode).filter(Boolean) };
  if (!value || typeof value !== 'object') return { logic: 'and', rules: [] };
  const logic = String(value.logic || value.operator || 'and').toLowerCase() === 'or' ? 'or' : 'and';
  const children = Array.isArray(value.rules) ? value.rules : Array.isArray(value.children) ? value.children : [];
  return { logic, rules: children.map(normalizeFilterNode).filter(Boolean) };
}
function normalizeFilterNode(node) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node.rules) || Array.isArray(node.children)) return normalizeFilterTree(node);
  const key = String(node.key ?? node.field ?? '');
  const op = String(node.op ?? node.operator ?? '');
  const values = node.set instanceof Set ? [...node.set] : Array.isArray(node.set) ? node.set : null;
  if (!key || (!op && !values)) return null;
  return {
    key, op,
    v1: node.v1 ?? node.value ?? '',
    v2: node.v2 ?? node.valueTo ?? '',
    set: values,
    ...(node.valueType ? { valueType: node.valueType } : {})
  };
}

function testCondition(column, row, rule) {
  const type = rule.valueType || typeOf(column);
  const raw = valueOf(column, row);
  if (rule.set) {
    const rendered = displayOf(column, row) || '(فارغ)';
    if (!rule.set.includes(rendered)) return false;
  }
  const op = rule.op;
  if (!op) return true;
  if (type === 'number') {
    const x = numberFrom(raw), a = numberFrom(rule.v1), b = numberFrom(rule.v2);
    switch (op) {
      case 'eq': return x === a;
      case 'neq': return x !== a;
      case 'gt': return x > a;
      case 'gte': return x >= a;
      case 'lt': return x < a;
      case 'lte': return x <= a;
      case 'between': return x >= Math.min(a, b) && x <= Math.max(a, b);
      case 'empty': return isEmpty(raw) || Number.isNaN(x);
      case 'notEmpty': return !isEmpty(raw) && !Number.isNaN(x);
      default: return true;
    }
  }
  if (type === 'date') {
    const date = String(raw ?? '').slice(0, 10), a = String(rule.v1 ?? ''), b = String(rule.v2 ?? '');
    switch (op) {
      case 'eq': return date === a;
      case 'before': return Boolean(date) && date < a;
      case 'after': return Boolean(date) && date > a;
      case 'onOrBefore': return Boolean(date) && date <= a;
      case 'onOrAfter': return Boolean(date) && date >= a;
      case 'between': { const [min, max] = [a || '0000', b || '9999'].sort(); return Boolean(date) && date >= min && date <= max; }
      case 'today': return date === localDate();
      case 'yesterday': return date === addDays(localDate(), -1);
      case 'thisWeek': { const today = localDate(), dow = new Date(today + 'T00:00:00').getDay(), monday = addDays(today, dow === 0 ? -6 : 1 - dow); return Boolean(date) && date >= monday && date <= addDays(monday, 6); }
      case 'thisMonth': return Boolean(date) && date.slice(0, 7) === localDate().slice(0, 7);
      case 'thisYear': return Boolean(date) && date.slice(0, 4) === localDate().slice(0, 4);
      case 'empty': return !date;
      case 'notEmpty': return Boolean(date);
      default: return true;
    }
  }
  if (type === 'bool') {
    if (op === 'isTrue') return isTrue(raw);
    if (op === 'isFalse') return isFalse(raw);
    if (op === 'empty') return !isTrue(raw) && !isFalse(raw);
    return true;
  }
  const value = normalizeGridText(displayOf(column, row));
  const needle = normalizeGridText(rule.v1);
  const words = needle.split(' ').filter(Boolean);
  switch (op) {
    case 'contains': return value.includes(needle);
    case 'notContains': return !value.includes(needle);
    case 'eq': return value === needle;
    case 'neq': return value !== needle;
    case 'starts': return value.startsWith(needle);
    case 'ends': return value.endsWith(needle);
    case 'allWords': return words.length ? words.every(word => value.includes(word)) : true;
    case 'anyWord': return words.length ? words.some(word => value.includes(word)) : true;
    case 'empty': return !value;
    case 'notEmpty': return Boolean(value);
    default: return true;
  }
}

function testTree(row, tree, columnsByKey) {
  const rules = tree?.rules || [];
  if (!rules.length) return true;
  const values = rules.map(rule => {
    if (Array.isArray(rule?.rules)) return testTree(row, rule, columnsByKey);
    const column = columnsByKey.get(rule.key);
    return column ? testCondition(column, row, rule) : true;
  });
  return tree.logic === 'or' ? values.some(Boolean) : values.every(Boolean);
}

/** Returns whether one row satisfies the search and filter parts of a normalized query. */
export function matchesGridQuery(row, query, columns = []) {
  const q = query?.version === GRID_QUERY_VERSION ? query : createGridQuery(query);
  const byKey = columns instanceof Map ? columns : new Map((columns || []).map(column => [column.key, column]));
  const searchText = normalizeGridText(q.search.text);
  if (searchText) {
    const tokens = searchText.split(' ').filter(Boolean);
    const scoped = q.search.column ? [byKey.get(q.search.column)].filter(Boolean) : [...byKey.values()].filter(column => column.searchable !== false);
    if (tokens.length && !tokens.every(token => scoped.some(column => normalizeGridText(displayOf(column, row)).includes(token)))) return false;
  }
  for (const [key, text] of Object.entries(q.columnSearch || {})) {
    if (!text) continue;
    const column = byKey.get(key);
    if (column && !normalizeGridText(displayOf(column, row)).includes(normalizeGridText(text))) return false;
  }
  if (!testTree(row, q.filters, byKey) || !testTree(row, q.advanced, byKey)) return false;
  return true;
}

function compareValues(column, a, b) {
  const type = typeOf(column), x = valueOf(column, a), y = valueOf(column, b);
  const ex = isEmpty(x), ey = isEmpty(y);
  if (ex || ey) return ex && ey ? 0 : ex ? 1 : -1;
  if (type === 'number') return numberFrom(x) - numberFrom(y);
  if (type === 'date') return String(x).localeCompare(String(y));
  return displayOf(column, a).localeCompare(displayOf(column, b), 'ar', { numeric: true, sensitivity: 'base' });
}

/** Stable, multi-column sort; each key is read once per row before comparisons. */
export function sortGridRows(rows = [], sorting = [], columns = [], groupBy = []) {
  const byKey = columns instanceof Map ? columns : new Map((columns || []).map(column => [column.key, column]));
  const sort = [...(Array.isArray(groupBy) ? groupBy : groupBy ? [groupBy] : []).map(key => ({ key, dir: 'asc' })), ...(sorting || [])]
    .filter(item => item && byKey.has(item.key));
  if (!sort.length || rows.length < 2) return [...rows];
  const plan = sort.map(item => ({ column: byKey.get(item.key), direction: item.dir === 'desc' ? -1 : 1 }));
  return rows.map((row, index) => ({ row, index }))
    .sort((a, b) => {
      for (const item of plan) {
        const compared = compareValues(item.column, a.row, b.row) * item.direction;
        if (compared) return compared;
      }
      return a.index - b.index;
    })
    .map(item => item.row);
}

/** Apply the portable filter/search/sort query to a bounded in-memory collection. */
export function applyGridQuery(rows = [], query = {}, columns = []) {
  const q = query?.version === GRID_QUERY_VERSION ? query : createGridQuery(query);
  const filtered = (rows || []).filter(row => matchesGridQuery(row, q, columns));
  return sortGridRows(filtered, q.sort, columns, q.groupBy);
}

function localDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDays(date, amount) {
  const d = new Date(String(date) + 'T00:00:00');
  d.setDate(d.getDate() + amount);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export { numberFrom as gridNumberValue, displayOf as gridDisplayValue, valueOf as gridRawValue };
