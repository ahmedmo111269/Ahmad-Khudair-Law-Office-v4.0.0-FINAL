// =====================================================================
// شريط التنقل العلوي الموحّد — v6
// ---------------------------------------------------------------------
// القائمة الجانبية القديمة صارت شريطًا أفقيًا أعلى البرنامج (Top Navigation):
// • تبويبات رئيسية بعرض مساحة البرنامج بالكامل، وكل تبويب يفتح لوحة صغيرة
//   منظمة بعناصره (Dropdown / Panel) مع الحالة النشطة الواضحة.
// • عند ضيق المساحة: تمرير أفقي داخل الشريط نفسه فقط + زر «المزيد» يجمع
//   التبويبات التي لم تتّسع — بلا أي تجاوز أفقي للصفحة.
// • الطي/التوسيع: الوضع المطوي شريط قصير جدًا مع زر إظهار واضح، والمحتوى
//   يستغل كامل العرض دائمًا (لا فراغ رأسي).
// • تخصيص كامل للتبويبات وعناصرها: إظهار/إخفاء/ترتيب (ui:topnav-config).
// • RTL كامل، أيقونات المشروع نفسها، وحفظ الحالة عند الانتقال بين الصفحات
//   (الشريط خارج #main-content فلا يُعاد بناؤه مع كل تنقل).
// • المسارات (routes) ومنطق الصفحات لم يتغيّر إطلاقًا.
// =====================================================================
import {icon} from './icons.js';
import {prefs} from '../core/preferences.js';
import {esc} from './dom.js';
import {open as overlayOpen} from './overlay-stack.js';
import {
  NAV_GROUPS, NAV_CONFIG_KEY, defaultNavConfig, normalizeNavConfig, orderedGroups, groupItems,
  groupIdForRoute, groupById, planOverflow, countLabel, sectionsLabel
} from './nav-model.js';

export {NAV_GROUPS, NAV_CONFIG_KEY};
// مفاتيح التفضيلات السابقة — نبقى على المفتاح نفسه حتى لا يفقد المستخدم حالته المحفوظة.
export const COLLAPSE_KEY = 'ui:sidebar-collapsed';
export const GROUPS_KEY = 'ui:nav-groups'; // مفتاح قديم (طي مجموعات الشريط الجانبي) — يُصدَّر للتوافق فقط
export const MOBILE_BP = '(max-width:900px)';
export const COMPACT_BP = '(max-width:640px)';

const MORE = '__more__', ALL = '__all__';
const HOVER_QUERY = '(hover:hover) and (pointer:fine)';

let cfg = null;              // تكوين التنقل الحالي (مطبَّع)
let openId = null;           // اللوحة المفتوحة حاليًا
let openAnchor = null;       // الزر الذي تفتح اللوحة تحته
let overflowIds = [];        // معرّفات التبويبات التي انتقلت إلى «المزيد»
let hoverTimer = null, leaveTimer = null, ro = null, badgeObserver = null, rafId = 0;

const canHover = () => typeof window.matchMedia === 'function' && window.matchMedia(HOVER_QUERY).matches;
const isCompact = () => typeof window.matchMedia === 'function' && window.matchMedia(COMPACT_BP).matches;
const onFrame = fn => {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(fn);
  return setTimeout(fn, 16);
};
const clean = v => String(v == null ? '' : v).replace(/[^\w-]/g, '');

/* ---------------------------------------------------------------------
   البناء
   --------------------------------------------------------------------- */
/** يبني شريط التنقل العلوي داخل العنصر #sidebar (يُستدعى مرة واحدة عند الإقلاع). */
export function buildTopNav() {
  const bar = document.querySelector('#sidebar');
  if (!bar) return null;
  if (bar.dataset.navReady === '1') return bar;
  bar.classList.add('tn-bar');
  bar.setAttribute('data-nav', 'top');
  bar.setAttribute('aria-label', 'التنقل الرئيسي');
  bar.innerHTML = '<div class="tn-inner" id="tn-inner"></div><div class="tn-panels" id="tn-panels"></div>';
  bar.dataset.navReady = '1';
  cfg = normalizeNavConfig(prefs.get(NAV_CONFIG_KEY, null));
  ensureBackdrop();
  render();
  bindTopNav();
  return bar;
}
/** اسم قديم للتوافق مع بقية الوحدات (app.js / الإعدادات / الاختبارات). */
export function buildSidebar() { return buildTopNav(); }

function render() {
  const bar = document.querySelector('#sidebar');
  if (!bar) return;
  const inner = bar.querySelector('#tn-inner'), panels = bar.querySelector('#tn-panels');
  if (!inner || !panels) return;
  closePanel(); // أي إعادة رسم تُغلق اللوحة القديمة (تخصيص مثلًا)
  const groups = orderedGroups(cfg);
  inner.innerHTML = `
   ${brandHtml()}
   <span class="tn-sep" aria-hidden="true"></span>
   <div class="tn-strip" id="tn-strip">
    ${groups.map(tabHtml).join('')}
    <button type="button" class="tn-tab tn-more" id="tn-more" aria-expanded="false" aria-haspopup="true" aria-controls="tn-panel-more" title="المزيد من الأقسام" hidden>${icon('dots')}<span class="tn-tab-label">المزيد</span>${icon('chevron','tn-chev')}</button>
   </div>
   <div class="tn-actions">
    <button type="button" class="tn-btn tn-all" id="tn-all" aria-expanded="false" aria-haspopup="true" aria-controls="tn-panel-all" title="كل الأقسام">${icon('menu')}<span class="tn-btn-txt">كل الأقسام</span></button>
    <button type="button" class="tn-btn tn-cust" id="tn-cust" title="تخصيص التبويبات وترتيبها" aria-haspopup="dialog">${icon('settings')}<span class="tn-btn-txt">تخصيص</span></button>
    <button type="button" class="tn-btn tn-toggle" id="tn-toggle" aria-pressed="false" title="طي شريط التنقل">${icon('panelCollapse')}<span class="tn-btn-txt tn-toggle-txt">طي</span></button>
    <span class="tn-db" title="قاعدة البيانات الحالية">${icon('database')}<span class="tn-db-name" id="sb-db-name">قاعدة المكتب</span></span>
   </div>`;
  panels.innerHTML = `${groups.map(panelHtml).join('')}${morePanelHtml()}${allPanelHtml(groups)}`;
  observeBadges(panels);
  syncToggle();
  layout();
  applyActive(lastRoute);
}
function brandHtml() {
  return `<button type="button" class="tn-brand" data-route="dashboard" title="الرئيسية">
   <span class="tn-brand-mark" aria-hidden="true">${icon('scale')}</span>
   <span class="tn-brand-txt"><strong>مكتب الأستاذ</strong><small>أحمد محمد خضير المحامي</small></span>
  </button>`;
}
function tabHtml(g) {
  return `<button type="button" class="tn-tab" id="tn-tab-${g.id}" data-tab="${g.id}" aria-expanded="false" aria-controls="tn-panel-${g.id}" title="${esc(g.label)} — ${esc(countLabel(g.items.length))}">
   ${icon(g.icon)}<span class="tn-tab-label">${esc(g.tab || g.label)}</span>${icon('chevron','tn-chev')}
  </button>`;
}
function panelHtml(g) {
  return `<div class="tn-panel" id="tn-panel-${g.id}" data-panel="${g.id}" role="group" aria-labelledby="tn-tab-${g.id}" hidden${g.items.length >= 5 ? ' data-cols="2"' : ''}>
   <div class="tn-panel-head"><span class="tn-ph-ic">${icon(g.icon)}</span><span class="tn-ph-txt"><strong>${esc(g.label)}</strong><small>${esc(countLabel(g.items.length))}</small></span></div>
   <div class="tn-panel-body">${g.items.map(itemHtml).join('')}</div>
  </div>`;
}
function itemHtml(it) {
  return `<button type="button" class="tn-item" data-route="${it.route}">${icon(it.icon)}<span class="tn-item-label">${esc(it.label)}</span></button>`;
}
function morePanelHtml() {
  return `<div class="tn-panel tn-panel-more" id="tn-panel-more" role="group" aria-label="المزيد من الأقسام" hidden>
   <div class="tn-panel-head"><span class="tn-ph-ic">${icon('dots')}</span><span class="tn-ph-txt"><strong>المزيد</strong><small>أقسام إضافية لم تتّسع في الشريط</small></span></div>
   <div class="tn-panel-body" id="tn-more-list"></div>
  </div>`;
}
function allPanelHtml(groups) {
  const total = groups.reduce((a, g) => a + g.items.length, 0);
  return `<div class="tn-panel tn-panel-all" id="tn-panel-all" role="group" aria-label="كل الأقسام" hidden>
   <div class="tn-panel-head"><span class="tn-ph-ic">${icon('menu')}</span><span class="tn-ph-txt"><strong>كل الأقسام</strong><small>${esc(sectionsLabel(groups.length))} · ${esc(countLabel(total))}</small></span></div>
   ${groups.map(g => `<section class="tn-sec"><h4 class="tn-sec-head">${icon(g.icon)}<span>${esc(g.label)}</span></h4><div class="tn-sec-items">${g.items.map(itemHtml).join('')}</div></section>`).join('')}
   <div class="tn-panel-foot"><span class="tn-foot-hint">Ctrl + K للبحث والتنقل الفوري</span><button type="button" class="tn-foot-link" data-cust-open>${icon('settings')} تخصيص التبويبات</button></div>
  </div>`;
}

/* ---------------------------------------------------------------------
   التوزيع والقياس
   --------------------------------------------------------------------- */
/**
 * قياس ارتفاع الشريط وضبط إزاحة شريط الأدوات الملتصق تحته بدقة.
 * • يُقرأ الارتفاع الفعلي (getBoundingClientRect ثم offsetHeight) بكسور مقرّبة لأعلى،
 *   فالشريط قد يزيد ارتفاعه على الهاتف (أزرار أكبر/خط مختلف/شريط حالة).
 * • لا نكتب صفرًا أبدًا: قياس فاشل أو شريط غير مرسوم يجب ألا يجعل شريط الأدوات
 *   يلتصق في أعلى الشاشة فوق شريط التنقل.
 * يعيد الارتفاع المقيس بالبكسل (0 عند تعذّر القياس).
 */
function measureHeight(bar) {
  const el = bar || document.querySelector('#sidebar');
  if (!el) return 0;
  const h = Math.ceil(el.getBoundingClientRect?.().height || el.offsetHeight || 0);
  if (h > 0) document.documentElement.style.setProperty('--topnav-h', `${h}px`);
  return h;
}
/** يوزّع التبويبات بين الشريط و«المزيد» بحسب المساحة المتاحة فعلًا. */
function layout() {
  const bar = document.querySelector('#sidebar');
  if (!bar || !bar.classList.contains('tn-bar')) return;
  measureHeight(bar);
  const strip = bar.querySelector('#tn-strip'), more = bar.querySelector('#tn-more');
  if (!strip || !more) return;
  const tabs = [...strip.querySelectorAll('.tn-tab[data-tab]')];
  tabs.forEach(t => { t.hidden = false; });
  more.hidden = true; // القياس الأول بلا حجز مساحة «المزيد» حتى لا نحسبه مرتين
  const reset = () => { more.hidden = true; overflowIds = []; fillMore([]); };
  // الهاتف: كل التبويبات تبقى داخل الشريط القابل للتمرير أفقيًا + زر «كل الأقسام»
  if (!isDesktop()) { reset(); return; }
  if (!tabs.length || !strip.clientWidth || isCollapsed()) { reset(); return; } // لا مساحة قابلة للقياس (أو الوضع المطوي)
  const gap = parseFloat(typeof getComputedStyle === 'function' ? getComputedStyle(strip).columnGap : '') || 6;
  const widths = tabs.map(t => t.offsetWidth || 0);
  const plain = planOverflow({widths, gap, available: strip.clientWidth, moreWidth: 0});
  if (!plain.more) { reset(); return; } // تتّسع كل التبويبات بلا «المزيد»
  more.hidden = false;
  const plan = planOverflow({widths, gap, available: strip.clientWidth, moreWidth: more.offsetWidth || 96});
  overflowIds = plan.overflow.map(i => tabs[i].dataset.tab);
  plan.overflow.forEach(i => { tabs[i].hidden = true; });
  fillMore(overflowIds);
  // تحقّق أخير بعد الرسم (الخطوط/الأحجام قد تختلف قليلًا) — نُخفّض حتى يتّسع الشريط فعلًا.
  let guard = 0;
  while (strip.scrollWidth > strip.clientWidth + 1 && guard++ < 24) {
    const last = [...strip.querySelectorAll('.tn-tab[data-tab]:not([hidden])')].pop();
    if (!last) break;
    last.hidden = true;
    overflowIds.push(last.dataset.tab);
    fillMore(overflowIds);
  }
  // إن صار التبويب المفتوح داخل «المزيد» أو اختفى، نُغلق لوحته حتى لا تبقى معلّقة
  if (openId && openId !== ALL && openId !== MORE) {
    const openTab = bar.querySelector(`.tn-tab[data-tab="${clean(openId)}"]`);
    if (openTab?.hidden) closePanel();
  }
}
/** يملأ لوحة «المزيد» بأزرار التبويبات التي لم تتّسع (عناصرها تبقى في لوحاتها). */
function fillMore(ids) {
  const bar = document.querySelector('#sidebar');
  const host = bar?.querySelector('#tn-more-list');
  if (!host) return;
  host.innerHTML = ids.map(id => {
    const g = groupById(id);
    if (!g) return '';
    const items = groupItems(g, cfg);
    return `<button type="button" class="tn-item tn-more-item" data-tab-open="${g.id}" aria-expanded="false" aria-controls="tn-panel-${g.id}" title="${esc(g.label)}">${icon(g.icon)}<span class="tn-item-label">${esc(g.label)}</span><span class="tn-item-meta">${items.length}</span>${icon('chevron','tn-go')}</button>`;
  }).join('');
  host.hidden = !ids.length;
  applyActive(lastRoute);
}

/* ---------------------------------------------------------------------
   اللوحات
   --------------------------------------------------------------------- */
function panelFor(id) {
  const bar = document.querySelector('#sidebar');
  if (!bar) return null;
  if (id === MORE) return bar.querySelector('#tn-panel-more');
  if (id === ALL) return bar.querySelector('#tn-panel-all');
  return bar.querySelector(`#tn-panel-${clean(id)}`);
}
function ensureBackdrop() {
  let b = document.querySelector('#tn-backdrop');
  if (!b) {
    b = document.createElement('div');
    b.id = 'tn-backdrop';
    b.className = 'tn-backdrop';
    b.hidden = true;
    b.addEventListener('click', () => closePanel());
    document.body.append(b);
  }
  return b;
}
function showBackdrop(on) {
  const b = ensureBackdrop();
  b.hidden = !on;
}
export function openPanel(id, anchor, {focusFirst = false} = {}) {
  const bar = document.querySelector('#sidebar');
  if (!bar || !anchor) return;
  if (isCollapsed() && id !== ALL && id !== MORE) return; // لا تبويبات في الوضع المطوي
  const panel = panelFor(id);
  if (!panel) return;
  if (openId && openId !== id) closePanel({keepTriggers: true});
  clearTimeout(leaveTimer);
  openId = id;
  openAnchor = anchor;
  panel.hidden = false;
  syncTriggers();
  positionPanel(panel, anchor);
  const lock = id === ALL && !isDesktop();
  showBackdrop(lock);
  document.body.classList.toggle('tn-lock', lock);
  if (focusFirst) panel.querySelector('.tn-item')?.focus?.({preventScroll: true});
  // لوحة التنقل على الهاتف طبقة علوية: زر الرجوع في Android يغلقها وحدها ولا يخرج
  // من التطبيق. (لوحات سطح المكتب تُفتح بالتحويم/النقر خارجها ولا تضيف تاريخًا.)
  if (openId === id && !isDesktop()) armPanelGuard();
}
let releasePanelGuard = null;
function armPanelGuard() {
  if (releasePanelGuard) return;
  releasePanelGuard = overlayOpen('nav-panel', () => { closePanel(); return true; });
}
function disarmPanelGuard() {
  if (openId) return;
  const release = releasePanelGuard;
  releasePanelGuard = null;
  try { release?.(); } catch { /* متجاهَل */ }
}
export function closePanel({keepTriggers = false} = {}) {
  const bar = document.querySelector('#sidebar');
  if (bar) bar.querySelectorAll('.tn-panel').forEach(p => { p.hidden = true; });
  if (!openId && !keepTriggers) { disarmPanelGuard(); return; }
  openId = null;
  openAnchor = null;
  clearTimeout(leaveTimer);
  if (!keepTriggers) syncTriggers();
  showBackdrop(false);
  document.body.classList.remove('tn-lock');
  disarmPanelGuard();
}
/** موضع اللوحة أسفل زرها مع تقييدها داخل الشاشة (RTL/LTR على حد سواء). */
function positionPanel(panel, anchor) {
  const bar = document.querySelector('#sidebar');
  if (!bar || !anchor) return;
  if (isCompact()) { // الهاتف: لوحة بعرض الشاشة تحت الشريط
    panel.style.left = '8px';
    panel.style.right = '8px';
    panel.style.width = 'auto';
    panel.style.maxWidth = 'none';
    return;
  }
  panel.style.right = 'auto';
  panel.style.width = '';
  panel.style.maxWidth = '';
  const barRect = bar.getBoundingClientRect?.() || {}, aRect = anchor.getBoundingClientRect?.() || barRect;
  const vw = window.innerWidth || document.documentElement?.clientWidth || barRect.width || 0;
  const width = panel.offsetWidth || panel.getBoundingClientRect?.().width || 260;
  const start = (aRect.left || 0) - (barRect.left || 0);
  const max = Math.max(8, vw - width - 8);
  const left = Math.min(Math.max(8, start), max);
  panel.style.left = `${Math.round(left)}px`;
}
function syncTriggers() {
  const bar = document.querySelector('#sidebar');
  if (!bar) return;
  bar.querySelectorAll('[data-tab],[data-tab-open],#tn-more,#tn-all').forEach(b => b.setAttribute('aria-expanded', 'false'));
  const active = openId === MORE ? bar.querySelector('#tn-more') : openId === ALL ? bar.querySelector('#tn-all') : bar.querySelector(`.tn-tab[data-tab="${clean(openId || '')}"]`);
  if (active) active.setAttribute('aria-expanded', 'true');
}
function openCustomizer() {
  closePanel();
  import('./nav-customize.js').then(m => m.openNavCustomizer({
    getConfig: () => cfg,
    onChange: next => { cfg = normalizeNavConfig(next); prefs.set(NAV_CONFIG_KEY, cfg); render(); },
    onReset: () => { cfg = defaultNavConfig(); prefs.set(NAV_CONFIG_KEY, cfg); render(); }
  })).catch(e => console.error('nav customize', e));
}
export {openCustomizer as openNavCustomizer};

/* ---------------------------------------------------------------------
   التفاعل
   --------------------------------------------------------------------- */
function bindTopNav() {
  const bar = document.querySelector('#sidebar');
  if (!bar || bar.dataset.navBound === '1') return;
  bar.dataset.navBound = '1';
  bar.addEventListener('click', onBarClick);
  bar.addEventListener('keydown', onBarKeydown);
  bar.addEventListener('mouseover', onBarHover);
  bar.addEventListener('mouseenter', () => clearTimeout(leaveTimer));
  bar.addEventListener('mouseleave', onBarLeave);
  bar.querySelector('#tn-strip')?.addEventListener('scroll', () => {
    if (!openId || !openAnchor || openId === ALL) return;
    if (rafId) return;
    rafId = onFrame(() => { rafId = 0; const p = panelFor(openId); if (p && openAnchor) positionPanel(p, openAnchor); });
  }, {passive: true});
  if (!bindTopNav._docBound) { // مستمعا المستند مرة واحدة فقط مهما أُعيد بناء الشريط
    bindTopNav._docBound = true;
    document.addEventListener('pointerdown', e => { const b = document.querySelector('#sidebar'); if (openId && b && !b.contains(e.target)) closePanel(); }, true);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && openId) closePanel(); });
  }
  bar.addEventListener('focusout', e => { const to = e.relatedTarget; if (openId && (!to || !bar.contains(to))) closePanel(); });
  if (!bindTopNav._resizeBound) {
    bindTopNav._resizeBound = true;
    window.addEventListener('resize', onViewportChange);
  }
  if (typeof ResizeObserver === 'function') {
    try { ro?.disconnect(); } catch { /* detached navigation bar */ }
    ro = new ResizeObserver(() => layout());
    ro.observe(bar);
  }
  document.fonts?.ready?.then?.(() => layout());
  onFrame(() => layout());
}
function onViewportChange() {
  clearTimeout(onViewportChange._t);
  onViewportChange._t = setTimeout(() => {
    if (openId && !isDesktop() && openId !== ALL && !isCollapsed()) closePanel();
    layout();
    if (openId && openAnchor) { const p = panelFor(openId); if (p) positionPanel(p, openAnchor); }
  }, 120);
}
function onBarClick(e) {
  const bar = e.currentTarget;
  const hit = sel => e.target?.closest?.(sel) || null;
  const tab = hit('.tn-tab[data-tab]');
  if (tab) { togglePanel(tab.dataset.tab, tab); return; }
  if (hit('#tn-more')) { togglePanel(MORE, bar.querySelector('#tn-more')); return; }
  const mini = hit('[data-tab-open]');
  if (mini) { openPanel(mini.dataset.tabOpen, bar.querySelector('#tn-more') || mini); return; }
  if (hit('#tn-all')) { togglePanel(ALL, bar.querySelector('#tn-all')); return; }
  if (hit('#tn-cust') || hit('[data-cust-open]')) { openCustomizer(); return; }
  if (hit('#tn-toggle')) { toggleCollapsed(!isCollapsed()); return; }
  if (hit('.tn-item[data-route]')) closePanel(); // التنقل نفسه يُربط في app.js (تفويض على #sidebar)
}
function togglePanel(id, anchor) {
  if (openId === id) closePanel();
  else openPanel(id, anchor);
}
function onBarHover(e) {
  if (!canHover() || isCollapsed() || openId === ALL) return;
  const tab = e.target?.closest?.('.tn-tab[data-tab]');
  if (!tab || tab.dataset.tab === openId) return;
  clearTimeout(leaveTimer);
  clearTimeout(hoverTimer);
  hoverTimer = setTimeout(() => openPanel(tab.dataset.tab, tab), 130);
}
function onBarLeave() {
  if (!canHover()) return;
  clearTimeout(hoverTimer);
  leaveTimer = setTimeout(() => { if (openId && openId !== ALL) closePanel(); }, 300);
}
function onBarKeydown(e) {
  const bar = e.currentTarget;
  const key = e.key;
  if (key === 'Escape') {
    if (openId) {
      e.preventDefault();
      e.stopPropagation();
      const anchor = openAnchor;
      closePanel();
      anchor?.focus?.({preventScroll: true});
    }
    return;
  }
  const cur = document.activeElement;
  const inPanel = cur?.closest?.('.tn-panel');
  if (inPanel && (key === 'ArrowDown' || key === 'ArrowUp')) {
    const items = [...inPanel.querySelectorAll('.tn-item')].filter(b => !b.hidden);
    if (!items.length) return;
    e.preventDefault();
    const at = items.indexOf(cur);
    const next = (at + (key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next].focus();
    return;
  }
  const trigger = cur?.closest?.('[data-tab],[data-tab-open],#tn-more,#tn-all,#tn-cust,#tn-toggle');
  if (!trigger) return;
  if (key === 'ArrowDown' && trigger.dataset.tab) {
    e.preventDefault();
    openPanel(trigger.dataset.tab, trigger, {focusFirst: true});
    return;
  }
  if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'Home' && key !== 'End') return;
  const list = [...bar.querySelectorAll('#tn-strip .tn-tab:not([hidden]),#tn-all,#tn-cust,#tn-toggle')];
  const at = list.indexOf(trigger);
  if (at < 0) return;
  const rtl = (document.documentElement.getAttribute('dir') || 'rtl') !== 'ltr';
  let next;
  if (key === 'Home') next = 0;
  else if (key === 'End') next = list.length - 1;
  else {
    const forward = (key === 'ArrowLeft') === rtl; // RTL: يسار = التالي بصريًا
    next = (at + (forward ? 1 : -1) + list.length) % list.length;
  }
  e.preventDefault();
  list[next]?.focus?.({preventScroll: true});
}

/* ---------------------------------------------------------------------
   الحالة النشطة + شارات العدّادات
   --------------------------------------------------------------------- */
let lastRoute = null;
/** تحديد التبويب النشط (الأب) والعنصر النشط حسب المسار الحالي. */
export function setActiveRoute(navKey) {
  lastRoute = navKey;
  applyActive(navKey);
}
function applyActive(navKey) {
  const bar = document.querySelector('#sidebar');
  if (!bar) return;
  const activeTab = groupIdForRoute(navKey);
  bar.querySelectorAll('.tn-tab[data-tab]').forEach(b => {
    const on = b.dataset.tab === activeTab;
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
  });
  bar.querySelectorAll('.tn-item[data-route]').forEach(b => {
    const on = b.dataset.route === navKey;
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  const more = bar.querySelector('#tn-more');
  if (more) {
    const tabBtn = activeTab ? bar.querySelector(`.tn-tab[data-tab="${clean(activeTab)}"]`) : null;
    // نشط أيضًا إذا كان قسم الصفحة الحالية داخل «المزيد» أو مخفيًا بتخصيص المستخدم
    const on = Boolean(activeTab) && (!tabBtn || tabBtn.hidden);
    more.classList.toggle('active', on);
    const g = groupById(activeTab);
    more.setAttribute('aria-label', on && g ? `المزيد — القسم الحالي: ${g.label}` : 'المزيد');
  }
  const tab = activeTab ? bar.querySelector(`.tn-tab[data-tab="${clean(activeTab)}"]`) : null;
  if (tab && !tab.hidden && typeof tab.scrollIntoView === 'function') {
    try {
      const strip = bar.querySelector('#tn-strip');
      const r = tab.getBoundingClientRect?.(), s = strip?.getBoundingClientRect?.();
      if (r && s && (r.left < s.left || r.right > s.right)) tab.scrollIntoView({block: 'nearest', inline: 'nearest'});
    } catch {}
  }
  syncBadges();
}
function observeBadges(panels) {
  if (typeof MutationObserver !== 'function' || !panels) return;
  badgeObserver?.disconnect?.();
  badgeObserver = new MutationObserver(() => syncBadges());
  badgeObserver.observe(panels, {childList: true, subtree: true});
}
/** يعكس شارة العدّاد (مركز العمل) من العنصر إلى التبويب الأب لتبقى ظاهرة دائمًا. */
function syncBadges() {
  const bar = document.querySelector('#sidebar');
  if (!bar) return;
  bar.querySelectorAll('.tn-tab[data-tab]').forEach(tab => {
    const src = bar.querySelector(`#tn-panel-${clean(tab.dataset.tab)} .tn-item .nav-badge`);
    const val = src?.textContent?.trim();
    let mirror = tab.querySelector('.tn-badge');
    if (val) {
      if (!mirror) { mirror = document.createElement('span'); mirror.className = 'tn-badge'; tab.append(mirror); }
      if (mirror.textContent !== val) mirror.textContent = val;
    } else if (mirror) mirror.remove();
  });
}

/* ---------------------------------------------------------------------
   الطي/التوسيع + الهاتف
   --------------------------------------------------------------------- */
export function isDesktop() {
  return typeof window.matchMedia !== 'function' ? true : !window.matchMedia(MOBILE_BP).matches;
}
export function isCollapsed() {
  return document.body.classList.contains('topnav-collapsed');
}
function syncToggle() {
  const btn = document.querySelector('#tn-toggle');
  if (!btn) return;
  const collapsed = isCollapsed();
  btn.setAttribute('aria-pressed', String(collapsed));
  const txt = btn.querySelector('.tn-toggle-txt');
  if (txt) txt.textContent = collapsed ? 'إظهار' : 'طي';
  btn.title = collapsed ? 'إظهار شريط التنقل' : 'طي شريط التنقل';
}
function applyCollapsed(collapsed, {persist = true} = {}) {
  closePanel();
  document.body.classList.toggle('topnav-collapsed', collapsed);
  document.documentElement.dataset.nav = collapsed ? 'collapsed' : 'open';
  // إشارة توافق للوحدات/الاختبارات القديمة (كانت خاصة بالشريط الجانبي)
  document.documentElement.dataset.sidebar = collapsed ? 'collapsed' : 'open';
  document.documentElement.style.setProperty('--sb-current', collapsed ? 'var(--sb-w-collapsed)' : 'var(--sb-w)');
  if (persist && isDesktop()) prefs.set(COLLAPSE_KEY, collapsed);
  syncToggle();
  document.querySelector('#mobile-menu')?.setAttribute('aria-expanded', String(!collapsed));
  onFrame(() => { const bar = document.querySelector('#sidebar'); if (bar) measureHeight(bar); layout(); });
}
/** طي/توسيع شريط التنقل العلوي مع حفظ الحالة. */
export function toggleCollapsed(force) {
  const collapsed = force === undefined ? !isCollapsed() : Boolean(force);
  applyCollapsed(collapsed);
  return collapsed;
}
/** الهاتف: يفتح/يغلق لوحة «كل الأقسام» المنظمة. */
export function toggleMobile(force) {
  const bar = document.querySelector('#sidebar');
  if (!bar) return;
  const open = force === undefined ? openId !== ALL : Boolean(force);
  if (open) openPanel(ALL, bar.querySelector('#tn-all') || bar.querySelector('#tn-toggle'));
  else closePanel();
}
export const closeMobile = () => { const was = Boolean(openId); closePanel(); return was; };

/** تطبيق الحالة المحفوظة عند الإقلاع + متابعة تغيّر المقاسات. */
export function initSidebarState() {
  applyCollapsed(isDesktop() && Boolean(prefs.get(COLLAPSE_KEY, false)), {persist: false});
  if (typeof window.matchMedia === 'function') {
    window.matchMedia(MOBILE_BP).addEventListener?.('change', () => { closePanel(); layout(); });
    window.matchMedia(COMPACT_BP).addEventListener?.('change', () => { closePanel(); layout(); });
  }
  window.addEventListener('orientationchange', () => { closePanel(); onFrame(layout); });
  document.fonts?.ready?.then?.(() => layout());
  // إزاحة شريط الأدوات الملتصق تُعاد قياسها بعد أي تغيير قد يغيّر ارتفاع شريط
  // التنقل (تحميل الخطوط، تكبير المتصفح، إعادة الرسم على الهاتف) — وإلا بقي
  // الشريط في موضع قديم فغطّى عنوان الصفحة أو ترك فراغًا.
  const remeasure = () => measureHeight();
  window.addEventListener('load', remeasure);
  window.addEventListener('resize', remeasure, {passive: true});
  window.visualViewport?.addEventListener?.('resize', remeasure);
  for (const delay of [0, 120, 400, 1200]) setTimeout(remeasure, delay);
  onFrame(() => layout());
}
