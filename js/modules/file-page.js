// صفحة الملف القانوني الداخلي (الوحدة الأساسية). الرقم الداخلي مستقل عن أي رقم قضائي، والملف قد لا يحتوي قضية أصلًا.
// التبويبات: ملخص، الأطراف، البيانات القضائية (المراحل/الأرقام)، الجلسات، الإجراءات، الأحكام، الملاحظات، العلاقات،
// بيانات إضافية (حسب النوع)، الأتعاب والمستندات، سجل النشاط.
import {linkedTasksPanelHtml,bindLinkedTasksPanel} from '../ui/work-links.js';
import {esc} from '../ui/dom.js';
import {toast} from '../ui/toast.js';
import {modal,closeModal,confirmBox} from '../ui/modal.js';
import {openEntityForm} from '../ui/form.js';
import {mountGrid} from '../ui/datagrid.js';
import {legalFileColumns} from '../ui/grid-columns.js';
import {createGridRelations} from '../services/grid-relations.js';
import {ENTITIES,FILE_TYPE_GROUPS,fileTypeGroup,label,fmtDate,isClosedFile,displayValue} from '../domain/entities.js';
import {resolveRefs,fileStages,fileChildren,refLabel} from '../services/entity-query.js';
import {fileParties,fileRelations,archiveFile,reopenFile,closeFile,removeParty,moveParty} from '../services/legal-files.js';
import {deleteEntity} from '../services/entity-save.js';
import {kvHtml,bindRefLinks,notFound} from './record-page.js';
import {sectionGrid,openRow,listNavHtml,bindListNav} from './list-page.js';
import {userError} from '../core/errors.js';
import {localDate} from '../core/clock.js';
import {dateSignal,fileSignal} from '../ui/signals.js';
import {card,statusBadge,infoStack,detailsBlock} from '../ui/card.js';
import {bindCards} from '../ui/card.js';
import {isFavorite,toggleFavorite} from '../services/favorites.js';
import {hearingCycle} from '../services/operations.js';
import {taxonomy,saveFileMeta,reclassifyFile,fileAssets,ASSET_KINDS,saveAsset,linkAsset,unlinkAsset,findAssets,assetDetails} from '../services/client-files.js';
import {stagePathHtml,bindStagePath,metaInput,hydrateLookups} from './client-file.js';
import {renderFileServiceTab,bindFileServiceTab} from './service-records.js';
import {enhanceCollapsiblePanels,openCollapseTransient,updateCollapseSummary} from '../ui/collapsible.js';
import {buildFileTimeline} from '../services/timeline.js';
import {timelineHtml,bindTimeline} from './timeline-view.js';
import {fileCockpitHtml,bindCockpit,executionStripHtml,fileNextStep} from '../ui/cockpit.js';
import {executionsForFile,executionContextSummary} from '../services/execution-work.js';
import {trackRecent} from '../services/recents.js';
import {formatFileNumber,fileNumberChip} from '../core/file-number.js';
import {registerPageLayout,resolveSectionOrder,hiddenSectionIds,migrateLegacySectionOrder,openPageCustomizer} from '../ui/page-layout.js';
import {notesForEntity,completeQuickNote,deleteQuickNote} from '../services/quick-notes.js';
import {openQuickNoteCapture,openQuickNoteEditor} from './quick-notes.js';
import {openQuickAdd} from './quick-add.js';
import {readStoredSeen,markHomeSeen,sinceChanges} from '../services/home-visit.js';
import {prefs} from '../core/preferences.js';

// شريط تبويبات واحد مسطّح (Data-First): نظرة عامة ← الجلسات ← الأعمال الإدارية ثم بقية
// الأقسام بترتيب أهمية الاستخدام اليومي. المعرّفات (ids) ثابتة تمامًا كما كانت حتى تبقى
// تفضيلات الترتيب/الإظهار وحالة الطي والكاش صالحة؛ تغيّر الترتيب الافتراضي والتسميات فقط.
const TABS=[['summary','نظرة عامة','◈'],['hearings','الجلسات','◷'],['procedures','الأعمال الإدارية','☷'],['parties','الأطراف','⚖'],['judicial','المراحل والأرقام القضائية','▣'],['judgments','الأحكام','⚖'],['serviceRecords','المحضرين والإعلانات','📬'],['money','الأتعاب والمستندات','＄'],['relations','العلاقات والملفات المرتبطة','↔'],['typeData','بيانات نوع العمل','▧'],['assets','العقارات والمركبات','⌂'],['timeline','الخط الزمني','⏳'],['notes','الملاحظات','▤'],['extra','بيانات إضافية (قديمة)','▤'],['activity','سجل النشاط','≋']];
const TAB_META=new Map(TABS);
// آخر تبويب لكل ملف على حدة (تفضيل إضافي): «نظرة عامة» هو الافتراضي دائمًا عند فتح ملف
// لا تفضيل صالحًا له — لا تفضيل عام مشترك بين كل الملفات يربك المحامي عند فتح ملف جديد.
const LAST_TAB_KEY='ui:file-last-tab';
const LAST_TAB_CAP=40;
function readLastTab(fileId){
 const v=prefs.get(LAST_TAB_KEY,null);
 if(v&&typeof v==='object'&&v.byFile){const t=v.byFile[fileId];return TAB_META.has(t)?t:null}
 return null; // تفضيل قديم بصيغة نصية عامة: يُتجاهل ولا يفرض تبويبًا على ملف آخر
}
function writeLastTab(fileId,tab){
 const v=prefs.get(LAST_TAB_KEY,null);
 const byFile=(v&&typeof v==='object'&&v.byFile)?{...v.byFile}:{};
 byFile[fileId]=tab;
 const keys=Object.keys(byFile);
 for(const k of keys.slice(0,Math.max(0,keys.length-LAST_TAB_CAP)))delete byFile[k];
 prefs.set(LAST_TAB_KEY,{v:1,byFile});
}
/** تبويب مقصود من الرابط نفسه (file:ID?tab=hearings) — حالة تنقل صريحة لها الأولوية. */
function routeTab(app){
 try{const q=new URLSearchParams(String(app?.route||'').split('?')[1]||'');const t=q.get('tab');return TAB_META.has(t)?t:null}catch{return null}
}
const FOCUS_MODE_KEY='ui:focus-mode';
const BASE_KEYS=['fileNumber','title','fileType','mainCategory','subCategory','status','priority','openedAt','responsibleLawyer','coLawyers','staff','nextStep','nextStepDate','closedAt','closeReason','notes','lastActivityAt'];
// تبويبات الملف = أقسام صفحة في النظام المركزي الواحد (SectionLayoutManager):
// نفس التخزين ونفس نافذة «تخصيص الصفحة» لكل الصفحات — لا نظام ترتيب ثانٍ.
// الترتيب القديم في file-tabs:order يُرحَّل مرة واحدة إلى المخزن الموحّد.
registerPageLayout({pageId:'file-details',title:'أقسام الملف القانوني',sections:TABS.map(([id,title,icon])=>({id,title,icon,canHide:id!=='summary'}))});
function orderedFileTabs(){
 migrateLegacySectionOrder('file-details','file-tabs:order');
 const rank=new Map(resolveSectionOrder('file-details').map((k,i)=>[k,i]));
 return [...TABS].sort((a,b)=>(rank.get(a[0])??0)-(rank.get(b[0])??0));
}
// عدد الأطراف المعروضة في رأس الملف قبل الاختصار بزر «عرض كل الأطراف» — الأطراف كلها
// متاحة دائمًا في تبويب الأطراف، والرأس يعرض ما يكفي للهوية دون إطالة غير منضبطة.
const HEAD_PARTIES_MAX=12;
/** ترتيب الأطراف اليدوي المحفوظ (sequence ثم تاريخ الإضافة ثم الاسم) — لا يُختزل ولا يُعاد ترتيبه. */
const sortParties=rows=>[...rows].sort((a,b)=>(Number(a.sequence)||Number.MAX_SAFE_INTEGER)-(Number(b.sequence)||Number.MAX_SAFE_INTEGER)||String(a.createdAt||'').localeCompare(String(b.createdAt||''))||String(a.partyName||a.name||'').localeCompare(String(b.partyName||b.name||''),'ar'));
/** الاسم المعرّف للمرحلة: «دعوى»←«الدعوى»، «استئناف»←«الاستئناف»، والأسماء المركّبة كما هي. */
function stageNoun(t){
 const s=String(t||'').trim();
 if(!s)return '';
 if(s.startsWith('ال'))return s;
 return /^\S+$/.test(s)?'ال'+s:s;
}
/**
 * هوية القضية في رأس الملف — تُبنى من الحقول المسجلة فقط (نوع المرحلة، الرقم، السنة،
 * الموضوع، المحكمة/الجهة، الدائرة، الدرجة). بلا رقم قضائي: نوع الملف ووصفه من البيانات الحالية.
 */
function caseHeadData(f,cur,ftype,cat){
 const typeWord=f.typeSnapshot?.type||ftype?.name||f.fileType||'';
 const kicker=[cat?.name,typeWord].filter(Boolean).join(' · ');
 if(!cur)return {kicker,title:f.title||typeWord||'ملف بدون عنوان',sub:'',court:'',isCase:false};
 const noun=stageNoun(cur.stageType||(cur.numberType?String(cur.numberType).replace(/^رقم\s*/,''):''));
 const num=cur.caseNumber?`رقم ${String(cur.caseNumber).trim()}${cur.caseYear?` لسنة ${String(cur.caseYear).trim()}`:''}`:'';
 const subject=String(cur.subject||'').trim();
 const lead=[noun,num].filter(Boolean).join(' ');
 const title=[lead,subject].filter(Boolean).join(' — ')||f.title||refLabel('cases',cur);
 const court=[cur.courtId,cur.chamber,cur.degree].filter(Boolean).map(String).join(' · ');
 const sub=f.title&&subject&&f.title!==subject?f.title:'';
 return {kicker,title,sub,court,isCase:true};
}

export async function filePage(app,id){
 const f=await app.office.r.files.get(id);
 if(!f||f.isDeleted)return notFound('الملف');
 trackRecent('file:'+id,`${formatFileNumber(f.fileNumber)||'ملف'} — ${f.title||'بدون عنوان'}`.trim(),{icon:'folder',sub:f.title?'':'ملف قانوني',scope:app.ctx?.profile?.id||''});
 // مركز الملف: الجلسات والأعمال تُقرأ مع بيانات الرأس في استعلام واحد متوازٍ (بحدود مضبوطة).
 const [parties,stages,serviceCount,hearingsRes,proceduresRes,executions]=await Promise.all([fileParties(app.office,id),fileStages(app.office,id),app.office.r.serviceRecords.countIndex('fileId_recordState',[id,'active']),fileChildren(app.office,id,'hearings'),fileChildren(app.office,id,'procedures'),executionsForFile(app.office,id).catch(()=>[])]);
 const tax=await taxonomy(app.office);const cat=tax.byId.get(f.categoryId),ftype=tax.byId.get(f.fileTypeId);
 const cfRow=f.clientFileId?await app.office.r.clientFiles.get(f.clientFileId):null;
 app.__file={id,f,parties,stages,tax,serviceCount,executions};
 // التبويب الافتراضي «نظرة عامة» دائمًا، إلا لحالة تنقل مقصودة: رابط صريح (?tab=…) أو
 // آخر تبويب محفوظ لنفس هذا الملف تحديدًا — لا تفضيل عام مشترك يفرض تبويبًا على ملف آخر.
 const explicitTab=routeTab(app);
 const remembered=app.__fileTab&&app.__fileTab.id===id?app.__fileTab.tab:readLastTab(id);
 app.__fileTab=app.__fileTab&&app.__fileTab.id===id?app.__fileTab:{id,tab:explicitTab||(TAB_META.has(remembered)?remembered:'summary')};
 // إذا أخفى المستخدم التبويب النشط من «تخصيص الصفحة»، نعود إلى نظرة عامة (لا بيانات تُفقَد).
 if(hiddenSectionIds('file-details').has(app.__fileTab.tab))app.__fileTab.tab='summary';
 const isClientParty=p=>(p.isClient??p.partyKind==='client');
 const clients=sortParties(parties.filter(isClientParty));
 const opps=sortParties(parties.filter(p=>!isClientParty(p)&&p.partyKind==='opponent'));
 const others=sortParties(parties.filter(p=>!isClientParty(p)&&p.partyKind!=='opponent'));
 // ترتيب العرض اليدوي محفوظ: موكلون ثم خصوم ثم بقية الأطراف، وبترتيب sequence داخل كل مجموعة.
 const headParties=[...clients.map(p=>({p,word:'الموكل',kind:'client'})),...opps.map(p=>({p,word:'الخصم',kind:'opponent'})),...others.map(p=>({p,word:p.roleGroup||'طرف',kind:'other'}))];
 app.__file.headParties=headParties;
 const cur=stages.find(s=>s.id===f.currentStageId)||stages.at(-1);
 const head=caseHeadData(f,cur,ftype,cat);
 const nextStep=fileNextStep({hearings:hearingsRes.rows,procedures:proceduresRes.rows,today:localDate()});
 const gaps=fileGaps(f,parties,stages,tax);
 const focusOn=Boolean(prefs.get(FOCUS_MODE_KEY,false));
 const favOn=isFavorite('file:'+id,app.ctx?.profile?.id||'');
 const tabCount=k=>k==='parties'?parties.length:k==='judicial'?stages.length:k==='serviceRecords'?serviceCount:k==='hearings'?hearingsRes.rows.length:k==='procedures'?proceduresRes.rows.length:0;
 return `${cfRow?`<nav class="crumbs" aria-label="المسار"><button class="link" data-route="client:${esc(cfRow.clientId)}">الموكل</button><span class="sep">‹</span><button class="link" data-route="cfile:${esc(cfRow.clientId)}">الملف الرئيسي ${esc(formatFileNumber(cfRow.clientCode))}</button>${cat?`<span class="sep">‹</span><button class="link" data-route="cfile:${esc(cfRow.clientId)}?cat=${esc(cat.id)}">${esc(cat.icon||'')} ${esc(cat.name)}</button>`:''}${ftype?`<span class="sep">‹</span><span>${esc(ftype.name)}</span>`:''}</nav>`:''}
 <div class="file-sticky-bar" data-file-sticky aria-hidden="true"><span>${fileNumberChip(f)}</span><span class="fsb-title">${esc(head.isCase?head.title:(f.title||'ملف'))}</span><span class="badge ${isClosedFile(f)?'closed':'open'}">${esc(label(f.status||'open'))}</span>${nextStep?`<span class="fsb-next">التالي: ${esc(nextStep.eyebrow)} — ${esc(nextStep.title)}</span>`:''}<span class="fsb-actions"><button type="button" class="primary small" data-file-quick>+ إضافة</button></span></div>
 <header class="record-head file-head file-id" id="file-head" style="--cat:${esc(cat?.color||'var(--primary)')}">
  <div class="fid-top">
   <div class="fid-case">
    ${head.kicker?`<p class="fid-kicker">${esc(head.kicker)}</p>`:''}
    <h2 class="fid-title">${esc(head.title)}</h2>
    ${head.court?`<p class="fid-court">${esc(head.court)}</p>`:''}
    ${head.sub?`<p class="fid-sub">عنوان الملف: ${esc(head.sub)}</p>`:''}
    ${!head.isCase?`<p class="fid-sub">${esc(ftype?.name||f.fileType||'')} — لا توجد أرقام قضائية مسجلة (ملف بلا قضية)</p>`:''}
    <p class="badges fid-badges">${f.needsClassification?'<button class="badge warn" data-reclass title="تم تصنيف الملف تلقائيًا من بيانات قديمة">⚠ راجع التصنيف</button>':''}<span class="badge ${isClosedFile(f)?'closed':'open'}">${esc(label(f.status||'open'))}</span>${f.isArchived?`<span class="badge warn">مؤرشف${f.archivedReason?' — '+esc(f.archivedReason):''}</span>`:''}${f.priority&&f.priority!=='normal'?`<span class="badge warn">${esc(label(f.priority))}</span>`:''}${f.responsibleLawyer?`<span class="badge">المحامي: ${esc(f.responsibleLawyer)}</span>`:''}${gaps.length?`<button class="badge warn" data-collapse-alert data-gaps-jump title="نواقص بيانات فعلية في هذا الملف">⚠ نواقص (${gaps.length})</button>`:''}</p>
   </div>
   <div class="fid-meta">
    <div class="fid-fno"><span class="fid-fno-kind">ملف فرعي:</span> <b dir="ltr">${esc(formatFileNumber(f)||'—')}</b></div>
    <small class="muted fid-fno-note">الرقم الداخلي للمكتب — مستقل عن أرقام القضايا الرسمية</small>
    <div class="head-actions fid-actions">
     <button class="primary" data-file-quick>+ إضافة</button>
     <button class="ghost" data-file-edit>✎ تعديل</button>
     <button class="ghost" data-file-focus aria-pressed="${focusOn}" title="وضع التركيز: إخفاء العناصر الثانوية مع بقاء التنبيهات والإجراءات">${focusOn?'الخروج من التركيز':'تركيز'}</button>
     <div class="ux-menu-wrap"><button type="button" class="ghost icon-only" data-card-menu aria-haspopup="menu" aria-label="إجراءات الملف">⋯</button>
      <div class="ux-menu" role="menu" hidden>
       <button type="button" role="menuitem" class="ux-menu-item" data-file-task>＋ مهمة مرتبطة</button>
       <button type="button" role="menuitem" class="ux-menu-item" data-reclass>تغيير القسم / النوع</button>
       <button type="button" role="menuitem" class="ux-menu-item" data-file-pin aria-pressed="${favOn}">${favOn?'★ إلغاء التثبيت':'☆ تثبيت في الرئيسية'}</button>
       <button type="button" role="menuitem" class="ux-menu-item" data-file-copy>📋 نسخ ملخص الملف</button>
       <button type="button" role="menuitem" class="ux-menu-item" data-file-gaps>⚠ نواقص الملف (${gaps.length})</button>
       ${f.isArchived||isClosedFile(f)?'<button type="button" role="menuitem" class="ux-menu-item" data-file-reopen>إعادة فتح</button>':'<button type="button" role="menuitem" class="ux-menu-item" data-file-close>إنهاء الملف</button><button type="button" role="menuitem" class="ux-menu-item" data-file-archive>أرشفة</button>'}
       <button type="button" role="menuitem" class="ux-menu-item is-danger" data-file-delete>حذف منطقي للملف</button>
      </div></div>
    </div>
   </div>
  </div>
  <div class="fid-parties" role="list" aria-label="أطراف الملف: الموكل والخصم وبقية الأطراف">
   ${headParties.slice(0,HEAD_PARTIES_MAX).map(({p,word,kind},i)=>`<button type="button" role="listitem" class="fid-party fid-party--${kind}" data-party-open="${i}" title="فتح بيانات ${esc(p.partyName||p.name||'طرف')} وإجراءاته"><span class="fid-party-role">${esc(word)}</span><b class="fid-party-name">${esc(p.partyName||p.name||'طرف')}</b>${p.role?`<span class="fid-party-cap">${esc(p.role)}</span>`:''}${p.isActive===false?'<span class="fid-party-cap">غير نشط</span>':''}</button>`).join('')}
   ${headParties.length>HEAD_PARTIES_MAX?`<button type="button" class="fid-party fid-party--more" data-tab-jump="parties">+${headParties.length-HEAD_PARTIES_MAX} — عرض كل الأطراف (${headParties.length})</button>`:''}
   ${headParties.length?'':`<span class="fid-party-empty">لا يوجد أطراف مرتبطون بعد — <button type="button" class="link" data-tab-jump="parties">أضف الأطراف</button></span>`}
  </div>
  <div class="fid-tools">${listNavHtml(app,'files',id)}</div>
 </header>
 ${gaps.length?fileGapsHtml(gaps):''}
 <nav class="file-tabs-bar" aria-label="أقسام الملف">
  <div class="file-subtabs" role="tablist" aria-label="تبويبات الملف">${orderedFileTabs().map(([k,l,icon])=>{const count=tabCount(k);return `<button type="button" role="tab" data-tab="${k}" data-section-id="${k}" aria-controls="file-tab" title="${esc(l)}" aria-label="${esc(l)}${count?` — ${count}`:''}" aria-selected="${app.__fileTab.tab===k}" class="subtab-btn${app.__fileTab.tab===k?' active':''}${count?' has-data':''}"><span class="tab-icon" aria-hidden="true">${icon}</span><span class="tab-label">${esc(l)}</span>${count?` <small>${count}</small>`:''}</button>`}).join('')}</div>
  <div class="ftb-tools">
   <div class="ux-menu-wrap"><button type="button" class="ghost icon-only" data-card-menu aria-haspopup="menu" aria-label="كل الأقسام — قائمة التبويبات" title="كل الأقسام">⋯</button>
    <div class="ux-menu ftb-menu" role="menu" hidden>${orderedFileTabs().map(([k,l,icon])=>`<button type="button" role="menuitem" class="ux-menu-item" data-menu-tab="${k}"><span aria-hidden="true">${icon}</span> ${esc(l)}</button>`).join('')}</div></div>
   <button type="button" class="ghost icon-only" data-order-file-tabs title="ترتيب الأقسام وإظهارها وإعدادات العرض" aria-label="تخصيص الصفحة">⚙</button>
  </div>
 </nav>
 <section class="panel file-tab-shell" data-collapse-id="file-tab-body" data-collapse-key="file-details:tab-body" data-collapse-default="open"><div class="panel-head"><h3 data-tab-shell-title>${esc(TAB_META.get(app.__fileTab.tab)||'المحتوى')}</h3><span class="collapse-summary" data-collapse-summary></span></div>
 <div id="file-tab" role="tabpanel"></div></section>`;
}

// ===== نواقص الملف =====
// معايير بيانات فعلية فقط، مرتبطة بحقول الملف ونوعه/قسمه — لا قواعد قانونية ولا قوائم موحدة:
// كل بند يشير إلى حقل فارغ أو علاقة غير مسجلة، مع مسار واضح لسدّه.
function fileGaps(f,parties,stages,tax){
 const gaps=[];
 if(!String(f.title||'').trim())gaps.push({label:'عنوان الملف غير مسجل',action:'edit',hint:'العنوان يظهر في البحث والقوائم'});
 if(!parties.some(p=>p.clientId||p.partyKind==='client'))gaps.push({label:'لا يوجد موكل مرتبط بهذا الملف',tab:'parties',hint:'أضف الموكل من تبويب الأطراف'});
 if(!f.responsibleLawyer)gaps.push({label:'المحامي المسؤول غير محدد',action:'edit'});
 if(!f.openedAt)gaps.push({label:'تاريخ فتح الملف غير مسجل',action:'edit'});
 if(!f.status)gaps.push({label:'حالة الملف غير محددة',action:'edit'});
 const type=tax?.byId?.get?.(f.fileTypeId);
 if(type?.fields?.length&&!type.fields.some(x=>f['x_'+x.k]!=null&&f['x_'+x.k]!==''))gaps.push({label:`بيانات «${type.name}» الخاصة غير مكتملة`,tab:'typeData',hint:'كل الحقول اختيارية ويمكن إكمالها لاحقًا'});
 if(tax?.stagesOf?.(f.categoryId)?.length&&!stages.some(s=>!s.isDeleted))gaps.push({label:'لا توجد مراحل/أرقام قضائية مسجلة لهذا القسم',tab:'judicial',hint:'بعض الملفات لا تحتاج قضية — أضفها عند الحاجة فقط'});
 return gaps;
}
function fileGapsHtml(gaps){
 return `<section class="panel file-gaps" data-collapse-id="file-gaps" data-collapse-key="file-details:gaps" data-collapse-default="open" data-collapse-summary="${gaps.length} نواقص بيانات"><div class="panel-head"><h3>⚠ نواقص الملف</h3><span class="badge warn" data-collapse-alert>${gaps.length}</span></div><p class="muted small">بيانات غير مسجلة في هذا الملف فقط — لا تُعد أي أثرًا قانونيًا. عالج ما تحتاجه منها.</p>
  ${gaps.map((g,i)=>`<div class="gap-item"><span>${esc(g.label)}${g.hint?` <small class="muted">— ${esc(g.hint)}</small>`:''}</span><button type="button" class="ghost small" data-gap-go="${i}">${g.action==='edit'?'تعديل البيانات':'فتح القسم'}</button></div>`).join('')}</section>`;
}

export async function bindFilePage(app,id){
 const root=document.querySelector('#main-content');const {f}=app.__file;
 if(!app.__fileTabCache||app.__fileTabCache.id!==id)app.__fileTabCache={id,map:new Map()};
 const gaps=fileGaps(f,app.__file.parties,app.__file.stages,app.__file.tax);
 root.querySelector('[data-order-file-tabs]')?.addEventListener('click',()=>openPageCustomizer(app,{pageId:'file-details',root,onChanged:()=>{
  if(hiddenSectionIds('file-details').has(app.__fileTab.tab)){app.__fileTab.tab='summary';syncTabBarDom(app);renderTab(app).catch(e=>app.fail(e))}
 }}));
 root.querySelector('[data-file-edit]').onclick=()=>openEntityForm(app,'files',{id});
 bindCockpit(root,app);
 bindListNav(root,app,'files');
 // الإجراء الأساسي: إضافة سياقية بالسياق المعروف (fileId يمرر تلقائيًا — لا إعادة اختيار ملف).
 root.querySelectorAll('[data-file-quick]').forEach(b=>b.addEventListener('click',()=>openQuickAdd(app)));
 // وضع التركيز: يختصر العناصر الثانوية دون إخفاء التنبيهات أو تعطيل الإجراءات.
 const focusBtn=root.querySelector('[data-file-focus]');
 const applyFocus=on=>{root.classList.toggle('file-focus-mode',on);if(focusBtn){focusBtn.textContent=on?'الخروج من التركيز':'تركيز';focusBtn.setAttribute('aria-pressed',String(on))}};
 applyFocus(Boolean(prefs.get(FOCUS_MODE_KEY,false)));
 focusBtn?.addEventListener('click',async()=>{const on=!root.classList.contains('file-focus-mode');applyFocus(on);await prefs.set(FOCUS_MODE_KEY,on)});
 // نسخ ملخص الملف كنص — من قائمة الإجراءات.
 root.querySelector('[data-file-copy]')?.addEventListener('click',()=>copyFileSummary(app));
 // النواقص: قفزة إلى القسم المستهدف وفتحه مؤقتًا دون تغيير تفضيل الطي المحفوظ.
 const gapsPanel=()=>root.querySelector('.file-gaps');
 const openGaps=()=>{const p=gapsPanel();if(p){openCollapseTransient(p);p.scrollIntoView?.({block:'nearest'})}else toast('لا توجد نواقص مسجلة لهذا الملف 👌')};
 root.querySelector('[data-file-gaps]')?.addEventListener('click',openGaps);
 root.querySelector('[data-gaps-jump]')?.addEventListener('click',openGaps);
 root.querySelectorAll('[data-gap-go]').forEach(b=>b.addEventListener('click',()=>{
  const g=gaps[Number(b.dataset.gapGo)];if(!g)return;
  if(g.action==='edit')return openEntityForm(app,'files',{id});
  if(app.__fileGotoTab)app.__fileGotoTab(g.tab);else{app.__fileTab.tab=g.tab;writeLastTab(id,g.tab);syncTabBarDom(app);renderTab(app).catch(e=>app.fail(e))}
  requestAnimationFrame(()=>openCollapseTransient(document.querySelector('#file-tab')||document.querySelector('.file-tab-shell')));
 }));
 // الشريط المضغوط عند التمرير: هوية الملف وحالته والخطوة التالية فقط.
 const head=root.querySelector('#file-head'),sticky=root.querySelector('[data-file-sticky]');
 if(head&&sticky&&'IntersectionObserver' in window){
  const io=new IntersectionObserver(([e])=>{const on=!e.isIntersecting;sticky.classList.toggle('is-on',on);sticky.setAttribute('aria-hidden',String(!on))},{threshold:0});
  io.observe(head);
  app.__fileStickyObserver=io;
 }
 // بعد «✓ تم» في مركز الملف: تحديث موضعي لقسم «مركز الملف» فقط — بلا إعادة بناء الصفحة.
 app.__refreshAfterAction=async()=>{
  if(!app.route||!app.route.startsWith('file:'))return app.refresh();
  const sec=root.querySelector('.cp-fc');if(!sec)return app.refresh();
  const scrollY=window.scrollY;
  try{
   const [hearingsRes,proceduresRes]=await Promise.all([fileChildren(app.office,id,'hearings'),fileChildren(app.office,id,'procedures')]);
   const cur=app.__file.stages.find(s=>s.id===app.__file.f.currentStageId)||app.__file.stages.at(-1);
   const tpl=document.createElement('template');
   tpl.innerHTML=fileCockpitHtml({hearings:hearingsRes.rows,procedures:proceduresRes.rows,stages:app.__file.stages,parties:app.__file.parties,today:localDate(),currentStage:cur?refLabel('cases',cur):''}).trim();
   sec.replaceWith(tpl.content.firstElementChild);
   bindCockpitOnce(root,app);
   root.querySelectorAll('.cp-fc [data-route]').forEach(b=>b.onclick=()=>app.go(b.dataset.route));
   root.querySelector('[data-cp-task]')?.addEventListener('click',()=>root.querySelector('[data-file-task]')?.click());
   // بيانات القمرة تغيّرت: الكاش المعروض للملخص يُطوى حتى لا تبقى أعداد قديمة.
   app.__fileTabCache?.map?.clear?.();
   window.scrollTo(0,scrollY);
  }catch(err){app.fail(err)}
 };
 root.querySelector('[data-cp-task]')?.addEventListener('click',()=>root.querySelector('[data-file-task]')?.click());
 root.querySelector('[data-file-task]')?.addEventListener('click',async()=>{const {openLinkedTaskForm}=await import('../ui/work-actions.js');openLinkedTaskForm(app,'files',id,{onSaved:async()=>{toast('تمت إضافة المهمة المرتبطة');await reload(app)}})});
 root.querySelector('[data-file-pin]')?.addEventListener('click',async e=>{
  const on=await toggleFavorite({route:'file:'+id,title:`${formatFileNumber(f.fileNumber)||'ملف'} — ${f.title||''}`.trim()},app.ctx?.profile?.id||'');
  e.currentTarget.textContent=on?'★ إلغاء التثبيت':'☆ تثبيت في الرئيسية';
  e.currentTarget.setAttribute('aria-pressed',String(on));
  toast(on?'ثُبّت الملف في الرئيسية':'أُلغي التثبيت');
 });
 // فحص تشغيلي قبل الأرشفة/الإغلاق: أعمال مفتوحة وجلسات قادمة من البيانات المتاحة فقط.
 const openItemsCheck=async()=>{
  const [hearingsRes,proceduresRes]=await Promise.all([fileChildren(app.office,id,'hearings'),fileChildren(app.office,id,'procedures')]);
  const today=localDate();
  const upcoming=(hearingsRes.rows||[]).filter(h=>String(h.hearingDate||'').slice(0,10)>=today&&!h.result).sort((a,b)=>String(a.hearingDate||'').localeCompare(String(b.hearingDate||'')));
  const openProcs=(proceduresRes.rows||[]).filter(p=>!p.status||['open','pending'].includes(p.status));
  const lines=[
   upcoming.length?`جلسات قادمة مسجلة (${upcoming.length}): ${upcoming.slice(0,3).map(h=>fmtDate(h.hearingDate)).join('، ')}${upcoming.length>3?'…':''}`:'',
   openProcs.length?`أعمال إدارية مفتوحة (${openProcs.length}): ${openProcs.slice(0,3).map(p=>esc(p.description||p.type||'عمل')).join('، ')}${openProcs.length>3?'…':''}`:''
  ].filter(Boolean);
  return lines.length?`<br><br><b>قبل المتابعة — ما زال مفتوحًا في هذا الملف:</b><br>${lines.join('<br>')}<br><small class="muted">لن يُحذف أي سجل، ويمكن إعادة فتح الملف لاحقًا.</small>`:'';
 };
 root.querySelector('[data-file-archive]')?.addEventListener('click',async()=>{const extra=await openItemsCheck().catch(()=> '');const r=await confirmBox(`أرشفة الملف؟ يبقى الملف وكل بياناته محفوظة ويمكن إعادة فتحه في أي وقت.${extra}`,{okText:'أرشفة',input:true,placeholder:'سبب الأرشفة (اختياري)'});if(!r.ok)return;try{await archiveFile(app.office,id,r.value);toast('تمت الأرشفة');reload(app)}catch(e){toast(userError(e),'error')}});
 root.querySelector('[data-file-reopen]')?.addEventListener('click',async()=>{const r=await confirmBox('إعادة فتح الملف؟',{okText:'إعادة فتح',input:true,placeholder:'سبب إعادة الفتح (اختياري)'});if(!r.ok)return;try{await reopenFile(app.office,id,r.value);toast('تمت إعادة فتح الملف');reload(app)}catch(e){toast(userError(e),'error')}});
 root.querySelector('[data-file-close]')?.addEventListener('click',async()=>{const extra=await openItemsCheck().catch(()=> '');const r=await confirmBox(`تسجيل انتهاء الملف (حالة إدارية فقط)؟${extra}`,{okText:'إنهاء',input:true,placeholder:'سبب الانتهاء (اختياري)'});if(!r.ok)return;try{await closeFile(app.office,id,{closeReason:r.value});toast('تم تسجيل انتهاء الملف');reload(app)}catch(e){toast(userError(e),'error')}});
 root.querySelector('[data-file-delete]')?.addEventListener('click',async()=>{if(!await confirmBox('حذف منطقي للملف؟ لا يُسمح إذا كان للملف قضايا/مراحل غير محذوفة. البيانات لا تُمحى نهائيًا.',{okText:'حذف منطقي'}))return;try{await deleteEntity(app.office,'files',id);toast('تم الحذف المنطقي');app.go('files')}catch(e){toast(userError(e),'error')}});
 // التبديل بين التبويبات: تحديث موضعي مع كاش للتبويبات المحمّلة — بلا إعادة جلب وبلا فقد
 // بيانات النماذج غير المحفوظة (العقد المُخزّن في الكاش يحتفظ بقيم الحقول كما هي).
 const gotoTab=tab=>{
  if(!TAB_META.has(tab)||tab===app.__fileTab.tab)return;
  app.__fileTab.tab=tab;
  writeLastTab(id,tab);
  syncTabBarDom(app);renderTab(app).catch(e=>app.fail(e));
 };
 app.__fileGotoTab=gotoTab;
 root.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>gotoTab(b.dataset.tab));
 // قائمة «كل الأقسام»: نفس التبويبات في قائمة منسدلة للشاشات الضيقة وللوصول السريع.
 root.querySelectorAll('[data-menu-tab]').forEach(b=>b.onclick=()=>gotoTab(b.dataset.menuTab));
 // قفزات المؤشرات والرأس إلى التبويب المعني (الجلسات/الأعمال/الأطراف…).
 root.querySelectorAll('[data-tab-jump]').forEach(b=>b.onclick=()=>gotoTab(b.dataset.tabJump));
 // أطراف الرأس: نفس نافذة إجراءات الطرف الموجودة (فتح السجل/تعديل/إزالة).
 root.querySelectorAll('[data-party-open]').forEach(b=>b.onclick=()=>{
  const item=app.__file.headParties?.[Number(b.dataset.partyOpen)];
  if(item)partyActions(app,item.p);
 });
 syncTabBarDom(app);
 root.querySelectorAll('[data-reclass]').forEach(b=>b.onclick=()=>reclassDialog(app,f));
 await renderTab(app);
}

// إعادة التحميل بعد حفظ/تعديل/حذف: يُصفَّر كاش التبويبات أولًا حتى يُعاد جلب البيانات
// الحقيقية — بدون ذلك تُستعاد عقد التبويب القديمة من الكاش وتظهر بيانات سابقة للحفظ.
const reload=app=>{if(app.__fileTabCache?.map)app.__fileTabCache.map.clear();return app.refresh()};
const stageOptions=stages=>stages.map(s=>({id:s.id,label:refLabel('cases',s)}));
async function showHearingCycle(app,hearingId){
 if(!hearingId){toast('لا توجد جلسة لعرض دورتها.','error');return}
 try{
  const cycle=await hearingCycle(app.office,hearingId);
  const card=modal(`<h2 class="modal-title">دورة الجلسات</h2><p class="muted small">تسلسل تنظيمي مبني على روابط الجلسات المسجلة، ولا يستنتج إجراءً قانونيًا.</p>${cycle.hasBranches?'<div class="notice">توجد أكثر من جلسة تالية في بعض أجزاء السلسلة؛ عُرضت الفروع كما سُجلت.</div>':''}<ol class="hearing-cycle">${cycle.items.map((h,i)=>`<li style="--depth:${Math.min(6,h.__depth||0)}"><button type="button" data-hearing="${esc(h.id)}"><time>${fmtDate(h.hearingDate)||'بدون تاريخ'}${h.hearingTime?' '+esc(h.hearingTime):''}</time><b>${esc(h.type||'جلسة')}${h.generatedFromAdjournment?' · منشأة من التأجيل':''}</b><small>${esc(h.court||'')}${h.chamber?' · '+esc(h.chamber):''}${h.result?' — '+esc(h.result):h.adjournedTo?' — تأجيل إلى '+fmtDate(h.adjournedTo):''}</small></button>${i<cycle.items.length-1?'<span class="cycle-arrow" aria-hidden="true">↓</span>':''}</li>`).join('')||'<li class="muted">لا توجد جلسات في هذه الدورة.</li>'}</ol>`);
  card.querySelectorAll('[data-hearing]').forEach(b=>b.onclick=()=>{closeModal();app.go('rec:hearings:'+b.dataset.hearing)});
 }catch(err){toast(userError(err),'error')}
}

// ===== المرحلة الحالية والتسلسل القضائي (تبويب نظرة عامة) =====
// يُبنى من السجلات الموجودة فعلًا فقط: مراحل الملف (cases) بترتيبها المحفوظ، وما ارتبط بكل
// مرحلة من جلسات/أحكام/أعمال، والعلاقات المسجلة مع ملفات أخرى. لا تُختلق مراحل ولا تواريخ.
const STAGE_LC_LABEL={planned:'مخططة',active:'جارية',done:'منتهية',skipped:'متخطاة'};
function stageChildList(rows,render,moreWord){
 if(!rows.length)return '<span class="muted small">لا شيء مسجل</span>';
 return `<ul class="fss-rows">${rows.slice(0,4).map(render).join('')}${rows.length>4?`<li class="muted small">+${rows.length-4} ${moreWord} — في تبويبها</li>`:''}</ul>`;
}
async function stageSequenceHtml(app,{id,f,stages,cur,hearings,procedures,judgments,relRows}){
 const currentId=f.currentStageId||cur?.id||'';
 const hBy=new Map(),jBy=new Map(),pBy=new Map();
 const push=(m,k,r)=>{if(!k)return;const a=m.get(k)||[];a.push(r);m.set(k,a)};
 hearings.forEach(h=>push(hBy,h.caseId,h));
 judgments.forEach(j=>push(jBy,j.caseId,j));
 procedures.forEach(p=>push(pBy,p.caseId,p));
 const stageRow=(s,i)=>{
  const lc=s.lifecycle||(s.id===currentId?'active':'done');
  const isCurrent=s.id===currentId;
  const hs=(hBy.get(s.id)||[]).slice().sort((a,b)=>String(a.hearingDate||'').localeCompare(String(b.hearingDate||'')));
  const js=(jBy.get(s.id)||[]).slice().sort((a,b)=>String(b.judgmentDate||'').localeCompare(String(a.judgmentDate||'')));
  const ps=(pBy.get(s.id)||[]).slice().sort((a,b)=>String(b.actionDate||b.internalDueDate||b.createdAt||'').localeCompare(String(a.actionDate||a.internalDueDate||a.createdAt||'')));
  const kv=[['الرقم والسنة',s.caseNumber?`${s.caseNumber}${s.caseYear?' / '+s.caseYear:''}`:''],['المحكمة / الجهة',s.courtId],['الدائرة',s.chamber],['درجة التقاضي',s.degree],['تاريخ القيد',s.filingDate?fmtDate(s.filingDate):''],['حالة المرحلة',s.status?label(s.status):''],['نتيجة المرحلة',s.outcome],['صفة الموكل',s.clientCapacity],['صفة الخصم',s.opponentCapacity],['الموضوع',s.subject],['الطلبات',s.requests],['ملاحظات',s.notes]].filter(([,v])=>v!=null&&String(v).trim()!=='');
  return `<li class="fss-stage${isCurrent?' is-current':''} fss-lc-${esc(lc)}">
   <div class="fss-stage-top"><span class="fss-idx" aria-hidden="true">${i+1}</span><b class="fss-stage-name">${esc(s.stageType||s.numberType||'مرحلة')}</b><span class="badge">${esc(STAGE_LC_LABEL[lc]||lc)}</span>${isCurrent?'<span class="badge open">المرحلة الحالية</span>':''}</div>
   ${kv.length?`<dl class="kv fss-kv">${kv.map(([k,v])=>`<div class="kv-item${k==='الموضوع'||k==='الطلبات'||k==='ملاحظات'?' wide':''}"><dt>${esc(k)}</dt><dd>${esc(String(v))}</dd></div>`).join('')}</dl>`:'<p class="muted small">لم تُسجل تفاصيل هذه المرحلة بعد — <button type="button" class="link" data-open-case="'+esc(s.id)+'">أكمل بياناتها</button>.</p>'}
   <div class="fss-children">
    <div class="fss-child"><span class="fss-child-k">الجلسات (${hs.length})</span>${stageChildList(hs,h=>`<li><button type="button" class="link" data-open="hearings:${esc(h.id)}">${fmtDate(h.hearingDate)||'بدون تاريخ'}${h.hearingTime?' '+esc(String(h.hearingTime).slice(0,5)):''}</button><small>${esc(h.type||'')}${h.result?' — '+esc(h.result):h.adjournedTo?' — تأجيل إلى '+fmtDate(h.adjournedTo):''}</small></li>`,'جلسات أخرى')}</div>
    <div class="fss-child"><span class="fss-child-k">الأحكام (${js.length})</span>${stageChildList(js,j=>`<li><button type="button" class="link" data-open="judgments:${esc(j.id)}">${fmtDate(j.judgmentDate)||'بدون تاريخ'}</button><small>${esc(j.judgmentType||'')}${j.operativeSummary?' — '+esc(j.operativeSummary):''}</small></li>`,'أحكام أخرى')}</div>
    <div class="fss-child"><span class="fss-child-k">الأعمال (${ps.length})</span>${stageChildList(ps,p=>`<li><button type="button" class="link" data-open="procedures:${esc(p.id)}">${esc(p.type||p.description||'عمل إداري')}</button><small>${esc(label(p.status||''))}${p.result?' — '+esc(p.result):''}</small></li>`,'أعمال أخرى')}</div>
   </div>
   <div class="fss-actions"><button type="button" class="ghost small" data-open-case="${esc(s.id)}">فتح بيانات المرحلة</button></div>
  </li>`;
 };
 let related='';
 if(relRows&&relRows.length){
  const relations=createGridRelations(app.office,'fileRelations');
  const rows=relRows.map(r=>({...r,dirLabel:r.direction==='out'?'هذا الملف ←':'← من ملف آخر'}));
  await relations.hydrate(rows);
  related=`<div class="fss-related"><h4 class="fp-kv-h">ملفات مرتبطة بعلاقات مسجلة (${rows.length})</h4><ul class="fss-rel-list">${rows.map(r=>`<li><button type="button" class="link" data-open-file="${esc(r.otherFileId)}">${esc(r.otherLabel||'ملف مرتبط')}</button><span class="muted small">${esc(r.dirLabel||'')} · ${esc(r.relationType||'علاقة')}</span></li>`).join('')}</ul><p class="muted small">الإدارة الكاملة للعلاقات في تبويب «العلاقات والملفات المرتبطة».</p></div>`;
 }
 return `<section class="panel fp-data fp-stage-seq" data-collapse-id="file-stage-seq" data-collapse-key="file-details:stage-seq" data-collapse-default="open">
  <div class="panel-head"><h3>المرحلة والتسلسل القضائي</h3><span class="collapse-summary" data-collapse-summary>${stages.length?`${stages.length} ${stages.length===1?'مرحلة':'مراحل'}${cur?' · الحالية: '+esc(cur.stageType||cur.numberType||''):' '}`:'بلا مراحل مسجلة'}</span></div>
  ${cur?`<div class="fss-current"><span class="fss-current-k">المرحلة الحالية</span><b class="fss-current-v">${esc(refLabel('cases',cur))}</b>${[cur.courtId,cur.chamber,cur.degree].filter(Boolean).map(x=>`<span class="fss-current-meta">${esc(String(x))}</span>`).join('')}</div>`:'<p class="muted fp-kv-note">لا توجد أرقام قضائية مسجلة لهذا الملف (ملف بلا قضية) — يُضاف الرقم/المرحلة من تبويب «المراحل والأرقام القضائية» أو من شريط إدارة المراحل أدناه عند الحاجة.</p>'}
  ${stages.length?`<ol class="fss-chain">${stages.map(stageRow).join('')}</ol>`:''}
  ${stagePathHtml(stages,currentId,id)}
  ${related}
 </section>`;
}
function partyGroupsHtml(parties){
 const groups=new Map();
 for(const p of parties){const name=String(p.roleGroup||p.role||'أطراف أخرى');if(!groups.has(name))groups.set(name,[]);groups.get(name).push(p)}
 const ordered=[...groups.entries()].sort((a,b)=>a[0].localeCompare(b[0],'ar'));
 return ordered.map(([group,rows])=>{
  rows.sort((a,b)=>(Number(a.sequence)||Number.MAX_SAFE_INTEGER)-(Number(b.sequence)||Number.MAX_SAFE_INTEGER)||String(a.createdAt||'').localeCompare(String(b.createdAt||''))||String(a.name||'').localeCompare(String(b.name||''),'ar'));
  return `<details class="party-group" open><summary><span>${esc(group)}</span><span class="count">${rows.length}</span></summary><ol class="party-list">${rows.map((p,i)=>`<li class="party-item${p.isActive===false?' is-inactive':''}" data-party="${esc(p.id||'')}"><span class="party-sequence">${i+1}</span><div class="party-main"><b>${esc(p.partyName||p.name||'طرف')}</b><div class="party-badges"><span class="badge type">${esc(p.role||'طرف')}</span>${(p.isClient??p.partyKind==='client')?'<span class="badge open">موكل المكتب</span>':''}${p.isPrimary?'<span class="badge">طرف أساسي</span>':''}${p.isActive===false?'<span class="badge warn">غير نشط</span>':''}</div>${p.notes?`<small>${esc(p.notes)}</small>`:''}</div><div class="party-actions"><button type="button" class="link" data-party-move="-1" data-id="${esc(p.id||'')}" ${!p.id||i===0?'disabled':''} aria-label="تقديم الطرف">▲</button><button type="button" class="link" data-party-move="1" data-id="${esc(p.id||'')}" ${!p.id||i===rows.length-1?'disabled':''} aria-label="تأخير الطرف">▼</button><button type="button" class="ghost small" data-party-edit="${esc(p.id||'')}" data-client="${esc(p.clientId||'')}" data-kind="${esc(p.partyKind||'other')}" data-name="${esc(p.partyName||p.name||'')}" data-role="${esc(p.role||'')}" data-group="${esc(p.roleGroup||group)}" data-sequence="${Number(p.sequence)||i+1}">تعديل</button><button type="button" class="link danger" data-party-remove="${esc(p.id||'')}" ${p.id?'':'disabled'}>إزالة</button></div></li>`).join('')}</ol></details>`;
 }).join('')||'<div class="empty"><h3>لا توجد أطراف مسجلة لهذا الملف.</h3><p>أضف موكلًا مسجلًا أو طرفًا خارجيًا، ثم حدّد صفته ومجموعة عرضه.</p></div>';
}

/** مزامنة شريط التبويبات مع التبويب النشط (بدون إعادة رسم المحتوى) + إبقاء النشط مرئيًا. */
function syncTabBarDom(app){
 const root=document.querySelector('#main-content');if(!root)return;
 const row=root.querySelector('.file-subtabs');
 root.querySelectorAll('.file-subtabs [data-tab]').forEach(x=>{
  const on=x.dataset.tab===app.__fileTab.tab;
  x.classList.toggle('active',on);x.setAttribute('aria-selected',String(on));
  if(on&&row&&x.scrollIntoView)x.scrollIntoView({block:'nearest',inline:'nearest'});
 });
}
/** رأس لوحة المحتوى + الملخص الحي في الحالة المطوية — مرتبط بالتبويب النشط. */
function updateTabShell(app){
 const shell=document.querySelector('.file-tab-shell');
 if(!shell)return;
 const meta=TAB_META.get(app.__fileTab.tab)||'';
 const title=shell.querySelector('[data-tab-shell-title]');
 if(title)title.textContent=meta;
 updateCollapseSummary(shell,meta);
}
/** ربط قمرة الملف مرة واحدة لكل عقدة — يمنع تكرار مستمعي «✓ تم» عند استعادة الكاش. */
function bindCockpitOnce(root,app){
 const sec=root?.querySelector?.('.cp-fc');
 if(!sec||sec.dataset.cockpitBound)return;
 sec.dataset.cockpitBound='1';
 bindCockpit(root,app);
}
async function renderTab(app){
 const el=document.querySelector('#file-tab');
 if(!el)return;
 const tab=app.__fileTab.tab;
 const cache=app.__fileTabCache&&app.__fileTabCache.id===app.__file.id?app.__fileTabCache:(app.__fileTabCache={id:app.__file.id,map:new Map()});
 // التحميل الكسول الحقيقي: كل تبويب يُركّب عند أول فتح فقط، ثم يُستعاد من الذاكرة
 // (بنفس عناصره ومستمعيه وقيم نماذجه غير المحفوظة) عند العودة إليه — بلا استعلام IndexedDB.
 if(cache.map.has(tab)){
  el.replaceChildren(...cache.map.get(tab));
  updateTabShell(app);
  bindCards(el);
  if(tab==='summary'){bindStagePath(app,app.__file.f,app.__file.stages);bindCockpitOnce(el,app)}
  return;
 }
 await renderTabContent(app);
 if(tab==='summary'&&el){
  const html=await linkedTasksPanelHtml(app.office,{fileId:app.__file.id},{title:'مهام الملف',collapseId:'file-work',centerRoute:`actionCenter?fileId=${encodeURIComponent(app.__file.id)}`});
  el.insertAdjacentHTML('beforeend',html);
  bindLinkedTasksPanel(app,el,{relatedType:'files',relatedId:app.__file.id});
 }
 const main=document.querySelector('#main-content');
 enhanceCollapsiblePanels(main,`file:${app.__file.id}:${tab}`);
 bindCards(el);
 if(tab==='summary'){bindStagePath(app,app.__file.f,app.__file.stages);bindCockpitOnce(el,app)}
 updateTabShell(app);
 cache.map.set(tab,[...el.childNodes]);
}
async function renderTabContent(app){
 const el=document.querySelector('#file-tab');const {id,f,parties,stages}=app.__file;const tab=app.__fileTab.tab;const office=app.office;
 el.innerHTML='<div class="skel-page" role="status" aria-label="جارٍ التحميل"><div class="skel skel-row"><div class="skel-card skel"></div><div class="skel-card skel"></div><div class="skel-card skel"></div><div class="skel-card skel"></div></div><div class="skel skel-block"></div></div>';
 const needStage=what=>`<div class="notice">لإضافة ${what} يجب أولًا إضافة رقم قضائي / مرحلة في تبويب «البيانات القضائية». الملف نفسه لا يحتاج قضية.</div>`;
 if(tab==='summary'){
  // «نظرة عامة» — مركز المعلومات القانونية: البيانات أولًا ثم الملخص العملي.
  const today=localDate();
  const [hearingResult,procedures,judgmentsRes,relRows]=await Promise.all([
   fileChildren(office,id,'hearings'),
   office.r.procedures.byIndex('fileId',id,2000),
   fileChildren(office,id,'judgments').catch(()=>({rows:[]})),
   fileRelations(office,id).catch(()=>[])
  ]);
  const hearings=hearingResult.rows;
  const upcomingAll=hearings.filter(h=>h.hearingDate>=today).sort((a,b)=>String(a.hearingDate||'').localeCompare(String(b.hearingDate||''))||String(a.hearingTime||'').localeCompare(String(b.hearingTime||'')));
  const upcoming=upcomingAll.slice(0,2);
  const last=hearings.filter(h=>h.hearingDate<today).sort((a,b)=>String(b.hearingDate||'').localeCompare(String(a.hearingDate||'')))[0];
  const openProc=procedures.filter(p=>!p.status||['open','pending'].includes(p.status));
  const openUnfinished=openProc.filter(p=>String(p.internalDueDate||'').slice(0,10)<today||!p.result);
  const refs=new Map();
  const cur=stages.find(s=>s.id===f.currentStageId)||stages.at(-1);
  const nextH=upcomingAll[0];
  const sig=nextH?dateSignal(nextH.hearingDate):null;
  const fsig=fileSignal(f);
  const clientParty=parties.find(p=>p.clientId);
  const lastActivity=f.lastActivityAt?fmtDate(String(f.lastActivityAt).slice(0,10)):'';
  // (3) البيانات العامة والتفاصيل القانونية — شريط قابل للطي مفتوح افتراضيًا
  const tax=app.__file.tax;const ftype=tax.byId.get(f.fileTypeId);
  const typeFields=(ftype?.fields||[]).filter(x=>f['x_'+x.k]!=null&&String(f['x_'+x.k]).trim()!=='');
  const caseFields=cur?ENTITIES.cases.fields.filter(x=>x.k!=='fileId'):[];
  const dataPanel=`<section class="panel fp-data fp-case-data" data-collapse-id="file-case-data" data-collapse-key="file-details:case-data" data-collapse-default="open">
   <div class="panel-head"><h3>بيانات الدعوى والملف</h3><span class="collapse-summary" data-collapse-summary></span>
    <div class="sec-actions"><button type="button" class="ghost small" data-file-edit2>✎ تعديل بيانات الملف</button>${cur?`<button type="button" class="ghost small" data-case-edit="${esc(cur.id)}">✎ تعديل بيانات المرحلة</button>`:''}<button type="button" class="ghost small" data-reclass>تغيير القسم / النوع</button></div></div>
   <div class="fp-kv">
    <h4 class="fp-kv-h">بيانات الملف</h4>
    ${kvHtml(ENTITIES.files.fields,f,refs)}
    ${f.archivedAt?`<p class="muted small">أُرشف في ${fmtDate(f.archivedAt)}${f.archivedReason?' — السبب: '+esc(f.archivedReason):''}</p>`:''}
    ${f.reopenedAt?`<p class="muted small">أُعيد فتحه في ${fmtDate(f.reopenedAt)}${f.reopenReason?' — '+esc(f.reopenReason):''}</p>`:''}
    ${cur?`<h4 class="fp-kv-h">بيانات المرحلة الحالية — ${esc(refLabel('cases',cur))}</h4>${kvHtml(caseFields,cur,new Map())}`:'<p class="muted fp-kv-note">لا توجد مرحلة أو رقم قضائي مسجل لهذا الملف؛ تُضاف من تبويب «المراحل والأرقام القضائية» عند الحاجة فقط.</p>'}
    ${typeFields.length?`<h4 class="fp-kv-h">بيانات ${esc(ftype.name)}</h4><dl class="kv">${typeFields.map(x=>`<div class="kv-item${x.t==='textarea'?' wide':''}"><dt>${esc(x.l)}</dt><dd>${esc(String(f['x_'+x.k]))}</dd></div>`).join('')}</dl>`:''}
   </div></section>`;
  // (4) المرحلة الحالية والتسلسل القضائي — شريط مستقل قابل للطي
  const stagePanel=await stageSequenceHtml(app,{id,f,stages,cur,hearings,procedures,judgments:judgmentsRes.rows,relRows});
  // (5) الملخص العملي: مؤشرات محسوبة من البيانات المسجلة فقط، وكل مؤشر يفتح تبويبه
  const metrics=[
   nextH?{k:'أقرب جلسة قادمة',v:`${fmtDate(nextH.hearingDate)}${nextH.hearingTime?' · '+String(nextH.hearingTime).slice(0,5):''}`,sub:sig?.text||'',tab:'hearings',tone:sig?.tone||''}:{k:'أقرب جلسة قادمة',v:'لا توجد جلسة قادمة',tab:hearings.length?'hearings':''},
   {k:'الجلسات المرتبطة',v:`${hearings.length}${hearingResult.more?'+':''}`,tab:hearings.length?'hearings':''},
   {k:'أعمال إدارية مفتوحة',v:String(openProc.length),tab:openProc.length?'procedures':''},
   {k:'متابعات غير مكتملة',v:String(openUnfinished.length),sub:openUnfinished.length?'مفتوحة أو بانتظار موعد':'',tab:openUnfinished.length?'procedures':'',tone:openUnfinished.length?'warn':''},
   {k:'آخر نشاط مسجل',v:lastActivity||'—',tab:'activity'}
  ];
  const metricsHtml=`<div class="fp-metrics" role="list" aria-label="ملخص عملي للملف">${metrics.map(m=>m.tab
   ?`<button type="button" role="listitem" class="fp-metric${m.tone?' is-'+esc(m.tone):''}" data-tab-jump="${esc(m.tab)}" title="فتح تبويب ${esc(TAB_META.get(m.tab)||'')}"><span class="fp-metric-k">${esc(m.k)}</span><b class="fp-metric-v">${esc(m.v)}</b>${m.sub?`<small>${esc(m.sub)}</small>`:''}</button>`
   :`<span role="listitem" class="fp-metric is-static"><span class="fp-metric-k">${esc(m.k)}</span><b class="fp-metric-v">${esc(m.v)}</b>${m.sub?`<small>${esc(m.sub)}</small>`:''}</span>`).join('')}</div>`;
  el.innerHTML=`${dataPanel}${stagePanel}
   <section class="panel fp-data fp-practical" data-collapse-id="file-practical" data-collapse-key="file-details:practical" data-collapse-default="open"><div class="panel-head"><h3>ملخص عملي للملف</h3><span class="collapse-summary" data-collapse-summary></span></div>
   ${metricsHtml}
   ${fileCockpitHtml({hearings,procedures,stages,parties,today,currentStage:cur?refLabel('cases',cur):''})}
   ${clientParty?.clientId?`<p class="fp-client-line muted small">الموكل المسجل: <button type="button" class="link" data-route="client:${esc(clientParty.clientId)}">${esc(clientParty.name||clientParty.partyName||'')}</button>${clientParty.role?` — ${esc(clientParty.role)}`:''}</p>`:''}
   ${hearingResult.more?'<div class="notice" role="status">تعرض هذه الصفحة حتى 5,000 جلسة مرتبطة بالملف. قد توجد سجلات إضافية؛ لم تُحذف أو تُغيّر أي بيانات.</div>':''}
   <div class="grid2 file-hearing-cards"><section class="panel" data-collapse-summary="${upcoming.length?`القادمة ${fmtDate(upcoming[0].hearingDate)}`:'لا قادمة'}"><div class="panel-head"><h3>الجلسات القادمة</h3><span class="badge">${upcoming.length} / 2</span></div>${upcoming.map((h,i)=>{const hs=dateSignal(h.hearingDate);return `<button class="hearing-preview" data-open="hearings:${esc(h.id)}"><span class="hearing-order">${i+1}</span><span><b>${fmtDate(h.hearingDate)}</b> ${esc(h.hearingTime||'')}${hs?` <span class="ux-badge ux-badge--${hs.tone}">${hs.text==='اليوم'?'جلسة اليوم':hs.text==='غدًا'?'جلسة غدًا':'جلسة '+esc(hs.text)}</span>`:''}<small>${esc(h.court||'')}${h.chamber?' · '+esc(h.chamber):''}${h.reason?' — '+esc(h.reason):''}</small></span><span aria-hidden="true">↗</span></button>`}).join('')||'<p class="muted empty-inline">لا توجد جلسات قادمة مسجلة.</p>'}</section>
   <section class="panel"><div class="panel-head"><h3>الجلسة السابقة</h3></div>${last?`<button class="hearing-preview" data-open="hearings:${esc(last.id)}"><span class="hearing-order">‹</span><span><b>${fmtDate(last.hearingDate)}</b><small>${esc(last.result||'لم يُسجل القرار')}${last.adjournedTo?' — التأجيل إلى '+fmtDate(last.adjournedTo):''}</small></span><span aria-hidden="true">↗</span></button>`:'<p class="muted empty-inline">لا توجد جلسات سابقة مسجلة.</p>'}<button class="ghost small" data-show-hearing-cycle>عرض دورة الجلسات</button></section></div>
   ${executionStripHtml({summary:executionContextSummary(app.__file.executions||[]),scope:'file',route:`executionCenter?fileId=${encodeURIComponent(id)}`})}
   </section>`;
  el.querySelector('[data-file-edit2]').onclick=()=>openEntityForm(app,'files',{id});
  el.querySelector('[data-case-edit]')?.addEventListener('click',e=>openEntityForm(app,'cases',{id:e.currentTarget.dataset.caseEdit}));
  el.querySelectorAll('[data-reclass]').forEach(b=>b.onclick=()=>reclassDialog(app,f));
  el.querySelectorAll('[data-tab-jump]').forEach(b=>b.onclick=()=>{
   const t=b.dataset.tabJump;
   app.__fileTab.tab=t;writeLastTab(id,t);syncTabBarDom(app);renderTab(app).catch(e=>app.fail(e));
  });
  el.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>app.go('rec:'+b.dataset.open));
  el.querySelectorAll('[data-open-case]').forEach(b=>b.onclick=()=>app.go('case:'+b.dataset.openCase));
  el.querySelectorAll('[data-open-file]').forEach(b=>b.onclick=()=>app.go('file:'+b.dataset.openFile));
  el.querySelector('[data-show-hearing-cycle]')?.addEventListener('click',()=>showHearingCycle(app,upcomingAll[0]?.id||last?.id||''));
  el.querySelectorAll('.cp-fc [data-route]').forEach(b=>b.onclick=()=>app.go(b.dataset.route));
  el.querySelector('[data-cp-task]')?.addEventListener('click',()=>document.querySelector('#main-content [data-file-task]')?.click());
  return;
 }
 if(tab==='timeline'){
  try{
   const t=await buildFileTimeline(office,id);
   el.innerHTML=`<section class="panel tl-panel"><div class="panel-head"><h3>الخط الزمني الموحد للملف</h3><span class="muted small">كل ما جرى في هذا الملف: جلسات، أحكام، أعمال، مواعيد، اتصالات، ملاحظات، مستندات، أتعاب — بتسلسل واحد.</span></div>${timelineHtml(t)}</section>`;
   bindTimeline(el,{onOpen:r=>app.go(r.startsWith('rec:')?r:'rec:'+r)});
  }catch(err){el.innerHTML=`<div class="error-box" role="alert"><h2>تعذر بناء الخط الزمني</h2><p>${esc(userError(err))}</p></div>`}
  return;
 }
 if(tab==='parties'){
  const active=parties.filter(p=>p.isActive!==false).length;
  el.innerHTML=`<div class="party-toolbar"><div><h3>الأطراف <span class="count">${parties.length}</span></h3><p class="muted small">الأطراف مجمّعة حسب الصفة/المجموعة. رتّبها بأزرار التحريك؛ الموكل المسجل يبقى مرتبطًا بسجله دون نسخ بياناته.</p></div><button class="primary" data-add-party>+ إضافة طرف</button></div><div class="party-summary"><span>الإجمالي: <b>${parties.length}</b></span><span>نشط: <b>${active}</b></span><span>موكل المكتب: <b>${parties.filter(p=>p.isClient??p.partyKind==='client').length}</b></span></div><div class="party-groups">${partyGroupsHtml(parties)}</div>`;
  el.querySelector('[data-add-party]').onclick=()=>openEntityForm(app,'fileParties',{preset:{fileId:id},onSaved:()=>reload(app)});
  el.querySelectorAll('[data-party-edit]').forEach(b=>b.onclick=()=>{
   const partyId=b.dataset.partyEdit;
   if(partyId)openEntityForm(app,'fileParties',{id:partyId,onSaved:()=>reload(app)});
   else openEntityForm(app,'fileParties',{title:'إضافة رابط طرف قديم إلى إدارة الأطراف',preset:{fileId:id,partyKind:b.dataset.kind||'client',clientId:b.dataset.client||'',name:b.dataset.name||'',role:b.dataset.role||'',roleGroup:b.dataset.group||'',sequence:Number(b.dataset.sequence)||1},onSaved:()=>reload(app)});
  });
  el.querySelectorAll('[data-party-move]').forEach(b=>b.onclick=async()=>{try{await moveParty(office,b.dataset.id,Number(b.dataset.partyMove));toast('تم تحديث ترتيب الأطراف');reload(app)}catch(err){toast(userError(err),'error')}});
  el.querySelectorAll('[data-party-remove]').forEach(b=>b.onclick=async()=>{const p=parties.find(x=>x.id===b.dataset.partyRemove);if(!p)return;if(!await confirmBox(`إزالة «${esc(p.partyName||p.name)}» من هذا الملف فقط؟ سيظل سجل الموكل/الشخص محفوظًا.`,{okText:'إزالة الطرف'}))return;try{await removeParty(office,p.id);toast('تمت إزالة الطرف');reload(app)}catch(err){toast(userError(err),'error')}});
  return;
 }
 if(tab==='judicial'){
  el.innerHTML=`<div class="sec-actions"><button class="primary" data-add-stage>+ رقم قضائي / مرحلة</button><span class="muted small">مثال: محضر ← تحقيق ← جنحة ← استئناف داخل نفس الملف. كل مرحلة لها نوع رقم ورقم وسنة ومحكمة ودائرة ودرجة.</span></div>${stages.length?`<ol class="stage-chain">${stages.map(s=>`<li><button class="link" data-open-case="${s.id}">${esc(s.stageType||s.numberType||'مرحلة')}<br><small>${esc(s.caseNumber||'بدون رقم')}${s.caseYear?'/'+esc(s.caseYear):''}</small></button></li>`).join('')}</ol>`:''}<div data-grid></div>`;
  const clientRole=parties.find(p=>p.partyKind==='client')?.role||'';
  el.querySelector('[data-add-stage]').onclick=()=>openEntityForm(app,'cases',{preset:{fileId:id,stageOrder:stages.length+1,clientCapacity:clientRole},title:'إضافة رقم قضائي / مرحلة',onSaved:()=>reload(app)});
  el.querySelectorAll('[data-open-case]').forEach(b=>b.onclick=()=>app.go('case:'+b.dataset.openCase));
  await sectionGrid(app,el.querySelector('[data-grid]'),'cases',stages,{storageKey:'file:stages'});
  return;
 }
 if(tab==='hearings'||tab==='judgments'){
  const store=tab,childResult=await fileChildren(office,id,store),rows=childResult.rows;
  const what=store==='hearings'?'جلسة':'حكم';
  const limitNotice=childResult.more?'<div class="notice" role="status">تعرض الصفحة حتى 5,000 سجل مرتبط؛ قد توجد سجلات إضافية. لم تُحذف أو تُغيّر أي بيانات.</div>':'';
  el.innerHTML=stages.length?`${limitNotice}<div class="sec-actions"><button class="primary" data-add>+ ${what}</button>${store==='hearings'?'<button class="ghost" data-hearing-cycle>عرض دورة الجلسات</button>':''}</div><div data-grid></div>`:`${needStage(what)}${limitNotice}<div data-grid></div>`;
  el.querySelector('[data-add]')?.addEventListener('click',()=>{const cur=stages.at(-1);openEntityForm(app,store,{stageOptions:stageOptions(stages),preset:{caseId:cur?.id||'',...(store==='hearings'?{fileId:id,court:cur?.courtId||'',chamber:cur?.chamber||''}:{fileId:id,court:cur?.courtId||'',chamber:cur?.chamber||'',stage:cur?.stageType||''})},onSaved:()=>reload(app)})});
  el.querySelector('[data-hearing-cycle]')?.addEventListener('click',()=>showHearingCycle(app,rows[0]?.id||''));
  rows.sort((a,b)=>String(b[store==='hearings'?'hearingDate':'judgmentDate']||'').localeCompare(String(a[store==='hearings'?'hearingDate':'judgmentDate']||'')));
  await sectionGrid(app,el.querySelector('[data-grid]'),store,rows,{storageKey:'file:'+store});
  return;
 }
 if(tab==='procedures'){
  const rows=(await office.r.procedures.byIndex('fileId',id,2000)).sort((a,b)=>String(b.actionDate||b.internalDueDate||b.createdAt).localeCompare(String(a.actionDate||a.internalDueDate||a.createdAt)));
  el.innerHTML=`<div class="sec-actions"><button class="primary" data-add>+ إجراء / عمل إداري</button><span class="muted small">الإجراءات مستقلة عن المراحل وعن الملف، ويمكن ربطها بمرحلة اختياريًا.</span></div>
   <ol class="timeline">${rows.slice(0,60).map(p=>`<li data-open="${p.id}"><time>${fmtDate(p.actionDate||p.internalDueDate)||'—'}</time><div><b>${esc(p.type||'إجراء')}</b> ${esc(p.description||'')}<small class="muted"> ${esc(label(p.status||''))}${p.result?' — '+esc(p.result):''}</small></div></li>`).join('')||'<li class="muted">لا توجد إجراءات مسجلة.</li>'}</ol>
   <details class="rec-section"><summary>عرض جدول الإجراءات</summary><div data-grid></div></details>`;
  el.querySelector('[data-add]').onclick=()=>openEntityForm(app,'procedures',{preset:{fileId:id},stageOptions:stageOptions(stages),onSaved:()=>reload(app)});
  el.querySelectorAll('.timeline [data-open]').forEach(li=>li.onclick=()=>app.go('rec:procedures:'+li.dataset.open));
  await sectionGrid(app,el.querySelector('[data-grid]'),'procedures',rows,{storageKey:'file:procedures'});
  return;
 }
 if(tab==='notes'){
  // caseNotes remains the canonical store: historical rows and new Quick Notes are
  // rendered together through the same operational panel, not as a second Notes UI.
  const rows=(await notesForEntity(office,'LEGAL_FILE',id,{limit:100})).sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
  el.innerHTML=`<section class="panel file-quick-notes" data-collapse-default="open"><div class="panel-head"><h3>📝 الملاحظات السريعة المرتبطة</h3><div class="sec-actions"><button class="primary" data-quick-file-add>+ ملاحظة سريعة</button></div></div><p class="muted small">ملاحظات تشغيلية مستقلة عن الحكم أو الإجراء. السجلات التاريخية محفوظة في caseNotes وتظهر هنا دون نسخ أو حذف.</p><div data-quick-file-list></div></section>`;
  renderFileQuickNotes(el.querySelector('[data-quick-file-list]'),rows,app,id);
  el.querySelector('[data-quick-file-add]').onclick=()=>openQuickNoteCapture(app,{context:[{entityType:'LEGAL_FILE',entityId:id}],onSaved:()=>reload(app)});
  return;
 }
 if(tab==='serviceRecords'){
  el.innerHTML=await renderFileServiceTab(app,f,stages);
  await bindFileServiceTab(app,f,stages,parties);
  return;
 }
 if(tab==='relations'){
  const rels=await fileRelations(office,id);
  const rows=rels.map(r=>({...r,dirLabel:r.direction==='out'?'هذا الملف ←':'← من ملف آخر'}));
  const relations=createGridRelations(office,'fileRelations');await relations.hydrate(rows);
  el.innerHTML=`<div class="sec-actions"><button class="primary" data-add>+ ربط بملف آخر</button><span class="muted small">مثال: ملف استئناف مرتبط بملف الدعوى الأصلية، أو ملف تنفيذ لحكم.</span></div><div data-grid></div>`;
  el.querySelector('[data-add]').onclick=()=>openEntityForm(app,'fileRelations',{preset:{sourceFileId:id},onSaved:()=>reload(app)});
  mountGrid(el.querySelector('[data-grid]'),{title:'علاقات الملف',storageKey:'file:relations',collapseKey:`file:${id}:relations-grid`,rows,...relations.gridOptions({fileId:id}),columns:[
   ...legalFileColumns(relations,{side:'other',fileKey:'otherLabel',fileTitle:'رقم الملف المرتبط / نوعه'}),
   {key:'dirLabel',label:'الاتجاه'},{key:'relationType',label:'نوع العلاقة'},{key:'notes',label:'ملاحظات'},{key:'createdAt',label:'تاريخ الربط',type:'date',text:r=>fmtDate(r.createdAt)}],
   onRowClick:r=>relationActions(app,r)});
  return;
 }
 if(tab==='typeData'){
  const {tax}=app.__file;const t=tax.byId.get(f.fileTypeId);const fields=t?.fields||[];
  if(!fields.length){el.innerHTML=`<div class="notice">${t?'لا توجد حقول خاصة لهذا النوع. يمكنك إضافة حقول من الإعدادات ← الأقسام وأنواع الأعمال.':'حدد نوع العمل أولًا من «تغيير القسم / النوع».'}</div>`;return}
  el.innerHTML=`<section class="panel"><div class="panel-head"><h3>بيانات ${esc(t.name)}</h3><span class="muted small">كل الحقول اختيارية</span></div><form class="entity-form" id="meta-form"><div class="form-grid">${fields.map(x=>metaInput(x,f['x_'+x.k])).join('')}</div><div class="form-actions"><button class="primary">حفظ</button></div></form></section>`;
  await hydrateLookups(app,el);
  el.querySelector('#meta-form').onsubmit=async e=>{e.preventDefault();const v={};el.querySelectorAll('[data-meta]').forEach(i=>v[i.dataset.meta]=i.value);try{await saveFileMeta(office,id,v);toast('تم الحفظ');reload(app)}catch(err){toast(userError(err),'error')}};
  return;
 }
 if(tab==='assets'){
  const rows=await fileAssets(office,id);
  el.innerHTML=`<div class="sec-actions">${Object.entries(ASSET_KINDS).map(([k,d])=>`<button class="ghost" data-new-asset="${k}">+ ${esc(d.label)}</button>`).join('')}<button class="ghost" data-link-asset>ربط أصل مسجل</button><span class="muted small">عقار أو مركبة أو جهة يمكن ربطها بأكثر من ملف دون تكرار بياناتها.</span></div>
   <div class="asset-list">${rows.map(({link,asset:a})=>`<article class="lf-card"><header><span>${esc(ASSET_KINDS[a.kind]?.icon||'📎')}</span><div><b>${esc(a.name||'')}</b><small>${esc(ASSET_KINDS[a.kind]?.label||'')}${link.role?' · '+esc(link.role):''}</small></div><button class="link danger" data-unlink="${esc(a.id)}">إلغاء الربط</button></header>${assetDetails(a)?`<p class="small muted">${esc(assetDetails(a))}</p>`:''}</article>`).join('')||'<p class="muted">لا توجد أصول مرتبطة.</p>'}</div>`;
  el.querySelectorAll('[data-new-asset]').forEach(b=>b.onclick=()=>assetDialog(app,id,b.dataset.newAsset));
  el.querySelector('[data-link-asset]').onclick=()=>linkAssetDialog(app,id);
  el.querySelectorAll('[data-unlink]').forEach(b=>b.onclick=async()=>{if(!await confirmBox('إلغاء ربط الأصل بهذا الملف؟ (بيانات الأصل لا تُحذف)',{okText:'إلغاء الربط'}))return;await unlinkAsset(office,id,b.dataset.unlink);reload(app)});
  return;
 }
 if(tab==='extra'){
  const g=fileTypeGroup(f.fileType);const def=FILE_TYPE_GROUPS[g];
  const otherData=Object.entries(FILE_TYPE_GROUPS).filter(([k])=>k!==g).map(([,d])=>({d,html:kvHtml(d.fields,f,new Map())})).filter(x=>!x.html.includes('class="muted"'));
  el.innerHTML=`<section class="panel"><div class="panel-head"><h3>${esc(def?.label||'بيانات حسب نوع الملف')}</h3><button class="primary" data-edit-extra>تعديل</button></div>${def?kvHtml(def.fields,f,new Map()):'<p class="muted">حدد نوع الملف من «تعديل البيانات» لتظهر الحقول الخاصة به.</p>'}</section>
   ${otherData.map(x=>`<section class="panel"><h3>${esc(x.d.label)} <small class="muted">(من نوع سابق — محفوظة ولم تُحذف)</small></h3>${x.html}</section>`).join('')}`;
  el.querySelector('[data-edit-extra]').onclick=()=>openEntityForm(app,'files',{id,typeFieldsOnly:true,title:'تعديل البيانات حسب نوع الملف'});
  return;
 }
 if(tab==='money'){
  const [fees,docs,poas,appts,comms]=await Promise.all([office.r.fees.byIndex('fileId',id,1000),office.r.documentReferences.byIndex('fileId',id,1000),office.r.powersOfAttorney.byIndex('fileId',id,1000),office.r.appointments.byIndex('fileId',id,1000),office.r.communications.byIndex('fileId',id,1000)]);
  const blocks=[['fees','الأتعاب',fees],['documentReferences','المستندات',docs],['powersOfAttorney','التوكيلات المرتبطة',poas],['appointments','المواعيد',appts],['communications','الاتصالات',comms]];
  el.innerHTML=blocks.map(([s,l,rows])=>`<details class="rec-section" ${rows.length?'open':''}><summary><span>${l}</span><span class="count">${rows.length}</span></summary><div class="sec-actions"><button class="ghost" data-add="${s}">+ إضافة</button></div><div data-grid="${s}"></div></details>`).join('');
  const client=parties.find(p=>p.clientId)?.clientId||'';
  el.querySelectorAll('[data-add]').forEach(b=>b.onclick=()=>openEntityForm(app,b.dataset.add,{preset:{fileId:id,...(['powersOfAttorney','appointments','communications'].includes(b.dataset.add)&&client?{clientId:client}:{})},onSaved:()=>reload(app)}));
  await Promise.all(blocks.map(([s,,rows])=>sectionGrid(app,el.querySelector(`[data-grid="${s}"]`),s,rows,{storageKey:'file:'+s})));
  return;
 }
 if(tab==='activity'){
  const [a,b]=await Promise.all([office.r.activityLog.byIndex('fileId',id,2000),office.r.activityLog.byIndex('entityId',id,500)]);
  const rows=[...new Map([...a,...b].map(x=>[x.id,x])).values()].sort((x,y)=>String(y.timestamp).localeCompare(String(x.timestamp)));
  // «تغيّر منذ زيارتي» — نفس آلية «منذ آخر زيارة» في الرئيسية (activityLog + وقت زيارة
  // محفوظ في التفضيلات الموجودة)، بلا نظام موازٍ. يُعرض عند وجود تغييرات فعلية فقط.
  const seenScope=`file:${id}`;
  const since=sinceChanges(rows,readStoredSeen(seenScope),8);
  const sinceHtml=since.total?`<section class="panel" data-collapse-default="open" data-collapse-summary="${since.total} تغييرات"><div class="panel-head"><h3>تغيّر منذ زيارتك</h3><span class="badge warn" data-collapse-alert>${since.total}${since.capped?'+':''} تغييرات</span></div><ol class="timeline file-since-list">${since.rows.map(r=>`<li><time>${fmtDate(String(r.timestamp||'').slice(0,10))}</time><div><b>${esc(r.summary||'نشاط')}</b>${r.action?` <small class="muted">${esc(r.action)}</small>`:''}</div></li>`).join('')}</ol></section>`:'';
  markHomeSeen(seenScope).catch(()=>{});
  el.innerHTML=`${sinceHtml}<div data-grid></div>`;
  await sectionGrid(app,el.querySelector('[data-grid]'),'activityLog',rows,{title:`سجل نشاط الملف ${formatFileNumber(f.fileNumber)}`,storageKey:'file:activity',collapseKey:`file:${id}:activity-grid`});
 }
}

function partyActions(app,p){
 const route=p.clientId?'client:'+p.clientId:p.opponentId?'opponent:'+p.opponentId:null;
 const card=modal(`<h2 class="modal-title">${esc(p.name)} <small class="muted">${esc(p.role||'')}</small></h2><div class="action-stack">${route?'<button class="primary" data-a="open">فتح سجل الشخص</button>':''}${p.id?'<button class="ghost" data-a="edit">تعديل الصفة / البيانات</button><button class="ghost danger" data-a="remove">إزالة من الملف</button>':'<p class="muted">رابط قديم من الإصدار السابق؛ سيُرحّل تلقائيًا.</p>'}</div>`);
 card.querySelector('[data-a="open"]')?.addEventListener('click',()=>{closeModal();app.go(route)});
 card.querySelector('[data-a="edit"]')?.addEventListener('click',()=>{closeModal();openEntityForm(app,'fileParties',{id:p.id,onSaved:()=>reload(app)})});
 card.querySelector('[data-a="remove"]')?.addEventListener('click',async()=>{closeModal();if(!await confirmBox(`إزالة ${esc(p.name)} من أطراف هذا الملف؟ (سجل الشخص نفسه لا يُحذف)`,{okText:'إزالة'}))return;try{await removeParty(app.office,p.id);toast('تمت الإزالة');reload(app)}catch(e){toast(userError(e),'error')}});
}
function relationActions(app,r){
 const card=modal(`<h2 class="modal-title">${esc(r.relationType||'علاقة')}</h2><p>${esc(r.otherLabel)}</p><div class="action-stack"><button class="primary" data-a="open">فتح الملف المرتبط</button><button class="ghost" data-a="edit">تعديل</button><button class="ghost danger" data-a="remove">إلغاء الربط</button></div>`);
 card.querySelector('[data-a="open"]').onclick=()=>{closeModal();app.go('file:'+r.otherFileId)};
 card.querySelector('[data-a="edit"]').onclick=()=>{closeModal();openEntityForm(app,'fileRelations',{id:r.id,onSaved:()=>reload(app)})};
 card.querySelector('[data-a="remove"]').onclick=async()=>{closeModal();if(!await confirmBox('إلغاء الربط بين الملفين؟ (حذف منطقي للعلاقة فقط)',{okText:'إلغاء الربط'}))return;try{await deleteEntity(app.office,'fileRelations',r.id);toast('تم إلغاء الربط');reload(app)}catch(e){toast(userError(e),'error')}};
}
export {openRow,displayValue,bindRefLinks};

// نسخ ملخص الملف كنص — بيانات مسجلة فقط، لا استنتاجات قانونية.
async function copyFileSummary(app){
 const {id,f,parties,stages}=app.__file;
 const cur=stages.find(s=>s.id===f.currentStageId)||stages.at(-1);
 const clients=parties.filter(p=>p.partyKind==='client'),opps=parties.filter(p=>p.partyKind==='opponent');
 const next=fileNextStep({hearings:(await fileChildren(app.office,id,'hearings').catch(()=>({rows:[]}))).rows,procedures:(await fileChildren(app.office,id,'procedures').catch(()=>({rows:[]}))).rows,today:localDate()});
 const lines=[
  `ملف ${formatFileNumber(f.fileNumber)||''}${f.title?' — '+f.title:''}`.trim(),
  `الحالة: ${label(f.status||'open')}${f.isArchived?' (مؤرشف)':''}`,
  clients.length?`الموكل: ${clients.map(p=>`${p.name}${p.role?` (${p.role})`:''}`).join('، ')}`:'الموكل: غير مرتبط',
  opps.length?`الخصم: ${opps.map(p=>p.name).join('، ')}`:'',
  f.responsibleLawyer?`المحامي المسؤول: ${f.responsibleLawyer}`:'',
  cur?`المرحلة الحالية: ${refLabel('cases',cur)}`:'لا توجد أرقام قضائية',
  next?`الخطوة التالية: ${next.eyebrow} — ${next.title}${next.meta?' ('+next.meta+')':''}`:'لا توجد خطوة مجدولة',
  f.openedAt?`تاريخ الفتح: ${fmtDate(f.openedAt)}`:'',
  f.notes?`ملاحظات: ${f.notes}`:''
 ].filter(Boolean);
 const text=lines.join('\n');
 try{await navigator.clipboard.writeText(text);toast('تم نسخ ملخص الملف')}catch{
  const ta=document.createElement('textarea');ta.value=text;document.body.append(ta);ta.select();
  try{document.execCommand('copy');toast('تم نسخ ملخص الملف')}catch{toast('تعذر النسخ — انسخ يدويًا','error')}ta.remove();
 }
}

async function reclassDialog(app,f){
 const tax=await taxonomy(app.office);
 const card=modal(`<h2 class="modal-title">تغيير القسم / نوع العمل</h2><p class="muted small">لا تُحذف أي بيانات: الحقول السابقة تبقى محفوظة، ويُسجل التغيير في سجل النشاط.</p><form id="rc"><label>القسم<select name="cat">${tax.categories.map(c=>`<option value="${esc(c.id)}" ${c.id===f.categoryId?'selected':''}>${esc(c.icon||'')} ${esc(c.name)}</option>`).join('')}</select></label><label>نوع العمل<select name="type"></select></label><div class="form-actions"><button class="primary">حفظ</button><button type="button" class="ghost" data-cancel>إلغاء</button></div></form>`);
 const form=card.querySelector('#rc'),fill=()=>{form.type.innerHTML='<option value="">— بدون نوع —</option>'+tax.typesOf(form.cat.value).map(t=>`<option value="${esc(t.id)}" ${t.id===f.fileTypeId?'selected':''}>${esc(t.name)}</option>`).join('')};fill();form.cat.onchange=fill;
 card.querySelector('[data-cancel]').onclick=closeModal;
 form.onsubmit=async e=>{e.preventDefault();try{await reclassifyFile(app.office,f.id,form.cat.value,form.type.value||null);closeModal();toast('تم التحديث');reload(app)}catch(err){toast(userError(err),'error')}};
}
function assetDialog(app,fileId,kind){
 const d=ASSET_KINDS[kind];
 const card=modal(`<h2 class="modal-title">${esc(d.icon)} ${esc(d.label)} جديد</h2><form id="as" class="entity-form"><div class="form-grid">${d.fields.map(([k,l])=>`<div class="field"><label>${esc(l)}<input name="${esc(k)}"></label></div>`).join('')}<div class="field"><label>صفته في الملف<input name="__role" placeholder="مثل: محل النزاع، المركبة المضبوطة"></label></div></div><div class="form-actions"><button class="primary">حفظ وربط</button><button type="button" class="ghost" data-cancel>إلغاء</button></div></form>`);
 card.querySelector('[data-cancel]').onclick=closeModal;
 card.querySelector('#as').onsubmit=async e=>{e.preventDefault();const v=Object.fromEntries(new FormData(e.target));const role=v.__role;delete v.__role;try{const a=await saveAsset(app.office,kind,v);await linkAsset(app.office,fileId,a.id,role);closeModal();toast('تم الحفظ والربط');reload(app)}catch(err){toast(userError(err),'error')}};
}
function linkAssetDialog(app,fileId){
 const card=modal(`<h2 class="modal-title">ربط أصل مسجل</h2><input type="search" id="as-q" placeholder="ابحث بالعنوان، اللوحة، رقم الشاسيه، الجهة…"><div id="as-r" class="cf-lines"></div>`);
 const q=card.querySelector('#as-q'),r=card.querySelector('#as-r');let t=0;
 const run=async()=>{const rows=await findAssets(app.office,q.value);r.innerHTML=rows.map(a=>`<button class="cf-line" data-id="${esc(a.id)}"><span class="cf-line-icon">${esc(ASSET_KINDS[a.kind]?.icon||'')}</span><span class="cf-line-main"><b>${esc(a.name)}</b><small>${esc(assetDetails(a))}</small></span></button>`).join('')||'<p class="muted small">لا نتائج.</p>'};
 q.oninput=()=>{clearTimeout(t);t=setTimeout(run,250)};run();
 r.onclick=async e=>{const b=e.target.closest('[data-id]');if(!b)return;try{await linkAsset(app.office,fileId,b.dataset.id);closeModal();toast('تم الربط');reload(app)}catch(err){toast(userError(err),'error')}};
}


function renderFileQuickNotes(host, rows, app, fileId) {
  host.replaceChildren();
  if (!rows.length) { const empty=document.createElement('p'); empty.className='muted'; empty.textContent='لا توجد ملاحظات سريعة مرتبطة بهذا الملف.'; host.append(empty); return; }
  rows.forEach(note => {
    const article=document.createElement('article'); article.className='qn-card'; article.dataset.noteId=note.id;
    const head=document.createElement('div'); head.className='qn-card-head'; const title=document.createElement('button'); title.type='button'; title.className='qn-title'; title.textContent=note.title||'ملاحظة بلا عنوان'; head.append(title); const meta=document.createElement('span'); meta.className='qn-meta'; meta.textContent=`${note.lifecycle==='DONE'?'منجزة':'مفتوحة'} · ${note.priority||'NORMAL'}`; head.append(meta); article.append(head);
    const body=document.createElement('p'); body.className='qn-body'; body.textContent=note.content||'—'; article.append(body);
    const actions=document.createElement('div'); actions.className='qn-actions'; const edit=document.createElement('button'); edit.type='button'; edit.className='ghost qn-action'; edit.textContent='تعديل'; edit.onclick=()=>openQuickNoteEditor(app,note.id,{onSaved:()=>reload(app)}); const done=document.createElement('button'); done.type='button'; done.className='ghost qn-action'; done.textContent=note.lifecycle==='DONE'?'إعادة فتح':'إنجاز'; done.onclick=async()=>{try{if(note.lifecycle==='DONE'){const {reopenQuickNote}=await import('../services/quick-notes.js');await reopenQuickNote(app.office,note.id)}else await completeQuickNote(app.office,note.id);reload(app)}catch(error){toast(userError(error),'error')}}; const del=document.createElement('button'); del.type='button'; del.className='danger qn-action'; del.textContent='سلة'; del.onclick=async()=>{if(await confirmBox('نقل الملاحظة إلى السلة؟')){try{await deleteQuickNote(app.office,note.id);reload(app)}catch(error){toast(userError(error),'error')}}}; actions.append(edit,done,del); article.append(actions); host.append(article);
  });
}
