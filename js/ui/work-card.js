// =====================================================================
// مركز العمل — بطاقة العنصر الموحّدة (تتكيّف مع النوع) ومساعدات العرض الصافية.
// • اللون وحده ليس إشارة: لكل أولوية وحالة أيقونة ونص ورمز.
// • الملف/الموكل/الخصم/القضية تُقرأ من قارئ العلاقات الموحّد (grid-relations) ولا تُنسخ ولا تُخزَّن.
// • «الخصم: أحمد علي + 2 آخرين» بلا تكرار (القارئ يدمج الأدوار المتعددة لشخص واحد).
// =====================================================================
import {esc} from './dom.js';
import {formatDate} from '../core/format.js';
import {icon as svgIcon} from './icons.js';
import {priorityInfo, statusInfo, classifyDue, daysLate} from '../domain/work-items.js';

const daysWord = n => n === 1 ? 'يوم' : n === 2 ? 'يومان' : n <= 10 ? `${n} أيام` : `${n} يومًا`;

/** «الخصم: X + 2 آخرين» نصًا. items: [{text}] بلا تكرار. */
export function partiesLine(label, items, {max = 1} = {}) {
  const names = (items || []).map(i => i.text).filter(Boolean);
  if (!names.length) return '';
  const rest = names.length - max;
  return `${label}: ${names.slice(0, max).join('، ')}${rest > 0 ? ` + ${rest} ${rest === 1 ? 'آخر' : 'آخرين'}` : ''}`;
}
function partiesHtml(label, items, route) {
  const list = (items || []).filter(i => i.text);
  if (!list.length) return '';
  const first = list[0], rest = list.length - 1;
  const name = first.id && route ? `<button type="button" class="wc-link" data-wc-nav="${esc(route(first))}" title="فتح ${esc(label)}">${esc(first.text)}</button>` : `<span>${esc(first.text)}</span>`;
  return `<span class="wc-party"><span class="wc-k">${esc(label)}:</span> ${name}${rest > 0 ? ` <span class="wc-rest" title="${esc(list.slice(1).map(i => i.text).join('، '))}">+ ${rest} ${rest === 1 ? 'آخر' : 'آخرين'}</span>` : ''}</span>`;
}

export function dueChip(item, today) {
  if (!item.dueDate) return {key: 'undated', text: 'بلا موعد', tone: 'muted'};
  const bucket = classifyDue(item.dueDate, today), time = item.dueTime ? ` ${item.dueTime}` : '';
  if (item.isOpen && bucket === 'overdue') return {key: 'overdue', text: `⚠ متأخر ${daysWord(daysLate(item.dueDate, today))}`, tone: 'danger'};
  if (bucket === 'today') return {key: 'today', text: `اليوم${time}`, tone: 'info'};
  if (bucket === 'tomorrow') return {key: 'tomorrow', text: `غدًا${time}`, tone: 'info'};
  return {key: bucket, text: `${formatDate(item.dueDate)}${time}`, tone: ''};
}

/** اسم أيقونة SVG من مجموعة التطبيق (لا تعتمد على خط إيموجي) أو رمز نصي بسيط. */
const glyph = name => svgIcon(name) || esc(name);
export const chip = (text, {tone = '', icon = '', title = '', cls = ''} = {}) =>
  `<span class="wc-chip${tone ? ` wc-chip--${tone}` : ''}${cls ? ` ${cls}` : ''}"${title ? ` title="${esc(title)}"` : ''}>${icon ? `<span class="wc-ic" aria-hidden="true">${glyph(icon)}</span>` : ''}${esc(text)}</span>`;

export function priorityChip(item, config) {
  const p = priorityInfo(item.priority, config);
  return `<span class="wc-chip wc-pri wc-pri--${esc(p.key)}" style="--wc-c:${esc(p.color)}" title="الأولوية: ${esc(p.label)}"><span class="wc-ic" aria-hidden="true">${esc(p.icon)}</span><b class="wc-mark" aria-hidden="true">${esc(p.mark)}</b>${esc(p.label)}</span>`;
}
export function statusChip(item, config) {
  const s = statusInfo(item.status, config);
  return `<span class="wc-chip wc-st wc-st--${esc(item.status)}" style="--wc-c:${esc(s.color)}" title="الحالة"><span class="wc-ic" aria-hidden="true">${esc(s.icon)}</span>${esc(item.statusLabel || s.label)}</span>`;
}
export function chipsHtml(item, {config, today}) {
  const due = dueChip(item, today), out = [];
  out.push(chip(item.typeLabel || item.sourceLabel, {icon: item.sourceIcon || '•', cls: 'wc-type', title: 'نوع العنصر'}));
  out.push(priorityChip(item, config), statusChip(item, config));
  out.push(chip(due.text, {tone: due.tone, title: item.dueDate ? `الموعد: ${formatDate(item.dueDate)}` : 'لا موعد'}));
  if (item.postponeCount) out.push(chip(`أُجّل ${item.postponeCount}×`, {tone: 'warn', icon: '↷', title: item.originalDueDate ? `الموعد الأصلي: ${formatDate(item.originalDueDate)}` : 'تأجيلات'}));
  if (item.isPinned) out.push(chip('مثبّت', {icon: 'pin'}));
  if (item.archivedAt) out.push(chip('مؤرشف', {tone: 'muted', icon: 'inbox'}));
  if (!item.sourceAvailable) out.push(chip('المصدر غير متاح حاليًا', {tone: 'danger', icon: '⚠'}));
  if (item.isVirtual) out.push(chip('متكرر', {icon: '↻'}));
  if (item.overlay?.commentCount || item.raw?.commentCount) out.push(chip(String(item.overlay?.commentCount || item.raw?.commentCount), {icon: 'note', title: 'تعليقات'}));
  for (const tag of (item.tags || []).slice(0, 3)) out.push(chip(`#${tag}`, {cls: 'wc-tag'}));
  return out.join('');
}

/** سطر السياق من العلاقات (الملف/الموكل/الخصم/القضية): قراءة حيّة، لا نسخ. */
export function contextHtml(item, relations) {
  if (!relations) return '';
  const files = relations.items(item, 'legalFile'), clients = relations.items(item, 'client'), opponents = relations.items(item, 'opponent');
  const model = relations.model(item), stage = model?.stage;
  const caseNo = relations.officialNumber(item);
  const parts = [];
  if (files.length) parts.push(`<span class="wc-party"><span class="wc-k">الملف:</span> <button type="button" class="wc-link" data-wc-nav="file:${esc(files[0].id)}">${esc(files[0].text)}</button>${files.length > 1 ? ` <span class="wc-rest">+ ${files.length - 1}</span>` : ''}</span>`);
  if (caseNo && stage?.id) parts.push(`<span class="wc-party"><span class="wc-k">القضية:</span> <button type="button" class="wc-link" data-wc-nav="case:${esc(stage.id)}">${esc(caseNo)}</button></span>`);
  const c = partiesHtml('الموكل', clients, p => `client:${p.id}`); if (c) parts.push(c);
  const o = partiesHtml('الخصم', opponents, p => `opponent:${p.id}`); if (o) parts.push(o);
  const court = item.raw?.court || stage?.courtId;
  if (court && item.sourceType === 'hearings') parts.push(`<span class="wc-party"><span class="wc-k">المحكمة:</span> <span>${esc(court)}</span></span>`);
  return parts.join('<span class="wc-sep" aria-hidden="true">·</span>');
}

/** وصف نصي كامل للقارئ الشاشي. */
export const ariaOf = (item, today) => `${item.typeLabel || item.sourceLabel}: ${item.title}. ${dueChip(item, today).text}. ${item.statusLabel}.`;

export function workCardHtml(item, {relations = null, config, today, drag = false, move = false, compact = false, quadrantMove = false, selected = false} = {}) {
  const canToggle = item.isDone ? Boolean(item.caps?.reopen) : Boolean(item.caps?.complete);
  const edge = priorityInfo(item.priority, config).color;
  return `<article style="--wc-c:${esc(edge)}" class="wc-card${item.isDone ? ' is-done' : ''}${item.isCancelled ? ' is-cancelled' : ''}${item.archivedAt ? ' is-archived' : ''}${compact ? ' is-compact' : ''}${!item.sourceAvailable ? ' is-orphan' : ''}${selected ? ' is-selected' : ''}" data-wc-id="${esc(item.id)}" data-priority="${esc(item.priority)}" data-status="${esc(item.status)}" data-source="${esc(item.sourceType)}"${drag ? ' draggable="true"' : ''} tabindex="0" aria-label="${esc(ariaOf(item, today))}">
  <div class="wc-card-row">
   <input type="checkbox" class="wc-check" data-wc-act="toggle" ${item.isDone ? 'checked' : ''} ${canToggle ? '' : 'disabled'} aria-label="${item.isDone ? 'إعادة فتح' : 'إنجاز'}: ${esc(item.title)}">
   <div class="wc-card-body">
    <button type="button" class="wc-title" data-wc-act="open" title="فتح العمل">${esc(item.title)}</button>
    ${item.subtitle && !compact ? `<div class="wc-sub">${esc(item.subtitle)}</div>` : ''}
    <div class="wc-chips">${chipsHtml(item, {config, today})}</div>
    ${compact ? '' : `<div class="wc-ctx">${contextHtml(item, relations)}</div>`}
   </div>
   <div class="wc-card-tools">
    <button type="button" class="ghost small wc-open" data-wc-act="open">فتح العمل</button>
    <button type="button" class="ghost small icon-only wc-more" data-wc-act="more" aria-haspopup="dialog" aria-label="إجراءات: ${esc(item.title)}" title="المزيد">⋯</button>
   </div>
  </div>
  ${move ? `<label class="wc-move"><span class="sr-only">نقل إلى</span><select data-wc-move aria-label="نقل إلى عمود آخر"></select></label>` : ''}
  ${quadrantMove ? `<label class="wc-move"><span class="sr-only">تصنيف المصفوفة</span><select data-wc-quad aria-label="نقل إلى ربع آخر"></select></label>` : ''}
 </article>`;
}

/** رأس مجموعة (تاريخ/أولوية/…): عنوان + عدّاد. */
export const groupHeaderHtml = (title, count, {more = false, id = ''} = {}) =>
  `<h4 class="wc-group-h"${id ? ` id="${esc(id)}"` : ''}><span>${esc(title)}</span><span class="wc-count" aria-label="${count} عنصر">${count}${more ? '+' : ''}</span></h4>`;
