import {buildRepairPlan,backupBeforeRepair,applyRepair} from '../services/repair.js';
import {esc} from '../ui/dom.js';
import {toast} from '../ui/toast.js';

let currentPlan=null;
function row(x,i){return `<tr><td>${i+1}</td><td>${x.safe?'آمن':'يتطلب حذفًا'}</td><td>${esc(x.store)}</td><td><code>${esc(x.id)}</code></td><td>${esc(x.description)}</td></tr>`}
export async function repairPage(app){
 currentPlan=await buildRepairPlan(app.ctx,{max:300});
 return `<div class="page-head"><div><h2>مركز الإصلاح والاسترداد</h2><p>اقتراح إصلاحات قابلة للمعاينة قبل التنفيذ. لا يتم تعديل البيانات تلقائيًا.</p></div><div class="head-actions"><button class="ghost" data-page-back>رجوع</button><button class="ghost" data-page-close>إغلاق</button><button class="ghost" id="repair-refresh">إعادة التحليل</button></div></div>
 <div class="notice"><b>قبل أي إصلاح:</b> يجب إنشاء نسخة احتياطية قابلة للاستعادة وحفظها خارج المتصفح.</div>
 <section class="panel repair-stats-panel" data-collapse-id="repair-stats"><div class="panel-head"><h3>ملخص خطة الإصلاح</h3><span class="badge">3 مؤشرات</span></div><div class="stats-grid"><div class="stat-card"><strong>${currentPlan.counts.safe}</strong><span>إصلاحات آمنة مقترحة</span></div><div class="stat-card"><strong>${currentPlan.counts.destructive}</strong><span>علاقات يتيمة تتطلب حذفًا</span></div><div class="stat-card"><strong>${currentPlan.items.length}</strong><span>إجمالي العناصر في الخطة</span></div></div></section>
 <div class="panel"><h3>الإجراءات</h3><div class="head-actions"><button class="primary" id="repair-backup">إنشاء نسخة احتياطية أولًا</button><button class="primary" id="repair-safe" disabled>تنفيذ الإصلاحات الآمنة</button><button class="danger" id="repair-destructive" disabled>تنفيذ الإصلاحات التي تحذف العلاقات</button></div><p class="muted" id="repair-state">أنشئ النسخة الاحتياطية أولًا، ثم يمكنك تنفيذ الإصلاحات الآمنة. حذف العلاقات لا يُفعّل إلا بموافقة صريحة.</p></div>
 <div class="panel"><h3>معاينة الخطة</h3><div class="table-wrap"><table><thead><tr><th>#</th><th>الطبيعة</th><th>المخزن</th><th>المعرف</th><th>الوصف</th></tr></thead><tbody>${currentPlan.items.length?currentPlan.items.slice(0,300).map(row).join(''):'<tr><td colspan="5">لا توجد إصلاحات مقترحة.</td></tr>'}</tbody></table></div></div>`;
}
export function bindRepair(app){
 document.querySelector('#repair-refresh')?.addEventListener('click',()=>app.refresh());
 document.querySelector('#repair-backup')?.addEventListener('click',async()=>{try{await backupBeforeRepair(app.ctx);document.querySelector('#repair-safe').disabled=false;document.querySelector('#repair-destructive').disabled=false;document.querySelector('#repair-state').textContent='تم إنشاء النسخة الاحتياطية. راجع المعاينة ثم نفّذ ما يلزم.';toast('تم إنشاء النسخة الاحتياطية.','success')}catch(e){toast(e.message,'error')}});
 document.querySelector('#repair-safe')?.addEventListener('click',async()=>{if(!currentPlan)return;try{const safe=currentPlan.items.filter(x=>x.safe);const r=await applyRepair(app.ctx,{items:safe});toast(`تم تحديث ${r.updated} سجلًا. أعد الفحص للتحقق.`,'success');app.refresh()}catch(e){toast(e.message,'error')}});
 document.querySelector('#repair-destructive')?.addEventListener('click',async()=>{if(!currentPlan)return;if(!confirm('هذا الإجراء قد يحذف سجلات علاقات يتيمة. تأكد أنك حفظت النسخة الاحتياطية وتريد المتابعة.'))return;try{const r=await applyRepair(app.ctx,currentPlan,{includeDestructive:true});toast(`تم تحديث ${r.updated} وحذف ${r.deleted} علاقة. أعد الفحص.`,'success');app.refresh()}catch(e){toast(e.message,'error')}});
}
