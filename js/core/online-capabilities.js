import {AppError, ERR} from './errors.js';
import {networkStatus} from './network-status.js';

export const ONLINE_CAPABILITIES = Object.freeze({
  googleDrive: Object.freeze({onlineRequired: true, label: 'Google Drive'}),
  cloudSync: Object.freeze({onlineRequired: true, label: 'المزامنة السحابية'}),
  externalApi: Object.freeze({onlineRequired: true, label: 'خدمة خارجية'}),
  applicationUpdates: Object.freeze({onlineRequired: true, label: 'تحديثات البرنامج'}),
  fileExchangeSync: Object.freeze({onlineRequired: false, label: 'تبادل حزم المزامنة'}),
  localBackup: Object.freeze({onlineRequired: false, label: 'النسخ الاحتياطي المحلي'}),
  localSearch: Object.freeze({onlineRequired: false, label: 'البحث المحلي'}),
  localReports: Object.freeze({onlineRequired: false, label: 'التقارير المحلية'}),
  localPrinting: Object.freeze({onlineRequired: false, label: 'الطباعة المحلية'})
});

const pause = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(signal.reason || new DOMException('تم إلغاء العملية.', 'AbortError'));
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener?.('abort', () => {
    clearTimeout(timer);
    reject(signal.reason || new DOMException('تم إلغاء العملية.', 'AbortError'));
  }, {once: true});
});

/** Registry for optional Internet features; local capabilities remain available in either network state. */
export class OnlineCapabilityRegistry {
  constructor({network = networkStatus, capabilities = ONLINE_CAPABILITIES} = {}) {
    this.network = network;
    this.capabilities = capabilities;
  }

  describe(name) { return this.capabilities[name] || null; }

  canUse(name) {
    const capability = this.describe(name);
    if (!capability) return false;
    return !capability.onlineRequired || this.network.isOnline();
  }

  assertAvailable(name) {
    const capability = this.describe(name);
    if (!capability) throw new AppError(ERR.VALIDATION, `الخدمة «${name}» غير مسجلة.`);
    if (capability.onlineRequired && !this.network.isOnline()) {
      throw new AppError(ERR.OFFLINE, `🌐 ${capability.label} تحتاج إلى اتصال بالإنترنت. يمكنك إعادة المحاولة عند عودة الاتصال.`);
    }
    return capability;
  }

  /** Bounded timeout and retry for optional remote work only. Local app work must not call this. */
  async run(name, operation, {timeoutMs = 15000, retries = 1, baseDelayMs = 350, signal = null} = {}) {
    const capability = this.assertAvailable(name);
    if (typeof operation !== 'function') throw new TypeError('Capability operation must be a function.');
    if (!capability.onlineRequired) return operation({signal, attempt: 1});
    const maxAttempts = Math.max(1, Math.min(3, Math.floor(retries) + 1));
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      this.assertAvailable(name);
      if (signal?.aborted) throw signal.reason || new DOMException('تم إلغاء العملية.', 'AbortError');
      const controller = new AbortController();
      const abortFromCaller = () => controller.abort(signal.reason || new DOMException('تم إلغاء العملية.', 'AbortError'));
      signal?.addEventListener?.('abort', abortFromCaller, {once: true});
      let timeout;
      try {
        const timeoutError = new Error(`انتهت مهلة ${capability.label}.`);
        const timed = new Promise((_, reject) => {
          timeout = setTimeout(() => {
            controller.abort(timeoutError);
            reject(timeoutError);
          }, Math.max(1, timeoutMs));
        });
        return await Promise.race([Promise.resolve().then(() => operation({signal: controller.signal, attempt})), timed]);
      } catch (error) {
        lastError = error;
        if (signal?.aborted) throw signal.reason || error;
        if (attempt >= maxAttempts || error?.name === 'AbortError' && !error?.message?.includes('انتهت مهلة')) throw error;
        const delay = Math.max(0, Math.min(5000, baseDelayMs * (2 ** (attempt - 1))));
        await pause(delay, signal);
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener?.('abort', abortFromCaller);
      }
    }
    throw lastError || new Error(`تعذر تنفيذ ${capability.label}.`);
  }
}

export const onlineCapabilities = new OnlineCapabilityRegistry();
