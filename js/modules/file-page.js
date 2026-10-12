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
import {ENTITIES,FILE_TYPE_GROUPS,fileTypeGroup,label,fmtDate,isClosedFile,displayValue,entityRoute} from '../domain/entities.js';
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
import {enhanceCollapsiblePanels,updateCollapseSummary} from '../ui/collapsible.js';
import {buildFileTimeline} from '../services/timeline.js';
import {timelineHtml,bindTimeline} from './timeline-view.js';
import {fileCockpitHtml,bindCockpit,executionStripHtml,fileNextStep} from '../ui/cockpit.js';
import {executionsForFile,executionContextSummary} from '../services/execution-work.js';
import {trackRecent} from '../services/recents.js';
import {formatFileNumber} from '../core/file-number.js';
import {registerPageLayout,resolveSectionOrder,hiddenSectionIds,migrateLegacySectionOrder,openPageCustomizer} from '../ui/page-layout.js';
import {notesForEntity,completeQuickNote,deleteQuickNote} from '../services/quick-notes.js';
import {openQuickNoteCapture,openQuickNoteEditor} from './quick-notes.js';
import {openQuickAdd} from './quick-add.js';
import {readStoredSeen,markHomeSeen,sinceChanges} from '../services/home-visit.js';
import {prefs} from '../core/preferences.js';

// شريط تبويبات واحد (Data-First Legal Workspace): أربعة تبويبات ثابتة ظاهرة دائمًا
// (نظرة عامة ← الجلسات ← الأعمال الإدارية ← المراحل) وبقية الأقسام كلها في قائمة منسدلة
// واحدة. المعرّفات (ids) ثابتة تمامًا كما كانت حتى تبقى تفضيلات الترتيب/الإظهار وحالة الطي
// والكاش وآخر تبويب لكل ملف صالحة؛ تغيّر التوزيع والتسميات فقط.
// [المعرّف، التسمية الكاملة، الأيقونة، التسمية القصيرة للشاشات الضيقة] — نفس الأقسام والمعرّفات.
const TABS=[['summary','نظرة عامة','◈'],['hearings','الجلسات','◷'],['procedures','الأعمال الإدارية','☷','الأعمال'],['judicial','المراحل','▣'],['parties','الأطراف والصفات','⚖','الأطراف'],['judgments','الأحكام','⌘'],['serviceRecords','المحضرين والإعلانات','📬','المحضرين'],['money','الأتعاب والمستندات','＄','الأتعاب'],['relations','العلاقات والملفات المرتبطة','↔','الارتباطات'],['typeData','بيانات نوع العمل','▧','نوع العمل'],['assets','العقارات والمركبات','⌂','الأصول'],['timeline','الخط الزمني','⏳'],['notes','الملاحظات','▤'],['extra','بيانات إضافية (قديمة)','▤','بيانات قديمة'],['activity','سجل النشاط','≋']];
const TAB_META=new Map(TABS);
// التبويبات الأساسية الظاهرة في الشريط — الأكثر استخدامًا يوميًا. لا تُنقل إلى القائمة أبدًا.
const PRIMARY_TABS=['summary','hearings','procedures','judicial'];
// عناوين تنظيمية *داخل* القائمة المنسدلة الواحدة (تقصير مسافة البحث فقط، ولا تُنشئ قائمة
// ثانية في الشريط). أي قسم غير مصنّف — أو يُضاف مستقبلًا — يسقط تلقائيًا في «المزيد».
const TAB_GROUPS=[
 {id:'gParties',label:'أطراف الملف',short:'الأطراف',icon:'⚖',tabs:['parties','assets']},
 {id:'gJudgments',label:'الأحكام والإعلانات',short:'الأحكام',icon:'⌘',tabs:['judgments','serviceRecords']},
 {id:'gRecords',label:'البيانات والمراجع',short:'البيانات',icon:'▤',tabs:['money','notes','typeData','extra']},
 {id:'gFollow',label:'الارتباطات والمتابعة',short:'المتابعة',icon:'↔',tabs:['relations','timeline','activity']},
];
// القائمة المنسدلة الواحدة: زرها الوحيد في الشريط بجانب التبويبات الأربعة.
const MORE_GROUP={id:'gMore',label:'المزيد من الأقسام',short:'كل الأقسام',icon:'⋯'};
// معرّف القائمة يتبع نمط التركيب الذي يقرأه bindTabMenus من data-tab-group (فتح/إغلاق/تركيز).
const MENU_ID=`ftb-menu-${MORE_GROUP.id}`;
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
/**
 * توزيع الأقسام: الأساسية كما هي بترتيب المستخدم المحفوظ داخل الشريط، وكل بقية الأقسام
 * داخل قائمة منسدلة واحدة مرتّبة بعناوين وظيفية (وبترتيب المستخدم داخل كل عنوان). الأقسام
 * المخفية من «تخصيص الصفحة» تُستبعد من الشريط لكنها تبقى ظاهرة في القائمة بعلامة «مخفي»
 * حتى لا تصبح أي وظيفة غير قابلة للوصول.
 * @returns {{primary:Array,sections:Array,hiddenTabs:Array}}
 */
function tabLayout(){
 const order=orderedFileTabs();
 const hidden=hiddenSectionIds('file-details');
 const primary=order.filter(([id])=>PRIMARY_TABS.includes(id)&&!hidden.has(id));
 const grouped=new Set(TAB_GROUPS.flatMap(g=>g.tabs));
 const sections=TAB_GROUPS.map(g=>({...g,tabs:order.filter(([id])=>g.tabs.includes(id)&&!hidden.has(id))})).filter(g=>g.tabs.length);
 const rest=order.filter(([id])=>!PRIMARY_TABS.includes(id)&&!grouped.has(id)&&!hidden.has(id));
 if(rest.length)sections.push({...MORE_GROUP,tabs:rest});
 const hiddenTabs=order.filter(([id])=>hidden.has(id));
 return {primary,sections,hiddenTabs};
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

/**
 * كتلة الهوية التشغيلية للملف — تُعرض كأول قسم داخل «نظرة عامة» فقط.
 * لا يظهر رقم الملف الداخلي في HTML الأولي: زر «الملف الفرعي» يملأ الشريط
 * الصغير عند الطلب، حتى لا يختلط الرقم الداخلي برقم الدعوى/الاستئناف.
 */
function fileOverviewStaticHtml(app){
 const v=app.__file?.view||{};
 const {id,f,head,cat,ftype,headParties,favOn,crumbs}=v;
 if(!f)return '';
 const status=label(f.status||'open');
 const closed=isClosedFile(f);
 const title=head?.isCase?(head.title||'ملف'):(f.title||ftype?.name||'ملف');
 const statusClass=closed?'closed':'open';
 const parties=headParties||[];
 return `<div class="file-overview-static" data-file-overview-static>
  <section class="record-head file-head file-id file-overview-identity" id="file-head" aria-labelledby="file-identity-title" style="--cat:${esc(cat?.color||'var(--primary)')}">
   ${crumbs||''}
   <div class="fid-top">
    <div class="fid-case">
     ${head?.kicker?`<p class="fid-kicker">${esc(head.kicker)}</p>`:''}
     <div class="fid-title-row">
      <h2 class="fid-title" id="file-identity-title">${esc(title)}</h2>
      <span class="badge ${statusClass} fid-status" data-file-status>${esc(status)}</span>
     </div>
     ${head?.court?`<p class="fid-court">${esc(head.court)}</p>`:''}
     ${!head?.isCase?`<p class="fid-sub">${esc(ftype?.name||f.fileType||'')} — لا توجد أرقام قضائية مسجلة (ملف بلا قضية)</p>`:''}
     <div class="fid-parties" role="list" aria-label="أطراف الملف: الموكل والخصم وبقية الأطراف">
      ${parties.slice(0,HEAD_PARTIES_MAX).map(({p,word,kind},i)=>`<button type="button" role="listitem" class="fid-party fid-party--${kind}" data-party-open="${i}" title="فتح بيانات ${esc(p.partyName||p.name||'طرف')} وإجراءاته"><span class="fid-party-role">${esc(word)}</span><b class="fid-party-name">${esc(p.partyName||p.name||'طرف')}</b>${p.role?`<span class="fid-party-cap">${esc(p.role)}</span>`:''}${p.isActive===false?'<span class="fid-party-cap">غير نشط</span>':''}</button>`).join('')}
      ${parties.length>HEAD_PARTIES_MAX?`<button type="button" class="fid-party fid-party--more" data-tab-jump="parties">+${parties.length-HEAD_PARTIES_MAX} — عرض كل الأطراف (${parties.length})</button>`:''}
      ${parties.length?'':`<span class="fid-party-empty">لا يوجد أطراف مرتبطون بعد — <button type="button" class="link" data-tab-jump="parties">أضف الأطراف</button></span>`}
     </div>
     <div class="head-actions fid-actions">
      <button class="primary" data-file-quick>+ إضافة</button>
      <button class="ghost" data-file-edit>✎ تعديل</button>
      <div class="ux-menu-wrap"><button type="button" class="ghost icon-only" data-card-menu aria-haspopup="menu" aria-label="إجراءات الملف">⋯</button>
       <div class="ux-menu" role="menu" hidden>
        <button type="button" role="menuitem" class="ux-menu-item" data-file-task>＋ مهمة مرتبطة</button>
        <button type="button" role="menuitem" class="ux-menu-item" data-reclass>تغيير القسم / النوع</button>
        <button type="button" role="menuitem" class="ux-menu-item" data-file-pin aria-pressed="${favOn}">${favOn?'★ إلغاء التثبيت':'☆ تثبيت في الرئيسية'}</button>
        <button type="button" role="menuitem" class="ux-menu-item" data-file-copy>📋 نسخ ملخص الملف</button>
        ${f.isArchived||closed?'<button type="button" role="menuitem" class="ux-menu-item" data-file-reopen>إعادة فتح</button>':'<button type="button" role="menuitem" class="ux-menu-item" data-file-close>إنهاء الملف</button><button type="button" role="menuitem" class="ux-menu-item" data-file-archive>أرشفة</button>'}
        <button type="button" role="menuitem" class="ux-menu-item is-danger" data-file-delete>حذف منطقي للملف</button>
       </div>
      </div>
     </div>
     <p class="badges fid-badges">${f.needsClassification?'<button class="badge warn" data-reclass title="تم تصنيف الملف تلقائيًا من بيانات قديمة">⚠ راجع التصنيف</button>':''}${head?.isCase&&v.cur?`<button type="button" class="badge stage" data-route="case:${esc(v.cur.id)}" title="فتح بيانات المرحلة المسجلة في هذا الملف" aria-label="فتح المرحلة: ${esc(refLabel('cases',v.cur))}">المرحلة: ${esc(v.cur.stageType||v.cur.numberType||'—')}</button>`:''}${f.isArchived?`<span class="badge warn">مؤرشف${f.archivedReason?' — '+esc(f.archivedReason):''}</span>`:''}${f.priority&&f.priority!=='normal'?`<span class="badge warn">${esc(label(f.priority))}</span>`:''}${f.responsibleLawyer?`<span class="badge">المحامي: ${esc(f.responsibleLawyer)}</span>`:''}</p>
    </div>
   </div>
   <div class="fid-bottom">
    <div class="fid-tools">${listNavHtml(app,'files',id)}</div>
    <div class="fid-file-number">
     <button type="button" class="ghost small fid-file-number-toggle" data-file-number-toggle aria-expanded="false" aria-controls="file-number-popover-${esc(id)}" title="إظهار رقم الملف الفرعي الداخلي">الملف الفرعي</button>
     <span class="fid-file-number-popover" id="file-number-popover-${esc(id)}" data-file-number-popover role="status" hidden></span>
    </div>
   </div>
  </section>
 </div>`;
}

export async function filePage(app,id){
 const f=await app.office.r.files.get(id);
 if(!f||f.isDeleted)return notFound('الملف');
 trackRecent('file:'+id,`${formatFileNumber(f.fileNumber)||'ملف'} — ${f.title||'بدون عنوان'}`.trim(),{icon:'folder',sub:f.title?'':'ملف قانوني',scope:app.ctx?.profile?.id||''});
 // مركز الملف: الجلسات والأعمال تُقرأ مع بيانات الرأس في استعلام واحد متوازٍ (بحدود مضبوطة).
 const [parties,stages,serviceCount,hearingsRes,proceduresRes,executions]=await Promise.all([fileParties(app.office,id),fileStages(app.office,id),app.office.r.serviceRecords.countIndex('fileId_recordState',[id,'active']),fileChildren(app.office,id,'hearings'),fileChildren(app.office,id,'procedures'),executionsForFile(app.office,id).catch(()=>[])]);
 const tax=await taxonomy(app.office);const cat=tax.byId.get(f.categoryId),ftype=tax.byId.get(f.fileTypeId);
 const cfRow=f.clientFileId?await app.office.r.clientFiles.get(f.clientFileId):null;
 const cfClient=cfRow?.clientId?await app.office.r.clients.get(cfRow.clientId).catch(()=>null):null;
 app.__file={id,f,parties,stages,tax,serviceCount,executions};
 // فتح صفحة الملف يبدأ دائمًا من «نظرة عامة»؛ لا تُفرض حالة تبويب قديمة عند
 // الدخول من قائمة الملفات أو من رابط الملف. التبويب المختلف لا يُفتح إلا برابط
 // صريح (?tab=hearings مثلًا)، وهو ما يحفظ العودة العميقة دون إرباك المستخدم.
 const explicitTab=routeTab(app);
 app.__fileTab={id,tab:explicitTab||'summary'};
 // إذا أخفى المستخدم التبويب النشط من «تخصيص الصفحة»، نعود إلى نظرة عامة (لا بيانات تُفقَد).
 if(hiddenSectionIds('file-details').has(app.__fileTab.tab))app.__fileTab.tab='summary';
 app.__fileTabValid=tab=>TAB_META.has(tab);
 const isClientParty=p=>(p.isClient??p.partyKind==='client');
 const clients=sortParties(parties.filter(isClientParty));
 const opps=sortParties(parties.filter(p=>!isClientParty(p)&&p.partyKind==='opponent'));
 const others=sortParties(parties.filter(p=>!isClientParty(p)&&p.partyKind!=='opponent'));
 // ترتيب العرض اليدوي محفوظ: موكلون ثم خصوم ثم بقية الأطراف، وبترتيب sequence داخل كل مجموعة.
 const headParties=[...clients.map(p=>({p,word:'الموكل',kind:'client'})),...opps.map(p=>({p,word:'الخصم',kind:'opponent'})),...others.map(p=>({p,word:p.roleGroup||'طرف',kind:'other'}))];
 app.__file.headParties=headParties;
 const cur=stages.find(s=>s.id===f.currentStageId)||stages.at(-1);
 const head=caseHeadData(f,cur,ftype,cat);
 const focusOn=Boolean(prefs.get(FOCUS_MODE_KEY,false));
 const favOn=isFavorite('file:'+id,app.ctx?.profile?.id||'');
 const tabCount=k=>k==='parties'?parties.length:k==='judicial'?stages.length:k==='serviceRecords'?serviceCount:k==='hearings'?hearingsRes.rows.length:k==='procedures'?proceduresRes.rows.length:0;
 const crumbs=cfRow?.clientId&&cfClient?`<nav class="crumbs file-overview-crumbs" aria-label="المسار"><button class="link" data-route="client:${esc(cfClient.id)}">${esc(cfClient.fullName||'الموكل')}</button><span class="sep">‹</span><button class="link" data-route="cfile:${esc(cfClient.id)}">الملف الرئيسي ${esc(formatFileNumber(cfRow.clientCode))}</button>${cat?`<span class="sep">‹</span><button class="link" data-route="cfile:${esc(cfClient.id)}?cat=${esc(cat.id)}">${esc(cat.icon||'')} ${esc(cat.name)}</button>`:''}${ftype?`<span class="sep">‹</span><span>${esc(ftype.name)}</span>`:''}</nav>`:cfRow?.clientId?`<p class="crumbs muted file-overview-crumbs" role="status">سجل الموكل المرتبط غير متاح حاليًا؛ عُرض الملف كما هو.</p>`:cfRow?`<p class="crumbs muted file-overview-crumbs" role="status">ملف الموكل موجود لكن لا يوجد موكل مرتبط قابل للتنقل.</p>`:f.clientFileId?`<p class="crumbs muted file-overview-crumbs" role="status">الملف الرئيسي المرتبط غير متاح حاليًا؛ عُرض الملف كما هو.</p>`:'';
 app.__file.view={id,f,head,cat,ftype,headParties,favOn,cur,crumbs};
 return `<nav class="file-tabs-bar" id="file-tabs-nav" aria-label="أقسام الملف">
  <div class="file-subtabs" role="tablist" aria-label="تبويبات الملف">${tabLayout().primary.map(([k,l,icon,short])=>tabBtnHtml(app,k,l,icon,tabCount(k),short)).join('')}</div>
  ${moreMenuHtml(app,tabCount)}
  <div class="ftb-tools">
   <button type="button" class="ghost icon-only" data-file-focus aria-pressed="${focusOn}" title="وضع التركيز: إخفاء العناصر الثانوية مع بقاء التنبيهات والإجراءات" aria-label="${focusOn?'الخروج من وضع التركيز':'وضع التركيز'}">${focusOn?'◉':'◎'}</button>
   <button type="button" class="ghost icon-only" data-order-file-tabs title="ترتيب الأقسام وإظهارها وإعدادات العرض" aria-label="تخصيص الصفحة">⚙</button>
  </div>
 </nav>
 <section class="panel file-tab-shell" data-collapse-id="file-tab-body" data-collapse-key="file-details:tab-body" data-collapse-default="open"><div class="panel-head"><h3 data-tab-shell-title>${esc(TAB_META.get(app.__fileTab.tab)||'المحتوى')}</h3><span class="collapse-summary" data-collapse-summary></span></div>
 <div class="file-overview-host" data-file-overview-host>${fileOverviewStaticHtml(app)}</div>
 <div id="file-tab" role="tabpanel" aria-labelledby="file-tabs-nav"></div></section>`;
}

/** زر تبويب أساسي ظاهر في الشريط (role=tab) — العدّاد من البيانات الحقيقية للتبويب. */
function tabBtnHtml(app,k,label,icon,count,short){
 const on=app.__fileTab.tab===k;
 const shortLabel=short||label;
 // التسمية القصيرة تُعرض على الشاشات الضيقة فقط (aria-hidden) — الاسم الكامل يبقى في aria-label/title
 return `<button type="button" role="tab" id="ftb-${esc(k)}" data-tab="${esc(k)}" data-section-id="${esc(k)}" aria-controls="file-tab" title="${esc(label)}" aria-label="${esc(label)}${count?` — ${count}`:''}" aria-selected="${on}" class="subtab-btn${on?' active':''}${count?' has-data':''}"><span class="tab-icon" aria-hidden="true">${icon}</span><span class="tab-label">${esc(label)}</span>${shortLabel!==label?`<span class="tab-label-short" aria-hidden="true">${esc(shortLabel)}</span>`:''}${count?` <small>${count}</small>`:''}</button>`;
}

/**
 * عنصر قسم واحد داخل القائمة المنسدلة — هو زر التبويب الحقيقي نفسه (data-tab)، بلا نسخ.
 * بلا data-section-id عن قصد: نظام تخطيط الصفحات يخفي/يرتّب عناصر الأقسام في DOM، وعناصر
 * القائمة مرتّبة أصلًا من tabLayout() — فلا تختفي أي وظيفة ولا يتحرك عنصر بين المجموعات.
 */
function menuItemHtml(app,tabCount,k,l,icon,{hidden=false}={}){
 const count=tabCount(k),onItem=app.__fileTab.tab===k;
 return `<button type="button" role="menuitemradio" aria-checked="${onItem}" class="ux-menu-item ftb-item${onItem?' is-on':''}${count?' has-data':''}${hidden?' is-hidden-section':''}" data-tab="${esc(k)}" data-menu-tab="${esc(k)}" data-group-id="${esc(k)}" aria-controls="file-tab" title="${esc(l)}"><span class="ftb-item-ic" aria-hidden="true">${icon}</span><span class="ftb-item-label">${esc(l)}</span>${count?`<small class="ftb-n">${count}</small>`:''}${hidden?'<small class="ftb-hid">مخفي</small>':''}${onItem?'<span class="ftb-check" aria-hidden="true">✓</span>':''}</button>`;
}

/**
 * القائمة المنسدلة الواحدة لبقية أقسام الملف: زر واحد في الشريط (بجانب التبويبات الأربعة)
 * يفتح كل الأقسام غير الأساسية، مرتّبة بعناوين وظيفية للتقصير فقط. العناصر نفسها هي أزرار
 * التبويبات الحقيقية (data-tab) — لا نسخ ولا أزرار شكلية؛ والقسم المفتوح يُعلَّم
 * بـaria-checked ويظهر اسمه في الزر (is-active) حتى يعرف المحامي أين هو بلا فتح القائمة.
 */
function moreMenuHtml(app,tabCount){
 const {sections,hiddenTabs}=tabLayout();
 const active=app.__fileTab.tab;
 const all=[...sections.flatMap(g=>g.tabs),...hiddenTabs];
 const on=all.some(([id])=>id===active);
 const activeItem=on?all.find(([id])=>id===active):null;
 const body=sections.map(g=>`<section class="ftb-sec" role="group" aria-label="${esc(g.label)}">
    <p class="ftb-sec-title" role="presentation">${esc(g.label)}</p>
    ${g.tabs.map(([k,l,icon])=>menuItemHtml(app,tabCount,k,l,icon)).join('')}
   </section>`).join('');
 const hiddenHtml=hiddenTabs.length?`<section class="ftb-sec ftb-sec-hidden" role="group" aria-label="أقسام مخفية">
    <p class="ftb-sec-title" role="presentation">مخفية من الشريط <small class="muted">— أظهرها من ⚙</small></p>
    ${hiddenTabs.map(([k,l,icon])=>menuItemHtml(app,tabCount,k,l,icon,{hidden:true})).join('')}
   </section>`:'';
 return `<div class="ux-menu-wrap ftb-group ftb-more${on?' is-active':''}" data-group="${MORE_GROUP.id}">
   <button type="button" class="subtab-btn ftb-group-btn ftb-more-btn" data-tab-group="${MORE_GROUP.id}" data-tabs-menu aria-haspopup="menu" aria-expanded="false" aria-controls="${MENU_ID}" aria-current="${on?'true':'false'}" title="كل أقسام الملف — ${all.map(([,l])=>l).join('، ')}" aria-label="${esc(MORE_GROUP.label)}${on&&activeItem?` — المفتوح: ${esc(activeItem[1])}`:''}">
    <span class="tab-icon" aria-hidden="true">${MORE_GROUP.icon}</span><span class="tab-label">${esc(MORE_GROUP.label)}</span><span class="tab-label-short" aria-hidden="true">${esc(MORE_GROUP.short)}</span>${on&&activeItem?`<span class="ftb-active-name">${esc(activeItem[1])}</span>`:''}<span class="ftb-caret" aria-hidden="true">▾</span>
   </button>
   <div class="ux-menu ftb-menu ftb-menu-all" id="${MENU_ID}" role="menu" aria-label="بقية أقسام الملف" hidden>
    <p class="ftb-menu-title" role="presentation">كل أقسام الملف <small class="ftb-n">${all.length}</small></p>
    ${body}${hiddenHtml}
   </div>
  </div>`;
}

/**
 * بطاقة ملخص تنفيذي واحدة داخل «نظرة عامة».
 * ملخص للقراءة فقط: العنوان/البيانات تُبنى من السجل الأصلي، وكل إجراء فيها ينقل إلى
 * السجل نفسه أو إلى تبويبه — لا يوجد هنا أي حقل قابل للتحرير ولا نسخة مستقلة من البيانات.
 * @param {{eyebrow:string,icon?:string,tone?:string,title?:string,meta?:string[],empty?:string,actions?:Array<{label:string,attr:string,kind?:string}>}} o
 */
function execCard({eyebrow,icon='',tone='',title='',meta=[],empty='',actions=[]}){
 const rows=meta.filter(Boolean);
 return `<article class="fx-card${tone?` is-${esc(tone)}`:''}">
  <header class="fx-card-head"><span class="fx-eyebrow">${esc(eyebrow)}</span>${icon?`<span class="fx-ic" aria-hidden="true">${icon}</span>`:''}</header>
  ${title?`<b class="fx-title">${title}</b>`:''}
  ${rows.length?`<p class="fx-meta">${rows.map(m=>`<span>${m}</span>`).join('')}</p>`:''}
  ${empty?`<p class="fx-empty muted small">${esc(empty)}</p>`:''}
  ${actions.length?`<div class="fx-actions">${actions.map(a=>`<button type="button" class="${a.kind==='primary'?'primary small':'ghost small'}" ${a.attr}>${esc(a.label)}</button>`).join('')}</div>`:''}
 </article>`;
}

/** ربط عناصر كتلة الهوية بعد تركيب التبويب — يعمل أيضًا عند فتح رابط عميق ثم العودة للملخص. */
function bindFileIdentityControls(root,app,id,f,openItemsCheck){
 const once=(el,key,fn)=>{
  if(!el||el.dataset[key])return;
  el.dataset[key]='1';el.addEventListener('click',fn);
 };
 const head=root.querySelector('#file-head');
 if(!head)return;
 if(!head.dataset.fileNavBound){bindListNav(root,app,'files');head.dataset.fileNavBound='1'}
 once(head.querySelector('[data-file-edit]'),'fileEditBound',()=>openEntityForm(app,'files',{id}));
 root.querySelectorAll('[data-file-quick]').forEach(b=>once(b,'fileQuickBound',()=>openQuickAdd(app)));
 root.querySelectorAll('[data-party-open]').forEach(b=>once(b,'partyOpenBound',()=>{
  const item=app.__file.headParties?.[Number(b.dataset.partyOpen)];
  if(item)partyActions(app,item.p);
 }));
 head.querySelectorAll('[data-tab-jump]').forEach(b=>once(b,'tabJumpBound',()=>app.__fileGotoTab(b.dataset.tabJump)));
 const numberButton=head.querySelector('[data-file-number-toggle]');
 const numberPopover=head.querySelector('[data-file-number-popover]');
 once(numberButton,'fileNumberBound',()=>{
  const willOpen=numberPopover?.hidden!==false;
  if(numberPopover){
   if(willOpen){numberPopover.textContent=`رقم الملف الفرعي: ${formatFileNumber(f)||'—'}`;numberPopover.hidden=false}
   else numberPopover.hidden=true;
  }
  numberButton?.setAttribute('aria-expanded',String(willOpen));
 });
 root.querySelectorAll('[data-file-copy]').forEach(b=>once(b,'fileCopyBound',()=>copyFileSummary(app)));
 root.querySelectorAll('[data-file-task]').forEach(b=>once(b,'fileTaskBound',async()=>{const {openLinkedTaskForm}=await import('../ui/work-actions.js');openLinkedTaskForm(app,'files',id,{onSaved:async()=>{toast('تمت إضافة المهمة المرتبطة');await reload(app)}})}));
 root.querySelectorAll('[data-file-pin]').forEach(b=>once(b,'filePinBound',async e=>{
  const on=await toggleFavorite({route:'file:'+id,title:`${formatFileNumber(f.fileNumber)||'ملف'} — ${f.title||''}`.trim()},app.ctx?.profile?.id||'');
  e.currentTarget.textContent=on?'★ إلغاء التثبيت':'☆ تثبيت في الرئيسية';
  e.currentTarget.setAttribute('aria-pressed',String(on));
  toast(on?'ثُبّت الملف في الرئيسية':'أُلغي التثبيت');
 }));
 root.querySelectorAll('[data-file-archive]').forEach(b=>once(b,'fileArchiveBound',async()=>{const extra=await openItemsCheck().catch(()=> '');const r=await confirmBox(`أرشفة الملف؟ يبقى الملف وكل بياناته محفوظة ويمكن إعادة فتحه في أي وقت.${extra}`,{okText:'أرشفة',input:true,placeholder:'سبب الأرشفة (اختياري)'});if(!r.ok)return;try{await archiveFile(app.office,id,r.value);toast('تمت الأرشفة');reload(app)}catch(e){toast(userError(e),'error')}}));
 root.querySelectorAll('[data-file-reopen]').forEach(b=>once(b,'fileReopenBound',async()=>{const r=await confirmBox('إعادة فتح الملف؟',{okText:'إعادة فتح',input:true,placeholder:'سبب إعادة الفتح (اختياري)'});if(!r.ok)return;try{await reopenFile(app.office,id,r.value);toast('تمت إعادة فتح الملف');reload(app)}catch(e){toast(userError(e),'error')}}));
 root.querySelectorAll('[data-file-close]').forEach(b=>once(b,'fileCloseBound',async()=>{const extra=await openItemsCheck().catch(()=> '');const r=await confirmBox(`تسجيل انتهاء الملف (حالة إدارية فقط)؟${extra}`,{okText:'إنهاء',input:true,placeholder:'سبب الانتهاء (اختياري)'});if(!r.ok)return;try{await closeFile(app.office,id,{closeReason:r.value});toast('تم تسجيل انتهاء الملف');reload(app)}catch(e){toast(userError(e),'error')}}));
 root.querySelectorAll('[data-file-delete]').forEach(b=>once(b,'fileDeleteBound',async()=>{if(!await confirmBox('حذف منطقي للملف؟ لا يُسمح إذا كان للملف قضايا/مراحل غير محذوفة. البيانات لا تُمحى نهائيًا.',{okText:'حذف منطقي'}))return;try{await deleteEntity(app.office,'files',id);toast('تم الحذف المنطقي');app.go('files')}catch(e){toast(userError(e),'error')}}));
}

/** هوية الملف جزء من «نظرة عامة» فقط؛ تبقى خارج جسم التبويب لتظل أول قسمًا عند طي بقية المحتوى. */
function syncOverviewVisibility(root,app){
 const active=app.__fileTab?.tab==='summary';
 const host=root.querySelector('[data-file-overview-host]');
 if(host){host.hidden=!active;host.setAttribute('aria-hidden',String(!active))}
}

export async function bindFilePage(app,id){
 const root=document.querySelector('#main-content');const {f}=app.__file;
 if(!app.__fileTabCache||app.__fileTabCache.id!==id)app.__fileTabCache={id,map:new Map()};
 root.querySelector('[data-order-file-tabs]')?.addEventListener('click',()=>openPageCustomizer(app,{pageId:'file-details',root,onChanged:()=>{
  if(hiddenSectionIds('file-details').has(app.__fileTab.tab)){app.__fileTab.tab='summary';syncTabBarDom(app);renderTab(app).catch(e=>app.fail(e))}
 }}));
 // وضع التركيز: يختصر العناصر الثانوية دون إخفاء التنبيهات أو تعطيل الإجراءات.
 // انتقل إلى شريط أدوات التبويبات (أداة عرض ثانوية) بدل ازدحام رأس الملف.
 const focusBtn=root.querySelector('[data-file-focus]');
 const applyFocus=on=>{root.classList.toggle('file-focus-mode',on);if(focusBtn){focusBtn.textContent=on?'◉':'◎';focusBtn.setAttribute('aria-pressed',String(on));focusBtn.setAttribute('aria-label',on?'الخروج من وضع التركيز':'وضع التركيز');focusBtn.title=on?'الخروج من وضع التركيز: إظهار العناصر الثانوية':'وضع التركيز: إخفاء العناصر الثانوية مع بقاء التنبيهات والإجراءات'}};
 applyFocus(Boolean(prefs.get(FOCUS_MODE_KEY,false)));
 focusBtn?.addEventListener('click',async()=>{const on=!root.classList.contains('file-focus-mode');applyFocus(on);await prefs.set(FOCUS_MODE_KEY,on)});
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
 // التبديل بين التبويبات: تحديث موضعي مع كاش للتبويبات المحمّلة — بلا إعادة جلب وبلا فقد
 // بيانات النماذج غير المحفوظة (العقد المُخزّن في الكاش يحتفظ بقيم الحقول كما هي).
 const applyTab=async(tab,{scrollTo=''}={})=>{
  if(!TAB_META.has(tab))return false;
  if(tab!==app.__fileTab.tab){
   app.__fileTab.tab=tab;
   writeLastTab(id,tab);
   syncTabBarDom(app);
   await renderTab(app);
   syncOverviewVisibility(root,app);
   bindFileIdentityControls(root,app,id,f,openItemsCheck);
   syncStickyTop(root);
  }
  if(scrollTo)document.querySelector('#file-tab')?.querySelector(scrollTo)?.scrollIntoView?.({block:'start'});
  return true;
 };
 app.__fileApplyTab=applyTab;
 app.__fileGotoTab=tab=>{
  if(!TAB_META.has(tab))return false;
  const base=String(app.route||`file:${id}`).split('?')[0],params=new URLSearchParams(String(app.route||'').split('?')[1]||'');
  params.set('tab',tab);return app.go(`${base}?${params.toString()}`);
 };
 // أزرار التبويبات: الحالة المرئية وعنوان الرجوع يُحدَّثان عبر App.go الحالي.
 root.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>app.__fileGotoTab(b.dataset.tab));
 root.querySelectorAll('[data-menu-tab]').forEach(b=>b.onclick=()=>app.__fileGotoTab(b.dataset.menuTab));
 // القوائم المنسدلة للمجموعات + قائمة «كل الأقسام»: فتح/إغلاق واحد، دعم المؤوس واللمس
 // ولوحة المفاتيح (Enter/Space/↓ للفتح، ↑↓/Home/End داخل القائمة، Escape يُغلق ويعيد التركيز)،
 // وضبط الموضع تلقائيًا حتى لا تُقطع القوائم عند حواف الشاشة (RTL).
 bindTabMenus(root);
 // إزاحة الالتصاق: تُقاس فعليًا (شريط التنقل + شريط الصفحة) وتُعاد عند تغيّر المقاس/الدوران
 syncStickyTop(root);
 let stickyRaf=0;
 const onViewport=()=>{cancelAnimationFrame(stickyRaf);stickyRaf=requestAnimationFrame(()=>{if(document.querySelector('#file-tabs-nav'))syncStickyTop(root)})};
 window.addEventListener('resize',onViewport);
 window.addEventListener('orientationchange',onViewport);
 requestAnimationFrame(()=>syncStickyTop(root));
 syncTabBarDom(app);
 root.querySelectorAll('[data-reclass]').forEach(b=>b.onclick=()=>reclassDialog(app,f));
 await renderTab(app);
 syncOverviewVisibility(root,app);
 bindFileIdentityControls(root,app,id,f,openItemsCheck);
 syncStickyTop(root);
}

// ===== قوائم الأقسام المنسدلة =====
// سلوك واحد لكل القوائم (مجموعات التبويبات + قائمة «كل الأقسام» + ⋯ إجراءات الملف):
// فتح واحد في اللحظة نفسها، إغلاق بالنقر خارجها أو Escape أو بعد الاختيار، تنقل بالأسهم،
// وضبط موضع أفقي (clamp) حتى لا تُقطع القائمة عند حافة الشاشة في RTL.
/** ضبط موضع القائمة داخل إطار العرض: إزاحة أفقية عند الحاجة + حد ارتفاع رأسي. */
function placeTabMenu(menu,trigger){
 menu.style.transform='';
 menu.style.maxHeight='';
 const rect=menu.getBoundingClientRect();
 if(!rect.width)return;
 const pad=8,shot=window.innerWidth;
 let dx=0;
 if(rect.left<pad)dx=pad-rect.left;
 else if(rect.right>shot-pad)dx=(shot-pad)-rect.right;
 if(dx)menu.style.transform=`translateX(${Math.round(dx)}px)`;
 // القائمة الطويلة تُمرَّر داخل حدود الشاشة بدل أن تُقطع أسفلها
 const avail=window.innerHeight-rect.top-pad;
 if(avail>120&&rect.height>avail)menu.style.maxHeight=`${Math.round(avail)}px`;
}
function bindTabMenus(root){
 const menus=[...root.querySelectorAll('.ftb-menu')];
 const closeAll=(except=null)=>menus.forEach(m=>{if(m!==except){m.hidden=true;m.style.transform='';m.style.maxHeight='';m.parentElement?.querySelector('[aria-haspopup="menu"]')?.setAttribute('aria-expanded','false')}});
 const triggers=[...root.querySelectorAll('[data-tab-group],[data-tabs-menu]')];
 triggers.forEach(btn=>{
  if(btn.dataset.tabMenuBound)return;btn.dataset.tabMenuBound='1';
  const menu=(btn.dataset.tabGroup?root.querySelector(`#ftb-menu-${CSS.escape(btn.dataset.tabGroup)}`):btn.nextElementSibling);
  if(!menu)return;
  const close=()=>{menu.hidden=true;menu.style.transform='';menu.style.maxHeight='';btn.setAttribute('aria-expanded','false')};
  const open=()=>{
   closeAll(menu);
   menu.hidden=false;btn.setAttribute('aria-expanded','true');
   placeTabMenu(menu,btn);
   const first=menu.querySelector('.ftb-item:not([disabled]),.ux-menu-item:not([disabled])');
   first?.focus({preventScroll:true});
  };
  btn.addEventListener('click',e=>{e.stopPropagation();menu.hidden?open():close()});
  btn.addEventListener('keydown',e=>{
   if(['ArrowDown','Down','ArrowUp','Up'].includes(e.key)){e.preventDefault();menu.hidden?open():menu.querySelector('.ftb-item')?.focus({preventScroll:true})}
   else if(e.key==='Escape')close();
  });
  menu.addEventListener('click',()=>close());
  menu.addEventListener('keydown',e=>{
   const items=[...menu.querySelectorAll('.ftb-item,.ux-menu-item')].filter(x=>!x.hidden&&!x.disabled);
   const i=items.indexOf(document.activeElement);
   if(e.key==='ArrowDown'||e.key==='Down'){e.preventDefault();items[Math.min(items.length-1,i+1)]?.focus({preventScroll:true})}
   else if(e.key==='ArrowUp'||e.key==='Up'){e.preventDefault();items[Math.max(0,i-1)]?.focus({preventScroll:true})}
   else if(e.key==='Home'){e.preventDefault();items[0]?.focus({preventScroll:true})}
   else if(e.key==='End'){e.preventDefault();items[items.length-1]?.focus({preventScroll:true})}
   else if(e.key==='Escape'){e.preventDefault();close();btn.focus({preventScroll:true})}
   else if(e.key==='Tab')close();
  });
 });
  // إغلاق القوائم عند تغيير حجم النافذة (الموضع المُحسوب يصبح غير صالح) — بلا تغيير أي تفضيل.
 window.addEventListener('resize',()=>closeAll());
}

/**
 * إزاحة الالتصاق لشريط التبويبات أسفل الشرائط الملتصقة الموجودة فعلًا (شريط التنقل +
 * شريط الصفحة العلوي عند وجوده) — بقياس ارتفاعها الثابت (offsetHeight) لا بمواضع متحركة،
 * فلا يعتمد الموضع على مقدار التمرير أبدًا: الشريط يبقى ملتصقًا في مكان واحد من أعلى الشاشة
 * طوال السحب. أي شريط آخر في الصفحة (مثل شريط الهوية المختصر سابقًا) كان يعيد تغذية هذه
 * الإزاحة بموضع متحرك فينزل شريط التبويبات إلى منتصف الشاشة عند التمرير — وقد أُزيل.
 */
function syncStickyTop(root){
 const bar=root.querySelector('.file-tabs-bar');
 if(!bar)return;
 let offset=0;
 for(const sel of ['#sidebar.tn-bar','.topbar']){
  const el=document.querySelector(sel);
  if(!el)continue;
  const st=getComputedStyle(el);
  if(st.display==='none'||st.position!=='sticky')continue; // شريط ثابت (sticky) فقط يشارك الإزاحة
  offset+=el.offsetHeight;
 }
 bar.style.top=`${Math.round(offset)}px`;
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

/** مزامنة شريط التبويبات مع التبويب النشط (بدون إعادة رسم المحتوى) + إبقاء النشط مرئيًا.
 *  تشمل: التبويبات الأساسية، عناصر القوائم المنسدلة، والمجموعة النشطة (اسم القسم المفتوح
 *  يظهر في زر قائمتها) حتى يعرف المحامي أين هو دون فتح القوائم. */
function syncTabBarDom(app){
 const root=document.querySelector('#main-content');if(!root)return;
 const tab=app.__fileTab.tab;
 const row=root.querySelector('.file-subtabs');
 root.querySelectorAll('.file-subtabs [data-tab]').forEach(x=>{
  const on=x.dataset.tab===tab;
  x.classList.toggle('active',on);x.setAttribute('aria-selected',String(on));
  if(on&&row&&x.scrollIntoView)x.scrollIntoView({block:'nearest',inline:'nearest'});
 });
 // القائمة المنسدلة الواحدة: تعليم العنصر المفتوح + إظهار اسمه في زر القائمة.
 const menu=root.querySelector('.ftb-menu-all');
 menu?.querySelectorAll('.ftb-item[data-tab]').forEach(x=>{
  const on=x.dataset.tab===tab;
  x.classList.toggle('is-on',on);x.setAttribute('aria-checked',String(on));
  if(on&&!x.querySelector('.ftb-check')){const c=document.createElement('span');c.className='ftb-check';c.setAttribute('aria-hidden','true');c.textContent='✓';x.append(c)}
  else if(!on)x.querySelector('.ftb-check')?.remove();
 });
 root.querySelectorAll('.ftb-more').forEach(g=>{
  const btn=g.querySelector('.ftb-group-btn');if(!btn)return;
  const item=menu?.querySelector(`.ftb-item[data-tab="${CSS.escape(tab)}"]`)||null;
  const on=Boolean(item);
  g.classList.toggle('is-active',on);
  btn.setAttribute('aria-current',on?'true':'false');
  let chip=btn.querySelector('.ftb-active-name');
  if(on){
   if(!chip){chip=document.createElement('span');chip.className='ftb-active-name';btn.insertBefore(chip,btn.querySelector('.ftb-caret'))}
   chip.textContent=TAB_META.get(tab)||'';
  }else chip?.remove();
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
 // أدوات «فتح/طي الكل» (بطاقة «الأقسام والجداول») لا تُبنى في صفحة الملف: الشريط العلوي
 // يكفي للتنقل، وكل قسم يحتفظ بزر الطي والدبوس الخاص به — بلا عنصر إضافي فوق المحتوى.
 enhanceCollapsiblePanels(main,`file:${app.__file.id}:${tab}`,{bulk:false});
 bindCards(el);
 if(tab==='summary'){bindStagePath(app,app.__file.f,app.__file.stages);bindCockpitOnce(el,app)}
 updateTabShell(app);
 cache.map.set(tab,[...el.childNodes]);
}
async function renderTabContent(app){
 const el=document.querySelector('#file-tab');const {id,f,parties,stages}=app.__file;const tab=app.__fileTab.tab;const office=app.office;
 // كتلة الهوية خارج جسم التبويب: تبقى أول قسم مرئيًا عند طي بقية المحتوى،
 // ولا تُعاد رسمها عند تبديل الأقسام أو فقدان قيمة نموذج غير محفوظ.
 el.innerHTML='<div class="skel-page" role="status" aria-label="جارٍ التحميل"><div class="skel skel-row"><div class="skel-card skel"></div><div class="skel-card skel"></div><div class="skel-card skel"></div><div class="skel-card skel"></div></div><div class="skel skel-block"></div></div>';
 const needStage=what=>`<div class="notice">لإضافة ${what} يجب أولًا إضافة رقم قضائي / مرحلة في تبويب «البيانات القضائية». الملف نفسه لا يحتاج قضية.</div>`;
 if(tab==='summary'){
  // «نظرة عامة» — لوحة متابعة الملف لا نسخة مكررة منه. كل عنصر هنا ملخص مقروء من مصدره
  // الأصلي (الجلسات/الأعمال/المراحل/سجل النشاط) وكل زر يفتح السجل نفسه أو تبويبه، ولا
  // يُنشئ أي سجل أو نسخة قابلة للتحرير، ولا يُخترع رقم أو تاريخ أو حالة غير مسجلة.
  const today=localDate();
  const dayOf=v=>String(v||'').slice(0,10);
  const [hearingResult,procedures,judgmentsRes,relRows]=await Promise.all([
   fileChildren(office,id,'hearings'),
   office.r.procedures.byIndex('fileId',id,2000),
   fileChildren(office,id,'judgments').catch(()=>({rows:[]})),
   fileRelations(office,id).catch(()=>[])
  ]);
  const hearings=hearingResult.rows;
  const upcomingAll=hearings.filter(h=>dayOf(h.hearingDate)>=today).sort((a,b)=>(dayOf(a.hearingDate)+(a.hearingTime||'99')).localeCompare(dayOf(b.hearingDate)+(b.hearingTime||'99')));
  const previousAll=hearings.filter(h=>dayOf(h.hearingDate)<today).sort((a,b)=>(dayOf(b.hearingDate)+(b.hearingTime||'')).localeCompare(dayOf(a.hearingDate)+(a.hearingTime||'')));
  const nextH=upcomingAll[0],lastH=previousAll[0];
  const openProc=procedures.filter(p=>!p.status||['open','pending'].includes(p.status));
  const openUnfinished=openProc.filter(p=>dayOf(p.internalDueDate)<today||!p.result);
  // «آخر عمل إداري مسجل» = أحدث سجل فعلي في مخزن الأعمال (نفس مفتاح الترتيب المستخدم في تبويبه).
  const procSorted=[...procedures].sort((a,b)=>String(b.actionDate||b.internalDueDate||b.createdAt||'').localeCompare(String(a.actionDate||a.internalDueDate||a.createdAt||'')));
  const latestProc=procSorted[0];
  const cur=stages.find(s=>s.id===f.currentStageId)||stages.at(-1);
  const clientParty=parties.find(p=>p.clientId);
  const lastActivity=f.lastActivityAt?fmtDate(dayOf(f.lastActivityAt)):'';
  const sig=nextH?dateSignal(dayOf(nextH.hearingDate)):null;
  // (أ) الملخص التنفيذي: أربع بطاقات ملخص فقط، كل واحدة مرتبطة بمصدرها الأصلي
  const nextCard=nextH?execCard({
   eyebrow:'أقرب جلسة قادمة',icon:'◷',tone:sig?.tone||'',
   title:`${esc(fmtDate(nextH.hearingDate))}${nextH.hearingTime?` <span class="fx-sub">· ${esc(String(nextH.hearingTime).slice(0,5))}</span>`:''}${sig?` <span class="ux-badge ux-badge--${esc(sig.tone)}">${esc(sig.text)}</span>`:''}`,
   meta:[nextH.type,nextH.court,nextH.chamber,nextH.reason?`المطلوب: ${nextH.reason}`:''].filter(Boolean).map(esc),
   actions:[
    {label:'عرض الجلسة',kind:'primary',attr:`data-open="hearings:${esc(nextH.id)}"`},
    {label:`كل الجلسات (${hearings.length})`,attr:'data-tab-jump="hearings"'},
    {label:'دورة الجلسات',attr:`data-hearing-cycle="${esc(nextH.id)}"`}
   ]
  }):execCard({
   eyebrow:'أقرب جلسة قادمة',icon:'◷',
   empty:hearings.length?'لا توجد جلسة قادمة مسجلة؛ كل الجلسات المسجلة سابقة.':'لا توجد جلسات مسجلة لهذا الملف بعد.',
   actions:[{label:'فتح تبويب الجلسات',kind:'primary',attr:'data-tab-jump="hearings"'}]
  });
  const procCard=latestProc?execCard({
   eyebrow:'آخر عمل إداري مسجل',icon:'☷',tone:openUnfinished.length?'warn':'',
   title:esc(latestProc.type||latestProc.description||'عمل إداري'),
   meta:[
    latestProc.description?esc(latestProc.description):'',
    latestProc.actionDate?`تاريخ العمل ${esc(fmtDate(latestProc.actionDate))}`:'',
    latestProc.internalDueDate?`موعد المتابعة ${esc(fmtDate(latestProc.internalDueDate))}`:'',
    latestProc.status?`الحالة: ${esc(label(latestProc.status))}`:'',
    openProc.length?`مفتوحة في الملف: ${openProc.length}`:'',
    openUnfinished.length?`غير مكتملة: ${openUnfinished.length}`:''
   ].filter(Boolean),
   actions:[
    {label:'عرض العمل',kind:'primary',attr:`data-open="procedures:${esc(latestProc.id)}"`},
    {label:`الأعمال (${procedures.length})`,attr:'data-tab-jump="procedures"'}
   ]
  }):execCard({
   eyebrow:'آخر عمل إداري مسجل',icon:'☷',
   empty:'لا توجد أعمال إدارية مسجلة لهذا الملف.',
   actions:[{label:'فتح تبويب الأعمال الإدارية',kind:'primary',attr:'data-tab-jump="procedures"'}]
  });
  const stageCard=cur?execCard({
   eyebrow:'المرحلة الحالية',icon:'▣',
   title:esc(refLabel('cases',cur)),
   meta:[cur.courtId,cur.chamber,cur.degree,cur.filingDate?`تاريخ القيد ${fmtDate(cur.filingDate)}`:'',stages.length>1?`إجمالي المراحل في الملف: ${stages.length}`:''].filter(Boolean).map(esc),
   actions:[
    {label:'فتح بيانات المرحلة',kind:'primary',attr:`data-open-case="${esc(cur.id)}"`},
    {label:`المراحل (${stages.length})`,attr:'data-tab-jump="judicial"'}
   ]
  }):execCard({
   eyebrow:'المرحلة الحالية',icon:'▣',
   empty:'لا توجد مرحلة أو رقم قضائي مسجل (ملف بلا قضية).',
   actions:[{label:'فتح المراحل والأرقام القضائية',kind:'primary',attr:'data-tab-jump="judicial"'}]
  });
  const lastCard=lastH?execCard({
   eyebrow:'الجلسة السابقة',icon:'⌛',
   title:`${esc(fmtDate(lastH.hearingDate))}${lastH.hearingTime?` <span class="fx-sub">· ${esc(String(lastH.hearingTime).slice(0,5))}</span>`:''}`,
   meta:[lastH.type,lastH.result?`القرار: ${lastH.result}`:'لم يُسجل القرار',lastH.adjournedTo?`التأجيل إلى ${fmtDate(lastH.adjournedTo)}`:''].filter(Boolean).map(esc),
   actions:[
    {label:'عرض الجلسة',kind:'primary',attr:`data-open="hearings:${esc(lastH.id)}"`},
    {label:'كل الجلسات',attr:'data-tab-jump="hearings"'}
   ]
  }):execCard({eyebrow:'الجلسة السابقة',icon:'⌛',empty:'لا توجد جلسات سابقة مسجلة.'});
  const execPanel=`<section class="panel fp-exec" data-collapse-id="file-exec" data-collapse-key="file-details:exec" data-collapse-default="open">
   <div class="panel-head"><h3>الملخص التنفيذي</h3><span class="collapse-summary" data-collapse-summary></span></div>
   <div class="fx-grid">${nextCard}${procCard}${stageCard}${lastCard}</div>
   ${fileCockpitHtml({hearings,procedures,stages,parties,today,currentStage:cur?refLabel('cases',cur):''})}
   <p class="fx-foot muted small">
    <span>${lastActivity?`آخر نشاط مسجل: <b>${esc(lastActivity)}</b>`:'لا يوجد نشاط مسجل بعد'}</span>
    ${openUnfinished.length?`<span>متابعات غير مكتملة: <button type="button" class="link" data-tab-jump="procedures">${openUnfinished.length}</button></span>`:''}
    ${clientParty?.clientId?`<span>الموكل المسجل: <button type="button" class="link" data-route="client:${esc(clientParty.clientId)}">${esc(clientParty.name||clientParty.partyName||'')}</button>${clientParty.role?` — ${esc(clientParty.role)}`:''}</span>`:''}
   </p>
   ${hearingResult.more?'<div class="notice" role="status">تعرض هذه الصفحة حتى 5,000 جلسة مرتبطة بالملف. قد توجد سجلات إضافية؛ لم تُحذف أو تُغيّر أي بيانات.</div>':''}
  </section>`;
  // (ب) بيانات الملف فقط — كل حقل من مصدره. بيانات المرحلة/الرقم القضائي وحقول نوع العمل
  // لا تُعرض هنا: مصدرها الوحيد تبويب «المراحل» وتبويب «بيانات نوع العمل» فلا تتكرر المعلومات.
  const refs=new Map();
  // رقم الملف الداخلي لا يُكرر في البيانات التفصيلية؛ مصدره الوحيد زر «الملف الفرعي».
  const fileFields=ENTITIES.files.fields.filter(x=>x.k!=='fileNumber');
  const dataPanel=`<section class="panel fp-data fp-file-data" data-collapse-id="file-file-data" data-collapse-key="file-details:file-data" data-collapse-default="open">
   <div class="panel-head"><h3>بيانات الملف</h3><span class="collapse-summary" data-collapse-summary></span>
    <div class="sec-actions"><button type="button" class="ghost small" data-file-edit2>✎ تعديل بيانات الملف</button><button type="button" class="ghost small" data-reclass>تغيير القسم / النوع</button></div></div>
   <div class="fp-kv">
    ${kvHtml(fileFields,f,refs)}
    ${f.archivedAt?`<p class="muted small">أُرشف في ${fmtDate(f.archivedAt)}${f.archivedReason?' — السبب: '+esc(f.archivedReason):''}</p>`:''}
    ${f.reopenedAt?`<p class="muted small">أُعيد فتحه في ${fmtDate(f.reopenedAt)}${f.reopenReason?' — السبب: '+esc(f.reopenReason):''}</p>`:''}
   </div></section>`;
  // (ج) المسار القضائي: المراحل والعلاقات المسجلة فعلًا، وكل عنصر يفتح سجله الأصلي
  const stagePanel=await stageSequenceHtml(app,{id,f,stages,cur,hearings,procedures,judgments:judgmentsRes.rows,relRows});
  el.innerHTML=`${execPanel}${dataPanel}${stagePanel}
   ${executionStripHtml({summary:executionContextSummary(app.__file.executions||[]),scope:'file',route:`executionCenter?fileId=${encodeURIComponent(id)}`})}`;
  // (د) كل إجراءات «نظرة عامة» تنقل إلى المصدر الأصلي أو إلى تبويبه — بلا كتابة من هنا
  el.querySelector('[data-file-edit2]')?.addEventListener('click',()=>openEntityForm(app,'files',{id}));
  el.querySelectorAll('[data-reclass]').forEach(b=>b.onclick=()=>reclassDialog(app,f));
  el.querySelectorAll('[data-tab-jump]').forEach(b=>b.onclick=()=>app.__fileGotoTab(b.dataset.tabJump));
  el.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>app.go('rec:'+b.dataset.open));
  el.querySelectorAll('[data-open-case]').forEach(b=>b.onclick=()=>app.go('case:'+b.dataset.openCase));
  el.querySelectorAll('[data-open-file]').forEach(b=>b.onclick=()=>app.go('file:'+b.dataset.openFile));
  el.querySelectorAll('[data-hearing-cycle]').forEach(b=>b.onclick=()=>showHearingCycle(app,b.dataset.hearingCycle||nextH?.id||lastH?.id||''));
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

async function partyActions(app,p){
 const store=p.clientId?'clients':p.opponentId?'opponents':'';
 const id=p.clientId||p.opponentId||'';
  const linked=store&&id?await app.office.r[store].get(id).catch(()=>null):null;
  const target=linked&&!linked.isDeleted?linked:null;
  const route=target?entityRoute(store,id):null;
 const unavailable=Boolean(store&&id&&!target);
 const card=modal(`<h2 class="modal-title">${esc(p.name||p.partyName||'طرف')} <small class="muted">${esc(p.role||'')}</small></h2><div class="action-stack">${route?'<button class="primary" data-a="open">فتح سجل الشخص</button>':''}${unavailable?'<p class="muted" role="status">الشخص المرتبط غير متاح حاليًا؛ لم يُفتح سجل بديل.</p>':''}${p.id?'<button class="ghost" data-a="edit">تعديل الصفة / البيانات</button><button class="ghost danger" data-a="remove">إزالة من الملف</button>':'<p class="muted">رابط قديم من الإصدار السابق؛ سيُرحّل تلقائيًا.</p>'}</div>`);
 card.querySelector('[data-a="open"]')?.addEventListener('click',()=>{closeModal();app.go(route)});
 card.querySelector('[data-a="edit"]')?.addEventListener('click',()=>{closeModal();openEntityForm(app,'fileParties',{id:p.id,onSaved:()=>reload(app)})});
 card.querySelector('[data-a="remove"]')?.addEventListener('click',async()=>{closeModal();if(!await confirmBox(`إزالة ${esc(p.name||p.partyName||'الطرف')} من أطراف هذا الملف؟ (سجل الشخص نفسه لا يُحذف)`,{okText:'إزالة'}))return;try{await removeParty(app.office,p.id);toast('تمت الإزالة');reload(app)}catch(e){toast(userError(e),'error')}});
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
