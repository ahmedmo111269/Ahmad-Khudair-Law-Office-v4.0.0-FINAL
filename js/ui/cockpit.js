// =====================================================================
// واجهة «مكتب اليوم» وكوكبيت الملف — مكوّنات عرض مشتركة (HTML فقط)
// ---------------------------------------------------------------------
// لا تقرأ ولا تكتب في قاعدة البيانات. تستقبل نماذج جاهزة من:
//   • services/focus-engine.js  (الرئيسية)
//   • الملف نفسه                (كوكبيت الملف)
// وكل عنصر قابل للنقر يحمل data-route فيتولاه التنقل المركزي في app.js.
// الفلترة والحالة الفورية تُربط في bindCockpit() بلا إعادة رسم للصفحة.
// =====================================================================
import {esc} from './dom.js';
import {SEVERITY} from '../services/focus-engine.js';
import {formatDateTime} from '../core/format.js';
import {ENTITIES} from '../domain/entities.js';

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
   <button class="ghost" type="button" data-route="actionCenter">مركز العمل</button>
  </div>
  ${upcoming.length?`<div class="cp-then"><span class="cp-then-label">ثم</span><ol>${upcoming.map(x=>`<li><button type="button" data-route="${esc(x.route)}"><span class="cp-dot cp-dot--${esc(x.severity)}" aria-hidden="true"></span><span>${esc(x.title)}</span><small>${esc(x.when)}</small></button></li>`).join('')}</ol></div>`:''}
 </section>`;
}

/** شريط الأعداد: ماذا يوجد؟ بنقرة تصفّي الطابور. */
export function countsHtml(model){
 const c=model.counts;
 const chip=(k,n)=>`<button type="button" class="cp-count cp-count--${k}" data-attn-filter="${k}" aria-pressed="false"><b>${n}</b><span>${SEVERITY[k].label}</span></button>`;
 return `<div class="cp-counts" role="group" aria-label="تصفية حسب الأهمية">
  <button type="button" class="cp-count cp-count--all is-on" data-attn-filter="all" aria-pressed="true"><b>${model.total}</b><span>الكل</span></button>
  ${chip('critical',c.critical)}${chip('high',c.high)}${chip('normal',c.normal)}${chip('info',c.info)}
 </div>`;
}

/** طابور «يحتاج انتباهك» مرتبًا حسب الأهمية ثم الزمن. */
export function attentionHtml(model){
 const rows=model.attention.slice(0,ATTN_LIMIT);
 const rest=model.attention.length-rows.length;
 return `<section class="cp-attn" data-section-id="attention" aria-labelledby="cp-attn-title">
  <header class="cp-attn-head">
   <div><span class="cp-eyebrow">يحتاج انتباهك</span><h2 id="cp-attn-title">طابور القرارات</h2></div>
   <div class="cp-attn-tools"><button type="button" class="ghost small" data-route="reports?type=procedures&amp;preset=overdue">تقرير المتأخرات</button><button type="button" class="ghost small" data-route="powersOfAttorney">التوكيلات</button></div>
  </header>
  ${countsHtml(model)}
  ${rows.length?`<ul class="cp-list" data-attn-list>${rows.map(attnRow).join('')}</ul>
   ${rest>0?`<p class="cp-more muted small">+${rest} عنصر آخر — استخدم الفلاتر أو <button type="button" class="link" data-route="actionCenter">مركز العمل</button> لعرض الكل.</p>`:''}`
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
 </li>`;
}

/** جدول اليوم الزمني. */
export function timelineHtml(model,{dayLabel=''}={}){
 const rows=model.timeline;
 return `<section class="cp-day" data-section-id="today" aria-labelledby="cp-day-title">
  <header class="cp-day-head"><div><span class="cp-eyebrow">جدول اليوم</span><h2 id="cp-day-title">${esc(dayLabel)}</h2></div><span class="cp-chip">${rows.length} عنصر</span></header>
  ${rows.length?`<ol class="cp-tl">${rows.map(x=>`<li class="${x.past?'is-past':''}${x.kind==='hearing'?' is-hearing':''}">
    <time>${esc(x.time||'—')}</time>
    <button type="button" data-route="${esc(x.route)}"><b>${esc(x.title)}</b><small>${esc(kindLabel(x.kind))}${x.meta?` · ${esc(x.meta)}`:''}</small></button>
   </li>`).join('')}</ol>`
   :`<div class="cp-empty cp-empty--soft"><span aria-hidden="true">◌</span><p>لا جلسات ولا مواعيد اليوم. يوم مناسب للمتابعات والأعمال المتأخرة.</p></div>`}
 </section>`;
}

const kindLabel=k=>({hearing:'جلسة',appointment:'موعد',followup:'متابعة اتصال'})[k]||'';

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
  next={tone:d===today?'danger':'info',eyebrow:d===today?'جلسة اليوم':'الجلسة القادمة',title:`${h.type||h.reason||'جلسة'} — ${fmt(d)}${h.hearingTime?' · '+String(h.hearingTime).slice(0,5):''}`,meta:h.court?`${h.court}${h.chamber?' · '+h.chamber:''}`:'',route:`rec:hearings:${h.id}`,label:'فتح الجلسة'};
 }else if(overdue[0]){const p=overdue[0];
  next={tone:'danger',eyebrow:'عمل متأخر',title:p.description||p.type||'عمل إداري',meta:`كان موعده ${fmt(dayOf(p.internalDueDate))}`,route:`rec:procedures:${p.id}`,label:'تنفيذ الآن'};
 }else if(dueSoon[0]){const p=dueSoon[0];
  next={tone:'warn',eyebrow:'العمل التالي',title:p.description||p.type||'عمل إداري',meta:`الموعد ${fmt(dayOf(p.internalDueDate))}`,route:`rec:procedures:${p.id}`,label:'تنفيذ'};
 }
 const nextBlock=next?`<div class="cp-fc-next cp-fc-next--${next.tone}">
   <span class="cp-eyebrow">${esc(next.eyebrow)}</span>
   <b class="cp-fc-title">${esc(next.title)}</b>
   <small class="muted">${esc(next.meta)}</small>
   <button type="button" class="primary small" data-route="${esc(next.route)}">${esc(next.label)} <span aria-hidden="true">←</span></button>
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

/** سلوك الطابور: فلترة بالأهمية دون إعادة رسم، ومفتاح لوحة للتنقل. */
export function bindCockpit(root){
 const bar=root.querySelector('.cp-counts');
 if(!bar)return;
 const list=root.querySelector('[data-attn-list]');
 bar.querySelectorAll('[data-attn-filter]').forEach(btn=>btn.addEventListener('click',()=>{
  const f=btn.dataset.attnFilter;
  bar.querySelectorAll('[data-attn-filter]').forEach(b=>{const on=b===btn;b.classList.toggle('is-on',on);b.setAttribute('aria-pressed',String(on))});
  list?.querySelectorAll('[data-sev]').forEach(li=>{li.hidden=!(f==='all'||li.dataset.sev===f)});
 }));
}

