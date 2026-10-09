// =====================================================================
// مركز العمل — عروض البيانات: بطاقات/مساحة اليوم، كانبان، مصفوفة أيزنهاور، الأولويات، المتأخر، القادم، المنجز، التقويم.
// كل عرض يستعلم عبر rt.fetch (فهارس + مؤشر + إلغاء) ويعرض الصفحة الأولى فقط مع «عرض المزيد». نتائج rt.fetch/rt.memo تُحفظ في
// ذاكرة الصفحات طوال دورة البيانات نفسها: تبديل العرض أو تخطيط اليوم أو الطي/الفتح يعيد الرسم منها دون قراءة IndexedDB، ويُمسح
// كل ذلك عند تغيّر النطاق أو المرشحات أو البحث أو البيانات أو التحديث اليدوي. قائمة الجدول (DataGrid) في work-grid.js.
// =====================================================================
import {esc} from './dom.js';
import {card, cardEmpty, statusBadge} from './card.js';
import {mountCalendar} from './calendar.js';
import {formatDate} from '../core/format.js';
import {addDays, localDate} from '../core/clock.js';
import {
  dayPartOf, DAY_PARTS, DAY_LAYOUTS, mergeStatuses, mergePriorities, classifyDue, agingBucket, AGING_BUCKETS, QUADRANTS, classifyQuadrant, dayDiff, RETIRED_STATUS_COLOR
} from '../domain/work-items.js';
import {workCardHtml, groupHeaderHtml, chip} from './work-card.js';
import {nowAndNext, queryWorkItems} from '../services/work-query.js';
import {HOME_LIMITS} from '../services/work-config.js';
import {prefs} from '../core/preferences.js';

const PAGE_ID = 'actionCenter';
const WEEKDAY = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

export const dayLabel = (date, today) => {
  if (!date) return 'بلا موعد';
  const rel = classifyDue(date, today), name = WEEKDAY[new Date(`${date}T00:00:00`).getDay()];
  const tag = rel === 'today' ? ' · اليوم' : rel === 'tomorrow' ? ' · غدًا' : rel === 'overdue' ? ` · متأخر ${dayDiff(date, today)} يومًا` : '';
  return `${name} ${formatDate(date)}${tag}`;
};
const emptyView = (rt, msg = 'لا عناصر في هذه الفترة.') => cardEmpty(msg, {icon: 'check', action: '<button type="button" class="primary" data-wc-new>+ مهمة جديدة</button>'});
const moreRow = (id, label = 'عرض المزيد') => `<div class="wc-more-row"><button type="button" class="ghost" data-wc-more="${esc(id)}">${esc(label)}</button></div>`;
const cardsHtml = (rt, items, opts = {}) => items.map(item => rt.html(item, opts)).join('');
const section = (rt, key, title, items, {more = false, tone = '', body = null, collapsed = false, extra = ''} = {}) => card({
  title, size: 'full', tone, collapsible: true, collapsed, persistKey: `wc:section:${key}`, pageId: PAGE_ID,
  badge: statusBadge(`${items.length}${more ? '+' : ''}`, tone === 'danger' ? 'danger' : 'info'),
  body: `<div class="wc-cards" data-wc-list="${esc(key)}">${body ?? cardsHtml(rt, items)}${extra}</div>`
});

/** تجميع عناصر مرتبة بالتاريخ في مجموعات متتالية. */
export function groupByDate(items) {
  const groups = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (last && last.date === item.dueDate) last.items.push(item); else groups.push({date: item.dueDate, items: [item]});
  }
  return groups;
}
const groupedHtml = (rt, items, lastDate = null) => groupByDate(items).map(g => `${g.date === lastDate ? '' : groupHeaderHtml(dayLabel(g.date, rt.today()), g.items.length)}<div class="wc-cards">${cardsHtml(rt, g.items)}</div>`).join('');

/** زر «عرض المزيد» العام: يضيف الصفحة التالية في الحاوية نفسها دون إعادة رسم ما سبق. */
function wireMore(rt, container, key, fetchNext, renderChunk) {
  const button = container.querySelector(`[data-wc-more="${key}"]`);
  if (!button) return;
  button.onclick = async () => {
    button.disabled = true; button.textContent = 'جارٍ التحميل…';
    try {
      const page = await fetchNext();
      button.closest('.wc-more-row').insertAdjacentHTML('beforebegin', renderChunk(page));
      if (!page.hasMore) button.closest('.wc-more-row').remove(); else { button.disabled = false; button.textContent = 'عرض المزيد'; }
    } catch (error) { if (error?.name !== 'AbortError') { button.disabled = false; button.textContent = 'تعذّر التحميل — أعد المحاولة'; } }
  };
}

// ---------- المثبّتة ----------
// العناصر المثبّتة تظهر مرة واحدة في الأعلى (لا تتكرر داخل مجموعات الفترة) حتى لا يتشابه معرّف البطاقة في الصفحة.
async function pinnedStrip(rt) {
  const page = await rt.fetch(rt.spec({drive: 'pinned', range: 'all'}), {limit: 8});
  if (!page.items.length) return {html: '', ids: new Set()};
  return {html: section(rt, 'pinned', 'المثبّتة', page.items, {more: page.hasMore, collapsed: false}), ids: new Set(page.items.map(i => i.id))};
}

// ---------- مساحة اليوم ----------
async function renderToday(rt) {
  const {host, st} = rt;
  const [page, undated, pinned, done] = await Promise.all([
    rt.fetch(rt.spec({range: 'today'}), {limit: 200}),
    rt.fetch(rt.spec({range: 'all', onlyUndated: true, kinds: ['open']}), {limit: 25}),
    pinnedStrip(rt),
    rt.memo('done-today', () => queryWorkItems(rt.office, {drive: 'completed', from: rt.today(), to: rt.today()}, {limit: 100, signal: rt.signal}).catch(() => ({items: []})))
  ]);
  const items = page.items.filter(i => !pinned.ids.has(i.id)), config = rt.config();
  const byPriority = mergePriorities(config).map(p => ({p, n: items.filter(i => i.priority === p.key).length}));
  const summary = `<div class="wc-day-summary" role="status"><b>${items.length}</b> عنصرًا لليوم${done.items.length ? ` · <b>${done.items.length}</b> منجز اليوم` : ''}${byPriority.filter(x => x.n).map(({p, n}) => ` <span class="wc-chip wc-pri wc-pri--${p.key}" style="--wc-c:${esc(p.color)}"><span aria-hidden="true">${esc(p.icon)}</span><b class="wc-mark" aria-hidden="true">${esc(p.mark)}</b>${esc(p.label)}: ${n}</span>`).join('')}</div>`;
  const switcher = `<div class="wc-layouts" role="group" aria-label="طريقة عرض اليوم">${DAY_LAYOUTS.map(([k, l]) => `<button type="button" class="ghost small" data-wc-layout="${k}" aria-pressed="${st.dayLayout === k}">${esc(l)}</button>`).join('')}</div>`;
  // نافذة «الآن» من الإعدادات (−30/+90 دقيقة)، افتراضيًا 60/30.
  const nn = nowAndNext(items, new Date().toTimeString().slice(0, 5), {windowBefore: HOME_LIMITS.nowWindow.before, windowAfter: HOME_LIMITS.nowWindow.after});
  // now/next cards render full (with client/case context) - the user acts on them right now
  const nowBox = nn.now.length || nn.next ? `<div class="wc-now" role="region" aria-label="الآن والتالي">${nn.now.length ? `<div><h4>الآن</h4>${cardsHtml(rt, nn.now)}</div>` : ''}${nn.next ? `<div><h4>التالي</h4>${cardsHtml(rt, [nn.next])}</div>` : ''}</div>` : '';
  // عناصر «الآن/التالي» تُعرض في مربع الآن/التالي وحدها — لا تُكرَّر داخل أقسام اليوم.
  const nnIds = new Set([...nn.now.map(i => i.id), ...(nn.next ? [nn.next.id] : [])]);
  const dayItems = items.filter(i => !nnIds.has(i.id));
  // ترتيب أقسام «مساحة اليوم»: الآن → التالي → اليوم → يحتاج موعدًا → أُنجز اليوم (مطوي).
  let body = '';
  if (!items.length && !undated.items.length) body = emptyView(rt, 'يومك خالٍ من الالتزامات المسجّلة. استمتع بالهدوء أو خطّط للأيام القادمة.');
  else {
    body = dayItems.length ? '<h3 class="wc-group-h">اليوم</h3>' : '';
    if (st.dayLayout === 'priority') {
      body += mergePriorities(config).map(p => { const list = dayItems.filter(i => i.priority === p.key); return list.length ? section(rt, `prio:${p.key}`, `${p.icon} ${p.label}`, list, {tone: p.key === 'urgent' ? 'danger' : ''}) : ''; }).join('');
    } else if (st.dayLayout === 'timeline') {
      const timed = dayItems.filter(i => i.dueTime), untimed = dayItems.filter(i => !i.dueTime);
      body += section(rt, 'timeline', 'الخط الزمني لليوم', timed, {body: `<ol class="wc-timeline">${timed.map(i => `<li><time>${esc(i.dueTime)}</time>${rt.html(i, {compact: true})}</li>`).join('')}</ol>${untimed.length ? `<h4 class="wc-group-h">بلا وقت محدد</h4>${cardsHtml(rt, untimed)}` : ''}`});
    } else {
      body += DAY_PARTS.filter(([k]) => k !== 'undated').map(([key, label]) => { const list = dayItems.filter(i => dayPartOf(i) === key); return list.length ? section(rt, `part:${key}`, label, list, {tone: key === 'hearings' ? 'info' : ''}) : ''; }).join('');
    }
  }
  if (undated.items.length) body += section(rt, 'part:undated', 'يحتاج موعدًا', undated.items, {more: undated.hasMore});
  if (done.items.length) body += section(rt, 'done-today', 'أُنجز اليوم', done.items, {collapsed: true});
  // الأقسام داخل .wc-sections: عمود واحد على الجوال، وعمودان على سطح المكتب (الجلسات بجانب الأعمال الإدارية…).
  host.innerHTML = `${summary}${switcher}${nowBox}${pinned.html}<div class="wc-sections">${body}</div>`;
  host.querySelectorAll('[data-wc-layout]').forEach(b => b.onclick = () => rt.setState({dayLayout: b.dataset.wcLayout}));
}

// ---------- البطاقات ----------
async function renderCards(rt) {
  if (rt.st.range === 'today') return renderToday(rt);
  const {host, st} = rt;
  const spec = rt.spec({undated: st.range === 'all'});
  const [fetched, pinned] = await Promise.all([rt.fetch(spec, {limit: st.pageSize}), pinnedStrip(rt)]);
  const page = {...fetched, items: fetched.items.filter(i => !pinned.ids.has(i.id))};
  if (!page.items.length && !pinned.html) { host.innerHTML = emptyView(rt); return; }
  if (!page.items.length) { host.innerHTML = `${pinned.html}${fetched.hasMore ? `<div class="wc-groups">${moreRow('cards')}</div>` : ''}`; return; }
  host.innerHTML = `${pinned.html}<div class="wc-groups">${groupedHtml(rt, page.items)}${page.hasMore ? moreRow('cards') : ''}</div>${page.partial ? '<p class="notice">نتائج جزئية: ضيّق النطاق أو الفلاتر لعرض الباقي.</p>' : ''}`;
  let cursor = page.nextCursor, lastDate = page.items.at(-1).dueDate;
  wireMore(rt, host, 'cards', async () => { const next = await rt.fetch(spec, {limit: st.pageSize, cursor}); cursor = next.nextCursor; return {...next, items: next.items.filter(i => !pinned.ids.has(i.id))}; },
    next => { const html = groupedHtml(rt, next.items, lastDate); lastDate = next.items.at(-1)?.dueDate ?? lastDate; return html; });
}

// ---------- كانبان ----------
async function renderKanban(rt) {
  const {host, st} = rt, config = rt.config();
  const statuses = mergeStatuses(config);
  const order = [...statuses.filter(s => s.kind === 'open'), ...statuses.filter(s => s.kind === 'done'), ...statuses.filter(s => s.kind === 'cancelled')];
  // حالات مخصصة حُذفت من القائمة: يظهر لكل منها عمود (للقراءة والسحب منه فقط) إن بقيت عليها عناصر، فلا يختفي عنصر من الكانبان.
  const retired = (config.retiredStatuses || []).slice(0, 10).map(r => ({key: r.key, label: `${r.label} (محذوفة)`, kind: 'open', icon: '●', color: RETIRED_STATUS_COLOR, custom: true, retired: true}));
  const operational = new Set(['inProgress', 'postponed', ...statuses.filter(s => s.custom && s.kind === 'open').map(s => s.key), ...retired.map(r => r.key)]);   // حالات تُحفظ في الطبقة فقط → فهرس الحالة مباشرة
  const loadColumn = (s, cursor = null) => {
    const base = rt.spec({kinds: [s.kind]});
    if (s.kind === 'done') return rt.fetch({...base, drive: 'completed', from: st.range === 'all' ? '' : base.from, to: st.range === 'all' ? '' : base.to, kinds: ['done']}, {limit: 15, cursor});
    if (operational.has(s.key)) return rt.fetch({...base, drive: 'status', statuses: [s.key], kinds: ['open']}, {limit: 15, cursor});
    return rt.fetch({...base, statuses: [s.key], kinds: [s.kind]}, {limit: 15, cursor});
  };
  const pages = await Promise.all(order.map(s => loadColumn(s)));
  if (retired.length) {
    const extra = await Promise.all(retired.map(s => loadColumn(s)));
    retired.forEach((s, i) => { if (extra[i].items.length) { order.push(s); pages.push(extra[i]); } });
  }
  host.innerHTML = `<p class="muted small wc-hint">اسحب البطاقة بين الأعمدة (أو استخدم قائمة «نقل إلى» في كل بطاقة). الإنجاز والإلغاء والتأجيل تمر عبر السجل الأصلي.</p><div class="wc-board" data-uxc-id="wc:kanban" data-uxc-type="component" data-uxc-title="لوحة كانبان">${order.map((s, i) => `
   <section class="wc-col" data-col="${esc(s.key)}" aria-label="${esc(s.label)}"><header class="wc-col-h" style="--wc-c:${esc(s.color)}"><span aria-hidden="true">${esc(s.icon)}</span><h4>${esc(s.label)}</h4><span class="wc-count">${pages[i].items.length}${pages[i].hasMore ? '+' : ''}</span></header>
    <div class="wc-col-body"${s.retired ? '' : ` data-drop="${esc(s.key)}"`}>${pages[i].items.length ? cardsHtml(rt, pages[i].items, {drag: true, move: true, compact: true}) : '<p class="muted wc-empty">لا عناصر</p>'}${pages[i].hasMore ? moreRow(`col:${s.key}`) : ''}</div></section>`).join('')}</div>`;
  const options = order.filter(s => !s.retired).map(s => `<option value="${esc(s.key)}">${esc(s.label)}</option>`).join('');
  host.querySelectorAll('select[data-wc-move]').forEach(sel => { const key = sel.closest('[data-wc-id]').dataset.status; sel.innerHTML = `<option value="">نقل إلى…</option>${options}`; sel.querySelector(`[value="${key}"]`)?.remove(); });
  order.forEach((s, i) => {
    let cursor = pages[i].nextCursor;
    wireMore(rt, host, `col:${s.key}`, async () => { const next = await loadColumn(s, cursor); cursor = next.nextCursor; return next; }, next => cardsHtml(rt, next.items, {drag: true, move: true, compact: true}));
  });
  host.querySelectorAll('select[data-wc-move]').forEach(sel => sel.addEventListener('change', () => { if (sel.value) rt.moveToStatus(sel.closest('[data-wc-id]').dataset.wcId, sel.value); }));
  host.querySelectorAll('[draggable="true"]').forEach(el => el.addEventListener('dragstart', e => { e.dataTransfer?.setData('text/plain', el.dataset.wcId); el.classList.add('is-dragging'); }));
  host.querySelectorAll('[draggable="true"]').forEach(el => el.addEventListener('dragend', () => el.classList.remove('is-dragging')));
  host.querySelectorAll('[data-drop]').forEach(zone => {
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('is-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('is-over'));
    zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('is-over'); const id = e.dataTransfer?.getData('text/plain'); if (id) rt.moveToStatus(id, zone.dataset.drop); });
  });
}

// ---------- مصفوفة أيزنهاور ----------
async function renderMatrix(rt) {
  const {host} = rt, today = rt.today(), config = rt.config();
  const spec = rt.spec({});
  const page = await rt.fetch(spec, {limit: 300});
  const place = items => Object.fromEntries(QUADRANTS.map(q => [q.key, items.filter(i => classifyQuadrant(i, today, {urgentWithinDays: config.urgentWithinDays}) === q.key)]));
  let buckets = place(page.items);
  const quadHtml = q => `<section class="wc-quad" data-quad="${q.key}" aria-label="${esc(q.label)}"><header><h4>${esc(q.label)}</h4><small>${esc(q.hint)}</small><span class="wc-count" data-quad-count="${q.key}">${buckets[q.key].length}</span></header><div class="wc-quad-body" data-drop-quad="${q.key}">${buckets[q.key].length ? cardsHtml(rt, buckets[q.key], {drag: true, quadrantMove: true, compact: true}) : '<p class="muted wc-empty">لا عناصر</p>'}</div></section>`;
  host.innerHTML = `<p class="muted small wc-hint">الأهمية من الأولوية (عاجل جدًا/مرتفعة) والاستعجال من قرب الموعد (متأخر أو خلال ${config.urgentWithinDays} يومًا). اسحب بطاقة لتغيير تصنيفها يدويًا.</p><div class="wc-matrix" data-uxc-id="wc:matrix" data-uxc-type="component" data-uxc-title="مصفوفة أيزنهاور">${QUADRANTS.map(quadHtml).join('')}</div><div class="wc-matrix-more">${page.hasMore ? moreRow('matrix') : ''}</div>`;
  const fillSelects = () => host.querySelectorAll('select[data-wc-quad]').forEach(sel => { const cur = sel.closest('.wc-quad').dataset.quad; sel.innerHTML = `<option value="">نقل إلى…</option>${QUADRANTS.filter(q => q.key !== cur).map(q => `<option value="${q.key}">${esc(q.label)}</option>`).join('')}<option value="auto">تلقائي</option>`; });
  fillSelects();
  host.querySelector('.wc-matrix').addEventListener('change', e => { const sel = e.target.closest('select[data-wc-quad]'); if (sel?.value) rt.moveToQuadrant(sel.closest('[data-wc-id]').dataset.wcId, sel.value === 'auto' ? '' : sel.value); });
  host.querySelectorAll('[draggable="true"]').forEach(el => el.addEventListener('dragstart', e => e.dataTransfer?.setData('text/plain', el.dataset.wcId)));
  host.querySelectorAll('[data-drop-quad]').forEach(zone => {
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('is-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('is-over'));
    zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('is-over'); const id = e.dataTransfer?.getData('text/plain'); if (id) rt.moveToQuadrant(id, zone.dataset.dropQuad); });
  });
  let cursor = page.nextCursor;
  wireMore(rt, host, 'matrix', async () => { const next = await rt.fetch(spec, {limit: 300, cursor}); cursor = next.nextCursor; return next; }, next => {
    const extra = place(next.items);
    for (const q of QUADRANTS) { const body = host.querySelector(`[data-drop-quad="${q.key}"]`); body.querySelector('.wc-empty')?.remove(); body.insertAdjacentHTML('beforeend', cardsHtml(rt, extra[q.key], {drag: true, quadrantMove: true, compact: true})); buckets[q.key].push(...extra[q.key]); host.querySelector(`[data-quad-count="${q.key}"]`).textContent = buckets[q.key].length; }
    fillSelects(); return '';
  });
}

// ---------- الأولويات ----------
async function renderPriorities(rt) {
  const {host} = rt, config = rt.config();
  const list = mergePriorities(config);
  const pages = await Promise.all(list.map(p => rt.fetch(rt.spec({priorities: [p.key], undated: true}), {limit: 10})));
  const total = pages.reduce((n, p) => n + p.items.length, 0);
  host.innerHTML = total ? list.map((p, i) => pages[i].items.length ? section(rt, `priority:${p.key}`, `${p.icon} ${p.label} (${p.mark})`, pages[i].items, {more: pages[i].hasMore, tone: p.key === 'urgent' ? 'danger' : '', extra: pages[i].hasMore ? moreRow(`pr:${p.key}`) : ''}) : '').join('') : emptyView(rt);
  list.forEach((p, i) => {
    let cursor = pages[i].nextCursor;
    const body = host.querySelector(`[data-wc-list="priority:${p.key}"]`)?.closest('.ux-card-body') || host;
    wireMore(rt, body, `pr:${p.key}`, async () => { const next = await rt.fetch(rt.spec({priorities: [p.key], undated: true}), {limit: 25, cursor}); cursor = next.nextCursor; return next; }, next => cardsHtml(rt, next.items));
  });
}

// ---------- المتأخر (مع تقادم التأخير) ----------
async function renderOverdue(rt) {
  const {host} = rt, today = rt.today(), config = rt.config();
  const spec = rt.spec({range: 'overdue', from: '', to: ''});
  const page = await rt.fetch(spec, {limit: 120});
  const lookNote = `<p class="muted small">يُعرض المتأخر خلال آخر ${config.lookback?.hearings ?? 90} يومًا لمصادر بلا فهرس حالة (الجلسات/المواعيد/المتابعات…)، وكل الأعمال الإدارية المفتوحة. وسّع المدى من «⚙ الإعدادات» أو بنطاق مخصص.</p>`;
  if (!page.items.length) { host.innerHTML = `${emptyView(rt, 'لا يوجد متأخر. عمل ممتاز!')}${lookNote}`; return; }
  const bucketsHtml = items => {
    const out = [];
    for (const b of [...AGING_BUCKETS].reverse()) {
      const list = items.filter(i => agingBucket(i.dueDate, today)?.key === b.key);
      if (list.length) out.push(`${groupHeaderHtml(b.label, list.length)}<div class="wc-cards">${cardsHtml(rt, list)}</div>`);
    }
    return out.join('');
  };
  host.innerHTML = `<div class="wc-aging" role="group" aria-label="تقادم التأخير">${[...AGING_BUCKETS].reverse().map(b => { const n = page.items.filter(i => agingBucket(i.dueDate, today)?.key === b.key).length; return n ? chip(`${b.label}: ${n}`, {tone: b.from > 7 ? 'danger' : 'warn'}) : ''; }).join('')}</div><div class="wc-groups">${bucketsHtml(page.items)}${page.hasMore ? moreRow('overdue') : ''}</div>${lookNote}`;
  let cursor = page.nextCursor;
  wireMore(rt, host, 'overdue', async () => { const next = await rt.fetch(spec, {limit: 120, cursor}); cursor = next.nextCursor; return next; }, next => bucketsHtml(next.items));
}

// ---------- القادم ----------
async function renderUpcoming(rt) {
  const {host} = rt, today = rt.today(), config = rt.config();
  const spec = rt.spec({range: 'custom', from: today, to: addDays(today, config.upcomingDays), undated: false});
  const page = await rt.fetch(spec, {limit: 200});
  if (!page.items.length) { host.innerHTML = emptyView(rt, `لا شيء مجدول خلال ${config.upcomingDays} يومًا القادمة.`); return; }
  const hearings = page.items.filter(i => i.sourceType === 'hearings');
  host.innerHTML = `${hearings.length ? section(rt, 'upcoming:hearings', `جلسات قادمة (${config.upcomingDays} يومًا)`, hearings, {tone: 'info'}) : ''}<div class="wc-groups">${groupedHtml(rt, page.items)}</div>${page.hasMore ? '<p class="notice">يوجد المزيد بعد هذه الفترة؛ استخدم تبويب «هذا الشهر» أو النطاق المخصص.</p>' : ''}`;
}

// ---------- المنجز ----------
async function renderCompleted(rt) {
  const {host, st} = rt, range = st.range;
  const spec = {drive: 'completed', from: range === 'all' || range === 'overdue' ? '' : rt.spec({}).from, to: range === 'all' || range === 'overdue' ? '' : rt.spec({}).to, q: st.q, ...rt.filters()};
  const page = await rt.fetch({...spec, kinds: ['done']}, {limit: st.pageSize});
  if (!page.items.length) { host.innerHTML = emptyView(rt, 'لا عناصر منجزة في هذه الفترة.'); return; }
  const byDay = items => {
    const groups = [];
    for (const item of items) {
      const key = item.completedAt ? localDate(new Date(item.completedAt)) : '', last = groups.at(-1);
      if (last?.date === key) last.items.push(item); else groups.push({date: key, items: [item]});
    }
    return groups.map(g => `${groupHeaderHtml(g.date ? `أُنجز ${dayLabel(g.date, rt.today())}` : 'أُنجز', g.items.length)}<div class="wc-cards">${cardsHtml(rt, g.items)}</div>`).join('');
  };
  host.innerHTML = `<div class="wc-groups">${byDay(page.items)}${page.hasMore ? moreRow('completed') : ''}</div>`;
  let cursor = page.nextCursor;
  wireMore(rt, host, 'completed', async () => { const next = await rt.fetch({...spec, kinds: ['done']}, {limit: st.pageSize, cursor}); cursor = next.nextCursor; return next; }, next => byDay(next.items));
}

// ---------- التقويم ----------
const CAL_KEY = 'ui:wc-calendar-mode';
async function renderCalendar(rt) {
  const {host} = rt, today = rt.today();
  let mode = prefs.get(CAL_KEY, 'month') || 'month', selected = rt.calDay || today;
  const week0 = day => addDays(day, -((new Date(`${day}T00:00:00`).getDay() + 1) % 7));   // الأسبوع يبدأ السبت كما في تقويم الأجندة
  const redraw = () => draw().catch(error => { if (error?.name !== 'AbortError') console.error('work-center calendar', error); });   // لا وعود طافية بلا معالجة عند إلغاء استعلام أقدم
  const draw = async () => {
    rt.calDay = selected;
    host.innerHTML = `<div class="wc-cal-modes" role="group" aria-label="نمط التقويم">${[['month', 'شهر'], ['week', 'أسبوع'], ['day', 'يوم']].map(([k, l]) => `<button type="button" class="ghost small" data-cal-mode="${k}" aria-pressed="${mode === k}">${l}</button>`).join('')}</div><div id="wc-cal-body"></div>`;
    host.querySelectorAll('[data-cal-mode]').forEach(b => b.onclick = () => { mode = b.dataset.calMode; prefs.set(CAL_KEY, mode); redraw(); });
    const body = host.querySelector('#wc-cal-body');
    if (mode === 'month') {
      body.innerHTML = '<div id="wc-month"></div><div id="wc-day-list" class="wc-day-list" aria-live="polite"></div>';
      const cache = new Map();
      const listDay = async iso => {
        const box = body.querySelector('#wc-day-list');
        let items = cache.get(iso);
        if (!items) { items = (await rt.fetch(rt.spec({range: 'custom', from: iso, to: iso, undated: false}), {limit: 100})).items; }
        else { await rt.relations.hydrate(items); items.forEach(i => rt.register(i)); }
        box.innerHTML = `${groupHeaderHtml(dayLabel(iso, today), items.length)}${items.length ? `<div class="wc-cards">${cardsHtml(rt, items)}</div>` : '<p class="muted">لا عناصر في هذا اليوم.</p>'}`;
      };
      const cal = mountCalendar(body.querySelector('#wc-month'), {selected, onSelect: iso => { selected = iso; rt.calDay = iso; listDay(iso).catch(() => {}); },
        onMonthChange: async (y, m) => {
          const first = `${y}-${String(m).padStart(2, '0')}-01`, last = `${y}-${String(m).padStart(2, '0')}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
          const page = await queryWorkItems(rt.office, rt.spec({range: 'custom', from: first, to: last, undated: false}), {limit: 1500, signal: rt.signal, relations: rt.relations});
          const marks = new Map(); cache.clear();
          for (const item of page.items) { marks.set(item.dueDate, (marks.get(item.dueDate) || 0) + 1); if (!cache.has(item.dueDate)) cache.set(item.dueDate, []); cache.get(item.dueDate).push(item); }
          return marks;
        }});
      void cal; await listDay(selected);
    } else if (mode === 'week') {
      const start = week0(selected), end = addDays(start, 6);
      const page = await rt.fetch(rt.spec({range: 'custom', from: start, to: end, undated: false}), {limit: 400});
      body.innerHTML = `<div class="wc-cal-nav"><button type="button" class="ghost small" data-cal-nav="-7" aria-label="الأسبوع السابق">›</button><b>${esc(formatDate(start))} — ${esc(formatDate(end))}</b><button type="button" class="ghost small" data-cal-nav="7" aria-label="الأسبوع التالي">‹</button></div><div class="wc-week">${Array.from({length: 7}, (_, i) => { const d = addDays(start, i), list = page.items.filter(x => x.dueDate === d); return `<section class="wc-wday${d === today ? ' is-today' : ''}"><h4>${esc(dayLabel(d, today))}<span class="wc-count">${list.length}</span></h4>${list.length ? cardsHtml(rt, list, {compact: true}) : '<p class="muted wc-empty">—</p>'}</section>`; }).join('')}</div>`;
      body.querySelectorAll('[data-cal-nav]').forEach(b => b.onclick = () => { selected = addDays(selected, Number(b.dataset.calNav)); redraw(); });
    } else {
      const page = await rt.fetch(rt.spec({range: 'custom', from: selected, to: selected, undated: false}), {limit: 200});
      body.innerHTML = `<div class="wc-cal-nav"><button type="button" class="ghost small" data-cal-nav="-1" aria-label="اليوم السابق">›</button><b>${esc(dayLabel(selected, today))}</b><button type="button" class="ghost small" data-cal-nav="1" aria-label="اليوم التالي">‹</button><button type="button" class="ghost small" data-cal-today>اليوم</button></div>${page.items.length ? `<ol class="wc-timeline">${page.items.map(i => `<li><time>${esc(i.dueTime || '—')}</time>${rt.html(i, {compact: true})}</li>`).join('')}</ol>` : '<p class="muted">لا عناصر في هذا اليوم.</p>'}`;
      body.querySelectorAll('[data-cal-nav]').forEach(b => b.onclick = () => { selected = addDays(selected, Number(b.dataset.calNav)); redraw(); });
      body.querySelector('[data-cal-today]')?.addEventListener('click', () => { selected = today; redraw(); });
    }
  };
  await draw();
}

export const VIEW_RENDERERS = {cards: renderCards, kanban: renderKanban, matrix: renderMatrix, priorities: renderPriorities, overdue: renderOverdue, upcoming: renderUpcoming, completed: renderCompleted, calendar: renderCalendar};
