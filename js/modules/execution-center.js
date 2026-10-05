// =====================================================================
// مركز التنفيذ وبطاقة التنفيذ — الواجهة المبسّطة (FEAS مبسّط)
// ---------------------------------------------------------------------
// • القائمة: عنوان + «+ تنفيذ جديد» + بحث + أربعة عدّادات + الشبكة الموحدة.
// • البطاقة: ثلاثة أرقام دائمًا في الأعلى، شريط أزرار ثابت، ثم أربعة تبويبات:
//   الحساب · السجل · الحكم والبيانات · التوكيل والطباعة.
// • كل رقم قابل للنقر ليعرض كيف حُسب (Trace)، وكل سجل يُعدَّل/يُلغى من صفه نفسه.
// • لا نظام موازٍ: نفس DataGrid و PrintContext و ActivityLog و Work Center،
//   والكتابة كلها عبر خدمات التطبيق (execution-simple.js).
// =====================================================================
import {esc} from '../ui/dom.js';
import {toast} from '../ui/toast.js';
import {confirmBox, modal, closeModal} from '../ui/modal.js';
import {mountGrid} from '../ui/datagrid.js';
import {createIndexedDbDataProvider} from '../db/grid-data-provider.js';
import {registerPageLayout, openPageCustomizer} from '../ui/page-layout.js';
import {prefs} from '../core/preferences.js';
import {formatFileNumber} from '../core/file-number.js';
import {localDate} from '../core/clock.js';
import {userError} from '../core/errors.js';
import {fromMinorUnits} from '../domain/execution-money.js';
import {isCivilDate} from '../domain/execution-calendar.js';
import {PERIOD_STATUS} from '../domain/execution-schedule.js';
import {EXECUTION_TYPE_LABELS} from '../domain/execution.js';
import * as S from '../services/execution-simple.js';
import * as EX from '../services/execution.js';
import * as DF from '../services/execution-differences.js';
import {seedFamilyExecutionExample, familyExecutionExampleState} from '../services/execution-demo.js';
import {
  newExecutionDialog, recordSheet, simpleCollectionDialog, simpleActionDialog, simpleExpenseDialog,
  subsequentJudgmentDialog, simplePoaDialog, simpleNoteDialog, durationDialog, statementDialog,
  valueSetupDialog, executionSettingsDialog, executionHelpDialog
} from '../ui/execution-simple-forms.js';
import {
  executionDialog, executionObligationDialog, recognitionDialog, partyDialog, judgmentDialog,
  settlementReviewDialog, snapshotDialog, simulatorDialog, comparisonDialog, printBalanceDialog
} from '../ui/execution-forms.js';

const TAB_KEY = 'ui:exec:tab:v1';
const ASOF_KEY = 'ui:exec:asof:v1';
const COUNT_KEY = 'ui:exec:count:v1';
const accountFilterKey = executionId => `ui:exec:account-filter:${executionId}`;

/* ============================ تنسيقات موحدة ============================ */
const money = (minor, currency = 'EGP') => `${fromMinorUnits(minor || 0, currency).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})} ج.م`;
const moneyShort = (minor, currency = 'EGP') => fromMinorUnits(minor || 0, currency).toLocaleString('en-US', {maximumFractionDigits: 0});
const dateText = iso => (isCivilDate(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');
const STATUS_TEXT = {paid: '✔ مسدد', partial: '◐ جزئي', unpaid: '✗ لم يُدفع', nothing_due: '· لا استحقاق'};
const statusChip = status => `<span class="pstatus pstatus-${esc(status)}">${esc(STATUS_TEXT[status] || '')}</span>`;
const TAB_LABELS = {account: 'الحساب', log: 'السجل', data: 'الحكم والبيانات', poa: 'التوكيل والطباعة'};

/* ============================ أعمدة الشبكة ============================ */
export const EXECUTION_LIST_COLUMNS = Object.freeze([
  {key: 'internalNumber', label: 'رقم التنفيذ', width: 140, get: row => row.displayNumber || '', text: row => row.displayNumber || '—'},
  {key: 'clientName', label: 'الموكل', width: 170, get: row => row.clientName || '', text: row => row.clientName || '—'},
  {key: 'opponentName', label: 'المنفذ ضده', width: 170, get: row => row.opponentName || '', text: row => row.opponentName || '—'},
  {key: 'fileNumber', label: 'رقم الملف', width: 110, get: row => (row.fileNumber ? formatFileNumber(row.fileNumber) : ''), text: row => (row.fileNumber ? formatFileNumber(row.fileNumber) : '—')},
  {key: 'dueUntilToday', label: 'المطلوب حتى اليوم', type: 'number', width: 150, get: row => Number(row.dueUntilToday || 0), text: row => money(row.dueUntilToday)},
  {key: 'paidTotal', label: 'المدفوع', type: 'number', width: 120, get: row => Number(row.paidTotal || 0), text: row => money(row.paidTotal)},
  {key: 'remainingTotal', label: 'المتبقي', type: 'number', width: 120, get: row => Number(row.remainingTotal || 0), text: row => money(row.remainingTotal)},
  {key: 'lastActionLabel', label: 'آخر إجراء', width: 190, get: row => row.lastActionLabel || '', text: row => row.lastActionLabel || '—'},
  {key: 'nextActionLabel', label: 'الإجراء التالي', width: 190, get: row => row.nextActionLabel || '', text: row => (row.nextActionLabel ? `⏰ ${row.nextActionLabel}` : '—')},
  {key: 'statusLabel', label: 'الحالة', width: 120, get: row => row.statusLabel || '', text: row => row.statusLabel || ''},
  {key: 'executionTypeLabel', label: 'نوع التنفيذ', width: 130, get: row => row.executionTypeLabel || '', text: row => row.executionTypeLabel || ''},
  {key: 'valueState', label: 'بيانات القيمة', width: 140, get: row => row.valueState || '', text: row => (row.valueState === 'missing' ? '⚠ لم تُسجَّل بعد' : row.valueState === 'set' ? '✓ مسجلة' : '—')},
  {key: 'authority', label: 'جهة التنفيذ', width: 160, get: row => row.authority || '', text: row => row.authority || '—'},
  {key: 'openedDate', label: 'تاريخ الفتح', type: 'date', width: 110, get: row => row.openedDate || '', text: row => dateText(row.openedDate)}
]);

/* ==================== قراءات مساعدة للصفوف القديمة ====================
   بعض التنفيذات المسجلة قبل التبسيط لا تحتوي أطرافًا ولا بنود قيمة (تُعرض
   فارغة بلا معنى). هنا نُكمل العرض من العلاقة القائمة (المرحلة → الملف →
   الموكل) بلا أي كتابة أو تعديل على البيانات نفسها. */
const lookupCache = (app, key) => (app.__execLookup = app.__execLookup || {clients: new Map(), cases: new Map(), files: new Map()})[key];
async function cacheGet(app, store, id) {
  if (!id) return null;
  const cache = lookupCache(app, store);
  if (cache.has(id)) return cache.get(id);
  const row = await app.office.r[store].get(id).catch(() => null);
  cache.set(id, row || null);
  return row || null;
}
async function decorateLegacyRows(app, rows) {
  const caseIds = [...new Set(rows.map(row => row.caseId).filter(Boolean))];
  const cases = new Map(await Promise.all(caseIds.map(async id => [id, await cacheGet(app, 'cases', id)])));
  const fileIds = [...new Set([...rows.map(row => row.fileId), ...[...cases.values()].map(item => item?.fileId)].filter(Boolean))];
  const files = new Map(await Promise.all(fileIds.map(async id => [id, await cacheGet(app, 'files', id)])));
  const clientIds = [...new Set([...rows.map(row => row.clientId), ...[...files.values()].map(item => item?.clientId)].filter(Boolean))];
  const clients = new Map(await Promise.all(clientIds.map(async id => [id, await cacheGet(app, 'clients', id)])));
  return rows.map(row => {
    const caseRow = row.caseId ? cases.get(row.caseId) : null;
    const fileRow = (row.fileId ? files.get(row.fileId) : null) || (caseRow?.fileId ? files.get(caseRow.fileId) : null) || null;
    const clientRow = (row.clientId ? clients.get(row.clientId) : null) || (fileRow?.clientId ? clients.get(fileRow.clientId) : null) || null;
    return {caseRow, fileRow, clientRow};
  });
}
const legacyNumber = row => {
  if (row.executionNumber) return `${row.executionNumber}${row.executionYear ? `/${row.executionYear}` : ''}`;
  return '';
};

const COUNTERS = Object.freeze([
  {key: 'running', label: 'جارٍ', hint: 'مفتوح بلا تأخر'},
  {key: 'overdue', label: 'عليه متأخرات', hint: 'فترة انتهت ولم تُسدد'},
  {key: 'needsFollowUp', label: 'يحتاج متابعة', hint: 'إجراء تالٍ أو بيانات ناقصة'},
  {key: 'completed', label: 'مكتمل السداد', hint: 'لا متبقٍ'}
]);

const searchableText = row => [row.internalNumber, row.officialNumber, row.clientName, row.opponentName, row.fileNumber, row.searchText, row.billNumber, row.petitionNumber]
  .filter(Boolean).join(' ').toLowerCase();

const counterMatches = (key, row) => {
  if (!key || key === 'all') return true;
  if (key === 'needsFollowUp') return Boolean(row.nextActionLabel) || Boolean(row.needsFollowUp);
  return row.derivedStatus === key;
};

const listState = app => (app.__execCenter = app.__execCenter || {
  count: prefs.get(COUNT_KEY, 'all'), search: prefs.get('ui:exec:q', ''), counts: null, counted: 0, scannedAll: false, ready: false
});
const cardState = app => (app.__execSimple = app.__execSimple || {});

/* ============================ صفحة القائمة ============================ */
export function executionCenterPage(app) {
  registerPageLayout({
    pageId: 'executionCenter', title: 'مركز التنفيذ',
    sections: [
      {id: 'numbers', title: 'عدّادات سريعة'},
      {id: 'filters', title: 'بحث'},
      {id: 'grid', title: 'جدول التنفيذات', canHide: false}
    ]
  });
  const st = listState(app);
  return `<div class="page-head exec-head"><div><h2>مركز التنفيذ</h2>
    <p class="muted small">كل شيء في مكان واحد: أنشئ تنفيذًا، سجّل ما تم (تحصيل · إجراء · مصروف · حكم لاحق)، واقرأ المطلوب والمدفوع والمتبقي فورًا.</p></div>
    <div class="head-actions">
      <button class="ghost" data-help>؟ مساعدة</button>
      <button class="ghost" data-settings>⚙ إعدادات التنفيذ</button>
      <button class="ghost" data-customize-page>⚙ تخصيص الصفحة</button>
      <button class="ghost" data-exec-trash>🗑 سلة التنفيذ</button>
      <button class="ghost" data-demo-example>🧪 مثال عملي جاهز</button>
      <button class="ghost" data-exec-demo>📁 ملفات تنفيذ تجريبية</button>
      <button class="ghost danger" data-exec-clear>🗑 مسح بيانات التنفيذ</button>
      <button class="primary" data-new-execution>+ تنفيذ جديد</button>
    </div></div>
  <section class="panel exec-counters" data-section-id="numbers">
    <div class="counter-grid" data-counters><div class="muted small">جارٍ الحساب…</div></div>
    <p class="muted small" data-counter-note></p>
  </section>
  <section class="panel exec-search" data-section-id="filters">
    <div class="exec-controls">
      <input type="search" data-search value="${esc(st.search)}" placeholder="بحث: رقم التنفيذ · الموكل · المنفذ ضده · رقم الملف" aria-label="بحث التنفيذ">
      <button type="button" class="ghost" data-clear-search>مسح</button>
    </div>
  </section>
  <section data-section-id="grid"><div id="exec-grid"></div></section>`;
}

/**
 * زرع ملفات تنفيذ تجريبية مرة واحدة لكل قاعدة بيانات **فارغة التنفيذات**:
 * بعد مسح البيانات يفتح المكتب مركز التنفيذ فيجد أربعة ملفات جاهزة للمعاينة
 * بدل شاشة فارغة — ولا يُزرع شيء فوق أي بيانات حقيقية، ولا بعد حذف متعمَّد.
 */
async function maybeSeedExecutionDemo(app, reload) {
  const guard = listState(app);
  if (guard.demoSeedAttempted) return;
  guard.demoSeedAttempted = true;
  try {
    const meta = await app.office.r.meta.get('executionDemoSeed').catch(() => null);
    if (meta?.seeded || meta?.removedAt) return;
    const count = await app.office.r.execution.count().catch(() => 0);
    if (Number(count || 0) > 0) return;
    const admin = await import('../services/data-admin.js');
    const out = await admin.seedExecutionDemoFiles(app.office);
    toast(`حُمِّل ${out.count} ملفات تنفيذ تجريبية للمعاينة — احذفها من زر «ملفات تنفيذ تجريبية»`, 'ok', {duration: 7000});
    await reload();
  } catch (error) {
    console.info('execution demo seed skipped', error);
  }
}

export async function bindExecutionCenter(app) {
  const st = listState(app);
  const root = document.querySelector('#main-content');
  if (!root) return false;
  let grid = null;

  const provider = createIndexedDbDataProvider(app.office.r.execution, {
    resolveScope: () => ({
      index: 'openedDate', direction: 'prev',
      filter: row => !row.isDeleted,
      preparedFilter: row => counterMatches(st.count, row) && (!st.search || searchableText(row).includes(String(st.search).trim().toLowerCase()))
    }),
    prepareRows: async rows => {
      const [hydrated, legacy] = await Promise.all([
        S.hydrateSimpleRows(app.office, rows),
        decorateLegacyRows(app, rows).catch(() => rows.map(() => ({})))
      ]);
      const today = localDate();
      rows.forEach((row, index) => {
        const item = hydrated[index] || null;
        const extra = legacy[index] || {};
        const fileNumber = row.fileNumber || extra.fileRow?.fileNumber || extra.caseRow?.fileNumber || '';
        row.displayNumber = row.internalNumber || row.officialNumber || legacyNumber(row) || '';
        row.clientName = item?.creditor?.name || extra.clientRow?.fullName || '';
        row.opponentName = item?.debtor?.name || '';
        row.fileNumber = fileNumber;
        row.dueUntilToday = item?.summary?.dueMinor || 0;
        row.paidTotal = item?.summary?.paidMinor || 0;
        row.remainingTotal = item?.summary?.remainingMinor || 0;
        row.creditTotal = item?.summary?.creditMinor || 0;
        row.lastActionLabel = item?.lastActionLabel || '';
        row.nextActionLabel = item?.nextActionLabel || '';
        row.statusLabel = item?.status?.label || '';
        row.derivedStatus = item?.status?.key || 'running';
        row.periods = item?.schedule?.rows?.length || 0;
        row.valueState = row.periods ? 'set' : (item?.slices?.length || item?.judgments?.length ? 'missing' : 'missing');
        row.needsFollowUp = !row.periods
          || (item?.schedule?.rows || []).some(period => period.status !== PERIOD_STATUS.PAID && period.toDate < today)
          || Boolean(item?.nextAction);
        row.executionTypeLabel = EXECUTION_TYPE_LABELS[row.executionType] || '';
        row.authority = row.authority || row.executionOffice || '';
        row.openedDate = row.openedDate || String(row.createdAt || '').slice(0, 10);
      });
    }
  });

  const ensureGrid = () => {
    if (grid) return grid;
    const host = root.querySelector('#exec-grid');
    if (!host) return null;
    grid = mountGrid(host, {
      title: 'التنفيذات', columns: EXECUTION_LIST_COLUMNS, rows: [], dataProvider: provider, pageSize: 25,
      storageKey: 'execution:center:simple', gridId: 'execution:center', collapseKey: 'execution-center:grid', exportName: 'مركز التنفيذ',
      emptyText: 'لا توجد تنفيذات مطابقة. عدّل العدّاد أو البحث، أو ابدأ بـ«+ تنفيذ جديد».',
      rowMenu: row => [
        {id: 'open', label: 'فتح البطاقة'},
        {id: 'collection', label: 'تسجيل تحصيل'},
        ...(row.valueState === 'missing' ? [{id: 'value', label: '⚠ أدخل قيمة النفقة والدورية'}] : []),
        {id: 'action', label: 'تسجيل إجراء'},
        {id: 'duration', label: '🧮 احسب مدة'},
        {id: 'statement', label: '🖨 كشف / توكيل'},
        {id: 'edit', label: 'تعديل بيانات التنفيذ'},
        ...(row.fileId ? [{id: 'file', label: 'فتح الملف القانوني'}] : []),
        ...(row.clientId ? [{id: 'client', label: 'فتح الموكل'}] : [])
      ],
      onRowClick: row => app.go(`exc:${row.id}`),
      onRowAction: async (id, row) => {
        if (id === 'open') return app.go(`exc:${row.id}`);
        if (id === 'collection') return simpleCollectionDialog(app, row.id);
        if (id === 'value') return valueSetupDialog(app, row.id);
        if (id === 'action') return simpleActionDialog(app, row.id);
        if (id === 'duration') return durationDialog(app, row.id, {lockExecution: true});
        if (id === 'statement') return statementDialog(app, row.id);
        if (id === 'edit') return executionDialog(app, {execution: row});
        if (id === 'file') return app.go(`file:${row.fileId}`);
        if (id === 'client') return app.go(`client:${row.clientId}`);
        return undefined;
      },
      onProviderState: ({phase, meta}) => {
        const note = root.querySelector('[data-counter-note]');
        if (!note) return;
        if (phase === 'error') { note.textContent = 'تعذر تحميل جزء من الصفوف — راجع الاتصال أو أعد المحاولة.'; return; }
        if (st.ready && st.counts) note.textContent = st.counted.toLocaleString('en-US') + ' تنفيذ' + (st.scannedAll ? ' (كل السجل)' : ' (أول ' + st.counted.toLocaleString('en-US') + ')') + (meta?.hasMore ? ' — توجد صفحات أخرى في الجدول.' : '');
      }
    });
    return grid;
  };

  const renderCounters = () => {
    const host = root.querySelector('[data-counters]');
    if (!host) return;
    host.innerHTML = COUNTERS.map(counter => `<button type="button" class="counter${st.count === counter.key ? ' is-active' : ''}" data-count="${counter.key}" aria-pressed="${st.count === counter.key}">
        <b>${st.counts ? Number(st.counts[counter.key] || 0).toLocaleString('en-US') : '…'}</b>
        <span>${counter.label}</span><small class="muted">${counter.hint}</small>
      </button>`).join('');
    host.querySelectorAll('[data-count]').forEach(button => button.addEventListener('click', async () => {
      st.count = st.count === button.dataset.count ? 'all' : button.dataset.count;
      prefs.set(COUNT_KEY, st.count);
      renderCounters();
      await reload();
    }));
  };

  const reload = async () => {
    const instance = ensureGrid();
    if (!instance) return;
    await instance.reload({resetPage: true});
  };

  const scanCounters = async () => {
    const batch = 100, cap = 300;
    const items = [];
    let cursor = null, hasMore = false;
    do {
      const page = await app.office.r.execution.page({index: 'openedDate', direction: 'prev', cursor, limit: batch});
      items.push(...(page.items || []).filter(row => !row.isDeleted));
      cursor = page.nextCursor || null;
      hasMore = Boolean(page.hasMore);
    } while (cursor && hasMore && items.length < cap);
    const counts = {running: 0, overdue: 0, needsFollowUp: 0, completed: 0};
    const today = localDate();
    for (let index = 0; index < items.length; index += 25) {
      const chunk = items.slice(index, index + 25);
      const hydrated = await S.hydrateSimpleRows(app.office, chunk).catch(() => []);
      for (const item of hydrated) {
        const key = item?.status?.key || 'running';
        if (counts[key] !== undefined) counts[key] += 1;
        const schedule = item?.schedule;
        const needs = !schedule?.rows?.length
          || schedule.rows.some(period => period.status !== PERIOD_STATUS.PAID && period.toDate < today)
          || Boolean(item?.nextAction);
        if (needs && counts.needsFollowUp !== undefined) counts.needsFollowUp += 1;
      }
    }
    return {counts, counted: items.length, scannedAll: !hasMore};
  };

  root.querySelector('[data-new-execution]')?.addEventListener('click', () => newExecutionDialog(app));
  root.querySelector('[data-demo-example]')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    const label = button.textContent;
    button.disabled = true;
    button.textContent = 'جارٍ التحميل…';
    try {
      const out = await seedFamilyExecutionExample(app.office);
      toast(out.reused ? 'المثال موجود بالفعل — نفتح بطاقته' : 'حُمِّل مثال عملي كامل: حكم + حكم لاحق + تحصيل + مصروف + توكيل');
      await app.go(`exc:${out.execution.id}`);
    } catch (error) {
      toast(userError(error), 'error');
      button.disabled = false;
      button.textContent = label;
    }
  });
  root.querySelector('[data-help]')?.addEventListener('click', () => openHelp(app));
  root.querySelector('[data-settings]')?.addEventListener('click', () => executionSettingsDialog(app));
  root.querySelector('[data-customize-page]')?.addEventListener('click', () => openPageCustomizer(app, {pageId: 'executionCenter', root}));
  root.querySelector('[data-exec-trash]')?.addEventListener('click', () => openExecutionTrash(app));
  root.querySelector('[data-exec-demo]')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const admin = await import('../services/data-admin.js');
      const existing = await admin.executionDemoStatus(app.office);
      if (existing.count) {
        if (!await confirmBox(`موجود ${existing.count} ملف تنفيذ تجريبي موسوم 〔تجريبي〕. تريد حذفها؟ (اختر «إلغاء» لتحميل ملفات جديدة فوقها)`, {okText: 'حذف الملفات التجريبية'})) {
          const out = await admin.seedExecutionDemoFiles(app.office);
          toast(`حُمِّل ${out.count} ملف تنفيذ تجريبي إضافي`);
          button.disabled = false;
          await reload();
          return;
        }
        const removed = await admin.removeExecutionDemoFiles(app.office);
        toast(`حُذف ${removed.removed} ملف تنفيذ تجريبي`, 'ok');
        button.disabled = false;
        await reload();
        return;
      }
      const out = await admin.seedExecutionDemoFiles(app.office);
      toast(`حُمِّل ${out.count} ملفات تنفيذ تجريبية جاهزة للمعاينة`, 'ok', {duration: 6000});
      await app.go(`exc:${out.created[0].execution.id}`);
    } catch (error) {
      toast(userError(error), 'error');
      button.disabled = false;
    }
  });
  root.querySelector('[data-exec-clear]')?.addEventListener('click', async () => {
    const answer = await confirmBox('مسح كل بيانات قسم التنفيذ؟ تُمسح التنفيذات وأحكامها وشرائح القيمة ومحاضر التحصيل والتوكيلات والفروق. بقية أقسام المكتب تبقى كما هي. اكتب سبب المسح ليُحفظ في السجل.', {okText: 'مسح قسم التنفيذ', input: true, label: 'سبب المسح'});
    if (!answer?.ok) return;
    if (!String(answer.value || '').trim()) { toast('السبب مطلوب', 'error'); return; }
    try {
      const admin = await import('../services/data-admin.js');
      const out = await admin.clearExecutionData(app.office, {reason: answer.value});
      const total = Object.values(out.counts).reduce((sum, value) => sum + Number(value || 0), 0);
      toast(`تم مسح ${total} سجلًا من قسم التنفيذ`, 'ok');
      await app.refresh();
    } catch (error) { toast(userError(error), 'error'); }
  });
  let searchTimer = 0;
  root.querySelector('[data-search]')?.addEventListener('input', event => {
    st.search = event.target.value;
    prefs.set('ui:exec:q', st.search);
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => reload().catch(error => app.fail(error)), 250);
  });
  root.querySelector('[data-clear-search]')?.addEventListener('click', async () => {
    st.search = ''; prefs.set('ui:exec:q', '');
    const input = root.querySelector('[data-search]');
    if (input) input.value = '';
    await reload();
  });

  // العدّادات تُحسب عند كل دخول للصفحة: كانت تُحسب مرة واحدة لكل جلسة (st.ready)
  // فتظل تعرض أصفارًا قديمة بعد أي إضافة أو حذف أو إلغاء حتى إعادة تحميل التطبيق.
  const refreshCounters = async () => {
    try {
      const out = await scanCounters();
      st.counts = out.counts; st.counted = out.counted; st.scannedAll = out.scannedAll; st.ready = true;
      if (!root.isConnected) return;
      renderCounters();
      const note = root.querySelector('[data-counter-note]');
      if (note) note.textContent = `العدّادات محسوبة على ${out.counted.toLocaleString('en-US')} ${out.scannedAll ? 'تنفيذ (كل السجل)' : 'تنفيذ (الأحدث)'} — والكتابة في الجدول تعرض كل الصفحات بالبحث.`;
    } catch {
      if (!root.isConnected) return;
      const note = root.querySelector('[data-counter-note]');
      if (note) note.textContent = 'تعذر حساب العدّادات — الجدول يعمل والبحث متاح.';
    }
  };

  renderCounters();
  await reload();
  await maybeSeedExecutionDemo(app, reload).catch(() => null);
  refreshCounters();
  return true;
}

/* ============================ سلة التنفيذ ============================ */
async function openExecutionTrash(app) {
  const card = modal(`<h2 class="modal-title">🗑 سلة التنفيذ</h2><p class="muted small">حذف منطقي فقط — الاستعادة لا تفقد أي سجل.</p><div data-list><p class="muted">جارٍ التحميل…</p></div><div class="form-actions"><button type="button" class="ghost" data-close>إغلاق</button></div>`);
  const host = card.querySelector('[data-list]');
  try {
    const page = await EX.listDeletedExecutions(app.office, {limit: 50});
    const rows = page.rows || [];
    if (!rows.length) { host.innerHTML = '<p class="muted">سلة التنفيذ فارغة.</p>'; return card; }
    host.innerHTML = '';
    for (const row of rows) {
      const item = document.createElement('div');
      item.className = 'trash-row';
      item.innerHTML = `<b>${esc(row.internalNumber || row.officialNumber || 'تنفيذ بلا رقم')}</b>
        <small class="muted">حُذف في ${esc(dateText(String(row.deletedAt || '').slice(0, 10)))}${row.deletionReason ? ` — ${esc(row.deletionReason)}` : ''}</small>
        <button type="button" class="ghost small">استعادة</button>`;
      item.querySelector('button').addEventListener('click', async () => {
        if (!await confirmBox('استعادة ملف التنفيذ وصفوفه؟')) return;
        try {
          await EX.restoreExecution(app.office, row.id, row.version ?? null);
          closeModal();
          toast('تمت الاستعادة');
          await app.refresh();
        } catch (error) { toast(userError(error), 'error'); }
      });
      host.append(item);
    }
  } catch (error) { host.innerHTML = `<p class="error">${esc(userError(error))}</p>`; }
  return card;
}

/* ============================ المساعدة ============================ */
export function openHelp(app) {
  const card = executionHelpDialog(app);
  card.querySelector('[data-demo-seed]')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const out = await seedFamilyExecutionExample(app.office);
      toast(out?.reused ? 'المثال التجريبي موجود بالفعل' : 'تم بناء المثال التجريبي');
      closeModal();
      await app.go(`exc:${out.execution.id}`);
    } catch (error) { toast(userError(error), 'error'); button.disabled = false; }
  });
  void familyExecutionExampleState;
  return card;
}

/* ============================ بطاقة التنفيذ ============================ */
export async function executionDetailPage(app, executionId) {
  registerPageLayout({
    pageId: 'execution:card', title: 'بطاقة التنفيذ',
    sections: [
      {id: 'toolbar', title: 'شريط الأزرار', canHide: false},
      {id: 'summary', title: 'الأرقام الثلاثة', canHide: false},
      {id: 'tabs', title: 'التبويبات', canHide: false},
      {id: 'panel', title: 'محتوى التبويب', canHide: false}
    ]
  });
  let bundle = null;
  try { bundle = await S.simpleCardBundle(app.office, executionId, {asOf: prefs.get(ASOF_KEY, '') || ''}); }
  catch (error) { return `<div class="error-box" role="alert"><h2>${esc(userError(error))}</h2><p class="muted small">قد يكون ملف التنفيذ محذوفًا. راجعه في سلة التنفيذ.</p><div class="error-actions"><button class="primary" data-route="executionCenter">رجوع إلى مركز التنفيذ</button></div></div>`; }
  cardState(app)[executionId] = bundle;
  const {execution, client, file, creditor, debtor, schedule, status} = bundle;
  const title = execution.internalNumber || execution.officialNumber || 'تنفيذ بلا رقم';
  const parties = `${esc(creditor?.name || client?.fullName || 'بلا موكل')} <span class="muted">ضد</span> ${esc(debtor?.name || 'بلا منفذ ضده')}`;
  const tab = TAB_LABELS[prefs.get(TAB_KEY, 'account')] ? prefs.get(TAB_KEY, 'account') : 'account';
  return `<div class="page-head exec-head"><div>
      <h2>${esc(title)} · ${parties}${file ? ` · ملف ${esc(formatFileNumber(file.fileNumber))}` : ''} <span class="exec-status exec-status-${esc(status.key)}">${esc(status.label)}</span></h2>
      <p class="muted small">${esc(EXECUTION_TYPE_LABELS[execution.executionType] || 'نوع غير محدد')}${execution.authority ? ` · ${esc(execution.authority)}` : ''} · فُتح في ${esc(dateText(execution.openedDate))}</p>
    </div><div class="head-actions">
      <button class="ghost" data-route="executionCenter">↩ المركز</button>
      <button class="ghost" data-help>؟ مساعدة</button>
      <button class="ghost" data-settings>⚙ إعدادات</button>
      ${file ? `<button class="ghost" data-route="file:${esc(file.id)}">الملف القانوني</button>` : ''}
      <button class="ghost danger" data-delete-execution>حذف ملف التنفيذ</button>
    </div></div>
  <section class="panel exec-toolbar" data-section-id="toolbar">
    <div class="exec-actions">
      <button class="primary" data-record>+ تسجيل</button>
      <button class="ghost" data-open-duration>🧮 احسب مدة</button>
      <button class="ghost" data-open-statement>🖨 كشف / توكيل</button>
      <button class="ghost" data-more aria-haspopup="true" aria-expanded="false">⋮ المزيد</button>
    </div>
    <div class="exec-more-menu" data-more-menu hidden>
      <button type="button" data-action="edit">تعديل بيانات التنفيذ</button>
      <button type="button" data-action="party">إضافة/تعديل طرف</button>
      <button type="button" data-action="value">قيمة النفقة (البند والدورية)</button>
      <button type="button" data-action="later-judgment">حكم لاحق</button>
      <button type="button" data-action="expense">تسجيل مصروف/رسم</button>
      <button type="button" data-action="poa">توكيل جديد</button>
      <button type="button" data-action="lifecycle">إيقاف/إغلاق (بسبب)</button>
      <button type="button" data-action="advanced">أدوات متقدمة (اختيارية)…</button>
    </div>
  </section>
  ${summarySectionMarkup(bundle)}
  ${tabsMarkup(tab)}
  <div class="exec-tab-panel" data-tab-panel>${renderTab(bundle, tab)}</div>`;
}

/** تنبيه للتنفيذ المسجَّل بنموذج FEAS القديم: نعرض رقمًا واحدًا متوافقًا مع آخر فترة معترف بها. */
function feasNote(bundle) {
  if (String(bundle.execution?.accountingModel || '') !== 'feas-v1') return '';
  const ends = (bundle.periods || []).filter(row => !row.isDeleted && ['RECOGNIZED', 'CLOSED'].includes(String(row.status || ''))).map(row => (isCivilDate(row.toDate) ? row.toDate : '')).filter(Boolean).sort();
  const through = ends.at(-1) || '';
  return `<p class="hint hint-info">هذا التنفيذ مسجَّل بنموذج «اعتراف الفترات» (FEAS): الحساب أعلاه يقف عند آخر فترة معترف بها${through ? ` (<b>${esc(dateText(through))}</b>)` : ''} فلا يتعارض مع الرصيد المعترف به، والاعتراف نفسه كما هو في <button type="button" class="link" data-action="advanced">أدوات متقدمة</button>.</p>`;
}

/** تنفيذ FEAS فيه قيمة بلا اعتراف: لا رقم بعد، والخطوة التالية واضحة بزر واحد. */
function feasRecognitionHint(bundle) {
  if (String(bundle.execution?.accountingModel || '') !== 'feas-v1') return '';
  const recognized = (bundle.periods || []).filter(row => !row.isDeleted && ['RECOGNIZED', 'CLOSED'].includes(String(row.status || '')));
  if (recognized.length) return '';
  const slices = (bundle.slices || []).filter(slice => !slice.isDeleted && !['cancelled', 'superseded'].includes(String(slice.status || '')));
  if (!slices.length) return '';
  return `<div class="hint hint-warn feas-next-step">لا يظهر مبلغ بعد: هذا التنفيذ على نموذج FEAS، والقيمة وحدها لا تُنشئ دينًا. الخطوة التالية: <button type="button" class="link" data-action="feas-recognize">اعتراف بفترة</button> — تعاين المدة ثم تعتمدها فيظهر المستحق والمدفوع والمتبقي.</div>`;
}

/** ملاحظة صريحة إن كان الحساب متوقفًا عند «تاريخ الاستحقاق حتى» المسجَّل على التنفيذ. */
function cappedNote(bundle) {
  const through = bundle.execution?.entitlementThroughDate || '';
  if (!isCivilDate(through) || through >= localDate()) return '';
  const lastPeriod = (bundle.schedule?.rows || []).at(-1);
  if (lastPeriod && lastPeriod.toDate < through) return '';
  return `<p class="hint hint-info">الاستحقاق متوقف عند <b>${esc(dateText(through))}</b> لأن «تاريخ الاستحقاق حتى» مسجَّل على التنفيذ — والتحصيل بعد هذا التاريخ يُخصم من المتبقي ولا يُنشئ فترات جديدة. عدّله من <button type="button" class="link" data-action="edit">تعديل بيانات التنفيذ</button> إذا استمر الاستحقاق بعده.</p>`;
}

/**
 * سطر الفترة الجارية: لا يظهر أي رقم في «المطلوب» قبل اكتمال الفترة (قاعدة
 * مكتب قابلة للتغيير من الإعدادات)، لكننا لا نترك البطاقة بلا رقم ولا سبب —
 * نعرض مبلغ الفترة الجارية المتوقع وتاريخ استحقاقه صراحةً بدل أصفار غامضة.
 */
function runningPeriodNote(bundle) {
  const rows = (bundle.schedule?.rows || []).filter(row => row.status === PERIOD_STATUS.RUNNING);
  if (!rows.length) return '';
  const currency = bundle.schedule.currency;
  const projected = rows.reduce((sum, row) => sum + Number(row.projectedMinor || 0), 0);
  const dueOn = rows.map(row => row.toDate).filter(Boolean).sort().at(-1) || '';
  const list = rows.slice(0, 4).map(row => `${esc(dateText(row.fromDate))} – ${esc(dateText(row.toDate))}`).join(' · ');
  return `<p class="hint hint-info">⏳ <b>فترة جارية لم تكتمل:</b> ${list} — قيمتها المتوقعة <b>${money(projected, currency)}</b>${dueOn ? ` وتُستحق في <b>${esc(dateText(dueOn))}</b>` : ''}. لا تدخل في «المطلوب» أعلاه إلا باكتمالها؛ ويمكن احتسابها من بدايتها بتغيير «توقيت الاستحقاق» في <button type="button" class="link" data-settings>إعدادات التنفيذ</button>.</p>`;
}

function summarySectionMarkup(bundle) {
  const {schedule, expenses, hints, lastAction, nextAction} = bundle;
  const totals = schedule.totals;
  const currency = schedule.currency;
  const progress = totals.dueMinor > 0 ? Math.min(100, Math.round((totals.allocatedMinor / totals.dueMinor) * 100)) : 0;
  const expensesMinor = expenses.reduce((sum, item) => sum + item.amountMinor, 0);
  return `<section class="panel exec-summary" data-section-id="summary">
    <div class="asof-row">
      <label>المطلوب حتى <input type="date" data-asof value="${esc(schedule.asOf)}" aria-label="تاريخ الحساب"></label>
      ${schedule.asOf && schedule.asOf !== localDate() ? `<button type="button" class="ghost small" data-asof-today>↺ ارجع إلى اليوم</button><span class="hint hint-warn small">الحساب موقوف عند تاريخ قديم — هذا يخفي الأرقام عن كل التنفيذات حتى تعيده إلى اليوم.</span>` : ''}
      <span class="muted small">غيّر التاريخ تغيّر الأرقام والجدول فورًا — بلا أي خطوة أخرى.</span>
    </div>
    ${cappedNote(bundle)}
    <div class="exec-numbers">
      <button type="button" class="num" data-trace="due"><span>المطلوب حتى ${esc(dateText(schedule.asOf))}</span><b>${moneyShort(totals.dueMinor, currency)}</b><small>ج.م · اضغط للتفسير</small></button>
      <button type="button" class="num" data-trace="paid"><span>المدفوع</span><b>${moneyShort(totals.paidMinor, currency)}</b><small>${totals.creditMinor > 0 ? `منه رصيد دائن ${moneyShort(totals.creditMinor, currency)}` : 'من المحاضر المسجلة'}</small></button>
      <button type="button" class="num num-primary" data-trace="remaining"><span>المتبقي</span><b>${moneyShort(totals.remainingMinor, currency)}</b><small>ج.م · اضغط للتفسير</small></button>
    </div>
    <div class="progress" role="progressbar" aria-valuenow="${progress}" aria-valuemin="0" aria-valuemax="100" aria-label="نسبة المسدد"><span style="width:${progress}%"></span></div>
    ${runningPeriodNote(bundle)}
    <p class="muted small">مسدد ${progress}%${totals.unpaidPeriods ? ` · فترات غير مسددة: ${totals.unpaidPeriods}` : ''}${totals.partialPeriods ? ` · جزئية: ${totals.partialPeriods}` : ''}${expensesMinor ? ` · <b>مصروفات ${money(expensesMinor, currency)}</b> (سطر مستقل — لا تزيد أصل الدين)` : ''}${totals.overpaidMinor > 0 ? ` · دفعة زائدة ${money(totals.overpaidMinor, currency)} (بلا رد تلقائي)` : ''}</p>
    <p class="exec-lines">آخر إجراء: <b>${esc(lastAction ? `${lastAction.kindLabel || lastAction.kind} — ${dateText(lastAction.date)}` : 'لا يوجد بعد')}</b> · الإجراء التالي: <b>${esc(nextAction ? `${nextAction.nextAction || 'إجراء'} — ${dateText(nextAction.nextActionDate)}` : 'غير محدد')}</b></p>
    ${hints.length ? `<div class="completion-bar">${hints.map(hint => `<span class="hint hint-${esc(hint.severity)}">${esc(hint.message)} <button type="button" class="link" data-hint-action="${esc(hint.action)}">${esc(hint.actionLabel)}</button></span>`).join('')}</div>` : ''}
  </section>`;
}

function tabsMarkup(active) {
  return `<nav class="exec-tabs" role="tablist" aria-label="أقسام البطاقة">${Object.entries(TAB_LABELS).map(([key, label]) => `<button type="button" role="tab" class="exec-tab${active === key ? ' is-active' : ''}" data-tab="${key}" aria-selected="${active === key}">${label}</button>`).join('')}</nav>`;
}

/* ============================ محتوى التبويبات ============================ */
function renderTab(bundle, tab) {
  if (tab === 'log') return logTabMarkup(bundle);
  if (tab === 'data') return dataTabMarkup(bundle);
  if (tab === 'poa') return poaTabMarkup(bundle);
  return accountTabMarkup(bundle);
}

function accountTabMarkup(bundle) {
  const {schedule, execution} = bundle;
  const currency = schedule.currency;
  const filter = prefs.get(accountFilterKey(execution.id), 'all');
  if (!schedule.rows.length) {
    // حالة فراغ موجَّهة: FEAS يحتاج «اعترافًا» أولًا، والمسار المبسّط يحتاج القيمة والدورية.
    const feasHint = feasRecognitionHint(bundle);
    if (feasHint) return `<section class="panel" data-collapse-default="open"><h3>الكشف الشهري</h3>${feasHint}
      <div class="form-actions"><button class="primary" data-action="feas-recognize">اعتراف بفترة</button><button class="ghost" data-open-duration>🧮 احسب مدة</button></div></section>`;
    return `<section class="panel" data-collapse-default="open"><h3>الكشف الشهري</h3>
      <p class="muted">لا توجد فترات محسوبة بعد. أدخل القيمة والدورية وتاريخ السريان ليُبنى الجدول تلقائيًا — بلا أي خطوة إضافية.</p>
      <div class="form-actions"><button class="primary" data-action="value">أدخل القيمة والدورية</button><button class="ghost" data-open-duration>🧮 احسب مدة</button></div></section>`;
  }
  const rows = schedule.rows.filter(row => (filter === 'unpaid' ? row.status !== PERIOD_STATUS.PAID : filter === 'paid' ? row.status === PERIOD_STATUS.PAID : true));
  const years = new Map();
  for (const row of rows) {
    const year = row.fromDate.slice(0, 4);
    if (!years.has(year)) years.set(year, []);
    years.get(year).push(row);
  }
  const yearMarkup = [...years.entries()].sort().map(([year, list], index) => `
    <details class="year-group"${index === 0 ? ' open' : ''}>
      <summary>سنة ${esc(year)} — ${list.length} فترة · متبقٍ ${money(list.reduce((sum, row) => sum + row.remainingMinor, 0), currency)}</summary>
      <div class="exec-table-wrap"><table class="exec-table account-table">
        <thead><tr><th>الفترة</th><th>المستحق</th><th>المدفوع</th><th>المتبقي</th><th>الحالة</th><th></th></tr></thead>
        <tbody>${list.map(row => `<tr class="${row.status === PERIOD_STATUS.PAID ? 'is-paid' : row.status === PERIOD_STATUS.PARTIAL ? 'is-partial' : 'is-unpaid'}">
          <td>${esc(row.label)}${row.valueChanges.length ? '<button type="button" class="info-dot" data-change="' + esc(row.fromDate) + '" title="تغيّرت القيمة بحكم لاحق">ⓘ</button>' : ''}${row.overpaidMinor > 0 ? '<span class="badge warn">دفعة زائدة</span>' : ''}</td>
          <td>${money(row.dueMinor, currency)}</td>
          <td>${money(row.paidMinor, currency)}</td>
          <td><b>${money(row.remainingMinor, currency)}</b></td>
          <td>${statusChip(row.status)}</td>
          <td class="exec-cell-actions"><button type="button" class="ghost small" data-row-info="${esc(row.fromDate)}">تفاصيل</button><button type="button" class="ghost small" data-pin-collection="${esc(row.fromDate)}">تحصيل هنا</button></td>
        </tr>`).join('')}</tbody>
        <tfoot><tr><td>إجمالي ${esc(year)}</td><td>${money(list.reduce((sum, row) => sum + row.dueMinor, 0), currency)}</td><td>${money(list.reduce((sum, row) => sum + row.paidMinor, 0), currency)}</td><td><b>${money(list.reduce((sum, row) => sum + row.remainingMinor, 0), currency)}</b></td><td></td><td></td></tr></tfoot>
      </table></div>
    </details>`).join('');
  return `<section class="panel" data-collapse-default="open">
    <div class="panel-head"><h3>الكشف الشهري</h3>
      <div class="quick-chips">${[['all', 'الكل'], ['unpaid', 'غير المسدد'], ['paid', 'المسدد']].map(([key, label]) => `<button type="button" class="chip${filter === key ? ' is-active' : ''}" data-account-filter="${key}">${label}</button>`).join('')}</div>
    </div>
    ${feasNote(bundle)}
    ${feasRecognitionHint(bundle)}
    <p class="muted small">الجدول مشتق وقت العرض من قيمة الحكم ومن التحصيلات؛ لا فترات مستقبلية مخزّنة، والتوزيع التلقائي «الأقدم أولًا» قابل للتغيير من الإعدادات.</p>
    ${yearMarkup}
    <p class="muted small">المعروض: مستحق ${money(rows.reduce((sum, row) => sum + row.dueMinor, 0), currency)} · مدفوع ${money(rows.reduce((sum, row) => sum + row.paidMinor, 0), currency)} · متبقٍ <b>${money(rows.reduce((sum, row) => sum + row.remainingMinor, 0), currency)}</b></p>
    <div class="form-actions"><button type="button" class="ghost" data-open-duration>🧮 احسب مدة</button><button type="button" class="ghost" data-trace="remaining">كيف حُسب المتبقي؟</button></div>
  </section>`;
}

function logTabMarkup(bundle) {
  const items = timelineItems(bundle);
  const types = [...new Set(items.map(item => item.group))];
  return `<section class="panel" data-collapse-default="open">
    <div class="panel-head"><h3>السجل — كل ما حدث على هذا التنفيذ</h3><span class="badge">${items.length} واقعة</span></div>
    <div class="exec-controls">
      <select data-log-type aria-label="تصفية النوع"><option value="">كل الأنواع</option>${types.map(type => `<option value="${esc(type)}">${esc(type)}</option>`).join('')}</select>
      <input type="date" data-log-from aria-label="من تاريخ"><input type="date" data-log-to aria-label="إلى تاريخ">
      <input type="search" data-log-q placeholder="بحث في السجل" aria-label="بحث في السجل">
      <label class="check-line"><input type="checkbox" data-log-voided> إظهار الملغى</label>
    </div>
    <ol class="exec-log" data-log-list>${items.map(logItemMarkup).join('') || '<li class="muted">لا توجد وقائع بعد. ابدأ من «+ تسجيل».</li>'}</ol>
    <p class="muted small">الإلغاء لا يحذف: السجل يبقى مشطوبًا مع السبب، وتعديل أي سجل يحفظ نسخته السابقة.</p>
  </section>`;
}

function timelineItems(bundle) {
  const currency = bundle.schedule.currency;
  const ledgerById = new Map((bundle.ledger || []).map(row => [row.id, row]));
  const items = [];
  for (const judgment of bundle.judgments || []) {
    items.push({
      id: judgment.id, kind: 'judgment', group: 'أحكام', icon: '⚖️', date: judgment.judgmentDate || judgment.effectiveFrom || '',
      title: `${judgment.judgmentKind === 'later' ? 'حكم لاحق' : 'حكم'}${judgment.judgmentNumber ? ` — ${judgment.judgmentNumber}` : ''}`,
      subtitle: [judgment.court, judgment.effectiveFrom ? `يسري من ${dateText(judgment.effectiveFrom)}` : '', judgment.amount ? `القيمة ${Number(judgment.amount).toLocaleString('en-US')}` : ''].filter(Boolean).join(' · '),
      amountMinor: judgment.amount ? Math.round(Number(judgment.amount) * 100) : 0, currency,
      voided: Boolean(judgment.isDeleted), canEdit: !judgment.isDeleted, canVoid: !judgment.isDeleted
    });
  }
  for (const slice of bundle.slices || []) {
    const state = String(slice.status || '');
    items.push({
      id: slice.id, kind: 'slice', group: 'بنود القيمة', icon: '📊', date: slice.startDate,
      title: `بند قيمة: ${slice.entitlementType} — ${slice.valueType === 'fixed' ? 'مبلغ مقطوع' : `${Number(slice.amount || 0).toLocaleString('en-US')} ${slice.periodicity === 'monthly' ? 'شهريًا' : slice.periodicity || ''}`}`,
      subtitle: `يسري من ${dateText(slice.startDate)}${slice.endDate ? ` حتى ${dateText(slice.endDate)}` : ''}${['cancelled', 'superseded'].includes(state) ? ` — ${state === 'cancelled' ? 'ملغاة' : 'استُبدلت'}` : ''}`,
      amountMinor: 0, currency, voided: ['cancelled', 'superseded'].includes(state),
      canEdit: false, canVoid: !['cancelled', 'superseded'].includes(state)
    });
  }
  for (const receipt of bundle.receipts || []) {
    const voided = String(receipt.status || '') === 'voided';
    items.push({
      id: receipt.id, kind: 'receipt', group: 'تحصيلات', icon: '💰', date: receipt.date,
      title: `تحصيل ${Number(receipt.amount || 0).toLocaleString('en-US')} ج.م${receipt.receiptNumber ? ` — ${receipt.receiptNumber}` : ''}`,
      subtitle: [receipt.paymentMethod, receipt.reference, receipt.allocationMethod === 'DIRECT' ? 'مخصص لشهر محدد' : 'توزيع تلقائي (الأقدم أولًا)', receipt.notes].filter(Boolean).join(' · '),
      amountMinor: Math.round(Number(receipt.amount || 0) * 100), currency, voided,
      canEdit: !voided, canVoid: !voided, canReallocate: !voided, revisions: (receipt.revisions || []).length
    });
  }
  for (const expense of bundle.expenses || []) {
    items.push({
      id: expense.id, kind: 'expense', group: 'مصروفات ورسوم', icon: '🧾', date: expense.date,
      title: `${expense.label} — ${Number(expense.amount || 0).toLocaleString('en-US')} ج.م`,
      subtitle: [expense.includeInPoa ? 'يدخل التوكيل' : 'لا يدخل التوكيل', expense.borneByLabel ? `يتحمله: ${expense.borneByLabel}` : '', expense.notes].filter(Boolean).join(' · '),
      amountMinor: expense.amountMinor, currency,
      voided: String(ledgerById.get(expense.id)?.status || '') === 'voided', canEdit: false, canVoid: true
    });
  }
  for (const action of bundle.actions || []) {
    const voided = String(action.status || '') === 'voided' || Boolean(action.isDeleted);
    items.push({
      id: action.id, kind: 'action', group: 'إجراءات', icon: '📄', date: action.date,
      title: `${action.kindLabel || action.kind || 'إجراء'}`,
      subtitle: [action.referenceNumber, action.authority, action.nextActionDate ? `التالي: ${action.nextAction} — ${dateText(action.nextActionDate)}` : '', action.notes].filter(Boolean).join(' · '),
      amountMinor: 0, currency, voided, canEdit: !voided, canVoid: !voided
    });
  }
  for (const poa of bundle.poas || []) {
    const cancelled = String(poa.status || '') === 'cancelled';
    items.push({
      id: poa.id, kind: 'poa', group: 'توكيلات', icon: '🖨', date: poa.date,
      title: `توكيل${poa.poaNumber ? ` ${poa.poaNumber}` : ''} — ${Number(poa.total || 0).toLocaleString('en-US')} ج.م`,
      subtitle: `عن ${dateText(poa.fromDate)} ← ${dateText(poa.toDate)}`,
      amountMinor: Math.round(Number(poa.total || 0) * 100), currency, voided: cancelled, canPrint: true, canVoid: !cancelled, canReissue: true
    });
  }
  return items.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
}

function logItemMarkup(item) {
  return `<li class="log-item${item.voided ? ' is-voided' : ''}" data-log-item="${esc(item.id)}" data-type="${esc(item.group)}" data-date="${esc(item.date || '')}" data-voided="${item.voided ? '1' : ''}">
    <span class="log-icon" aria-hidden="true">${item.icon}</span>
    <div class="log-body">
      <b>${esc(item.title)}</b>
      <small class="muted">${esc(dateText(item.date))}${item.subtitle ? ` · ${esc(item.subtitle)}` : ''}${item.revisions ? ` · <span class="badge">معدَّل (${item.revisions})</span>` : ''}${item.voided ? ' · <span class="badge danger">ملغى</span>' : ''}</small>
    </div>
    <div class="log-actions">
      ${item.canEdit ? `<button type="button" class="ghost small" data-edit="${esc(item.id)}" data-kind="${esc(item.kind)}">تعديل</button>` : ''}
      ${item.canReallocate ? `<button type="button" class="ghost small" data-reallocate="${esc(item.id)}">إعادة توزيع</button>` : ''}
      ${item.canPrint ? `<button type="button" class="ghost small" data-print-poa="${esc(item.id)}">طباعة</button>` : ''}
      ${item.canReissue ? `<button type="button" class="ghost small" data-reissue-poa="${esc(item.id)}">توكيل جديد</button>` : ''}
      ${item.canVoid ? `<button type="button" class="ghost small danger" data-void="${esc(item.id)}" data-kind="${esc(item.kind)}">إلغاء</button>` : ''}
    </div>
  </li>`;
}

function dataTabMarkup(bundle) {
  const {execution, client, file, creditor, debtor, slices, judgments, parties, periods} = bundle;
  const valueLines = (slices || []).filter(slice => !slice.isDeleted).map(slice => {
    const judgment = (judgments || []).find(row => row.id === (slice.judgmentId || slice.linkedJudgmentId));
    const state = String(slice.status || '');
    const badge = ['cancelled', 'superseded'].includes(state) ? ` <span class="badge danger">${state === 'cancelled' ? 'ملغاة' : 'استُبدلت'}</span>` : '';
    return `<li><b>${esc(slice.entitlementType)}</b>: ${Number(slice.amount || 0).toLocaleString('en-US')} ج.م ${slice.valueType === 'fixed' ? 'مبلغ مقطوع' : slice.periodicity === 'monthly' ? 'شهريًا' : esc(slice.periodicity || '')} من ${esc(dateText(slice.startDate))}${slice.endDate ? ` حتى ${esc(dateText(slice.endDate))}` : ''}${judgment ? ` — ${judgment.judgmentKind === 'later' ? 'حكم لاحق' : 'حكم'}${judgment.judgmentNumber ? ` رقم ${esc(judgment.judgmentNumber)}` : ''}` : ''}${badge}</li>`;
  }).join('');
  const snapshotRows = (periods || []).filter(period => !period.isDeleted).map(period => `<li>مطالبة مثبتة ${esc(dateText(period.fromDate))} → ${esc(dateText(period.toDate))} بمبلغ ${money(Math.round(Number(period.recognizedAmount ?? 0) * 100) || Number(period.recognizedAmountMinor || 0))} <span class="muted">(لقطة محفوظة لا تتغير)</span></li>`).join('');
  const partyLines = (parties || []).filter(party => !party.isDeleted).map(party => `<li><b>${party.side === 'debtor' ? 'منفذ ضده' : 'من يستحق'}:</b> ${esc(party.name)}${party.role ? ` <span class="muted">(${esc(party.role)})</span>` : ''}</li>`).join('');
  return `<section class="panel" data-collapse-default="open">
    <div class="panel-head"><h3>بيانات التنفيذ</h3><button type="button" class="ghost small" data-action="edit">تعديل</button></div>
    <div class="exec-kv">
      <span>الموكل</span><b>${esc(client?.fullName || creditor?.name || '—')}</b>
      <span>المنفذ ضده</span><b>${esc(debtor?.name || '—')}</b>
      <span>الملف</span><b>${file ? esc(`${formatFileNumber(file.fileNumber)} — ${file.title || ''}`) : '—'}</b>
      <span>رقم التنفيذ الرسمي</span><b>${esc(execution.officialNumber || execution.executionNumber || '—')}</b>
      <span>الجهة / المحكمة</span><b>${esc(execution.authority || '—')}</b>
      <span>طريقة التنفيذ</span><b>${esc(execution.executionMethod || '—')}</b>
      <span>تاريخ الفتح</span><b>${esc(dateText(execution.openedDate))}</b>
      <span>ملاحظات</span><b>${esc(execution.notes || '—')}</b>
    </div>
  </section>
  <section class="panel">
    <div class="panel-head"><h3>قيمة النفقة عبر الزمن (بنود القيمة)</h3><button type="button" class="ghost small" data-action="value">إدخال/تعديل القيمة</button></div>
    <ul class="plain-list">${valueLines || '<li class="muted">لم تُحدَّد قيمة بعد — أدخل القيمة والدورية ليبدأ الجدول.</li>'}</ul>
    <button type="button" class="ghost small" data-action="later-judgment">+ حكم لاحق (زيادة/تخفيض)</button>
  </section>
  <section class="panel">
    <div class="panel-head"><h3>أطراف التنفيذ</h3><button type="button" class="ghost small" data-action="party">إضافة طرف</button></div>
    <ul class="plain-list">${partyLines || '<li class="muted">لا أطراف مسجلة بعد.</li>'}</ul>
  </section>
  ${snapshotRows ? `<section class="panel"><div class="panel-head"><h3>مطالبات مثبتة (لقطات محفوظة)</h3></div><ul class="plain-list">${snapshotRows}</ul></section>` : ''}
  <section class="panel advanced-anchor">
    <div class="panel-head"><h3>أدوات متقدمة (اختيارية)</h3></div>
    ${String(bundle.execution?.accountingModel || '') === 'feas-v1'
      ? '<p class="muted small">هذا التنفيذ على نموذج FEAS (اعتراف صريح بفترات): لا يدخل الرصيد إلا ما اعتُرف به، والقرار يمرّ بمراجعتك. لا تُحذف أي بيانات ولا يتغيّر أي رقم ظاهر.</p>'
      : `<p class="muted small">هذا التنفيذ على <b>المسار المبسط</b> (الحساب تلقائي من الحكم والمبلغ) فلا تحتاج هذه الأدوات. ومسار FEAS (التزام صريح + اعتراف بفترات + مراجعة فروق) متاح إن طلبه مكتبك، ويُفعَّل على تنفيذ <b>فارغ من أي أرقام مالية</b> فقط.</p>
        <div class="form-actions"><button type="button" class="ghost small" data-action="enable-feas">تفعيل مسار FEAS لهذا التنفيذ</button></div>`}
    <div class="form-actions">
      <button type="button" class="ghost small" data-action="feas-obligation">التزام FEAS</button>
      <button type="button" class="ghost small" data-action="feas-recognize">اعتراف بفترة</button>
      <button type="button" class="ghost small" data-action="settlement">تسوية فروق</button>
      <button type="button" class="ghost small" data-action="snapshot">الرصيد في تاريخ</button>
      <button type="button" class="ghost small" data-action="compare">مقارنة حكمين</button>
      <button type="button" class="ghost small" data-action="simulate">محاكاة تغيير قيمة</button>
      <button type="button" class="ghost small" data-action="print-balance">كشف الرصيد (القديم)</button>
    </div>
  </section>`;
}

function poaTabMarkup(bundle) {
  const {poas, schedule} = bundle;
  const currency = schedule.currency;
  return `<section class="panel" data-collapse-default="open">
    <div class="panel-head"><h3>التوكيلات المحفوظة</h3><button type="button" class="ghost small" data-action="poa">+ توكيل جديد</button></div>
    ${poas.length ? `<div class="exec-table-wrap"><table class="exec-table"><thead><tr><th>التاريخ</th><th>الرقم</th><th>المدة</th><th>الإجمالي</th><th>الحالة</th><th></th></tr></thead><tbody>
      ${poas.map(poa => `<tr><td>${esc(dateText(poa.date))}</td><td>${esc(poa.poaNumber || '—')}</td><td>${esc(dateText(poa.fromDate))} ← ${esc(dateText(poa.toDate))}</td><td>${money(Math.round(Number(poa.total || 0) * 100), currency)}</td><td>${String(poa.status || '') === 'cancelled' ? 'ملغى' : 'محفوظ (نسخة ثابتة)'}</td>
        <td class="exec-cell-actions"><button type="button" class="ghost small" data-print-poa="${esc(poa.id)}">طباعة</button><button type="button" class="ghost small" data-reissue-poa="${esc(poa.id)}">توكيل جديد</button>${String(poa.status || '') === 'cancelled' ? '' : `<button type="button" class="ghost small danger" data-void="${esc(poa.id)}" data-kind="poa">إلغاء</button>`}</td></tr>`).join('')}
    </tbody></table></div>` : '<p class="muted">لا توكيلات بعد.</p>'}
    <p class="muted small">قاعدة منع الازدواج: «الرصيد السابق جزء من المتبقي ولا يُضاف عليه مرة ثانية» — إصدار التوكيل لا يغيّر المتبقي أبدًا.</p>
  </section>
  <section class="panel">
    <div class="panel-head"><h3>كشف الحساب والطباعة</h3></div>
    <div class="form-actions">
      <button type="button" class="ghost" data-statement-mode="summary">كشف ملخص</button>
      <button type="button" class="ghost" data-statement-mode="monthly">كشف تفصيلي شهري</button>
      <button type="button" class="ghost" data-statement-mode="range">كشف عن مدة</button>
      <button type="button" class="ghost" data-open-duration>🧮 احسب مدة</button>
    </div>
    <p class="muted small">الطباعة تمر عبر نظام PrintContext القائم (نفس التنسيق والترويسة)، والأرقام بفواصل آلاف والعملة ظاهرة.</p>
  </section>`;
}

/* ============================ ربط البطاقة ============================ */
export async function bindExecutionDetail(app, executionId) {
  const root = document.querySelector('#main-content');
  const bundle = cardState(app)[executionId];
  if (!root || !bundle) return false;
  const panel = root.querySelector('[data-tab-panel]');
  const guard = fn => (...args) => Promise.resolve().then(() => fn(...args)).catch(error => toast(userError(error), 'error'));

  const openRecord = () => recordSheet(app, executionId, {bundle});
  const openCollection = (receipt = null, periodKey = '') => simpleCollectionDialog(app, executionId, {bundle, receipt, periodKey});
  const openAction = action => simpleActionDialog(app, executionId, {action});
  const openValue = () => valueSetupDialog(app, executionId, {bundle});
  const openLaterJudgment = () => subsequentJudgmentDialog(app, executionId, {bundle});
  const openPoa = (fromDate = '', toDate = '') => simplePoaDialog(app, executionId, {bundle, fromDate, toDate});
  const openStatement = () => statementDialog(app, executionId);

  const runAction = {
    edit: () => executionDialog(app, {execution: bundle.execution}),
    party: async () => {
      const [clients, opponents] = await Promise.all([
        app.office.r.clients.page({index: 'createdAt', direction: 'prev', limit: 100}).then(page => page.items || []).catch(() => []),
        app.office.r.opponents.page({index: 'createdAt', direction: 'prev', limit: 100}).then(page => page.items || []).catch(() => [])
      ]);
      return partyDialog(app, executionId, {clients, opponents});
    },
    value: openValue,
    'later-judgment': openLaterJudgment,
    expense: () => simpleExpenseDialog(app, executionId),
    poa: () => openPoa(),
    collection: () => openCollection(),
    lifecycle: async () => {
      const answer = await confirmBox('إيقاف هذا التنفيذ مؤقتًا؟ اكتب السبب ليُحفظ في السجل (الحالة الوحيدة التي تضبطها بنفسك).', {okText: 'إيقاف', input: true, label: 'سبب الإيقاف'});
      if (!answer?.ok) return undefined;
      if (!String(answer.value || '').trim()) { toast('السبب مطلوب', 'error'); return undefined; }
      await S.setExecutionLifecycle(app.office, executionId, {state: 'suspended', reason: answer.value});
      toast('تم إيقاف التنفيذ — يمكنك إعادته إلى «جارٍ» من نفس القائمة');
      await app.refresh();
      return undefined;
    },
    resume: async () => {
      await S.setExecutionLifecycle(app.office, executionId, {state: 'running', reason: ''});
      toast('عاد التنفيذ إلى «جارٍ»');
      await app.refresh();
      return undefined;
    },
    advanced: () => showTab('data', {scrollTo: '.advanced-anchor'}),
    'enable-feas': async () => {
      if (String(bundle.execution?.accountingModel || '') === 'feas-v1') { toast('هذا التنفيذ على نموذج FEAS بالفعل'); return undefined; }
      const answer = await confirmBox('تفعيل مسار FEAS لهذا التنفيذ؟ FEAS لا يحتسب أي مبلغ إلا بعد «اعتراف صريح» بكل فترة، وهو للمتمرسين. التفعيل ممكن الآن فقط لأن التنفيذ بلا أي أرقام مالية؛ وبعد إدخال أرقام لا يعود النموذج قابلاً للتغيير.', {okText: 'تفعيل FEAS'});
      if (!answer) return undefined;
      const out = await S.enableFeasModel(app.office, executionId);
      toast(out.reused ? 'النموذج مفعَّل بالفعل' : 'فُعِّل مسار FEAS — ابدأ بتعريف الالتزام');
      await app.refresh();
      return undefined;
    },
    'feas-obligation': async () => {
      const FEAS = await import('../services/execution-feas.js');
      const obligations = await FEAS.executionObligations(app.office, executionId).catch(() => []);
      // التزام واحد ⇒ النافذة تُفتح تعديلًا لا إنشاءً جديدًا (لا تكرار بلا داعٍ).
      return executionObligationDialog(app, executionId, {parties: bundle.parties, obligation: obligations.length === 1 ? obligations[0] : null});
    },
    'feas-recognize': async () => {
      const FEAS = await import('../services/execution-feas.js');
      const obligations = await FEAS.executionObligations(app.office, executionId).catch(() => []);
      if (!obligations.length) { toast('لا يوجد التزام FEAS معرّف — أضف التزامًا أولًا', 'error'); return undefined; }
      return recognitionDialog(app, executionId, obligations);
    },
    settlement: async () => {
      const candidates = (bundle.slices || []).filter(slice => slice.valueType !== 'fixed');
      if (!candidates.length) { toast('أضف بند قيمة أولًا', 'error'); return undefined; }
      const out = await DF.createSettlement(app.office, {executionId, sliceId: candidates[candidates.length - 1].id, note: 'تسوية من البطاقة'});
      if (out?.settlement?.id) await settlementReviewDialog(app, out.settlement.id);
      return undefined;
    },
    snapshot: () => snapshotDialog(app, executionId),
    compare: () => comparisonDialog(app, executionId, {judgments: bundle.judgments}),
    simulate: () => simulatorDialog(app, executionId, {slices: bundle.slices}),
    'print-balance': () => printBalanceDialog(app, executionId)
  };

  const showTab = async (tab, {scrollTo = ''} = {}) => {
    prefs.set(TAB_KEY, tab);
    root.querySelectorAll('[data-tab]').forEach(button => {
      const active = button.dataset.tab === tab;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
    });
    panel.innerHTML = renderTab(bundle, tab);
    bindContainer(panel);
    if (scrollTo) panel.querySelector(scrollTo)?.scrollIntoView?.({block: 'start'});
  };

  const bindContainer = container => {
    container.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', guard(() => runAction[button.dataset.action]?.())));
    container.querySelectorAll('[data-trace]').forEach(button => button.addEventListener('click', () => traceDialog(bundle, button.dataset.trace)));
    container.querySelectorAll('[data-open-duration]').forEach(button => button.addEventListener('click', guard(() => durationDialog(app, executionId, {lockExecution: true}))));
    container.querySelectorAll('[data-statement-mode]').forEach(button => button.addEventListener('click', guard(async () => {
      await S.printSimpleStatement(app.office, executionId, {mode: button.dataset.statementMode, asOf: bundle.schedule.asOf});
      toast('فُتح الكشف للطباعة');
      return undefined;
    })));
    container.querySelectorAll('[data-hint-action]').forEach(button => button.addEventListener('click', guard(() => (button.dataset.hintAction === 'judgment' ? runAction.edit() : openValue()))));
    container.querySelectorAll('[data-row-info]').forEach(button => button.addEventListener('click', () => periodDetailsDialog(app, bundle, button.dataset.rowInfo)));
    container.querySelectorAll('[data-change]').forEach(button => button.addEventListener('click', () => {
      const row = bundle.schedule.rows.find(item => item.fromDate === button.dataset.change);
      if (row) valueChangeDialog(row, bundle.schedule.currency);
    }));
    container.querySelectorAll('[data-pin-collection]').forEach(button => button.addEventListener('click', guard(() => openCollection(null, button.dataset.pinCollection))));
    container.querySelectorAll('[data-account-filter]').forEach(button => button.addEventListener('click', async () => {
      prefs.set(accountFilterKey(bundle.execution.id), button.dataset.accountFilter);
      panel.innerHTML = renderTab(bundle, 'account');
      bindContainer(panel);
    }));
    container.querySelectorAll('[data-edit]').forEach(button => button.addEventListener('click', guard(() => {
      const {kind, edit} = button.dataset;
      if (kind === 'receipt') return openCollection((bundle.receipts || []).find(row => row.id === edit));
      if (kind === 'action') return openAction((bundle.actions || []).find(row => row.id === edit));
      if (kind === 'judgment') return judgmentDialog(app, executionId, {judgment: (bundle.judgments || []).find(row => row.id === edit), slices: bundle.slices, obligations: [], accountingModel: bundle.execution.accountingModel});
      toast('هذا السجل يُصحَّح بحكم لاحق أو بالإلغاء', 'error');
      return undefined;
    })));
    container.querySelectorAll('[data-void]').forEach(button => button.addEventListener('click', guard(async () => {
      const kind = button.dataset.kind, id = button.dataset.void;
      const answer = await confirmBox('إلغاء هذا السجل؟ اكتب السبب — يبقى السجل مشطوبًا ولا يُحذف.', {okText: 'إلغاء السجل', input: true, label: 'سبب الإلغاء'});
      if (!answer?.ok) return undefined;
      if (!String(answer.value || '').trim()) { toast('سبب الإلغاء مطلوب', 'error'); return undefined; }
      await S.voidSimpleRecord(app.office, {kind, id, reason: answer.value});
      toast('تم الإلغاء — يمكنك التراجع الآن', 'ok', {actionLabel: 'تراجع', action: async () => {
        await S.undoVoidSimpleRecord(app.office, {kind, id});
        await app.refresh();
      }});
      await app.refresh();
      return undefined;
    })));
    container.querySelectorAll('[data-reallocate]').forEach(button => button.addEventListener('click', guard(() => {
      const receipt = (bundle.receipts || []).find(row => row.id === button.dataset.reallocate);
      return receipt ? openCollection(receipt) : undefined;
    })));
    container.querySelectorAll('[data-print-poa]').forEach(button => button.addEventListener('click', guard(async () => {
      // نفس مسار الطباعة القائم، مع ترقيم صفحات مقيس (كشف/توكيل متعدد الصفحات).
      await S.printSimplePoa(app.office, button.dataset.printPoa);
      toast('فُتح التوكيل للطباعة بترقيم الصفحات');
      return undefined;
    })));
    container.querySelectorAll('[data-reissue-poa]').forEach(button => button.addEventListener('click', guard(() => openPoa())));
    const logList = container.querySelector('[data-log-list]');
    if (logList) {
      const applyLogFilters = () => {
        const type = container.querySelector('[data-log-type]')?.value || '';
        const from = container.querySelector('[data-log-from]')?.value || '';
        const to = container.querySelector('[data-log-to]')?.value || '';
        const query = (container.querySelector('[data-log-q]')?.value || '').trim().toLowerCase();
        const showVoided = Boolean(container.querySelector('[data-log-voided]')?.checked);
        container.querySelectorAll('[data-log-item]').forEach(item => {
          const visible = (!type || item.dataset.type === type)
            && (!from || item.dataset.date >= from)
            && (!to || item.dataset.date <= to)
            && (showVoided || item.dataset.voided !== '1')
            && (!query || item.textContent.toLowerCase().includes(query));
          item.hidden = !visible;
        });
      };
      container.querySelectorAll('[data-log-type],[data-log-from],[data-log-to],[data-log-q],[data-log-voided]').forEach(input => input.addEventListener('input', applyLogFilters));
      applyLogFilters();
    }
  };

  root.querySelectorAll('.exec-toolbar [data-action]').forEach(button => button.addEventListener('click', guard(() => runAction[button.dataset.action]?.())));
  root.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => showTab(button.dataset.tab).catch(error => app.fail(error))));
  root.querySelector('[data-record]')?.addEventListener('click', openRecord);
  root.querySelector('[data-open-duration]')?.addEventListener('click', guard(() => durationDialog(app, executionId, {lockExecution: true})));
  root.querySelector('[data-open-statement]')?.addEventListener('click', openStatement);
  root.querySelector('[data-help]')?.addEventListener('click', () => openHelp(app));
  root.querySelector('[data-settings]')?.addEventListener('click', () => executionSettingsDialog(app));
  const moreMenu = root.querySelector('[data-more-menu]');
  const moreButton = root.querySelector('[data-more]');
  moreButton?.addEventListener('click', () => {
    if (!moreMenu) return;
    moreMenu.hidden = !moreMenu.hidden;
    moreButton.setAttribute('aria-expanded', String(!moreMenu.hidden));
  });
  root.querySelector('[data-delete-execution]')?.addEventListener('click', async () => {
    if (!await confirmBox('حذف ملف التنفيذ بالكامل منطقيًا؟ يُحفظ كل شيء ويمكن استعادته من سلة التنفيذ.', {okText: 'حذف الملف'})) return;
    try {
      await EX.deleteExecution(app.office, executionId, bundle.execution.version ?? null, 'حذف من البطاقة');
      toast('تم الحذف المنطقي — الاستعادة من سلة التنفيذ');
      await app.go('executionCenter');
    } catch (error) { toast(userError(error), 'error'); }
  });
  const asofInput = root.querySelector('[data-asof]');
  asofInput?.addEventListener('change', async () => {
    prefs.set(ASOF_KEY, asofInput.value || '');
    await app.refresh();
  });
  // زر الرجوع إلى اليوم: تاريخ الحساب محفوظ عالميًا، وتاريخ قديم يخفي الحسابات
  // عن كل التنفيذات (وينشأ تنفيذ جديد يبدو بلا أرقام) — فنجعل الرجوع بنقرة واحدة.
  root.querySelector('[data-asof-today]')?.addEventListener('click', async () => {
    prefs.set(ASOF_KEY, '');
    await app.refresh();
  });
  // الجوال: نفس شريط الأزرار مثبَّت أسفل الشاشة.
  const toolbar = root.querySelector('.exec-toolbar');
  if (toolbar) {
    const media = window.matchMedia?.('(max-width: 720px)');
    const syncPinned = () => {
      if (!toolbar.isConnected) { media?.removeEventListener?.('change', syncPinned); return; }
      toolbar.classList.toggle('is-pinned-bottom', Boolean(media?.matches));
    };
    syncPinned();
    media?.addEventListener?.('change', syncPinned);
  }
  bindContainer(root.querySelector('.exec-summary') || root);
  bindContainer(panel);
  // اختصار Ctrl+Shift+T من التطبيق: يفتح ورقة التسجيل على بطاقة التنفيذ.
  const onRecordShortcut = () => {
    if (!root.isConnected) { document.removeEventListener('exec:record', onRecordShortcut); return; }
    openRecord();
  };
  document.addEventListener('exec:record', onRecordShortcut);
  return true;
}

/* ============================ نوافذ التفسير ============================ */
function traceDialog(bundle, which) {
  const {schedule} = bundle;
  const currency = schedule.currency;
  const totals = schedule.totals;
  const title = {due: 'المطلوب حتى اليوم', paid: 'المدفوع', remaining: 'المتبقي'}[which] || 'الأرقام';
  const equations = which === 'due'
    ? [`مجموع استحقاق الفترات حتى ${dateText(schedule.asOf)} = ${money(totals.dueMinor, currency)}`, ...schedule.rows.slice(0, 12).map(row => `${row.label}: ${row.trace?.equation || `${money(row.dueMinor, currency)}`}`)]
    : which === 'paid'
      ? [`مجموع المحاضر المسجلة = ${money(totals.paidMinor, currency)}`, `المخصّص على الفترات = ${money(totals.allocatedMinor, currency)}`, `رصيد دائن غير مخصص = ${money(totals.creditMinor, currency)}`, ...(schedule.receipts || []).map(receipt => `${receipt.receiptNumber || 'محضر'} ${dateText(receipt.date)}: ${money(receipt.amountMinor, currency)} (مخصص ${money(receipt.allocatedMinor, currency)}${receipt.creditMinor ? ` · دائن ${money(receipt.creditMinor, currency)}` : ''})`)]
      : [`المتبقي = المطلوب − المخصّص = ${money(totals.remainingMinor, currency)}`, ...schedule.rows.filter(row => row.remainingMinor > 0).slice(0, 12).map(row => `${row.label}: ${money(row.dueMinor, currency)} − ${money(row.paidMinor, currency)} = ${money(row.remainingMinor, currency)}`), ...(totals.overpaidMinor > 0 ? [`دفعة زائدة ظاهرة: ${money(totals.overpaidMinor, currency)} (بلا رد تلقائي)`] : [])];
  return modal(`<h2 class="modal-title">كيف حُسب: ${esc(title)}</h2>
    <p class="muted small">كل رقم مبني على سجلات المكتب: بنود القيمة (الأحكام) ثم التوزيع (المحدد أولًا ثم الأقدم أولًا).</p>
    <ul class="plain-list">${equations.map(line => `<li>${esc(line)}</li>`).join('')}</ul>
    <div class="form-actions"><button type="button" class="ghost" data-close>إغلاق</button></div>`);
}

function valueChangeDialog(row, currency) {
  return modal(`<h2 class="modal-title">تغيّرت القيمة بحكم لاحق — ${esc(row.label)}</h2>
    <ul class="plain-list">${row.valueChanges.map(change => `<li>${esc(change.entitlementType || '')}: ${money(change.previousAmountMinor, currency)} → ${money(change.newAmountMinor, currency)} — الفرق ${money(Math.abs(change.differenceMinor || 0), currency)} (${(change.differenceMinor || 0) >= 0 ? 'زيادة' : 'تخفيض'})</li>`).join('')}</ul>
    <p class="muted small">يظهر الفرق مرة واحدة على الشهور المتأثرة فقط — لا يُعاد احتساب المبلغ كاملًا.</p>
    <div class="form-actions"><button type="button" class="ghost" data-close>إغلاق</button></div>`);
}

function periodDetailsDialog(app, bundle, fromDate) {
  const row = bundle.schedule.rows.find(item => item.fromDate === fromDate);
  if (!row) return undefined;
  const currency = bundle.schedule.currency;
  const receiptById = new Map((bundle.receipts || []).map(receipt => [receipt.id, receipt]));
  const card = modal(`<h2 class="modal-title">${esc(row.label)} — تفاصيل الفترة</h2>
    <div class="exec-numbers small">
      <div class="num"><span>المستحق</span><b>${moneyShort(row.dueMinor, currency)}</b></div>
      <div class="num"><span>المدفوع</span><b>${moneyShort(row.paidMinor, currency)}</b></div>
      <div class="num num-primary"><span>المتبقي</span><b>${moneyShort(row.remainingMinor, currency)}</b></div>
    </div>
    <h3 class="exec-sub">مصدر القيمة</h3>
    <ul class="plain-list">${(row.units || []).flatMap(unit => (unit.parts || []).map(part => `<li>${esc(unit.entitlementType || '')}: ${esc(part.equation || '')} (${esc(dateText(part.coveredStart))} → ${esc(dateText(part.coveredEnd))})</li>`)).join('') || '<li class="muted">—</li>'}</ul>
    <h3 class="exec-sub">ما خُصّص على هذه الفترة</h3>
    ${(row.lines || []).length ? `<ul class="plain-list">${row.lines.map(line => `<li>${line.receiptId ? `محضر ${esc(receiptById.get(line.receiptId)?.receiptNumber || '')} ${esc(dateText(receiptById.get(line.receiptId)?.date || ''))}` : 'توزيع تلقائي'} — ${money(line.amountMinor, currency)} <span class="muted">(${line.mode === 'direct' ? 'محدد' : 'الأقدم أولًا'})</span></li>`).join('')}</ul>` : '<p class="muted">لم يُخصَّص شيء على هذه الفترة بعد.</p>'}
    ${row.overpaidMinor > 0 ? `<p class="warn-line">دفعة زائدة ${money(row.overpaidMinor, currency)} — لا رد تلقائي ولا تسوية صامتة.</p>` : ''}
    <div class="form-actions"><button type="button" class="ghost" data-duration-here>احسب مدة تشمل هذه الفترة</button><button type="button" class="ghost" data-close>إغلاق</button></div>`);
  card.querySelector('[data-duration-here]')?.addEventListener('click', () => { closeModal(); durationDialog(app, bundle.execution.id, {lockExecution: true, fromDate: row.fromDate, toDate: row.toDate}); });
  return card;
}

export {EXECUTION_TYPE_LABELS};
