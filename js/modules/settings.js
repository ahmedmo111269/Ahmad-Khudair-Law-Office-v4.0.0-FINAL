// الإعدادات: معلومات الإصدار، إدارة القوائم (lookups) القابلة للتعديل، وأدوات صيانة غير مدمرة.
import {esc} from '../ui/dom.js';
import {toast} from '../ui/toast.js';
import {confirmBox} from '../ui/modal.js';
import {LOOKUP_CATEGORIES} from '../domain/lookup-defaults.js';
import {lookupRows,saveLookupValue,removeLookupValue,moveLookupValue,seedLookups} from '../services/lookups.js';
import {rebuildAllFileSearchText} from '../services/legal-files.js';
import {migrateLegacyParties} from '../services/maintenance.js';
import {userError} from '../core/errors.js';

export async function renderSettings(app){
 const cat=app.__lookupCat=app.__lookupCat||'fileType';
 const rows=await lookupRows(app.office,cat);
 return `<div class="page-head"><div><h2>الإعدادات</h2><p class="muted small">إعدادات التشغيل المحلية والقوائم التي تظهر في النماذج.</p></div></div>
 <section class="panel"><div class="panel-head"><h3>القوائم القابلة للتعديل</h3><span class="muted small">القيم تظهر كاقتراحات في النماذج ويمكن دائمًا كتابة قيمة أخرى. حذف قيمة لا يغيّر السجلات القديمة التي استخدمتها.</span></div>
  <div class="lookup-admin"><label>القائمة<select id="lk-cat">${Object.entries(LOOKUP_CATEGORIES).map(([k,v])=>`<option value="${k}"${k===cat?' selected':''}>${esc(v.label)}</option>`).join('')}</select></label>
  <form id="lk-add" class="inline-form"><input name="value" placeholder="قيمة جديدة" aria-label="قيمة جديدة"><button class="primary">إضافة</button></form></div>
  <ol class="lookup-list">${rows.map((r,i)=>`<li data-id="${r.id}"><span class="lk-val">${esc(r.value)}</span><span class="lk-actions"><button type="button" class="link" data-lk="up" ${i===0?'disabled':''} aria-label="أعلى">▲</button><button type="button" class="link" data-lk="down" ${i===rows.length-1?'disabled':''} aria-label="أسفل">▼</button><button type="button" class="link" data-lk="edit">تعديل</button><button type="button" class="link danger" data-lk="del">حذف</button></span></li>`).join('')||'<li class="muted">القائمة فارغة.</li>'}</ol>
 </section>
 <div class="grid2"><section class="panel"><h3>الإصدار</h3><p>التطبيق: ${esc(app.constants.APP_VERSION)}</p><p>Schema: ${app.constants.SCHEMA_VERSION}</p><p>قاعدة البيانات: ${esc(app.registry.active?.displayName||'')}</p></section>
 <section class="panel"><h3>صيانة (لا تحذف أي بيانات)</h3><div class="action-stack"><button class="ghost" data-maint="index">إعادة بناء فهرس البحث للملفات</button><button class="ghost" data-maint="parties">ترحيل روابط الموكلين القديمة إلى أطراف الملفات</button><button class="ghost" data-maint="seed">استكمال القوائم الافتراضية الناقصة</button></div><p class="muted small" id="maint-status"></p></section>
 <section class="panel"><h3>الخصوصية</h3><p>البيانات مخزنة محليًا في متصفح الجهاز. لا توجد خدمة تحليل أو API خارجية في النسخة الأساسية.</p></section></div>`;
}
export function bindSettings(app){
 const root=document.querySelector('#main-content');const cat=app.__lookupCat;
 root.querySelector('#lk-cat').onchange=e=>{app.__lookupCat=e.target.value;app.refresh()};
 root.querySelector('#lk-add').onsubmit=async e=>{e.preventDefault();try{await saveLookupValue(app.office,cat,e.target.value.value);toast('تمت الإضافة');app.refresh()}catch(err){toast(userError(err),'error')}};
 root.querySelectorAll('[data-lk]').forEach(b=>b.onclick=async()=>{
  const li=b.closest('li');const id=li.dataset.id;const act=b.dataset.lk;
  try{
   if(act==='up'||act==='down'){await moveLookupValue(app.office,cat,id,act==='up'?-1:1);app.refresh()}
   else if(act==='del'){if(await confirmBox(`حذف «${esc(li.querySelector('.lk-val').textContent)}» من القائمة؟ السجلات التي تستخدمها تبقى كما هي.`,{okText:'حذف'})){await removeLookupValue(app.office,id);toast('تم الحذف');app.refresh()}}
   else if(act==='edit'){const r=await confirmBox('تعديل القيمة (السجلات القديمة تحتفظ بالقيمة السابقة):',{okText:'حفظ',input:true});if(r.ok&&r.value.trim()){await saveLookupValue(app.office,cat,r.value,id);toast('تم الحفظ');app.refresh()}}
  }catch(err){toast(userError(err),'error')}
 });
 const status=root.querySelector('#maint-status');
 root.querySelectorAll('[data-maint]').forEach(b=>b.onclick=async()=>{
  b.disabled=true;
  try{
   if(b.dataset.maint==='index'){const n=await rebuildAllFileSearchText(app.office,d=>status.textContent=`تمت معالجة ${d} ملف…`);status.textContent=`تمت إعادة بناء فهرس ${n} ملف.`}
   if(b.dataset.maint==='parties'){const n=await migrateLegacyParties(app.office);status.textContent=`تم ترحيل ${n} رابط.`}
   if(b.dataset.maint==='seed'){const n=await seedLookups(app.office);status.textContent=n?`أضيفت ${n} قيمة افتراضية.`:'كل القوائم مكتملة.'}
  }catch(err){toast(userError(err),'error')}finally{b.disabled=false}
 });
}
