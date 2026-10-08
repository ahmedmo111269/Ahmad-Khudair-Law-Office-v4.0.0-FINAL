// =====================================================================
// واجهة التشغيل المشتركة — «الآن» و«يحتاج انتباهك» و«جدول اليوم» و«ما الذي حدث؟»
// ومركز عمل الموكل وكوكبيت الملف. مكوّنات HTML + ربط سلوك، بلا قراءة/كتابة مباشرة
// للبيانات إلا عبر الخدمات المعتمدة (completeItem لإنجاز عمل إداري).
// ---------------------------------------------------------------------
// قواعد التنفيذ الموحدة:
//   • أي عنصر له إجراء يظهر في الطابور بنفس الشكل في كل الشاشات.
//   • «✓ تم» تُنفَّذ من الطابور مباشرة عبر مسار مركز العمل الرسمي (completeItem)،
//     ثم تُحدَّث الشاشة الحالية — بلا مغادرة ولا إعادة إدخال.
//   • كل عنصر يحمل data-route فيتولاه التنقل المركزي في app.js.
// =====================================================================
import {esc} from './dom.js';
import {SEVERITY} from '../services/focus-engine.js';
import {formatDateTime} from '../core/format.js';
import {ENTITIES} from '../domain/entities.js';
import {toast} from './toast.js';
import {userError} from '../core/errors.js';
import {executionContextSummary} from '../services/execution-work.js';
import {completeItem} from '../services/work-items.js';
import {overlayId} from '../domain/work-items.js';
import {formatFileNumber} from '../core/file-number.js';
import {money} from './execution-work-view.js';

const ATTN_LIMIT=12;

/** البطاقة الكبيرة: «الآن» — الخطوة التالية المقترحة مع إجراء واحد واضح. */
export function focusHtml(model,{dayLabel=''}={}){
 const next=model.next;
 const upcoming=model.attention.filter(x=>x!==next).slice(0,3);
 if(!next){
  return `<section class="cp-focus cp-focus--calm" data-section-id="focus" aria-labelledby="cp-focus-title">
   <header class="cp-focus-head"><span class="cp-eyebrow">الآن</span><span class="cp-chip cp-chip--ok">لا عاجل</span></header>
   <h2 id="cp-focus-title">لا شيء يستعجل قرارك الآن</h2>
   <p class="cp-meta">${esc(dayLabel)} — كل الجلسات والأعمال المتأخرة مغطاة. وقت مناسب للمتابعة المنهجية أو إضافة عمل جديد.</p>
   <div class="cp-actions"><button class="primary" type="button" data-quick-add>+ إضافة</button><button class="ghost" type="button" data-route="actionCenter">مركز العمل</button><button class="ghost" type="button" data-route="files">الملفات</button></div>
  </section>`;
 }
 const sev=SEVERITY[next.severity]||SEVERITY.normal;
 return `<section class="cp-focus cp-focus--${esc(next.severity)}" data-section-id="focus" aria-labelledby="cp-focus-title">
  <header class="cp-focus-head"><span class="cp-eyebrow">الآن · الخطوة التالية</span><span class="cp-chip cp-chip--${esc(sev.tone||'neutral')}">${esc(sev.label)}</span></header>
  <h2 id="cp-focus-title">${esc(next.title)}</h2>
  <p class="cp-meta"><b>${esc(next.when)}</b>${next.meta?` <span aria-hidden="true">·</span> ${esc(next.meta)}`:''}</p>
  <div class="cp-actions">
   <button class="primary cp-primary" type="button" data-route="${esc(next.route)}">${esc(next.actionLabel)} <span aria-hidden="true">←</span></button>
   ${doneBtn(next)}
   <button class="ghost" type="button" data-route="actionCenter">مركز العمل</button>
  </div>
  ${upcoming.length?`<div class="cp-then"><span class="cp-then-label">ثم</span><ol>${upcoming.map(x=>`<li><button type="button" data-route="${esc(x.route)}"><span class="cp-dot cp-dot--${esc(x.severity)}" aria-hidden="true"></span><span>${esc(x.title)}</span><small>${esc(x.when)}</small></button></li>`).join('')}</ol></div>`:''}
 </section>`;
}

/** زر «✓ تم» للأعمال الإدارية فقط (الجلسات تُسجَّل نتيجتها داخل بطاقتها). */
function doneBtn(x){
 if(x.kind!=='procedure')return '';
 const id=procId(x.route);
 return id?`<button class="ghost cp-done" type="button" data-complete-proc="${esc(id)}" title="تسجيل إنجاز العمل دون مغادرة هذه الشاشة">✓ تم</button>`:'';
}
const procId=route=>{const m=/^rec:procedures:(.+)$/.exec(String(route||''));return m?m[1]:''};

/** شريط الأعداد: ماذا يوجد؟ بنقرة تصفّي الطابور. */
export function countsHtml(model){
 const c=model.counts;
 const chip=(k,n)=>`<button type="button" class="cp-count cp-count--${k}" data-attn-filter="${k}" aria-pressed="false"><b>${n}</b><span>${SEVERITY[k].label}</span></button>`;
 return `<div class="cp-counts" role="group" aria-label="تصفية حسب الأهمية">
  <button type="button" class="cp-count cp-count--all is-on" data-attn-filter="all" aria-pressed="true"><b>${model.total}</b><span>الكل</span></button>
  ${chip('critical',c.critical)}${chip('high',c.high)}${chip('normal',c.normal)}${chip('info',c.info)}
 </div>`;
}

/**
 * بنود التنفيذ التي لم تعد تظهر في أول ATTN_LIMIT صفًا من الطابور.
 * وجودها يعني أن الطابور مقصوص، فيلزم طريق واضح من «مكتب اليوم» إلى التنفيذ
 * الذي يحتاج قرارًا (Wave 6.1) — بلا تغيير في ترتيب الأولوية أو سقف الشدة.
 */
const hiddenExecutions = model => (model?.attention || []).slice(ATTN_LIMIT).filter(item => item.kind === 'execution');

/** طابور «يحتاج انتباهك» مرتبًا حسب الأهمية ثم الزمن. opts.title/tools للتخصيص حسب الشاشة. */
export function attentionHtml(model,{title='طابور القرارات',eyebrow='يحتاج انتباهك',tools=true}={}){
 const rows=model.attention.slice(0,ATTN_LIMIT);
 const rest=model.attention.length-rows.length;
 return `<section class="cp-attn" data-section-id="attention" aria-labelledby="cp-attn-title">
  <header class="cp-attn-head">
   <div><span class="cp-eyebrow">${esc(eyebrow)}</span><h2 id="cp-attn-title">${esc(title)}</h2></div>
   ${tools?`<div class="cp-attn-tools"><button type="button" class="ghost small" data-route="reports?type=procedures&amp;preset=overdue">تقرير المتأخرات</button><button type="button" class="ghost small" data-route="powersOfAttorney">التوكيلات</button></div>`:''}
  </header>
  ${countsHtml(model)}
  ${rows.length?`<ul class="cp-list" data-attn-list>${rows.map(attnRow).join('')}</ul>
   ${rest>0?`<p class="cp-more muted small">+${rest} عنصر آخر${hiddenExecutions(model).length?` (منها ${esc(String(hiddenExecutions(model).length))} تنفيذ يحتاج قرارًا — <button type="button" class="link" data-route="executionCenter">مركز التنفيذ</button>)`:''} — استخدم الفلاتر أو <button type="button" class="link" data-route="actionCenter">مركز العمل</button> لعرض الكل.</p>`:''}`
   :`<div class="cp-empty"><span aria-hidden="true">✓</span><p>لا توجد عناصر تحتاج انتباهك الآن.</p></div>`}
 </section>`;
}

function attnRow(x){
 const sev=SEVERITY[x.severity]||SEVERITY.normal;
 return `<li class="cp-row cp-row--${esc(x.severity)}" data-sev="${esc(x.severity)}">
  <button type="button" class="cp-row-main" data-route="${esc(x.route)}">
   <span class="cp-dot cp-dot--${esc(x.severity)}" aria-hidden="true"></span>
   <span class="cp-row-text"><b>${esc(x.title)}</b>${x.meta?`<small>${esc(x.meta)}</small>`:''}</span>
   <span class="cp-row-when">${esc(x.when)}</span>
   <span class="cp-row-sev">${esc(sev.label)}</span>
   <span class="cp-row-go" aria-hidden="true">${esc(x.actionLabel)} ←</span>
  </button>
  ${doneBtn(x)}
 </li>`;
}

/** جدول اليوم الزمني. */
export function timelineHtml(model,{dayLabel='',empty='لا جلسات ولا مواعيد اليوم. يوم مناسب للمتابعات والأعمال المتأخرة.'}={}){
 const rows=model.timeline;
 return `<section class="cp-day" data-section-id="today" aria-labelledby="cp-day-title">
  <header class="cp-day-head"><div><span class="cp-eyebrow">جدول اليوم</span><h2 id="cp-day-title">${esc(dayLabel)}</h2></div><span class="cp-chip">${rows.length} عنصر</span></header>
  ${rows.length?`<ol class="cp-tl">${rows.map(x=>`<li class="${x.past?'is-past':''}${x.kind==='hearing'?' is-hearing':''}">
    <time>${esc(x.time||'—')}</time>
    <button type="button" data-route="${esc(x.route)}"><b>${esc(x.title)}</b><small>${esc(kindLabel(x.kind))}${x.meta?` · ${esc(x.meta)}`:''}</small></button>
   </li>`).join('')}</ol>`
   :`<div class="cp-empty cp-empty--soft"><span aria-hidden="true">◌</span><p>${esc(empty)}</p></div>`}
 </section>`;
}

const kindLabel=k=>({hearing:'جلسة',appointment:'موعد',followup:'متابعة اتصال',execution:'تنفيذ'})[k]||'';

/** ما الذي حدث؟ — آخر تحركات السجل (قراءة فقط). */
export function activityHtml(rows){
 return `<section class="cp-activity" data-section-id="activity" aria-labelledby="cp-act-title">
  <header class="cp-day-head"><div><span class="cp-eyebrow">ما الذي حدث؟</span><h2 id="cp-act-title">آخر التحركات</h2></div><span class="muted small">آخر ${rows.length||0} تحرّك</span></header>
  ${rows.length?`<ol class="cp-tl cp-tl--log">${rows.map(r=>{
    const ent=ENTITIES[r.entityType]?.label||'';
    const inner=`<time>${esc(formatDateTime(r.timestamp)||'')}</time><span class="cp-log-txt">${esc(r.summary||'نشاط')}${ent?`<small>${esc(ent)}</small>`:''}</span>`;
    return `<li>${r.fileId?`<button type="button" data-route="file:${esc(r.fileId)}">${inner}</button>`:`<div>${inner}</div>`}</li>`;
   }).join('')}</ol>`:`<div class="cp-empty cp-empty--soft"><span aria-hidden="true">◌</span><p>لا توجد تحركات مسجلة بعد.</p></div>`}
 </section>`;
}

/** آخر ما أُنجز — يغلق الحلقة: ما تم، بجانب ما هو قائم. */
export function doneListHtml(rows){
 return `<section class="cp-done-list" data-section-id="done" aria-labelledby="cp-done-title">
  <header class="cp-day-head"><div><span class="cp-eyebrow">ما الذي أُنجز</span><h2 id="cp-done-title">آخر الأعمال المنجزة</h2></div></header>
  ${rows.length?`<ol class="cp-tl cp-tl--log">${rows.map(r=>`<li><button type="button" data-route="rec:procedures:${esc(r.id)}"><span class="cp-log-txt"><b>✓ ${esc(r.title)}</b>${r.fileLabel?`<small>${esc(r.fileLabel)}</small>`:''}</span></button></li>`).join('')}</ol>`
   :`<div class="cp-empty cp-empty--soft"><span aria-hidden="true">◌</span><p>لم تُسجَّل أعمال منجزة بعد.</p></div>`}
 </section>`;
}

/**
 * مركز عمل الموكل: الخطوة التالية عبر كل ملفاته + جدول اليوم + طابور الموكل + آخر الإنجازات.
 * model: buildFocusModel(...) لبيانات الموكل، recentDone: صفوف منجزة.
 */
export function clientWorkspaceHtml({model,recentDone=[],clientName='',dayLabel='',clientId='',executions=[],fileLabelOf=null}){
 return `<div class="cp-client-ws" aria-label="مركز عمل الموكل ${esc(clientName)}">
  <div class="cp-stage">
   ${focusHtml(model,{dayLabel})}
   ${timelineHtml(model,{dayLabel:'مواعيد الموكل اليوم',empty:'لا جلسات ولا مواعيد لهذا الموكل اليوم.'})}
  </div>
  ${executionStripHtml({
    summary:executionContextSummary(executions),scope:'client',fileLabelOf:fileLabelOf||null,
    route:`executionCenter${clientId?`?clientId=${encodeURIComponent(clientId)}`:''}`,
    emptyHint:'لا يوجد تنفيذ مرتبط بملفات هذا الموكل بعد.'
  })}
  ${attentionHtml(model,{title:'ما يحتاج قرارًا أو متابعة',eyebrow:'مركز الموكل',tools:false})}
  ${doneListHtml(recentDone)}
 </div>`;
}

/**
 * كوكبيت الملف: الخطوة التالية + مؤشرات الحالة، فوق التبويبات مباشرة.
 * يُعرض قبل الخوض في التفاصيل: أين وصل الملف، وماذا يجب فعله.
 */
export function fileCockpitHtml({hearings=[],procedures=[],stages=[],parties=[],today='',currentStage=''}={}){
 const dayOf=v=>String(v||'').slice(0,10);
 const upcomingHearings=hearings.filter(h=>dayOf(h.hearingDate)>=today&&!h.result).sort((a,b)=>(dayOf(a.hearingDate)+(a.hearingTime||'99')).localeCompare(dayOf(b.hearingDate)+(b.hearingTime||'99')));
 const active=procedures.filter(p=>!p.status||p.status==='open'||p.status==='pending');
 const overdue=active.filter(p=>dayOf(p.internalDueDate)&&dayOf(p.internalDueDate)<today).sort((a,b)=>dayOf(a.internalDueDate).localeCompare(dayOf(b.internalDueDate)));
 const dueSoon=active.filter(p=>dayOf(p.internalDueDate)>=today).sort((a,b)=>dayOf(a.internalDueDate).localeCompare(dayOf(b.internalDueDate)));

 let next;
 if(upcomingHearings[0]){const h=upcomingHearings[0];const d=dayOf(h.hearingDate);
  next={tone:d===today?'danger':'info',eyebrow:d===today?'جلسة اليوم':'الجلسة القادمة',title:`${h.type||h.reason||'جلسة'} — ${fmt(d)}${h.hearingTime?' · '+String(h.hearingTime).slice(0,5):''}`,meta:h.court?`${h.court}${h.chamber?' · '+h.chamber:''}`:'',route:`rec:hearings:${h.id}`,label:'فتح الجلسة',done:''};
 }else if(overdue[0]){const p=overdue[0];
  next={tone:'danger',eyebrow:'عمل متأخر',title:p.description||p.type||'عمل إداري',meta:`كان موعده ${fmt(dayOf(p.internalDueDate))}`,route:`rec:procedures:${p.id}`,label:'تنفيذ الآن',done:p.id};
 }else if(dueSoon[0]){const p=dueSoon[0];
  next={tone:'warn',eyebrow:'العمل التالي',title:p.description||p.type||'عمل إداري',meta:`الموعد ${fmt(dayOf(p.internalDueDate))}`,route:`rec:procedures:${p.id}`,label:'تنفيذ',done:p.id};
 }
 const nextBlock=next?`<div class="cp-fc-next cp-fc-next--${next.tone}">
   <span class="cp-eyebrow">${esc(next.eyebrow)}</span>
   <b class="cp-fc-title">${esc(next.title)}</b>
   <small class="muted">${esc(next.meta)}</small>
   <div class="cp-actions cp-actions--tight"><button type="button" class="primary small" data-route="${esc(next.route)}">${esc(next.label)} <span aria-hidden="true">←</span></button>${next.done?`<button type="button" class="ghost small cp-done" data-complete-proc="${esc(next.done)}">✓ تم</button>`:''}</div>
  </div>`:`<div class="cp-fc-next cp-fc-next--calm">
   <span class="cp-eyebrow">الخطوة التالية</span>
   <b class="cp-fc-title">لا توجد خطوة مجدولة</b>
   <small class="muted">أضف جلسة أو عملًا إداريًا ليظهر هنا ويدخل جدول اليوم.</small>
   <button type="button" class="ghost small" data-cp-task>+ عمل إداري</button>
  </div>`;
 return `<section class="cp-fc" aria-label="مركز الملف">
  ${nextBlock}
  <dl class="cp-fc-stats">
   <div><dt>جلسات قادمة</dt><dd>${upcomingHearings.length}</dd></div>
   <div><dt>أعمال مفتوحة</dt><dd>${active.length}</dd></div>
   <div class="${overdue.length?'is-alert':''}"><dt>متأخرة</dt><dd>${overdue.length}</dd></div>
   <div><dt>المراحل</dt><dd>${stages.length}</dd></div>
   <div><dt>الأطراف</dt><dd>${parties.length}</dd></div>
   ${currentStage?`<div class="cp-fc-stage"><dt>المرحلة الحالية</dt><dd>${esc(currentStage)}</dd></div>`:''}
  </dl>
 </section>`;
}

function fmt(d){const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d||''));return m?`${m[3]}/${m[2]}/${m[1]}`:''}

/**
 * شريط التنفيذ السياقي (Wave 6.1) — مكوّن واحد يخدم كوكبيت الملف ومركز الموكل.
 * ---------------------------------------------------------------------
 * ليس نسخة من مركز التنفيذ: لا طابور ولا نماذج ولا كتابة.
 *   • الحالة: كم تنفيذًا، ما يحتاج قرارًا، المتأخرات، المتبقي (نفس عدّادات الطابور).
 *   • الخطوة التالية: أهم تنفيذ واحد مع خطوته الجاهزة من خدمات التنفيذ.
 *   • الوصول: كل صف يفتح بطاقة التنفيذ، والزر يفتح مركز التنفيذ مقصورًا على هذا
 *     الملف/الموكل (`?fileId=` / `?clientId=`) — علاقة Client ← File ← Execution واضحة
 *     بلا تكرار لوظائف المركز.
 * @param {object} o
 * @param {{items:Array,counts:object,total:number}} o.summary  ناتج executionContextSummary
 * @param {string} o.route   Face route لمركز التنفيذ في نطاق هذا السياق
 * @param {'file'|'client'} o.scope
 * @param {number} [o.limit] عدد الصفوف المعروضة (الباقي بإشارة واحدة)
 * @param {function} [o.fileLabelOf] لإظهار اسم الملف على كل صف في سياق الموكل
 */
export function executionStripHtml({summary={},route='executionCenter',scope='file',limit=3,fileLabelOf=null,emptyHint=''}={}){
 const items=summary.items||[],counts=summary.counts||null;
 const rows=items.slice(0,limit),more=Math.max(0,items.length-rows.length);
 const fileIdOf=item=>String(item.fileId||'');
 const row=x=>{
  const amount=Number(x.overdueMinor||0)>0?{value:x.overdueMinor,label:'متأخر'}:{value:x.remainingTotal,label:'المتبقي'};
  const fileLabel=scope==='client'?(fileLabelOf?.(fileIdOf(x))||x.fileNumberText||(x.fileNumber?formatFileNumber(x.fileNumber):'')):'';
  const fileNote=scope==='client'?[fileLabel?`ملف ${fileLabel}`:'',x.executionTypeLabel].filter(Boolean).join(' · '):(x.executionTypeLabel||x.authority||'');
  return `<li class="cp-exec-row cp-exec-row--${esc(x.severity)}">
   <button type="button" class="cp-exec-main" data-route="exc:${esc(x.id)}" aria-label="فتح بطاقة التنفيذ ${esc(x.displayNumber||'')}">
    <span class="cp-dot cp-dot--${esc(x.severity)}" aria-hidden="true"></span>
    <span class="cp-exec-text">
     <b>${esc(x.displayNumber||'تنفيذ بلا رقم')}${x.clientName?` — ${esc(x.clientName)}`:''}${x.opponentName?` <span class="muted">ضد</span> ${esc(x.opponentName)}`:''}</b>
     <small>${x.step?`<span>${esc(x.step.label)}</span>`:''}${fileNote?`<span class="cp-exec-chip">${esc(fileNote)}</span>`:''}</small>
    </span>
    <span class="cp-exec-money"><b>${money(amount.value,x.currency)}</b><small>${amount.label}</small></span>
    <span class="cp-exec-go" aria-hidden="true">فتح ←</span>
   </button></li>`;
 };
 const pulse=counts?`<p class="cp-exec-pulse"><span><b>${counts.all}</b> تنفيذ</span><span class="${counts.attention?'is-alert':''}"><b>${counts.attention}</b> يحتاج قرارًا</span><span class="${Number(counts.overdueMinor||0)?'is-alert':''}">متأخرات <b>${money(counts.overdueMinor||0)}</b></span><span>المتبقي <b>${money(counts.remainingMinor||0)}</b></span></p>`:'';
 return `<section class="cp-exec" data-section-id="execution" data-exec-strip aria-label="سياق التنفيذ">
  <header class="cp-exec-head">
   <div><span class="cp-eyebrow">التنفيذ</span><h3 class="cp-exec-title">${esc(scope==='client'?'تنفيذ الموكل':'التنفيذ المرتبط بهذا الملف')}</h3></div>
   <button type="button" class="ghost small" data-route="${esc(route)}">مركز التنفيذ <span aria-hidden="true">←</span></button>
  </header>
  ${rows.length?`${pulse}<ul class="cp-exec-list">${rows.map(row).join('')}</ul>
   ${more?`<p class="cp-exec-more muted small">+${more} ${more===1?'تنفيذ آخر':'تنفيذات أخرى'} — <button type="button" class="link" data-route="${esc(route)}">اعرض الكل في مركز التنفيذ</button></p>`:''}`
  :`<p class="cp-exec-empty muted small">${esc(emptyHint||(scope==='client'?'لا يوجد تنفيذ مرتبط بملفات هذا الموكل بعد.':'لا يوجد تنفيذ مرتبط بهذا الملف بعد.'))} <button type="button" class="link" data-route="${esc(route)}">مركز التنفيذ</button></p>`}
 </section>`;
}

/**
 * سلوك مشترك لكل شاشة فيها كوكبيت/طابور:
 *  - فلترة بالأهمية دون إعادة رسم
 *  - «✓ تم» للأعمال الإدارية: completeItem ← تحديث الشاشة (refresh) بلا مغادرة
 */
export function bindCockpit(root,app){
 if(!root)return;
 const bar=root.querySelector('.cp-counts');
 const list=root.querySelector('[data-attn-list]');
 bar?.querySelectorAll('[data-attn-filter]').forEach(btn=>btn.addEventListener('click',()=>{
  const f=btn.dataset.attnFilter;
  bar.querySelectorAll('[data-attn-filter]').forEach(b=>{const on=b===btn;b.classList.toggle('is-on',on);b.setAttribute('aria-pressed',String(on))});
  list?.querySelectorAll('[data-sev]').forEach(li=>{li.hidden=!(f==='all'||li.dataset.sev===f)});
 }));
 root.querySelectorAll('[data-complete-proc]').forEach(btn=>btn.addEventListener('click',async e=>{
  e.preventDefault();e.stopPropagation();
  const id=btn.dataset.completeProc;
  btn.disabled=true;
  try{
   await completeItem(app.office,overlayId('procedures',id));
   toast('تم تسجيل إنجاز العمل ✓');
   await app.refresh();
  }catch(err){btn.disabled=false;toast(userError(err),'error')}
 }));
}
