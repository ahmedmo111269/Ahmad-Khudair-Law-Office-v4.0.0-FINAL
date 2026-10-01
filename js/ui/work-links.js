// =====================================================================
// مركز العمل — «المهام المرتبطة» داخل صفحات الملف/الموكل/السجل: لوحة صغيرة + زر «+ مهمة مرتبطة».
// تقرأ المهام المستقلة بفهارس fileId/clientId/relatedId (لا مسح) وتعرض الأحدث موعدًا؛ والفتح يتم في مجلّد مركز العمل.
// لا تنسخ شيئًا من السجل المضيف: المعرّف فقط يُخزَّن في المهمة.
// =====================================================================
import {esc} from './dom.js';
import {formatDate} from '../core/format.js';
import {Clock} from '../core/clock.js';
import {statusInfo, priorityInfo, classifyDue} from '../domain/work-items.js';
import {getWorkConfig} from '../services/work-config.js';

const INDEX = {fileId: 'fileId', clientId: 'clientId', relatedId: 'relatedId', caseId: 'caseId'};
const MAX_SHOWN = 8;

/** مهام مستقلة مرتبطة بمعرّف (مفتوحة أولًا ثم الأقرب موعدًا). */
export async function linkedNativeTasks(office, scope) {
  const [key, id] = Object.entries(scope).find(([k, v]) => INDEX[k] && v) || [];
  if (!key) return [];
  const rows = await office.r.workItems.byIndexAll(INDEX[key], id, {filter: r => r.kind === 'native' && !r.isArchived});
  const open = r => r.status !== 'done' && r.status !== 'cancelled';
  return rows.sort((a, b) => Number(open(b)) - Number(open(a)) || String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999')));
}

/** لوحة مهام مرتبطة جاهزة للإدراج. addAttr: خاصية الزر لتربط الصفحة المضيفة حدث «+ مهمة». */
export async function linkedTasksPanelHtml(office, scope, {title = 'المهام المرتبطة', collapseId = 'work-items', openByDefault = false, centerRoute = '', open = false} = {}) {
  const rows = await linkedNativeTasks(office, scope);
  const config = getWorkConfig(), today = Clock.today();
  const openCount = rows.filter(r => r.status !== 'done' && r.status !== 'cancelled').length;
  const list = rows.slice(0, MAX_SHOWN).map(r => {
    const st = statusInfo(r.status, config), pr = priorityInfo(r.priority, config), bucket = r.dueDate ? classifyDue(r.dueDate, today) : 'undated';
    const late = bucket === 'overdue' && r.status !== 'done' && r.status !== 'cancelled';
    return `<li class="wc-lt-row"><button type="button" class="wc-link" data-wc-open-item="${esc(r.id)}">${esc(r.title)}</button><span class="wc-chip" style="--wc-c:${esc(st.color)}">${esc(st.icon)} ${esc(st.label)}</span><span class="wc-chip" title="الأولوية">${esc(pr.icon)} ${esc(pr.mark)}</span><span class="wc-chip${late ? ' wc-chip--danger' : ''}">${late ? '⚠ ' : ''}${r.dueDate ? esc(formatDate(r.dueDate)) : 'بلا موعد'}</span></li>`;
  }).join('');
  return `<section class="panel wc-linked-panel" data-collapse-id="${esc(collapseId)}" data-collapse-default="${open || openCount ? 'open' : 'collapsed'}"><div class="panel-head"><h3>${esc(title)}</h3><span class="badge">${openCount} مفتوحة / ${rows.length}</span></div>
   ${rows.length ? `<ul class="wc-lt-list">${list}</ul>${rows.length > MAX_SHOWN ? `<p class="muted small">يعرض أول ${MAX_SHOWN} من ${rows.length}.</p>` : ''}` : '<p class="muted">لا مهام مرتبطة بعد.</p>'}
   <div class="sec-actions"><button type="button" class="primary small" data-wc-add-task>+ مهمة مرتبطة</button>${centerRoute ? `<button type="button" class="ghost small" data-route="${esc(centerRoute)}">عرض كل العمل في مركز العمل</button>` : ''}</div></section>`;
}

/** يربط أزرار اللوحة: فتح مهمة (مجلّد مركز العمل) و«+ مهمة مرتبطة». */
export function bindLinkedTasksPanel(app, root, {relatedType, relatedId, title = ''}) {
  root.querySelectorAll('[data-wc-open-item]').forEach(b => b.onclick = () => app.go(`rec:workItems:${b.dataset.wcOpenItem}`));
  root.querySelectorAll('[data-wc-add-task]').forEach(b => b.onclick = async () => {
    const {openLinkedTaskForm} = await import('./work-actions.js');
    openLinkedTaskForm(app, relatedType, relatedId, {title, onSaved: async () => { const {toast} = await import('./toast.js'); toast('تمت إضافة المهمة المرتبطة'); await app.refresh(); }});
  });
}
