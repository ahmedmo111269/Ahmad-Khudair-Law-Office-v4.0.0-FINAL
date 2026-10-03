import {uid} from './id.js';

const DEVICE_ID_KEY = 'akl:sync:device-id:v1';
let memoryId = '';

/** A stable ID for this browser installation. It identifies a device, never a user or an office record. */
export function getDeviceId() {
  if (memoryId) return memoryId;
  try {
    const saved = globalThis.localStorage?.getItem(DEVICE_ID_KEY);
    if (saved && /^[A-Za-z0-9_-]{8,100}$/.test(saved)) return (memoryId = saved);
    memoryId = `dev-${uid()}`;
    globalThis.localStorage?.setItem(DEVICE_ID_KEY, memoryId);
    return memoryId;
  } catch {
    // Private browsing / blocked storage: keep the app usable for this page session.
    return (memoryId ||= `dev-${uid()}`);
  }
}

/** A human-readable local label carried only in manually exchanged sync packages. */
export function getDeviceName() {
  try {
    const saved = globalThis.localStorage?.getItem('akl:sync:device-name:v1');
    if (saved?.trim()) return saved.trim().slice(0, 80);
  } catch {}
  const platform = String(globalThis.navigator?.platform || '').trim();
  const label = platform ? `جهاز ${platform}` : 'هذا الجهاز';
  return label.slice(0, 80);
}

export function setDeviceName(value) {
  const name = String(value || '').trim().slice(0, 80);
  if (!name) throw new Error('اكتب اسمًا لهذا الجهاز.');
  try { globalThis.localStorage?.setItem('akl:sync:device-name:v1', name); }
  catch { throw new Error('تعذر حفظ اسم الجهاز في تخزين المتصفح.'); }
  return name;
}
