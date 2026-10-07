// =====================================================================
// التذكيرات (Reminders) — قسم جديد: شارة جرس عامة + صفحة تذكيرات الملاحظات
// ---------------------------------------------------------------------
// • المصدر حصريًا caseNotes عبر فهرسي remindAt وdueAt (مسحتان محدودتان)؛
//   لا مخزن جديد ولا حقول جديدة ولا إشعار نظام — كل شيء محلي وفوري.
// • «مستحقة الآن» = تذكير انقضى أو استحقاق اليوم/متأخر؛ «القادمة» = خلال 7 أيام.
// • الإجراءات (إنجاز/تأجيل/إغلاق التذكير/فتح) تمر عبر خدمات الملاحظات
//   نفسها (updateNoteState/snooze/complete) فلا تختلف عن شاشة الملاحظات.
// • الشارة في الشريط العلوي تُحدَّث مخزّنة بمهلة (30 ثانية) + عند تغيّر
//   caseNotes + كل 5 دقائق والتطبيق مرئي — لا استعلام في كل نقرة.
// =====================================================================
import {esc} from '../ui/dom.js';
import {toast} from '../ui/toast.js';
import {normalizeError} from '../core/errors.js';
import {localDate, addDays} from '../core/clock.js';
import {events} from '../core/events.js';
import {registerPageLayout} from '../ui/page-layout.js';
import {icon} from '../ui/icons.js';
import {dueReminders, completeQuickNote, snoozeQuickNote, updateNoteState} from '../services/quick-notes.js';
import {openQuickNoteEditor, openQuickNoteCapture} from './quick-notes.js';

const PAGE_ID = 'reminders';
const BADGE_REFRESH_MS = 300000; // فحص دوري كل 5 دقائق والتطبيق مرئي

let badgeTimer = 0, badgeAt = 0;

/** جدولة تحديث الشارة (مرة كل 30 ثانية إلا بإجبار) — لا استعلام لكل حركة. */
export function scheduleRemindersBadge(app, {force = false} = {}) {
  if (!force && Date.now() - badgeAt < 30000) return;
  clearTimeout(badgeTimer);
  badgeTimer = setTimeout(() => { badgeAt = Date.now(); refreshRemindersBadge(app).catch(() => {}); }, 350);
}

/** تحديث فعلي لشارة الجرس: عدّ «مستحق الآن» فقط (مسحة محدودة واحدة). */
export async function refreshRemindersBadge(app) {
  const button = document.querySelector('#reminders-btn');
  if (!button || !app?.office) return 0;
  let count = 0;
  try {
    const {due} = await dueReminders(app.office, {limit: 200});
    count = due.length;
  } catch { return 0; }
  button.querySelector('.nav-badge')?.remove();
  if (count) {
    const label = count > 99 ? '99+' : String(count);
    button.insertAdjacentHTML('beforeend', `<span class="nav-badge" title="${label} تذكيرًا مستحقًا الآن">${label}</span>`);
  }
  button.classList.toggle('has-reminders', count > 0);
  return count;
}

/** تهيئة الجرس مرة واحدة: النقر → الصفحة، تغيّر الملاحظات → تحديث مجدول، دورية كل 5 دقائق. */
export function initReminders(app) {
  if (app.__remindersInit) return;
  app.__remindersInit = true;
  const button = document.querySelector('#reminders-btn');
  if (button) {
    if (!button.querySelector('svg')) button.insertAdjacentHTML('afterbegin', icon('bell'));
    button.onclick = () => app.go(PAGE_ID);
  }
  events.on('entity:changed', payload => {
    if (payload?.entityType === 'caseNotes') scheduleRemindersBadge(app, {force: true});
  });
  setInterval(() => {
    if (document.visibilityState === 'visible' && app?.office) scheduleRemindersBadge(app, {force: true});
  }, BADGE_REFRESH_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && app?.office) scheduleRemindersBadge(app);
  });
}

// ---------- الصفحة ----------
export function remindersPage(app, query) {
  registerPageLayout({pageId: PAGE_ID, title: 'التذكيرات', sections: [
    {id: 'due', title: 'مستحقة الآن', icon: '⏰', canHide: false},
    {id: 'upcoming', title: 'القادمة خلال 7 أيام', icon: '📅'}
  ]});
  return `<div class="rem-root" id="rem-root" dir="rtl">
    <section class="hero rem-hero">
      <div><small class="muted">Offline-First · تذكيرات محلية لا تغادر الجهاز</small><h2>🔔 التذكيرات</h2><p class="hero-date">تذكيرات الملاحظات السريعة (التذكير والاستحقاق) في شاشة واحدة: ما يحتاجك الآن وما يأتي خلال الأسبوع.</p></div>
      <div class="rem-actions" role="toolbar" aria-label="أدوات التذكيرات">
        <button type="button" class="primary" data-rem-new>+ ملاحظة بتذكير</button>
        <button type="button" class="ghost" data-rem-refresh>⟳ تحديث</button>
        <button type="button" class="ghost" data-rem-notes>كل الملاحظات ↗</button>
      </div>
    </section>
    <section class="rem-stats" aria-label="ملخص التذكيرات">
      <div class="rem-stat rem-stat--due"><b data-rem-count-due>—</b><span>مستحقة الآن</span></div>
      <div class="rem-stat"><b data-rem-count-upcoming>—</b><span>خلال 7 أيام</span></div>
      <div class="rem-stat"><b data-rem-count-reminders>—</b><span>بتذكير مجدول</span></div>
    </section>
    <section class="panel rem-panel" data-section-id="due" data-collapse-key="rem:due" data-collapse-default="open">
      <div class="panel-head"><h3>⏰ مستحقة الآن</h3><span class="muted small" data-rem-due-meta>جارٍ التحميل…</span></div>
      <div data-rem-due role="list" aria-live="polite" aria-busy="true"></div>
    </section>
    <section class="panel rem-panel" data-section-id="upcoming" data-collapse-key="rem:upcoming" data-collapse-default="open">
      <div class="panel-head"><h3>📅 القادمة خلال 7 أيام</h3><span class="muted small" data-rem-upcoming-meta></span></div>
      <div data-rem-upcoming role="list" aria-live="polite" aria-busy="true"></div>
    </section>
  </div>`;
}

const PRIORITY_LABEL = {LOW: 'منخفضة', NORMAL: 'عادية', HIGH: 'مرتفعة', URGENT: 'عاجلة'};

function reminderCard(note, ctx) {
  const cardEl = document.createElement('article');
  cardEl.className = `rem-card${note.reminderDueNow ? ' is-due' : ''}`;
  cardEl.setAttribute('role', 'listitem');
  cardEl.dataset.noteId = note.id;
  const head = document.createElement('div'); head.className = 'rem-card-head';
  const title = document.createElement('button');
  title.type = 'button'; title.className = 'rem-title'; title.textContent = note.title || String(note.content || 'ملاحظة بلا عنوان').slice(0, 80);
  title.addEventListener('click', () => ctx.open(note.id));
  head.append(title);
  const pri = document.createElement('span');
  pri.className = `rem-pri rem-pri--${String(note.priority || 'NORMAL').toLowerCase()}`;
  pri.textContent = PRIORITY_LABEL[note.priority] || '';
  if (pri.textContent) head.append(pri);
  cardEl.append(head);
  const chips = document.createElement('div'); chips.className = 'rem-chips';
  if (note.remindAt) {
    const when = String(note.remindAt);
    const chip = document.createElement('span');
    chip.className = `rem-chip${note.reminderDueNow && when <= new Date().toISOString() ? ' overdue' : ''}`;
    chip.textContent = `⏰ ${when.slice(0, 16).replace('T', ' ')}`;
    chips.append(chip);
  }
  if (note.dueAt) {
    const chip = document.createElement('span');
    chip.className = `rem-chip${note.dueAt <= localDate(new Date()) ? ' overdue' : ''}`;
    chip.textContent = `📅 ${note.dueAt}`;
    chips.append(chip);
  }
  (note.tagIds || []).slice(0, 5).forEach(tag => {
    const chip = document.createElement('span'); chip.className = 'rem-chip tag'; chip.textContent = `#${tag}`; chips.append(chip);
  });
  cardEl.append(chips);
  if (note.content) {
    const body = document.createElement('p'); body.className = 'rem-body';
    body.textContent = String(note.content).slice(0, 220);
    cardEl.append(body);
  }
  const actions = document.createElement('div'); actions.className = 'rem-actions-row';
  const act = (label, aria, run, danger = false) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = `ghost small${danger ? ' danger' : ''}`;
    b.textContent = label; b.title = aria; b.setAttribute('aria-label', aria);
    b.addEventListener('click', async () => { b.disabled = true; try { await run(); } catch (error) { toast(normalizeError(error), 'error'); } finally { b.disabled = false; } });
    return b;
  };
  actions.append(act('✓ إنجاز', 'إنجاز الملاحظة', async () => { await completeQuickNote(ctx.office, note.id); await ctx.reload(); }));
  actions.append(act('ساعة', 'تأجيل التذكير ساعة واحدة', async () => { await snoozeQuickNote(ctx.office, note.id, new Date(Date.now() + 3600 * 1000).toISOString()); await ctx.reload(); }));
  actions.append(act('للغد 9ص', 'تأجيل التذكير إلى الغد التاسعة صباحًا', async () => { await snoozeQuickNote(ctx.office, note.id, `${addDays(localDate(new Date()), 1)}T09:00:00.000Z`); await ctx.reload(); }));
  if (note.remindAt) actions.append(act('إغلاق التذكير', 'حذف التذكير مع بقاء الملاحظة كما هي', async () => { await updateNoteState(ctx.office, note.id, {remindAt: null}, 'reminder-cleared'); await ctx.reload(); }));
  actions.append(act('فتح الملاحظة', 'فتح محرر الملاحظة', () => ctx.open(note.id)));
  cardEl.append(actions);
  return cardEl;
}

function emptyBox(text) {
  const p = document.createElement('p');
  p.className = 'rem-empty muted';
  p.textContent = text;
  return p;
}

export async function bindReminders(app, query) {
  const root = document.querySelector('#rem-root');
  if (!root) return;
  const office = app.office;
  const dueHost = root.querySelector('[data-rem-due]');
  const upcomingHost = root.querySelector('[data-rem-upcoming]');
  const ctx = {
    office,
    open: id => openQuickNoteEditor(app, id, {onSaved: () => render()}),
    reload: () => render()
  };

  async function render() {
    dueHost.setAttribute('aria-busy', 'true');
    upcomingHost.setAttribute('aria-busy', 'true');
    try {
      const data = await dueReminders(office, {limit: 200, horizonDays: 7});
      dueHost.replaceChildren();
      upcomingHost.replaceChildren();
      root.querySelector('[data-rem-count-due]').textContent = String(data.due.length) + (data.capped ? '+' : '');
      root.querySelector('[data-rem-count-upcoming]').textContent = String(data.upcoming.length) + (data.capped ? '+' : '');
      root.querySelector('[data-rem-count-reminders]').textContent = String(data.due.filter(n => n.remindAt).length + data.upcoming.filter(n => n.remindAt).length);
      root.querySelector('[data-rem-due-meta]').textContent = data.due.length ? `${data.due.length} تذكيرًا يحتاج إجراءً` : '';
      root.querySelector('[data-rem-upcoming-meta]').textContent = data.upcoming.length ? `${data.upcoming.length} خلال الأيام السبعة` : '';
      if (!data.due.length) dueHost.append(emptyBox('لا شيء مستحق الآن — استمر في عملك.'));
      else data.due.slice(0, 80).forEach(note => dueHost.append(reminderCard(note, ctx)));
      if (!data.upcoming.length) upcomingHost.append(emptyBox('لا تذكيرات مجدولة خلال الأيام السبعة القادمة.'));
      else data.upcoming.slice(0, 80).forEach(note => upcomingHost.append(reminderCard(note, ctx)));
    } catch (error) {
      dueHost.replaceChildren(emptyBox(normalizeError(error)));
      upcomingHost.replaceChildren();
    } finally {
      dueHost.setAttribute('aria-busy', 'false');
      upcomingHost.setAttribute('aria-busy', 'false');
      scheduleRemindersBadge(app, {force: true});
    }
  }

  root.querySelector('[data-rem-refresh]').addEventListener('click', () => { render(); toast('تم تحديث التذكيرات'); });
  root.querySelector('[data-rem-notes]').addEventListener('click', () => app.go('quickNotes'));
  root.querySelector('[data-rem-new]').addEventListener('click', () => openQuickNoteCapture(app, {onSaved: () => render()}));
  await render();
}
