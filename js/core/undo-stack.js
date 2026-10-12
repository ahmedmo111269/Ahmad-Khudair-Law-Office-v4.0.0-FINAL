// =====================================================================
// سجل «العودة» (Undo) — آخر الإجراءات القابلة للعكس في جلسة العمل
// ---------------------------------------------------------------------
// غرضه الواحد: زر «عودة» واحد في شريط صفحة الملفات يعرف آخر إجراء عكسيّ
// نفّذه المستخدم (حذف منطقي، أرشفة، إلغاء سجل، مسح فلاتر…) ويُنفّذ عكسه
// بلا بحث في الإشعارات القديمة.
// • ذاكرة فقط: لا يُكتب شيء في التخزين ولا تُضاف مخازن أو فهارس جديدة.
// • كل تسجيل يحمل وصفًا عربيًا + دالة عكس؛ ودالة العكس نفسها هي المسؤولة عن
//   التحقق من صلاحية الحالة (الخدمات القائمة تتحقق أصلًا: restoreEntity،
//   reopenFile، undoVoidSimpleRecord…) فلا يُنفَّذ عكس على سجل لا يخصه.
// • مكدس LIFO بعمق محدود: عند الامتلاء يسقط الأقدم تلقائيًا (بلا تراكم).
// • إشعار موحّد 'undo:changed' على ناقل الأحداث نفسه (محلي فقط، بلا بث
//   بين النوافذ: السجل حالة جلسة هذا التبويب).
// =====================================================================
import {events} from './events.js';

const MAX_DEPTH = 6;
/** مكدس التسجيلات: [{id,label,run,key,at,consumed}] — الأخير هو الأحدث. */
let stack = [];
let seq = 0;

function notify(reason) {
  try { events.emit('undo:changed', { reason, depth: stack.length }, false); }
  catch (error) { console.error('undo:changed', error); }
}

/**
 * يسجّل إجراءً قابلًا للعكس. يُستدعى من موضع التنفيذ نفسه (بعد نجاحه).
 * @param {{run:Function,label?:string,key?:string}} entry دالة العكس + وصف + مفتاح (لتجنّب التكرار)
 * @returns {{id:string,label:string,run:Function,key:string,at:number,consumed:boolean}|null}
 */
export function pushUndo({run, label = '', key = ''} = {}) {
  if (typeof run !== 'function') return null;
  // المفتاح نفسه يعني «نفس النوع»: يبقى أحدث تسجيل فقط (مثل تكرار مسح الفلاتر).
  if (key) stack = stack.filter(entry => entry.key !== key);
  const record = {id: `undo-${++seq}`, label: String(label || '').slice(0, 120), run, key: String(key || ''), at: Date.now(), consumed: false};
  stack.push(record);
  if (stack.length > MAX_DEPTH) stack.splice(0, stack.length - MAX_DEPTH);
  notify('push');
  return record;
}

/** أعلى السجل (الإجراء الذي ستُعيده الضغطة التالية) أو null. */
export function peekUndo() {
  return stack.length ? stack[stack.length - 1] : null;
}

export function undoDepth() {
  return stack.length;
}

/** إزالة تسجيل بعينه (يُستخدم عندما يُنفَّذ العكس من الإشعار نفسه فلا يتكرر). */
export function removeUndo(record) {
  if (!record) return false;
  const before = stack.length;
  stack = stack.filter(entry => entry !== record);
  if (stack.length !== before) { record.consumed = true; notify('remove'); return true; }
  return false;
}

/** ينفّذ عكس أعلى السجل ويسقطه. يرمي خطأ دالة العكس كما هو للعرض على المستخدم. */
export async function runUndo() {
  const record = stack.pop() || null;
  if (!record) return null;
  record.consumed = true;
  notify('run');
  await record.run(record);
  return record;
}

/** تفريغ السجل (اختبارات/تغيير قاعدة البيانات). */
export function clearUndo() {
  if (!stack.length) return;
  stack = [];
  notify('clear');
}
