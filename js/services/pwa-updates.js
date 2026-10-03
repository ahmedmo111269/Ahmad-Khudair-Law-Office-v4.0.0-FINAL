import {onlineCapabilities} from '../core/online-capabilities.js';

/** Updates only the cached application shell. It never touches IndexedDB business data. */
export class PWAUpdateService {
  constructor({network, notify = () => {}} = {}) {
    this.network = network;
    this.notify = notify;
    this.registration = null;
    this.started = false;
    this.checking = false;
    this.notifiedUpdate = false;
    this.unsubscribe = null;
    this.onControllerChange = () => this.notify('تم تحديث ملفات البرنامج. بيانات المكتب المحلية محفوظة كما هي.', 'ok');
  }

  async start() {
    if (this.started) return this.registration;
    this.started = true;
    if (!globalThis.navigator?.serviceWorker) return null;
    this.unsubscribe = this.network?.subscribe?.(({status}) => {
      if (status === 'ONLINE') this.check().catch(error => console.info('PWA update check deferred', error));
    });
    globalThis.navigator.serviceWorker.addEventListener?.('controllerchange', this.onControllerChange);
    if (this.network?.isOnline?.()) await this.check();
    return this.registration;
  }

  async check() {
    if (!globalThis.navigator?.serviceWorker || !this.network?.isOnline?.() || this.checking) return null;
    this.checking = true;
    try {
      if (!this.registration) this.registration = await globalThis.navigator.serviceWorker.register('./sw.js');
      await onlineCapabilities.run('applicationUpdates', () => this.registration.update(), {timeoutMs: 7000, retries: 0});
      const installing = this.registration.installing;
      if (installing) installing.addEventListener?.('statechange', () => {
        if (installing.state === 'installed' && globalThis.navigator.serviceWorker.controller && !this.notifiedUpdate) {
          this.notifiedUpdate = true;
          this.notify('يوجد تحديث للتطبيق؛ سيبقى الإصدار الحالي يعمل بأمان إلى أن تكتمل ملفات التحديث.', 'info');
        }
      });
      return this.registration;
    } catch (error) {
      // Update failure is isolated: existing cached shell and IndexedDB remain available.
      if (this.network?.isOnline?.()) console.info('PWA update unavailable; current cached version remains active.', error);
      return null;
    } finally { this.checking = false; }
  }
}
