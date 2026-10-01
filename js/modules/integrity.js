import {formatDate,formatDateTime} from '../core/format.js';
import {deepHealth,auditPage} from '../services/integrity.js';
import {esc} from '../ui/dom.js';
import {toast} from '../ui/toast.js';
import {mountGrid} from '../ui/datagrid.js';
import {columnsFor} from './list-page.js';
import {createGridRelations} from '../services/grid-relations.js';

const label={clients:'الموكلون',files:'الملفات',cases:'القضايا',hearings:'الجلسات',procedures:'الإجراءات',appointments:'المواعيد',communications:'الاتصالات',judgments:'الأحكام',execution:'التنفيذ',fees:'الأتعاب'};
function issueRows(items){return items.length?items.slice(0,100).map(x=>`<tr><td>${esc(x.type||'')}</td><td>${esc(x.store||'')}</td><td><code>${esc(x.id||'')}</code></td><td>${esc(x.field||x.message||x.fields?.join('، ')||'')}</td></tr>`).join(''):`<tr><td colspan="4">لا توجد مشكلات.</td></tr>`}
export async function integrityPage(app){
 const h=await deepHealth(app.ctx,{scanRows:true});
 return `<div class="page-head"><div><h2>سلامة البيانات والتدقيق</h2><p>فحص بنية قاعدة البيانات والعلاقات والحقول وحالات الحذف دون تعديل تلقائي.</p></div><div class="head-actions"><button class="ghost" data-page-back>رجوع</button><button class="ghost" data-page-close>إغلاق</button><button class="primary" id="run-doctor">إعادة الفحص</button></div></div>
 <div class="notice"><b>${h.ok?'الحالة: لا توجد مشكلات مكتشفة':'الحالة: توجد مشكلات تحتاج مراجعة'}</b> — تم الفحص في ${esc(formatDateTime(h.checkedAt))}.</div>
 <section class="panel integrity-stats-panel" data-collapse-id="integrity-stats"><div class="panel-head"><h3>ملخص الفحص</h3><span class="badge">4 مؤشرات</span></div><div class="stats-grid"><div class="stat-card"><strong>${h.summary.schemaIssues}</strong><span>مشكلات البنية</span></div><div class="stat-card"><strong>${h.summary.dataIssues}</strong><span>مشكلات البيانات</span></div><div class="stat-card"><strong>${h.summary.relationIssues}</strong><span>علاقات يتيمة</span></div><div class="stat-card"><strong>${h.summary.softDeleteIssues}</strong><span>مشكلات الحذف المنطقي</span></div></div></section>
 <div class="panel"><h3>تفاصيل المشكلات</h3><div class="table-wrap"><table><thead><tr><th>النوع</th><th>المخزن</th><th>المعرف</th><th>التفاصيل</th></tr></thead><tbody>${issueRows(h.issues)}</tbody></table></div></div>
 <div class="panel"><h3>سجل التدقيق</h3><div class="filter-row"><label>نوع السجل<select id="audit-type"><option value="">الكل</option>${Object.entries(label).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label><button class="primary" id="load-audit">عرض آخر 200 عملية</button></div><div id="audit-results" class="table-wrap"></div></div>`;
}
export function bindIntegrity(app){
 document.querySelector('#run-doctor')?.addEventListener('click',()=>app.refresh());
 const target=document.querySelector('#audit-results'),type=document.querySelector('#audit-type');
 let grid=null,seq=0;
 document.querySelector('#load-audit')?.addEventListener('click',async()=>{
  const generation=++seq,office=app.office,entityType=type.value;
  try{
   const rows=await auditPage(office.ctx,{entityType}),relations=createGridRelations(office,'activityLog');
   await relations.hydrate(rows);
   if(generation!==seq||!target.isConnected||office!==app.office)return;
   grid?.destroy();
   grid=mountGrid(target,{title:'سجل التدقيق',storageKey:'integrity:audit',rows,
    columns:columnsFor('activityLog',new Map(),{relations,extra:[{key:'entityId',label:'المعرف',width:220}]}),
    ...relations.gridOptions({filters:['أحدث 200 عملية مطابقة',entityType&&`نوع السجل: ${label[entityType]||entityType}`].filter(Boolean)}),
    emptyText:'لا توجد سجلات مطابقة.'});
  }catch(e){if(generation===seq&&target.isConnected)toast(e.message,'error')}
 });
}
