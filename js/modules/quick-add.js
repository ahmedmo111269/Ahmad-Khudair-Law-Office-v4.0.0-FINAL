// «إضافة» سياقية فوق النماذج والخدمات الموجودة — لا مخازن أو مسارات حفظ موازية.
import {modal,closeModal} from '../ui/modal.js';
import {esc} from '../ui/dom.js';
import {ENTITIES} from '../domain/entities.js';
import {icon} from '../ui/icons.js';
import {normalizeArabic} from '../core/search-normalizer.js';
import {formatFileNumber} from '../core/file-number.js';
import {toast} from '../ui/toast.js';
import {addDays,localDate} from '../core/clock.js';

const STORE_ICONS={files:'folder',clients:'users',opponents:'userX',cases:'gavel',hearings:'calendar',procedures:'clipboard',powersOfAttorney:'stamp',appointments:'clock',communications:'phone',caseNotes:'note',judgments:'landmark',expertReports:'microscope',execution:'hammer',fees:'wallet',documentReferences:'file',serviceRecords:'stamp',bailiffs:'scale',executionParties:'users',executionValuePeriods:'chart',executionReceipts:'wallet',executionPOAs:'stamp',executionActions:'hammer'};
const CORE_ITEMS=[
 {kind:'note',label:'ملاحظة سريعة',icon:'note',keywords:'الملاحظات السريعة التقاط تذكير inbox'},
 {kind:'file',label:ENTITIES.files?.label||'ملف قانوني',icon:'folder',keywords:'ملف جديد قضية'},
 {kind:'client',label:ENTITIES.clients?.label||'موكل',icon:'users',keywords:'عميل موكل جديد'},
 {kind:'hearing',label:ENTITIES.hearings?.label||'جلسة',icon:'calendar',keywords:'جلسة محكمة'},
 {kind:'procedure',label:ENTITIES.procedures?.label||'عمل إداري',icon:'clipboard',keywords:'إجراء متابعة مهمة'},
 {kind:'task',label:'مهمة متابعة',icon:'target',keywords:'مركز العمل task تذكير'}
];
const CORE_STORES=new Set(['files','clients','hearings','procedures','caseNotes','executionObligations','executionPeriods']);
const OTHER_ITEMS=Object.keys(STORE_ICONS).filter(store=>!CORE_STORES.has(store)&&ENTITIES[store]).map(store=>({kind:store,label:ENTITIES[store].label,icon:STORE_ICONS[store],keywords:`${ENTITIES[store].plural||''} ${ENTITIES[store].label}`}));
const CONTEXT_ACTIONS={
 today:[['task','مهمة اليوم','target'],['appointment','موعد اليوم','clock']],
 client:[['file','ملف جديد للموكل','folder'],['hearing','جلسة للموكل','calendar'],['procedure','عمل إداري للموكل','clipboard'],['appointment','موعد للموكل','clock'],['note','ملاحظة مرتبطة بالموكل','note'],['task','مهمة مرتبطة بالموكل','target']],
 file:[['hearing','جلسة في الملف','calendar'],['procedure','عمل إداري في الملف','clipboard'],['judgment','حكم في الملف','landmark'],['serviceRecord','إعلان/محضر في الملف','stamp'],['document','مستند مرتبط','file'],['fee','أتعاب الملف','wallet'],['party','طرف جديد','users'],['stage','مرحلة قضائية','gavel'],['note','ملاحظة مرتبطة بالملف','note'],['task','مهمة مرتبطة بالملف','target']],
 case:[['hearing','جلسة للمرحلة','calendar'],['judgment','حكم للمرحلة','landmark'],['procedure','عمل إداري للملف','clipboard'],['serviceRecord','إعلان مرتبط','stamp'],['note','ملاحظة مرتبطة بالقضية','note'],['task','مهمة مرتبطة بالقضية','target']],
 record:[['note','ملاحظة مرتبطة بالسجل','note'],['task','مهمة مرتبطة بالسجل','target']]
};
const NOTE_TYPES={clients:'CLIENT',opponents:'PARTY',files:'LEGAL_FILE',cases:'CASE',fileParties:'PARTY',hearings:'HEARING',procedures:'PROCEDURE',judgments:'JUDGMENT',execution:'EXECUTION',powersOfAttorney:'POA',serviceRecords:'SERVICE_RECORD',expertReports:'EXPERT_REPORT',appointments:'APPOINTMENT',communications:'COMMUNICATION',fees:'FEE',documentReferences:'DOCUMENT_REFERENCE',workItems:'WORK_ITEM',caseNotes:'QUICK_NOTE'};
const FORM_KIND={client:'clients',opponents:'opponents',case:'cases',hearing:'hearings',procedure:'procedures',appointment:'appointments',communication:'communications',judgment:'judgments',serviceRecord:'serviceRecords',document:'documentReferences',fee:'fees',poa:'powersOfAttorney',expertReport:'expertReports',party:'fileParties'};
const CTX_LINK={client:'CLIENT',file:'LEGAL_FILE',case:'CASE',execution:'EXECUTION'};

function routeContext(route){
 const clean=String(route||'').split('?')[0];
 if(clean==='dashboard')return {type:'today',date:localDate()};
 let m=/^(client|file|case|cfile):(.+)$/.exec(clean);
 if(m)return {type:m[1]==='cfile'?'client':m[1],id:m[2],clientId:['client','cfile'].includes(m[1])?m[2]:''};
 m=/^exc:(.+)$/.exec(clean);if(m)return {type:'execution',id:m[1],store:'execution'};
 m=/^rec:([A-Za-z]+):(.+)$/.exec(clean);
 if(m)return {type:'record',store:m[1],id:m[2]};
 return null;
}

const RELATIVE_DATES=new Map([['اليوم',0],['غدا',1],['بكره',1],['بكرة',1]]);
const UNSUPPORTED_DATE_WORDS=new Set(['احد','الاحد','الاثنين','الثلاثاء','الاربعاء','الخميس','الجمعة','السبت','اسبوع','الاسبوع','الشهر']);
const UNSUPPORTED_TIME_WORDS=new Set(['صباحا','صباح','مساء','مساءا','ص','م']);
const cleanNaturalToken=value=>String(value||'').replace(/^[،,؛]+|[،,؛]+$/gu,'');
function naturalError(message){return {recognized:true,ok:false,error:message}}
function validISODate(value){
 const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value);if(!m)return false;
 const year=Number(m[1]),month=Number(m[2]),day=Number(m[3]);
 const date=new Date(Date.UTC(year,month-1,day));
 return year>=1&&date.getUTCFullYear()===year&&date.getUTCMonth()+1===month&&date.getUTCDate()===day;
}
function parse24HourTime(value){
 const m=/^(\d{1,2}):(\d{2})$/.exec(value);if(!m)return null;
 const hour=Number(m[1]),minute=Number(m[2]);
 if(hour>23||minute>59)return false;
 return `${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`;
}

/**
 * A deliberately small, deterministic grammar for Quick Add. It parses only
 * explicit task/appointment prefixes, local relative dates or ISO dates, and
 * 24-hour HH:MM. It never saves; callers must show a preview and open a form.
 */
export function parseNaturalQuickAdd(value,{today=localDate(),homeContext=false}={}){
 const text=normalizeArabic(value);
 const prefix=/^(مهمة|مهمه|موعد)(?:\s+|$)/u.exec(text);
 if(!prefix)return {recognized:false};
 const body=text.slice(prefix[0].length).trim();
 if(!body)return {recognized:false};
 const kind=prefix[1]==='موعد'?'appointment':'task';
 const tokens=body.split(/\s+/),consumed=new Set(),dates=[],times=[];
 for(let i=0;i<tokens.length;i++){
  if(consumed.has(i))continue;
  const token=cleanNaturalToken(tokens[i]),next=cleanNaturalToken(tokens[i+1]);
  if(token==='بعد'&&['غد','غدا','بكره','بكرة'].includes(next)){
   dates.push({date:addDays(today,2)});consumed.add(i);consumed.add(i+1);i++;continue;
  }
  if(token==='بعد'&&/^\d+$/.test(next))return naturalError('الفترات العددية غير مدعومة بعد؛ استخدم اليوم أو غدًا أو بعد غد أو تاريخًا بصيغة YYYY-MM-DD.');
  if(RELATIVE_DATES.has(token)){
   dates.push({date:addDays(today,RELATIVE_DATES.get(token))});consumed.add(i);continue;
  }
  if(/^\d{4}-\d{2}-\d{2}$/.test(token)){
   if(!validISODate(token))return naturalError(`التاريخ «${token}» غير صالح؛ استخدم تاريخًا صحيحًا بصيغة YYYY-MM-DD.`);
   dates.push({date:token});consumed.add(i);continue;
  }
  if(/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(token))return naturalError('صيغة التاريخ الرقمية ملتبسة؛ استخدم YYYY-MM-DD أو اليوم أو غدًا.');
  if(token==='الساعة'&&/^\d{1,2}$/.test(next))return naturalError('اكتب الوقت بصيغة 24 ساعة كاملة مثل 09:30 لتجنّب الالتباس بين الصباح والمساء.');
  const maybeTime=parse24HourTime(token);
  if(maybeTime===false)return naturalError(`الوقت «${token}» خارج النطاق؛ استخدم HH:MM بنظام 24 ساعة.`);
  if(maybeTime){
   times.push({time:maybeTime});consumed.add(i);
   if(i>0&&cleanNaturalToken(tokens[i-1])==='الساعة')consumed.add(i-1);
   continue;
  }
  if(/^\d{1,2}:\d{2}$/.test(token))return naturalError(`الوقت «${token}» غير صالح؛ استخدم HH:MM بنظام 24 ساعة.`);
  if(UNSUPPORTED_DATE_WORDS.has(token))return naturalError('اسم يوم الأسبوع أو الفترة غير مدعوم تلقائيًا؛ حدّد اليوم أو غدًا أو بعد غد أو تاريخًا بصيغة YYYY-MM-DD.');
  if(UNSUPPORTED_TIME_WORDS.has(token))return naturalError('اكتب الوقت بصيغة 24 ساعة مثل 09:30؛ لا يُخمَّن صباحًا أو مساءً.');
 }
 if(dates.length>1)return naturalError('وُجد أكثر من تاريخ؛ أبقِ تاريخًا واحدًا فقط في الجملة.');
 if(times.length>1)return naturalError('وُجد أكثر من وقت؛ أبقِ وقتًا واحدًا فقط في الجملة.');
 const title=tokens.filter((_,index)=>!consumed.has(index)).map(cleanNaturalToken).join(' ').replace(/^[،,؛]+|[،,؛]+$/gu,'').trim();
 if(!title)return naturalError('أضف عنوانًا بعد نوع الإضافة والتاريخ/الوقت.');
 let date=dates[0]?.date||'';
 if(!date&&(kind==='appointment'||homeContext))date=today;
 if(!date&&times.length)return naturalError('أضف تاريخًا صريحًا قبل استخدام وقت للمهمة، أو افتح Quick Add من «مكتب اليوم» ليكون اليوم الافتراضي.');
 const time=times[0]?.time||'';
 const preset={title,...(date?(kind==='task'?{dueDate:date}:{date}):{}),...(time?(kind==='task'?{dueTime:time}:{time}):{})};
 return {recognized:true,ok:true,kind,title,date:date||'',time,preset};
}

/** Context actions shown in both «+ إضافة» and Ctrl+K. */
export function contextualQuickActions(app,explicitContext=null){
 const ctx=explicitContext||routeContext(app?.route);if(!ctx)return [];
 let kind=ctx.type;
 if(kind==='record'){
  if(ctx.store==='clients')kind='client';
  else if(ctx.store==='files')kind='file';
  else if(ctx.store==='cases')kind='case';
  else kind='record';
 }
 return (CONTEXT_ACTIONS[kind]||[]).map(([action,label,iconKey])=>({kind:action,label,icon:iconKey,context:ctx}));
}

async function resolveContext(app,explicit=null){
 const base=explicit||routeContext(app?.route);
 if(!base)return {type:'global'};
 const out={...base};
 if(base.type==='client'){
  out.clientId=base.clientId||base.id;
  out.record=base.record||await app.office.r.clients.get(out.clientId).catch(()=>null);
  return out;
 }
 if(base.type==='cfile'){
  out.type='client';out.clientId=base.clientId||base.id;
  out.record=await app.office.r.clients.get(out.clientId).catch(()=>null);
  return out;
 }
 if(base.type==='file'){
  out.fileId=base.fileId||base.id;out.record=base.record||await app.office.r.files.get(out.fileId).catch(()=>null);
  out.caseId=out.caseId||out.record?.currentStageId||'';
  return out;
 }
 if(base.type==='case'){
  out.caseId=base.caseId||base.id;out.record=base.record||await app.office.r.cases.get(out.caseId).catch(()=>null);
  out.fileId=out.fileId||out.record?.fileId||'';return out;
 }
 if(base.type==='execution'){
  out.record=base.record||await app.office.r.execution.get(base.id).catch(()=>null);
  out.caseId=out.caseId||out.record?.caseId||'';out.fileId=out.fileId||out.record?.fileId||'';out.clientId=out.clientId||out.record?.clientId||'';return out;
 }
 if(base.type==='record'&&base.store&&app.office.r[base.store]){
  out.record=base.record||await app.office.r[base.store].get(base.id).catch(()=>null);
  const row=out.record||{};
  if(base.store==='clients'){out.type='client';out.clientId=row.id;return out}
  if(base.store==='files'){out.type='file';out.fileId=row.id;out.caseId=row.currentStageId||'';return out}
  if(base.store==='cases'){out.type='case';out.caseId=row.id;out.fileId=row.fileId||'';return out}
  out.fileId=out.fileId||row.fileId||'';
  out.caseId=out.caseId||row.caseId||'';
  out.clientId=out.clientId||row.clientId||'';
  if(!out.fileId&&out.caseId)out.fileId=(await app.office.r.cases.get(out.caseId).catch(()=>null))?.fileId||'';
 }
 return out;
}

function noteLink(context){
 if(!context)return [];
 let type=CTX_LINK[context.type];
 let id=context.type==='client'?context.clientId||context.id:context.type==='file'?context.fileId||context.id:context.type==='case'?context.caseId||context.id:context.id||context.clientId||context.fileId||context.caseId;
 if(context.type==='record'){
  type=NOTE_TYPES[context.store];id=context.id;
 }
 if(!type&&context.store)type=NOTE_TYPES[context.store];
 if(!id&&context.record?.id)id=context.record.id;
 return type&&id?[{entityType:type,entityId:String(id),relationType:'CONTEXT'}]:[];
}

async function clientFiles(office,clientId){
 const client=await office.r.clients.get(clientId);if(!client||client.isDeleted)return [];
 let clientFileId=client.clientFileId||'';
 if(clientFileId&&!await office.r.clientFiles.get(clientFileId))clientFileId='';
 if(!clientFileId)clientFileId=(await office.r.clientFiles.byIndex('clientId',clientId,1))[0]?.id||'';
 const [own,links,parties]=await Promise.all([
  clientFileId?office.r.files.byIndex('clientFileId',clientFileId,50):Promise.resolve([]),
  office.r.fileClients.byIndex('clientId',clientId,50),
  office.r.fileParties.byIndex('clientId',clientId,50)
 ]);
 const ids=[...new Set([...own.map(x=>x.id),...links.map(x=>x.fileId),...parties.map(x=>x.fileId)])];
 const rows=await office.r.files.getMany(ids);
 return rows.sort((a,b)=>String(b.lastActivityAt||b.openedAt||'').localeCompare(String(a.lastActivityAt||a.openedAt||'')));
}

function openClientFilePicker(app,clientId,kind){
 clientFiles(app.office,clientId).then(async files=>{
  const clientTitle=esc((await app.office.r.clients.get(clientId).catch(()=>null))?.fullName||'الموكل');
  if(files.length===1)return launchOnFile(app,kind,files[0],{type:'client',clientId});
  if(!files.length){
   const card=modal(`<h2 class="modal-title">اختر ملفًا للعمل</h2><p class="muted">لا يوجد ملف قانوني لهذا الموكل بعد.</p><div class="form-actions"><button type="button" class="primary" data-create-client-file>+ إنشاء ملف للموكل</button><button type="button" class="ghost" data-close>إغلاق</button></div>`);
   card.querySelector('[data-create-client-file]').onclick=async()=>{closeModal();const {openLegalFileWizard}=await import('./client-file.js');openLegalFileWizard(app,{clientId})};
   return;
  }
  const card=modal(`<h2 class="modal-title">اختر ملفًا للعمل</h2><p class="muted small">${clientTitle} — اختر الملف الذي ستُربط به الإضافة.</p><div class="context-file-list">${files.slice(0,50).map(file=>`<button type="button" class="context-file-option" data-file-id="${esc(file.id)}"><b>${esc(formatFileNumber(file.fileNumber)||'ملف بلا رقم')} · ${esc(file.title||'بدون عنوان')}</b><small>${esc(file.fileType||file.mainCategory||'')} ${file.status?`· ${esc(file.status)}`:''}</small></button>`).join('')}</div>${files.length>=50?'<p class="muted small">تظهر أول 50 نتيجة؛ ضيّق ملفات الموكل من صفحته إذا كان الملف المطلوب أقدم.</p>':''}`);
  card.addEventListener('click',e=>{const button=e.target.closest('[data-file-id]');if(!button)return;const file=files.find(row=>row.id===button.dataset.fileId);if(!file)return;closeModal();launchOnFile(app,kind,file,{type:'client',clientId})});
 }).catch(error=>{console.error('client file picker',error);toast('تعذر تحميل ملفات الموكل. حاول مرة أخرى.','error')});
}

async function addStageFirst(app,file){
 const card=modal(`<h2 class="modal-title">لا توجد مرحلة قضائية</h2><p class="muted">هذا الملف لا يحتوي مرحلة قضائية مرتبطة. يمكنك تسجيل المرحلة من بيانات الملف ثم إضافة الجلسة أو الحكم.</p><div class="form-actions"><button type="button" class="primary" data-create-stage>+ إضافة مرحلة</button><button type="button" class="ghost" data-close>إلغاء</button></div>`);
 card.querySelector('[data-create-stage]').onclick=async()=>{closeModal();const {openEntityForm}=await import('../ui/form.js');openEntityForm(app,'cases',{preset:{fileId:file.id},onSaved:()=>app.refresh?.()})};
}

async function launchOnFile(app,kind,file,context={}){
 const office=app.office;
 const preferredStageId=context.caseId||file.currentStageId||'';
 let stage=preferredStageId?await office.r.cases.get(preferredStageId).catch(()=>null):null;
 if(!stage||stage.isDeleted||stage.fileId!==file.id){
  const stages=await office.r.cases.byIndex('fileId',file.id,500).catch(()=>[]);
  const ordered=stages.filter(row=>!row.isDeleted).sort((a,b)=>(Number(a.stageOrder)||999)-(Number(b.stageOrder)||999)||String(a.filingDate||a.createdAt||'').localeCompare(String(b.filingDate||b.createdAt||'')));
  stage=ordered.at(-1)||null;
 }
 const stageId=stage?.id||'';
 const base={fileId:file.id,...(context.clientId?{clientId:context.clientId}:{})};
 if(['hearing','judgment'].includes(kind)&&(!stage||stage.isDeleted))return addStageFirst(app,file);
 const preset={...base,...(stageId?{caseId:stageId}:{})};
 if(stage&&['hearing','judgment'].includes(kind)){
  preset.court=stage.courtId||preset.court||'';preset.chamber=stage.chamber||preset.chamber||'';
  if(kind==='judgment')preset.stage=stage.stageType||'';
 }
 if(kind==='party')preset.partyKind='other';
 const store=FORM_KIND[kind];
 if(!store){toast('الإجراء غير متاح هنا.','warn');return}
 const {openEntityForm}=await import('../ui/form.js');
 return openEntityForm(app,store,{preset,onSaved:()=>app.refresh?.()});
}

export async function runQuickAction(app,kind,{context=null,preset:providedPreset={}}={}){
 const target=await resolveContext(app,context),overrides=providedPreset&&typeof providedPreset==='object'?{...providedPreset}:{};
 if(kind==='note'){
  const links=noteLink(target);
  const {openQuickNoteCapture}=await import('./quick-notes.js');
  return openQuickNoteCapture(app,{context:links.length?links:null,onSaved:()=>app.refresh?.()});
 }
 if(kind==='file'){
  const {openLegalFileWizard,startNewLegalFile}=await import('./client-file.js');
  if(target.clientId)return openLegalFileWizard(app,{clientId:target.clientId});
  return startNewLegalFile(app);
 }
 if(kind==='task'){
  const related=target.store&&target.id?target.store:target.type==='client'?'clients':target.type==='file'?'files':target.type==='case'?'cases':'';
  const id=target.id||target.record?.id;
  if(!related||!id){const {openEntityForm}=await import('../ui/form.js');return openEntityForm(app,'workItems',{preset:{...(target.type==='today'?{dueDate:target.date||localDate()}:{}),...overrides},onSaved:()=>app.refresh?.()})}
  const {openLinkedTaskForm}=await import('../ui/work-actions.js');return openLinkedTaskForm(app,related,id,{overrides,onSaved:()=>app.refresh?.()});
 }
 if(kind==='stage')kind='case';
 const store=FORM_KIND[kind]||(ENTITIES[kind]?kind:null);
 if(!store){toast('الإجراء غير مدعوم.','warn');return}
 if(['hearing','judgment','serviceRecord','procedure','party','document','fee'].includes(kind)){
  if(target.fileId){const file=target.record&&target.type==='file'?target.record:await app.office.r.files.get(target.fileId);if(file)return launchOnFile(app,kind,file,target)}
  if(target.clientId){return openClientFilePicker(app,target.clientId,kind)}
  if(['hearing','judgment','serviceRecord','procedure','party','document','fee'].includes(kind)&&!target.fileId&&target.type!=='global'){
   toast('اختر ملفًا قانونيًا أولًا لربط السجل به.','info');return
  }
 }
 const preset={...overrides};
 if(target.type==='today'&&kind==='appointment')preset.date=preset.date||target.date||localDate();
 if(target.type==='case'&&target.caseId)preset.caseId=target.caseId;
 if(target.clientId&&['appointment','communication'].includes(kind))preset.clientId=target.clientId;
 if(target.fileId&&['appointment','communication'].includes(kind))preset.fileId=target.fileId;
 if(target.type==='case'&&target.fileId)preset.fileId=target.fileId;
 const {openEntityForm}=await import('../ui/form.js');
 return openEntityForm(app,store,{preset,onSaved:()=>app.refresh?.()});
}

function itemButton(item,index,contextIndex=-1){
 return `<button type="button" class="quick-item" role="option" aria-selected="false" id="qa-option-${index}" data-qa-kind="${esc(item.kind)}" data-qa-context-index="${contextIndex}" data-label="${esc(normalizeArabic(`${item.label} ${item.keywords||''}`))}"><span class="quick-ic" aria-hidden="true">${icon(item.icon||'file')}</span><span>${esc(item.label)}</span></button>`;
}

export function openQuickAdd(app){
 const contextItems=contextualQuickActions(app);
 const card=modal(`<h2 class="modal-title">إضافة جديد</h2>
  <section class="qa-natural" role="group" aria-labelledby="qa-natural-label">
   <div class="qa-natural-head"><label id="qa-natural-label" for="qa-natural-input">إضافة بجملة عربية</label><button type="button" class="link" data-qa-natural-help-toggle aria-expanded="false" aria-controls="qa-natural-help">المساعدة</button></div>
   <div class="qa-natural-row">
    <input type="text" id="qa-natural-input" class="qa-natural-input" placeholder="مثال: مهمة مراجعة العقد غدًا الساعة 09:30" autocomplete="off" aria-describedby="qa-natural-status">
    <button type="button" class="ghost" data-qa-natural-parse>معاينة</button>
   </div>
   <p id="qa-natural-help" class="muted small qa-natural-help" hidden>اكتب جملة تبدأ بـ «مهمة» أو «موعد»، ثم العنوان، ثم — اختياريًا — «اليوم» أو «غدًا» أو «بعد غد» أو تاريخ بصيغة YYYY-MM-DD، ووقت بصيغة 24 ساعة مثل 09:30. ما عدا ذلك يُرفض برسالة واضحة، ولا تُكتب أي بيانات قبل فتح النموذج.</p>
   <p id="qa-natural-status" class="qa-natural-message" data-qa-natural-message role="status" hidden></p>
   <div class="qa-natural-preview" data-qa-preview hidden>
    <dl class="qa-preview-list">
     <div><dt>النوع</dt><dd data-preview-kind></dd></div>
     <div><dt>العنوان</dt><dd data-preview-title></dd></div>
     <div><dt>التاريخ</dt><dd data-preview-date></dd></div>
     <div><dt>الوقت</dt><dd data-preview-time></dd></div>
    </dl>
    <p class="muted small">المعاينة لا تحفظ شيئًا؛ النموذج يُفتح أولًا قبل أي كتابة.</p>
    <div class="qa-preview-actions"><button type="button" class="primary" data-qa-natural-open disabled>فتح النموذج بالمعاينة</button><button type="button" class="ghost" data-qa-natural-clear>مسح الجملة</button></div>
   </div>
  </section>
  <input type="search" class="qa-filter" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="qa-options" placeholder="ابحث في الإضافات… مثل: جلسة، موكل، ملاحظة" autocomplete="off" aria-label="فلترة قائمة الإضافة">
  <div id="qa-options" class="qa-options" role="listbox" aria-label="أنواع الإضافة">
   ${contextItems.length?`<section class="quick-context" role="group" aria-label="في السياق الحالي"><h3>في السياق الحالي</h3><div class="quick-grid">${contextItems.map((item,index)=>itemButton(item,index,index)).join('')}</div></section>`:''}
   <section class="quick-primary" role="group" aria-label="الأكثر استخدامًا"><h3>الأكثر استخدامًا</h3><div class="quick-grid">${CORE_ITEMS.map((item,index)=>itemButton(item,index+contextItems.length)).join('')}</div></section>
   <section class="quick-more" id="qa-more" role="group" aria-label="إضافات أخرى" hidden><h3>إضافات أخرى</h3><div class="quick-grid">${OTHER_ITEMS.map((item,index)=>itemButton(item,index+contextItems.length+CORE_ITEMS.length)).join('')}</div></section>
  </div>
  <button type="button" class="link quick-more-toggle" data-quick-more aria-expanded="false" aria-controls="qa-more">إضافات أخرى (${OTHER_ITEMS.length})</button>
  <p class="muted small qa-empty" hidden>لا توجد إضافة مطابقة — جرّب كلمة أقصر.</p>`);
 card.classList.add('quick-card');
 const input=card.querySelector('.qa-filter');
 const naturalInput=card.querySelector('.qa-natural-input');
 const naturalMessage=card.querySelector('[data-qa-natural-message]');
 const naturalPreview=card.querySelector('[data-qa-preview]');
 const naturalOpen=card.querySelector('[data-qa-natural-open]');
 const naturalHelp=card.querySelector('#qa-natural-help');
 const naturalHelpToggle=card.querySelector('[data-qa-natural-help-toggle]');
 let naturalResult=null;
 const naturalDateLabel=date=>{
  if(!date)return '—';
  const today=localDate();
  if(date===today)return `${date} — اليوم`;
  if(date===addDays(today,1))return `${date} — غدًا`;
  if(date===addDays(today,2))return `${date} — بعد غد`;
  return date;
 };
 const updateNatural=()=>{
  const raw=naturalInput.value.trim();
  if(!raw){
   naturalResult=null;naturalPreview.hidden=true;naturalMessage.hidden=true;naturalOpen.disabled=true;
   naturalInput.removeAttribute('aria-invalid');return;
  }
  const route=String(app?.route||'').split('?')[0];
  const parsed=parseNaturalQuickAdd(raw,{today:localDate(),homeContext:route==='dashboard'});
  naturalResult=parsed.recognized&&parsed.ok?parsed:null;
  if(!parsed.recognized){
   naturalMessage.textContent='اكتب جملة تبدأ بـ «مهمة» أو «موعد»، مثل: مهمة مراجعة العقد غدًا الساعة 09:30';
   naturalMessage.classList.remove('is-error');naturalMessage.hidden=false;naturalPreview.hidden=true;naturalOpen.disabled=true;
   naturalInput.setAttribute('aria-invalid','false');return;
  }
  if(!parsed.ok){
   naturalMessage.textContent=parsed.error;naturalMessage.classList.add('is-error');naturalMessage.hidden=false;
   naturalPreview.hidden=true;naturalOpen.disabled=true;naturalInput.setAttribute('aria-invalid','true');return;
  }
  naturalPreview.querySelector('[data-preview-kind]').textContent=parsed.kind==='task'?'مهمة':'موعد';
  naturalPreview.querySelector('[data-preview-title]').textContent=parsed.title;
  naturalPreview.querySelector('[data-preview-date]').textContent=naturalDateLabel(parsed.date|| (parsed.kind==='appointment'||route==='dashboard'?localDate():''));
  naturalPreview.querySelector('[data-preview-time]').textContent=parsed.time||'—';
  naturalMessage.hidden=true;naturalMessage.classList.remove('is-error');
  naturalPreview.hidden=false;naturalOpen.disabled=false;naturalInput.removeAttribute('aria-invalid');
 };
 naturalInput.addEventListener('input',updateNatural);
 naturalInput.addEventListener('keydown',e=>{
  if(e.key==='Enter'){e.preventDefault();updateNatural();if(naturalResult)naturalOpen.focus()}
  else if(e.key==='Escape'){e.preventDefault();closeModal()}
 });
 card.querySelector('[data-qa-natural-parse]').addEventListener('click',()=>{updateNatural();if(naturalResult)naturalOpen.focus()});
 card.querySelector('[data-qa-natural-clear]').addEventListener('click',()=>{naturalInput.value='';updateNatural();naturalInput.focus()});
 naturalHelpToggle.addEventListener('click',()=>{
  const open=naturalHelp.hidden;naturalHelp.hidden=!open;
  naturalHelpToggle.setAttribute('aria-expanded',String(open));
 });
 naturalOpen.addEventListener('click',async()=>{
  if(!naturalResult)return;
  const result=naturalResult;closeModal();
  try{await runQuickAction(app,result.kind,{preset:result.preset})}catch(error){console.error('natural quick add',error);app.fail?.(error)}
 });
 const allButtons=[...card.querySelectorAll('[data-qa-kind]')];
 let active=-1,moreOpen=false;
 const visible=()=>allButtons.filter(button=>!button.hidden&&!button.closest('[hidden]'));
 const setActive=index=>{
  const items=visible();if(!items.length){active=-1;input.removeAttribute('aria-activedescendant');return}
  active=Math.max(0,Math.min(items.length-1,index));
  items.forEach((button,i)=>{const on=i===active;button.classList.toggle('on',on);button.setAttribute('aria-selected',String(on))});
  input.setAttribute('aria-activedescendant',items[active].id);
  items[active].scrollIntoView?.({block:'nearest'});
 };
 const filter=()=>{
  const tokens=normalizeArabic(input.value).split(/\s+/).filter(Boolean);
  for(const button of allButtons)button.hidden=Boolean(tokens.length)&&!tokens.every(token=>button.dataset.label.includes(token));
  const more=card.querySelector('.quick-more'),toggle=card.querySelector('[data-quick-more]');
  const extraMatches=[...more.querySelectorAll('[data-qa-kind]')].some(button=>!button.hidden);
  if(tokens.length)moreOpen=extraMatches;
  else moreOpen=false;
  more.hidden=!moreOpen;
  toggle.hidden=Boolean(tokens.length&&extraMatches);
  toggle.setAttribute('aria-expanded',String(moreOpen));
  card.querySelector('.quick-context')?.toggleAttribute('hidden',!contextItems.length||!card.querySelector('.quick-context [data-qa-kind]:not([hidden])'));
  card.querySelector('.quick-primary')?.toggleAttribute('hidden',!card.querySelector('.quick-primary [data-qa-kind]:not([hidden])'));
  card.querySelector('.qa-empty').hidden=visible().length>0;
  setActive(0);
 };
 input.addEventListener('input',filter);
 input.addEventListener('keydown',e=>{
  if(e.key==='ArrowDown'){e.preventDefault();setActive(active+1)}
  else if(e.key==='ArrowUp'){e.preventDefault();setActive(active<=0?visible().length-1:active-1)}
  else if(e.key==='Enter'){e.preventDefault();const button=visible()[active<0?0:active];button?.click()}
  else if(e.key==='Escape'){e.preventDefault();closeModal()}
 });
 card.querySelector('[data-quick-more]').addEventListener('click',e=>{moreOpen=!moreOpen;card.querySelector('.quick-more').hidden=!moreOpen;e.currentTarget.setAttribute('aria-expanded',String(moreOpen));setActive(moreOpen?visible().length-OTHER_ITEMS.length:0)});
 card.addEventListener('click',async e=>{
  const button=e.target.closest('[data-qa-kind]');if(!button)return;
  const contextIndex=Number(button.dataset.qaContextIndex);
  const contextual=Number.isInteger(contextIndex)&&contextIndex>=0?contextItems[contextIndex]:null;
  const kind=button.dataset.qaKind;
  const context=contextual?.context||null;
  closeModal();
  try{await runQuickAction(app,kind,{context})}catch(error){console.error('quick add',error);app.fail?.(error)}
 });
 card.addEventListener('mousemove',e=>{const button=e.target.closest('[data-qa-kind]');if(button){setActive(visible().indexOf(button))}});
 setTimeout(()=>input.focus(),30);
 filter();
 return card;
}
