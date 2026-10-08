// أعلام الميزات: مفتاح واحد لكل سلوك يمكن إيقافه دون لمس الكود.
// القراءة تتم عبر isOn() حتى تُحترم التجاوزات المحلية (اختبارات، تشخيص، طوارئ)
// مع بقاء FLAGS مصدر الحقيقة الافتراضي.
export const FLAGS = {
  pwa: true,
  reports: true,
  advancedSearch: true,
  backup: true,
  multiDatabase: true,
  // كاش مفاتيح البحث (موجة 3): يحوّل البحث الاحتوائي من مسح المخزن لكل ضغطة
  // مفتاح إلى قراءة من الذاكرة. إيقافه يعيد مسار IndexedDB القديم حرفيًا.
  searchKeyCache: true
};

const OVERRIDES = new Map();

export function isOn(name) {
  if (OVERRIDES.has(name)) return OVERRIDES.get(name);
  return Boolean(FLAGS[name]);
}

/** تجاوز مؤقت (اختبارات/تشخيص). القيمة null تعيد العلم إلى مصدره الأصلي. */
export function setFlag(name, value) {
  if (value === null || value === undefined) OVERRIDES.delete(name);
  else OVERRIDES.set(name, Boolean(value));
  return isOn(name);
}

export function resetFlags() { OVERRIDES.clear(); }
