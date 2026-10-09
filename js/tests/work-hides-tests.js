// ============================================================
// اختبارات الإخفاء المؤقت للعرض (work-hides): «إبقاء بلا موعد» و«ليس الآن».
//   • isHideActive: صلاحية الإخفاء (حدود Expiry) — دالة نقية.
//   • filterVisibleItems: تصفية العناصر المخفية — دالة نقية.
//   • endOfTodayISO: expiry = نهاية اليوم الحالي.
// ============================================================
import {isHideActive, filterVisibleItems, endOfTodayISO, canHideNotNow} from '../services/work-hides.js';

export async function runWorkHidesTests(test, expect) {
  test('isHideActive: ساري حتى «until» ثم ينتهي تلقائيًا', () => {
    const now = Date.parse('2026-10-08T12:00:00');
    const entry = {until: '2026-10-08T23:59:59.999Z'};
    expect(isHideActive(entry, now)).toBe(true);
    expect(isHideActive(entry, now + 1)).toBe(true);
    expect(isHideActive(entry, Date.parse('2026-10-09T00:00:00'))).toBe(false);
    expect(isHideActive(null, now)).toBe(false);
    expect(isHideActive({}, now)).toBe(false);
    expect(isHideActive({until: 'garbage'}, now)).toBe(false);
  });

  test('filterVisibleItems: العناصر المخفية (id موجود في الخريطة) تُزال من العرض', () => {
    const now = Date.parse('2026-10-08T12:00:00');   // بالتوقيت المحلي
    const items = [{id: 'a'}, {id: 'b'}, {id: 'c'}];
    // a: ساري (until = 2026-10-09 بالتوقيت المحلي) → مخفي. b: منتهٍ (أمس) → ظاهر.
    const later = new Date(now); later.setDate(later.getDate() + 1); later.setHours(23, 59, 59, 999);
    const map = {a: {until: later.toISOString()}, b: {until: '2000-01-01T00:00:00.000Z'}};
    expect(JSON.stringify(filterVisibleItems(items, map, now).map(i => i.id))).toBe(JSON.stringify(['b', 'c']));
    // بعد انتهاء صلاحية a أيضًا: تعود جميع العناصر
    const after = later.getTime() + 1000;
    expect(JSON.stringify(filterVisibleItems(items, map, after).map(i => i.id))).toBe(JSON.stringify(['a', 'b', 'c']));
    // خريطة فارغة أو null: لا تصفية
    expect(JSON.stringify(filterVisibleItems(items, null, now).map(i => i.id))).toBe(JSON.stringify(['a', 'b', 'c']));
    expect(JSON.stringify(filterVisibleItems(items, {}, now).map(i => i.id))).toBe(JSON.stringify(['a', 'b', 'c']));
  });

  test('Not Now allows only open noncritical dated work items', () => {
    const today = '2026-10-08';
    expect(canHideNotNow({isOpen: true, dueDate: '2026-10-10', sourceType: 'task'}, today)).toBe(true);
    expect(canHideNotNow({isOpen: true, dueDate: '', sourceType: 'task'}, today)).toBe(false);
    expect(canHideNotNow({isOpen: true, dueDate: today, sourceType: 'hearings'}, today)).toBe(false);
    expect(canHideNotNow({isOpen: true, dueDate: '2026-10-07', sourceType: 'procedures'}, today)).toBe(false);
    expect(canHideNotNow({isOpen: true, dueDate: '2026-10-10', sourceType: 'execution', priority: 'urgent'}, today)).toBe(false);
    expect(canHideNotNow({isOpen: true, dueDate: '2026-10-10', sourceType: 'execution', severity: 'critical'}, today)).toBe(false);
    expect(canHideNotNow({isOpen: true, dueDate: '2026-10-10', kind: 'poa', expiryDate: '2026-10-07'}, today)).toBe(false);
    expect(canHideNotNow({isOpen: false, dueDate: '2026-10-10', sourceType: 'task'}, today)).toBe(false);
  });

  test('endOfTodayISO: نهاية اليوم الحالي (23:59:59.999 بالتوقيت المحلي)', () => {
    const end = endOfTodayISO(new Date('2026-10-08T09:15:00'));
    const d = new Date(end);
    expect(d.getHours()).toBe(23); expect(d.getMinutes()).toBe(59); expect(d.getSeconds()).toBe(59); expect(d.getMilliseconds()).toBe(999);
    expect(Date.parse(end) > Date.parse('2026-10-08T09:15:00')).toBe(true);
    expect(Date.parse(end) < Date.parse('2026-10-09T00:00:00')).toBe(true);
  });
}
