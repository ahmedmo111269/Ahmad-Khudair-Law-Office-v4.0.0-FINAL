// خدمة ملف الموكل والملفات القانونية:
//   Client → ClientFile → LegalFile(files) → Stage(cases) → Events
// - التصنيفات وأنواع الملفات والمراحل والقوالب بيانات في taxonomy/caseTemplates وليست كودًا ثابتًا.
// - لا تُكرر بيانات الموكل: ملف الموكل يشير إلى clientId فقط، والملف القانوني يشير إلى clientFileId.
// - المسارات اقتراح إداري: لا توجد أي قاعدة تمنع إضافة مرحلة أو تخطيها أو إنشاء ملف مرتبط.
import {STORE} from '../db/schema.js';
import {transaction,request} from '../db/unit-of-work.js';
import {uid} from '../core/id.js';
import {Clock} from '../core/clock.js';
import {AppError,ERR} from '../core/errors.js';
import {events} from '../core/events.js';
import {normalizeArabic} from '../core/search-normalizer.js';
import {phonesOf,isClosedFile} from '../domain/entities.js';
import {DEFAULT_TAXONOMY,FIELD_SETS,RELATION_TYPES} from '../domain/taxonomy-defaults.js';
import {refreshFileSearchText} from './legal-files.js';

const META_TAX='taxonomy',META_MIG='clientFilesV12';
const pad=(n,w=6)=>String(n).padStart(w,'0');
const stageTypeId=(cat,name)=>`${cat}.st.${normalizeArabic(name).replace(/\s+/g,'_')}`;

// ===================== التصنيفات (Taxonomy) =====================
function buildSeed(now){
 const rows=[],templates=[];
 DEFAULT_TAXONOMY.forEach((c,ci)=>{
  rows.push({id:c.id,kind:'category',parentId:'root',name:c.name,icon:c.icon,description:c.description,color:c.color,sortOrder:ci+1,isActive:true,system:true,createdAt:now,updatedAt:now});
  c.stages.forEach((name,si)=>rows.push({id:stageTypeId(c.id,name),kind:'stageType',parentId:c.id,name,description:'',sortOrder:si+1,isActive:true,system:true,createdAt:now,updatedAt:now}));
  c.types.forEach(([id,name,fieldSet,steps],ti)=>{
   rows.push({id,kind:'fileType',parentId:c.id,name,description:'',fieldSet,fields:FIELD_SETS[fieldSet]||FIELD_SETS.generic,sortOrder:ti+1,isActive:true,system:true,createdAt:now,updatedAt:now});
   if(steps?.length)templates.push({id:'tpl.'+id,fileTypeId:id,name:`المسار المقترح — ${name}`,steps:steps.map(s=>{const optional=s.startsWith('?');const nm=optional?s.slice(1):s;return {name:nm,stageTypeId:stageTypeId(c.id,nm),optional}}),isActive:true,system:true,createdAt:now,updatedAt:now});
  });
 });
 return {rows,templates};
}
/** زرع الشجرة الافتراضية مرة واحدة؛ يضيف فقط ما لا يوجد (لا يغيّر تعديلات المكتب). */
export async function seedTaxonomy(office,{force=false}={}){
 const meta=await office.r.meta.get(META_TAX);
 if(meta?.seeded&&!force)return 0;
 const now=Clock.now();const {rows,templates}=buildSeed(now);
 let added=0;
 await transaction(office.ctx,[STORE.taxonomy,STORE.caseTemplates,STORE.meta],async tx=>{
  const t=tx.objectStore(STORE.taxonomy),tp=tx.objectStore(STORE.caseTemplates);
  for(const r of rows){if(!(await request(t.get(r.id)))){await request(t.put(r));added++}}
  for(const r of templates){if(!(await request(tp.get(r.id)))){await request(tp.put(r));added++}}
  await request(tx.objectStore(STORE.meta).put({id:META_TAX,key:META_TAX,seeded:true,seededAt:now}));
 });
 invalidateTaxonomy(office);
 return added;
}
const taxCache=new WeakMap();
export function invalidateTaxonomy(office){taxCache.delete(office.ctx);events.emit('taxonomy:changed',{},false)}
/** الشجرة كاملة في الذاكرة (صغيرة: مئات الصفوف فقط). */
export async function taxonomy(office){
 if(taxCache.has(office.ctx))return taxCache.get(office.ctx);
 const p=(async()=>{
  const [rows,templates]=await Promise.all([office.r.taxonomy.all(5000),office.r.caseTemplates.all(5000)]);
  const live=rows.filter(r=>!r.isDeleted).sort((a,b)=>(a.sortOrder||0)-(b.sortOrder||0));
  const byId=new Map(live.map(r=>[r.id,r]));
  const categories=live.filter(r=>r.kind==='category');
  const typesOf=cat=>live.filter(r=>r.kind==='fileType'&&r.parentId===cat);
  const stagesOf=cat=>live.filter(r=>r.kind==='stageType'&&r.parentId===cat);
  const tpl=templates.filter(t=>!t.isDeleted);
  return {rows:live,byId,categories,typesOf,stagesOf,templates:tpl,templateFor:typeId=>tpl.find(t=>t.fileTypeId===typeId&&t.isActive!==false)||null,
   fieldsFor:typeId=>byId.get(typeId)?.fields||[]};
 })();
 taxCache.set(office.ctx,p);
 try{return await p}catch(e){taxCache.delete(office.ctx);throw e}
}
export async function saveTaxonomyItem(office,input,id=null){
 const old=id?await office.r.taxonomy.get(id):null;const now=Clock.now();
 const name=String(input.name??old?.name??'').trim();if(!name)throw new AppError(ERR.VALIDATION,'الاسم مطلوب.',{name:'مطلوب'});
 const kind=input.kind||old?.kind;if(!['category','fileType','stageType'].includes(kind))throw new AppError(ERR.VALIDATION,'نوع العنصر غير صحيح.');
 if(kind!=='category'&&!(input.parentId||old?.parentId))throw new AppError(ERR.VALIDATION,'اختر التصنيف.');
 const newId=id||(kind==='category'?'cat.'+uid().slice(-10):`${input.parentId}.${kind==='fileType'?'t':'st'}.${uid().slice(-8)}`);
 const row={...(old||{}),...input,id:newId,kind,name,parentId:kind==='category'?'root':(input.parentId||old.parentId),isActive:input.isActive??old?.isActive??true,sortOrder:input.sortOrder??old?.sortOrder??999,
  fields:kind==='fileType'?(input.fields||old?.fields||FIELD_SETS.generic):undefined,createdAt:old?.createdAt||now,updatedAt:now};
 await office.r.taxonomy.put(row);invalidateTaxonomy(office);return row;
}
export async function saveTemplate(office,fileTypeId,steps,name=''){
 const tax=await taxonomy(office);const type=tax.byId.get(fileTypeId);if(!type)throw new AppError(ERR.NOT_FOUND,'نوع الملف غير موجود.');
 const old=tax.templateFor(fileTypeId);const now=Clock.now();
 const clean=steps.map(s=>({name:String(s.name||'').trim(),optional:Boolean(s.optional),stageTypeId:s.stageTypeId||stageTypeId(type.parentId,s.name)})).filter(s=>s.name);
 const row={...(old||{}),id:old?.id||'tpl.'+fileTypeId,fileTypeId,name:name||old?.name||`المسار المقترح — ${type.name}`,steps:clean,isActive:true,createdAt:old?.createdAt||now,updatedAt:now};
 await office.r.caseTemplates.put(row);invalidateTaxonomy(office);return row;
}

// ===================== ملف الموكل =====================
async function nextCounter(tx,key,year){
 const cs=tx.objectStore(STORE.fileNumberCounters);const id=`${key}:${year}`;
 const c=await request(cs.get(id));const next=(c?.lastNumber||0)+1;
 await request(cs.put({id,year,kind:key,lastNumber:next,updatedAt:Clock.now()}));return next;
}
/** داخل معاملة مفتوحة: يعيد ملف الموكل أو ينشئه مع كود الموكل. */
async function ensureClientFileTx(office,tx,client,now=Clock.now()){
 const cfs=tx.objectStore(STORE.clientFiles);
 if(client.clientFileId){const cf=await request(cfs.get(client.clientFileId));if(cf)return cf}
 const year=String(client.createdAt||now).slice(0,4);
 if(!client.clientCode)client.clientCode=`CL-${year}-${pad(await nextCounter(tx,'client',year))}`;
 const cf={id:uid(),clientId:client.id,clientCode:client.clientCode,status:'نشط',responsibleLawyer:'',openedAt:String(client.createdAt||now).slice(0,10),lastActivityAt:now,notes:'',createdAt:now,updatedAt:now,version:1,isArchived:false,archivedAt:null,isDeleted:false};
 await request(cfs.add(cf));
 client.clientFileId=cf.id;client.updatedAt=now;
 await request(tx.objectStore(STORE.clients).put(client));
 await request(tx.objectStore(STORE.activityLog).add(office.activity('clientFiles',cf.id,'create')));
 return cf;
}
export async function ensureClientFile(office,clientId){
 const c=await office.r.clients.get(clientId);if(!c||c.isDeleted)throw new AppError(ERR.NOT_FOUND,'الموكل غير موجود.');
 if(c.clientFileId){const cf=await office.r.clientFiles.get(c.clientFileId);if(cf)return cf}
 const cf=await transaction(office.ctx,[STORE.clients,STORE.clientFiles,STORE.fileNumberCounters,STORE.activityLog],async tx=>{const fresh=await request(tx.objectStore(STORE.clients).get(clientId));return ensureClientFileTx(office,tx,fresh)});
 events.emit('entity:changed',{entityType:'clientFiles',id:cf.id});return cf;
}
export async function saveClientFile(office,id,patch){
 const cf=await office.r.clientFiles.get(id);if(!cf)throw new AppError(ERR.NOT_FOUND,'ملف الموكل غير موجود.');
 const now=Clock.now();const allowed=['status','responsibleLawyer','openedAt','notes'];
 for(const k of allowed)if(k in patch)cf[k]=patch[k];
 cf.updatedAt=now;cf.version=(cf.version||0)+1;
 await transaction(office.ctx,[STORE.clientFiles,STORE.activityLog],async tx=>{await request(tx.objectStore(STORE.clientFiles).put(cf));await request(tx.objectStore(STORE.activityLog).add(office.activity('clientFiles',id,'update')))});
 return cf;
}
/** أرشفة ملف الموكل: مسموحة فقط عند عدم وجود ملفات نشطة، ولا تحذف أي ملف. */
export async function archiveClientFile(office,id,reason=''){
 const s=await clientFileSummary(office,id);
 if(s.active>0)throw new AppError(ERR.CONFLICT,`لا يمكن أرشفة ملف الموكل وبه ${s.active} ملف نشط. أنهِ الملفات أو أرشفها أولًا.`);
 const cf=await office.r.clientFiles.get(id);const now=Clock.now();
 Object.assign(cf,{isArchived:true,archivedAt:now,archivedReason:reason,status:'مؤرشف',updatedAt:now,version:(cf.version||0)+1});
 await transaction(office.ctx,[STORE.clientFiles,STORE.activityLog],async tx=>{await request(tx.objectStore(STORE.clientFiles).put(cf));await request(tx.objectStore(STORE.activityLog).add(office.activity('clientFiles',id,'archive')))});
 return cf;
}
export async function reopenClientFile(office,id){
 const cf=await office.r.clientFiles.get(id);const now=Clock.now();
 Object.assign(cf,{isArchived:false,archivedAt:null,status:'نشط',updatedAt:now,version:(cf.version||0)+1});
 await transaction(office.ctx,[STORE.clientFiles,STORE.activityLog],async tx=>{await request(tx.objectStore(STORE.clientFiles).put(cf));await request(tx.objectStore(STORE.activityLog).add(office.activity('clientFiles',id,'reopen')))});
 return cf;
}

const STOPPED=['متوقف','موقوف','suspended','محفوظ مؤقتًا'];
/** ملخص ملف الموكل: يقرأ بالفهرس clientFileId فقط (لا getAll على كل الملفات). */
export async function clientFileSummary(office,clientFileId){
 const cf=await office.r.clientFiles.get(clientFileId);if(!cf)throw new AppError(ERR.NOT_FOUND,'ملف الموكل غير موجود.');
 const tax=await taxonomy(office);
 const own=await office.r.files.byIndex('clientFileId',clientFileId,5000);
 // ملفات يظهر فيها الموكل كطرف وهي تابعة لملف موكل آخر (ملف مشترك) — بدون نسخ
 const partyRows=await office.r.fileParties.byIndex('clientId',cf.clientId,5000);
 const ownIds=new Set(own.map(f=>f.id));
 const sharedIds=[...new Set(partyRows.map(p=>p.fileId).filter(id=>!ownIds.has(id)))];
 const found=await office.r.files.getMany(sharedIds);
 // ملفات أُنشئت من شاشات أخرى بدون ملف موكل: تُضم لملف هذا الموكل تلقائيًا (إضافة حقول فقط)
 const adopt=found.filter(f=>!f.clientFileId);
 if(adopt.length){await adoptFiles(office,cf,adopt,tax);}
 const shared=found.filter(f=>f.clientFileId&&f.clientFileId!==clientFileId).map(f=>({...f,__shared:true}));
 const files=[...own,...adopt,...shared];
 const stageIds=files.map(f=>f.currentStageId).filter(Boolean);
 const stages=new Map((await office.r.cases.getMany(stageIds)).map(s=>[s.id,s]));
 const byCategory=new Map(),byType=new Map();
 let active=0,closed=0,stopped=0,archived=0;
 for(const f of files){
  f.__stage=stages.get(f.currentStageId)||null;
  const cat=f.categoryId||'other';byCategory.set(cat,(byCategory.get(cat)||0)+1);
  const t=f.fileTypeId||'';byType.set(t,(byType.get(t)||0)+1);
  if(f.isArchived)archived++;
  if(isClosedFile(f))closed++;else if(STOPPED.includes(f.status))stopped++;else active++;
 }
 files.sort((a,b)=>String(b.lastActivityAt||'').localeCompare(String(a.lastActivityAt||'')));
 const staleBefore=new Date(Date.now()-45*864e5).toISOString();
 return {cf,tax,files,byCategory,byType,total:files.length,active,closed,stopped,archived,
  needsFollowUp:files.filter(f=>!isClosedFile(f)&&(!f.lastActivityAt||f.lastActivityAt<staleBefore)).slice(0,10),
  stoppedFiles:files.filter(f=>STOPPED.includes(f.status)).slice(0,10)};
}
/** آخر الجلسات والأعمال الإدارية لملفات الموكل (محدودة بأحدث 60 ملفًا نشاطًا). */
export async function clientFileEvents(office,files){
 const ids=files.slice(0,60).map(f=>f.id);
 const [h,p]=await Promise.all([Promise.all(ids.map(id=>office.r.hearings.byIndex('fileId',id,50))),Promise.all(ids.map(id=>office.r.procedures.byIndex('fileId',id,50)))]);
 const hearings=h.flat().sort((a,b)=>String(b.hearingDate||'').localeCompare(String(a.hearingDate||'')));
 const procedures=p.flat().sort((a,b)=>String(b.internalDueDate||b.createdAt||'').localeCompare(String(a.internalDueDate||a.createdAt||'')));
 return {hearings:hearings.slice(0,8),procedures:procedures.slice(0,8)};
}

// ===================== الملف القانوني =====================
/**
 * إنشاء ملف قانوني داخل ملف الموكل (معالج الخطوات الثلاث).
 * input: {clientId, categoryId, fileTypeId, title, clientRole, responsibleLawyer, openedAt, steps:[{name,stageTypeId,optional}]|null,
 *         meta:{key:value}, related:{fileId, relationCode, copyParties}}
 */
export async function createLegalFileInClientFile(office,input){
 const tax=await taxonomy(office);
 const cat=tax.byId.get(input.categoryId);if(!cat||cat.kind!=='category')throw new AppError(ERR.VALIDATION,'اختر القسم.',{categoryId:'مطلوب'});
 const type=input.fileTypeId?tax.byId.get(input.fileTypeId):null;if(input.fileTypeId&&(!type||type.parentId!==cat.id))throw new AppError(ERR.VALIDATION,'نوع العمل لا يتبع القسم المختار.');
 const openedAt=input.openedAt||Clock.today();if(!/^\d{4}-\d{2}-\d{2}$/.test(openedAt))throw new AppError(ERR.VALIDATION,'تاريخ الفتح غير صحيح.',{openedAt:'تاريخ غير صحيح'});
 const related=input.related?.fileId?await office.r.files.get(input.related.fileId):null;
 if(input.related?.fileId&&!related)throw new AppError(ERR.NOT_FOUND,'الملف المرتبط غير موجود.');
 const relatedParties=related&&input.related.copyParties!==false?await office.r.fileParties.byIndex('fileId',related.id,500):[];
 const now=Clock.now(),year=openedAt.slice(0,4);
 const steps=(input.steps||[]).filter(s=>String(s.name||'').trim());
 const file={id:uid(),categoryId:cat.id,fileTypeId:type?.id||null,
  mainCategory:cat.name,fileType:type?.name||cat.name,typeSnapshot:{category:cat.name,type:type?.name||'',at:now},
  title:String(input.title||'').trim(),status:input.status||'نشط',priority:input.priority||'normal',openedAt,
  responsibleLawyer:String(input.responsibleLawyer||'').trim(),notes:String(input.notes||''),
  createdAt:now,updatedAt:now,lastActivityAt:now,version:1,isArchived:false,isDeleted:false,deletedAt:null};
 for(const [k,v] of Object.entries(input.meta||{}))if(v!==''&&v!==null&&v!==undefined)file['x_'+k]=v;
 const role=String(input.clientRole||'موكل').trim()||'موكل';
 const out=await transaction(office.ctx,[STORE.files,STORE.cases,STORE.clients,STORE.clientFiles,STORE.fileNumberCounters,STORE.fileClients,STORE.fileParties,STORE.fileRelations,STORE.activityLog],async tx=>{
  const client=await request(tx.objectStore(STORE.clients).get(input.clientId));
  if(!client||client.isDeleted)throw new AppError(ERR.NOT_FOUND,'الموكل غير موجود.');
  const cf=await ensureClientFileTx(office,tx,client,now);
  file.clientFileId=cf.id;
  file.fileNumber=`LF-${year}-${pad(await nextCounter(tx,'lf',year))}`;
  if(!file.title)file.title=[type?.name||cat.name,client.fullName].join(' — ');
  file.titleNormalized=normalizeArabic(file.title);
  // المراحل من القالب (بعد تعديل المستخدم) — الأولى جارية والباقي مخطط
  const cs=tx.objectStore(STORE.cases);
  steps.forEach((s,i)=>{s.__id=uid()});
  for(const [i,s] of steps.entries()){
   await request(cs.add({id:s.__id,fileId:file.id,stageType:s.name,stageTypeId:s.stageTypeId||null,nameSnapshot:s.name,stageOrder:i+1,lifecycle:i===0?'active':'planned',optional:Boolean(s.optional),templateId:input.templateId||null,startedAt:i===0?openedAt:null,createdAt:now,updatedAt:now,version:1,isDeleted:false}));
  }
  file.currentStageId=steps[0]?.__id||null;file.stage=steps[0]?.name||'';
  await request(tx.objectStore(STORE.files).add(file));
  await request(tx.objectStore(STORE.fileClients).put({id:`${file.id}::${client.id}`,fileId:file.id,clientId:client.id,role:'principal',createdAt:now}));
  const fp=tx.objectStore(STORE.fileParties);
  await request(fp.put({id:uid(),fileId:file.id,partyKind:'client',clientId:client.id,opponentId:null,name:client.fullName,phone:phonesOf(client)[0]||'',role,createdAt:now,updatedAt:now,version:1,isDeleted:false}));
  // نسخ روابط الأطراف من الملف الأصل (روابط لنفس الأشخاص، لا نسخ لبياناتهم)
  for(const p of relatedParties){if(p.partyKind==='client'&&p.clientId===client.id)continue;await request(fp.put({...p,id:uid(),fileId:file.id,createdAt:now,updatedAt:now,version:1,copiedFrom:p.id}))}
  if(related){
   const code=RELATION_TYPES[input.related.relationCode]?input.related.relationCode:'RELATED_TO';
   await request(tx.objectStore(STORE.fileRelations).put({id:uid(),sourceFileId:file.id,targetFileId:related.id,relationCode:code,relationType:RELATION_TYPES[code].label,notes:input.related.notes||'',createdAt:now,updatedAt:now,version:1,isDeleted:false}));
   await request(tx.objectStore(STORE.activityLog).add(office.activity('fileRelations',related.id,'link',related.id)));
  }
  cf.lastActivityAt=now;cf.updatedAt=now;await request(tx.objectStore(STORE.clientFiles).put(cf));
  await request(tx.objectStore(STORE.activityLog).add(office.activity('files',file.id,'create',file.id)));
  return file;
 });
 events.emit('entity:changed',{entityType:'files',id:out.id});
 await refreshFileSearchText(office,out.id);
 return out;
}
export async function saveFileMeta(office,fileId,values){
 const f=await office.r.files.get(fileId);if(!f)throw new AppError(ERR.NOT_FOUND,'الملف غير موجود.');
 const now=Clock.now();
 for(const [k,v] of Object.entries(values)){if(v===''||v===null||v===undefined)delete f['x_'+k];else f['x_'+k]=v}
 f.updatedAt=now;f.lastActivityAt=now;f.version=(f.version||0)+1;
 await transaction(office.ctx,[STORE.files,STORE.activityLog],async tx=>{await request(tx.objectStore(STORE.files).put(f));await request(tx.objectStore(STORE.activityLog).add(office.activity('files',fileId,'update',fileId)))});
 await refreshFileSearchText(office,fileId);return f;
}
/** إعادة تصنيف ملف (مثلًا ملف قديم صُنّف تلقائيًا إلى «أخرى»). */
export async function reclassifyFile(office,fileId,categoryId,fileTypeId){
 const tax=await taxonomy(office);const cat=tax.byId.get(categoryId),type=fileTypeId?tax.byId.get(fileTypeId):null;
 if(!cat)throw new AppError(ERR.VALIDATION,'اختر القسم.');
 const f=await office.r.files.get(fileId);const now=Clock.now();
 Object.assign(f,{categoryId:cat.id,fileTypeId:type?.id||null,mainCategory:cat.name,fileType:type?.name||cat.name,needsClassification:false,updatedAt:now,version:(f.version||0)+1});
 f.typeSnapshot={...(f.typeSnapshot||{}),category:cat.name,type:type?.name||'',at:now};
 await transaction(office.ctx,[STORE.files,STORE.activityLog],async tx=>{await request(tx.objectStore(STORE.files).put(f));await request(tx.objectStore(STORE.activityLog).add(office.activity('files',fileId,'reclassify',fileId)))});
 await refreshFileSearchText(office,fileId);return f;
}

// ===================== المراحل =====================
export const LIFECYCLE_ORDER=['planned','active','done','skipped'];
async function stageTx(office,fileId,fn,action){
 const out=await transaction(office.ctx,[STORE.cases,STORE.files,STORE.activityLog],async tx=>{
  const fs=tx.objectStore(STORE.files),cs=tx.objectStore(STORE.cases);
  const file=await request(fs.get(fileId));if(!file||file.isDeleted)throw new AppError(ERR.NOT_FOUND,'الملف غير موجود.');
  const all=(await request(cs.index('fileId').getAll(fileId))).filter(s=>!s.isDeleted).sort((a,b)=>(a.stageOrder||999)-(b.stageOrder||999));
  const res=await fn({file,stages:all,cs,now:Clock.now()});
  const cur=all.find(s=>s.id===file.currentStageId&&!s.isDeleted);
  file.stage=cur?.stageType||'';file.lastActivityAt=Clock.now();file.updatedAt=file.lastActivityAt;file.version=(file.version||0)+1;
  await request(fs.put(file));
  await request(tx.objectStore(STORE.activityLog).add(office.activity('cases',res?.id||fileId,action,fileId)));
  return res;
 });
 events.emit('entity:changed',{entityType:'cases',id:out?.id});
 await refreshFileSearchText(office,fileId);
 return out;
}
/** إضافة مرحلة في أي موضع — بدون أي شرط قانوني. */
export function addStage(office,fileId,{name,stageTypeId=null,afterId=null,makeCurrent=false,lifecycle}={}){
 const nm=String(name||'').trim();if(!nm)throw new AppError(ERR.VALIDATION,'اسم المرحلة مطلوب.');
 return stageTx(office,fileId,async({file,stages,cs,now})=>{
  const idx=afterId?stages.findIndex(s=>s.id===afterId)+1:stages.length;
  const row={id:uid(),fileId,stageType:nm,stageTypeId,nameSnapshot:nm,lifecycle:lifecycle||(makeCurrent?'active':'planned'),startedAt:makeCurrent?Clock.today():null,createdAt:now,updatedAt:now,version:1,isDeleted:false};
  stages.splice(idx,0,row);
  for(const [i,s] of stages.entries()){if(s.stageOrder!==i+1||s===row){s.stageOrder=i+1;if(s!==row){s.updatedAt=now;await request(cs.put(s))}}}
  await request(cs.add(row));
  if(makeCurrent||!file.currentStageId){await markCurrent(file,stages,row,cs,now);await request(cs.put(row))}
  return row;
 },'stage:add');
}
async function markCurrent(file,stages,target,cs,now){
 for(const s of stages){
  if(s.id===target.id)continue;
  if(s.lifecycle==='active'){s.lifecycle='done';s.endedAt=s.endedAt||Clock.today();s.updatedAt=now;await request(cs.put(s))}
 }
 target.lifecycle='active';target.startedAt=target.startedAt||Clock.today();target.updatedAt=now;
 file.currentStageId=target.id;
}
export function setCurrentStage(office,fileId,stageId){
 return stageTx(office,fileId,async({file,stages,cs,now})=>{const t=stages.find(s=>s.id===stageId);if(!t)throw new AppError(ERR.NOT_FOUND,'المرحلة غير موجودة.');await markCurrent(file,stages,t,cs,now);await request(cs.put(t));return t},'stage:current');
}
/** تغيير حالة المرحلة: planned | active | done | skipped، مع نتيجة اختيارية. */
export function setStageLifecycle(office,fileId,stageId,lifecycle,{outcome,endedAt}={}){
 if(!LIFECYCLE_ORDER.includes(lifecycle))throw new AppError(ERR.VALIDATION,'حالة المرحلة غير صحيحة.');
 return stageTx(office,fileId,async({file,stages,cs,now})=>{
  const t=stages.find(s=>s.id===stageId);if(!t)throw new AppError(ERR.NOT_FOUND,'المرحلة غير موجودة.');
  if(lifecycle==='active'){await markCurrent(file,stages,t,cs,now)}
  else{
   t.lifecycle=lifecycle;t.updatedAt=now;
   if(lifecycle==='done')t.endedAt=endedAt||t.endedAt||Clock.today();
   if(outcome!==undefined)t.outcome=outcome;
   // إذا انتهت المرحلة الحالية: اقترح التالية المخططة كحالية (المستخدم يستطيع التغيير)
   if(file.currentStageId===t.id&&lifecycle!=='planned'){
    const next=stages.find(s=>(s.stageOrder||0)>(t.stageOrder||0)&&s.lifecycle==='planned');
    if(next){next.lifecycle='active';next.startedAt=Clock.today();next.updatedAt=now;await request(cs.put(next));file.currentStageId=next.id}
   }
  }
  if(outcome!==undefined)t.outcome=outcome;
  await request(cs.put(t));return t;
 },'stage:'+lifecycle);
}
export function moveStage(office,fileId,stageId,dir){
 return stageTx(office,fileId,async({stages,cs,now})=>{
  const i=stages.findIndex(s=>s.id===stageId),j=i+dir;if(i<0||j<0||j>=stages.length)return stages[i];
  [stages[i],stages[j]]=[stages[j],stages[i]];
  for(const [k,s] of stages.entries()){if(s.stageOrder!==k+1){s.stageOrder=k+1;s.updatedAt=now;await request(cs.put(s))}}
  return stages[j];
 },'stage:move');
}
export function removePlannedStage(office,fileId,stageId){
 return stageTx(office,fileId,async({file,stages,cs,now})=>{
  const t=stages.find(s=>s.id===stageId);if(!t)throw new AppError(ERR.NOT_FOUND,'المرحلة غير موجودة.');
  if(t.caseNumber||t.filingDate)throw new AppError(ERR.CONFLICT,'المرحلة تحتوي بيانات قضائية. استخدم «تخطي» أو احذفها من صفحة المرحلة.');
  t.isDeleted=true;t.deletedAt=now;t.updatedAt=now;await request(cs.put(t));
  if(file.currentStageId===t.id)file.currentStageId=stages.find(s=>s.id!==t.id&&s.lifecycle==='active')?.id||null;
  return t;
 },'stage:remove');
}

// ===================== الأصول: عقار / مركبة / منظمة =====================
export const ASSET_KINDS={
 property:{label:'عقار',icon:'🏠',fields:[['name','وصف مختصر'],['propertyType','نوع العقار'],['governorate','المحافظة'],['city','المركز / المدينة'],['village','القرية / الحي'],['basin','الحوض'],['parcel','القطعة'],['propertyNumber','رقم العقار'],['unit','الوحدة'],['area','المساحة'],['address','العنوان']]},
 vehicle:{label:'مركبة',icon:'🚗',fields:[['plate','رقم اللوحة'],['name','وصف مختصر'],['vehicleType','نوع المركبة'],['make','الماركة'],['model','الموديل'],['chassis','رقم الشاسيه'],['engine','رقم الموتور'],['licenseInfo','بيانات الترخيص']]},
 organization:{label:'شركة / منظمة',icon:'🏭',fields:[['name','الاسم القانوني'],['tradeName','الاسم التجاري'],['legalForm','الشكل القانوني'],['commercialRegister','السجل التجاري'],['taxNumber','الرقم الضريبي'],['headquarters','المقر'],['representatives','الممثلون']]}
};
export const assetDetails=a=>(ASSET_KINDS[a?.kind]?.fields||[]).filter(([k])=>k!=='name'&&a[k]).slice(0,4).map(([k,l])=>`${l}: ${a[k]}`).join(' · ');
export async function saveAsset(office,kind,data,id=null){
 if(!ASSET_KINDS[kind])throw new AppError(ERR.VALIDATION,'نوع الأصل غير صحيح.');
 const old=id?await office.r.assets.get(id):null;const now=Clock.now();
 const row={...(old||{}),...data,id:id||uid(),kind,createdAt:old?.createdAt||now,updatedAt:now,version:(old?.version||0)+1,isDeleted:false};
 row.name=String(row.name||row.plate||'').trim();if(!row.name)throw new AppError(ERR.VALIDATION,'اكتب وصفًا مختصرًا أو رقمًا مميزًا.');
 row.nameNormalized=normalizeArabic(row.name);if(row.plate)row.plate=normalizeArabic(row.plate);
 await office.r.assets.put(row);return row;
}
export async function linkAsset(office,fileId,assetId,role=''){
 const id=`${fileId}::${assetId}`;const now=Clock.now();
 await transaction(office.ctx,[STORE.fileAssets,STORE.activityLog],async tx=>{await request(tx.objectStore(STORE.fileAssets).put({id,fileId,assetId,role,createdAt:now,isDeleted:false}));await request(tx.objectStore(STORE.activityLog).add(office.activity('fileAssets',id,'link',fileId)))});
}
export async function unlinkAsset(office,fileId,assetId){
 const id=`${fileId}::${assetId}`;const row=await office.r.fileAssets.get(id);if(!row)return;
 row.isDeleted=true;row.deletedAt=Clock.now();await office.r.fileAssets.put(row);
}
export async function fileAssets(office,fileId){
 const links=await office.r.fileAssets.byIndex('fileId',fileId,200);
 const assets=new Map((await office.r.assets.getMany(links.map(l=>l.assetId))).map(a=>[a.id,a]));
 return links.filter(l=>!l.isDeleted).map(l=>({link:l,asset:assets.get(l.assetId)})).filter(x=>x.asset&&!x.asset.isDeleted);
}
export async function assetFiles(office,assetId){
 const links=(await office.r.fileAssets.byIndex('assetId',assetId,500)).filter(l=>!l.isDeleted);
 return office.r.files.getMany(links.map(l=>l.fileId));
}
export async function findAssets(office,q,kind=''){
 const n=normalizeArabic(q||'');if(!n)return [];
 const [a,b]=await Promise.all([office.r.assets.prefix('nameNormalized',n,20),office.r.assets.prefix('plate',n,20)]);
 const m=new Map([...a,...b].map(x=>[x.id,x]));return [...m.values()].filter(x=>!kind||x.kind===kind);
}

async function adoptFiles(office,cf,list,tax){
 await transaction(office.ctx,[STORE.files],async tx=>{const fs=tx.objectStore(STORE.files);for(const f of list){
  const fresh=await request(fs.get(f.id));if(!fresh||fresh.clientFileId)continue;
  const cls=fresh.categoryId?{categoryId:fresh.categoryId,fileTypeId:fresh.fileTypeId,sure:true}:classifyLegacy(fresh);
  const cat=tax.byId.get(cls.categoryId),type=cls.fileTypeId?tax.byId.get(cls.fileTypeId):null;
  Object.assign(fresh,{clientFileId:cf.id,categoryId:cat?.id||'other',fileTypeId:type?.id||null,typeSnapshot:fresh.typeSnapshot||{category:cat?.name||'',type:type?.name||'',legacyFileType:fresh.fileType||'',at:Clock.now()},needsClassification:!cls.sure,v12:true});
  await request(fs.put(fresh));Object.assign(f,fresh);
 }});
}

// ===================== ترحيل البيانات القديمة (v11 → v12) =====================
// إضافي فقط وقابل للاستئناف: لا يحذف ولا يغيّر أي قيمة قائمة، فقط يضيف clientCode/clientFileId/categoryId...
const LEGACY_MAP=[
 [/جنائ|جنح|جناي|محضر/,'criminal',null],[/اسر|أسر/,'family','family.lawsuit'],[/تسوي|صلح/,'family','family.settlement'],
 [/مجلس الدول|اداري|إداري/,'stateCouncil','sc.lawsuit'],[/اقتصاد|تجار/,'economic','eco.lawsuit'],[/مدن|عمال/,'civil','civil.lawsuit'],
 [/تنفيذ/,'civil',null],[/استشار/,'other','other.consultation'],[/ضريب/,'tax',null],[/تامين|تأمين|معاش/,'insurance',null],
 [/شهر|توثيق|سجل عقار/,'realEstate',null],[/شرك/,'corporate',null],[/تحكيم/,'arbitration','arb.case'],[/مرور/,'traffic',null],[/رخص|ترخيص/,'licenses',null]
];
function criminalType(f){const t=normalizeArabic(f.crimProcedureType||'');if(/محضر|بلاغ/.test(t))return 'criminal.report';if(/جنايه|جناية/.test(t))return 'criminal.felony';if(/جنح/.test(t))return 'criminal.misdemeanor';return null}
export function classifyLegacy(f){
 const text=normalizeArabic([f.fileType,f.mainCategory,f.subCategory].filter(Boolean).join(' '));
 for(const [re,cat,type] of LEGACY_MAP)if(re.test(text))return {categoryId:cat,fileTypeId:cat==='criminal'?criminalType(f):type,sure:true};
 return {categoryId:'other',fileTypeId:'other.general',sure:false};
}
export async function migrateToClientFiles(office,onProgress=null){
 const meta=(await office.r.meta.get(META_MIG))||{id:META_MIG,key:META_MIG};
 if(meta.done)return {clients:0,files:0,skipped:true};
 await snapshotBeforeV12(office,meta);
 await seedTaxonomy(office);
 const tax=await taxonomy(office);
 let clients=0,files=0;
 // 1) كود وملف رئيسي لكل موكل
 let cursor=meta.clientCursor||null;
 do{
  const page=await office.r.clients.page({limit:100,cursor});
  const todo=page.items.filter(c=>!c.clientFileId);
  if(todo.length)await transaction(office.ctx,[STORE.clients,STORE.clientFiles,STORE.fileNumberCounters,STORE.activityLog],async tx=>{for(const c of todo){const fresh=await request(tx.objectStore(STORE.clients).get(c.id));if(!fresh.clientFileId){await ensureClientFileTx(office,tx,fresh,fresh.createdAt||Clock.now());clients++}}});
  cursor=page.nextCursor;
  await office.r.meta.put({...meta,clientCursor:cursor});onProgress?.({phase:'clients',clients});
 }while(cursor);
 // 2) ربط كل ملف قانوني بملف موكله الأساسي وتصنيفه
 cursor=null;
 do{
  const page=await office.r.files.page({limit:100,cursor});
  const todo=page.items.filter(f=>!f.v12);
  if(todo.length){
   const plan=[];
   for(const f of todo){
    const [links,parties,stages]=await Promise.all([office.r.fileClients.byIndex('fileId',f.id,50),office.r.fileParties.byIndex('fileId',f.id,100),office.r.cases.byIndex('fileId',f.id,200)]);
    const principal=links.find(l=>l.role==='principal')?.clientId||links[0]?.clientId||parties.find(p=>p.partyKind==='client')?.clientId||null;
    const client=principal?await office.r.clients.get(principal):null;
    const cls=f.categoryId?{categoryId:f.categoryId,fileTypeId:f.fileTypeId,sure:true}:classifyLegacy(f);
    const sorted=stages.sort((a,b)=>(Number(a.stageOrder)||999)-(Number(b.stageOrder)||999)||String(a.filingDate||a.createdAt||'').localeCompare(String(b.filingDate||b.createdAt||'')));
    plan.push({f,clientFileId:client?.clientFileId||null,cls,stages:sorted});
   }
   await transaction(office.ctx,[STORE.files,STORE.cases],async tx=>{
    const fs=tx.objectStore(STORE.files),cs=tx.objectStore(STORE.cases);
    for(const {f,clientFileId,cls,stages} of plan){
     const fresh=await request(fs.get(f.id));if(!fresh||fresh.v12)continue;
     const cat=tax.byId.get(cls.categoryId),type=cls.fileTypeId?tax.byId.get(cls.fileTypeId):null;
     Object.assign(fresh,{clientFileId:fresh.clientFileId||clientFileId||undefined,categoryId:cat?.id||'other',fileTypeId:type?.id||null,
      typeSnapshot:fresh.typeSnapshot||{category:cat?.name||'',type:type?.name||'',legacyFileType:f.fileType||'',legacyMainCategory:f.mainCategory||'',at:Clock.now()},
      needsClassification:!cls.sure,v12:true});
     if(!fresh.clientFileId)delete fresh.clientFileId;
     if(!fresh.currentStageId&&stages.length){
      const last=stages.at(-1);fresh.currentStageId=last.id;
      for(const [i,s] of stages.entries()){if(!s.lifecycle){s.lifecycle=s===last?'active':'done';s.nameSnapshot=s.nameSnapshot||s.stageType||'';await request(cs.put(s))}}
     }
     await request(fs.put(fresh));files++;
    }
   });
  }
  cursor=page.nextCursor;onProgress?.({phase:'files',files});
 }while(cursor);
 await office.r.meta.put({...meta,clientCursor:null,done:true,doneAt:Clock.now(),clients,files});
 return {clients,files};
}
export async function unclassifiedFiles(office,limit=200){return office.r.files.reportRange({index:'categoryId',lower:'other',upper:'other',limit,filter:f=>f.needsClassification})}
export async function orphanFiles(office,limit=200){return office.r.files.reportRange({index:'lastActivityAt',limit,direction:'prev',filter:f=>!f.clientFileId})}

// نسخة أمان تلقائية قبل أول ترقية v12 تُحفظ داخل القاعدة نفسها (meta.preV12Backup) ويمكن تنزيلها من الإعدادات.
async function snapshotBeforeV12(office,meta){
 if(meta.snapshotAt)return;
 try{
  const hasFiles=(await office.r.files.reportRange({index:'lastActivityAt',limit:1}).catch(()=>[])).length||(await office.r.clients.reportRange({index:'createdAt',limit:1}).catch(()=>[])).length;
  if(!hasFiles){meta.snapshotAt='empty';return}
  const {exportDatabase}=await import('./backup.js');
  const data=await exportDatabase(office.ctx);
  await office.r.meta.put({id:'preV12Backup',key:'preV12Backup',createdAt:Clock.now(),data});
  meta.snapshotAt=Clock.now();await office.r.meta.put(meta);
 }catch(e){console.warn('preV12 snapshot skipped',e)}
}
export async function preV12Backup(office){return office.r.meta.get('preV12Backup')}
