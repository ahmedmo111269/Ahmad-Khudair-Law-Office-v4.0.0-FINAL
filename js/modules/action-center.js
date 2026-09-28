import {esc} from '../ui/dom.js';
import {actionCenterBrief,actionRows} from '../services/action-center.js';
import {formatDate,formatDateTime,formatTime,formatNumber} from '../core/format.js';

const fmt=v=>formatDate(v);
const time=v=>formatTime(v);

export async function actionCenterPage(app){
  const r=await actionCenterBrief(app.office);
  const sections=[
    ['today','اليوم',r.todayHearings,'جلسات اليوم'],
    ['overdue','متأخر',r.overdueProcedures,'أعمال إدارية متأخرة'],
    ['next3','خلال 3 أيام',[...r.hearingsNext3,...r.proceduresNext3,...r.appointments,...r.followups],'ما يستحق المتابعة قريبًا'],
    ['week','هذا الأسبوع',[...r.hearingsNextWeek,...r.proceduresNextWeek,...r.fileNext],'أعمال وخطوات هذا الأسبوع'],
    ['stale','يحتاج مراجعة',r.staleFiles,'ملفات مفتوحة بلا نشاط منذ 30 يومًا']
  ];
  return `<div class="page-head"><div><h2>مركز العمل والمتابعة</h2><p>ما يحتاج إلى إجراء الآن، وما اقترب موعده، وما يستحق المراجعة.</p></div><div class="head-actions"><button class="ghost" data-page-back>رجوع</button><button class="ghost" data-page-close>إغلاق</button><button class="primary" data-action-refresh>تحديث</button></div></div>
  <div class="work-queue-summary"><div><b>${r.todayHearings.length}</b><span>جلسات اليوم</span></div><div><b>${r.overdueProcedures.length}</b><span>متأخر</span></div><div><b>${r.proceduresNext3.length+r.hearingsNext3.length}</b><span>خلال 3 أيام</span></div><div><b>${r.hearingsNextWeek.length+r.proceduresNextWeek.length+r.fileNext.length}</b><span>خطوات هذا الأسبوع</span></div><div><b>${r.staleFiles.length}</b><span>تحتاج مراجعة</span></div></div>
  <div class="action-tabs">${sections.map((s,i)=>`<button class="${i===0?'active':''}" data-action-tab="${s[0]}">${s[1]}</button>`).join('')}</div>
  <div id="action-sections">${sections.map((s,i)=>`<section class="panel action-section" data-action-section="${s[0]}" ${i?'hidden':''}><div class="section-head"><div><h3>${s[3]}</h3><small>${s[2].length} عنصر</small></div></div><div class="action-list">${renderItems(s[2],s[0])}</div></section>`).join('')}</div>`;
}
function renderItems(items,bucket){
 if(!items.length)return '<p class="muted">لا توجد عناصر في هذه المجموعة.</p>';
 const rows=items.map(x=>({raw:x,kind:x.hearingDate?'جلسة':x.internalDueDate?(x.status==='pending'?'إجراء':'إجراء'):x.followUpDate?'متابعة':x.nextStepDate?'خطوة ملف':'ملف',date:x.hearingDate||x.internalDueDate||x.followUpDate||x.nextStepDate||x.lastActivityAt||'',title:x.reason||x.description||x.subject||x.nextStep||x.title||'عنصر متابعة',route:x.caseId?`case:${x.caseId}`:x.fileId?`file:${x.fileId}`:`file:${x.id}`}));
 return rows.sort((a,b)=>String(a.date).localeCompare(String(b.date))).map(x=>`<button class="action-item" data-action-open="${esc(x.route)}"><span class="action-kind">${esc(x.kind)}</span><b>${esc(x.title)}</b><time>${esc(fmt(x.date))} ${esc(time(x.date))}</time><small>${esc(x.raw.fileNumber||x.raw.caseNumber||x.raw.priority||x.raw.status||'')}</small></button>`).join('');
}
export function bindActionCenter(app){
 document.querySelectorAll('[data-action-tab]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-action-tab]').forEach(x=>x.classList.remove('active'));b.classList.add('active');document.querySelectorAll('[data-action-section]').forEach(s=>s.hidden=s.dataset.actionSection!==b.dataset.actionTab)});
 document.querySelectorAll('[data-action-open]').forEach(b=>b.onclick=()=>app.go(b.dataset.actionOpen));
 document.querySelector('[data-action-refresh]')?.addEventListener('click',()=>app.refresh());
}
