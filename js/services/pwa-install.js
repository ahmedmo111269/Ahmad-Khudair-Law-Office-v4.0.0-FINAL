// =====================================================================
// تثبيت التطبيق على Android — بلا إزعاج
// ---------------------------------------------------------------------
// 1) يُلتقط beforeinstallprompt (Chrome/Android) ولا يُعرض تلقائيًا.
// 2) يُعرض زر «📲 تثبيت التطبيق» في الإعدادات فقط، وبلطف داخل الشاشة
//    الرئيسية عند توفر شرطين: أن يكون الجهاز قابلًا للتثبيت، وأن يكون
//    المستخدم قد استخدم البرنامج فعلًا (‏3 زيارات على الأقل) — مرة واحدة أو
//    مرتين على الأكثر، مع «لاحقًا» تُسكِته.
// 3) لا يُخزَّن أي شيء عن المستخدم ولا يُرسل لأي جهة: الحالة في localStorage فقط.
// =====================================================================
const SEEN_KEY = 'akl:prefs:install-seen';
const DISMISS_KEY = 'akl:prefs:install-dismissed';
const PROMPT_DISMISS_KEY = 'akl:prefs:install-prompt-dismissed';
const VISITS_KEY = 'akl:prefs:install-visits';

const read = (key, fallback = null) => { try { const raw = localStorage.getItem(key); return raw === null ? fallback : JSON.parse(raw); } catch { return fallback; } };
const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* التخزين غير متاح */ } };

export class PWAInstallService {
  constructor({isStandalone = null, toast = null} = {}) {
    this.deferred = null;
    this.installed = false;
    this.listeners = new Set();
    this.toast = toast;
    this.isStandalone = isStandalone || (() => {
      try { return globalThis.matchMedia?.('(display-mode: standalone)')?.matches === true || globalThis.navigator?.standalone === true; }
      catch { return false; }
    });
    this.onBeforeInstall = (event) => {
      event.preventDefault?.();
      this.deferred = event;
      this.#emit();
    };
    this.onInstalled = () => {
      this.installed = true;
      this.deferred = null;
      write(SEEN_KEY, Date.now());
      this.toast?.('تم تثبيت التطبيق على الجهاز. سيعمل مثل أي تطبيق آخر، وبدون إنترنت.', 'ok', {duration: 7000});
      this.#emit();
    };
  }

  start() {
    if (this.started) return this;
    this.started = true;
    globalThis.addEventListener?.('beforeinstallprompt', this.onBeforeInstall);
    globalThis.addEventListener?.('appinstalled', this.onInstalled);
    this.#emit();
    return this;
  }

  #emit() {
    const state = this.state();
    for (const listener of [...this.listeners]) {
      try { listener(state); } catch (error) { console.error('install listener', error); }
    }
  }

  subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('Install listener must be a function.');
    this.listeners.add(listener);
    listener(this.state());
    return () => this.listeners.delete(listener);
  }

  isInstalled() {
    return this.installed || this.isStandalone();
  }

  /** هل يمكن عرض زر التثبيت الآن؟ (العرض نفسه قرار الواجهة) */
  canInstall() {
    return !this.isInstalled() && Boolean(this.deferred);
  }

  /** لقطة حالة للعرض في الإعدادات. */
  state() {
    return {
      installed: this.isInstalled(),
      canPrompt: this.canInstall(),
      visits: Number(read(VISITS_KEY, 0)) || 0,
      dismissed: Boolean(read(DISMISS_KEY, false))
    };
  }

  /** تسجيل زيارة واحدة؛ بعد عدد كافٍ تصبح الاستضافة الناعمة مسموحة. */
  recordVisit() {
    const visits = (Number(read(VISITS_KEY, 0)) || 0) + 1;
    write(VISITS_KEY, visits);
    return visits;
  }

  /**
   * مكان تلميح التثبيت الناعم: الشاشة الرئيسية، بعد استخدام فعلي، مرة واحدة،
   * وإلا يُسكَت نهائيًا حسب رغبة المستخدم.
   */
  shouldHint() {
    if (!this.canInstall()) return false;
    if (read(DISMISS_KEY, false)) return false;
    if (read(SEEN_KEY, null)) return false;
    return (Number(read(VISITS_KEY, 0)) || 0) >= 3;
  }

  markHintShown() { write(SEEN_KEY, Date.now()); }

  dismissHint() {
    write(DISMISS_KEY, true);
    this.markHintShown();
    this.#emit();
  }

  /** تشغيل نافذة التثبيت الرسمية في Android (تعمل مرة واحدة لكل التقاط). */
  async prompt() {
    if (!this.canInstall()) return {outcome: 'unavailable'};
    const event = this.deferred;
    this.deferred = null;
    try {
      event.prompt?.();
      const choice = await event.userChoice;
      write(PROMPT_DISMISS_KEY, true);
      this.markHintShown();
      if (choice?.outcome === 'accepted') this.onInstalled();
      this.#emit();
      return {outcome: choice?.outcome || 'dismissed'};
    } catch (error) {
      console.info('install prompt unavailable', error);
      return {outcome: 'error', error};
    }
  }

  /** تعليمات بديلة عندما لا تتوفر نافذة التثبيت (متصفح آخر أو نسخة قديمة). */
  manualSteps() {
    return [
      'افتح قائمة المتصفح (⋮) أعلى يسار Chrome.',
      'اختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية».',
      'ثم افتحه من أيقونته: يعمل بلا شريط عنوان وبلا إنترنت.'
    ];
  }
}
