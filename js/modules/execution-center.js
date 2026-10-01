// =====================================================================
// مركز التنفيذ — قسم متكامل للتنفيذ المدني والجزائي والأسرة داخل النظام القائم.
// ---------------------------------------------------------------------
// • كل رقم معروض يأتي من خدمة تطبيقية أو محرك حساب؛ لا حقول رصيد قابلة للتحرير.
// • كل أزرار الإجراءات تفتح نوافذ تستدعي الخدمات (الكتابة تمر عبر Application Services).
// • الجدول الرئيسي يعمل بترقيم مؤشر (cursor) مع هيدرة صف الصفحة فقط.
// • الأقسام الكبيرة مطوية افتراضيًا وتخضع لنظام الأقسام والطي والتخصيص القائم.
// =====================================================================
import {esc} from '../ui/dom.js';
import {toast} from '../ui/toast.js';
import {mountGrid} from '../ui/datagrid.js';
import {createIndexedDbDataProvider} from '../db/grid-data-provider.js';
import {registerPageLayout, openPageCustomizer} from '../ui/page-layout.js';
import {prefs} from '../core/preferences.js';
import {formatFileNumber} from '../core/file-number.js';
import {localDate} from '../core/clock.js';
import {executionTypeLabel, executionStatusLabel, money, num, round2, EXECUTION_TYPE_LABELS, EXECUTION_STATUSES, EXECUTION_STATUS_LABELS, LEDGER_TYPE_LABELS, POA_STATUS_LABELS, DIFFERENCE_STATUS_LABELS, ACTION_KIND_LABELS, ALLOCATION_METHOD_LABELS, PRORATION_LABELS, valueTypeLabel, periodicityLabel} from '../domain/execution.js';
import {executionCenterStats, executionBundle, executionActionRows, executionPoaRows, executionJudgments, executionSlices, createResultFile, listExecutionRows, refreshExecutionSearchText} from '../services/execution.js';
import * as L from '../services/execution-ledger.js';
import * as DF from '../services/execution-differences.js';
import * as POA from '../services/execution-poa.js';
import * as B from '../services/execution-balance.js';
import * as PR from '../services/execution-print.js';
import * as EX from '../services/execution.js';
import {
  executionDialog, partyDialog, judgmentDialog, sliceDialog, collectionDialog, expenseDialog,
  ledgerCorrectDialog, reallocateDialog, settlementReviewDialog, poaDialog, actionDialog,
  snapshotDialog, simulatorDialog, comparisonDialog, printBalanceDialog
} from '../ui/execution-forms.js';
import {userError} from '../core/errors.js';
import {rowText, normQ} from '../services/entity-query.js';

const KPI_KEY = 'ui:exec-center:kpi';
const TYPE_KEY = 'ui:exec-center:type';
const STATUS_KEY = 'ui:exec-center:status';
const Q_KEY = 'ui:exec-center:q';

const KPIS = [
  {key: 'all', label: 'كل التنفيذات', hint: 'بلا تصفية'},
  {key: 'civil', label: 'تنفيذ مدني', hint: 'حسب نوع التنفيذ المسجل'},
  {key: 'criminal', label: 'تنفيذ جزائي', hint: 'حسب نوع التنفيذ المسجل'},
  {key: 'family', label: 'تنفيذ أسرة', hint: 'حسب نوع التنفيذ المسجل'},
  {key: 'partialCollection', label: 'تحصيل جزئي', hint: 'محصل مع رصيد متبقٍ'},
  {key: 'differencesUnpaid', label: 'فروق أحكام غير مسددة', hint: 'فروق معتمدة أو تنتظر المراجعة مع رصيد متبقٍ'},
  {key: 'settlementsReview', label: 'تسويات تنتظر المراجعة', hint: 'فروق لم يُبتّ فيها بعد'},
  {key: 'needsFollowUp', label: 'يحتاج انتباهي', hint: 'تاريخ مراجعة مستحق أو سجل مُعلَّم للمراجعة'},
  {key: 'reviewOverdue', label: 'مراجعة متأخرة', hint: 'تاريخ المراجعة المسجل سابق لليوم'},
  {key: 'withoutValue', label: 'بلا قيمة مسجلة', hint: 'لا توجد شرائح قيمة بعد'},
  {key: 'negativeBalance', label: 'رصيد سالب', hint: 'محصل يزيد على الاستحقاق المسجل'},
  {key: 'completed', label: 'مكتمل السداد', hint: 'لا رصيد متبقٍ مع استحقاق مسجل'}
];
const KPI_BY_KEY = new Map(KPIS.map(kpi => [kpi.key, kpi]));

const kpiPredicate = (key, row) => {
  const summary = row.summary || {};
  const balance = num(row.balance);
  const collected = num(row.collected);
  const finalEntitlement = num(summary.finalEntitlement);
  const pending = num(summary.differences?.pending);
  const approved = num(summary.differences?.approved);
  const today = localDate();
  switch (key) {
    case 'civil': case 'criminal': case 'family': return String(row.executionType || '') === key;
    case 'partialCollection': return collected > 0 && balance > 0.005;
    case 'differencesUnpaid': return (approved + pending) > 0 && balance > 0.005;
    case 'settlementsReview': return pending > 0;
    case 'needsFollowUp': return Boolean(row.needsReview) || Boolean(row.lastReviewDate && row.lastReviewDate <= today);
    case 'reviewOverdue': return Boolean(row.lastReviewDate && row.lastReviewDate < today);
    case 'withoutValue': return finalEntitlement <= 0.005;
    case 'negativeBalance': return balance < -0.005;
    case 'completed': return finalEntitlement > 0 && balance <= 0.005;
    default: return true;
  }
};

const state = app => (app.__execCenter = app.__execCenter || {
  kpi: prefs.get(KPI_KEY, 'all'), type: prefs.get(TYPE_KEY, ''), status: prefs.get(STATUS_KEY, ''), q: prefs.get(Q_KEY, ''), rows: [], stats: null, bundle: null
});

// ===== الأعمدة العامة لمركز التنفيذ (قسم لا يدمج رقم الملف والموكل والخصم في خلية واحدة) =====
export const EXECUTION_LIST_COLUMNS = Object.freeze([
  {key: 'internalNumber', label: 'رقم التنفيذ', width: 140, get: row => row.internalNumber || row.officialNumber, text: row => row.internalNumber || row.officialNumber || '—'},
  {key: 'clientName', label: 'الموكل', width: 180, get: row => row.clientName, text: row => row.clientName || '—'},
  {key: 'fileNumber', label: 'رقم الملف', width: 120, get: row => row.fileNumber ? formatFileNumber(row.fileNumber) : '', text: row => row.fileNumber ? formatFileNumber(row.fileNumber) : '—'},
  {key: 'executionTypeLabel', label: 'نوع التنفيذ', width: 110, get: row => row.executionTypeLabel, text: row => row.executionTypeLabel},
  {key: 'judgmentLabel', label: 'الحكم / السلسلة', width: 190, get: row => row.judgmentLabel, text: row => row.judgmentLabel ? `${row.judgmentLabel}${row.judgmentsCount > 1 ? ` (+${row.judgmentsCount - 1})` : ''}` : '—'},
  {key: 'currentValue', label: 'القيمة الحالية', type: 'number', width: 130, get: row => num(row.currentValue), text: row => row.currentValue ? `${money(row.currentValue)}${row.currentValueType ? ` · ${row.currentValueType}` : ''}` : '—'},
  {key: 'lastPeriod', label: 'آخر فترة', width: 170, get: row => row.lastPeriod, text: row => row.lastPeriod || '—'},
  {key: 'collected', label: 'المحصل', type: 'number', width: 120, get: row => num(row.collected), text: row => money(row.collected)},
  {key: 'balance', label: 'المتبقي', type: 'number', width: 120, get: row => num(row.balance), text: row => money(row.balance)},
  {key: 'judgmentDifference', label: 'فرق الحكم', type: 'number', width: 110, get: row => num(row.judgmentDifference), text: row => money(row.judgmentDifference)},
  {key: 'lastPoa', label: 'آخر توكيل', width: 130, get: row => row.lastPoa, text: row => row.lastPoa || '—'},
  {key: 'lastReceipt', label: 'آخر محضر', width: 130, get: row => row.lastReceipt, text: row => row.lastReceipt || '—'},
  {key: 'statusLabel', label: 'الحالة', width: 110, get: row => row.statusLabel, text: row => row.statusLabel},
  {key: 'authority', label: 'جهة التنفيذ', width: 150, get: row => row.authority, text: row => row.authority || '—'},
  {key: 'openedDate', label: 'تاريخ الفتح', type: 'date', width: 110, get: row => row.openedDate, text: row => row.openedDate || '—'},
  {key: 'lastAction', label: 'آخر إجراء', width: 170, get: row => row.lastAction, text: row => row.lastAction || '—'}
]);

function actionButtons(execution) {
  return `<div class="exec-row-actions">
    <button type="button" class="ghost small" data-open-exec="${esc(execution.id)}">فتح البطاقة</button>
    ${execution.fileId ? `<button type="button" class="ghost small" data-open-file="${esc(execution.fileId)}">الملف</button>` : ''}
    ${execution.clientId ? `<button type="button" class="ghost small" data-open-client="${esc(execution.clientId)}">الموكل</button>` : ''}
  </div>`;
}

// ===== صفحة مركز التنفيذ =====
export function executionCenterPage(app) {
  registerPageLayout({
    pageId: 'executionCenter', title: 'مركز التنفيذ',
    sections: [
      {id: 'kpis', title: 'مؤشرات التنفيذ'},
      {id: 'attention', title: 'يحتاج انتباهي'},
      {id: 'filters', title: 'بحث وتصفية'},
      {id: 'grid', title: 'جدول التنفيذات', canHide: false},
      {id: 'settlements', title: 'تسويات وفروق تنتظر قرارًا'}
    ]
  });
  const st = state(app);
  return `<div class="page-head exec-head"><div><h2>مركز التنفيذ</h2>
  <p class="muted small">التنفيذ المدني والجزائي والأسرة في مكان واحد: سلسلة الأحكام، فترات القيمة، التحصيل والتخصيص، الفروق، التوكيلات، والرصيد المفكَّك. كل رقم يفتح مصدره. المؤشرات والقوائم هنا تنظيمية للمكتب ولا تُعد وصفًا قانونيًا.</p></div>
  <div class="head-actions">
    <button class="ghost" data-customize-page title="ترتيب الأقسام وإظهارها">⚙ تخصيص الصفحة</button>
    <button class="ghost" data-exec-refresh>تحديث</button>
    <button class="primary" data-exec-new>+ تنفيذ جديد</button>
  </div></div>
  <section class="panel exec-kpi-panel" data-section-id="kpis" data-collapse-id="exec-kpis" data-collapse-default="open">
    <div class="panel-head"><h3>مؤشرات التنفيذ</h3><span class="badge" data-kpi-scope>${esc((KPI_BY_KEY.get(st.kpi) || KPIS[0]).label)}</span></div>
    <div class="exec-kpis" data-kpi-list><div class="muted small">جارٍ حساب المؤشرات…</div></div>
    <p class="muted small" data-kpi-note>المؤشرات محسوبة على عيّنة معلنة من أحدث التنفيذات، وكل مؤشر يفتح قائمة مفلترة قابلة للتصفح الكامل.</p>
  </section>
  <section class="panel" data-section-id="attention" data-collapse-id="exec-attention" data-collapse-default="open">
    <div class="panel-head"><h3>يحتاج انتباهي</h3><span class="badge" data-attention-count>…</span></div>
    <p class="muted small">تنبيهات تنظيمية مبنية على بيانات المكتب (مواعيد مراجعة، تحصيل بلا تخصيص، فروق تنتظر قرارًا، توكيلات منتهية) — ليست وصفًا لمخالفة ولا حكمًا باستحقاق.</p>
    <div data-attention-list></div>
  </section>
  <section class="panel" data-section-id="filters" data-collapse-id="exec-filters" data-collapse-default="collapsed">
    <div class="panel-head"><h3>بحث وتصفية</h3><span class="badge" data-exec-filter-count>لا توجد فلاتر</span></div>
    <div class="exec-controls">
      <input type="search" data-exec-q value="${esc(st.q)}" placeholder="بحث في رقم التنفيذ، الموكل، الملف، الحكم، الاستئناف، الرقم القضائي، التوكيل، المحضر…" aria-label="بحث التنفيذ">
      <select data-exec-type aria-label="نوع التنفيذ">
        <option value="">كل الأنواع</option>
        ${Object.entries(EXECUTION_TYPE_LABELS).map(([value, label]) => `<option value="${esc(value)}"${st.type === value ? ' selected' : ''}>${esc(label)}</option>`).join('')}
      </select>
      <select data-exec-status aria-label="حالة التنفيذ">
        <option value="">كل الحالات</option>
        ${EXECUTION_STATUSES.map(([value, label]) => `<option value="${esc(value)}"${st.status === value ? ' selected' : ''}>${esc(label)}</option>`).join('')}
      </select>
      <button type="button" class="ghost" data-exec-clear>مسح الفلاتر</button>
    </div>
  </section>
  <section data-section-id="grid"><div id="exec-grid"></div></section>
  <section class="panel" data-section-id="settlements" data-collapse-id="exec-settlements" data-collapse-default="collapsed">
    <div class="panel-head"><h3>تسويات وفروق تنتظر قرارًا</h3><span class="badge" data-pending-diff-count>…</span></div>
    <p class="muted small">لا حركة مالية قبل قرارك. افتح التسوية لرؤية كل فترة: القيمة القديمة، الجديدة، المحصل سابقًا، والفرق.</p>
    <div data-pending-diffs></div>
  </section>`;
}

function kpiMarkup(stats, kpiKey) {
  if (!stats) return '<div class="muted small">تعذر حساب المؤشرات.</div>';
  const value = key => {
    switch (key) {
      case 'all': return stats.total;
      case 'civil': case 'criminal': case 'family': return stats.byType?.[key] || 0;
      case 'partialCollection': return stats.partialCollection;
      case 'differencesUnpaid': return stats.differencesUnpaid;
      case 'settlementsReview': return stats.settlementsAwaitingReview;
      case 'needsFollowUp': return stats.needsFollowUp;
      case 'reviewOverdue': return stats.reviewOverdue;
      case 'completed': return stats.completed;
      case 'withoutValue': return (stats.sampledRows || []).filter(row => num(row.summary?.finalEntitlement) <= 0.005).length;
      case 'negativeBalance': return (stats.sampledRows || []).filter(row => num(row.summary?.remaining) < -0.005).length;
      default: return '—';
    }
  };
  return KPIS.map(kpi => {
    const count = value(kpi.key);
    const active = kpi.key === kpiKey;
    const clickable = kpi.key !== 'all' ? true : true;
    return `<button type="button" class="exec-kpi${active ? ' is-active' : ''}" data-kpi="${kpi.key}"${clickable ? '' : ' disabled'} aria-pressed="${active}">
      <b>${typeof count === 'number' ? count.toLocaleString('ar-EG') : esc(String(count))}</b>
      <span>${esc(kpi.label)}</span>
      <small class="muted">${esc(kpi.hint)}</small>
    </button>`;
  }).join('');
}

function alertMarkup(alerts, execution) {
  return alerts.map(alert => `<li class="exec-alert exec-alert-${esc(alert.severity || 'info')}">
    <span class="exec-alert-body">${esc(alert.message)}</span>
    <button type="button" class="ghost small" data-open-exec="${esc(execution.id)}">فتح</button>
  </li>`).join('');
}

export async function bindExecutionCenter(app) {
  const st = state(app);
  const root = document.querySelector('#main-content');
  if (!root) return;
  const relations = {hydrate: async () => {}};
  let grid = null;

  const currentFilterSummary = () => {
    const parts = [];
    if (st.kpi && st.kpi !== 'all') parts.push((KPI_BY_KEY.get(st.kpi) || {}).label || st.kpi);
    if (st.type) parts.push(EXECUTION_TYPE_LABELS[st.type] || st.type);
    if (st.status) parts.push(EXECUTION_STATUS_LABELS[st.status] || st.status);
    if (st.q) parts.push(`بحث: ${st.q}`);
    return parts;
  };
  const syncFilterBadge = () => {
    const badge = root.querySelector('[data-exec-filter-count]');
    const parts = currentFilterSummary();
    if (badge) badge.textContent = parts.length ? `${parts.length} فلتر نشط` : 'لا توجد فلاتر';
    const scope = root.querySelector('[data-kpi-scope]');
    if (scope) scope.textContent = (KPI_BY_KEY.get(st.kpi) || KPIS[0]).label;
  };

  // مزوّد البيانات: ترقيم مؤشر على مخزن التنفيذ، والتصفية المستمدة تُقيَّم بعد هيدرة صف الصفحة.
  // التصفية الأساسية (نوع/حالة) تُقيَّم أثناء مسح المؤشر، والتصفية المستمدة (المؤشر) والباحث
  // النصي يُقيَّمان بعد هيدرة الصف — فيعمل المؤشر والبحث على كامل المخزن لا على الصفحة المعروضة.
  const provider = createIndexedDbDataProvider(app.office.r.execution, {
    resolveScope: () => ({
      index: 'openedDate',
      direction: 'prev',
      filter: row => !row.isDeleted
        && (!st.type || row.executionType === st.type)
        && (!st.status || row.status === st.status),
      preparedFilter: row => {
        if (!kpiPredicate(st.kpi, row)) return false;
        const nq = normQ(st.q);
        if (nq && !rowText(row).includes(nq)) return false;
        return true;
      }
    }),
    prepareRows: async rows => {
      const hydrated = await EX.hydrateExecutionRows(app.office, rows);
      rows.forEach((row, index) => Object.assign(row, hydrated[index]));
    }
  });

  const ensureGrid = () => {
    if (grid) return grid;
    grid = mountGrid(root.querySelector('#exec-grid'), {
      title: 'التنفيذات', columns: EXECUTION_LIST_COLUMNS, rows: [], dataProvider: provider, pageSize: 25,
      storageKey: 'execution:center', collapseKey: 'execution-center:grid', exportName: 'مركز التنفيذ',
      // البحث الفوري والتصفيات تُطبَّق بعد هيدرة الصف، فتعمل على الأرقام المشتقة أيضًا.
      onProviderState: ({phase, error, rows}) => {
        if (phase === 'error') toast(`تعذر تحميل التنفيذات: ${error?.message || ''}`, 'error');
        if (phase === 'ready') st.rows = rows || [];
      },
      onRowMenu: row => [
        {id: 'open', label: 'فتح بطاقة التنفيذ'},
        {id: 'collection', label: 'تسجيل تحصيل'},
        {id: 'poa', label: 'إنشاء توكيل'},
        {id: 'balance', label: 'كشف الرصيد وطباعته'},
        {id: 'attention', label: 'فتح التنبيهات'},
        {id: 'file', label: 'فتح الملف', hidden: !row.fileId},
        {id: 'client', label: 'فتح الموكل', hidden: !row.clientId}
      ],
      onRowAction: async (id, row) => {
        if (id === 'open') return app.go(`exc:${row.id}`);
        if (id === 'file') return app.go(`file:${row.fileId}`);
        if (id === 'client') return app.go(`client:${row.clientId}`);
        if (id === 'collection') return collectionDialog(app, row.id);
        if (id === 'poa') return poaDialog(app, row.id);
        if (id === 'balance') return printBalanceDialog(app, row.id);
        if (id === 'attention') {
          const alerts = await B.executionAlertsFor(app.office, row.id).catch(error => { toast(userError(error), 'error'); return []; });
          toast(alerts.length ? `${alerts.length} تنبيه تنظيمي — افتح البطاقة للتفصيل` : 'لا توجد تنبيهات مسجلة');
          return app.go(`exc:${row.id}`);
        }
      },
      onRowClick: row => app.go(`exc:${row.id}`),
      emptyText: 'لا توجد تنفيذات مطابقة. غيّر الفلاتر أو افتح تنفيذًا جديدًا.',
      selectable: true
    });
    // القائمة الافتراضية للصفوف تُبنى من الأعمدة بلا أي دمج للخلايا.
    return grid;
  };

  // زر «إجراءات الصف» غير مفعّل افتراضيًا في الجدول؛ نضيف قائمة الصف عبر النقر المزدوج على الاسم.
  const bindCardLinks = () => {
    root.querySelectorAll('[data-open-exec]').forEach(button => button.addEventListener('click', () => app.go(`exc:${button.dataset.openExec}`)));
    root.querySelectorAll('[data-open-file]').forEach(button => button.addEventListener('click', () => app.go(`file:${button.dataset.openFile}`)));
    root.querySelectorAll('[data-open-client]').forEach(button => button.addEventListener('click', () => app.go(`client:${button.dataset.openClient}`)));
  };
  bindCardLinks();

  root.querySelector('[data-exec-new]')?.addEventListener('click', () => executionDialog(app));
  root.querySelector('[data-customize-page]')?.addEventListener('click', () => openPageCustomizer(app, {pageId: 'executionCenter', root}));
  root.querySelector('[data-exec-refresh]')?.addEventListener('click', () => app.refresh());

  root.querySelectorAll('[data-kpi]').forEach(button => button.addEventListener('click', async () => {
    const key = button.dataset.kpi;
    st.kpi = key; prefs.set(KPI_KEY, key);
    root.querySelectorAll('[data-kpi]').forEach(item => {
      const active = item.dataset.kpi === key;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-pressed', String(active));
    });
    syncFilterBadge();
    await refreshGrid();
  }));

  const onFilterChange = async () => {
    st.q = root.querySelector('[data-exec-q]')?.value || '';
    st.type = root.querySelector('[data-exec-type]')?.value || '';
    st.status = root.querySelector('[data-exec-status]')?.value || '';
    prefs.set(Q_KEY, st.q); prefs.set(TYPE_KEY, st.type); prefs.set(STATUS_KEY, st.status);
    syncFilterBadge();
    await refreshGrid();
  };
  let debounce = 0;
  root.querySelector('[data-exec-q]')?.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(() => onFilterChange().catch(error => app.fail(error)), 250); });
  root.querySelector('[data-exec-type]')?.addEventListener('change', () => onFilterChange().catch(error => app.fail(error)));
  root.querySelector('[data-exec-status]')?.addEventListener('change', () => onFilterChange().catch(error => app.fail(error)));
  root.querySelector('[data-exec-clear]')?.addEventListener('click', async () => {
    st.q = ''; st.type = ''; st.status = ''; st.kpi = 'all';
    prefs.set(Q_KEY, ''); prefs.set(TYPE_KEY, ''); prefs.set(STATUS_KEY, ''); prefs.set(KPI_KEY, 'all');
    const q = root.querySelector('[data-exec-q]'); if (q) q.value = '';
    const t = root.querySelector('[data-exec-type]'); if (t) t.value = '';
    const s = root.querySelector('[data-exec-status]'); if (s) s.value = '';
    root.querySelectorAll('[data-kpi]').forEach(item => { const active = item.dataset.kpi === 'all'; item.classList.toggle('is-active', active); item.setAttribute('aria-pressed', String(active)); });
    syncFilterBadge();
    await refreshGrid();
  });

  async function refreshGrid() {
    const instance = ensureGrid();
    // لا حقل مخزَّن للمؤشر: الشرط يُعاد حسابه من الرصيد المشتق عند كل تحميل صفحة.
    await instance.reload({resetPage: true});
  }

  // المؤشرات: تُحسب مرة واحدة على عيّنة محدودة ومعلنة، والتنبيهات تُعرض من العيّنة نفسها.
  const stats = await executionCenterStats(app.office).catch(() => null);
  st.stats = stats;
  root.querySelector('[data-kpi-list]').innerHTML = kpiMarkup(stats, st.kpi);
  root.querySelectorAll('[data-kpi]').forEach(button => button.addEventListener('click', async () => {
    const key = button.dataset.kpi;
    st.kpi = key; prefs.set(KPI_KEY, key);
    root.querySelectorAll('[data-kpi]').forEach(item => { const active = item.dataset.kpi === key; item.classList.toggle('is-active', active); item.setAttribute('aria-pressed', String(active)); });
    syncFilterBadge();
    await refreshGrid();
  }));
  const note = root.querySelector('[data-kpi-note]');
  if (note && stats) note.textContent = `المؤشرات محسوبة على ${stats.sampleSize} تنفيذًا${stats.hasMore ? ' (الأحدث فقط؛ توجد سجلات أقدم)' : ''}. كل مؤشر يفتح قائمة مفلترة على كامل السجل.`;

  const attention = [];
  for (const row of stats?.sampledRows || []) {
    for (const alert of row.alerts || []) attention.push({alert, execution: row.execution});
  }
  attention.sort((a, b) => (a.alert.severity === 'warn' ? -1 : 1) - (b.alert.severity === 'warn' ? -1 : 1));
  root.querySelector('[data-attention-count]').textContent = attention.length ? `${attention.length} تنبيه` : 'لا تنبيهات';
  root.querySelector('[data-attention-list]').innerHTML = attention.length
    ? `<ul class="exec-alerts">${attention.slice(0, 20).map(item => alertMarkup([item.alert], item.execution)).join('')}</ul>${attention.length > 20 ? '<p class="muted small">يُعرض أول 20 تنبيهًا من العيّنة.</p>' : ''}`
    : '<p class="muted small">لا توجد تنبيهات تنظيمية في العيّنة المعروضة.</p>';
  // «تنتظر قرارًا»: يُعرض من ملخصات العيّنة نفسها (بلا قراءة صفوف فروق إضافية)، والتفصيل داخل البطاقة.
  const pending = (stats?.sampledRows || [])
    .filter(row => num(row.summary?.differences?.pending) > 0)
    .map(row => ({execution: row.execution, summary: row.summary, pending: num(row.summary?.differences?.pending)}));
  const pendingPanel = root.querySelector('[data-pending-diffs]');
  const pendingBadge = root.querySelector('[data-pending-diff-count]');
  if (pendingBadge) pendingBadge.textContent = pending.length ? `${pending.length} تنفيذ بانتظار قرار` : 'لا شيء معلق';
  if (pendingPanel) {
    pendingPanel.innerHTML = pending.length
      ? `<div class="exec-table-wrap"><table class="exec-table"><thead><tr><th>التنفيذ</th><th>النوع</th><th>إجمالي الفروق المعلقة</th><th>المتبقي الحالي</th><th></th></tr></thead><tbody>
        ${pending.slice(0, 25).map(row => `<tr><td>${esc(row.execution.internalNumber || row.execution.executionNumber || row.execution.officialNumber || '—')}</td><td>${esc(EXECUTION_TYPE_LABELS[row.execution.executionType] || 'غير محدد')}</td><td>${money(row.pending)}</td><td>${money(row.summary.remaining)}</td><td class="exec-cell-actions"><button type="button" class="ghost small" data-open-exec="${esc(row.execution.id)}">فتح البطاقة لمراجعة التسوية</button></td></tr>`).join('')}
      </tbody></table></div><p class="muted small">تُعرض أول 25 حالة من العيّنة؛ الفروق تُعتمد فرديًا من بطاقة التنفيذ.</p>`
      : '<p class="muted small">لا توجد فروق تنتظر المراجعة في العيّنة المعروضة.</p>';
    bindCardLinks();
  }

  syncFilterBadge();
  ensureGrid();
  await refreshGrid();
  // أول تحميل للشبكة يستخدم نفس مسار الترقيم المؤشر — بلا حساب لكل المخزن.
  return true;
}

// ===== بطاقة التنفيذ =====
const execState = app => (app.__exec = app.__exec || {});

export async function executionDetailPage(app, executionId) {
  registerPageLayout({
    pageId: 'execution:card', title: 'بطاقة التنفيذ',
    sections: [
      {id: 'identity', title: 'بيانات التنفيذ'},
      {id: 'balance', title: 'الرصيد المفكَّك'},
      {id: 'attention', title: 'يحتاج انتباهي'},
      {id: 'actions', title: 'إجراءات سريعة'},
      {id: 'judgments', title: 'سلسلة الأحكام'},
      {id: 'values', title: 'فترات الاستحقاق وشرائح القيمة'},
      {id: 'receipts', title: 'التحصيل والمحاضر'},
      {id: 'ledger', title: 'الدفتر المالي (Append-Only)'},
      {id: 'differences', title: 'فروق الأحكام والتسويات'},
      {id: 'poas', title: 'التوكيلات'},
      {id: 'execActions', title: 'إجراءات التنفيذ'},
      {id: 'trace', title: 'تتبع الرصيد'},
      {id: 'timeline', title: 'الخط الزمني'}
    ]
  });
  const info = await EX.executionBundle(app.office, executionId).catch(() => null);
  if (!info) return `<div class="error-box" role="alert"><h2>سجل التنفيذ غير موجود</h2><button class="primary" data-route="executionCenter">رجوع إلى مركز التنفيذ</button></div>`;
  execState(app)[executionId] = info;
  const {execution, summary, alerts} = info;
  const [client, file] = await Promise.all([
    execution.clientId ? app.office.r.clients.get(execution.clientId).catch(() => null) : null,
    execution.fileId ? app.office.r.files.get(execution.fileId).catch(() => null) : null
  ]);
  const title = execution.internalNumber || execution.executionNumber || execution.officialNumber || 'تنفيذ بلا رقم';
  return `<div class="page-head exec-head"><div>
    <h2>${esc(title)} — ${esc(executionTypeLabel(execution.executionType))}</h2>
    <p class="muted small">${esc(executionStatusLabel(execution.status))}${execution.authority ? ` · ${esc(execution.authority)}` : ''}${execution.openedDate ? ` · فُتح في ${esc(execution.openedDate)}` : ''}
    ${summary.lastPeriod ? ` · آخر فترة محسوبة: ${esc(summary.lastPeriod.key)}` : ''}</p>
  </div><div class="head-actions">
    <button class="ghost" data-route="executionCenter">↩ مركز التنفيذ</button>
    <button class="ghost" data-customize-page>⚙ تخصيص الصفحة</button>
    ${execution.fileId ? `<button class="ghost" data-route="file:${esc(execution.fileId)}">الملف القانوني</button>` : ''}
    <button class="ghost" data-print-balance>🖨 كشف الرصيد</button>
    <button class="primary" data-quick="collection">+ تحصيل</button>
  </div></div>
  <section class="panel" data-section-id="identity" data-collapse-id="exec-identity" data-collapse-default="open">
    <div class="panel-head"><h3>بيانات التنفيذ</h3><span class="badge">${esc(EXECUTION_TYPE_LABELS[execution.executionType] || 'نوع غير محدد')}</span></div>
    <div class="exec-kv">
      <span>الموكل</span><b>${esc(client?.fullName || client?.name || (execution.clientId ? 'مرتبط بموكل مسجل' : 'غير محدد'))}</b>
      <span>الملف</span><b>${file ? esc(`${formatFileNumber(file.fileNumber)} — ${file.title || ''}`) : (execution.fileId ? 'مرتبط بملف مسجل' : 'غير مرتبط')}</b>
      <span>الجهة / المحكمة</span><b>${esc(execution.authority || execution.executionOffice || '—')}</b>
      <span>تاريخ الفتح</span><b>${esc(execution.openedDate || '—')}</b>
      <span>حتى تاريخ الاستحقاق</span><b>${esc(execution.entitlementThroughDate || 'غير محدد')}</b>
      <span>سياسة التناسب</span><b>${esc(PRORATION_LABELS[execution.prorationPolicy] || 'الأيام')}</b>
      <span>تاريخ المراجعة القادم</span><b>${esc(execution.nextReviewDate || '—')}</b>
      <span>ملاحظات</span><b>${esc(execution.notes || '—')}</b>
    </div>
    <div class="exec-actions-row">
      <button class="ghost small" data-edit-execution>تعديل البيانات</button>
      <button class="ghost small" data-quick="party">+ طرف تنفيذ</button>
      <button class="ghost small" data-quick="judgment">+ حكم</button>
      <button class="ghost small" data-refresh-search>تحديث نص البحث لهذا التنفيذ</button>
    </div>
  </section>
  ${balanceSectionMarkup(summary, info)}
  <section class="panel" data-section-id="attention" data-collapse-id="exec-attention" data-collapse-default="open">
    <div class="panel-head"><h3>يحتاج انتباهي</h3><span class="badge">${alerts.length} تنبيه</span></div>
    <p class="muted small">تنبيهات تنظيمية من بيانات المكتب، وليست وصفًا قانونيًا أو حكمًا باستحقاق.</p>
    ${alerts.length ? `<ul class="exec-alerts">${alerts.map(alert => `<li class="exec-alert exec-alert-${esc(alert.severity || 'info')}"><span class="exec-alert-body">${esc(alert.message)}</span></li>`).join('')}</ul>` : '<p class="muted small">لا توجد تنبيهات تنظيمية مسجلة لهذا التنفيذ.</p>'}
  </section>
  <section class="panel" data-section-id="actions" data-collapse-id="exec-quick-actions" data-collapse-default="open">
    <div class="panel-head"><h3>إجراءات سريعة</h3><span class="muted small">كل نافذة تستدعي خدمة تطبيقية، ولا تُكتب أي حركة مالية بلا تسجيلها في الدفتر</span></div>
    <div class="exec-quick-actions">
      <button class="primary small" data-quick="collection">تسجيل تحصيل</button>
      <button class="ghost small" data-quick="expense">تسجيل مصروف</button>
      <button class="ghost small" data-quick="slice">شريحة قيمة جديدة</button>
      <button class="ghost small" data-quick="judgment">تسجيل حكم</button>
      <button class="ghost small" data-quick="settlement">إنشاء تسوية فروق</button>
      <button class="ghost small" data-quick="poa">إنشاء توكيل</button>
      <button class="ghost small" data-quick="reissue" ${info.poas.length ? '' : 'disabled'}>إعادة توكيل</button>
      <button class="ghost small" data-quick="execAction">إجراء تنفيذ</button>
      <button class="ghost small" data-quick="snapshot">الرصيد في تاريخ</button>
      <button class="ghost small" data-quick="simulate">محاكاة «ماذا لو»</button>
      <button class="ghost small" data-quick="compare">مقارنة حكمين</button>
      <button class="ghost small" data-quick="print-balance">طباعة كشف الرصيد</button>
      <button class="ghost small" data-quick="print-poa" ${info.poas.length ? '' : 'disabled'}>طباعة آخر توكيل</button>
    </div>
  </section>
  ${judgmentsSectionMarkup(info)}
  ${valuesSectionMarkup(info)}
  ${receiptsSectionMarkup(info)}
  ${ledgerSectionMarkup(info)}
  ${differencesSectionMarkup(info)}
  ${poasSectionMarkup(info)}
  ${actionsSectionMarkup(info)}
  ${traceSectionMarkup(app, executionId)}
  <section class="panel" data-section-id="timeline" data-collapse-id="exec-timeline" data-collapse-default="collapsed">
    <div class="panel-head"><h3>الخط الزمني</h3><span class="badge" data-timeline-count>…</span></div>
    <p class="muted small">يُبنى من سجل النشاط الموجود (Activity Log) نفسه — لا سجل موازٍ.</p>
    <div data-exec-timeline><div class="muted small">جارٍ التحميل…</div></div>
  </section>`;
}

function balanceSectionMarkup(summary, info) {
  const eq = summary.equations || [];
  return `<section class="panel" data-section-id="balance" data-collapse-id="exec-balance" data-collapse-default="open">
    <div class="panel-head"><h3>الرصيد المفكَّك</h3><span class="badge">${esc(summary.lastPeriod ? `آخر فترة ${summary.lastPeriod.key}` : 'لا فترات محسوبة')}</span></div>
    <div class="exec-kv">
      <span>الاستحقاق النهائي</span><b>${money(summary.finalEntitlement)}</b>
      <span>المحصل</span><b>${money(summary.collected)}</b>
      <span>المتبقي</span><b class="${summary.remaining > 0.005 ? 'exec-amount-due' : ''}">${money(summary.remaining)}</b>
      <span>مكوّن الرصيد الأصلي</span><b>${money(summary.originalOutstanding)}</b>
      <span>مكوّن فروق الأحكام</span><b>${money(summary.differencePart)}</b>
      <span>الاستحقاق الأصلي</span><b>${money(summary.originalEntitlement)}</b>
      <span>مصروفات مسجلة</span><b>${money(summary.expenses)} (منها في توكيل: ${money(summary.expensesInPoa)})</b>
      <span>فروق معتمدة / تنتظر المراجعة</span><b>${money(summary.differences?.approved || 0)} / ${money(summary.differences?.pending || 0)}</b>
      <span>محصل بلا تخصيص</span><b>${money(summary.unallocated)}</b>
      <span>عدد الفترات</span><b>${summary.periodCount}</b>
    </div>
    <ul class="exec-equations">${eq.map(line => `<li>${esc(line)}</li>`).join('')}</ul>
    ${summary.truncated ? '<p class="muted small">تم بلوغ حد الفترات المعروض — ضيّق النطاق أو راجع الشرائح.</p>' : ''}
    <div class="exec-actions-row">
      <button class="ghost small" data-quick="snapshot">الرصيد في تاريخ (لقطة)</button>
      <button class="ghost small" data-quick="simulate">محاكاة تغيير قيمة (بلا كتابة)</button>
      <button class="ghost small" data-print-balance>طباعة الكشف</button>
      <button class="ghost small" data-recompute-search>تحديث المؤشرات</button>
    </div>
  </section>`;
}

function judgmentsSectionMarkup(info) {
  const rows = info.judgments.slice().sort((a, b) => Number(a.sequence || 0) - Number(b.sequence || 0));
  return `<section class="panel" data-section-id="judgments" data-collapse-id="exec-judgments" data-collapse-default="open">
    <div class="panel-head"><h3>سلسلة الأحكام</h3><span class="badge">${rows.length} حكم</span></div>
    <p class="muted small">الحكم الأصلي ← الاستئناف ← الحكم اللاحق. كل حكم يحمل تاريخه وتاريخ سريان قيمته كما سُجّلا؛ لا استنتاج تلقائي.</p>
    <div class="exec-table-wrap"><table class="exec-table"><thead><tr><th>#</th><th>النوع</th><th>رقم الحكم</th><th>الاستئناف</th><th>تاريخ الحكم</th><th>سريان القيمة</th><th>القيمة</th><th>الدورية</th><th>المحكمة</th><th></th></tr></thead><tbody>
    ${rows.map(row => `<tr><td>${esc(String(row.sequence ?? ''))}</td><td>${esc(row.judgmentKind === 'later' ? 'حكم لاحق' : row.judgmentKind === 'original' ? 'حكم أصلي' : (row.judgmentKind || '—'))}</td><td>${esc(row.judgmentNumber || '—')}</td><td>${esc(row.appealNumber || '—')}</td><td>${esc(row.judgmentDate || '—')}</td><td>${esc(row.effectiveFrom || 'غير محدد')}</td><td>${num(row.amount) ? money(row.amount) : '—'}</td><td>${esc(row.valueType === 'fixed' ? 'ثابت' : periodicityLabel(row.periodicity) || '—')}</td><td>${esc(row.court || '—')}</td><td><button type="button" class="ghost small" data-edit-judgment="${esc(row.id)}">تعديل</button></td></tr>`).join('') || '<tr><td colspan="10" class="muted">لا توجد أحكام مسجلة بعد.</td></tr>'}
    </tbody></table></div>
    <div class="exec-actions-row">
      <button class="ghost small" data-quick="judgment">+ تسجيل حكم</button>
      <button class="ghost small" data-quick="judgment-later">+ حكم لاحق / استئناف</button>
      <button class="ghost small" data-quick="compare" ${rows.length >= 2 ? '' : 'disabled'}>مقارنة حكمين</button>
    </div>
  </section>`;
}

function valuesSectionMarkup(info) {
  const slices = info.slices.slice().sort((a, b) => String(a.startDate || '').localeCompare(String(b.startDate || '')));
  const byType = new Map();
  for (const slice of slices) {
    const list = byType.get(slice.entitlementType) || [];
    list.push(slice);
    byType.set(slice.entitlementType, list);
  }
  const evolution = [...byType.entries()].map(([type, list]) => `<details class="exec-evolution" data-collapse-ignore><summary>${esc(type)} — ${list.length} شريحة قيمة</summary>
    <ul class="exec-evolution-list">${list.map(slice => `<li><b>${money(slice.amount)}</b> ابتداءً من ${esc(slice.startDate)}${slice.valueType === 'fixed' ? ' (ثابت)' : ` (${esc(periodicityLabel(slice.periodicity) || '')})`}${slice.endDate ? ` وانتهاءً في ${esc(slice.endDate)}` : ''}<small class="muted"> — ${esc(slice.sourceReference || 'سند غير مذكور')} · الحكم: ${esc(slice.judgmentId ? (info.judgments.find(j => j.id === slice.judgmentId)?.judgmentNumber || 'مسجل') : 'غير مرتبط')} · سُجلت في ${esc(String(slice.createdAt || '').slice(0, 10))}</small></li>`).join('')}</ul></details>`).join('');
  const periods = info.periods || [];
  return `<section class="panel" data-section-id="values" data-collapse-id="exec-values" data-collapse-default="open">
    <div class="panel-head"><h3>فترات الاستحقاق وشرائح القيمة</h3><span class="badge">${periods.length} فترة · ${slices.length} شريحة</span></div>
    <p class="muted small">القيمة تُثبَّت في شريحة لها تاريخ بداية؛ تغيير القيمة يُسجَّل كشريحة جديدة ولا تُعدَّل شريحة تاريخية أبدًا. الفترات تُبنى عند الطلب ولا تُخزَّن دفعة واحدة.</p>
    <details class="exec-evolution-block" data-collapse-ignore><summary>تطور قيمة الاستحقاق</summary>${evolution || '<p class="muted small">لا توجد شرائح قيمة بعد.</p>'}</details>
    <h4 class="exec-sub">الفترات المحسوبة</h4>
    <div class="exec-table-wrap"><table class="exec-table"><thead><tr><th>الفترة</th><th>النوع</th><th>القيمة الأصلية</th><th>القيمة النهائية</th><th>الفرق</th><th>المحصل</th><th>المتبقي</th><th>المعادلة</th></tr></thead><tbody>
    ${periods.slice(-400).map(period => `<tr><td>${esc(period.key)}</td><td>${esc(period.entitlementType)}</td><td>${money(period.originalAmount)}</td><td>${money(period.finalAmount)}</td><td>${money(period.difference)}</td><td>${money(period.allocated)}</td><td>${money(period.remaining)}</td><td class="muted small">${esc(period.equation || '')}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">لا توجد فترات محسوبة بعد.</td></tr>'}
    </tbody></table></div>
    ${periods.length > 400 ? '<p class="muted small">يُعرض آخر 400 فترة؛ استخدم اللقطة التاريخية أو ضيّق النطاق للفترات الأقدم.</p>' : ''}
    <div class="exec-actions-row">
      <button class="ghost small" data-quick="slice">+ شريحة قيمة</button>
      <button class="ghost small" data-quick="simulate">محاكاة تغيير قيمة</button>
    </div>
  </section>`;
}

function receiptsSectionMarkup(info) {
  const receipts = info.receipts.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const allocationsByReceipt = new Map();
  for (const allocation of info.allocations) {
    if (allocation.isDeleted) continue;
    const list = allocationsByReceipt.get(allocation.receiptId) || [];
    list.push(allocation);
    allocationsByReceipt.set(allocation.receiptId, list);
  }
  return `<section class="panel" data-section-id="receipts" data-collapse-id="exec-receipts" data-collapse-default="collapsed">
    <div class="panel-head"><h3>التحصيل والمحاضر</h3><span class="badge">${receipts.length} محضر</span></div>
    <p class="muted small">كل محضر يعرض الإجمالي ثم توزيعه على الفترات ثم الرصيد الناتج. إعادة التخصيص تُبطل التخصيص السابق وتحفظه في السجل.</p>
    <div class="exec-table-wrap"><table class="exec-table"><thead><tr><th>رقم المحضر</th><th>التاريخ</th><th>الإجمالي</th><th>طريقة التخصيص</th><th>التوزيع على الفترات</th><th>بلا تخصيص</th><th>الرصيد بعد المحضر</th><th></th></tr></thead><tbody>
    ${receipts.map(receipt => {
      const lines = (allocationsByReceipt.get(receipt.id) || []).filter(a => a.isActive !== false);
      const allocated = round2(lines.reduce((sum, line) => sum + num(line.amount), 0));
      const balanceAfter = receipt.balanceAfter !== undefined && receipt.balanceAfter !== null && receipt.balanceAfter !== '' ? money(receipt.balanceAfter) : '—';
      return `<tr><td>${esc(receipt.receiptNumber || '—')}</td><td>${esc(receipt.date || '—')}</td><td>${money(receipt.amount)}</td><td>${esc(ALLOCATION_METHOD_LABELS[receipt.allocationMethod] || receipt.allocationMethod || '—')}</td>
      <td>${lines.length ? lines.map(line => `<span class="exec-chip" title="${esc(line.method || '')}">${esc(line.periodKey)} = ${money(line.amount)}</span>`).join(' ') : '<span class="muted small">لا تخصيص بعد</span>'}</td>
      <td>${money(round2(num(receipt.amount) - allocated))}</td><td>${balanceAfter}</td>
      <td class="exec-cell-actions"><button type="button" class="ghost small" data-reallocate="${esc(receipt.id)}">إعادة تخصيص</button><button type="button" class="ghost small" data-edit-receipt="${esc(receipt.id)}">بيانات المحضر</button></td></tr>`;
    }).join('') || '<tr><td colspan="8" class="muted">لا توجد محاضر تحصيل بعد.</td></tr>'}
    </tbody></table></div>
    <div class="exec-actions-row"><button class="ghost small" data-quick="collection">+ تسجيل تحصيل</button></div>
  </section>`;
}

function ledgerSectionMarkup(info) {
  const rows = info.ledger.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  return `<section class="panel" data-section-id="ledger" data-collapse-id="exec-ledger" data-collapse-default="collapsed">
    <div class="panel-head"><h3>الدفتر المالي (Append-Only)</h3><span class="badge">${rows.length} حركة</span></div>
    <p class="muted small">لا تعديل ولا حذف لحركة تاريخية: التصحيح يكون بحركة عكس أو تصحيح مرتبطة بالأصل. أصل الاستحقاق منفصل عن الرسوم والدمغة والمصروفات.</p>
    <div class="exec-table-wrap"><table class="exec-table"><thead><tr><th>التاريخ</th><th>النوع</th><th>المبلغ</th><th>المرجع</th><th>المصدر</th><th>الرصيد الصافي بعد الحركة</th><th></th></tr></thead><tbody>
    ${rows.slice(0, 400).map(row => `<tr class="${row.isReversed ? 'exec-row-muted' : ''}"><td>${esc(row.date || '—')}</td><td>${esc(LEDGER_TYPE_LABELS[row.type] || row.type)}</td><td>${money(row.amount)}</td><td>${esc(row.reference || row.receiptNumber || row.documentReferenceId || '—')}</td><td>${esc(row.poaId ? 'توكيل' : row.receiptId ? 'محضر' : row.settlementId ? 'تسوية فروق' : 'مباشر')}</td><td>${money(row.runningBalance ?? row.netAmount ?? row.amount)}</td><td class="exec-cell-actions">${row.isReversed ? '<span class="badge">معكوسة</span>' : `<button type="button" class="ghost small" data-correct-ledger="${esc(row.id)}">عكس / تصحيح</button>`}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">لا توجد حركات مالية بعد.</td></tr>'}
    </tbody></table></div>
    <div class="exec-actions-row"><button class="ghost small" data-quick="expense">+ مصروف</button><button class="ghost small" data-quick="collection">+ تحصيل</button></div>
  </section>`;
}

function differencesSectionMarkup(info) {
  const rows = info.differences.slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  const settlements = info.settlements.slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  return `<section class="panel" data-section-id="differences" data-collapse-id="exec-differences" data-collapse-default="collapsed">
    <div class="panel-head"><h3>فروق الأحكام والتسويات</h3><span class="badge">${rows.length} فرق · ${settlements.length} تسوية</span></div>
    <p class="muted small">الحكم اللاحق ينتج فروقًا تُعرض للمراجعة، ولا تتحول إلى حركة مالية قبل اعتمادك. لا ازدواج: تُعرض القيمة النهائية والفرق مرة واحدة.</p>
    <h4 class="exec-sub">التسويات</h4>
    <div class="exec-table-wrap"><table class="exec-table"><thead><tr><th>التسوية</th><th>النوع</th><th>الحالة</th><th>الفروق</th><th>الإجمالي</th><th>سُجلت</th><th></th></tr></thead><tbody>
    ${settlements.map(row => {
      const related = rows.filter(d => d.settlementId === row.id);
      return `<tr><td>${esc(row.id.slice(-6))}</td><td>${esc(row.entitlementType || '—')}</td><td>${esc(DIFFERENCE_STATUS_LABELS[row.status] || row.status)}</td><td>${related.length}</td><td>${money(round2(related.reduce((sum, d) => sum + num(d.differenceAmount), 0)))}</td><td>${esc(String(row.createdAt || '').slice(0, 10))}</td><td class="exec-cell-actions"><button type="button" class="ghost small" data-review-settlement="${esc(row.id)}">اعتماد / مراجعة</button></td></tr>`;
    }).join('') || '<tr><td colspan="7" class="muted">لا توجد تسويات بعد.</td></tr>'}
    </tbody></table></div>
    <h4 class="exec-sub">صفوف الفروق</h4>
    <div class="exec-table-wrap"><table class="exec-table"><thead><tr><th>الفترة</th><th>قديم</th><th>جديد</th><th>الفرق</th><th>الحالة</th><th>المعادلة</th></tr></thead><tbody>
    ${rows.slice(0, 300).map(row => `<tr><td>${esc(row.periodKey)}</td><td>${money(row.oldValue)}</td><td>${money(row.newValue)}</td><td>${money(row.differenceAmount)}</td><td>${esc(DIFFERENCE_STATUS_LABELS[row.status] || row.status)}</td><td class="muted small">${esc(row.equation || '')}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">لا توجد فروق مسجلة.</td></tr>'}
    </tbody></table></div>
    <div class="exec-actions-row"><button class="ghost small" data-quick="settlement">+ إنشاء تسوية فروق</button></div>
  </section>`;
}

function poasSectionMarkup(info) {
  const rows = info.poas.slice().sort((a, b) => Number(b.sequence || 0) - Number(a.sequence || 0));
  return `<section class="panel" data-section-id="poas" data-collapse-id="exec-poas" data-collapse-default="collapsed">
    <div class="panel-head"><h3>التوكيلات</h3><span class="badge">${rows.length} توكيل</span></div>
    <p class="muted small">التوكيل يعرض مكوناته ومصدر كل مبلغ (فترات جديدة، رصيد سابق، فروق معتمدة، مصروفات). عند إعادة التوكيل يظهر الرصيد السابق كلٌّ على حدة.</p>
    <div class="exec-table-wrap"><table class="exec-table"><thead><tr><th>الرقم</th><th>النوع</th><th>الفترة</th><th>فترات جديدة</th><th>رصيد سابق</th><th>فروق</th><th>مصروفات</th><th>الإجمالي</th><th>الحالة</th><th></th></tr></thead><tbody>
    ${rows.map(row => `<tr><td>${esc(row.poaNumber || row.reference || '—')}</td><td>${esc(row.kind === 'reissue' ? 'إعادة توكيل' : 'توكيل')}</td><td>${esc(`${row.fromDate || ''} → ${row.toDate || ''}`)}</td><td>${money(row.baseAmount)}</td><td>${money(row.previousBalance)}</td><td>${money(row.differencesAmount)}</td><td>${money(row.expensesAmount)}</td><td><b>${money(row.total)}</b></td><td>${esc(POA_STATUS_LABELS[row.status] || row.status || '—')}</td><td class="exec-cell-actions"><button type="button" class="ghost small" data-print-poa="${esc(row.id)}">طباعة</button>${row.previousPoaId ? `<button type="button" class="ghost small" data-reissue="${esc(row.id)}">إعادة توكيل</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="10" class="muted">لا توجد توكيلات بعد.</td></tr>'}
    </tbody></table></div>
    <div class="exec-actions-row"><button class="ghost small" data-quick="poa">+ توكيل جديد</button><button class="ghost small" data-quick="reissue">+ إعادة توكيل</button></div>
  </section>`;
}

function actionsSectionMarkup(info) {
  const rows = info.actions.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  return `<section class="panel" data-section-id="execActions" data-collapse-id="exec-actions" data-collapse-default="collapsed">
    <div class="panel-head"><h3>إجراءات التنفيذ</h3><span class="badge">${rows.length} إجراء</span></div>
    <p class="muted small">حجز، إعلان بيع، جلسة بيع، تبديد، رقم عرائض، رقم قضائي — سجل تنظيمي بترتيب المكتب الفعلي، لا سير عمل قانوني مفروض.</p>
    <div class="exec-table-wrap"><table class="exec-table"><thead><tr><th>النوع</th><th>التاريخ</th><th>المرجع</th><th>الجهة</th><th>رقم عرائض</th><th>رقم قضائي</th><th>ملاحظات</th><th></th></tr></thead><tbody>
    ${rows.map(row => `<tr><td>${esc(ACTION_KIND_LABELS[row.kind] || row.kind)}</td><td>${esc(row.date || '—')}</td><td>${esc(row.referenceNumber || '—')}</td><td>${esc(row.authority || '—')}</td><td>${esc(row.petitionNumber || '—')}</td><td>${esc(row.judicialNumber || '—')}</td><td class="muted small">${esc(row.notes || '')}</td><td class="exec-cell-actions"><button type="button" class="ghost small" data-edit-action="${esc(row.id)}">تعديل</button><button type="button" class="ghost small" data-result-file="${esc(row.id)}">ملف ناتج</button></td></tr>`).join('') || '<tr><td colspan="8" class="muted">لا توجد إجراءات مسجلة.</td></tr>'}
    </tbody></table></div>
    <div class="exec-actions-row"><button class="ghost small" data-quick="execAction">+ تسجيل إجراء</button></div>
  </section>`;
}

function traceSectionMarkup(app, executionId) {
  return `<section class="panel" data-section-id="trace" data-collapse-id="exec-trace" data-collapse-default="collapsed">
    <div class="panel-head"><h3>تتبع الرصيد</h3><span class="muted small">الرصيد ← الفترات ← المحاضر والتخصيصات ← الحركات، وكل عقدة تحمل معرّفاتها</span></div>
    <div data-exec-trace><div class="muted small">جارٍ التحميل…</div></div>
  </section>`;
}

function renderTrace(nodes, depth = 0) {
  if (!nodes?.length) return '';
  return `<ul class="exec-trace-level">${nodes.map(node => `<li>
    <div class="exec-trace-node"><span class="exec-trace-label">${esc(node.label)}</span>${node.amount !== undefined && node.amount !== null ? `<b>${money(node.amount)}</b>` : ''}${node.detail ? `<small class="muted">${esc(node.detail)}</small>` : ''}</div>
    ${node.children?.length ? renderTrace(node.children, depth + 1) : ''}
  </li>`).join('')}</ul>`;
}

export async function bindExecutionDetail(app, executionId) {
  const root = document.querySelector('#main-content');
  if (!root) return;
  const info = execState(app)[executionId];
  if (!info) return;
  const execution = info.execution;
  const hasSlices = info.slices.length > 0;
  const hasPoas = info.poas.length > 0;

  const openCollection = () => collectionDialog(app, executionId).catch(error => toast(userError(error), 'error'));
  const openSlice = () => sliceDialog(app, executionId, {slices: info.slices, judgments: info.judgments}).catch(error => toast(userError(error), 'error'));
  const openJudgment = previous => judgmentDialog(app, executionId, {previous, slices: info.slices}).catch(error => toast(userError(error), 'error'));
  const openPoa = (previousPoaId = '') => poaDialog(app, executionId, {previousPoaId}).catch(error => toast(userError(error), 'error'));

  root.querySelector('[data-customize-page]')?.addEventListener('click', () => openPageCustomizer(app, {pageId: 'execution:card', root}));
  root.querySelector('[data-edit-execution]')?.addEventListener('click', () => executionDialog(app, {execution}));
  root.querySelector('[data-print-balance]')?.addEventListener('click', () => printBalanceDialog(app, executionId));
  root.querySelector('[data-refresh-search]')?.addEventListener('click', async () => {
    const row = await refreshExecutionSearchText(app.office, executionId).catch(error => { toast(userError(error), 'error'); return null; });
    if (row) toast('تم تحديث نص البحث لهذا التنفيذ');
  });
  root.querySelector('[data-recompute-search]')?.addEventListener('click', () => app.refresh());

  root.querySelectorAll('[data-quick]').forEach(button => button.addEventListener('click', () => {
    const kind = button.dataset.quick;
    if (kind === 'collection') return openCollection();
    if (kind === 'expense') return expenseDialog(app, executionId).catch(error => toast(userError(error), 'error'));
    if (kind === 'slice') return openSlice();
    if (kind === 'judgment') return openJudgment(null);
    if (kind === 'judgment-later') return openJudgment(info.judgments.at(-1) || null);
    if (kind === 'settlement') return createSettlementFlow(app, executionId, info);
    if (kind === 'poa') return openPoa('');
    if (kind === 'reissue') return reissueFlow(app, executionId, info);
    if (kind === 'execAction') return actionDialog(app, executionId).catch(error => toast(userError(error), 'error'));
    if (kind === 'snapshot') return snapshotDialog(app, executionId).catch(error => toast(userError(error), 'error'));
    if (kind === 'simulate') return simulatorDialog(app, executionId, {slices: info.slices}).catch(error => toast(userError(error), 'error'));
    if (kind === 'compare') return comparisonDialog(app, executionId, {judgments: info.judgments}).catch(error => toast(userError(error), 'error'));
    if (kind === 'print-balance') return printBalanceDialog(app, executionId);
    if (kind === 'print-poa') return info.poas.length ? POA.printPoa(app.office, info.poas[0].id).then(() => toast('فُتح التوكيل للطباعة')).catch(error => toast(userError(error), 'error')) : toast('لا يوجد توكيل بعد', 'error');
    return undefined;
  }));

  root.querySelectorAll('[data-edit-judgment]').forEach(button => button.addEventListener('click', () => {
    const judgment = info.judgments.find(row => row.id === button.dataset.editJudgment);
    judgmentDialog(app, executionId, {judgment}).catch(error => toast(userError(error), 'error'));
  }));
  root.querySelectorAll('[data-edit-action]').forEach(button => button.addEventListener('click', () => {
    const action = info.actions.find(row => row.id === button.dataset.editAction);
    actionDialog(app, executionId, {action}).catch(error => toast(userError(error), 'error'));
  }));
  root.querySelectorAll('[data-correct-ledger]').forEach(button => button.addEventListener('click', () => {
    const entry = info.ledger.find(row => row.id === button.dataset.correctLedger);
    if (entry) ledgerCorrectDialog(app, executionId, entry).catch(error => toast(userError(error), 'error'));
  }));
  root.querySelectorAll('[data-reallocate]').forEach(button => button.addEventListener('click', () => {
    const receipt = info.receipts.find(row => row.id === button.dataset.reallocate);
    if (receipt) reallocateDialog(app, receipt).catch(error => toast(userError(error), 'error'));
  }));
  root.querySelectorAll('[data-edit-receipt]').forEach(button => button.addEventListener('click', () => {
    const receipt = info.receipts.find(row => row.id === button.dataset.editReceipt);
    if (receipt) collectionDialog(app, executionId, {receipt, poas: info.poas}).catch(error => toast(userError(error), 'error'));
  }));
  root.querySelectorAll('[data-print-poa]').forEach(button => button.addEventListener('click', () => {
    POA.printPoa(app.office, button.dataset.printPoa).then(() => toast('فُتح التوكيل للطباعة')).catch(error => toast(userError(error), 'error'));
  }));
  root.querySelectorAll('[data-reissue]').forEach(button => button.addEventListener('click', () => openPoa(button.dataset.reissue)));
  root.querySelectorAll('[data-review-settlement]').forEach(button => button.addEventListener('click', () => settlementReviewDialog(app, button.dataset.reviewSettlement).catch(error => toast(userError(error), 'error'))));
  root.querySelectorAll('[data-result-file]').forEach(button => button.addEventListener('click', async () => {
    const action = info.actions.find(row => row.id === button.dataset.resultFile);
    const file = await createResultFile(app.office, {executionId, actionId: button.dataset.resultFile, title: `ملف ناتج — ${ACTION_KIND_LABELS[action?.kind] || 'إجراء تنفيذ'}`, fileType: 'جزائي'}).catch(error => { toast(userError(error), 'error'); return null; });
    if (file) { toast('تم إنشاء ملف ناتج مرتبط بالتنفيذ'); await app.go(`file:${file.id}`); }
  }));

  // الخط الزمني من سجل النشاط القائم
  B.executionTimeline(app.office, executionId).then(items => {
    const host = root.querySelector('[data-exec-timeline]');
    if (!host) return;
    const badge = root.querySelector('[data-timeline-count]');
    if (badge) badge.textContent = `${items.length} واقعة`;
    host.innerHTML = items.length ? `<ul class="exec-timeline">${items.slice(0, 80).map(item => `<li><b>${esc(item.kind || 'نشاط')}</b><span>${esc(item.title || '')}</span><small class="muted">${esc(item.date || String(item.at || '').slice(0, 10))}</small></li>`).join('')}</ul>` : '<p class="muted small">لا توجد وقائع مسجلة بعد.</p>';
  }).catch(() => {
    const host = root.querySelector('[data-exec-timeline]');
    if (host) host.innerHTML = '<p class="muted small">تعذر تحميل الخط الزمني.</p>';
  });

  // شجرة التفكيك
  B.executionBalance(app.office, executionId).then(out => {
    const host = root.querySelector('[data-exec-trace]');
    if (!host) return;
    host.innerHTML = `<div class="exec-trace-root"><div class="exec-trace-node"><span>الرصيد الحالي</span><b>${money(out.summary.remaining)}</b></div>${renderTrace(out.trace?.children || [])}</div>
      <ul class="exec-equations">${(out.equations || []).map(line => `<li>${esc(line)}</li>`).join('')}</ul>`;
  }).catch(() => {
    const host = root.querySelector('[data-exec-trace]');
    if (host) host.innerHTML = '<p class="muted small">تعذر بناء شجرة التتبع.</p>';
  });

  void hasSlices; void hasPoas;
  return true;
}

async function createSettlementFlow(app, executionId, info) {
  const candidates = info.slices.filter(slice => slice.valueType === 'periodic').slice(-6).reverse();
  if (!candidates.length) return toast('أضف شريحة قيمة أولًا', 'error');
  const choice = candidates[0];
  const out = await DF.createSettlement(app.office, {executionId, sliceId: choice.id, note: 'تسوية من بطاقة التنفيذ'}).catch(error => { toast(userError(error), 'error'); return null; });
  if (out) await settlementReviewDialog(app, out.settlement.id);
}

async function reissueFlow(app, executionId, info) {
  if (!info.poas.length) return toast('لا يوجد توكيل سابق لإعادة التوكل', 'error');
  const previous = info.poas.slice().sort((a, b) => Number(b.sequence || 0) - Number(a.sequence || 0))[0];
  const draft = await POA.reissuePoaDraft(app.office, previous.id).catch(error => { toast(userError(error), 'error'); return null; });
  if (!draft) return;
  if (draft.lines.length) {
    const total = round2(draft.lines.reduce((sum, line) => sum + num(line.amount), 0));
    toast(`مسودة إعادة التوكيل: رصيد سابق ${money(draft.previousBalance ?? previous.total)} + فترات جديدة ${money(total - num(draft.previousBalance ?? previous.total))} = ${money(total)}`);
  }
  return poaDialog(app, executionId, {previousPoaId: previous.id});
}
