// =====================================================================
// مكدّس الطبقات العلوية — لزر الرجوع في Android
// ---------------------------------------------------------------------
// لا يبني أي واجهة: يسجّل الطبقات المفتوحة (نافذة، طبقة مكدسة، لوحة أوامر،
// لوحة التنقل على الهاتف، درج تفاصيل العمل، قائمة جدول) مع دالة إغلاقها،
// فيعرف زر الرجوع ماذا يُغلق بالترتيب الصحيح (الأحدث أولًا) بدل أن يخرج من
// التطبيق أو يفقد الصفحة.
// التكامل: كل وحدة تفتح طبقة تنادي open() وتحفظ دالة الإفراج المُعادة،
// وتناديها عند الإغلاق. المفتاح وحيد لكل طبقة، وopen() لنفس المفتاح لا
// يضيف نسخة مكررة.
// =====================================================================
const stack = [];
let navigator = null;
let sequence = 0;

/** يُربط مرة واحدة من app.js بمتحكم تاريخ التنقل. */
export function bindOverlayStack(controller) {
  navigator = controller || null;
}

/** تسجيل طبقة مفتوحة. يُعيد دالة إفراج تُنادَى عند إغلاقها من الواجهة. */
export function open(key, closer) {
  const id = String(key);
  const existing = stack.find(entry => entry.key === id);
  if (existing) {
    if (typeof closer === 'function') existing.closer = closer;
    return () => release(id);
  }
  // الطبقة الأولى فقط تضيف مدخل حماية في تاريخ المتصفح؛ الطبقات المكدسة تشترك فيه.
  const wasEmpty = stack.length === 0;
  stack.push({ key: id, closer: typeof closer === 'function' ? closer : () => true, order: ++sequence });
  if (wasEmpty) { try { navigator?.pushGuard?.(); } catch { /* تاريخ غير مدعوم: لا يُعطّل الواجهة */ } }
  return () => release(id);
}

/** إغلاق طبقة من الواجهة، مع تحرير مدخل الحماية إن كانت الأخيرة. */
export function release(key) {
  const index = stack.findIndex(entry => entry.key === String(key));
  if (index < 0) return false;
  stack.splice(index, 1);
  if (!stack.length) { try { navigator?.releaseGuard?.(); } catch { /* متجاهَل */ } }
  return true;
}

export function isOpen() { return stack.length > 0; }
export function size() { return stack.length; }
export function keys() { return stack.map(entry => entry.key); }
export function topKey() { return stack.length ? stack[stack.length - 1].key : null; }

/**
 * إغلاق الطبقة العليا فقط — يُستدعى من زر الرجوع بعد أن يكون المتصفح قد
 * استهلك مدخل الحماية بالفعل (لذلك لا يُحرَّر مدخل هنا).
 */
export function closeTop() {
  let attempts = 0;
  while (stack.length && attempts++ < 8) {
    const entry = stack[stack.length - 1];
    let closed = false;
    try { closed = entry.closer?.() !== false; }
    catch (error) { console.error('overlay close', error); }
    // الطبقة نفسها تقرر متى تُفرَّح من المكدس (طبقة مكدسة قد تبقى بعد إغلاق الأعلى)
    if (closed) return true;
    stack.pop(); // طبقة يتيمة: لا شيء لإغلاقه — تُزال حتى لا تُستهلك ضغطة رجوع بلا أثر
    if (!stack.length) { try { navigator?.releaseGuard?.(); } catch { /* متجاهَل */ } }
  }
  return false;
}

/** وصف الحالة للتشخيص والاختبارات. */
export function snapshot() { return stack.map(entry => ({ key: entry.key, order: entry.order })); }
