// =====================================================================
// طباعة التنفيذ: توكيل التنفيذ وكشف الرصيد — من قوالب قابلة للتعديل
// ---------------------------------------------------------------------
// • يستخدم نظام الطباعة الموجود في البرنامج: فتح نافذة أثناء نقر المستخدم ثم
//   كتابة مستند HTML كامل وطباعته (نفس مسار Universal DataGrid).
// • القالب نصي بمتغيّرات {{...}}، ويُخزَّن في مخزن executionTemplates ويُعدَّل
//   من الإعدادات. لا يُطبع أي مبلغ غير مسجل، ولا يُقدَّر أي رسم.
// =====================================================================
import {STORE} from '../db/schema.js';
import {uid} from '../core/id.js';
import {Clock, localDate} from '../core/clock.js';
import {AppError, ERR} from '../core/errors.js';
import {APP_NAME} from '../core/constants.js';
import {esc} from '../ui/dom.js';
import {num, round2, money, isIsoDate, poaStatusLabel, executionTypeLabel, ledgerTypeLabel, differenceStatusLabel, valueTypeLabel} from '../domain/execution.js';
import {executionBundle, executionPoaRows} from './execution.js';
import {poaDetail} from './execution-poa.js';

const OFFICE_NAME = APP_NAME.replace(/^⚖️\s*/, '');

export const DEFAULT_TEMPLATES = Object.freeze({
  poa: {
    title: 'توكيل بالتنفيذ',
    body: [
      'المكتب: {{office}}',
      'التنفيذ: {{execution.number}} — {{execution.type}}',
      'الموكل: {{client.name}}',
      'الملف: {{file.number}} {{file.title}}',
      'الحكم/الأحكام: {{judgments}}',
      'رقم التوكيل: {{poa.number}} — التاريخ: {{poa.date}}',
      'فترة التوكيل: من {{poa.fromDate}} إلى {{poa.toDate}}',
      '',
      '{{lines}}',
      '',
      'الرصيد السابق: {{totals.previousBalance}}',
      'استحقاق الفترة الجديدة: {{totals.baseAmount}}',
      'فروق أحكام معتمدة: {{totals.differences}}',
      'مصروفات فعلية (مُدرجة باختيارك): {{totals.expenses}}',
      'الدمغة (قيمة فعلية): {{totals.stamp}}',
      'الإجمالي: {{totals.total}}',
      '',
      'ملاحظات: {{poa.notes}}'
    ].join('\n')
  },
  balance: {
    title: 'كشف رصيد التنفيذ',
    body: [
      'المكتب: {{office}}',
      'التنفيذ: {{execution.number}} — {{execution.type}}',
      'الموكل: {{client.name}} — الملف: {{file.number}} {{file.title}}',
      'الجهة: {{execution.authority}} — الرقم الرسمي: {{execution.officialNumber}}',
      'تاريخ الكشف: {{date}}',
      '',
      'الحكم الأصلي: {{judgments.original}}',
      'الأحكام اللاحقة: {{judgments.later}}',
      'القيمة الحالية: {{execution.currentValue}} (سارية من {{execution.currentFrom}})',
      '',
      '{{periods}}',
      '',
      'إجمالي الاستحقاق النهائي: {{totals.finalEntitlement}}',
      'إجمالي المحصل: {{totals.collected}}',
      'الرصيد المتبقي: {{totals.remaining}}',
      'تفكيك الرصيد: رصيد أصلي {{totals.originalOutstanding}} + فروق أحكام {{totals.differencePart}}',
      'فروق معتمدة: {{totals.approvedDifferences}} — فروق تنتظر المراجعة: {{totals.pendingDifferences}}',
      'مصروفات التنفيذ المسجلة (منفصلة عن أصل الدين): {{totals.expenses}}',
      '',
      '{{receipts}}',
      '',
      'معادلات الحساب:',
      '{{equations}}'
    ].join('\n')
  }
});

export async function ensureTemplates(office) {
  const existing = await office.r.executionTemplates.all(200);
  const map = new Map(existing.map(row => [row.kind, row]));
  const created = [];
  for (const [kind, def] of Object.entries(DEFAULT_TEMPLATES)) {
    if (map.has(kind)) continue;
    const row = {id: uid(), kind, title: def.title, body: def.body, isDefault: true, createdAt: Clock.now(), updatedAt: Clock.now(), version: 1, isDeleted: false};
    await office.r.executionTemplates.put(row);
    created.push(row);
  }
  return created;
}

export async function templatesFor(office) {
  await ensureTemplates(office);
  const rows = await office.r.executionTemplates.all(200);
  return rows.filter(row => !row.isDeleted).sort((a, b) => String(a.kind).localeCompare(String(b.kind)));
}

export async function saveTemplate(office, {kind, title, body, id = null} = {}) {
  if (!DEFAULT_TEMPLATES[kind]) throw new AppError(ERR.VALIDATION, 'نوع القالب غير معروف.');
  const old = id ? await office.r.executionTemplates.get(id) : (await templatesFor(office)).find(row => row.kind === kind);
  if (!String(body || '').trim()) throw new AppError(ERR.VALIDATION, 'نص القالب مطلوب.', {body: 'مطلوب'});
  const row = {...(old || {}), id: old?.id || uid(), kind, title: String(title || DEFAULT_TEMPLATES[kind].title).trim(), body, isDefault: false, createdAt: old?.createdAt || Clock.now(), updatedAt: Clock.now(), version: (old?.version || 0) + 1, isDeleted: false};
  await office.r.executionTemplates.put(row);
  return row;
}

export async function resetTemplate(office, kind) {
  const rows = await templatesFor(office);
  const row = rows.find(item => item.kind === kind);
  if (!row) throw new AppError(ERR.NOT_FOUND, 'القالب غير موجود.');
  const updated = {...row, title: DEFAULT_TEMPLATES[kind].title, body: DEFAULT_TEMPLATES[kind].body, isDefault: true, updatedAt: Clock.now(), version: (row.version || 0) + 1};
  await office.r.executionTemplates.put(updated);
  return updated;
}

const value = (data, path) => path.split('.').reduce((acc, key) => (acc === null || acc === undefined ? acc : acc[key]), data);
/** استبدال {{path}} — القيم الفارغة تُحذف ولا تُطبع «undefined». */
export function renderTemplate(template, data) {
  const title = String(template?.title || 'مستند').replace(/\{\{([^}]+)\}\}/g, (_, path) => {
    const v = value(data, path.trim());
    return v === undefined || v === null ? '' : String(v);
  });
  const body = String(template?.body || '').replace(/\{\{([^}]+)\}\}/g, (_, path) => {
    const v = value(data, path.trim());
    if (v === undefined || v === null) return '';
    return String(v);
  }).replace(/\n{3,}/g, '\n\n');
  return {title, body};
}

function documentHtml({title, body, extraCss = ''}) {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
   body{font-family:"Noto Sans Arabic","Segoe UI",Tahoma,sans-serif;margin:22px;color:#111;font-size:13px;line-height:1.9}
   header{border-bottom:2px solid #26364b;padding-bottom:10px;margin-bottom:14px}
   .office{font-size:18px;font-weight:700;color:#26364b;margin:0 0 6px}
   h1{font-size:16px;margin:0 0 6px}
   pre{white-space:pre-wrap;font-family:inherit;margin:0}
   table{border-collapse:collapse;width:100%;margin:10px 0;font-size:12px}
   th,td{border:1px solid #999;padding:5px 7px;text-align:right;vertical-align:top}
   th{background:#eef1f5}
   tr{break-inside:avoid}
   .muted{color:#555;font-size:11px}
   @media print{@page{size:A4;margin:12mm}}
   ${extraCss}
  </style></head><body>
  <header><p class="office">${esc(OFFICE_NAME)}</p><h1>${esc(title)}</h1><p class="muted">طُبع بتاريخ ${esc(localDate())}</p></header>
  <pre>${esc(body)}</pre>
  <p class="muted">هذا المستند أُنشئ من بيانات المكتب المسجلة. كل مبلغ فيه مسجل بمصدره في بطاقة التنفيذ.</p>
  </body></html>`;
}

/** مستند توكيل التنفيذ: يعرض المصادر والتفاصيل الفعلية المدخلة فقط. */
export async function buildPoaDocument(office, poaId) {
  const detail = await poaDetail(office, poaId);
  const {poa, previous} = detail;
  const info = await executionBundle(office, poa.executionId);
  const [client, file] = await Promise.all([
    poa.clientId ? office.r.clients.get(poa.clientId) : null,
    poa.fileId ? office.r.files.get(poa.fileId) : null
  ]);
  const templates = await templatesFor(office);
  const template = templates.find(row => row.kind === 'poa') || DEFAULT_TEMPLATES.poa;
  const judgmentRows = info.judgments.filter(judgment => !poa.judgmentIds?.length || poa.judgmentIds.includes(judgment.id));
  const lines = (poa.lines || []).map(line => `<tr><td>${esc(line.label)}</td><td>${esc(money(line.amount))}</td><td>${esc(line.detail || '')}</td></tr>`).join('');
  const data = {
    office: OFFICE_NAME,
    date: localDate(),
    execution: {
      number: poa.executionId ? `${info.execution.internalNumber || ''} — ${info.execution.officialNumber || ''}`.trim() : '',
      type: executionTypeLabel(info.execution.executionType),
      authority: info.execution.authority || info.execution.executionOffice || '',
      officialNumber: info.execution.officialNumber || '',
      currentValue: info.summary.currentValue ? money(info.summary.currentValue.amount) : '',
      currentFrom: info.summary.currentValue?.startDate || ''
    },
    client: {name: client?.fullName || ''},
    file: {number: file?.fileNumber || '', title: file?.title || ''},
    judgments: judgmentRows.map(row => `${row.judgmentNumber || ''} ${row.judgmentDate || ''} — ${row.amount ?? ''}`.trim()).join(' · '),
    poa: {number: poa.poaNumber || '', date: poa.date || '', fromDate: poa.fromDate || '', toDate: poa.toDate || '', status: poaStatusLabel(poa.status), notes: poa.notes || '', previous: previous?.poaNumber || ''},
    totals: {
      previousBalance: money(poa.previousBalance), baseAmount: money(poa.baseAmount), differences: money(poa.differencesAmount),
      expenses: money(poa.expensesAmount), stamp: money(poa.stampAmount), total: money(poa.total)
    },
    lines: `البيان | المبلغ | المصدر\n${(poa.lines || []).map(line => `${line.label} | ${money(line.amount)} | ${line.detail || ''}`).join('\n')}`
  };
  const rendered = renderTemplate(template, data);
  const html = documentHtml({title: rendered.title, body: rendered.body}).replace('</pre>', `</pre>\n  <table><thead><tr><th>البيان</th><th>المبلغ (جنيه)</th><th>المصدر / التفصيل</th></tr></thead><tbody>${lines || '<tr><td colspan="3">لا توجد بنود مسجلة</td></tr>'}</tbody></table>`);
  return {html, data, template, detail};
}

/** كشف الرصيد: الحكم، الفترات، الاستحقاقات، التحصيلات، الفروق، التخصيص، الرصيد. */
export async function buildBalanceDocument(office, executionId, {asOf = ''} = {}) {
  const info = await executionBundle(office, executionId, {asOf});
  if (!info) throw new AppError(ERR.NOT_FOUND, 'سجل التنفيذ غير موجود.');
  const execution = info.execution;
  const [client, file] = await Promise.all([
    execution.clientId ? office.r.clients.get(execution.clientId) : null,
    execution.fileId ? office.r.files.get(execution.fileId) : null
  ]);
  const templates = await templatesFor(office);
  const template = templates.find(row => row.kind === 'balance') || DEFAULT_TEMPLATES.balance;
  const originals = info.judgments.filter(row => row.judgmentKind === 'original');
  const later = info.judgments.filter(row => row.judgmentKind !== 'original');
  const allocationByPeriod = new Map();
  for (const allocation of info.allocations) {
    if (allocation.isDeleted || allocation.isActive === false) continue;
    allocationByPeriod.set(allocation.periodKey, round2((allocationByPeriod.get(allocation.periodKey) || 0) + num(allocation.amount)));
  }
  const periodText = info.periods.map(period => {
    const collected = allocationByPeriod.get(period.key) || 0;
    const remaining = round2(period.finalAmount - collected);
    const diff = round2(period.finalAmount - period.originalAmount);
    return `${period.start} → ${period.end} | ${period.entitlementType} | ${period.finalAmount} | ${collected} | ${remaining} | ${diff ? diff : '—'} | ${period.equation}`;
  }).join('\n');
  const receiptText = info.receipts.map(receipt => {
    const lines = info.allocations.filter(allocation => allocation.receiptId === receipt.id && allocation.isActive !== false && !allocation.isDeleted);
    return `${receipt.receiptNumber || ''} | ${receipt.date} | ${receipt.amount} | ${lines.map(line => `${line.periodKey}=${line.amount}`).join(' ، ') || 'بلا تخصيص'}`;
  }).join('\n');
  const data = {
    office: OFFICE_NAME,
    date: asOf || localDate(),
    execution: {
      number: execution.internalNumber || '', type: executionTypeLabel(execution.executionType),
      authority: execution.authority || execution.executionOffice || '', officialNumber: execution.officialNumber || '',
      currentValue: info.summary.currentValue ? money(info.summary.currentValue.amount) : '—',
      currentFrom: info.summary.currentValue?.startDate || '—'
    },
    client: {name: client?.fullName || ''},
    file: {number: file?.fileNumber || '', title: file?.title || ''},
    judgments: {
      original: originals.map(row => `${row.judgmentNumber || ''} ${row.judgmentDate || ''} (${row.amount ?? ''} من ${row.effectiveFrom || '—'})`.trim()).join(' · ') || '—',
      later: later.map(row => `${row.judgmentNumber || ''} ${row.judgmentDate || ''} (${row.amount ?? ''} من ${row.effectiveFrom || '—'})`.trim()).join(' · ') || '—'
    },
    totals: {
      finalEntitlement: money(info.summary.finalEntitlement), collected: money(info.summary.collected), remaining: money(info.summary.remaining),
      originalOutstanding: money(info.summary.originalOutstanding), differencePart: money(info.summary.differencePart),
      approvedDifferences: money(info.summary.differences.approved), pendingDifferences: money(info.summary.differences.pending),
      expenses: money(info.summary.expenses)
    },
    periods: `الفترة | النوع | الاستحقاق النهائي | المحصل | المتبقي | فرق الحكم | المعادلة\n${periodText || 'لا توجد فترات محسوبة'}`,
    receipts: `المحضر | التاريخ | المبلغ | التخصيص\n${receiptText || 'لا توجد محاضر تحصيل مسجلة'}`,
    equations: (info.summary.equations || []).join('\n')
  };
  const rendered = renderTemplate(template, data);
  const html = documentHtml({title: rendered.title, body: rendered.body}).replace('</pre>', `</pre>
  <table><thead><tr><th>الفترة</th><th>النوع</th><th>الاستحقاق النهائي</th><th>المحصل</th><th>المتبقي</th><th>فرق الحكم</th><th>المعادلة</th></tr></thead><tbody>${
    info.periods.map(period => {
      const collected = allocationByPeriod.get(period.key) || 0;
      const diff = round2(period.finalAmount - period.originalAmount);
      return `<tr><td>${esc(`${period.start} → ${period.end}`)}</td><td>${esc(period.entitlementType)}</td><td>${esc(money(period.finalAmount))}</td><td>${esc(money(collected))}</td><td>${esc(money(period.finalAmount - collected))}</td><td>${diff ? esc(money(diff)) : '—'}</td><td>${esc(period.equation)}</td></tr>`;
    }).join('') || '<tr><td colspan="7">لا توجد فترات محسوبة</td></tr>'
  }</tbody></table>
  <table><thead><tr><th>المحضر</th><th>التاريخ</th><th>المبلغ</th><th>التوزيع على الفترات</th></tr></thead><tbody>${
    info.receipts.map(receipt => {
      const lines = info.allocations.filter(allocation => allocation.receiptId === receipt.id && allocation.isActive !== false && !allocation.isDeleted);
      return `<tr><td>${esc(receipt.receiptNumber || '')}</td><td>${esc(receipt.date || '')}</td><td>${esc(money(receipt.amount))}</td><td>${esc(lines.map(line => `${line.periodKey} = ${line.amount}`).join(' ، ') || 'بلا تخصيص')}</td></tr>`;
    }).join('') || '<tr><td colspan="4">لا توجد محاضر تحصيل مسجلة</td></tr>'
  }</tbody></table>`);
  return {html, data, template, info};
}

/** فتح مستند للطباعة: النافذة تُفتح أثناء نقر المستخدم قبل أي قراءة. */
export function openDocumentForPrint(html) {
  if (typeof window === 'undefined') return null;
  const w = window.open('', '_blank');
  if (!w) { alert('اسمح بالنوافذ المنبثقة للطباعة.'); return null; }
  try {
    w.opener = null;
    w.document.open();
    w.document.write(html.replace('</body>', '<script>window.addEventListener("load",()=>{window.focus();window.print()},{once:true});</script></body>'));
    w.document.close();
  } catch (error) {
    try { w.close(); } catch {}
    throw new AppError(ERR.UNKNOWN, 'تعذر تجهيز مستند الطباعة.');
  }
  return w;
}

/** مسار «اضغط للطباعة»: تُفتح النافذة أولًا ثم تُقرأ البيانات ثم يُكتب المستند. */
export async function printPoa(office, poaId) {
  const w = typeof window === 'undefined' ? null : window.open('', '_blank');
  if (typeof window !== 'undefined' && !w) { alert('اسمح بالنوافذ المنبثقة للطباعة.'); return null; }
  try {
    const {html} = await buildPoaDocument(office, poaId);
    if (!w) return html;
    if (w.closed) return null;
    w.opener = null;
    w.document.open();
    w.document.write(html.replace('</body>', '<script>window.addEventListener("load",()=>{window.focus();window.print()},{once:true});</script></body>'));
    w.document.close();
    return w;
  } catch (error) {
    try { w?.close(); } catch {}
    throw error;
  }
}

export async function printBalanceStatement(office, executionId, {asOf = ''} = {}) {
  const w = typeof window === 'undefined' ? null : window.open('', '_blank');
  if (typeof window !== 'undefined' && !w) { alert('اسمح بالنوافذ المنبثقة للطباعة.'); return null; }
  try {
    const {html} = await buildBalanceDocument(office, executionId, {asOf});
    if (!w) return html;
    if (w.closed) return null;
    w.opener = null;
    w.document.open();
    w.document.write(html.replace('</body>', '<script>window.addEventListener("load",()=>{window.focus();window.print()},{once:true});</script></body>'));
    w.document.close();
    return w;
  } catch (error) {
    try { w?.close(); } catch {}
    throw error;
  }
}

export {poaStatusLabel, ledgerTypeLabel, differenceStatusLabel, valueTypeLabel, executionPoaRows, isIsoDate};
