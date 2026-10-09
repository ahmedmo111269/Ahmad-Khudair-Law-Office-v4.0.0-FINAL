// ============================================================
// اختبارات «مساحة اليوم» (Today View — Phase E):
//   • نافذة «الآن» من الإعدادات: −30/+90 دقيقة (HOME_LIMITS.nowWindow).
//   • nowAndNext بحدود النافذة: الحواف مضبوطة (داخل/خارج).
//   • الترتيب: «الآن» مرتّبة صعودًا بالوقت، «التالي» = أقرب عنصر بعد نافذة الآن.
//   • العناصر بلا وقت أو المغلقة لا تدخل «الآن» ولا «التالي».
import {nowAndNext} from '../services/work-query.js';
import {HOME_LIMITS} from '../services/work-config.js';

const item = (id, dueTime, {isOpen = true} = {}) => ({id, dueTime, isOpen});

const hhmm = (h, m = 0) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

export async function runTodayViewTests(test, expect) {
  test('HOME_LIMITS.nowWindow = −30/+90 دقيقة (إعداد «مساحة اليوم»)', () => {
    expect(HOME_LIMITS.nowWindow.before).toBe(30);
    expect(HOME_LIMITS.nowWindow.after).toBe(90);
  });

  test('نافذة الآن (−30/+90): الحافة +90 هي آخر «الآن» (+91 هو «التالي»)', () => {
    const items = [item('edgeBefore', hhmm(8, 30)), item('a', hhmm(10, 29)), item('b', hhmm(10, 30)), item('c', hhmm(10, 31))];
    const {now, next} = nowAndNext(items, hhmm(9, 0), {windowBefore: 30, windowAfter: 90});
    expect(JSON.stringify(now.map(i => i.id))).toBe(JSON.stringify(['edgeBefore', 'a', 'b']));
    expect(next && next.id).toBe('c');
  });

  test('نافذة الآن: الحافة −30 دقيقة — ما قبلها خارج «الآن»', () => {
    const items = [item('early', hhmm(8, 29)), item('edge', hhmm(8, 30)), item('now', hhmm(9, 0))];
    const {now, next} = nowAndNext(items, hhmm(9, 0), {windowBefore: 30, windowAfter: 90});
    expect(JSON.stringify(now.map(i => i.id))).toBe(JSON.stringify(['edge', 'now']));
    expect(next).toBe(null);   // العنصر الماضي لا يكون «التالي» أبدًا
  });

  test('الافتراضي القديم (60/30) يختلف عن نافذة الإعدادات — renderToday يستخدم الإعدادات', () => {
    const items = [item('plus60', hhmm(10, 0))];
    const oldDefaults = nowAndNext(items, hhmm(9, 0));   // 60/30
    expect(oldDefaults.now.length).toBe(0);
    expect(oldDefaults.next && oldDefaults.next.id).toBe('plus60');
    const configured = nowAndNext(items, hhmm(9, 0), {windowBefore: HOME_LIMITS.nowWindow.before, windowAfter: HOME_LIMITS.nowWindow.after});
    expect(JSON.stringify(configured.now.map(i => i.id))).toBe(JSON.stringify(['plus60']));
    expect(configured.next).toBe(null);
  });

  test('«الآن» مرتّبة صعودًا بالوقت و«التالي» هو أقرب عنصر بعد +90 دقيقة', () => {
    const items = [item('late', hhmm(10, 31)), item('mid', hhmm(10, 15)), item('soon', hhmm(9, 15)), item('after', hhmm(10, 30))];
    const {now, next} = nowAndNext(items, hhmm(9, 0), {windowBefore: 30, windowAfter: 90});
    expect(JSON.stringify(now.map(i => i.id))).toBe(JSON.stringify(['soon', 'mid', 'after']));
    expect(next && next.id).toBe('late');
  });

  test('عناصر بلا وقت أو مغلقة لا تدخل «الآن» ولا «التالي»', () => {
    const items = [{id: 'noTime', isOpen: true, dueTime: ''}, {id: 'done', dueTime: hhmm(9, 10), isOpen: false}, item('ok', hhmm(9, 10))];
    const {now, next} = nowAndNext(items, hhmm(9, 0), {windowBefore: 30, windowAfter: 90});
    expect(JSON.stringify(now.map(i => i.id))).toBe(JSON.stringify(['ok']));
    expect(next).toBe(null);
  });
}
