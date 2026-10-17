// =====================================================================
// بيانات إدارة الملفات (Files Admin) — سجلات إدارية **جديدة** لا تنسخ أي بيانات
// قانونية قائمة، وتُخزَّن في مخزن الإعدادات القائم (settings) كسجلات مفتاحية،
// فلا يلزم ترحيل مخطط IndexedDB ولا يتغير إصدار قاعدة البيانات.
// ---------------------------------------------------------------------
// ما يُحفظ هنا:
//   • قوالب قوائم التحقق لكل مجموعة نوع ملف + حالة الإنجاز لكل ملف.
//   • القرارات الإدارية الداخلية للمكتب (منفصلة تمامًا عن النشاط والأحداث القضائية).
//   • تاريخ تغيّر الحقول المهمة (اختياري، بقرار المستخدم، ومحدود الحجم والعدد).
//   • لقطات تقرير الملف المختارة (للمقارنة بين نسختين) — لا نسخ لقاعدة المكتب.
//   • آخر زيارات الملفات (في تفضيلات المستخدم فقط، منفصلة عن النشاط).
// كل السجلات تحمل officeId/updatedAt/version، ولا تحذف أي بيانات أصلية.
// =====================================================================
import {prefs,scopedPreferenceKey} from '../core/preferences.js';
import {Clock} from '../core/clock.js';
import {uid} from '../core/id.js';

const NS='fileAdmin';
const KEY=(kind,id='')=>`${NS}:${kind}${id?':'+id:''}`;
const VISITS_KEY='ui:file-visits';
const VISIT_CAP=40;
const FIELD_HISTORY_CAP=40;
const SNAPSHOT_CAP=5;
const SNAPSHOT_MAX_BYTES=400000;

export const CHECKLIST_GROUPS=Object.freeze({
 default:[
  {id:'opened',label:'تاريخ فتح الملف مسجل'},
  {id:'responsible',label:'المحامي المسؤول محدد'},
  {id:'parties',label:'الموكل والخصم مسجلان في الأطراف'},
  {id:'contact',label:'بيانات الاتصال الأساسية متاحة'},
  {id:'documents',label:'المستندات الأساسية مسجلة أو مرفقة'},
  {id:'notes',label:'ملاحظات المتابعة الإدارية محدثة'}
 ],
 civil:[
  {id:'opened',label:'تاريخ فتح الملف مسجل'},
  {id:'client',label:'الموكل مرتبط بالملف'},
  {id:'opponent',label:'الخصم مسجل'},
  {id:'stage',label:'المرحلة القضائية مسجلة (إن وجدت)'},
  {id:'poa',label:'التوكيل الصادر من الموكل متوفر'},
  {id:'evidence',label:'حافظة المستندات والمستندات الأساسية جاهزة'},
  {id:'fees',label:'بيان الأتعاب الإدارية محفوظ'}
 ],
 criminal:[
  {id:'opened',label:'تاريخ فتح الملف مسجل'},
  {id:'client',label:'الموكل مرتبط بالملف'},
  {id:'case',label:'رقم القضية أو المحضر مسجل'},
  {id:'poa',label:'التوكيل متوفر'},
  {id:'documents',label:'المستندات والمحاضر الأساسية مسجلة'},
  {id:'responsible',label:'المحامي المسؤول محدد'}
 ],
 family:[
  {id:'opened',label:'تاريخ فتح الملف مسجل'},
  {id:'client',label:'الموكل مرتبط بالملف'},
  {id:'parties',label:'أطراف النزاع مسجلون'},
  {id:'documents',label:'مستندات الحالة المدنية الأساسية مسجلة'},
  {id:'poa',label:'التوكيل متوفر'},
  {id:'notes',label:'ملاحظات المتابعة الإدارية محدثة'}
 ],
 admin:[
  {id:'request',label:'نطاق العمل الإداري محدد في الملاحظات'},
  {id:'owner',label:'المسؤول عن المتابعة محدد'},
  {id:'deadline',label:'موعد المتابعة الإداري مسجل'},
  {id:'documents',label:'المستندات اللازمة متوفرة'},
  {id:'client',label:'الموكل مرتبط بالملف'}
 ]
});

function normalText(value){return String(value??'').trim()}
function safeArray(value){return Array.isArray(value)?value:[]}

async function readRaw(office,key){
 if(!office?.r?.settings?.get)return null;
 try{const row=await office.r.settings.get(key);return row&&typeof row==='object'?row:null}catch{return null}
}
async function readRow(office,key){
 const row=await readRaw(office,key);
 return row?(row.value??null):null;
}
async function writeRow(office,key,value){
 if(!office?.r?.settings?.put)throw new Error('مخزن إعدادات المكتب غير متاح.');
 const previous=await readRaw(office,key);
 const row={id:key,key,namespace:NS,value,updatedAt:Clock.now(),version:(Number(previous?.version)||0)+1};
 await office.r.settings.put(row);
 return value;
}

// ===== قوائم التحقق =====
export function defaultChecklist(group='default'){
 return (CHECKLIST_GROUPS[group]||CHECKLIST_GROUPS.default).map(item=>({...item}));
}
export async function getChecklistTemplate(office,group='default'){
 const saved=await readRow(office,KEY('checklist-template',group||'default'));
 const items=safeArray(saved?.items).filter(item=>item&&item.id&&item.label).map(item=>({id:String(item.id),label:normalText(item.label)}));
 return {group:group||'default',items:items.length?items:defaultChecklist(group),custom:Boolean(saved?.custom),updatedAt:saved?.updatedAt||''};
}
export async function saveChecklistTemplate(office,group,items,{custom=true}={}){
 const clean=safeArray(items).map((item,index)=>({
  id:normalText(item.id)||`item-${index+1}`,
  label:normalText(item.label)
 })).filter(item=>item.label);
 if(!clean.length)throw new Error('قائمة التحقق لا يمكن أن تكون فارغة.');
 await writeRow(office,KEY('checklist-template',group||'default'),{group:group||'default',items:clean,custom,updatedAt:Clock.now()});
 return getChecklistTemplate(office,group);
}
export async function resetChecklistTemplate(office,group){
 await writeRow(office,KEY('checklist-template',group||'default'),null);
 return getChecklistTemplate(office,group);
}

export async function getFileChecklist(office,fileId,group='default'){
 const [template,saved]=await Promise.all([
  getChecklistTemplate(office,group),
  readRow(office,KEY('checklist',fileId))
 ]);
 const state=saved?.items&&typeof saved.items==='object'?saved.items:{};
 const items=template.items.map(item=>({...item,...(state[item.id]||{})}));
 // عناصر أُزيلت من القالب ولم تُحذف: تبقى ظاهرة كسجل تاريخي ولا تُفقد.
 for(const [id,value] of Object.entries(state)){
  if(template.items.some(item=>item.id===id))continue;
  items.push({id,label:value.label||`بند سابق (${id})`,legacy:true,...value});
 }
 const done=items.filter(item=>item.done).length;
 return {fileId,group:group||'default',items,done,total:items.length,percent:items.length?Math.round(done/items.length*100):0,updatedAt:saved?.updatedAt||''};
}
export async function toggleChecklistItem(office,fileId,itemId,{done=null,label='',by=''}={}){
 const saved=await readRow(office,KEY('checklist',fileId));
 const items={...(saved?.items||{})};
 const current=items[itemId]||{done:false};
 const nextDone=done===null?!current.done:Boolean(done);
 items[itemId]={...current,label:label||current.label||'',done:nextDone,at:nextDone?Clock.now():null,by:by||current.by||''};
 await writeRow(office,KEY('checklist',fileId),{fileId,items,updatedAt:Clock.now()});
 return getFileChecklist(office,fileId,saved?.group||'default');
}
export async function resetFileChecklist(office,fileId){
 await writeRow(office,KEY('checklist',fileId),{fileId,items:{},updatedAt:Clock.now()});
 return getFileChecklist(office,fileId);
}

// ===== القرارات الإدارية الداخلية =====
export async function listAdminDecisions(office,fileId){
 const row=await readRow(office,KEY('decisions',fileId));
 return safeArray(row?.items).filter(item=>item&&!item.deleted).sort((a,b)=>String(b.at||'').localeCompare(String(a.at||'')));
}
export async function addAdminDecision(office,fileId,{text,author='',context='',at=null}={}){
 const body=normalText(text);
 if(!body)throw new Error('نص القرار الإداري مطلوب.');
 if(body.length>4000)throw new Error('نص القرار أطول من الحد المسموح (4000 حرف).');
 const row=await readRow(office,KEY('decisions',fileId));
 const items=safeArray(row?.items);
 const item={id:uid(),at:at||Clock.now(),text:body,author:normalText(author),context:normalText(context),kind:'ADMIN_DECISION',deleted:false};
 items.unshift(item);
 await writeRow(office,KEY('decisions',fileId),{fileId,items,updatedAt:Clock.now()});
 return item;
}
export async function deleteAdminDecision(office,fileId,decisionId,{reason=''}={}){
 const row=await readRow(office,KEY('decisions',fileId));
 const items=safeArray(row?.items).map(item=>item.id===decisionId?{...item,deleted:true,deletedAt:Clock.now(),deleteReason:normalText(reason)}:item);
 await writeRow(office,KEY('decisions',fileId),{fileId,items,updatedAt:Clock.now()});
 return listAdminDecisions(office,fileId);
}

// ===== تاريخ تغيّر الحقول (اختياري ومراقب) =====
const FIELD_HISTORY_KEY='ui:file-field-history';
export function fieldHistoryEnabled(){return prefs.get(FIELD_HISTORY_KEY,true)!==false}
export function setFieldHistoryEnabled(enabled){return prefs.set(FIELD_HISTORY_KEY,Boolean(enabled))}
export async function recordFieldChanges(office,fileId,changes,{actor='',source='form'}={}){
 if(!fileId||!Array.isArray(changes)||!changes.length)return null;
 if(!fieldHistoryEnabled())return null;
 const row=await readRow(office,KEY('field-history',fileId));
 const items=safeArray(row?.items);
 items.unshift({
  id:uid(),at:Clock.now(),actor:normalText(actor),source,
  changes:changes.slice(0,30).map(change=>({
   field:String(change.field||''),
   label:String(change.label||change.field||''),
   before:String(change.before??'').slice(0,500),
   after:String(change.after??'').slice(0,500),
   truncated:String(change.before??'').length>500||String(change.after??'').length>500
  }))
 });
 await writeRow(office,KEY('field-history',fileId),{fileId,items:items.slice(0,FIELD_HISTORY_CAP),updatedAt:Clock.now()});
 return items[0];
}
export async function listFieldHistory(office,fileId){
 const row=await readRow(office,KEY('field-history',fileId));
 return safeArray(row?.items).slice(0,FIELD_HISTORY_CAP);
}
export async function clearFieldHistory(office,fileId){
 await writeRow(office,KEY('field-history',fileId),{fileId,items:[],updatedAt:Clock.now()});
 return [];
}

// ===== لقطات تقرير الملف (للمقارنة بين نسختين) =====
export async function listReportSnapshots(office,fileId){
 const row=await readRow(office,KEY('report-snapshots',fileId));
 return safeArray(row?.items).sort((a,b)=>String(b.at||'').localeCompare(String(a.at||'')));
}
export async function saveReportSnapshot(office,fileId,snapshot,{note=''}={}){
 if(!fileId||!snapshot||typeof snapshot!=='object')throw new Error('لا توجد بيانات تقرير قابلة للحفظ.');
 const body={version:1,fileId,at:Clock.now(),note:normalText(note),sections:snapshot.sections||snapshot};
 const serialized=JSON.stringify(body);
 if(serialized.length>SNAPSHOT_MAX_BYTES)throw new Error('حجم لقطة التقرير أكبر من الحد الآمن. اختر أقسامًا أقل.');
 const row=await readRow(office,KEY('report-snapshots',fileId));
 const items=safeArray(row?.items);
 const item={id:uid(),...body};
 items.unshift(item);
 await writeRow(office,KEY('report-snapshots',fileId),{fileId,items:items.slice(0,SNAPSHOT_CAP),updatedAt:Clock.now()});
 return item;
}
export async function deleteReportSnapshot(office,fileId,snapshotId){
 const row=await readRow(office,KEY('report-snapshots',fileId));
 const items=safeArray(row?.items).filter(item=>item.id!==snapshotId);
 await writeRow(office,KEY('report-snapshots',fileId),{fileId,items,updatedAt:Clock.now()});
 return items;
}

// ===== آخر الزيارات (تفضيل مستخدم — منفصل عن النشاط والزيارة القانونية) =====
export function getFileVisits(scope=''){
 const list=prefs.get(scopedPreferenceKey(VISITS_KEY,scope),[]);
 return safeArray(list).filter(item=>item&&item.fileId).slice(0,VISIT_CAP);
}
export function recordFileVisit(fileId,{tab='summary',scope='',title='',source='file-page',lastActivityAt='' }={}){
 if(!fileId)return getFileVisits(scope);
 const key=scopedPreferenceKey(VISITS_KEY,scope);
 const list=getFileVisits(scope).filter(item=>item.fileId!==fileId);
 list.unshift({fileId,tab:String(tab||'summary'),at:Clock.now(),title:String(title||'').slice(0,120),source,lastActivityAt:String(lastActivityAt||'')});
 prefs.set(key,list.slice(0,VISIT_CAP));
 return list.slice(0,VISIT_CAP);
}
export function updateVisitTab(fileId,tab,{scope=''}={}){
 if(!fileId)return;
 const key=scopedPreferenceKey(VISITS_KEY,scope);
 const list=getFileVisits(scope);
 const index=list.findIndex(item=>item.fileId===fileId);
 if(index<0)return recordFileVisit(fileId,{tab,scope});
 list[index]={...list[index],tab:String(tab||'summary'),at:Clock.now()};
 prefs.set(key,list);
}
export function removeFileVisit(fileId,{scope=''}={}){
 const key=scopedPreferenceKey(VISITS_KEY,scope);
 const list=getFileVisits(scope).filter(item=>item.fileId!==fileId);
 prefs.set(key,list);
 return list;
}
export function clearFileVisits({scope=''}={}){
 prefs.set(scopedPreferenceKey(VISITS_KEY,scope),[]);
 return [];
}

/** ملخص ما هو محفوظ إداريًا لملف — لعرض المصدر بوضوح في الواجهة. */
export async function fileAdminSummary(office,fileId,group='default'){
 const [checklist,decisions,history,snapshots]=await Promise.all([
  getFileChecklist(office,fileId,group).catch(()=>null),
  listAdminDecisions(office,fileId).catch(()=>[]),
  listFieldHistory(office,fileId).catch(()=>[]),
  listReportSnapshots(office,fileId).catch(()=>[])
 ]);
 return {
  checklist,decisionsCount:decisions.length,lastDecision:decisions[0]||null,
  historyCount:history.length,snapshotsCount:snapshots.length,
  source:'settings (data admin)',
  disclaimer:'سجلات إدارية داخلية — ليست وقائع قضائية ولا أحكامًا ولا مواعيد قانونية.'
 };
}
