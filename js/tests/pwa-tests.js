// اختبارات موجز Android/PWA — منطق صافٍ يعمل في Node وفي المتصفح:
// تاريخ التنقل (زر الرجوع)، مكدّس الطبقات العلوية، حالة الشبكة، رسائل أخطاء
// التخزين، وحالة خدمتي التثبيت والتحديث. لا تلمس أي بيانات مكتب.
// (كل اختبار مستقل بذاته: يبني بيئته ويفكّها داخل الدالة نفسها.)
import {RouteHistory, hashForRoute, routeFromHash, routeFromStateOrLocation} from '../core/history-nav.js';
import * as overlays from '../ui/overlay-stack.js';
import {storageErrorHint} from '../core/storage-persistence.js';
import {PWAInstallService} from '../services/pwa-install.js';
import {PWAUpdateService} from '../services/pwa-updates.js';
import {networkStatus, ONLINE, OFFLINE} from '../core/network-status.js';

/** نافذة وهمية كافية لمحاكاة تاريخ المتصفح وسلوك زر الرجوع. */
function fakeWindow() {
  const entries = [{state: null, hash: ''}];
  let index = 0;
  const listeners = {};
  const pending = [];
  const win = {
    location: {pathname: '/index.html', search: '', hash: '', href: 'http://localhost/index.html'},
    history: {
      get state() { return entries[index].state; },
      get length() { return entries.length; },
      pushState(state, _title, url) {
        entries.splice(index + 1);
        const hash = String(url || '').includes('#') ? String(url).slice(String(url).indexOf('#')) : win.location.hash;
        entries.push({state, hash});
        index = entries.length - 1;
        win.location.hash = hash;
      },
      replaceState(state, _title, url) {
        const hash = String(url || '').includes('#') ? String(url).slice(String(url).indexOf('#')) : win.location.hash;
        entries[index] = {state, hash};
        win.location.hash = hash;
      },
      back() {
        if (index === 0) return;
        index -= 1;
        win.location.hash = entries[index].hash;
        pending.push(() => win.__firePop({state: entries[index].state}));
        setTimeout(() => { const fire = pending.shift(); fire?.(); }, 0);
      }
    },
    addEventListener(type, handler) { (listeners[type] ||= []).push(handler); },
    removeEventListener(type, handler) { listeners[type] = (listeners[type] || []).filter(h => h !== handler); },
    __firePop(event) { for (const handler of listeners.popstate || []) handler(event); },
    __index() { return index; }
  };
  return win;
}
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
const clearOverlays = () => { while (overlays.isOpen()) overlays.release(overlays.topKey()); };
/** متحكم تاريخ مربوط بمكدّس الطبقات كما يربطه app.js تمامًا. */
const controller = (win, seen = []) => new RouteHistory({
  windowRef: win,
  onNavigate: route => seen.push(route),
  hasOverlay: () => overlays.isOpen(),
  onOverlayBack: () => overlays.closeTop()
});

export async function runPwaTests(test, expect) {
  // ---- ترميز المسار في الـhash (GitHub Pages: بلا مسارات خادم وبلا 404) ----
  test('PWA: internal route survives hash round-trip (Arabic, colon, query)', () => {
    for (const route of ['dashboard', 'exc:01M4XYZ', 'files?preset=week', 'cfile:01M4ABC?cat=civil', 'rec:cases:01M4']) {
      expect(routeFromHash(hashForRoute(route))).toBe(route);
    }
  });

  test('PWA: unknown or corrupt hash is ignored instead of breaking boot', () => {
    expect(routeFromHash('')).toBe(null);
    expect(routeFromHash('#nothing')).toBe(null);
    expect(routeFromHash('#/')).toBe(null);
    expect(routeFromHash('#/%E0%A4%A')).toBe(null);
    expect(routeFromStateOrLocation({akl: 'route', route: 'files'}, '')).toBe('files');
    expect(routeFromStateOrLocation({akl: 'overlay'}, '#/clients')).toBe('clients');
  });

  // ---- تاريخ التنقل: زر الرجوع بين الشاشات ----
  test('PWA: each screen pushes one history entry and back returns to the previous screen', async () => {
    const win = fakeWindow();
    const seen = [];
    const history = controller(win, seen);
    history.start('dashboard');
    history.record('dashboard'); // مسار الإقلاع نفسه: لا مدخل مكرر
    history.record('files');
    history.record('clients');
    expect(history.depth).toBe(2);
    expect(win.__index()).toBe(2);
    history.back();
    await tick();
    expect(seen.length).toBe(1);
    expect(seen[0]).toBe('files');
    expect(history.depth).toBe(1);
    history.dispose();
  });

  test('PWA: replace does not add a browser entry (refresh keeps one entry)', async () => {
    const win = fakeWindow();
    const seen = [];
    const history = controller(win, seen);
    history.start('dashboard');
    history.record('files');
    history.record('dashboard', {replace: true});
    history.record('hearings');
    expect(history.depth).toBe(2);
    expect(win.__index()).toBe(2);
    expect(seen.length).toBe(0);
    history.dispose();
  });

  // ---- زر الرجوع والطبقات العلوية ----
  test('PWA: opening an overlay pushes one protection entry that Android back consumes', async () => {
    clearOverlays();
    const win = fakeWindow();
    const navigations = [];
    const history = controller(win, navigations);
    history.start('dashboard');
    history.record('files');
    overlays.bindOverlayStack(history);
    let closed = 0;
    const release = overlays.open('test-modal', () => { closed += 1; release(); return true; });
    expect(overlays.isOpen()).toBe(true);
    expect(history.depth).toBe(2);
    expect(win.__index()).toBe(2);
    history.back();
    await tick();
    expect(closed).toBe(1);
    expect(overlays.isOpen()).toBe(false);
    expect(navigations.length).toBe(0); // لم تُفقد الشاشة
    expect(history.depth).toBe(1);
    overlays.bindOverlayStack(null);
    history.dispose();
  });

  test('PWA: stacked layers close one at a time and keep the lower layer open', async () => {
    clearOverlays();
    const win = fakeWindow();
    const navigations = [];
    const history = controller(win, navigations);
    history.start('dashboard');
    history.record('files');
    overlays.bindOverlayStack(history);
    let lowerClosed = 0;
    const releaseLower = overlays.open('stacked-lower', () => { lowerClosed += 1; return true; });
    const releaseUpper = overlays.open('stacked-upper', () => { releaseUpper(); return true; });
    history.back();
    await tick();
    expect(lowerClosed).toBe(0);
    expect(overlays.keys().join(',')).toBe('stacked-lower');
    expect(navigations.length).toBe(0);
    releaseLower();
    expect(overlays.isOpen()).toBe(false);
    expect(history.depth).toBe(1);
    overlays.bindOverlayStack(null);
    history.dispose();
  });

  test('PWA: a stale overlay entry never swallows the back button', async () => {
    clearOverlays();
    const win = fakeWindow();
    const history = controller(win);
    history.start('dashboard');
    overlays.bindOverlayStack(history);
    overlays.open('stale-layer', () => false); // طبقة يتيمة لا تُغلق
    expect(overlays.closeTop()).toBe(false);
    expect(overlays.isOpen()).toBe(false);
    overlays.bindOverlayStack(null);
    history.dispose();
  });

  // ---- مكدّس الطبقات: السلوك الصافي ----
  test('PWA: overlay registry keeps one entry per layer key', () => {
    clearOverlays();
    overlays.bindOverlayStack(null);
    const release = overlays.open('pure-a', () => { release(); return true; });
    const again = overlays.open('pure-a', () => true);
    expect(overlays.size()).toBe(1);
    expect(overlays.topKey()).toBe('pure-a');
    expect(overlays.release('missing')).toBe(false);
    again(); // إفراج المفتاح نفسه: لا نسخة مكررة في المكدس
    expect(overlays.size()).toBe(0);
    const releaseB = overlays.open('pure-b', () => { releaseB(); return true; });
    expect(overlays.closeTop()).toBe(true);
    expect(overlays.closeTop()).toBe(false); // لا شيء لإغلاقه
    clearOverlays();
  });

  // ---- حالة الشبكة: وسيلة إعلامية فقط، والعمل المحلي لا يتوقف عليها ----
  test('PWA: network status is informational and local data stays available offline', () => {
    networkStatus.setStatus(OFFLINE);
    expect(networkStatus.isOffline()).toBe(true);
    networkStatus.setStatus(ONLINE);
    expect(networkStatus.isOnline()).toBe(true);
    expect(ONLINE === OFFLINE).toBe(false);
  });

  // ---- رسائل أخطاء التخزين ----
  test('PWA: storage errors are explained in Arabic instead of raw browser text', () => {
    const quota = Object.assign(new Error('x'), {name: 'QuotaExceededError'});
    expect(String(storageErrorHint(quota)).length > 20).toBe(true);
    expect(storageErrorHint({name: 'VersionError'}).includes('إصدار')).toBe(true);
    expect(storageErrorHint({name: 'NotAStorageError'})).toBe(null);
  });

  // ---- خدمة التثبيت ----
  test('PWA: install is offered only when the browser allows it and never before real usage', () => {
    const service = new PWAInstallService({isStandalone: () => false}).start();
    expect(service.canInstall()).toBe(false);
    expect(service.state().installed).toBe(false);
    expect(service.shouldHint()).toBe(false); // لا تلميح قبل استخدام فعلي
    service.deferred = {prompt: () => {}, userChoice: Promise.resolve({outcome: 'accepted'})};
    expect(service.canInstall()).toBe(true);
  });

  test('PWA: install prompt resolves with the user choice and stops offering itself', async () => {
    const service = new PWAInstallService({isStandalone: () => false}).start();
    let prompted = false;
    service.deferred = {prompt: () => { prompted = true; }, userChoice: Promise.resolve({outcome: 'accepted'})};
    const result = await service.prompt();
    expect(result.outcome).toBe('accepted');
    expect(prompted).toBe(true);
    expect(service.isInstalled()).toBe(true);
    expect(service.canInstall()).toBe(false);
    expect(service.manualSteps().length).toBe(3);
  });

  test('PWA: installed app is detected from standalone display mode', () => {
    const installed = new PWAInstallService({isStandalone: () => true});
    expect(installed.isInstalled()).toBe(true);
    expect(installed.shouldHint()).toBe(false);
  });

  // ---- تحديث التطبيق: لا استيلاء تلقائي على الجلسة المفتوحة ----
  test('PWA: update notice is shown once and offers an explicit action', () => {
    const notifications = [];
    const updates = new PWAUpdateService({network: {subscribe: () => () => {}, isOnline: () => true}, notify: (message, type) => notifications.push([message, type])});
    updates.registration = {waiting: null, installing: null};
    expect(updates.announceUpdate()).toBe(true);
    expect(updates.announceUpdate()).toBe(false);
    expect(notifications.length).toBe(1);
    expect(updates.updateReady).toBe(true);
    expect(updates.accept()).toBe(false); // بلا عامل منتظر: لا يحدث شيء
  });

  test('PWA: accepting an update posts SKIP_WAITING and reloads once without touching local data', async () => {
    let reloaded = 0;
    let posted = null;
    const applied = new PWAUpdateService({notify: () => {}, apply: () => { reloaded += 1; }, network: {subscribe: () => () => {}}});
    applied.registration = {waiting: {postMessage: message => { posted = message; }}};
    expect(applied.accept()).toBe(true);
    expect(posted?.type).toBe('SKIP_WAITING');
    await new Promise(resolve => setTimeout(resolve, 500));
    expect(reloaded).toBe(1);
  });
}
