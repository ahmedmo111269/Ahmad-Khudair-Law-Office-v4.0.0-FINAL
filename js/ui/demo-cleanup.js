// =====================================================================
// زر «حذف كل البيانات التجريبية» — مسار واحد للواجهات كلها
// ---------------------------------------------------------------------
// يُستخدم في: لافتة لوحة الرئيسية، ولوحة «البيانات التجريبية» في الإعدادات،
// ولوحة الأوامر (Ctrl+K). المسار: فحص (قراءة فقط) ← تأكيد صريح بالأعداد ←
// حذف داخل معاملة واحدة عبر services/demo-data.js ← تحديث الواجهة.
// لا يمس أي سجل غير مرتبط بالبيانات التجريبية (راجع demo-data.js).
// =====================================================================
import {esc} from './dom.js';
import {toast} from './toast.js';
import {confirmBox} from './modal.js';
import {userError} from '../core/errors.js';
import {scanDemoData, removeDemoData, demoScanSummary} from '../services/demo-data.js';

/** ينفّذ المسح الكامل بعد تأكيد المستخدم. يعيد نتيجة العملية أو null عند الإلغاء. */
export async function startDemoCleanup(app, {statusEl = null, onDone = null} = {}) {
  const say = text => { if (statusEl) statusEl.textContent = text; };
  try {
    say('جارٍ فحص البيانات التجريبية…');
    const scan = await scanDemoData(app.office);
    if (!scan.total) {
      say('لا توجد بيانات تجريبية محمّلة الآن.');
      toast('لا توجد بيانات تجريبية لحذفها');
      return null;
    }
    const details = Object.entries(scan.byStore)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 6)
      .map(([store, info]) => `${esc(store)}: ${info.total}`)
      .join(' · ');
    const ok = await confirmBox(
      `سيُحذف <b>كل</b> ما زرعته الأزرار التجريبية في قاعدة البيانات النشطة <b>${esc(app.registry?.active?.displayName || '')}</b>:<br>${esc(demoScanSummary(scan))}.<br><small class="muted">يشمل ذلك كل سجل مرتبط بها (جلسات · أعمال · أحكام · أتعاب · إعلانات · ملاحظات · تنفيذ · مركز عمل · أطراف). الحذف منطقي ومُسجَّل في سجل النشاط، ولا يمس أي سجل حقيقي، ولا القوالب والقوائم والإعدادات وترقيم الملفات.</small><br><small class="muted">${details}</small>`,
      {okText: 'حذف البيانات التجريبية'}
    );
    if (!ok) { say(demoScanSummary(scan)); return null; }

    say('جارٍ الحذف… لا تُغلق الصفحة');
    const out = await removeDemoData(app.office, {
      reason: 'حذف البيانات التجريبية بواسطة المستخدم',
      onProgress: info => say(`جارٍ الحذف… ${info.done} من ${info.total}${info.store ? ` (${info.store})` : ''}`)
    });
    const summary = `تم حذف ${out.removed} سجلًا تجريبيًا${out.related ? ` (منها ${out.related} سجلًا مرتبطًا)` : ''}`;
    say(summary);
    toast(summary, 'ok', {duration: 6000});
    await onDone?.(out);
    return out;
  } catch (error) {
    say('تعذر إتمام الحذف — لم يُغيَّر أي سجل.');
    toast(userError(error), 'error');
    return null;
  }
}

/** يربط أزرار `[data-demo-cleanup]` الموجودة في الصفحة الحالية. */
export function bindDemoCleanup(app, {statusEl = null, onDone = null} = {}) {
  const buttons = document.querySelectorAll('[data-demo-cleanup]');
  buttons.forEach(button => {
    button.addEventListener('click', async () => {
      if (button.disabled) return;
      button.disabled = true;
      try {
        await startDemoCleanup(app, {statusEl, onDone});
      } finally {
        button.disabled = false;
      }
    });
  });
  return buttons.length;
}

/** تحديث عدّاد البيانات التجريبية المعروض في أي عنصر `[data-demo-count]`. */
export async function refreshDemoCount(app, {selector = '[data-demo-count]'} = {}) {
  const targets = [...document.querySelectorAll(selector)];
  if (!targets.length) return null;
  try {
    const scan = await scanDemoData(app.office);
    const text = demoScanSummary(scan);
    for (const el of targets) el.textContent = text;
    return scan;
  } catch {
    for (const el of targets) el.textContent = 'تعذر فحص البيانات التجريبية.';
    return null;
  }
}
