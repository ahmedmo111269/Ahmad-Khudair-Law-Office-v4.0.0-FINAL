// =====================================================================
// مركز العمل — مجلّد «فتح العمل» (Drawer): تفاصيل + روابط ذكية + بيانات المصدر + تعليقات + مهام مرتبطة + سجل.
// أقسامه قابلة للطي عبر نظام الطي الموحّد (collapse-state) فتُحفظ تفضيلاتها. يبقى مستقلًا عن نوافذ modal()
// حتى تُفتح فوقه حوارات التأجيل/التعديل دون فقدان مكانه. كل البيانات القانونية تُقرأ حيًّا من أصلها.
// =====================================================================
import {esc} from './dom.js';
import {confirmBox} from './modal.js';
import {toast} from './toast.js';
import {enhanceCollapsiblePanels} from './collapsible.js';
import {formatDate, formatDateTime} from '../core/format.js';
import {Clock} from '../core/clock.js';
import {ENTITIES, displayValue} from '../domain/entities.js';
import {COMMENT_TYPES, SOURCE_LABELS, statusInfo, priorityInfo} from '../domain/work-items.js';
import {getWorkConfig} from '../services/work-config.js';
import {getWorkItem, queryWorkItems} from '../services/work-query.js';
import {resolveRefs} from '../services/entity-query.js';
import * as C from '../services/work-items.js';
import {normalizeError, userError} from '../core/errors.js';
import {chipsHtml, contextHtml, workCardHtml} from './work-card.js';
import {runAction, openActionSheet} from './work-actions.js';

const commentLabel = Object.fromEntries(COMMENT_TYPES);
const ACTION_LABEL = {create: 'إنشاء', update: 'تحديث', complete: 'إنجاز', reopen: 'إعادة فتح', cancel: 'إلغاء', postpone: 'تأجيل', reschedule: 'إعادة جدولة', status: 'تغيير حالة', priority: 'تغيير أولوية', pin: 'تثبيت', unpin: 'إلغاء تثبيت', tags: 'وسوم', comment: 'تعليق', archive: 'أرشفة', restore: 'استعادة', delete: 'حذف', quadrant: 'مصفوفة'};

const section = (key, title, body, {open = false, badge = ''} = {}) =>
  `<section class="panel wc-dsec" data-collapse-key="wc:drawer:${key}" data-collapse-default="${open ? 'open' : 'collapsed'}" data-section="${key}"><div class="panel-head"><h3>${esc(title)}</h3>${badge ? `<span class="badge">${esc(badge)}</span>` : ''}</div>${body}</section>`;
const dl = rows => `<dl class="wc-dl">${rows.filter(Boolean).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join('')}</dl>`;

function smartLinks(item, relations) {
  const links = [];
  const add = (label, route, text) => { if (route && text) links.push(`<button type="button" class="ghost wc-nav" data-wc-nav="${esc(route)}"><small>${esc(label)}</small><b>${esc(text)}</b></button>`); };
  const files = relations.items(item, 'legalFile'), clients = relations.items(item, 'client'), opponents = relations.items(item, 'opponent');
  for (const f of files.slice(0, 3)) add('الملف', `file:${f.id}`, f.text);
  const stage = relations.model(item)?.stage;
  if (stage?.id) add('القضية / المرحلة', `case:${stage.id}`, relations.officialNumber(item) || stage.stageType || 'القضية');
  for (const c of clients.slice(0, 5)) add('الموكل', `client:${c.id}`, c.text);
  for (const o of opponents.slice(0, 5)) add('الخصم', `opponent:${o.id}`, o.text);
  if (item.route) add(`السجل الأصلي — ${item.sourceLabel}`, item.route, 'فتح السجل');
  if (item.kind === 'native' && item.relatedType && item.relatedId) {
    const route = item.relatedType === 'files' ? `file:${item.relatedId}` : `rec:${item.relatedType}:${item.relatedId}`;
    add(`مرتبط بـ ${ENTITIES[item.relatedType]?.label || SOURCE_LABELS[item.relatedType] || ''}`, route, 'فتح السجل المرتبط');
  }
  if (item.sourceType === 'hearings' && item.raw?.previousHearingId) add('الجلسة السابقة', `rec:hearings:${item.raw.previousHearingId}`, 'جلسة سابقة في السلسلة');
  return links.length ? `<div class="wc-links">${links.join('')}</div>` : '<p class="muted">لا روابط متاحة لهذا العنصر.</p>';
}

async function sourceData(office, item) {
  const ent = ENTITIES[item.sourceType];
  if (!ent || !item.raw || item.kind === 'native') return '';
  const fields = ent.fields.filter(f => f.t !== 'readonly' || f.grid).filter(f => f.grid || f.k === 'notes').slice(0, 14);
  const refs = await resolveRefs(office, [item.raw], fields).catch(() => new Map());
  const rows = fields.map(f => { const v = displayValue(f, item.raw, refs); return v ? [f.l, esc(v)] : null; });
  return rows.some(Boolean) ? dl(rows) : '<p class="muted">لا بيانات إضافية.</p>';
}

function commentsHtml(list) {
  if (!list.length) return '<p class="muted wc-empty">لا تعليقات بعد.</p>';
  return `<ul class="wc-comments">${list.map(c => `<li data-cid="${esc(c.id)}"><div class="wc-c-head"><span class="wc-chip">${esc(commentLabel[c.type] || 'ملاحظة')}</span><time datetime="${esc(c.createdAt)}">${esc(formatDateTime(c.createdAt))}</time><span class="wc-c-tools"><button type="button" class="link" data-c-edit>تعديل</button><button type="button" class="link" data-c-del>حذف</button></span></div><p>${esc(c.body)}</p></li>`).join('')}</ul>`;
}
function historyHtml(list) {
  if (!list.length) return '<p class="muted">لا سجل بعد.</p>';
  return `<ol class="wc-history">${list.map(h => `<li><time datetime="${esc(h.timestamp)}">${esc(formatDateTime(h.timestamp))}</time><span>${esc(h.summary || ACTION_LABEL[h.action] || h.action)}</span><small class="muted">${esc(h.entityType === 'workItems' ? 'مركز العمل' : (ENTITIES[h.entityType]?.label || h.entityType))}</small></li>`).join('')}</ol>`;
}

let opener = null, keysBound = false;
export function closeWorkDrawer(root) {
  const host = root || document.querySelector('#wc-drawer-root');
  if (host) { host.innerHTML = ''; host.hidden = true; }
  try { if (opener && document.contains(opener)) opener.focus({preventScroll: true}); } catch { /* العنصر لم يعد موجودًا */ }
  opener = null;
  document.dispatchEvent(new CustomEvent('wc:drawer-closed'));
}
/** Esc يغلق المجلّد ولو فُقد التركيز، وTab يدور داخله (نافذة modal). يتجاهل الحوارات المفتوحة فوقه. */
function bindDrawerKeys() {
  if (keysBound) return;
  keysBound = true;
  document.addEventListener('keydown', e => {
    const host = document.querySelector('#wc-drawer-root');
    if (!host || host.hidden || document.querySelector('#modal-root .modal-card') || document.querySelector('.dg-pop,.dg-ctx')) return;
    if (e.key === 'Escape') { e.stopPropagation(); closeWorkDrawer(host); return; }
    if (e.key !== 'Tab') return;
    const items = [...host.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter(el => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items.at(-1);
    if (e.shiftKey && (document.activeElement === first || !host.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || !host.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
  }, true);
}

/**
 * wc = {app, office, relations, onChanged(change)}. يعيد true إن فُتح.
 */
export async function openWorkDrawer(wc, id) {
  const host = document.querySelector('#wc-drawer-root');
  if (!host) return false;
  const {office} = wc, config = getWorkConfig(), today = Clock.today();
  bindDrawerKeys();
  if (host.hidden || !opener) opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const prevScroll = host.querySelector('.wc-drawer')?.scrollTop || 0;   // إعادة الرسم بعد تعليق/تثبيت لا تقفز بالمستخدم لأعلى
  host.hidden = false;
  host.innerHTML = '<div class="wc-drawer-backdrop" data-wc-close></div><aside class="wc-drawer" role="dialog" aria-modal="true" aria-label="تفاصيل العمل" tabindex="-1"><div class="skel skel-line w70"></div><div class="skel skel-line w90"></div></aside>';
  let item;
  try { item = await getWorkItem(office, id, {config}); } catch (error) { toast(userError(normalizeError(error)), 'error'); closeWorkDrawer(host); return false; }
  const panel = host.querySelector('.wc-drawer');
  if (!item) {
    panel.innerHTML = '<header class="wc-drawer-head"><h3>العنصر غير موجود</h3><button type="button" class="ghost" data-wc-close>إغلاق</button></header><p class="muted">ربما حُذف أو انتقل. لم يتغير أي سجل أصلي.</p>';
    host.querySelectorAll('[data-wc-close]').forEach(b => b.onclick = () => closeWorkDrawer(host));
    return false;
  }
  await wc.relations.hydrate([item]);
  const [comments, history, linked, source] = await Promise.all([
    C.listComments(office, item.id, {limit: 50}).catch(() => []),
    C.itemHistory(office, item, {limit: 40}).catch(() => []),
    queryWorkItems(office, {range: 'all', kinds: ['open', 'done', 'cancelled'], relatedId: item.kind === 'native' ? '' : item.sourceId}, {limit: 30}).then(r => r.items.filter(i => i.kind === 'native' && i.id !== item.id)).catch(() => []),
    sourceData(office, item)
  ]);
  if (linked.length) await wc.relations.hydrate(linked);
  const primary = [];
  if (item.isDone || item.isCancelled) { if (item.caps.reopen) primary.push(['reopen', 'إعادة فتح']); }
  else { if (item.caps.complete) primary.push(['complete', '✓ إنجاز']); if (item.caps.postpone) primary.push(['snooze', item.sourceType === 'hearings' ? '↷ تأجيل رسمي' : '↷ تأجيل']); if (item.caps.reschedule) primary.push(['reschedule', '⇄ إعادة جدولة']); }
  const st = statusInfo(item.status, config), pr = priorityInfo(item.priority, config);
  const description = item.kind === 'native' ? (item.description ? `<p class="wc-desc">${esc(item.description)}</p>` : '<p class="muted">لا وصف.</p>') : '';
  panel.innerHTML = `
   <header class="wc-drawer-head">
    <div class="wc-dh-main"><small class="muted">${esc(item.sourceLabel)}</small><h3 id="wc-drawer-title">${esc(item.title)}</h3><div class="wc-chips">${chipsHtml(item, {config, today})}</div><div class="wc-ctx">${contextHtml(item, wc.relations)}</div></div>
    <button type="button" class="ghost" data-wc-close aria-label="إغلاق التفاصيل">✕</button>
   </header>
   <div class="wc-drawer-actions">${primary.map(([k, l]) => `<button type="button" class="${k === 'complete' ? 'primary' : 'ghost'}" data-dact="${k}">${esc(l)}</button>`).join('')}${item.route ? '<button type="button" class="ghost" data-dact="source">↗ فتح المصدر</button>' : ''}<button type="button" class="ghost" data-dact="more" aria-haspopup="dialog">⋯ المزيد</button></div>
   <div class="wc-drawer-body">
    ${section('details', 'التفاصيل', dl([
      ['النوع', esc(item.typeLabel || item.sourceLabel)], ['الحالة', esc(item.statusLabel || st.label)], ['الأولوية', `${esc(pr.icon)} ${esc(pr.label)} (${esc(pr.mark)})`],
      ['الموعد', item.dueDate ? `${esc(formatDate(item.dueDate))}${item.dueTime ? ' — ' + esc(item.dueTime) : ''}` : 'بلا موعد'],
      item.originalDueDate && item.originalDueDate !== item.dueDate ? ['الموعد الأصلي', esc(formatDate(item.originalDueDate))] : null,
      item.postponeCount ? ['عدد التأجيلات', String(item.postponeCount)] : null,
      item.tags.length ? ['الوسوم', item.tags.map(t => `<span class="wc-chip wc-tag">#${esc(t)}</span>`).join(' ')] : null,
      item.completedAt ? ['اكتمل في', esc(formatDateTime(item.completedAt))] : null,
      item.isVirtual ? ['التكرار', 'عنصر متكرر لم يُنشأ بعد؛ يُنشأ عند أول تفاعل'] : null
    ]) + description, {open: true})}
    ${section('links', 'الروابط الذكية', smartLinks(item, wc.relations), {open: true})}
    ${source ? section('source', 'بيانات السجل الأصلي (قراءة فقط)', source + '<p class="muted small">تُقرأ حيًّا من السجل الأصلي؛ لتعديلها افتح السجل.</p>') : ''}
    ${section('comments', 'التعليقات والملاحظات', `<div id="wc-comments">${commentsHtml(comments)}</div>
      <form class="wc-comment-form" data-wc-comment-form><label><span class="sr-only">نوع التعليق</span><select name="type" aria-label="نوع التعليق">${COMMENT_TYPES.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select></label><label><span class="sr-only">نص التعليق</span><textarea name="body" rows="2" maxlength="5000" required placeholder="اكتب ملاحظة أو تحديثًا…"></textarea></label><button class="primary small" type="submit">إضافة</button></form>`, {open: true, badge: String(comments.length)})}
    ${section('linked', 'المهام المرتبطة', linked.length ? `<div class="wc-linked">${linked.map(i => workCardHtml(i, {relations: wc.relations, config, today, compact: true})).join('')}</div>` : '<p class="muted">لا مهام مرتبطة.</p>', {badge: String(linked.length)})}
    ${section('history', 'سجل التاريخ', historyHtml(history), {badge: String(history.length)})}
   </div>`;
  enhanceCollapsiblePanels(panel, 'wc-drawer', {bulk: false});
  panel.focus({preventScroll: true});
  panel.scrollTop = prevScroll;
  const reload = async () => { await openWorkDrawer(wc, id); };
  const afterChange = async change => { await wc.onChanged?.(change); if (!change?.deleted) await reload(); else closeWorkDrawer(host); };
  const sub = {...wc, onChanged: afterChange};
  host.querySelectorAll('[data-wc-close]').forEach(b => b.onclick = () => closeWorkDrawer(host));
  panel.querySelectorAll('[data-dact]').forEach(b => b.onclick = () => {
    if (b.dataset.dact === 'more') return openActionSheet(sub, item);
    return runAction(sub, item, b.dataset.dact);
  });
  panel.querySelectorAll('[data-wc-nav]').forEach(b => b.onclick = () => { closeWorkDrawer(host); wc.app.go(b.dataset.wcNav); });
  panel.querySelector('[data-wc-comment-form]')?.addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.currentTarget, body = form.body.value.trim();
    if (!body) return;
    form.querySelector('button').disabled = true;
    try { await C.addComment(office, item, {type: form.type.value, body}); toast('تمت إضافة التعليق'); await afterChange({id: item.id, action: 'comment'}); }
    catch (error) { toast(userError(normalizeError(error)), 'error'); form.querySelector('button').disabled = false; }
  });
  panel.querySelector('#wc-comments')?.addEventListener('click', async e => {
    const li = e.target.closest('[data-cid]');
    if (!li) return;
    const cid = li.dataset.cid, current = comments.find(c => c.id === cid);
    try {
      if (e.target.closest('[data-c-del]')) { if (await confirmBox('حذف هذا التعليق؟ (حذف منطقي)', {okText: 'حذف'})) { await C.removeComment(office, cid); await afterChange({id: item.id, action: 'comment'}); } }
      else if (e.target.closest('[data-c-edit]')) { const r = await confirmBox('تعديل نص التعليق:', {okText: 'حفظ', input: true, label: 'النص', value: current?.body || ''}); if (r.ok && r.value.trim()) { await C.updateComment(office, cid, {type: current.type, body: r.value}); await afterChange({id: item.id, action: 'comment'}); } }
    } catch (error) { toast(userError(normalizeError(error)), 'error'); }
  });
  panel.querySelector('.wc-linked')?.addEventListener('click', e => {
    const card = e.target.closest('[data-wc-id]');
    const nav = e.target.closest('[data-wc-nav]');
    if (nav) { closeWorkDrawer(host); wc.app.go(nav.dataset.wcNav); return; }
    if (card && e.target.closest('[data-wc-act="open"]')) openWorkDrawer(wc, card.dataset.wcId);
  });
  return true;
}

