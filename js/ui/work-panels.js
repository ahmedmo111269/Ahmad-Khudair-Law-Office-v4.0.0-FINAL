// =====================================================================
// مركز العمل — اللوحات التحليلية والحوارات: «يحتاج انتباهي»، الإنتاجية، المراجعة اليومية/الأسبوعية، العروض المحفوظة، الإعدادات.
// وصفية فقط (لا تقييم أداء ولا حساب مواعيد قانونية)، وكل التخصيص عبر prefs والقوائم الموجودة.
// =====================================================================
import {esc} from './dom.js';
import {modal, closeModal, confirmBox} from './modal.js';
import {toast} from './toast.js';
import {card, cardEmpty, statusBadge} from './card.js';
import {formatDate} from '../core/format.js';
import {normalizeError, userError} from '../core/errors.js';
import {mergePriorities, mergeStatuses} from '../domain/work-items.js';
import {allWorkSources} from '../domain/work-sources.js';
import {ATTENTION_RULES, attentionItems, productivity, dailyReview, weeklyReview, buildSuggestions} from '../services/work-insights.js';
import {getWorkConfig, saveWorkConfig, resetWorkConfig, listWorkViews, saveWorkView, removeWorkView, sanitizeWorkState} from '../services/work-config.js';
import * as C from '../services/work-items.js';
import {createCustomStatus, renameCustomStatus, removeCustomStatus} from '../services/work-statuses.js';
import {chip} from './work-card.js';
import {openLinkedTaskForm} from './work-actions.js';

// ---------- يحتاج انتباهي ----------
export async function renderAttention(rt) {
  const {host} = rt, config = rt.config();
  const data = await attentionItems(rt.office, {today: rt.today(), signal: rt.signal});
  await rt.relations.hydrate(data.rows.map(r => r.item), {signal: rt.signal});
  data.rows.forEach(r => rt.register(r.item));
  const rows = data.rows.map(({item, reasons, severity}) => `<div class="wc-attn">${rt.html(item)}<div class="wc-reasons" role="list">${reasons.map(r => `<span role="listitem">${chip(`${r.label}: ${r.text}`, {tone: severity >= 3 ? 'danger' : 'warn', icon: '❗'})}</span>`).join('')}</div></div>`).join('');
  const stale = data.files.length ? card({title: 'ملفات بلا نشاط منذ مدة', size: 'full', collapsible: true, collapsed: false, persistKey: 'wc:attention:stale', pageId: 'actionCenter', badge: statusBadge(String(data.files.length), 'info'),
    body: `<ul class="wc-stale">${data.files.map(({file, idleDays}) => `<li><button type="button" class="wc-link" data-wc-nav="file:${esc(file.id)}">${esc(file.title || file.fileNumber)}</button><span class="muted"> — بلا نشاط منذ ${idleDays} يومًا</span><button type="button" class="ghost small" data-wc-stale-task="${esc(file.id)}">+ مهمة</button></li>`).join('')}</ul>`}) : '';
  const rulesPanel = card({title: 'قواعد «يحتاج انتباهي»', size: 'full', collapsible: true, collapsed: true, persistKey: 'wc:attention:rules', pageId: 'actionCenter',
    body: `<ul class="wc-rules">${ATTENTION_RULES.map(r => `<li><b>${esc(r.label)}</b><span class="muted"> — ${config.attention.rules[r.key] === false ? 'معطّلة' : 'مفعّلة'}</span></li>`).join('')}</ul><p class="muted small">تُضبط من «⚙ الإعدادات». القواعد مجرد عدّ وقرب مواعيد مسجّلة؛ لا تحسب مواعيد قانونية.</p>`});
  host.innerHTML = `${data.rows.length ? `<p class="muted small">${data.total} عنصرًا يستحق انتباهك${data.capped ? ' (نتائج جزئية)' : ''}، الأشدّ أولًا.</p><div class="wc-attn-list">${rows}</div>` : cardEmpty('لا شيء يحتاج انتباهك الآن.', {icon: 'check'})}${stale}${rulesPanel}`;
  host.querySelectorAll('[data-wc-stale-task]').forEach(b => b.onclick = () => openLinkedTaskForm(rt.app, 'files', b.dataset.wcStaleTask, {onSaved: async () => { toast('تمت إضافة المهمة'); await rt.reload(); }}));
}

// ---------- الإنتاجية (وصفية فقط) ----------
export async function renderProductivity(rt) {
  const {host} = rt;
  const data = await productivity(rt.office, {today: rt.today(), days: 14, signal: rt.signal});
  const max = Math.max(1, ...data.series.map(d => d.count));
  const s = data.summary;
  host.innerHTML = `<p class="muted small">أرقام وصفية للإنجاز في آخر ${data.days} يومًا. ليست تقييمًا للأداء.</p>
   <div class="wc-prod-cards"><div class="wc-kpi"><b>${data.total}</b><span>أُنجز خلال ${data.days} يومًا</span></div><div class="wc-kpi"><b>${data.average}</b><span>متوسط يومي</span></div><div class="wc-kpi"><b>${s.overdue}</b><span>متأخر الآن</span></div><div class="wc-kpi"><b>${s.postponed}</b><span>مؤجل الآن</span></div><div class="wc-kpi"><b>${s.inProgress}</b><span>قيد التنفيذ</span></div></div>
   <figure class="wc-bars" aria-label="الإنجاز اليومي"><div class="wc-bars-grid">${data.series.map(d => `<div class="wc-bar" title="${esc(formatDate(d.date))}: ${d.count}"><span class="wc-bar-fill" style="height:${Math.round((d.count / max) * 100)}%"></span><b>${d.count}</b><small>${esc(d.date.slice(8))}</small></div>`).join('')}</div><figcaption class="muted small">عدد العناصر المنجزة في كل يوم (اليوم الأخير = اليوم)</figcaption></figure>
   ${Object.keys(data.bySource).length ? `<h4 class="wc-group-h"><span>المنجز حسب النوع</span></h4><ul class="wc-by-source">${Object.entries(data.bySource).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<li><span>${esc(k)}</span><b>${n}</b></li>`).join('')}</ul>` : ''}
   ${data.capped ? '<p class="notice">عدد المنجز كبير؛ المعروض جزئي.</p>' : ''}`;
}

// ---------- المراجعات ----------
const miniList = (items, today) => items.length ? `<ul class="wc-mini">${items.slice(0, 25).map(i => `<li><button type="button" class="wc-link" data-open="${esc(i.id)}">${esc(i.title)}</button> ${chip(i.dueDate ? formatDate(i.dueDate) + (i.dueTime ? ' ' + i.dueTime : '') : 'بلا موعد', {})}${chip(i.sourceLabel, {})}</li>`).join('')}${items.length > 25 ? `<li class="muted">… و${items.length - 25} آخر</li>` : ''}</ul>` : '<p class="muted">لا شيء.</p>';

export async function openDailyReview(rt) {
  let data;
  try { data = await dailyReview(rt.office, {today: rt.today()}); } catch (error) { return toast(userError(normalizeError(error)), 'error'); }
  const tomorrowHearings = data.tomorrow.filter(i => i.sourceType === 'hearings');
  const box = modal(`<h2 class="modal-title">مراجعة نهاية اليوم</h2>
   <div class="wc-review">
    <section><h3>✓ أُنجز اليوم <span class="wc-count">${data.done.length}</span></h3>${miniList(data.done, rt.today())}</section>
    <section><h3>◔ لم يُنجز بعد <span class="wc-count">${data.openToday.length}</span></h3>${miniList(data.openToday, rt.today())}
      ${data.carryOver.length ? `<button type="button" class="primary small" data-carry>ترحيل ${data.carryOver.length} عنصرًا إلى غدًا</button><p class="muted small">الجلسات لا تُرحَّل جماعيًا؛ تُؤجَّل رسميًا من سجل كل جلسة.</p>` : ''}</section>
    <section><h3>غدًا <span class="wc-count">${data.tomorrow.length}</span></h3>${tomorrowHearings.length ? `<p><b>${tomorrowHearings.length}</b> جلسة غدًا — راجع تجهيزها.</p>` : ''}${miniList(data.tomorrow, rt.today())}</section>
    <section><h3>⚠ متأخر <span class="wc-count">${data.overdue.length}${data.overdueMore ? '+' : ''}</span></h3>${data.overdue.length ? '<button type="button" class="ghost small" data-goto-overdue>عرض المتأخر</button>' : '<p class="muted">لا متأخر.</p>'}</section>
   </div>`);
  box.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { closeModal(); rt.openItem(b.dataset.open); });
  box.querySelector('[data-goto-overdue]')?.addEventListener('click', () => { closeModal(); rt.setState({range: 'overdue', view: 'cards'}); });
  box.querySelector('[data-carry]')?.addEventListener('click', async () => {
    if (!(await confirmBox(`ترحيل ${data.carryOver.length} عنصرًا غير منجز إلى غدًا؟ يُحفظ الموعد الأصلي ويزيد عدّاد التأجيل لكل عنصر.`, {okText: 'ترحيل إلى غدًا'}))) return;
    const out = await C.bulkApply(rt.office, data.carryOver, 'postpone', {option: 'tomorrow', reason: 'ترحيل في مراجعة نهاية اليوم'});
    toast(`تم ترحيل ${out.done.length}${out.failed.length ? ` — تعذّر ${out.failed.length}` : ''}`, out.failed.length ? 'warn' : 'ok');
    await rt.onChanged({action: 'bulk'});
  });
  return box;
}

export async function openWeeklyReview(rt) {
  let data;
  try { data = await weeklyReview(rt.office, {today: rt.today()}); } catch (error) { return toast(userError(normalizeError(error)), 'error'); }
  const days = [...data.nextByDay].sort((a, b) => a[0].localeCompare(b[0]));
  const box = modal(`<h2 class="modal-title">مراجعة الأسبوع</h2>
   <div class="wc-review">
    <section><h3>✓ أُنجز هذا الأسبوع <span class="wc-count">${data.done.length}</span></h3>${miniList(data.done, rt.today())}</section>
    <section><h3>⚠ متأخر <span class="wc-count">${data.overdue.length}${data.overdueMore ? '+' : ''}</span></h3>${miniList(data.overdue, rt.today())}</section>
    <section><h3>↷ أُجّل مرتين فأكثر <span class="wc-count">${data.postponed.length}</span></h3>${miniList(data.postponed, rt.today())}</section>
    <section><h3>الأسبوع القادم <span class="wc-count">${data.next.length}</span></h3>${days.length ? `<ul class="wc-mini">${days.map(([d, n]) => `<li>${esc(formatDate(d))}: <b>${n}</b></li>`).join('')}</ul>` : '<p class="muted">لا شيء مجدول.</p>'}${data.nextHearings.length ? `<h4>الجلسات (${data.nextHearings.length})</h4>${miniList(data.nextHearings, rt.today())}` : ''}</section>
    <section><h3>ملفات بلا نشاط <span class="wc-count">${data.stale.length}</span></h3>${data.stale.length ? `<ul class="wc-mini">${data.stale.map(({file, idleDays}) => `<li><button type="button" class="wc-link" data-nav="file:${esc(file.id)}">${esc(file.title || file.fileNumber)}</button> <span class="muted">${idleDays} يومًا</span></li>`).join('')}</ul>` : '<p class="muted">لا شيء.</p>'}</section>
   </div>`);
  box.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { closeModal(); rt.openItem(b.dataset.open); });
  box.querySelectorAll('[data-nav]').forEach(b => b.onclick = () => { closeModal(); rt.app.go(b.dataset.nav); });
  return box;
}

// ---------- الإشعارات داخل التطبيق (غير مزعجة: قليلة، قابلة للإغلاق لليوم) ----------
const DISMISS_KEY = day => `ui:wc-notify-dismissed:${day}`;
export async function notificationsHtml(rt, summary) {
  const config = rt.config();
  if (!config.notifications.enabled) return '';
  const {prefs} = await import('../core/preferences.js');
  const dismissed = new Set(prefs.get(DISMISS_KEY(rt.today()), []) || []);
  const list = buildSuggestions(summary, {staleCount: summary.staleCount || 0}).filter(s => !dismissed.has(s.key)).slice(0, config.notifications.maxVisible);
  if (!list.length) return '';
  return `<div class="wc-notify" role="region" aria-label="تنبيهات مركز العمل">${list.map(s => `<div class="wc-note wc-note--${s.tone}" role="status"><span>${esc(s.text)}</span><span class="wc-note-act">${s.action ? `<button type="button" class="link" data-wc-suggest='${esc(JSON.stringify(s.action))}'>عرض</button>` : ''}<button type="button" class="link" data-wc-dismiss="${esc(s.key)}" aria-label="إخفاء التنبيه لليوم">✕</button></span></div>`).join('')}</div>`;
}
export async function dismissNotification(rt, key) {
  const {prefs} = await import('../core/preferences.js');
  const k = DISMISS_KEY(rt.today()), cur = new Set(prefs.get(k, []) || []);
  cur.add(key); await prefs.set(k, [...cur]);
}

// ---------- العروض المحفوظة ----------
export function openSavedViews(rt) {
  const draw = () => {
    const views = listWorkViews();
    const box = modal(`<h2 class="modal-title">العروض المحفوظة</h2>
     ${views.length ? `<ul class="wc-saved">${views.map(v => `<li data-vid="${esc(v.id)}"><button type="button" class="wc-link" data-apply>${esc(v.name)}</button><small class="muted">${esc(v.state.range)} · ${esc(v.state.view)}</small><span><button type="button" class="link" data-rename>إعادة تسمية</button><button type="button" class="link" data-remove>حذف</button></span></li>`).join('')}</ul>` : '<p class="muted">لا عروض محفوظة بعد.</p>'}
     <form data-save-view class="wc-save-view"><label>حفظ العرض الحالي باسم<input name="name" maxlength="60" required placeholder="مثال: جلسات الأسبوع العاجلة"></label><button class="primary" type="submit">حفظ</button></form>`);
    box.querySelectorAll('[data-vid]').forEach(li => {
      const id = li.dataset.vid, view = views.find(v => v.id === id);
      li.querySelector('[data-apply]').onclick = () => { closeModal(); rt.setState({...view.state}); toast(`تم تطبيق العرض «${view.name}»`); };
      li.querySelector('[data-remove]').onclick = async () => { await removeWorkView(id); draw(); };
      li.querySelector('[data-rename]').onclick = async () => { const r = await confirmBox('اسم العرض الجديد:', {okText: 'حفظ', input: true, label: 'الاسم', value: view.name}); if (r.ok && r.value.trim()) await saveWorkView(r.value, view.state, id); draw(); };
    });
    box.querySelector('[data-save-view]').addEventListener('submit', async e => {
      e.preventDefault();
      try { await saveWorkView(e.currentTarget.name.value, sanitizeWorkState({...rt.st, filters: rt.st.filters})); toast('تم حفظ العرض'); draw(); }
      catch (error) { toast(error.message || 'تعذر الحفظ', 'error'); }
    });
  };
  draw();
}

// ---------- الإعدادات ----------
export function openWorkSettings(rt) {
  const config = getWorkConfig();
  const pr = mergePriorities(config), st = mergeStatuses(config);
  const row = (kind, item) => `<div class="wc-set-row"><span class="wc-set-ic" aria-hidden="true">${esc(item.icon)}</span><label><span class="sr-only">تسمية ${esc(item.key)}</span><input data-${kind}-label="${esc(item.key)}" value="${esc(item.label)}" maxlength="30"></label><label><span class="sr-only">لون ${esc(item.label)}</span><input type="color" data-${kind}-color="${esc(item.key)}" value="${esc(item.color)}"></label></div>`;
  const box = modal(`<h2 class="modal-title">إعدادات مركز العمل</h2>
   <form class="wc-settings" novalidate>
    <details open data-collapse-ignore><summary>مستويات الأولوية (التسمية واللون — الرمز والأيقونة ثابتان)</summary>${pr.map(p => row('pri', p)).join('')}</details>
    <details data-collapse-ignore><summary>الحالات (التسمية واللون)</summary>${st.filter(s => !s.custom).map(s => row('st', s)).join('')}
      <div class="wc-custom-st"><h4>حالات مخصصة</h4>
       <p class="muted small">حالات عمل «مفتوحة» تُضاف إلى الأساسية (الإنجاز والإلغاء حالتان أساسيتان). تُحفظ في قاعدة المكتب وتُدار أيضًا من الإعدادات ← القوائم ← «حالات المهام المخصصة»؛ واللون تخصيص عرض لهذا الجهاز.</p>
       <div id="wc-custom-list"></div>
       <div class="wc-set-row"><input data-new-st-label placeholder="اسم حالة جديدة" maxlength="30" aria-label="اسم حالة جديدة"><input type="color" data-new-st-color value="#475569" aria-label="لون الحالة"><button type="button" class="ghost small" data-add-custom>إضافة</button></div></div></details>
    <details data-collapse-ignore><summary>المصادر المعروضة في مركز العمل</summary>${allWorkSources().map(s => `<label class="wc-check-row"><input type="checkbox" data-source="${esc(s.type)}" ${(config.sources[s.type] ?? s.defaultEnabled) ? 'checked' : ''}> ${esc(s.icon)} ${esc(s.label)}${Number.isFinite(s.lookbackDays) ? ` <small class="muted">— المتأخر حتى <input type="number" min="7" max="3650" data-lookback="${esc(s.type)}" value="${config.lookback[s.type] ?? s.lookbackDays}" aria-label="عمق المتأخر بالأيام"> يومًا</small>` : ''}</label>`).join('')}<p class="muted small">المهام المستقلة تظهر دائمًا. الأنواع والوسوم وأسباب التأجيل والحالات المخصصة تُدار من الإعدادات ← القوائم.</p></details>
    <details data-collapse-ignore><summary>القواعد الذكية والإشعارات</summary>${ATTENTION_RULES.map(r => `<label class="wc-check-row"><input type="checkbox" data-rule="${esc(r.key)}" ${config.attention.rules[r.key] === false ? '' : 'checked'}> ${esc(r.label)}</label>`).join('')}
      <label>ملف «بلا نشاط» بعد (يومًا)<input type="number" min="7" max="730" data-stale value="${config.staleFileDays}"></label>
      <label>خلال كم يومًا يُعدّ العنصر عاجلًا<input type="number" min="0" max="14" data-urgent value="${config.urgentWithinDays}"></label>
      <label>أيام «القادم»<input type="number" min="3" max="60" data-upcoming value="${config.upcomingDays}"></label>
      <label>إظهار إشارة «تحضير الغد» بعد<input type="time" data-tomorrow-prep value="${esc(config.tomorrowPrepAfter)}"></label>
      <label class="wc-check-row"><input type="checkbox" data-notify ${config.notifications.enabled ? 'checked' : ''}> إظهار تنبيهات مركز العمل (قليلة وقابلة للإخفاء)</label>
      <label>أقصى عدد تنبيهات ظاهرة<input type="number" min="1" max="6" data-notify-max value="${config.notifications.maxVisible}"></label></details>
    <div class="form-actions"><button class="primary" type="submit">حفظ الإعدادات</button><button class="ghost" type="button" data-reset>استعادة الافتراضي</button><button class="ghost" type="button" data-layout>⚙ ترتيب الأقسام وعرض الصفحة</button></div>
   </form>`);
  // ---------- الحالات المخصصة: نموذج في الذاكرة يُطبَّق على Lookups عند «حفظ الإعدادات» ----------
  const colorOf = key => st.find(s => s.key === key)?.color || '#475569';
  const customs = (config.customStatuses || []).map(s => ({id: s.id, key: s.key, label: s.label, orig: s.label, color: colorOf(s.key), isNew: false, removed: false}));
  const customRow = (m, i) => m.removed ? '' : `<div class="wc-set-row" data-cs="${i}"><span class="wc-set-ic" aria-hidden="true">●</span><label><span class="sr-only">تسمية الحالة المخصصة</span><input data-cs-label="${i}" value="${esc(m.label)}" maxlength="30"></label><label><span class="sr-only">لون ${esc(m.label)}</span><input type="color" data-cs-color="${i}" value="${esc(m.color)}"></label>${m.isNew ? '<small class="muted">(جديدة)</small>' : ''}<button type="button" class="link" data-cs-del="${i}">حذف</button></div>`;
  const redrawCustom = () => { box.querySelector('#wc-custom-list').innerHTML = customs.map(customRow).join('') || '<p class="muted small">لا حالات مخصصة.</p>'; };
  redrawCustom();
  box.addEventListener('input', e => {
    const label = e.target.closest?.('[data-cs-label]'), color = e.target.closest?.('[data-cs-color]');
    if (label) customs[Number(label.dataset.csLabel)].label = label.value;
    if (color) customs[Number(color.dataset.csColor)].color = color.value;
  });
  box.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches?.('[data-new-st-label]')) { e.preventDefault(); box.querySelector('[data-add-custom]').click(); } });   // Enter يضيف الحالة ولا يحفظ النموذج كله
  box.addEventListener('click', e => {
    const del = e.target.closest('[data-cs-del]');
    if (del) {
      const i = Number(del.dataset.csDel);
      if (customs[i].isNew) customs.splice(i, 1); else customs[i].removed = true;
      redrawCustom();
      return;
    }
    if (e.target.closest('[data-add-custom]')) {
      const input = box.querySelector('[data-new-st-label]'), label = input.value.trim();
      if (!label) return toast('اكتب اسم الحالة.', 'error');
      customs.push({id: null, key: null, label, orig: label, color: box.querySelector('[data-new-st-color]').value, isNew: true, removed: false});
      input.value = ''; redrawCustom();
    }
  });
  /** تطبيق تغييرات الحالات المخصصة على Lookups بالترتيب (حذف ← إعادة تسمية ← إنشاء)؛ كل خطوة ناجحة تُثبَّت في النموذج فتُستأنف بلا تكرار إن فشلت إحداها. */
  const applyCustomStatuses = async () => {
    for (const m of [...customs]) if (m.removed && !m.isNew) { await removeCustomStatus(rt.office, m.id); customs.splice(customs.indexOf(m), 1); }
    for (const m of customs) if (!m.isNew && m.label.trim() !== m.orig) { await renameCustomStatus(rt.office, m.id, m.label); m.orig = m.label.trim(); }
    for (const m of customs) if (m.isNew) { const made = await createCustomStatus(rt.office, m.label); Object.assign(m, {id: made.id, key: made.key, orig: made.label, label: made.label, isNew: false}); }
    return Object.fromEntries(customs.map(m => [m.key, {color: m.color}]));
  };
  box.querySelector('[data-reset]').onclick = async () => { if (await confirmBox('استعادة كل إعدادات مركز العمل الافتراضية (التسميات والألوان والمصادر والقواعد)؟ لا يتأثر أي سجل، وتبقى الحالات المخصصة في قاعدة المكتب.', {okText: 'استعادة'})) { await resetWorkConfig(); await rt.onSettingsChanged(); toast('تمت الاستعادة'); } };
  box.querySelector('[data-layout]').onclick = () => { closeModal(); rt.openLayout(); };
  box.querySelector('form').addEventListener('submit', async e => {
    e.preventDefault();
    const q = sel => box.querySelectorAll(sel);
    const priorities = {}, statuses = {}, sources = {}, lookback = {}, rules = {};
    q('[data-pri-label]').forEach(i => { priorities[i.dataset.priLabel] = {label: i.value, color: box.querySelector(`[data-pri-color="${i.dataset.priLabel}"]`).value}; });
    q('[data-st-label]').forEach(i => { statuses[i.dataset.stLabel] = {label: i.value, color: box.querySelector(`[data-st-color="${i.dataset.stLabel}"]`).value}; });
    q('[data-source]').forEach(i => { sources[i.dataset.source] = i.checked; });
    q('[data-lookback]').forEach(i => { lookback[i.dataset.lookback] = Number(i.value); });
    q('[data-rule]').forEach(i => { rules[i.dataset.rule] = i.checked; });
    let customColors = {};
    try { customColors = await applyCustomStatuses(); }
    catch (error) { redrawCustom(); return toast(userError(normalizeError(error)) || 'تعذر حفظ الحالات المخصصة', 'error'); }
    await saveWorkConfig({priorities, statuses: {...statuses, ...customColors}, sources, lookback, attention: {rules},
      staleFileDays: Number(box.querySelector('[data-stale]').value), urgentWithinDays: Number(box.querySelector('[data-urgent]').value), upcomingDays: Number(box.querySelector('[data-upcoming]').value),
      tomorrowPrepAfter: box.querySelector('[data-tomorrow-prep]').value,
      notifications: {enabled: box.querySelector('[data-notify]').checked, maxVisible: Number(box.querySelector('[data-notify-max]').value)}});
    closeModal(); toast('تم حفظ إعدادات مركز العمل'); await rt.onSettingsChanged();
  });
  return box;
}
