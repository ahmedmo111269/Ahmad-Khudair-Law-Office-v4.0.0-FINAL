// =====================================================================
// إضافات بطاقة التنفيذ المستقلة (كل واحدة قابلة للتعطيل وحدها)
// ---------------------------------------------------------------------
// 1) وضع «الحساب السريع» : شريط sticky أعلى البطاقة، النتيجة في مكانها بلا نافذة.
// 2) ملاحظات سريعة        : مربع دائم أسفل الملخص + آخر 3 ملاحظات (تشغيلية فقط).
// 3) اختصارات Alt         : Alt+1..6 وAlt+H + لوحة (؟) داخل بطاقة التنفيذ.
// 4) وضع مبسّط / متقدّم    : uiMode = 'simple' | 'advanced' في ترويسة البطاقة.
// لا نظام حسابي موازٍ: الحساب السريع يستدعي `horizonPreview` نفسه.
// =====================================================================
import {esc} from './dom.js';
import {modal} from './modal.js';
import {toast} from './toast.js';
import {localDate} from '../core/clock.js';
import {userError} from '../core/errors.js';
import {isCivilDate} from '../domain/execution-calendar.js';
import {fromMinorUnits} from '../domain/execution-money.js';
import * as S from '../services/execution-simple.js';
import {horizonPreview, anchorOf, horizonShortcuts} from './execution-horizon-picker.js';
import {normalizeUiMode} from '../services/execution-settings.js';

const grouped = (minor, currency = 'EGP') => fromMinorUnits(Number(minor || 0), currency)
  .toLocaleString('en-US', {maximumFractionDigits: 2});
const display = iso => (isCivilDate(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');

/* ======================= 1) وضع الحساب السريع ======================= */
export function quickCalcMarkup({asOf = '', anchor = null, enabled = true} = {}) {
  if (!enabled) return '';
  const shortcuts = anchor ? horizonShortcuts({anchor}).slice(0, 4) : [];
  return `<div class="exec-quickcalc" data-quickcalc dir="rtl">
    <label class="qc-field">احسب حتى:
      <input type="date" data-quickcalc-date value="${esc(isCivilDate(asOf) ? asOf : localDate())}" aria-label="احسب حتى تاريخ">
    </label>
    <div class="quick-chips">${shortcuts.map(item => `<button type="button" class="chip" data-quickcalc-set="${esc(item.date)}" title="${esc(item.hint || '')}">${esc(item.label)}</button>`).join('')}</div>
    <output class="qc-result" data-quickcalc-result aria-live="polite">اختر تاريخًا ليظهر الحساب في مكانه — بلا أي نافذة.</output>
  </div>`;
}

/**
 * يربط شريط الحساب السريع. debounce 250ms، والنتيجة تُكتب في مكانها.
 * `onApplied(asOf)` يُستدعى عند الضغط على «اعتمد هذا التاريخ» (اختياري).
 */
export function bindQuickCalc(container, {office, executionId, getAnchor = () => null, onApplied = null} = {}) {
  const host = container?.querySelector('[data-quickcalc]');
  if (!host) return () => {};
  const input = host.querySelector('[data-quickcalc-date]');
  const output = host.querySelector('[data-quickcalc-result]');
  let timer = 0, seq = 0;
  const compute = async () => {
    const asOf = input?.value || '';
    if (!isCivilDate(asOf)) { if (output) output.textContent = 'تاريخ غير صحيح.'; return; }
    const my = ++seq;
    if (output) output.textContent = 'جارٍ الحساب…';
    try {
      const preview = await horizonPreview(office, executionId, {asOf, allowFuture: true});
      if (my !== seq || !host.isConnected) return;
      const currency = preview.currency;
      if (output) {
        output.innerHTML = `<b>${preview.periodCount} فترات</b> · المطلوب <b>${grouped(preview.dueMinor, currency)}</b> · المحصّل <b>${grouped(preview.paidMinor, currency)}</b> · المتبقي <b>${grouped(preview.remainingMinor, currency)}</b> · <span class="muted">(${esc(preview.equation)})</span>
          ${preview.isFuture ? `<span class="badge warn">تقديري — ${esc(preview.futureNote || 'فترات لم تُستحق بعد')}</span>` : ''}
          ${preview.horizonCapped ? `<span class="badge danger">أفق مقصوص: ${esc(display(preview.effectiveAsOf))}</span>` : ''}
          ${typeof onApplied === 'function' ? `<button type="button" class="link" data-quickcalc-apply>اعتمد هذا التاريخ على البطاقة</button>` : ''}`;
        output.querySelector('[data-quickcalc-apply]')?.addEventListener('click', () => onApplied(asOf));
      }
    } catch (error) {
      if (my === seq && output) output.textContent = userError(error);
    }
  };
  const schedule = () => { clearTimeout(timer); timer = setTimeout(() => { compute().catch(() => {}); }, 250); };
  input?.addEventListener('input', schedule);
  input?.addEventListener('change', schedule);
  host.querySelectorAll('[data-quickcalc-set]').forEach(button => button.addEventListener('click', () => {
    if (input) input.value = button.dataset.quickcalcSet;
    clearTimeout(timer);
    compute().catch(() => {});
  }));
  compute().catch(() => {});
  return () => { clearTimeout(timer); seq += 1; };
}

/* ======================= 2) ملاحظات سريعة ======================= */
/**
 * مربع ملاحظات دائم أسفل الملخص + آخر 3 ملاحظات.
 * تشغيلية فقط: لا علاقة لها بالحكم ولا بالإجراء ولا بأي رقم في الحساب.
 */
export function quickNotesMarkup(notes = []) {
  const rows = (notes || []).slice(0, 3).map(note => `<li class="qn-row">
      <span class="qn-body">${esc(String(note.body || note.text || '').slice(0, 220))}</span>
      <small class="muted">${esc(display(String(note.updatedAt || note.createdAt || '').slice(0, 10)))}</small>
    </li>`).join('');
  return `<section class="panel exec-quicknotes" data-section-id="quickNotes" aria-label="ملاحظات سريعة">
    <div class="panel-head"><h3>📝 ملاحظات سريعة</h3>
      <span class="muted small">تشغيلية فقط — لا علاقة لها بالحكم أو الإجراء ولا تدخل أي حساب.</span></div>
    <form class="simple-form" data-form="exec-quicknote">
      <label class="field span2"><textarea name="body" rows="2" placeholder="اكتب ملاحظة متابعة سريعة… (Ctrl+Enter للحفظ)" aria-label="نص الملاحظة"></textarea></label>
      <div class="form-actions"><button type="submit" class="ghost small" data-save>حفظ الملاحظة</button></div>
    </form>
    ${rows ? `<ul class="plain-list qn-list" data-quicknotes-list>${rows}</ul>` : '<p class="muted small" data-quicknotes-list>لا ملاحظات بعد.</p>'}
  </section>`;
}

/** يقرأ آخر 3 ملاحظات مرتبطة بالتنفيذ (من نظام الملاحظات السريعة القائم). */
export async function loadExecutionNotes(office, executionId, {limit = 3} = {}) {
  try {
    const QN = await import('../services/quick-notes.js');
    const rows = await QN.notesForEntity(office, 'EXECUTION', executionId, {limit: Math.max(limit, 1) * 3});
    return (rows || [])
      .filter(note => !note.isDeleted && !note.isArchived)
      .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')))
      .slice(0, limit);
  } catch { return []; }
}

export function bindQuickNotes(container, {app, executionId, onSaved = null} = {}) {
  const form = container?.querySelector('[data-form="exec-quicknote"]');
  if (!form) return () => {};
  const submit = async () => {
    const field = form.querySelector('[name="body"]');
    const body = String(field?.value || '').trim();
    if (!body) { toast('اكتب نص الملاحظة', 'error'); return; }
    const button = form.querySelector('[data-save]');
    if (button) button.disabled = true;
    try {
      await S.recordSimpleNote(app.office, {executionId, body, title: 'ملاحظة تنفيذ'});
      if (field) field.value = '';
      toast('حُفظت الملاحظة السريعة', 'ok');
      if (typeof onSaved === 'function') await onSaved();
    } catch (error) { toast(userError(error), 'error'); }
    finally { if (button) button.disabled = false; }
  };
  form.addEventListener('submit', event => { event.preventDefault(); submit().catch(() => {}); });
  form.querySelector('[name="body"]')?.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); submit().catch(() => {}); }
  });
  return () => {};
}

/* ======================= 3) اختصارات Alt ======================= */
export const EXECUTION_SHORTCUTS = Object.freeze([
  {keys: 'Alt + 1', id: 'collection', label: 'محضر تحصيل'},
  {keys: 'Alt + 2', id: 'action', label: 'تسجيل إجراء'},
  {keys: 'Alt + 3', id: 'expense', label: 'تسجيل مصروف / رسم'},
  {keys: 'Alt + 4', id: 'poa', label: 'توكيل جديد'},
  {keys: 'Alt + 5', id: 'duration', label: 'احسب مدة'},
  {keys: 'Alt + 6', id: 'print', label: 'طباعة كشف / توكيل'},
  {keys: 'Alt + H', id: 'horizon', label: 'تغيير تاريخ «المطلوب حتى»'},
  {keys: '؟', id: 'help', label: 'هذه اللوحة'}
]);

/**
 * يثبّت معالج اختصارات بطاقة التنفيذ. يُعلن نفسه على `window.__execCardShortcuts`
 * لأن اختصارات Alt+1..9 العامة في التطبيق مسجَّلة قبل البطاقة (ترتيب المستمعين)،
 * فلا يمكن اعتراضها إلا بتفويض صريح من هناك.
 * Alt بدل Ctrl عمدًا: Ctrl+رقم محجوز للمتصفح (تبديل التبويبات).
 */
export function installExecutionShortcuts({root, handlers = {}, executionId = ''} = {}) {
  const run = id => {
    const fn = handlers[id];
    if (typeof fn !== 'function') { toast('هذا الإجراء غير متاح هنا', 'info'); return true; }
    try { const out = fn(); if (out && typeof out.catch === 'function') out.catch(() => {}); } catch { /* لا يُسقط الاختصار */ }
    return true;
  };
  const typing = target => /INPUT|TEXTAREA|SELECT/.test(target?.tagName || '') || Boolean(target?.isContentEditable);
  const modalOpen = () => Boolean(document.querySelector('#modal-root .modal-card'));
  const handler = {
    executionId,
    /** يعيد true إن استهلكت البطاقة الاختصار (يُستدعى من اختصارات التطبيق العامة). */
    handle(event) {
      if (!event?.altKey || event.ctrlKey || event.metaKey) return false;
      if (modalOpen() || typing(event.target)) return false;
      if (!root || !root.isConnected) return false;
      const key = String(event.key || '').toLowerCase();
      const map = {1: 'collection', 2: 'action', 3: 'expense', 4: 'poa', 5: 'duration', 6: 'print'};
      const id = map[key];
      if (!id) return false;
      event.preventDefault();
      event.stopPropagation();
      return run(id);
    },
    /** Alt+H و ؟ داخل البطاقة. */
    handleKey(event) {
      if (modalOpen() || typing(event.target)) return false;
      if (!root || !root.isConnected) return false;
      if (event.altKey && !event.ctrlKey && !event.metaKey && String(event.key || '').toLowerCase() === 'h') {
        event.preventDefault(); return run('horizon');
      }
      if (!event.altKey && !event.ctrlKey && !event.metaKey && event.key === '?') {
        event.preventDefault(); showExecutionShortcutsPanel(); return true;
      }
      return false;
    }
  };
  const onKeydown = event => { handler.handleKey(event); };
  document.addEventListener('keydown', onKeydown);
  const previous = typeof window !== 'undefined' ? window.__execCardShortcuts : null;
  if (typeof window !== 'undefined') window.__execCardShortcuts = handler;
  return () => {
    document.removeEventListener('keydown', onKeydown);
    if (typeof window !== 'undefined' && window.__execCardShortcuts === handler) window.__execCardShortcuts = previous || null;
  };
}

export function showExecutionShortcutsPanel() {
  return modal(`<h2 class="modal-title">⌨ اختصارات بطاقة التنفيذ</h2>
    <p class="muted small">بـ<b>Alt</b> لا Ctrl — لأن Ctrl+رقم محجوز للمتصفح (تبديل التبويبات).</p>
    <div class="kbd-help">${EXECUTION_SHORTCUTS.map(item => `<div class="kbd-row"><kbd>${esc(item.keys)}</kbd><span>${esc(item.label)}</span></div>`).join('')}</div>
    <p class="muted small">الاختصارات تعمل خارج حقول الإدخال وخارج أي نافذة مفتوحة.</p>
    <div class="form-actions"><button type="button" class="ghost" data-close>إغلاق</button></div>`);
}

/* ======================= 4) وضع مبسّط / متقدّم ======================= */
export const UI_MODE_KEY = 'ui:exec:uiMode:v1';

/** الوضع الفعلي: المحفوظ على التنفيذ ← المحفوظ العام ← إعدادات المكتب ← simple. */
export function effectiveUiMode({executionId = '', settings = null} = {}) {
  try {
    const local = executionId ? localStorage.getItem(`akl:prefs:${UI_MODE_KEY}:${executionId}`) : null;
    if (local) return normalizeUiMode(JSON.parse(local), 'simple');
  } catch { /* تجاهل */ }
  return normalizeUiMode(settings?.uiMode, 'simple');
}

export async function toggleUiMode({executionId = '', settings = null, office = null} = {}) {
  const next = effectiveUiMode({executionId, settings}) === 'simple' ? 'advanced' : 'simple';
  try {
    if (executionId) localStorage.setItem(`akl:prefs:${UI_MODE_KEY}:${executionId}`, JSON.stringify(next));
    const {prefs} = await import('../core/preferences.js');
    await prefs.set(`${UI_MODE_KEY}:${executionId || 'global'}`, next);
    if (office && next !== normalizeUiMode(settings?.uiMode, 'simple')) {
      const {saveExecutionSettings} = await import('../services/execution-settings.js');
      await saveExecutionSettings(office, {uiMode: next});
    }
  } catch (error) { console.info('uiMode toggle failed', error); }
  return next;
}

/** ما يُخفيه الوضع المبسّط: الأدوات المتقدمة، الـLedger، الفروق، المحاكاة، المقارنة، اعتراف FEAS. */
export const SIMPLE_MODE_HIDDEN = Object.freeze([
  'advanced', 'enable-feas', 'feas-obligation', 'feas-recognize', 'settlement',
  'snapshot', 'compare', 'simulate', 'print-balance'
]);

export function applyUiMode(root, uiMode) {
  if (!root) return;
  const simple = normalizeUiMode(uiMode, 'simple') !== 'advanced';
  root.classList.toggle('exec-mode-simple', simple);
  root.classList.toggle('exec-mode-advanced', !simple);
  root.querySelectorAll('[data-advanced-only]').forEach(node => { node.hidden = simple; });
  root.querySelectorAll('.advanced-anchor').forEach(node => { node.hidden = simple; });
  root.querySelectorAll('[data-uimode-toggle]').forEach(button => {
    button.textContent = simple ? 'مبسّط' : 'متقدّم';
    button.setAttribute('aria-pressed', String(simple));
    button.title = simple ? 'العرض المبسّط — اضغط للعرض المتقدّم' : 'العرض المتقدّم — اضغط للتبسيط';
  });
}

export const executionExtrasHelpers = Object.freeze({grouped, display, anchorOf});
