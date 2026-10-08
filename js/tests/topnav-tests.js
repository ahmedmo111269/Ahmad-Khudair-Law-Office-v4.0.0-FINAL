// =====================================================================
// اختبارات شريط التنقل العلوي v6 (تعمل في المتصفح وفي Node عبر harness)
// ---------------------------------------------------------------------
// تتحقق من: تغطية كل عناصر القائمة السابقة، تطبيع التخصيص، التوزيع بين
// الشريط و«المزيد»، التبويب النشط، الطي والتوسيع، لوحات التبويبات، والوصول.
// =====================================================================
import {
  NAV_GROUPS, NAV_ROUTES, NAV_CONFIG_KEY, defaultNavConfig, normalizeNavConfig, orderedGroups,
  groupItems, orderedTabIds, itemRoutesInOrder, groupIdForRoute, planOverflow, moveInList,
  countLabel, sectionsLabel
} from '../ui/nav-model.js';
import {buildTopNav, buildSidebar, toggleCollapsed, isCollapsed, setActiveRoute, openPanel, closePanel, toggleMobile, closeMobile} from '../ui/topnav.js';
import {icon} from '../ui/icons.js';
import {prefs} from '../core/preferences.js';

const SHELL = '<div id="app"><nav id="sidebar" class="tn-bar" data-nav="top"></nav><main><section id="main-content"></section></main></div><div id="modal-root"></div>';
const ALL_ROUTES = ['dashboard', 'actionCenter', 'files', 'clients', 'opponents', 'cases', 'powersOfAttorney', 'hearings', 'procedures', 'serviceRecords', 'bailiffs', 'appointments', 'communications', 'caseNotes', 'reminders', 'judgments', 'expertReports', 'execution', 'fees', 'documentReferences', 'search', 'reports', 'analytics', 'integrity', 'repair', 'databases', 'backup', 'sync', 'settings'];
const fresh = () => { document.body.innerHTML = SHELL; return buildTopNav(); };

export async function runTopNavTests(test, expect) {
  test('تنقل علوي: كل عناصر القائمة السابقة محفوظة مع مسار المزامنة (30 مسارًا)', () => {
    expect(new Set(NAV_ROUTES).size).toBe(NAV_ROUTES.length);
    expect(NAV_ROUTES.length).toBe(30);
    for (const r of ALL_ROUTES) expect(NAV_ROUTES.includes(r)).toBe(true);
    expect(NAV_GROUPS.length).toBe(6);
  });
  test('تنقل علوي: كل عنصر له أيقونة موجودة فعلًا', () => {
    for (const g of NAV_GROUPS) {
      expect(Boolean(g.icon && icon(g.icon))).toBe(true);
      for (const it of g.items) if (!it.icon || !icon(it.icon)) throw Error('أيقونة مفقودة: ' + it.route);
    }
  });
  test('تنقل علوي: التكوين الافتراضي يعرض كل التبويبات وكل العناصر', () => {
    const cfg = defaultNavConfig();
    expect(orderedTabIds(cfg).length).toBe(6);
    const groups = orderedGroups(cfg);
    expect(groups.length).toBe(6);
    expect(groups.flatMap(g => g.items.map(i => i.route)).length).toBe(30);
  });
  test('تنقل علوي: تطبيع التخصيص يتجاهل المجهول ويحمي من الإخفاء الكامل', () => {
    const bad = normalizeNavConfig({tabOrder: ['system', 'ghost', 'general', 'system'], hiddenTabs: ['ghost'], hiddenItems: ['ghostRoute'], itemOrder: {data: ['clients', 'ghostRoute']}});
    expect(orderedTabIds(bad).length).toBe(6);
    expect(orderedTabIds(bad)[0]).toBe('system');
    expect(bad.hiddenTabs.includes('ghost')).toBe(false);
    expect(bad.hiddenItems.includes('ghostRoute')).toBe(false);
    expect(bad.itemOrder.data[0]).toBe('clients');
    // لا يمكن إخفاء كل التبويبات
    const allHidden = normalizeNavConfig({hiddenTabs: orderedTabIds(bad)});
    expect(allHidden.hiddenTabs.length).toBe(0);
    // لا يمكن إخفاء كل عناصر قسم واحد
    const g = NAV_GROUPS.find(x => x.id === 'insight');
    const wipe = normalizeNavConfig({hiddenItems: g.items.map(i => i.route)});
    expect(wipe.hiddenItems.length < g.items.length).toBe(true);
  });
  test('تنقل علوي: ترتيب المستخدم يحكم التبويبات والعناصر معًا', () => {
    const cfg = normalizeNavConfig({tabOrder: ['system', 'general'], itemOrder: {general: ['actionCenter', 'dashboard']}});
    const ids = orderedTabIds(cfg);
    expect(ids[0]).toBe('system');
    expect(ids[1]).toBe('general');
    const general = NAV_GROUPS.find(g => g.id === 'general');
    expect(itemRoutesInOrder(general, cfg)[0]).toBe('actionCenter');
    expect(groupItems(general, cfg).map(i => i.route).join()).toBe('actionCenter,dashboard');
  });
  test('تنقل علوي: نقل عنصر داخل قائمة يحترم الحدود', () => {
    expect(moveInList(['a', 'b', 'c'], 0, 1).join()).toBe('b,a,c');
    expect(moveInList(['a', 'b', 'c'], 2, -1).join()).toBe('a,c,b');
    expect(moveInList(['a', 'b', 'c'], 0, -1).join()).toBe('a,b,c');
    expect(moveInList(['a', 'b', 'c'], 2, 1).join()).toBe('a,b,c');
  });
  test('تنقل علوي: خطة التوزيع بين الشريط و«المزيد»', () => {
    const wide = planOverflow({widths: [100, 100, 100], gap: 8, available: 400});
    expect(wide.more).toBe(false);
    expect(wide.overflow.length).toBe(0);
    const tight = planOverflow({widths: [100, 100, 100, 100], gap: 8, available: 300, moreWidth: 90});
    expect(tight.more).toBe(true);
    expect(tight.overflow.length > 0).toBe(true);
    expect(tight.keep.length > 0).toBe(true);
    expect(tight.overflow[0] > tight.keep[tight.keep.length - 1]).toBe(true);
    const tiny = planOverflow({widths: [400], gap: 8, available: 120, moreWidth: 90});
    expect(tiny.keep.length).toBe(1); // يبقى تبويب واحد على الأقل في الشريط
    const none = planOverflow({widths: [], gap: 8, available: 0});
    expect(none.more).toBe(false);
  });
  test('تنقل علوي: صياغة الأعداد بالعربية', () => {
    expect(countLabel(1)).toBe('عنصر واحد');
    expect(countLabel(2)).toBe('عنصران');
    expect(countLabel(5)).toBe('5 عناصر');
    expect(countLabel(27)).toBe('27 عنصرًا');
    expect(sectionsLabel(6)).toBe('6 أقسام');
  });
  test('تنقل علوي: البناء ينتج شريطًا أفقيًا بعرض كامل وكل المسارات قابلة للوصول', () => {
    const bar = fresh();
    expect(Boolean(bar)).toBe(true);
    expect(bar.tagName).toBe('NAV');
    expect(bar.classList.contains('tn-bar')).toBe(true);
    expect(bar.getAttribute('data-nav')).toBe('top');
    expect(Boolean(bar.querySelector('#tn-strip'))).toBe(true);
    expect(Boolean(bar.querySelector('.tn-actions'))).toBe(true);
    expect(bar.querySelector('.tn-brand').dataset.route).toBe('dashboard');
    const routes = [...bar.querySelectorAll('[data-route]')].map(b => b.dataset.route);
    for (const r of ALL_ROUTES) if (!routes.includes(r)) throw Error('مسار غير متاح من الشريط العلوي: ' + r);
    expect(routes.length >= NAV_ROUTES.length).toBe(true);
  });
  test('تنقل علوي: كل تبويب يفتح لوحة منظمة بكل عناصره (aria)', () => {
    const bar = fresh();
    const tabs = [...bar.querySelectorAll('.tn-tab[data-tab]')];
    expect(tabs.length).toBe(6);
    for (const tab of tabs) {
      const id = tab.dataset.tab;
      const panel = bar.querySelector('#' + tab.getAttribute('aria-controls'));
      if (!panel) throw Error('لا توجد لوحة للتبويب: ' + id);
      expect(tab.getAttribute('aria-expanded')).toBe('false');
      expect(panel.getAttribute('role')).toBe('group');
      expect(panel.getAttribute('aria-labelledby')).toBe(tab.id);
      const g = NAV_GROUPS.find(x => x.id === id);
      const inPanel = [...panel.querySelectorAll('.tn-item[data-route]')].map(b => b.dataset.route);
      for (const it of g.items) if (!inPanel.includes(it.route)) throw Error('عنصر ناقص في لوحة ' + id + ': ' + it.route);
      for (const b of panel.querySelectorAll('.tn-item')) expect(b.textContent.trim().length > 0).toBe(true);
    }
  });
  test('تنقل علوي: التبويب النشط والعنصر النشط حسب الصفحة الحالية', () => {
    const bar = fresh();
    setActiveRoute('files');
    expect(bar.querySelector('.tn-tab[data-tab="data"]').classList.contains('active')).toBe(true);
    expect(bar.querySelector('.tn-item[data-route="files"]').classList.contains('active')).toBe(true);
    expect(bar.querySelector('.tn-item[data-route="files"]').getAttribute('aria-current')).toBe('page');
    const tabCount = [...bar.querySelectorAll('.tn-tab[data-tab].active')].length;
    expect(tabCount).toBe(1);
    setActiveRoute('reports');
    expect(bar.querySelector('.tn-tab[data-tab="insight"]').classList.contains('active')).toBe(true);
    expect(bar.querySelector('.tn-tab[data-tab="data"]').classList.contains('active')).toBe(false);
    expect(groupIdForRoute('hearings')).toBe('daily');
    expect(groupIdForRoute('unknownRoute')).toBe(null);
  });
  test('تنقل علوي: فتح/إغلاق اللوحات وحالة aria', () => {
    const bar = fresh();
    const tab = bar.querySelector('.tn-tab[data-tab="daily"]');
    openPanel('daily', tab);
    expect(bar.querySelector('#tn-panel-daily').hidden).toBe(false);
    expect(tab.getAttribute('aria-expanded')).toBe('true');
    closePanel();
    expect(bar.querySelector('#tn-panel-daily').hidden).toBe(true);
    expect(tab.getAttribute('aria-expanded')).toBe('false');
  });
  test('تنقل علوي: لوحة «كل الأقسام» للهاتف تُفتح وتُغلق', () => {
    const bar = fresh();
    toggleMobile(true);
    expect(bar.querySelector('#tn-panel-all').hidden).toBe(false);
    expect(bar.querySelector('#tn-all').getAttribute('aria-expanded')).toBe('true');
    expect(closeMobile()).toBe(true);
    expect(bar.querySelector('#tn-panel-all').hidden).toBe(true);
    expect(bar.querySelector('#tn-all').getAttribute('aria-expanded')).toBe('false');
    expect(closeMobile()).toBe(false);
  });
  test('تنقل علوي: الطي يقلّص الشريط ويوسّع المحتوى ويُحفظ', async () => {
    const bar = fresh();
    toggleCollapsed(true);
    expect(isCollapsed()).toBe(true);
    expect(document.body.classList.contains('topnav-collapsed')).toBe(true);
    expect(document.documentElement.dataset.nav).toBe('collapsed');
    expect(bar.querySelector('#tn-toggle').getAttribute('aria-pressed')).toBe('true');
    // إشارات التوافق القديمة (كانت للشريط الجانبي) تبقى صحيحة
    expect(document.documentElement.dataset.sidebar).toBe('collapsed');
    expect(String(document.documentElement.style.getPropertyValue('--sb-current')).includes('collapsed')).toBe(true);
    toggleCollapsed(false);
    expect(isCollapsed()).toBe(false);
    expect(document.documentElement.dataset.nav).toBe('open');
    expect(bar.querySelector('#tn-toggle').getAttribute('aria-pressed')).toBe('false');
    await new Promise(r => setTimeout(r, 0));
    expect(prefs.get('ui:sidebar-collapsed')).toBe(false);
  });
  test('تنقل علوي: التخصيص يُخفي التبويبات والعناصر ويُحفظ في التفضيلات', async () => {
    await prefs.set(NAV_CONFIG_KEY, {tabOrder: ['daily', 'general', 'data', 'judicial', 'insight', 'system'], hiddenTabs: ['system'], hiddenItems: ['fees'], itemOrder: {daily: ['caseNotes', 'hearings']}});
    const bar = fresh();
    expect(Boolean(bar.querySelector('.tn-tab[data-tab="system"]'))).toBe(false);
    expect(Boolean(bar.querySelector('#tn-panel-system'))).toBe(false);
    expect([...bar.querySelectorAll('[data-tab="system"]')].length).toBe(0);
    const fees = [...bar.querySelectorAll('.tn-item[data-route="fees"]')].length;
    expect(fees).toBe(0);
    expect(bar.querySelector('.tn-tab[data-tab="daily"]').dataset.tab).toBe('daily');
    const dailyItems = [...bar.querySelectorAll('#tn-panel-daily .tn-item[data-route]')].map(b => b.dataset.route);
    expect(dailyItems[0]).toBe('caseNotes');
    const tabs = [...bar.querySelectorAll('.tn-tab[data-tab]')].map(b => b.dataset.tab);
    expect(tabs[0]).toBe('daily');
    expect(tabs.includes('system')).toBe(false);
    await prefs.set(NAV_CONFIG_KEY, null);
    const restored = fresh();
    expect([...restored.querySelectorAll('.tn-tab[data-tab]')].length).toBe(6);
    expect(Boolean(restored.querySelector('[data-route="fees"]'))).toBe(true);
  });
  test('تنقل علوي: عند ضيق المساحة تنتقل التبويبات إلى «المزيد» بلا فقدان أي قسم', async () => {
    const bar = fresh();
    const strip = bar.querySelector('#tn-strip'), more = bar.querySelector('#tn-more');
    const tabs = [...strip.querySelectorAll('.tn-tab[data-tab]')];
    const fix = (el, prop, val) => Object.defineProperty(el, prop, {get: () => val, configurable: true});
    fix(strip, 'clientWidth', 320);
    fix(strip, 'scrollWidth', 320);
    fix(more, 'offsetWidth', 90);
    tabs.forEach(t => fix(t, 'offsetWidth', 130));
    window.dispatchEvent(new Event('resize'));
    // مهلة متسامحة قليلًا مع كتم الحوسبة العالية حتى لا يفشل الاختبار لسبب توقيتي.
    const deadline=Date.now()+4000;
    while(Date.now()<deadline&&(!tabs.some(t=>t.hidden)||more.hidden))await new Promise(r=>setTimeout(r,20));
    const hiddenTabs = tabs.filter(t => t.hidden).map(t => t.dataset.tab);
    expect(hiddenTabs.length > 0).toBe(true);       // لا ازدحام: ما لا يتّسع ينتقل إلى «المزيد»
    expect(more.hidden).toBe(false);                // زر «المزيد» يظهر عند الحاجة فقط
    expect(tabs.filter(t => !t.hidden).length > 0).toBe(true); // ويبقى تبويب ظاهر في الشريط
    const list = [...bar.querySelectorAll('#tn-more-list .tn-item')].map(b => b.dataset.tabOpen);
    for (const id of hiddenTabs) if (!list.includes(id)) throw Error('قسم غير متاح من «المزيد»: ' + id);
    const first = bar.querySelector(`#tn-more-list .tn-item[data-tab-open="${hiddenTabs[0]}"]`);
    first.click();
    // فتح اللوحة قد يتأخر إطارًا أو اثنين تحت الحمل: ننتظر بحد زمني بدل مهلة صفرية هشة.
    const panelDeadline = Date.now() + 1000;
    while (Date.now() < panelDeadline && bar.querySelector(`#tn-panel-${hiddenTabs[0]}`).hidden) await new Promise(r => setTimeout(r, 20));
    expect(bar.querySelector(`#tn-panel-${hiddenTabs[0]}`).hidden).toBe(false);
    closePanel();
  });
  test('تنقل علوي: نفس الواجهة القديمة ما زالت تعمل (توافق)', () => {
    // كل دوال الشريط الجانبي القديمة ما زالت متاحة من js/ui/sidebar.js
    expect(typeof buildSidebar).toBe('function');
    expect(typeof buildTopNav).toBe('function');
    expect(typeof toggleCollapsed).toBe('function');
    expect(typeof isCollapsed).toBe('function');
    expect(typeof setActiveRoute).toBe('function');
    const bar = fresh();
    buildSidebar(); // استدعاء ثانٍ لا يعيد البناء ولا يُنشئ نسخة ثانية
    expect([...bar.querySelectorAll('.tn-inner')].length).toBe(1);
    expect([...bar.querySelectorAll('.tn-tab[data-tab]')].length).toBe(6);
  });
  // إعادة القشرة إلى حالتها القياسية لبقية المجموعات
  document.body.innerHTML = '<div id="app"><nav id="sidebar" class="tn-bar"></nav><main><section id="main-content"></section></main></div><div id="modal-root"></div>';
}
