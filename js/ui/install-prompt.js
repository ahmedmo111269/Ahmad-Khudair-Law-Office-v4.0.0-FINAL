// واجهة تثبيت التطبيق: زر التثبيت الرسمي في Android + خطوات بديلة واضحة.
// لا تُخزّن ولا ترسل أي شيء — كل الحالة في الذاكرة أو localStorage فقط.
import {esc} from './dom.js';
import {modal} from './modal.js';
import {toast} from './toast.js';

/** تشغيل نافذة التثبيت الرسمية، وإن لم تتوفر تُعرض الخطوات اليدوية. */
export async function installApp(app) {
  const service = app?.pwaInstall;
  if (!service) { openInstallHelp(); return {outcome: 'unavailable'}; }
  if (service.isInstalled?.()) { toast('التطبيق مثبَّت بالفعل على هذا الجهاز.','ok'); return {outcome: 'installed'}; }
  const result = await service.prompt?.();
  if (result?.outcome === 'unavailable') { openInstallHelp(); return result; }
  if (result?.outcome === 'accepted') toast('تم التثبيت. افتح التطبيق من أيقونته — يعمل بلا إنترنت.','ok',{duration:7000});
  return result;
}

/** خطوات التثبيت اليدوية (لمتصفح لا يتيح النافذة الرسمية أو نسخة أقدم). */
export function openInstallHelp() {
  const steps = ['افتح قائمة المتصفح (⋮) أعلى يسار Chrome.','اختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية».','ثبّت التطبيق، ثم افتحه من أيقونته: يعمل بلا شريط عنوان وبلا إنترنت.'];
  modal(`<h2 class="modal-title">📲 تثبيت التطبيق على الهاتف</h2>
  <p class="muted small">التطبيق يعمل كما هو في المتصفح، والتثبيت يزيد: أيقونة مستقلة، شاشة كاملة بلا شريط عنوان، وفتح أسرع دون إنترنت. لا تُنقل أي بيانات خارج جهازك.</p>
  <ol class="install-steps">${steps.map(step=>`<li>${esc(step)}</li>`).join('')}</ol>
  <p class="muted small">بيانات المكتب محفوظة في التخزين المحلي للمتصفح على هذا الجهاز نفسه؛ أبقِ نسخة احتياطية دورية من صفحة «النسخ الاحتياطي».</p>`);
}
