// ============================================================
// اختبارات «يومي» (My Day): اختيارات المستخدم في prefs، بلا Store جديد.
//   • مفاتيح الاختيار مرتبطة بالتاريخ المحلي وتنتهي تلقائيًا مع اليوم.
//   • تنظيف المعرفات الفارغة والمكررة، والإضافة/الإزالة idempotent.
// ============================================================
import {prefs} from '../core/preferences.js';
import {localDate} from '../core/clock.js';
import {PICKS_KEY, todayKey, picksForDate, getPicks, pickForToday, unpickForToday} from '../services/my-day.js';

export async function runMyDayTests(test, expect) {
  test('todayKey uses the local calendar date', () => {
    const date = new Date(2026, 9, 8, 23, 59, 0);
    expect(todayKey(date)).toBe(localDate(date));
  });

  test('picksForDate returns unique nonempty ids only for the saved date', () => {
    const raw = {date: '2026-10-08', ids: ['a', '', 'b', 'a', 3, 'c']};
    expect(JSON.stringify(picksForDate(raw, '2026-10-08'))).toBe(JSON.stringify(['a', 'b', 'c']));
    expect(JSON.stringify(picksForDate(raw, '2026-10-09'))).toBe(JSON.stringify([]));
    expect(JSON.stringify(picksForDate({date: '2026-10-08', ids: 'a'}, '2026-10-08'))).toBe(JSON.stringify([]));
    expect(JSON.stringify(picksForDate(null, '2026-10-08'))).toBe(JSON.stringify([]));
  });

  test('getPicks expires automatically on the next local date', () => {
    const beforeMidnight = new Date(2026, 9, 8, 23, 59, 59);
    const nextDay = new Date(2026, 9, 9, 0, 0, 1);
    const date = todayKey(beforeMidnight);
    expect(JSON.stringify(picksForDate({date, ids: ['picked']}, todayKey(beforeMidnight)))).toBe(JSON.stringify(['picked']));
    expect(JSON.stringify(picksForDate({date, ids: ['picked']}, todayKey(nextDay)))).toBe(JSON.stringify([]));
  });

  test('pickForToday and unpickForToday persist only today ids and are idempotent', async () => {
    const previous = prefs.get(PICKS_KEY, null);
    try {
      await prefs.set(PICKS_KEY, null);
      await pickForToday('task-a');
      await pickForToday('task-a');
      await pickForToday('task-b');
      expect(JSON.stringify(getPicks())).toBe(JSON.stringify(['task-a', 'task-b']));
      await unpickForToday('task-a');
      await unpickForToday('missing');
      expect(JSON.stringify(getPicks())).toBe(JSON.stringify(['task-b']));
      const stored = prefs.get(PICKS_KEY, null);
      expect(stored.date).toBe(todayKey());
      expect(JSON.stringify(stored.ids)).toBe(JSON.stringify(['task-b']));
    } finally {
      await prefs.set(PICKS_KEY, previous);
    }
  });
}
