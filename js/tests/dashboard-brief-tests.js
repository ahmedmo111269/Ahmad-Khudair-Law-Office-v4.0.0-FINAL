// ============================================================
// اختبارات «مكتب اليوم» — لوحة dashboardBrief بعد دمج الاستعلامات (Wave 7):
//   • 9 reportRange ← 6: الاستعلامات المدموجة (جلسات / أعمال / توكيلات).
//   • التقسيم في الذاكرة يطابق الاستعلامات المنفصلة حرفيًا (حدود 100/60، مرشحات المقاطع).
//   • postponeCount يُقرأ من طبقة work-items (overlay) للأعمال المتأخرة المعروضة فقط.
//   • chip «↷ أُجّل N مرات» في واجهة الطابور وبطاقة «الآن».
// ============================================================
import {upgradeSchema} from '../db/schema.js';
import {SCHEMA_VERSION} from '../core/constants.js';
import {Office} from '../services/office.js';
import {saveOperational} from '../services/operations.js';
import {createLegalFile} from '../services/legal-files.js';
import {Clock, addDays} from '../core/clock.js';
import {uid} from '../core/id.js';
import {dashboardBrief} from '../services/dashboard.js';
import {buildFocusModel} from '../services/focus-engine.js';
import {HOME_LIMITS} from '../services/work-config.js';
import {overlayId} from '../domain/work-items.js';
import {postponeChipHtml} from '../ui/cockpit.js';

async function openDb(name) {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(name, SCHEMA_VERSION);
    r.onupgradeneeded = e => upgradeSchema(r.result, e.target.transaction);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

const poaRow = (o = {}) => ({
  id: o.id || uid(), poaNumber: o.poaNumber || '1', clientId: o.clientId || '', fileId: '',
  issuedDate: o.issuedDate || '2020-01-01', expiryDate: o.expiryDate || '', isArchived: Boolean(o.isArchived),
  createdAt: Clock.now(), updatedAt: Clock.now(), version: 1, isDeleted: false
});
const overlayRow = (sourceId, dueDate, postponeCount) => ({
  id: overlayId('procedures', sourceId), kind: 'overlay', sourceType: 'procedures', sourceId, dueDate,
  status: 'postponed', priority: null, tags: [], pinnedAt: null, quadrant: null, originalDueDate: dueDate,
  postponeCount, commentCount: 0, completedAt: null, completedBy: null, completedFor: null, cancelledAt: null,
  cancelledFor: null, statusBeforeComplete: null, archivedAt: null, isArchived: false, isDeleted: false,
  createdAt: Clock.now(), updatedAt: Clock.now(), version: 1
});

export async function runDashboardBriefTests(test, expect) {
  const today = Clock.today(), tomorrow = addDays(today, 1);
  const db = await openDb(`AhmadKhudairLawOfficeDB__test__dashboard__${Date.now()}`);
  const office = new Office({db, assert() {}, token: 'dash-test', profile: {id: 'dash-test'}});

  // --- سياق قانوني mínimas: موكل ← ملف ← قضية ---
  const client = await office.saveClient({fullName: 'موكل اختبار لوحة المعلومات'});
  const file = await createLegalFile(office, {clientId: client.id, title: 'ملف اختبار لوحة المعلومات', fileType: 'مدني'});
  const stage = await office.createCase({fileId: file.id, stageType: 'دعوى', caseNumber: '778', caseYear: '2026'});

  // --- بيانات: جلسات اليوم/غدًا/أسبوع/أبعد + أعمال متأخرة/اليوم/غدًا/أسبوع/أبعد/منجزة + توكيلات ---
  const hearing = (label, date, extra = {}) => saveOperational(office, 'hearings', {caseId: stage.id, fileId: file.id, hearingDate: date, hearingTime: '09:00', type: 'نظر', reason: `جلسة ${label}`, ...extra});
  const hToday = await hearing('h-today', today);
  const hTomorrow = await hearing('h-tomorrow', tomorrow);
  const hWeek = await hearing('h-week', addDays(today, 5));
  await hearing('h-beyond', addDays(today, 20));
  const proc = (label, due, extra = {}) => saveOperational(office, 'procedures', {fileId: file.id, caseId: '', description: `عمل ${label}`, type: 'متابعة', internalDueDate: due, status: 'open', ...extra});
  const pOverdue = await proc('p-overdue', addDays(today, -3));
  const pToday = await proc('p-today', today);
  const pTomorrow = await proc('p-tomorrow', tomorrow);
  const pWeek = await proc('p-week', addDays(today, 6));
  await proc('p-beyond', addDays(today, 20));
  await proc('p-done', addDays(today, -3), {status: 'done'});
  const pPendingLate = await proc('p-pending-late', addDays(today, -2), {status: 'pending'});
  await office.r.powersOfAttorney.put(poaRow({id: 'poa-expired', poaNumber: 'E1', expiryDate: addDays(today, -1)}));
  await office.r.powersOfAttorney.put(poaRow({id: 'poa-expired-archived', poaNumber: 'E2', expiryDate: addDays(today, -2), isArchived: true}));
  await office.r.powersOfAttorney.put(poaRow({id: 'poa-soon', poaNumber: 'S1', expiryDate: addDays(today, 10)}));
  await office.r.powersOfAttorney.put(poaRow({id: 'poa-far', poaNumber: 'S2', expiryDate: addDays(today, 60)}));

  // --- 1) عدّ الاستعلامات: 6 reportRange بالضبط ( بدل 9) ---
  test('dashboardBrief: 9 reportRange ← 6 بعد الدمج (استعلام واحد لكل عائلة نطاقات)', async () => {
    const counters = {};
    const originals = new Map();
    for (const [store, repo] of Object.entries(office.r)) {
      if (typeof repo.reportRange !== 'function') continue;
      originals.set(repo, repo.reportRange);
      repo.reportRange = async opts => { counters[store] = (counters[store] || 0) + 1; return originals.get(repo).call(repo, opts); };
    }
    await dashboardBrief(office);
    for (const [repo, orig] of originals) repo.reportRange = orig;
    const total = Object.values(counters).reduce((a, b) => a + b, 0);
    expect(total).toBe(6);
    expect(counters.hearings).toBe(1);
    expect(counters.procedures).toBe(1);
    expect(counters.appointments).toBe(1);
    expect(counters.communications).toBe(1);
    expect(counters.files).toBe(1);
    expect(counters.powersOfAttorney).toBe(1);
  });

  const brief = await dashboardBrief(office);

  // --- 2) تقسيم الجلسات يطابق الاستعلامين القديمين ---
  test('تقسيم الجلسات: «اليوم» منفصلة عن «غدًا…أسبوع»، ما بعد أسبوع مستبعد', () => {
    expect(JSON.stringify(brief.todayHearings.map(h => h.id))).toBe(JSON.stringify([hToday.id]));
    expect(JSON.stringify(brief.upcomingHearings.map(h => h.id).sort())).toBe(JSON.stringify([hTomorrow.id, hWeek.id].sort()));
    expect(brief.upcomingHearings.length).toBe(2);
  });

  // --- 3) تقسيم الأعمال الإدارية ---
  test('تقسيم الأعمال: المتأخرة < اليوم (مفعّلة فقط)، قادمة ≥ غدًا، «اليوم» و«المنجزة» مستبعدتان', () => {
    expect(JSON.stringify(brief.overdueProcedures.map(p => p.id).sort())).toBe(JSON.stringify([pOverdue.id, pPendingLate.id].sort()));
    expect(JSON.stringify(brief.upcomingProcedures.map(p => p.id).sort())).toBe(JSON.stringify([pTomorrow.id, pWeek.id].sort()));
    expect(brief.overdueProcedures.some(p => p.id === pToday.id)).toBe(false);
    expect(brief.upcomingProcedures.some(p => p.id === pToday.id)).toBe(false);
    expect(brief.overdueProcedures.length).toBe(2);
  });

  // --- 4) تقسيم التوكيلات ---
  test('تقسيم التوكيلات: منتهٍ (غير مؤرشف) ← قريب الانتهاء (≤ 30 يومًا)', () => {
    expect(JSON.stringify(brief.expiredPoa.map(p => p.id))).toBe(JSON.stringify(['poa-expired']));
    expect(JSON.stringify(brief.expiringPoa.map(p => p.id))).toBe(JSON.stringify(['poa-soon']));
  });

  // --- 5) postponeCount من طبقة work-items ---
  test('postponeCount يُقرأ من الـ overlay للأعمال المتأخرة المعروضة (قراءة جماعية واحدة)', async () => {
    await office.r.workItems.put(overlayRow(pOverdue.id, addDays(today, -3), HOME_LIMITS.postponeReviewAt));
    let getManyRawCalls = 0, lastBatch = 0;
    const wi = office.r.workItems, orig = wi.getManyRaw.bind(wi);
    wi.getManyRaw = async ids => { getManyRawCalls++; lastBatch = ids.length; return orig(ids); };
    const b2 = await dashboardBrief(office);
    wi.getManyRaw = orig;
    const row = b2.overdueProcedures.find(p => p.id === pOverdue.id);
    const plain = b2.overdueProcedures.find(p => p.id === pPendingLate.id);
    expect(row.postponeCount).toBe(HOME_LIMITS.postponeReviewAt);
    expect(plain.postponeCount).toBe(0);
    expect(getManyRawCalls).toBe(1);           // قراءة جماعية واحدة — لا N+1
    expect(lastBatch).toBe(b2.overdueProcedures.length);
  });

  test('postponeCount ≥ حد config → العمل «يحتاج مراجعة» في طابور القرارات', async () => {
    // قبل إضافة الـ overlay: العدّاد 0 → «يتطلب إجراء»
    const modelOld = buildFocusModel(brief, {today, now: '08:00'});
    expect(modelOld.attention.find(x => x.id === `p:${pOverdue.id}`).group).toBe('act');
    const b2 = await dashboardBrief(office);
    const model2 = buildFocusModel(b2, {today, now: '08:00'});
    const item2 = model2.attention.find(x => x.id === `p:${pOverdue.id}`);
    expect(item2.group).toBe('review');
    expect(item2.postponeCount).toBe(HOME_LIMITS.postponeReviewAt);
  });

  test('postponeCount أقل من حد config → يبقى «يتطلب إجراء»', async () => {
    await office.r.workItems.put(overlayRow(pPendingLate.id, addDays(today, -2), 1));
    const b3 = await dashboardBrief(office);
    const model3 = buildFocusModel(b3, {today, now: '08:00'});
    const item3 = model3.attention.find(x => x.id === `p:${pPendingLate.id}`);
    expect(item3.group).toBe('act');
    expect(item3.postponeCount).toBe(1);
  });

  // --- 6) chip «↷ أُجّل N مرات» ---
  test('chip «↷ أُجّل N مرات» يظهر عند postponeCount ≥ 1 فقط', () => {
    expect(postponeChipHtml({postponeCount: 3})).toContain('↷ أُجّل 3 مرات');
    expect(postponeChipHtml({postponeCount: 0})).toBe('');
    expect(postponeChipHtml({})).toBe('');
    expect(postponeChipHtml({postponeCount: 2})).toContain('cp-chip--warn');
    db.close();
  });
}
