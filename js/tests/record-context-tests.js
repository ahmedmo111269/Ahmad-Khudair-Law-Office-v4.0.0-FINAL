// Record-context regression tests: relationship links must use registered routes and omit unavailable targets.
import {ENTITIES, entityRoute} from '../domain/entities.js';
import {kvHtml, bindRefLinks} from '../modules/record-page.js';

export function runRecordContextTests(test, expect) {
  test('سياق السجل: مراجع التنفيذ تفتح بطاقة التنفيذ المسجلة، لا مسار rec بديل', () => {
    const id = 'execution-context-link';
    expect(entityRoute('execution', id)).toBe(`exc:${id}`);
    expect(entityRoute('files', 'file-context-link')).toBe('file:file-context-link');
    expect(entityRoute('activityLog', 'activity-context-link')).toBe(null);
    const calls = [];
    const link = {dataset: {openRef: `execution:${id}`}, addEventListener(type, handler) { if (type === 'click') this.click = handler; }};
    bindRefLinks({go: route => calls.push(route)}, {querySelectorAll: selector => selector === '[data-open-ref]' ? [link] : []});
    link.click();
    expect(calls.join('|')).toBe(`exc:${id}`);
  });

  test('سياق السجل: المراجع غير المتاحة نص غير قابل للنقر وتظهر حالتها بوضوح', () => {
    const field = ENTITIES.executionParties.fields.find(item => item.k === 'executionId');
    const html = kvHtml([field], {executionId: 'deleted-execution-context'}, new Map());
    expect(html.includes('data-open-ref=')).toBe(false);
    expect(html.includes('السجل المرتبط غير متاح حاليًا')).toBe(true);
    const live = kvHtml([field], {executionId: 'live-execution-context'}, new Map([['live-execution-context', 'تنفيذ 12']]));
    expect(live.includes('data-open-ref="execution:live-execution-context"')).toBe(true);
  });
}
