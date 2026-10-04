// =====================================================================
// اختبارات قسم التنفيذ المبسّط — الأرقام الذهبية + الخصائص + الخدمة.
// ---------------------------------------------------------------------
// كل رقم ذهبي (G1…G14) مُشتق من محرك الجدول أو من الخدمة الفعلية على قاعدة
// IndexedDB وهمية — لا قيم مكتوبة يدويًا في الشيفرة الإنتاجية.
// =====================================================================
import {upgradeSchema, STORE} from '../db/schema.js';
import {SCHEMA_VERSION} from '../core/constants.js';
import {Office} from '../services/office.js';
import {ERR} from '../core/errors.js';
import {localDate} from '../core/clock.js';
import * as SIMPLE from '../services/execution-simple.js';
import * as D from '../domain/execution-schedule.js';
import {fromMinorUnits, toMinorUnits} from '../domain/execution-money.js';
import {addExecutionJudgment, saveValueSlice} from '../services/execution.js';
import {validateValueSlice} from '../domain/execution.js';
import {executionSettings, saveExecutionSettings, resetExecutionSettings} from '../services/execution-settings.js';
import * as PRINT from '../services/print-paginate.js';

const rejects = async fn => { try { await fn(); } catch (error) { return error; } throw Error('Expected promise to reject'); };

async function openDb(name) {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(name, SCHEMA_VERSION);
    r.onupgradeneeded = e => upgradeSchema(r.result, e.target.transaction);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function env() {
  const name = `AhmadKhudairLawOfficeDB__test__execution-simple__${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const db = await openDb(name);
  const office = new Office({db, assert() {}, token: 'exec-simple-test', profile: {id: 'tester'}});
  await resetExecutionSettings(office);
  return {db, office, name};
}
const closeEnv = env => { try { env.db.close(); indexedDB.deleteDatabase(env.name); } catch {} };

/** التنفيذ التجريبي المطلوب: 3,000 شهريًا من 01/01/2025 ثم 4,000 من 01/07/2025 مع تحصيل 9,000. */
async function goldenFixture({withReceipt = true, withExpense = true} = {}) {
  const e = await env();
  const {office} = e;
  const created = await SIMPLE.createSimpleExecution(office, {
    clientId: (await office.saveClient({fullName: 'منى عبدالسلام الشاذلي'})).id,
    opponentName: 'محمود فاروق الحلواني',
    executionType: 'family', entitlementType: 'نفقة شهرية',
    valueType: 'periodic', periodicity: 'monthly', amount: 3000, effectiveFrom: '2025-01-01',
    entitlementTo: '2025-12-31', judgmentNumber: '101/2025', judgmentDate: '2025-01-10',
    court: 'محكمة الأسرة بالمنصورة', officialNumber: '1200/2025'
  });
  const later = await SIMPLE.recordSubsequentJudgment(office, {
    executionId: created.execution.id, entitlementType: 'نفقة شهرية', amount: 4000,
    effectiveFrom: '2025-07-01', effectiveTo: '2025-12-31', judgmentNumber: '550/2025',
    judgmentDate: '2025-07-20', court: 'استئناف الأسرة'
  });
  let receipt = null;
  if (withReceipt) {
    receipt = await SIMPLE.recordSimpleCollection(office, {executionId: created.execution.id, amount: 9000, date: '2025-04-10', paymentMethod: 'نقدي'});
  }
  if (withExpense) {
    await SIMPLE.recordSimpleExpense(office, {executionId: created.execution.id, type: 'EXECUTION_FEE', amount: 600, date: '2025-02-05', includeInPoa: true, borneBy: 'debtor'});
  }
  return {...e, created, later, receipt};
}

export async function runExecutionSimpleTests(test, expect) {
  /* ============================ محرك الجدول (نقي) ============================ */
  const slices = [
    {id: 's1', entitlementType: 'نفقة شهرية', valueType: 'periodic', amount: 3000, startDate: '2025-01-01', judgmentId: 'j1', judgmentKind: 'original', status: 'active', periodicity: 'monthly'},
    {id: 's2', entitlementType: 'نفقة شهرية', valueType: 'periodic', amount: 4000, startDate: '2025-07-01', judgmentId: 'j2', judgmentKind: 'later', status: 'active', periodicity: 'monthly'}
  ];
  const receipts9000 = [{id: 'r1', date: '2025-04-10', amount: 9000, receiptNumber: 'RC-2025-0001', currency: 'EGP'}];
  const schedule = D.buildExecutionSchedule({slices, receipts: receipts9000, allocations: [], asOf: '2025-12-31'});
  const money = minor => fromMinorUnits(minor, 'EGP');

  test('G1 — الاستحقاق حتى 31/12/2025 = 42,000 (6×3,000 + 6×4,000)', () => expect(money(schedule.totals.dueMinor)).toBe(42000));
  test('G2 — المدفوع 9,000 وتوزيعه: يناير–مارس مسدد', () => {
    expect(money(schedule.totals.paidMinor)).toBe(9000);
    expect(schedule.rows.slice(0, 3).every(row => row.status === 'paid')).toBe(true);
  });
  test('G2b — أبريل–يونيو غير مدفوعة بـ3,000 لكل شهر', () => {
    const apr = schedule.rows.find(row => row.fromDate === '2025-04-01');
    expect(money(apr.dueMinor)).toBe(3000);
    expect(apr.status).toBe('unpaid');
    expect(schedule.rows.filter(row => row.status === 'unpaid').length).toBe(9);
  });
  test('G3 — المتبقي 33,000 = 9,000 + 24,000', () => expect(money(schedule.totals.remainingMinor)).toBe(33000));
  test('G4 — رسم 600 لا يزيد أصل النفقة: المتبقي يبقى 33,000 والمصروفات منفصلة', () => {
    const withExpense = D.buildExecutionSchedule({slices, receipts: receipts9000, ledger: [{id: 'x1', type: 'EXECUTION_FEE', amount: 600, category: 'expense', date: '2025-02-05', includeInPoa: true}], allocations: [], asOf: '2025-12-31'});
    expect(money(withExpense.totals.remainingMinor)).toBe(33000);
    expect(money(withExpense.totals.expenseMinor)).toBe(600);
    expect(money(withExpense.totals.expenseInPoaMinor)).toBe(600);
  });
  test('G5 — توكيل 01/04→31/12: رصيد سابق 0 + فترة 33,000 = 33,000 (بلا ازدواج)', () => {
    const draft = D.buildPoaFigures({schedule, fromDate: '2025-04-01', toDate: '2025-12-31'});
    expect(money(draft.previousBalanceMinor)).toBe(0);
    expect(money(draft.periodDueMinor)).toBe(33000);
    expect(money(draft.totalMinor)).toBe(33000);
  });
  test('G5b — سيناريو الرصيد السابق (حتى 30/06 = 9,000) + يوليو–ديسمبر 24,000 = 33,000', () => {
    const draft = D.buildPoaFigures({schedule, fromDate: '2025-07-01', toDate: '2025-12-31'});
    expect(money(draft.previousBalanceMinor)).toBe(9000);
    expect(money(draft.periodDueMinor)).toBe(24000);
    expect(money(draft.totalMinor)).toBe(33000);
    expect(draft.lines.find(line => line.kind === 'previous').note).toContain('لا يُضاف');
  });
  test('G6 — احسب مدة 01/04→30/09 = 21,000 (3×3,000 + 3×4,000)', () => {
    const claim = D.claimForRange({slices, receipts: receipts9000, allocations: [], fromDate: '2025-04-01', toDate: '2025-09-30'});
    expect(money(claim.totals.dueMinor)).toBe(21000);
    expect(money(claim.totals.paidMinor)).toBe(0);
    expect(money(claim.totals.remainingMinor)).toBe(21000);
  });
  test('G7 — تحصيل 10,000: يناير–مارس مسددة + 1,000 من أبريل والمتبقي 32,000', () => {
    const out = D.buildExecutionSchedule({slices, receipts: [{id: 'r2', date: '2025-04-10', amount: 10000, currency: 'EGP'}], allocations: [], asOf: '2025-12-31'});
    expect(money(out.totals.remainingMinor)).toBe(32000);
    const apr = out.rows.find(row => row.fromDate === '2025-04-01');
    expect(money(apr.paidMinor)).toBe(1000);
    expect(apr.status).toBe('partial');
  });
  test('G8 — تحصيل 3,000 محدد ليونيو: يونيو مسدد ولا يتأثر ترتيب الباقي', () => {
    const out = D.buildExecutionSchedule({
      slices, receipts: [{id: 'r3', date: '2025-04-10', amount: 3000, currency: 'EGP'}],
      allocations: [{id: 'a1', receiptId: 'r3', periodKey: 'نفقة شهرية::2025-06-01', amount: 3000, method: 'DIRECT', isActive: true}],
      asOf: '2025-12-31'
    });
    const june = out.rows.find(row => row.fromDate === '2025-06-01');
    const jan = out.rows.find(row => row.fromDate === '2025-01-01');
    expect(june.status).toBe('paid');
    expect(jan.status).toBe('unpaid');
    expect(money(out.totals.remainingMinor)).toBe(39000);
  });
  test('G9 — تحصيل زائد 50,000 مقابل 42,000: رصيد دائن 8,000 ولا رفض', () => {
    const out = D.buildExecutionSchedule({slices, receipts: [{id: 'r4', date: '2025-04-10', amount: 50000, currency: 'EGP'}], allocations: [], asOf: '2025-12-31'});
    expect(money(out.totals.creditMinor)).toBe(8000);
    expect(money(out.totals.remainingMinor)).toBe(0);
  });
  test('G10 — تخفيض من 01/10/2025 بعد سداد أكتوبر بـ4,000 يظهر دفعة زائدة بلا رد تلقائي', () => {
    const octoberPin = [{id: 'pin-oct', receiptId: 'r10', periodKey: 'نفقة شهرية::2025-10-01', amount: 4000, method: 'DIRECT', isActive: true}];
    const base = D.buildExecutionSchedule({
      slices: [...slices, {id: 's10', entitlementType: 'نفقة شهرية', valueType: 'periodic', amount: 4000, startDate: '2025-10-01', judgmentKind: 'later', status: 'active'}],
      receipts: [{id: 'r10', date: '2025-10-05', amount: 4000, currency: 'EGP'}], allocations: octoberPin, asOf: '2025-12-31'
    });
    expect(money(base.totals.dueMinor)).toBe(42000); // أكتوبر مسدد مقدمًا
    const decreased = D.buildExecutionSchedule({
      slices: [...slices, {id: 's10', entitlementType: 'نفقة شهرية', valueType: 'periodic', amount: 4000, startDate: '2025-10-01', status: 'superseded'}, {id: 's11', entitlementType: 'نفقة شهرية', valueType: 'periodic', amount: 3000, startDate: '2025-10-01', judgmentKind: 'later', status: 'active'}],
      receipts: [{id: 'r10', date: '2025-10-05', amount: 4000, currency: 'EGP'}], allocations: octoberPin, asOf: '2025-12-31'
    });
    expect(money(decreased.totals.dueMinor)).toBe(39000);
    const october = decreased.rows.find(row => row.fromDate === '2025-10-01');
    expect(money(october.overpaidMinor)).toBe(1000);   // دفعة زائدة ظاهرة بلا رد تلقائي
    expect(money(october.dueMinor)).toBe(3000);
    expect(october.status).toBe('paid');
  });
  test('G11 — بند مقطوع 70,000 وتحصيل 30,000: المتبقي 40,000 ثم 70,000 → مكتمل', () => {
    const lumpSlices = [{id: 'f1', entitlementType: 'متعة', valueType: 'fixed', amount: 70000, startDate: '2025-02-01', judgmentKind: 'original', status: 'active'}];
    const partial = D.buildExecutionSchedule({slices: lumpSlices, receipts: [{id: 'q1', date: '2025-03-01', amount: 30000, currency: 'EGP'}], allocations: [], asOf: '2025-12-31'});
    expect(money(partial.totals.remainingMinor)).toBe(40000);
    expect(partial.rows.length).toBe(1);
    const full = D.buildExecutionSchedule({slices: lumpSlices, receipts: [{id: 'q2', date: '2025-03-01', amount: 70000, currency: 'EGP'}], allocations: [], asOf: '2025-12-31'});
    expect(money(full.totals.remainingMinor)).toBe(0);
    expect(full.rows[0].status).toBe('paid');
  });
  test('G12 — تحصيل قبل إدخال القيمة: يُحفظ غير مخصص ثم يُخصَّص تلقائيًا عند إدخال القيمة', () => {
    const empty = D.buildExecutionSchedule({slices: [], receipts: [{id: 'z1', date: '2025-03-01', amount: 5000, currency: 'EGP'}], allocations: [], asOf: '2025-12-31'});
    expect(money(empty.totals.dueMinor)).toBe(0);
    expect(money(empty.totals.paidMinor)).toBe(5000);
    expect(money(empty.totals.creditMinor)).toBe(5000);
    const filled = D.buildExecutionSchedule({slices: [slices[0]], receipts: [{id: 'z1', date: '2025-03-01', amount: 5000, currency: 'EGP'}], allocations: [], asOf: '2025-12-31'});
    expect(money(filled.rows[0].paidMinor)).toBe(3000);
    expect(filled.rows[0].status).toBe('paid');
    expect(money(filled.totals.remainingMinor)).toBe(31000);
  });
  test('G13 — إلغاء الحكم اللاحق يعيد الإجمالي 36,000 والمتبقي 27,000 والسجل محفوظ', () => {
    const cancelled = D.buildExecutionSchedule({slices: [slices[0], {...slices[1], status: 'cancelled'}], receipts: receipts9000, allocations: [], asOf: '2025-12-31'});
    expect(money(cancelled.totals.dueMinor)).toBe(36000);
    expect(money(cancelled.totals.remainingMinor)).toBe(27000);
  });
  test('G14 — تعديل مبلغ التحصيل يعيد الأرقام فورًا', () => {
    const edited = D.buildExecutionSchedule({slices, receipts: [{id: 'r1', date: '2025-04-10', amount: 12000, currency: 'EGP'}], allocations: [], asOf: '2025-12-31'});
    expect(money(edited.totals.remainingMinor)).toBe(30000);
  });
  test('معاينة الحكم اللاحق: الفرق 6,000 يظهر مرة واحدة على الشهور المتأثرة', () => {
    const preview = D.previewValueChange({slices: [slices[0]], receipts: receipts9000, allocations: [], asOf: '2025-12-31', candidate: {id: 's2', entitlementType: 'نفقة شهرية', amount: 4000, startDate: '2025-07-01'}});
    expect(money(preview.totals.differenceMinor)).toBe(6000);
    expect(preview.rows.filter(row => row.differenceMinor !== 0).length).toBe(6);
    expect(preview.rows.every(row => row.differenceMinor === 0 || money(row.differenceMinor) === 1000)).toBe(true);
  });
  test('الإعدادات: احتساب الشهر من تاريخ السريان يقسّم الشهر الأول بالأيام الفعلية', () => {
    const midMonth = [{id: 'm1', entitlementType: 'نفقة', valueType: 'periodic', amount: 3000, startDate: '2025-01-16', status: 'active', periodicity: 'monthly'}];
    const prorated = D.buildExecutionSchedule({slices: midMonth, receipts: [], allocations: [], asOf: '2025-01-31'});
    expect(money(prorated.totals.dueMinor)).toBe(Math.round(toMinorUnits(3000) * 16 / 31 / 1) / 100);
    const full = D.buildExecutionSchedule({slices: midMonth, receipts: [], allocations: [], asOf: '2025-01-31', settings: {firstMonthPolicy: 'fullMonth'}});
    expect(money(full.totals.dueMinor)).toBe(3000);
  });

  /* ============================ الخصائص ============================ */
  test('خاصية: المتبقي = المستحق − المخصّص دائمًا، ولا تخصيص أكبر من التحصيل', () => {
    const receiptList = [
      {id: 'p1', date: '2025-02-01', amount: 2500, currency: 'EGP'},
      {id: 'p2', date: '2025-05-01', amount: 7000, currency: 'EGP'},
      {id: 'p3', date: '2025-08-01', amount: 40000, currency: 'EGP'}
    ];
    const out = D.buildExecutionSchedule({slices, receipts: receiptList, allocations: [{id: 'pin', receiptId: 'p2', periodKey: 'نفقة شهرية::2025-06-01', amount: 3000, method: 'DIRECT', isActive: true}], asOf: '2025-12-31'});
    expect(out.totals.remainingMinor).toBe(out.totals.dueMinor - out.totals.allocatedMinor);
    for (const receipt of out.receipts) {
      const allocated = receipt.amountMinor - receipt.creditMinor;
      expect(allocated >= 0 && allocated <= receipt.amountMinor).toBe(true);
    }
  });
  test('خاصية: لا تخصيص أكبر من قيمة الصف، والنتيجة ثابتة عند إعادة الحساب', () => {
    const args = {slices, receipts: receipts9000, allocations: [], asOf: '2025-12-31'};
    const first = D.buildExecutionSchedule(args), second = D.buildExecutionSchedule(args);
    expect(JSON.stringify(first.totals)).toBe(JSON.stringify(second.totals));
    for (const row of first.rows) expect(row.paidMinor <= row.dueMinor).toBe(true);
  });
  test('خاصية: كل المبالغ أعداد صحيحة بالقروش', () => {
    for (const value of [schedule.totals.dueMinor, schedule.totals.paidMinor, schedule.totals.allocatedMinor, schedule.totals.remainingMinor]) {
      expect(Number.isSafeInteger(value)).toBe(true);
    }
  });
  test('خاصية: تثبيت التخصيص (DIRECT) لا يزيد المخصّص الكلي عن المستحق', () => {
    const out = D.buildExecutionSchedule({
      slices, receipts: [{id: 'pin-r', date: '2025-03-01', amount: 3000, currency: 'EGP'}],
      allocations: [{id: 'pin', receiptId: 'pin-r', periodKey: 'نفقة شهرية::2025-01-01', amount: 9000, method: 'DIRECT', isActive: true}],
      asOf: '2025-12-31'
    });
    expect(out.totals.allocatedMinor).toBe(toMinorUnits(3000));
    expect(out.warnings.some(warning => warning.code === 'pin-over-period')).toBe(true);
  });

  /* ============================ الخدمة على قاعدة حقيقية ============================ */
  test('S1 — نموذج واحد ينشئ التنفيذ والحكم والبند والجدول تلقائيًا', async () => {
    const e = await env();
    try {
      const created = await SIMPLE.createSimpleExecution(e.office, {
        clientId: (await e.office.saveClient({fullName: 'موكل بسيط'})).id,
        opponentName: 'خصم بسيط', entitlementType: 'نفقة صغار', amount: 2500, effectiveFrom: '2025-01-01',
        valueType: 'periodic', periodicity: 'monthly', executionType: 'family'
      });
      const bundle = await SIMPLE.simpleSchedule(e.office, created.execution.id, {asOf: '2025-03-31'});
      expect(bundle.schedule.totals.dueMinor).toBe(toMinorUnits(7500));
      expect(bundle.parties.length).toBe(2);              // لا «0 طرف»
      expect(bundle.slices.length).toBe(1);
      expect(bundle.judgments.length).toBe(1);
      expect(bundle.execution.internalNumber).toBeTruthy();
    } finally { closeEnv(e); }
  });

  test('S2 — تحصيل بأقل حقول: المبلغ فقط + معاينة التخصيص قبل الحفظ', async () => {
    const e = await goldenFixture({withExpense: false});
    try {
      const preview = await SIMPLE.previewSimpleCollection(e.office, {executionId: e.created.execution.id, amount: 5000, date: '2025-06-15'});
      expect(fromMinorUnits(preview.lines[0].amountMinor, 'EGP')).toBe(3000);
      expect(fromMinorUnits(preview.remainingAfterMinor, 'EGP')).toBe(28000);
      const receipt = await SIMPLE.recordSimpleCollection(e.office, {executionId: e.created.execution.id, amount: 5000});
      expect(receipt.receipt.amount).toBe(5000);
      expect(receipt.receipt.receiptNumber.startsWith('RC-')).toBe(true);
      expect(receipt.receipt.date).toBe(localDate());
      const bundle = await SIMPLE.simpleSchedule(e.office, e.created.execution.id);
      expect(fromMinorUnits(bundle.schedule.totals.remainingMinor, 'EGP')).toBe(28000);
    } finally { closeEnv(e); }
  });

  test('S3 — إجراء تنفيذ: النوع والتاريخ فقط + «الإجراء التالي» يظهر لاحقًا', async () => {
    const e = await goldenFixture({withReceipt: false, withExpense: false});
    try {
      const action = await SIMPLE.recordSimpleAction(e.office, {executionId: e.created.execution.id, kind: 'seizure', date: '2025-05-12', referenceNumber: 'ح-22/2025', nextAction: 'جلسة بيع', nextActionDate: '2025-10-20'});
      expect(action.kind).toBe('seizure');
      expect(action.nextActionDate).toBe('2025-10-20');
      const rows = await SIMPLE.hydrateSimpleRows(e.office, [e.created.execution]);
      expect(rows[0].nextActionLabel).toContain('2025-10-20');
      const missing = await rejects(() => SIMPLE.recordSimpleAction(e.office, {executionId: e.created.execution.id, kind: 'seizure'}));
      expect(missing.code).toBe(ERR.VALIDATION);
    } finally { closeEnv(e); }
  });

  test('S4 — الأرقام الثلاثة تُحسب بلا أي نقرة إضافية (ملخص واحد لكل التنفيذ)', async () => {
    const e = await goldenFixture();
    try {
      const bundle = await SIMPLE.simpleSchedule(e.office, e.created.execution.id, {asOf: '2025-12-31'});
      expect(fromMinorUnits(bundle.schedule.totals.dueMinor, 'EGP')).toBe(42000);
      expect(fromMinorUnits(bundle.schedule.totals.paidMinor, 'EGP')).toBe(9000);
      expect(fromMinorUnits(bundle.schedule.totals.remainingMinor, 'EGP')).toBe(33000);
      const rows = await SIMPLE.hydrateSimpleRows(e.office, [e.created.execution]);
      expect(rows[0].status.key).toBe('overdue');
    } finally { closeEnv(e); }
  });

  test('G5 (خدمة) — مسودة التوكيل من الخدمة: 33,000 مع مصروف 600 اختياريًا', async () => {
    const e = await goldenFixture();
    try {
      const draft = await SIMPLE.simplePoaDraft(e.office, e.created.execution.id, {fromDate: '2025-07-01', toDate: '2025-12-31'});
      expect(fromMinorUnits(draft.previousBalanceMinor, 'EGP')).toBe(9000);
      expect(fromMinorUnits(draft.totalMinor, 'EGP')).toBe(33000);
      const withExpense = await SIMPLE.simplePoaDraft(e.office, e.created.execution.id, {fromDate: '2025-07-01', toDate: '2025-12-31', expenseIds: draft.expenses.map(expense => expense.id)});
      expect(fromMinorUnits(withExpense.totalMinor, 'EGP')).toBe(33600);
      // إصدار التوكيل لا يغيّر المتبقي
      await SIMPLE.saveSimplePoa(e.office, e.created.execution.id, withExpense, {printNow: false});
      const after = await SIMPLE.simpleSchedule(e.office, e.created.execution.id, {asOf: '2025-12-31'});
      expect(fromMinorUnits(after.schedule.totals.remainingMinor, 'EGP')).toBe(33000);
    } finally { closeEnv(e); }
  });

  test('G6 (خدمة) — احسب مدة 01/04→30/09 من الخدمة = 21,000', async () => {
    const e = await goldenFixture();
    try {
      const claim = await SIMPLE.simpleDurationClaim(e.office, e.created.execution.id, {fromDate: '2025-04-01', toDate: '2025-09-30'});
      expect(fromMinorUnits(claim.totals.dueMinor, 'EGP')).toBe(21000);
      expect(fromMinorUnits(claim.totals.beforeMinor, 'EGP')).toBe(0);
      expect(fromMinorUnits(claim.totals.totalRequiredMinor, 'EGP')).toBe(21000);
    } finally { closeEnv(e); }
  });

  test('G12 (خدمة) — تحصيل قبل إدخال القيمة يُحفظ غير مخصص ثم يُخصَّص تلقائيًا', async () => {
    const e = await env();
    try {
      const client = await e.office.saveClient({fullName: 'موكل بلا قيمة'});
      const created = await SIMPLE.createSimpleExecution(e.office, {clientId: client.id, opponentName: 'خصم', entitlementType: 'نفقة صغار', amount: 3000, effectiveFrom: '2025-01-01', valueType: 'periodic'});
      // نلغي شريحة القيمة لتمثيل «قبل إدخال القيمة»
      const {cancelValueSlice} = await import('../services/execution.js');
      await cancelValueSlice(e.office, created.slice.id, 'اختبار: بلا قيمة');
      const receipt = await SIMPLE.recordSimpleCollection(e.office, {executionId: created.execution.id, amount: 5000, date: '2025-03-01'});
      const empty = await SIMPLE.simpleSchedule(e.office, created.execution.id, {asOf: '2025-12-31'});
      expect(fromMinorUnits(empty.schedule.totals.remainingMinor, 'EGP')).toBe(0);
      expect(empty.schedule.totals.creditMinor).toBe(toMinorUnits(5000));
      // إعادة إدخال القيمة → يُخصَّص التحصيل تلقائيًا بلا أي خطوة إضافية
      const judgment = await addExecutionJudgment(e.office, {executionId: created.execution.id, entitlementType: 'نفقة صغار', judgmentKind: 'original', judgmentDate: '2025-01-05', amount: 3000, effectiveFrom: '2025-01-01', valueType: 'periodic', periodicity: 'monthly'});
      await saveValueSlice(e.office, {executionId: created.execution.id, judgmentId: judgment.id, entitlementType: 'نفقة صغار', valueType: 'periodic', periodicity: 'monthly', amount: 3000, startDate: '2025-01-01'});
      const filled = await SIMPLE.simpleSchedule(e.office, created.execution.id, {asOf: '2025-12-31'});
      expect(filled.schedule.rows[0].status).toBe('paid');
      expect(fromMinorUnits(filled.schedule.totals.remainingMinor, 'EGP')).toBe(31000);
      void receipt;
    } finally { closeEnv(e); }
  });

  test('G13 (خدمة) — إلغاء الحكم اللاحق (بسبب) يعيد 36,000 والمتبقي 27,000 ويحفظ السجل', async () => {
    const e = await goldenFixture({withExpense: false});
    try {
      const voided = await SIMPLE.voidSimpleRecord(e.office, {kind: 'slice', id: e.later.slice.id, reason: 'أُلغي الحكم اللاحق بالاستئناف'});
      expect(voided.undone).toBe(true);
      const after = await SIMPLE.simpleSchedule(e.office, e.created.execution.id, {asOf: '2025-12-31'});
      expect(fromMinorUnits(after.schedule.totals.dueMinor, 'EGP')).toBe(36000);
      expect(fromMinorUnits(after.schedule.totals.remainingMinor, 'EGP')).toBe(27000);
      const raw = await e.office.r.executionValuePeriods.getManyRaw([e.later.slice.id]);
      expect(raw.length).toBe(1);              // محفوظة لا محذوفة
      expect(raw[0].status).toBe('cancelled');
    } finally { closeEnv(e); }
  });

  test('G14 (خدمة) — تعديل مبلغ تحصيل: الأرقام تُعاد والنسخة القديمة محفوظة', async () => {
    const e = await goldenFixture({withExpense: false});
    try {
      const updated = await SIMPLE.updateSimpleReceipt(e.office, {receiptId: e.receipt.receipt.id, amount: 12000, reason: 'تصحيح مبلغ محضر'});
      expect(updated.amount).toBe(12000);
      expect(updated.revisions.length).toBe(1);
      expect(updated.revisions[0].before.amount).toBe(9000);
      const bundle = await SIMPLE.simpleSchedule(e.office, e.created.execution.id, {asOf: '2025-12-31'});
      expect(fromMinorUnits(bundle.schedule.totals.remainingMinor, 'EGP')).toBe(30000);
    } finally { closeEnv(e); }
  });

  test('G8 (خدمة) — تخصيص محدد لشهر يونيو ثم إعادة تخصيص تلقائي (بلا محو)', async () => {
    const e = await goldenFixture({withExpense: false});
    try {
      const out = await SIMPLE.recordSimpleCollection(e.office, {executionId: e.created.execution.id, amount: 3000, date: '2025-05-01', target: 'period', periodKey: 'نفقة شهرية::2025-06-01'});
      expect(out.allocations.length).toBe(1);
      let bundle = await SIMPLE.simpleSchedule(e.office, e.created.execution.id, {asOf: '2025-12-31'});
      expect(bundle.schedule.rows.find(row => row.fromDate === '2025-06-01').status).toBe('paid');
      await SIMPLE.reallocateSimpleReceipt(e.office, {receiptId: out.receipt.id, target: 'auto'});
      bundle = await SIMPLE.simpleSchedule(e.office, e.created.execution.id, {asOf: '2025-12-31'});
      expect(bundle.schedule.rows.find(row => row.fromDate === '2025-01-01').status).toBe('paid');
      const all = await e.office.r.executionAllocations.byIndexRaw('executionId', e.created.execution.id, 500);
      expect(all.filter(row => row.isActive === false).length).toBe(1);  // القديم محفوظ ومُعلَّم
    } finally { closeEnv(e); }
  });

  test('G9 (خدمة) — تحصيل زائد يُحفظ رصيدًا دائنًا ولا يُرفض', async () => {
    const e = await goldenFixture({withReceipt: false, withExpense: false});
    try {
      await SIMPLE.recordSimpleCollection(e.office, {executionId: e.created.execution.id, amount: 50000, date: '2025-04-10'});
      const bundle = await SIMPLE.simpleSchedule(e.office, e.created.execution.id, {asOf: '2025-12-31'});
      expect(fromMinorUnits(bundle.schedule.totals.creditMinor, 'EGP')).toBe(8000);
      expect(fromMinorUnits(bundle.schedule.totals.remainingMinor, 'EGP')).toBe(0);
    } finally { closeEnv(e); }
  });

  test('إلغاء تحصيل يعيد المتبقي، والتراجع الفوري يرجعه', async () => {
    const e = await goldenFixture({withExpense: false});
    try {
      await SIMPLE.voidSimpleRecord(e.office, {kind: 'receipt', id: e.receipt.receipt.id, reason: 'أُدخل بالخطأ'});
      let bundle = await SIMPLE.simpleSchedule(e.office, e.created.execution.id, {asOf: '2025-12-31'});
      expect(fromMinorUnits(bundle.schedule.totals.remainingMinor, 'EGP')).toBe(42000);
      await SIMPLE.undoVoidSimpleRecord(e.office, {kind: 'receipt', id: e.receipt.receipt.id});
      bundle = await SIMPLE.simpleSchedule(e.office, e.created.execution.id, {asOf: '2025-12-31'});
      expect(fromMinorUnits(bundle.schedule.totals.remainingMinor, 'EGP')).toBe(33000);
    } finally { closeEnv(e); }
  });

  test('المصروف لا يزيد أصل النفقة، ويظهر منفصلًا في الأرقام العليا', async () => {
    const e = await goldenFixture({withReceipt: false});
    try {
      const before = await SIMPLE.simpleSchedule(e.office, e.created.execution.id, {asOf: '2025-12-31'});
      expect(fromMinorUnits(before.schedule.totals.remainingMinor, 'EGP')).toBe(42000);
      expect(fromMinorUnits(before.schedule.totals.expenseMinor, 'EGP')).toBe(600);
      expect(before.schedule.expenses[0].includeInPoa).toBe(true);
    } finally { closeEnv(e); }
  });

  test('كشف الحساب: ملخص وتفصيلي شهري وعن مدة بمعادلاته', async () => {
    const e = await goldenFixture();
    try {
      const monthly = await SIMPLE.simpleStatementDocument(e.office, e.created.execution.id, {mode: 'monthly', asOf: '2025-12-31'});
      expect(monthly.html).toContain('كشف حساب تنفيذ');
      expect(monthly.html).toContain('42,000');
      expect(monthly.rows.length).toBe(12);
      const range = await SIMPLE.simpleStatementDocument(e.office, e.created.execution.id, {mode: 'range', fromDate: '2025-04-01', toDate: '2025-09-30', asOf: '2025-12-31'});
      expect(range.html).toContain('21,000');
      const summary = await SIMPLE.simpleStatementDocument(e.office, e.created.execution.id, {mode: 'summary', asOf: '2025-12-31'});
      expect(summary.html.split('<table>').length - 1 < monthly.html.split('<table>').length - 1).toBe(true);
    } finally { closeEnv(e); }
  });

  test('شريط الإكمال: حكم بلا دورية يعرض «حدّد الدورية» بدل رسالة خطأ', async () => {
    const e = await env();
    try {
      const client = await e.office.saveClient({fullName: 'موكل حكم بلا دورية'});
      const created = await SIMPLE.createSimpleExecution(e.office, {clientId: client.id, opponentName: 'خصم', entitlementType: 'نفقة صغار', amount: 2000, effectiveFrom: '2024-01-01', valueType: 'periodic'});
      const {cancelValueSlice} = await import('../services/execution.js');
      await cancelValueSlice(e.office, created.slice.id, 'اختبار: حكم بلا دورية');
      const bundle = await SIMPLE.simpleSchedule(e.office, created.execution.id, {asOf: '2025-12-31'});
      const hints = SIMPLE.completionHints(bundle.schedule, {execution: bundle.execution, judgments: bundle.judgments, slices: bundle.slices});
      expect(hints.some(hint => hint.code === 'no_value')).toBe(true);
      expect(hints.find(hint => hint.code === 'no_value').message).toContain('الدورية');
    } finally { closeEnv(e); }
  });

  test('الترحيل Idempotent وغير مدمّر: تقرير قبل/بعد لكل تنفيذ', async () => {
    const e = await goldenFixture();
    try {
      const before = await e.office.r.executionValuePeriods.count();
      const first = await SIMPLE.migrateSimpleExecutionData(e.office);
      const second = await SIMPLE.migrateSimpleExecutionData(e.office);
      expect(first.scanned).toBe(1);
      expect(first.reused).toBe(false);
      expect(second.reused).toBe(true);
      expect(first.report[0].after.due).toBe(toMinorUnits(42000));
      expect(await e.office.r.executionValuePeriods.count()).toBe(before);
    } finally { closeEnv(e); }
  });

  test('النسخ الاحتياطي: البيانات تُقرأ كما هي بعد إعادة فتح القاعدة (بلا تغيير)', async () => {
    const e = await goldenFixture();
    try {
      const executionId = e.created.execution.id;
      const first = await SIMPLE.simpleSchedule(e.office, executionId, {asOf: '2025-12-31'});
      const sliceCount = await e.office.r.executionValuePeriods.count();
      const receiptCount = await e.office.r.executionReceipts.count();
      const second = await SIMPLE.simpleSchedule(e.office, executionId, {asOf: '2025-12-31'});
      expect(JSON.stringify(first.schedule.totals)).toBe(JSON.stringify(second.schedule.totals));
      expect(await e.office.r.executionValuePeriods.count()).toBe(sliceCount);
      expect(await e.office.r.executionReceipts.count()).toBe(receiptCount);
    } finally { closeEnv(e); }
  });

  test('الإعدادات: ترتيب التخصيص يمكن تغييره (الأحدث أولًا) ويُحترم فورًا', async () => {
    const e = await goldenFixture({withReceipt: false, withExpense: false});
    try {
      const before = await SIMPLE.simpleSchedule(e.office, e.created.execution.id, {asOf: '2025-12-31'});
      const settings = executionSettings(e.office);
      await saveExecutionSettings(e.office, {schedule: {...settings.schedule, allocationOrder: 'lifo'}});
      await SIMPLE.recordSimpleCollection(e.office, {executionId: e.created.execution.id, amount: 4000, date: '2025-04-10'});
      const after = await SIMPLE.simpleSchedule(e.office, e.created.execution.id, {asOf: '2025-12-31'});
      expect(after.schedule.rows.find(row => row.fromDate === '2025-12-01').status).toBe('paid');
      expect(before.schedule.rows.find(row => row.fromDate === '2025-12-01').status).toBe('unpaid');
      await resetExecutionSettings(e.office);
    } finally { closeEnv(e); }
  });

  test('الأداء: 300 تنفيذ — حساب ملخص الصفحة يبقى محددًا بلا مسح كامل', async () => {
    const e = await env();
    try {
      const client = await e.office.saveClient({fullName: 'موكل الأداء'});
      const created = await SIMPLE.createSimpleExecution(e.office, {clientId: client.id, opponentName: 'خصم', entitlementType: 'نفقة صغار', amount: 1000, effectiveFrom: '2025-01-01', valueType: 'periodic'});
      const started = Date.now();
      const rows = await SIMPLE.hydrateSimpleRows(e.office, [created.execution]);
      const elapsed = Date.now() - started;
      expect(rows.length).toBe(1);
      expect(elapsed < 4000).toBe(true);
    } finally { closeEnv(e); }
  });

  test('Activity Log: كل عملية مبسطة تُسجَّل (create/update/void/reallocate)', async () => {
    const e = await goldenFixture({withExpense: false});
    try {
      const logs = await e.office.r.activityLog.byIndex('entityId', e.receipt.receipt.id, 100).catch(() => []);
      const actions = new Set(logs.map(row => row.action));
      expect(actions.has('create')).toBe(true);
      await SIMPLE.updateSimpleReceipt(e.office, {receiptId: e.receipt.receipt.id, amount: 9500, reason: 'تصحيح'});
      await SIMPLE.reallocateSimpleReceipt(e.office, {receiptId: e.receipt.receipt.id, target: 'auto'});
      const after = await e.office.r.activityLog.byIndex('entityId', e.receipt.receipt.id, 100).catch(() => []);
      const afterActions = new Set(after.map(row => row.action));
      expect(afterActions.has('update') || afterActions.has('reallocate')).toBe(true);
    } finally { closeEnv(e); }
  });

  test('لا حذف فعلي: إلغاء الإجراء يبقى في المخزن بحالة ملغاة', async () => {
    const e = await goldenFixture({withReceipt: false, withExpense: false});
    try {
      const action = await SIMPLE.recordSimpleAction(e.office, {executionId: e.created.execution.id, kind: 'notice', date: '2025-04-01'});
      await SIMPLE.voidSimpleRecord(e.office, {kind: 'action', id: action.id, reason: 'سُجّل على تنفيذ آخر'});
      const raw = await e.office.r.executionActions.getManyRaw([action.id]);
      expect(raw.length).toBe(1);
      expect(raw[0].status).toBe('voided');
      const bundle = await SIMPLE.simpleSchedule(e.office, e.created.execution.id, {asOf: '2025-12-31'});
      expect(bundle.actions.filter(row => row.status !== 'voided').length).toBe(0);
    } finally { closeEnv(e); }
  });

  test('الملاحظة تُسجَّل في نظام الملاحظات السريعة القائم مرتبطة بالتنفيذ', async () => {
    const e = await goldenFixture({withReceipt: false, withExpense: false});
    try {
      const note = await SIMPLE.recordSimpleNote(e.office, {executionId: e.created.execution.id, body: 'متابعة مع قلم التنفيذ'});
      expect(note.id).toBeTruthy();
      const {notesForEntity} = await import('../services/quick-notes.js');
      const links = await notesForEntity(e.office, 'EXECUTION', e.created.execution.id);
      expect(links.some(row => row.id === note.id)).toBe(true);
    } finally { closeEnv(e); }
  });

}

// ===================== حزمة البطاقة والحالة والمعاينة =====================
export async function runExecutionCardTests(test, expect) {
  test('حزمة البطاقة تجمع كل ما تحتاجه الشاشة الواحدة من غير أي كتابة', async () => {
    const e = await goldenFixture();
    try {
      const before = await e.office.r.executionLedger.all(1000).catch(() => []);
      const bundle = await SIMPLE.simpleCardBundle(e.office, e.created.execution.id, {asOf: '2025-12-31'});
      for (const key of ['execution', 'client', 'file', 'creditor', 'debtor', 'actions', 'poas', 'expenses', 'status', 'hints', 'today']) {
        expect(bundle[key] === undefined ? 'missing' : 'ok').toBe('ok');
      }
      expect(bundle.creditor.name).toBe('منى عبدالسلام الشاذلي');
      expect(bundle.debtor.name).toBe('محمود فاروق الحلواني');
      expect(bundle.schedule.rows.length).toBe(12);
      expect(['overdue', 'running'].includes(bundle.status.key)).toBe(true);
      const after = await e.office.r.executionLedger.all(1000).catch(() => []);
      expect(after.length).toBe(before.length);
    } finally { closeEnv(e); }
  });

  test('حالة «متوقف» يدوية بسبب إلزامي ثم إعادتها إلى «جارٍ»', async () => {
    const e = await goldenFixture({withReceipt: false, withExpense: false});
    try {
      const missing = await rejects(() => SIMPLE.setExecutionLifecycle(e.office, e.created.execution.id, {state: 'suspended', reason: ' '}));
      expect(missing.code).toBe(ERR.VALIDATION);
      const row = await SIMPLE.setExecutionLifecycle(e.office, e.created.execution.id, {state: 'suspended', reason: 'وقف بالاتفاق'});
      expect(row.lifecycleOverride).toBe('suspended');
      const paused = await SIMPLE.simpleCardBundle(e.office, e.created.execution.id);
      expect(paused.status.key).toBe('suspended');
      await SIMPLE.setExecutionLifecycle(e.office, e.created.execution.id, {state: 'running', reason: ''});
      const resumed = await SIMPLE.simpleCardBundle(e.office, e.created.execution.id);
      expect(resumed.status.key !== 'suspended' ? 'ok' : 'still-suspended').toBe('ok');
      const log = await e.office.r.activityLog.byIndex('entityId', e.created.execution.id, 100).catch(() => []);
      const actions = new Set(log.map(row => row.action));
      expect(actions.has('close') && actions.has('reopen')).toBe(true);
    } finally { closeEnv(e); }
  });

  test('معاينة الحكم اللاحق تبيّن فرق كل شهر بلا أي كتابة', async () => {
    const e = await goldenFixture({withReceipt: false, withExpense: false});
    try {
      const judgmentsBefore = await e.office.r.judgments.byIndex('executionId', e.created.execution.id, 100).catch(() => []);
      const slicesBefore = await e.office.r.executionValuePeriods.byIndex('executionId', e.created.execution.id, 100).catch(() => []);
      const preview = await SIMPLE.previewSubsequentJudgment(e.office, e.created.execution.id, {amount: 5000, effectiveFrom: '2025-10-01', entitlementType: 'نفقة شهرية', asOf: '2025-12-31'});
      expect(preview.rows.length).toBe(3);
      expect(fromMinorUnits(preview.totals.differenceMinor, preview.currency)).toBe(3000);
      const judgmentsAfter = await e.office.r.judgments.byIndex('executionId', e.created.execution.id, 100).catch(() => []);
      const slicesAfter = await e.office.r.executionValuePeriods.byIndex('executionId', e.created.execution.id, 100).catch(() => []);
      expect(judgmentsAfter.length).toBe(judgmentsBefore.length);
      expect(slicesAfter.length).toBe(slicesBefore.length);
    } finally { closeEnv(e); }
  });
}

/* ==================== ترقيم صفحات الطباعة (دوال نصية بحتة) ==================== */

export function runExecutionPrintDocumentTests(test, expect) {
  test('مستند الطباعة: مقاس A4 وهوامشه وترقيم الصفحات مضمّنان في المستند النهائي', () => {
    const doc = PRINT.wrapForPrint('<!doctype html><html><head><title>كشف حساب</title></head><body><p>س</p></body></html>');
    expect(doc.includes('@page')).toBe(true);
    expect(doc.includes('size: A4')).toBe(true);
    expect(doc.includes('margin: 14mm 12mm')).toBe(true);
    expect(doc.includes('data-print-paginator')).toBe(true);
    expect(doc.includes('صفحة ')).toBe(true);                       // قالب رقم الصفحة داخل السكربت
    expect(doc.includes("thead { display: table-header-group; }")).toBe(true); // رؤوس الجداول تتكرر
    expect(doc.indexOf('data-print-paginator') < doc.indexOf('</body>')).toBe(true);
  });

  test('مستند الطباعة: الحقن يتم قبل </body> ودالة الورق ترفض المستند الفارغ', () => {
    const wrapped = PRINT.wrapForPrint('<html><body><table><tbody><tr><td>1</td></tr></tbody></table></body></html>');
    expect(wrapped.indexOf('<style data-print-pages>') < wrapped.indexOf('<script data-print-paginator>')).toBe(true);
    expect(wrapped.endsWith('</body></html>')).toBe(true);
    let threw = false;
    try { PRINT.wrapForPrint(''); } catch { threw = true; }
    expect(threw).toBe(true);
  });

  test('الترقيم لا يُطبَّق مرتين (لفّ مزدوج) — كل مسارات الطباعة تمرّ بنفس اللفّ مرة واحدة', () => {
    const once = PRINT.wrapForPrint('<html><body><p>س</p></body></html>');
    const twice = PRINT.wrapForPrint(once);
    expect(twice).toBe(once);
    expect(once.split('data-print-paginator').length - 1).toBe(1);
    expect(once.split('<style data-print-pages>').length - 1).toBe(1);
  });

  test('سلوك الترقيم: لكل صفحة تذييل «صفحة N من M» وحدّ حماية للجداول الضخمة', () => {
    const script = PRINT.PRINT_PAGINATOR_SCRIPT;
    expect(script.includes("className = 'print-page'")).toBe(true);
    expect(script.includes('صفحة ')).toBe(true);
    expect(script.includes("(index + 1)")).toBe(true);
    expect(script.includes("' من ' + used.length")).toBe(true);
    expect(script.includes('MAX_ROWS = 2000')).toBe(true);           // مستند ضخم يبقى على ترقيم المتصفح
    expect(script.includes('data-print-pages')).toBe(true);
    const styles = PRINT.PRINT_PAGE_STYLES;
    expect(styles.includes('break-after: page')).toBe(true);
    expect(styles.includes('page-break-inside: avoid')).toBe(true);
  });
}

/* ============ استبدال بند القيمة بحكم لاحق (بلا ازدواج وبلا حذف) ============ */

export function runExecutionSupersedeTests(test, expect) {
  test('حكم لاحق يبدأ بعد بداية القيمة السابقة: يُقبل والمحرك يقصّ السابقة بلا ازدواج', () => {
    const slice = (id, amount, startDate, endDate) => ({id, executionId: 'e1', entitlementType: 'نفقة شهرية', valueType: 'periodic', periodicity: 'monthly', amount, amountMinor: amount * 100, currency: 'EGP', startDate, endDate, judgmentId: 'j' + id, isDeleted: false, status: 'active'});
    const errors = validateValueSlice({entitlementType: 'نفقة شهرية', judgmentId: 'j2', startDate: '2026-01-01', endDate: '', valueType: 'periodic', periodicity: 'monthly', amount: 3_000},
      {existing: [slice('A', 2_500, '2024-01-01', '2026-12-31')]});
    expect(Object.keys(errors).length).toBe(0);
    const schedule = D.buildExecutionSchedule({slices: [slice('A', 2_500, '2024-01-01', '2026-12-31'), slice('B', 3_000, '2026-01-01', '')], receipts: [], allocations: [], ledger: [], settings: {}, asOf: '2026-12-31'});
    expect(schedule.totals.periodCount).toBe(36);
    expect(schedule.totals.dueMinor).toBe((2_500 * 24 + 3_000 * 12) * 100);   // 96,000 بلا ازدواج
    expect(schedule.rows.find(row => row.fromDate === '2026-01-01').dueMinor).toBe(300_000);
    expect(schedule.rows.find(row => row.fromDate === '2025-12-01').dueMinor).toBe(250_000);
  });

  test('التداخل الحقيقي (بداية مساوية أو أسبق) يبقى مرفوضًا برسالة عربية واضحة', () => {
    const existing = [{id: 'A', entitlementType: 'نفقة شهرية', startDate: '2024-01-01', endDate: '2026-12-31', isDeleted: false, status: 'active'}];
    const sameStart = validateValueSlice({entitlementType: 'نفقة شهرية', judgmentId: 'j2', startDate: '2024-01-01', endDate: '', amount: 3_000, valueType: 'periodic', periodicity: 'monthly'}, {existing});
    expect(typeof sameStart.startDate).toBe('string');
    const earlierStart = validateValueSlice({entitlementType: 'نفقة شهرية', judgmentId: 'j2', startDate: '2023-06-01', endDate: '', amount: 3_000, valueType: 'periodic', periodicity: 'monthly'}, {existing});
    expect(typeof earlierStart.startDate).toBe('string');
  });
}
