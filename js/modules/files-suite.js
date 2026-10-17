// =====================================================================
// مجموعة الملفات — الواجهة التنفيذية للمركز والأدوات.
// ---------------------------------------------------------------------
// كل لوحة هنا تقرأ من files-hub (مشتق من السجلات الأصلية) وتستدعي الخدمات
// القائمة للفتح والتعديل. لا كتابة مباشرة على قاعدة البيانات من هذا الملف،
// والاستثناء الوحيد هو سجلات الإدارة الجديدة عبر services/files-admin.js
// أو تفضيلات العرض عبر workspaces/prefs.
// =====================================================================
import {esc} from '../ui/dom.js';
import {stackedModal,closeModal} from '../ui/modal.js';
import {toast} from '../ui/toast.js';
import {ENTITIES,fmtDate,label,isClosedFile,fileTypeGroup} from '../domain/entities.js';
import {formatFileNumber} from '../core/file-number.js';
import {formatDateTime} from '../core/format.js';
import {parseFileQuery,scoreFile,highlightParts,numberVariants} from '../core/files-query.js';
import {normalizeArabic} from '../core/search-normalizer.js';
import {localDate} from '../core/clock.js';
import {networkStatus} from '../core/network-status.js';
import {prefs} from '../core/preferences.js';
import {
 CHECKLIST_GROUPS,getFileChecklist,toggleChecklistItem,resetFileChecklist,
 getChecklistTemplate,saveChecklistTemplate,resetChecklistTemplate,
 listAdminDecisions,addAdminDecision,deleteAdminDecision,
 fieldHistoryEnabled,setFieldHistoryEnabled,recordFieldChanges,listFieldHistory,clearFieldHistory,
 listReportSnapshots,saveReportSnapshot,deleteReportSnapshot,
 getFileVisits,clearFileVisits,removeFileVisit
} from '../services/files-admin.js';
import {getRecent,removeRecent,clearRecent} from '../services/recents.js';
import {getFavorites,removeFavorite,toggleFavorite} from '../services/favorites.js';
import {
 loadFilePortfolio,buildAttention,fileDistribution,workloadByProcedureType,workloadByMonth,
 comparePeriods,buildQualityReport,detectDuplicateFiles,buildRelationAudit,loadFileForCompare,
 compareFileBundles,buildLongTextIndex,buildFreshness,searchPortfolio,buildVerifiableSummary,
 administrativeCompleteness,HUB_LIMITS
} from '../services/files-hub.js';
import {
 getWorkspaces,builtInWorkspaces,saveWorkspace,renameWorkspace,duplicateWorkspace,deleteWorkspace,
 exportSettingsTemplate,importSettingsTemplate,applyWorkspaceToList
} from '../services/workspace-views.js';
import {
 fsState,fsBadge,fsStat,fsEmpty,fsNotice,fsMeter,fsBarChart,fsDonut,fsNum,fsMissing,
 openFsDrawer,reviewImpact,downloadJson,pickJsonFile,fsCopy,fsPrintHtml,fsConfirm
} from '../ui/files-ui.js';

const PRIORITY_LABEL={high:'عالية',medium:'متوسطة',low:'منخفضة'};
const PRIORITY_TONE={high:'danger',medium:'warn',low:'neutral'};
const SOURCE_LABEL={
 files:'حقول الملف المسجلة',fileParties:'أطراف الملف',cases:'المراحل القضائية',
 procedures:'الأعمال الإدارية',hearings:'الجلسات',serviceRecords:'الإعلانات والمحضرين',
 fileRelations:'علاقات الملفات',activityLog:'سجل النشاط',settings:'سجلات إدارة الملفات'
};

function scopeId(app){return app?.ctx?.profile?.id||''}
function officeOf(app){return app?.office||null}
function currentFilesState(app){return app?.__lists?.files||null}
function currentGrid(app){return typeof document!=='undefined'?(document.querySelector('#list-grid')?.__grid||null):null}
function fileTitle(file){return `${formatFileNumber(file?.fileNumber)||file?.fileNumber||'ملف'}${file?.title?' — '+file.title:''}`}
function openRoute(app,route){if(!route)return;closeModal();app.go(route)}
function statusLine(file){
 if(file?.isArchived)return fsBadge('مؤرشف','muted');
 if(isClosedFile(file))return fsBadge(label(file.status)||'منتهٍ','warn');
 return fsBadge(label(file.status)||'مفتوح','ok');
}
function yesNo(value){return value?'نعم':'غير مسجل'}
function safeParties(portfolio,fileId){return portfolio?.partiesByFile?.get(fileId)||[]}
function safeStages(portfolio,fileId){return portfolio?.stagesByFile?.get(fileId)||[]}

/** تحميل اللقطة مع كاش قصير يُبطَل عند أي تغيير في السجلات. */
let cacheInvalidated=true;
try{
 const {events}=await import('../core/events.js');
 for(const event of ['entity:changed','db:switched'])events.on(event,()=>{cacheInvalidated=true},{local:true});
}catch{/* حدث غير متاح: الكاش يبقى قصير الأجل */}

async function getPortfolio(app,{force=false}={}){
 const office=officeOf(app);
 if(!office)throw new Error('قاعدة المكتب غير متاحة.');
 if(!force&&!cacheInvalidated&&app.__filesPortfolio&&Date.now()-app.__filesPortfolio.at<30000)return app.__filesPortfolio.data;
 const data=await loadFilePortfolio(office);
 app.__filesPortfolio={at:Date.now(),data};
 cacheInvalidated=false;
 return data;
}

function loadingBody(labelText='جارٍ قراءة سجلات الملفات…'){
 return `<div class="fs-loading" role="status" aria-live="polite"><span class="fs-spinner" aria-hidden="true"></span><p>${esc(labelText)}</p><p class="muted small">قراءة محدودة ومشتقة من السجلات الأصلية — لا تعديل على أي بيانات.</p></div>`;
}

function portfolioScopeNote(portfolio){
 const more=Object.entries(portfolio.more||{}).filter(([,value])=>value);
 if(!more.length)return '';
 return fsNotice(`التحليل يشمل السجلات المحمّلة حتى حدود ${HUB_LIMITS.files} ملفًا و${HUB_LIMITS.parties} طرفًا. وُجدت سجلات إضافية خارج الحد (${more.map(([key])=>key).join('، ')}) ولم تُحسب في الأرقام.`, 'warn');
}

// ===== مركز الملفات =====
const CENTER_TABS=[
 ['attention','ما يحتاج انتباهي','⚑'],
 ['analytics','التحليلات','▥'],
 ['quality','جودة البيانات','⚠'],
 ['relations','العلاقات','↔'],
 ['duplicates','التشابه','⧉'],
 ['search','البحث والفهرس','⌕']
];

export async function openFilesCenter(app,{tab='attention'}={}){
 const card=fsState({title:'مركز الملفات',body:loadingBody(),wide:true,className:'fs-center',actions:'<span class="fs-live-dot" title="بيانات محلية"></span>'});
 let portfolio=null;
 const state={tab,priority:'all',qualityLevel:'all',query:'',periodA:{from:'',to:''},periodB:{from:'',to:''},periodResult:null,longIndex:null,longQuery:'',longStore:'all'};
 const body=card.querySelector('.fs-sheet-body');
 let render=()=>{};
 // عدّادات التبويبات تُحسب مرة لكل لقطة/تحديث، لا مع كل حرف بحث.
 let tabCounts=null;
 const computeCounts=()=>{
  tabCounts={
   attention:buildAttention(portfolio).length,
   quality:buildQualityReport(portfolio).issues.length,
   duplicates:detectDuplicateFiles(portfolio).candidates.length
  };
 };

 const doRender=()=>{
  if(!tabCounts)computeCounts();
  if(!portfolio)return;
  const tabs=CENTER_TABS.map(([id,labelText,icon])=>{
   const count=tabCounts[id]??'';
   return `<button type="button" class="fs-tab${state.tab===id?' on':''}" data-center-tab="${id}" role="tab" aria-selected="${state.tab===id}"><span aria-hidden="true">${icon}</span>${esc(labelText)}${count!==''?`<small>${fsNum(count)}</small>`:''}</button>`;
  }).join('');
  const content=state.tab==='attention'?attentionHtml(app,portfolio,state)
   :state.tab==='analytics'?analyticsHtml(app,portfolio,state)
   :state.tab==='quality'?qualityHtml(portfolio,state)
   :state.tab==='relations'?relationsHtml(portfolio,state)
   :state.tab==='duplicates'?duplicatesHtml(portfolio,state)
   :searchHtml(portfolio,state);
  body.innerHTML=`<div class="fs-center-search"><input type="search" data-center-q value="${esc(state.query)}" placeholder="ابحث بالاسم أو رقم الملف أو الموكل أو الخصم… اكتب نوع:قضية حالة:مفتوح لبحث مركب" aria-label="بحث في مركز الملفات"><button type="button" class="ghost" data-center-refresh title="إعادة قراءة السجلات">⟳ تحديث</button><span class="muted small" data-center-count>${fsNum(portfolio.files.length)} ملفًا محمّلًا</span></div>
   <div class="fs-tabs" role="tablist" aria-label="أقسام مركز الملفات">${tabs}</div>
   ${portfolioScopeNote(portfolio)}
   <div class="fs-center-content" role="tabpanel">${content}</div>`;
  bindCenter();
 };

 const bindCenter=()=>{
  body.querySelectorAll('[data-center-tab]').forEach(button=>button.addEventListener('click',()=>{state.tab=button.dataset.centerTab;doRender()}));
  let queryTimer=0;
  body.querySelector('[data-center-q]')?.addEventListener('input',e=>{
   state.query=e.target.value;
   if(!state.query.trim())return;
   state.tab='search';
   clearTimeout(queryTimer);
   queryTimer=setTimeout(()=>{
    const at=state.query.length;
    doRender();
    const input=body.querySelector('[data-center-q]');
    if(input){input.focus();try{input.setSelectionRange(at,at)}catch{}}
   },160);
  });
  body.querySelector('[data-center-refresh]')?.addEventListener('click',async()=>{
   cacheInvalidated=true;body.innerHTML=loadingBody('جارٍ تحديث القراءة…');
   try{portfolio=await getPortfolio(app,{force:true});tabCounts=null;doRender();toast('حُدّثت اللقطة من السجلات الحالية')}
   catch(error){body.innerHTML=fsNotice(error?.message||'تعذر تحميل البيانات','error')}
  });
 };

 // مستمع واحد فقط لكل نافذة: إعادة الرسم تستبدل المحتوى ولا تضيف مستمعًا جديدًا.
 const onCenterClick=async event=>{
  const action=event.target.closest('[data-fs-action]')?.dataset.fsAction||'';
  const fileButton=event.target.closest('[data-open-file]');
  if(fileButton){const id=fileButton.dataset.openFile;closeModal();app.go(`file:${id}${fileButton.dataset.tab?`?tab=${encodeURIComponent(fileButton.dataset.tab)}`:''}`);return}
  const preview=event.target.closest('[data-preview-file]');
  if(preview){event.preventDefault();openFileQuickDrawer(app,preview.dataset.previewFile).catch(error=>toast(error?.message||'تعذر فتح المعاينة','error'));return}
  const record=event.target.closest('[data-open-record]');
  if(record){openRoute(app,record.dataset.openRecord);return}
  if(action==='review-queue'){closeModal();openReviewQueue(app,{ids:[]}).catch(error=>toast(error?.message||'تعذر بدء المراجعة','error'));return}
  if(action==='open-workspaces'){closeModal();openFilesWorkspaces(app).catch(error=>toast(error?.message||'تعذر فتح مساحات العمل','error'));return}
  if(action==='open-quality'){state.tab='quality';state.qualityLevel='all';doRender();return}
  if(action==='period-run'){runPeriodCompare(app,state,doRender);return}
  if(action==='kpi-customize'){openKpiConfig(app,doRender);return}
  if(action==='long-index'){loadLongIndex(app,state,doRender);return}
  if(action==='long-search'){doRender();return}
  if(action==='compare-two'){const a=event.target.closest('[data-dupe-a]')?.dataset.dupeA||'',b=event.target.closest('[data-dupe-b]')?.dataset.dupeB||'';closeModal();openFileComparePicker(app,{a,b});return}
  if(action==='relation-map'){const id=event.target.closest('[data-map-file]')?.dataset.mapFile||portfolio?.files?.[0]?.id;if(id){closeModal();openRelationMap(app,id)}return}
  if(action==='summary-open'){const target=event.target.closest('[data-summary-file]')?.dataset.summaryFile||'';if(target){closeModal();openVerifiableSummary(app,target)}return}
  if(action==='attention-csv'){exportAttentionRows();return}
  if(action==='quality-print'){printQualityReport();return}
  if(action==='quality-csv'){exportQualityReport();return}
  const levelButton=event.target.closest('[data-quality-filter]');
  if(levelButton){state.qualityLevel=levelButton.dataset.level||'all';doRender();return}
  const priorityButton=event.target.closest('[data-priority-filter]');
  if(priorityButton){state.priority=priorityButton.dataset.priorityFilter;doRender();return}
  const dist=event.target.closest('[data-dist-key]');
  if(dist){const value=dist.dataset.distKey;if(value){closeModal();app.go(`files?q=${encodeURIComponent(value)}`) }return}
 };
 if(!body.dataset.bound){body.dataset.bound='1';body.addEventListener('click',onCenterClick)}
 const exportAttentionRows=()=>{
  const rows=buildAttention(portfolio);
  if(!rows.length){toast('لا توجد صفوف للتصدير','info');return}
  const head=['الأولوية','الملف','السبب','المصدر','الرابط'];
  const bodyRows=rows.map(item=>[PRIORITY_LABEL[item.priority]||item.priority,item.title,item.reason,item.source,`file:${item.fileId}`]);
  const csv='\ufeff'+[head,...bodyRows].map(row=>row.map(value=>`"${String(value??'').replace(/"/g,'""')}"`).join(',')).join('\r\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`files-attention-${localDate()}.csv`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
  toast('صُدّر التقرير الإداري — بلا أي تعديل على البيانات');
 };
 const exportQualityReport=()=>{
  const report=buildQualityReport(portfolio);
  const head=['المستوى','الملف','الرسالة','الحقل','المصدر'];
  const csv='\ufeff'+[head,...report.issues.map(item=>[item.levelLabel,item.title,item.message,item.field||'',item.source])].map(row=>row.map(value=>`"${String(value??'').replace(/"/g,'""')}"`).join(',')).join('\r\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`files-quality-${localDate()}.csv`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
 };
 const printQualityReport=()=>{
  const report=buildQualityReport(portfolio);
  fsPrintHtml({title:'تقرير جودة بيانات الملفات',subtitle:`${report.issues.length} ملاحظة إدارية — ${fmtDate(localDate())}`,body:`<p class="small muted">${esc(report.disclaimer)}</p><table><thead><tr><th>المستوى</th><th>الملف</th><th>الملاحظة</th><th>الحقل</th><th>المصدر</th></tr></thead><tbody>${report.issues.map(item=>`<tr><td>${esc(item.levelLabel)}</td><td>${esc(item.title)}</td><td>${esc(item.message)}</td><td>${esc(item.field||'—')}</td><td>${esc(item.source)}</td></tr>`).join('')}</tbody></table>`});
 };

 try{
  portfolio=await getPortfolio(app);
  computeCounts();
  render=doRender;
  render();
 }catch(error){
  body.innerHTML=`<div class="fs-empty"><p>تعذر تحميل مركز الملفات.</p><p class="muted small">${esc(error?.message||'')}</p><button type="button" class="ghost" data-fs-action="refresh">إعادة المحاولة</button></div>`;
  body.querySelector('[data-fs-action="refresh"]')?.addEventListener('click',()=>openFilesCenter(app,{tab:state.tab}));
 }
 return card;
}

// ===== لوحة الانتباه =====
function attentionHtml(app,portfolio,state){
 const items=buildAttention(portfolio);
 const filtered=state.priority==='all'?items:items.filter(item=>item.priority===state.priority);
 const counts={high:items.filter(item=>item.priority==='high').length,medium:items.filter(item=>item.priority==='medium').length,low:items.filter(item=>item.priority==='low').length};
 const reasonCounts=new Map();
 items.forEach(item=>reasonCounts.set(item.reason,(reasonCounts.get(item.reason)||0)+1));
 return `<section class="fs-section">
  <div class="fs-stats">
   ${fsStat({label:'ملفات محمّلة',value:portfolio.files.length,sub:'من السجلات الأصلية'})}
   ${fsStat({label:'تحتاج انتباهًا عاليًا',value:counts.high,tone:counts.high?'danger':'ok',sub:'مواعيد إدارية مسجلة أو نقص أطراف',action:'review-queue'})}
   ${fsStat({label:'متوسطة',value:counts.medium,tone:'warn',sub:'نشاط قديم أو مسؤول غير مسجل'})}
   ${fsStat({label:'ملفات بلا نشاط حديث',value:buildFreshness(portfolio,{visits:getFileVisits(scopeId(app))}).filter(item=>item.status==='stale').length,sub:'المعيار: 45 يومًا من آخر نشاط مسجل',action:'open-quality'})}
  </div>
  <div class="fs-toolrow">
   <div class="fs-seg" role="group" aria-label="تصفية الأولوية">${[['all','الكل'],['high','عالية'],['medium','متوسطة'],['low','منخفضة']].map(([key,text])=>`<button type="button" class="${state.priority===key?'on':''}" data-priority-filter="${key}">${text}</button>`).join('')}</div>
   <button type="button" class="ghost small" data-fs-action="attention-csv">⇩ تصدير القائمة</button>
   <button type="button" class="ghost small" data-fs-action="review-queue">▶ مراجعة جماعية</button>
   <button type="button" class="ghost small" data-fs-action="open-workspaces">★ مساحات العمل</button>
  </div>
  <div class="fs-attn-list">${filtered.length?filtered.slice(0,300).map(item=>`<article class="fs-attn fs-attn--${esc(item.priority)}">
    <div class="fs-attn-main"><div class="fs-attn-title"><button type="button" class="link" data-open-file="${esc(item.fileId)}" data-tab="${esc(item.tab)}">${esc(item.title)}</button>${fsBadge(PRIORITY_LABEL[item.priority],PRIORITY_TONE[item.priority])}</div>
     <p>${esc(item.reason)}${item.meta?` <small class="muted">— ${esc(item.meta)}</small>`:''}</p>
     <small class="fs-source">المصدر: ${esc(item.source)}</small></div>
    <div class="fs-attn-actions"><button type="button" class="ghost small" data-preview-file="${esc(item.fileId)}">معاينة</button><button type="button" class="primary small" data-open-file="${esc(item.fileId)}" data-tab="${esc(item.tab)}">فتح</button></div>
   </article>`).join(''):fsEmpty('لا توجد عناصر ضمن هذا التصنيف.')}</div>
  ${filtered.length>300?fsNotice('تُعرض أول 300 عنصر؛ استخدم التصدير للقائمة الكاملة.','warn'):''}
  <details class="fs-defs"><summary>تعريف كل سبب ظهور</summary><ul>${[...reasonCounts.entries()].map(([reason,count])=>`<li>${esc(reason)} — ${fsNum(count)} ملف</li>`).join('')}</ul>
   <p class="muted small">التنبيهات إدارية مستندة إلى حقول مسجلة فقط. لا تُنشئ مواعيد قانونية ولا تَعِد بالالتزام بها.</p>
   <p class="muted small">آخر قراءة: ${esc(formatDateTime(portfolio.generatedAt))} · ${networkStatus.isOnline()?'الشبكة متاحة؛ البيانات محلية':'دون اتصال؛ القراءة من التخزين المحلي فقط'}</p>
  </details>
 </section>`;
}

// ===== التحليلات =====
const KPI_KEY='ui:files-kpi-config';
const KPI_DEFS=[
 {id:'total',label:'إجمالي الملفات المحمّلة',definition:'عدد صفوف files غير المحذوفة داخل حد القراءة.'},
 {id:'active',label:'ملفات نشطة',definition:'ليست منتهية وليست مؤرشفة وفق الحالة المسجلة.'},
 {id:'attention',label:'عناصر تحتاج انتباهًا',definition:'مجموع تنبيهات لوحة «ما يحتاج انتباهي» بعد إزالة التكرار لكل ملف/سبب.'},
 {id:'stale',label:'ملفات بلا نشاط حديث',definition:'آخر نشاط مسجل أقدم من 45 يومًا (تاريخ فعلي مسجل).'},
 {id:'missingParties',label:'ملفات بلا أطراف',definition:'لا يوجد أي صف fileParties مرتبط بالملف.'},
 {id:'quality',label:'ملاحظات جودة',definition:'عدد ملاحظات تقرير الجودة الإداري.'}
];
function kpiConfig(){const saved=prefs.get(KPI_KEY,[]);return Array.isArray(saved)&&saved.length?saved:KPI_DEFS.map(item=>item.id)}
function kpiValues(portfolio,{visits=[]}={}){
 const report=buildQualityReport(portfolio);
 const attention=buildAttention(portfolio);
 return {
  total:portfolio.files.length,
  active:portfolio.files.filter(file=>!isClosedFile(file)).length,
  attention:attention.length,
  stale:buildFreshness(portfolio,{visits}).filter(item=>item.status==='stale').length,
  missingParties:portfolio.files.filter(file=>!(portfolio.partiesByFile.get(file.id)||[]).length).length,
  quality:report.issues.length
 };
}
function openKpiConfig(app,rerender){
 const config=new Set(kpiConfig());
 const card=stackedModal(`<h2 class="modal-title">تخصيص مؤشرات مركز الملفات</h2><p class="muted small">اختر المؤشرات التي تريد رؤيتها. التعريف الدقيق لكل مؤشر مذكور أسفله، ويمكن تعديل الاختيار في أي وقت.</p><div class="fs-kpi-config">${KPI_DEFS.map(item=>`<label class="fs-check"><input type="checkbox" value="${item.id}" ${config.has(item.id)?'checked':''}><span><b>${esc(item.label)}</b><small>${esc(item.definition)}</small></span></label>`).join('')}</div><div class="form-actions"><button type="button" class="primary" data-kpi-save>حفظ الاختيار</button><button type="button" class="ghost" data-kpi-reset>استعادة الكل</button></div>`);
 // النافذة مكدَّسة فوق المركز: إغلاقها لا يمسح اللوحة، ثم يُعاد رسم المركز.
 card.querySelector('[data-kpi-save]').onclick=()=>{const ids=[...card.querySelectorAll('input:checked')].map(input=>input.value);prefs.set(KPI_KEY,ids.length?ids:KPI_DEFS.map(item=>item.id));closeModal();toast('حُفظت مؤشراتك');rerender?.()};
 card.querySelector('[data-kpi-reset]').onclick=()=>{prefs.remove(KPI_KEY);closeModal();toast('عادت المؤشرات الافتراضية');rerender?.()};
}
function analyticsHtml(app,portfolio,state){
 const values=kpiValues(portfolio,{visits:getFileVisits(scopeId(app))});
 const config=new Set(kpiConfig());
 const typeRows=fileDistribution(portfolio,{key:'fileType'});
 const statusRows=fileDistribution(portfolio,{key:'status'});
 const monthRows=workloadByMonth(portfolio,{months:6});
 const workload=workloadByProcedureType(portfolio);
 const period=state.periodResult;
 const selected=KPI_DEFS.filter(item=>config.has(item.id));
 return `<section class="fs-section">
  <div class="fs-stats">${selected.map(item=>fsStat({label:item.label,value:values[item.id],sub:item.definition.slice(0,62)+'…'})) .join('')}</div>
  <div class="fs-toolrow"><button type="button" class="ghost small" data-fs-action="kpi-customize">⚙ تخصيص المؤشرات</button><span class="muted small">الأرقام من استعلامات السجلات المحمّلة، لا تقديرات.</span></div>
  <div class="fs-grid2">
   <section class="fs-card"><h3>توزيع الملفات حسب النوع</h3>${fsDonut({rows:typeRows,labelKey:'label',valueKey:'count',caption:'توزيع حسب النوع'})}
    ${fsBarChart({rows:typeRows,onAction:'dist',caption:'حسب النوع'})}</section>
   <section class="fs-card"><h3>توزيع الحالات المسجلة</h3>${fsDonut({rows:statusRows,labelKey:'label',valueKey:'count',caption:'توزيع الحالات'})}
    ${fsBarChart({rows:statusRows,onAction:'dist',caption:'حسب الحالة'})}</section>
  </div>
  <div class="fs-grid2">
   <section class="fs-card"><h3>حجم الأعمال الإدارية حسب النوع</h3>${workload.length?`<table class="fs-table"><thead><tr><th>النوع</th><th>مفتوح</th><th>منجز</th><th>متأخر إداريًا</th><th>الإجمالي</th></tr></thead><tbody>${workload.map(row=>`<tr><td>${esc(row.type)}</td><td>${fsNum(row.open)}</td><td>${fsNum(row.done)}</td><td>${fsNum(row.late)}</td><td>${fsNum(row.total)}</td></tr>`).join('')}</tbody></table><p class="muted small">«متأخر إداريًا» = موعد متابعة مسجل انقضى والعمل ما زال مفتوحًا. لا تُستنتج ساعات عمل أو إنتاجية فردية.</p>`:fsEmpty('لا توجد أعمال إدارية محمّلة.')}</section>
   <section class="fs-card"><h3>الجلسات والإعلانات آخر 6 أشهر</h3>${fsBarChart({rows:monthRows.map(row=>({label:row.label,count:row.hearings+row.announcements+row.procedures})),caption:'حركة مسجلة'})}
    <table class="fs-table"><thead><tr><th>الشهر</th><th>جلسات</th><th>إعلانات</th><th>أعمال</th></tr></thead><tbody>${monthRows.map(row=>`<tr><td>${esc(row.label)}</td><td>${fsNum(row.hearings)}</td><td>${fsNum(row.announcements)}</td><td>${fsNum(row.procedures)}</td></tr>`).join('')}</tbody></table></section>
  </div>
  <section class="fs-card"><h3>مقارنة النشاط بين فترتين</h3>
   <div class="fs-period-grid">
    <label>الفترة أ — من<input type="date" data-period="a-from" value="${esc(state.periodA.from)}"></label><label>إلى<input type="date" data-period="a-to" value="${esc(state.periodA.to)}"></label>
    <label>الفترة ب — من<input type="date" data-period="b-from" value="${esc(state.periodB.from)}"></label><label>إلى<input type="date" data-period="b-to" value="${esc(state.periodB.to)}"></label>
    <button type="button" class="primary" data-fs-action="period-run">احسب المقارنة</button>
   </div>
   ${period?`<div class="fs-period-result">
    <div><b>الملفات المفتوحة</b><span>${fsNum(period.files.a)} → ${fsNum(period.files.b)}</span><small>${period.files.delta>=0?'+':''}${fsNum(period.files.delta)}${period.files.percent!==null?` (${period.files.percent}%)`:''}</small></div>
    <div><b>الأعمال الإدارية</b><span>${fsNum(period.procedures.a)} → ${fsNum(period.procedures.b)}</span><small>${period.procedures.delta>=0?'+':''}${fsNum(period.procedures.delta)}${period.procedures.percent!==null?` (${period.procedures.percent}%)`:''}</small></div>
    <p class="muted small">${esc(period.note)}</p></div>`:''}
   <details class="fs-defs"><summary>تعريف المقارنة</summary><p class="muted small">ملفات: العدّ بحقل files.openedAt داخل كل فترة. أعمال إدارية: العدّ بحقل procedures.actionDate (أو createdAt عند غيابه). لا تُقارن فترات غير محددة، ولا تُستنتج مواعيد قانونية.</p></details>
  </section>
 </section>`;
}

function runPeriodCompare(app,state,rerender){
 const aFrom=document.querySelector('[data-period="a-from"]')?.value||'',aTo=document.querySelector('[data-period="a-to"]')?.value||'';
 const bFrom=document.querySelector('[data-period="b-from"]')?.value||'',bTo=document.querySelector('[data-period="b-to"]')?.value||'';
 if(!aFrom||!aTo||!bFrom||!bTo){toast('حدّد بداية ونهاية كل فترة أولًا.','error');return}
 if(aFrom>aTo||bFrom>bTo){toast('نطاق الفترة غير صحيح: البداية بعد النهاية.','error');return}
 state.periodA={from:aFrom,to:aTo};state.periodB={from:bFrom,to:bTo};
 getPortfolio(app,{force:true}).then(portfolio=>{
  const files=portfolio.files;
  const procedures=[];for(const rows of portfolio.proceduresByFile.values())procedures.push(...rows);
  const filesResult=comparePeriods(files,{dateField:'openedAt',periodA:state.periodA,periodB:state.periodB});
  const proceduresResult=comparePeriods(procedures,{dateField:'actionDate',periodA:state.periodA,periodB:state.periodB});
  state.periodResult={files:filesResult,procedures:proceduresResult,note:'الفترتان كما أدخلتهما؛ العدّ على الحقول المسجلة فقط. لم تُستنتج أي فترة بديلة.'};
  rerender?.();
 }).catch(error=>toast(error?.message||'تعذر حساب المقارنة','error'));
}

// ===== جودة البيانات =====
function qualityHtml(portfolio,state){
 const report=buildQualityReport(portfolio);
 const levels=[['all','الكل'],['error','خطأ مؤكد'],['missing','نقص بيانات'],['warning','تنبيه للمراجعة']];
 const issues=state.qualityLevel==='all'?report.issues:report.issues.filter(item=>item.level===state.qualityLevel);
 const dupes=detectDuplicateFiles(portfolio);
 return `<section class="fs-section">
  <div class="fs-stats">
   ${fsStat({label:'خطأ مؤكد',value:report.byLevel.error,tone:report.byLevel.error?'danger':'ok'})}
   ${fsStat({label:'نقص بيانات',value:report.byLevel.missing,tone:'warn'})}
   ${fsStat({label:'تنبيه للمراجعة',value:report.byLevel.warning,tone:'neutral'})}
   ${fsStat({label:'سجلات متشابهة',value:dupes.candidates.length,tone:dupes.candidates.length?'warn':'ok',action:'compare-two'})}
  </div>
  <div class="fs-toolrow"><div class="fs-seg" role="group" aria-label="تصفية مستوى الملاحظة">${levels.map(([key,text])=>`<button type="button" class="${state.qualityLevel===key?'on':''}" data-quality-filter data-level="${key}">${text}</button>`).join('')}</div>
   <button type="button" class="ghost small" data-fs-action="quality-csv">⇩ CSV</button><button type="button" class="ghost small" data-fs-action="quality-print">🖨 طباعة</button></div>
  ${issues.length?`<div class="fs-issue-list">${issues.slice(0,400).map(item=>`<article class="fs-issue fs-issue--${esc(item.level)}">
   <div><div class="fs-issue-head">${fsBadge(item.levelLabel,item.level==='error'?'danger':item.level==='missing'?'warn':'neutral')}<b>${esc(item.message)}</b></div>
   <small>${esc(item.title)}${item.field?` · الحقل: ${esc(item.field)}`:''} · المصدر: ${esc(item.source)}</small></div>
   <button type="button" class="ghost small" data-open-file="${esc(item.fileId)}" data-tab="${esc(item.tab)}">إصلاح</button></article>`).join('')}</div>${issues.length>400?fsNotice('تُعرض أول 400 ملاحظة؛ التصدير يشمل الكل.','warn'):''}`:fsEmpty('لا توجد ملاحظات ضمن هذا المستوى.')}
  <p class="muted small">${esc(report.disclaimer)}</p>
  ${dupes.candidates.length?`<section class="fs-card"><h3>سجلات متشابهة (تحتاج مراجعة بشرية)</h3><ul class="fs-simple-list">${dupes.candidates.slice(0,8).map(candidate=>`<li><button type="button" class="link" data-open-file="${esc(candidate.a.id)}">${esc(fileTitle(candidate.a))}</button><span>↔</span><button type="button" class="link" data-open-file="${esc(candidate.b.id)}">${esc(fileTitle(candidate.b))}</button><small>${candidate.reasons.map(reason=>reason.type==='title'?`تشابه العنوان ${Math.round(reason.score*100)}%`:reason.type==='fileNumber'?'نفس الرقم':`تشابه اسم موكل`).join(' · ')}</small></li>`).join('')}</ul><p class="muted small">${esc(dupes.note)}</p></section>`:''}
 </section>`;
}

// ===== العلاقات =====
function relationsHtml(portfolio,state){
 const audit=buildRelationAudit(portfolio);
 const partyIndex=new Map();
 for(const [fileId,parties] of portfolio.partiesByFile){
  for(const party of parties){
   const name=party.name||party.partyName;
   if(!name)continue;
   // الهوية أولًا: clientId/opponentId إن وُجد؛ لا ندمج طرفين مختلفين لمجرد تشابه الاسم.
   const key=party.clientId?`client:${party.clientId}`:party.opponentId?`opponent:${party.opponentId}`:`name:${normalizeArabic(name)}`;
   if(!partyIndex.has(key))partyIndex.set(key,{name,party,files:new Set()});
   partyIndex.get(key).files.add(fileId);
  }
 }
 const sharedParties=[...partyIndex.values()].filter(entry=>entry.files.size>1).sort((a,b)=>b.files.size-a.files.size);
 const first=portfolio.files[0];
 return `<section class="fs-section">
  <div class="fs-stats">
   ${fsStat({label:'علاقات مسجلة',value:audit.total})}
   ${fsStat({label:'روابط غير مكتملة',value:audit.broken.length,tone:audit.broken.length?'danger':'ok'})}
   ${fsStat({label:'علاقات مكررة',value:audit.duplicates.length,tone:audit.duplicates.length?'warn':'ok'})}
   ${fsStat({label:'أطراف مشتركة بين ملفات',value:sharedParties.length})}
  </div>
  <div class="fs-toolrow"><button type="button" class="ghost small" data-fs-action="relation-map" data-map-file="${esc(first?.id||'')}">◉ خريطة علاقات الملف</button><span class="muted small">كل خط يمثل علاقة مسجلة في fileRelations أو مرحلة قضائية مرتبطة فعليًا بالملف.</span></div>
  ${audit.broken.length?`<section class="fs-card"><h3>روابط تحتاج مراجعة</h3><table class="fs-table"><thead><tr><th>الملف المصدر</th><th>الملف الهدف</th><th>المفقود</th><th>النوع</th><th>إجراء</th></tr></thead><tbody>${audit.broken.slice(0,100).map(item=>`<tr><td>${esc(item.source?fileTitle(item.source):'(غير موجود)')}</td><td>${esc(item.relation.targetFileId||'')}</td><td>${esc(item.missing.join('، '))}</td><td>${esc(item.relation.relationType||'')}</td><td><button type="button" class="link" data-open-file="${esc(item.relation.sourceFileId)}" data-tab="relations">فتح العلاقات</button></td></tr>`).join('')}</tbody></table><p class="muted small">${esc(audit.note)}</p></section>`:fsEmpty('لا توجد روابط غير مكتملة ضمن البيانات المحمّلة.')}
  <section class="fs-card"><h3>الأطراف المشتركة عبر الملفات</h3>${sharedParties.length?`<table class="fs-table"><thead><tr><th>الطرف كما هو مسجل</th><th>عدد الملفات</th><th>الملفات</th><th>ملاحظة</th></tr></thead><tbody>${sharedParties.slice(0,100).map(entry=>`<tr><td>${esc(entry.name)} <small class="muted">(${esc(entry.party.role||'')})</small></td><td>${entry.files.size}</td><td>${[...entry.files].slice(0,4).map(id=>{const file=portfolio.fileById.get(id);return file?`<button type="button" class="link" data-open-file="${esc(id)}">${esc(formatFileNumber(file.fileNumber)||'ملف')}</button>`:''}).join('، ')}${entry.files.size>4?'…':''}</td><td>${fsBadge('علاقة موثقة بالمعرّف','ok')}</td></tr>`).join('')}</tbody></table><p class="muted small">التطابق هنا مبني على معرّف الطرف المسجل (clientId/opponentId) عند توفره، وإلا على تطابق الاسم المطبَّع حرفيًا؛ ولا يُنشأ أي دمج.</p>`:fsEmpty('لا توجد أطراف مشتركة.')}</section>
 </section>`;
}

// ===== التشابه =====
function duplicatesHtml(portfolio,state){
 const result=detectDuplicateFiles(portfolio);
 return `<section class="fs-section">
  ${portfolioScopeNote(portfolio)}
  ${result.candidates.length?result.candidates.map((candidate,index)=>{
   const reasons=candidate.reasons.map(reason=>reason.type==='title'?`تشابه العنوان: «${esc(reason.a)}» ↔ «${esc(reason.b)}» (${Math.round(reason.score*100)}%)`:reason.type==='fileNumber'?`رقم ملف مطابق: ${esc(reason.a)}`:`اسم موكل متشابه: «${esc(reason.a)}» ↔ «${esc(reason.b)}»`).join(' · ');
   return `<article class="fs-dupe"><div><div class="fs-dupe-head"><b>${esc(fileTitle(candidate.a))}</b><span>↔</span><b>${esc(fileTitle(candidate.b))}</b></div><p>${reasons}</p><small class="muted">المصدر: files/fileParties — النتيجة اقتراح مراجعة، ولا دمج آلي.</small></div>
    <div class="fs-dupe-actions"><button type="button" class="ghost small" data-open-file="${esc(candidate.a.id)}">فتح الأول</button><button type="button" class="ghost small" data-open-file="${esc(candidate.b.id)}">فتح الثاني</button><button type="button" class="ghost small" data-fs-action="compare-two" data-dupe-a="${esc(candidate.a.id)}" data-dupe-b="${esc(candidate.b.id)}">مقارنتهما</button></div></article>`;
  }).join(''):fsEmpty('لا توجد سجلات متشابهة ضمن الحد المحمّل.')}
  <p class="muted small">${esc(result.note)}</p>
 </section>`;
}

// ===== البحث والفهرس =====
/** بطاقة ملخص إداري مصغّرة لأقرب نتيجة بحث — كل سطر يذكر مصدره، والناقص يُعلن كذلك. */
function adminSummaryCard(portfolio,result){
 if(!result||!result.rows.length)return '<p class="muted small">اكتب في حقل البحث أعلى المركز لعرض ملخص إداري لأقرب ملف مطابق، مع مصدر كل قيمة والحقول الناقصة.</p><button type="button" class="ghost" data-fs-action="open-workspaces">إدارة مساحات العمل</button>';
 const file=result.rows[0].file;
 let summary=null;
 try{summary=buildVerifiableSummary(portfolio,file.id)}catch{}
 if(!summary)return '<p class="muted small">تعذّر بناء الملخص لهذا الملف.</p>';
 const lines=summary.lines.slice(0,6);
 return `<p class="muted small">أقرب ملف مطابق: <button type="button" class="link" data-open-file="${esc(file.id)}">${esc(fileTitle(file))}</button> — ${summary.missingCount} حقلًا غير مسجل.</p>
  <table class="fs-table fs-table--compact"><tbody>${lines.map(line=>`<tr class="${line.available?'':'is-missing'}"><td>${esc(line.label)}</td><td>${line.available?esc(line.value):fsMissing()}</td><td><code>${esc(line.source)}</code></td></tr>`).join('')}</tbody></table>
  <div class="fs-toolrow"><button type="button" class="primary small" data-fs-action="summary-open" data-summary-file="${esc(file.id)}">فتح الملخص الكامل</button><button type="button" class="ghost small" data-open-file="${esc(file.id)}">فتح الملف</button></div>
  <p class="fs-source">${esc(summary.disclaimer)}</p>`;
}

function searchHtml(portfolio,state){
 const parsed=parseFileQuery(state.query);
 const result=state.query.trim()?searchPortfolio(portfolio,parsed,{limit:200}):null;
 return `<section class="fs-section">
  <div class="fs-card">
   <h3>البحث المركب والفوري</h3>
   <p class="muted small">استخدم صيغًا صريحة: <code>نوع:قضية</code> · <code>حالة:مفتوح</code> · <code>سنة:2026</code> · <code>رقم:4/2026</code> · <code>موكل:أحمد</code> · <code>خصم:شركة</code> · <code>مرحلة:استئناف</code>. النص الحر يُطابق الاسم والعنوان والملاحظات والأطراف والمراحل.</p>
   ${state.query.trim()?`<div class="fs-query-chips">${parsed.labels.map(labelText=>`<span class="chip">${esc(labelText)}</span>`).join('')}${parsed.tokens.length?`<span class="chip">نص: ${esc(parsed.text)}</span>`:''}${parsed.ignoredKeys.length?`<span class="chip chip--warn">مفتاح غير معروف: ${esc(parsed.ignoredKeys.join('، '))}</span>`:''}</div>`:''}
   ${result?`<p class="fs-result-count">${fsNum(result.total)} نتيجة مطابقة${result.truncated?` — تُعرض أول ${fsNum(result.rows.length)}`:''} · المصدر: ${esc(result.source)}</p>
   <div class="fs-search-results">${result.rows.map(item=>`<article class="fs-search-row"><div><div><button type="button" class="link" data-open-file="${esc(item.file.id)}">${esc(fileTitle(item.file))}</button> ${statusLine(item.file)}</div><small>${esc((item.parties||[]).map(party=>party.name||party.partyName).filter(Boolean).slice(0,3).join('، '))}${(item.stages||[]).length?` · ${esc(item.stages.map(stage=>`${stage.stageType||stage.numberType||'مرحلة'} ${stage.caseNumber||''}`).join('، '))}`:''}</small>${item.excerpt?`<p class="fs-excerpt">${highlightParts(item.excerpt.text,parsed).map(part=>part.hit?`<mark>${esc(part.text)}</mark>`:esc(part.text)).join('')}</p>`:''}</div><button type="button" class="ghost small" data-preview-file="${esc(item.file.id)}">معاينة</button></article>`).join('')||fsEmpty('لا نتائج مطابقة. جرّب صيغة أخرى أو أزل بعض المعايير.')}</div>`:`<p class="muted small">اكتب في حقل البحث أعلى المركز لبدء البحث الفوري.</p>`}
  </div>
  <div class="fs-grid2">
   <section class="fs-card"><h3>الفهرس النصي الداخلي</h3><p class="muted small">يبحث في الملاحظات والوصف والمراسلات والمستندات المسجلة، ويُبنى عند الطلب من السجلات نفسها. لا يُخزَّن فهرس دائم.</p>
    <div class="fs-toolrow"><button type="button" class="primary small" data-fs-action="long-index">${state.longIndex?'إعادة بناء الفهرس':'بناء الفهرس الآن'}</button>${state.longIndex?`<span class="muted small">${fsNum(state.longIndex.entries.length)} نصًا ${state.longIndex.more?'· توجد سجلات خارج الحد':''}</span>`:''}</div>
    ${state.longIndex?`<div class="fs-long-search"><input type="search" data-long-q value="${esc(state.longQuery)}" placeholder="ابحث داخل النصوص الطويلة…" aria-label="بحث داخل النصوص"><select data-long-store aria-label="نطاق البحث"><option value="all">كل المصادر</option><option value="caseNotes">الملاحظات</option><option value="documentReferences">المستندات</option><option value="procedures">الأعمال</option><option value="communications">الاتصالات</option></select><button type="button" class="ghost small" data-fs-action="long-search">بحث</button></div><div data-long-results>${longResultsHtml(state)}</div>`:''}
   </section>
   <section class="fs-card"><h3>ملخص إداري آلي قابل للتحقق</h3>${adminSummaryCard(portfolio,result)}</section>
  </div>
 </section>`;
}

function longResultsHtml(state){
 const index=state.longIndex;
 if(!index)return '';
 const needle=normalizeArabic(state.longQuery||'');
 if(!needle)return `<p class="muted small">اكتب كلمة للبحث في ${fsNum(index.entries.length)} نصًا.</p>`;
 const store=state.longStore||'all';
 const rows=index.entries.filter(entry=>(store==='all'||entry.store===store)&&(normalizeArabic(entry.title+' '+entry.body).includes(needle))).slice(0,100);
 if(!rows.length)return '<p class="muted small">لا نتائج.</p>';
 return `<div class="fs-long-results">${rows.map(entry=>{
  const body=String(entry.body||'');
  const normalized=normalizeArabic(body);
  const at=normalized.indexOf(needle);
  const excerpt=at>=0?`${at>50?'…':''}${body.slice(Math.max(0,at-50),Math.min(body.length,at+needle.length+90))}${at+needle.length+90<body.length?'…':''}`:body.slice(0,140);
  return `<article><button type="button" class="link" data-open-record="${esc(entry.route)}">${esc(entry.title)}</button> <small class="muted">${esc(SOURCE_LABEL[entry.store]||entry.store)}${entry.date?` · ${fmtDate(entry.date)}`:''}</small><p>${highlightParts(excerpt,state.longQuery).map(part=>part.hit?`<mark>${esc(part.text)}</mark>`:esc(part.text)).join('')}</p></article>`;
 }).join('')}</div>${rows.length>=100?'<p class="muted small">تُعرض أول 100 نتيجة.</p>':''}`;
}

async function loadLongIndex(app,state,rerender){
 const office=officeOf(app);
 try{
  state.longIndex=await buildLongTextIndex(office);
  rerender?.();
  const input=document.querySelector('[data-long-q]');
  if(input){input.addEventListener('input',e=>{state.longQuery=e.target.value;const host=document.querySelector('[data-long-results]');if(host)host.innerHTML=longResultsHtml(state)});input.focus()}
  const select=document.querySelector('[data-long-store]');
  if(select)select.addEventListener('change',e=>{state.longStore=e.target.value;const host=document.querySelector('[data-long-results]');if(host)host.innerHTML=longResultsHtml(state)});
 }catch(error){toast(error?.message||'تعذر بناء الفهرس','error')}
}

// ===== معاينة سريعة (Drawer) =====
export async function openFileQuickDrawer(app,fileId){
 const office=officeOf(app);
 const portfolio=await getPortfolio(app);
 const file=await office.r.files.get(fileId).catch(()=>null);
 if(!file||file.isDeleted){toast('الملف غير متاح','error');return}
 const parties=safeParties(portfolio,fileId),stages=safeStages(portfolio,fileId);
 const completeness=administrativeCompleteness(file,{parties,stages});
 const nextDate=file.nextStepDate?fmtDate(file.nextStepDate):'';
 const favorite=getFavorites(scopeId(app)).some(item=>item.route===`file:${fileId}`);
 const body=`<div class="fs-preview">
  <div class="fs-preview-title"><div><span class="muted small">${esc(file.fileType||'ملف')}</span><h3>${esc(fileTitle(file))}</h3></div>${statusLine(file)}</div>
  <div class="fs-preview-actions"><button type="button" class="primary small" data-preview-open>فتح الملف</button><button type="button" class="ghost small" data-preview-edit>تعديل</button><button type="button" class="ghost small" data-preview-checklist>قائمة التحقق</button><button type="button" class="ghost small" data-preview-summary>ملخص قابل للتحقق</button><button type="button" class="ghost small" data-preview-tab="parties">الأطراف</button><button type="button" class="ghost small" data-preview-tab="judicial">المراحل</button><button type="button" class="ghost small" data-preview-tab="relations">العلاقات</button><button type="button" class="ghost small" data-preview-fav>${favorite?'★ مثبت':'☆ تثبيت'}</button></div>
  <dl class="fs-kv">
   <div><dt>الموكلون</dt><dd>${parties.filter(party=>party.partyKind==='client'||party.clientId).map(party=>esc(party.name||party.partyName)).join('، ')||fsMissing()}</dd></div>
   <div><dt>الخصوم</dt><dd>${parties.filter(party=>party.partyKind==='opponent'||party.opponentId).map(party=>esc(party.name||party.partyName)).join('، ')||fsMissing()}</dd></div>
   <div><dt>المرحلة الحالية</dt><dd>${stages.length?esc(stages.map(stage=>`${stage.stageType||stage.numberType||'مرحلة'} ${stage.caseNumber||''}${stage.caseYear?'/'+stage.caseYear:''}`).join('، ')):fsMissing('لا توجد مرحلة مسجلة')}</dd></div>
   <div><dt>آخر نشاط مسجل</dt><dd>${file.lastActivityAt?esc(formatDateTime(file.lastActivityAt)):fsMissing()}</dd></div>
   <div><dt>الخطوة التالية</dt><dd>${file.nextStep?esc(file.nextStep):fsMissing()}${nextDate?` — ${esc(nextDate)}`:''}</dd></div>
   <div><dt>المحامي المسؤول</dt><dd>${file.responsibleLawyer?esc(file.responsibleLawyer):fsMissing()}</dd></div>
  </dl>
  ${fsMeter({value:completeness.percent,label:completeness.label,caption:completeness.disclaimer})}
  ${completeness.missing.length?`<details class="fs-defs" open><summary>نواقص إدارية (${completeness.missing.length})</summary><ul>${completeness.missing.map(item=>`<li>${esc(item.label)}${item.note?` <small class="muted">— ${esc(item.note)}</small>`:''} <button type="button" class="link small" data-preview-tab="${esc(item.tab)}">إصلاح</button></li>`).join('')}</ul></details>`:''}
  <p class="fs-source">المصدر: files · fileParties · cases. البيانات محدثة من السجلات الأصلية عند فتح هذه اللوحة.</p>
 </div>`;
 const drawer=openFsDrawer({title:'معاينة سريعة',sub:fileTitle(file),body,side:'start',className:'fs-preview-drawer'});
 const host=drawer.wrap;
 host.querySelector('[data-preview-open]')?.addEventListener('click',()=>{drawer.close();app.go(`file:${fileId}`)});
 host.querySelectorAll('[data-preview-tab]').forEach(button=>button.addEventListener('click',()=>{drawer.close();app.go(`file:${fileId}?tab=${encodeURIComponent(button.dataset.previewTab)}`)}));
 host.querySelector('[data-preview-edit]')?.addEventListener('click',async()=>{drawer.close();await editFileWithReview(app,fileId)});
 host.querySelector('[data-preview-checklist]')?.addEventListener('click',async()=>{drawer.close();await openFileChecklist(app,fileId)});
 host.querySelector('[data-preview-summary]')?.addEventListener('click',async()=>{drawer.close();await openVerifiableSummary(app,fileId)});
 host.querySelector('[data-preview-fav]')?.addEventListener('click',async()=>{
  const on=await toggleFavorite({route:`file:${fileId}`,title:fileTitle(file),sub:file.fileType||''},scopeId(app));
  toast(on?'أُضيف إلى المثبتة':'أُزيل من المثبتة');
  drawer.close();openFileQuickDrawer(app,fileId);
 });
 return drawer;
}

export {getPortfolio,fileTitle,statusLine,loadingBody};

// =====================================================================
// مساحات العمل
// =====================================================================
function listState(app){return app.__lists?.files||null}
function currentGridOf(){
 if(typeof document==='undefined')return null;
 return document.querySelector('#list-grid')?.__grid||document.querySelector('#main-content .fw-grid')?.__grid||null;
}
function captureCurrentWorkspace(app){
 const st=listState(app)||{};
 const grid=currentGridOf();
 return {
  list:{q:st.q||'',preset:st.preset||'all',from:st.from||'',to:st.to||'',chip:st.chip||'all',status:st.status||'all',showCal:Boolean(st.showCal)},
  gridView:grid?.getActiveView?.()||'',
  gridState:grid?.getViewState?.()||null,
  tab:'',focus:''
 };
}
async function applyWorkspace(app,workspace){
 if(!workspace)return;
 const st=listState(app);
 if(!st){toast('افتح قائمة الملفات أولًا لتطبيق مساحة العمل.','error');return}
 applyWorkspaceToList(st,workspace);
 try{await prefs.set('ui:list-view:files',{q:st.q||'',preset:st.preset||'all',from:st.from||'',to:st.to||'',showCal:Boolean(st.showCal),status:st.status||'all',chip:st.chip||'all'})}catch{}
 closeModal();
 toast(`طُبّقت مساحة العمل: ${workspace.name}`);
 await app.go('files',{replace:true,forceRender:true});
 // لقطة الجدول تُطبَّق بعد تركيب الجدول الجديد — تغيير عرض فقط، ولا تمس أي سجل.
 if(workspace.gridState||workspace.gridView){
  setTimeout(()=>{
   const grid=currentGridOf();
   if(!grid)return;
   if(workspace.gridView)grid.applySavedView?.(workspace.gridView);
   if(workspace.gridState)grid.applyViewState?.(workspace.gridState);
  },140);
 }
}
export async function openFilesWorkspaces(app){
 const card=fsState({title:'مساحات العمل',body:loadingBody('جارٍ تجهيز مساحات العمل…'),wide:true});
 const body=card.querySelector('.fs-sheet-body');
 const draw=()=>{
  const current=captureCurrentWorkspace(app);
  const list=[...builtInWorkspaces().map(item=>({...item,builtin:true})),...getWorkspaces()];
  body.innerHTML=`<p class="muted small">مساحة العمل = اسم لمرشحات القائمة وطريقة عرض الجدول والتبويب المقصود. لا تُنسخ أي سجلات، ولا تغيّر أي بيانات. تطبيقها يغيّر العرض فقط.</p>
   <div class="fs-toolrow"><button type="button" class="primary small" data-ws-save>★ حفظ الحالة الحالية كمساحة عمل</button><button type="button" class="ghost small" data-ws-export>⇩ تصدير الإعدادات</button><button type="button" class="ghost small" data-ws-import>⇧ استيراد إعدادات</button><span class="muted small">${getWorkspaces().length}/30 مساحة مخصصة</span></div>
   <div class="fs-ws-list">${list.map(item=>`<article class="fs-ws${item.builtin?' is-builtin':''}">
     <div><b>${esc(item.name)}</b>${item.builtin?fsBadge('جاهزة','neutral'):''}<p>${esc(item.note||workspaceSummary(item))}</p></div>
     <div class="fs-ws-actions"><button type="button" class="primary small" data-ws-apply="${esc(item.id)}">تطبيق</button>
      ${item.builtin?'':`<button type="button" class="ghost small" data-ws-rename="${esc(item.id)}">إعادة تسمية</button><button type="button" class="ghost small" data-ws-dup="${esc(item.id)}">نسخ</button><button type="button" class="link danger" data-ws-del="${esc(item.id)}">حذف</button>`}
     </div></article>`).join('')||fsEmpty('لا توجد مساحات مخصصة بعد.')}</div>
   <details class="fs-defs"><summary>ما الذي يُحفظ في المساحة؟</summary><ul><li>البحث والفلاتر وشريحة الحالة وفترة التاريخ (نفس مفاتيح ui:list-view:files).</li><li>لقطة عرض الجدول: الأعمدة الظاهرة وترتيبها والفرز والكثافة والبطاقات (مفاتيح بيضاء فقط).</li><li>لا تُحفظ بيانات موكلين ولا أسماء أطراف ولا مرفقات.</li></ul>
   <p class="muted small">الحالة الملتقطة الآن: بحث «${esc(current.list.q||'—')}» · شريحة ${esc(current.list.chip||'all')} · ${current.gridState?'لقطة جدول متاحة':'لا توجد لقطة جدول'}.</p></details>
   <div class="fs-hint">لتطبيق مساحة على ملف واحد، افتح الملف ثم استخدم «مساحة عمل الملف» من قائمة الإجراءات.</div>`;
  bind();
 };
 const bind=()=>{
  body.querySelectorAll('[data-ws-apply]').forEach(button=>button.addEventListener('click',async()=>{
   const id=button.dataset.wsApply;
   const workspace=[...builtInWorkspaces(),...getWorkspaces()].find(item=>item.id===id);
   await applyWorkspace(app,workspace);
  }));
  body.querySelector('[data-ws-save]')?.addEventListener('click',async()=>{
   const answer=await fsConfirm('احفظ الحالة الحالية كمساحة عمل. اكتب اسمًا واضحًا للمهمة (مثل: مراجعة جلسات الأسبوع).',{okText:'حفظ',input:true,label:'اسم مساحة العمل',placeholder:'مثال: ملفات تحتاج إجراء — أسبوعي'});
   if(!answer?.ok)return;
   try{const record=saveWorkspace({name:answer.value,...captureCurrentWorkspace(app)});toast(`حُفظت مساحة «${record.name}»`);draw()}
   catch(error){toast(error?.message||'تعذر الحفظ','error')}
  });
  body.querySelector('[data-ws-export]')?.addEventListener('click',async()=>{
   const answer=await fsConfirm('سيُصدَّر ملف إعدادات عرض فقط (مساحات العمل ولقطة الجدول والتفضيلات). لا يحتوي أي سجل أو بيانات موكل.',{okText:'تصدير'});
   if(!answer)return;
   const {json}=exportSettingsTemplate({gridState:captureCurrentWorkspace(app).gridState,workspaces:getWorkspaces(),appVersion:prefs.get('app:version','')});
   downloadJson(`akl-files-settings-${localDate()}.json`,json);
   toast('صُدّر ملف الإعدادات — لا يحتوي بيانات سجلات');
  });
  body.querySelector('[data-ws-import]')?.addEventListener('click',async()=>{
   const picked=await pickJsonFile({maxBytes:512000});
   if(!picked)return;
   try{
    const result=importSettingsTemplate(picked.text);
    const lines=[`مساحات عمل مستوردة: ${result.importedWorkspaces}`,`تفضيلات صفحات: ${result.importedPages}`,`بطاقات: ${result.importedCards}`,`عناصر واجهة: ${result.importedComponents}`];
    const message=`تم الاستيراد دون حذف أي تفضيل قائم. ${lines.join(' · ')}.${result.renamed.length?` أُعيدت تسمية ${result.renamed.length} مساحة لتعارض الأسماء.`:''}`;
    const applyGrid=result.gridState?await fsConfirm(`${message}\nهل تريد تطبيق لقطة الجدول المستوردة على جدول الملفات الحالي؟ (تغيير عرض فقط، ولا يمس السجلات)`,{okText:'تطبيق لقطة الجدول',cancelText:'لاحقًا'}):false;
    if(applyGrid){const grid=currentGridOf();grid?.applyViewState?.(result.gridState);toast('طُبّقت لقطة الجدول المستوردة')}
    else toast(message);
    draw();
   }catch(error){toast(error?.message||'ملف الإعدادات غير صالح','error')}
  });
  if(!body.dataset.wsBound){body.dataset.wsBound='1';body.addEventListener('click',async event=>{
   const rename=event.target.closest('[data-ws-rename]');
   if(rename){
    const item=getWorkspaces().find(work=>work.id===rename.dataset.wsRename);if(!item)return;
    const answer=await fsConfirm('اكتب الاسم الجديد لمساحة العمل.',{okText:'إعادة التسمية',input:true,label:'الاسم',value:item.name});
    if(!answer?.ok)return;
    try{renameWorkspace(item.id,answer.value);toast('أُعيدت التسمية');draw()}catch(error){toast(error?.message||'تعذرت إعادة التسمية','error')}
    return;
   }
   const dup=event.target.closest('[data-ws-dup]');
   if(dup){try{const copy=duplicateWorkspace(dup.dataset.wsDup);toast(`نُسخت إلى «${copy.name}»`);draw()}catch(error){toast(error?.message||'تعذر النسخ','error')}return}
   const del=event.target.closest('[data-ws-del]');
   if(del){
    const item=getWorkspaces().find(work=>work.id===del.dataset.wsDel);if(!item)return;
    const ok=await reviewImpact({title:'حذف مساحة عمل',summary:`سيُحذف تعريف «${item.name}» فقط.`,effects:['حذف الاسم والمرشحات المحفوظة.'],caveats:['لا تُحذف أي بيانات ملفات أو موكلين.','لا يمكن التراجع بعد الحذف.'],okText:'حذف المساحة',danger:true});
    if(!ok)return;
    deleteWorkspace(item.id);toast('حُذفت مساحة العمل');draw();
   }
  })}
 };
 draw();
 return card;
}
function workspaceSummary(item){
 const parts=[];
 if(item.list?.chip&&item.list.chip!=='all')parts.push(`شريحة: ${item.list.chip}`);
 if(item.list?.status&&item.list.status!=='all')parts.push(`حالة: ${item.list.status}`);
 if(item.gridView)parts.push(`عرض: ${item.gridView}`);
 if(item.tab)parts.push(`تبويب: ${item.tab}`);
 return parts.join(' · ')||'بلا مرشحات إضافية';
}

// =====================================================================
// آخر الملفات والزيارات والمثبتة
// =====================================================================
export async function openRecentFiles(app){
 const scope=scopeId(app);
 const recents=getRecent(scope);
 const visits=getFileVisits(scope);
 const favorites=getFavorites(scope).filter(item=>String(item.route).startsWith('file:'));
 const body=`<div class="fs-recent">
  <section><h3>آخر ما فتحت <small>${recents.length}</small></h3>${recents.length?`<ul class="fs-simple-list">${recents.map(item=>`<li><button type="button" class="link" data-open-record="${esc(item.route)}">${esc(item.title)}</button><small>${esc(item.sub||'')} ${item.at?`· ${esc(formatDateTime(item.at))}`:''}</small><button type="button" class="link danger small" data-recent-remove="${esc(item.route)}" aria-label="إزالة من الأخيرة">✕</button></li>`).join('')}</ul><button type="button" class="ghost small" data-recent-clear>مسح سجل «آخر ما فتحت»</button>`:fsEmpty('لا توجد سجلات مفتوحة حديثًا.')}</section>
  <section><h3>سجل زيارات الملفات <small>${visits.length}</small></h3>${visits.length?`<ul class="fs-simple-list">${visits.map(item=>`<li><button type="button" class="link" data-open-file="${esc(item.fileId)}" data-tab="${esc(item.tab||'summary')}">${esc(item.title||item.fileId)}</button><small>${item.at?esc(formatDateTime(item.at)):''}${item.tab?` · ${esc(item.tab)}`:''} ${item.lastActivityAt?` · آخر نشاط ${fmtDate(item.lastActivityAt)}`:''}</small><button type="button" class="link danger small" data-visit-remove="${esc(item.fileId)}" aria-label="إزالة الزيارة">✕</button></li>`).join('')}</ul><button type="button" class="ghost small" data-visit-clear>مسح سجل الزيارات</button><p class="muted small">الزيارة تفضيل محلي منفصل عن سجل النشاط القانوني.</p>`:fsEmpty('لا توجد زيارات مسجلة.')}</section>
  <section><h3>الملفات المثبتة <small>${favorites.length}</small></h3>${favorites.length?`<ul class="fs-simple-list">${favorites.map(item=>`<li><button type="button" class="link" data-open-record="${esc(item.route)}">${esc(item.title)}</button><small>${esc(item.sub||'')}</small><button type="button" class="link danger small" data-fav-remove="${esc(item.route)}" aria-label="إلغاء التثبيت">✕</button></li>`).join('')}</ul>`:fsEmpty('لم تثبّت أي ملف بعد.')}</section>
 </div>`;
 const card=fsState({title:'آخر الملفات والزيارات',body,className:'fs-recents'});
 const host=card.querySelector('.fs-sheet-body');
 host.querySelectorAll('[data-open-record]').forEach(button=>button.addEventListener('click',()=>openRoute(app,button.dataset.openRecord)));
 host.querySelectorAll('[data-open-file]').forEach(button=>button.addEventListener('click',()=>{closeModal();app.go(`file:${button.dataset.openFile}${button.dataset.tab?`?tab=${encodeURIComponent(button.dataset.tab)}`:''}`)}));
 host.addEventListener('click',async event=>{
  const recentRemove=event.target.closest('[data-recent-remove]');
  if(recentRemove){removeRecent(recentRemove.dataset.recentRemove,scope);openRecentFiles(app);return}
  if(event.target.closest('[data-recent-clear]')){if(await fsConfirm('مسح سجل «آخر ما فتحت»؟ لا يمس أي سجل ملف أو بياناته.',{okText:'مسح السجل'})){clearRecent(scope);openRecentFiles(app)}return}
  const visitRemove=event.target.closest('[data-visit-remove]');
  if(visitRemove){removeFileVisit(visitRemove.dataset.visitRemove,{scope});openRecentFiles(app);return}
  if(event.target.closest('[data-visit-clear]')){if(await fsConfirm('مسح سجل زيارات الملفات المحلي؟ لا يمس أي سجل أو نشاط.',{okText:'مسح الزيارات'})){clearFileVisits({scope});openRecentFiles(app)}return}
  const favRemove=event.target.closest('[data-fav-remove]');
  if(favRemove){await removeFavorite(favRemove.dataset.favRemove,scope);openRecentFiles(app)}
 });
 return card;
}

// =====================================================================
// طابور المراجعة الجماعية
// =====================================================================
export async function openReviewQueue(app,{ids=[]}={}){
 let portfolio;
 try{portfolio=await getPortfolio(app)}catch(error){toast(error?.message||'تعذر تحميل الملفات','error');return}
 const requested=new Set(ids.filter(Boolean));
 const attention=buildAttention(portfolio);
 const candidates=requested.size?portfolio.files.filter(file=>requested.has(file.id)):attention.map(item=>portfolio.fileById.get(item.fileId)).filter(Boolean);
 const queue=[...new Map(candidates.map(file=>[file.id,file])).values()];
 if(!queue.length){toast('لا توجد ملفات في قائمة المراجعة.','info');return}
 let index=0;const reviewed=new Set();
 const card=fsState({title:'مراجعة جماعية للملفات',body:'',wide:true,className:'fs-review'});
 const body=card.querySelector('.fs-sheet-body');
 const draw=()=>{
  const file=queue[index];
  const parties=safeParties(portfolio,file.id),stages=safeStages(portfolio,file.id);
  const completeness=administrativeCompleteness(file,{parties,stages});
  const pending=attention.filter(item=>item.fileId===file.id);
  const admin=portfolio.adminByFile.get(file.id)?.checklist;
  body.innerHTML=`<div class="fs-review-top"><span>الملف ${index+1} من ${queue.length}</span><span>${reviewed.size} تمت مراجعته</span><div class="fs-review-progress" aria-hidden="true"><span style="inline-size:${Math.round((index+1)/queue.length*100)}%"></span></div></div>
   <div class="fs-review-card">
    <div class="fs-review-head"><div><small class="muted">${esc(file.fileType||'ملف')}</small><h3>${esc(fileTitle(file))}</h3></div>${statusLine(file)}</div>
    <div class="fs-stats fs-stats--tight">${fsStat({label:'اكتمال إداري',value:`${completeness.percent}%`,tone:completeness.percent>=80?'ok':'warn'})}${fsStat({label:'أطراف',value:parties.length})}${fsStat({label:'مراحل',value:stages.length})}${fsStat({label:'تنبيهات',value:pending.length,tone:pending.some(item=>item.priority==='high')?'danger':'neutral'})}</div>
    ${pending.length?`<ul class="fs-review-alerts">${pending.map(item=>`<li class="${esc(item.priority)}"><b>${esc(item.reason)}</b>${item.meta?` <small>${esc(item.meta)}</small>`:''}</li>`).join('')}</ul>`:fsNotice('لا توجد تنبيهات إدارية مسجلة لهذا الملف.','ok')}
    ${completeness.missing.length?`<p class="muted small">نواقص إدارية: ${completeness.missing.map(item=>esc(item.label)).join('، ')}</p>`:''}
    ${admin?.items?`<p class="muted small">قائمة التحقق: ${Object.values(admin.items).filter(item=>item?.done).length} منجزة من ${Object.keys(admin.items).length}. <button type="button" class="link" data-review-checklist>فتح القائمة</button></p>`:''}
    <div class="fs-review-actions"><button type="button" class="primary" data-review-open>فتح الملف للمعالجة</button><button type="button" class="ghost" data-review-checklist>قائمة التحقق</button><button type="button" class="ghost" data-review-summary>ملخص قابل للتحقق</button><button type="button" class="ghost" data-review-next>التالي ←</button><button type="button" class="ghost" data-review-done>تمت المراجعة وتخطٍّ</button></div>
   </div>
   <div class="fs-review-foot"><button type="button" class="ghost small" data-review-prev ${index===0?'disabled':''}>→ السابق</button><button type="button" class="ghost small" data-review-skip>تخطي</button><button type="button" class="ghost small" data-review-finish>إنهاء الجلسة</button><span class="muted small">لا يُعدّل هذا الطابور أي بيانات تلقائيًا.</span></div>`;
 };
 body.addEventListener('click',event=>{
  const file=queue[index];
  if(event.target.closest('[data-review-open]')){closeModal();app.go(`file:${file.id}`);return}
  if(event.target.closest('[data-review-checklist]')){openFileChecklist(app,file.id);return}
  if(event.target.closest('[data-review-summary]')){openVerifiableSummary(app,file.id);return}
  if(event.target.closest('[data-review-next]')){index=Math.min(queue.length-1,index+1);draw();return}
  if(event.target.closest('[data-review-prev]')){index=Math.max(0,index-1);draw();return}
  if(event.target.closest('[data-review-skip]')){index=(index+1)%queue.length;draw();return}
  if(event.target.closest('[data-review-done]')){reviewed.add(file.id);index=Math.min(queue.length-1,index+1);draw();return}
  if(event.target.closest('[data-review-finish]')){closeModal();toast(`انتهت جلسة المراجعة: ${reviewed.size} ملفًا تمت مراجعته من ${queue.length}. لم تُعدّل بيانات تلقائيًا.`);return}
 });
 draw();
 return card;
}

// =====================================================================
// مقارنة ملفين
// =====================================================================
export async function openFileComparePicker(app,{a='',b=''}={}){
 let portfolio;
 try{portfolio=await getPortfolio(app)}catch(error){toast(error?.message||'تعذر تحميل الملفات','error');return}
 const files=[...portfolio.files].sort((a,b)=>String(b.lastActivityAt||b.updatedAt||'').localeCompare(String(a.lastActivityAt||a.updatedAt||''))).slice(0,1200);
 const options=files.map(file=>`<option value="${esc(file.id)}">${esc(fileTitle(file))}</option>`).join('');
 const preset=fileId=>files.some(file=>file.id===fileId)?fileId:files[0]?.id||'';
 const card=fsState({title:'مقارنة ملفين',body:`<p class="muted small">تعرض المقارنة القيم المسجلة جنبًا إلى جنب، والأطراف والمراحل الموجودة في أحدهما فقط. لا تدمج ولا تعدّل أي سجل.</p>
  <div class="fs-compare-pick"><label>الملف الأول<input type="search" data-cmp-q1 placeholder="ابحث بالرقم أو العنوان…" aria-label="بحث الملف الأول"><select data-cmp-a size="1" aria-label="الملف الأول" data-preset="${esc(preset(a))}">${options}</select></label>
  <label>الملف الثاني<input type="search" data-cmp-q2 placeholder="ابحث بالرقم أو العنوان…" aria-label="بحث الملف الثاني"><select data-cmp-b size="1" aria-label="الملف الثاني" data-preset="${esc(preset(b&&b!==a?b:files.find(file=>file.id!==preset(a))?.id||b))}">${options}</select></label></div>
  <div class="fs-toolrow"><button type="button" class="primary" data-cmp-run>قارن الملفين</button><span class="muted small">تُقارن أول ${files.length} ملفًا حسب آخر نشاط. يمكن البحث لتضييق الخيارات.</span></div>
  <div data-cmp-result></div>`,wide:true,className:'fs-compare'});
 const body=card.querySelector('.fs-sheet-body');
 body.querySelectorAll('[data-preset]').forEach(select=>{const value=select.dataset.preset;if(value&&[...select.options].some(option=>option.value===value))select.value=value});
 const filter=(input,select)=>{const needle=normalizeArabic(input.value||'');[...select.options].forEach(option=>{option.hidden=Boolean(needle)&&!normalizeArabic(option.textContent).includes(needle)})};
 body.querySelector('[data-cmp-q1]')?.addEventListener('input',e=>filter(e.target,body.querySelector('[data-cmp-a]')));
 body.querySelector('[data-cmp-q2]')?.addEventListener('input',e=>filter(e.target,body.querySelector('[data-cmp-b]')));
 body.querySelector('[data-cmp-a]')?.addEventListener('change',()=>{});
 body.querySelector('[data-cmp-run]')?.addEventListener('click',async()=>{
  const a=body.querySelector('[data-cmp-a]').value,b=body.querySelector('[data-cmp-b]').value;
  if(!a||!b){toast('اختر ملفين للمقارنة.','error');return}
  if(a===b){toast('اختر ملفين مختلفين.','error');return}
  const host=body.querySelector('[data-cmp-result]');host.innerHTML=loadingBody('جارٍ قراءة الملفين…');
  try{
   const [bundleA,bundleB]=await Promise.all([loadFileForCompare(officeOf(app),a),loadFileForCompare(officeOf(app),b)]);
   if(!bundleA||!bundleB)throw new Error('أحد الملفين غير متاح.');
   host.innerHTML=compareHtml(compareFileBundles(bundleA,bundleB),bundleA,bundleB);
   host.querySelectorAll('[data-open-file]').forEach(button=>button.addEventListener('click',()=>{closeModal();app.go(`file:${button.dataset.openFile}`)}));
   host.querySelector('[data-cmp-print]')?.addEventListener('click',()=>printCompare(bundleA,bundleB,compareFileBundles(bundleA,bundleB)));
   host.querySelector('[data-cmp-copy]')?.addEventListener('click',()=>copyCompare(bundleA,bundleB,compareFileBundles(bundleA,bundleB)));
  }catch(error){host.innerHTML=fsNotice(error?.message||'تعذرت المقارنة','error')}
 });
 return card;
}
function compareHtml(result,a,b){
 const diffFields=result.fields.filter(field=>!field.same);
 return `<div class="fs-compare-head"><div><button type="button" class="link" data-open-file="${esc(a.id)}">${esc(fileTitle(a.file))}</button><small>${esc(a.file.fileType||'')} · ${statusLine(a.file)}</small></div><div><button type="button" class="link" data-open-file="${esc(b.id)}">${esc(fileTitle(b.file))}</button><small>${esc(b.file.fileType||'')} · ${statusLine(b.file)}</small></div></div>
 <p class="muted small">${result.differentFields} حقلًا مختلفًا · ${result.sameFields} متطابقًا نصيًا. «غير مسجل» تعني أن القيمة غائبة في السجل، وليست صفرًا ولا نفيًا.</p>
 <div class="fs-toolrow"><button type="button" class="ghost small" data-cmp-print>🖨 طباعة المقارنة</button><button type="button" class="ghost small" data-cmp-copy>📋 نسخ نص المقارنة</button></div>
 <h3>الحقول</h3>
 <table class="fs-table fs-compare-table"><thead><tr><th>الحقل</th><th>${esc(formatFileNumber(a.file.fileNumber)||'الملف أ')}</th><th>${esc(formatFileNumber(b.file.fileNumber)||'الملف ب')}</th><th>الحالة</th></tr></thead><tbody>
 ${result.fields.map(field=>`<tr class="${field.same?'':'is-diff'}"><td>${esc(field.label)}</td><td>${field.a.available?esc(field.a.value):fsMissing()}</td><td>${field.b.available?esc(field.b.value):fsMissing()}</td><td>${field.same?'متطابق':'مختلف'}</td></tr>`).join('')}
 </tbody></table>
 <h3>الأطراف</h3><div class="fs-grid2"><div><h4>${esc(a.file.title||'الملف أ')}</h4>${result.parties.a.length?`<ul>${result.parties.a.map(party=>`<li>${esc(party.name||'بلا اسم')} <small class="muted">${esc(party.role||'')}</small></li>`).join('')}</ul>`:fsEmpty('لا أطراف.')}</div><div><h4>${esc(b.file.title||'الملف ب')}</h4>${result.parties.b.length?`<ul>${result.parties.b.map(party=>`<li>${esc(party.name||'بلا اسم')} <small class="muted">${esc(party.role||'')}</small></li>`).join('')}</ul>`:fsEmpty('لا أطراف.')}</div></div>
 ${result.parties.onlyA.length||result.parties.onlyB.length?`<p class="muted small">أطراف في الأول فقط: ${result.parties.onlyA.map(p=>esc(p.name)).join('، ')||'—'} · في الثاني فقط: ${result.parties.onlyB.map(p=>esc(p.name)).join('، ')||'—'}</p>`:''}
 <h3>المراحل القضائية</h3><div class="fs-grid2"><div>${result.stages.a.length?`<ul>${result.stages.a.map(stage=>`<li>${esc(stage.type||'مرحلة')} ${esc(stage.number||'')}${stage.year?'/'+esc(stage.year):''}</li>`).join('')}</ul>`:fsEmpty('لا مراحل.')}</div><div>${result.stages.b.length?`<ul>${result.stages.b.map(stage=>`<li>${esc(stage.type||'مرحلة')} ${esc(stage.number||'')}${stage.year?'/'+esc(stage.year):''}</li>`).join('')}</ul>`:fsEmpty('لا مراحل.')}</div></div>
 <p class="fs-source">${esc(result.note)}</p>`;
}
async function printCompare(a,b,result){
 fsPrintHtml({title:'مقارنة ملفين',subtitle:`${fileTitle(a.file)} ↔ ${fileTitle(b.file)}`,body:`<table><thead><tr><th>الحقل</th><th>${esc(formatFileNumber(a.file.fileNumber)||'أ')}</th><th>${esc(formatFileNumber(b.file.fileNumber)||'ب')}</th></tr></thead><tbody>${result.fields.map(field=>`<tr><td>${esc(field.label)}</td><td>${field.a.available?esc(field.a.value):'<span class="missing">غير مسجل</span>'}</td><td>${field.b.available?esc(field.b.value):'<span class="missing">غير مسجل</span>'}</td></tr>`).join('')}</tbody></table><h2>الأطراف</h2><p>${esc(result.parties.a.map(p=>p.name).join('، ')||'—')}</p><p>${esc(result.parties.b.map(p=>p.name).join('، ')||'—')}</p><p class="small muted">${esc(result.note)}</p>`});
}
function copyCompare(a,b,result){
 const lines=[`مقارنة: ${fileTitle(a.file)} ↔ ${fileTitle(b.file)}`,''];
 for(const field of result.fields)lines.push(`${field.label}: ${field.a.available?field.a.value:'غير مسجل'} | ${field.b.available?field.b.value:'غير مسجل'}`);
 lines.push('',`الأطراف أ: ${result.parties.a.map(p=>p.name).join('، ')||'—'}`,`الأطراف ب: ${result.parties.b.map(p=>p.name).join('، ')||'—'}`,'',result.note);
 fsCopy(lines.join('\n'),'نُسخت المقارنة');
}

// =====================================================================
// خريطة العلاقات
// =====================================================================
export async function openRelationMap(app,fileId){
 let portfolio;
 try{portfolio=await getPortfolio(app)}catch(error){toast(error?.message||'تعذر تحميل العلاقات','error');return}
 const root=portfolio.fileById.get(fileId)||await officeOf(app).r.files.get(fileId).catch(()=>null);
 if(!root){toast('الملف غير متاح','error');return}
 const seen=new Set([fileId]);
 const nodes=[];
 for(const relation of portfolio.relationsByFile.get(fileId)||[]){
  const otherId=relation.sourceFileId===fileId?relation.targetFileId:relation.sourceFileId;
  const other=portfolio.fileById.get(otherId);
  if(!other||seen.has(otherId))continue;
  seen.add(otherId);
  nodes.push({file:other,relation,label:relation.relationType||'مرتبط بـ',direction:relation.sourceFileId===fileId?'out':'in'});
 }
 for(const stage of safeStages(portfolio,fileId)){
  nodes.push({file:{id:stage.id,fileNumber:stage.caseNumber?`${stage.caseNumber}/${stage.caseYear||''}`:'',title:stage.stageType||'مرحلة قضائية',fileType:'مرحلة'},relation:{relationType:'مرحلة قضائية مسجلة'},label:'مرحلة',direction:'stage',stage});
 }
 const width=760,height=440,cx=width/2,cy=height/2;
 const radius=Math.min(170,60+nodes.length*10);
 const positioned=nodes.slice(0,14).map((node,index)=>{
  const angle=(Math.PI*2*index)/Math.max(1,Math.min(nodes.length,14))-Math.PI/2;
  return {...node,x:cx+Math.cos(angle)*radius*1.5,y:cy+Math.sin(angle)*radius};
 });
 const svg=`<svg viewBox="0 0 ${width} ${height}" class="fs-relmap-svg" role="img" aria-label="خريطة علاقات الملف: ${esc(fileTitle(root))} و${positioned.length} عنصرًا مرتبطًا">
  <defs><marker id="fs-arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L7,3 z" fill="#8a6d1f"/></marker></defs>
  ${positioned.map(node=>`<line x1="${cx}" y1="${cy}" x2="${node.x}" y2="${node.y}" stroke="#b9a77a" stroke-width="1.3" ${node.direction==='out'?'marker-end="url(#fs-arrow)"':''}/>`).join('')}
  <g class="fs-relmap-node is-root"><circle cx="${cx}" cy="${cy}" r="58"/><text x="${cx}" y="${cy-6}" text-anchor="middle">${esc(formatFileNumber(root.fileNumber)||'ملف')}</text><text x="${cx}" y="${cy+14}" text-anchor="middle" class="is-small">${esc(String(root.title||'').slice(0,20))}</text></g>
  ${positioned.map((node,index)=>`<g class="fs-relmap-node ${node.direction==='stage'?'is-stage':''}" data-node="${index}" tabindex="0" role="link" aria-label="${esc(fileTitle(node.file))} — ${esc(node.label)}"><circle cx="${node.x}" cy="${node.y}" r="40"/><text x="${node.x}" y="${node.y-4}" text-anchor="middle">${esc(node.file.fileType||(node.direction==='stage'?'مرحلة':'ملف'))}</text><text x="${node.x}" y="${node.y+13}" text-anchor="middle" class="is-small">${esc(String(node.file.title||'').slice(0,18))}</text></g>`).join('')}
 </svg>`;
 const list=`<ul class="fs-relmap-list">${positioned.map((node,index)=>`<li><button type="button" class="link" data-map-open="${index}">${esc(fileTitle(node.file))}</button> <small>${esc(node.label)}</small> <span class="muted small">${node.direction==='out'?'→ صادر':node.direction==='in'?'← وارد':''}</span></li>`).join('')||'<li class="muted">لا توجد عناصر مرتبطة مسجلة.</li>'}</ul>`;
 const card=fsState({title:`خريطة علاقات الملف ${formatFileNumber(root.fileNumber)||''}`,body:`<div class="fs-relmap">${nodes.length?svg:`<p class="muted">لا توجد علاقات أو مراحل مسجلة لهذا الملف.</p>`}</div>${list}<p class="muted small">الخطوط تمثل علاقات fileRelations أو مرحلة مسجلة في cases. لا تُنشأ علاقات جديدة من الخريطة، والنقر يفتح السجل الأصلي فقط.</p>`,wide:true,className:'fs-relmap-wrap'});
 const host=card.querySelector('.fs-sheet-body');
 const go=index=>{const node=positioned[index];if(!node)return;closeModal();if(node.direction==='stage')app.go(`case:${node.file.id}`);else app.go(`file:${node.file.id}`)};
 host.querySelectorAll('[data-node]').forEach(node=>node.addEventListener('click',()=>go(Number(node.dataset.node))));
 host.querySelectorAll('[data-map-open]').forEach(node=>node.addEventListener('click',()=>go(Number(node.dataset.mapOpen))));
 return card;
}

// =====================================================================
// قوائم التحقق الإدارية
// =====================================================================
const CHECKLIST_GROUP_LABELS={default:'عامة',civil:'مدني / تجاري / عمالي',criminal:'جنائي',family:'أحوال الأسرة',admin:'إداري (مجلس الدولة)'};
function checklistGroupOf(file){const group=fileTypeGroup(file?.fileType);return CHECKLIST_GROUPS[group]?group:'default'}
export async function openFileChecklist(app,fileId){
 const office=officeOf(app);
 const file=await office.r.files.get(fileId).catch(()=>null);
 if(!file){toast('الملف غير متاح','error');return}
 let group=checklistGroupOf(file);
 const card=fsState({title:'قائمة التحقق الإدارية',body:loadingBody(),className:'fs-checklist',actions:'<span class="muted small" data-ck-progress></span>'});
 const body=card.querySelector('.fs-sheet-body');
 const draw=async()=>{
  const [checklist,template]=await Promise.all([getFileChecklist(office,fileId,group),getChecklistTemplate(office,group)]);
  const done=checklist.items.filter(item=>item.done).length;
  body.innerHTML=`<div class="fs-toolrow"><label>المجموعة<select data-ck-group>${Object.keys(CHECKLIST_GROUPS).map(key=>`<option value="${key}" ${key===group?'selected':''}>${esc(CHECKLIST_GROUP_LABELS[key]||key)}</option>`).join('')}</select></label><button type="button" class="ghost small" data-ck-template>⚙ تعديل القالب</button><button type="button" class="ghost small" data-ck-reset>إعادة ضبط حالة الملف</button><span class="muted small">${done}/${checklist.items.length} منجزة</span></div>
   ${fsMeter({value:checklist.items.length?Math.round(done/checklist.items.length*100):0,label:'إنجاز بنود التحقق',caption:'مؤشر إداري فقط؛ إنجاز البنود لا يعني اكتمالًا قانونيًا.'})}
   <ul class="fs-checklist-list">${checklist.items.map(item=>`<li class="${item.done?'is-done':''}"><label class="fs-check"><input type="checkbox" data-ck-item="${esc(item.id)}" ${item.done?'checked':''}><span><b>${esc(item.label)}</b>${item.at?`<small>${esc(formatDateTime(item.at))}${item.by?` — ${esc(item.by)}`:''}</small>`:''}${item.legacy?'<small class="muted">بند قديم أُزيل من القالب — محفوظ ولا يُحذف.</small>':''}</span></label></li>`).join('')}</ul>
   <details class="fs-defs"><summary>القالب المستخدم الآن (${esc(template.group)})</summary><p class="muted small">${template.custom?'قالب مخصص محفوظ في سجلات الإدارة.':'القالب الافتراضي — لم يُعدّل.'}</p><p class="muted small">تعديل القالب لا يحذف حالات البنود القديمة، ولا يغيّر أي بيانات في الملف.</p></details>
   <p class="fs-source">المصدر: settings.fileAdmin.checklist (سجل إداري جديد) + files.fileType لاختيار المجموعة. لا يُعدَّل الملف نفسه.</p>`;
  body.querySelector('[data-ck-group]')?.addEventListener('change',async event=>{group=event.target.value;await draw()});
  body.querySelector('[data-ck-template]')?.addEventListener('click',()=>openChecklistTemplate(app,group,draw));
  body.querySelector('[data-ck-reset]')?.addEventListener('click',async()=>{
   if(!await fsConfirm('إعادة ضبط حالة بنود التحقق لهذا الملف؟ لا تُحذف أي بيانات ملف، ويعود كل بند إلى «غير منجز».',{okText:'إعادة الضبط'}))return;
   await resetFileChecklist(office,fileId);toast('أُعيد ضبط حالة القائمة');await draw();
  });
  body.querySelectorAll('[data-ck-item]').forEach(input=>input.addEventListener('change',async()=>{
   input.disabled=true;
   try{await toggleChecklistItem(office,fileId,input.dataset.ckItem,{done:input.checked,by:''});cacheInvalidated=true;await draw()}
   catch(error){input.checked=!input.checked;toast(error?.message||'تعذر حفظ البند','error');input.disabled=false}
  }));
 };
 try{await draw()}catch(error){body.innerHTML=fsNotice(error?.message||'تعذر تحميل القائمة','error')}
 return card;
}
function openChecklistTemplate(app,group,onDone){
 const office=officeOf(app);
 getChecklistTemplate(office,group).then(template=>{
  const card=stackedModal(`<h2 class="modal-title">قالب التحقق الإداري — ${esc(group)}</h2><p class="muted small">عدّل نص البنود أو أضف/احذف. الحذف من القالب لا يحذف حالات البنود المحفوظة لملف معيّن؛ تُعرض كبنود قديمة محفوظة.</p><div data-tpl-list class="fs-tpl-list">${template.items.map((item,index)=>`<div class="fs-tpl-row" data-id="${esc(item.id)}"><input value="${esc(item.label)}" aria-label="نص البند ${index+1}"><button type="button" class="link danger" data-tpl-del aria-label="حذف البند">✕</button></div>`).join('')}</div>
  <div class="fs-toolrow"><button type="button" class="ghost small" data-tpl-add>+ بند جديد</button><button type="button" class="ghost small" data-tpl-reset>استعادة الافتراضي</button></div>
  <div class="form-actions"><button type="button" class="primary" data-tpl-save>حفظ القالب</button><button type="button" class="ghost" data-close>إلغاء</button></div>`);
  const list=card.querySelector('[data-tpl-list]');
  card.querySelector('[data-tpl-add]').onclick=()=>{const row=document.createElement('div');row.className='fs-tpl-row';row.dataset.id='';row.innerHTML='<input aria-label="نص البند الجديد"><button type="button" class="link danger" data-tpl-del aria-label="حذف">✕</button>';list.append(row);row.querySelector('input').focus()};
  list.addEventListener('click',event=>{if(event.target.closest('[data-tpl-del]'))event.target.closest('.fs-tpl-row').remove()});
  card.querySelector('[data-tpl-reset]').onclick=async()=>{
   // تأكيد مكدَّس: يبقي محرر القالب تحته، ثم يُغلَّق المحرر وحده وتُحدَّث الورقة الأم.
   if(!await fsConfirm('استعادة القالب الافتراضي لهذه المجموعة؟ حالات الملفات المحفوظة لا تُحذف.',{okText:'استعادة'}))return;
   await resetChecklistTemplate(office,group);closeModal();toast('استُعيد القالب الافتراضي');onDone?.();
  };
  card.querySelector('[data-tpl-save]').onclick=async()=>{
   const items=[...list.querySelectorAll('.fs-tpl-row')].map((row,index)=>({id:row.dataset.id||`custom-${index+1}-${Date.now()}`,label:row.querySelector('input').value.trim()})).filter(item=>item.label);
   try{await saveChecklistTemplate(office,group,items);closeModal();toast('حُفظ القالب');onDone?.()}
   catch(error){toast(error?.message||'تعذر حفظ القالب','error')}
  };
 });
}

// =====================================================================
// مراجعة ما قبل الإنهاء / الأرشفة
// =====================================================================
export async function openPreCloseReview(app,fileId,{mode='close',onDone=null}={}){
 const office=officeOf(app);
 try{
  const portfolio=await getPortfolio(app,{force:true});
  const file=portfolio.fileById.get(fileId)||await office.r.files.get(fileId);
  if(!file)throw new Error('الملف غير متاح.');
  if(mode==='archive'&&file.isArchived){toast('الملف مؤرشف بالفعل — لا تغيير مطلوب.','info');return false}
  if(mode==='close'&&isClosedFile(file)){toast('الملف مسجّل كمنتهٍ بالفعل — لا تغيير مطلوب.','info');return false}
  const parties=safeParties(portfolio,fileId),stages=safeStages(portfolio,fileId);
  const completeness=administrativeCompleteness(file,{parties,stages});
  const group=checklistGroupOf(file);
  const checklist=await getFileChecklist(office,fileId,group);
  const pending=checklist.items.filter(item=>!item.done);
  const procedures=[...(portfolio.proceduresByFile.get(fileId)||[])];
  const openProcedures=procedures.filter(item=>['open','pending','مفتوح','قيد الانتظار'].includes(String(item.status||'open')));
  const attention=buildAttention(portfolio).filter(item=>item.fileId===fileId);
  const effects=mode==='archive'
   ?['تسجيل أرشفة الملف مع سبب اختياري.','يبقى الملف وكل سجلاته محفوظًا وقابلًا لإعادة الفتح.']
   :['تسجيل حالة «منتهٍ» للملف مع سبب اختياري.','لا تُحذف أي بيانات، ويمكن إعادة الفتح لاحقًا.'];
  const caveats=[
   'هذه مراجعة إدارية لحالة البيانات المسجلة، وليست تقييمًا قانونيًا أو حكمًا على الملف.',
   'لن يُنفَّذ أي تغيير قبل تأكيدك.',
   'إن كانت هناك سجلات قانونية غير مسجلة، فلن يكتشفها هذا الفحص.'
  ];
  if(openProcedures.length)caveats.push(`يوجد ${openProcedures.length} عمل إداري مفتوح. يمكنك المتابعة أو الإلغاء — لا يُمنع الإنهاء تلقائيًا.`);
  if(pending.length)caveats.push(`يوجد ${pending.length} بند تحقق غير منجز.`);
  const result=await reviewImpact({
   title:mode==='archive'?'مراجعة قبل الأرشفة':'مراجعة قبل تسجيل انتهاء الملف',
   summary:`${fileTitle(file)} — اكتمال البيانات الإدارية ${completeness.percent}%.`,
   scope:[`ملف: ${fileTitle(file)}`,`أطراف مسجلة: ${parties.length}`,`مراحل مسجلة: ${stages.length}`,`أعمال مفتوحة: ${openProcedures.length}`,`بنود تحقق غير منجزة: ${pending.length}`,`تنبيهات إدارية: ${attention.length}`],
   effects,caveats,okText:mode==='archive'?'أرشفة الملف':'تسجيل الانتهاء',danger:mode==='archive',
   reason:{label:'السبب (اختياري — يُحفظ كما كتبته)',placeholder:mode==='archive'?'سبب الأرشفة':'سبب الانتهاء'}
  });
  if(!result?.ok)return false;
  const reason=String(result.value||'').trim();
  if(mode==='archive'){
   const {archiveFile}=await import('../services/legal-files.js');
   await archiveFile(office,fileId,reason);
   toast('تمت أرشفة الملف — يمكن إعادة فتحه');
  }else{
   const {closeFile}=await import('../services/legal-files.js');
   await closeFile(office,fileId,{closeReason:reason});
   toast('سُجّل انتهاء الملف');
  }
  cacheInvalidated=true;
  onDone?.();
  return true;
 }catch(error){toast(error?.message||'تعذر إتمام المراجعة','error');return false}
}

// =====================================================================
// سجل تغيّر الحقول
// =====================================================================
const HISTORY_FIELDS=['fileNumber','title','fileType','mainCategory','subCategory','status','priority','openedAt','responsibleLawyer','coLawyers','staff','nextStep','nextStepDate','closedAt','closeReason','notes'];
function diffFileValues(before={},after={}){
 return HISTORY_FIELDS.filter(key=>String(before?.[key]??'')!==String(after?.[key]??'')).map(key=>({
  field:key,
  label:ENTITIES.files.fields.find(field=>field.k===key)?.l||key,
  before:before?.[key]??'',
  after:after?.[key]??''
 }));
}
export function fileDiffHtml(changes,{title='تغييرات قبل الحفظ'}={}){
 return `<section class="fs-diff"><h3>${esc(title)}</h3><table class="fs-table"><thead><tr><th>الحقل</th><th>قبل</th><th>بعد</th></tr></thead><tbody>${changes.map(change=>`<tr><td>${esc(change.label)}</td><td>${String(change.before??'')?esc(change.before):fsMissing('فارغ/غير مسجل')}</td><td>${String(change.after??'')?esc(change.after):fsMissing('فارغ/غير مسجل')}</td></tr>`).join('')}</tbody></table></section>`;
}
export async function editFileWithReview(app,fileId,{onSaved=null,typeFieldsOnly=false,title=null}={}){
 const office=officeOf(app);
 const before=await office.r.files.get(fileId).catch(()=>null);
 if(!before){toast('الملف غير متاح','error');return}
 let changes=[];
 const {openEntityForm}=await import('../ui/form.js');
 return openEntityForm(app,'files',{id:fileId,typeFieldsOnly,title,
  onBeforeSave:async nextValues=>{
   const target={...before,...nextValues};
   changes=diffFileValues(before,target);
   if(!changes.length)return true;
   const ok=await reviewImpact({
    title:'تأكيد تعديل بيانات الملف',
    summary:`${changes.length} حقلًا سيتغير في ${fileTitle(before)}.`,
    scope:changes.map(change=>`${change.label}: ${String(change.before??'')||'غير مسجل'} → ${String(change.after??'')||'غير مسجل'}`),
    effects:['تحديث بيانات الملف الأصلية مع التحقق من الإصدار.','تسجيل التغيير في سجل النشاط (المسار القائم).','إضافة التغيير إلى «سجل تغيّر الحقول» المحلي عند تفعيله.'],
    caveats:['لا تُحذف أي بيانات.','إلغاء هذه المراجعة يعيدك إلى النموذج دون حفظ.'],
    okText:'حفظ التغييرات'
   });
   return Boolean(ok);
  },
  onSaved:async row=>{
   try{await recordFieldChanges(office,fileId,changes,{source:typeFieldsOnly?'type-fields':'file-form'})}catch(error){console.info('field history skipped',error?.message)}
   cacheInvalidated=true;
   if(onSaved)await onSaved(row);
   else await app.refresh();
  }
 });
}
export async function openFieldHistory(app,fileId){
 const office=officeOf(app);
 try{
  const [journal,file]=await Promise.all([listFieldHistory(office,fileId),office.r.files.get(fileId)]);
  const enabled=fieldHistoryEnabled();
  const body=`<div class="fs-toolrow"><label class="fs-check"><input type="checkbox" data-fh-enabled ${enabled?'checked':''}><span>تسجيل تغيّر الحقول لهذا الجهاز (تفضيل محلي)</span></label><button type="button" class="ghost small" data-fh-clear ${journal.length?'':'disabled'}>مسح السجل</button></div>
   <p class="muted small">السجل يحتوي الحقول التي عدّلتها من نموذج الملف فقط، بحد 40 إدخالًا لكل ملف وقيم مختصرة عند الطول الزائد. لا يحل محل سجل النشاط القانوني، ولا يُنشئ نسخة كاملة من السجل.</p>
   ${journal.length?`<div class="fs-history">${journal.map(entry=>`<article><header><b>${esc(formatDateTime(entry.at))}</b><small>${esc(entry.source==='type-fields'?'بيانات نوع الملف':'نموذج الملف')}${entry.actor?` · ${esc(entry.actor)}`:''}</small></header>${fileDiffHtml(entry.changes||[],{title:'التغييرات'})}</article>`).join('')}</div>`:fsEmpty('لا يوجد تاريخ تغييرات مسجل لهذا الملف.')}
   ${file?`<p class="fs-source">الحالة الحالية للرقم: ${esc(formatFileNumber(file.fileNumber)||'—')} · الحالة: ${esc(label(file.status)||'—')}</p>`:''}`;
  const card=fsState({title:'سجل تغيّر الحقول',body,wide:true,className:'fs-history-wrap'});
  const host=card.querySelector('.fs-sheet-body');
  host.querySelector('[data-fh-enabled]')?.addEventListener('change',async event=>{await setFieldHistoryEnabled(event.target.checked);toast(event.target.checked?'سيُسجَّل تغيّر الحقول':'أُوقف تسجيل تغيّر الحقول')});
  host.querySelector('[data-fh-clear]')?.addEventListener('click',async()=>{
   if(!await fsConfirm('مسح سجل تغيّر الحقول لهذا الملف؟ لا يمس أي بيانات ملف.',{okText:'مسح السجل'}))return;
   await clearFieldHistory(office,fileId);toast('مُسح سجل التغييرات');openFieldHistory(app,fileId);
  });
  return card;
 }catch(error){toast(error?.message||'تعذر تحميل سجل التغييرات','error')}
}

// =====================================================================
// القرارات الإدارية
// =====================================================================
export async function openAdminDecisions(app,fileId){
 const office=officeOf(app);
 let card=null;
 const draw=async()=>{
  const items=await listAdminDecisions(office,fileId);
  card=fsState({title:'القرارات الإدارية للملف',body:`<p class="muted small">قرارات إدارة المكتب (متابعة، تصنيف، تعليمات داخلية) — منفصلة عن الأحكام والوقائع القانونية وسجل النشاط.</p>
   <form data-dec-form class="fs-inline-form"><textarea name="text" rows="3" required maxlength="4000" placeholder="نص القرار الإداري…" aria-label="نص القرار"></textarea><input name="context" maxlength="200" placeholder="السياق (اختياري)" aria-label="السياق"><input name="author" maxlength="120" placeholder="المسؤول (اختياري)" aria-label="المسؤول"><button class="primary small">إضافة قرار</button></form>
   ${items.length?`<div class="fs-decisions">${items.map(item=>`<article><header><b>${esc(formatDateTime(item.at))}</b><small>${esc(item.author||'')}${item.context?` · ${esc(item.context)}`:''}</small></header><p>${esc(item.text)}</p><button type="button" class="link danger small" data-dec-del="${esc(item.id)}">حذف (مع سبب)</button></article>`).join('')}</div>`:fsEmpty('لا قرارات إدارية مسجلة.')}
   <p class="fs-source">المصدر: settings.fileAdmin.decisions — سجل إداري جديد، لا يعدّل الملف.</p>`,className:'fs-decisions-wrap'});
  const host=card.querySelector('.fs-sheet-body');
  host.querySelector('[data-dec-form]')?.addEventListener('submit',async event=>{
   event.preventDefault();const form=event.target;const data=new FormData(form);
   try{
    await addAdminDecision(office,fileId,{text:data.get('text'),context:data.get('context'),author:data.get('author')});
    toast('أُضيف القرار الإداري');cacheInvalidated=true;
    await draw();// الورقة نفسها تبقى مفتوحة — لا closeModal هنا
   }catch(error){toast(error?.message||'تعذر حفظ القرار','error')}
  });
  host.querySelectorAll('[data-dec-del]').forEach(button=>button.addEventListener('click',async()=>{
   const answer=await reviewImpact({
    title:'حذف القرار الإداري من العرض',
    summary:'القرار سجل إداري داخلي، وليس حكمًا ولا واقعة قانونية.',
    effects:['وضع علامة حذف وسبب على القرار وإخفاؤه من القائمة.'],
    caveats:['لا تُحذف بيانات الملف ولا أي سجل قانوني.','النص يبقى محفوظًا في سجل الإدارة.'],
    okText:'حذف القرار',danger:true,
    reason:{label:'سبب الحذف (اختياري)',placeholder:'سبب الحذف'}
   });
   if(!answer?.ok)return;
   try{await deleteAdminDecision(office,fileId,button.dataset.decDel,{reason:answer.value});toast('حُذف القرار من العرض');await draw()}
   catch(error){toast(error?.message||'تعذر الحذف','error')}
  }));
  return card;
 };
 try{return await draw()}catch(error){toast(error?.message||'تعذر تحميل القرارات','error')}
}

// =====================================================================
// الملخص الإداري القابل للتحقق
// =====================================================================
export async function openVerifiableSummary(app,fileId){
 const office=officeOf(app);
 try{
  const portfolio=await getPortfolio(app,{force:true});
  const file=portfolio.fileById.get(fileId)||await office.r.files.get(fileId);
  if(!file){toast('الملف غير متاح','error');return}
  const group=checklistGroupOf(file);
  const checklist=await getFileChecklist(office,fileId,group);
  const admin={checklist:{done:checklist.items.filter(item=>item.done).length,total:checklist.items.length}};
  const summary=buildVerifiableSummary(portfolio,fileId,{admin});
  const snapshots=await listReportSnapshots(office,fileId);
  const rows=summary.lines;
  const body=`<div class="fs-toolrow"><button type="button" class="primary small" data-sum-copy>📋 نسخ الملخص</button><button type="button" class="ghost small" data-sum-print>🖨 طباعة</button><button type="button" class="ghost small" data-sum-snapshot>⤓ حفظ لقطة</button><span class="muted small">${summary.missingCount} حقلًا غير مسجل</span></div>
   <table class="fs-table fs-summary"><thead><tr><th>البند</th><th>القيمة المسجلة</th><th>المصدر</th></tr></thead><tbody>${rows.map(line=>`<tr class="${line.available?'':'is-missing'}"><td>${esc(line.label)}</td><td>${line.available?esc(line.value):fsMissing()}</td><td><code>${esc(line.source)}</code></td></tr>`).join('')}</tbody></table>
   ${fsMeter({value:summary.completeness.percent,label:summary.completeness.label,caption:summary.completeness.disclaimer})}
   <p class="fs-source">${esc(summary.disclaimer)}</p>
   ${snapshots.length?`<section class="fs-card"><h3>لقطات سابقة</h3><ul class="fs-simple-list">${snapshots.map(snapshot=>`<li><button type="button" class="link" data-sum-view="${esc(snapshot.id)}">${esc(formatDateTime(snapshot.at))}</button><small>${esc(snapshot.note||'')}</small><button type="button" class="link danger small" data-sum-del="${esc(snapshot.id)}">حذف</button></li>`).join('')}</ul><p class="muted small">اللقطات تخص تقرير هذا الملف فقط وبحد 5 لقطات، ولا تنسخ قاعدة المكتب.</p></section>`:''}`;
  const card=fsState({title:`ملخص إداري — ${fileTitle(file)}`,body,wide:true,className:'fs-summary-wrap'});
  const host=card.querySelector('.fs-sheet-body');
  const asText=()=>[`ملخص إداري: ${fileTitle(file)}`,'',...rows.map(line=>`${line.label}: ${line.available?line.value:'غير مسجل'} [${line.source}]`),'',summary.disclaimer].join('\n');
  host.querySelector('[data-sum-copy]')?.addEventListener('click',()=>fsCopy(asText(),'نُسخ الملخص الإداري'));
  host.querySelector('[data-sum-print]')?.addEventListener('click',()=>fsPrintHtml({title:'ملخص إداري قابل للتحقق',subtitle:fileTitle(file),body:`<table><thead><tr><th>البند</th><th>القيمة</th><th>المصدر</th></tr></thead><tbody>${rows.map(line=>`<tr><td>${esc(line.label)}</td><td>${line.available?esc(line.value):'<span class="missing">غير مسجل</span>'}</td><td>${esc(line.source)}</td></tr>`).join('')}</tbody></table><p class="small">${esc(summary.disclaimer)}</p>`}));
  host.querySelector('[data-sum-snapshot]')?.addEventListener('click',async()=>{
   const note=await fsConfirm('حفظ لقطة من هذا التقرير للمقارنة لاحقًا؟ اكتب ملاحظة قصيرة (اختياري).',{okText:'حفظ اللقطة',input:true,label:'ملاحظة اللقطة',placeholder:'مثال: قبل تحديث بيانات المرحلة'});
   if(!note?.ok)return;
   try{await saveReportSnapshot(office,fileId,{sections:{file:{id:file.id,fileNumber:file.fileNumber,title:file.title,status:file.status},lines:rows,completeness:summary.completeness}},{note:note.value});toast('حُفظت اللقطة');openVerifiableSummary(app,fileId)}
   catch(error){toast(error?.message||'تعذر حفظ اللقطة','error')}
  });
  host.querySelectorAll('[data-sum-view]').forEach(button=>button.addEventListener('click',async()=>{
   const snapshot=snapshots.find(item=>item.id===button.dataset.sumView);if(!snapshot)return;
   const lines=snapshot.sections?.lines||[];
   fsPrintHtml({title:'لقطة تقرير محفوظة',subtitle:`${fileTitle(file)} — ${formatDateTime(snapshot.at)}${snapshot.note?' — '+snapshot.note:''}`,body:`<table><thead><tr><th>البند</th><th>القيمة وقت اللقطة</th><th>المصدر</th></tr></thead><tbody>${lines.map(line=>`<tr><td>${esc(line.label)}</td><td>${line.available?esc(line.value):'<span class="missing">غير مسجل</span>'}</td><td>${esc(line.source)}</td></tr>`).join('')}</tbody></table><p class="small">هذه لقطة تاريخية؛ القيم الحالية قد تكون تغيّرت.</p>`});
  }));
  host.querySelectorAll('[data-sum-del]').forEach(button=>button.addEventListener('click',async()=>{
   if(!await fsConfirm('حذف لقطة التقرير؟ لا تمس بيانات الملف.',{okText:'حذف اللقطة'}))return;
   await deleteReportSnapshot(office,fileId,button.dataset.sumDel);openVerifiableSummary(app,fileId);
  }));
  return card;
 }catch(error){toast(error?.message||'تعذر إنشاء الملخص','error')}
}
