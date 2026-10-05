// =====================================================================
// واجهة مركز «يحتاج انتباهي» — شريط أعلى صفحة مركز التنفيذ
// ---------------------------------------------------------------------
// كل بطاقة: العنوان + العدد + «عرض (N)» يفتح القائمة مفلترة على نفس الفئة.
// التسمية الإلزامية ظاهرة دائمًا: «تنبيه تنظيمي — ليس تقييمًا قانونيًا».
// =====================================================================
import {esc} from './dom.js';
import {modal} from './modal.js';
import {ATTENTION_DISCLAIMER, ATTENTION_CATEGORIES} from '../services/execution-attention.js';

const money = (minor, currency = 'EGP') => `${Number(minor || 0) === 0 ? '' : `${(minor / 100).toLocaleString('en-US', {maximumFractionDigits: 2})} ${currency}`}`;
const display = iso => (typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');

/** شريط البطاقات (يُرسم فارغًا ثم يُملأ بعد المسح حتى لا يتأخر رسم الصفحة). */
export function attentionBarMarkup({report = null} = {}) {
  const categories = report?.categories || ATTENTION_CATEGORIES.map(category => ({...category, count: null, items: []}));
  const total = report ? Number(report.total || 0) : null;
  return `<section class="panel exec-attention" data-section-id="attention" aria-label="يحتاج انتباهي">
    <div class="att-head">
      <h3>يحتاج انتباهي ${total === null ? '' : `<span class="badge${total ? ' warn' : ' ok'}">${total}</span>`}</h3>
      <span class="att-disclaimer" title="${esc(ATTENTION_DISCLAIMER)}">ⓘ ${esc(ATTENTION_DISCLAIMER)}</span>
      <span class="qc-spacer"></span>
      <button type="button" class="ghost small" data-attention-refresh>↻ إعادة الفحص</button>
      <button type="button" class="ghost small" data-attention-thresholds>⚙ الحدود</button>
    </div>
    <div class="att-grid" data-attention-grid>
      ${total === null ? '<p class="muted small">جارٍ فحص التنفيذات…</p>' : categories.map(card => attentionCardMarkup(card)).join('')}
    </div>
    ${report && report.scannedAll === false ? `<p class="muted small" data-attention-note>الفحص محسوب على أحدث ${Number(report.scanned || 0).toLocaleString('en-US')} تنفيذ — توجد تنفيذات أقدم لم تُفحص.</p>` : '<p class="muted small" data-attention-note></p>'}
  </section>`;
}

export function attentionCardMarkup(card) {
  const count = card.count;
  const loading = count === null || count === undefined;
  return `<button type="button" class="att-card att-${esc(card.severity || 'blue')}${loading ? ' is-loading' : ''}${count ? '' : ' is-empty'}"
      data-attention-card="${esc(card.key)}" ${loading || !count ? 'disabled' : ''} aria-label="${esc(card.title)} — ${loading ? 'جارٍ الحساب' : `${count} عنصر`}">
    <span class="att-icon" aria-hidden="true">${esc(card.icon || '•')}</span>
    <span class="att-body">
      <b>${esc(card.title)}</b>
      <small class="muted">${loading ? '…' : `${Number(count).toLocaleString('en-US')} عنصر`}</small>
    </span>
    ${loading || !count ? '' : `<span class="att-open">عرض (${Number(count).toLocaleString('en-US')})</span>`}
  </button>`;
}

/** تحديث الشريط في مكانه بعد انتهاء المسح (بلا إعادة رسم للصفحة كلها). */
export function renderAttentionBar(container, report) {
  if (!container) return;
  const grid = container.querySelector('[data-attention-grid]');
  if (grid) grid.innerHTML = (report?.categories || []).map(card => attentionCardMarkup(card)).join('');
  const head = container.querySelector('.att-head h3');
  if (head) head.innerHTML = `يحتاج انتباهي <span class="badge${report?.total ? ' warn' : ' ok'}">${Number(report?.total || 0)}</span>`;
  const note = container.querySelector('[data-attention-note]');
  if (note) {
    note.textContent = report?.scannedAll === false
      ? `الفحص محسوب على أحدث ${Number(report.scanned || 0).toLocaleString('en-US')} تنفيذ — توجد تنفيذات أقدم لم تُفحص.`
      : (report?.scanned ? `فُحص ${Number(report.scanned).toLocaleString('en-US')} تنفيذ · الحدود: رصيد بلا إجراء > ${report.thresholds.unpaidWithoutActionDays} يومًا · توكيل بلا نتيجة > ${report.thresholds.poaWithoutResultDays} يومًا.` : '');
  }
}

/** قائمة عناصر فئة واحدة — تُفتح مفلترة، وكل عنصر يفتح بطاقة تنفيذه. */
export function attentionListModal(report, categoryKey, {onOpen = null} = {}) {
  const category = (report?.categories || []).find(row => row.key === categoryKey);
  if (!category) return null;
  const items = category.items || [];
  const rows = items.map(item => `<li class="att-row">
      <div class="att-row-body">
        <b>${esc(item.number || 'بلا رقم')}</b> — ${esc(item.clientName || 'بلا موكل')}
        <small class="muted">${esc(item.detail || '')}${item.date ? ` · ${esc(display(item.date))}` : ''}${item.amountMinor ? ` · ${esc(money(item.amountMinor, item.currency))}` : ''}</small>
      </div>
      <button type="button" class="ghost small" data-attention-open="${esc(item.executionId)}">فتح البطاقة</button>
    </li>`).join('');
  const card = modal(`<h2 class="modal-title">${esc(category.icon || '')} ${esc(category.title)} <span class="badge">${items.length}</span></h2>
    <p class="muted small">${esc(ATTENTION_DISCLAIMER)} — القائمة مفلترة على هذه الفئة فقط.</p>
    ${items.length ? `<ul class="plain-list att-list">${rows}</ul>` : '<p class="muted">لا عناصر في هذه الفئة.</p>'}
    <div class="form-actions"><button type="button" class="ghost" data-close>إغلاق</button></div>`);
  card.querySelectorAll('[data-attention-open]').forEach(button => button.addEventListener('click', () => {
    if (typeof onOpen === 'function') onOpen(button.dataset.attentionOpen, categoryKey);
  }));
  return card;
}

/** نافذة حدود المتابعة: تُحفظ في lists.followUpThresholds (إعدادات التنفيذ). */
export function attentionThresholdsModal(report, {onSave = null} = {}) {
  const thresholds = report?.thresholds || {};
  const card = modal(`<h2 class="modal-title">⚙ حدود «يحتاج انتباهي»</h2>
    <p class="muted small">${esc(ATTENTION_DISCLAIMER)} — الحدود تنظيمية يضبطها المكتب، وتُحفظ في إعدادات التنفيذ.</p>
    <form class="simple-form" data-form="attention-thresholds">
      <div class="form-grid">
        <label class="field">رصيد غير مسدَّد بلا إجراء — أكثر من (يوم)<input name="unpaidWithoutActionDays" type="number" min="0" step="1" value="${esc(String(thresholds.unpaidWithoutActionDays ?? 60))}"></label>
        <label class="field">توكيل بلا نتيجة — أكثر من (يوم)<input name="poaWithoutResultDays" type="number" min="0" step="1" value="${esc(String(thresholds.poaWithoutResultDays ?? 30))}"></label>
        <label class="field">فترة انتهت بلا موقف — بعد (يوم) من نهايتها<input name="periodEndedWithoutPositionDays" type="number" min="0" step="1" value="${esc(String(thresholds.periodEndedWithoutPositionDays ?? 0))}"></label>
        <label class="check-line"><input type="checkbox" name="petitionWithoutJudicialNumber" ${thresholds.petitionWithoutJudicialNumber !== false ? 'checked' : ''}> تنبيه: رقم عرائض بلا رقم قضائي</label>
        <label class="check-line"><input type="checkbox" name="judgmentWithoutEffectiveDate" ${thresholds.judgmentWithoutEffectiveDate !== false ? 'checked' : ''}> تنبيه: حكم بلا تاريخ سريان</label>
        <label class="check-line"><input type="checkbox" name="enabled" ${thresholds.enabled !== false ? 'checked' : ''}> تفعيل مركز «يحتاج انتباهي»</label>
      </div>
      <div class="form-actions"><button type="submit" class="primary" data-save>حفظ الحدود</button><button type="button" class="ghost" data-close>إلغاء</button></div>
    </form>`);
  card.querySelector('[data-form="attention-thresholds"]')?.addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = {
      unpaidWithoutActionDays: Math.max(0, Number(form.querySelector('[name="unpaidWithoutActionDays"]').value || 0)),
      poaWithoutResultDays: Math.max(0, Number(form.querySelector('[name="poaWithoutResultDays"]').value || 0)),
      periodEndedWithoutPositionDays: Math.max(0, Number(form.querySelector('[name="periodEndedWithoutPositionDays"]').value || 0)),
      petitionWithoutJudicialNumber: Boolean(form.querySelector('[name="petitionWithoutJudicialNumber"]').checked),
      judgmentWithoutEffectiveDate: Boolean(form.querySelector('[name="judgmentWithoutEffectiveDate"]').checked),
      enabled: Boolean(form.querySelector('[name="enabled"]').checked)
    };
    if (typeof onSave === 'function') onSave(values);
  });
  return card;
}
