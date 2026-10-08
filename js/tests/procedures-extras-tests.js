// اختبارات مرشحات ملخص الأعمال الإدارية (منطق خالص — بلا DOM ولا تخزين):
// كل شريحة تصفية تُطبَّق كـ AND مع مرشح الفترة في list-page ولا تُلغيه،
// والصفوف المنجزة/الملغاة لا تدخل مرشحات «المفتوح للإجراء».
import {procedureStatusFilter, PROCEDURE_STATUSES} from '../modules/procedures-extras.js';

const TODAY = '2026-10-07';
const rows = {
  openOverdue: {id: 'p1', status: 'open', internalDueDate: '2026-10-01'},
  openToday: {id: 'p2', status: 'open', internalDueDate: '2026-10-07'},
  pendingWeek: {id: 'p3', status: 'pending', internalDueDate: '2026-10-12'},
  openBeyondWeek: {id: 'p4', status: 'open', internalDueDate: '2026-10-20'},
  openUndated: {id: 'p5', status: 'open'},
  doneOverdue: {id: 'p6', status: 'done', internalDueDate: '2026-10-01'},
  cancelledUndated: {id: 'p7', status: 'cancelled'},
  missingStatus: {id: 'p8', internalDueDate: '2026-10-01'}
};

export async function runProceduresExtrasTests(test, expect) {
  test('الأعمال الإدارية/شرائح: كل شريحة معلنة تملك مرشحًا عدا «الكل»', () => {
    for (const [key] of PROCEDURE_STATUSES) {
      const filter = procedureStatusFilter(key, TODAY);
      if (key === 'all') { expect(filter === null).toBe(true); continue; }
      expect(typeof filter).toBe('function');
    }
  });

  test('الأعمال الإدارية/شرائح: الحالة تطابق مفتوح/منتظر فقط وبلا حقل يُعامل كمفتوح', () => {
    const open = procedureStatusFilter('open', TODAY);
    expect(open(rows.openToday)).toBe(true);
    expect(open(rows.pendingWeek)).toBe(false);
    expect(open(rows.doneOverdue)).toBe(false);
    expect(open(rows.cancelledUndated)).toBe(false);
    const pending = procedureStatusFilter('pending', TODAY);
    expect(pending(rows.pendingWeek)).toBe(true);
    expect(pending(rows.openToday)).toBe(false);
    // صف بلا حالة status يُعامل كمفتوح (statusOf افتراضيًا — نفسه في «المتأخرة» وفي «مفتوح»)
    expect(procedureStatusFilter('overdue', TODAY)(rows.missingStatus)).toBe(true);
    expect(open(rows.missingStatus)).toBe(true);
  });

  test('الأعمال الإدارية/شرائح: متأخرة/مستحقة/أسبوع/بلا موعد على تواريخ محسوبة', () => {
    const overdue = procedureStatusFilter('overdue', TODAY);
    expect(overdue(rows.openOverdue)).toBe(true);
    expect(overdue(rows.openToday)).toBe(false);
    expect(overdue(rows.doneOverdue)).toBe(false);
    expect(overdue({status: 'open'})).toBe(false);
    const dueToday = procedureStatusFilter('dueToday', TODAY);
    expect(dueToday(rows.openToday)).toBe(true);
    expect(dueToday(rows.openOverdue)).toBe(false);
    const week = procedureStatusFilter('week', TODAY);
    expect(week(rows.openToday)).toBe(true);
    expect(week(rows.pendingWeek)).toBe(true);
    expect(week(rows.openBeyondWeek)).toBe(false);
    const undated = procedureStatusFilter('undated', TODAY);
    expect(undated(rows.openUndated)).toBe(true);
    expect(undated(rows.cancelledUndated)).toBe(false);
    expect(undated(rows.openToday)).toBe(false);
  });

  test('الأعمال الإدارية/شرائح: المرشح يتجمع مع مرشح الفترة (AND) بدل إلغائه', () => {
    const statusFilter = procedureStatusFilter('overdue', TODAY);
    const periodFilter = row => row.internalDueDate >= '2026-09-01' && row.internalDueDate <= '2026-10-05';
    const both = row => (!statusFilter || statusFilter(row)) && (!periodFilter || periodFilter(row));
    expect(both(rows.openOverdue)).toBe(true);
    const outOfPeriod = {status: 'open', internalDueDate: '2026-08-15'};
    expect(both(outOfPeriod)).toBe(false);
    expect(both(rows.doneOverdue)).toBe(false);
  });
}
