// =====================================================================
// مركز العمل (Work Center) — «مركز قيادة المحامي»: طبقة تشغيل فوق البيانات الموجودة، لا تطبيق مهام منفصل.
// الصفحة تجمع: رأس ذكي + عدّادات قابلة للنقر + تبويبات الفترات + فلاتر الوقت السريعة (قابلة للطي) + بحث ومرشحات + عروض متعددة
// + مجلّد «فتح العمل». كل بيانات الملفات/الموكلين تُقرأ حيًّا من أصلها؛ كل كتابة عبر work-items ثم الخدمات الأصلية.
// =====================================================================
import {esc} from '../ui/dom.js';
import {toast} from '../ui/toast.js';
import {confirmBox, modal, closeModal} from '../ui/modal.js';
import {card, cardError, bindCards} from '../ui/card.js';
import {enhanceCollapsiblePanels} from '../ui/collapsible.js';
import {registerPageLayout, openPageCustomizer} from '../ui/page-layout.js';
import {bindCustomizableComponents} from '../ui/component-customizer.js';
import {openEntityForm} from '../ui/form.js';
import {Clock, addDays} from '../core/clock.js';
import {events} from '../core/events.js';
import {normalizeError, userError} from '../core/errors.js';
import {longDateAr} from '../core/format.js';
import {WORK_RANGES, WORK_VIEWS, mergePriorities, mergeStatuses} from '../domain/work-items.js';
import {allWorkSources} from '../domain/work-sources.js';
import {getWorkConfig, getWorkState, saveWorkState, sanitizeWorkState, DEFAULT_WORK_STATE} from '../services/work-config.js';
import {filterVisibleItems, tempHiddenMap} from '../services/work-hides.js';
import {ensureWorkStatuses} from '../services/work-statuses.js';
import {workSummary, queryWorkItems} from '../services/work-query.js';
import {createGridRelations} from '../services/grid-relations.js';
import {getLookup} from '../services/lookups.js';
import * as C from '../services/work-items.js';
import {workCardHtml} from '../ui/work-card.js';
import {runAction, openActionSheet} from '../ui/work-actions.js';
import {openWorkDrawer, closeWorkDrawer} from '../ui/work-drawer.js';
import {VIEW_RENDERERS} from '../ui/work-views.js';
import {renderListView} from '../ui/work-grid.js';
import {renderAttention, renderProductivity, openDailyReview, openWeeklyReview, openSavedViews, openWorkSettings, notificationsHtml, dismissNotification} from '../ui/work-panels.js';

const PAGE_ID = 'actionCenter';
// الأقسام القابلة لإعادة الترتيب/الإخفاء هي البطاقات واللوحات فقط (لكل منها رأس يحمل أزرار التخصيص).
// الحاويات البسيطة (التبويبات/البحث/العرض) ليست أقسامًا حتى لا يتراكب زر ⚙ على محتواها.
registerPageLayout({pageId: PAGE_ID, title: 'مركز العمل', sections: [
  {id: 'hero', title: 'الرأس وأزرار الإجراءات السريعة', icon: '◈', canHide: false},
  {id: 'stats', title: 'ملخص اليوم والعدّادات', icon: '▤'},
  {id: 'quicktime', title: 'فلاتر الوقت السريعة', icon: '◷'}
]});

const RENDERERS = {...VIEW_RENDERERS, list: renderListView, attention: renderAttention, productivity: renderProductivity};
const KIND_LABELS = {open: 'مفتوح', done: 'مكتمل', cancelled: 'ملغى'};

/** حالة صفحة مركز العمل (تُستعاد من التفضيلات). النطاقات من الرابط (?range=&view=&item=) تتفوق مرة واحدة. */
function initialState(q) {
  const base = {...getWorkState(), q: ''};
  const range = q?.get?.('range'), view = q?.get?.('view');
  if (range) base.range = sanitizeWorkState({range}).range;
  if (view) base.view = sanitizeWorkState({view}).view;
  if (q?.get?.('q')) base.q = q.get('q').slice(0, 120);
  return base;
}

export async function workCenterPage(app, q) {
  const st = initialState(q);
  const scope = {};
  for (const key of ['fileId', 'caseId', 'clientId', 'opponentId', 'relatedId']) if (q?.get?.(key)) scope[key] = q.get(key);
  app.__wc = {st, scope, openItemId: q?.get?.('item') || '', rt: null};
  const tabs = WORK_RANGES.map(([k, l]) => `<button type="button" role="tab" class="wc-tab" data-wc-range="${k}" aria-selected="${st.range === k}" tabindex="${st.range === k ? 0 : -1}">${esc(l)}</button>`).join('');
  const quick = [['اليوم', 0], ['غدًا', 1], ['بعد غد', 2], ['3 أيام', 3], ['7 أيام', 7], ['14 يومًا', 14], ['30 يومًا', 30]];
  return `<div class="wc-root" id="wc-root" data-uxc-page="${PAGE_ID}">
   <div class="hero wc-hero" data-section-id="hero">
    <div><h2>مركز العمل</h2><p class="hero-date" id="wc-hero-sub">${esc(longDateAr())}</p></div>
    <div class="wc-quick-bar" role="toolbar" aria-label="إجراءات سريعة">
     <button type="button" class="primary" data-wc-new title="مهمة جديدة (N)">+ مهمة</button>
     <button type="button" class="ghost wc-secondary" data-wc-new-proc>+ عمل إداري</button>
     <button type="button" class="ghost wc-secondary" data-wc-new-appt>+ موعد</button>
     <button type="button" class="ghost wc-secondary" data-wc-new-follow>+ متابعة</button>
     <button type="button" class="ghost" data-wc-focus-search>بحث</button>
     <button type="button" class="ghost" data-wc-toggle-filters aria-expanded="false" aria-controls="wc-filters">فلاتر</button>
     <button type="button" class="ghost wc-secondary" data-wc-sort>ترتيب</button>
     <button type="button" class="ghost wc-secondary" data-wc-reset title="إعادة الضبط للافتراضي">إعادة ضبط</button>
     <button type="button" class="ghost" data-wc-refresh title="تحديث دون إعادة تحميل الصفحة" aria-label="تحديث">⟳</button>
     <button type="button" class="ghost" data-wc-more-menu aria-haspopup="dialog">المزيد ⋯</button>
    </div>
   </div>
   <div id="wc-stats"><div class="skel skel-line w70"></div></div>
   <div id="wc-notify"></div>
   <nav class="wc-tabs" role="tablist" aria-label="الفترة الزمنية">${tabs}</nav>
   <section class="panel wc-quicktime" data-section-id="quicktime" data-collapse-key="wc:quick-time-filters" data-collapse-default="collapsed"><div class="panel-head"><h3>فلاتر الوقت السريعة</h3></div>
    <div class="wc-qt-row" role="group" aria-label="مدى سريع من اليوم">${quick.map(([l, n]) => `<button type="button" class="ghost small" data-wc-quick="${n}">${esc(l)}</button>`).join('')}</div>
    <form class="wc-qt-custom" data-wc-custom><label>من<input type="date" name="from" value="${esc(st.from)}"></label><label>إلى<input type="date" name="to" value="${esc(st.to)}"></label><button type="submit" class="primary small">تطبيق</button></form>
   </section>
   <div class="wc-toolbar" role="toolbar" aria-label="أدوات العرض">
    <button type="button" class="ghost" data-wc-add-menu aria-haspopup="menu">+ إضافة ▾</button>
    <label class="wc-search"><span class="sr-only">بحث في مركز العمل</span><input type="search" id="wc-q" placeholder="ابحث: عنوان، موكل، خصم، رقم ملف/قضية، وسم، تعليق…" value="${esc(st.q)}" autocomplete="off"></label>
    <button type="button" class="ghost" data-wc-toggle-filters aria-expanded="false" aria-controls="wc-filters">فلاتر</button>
    <div class="wc-view-ctrl">
     <label class="wc-view-pick"><span>طريقة العرض</span><select id="wc-view-select" aria-label="طريقة العرض">${WORK_VIEWS.map(([k, l]) => `<option value="${k}"${st.view === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
     <button type="button" class="ghost small" data-wc-view-menu aria-haspopup="menu" aria-expanded="false" title="قائمة العرض"><b id="wc-view-name">${esc(st.view === 'cards' && st.range === 'today' ? 'اليوم' : (WORK_VIEWS.find(([k]) => k === st.view)?.[1] || st.view))}</b> ▾</button>
    </div>
    <button type="button" class="ghost" data-wc-more-menu aria-haspopup="dialog">المزيد ⋯</button>
    <button type="button" class="ghost small" data-wc-global-search title="البحث الشامل في كل البرنامج">البحث الشامل ↗</button>
   </div>
   <div id="wc-scope" class="wc-scope"></div>
   <div id="wc-filters" class="wc-filters" hidden></div>
   <div id="wc-view" class="wc-view" aria-live="polite" aria-busy="true"><div class="skel skel-block"></div></div>
   <div id="wc-drawer-root" class="wc-drawer-root" hidden></div>
  </div>`;
}

export async function bindWorkCenter(app, q) {
  const root = document.querySelector('#wc-root');
  if (!root || !app.__wc) return;
  const office = app.office;
  const shared = app.__wc;
  await ensureWorkStatuses(office).catch(error => console.error('work statuses', error));   // الحالات المخصصة (Lookups) قبل أول رسم
  const rt = {
    app, office, root, host: root.querySelector('#wc-view'), st: shared.st, scope: shared.scope, items: new Map(), collect: null, seq: 0, controller: null, signal: null, calDay: null,
    relations: createGridRelations(office, 'workItems'), lastLocalChange: 0, busy: false
  };
  shared.rt = rt;
  rt.collect = rt.items;
  /** تسجيل عنصر في خريطة التحميل الجارية (تصبح خريطة العرض الحالية عند نجاح الرسم) فلا تضيع نقرة على بطاقة قديمة أثناء التحديث. */
  rt.register = item => { rt.collect.set(item.id, item); return item; };
  rt.config = () => getWorkConfig();
  rt.today = () => Clock.today();
  rt.filters = () => ({...rt.st.filters, ...rt.scope});
  rt.spec = (extra = {}) => { const f = rt.filters(); return {range: rt.st.range, from: rt.st.from, to: rt.st.to, q: rt.st.q, ...f, ...(f.undatedOnly ? {onlyUndated: true, undated: true} : {}), ...extra}; };
  rt.html = (item, opts = {}) => workCardHtml(item, {relations: rt.relations, config: rt.config(), today: rt.today(), ...opts});
  rt.stale = () => !root.isConnected;
  // «ذاكرة الصفحات»: نتائج استعلامات دورة البيانات الحالية. تبديل العرض أو تخطيط اليوم أو طي/فتح الأقسام يعيد الرسم منها
  // دون أي قراءة من IndexedDB. أي تحديث/تغيّر بيانات/تغيّر نطاق أو مرشح أو بحث يمسحها (rt.invalidate) فلا تُعرض بيانات قديمة.
  const CACHE_MAX = 60;
  rt.cache = new Map(); rt.epoch = 0;
  rt.invalidate = () => { rt.epoch++; rt.cache.clear(); rt.relations.reset?.(); };
  const remember = (key, value) => { rt.cache.set(key, value); while (rt.cache.size > CACHE_MAX) rt.cache.delete(rt.cache.keys().next().value); };
  /** يحفظ نتيجة استعلام مخصص (غير rt.fetch) داخل دورة البيانات نفسها؛ لا تُحفظ نتيجة استعلام أُلغي أو سبقه استعلام أحدث. */
  rt.memo = async (key, producer) => {
    const full = `${rt.today()}|${key}`;
    if (rt.cache.has(full)) return rt.cache.get(full);
    const epoch = rt.epoch, mySeq = rt.seq, value = await producer();
    if (epoch === rt.epoch && mySeq === rt.seq && !rt.signal?.aborted) remember(full, value);
    return value;
  };
  rt.fetch = async (spec, {limit = 50, cursor = null} = {}) => {
    const key = JSON.stringify([rt.today(), spec, limit, cursor || null]), hit = rt.cache.get(key);
    if (hit) { for (const item of hit.items) rt.register(item); return hit; }
    const mySeq = rt.seq, epoch = rt.epoch;
    const page = await queryWorkItems(office, spec, {limit, cursor, signal: rt.signal, relations: rt.relations});
    if (mySeq !== rt.seq || rt.stale()) throw new DOMException('استعلام أحدث', 'AbortError');
    // إخفاء مؤقت للعرض (إبقاء بلا موعد / ليس الآن): display-hiding فقط — يُصفى هنا مرة واحدة لكل العروض.
    if (page.items?.length) page.items = filterVisibleItems(page.items, tempHiddenMap());
    await rt.relations.hydrate(page.items, {signal: rt.signal});
    for (const item of page.items) rt.register(item);
    if (epoch === rt.epoch) remember(key, page);
    return page;
  };
  rt.wc = {app, office, relations: rt.relations, onChanged: change => rt.onChanged(change), openItem: id => rt.openItem(id)};

  // ---------- تصيير العرض ----------
  const afterRender = () => {
    bindCards(rt.host);
    enhanceCollapsiblePanels(rt.host, PAGE_ID, {bulk: false});
    bindCustomizableComponents(rt.host);
  };
  rt.reload = async opts => {
    if (!(opts && opts.reuse === true)) rt.invalidate();          // الافتراضي آمن: إعادة التحميل تقرأ بيانات طازجة
    rt.controller?.abort();
    rt.controller = typeof AbortController === 'function' ? new AbortController() : null;
    rt.signal = rt.controller?.signal || null;
    const my = ++rt.seq;
    rt.collect = new Map();          // خريطة التحميل الجديدة؛ القديمة تبقى مقروءة حتى ينجح الرسم
    rt.host.setAttribute('aria-busy', 'true');
    try {
      await (RENDERERS[rt.st.view] || RENDERERS.cards)(rt);
      if (my !== rt.seq) return;
      rt.items = rt.collect;
      afterRender();
    } catch (error) {
      if (error?.name === 'AbortError' || my !== rt.seq) return;
      console.error('work-center view', error);
      rt.host.innerHTML = cardError(`تعذر تحميل العرض: ${userError(normalizeError(error))}`, {retryAttr: 'data-wc-retry'});
    } finally { if (my === rt.seq) rt.host.setAttribute('aria-busy', 'false'); }
  };
  rt.setState = async (patch = {}, {reload = true} = {}) => {
    Object.assign(rt.st, sanitizeWorkState({...rt.st, ...patch}));
    if (patch.filters !== undefined) rt.st.filters = sanitizeWorkState({filters: patch.filters}).filters;
    if (patch.range && patch.range !== 'custom' && patch.from === undefined) { rt.st.from = ''; rt.st.to = ''; }
    await saveWorkState({range: rt.st.range, from: rt.st.from, to: rt.st.to, view: rt.st.view, filters: rt.st.filters, pageSize: rt.st.pageSize, dayLayout: rt.st.dayLayout});
    syncChrome();
    // تغيّر العرض أو تخطيط اليوم وحدهما = تغيير عرض فقط: يُعاد الرسم من ذاكرة الصفحات بلا قراءة جديدة.
    const keys = Object.keys(patch), presentationOnly = keys.length > 0 && keys.every(k => k === 'view' || k === 'dayLayout');
    if (reload) await rt.reload({reuse: presentationOnly});
  };
  rt.openItem = async id => { if (id) await openWorkDrawer(rt.wc, id); };
  rt.openLayout = () => openPageCustomizer(app, {pageId: PAGE_ID, root, onChanged: () => {}});
  rt.moveToStatus = async (id, key) => {
    const item = rt.items.get(id);
    if (!item || item.status === key) return;
    if (item.isDone && key !== 'done') { await C.reopenItem(office, item).catch(e => toast(userError(normalizeError(e)), 'error')); }
    await runAction(rt.wc, item, 'status', {key});
  };
  rt.moveToQuadrant = async (id, quadrant) => {
    const item = rt.items.get(id);
    if (!item) return;
    try { await C.setItemQuadrant(office, item, quadrant); toast(quadrant ? 'تم نقل التصنيف' : 'عاد التصنيف تلقائيًا'); await rt.onChanged({id, action: 'quadrant'}); }
    catch (error) { toast(userError(normalizeError(error)), 'error'); }
  };
  rt.onChanged = async change => {
    rt.lastLocalChange = Date.now();
    await Promise.all([rt.reload(), refreshStats()]);
    if (change?.sourceChanged) closeWorkDrawer(root.querySelector('#wc-drawer-root'));
  };
  rt.onSettingsChanged = async () => { await Promise.all([rt.reload(), refreshStats()]); renderFilters(); };

  // ---------- الرأس والعدّادات ----------
  /** شريط إنجاز اليوم (عرض فقط، بلا استعلام إضافي — يقرأ من الملخص نفسه). */
  const dayProgressHtml = s => {
    const total = (s.todayCount || 0) + (s.doneToday || 0);
    if (!total) return '';
    const pct = Math.min(100, Math.round(((s.doneToday || 0) / total) * 100));
    return `<div class="wc-dayprogress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="إنجاز مجدول اليوم"><div class="wc-dayprogress-fill" style="width:${pct}%"></div></div><p class="wc-dayprogress-label muted small">أُنجز <b>${s.doneToday || 0}</b> من <b>${total}</b> مجدول لاليوم — ${pct}%${s.overdue ? ` · و<b>${s.overdue}${s.overdueCapped ? '+' : ''}</b> متأخر` : ''}</p>`;
  };
  async function refreshStats() {
    let s;
    try { s = await workSummary(office, {signal: null}); } catch (error) { if (error?.name !== 'AbortError') console.error('work summary', error); return; }
    if (!root.isConnected) return;
    rt.summary = s;
    const stat = (key, n, label, tone = '', capped = false) => `<button type="button" class="wc-stat${tone ? ` wc-stat--${tone}` : ''}" data-wc-stat="${key}" title="${esc(capped ? `${label} — العدد جزئي (سقف الاستعلام)` : label)}"><b data-uxc-role="primaryValue">${n}${capped ? '+' : ''}</b><span data-uxc-role="caption">${esc(label)}</span></button>`;
    const any = s.capped, exactThrough = day => s.forwardCapped && !(s.forwardCappedAt > day);   // هل رقم اليوم المحدد مقطوع؟
    root.querySelector('#wc-stats').innerHTML = card({title: 'ملخص اليوم', size: 'full', collapsible: true, collapsed: false, persistKey: 'wc:stats', sectionId: 'stats', pageId: PAGE_ID, badge: s.capped ? '<span class="ux-badge ux-badge--warn" title="بعض الأعداد بلغت سقف الاستعلام المحدود وتُعرض بعلامة +">جزئي</span>' : '',
      body: `<div class="wc-stats" role="group" aria-label="عدّادات مركز العمل" data-uxc-id="wc:stats" data-uxc-type="component" data-uxc-title="بطاقات العدّادات">
       ${stat('todayCount', s.todayCount, 'اليوم', 'info', exactThrough(s.today))}${stat('overdue', s.overdue, 'متأخر', s.overdue ? 'danger' : '', s.overdueCapped)}${stat('tomorrow', s.tomorrow, 'غدًا', '', exactThrough(addDays(s.today, 1)))}
       ${stat('hearingsNext7', s.hearingsNext7, 'جلسات خلال 7 أيام', s.hearingsToday ? 'info' : '', exactThrough(addDays(s.today, 7)))}${stat('inProgress', s.inProgress, 'قيد التنفيذ', '', any)}${stat('waiting', s.waiting, 'بانتظار', '', any)}
       ${stat('postponed', s.postponed, 'مؤجل', '', any)}${stat('undated', s.undated, 'بلا موعد', '', s.undatedCapped)}${stat('doneToday', s.doneToday, 'منجز اليوم', 'ok')}${stat('pinned', s.pinned, 'مثبّت', '', any)}</div>${dayProgressHtml(s)}`});
    bindCards(root.querySelector('#wc-stats'));
    enhanceCollapsiblePanels(root.querySelector('#wc-stats'), PAGE_ID, {bulk: false});
    bindCustomizableComponents(root.querySelector('#wc-stats'));
    root.querySelector('#wc-hero-sub').textContent = `${longDateAr()} — ${s.todayCount} لليوم${s.overdue ? ` · ${s.overdue}${s.overdueCapped ? '+' : ''} متأخر` : ''}${s.hearingsToday ? ` · ${s.hearingsToday === 1 ? 'جلسة واحدة' : s.hearingsToday === 2 ? 'جلستان' : `${s.hearingsToday} جلسات`} اليوم` : ''}`;
    root.querySelector('#wc-notify').innerHTML = await notificationsHtml(rt, s);
    setNavBadge(s.overdue + s.todayCount);
  }
  const setNavBadge = n => {
    const btn = document.querySelector('#sidebar [data-route="actionCenter"]');
    if (!btn) return;
    btn.querySelector('.nav-badge')?.remove();
    if (n) btn.insertAdjacentHTML('beforeend', `<span class="nav-badge"${n > 99 ? ` title="${n}"` : ''}>${n > 99 ? '99+' : n}</span>`);
  };

  // ---------- المرشحات ----------
  async function renderFilters() {
    const config = rt.config(), f = rt.st.filters;
    const [types, tags] = await Promise.all([getLookup(office, 'workItemType').catch(() => []), getLookup(office, 'workItemTag').catch(() => [])]);
    const group = (key, title, options) => `<fieldset class="wc-fset"><legend>${esc(title)}</legend>${options.map(([v, l]) => `<label class="wc-fopt"><input type="checkbox" data-wc-f="${key}" value="${esc(v)}" ${(f[key] || (key === 'kinds' ? ['open'] : [])).includes(v) ? 'checked' : ''}> ${esc(l)}</label>`).join('')}</fieldset>`;
    root.querySelector('#wc-filters').innerHTML = `${group('kinds', 'الحالة العامة', Object.entries(KIND_LABELS))}${group('statuses', 'الحالة التفصيلية', mergeStatuses(config).map(s => [s.key, `${s.icon} ${s.label}`]))}${group('priorities', 'الأولوية', mergePriorities(config).map(p => [p.key, `${p.icon} ${p.label}`]))}${group('sources', 'المصدر', [['task', 'مهمة'], ...allWorkSources().filter(s => config.sources[s.type] ?? s.defaultEnabled).map(s => [s.type, s.label])])}${types.length ? group('types', 'النوع', types.map(t => [t, t])) : ''}${tags.length ? group('tags', 'الوسوم', tags.map(t => [t, `#${t}`])) : ''}
     <fieldset class="wc-fset"><legend>خيارات</legend><label class="wc-fopt"><input type="checkbox" data-wc-f-flag="pinned" ${f.pinned ? 'checked' : ''}> المثبّتة فقط</label><label class="wc-fopt"><input type="checkbox" data-wc-f-flag="archivedOnly" ${f.archived === 'only' ? 'checked' : ''}> المؤرشفة فقط</label><label class="wc-fopt"><input type="checkbox" data-wc-f-flag="undatedOnly" ${f.undatedOnly ? 'checked' : ''}> بلا موعد فقط</label></fieldset>
     <div class="wc-factions"><button type="button" class="ghost small" data-wc-clear-filters>مسح المرشحات</button></div>`;
  }
  const collectFilters = () => {
    const out = {};
    for (const key of ['kinds', 'statuses', 'priorities', 'sources', 'types', 'tags']) { const v = [...root.querySelectorAll(`[data-wc-f="${key}"]:checked`)].map(i => i.value); if (v.length && !(key === 'kinds' && v.length === 1 && v[0] === 'open')) out[key] = v; }
    if (root.querySelector('[data-wc-f-flag="pinned"]')?.checked) out.pinned = true;
    if (root.querySelector('[data-wc-f-flag="archivedOnly"]')?.checked) out.archived = 'only';
    if (root.querySelector('[data-wc-f-flag="undatedOnly"]')?.checked) out.undatedOnly = true;
    return out;
  };
  const renderScope = () => {
    const parts = Object.entries(rt.scope).map(([k, v]) => `<span class="wc-chip">${esc({fileId: 'الملف', caseId: 'القضية', clientId: 'الموكل', opponentId: 'الخصم', relatedId: 'السجل المرتبط'}[k] || k)}: <button type="button" class="link" data-wc-unscope="${esc(k)}" aria-label="إزالة نطاق ${esc(k)}">${esc(String(v).slice(0, 8))}… ✕</button></span>`);
    root.querySelector('#wc-scope').innerHTML = parts.length ? `<div class="wc-scope-bar" role="status">نطاق محدود: ${parts.join(' ')}</div>` : '';
  };
  function syncChrome() {
    root.querySelectorAll('[data-wc-range]').forEach(b => { const on = b.dataset.wcRange === rt.st.range; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
    const sel = root.querySelector('#wc-view-select'); if (sel) sel.value = rt.st.view;
    const vname = root.querySelector('#wc-view-name');
    if (vname) vname.textContent = rt.st.view === 'cards' && rt.st.range === 'today' ? 'اليوم' : (WORK_VIEWS.find(([k]) => k === rt.st.view)?.[1] || rt.st.view);
    const from = root.querySelector('[data-wc-custom] [name=from]'), to = root.querySelector('[data-wc-custom] [name=to]');
    if (from) from.value = rt.st.from; if (to) to.value = rt.st.to;
    const active = Object.keys(rt.st.filters).length;
    root.querySelectorAll('[data-wc-toggle-filters]').forEach(btn => { btn.textContent = active ? `فلاتر (${active})` : 'فلاتر'; });
    renderScope();
  }

  // ---------- الأحداث ----------
  const itemOf = el => rt.items.get(el.closest('[data-wc-id]')?.dataset.wcId);
  root.addEventListener('click', async e => {
    const t = e.target;
    const nav = t.closest('[data-wc-nav]');
    if (nav) { e.preventDefault(); return app.go(nav.dataset.wcNav); }
    const act = t.closest('[data-wc-act]');
    if (act && act.dataset.wcAct !== 'toggle') {
      const item = itemOf(act); if (!item) return;
      if (act.dataset.wcAct === 'open') return rt.openItem(item.id);
      if (act.dataset.wcAct === 'more') return openActionSheet(rt.wc, item);
      return;
    }
    const stat = t.closest('[data-wc-stat]');
    if (stat) return applyStat(stat.dataset.wcStat);
    const rangeBtn = t.closest('[data-wc-range]');
    if (rangeBtn) return rt.setState({range: rangeBtn.dataset.wcRange, ...(rangeBtn.dataset.wcRange === 'custom' ? {} : {from: '', to: ''})});
    const courtResult = t.closest('[data-cd-result]');
    if (courtResult) {
      const item = rt.items.get(courtResult.dataset.cdResult);
      if (!item || item.sourceType !== 'hearings') return;
      return openEntityForm(app, 'hearings', {id: item.sourceId, title: 'تسجيل نتيجة الجلسة', onSaved: async () => { await rt.onChanged({id: item.id, sourceChanged: true}); }});
    }
    if (t.closest('[data-wc-new]')) return newTask();
    if (t.closest('[data-wc-new-proc]')) return openEntityForm(app, 'procedures', {onSaved: async () => { await rt.onChanged({}); }});
    if (t.closest('[data-wc-new-appt]')) return openEntityForm(app, 'appointments', {onSaved: async () => { await rt.onChanged({}); }});
    if (t.closest('[data-wc-new-follow]')) return openEntityForm(app, 'communications', {preset: {followUpDate: addDays(rt.today(), 1)}, onSaved: async () => { await rt.onChanged({}); }});
    if (t.closest('[data-wc-focus-search]')) return root.querySelector('#wc-q').focus();
    if (t.closest('[data-wc-toggle-filters]')) return toggleFilters();
    if (t.closest('[data-wc-sort]')) return openSort();
    if (t.closest('[data-wc-reset]')) return resetAll();
    if (t.closest('[data-wc-refresh]')) { await rt.onChanged({}); return toast('تم تحديث البيانات'); }
    if (t.closest('[data-wc-more-menu]')) return openMoreMenu();
    if (t.closest('[data-wc-add-menu]')) return openAddMenu();
    if (t.closest('[data-wc-view-menu]')) return openViewMenu();
    if (t.closest('[data-wc-global-search]')) return app.go(`search?q=${encodeURIComponent(rt.st.q || '')}`);
    if (t.closest('[data-wc-clear-filters]')) return rt.setState({filters: {}}).then(renderFilters);
    if (t.closest('[data-wc-retry]')) return rt.reload();
    const quick = t.closest('[data-wc-quick]');
    if (quick) { const n = Number(quick.dataset.wcQuick); return rt.setState({range: 'custom', from: rt.today(), to: addDays(rt.today(), n)}); }
    const unscope = t.closest('[data-wc-unscope]');
    if (unscope) { delete rt.scope[unscope.dataset.wcUnscope]; syncChrome(); return rt.reload(); }
    const dismiss = t.closest('[data-wc-dismiss]');
    if (dismiss) { await dismissNotification(rt, dismiss.dataset.wcDismiss); return refreshStats(); }
    const suggest = t.closest('[data-wc-suggest]');
    if (suggest) { try { const a = JSON.parse(suggest.dataset.wcSuggest); return a.type === 'view' ? rt.setState({view: a.view}) : rt.setState({range: a.range, view: rt.st.view === 'attention' ? 'cards' : rt.st.view}); } catch { return null; } }
  });
  root.addEventListener('change', async e => {
    const t = e.target;
    if (t.matches('[data-wc-act="toggle"]')) { const item = itemOf(t); if (item) await runAction(rt.wc, item, 'toggle'); return; }
    if (t.matches('#wc-view-select')) return rt.setState({view: t.value});
    if (t.closest('#wc-filters') && (t.matches('[data-wc-f]') || t.matches('[data-wc-f-flag]'))) return rt.setState({filters: collectFilters()});
  });
  root.querySelector('[data-wc-custom]').addEventListener('submit', e => {
    e.preventDefault();
    const from = e.currentTarget.from.value, to = e.currentTarget.to.value;
    if (!from && !to) return toast('اختر تاريخ بداية أو نهاية.', 'error');
    rt.setState({range: 'custom', from, to});
  });
  let searchTimer = 0;
  root.querySelector('#wc-q').addEventListener('input', e => { clearTimeout(searchTimer); const value = e.target.value; searchTimer = setTimeout(() => { rt.st.q = value.trim().slice(0, 120); rt.reload(); }, 280); });
  root.querySelector('#wc-q').addEventListener('keydown', e => { if (e.key === 'Escape') { e.target.value = ''; rt.st.q = ''; rt.reload(); } });
  root.querySelector('.wc-tabs').addEventListener('keydown', e => {   // تنقل بالأسهم بين التبويبات (WAI-ARIA tabs)
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    const tabs = [...root.querySelectorAll('[data-wc-range]')], i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowLeft' ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next].focus(); tabs[next].click();
  });
  root.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.matches?.('.wc-card') && !e.target.matches('input,button,select')) { const item = rt.items.get(e.target.dataset.wcId); if (item) rt.openItem(item.id); }
  });

  // «المزيد»: كل الإجراءات الثانوية في ورقة واحدة (على الهاتف هي المسار الوحيد لها فتبقى الصفحة نظيفة).
  function openMoreMenu() {
    const list = [
      ['+ عمل إداري', () => openEntityForm(app, 'procedures', {onSaved: async () => { await rt.onChanged({}); }})],
      ['+ موعد', () => openEntityForm(app, 'appointments', {onSaved: async () => { await rt.onChanged({}); }})],
      ['+ متابعة اتصال', () => openEntityForm(app, 'communications', {preset: {followUpDate: addDays(rt.today(), 1)}, onSaved: async () => { await rt.onChanged({}); }})],
      ['ترتيب العناصر', () => openSort()], ['إعادة ضبط العرض', () => resetAll()],
      ['مراجعة نهاية اليوم', () => openDailyReview(rt)], ['مراجعة الأسبوع', () => openWeeklyReview(rt)],
      ['العروض المحفوظة', () => openSavedViews(rt)], ['ترتيب الأقسام وعرض الصفحة', () => rt.openLayout()], ['⚙ إعدادات مركز العمل', () => openWorkSettings(rt)],
      // يُضاف الجديد في نهاية القائمة حتى لا تتحرك فهارس العناصر القديمة (تعتمد عليها الاختبارات).
      ['تصدير العرض الحالي (CSV)', () => exportCurrentView(rt)], ['نسخ خلاصة اليوم', () => copyDaySummary(rt)],
      ['تحديث البيانات', async () => { await rt.onChanged({}); toast('تم تحديث البيانات'); }]
    ];
    const box = modal(`<h2 class="modal-title">المزيد من إجراءات مركز العمل</h2><div class="wc-sheet" role="menu">${list.map(([l], i) => `<button type="button" role="menuitem" class="wc-sheet-btn" data-i="${i}">${esc(l)}</button>`).join('')}</div>`);
    box.querySelectorAll('[data-i]').forEach(b => b.addEventListener('click', () => { closeModal(); list[Number(b.dataset.i)][1](); }));
  }

  // «+ إضافة ▾» في شريط الأدوات: قائمة موحدة للإنشاء (مهمة / عمل إداري / موعد / متابعة).
  function openAddMenu() {
    const list = [
      ['+ مهمة جديدة', () => newTask()],
      ['+ عمل إداري', () => openEntityForm(app, 'procedures', {onSaved: async () => { await rt.onChanged({}); }})],
      ['+ موعد', () => openEntityForm(app, 'appointments', {onSaved: async () => { await rt.onChanged({}); }})],
      ['+ متابعة اتصال', () => openEntityForm(app, 'communications', {preset: {followUpDate: addDays(rt.today(), 1)}, onSaved: async () => { await rt.onChanged({}); }})]
    ];
    const box = modal(`<h2 class="modal-title">إضافة</h2><div class="wc-sheet" role="menu">${list.map(([l], i) => `<button type="button" role="menuitem" class="wc-sheet-btn" data-i="${i}">${esc(l)}</button>`).join('')}</div>`);
    box.querySelectorAll('[data-i]').forEach(b => b.addEventListener('click', () => { closeModal(); list[Number(b.dataset.i)][1](); }));
  }

  // «طريقة العرض ▾» في شريط الأدوات: قائمة عرض مقسمة (تشغيل / تخطيط / مراجعة) —
  // كل مدخل يعيّن مجموعة نطاق + عرض (WORK_VIEWS دون تغيير).
  function openViewMenu() {
    const cur = {daily: rt.st.range === 'today', today: rt.st.range === 'today' && rt.st.view === 'cards', attention: rt.st.view === 'attention', cards: rt.st.view === 'cards' && rt.st.range !== 'today', myDay: rt.st.view === 'myDay'};
    const groups = [
      ['تشغيل', [['daily', 'يومي'], ['today', 'اليوم'], ['attention', 'يحتاج انتباهي'], ['cards', 'بطاقات'], ['myDay', 'يومي المدمج']]],
      ['تخطيط', [['calendar', 'تقويم'], ['kanban', 'كانبان'], ['priorities', 'الأولويات'], ['matrix', 'أيزنهاور']]],
      ['مراجعة', [['overdue', 'المتأخر'], ['upcoming', 'القادم'], ['completed', 'المنجز'], ['productivity', 'الإنتاجية']]]
    ];
    const run = async key => {
      if (key === 'daily') await rt.setState({range: 'today', from: '', to: ''});
      else if (key === 'today') await rt.setState({range: 'today', view: 'cards', from: '', to: ''});
      else if (key === 'myDay') await rt.setState({range: 'all', view: 'myDay', from: '', to: ''});
      else await rt.setState({view: key});
    };
    const box = modal(`<h2 class="modal-title">طريقة العرض</h2><div class="wc-sheet wc-view-menu" role="menu">${groups.map(([title, items]) => `<div class="wc-menu-group" role="group" aria-label="${esc(title)}"><h3>${esc(title)}</h3>${items.map(([k, l]) => `<button type="button" role="menuitem" class="wc-sheet-btn${cur[k] || rt.st.view === k ? ' is-current' : ''}" data-vm="${k}">${esc(l)}</button>`).join('')}</div>`).join('')}</div>`);
    box.querySelectorAll('[data-vm]').forEach(b => b.addEventListener('click', () => { closeModal(); run(b.dataset.vm); }));
  }
  function toggleFilters() {
    const box = root.querySelector('#wc-filters');
    box.hidden = !box.hidden;
    root.querySelectorAll('[data-wc-toggle-filters]').forEach(btn => btn.setAttribute('aria-expanded', String(!box.hidden)));
    if (!box.hidden && !box.innerHTML.trim()) renderFilters();
  }
  async function applyStat(key) {
    const today = rt.today();
    const map = {
      todayCount: {range: 'today', view: 'cards', filters: {}}, overdue: {range: 'overdue', view: 'cards', filters: {}}, tomorrow: {range: 'tomorrow', view: 'cards', filters: {}},
      hearingsNext7: {range: 'custom', from: today, to: addDays(today, 7), view: 'cards', filters: {sources: ['hearings']}},
      inProgress: {range: 'all', view: 'kanban', filters: {}}, waiting: {range: 'all', view: 'cards', filters: {statuses: ['waiting']}},
      postponed: {range: 'all', view: 'cards', filters: {statuses: ['postponed']}}, undated: {range: 'all', view: 'cards', filters: {undatedOnly: true}},
      doneToday: {range: 'today', view: 'completed', filters: {}}, pinned: {range: 'all', view: 'cards', filters: {pinned: true}}
    };
    const next = map[key]; if (!next) return;
    await rt.setState(next); await renderFilters();
  }
  async function newTask() {
    const preset = {dueDate: rt.st.range === 'tomorrow' ? addDays(rt.today(), 1) : (rt.st.range === 'today' ? rt.today() : ''), ...Object.fromEntries(Object.entries(rt.scope).filter(([k]) => ['fileId', 'caseId', 'clientId'].includes(k)))};
    return openEntityForm(app, 'workItems', {preset, title: 'مهمة جديدة', onSaved: async row => { toast(row?.kind === 'recurrence' ? 'تم إنشاء مهمة متكررة' : 'تمت إضافة المهمة'); await rt.onChanged({id: row?.id}); }});
  }
  async function openSort() {
    const ok = await confirmBox('<b>ترتيب العناصر</b><br>الترتيب الأساسي: الأقرب موعدًا ثم الوقت ثم الأعلى أولوية.<br>• «حسب الأولوية»: انتقل إلى عرض الأولويات.<br>• لفرز أي عمود: افتح عرض «قائمة» وانقر عنوان العمود.', {okText: 'عرض حسب الأولوية'});
    if (ok) await rt.setState({view: 'priorities'});
  }
  async function resetAll() {
    rt.scope = {}; Object.keys(shared.scope).forEach(k => delete shared.scope[k]);
    rt.st.q = ''; root.querySelector('#wc-q').value = '';
    await rt.setState({...DEFAULT_WORK_STATE, filters: {}, from: '', to: ''});
    await renderFilters(); toast('أُعيد ضبط العرض');
  }

  // ---------- تحديث تلقائي عند تغيّر البيانات من مصدر آخر (تبويب آخر/صفحة أخرى) ----------
  let watchTimer = 0;
  const off = events.on('entity:changed', () => {
    if (!root.isConnected) { off?.(); return; }
    if (Date.now() - rt.lastLocalChange < 900) return;     // تغييراتنا المحلية تُحدَّث صراحةً
    clearTimeout(watchTimer);
    watchTimer = setTimeout(() => {
      // لا تحديث ثانٍ إن أعاد إجراء محلي تحميل الصفحة بعد جدولة هذا المؤقت (يمنع إعادة التحميل المزدوجة).
      if (root.isConnected && Date.now() - rt.lastLocalChange > 1500) { rt.reload(); refreshStats(); }
    }, 600);
  });

  // ---------- تحديث صامت عند العودة إلى التبويب (مرة كل دقيقة كحد أدنى) ----------
  if (!app.__wcVisibleBound) {
    app.__wcVisibleBound = true;
    let lastAuto = 0;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      const live = app.__wc?.rt;
      if (!live?.root?.isConnected) return;
      if (Date.now() - Math.max(live.lastLocalChange || 0, lastAuto) < 60000) return;
      lastAuto = Date.now();
      live.onChanged({auto: 'visibility'}).catch?.(() => {});
    });
  }

  // ---------- اختصارات لوحة المفاتيح (خارج الحقول فقط، بلا Ctrl/Alt) ----------
  if (!app.__wcKeys) {
    app.__wcKeys = true;
    document.addEventListener('keydown', e => {
      const live = app.__wc?.rt;
      if (!live || !live.root.isConnected || !String(app.route || '').startsWith(PAGE_ID)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.target.isContentEditable) return;
      if (document.querySelector('#modal-root .modal-card') || document.querySelector('.dg-pop,.dg-ctx')) return;
      const key = e.key.toLowerCase();
      const map = {n: () => live.root.querySelector('[data-wc-new]')?.click(), t: () => live.setState({range: 'today'}), w: () => live.setState({range: 'week'}), m: () => live.setState({range: 'month'}), r: () => live.root.querySelector('[data-wc-refresh]')?.click()};
      if (map[key]) { e.preventDefault(); map[key](); }
    });
  }

  // ---------- الإقلاع ----------
  syncChrome();
  await renderFilters();
  await Promise.all([rt.reload(), refreshStats()]);
  if (shared.openItemId) { const id = shared.openItemId; shared.openItemId = ''; await rt.openItem(id); }
  const review = q?.get?.('review');
  if (review === 'day') openDailyReview(rt); else if (review === 'week') openWeeklyReview(rt);
}

// ---------- تصدير ونسخ خلاصة (بلا استعلامات جديدة: من خريطة العرض الحالية والملخص المحفوظ) ----------
function csvCell(value) { return `"${String(value ?? '').replace(/"/g, '""')}"`; }
export function buildWorkItemsCsv(items, {priorities = [], statuses = []} = {}) {
  const priLabel = Object.fromEntries(priorities.map(p => [p.key, p.label]));
  const statusLabel = item => {
    if (item.statusLabel) return item.statusLabel;
    const hit = statuses.find(s => s.key === item.status);
    return hit ? `${hit.icon} ${hit.label}` : item.status || '';
  };
  const header = ['العنوان', 'السياق / الوصف', 'المصدر', 'الحالة', 'الأولوية', 'موعد التنفيذ', 'الوقت', 'الوسوم', 'مرات التأجيل'];
  const lines = [header.map(csvCell).join(',')];
  for (const item of items) {
    lines.push([
      item.title, item.subtitle || '', item.sourceLabel || '', statusLabel(item),
      priLabel[item.priority] || item.priority || '', item.dueDate || '', item.dueTime || '',
      (item.tags || []).join(' | '), item.postponeCount || 0
    ].map(csvCell).join(','));
  }
  return '\uFEFF' + lines.join('\r\n');
}
function downloadTextFile(text, filename, type) {
  const blob = new Blob([text], {type});
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export function exportCurrentView(rt) {
  const items = [...rt.items.values()];
  if (!items.length) return toast('لا عناصر في العرض الحالي للتصدير.', 'info');
  const config = rt.config();
  const csv = buildWorkItemsCsv(items, {priorities: mergePriorities(config), statuses: mergeStatuses(config)});
  downloadTextFile(csv, `مركز-العمل-${rt.today()}.csv`, 'text/csv;charset=utf-8');
  toast(`صُدّر ${items.length} عنصرًا إلى ملف CSV.`, 'ok');
}
async function copyDaySummary(rt) {
  try {
    const s = rt.summary || await workSummary(rt.office);
    const lines = [
      `مركز العمل — ${longDateAr()}`,
      `اليوم: ${s.todayCount} · متأخر: ${s.overdue}${s.overdueCapped ? '+' : ''} · منجز اليوم: ${s.doneToday} · جلسات اليوم: ${s.hearingsToday}`,
      ''
    ];
    const page = await rt.fetch(rt.spec({range: 'today'}), {limit: 80});
    if (!page.items.length) lines.push('لا عناصر مجدولة لليوم.');
    else for (const item of page.items.slice(0, 80)) {
      const mark = item.isDone ? '✓' : (item.dueDate && item.dueDate < rt.today() && item.isOpen ? '⚠' : '•');
      lines.push(`${mark} ${item.title}${item.dueTime ? ` (${item.dueTime})` : ''}${item.sourceLabel ? ` — ${item.sourceLabel}` : ''}`);
    }
    const text = lines.join('\n');
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else throw new Error('no clipboard');
    toast('نُسخت خلاصة اليوم إلى الحافظة.', 'ok');
  } catch {
    const area = document.createElement('textarea');
    area.value = 'مركز العمل'; document.body.append(area); area.select();
    try { document.execCommand('copy'); toast('تعذر نسخ الخلاصة الكاملة على هذا الجهاز.', 'warn'); }
    catch { toast('تعذر النسخ على هذا الجهاز.', 'error'); }
    area.remove();
  }
}

// شارة مركز العمل تعيش في ui/work-badge.js (وحدة صغيرة تُحمَّل مع كل تنقل بلا تحميل الشاشة كاملة).
export {scheduleWorkBadge, refreshWorkBadge} from '../ui/work-badge.js';
