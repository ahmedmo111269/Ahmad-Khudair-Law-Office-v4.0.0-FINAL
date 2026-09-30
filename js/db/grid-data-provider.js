// IndexedDB adapter for the domain-neutral grid query contract.
// It keeps only one page in memory; filters are evaluated while the cursor streams rows.
import { createGridQuery, matchesGridQuery, sortGridRows } from '../core/grid-query.js';

export function createIndexedDbDataProvider(repository, {
  resolveScope = () => ({}),
  indexForSort = (sort, column) => column?.index || sort?.index || sort?.key || null,
  countProvider = null
} = {}) {
  if (!repository?.page || !repository?.ctx?.db) throw new TypeError('An IndexedDB repository with page() is required.');

  const indexNames = () => {
    repository.ctx.assert();
    const tx = repository.ctx.db.transaction(repository.store, 'readonly');
    return [...tx.objectStore(repository.store).indexNames];
  };

  return {
    kind: 'indexeddb',
    capabilities: { cursor: true, queryFiltering: true, exactCount: Boolean(countProvider) },

    async getRows(inputQuery = {}, { columns = [], signal } = {}) {
      repository.ctx.assert();
      if (signal?.aborted) throw abortError();
      const query = createGridQuery(inputQuery);
      const scope = await resolveScope(query, { columns, signal }) || {};
      if (signal?.aborted) throw abortError();

      const availableIndexes = new Set(indexNames());
      const sort = query.sort[0] || null;
      const sortColumn = sort && columns.find(column => column.key === sort.key);
      const sortIndex = sort ? indexForSort(sort, sortColumn, query, availableIndexes) : null;
      const usableSortIndex = sortIndex && availableIndexes.has(sortIndex) ? sortIndex : null;
      const scopeIndex = scope.index && availableIndexes.has(scope.index) ? scope.index : null;
      const hasScopeRange = scope.key !== undefined || scope.lower !== undefined || scope.upper !== undefined;

      // An explicit date/key range takes priority, because it substantially narrows
      // the cursor walk. A requested sort uses its IndexedDB index when no range is
      // active; otherwise the response reports that ordering is page-local.
      let index = hasScopeRange
        ? (scopeIndex || (scope.key !== undefined && !scope.index ? null : usableSortIndex || null))
        : (usableSortIndex || scopeIndex || null);
      const useIndexedScopeRange=Boolean(scopeIndex&&index===scopeIndex);
      const usePrimaryScopeKey=Boolean(scope.key!==undefined&&!scope.index&&index===null);
      let direction = scope.direction === 'prev' ? 'prev' : 'next';
      if ((!hasScopeRange||!useIndexedScopeRange) && usableSortIndex && index===usableSortIndex) direction = sort.dir === 'desc' ? 'prev' : 'next';
      else if (!hasScopeRange && !usableSortIndex && !scope.direction) direction = 'prev';

      const queryFilter = row => matchesGridQuery(row, query, columns);
      const scopeFilter = typeof scope.filter === 'function' ? scope.filter : null;
      const result = await repository.page({
        index,
        key: useIndexedScopeRange||usePrimaryScopeKey ? scope.key : undefined,
        lower: useIndexedScopeRange ? scope.lower : undefined,
        upper: useIndexedScopeRange ? scope.upper : undefined,
        lowerOpen: Boolean(scope.lowerOpen),
        upperOpen: Boolean(scope.upperOpen),
        cursor: query.pagination.cursor,
        limit: query.pagination.size,
        direction,
        signal,
        filter: row => queryFilter(row) && (!scopeFilter || scopeFilter(row))
      });
      if (signal?.aborted) throw abortError();

      const rows = query.sort.length ? sortGridRows(result.items, query.sort, columns) : result.items;
      const orderedByRequestedSort = Boolean(sort && usableSortIndex && index === usableSortIndex && query.sort.length === 1);
      return {
        rows,
        nextCursor: result.nextCursor,
        prevCursor: result.prevCursor || null,
        hasMore: result.hasMore,
        total: null,
        totalExact: false,
        sortStatus: query.sort.length
          ? { global: orderedByRequestedSort, indexed: Boolean(usableSortIndex), keys: query.sort.length }
          : { global: true, indexed: true, keys: 0 },
        page: query.pagination.page,
        pageSize: query.pagination.size
      };
    },

    async getCount(inputQuery = {}, { columns = [], signal } = {}) {
      if (typeof countProvider !== 'function') return { value: null, exact: false };
      if (signal?.aborted) throw abortError();
      const query = createGridQuery(inputQuery);
      const scope = await resolveScope(query, { columns, signal }) || {};
      const value = await countProvider(query, { columns, scope, repository, signal });
      return { value: Number.isFinite(Number(value)) ? Number(value) : null, exact: Number.isFinite(Number(value)) };
    },

    getIndexNames: indexNames
  };
}

function abortError() {
  return new DOMException('The grid query was superseded.', 'AbortError');
}
