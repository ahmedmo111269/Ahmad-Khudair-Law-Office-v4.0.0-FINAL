// واجهة تبويب المحضرين والإعلانات داخل الملف القانوني.
import { esc } from '../ui/dom.js';
import { toast } from '../ui/toast.js';
import { modal, closeModal } from '../ui/modal.js';
import { mountGrid } from '../ui/datagrid.js';
import { openEntityForm } from '../ui/form.js';
import { columnsFor, openRow } from './list-page.js';
import { resolveRefs } from '../services/entity-query.js';
import { fileServiceRecords, reannounceServiceRecord } from '../services/service-records.js';
import { ENTITIES, fmtDate } from '../domain/entities.js';
import { userError } from '../core/errors.js';
import { localDate, addDays } from '../core/clock.js';
import { formatFileNumber } from '../core/file-number.js';

const completedStatus = s => ['تم الإعلان', 'تم الاستلام', 'مغلق'].includes(String(s || ''));
const followUpStatus = s => /مطلوب|تسليم|جار|تعذر|مرتد|إعادة|مسودة/.test(String(s || ''));

export async function renderFileServiceTab(app, file, stages) {
  const {rows,total,more} = await fileServiceRecords(app.office, file.id);
  app.__fileServiceRecords = { fileId: file.id, rows,total,more };
  const today = localDate();
  const weekEnd = addDays(today, 7);
  const open = rows.filter(r => !completedStatus(r.status)).length;
  const follow = rows.filter(r => followUpStatus(r.status)).length;
  const delivered = rows.filter(r => completedStatus(r.status)).length;
  const failed = rows.filter(r => /تعذر|مرتد/.test(String(r.status || ''))).length;
  return `<section class="service-board">
    <div class="service-board-head"><div><h3>المحضرين والإعلانات</h3><p class="muted small">سجلات مستقلة قابلة للربط بالملف والمرحلة والجلسة والطرف. الحالة والنتيجة بيانات يحددها المستخدم؛ لا تُحتسب مواعيد قانونية.${more?' يُعرض أول 5000 سجل؛ استخدم التقرير العام لتضييق البحث في الملفات الكبيرة.':''}</p></div><div class="head-actions"><button class="primary" data-service-add>+ إعلان / إنذار</button><button class="ghost" data-bailiff-admin>إدارة المحضرين</button></div></div>
    <div class="service-stats"><div><b>${total}</b><span>كل السجلات</span></div><div><b>${open}</b><span>غير مغلقة${more?' ضمن المعروض':''}</span></div><div><b>${follow}</b><span>تحتاج متابعة بحسب الحالة${more?' ضمن المعروض':''}</span></div><div><b>${delivered}</b><span>تم الإعلان / الاستلام${more?' ضمن المعروض':''}</span></div><div><b>${failed}</b><span>تعذر / مرتد${more?' ضمن المعروض':''}</span></div></div>
    <div class="service-quick-filters" role="group" aria-label="فلاتر سريعة"><button type="button" class="chip active" data-service-filter="all">الكل</button><button type="button" class="chip" data-service-filter="follow">قيد المتابعة</button><button type="button" class="chip" data-service-filter="done">تم الإعلان</button><button type="button" class="chip" data-service-filter="failed">تعذر الإعلان</button><button type="button" class="chip" data-service-filter="reannounce">إعادة إعلان</button><button type="button" class="chip" data-service-filter="today">إعلانات اليوم</button><button type="button" class="chip" data-service-filter="week">الأسبوع</button><button type="button" class="chip" data-service-filter="upcoming">مرتبطة بجلسات قادمة</button></div>
    <div class="service-empty-note" ${rows.length ? 'hidden' : ''}><b>لا توجد إعلانات أو إنذارات مسجلة لهذا الملف.</b><button type="button" class="link" data-service-add>+ إضافة أول سجل</button></div>
    <div data-service-grid></div>
  </section>`;
}

export async function bindFileServiceTab(app, file, stages, parties) {
  const root = document.querySelector('#file-tab');
  const state = app.__fileServiceRecords;
  if (!root || !state || state.fileId !== file.id) return;
  let visibleRows = state.rows;
  const today = localDate();
  const weekEnd = addDays(today, 7);
  const hearingRows = await app.office.r.hearings.byIndex('fileId', file.id,5000);
  const upcomingHearingIds = new Set(hearingRows.filter(h => h.hearingDate >= today).map(h => h.id));
  const refs = await resolveRefs(app.office, visibleRows, ENTITIES.serviceRecords.fields);
  const grid = mountGrid(root.querySelector('[data-service-grid]'), {
    title: `إعلانات وإنذارات الملف ${formatFileNumber(file.fileNumber)}`,
    storageKey: 'file:serviceRecords', rows: visibleRows,
    columns: columnsFor('serviceRecords', refs),
    emptyText: 'لا توجد سجلات مطابقة للفلاتر الحالية.',
    onRowClick: row => openRow(app, 'serviceRecords', row)
  });
  root.querySelectorAll('[data-service-add]').forEach(button => button.addEventListener('click', () => {
    openEntityForm(app, 'serviceRecords', {
      preset: { fileId: file.id },
      stageOptions: stages.map(s => ({ id: s.id, label: `${s.stageType || 'مرحلة'} — ${s.caseNumber || 'بدون رقم'}${s.caseYear ? '/' + s.caseYear : ''}` })),
      partyOptions: parties.filter(p => p.id).map(p => ({ ...p, label: `${p.partyName || p.name || 'طرف'} — ${p.role || ''}` })),
      onSaved: () => app.refresh()
    });
  }));
  root.querySelector('[data-bailiff-admin]')?.addEventListener('click', () => bailiffAdminDialog(app));
  root.querySelector('.service-quick-filters')?.addEventListener('click', e => {
    const button = e.target.closest('[data-service-filter]');
    if (!button) return;
    root.querySelectorAll('[data-service-filter]').forEach(x => x.classList.toggle('active', x === button));
    const kind = button.dataset.serviceFilter;
    visibleRows = state.rows.filter(row => {
      const date = String(row.serviceDate || row.submittedAt || row.createdAt || '').slice(0, 10);
      switch (kind) {
        case 'follow': return followUpStatus(row.status);
        case 'done': return completedStatus(row.status);
        case 'failed': return /تعذر|مرتد/.test(String(row.status || ''));
        case 'reannounce': return row.actionType === 'إعادة إعلان' || Boolean(row.previousServiceId);
        case 'today': return date === today;
        case 'week': return date >= today && date <= weekEnd;
        case 'upcoming': return Boolean(row.hearingId && upcomingHearingIds.has(row.hearingId));
        default: return true;
      }
    });
    grid.setRows(visibleRows);
  });
}

async function bailiffAdminDialog(app) {
  const rows = await app.office.r.bailiffs.all(5000);
  const card = modal(`<h2 class="modal-title">المحضرون ومكاتب المحضرين</h2><p class="muted small">بيانات مرجعية يعاد استخدامها في سجلات الإعلان. تعطيل السجل لا يمحو الإعلانات التاريخية.</p><div class="bailiff-list">${rows.filter(r => !r.isDeleted).map(r => `<div class="bailiff-row"><span><b>${esc(r.name)}</b><small>${esc([r.court, r.section, r.office].filter(Boolean).join(' · ') || 'لا توجد بيانات جهة')}</small></span><span class="badge ${r.isActive === false ? 'warn' : 'open'}">${r.isActive === false ? 'غير نشط' : 'نشط'}</span><button type="button" class="ghost small" data-bailiff-edit="${esc(r.id)}">تعديل</button></div>`).join('') || '<p class="muted">لا توجد بيانات محضرين بعد.</p>'}</div><div class="form-actions"><button type="button" class="primary" data-bailiff-add>+ إضافة محضر</button><button type="button" class="ghost" data-bailiff-close>إغلاق</button></div>`);
  card.querySelector('[data-bailiff-close]').onclick = closeModal;
  card.querySelector('[data-bailiff-add]').onclick = () => { closeModal(); openEntityForm(app, 'bailiffs', { onSaved: () => app.refresh() }); };
  card.querySelectorAll('[data-bailiff-edit]').forEach(button => button.onclick = () => { const id = button.dataset.bailiffEdit; closeModal(); openEntityForm(app, 'bailiffs', { id, onSaved: () => app.refresh() }); });
}

export async function createReannouncement(app, serviceRecord) {
  try {
    const row = await reannounceServiceRecord(app.office, serviceRecord.id);
    toast(`تم إنشاء سجل إعادة الإعلان ${row.internalNumber}`);
    await app.go(`rec:serviceRecords:${row.id}`);
  } catch (error) { toast(userError(error), 'error'); }
}

export { fmtDate };
