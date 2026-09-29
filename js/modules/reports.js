// التقارير الشاملة: أي كيان × أي حقل تاريخ × أي فترة × بحث نصي، ثم جدول Access كامل (فرز/تصفية مركبة/تجميع/أعمدة)
// مع الطباعة والتصدير (Excel/Word/CSV/TXT). القراءة محدودة بحد أقصى 5000 صف لكل تقرير.
import {esc} from '../ui/dom.js';
import {mountGrid} from '../ui/datagrid.js';
import {ENTITIES,FILE_TYPE_GROUPS,fmtDate,label} from '../domain/entities.js';
import {loadRows,resolveRefs,presetRange,PRESETS,agenda} from '../services/entity-query.js';
import {columnsFor,openRow} from './list-page.js';
import {localDate} from '../core/clock.js';
import {prefs} from '../core/preferences.js';
import {modal,closeModal,confirmBox} from '../ui/modal.js';
import {toast} from '../ui/toast.js';

const GROUPS=[
 ['الملفات والأشخاص',['files','clients','opponents','fileParties','fileRelations','powersOfAttorney']],
 ['القضايا والجلسات',['cases','hearings','judgments','expertReports','execution']],
 ['الأعمال والمتابعة',['procedures','appointments','communications','caseNotes','serviceRecords']],
 ['المحضرون والمرجعيات',['bailiffs']],
 ['المالية والمستندات والنشاط',['fees','feePayments','documentReferences','activityLog']]
];
const readSavedReports=()=>{const value=prefs.get('reports:saved',[]);return Array.isArray(value)?value.filter(r=>r&&r.id&&r.name&&r.definition):[]};
const dateFields=store=>{const e=ENTITIES[store];const fs=[...e.fields,...(store==='files'?Object.values(FILE_TYPE_GROUPS).flatMap(g=>g.fields):[])].filter(f=>f.t==='date'||f.dt==='date'||f.dt==='datetime').map(f=>[f.k,f.l]);for(const [k,l] of [['createdAt','تاريخ الإنشاء'],['updatedAt','تاريخ آخر تعديل']])if(!fs.some(x=>x[0]===k))fs.push([k,l]);return fs};

export async function reportsPage(app,query){
 const st=app.__report=app.__report||{type:'hearings',preset:'week',from:'',to:'',q:'',limit:2000,dateField:'',title:''};
 const savedReports=readSavedReports();
 if(query?.get('type')){st.type=query.get('type');st.preset=query.get('preset')||'all';st.from=query.get('from')||'';st.to=query.get('to')||'';st.q=query.get('q')||'';st.dateField='';st.auto=true}
 if(st.type!=='agenda'&&!ENTITIES[st.type])st.type='hearings';
 const df=st.type==='agenda'?[]:dateFields(st.type);
 if(!st.dateField||!df.some(x=>x[0]===st.dateField))st.dateField=st.type==='agenda'?'':ENTITIES[st.type].dateField||df[0]?.[0]||'createdAt';
 const presets=st.type==='procedures'?[...PRESETS,['overdue','المتأخرة (مفتوحة)']]:PRESETS;
 return `<div class="page-head"><div><h2>التقارير الشاملة</h2><p class="muted small">اختر البيانات والفترة ثم اعرض التقرير. من الجدول: فرز وتصفية لكل عمود (▾)، تصفية مركبة (و/أو)، تجميع، اختيار الأعمدة، طباعة وتصدير.</p></div></div>
 <section class="panel report-builder"><form id="report-form" class="filter-grid">
  <label>البيانات<select name="type"><option value="agenda"${st.type==='agenda'?' selected':''}>الأجندة الموحدة (كل ما له تاريخ)</option>${GROUPS.map(([g,list])=>`<optgroup label="${esc(g)}">${list.map(s=>`<option value="${s}"${s===st.type?' selected':''}>${esc(ENTITIES[s].plural)}</option>`).join('')}</optgroup>`).join('')}</select></label>
  ${st.type==='agenda'?'':`<label>حقل التاريخ<select name="dateField">${df.map(([k,l])=>`<option value="${k}"${k===st.dateField?' selected':''}>${esc(l)}</option>`).join('')}</select></label>`}
  <label>الفترة<select name="preset">${presets.map(([k,l])=>`<option value="${k}"${k===st.preset?' selected':''}>${l}</option>`).join('')}</select></label>
  <label class="rng">من<input type="date" name="from" value="${esc(st.from)}"></label>
  <label class="rng">إلى<input type="date" name="to" value="${esc(st.to)}"></label>
  <label>بحث نصي شامل<input name="q" value="${esc(st.q)}" placeholder="اسم، رقم، محكمة…"></label>
  <label>الحد الأقصى للصفوف<select name="limit">${[500,1000,2000,5000].map(n=>`<option${n===Number(st.limit)?' selected':''}>${n}</option>`).join('')}</select></label>
  <label>عنوان التقرير<input name="title" value="${esc(st.title)}" placeholder="يُكوَّن تلقائيًا"></label>
  <div class="filter-actions"><button class="primary" type="submit">عرض التقرير</button></div>
 </form></section>
 <section class="panel saved-report-panel"><div><b>التقارير المحفوظة</b><p class="muted small">تُحفظ تعريفات التقرير محليًا كتفضيلات للمستخدم، ولا تتضمن نسخًا من السجلات.</p></div><div class="saved-report-controls"><select id="saved-report" aria-label="التقرير المحفوظ"><option value="">اختر تقريرًا محفوظًا</option>${savedReports.map(r=>`<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}</select><button type="button" class="ghost" data-report-load>تحميل</button><button type="button" class="ghost" data-report-save>حفظ الشروط الحالية</button><button type="button" class="ghost danger" data-report-delete>حذف التعريف</button></div></section>
 <div id="report-status" class="report-result-note" aria-live="polite" hidden></div>
 <div id="report-grid"></div>`;
}

export function bindReports(app){
 const st=app.__report;const form=document.querySelector('#report-form');
 const sync=()=>{const custom=form.preset.value==='custom';form.querySelectorAll('.rng').forEach(l=>l.hidden=!custom)};
 form.preset.addEventListener('change',sync);sync();
 form.type.addEventListener('change',()=>{st.type=form.type.value;st.dateField='';st.preset=form.preset.value;app.refresh()});
 form.addEventListener('submit',e=>{e.preventDefault();Object.assign(st,reportDefinitionFromForm(form));run(app).catch(err=>app.fail(err))});
 document.querySelector('[data-report-save]')?.addEventListener('click',()=>saveReportDefinition(app,form));
 document.querySelector('[data-report-load]')?.addEventListener('click',async()=>{const id=document.querySelector('#saved-report').value;const saved=readSavedReports().find(r=>r.id===id);if(!saved){toast('اختر تقريرًا محفوظًا أولًا.','error');return}Object.assign(st,saved.definition,{auto:true});await app.refresh()});
 document.querySelector('[data-report-delete]')?.addEventListener('click',async()=>{const select=document.querySelector('#saved-report'),id=select.value;if(!id){toast('اختر تقريرًا محفوظًا أولًا.','error');return}if(!await confirmBox('حذف تعريف التقرير المحفوظ؟ لا تُحذف أي سجلات.',{okText:'حذف التعريف'}))return;const list=readSavedReports().filter(r=>r.id!==id);await prefs.set('reports:saved',list);toast('تم حذف تعريف التقرير');await app.refresh()});
 if(st.auto){st.auto=false;run(app).catch(err=>app.fail(err))}
}

function reportDefinitionFromForm(form){
 const get=name=>form.elements.namedItem(name)?.value||'';
 return {type:get('type'),dateField:get('dateField'),preset:get('preset')||'all',from:get('from'),to:get('to'),q:get('q'),limit:Number(get('limit'))||2000,title:get('title')};
}
async function saveReportDefinition(app,form){
 const definition=reportDefinitionFromForm(form);
 const card=modal(`<h2 class="modal-title">حفظ تعريف التقرير</h2><form id="saved-report-form" class="entity-form"><label>اسم التقرير<input name="name" maxlength="100" required placeholder="مثال: جلسات الأسبوع الحالي"></label><p class="muted small">سيُحفظ نوع البيانات والفترة والبحث والحد وعنوان التقرير فقط، دون نسخ سجلات قاعدة المكتب. استخدام اسم محفوظ سابقًا يستبدل تعريفه.</p><div class="form-actions"><button class="primary">حفظ التعريف</button><button type="button" class="ghost" data-cancel>إلغاء</button></div></form>`);
 const saveForm=card.querySelector('#saved-report-form');card.querySelector('[data-cancel]').onclick=closeModal;
 saveForm.onsubmit=async event=>{event.preventDefault();const name=saveForm.elements.name.value.trim();if(!name)return;const list=readSavedReports();const found=list.find(r=>r.name.toLocaleLowerCase()===name.toLocaleLowerCase());const record={id:found?.id||`report-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,name,definition,updatedAt:new Date().toISOString()};if(found)list[list.indexOf(found)]=record;else list.unshift(record);await prefs.set('reports:saved',list);closeModal();const select=document.querySelector('#saved-report');if(select){select.innerHTML='<option value="">اختر تقريرًا محفوظًا</option>'+list.map(r=>`<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('');select.value=record.id}toast('تم حفظ تعريف التقرير محليًا')};
}

async function run(app){
 const st=app.__report;const status=document.querySelector('#report-status');
 status.hidden=false;status.textContent='جارٍ إعداد التقرير…';
 let [from,to]=st.preset==='overdue'?['0000-01-01',yesterday()]:presetRange(st.preset,st.from,st.to);
 const periodTxt=from||to?`${fmtDate(from)||'…'} — ${fmtDate(to)||'…'}`:'كل الفترات';
 const el=document.querySelector('#report-grid');el.innerHTML='';
 if(st.type==='agenda'){
  if(!from&&!to){from=localDate().slice(0,4)+'-01-01';to=localDate().slice(0,4)+'-12-31'}
  let rows=await agenda(app.office,from||'0000-01-01',to||'9999-12-31',st.limit);
  if(st.q){const {rowText,normQ}=await import('../services/entity-query.js');const q=normQ(st.q);rows=rows.filter(r=>rowText(r).includes(q))}
  const refs=await resolveRefs(app.office,rows,[{k:'fileId',ref:'files'},{k:'caseId',ref:'cases'}]);
  const title=st.title||`الأجندة الموحدة (${periodTxt})`;
  mountGrid(el,{title,storageKey:'report:agenda',rows,onRowClick:r=>app.go(r.store==='files'?'file:'+r.id:`rec:${r.store}:${r.id}`),columns:[
   {key:'kind',label:'النوع'},{key:'date',label:'التاريخ',type:'date',text:r=>fmtDate(r.date)},{key:'time',label:'الوقت'},{key:'title',label:'البيان'},{key:'details',label:'التفاصيل'},{key:'status',label:'الحالة',text:r=>label(r.status)||''},
   {key:'fileId',label:'الملف',get:r=>refs.get(r.fileId)||'',text:r=>refs.get(r.fileId)||''},{key:'caseId',label:'القضية / المرحلة',get:r=>refs.get(r.caseId)||'',text:r=>refs.get(r.caseId)||''}]});
  status.textContent=`${title}: ${rows.length} عنصر`;return;
 }
 const ent=ENTITIES[st.type];
 const filter=st.preset==='overdue'?(x=>!x.status||['open','pending'].includes(x.status)):null;
 const {rows,more}=await loadRows(app.office,st.type,{q:st.q,from,to,dateField:st.dateField,limit:st.limit,filter});
 const refs=await resolveRefs(app.office,rows,ent.fields);
 const dfl=dateFields(st.type).find(x=>x[0]===st.dateField)?.[1]||'';
 const title=st.title||`تقرير ${ent.plural}${from||to?` — ${dfl}: ${periodTxt}`:''}${st.q?` — بحث: ${st.q}`:''}`;
 const grid=mountGrid(el,{title,storageKey:'report:'+st.type,rows,columns:columnsFor(st.type,refs),onRowClick:r=>openRow(app,st.type,r),emptyText:'لا توجد سجلات مطابقة لشروط التقرير.'});
 if(st.dateField&&(from||to))grid.sortBy(st.dateField,'asc');
 status.innerHTML=`<b>${esc(title)}</b>: ${rows.length} سجل${more?` — <span class="warn-text">وصل التقرير إلى الحد الأقصى (${st.limit}). ضيّق الفترة أو البحث أو ارفع الحد.</span>`:''}`;
}
function yesterday(){const d=new Date();d.setDate(d.getDate()-1);return localDate(d)}
