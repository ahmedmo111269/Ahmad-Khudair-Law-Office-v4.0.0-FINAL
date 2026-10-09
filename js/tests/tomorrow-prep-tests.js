// ============================================================
// اختبارات تحضير الغد: وقت الإعداد + عناصر الغد + فجوة تشغيلية واضحة.
// ============================================================
import {tomorrowPrepCandidate} from '../services/tomorrow-prep.js';
import {sanitizeWorkConfig, DEFAULT_WORK_CONFIG} from '../services/work-config.js';

export async function runTomorrowPrepTests(test, expect) {
  const tomorrow = '2026-10-10';
  const brief = extra => ({
    periods: {tomorrow},
    todayHearings: [], upcomingHearings: [], upcomingProcedures: [], appointmentsNext3: [],
    ...extra
  });

  test('وقت تحضير الغد موجود في إعدادات مركز العمل ويُطبع إلى HH:MM', () => {
    expect(DEFAULT_WORK_CONFIG.tomorrowPrepAfter).toBe('17:00');
    expect(sanitizeWorkConfig({tomorrowPrepAfter: '18:30'}).tomorrowPrepAfter).toBe('18:30');
    expect(sanitizeWorkConfig({tomorrowPrepAfter: '25:70'}).tomorrowPrepAfter).toBe('17:00');
  });

  test('لا يظهر قبل وقت الإعداد المحدد', () => {
    const data = brief({upcomingHearings: [{id: 'h', hearingDate: tomorrow, hearingTime: '', fileId: ''}]});
    expect(tomorrowPrepCandidate(data, {now: '16:59', after: '17:00'})).toBe(null);
  });

  test('لا يظهر إن لم يكن للغد أي عنصر', () => {
    expect(tomorrowPrepCandidate(brief({}), {now: '18:00', after: '17:00'})).toBe(null);
  });

  test('جلسة الغد بلا ملف مرتبط فجوة تشغيلية واضحة بعد الوقت المحدد', () => {
    const data = brief({upcomingHearings: [{id: 'h1', hearingDate: tomorrow, hearingTime: '10:00', fileId: ''}]});
    const result = tomorrowPrepCandidate(data, {now: '17:00', after: '17:00'});
    expect(result.kind).toBe('missingFile');
    expect(result.item.id).toBe('h1');
  });

  test('جلسة الغد بلا وقت محدد فجوة قابلة للتصرف بعد الوقت المحدد', () => {
    const data = brief({upcomingHearings: [{id: 'h2', hearingDate: tomorrow, hearingTime: '', fileId: 'file-1'}]});
    const result = tomorrowPrepCandidate(data, {now: '20:00', after: '17:00'});
    expect(result.kind).toBe('missingTime');
    expect(result.item.id).toBe('h2');
  });

  test('لا يظهر لمجرد وجود جلسة غدٍ مكتملة البيانات', () => {
    const data = brief({upcomingHearings: [{id: 'h3', hearingDate: tomorrow, hearingTime: '09:30', fileId: 'file-1'}]});
    expect(tomorrowPrepCandidate(data, {now: '20:00', after: '17:00'})).toBe(null);
  });

  test('لا يظهر إن كانت عناصر الغد الأخرى موجودة لكن لا توجد فجوة جلسة واضحة', () => {
    const data = brief({upcomingProcedures: [{id: 'p', internalDueDate: tomorrow}], appointmentsNext3: [{id: 'a', date: tomorrow}]});
    expect(tomorrowPrepCandidate(data, {now: '20:00', after: '17:00'})).toBe(null);
  });
}
