// تحديث قشرة التطبيق وحدها. لا يمس هذا الملف IndexedDB ولا أي بيانات مكتب إطلاقًا.
//
// سلوك النسخة السابقة كان: تنزيل التحديث ثم الاستيلاء الفوري على الصفحة
// (skipWaiting + clients.claim داخل Service Worker) — أي تبديل كود التطبيق تحت
// يدي المستخدم أثناء العمل. الآن:
//   • يُنزَّل التحديث ويبقى في الانتظار (waiting) — النسخة العاملة لا تتغير.
//   • يظهر للمستخدم إشعار واحد واضح فيه زر «تحديث الآن».
//   • عند القبول فقط يُرسل SKIP_WAITING ثم يُعاد تحميل الصفحة (بلا فقد بيانات؛
//     لأن كل بيانات المكتب في IndexedDB وتفضيلات المستخدم محفوظة أيضًا).
//   • وبعد إعادة التحميل تُعرض رسالة تأكيد أن البيانات المحلية كما هي.
import {onlineCapabilities} from '../core/online-capabilities.js';

const ACCEPTED_KEY='akl:pwa:update-applied';

export class PWAUpdateService {
  constructor({network, notify = () => {}, toast = null, apply = null} = {}) {
    this.network = network;
    this.notify = notify;
    this.toast = toast;      // (message, type, options) — يُفضّل toast الأزرار التفاعلية
    this.apply = apply;      // إعادة التحميل: تُمرَّر من app.js حتى لا تُكرَّر السياسة
    this.registration = null;
    this.started = false;
    this.checking = false;
    this.notifiedUpdate = false;
    this.updateReady = false;
    this.unsubscribe = null;
    this.onControllerChange = () => {
      if (!this.updateReady) return;
      try { sessionStorage.setItem(ACCEPTED_KEY, String(Date.now())); } catch { /* التخزين غير متاح */ }
      this.updateReady = false;
      this.notify('تم تحديث ملفات البرنامج. بيانات المكتب المحلية محفوظة كما هي.', 'ok');
    };
  }

  async start() {
    if (this.started) return this.registration;
    this.started = true;
    if (!globalThis.navigator?.serviceWorker) return null;
    this.reportAppliedUpdate();
    this.unsubscribe = this.network?.subscribe?.(({status}) => {
      if (status === 'ONLINE') this.check().catch(error => console.info('PWA update check deferred', error));
    });
    globalThis.navigator.serviceWorker.addEventListener?.('controllerchange', this.onControllerChange);
    if (this.network?.isOnline?.()) await this.check();
    return this.registration;
  }

  /** رسالة لمرة واحدة بعد تحديث ناجح — تذكّر المستخدم أن بياناته لم تُمس. */
  reportAppliedUpdate() {
    try {
      const stamp = Number(sessionStorage.getItem(ACCEPTED_KEY) || 0);
      if (!stamp) return;
      sessionStorage.removeItem(ACCEPTED_KEY);
      this.notify('اكتمل تحديث البرنامج. قاعدة بيانات المكتب وتفضيلاتك كما كانت.','ok');
    } catch { /* التخزين غير متاح */ }
  }

  async check() {
    if (!globalThis.navigator?.serviceWorker || !this.network?.isOnline?.() || this.checking) return null;
    this.checking = true;
    try {
      if (!this.registration) this.registration = await globalThis.navigator.serviceWorker.register('./sw.js');
      const installing = this.registration.installing;
      if (installing) this.watchWorker(installing);
      await onlineCapabilities.run('applicationUpdates', () => this.registration.update(), {timeoutMs: 7000, retries: 0});
      if (this.registration.waiting) this.announceUpdate();
      return this.registration;
    } catch (error) {
      // فشل التحديث معزول: القشرة المخزَّنة وبيانات IndexedDB تبقى متاحة.
      if (this.network?.isOnline?.()) console.info('PWA update unavailable; current cached version remains active.', error);
      return null;
    } finally { this.checking = false; }
  }

  watchWorker(worker) {
    worker.addEventListener?.('statechange', () => {
      if (worker.state !== 'installed') return;
      if (!globalThis.navigator.serviceWorker.controller) { this.updateReady = false; return; } // أول تثبيت: لا تحديث
      this.announceUpdate();
    });
  }

  /** إشعار واحد فقط لكل نسخة جديدة — بإجراء واضح، وبلا تكرار يزعج المستخدم. */
  announceUpdate() {
    if (this.notifiedUpdate) return false;
    this.notifiedUpdate = true;
    this.updateReady = true;
    const message = 'يتوفر إصدار أحدث من البرنامج. بيانات مكتبك محفوظة ولن تتأثر بالتحديث.';
    if (typeof this.toast === 'function') {
      this.toast(message, 'info', {duration: 0, action: () => this.accept(), actionLabel: 'تحديث الآن'});
      return true;
    }
    this.notify(message, 'info');
    return true;
  }

  /** قبول المستخدم: يُمرَّر الانتظار ثم تُعاد الصفحة — بلا لمس أي بيانات محلية. */
  accept() {
    const waiting = this.registration?.waiting;
    if (!waiting) return false;
    this.updateReady = true;
    try { waiting.postMessage({type: 'SKIP_WAITING'}); } catch (error) { console.info('SKIP_WAITING unavailable', error); }
    const reload = typeof this.apply === 'function' ? this.apply : () => globalThis.location?.reload?.();
    // فرصة قصيرة لاستيلاء Service Worker، ثم إعادة تحميل واحدة على أي حال.
    try { setTimeout(reload, 350); } catch { reload(); }
    return true;
  }
}
