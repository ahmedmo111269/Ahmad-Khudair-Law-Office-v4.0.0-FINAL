// Portable PrintContext contract for the existing Universal DataGrid. Context is
// separate from row data and from saved table preferences. Resolution of IDs to
// original records belongs to the caller's read adapter, never to DOM scraping.
import {formatDateTime,formatDate} from './format.js';
import {GRID_FILTER_OPERATORS} from './grid-query.js';

export function createPrintContext(value = {}, {tableTitle = 'تقرير', query, columns = [], date = new Date()} = {}) {
  const context = value && typeof value === 'object' ? value : {};
  const clients = (Array.isArray(context.clients) ? context.clients : context.client ? [context.client] : [])
    .filter(client => client?.id && client.name).map(client => ({id: String(client.id), name: String(client.name)}));
  const uniqueClients = [...new Map(clients.map(client => [client.id, client])).values()];
  const printedAt = context.date instanceof Date ? context.date : context.date ? new Date(context.date) : date;
  return {
    tableTitle: String(context.tableTitle || tableTitle || 'تقرير'),
    clients: uniqueClients,
    client: uniqueClients.length === 1 ? uniqueClients[0] : null,
    legalFile: context.legalFile?.id && context.legalFile.label ? {id: String(context.legalFile.id), label: String(context.legalFile.label)} : null,
    caseNumber: String(context.caseNumber || ''),
    filters: [...(Array.isArray(context.filters) ? context.filters.filter(Boolean).map(String) : []), ...describeGridFilters(query, columns)],
    filtered: Boolean(context.filtered),
    date: printedAt,
    dateLabel: formatDateTime(printedAt),
    omitContextClientColumn: Boolean(context.omitContextClientColumn)
  };
}

export function describeGridFilters(query, columns = []) {
  if (!query) return [];
  const byKey = new Map(columns.map(column => [column.key, column]));
  const value = (column, raw, reference) => reference ? column.referenceLabel?.(raw) || String(raw) : column.type === 'date' ? formatDate(raw) : String(raw ?? '');
  const ruleText = rule => {
    if (rule.rules) return treeText(rule);
    const column = byKey.get(rule.key);
    if (!column) return '';
    const reference = rule.valueType === 'reference';
    const set = rule.set ? rule.set.map(raw => value(column, raw, reference || rule.setValueType === 'reference')).join('، ') : '';
    const operation = (GRID_FILTER_OPERATORS[column.type] || GRID_FILTER_OPERATORS.text).find(([op]) => op === rule.op)?.[1] || rule.op || '';
    const condition = rule.op ? [operation, value(column, rule.v1, reference), rule.v2 ? value(column, rule.v2, reference) : ''].filter(Boolean).join(' ') : '';
    return `${column.label || column.title || rule.key}: ${[set, condition].filter(Boolean).join(' / ')}`;
  };
  const treeText = tree => {
    const parts = (tree?.rules || []).map(ruleText).filter(Boolean);
    return parts.length > 1 ? `(${parts.join(tree.logic === 'or' ? ' أو ' : ' و ')})` : parts[0] || '';
  };
  const summary = [];
  if (query.search?.text) summary.push(`بحث${query.search.column ? ' في ' + (byKey.get(query.search.column)?.label || query.search.column) : ''}: ${query.search.text}`);
  for (const [key, text] of Object.entries(query.columnSearch || {})) if (text && byKey.has(key)) summary.push(`بحث ${byKey.get(key).label}: ${text}`);
  for (const tree of [query.filters, query.advanced]) { const text = treeText(tree); if (text) summary.push(`تصفية: ${text}`); }
  if (query.groupBy?.length) summary.push(`تجميع: ${query.groupBy.map(key => byKey.get(key)?.label || key).join('، ')}`);
  return summary;
}

/** Screen visibility is untouched. Omit a print column only when its entire
 * value is already represented by the ID-resolved context, for every row. */
export function printColumns(columns, rows, context) {
  if (!context.omitContextClientColumn || !context.clients.length || !rows.length) return columns;
  const ids = context.clients.map(client => client.id).sort();
  const names = context.clients.map(client => client.name).sort();
  const kept = columns.filter(column => {
    if (!column.printOmitWhenContext || typeof column.references !== 'function') return true;
    const redundant = rows.every(row => {
      const refs = column.references(row);
      const rowIds = [...new Set(refs.map(ref => String(ref.id)))].sort();
      const rowNames = column.items ? column.items(row).map(item => item.text).sort() : [column.text(row)];
      return JSON.stringify(rowIds) === JSON.stringify(ids) && JSON.stringify(rowNames) === JSON.stringify(names);
    });
    return !redundant;
  });
  // A user who selected only the client column must still get a usable table.
  return kept.length ? kept : columns;
}
