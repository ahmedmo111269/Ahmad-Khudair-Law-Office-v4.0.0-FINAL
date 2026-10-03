const ONLINE = 'ONLINE';
const OFFLINE = 'OFFLINE';

/** Central browser/network awareness. It is informational only and never gates local database access. */
export class NetworkStatusService {
  constructor({windowRef = globalThis.window, navigatorRef = () => globalThis.navigator} = {}) {
    this.windowRef = windowRef;
    this.navigatorRef = navigatorRef;
    this.status = this.readInitialStatus();
    this.listeners = new Set();
    this.started = false;
    this.handleOnline = () => this.setStatus(ONLINE, 'browser-event');
    this.handleOffline = () => this.setStatus(OFFLINE, 'browser-event');
  }

  readInitialStatus() {
    try { return this.navigatorRef?.()?.onLine === false ? OFFLINE : ONLINE; }
    catch { return ONLINE; }
  }

  start() {
    if (this.started) return this;
    this.started = true;
    this.windowRef?.addEventListener?.('online', this.handleOnline);
    this.windowRef?.addEventListener?.('offline', this.handleOffline);
    this.setStatus(this.readInitialStatus(), 'initial', {force: true});
    return this;
  }

  getState() { return this.status; }
  isOnline() { return this.status === ONLINE; }
  isOffline() { return this.status === OFFLINE; }

  subscribe(listener, {immediate = false} = {}) {
    if (typeof listener !== 'function') throw new TypeError('Network status listener must be a function.');
    this.listeners.add(listener);
    if (immediate) listener({status: this.status, previous: this.status, source: 'subscribe'});
    return () => this.listeners.delete(listener);
  }

  /** Called only by the browser event listeners or an explicitly network-aware host adapter. */
  setStatus(status, source = 'adapter', {force = false} = {}) {
    const next = status === true || status === ONLINE ? ONLINE : OFFLINE;
    const previous = this.status;
    if (!force && next === previous) return false;
    this.status = next;
    const event = Object.freeze({status: next, previous, source, changed: next !== previous});
    for (const listener of [...this.listeners]) {
      try { listener(event); } catch (error) { console.error('NetworkStatusService listener', error); }
    }
    return true;
  }
}

export const networkStatus = new NetworkStatusService();
export {ONLINE, OFFLINE};
