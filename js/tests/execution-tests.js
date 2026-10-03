// =====================================================================
// اختبارات قسم التنفيذ — نطاق كامل: المجال النقي، الشرائح، الفروق، التسويات،
// الدفتر Append-Only، التخصيص، المحاضر، التوكيلات، الرصيد، التتبع، اللقطة،
// المحاكي، المؤشرات، الترحيل، والبحث الشامل. كلها نقية الحساب + قواعد البيانات.
// =====================================================================
import {upgradeSchema, STORE, STORES, SCHEMA_MIGRATIONS, migrationPlan} from '../db/schema.js';
import {SCHEMA_VERSION} from '../core/constants.js';
import {ERR} from '../core/errors.js';
import {Office} from '../services/office.js';
import {createLegalFile} from '../services/legal-files.js';
import * as EX from '../services/execution.js';
import * as L from '../services/execution-ledger.js';
import * as DF from '../services/execution-differences.js';
import * as POA from '../services/execution-poa.js';
import * as B from '../services/execution-balance.js';
import * as PR from '../services/execution-print.js';
import * as MIG from '../services/execution-migration.js';
import {seedFamilyExecutionExample, familyExecutionExampleState} from '../services/execution-demo.js';
import {searchStore} from '../services/search-engine.js';
import {deepHealth} from '../services/integrity.js';
import * as E from '../domain/execution.js';
import * as EN from '../domain/entitlement-engine.js';
import {Clock} from '../core/clock.js';
import * as FEAS from '../domain/execution-feas.js';
import * as FEASApp from '../services/execution-feas.js';
import {toMinorUnits} from '../domain/execution-money.js';

const rejects = async fn => { try { await fn(); } catch (error) { return error; } throw Error('Expected promise to reject'); };
const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

async function openDb(name) {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(name, SCHEMA_VERSION);
    r.onupgradeneeded = e => upgradeSchema(r.result, e.target.transaction);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function env({executionType = 'family', through = '2025-12-31', openedDate = '2025-01-05', accountingModel = 'legacy-v1'} = {}) {
  const name = `AhmadKhudairLawOfficeDB__test__execution__${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const db = await openDb(name);
  const office = new Office({db, assert() {}, token: 'exec-test', profile: {id: 'tester'}});
  const client = await office.saveClient({fullName: 'موكل التنفيذ التجريبي'});
  const file = await createLegalFile(office, {clientId: client.id, title: 'ملف تنفيذ تجريبي', fileType: 'أسرة'});
  const execution = await EX.createExecution(office, {
    executionType, accountingModel, clientId: client.id, fileId: file.id, openedDate,
    judgmentDate: '2025-01-10', authority: 'محكمة الأسرة', officialNumber: '1201/2025',
    status: 'active', entitlementThroughDate: through
  });
  return {db, office, client, file, execution, name};
}

const closeEnv = env => { try { env.db.close(); indexedDB.deleteDatabase(env.name); } catch {} };

/** تنفيذ أسرة: 3000/شهري من 2025-01-01 (12 فترة) ثم حكم لاحق 4000/شهري من 2025-07-01. */
async function familyFixture() {
  const env0 = await env();
  const {office, execution} = env0;
  const j1 = await EX.addExecutionJudgment(office, {
    executionId: execution.id, entitlementType: 'نفقة شهرية', judgmentKind: 'original',
    judgmentDate: '2025-01-10', judgmentNumber: '10/2025', lawsuitNumber: '22/2025',
    valueType: 'periodic', periodicity: 'monthly', amount: 3000, effectiveFrom: '2025-01-01'
  });
  const s1 = await EX.saveValueSlice(office, {
    executionId: execution.id, judgmentId: j1.id, entitlementType: 'نفقة شهرية',
    valueType: 'periodic', periodicity: 'monthly', amount: 3000, startDate: '2025-01-01'
  });
  const j2 = await EX.addExecutionJudgment(office, {
    executionId: execution.id, entitlementType: 'نفقة شهرية', judgmentKind: 'later',
    judgmentDate: '2025-07-20', judgmentNumber: '88/2025', appealNumber: '77/2025',
    valueType: 'periodic', periodicity: 'monthly', amount: 4000, effectiveFrom: '2025-07-01',
    previousJudgmentId: j1.id
  });
  const s2 = await EX.saveValueSlice(office, {
    executionId: execution.id, judgmentId: j2.id, entitlementType: 'نفقة شهرية',
    valueType: 'periodic', periodicity: 'monthly', amount: 4000, startDate: '2025-07-01'
  });
  return {...env0, j1, s1, j2, s2};
}

async function feasFixture({fromDate = '2025-01-01', toDate = '2025-03-31'} = {}) {
  const env0 = await env({accountingModel: FEAS.FEAS_MODEL});
  const {office, execution} = env0;
  const obligation = await FEASApp.saveExecutionObligation(office, {
    executionId: execution.id, obligationType: 'نفقة كما وردت بالمصدر', frequency: 'monthly',
    prorationPolicy: 'days', currency: 'EGP', startDate: '2025-01-01'
  });
  const judgment = await EX.addExecutionJudgment(office, {
    executionId: execution.id, entitlementType: obligation.obligationType, judgmentKind: 'original',
    judgmentDate: '2025-01-10', judgmentNumber: 'FEAS-1', valueType: 'periodic', periodicity: 'monthly',
    amount: 3000, effectiveFrom: '2025-01-01'
  });
  const slice = await EX.saveValueSlice(office, {
    executionId: execution.id, obligationId: obligation.id, judgmentId: judgment.id,
    valueType: 'periodic', amount: '3000.00', startDate: '2025-01-01'
  });
  const preview = await FEASApp.projectExecutionPeriod(office, {executionId: execution.id, obligationId: obligation.id, fromDate, toDate});
  const recognition = await FEASApp.recognizeExecutionPeriod(office, {
    executionId: execution.id, obligationId: obligation.id, fromDate, toDate, expectedFingerprint: preview.fingerprint
  });
  return {...env0, obligation, judgment, slice, preview, period: recognition.row};
}

export async function runExecutionTests(test, expect) {
  // ===== 1) المجال النقي: التواريخ والفترات والمفاتيح =====
  test('تنفيذ/مجال: مفتاح الفترة حتمي وثابت (نوع الاستحقاق + بداية الفترة)', () => {
    expect(E.periodKeyOf('نفقة شهرية', '2025-07-01')).toBe('نفقة شهرية::2025-07-01');
    expect(EN.parsePeriodKey('نفقة شهرية::2025-07-01').start).toBe('2025-07-01');
    expect(E.parsePeriodKey('نفقة شهرية::2025-07-01').start).toBe('2025-07-01');
    expect(E.parsePeriodKey('مفتاح غير صحيح')).toBe(null);
  });
  test('تنفيذ/مجال: بدايات الفترات الشهرية والنصف شهرية والمخصصة', () => {
    expect(E.periodStartFor('2025-07-15', 'monthly')).toBe('2025-07-01');
    const weekly = E.periodStartFor('2025-07-15', 'weekly');
    expect(weekly <= '2025-07-15').toBe(true);
    expect(E.periodEndFor(weekly, 'weekly') >= '2025-07-15').toBe(true);
    const semi = E.periodStartFor('2025-07-15', 'semiMonthly');
    expect(semi <= '2025-07-15').toBe(true);
    expect(E.periodEndFor(semi, 'semiMonthly') >= '2025-07-15').toBe(true);
    expect(E.periodStartFor('2025-07-15', 'yearly')).toBe('2025-01-01');
    expect(E.periodStartFor('2025-07-15', 'daily')).toBe('2025-07-15');
  });
  test('تنفيذ/مجال: توليد فترات محدود ومتوقف عند الحد الأقصى (توليد كسول بلا إنشاء سجلات)', () => {
    const list = E.enumeratePeriods({from: '2025-01-01', to: '2025-12-31', periodicity: 'monthly'}).periods;
    expect(list.length).toBe(12);
    expect(list[0].start).toBe('2025-01-01'); expect(list[11].end).toBe('2025-12-31');
    const capped = E.enumeratePeriods({from: '2000-01-01', to: '2025-12-31', periodicity: 'daily', maxPeriods: 30}).periods;
    expect(capped.length).toBe(30);
  });
  test('تنفيذ/مجال: سياسة احتساب الفترة الجزئية (أيام مقابل قيمة بداية الفترة)', () => {
    const slice = {id: 's', entitlementType: 'نفقة', valueType: 'periodic', periodicity: 'monthly', amount: 3000, startDate: '2025-01-01', status: 'active'};
    const period = {start: '2025-01-01', end: '2025-01-31', entitlementType: 'نفقة'};
    const days = EN.sliceValueForPeriod(slice, period, {proration: 'days'});
    expect(days.amount).toBe(3000);
    const opening = {...slice, startDate: '2025-01-16'};
    const partial = EN.sliceValueForPeriod(opening, period, {proration: 'days'});
    expect(partial.prorated).toBe(true);
    expect(partial.amount > 0 && partial.amount < 3000).toBe(true);
    // سياسة «بداية الفترة» تُحتسب كاملة إن كانت الشريحة سارية في بداية الفترة نفسها
    const asOpening = EN.sliceValueForPeriod({...slice, startDate: '2025-01-01'}, period, {policy: 'periodStart'});
    expect(asOpening.amount).toBe(3000);
    const midPeriod = EN.sliceValueForPeriod(opening, period, {policy: 'periodStart'});
    expect(midPeriod.prorated).toBe(true);
    expect(midPeriod.amount < 3000).toBe(true);
  });
  test('تنفيذ/مجال: رسائل التحقق عربية وواضحة لشرائح القيمة والحركات والتخصيص', () => {
    const sliceErrors = E.validateValueSlice({entitlementType: '', amount: -5, startDate: '2026-02-30'}, {existing: []});
    expect(Boolean(sliceErrors.entitlementType && sliceErrors.amount && sliceErrors.startDate)).toBe(true);
    const ledgerErrors = E.validateLedgerEntry({executionId: '', type: 'غير معروف', amount: -1, date: ''});
    expect(Boolean(ledgerErrors.executionId && ledgerErrors.type && ledgerErrors.amount && ledgerErrors.date)).toBe(true);
    const allocationErrors = E.validateAllocationLines({lines: [{periodKey: 'x', amount: -3}], amount: 100, outstanding: new Map()});
    expect(allocationErrors.length > 0).toBe(true);
    expect(typeof allocationErrors[0].message).toBe('string');
  });

  // ===== 2) التنفيذ وسلسلة الأحكام =====
  test('تنفيذ/إنشاء: ترقيم داخلي + ربط الملف/الموكل + رفض نوع تنفيذ غير معروف', async () => {
    const e = await env({executionType: 'civil'});
    try {
      expect(e.execution.internalNumber.startsWith('EX-')).toBe(true);
      expect(e.execution.fileId).toBe(e.file.id);
      expect(e.execution.clientId).toBe(e.client.id);
      const bad = await rejects(() => EX.createExecution(e.office, {executionType: 'عشوائي', clientId: e.client.id, fileId: e.file.id, openedDate: '2025-02-01'}));
      expect(Boolean(bad.details?.executionType)).toBe(true);
      const missing = await rejects(() => EX.createExecution(e.office, {executionType: 'family', openedDate: '2025-02-01'}));
      expect(Boolean(missing.details?.clientId || missing.details?.fileId)).toBe(true);
    } finally { closeEnv(e); }
  });
  test('تنفيذ/أطراف: مستحق ومنفذ ضده بصفات يسجلها المستخدم بلا استنتاج قانوني', async () => {
    const e = await env();
    try {
      const creditor = await EX.saveExecutionParty(e.office, {executionId: e.execution.id, clientId: e.client.id, side: 'creditor'});
      const debtor = await EX.saveExecutionParty(e.office, {executionId: e.execution.id, name: 'المنفذ ضده', side: 'debtor', role: 'منفذ ضده'});
      expect(creditor.name).toBe(e.client.fullName);
      expect(debtor.side).toBe('debtor');
      const rows = await EX.executionPartyRows(e.office, e.execution.id);
      expect(rows.length).toBe(2);
      const bad = await rejects(() => EX.saveExecutionParty(e.office, {executionId: e.execution.id, side: 'creditor'}));
      expect(Boolean(bad.details?.name)).toBe(true);
    } finally { closeEnv(e); }
  });
  test('تنفيذ/أحكام: السلسلة أصلي → لاحق بترتيب وربط previousJudgmentId', async () => {
    const e = await familyFixture();
    try {
      const chain = await EX.executionJudgments(e.office, e.execution.id);
      expect(chain.length).toBe(2);
      expect(chain[0].id).toBe(e.j1.id); expect(chain[0].sequence).toBe(1);
      expect(chain[1].previousJudgmentId).toBe(e.j1.id); expect(chain[1].sequence).toBe(2);
      expect(chain[1].judgmentDate).toBe('2025-07-20');
      expect(chain[0].effectiveFrom).toBe('2025-01-01');
    } finally { closeEnv(e); }
  });
  test('تنفيذ/أحكام: تاريخ الحكم ≠ تاريخ سريان القيمة ولا يُستنتج أحدهما من الآخر', async () => {
    const e = await env();
    try {
      const bad = await rejects(() => EX.addExecutionJudgment(e.office, {executionId: e.execution.id, entitlementType: 'نفقة', judgmentDate: '2025-03-01', effectiveFrom: '2025-13-01', amount: 100, valueType: 'fixed'}));
      expect(Boolean(bad.details?.effectiveFrom)).toBe(true);
      const j = await EX.addExecutionJudgment(e.office, {executionId: e.execution.id, entitlementType: 'نفقة', judgmentDate: '2025-03-01', amount: 100, valueType: 'fixed'});
      expect(j.effectiveFrom).toBe('');
      expect(j.judgmentDate).toBe('2025-03-01');
    } finally { closeEnv(e); }
  });
  test('تنفيذ/أحكام: بعد ربط شريحة قيمة يُمنع تغيير قيمة الحكم أو تاريخ السريان', async () => {
    const e = await familyFixture();
    try {
      const conflict = await rejects(() => EX.updateExecutionJudgment(e.office, e.j1.id, {amount: 3500}));
      expect(conflict.code).toBe(ERR.CONFLICT);
      const ok = await EX.updateExecutionJudgment(e.office, e.j1.id, {operativeSummary: 'منطوق الحكم كما ورد'});
      expect(ok.operativeSummary.length > 0).toBe(true);
    } finally { closeEnv(e); }
  });

  // ===== 3) شرائح القيمة والاستحقاق (3000/36000 → 4000/42000) =====
  test('تنفيذ/شريحة: مبلغ ثابت (70000 مرة واحدة) لا يتكرر شهريًا', async () => {
    const e = await env();
    try {
      const j = await EX.addExecutionJudgment(e.office, {executionId: e.execution.id, entitlementType: 'تعويض', judgmentDate: '2025-02-01', valueType: 'fixed', amount: 70000, effectiveFrom: '2025-02-01'});
      await EX.saveValueSlice(e.office, {executionId: e.execution.id, judgmentId: j.id, entitlementType: 'تعويض', valueType: 'fixed', amount: 70000, startDate: '2025-02-01'});
      const balance = await B.executionBalance(e.office, e.execution.id);
      expect(balance.summary.finalEntitlement).toBe(70000);
      expect(balance.summary.periodCount).toBe(1);
    } finally { closeEnv(e); }
  });
  test('تنفيذ/استحقاق: 3000 شهريًا داخل 2025 = 36000 مع 12 فترة', async () => {
    const e = await familyFixture();
    try {
      const slices = await EX.executionSlices(e.office, e.execution.id);
      const build = EN.buildEntitlementPeriods({slices, to: '2025-06-30', policy: 'days'});
      expect(build.periods.length).toBe(6);
      const total = round2(build.periods.reduce((s, p) => s + p.finalAmount, 0));
      expect(total).toBe(18000);
      expect(e.s1.amount).toBe(3000);
    } finally { closeEnv(e); }
  });
  test('تنفيذ/استحقاق: الحكم اللاحق 4000 من 2025-07 ينتج 42000 نهائيًا و36000 أصليًا وفرق 6000', async () => {
    const e = await familyFixture();
    try {
      const balance = await B.executionBalance(e.office, e.execution.id);
      expect(balance.summary.finalEntitlement).toBe(42000);
      expect(balance.summary.originalEntitlement).toBe(36000);
      expect(balance.summary.periodCount).toBe(12);
      expect(balance.impact?.totals?.difference ?? 0).toBe(0);
      const impact = await DF.previewImpact(e.office, {executionId: e.execution.id, sliceId: e.s2.id});
      expect(impact.impact.rows.length).toBe(6);
      expect(round2(impact.impact.totals.difference)).toBe(6000);
      expect(round2(impact.impact.totals.oldValue)).toBe(18000);
      expect(round2(impact.impact.totals.newValue)).toBe(24000);
    } finally { closeEnv(e); }
  });
  test('تنفيذ/لا ازدواج: الفترة المتأثرة تُحتسب 4000 مرة واحدة (وليس 3000+4000)', async () => {
    const e = await familyFixture();
    try {
      const balance = await B.executionBalance(e.office, e.execution.id);
      const july = balance.summary.periods.find(p => p.periodKey === 'نفقة شهرية::2025-07-01');
      expect(july.finalAmount).toBe(4000);
      expect(july.originalAmount).toBe(3000);
      expect(july.difference).toBe(1000);
      expect(july.equation.includes('4000')).toBe(true);
      const half = balance.summary.periods.filter(p => p.start >= '2025-07-01').every(p => p.finalAmount === 4000);
      expect(half).toBe(true);
      const firstHalf = balance.summary.periods.filter(p => p.start < '2025-07-01').every(p => p.finalAmount === 3000);
      expect(firstHalf).toBe(true);
    } finally { closeEnv(e); }
  });
  test('تنفيذ/تحصيل جزئي: 4000 نهائي − 2000 محصل = 2000 = 1000 رصيد أصلي + 1000 فرق حكم', async () => {
    const e = await env();
    try {
      const j = await EX.addExecutionJudgment(e.office, {executionId: e.execution.id, entitlementType: 'نفقة شهرية', judgmentDate: '2025-01-05', valueType: 'periodic', periodicity: 'monthly', amount: 3000, effectiveFrom: '2025-01-01'});
      await EX.saveValueSlice(e.office, {executionId: e.execution.id, judgmentId: j.id, entitlementType: 'نفقة شهرية', valueType: 'periodic', periodicity: 'monthly', amount: 3000, startDate: '2025-01-01'});
      await L.recordCollection(e.office, {executionId: e.execution.id, amount: 2000, date: '2025-01-20', allocation: {method: 'DIRECT', targets: [{periodKey: 'نفقة شهرية::2025-01-01', amount: 2000}]}});
      const j2 = await EX.addExecutionJudgment(e.office, {executionId: e.execution.id, entitlementType: 'نفقة شهرية', judgmentKind: 'later', judgmentDate: '2025-02-01', valueType: 'periodic', periodicity: 'monthly', amount: 4000, effectiveFrom: '2025-01-01', previousJudgmentId: j.id});
      const s2 = await EX.saveValueSlice(e.office, {executionId: e.execution.id, judgmentId: j2.id, entitlementType: 'نفقة شهرية', valueType: 'periodic', periodicity: 'monthly', amount: 4000, startDate: '2025-01-01'});
      const impact = await DF.previewImpact(e.office, {executionId: e.execution.id, sliceId: s2.id});
      const jan = impact.impact.rows.find(row => row.periodKey === 'نفقة شهرية::2025-01-01');
      expect(jan.oldValue).toBe(3000); expect(jan.newValue).toBe(4000);
      expect(jan.collected).toBe(2000);
      expect(jan.originalOutstanding).toBe(1000);
      expect(jan.remaining).toBe(2000);
      expect(jan.difference).toBe(1000);
    } finally { closeEnv(e); }
  });
  test('تنفيذ/تشريح: الفرق = (النهائي − المحصل) − (الأصلي − المحصل) مهما كان التحصيل', () => {
    const breakdown = EN.outstandingBreakdown({finalAmount: 4000, originalAmount: 3000, collected: 2000});
    expect(breakdown.remaining).toBe(2000);
    expect(breakdown.originalOutstanding).toBe(1000);
    expect(breakdown.differencePart).toBe(1000);
    const zero = EN.outstandingBreakdown({finalAmount: 4000, originalAmount: 3000, collected: 0});
    expect(zero.remaining).toBe(4000); expect(zero.originalOutstanding).toBe(3000); expect(zero.differencePart).toBe(1000);
    const full = EN.outstandingBreakdown({finalAmount: 4000, originalAmount: 3000, collected: 4000});
    expect(full.remaining).toBe(0); expect(full.originalOutstanding).toBe(0); expect(full.differencePart).toBe(0);
  });

  // ===== 4) تسويات الفروق: لا حركة مالية قبل الاعتماد =====
  test('تنفيذ/تسوية: إنشاء التسوية بحالة تنتظر المراجعة + صفوف فرق لكل فترة متأثرة', async () => {
    const e = await familyFixture();
    try {
      const created = await DF.createSettlement(e.office, {executionId: e.execution.id, sliceId: e.s2.id, note: 'مراجعة الحكم اللاحق'});
      expect(created.settlement.status).toBe('PENDING_REVIEW');
      expect(created.differences.length).toBe(6);
      expect(round2(created.settlement.totals.difference)).toBe(6000);
      expect(created.differences.every(row => row.status === 'PENDING_REVIEW')).toBe(true);
      expect(created.differences[0].equation.includes('−')).toBe(true);
    } finally { closeEnv(e); }
  });
  test('تنفيذ/تسوية: لا تُكتب أي حركة مالية (DIFFERENCE_DUE) قبل اعتماد المستخدم', async () => {
    const e = await familyFixture();
    try {
      await DF.createSettlement(e.office, {executionId: e.execution.id, sliceId: e.s2.id});
      const ledger = await EX.executionLedgerRows(e.office, e.execution.id);
      expect(ledger.length).toBe(0);
      const balance = await B.executionBalance(e.office, e.execution.id);
      expect(balance.summary.differencesPostedInLedger).toBe(0);
      expect(balance.summary.differences.pending > 0).toBe(true);
    } finally { closeEnv(e); }
  });
  test('تنفيذ/تسوية: منع الترحيل قبل الاعتماد ورفض التسوية يلغي الصفوف بلا حركة', async () => {
    const e = await familyFixture();
    try {
      const created = await DF.createSettlement(e.office, {executionId: e.execution.id, sliceId: e.s2.id});
      const blocked = await rejects(() => DF.postSettlement(e.office, created.settlement.id));
      expect(blocked.code).toBe(ERR.CONFLICT);
      await DF.decideSettlement(e.office, created.settlement.id, {decision: 'reject', reason: 'لم تُعرض على المراجعة'});
      const after = await DF.settlementReview(e.office, created.settlement.id);
      expect(after.rows.every(row => row.status === 'CANCELLED')).toBe(true);
      expect((await EX.executionLedgerRows(e.office, e.execution.id)).length).toBe(0);
      const posted = await rejects(() => DF.postSettlement(e.office, created.settlement.id));
      expect(posted.code === ERR.CONFLICT || posted.code === ERR.VALIDATION).toBe(true);
    } finally { closeEnv(e); }
  });
  test('تنفيذ/تسوية: الاعتماد ثم الترحيل يكتب DIFFERENCE_DUE مرتبطة بسجل الفرق والحكم', async () => {
    const e = await familyFixture();
    try {
      const created = await DF.createSettlement(e.office, {executionId: e.execution.id, sliceId: e.s2.id});
      await DF.decideSettlement(e.office, created.settlement.id, {decision: 'approve', reason: 'مطابقة الحكم'});
      const posted = await DF.postSettlement(e.office, created.settlement.id);
      expect(posted.posted.length).toBe(6);
      const ledger = await EX.executionLedgerRows(e.office, e.execution.id);
      expect(ledger.length).toBe(6);
      expect(ledger.every(row => row.type === 'DIFFERENCE_DUE' && row.category === 'obligation')).toBe(true);
      expect(ledger.every(row => row.differenceRecordId && row.judgmentId === e.j2.id)).toBe(true);
      const balance = await B.executionBalance(e.office, e.execution.id);
      expect(round2(balance.summary.differences.posted)).toBe(6000);
      expect(round2(balance.summary.differencesPostedInLedger)).toBe(6000);
    } finally { closeEnv(e); }
  });
  test('تنفيذ/تسوية: idempotent — إعادة الإنشاء لنفس الشريحة قيد المراجعة لا تُكرر الفروق', async () => {
    const e = await familyFixture();
    try {
      const first = await DF.createSettlement(e.office, {executionId: e.execution.id, sliceId: e.s2.id});
      const again = await DF.createSettlement(e.office, {executionId: e.execution.id, sliceId: e.s2.id});
      expect(again.reused).toBe(true);
      expect(again.settlement.id).toBe(first.settlement.id);
      const rows = await EX.executionDifferences(e.office, e.execution.id);
      expect(rows.length).toBe(6);
    } finally { closeEnv(e); }
  });
  test('تنفيذ/تسوية: إعادة الحساب تلغي الصفوف السابقة ولا تحذفها', async () => {
    const e = await familyFixture();
    try {
      const created = await DF.createSettlement(e.office, {executionId: e.execution.id, sliceId: e.s2.id});
      await L.recordCollection(e.office, {executionId: e.execution.id, amount: 1000, date: '2025-08-05', allocation: {method: 'FIFO'}});
      await DF.recomputeSettlement(e.office, created.settlement.id);
      const rows = await EX.executionDifferences(e.office, e.execution.id);
      expect(rows.filter(row => row.status === 'CANCELLED').length).toBe(6);
      expect(rows.filter(row => row.status === 'PENDING_REVIEW').length).toBe(6);
      expect(rows.length).toBe(12);
    } finally { closeEnv(e); }
  });
  test('تنفيذ/تسوية: رفض إنشاء تسوية بلا أثر مالي', async () => {
    const e = await env();
    try {
      const j = await EX.addExecutionJudgment(e.office, {executionId: e.execution.id, entitlementType: 'نفقة', judgmentDate: '2025-01-10', valueType: 'periodic', periodicity: 'monthly', amount: 3000, effectiveFrom: '2025-01-01'});
      const s = await EX.saveValueSlice(e.office, {executionId: e.execution.id, judgmentId: j.id, entitlementType: 'نفقة', valueType: 'periodic', periodicity: 'monthly', amount: 3000, startDate: '2025-01-01'});
      const error = await rejects(() => DF.createSettlement(e.office, {executionId: e.execution.id, sliceId: s.id}));
      expect(error.code).toBe(ERR.VALIDATION);
    } finally { closeEnv(e); }
  });

  // ===== 5) الدفتر Append-Only والحركات المالية =====
  test('تنفيذ/دفتر: لا تعديل ولا استبدال لحركة تاريخية (تُرفض الكتابة بمعرّف قائم)', async () => {
    const e = await env();
    try {
      const row = await L.addLedgerEntry(e.office, {executionId: e.execution.id, type: 'STAMP', amount: 50, date: '2025-02-01', includeInPoa: true});
      const error = await rejects(() => L.addLedgerEntry(e.office, {executionId: e.execution.id, type: 'STAMP', amount: 80, date: '2025-02-01', id: row.id}));
      expect(error.code).toBe(ERR.CONFLICT);
      const stored = await e.office.r.executionLedger.get(row.id);
      expect(stored.amount).toBe(50);
    } finally { closeEnv(e); }
  });
  test('تنفيذ/دفتر: منع تسجيل فرق الاستحقاق يدويًا (يُراجع ويُعتمد ثم يُرحَّل)', async () => {
    const e = await env();
    try {
      const error = await rejects(() => L.addLedgerEntry(e.office, {executionId: e.execution.id, type: 'DIFFERENCE_DUE', amount: 500, date: '2025-02-01'}));
      expect(error.code).toBe(ERR.VALIDATION);
      expect(String(error.message).includes('فرق الاستحقاق')).toBe(true);
    } finally { closeEnv(e); }
  });
  test('تنفيذ/دفتر: العكس (REVERSAL) بسبب مكتوب ومنع العكس المكرر أو الأكبر من الصافي', async () => {
    const e = await env();
    try {
      const row = await L.addLedgerEntry(e.office, {executionId: e.execution.id, type: 'EXECUTION_FEE', amount: 300, date: '2025-02-01'});
      const noReason = await rejects(() => L.reverseLedgerEntry(e.office, {executionId: e.execution.id, ledgerId: row.id, amount: 100}));
      expect(noReason.code).toBe(ERR.VALIDATION);
      const tooMuch = await rejects(() => L.reverseLedgerEntry(e.office, {executionId: e.execution.id, ledgerId: row.id, amount: 400, reason: 'خطأ'}));
      expect(Boolean(tooMuch.details?.amount)).toBe(true);
      await L.reverseLedgerEntry(e.office, {executionId: e.execution.id, ledgerId: row.id, amount: 300, reason: 'سُجّل مرتين'});
      const ledger = await EX.executionLedgerRows(e.office, e.execution.id);
      const target = EN.netLedger(ledger).find(item => item.id === row.id);
      expect(target.netAmount).toBe(0);
      const duplicate = await rejects(() => L.reverseLedgerEntry(e.office, {executionId: e.execution.id, ledgerId: row.id, amount: 10, reason: 'تكرار'}));
      expect(duplicate.code).toBe(ERR.CONFLICT);
    } finally { closeEnv(e); }
  });
  test('تنفيذ/دفتر: التصحيح (ADJUSTMENT) زيادة/نقصان بسبب ولا يعدّل الحركة الأصلية', async () => {
    const e = await env();
    try {
      const row = await L.addLedgerEntry(e.office, {executionId: e.execution.id, type: 'COLLECTION_FEE', amount: 100, date: '2025-03-01'});
      await L.adjustLedgerEntry(e.office, {executionId: e.execution.id, ledgerId: row.id, amount: 25, direction: 'increase', reason: 'رسوم فعلية أعلى'});
      await L.adjustLedgerEntry(e.office, {executionId: e.execution.id, ledgerId: row.id, amount: 15, direction: 'decrease', reason: 'تصحيح إدخال'});
      const ledger = await EX.executionLedgerRows(e.office, e.execution.id);
      const target = EN.netLedger(ledger).find(item => item.id === row.id);
      expect(target.netAmount).toBe(110);
      expect((await e.office.r.executionLedger.get(row.id)).amount).toBe(100);
      const beyond = await rejects(() => L.adjustLedgerEntry(e.office, {executionId: e.execution.id, ledgerId: row.id, amount: 500, direction: 'increase', reason: 'تجاوز'}));
      expect(Boolean(beyond.details?.amount)).toBe(true);
    } finally { closeEnv(e); }
  });
  test('تنفيذ/مصروفات: الرسوم والدمغة فصل عن أصل الاستحقاق ومعها علاقة التوكيل', async () => {
    const e = await env();
    try {
      await L.recordExpense(e.office, {executionId: e.execution.id, type: 'EXECUTION_FEE', amount: 250, date: '2025-02-02', includeInPoa: true});
      await L.recordExpense(e.office, {executionId: e.execution.id, type: 'STAMP', amount: 40, date: '2025-02-02', includeInPoa: false});
      const bad = await rejects(() => L.recordExpense(e.office, {executionId: e.execution.id, type: 'COLLECTION', amount: 10, date: '2025-02-02'}));
      expect(bad.code).toBe(ERR.VALIDATION);
      const ledger = await EX.executionLedgerRows(e.office, e.execution.id);
      expect(ledger.length).toBe(2);
      expect(ledger.every(row => row.category === 'expense')).toBe(true);
      expect(ledger.find(row => row.type === 'EXECUTION_FEE').includeInPoa).toBe(true);
      expect(ledger.find(row => row.type === 'STAMP').includeInPoa).toBe(false);
      const breakdown = await L.ledgerBreakdown(e.office, e.execution.id);
      expect(round2(breakdown.expenses)).toBe(290);
      expect(breakdown.expensesInPoa).toBe(250);
    } finally { closeEnv(e); }
  });

  // ===== 6) محاضر التحصيل والتخصيص =====
  test('تنفيذ/محضر: ترقيم RC-YYYY-#### مع حركة تحصيل وتخصيصات في معاملة واحدة', async () => {
    const e = await familyFixture();
    try {
      const first = await L.recordCollection(e.office, {executionId: e.execution.id, amount: 1000, date: '2025-02-10', allocation: {method: 'MANUAL', targets: [{periodKey: 'نفقة شهرية::2025-01-01', amount: 1000}]}});
      const second = await L.recordCollection(e.office, {executionId: e.execution.id, amount: 500, date: '2025-03-10', allocation: {method: 'MANUAL', targets: [{periodKey: 'نفقة شهرية::2025-01-01', amount: 500}]}});
      expect(first.receipt.receiptNumber).toBe('RC-2025-0001');
      expect(second.receipt.receiptNumber).toBe('RC-2025-0002');
      expect(first.receipt.ledgerId).toBe(first.ledger.id);
      expect(first.allocations.length).toBe(1);
      expect(first.allocations[0].periodKey).toBe('نفقة شهرية::2025-01-01');
      expect(first.ledger.type).toBe('COLLECTION');
      const stored = await e.office.r.executionReceipts.get(first.receipt.id);
      expect(stored.amount).toBe(1000);
    } finally { closeEnv(e); }
  });
  test('تنفيذ/تخصيص: منع تجاوز المتبقي ومنع فترة غير موجودة ومنع التخصيص المزدوج', async () => {
    const e = await familyFixture();
    try {
      const over = await rejects(() => L.recordCollection(e.office, {executionId: e.execution.id, amount: 5000, date: '2025-02-10', allocation: {method: 'MANUAL', targets: [{periodKey: 'نفقة شهرية::2025-01-01', amount: 5000}]}}));
      expect(over.code).toBe(ERR.VALIDATION);
      const ghost = await rejects(() => L.recordCollection(e.office, {executionId: e.execution.id, amount: 100, date: '2025-02-10', allocation: {method: 'MANUAL', targets: [{periodKey: 'غير موجود::2025-01-01', amount: 100}]}}));
      expect(ghost.code).toBe(ERR.VALIDATION);
      const doubled = await rejects(() => L.recordCollection(e.office, {executionId: e.execution.id, amount: 2000, date: '2025-02-10', allocation: {method: 'MANUAL', targets: [{periodKey: 'نفقة شهرية::2025-01-01', amount: 1500}, {periodKey: 'نفقة شهرية::2025-01-01', amount: 1500}]}}));
      expect(doubled.code).toBe(ERR.VALIDATION);
      expect((await EX.executionLedgerRows(e.office, e.execution.id)).length).toBe(0);
    } finally { closeEnv(e); }
  });
  test('تنفيذ/تخصيص: التخصيص المباشر بلا مبالغ يملأ الأقدم مع تحذير صريح (وليست قاعدة قانونية)', async () => {
    const e = await familyFixture();
    try {
      const out = await L.recordCollection(e.office, {executionId: e.execution.id, amount: 5000, date: '2025-02-10', allocation: {method: 'DIRECT'}});
      expect(out.allocations.length >= 2).toBe(true);
      expect(round2(out.allocations.reduce((s, a) => s + a.amount, 0))).toBe(5000);
      expect(out.warnings.some(w => w.code === 'direct_default_order')).toBe(true);
      expect(out.allocations[0].method).toBe('DIRECT');
    } finally { closeEnv(e); }
  });
  test('تنفيذ/تخصيص: التناسب (PROPORTIONAL) يوزّع بلا كسور ولا تجاوز، وحسب المستحق (BY_PARTY) يقصر على طرفه', async () => {
    const e = await familyFixture();
    try {
      const proportional = await L.recordCollection(e.office, {executionId: e.execution.id, amount: 3000, date: '2025-02-11', allocation: {method: 'PROPORTIONAL'}});
      const total = round2(proportional.allocations.reduce((s, a) => s + a.amount, 0));
      expect(total).toBe(3000);
      const partyCreditor = await EX.saveExecutionParty(e.office, {executionId: e.execution.id, clientId: e.client.id, side: 'creditor'});
      const j3 = await EX.addExecutionJudgment(e.office, {executionId: e.execution.id, entitlementType: 'نفقة الأبناء', judgmentDate: '2025-02-01', valueType: 'periodic', periodicity: 'monthly', amount: 1500, effectiveFrom: '2025-01-01'});
      await EX.saveValueSlice(e.office, {executionId: e.execution.id, judgmentId: j3.id, entitlementType: 'نفقة الأبناء', valueType: 'periodic', periodicity: 'monthly', amount: 1500, startDate: '2025-01-01', partyId: partyCreditor.id});
      const byParty = await L.recordCollection(e.office, {executionId: e.execution.id, amount: 1000, date: '2025-02-12', allocation: {method: 'BY_PARTY', partyId: partyCreditor.id}});
      expect(byParty.allocations.length >= 1).toBe(true);
      expect(byParty.allocations.every(a => a.method === 'BY_PARTY')).toBe(true);
      expect(byParty.allocations.every(a => a.executionPartyId === partyCreditor.id)).toBe(true);
      expect(byParty.allocations.every(a => a.entitlementType === 'نفقة الأبناء')).toBe(true);
      expect(round2(byParty.allocations.reduce((s2, a) => s2 + a.amount, 0))).toBe(1000);
      const unattributed = await L.recordCollection(e.office, {executionId: e.execution.id, amount: 50, date: '2025-02-13', allocation: {method: 'BY_PARTY', partyId: 'NOPE'}});
      expect(unattributed.unallocated).toBe(50);
      expect(unattributed.warnings.some(w => w.code === 'no_party_periods')).toBe(true);
    } finally { closeEnv(e); }
  });
  test('تنفيذ/تخصيص: لا افتراض تلقائي لطريقة FIFO في أي حركة', async () => {
    const e = await familyFixture();
    try {
      const out = await L.recordCollection(e.office, {executionId: e.execution.id, amount: 1000, date: '2025-02-13', allocation: {method: 'MANUAL', targets: [{periodKey: 'نفقة شهرية::2025-05-01', amount: 1000}]}});
      expect(out.allocations[0].method).toBe('MANUAL');
      expect(out.allocations[0].periodKey).toBe('نفقة شهرية::2025-05-01');
      expect(E.ALLOCATION_METHOD_LABELS.FIFO).toContain('الأقدم');
      expect((await e.office.r.executionReceipts.get(out.receipt.id)).allocationMethod).toBe('MANUAL');
    } finally { closeEnv(e); }
  });
  test('تنفيذ/تخصيص: تحصيل زائد أو غير مخصص يظهر رصيدًا سالبًا/غير مخصص مع تنبيه تنظيمي', async () => {
    const e = await familyFixture();
    try {
      const out = await L.recordCollection(e.office, {executionId: e.execution.id, amount: 100, date: '2025-02-14', allocation: {method: 'MANUAL', targets: []}});
      expect(out.unallocated).toBe(100);
      const balance = await B.executionBalance(e.office, e.execution.id);
      expect(balance.summary.unallocated).toBe(100);
      const codes = (await B.executionAlertsFor(e.office, e.execution.id)).map(alert => alert.code);
      expect(codes.includes('unallocated_collection')).toBe(true);
    } finally { closeEnv(e); }
  });
  test('تنفيذ/محضر: تعديل المبلغ أو التاريخ بعد التسجيل ممنوع، والبيانات الوصفية مسموحة', async () => {
    const e = await familyFixture();
    try {
      const out = await L.recordCollection(e.office, {executionId: e.execution.id, amount: 1000, date: '2025-02-15', allocation: {method: 'FIFO'}});
      const amountEdit = await rejects(() => L.updateReceiptDetails(e.office, out.receipt.id, {amount: 2000}));
      expect(amountEdit.code).toBe(ERR.CONFLICT);
      const dateEdit = await rejects(() => L.updateReceiptDetails(e.office, out.receipt.id, {date: '2025-02-20'}));
      expect(dateEdit.code).toBe(ERR.CONFLICT);
      const ok = await L.updateReceiptDetails(e.office, out.receipt.id, {notes: 'تم التصحيح باسم المحصّل'});
      expect(ok.notes.length > 0).toBe(true);
      expect(ok.amount).toBe(1000);
    } finally { closeEnv(e); }
  });
  test('تنفيذ/إعادة تخصيص: الصفوف القديمة تُعلَّم غير فعّالة ولا تُحذف', async () => {
    const e = await familyFixture();
    try {
      const out = await L.recordCollection(e.office, {executionId: e.execution.id, amount: 1000, date: '2025-02-16', allocation: {method: 'MANUAL', targets: [{periodKey: 'نفقة شهرية::2025-01-01', amount: 1000}]}});
      const moved = await L.reallocateReceipt(e.office, out.receipt.id, {method: 'MANUAL', targets: [{periodKey: 'نفقة شهرية::2025-02-01', amount: 1000}]});
      expect(moved.allocations.length).toBe(1);
      expect(moved.allocations[0].periodKey).toBe('نفقة شهرية::2025-02-01');
      const stored = await EX.executionAllocations(e.office, e.execution.id);
      expect(stored.filter(row => row.isActive === false).length).toBe(1);
      expect(stored.length).toBe(2);
    } finally { closeEnv(e); }
  });

  // ===== 7) محرك الرصيد والتتبع واللقطة والمحاكي =====
  test('تنفيذ/رصيد: التفكيك الكامل مع معادلات ظاهرة لكل رقم', async () => {
    const e = await familyFixture();
    try {
      await L.recordCollection(e.office, {executionId: e.execution.id, amount: 2000, date: '2025-03-01', allocation: {method: 'MANUAL', targets: [{periodKey: 'نفقة شهرية::2025-01-01', amount: 2000}]}});
      const created = await DF.createSettlement(e.office, {executionId: e.execution.id, sliceId: e.s2.id});
      await DF.decideSettlement(e.office, created.settlement.id, {decision: 'approve', reason: 'اعتماد المراجعة'});
      await DF.postSettlement(e.office, created.settlement.id);
      const balance = await B.executionBalance(e.office, e.execution.id);
      expect(balance.summary.finalEntitlement).toBe(42000);
      expect(balance.summary.originalEntitlement).toBe(36000);
      expect(balance.summary.collected).toBe(2000);
      expect(balance.summary.remaining).toBe(40000);
      expect(balance.summary.originalOutstanding).toBe(34000);
      expect(balance.summary.differencePart).toBe(6000);
      expect(round2(balance.summary.originalOutstanding + balance.summary.differencePart)).toBe(balance.summary.remaining);
      expect(balance.equations.join(' | ').includes('42000')).toBe(true);
      expect(balance.summary.equations.some(line => line.includes('الرصيد:'))).toBe(true);
      expect(balance.summary.currentValue.amount).toBe(4000);
      expect(balance.summary.lastPeriod.key).toBe('نفقة شهرية::2025-12-01');
    } finally { closeEnv(e); }
  });
  test('تنفيذ/تتبع: شجرة من الحكم إلى الفترة ثم المحضر ثم التخصيص', async () => {
    const e = await familyFixture();
    try {
      const out = await L.recordCollection(e.office, {executionId: e.execution.id, amount: 1200, date: '2025-04-02', allocation: {method: 'MANUAL', targets: [{periodKey: 'نفقة شهرية::2025-01-01', amount: 1200}]}});
      const balance = await B.executionBalance(e.office, e.execution.id);
      const trace = balance.trace;
      expect(trace.label.length > 0).toBe(true);
      const flat = [];
      const walk = node => { flat.push(node); (node.children || []).forEach(walk); };
      walk(trace);
      expect(flat.some(node => String(node.label).includes('نفقة شهرية::2025-01-01'))).toBe(true);
      expect(flat.some(node => String(node.label).includes(out.receipt.receiptNumber))).toBe(true);
      expect(flat.some(node => String(node.label).includes('تخصيص'))).toBe(true);
      expect(flat.some(node => node.meta && node.meta.periodKey === 'نفقة شهرية::2025-01-01')).toBe(true);
      expect(flat.some(node => String(node.label).includes('حكم'))).toBe(true);
    } finally { closeEnv(e); }
  });
  test('تنفيذ/لقطة: الرصيد في 2025-06-30 (18000 − 2000 = 16000) ولا تتأثر بالشرائح اللاحقة', async () => {
    const e = await familyFixture();
    try {
      await L.recordCollection(e.office, {executionId: e.execution.id, amount: 2000, date: '2025-03-01', allocation: {method: 'MANUAL', targets: [{periodKey: 'نفقة شهرية::2025-02-01', amount: 2000}]}});
      const snapshot = await B.balanceSnapshot(e.office, e.execution.id, '2025-06-30');
      expect(snapshot.summary.finalEntitlement).toBe(18000);
      expect(snapshot.summary.collected).toBe(2000);
      expect(snapshot.summary.remaining).toBe(16000);
      expect(snapshot.summary.originalOutstanding).toBe(16000);
      expect(snapshot.summary.differencePart).toBe(0);
      expect(snapshot.summary.dateBasis).toBe('event-dates');
      expect(snapshot.note.includes('2025-06-30')).toBe(true);
      const bad = await rejects(() => B.balanceSnapshot(e.office, e.execution.id, '30/06/2025'));
      expect(Boolean(bad.details?.date)).toBe(true);
    } finally { closeEnv(e); }
  });
  test('تنفيذ/محاكي: «ماذا لو» لا يكتب أي سجل ولا يغيّر الرصيد', async () => {
    const e = await familyFixture();
    try {
      const before = {ledger: await e.office.r.executionLedger.count(), slices: await e.office.r.executionValuePeriods.count(), judgments: await e.office.r.judgments.count(), differences: await e.office.r.differenceRecords.count()};
      const simulation = await B.simulateValueChange(e.office, {executionId: e.execution.id, entitlementType: 'نفقة شهرية', amount: 5000, effectiveFrom: '2025-10-01', throughDate: '2025-12-31'});
      expect(simulation.rows.length).toBe(3);
      expect(simulation.totals.difference > 0).toBe(true);
      expect(simulation.warning.includes('محاكاة')).toBe(true);
      const after = {ledger: await e.office.r.executionLedger.count(), slices: await e.office.r.executionValuePeriods.count(), judgments: await e.office.r.judgments.count(), differences: await e.office.r.differenceRecords.count()};
      expect(JSON.stringify(before)).toBe(JSON.stringify(after));
    } finally { closeEnv(e); }
  });
  test('تنفيذ/مقارنة: مقارنة حكمين تعرض الفروق لكل فترة بلا تعديل بيانات', async () => {
    const e = await familyFixture();
    try {
      const comparison = await B.compareJudgments(e.office, e.execution.id, e.j1.id, e.j2.id);
      expect(comparison.first.amount).toBe(3000);
      expect(comparison.second.amount).toBe(4000);
      expect(comparison.impact.length).toBe(6);
      expect(comparison.rows.some(row => row.label === 'القيمة')).toBe(true);
      expect(round2(comparison.impact.reduce((sum, row) => sum + row.difference, 0))).toBe(6000);
      expect(comparison.rows.find(row => row.label === 'الفرق الناتج').second).toBe(6000);
      expect((await e.office.r.judgments.get(e.j1.id)).amount).toBe(3000);
    } finally { closeEnv(e); }
  });
  test('تنفيذ/زمني: الخط الزمني يُقرأ من سجل النشاط مع إكمال السجلات غير الموثقة', async () => {
    const e = await familyFixture();
    try {
      const timeline = await B.executionTimeline(e.office, e.execution.id, {limit: 50});
      expect(timeline.length > 0).toBe(true);
      expect(timeline.every(item => item.id && item.title && item.kind)).toBe(true);
      const logged = await e.office.r.activityLog.byIndexAll('entityId', e.execution.id, 200).catch(() => []);
      expect(logged.length > 0).toBe(true);
    } finally { closeEnv(e); }
  });

  // ===== 8) التوكيلات والإجراءات =====
  test('تنفيذ/توكيل: إعادة توكيل 27000 + 30000 = 57000 مع مصدر كل جزء', async () => {
    const e = await env({through: '2025-12-31'});
    try {
      const j = await EX.addExecutionJudgment(e.office, {executionId: e.execution.id, entitlementType: 'نفقة شهرية', judgmentDate: '2024-12-20', valueType: 'periodic', periodicity: 'monthly', amount: 3000, effectiveFrom: '2024-05-01', effectiveTo: '2025-01-31'});
      await EX.saveValueSlice(e.office, {executionId: e.execution.id, judgmentId: j.id, entitlementType: 'نفقة شهرية', valueType: 'periodic', periodicity: 'monthly', amount: 3000, startDate: '2024-05-01', endDate: '2025-01-31'});
      const firstDraft = await POA.buildPoaDraft(e.office, {executionId: e.execution.id, fromDate: '2024-05-01', toDate: '2025-01-31'});
      const previousPoa = await POA.saveExecutionPoa(e.office, firstDraft);
      expect(previousPoa.total).toBe(27000);
      const j2 = await EX.addExecutionJudgment(e.office, {executionId: e.execution.id, entitlementType: 'نفقة شهرية', judgmentKind: 'later', judgmentDate: '2025-02-02', valueType: 'periodic', periodicity: 'monthly', amount: 3000, effectiveFrom: '2025-02-01'});
      await EX.saveValueSlice(e.office, {executionId: e.execution.id, judgmentId: j2.id, entitlementType: 'نفقة شهرية', valueType: 'periodic', periodicity: 'monthly', amount: 3000, startDate: '2025-02-01'});
      const draft = await POA.buildPoaDraft(e.office, {executionId: e.execution.id, previousPoaId: previousPoa.id, fromDate: '2025-02-01', toDate: '2025-11-30'});
      expect(draft.previousPoa.id).toBe(previousPoa.id);
      const previousLine = draft.lines.find(line => line.key === 'previousBalance');
      const periodLines = draft.lines.filter(line => line.sourceType === 'period');
      expect(previousLine.amount).toBe(27000);
      expect(round2(periodLines.reduce((s, l) => s + l.amount, 0))).toBe(30000);
      expect(draft.totals.total).toBe(57000);
      expect(previousLine.detail.includes('الرصيد')).toBe(true);
      expect(periodLines.every(line => line.sourceIds.length === 1 && line.detail.includes('حكم'))).toBe(true);
      const saved = await POA.saveExecutionPoa(e.office, draft);
      expect(saved.total).toBe(57000);
      expect(saved.kind).toBe('reissue');
      expect(saved.previousPoaId).toBe(previousPoa.id);
      expect(saved.poaNumber.startsWith('POA-')).toBe(true);
    } finally { closeEnv(e); }
  });
  test('تنفيذ/توكيل: لا يُدرج الفرق المعتمد في توكيلين (تعليم المعرّف بعد الإدراج)', async () => {
    const e = await familyFixture();
    try {
      const created = await DF.createSettlement(e.office, {executionId: e.execution.id, sliceId: e.s2.id});
      await DF.decideSettlement(e.office, created.settlement.id, {decision: 'approve', reason: 'اعتماد'});
      await DF.postSettlement(e.office, created.settlement.id);
      const first = await POA.buildPoaDraft(e.office, {executionId: e.execution.id, fromDate: '2025-01-01', toDate: '2025-12-31', includeDifferences: true});
      const differenceLine = first.lines.find(line => line.key === 'differences');
      expect(differenceLine.amount).toBe(6000);
      await POA.saveExecutionPoa(e.office, first);
      const second = await POA.buildPoaDraft(e.office, {executionId: e.execution.id, fromDate: '2025-01-01', toDate: '2025-12-31', includeDifferences: true});
      expect(second.lines.find(line => line.key === 'differences').amount).toBe(0);
      const detail = await POA.poaDetail(e.office, (await EX.executionPoaRows(e.office, e.execution.id))[0].id);
      expect(detail.poa.total).toBe(first.totals.total);
    } finally { closeEnv(e); }
  });
  test('تنفيذ/إجراءات: حجز/إعلان بيع/جلسة بيع/تبديد/رقم عرائض/رقم قضائي بلا سير عمل مفروض', async () => {
    const e = await env();
    try {
      for (const kind of ['seizure', 'sale_notice', 'sale_session', 'dissipation', 'petition_number', 'judicial_number']) {
        await EX.saveExecutionAction(e.office, {executionId: e.execution.id, kind, date: '2025-03-01', referenceNumber: `REF-${kind}`});
      }
      const rows = await EX.executionActionRows(e.office, e.execution.id);
      expect(rows.length).toBe(6);
      expect(rows.every(row => row.fileId === e.file.id)).toBe(true);
      const codes = (await B.executionAlertsFor(e.office, e.execution.id)).map(a => a.code);
      expect(codes.includes('petition_without_judicial_number')).toBe(false);
      const error = await rejects(() => EX.saveExecutionAction(e.office, {executionId: e.execution.id, kind: 'غير معروف', date: '2025-03-01'}));
      expect(Boolean(error.details?.kind)).toBe(true);
    } finally { closeEnv(e); }
  });
  test('تنفيذ/إجراءات: ملف ناتج يُنشأ بعلاقة ناتج عن بلا تغيير أي ترقيم قديم', async () => {
    const e = await env();
    try {
      const action = await EX.saveExecutionAction(e.office, {executionId: e.execution.id, kind: 'dissipation', date: '2025-03-05', referenceNumber: 'D-1'});
      const created = await EX.createResultFile(e.office, {executionId: e.execution.id, actionId: action.id, title: 'ملف جنائي ناتج عن التبديد', fileType: 'جنائي'});
      expect(created.file.id && created.file.id !== e.file.id).toBe(true);
      expect(Boolean(created.relation)).toBe(true);
      const updated = await e.office.r.executionActions.get(action.id);
      expect(updated.resultFileId).toBe(created.file.id);
      const original = await e.office.r.files.get(e.file.id);
      expect(original.fileNumber.length > 0).toBe(true);
    } finally { closeEnv(e); }
  });

  // ===== 9) المؤشرات والقوائم والتنبيهات =====
  test('تنفيذ/مؤشرات: كل مؤشر يفتح مجموعة مفلترة من التنفيذات', async () => {
    const e = await familyFixture();
    try {
      await L.recordCollection(e.office, {executionId: e.execution.id, amount: 1000, date: '2025-03-03', allocation: {method: 'MANUAL', targets: [{periodKey: 'نفقة شهرية::2025-01-01', amount: 1000}]}});
      const created = await DF.createSettlement(e.office, {executionId: e.execution.id, sliceId: e.s2.id});
      const partial = await B.executionsForKpi(e.office, {kpi: 'partialCollection'});
      expect(partial.rows.length).toBe(1);
      const review = await B.executionsForKpi(e.office, {kpi: 'settlementsReview'});
      expect(review.rows.length).toBe(1);
      const differences = await B.executionsForKpi(e.office, {kpi: 'differencesUnpaid'});
      expect(differences.rows.length).toBe(1);
      const all = await B.executionsForKpi(e.office, {kpi: 'all'});
      expect(all.rows.length).toBe(1);
      const none = await B.executionsForKpi(e.office, {kpi: 'completed'});
      expect(none.rows.length).toBe(0);
      const stats = await EX.executionCenterStats(e.office);
      expect(stats.byType.family).toBe(1);
      expect(stats.settlementsAwaitingReview).toBe(1);
      expect(created.settlement.status).toBe('PENDING_REVIEW');
    } finally { closeEnv(e); }
  });
  test('تنفيذ/قائمة: صف واحد لكل تنفيذ بأعمدة عامة (بلا دمج رقم الملف والموكل والخصم)', async () => {
    const e = await familyFixture();
    try {
      const rows = await EX.listExecutionRows(e.office, {limit: 10});
      expect(rows.rows.length).toBe(1);
      const row = rows.rows[0];
      expect(row.internalNumber.startsWith('EX-')).toBe(true);
      expect(row.clientName).toBe(e.client.fullName);
      expect(row.fileNumber).toBe(e.file.fileNumber);
      expect(row.executionTypeLabel.includes('الأسرة')).toBe(true);
      expect(round2(row.currentValue)).toBe(4000);
      expect(row.lastPeriod).toBe('نفقة شهرية::2025-12-01');
      expect(round2(row.collected)).toBe(0);
      expect(round2(row.balance)).toBe(42000);
      expect(round2(row.judgmentDifference)).toBe(6000);
      expect(row.statusLabel.length > 0).toBe(true);
      expect(rows.total >= 1).toBe(true);
      const summary = await EX.summarizeExecution(e.office, e.execution);
      expect(round2(summary.finalEntitlement)).toBe(42000);
    } finally { closeEnv(e); }
  });
  test('تنفيذ/تنبيهات: تنبيهات تنظيمية فقط بلا وصف مخالفة أو استحقاق قانوني قطعي', async () => {
    const e = await env();
    try {
      const alerts = await B.executionAlertsFor(e.office, e.execution.id);
      const text = alerts.map(alert => alert.message).join(' | ');
      for (const forbidden of ['مخالفة', 'يُعد جريمة', 'يحق لك قانونًا', 'ألزم القانون', 'حكم نهائي واجب']) expect(text.includes(forbidden)).toBe(false);
      expect(alerts.some(alert => alert.code === 'missing_value')).toBe(true);
      expect(alerts.every(alert => ['info', 'warn'].includes(alert.severity))).toBe(true);
      const withSlice = await familyFixture();
      try {
        const codes = (await B.executionAlertsFor(withSlice.office, withSlice.execution.id)).map(a => a.code);
        expect(codes.includes('missing_value')).toBe(false);
      } finally { closeEnv(withSlice); }
    } finally { closeEnv(e); }
  });

  // ===== 10) الطباعة والبحث والترحيل والنسخ الاحتياطي =====
  test('تنفيذ/طباعة: قوالب افتراضية قابلة للتعديل والاسترجاع وبناء مستندَي التوكيل والرصيد', async () => {
    const e = await familyFixture();
    try {
      const templates = await PR.templatesFor(e.office);
      expect(templates.length).toBe(2);
      const kinds = templates.map(t => t.kind).sort().join(',');
      expect(kinds).toBe('balance,poa');
      const edited = await PR.saveTemplate(e.office, {kind: 'poa', title: 'قالب مكتبي', body: '<h1>{{executionNumber}}</h1><p>{{total}}</p>'});
      expect(edited.body.includes('{{total}}')).toBe(true);
      const render = PR.renderTemplate(edited, {executionNumber: 'EX-1', total: 57000});
      expect(render.body.includes('EX-1') && render.body.includes('57000')).toBe(true);
      expect(render.title.includes('{{') === false).toBe(true);
      await PR.resetTemplate(e.office, 'poa');
      const back = (await PR.templatesFor(e.office)).find(t => t.kind === 'poa');
      expect(back.body.includes('{{') === true || back.body.length > 0).toBe(true);
      const out = await L.recordCollection(e.office, {executionId: e.execution.id, amount: 1000, date: '2025-04-04', allocation: {method: 'MANUAL', targets: [{periodKey: 'نفقة شهرية::2025-01-01', amount: 1000}]}});
      const draft = await POA.buildPoaDraft(e.office, {executionId: e.execution.id, fromDate: '2025-01-01', toDate: '2025-06-30', stampAmount: 25});
      const poa = await POA.saveExecutionPoa(e.office, draft);
      poa.receiptId = out.receipt.id;
      const poaDocument = await PR.buildPoaDocument(e.office, poa.id);
      expect(poaDocument.html.includes(poa.poaNumber)).toBe(true);
      expect(String(poaDocument.html).includes('<') === true).toBe(true);
      const balanceDocument = await PR.buildBalanceDocument(e.office, e.execution.id);
      expect(balanceDocument.html.includes('42000')).toBe(true);
      expect(balanceDocument.html.includes(e.client.fullName)).toBe(true);
      expect(balanceDocument.data.periods.length > 0).toBe(true);
    } finally { closeEnv(e); }
  });
  test('تنفيذ/بحث شامل: العثور على التنفيذ باسم الموكل، ورقم المحضر، ورقم التوكيل، والرقم الرسمي', async () => {
    const e = await familyFixture();
    try {
      await EX.refreshExecutionSearchText(e.office, e.execution.id);
      const byName = await searchStore(e.office, 'execution', 'موكل التنفيذ', {limit: 5});
      expect(byName.items.length).toBe(1);
      const out = await L.recordCollection(e.office, {executionId: e.execution.id, amount: 700, date: '2025-05-05', allocation: {method: 'FIFO'}});
      const byOfficial = await searchStore(e.office, 'execution', '1201', {limit: 5});
      expect(byOfficial.items.length).toBe(1);
      const byReceipt = await searchStore(e.office, 'executionReceipts', out.receipt.receiptNumber, {limit: 5});
      expect(byReceipt.items.length).toBe(1);
      expect(byReceipt.items[0].route).toBe(`exc:${e.execution.id}`);
      const draft = await POA.buildPoaDraft(e.office, {executionId: e.execution.id, fromDate: '2025-01-01', toDate: '2025-12-31'});
      const poa = await POA.saveExecutionPoa(e.office, draft);
      const byPoa = await searchStore(e.office, 'executionPOAs', poa.poaNumber, {limit: 5});
      expect(byPoa.items.length).toBe(1);
    } finally { closeEnv(e); }
  });
  test('تنفيذ/ترحيل: حقول إضافية بلا اختراع تواريخ + علامة مراجعة + idempotent', async () => {
    const e = await env();
    try {
      const legacy = {id: 'LEG-1', executionNumber: '500/2019', executionYear: 2019, caseId: '', openedDate: '2019-04-01', status: 'جارٍ', notes: 'سجل قديم بلا نوع', createdAt: '2019-04-01T00:00:00.000Z', updatedAt: '2019-04-01T00:00:00.000Z', version: 1, isDeleted: false};
      await e.office.r.execution.put(legacy);
      const first = await MIG.migrateExecutionData(e.office, {batchSize: 50});
      expect(first.scanned >= 1).toBe(true);
      const row = await e.office.r.execution.get('LEG-1');
      expect(row.executionType === undefined || row.executionType === '').toBe(true);
      expect(row.needsReview).toBe(true);
      expect(row.reviewReasons.includes('missing_execution_type')).toBe(true);
      expect(row.judgmentDate === undefined || row.judgmentDate === '').toBe(true);
      expect(row.openedDate).toBe('2019-04-01');
      expect(row.executionNumber).toBe('500/2019');
      expect(row.id).toBe('LEG-1');
      expect(row.searchTextNormalized !== undefined).toBe(true);
      const second = await MIG.migrateExecutionData(e.office, {batchSize: 50});
      expect(second.alreadyComplete).toBe(true);
      expect(second.updated).toBe(0);
      const report = await MIG.executionReviewReport(e.office, {limit: 10});
      expect(report.length >= 1).toBe(true);
      expect(MIG.reviewReasonLabels(report[0].reasons)[0].length > 0).toBe(true);
    } finally { closeEnv(e); }
  });
  test('تنفيذ/مخطط: v15 إضافي غير مدمر + النسخ الاحتياطي يشمل المخازن الجديدة', async () => {
    expect(SCHEMA_VERSION).toBe(17);
    expect(SCHEMA_MIGRATIONS.some(m => m.version === 15 && m.addsStores.includes('executionLedger'))).toBe(true);
    expect(SCHEMA_MIGRATIONS.some(m => m.version === 17 && m.addsStores.includes('executionPeriods') && !m.destructive && !m.backfill)).toBe(true);
    const plan = migrationPlan(14, 15);
    expect(plan.destructive).toBe(false);
    expect(plan.addsStores.includes('differenceRecords')).toBe(true);
    expect(STORES.includes('executionSettlements')).toBe(true);
    expect(STORES.includes('executionTemplates')).toBe(true);
    const e = await env();
    try {
      const {exportDatabase, importDatabase} = await import('../services/backup.js');
      const payload = await exportDatabase(e.office.ctx);
      expect(Array.isArray(payload.stores.executionLedger)).toBe(true);
      expect(payload.manifest.storeNames.includes('executionAllocations')).toBe(true);
      const name = `AhmadKhudairLawOfficeDB__test__execRestore__${Date.now()}`;
      const db2 = await openDb(name);
      const office2 = new Office({db: db2, assert() {}, token: 'r', profile: {id: 'r'}});
      try {
        await importDatabase(office2.ctx, payload);
        expect(await office2.r.execution.count()).toBe(1);
        expect(await office2.r.executionValuePeriods.count()).toBe(0);
      } finally { db2.close(); indexedDB.deleteDatabase(name); }
    } finally { closeEnv(e); }
  });
  test('تنفيذ/تخزين: لا سجلات فترات تُنشأ مسبقًا في قاعدة البيانات (توليد كسول فعليًا)', async () => {
    const e = await familyFixture();
    try {
      expect(await e.office.r.executionValuePeriods.count()).toBe(2);
      expect(await e.office.r.executionReceipts.count()).toBe(0);
      const balance = await B.executionBalance(e.office, e.execution.id);
      expect(balance.summary.periods.length).toBe(12);
      expect(await e.office.r.executionValuePeriods.count()).toBe(2);
      expect(Object.values(STORE).includes('executionPeriods')).toBe(true);
      expect(await e.office.r.executionPeriods.count()).toBe(0);
    } finally { closeEnv(e); }
  });
  test('تنفيذ/رسائل: كل رفض يعيد رسالة عربية واضحة بلا نص إنجليزي مكشوف', async () => {
    const e = await env();
    try {
      const cases = [
        await rejects(() => L.addLedgerEntry(e.office, {executionId: e.execution.id, type: 'COLLECTION', amount: 0, date: '2025-01-01'})),
        await rejects(() => L.recordCollection(e.office, {executionId: e.execution.id, amount: -10, date: '2025-01-01'})),
        await rejects(() => L.recordCollection(e.office, {executionId: e.execution.id, amount: 10, date: ''})),
        await rejects(() => EX.saveValueSlice(e.office, {executionId: e.execution.id, judgmentId: 'NOPE', entitlementType: 'نفقة', amount: 100, startDate: '2025-01-01'})),
        await rejects(() => DF.previewImpact(e.office, {executionId: e.execution.id, sliceId: 'NOPE'}))
      ];
      for (const error of cases) {
        expect(typeof error.message).toBe('string');
        expect(error.message.length > 3).toBe(true);
        expect(/[A-Za-z]{6,}/.test(error.message)).toBe(false);
      }
    } finally { closeEnv(e); }
  });
  test('تنفيذ/أداء: فتح المسافات الكبيرة محكوم بحدود قراءة وفحص truncated', async () => {
    const e = await familyFixture();
    try {
      const rows = await EX.executionLedgerRows(e.office, e.execution.id, 5);
      expect(Array.isArray(rows)).toBe(true);
      expect(Number(E.EXECUTION_LIMITS.periods) > 0).toBe(true);
      const page = await e.office.r.executionLedger.page({limit: 10, index: 'a', upper: [e.execution.id, '9999-12-31'], lower: [e.execution.id, '0000-01-01']});
      expect(page.items.length <= 10).toBe(true);

    } finally { closeEnv(e); }
  });
  test('تنفيذ/لقطة: لا تُمدَّد الفترات بعد تاريخ نهاية الاستحقاق المعلن في التنفيذ', async () => {
    const e = await env();
    try {
      const j = await EX.addExecutionJudgment(e.office, {executionId: e.execution.id, entitlementType: 'نفقة شهرية', judgmentDate: '2025-01-10', valueType: 'periodic', periodicity: 'monthly', amount: 3000, effectiveFrom: '2025-01-01'});
      await EX.saveValueSlice(e.office, {executionId: e.execution.id, judgmentId: j.id, entitlementType: 'نفقة شهرية', valueType: 'periodic', periodicity: 'monthly', amount: 3000, startDate: '2025-01-01'});
      const snapshot = await B.balanceSnapshot(e.office, e.execution.id, '2026-06-30');
      expect(snapshot.summary.finalEntitlement).toBe(36000);
      expect(snapshot.summary.periodCount).toBe(12);
      expect(snapshot.periods.every(period => period.start <= '2025-12-01')).toBe(true);
    } finally { closeEnv(e); }
  });

  test('تنفيذ/تخصيص: التخصيص على فترة غير موجودة يُرفض صراحةً (لا تخصيص لصمت)', async () => {
    const e = await env();
    try {
      const j = await EX.addExecutionJudgment(e.office, {executionId: e.execution.id, entitlementType: 'نفقة شهرية', judgmentDate: '2025-01-10', valueType: 'periodic', periodicity: 'monthly', amount: 3000, effectiveFrom: '2025-01-01'});
      await EX.saveValueSlice(e.office, {executionId: e.execution.id, judgmentId: j.id, entitlementType: 'نفقة شهرية', valueType: 'periodic', periodicity: 'monthly', amount: 3000, startDate: '2025-01-01'});
      const error = await rejects(() => L.recordCollection(e.office, {executionId: e.execution.id, amount: 500, date: '2025-02-01', allocation: {method: 'MANUAL', targets: [{periodKey: 'فترة وهمية::2099-01-01', amount: 500}]}}));
      expect(error.code).toBe(ERR.VALIDATION);
      expect(String(error.message)).toContain('لا توجد فترة استحقاق');
      const ledger = await EX.executionLedgerRows(e.office, e.execution.id);
      expect(ledger.length).toBe(0);
    } finally { closeEnv(e); }
  });

  test('تنفيذ/مؤشرات: «فروق غير مسددة» تشمل ما ينتظر المراجعة وما اعتُمد ولم يُحصَّل', async () => {
    const e = await env();
    try {
      const j1 = await EX.addExecutionJudgment(e.office, {executionId: e.execution.id, entitlementType: 'نفقة شهرية', judgmentDate: '2025-01-10', valueType: 'periodic', periodicity: 'monthly', amount: 3000, effectiveFrom: '2025-01-01'});
      await EX.saveValueSlice(e.office, {executionId: e.execution.id, judgmentId: j1.id, entitlementType: 'نفقة شهرية', valueType: 'periodic', periodicity: 'monthly', amount: 3000, startDate: '2025-01-01'});
      const j2 = await EX.addExecutionJudgment(e.office, {executionId: e.execution.id, entitlementType: 'نفقة شهرية', judgmentKind: 'later', judgmentDate: '2025-07-20', valueType: 'periodic', periodicity: 'monthly', amount: 4000, effectiveFrom: '2025-07-01'});
      const s2 = await EX.saveValueSlice(e.office, {executionId: e.execution.id, judgmentId: j2.id, entitlementType: 'نفقة شهرية', valueType: 'periodic', periodicity: 'monthly', amount: 4000, startDate: '2025-07-01'});
      const created = await DF.createSettlement(e.office, {executionId: e.execution.id, sliceId: s2.id});
      const before = await B.executionsForKpi(e.office, {kpi: 'differencesUnpaid'});
      expect(before.rows.length).toBe(1);
      await DF.decideSettlement(e.office, created.settlement.id, {decision: 'approve'});
      const after = await B.executionsForKpi(e.office, {kpi: 'differencesUnpaid'});
      expect(after.rows.length).toBe(1);
      expect(after.rows[0].summary.differences.approved).toBe(6000);
      expect(after.rows[0].summary.differences.pending).toBe(0);
      expect(after.rows[0].summary.remaining).toBe(42000);
    } finally { closeEnv(e); }
  });

  test('تنفيذ/سلامة: فحص سلامة البيانات لا يجد مشكلات في سجلات التنفيذ الجديدة', async () => {
    const e = await env();
    try {
      const exec = e.execution;
      const j1 = await EX.addExecutionJudgment(e.office, {executionId: exec.id, entitlementType: 'نفقة شهرية', judgmentDate: '2025-01-10', valueType: 'periodic', periodicity: 'monthly', amount: 3000, effectiveFrom: '2025-01-01'});
      await EX.saveValueSlice(e.office, {executionId: exec.id, judgmentId: j1.id, entitlementType: 'نفقة شهرية', valueType: 'periodic', periodicity: 'monthly', amount: 3000, startDate: '2025-01-01'});
      const j2 = await EX.addExecutionJudgment(e.office, {executionId: exec.id, entitlementType: 'نفقة شهرية', judgmentKind: 'later', judgmentDate: '2025-07-20', valueType: 'periodic', periodicity: 'monthly', amount: 4000, effectiveFrom: '2025-07-01', previousJudgmentId: j1.id});
      const s2 = await EX.saveValueSlice(e.office, {executionId: exec.id, judgmentId: j2.id, entitlementType: 'نفقة شهرية', valueType: 'periodic', periodicity: 'monthly', amount: 4000, startDate: '2025-07-01'});
      await L.recordCollection(e.office, {executionId: exec.id, amount: 1000, date: '2025-03-03', allocation: {method: 'MANUAL', targets: [{periodKey: 'نفقة شهرية::2025-01-01', amount: 1000}]}});
      const settlement = await DF.createSettlement(e.office, {executionId: exec.id, sliceId: s2.id});
      await DF.decideSettlement(e.office, settlement.settlement.id, {decision: 'approve'});
      await DF.postSettlement(e.office, settlement.settlement.id);
      await L.recordExpense(e.office, {executionId: exec.id, type: 'EXECUTION_FEE', amount: 250, date: '2025-04-01', includeInPoa: true});
      await EX.saveExecutionAction(e.office, {executionId: exec.id, kind: 'seizure', date: '2025-04-02', referenceNumber: 'HZ-1'});
      await POA.saveExecutionPoa(e.office, {executionId: exec.id, total: 5000, baseAmount: 5000, lines: []});
      const health = await deepHealth(e.office.ctx, {scanRows: true});
      expect(health.relationIssues.filter(issue => String(issue.store).startsWith('execution') || issue.store === 'differenceRecords').length).toBe(0);
      expect(health.dataIssues.filter(issue => String(issue.store).startsWith('execution') || issue.store === 'differenceRecords').length).toBe(0);
    } finally { closeEnv(e); }
  });

  test('تنفيذ/ربط: تنفيذ جنائي ناتج عن التبديد يُسجَّل كملف مستقل بعلاقة بلا تعديل الملف الأصلي', async () => {
    const e = await env({executionType: 'criminal'});
    try {
      const action = await EX.saveExecutionAction(e.office, {executionId: e.execution.id, kind: 'dissipation', date: '2025-04-01', referenceNumber: 'TB-9'});
      const created = await EX.createResultFile(e.office, {executionId: e.execution.id, actionId: action.id, title: 'الملف الجنائي الناتج', fileType: 'جنائي'});
      expect(created.file.fileNumber !== e.file.fileNumber).toBe(true);
      const relations = await e.office.r.fileRelations.byIndexAll('fileId', e.file.id).catch(() => []);
      expect(relations.some(row => row.relatedFileId === created.file.id) || created.relation).toBeTruthy();
    } finally { closeEnv(e); }
  });

  // ===== FEAS: Golden Scenarios — explicit snapshots, minor units, audited deltas =====
  test('FEAS/Golden: minor units reject silent rounding; civil-period snapshot is explicit', () => {
    expect(toMinorUnits('120.50', 'EGP')).toBe(12050);
    expect(toMinorUnits('12.345', 'BHD')).toBe(12345);
    expect(() => toMinorUnits('1.001', 'EGP')).toThrow();
    expect(() => toMinorUnits('1.00', 'XYZ')).toThrow();
    const obligation = {id: 'ob-1', obligationType: 'نفقة كما وردت', currency: 'EGP', frequency: 'monthly', prorationPolicy: 'days', startDate: '2025-01-01'};
    const source = {id: 'slice-1', obligationId: 'ob-1', judgmentId: 'j-1', valueType: 'periodic', amountMinor: 300000, currency: 'EGP', startDate: '2025-01-01', status: 'active'};
    const result = FEAS.resolveExecutionClaim({obligation, valuePeriods: [source], fromDate: '2025-01-01', toDate: '2025-03-31'});
    expect(result.recognizedAmountMinor).toBe(900000);
    expect(result.segments.length).toBe(3);
    expect(result.segments[2].unitEnd).toBe('2025-03-31');
  });
  test('FEAS/Golden: لقطات اعتراف ثابتة، فرق الحكم يُعتمد مرة واحدة ولا ينشئ حركة أصل', async () => {
    const e = await feasFixture();
    try {
      const initial = await B.executionBalance(e.office, e.execution.id);
      expect(initial.summary.accountingModel).toBe(FEAS.FEAS_MODEL);
      expect(initial.summary.finalEntitlementMinor).toBe(900000);
      expect(initial.summary.periodCount).toBe(1);
      const repeated = await FEASApp.recognizeExecutionPeriod(e.office, {executionId: e.execution.id, obligationId: e.obligation.id, fromDate: '2025-01-01', toDate: '2025-03-31'});
      expect(repeated.row.id).toBe(e.period.id);
      expect((await FEASApp.executionRecognizedPeriods(e.office, e.execution.id)).length).toBe(1);
      const preRecognition = await B.balanceSnapshot(e.office, e.execution.id, '2000-01-01');
      expect(preRecognition.summary.finalEntitlementMinor).toBe(0);

      const laterJudgment = await EX.addExecutionJudgment(e.office, {executionId: e.execution.id, entitlementType: e.obligation.obligationType,
        judgmentKind: 'later', judgmentDate: '2025-02-10', judgmentNumber: 'FEAS-2', amount: 4000, valueType: 'periodic', effectiveFrom: '2025-02-01'});
      const candidate = await EX.saveValueSlice(e.office, {executionId: e.execution.id, obligationId: e.obligation.id, judgmentId: laterJudgment.id,
        valueType: 'periodic', amount: '4000.00', startDate: '2025-02-01'});
      expect(candidate.status).toBe('needs_review');
      expect(candidate.__impact.totalsMinor.difference).toBe(200000);
      const created = await DF.createSettlement(e.office, {executionId: e.execution.id, sliceId: candidate.id});
      expect(created.impact.rows.length).toBe(1);
      await DF.settlementReview(e.office, created.settlement.id);
      await DF.decideSettlement(e.office, created.settlement.id, {decision: 'approve', reason: 'اختبار ذهبي'});
      const approved = await B.executionBalance(e.office, e.execution.id);
      expect(approved.summary.finalEntitlementMinor).toBe(1100000);
      expect(approved.summary.approvedDifferencesMinor).toBe(200000);
      await DF.postSettlement(e.office, created.settlement.id);
      const posted = await B.executionBalance(e.office, e.execution.id);
      expect(posted.summary.finalEntitlementMinor).toBe(1100000);
      expect((await EX.executionLedgerRows(e.office, e.execution.id)).length).toBe(0);

      const thirdJudgment = await EX.addExecutionJudgment(e.office, {executionId: e.execution.id, entitlementType: e.obligation.obligationType,
        judgmentKind: 'later', judgmentDate: '2025-03-10', judgmentNumber: 'FEAS-3', amount: 5000, valueType: 'periodic', effectiveFrom: '2025-03-01'});
      const rejectedCandidate = await EX.saveValueSlice(e.office, {executionId: e.execution.id, obligationId: e.obligation.id, judgmentId: thirdJudgment.id,
        valueType: 'periodic', amount: '5000.00', startDate: '2025-03-01'});
      expect(rejectedCandidate.status).toBe('needs_review');
      const rejected = await DF.createSettlement(e.office, {executionId: e.execution.id, sliceId: rejectedCandidate.id});
      await DF.settlementReview(e.office, rejected.settlement.id);
      await DF.decideSettlement(e.office, rejected.settlement.id, {decision: 'reject', reason: 'اختبار رفض'});
      expect((await e.office.r.executionValuePeriods.get(rejectedCandidate.id)).status).toBe('cancelled');
      expect((await B.executionBalance(e.office, e.execution.id)).summary.finalEntitlementMinor).toBe(1100000);
    } finally { closeEnv(e); }
  });
  test('FEAS/Golden: تخصيص مستقل، لقطة تاريخية، idempotency للتحصيل، والتوكيل Snapshot بلا دين', async () => {
    const e = await feasFixture();
    try {
      const receiptInput = {executionId: e.execution.id, amount: '1000.00', date: '2025-03-01', idempotencyKey: 'golden-feas-receipt-1',
        allocation: {method: 'MANUAL', targets: [{periodKey: e.period.periodKey, amountMinor: 100000}]}};
      const firstReceipt = await L.recordCollection(e.office, receiptInput);
      const retryReceipt = await L.recordCollection(e.office, receiptInput);
      expect(firstReceipt.receipt.id).toBe(retryReceipt.receipt.id);
      expect(retryReceipt.reused).toBe(true);
      expect((await EX.executionReceipts(e.office, e.execution.id)).length).toBe(1);
      expect((await EX.executionLedgerRows(e.office, e.execution.id)).length).toBe(1);

      const beforeReceipt = await B.balanceSnapshot(e.office, e.execution.id, '2025-02-28');
      expect(beforeReceipt.summary.collectedMinor).toBe(0);
      const current = await B.balanceSnapshot(e.office, e.execution.id, '2099-12-31');
      expect(current.summary.collectedMinor).toBe(100000);
      expect(current.summary.allocatedMinor).toBe(100000);
      expect(current.summary.remainingMinor).toBe(800000);

      const draft = await POA.buildPoaDraft(e.office, {executionId: e.execution.id});
      expect(draft.accountingModel).toBe(FEAS.FEAS_MODEL);
      expect(draft.periodRows.length).toBe(1);
      expect(draft.totals.periodsMinor).toBe(900000);
      const lines = draft.lines.filter(line => line.included && line.amountMinor > 0);
      const poaInput = {executionId: e.execution.id, accountingModel: FEAS.FEAS_MODEL, currency: draft.currency,
        idempotencyKey: draft.idempotencyKey, sourceFingerprint: draft.sourceFingerprint, date: Clock.today(),
        fromDate: draft.fromDate, toDate: draft.toDate, lines, totalMinor: draft.totals.totalMinor,
        total: draft.totals.total, judgmentIds: [e.judgment.id]};
      const poa = await POA.saveExecutionPoa(e.office, poaInput);
      const duplicatePoa = await POA.saveExecutionPoa(e.office, poaInput);
      expect(poa.id).toBe(duplicatePoa.id);
      expect(poa.totalMinor).toBe(900000);
      expect((await B.executionBalance(e.office, e.execution.id)).summary.remainingMinor).toBe(800000);
      const report = await FEASApp.executionIntegrityReport(e.office, e.execution.id);
      expect(report.issues.some(issue => issue.severity === 'error')).toBe(false);
    } finally { closeEnv(e); }
  });
  test('FEAS/Integrity: duplicate settlement-period delta blocks the full balance, not a partial total', async () => {
    const e = await feasFixture();
    try {
      const later = await EX.addExecutionJudgment(e.office, {executionId: e.execution.id, entitlementType: e.obligation.obligationType,
        judgmentKind: 'later', judgmentDate: '2025-02-10', judgmentNumber: 'FEAS-DUP', amount: 4000, valueType: 'periodic', effectiveFrom: '2025-02-01'});
      const candidate = await EX.saveValueSlice(e.office, {executionId: e.execution.id, obligationId: e.obligation.id, judgmentId: later.id,
        valueType: 'periodic', amount: '4000.00', startDate: '2025-02-01'});
      const created = await DF.createSettlement(e.office, {executionId: e.execution.id, sliceId: candidate.id});
      await DF.settlementReview(e.office, created.settlement.id);
      await DF.decideSettlement(e.office, created.settlement.id, {decision: 'approve', reason: 'اختبار سلامة'});
      const differences = await e.office.r.differenceRecords.byIndex('executionId', e.execution.id, 50);
      const approved = differences.find(row => row.settlementId === created.settlement.id && ['APPROVED', 'POSTED'].includes(row.status));
      expect(Boolean(approved)).toBe(true);
      await e.office.r.differenceRecords.add({...approved, id: 'duplicate-feas-period-delta', createdAt: Clock.now()});
      const report = await FEASApp.executionIntegrityReport(e.office, e.execution.id);
      expect(report.issues.some(issue => issue.code === 'duplicate-settlement-period-delta' && issue.severity === 'error')).toBe(true);
      const balance = await B.executionBalance(e.office, e.execution.id);
      expect(balance.summary.integrityBlocked).toBe(true);
      expect(balance.summary.finalEntitlementMinor).toBe(null);
      expect(balance.summary.equations.length).toBe(0);
    } finally { closeEnv(e); }
  });

  // ===== مثال «تنفيذ الأسرة» التجريبي: نفس أرقام قسم «مثال بالأرقام» =====
  test('تنفيذ/مثال: الزرع يبني سلسلة كاملة بأرقام المثال 42,000 − 9,000 = 33,000', async () => {
    const e = await env();
    try {
      const out = await seedFamilyExecutionExample(e.office);
      expect(out.reused).toBe(false);
      const summary = await EX.summarizeExecution(e.office, out.execution);
      expect(summary.finalEntitlement).toBe(42000);   // 12×3000 + 6×1000
      expect(summary.originalEntitlement).toBe(36000);
      expect(summary.collected).toBe(9000);           // 3 شهور × 3000
      expect(summary.remaining).toBe(33000);
      expect(summary.differencePart).toBe(6000);
      expect(summary.periodCount).toBe(12);
      // السلسلة: حكمان وشريحتان وطرفان وتحصيل ومصروف وإجراء
      expect((await EX.executionJudgments(e.office, out.execution.id)).length).toBe(2);
      expect((await EX.executionSlices(e.office, out.execution.id)).length).toBe(2);
      expect((await EX.executionPartyRows(e.office, out.execution.id)).length).toBe(2);
      expect((await EX.executionReceipts(e.office, out.execution.id)).length).toBe(1);
      expect((await EX.executionActionRows(e.office, out.execution.id)).length).toBe(1);
      expect(out.execution.executionType).toBe('family');
      expect(out.execution.accountingModel).toBe('legacy-v1');
    } finally { closeEnv(e); }
  });
  test('تنفيذ/مثال: تسوية الفروق تنتظر قرار المستخدم والتوكيل = رصيد سابق + فترات جديدة', async () => {
    const e = await env();
    try {
      const out = await seedFamilyExecutionExample(e.office);
      const settlements = await EX.executionSettlements(e.office, out.execution.id);
      expect(settlements.length).toBe(1);
      expect(settlements[0].status).toBe('PENDING_REVIEW');
      expect(settlements[0].affectedPeriods).toBe(6);
      const differences = await EX.executionDifferences(e.office, out.execution.id);
      expect(differences.length).toBe(6);
      expect(Math.round(differences.reduce((sum, row) => sum + Number(row.differenceAmount), 0))).toBe(6000);
      const poas = await EX.executionPoaRows(e.office, out.execution.id);
      expect(poas.length).toBe(1);
      expect(poas[0].total).toBe(33000); // 9,000 رصيد سابق + 24,000 فترات يوليو–ديسمبر
      expect(poas[0].previousBalance).toBe(9000);
      expect(poas[0].baseAmount).toBe(24000);
    } finally { closeEnv(e); }
  });
  test('تنفيذ/مثال: تكرار النقر لا يبني مثالًا ثانيًا (idempotent)', async () => {
    const e = await env();
    try {
      const first = await seedFamilyExecutionExample(e.office);
      const second = await seedFamilyExecutionExample(e.office);
      expect(second.reused).toBe(true);
      expect(second.execution.id).toBe(first.execution.id);
      const state = await familyExecutionExampleState(e.office);
      expect(state.exists).toBe(true);
      expect((await EX.executionJudgments(e.office, first.execution.id)).length).toBe(2);
      expect((await EX.executionReceipts(e.office, first.execution.id)).length).toBe(1);
    } finally { closeEnv(e); }
  });
}
