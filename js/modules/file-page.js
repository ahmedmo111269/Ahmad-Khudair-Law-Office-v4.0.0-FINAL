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
import {sectionGrid,openRow} from './list-page.js';
import {userError} from '../core/errors.js';
import {localDate,addDays} from '../core/clock.js';
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
import {registerPageLayout,resolveSectionOrder,hiddenSectionIds,migrateLegacySectionOrder,openPageCustomizer,applyPageLayout,applyPageDisplay} from '../ui/page-layout.js';
import {bindCustomizableComponents} from '../ui/component-customizer.js';
import {notesForEntity,completeQuickNote,deleteQuickNote} from '../services/quick-notes.js';
import {completeItem,reopenItem} from '../services/work-items.js';
import {overlayId} from '../domain/work-items.js';
import {openQuickNoteCapture,openQuickNoteEditor} from './quick-notes.js';
import {openQuickAdd} from './quick-add.js';
import {readStoredSeen,markHomeSeen,sinceChanges} from '../services/home-visit.js';
import {prefs} from '../core/preferences.js';
import {getComponentStyle,setComponentStyle} from '../core/component-style.js';
import {getComponentContent,setComponentContent} from '../core/display-prefs.js';
import {recordFileVisit,updateVisitTab} from '../services/files-admin.js';
import {openFileChecklist,openPreCloseReview,openFieldHistory,openAdminDecisions,openVerifiableSummary,editFileWithReview,openFileComparePicker,openRecentFiles,openFileQuickDrawer} from './files-suite.js';

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
// closed:true — تعريف التبويبات حصري: لا يُدمج فيه ما يُكتشف تلقائيًا من DOM،
// لأن أقسام كل تبويب تُسجَّل في تخطيط خاص بها (file-details:<tab>) أدناه.
registerPageLayout({pageId:'file-details',title:'أقسام الملف القانوني',closed:true,sections:TABS.map(([id,title,icon])=>({id,title,icon,canHide:id!=='summary'}))});

// ===== أقسام كل تبويب (النظام المركزي نفسه، صفحة مستقلة لكل تبويب) =====
// الترتيب والإظهار والإخفاء داخل التبويب يُحفظ في DisplayPreferences تحت
// file-details:<tab> — منفصل تمامًا عن ترتيب التبويبات وعن بقية التبويبات،
// ويُطبَّق بعد كل تركيب تبويب (بما فيه استعادة الكاش) عبر applyFileTabLayout.
const TAB_SECTION_LAYOUTS={
 summary:{title:'أقسام «نظرة عامة»',sections:[
  {id:'summary-cockpit',title:'موقف الملف والخطوة التالية',icon:'◈'},
  {id:'summary-followup',title:'المتابعة القريبة والتنبيهات',icon:'◷'},
  {id:'summary-data',title:'بيانات الملف',icon:'▤'},
  {id:'summary-execution',title:'التنفيذ المرتبط',icon:'＄'},
  {id:'summary-tasks',title:'مهام الملف',icon:'☰'},
 ]},
 hearings:{title:'أقسام «الجلسات»',sections:[
  {id:'hearings-next',title:'الجلسة القادمة',icon:'◷'},
  {id:'hearings-cards',title:'عرض الجلسات (قادمة وسابقة)',icon:'▤'},
  {id:'hearings-grid',title:'جدول الجلسات',icon:'▦'},
 ]},
 procedures:{title:'أقسام «الأعمال الإدارية»',sections:[
  {id:'proc-board',title:'لوحة الأعمال الإدارية',icon:'☷'},
  {id:'proc-grid',title:'جدول الأعمال الإدارية',icon:'▦'},
 ]},
 judicial:{title:'أقسام «المراحل»',sections:[
  {id:'judicial-chain',title:'تسلسل المراحل',icon:'▣'},
  {id:'judicial-grid',title:'جدول المراحل',icon:'▦'},
 ]},
 parties:{title:'أقسام «الأطراف»',sections:[
  {id:'parties-groups',title:'أطراف الملف حسب الصفة',icon:'⚖'},
 ]},
 judgments:{title:'أقسام «الأحكام»',sections:[
  {id:'judgments-grid',title:'جدول الأحكام',icon:'▦'},
 ]},
 serviceRecords:{title:'أقسام «المحضرين والإعلانات»',sections:[
  {id:'service-stats',title:'مؤشرات الإعلانات والإنذارات',icon:'＃'},
  {id:'service-filters',title:'عوامل التصفية السريعة',icon:'◈'},
  {id:'service-grid',title:'جدول الإعلانات',icon:'▦'},
 ]},
 money:{title:'أقسام «الأتعاب والمستندات»',sections:[
  {id:'money-fees',title:'الأتعاب',icon:'＄'},
  {id:'money-documentReferences',title:'المستندات',icon:'▤'},
  {id:'money-powersOfAttorney',title:'التوكيلات المرتبطة',icon:'✓'},
  {id:'money-appointments',title:'المواعيد',icon:'◷'},
  {id:'money-communications',title:'الاتصالات',icon:'✆'},
 ]},
 relations:{title:'أقسام «العلاقات»',sections:[
  {id:'relations-grid',title:'علاقات الملف',icon:'↔'},
 ]},
 typeData:{title:'أقسام «بيانات نوع العمل»',sections:[
  {id:'typedata-form',title:'نموذج بيانات النوع',icon:'▧'},
 ]},
 assets:{title:'أقسام «العقارات والمركبات»',sections:[
  {id:'assets-list',title:'الأصول المرتبطة',icon:'⌂'},
 ]},
 timeline:{title:'أقسام «الخط الزمني»',sections:[
  {id:'timeline-panel',title:'الخط الزمني الموحد',icon:'⏳'},
 ]},
 notes:{title:'أقسام «الملاحظات»',sections:[
  {id:'notes-panel',title:'الملاحظات السريعة المرتبطة',icon:'▤'},
 ]},
 extra:{title:'أقسام «البيانات الإضافية»',sections:[
  {id:'extra-panel',title:'بيانات حسب نوع الملف',icon:'▤'},
 ]},
 activity:{title:'أقسام «سجل النشاط»',sections:[
  {id:'activity-since',title:'تغيّر منذ زيارتك',icon:'≋'},
  {id:'activity-grid',title:'سجل النشاط الكامل',icon:'▦'},
 ]},
};
for(const [tab,def] of Object.entries(TAB_SECTION_LAYOUTS))
 registerPageLayout({pageId:`file-details:${tab}`,title:def.title,sections:def.sections});
const tabPageId=tab=>`file-details:${tab}`;
/** تطبيق ترتيب أقسام التبويب وإظهارها + إعدادات عرض التبويب (خط/كثافة/توزيع) على DOM التبويب الحالي. */
function applyFileTabLayout(app){
 const root=document.querySelector('#main-content');
 const tab=app?.__fileTab?.tab;
 if(!root||!tab||!TAB_SECTION_LAYOUTS[tab])return;
 const body=root.querySelector('#file-tab');
 if(body){
  // إعدادات العرض: بطاقة ← تبويب ← صفحة الملف ← عام ← افتراضي (سلسلة النطاقات)
  applyPageDisplay(body,tabPageId(tab));
  applyPageLayout(root,tabPageId(tab));
 }
}
/** عدد أقسام التبويب المسجلة (لإظهار زر «أقسام هذا التبويب» عند وجوده فعلًا). */
const tabSectionCount=tab=>TAB_SECTION_LAYOUTS[tab]?.sections.length||0;

// ===== ترحيل آمن لتخصيصات لوحات الملف القديمة =====
// الإصدار السابق كان يشتق هوية كل لوحة داخل الملف من معرّف الملف نفسه
// (panel:file-details:<fileId>:<suffix>) فيصبح التخصيص حبيس ملف واحد. المعرّفات
// الآن مستقرة عبر كل الملفات (panel:file:summary:cockpit مثلًا)؛ يُنقل تخصيص
// المستخدم القديم مرة واحدة لكل ملف إلى المعرّف المستقر — لا يُفقد أي تفضيل محفوظ،
// ومن ليس له تفضيل قديم لا يتأثر إطلاقًا.
const LEGACY_PANEL_MIGRATIONS=[
 ['file-exec','panel:file:summary:cockpit'],
 ['file-file-data','panel:file:summary:data'],
 ['file-work','panel:file:summary:tasks'],
];
const legacyMigrationKey=fileId=>`ui:file-panels-v2:${fileId}`;
function migrateLegacyFilePanelPrefs(app,fileId){
 try{
  if(prefs.get(legacyMigrationKey(fileId),false))return;
  prefs.set(legacyMigrationKey(fileId),true);
  const oldPrefix=`panel:file-details:${fileId}:`;
  const oldSectionPrefix=`section:file-details:${fileId}:`;
  const pairs=[...LEGACY_PANEL_MIGRATIONS,['__exec_strip','panel:file:summary:execution']];
  for(const [suffix,newId] of pairs){
   const oldId=suffix==='__exec_strip'?`${oldSectionPrefix}execution`:`${oldPrefix}${suffix}`;
   const oldStyle=getComponentStyle(oldId);
   if(oldStyle&&Object.keys(oldStyle).length&&!Object.keys(getComponentStyle(newId)||{}).length)
    setComponentStyle(newId,oldStyle);
   const oldContent=getComponentContent(oldId);
   const newContent=getComponentContent(newId);
   if((oldContent.order.length||oldContent.hidden.length)&&!newContent.order.length&&!newContent.hidden.length)
    setComponentContent(newId,oldContent);
  }
 }catch{ /* تفضيلات عرض فقط: أي فشل يترك الوضع الافتراضي سليمًا */ }
}
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
const HEAD_PARTIES_MAX=3;
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
     ${head?.sub?`<p class="fid-sub">عنوان الملف: ${esc(head.sub)}</p>`:!head?.isCase?`<p class="fid-sub">${esc(ftype?.name||f.fileType||'')} — لا توجد أرقام قضائية مسجلة (ملف بلا قضية)</p>`:''}
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
        <div class="ux-menu-sep" role="separator"></div>
        <button type="button" role="menuitem" class="ux-menu-item" data-file-summary>◈ ملخص إداري قابل للتحقق</button>
        <button type="button" role="menuitem" class="ux-menu-item" data-file-checklist>☑ قائمة التحقق الإدارية</button>
        <button type="button" role="menuitem" class="ux-menu-item" data-file-history>≋ سجل تغيّر الحقول</button>
        <button type="button" role="menuitem" class="ux-menu-item" data-file-decisions>✎ القرارات الإدارية</button>
        <button type="button" role="menuitem" class="ux-menu-item" data-file-compare>⇄ مقارنة مع ملف آخر</button>
        <button type="button" role="menuitem" class="ux-menu-item" data-file-recent>◷ آخر الملفات والزيارات</button>
        <button type="button" role="menuitem" class="ux-menu-item" data-file-preview>◉ معاينة سريعة</button>
        ${f.isArchived||closed?'<button type="button" role="menuitem" class="ux-menu-item" data-file-reopen>إعادة فتح</button>':'<button type="button" role="menuitem" class="ux-menu-item" data-file-close>إنهاء الملف</button><button type="button" role="menuitem" class="ux-menu-item" data-file-archive>أرشفة</button>'}
        <button type="button" role="menuitem" class="ux-menu-item is-danger" data-file-delete>حذف منطقي للملف</button>
       </div>
      </div>
     </div>
     <p class="badges fid-badges">${f.needsClassification?'<button class="badge warn" data-reclass title="تم تصنيف الملف تلقائيًا من بيانات قديمة">⚠ راجع التصنيف</button>':''}${head?.isCase&&v.cur?`<button type="button" class="badge stage" data-route="case:${esc(v.cur.id)}" title="فتح بيانات المرحلة المسجلة في هذا الملف" aria-label="فتح المرحلة: ${esc(refLabel('cases',v.cur))}">المرحلة: ${esc(v.cur.stageType||v.cur.numberType||'—')}</button>`:''}${f.isArchived?`<span class="badge warn">مؤرشف${f.archivedReason?' — '+esc(f.archivedReason):''}</span>`:''}${f.priority&&f.priority!=='normal'?`<span class="badge warn">${esc(label(f.priority))}</span>`:''}${f.responsibleLawyer?`<span class="badge">المحامي: ${esc(f.responsibleLawyer)}</span>`:''}</p>
    </div>
   </div>
   <div class="fid-bottom">
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
 // زيارة الملف تفضيل محلي (آخر فتح) فقط؛ لا تُسجَّل كحدث قانوني ولا تمس سجل النشاط.
 try{recordFileVisit(id,{tab:routeTab(app)||'summary',scope:app.ctx?.profile?.id||'',title:`${formatFileNumber(f.fileNumber)||'ملف'} — ${f.title||''}`.trim(),lastActivityAt:f.lastActivityAt||''})}catch{}
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
   <button type="button" class="ghost icon-only" data-order-tab-sections${tabSectionCount(app.__fileTab.tab)>1?'':' hidden'} title="ترتيب أقسام هذا التبويب وإظهارها — تخصيص مستقل لكل تبويب" aria-label="تخصيص أقسام هذا التبويب">☰</button>
   <button type="button" class="ghost icon-only" data-order-file-tabs title="ترتيب تبويبات الملف وإظهارها وإعدادات العرض" aria-label="تخصيص الصفحة">⚙</button>
  </div>
 </nav>
 <section class="panel file-tab-shell" data-section-id="file-tab-body" data-uxc-id="panel:file:shell" data-collapse-id="file-tab-body" data-collapse-key="file-details:tab-body" data-collapse-default="open"><div class="panel-head"><h3 data-tab-shell-title>${esc(TAB_META.get(app.__fileTab.tab)||'المحتوى')}</h3><span class="collapse-summary" data-collapse-summary></span></div>
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

/** ربط عناصر كتلة الهوية بعد تركيب التبويب — يعمل أيضًا عند فتح رابط عميق ثم العودة للملخص. */
function bindFileIdentityControls(root,app,id,f,openItemsCheck){
 const once=(el,key,fn)=>{
  if(!el||el.dataset[key])return;
  el.dataset[key]='1';el.addEventListener('click',fn);
 };
 const head=root.querySelector('#file-head');
 if(!head)return;
 once(head.querySelector('[data-file-edit]'),'fileEditBound',()=>editFileWithReview(app,id));
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
 // أدوات إدارة الملف: كلها قراءة/تفضيلات أو كتابة عبر خدمة الإدارة الجديدة (settings)،
 // ولا تعدّل سجلات الملف إلا عبر النماذج الأصلية بعد مراجعة أثر صريحة.
 root.querySelectorAll('[data-file-summary]').forEach(b=>once(b,'fileSummaryBound',()=>openVerifiableSummary(app,id)));
 root.querySelectorAll('[data-file-checklist]').forEach(b=>once(b,'fileChecklistBound',()=>openFileChecklist(app,id)));
 root.querySelectorAll('[data-file-history]').forEach(b=>once(b,'fileHistoryBound',()=>openFieldHistory(app,id)));
 root.querySelectorAll('[data-file-decisions]').forEach(b=>once(b,'fileDecisionsBound',()=>openAdminDecisions(app,id)));
 root.querySelectorAll('[data-file-compare]').forEach(b=>once(b,'fileCompareBound',()=>openFileComparePicker(app)));
 root.querySelectorAll('[data-file-recent]').forEach(b=>once(b,'fileRecentBound',()=>openRecentFiles(app)));
 root.querySelectorAll('[data-file-preview]').forEach(b=>once(b,'filePreviewBound',()=>openFileQuickDrawer(app,id)));
 root.querySelectorAll('[data-file-task]').forEach(b=>once(b,'fileTaskBound',async()=>{const {openLinkedTaskForm}=await import('../ui/work-actions.js');openLinkedTaskForm(app,'files',id,{onSaved:async()=>{toast('تمت إضافة المهمة المرتبطة');await reload(app)}})}));
 root.querySelectorAll('[data-file-pin]').forEach(b=>once(b,'filePinBound',async e=>{
  const on=await toggleFavorite({route:'file:'+id,title:`${formatFileNumber(f.fileNumber)||'ملف'} — ${f.title||''}`.trim()},app.ctx?.profile?.id||'');
  e.currentTarget.textContent=on?'★ إلغاء التثبيت':'☆ تثبيت في الرئيسية';
  e.currentTarget.setAttribute('aria-pressed',String(on));
  toast(on?'ثُبّت الملف في الرئيسية':'أُلغي التثبيت');
 }));
 root.querySelectorAll('[data-file-archive]').forEach(b=>once(b,'fileArchiveBound',async()=>{await openPreCloseReview(app,id,{mode:'archive',onDone:()=>reload(app)})}));
 root.querySelectorAll('[data-file-reopen]').forEach(b=>once(b,'fileReopenBound',async()=>{const r=await confirmBox('إعادة فتح الملف؟',{okText:'إعادة فتح',input:true,placeholder:'سبب إعادة الفتح (اختياري)'});if(!r.ok)return;try{await reopenFile(app.office,id,r.value);toast('تمت إعادة فتح الملف');reload(app)}catch(e){toast(userError(e),'error')}}));
 root.querySelectorAll('[data-file-close]').forEach(b=>once(b,'fileCloseBound',async()=>{await openPreCloseReview(app,id,{mode:'close',onDone:()=>reload(app)})}));
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
 migrateLegacyFilePanelPrefs(app,id);
 root.querySelector('[data-order-file-tabs]')?.addEventListener('click',()=>openPageCustomizer(app,{pageId:'file-details',root,onChanged:()=>{
  if(hiddenSectionIds('file-details').has(app.__fileTab.tab)){app.__fileTab.tab='summary';syncTabBarDom(app);renderTab(app).catch(e=>app.fail(e))}
 }}));
 // تخصيص أقسام التبويب الحالي (ترتيب/إظهار/إخفاء/طي/تثبيت + إعدادات عرض التبويب):
 // نفس نافذة «تخصيص الصفحة» المركزية لكن بنطاق مستقل file-details:<tab> — لا يمس
 // ترتيب التبويبات ولا بقية التبويبات، ويُحفظ فورًا في DisplayPreferences.
 const tabCustomizeBtn=root.querySelector('[data-order-tab-sections]');
 const syncTabCustomizeBtn=()=>{const n=tabSectionCount(app.__fileTab?.tab);if(tabCustomizeBtn)tabCustomizeBtn.hidden=n<=1};
 tabCustomizeBtn?.addEventListener('click',()=>{
  const tab=app.__fileTab?.tab;
  if(!tab||!TAB_SECTION_LAYOUTS[tab])return;
  openPageCustomizer(app,{pageId:tabPageId(tab),root,onChanged:detail=>{
   // الترتيب/الإظهار يُطبَّقان فورًا على DOM التبويب الحالي (نقل عناصر فقط)
   applyFileTabLayout(app);
   if(detail?.type==='visibility')toast(detail.hidden?'أُخفي القسم — بياناته سليمة ويمكن إظهاره من هنا دائمًا':'أُظهر القسم');
  }});
 });
 app.__syncTabCustomizeBtn=syncTabCustomizeBtn;
 syncTabCustomizeBtn();
 // تحديث موضعي لتبويب واحد بعد حفظ/تعديل/إنجاز: يُصفَّر كاش التبويب المعني فقط ثم
 // يُعاد تركيبه إن كان هو المعروض — بلا إعادة بناء الصفحة كلها وبلا فقد كاش بقية التبويبات.
 app.__fileRefreshTab=async tab=>{
  if(!app.route||!String(app.route).startsWith('file:'))return app.refresh();
  if(!TAB_META.has(tab))return app.refresh();
  app.__fileTabCache?.map?.delete?.(tab);
  if(app.__fileTab?.tab!==tab)return;
  await renderTab(app);
  return true;
 };
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
   const [hearingsRes,procedures]=await Promise.all([fileChildren(app.office,id,'hearings'),app.office.r.procedures.byIndex('fileId',id,2000)]);
   const cur=app.__file.stages.find(s=>s.id===app.__file.f.currentStageId)||app.__file.stages.at(-1);
   const today=localDate();
   const tpl=document.createElement('template');
   tpl.innerHTML=fileCockpitHtml({hearings:hearingsRes.rows,procedures,stages:app.__file.stages,parties:app.__file.parties,today,currentStage:cur?refLabel('cases',cur):''}).trim();
   sec.replaceWith(tpl.content.firstElementChild);
   bindCockpitOnce(root,app);
   root.querySelectorAll('.cp-fc [data-route]').forEach(b=>b.onclick=()=>app.go(b.dataset.route));
   root.querySelector('[data-cp-task]')?.addEventListener('click',()=>root.querySelector('[data-file-task]')?.click());
   // بيانات القمرة/المتابعة تغيّرت: كاش الملخص يُصفَّر حتى لا تبقى أعداد قديمة عند العودة له،
   // وإن كانت نظرة عامة معروضة الآن تُعاد تركيبها فورًا بالبيانات الجديدة (تحديث موضعي).
   app.__fileTabCache?.map?.delete?.('summary');
   if(app.__fileTab?.tab==='summary'){
    await renderTab(app);
    window.scrollTo(0,scrollY);
   }
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
   app.__syncTabCustomizeBtn?.();
  }
  if(scrollTo)document.querySelector('#file-tab')?.querySelector(scrollTo)?.scrollIntoView?.({block:'start'});
  return true;
 };
 app.__fileApplyTab=applyTab;
 app.__fileGotoTab=tab=>{
  if(!TAB_META.has(tab))return false;
  const base=String(app.route||`file:${id}`).split('?')[0],params=new URLSearchParams(String(app.route||'').split('?')[1]||'');
  params.set('tab',tab);
  try{updateVisitTab(id,tab,{scope:app.ctx?.profile?.id||''})}catch{}
  return app.go(`${base}?${params.toString()}`);
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
async function partyGroupsHtml(parties){
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

// ===== دوال عرض تشغيلية نقية (تبويبات الجلسات والأعمال ونظرة عامة) =====
// كلها تُبنى من الحقول المسجلة فعلًا فقط: لا تاريخ مُختلَق، ولا حالة مستنتجة،
// ولا استخدام لتاريخ الإنشاء بديلًا عن تاريخ الاستحقاق.
const dayOf=v=>String(v||'').slice(0,10);
const isHearingDone=h=>Boolean(h.result);
/** تقسيم الجلسات: القادمة (تاريخ ≥ اليوم وبلا نتيجة مسجلة) مقابل السابقة/المنتهية. */
export function splitHearings(rows,today){
 const upcoming=[],past=[];
 for(const h of rows||[]){
  const d=dayOf(h.hearingDate);
  if(d&&!isHearingDone(h)&&d>=today)upcoming.push(h);else past.push(h);
 }
 const byDate=(a,b)=>(dayOf(a.hearingDate)+(a.hearingTime||'')).localeCompare(dayOf(b.hearingDate)+(b.hearingTime||''));
 upcoming.sort(byDate);
 past.sort((a,b)=>byDate(b,a));
 return {upcoming,past};
}
/** مرشحات الجلسات العملية — من الحقول المتاحة فعلًا في سجل الجلسة. */
export const HEARING_FILTERS=Object.freeze([
 ['all','الكل',()=>true],
 ['upcoming','القادمة',(h,t)=>dayOf(h.hearingDate)&&!isHearingDone(h)&&dayOf(h.hearingDate)>=t],
 ['past','السابقة',(h,t)=>!(dayOf(h.hearingDate)&&!isHearingDone(h)&&dayOf(h.hearingDate)>=t)],
 ['noResult','بلا قرار',h=>!h.result],
 ['noDate','بلا تاريخ',h=>!dayOf(h.hearingDate)],
 ['adjourned','مؤجلة',h=>Boolean(h.adjournedTo)],
]);
const hearingFilterFn=k=>HEARING_FILTERS.find(([key])=>key===k)?.[2]||HEARING_FILTERS[0][2];
/** حالة العمل الإداري الفعلية من الحقل المسجل (open/pending/done/cancelled). */
const procStatusOf=p=>String(p?.status||'open');
const PROC_STATUS_LABELS={open:'مفتوح',pending:'قيد الانتظار',done:'تم',cancelled:'ملغي'};
const procStatusLabel=p=>PROC_STATUS_LABELS[procStatusOf(p)]||procStatusOf(p);
const procIsActive=p=>['open','pending'].includes(procStatusOf(p));
/** تجميع الأعمال الإدارية وفق حالتها المسجلة، مع تمييز المتأخر (موعد متابعة مسجل وانقضى) فقط. */
export function groupProcedures(rows,today){
 const groups={overdue:[],open:[],done:[],cancelled:[]};
 for(const p of rows||[]){
  const status=procStatusOf(p);
  if(status==='done')groups.done.push(p);
  else if(status==='cancelled')groups.cancelled.push(p);
  else{
   const due=dayOf(p.internalDueDate);
   // متأخر = موعد متابعة مسجل فعلًا وانقضى والعمل ما زال مفتوحًا/قيد الانتظار.
   // بلا موعد متابعة: مفتوح بلا ترتيب زمني مفترض — لا يُختلق له استحقاق.
   if(due&&due<today)groups.overdue.push(p);else groups.open.push(p);
  }
 }
 const byDueAsc=(a,b)=>(dayOf(a.internalDueDate)||'9999-12-31').localeCompare(dayOf(b.internalDueDate)||'9999-12-31')||String(b.createdAt||'').localeCompare(String(a.createdAt||''));
 const byDateDesc=(a,b)=>String(b.actionDate||b.internalDueDate||b.createdAt||'').localeCompare(String(a.actionDate||a.internalDueDate||a.createdAt||''));
 groups.overdue.sort(byDueAsc);
 groups.open.sort(byDueAsc);
 groups.done.sort(byDateDesc);
 groups.cancelled.sort(byDateDesc);
 return groups;
}
/** مرشحات الأعمال الإدارية — حقول مسجلة فقط (موعد المتابعة، الحالة). */
export const PROCEDURE_FILTERS=Object.freeze([
 ['all','الكل',()=>true],
 ['active','مفتوحة وقيد المتابعة',p=>procIsActive(p)],
 ['overdue','متأخرة',p=>procIsActive(p)&&dayOf(p.internalDueDate)&&dayOf(p.internalDueDate)<todayLocal()],
 ['today','مستحقة اليوم',p=>procIsActive(p)&&dayOf(p.internalDueDate)===todayLocal()],
 ['week','خلال 7 أيام',p=>{const d=dayOf(p.internalDueDate);if(!d||!procIsActive(p))return false;const t=todayLocal();return d>=t&&d<=addDaysLocal(t,7)}],
 ['done','مكتملة',p=>procStatusOf(p)==='done'],
 ['cancelled','ملغاة',p=>procStatusOf(p)==='cancelled'],
 ['noDue','بلا موعد متابعة',p=>procIsActive(p)&&!dayOf(p.internalDueDate)],
]);
function todayLocal(){return localDate()}
function addDaysLocal(date,days){return addDays(date,days)}
const procedureFilterFn=k=>PROCEDURE_FILTERS.find(([key])=>key===k)?.[2]||PROCEDURE_FILTERS[0][2];
/** أقصى بطاقات أعمال معروضة لكل مجموعة: فوق ذلك يُكمل الجدول الصورة (أداء بلا زحام). */
const PROC_CARDS_MAX=50;
/** تنبيهات تشغيلية من البيانات المسجلة فقط — كل تنبيه يقود إلى مصدره، ولا تُختلق قواعد قانونية. */
export function fileAttentionAlerts({f,parties,stages,hearings,procedures,today}){
 const alerts=[];
 const openProcs=(procedures||[]).filter(procIsActive);
 const overdue=openProcs.filter(p=>dayOf(p.internalDueDate)&&dayOf(p.internalDueDate)<today);
 const upcomingHearings=(hearings||[]).filter(h=>dayOf(h.hearingDate)&&!isHearingDone(h)&&dayOf(h.hearingDate)>=today);
 const hearingToday=upcomingHearings.some(h=>dayOf(h.hearingDate)===today);
 const closed=isClosedFile(f);
 if(hearingToday)alerts.push({tone:'danger',text:'لديك جلسة مسجلة اليوم',action:'عرض الجلسات',tab:'hearings'});
 if(overdue.length)alerts.push({tone:'danger',text:`أعمال إدارية متأخرة (${overdue.length}) — أقربها موعده ${fmtDate(overdue[0].internalDueDate)||'غير مسجل'}`,action:'متابعة الأعمال',tab:'procedures'});
 if(!parties.length)alerts.push({tone:'warn',text:'لا يوجد أطراف مرتبطون بهذا الملف بعد',action:'إضافة طرف',tab:'parties'});
 if(!stages.length)alerts.push({tone:'info',text:'لا توجد أرقام قضائية / مراحل مسجلة (الملف قد لا يحتاج قضية)',action:'إضافة مرحلة',tab:'judicial'});
 if(!f.responsibleLawyer)alerts.push({tone:'info',text:'لا يوجد محامٍ مسؤول مسجل لهذا الملف',action:'تعديل البيانات',editFile:true});
 if(closed&&(upcomingHearings.length||openProcs.length))
  alerts.push({tone:'warn',text:`الملف منتهٍ/مؤرشف وما زال به ${upcomingHearings.length?`${upcomingHearings.length} جلسة قادمة`:''}${upcomingHearings.length&&openProcs.length?' و':''}${openProcs.length?`${openProcs.length} عملًا مفتوحًا`:''}`,action:'مراجعة الموقف',tab:'summary'});
 return alerts;
}
/** بطاقة جلسة واحدة (قالب مشترك: حقولها قابلة للإظهار/الإخفاء/الترتيب مرة واحدة لكل البطاقات). */
function hearingCardHtml(h,{stageLabel='',isNext=false}={}){
 const d=dayOf(h.hearingDate);
 return `<article class="hrc-card${isNext?' is-next':''}${d&&d===todayLocal()?' is-today':''}" data-uxc-id="tpl:file:hearing:card" data-uxc-type="card" data-uxc-title="بطاقة جلسة" data-hearing-card="${esc(h.id)}">
  <div class="hrc-when" data-display-item="field:hearingDate" data-display-label="تاريخ ووقت الجلسة">
   <time>${d?fmtDate(h.hearingDate):'<span class="muted">بلا تاريخ مسجل</span>'}</time>
   ${h.hearingTime?`<span class="hrc-time" data-display-item="field:hearingTime" data-display-label="وقت الجلسة">${esc(String(h.hearingTime).slice(0,5))}</span>`:`<span class="hrc-time muted" data-display-item="field:hearingTime" data-display-label="وقت الجلسة">—</span>`}
  </div>
  <div class="hrc-main">
   <b class="hrc-type" data-display-item="field:type" data-display-label="نوع الجلسة">${esc(h.type||h.reason||'جلسة')}</b>
   <span class="hrc-court" data-display-item="field:court" data-display-label="المحكمة والدائرة">${esc([h.court,h.chamber].filter(Boolean).join(' · ')||'—')}</span>
   ${stageLabel?`<button type="button" class="hrc-stage" data-display-item="field:caseId" data-display-label="المرحلة القضائية" data-open-case="${esc(h.caseId)}" title="فتح المرحلة المرتبطة">${esc(stageLabel)}</button>`:h.caseId?`<span class="hrc-stage muted" data-display-item="field:caseId" data-display-label="المرحلة القضائية">مرحلة غير متاحة</span>`:''}
  </div>
  <div class="hrc-side">
   <span class="hrc-result ${h.result?'':'is-missing'}" data-display-item="field:result" data-display-label="القرار">${h.result?esc(h.result):'لم يُسجَّل قرار بعد'}</span>
   ${h.adjournedTo?`<span class="hrc-adjourn" data-display-item="field:adjournedTo" data-display-label="التأجيل إلى">تأجيل إلى ${fmtDate(h.adjournedTo)}</span>`:''}
   ${h.status?`<span class="badge" data-display-item="field:status" data-display-label="حالة الجلسة">${esc(label(h.status))}</span>`:''}
  </div>
  <div class="hrc-actions" data-display-ignore>
   <button type="button" class="ghost small" data-open="hearings:${esc(h.id)}">فتح السجل</button>
   <button type="button" class="ghost small" data-hearing-edit="${esc(h.id)}">تعديل</button>
  </div>
 </article>`;
}
/** بطاقة عمل إداري واحدة (قالب مشترك قابل للتخصيص مثل بطاقة الجلسة). */
function procedureCardHtml(p,{stageLabel=''}={}){
 const overdue=procIsActive(p)&&dayOf(p.internalDueDate)&&dayOf(p.internalDueDate)<todayLocal();
 return `<article class="prc-card${overdue?' is-overdue':''}" data-uxc-id="tpl:file:procedure:card" data-uxc-type="card" data-uxc-title="بطاقة عمل إداري" data-proc-card="${esc(p.id)}">
  <div class="prc-head">
   <b class="prc-type" data-display-item="field:type" data-display-label="نوع العمل">${esc(p.type||'عمل إداري')}</b>
   <span class="badge prc-status prc-status--${esc(procStatusOf(p))}" data-display-item="field:status" data-display-label="الحالة">${esc(procStatusLabel(p))}</span>
  </div>
  <p class="prc-desc" data-display-item="field:description" data-display-label="الوصف">${esc(p.description||'بلا وصف مسجل')}</p>
  <div class="prc-meta">
   ${dayOf(p.actionDate)?`<span data-display-item="field:actionDate" data-display-label="تاريخ العمل">تاريخ العمل: ${fmtDate(p.actionDate)}</span>`:''}
   <span class="${overdue?'is-overdue':''}" data-display-item="field:internalDueDate" data-display-label="موعد المتابعة">${dayOf(p.internalDueDate)?`${overdue?'متأخر — موعد المتابعة':'موعد المتابعة'}: ${fmtDate(p.internalDueDate)}`:'بلا موعد متابعة مسجل'}</span>
   ${p.priority&&p.priority!=='normal'?`<span data-display-item="field:priority" data-display-label="الأولوية">${esc(label(p.priority))}</span>`:''}
   ${p.assignedTo?`<span data-display-item="field:assignedTo" data-display-label="المكلّف">${esc(p.assignedTo)}</span>`:''}
   ${stageLabel?`<button type="button" class="prc-stage" data-display-item="field:caseId" data-display-label="المرحلة المرتبطة" data-open-case="${esc(p.caseId)}" title="فتح المرحلة المرتبطة">${esc(stageLabel)}</button>`:''}
  </div>
  ${p.result?`<p class="prc-result" data-display-item="field:result" data-display-label="النتيجة">النتيجة: ${esc(p.result)}</p>`:`<p class="prc-result is-missing" data-display-item="field:result" data-display-label="النتيجة">${procStatusOf(p)==='done'?'أُنجز دون نتيجة مسجلة':'لم تُسجَّل نتيجة بعد'}</p>`}
  <div class="prc-actions" data-display-ignore>
   <button type="button" class="ghost small" data-open="procedures:${esc(p.id)}">فتح السجل</button>
   <button type="button" class="ghost small" data-proc-edit="${esc(p.id)}">تعديل</button>
   ${procIsActive(p)?`<button type="button" class="ghost small prc-done" data-complete-proc="${esc(p.id)}" title="تسجيل إنجاز العمل دون مغادرة الصفحة">✓ تم</button>`:''}
  </div>
 </article>`;
}

// ===== ربط المكونات التشغيلية الجديدة (نظرة عامة / الجلسات / الأعمال) =====
/** إضافة جلسة سريعة: تتطلب مرحلة مسجلة (كما في تبويب الجلسات) — وإلا تقود إليها مباشرة. */
function quickAddHearing(app,{id,stages,f}){
 if(!stages.length){toast('إضافة الجلسة تحتاج أولًا رقمًا قضائيًا / مرحلة في تبويب «المراحل»','warn');app.__fileGotoTab('judicial');return}
 const cur=stages.find(s=>s.id===f.currentStageId)||stages.at(-1);
 openEntityForm(app,'hearings',{stageOptions:stageOptions(stages),preset:{caseId:cur?.id||'',fileId:id,court:cur?.courtId||'',chamber:cur?.chamber||''},onSaved:()=>reload(app)});
}
/** ربط الإجراءات السريعة في «نظرة عامة»: نقرة واحدة لكل إضافة يومية شائعة. */
function bindSummaryQuickActions(el,app,{id,stages,f}){
 el.querySelectorAll('[data-quick-hearing]').forEach(b=>b.onclick=()=>quickAddHearing(app,{id,stages,f}));
 el.querySelectorAll('[data-quick-procedure]').forEach(b=>b.onclick=()=>openEntityForm(app,'procedures',{preset:{fileId:id},stageOptions:stageOptions(stages),onSaved:()=>reload(app)}));
 el.querySelectorAll('[data-quick-party]').forEach(b=>b.onclick=()=>openEntityForm(app,'fileParties',{preset:{fileId:id},onSaved:()=>reload(app)}));
 el.querySelectorAll('[data-quick-note]').forEach(b=>b.onclick=()=>openQuickNoteCapture(app,{context:[{entityType:'LEGAL_FILE',entityId:id}],onSaved:()=>reload(app)}));
 el.querySelectorAll('[data-quick-task]').forEach(b=>b.onclick=async()=>{const {openLinkedTaskForm}=await import('../ui/work-actions.js');openLinkedTaskForm(app,'files',id,{onSaved:async()=>{toast('تمت إضافة المهمة المرتبطة');await reload(app)}})});
}
/** تطبيق مرشح الجلسات على البطاقات وعلى الجدول معًا — بلا استعلام جديد. */
function applyHearingFilter(root,kind){
 const state=root.__hearingBoardState;
 if(!state)return;
 const fn=hearingFilterFn(kind);
 const predicate=h=>fn(h,state.today);
 const rows=state.rows.filter(predicate);
 root.querySelectorAll('[data-hearing-card]').forEach(card=>{card.hidden=!predicate(state.byId.get(card.dataset.hearingCard)||{})});
 root.querySelectorAll('.hrc-group').forEach(g=>{const cards=[...g.querySelectorAll('[data-hearing-card]')];g.hidden=!cards.some(c=>!c.hidden);const count=g.querySelector('.count');if(count)count.textContent=String(cards.filter(c=>!c.hidden).length)});
 const counter=root.querySelector('[data-hrc-filter-count]');
 if(counter)counter.textContent=kind==='all'?'لا توجد فلاتر نشطة':`فلتر نشط · ${HEARING_FILTERS.find(([k])=>k===kind)?.[1]||kind} (${rows.length})`;
 root.querySelectorAll('[data-hrc-filter]').forEach(b=>{const on=b.dataset.hrcFilter===kind;b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on))});
 state.grid?.setRows?.(rows);
}
/** ربط بطاقات الجلسات: فتح/تعديل/مرحلة + المرشحات + تخصيص حقول القالب المشترك. */
function bindHearingCards(el,app,{rows,today,stages}){
 const byId=new Map(rows.map(h=>[h.id,h]));
 el.__hearingBoardState={rows,today,byId,grid:el.__hearingBoardState?.grid||null};
 el.querySelectorAll('[data-hrc-filter]').forEach(b=>b.onclick=()=>applyHearingFilter(el,b.dataset.hrcFilter));
 el.querySelectorAll('[data-hearing-card] [data-open]').forEach(b=>b.onclick=()=>app.go('rec:'+b.dataset.open));
 el.querySelectorAll('[data-hearing-edit]').forEach(b=>b.onclick=()=>openEntityForm(app,'hearings',{id:b.dataset.hearingEdit,stageOptions:stageOptions(stages),onSaved:()=>reload(app)}));
 el.querySelectorAll('.hrc-stage[data-open-case]').forEach(b=>b.onclick=()=>app.go('case:'+b.dataset.openCase));
 // تخصيص حقول بطاقة الجلسة (قالب مشترك): اللوحة المركزية نفسها على أول بطاقة،
 // والتغيير يسري على كل البطاقات فورًا عبر applyComponentContentToAll.
 el.querySelectorAll('[data-hearing-fields]').forEach(b=>b.onclick=()=>{
  const card=el.querySelector('[data-hearing-card]');
  if(!card){toast('لا توجد بطاقات جلسات لتخصيصها بعد','warn');return}
  openComponentCustomizer({id:'tpl:file:hearing:card',type:'card',title:'حقول بطاقة الجلسة',el:card,pageId:tabPageId('hearings')});
 });
}
/** تطبيق مرشح/بحث الأعمال على البطاقات وعلى الجدول — تصفية محلية للصفوف المحمّلة فقط. */
function applyProcFilter(root,{kind,q=''}={}){
 const state=root.__procBoardState;
 if(!state)return;
 const fn=procedureFilterFn(kind||state.kind||'all');
 const query=String(q??state.q??'').trim();
 const norm=s=>String(s||'').replace(/\s+/g,' ');
 const matches=p=>(!query||[p.type,p.description,p.assignedTo,p.result,p.notes].some(v=>norm(v).includes(query)))&&fn(p);
 root.querySelectorAll('[data-proc-card]').forEach(card=>{card.hidden=!matches(state.byId.get(card.dataset.procCard)||{})});
 root.querySelectorAll('.prc-group').forEach(g=>{const cards=[...g.querySelectorAll('[data-proc-card]')];g.hidden=!cards.some(c=>!c.hidden);const count=g.querySelector('.count');if(count)count.textContent=String(cards.filter(c=>!c.hidden).length)});
 const counter=root.querySelector('[data-proc-filter-count]');
 if(counter)counter.textContent=(kind&&kind!=='all')||query?`فلتر نشط · ${PROCEDURE_FILTERS.find(([k])=>k===kind)?.[1]||'بحث'}${query?` · «${query}»`:''}`:'لا توجد فلاتر نشطة';
 root.querySelectorAll('[data-proc-filter]').forEach(b=>{const on=b.dataset.procFilter===(kind||'all');b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on))});
 state.grid?.setRows?.(state.rows.filter(matches));
 state.kind=kind||state.kind||'all';state.q=query;
}
/** ربط لوحة الأعمال الإدارية: بحث/فلاتر + فتح/تعديل/إنجاز من البطاقة مباشرة. */
function bindProcBoard(el,app,{rows,today,stages}){
 const byId=new Map(rows.map(p=>[p.id,p]));
 el.__procBoardState={rows,today,byId,grid:el.__procBoardState?.grid||null,kind:'all',q:''};
 const search=el.querySelector('#proc-q');
 search?.addEventListener('input',()=>{clearTimeout(el.__procSearchT);el.__procSearchT=setTimeout(()=>applyProcFilter(el,{q:search.value}),200)});
 el.querySelectorAll('[data-proc-filter]').forEach(b=>b.onclick=()=>applyProcFilter(el,{kind:b.dataset.procFilter,q:search?.value||''}));
 el.querySelectorAll('[data-proc-card] [data-open]').forEach(b=>b.onclick=()=>app.go('rec:'+b.dataset.open));
 el.querySelectorAll('[data-proc-edit]').forEach(b=>b.onclick=()=>openEntityForm(app,'procedures',{id:b.dataset.procEdit,stageOptions:stageOptions(stages),onSaved:()=>reload(app)}));
 el.querySelectorAll('.prc-stage[data-open-case]').forEach(b=>b.onclick=()=>app.go('case:'+b.dataset.openCase));
 // «✓ تم»: نفس مسار مركز العمل الرسمي (completeItem) + تحديث موضعي للتبويب بلا إعادة بناء الصفحة
 el.querySelectorAll('[data-complete-proc]').forEach(btn=>btn.onclick=async e=>{
  e.preventDefault();e.stopPropagation();
  const procId=btn.dataset.completeProc;
  btn.disabled=true;
  const ref=overlayId('procedures',procId);
  try{
   await completeItem(app.office,ref);
   toast('تم تسجيل إنجاز العمل ✓','ok',{action:()=>{reopenItem(app.office,ref).then(()=>app.__fileRefreshTab?.('procedures')).catch(err=>toast(userError(err),'error'))},actionLabel:'تراجع',duration:6000});
   await app.__fileRefreshTab?.('procedures');
  }catch(err){btn.disabled=false;toast(userError(err),'error')}
 });
 el.querySelectorAll('[data-proc-fields]').forEach(b=>b.onclick=()=>{
  const card=el.querySelector('[data-proc-card]');
  if(!card){toast('لا توجد بطاقات أعمال لتخصيصها بعد','warn');return}
  openComponentCustomizer({id:'tpl:file:procedure:card',type:'card',title:'حقول بطاقة العمل الإداري',el:card,pageId:tabPageId('procedures')});
 });
}

async function renderTab(app){
 const el=document.querySelector('#file-tab');
 if(!el)return;
 el.dataset.uxcInstance=app.__file.id;
 const tab=app.__fileTab.tab;
 const cache=app.__fileTabCache&&app.__fileTabCache.id===app.__file.id?app.__fileTabCache:(app.__fileTabCache={id:app.__file.id,map:new Map()});
 // التحميل الكسول الحقيقي: كل تبويب يُركّب عند أول فتح فقط، ثم يُستعاد من الذاكرة
 // (بنفس عناصره ومستمعيه وقيم نماذجه غير المحفوظة) عند العودة إليه — بلا استعلام IndexedDB.
 if(cache.map.has(tab)){
  el.replaceChildren(...cache.map.get(tab));
  el.dataset.uxcInstance=app.__file.id;
  updateTabShell(app);
  bindCards(el);
  bindCustomizableComponents(el);
  applyFileTabLayout(app);
  if(tab==='summary'){bindStagePath(app,app.__file.f,app.__file.stages);bindCockpitOnce(el,app)}
  return;
 }
 await renderTabContent(app);
 if(tab==='summary'&&el){
  const html=await linkedTasksPanelHtml(app.office,{fileId:app.__file.id},{title:'مهام الملف',collapseId:'file-work',sectionId:'summary-tasks',uxcId:'panel:file:summary:tasks',centerRoute:`actionCenter?fileId=${encodeURIComponent(app.__file.id)}`});
  el.insertAdjacentHTML('beforeend',html);
  bindLinkedTasksPanel(app,el,{relatedType:'files',relatedId:app.__file.id});
 }
 const main=document.querySelector('#main-content');
 // أدوات «فتح/طي الكل» (بطاقة «الأقسام والجداول») لا تُبنى في صفحة الملف: الشريط العلوي
 // يكفي للتنقل، وكل قسم يحتفظ بزر الطي والدبوس الخاص به — بلا عنصر إضافي فوق المحتوى.
 enhanceCollapsiblePanels(main,`file:${app.__file.id}:${tab}`,{bulk:false});
 bindCards(el);
 bindCustomizableComponents(el);
 if(tab==='summary'){bindStagePath(app,app.__file.f,app.__file.stages);bindCockpitOnce(el,app)}
 updateTabShell(app);
 cache.map.set(tab,[...el.childNodes]);
 // أقسام التبويب تُرتَّب وتُطبَّق عليها إعدادات العرض بعد اكتمال التركيب (وليس قبل
 // التخزين في الكاش) حتى يُخزَّن الترتيب المطبَّق ويُستعاد كما هو عند العودة.
 applyFileTabLayout(app);
}
async function renderTabContent(app){
 const el=document.querySelector('#file-tab');const {id,f,parties,stages}=app.__file;const tab=app.__fileTab.tab;const office=app.office;
 // كتلة الهوية خارج جسم التبويب: تبقى أول قسم مرئيًا عند طي بقية المحتوى،
 // ولا تُعاد رسمها عند تبديل الأقسام أو فقدان قيمة نموذج غير محفوظ.
 el.innerHTML='<div class="skel-page" role="status" aria-label="جارٍ التحميل"><div class="skel skel-row"><div class="skel-card skel"></div><div class="skel-card skel"></div><div class="skel-card skel"></div><div class="skel-card skel"></div></div><div class="skel skel-block"></div></div>';
 const needStage=what=>`<div class="notice">لإضافة ${what} يجب أولًا إضافة رقم قضائي / مرحلة في تبويب «البيانات القضائية». الملف نفسه لا يحتاج قضية.</div>`;
 if(tab==='summary'){
  // «نظرة عامة» — مركز القرار والمتابعة للملف، لا نسخة مكررة من التبويبات المتخصصة.
  // كل عنصر هنا ملخص مقروء من مصدره الأصلي (الجلسات/الأعمال/المراحل/المهام) وكل زر
  // يفتح السجل نفسه أو تبويبه؛ لا يُنشأ أي سجل موازٍ ولا يُخترع رقم أو تاريخ أو حالة.
  const today=localDate();
  const [hearingResult,procedures]=await Promise.all([
   fileChildren(office,id,'hearings'),
   office.r.procedures.byIndex('fileId',id,2000)
  ]);
  const hearings=hearingResult.rows;
  const {upcoming}=splitHearings(hearings,today);
  const cur=stages.find(s=>s.id===f.currentStageId)||stages.at(-1);
  // (1) موقف الملف: الخطوة التالية + مؤشرات فعلية + إجراءات سريعة (نقرات أقل للعمل اليومي)
  const execPanel=`<section class="panel fp-exec" data-section-id="summary-cockpit" data-uxc-id="panel:file:summary:cockpit" data-collapse-id="file-exec" data-collapse-key="file-details:exec" data-collapse-default="open">
   <div class="panel-head"><h3>موقف الملف</h3><span class="collapse-summary" data-collapse-summary>ملخص حي من الجلسات والأعمال الإدارية المسجلة</span></div>
   ${fileCockpitHtml({hearings,procedures,stages,parties,today,currentStage:cur?refLabel('cases',cur):''})}
   <div class="fp-quick" role="toolbar" aria-label="إجراءات سريعة على الملف">
    <button type="button" class="ghost small" data-quick-hearing>＋ جلسة</button>
    <button type="button" class="ghost small" data-quick-procedure>＋ عمل إداري</button>
    <button type="button" class="ghost small" data-quick-party>＋ طرف</button>
    <button type="button" class="ghost small" data-quick-note>＋ ملاحظة</button>
    <button type="button" class="ghost small" data-quick-task>＋ مهمة</button>
   </div>
   ${hearingResult.more?'<div class="notice" role="status">تعرض هذه الصفحة حتى 5,000 جلسة مرتبطة بالملف. قد توجد سجلات إضافية؛ لم تُحذف أو تُغيَّر أي بيانات.</div>':''}
  </section>`;
  // (2) المتابعة القريبة: أقرب الجلسات القادمة + الأعمال المفتوحة/المتأخرة + تنبيهات نقص
  // البيانات الفعلية. ملخصات روابط إلى السجلات الأصلية — لا تحرير من هنا ولا نسخ موازية.
  const alerts=fileAttentionAlerts({f,parties,stages,hearings,procedures,today});
  const openProcs=procedures.filter(procIsActive)
   .sort((a,b)=>(dayOf(a.internalDueDate)||'9999-12-31').localeCompare(dayOf(b.internalDueDate)||'9999-12-31'));
  const overdueProcs=openProcs.filter(p=>dayOf(p.internalDueDate)&&dayOf(p.internalDueDate)<today);
  const stageLabelOf=h=>{const s=stages.find(x=>x.id===h.caseId);return s?`${s.stageType||s.numberType||'مرحلة'}${s.caseNumber?` ${s.caseNumber}${s.caseYear?'/'+s.caseYear:''}`:''}`:''};
  const followupPanel=`<section class="panel fp-followup" data-section-id="summary-followup" data-uxc-id="panel:file:summary:followup" data-collapse-id="file-followup" data-collapse-key="file-details:followup" data-collapse-default="open">
   <div class="panel-head"><h3>المتابعة القريبة</h3><span class="collapse-summary" data-collapse-summary></span></div>
   <div class="fp-fu-grid">
    <div class="fp-fu-col">
     <h4 class="fp-fu-title">أقرب الجلسات القادمة <button type="button" class="link small" data-tab-jump="hearings">كل الجلسات ←</button></h4>
     ${upcoming.length?`<ul class="fp-fu-list">${upcoming.slice(0,3).map(h=>`<li><button type="button" data-open="hearings:${esc(h.id)}"><b>${fmtDate(h.hearingDate)}${h.hearingTime?' · '+esc(String(h.hearingTime).slice(0,5)):''}</b><span>${esc(h.type||h.reason||'جلسة')}${stageLabelOf(h)?` — ${esc(stageLabelOf(h))}`:''}</span>${h.result?'':'<small class="muted">بلا قرار مسجل</small>'}</button></li>`).join('')}</ul>${upcoming.length>3?`<p class="muted small">+${upcoming.length-3} جلسة قادمة أخرى — <button type="button" class="link" data-tab-jump="hearings">عرض الكل</button></p>`:''}`
      :`<div class="fp-fu-empty"><p>لا توجد جلسات قادمة مسجلة.</p><button type="button" class="ghost small" data-quick-hearing>＋ إضافة جلسة</button></div>`}
    </div>
    <div class="fp-fu-col">
     <h4 class="fp-fu-title">الأعمال الإدارية المفتوحة <button type="button" class="link small" data-tab-jump="procedures">كل الأعمال ←</button></h4>
     ${openProcs.length?`<ul class="fp-fu-list">${openProcs.slice(0,3).map(p=>{const late=dayOf(p.internalDueDate)&&dayOf(p.internalDueDate)<today;return `<li><button type="button" data-open="procedures:${esc(p.id)}"><b>${esc(p.description||p.type||'عمل إداري')}</b><span>${dayOf(p.internalDueDate)?`${late?'متأخر — موعده ':'موعد المتابعة '}${fmtDate(p.internalDueDate)}`:'بلا موعد متابعة مسجل'}</span></button>${late?'<span class="fp-fu-late" aria-hidden="true">متأخر</span>':''}</li>`}).join('')}</ul>${openProcs.length>3?`<p class="muted small">+${openProcs.length-3} عملًا مفتوحًا آخر — <button type="button" class="link" data-tab-jump="procedures">عرض الكل</button></p>`:''}${overdueProcs.length?`<p class="fp-fu-warn small">أعمال متأخرة: ${overdueProcs.length} — <button type="button" class="link" data-tab-jump="procedures">المتابعة الآن</button></p>`:''}`
      :`<div class="fp-fu-empty"><p>لا توجد أعمال إدارية مفتوحة.</p><button type="button" class="ghost small" data-quick-procedure>＋ إضافة عمل</button></div>`}
    </div>
   </div>
   ${alerts.length?`<div class="fp-alerts" role="list" aria-label="تنبيهات الملف">${alerts.map(a=>`<div class="fp-alert fp-alert--${esc(a.tone)}" role="listitem"><span>${esc(a.text)}</span>${a.tab?`<button type="button" class="ghost small" data-tab-jump="${esc(a.tab)}">${esc(a.action)}</button>`:a.editFile?`<button type="button" class="ghost small" data-file-edit2>${esc(a.action)}</button>`:''}</div>`).join('')}</div>`:''}
  </section>`;
  const refs=new Map();
  // رقم الملف الداخلي لا يُكرر في البيانات التفصيلية؛ مصدره الوحيد زر «الملف الفرعي».
  const identityKeys=new Set(['fileNumber','title','fileType','mainCategory','subCategory','status','priority','responsibleLawyer']);
  const fileFields=ENTITIES.files.fields.filter(x=>!identityKeys.has(x.k));
  const dataPanel=`<section class="panel fp-data fp-file-data" data-section-id="summary-data" data-uxc-id="panel:file:summary:data" data-collapse-id="file-file-data" data-collapse-key="file-details:file-data" data-collapse-default="open">
   <div class="panel-head"><h3>بيانات الملف</h3><span class="collapse-summary" data-collapse-summary></span>
    <div class="sec-actions"><button type="button" class="ghost small" data-file-edit2>✎ تعديل بيانات الملف</button><button type="button" class="ghost small" data-reclass>تغيير القسم / النوع</button></div></div>
   <div class="fp-kv">
    ${kvHtml(fileFields,f,refs,{secondary:['lastActivityAt','staff','coLawyers']})}
    ${f.archivedAt?`<p class="muted small">تاريخ الأرشفة: ${fmtDate(f.archivedAt)}</p>`:''}
    ${f.reopenedAt?`<p class="muted small">أُعيد فتحه في ${fmtDate(f.reopenedAt)}${f.reopenReason?' — السبب: '+esc(f.reopenReason):''}</p>`:''}
   </div></section>`;
  // المراحل الكاملة والعلاقات والأحكام تُدار في تبويباتها المتخصصة؛ لا نعيد نسخها هنا.
  el.innerHTML=`${execPanel}${followupPanel}${dataPanel}
   ${executionStripHtml({summary:executionContextSummary(app.__file.executions||[]),scope:'file',route:`executionCenter?fileId=${encodeURIComponent(id)}`,sectionId:'summary-execution',uxcId:'panel:file:summary:execution'})}`;
  // كل إجراءات «نظرة عامة» تنقل إلى المصدر الأصلي أو تبويبه — أو تفتح نموذج الإضافة
  // الصحيح مباشرة (نقرة واحدة بدل التنقل إلى التبويب ثم البحث عن زر الإضافة).
  el.querySelector('[data-file-edit2]')?.addEventListener('click',()=>editFileWithReview(app,id));
  el.querySelectorAll('[data-reclass]').forEach(b=>b.onclick=()=>reclassDialog(app,f));
  el.querySelectorAll('[data-tab-jump]').forEach(b=>b.onclick=()=>app.__fileGotoTab(b.dataset.tabJump));
  el.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>app.go('rec:'+b.dataset.open));
  el.querySelectorAll('[data-open-case]').forEach(b=>b.onclick=()=>app.go('case:'+b.dataset.openCase));
  el.querySelectorAll('[data-open-file]').forEach(b=>b.onclick=()=>app.go('file:'+b.dataset.openFile));
  el.querySelectorAll('.cp-fc [data-route]').forEach(b=>b.onclick=()=>app.go(b.dataset.route));
  el.querySelector('[data-cp-task]')?.addEventListener('click',()=>document.querySelector('#main-content [data-file-task]')?.click());
  bindSummaryQuickActions(el,app,{id,stages,f});
  return;
 }
 if(tab==='timeline'){
  try{
   const t=await buildFileTimeline(office,id);
   el.innerHTML=`<section class="panel tl-panel" data-section-id="timeline-panel" data-uxc-id="panel:file:timeline:panel" data-collapse-id="timeline-panel" data-collapse-key="file-details:timeline-panel" data-collapse-default="open"><div class="panel-head"><h3>الخط الزمني الموحد للملف</h3><span class="muted small">كل ما جرى في هذا الملف: جلسات، أحكام، أعمال، مواعيد، اتصالات، ملاحظات، مستندات، أتعاب — بتسلسل واحد.</span></div>${timelineHtml(t)}</section>`;
   bindTimeline(el,{onOpen:r=>app.go(r.startsWith('rec:')?r:'rec:'+r)});
  }catch(err){el.innerHTML=`<div class="error-box" role="alert"><h2>تعذر بناء الخط الزمني</h2><p>${esc(userError(err))}</p></div>`}
  return;
 }
 if(tab==='parties'){
  const active=parties.filter(p=>p.isActive!==false).length;
  el.innerHTML=`<div class="party-toolbar"><div><h3>الأطراف <span class="count">${parties.length}</span></h3><p class="muted small">الأطراف مجمّعة حسب الصفة/المجموعة. رتّبها بأزرار التحريك؛ الموكل المسجل يبقى مرتبطًا بسجله دون نسخ بياناته.</p></div><button class="primary" data-add-party>+ إضافة طرف</button></div><div class="party-summary"><span>الإجمالي: <b>${parties.length}</b></span><span>نشط: <b>${active}</b></span><span>موكل المكتب: <b>${parties.filter(p=>p.isClient??p.partyKind==='client').length}</b></span></div><div class="party-groups" data-section-id="parties-groups" data-uxc-id="panel:file:parties:groups">${partyGroupsHtml(parties)}</div>`;
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
  el.innerHTML=`<div class="sec-actions"><button class="primary" data-add-stage>+ رقم قضائي / مرحلة</button><span class="muted small">مثال: محضر ← تحقيق ← جنحة ← استئناف داخل نفس الملف. كل مرحلة لها نوع رقم ورقم وسنة ومحكمة ودائرة ودرجة.</span></div>${stages.length?`<ol class="stage-chain" data-section-id="judicial-chain" data-uxc-id="panel:file:judicial:chain">${stages.map(s=>`<li><button class="link" data-open-case="${s.id}">${esc(s.stageType||s.numberType||'مرحلة')}<br><small>${esc(s.caseNumber||'بدون رقم')}${s.caseYear?'/'+esc(s.caseYear):''}</small></button></li>`).join('')}</ol>`:''}<section class="fp-sec-wrap" data-section-id="judicial-grid" data-uxc-id="panel:file:judicial:grid" data-collapse-id="judicial-grid" data-collapse-key="file-details:judicial-grid"><div data-grid></div></section>`;
  const clientRole=parties.find(p=>p.partyKind==='client')?.role||'';
  el.querySelector('[data-add-stage]').onclick=()=>openEntityForm(app,'cases',{preset:{fileId:id,stageOrder:stages.length+1,clientCapacity:clientRole},title:'إضافة رقم قضائي / مرحلة',onSaved:()=>reload(app)});
  el.querySelectorAll('[data-open-case]').forEach(b=>b.onclick=()=>app.go('case:'+b.dataset.openCase));
  await sectionGrid(app,el.querySelector('[data-grid]'),'cases',stages,{storageKey:'file:stages'});
  return;
 }
 if(tab==='judgments'){
  const childResult=await fileChildren(office,id,'judgments');
  const rows=childResult.rows;
  const limitNotice=childResult.more?'<div class="notice" role="status">تعرض الصفحة حتى 5,000 سجل مرتبط؛ قد توجد سجلات إضافية. لم تُحذف أو تُغيَّر أي بيانات.</div>':'';
  el.innerHTML=`${limitNotice}<div class="sec-actions"><button class="primary" data-add>+ حكم</button></div><section class="fp-sec-wrap" data-section-id="judgments-grid" data-uxc-id="panel:file:judgments:grid"><div data-grid></div></section>`;
  el.querySelector('[data-add]')?.addEventListener('click',()=>{const cur=stages.at(-1);openEntityForm(app,'judgments',{preset:{fileId:id,court:cur?.courtId||'',chamber:cur?.chamber||'',stage:cur?.stageType||''},onSaved:()=>reload(app)})});
  rows.sort((a,b)=>String(b.judgmentDate||'').localeCompare(String(a.judgmentDate||'')));
  await sectionGrid(app,el.querySelector('[data-grid]'),'judgments',rows,{storageKey:'file:judgments'});
  return;
 }
 if(tab==='hearings'){
  // تبويب الجلسات — عرض تشغيلي بغرضين واضحين: مسح زمني سريع (الجلسة القادمة ثم
  // بطاقات القادمة/السابقة) + جدول كامل للبحث والفرز والأعمدة والطباعة. كل بطاقة
  // تفتح السجل الأصلي وتوضح مرحلتها المرتبطة؛ لا سجل موازٍ ولا بيانات مكررة قابلة للتحرير.
  const today=localDate();
  const childResult=await fileChildren(office,id,'hearings');
  const rows=childResult.rows;
  const {upcoming,past}=splitHearings(rows,today);
  const next=upcoming[0]||null;
  const stageLabelOf=h=>{const s=stages.find(x=>x.id===h.caseId);return s?`${s.stageType||s.numberType||'مرحلة'}${s.caseNumber?` ${s.caseNumber}${s.caseYear?'/'+s.caseYear:''}`:''}`:''};
  const limitNotice=childResult.more?'<div class="notice" role="status">تعرض الصفحة حتى 5,000 سجل مرتبط؛ قد توجد سجلات إضافية. لم تُحذف أو تُغيَّر أي بيانات.</div>':'';
  if(!stages.length){
   // الجلسة ترتبط بمرحلة قضائية: بلا مراحل، الإضافة المتاحة أولًا هي المرحلة نفسها.
   el.innerHTML=`${needStage('جلسة')}${limitNotice}<section class="fp-sec-wrap" data-section-id="hearings-grid" data-uxc-id="panel:file:hearings:grid" data-collapse-id="hearings-grid" data-collapse-key="file-details:hearings-grid"><div data-grid></div></section>`;
   await sectionGrid(app,el.querySelector('[data-grid]'),'hearings',rows,{storageKey:'file:hearings'});
   return;
  }
  // الجلسة القادمة: بطاقة قرار واحدة (أقرب جلسة بلا نتيجة) — لا نسخة من كل الجلسات.
  const nextPanel=`<section class="panel hrc-next${next?'':' is-empty'}" data-section-id="hearings-next" data-uxc-id="panel:file:hearings:next" data-collapse-id="hearings-next" data-collapse-key="file-details:hearings-next" data-collapse-default="open">
   <div class="panel-head"><h3>الجلسة القادمة</h3><span class="collapse-summary" data-collapse-summary></span></div>
   ${next?hearingCardHtml(next,{stageLabel:stageLabelOf(next),isNext:true}):`<div class="fp-fu-empty"><p>لا توجد جلسات قادمة مسجلة — قد تكون كل الجلسات سابقة أو بلا قرار بعد، أو لا جلسات أصلًا.</p><button type="button" class="ghost small" data-add>＋ إضافة جلسة</button></div>`}
  </section>`;
  // بطاقات الجلسات (مسح سريع): القادمة ثم السابقة — بطاقة لكل جلسة بغرض الهاتف أولًا،
  // والجدول أدناه يبقى المصدر الكامل للبحث والفرز على أي شاشة.
  const cardsHtml=`<section class="panel hrc-board" data-section-id="hearings-cards" data-uxc-id="panel:file:hearings:cards" data-collapse-id="hearings-cards" data-collapse-key="file-details:hearings-cards" data-collapse-default="open">
   <div class="panel-head"><h3>عرض الجلسات</h3><span class="collapse-summary" data-collapse-summary></span>
    <div class="sec-actions"><button type="button" class="ghost small" data-hearing-fields title="إظهار وإخفاء وترتيب حقول بطاقة الجلسة (يسري على كل البطاقات)">⚙ حقول البطاقة</button></div></div>
   <div class="hrc-groups" data-hearing-groups>
    ${upcoming.length?`<details class="hrc-group hrc-group--upcoming" open data-collapse-default="open"><summary>القادمة <span class="count">${upcoming.length}</span></summary><div class="hrc-list">${upcoming.map(h=>hearingCardHtml(h,{stageLabel:stageLabelOf(h)})).join('')}</div></details>`:''}
    <details class="hrc-group hrc-group--past"${upcoming.length?'':' open data-collapse-default="open"'}><summary>السابقة / المسجَّل قرارها <span class="count">${past.length}</span></summary><div class="hrc-list">${past.length?past.map(h=>hearingCardHtml(h,{stageLabel:stageLabelOf(h)})).join(''):'<p class="muted small" data-hrc-empty-past>لا توجد جلسات سابقة مسجلة.</p>'}</div></details>
   </div>
   ${!rows.length?'<div class="fp-fu-empty"><p>لا توجد جلسات مسجلة لهذا الملف بعد.</p><button type="button" class="ghost small" data-add>＋ إضافة أول جلسة</button></div>':''}
  </section>`;
  // مرشحات عملية تُطبَّق على البطاقات وعلى الجدول معًا (بيانات محمّلة فعلًا، بلا استعلام جديد).
  const counts=HEARING_FILTERS.map(([k,l,fn])=>[k,l,rows.filter(h=>fn(h,today)).length]);
  const filtersHtml=`<section class="panel hrc-filters" data-section-id="hearings-filters" data-uxc-id="panel:file:hearings:filters" data-collapse-id="hearings-filters" data-collapse-key="file-details:hearings-filters" data-collapse-default="open">
   <div class="panel-head"><h3>تصفية سريعة</h3><span class="badge" data-hrc-filter-count>لا توجد فلاتر نشطة</span></div>
   <div class="hrc-chips" role="group" aria-label="فلاتر الجلسات">${counts.map(([k,l,n])=>`<button type="button" class="chip${k==='all'?' active':''}" data-hrc-filter="${k}" aria-pressed="${k==='all'}">${esc(l)} <small>${n}</small></button>`).join('')}</div>
  </section>`;
  el.innerHTML=`${limitNotice}<div class="sec-actions"><button class="primary" data-add>+ جلسة</button><button class="ghost" data-hearing-cycle>عرض دورة الجلسات</button><button type="button" class="ghost" data-hearing-fields title="إظهار وإخفاء وترتيب حقول بطاقة الجلسة (يسري على كل البطاقات)">⚙ حقول البطاقة</button></div>${nextPanel}${filtersHtml}${cardsHtml}
   <section class="fp-sec-wrap" data-section-id="hearings-grid" data-uxc-id="panel:file:hearings:grid" data-collapse-id="hearings-grid" data-collapse-key="file-details:hearings-grid"><div data-grid></div></section>`;
  el.querySelector('[data-add]')?.addEventListener('click',()=>{const cur=stages.find(s=>s.id===f.currentStageId)||stages.at(-1);openEntityForm(app,'hearings',{stageOptions:stageOptions(stages),preset:{caseId:cur?.id||'',fileId:id,court:cur?.courtId||'',chamber:cur?.chamber||''},onSaved:()=>reload(app)})});
  el.querySelector('[data-hearing-cycle]')?.addEventListener('click',()=>showHearingCycle(app,rows[0]?.id||''));
  bindHearingCards(el,app,{rows,today,stages});
  rows.sort((a,b)=>String(b.hearingDate||'').localeCompare(String(a.hearingDate||'')));
  const grid=await sectionGrid(app,el.querySelector('[data-grid]'),'hearings',rows,{storageKey:'file:hearings'});
  // المرشح الحالي يتبع الجدول أيضًا (نفس الصفوف، بلا إعادة استعلام)
  if(el.__hearingBoardState)el.__hearingBoardState.grid=grid;
  applyHearingFilter(el,'all');
  return;
 }
 if(tab==='procedures'){
  // تبويب الأعمال الإدارية — مركز متابعة عملي: لوحة منظمة حسب الحالة المسجلة
  // (متأخرة ← مفتوحة ← مكتملة ← ملغاة) ببطاقات تشغيلية وإضافة سريعة وتعديل وإنجاز،
  // + الجدول الكامل كما هو للبحث والفرز والأعمدة. التمييز الزمني يعتمد موعد المتابعة
  // المسجل فقط — تاريخ الإنشاء لا يُستخدم استحقاقًا ضمنيًا أبدًا.
  const today=localDate();
  const procRes=await office.r.procedures.byIndex('fileId',id,2000);
  const rows=procRes.rows||procRes;
  const more=Array.isArray(procRes)&&procRes.more===true||procRes?.more===true;
  const groups=groupProcedures(rows,today);
  const stageLabelOf=p=>{const s=stages.find(x=>x.id===p.caseId);return s?`${s.stageType||s.numberType||'مرحلة'}${s.caseNumber?` ${s.caseNumber}${s.caseYear?'/'+s.caseYear:''}`:''}`:''};
  const limitNotice=more?'<div class="notice" role="status">يعرض التبويب حتى 2,000 عمل إداري مرتبط بالملف؛ قد توجد سجلات إضافية. لم تُحذف أو تُغيَّر أي بيانات.</div>':'';
  const openCount=groups.open.length+groups.overdue.length;
  const counter=(cls,label,n,title)=>`<span class="prc-counter${cls?` prc-counter--${cls}`:''}" title="${esc(title)}"><b>${n}</b>${esc(label)}</span>`;
  const boardPanel=`<section class="panel proc-board" data-section-id="proc-board" data-uxc-id="panel:file:procedures:board" data-collapse-id="proc-board" data-collapse-key="file-details:proc-board" data-collapse-default="open">
   <div class="panel-head"><h3>لوحة الأعمال الإدارية</h3><span class="collapse-summary" data-collapse-summary></span>
    <div class="sec-actions"><button type="button" class="ghost small" data-proc-fields title="إظهار وإخفاء وترتيب حقول بطاقة العمل (يسري على كل البطاقات)">⚙ حقول البطاقة</button></div></div>
   <div class="prc-counters" role="status">
    ${counter('overdue','متأخرة',groups.overdue.length,'موعد متابعة مسجل وانقضى والعمل ما زال مفتوحًا')}
    ${counter('open','مفتوحة/قيد المتابعة',openCount,'حالة مسجلة: مفتوح أو قيد الانتظار')}
    ${counter('done','مكتملة',groups.done.length,'حالة مسجلة: تم')}
    ${counter('cancelled','ملغاة',groups.cancelled.length,'حالة مسجلة: ملغي')}
    ${counter('','الإجمالي',rows.length,'كل الأعمال المرتبطة بالملف ضمن حد العرض')}
   </div>
   <div class="prc-tools">
    <input type="search" id="proc-q" placeholder="ابحث في الأعمال (النوع، الوصف، المكلّف، النتيجة)…" aria-label="بحث في الأعمال الإدارية">
    <div class="prc-chips" role="group" aria-label="فلاتر الأعمال"><span class="badge" data-proc-filter-count>لا توجد فلاتر نشطة</span>${PROCEDURE_FILTERS.map(([k,l])=>`<button type="button" class="chip${k==='all'?' active':''}" data-proc-filter="${k}" aria-pressed="${k==='all'}">${esc(l)}</button>`).join('')}</div>
   </div>
   <div data-proc-groups>
    ${[['overdue','متأخرة — موعدها انقضى',groups.overdue,'is-danger',true],['open','مفتوحة وقيد المتابعة',groups.open,'',true],['done','مكتملة',groups.done,'',false],['cancelled','ملغاة',groups.cancelled,'',false]].map(([k,l,list,tone,open])=>
     list.length?`<details class="prc-group prc-group--${k}${tone?` ${tone}`:''}"${open?' open data-collapse-default="open"':''}><summary>${l} <span class="count">${list.length}</span></summary><div class="prc-list">${list.slice(0,PROC_CARDS_MAX).map(p=>procedureCardHtml(p,{stageLabel:stageLabelOf(p)})).join('')}</div>${list.length>PROC_CARDS_MAX?`<p class="muted small prc-group-more">يعرض أول ${PROC_CARDS_MAX} من ${list.length} — البقية في جدول الأعمال أدناه أو بالبحث.</p>`:''}</details>`:''
    ).join('')||`<div class="fp-fu-empty"><p>لا توجد أعمال إدارية مسجلة لهذا الملف.</p><button type="button" class="ghost small" data-add>＋ إضافة أول عمل</button></div>`}
   </div>
   ${limitNotice}
  </section>`;
  el.innerHTML=`<div class="sec-actions"><button class="primary" data-add>+ إجراء / عمل إداري</button><span class="muted small">الأعمال مستقلة عن المراحل ويمكن ربطها بمرحلة اختياريًا؛ الإنجاز يُسجَّل من بطاقة العمل مباشرة.</span></div>${boardPanel}
   <section class="fp-sec-wrap" data-section-id="proc-grid" data-uxc-id="panel:file:procedures:grid" data-collapse-id="proc-grid" data-collapse-key="file-details:proc-grid"><div data-grid></div></section>`;
  el.querySelectorAll('[data-add]').forEach(b=>b.onclick=()=>openEntityForm(app,'procedures',{preset:{fileId:id},stageOptions:stageOptions(stages),onSaved:()=>reload(app)}));
  bindProcBoard(el,app,{rows,today,stages});
  const sorted=[...rows].sort((a,b)=>String(b.actionDate||b.internalDueDate||b.createdAt||'').localeCompare(String(a.actionDate||a.internalDueDate||a.createdAt||'')));
  const grid=await sectionGrid(app,el.querySelector('[data-grid]'),'procedures',sorted,{storageKey:'file:procedures'});
  // لوحة الأعمال تحتفظ بمقبض الجدول: البحث/المرشح يرشّحان البطاقات والجدول معًا بلا استعلام
  if(el.__procBoardState)el.__procBoardState.grid=grid;
  return;
 }
 if(tab==='notes'){
  // caseNotes remains the canonical store: historical rows and new Quick Notes are
  // rendered together through the same operational panel, not as a second Notes UI.
  const rows=(await notesForEntity(office,'LEGAL_FILE',id,{limit:100})).sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
  el.innerHTML=`<section class="panel file-quick-notes" data-section-id="notes-panel" data-uxc-id="panel:file:notes:panel" data-collapse-id="notes-panel" data-collapse-key="file-details:notes-panel" data-collapse-default="open"><div class="panel-head"><h3>📝 الملاحظات السريعة المرتبطة</h3><div class="sec-actions"><button class="primary" data-quick-file-add>+ ملاحظة سريعة</button></div></div><p class="muted small">ملاحظات تشغيلية مستقلة عن الحكم أو الإجراء. السجلات التاريخية محفوظة في caseNotes وتظهر هنا دون نسخ أو حذف.</p><div data-quick-file-list></div></section>`;
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
  el.innerHTML=`<div class="sec-actions"><button class="primary" data-add>+ ربط بملف آخر</button><span class="muted small">مثال: ملف استئناف مرتبط بملف الدعوى الأصلية، أو ملف تنفيذ لحكم.</span></div><section class="fp-sec-wrap" data-section-id="relations-grid" data-uxc-id="panel:file:relations:grid" data-collapse-id="relations-grid" data-collapse-key="file-details:relations-grid"><div data-grid></div></section>`;
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
  el.innerHTML=`<section class="panel" data-section-id="typedata-form" data-uxc-id="panel:file:typeData:form" data-collapse-id="typedata-form" data-collapse-key="file-details:typedata-form" data-collapse-default="open"><div class="panel-head"><h3>بيانات ${esc(t.name)}</h3><span class="muted small">كل الحقول اختيارية</span></div><form class="entity-form" id="meta-form"><div class="form-grid">${fields.map(x=>metaInput(x,f['x_'+x.k])).join('')}</div><div class="form-actions"><button class="primary">حفظ</button></div></form></section>`;
  await hydrateLookups(app,el);
  el.querySelector('#meta-form').onsubmit=async e=>{e.preventDefault();const v={};el.querySelectorAll('[data-meta]').forEach(i=>v[i.dataset.meta]=i.value);try{await saveFileMeta(office,id,v);toast('تم الحفظ');reload(app)}catch(err){toast(userError(err),'error')}};
  return;
 }
 if(tab==='assets'){
  const rows=await fileAssets(office,id);
  el.innerHTML=`<div class="sec-actions">${Object.entries(ASSET_KINDS).map(([k,d])=>`<button class="ghost" data-new-asset="${k}">+ ${esc(d.label)}</button>`).join('')}<button class="ghost" data-link-asset>ربط أصل مسجل</button><span class="muted small">عقار أو مركبة أو جهة يمكن ربطها بأكثر من ملف دون تكرار بياناتها.</span></div>
   <div class="asset-list" data-section-id="assets-list" data-uxc-id="panel:file:assets:list">${rows.map(({link,asset:a})=>`<article class="lf-card"><header><span>${esc(ASSET_KINDS[a.kind]?.icon||'📎')}</span><div><b>${esc(a.name||'')}</b><small>${esc(ASSET_KINDS[a.kind]?.label||'')}${link.role?' · '+esc(link.role):''}</small></div><button class="link danger" data-unlink="${esc(a.id)}">إلغاء الربط</button></header>${assetDetails(a)?`<p class="small muted">${esc(assetDetails(a))}</p>`:''}</article>`).join('')||'<p class="muted">لا توجد أصول مرتبطة.</p>'}</div>`;
  el.querySelectorAll('[data-new-asset]').forEach(b=>b.onclick=()=>assetDialog(app,id,b.dataset.newAsset));
  el.querySelector('[data-link-asset]').onclick=()=>linkAssetDialog(app,id);
  el.querySelectorAll('[data-unlink]').forEach(b=>b.onclick=async()=>{if(!await confirmBox('إلغاء ربط الأصل بهذا الملف؟ (بيانات الأصل لا تُحذف)',{okText:'إلغاء الربط'}))return;await unlinkAsset(office,id,b.dataset.unlink);reload(app)});
  return;
 }
 if(tab==='extra'){
  const g=fileTypeGroup(f.fileType);const def=FILE_TYPE_GROUPS[g];
  const otherData=Object.entries(FILE_TYPE_GROUPS).filter(([k])=>k!==g).map(([,d])=>({d,html:kvHtml(d.fields,f,new Map())})).filter(x=>!x.html.includes('class="muted"'));
  el.innerHTML=`<section class="panel" data-section-id="extra-panel" data-uxc-id="panel:file:extra:panel" data-collapse-id="extra-panel" data-collapse-key="file-details:extra-panel" data-collapse-default="open"><div class="panel-head"><h3>${esc(def?.label||'بيانات حسب نوع الملف')}</h3><button class="primary" data-edit-extra>تعديل</button></div>${def?kvHtml(def.fields,f,new Map()):'<p class="muted">حدد نوع الملف من «تعديل البيانات» لتظهر الحقول الخاصة به.</p>'}</section>
   ${otherData.map(x=>`<section class="panel"><h3>${esc(x.d.label)} <small class="muted">(من نوع سابق — محفوظة ولم تُحذف)</small></h3>${x.html}</section>`).join('')}`;
  el.querySelector('[data-edit-extra]').onclick=()=>editFileWithReview(app,id,{typeFieldsOnly:true,title:'تعديل البيانات حسب نوع الملف'});
  return;
 }
 if(tab==='money'){
  const [fees,docs,poas,appts,comms]=await Promise.all([office.r.fees.byIndex('fileId',id,1000),office.r.documentReferences.byIndex('fileId',id,1000),office.r.powersOfAttorney.byIndex('fileId',id,1000),office.r.appointments.byIndex('fileId',id,1000),office.r.communications.byIndex('fileId',id,1000)]);
  const blocks=[['fees','الأتعاب',fees],['documentReferences','المستندات',docs],['powersOfAttorney','التوكيلات المرتبطة',poas],['appointments','المواعيد',appts],['communications','الاتصالات',comms]];
  el.innerHTML=blocks.map(([s,l,rows])=>`<details class="rec-section" data-section-id="money-${esc(s)}" data-uxc-id="panel:file:money:${esc(s)}" ${rows.length?'open':''}><summary><span>${l}</span><span class="count">${rows.length}</span></summary><div class="sec-actions"><button class="ghost" data-add="${s}">+ إضافة</button></div><div data-grid="${s}"></div></details>`).join('');
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
  const sinceHtml=since.total?`<section class="panel" data-section-id="activity-since" data-uxc-id="panel:file:activity:since" data-collapse-id="activity-since" data-collapse-key="file-details:activity-since" data-collapse-default="open" data-collapse-summary="${since.total} تغييرات"><div class="panel-head"><h3>تغيّر منذ زيارتك</h3><span class="badge warn" data-collapse-alert>${since.total}${since.capped?'+':''} تغييرات</span></div><ol class="timeline file-since-list">${since.rows.map(r=>`<li><time>${fmtDate(String(r.timestamp||'').slice(0,10))}</time><div><b>${esc(r.summary||'نشاط')}</b>${r.action?` <small class="muted">${esc(r.action)}</small>`:''}</div></li>`).join('')}</ol></section>`:'';
  markHomeSeen(seenScope).catch(()=>{});
  el.innerHTML=`${sinceHtml}<section class="fp-sec-wrap" data-section-id="activity-grid" data-uxc-id="panel:file:activity:grid" data-collapse-id="activity-grid" data-collapse-key="file-details:activity-grid"><div data-grid></div></section>`;
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
