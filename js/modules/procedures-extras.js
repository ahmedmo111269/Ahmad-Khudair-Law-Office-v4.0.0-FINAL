// =====================================================================
// الأعمال الإدارية — لوحات القائمة العامة (extras فوق listPage)
// ---------------------------------------------------------------------
// • «ملخص سريع»: عدّادات بالفهارس (status) + شرائح تصفية تركّب مع فلاتر
//   الجدول الحالية دون إلغائها + شريط أجندة 14 يومًا للأعمال المفتوحة.
// • «لوحة حالات»: كانبان للأعمال الإدارية فقط (سحب أو أزرار) يكتب عبر
//   saveEntity نفسه المستخدم في «تعليم كمنجَز» — لا مخزن موازٍ.
// • كل القراءات محدودة بالفهارس: لا getAll، ولا مسح لمخزن كامل، ولا
//   تحميل كل الأعمال المنجزة التاريخية (العدّادات منها countByIndex).
// • هذا الملف لا يستورد list-page.js (يُسجَّل من هناك) لتفادي حلقة الاستيراد.
// =====================================================================
import {esc} from '../ui/dom.js';
import {toast} from '../ui/toast.js';
import {normalizeError} from '../core/errors.js';
import {localDate, addDays} from '../core/clock.js';
import {prefs} from '../core/preferences.js';
import {saveEntity} from '../services/entity-save.js';

const BOARD_KEY = 'ui:procedures-board';
const OPEN_KINDS = Object.freeze(['open', 'pending']);
const STATUS_META = Object.freeze({
  open: {label: 'مفتوح', icon: '🟢'},
  pending: {label: 'قيد الانتظار', icon: '⏳'},
  done: {label: 'تم', icon: '✅'},
  cancelled: {label: 'ملغي', icon: '✖️'}
});
const ACTIONABLE_CAP = 5000;

/** شرائح الحالة المعروضة فوق الجدول. */
export const PROCEDURE_STATUSES = Object.freeze([
  ['all', 'الكل'], ['open', 'مفتوح'], ['pending', 'قيد الانتظار'], ['done', 'تم'], ['cancelled', 'ملغي'],
  ['overdue', 'متأخرة'], ['dueToday', 'مستحقة اليوم'], ['week', 'هذا الأسبوع']
]);

const statusOf = row => (row && row.status) || 'open';

/**
 * مرشّح شريحة الحالة — منطق خالص قابل للاختبار (بلا DOM ولا تخزين).
 * يُركّب مع مرشّح الفترة في list-page بالجمع (AND) فلا يُلغى أحدهما الآخر.
 */
export function procedureStatusFilter(status, today = localDate()) {
  if (!status || status === 'all') return null;
  if (status === 'open' || status === 'pending' || status === 'done' || status === 'cancelled') return row => statusOf(row) === status;
  if (status === 'overdue') return row => OPEN_KINDS.includes(statusOf(row)) && Boolean(row?.internalDueDate) && row.internalDueDate < today;
  if (status === 'dueToday') return row => OPEN_KINDS.includes(statusOf(row)) && row?.internalDueDate === today;
  if (status === 'week') {
    const to = addDays(today, 6);
    return row => OPEN_KINDS.includes(statusOf(row)) && Boolean(row?.internalDueDate) && row.internalDueDate >= today && row.internalDueDate <= to;
  }
  if (status === 'undated') return row => OPEN_KINDS.includes(statusOf(row)) && !row?.internalDueDate;
  return null;
}

const titleOf = row => row?.description || row?.type || row?.title || 'عمل إداري';
const dueLabel = row => (row?.internalDueDate ? `📅 ${row.internalDueDate}` : 'بلا موعد');

/** جلب العدّادات والأعمال القابلة للإجراء في جولة قراءة واحدة بالفهارس. */
async function loadSnapshot(office) {
  const today = localDate();
  const [openCount, pendingCount, doneCount, cancelledCount, openRows, pendingRows] = await Promise.all([
    office.r.procedures.countByIndex('status', 'open'),
    office.r.procedures.countByIndex('status', 'pending'),
    office.r.procedures.countByIndex('status', 'done'),
    office.r.procedures.countByIndex('status', 'cancelled'),
    office.r.procedures.byIndex('status', 'open', ACTIONABLE_CAP),
    office.r.procedures.byIndex('status', 'pending', ACTIONABLE_CAP)
  ]);
  const capped = openRows.length >= ACTIONABLE_CAP || pendingRows.length >= ACTIONABLE_CAP;
  const actionable = [...openRows, ...pendingRows];
  const overdue = actionable.filter(row => row.internalDueDate && row.internalDueDate < today);
  const dueToday = actionable.filter(row => row.internalDueDate === today);
  const weekTo = addDays(today, 6);
  const week = actionable.filter(row => row.internalDueDate && row.internalDueDate >= today && row.internalDueDate <= weekTo);
  const undated = actionable.filter(row => !row.internalDueDate);
  const byDay = new Map();
  for (const row of actionable) {
    const day = String(row.internalDueDate || '').slice(0, 10);
    if (day) byDay.set(day, (byDay.get(day) || 0) + 1);
  }
  const bars = Array.from({length: 14}, (_, index) => {
    const date = addDays(today, index);
    return {date, count: byDay.get(date) || 0};
  });
  return {today, openCount, pendingCount, doneCount, cancelledCount, capped, overdue, dueToday, week, undated, bars, actionableCap: capped};
}

function statsHtml(snap) {
  const tile = (key, n, label, tone = '') => `<button type="button" class="px-stat${tone ? ` px-stat--${tone}` : ''}" data-px-status-chip="${key}"><b>${n}${snap.capped && (key === 'open' || key === 'pending') ? '+' : ''}</b><span>${esc(label)}</span></button>`;
  const max = Math.max(1, ...snap.bars.map(bar => bar.count));
  const total14 = snap.bars.reduce((sum, bar) => sum + bar.count, 0);
  return `<div class="px-stats" role="group" aria-label="عدّادات الأعمال الإدارية">
    ${tile('open', snap.openCount, 'مفتوح')}
    ${tile('pending', snap.pendingCount, 'قيد الانتظار')}
    ${tile('overdue', snap.overdue.length, 'متأخرة', snap.overdue.length ? 'danger' : '')}
    ${tile('dueToday', snap.dueToday.length, 'مستحقة اليوم', snap.dueToday.length ? 'warn' : '')}
    ${tile('week', snap.week.length, 'خلال أسبوع')}
    ${tile('done', snap.doneCount, 'تم')}
    ${tile('cancelled', snap.cancelledCount, 'ملغي')}
    ${tile('undated', snap.undated.length, 'بلا موعد')}
  </div>
  <div class="px-toolbar-row">
    <div class="px-chips" role="group" aria-label="تصفية سريعة بالحالة">
      ${PROCEDURE_STATUSES.map(([key, label]) => `<button type="button" class="chip px-chip" data-px-status-chip="${key}">${esc(label)}</button>`).join('')}
      <button type="button" class="ghost small" data-px-clear-chip hidden>مسح الشريحة</button>
    </div>
    <button type="button" class="ghost small" data-px-board-toggle aria-expanded="false">▦ لوحة الحالات</button>
  </div>
  <div class="px-bars" role="img" aria-label="أعمال مطلوب إنجازها خلال 14 يومًا: ${total14}">
    ${snap.bars.map(bar => `<span class="px-bar${bar.count ? '' : ' empty'}" style="--h:${Math.max(6, Math.round((bar.count / max) * 100))}%" title="${esc(bar.date)}: ${bar.count}"><b>${bar.count || ''}</b><i>${esc(bar.date.slice(8))}</i></span>`).join('')}
  </div>
  <p class="muted small px-foot">المتأخرة والمستحقة محسوبة من المفتوح والمنتظر فقط (${snap.actionableCap ? 'بعض النتائج قد تكون مقطوعة بسقف الفهرس' : 'كل الأعمال الحالية'}). اضغط أي عدّاد أو شريحة لتصفية الجدول.</p>
  <div class="px-board" data-px-board hidden aria-live="polite"></div>`;
}

export const PROCEDURES_EXTRAS = {
  title: 'ملخص الأعمال الإدارية',
  heading: '◈ ملخص الأعمال الإدارية',
  hint: 'عدّادات · شرائح · أجندة 14 يومًا · لوحة حالات',
  statusFilter: procedureStatusFilter,
  async mount(host, ctx) {
    if (!host) return;
    const {app, st, reload, setStatus} = ctx;
    const office = app.office;
    let snap = null;

    // ---------- لوحة الحالات (تُجلب عند أول فتح فقط) ----------
    const renderBoard = async () => {
      const board = host.querySelector('[data-px-board]');
      if (!board) return;
      board.hidden = false;
      board.innerHTML = '<p class="muted small">جارٍ تحميل اللوحة…</p>';
      try {
        const keys = Object.keys(STATUS_META);
        const pages = await Promise.all(keys.map(key => office.r.procedures.byIndex('status', key, 61)));
        const byDue = (a, b) => String(a.internalDueDate || '9999-12-31').localeCompare(String(b.internalDueDate || '9999-12-31'));
        board.innerHTML = `<p class="muted small">اسحب بطاقة بين الأعمدة أو استخدم أزرار الحالة. كل تغيير يمر عبر حفظ السجل الأصلي.</p><div class="px-board-grid">${keys.map((key, index) => {
          const rows = pages[index].sort(byDue).slice(0, 60);
          return `<section class="px-col" data-px-col="${key}" aria-label="${esc(STATUS_META[key].label)}">
            <header><span aria-hidden="true">${STATUS_META[key].icon}</span><h4>${esc(STATUS_META[key].label)}</h4><span class="px-count">${pages[index].length > 60 ? '60+' : pages[index].length}</span></header>
            <div class="px-col-body" data-px-drop="${key}">
              ${rows.length ? rows.map(row => `<article class="px-card" draggable="true" data-px-id="${esc(row.id)}" data-px-from="${key}">
                <button type="button" class="px-card-title" data-px-open="${esc(row.id)}" title="${esc(titleOf(row))}">${esc(titleOf(row))}</button>
                <small class="muted">${esc(dueLabel(row))}${row.assignedTo ? ` · ${esc(String(row.assignedTo).slice(0, 24))}` : ''}</small>
                <div class="px-card-acts">${keys.filter(other => other !== key).map(other => `<button type="button" class="ghost small" data-px-move="${other}" title="نقل إلى ${esc(STATUS_META[other].label)}">${STATUS_META[other].icon}</button>`).join('')}</div>
              </article>`).join('') : '<p class="muted px-empty">لا عناصر</p>'}
            </div>
          </section>`;
        }).join('')}</div>${pages.every(page => page.length < 61) ? '' : '<p class="notice">تُعرض أولى 60 بطاقة لكل عمود؛ استخدم الجدول للتصفية الكاملة.</p>'}`;

        const move = async (id, key) => {
          try {
            const row = await office.r.procedures.get(id);
            if (!row) throw new Error('السجل غير موجود.');
            if (statusOf(row) === key) return;
            await saveEntity(office, 'procedures', {...row, status: key}, id);
            toast(`تم نقل العمل إلى «${STATUS_META[key].label}».`, 'ok');
            await Promise.all([renderBoard(), render(), reload()]);
          } catch (error) { toast(normalizeError(error), 'error'); }
        };
        board.querySelectorAll('[data-px-open]').forEach(btn => btn.addEventListener('click', () => app.go(`rec:procedures:${btn.dataset.pxOpen}`)));
        board.querySelectorAll('[data-px-move]').forEach(btn => btn.addEventListener('click', () => move(btn.closest('[data-px-id]')?.dataset.pxId, btn.dataset.pxMove)));
        board.querySelectorAll('.px-card').forEach(card => {
          card.addEventListener('dragstart', event => { event.dataTransfer?.setData('text/plain', card.dataset.pxId); card.classList.add('is-dragging'); });
          card.addEventListener('dragend', () => card.classList.remove('is-dragging'));
        });
        board.querySelectorAll('[data-px-drop]').forEach(zone => {
          zone.addEventListener('dragover', event => { event.preventDefault(); zone.classList.add('is-over'); });
          zone.addEventListener('dragleave', () => zone.classList.remove('is-over'));
          zone.addEventListener('drop', event => { event.preventDefault(); zone.classList.remove('is-over'); const id = event.dataTransfer?.getData('text/plain'); if (id) move(id, zone.dataset.pxDrop); });
        });
      } catch (error) {
        board.innerHTML = `<p class="muted small">تعذر تحميل اللوحة: ${esc(normalizeError(error))}</p>`;
      }
    };

    const syncBoardToggle = open => {
      const toggle = host.querySelector('[data-px-board-toggle]');
      const board = host.querySelector('[data-px-board]');
      if (toggle) { toggle.setAttribute('aria-expanded', String(open)); toggle.textContent = open ? '▦ إغلاق اللوحة' : '▦ لوحة الحالات'; }
      if (board && !open) board.hidden = true;
    };

    const bindShell = () => {
      const active = st.status || 'all';
      host.querySelectorAll('[data-px-status-chip]').forEach(chip => chip.classList.toggle('on', chip.dataset.pxStatusChip === active));
      const clear = host.querySelector('[data-px-clear-chip]');
      if (clear) clear.hidden = active === 'all';
      host.querySelectorAll('[data-px-status-chip]').forEach(chip => chip.addEventListener('click', () => {
        const key = chip.dataset.pxStatusChip;
        const next = st.status === key ? 'all' : key;
        st.status = next;
        host.querySelectorAll('[data-px-status-chip]').forEach(x => x.classList.toggle('on', x.dataset.pxStatusChip === next));
        if (clear) clear.hidden = next === 'all';
        setStatus(next);
      }));
      clear?.addEventListener('click', () => { st.status = 'all'; host.querySelectorAll('[data-px-status-chip]').forEach(x => x.classList.remove('on')); clear.hidden = true; setStatus('all'); });
      const toggle = host.querySelector('[data-px-board-toggle]');
      toggle?.addEventListener('click', async () => {
        const board = host.querySelector('[data-px-board]');
        const open = Boolean(board?.hidden);
        syncBoardToggle(open);
        await prefs.set(BOARD_KEY, open);
        if (open) await renderBoard();
      });
    };

    const render = async () => {
      host.innerHTML = '<p class="muted small">جارٍ حساب العدّادات…</p>';
      try {
        snap = await loadSnapshot(office);
        host.innerHTML = statsHtml(snap);
        bindShell();
        if (prefs.get(BOARD_KEY, false)) { syncBoardToggle(true); await renderBoard(); }
      } catch (error) {
        host.innerHTML = `<p class="muted small">تعذر حساب الملخص: ${esc(normalizeError(error))}</p>`;
      }
    };
    await render();
  }
};
