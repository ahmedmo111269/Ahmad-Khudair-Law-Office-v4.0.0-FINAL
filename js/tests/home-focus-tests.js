// ============================================================
// اختبارات «مكتب اليوم» — المنطق النقي فقط (بلا DOM وبلا IndexedDB):
//   • reasonCode لكل عنصر مشتق من بيانات موجودة، والنص من work-config.js وحده.
//   • الجلسة المُسجَّلة (لها نتيجة) تخرج من الطابور و«الآن» وتبقى في جدول اليوم.
//   • طبقات الطابور: يتطلب إجراء / يحتاج مراجعة / للمتابعة.
//   • التعارض الصريح فقط: وقت بداية متطابق بين عناصر غير مُسجّلة.
//   • «منذ آخر زيارة»: لا تراجع للقيمة، وقص العدد بإعلان صريح، وأول تشغيل بلا قسم.
// ============================================================
import {buildFocusModel, detectSameStartConflicts} from '../services/focus-engine.js';
import {reasonText, actionKeyFor, ACTION_LABEL, HOME_LIMITS, REASON_TEXT} from '../services/work-config.js';
import {nextLastSeen, sinceChanges} from '../services/home-visit.js';
import {addDays} from '../core/clock.js';

const TODAY = '2026-10-08';
const brief = (o = {}) => ({
  todayHearings: [], upcomingHearings: [], overdueProcedures: [], upcomingProcedures: [],
  appointmentsNext3: [], followupsThisWeek: [], staleFiles: [], expiringPoa: [], expiredPoa: [],
  executionAttention: [], ...o
});

export async function runHomeFocusTests(test, expect) {
  test('الجلسة المُسجَّلة اليوم لا تدخل الطابور ولا «الآن»، وتبقى في جدول اليوم بعلامة', () => {
    const m = buildFocusModel(brief({todayHearings: [
      {id: 'h1', hearingTime: '09:00', reason: 'مرافعة', result: 'تأجيل للمستندات'},
      {id: 'h2', hearingTime: '11:00', reason: 'تنفيذ', result: ''}
    ]}), {today: TODAY, now: '08:00'});
    expect(m.attention.some(x => x.id === 'h:h1')).toBe(false);
    expect(m.next.id).toBe('h:h2');
    expect(m.next.reasonCode).toBe('SESSION_TODAY');
    const row = m.timeline.find(x => x.id === 'h:h1');
    expect(row.done).toBe(true);
    expect(row.kind).toBe('hearing');
  });

  test('الجلسة اليوم بلا نتيجة: الإجراء «تسجيل النتيجة» ومرجعه SESSION_TODAY', () => {
    const m = buildFocusModel(brief({todayHearings: [{id: 'h3', hearingTime: '10:00', reason: 'مرافعة', result: ''}]}), {today: TODAY});
    expect(m.next.actionLabel).toBe(ACTION_LABEL.recordResult);
    expect(actionKeyFor('hearing', {today: true, done: false})).toBe('recordResult');
    expect(actionKeyFor('hearing', {today: true, done: true})).toBe('openHearing');
  });

  test('كل عنصر يحمل reasonCode صالحًا من جدول النصوص المركزي', () => {
    const m = buildFocusModel(brief({
      todayHearings: [{id: 'h', hearingTime: '09:00', result: ''}],
      upcomingHearings: [{id: 'hu', hearingDate: addDays(TODAY, 3)}],
      overdueProcedures: [{id: 'po', internalDueDate: addDays(TODAY, -4), priority: 'high'}],
      upcomingProcedures: [{id: 'pu', internalDueDate: addDays(TODAY, 2), priority: 'urgent'}, {id: 'pv', internalDueDate: addDays(TODAY, 4), priority: 'medium'}],
      expiredPoa: [{id: 'a1', expiryDate: addDays(TODAY, -1)}],
      expiringPoa: [{id: 'a2', expiryDate: addDays(TODAY, 5)}],
      appointmentsNext3: [{id: 'ap', date: TODAY, time: '15:00'}],
      followupsThisWeek: [{id: 'c', followUpDate: addDays(TODAY, 1)}],
      staleFiles: [{id: 'f', lastActivityAt: '2026-08-01T00:00:00'}],
      executionAttention: [{id: 'e', overdueMinor: 5, date: TODAY}]
    }), {today: TODAY});
    expect(m.attention.length).toBeTruthy();
    for (const x of [...m.attention, ...m.timeline]) {
      expect(Boolean(REASON_TEXT[x.reasonCode])).toBe(true);
      const r = reasonText(x.reasonCode, x.reasonParams);
      expect(r.title.length > 0).toBe(true);
      expect(r.why.includes('{')).toBe(false); // لا placeholder غير مملوء
    }
    const codes = new Set(m.attention.map(x => x.reasonCode));
    for (const c of ['SESSION_TODAY', 'OVERDUE', 'HIGH_PRIORITY', 'DUE_SOON', 'POA_EXPIRED', 'POA_EXPIRING', 'APPT_TODAY', 'FOLLOWUP_DUE', 'STALE_FILE', 'EXECUTION_URGENT', 'SESSION_SOON'])
      expect(codes.has(c)).toBe(true);
  });

  test('طبقات الطابور: المتأخر والجلسة والتوكيل المنتهي في «يتطلب إجراء»، والراكد والتوكيل القريب في «مراجعة»', () => {
    const m = buildFocusModel(brief({
      todayHearings: [{id: 'h', hearingTime: '09:00', result: ''}],
      overdueProcedures: [{id: 'po', internalDueDate: addDays(TODAY, -2)}],
      expiredPoa: [{id: 'a1', expiryDate: addDays(TODAY, -1)}],
      expiringPoa: [{id: 'a2', expiryDate: addDays(TODAY, 20)}],
      staleFiles: [{id: 'f', lastActivityAt: '2026-07-01T00:00:00'}],
      upcomingProcedures: [{id: 'pu', internalDueDate: addDays(TODAY, 4), priority: 'medium'}]
    }), {today: TODAY});
    const g = key => m.groups.find(x => x.key === key).items.map(x => x.id);
    expect(g('act').includes('h:h')).toBe(true);
    expect(g('act').includes('p:po')).toBe(true);
    expect(g('act').includes('a:a1')).toBe(true);
    expect(g('review').includes('a:a2')).toBe(true);
    expect(g('review').includes('f:f')).toBe(true);
    expect(g('follow').includes('p:pu')).toBe(true);
    expect(g('act').includes('f:f')).toBe(false);
  });

  test('التأجيل المتكرر ينقل العمل المتأخر إلى «يحتاج مراجعة» بحد العتبة، لا قبلها', () => {
    const at = HOME_LIMITS.postponeReviewAt;
    const m1 = buildFocusModel(brief({overdueProcedures: [{id: 'p', internalDueDate: addDays(TODAY, -1), postponeCount: at}]}), {today: TODAY});
    const m2 = buildFocusModel(brief({overdueProcedures: [{id: 'p', internalDueDate: addDays(TODAY, -1), postponeCount: at - 1}]}), {today: TODAY});
    expect(m1.attention[0].group).toBe('review');
    expect(m2.attention[0].group).toBe('act');
  });

  test('التعارض الصريح: وقت بداية متطابق بين عناصر غير مُسجّلة فقط', () => {
    const m = buildFocusModel(brief({
      todayHearings: [{id: 'h1', hearingTime: '10:00', result: ''}],
      appointmentsNext3: [{id: 'ap1', date: TODAY, time: '10:00', title: 'موعد عميل'}, {id: 'ap2', date: TODAY, time: '12:00', title: 'آخر'}],
    }), {today: TODAY});
    expect(m.conflicts.length).toBe(1);
    expect(m.conflicts[0].time).toBe('10:00');
    expect(m.timeline.filter(x => x.conflict).length).toBe(2);
    expect(m.attention.some(x => x.kind === 'conflict' && x.group === 'review')).toBe(true);
    // جلسة مُسجّلة في نفس الوقت لا تُحسب تعارضًا
    const m2 = buildFocusModel(brief({
      todayHearings: [{id: 'h1', hearingTime: '10:00', result: 'تم'}],
      appointmentsNext3: [{id: 'ap1', date: TODAY, time: '10:00'}]
    }), {today: TODAY});
    expect(m2.conflicts.length).toBe(0);
  });

  test('عناصر بلا وقت لا تدخل التعارض، ولا تُعد أكثر من عنصر في الوقت نفسه بلا داعٍ', () => {
    const rows = [{id: 'a', time: '', kind: 'followup'}, {id: 'b', time: '', kind: 'followup'}, {id: 'c', time: '09:00', kind: 'hearing'}];
    expect(detectSameStartConflicts(rows).length).toBe(0);
  });

  test('الاتجاه الزمني: الأعمال غير الجلسات لا تُسجَّل كـ«مُسجّلة» حتى لو وُجد حقل نتيجة', () => {
    const m = buildFocusModel(brief({overdueProcedures: [{id: 'p', internalDueDate: addDays(TODAY, -1), result: 'تم'}]}), {today: TODAY});
    expect(m.attention.some(x => x.id === 'p:p')).toBe(true);
  });

  test('أول تشغيل بلا قيمة سابقة: لا تغييرات ولا قسم', () => {
    const r = sinceChanges([{timestamp: '2026-10-07T10:00:00.000Z'}], null);
    expect(r.total).toBe(0);
    expect(r.rows.length).toBe(0);
  });

  test('منذ آخر زيارة: يعرض ما بعد خط الأساس فقط، وبحد أقصى 15 مع إعلان القص', () => {
    const base = '2026-10-07T12:00:00.000Z';
    const rows = Array.from({length: 20}, (_, i) => ({timestamp: `2026-10-08T${String(i % 10).padStart(2, '0')}:00:00.000Z`, id: i}));
    rows.push({timestamp: '2026-10-06T00:00:00.000Z', id: 'old'});
    const r = sinceChanges(rows, base);
    expect(r.rows.every(x => x.id !== 'old')).toBe(true);
    expect(r.rows.length).toBe(HOME_LIMITS.sinceLastVisit);
    expect(r.capped).toBe(true);
    const small = sinceChanges([{timestamp: '2026-10-08T01:00:00.000Z'}], base);
    expect(small.capped).toBe(false);
    expect(small.total).toBe(1);
  });

  test('منذ آخر زيارة: لا تراجع للقيمة عند كتابة تبويب أقدم، والقيمة الأحدث تُستبدل', () => {
    const newer = '2026-10-08T10:00:00.000Z';
    const older = '2026-10-08T09:00:00.000Z';
    expect(nextLastSeen(newer, older)).toBe(newer);
    expect(nextLastSeen(older, newer)).toBe(new Date(newer).toISOString());
    expect(nextLastSeen(null, newer)).toBe(new Date(newer).toISOString());
    expect(nextLastSeen(older, 'not-a-date')).toBe(older);
  });
}
