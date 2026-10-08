// =====================================================================
// مركز التنفيذ — مكوّنات العرض (HTML فقط، بلا قراءة ولا كتابة)
// ---------------------------------------------------------------------
// كل مكوّن يأخذ عنصر طابور جاهزًا من execution-work.js. الكتابة تمر عبر
// مُعالج الأحداث في modules/execution-center.js ثم خدمات التنفيذ المبسّطة.
// الأنماط: css/exec-workcenter.css — وتستعمل شارات cp-* المشتركة مع «مكتب اليوم».
// =====================================================================
import {esc} from './dom.js';
import {fromMinorUnits} from '../domain/execution-money.js';
import {isCivilDate} from '../domain/execution-calendar.js';
import {SEVERITY_LABEL} from '../services/execution-work.js';

export const ACTION_RESULTS = ['تم تسجيل الإجراء', 'تم', 'لم يتم', 'مؤجل', 'ملغي'];

export const LANES = Object.freeze([
  {key: 'running', label: 'جارٍ', hint: 'مفتوح بلا تأخر'},
  {key: 'overdue', label: 'عليه متأخرات', hint: 'فترة انتهت ولم تُسدد'},
  {key: 'needsFollowUp', label: 'يحتاج متابعة', hint: 'خطوة عاجلة أو قريبة'},
  {key: 'completed', label: 'مكتمل السداد', hint: 'لا متبقٍ'}
]);

const num = value => Number(value || 0).toLocaleString('en-US');
export const money = (minor, currency = 'EGP') => `${fromMinorUnits(minor || 0, currency).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})} ج.م`;
export const moneyWhole = (minor, currency = 'EGP') => fromMinorUnits(minor || 0, currency).toLocaleString('en-US', {maximumFractionDigits: 0});
const majorInput = (minor, currency) => {
  const value = fromMinorUnits(minor || 0, currency);
  return value ? String(Math.round(value * 100) / 100) : '';
};
export const dateText = iso => (isCivilDate(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');
const offsetDate = (today, days) => {
  const d = new Date(`${today}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** نص الاسم الكامل للتنفيذ في الصف والبطاقة: الموكل «ضد» المنفذ ضده. */
export const partiesText = item => `${esc(item.clientName || 'بلا موكل')} <span class="muted">ضد</span> ${esc(item.opponentName || 'بلا منفذ ضده')}`;

/** العدّادات = فلاتر الطابور: الأربعة (تطابق تعريفات countQueue) + شريب «الكل» مستقل. */
export function laneHtml(counts = {}, lane = 'all') {
  const all = `<button type="button" class="wc-lane-all${lane === 'all' ? ' is-active' : ''}" data-lane-all aria-pressed="${lane === 'all'}"><span>كل التنفيذات</span><b>${counts ? num(counts.all) : '…'}</b></button>`;
  const lanes = LANES.map(l => `<button type="button" class="counter wc-lane${lane === l.key ? ' is-active' : ''}" data-count="${l.key}" aria-pressed="${lane === l.key}">
      <b>${counts ? num(counts[l.key]) : '…'}</b>
      <span>${l.label}</span><small class="muted">${l.hint}</small>
    </button>`).join('');
  return all + lanes;
}

/** ماذا ينتظر الآن؟ شريط أرقام واحد: المتأخرات والمتبقي وعدد ما يحتاج قرارًا. */
export function pulseHtml(counts = {}, total = 0) {
  if (!counts) return '';
  const overdue = Number(counts.overdueMinor || 0);
  return `<div class="wc-pulse" aria-label="ملخص الطابور">
    <span class="wc-pulse-item"><b>${num(counts.attention)}</b> <small>يحتاج قرارًا</small></span>
    <span class="wc-pulse-item${overdue ? ' is-alert' : ''}"><b>${overdue ? money(overdue) : '0 ج.م'}</b> <small>متأخرات</small></span>
    <span class="wc-pulse-item"><b>${money(counts.remainingMinor || 0)}</b> <small>إجمالي المتبقي</small></span>
    <span class="wc-pulse-item muted"><b>${num(total)}</b> <small>تنفيذ في الطابور</small></span>
  </div>`;
}

/** شارة الأولوية الموحّدة (نفس ألوان مكتب اليوم). */
export const sevChip = severity => `<span class="cp-chip cp-chip--${severity === 'critical' ? 'danger' : severity === 'high' ? 'warn' : severity === 'normal' ? 'info' : ''}">${esc(SEVERITY_LABEL[severity] || '')}</span>`;

/** البطاقة الكبيرة «الآن»: أول ما يحتاج قرارًا، مع إجراءات السياق و«ثم» لثلاثة بعده. */
export function heroHtml(item, {position = 0, total = 0, next = [], panel = '', caption = 'يحتاج قرارًا'} = {}) {
  if (!item) {
    return `<section class="wc-hero wc-hero--calm" aria-labelledby="wc-hero-title">
      <header class="wc-hero-head"><span class="cp-eyebrow">الآن</span><span class="cp-chip cp-chip--ok">لا عاجل</span></header>
      <h2 id="wc-hero-title">لا شيء يستعجل قرارك الآن</h2>
      <p class="cp-meta">كل التنفيذات المفتوحة مغطّاة بخطوات مجدولة. راجع الجارية، أو أضف تنفيذًا جديدًا.</p>
      <div class="wc-hero-actions"><button type="button" class="primary" data-new-execution>+ تنفيذ جديد</button></div>
    </section>`;
  }
  const primary = item.step.code === 'collect' ? 'collect' : item.step.code === 'value' ? 'value' : 'action';
  return `<section class="wc-hero wc-hero--${esc(item.severity)}" data-hero-id="${esc(item.id)}" aria-labelledby="wc-hero-title">
    <header class="wc-hero-head">
      <span class="cp-eyebrow">الآن · الخطوة التالية</span>
      ${sevChip(item.severity)}
      <span class="wc-pos">${position} من ${total} ${esc(caption)}</span>
    </header>
    <h2 id="wc-hero-title" class="wc-hero-title">${esc(item.displayNumber || 'تنفيذ بلا رقم')} · ${partiesText(item)}</h2>
    <p class="wc-hero-step"><span class="cp-dot cp-dot--${esc(item.severity)}" aria-hidden="true"></span><b>${esc(item.step.label)}</b></p>
    ${item.step.also ? `<p class="cp-meta">${esc(item.step.also)}</p>` : ''}
    <div class="wc-hero-nums">
      <div class="${item.overdueMinor ? 'is-alert' : ''}"><span>متأخر</span><b>${item.overdueMinor ? money(item.overdueMinor, item.currency) : '—'}</b></div>
      <div><span>المدفوع</span><b>${money(item.paidTotal, item.currency)}</b></div>
      <div class="is-primary"><span>المتبقي</span><b>${money(item.remainingTotal, item.currency)}</b></div>
    </div>
    <div class="wc-hero-actions">
      <button type="button" class="primary" data-act="${primary}" data-id="${esc(item.id)}" data-from="hero">${primary === 'collect' ? '💰 سجّل التحصيل' : primary === 'value' ? '⚙ أدخل القيمة' : '📄 سجّل الإجراء'}</button>
      ${primary !== 'action' && item.step.code !== 'paused' && item.step.code !== 'done' ? `<button type="button" class="ghost" data-act="action" data-id="${esc(item.id)}" data-from="hero">📄 سجّل إجراء</button>` : ''}
      <button type="button" class="ghost" data-act="follow" data-id="${esc(item.id)}" data-from="hero">⏰ متابعة لاحقًا</button>
      <button type="button" class="ghost" data-run-start="hero">▶ تشغيل الطابور</button>
      <button type="button" class="ghost" data-open="${esc(item.id)}">↗ البطاقة</button>
    </div>
    ${panel ? `<div class="wc-panel-host" data-panel-host>${panel}</div>` : ''}
    ${next.length ? `<div class="wc-then"><span class="wc-then-label">ثم</span><ol>${next.map(n => `<li><button type="button" data-focus-item="${esc(n.id)}"><span class="cp-dot cp-dot--${esc(n.severity)}" aria-hidden="true"></span><span class="wc-then-title">${esc(n.displayNumber || 'تنفيذ')} — ${esc(n.clientName || '')}</span><small>${esc(n.step.label)}</small></button></li>`).join('')}</ol></div>` : ''}
  </section>`;
}

/** صف واحد في الطابور. الزر الأساسي يتبع الخطوة، والباقي في قائمة «⋯». */
export function rowHtml(item, {selected = false, open = false, panel = '', focusable = true} = {}) {
  const step = item.step;
  const primary = step.code === 'collect' ? {act: 'collect', label: '💰 تحصيل'}
    : step.code === 'value' ? {act: 'value', label: '⚙ القيمة'}
    : step.code === 'done' || step.code === 'paused' ? {act: 'open', label: '↗ فتح'}
    : {act: 'action', label: '📄 إجراء'};
  const fileChip = item.fileNumberText ? `<span class="wc-chip">ملف ${esc(item.fileNumberText)}</span>` : '';
  return `<article class="wc-row wc-row--${esc(item.severity)}${open ? ' is-open' : ''}${selected ? ' is-selected' : ''}" data-row="${esc(item.id)}" data-sev="${esc(item.severity)}" ${focusable ? 'tabindex="0"' : ''} aria-label="${esc(item.displayNumber || 'تنفيذ')} — ${esc(step.label)}">
    <label class="wc-check"><input type="checkbox" data-select="${esc(item.id)}"${selected ? ' checked' : ''} aria-label="تحديد ${esc(item.displayNumber || 'التنفيذ')}"></label>
    <div class="wc-row-main" data-open="${esc(item.id)}" role="link" tabindex="-1">
      <div class="wc-row-top"><b class="wc-num">${esc(item.displayNumber || 'بلا رقم')}</b><span class="wc-parties">${partiesText(item)}</span><span class="wc-status wc-status--${esc(item.statusKey)}">${esc(item.statusLabel || '')}</span></div>
      <div class="wc-row-step"><span class="cp-dot cp-dot--${esc(item.severity)}" aria-hidden="true"></span><span>${esc(step.label)}</span></div>
      <div class="wc-row-meta">${fileChip}${item.executionTypeLabel ? `<span class="wc-chip">${esc(item.executionTypeLabel)}</span>` : ''}${item.lastActionLabel ? `<span class="muted">آخر إجراء: ${esc(item.lastActionLabel)}</span>` : '<span class="muted">لا إجراء مسجّل بعد</span>'}</div>
    </div>
    <div class="wc-row-money"><span>المتبقي</span><b>${money(item.remainingTotal, item.currency)}</b>${item.overdueMinor ? `<small class="is-alert">متأخر ${money(item.overdueMinor, item.currency)}</small>` : `<small class="muted">مسدد ${moneyWhole(item.paidTotal, item.currency)}</small>`}</div>
    <div class="wc-row-actions">
      <button type="button" class="${step.code === 'collect' ? 'primary' : 'ghost'} small" data-act="${primary.act}" data-id="${esc(item.id)}" data-from="row">${primary.label}</button>
      <button type="button" class="ghost small" data-act="menu" data-id="${esc(item.id)}" data-from="row" aria-expanded="${open && panel.includes('wc-menu') ? 'true' : 'false'}" aria-label="أخرى">⋯</button>
    </div>
    ${panel ? `<div class="wc-panel-host" data-panel-host>${panel}</div>` : ''}
  </article>`;
}

export function sectionHtml(id, title, hint, rows, {collapsed = false, tone = ''} = {}) {
  if (!rows.length) return '';
  return `<details class="wc-sec wc-sec--${id}${tone ? ' ' + tone : ''}" data-sec="${id}" data-collapse-default="${collapsed ? 'collapsed' : 'open'}"${collapsed ? '' : ' open'}>
    <summary><span class="wc-sec-title">${esc(title)}</span><span class="wc-sec-count">${rows.length}</span><small class="muted">${esc(hint)}</small></summary>
    <div class="wc-sec-body">${rows.join('')}</div>
  </details>`;
}

export function emptyQueueHtml(hasAny, lane) {
  if (!hasAny) return `<div class="wc-empty"><b>لا توجد تنفيذات بعد</b><p class="muted">أنشئ تنفيذًا من «+ تنفيذ جديد»، أو جرّب «مثال عملي جاهز» من الأدوات.</p></div>`;
  return `<div class="wc-empty"><b>لا نتائج مطابقة</b><p class="muted">${lane && lane !== 'all' ? 'غيّر العدّاد المختار أو امسح البحث.' : 'امسح البحث لعرض كل التنفيذات.'}</p></div>`;
}

/** عدّاد الاختيار: يظهر عند تحديد صفوف. */
export function bulkBarHtml(count) {
  if (!count) return '<div class="wc-bulk" data-bulk hidden></div>';
  return `<div class="wc-bulk" data-bulk role="region" aria-label="إجراءات المحدد">
    <span><b>${count}</b> محدد</span>
    <div class="wc-bulk-actions">
      <button type="button" class="primary small" data-run-start="selection">▶ تشغيل المحدد</button>
      <button type="button" class="ghost small" data-bulk-action>📄 إجراء موحّد للمحدد</button>
      <button type="button" class="ghost small" data-clear-selection>✕ إلغاء التحديد</button>
    </div>
  </div>`;
}

/* ============================ النماذج المضمّنة ============================ */

export function collectFormHtml(item, {today, methods = [], prefill = 'overdue'} = {}) {
  const minor = prefill === 'overdue' && item.overdueMinor > 0 ? item.overdueMinor : item.remainingTotal;
  return `<form class="wc-form" data-form="collect" data-id="${esc(item.id)}" novalidate>
    <div class="wc-form-head"><b>تحصيل — ${esc(item.displayNumber || '')}</b><span class="muted small">يُوزَّع تلقائيًا على الأقدم أولًا</span></div>
    <div class="wc-form-grid">
      <label class="field">المبلغ (ج.م) <b class="req">*</b><input name="amount" inputmode="decimal" value="${esc(majorInput(minor, item.currency))}" required data-first></label>
      <label class="field">التاريخ<input name="date" type="date" value="${esc(today)}"></label>
      <label class="field">طريقة التحصيل<input name="paymentMethod" list="wc-methods" placeholder="نقدي / تحويل"></label>
      <label class="field">رقم المحضر / المستند<input name="reference" placeholder="اختياري"></label>
      <datalist id="wc-methods">${methods.map(m => `<option value="${esc(m)}"></option>`).join('')}</datalist>
    </div>
    <div class="wc-preview" data-preview aria-live="polite"><span class="muted small">اكتب المبلغ لتظهر معاينة التوزيع…</span></div>
    <div class="wc-form-actions">
      <button type="submit" class="primary" data-save>✓ حفظ التحصيل</button>
      <button type="button" class="ghost" data-cancel>إلغاء</button>
      <span class="muted small kbd-hint">Ctrl+Enter للحفظ</span>
    </div>
  </form>`;
}

export function actionFormHtml(item, {today, kinds = [], plannedKind = ''} = {}) {
  return `<form class="wc-form" data-form="action" data-id="${esc(item.id)}" novalidate>
    <div class="wc-form-head"><b>إجراء — ${esc(item.displayNumber || '')}</b>${item.nextActionLabel ? `<span class="muted small">المخطط: ${esc(item.nextActionText)} — ${esc(dateText(item.nextActionDate))}</span>` : ''}</div>
    <div class="wc-form-grid">
      <label class="field">النوع <b class="req">*</b><input name="kind" list="wc-kinds" value="${esc(plannedKind)}" placeholder="اكتب أو اختر" required data-first></label>
      <datalist id="wc-kinds">${kinds.map(([, label]) => `<option value="${esc(label)}"></option>`).join('')}</datalist>
      <label class="field">التاريخ <b class="req">*</b><input name="date" type="date" value="${esc(today)}"></label>
      <label class="field">النتيجة<select name="result">${ACTION_RESULTS.map(r => `<option${r === ACTION_RESULTS[0] ? ' selected' : ''}>${esc(r)}</option>`).join('')}</select></label>
      <label class="field">الإجراء التالي<input name="nextAction" placeholder="مثال: جلسة بيع"></label>
      <label class="field">تاريخ الإجراء التالي<input name="nextActionDate" type="date"><span class="wc-quick-dates"><button type="button" class="chip" data-date-offset="7">+ أسبوع</button><button type="button" class="chip" data-date-offset="30">+ شهر</button></span></label>
    </div>
    <div class="wc-form-actions">
      <button type="submit" class="primary" data-save>✓ تم تسجيل الإجراء</button>
      <button type="button" class="ghost" data-cancel>إلغاء</button>
      <span class="muted small kbd-hint">Ctrl+Enter للحفظ</span>
    </div>
  </form>`;
}

export function followFormHtml(item, {today}) {
  return `<form class="wc-form" data-form="follow" data-id="${esc(item.id)}" novalidate>
    <div class="wc-form-head"><b>متابعة لاحقًا — ${esc(item.displayNumber || '')}</b><span class="muted small">تُضاف مهمة في مركز العمل مرتبطة بالملف</span></div>
    <div class="wc-form-grid">
      <label class="field">تاريخ المتابعة <b class="req">*</b><input name="date" type="date" value="${esc(offsetDate(today, 7))}" required data-first></label>
    </div>
    <div class="wc-quick-dates wc-quick-dates--solo"><button type="button" class="chip" data-date-offset="1">غدًا</button><button type="button" class="chip" data-date-offset="7">بعد أسبوع</button><button type="button" class="chip" data-date-offset="30">بعد شهر</button></div>
    <div class="wc-form-actions"><button type="submit" class="primary" data-save>⏰ إنشاء المتابعة</button><button type="button" class="ghost" data-cancel>إلغاء</button></div>
  </form>`;
}

/** قائمة «⋯» للصف: كل ما تبقّى من الإجراءات السياقية. */
export function menuHtml(item) {
  const id = esc(item.id);
  return `<div class="wc-menu" role="menu" data-id="${id}">
    <button type="button" role="menuitem" data-act="collect" data-id="${id}" data-from="menu">💰 تسجيل تحصيل</button>
    <button type="button" role="menuitem" data-act="action" data-id="${id}" data-from="menu">📄 تسجيل إجراء</button>
    <button type="button" role="menuitem" data-act="follow" data-id="${id}" data-from="menu">⏰ متابعة لاحقًا (مهمة)</button>
    <button type="button" role="menuitem" data-act="value" data-id="${id}" data-from="menu">⚙ القيمة والدورية</button>
    <button type="button" role="menuitem" data-act="statement" data-id="${id}" data-from="menu">🖨 كشف / توكيل</button>
    <button type="button" role="menuitem" data-act="duration" data-id="${id}" data-from="menu">🧮 احسب مدة</button>
    ${item.fileId ? `<button type="button" role="menuitem" data-route="file:${esc(item.fileId)}">📁 الملف القانوني</button>` : ''}
    ${item.clientId ? `<button type="button" role="menuitem" data-route="client:${esc(item.clientId)}">👤 الموكل</button>` : ''}
    <button type="button" role="menuitem" data-open="${id}">↗ فتح البطاقة</button>
    <button type="button" class="wc-menu-close" data-close-panel>إغلاق</button>
  </div>`;
}

/* ============================ وضع التشغيل (Focus Mode) ============================ */

/** شريط التقدم داخل وضع التشغيل. */
export function runProgressHtml(run) {
  const total = run.ids.length;
  const done = run.saved.length;
  const pct = total ? Math.round(((run.index) / total) * 100) : 0;
  return `<div class="wc-run-progress"><div class="wc-run-count"><b>${Math.min(run.index + 1, total)}</b> من ${total} <span class="muted">· نُفِّذ ${done} · تُخطّي ${run.skipped.length}</span></div>
    <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="تقدم التشغيل"><span style="width:${pct}%"></span></div></div>`;
}

export function runSummaryHtml(run, remainingCount) {
  return `<section class="wc-run-summary" data-run-summary>
    <span class="cp-eyebrow">انتهى التشغيل</span>
    <h2>نُفِّذ ${run.saved.length} من ${run.ids.length}</h2>
    <p class="cp-meta">تُخطّي ${run.skipped.length}${remainingCount ? ` · ما زال ${remainingCount} يحتاج قرارًا في الطابور` : ' · لا شيء يحتاج قرارًا الآن'}.</p>
    <div class="wc-hero-actions"><button type="button" class="primary" data-run-exit>العودة إلى الطابور</button>${run.skipped.length ? '<button type="button" class="ghost" data-run-retry>مراجعة المتخطّى</button>' : ''}</div>
  </section>`;
}

export function runStepHtml(item, panel, {progress = ''} = {}) {
  return `<section class="wc-run wc-run--${esc(item.severity)}" data-run-item="${esc(item.id)}" aria-label="تنفيذ الخطوة">
    ${progress}
    <header class="wc-hero-head"><span class="cp-eyebrow">خطوة التشغيل</span>${sevChip(item.severity)}<span class="muted small">Esc للخروج · Ctrl+Enter للحفظ والانتقال</span></header>
    <h2 class="wc-hero-title">${esc(item.displayNumber || 'تنفيذ بلا رقم')} · ${partiesText(item)}</h2>
    <p class="wc-hero-step"><span class="cp-dot cp-dot--${esc(item.severity)}" aria-hidden="true"></span><b>${esc(item.step.label)}</b></p>
    <div class="wc-hero-nums">
      <div class="${item.overdueMinor ? 'is-alert' : ''}"><span>متأخر</span><b>${item.overdueMinor ? money(item.overdueMinor, item.currency) : '—'}</b></div>
      <div><span>المدفوع</span><b>${money(item.paidTotal, item.currency)}</b></div>
      <div class="is-primary"><span>المتبقي</span><b>${money(item.remainingTotal, item.currency)}</b></div>
    </div>
    ${panel}
    <div class="wc-run-nav">
      <button type="button" class="ghost small" data-run-skip>تخطَّ ←</button>
      <button type="button" class="ghost small" data-open="${esc(item.id)}">فتح البطاقة</button>
      <button type="button" class="ghost small danger" data-run-exit>إنهاء التشغيل</button>
    </div>
  </section>`;
}

/** ترويسة وضع التشغيل: عنوان واضح يعطي المحامي السياق دون اختفاء أدوات الخروج. */
export const runHeaderHtml = () => `<div class="wc-run-head"><b>▶ وضع التشغيل</b><span class="muted small">نفّذ · سجّل النتيجة · ينتقل النظام تلقائيًا للتالي</span></div>`;
