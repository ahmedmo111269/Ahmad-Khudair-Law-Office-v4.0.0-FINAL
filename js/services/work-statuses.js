// =====================================================================
// مركز العمل — الحالات المخصصة عبر القوائم (Lookups) الموجودة، لا نظام إعدادات موازٍ.
//   • التعريف (اسم الحالة وترتيبها) صفوف في مخزن lookups داخل قاعدة المكتب، فئة workItemStatus: يدخل النسخ الاحتياطي،
//     ويتبع قاعدة المكتب لا الجهاز، وتُدار الأسماء والترتيب أيضًا من الإعدادات ← القوائم كأي قائمة أخرى.
//   • لون الحالة المخصصة تخصيص عرض على الجهاز (prefs `ui:workcenter-config`.statuses[key].color) كألوان الحالات الأساسية.
//   • كل حالة مخصصة «مفتوحة» (الإنجاز والإلغاء أساسيان)، والسجلات تحفظ المفتاح c_… المشتق من معرّف الصف لا الاسم.
//   • الحذف منطقي (removeLookupValue): الحالة «متقاعدة» تبقى مقروءة للسجلات القديمة ولا تُعرض في الاختيار.
// getWorkConfig() متزامن في كل واجهات الرسم، لذا تُحمَّل الحالات في لقطة بالذاكرة (ensureWorkStatuses) عند أول استعلام/
// نموذج/فتح الصفحة، وتُبطَل عند أي تغيّر في lookups (حتى من تبويب آخر) أو تبديل قاعدة المكتب.
// =====================================================================
import {events} from '../core/events.js';
import {AppError, ERR} from '../core/errors.js';
import {STORE} from '../db/schema.js';
import {saveLookupValue, removeLookupValue} from './lookups.js';
import {STATUS_LOOKUP, customStatusesFromRows, customStatusKey} from '../domain/work-items.js';

const EMPTY = Object.freeze({token: null, fresh: false, custom: Object.freeze([]), retired: Object.freeze([])});
let snapshot = EMPTY;

export const customStatusSnapshot = () => snapshot;

events.on('entity:changed', payload => { if (payload?.entityType === STORE.lookups && snapshot.fresh) snapshot = {...snapshot, fresh: false}; });
/** إسقاط اللقطة كاملةً (تبديل القاعدة/استعادة نسخة)؛ تُعاد قراءتها عند أول ensureWorkStatuses. */
export function resetWorkStatuses() { snapshot = EMPTY; }
events.on('db:switched', resetWorkStatuses);
events.on('db:restored', resetWorkStatuses);   // استعادة نسخة فوق الاتصال الحالي (databases.js) تعيد كتابة lookups بلا entity:changed

/** تحميل الحالات المخصصة (النشطة والمتقاعدة) من قاعدة المكتب إلى اللقطة. */
export async function refreshWorkStatuses(office) {
  const rows = await office.r.lookups.byIndexRaw('category', STATUS_LOOKUP, 2000);   // يشمل المحذوف منطقيًا ليبقى مقروءًا للسجلات القديمة
  const {custom, retired} = customStatusesFromRows(rows);
  snapshot = {token: office.ctx.token, fresh: true, custom, retired};
  return snapshot;
}

/** تحميل كسول: لا قراءة إلا أول مرة أو بعد تغيّر القوائم/تبديل القاعدة. */
export async function ensureWorkStatuses(office) {
  if (snapshot.fresh && snapshot.token === office.ctx.token) return snapshot;
  return refreshWorkStatuses(office);
}

/** مسافات داخلية موحّدة قبل الحفظ؛ التحقق الكامل (أساسية/تكرار/طول/سقف) في خطاف القوائم check فيسري على كل مسار. */
const tidy = label => String(label ?? '').replace(/\s+/g, ' ').trim();

/** إضافة حالة مخصصة (صف جديد في lookups). ترجع المعرّف والمفتاح المخزَّن في السجلات. */
export async function createCustomStatus(office, label) {
  const name = tidy(label);
  const row = await saveLookupValue(office, STATUS_LOOKUP, name);   // يتحقق خطاف الفئة (domain statusLabelProblem)
  await refreshWorkStatuses(office);
  return {id: row.id, key: customStatusKey(row.id), label: name};
}

/** إعادة تسمية: المفتاح ثابت فلا يتأثر أي سجل. */
export async function renameCustomStatus(office, id, label) {
  await ensureWorkStatuses(office);
  if (!snapshot.custom.some(s => s.id === id)) throw new AppError(ERR.NOT_FOUND, 'الحالة المخصصة غير موجودة.');
  const name = tidy(label);
  await saveLookupValue(office, STATUS_LOOKUP, name, id);
  await refreshWorkStatuses(office);
  return {id, key: customStatusKey(id), label: name};
}

/** حذف منطقي: لا يمس أي عنصر عمل؛ تصبح الحالة متقاعدة. */
export async function removeCustomStatus(office, id) {
  await ensureWorkStatuses(office);
  if (!snapshot.custom.some(s => s.id === id)) throw new AppError(ERR.NOT_FOUND, 'الحالة المخصصة غير موجودة.');
  await removeLookupValue(office, id);
  await refreshWorkStatuses(office);
}
