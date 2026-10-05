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
import {wrapForPrint} from './print-paginate.js';
import {executionSettings} from './execution-settings.js';

const OFFICE_NAME = APP_NAME.replace(/^⚖️\s*/, '');

export const DEFAULT_TEMPLATES = Object.freeze({
  poa: {
    title: 'توكيل بالتنفيذ',
    body: [
      'المكتب: {{office}}',
      'التنفيذ: {{execution.number}} — {{execution.type}}',
      'الموكل (المستحق): {{client.name}}',
      'المنفذ ضده: {{debtor.name}}',
      'الملف: {{file.number}} {{file.title}}',
      'الحكم/الأحكام: {{judgments}}',
      'رقم التوكيل: {{poa.number}} — التاريخ: {{poa.date}}',
      'فترة التوكيل: من {{poa.fromDate}} إلى {{poa.toDate}} ({{poa.periodCount}} فترة)',
      '',
      '{{lines}}',
      '',
      'الرصيد السابق: {{totals.previousBalance}}',
      'استحقاق الفترة الجديدة: {{totals.baseAmount}}',
      'فروق أحكام معتمدة: {{totals.differences}}',
      'مصروفات فعلية (مُدرجة باختيارك): {{totals.expenses}}',
      'الرسوم (إدخال يدوي): {{totals.fees}}',
      'الدمغة (قيمة فعلية): {{totals.stamp}}',
      'الإجمالي: {{totals.total}}',
      'المعادلة: {{equation}}',
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

const printDateLocal = iso => (isIsoDate(iso) ? `${String(iso).slice(8, 10)}/${String(iso).slice(5, 7)}/${String(iso).slice(0, 4)}` : String(iso || '—'));

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
  <header><p class="office">${esc(OFFICE_NAME)}</p><h1>${esc(title)}</h1><p class="muted">طُبع بتاريخ ${esc(printDateLocal(localDate()))}</p></header>
  <pre>${esc(body)}</pre>
  <p class="muted">هذا المستند أُنشئ من بيانات المكتب المسجلة. كل مبلغ فيه مسجل بمصدره في بطاقة التنفيذ.</p>
  </body></html>`;
}

/* ----------------------- تنسيقات موحّدة للمستندات -----------------------
   الطباعة كانت تخرج بأرقام هندية (٣٬٠٠٠٫٠٠) وتواريخ ISO (2026-10-05) بينما
   بقية التطبيق وكشف الحساب يعرضان 3,000.00 و05/10/2026 — مستندان مختلفان في
   الملف الواحد. هنا توحيد واحد لكل مستندات التنفيذ المطبوعة. */
const printDate = iso => (isIsoDate(iso) ? `${String(iso).slice(8, 10)}/${String(iso).slice(5, 7)}/${String(iso).slice(0, 4)}` : '—');
export const printMoney = (value, currency = 'ج.م') => `${num(value).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}${currency ? ` ${currency}` : ''}`;

/**
 * مستند توكيل التنفيذ: يعرض المصادر والتفاصيل الفعلية المدخلة فقط.
 * كل سطر مبلغ يقابله سطر في الجدول، ومجموع الجدول = الإجمالي المطبوع (بلا فروق صامتة).
 */
export async function buildPoaDocument(office, poaId) {
  const detail = await poaDetail(office, poaId);
  const {poa, previous} = detail;
  const info = await executionBundle(office, poa.executionId);
  const [client, file] = await Promise.all([
    poa.clientId ? office.r.clients.get(poa.clientId).catch(() => null) : null,
    poa.fileId ? office.r.files.get(poa.fileId).catch(() => null) : null
  ]);
  const settings = executionSettings(office);
  const templates = await templatesFor(office);
  const template = templates.find(row => row.kind === 'poa') || DEFAULT_TEMPLATES.poa;
  // التوكيل لقطة تاريخية: تنفيذ محذوف لا يُفشل الطباعة بل يُطبع من اللقطة نفسها.
  const execution = info?.execution || {internalNumber: '', officialNumber: poa.officialNumber || '', executionType: poa.executionType || '', authority: poa.authority || ''};
  const judgmentRows = (info?.judgments || []).filter(judgment => !poa.judgmentIds?.length || poa.judgmentIds.includes(judgment.id));
  const parties = (info?.parties || []).filter(party => !party.isDeleted);
  const debtorName = parties.find(party => party.side === 'debtor')?.name || poa.debtorName || '';
  const creditorName = client?.fullName || parties.find(party => party.side === 'creditor')?.name || poa.clientName || '';
  const feesAmount = Number.isFinite(Number(poa.feesAmount)) ? Number(poa.feesAmount) : 0;
  const stampAmount = Number.isFinite(Number(poa.stampAmount)) ? Number(poa.stampAmount) : 0;
  const rowLines = (poa.lines || []);
  const kindLabel = {previous: 'رصيد سابق', period: 'فترة مستحقة', expense: 'مصروف / رسم', fee: 'رسوم', stamp: 'دمغة', difference: 'فرق حكم'};
  const tableRows = rowLines.map(line => `<tr>
      <td>${esc(line.label || '')}</td>
      <td>${esc(kindLabel[line.sourceType || line.kind] || '')}</td>
      <td>${esc(isIsoDate(line.fromDate) && isIsoDate(line.toDate) && line.fromDate !== line.toDate ? `${printDate(line.fromDate)} ← ${printDate(line.toDate)}` : (isIsoDate(line.fromDate) ? printDate(line.fromDate) : '—'))}</td>
      <td style="text-align:left;white-space:nowrap">${esc(printMoney(line.amount))}</td>
      <td>${esc(line.detail || '')}</td>
    </tr>`).join('');
  const tableSum = round2(rowLines.reduce((sum, line) => sum + num(line.amount), 0));
  const equation = [
    `رصيد سابق ${printMoney(poa.previousBalance)}`,
    `استحقاق الفترة ${printMoney(poa.baseAmount)}`,
    feesAmount ? `رسوم ${printMoney(feesAmount)}` : '',
    stampAmount ? `دمغة ${printMoney(stampAmount)}` : '',
    num(poa.expensesAmount) ? `مصروفات ${printMoney(poa.expensesAmount)}` : '',
    num(poa.differencesAmount) ? `فروق أحكام ${printMoney(poa.differencesAmount)}` : ''
  ].filter(Boolean).join(' + ') + ` = ${printMoney(poa.total)}`;
  const data = {
    office: OFFICE_NAME,
    date: printDate(localDate()),
    execution: {
      number: [execution.internalNumber, execution.officialNumber].filter(Boolean).join(' — '),
      type: executionTypeLabel(execution.executionType),
      authority: execution.authority || execution.executionOffice || '',
      officialNumber: execution.officialNumber || '',
      currentValue: info?.summary?.currentValue ? printMoney(info.summary.currentValue.amount) : '',
      currentFrom: printDate(info?.summary?.currentValue?.startDate || '')
    },
    client: {name: creditorName},
    debtor: {name: debtorName},
    file: {number: file?.fileNumber ? String(file.fileNumber) : '', title: file?.title || ''},
    judgments: judgmentRows.map(row => `${row.judgmentNumber || ''} ${printDate(row.judgmentDate || '')} — ${printMoney(row.amount ?? 0)}`.trim()).join(' · '),
    poa: {
      number: poa.poaNumber || '', date: printDate(poa.date), fromDate: printDate(poa.fromDate), toDate: printDate(poa.toDate),
      status: poaStatusLabel(poa.status), notes: poa.notes || '', previous: previous?.poaNumber || '',
      periodCount: rowLines.filter(line => (line.sourceType || line.kind) === 'period').length
    },
    totals: {
      previousBalance: printMoney(poa.previousBalance), baseAmount: printMoney(poa.baseAmount), differences: printMoney(poa.differencesAmount),
      expenses: printMoney(poa.expensesAmount), fees: printMoney(feesAmount), stamp: printMoney(stampAmount), total: printMoney(poa.total)
    },
    // لا ازدواج في المستند: البنود تُعرض مرة واحدة في الجدول أدناه.
    lines: `عدد البنود ${rowLines.length} — مفصّلة في الجدول أدناه.`,
    equation,
    tableSum: printMoney(tableSum)
  };
  // قالب المكتب من الإعدادات (lists.templates.poaBody) يتقدم على القالب المخزّن إن وُجد.
  const customBody = String(settings?.lists?.templates?.poaBody || '').trim();
  const rendered = customBody
    ? renderTemplate({title: template.title, body: customBody}, {...data, client: creditorName, debtor: debtorName, periods: data.poa.periodCount, total: data.totals.total, fees: data.totals.fees})
    : renderTemplate(template, data);
  const signature = `<div class="sign-row"><div><span class="muted">المحامي</span><div class="sign-line"></div><p>${esc(OFFICE_NAME)}</p></div><div><span class="muted">الموكل</span><div class="sign-line"></div><p>${esc(creditorName || '……………………………')}</p></div></div>`;
  const mismatch = Math.abs(tableSum - num(poa.total)) > 0.005
    ? `<p class="warn">⚠ فرق ${printMoney(Math.abs(tableSum - num(poa.total)))} بين مجموع البنود (${printMoney(tableSum)}) والإجمالي المسجل (${printMoney(poa.total)}) — راجع التوكيل في بطاقة التنفيذ.</p>` : '';
  const html = documentHtml({title: rendered.title, body: rendered.body, extraCss: `
    td:nth-child(4){text-align:left;white-space:nowrap}
    .equation{margin:10px 0;padding:8px 10px;border:1px dashed #999;background:#fafafa;font-size:12px}
    .sign-row{display:flex;gap:34px;margin-top:28px}
    .sign-row>div{flex:1}
    .sign-line{border-bottom:1px solid #333;height:26px;margin-bottom:4px}
    .warn{color:#8a4b00;background:#fff6e0;border:1px solid #e0b36a;padding:6px 8px;font-size:12px}
    .kv{width:100%;font-size:12px;margin:8px 0}
    .kv td{border:0;padding:2px 6px}
  `}).replace('</pre>', `</pre>
  <table class="kv"><tbody>
    <tr><td><b>الموكل (المستحق):</b> ${esc(creditorName || '—')}</td><td><b>المنفذ ضده:</b> ${esc(debtorName || '—')}</td></tr>
    <tr><td><b>جهة التنفيذ:</b> ${esc(execution.authority || '—')}</td><td><b>نوع التنفيذ:</b> ${esc(executionTypeLabel(execution.executionType) || '—')}</td></tr>
  </tbody></table>
  <table><thead><tr><th>البيان</th><th>النوع</th><th>المدة</th><th>المبلغ</th><th>المصدر / التفصيل</th></tr></thead><tbody>${tableRows || '<tr><td colspan="5">لا توجد بنود مسجلة</td></tr>'}</tbody>
  <tfoot><tr><th colspan="3">مجموع البنود</th><th style="text-align:left">${esc(printMoney(tableSum))}</th><th></th></tr></tfoot></table>
  <p class="equation"><b>المعادلة:</b> ${esc(equation)}</p>
  ${mismatch}
  ${signature}
  `);
  return {html, data, template, detail, equation, tableSum};
}

/** كشف الرصيد: الحكم، الفترات، الاستحقاقات، التحصيلات، الفروق، التخصيص، الرصيد. */
export async function buildBalanceDocument(office, executionId, {asOf = ''} = {}) {
  const info = await executionBundle(office, executionId, {asOf, checkIntegrity: true});
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
  const balanceBlocked = Boolean(info.summary.integrityBlocked);
  const printBalanceMoney = value => balanceBlocked ? 'غير متاح — أوقف فحص السلامة عرض الحساب' : money(value);
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
      finalEntitlement: printBalanceMoney(info.summary.finalEntitlement), collected: printBalanceMoney(info.summary.collected), remaining: printBalanceMoney(info.summary.remaining),
      originalOutstanding: printBalanceMoney(info.summary.originalOutstanding), differencePart: printBalanceMoney(info.summary.differencePart),
      approvedDifferences: printBalanceMoney(info.summary.differences.approved), pendingDifferences: printBalanceMoney(info.summary.differences.pending),
      expenses: printBalanceMoney(info.summary.expenses)
    },
    periods: balanceBlocked ? `فشل فحص السلامة: ${info.summary.integrityMessage}` : `الفترة | النوع | الاستحقاق النهائي | المحصل | المتبقي | فرق الحكم | المعادلة\n${periodText || 'لا توجد فترات محسوبة'}`,
    receipts: `المحضر | التاريخ | المبلغ | التخصيص\n${receiptText || 'لا توجد محاضر تحصيل مسجلة'}`,
    equations: balanceBlocked ? `لم يُعرض حساب رصيد جزئي. ${info.summary.integrityMessage}` : (info.summary.equations || []).join('\n')
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

const AUTO_PRINT_SNIPPET = '<script>window.addEventListener("load",()=>{window.focus();window.print()},{once:true});</script>';

/**
 * حجز نافذة الطباعة **داخل نقرة المستخدم** وقبل أي قراءة من IndexedDB.
 *
 * السبب: المتصفحات تمنع `window.open` بعد `await` (فقد «التفعيل اللحظي» للمستخدم)،
 * فكانت كل مسارات الطباعة في مركز التنفيذ تُفتح أحيانًا بلا نافذة وبلا رسالة خطأ.
 * تُفتح النافذة هنا برسالة «جارٍ التجهيز» ثم تُكتب فيها النتيجة عبر `writePrintDocument`.
 */
export function acquirePrintWindow(label = 'مستند الطباعة') {
  if (typeof window === 'undefined' || typeof window.open !== 'function') return null;
  let opened = null;
  try { opened = window.open('', '_blank'); } catch { opened = null; }
  if (!opened) {
    try { alert('اسمح بالنوافذ المنبثقة للطباعة، ثم أعد المحاولة.'); } catch { /* بيئة بلا alert */ }
    return null;
  }
  try {
    opened.opener = null;
    opened.document.open();
    // النص المؤقت لا يذكر اسم المستند حتى لا تلتبس «جارٍ التجهيز» بالمستند
    // النهائي عند أي فحص يقرأ محتوى النافذة قبل اكتمال الكتابة.
    opened.document.write(`<!doctype html><html lang="ar" dir="rtl" data-print-pending="1"><head><meta charset="utf-8"><title>${esc(label)}</title>
      <style>body{font-family:"Noto Sans Arabic","Segoe UI",Tahoma,sans-serif;padding:32px;color:#333}
      .spin{display:inline-block;width:18px;height:18px;border:3px solid #ddd;border-top-color:#26364b;border-radius:50%;animation:sp 1s linear infinite;vertical-align:-4px;margin-inline-end:8px}
      @keyframes sp{to{transform:rotate(360deg)}}</style></head>
      <body><p><span class="spin"></span> جارٍ تجهيز المستند من سجلات المكتب…</p>
      <p class="muted" style="font-size:12px;color:#666">إن بقيت هذه الرسالة فمعناها أن القراءة من قاعدة البيانات المحلية فشلت — أغلق النافذة وراجع بطاقة التنفيذ.</p></body></html>`);
    opened.document.close();
  } catch { /* النافذة محجوزة؛ الكتابة لاحقة */ }
  return opened;
}

/** كتابة مستند مكتمل داخل نافذة طباعة محجوزة، مع ترقيم الصفحات ونقر الطباعة التلقائي. */
export function writePrintDocument(target, html) {
  if (!target) return null;
  try {
    if (target.closed) return null;
    const wrapped = wrapForPrint(String(html || ''));
    const withPrint = /<\/body>/i.test(wrapped)
      ? wrapped.replace(/<\/body>/i, `${AUTO_PRINT_SNIPPET}</body>`)
      : `${wrapped}${AUTO_PRINT_SNIPPET}`;
    target.document.open();
    target.document.write(withPrint);
    target.document.close();
    // علامة حتمية على اكتمال الكتابة (ينتظرها الفحص بدل تخمين نص المستند).
    try { target.document.documentElement?.setAttribute('data-print-written', '1'); } catch { /* تجاهل */ }
    return target;
  } catch (error) {
    try { target.close(); } catch { /* تجاهل */ }
    throw new AppError(ERR.UNKNOWN, 'تعذر تجهيز مستند الطباعة.');
  }
}

/** إغلاق نافذة محجوزة عند فشل بناء المستند، حتى لا تبقى صفحة «جارٍ التجهيز» عالقة. */
export function releasePrintWindow(target, message = '') {
  if (!target) return;
  try {
    if (target.closed) return;
    if (message) {
      target.document.open();
      target.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>تعذرت الطباعة</title></head>
        <body style="font-family:'Noto Sans Arabic','Segoe UI',Tahoma,sans-serif;padding:32px"><h2>تعذر تجهيز المستند للطباعة</h2>
        <p>${esc(message)}</p><p class="muted">أغلق هذه النافذة وأعد المحاولة من بطاقة التنفيذ.</p></body></html>`);
      target.document.close();
      return;
    }
    target.close();
  } catch { /* تجاهل */ }
}

/** فتح مستند للطباعة: النافذة تُفتح أثناء نقر المستخدم قبل أي قراءة. */
export function openDocumentForPrint(html, {window: preOpened = null, label = 'مستند الطباعة'} = {}) {
  if (typeof window === 'undefined' && !preOpened) return null;
  // مسار «احجز أولًا ثم اكتب»: يعيد استخدام النافذة المفتوحة داخل النقرة.
  if (preOpened) return writePrintDocument(preOpened, html);
  const w = acquirePrintWindow(label);
  if (!w) return null;
  return writePrintDocument(w, html);
}

/** مسار «اضغط للطباعة»: تُفتح النافذة أولًا ثم تُقرأ البيانات ثم يُكتب المستند. */
export async function printPoa(office, poaId, {window: preOpened = null} = {}) {
  const w = preOpened || (typeof window === 'undefined' ? null : acquirePrintWindow('توكيل بالتنفيذ'));
  if (typeof window !== 'undefined' && !w) return null;
  try {
    const {html} = await buildPoaDocument(office, poaId);
    if (!w) return html;
    return writePrintDocument(w, html) || html;
  } catch (error) {
    releasePrintWindow(w, error?.message || String(error));
    throw error;
  }
}

export async function printBalanceStatement(office, executionId, {asOf = '', window: preOpened = null} = {}) {
  const w = preOpened || (typeof window === 'undefined' ? null : acquirePrintWindow('كشف رصيد التنفيذ'));
  if (typeof window !== 'undefined' && !w) return null;
  try {
    const {html} = await buildBalanceDocument(office, executionId, {asOf});
    if (!w) return html;
    return writePrintDocument(w, html) || html;
  } catch (error) {
    releasePrintWindow(w, error?.message || String(error));
    throw error;
  }
}

export {poaStatusLabel, ledgerTypeLabel, differenceStatusLabel, valueTypeLabel, executionPoaRows, isIsoDate};
