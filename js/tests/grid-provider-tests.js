import { createGridQuery, applyGridQuery } from '../core/grid-query.js';
import { createArrayDataProvider } from '../ui/grid-data-provider.js';
import { createIndexedDbDataProvider } from '../db/grid-data-provider.js';
import { DatabaseContext } from '../db/database-context.js';
import { Repository } from '../db/repository.js';
import { mountGrid } from '../ui/datagrid.js';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(root, predicate, message) {
  for (let i = 0; i < 80; i++) {
    if (predicate()) return;
    await pause(5);
  }
  throw new Error(message || 'Timed out waiting for the grid.');
}
function openGridDB(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore('cases', { keyPath: 'id' });
      store.createIndex('filingDate', 'filingDate');
      store.createIndex('title', 'title');
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}
function putRows(db, rows) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('cases', 'readwrite');
    const store = tx.objectStore('cases');
    rows.forEach(row => store.put(row));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('IndexedDB write aborted.'));
  });
}

export async function runGridProviderTests(test, expect) {
  test('Query Model: nested AND/OR groups, Arabic digits, and typed sorting', () => {
    const rows = [
      { id: 'a', year: 2026, title: 'أحمد — عقد', type: 'مدني' },
      { id: 'b', year: 2025, title: 'أحمد — طلب', type: 'مدني' },
      { id: 'c', year: 2024, title: 'خالد — محضر', type: 'جنائي' },
      { id: 'd', year: 2026, title: 'علي — دعوى', type: 'مدني' }
    ];
    const columns = [
      { key: 'year', type: 'number' },
      { key: 'title' },
      { key: 'type' }
    ];
    const query = createGridQuery({
      filters: { logic: 'or', rules: [
        { logic: 'and', rules: [
          { key: 'year', op: 'eq', v1: '٢٠٢٦' },
          { key: 'title', op: 'contains', v1: 'احمد' }
        ] },
        { logic: 'and', rules: [{ key: 'type', op: 'contains', v1: 'جنائي' }] }
      ] },
      sort: [{ key: 'year', dir: 'desc' }]
    });
    const result = applyGridQuery(rows, query, columns);
    expect(result.length).toBe(2);
    expect(result[0].id).toBe('a');
    expect(result[1].id).toBe('c');
  });

  test('Array provider: page-size boundaries, cursor continuation, and exact count', async () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({ id: `r-${i}`, title: `سجل ${i}` }));
    const provider = createArrayDataProvider(rows);
    const first = await provider.getRows({ pagination: { size: 25 } }, { columns: [{ key: 'title' }] });
    const second = await provider.getRows({ pagination: { size: 25, cursor: first.nextCursor, page: 2 } }, { columns: [{ key: 'title' }] });
    const count = await provider.getCount({}, { columns: [{ key: 'title' }] });
    expect(first.rows.length).toBe(25);
    expect(first.hasMore).toBe(true);
    expect(second.rows[0].id).toBe('r-25');
    expect(second.rows.length).toBe(25);
    expect(count.value).toBe(60);
    expect(count.exact).toBe(true);
  });

  test('IndexedDB provider: indexed range, stable cursor pages, and query filtering', async () => {
    const name = `AhmadKhudairLawOfficeDB__test__grid__${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const db = await openGridDB(name);
    const context = new DatabaseContext(db, { id: 'grid-test' });
    const repository = new Repository(context, 'cases');
    try {
      const rows = Array.from({ length: 30 }, (_, i) => ({
        id: `case-${String(i + 1).padStart(2, '0')}`,
        filingDate: `2026-09-${String(i + 1).padStart(2, '0')}`,
        title: `قضية ${i + 1}`
      }));
      rows.push(
        { id: 'outside-before', filingDate: '2026-08-31', title: 'خارج النطاق' },
        { id: 'outside-after', filingDate: '2026-10-01', title: 'خارج النطاق' },
        { id: 'deleted-row', filingDate: '2026-09-15', title: 'قضية محذوفة منطقيًا', isDeleted: true }
      );
      await putRows(db, rows);

      const provider = createIndexedDbDataProvider(repository, {
        resolveScope: () => ({ index: 'filingDate', lower: '2026-09-01', upper: '2026-09-30\uffff', direction: 'prev' })
      });
      const columns = [
        { key: 'filingDate', type: 'date', index: 'filingDate' },
        { key: 'title', type: 'text', index: 'title' }
      ];
      const query = { sort: [{ key: 'filingDate', dir: 'desc' }], pagination: { size: 25 } };
      const first = await provider.getRows(query, { columns });
      const second = await provider.getRows({ ...query, pagination: { size: 25, cursor: first.nextCursor, page: 2 } }, { columns });
      const search = await provider.getRows({ search: { text: 'قضية 2', column: 'title' }, pagination: { size: 25 } }, { columns });
      const unindexedProvider = createIndexedDbDataProvider(repository, {
        resolveScope: () => ({ index: 'missingDateIndex', lower: '2026-09-20', upper: '2026-09-30', filter: row => row.filingDate >= '2026-09-20' && row.filingDate <= '2026-09-30' })
      });
      const unindexedRange = await unindexedProvider.getRows({ sort: [{ key: 'title', dir: 'asc' }], pagination: { size: 25 } }, { columns });
      const controller = new AbortController();
      const cancelledPage = repository.page({ index: 'filingDate', limit: 25, signal: controller.signal });
      controller.abort();
      let abortName = '';
      try { await cancelledPage; } catch (error) { abortName = error?.name || ''; }

      test('IndexedDB cursor pages stay within the indexed range without duplicates', () => {
        const ids = [...first.rows, ...second.rows].map(row => row.id);
        expect(first.rows.length).toBe(25);
        expect(first.hasMore).toBe(true);
        expect(second.rows.length).toBe(5);
        expect(second.hasMore).toBe(false);
        expect(new Set(ids).size).toBe(30);
        expect(ids.includes('outside-before')).toBe(false);
        expect(ids.includes('outside-after')).toBe(false);
        expect(ids.includes('deleted-row')).toBe(false);
        expect(first.rows[0].filingDate).toBe('2026-09-30');
        expect(second.rows.at(-1).filingDate).toBe('2026-09-01');
      });
      test('Unindexed date scopes fall back to a row filter without keying the range to record IDs', () => {
        expect(unindexedRange.rows.length).toBe(11);
        expect(unindexedRange.rows.every(row => row.filingDate >= '2026-09-20')).toBe(true);
      });
      test('Repository cancels an active cursor when its query is superseded', () => {
        expect(abortName).toBe('AbortError');
      });
      test('IndexedDB provider applies portable text search while streaming rows', () => {
        expect(search.rows.length).toBe(12);
        expect(search.rows.every(row => row.title.includes('قضية') && row.title.includes('2'))).toBe(true);
        expect(search.totalExact).toBe(false);
        expect(search.total).toBe(null);
      });
    } finally {
      context.close();
      try { indexedDB.deleteDatabase(name); } catch {}
    }
  });

  test('DataGrid remote mode: stable selection, next/previous, page size, and filter reset', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const rows = Array.from({ length: 60 }, (_, i) => ({ id: `row-${i}`, title: `سجل ${i}` }));
    const provider = createArrayDataProvider(rows);
    const grid = mountGrid(root, {
      provider,
      storageKey: '',
      selectable: true,
      columns: [{ key: 'title', label: 'العنوان' }]
    });
    try {
      await waitFor(root, () => grid.getQuery().pagination.page===1 && !root.querySelector('.dg-state')?.classList.contains('is-loading'));
      expect(root.querySelectorAll('tbody tr[data-i]').length).toBe(25);
      expect(root.querySelector('.dg-page-next').disabled).toBe(false);
      root.querySelector('.dg-rowchk[data-i="0"]').click();
      expect(grid.getSelection().length).toBe(1);
      expect(grid.getSelection()[0].id).toBe('row-0');

      root.querySelector('.dg-page-next').click();
      await waitFor(root, () => grid.getQuery().pagination.page===2 && !root.querySelector('.dg-state')?.classList.contains('is-loading'));
      expect(root.querySelectorAll('tbody tr[data-i]').length).toBe(25);
      expect(grid.getSelection().length).toBe(1);
      root.querySelector('.dg-page-prev').click();
      await waitFor(root, () => grid.getQuery().pagination.page===1 && !root.querySelector('.dg-state')?.classList.contains('is-loading'));

      const size = root.querySelector('.dg-page-size');
      size.value = '50';
      size.dispatchEvent(new Event('change', { bubbles: true }));
      await waitFor(root, () => root.querySelectorAll('tbody tr[data-i]').length === 50 && !root.querySelector('.dg-state')?.classList.contains('is-loading'));
      expect(grid.getQuery().pagination.page===1).toBe(true);

      grid.setColSearch('title', 'سجل 5');
      await waitFor(root, () => root.querySelectorAll('tbody tr[data-i]').length === 11 && !root.querySelector('.dg-state')?.classList.contains('is-loading'));
      expect(grid.getQuery().pagination.page===1).toBe(true);
      expect(root.querySelector('.dg-page-next').disabled).toBe(true);
      expect(grid.getSelection().length).toBe(1);
    } finally {
      root.remove();
    }
  });

  test('DataGrid does not infer totals from numeric/year columns', () => {
    const root = document.createElement('div');
    document.body.append(root);
    mountGrid(root, {
      rows: [{ id: 'a', caseYear: 2026 }, { id: 'b', caseYear: 2025 }],
      storageKey: '',
      columns: [{ key: 'caseYear', label: 'سنة القضية', type: 'number' }]
    });
    expect(root.querySelector('tfoot').textContent).toBe('');
    root.remove();
  });
}
