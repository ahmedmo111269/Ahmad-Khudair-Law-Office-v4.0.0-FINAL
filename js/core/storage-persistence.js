// =====================================================================
// مرونة التخزين على Android
// ---------------------------------------------------------------------
// 1) طلب تخزين دائم (navigator.storage.persist) — بلا هذا قد يمسح المتصفح
//    بيانات IndexedDB عند ضغط مساحة الجهاز، وهو خطر حقيقي على تطبيق مكتبي.
// 2) مراقبة المساحة (Quota) — عرض مستوى الخطر بلا إزعاج.
// 3) تشخيص أخطاء التخزين الشائعة على Android (QuotaExceeded / Abort /
//    Version / InvalidState) برسائل عربية واضحة بدل أخطاء تقنية.
// لا يغيّر أي بيانات، ولا يغيّر Database Schema، ولا يفتح أي قاعدة جديدة.
// =====================================================================
import {storageEstimate, quotaLevel} from '../db/quota.js';

const PROMPT_KEY = 'akl:prefs:storage-persist-ask';

/** يطلب تخزينًا دائمًا مرة واحدة عند الإقلاع. يُعيد الحالة الفعلية. */
export async function ensurePersistentStorage({warn = null} = {}) {
  try {
    const manager = globalThis.navigator?.storage;
    if (!manager?.persisted || !manager?.persist) return {supported: false, persisted: false};
    const already = await manager.persisted();
    if (already) return {supported: true, persisted: true, granted: true};
    // لا نسأل في كل إقلاع: مرة واحدة لكل جهاز، وبلا تعطيل أي وظيفة عند الرفض.
    let asked = false;
    try { asked = localStorage.getItem(PROMPT_KEY) === '1'; } catch { asked = false; }
    if (asked) return {supported: true, persisted: false, granted: false};
    const granted = await manager.persist();
    try { localStorage.setItem(PROMPT_KEY, '1'); } catch { /* التخزين غير متاح */ }
    if (!granted) warn?.('لم يمنح المتصفح تخزينًا دائمًا. أنشئ نسخة احتياطية دوريًا للحفاظ على بيانات المكتب.');
    return {supported: true, persisted: granted, granted};
  } catch (error) {
    return {supported: false, persisted: false, error};
  }
}

/** قراءة حالة المساحة الحالية بمستوى خطر مفهوم. */
export async function storageHealth() {
  const estimate = await storageEstimate().catch(() => null);
  if (!estimate) return {available: false};
  const level = quotaLevel(estimate);
  const usageMb = Math.round((estimate.usage || 0) / 1024 / 1024);
  const quotaMb = Math.round((estimate.quota || 0) / 1024 / 1024);
  return {available: true, level, usageMb, quotaMb, usage: estimate.usage || 0, quota: estimate.quota || 0, estimate};
}

/**
 * مراقبة المساحة: لا تُقاطع العمل، لكن تنبّه عند الاقتراب من الحد — وهو
 * السبب الأول لتوقف الكتابة في IndexedDB على Android.
 */
export function watchStorage({onLevel = () => {}, intervalMs = 5 * 60 * 1000} = {}) {
  let lastLevel = null;
  const sample = async () => {
    const health = await storageHealth();
    if (!health.available) return health;
    if (health.level !== lastLevel) {
      const previous = lastLevel;
      lastLevel = health.level;
      if (previous !== null || health.level === 'warning' || health.level === 'high' || health.level === 'critical') {
        try { onLevel(health); } catch (error) { console.error('storage watch', error); }
      }
    }
    return health;
  };
  const first = sample();
  const timer = setInterval(() => { sample().catch(() => {}); }, Math.max(60000, intervalMs));
  return {first, sample, stop: () => clearInterval(timer)};
}

/** رسالة عربية واضحة لأخطاء التخزين بحسب نوعها (أو null إن لم تكن من التخزين). */
export function storageErrorHint(error) {
  const name = error?.name || '';
  if (name === 'QuotaExceededError') return 'مساحة التخزين على الجهاز اقتربت من حدها. أنشئ نسخة احتياطية ثم أفرغ مساحة (صور/ملفات) أو أنشئ قاعدة أرشيفية، ثم أعد المحاولة.';
  if (name === 'AbortError') return 'أُوقفت عملية الكتابة قبل اكتمالها. لم يُعتمد أي تغيير — أعد المحاولة.';
  if (name === 'VersionError') return 'طلب التطبيق إصدارًا أقل من إصدار قاعدة البيانات الموجودة. حدّث التطبيق ثم أعد المحاولة.';
  if (name === 'InvalidStateError') return 'اتصال قاعدة البيانات أُغلق (نافذة أخرى تُحدّث القاعدة). أعد فتح الصفحة ثم حاول مرة أخرى.';
  if (name === 'BlockedError' || name === 'UnknownError') return 'قاعدة البيانات مشغولة في نافذة أخرى. أغلق النوافذ الأخرى ثم أعد المحاولة.';
  return null;
}
