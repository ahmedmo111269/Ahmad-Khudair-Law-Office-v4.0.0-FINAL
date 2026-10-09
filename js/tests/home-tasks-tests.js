// اختبار قسم المهام في الرئيسية: نفس استعلام مركز العمل، بصفوف محدودة وروابط للمهمة الأصلية.
import {upgradeSchema} from '../db/schema.js';
import {SCHEMA_VERSION} from '../core/constants.js';
import {Office} from '../services/office.js';
import {saveWorkItem, completeItem} from '../services/work-items.js';
import {loadHomeTasks} from '../modules/home.js';
import {homeTasksHtml} from '../ui/cockpit.js';
import {HOME_LIMITS} from '../services/work-config.js';
import {Clock, addDays} from '../core/clock.js';

function openDb(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, SCHEMA_VERSION);
    request.onupgradeneeded = event => upgradeSchema(request.result, event.target.transaction);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function runHomeTasksTests(test, expect) {
  test('الرئيسية/المهام: تقرأ المهام المستقلة المفتوحة من Query مركز العمل وتعلن القصّ', async () => {
    const name = `AhmadKhudairLawOfficeDB__test__home-tasks__${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const db = await openDb(name);
    const office = new Office({db, assert() {}, token: `home-tasks-${name}`, profile: {id: `home-tasks-${name}`}});
    try {
      const today = Clock.today();
      const overdue = await saveWorkItem(office, {title: 'HOME_TASK_OVERDUE', dueDate: addDays(today, -1), priority: 'urgent'});
      await saveWorkItem(office, {title: 'HOME_TASK_TODAY', dueDate: today});
      for (let i = 0; i < HOME_LIMITS.homeTasks; i += 1) {
        await saveWorkItem(office, {title: `HOME_TASK_FUTURE_${i}`, dueDate: addDays(today, i + 2)});
      }
      const completed = await saveWorkItem(office, {title: 'HOME_TASK_COMPLETED', dueDate: today});
      await completeItem(office, completed.id);

      const page = await loadHomeTasks(office);
      expect(page.items.length).toBe(HOME_LIMITS.homeTasks);
      expect(page.hasMore).toBe(true);
      expect(page.items[0].id).toBe(overdue.id);
      expect(page.items.every(item => item.kind === 'native' && item.sourceType === 'task' && item.isOpen)).toBe(true);
      expect(page.items.some(item => item.id === completed.id)).toBe(false);
    } finally {
      db.close();
      indexedDB.deleteDatabase(name);
    }
  });

  test('الرئيسية/المهام: كل صف يفتح المهمة في مركز العمل ويظهر البديل الفارغ', () => {
    const markup = homeTasksHtml({
      items: [{id: 'HOME-TASK-1', title: 'مراجعة ملف الموكل', dueDate: '2026-10-08', dueTime: '09:15', priority: 'urgent', statusLabel: 'قيد التنفيذ'}],
      hasMore: true,
      today: '2026-10-09'
    });
    expect(markup.includes('data-section-id="tasks"')).toBe(true);
    expect(markup.includes('data-route="rec:workItems:HOME-TASK-1"')).toBe(true);
    expect(markup.includes('متأخرة')).toBe(true);
    expect(markup.includes('مراجعة ملف الموكل')).toBe(true);
    expect(markup.includes('آخر التحركات')).toBe(false);

    const empty = homeTasksHtml({items: [], today: '2026-10-09'});
    expect(empty.includes('لا توجد مهام مفتوحة في مركز العمل.')).toBe(true);
    expect(empty.includes('data-route="actionCenter"')).toBe(true);
  });
}
