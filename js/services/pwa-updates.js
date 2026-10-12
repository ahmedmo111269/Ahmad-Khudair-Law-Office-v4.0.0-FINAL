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
    this.applyStarted = false;
    this.watchedWorkers = new WeakSet();
    this.unsubscribe = null;
    this.onControllerChange = () => {
      if (!this.updateReady) return;
      try { sessionStorage.setItem(ACCEPTED_KEY, String(Date.now())); } catch { /* التخزين غير متاح */ }
      this.notify('تم تحديث ملفات البرنامج. بيانات المكتب المحلية محفوظة كما هي.', 'ok');
      this.applyUpdatedDocument();
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

  async check({announce = true} = {}) {
    if (!globalThis.navigator?.serviceWorker || !this.network?.isOnline?.() || this.checking) return null;
    this.checking = true;
    try {
      if (!this.registration) this.registration = await globalThis.navigator.serviceWorker.register('./sw.js', {updateViaCache: 'none'});
      const installing = this.registration.installing;
      if (installing) this.watchWorker(installing);
      let updateTimer;
      try{
        await Promise.race([
          Promise.resolve().then(()=>this.registration.update()),
          new Promise((_,reject)=>{updateTimer=setTimeout(()=>reject(new Error('انتهت مهلة فحص تحديث التطبيق.')),7000)})
        ]);
      }finally{clearTimeout(updateTimer)}
      if (announce && this.registration.waiting) this.announceUpdate();
      return this.registration;
    } catch (error) {
      // فشل التحديث معزول: القشرة المخزَّنة وبيانات IndexedDB تبقى متاحة.
      if (this.network?.isOnline?.()) console.info('PWA update unavailable; current cached version remains active.', error);
      return null;
    } finally { this.checking = false; }
  }

  /** نتيجة صريحة لزر المستخدم: available | current | offline | unsupported | unavailable. */
  async checkNow({waitMs = 18000} = {}) {
    if (!globalThis.navigator?.serviceWorker) return {status: 'unsupported'};
    if (!this.network?.isOnline?.()) return {status: 'offline'};
    const deadline=Date.now()+Math.max(1000,waitMs);
    while(this.checking&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50));
    if(this.checking)return {status:'unavailable'};
    const registration = await this.check({announce:false});
    if (!registration) return {status: 'unavailable'};
    if (registration.waiting) {this.announceUpdate(true);return {status: 'available'}}
    const worker = registration.installing;
    if (worker) {
      const installed = await new Promise(resolve => {
        let finished = false;
        const finish = value => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          worker.removeEventListener?.('statechange', onState);
          resolve(value);
        };
        const onState = () => {
          if (worker.state === 'installed') finish(true);
          else if (worker.state === 'redundant') finish(false);
        };
        const timer = setTimeout(() => finish(false), Math.max(1000, waitMs));
        worker.addEventListener?.('statechange', onState);
        onState();
      });
      if (installed && this.registration.waiting) {this.announceUpdate(true);return {status: 'available'}}
      if(worker.state==='installing')return {status:'unavailable'};
    }
    return {status: 'current'};
  }

  watchWorker(worker) {
    if(!worker||this.watchedWorkers.has(worker))return;
    this.watchedWorkers.add(worker);
    worker.addEventListener?.('statechange', () => {
      if (worker.state !== 'installed') return;
      if (!globalThis.navigator.serviceWorker.controller) { this.updateReady = false; return; } // أول تثبيت: لا تحديث
      this.announceUpdate();
    });
  }

  /** إشعار واحد فقط لكل نسخة جديدة — بإجراء واضح، وبلا تكرار يزعج المستخدم. */
  announceUpdate(force = false) {
    if (this.notifiedUpdate && !force) return false;
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

  /** قبول المستخدم: لا يعاد تحميل المستند إلا بعد أن يصبح العامل الجديد هو المتحكم. */
  accept() {
    const waiting = this.registration?.waiting;
    if (!waiting || this.applyStarted) return false;
    this.updateReady = true;
    try { waiting.postMessage({type: 'SKIP_WAITING'}); } catch (error) { console.info('SKIP_WAITING unavailable', error); }
    // احتياط بلا إعادة تحميل مبكرة: لا نفتح المستند الجديد إلا بعد تأكد تفعيل العامل.
    this.applyTimer = setTimeout(() => {
      if (this.registration?.active === waiting || waiting.state === 'activated') {
        try { sessionStorage.setItem(ACCEPTED_KEY, String(Date.now())); } catch { /* التخزين غير متاح */ }
        this.applyUpdatedDocument();
      } else {
        this.notify('ما زال تحديث ملفات التطبيق قيد التفعيل. لم تُعد الصفحة؛ انتظر لحظات أو افتح التطبيق لاحقًا.', 'warn');
      }
    }, 10000);
    return true;
  }

  applyUpdatedDocument() {
    if (this.applyStarted) return false;
    this.applyStarted = true;
    this.updateReady = false;
    clearTimeout(this.applyTimer);
    const apply = typeof this.apply === 'function' ? this.apply : null;
    if (!apply) {
      this.applyStarted = false;
      this.notify('تم تفعيل ملفات التحديث. أغلق التطبيق وافتحه مجددًا لإكمال التحديث.', 'info');
      return false;
    }
    try { apply(); return true; }
    catch (error) {
      this.applyStarted = false;
      console.error('Unable to open the updated application shell.', error);
      this.notify('تم تنزيل التحديث، لكن تعذر فتح النسخة الجديدة تلقائيًا. أغلق التطبيق وافتحه مجددًا.', 'warn');
      return false;
    }
  }
}
