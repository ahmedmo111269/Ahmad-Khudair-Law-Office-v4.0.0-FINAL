// =====================================================================
// ملف تنفيذ فعلي كامل — يُسجَّل في كل تبويبات بطاقة التنفيذ
// ---------------------------------------------------------------------
// الغرض: ملف واحد واقعي تمرّ عليه كل وظائف مركز التنفيذ (الحساب · السجل ·
// الحكم والبيانات · التوكيل والطباعة) فيرى المكتب ما يعمل وما لا يعمل على
// بيانات حقيقية الشكل، لا على تنفيذ فارغ.
// • يمر عبر خدمات التطبيق نفسها (لا كتابة مباشرة ولا مسار موازٍ).
// • موسوم في الملاحظات بأنه ملف فحص، ويُحذف من بطاقة التنفيذ أو سلة التنفيذ.
// • Idempotent: لا ينشئ نسخة ثانية إن وُجد ملف الفحص نفسه.
// =====================================================================
import {Clock, localDate} from '../core/clock.js';
import {isCivilDate, addCivilDays} from '../domain/execution-calendar.js';
import * as SIMPLE from './execution-simple.js';
import * as MP from './execution-manual-periods.js';
import * as BEN from './execution-beneficiaries.js';

export const ACTUAL_FILE_MARKER = 'ملف تنفيذ فعلي — فحص كل التبويبات';
const META_KEY = 'executionActualFileSeed';

/** إزاحة شهرية سالبة/موجبة من تاريخ مرجعي (لتواريخ واقعية نسبية لليوم). */
function shiftMonths(reference, months) {
  if (!isCivilDate(reference)) return reference;
  const [year, month, day] = reference.split('-').map(Number);
  const total = year * 12 + month - 1 + months;
  const targetYear = Math.floor(total / 12);
  const targetMonth = ((total % 12) + 12) % 12 + 1;
  const lastDay = new Date(targetYear, targetMonth, 0).getDate();
  return `${String(targetYear).padStart(4, '0')}-${String(targetMonth).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}

/** هل ملف الفحص موجود بالفعل؟ */
export async function actualFileState(office) {
  const meta = await office.r.meta.get(META_KEY).catch(() => null);
  if (!meta?.executionId) return {seeded: false, executionId: ''};
  const row = await office.r.execution.get(meta.executionId).catch(() => null);
  return {seeded: Boolean(row && !row.isDeleted), executionId: row && !row.isDeleted ? row.id : '', reused: Boolean(meta.reusedAt)};
}

/**
 * ينشئ الملف ويسجّل فيه كل الأنواع. يعيد ملخصًا بما أُنشئ (للعرض والتدقيق).
 */
export async function seedActualExecutionFile(office, {today = localDate()} = {}) {
  office.ctx.assert();
  const existing = await actualFileState(office);
  if (existing.seeded) return {...existing, reused: true, created: []};

  const effectiveFrom = shiftMonths(today, -3);       // 3 فترات مكتملة + الجارية
  const judgmentDate = shiftMonths(today, -4);
  const created = [];

  // 1) التنفيذ + الحكم + بند القيمة (يُبنى الجدول الشهري تلقائيًا)
  const out = await SIMPLE.createSimpleExecution(office, {
    newClientName: 'منى إبراهيم عبد الرحمن',
    opponentName: 'خالد سعيد محمود',
    executionType: 'family',
    entitlementType: 'نفقة صغار',
    valueType: 'periodic',
    periodicity: 'monthly',
    amount: 3000,
    effectiveFrom,
    judgmentNumber: `1234 لسنة ${String(today.slice(0, 4))} أسرة المنصورة`,
    judgmentDate,
    court: 'محكمة الأسرة بالمنصورة',
    officialNumber: `555/${String(today.slice(0, 4))}`,
    openedDate: today,
    executionMethod: 'تكليف بالوفاء ثم حجز',
    authority: 'قلم تنفيذ محكمة الأسرة بالمنصورة',
    notes: ACTUAL_FILE_MARKER
  });
  const executionId = out.execution.id;
  created.push({step: 'التنفيذ والحكم وبند القيمة', detail: `3,000 ج.م شهريًا من ${effectiveFrom}`});

  // 2) تحصيل جزئي مثبّت على أول فترة (يختبر التخصيص المحدد لا التلقائي)
  const receipt = await SIMPLE.recordSimpleCollection(office, {
    executionId, amount: 1500, date: addCivilDays(today, -4), paymentMethod: 'نقدي',
    reference: 'محضر تحصيل 77', payerName: 'خالد سعيد محمود', collectorName: 'قلم التنفيذ',
    target: 'period', periodKey: `نفقة صغار::${effectiveFrom}`,
    notes: 'دفعة جزئية على أول فترة — ملف الفحص'
  });
  created.push({step: 'محضر تحصيل', detail: `1,500 ج.م مثبّتة على فترة ${effectiveFrom}`});

  // 3) إجراءان: تكليف بالوفاء ثم محضر تبديد (يربط الرصيد السابق بمحضر)
  await SIMPLE.recordSimpleAction(office, {
    executionId, kind: 'summons', date: addCivilDays(today, -3), referenceNumber: 'تكليف 12',
    authority: 'قلم تنفيذ محكمة الأسرة بالمنصورة', result: 'تم تسجيل الإجراء',
    nextAction: 'محضر تبديد', nextActionDate: addCivilDays(today, -20), notes: 'ملف الفحص'
  });
  await SIMPLE.recordSimpleAction(office, {
    executionId, kind: 'dissipation', date: addCivilDays(today, -15), referenceNumber: '452 لسنة ' + String(today.slice(0, 4)),
    authority: 'قلم تنفيذ محكمة الأسرة بالمنصورة', result: 'تم',
    nextAction: 'جلسة بيع', nextActionDate: shiftMonths(today, 1), notes: 'محضر تبديد منقولات — ملف الفحص'
  });
  created.push({step: 'إجراءان', detail: 'تكليف بالوفاء + محضر تبديد 452 مع إجراء تالٍ وموعد'});

  // 4) مصروف/رسم (سطر مستقل لا يزيد أصل الدين)
  await SIMPLE.recordSimpleExpense(office, {
    executionId, typeLabel: 'رسم تنفيذ', amount: 250, date: addCivilDays(today, -2),
    includeInPoa: true, borneBy: 'debtor', notes: 'رسم تنفيذ — ملف الفحص'
  });
  created.push({step: 'مصروف / رسم', detail: '250 ج.م رسم تنفيذ (يدخل التوكيل، يتحمله المنفذ ضده)'});

  // 5) فترة يدوية مستقلة (لا تعدّل الفترات الآلية)
  const manual = await MP.createManualPeriod(office, {
    executionId, fromDate: shiftMonths(effectiveFrom, -1), toDate: addCivilDays(effectiveFrom, -1),
    amount: 1000, entitlementType: 'نفقة صغار',
    reason: 'فرق محضر تبديد 452 لم يُدرج في الفترات الآلية — ملف الفحص'
  });
  created.push({step: 'فترة يدوية', detail: manual.equation});

  // 6) توزيع المستحقين على محضر التحصيل (شرط المجموع = مبلغ المحضر)
  try {
    await BEN.saveReceiptBeneficiaries(office, {
      receiptId: receipt.receipt.id, reason: 'توزيع على المستحقين بحسب الحكم — ملف الفحص',
      entries: [{beneficiaryName: 'منى إبراهيم عبد الرحمن', beneficiaryShare: 60}, {beneficiaryName: 'الأبناء', beneficiaryShare: 40}]
    });
    created.push({step: 'توزيع المستحقين', detail: '60% / 40% على محضر التحصيل'});
  } catch (error) {
    created.push({step: 'توزيع المستحقين', detail: `تعذر: ${error?.message || error}`});
  }

  // 7) حكم لاحق (زيادة) — يختبر تغيّر القيمة داخل الفترات
  try {
    await SIMPLE.recordSubsequentJudgment(office, {
      executionId, entitlementType: 'نفقة صغار', amount: 3500, effectiveFrom: shiftMonths(today, 1),
      judgmentKind: 'appeal', judgmentNumber: '91 لسنة ' + String(today.slice(0, 4)), court: 'استئناف الأسرة',
      judgmentDate: addCivilDays(today, -1), notes: 'حكم لاحق بزيادة النفقة — ملف الفحص'
    });
    created.push({step: 'حكم لاحق', detail: '3,500 ج.م من ' + shiftMonths(today, 1)});
  } catch (error) {
    created.push({step: 'حكم لاحق', detail: `تعذر: ${error?.message || error}`});
  }

  // 8) توكيل محفوظ (نسخة ثابتة) بمدة صريحة ورسوم ودمغة
  let poa = null;
  try {
    const toDate = addCivilDays(today, -1);
    const draft = await SIMPLE.simplePoaDraft(office, executionId, {
      fromDate: effectiveFrom, toDate, includePreviousBalance: true,
      expenseIds: [], fees: 500, stamps: 100, allowFuture: true
    });
    poa = await SIMPLE.saveSimplePoa(office, executionId, {...draft, poaNumber: ''}, {date: today, notes: 'توكيل بمحضر التبديد 452 — ملف الفحص', printNow: false});
    created.push({step: 'توكيل', detail: `${poa.poaNumber} — ${effectiveFrom} ← ${toDate} بإجمالي ${poa.total} ج.م (منه رسوم 500 ودمغة 100)`});
  } catch (error) {
    created.push({step: 'توكيل', detail: `تعذر: ${error?.message || error}`});
  }

  // 9) ملاحظة سريعة تشغيلية (نظام الملاحظات القائم، لا سجل ثانٍ)
  try {
    await SIMPLE.recordSimpleNote(office, {executionId, body: 'ملاحظة فحص: تم التواصل مع قلم التنفيذ ومتابعة محضر التبديد 452.'});
    created.push({step: 'ملاحظة سريعة', detail: 'ملاحظة تشغيلية مرتبطة بالتنفيذ'});
  } catch (error) {
    created.push({step: 'ملاحظة سريعة', detail: `تعذر: ${error?.message || error}`});
  }

  // 10) قرار مسجَّل في Activity Log (يُظهر أثر القرارات)
  await SIMPLE.logExecutionDecision(office, {
    executionId, action: 'actual-file-seeded',
    summary: 'إنشاء ملف تنفيذ فعلي للفحص وتسجيل وقائع في كل التبويبات',
    metadata: {steps: created.length, marker: ACTUAL_FILE_MARKER}
  }).catch(() => null);

  await office.r.meta.put({id: META_KEY, executionId, seededAt: Clock.now(), today}).catch(() => null);
  const bundle = await SIMPLE.simpleCardBundle(office, executionId, {asOf: today, allowFuture: true}).catch(() => null);
  return {
    seeded: true, reused: false, executionId, created, poaId: poa?.id || '',
    totals: bundle ? {due: bundle.schedule.totals.dueMinor, paid: bundle.schedule.totals.paidMinor, remaining: bundle.schedule.totals.remainingMinor, periods: bundle.schedule.rows.length} : null
  };
}

/** حذف ملف الفحص منطقيًا (يُستعاد من سلة التنفيذ) — لا حذف صامت. */
export async function removeActualExecutionFile(office, {reason = 'حذف ملف الفحص'} = {}) {
  const state = await actualFileState(office);
  if (!state.seeded) return {removed: false};
  const EX = await import('./execution.js');
  const row = await office.r.execution.get(state.executionId);
  await EX.deleteExecution(office, state.executionId, row?.version ?? null, reason);
  await office.r.meta.put({id: META_KEY, executionId: state.executionId, removedAt: Clock.now(), reason}).catch(() => null);
  return {removed: true, executionId: state.executionId};
}
