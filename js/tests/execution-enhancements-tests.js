// =====================================================================
// اختبارات إضافات مركز التنفيذ (المرحلة 1 إصلاحات + المرحلة 2 + المرحلة 3)
// ---------------------------------------------------------------------
// تعمل على IndexedDB وهمي داخل Node (نفس بيئة بقية الاختبارات)، وتتحقق من:
// • إصلاحات الطباعة والتوكيل (مطالب بالمتبقي، رسوم/دمغة محفوظة ومطبوعة،
//   تواريخ DD/MM/YYYY، نافذة طباعة محجوزة داخل النقرة).
// • شفافية الحساب: معادلة + مصدر لكل فترة.
// • محرك الفترات: فترة يدوية مستقلة + اقتراح الفترة التالية.
// • شاشة الأفق: اختصارات من الارتكاز + معاينة بلا مسار حساب موازٍ.
// • مركز «يحتاج انتباهي»: الفئات الخمس + حدود قابلة للتعديل.
// • متعدد المستحقين: شرط المجموع = مبلغ المحضر + ترحيل إضافي بلا تغيير سكيما.
// • التصدير: CSV بـUTF-8 مع BOM وأعمدة محددة.
// =====================================================================
import {upgradeSchema} from '../db/schema.js';
import {ERR} from '../core/errors.js';
import {SCHEMA_VERSION} from '../core/constants.js';
import {Office} from '../services/office.js';
import {localDate} from '../core/clock.js';
import * as SIMPLE from '../services/execution-simple.js';
import * as ATT from '../services/execution-attention.js';
import * as MP from '../services/execution-manual-periods.js';
import * as BEN from '../services/execution-beneficiaries.js';
import * as EXPORT from '../services/execution-export.js';
import * as PRINT from '../services/execution-print.js';
import {executionSettings, saveExecutionSettings, resetExecutionSettings, normalizeUiMode} from '../services/execution-settings.js';
import * as HORIZON from '../ui/execution-horizon-picker.js';
import * as CARD from '../ui/execution-summary-card.js';
import * as TIMELINE from '../ui/execution-timeline.js';
import * as ENGINE from '../ui/execution-period-engine.js';
import * as CARRY from '../ui/execution-carryover.js';
import * as EXTRAS from '../ui/execution-extras.js';

async function openDb(name) {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(name, SCHEMA_VERSION);
    r.onupgradeneeded = e => upgradeSchema(r.result, e.target.transaction);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function env() {
  const name = `AhmadKhudairLawOfficeDB__test__exec-enh__${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const db = await openDb(name);
  const office = new Office({db, assert() {}, token: 'exec-enh-test', profile: {id: 'tester'}});
  await resetExecutionSettings(office);
  return {db, office, name};
}
const closeEnv = e => { try { e.db.close(); indexedDB.deleteDatabase(e.name); } catch {} };
const rejects = async fn => { try { await fn(); } catch (error) { return error; } throw Error('Expected promise to reject'); };

/**
 * ملف تنفيذ فعلي كامل: 3,000 شهريًا مرتكزة على 05/07/2026 + تحصيل جزئي +
 * تكليف بالوفاء + محضر تبديد + مصروف. يُستخدم في كل مجموعات هذا الملف.
 */
async function actualFile({withCollection = true, withDissipation = true} = {}) {
  const e = await env();
  const {office} = e;
  const created = await SIMPLE.createSimpleExecution(office, {
    newClientName: 'منى إبراهيم عبد الرحمن', opponentName: 'خالد سعيد محمود',
    executionType: 'family', entitlementType: 'نفقة صغار', valueType: 'periodic',
    periodicity: 'monthly', amount: 3000, effectiveFrom: '2026-07-05',
    judgmentNumber: '1234 لسنة 2026 أسرة المنصورة', judgmentDate: '2026-06-20',
    court: 'محكمة الأسرة بالمنصورة', officialNumber: '555/2026', openedDate: '2026-10-05',
    executionMethod: 'تكليف بالوفاء ثم حجز', authority: 'قلم تنفيذ محكمة الأسرة بالمنصورة'
  });
  const executionId = created.execution.id;
  let receipt = null;
  if (withCollection) {
    receipt = await SIMPLE.recordSimpleCollection(office, {executionId, amount: 1500, date: '2026-10-01', paymentMethod: 'نقدي', target: 'period', periodKey: `نفقة صغار::2026-07-05`});
  }
  let dissipation = null;
  if (withDissipation) {
    await SIMPLE.recordSimpleAction(office, {executionId, kind: 'summons', date: '2026-10-02', referenceNumber: '452/2026', result: 'تم تسجيل الإجراء'});
    dissipation = await SIMPLE.recordSimpleAction(office, {executionId, kind: 'dissipation', date: '2026-09-20', referenceNumber: '452 لسنة 2026', authority: 'قلم تنفيذ'});
  }
  await SIMPLE.recordSimpleExpense(office, {executionId, typeLabel: 'رسم تنفيذ', amount: 250, date: '2026-10-03', includeInPoa: true, label: 'رسم تنفيذ'});
  const bundle = await SIMPLE.simpleCardBundle(office, executionId, {asOf: '2026-10-05', allowFuture: true});
  return {...e, created, executionId, receipt, dissipation, bundle};
}

export async function runExecutionEnhancementsTests(test, expect) {
  /* ===================== إصلاحات التوكيل (المرحلة 1) ===================== */
  test('توكيل — يطالب بالمتبقي داخل المدة لا بالمستحق الكامل (خصم المحصّل)', async () => {
    const e = await actualFile();
    try {
      const draft = await SIMPLE.simplePoaDraft(e.office, e.executionId, {fromDate: '2026-07-05', toDate: '2026-10-04'});
      expect(Number(draft.periodDueMinor)).toBe(900000);      // 3 × 3,000 مستحق
      expect(Number(draft.periodPaidMinor)).toBe(150000);     // محصّل داخل المدة
      expect(Number(draft.periodClaimMinor)).toBe(750000);    // المطلوب فعلًا
      expect(Number(draft.totalMinor)).toBe(750000);
      const periodLines = draft.lines.filter(line => line.kind === 'period');
      expect(periodLines.every(line => line.amountMinor === Math.max(0, line.dueMinor - line.paidMinor))).toBe(true);
      expect(draft.lines.filter(line => line.kind === 'period' && line.paidMinor > 0)[0].equation.includes('− محصّل')).toBe(true);
    } finally { closeEnv(e); }
  });

  test('توكيل — الرسوم والدمغة تُحفظ على الصف وتُطبع في المستند مع المعادلة', async () => {
    const e = await actualFile();
    try {
      const draft = await SIMPLE.simplePoaDraft(e.office, e.executionId, {fromDate: '2026-07-05', toDate: '2026-10-04', fees: 500, stamps: 100});
      expect(Number(draft.feesMinor)).toBe(50000);
      expect(Number(draft.stampsMinor)).toBe(10000);
      expect(Number(draft.totalMinor)).toBe(810000);
      const poa = await SIMPLE.saveSimplePoa(e.office, e.executionId, draft, {date: '2026-10-05', notes: 'توكيل بمحضر التبديد 452', printNow: false});
      expect(Number(poa.feesAmount)).toBe(500);
      expect(Number(poa.stampAmount)).toBe(100);
      expect(Number(poa.baseAmount)).toBe(7500);
      expect(String(poa.notes).includes('452')).toBe(true);
      const sum = (poa.lines || []).reduce((acc, line) => acc + Number(line.amount || 0), 0);
      expect(Math.abs(sum - Number(poa.total)) < 0.01).toBe(true);
      const doc = await PRINT.buildPoaDocument(e.office, poa.id);
      expect(doc.html.includes('500.00')).toBe(true);
      expect(doc.html.includes('100.00')).toBe(true);
      expect(doc.html.includes('المعادلة:')).toBe(true);
      expect(doc.html.includes('توكيل بمحضر التبديد 452')).toBe(true);
      // لا فرق صامت بين مجموع البنود والإجمالي
      expect(Math.abs(doc.tableSum - Number(poa.total)) < 0.01).toBe(true);
      expect(doc.html.includes('فرق ')).toBe(false);
    } finally { closeEnv(e); }
  });

  test('طباعة — مستند التوكيل بتواريخ DD/MM/YYYY وبلا أرقام هندية وبلا تكرار بنود', async () => {
    const e = await actualFile();
    try {
      const draft = await SIMPLE.simplePoaDraft(e.office, e.executionId, {fromDate: '2026-07-05', toDate: '2026-10-04', fees: 500, stamps: 100});
      const poa = await SIMPLE.saveSimplePoa(e.office, e.executionId, draft, {date: '2026-10-05', printNow: false});
      const doc = await PRINT.buildPoaDocument(e.office, poa.id);
      const text = doc.html.replace(/<[^>]+>/g, ' ');
      expect(/\b2026-\d{2}-\d{2}\b/.test(text)).toBe(false);
      expect(text.includes('05/10/2026')).toBe(true);
      expect(text.includes('05/07/2026')).toBe(true);
      expect(/[٠-٩]/.test(text)).toBe(false);
      expect(text.includes('البيان | المبلغ')).toBe(false);
      expect(doc.data.poa.periodCount).toBe(3);
    } finally { closeEnv(e); }
  });

  test('طباعة — النافذة تُحجز داخل النقرة (acquirePrintWindow) وتُكتب لاحقًا', async () => {
    const opened = [];
    const previousWindow = globalThis.window;
    const fakeDoc = () => ({open() {}, write(html) { this.html = String(html); }, close() {}});
    globalThis.window = {open: () => { const w = {document: fakeDoc(), closed: false, close() { this.closed = true; }, opener: null}; opened.push(w); return w; }};
    try {
      const target = PRINT.acquirePrintWindow('كشف حساب تنفيذ');
      expect(Boolean(target)).toBe(true);
      expect(opened.length).toBe(1);
      expect(target.document.html.includes('جارٍ تجهيز')).toBe(true);
      PRINT.writePrintDocument(target, '<!doctype html><html><body><h1>كشف</h1></body></html>');
      expect(target.document.html.includes('كشف')).toBe(true);
      expect(target.document.html.includes('window.print()')).toBe(true);
      const failed = {document: fakeDoc(), closed: false, close() { this.closed = true; }};
      PRINT.releasePrintWindow(failed, 'تعذر بناء المستند');
      expect(failed.document.html.includes('تعذر تجهيز المستند')).toBe(true);
    } finally { globalThis.window = previousWindow; }
  });

  test('كشف عن مدة — يطبع النطاق المحدد فقط ويعلن النطاق المشتق عند غياب التاريخين', async () => {
    const e = await actualFile();
    try {
      const ranged = await SIMPLE.simpleStatementDocument(e.office, e.executionId, {mode: 'range', fromDate: '2026-08-05', toDate: '2026-10-04'});
      expect(ranged.rows.length).toBe(2);
      expect(ranged.html.includes('المدة: 05/08/2026 ← 04/10/2026')).toBe(true);
      expect(ranged.html.includes('05/07/2026 – 04/08/2026')).toBe(false);
      const derived = await SIMPLE.simpleStatementDocument(e.office, e.executionId, {mode: 'range'});
      expect(derived.html.includes('لم يُحدد نطاق صريح')).toBe(true);
      expect(derived.scope !== null).toBe(true);
      const summary = await SIMPLE.simpleStatementDocument(e.office, e.executionId, {mode: 'summary', asOf: '2026-10-05'});
      expect(summary.html.includes('مكتب الأستاذ')).toBe(true);
      expect(summary.html.includes('المعادلة:')).toBe(true);
      expect(summary.html.includes('المحامي')).toBe(true);
      expect(summary.html.includes('بيان حسابي من واقع السجلات')).toBe(true);
    } finally { closeEnv(e); }
  });

  test('تحصيل — اختيار فترة محددة يُحفظ DIRECT ولا يسقط إلى التوزيع التلقائي', async () => {
    const e = await actualFile();
    try {
      const receipts = await e.office.r.executionReceipts.byIndex('executionId', e.executionId, 20);
      const row = receipts[0];
      expect(row.allocationMethod).toBe('DIRECT');
      expect(String(row.allocationTarget).includes('::2026-07-05')).toBe(true);
      const allocations = await e.office.r.executionAllocations.byIndex('executionId', e.executionId, 20);
      expect(allocations.filter(item => item.method === 'DIRECT').length).toBe(1);
    } finally { closeEnv(e); }
  });

  /* ===================== شفافية الحساب (المرحلة 2 — 3) ===================== */
  test('شفافية — لكل فترة معادلة ومصدر، وتفاصيل الفترة بلا «وحدة صغرى»', async () => {
    const e = await actualFile();
    try {
      const row = e.bundle.schedule.rows[0];
      const equation = ENGINE.periodEquationLine(row, e.bundle.schedule.currency);
      expect(equation.includes('فترة كاملة')).toBe(true);
      expect(equation.includes('محصّل')).toBe(true);
      expect(equation.includes('وحدة صغرى')).toBe(false);
      expect(/\d{4}-\d{2}-\d{2}/.test(equation)).toBe(false);
      const source = ENGINE.periodSourceNote(row, e.bundle);
      expect(source.includes('نفقة صغار')).toBe(true);
      expect(source.includes('1234 لسنة 2026')).toBe(true);
      expect(CARD.summaryEquation(e.bundle)).toBe('4 × 3,000.00 = 12,000.00');
      const linked = ENGINE.periodLinkedReceipts(row, e.bundle);
      expect(linked.length).toBe(1);
      expect(linked[0].amountMinor).toBe(150000);
    } finally { closeEnv(e); }
  });

  /* ===================== محرك الفترات (المرحلة 2 — 4) ===================== */
  test('محرك الفترات — شرح مبسّط للقاعدة من الارتكاز الفعلي', () => {
    const anniversary = MP.periodRuleExplanation({anchorDate: '2026-10-05', periodBasis: 'ANNIVERSARY', periodicity: 'monthly', today: '2026-10-05'});
    expect(anniversary.includes('من 05/10/2026 إلى 04/11/2026')).toBe(true);
    const calendar = MP.periodRuleExplanation({anchorDate: '2026-10-05', periodBasis: 'CALENDAR_MONTH', periodicity: 'monthly', today: '2026-10-05'});
    expect(calendar.includes('01/10/2026 إلى 31/10/2026')).toBe(true);
  });

  test('محرك الفترات — فترة يدوية تُضاف للحساب ولا تعدّل الفترات الآلية', async () => {
    const e = await actualFile();
    try {
      const before = e.bundle.schedule.rows.length;
      const beforeDue = e.bundle.schedule.totals.dueMinor;
      const missingReason = await rejects(() => MP.createManualPeriod(e.office, {executionId: e.executionId, fromDate: '2026-06-05', toDate: '2026-07-04', amount: 1000, reason: ''}));
      expect(missingReason.code).toBe(ERR.VALIDATION);
      const out = await MP.createManualPeriod(e.office, {executionId: e.executionId, fromDate: '2026-06-05', toDate: '2026-07-04', amount: 1000, reason: 'فرق محضر تبديد 452 لسنة 2026'});
      expect(out.slice.valueType).toBe('fixed');
      expect(String(out.slice.itemId).includes('MANUAL_PERIOD')).toBe(true);
      expect(out.equation.includes('1,000.00')).toBe(true);
      const after = await SIMPLE.simpleCardBundle(e.office, e.executionId, {asOf: '2026-10-05', allowFuture: true});
      expect(after.schedule.rows.length).toBe(before + 1);
      expect(after.schedule.totals.dueMinor).toBe(beforeDue + 100000);
      // الفترات الآلية لم تتغير قيمًا ولا تواريخ
      const automatic = after.schedule.rows.filter(row => row.fromDate >= '2026-07-05');
      expect(automatic.length).toBe(before);
      expect(automatic.every(row => Number(row.dueMinor) === 300000)).toBe(true);
      const manual = (await MP.listManualPeriods(e.office, e.executionId));
      expect(manual.length).toBe(1);
      const badRange = await rejects(() => MP.createManualPeriod(e.office, {executionId: e.executionId, fromDate: '2026-06-05', toDate: '2026-01-01', amount: 100, reason: 'سبب'}));
      expect(badRange.code).toBe(ERR.VALIDATION);
    } finally { closeEnv(e); }
  });

  test('محرك الفترات — اقتراح الفترة التالية بنفس القاعدة (آخر نهاية + 1)', async () => {
    const e = await actualFile();
    try {
      const suggestion = await MP.suggestNextPeriod(e.office, e.executionId, {bundle: e.bundle});
      expect(suggestion.available).toBe(true);
      expect(suggestion.anchorDate).toBe('2026-07-05');
      expect(suggestion.fromDate).toBe('2026-11-05');
      expect(suggestion.toDate).toBe('2026-12-04');
      expect(suggestion.amountMinor).toBe(300000);
      expect(suggestion.equation.includes('05/11/2026 ← 04/12/2026')).toBe(true);
    } finally { closeEnv(e); }
  });

  /* ===================== شاشة الأفق (المرحلة 2 — 2) ===================== */
  test('الأفق — الاختصارات تُحسب من الارتكاز لا من اليوم', () => {
    const anchor = {anchorDate: '2026-10-05', periodicity: 'monthly', periodBasis: 'ANNIVERSARY'};
    const shortcuts = HORIZON.horizonShortcuts({anchor, today: '2026-10-05'});
    const byId = Object.fromEntries(shortcuts.map(row => [row.id, row.date]));
    expect(byId.today).toBe('2026-10-05');
    expect(byId.monthEnd).toBe('2026-10-31');
    expect(byId.plus1).toBe('2026-11-04');
    expect(byId.plus3).toBe('2027-01-04');
    expect(byId.plus12).toBe('2027-10-04');
    // CALENDAR_MONTH: «+شهر» = نهاية الشهر التقويمي، فيتطابق مع «نهاية الشهر»
    // وتُحذف التكرارات (تاريخ واحد = شريحة واحدة) بدل تكرار نفس الرقم مرتين.
    const calendar = HORIZON.horizonShortcuts({anchor: {...anchor, periodBasis: 'CALENDAR_MONTH'}, today: '2026-10-05'});
    const calendarById = Object.fromEntries(calendar.map(row => [row.id, row.date]));
    expect(calendarById.monthEnd).toBe('2026-10-31');
    expect(calendarById.plus1 === undefined).toBe(true);
    expect(calendarById.plus3).toBe('2026-12-31');
    expect(HORIZON.periodBasisExplanation({anchor, today: '2026-10-05'}).includes('من 05/10/2026 إلى 04/11/2026')).toBe(true);
  });

  test('الأفق — المعاينة تستخدم نفس المحرك وتعلن «تقديري» وعدد الفترات والمعادلة', async () => {
    const e = await actualFile();
    try {
      // الارتكاز 05/07/2026 ⇒ حتى 04/11/2026 أربع فترات (يوليو/أغسطس/سبتمبر/أكتوبر)
      const now = await HORIZON.horizonPreview(e.office, e.executionId, {asOf: '2026-11-04', allowFuture: true});
      expect(now.periodCount).toBe(4);
      expect(now.dueMinor).toBe(1200000);
      expect(now.equation).toBe('4 × 3,000.00 = 12,000.00');
      const future = await HORIZON.horizonPreview(e.office, e.executionId, {asOf: '2027-01-04', allowFuture: true});
      expect(future.periodCount).toBe(6);
      expect(future.dueMinor).toBe(1800000);
      expect(future.equation).toBe('6 × 3,000.00 = 18,000.00');
      expect(future.futureCount).toBe(3);
      expect(future.futureNote.includes('من 4 إلى 6')).toBe(true);
      // لا مسار حسابي موازٍ: نفس أرقام simpleSchedule
      const direct = await SIMPLE.simpleSchedule(e.office, e.executionId, {asOf: '2027-01-04', allowFuture: true});
      expect(direct.schedule.totals.dueMinor).toBe(future.dueMinor);
      const capped = await HORIZON.horizonPreview(e.office, e.executionId, {asOf: '2027-01-04', allowFuture: false});
      expect(capped.periodCount < future.periodCount).toBe(true);
    } finally { closeEnv(e); }
  });

  /* ===================== بطاقة الملخص السريع (المرحلة 2 — 1) ===================== */
  test('الملخص السريع — markup فيه الموكل ونوع النفقة وطريقة التنفيذ والأرقام والمعادلة والأزرار', async () => {
    const e = await actualFile();
    try {
      const html = CARD.executionSummaryCardMarkup(e.bundle, {uiMode: 'simple'});
      expect(html.includes('منى إبراهيم عبد الرحمن')).toBe(true);
      expect(html.includes('نفقة صغار')).toBe(true);
      expect(html.includes('تكليف بالوفاء ثم حجز')).toBe(true);
      expect(html.includes('المستحق حتى')).toBe(true);
      expect(html.includes('المحصّل')).toBe(true);
      expect(html.includes('الرصيد')).toBe(true);
      expect(html.includes('4 × 3,000.00 = 12,000.00')).toBe(true);
      expect(html.includes('آخر إجراء:')).toBe(true);
      for (const action of ['duration', 'poa', 'collection', 'action', 'print', 'horizon']) expect(html.includes(`data-qc="${action}"`)).toBe(true);
      // الوضع المبسّط يخفي المصروف من الشريط، والمتقدّم يظهره
      expect(CARD.executionSummaryCardMarkup(e.bundle, {uiMode: 'simple'}).includes('data-qc="expense"')).toBe(false);
      expect(CARD.executionSummaryCardMarkup(e.bundle, {uiMode: 'advanced'}).includes('data-qc="expense"')).toBe(true);
      expect(CARD.entitlementLabelOf(e.bundle).includes('3,000')).toBe(true);
    } finally { closeEnv(e); }
  });

  /* ===================== يحتاج انتباهي (المرحلة 2 — 6) ===================== */
  test('انتباهي — الفئات الخمس بعدّاداتها والتسمية الإلزامية والحدود القابلة للتعديل', async () => {
    const e = await actualFile();
    try {
      // رقم عرائض بلا رقم قضائي: نمسح الرقم القضائي ليظهر التنبيه
      await e.office.r.execution.put({...e.created.execution, petitionNumber: 'عرائض 77/2026', officialNumber: ''});
      const report = await ATT.scanAttention(e.office, {limit: 50});
      expect(report.categories.length).toBe(5);
      expect(ATT.ATTENTION_DISCLAIMER).toBe('تنبيه تنظيمي — ليس تقييمًا قانونيًا');
      const keys = report.categories.map(row => row.key);
      expect(keys.join(',')).toBe('unpaidNoAction,poaNoResult,periodNoPosition,petitionNoJudicial,judgmentNoEffective');
      const petition = report.categories.find(row => row.key === 'petitionNoJudicial');
      expect(petition.count).toBe(1);
      expect(petition.items[0].detail.includes('عرائض 77/2026')).toBe(true);
      // تسجيل الرقم القضائي يُسقط التنبيه
      const withJudicial = await e.office.r.execution.get(e.executionId);
      await e.office.r.execution.put({...withJudicial, officialNumber: '555/2026'});
      const after = await ATT.scanAttention(e.office, {limit: 50});
      expect(after.categories.find(row => row.key === 'petitionNoJudicial').count).toBe(0);
      // حدود قابلة للتعديل من lists.followUpThresholds
      const settings = executionSettings(e.office);
      await saveExecutionSettings(e.office, {lists: {...settings.lists, followUpThresholds: {...settings.lists.followUpThresholds, unpaidWithoutActionDays: 0}}});
      const strict = await ATT.scanAttention(e.office, {limit: 50});
      expect(strict.thresholds.unpaidWithoutActionDays).toBe(0);
      expect(strict.categories.find(row => row.key === 'unpaidNoAction').count >= 1).toBe(true);
      const disabled = await saveExecutionSettings(e.office, {lists: {...executionSettings(e.office).lists, followUpThresholds: {...executionSettings(e.office).lists.followUpThresholds, enabled: false}}});
      expect(disabled.lists.followUpThresholds.enabled).toBe(false);
      expect((await ATT.scanAttention(e.office, {limit: 50})).enabled).toBe(false);
    } finally { closeEnv(e); }
  });

  test('انتباهي — توكيل بلا نتيجة أكثر من 30 يومًا يُنبَّه، والإجراء بعده يُسقط التنبيه', async () => {
    // بلا إجراءات مسجلة حتى لا يُحتسب «نتيجة بعد التوكيل»
    const e = await actualFile({withDissipation: false});
    try {
      const today = localDate();
      const oldDate = new Date(`${today}T00:00:00`);
      oldDate.setMonth(oldDate.getMonth() - 3);
      const iso = oldDate.toISOString().slice(0, 10);
      const draft = await SIMPLE.simplePoaDraft(e.office, e.executionId, {fromDate: '2026-07-05', toDate: '2026-10-04'});
      const poa = await SIMPLE.saveSimplePoa(e.office, e.executionId, draft, {date: iso, printNow: false});
      const report = await ATT.scanAttention(e.office, {limit: 50});
      const poaCategory = report.categories.find(row => row.key === 'poaNoResult');
      expect(poaCategory.count).toBe(1);
      expect(poaCategory.items[0].poaId).toBe(poa.id);
      await SIMPLE.recordSimpleAction(e.office, {executionId: e.executionId, kind: 'seizure', date: localDate(), referenceNumber: 'حجز 1/2026'});
      const after = await ATT.scanAttention(e.office, {limit: 50});
      expect(after.categories.find(row => row.key === 'poaNoResult').count).toBe(0);
    } finally { closeEnv(e); }
  });

  /* ===================== Timeline أفقي (المرحلة 3 — 3) ===================== */
  test('Timeline — مراحل الدورة تُكتشف من السجلات الموجودة وتُعرض RTL', async () => {
    const e = await actualFile();
    try {
      const draft = await SIMPLE.simplePoaDraft(e.office, e.executionId, {fromDate: '2026-07-05', toDate: '2026-10-04'});
      await SIMPLE.saveSimplePoa(e.office, e.executionId, draft, {date: '2026-10-05', printNow: false});
      const bundle = await SIMPLE.simpleCardBundle(e.office, e.executionId, {asOf: '2026-10-05'});
      const items = [
        ...bundle.judgments.map(row => ({id: row.id, kind: 'judgment', date: row.judgmentDate, title: `حكم ${row.judgmentNumber}`, referenceNumber: row.judgmentNumber})),
        ...bundle.actions.map(row => ({id: row.id, kind: 'action', kindCode: row.kind, date: row.date, title: row.kindLabel || row.kind, referenceNumber: row.referenceNumber})),
        ...bundle.receipts.map(row => ({id: row.id, kind: 'receipt', date: row.date, title: 'تحصيل', referenceNumber: row.receiptNumber})),
        ...bundle.poas.map(row => ({id: row.id, kind: 'poa', date: row.date, title: 'توكيل', poaNumber: row.poaNumber}))
      ];
      const {nodes} = TIMELINE.buildStageNodes(items);
      const done = Object.fromEntries(nodes.map(node => [node.stage.key, node.status === 'done']));
      expect(done.judgment).toBe(true);
      expect(done.summons).toBe(true);
      expect(done.dissipation).toBe(true);
      expect(done.collection).toBe(true);
      expect(done.poa).toBe(true);
      expect(done.executive_formula).toBe(false);
      const html = TIMELINE.executionTimelineMarkup(items, {today: '2026-10-05'});
      expect(html.includes('dir="rtl"')).toBe(true);
      expect(html.includes('tl-track')).toBe(true);
      expect(html.includes('452 لسنة 2026')).toBe(true);
      // لا واقعة تضيع: ما لا يطابق مرحلة يدخل «إجراءات أخرى»
      const rest = nodes.find(node => node.stage.key === 'other');
      expect(Array.isArray(rest.items)).toBe(true);
      const details = TIMELINE.timelineNodeDetails(nodes, 'dissipation');
      expect(details.items.length).toBe(1);
      expect(details.items[0].title.includes('تبديد')).toBe(true);
    } finally { closeEnv(e); }
  });

  /* ===================== Carry-over ذكي (المرحلة 3 — 2) ===================== */
  test('Carry-over — يرشّح الرصيد السابق ويربطه بمحضر التبديد ولا يُدرج صامتًا', async () => {
    const e = await actualFile();
    try {
      // الفترات التي انتهت قبل 05/10/2026 ثلاث (يوليو/أغسطس/سبتمبر)، ويوليو مسدَّد جزئيًا
      const candidate = CARRY.carryOverCandidate(e.bundle, {fromDate: '2026-10-05'});
      expect(Boolean(candidate)).toBe(true);
      expect(candidate.remainingMinor).toBe(750000);
      expect(candidate.periodCount).toBe(3);
      expect(candidate.linkedAction.referenceNumber).toBe('452 لسنة 2026');
      expect(candidate.sourceNote.includes('محضر تبديد رقم 452 لسنة 2026')).toBe(true);
      expect(candidate.equation.includes('3 فترة')).toBe(true);
      // بلا مدة ⇒ لا فترات قبلها ⇒ لا مرشّح
      expect(CARRY.carryOverCandidate(e.bundle, {fromDate: '2026-07-05'}) === null).toBe(true);
      // بلا محضر تبديد يبقى الترشيح من الفترات غير المسددة مع إعلان المصدر
      const noDissipation = await actualFile({withDissipation: false});
      try {
        const bundle2 = await SIMPLE.simpleCardBundle(noDissipation.office, noDissipation.executionId, {asOf: '2026-10-05'});
        const candidate2 = CARRY.carryOverCandidate(bundle2, {fromDate: '2026-10-05'});
        expect(candidate2.linkedAction).toBe(null);
        expect(candidate2.sourceNote.includes('لا يوجد محضر تبديد')).toBe(true);
      } finally { closeEnv(noDissipation); }
    } finally { closeEnv(e); }
  });

  test('Carry-over — قرار الإدراج/التجاهل يُسجَّل في Activity Log', async () => {
    const e = await actualFile();
    try {
      await SIMPLE.logExecutionDecision(e.office, {executionId: e.executionId, action: 'carry-over-included',
        summary: 'إدراج رصيد سابق 7,500.00 ج.م في التوكيل', metadata: {amountMinor: 750000, reason: 'قرار المكتب'}});
      const log = await e.office.r.activityLog.byIndex('entityId', e.executionId, 100);
      const row = log.find(item => item.action === 'carry-over-included');
      expect(Boolean(row)).toBe(true);
      expect(row.metadata.decidedBy).toBe('tester');
      expect(row.metadata.amountMinor).toBe(750000);
      // لا بيانات شخصية خام في metadata
      expect(JSON.stringify(row.metadata).includes('منى إبراهيم')).toBe(false);
    } finally { closeEnv(e); }
  });

  test('توكيل — تجاوز مبلغ الرصيد السابق صراحةً يُذكر في الملاحظة ولا يُحسب صامتًا', async () => {
    const e = await actualFile();
    try {
      const draft = await SIMPLE.simplePoaDraft(e.office, e.executionId, {fromDate: '2026-10-05', toDate: '2026-11-04', previousBalanceOverride: 5000});
      expect(draft.previousOverridden).toBe(true);
      expect(Number(draft.previousAppliedMinor)).toBe(500000);
      expect(draft.previousNote.includes('عُدِّل صراحةً')).toBe(true);
      expect(Number(draft.totalMinor)).toBe(500000);
    } finally { closeEnv(e); }
  });

  /* ===================== متعدد المستحقين (المرحلة 3 — 4) ===================== */
  test('المستحقون — شرط المجموع: 100% نسبيًا ومبلغ المحضر بالضبط', () => {
    const split = BEN.buildBeneficiarySplit({totalMinor: 100000, entries: [
      {beneficiaryName: 'الأول', beneficiaryShare: 33.33}, {beneficiaryName: 'الثاني', beneficiaryShare: 33.33}, {beneficiaryName: 'الثالث', beneficiaryShare: 33.34}
    ]});
    expect(split.length).toBe(3);
    expect(split.reduce((sum, row) => sum + row.amountMinor, 0)).toBe(100000);
    const badShare = (() => { try { BEN.buildBeneficiarySplit({totalMinor: 100000, entries: [{beneficiaryName: 'أ', beneficiaryShare: 50}, {beneficiaryName: 'ب', beneficiaryShare: 40}]}); return null; } catch (error) { return error; } })();
    expect(badShare.code).toBe(ERR.VALIDATION);
    expect(String(badShare.message).includes('100%')).toBe(true);
    const noEntry = (() => { try { BEN.buildBeneficiarySplit({totalMinor: 100000, entries: []}); return null; } catch (error) { return error; } })();
    expect(noEntry.code).toBe(ERR.VALIDATION);
  });

  test('المستحقون — الحقول إضافية على الصف (لا سكيما جديدة) والسجل القديم = مستحق واحد 100%', async () => {
    const e = await actualFile();
    try {
      expect(BEN.BENEFICIARY_SCHEMA_NOTE.schemaVersionUnchanged).toBe(18);
      expect(BEN.BENEFICIARY_SCHEMA_NOTE.newStores.length).toBe(0);
      expect(BEN.BENEFICIARY_SCHEMA_NOTE.newIndexes.length).toBe(0);
      const receipts = await e.office.r.executionReceipts.byIndex('executionId', e.executionId, 20);
      const legacy = BEN.receiptBeneficiaries({...receipts[0], beneficiaries: undefined}, {fallbackName: 'منى إبراهيم'});
      expect(legacy.length).toBe(1);
      expect(legacy[0].beneficiaryShare).toBe(100);
      expect(legacy[0].amountMinor).toBe(150000);
      const reasonRequired = await rejects(() => BEN.saveReceiptBeneficiaries(e.office, {receiptId: receipts[0].id, entries: [{beneficiaryName: 'أ', beneficiaryShare: 100}], reason: ''}));
      expect(reasonRequired.code).toBe(ERR.VALIDATION);
      const updated = await BEN.saveReceiptBeneficiaries(e.office, {
        receiptId: receipts[0].id, reason: 'توزيع على مستحقين اثنين بحسب الحكم',
        entries: [{beneficiaryName: 'منى إبراهيم', beneficiaryShare: 60}, {beneficiaryName: 'الأبناء', beneficiaryShare: 40}]
      });
      expect(updated.beneficiaries.length).toBe(2);
      expect(updated.beneficiaries.reduce((sum, row) => sum + row.amountMinor, 0)).toBe(150000);
      expect((updated.revisions || []).length).toBe(1);
      // المبلغ والتخصيص الأصليان لم يتغيرا
      expect(Number(updated.amount)).toBe(1500);
      const log = await e.office.r.activityLog.byIndex('entityId', receipts[0].id, 50);
      expect(log.some(row => row.action === 'beneficiary-split')).toBe(true);
      // الترحيل الاختياري: فحص بلا كتابة ثم تطبيق
      const dry = await BEN.backfillReceiptBeneficiaries(e.office, {dryRun: true});
      expect(dry.dryRun).toBe(true);
      expect(dry.updated).toBe(0);
    } finally { closeEnv(e); }
  });

  /* ===================== التصدير (المرحلة 3 — 5) ===================== */
  test('التصدير — CSV بـUTF-8 مع BOM وأعمدة محددة وسطر لكل فترة + إجمالي', async () => {
    const e = await actualFile();
    try {
      const out = await EXPORT.buildStatementCsv(e.office, e.executionId, {mode: 'monthly', asOf: '2026-10-05'});
      expect(out.csv.charCodeAt(0)).toBe(0xFEFF);
      expect(out.count).toBe(4);
      const lines = out.csv.replace(/^\uFEFF/, '').split('\r\n');
      expect(lines[0]).toBe(EXPORT.STATEMENT_CSV_COLUMNS.join(','));
      expect(lines.length).toBe(out.count + 2);
      expect(lines[1].includes('منى إبراهيم عبد الرحمن')).toBe(true);
      expect(lines[1].includes('05/07/2026')).toBe(true);
      expect(lines[1].includes('فترة كاملة')).toBe(true);
      expect(lines.at(-1).startsWith('الإجمالي')).toBe(true);
      // حقول تحتوي فاصلة تُحاط بأقواس
      expect(EXPORT.csvCell('أ,ب')).toBe('"أ,ب"');
      expect(EXPORT.csvCell('عادى')).toBe('عادى');
      expect(EXPORT.statementFileName('EX 2026/0004', 'csv').includes('EX-2026-0004')).toBe(true);
    } finally { closeEnv(e); }
  });

  /* ===================== وضع مبسّط/متقدّم + اختصارات (المرحلة 3 — 6/8) ===================== */
  test('وضع العرض — الافتراضي simple ويُطبَّع ويُحفظ في الإعدادات', async () => {
    const e = await env();
    try {
      expect(normalizeUiMode(undefined)).toBe('simple');
      expect(normalizeUiMode('advanced')).toBe('advanced');
      expect(normalizeUiMode('خاطئ')).toBe('simple');
      const settings = executionSettings(e.office);
      expect(settings.uiMode).toBe('simple');
      const saved = await saveExecutionSettings(e.office, {uiMode: 'advanced'});
      expect(saved.uiMode).toBe('advanced');
      expect(EXTRAS.SIMPLE_MODE_HIDDEN.includes('simulate')).toBe(true);
      expect(EXTRAS.SIMPLE_MODE_HIDDEN.includes('feas-recognize')).toBe(true);
      const keys = EXTRAS.EXECUTION_SHORTCUTS.map(row => row.keys);
      expect(keys.join('|')).toBe('Alt + 1|Alt + 2|Alt + 3|Alt + 4|Alt + 5|Alt + 6|Alt + H|؟');
      expect(EXTRAS.EXECUTION_SHORTCUTS.every(row => !row.keys.toLowerCase().includes('ctrl'))).toBe(true);
    } finally { closeEnv(e); }
  });

  /* ===================== الأداء (المرحلة 3 — 10) ===================== */
  test('الأداء — cache الجدول والبطاقة يعمل ويُبطَل عند الكتابة', async () => {
    const e = await actualFile();
    try {
      const first = await SIMPLE.simpleSchedule(e.office, e.executionId, {asOf: '2026-10-05'});
      const second = await SIMPLE.simpleSchedule(e.office, e.executionId, {asOf: '2026-10-05'});
      expect(second === first).toBe(true);
      await SIMPLE.recordSimpleCollection(e.office, {executionId: e.executionId, amount: 500, date: '2026-10-02'});
      const third = await SIMPLE.simpleSchedule(e.office, e.executionId, {asOf: '2026-10-05'});
      expect(third === first).toBe(false);
      expect(third.schedule.totals.paidMinor).toBe(first.schedule.totals.paidMinor + 50000);
    } finally { closeEnv(e); }
  });

  test('الأداء — عدّادات «يحتاج انتباهي» بمسح محدود تُعلن إن كان جزئيًا', async () => {
    const e = await actualFile();
    try {
      const report = await ATT.scanAttention(e.office, {limit: 5, batchSize: 2});
      expect(report.scanned <= 5).toBe(true);
      expect(typeof report.scannedAll).toBe('boolean');
      expect(report.categories.every(row => Array.isArray(row.items))).toBe(true);
    } finally { closeEnv(e); }
  });
}
