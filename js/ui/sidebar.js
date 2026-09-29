// =====================================================================
// جسر توافق: التنقل انتقل من الجانب إلى أعلى البرنامج
// ---------------------------------------------------------------------
// القائمة الجانبية لم تُحذف، بل صارت شريطًا أفقيًا علويًا بنفس العناصر
// ونفس المسارات تمامًا. يبقى هذا الملف بنفس الأسماء والواجهة القديمة حتى
// لا تتغيّر أي وحدة تستوردها (app.js، الإعدادات، الاختبارات)، بينما
// التنفيذ الفعلي في:
//   • js/ui/topnav.js       — الشريط العلوي (تبويبات + لوحات + طي + تخصيص)
//   • js/ui/nav-model.js    — NAV_GROUPS والتخصيص (إظهار/إخفاء/ترتيب)
//   • js/ui/nav-customize.js— شاشة التحكم الكامل بالتبويبات
//   • css/topnav.css        — التنسيق (من توكنز themes.css نفسها)
// =====================================================================
export {
  NAV_GROUPS, NAV_CONFIG_KEY, COLLAPSE_KEY, GROUPS_KEY, MOBILE_BP, COMPACT_BP,
  buildTopNav, buildSidebar, initSidebarState, toggleCollapsed, isCollapsed,
  toggleMobile, closeMobile, isDesktop, setActiveRoute, openNavCustomizer,
  openPanel, closePanel
} from './topnav.js';
