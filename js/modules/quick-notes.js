// ============================================================================
// الملاحظات السريعة — واجهة تشغيلية فوق caseNotes + quickNoteLinks
// لا تُدخل نص الملاحظة في HTML: المحتوى يوضع في textContent / value فقط.
// ============================================================================
import {esc} from '../ui/dom.js';
import {modal, closeModal} from '../ui/modal.js';
import {toast} from '../ui/toast.js';
import {confirmBox} from '../ui/modal.js';
import {localDate, addDays} from '../core/clock.js';
import {parseFileNumber, formatFileNumber} from '../core/file-number.js';
import {normalizeError} from '../core/errors.js';
import {
  NOTE_PRIORITIES, NOTE_COLORS, effectiveNoteState, pageQuickNotes,
  getQuickNote, saveQuickNote, completeQuickNote, reopenQuickNote, archiveQuickNote, unarchiveQuickNote,
  deleteQuickNote, restoreQuickNote, snoozeQuickNote, toggleQuickNoteFlag, toggleQuickNoteChecklist, linkQuickNote,
  unlinkQuickNote, linksForNote, noteAgenda, smartCaptureProposals, saveQuickNoteDraft,
  getQuickNoteDraft, deleteQuickNoteDraft, countQuickNotes, needsActionNotes, reorderQuickNotes, quickNoteTypes, normalizeSearch
} from '../services/quick-notes.js';
import {saveWorkItemFromQuickNote} from '../services/work-items.js';

const ACTION_LABEL = Object.freeze({complete: 'إنجاز', reopen: 'إعادة فتح', archive: 'أرشفة', delete: 'حذف', restore: 'استعادة', work: 'تحويل إلى متابعة'});
const PRIORITY_LABEL = Object.freeze({LOW: 'منخفضة', NORMAL: 'عادية', HIGH: 'مرتفعة', URGENT: 'عاجلة'});
const STATE_LABEL = Object.freeze({ACTIVE: 'مفتوحة', DONE: 'منجزة', SNOOZED: 'مؤجلة', ARCHIVED: 'مؤرشفة', TRASH: 'السلة'});
const ENTITY_LABEL = Object.freeze({CLIENT: 'موكل', LEGAL_FILE: 'ملف', CASE: 'قضية', PARTY: 'طرف', HEARING: 'جلسة', PROCEDURE: 'عمل إداري', JUDGMENT: 'حكم', EXECUTION: 'تنفيذ', POA: 'توكيل', SERVICE_RECORD: 'إعلان / محضر', EXPERT_REPORT: 'تقرير خبير', APPOINTMENT: 'موعد', COMMUNICATION: 'اتصال', FEE: 'أتعاب', DOCUMENT_REFERENCE: 'مستند', WORK_ITEM: 'متابعة', QUICK_NOTE: 'ملاحظة'});

function contextFromRoute(app) {
  const route = String(app?.route || '').split('?')[0];
  let match = /^(client|file|case):(.+)$/.exec(route);
  if (match) return [{entityType: {client: 'CLIENT', file: 'LEGAL_FILE', case: 'CASE'}[match[1]], entityId: match[2], relationType: 'CONTEXT'}];
  match = /^exc:(.+)$/.exec(route);
  if (match) return [{entityType: 'EXECUTION', entityId: match[1], relationType: 'CONTEXT'}];
  match = /^rec:([A-Za-z]+):(.+)$/.exec(route);
  if (!match || match[1] === 'workItems') return [];
  const type = {clients: 'CLIENT', files: 'LEGAL_FILE', cases: 'CASE', fileParties: 'PARTY', hearings: 'HEARING', procedures: 'PROCEDURE', judgments: 'JUDGMENT', execution: 'EXECUTION', powersOfAttorney: 'POA', serviceRecords: 'SERVICE_RECORD', expertReports: 'EXPERT_REPORT', appointments: 'APPOINTMENT', communications: 'COMMUNICATION', fees: 'FEE', documentReferences: 'DOCUMENT_REFERENCE', workItems: 'WORK_ITEM', caseNotes: 'QUICK_NOTE'}[match[1]];
  return type ? [{entityType: type, entityId: match[2], relationType: 'CONTEXT'}] : [];
}

function contextFromOptions(app, context) {
  const list = Array.isArray(context) ? context : (context ? [context] : contextFromRoute(app));
  return list.filter(x => x?.entityType && x?.entityId).map(x => ({entityType: String(x.entityType).toUpperCase(), entityId: String(x.entityId), relationType: x.relationType || 'CONTEXT'}));
}

function needsActionPredicate(note, state = effectiveNoteState(note)) {
  const today = localDate(new Date());
  const now = new Date().toISOString();
  return !['TRASH', 'ARCHIVED', 'DONE', 'SNOOZED'].includes(state)
    && ((note.dueAt && note.dueAt <= today) || ['HIGH', 'URGENT'].includes(note.priority) || (note.remindAt && String(note.remindAt) <= now));
}

function stateOptions(selected = 'ACTIVE') {
  const states = {INBOX: 'صندوق الالتقاط', ...STATE_LABEL};
  return Object.entries(states).map(([key, label]) => `<option value="${key}"${selected === key ? ' selected' : ''}>${label}</option>`).join('');
}
function priorityOptions(selected = 'NORMAL') {
  return Object.entries(PRIORITY_LABEL).map(([key, label]) => `<option value="${key}"${selected === key ? ' selected' : ''}>${label}</option>`).join('');
}
function colorOptions(selected = 'DEFAULT') {
  const labels = {DEFAULT: 'افتراضي', YELLOW: 'أصفر', BLUE: 'أزرق', GREEN: 'أخضر', RED: 'أحمر', ORANGE: 'برتقالي', PURPLE: 'بنفسجي', GRAY: 'رمادي'};
  return NOTE_COLORS.map(key => `<option value="${key}"${selected === key ? ' selected' : ''}>${labels[key]}</option>`).join('');
}
function noteTypeOptions(types, selected = '') {
  const values = [...new Set([...(Array.isArray(types) ? types : []), selected].filter(Boolean))];
  return values.map(value => `<option value="${esc(value)}"${value === selected ? ' selected' : ''}>${esc(value)}</option>`).join('');
}

export function quickNotesPage(app, query) {
  const initialStatus = query?.get('status') || 'INBOX';
  const initialQuery = query?.get('q') || '';
  return `<div class="quick-notes-root" id="quick-notes-root" dir="rtl">
    <section class="hero quick-notes-hero">
      <div><small class="muted">Offline-First · نص محلي لا يُرسل خارج الجهاز</small><h2>📝 الملاحظات السريعة</h2><p class="hero-date">التقاط، فرز، ربط، ومتابعة دون تحويل الملاحظة إلى سجل قانوني.</p></div>
      <div class="quick-notes-actions" role="toolbar" aria-label="أدوات الملاحظات السريعة">
        <button type="button" class="primary" data-quick-new>+ ملاحظة سريعة <kbd>Ctrl⇧N</kbd></button>
        <button type="button" class="ghost" data-quick-fab-copy>التقاط الآن</button>
        <button type="button" class="ghost" data-quick-refresh>⟳ تحديث</button>
        <button type="button" class="ghost" data-quick-print>طباعة العرض</button>
      </div>
    </section>
    <section class="quick-notes-stats" aria-label="ملخص الملاحظات">
      <button type="button" class="qn-stat" data-status="INBOX"><b data-count="INBOX">—</b><span>صندوق الالتقاط</span></button>
      <button type="button" class="qn-stat" data-status="ACTIVE"><b data-count="ACTIVE">—</b><span>مفتوحة</span></button>
      <button type="button" class="qn-stat" data-status="DONE"><b data-count="DONE">—</b><span>منجزة</span></button>
      <button type="button" class="qn-stat" data-status="TRASH"><b data-count="TRASH">—</b><span>السلة</span></button>
    </section>
    <section class="panel quick-notes-toolbar" data-collapse-default="open" aria-label="تصفية الملاحظات">
      <div class="qn-toolbar-row">
        <label class="qn-search"><span class="sr-only">بحث في الملاحظات</span><input type="search" data-quick-query value="${esc(initialQuery)}" placeholder="ابحث في العنوان والنص… أو وسم:، أولوية:، متأخر، اليوم" autocomplete="off"></label>
        <label>الصندوق<select data-quick-status>${stateOptions(initialStatus)}<option value="ALL"${initialStatus === 'ALL' ? ' selected' : ''}>كل الملاحظات</option></select></label>
        <label>الترتيب<select data-quick-sort><option value="updated">الأحدث تعديلًا</option><option value="newest">الأحدث إضافة</option><option value="oldest">الأقدم</option><option value="due">موعد الاستحقاق</option><option value="manual">الترتيب اليدوي</option></select></label>
        <label class="qn-check"><input type="checkbox" data-quick-needs> يحتاج إجراء</label>
      </div>
      <div class="qn-filter-hints" aria-live="polite">مفاتيح البحث: <code>وسم: مهم</code> <code>أولوية: عاجلة</code> <code>متأخر</code> <code>مؤجل</code> <code>بلا_ربط</code></div>
    </section>
    <div class="quick-notes-layout">
      <main class="panel quick-notes-list-panel" data-collapse-default="open"><div class="panel-head"><h3>الملاحظات</h3><span class="muted small" data-quick-result>جارٍ التحميل…</span></div><div data-quick-list role="list" aria-live="polite" aria-busy="true"></div><div class="qn-more"><button type="button" class="ghost" data-quick-more hidden>تحميل المزيد</button></div></main>
      <aside class="panel quick-notes-side" data-collapse-default="open"><div class="panel-head"><h3>📅 الأجندة</h3><button type="button" class="ghost small" data-agenda-refresh>تحديث</button></div><div data-quick-agenda><p class="muted">جارٍ التحميل…</p></div><div class="panel-head qn-side-head"><h3>يحتاج إجراء</h3></div><div data-quick-needs-list><p class="muted">جارٍ التحميل…</p></div></aside>
    </div>
    <button type="button" class="quick-note-fab" data-quick-new aria-label="إنشاء ملاحظة سريعة">＋</button>
  </div>`;
}

export async function bindQuickNotes(app, query) {
  const root = document.querySelector('#quick-notes-root');
  if (!root) return;
  const rt = {app, office: app.office, root, query: query?.get('q') || '', status: query?.get('status') || 'INBOX', sort: 'updated', cursor: null, busy: false, needs: false, links: contextFromRoute(app)};
  app.__quickNotes = rt;
  const qInput = root.querySelector('[data-quick-query]');
  const statusInput = root.querySelector('[data-quick-status]');
  const sortInput = root.querySelector('[data-quick-sort]');
  const list = root.querySelector('[data-quick-list]');

  const renderPage = async ({append = false} = {}) => {
    if (rt.busy) return;
    rt.busy = true; list.setAttribute('aria-busy', 'true');
    if (!append) { rt.cursor = null; list.replaceChildren(); }
    try {
      const page = await pageQuickNotes(rt.office, {query: rt.query, status: rt.status, sort: rt.sort, limit: 40, cursor: append ? rt.cursor : null, direction: 'prev', filter: rt.needs ? needsActionPredicate : null});
      rt.cursor = page.nextCursor;
      for (const note of page.rows) list.append(makeNoteCard(note, rt));
      root.querySelector('[data-quick-more]').hidden = !page.hasMore;
      root.querySelector('[data-quick-result]').textContent = `${list.children.length}${page.hasMore ? '+' : ''} نتيجة · ${STATE_LABEL[rt.status] || 'كل الحالات'}`;
      if (!page.rows.length && !append) list.append(emptyNotes(rt.status));
      updateCountLabel(root, rt.status, list.children.length);
    } catch (error) {
      if (!append) list.append(errorNotes(normalizeError(error)));
      toast(normalizeError(error), 'error');
    } finally { rt.busy = false; list.setAttribute('aria-busy', 'false'); }
  };

  const renderAgenda = async () => {
    const host = root.querySelector('[data-quick-agenda]');
    try {
      const rows = await noteAgenda(rt.office, {from: localDate(new Date()), to: addDays(localDate(new Date()), 14)});
      host.replaceChildren();
      if (!rows.length) { host.append(textNode('لا توجد ملاحظات مستحقة خلال 14 يومًا.')); return; }
      rows.slice(0, 30).forEach(note => host.append(makeAgendaItem(note)));
    } catch (error) { host.replaceChildren(textNode(normalizeError(error))); }
  };
  const renderNeeds = async () => {
    const host = root.querySelector('[data-quick-needs-list]');
    try {
      const rows = await needsActionNotes(rt.office, {limit: 30});
      host.replaceChildren();
      if (!rows.length) { host.append(textNode('لا توجد ملاحظات تحتاج إجراء الآن.')); return; }
      rows.slice(0, 12).forEach(note => host.append(makeAgendaItem(note, {compact: true})));
    } catch (error) { host.replaceChildren(textNode(normalizeError(error))); }
  };
  const renderCounts = async () => {
    // كل عداد استعلام مستقل ومحدود؛ لا تُحمّل الملاحظات كلها في الذاكرة.
    for (const status of ['INBOX', 'ACTIVE', 'DONE', 'TRASH']) {
      countQuickNotes(rt.office, {status}).then(value => { const el = root.querySelector(`[data-count="${status}"]`); if (el) el.textContent = String(value); }).catch(() => {});
    }
  };
  const refresh = async () => { await Promise.all([renderPage(), renderAgenda(), renderNeeds(), renderCounts()]); };
  rt.refresh = refresh;

  qInput.addEventListener('input', debounce(() => { rt.query = qInput.value.slice(0, 200); renderPage(); }, 220));
  statusInput.addEventListener('change', () => { rt.status = statusInput.value; renderPage(); });
  sortInput.addEventListener('change', () => { rt.sort = sortInput.value; renderPage(); });
  root.querySelector('[data-quick-needs]').addEventListener('change', e => { rt.needs = e.target.checked; renderPage(); });
  root.querySelector('[data-quick-more]').addEventListener('click', () => renderPage({append: true}));
  let draggedId = '';
  list.addEventListener('dragstart', event => {
    const card = event.target.closest?.('[data-note-id]');
    if (rt.sort !== 'manual' || !card) return;
    draggedId = card.dataset.noteId;
    event.dataTransfer?.setData('text/plain', draggedId);
    event.dataTransfer?.setDragImage?.(card, 20, 20);
  });
  list.addEventListener('dragover', event => { if (rt.sort === 'manual' && event.target.closest?.('[data-note-id]')) event.preventDefault(); });
  list.addEventListener('drop', async event => {
    if (rt.sort !== 'manual') return;
    const target = event.target.closest?.('[data-note-id]');
    if (!target || !draggedId || target.dataset.noteId === draggedId) return;
    event.preventDefault();
    const cards = [...list.querySelectorAll('[data-note-id]')];
    const source = cards.find(card => card.dataset.noteId === draggedId);
    if (!source) return;
    if (cards.indexOf(source) < cards.indexOf(target)) target.after(source); else target.before(source);
    try { await reorderQuickNotes(rt.office, [...list.querySelectorAll('[data-note-id]')].map(card => card.dataset.noteId)); toast('تم حفظ ترتيب الملاحظات الظاهر محليًا.', 'ok'); }
    catch (error) { toast(normalizeError(error), 'error'); await renderPage(); }
    draggedId = '';
  });
  root.querySelectorAll('[data-status]').forEach(button => button.addEventListener('click', () => { statusInput.value = button.dataset.status; rt.status = button.dataset.status; renderPage(); }));
  root.querySelectorAll('[data-quick-new]').forEach(button => button.addEventListener('click', () => openQuickNoteCapture(app, {context: rt.links, onSaved: refresh})));
  root.querySelector('[data-quick-fab-copy]').addEventListener('click', () => openQuickNoteCapture(app, {context: rt.links, onSaved: refresh}));
  root.querySelector('[data-quick-refresh]').addEventListener('click', refresh);
  root.querySelector('[data-agenda-refresh]').addEventListener('click', renderAgenda);
  root.querySelector('[data-quick-print]').addEventListener('click', () => window.print());
  list.addEventListener('click', async event => {
    const button = event.target.closest?.('[data-note-action]');
    const card = event.target.closest?.('[data-note-id]');
    if (!card) return;
    const id = card.dataset.noteId;
    if (!button || button.dataset.noteAction === 'open') { openQuickNoteEditor(app, id, {onSaved: refresh}); return; }
    const action = button.dataset.noteAction;
    try {
      if (action === 'complete') await completeQuickNote(rt.office, id);
      else if (action === 'reopen') await reopenQuickNote(rt.office, id);
      else if (action === 'archive') await archiveQuickNote(rt.office, id);
      else if (action === 'unarchive') await unarchiveQuickNote(rt.office, id);
      else if (action === 'unsnooze') await snoozeQuickNote(rt.office, id, null);
      else if (action === 'delete') { if (!await confirmBox('نقل الملاحظة إلى السلة؟ يمكن استعادتها لاحقًا.')) return; await deleteQuickNote(rt.office, id); }
      else if (action === 'restore') await restoreQuickNote(rt.office, id);
      else if (action === 'pin' || action === 'star') { const note = await getQuickNote(rt.office, id); await toggleQuickNoteFlag(rt.office, id, action === 'pin' ? 'isPinned' : 'isStarred', !(action === 'pin' ? note.isPinned : note.isStarred)); }
      else if (action === 'snooze') await snoozeQuickNote(rt.office, id, addDays(localDate(new Date()), 1) + 'T09:00:00.000Z');
      else if (action === 'work') {
        const note = await getQuickNote(rt.office, id); const result = await saveWorkItemFromQuickNote(rt.office, note);
        if (!note.workItemIds?.includes(result.row.id)) await saveQuickNote(rt.office, {...note, workItemIds: [...(note.workItemIds || []), result.row.id]}, {id: note.id});
        toast(result.reused ? 'الملاحظة مرتبطة بمتابعة موجودة بالفعل.' : 'تم تحويل الملاحظة إلى متابعة في مركز العمل.', 'ok');
      }
      await refresh();
    } catch (error) { toast(normalizeError(error), 'error'); }
  });
  await refresh();
  const requested = query?.get?.('note');
  if (requested) setTimeout(() => openQuickNoteEditor(app, requested, {onSaved: refresh}), 0);
}

function makeNoteCard(note, rt) {
  const card = document.createElement('article'); card.className = `qn-card qn-${String(note.effectiveState || effectiveNoteState(note)).toLowerCase()}`; card.dataset.noteId = note.id; card.setAttribute('role', 'listitem'); if (rt.sort === 'manual') { card.draggable = true; card.setAttribute('aria-label', 'اسحب لإعادة ترتيب الملاحظة'); }
  const head = document.createElement('div'); head.className = 'qn-card-head';
  const pin = button(note.isPinned ? '📌' : '☆', note.isPinned ? 'إلغاء التثبيت' : 'تثبيت', 'pin');
  const star = button(note.isStarred ? '★' : '☆', note.isStarred ? 'إلغاء النجمة' : 'تمييز بنجمة', 'star');
  head.append(pin, star);
  const title = document.createElement('button'); title.type = 'button'; title.className = 'qn-title'; title.dataset.noteAction = 'open'; title.textContent = note.title || 'ملاحظة بلا عنوان'; head.append(title);
  const meta = document.createElement('span'); meta.className = 'qn-meta'; meta.textContent = `${STATE_LABEL[note.effectiveState] || ''} · ${PRIORITY_LABEL[note.priority] || ''}`; head.append(meta);
  card.append(head);
  const body = document.createElement('p'); body.className = 'qn-body'; body.textContent = note.content || '—'; card.append(body);
  if (Array.isArray(note.checklist) && note.checklist.length) {
    const checklist = document.createElement('div'); checklist.className = 'qn-checklist';
    const completed = note.checklist.filter(item => item.done).length;
    const progress = document.createElement('small'); progress.className = 'muted'; progress.textContent = `قائمة التحقق: ${completed}/${note.checklist.length}`; checklist.append(progress);
    note.checklist.forEach((item, index) => { const label = document.createElement('label'); label.className = 'qn-check-item'; const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = Boolean(item.done); checkbox.addEventListener('click', event => event.stopPropagation()); checkbox.addEventListener('change', async event => { event.stopPropagation(); try { await toggleQuickNoteChecklist(rt.office, note.id, index, event.target.checked); await rt.refresh(); } catch (error) { event.target.checked = !event.target.checked; toast(normalizeError(error), 'error'); } }); const text = document.createElement('span'); text.textContent = item.text; label.append(checkbox, text); checklist.append(label); });
    card.append(checklist);
  }
  const chips = document.createElement('div'); chips.className = 'qn-chips';
  if (note.dueAt) chips.append(chip(`📅 ${note.dueAt}`, note.dueAt < localDate(new Date()) ? 'overdue' : ''));
  if (note.remindAt) chips.append(chip(`🔔 ${dateTimeInputValue(note.remindAt).replace('T', ' ')}`, 'reminder'));
  if (note.snoozedUntil && note.effectiveState === 'SNOOZED') chips.append(chip('💤 مؤجلة', 'snoozed'));
  if (note.sourceId) chips.append(chip(`${ENTITY_LABEL[note.sourceType] || note.sourceType}: ${note.sourceId}`, 'link'));
  (note.tagIds || []).slice(0, 8).forEach(tag => chips.append(chip(`#${tag}`, 'tag')));
  card.append(chips);
  const actions = document.createElement('div'); actions.className = 'qn-actions';
  const state = note.effectiveState;
  if (state === 'TRASH') actions.append(button('استعادة', 'استعادة من السلة', 'restore', 'ghost'));
  else {
    const lifecycleAction = state === 'SNOOZED' ? 'unsnooze' : state === 'DONE' ? 'reopen' : state === 'ARCHIVED' ? 'unarchive' : 'complete';
    const lifecycleLabel = state === 'SNOOZED' ? 'إلغاء الغفوة' : state === 'DONE' ? 'إعادة فتح' : state === 'ARCHIVED' ? 'إلغاء الأرشفة' : 'إنجاز';
    actions.append(button(lifecycleLabel, lifecycleLabel, lifecycleAction, 'ghost'));
    actions.append(button('تعديل', 'تعديل', 'open', 'ghost'));
    actions.append(button('متابعة', 'تحويل إلى متابعة', 'work', 'ghost'));
    if (state !== 'SNOOZED') actions.append(button('غفوة', 'تأجيل إلى الغد', 'snooze', 'ghost'));
    if (state !== 'ARCHIVED') actions.append(button('أرشفة', 'أرشفة', 'archive', 'ghost'));
    actions.append(button('سلة', 'نقل إلى السلة', 'delete', 'danger'));
  }
  card.append(actions); return card;
}
function button(label, aria, action, className = '') { const b = document.createElement('button'); b.type = 'button'; b.className = `qn-action ${className}`; b.dataset.noteAction = action; b.title = aria; b.setAttribute('aria-label', aria); b.textContent = label; return b; }
function chip(label, className = '') { const span = document.createElement('span'); span.className = `qn-chip ${className}`; span.textContent = label; return span; }
function textNode(value) { const node = document.createElement('p'); node.className = 'muted small'; node.textContent = String(value); return node; }
function emptyNotes(status) { const node = textNode(status === 'INBOX' ? 'صندوق الالتقاط فارغ. استخدم Ctrl+Shift+N لالتقاط فكرة جديدة.' : 'لا توجد ملاحظات في هذا العرض.'); node.className = 'qn-empty muted'; return node; }
function errorNotes(value) { const node = textNode(value); node.className = 'qn-empty error'; return node; }
function makeAgendaItem(note, {compact = false} = {}) { const item = document.createElement('button'); item.type = 'button'; item.className = `qn-agenda-item${compact ? ' compact' : ''}`; item.dataset.noteId = note.id; const title = document.createElement('b'); title.textContent = note.title || note.content?.slice(0, 50) || 'ملاحظة'; const date = document.createElement('small'); date.textContent = `${note.dueAt || 'بدون موعد'} · ${PRIORITY_LABEL[note.priority] || ''}`; item.append(title, date); item.addEventListener('click', () => { const event = new CustomEvent('quick-note:open', {detail: note.id}); document.dispatchEvent(event); }); return item; }
function updateCountLabel(root, status, value) { const el = root.querySelector(`[data-count="${status}"]`); if (el && el.textContent === '—') el.textContent = String(value); }
function debounce(fn, wait) { let timer; return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), wait); }; }

export async function openQuickNoteCapture(app, {context = null, onSaved = null, initialText = ''} = {}) {
  const [links, noteTypes] = await Promise.all([contextFromOptions(app, context), quickNoteTypes(app.office)]);
  const draftContext = links.map(x => `${x.entityType}:${x.entityId}`).join('|') || String(app.route || 'global');
  const draft = await getQuickNoteDraft(app.office, draftContext).catch(() => null);
  const card = modal(`<h2 class="modal-title">📝 التقاط ملاحظة سريعة</h2><p class="muted small">احفظ الفكرة أولًا. أي ربط أو أولوية أو موعد سيظهر كاقتراح يحتاج اعتمادك.</p>
    <form class="qn-form" data-qn-form><label>العنوان (اختياري)<input name="title" maxlength="500" autocomplete="off"></label><label>النص <textarea name="content" rows="7" maxlength="50000" required placeholder="اكتب الملاحظة…"></textarea></label>
    <div class="qn-form-grid"><label>الأولوية<select name="priority">${priorityOptions()}</select></label><label>النوع<select name="noteType">${noteTypeOptions(noteTypes, noteTypes[0] || 'عادية')}</select></label><label>اللون<select name="colorToken">${colorOptions()}</select></label><label>موعد الاستحقاق<input type="date" name="dueAt"></label><label>التذكير<input type="datetime-local" name="remindAt"></label></div>
    <label>وسوم (افصل بينها بفاصلة)<input name="tagIds" maxlength="1000" placeholder="مهم، اتصال، مستند"></label><label>قائمة تحقق (اختياري)<textarea name="checklistText" rows="3" placeholder="[ ] طلب المستند&#10;[x] مراجعة الموعد"></textarea></label><fieldset class="qn-links-field"><legend>السياق المقترح (يمكن إلغاء الاختيار)</legend><div data-qn-context></div><label>ربط يدوي — النوع<select name="linkType"><option value="">بدون</option><option value="CLIENT">موكل</option><option value="LEGAL_FILE">ملف</option><option value="CASE">قضية</option><option value="PARTY">طرف</option><option value="HEARING">جلسة</option><option value="PROCEDURE">عمل إداري</option><option value="JUDGMENT">حكم</option><option value="EXECUTION">تنفيذ</option><option value="POA">توكيل</option><option value="SERVICE_RECORD">إعلان / محضر</option><option value="EXPERT_REPORT">تقرير خبير</option><option value="APPOINTMENT">موعد</option><option value="COMMUNICATION">اتصال</option><option value="FEE">أتعاب</option><option value="DOCUMENT_REFERENCE">مستند</option><option value="WORK_ITEM">متابعة</option></select></label><label>المعرّف (بعد اختيار السجل)<input name="linkId" maxlength="200" autocomplete="off"></label><p class="muted small" data-qn-link-hint>الاقتراح لا ينشئ رابطًا تلقائيًا؛ اختر سجلًا مطابقًا أو أدخل معرّفه.</p></fieldset>
    <div data-qn-proposals class="qn-proposals" aria-live="polite"></div><div class="form-actions"><button type="submit" class="primary">حفظ محليًا</button><button type="button" class="ghost" data-qn-cancel>إلغاء</button></div></form>`);
  const form = card.querySelector('[data-qn-form]');
  form.elements.title.value = draft?.title || '';
  form.elements.content.value = draft?.content || initialText || '';
  if (draft?.priority) form.elements.priority.value = draft.priority;
  if (draft?.noteType) form.elements.noteType.value = draft.noteType;
  if (draft?.dueAt) form.elements.dueAt.value = draft.dueAt;
  if (draft?.remindAt) form.elements.remindAt.value = dateTimeInputValue(draft.remindAt);
  form.elements.checklistText.value = draft?.checklistText || '';
  const contextHost = card.querySelector('[data-qn-context]');
  if (links.length) links.forEach(link => { const label = document.createElement('label'); label.className = 'qn-context-option'; const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.name = 'contextLink'; checkbox.value = `${link.entityType}::${link.entityId}`; checkbox.checked = true; const text = document.createElement('span'); text.textContent = `${ENTITY_LABEL[link.entityType] || link.entityType}: ${link.entityId}`; label.append(checkbox, text); contextHost.append(label); });
  else contextHost.append(textNode('لا يوجد سياق حالي — ستُحفظ الملاحظة مستقلة.'));
  const proposalsHost = card.querySelector('[data-qn-proposals]');
  const updateProposals = () => { proposalsHost.replaceChildren(); smartCaptureProposals(form.elements.content.value).forEach(proposal => { const b = document.createElement('button'); b.type = 'button'; b.className = 'qn-proposal'; b.textContent = `${proposal.label} — اعتماد`; b.addEventListener('click', () => applyProposal(form, proposal, app.office)); proposalsHost.append(b); }); };
  const saveDraft = debounce(async () => { await saveQuickNoteDraft(app.office, {contextKey: draftContext, title: form.elements.title.value, content: form.elements.content.value, priority: form.elements.priority.value, noteType: form.elements.noteType.value, dueAt: form.elements.dueAt.value, remindAt: toStoredDateTime(form.elements.remindAt.value), checklistText: form.elements.checklistText.value}); }, 350);
  form.addEventListener('input', event => { if (event.target === form.elements.content) updateProposals(); saveDraft(); });
  updateProposals();
  card.querySelector('[data-qn-cancel]').onclick = () => closeModal();
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const selected = [...form.querySelectorAll('input[name="contextLink"]:checked')].map(input => { const [entityType, entityId] = input.value.split('::'); return {entityType, entityId, relationType: 'CONTEXT'}; });
    if (form.elements.linkType.value && form.elements.linkId.value.trim()) selected.push({entityType: form.elements.linkType.value, entityId: form.elements.linkId.value.trim(), relationType: 'MANUAL'});
    try {
      const row = await saveQuickNote(app.office, {title: form.elements.title.value, content: form.elements.content.value, priority: form.elements.priority.value, noteType: form.elements.noteType.value, colorToken: form.elements.colorToken.value, dueAt: form.elements.dueAt.value, remindAt: toStoredDateTime(form.elements.remindAt.value), tagIds: form.elements.tagIds.value, checklist: parseChecklistText(form.elements.checklistText.value)}, {links: selected});
      await deleteQuickNoteDraft(app.office, draftContext).catch(() => {}); closeModal(); toast('تم حفظ الملاحظة محليًا.', 'ok'); onSaved?.(row); return row;
    } catch (error) { toast(normalizeError(error), 'error'); }
  });
  form.elements.content.focus(); return card;
}

function dateTimeInputValue(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  const pad = number => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function toStoredDateTime(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value).slice(0, 80) : date.toISOString();
}
function suggestedDate(word) {
  const today = localDate(new Date());
  if (word === 'اليوم') return today;
  if (word === 'بعد غد') return addDays(today, 2);
  if (word === 'غدًا' || word === 'غدا') return addDays(today, 1);
  const weekdays = {'الأحد': 0, 'الاثنين': 1, 'الثلاثاء': 2, 'الأربعاء': 3, 'الخميس': 4, 'الجمعة': 5, 'السبت': 6};
  if (weekdays[word] !== undefined) {
    const current = new Date().getDay();
    const delta = (weekdays[word] - current + 7) % 7 || 7;
    return addDays(today, delta);
  }
  return '';
}
function checklistText(list = []) { return (list || []).map(item => `${item.done ? '[x]' : '[ ]'} ${item.text || ''}`.trim()).join('\n'); }
function parseChecklistText(value, existing = []) {
  return String(value || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean).map((line, index) => {
    const match = /^\[(x|✓| )\]\s*(.*)$/i.exec(line);
    const old = existing[index] || {};
    return {id: old.id, sortKey: old.sortKey || String(index), text: (match ? match[2] : line).trim(), done: Boolean(match && match[1].toLowerCase() !== ' ')};
  }).filter(item => item.text);
}

async function applyProposal(form, proposal, office) {
  if (proposal.type === 'priority') form.elements.priority.value = proposal.value;
  else if (proposal.type === 'date-word') form.elements.dueAt.value = suggestedDate(proposal.value);
  else if (proposal.type === 'text') form.elements.tagIds.value = [form.elements.tagIds.value, proposal.value].filter(Boolean).join(', ');
  else if (proposal.type === 'file' || proposal.type === 'client') {
    const type = proposal.type === 'file' ? 'LEGAL_FILE' : 'CLIENT';
    const target = await resolveCaptureTarget(office, type, proposal.value);
    form.elements.linkType.value = type;
    form.elements.linkId.value = target?.id || '';
    const hint = form.querySelector('[data-qn-link-hint]');
    if (hint) hint.textContent = target
      ? `تم العثور على ${type === 'LEGAL_FILE' ? `الملف ${formatFileNumber(target)}` : `الموكل ${target.fullName || target.name || ''}`}؛ سيُحفظ الرابط بعد ضغط «حفظ محليًا».`
      : 'لم يُعثر على سجل مطابق؛ لم يُنشأ رابط. أدخل المعرّف بعد التحقق من السجل.';
  }
}

async function resolveCaptureTarget(office, type, value) {
  try {
    if (type === 'LEGAL_FILE') {
      const parsed = parseFileNumber(value);
      const prefix = parsed ? `${parsed.year}/` : String(value || '').slice(0, 40);
      const candidates = await office.r.files.prefix('fileNumber', prefix, 100);
      return candidates.find(row => !row.isDeleted && formatFileNumber(row) === formatFileNumber(value)) || null;
    }
    const needle = normalizeSearch(value);
    const candidates = await office.r.clients.prefix('fullNameNormalized', needle.slice(0, 100), 100);
    return candidates.find(row => !row.isDeleted && normalizeSearch(row.fullName || row.name) === needle) || null;
  } catch { return null; }
}

export async function openQuickNoteEditor(app, id, {onSaved = null} = {}) {
  const note = await getQuickNote(app.office, id, {raw: true});
  if (!note) return toast('الملاحظة غير موجودة.', 'error');
  const [links, noteTypes] = await Promise.all([linksForNote(app.office, id), quickNoteTypes(app.office)]);
  const card = modal(`<h2 class="modal-title">تعديل الملاحظة السريعة</h2><form class="qn-form" data-qn-form><label>العنوان<input name="title" maxlength="500"></label><label>النص<textarea name="content" rows="8" maxlength="50000" required></textarea></label><div class="qn-form-grid"><label>الأولوية<select name="priority">${priorityOptions(note.priority)}</select></label><label>الدورة<select name="lifecycle"><option value="OPEN">مفتوحة</option><option value="DONE">منجزة</option></select></label><label>النوع<select name="noteType">${noteTypeOptions(noteTypes, note.noteType || noteTypes[0] || 'عادية')}</select></label><label>اللون<select name="colorToken">${colorOptions(note.colorToken)}</select></label><label>الاستحقاق<input type="date" name="dueAt"></label><label>التذكير<input type="datetime-local" name="remindAt"></label></div><label>وسوم<input name="tagIds" maxlength="1000"></label><label>قائمة تحقق<textarea name="checklistText" rows="4" placeholder="[ ] بند جديد"></textarea></label><div class="form-actions"><button class="primary" type="submit">حفظ التعديل</button><button class="ghost" type="button" data-qn-cancel>إلغاء</button></div></form>`);
  const form = card.querySelector('[data-qn-form]'); form.elements.title.value = note.title || ''; form.elements.content.value = note.content || ''; form.elements.lifecycle.value = note.lifecycle || 'OPEN'; form.elements.noteType.value = note.noteType || noteTypes[0] || 'عادية'; form.elements.dueAt.value = note.dueAt || ''; form.elements.remindAt.value = dateTimeInputValue(note.remindAt); form.elements.tagIds.value = (note.tagIds || []).join(', '); form.elements.checklistText.value = checklistText(note.checklist);
  form.addEventListener('submit', async event => { event.preventDefault(); try { const updated = await saveQuickNote(app.office, {...note, title: form.elements.title.value, content: form.elements.content.value, priority: form.elements.priority.value, lifecycle: form.elements.lifecycle.value, colorToken: form.elements.colorToken.value, noteType: form.elements.noteType.value, dueAt: form.elements.dueAt.value, remindAt: toStoredDateTime(form.elements.remindAt.value), tagIds: form.elements.tagIds.value, checklist: parseChecklistText(form.elements.checklistText.value, note.checklist)}, {id, expectedVersion: note.version, links}); closeModal(); toast('تم تحديث الملاحظة.', 'ok'); onSaved?.(updated); } catch (error) { toast(normalizeError(error), 'error'); } });
  card.querySelector('[data-qn-cancel]').onclick = () => closeModal(); form.elements.content.focus(); return card;
}

export function bindQuickNoteGlobalEvents(app) {
  document.addEventListener('quick-note:open', event => openQuickNoteEditor(app, event.detail, {onSaved: () => app.__quickNotes?.refresh?.()}));
}
