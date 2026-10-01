// =====================================================================
// مركز العمل — عرض «القائمة»: يستخدم Universal DataGrid الموجود (لا جدول جديد) عبر مزوّد بيانات مؤشري.
// المزوّد يمرّ على محرك الاستعلام نفسه (فهارس + مؤشر + إلغاء)؛ مرشحات الجدول وبحثه تُطبَّق أثناء مرور المؤشر لا بعد تحميل الكل.
// أعمدة الملف/الموكل/الخصم من legalFileColumns + قارئ العلاقات الموحّد. الفرز غير الزمني للصفحة الحالية ويُعلن الجدول ذلك.
// =====================================================================
import {mountGrid} from './datagrid.js';
import {legalFileColumns, defineGridColumns} from './grid-columns.js';
import {createGridQuery, matchesGridQuery, sortGridRows} from '../core/grid-query.js';
import {formatDate} from '../core/format.js';
import {priorityInfo, statusInfo, WORK_RANGES} from '../domain/work-items.js';
import {queryWorkItems} from '../services/work-query.js';
import {actionsFor, runAction} from './work-actions.js';
import * as C from '../services/work-items.js';
import {toast} from './toast.js';
import {confirmBox} from './modal.js';

export function workColumns(rt) {
  const config = rt.config(), rel = rt.relations;
  return defineGridColumns([
    {key: 'title', label: 'العنوان', get: r => r.title, width: 280, minWidth: 160},
    {key: 'type', label: 'النوع', get: r => r.typeLabel || r.sourceLabel, width: 130},
    {key: 'dueDate', label: 'الموعد', type: 'date', get: r => r.dueDate, text: r => r.dueDate ? `${formatDate(r.dueDate)}${r.dueTime ? ' ' + r.dueTime : ''}` : 'بلا موعد', width: 140},
    {key: 'status', label: 'الحالة', get: r => `${statusInfo(r.status, config).icon} ${r.statusLabel}`, width: 120},
    {key: 'priority', label: 'الأولوية', get: r => { const p = priorityInfo(r.priority, config); return `${p.icon} ${p.label} (${p.mark})`; }, width: 140},
    {key: 'source', label: 'المصدر', get: r => r.sourceAvailable ? r.sourceLabel : `${r.sourceLabel} — المصدر غير متاح حاليًا`, width: 150},
    ...legalFileColumns(rel),
    {key: 'caseNo', label: 'رقم القضية', get: r => rel.officialNumber(r) || '', width: 130},
    {key: 'tags', label: 'الوسوم', get: r => (r.tags || []).map(t => `#${t}`).join(' '), width: 140},
    {key: 'postponeCount', label: 'مرات التأجيل', type: 'number', get: r => r.postponeCount || 0, width: 110},
    {key: 'pinned', label: 'مثبّت', type: 'bool', get: r => r.isPinned, text: r => r.isPinned ? 'نعم' : 'لا', width: 90}
  ]);
}

export function createWorkGridProvider(rt) {
  return {
    kind: 'workitems',
    capabilities: {cursor: true, queryFiltering: true, exactCount: false},
    async getRows(inputQuery = {}, {columns = [], signal} = {}) {
      const query = createGridQuery(inputQuery);
      await rt.relations.loadFilterLabels(query, columns);
      const filtered = Boolean(query.search.text || Object.keys(query.columnSearch).length || query.filters.rules.length || query.advanced.rules.length);
      const spec = rt.spec({undated: rt.st.range === 'all'});
      const page = await queryWorkItems(rt.office, spec, {cursor: query.pagination.cursor, limit: query.pagination.size, signal, relations: rt.relations,
        predicate: filtered ? item => matchesGridQuery(item, query, columns) : null});
      if (!filtered) await rt.relations.hydrate(page.items, {signal});
      const timeSort = query.sort.length === 1 && query.sort[0].key === 'dueDate' && query.sort[0].dir === 'asc';
      const rows = query.sort.length || query.groupBy.length ? sortGridRows(page.items, query.sort, columns, query.groupBy) : page.items;
      rows.forEach(r => rt.register(r));
      return {rows, nextCursor: page.nextCursor, hasMore: page.hasMore, total: null, totalExact: false, page: query.pagination.page, pageSize: query.pagination.size,
        sortStatus: query.sort.length ? {requested: query.sort, global: timeSort} : null};
    }
  };
}

export async function renderListView(rt) {
  const {host, st} = rt;
  host.innerHTML = '<div id="wc-grid" class="wc-grid" data-uxc-id="wc:list" data-uxc-type="component" data-uxc-title="قائمة مركز العمل"></div>';
  const columns = workColumns(rt);
  const rangeLabel = WORK_RANGES.find(([k]) => k === st.range)?.[1] || '';
  const bulk = async (id, rows) => {
    if (id === 'open') return rt.openItem(rows[0]?.id);
    if (id === 'archive' && !(await confirmBox(`أرشفة ${rows.length} عنصرًا؟ الأرشفة قابلة للاستعادة ولا تحذف أي سجل أصلي.`, {okText: 'أرشفة'}))) return;
    if (id === 'postpone-tomorrow') {
      const hearingsSkipped = rows.filter(r => r.sourceType === 'hearings').length;
      rows = rows.filter(r => r.sourceType !== 'hearings');
      const out = await C.bulkApply(rt.office, rows, 'postpone', {option: 'tomorrow'});
      toast(`تم تأجيل ${out.done.length}${out.failed.length ? ` — تعذّر ${out.failed.length}` : ''}${hearingsSkipped ? ` — تُرك ${hearingsSkipped} جلسة (تُؤجَّل رسميًا في سجلها)` : ''}`, out.failed.length ? 'warn' : 'ok');
    } else {
      const out = await C.bulkApply(rt.office, rows, id);
      toast(`تم تنفيذ ${out.done.length}${out.failed.length ? ` — تعذّر ${out.failed.length}: ${out.failed[0].message}` : ''}`, out.failed.length ? 'warn' : 'ok');
    }
    await rt.onChanged({action: 'bulk'});
  };
  mountGrid(host.querySelector('#wc-grid'), {
    columns, rows: [], dataProvider: createWorkGridProvider(rt), pageSize: st.pageSize, title: `مركز العمل — ${rangeLabel}`,
    storageKey: 'wc:list', collapseKey: 'wc:list:grid', selectable: true, emptyText: 'لا عناصر مطابقة.', exportName: 'مركز-العمل',
    getRowId: r => r.id, onRowClick: r => rt.openItem(r.id),
    prepareQuery: (query, {columns: cols}) => rt.relations.loadFilterLabels(query, cols),
    rowMenu: row => actionsFor(row).map(a => ({id: a.key, label: a.label, danger: a.danger})),
    onRowAction: (id, row) => runAction(rt.wc, row, id),
    bulkActions: [{id: 'complete', label: 'إنجاز المحدد'}, {id: 'postpone-tomorrow', label: 'تأجيل المحدد إلى غدًا'}, {id: 'pin', label: 'تثبيت'}, {id: 'archive', label: 'أرشفة'}],
    onBulk: bulk,
    ...rt.relations.gridOptions(() => ({filters: [`الفترة: ${rangeLabel}`]}))
  });
}
