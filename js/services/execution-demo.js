// =====================================================================
// مثال «تنفيذ الأسرة» التجريبي — إضافة بحتة، لا يحذف ولا يعدّل أي سجل قائم.
// ---------------------------------------------------------------------
// هدف تعليمي: زر واحد في مركز التنفيذ يبني سجل تنفيذ أسرة كاملًا عبر
// خدمات التطبيق نفسها (موكل + خصم + ملف + تنفيذ + طرفان + حكمان +
// شريحتا قيمة + تحصيل + مصروف + تسوية فروق معلقة + إجراء + توكيل)
// بأرقام ثابتة يسهل تتبعها، ثم يفتح بطاقة التنفيذ ليتعلم المستخدم
// كيف يبدو كل سجل مسجّلًا وما مصدر كل رقم في الرصيد.
//
// الأرقام موثقة في قسم «مثال بالأرقام» داخل مركز التنفيذ:
//   12 شهرًا × 3,000 = 36,000 (استحقاق أصلي)
//   + 6 شهور × 1,000 زيادة (حكم لاحق 4,000 من 07/2025) = 6,000 فرق
//   الاستحقاق النهائي = 42,000 − المحصل 9,000 = المتبقي 33,000
//   التوكيل = رصيد سابق 9,000 (حتى 30/06) + فترات يوليو–ديسمبر 24,000
//
// idempotent: النقر مرة ثانية يعيد السجل نفسه ولا يكرر المثال.
// =====================================================================
import {Clock} from '../core/clock.js';
import {saveEntity} from './entity-save.js';
import {createLegalFile} from './legal-files.js';
import {DEMO_MARK} from './demo-seed.js';
import * as EX from './execution.js';
import * as L from './execution-ledger.js';
import * as DF from './execution-differences.js';
import * as POA from './execution-poa.js';

export const FAMILY_DEMO_META_ID = 'executionFamilyDemo';

// تواريخ المثال ثابتة (سنة كاملة مكتملة) حتى تطابق شرح «المثال بالأرقام» حرفيًا.
export const FAMILY_DEMO = Object.freeze({
  year: 2025,
  clientName: 'منى عبدالسلام الشاذلي',
  opponentName: 'محمود فاروق الحلواني',
  entitlementType: 'نفقة شهرية',
  monthlyAmount: 3000,
  raisedAmount: 4000,
  raisedFrom: '2025-07-01',
  through: '2025-12-31',
  collected: 9000,
  expense: 600
});

/**
 * تأريخ سجل المثال بسيناريوه حتى يعمل «الرصيد في تاريخ» و«التوكيل» كما في
 * الشرح (نفس أسلوب demo-seed الذي يؤرّخ createdAt): سجل تجريبي مقصود لا يُعدّل
 * أي بيانات قائم، وطابعه〔تجريبي〕 يظهر في ملاحظاته.
 */
const backdate = async (office, store, id, isoDate) => {
  if (!id || !isoDate) return;
  const row = await office.r[store].get(id).catch(() => null);
  if (!row) return;
  const stamp = `${isoDate}T09:00:00.000Z`;
  await office.r[store].put({...row, createdAt: stamp, updatedAt: stamp}).catch(() => null);
};

/** هل المثال محمّل بالفعل؟ (قراءة فقط) */
export async function familyExecutionExampleState(office) {
  office.ctx.assert();
  let meta = null;
  try { meta = await office.r.meta.get(FAMILY_DEMO_META_ID); } catch { meta = null; }
  if (meta?.executionId) {
    const execution = await office.r.execution.get(meta.executionId).catch(() => null);
    if (execution && !execution.isDeleted) return {exists: true, execution, meta};
  }
  return {exists: false, execution: null, meta: null};
}

/**
 * بناء المثال التجريبي كاملًا. إضافة بحتة تمر عبر الخدمات التطبيقية
 * (عدّادات الترقيم، فهارس البحث، سجل النشاط) فلا يختلف أي رقم عما لو
 * سجّله المستخدم بيده خطوة بخطوة.
 */
export async function seedFamilyExecutionExample(office) {
  office.ctx.assert();
  const existing = await familyExecutionExampleState(office);
  if (existing.exists) return {...existing, reused: true};

  const F = FAMILY_DEMO;
  const marker = `${DEMO_MARK} مثال تدريبي — راجع قسم «ابدأ هنا» و«مثال بالأرقام» في مركز التنفيذ.`;

  // 1) الموكلة (المحال إليها) والخصم (المنفذ ضده)
  const client = await office.saveClient({
    fullName: F.clientName, clientType: 'شخص طبيعي', nationality: 'مصري', gender: 'أنثى',
    occupation: 'موظفة', maritalStatus: 'متزوجة', phones: ['01000000000'],
    governorate: 'الدقهلية', city: 'المنصورة', address: 'المنصورة — الدقهلية',
    status: 'active', notes: `${marker} موكلة المثال في قسم تنفيذ الأسرة.`
  });
  const opponent = await saveEntity(office, 'opponents', {
    name: F.opponentName, opponentType: 'شخص طبيعي', capacity: 'منفذ ضده',
    phones: [], address: 'المنصورة — الدقهلية', notes: marker
  });

  // 2) الملف القانوني ثم سجل التنفيذ مرتبطًا به (إلزامي: ملف أو مرحلة)
  const file = await createLegalFile(office, {
    clientId: client.id, title: `${DEMO_MARK} تنفيذ نفقة أسرية — ${F.clientName} ضد ${F.opponentName}`,
    fileType: 'أسرة', status: 'نشط', priority: 'normal', openedAt: `${F.year}-01-15`,
    notes: marker
  });
  const execution = await EX.createExecution(office, {
    executionType: 'family', accountingModel: 'legacy-v1',
    clientId: client.id, fileId: file.id,
    openedDate: `${F.year}-01-15`, judgmentDate: `${F.year}-01-10`,
    officialNumber: '1200/2025', bondType: 'حكم نهائي',
    authority: 'قلم تنفيذ الأسرة — محكمة المنصورة الابتدائية',
    executionOffice: 'قلم تنفيذ الأسرة — المنصورة',
    executionMethod: 'bailiffs', status: 'active',
    entitlementThroughDate: F.through,
    notes: marker
  });
  await backdate(office, 'execution', execution.id, `${F.year}-01-15`);

  // 3) الأطراف: من يستحق ومن يُنفَّذ ضده
  const creditor = await EX.saveExecutionParty(office, {
    executionId: execution.id, side: 'creditor', clientId: client.id,
    name: F.clientName, role: 'مستحق — الموكلة (زوجة)', sequence: 1
  });
  const debtor = await EX.saveExecutionParty(office, {
    executionId: execution.id, side: 'debtor', opponentId: opponent.id,
    name: F.opponentName, role: 'منفذ ضده — الزوج', sequence: 2
  });
  await backdate(office, 'executionParties', creditor.id, '2025-01-16');
  await backdate(office, 'executionParties', debtor.id, '2025-01-16');

  // 4) الحكم الأصلي + شريحة القيمة: 3,000 جنيه شهريًا من 01/01/2025
  const j1 = await EX.addExecutionJudgment(office, {
    executionId: execution.id, entitlementType: F.entitlementType, judgmentKind: 'original',
    judgmentDate: `${F.year}-01-10`, judgmentNumber: '101/2025', lawsuitNumber: '12/2024',
    court: 'محكمة الأسرة بالمنصورة',
    valueType: 'periodic', periodicity: 'monthly', amount: F.monthlyAmount,
    effectiveFrom: `${F.year}-01-01`,
    operativeSummary: `إلزام المطلوب بنفقة شهرية قدرها ${F.monthlyAmount.toLocaleString('ar-EG')} جنيه ابتداءً من أول يناير ${F.year}.`,
    notes: marker
  });
  const firstSlice = await EX.saveValueSlice(office, {
    executionId: execution.id, judgmentId: j1.id, entitlementType: F.entitlementType,
    valueType: 'periodic', periodicity: 'monthly', amount: F.monthlyAmount,
    startDate: `${F.year}-01-01`, sourceReference: 'الحكم 101/2025', notes: marker
  });
  await backdate(office, 'judgments', j1.id, `${F.year}-01-10`);
  await backdate(office, 'executionValuePeriods', firstSlice.id, `${F.year}-01-15`);

  // 5) تحصيل أول ثلاثة شهور: 3 × 3,000 = 9,000 (تخصيص مباشر على الفترات)
  const collected = await L.recordCollection(office, {
    executionId: execution.id, amount: F.collected, date: `${F.year}-04-10`,
    collectorName: 'محضر تنفيذ', collectionSide: 'قلم تنفيذ الأسرة',
    paymentMethod: 'نقدي', reference: 'إيصال 551', notes: marker,
    allocation: {method: 'DIRECT', targets: [
      {periodKey: `${F.entitlementType}::${F.year}-01-01`, amount: 3000},
      {periodKey: `${F.entitlementType}::${F.year}-02-01`, amount: 3000},
      {periodKey: `${F.entitlementType}::${F.year}-03-01`, amount: 3000}
    ]}
  });
  await backdate(office, 'executionReceipts', collected.receipt?.id, `${F.year}-04-10`);
  await backdate(office, 'executionLedger', collected.ledger?.id, `${F.year}-04-10`);
  for (const allocation of collected.allocations || []) await backdate(office, 'executionAllocations', allocation.id, `${F.year}-04-10`);

  // 6) مصروف فعلي منفصل عن أصل النفقة (يدخل التوكيل باختيار المكتب)
  const expense = await L.recordExpense(office, {
    executionId: execution.id, type: 'EXECUTION_FEE', amount: F.expense,
    date: `${F.year}-02-05`, documentReferenceId: 'إيصال 778',
    includeInPoa: true, notes: `${marker} رسم تنفيذ — لا يزيد أصل الدين.`
  });
  await backdate(office, 'executionLedger', expense?.id, `${F.year}-02-05`);

  // 7) حكم لاحق (استئناف) يرفع النفقة إلى 4,000 من 01/07/2025 + شريحته
  const j2 = await EX.addExecutionJudgment(office, {
    executionId: execution.id, entitlementType: F.entitlementType, judgmentKind: 'later',
    judgmentDate: '2025-07-20', judgmentNumber: '550/2025', appealNumber: '402/2025',
    court: 'محكمة استئناف الأسرة بالمنصورة', previousJudgmentId: j1.id,
    valueType: 'periodic', periodicity: 'monthly', amount: F.raisedAmount,
    effectiveFrom: F.raisedFrom,
    operativeSummary: `زيادة النفقة الشهرية إلى ${F.raisedAmount.toLocaleString('ar-EG')} جنيه ابتداءً من أول يوليو ${F.year}.`,
    notes: marker
  });
  const raisedSlice = await EX.saveValueSlice(office, {
    executionId: execution.id, judgmentId: j2.id, entitlementType: F.entitlementType,
    valueType: 'periodic', periodicity: 'monthly', amount: F.raisedAmount,
    startDate: F.raisedFrom, sourceReference: 'الحكم 550/2025 (استئناف)', notes: marker
  });
  await backdate(office, 'judgments', j2.id, '2025-07-20');
  await backdate(office, 'executionValuePeriods', raisedSlice.id, '2025-07-20');

  // 8) تسوية الفروق تبقى تنتظر قرار المستخدم — لا حركة مالية قبل الاعتماد
  const settlementOut = await DF.createSettlement(office, {
    executionId: execution.id, sliceId: raisedSlice.id,
    note: `${DEMO_MARK} فرق 6 شهور (3,000 ← 4,000) — اعتمِد أو ارفض بنفسك لتجربة القرار.`
  });
  await backdate(office, 'executionSettlements', settlementOut.settlement?.id, '2025-07-20');
  for (const row of settlementOut.differences || []) await backdate(office, 'differenceRecords', row.id, '2025-07-20');

  // 9) إجراء تنفيذ مسجل (تنظيمي كما يسجّله المكتب)
  const action = await EX.saveExecutionAction(office, {
    executionId: execution.id, kind: 'seizure', date: `${F.year}-05-12`,
    referenceNumber: 'ح-22/2025', authority: 'قلم تنفيذ الأسرة — المنصورة',
    notes: `${marker} حجز جزء من الراتب.`
  });
  await backdate(office, 'executionActions', action.id, `${F.year}-05-12`);

  // 10) توكيل نصف الثاني: رصيد سابق حتى 30/06 + فترات يوليو–ديسمبر
  const draft = await POA.buildPoaDraft(office, {
    executionId: execution.id, fromDate: '2025-07-01', toDate: F.through,
    includePreviousBalance: true, includeDifferences: true, includeExpenses: false
  });
  const poaLines = draft.lines.filter(line => line.included && Number(line.amount) > 0);
  const poaTotal = Math.round(poaLines.reduce((sum, line) => sum + Number(line.amount), 0) * 100) / 100;
  const poa = await POA.saveExecutionPoa(office, {
    executionId: execution.id, previousPoaId: '', poaNumber: '', date: '2025-07-05',
    fromDate: draft.fromDate, toDate: draft.toDate, currency: draft.currency || '',
    baseAmount: draft.totals.newPeriodValue, previousBalance: draft.totals.previousBalance,
    differencesAmount: draft.totals.differences, expensesAmount: draft.totals.expenses,
    stampAmount: 0, total: poaTotal, lines: poaLines,
    judgmentIds: [j1.id, j2.id],
    notes: `${marker} التوكيل = رصيد سابق + فترات جديدة، كل مبلغ بمصدره.`
  });
  await backdate(office, 'executionPOAs', poa.id, '2025-07-05');

  await office.r.meta.put({
    id: FAMILY_DEMO_META_ID, key: FAMILY_DEMO_META_ID, seeded: true,
    executionId: execution.id, clientId: client.id, fileId: file.id, at: Clock.now()
  });

  const summary = await EX.summarizeExecution(office, execution);
  return {execution, client, file, summary, reused: false};
}
