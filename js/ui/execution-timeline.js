// =====================================================================
// Timeline أفقي لدورة التنفيذ — أعلى تبويب «السجل»
// ---------------------------------------------------------------------
// حكم → صيغة تنفيذية → إعلان → تكليف بالوفاء → توكيل → تحصيل/حجز → تبديد → توكيل جديد
// • أيقونة + تاريخ + حالة + رقم مستند، والنقر يفتح تفاصيل الواقعة نفسها.
// • RTL بالكامل: الترتيب البصري من اليمين إلى اليسار بلا قلب للمراحل.
// • لا يبتكر وقائع: كل عقدة مشتقة من سجل موجود (حكم/إجراء/محضر/توكيل).
// =====================================================================
import {esc} from './dom.js';
import {isCivilDate} from '../domain/execution-calendar.js';

const display = iso => (isCivilDate(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');

/**
 * مراحل الدورة بالترتيب المنطقي. `match` يبحث في وقائع التنفيذ عن أول سجل
 * يحقق الشرط؛ `repeat` يعني أن المرحلة تتكرر (تحصيل/توكيل) فتُعرض كل وقائعها.
 */
export const EXECUTION_STAGES = Object.freeze([
  {key: 'judgment', label: 'حكم', icon: '⚖️', match: item => item.kind === 'judgment'},
  {key: 'executive_formula', label: 'صيغة تنفيذية', icon: '📜', match: item => matchesKind(item, ['executive_formula', 'صيغة تنفيذية'])},
  {key: 'notice', label: 'إعلان', icon: '📨', match: item => matchesKind(item, ['notice', 'summons_notice', 'إعلان'])},
  {key: 'summons', label: 'تكليف بالوفاء', icon: '📣', match: item => matchesKind(item, ['summons', 'تكليف بالوفاء'])},
  {key: 'poa', label: 'توكيل', icon: '🖨', match: item => item.kind === 'poa', repeat: true},
  {key: 'collection', label: 'تحصيل / حجز', icon: '💰', match: item => item.kind === 'receipt' || matchesKind(item, ['seizure', 'sale_notice', 'sale_session', 'حجز']), repeat: true},
  {key: 'dissipation', label: 'تبديد', icon: '⚠️', match: item => matchesKind(item, ['dissipation', 'محضر تبديد', 'misdemeanor', 'جنحة'])},
  {key: 'petition', label: 'عريضة / طلب', icon: '📄', match: item => matchesKind(item, ['petition', 'request', 'refusal_record', 'عريضة'])},
  {key: 'poa_new', label: 'توكيل جديد', icon: '🆕', match: item => item.kind === 'poa', repeat: true, onlyAfterFirst: true},
  {key: 'other', label: 'إجراءات أخرى', icon: '🗂', match: () => false, repeat: true}
]);

function matchesKind(item, keys) {
  if (item.kind !== 'action') return false;
  const haystack = `${item.kindCode || ''} ${item.title || ''}`.toLowerCase();
  return keys.some(key => haystack.includes(String(key).toLowerCase()));
}

/**
 * وقائع موحّدة من حزمة البطاقة (نفس بيانات تبويب السجل — لا قراءة جديدة).
 * `items` هي مخرجات `timelineItems(bundle)` في execution-center.js.
 */
export function buildStageNodes(items = [], {today = ''} = {}) {
  const live = (items || []).filter(item => !item.voided);
  const voided = (items || []).filter(item => item.voided);
  const used = new Set();
  const nodes = [];
  for (const stage of EXECUTION_STAGES) {
    const hits = live.filter(item => !used.has(item.id) && stage.match(item));
    if (!hits.length) { nodes.push({stage, status: 'pending', items: []}); continue; }
    const ordered = hits.slice().sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
    if (stage.onlyAfterFirst && ordered.length < 2) { nodes.push({stage, status: 'pending', items: []}); continue; }
    const shown = stage.onlyAfterFirst ? ordered.slice(1) : ordered;
    for (const item of shown) used.add(item.id);
    nodes.push({stage, status: 'done', items: shown});
  }
  // ما لم يطابق أي مرحلة يُجمع في «إجراءات أخرى» حتى لا تختفي واقعة مسجَّلة.
  const rest = live.filter(item => !used.has(item.id));
  const otherNode = nodes.find(node => node.stage.key === 'other');
  if (otherNode) { otherNode.items = rest.sort((a, b) => String(a.date || '').localeCompare(String(b.date || ''))); otherNode.status = rest.length ? 'done' : 'pending'; }
  return {nodes, voidedCount: voided.length, today};
}

/** عقدة واحدة: أيقونة + عنوان + تاريخ + حالة + رقم مستند. */
function nodeMarkup(node, index) {
  const first = node.items[0] || null;
  const count = node.items.length;
  const done = node.status === 'done';
  const docNumber = first?.referenceNumber || first?.documentNumber || (first?.kind === 'poa' ? first?.poaNumber : '') || '';
  const ids = node.items.map(item => esc(item.id)).join(',');
  return `<li class="tl-node${done ? ' is-done' : ' is-pending'}" data-stage="${esc(node.stage.key)}" data-index="${index}">
    <button type="button" class="tl-dot" data-tl-node="${esc(node.stage.key)}" data-tl-items="${ids}" ${done ? '' : 'disabled'}
      aria-label="${esc(node.stage.label)} — ${done ? `${count} واقعة` : 'لم يحدث بعد'}">
      <span class="tl-icon" aria-hidden="true">${esc(node.stage.icon)}</span>
    </button>
    <span class="tl-label">${esc(node.stage.label)}</span>
    <span class="tl-meta">${done ? `${esc(display(first?.date))}${count > 1 ? ` <b class="badge">${count}</b>` : ''}` : '<span class="muted">لم يحدث بعد</span>'}</span>
    ${docNumber ? `<span class="tl-doc muted">${esc(docNumber)}</span>` : ''}
  </li>`;
}

/** شريط الـ Timeline الأفقي (RTL). */
export function executionTimelineMarkup(items = [], {today = '', collapsible = true} = {}) {
  const {nodes, voidedCount} = buildStageNodes(items, {today});
  const doneCount = nodes.filter(node => node.status === 'done').length;
  const body = `<ol class="tl-track" role="list">${nodes.map((node, index) => nodeMarkup(node, index)).join('')}</ol>`;
  const head = `<div class="tl-head">
      <h4>دورة التنفيذ</h4>
      <span class="badge">${doneCount}/${nodes.length} مرحلة</span>
      ${voidedCount ? `<span class="badge danger">${voidedCount} واقعة ملغاة</span>` : ''}
      <span class="muted small">اضغط أي مرحلة لعرض وقائعها</span>
    </div>`;
  // مضيف تفاصيل المرحلة داخل القسم نفسه — وإلا لم يجده الربط (كان في قسم آخر).
  if (!collapsible) return `<section class="panel exec-cycle" data-section-id="timeline" dir="rtl">${head}${body}<div data-tl-details class="tl-details-host"></div></section>`;
  return `<section class="panel exec-cycle" data-section-id="timeline" dir="rtl">
    <details open><summary>دورة التنفيذ <span class="muted small">(${doneCount}/${nodes.length} مرحلة)</span></summary>${head}${body}<div data-tl-details class="tl-details-host"></div></details>
  </section>`;
}

/** تفاصيل مرحلة: كل وقائعها مع أزرار التعديل/الطباعة نفسها الموجودة في السجل. */
export function timelineNodeDetails(nodes = [], stageKey) {
  const node = nodes.find(row => row.stage.key === stageKey);
  if (!node) return null;
  return {
    key: node.stage.key, label: node.stage.label, icon: node.stage.icon, status: node.status,
    items: node.items.map(item => ({
      id: item.id, kind: item.kind, title: item.title, subtitle: item.subtitle, date: item.date,
      amountMinor: item.amountMinor, currency: item.currency, canEdit: Boolean(item.canEdit),
      canVoid: Boolean(item.canVoid), canPrint: Boolean(item.canPrint), canReissue: Boolean(item.canReissue),
      canReallocate: Boolean(item.canReallocate)
    }))
  };
}

/**
 * ربط النقر: يفتح تفاصيل المرحلة في مكانها تحت الشريط (بلا نافذة إضافية)
 * ويعيد استخدام أزرار السجل القائمة عبر `onOpenItem`.
 */
export function bindExecutionTimeline(container, {getNodes = () => [], onOpenItem = null} = {}) {
  if (!container) return () => {};
  const detailsHost = container.querySelector('[data-tl-details]') || null;
  const handler = event => {
    const button = event.target.closest?.('[data-tl-node]');
    if (!button || button.disabled) return;
    const stageKey = button.dataset.tlNode;
    const nodes = getNodes() || [];
    const details = timelineNodeDetails(nodes, stageKey);
    container.querySelectorAll('[data-tl-node]').forEach(other => other.setAttribute('aria-current', String(other === button)));
    if (!detailsHost || !details) return;
    detailsHost.innerHTML = `<div class="tl-detail">
      <b>${esc(details.icon)} ${esc(details.label)}</b>
      <ul class="plain-list">${details.items.map(item => `<li class="log-item" data-log-item="${esc(item.id)}" data-type="${esc(item.kind)}">
          <div class="log-body"><b>${esc(item.title || '')}</b>
            <small class="muted">${esc(display(item.date))}${item.subtitle ? ` · ${esc(item.subtitle)}` : ''}</small></div>
          <div class="log-actions">
            ${item.canEdit ? `<button type="button" class="ghost small" data-tl-open="${esc(item.id)}" data-kind="${esc(item.kind)}">تعديل</button>` : ''}
            ${item.canPrint ? `<button type="button" class="ghost small" data-tl-open="${esc(item.id)}" data-kind="${esc(item.kind)}">طباعة</button>` : ''}
            ${item.canVoid ? `<button type="button" class="ghost small danger" data-tl-open="${esc(item.id)}" data-kind="${esc(item.kind)}">إلغاء</button>` : ''}
            ${!item.canEdit && !item.canPrint && !item.canVoid ? `<button type="button" class="ghost small" data-tl-open="${esc(item.id)}" data-kind="${esc(item.kind)}">تفاصيل</button>` : ''}
          </div></li>`).join('') || '<li class="muted">لا وقائع في هذه المرحلة.</li>'}</ul>
    </div>`;
    detailsHost.querySelectorAll('[data-tl-open]').forEach(action => action.addEventListener('click', () => {
      if (typeof onOpenItem === 'function') onOpenItem(action.dataset.tlOpen, action.dataset.kind, details.key);
    }));
  };
  container.addEventListener('click', handler);
  return () => container.removeEventListener('click', handler);
}
