// =====================================================================
// إعدادات قسم التنفيذ — قليلة، بأسماء واضحة، وكلها قابلة للتعديل.
// ---------------------------------------------------------------------
// لا يفترض البرنامج رسمًا ولا دمغة ولا مدة ولا إجراءً إلزاميًا: كل ما يتعلق
// بالممارسة أو القانون قائمة يعدّلها المكتب (ولها تاريخ ومصدر عند الحاجة).
// التخزين: تفضيلات القاعدة الحالية (prefs) فتسافر مع النسخة الاحتياطية للواجهة
// ولا تُخلط بين قواعد المكتب.
// =====================================================================
import {prefs} from '../core/preferences.js';
import {DEFAULT_SCHEDULE_SETTINGS} from '../domain/execution-schedule.js';

export const EXECUTION_SETTINGS_VERSION = 1;
const KEY_BASE = 'exec:settings:v1';

/** قوائم افتراضية مقترحة (قابلة للتعديل بالكامل من الإعدادات). */
export const DEFAULT_LISTS = Object.freeze({
  entitlementTypes: ['نفقة صغار', 'نفقة زوجة', 'متعة', 'مؤخر صداق', 'أجر مسكن', 'أجر حضانة', 'نفقات علاج', 'مبلغ مقطوع', 'التزام آخر'],
  executionMethods: ['تكليف بالوفاء', 'حجز راتب', 'حجز أموال', 'إعلان بيع', 'بيع بالمزاد', 'تسليم عين', 'أخرى'],
  collectionMethods: ['نقدي', 'تحويل بنكي', 'شيك', 'خصم من الراتب', 'إيصال قلم التنفيذ', 'أخرى'],
  actionKinds: [
    ['summons', 'تكليف بالوفاء'], ['notice', 'إعلان'], ['seizure', 'حجز'], ['sale_notice', 'إعلان بيع'],
    ['sale_session', 'جلسة بيع'], ['dissipation', 'محضر تبديد'], ['petition', 'عريضة'], ['misdemeanor', 'جنحة'],
    ['refusal_record', 'محضر امتناع'], ['request', 'طلب / تظلم'], ['other', 'أخرى']
  ],
  expenseTypes: [
    ['EXECUTION_FEE', 'رسم تنفيذ'], ['STAMP', 'طابع / دمغة'], ['COLLECTION_FEE', 'مصروف تحصيل'],
    ['OTHER_EXPENSE', 'مصروف آخر']
  ],
  borneBy: [['debtor', 'المنفذ ضده'], ['client', 'الموكل'], ['office', 'المكتب']],
  laterJudgmentKinds: [['appeal', 'استئناف'], ['modification', 'حكم معدِّل'], ['correction', 'تصحيح'], ['other', 'أخرى']],
  templates: {
    statement: 'كشف حساب التنفيذ',
    poa: 'توكيل بالتنفيذ',
    balanceSlip: 'بيان رصيد',
    followUp: 'ورقة متابعة'
  }
});

const defaults = () => ({
  version: EXECUTION_SETTINGS_VERSION,
  schedule: {...DEFAULT_SCHEDULE_SETTINGS},
  laterJudgmentApproval: false,
  lists: {...DEFAULT_LISTS},
  updatedAt: ''
});

const keyFor = office => `${KEY_BASE}:${office?.ctx?.profile?.id || 'default'}`;

/** الإعدادات الفعلية بعد الدمج مع الافتراضي — قراءة فورية بلا انتظار. */
export function executionSettings(office) {
  const stored = prefs.get(keyFor(office), null);
  const base = defaults();
  if (!stored || typeof stored !== 'object') return base;
  return {
    ...base, ...stored,
    schedule: {...base.schedule, ...(stored.schedule || {})},
    lists: {...base.lists, ...(stored.lists || {})}
  };
}

/** حفظ تعديل جزئي (Idempotent) — يُعاد دائمًا كائن كامل. */
export async function saveExecutionSettings(office, patch = {}) {
  const next = {...executionSettings(office), ...patch, updatedAt: new Date().toISOString()};
  next.schedule = {...executionSettings(office).schedule, ...(patch.schedule || {})};
  next.lists = {...executionSettings(office).lists, ...(patch.lists || {})};
  await prefs.set(keyFor(office), next);
  return next;
}

export async function resetExecutionSettings(office) {
  await prefs.set(keyFor(office), null);
  return executionSettings(office);
}

/* ===== قوائم مساعدة للواجهة ===== */

export const actionKindOptions = settings => (settings?.lists?.actionKinds || DEFAULT_LISTS.actionKinds);
export const expenseTypeOptions = settings => (settings?.lists?.expenseTypes || DEFAULT_LISTS.expenseTypes);
export const entitlementOptions = settings => (settings?.lists?.entitlementTypes || DEFAULT_LISTS.entitlementTypes);
export const collectionMethodOptions = settings => (settings?.lists?.collectionMethods || DEFAULT_LISTS.collectionMethods);
export const executionMethodOptions = settings => (settings?.lists?.executionMethods || DEFAULT_LISTS.executionMethods);

export function actionKindLabelOf(settings, value) {
  const row = actionKindOptions(settings).find(([key]) => key === value);
  return row ? row[1] : (value || 'إجراء');
}
export function expenseTypeLabelOf(settings, value) {
  const row = expenseTypeOptions(settings).find(([key]) => key === value);
  return row ? row[1] : (value || 'مصروف');
}
export function borneByLabelOf(settings, value) {
  const row = (settings?.lists?.borneBy || DEFAULT_LISTS.borneBy).find(([key]) => key === value);
  return row ? row[1] : '';
}

/** دمج قائمة مقترحة مع إضافات المكتب (بلا تكرار، وبلا حذف إضافة قائمة). */
export function mergeOptions(baseOptions, extra = []) {
  const seen = new Set(baseOptions.map(([key]) => key));
  const rows = [...baseOptions];
  for (const row of extra || []) {
    const [key, label] = Array.isArray(row) ? row : [row?.key || row?.id || row, row?.label || row];
    if (!key || seen.has(key)) continue;
    seen.add(key);
    rows.push([key, label || key]);
  }
  return rows;
}
