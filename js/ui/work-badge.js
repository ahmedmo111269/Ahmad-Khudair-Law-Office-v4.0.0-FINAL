// شارة عدّاد «مركز العمل» في الشريط الجانبي — وحدة خفيفة مستقلة.
// لا تستورد شاشة مركز العمل نفسها، فيبقى الانتقال بين الصفحات لا يحمّل الشاشة الثقيلة.
import {workSummary} from '../services/work-query.js';

let badgeTimer = 0, badgeAt = 0;
/** يجدول تحديث الشارة بحدٍّ زمني (مرة كل 30 ثانية ما لم يُجبَر) حتى لا يتحول التنقل إلى استعلامات متكررة. */
export function scheduleWorkBadge(app, {force = false} = {}) {
  if (!force && Date.now() - badgeAt < 30000) return;
  clearTimeout(badgeTimer);
  badgeTimer = setTimeout(() => { badgeAt = Date.now(); refreshWorkBadge(app); }, 400);
}
/** عدّاد شارة «مركز العمل» في الشريط الجانبي: قراءة خفيفة محدودة. */
export async function refreshWorkBadge(app) {
  const btn = document.querySelector('#sidebar [data-route="actionCenter"]');
  if (!btn || !app?.office) return;
  try {
    const s = await workSummary(app.office);
    btn.querySelector('.nav-badge')?.remove();
    const n = s.overdue + s.todayCount;
    if (n) btn.insertAdjacentHTML('beforeend', `<span class="nav-badge"${n > 99 ? ` title="${n}"` : ''}>${n > 99 ? '99+' : n}</span>`);
  } catch (error) { if (error?.name !== 'AbortError') console.error('work badge', error); }
}
