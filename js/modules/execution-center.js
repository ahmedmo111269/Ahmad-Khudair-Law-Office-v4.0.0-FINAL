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
import {isCivilDate, addCivilDays} from '../domain/execution-calendar.js';
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
/* ---- وحدات مركز التنفيذ المضافة (كل واحدة مستقلة وقابلة للتعطيل) ---- */
import {acquirePrintWindow} from '../services/execution-print.js';
import {executionSettings, saveExecutionSettings, normalizeUiMode} from '../services/execution-settings.js';
import {scanAttention, attentionThresholds, ATTENTION_DISCLAIMER} from '../services/execution-attention.js';
import {attentionBarMarkup, renderAttentionBar, attentionListModal, attentionThresholdsModal} from '../ui/execution-attention.js';
import {executionSummaryCardMarkup, bindExecutionSummaryCard, summaryEquation} from '../ui/execution-summary-card.js';
import {openHorizonPicker, anchorOf, horizonBarMarkup, horizonShortcuts, horizonPreview} from '../ui/execution-horizon-picker.js';
import {poaWizard} from '../ui/execution-poa-wizard.js';
import {executionTimelineMarkup, bindExecutionTimeline, buildStageNodes} from '../ui/execution-timeline.js';
import {manualPeriodDialog, nextPeriodDialog, manualPeriodsDialog, periodEquationLine, periodSourceNote, periodLinkedReceipts, confirmPeriodEdit, editLinkedReceipt} from '../ui/execution-period-engine.js';
import {carryOverFlow} from '../ui/execution-carryover.js';
import {receiptBeneficiaryDialog, sliceBeneficiaryDialog, beneficiaryMigrationDialog} from '../ui/execution-beneficiaries.js';
import {
  quickCalcMarkup, bindQuickCalc, quickNotesMarkup, bindQuickNotes, loadExecutionNotes,
  installExecutionShortcuts, showExecutionShortcutsPanel, effectiveUiMode, toggleUiMode, applyUiMode
} from '../ui/execution-extras.js';
import {buildStatementCsv, downloadTextFile, statementFileName, exportStatementPdf} from '../services/execution-export.js';

/* حدود العرض: الفترات والسجل لا يُحمَّلان كلهما في DOM (أداء على الملفات الكبيرة). */
const PERIODS_PAGE_SIZE = 24;
const PERIODS_SHOW_ALL_WARN = 120;
const LOG_PAGE_SIZE = 50;

const TAB_KEY = 'ui:exec:tab:v1';
const ASOF_KEY = 'ui:exec:asof:v1';
const ASOF_MODE_KEY = 'ui:exec:asof-mode:v1';
const asOfKeyFor = id => `ui:exec:asof:${id}`;
const COUNT_KEY = 'ui:exec:count:v1';
const accountFilterKey = executionId => `ui:exec:account-filter:${executionId}`;

/* ============================ تنسيقات موحدة ============================ */
const money = (minor, currency = 'EGP') => `${fromMinorUnits(minor || 0, currency).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})} ج.م`;
const moneyShort = (minor, currency = 'EGP') => fromMinorUnits(minor || 0, currency).toLocaleString('en-US', {maximumFractionDigits: 0});
const dateText = iso => (isCivilDate(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');
const STATUS_TEXT = {paid: '✔ مسدد', partial: '◐ جزئي', unpaid: '✗ لم يُدفع', nothing_due: '· لا استحقاق'};
/** شريحة فترة يدوية: مقطوعة ومعرّف بند يحمل علامة الفترة اليدوية. */
const isManualSliceRow = slice => Boolean(slice) && slice.valueType === 'fixed'
  && (String(slice.itemId || '').includes('::MANUAL_PERIOD::') || String(slice.sourceReference || '').startsWith('MANUAL_PERIOD'));
/** صف فترة يدوية في الجدول: أي وحدة فيه مرجعها شريحة يدوية. */
const isManualRow = (row, bundle) => {
  const sliceIds = new Set((row?.units || []).flatMap(unit => (unit.parts || []).map(part => part.sliceId).filter(Boolean)));
  if (!sliceIds.size) return false;
  return (bundle?.slices || []).some(slice => sliceIds.has(slice.id) && isManualSliceRow(slice));
};
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
  count: prefs.get(COUNT_KEY, 'all'), search: prefs.get('ui:exec:q', ''), counts: null, counted: 0, scannedAll: false, ready: false,
  // فلتر «يحتاج انتباهي»: مجموعة معرفات تنفيذ لفئة واحدة (لا إعادة مسح للجدول).
  attentionKey: '', attentionIds: null, attentionReport: null
});
const cardState = app => (app.__execSimple = app.__execSimple || {});

/* ============================ صفحة القائمة ============================ */
export function executionCenterPage(app) {
  registerPageLayout({
    pageId: 'executionCenter', title: 'مركز التنفيذ',
    sections: [
      {id: 'attention', title: 'يحتاج انتباهي'},
      {id: 'numbers', title: 'عدّادات سريعة'},
      {id: 'filters', title: 'بحث'},
      {id: 'grid', title: 'جدول التنفيذات', canHide: false}
    ]
  });
  const st = listState(app);
  const settings = executionSettings(app.office);
  const attentionEnabled = attentionThresholds(settings).enabled;
  return `<div class="page-head exec-head"><div><h2>مركز التنفيذ</h2>
    <p class="muted small">كل شيء في مكان واحد: أنشئ تنفيذًا، سجّل ما تم (تحصيل · إجراء · مصروف · حكم لاحق)، واقرأ المطلوب والمدفوع والمتبقي فورًا.</p></div>
    <div class="head-actions">
      <button class="ghost" data-help>؟ مساعدة</button>
      <button class="ghost" data-settings>⚙ إعدادات التنفيذ</button>
      <button class="ghost" data-customize-page>⚙ تخصيص الصفحة</button>
      <button class="ghost" data-exec-trash>🗑 سلة التنفيذ</button>
      <button class="ghost" data-demo-example>🧪 مثال عملي جاهز</button>
      <button class="ghost" data-actual-file title="ملف تنفيذ فعلي مسجَّل في كل التبويبات — لفحص ما يعمل وما لا يعمل">📂 ملف تنفيذ فعلي (كل التبويبات)</button>
      <button class="ghost" data-exec-demo>📁 ملفات تنفيذ تجريبية</button>
      <button class="ghost danger" data-exec-clear>🗑 مسح بيانات التنفيذ</button>
      <button class="primary" data-new-execution>+ تنفيذ جديد</button>
    </div></div>
  ${attentionEnabled ? attentionBarMarkup({report: null}) : ''}
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
      preparedFilter: row => counterMatches(st.count, row)
        && (!st.search || searchableText(row).includes(String(st.search).trim().toLowerCase()))
        // «عرض (N)» من بطاقة انتباه يفتح نفس الجدول مفلترًا على معرفات الفئة.
        && (!st.attentionKey || (st.attentionIds instanceof Set ? st.attentionIds.has(row.id) : true))
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

  root.querySelectorAll('[data-new-execution]').forEach(el => el.addEventListener('click', () => newExecutionDialog(app)));
  root.querySelectorAll('[data-demo-example]').forEach(el => el.addEventListener('click', async event => {
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
  }));
  // querySelector المفرد لا يكفي عند تكرار الـ hook — استخدم querySelectorAll دائمًا.
  // ملف تنفيذ فعلي كامل: يُنشئ تنفيذًا ويسجّل فيه كل الأنواع (تحصيل · إجراء ·
  // مصروف · فترة يدوية · حكم لاحق · توزيع مستحقين · توكيل · ملاحظة) ثم يفتح بطاقته.
  root.querySelectorAll('[data-actual-file]').forEach(el => el.addEventListener('click', async event => {
    const button = event.currentTarget;
    const label = button.textContent;
    button.disabled = true;
    button.textContent = 'جارٍ إنشاء الملف…';
    try {
      const SEED = await import('../services/execution-actual-file.js');
      const out = await SEED.seedActualExecutionFile(app.office);
      if (out.reused) toast('ملف التنفيذ الفعلي موجود بالفعل — نفتح بطاقته', 'info');
      else toast(`أُنشئ ملف تنفيذ فعلي وسُجِّلت ${out.created.length} وقائع في كل التبويبات`, 'ok', {duration: 8000});
      await app.go(`exc:${out.executionId}`);
    } catch (error) {
      toast(userError(error), 'error');
      button.disabled = false;
      button.textContent = label;
    }
  }));
  root.querySelectorAll('[data-help]').forEach(b => b.addEventListener('click', () => openHelp(app)));
  root.querySelectorAll('[data-settings]').forEach(b => b.addEventListener('click', () => executionSettingsDialog(app)));
  root.querySelectorAll('[data-customize-page]').forEach(b => b.addEventListener('click', () => openPageCustomizer(app, {pageId: 'executionCenter', root})));
  root.querySelectorAll('[data-exec-trash]').forEach(b => b.addEventListener('click', () => openExecutionTrash(app)));
  root.querySelectorAll('[data-exec-demo]').forEach(el => el.addEventListener('click', async event => {
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
  }));
  root.querySelectorAll('[data-exec-clear]').forEach(el => el.addEventListener('click', async () => {
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
  }));
  let searchTimer = 0;
  root.querySelectorAll('[data-search]').forEach(el => el.addEventListener('input', event => {
    st.search = event.target.value;
    prefs.set('ui:exec:q', st.search);
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => reload().catch(error => app.fail(error)), 250);
  }));
  root.querySelectorAll('[data-clear-search]').forEach(el => el.addEventListener('click', async () => {
    st.search = ''; prefs.set('ui:exec:q', '');
    const input = root.querySelector('[data-search]');
    if (input) input.value = '';
    await reload();
  }));

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

  /* -------- مركز «يحتاج انتباهي»: مسح محدود غير حاجز لرسم الصفحة -------- */
  const attentionHost = root.querySelector('.exec-attention');
  const clearAttentionFilter = async () => {
    if (!st.attentionKey) return;
    st.attentionKey = ''; st.attentionIds = null;
    root.querySelectorAll('[data-attention-card]').forEach(button => button.classList.remove('is-active'));
    await reload();
  };
  const refreshAttention = async () => {
    if (!attentionHost) return;
    try {
      const report = await scanAttention(app.office, {limit: 200, batchSize: 25});
      if (!root.isConnected) return;
      st.attentionReport = report;
      renderAttentionBar(attentionHost, report);
      bindAttentionCards();
      // الفلتر النشط يبقى صالحًا فقط إن كانت فئته ما زالت موجودة.
      if (st.attentionKey) {
        const category = report.categories.find(row => row.key === st.attentionKey);
        st.attentionIds = new Set((category?.items || []).map(item => item.executionId));
        if (!category?.count) await clearAttentionFilter();
      }
    } catch {
      if (!root.isConnected) return;
      const note = attentionHost.querySelector('[data-attention-note]');
      if (note) note.textContent = 'تعذر فحص «يحتاج انتباهي» — الجدول والعدّادات يعملان.';
    }
  };
  const bindAttentionCards = () => {
    if (!attentionHost) return;
    attentionHost.querySelectorAll('[data-attention-card]').forEach(button => button.addEventListener('click', async () => {
      const key = button.dataset.attentionCard;
      const report = st.attentionReport;
      const category = report?.categories?.find(row => row.key === key);
      if (!report || !category) return;
      if (st.attentionKey === key) { await clearAttentionFilter(); return; }
      st.attentionKey = key;
      st.attentionIds = new Set(category.items.map(item => item.executionId));
      attentionHost.querySelectorAll('[data-attention-card]').forEach(other => other.classList.toggle('is-active', other === button));
      await reload();
      toast(`الجدول مفلتر على «${category.title}» — ${category.count} عنصر`, 'info', {duration: 5000});
    }));
  };
  root.querySelectorAll('[data-attention-refresh]').forEach(button => button.addEventListener('click', async () => {
    button.disabled = true;
    await refreshAttention();
    button.disabled = false;
  }));
  root.querySelectorAll('[data-attention-thresholds]').forEach(button => button.addEventListener('click', () => {
    attentionThresholdsModal(st.attentionReport || {thresholds: attentionThresholds(executionSettings(app.office))}, {
      onSave: async values => {
        try {
          const settings = executionSettings(app.office);
          await saveExecutionSettings(app.office, {lists: {...settings.lists, followUpThresholds: values}});
          toast(values.enabled ? 'حُفظت حدود «يحتاج انتباهي»' : 'أُوقف مركز «يحتاج انتباهي»', 'ok');
          closeModal();
          await app.refresh();
        } catch (error) { toast(userError(error), 'error'); }
      }
    });
  }));

  renderCounters();
  await reload();
  await maybeSeedExecutionDemo(app, reload).catch(() => null);
  refreshCounters();
  refreshAttention();
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
      {id: 'quickCalc', title: 'الحساب السريع'},
      {id: 'quickCard', title: 'الملخص السريع'},
      {id: 'toolbar', title: 'شريط الأزرار', canHide: false},
      {id: 'summary', title: 'الأرقام الثلاثة', canHide: false},
      {id: 'quickNotes', title: 'ملاحظات سريعة'},
      {id: 'tabs', title: 'التبويبات', canHide: false},
      {id: 'panel', title: 'محتوى التبويب', canHide: false}
    ]
  });
  let bundle = null;
  try {
    const mode = prefs.get(ASOF_MODE_KEY, 'per');
    const localAsOf = mode === 'global' ? '' : prefs.get(asOfKeyFor(executionId), '');
    const globalAsOf = prefs.get(ASOF_KEY, '');
    const effectiveAsOf = localAsOf || globalAsOf || '';
    bundle = await S.simpleCardBundle(app.office, executionId, {asOf: effectiveAsOf, allowFuture: true});
  }
  catch (error) { return `<div class="error-box" role="alert"><h2>${esc(userError(error))}</h2><p class="muted small">قد يكون ملف التنفيذ محذوفًا. راجعه في سلة التنفيذ.</p><div class="error-actions"><button class="primary" data-route="executionCenter">رجوع إلى مركز التنفيذ</button></div></div>`; }
  cardState(app)[executionId] = bundle;
  const {execution, client, file, creditor, debtor, schedule, status} = bundle;
  const title = execution.internalNumber || execution.officialNumber || 'تنفيذ بلا رقم';
  const parties = `${esc(creditor?.name || client?.fullName || 'بلا موكل')} <span class="muted">ضد</span> ${esc(debtor?.name || 'بلا منفذ ضده')}`;
  const tab = TAB_LABELS[prefs.get(TAB_KEY, 'account')] ? prefs.get(TAB_KEY, 'account') : 'account';
  // وضع العرض: مبسّط (افتراضي) يخفي الأدوات المتقدمة والـLedger والفروق والمحاكاة
  // والمقارنة واعتراف FEAS — ومتقدّم يعرض كل شيء. يُحفظ لكل تنفيذ.
  const uiMode = normalizeUiMode(effectiveUiMode({executionId, settings: bundle.settings}), 'simple');
  const anchor = anchorOf(bundle);
  const notes = await loadExecutionNotes(app.office, executionId, {limit: 3}).catch(() => []);
  return `<div class="page-head exec-head"><div>
      <h2>${esc(title)} · ${parties}${file ? ` · ملف ${esc(formatFileNumber(file.fileNumber))}` : ''} <span class="exec-status exec-status-${esc(status.key)}">${esc(status.label)}</span></h2>
      <p class="muted small">${esc(EXECUTION_TYPE_LABELS[execution.executionType] || 'نوع غير محدد')}${execution.authority ? ` · ${esc(execution.authority)}` : ''} · فُتح في ${esc(dateText(execution.openedDate))}</p>
    </div><div class="head-actions">
      <button class="ghost" data-route="executionCenter">↩ المركز</button>
      <button class="ghost" data-help>؟ مساعدة</button>
      <button class="ghost" data-settings>⚙ إعدادات</button>
      <button class="ghost" data-shortcuts-help title="Alt+؟">⌨ الاختصارات</button>
      ${file ? `<button class="ghost" data-route="file:${esc(file.id)}">الملف القانوني</button>` : ''}
      <button class="ghost danger" data-delete-execution>حذف ملف التنفيذ</button>
    </div></div>
  ${quickCalcMarkup({asOf: bundle.schedule.requestedAsOf || bundle.schedule.asOf || '', anchor, enabled: true})}
  ${executionSummaryCardMarkup(bundle, {uiMode})}
  <section class="panel exec-toolbar" data-section-id="toolbar">
    <div class="exec-actions">
      <button class="primary" data-record>+ تسجيل</button>
      <button class="ghost" data-open-duration>🧮 احسب مدة</button>
      <button class="ghost" data-open-statement>🖨 كشف / توكيل</button>
      <button class="ghost" data-more aria-haspopup="true" aria-expanded="false">⋮ المزيد</button>
    </div>
    <div class="exec-more-menu" data-more-menu hidden>
      <button type="button" data-action="action">⚡ تسجيل إجراء</button>
      <button type="button" data-action="collection">💰 تسجيل تحصيل</button>
      <button type="button" data-action="edit">تعديل بيانات التنفيذ</button>
      <button type="button" data-action="party">إضافة/تعديل طرف</button>
      <button type="button" data-action="value">قيمة النفقة (البند والدورية)</button>
      <button type="button" data-action="later-judgment">حكم لاحق</button>
      <button type="button" data-action="expense">تسجيل مصروف/رسم</button>
      <button type="button" data-action="manual-period">➕ فترة يدوية</button>
      <button type="button" data-action="next-period">💡 اقتراح الفترة التالية</button>
      <button type="button" data-action="manual-periods">🗂 الفترات اليدوية المسجلة</button>
      <button type="button" data-action="poa">توكيل جديد</button>
      <button type="button" data-action="export-csv">⬇ تصدير CSV (Excel)</button>
      <button type="button" data-action="export-pdf">⬇ تصدير PDF (طباعة)</button>
      <button type="button" data-action="lifecycle">${String(execution.lifecycleOverride || '') === 'suspended' || String(execution.lifecycleOverride || '') === 'closed' ? 'استئناف التنفيذ' : 'إيقاف/إغلاق (بسبب)'}</button>
      <button type="button" data-action="advanced" data-advanced-only>أدوات متقدمة (اختيارية)…</button>
    </div>
  </section>
  ${summarySectionMarkup(bundle)}
  ${quickNotesMarkup(notes)}
  ${tabsMarkup(tab)}
  <div class="exec-tab-panel" data-tab-panel>${renderTab(bundle, tab, {uiMode})}</div>`;
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
  const today = localDate();
  const requestedAsOf = schedule.requestedAsOf || schedule.asOf || '';
  const effectiveAsOf = schedule.effectiveAsOf || schedule.asOf || '';
  const isFuture = requestedAsOf && requestedAsOf > today;
  const horizonCapped = Boolean(schedule.horizonCapped);
  const horizonNote = schedule.horizonNote || '';
  // مبدأ ملزم: ممنوع عرض رقم بجانب تاريخ لم يُحسب عنده
  const asofDisplay = esc(dateText(requestedAsOf || schedule.asOf));
  const effectiveDisplay = esc(dateText(effectiveAsOf));
  const cappedAlert = horizonCapped ? `<div class="hint hint-warn" role="alert" style="background:#fff3cd;border:1px solid #ffc107;padding:8px;border-radius:6px;margin:8px 0;">⚠ ${esc(horizonNote || `أفق الحساب موقوف عند ${effectiveDisplay} — التواريخ المستقبلية تحتاج تفعيل «احسب حتى تاريخ مستقبلي».`)} — التاريخ الفعلي للحساب: <b>${effectiveDisplay}</b>${requestedAsOf !== effectiveAsOf ? ` (طُلب ${asofDisplay})` : ''}</div>` : '';
  const futureBadge = isFuture ? `<span class="badge" style="background:#e3f2fd;color:#0d47a1;border:1px solid #90caf9;">تقديري — فترات لم تُستحق بعد</span>` : '';
  return `<section class="panel exec-summary" data-section-id="summary">
    <div class="asof-row">
      <label>المطلوب حتى <input type="date" data-asof value="${esc(requestedAsOf || schedule.asOf)}" aria-label="تاريخ الحساب"></label>
      ${requestedAsOf && requestedAsOf !== today ? `<button type="button" class="ghost small" data-asof-today>↺ ارجع إلى اليوم</button>${futureBadge}<span class="hint hint-warn small">الحساب ${isFuture ? 'تقديري لمستقبل' : 'موقوف عند تاريخ قديم'} — ${isFuture ? 'الفترات المستقبلية محسوبة كتقدير للمطالبة' : 'هذا يخفي الأرقام عن كل التنفيذات حتى تعيده إلى اليوم'}.</span>` : ''}
      <span class="muted small">غيّر التاريخ تغيّر الأرقام والجدول فورًا — بلا أي خطوة أخرى. ${horizonCapped ? `التاريخ الفعلي: ${effectiveDisplay}` : ''}</span>
    </div>
    ${cappedAlert}
    ${cappedNote(bundle)}
    <div class="exec-numbers">
      <button type="button" class="num" data-trace="due"><span>المطلوب حتى ${requestedAsOf ? asofDisplay : esc(dateText(schedule.asOf))}${horizonCapped ? ` (فعليًا حتى ${effectiveDisplay})` : ''} ${futureBadge}</span><b>${moneyShort(totals.dueMinor, currency)}</b><small>ج.م · اضغط للتفسير</small></button>
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
function renderTab(bundle, tab, options = {}) {
  if (tab === 'log') return logTabMarkup(bundle, options);
  if (tab === 'data') return dataTabMarkup(bundle, options);
  if (tab === 'poa') return poaTabMarkup(bundle, options);
  return accountTabMarkup(bundle, options);
}

function accountTabMarkup(bundle, {pageSize = PERIODS_PAGE_SIZE, page = 0} = {}) {
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
  const allRows = schedule.rows.filter(row => (filter === 'unpaid' ? row.status !== PERIOD_STATUS.PAID : filter === 'paid' ? row.status === PERIOD_STATUS.PAID : true));
  // الأداء: لا تُرسم كل الفترات في DOM. صفحة 24 فترة + «تحميل المزيد» +
  // «عرض الكل» مع تحذير صريح فوق 120 فترة.
  const showAll = pageSize === 0;
  const start = showAll ? 0 : page * pageSize;
  const rows = showAll ? allRows : allRows.slice(start, start + pageSize);
  const hasMore = !showAll && allRows.length > start + rows.length;
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
          <td><button type="button" class="link period-link" data-row-info="${esc(row.fromDate)}" title="اضغط لعرض تفاصيل الفترة ومصدر قيمتها وما خُصّص عليها">${esc(row.label)}</button>${row.valueChanges.length ? '<button type="button" class="info-dot" data-change="' + esc(row.fromDate) + '" title="تغيّرت القيمة بحكم لاحق">ⓘ</button>' : ''}${row.overpaidMinor > 0 ? '<span class="badge warn">دفعة زائدة</span>' : ''}${isManualRow(row, bundle) ? '<span class="badge">يدوية</span>' : ''}
            <span class="period-equation"><b>المعادلة:</b> ${esc(periodEquationLine(row, currency) || row.trace?.equation || '—')}${periodSourceNote(row, bundle) ? `<br><b>المصدر:</b> ${esc(periodSourceNote(row, bundle))}` : ''}</span></td>
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
    <p class="muted small">المعروض (${rows.length} من ${allRows.length} فترة): مستحق ${money(allRows.reduce((sum, row) => sum + row.dueMinor, 0), currency)} · مدفوع ${money(allRows.reduce((sum, row) => sum + row.paidMinor, 0), currency)} · متبقٍ <b>${money(allRows.reduce((sum, row) => sum + row.remainingMinor, 0), currency)}</b></p>
    <div class="form-actions" data-periods-pager>
      ${hasMore ? `<button type="button" class="ghost" data-periods-more="${page + 1}" data-periods-page-size="${pageSize}">تحميل المزيد (${Math.min(pageSize, allRows.length - start - rows.length)})</button>` : ''}
      ${!showAll && allRows.length > pageSize ? `<button type="button" class="ghost" data-periods-all="${allRows.length}">عرض الكل</button>` : ''}
      ${showAll && allRows.length > PERIODS_SHOW_ALL_WARN ? `<span class="hint hint-warn small">⚠ تعرض ${allRows.length} فترة دفعة واحدة — قد يبطؤ الرسم على الأجهزة الضعيفة.</span><button type="button" class="ghost" data-periods-page="0" data-periods-page-size="${PERIODS_PAGE_SIZE}">رجوع إلى الصفحات</button>` : ''}
      ${showAll && allRows.length <= PERIODS_SHOW_ALL_WARN && allRows.length > pageSize ? `<button type="button" class="ghost" data-periods-page="0" data-periods-page-size="${PERIODS_PAGE_SIZE}">رجوع إلى الصفحات</button>` : ''}
    </div>
    <div class="form-actions"><button type="button" class="ghost" data-open-duration>🧮 احسب مدة</button><button type="button" class="ghost" data-trace="remaining">كيف حُسب المتبقي؟</button><button type="button" class="ghost" data-action="manual-period">➕ فترة يدوية</button><button type="button" class="ghost" data-action="next-period">💡 اقتراح الفترة التالية</button></div>
  </section>`;
}

function logTabMarkup(bundle, {pageSize = LOG_PAGE_SIZE, page = 0} = {}) {
  const items = timelineItems(bundle);
  const types = [...new Set(items.map(item => item.group))];
  // الأداء: السجل يُعرض 50 واقعة في الصفحة (الأحدث أولًا) مع «تحميل المزيد».
  const start = page * pageSize;
  const shown = items.slice(start, start + pageSize);
  const hasMore = items.length > start + shown.length;
  return `${executionTimelineMarkup(items, {today: bundle.today || localDate()})}
  <section class="panel" data-collapse-default="open">
    <div class="panel-head"><h3>السجل — كل ما حدث على هذا التنفيذ</h3><span class="badge">${items.length} واقعة</span>
      ${hasMore ? `<span class="muted small">المعروض ${shown.length}</span>` : ''}</div>
    <div class="exec-controls">
      <select data-log-type aria-label="تصفية النوع"><option value="">كل الأنواع</option>${types.map(type => `<option value="${esc(type)}">${esc(type)}</option>`).join('')}</select>
      <input type="date" data-log-from aria-label="من تاريخ"><input type="date" data-log-to aria-label="إلى تاريخ">
      <input type="search" data-log-q placeholder="بحث في السجل" aria-label="بحث في السجل">
      <label class="check-line"><input type="checkbox" data-log-voided> إظهار الملغى</label>
    </div>
    <div data-tl-details class="tl-details-host"></div>
    <ol class="exec-log" data-log-list>${shown.map(logItemMarkup).join('') || '<li class="muted">لا توجد وقائع بعد. ابدأ من «+ تسجيل».</li>'}</ol>
    ${hasMore ? `<div class="form-actions"><button type="button" class="ghost" data-log-more="${page + 1}">تحميل المزيد (${Math.min(pageSize, items.length - start - shown.length)})</button>
      <button type="button" class="ghost" data-log-all>عرض كل السجل (${items.length})</button></div>` : ''}
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
      voided: Boolean(judgment.isDeleted), canEdit: !judgment.isDeleted, canVoid: !judgment.isDeleted,
      referenceNumber: judgment.judgmentNumber || '', documentNumber: judgment.judgmentNumber || ''
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
      referenceNumber: receipt.receiptNumber || receipt.reference || '', documentNumber: receipt.reference || '',
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
      amountMinor: 0, currency, voided, canEdit: !voided, canVoid: !voided,
      kindCode: action.kind || '', referenceNumber: action.referenceNumber || '', documentNumber: action.referenceNumber || ''
    });
  }
  for (const poa of bundle.poas || []) {
    const cancelled = String(poa.status || '') === 'cancelled';
    items.push({
      id: poa.id, kind: 'poa', group: 'توكيلات', icon: '🖨', date: poa.date,
      title: `توكيل${poa.poaNumber ? ` ${poa.poaNumber}` : ''} — ${Number(poa.total || 0).toLocaleString('en-US')} ج.م`,
      subtitle: `عن ${dateText(poa.fromDate)} ← ${dateText(poa.toDate)}`,
      amountMinor: Math.round(Number(poa.total || 0) * 100), currency, voided: cancelled, canPrint: true, canVoid: !cancelled, canReissue: true,
      poaNumber: poa.poaNumber || '', referenceNumber: poa.poaNumber || '', documentNumber: poa.poaNumber || ''
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

function dataTabMarkup(bundle, {uiMode = 'simple'} = {}) {
  const {execution, client, file, creditor, debtor, slices, judgments, parties, periods} = bundle;
  const simple = normalizeUiMode(uiMode, 'simple') !== 'advanced';
  const valueLines = (slices || []).filter(slice => !slice.isDeleted).map(slice => {
    const judgment = (judgments || []).find(row => row.id === (slice.judgmentId || slice.linkedJudgmentId));
    const state = String(slice.status || '');
    const badge = ['cancelled', 'superseded'].includes(state) ? ` <span class="badge danger">${state === 'cancelled' ? 'ملغاة' : 'استُبدلت'}</span>` : '';
    const beneficiaries = Array.isArray(slice.beneficiaries) ? slice.beneficiaries : [];
    const manual = isManualSliceRow(slice);
    return `<li><b>${esc(slice.entitlementType)}</b>: ${Number(slice.amount || 0).toLocaleString('en-US')} ج.م ${slice.valueType === 'fixed' ? 'مبلغ مقطوع' : slice.periodicity === 'monthly' ? 'شهريًا' : esc(slice.periodicity || '')} من ${esc(dateText(slice.startDate))}${slice.endDate ? ` حتى ${esc(dateText(slice.endDate))}` : ''}${judgment ? ` — ${judgment.judgmentKind === 'later' ? 'حكم لاحق' : 'حكم'}${judgment.judgmentNumber ? ` رقم ${esc(judgment.judgmentNumber)}` : ''}` : ''}${manual ? ' <span class="badge">فترة يدوية</span>' : ''}${badge}
      ${beneficiaries.length ? `<br><small class="muted">المستحقون: ${beneficiaries.map(row => `${esc(row.beneficiaryName)} ${Number(row.beneficiaryShare || 0).toFixed(2)}% (${money(Math.round(Number(row.amountMinor || 0)), bundle.schedule.currency)})`).join(' · ')}</small>` : ''}
      <button type="button" class="ghost small" data-slice-beneficiaries="${esc(slice.id)}">توزيع المستحقين</button></li>`;
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
  <section class="panel advanced-anchor" data-advanced-only ${simple ? 'hidden' : ''}>
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

function poaTabMarkup(bundle, {uiMode = 'simple'} = {}) {
  const {poas, schedule} = bundle;
  const currency = schedule.currency;
  const simple = normalizeUiMode(uiMode, 'simple') !== 'advanced';
  void simple;
  return `<section class="panel" data-collapse-default="open">
    <div class="panel-head"><h3>التوكيلات المحفوظة</h3><button type="button" class="ghost small" data-action="poa">+ توكيل جديد (3 خطوات)</button></div>
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
    <div class="form-actions">
      <button type="button" class="ghost" data-export="csv">⬇ تصدير CSV (يفتح في Excel)</button>
      <button type="button" class="ghost" data-export="pdf">⬇ تصدير PDF (نافذة الطباعة)</button>
      <button type="button" class="ghost" data-beneficiary-migration>🧭 ترحيل توزيع المستحقين</button>
    </div>
    <p class="muted small">الطباعة تمر عبر نظام PrintContext القائم (نفس التنسيق والترويسة)، والأرقام بفواصل آلاف والعملة ظاهرة.
      التصدير CSV بترميز UTF-8 مع BOM فيفتح صحيحًا في Excel، وبلا أي مكتبة خارجية.</p>
  </section>`;
}

/* ============================ ربط البطاقة ============================ */
export async function bindExecutionDetail(app, executionId) {
  const root = document.querySelector('#main-content');
  const bundle = cardState(app)[executionId];
  if (!root || !bundle) return false;
  const panel = root.querySelector('[data-tab-panel]');
  const guard = fn => (...args) => Promise.resolve().then(() => fn(...args)).catch(error => toast(userError(error), 'error'));
  const uiMode = normalizeUiMode(effectiveUiMode({executionId, settings: bundle.settings}), 'simple');

  const openRecord = () => recordSheet(app, executionId, {bundle});
  const openCollection = (receipt = null, periodKey = '', reason = '') => simpleCollectionDialog(app, executionId, {bundle, receipt, periodKey, reason});
  const openAction = action => simpleActionDialog(app, executionId, {action});
  const openValue = () => valueSetupDialog(app, executionId, {bundle});
  const openLaterJudgment = () => subsequentJudgmentDialog(app, executionId, {bundle});
  /**
   * التوكيل الجديد يمر بالمعالج من 3 خطوات، ويسأل صراحةً عن الرصيد السابق
   * (carry-over) قبل فتحه — لا إدراج بلا موافقة، وكل قرار في Activity Log.
   */
  const openPoa = async (fromDate = '', toDate = '', previousPoaId = '') => {
    const carry = await carryOverFlow(app, executionId, {bundle, fromDate}).catch(() => null);
    // أغلق سؤال الرصيد السابق بلا قرار ⇒ إلغاء التدفق كله (لا يُفتح المعالج بعده
    // صامتًا فتتكدس نافذتان). القرار الصريح «تجاهل» وحده يكمل بلا رصيد سابق.
    if (carry?.candidate && carry.decided === false) {
      toast('أُلغي إنشاء التوكيل — لم يُتخذ قرار في الرصيد السابق', 'info');
      return undefined;
    }
    return poaWizard(app, executionId, {bundle, fromDate, toDate, previousPoaId, carryOver: carry || null});
  };
  const openStatement = () => statementDialog(app, executionId);
  /** الطباعة تحجز النافذة داخل النقرة أولًا (وإلا منعها المتصفح بعد الـawait). */
  const printStatement = async (mode, extra = {}) => {
    const printWindow = acquirePrintWindow('كشف حساب تنفيذ');
    try {
      await S.printSimpleStatement(app.office, executionId, {mode, asOf: bundle.schedule.asOf, window: printWindow, ...extra});
      toast('فُتح الكشف للطباعة — اختر «حفظ كـPDF» من نافذة الطباعة لتصدير PDF', 'ok', {duration: 6000});
    } catch (error) {
      if (printWindow) { try { printWindow.close(); } catch { /* تجاهل */ } }
      throw error;
    }
  };
  const exportCsv = async () => {
    const {csv} = await buildStatementCsv(app.office, executionId, {mode: 'monthly', asOf: bundle.schedule.asOf});
    const name = `${statementFileName(bundle.execution.internalNumber || bundle.execution.officialNumber || '', 'كشف-حساب')}.csv`;
    const ok = downloadTextFile({filename: name, text: csv});
    if (ok) toast(`صُدِّر الكشف إلى ${name} — UTF-8 مع BOM فيفتح صحيحًا في Excel`, 'ok', {duration: 6000});
    else toast('تعذر تنزيل الملف في هذه البيئة', 'error');
  };

  const runAction = {
    action: () => openAction(null),
    'manual-period': () => manualPeriodDialog(app, executionId, {bundle}),
    'next-period': () => nextPeriodDialog(app, executionId, {bundle}),
    'manual-periods': () => manualPeriodsDialog(app, executionId, {bundle}),
    'export-csv': exportCsv,
    'export-pdf': () => printStatement('monthly'),
    'beneficiary-migration': () => beneficiaryMigrationDialog(app),
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
      // كانت القائمة تعرض «إيقاف» فقط حتى على تنفيذ موقوف فعلًا — الآن تعكس الحالة.
      const current = String(bundle.execution?.lifecycleOverride || '');
      if (current === 'suspended' || current === 'closed') return runAction.resume();
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

  const tabView = {accountPage: 0, accountPageSize: PERIODS_PAGE_SIZE, logPage: 0, logPageSize: LOG_PAGE_SIZE};
  const showTab = async (tab, {scrollTo = ''} = {}) => {
    prefs.set(TAB_KEY, tab);
    root.querySelectorAll('.exec-tabs [data-tab]').forEach(button => {
      const active = button.dataset.tab === tab;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
    });
    panel.innerHTML = renderTab(bundle, tab, {uiMode, page: tab === 'log' ? tabView.logPage : tabView.accountPage, pageSize: tab === 'log' ? tabView.logPageSize : tabView.accountPageSize});
    bindContainer(panel);
    if (scrollTo) panel.querySelector(scrollTo)?.scrollIntoView?.({block: 'start'});
  };

  const bindContainer = container => {
    // querySelector المفرد لا يكفي عند تكرار الـ hook — نربط كل الأزرار التي تحمل نفس الخاصية
    container.querySelectorAll('[data-settings]').forEach(b => b.addEventListener('click', () => executionSettingsDialog(app)));
    container.querySelectorAll('[data-help]').forEach(b => b.addEventListener('click', () => openHelp(app)));
    container.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', guard(() => runAction[button.dataset.action]?.())));
    container.querySelectorAll('[data-trace]').forEach(button => button.addEventListener('click', () => traceDialog(bundle, button.dataset.trace)));
    container.querySelectorAll('[data-open-duration]').forEach(button => button.addEventListener('click', guard(() => durationDialog(app, executionId, {lockExecution: true, bundle}))));
    container.querySelectorAll('[data-statement-mode]').forEach(button => button.addEventListener('click', guard(async () => {
      const mode = button.dataset.statementMode;
      // «كشف عن مدة» بلا تاريخين كان يطبع الجدول كاملًا صامتًا — الآن يفتح نافذة
      // المدة نفسها (نفس المسار القائم) ليختار المستخدم نطاقه صراحةً.
      if (mode === 'range') return statementDialog(app, executionId, {mode: 'range'});
      await printStatement(mode);
      return undefined;
    })));
    container.querySelectorAll('[data-export]').forEach(button => button.addEventListener('click', guard(async () => {
      if (button.dataset.export === 'csv') return exportCsv();
      return printStatement('monthly');
    })));
    container.querySelectorAll('[data-slice-beneficiaries]').forEach(button => button.addEventListener('click', guard(() => {
      const slice = (bundle.slices || []).find(row => row.id === button.dataset.sliceBeneficiaries);
      return slice ? sliceBeneficiaryDialog(app, slice) : undefined;
    })));
    container.querySelectorAll('[data-beneficiary-migration]').forEach(button => button.addEventListener('click', guard(() => beneficiaryMigrationDialog(app))));
    container.querySelectorAll('[data-receipt-beneficiaries]').forEach(button => button.addEventListener('click', guard(() => {
      const receipt = (bundle.receipts || []).find(row => row.id === button.dataset.receiptBeneficiaries);
      return receipt ? receiptBeneficiaryDialog(app, receipt, {fallbackName: bundle.creditor?.name || bundle.client?.fullName || ''}) : undefined;
    })));
    // ترقيم صفحات الفترات (24/صفحة + تحميل المزيد + عرض الكل مع تحذير)
    container.querySelectorAll('[data-periods-more]').forEach(button => button.addEventListener('click', () => {
      tabView.accountPage = Number(button.dataset.periodsMore || 0);
      tabView.accountPageSize = Number(button.dataset.periodsPageSize || PERIODS_PAGE_SIZE);
      panel.innerHTML = renderTab(bundle, 'account', {uiMode, page: tabView.accountPage, pageSize: tabView.accountPageSize});
      bindContainer(panel);
    }));
    container.querySelectorAll('[data-periods-all]').forEach(button => button.addEventListener('click', async () => {
      const total = Number(button.dataset.periodsAll || 0);
      if (total > PERIODS_SHOW_ALL_WARN) {
        const ok = await confirmBox(`عرض ${total} فترة دفعة واحدة؟ قد يبطؤ الرسم على الأجهزة الضعيفة.`, {okText: 'عرض الكل'});
        if (!ok) return;
      }
      tabView.accountPage = 0; tabView.accountPageSize = 0;
      panel.innerHTML = renderTab(bundle, 'account', {uiMode, page: 0, pageSize: 0});
      bindContainer(panel);
    }));
    container.querySelectorAll('[data-periods-page]').forEach(button => button.addEventListener('click', () => {
      tabView.accountPage = Number(button.dataset.periodsPage || 0);
      tabView.accountPageSize = Number(button.dataset.periodsPageSize || PERIODS_PAGE_SIZE);
      panel.innerHTML = renderTab(bundle, 'account', {uiMode, page: tabView.accountPage, pageSize: tabView.accountPageSize});
      bindContainer(panel);
    }));
    // ترقيم صفحات السجل (50/صفحة)
    container.querySelectorAll('[data-log-more]').forEach(button => button.addEventListener('click', () => {
      tabView.logPage = Number(button.dataset.logMore || 0);
      panel.innerHTML = renderTab(bundle, 'log', {uiMode, page: tabView.logPage, pageSize: tabView.logPageSize});
      bindContainer(panel);
    }));
    container.querySelectorAll('[data-log-all]').forEach(button => button.addEventListener('click', () => {
      tabView.logPage = 0; tabView.logPageSize = 0;
      panel.innerHTML = renderTab(bundle, 'log', {uiMode, page: 0, pageSize: 0});
      bindContainer(panel);
    }));
    container.querySelectorAll('[data-hint-action]').forEach(button => button.addEventListener('click', guard(() => (button.dataset.hintAction === 'judgment' ? runAction.edit() : openValue()))));
    container.querySelectorAll('[data-row-info]').forEach(button => button.addEventListener('click', () => periodDetailsDialog(app, bundle, button.dataset.rowInfo)));
    container.querySelectorAll('[data-change]').forEach(button => button.addEventListener('click', () => {
      const row = bundle.schedule.rows.find(item => item.fromDate === button.dataset.change);
      if (row) valueChangeDialog(row, bundle.schedule.currency);
    }));
    container.querySelectorAll('[data-pin-collection]').forEach(button => button.addEventListener('click', guard(() => openCollection(null, button.dataset.pinCollection))));
    container.querySelectorAll('[data-account-filter]').forEach(button => button.addEventListener('click', async () => {
      prefs.set(accountFilterKey(bundle.execution.id), button.dataset.accountFilter);
      tabView.accountPage = 0;
      panel.innerHTML = renderTab(bundle, 'account', {uiMode, page: 0, pageSize: tabView.accountPageSize});
      bindContainer(panel);
    }));
    container.querySelectorAll('[data-edit]').forEach(button => button.addEventListener('click', guard(async () => {
      const {kind, edit} = button.dataset;
      if (kind === 'receipt') {
        const receipt = (bundle.receipts || []).find(row => row.id === edit);
        if (!receipt) return undefined;
        // تأكيد قبل تعديل سجل مرتبط بفترة: الافتراضي تصحيح جديد ولا يلمس الأصل.
        const linkedRow = (bundle.schedule.rows || []).find(row => (row.lines || []).some(line => line.receiptId === receipt.id));
        if (linkedRow && periodLinkedReceipts(linkedRow, bundle).length) {
          return editLinkedReceipt(app, bundle, linkedRow, receipt, {openEdit: (row, reason) => openCollection(row, '', reason)});
        }
        return openCollection(receipt);
      }
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
      // النافذة تُحجز داخل النقرة قبل القراءة — وإلا منعها المتصفح صامتًا.
      const printWindow = acquirePrintWindow('توكيل بالتنفيذ');
      try {
        await S.printSimplePoa(app.office, button.dataset.printPoa, {window: printWindow});
        toast('فُتح التوكيل للطباعة بترقيم الصفحات', 'ok');
      } catch (error) {
        if (printWindow) { try { printWindow.close(); } catch { /* تجاهل */ } }
        throw error;
      }
      return undefined;
    })));
    // «توكيل جديد» من توكيل محفوظ = إعادة إصدار تبدأ بعد نهايته (كانت تفتح فارغة).
    container.querySelectorAll('[data-reissue-poa]').forEach(button => button.addEventListener('click', guard(() => {
      const previous = (bundle.poas || []).find(row => row.id === button.dataset.reissuePoa) || null;
      const fromDate = previous?.toDate ? addCivilDays(previous.toDate, 1) : '';
      return openPoa(fromDate, localDate(), previous?.id || '');
    })));
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
    // Timeline الأفقي أعلى السجل: النقر على مرحلة يعرض وقائعها ويعيد استخدام أزرار السجل.
    const timelineHost = container.querySelector('.exec-cycle');
    if (timelineHost) {
      bindExecutionTimeline(timelineHost, {
        getNodes: () => buildStageNodes(timelineItems(bundle)).nodes,
        onOpenItem: (id, kind) => {
          const button = panel.querySelector(`[data-${kind === 'poa' ? 'print-poa' : 'edit'}="${CSS.escape ? CSS.escape(id) : id}"]`)
            || panel.querySelector(`[data-edit="${id}"]`);
          if (button) button.click();
          else periodDetailsDialog(app, bundle, id);
        }
      });
    }
  };

  root.querySelectorAll('.exec-toolbar [data-action]').forEach(button => button.addEventListener('click', guard(() => {
    // Close more menu after clicking an action
    if (moreMenu) { moreMenu.hidden = true; root.querySelectorAll('[data-more]').forEach(b => b.setAttribute('aria-expanded', 'false')); }
    return runAction[button.dataset.action]?.();
  })));
  root.querySelectorAll('.exec-tabs [data-tab]').forEach(button => button.addEventListener('click', () => showTab(button.dataset.tab).catch(error => app.fail(error))));
  root.querySelectorAll('[data-record]').forEach(el => el.addEventListener('click', openRecord));
  root.querySelectorAll('[data-open-duration]').forEach(el => el.addEventListener('click', guard(() => durationDialog(app, executionId, {lockExecution: true, bundle}))));
  root.querySelectorAll('[data-open-statement]').forEach(el => el.addEventListener('click', openStatement));
  root.querySelectorAll('[data-help]').forEach(el => el.addEventListener('click', () => openHelp(app)));
  root.querySelectorAll('[data-settings]').forEach(el => el.addEventListener('click', () => executionSettingsDialog(app)));
  root.querySelectorAll('[data-shortcuts-help]').forEach(el => el.addEventListener('click', () => showExecutionShortcutsPanel()));
  // [data-more] قد يتكرر — نربط كل الأزرار
  const moreMenu = root.querySelector('[data-more-menu]');
  root.querySelectorAll('[data-more]').forEach(moreButton => moreButton.addEventListener('click', () => {
    if (!moreMenu) return;
    moreMenu.hidden = !moreMenu.hidden;
    moreButton.setAttribute('aria-expanded', String(!moreMenu.hidden));
  }));
  // إغلاق قائمة «المزيد» بالنقر خارجها: المستمع كان يُضاف على document عند كل
  // دخول للبطاقة ولا يُزال أبدًا (تسريب + مراجع DOM ميتة). الآن يُزال عند
  // انفصال البطاقة أو عند إغلاق القائمة نفسها.
  const closeMoreMenu = () => {
    if (!moreMenu) return;
    moreMenu.hidden = true;
    root.querySelectorAll('[data-more]').forEach(b => b.setAttribute('aria-expanded', 'false'));
  };
  const onDocumentClick = event => {
    if (!root.isConnected || !moreMenu.isConnected) { document.removeEventListener('click', onDocumentClick); return; }
    if (moreMenu.hidden) return;
    if (!moreMenu.contains(event.target) && !event.target.closest?.('[data-more]')) closeMoreMenu();
  };
  document.addEventListener('click', onDocumentClick);
  root.querySelectorAll('[data-delete-execution]').forEach(el => el.addEventListener('click', async () => {
    if (!await confirmBox('حذف ملف التنفيذ بالكامل منطقيًا؟ يُحفظ كل شيء ويمكن استعادته من سلة التنفيذ.', {okText: 'حذف الملف'})) return;
    try {
      await EX.deleteExecution(app.office, executionId, bundle.execution.version ?? null, 'حذف من البطاقة');
      toast('تم الحذف المنطقي — الاستعادة من سلة التنفيذ');
      await app.go('executionCenter');
    } catch (error) { toast(userError(error), 'error'); }
  }));
  // تاريخ الحساب: قد يكون لكل بطاقة على حدة — استخدم المفتاح المحلي إن وجد
  root.querySelectorAll('[data-asof]').forEach(asofInput => asofInput.addEventListener('change', async () => {
    const executionId = bundle?.execution?.id || '';
    const localKey = executionId ? `ui:exec:asof:${executionId}` : '';
    const value = asofInput.value || '';
    if (localKey) await prefs.set(localKey, value);
    else await prefs.set(ASOF_KEY, value);
    // إن كان الوضع موحّد، حدّث المفتاح العام أيضًا
    const mode = prefs.get('ui:exec:asof-mode:v1', 'per');
    if (mode === 'global' || !localKey) await prefs.set(ASOF_KEY, value);
    await app.refresh();
  }));
  // زر الرجوع إلى اليوم: تاريخ الحساب محفوظ عالميًا، وتاريخ قديم يخفي الحسابات
  // عن كل التنفيذات (وينشأ تنفيذ جديد يبدو بلا أرقام) — فنجعل الرجوع بنقرة واحدة.
  // زر الرجوع إلى اليوم يمسح المحلي فقط ثم يعيد الرسم — العام يبقى كافتراضي للجلسة
  root.querySelectorAll('[data-asof-today]').forEach(el => el.addEventListener('click', async () => {
    const executionId = bundle?.execution?.id || '';
    if (executionId) {
      await prefs.set(`ui:exec:asof:${executionId}`, '');
      await prefs.set(ASOF_KEY, '');
    } else {
      await prefs.set(ASOF_KEY, '');
    }
    await app.refresh();
  }));
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

  /* ---------- بطاقة الملخص السريع: نفس النوافذ القائمة، بلا مسارات موازية ---------- */
  const quickCard = root.querySelector('[data-execution-card]');
  if (quickCard) {
    bindExecutionSummaryCard(quickCard, {
      trace: event => traceDialog(bundle, event?.currentTarget?.dataset?.trace || 'due'),
      duration: () => durationDialog(app, executionId, {lockExecution: true, bundle}),
      poa: () => openPoa(),
      collection: () => openCollection(),
      action: () => openAction(null),
      expense: () => simpleExpenseDialog(app, executionId),
      print: () => statementDialog(app, executionId),
      horizon: () => openHorizonPicker(app, executionId, {bundle}),
      uiMode: async () => {
        const next = await toggleUiMode({executionId, settings: bundle.settings, office: app.office});
        await app.refresh();
        toast(next === 'simple' ? 'العرض المبسّط — الأدوات المتقدمة مخفية' : 'العرض المتقدّم — كل الأدوات ظاهرة', 'ok');
      }
    });
  }

  /* ---------- وضع الحساب السريع: النتيجة في مكانها، debounce 250ms ---------- */
  bindQuickCalc(root, {
    office: app.office, executionId,
    getAnchor: () => anchorOf(bundle),
    onApplied: async asOf => {
      await prefs.set(`ui:exec:asof:${executionId}`, asOf);
      const mode = prefs.get(ASOF_MODE_KEY, 'per');
      if (mode === 'global') await prefs.set(ASOF_KEY, asOf);
      await app.refresh();
    }
  });

  /* ---------- ملاحظات سريعة: مربع دائم أسفل الملخص ---------- */
  bindQuickNotes(root, {
    app, executionId,
    onSaved: async () => {
      const host = root.querySelector('[data-quicknotes-list]');
      if (!host) return;
      const notes = await loadExecutionNotes(app.office, executionId, {limit: 3}).catch(() => []);
      const list = notes.map(note => `<li class="qn-row"><span class="qn-body">${esc(String(note.body || note.text || '').slice(0, 220))}</span>
        <small class="muted">${esc(dateText(String(note.updatedAt || note.createdAt || '').slice(0, 10)))}</small></li>`).join('');
      if (host.tagName === 'UL') host.innerHTML = list || '<li class="muted small">لا ملاحظات بعد.</li>';
      else host.outerHTML = list ? `<ul class="plain-list qn-list" data-quicknotes-list>${list}</ul>` : host.outerHTML;
    }
  });

  /* ---------- اختصارات Alt داخل البطاقة ---------- */
  installExecutionShortcuts({
    root, executionId,
    handlers: {
      collection: () => openCollection(),
      action: () => openAction(null),
      expense: () => simpleExpenseDialog(app, executionId),
      poa: () => openPoa(),
      duration: () => durationDialog(app, executionId, {lockExecution: true, bundle}),
      print: () => statementDialog(app, executionId),
      horizon: () => openHorizonPicker(app, executionId, {bundle})
    }
  });

  /* ---------- تطبيق وضع العرض (مبسّط/متقدّم) ---------- */
  applyUiMode(root, uiMode);
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
  // الشفافية المطلقة: أول سطر في التفسير هو المعادلة المختصرة دائمًا.
  const equationFirst = `المعادلة: ${summaryEquation(bundle)}`;
  const equations = which === 'due'
    ? [`مجموع استحقاق الفترات حتى ${dateText(schedule.asOf)} = ${money(totals.dueMinor, currency)}`, ...schedule.rows.slice(0, 12).map(row => `${row.label}: ${row.trace?.equation || `${money(row.dueMinor, currency)}`}`)]
    : which === 'paid'
      ? [`مجموع المحاضر المسجلة = ${money(totals.paidMinor, currency)}`, `المخصّص على الفترات = ${money(totals.allocatedMinor, currency)}`, `رصيد دائن غير مخصص = ${money(totals.creditMinor, currency)}`, ...(schedule.receipts || []).map(receipt => `${receipt.receiptNumber || 'محضر'} ${dateText(receipt.date)}: ${money(receipt.amountMinor, currency)} (مخصص ${money(receipt.allocatedMinor, currency)}${receipt.creditMinor ? ` · دائن ${money(receipt.creditMinor, currency)}` : ''})`)]
      : [`المتبقي = المطلوب − المخصّص = ${money(totals.remainingMinor, currency)}`, ...schedule.rows.filter(row => row.remainingMinor > 0).slice(0, 12).map(row => `${row.label}: ${money(row.dueMinor, currency)} − ${money(row.paidMinor, currency)} = ${money(row.remainingMinor, currency)}`), ...(totals.overpaidMinor > 0 ? [`دفعة زائدة ظاهرة: ${money(totals.overpaidMinor, currency)} (بلا رد تلقائي)`] : [])];
  return modal(`<h2 class="modal-title">كيف حُسب: ${esc(title)}</h2>
    <p class="hint hint-info"><b>${esc(equationFirst)}</b></p>
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
  const sourceNote = periodSourceNote(row, bundle);
  const linked = periodLinkedReceipts(row, bundle);
  const isManual = isManualRow(row, bundle);
  const card = modal(`<h2 class="modal-title">${esc(row.label)} — تفاصيل الفترة${isManual ? ' <span class="badge">يدوية</span>' : ''}</h2>
    <p class="hint hint-info"><b>المعادلة:</b> ${esc(periodEquationLine(row, currency) || row.trace?.equation || '—')}</p>
    <div class="exec-numbers small">
      <div class="num"><span>المستحق</span><b>${moneyShort(row.dueMinor, currency)}</b></div>
      <div class="num"><span>المدفوع</span><b>${moneyShort(row.paidMinor, currency)}</b></div>
      <div class="num num-primary"><span>المتبقي</span><b>${moneyShort(row.remainingMinor, currency)}</b></div>
    </div>
    <h3 class="exec-sub">مصدر القيمة</h3>
    ${sourceNote ? `<p class="muted small"><b>الحالة:</b> ${esc(sourceNote)}</p>` : ''}
    <ul class="plain-list">${(row.units || []).flatMap(unit => (unit.parts || []).map(part => `<li>${esc(unit.entitlementType || '')}: ${esc(part.equation || '')}${part.sourceReference ? ` <span class="muted">(${esc(part.sourceReference)})</span>` : ''}</li>`)).join('') || '<li class="muted">—</li>'}</ul>
    ${row.valueChanges?.length ? `<p class="muted small">تغيّرت القيمة بحكم لاحق داخل هذه الفترة — <button type="button" class="link" data-change="${esc(row.fromDate)}">عرض الفرق</button></p>` : ''}
    <h3 class="exec-sub">ما خُصّص على هذه الفترة</h3>
    ${(row.lines || []).length ? `<ul class="plain-list">${row.lines.map(line => {
      const receipt = receiptById.get(line.receiptId);
      const beneficiaries = Array.isArray(receipt?.beneficiaries) ? receipt.beneficiaries : [];
      return `<li>${receipt ? `محضر ${esc(receipt.receiptNumber || '')} ${esc(dateText(receipt.date || ''))}` : 'توزيع تلقائي'} — ${money(line.amountMinor, currency)} <span class="muted">(${line.mode === 'direct' ? 'محدد' : 'الأقدم أولًا'})</span>
        ${receipt ? `<button type="button" class="ghost small" data-edit="${esc(receipt.id)}" data-kind="receipt">تعديل</button><button type="button" class="ghost small" data-receipt-beneficiaries="${esc(receipt.id)}">توزيع المستحقين</button>` : ''}
        ${beneficiaries.length ? `<br><small class="muted">المستحقون: ${beneficiaries.map(item => `${esc(item.beneficiaryName)} ${Number(item.beneficiaryShare || 0).toFixed(2)}% (${money(Math.round(Number(item.amountMinor || 0)), currency)})`).join(' · ')}</small>` : ''}</li>`;
    }).join('')}</ul>` : '<p class="muted">لم يُخصَّص شيء على هذه الفترة بعد.</p>'}
    ${linked.length ? `<p class="hint hint-warn small">⚠ هذه الفترة مرتبطة بحركة سابقة (${linked.map(item => `${esc(item.receipt.receiptNumber || 'محضر')} بتاريخ ${esc(dateText(item.receipt.date || ''))}`).join(' · ')}). التعديل المباشر يغيّر السجل الأصلي — يُقترح تسجيل تصحيح جديد بدل التعديل.</p>` : ''}
    ${row.overpaidMinor > 0 ? `<p class="warn-line">دفعة زائدة ${money(row.overpaidMinor, currency)} — لا رد تلقائي ولا تسوية صامتة.</p>` : ''}
    ${row.status === PERIOD_STATUS.RUNNING ? `<p class="hint hint-info small">⏳ فترة جارية: قيمتها المتوقعة ${money(row.projectedMinor, currency)} — لا تدخل في «المطلوب» إلا باكتمالها (أو بتغيير توقيت الاستحقاق في الإعدادات).</p>` : ''}
    <div class="form-actions">
      <button type="button" class="ghost" data-duration-here>احسب مدة تشمل هذه الفترة</button>
      <button type="button" class="ghost" data-pin-collection="${esc(row.fromDate)}">تحصيل هنا</button>
      ${linked.length ? '<button type="button" class="ghost" data-period-correction>تسجيل تصحيح بدل التعديل</button>' : ''}
      <button type="button" class="ghost" data-close>إغلاق</button>
    </div>`);
  card.querySelector('[data-duration-here]')?.addEventListener('click', () => { closeModal(); durationDialog(app, bundle.execution.id, {lockExecution: true, bundle, fromDate: row.fromDate, toDate: row.toDate}); });
  // تأكيد قبل تعديل فترة مرتبطة بمحضر: الافتراضي تصحيح جديد ولا يلمس الأصل.
  card.querySelector('[data-period-correction]')?.addEventListener('click', async () => {
    const target = linked[0]?.receipt || null;
    closeModal();
    if (!target) return;
    await editLinkedReceipt(app, bundle, row, target, {openEdit: (receipt, reason) => openCollection(receipt, '', reason)});
  });
  return card;
}

export {EXECUTION_TYPE_LABELS};
