import { STORE } from '../db/schema.js';
import { esc, formData } from '../ui/dom.js';
import { modal, closeModal } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { saveJudicial } from '../services/judicial.js';
import { pager, pagingState, currentCursor, applyPageResult, nextPage, prevPage, resetPaging } from '../ui/pagination.js';
import { lookupField, bindLookups } from '../ui/lookup.js';

const cfg = {
  witnesses: { title: 'الشهود', desc: 'بيانات الشهود المرتبطين بالقضية.', fields: ['caseId', 'name', 'side', 'phone', 'address', 'notes'], index: 'caseId' },
  expertReports: { title: 'تقارير الخبراء', desc: 'تسجيل الخبراء وتقاريرهم وملخصاتها.', fields: ['caseId', 'expertName', 'reportDate', 'summary', 'notes'], index: 'reportDate' },
  judgments: { title: 'الأحكام', desc: 'تسجيل بيانات الأحكام وملخص منطوقها.', fields: ['caseId', 'judgmentNumber', 'court', 'judgmentDate', 'operativeSummary', 'notes'], index: 'judgmentDate' },
  execution: { title: 'التنفيذ', desc: 'متابعة مرحلة تنفيذ الحكم المرتبطة بالقضية.', fields: ['caseId', 'executionNumber', 'status', 'stage', 'openedDate', 'lastActionDate', 'nextAction', 'notes'], index: null }
};

const labels = {
  caseId: 'القضية', name: 'الاسم', side: 'الصفة/الجانب', phone: 'الهاتف', address: 'العنوان', notes: 'ملاحظات',
  expertName: 'اسم الخبير', reportDate: 'تاريخ التقرير', summary: 'الملخص', judgmentNumber: 'رقم الحكم', court: 'المحكمة',
  judgmentDate: 'تاريخ الحكم', operativeSummary: 'ملخص المنطوق', executionNumber: 'رقم التنفيذ', status: 'الحالة',
  stage: 'المرحلة', openedDate: 'تاريخ فتح التنفيذ', lastActionDate: 'آخر إجراء', nextAction: 'الإجراء التالي'
};

export async function judicialPage(app, store) {
  const c = cfg[store];
  app.__judPages = app.__judPages || {};
  const state = pagingState(app.__judPages[store], { filters: { q: '', status: '', from: '', to: '', sort: 'desc' } });
  app.__judPages[store] = state;
  state.filters = state.filters || { q: '', status: '', from: '', to: '', sort: 'desc' };

  const f = state.filters;
  const q = normalizeText(f.q);
  const dateField = store === 'expertReports' ? 'reportDate' : store === 'judgments' ? 'judgmentDate' : store === 'execution' ? 'openedDate' : '';
  
  const filter = (v) => {
    const hay = normalizeText(JSON.stringify(v));
    const d = String(dateField ? v[dateField] || '' : '').slice(0, 10);
    return (!q || hay.includes(q)) && (!f.status || v.status === f.status) && (!f.from || !dateField || d >= f.from) && (!f.to || !dateField || d <= f.to);
  };

  const r = await app.office.r[store].page({
    index: c.index,
    cursor: currentCursor(state),
    limit: 25,
    direction: f.sort === 'asc' ? 'next' : 'prev',
    filter
  });
  applyPageResult(state, r);

  const cases = await app.office.r.cases.getMany(r.items.map((x) => x.caseId));
  const cm = new Map(cases.map((x) => [x.id, `${x.caseNumber || ''}/${x.caseYear || ''} — ${x.courtId || ''}`]));

  return `<div class="page-head">
    <div><h2>${c.title}</h2><p>${c.desc}</p></div>
    <div class="head-actions">
      <button class="ghost" data-page-back>رجوع</button>
      <button class="ghost" data-page-close>إغلاق</button>
      <button class="primary" data-j-add="${store}">إضافة</button>
    </div>
    <div class="toolbar">
      <input id="j-q" value="${esc(f.q || '')}" placeholder="بحث في جميع السجلات…">
      <details class="filter-tab">
        <summary>فرز وتصفية</summary>
        <div class="mini-filter">
          ${store === 'execution' ? `<select id="j-status">
            <option value="">كل الحالات</option>
            ${['not_started', 'active', 'suspended', 'completed', 'cancelled'].map((x) => `<option ${f.status === x ? 'selected' : ''}>${x}</option>`).join('')}
          </select>` : ''}
          <input id="j-from" type="date" value="${esc(f.from || '')}">
          <input id="j-to" type="date" value="${esc(f.to || '')}">
          <select id="j-sort">
            <option value="desc" ${f.sort === 'desc' ? 'selected' : ''}>الأحدث أولًا</option>
            <option value="asc" ${f.sort === 'asc' ? 'selected' : ''}>الأقدم أولًا</option>
          </select>
        </div>
      </details>
      <span class="muted">صفحة ${state.page}</span>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>${columns(store).map((f) => `<th>${labels[f] || f}</th>`).join('')}<th>إجراء</th></tr>
        </thead>
        <tbody id="j-body">
          ${r.items.length ? '' : `<tr><td colspan="${columns(store).length + 1}" class="muted">لا توجد سجلات.</td></tr>`}
          ${r.items.map((x) => `<tr data-status="${esc(x.status || '')}" data-date="${esc(x.judgmentDate || x.reportDate || x.lastActionDate || x.openedDate || '')}" data-search="${esc(JSON.stringify(x))}">
            ${columns(store).map((f) => `<td>${display(f, x[f], cm)}</td>`).join('')}
            <td><button class="link" data-j-edit="${store}|${x.id}">فتح</button></td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    ${pager({ page: state.page, hasNext: state.hasNext, hasPrev: state.hasPrev })}
  </div>`;
}

function columns(s) {
  return {
    witnesses: ['caseId', 'name', 'side', 'phone'],
    expertReports: ['caseId', 'expertName', 'reportDate', 'summary'],
    judgments: ['caseId', 'judgmentNumber', 'court', 'judgmentDate', 'operativeSummary'],
    execution: ['caseId', 'executionNumber', 'status', 'stage', 'lastActionDate']
  }[s];
}

function display(f, v, cm) {
  if (f === 'caseId') return esc(cm.get(v) || '—');
  return esc(String(v ?? '').slice(0, 120) || '—');
}

export function bindJudicial(app, store) {
  document.querySelector(`[data-j-add="${store}"]`)?.addEventListener('click', () => form(app, store));
  document.querySelectorAll('[data-j-edit]').forEach((b) => (b.onclick = () => {
    const [s, id] = b.dataset.jEdit.split('|');
    form(app, s, id);
  }));

  document.querySelector('[data-pager-next]')?.addEventListener('click', () => {
    if (nextPage(app.__judPages[store])) app.refresh();
  });

  document.querySelector('[data-pager-prev]')?.addEventListener('click', () => {
    if (prevPage(app.__judPages[store])) app.refresh();
  });

  let timer = 0;
  document.querySelector('#j-q')?.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(apply, 300); });
  ['j-status', 'j-from', 'j-to', 'j-sort'].forEach((id) =>
    document.querySelector('#' + id)?.addEventListener('change', apply)
  );

  function apply() {
    const s = app.__judPages[store];
    s.filters = {
      q: document.querySelector('#j-q')?.value.trim() || '',
      status: document.querySelector('#j-status')?.value || '',
      from: document.querySelector('#j-from')?.value || '',
      to: document.querySelector('#j-to')?.value || '',
      sort: document.querySelector('#j-sort')?.value || 'desc'
    };
    resetPaging(s);
    app.refresh();
  }
}

function normalizeText(v) {
  return String(v ?? '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/[ًٌٍَُِّْـ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('ar-EG');
}

async function form(app, store, id = null) {
  const old = id ? (await app.office.r[store].get(id)) || {} : {};
  const oldCase = old.caseId ? await app.office.r.cases.get(old.caseId) : null;
  const caseLabel = oldCase ? `${oldCase.caseNumber || ''}/${oldCase.caseYear || ''} — ${oldCase.courtId || ''}` : '';
  const c = modal(`<div class="modal-tools">
    <button type="button" data-modal-back class="ghost">رجوع</button>
    <button type="button" data-close class="modal-close">×</button>
  </div>
  <h2>${id ? 'تعديل' : 'إضافة'} — ${cfg[store].title}</h2>
  <form>${cfg[store].fields.map((f) => field(f, old, caseLabel)).join('')}<button class="primary">حفظ</button></form>`);

  bindLookups(c, app.office);
  c.querySelector('form').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const data = formData(e.target);
      if (!data.caseId) throw new Error('اختر القضية من القائمة المقترحة.');
      await saveJudicial(app.office, store, data, id);
      closeModal();
      toast('تم الحفظ وتحديث دورة القضية');
      app.refresh();
    } catch (x) {
      toast(x.message || 'تعذر الحفظ', 'error');
    }
  };
}

function field(f, old, caseLabel = '') {
  const v = old?.[f] ?? '';
  if (f === 'caseId') {
    return lookupField({ name: 'caseId', label: labels[f], store: 'cases', index: 'caseNumber', value: v, displayValue: caseLabel });
  }
  if (f === 'status') {
    return `<label>${labels[f]}<select name="status">${['not_started', 'active', 'suspended', 'completed', 'cancelled'].map((x) => `<option value="${x}" ${v === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>`;
  }
  if (['notes', 'summary', 'operativeSummary', 'address', 'nextAction'].includes(f)) {
    return `<label>${labels[f]}<textarea name="${f}">${esc(v)}</textarea></label>`;
  }
  const type = ['reportDate', 'judgmentDate', 'openedDate', 'lastActionDate'].includes(f) ? 'date' : 'text';
  return `<label>${labels[f] || f}<input name="${f}" type="${type}" value="${esc(v)}"></label>`;
}
