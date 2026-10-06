// =====================================================================
// التنقل بتاريخ المتصفح — زر الرجوع في Android
// ---------------------------------------------------------------------
// المشكلة قبل هذه الوحدة: شاشات البرنامج كانت تُبنى في الذاكرة وحدها
// (this.history داخل App)، فلا يوجد أي مدخل في تاريخ المتصفح. النتيجة على
// Android: زر الرجوع يخرج من التطبيق فورًا (أو يرجع لصفحة سابقة خارجية)
// ويفقد المستخدم الصفحة والنموذج الذي كان يملؤه.
//
// الحل (بلا أي راوتر جديد وبلا تغيير لبنية الشاشات):
//   • كل انتقال بين شاشات البرنامج يضيف مدخلًا في تاريخ المتصفح بحالة
//     {akl:'route',route}، ويُكتب المسار في الـhash (#/…) فيبقى التحديث
//     والرابط المباشر والعمل على GitHub Pages سليمًا (لا مسارات خادم).
//   • كل طبقة علوية (نافذة/درج/لوحة أوامر/لوحة تنقل/قائمة جدول) تضيف
//     «مدخل حماية» بنفس العنوان {akl:'overlay'}، فيُغلق زر الرجوع الطبقة
//     العليا فقط ثم يعود طبيعيًا للشاشة السابقة — بلا فقد أي مُدخل.
//   • عند غياب أي مدخل خاص بالبرنامج، يعود زر الرجوع لسلوك النظام
//     (الخروج من التطبيق) — وهو السلوك المتوقع في Android.
// المنطق الصافي هنا قابل للاختبار، والتكامل مع الشاشات في app.js.
// =====================================================================

/** مسار داخلي → جزء hash آمن (المسارات تحتوي عربية و: و? و#). */
export function hashForRoute(route) {
  const value = String(route || '').trim();
  if (!value) return '';
  return '#/' + encodeURIComponent(value);
}

/** جزء hash → مسار داخلي، أو null إن لم يكن مدخل برنامج صالحًا. */
export function routeFromHash(hash) {
  const raw = String(hash || '').replace(/^#/, '');
  if (!raw.startsWith('/')) return null;
  const encoded = raw.slice(1);
  if (!encoded) return null;
  try {
    const route = decodeURIComponent(encoded).trim();
    return route ? route : null;
  } catch {
    return null; // ترميز تالف في الرابط: نتجاهله ولا نكسر الإقلاع
  }
}

/** هل الرابط الحالي أو الحالة يحملان مسار برنامج؟ */
export function routeFromStateOrLocation(state, hash) {
  if (state && state.akl === 'route' && typeof state.route === 'string' && state.route) return state.route;
  return routeFromHash(hash);
}

const OVERLAY = 'overlay';
const ROUTE = 'route';

/**
 * متحكم تاريخ خفيف: لا يعرف شيئًا عن الشاشات، بل يستدعي واجهات مُمرَّرة إليه.
 * onNavigate(route)  — انتقل لمسار (نتيجة ضغط زر الرجوع)
 * onOverlayBack()    — أغلق الطبقة العليا، ويُعيد true إن أُغلقت طبقة
 * hasOverlay()       — هل توجد طبقة علوية مفتوحة الآن
 */
export class RouteHistory {
  constructor({windowRef = globalThis.window, onNavigate = () => {}, onOverlayBack = () => false, hasOverlay = () => false, onError = null} = {}) {
    this.win = windowRef;
    this.onNavigate = onNavigate;
    this.onOverlayBack = onOverlayBack;
    this.hasOverlay = hasOverlay;
    this.onError = onError;
    this.depth = 0; // عدد مداخل البرنامج فوق مدخل الإقلاع
    this.started = false;
    this.currentRoute = null;
    this.suspended = false;
    this.pendingUntil = 0; // رجوع برمجي قيد التنفيذ (نوعه في pendingMode)
    this.pendingMode = null; // 'silent' = تحرير مدخل حماية، 'navigate' = رجوع طلبه زر البرنامج
    this.handlePop = (event) => this.#onPop(event);
  }

  get supported() {
    return Boolean(this.win && this.win.history && typeof this.win.history.pushState === 'function' && this.win.location);
  }

  #call(fn, arg) {
    try { return fn?.(arg); } catch (error) { (this.onError || console.error)('history', error); return null; }
  }

  /** يثبّت مدخل الإقلاع على المسار الابتدائي (بلا إضافة مدخل جديد). */
  start(route) {
    if (!this.supported || this.started) return this;
    this.started = true;
    this.currentRoute = route || null;
    this.#call(() => this.win.history.replaceState({ akl: ROUTE, route: this.currentRoute || '' }, '', this.win.location.pathname + this.win.location.search + hashForRoute(this.currentRoute)));
    this.win.addEventListener?.('popstate', this.handlePop);
    return this;
  }

  /** يسجّل انتقالًا جديدًا. replace=true يستبدل المدخل الحالي (بلا تاريخ إضافي). */
  record(route, { replace = false } = {}) {
    if (!this.supported || !this.started) { this.currentRoute = route || null; return; }
    // أول إقلاع: مدخل الإقلاع نفسه يحمل المسار الابتدائي، فلا نضيف مدخلاً مكررًا
    // (وبذلك يخرج زر الرجوع من التطبيق من الشاشة الرئيسية، ويعود إليها من غيرها).
    if (!replace && this.depth === 0 && (route || null) === this.currentRoute) {
      this.#call(() => this.win.history.replaceState({ akl: ROUTE, route: route || '' }, '', this.win.location.pathname + this.win.location.search + hashForRoute(route)));
      return;
    }
    this.currentRoute = route || null;
    const url = this.win.location.pathname + this.win.location.search + hashForRoute(this.currentRoute);
    this.#call(() => {
      const state = { akl: ROUTE, route: this.currentRoute || '' };
      if (replace) this.win.history.replaceState(state, '', url);
      else this.win.history.pushState(state, '', url);
    });
    if (!replace) this.depth += 1;
  }

  /** مدخل حماية لطبقة علوية (نفس العنوان — بلا تغيير في الرابط). */
  pushGuard() {
    if (!this.supported || !this.started || this.suspended) return false;
    this.#call(() => this.win.history.pushState({ akl: OVERLAY }, '', this.win.location.href));
    this.depth += 1;
    return true;
  }

  /** تحرير مدخل الحماية بعد إغلاق الطبقة من الواجهة (رجوع برمجي واحد). */
  releaseGuard() {
    if (!this.supported || !this.started || this.depth <= 0 || this.suspended) return false;
    try {
      if (this.win.history.state?.akl !== OVERLAY) return false;
    } catch { return false; }
    this.depth = Math.max(0, this.depth - 1);
    this.pendingUntil = Date.now() + 1500;
    this.pendingMode = 'silent';
    this.#call(() => this.win.history.back());
    return true;
  }

  canGoBack() { return this.supported && this.depth > 0; }

  back() {
    if (!this.canGoBack()) return false;
    this.depth = Math.max(0, this.depth - 1);
    this.pendingUntil = Date.now() + 1500;
    this.pendingMode = 'navigate';
    this.#call(() => this.win.history.back());
    return true;
  }

  #onPop(event) {
    if (this.suspended) return;
    const state = event?.state ?? this.#safeState();
    const route = routeFromStateOrLocation(state, this.win.location?.hash);
    // رجوع برمجي: 'silent' = تحرير مدخل حماية من الواجهة (بلا تنقّل وبلا إغلاق طبقة)،
    // و'navigate' = رجوع طلبه زر «رجوع» داخل البرنامج (تنقّل عادي بلا خصم مزدوج للعمق).
    const programmatic = Date.now() <= this.pendingUntil;
    const mode = programmatic ? this.pendingMode : null;
    if (programmatic) { this.pendingUntil = 0; this.pendingMode = null; }
    if (!programmatic && this.depth > 0) this.depth -= 1;
    if (mode === 'silent') return;
    // مستخدم يُعيد التقدّم إلى مدخل حماية: لا معنى لإعادة فتح الطبقات.
    if (state && state.akl === OVERLAY) { this.depth += 1; return; }
    if (this.hasOverlay()) {
      const closed = this.#call(() => this.onOverlayBack());
      // بقي شيء مفتوحًا (طبقات مكدسة): أعِد تسليح المدخل حتى يُغلق الرجوع التالي الطبقة التي تليه.
      if (closed !== false && this.hasOverlay()) { this.pushGuard(); return; }
      if (closed === false) this.pushGuard();
      return;
    }
    if (!route || route === this.currentRoute) return;
    this.currentRoute = route;
    this.#call(() => this.onNavigate(route));
  }

  #safeState() {
    try { return this.win.history.state; } catch { return null; }
  }

  /** تعليق مؤقت (يُستخدم داخل الاختبارات أو عند تفكيك التطبيق). */
  setSuspended(value) { this.suspended = Boolean(value); }

  dispose() {
    if (!this.started) return;
    this.win.removeEventListener?.('popstate', this.handlePop);
    this.started = false;
    this.depth = 0;
  }
}
