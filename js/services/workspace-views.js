// =====================================================================
// طرق العرض ومساحات العمل المسماة — امتداد واحد فوق نظام التفضيلات القائم.
// ---------------------------------------------------------------------
// • لا نظام تخصيص ثانٍ: الإعدادات الفعلية تبقى في display-prefs وgrid prefs
//   وlist-view. هنا فقط «اسم + مرجع/لقطة صغيرة» لتلك الإعدادات mesma.
// • ما يُحفظ: مرشحات قائمة الملفات، اسم/لقطة عرض الجدول، التبويب المقصود،
//   وترتيب/إخفاء الأقسام الذي يحفظه النظام المركزي أصلًا. لا سجلات ولا بيانات موكلين.
// • التصدير/الاستيراد يستخدمان قائمة مفاتيح بيضاء صريحة، ويرفضان أي بيانات سجلات.
// =====================================================================
import {prefs} from '../core/preferences.js';
import {uid} from '../core/id.js';
import {getDisplayState,setPageDisplay,setGlobalDisplay,setCardDisplay,saveSectionLayout,setComponentContent} from '../core/display-prefs.js';

const KEY='ui:files-workspaces:v1';
const MAX=30;
const EXPORT_FORMAT='akl-files-settings';
const EXPORT_VERSION=1;

const SENSITIVE_KEY=/^(client|clients|file|files|party|parties|opponent|opponents|record|records|case|cases|national|passport|phone|email|address|note|notes|content)/i;
const ALLOWED_LIST_KEYS=new Set(['q','preset','from','to','chip','status','showCal']);
const ALLOWED_WORKSPACE_KEYS=new Set(['id','name','kind','list','gridView','gridState','tab','focus','createdAt','updatedAt','builtin','note']);

const cleanName=value=>String(value||'').trim().replace(/\s+/g,' ').slice(0,80);
const cleanString=value=>String(value??'').slice(0,200);
const isObject=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);

function sanitizeList(list){
 const out={};
 if(!isObject(list))return out;
 for(const [key,value] of Object.entries(list)){
  if(!ALLOWED_LIST_KEYS.has(key))continue;
  if(key==='q')out.q=String(value??'').slice(0,250);
  else if(key==='showCal')out.showCal=Boolean(value);
  else out[key]=String(value??'').slice(0,40);
 }
 return out;
}

/** لقطة جدول آمنة (مفاتيح محددة فقط) — تُلتقط من واجهة الجدول نفسها. */
export function sanitizeGridState(state){
 if(!isObject(state))return null;
 const out={};
 if(Array.isArray(state.hidden))out.hidden=[...new Set(state.hidden.map(String))].slice(0,300);
 if(Array.isArray(state.order))out.order=[...new Set(state.order.map(String))].slice(0,300);
 if(Array.isArray(state.sort))out.sort=state.sort.filter(item=>isObject(item)&&item.key).slice(0,8).map(item=>({key:String(item.key),dir:item.dir==='desc'?'desc':'asc'}));
 if(isObject(state.widths))out.widths=Object.fromEntries(Object.entries(state.widths).slice(0,300).map(([key,value])=>[String(key),Number(value)]).filter(([,value])=>Number.isFinite(value)));
 if(Array.isArray(state.pinned))out.pinned=state.pinned.map(String).slice(0,30);
 if(typeof state.density==='string'&&/^(|compact|normal|comfortable|mobile)$/.test(state.density))out.density=state.density;
 if(typeof state.fontSize==='string'&&/^(small|medium|large)$/.test(state.fontSize))out.fontSize=state.fontSize;
 if(typeof state.cards==='boolean')out.cards=state.cards;
 if(isObject(state.appear)){
  const safeAppearance=/^(#[0-9a-f]{3,8}|rgba?\([\d.,\s]+\)|hsla?\([\d.,%\s]+\)|\d+(?:\.\d+)?(?:px|rem|em|%)?)$/i;
  out.appear=Object.fromEntries(Object.entries(state.appear).slice(0,30)
   .map(([key,value])=>[String(key),String(value??'').slice(0,80)])
   .filter(([,value])=>safeAppearance.test(value)));
 }
 return Object.keys(out).length?out:null;
}

function sanitizeWorkspace(raw){
 if(!isObject(raw)||!cleanName(raw.name))return null;
 const item={
  id:String(raw.id||uid()).slice(0,80),
  name:cleanName(raw.name),
  kind:'files',
  list:sanitizeList(raw.list),
  gridView:cleanString(raw.gridView||''),
  gridState:sanitizeGridState(raw.gridState),
  tab:String(raw.tab||'').slice(0,40),
  focus:String(raw.focus||'').slice(0,40),
  note:cleanString(raw.note||''),
  createdAt:String(raw.createdAt||new Date().toISOString()),
  updatedAt:String(raw.updatedAt||raw.createdAt||new Date().toISOString()),
  builtin:false
 };
 return item;
}

export function getWorkspaces(){
 const saved=prefs.get(KEY,[]);
 if(!Array.isArray(saved))return [];
 return saved.map(sanitizeWorkspace).filter(Boolean).slice(0,MAX);
}

function persist(items){
 const list=(items||[]).map(sanitizeWorkspace).filter(Boolean).slice(0,MAX);
 prefs.set(KEY,list);
 return list;
}

export function saveWorkspace({id='',name,list={},gridView='',gridState=null,tab='',focus='',note=''}={}){
 const clean=cleanName(name);
 if(!clean)throw new Error('اسم مساحة العمل مطلوب.');
 const current=getWorkspaces();
 const existing=id?current.find(item=>item.id===id):current.find(item=>item.name===clean);
 // لا اقتطاع صامت: عند بلوغ الحد نرفض الحفظ الجديد برسالة صريحة بدل فقد المساحة بلا إشعار.
 if(!existing&&current.length>=MAX)throw new Error(`بلغت الحد الأقصى (${MAX} مساحة). احذف مساحة غير مستخدمة أولًا.`);
 const now=new Date().toISOString();
 const record=sanitizeWorkspace({
  id:existing?.id||id||uid(),name:clean,list,gridView,gridState,tab,focus,note,
  createdAt:existing?.createdAt||now,updatedAt:now
 });
 const next=existing?current.map(item=>item.id===existing.id?record:item):[...current,record];
 persist(next);
 return record;
}

export function renameWorkspace(id,name){
 const clean=cleanName(name);
 if(!clean)throw new Error('الاسم الجديد مطلوب.');
 const current=getWorkspaces();
 const target=current.find(item=>item.id===id);
 if(!target)throw new Error('مساحة العمل غير موجودة.');
 if(current.some(item=>item.id!==id&&item.name===clean))throw new Error('يوجد اسم مطابق بالفعل.');
 return persist(current.map(item=>item.id===id?{...item,name:clean,updatedAt:new Date().toISOString()}:item)).find(item=>item.id===id);
}

export function duplicateWorkspace(id,name=''){
 const current=getWorkspaces();
 const source=current.find(item=>item.id===id);
 if(!source)throw new Error('مساحة العمل غير موجودة.');
 if(current.length>=MAX)throw new Error(`بلغت الحد الأقصى (${MAX} مساحة). احذف مساحة غير مستخدمة أولًا.`);
 const base=cleanName(name)||`${source.name} — نسخة`;
 let candidate=base,index=2;
 while(current.some(item=>item.name===candidate))candidate=`${base} (${index++})`;
 const copy=sanitizeWorkspace({...source,id:uid(),name:candidate,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
 persist([...current,copy]);
 return copy;
}

export function deleteWorkspace(id){
 const current=getWorkspaces();
 return persist(current.filter(item=>item.id!==id));
}

export function clearWorkspaces(){
 prefs.set(KEY,[]);
 return [];
}

/** مساحات جاهزة حسب نوع المهمة — تعريفات كود، لا تُخزَّن ولا تنسخ أي سجل. */
export function builtInWorkspaces(){
 return [
  {id:'builtin:family-open',name:'ملفات الأسرة المفتوحة',list:{q:'',preset:'all',chip:'active',status:'all'},tab:'summary',note:'فلتر الحالة النشطة + تصفية كلمة «أسرة» من البحث عند التطبيق'},
  {id:'builtin:upcoming-hearings',name:'مراجعة الجلسات القادمة',list:{q:'',preset:'all',chip:'hearing',status:'all'},tab:'hearings',note:'يستخدم شريحة «جلسة قادمة» القائمة (فهرس محدود)'},
  {id:'builtin:action-needed',name:'ملفات تحتاج إجراءً',list:{q:'',preset:'all',chip:'action',status:'all'},tab:'summary',note:'خطوة تالية مسجلة موعدها حان أو انقضى'},
  {id:'builtin:parties-review',name:'مراجعة الأطراف',list:{q:'',preset:'all',chip:'active',status:'all'},tab:'parties',note:'يفتح الملف على تبويب الأطراف دون تغيير أي بيانات'},
  {id:'builtin:announcements',name:'متابعة الإعلانات والمحضرين',list:{q:'',preset:'all',chip:'active',status:'all'},tab:'serviceRecords',note:'يفتح تبويب المحضرين والإعلانات للملف النشط'},
  {id:'builtin:admin-work',name:'الأعمال الإدارية',list:{q:'',preset:'all',chip:'active',status:'all'},tab:'procedures',note:'يفتح لوحة الأعمال الإدارية لكل ملف'}
 ];
}

export function workspaceById(id){
 return [...builtInWorkspaces(),...getWorkspaces()].find(item=>item.id===id)||null;
}

export function applyWorkspaceToList(st,workspace){
 if(!workspace)return st;
 const list=sanitizeList(workspace.list||{});
 Object.assign(st,{q:'',preset:'all',chip:'all',status:'all',from:'',to:'',...list});
 if(workspace.focus==='family')st.q=st.q||'أسرة';
 return st;
}

// ===== تصدير/استيراد قوالب العرض =====
function sanitizeDisplayExport(state){
 if(!isObject(state))return null;
 const out={version:1,global:{},pages:{},cards:{},componentContents:{}};
 if(isObject(state.global)){
  out.global.card=isObject(state.global.card)?{...state.global.card}:{};
  out.global.grid=isObject(state.global.grid)?{...state.global.grid}:{};
 }
 for(const [pageId,page] of Object.entries(isObject(state.pages)?state.pages:{}).slice(0,80)){
  if(!isObject(page))continue;
  out.pages[String(pageId).slice(0,80)]={
   display:isObject(page.display)?{...page.display}:{},
   sections:{order:Array.isArray(page.sections?.order)?page.sections.order.map(String).slice(0,200):[],hidden:Array.isArray(page.sections?.hidden)?page.sections.hidden.map(String).slice(0,200):[]}
  };
 }
 for(const [cardKey,value] of Object.entries(isObject(state.cards)?state.cards:{}).slice(0,200))if(isObject(value))out.cards[String(cardKey).slice(0,120)]={...value};
 for(const [componentId,value] of Object.entries(isObject(state.componentContents)?state.componentContents:{}).slice(0,300))if(isObject(value))out.componentContents[String(componentId).slice(0,160)]={order:Array.isArray(value.order)?value.order.map(String).slice(0,200):[],hidden:Array.isArray(value.hidden)?value.hidden.map(String).slice(0,200):[]};
 return out;
}

/**
 * تصدير ملف إعدادات صغير. لا يحتوي أي سجل أو بيانات شخصية — فقط تفضيلات العرض
 * ومساحات العمل المسماة (بأسمائها ومرشحاتها) وقالب الجدول إن مُرِّر.
 */
export function exportSettingsTemplate({gridState=null,workspaces=null,appVersion=''}={}){
 const payload={
  format:EXPORT_FORMAT,
  version:EXPORT_VERSION,
  exportedAt:new Date().toISOString(),
  appVersion:String(appVersion||'').slice(0,40),
  kind:'display-settings',
  display:sanitizeDisplayExport(getDisplayState()),
  grid:sanitizeGridState(gridState),
  workspaces:(workspaces||getWorkspaces()).map(sanitizeWorkspace).filter(Boolean),
  containsOfficeRecords:false,
  note:'ملف تفضيلات عرض فقط. لا يحتوي أسماء موكلين ولا سجلات ولا مرفقات.'
 };
 // البنية مبنية من مفاتيح بيضاء فقط؛ لا تُمرَّر أي حقول سجلات من المصدر.
 const serialized=JSON.stringify(payload,null,2);
 return {json:serialized,payload};
}

function validateSettingsPayload(raw){
 let payload=raw;
 if(typeof raw==='string'){
  if(raw.length>512000)throw new Error('حجم ملف الإعدادات أكبر من الحد المسموح (500KB).');
  try{payload=JSON.parse(raw)}catch{throw new Error('ملف الإعدادات ليس JSON صالحًا.')}
 }
 if(!isObject(payload))throw new Error('ملف الإعدادات غير صالح.');
 if(payload.format!==EXPORT_FORMAT)throw new Error('هذا الملف ليس قالب إعدادات لنظام الديوان.');
 if(Number(payload.version)>EXPORT_VERSION)throw new Error('إصدار الملف أحدث من الإصدار المدعوم. حدّث التطبيق أولًا.');
 if(payload.containsOfficeRecords===true)throw new Error('الملف يعلن احتواءه بيانات سجلات؛ رُفض الاستيراد.');
 if(payload.display!==undefined&&!isObject(payload.display))throw new Error('قسم إعدادات العرض غير صالح.');
 if(payload.workspaces!==undefined&&!Array.isArray(payload.workspaces))throw new Error('قسم مساحات العمل غير صالح.');
 return payload;
}

/**
 * استيراد آمن: لا حذف لأي بيانات أو تفضيل قائم. يتجاهل العناصر غير المتوافقة،
 * ويُعيد أسماء مساحات العمل التي أُعيدت تسميتها بسبب التعارض.
 */
export function importSettingsTemplate(raw){
 const payload=validateSettingsPayload(raw);
 let importedPages=0,importedCards=0,importedComponents=0,importedWorkspaces=0;
 const renamed=[];
 const display=payload.display;
 if(isObject(display?.global)){
  if(isObject(display.global.card)&&Object.keys(display.global.card).length)setGlobalDisplay('card',display.global.card);
  if(isObject(display.global.grid)&&Object.keys(display.global.grid).length)setGlobalDisplay('grid',display.global.grid);
 }
 for(const [pageId,page] of Object.entries(isObject(display?.pages)?display.pages:{})){
  if(!isObject(page))continue;
  if(isObject(page.display)&&Object.keys(page.display).length){setPageDisplay(pageId,page.display);importedPages++}
  if(isObject(page.sections)&&Array.isArray(page.sections.order)){
   saveSectionLayout(pageId,{order:page.sections.order,hidden:page.sections.hidden});
   importedPages++;
  }
 }
 for(const [cardKey,value] of Object.entries(isObject(display?.cards)?display.cards:{})){
  if(isObject(value)&&Object.keys(value).length){setCardDisplay(cardKey,value);importedCards++}
 }
 for(const [componentId,value] of Object.entries(isObject(display?.componentContents)?display.componentContents:{})){
  if(isObject(value)&&(Array.isArray(value.order)||Array.isArray(value.hidden))){setComponentContent(componentId,{order:value.order,hidden:value.hidden});importedComponents++}
 }
 const existing=getWorkspaces();
 let next=[...existing];
 for(const raw of payload.workspaces||[]){
  const item=sanitizeWorkspace(raw);
  if(!item)continue;
  let name=item.name;
  let counter=2;
  while(next.some(work=>work.name===name))name=`${item.name} (مستورد ${counter++})`;
  if(name!==item.name)renamed.push({from:item.name,to:name});
  next.push({...item,id:uid(),name,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
  importedWorkspaces++;
 }
 if(importedWorkspaces)persist(next);
 return {
  ok:true,importedPages,importedCards,importedComponents,importedWorkspaces,renamed,
  gridState:sanitizeGridState(payload.grid),
  note:'لم يُحذف أي تفضيل أو بيانات. قالب الجدول يُطبَّق فقط بعد تأكيدك على الجدول الحالي.'
 };
}

export {EXPORT_FORMAT,EXPORT_VERSION,validateSettingsPayload};
