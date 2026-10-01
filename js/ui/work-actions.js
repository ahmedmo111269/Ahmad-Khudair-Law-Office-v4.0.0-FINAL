// =====================================================================
// مركز العمل — أفعال العنصر وحواراتها (إنجاز/تأجيل/إعادة جدولة/أولوية/حالة/تثبيت/وسوم/أرشفة/حذف/ربط).
// نقطة واحدة تستدعيها البطاقة والمجلّد وكانبان؛ كل الكتابة تمر عبر services/work-items ثم المستودعات.
// الحذف حذف منطقي بتأكيد واضح ولا يُنفَّذ على سجل أصلي. الجلسة تُؤجَّل في سجلها الأصلي لا في طبقة مستقلة.
// =====================================================================
import {modal, closeModal, confirmBox} from './modal.js';
import {toast} from './toast.js';
import {esc} from './dom.js';
import {openEntityForm} from './form.js';
import {normalizeError, userError} from '../core/errors.js';
import {Clock} from '../core/clock.js';
import {formatDate} from '../core/format.js';
import {SNOOZE_OPTIONS, snoozeTarget, isIsoDate, mergePriorities, mergeStatuses, normalizeTags, SOURCE_LABELS, canActOn} from '../domain/work-items.js';
import {getWorkConfig} from '../services/work-config.js';
import {getLookup, saveLookupValue} from '../services/lookups.js';
import * as C from '../services/work-items.js';

const fail = error => toast(userError(normalizeError(error)), 'error');

/** قائمة الأفعال المتاحة لعنصر (تحترم قدرات المصدر). */
export function actionsFor(item) {
  const caps = item.caps || {}, acts = [];
  const add = (key, label, icon, extra = {}) => acts.push({key, label, icon, ...extra});
  if (item.isDone || item.isCancelled) { if (caps.reopen) add('reopen', 'إعادة فتح', '↺'); }
  else {
    if (caps.complete) add('complete', 'إنجاز', '✓');
    if (caps.postpone) add('snooze', item.sourceType === 'hearings' ? 'تأجيل رسمي للجلسة…' : 'تأجيل…', '↷');
    if (caps.reschedule) add('reschedule', 'إعادة جدولة…', '⇄');
    add('status', 'تغيير الحالة…', '◐');
  }
  if (caps.priority) add('priority', 'تغيير الأولوية…', '▲');
  if (caps.pin) add('pin', item.isPinned ? 'إلغاء التثبيت' : 'تثبيت', '⚑');
  if (caps.tags) add('tags', 'الوسوم…', '#');
  if (item.sourceType === 'hearings' && item.sourceAvailable) add('result', 'تسجيل النتيجة / التأجيل في سجل الجلسة', '✎');
  if (caps.edit) add('edit', 'تعديل المهمة…', '✎');
  if (item.route) add('source', 'فتح السجل الأصلي', '↗');
  add('linked', '+ مهمة مرتبطة', '+');
  if (caps.cancel && item.isOpen) add('cancel', 'إلغاء العنصر', '✕', {danger: true});
  if (item.archivedAt) add('restore', 'استعادة من الأرشيف', '↩');
  else if (caps.archive) add('archive', 'أرشفة (قابلة للاستعادة)', '▣');
  if (caps.delete) add('delete', 'حذف المهمة…', '✖', {danger: true});
  return acts.filter(a => canActOn(a.key, item));
}

/** ورقة «المزيد»: كل أفعال العنصر في حوار واحد صالح للهاتف. */
export function openActionSheet(wc, item) {
  const acts = actionsFor(item);
  const card = modal(`<h2 class="modal-title">إجراءات: ${esc(item.title)}</h2>
   <div class="wc-sheet" role="menu">${acts.map(a => `<button type="button" role="menuitem" class="wc-sheet-btn${a.danger ? ' is-danger' : ''}" data-act="${a.key}"><span aria-hidden="true">${esc(a.icon)}</span> ${esc(a.label)}</button>`).join('')}</div>`);
  card.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => { closeModal(); runAction(wc, item, b.dataset.act); }));
  card.querySelector('[data-act]')?.focus();
}

// ---------- الحوارات ----------
function dialog(title, body, {okText = 'تأكيد', okDisabled = false, onMount = null} = {}) {
  return new Promise(resolve => {
    const card = modal(`<h2 class="modal-title">${esc(title)}</h2>${body}<div class="form-actions"><button class="primary" type="button" data-ok ${okDisabled ? 'disabled' : ''}>${esc(okText)}</button><button class="ghost" type="button" data-cancel>إلغاء</button></div>`);
    const done = value => { closeModal(); resolve(value); };
    card.querySelector('[data-cancel]').onclick = () => done(null);
    card.querySelectorAll('[data-close],[data-modal-back],[data-modal-home]').forEach(b => b.addEventListener('click', () => resolve(null)));
    onMount?.(card, done);
  });
}

export async function snoozeDialog(wc, item) {
  const today = Clock.today();
  const reasons = await getLookup(wc.office, 'workItemPostponeReason').catch(() => []);
  const formal = item.sourceType === 'hearings';
  let chosen = null;
  const opts = SNOOZE_OPTIONS.filter(([k]) => k !== 'custom').map(([k, l]) => `<button type="button" class="ghost wc-opt" data-opt="${k}" aria-pressed="false">${esc(l)}<small>${formatDate(snoozeTarget(k, today))}</small></button>`).join('');
  return dialog(formal ? 'تأجيل رسمي للجلسة' : 'تأجيل العنصر', `
    ${formal ? '<p class="notice">سيُسجَّل التأجيل في سجل الجلسة نفسه («التأجيل إلى» + سبب التأجيل) وتُنشأ جلستها التالية تلقائيًا. الجلسة الأصلية لا تُحذف.</p>' : `<p class="muted small">الموعد الأصلي يبقى محفوظًا ويزداد عدّاد التأجيل (${item.postponeCount || 0} حاليًا).</p>`}
    <div class="wc-opts" role="group" aria-label="خيارات التأجيل">${opts}</div>
    <label>أو تاريخ مخصص<input type="date" data-custom min="${today}"></label>
    <label>سبب التأجيل (اختياري)<input data-reason list="wc-reasons" maxlength="200" placeholder="مثال: طلب الموكل"><datalist id="wc-reasons">${reasons.map(r => `<option value="${esc(r)}"></option>`).join('')}</datalist></label>`,
  {okText: formal ? 'تسجيل التأجيل' : 'تأجيل', okDisabled: true, onMount: (card, done) => {
    const ok = card.querySelector('[data-ok]'), custom = card.querySelector('[data-custom]');
    const sync = () => { ok.disabled = !chosen; if (chosen) ok.textContent = `${formal ? 'تسجيل التأجيل' : 'تأجيل'} إلى ${formatDate(chosen.date)}`; };
    card.querySelectorAll('[data-opt]').forEach(b => b.addEventListener('click', () => {
      card.querySelectorAll('[data-opt]').forEach(x => x.setAttribute('aria-pressed', 'false')); b.setAttribute('aria-pressed', 'true');
      custom.value = ''; chosen = {option: b.dataset.opt, date: snoozeTarget(b.dataset.opt, today)}; sync();
    }));
    custom.addEventListener('input', () => {
      card.querySelectorAll('[data-opt]').forEach(x => x.setAttribute('aria-pressed', 'false'));
      chosen = isIsoDate(custom.value) && custom.value >= today ? {option: 'custom', date: custom.value} : null; sync();
    });
    ok.onclick = () => done({...chosen, reason: card.querySelector('[data-reason]').value.trim()});
  }});
}

export function rescheduleDialog(item) {
  return dialog('إعادة جدولة', `<p class="muted small">تعديل الموعد دون احتسابه تأجيلًا.</p>
    <label>التاريخ الجديد<input type="date" data-date value="${esc(item.dueDate || Clock.today())}"></label>
    ${item.kind === 'native' ? `<label>الوقت (اختياري)<input type="time" data-time value="${esc(item.dueTime || '')}"></label>` : ''}`,
  {okText: 'حفظ الموعد', onMount: (card, done) => {
    card.querySelector('[data-ok]').onclick = () => {
      const date = card.querySelector('[data-date]').value;
      if (!isIsoDate(date)) return toast('اختر تاريخًا صحيحًا.', 'error');
      done({date, time: card.querySelector('[data-time]')?.value ?? null});
    };
  }});
}

function choiceDialog(title, rows, current) {
  return new Promise(resolve => {
    const card = modal(`<h2 class="modal-title">${esc(title)}</h2><div class="wc-sheet" role="listbox">${rows.map(r => `<button type="button" role="option" class="wc-sheet-btn${r.key === current ? ' is-current' : ''}" aria-selected="${r.key === current}" data-key="${esc(r.key)}"><span aria-hidden="true">${esc(r.icon)}</span> ${esc(r.label)}${r.key === current ? ' <small>(الحالي)</small>' : ''}</button>`).join('')}</div>`);
    card.querySelectorAll('[data-key]').forEach(b => b.addEventListener('click', () => { closeModal(); resolve(b.dataset.key); }));
    card.querySelectorAll('[data-close],[data-modal-back],[data-modal-home]').forEach(b => b.addEventListener('click', () => resolve(null)));
  });
}
export const priorityDialog = (item, config = getWorkConfig()) => choiceDialog('تغيير الأولوية', mergePriorities(config).map(p => ({key: p.key, icon: p.icon, label: `${p.label} (${p.mark})`})), item.priority);
export const statusDialog = (item, config = getWorkConfig()) => choiceDialog('تغيير الحالة', mergeStatuses(config).map(s => ({key: s.key, icon: s.icon, label: s.label})), item.status);

export async function tagsDialog(wc, item) {
  const known = await getLookup(wc.office, 'workItemTag').catch(() => []);
  return dialog('وسوم العنصر', `<label>الوسوم (افصل بفاصلة)<input data-tags list="wc-tag-list" value="${esc((item.tags || []).join('، '))}" maxlength="400"><datalist id="wc-tag-list">${known.map(t => `<option value="${esc(t)}"></option>`).join('')}</datalist></label>
    <p class="muted small">الوسوم الجديدة تُضاف إلى قائمة «وسوم المهام» في الإعدادات ← القوائم لإعادة استخدامها.</p>`,
  {okText: 'حفظ الوسوم', onMount: (card, done) => { card.querySelector('[data-ok]').onclick = () => done(normalizeTags(card.querySelector('[data-tags]').value)); }})
    .then(async tags => { if (tags) for (const tag of tags) if (!known.includes(tag)) await saveLookupValue(wc.office, 'workItemTag', tag).catch(() => {}); return tags; });
}

/** نموذج «مهمة مرتبطة» (يعيد استخدام نموذج الكيانات العام). المعرّفات فقط تُنسخ؛ الأسماء تُقرأ حيًّا. */
export async function openLinkedTaskForm(app, relatedType, relatedId, {title = '', dueDate = '', onSaved = null} = {}) {
  let preset;
  try { preset = await C.linkedTaskPreset(app.office, relatedType, relatedId); } catch (error) { return fail(error); }
  return openEntityForm(app, 'workItems', {preset: {...preset, ...(title ? {title} : {}), ...(dueDate ? {dueDate} : {})}, title: 'مهمة مرتبطة', onSaved: onSaved || (async row => { toast('تمت إضافة المهمة المرتبطة', 'ok', {action: () => app.go(`actionCenter?item=${encodeURIComponent(row.id)}`), actionLabel: 'فتحها في مركز العمل', duration: 6000}); })});
}

// ---------- منفّذ الأفعال ----------
/**
 * wc = {app, office, onChanged(change)}. يعرض النجاح/الفشل ويستدعي onChanged لتحديث الواجهة بلا إعادة تحميل الصفحة.
 */
export async function runAction(wc, item, action, extra = {}) {
  const {office, app} = wc;
  const config = getWorkConfig();
  const changed = async (change = {}) => { await wc.onChanged?.({id: item.id, action, ...change}); };
  try {
    switch (action) {
      case 'toggle': return runAction(wc, item, item.isDone ? 'reopen' : 'complete', extra);
      case 'complete': {
        await C.completeItem(office, item);
        toast('تم إنجاز العمل', 'ok', {action: () => runAction(wc, {...item, isDone: true}, 'reopen'), actionLabel: 'تراجع', duration: 6000});
        return changed();
      }
      case 'reopen': await C.reopenItem(office, item); toast('أُعيد فتح العمل'); return changed();
      case 'cancel': {
        const r = await confirmBox(`إلغاء «${esc(item.title)}»؟ يبقى العنصر محفوظًا بحالة «ملغى» ويمكن إعادة فتحه.`, {okText: 'إلغاء العنصر', input: true, label: 'سبب الإلغاء (اختياري)'});
        if (!r.ok) return null;
        await C.cancelItem(office, item, {reason: r.value.trim()}); toast('تم إلغاء العنصر'); return changed();
      }
      case 'snooze': {
        const picked = extra.picked || await snoozeDialog(wc, item);
        if (!picked) return null;
        if (item.sourceType === 'hearings') {
          const ok = await confirmBox(`سيُسجَّل تأجيل الجلسة إلى <b>${esc(formatDate(picked.date))}</b> في سجلها وتُنشأ جلسة تالية بهذا التاريخ. متابعة؟`, {okText: 'تسجيل التأجيل'});
          if (!ok) return null;
        }
        const res = await C.postponeItem(office, item, picked);
        toast(`تم التأجيل إلى ${formatDate(res.dueDate || picked.date)}`, 'ok'); return changed({dueDate: picked.date});
      }
      case 'reschedule': {
        const picked = await rescheduleDialog(item);
        if (!picked) return null;
        await C.rescheduleItem(office, item, picked); toast('تم تعديل الموعد'); return changed({dueDate: picked.date});
      }
      case 'priority': {
        const key = extra.key || await priorityDialog(item, config);
        if (!key) return null;
        await C.setItemPriority(office, item, key); toast('تم تغيير الأولوية'); return changed();
      }
      case 'status': {
        const key = extra.key || await statusDialog(item, config);
        if (!key) return null;
        if (key === 'postponed' && !item.isDone) return runAction(wc, item, 'snooze');
        await C.setItemStatus(office, item, key); toast('تم تغيير الحالة'); return changed();
      }
      case 'pin': await C.setPinned(office, item, !item.isPinned); toast(item.isPinned ? 'أُلغي التثبيت' : 'تم التثبيت'); return changed();
      case 'tags': {
        const tags = await tagsDialog(wc, item);
        if (!tags) return null;
        await C.setItemTags(office, item, tags); toast('تم حفظ الوسوم'); return changed();
      }
      case 'archive': await C.archiveItem(office, item); toast('تمت الأرشفة', 'ok', {action: () => runAction(wc, {...item, archivedAt: 'x'}, 'restore'), actionLabel: 'تراجع', duration: 6000}); return changed();
      case 'restore': await C.restoreItem(office, item); toast('تمت الاستعادة'); return changed();
      case 'delete': {
        const ok = await confirmBox(`حذف المهمة «${esc(item.title)}»؟ هذا حذف منطقي لا يمس الملفات أو الجلسات المرتبطة، ويمكنك التراجع الآن.`, {okText: 'حذف المهمة'});
        if (!ok) return null;
        await C.deleteItem(office, item);
        toast('تم حذف المهمة', 'ok', {action: () => C.undoDelete(office, item.id).then(() => changed({restored: true})).catch(fail), actionLabel: 'تراجع', duration: 8000});
        return changed({deleted: true});
      }
      case 'edit': {
        let id = item.id;
        if (item.isVirtual) id = (await C.materializeOccurrence(office, item.recurrenceId, item.occurrenceDate)).id;
        return openEntityForm(app, 'workItems', {id, title: 'تعديل المهمة', onSaved: async () => { await changed(); }});
      }
      case 'source': if (item.route) return app.go(item.route); return null;
      case 'result': return openEntityForm(app, 'hearings', {id: item.sourceId, title: 'تسجيل نتيجة الجلسة / التأجيل', onSaved: async () => { await changed({sourceChanged: true}); }});
      case 'linked': {
        const type = item.kind === 'native' ? 'workItems' : item.sourceType;
        if (type === 'workItems') return openEntityForm(app, 'workItems', {preset: {fileId: item.fileId, caseId: item.caseId, clientId: item.clientId, relatedType: item.relatedType, relatedId: item.relatedId, title: ''}, title: 'مهمة مرتبطة', onSaved: async () => { toast('تمت إضافة المهمة المرتبطة'); await changed({linked: true}); }});
        return openLinkedTaskForm(app, type === 'files' ? 'files' : type, item.sourceId, {onSaved: async () => { toast('تمت إضافة المهمة المرتبطة'); await changed({linked: true}); }});
      }
      default: return null;
    }
  } catch (error) {
    if (error?.name === 'AbortError') return null;
    fail(error);
    return null;
  }
}

export {SOURCE_LABELS};
