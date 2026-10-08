// =====================================================================
// نموذج التنقل الموحّد — بيانات ومنطق خالص (قابل للاختبار بلا DOM)
// ---------------------------------------------------------------------
// • المصدر الوحيد لعناصر التنقل هو NAV_GROUPS: 6 مجموعات / 29 مسارًا (مركز التنفيذ والمزامنة).
//   المسارات (routes) وأسماء العناصر لم تتغيّر إطلاقًا — أُعيد تنظيم
//   المجموعات نفسها فقط لتُعرض كتبويبات أفقية أعلى البرنامج.
// • التخصيص الكامل (إظهار/إخفاء/ترتيب التبويبات وعناصرها) يُحفظ في
//   تفضيلات المستخدم (ui:topnav-config) ويُطبَّع هنا قبل الاستخدام.
// • الدوال هنا خالصة بلا DOM حتى تُختبر مباشرة في Node والمتصفح.
// =====================================================================

export const NAV_CONFIG_KEY = 'ui:topnav-config';

// label = الاسم الكامل (كما كان في الشريط الجانبي) | tab = الاسم المختصر على التبويب
export const NAV_GROUPS = [
  {id: 'general', label: 'عام', tab: 'عام', icon: 'home', items: [
    {route: 'dashboard', label: 'الرئيسية', icon: 'home'},
    {route: 'actionCenter', label: 'مركز العمل', icon: 'target'}]},
  {id: 'data', label: 'البيانات الأساسية', tab: 'البيانات', icon: 'folder', items: [
    {route: 'files', label: 'الملفات', icon: 'folder'},
    {route: 'clients', label: 'الموكلون', icon: 'users'},
    {route: 'opponents', label: 'الخصوم', icon: 'userX'},
    {route: 'cases', label: 'القضايا والمراحل', icon: 'gavel'},
    {route: 'powersOfAttorney', label: 'التوكيلات', icon: 'stamp'}]},
  {id: 'daily', label: 'العمل اليومي', tab: 'العمل اليومي', icon: 'calendar', items: [
    {route: 'hearings', label: 'الجلسات', icon: 'calendar'},
    {route: 'procedures', label: 'الأعمال الإدارية', icon: 'clipboard'},
    {route: 'serviceRecords', label: 'الإعلانات والمحضرون', icon: 'send'},
    {route: 'bailiffs', label: 'دليل المحضرين', icon: 'userCheck'},
    {route: 'appointments', label: 'المواعيد', icon: 'clock'},
    {route: 'communications', label: 'الاتصالات', icon: 'phone'},
    {route: 'caseNotes', label: 'الملاحظات السريعة', icon: 'note'},
    {route: 'reminders', label: 'التذكيرات', icon: 'bell'}]},
  {id: 'judicial', label: 'القضائي والمالي', tab: 'القضائي والمالي', icon: 'landmark', items: [
    {route: 'judgments', label: 'الأحكام', icon: 'landmark'},
    {route: 'expertReports', label: 'تقارير الخبراء', icon: 'microscope'},
    {route: 'executionCenter', label: 'مركز التنفيذ', icon: 'hammer'},
    {route: 'execution', label: 'التنفيذ (السجل العام)', icon: 'scale'},
    {route: 'fees', label: 'الأتعاب والمدفوعات', icon: 'wallet'},
    {route: 'documentReferences', label: 'المستندات', icon: 'file'}]},
  {id: 'insight', label: 'التحليل والتقارير', tab: 'التحليل والتقارير', icon: 'chart', items: [
    {route: 'search', label: 'البحث الشامل', icon: 'search'},
    {route: 'reports', label: 'التقارير', icon: 'report'},
    {route: 'analytics', label: 'الإحصاءات', icon: 'chart'}]},
  {id: 'system', label: 'النظام', tab: 'النظام', icon: 'settings', items: [
    {route: 'integrity', label: 'سلامة البيانات', icon: 'shield'},
    {route: 'repair', label: 'الإصلاح والاسترداد', icon: 'wrench'},
    {route: 'databases', label: 'قواعد البيانات', icon: 'database'},
    {route: 'backup', label: 'النسخ الاحتياطي', icon: 'save'},
    {route: 'sync', label: 'المزامنة', icon: 'refreshCw'},
    {route: 'settings', label: 'الإعدادات', icon: 'settings'}]}
];

export const NAV_GROUP_IDS = NAV_GROUPS.map(g => g.id);
export const NAV_ROUTES = NAV_GROUPS.flatMap(g => g.items.map(i => i.route));

/** التكوين الافتراضي: كل التبويبات وكل العناصر ظاهرة بترتيبها الأصلي. */
export function defaultNavConfig() {
  return {v: 1, tabOrder: NAV_GROUP_IDS.slice(), hiddenTabs: [], itemOrder: {}, hiddenItems: []};
}

const uniq = list => {
  const out = [];
  for (const x of list || []) if (!out.includes(x)) out.push(x);
  return out;
};

/**
 * تطبيع تكوين محفوظ: يتجاهل أي قسم/مسار غير معروف، ويُكمل الناقص من الافتراضي
 * (أي قسم أو عنصر جديد يُضاف مستقبلًا يظهر تلقائيًا)، ويمنع إخفاء كل التبويبات
 * أو إخفاء كل عناصر قسم واحد حتى لا يبقى قسم فارغ.
 */
export function normalizeNavConfig(raw) {
  if (!raw || typeof raw !== 'object') return defaultNavConfig();
  const order = uniq(Array.isArray(raw.tabOrder) ? raw.tabOrder.filter(id => NAV_GROUP_IDS.includes(id)) : []);
  for (const id of NAV_GROUP_IDS) if (!order.includes(id)) order.push(id);
  let hiddenTabs = uniq(Array.isArray(raw.hiddenTabs) ? raw.hiddenTabs.filter(id => NAV_GROUP_IDS.includes(id)) : []);
  if (hiddenTabs.length >= order.length) hiddenTabs = []; // لا يمكن إخفاء كل التبويبات
  let hiddenItems = uniq(Array.isArray(raw.hiddenItems) ? raw.hiddenItems.filter(r => NAV_ROUTES.includes(r)) : []);
  const itemOrder = {};
  for (const g of NAV_GROUPS) {
    const src = Array.isArray(raw.itemOrder?.[g.id]) ? raw.itemOrder[g.id].filter(r => g.items.some(i => i.route === r)) : [];
    const list = uniq(src);
    for (const it of g.items) if (!list.includes(it.route)) list.push(it.route);
    itemOrder[g.id] = list;
  }
  // منع إخفاء كل عناصر قسم واحد (يبقى القسم قابلاً للوصول دائمًا)
  hiddenItems = hiddenItems.filter(route => {
    const g = NAV_GROUPS.find(x => x.items.some(i => i.route === route));
    if (!g) return false;
    return g.items.some(i => i.route !== route && !hiddenItems.includes(i.route));
  });
  return {v: 1, tabOrder: order, hiddenTabs, itemOrder, hiddenItems};
}

/** المجموعات الظاهرة بترتيب المستخدم (بلا المجموعات المخفية أو الفارغة). */
export function orderedGroups(cfg) {
  const c = cfg || defaultNavConfig();
  const out = [];
  for (const id of c.tabOrder) {
    if (c.hiddenTabs.includes(id)) continue;
    const g = NAV_GROUPS.find(x => x.id === id);
    if (!g) continue;
    const items = groupItems(g, c);
    if (!items.length) continue;
    out.push({...g, items});
  }
  return out;
}

/** كل تبويبات المستخدم بترتيبها (بما فيها المخفي) — تستخدمها شاشة التخصيص. */
export function orderedTabIds(cfg) {
  const c = cfg || defaultNavConfig();
  const out = [];
  for (const id of c.tabOrder) if (NAV_GROUP_IDS.includes(id) && !out.includes(id)) out.push(id);
  for (const id of NAV_GROUP_IDS) if (!out.includes(id)) out.push(id);
  return out;
}

/** مسارات عناصر مجموعة واحدة بترتيب المستخدم (بما فيها المخفي). */
export function itemRoutesInOrder(group, cfg) {
  if (!group) return [];
  const c = cfg || defaultNavConfig();
  const order = uniq(c.itemOrder?.[group.id] || group.items.map(i => i.route));
  for (const it of group.items) if (!order.includes(it.route)) order.push(it.route);
  return order.filter(r => group.items.some(i => i.route === r));
}

/** عناصر مجموعة واحدة بترتيب المستخدم وبلا المخفي. */
export function groupItems(group, cfg) {
  if (!group) return [];
  const c = cfg || defaultNavConfig();
  return itemRoutesInOrder(group, c).filter(r => !c.hiddenItems.includes(r))
    .map(r => group.items.find(i => i.route === r)).filter(Boolean);
}

/** التبويب (المجموعة) الذي ينتمي إليه مسار معيّن — لتحديد التبويب النشط. */
export function groupIdForRoute(route) {
  const g = NAV_GROUPS.find(x => x.items.some(i => i.route === route));
  return g ? g.id : null;
}

export function groupById(id) {
  return NAV_GROUPS.find(g => g.id === id) || null;
}

/** نقل عنصر داخل قائمة بترتيب جديد (يُستخدم في شاشة التخصيص). */
export function moveInList(list, index, delta) {
  const arr = (list || []).slice();
  const to = index + delta;
  if (index < 0 || index >= arr.length || to < 0 || to >= arr.length) return arr;
  const [item] = arr.splice(index, 1);
  arr.splice(to, 0, item);
  return arr;
}

/**
 * خطة توزيع التبويبات بين الشريط و«المزيد» بحسب المساحة المتاحة (منطق خالص).
 * widths: عرض كل تبويب، gap: المسافة بينها، available: عرض الشريط،
 * moreWidth: عرض زر «المزيد» عند الحاجة إليه.
 * يعيد: {keep: فهارس تبقى في الشريط، overflow: فهارس تُنقل إلى «المزيد»، more: هل يظهر الزر}
 */
export function planOverflow({widths = [], gap = 6, available = 0, moreWidth = 0} = {}) {
  const all = widths.map((_, i) => i);
  const used = widths.reduce((a, w) => a + Math.max(0, w) + gap, 0);
  if (!widths.length || available <= 0 || used <= available + 1) return {keep: all, overflow: [], more: false};
  const budget = available - (moreWidth + gap);
  const keep = [], overflow = [];
  let acc = 0;
  widths.forEach((w, i) => {
    if (acc + Math.max(0, w) + gap <= budget + 1) {
      keep.push(i);
      acc += Math.max(0, w) + gap;
    } else overflow.push(i);
  });
  if (!keep.length) { // يبقى تبويب واحد على الأقل في الشريط
    keep.push(0);
    overflow.shift();
  }
  return {keep, overflow, more: overflow.length > 0};
}

/** صياغة عربية سليمة لعدد العناصر (يُستخدم في رؤوس اللوحات). */
export function countLabel(n) {
  if (!n) return 'لا عناصر';
  if (n === 1) return 'عنصر واحد';
  if (n === 2) return 'عنصران';
  if (n <= 10) return `${n} عناصر`;
  return `${n} عنصرًا`;
}

export function sectionsLabel(n) {
  if (!n) return 'لا أقسام';
  if (n === 1) return 'قسم واحد';
  if (n === 2) return 'قسمان';
  if (n <= 10) return `${n} أقسام`;
  return `${n} قسمًا`;
}
