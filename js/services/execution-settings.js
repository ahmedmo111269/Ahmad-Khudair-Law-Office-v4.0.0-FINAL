// إعدادات التنفيذ المؤرخة: القواعد المالية إعداد ممارسة للمكتب، وليست ثوابت قانونية.
// الإعداد القديم v1 يُحفظ كما هو؛ الإصدار v2 يطبّق افتراضيًا على البنود القائمة.
import {prefs} from '../core/preferences.js';
import {DEFAULT_SCHEDULE_SETTINGS, EXECUTION_ENGINE_VERSION, ACCRUAL_TIMINGS} from '../domain/execution-schedule.js';
import {STORE} from '../db/schema.js';
import {transaction, request} from '../db/unit-of-work.js';
import {uid} from '../core/id.js';
import {Clock} from '../core/clock.js';
import {events} from '../core/events.js';

export const EXECUTION_SETTINGS_VERSION = 2;
const KEY_BASE = `exec:settings:v${EXECUTION_SETTINGS_VERSION}`;
const LEGACY_KEY_BASE = 'exec:settings:v1';
const RULE_KEYS = Object.freeze(['periodBasis', 'startPolicy', 'midChangePolicy', 'endPolicy', 'accrualTiming', 'monthEndPolicy']);
const RETIRED_SCHEDULE_KEYS = Object.freeze(['prorationPolicy', 'firstMonthPolicy', 'monthBasis', 'monthDayBasis']);
function cleanSchedule(schedule) {
  const result = {...schedule};
  for (const key of RETIRED_SCHEDULE_KEYS) delete result[key];
  // توقيت الاستحقاق اختيار مكتب صحيح (بداية الفترة / بعد اكتمالها) — كان يُفرض
  // برمجيًا فيُفرغ أي تنفيذ جديد يبدأ من اليوم من كل حساب حتى نهاية الشهر.
  if (!ACCRUAL_TIMINGS.includes(result.accrualTiming)) result.accrualTiming = DEFAULT_SCHEDULE_SETTINGS.accrualTiming;
  result.monthEndPolicy = 'CLAMP_TO_LAST_DAY';
  return result;
}

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
  templates: {statement: 'كشف حساب التنفيذ', poa: 'توكيل بالتنفيذ', balanceSlip: 'بيان رصيد', followUp: 'ورقة متابعة',
    // نص توكيل قابل للتحرير من الإعدادات. المتغيرات: {{client}} {{debtor}} {{periods}} {{total}} {{fees}}
    // {{stamps}} {{expenses}} {{previousBalance}} {{fromDate}} {{toDate}} {{poaNumber}} {{judgments}} {{equation}}
    // فارغ افتراضيًا ⇒ يُستخدم قالب executionTemplates المخزّن. لا يُطبع مبلغ غير مسجل.
    poaBody: ''},
  // حدود «يحتاج انتباهي» بالأيام — قابلة للتعديل من إعدادات التنفيذ.
  // تنبيه تنظيمي لإدارة المكتب، وليس تقييمًا قانونيًا للموقف.
  followUpThresholds: {
    unpaidWithoutActionDays: 60,
    poaWithoutResultDays: 30,
    periodEndedWithoutPositionDays: 0,
    petitionWithoutJudicialNumber: true,
    judgmentWithoutEffectiveDate: true,
    enabled: true
  }
});

/** وضع العرض: مبسّط (افتراضي) يخفي الأدوات المتقدمة، أو متقدّم يعرض كل شيء. */
export const UI_MODES = Object.freeze(['simple', 'advanced']);
export function normalizeUiMode(value, fallback = 'simple') {
  return UI_MODES.includes(String(value || '')) ? String(value) : (UI_MODES.includes(String(fallback)) ? String(fallback) : 'simple');
}

const defaults = () => ({
  version: EXECUTION_SETTINGS_VERSION,
  uiMode: 'simple',
  ruleVersion: 2,
  engineVersion: EXECUTION_ENGINE_VERSION,
  effectiveFrom: DEFAULT_SCHEDULE_SETTINGS.effectiveFrom,
  source: DEFAULT_SCHEDULE_SETTINGS.source,
  schedule: {...DEFAULT_SCHEDULE_SETTINGS},
  laterJudgmentApproval: false,
  lists: structuredCloneSafe(DEFAULT_LISTS),
  ruleHistory: [{
    version: 2, engineVersion: EXECUTION_ENGINE_VERSION,
    effectiveFrom: DEFAULT_SCHEDULE_SETTINGS.effectiveFrom,
    source: DEFAULT_SCHEDULE_SETTINGS.source,
    rules: Object.fromEntries(RULE_KEYS.map(key => [key, DEFAULT_SCHEDULE_SETTINGS[key]]))
  }],
  updatedAt: ''
});

function structuredCloneSafe(value) {
  return JSON.parse(JSON.stringify(value));
}
/** دمج عميق لقوائم الإعدادات: إعدادات محفوظة قبل إضافة poaBody/followUpThresholds لا تفقد الافتراضي. */
function mergeLists(base, stored) {
  const out = {...base, ...(stored || {})};
  out.templates = {...(base.templates || {}), ...((stored || {}).templates || {})};
  out.followUpThresholds = {...(base.followUpThresholds || {}), ...((stored || {}).followUpThresholds || {})};
  return out;
}
const keyFor = office => `${KEY_BASE}:${office?.ctx?.profile?.id || 'default'}`;
const legacyKeyFor = office => `${LEGACY_KEY_BASE}:${office?.ctx?.profile?.id || 'default'}`;
function readStored(office) { return prefs.get(keyFor(office), null); }

/** قراءة الإعداد الفعلي؛ إعدادات الشهر الجزئي القديمة لا تُدمج في القواعد الجديدة. */
export function executionSettings(office) {
  const stored = readStored(office);
  const base = defaults();
  if (!stored || typeof stored !== 'object') {
    const legacy = prefs.get(legacyKeyFor(office), null);
    if (!legacy || typeof legacy !== 'object') return base;
    return {
      ...base,
      laterJudgmentApproval: Boolean(legacy.laterJudgmentApproval),
      lists: mergeLists(base.lists, legacy.lists),
      schedule: {
        ...base.schedule,
        allocationOrder: ['fifo', 'lifo', 'proportional'].includes(legacy.schedule?.allocationOrder) ? legacy.schedule.allocationOrder : base.schedule.allocationOrder,
        defaultCurrency: legacy.schedule?.defaultCurrency || base.schedule.defaultCurrency
      },
      legacySettingsPreserved: true
    };
  }
  return {
    ...base, ...stored,
    version: EXECUTION_SETTINGS_VERSION,
    ruleVersion: Number(stored.ruleVersion || 2),
    engineVersion: Number(stored.engineVersion || EXECUTION_ENGINE_VERSION),
    schedule: cleanSchedule({...base.schedule, ...(stored.schedule || {})}),
    lists: mergeLists(base.lists, stored.lists),
    ruleHistory: Array.isArray(stored.ruleHistory) ? stored.ruleHistory : base.ruleHistory,
    uiMode: normalizeUiMode(stored.uiMode, base.uiMode)
  };
}

function activityRow(office, action, summary, metadata = {}) {
  return {
    id: uid(), entityType: 'executionSettings', entityId: keyFor(office), action,
    timestamp: Clock.now(), summary, metadata: {...metadata},
    ...(office?.ctx?.profile?.id ? {actorId: office.ctx.profile.id} : {})
  };
}

async function logSettingsChange(office, action, summary, metadata) {
  if (!office?.ctx?.db) return;
  await transaction(office.ctx, [STORE.activityLog], async tx => {
    await request(tx.objectStore(STORE.activityLog).add(activityRow(office, action, summary, metadata)));
  });
}

function rulesChanged(before, after) {
  return RULE_KEYS.some(key => String(before.schedule?.[key]) !== String(after.schedule?.[key]));
}

function invalidateExecutionCaches(office, settings) {
  if (office?.app?.__execLookup) office.app.__execLookup = {clients: new Map(), cases: new Map(), files: new Map()};
  events.emit('execution:cache-invalidated', {engineVersion: settings.engineVersion, settingsVersion: settings.ruleVersion});
  events.emit('execution:configuration-changed', {engineVersion: settings.engineVersion});
}

/**
 * Persist v2 on first boot, leaving the prior v1 key untouched.
 * This is idempotent and records the office-reported source in Activity Log.
 */
export async function ensureExecutionSettingsV2(office) {
  const existing = readStored(office);
  if (existing && Number(existing.version) >= EXECUTION_SETTINGS_VERSION) return executionSettings(office);
  const before = executionSettings(office);
  const next = {
    ...before, version: EXECUTION_SETTINGS_VERSION, ruleVersion: 2,
    engineVersion: Math.max(EXECUTION_ENGINE_VERSION, Number(before.engineVersion || 1)),
    effectiveFrom: DEFAULT_SCHEDULE_SETTINGS.effectiveFrom,
    source: DEFAULT_SCHEDULE_SETTINGS.source,
    schedule: {...DEFAULT_SCHEDULE_SETTINGS, allocationOrder: before.schedule.allocationOrder, defaultCurrency: before.schedule.defaultCurrency},
    ruleHistory: [
      ...(prefs.get(legacyKeyFor(office), null) ? [{version: 1, engineVersion: 1, preserved: true, source: 'إعدادات المكتب السابقة (v1)', rules: prefs.get(legacyKeyFor(office), null)?.schedule || {}}] : []),
      {version: 2, engineVersion: EXECUTION_ENGINE_VERSION, effectiveFrom: DEFAULT_SCHEDULE_SETTINGS.effectiveFrom,
        source: DEFAULT_SCHEDULE_SETTINGS.source, rules: Object.fromEntries(RULE_KEYS.map(key => [key, DEFAULT_SCHEDULE_SETTINGS[key]]))}
    ],
    updatedAt: Clock.now()
  };
  await prefs.set(keyFor(office), next);
  await logSettingsChange(office, 'version', 'ترقية إعدادات/محرك فترات التنفيذ إلى الإصدار 2؛ بقي الإصدار السابق محفوظًا', {
    fromVersion: Number(existing?.version || 1), toVersion: EXECUTION_SETTINGS_VERSION,
    engineVersion: next.engineVersion, effectiveFrom: next.effectiveFrom, source: next.source,
    invalidatedCache: true
  });
  invalidateExecutionCaches(office, next);
  return executionSettings(office);
}

/** Save a partial settings update and preserve every prior rule version. */
export async function saveExecutionSettings(office, patch = {}) {
  const before = executionSettings(office);
  const next = {
    ...before, ...patch, version: EXECUTION_SETTINGS_VERSION,
    uiMode: normalizeUiMode(patch.uiMode ?? before.uiMode, 'simple'),
    schedule: cleanSchedule({...before.schedule, ...(patch.schedule || {})}),
    lists: mergeLists(before.lists, patch.lists),
    updatedAt: Clock.now()
  };
  const changedRules = rulesChanged(before, next);
  if (changedRules) {
    next.ruleVersion = Number(before.ruleVersion || 2) + 1;
    next.engineVersion = Number(before.engineVersion || EXECUTION_ENGINE_VERSION) + 1;
    next.effectiveFrom = patch.effectiveFrom || Clock.today();
    next.source = String(patch.source || 'اختيار المكتب لإعدادات احتساب التنفيذ');
    next.schedule = {...next.schedule, engineVersion: next.engineVersion, effectiveFrom: next.effectiveFrom, source: next.source};
    next.ruleHistory = [...(before.ruleHistory || []), {
      version: next.ruleVersion, engineVersion: next.engineVersion, effectiveFrom: next.effectiveFrom,
      source: next.source, rules: Object.fromEntries(RULE_KEYS.map(key => [key, next.schedule[key]])),
      changedAt: next.updatedAt
    }];
  }
  await prefs.set(keyFor(office), next);
  await logSettingsChange(office, changedRules ? 'rules-update' : 'update',
    changedRules ? `تغيير قواعد فترات التنفيذ إلى نسخة ${next.ruleVersion} — ${next.source}` : 'تحديث إعدادات التنفيذ',
    {version: next.ruleVersion, engineVersion: next.engineVersion, changedRules, effectiveFrom: next.effectiveFrom, source: next.source, invalidatedCache: true});
  invalidateExecutionCaches(office, next);
  return next;
}

export async function resetExecutionSettings(office) {
  const before = executionSettings(office);
  const next = {
    ...defaults(), ruleVersion: Number(before.ruleVersion || 2) + 1,
    engineVersion: Number(before.engineVersion || EXECUTION_ENGINE_VERSION) + 1,
    effectiveFrom: Clock.today(), source: 'استعادة افتراضي المكتب بطلب المستخدم', updatedAt: Clock.now()
  };
  next.schedule = {...next.schedule, engineVersion: next.engineVersion, effectiveFrom: next.effectiveFrom, source: next.source};
  next.ruleHistory = [...(before.ruleHistory || []), {
    version: next.ruleVersion, engineVersion: next.engineVersion, effectiveFrom: next.effectiveFrom,
    source: next.source, rules: Object.fromEntries(RULE_KEYS.map(key => [key, next.schedule[key]])), changedAt: next.updatedAt
  }];
  await prefs.set(keyFor(office), next);
  await logSettingsChange(office, 'rules-reset', `إعادة قواعد التنفيذ إلى افتراضي المكتب — نسخة ${next.ruleVersion}`, {
    version: next.ruleVersion, engineVersion: next.engineVersion, effectiveFrom: next.effectiveFrom, source: next.source, invalidatedCache: true
  });
  invalidateExecutionCaches(office, next);
  return executionSettings(office);
}

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
