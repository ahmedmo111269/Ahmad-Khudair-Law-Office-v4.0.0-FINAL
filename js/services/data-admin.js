// =====================================================================
// إدارة بيانات القاعدة: مسح شامل · مسح مخصوص بقسم التنفيذ · ملفات تنفيذ تجريبية
// ---------------------------------------------------------------------
// • كل عملية مسح: صريحة (بسبب واسم قاعدة)، مسجَّلة في Activity Log قبل التنفيذ،
//   وتُنفَّذ داخل Transaction واحدة على كل المخازن — إما كاملة أو بلا أثر.
// • لا تلمس هذه الخدمة سجل قواعد البيانات (Registry) ولا هوية القاعدة الحالية:
//   المسح يمسح **محتوى** القاعدة النشطة فقط، ولا يحذف القاعدة نفسها.
// • الملفات التجريبية موسومة 〔تجريبي〕 و DEMO_MARK، ويمكن حذفها وحدها لاحقًا.
// =====================================================================
import {STORE} from '../db/schema.js';
import {transaction, request} from '../db/unit-of-work.js';
import {uid} from '../core/id.js';
import {Clock, localDate, addDays} from '../core/clock.js';
import {AppError, ERR} from '../core/errors.js';
import {events} from '../core/events.js';
import * as S from './execution-simple.js';
import {DEMO_MARK} from './demo-seed.js';

const now = () => Clock.now();
const CLEAR_LIMIT = 20000;

/** مخازن تُحذف كلها عند «مسح كل البيانات» (بيانات المكتب التشغيلية). */
const OPERATIONAL_STORES = Object.freeze([
  'clients', 'staff', 'files', 'cases', 'fileClients', 'caseClients', 'opponents', 'caseOpponents',
  'caseRelations', 'powersOfAttorney', 'hearings', 'procedures', 'appointments', 'communications',
  'caseNotes', 'quickNoteLinks', 'caseNoteDrafts', 'witnesses', 'expertReports', 'judgments',
  'fees', 'feePayments', 'documentReferences', 'fileParties', 'fileRelations', 'clientFiles',
  'assets', 'fileAssets', 'serviceRecords', 'bailiffs',
  'workItems', 'workItemComments', 'workItemRecurrences',
  'syncChanges', 'syncConflicts'
]);

/** مخازن قسم التنفيذ (تُمسح كلها مع التنفيذات نفسها؛ لا سجل يتيتم). */
export const EXECUTION_STORES = Object.freeze([
  'execution', 'executionParties', 'executionValuePeriods', 'executionLedger', 'executionAllocations',
  'executionReceipts', 'executionActions', 'executionPOAs', 'differenceRecords', 'executionSettlements',
  'executionAdjustments', 'executionObligations', 'executionPeriods', 'judgments'
]);

/** مخازن تُراعى عند المسح الشامل لكنها تُترك سليمة (إعدادات/قوائم/قوالب/ترقيم). */
const PRESERVED_STORES = Object.freeze(['lookups', 'settings', 'taxonomy', 'caseTemplates', 'executionTemplates', 'syncState', 'syncPeers']);

function activityRow(office, entityType, entityId, action, summary, metadata = {}) {
  return {id: uid(), entityType, entityId, action, timestamp: now(), summary, metadata,
    ...(office?.ctx?.profile?.id ? {actorId: office.ctx.profile.id} : {})};
}

/**
 * مسح مخازن كاملة داخل معاملة واحدة.
 * captureChanges:false مقصود وموثَّق: المسح الشامل عملية إدارية صريحة على مستوى
 * القاعدة (لا حذف سجل سجل)، وطبقة تغييرات المزامنة تمسح معها (syncChanges)
 * فلا يُدفع أي أثر قديم إلى جهاز آخر. بدونه يرفض DatabaseContext استدعاء clear()
 * خارج مسار الاستعادة الصريحة.
 */
async function clearStores(office, stores, {logRow = null, extraStores = []} = {}) {
  const names = [...new Set(stores.filter(name => Boolean(STORE[name])))];
  const counts = {};
  for (const name of names) counts[name] = await office.r[STORE[name]].count().catch(() => 0);
  const allStores = [...names, ...extraStores.filter(name => Boolean(STORE[name])), STORE.activityLog];
  await transaction(office.ctx, [...new Set(allStores.map(name => STORE[name]))], async tx => {
    for (const name of names) await request(tx.objectStore(STORE[name]).clear());
    if (logRow) await request(tx.objectStore(STORE.activityLog).add(logRow));
  }, {captureChanges: false});
  return counts;
}

/** حذف كل صفوف التنفيذ التي تحمل وسم البيانات التجريبية. */
async function executionDemoIds(office) {
  const rows = await office.r.execution.all(CLEAR_LIMIT).catch(() => []);
  return (rows || [])
    .filter(row => !row?.isDeleted && (row?.[DEMO_MARK] === true || row?.isDemo === true || String(row?.notes || '').includes('〔تجريبي〕')))
    .map(row => row.id);
}

/* ============================== المسح ============================== */

/**
 * مسح كل بيانات المكتب داخل القاعدة النشطة.
 * الإعدادات والقوائم والقوالب وترقيم الملفات تُعاد إلى حالتها النظيفة،
 * ويُسجَّل الحدث في Activity Log قبل التنفيذ (لا حذف في صمت).
 */
export async function clearAllData(office, {reason = '', confirmName = ''} = {}) {
  office.ctx.assert();
  const label = String(office.ctx?.profile?.displayName || office.ctx?.profile?.name || '').trim();
  if (String(confirmName || '').trim() !== label) throw new AppError(ERR.VALIDATION, 'اكتب اسم قاعدة البيانات exactly كما يظهر للتأكيد قبل المسح.', {confirmName: 'مطلوب'});
  const stamp = now();
  const summary = `مسح شامل لكل بيانات القاعدة${String(reason || '').trim() ? ` — ${String(reason).trim()}` : ''}`;
  // ترقيم الملفات يبدأ من جديد مع القاعدة الفارغة (لا ملف باقٍ ليحجز رقمًا)،
  // وسجل النشاط يُفرَّع معها ويبقى فيه سطر المسح نفسه شاهدًا على العملية.
  const before = await clearStores(office, [...new Set([...OPERATIONAL_STORES, ...EXECUTION_STORES, 'fileNumberCounters', 'activityLog'])], {
    logRow: activityRow(office, STORE.meta, 'clearAllData', 'clear_all_data', summary,
      {reason: String(reason || '').trim(), at: stamp})
  });

  // يمنع إعادة زرع البيانات التجريبية العامة تلقائيًا بعد المسح.
  await office.r.meta.put({id: 'demoSeed', key: 'demoSeed', seeded: false, clearedAt: stamp, reason: 'cleared-by-user'}).catch(() => null);
  // حذف وسم الملفات التجريبية يعيد تسليح الزرع التجريبي للتنفيذ: من يمسح كل شيء
  // يجد ملفات تجريبية جاهزة للمعاينة بدل شاشة فارغة (ولا تُزرع فوق بيانات حقيقية).
  await office.r.meta.delete('executionDemoSeed').catch(() => null);
  await office.r.meta.put({id: 'executionSimpleMigration', key: 'executionSimpleMigration', version: 1, completedAt: stamp, scanned: 0, hasMore: false, withIssues: 0, report: []}).catch(() => null);
  events.emit('db:cleared', {profileId: office.ctx?.profile?.id || '', at: stamp});
  events.emit('entity:changed', {entityType: STORE.meta, id: 'clearAllData'});
  return {cleared: true, counts: before, at: stamp};
}

/** مسح قسم التنفيذ بالكامل (التنفيذات وكل توابعها) مع إبقاء بقية أقسام المكتب. */
export async function clearExecutionData(office, {reason = ''} = {}) {
  office.ctx.assert();
  const stamp = now();
  const before = await clearStores(office, EXECUTION_STORES, {
    logRow: activityRow(office, STORE.meta, 'clearExecutionData', 'clear_execution_data',
      `مسح كل بيانات قسم التنفيذ${String(reason || '').trim() ? ` — ${String(reason).trim()}` : ''}`,
      {reason: String(reason || '').trim(), at: stamp})
  });
  await office.r.meta.delete('executionDemoSeed').catch(() => null);
  await office.r.meta.put({id: 'executionSimpleMigration', key: 'executionSimpleMigration', version: 1, completedAt: stamp, scanned: 0, hasMore: false, withIssues: 0, report: []}).catch(() => null);
  events.emit('entity:changed', {entityType: STORE.execution, id: '*'});
  return {cleared: true, counts: before, at: stamp};
}

/** حذف الملفات التجريبية للتنفيذ فقط (تبقى ملفات المكتب الحقيقية سليمة). */
export async function removeExecutionDemoFiles(office) {
  office.ctx.assert();
  const ids = await executionDemoIds(office);
  if (!ids.length) return {removed: 0, ids: []};
  const stamp = now();
  const {deleteExecution} = await import('./execution.js');
  for (const id of ids) {
    const row = await office.r.execution.get(id);
    if (!row) continue;
    await deleteExecution(office, id, row.version ?? null, 'حذف ملفات التنفيذ التجريبية').catch(() => null);
  }
  await transaction(office.ctx, [STORE.activityLog], async tx => {
    await request(tx.objectStore(STORE.activityLog).add(activityRow(office, STORE.meta, 'removeExecutionDemo', 'remove_execution_demo',
      `حذف ${ids.length} ملف تنفيذ تجريبي`, {ids, at: stamp})));
  });
  await office.r.meta.put({id: 'executionDemoSeed', key: 'executionDemoSeed', seeded: false, removedAt: stamp}).catch(() => null);
  events.emit('entity:changed', {entityType: STORE.execution, id: '*'});
  return {removed: ids.length, ids};
}

/* ======================= ملفات تنفيذ تجريبية ======================= */

const DEMO_TAG = '〔تجريبي〕';

/**
 * أربعة ملفات تنفيذ تجريبية جاهزة للمعاينة — كل واحد يعرّض مسار حساب مختلف:
 * 1) نفقة دورية متأخرة بمحاضر تحصيل جزئية وإجراءات ومصروفات.
 * 2) مبلغ مقطوع (مدني) مسدَّد بالكامل.
 * 3) نفقة بحكم لاحق بالزيادة (فرق يُظهر مرة واحدة على الشهور المتأثرة).
 * 4) تنفيذ حديث يبدأ من اليوم (الفترة الجارية) ليُثبت ظهور الأرقام فورًا.
 * كل السجلات موسومة DEMO_MARK و〔تجريبي〕 ويمكن حذفها بضغطة واحدة.
 */
export async function seedExecutionDemoFiles(office, {onProgress = null} = {}) {
  office.ctx.assert();
  const today = localDate();
  const startOf = iso => `${iso.slice(0, 8)}01`;
  const monthsBack = n => {
    const d = new Date(`${today}T00:00:00`);
    d.setMonth(d.getMonth() - n);
    return localDate(d);
  };
  const plan = [
    {
      clientName: `${DEMO_TAG} هدى عبد الرحمن`, opponentName: `${DEMO_TAG} سامح محمود`,
      entitlementType: 'نفقة صغار', valueType: 'periodic', periodicity: 'monthly', amount: '3500',
      effectiveFrom: startOf(monthsBack(8)), judgmentNumber: '1450/2025', court: 'محكمة الأسرة بالمنصورة',
      judgmentDate: monthsBack(9), executionType: 'family', authority: 'قلم تنفيذ المنصورة',
      executionMethod: 'حجز راتب', notes: `${DEMO_TAG} نفقة صغار دورية — تحصيلات جزئية ومتأخرات للمعاينة`
    },
    {
      clientName: `${DEMO_TAG} مؤسسة النيل للتجارة`, opponentName: `${DEMO_TAG} شركة البناء الحديث`,
      entitlementType: 'مبلغ مقطوع', valueType: 'fixed', amount: '120000',
      effectiveFrom: monthsBack(4), judgmentNumber: '882/2025', court: 'محكمة المنصورة الابتدائية',
      judgmentDate: monthsBack(5), executionType: 'civil', authority: 'إدارة التنفيذ بالمنصورة',
      executionMethod: 'تكليف بالوفاء', notes: `${DEMO_TAG} مبلغ مقطوع مدني — مسدَّد بالكامل`
    },
    {
      clientName: `${DEMO_TAG} نادية حسن`, opponentName: `${DEMO_TAG} طارق علي`,
      entitlementType: 'نفقة زوجة', valueType: 'periodic', periodicity: 'monthly', amount: '2000',
      effectiveFrom: startOf(monthsBack(10)), judgmentNumber: '311/2025', court: 'محكمة الأسرة ببنها',
      judgmentDate: monthsBack(11), executionType: 'family', authority: 'قلم تنفيذ بنها',
      executionMethod: 'إعلان بيع', notes: `${DEMO_TAG} نفقة زوجة بحكم لاحق بالزيادة`
    },
    {
      clientName: `${DEMO_TAG} منى صلاح`, opponentName: `${DEMO_TAG} عماد فتحي`,
      entitlementType: 'نفقة صغار', valueType: 'periodic', periodicity: 'monthly', amount: '4000',
      effectiveFrom: today, judgmentNumber: '2040/2026', court: 'محكمة الأسرة بطنطا',
      judgmentDate: today, executionType: 'family', authority: 'قلم تنفيذ طنطا',
      executionMethod: 'تكليف بالوفاء', notes: `${DEMO_TAG} تنفيذ جديد يبدأ من اليوم — الفترة الجارية`
    }
  ];

  const created = [];
  for (let index = 0; index < plan.length; index += 1) {
    const item = plan[index];
    onProgress?.({done: index, total: plan.length, label: item.clientName});
    const client = await office.saveClient({fullName: item.clientName, phones: ['01000000000'], status: 'active'});
    const out = await S.createSimpleExecution(office, {
      clientId: client.id, opponentName: item.opponentName, entitlementType: item.entitlementType,
      valueType: item.valueType, periodicity: item.periodicity, amount: item.amount,
      effectiveFrom: item.effectiveFrom, judgmentNumber: item.judgmentNumber, court: item.court,
      judgmentDate: item.judgmentDate, executionType: item.executionType, authority: item.authority,
      executionMethod: item.executionMethod, openedDate: item.effectiveFrom,
      notes: item.notes, officialNumber: `DEMO-${String(index + 1).padStart(3, '0')}`
    });
    const execution = {...out.execution, [DEMO_MARK]: true, isDemo: true, demoTag: 'execution-demo-v1'};
    await office.r.execution.put(execution);

    // 1) نفقة متأخرة: تحصيلات جزئية + إجراءات + مصروف + إجراء تالٍ
    if (index === 0) {
      await S.recordSimpleCollection(office, {executionId: execution.id, amount: '3500', date: addDays(startOf(monthsBack(7)), 4)});
      await S.recordSimpleCollection(office, {executionId: execution.id, amount: '1500', date: addDays(startOf(monthsBack(5)), 9)});
      await S.recordSimpleCollection(office, {executionId: execution.id, amount: '6000', date: addDays(startOf(monthsBack(3)), 2)});
      await S.recordSimpleAction(office, {executionId: execution.id, kind: 'تكليف بالوفاء', date: monthsBack(7),
        nextAction: 'متابعة الحجز', nextActionDate: addDays(today, 7), referenceNumber: 'ت-١٢٤', notes: `${DEMO_TAG} تكليف بالوفاء`});
      await S.recordSimpleAction(office, {executionId: execution.id, kind: 'حجز', date: monthsBack(4), notes: `${DEMO_TAG} حجز راتب`});
      await S.recordSimpleExpense(office, {executionId: execution.id, type: 'EXECUTION_FEE', amount: '320', date: monthsBack(6), borneBy: 'debtor'});
      await S.recordSimpleExpense(office, {executionId: execution.id, type: 'STAMP', amount: '45', date: monthsBack(6), borneBy: 'office'});
    }
    // 2) مبلغ مقطوع مسدَّد بالكامل
    if (index === 1) {
      await S.recordSimpleCollection(office, {executionId: execution.id, amount: '70000', date: addDays(monthsBack(3), 5)});
      await S.recordSimpleCollection(office, {executionId: execution.id, amount: '50000', date: addDays(monthsBack(1), 3)});
      await S.recordSimpleAction(office, {executionId: execution.id, kind: 'إعلان', date: monthsBack(4), notes: `${DEMO_TAG} إعلان تكليف`});
    }
    // 3) حكم لاحق بالزيادة بعد ستة أشهر
    if (index === 2) {
      await S.recordSimpleCollection(office, {executionId: execution.id, amount: '2000', date: addDays(startOf(monthsBack(9)), 6)});
      await S.recordSubsequentJudgment(office, {executionId: execution.id, amount: '2800', effectiveFrom: startOf(monthsBack(4)),
        entitlementType: 'نفقة زوجة', judgmentNumber: '720/2026', judgmentDate: monthsBack(5)});
      await S.recordSimpleAction(office, {executionId: execution.id, kind: 'طلب / تظلم', date: monthsBack(2), notes: `${DEMO_TAG} تظلم من التوزيع`});
    }
    // 4) تنفيذ جديد من اليوم: إجراء واحد فقط (الفترة الجارية تظهر فورًا)
    if (index === 3) {
      await S.recordSimpleAction(office, {executionId: execution.id, kind: 'تكليف بالوفاء', date: today,
        nextAction: 'متابعة أول تحصيل', nextActionDate: addDays(today, 15), notes: `${DEMO_TAG} بداية التنفيذ`});
    }
    created.push({execution, client, file: out.file, judgment: out.judgment, slice: out.slice});
  }
  const stamp = now();
  await office.r.meta.put({id: 'executionDemoSeed', key: 'executionDemoSeed', seeded: true, at: stamp, count: created.length}).catch(() => null);
  await transaction(office.ctx, [STORE.activityLog], async tx => {
    await request(tx.objectStore(STORE.activityLog).add(activityRow(office, STORE.meta, 'executionDemoSeed', 'seed_execution_demo',
      `تحميل ${created.length} ملفات تنفيذ تجريبية للمعاينة`, {ids: created.map(row => row.execution.id), at: stamp})));
  });
  events.emit('entity:changed', {entityType: STORE.execution, id: '*'});
  return {created, count: created.length, at: stamp};
}

/** رقم الملفات التجريبية الموجودة حاليًا (لعرض حالة الزر). */
export async function executionDemoStatus(office) {
  try {
    const ids = await executionDemoIds(office);
    return {count: ids.length, ids};
  } catch {
    return {count: 0, ids: []};
  }
}

export {DEMO_TAG, OPERATIONAL_STORES, PRESERVED_STORES};
