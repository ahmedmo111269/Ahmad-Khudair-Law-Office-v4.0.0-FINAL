// ============================================================
// إبطال الكاش بين النوافذ (تبويبات/نوافذ نفس القاعدة على نفس الجهاز).
// ------------------------------------------------------------
// قاعدة العمل هنا في البرنامج: أكثر من نافذة قد تفتح نفس قاعدة البيانات.
// الكاشات المحلية (نصوص البحث مثلًا) صارت قديمة بمجرد كتابة في نافذة أخرى.
// الرسالة تمر عبر BroadcastChannel الموجود أصلًا (js/core/events.js) فلا
// تُضاف بنية جديدة، وتُجمَّع في نافذة زمنية قصيرة حتى لا يتحول كل حفظ إلى
// عاصفة رسائل.
//
// لا تُنقل أي بيانات في الرسالة — فقط أسماء المخازن التي كُتب فيها.
// ============================================================
import {events} from '../core/events.js';
import {bumpGlobalEpoch} from './write-epoch.js';

const FLUSH_MS = 200;
const ORIGIN = events.sourceId || 'local';
let armed = false;
let timer = null;
let pending = null; // Set<databaseName>

function flush() {
  timer = null;
  const names = pending;
  pending = null;
  if (!names || !names.size) return;
  for (const databaseName of names) {
    try { events.emit('db:write', {databaseName, origin: ORIGIN}, true); } catch { /* قناة غير متاحة */ }
  }
}

/**
 * يُستدعى بعد اعتماد أي معاملة كتابة: يبعث اسم المخزن/القاعدة إلى النوافذ الأخرى.
 * التجميع اختياري ومحدود بـ FLUSH_MS — الكتابة الفعلية لا تنتظر الشبكة ولا الرسائل.
 */
export function notifyWritesAcrossTabs(context) {
  const databaseName = context?.profile?.databaseName;
  if (!databaseName) return;
  try {
    arm();
    if (!pending) pending = new Set();
    pending.add(databaseName);
    if (!timer) timer = setTimeout(flush, FLUSH_MS);
  } catch { /* لا شيء يُفشل العملية من أجل إبطال كاش */ }
}

/** الاشتراك مرة واحدة في إيصالات النوافذ الأخرى. */
export function armWriteBroadcast() { arm(); }

function arm() {
  if (armed) return;
  armed = true;
  events.on('db:write', payload => {
    if (!payload || payload.origin === ORIGIN) return; // صدى إرسالنا المحلي
    bumpGlobalEpoch();
  });
}

/** للاختبارات: إعادة ضبط حالة الوحدة. */
export function _resetWriteBroadcastForTests() {
  armed = false;
  if (timer) { clearTimeout(timer); timer = null; }
  pending = null;
}
