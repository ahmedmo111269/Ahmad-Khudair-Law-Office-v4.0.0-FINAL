// In-memory provider for already-bounded feature datasets, previews, and tests.
// Large IndexedDB-backed lists should use js/db/grid-data-provider.js instead.
import { applyGridQuery, createGridQuery } from '../core/grid-query.js';

export function createArrayDataProvider(initialRows = [], { getRowId = row => row?.id } = {}) {
  let source = Array.isArray(initialRows) ? initialRows : [];
  return {
    kind: 'array',
    capabilities: { cursor: true, queryFiltering: true, exactCount: true, multiSort: true },
    setRows(rows = []) { source = Array.isArray(rows) ? rows : []; },
    async getRows(inputQuery = {}, { columns = [], signal } = {}) {
      if (signal?.aborted) throw new DOMException('The grid query was superseded.', 'AbortError');
      const query = createGridQuery(inputQuery);
      const matched = applyGridQuery(source, query, columns);
      const pageSize = query.pagination.size;
      const cursor = query.pagination.cursor;
      const offset = decodeOffset(cursor, source, getRowId, matched);
      const rows = matched.slice(offset, offset + pageSize);
      const nextOffset = offset + rows.length;
      return {
        rows,
        total: matched.length,
        totalExact: true,
        hasMore: nextOffset < matched.length,
        nextCursor: nextOffset < matched.length ? encodeOffset(nextOffset) : null,
        prevCursor: offset > 0 ? encodeOffset(Math.max(0, offset - pageSize)) : null,
        page: query.pagination.page,
        pageSize
      };
    },
    async getCount(inputQuery = {}, { columns = [] } = {}) {
      const query = createGridQuery({ ...inputQuery, pagination: { ...inputQuery.pagination, cursor: null } });
      return { value: applyGridQuery(source, query, columns).length, exact: true };
    },
    get source() { return source; }
  };
}

function encodeOffset(offset) { return `array:${Math.max(0, Number(offset) || 0)}`; }
function decodeOffset(cursor, source, getRowId, matched) {
  if (typeof cursor === 'string' && cursor.startsWith('array:')) return Math.max(0, Number(cursor.slice(6)) || 0);
  if (cursor && typeof cursor === 'object' && cursor.afterId != null) {
    const index = matched.findIndex(row => String(getRowId(row)) === String(cursor.afterId));
    return index < 0 ? 0 : index + 1;
  }
  return 0;
}
