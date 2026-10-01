// =====================================================================
// تفضيلات العرض الموحدة (DisplayPreferences) — المصدر الوحيد للحقيقة
// ---------------------------------------------------------------------
// طبقة مركزية واحدة فوق نظام التفضيلات الموجود (core/preferences.js):
//   Global → Pages → Cards → Grids → Sections
// بأولوية تجاوز واضحة لكل حقل على حدة:
//   Card Preference → Page Preference → Global Preference → Default
//
// قواعد أساسية:
// • التخزين عبر prefs (IndexedDB + مرآة localStorage) في namespace واحد
//   اسمه ui:display-prefs — لا مخازن مبعثرة ولاStores جديدة في قاعدة المكتب.
// • تفضيلات العرض UI State فقط: لا تلمس بيانات المكتب، ولا تُعيد Query
//   أي سجلات عند تغييرها.
// • القيم القديمة/الناقصة تعمل دائمًا: أي حقل غير محفوظ يسقط تلقائيًا
//   إلى المستوى الأعم (Stored → Page → Global → Default).
import {prefs,MIRROR_PREFIX} from './preferences.js';

export const DISPLAY_PREF_KEY='ui:display-prefs';

/** أحجام خط البطاقات: زيادة متدرجة (لا قفزات ضخمة) — العوامل في css/display.css */
export const CARD_FONT_SIZES=Object.freeze(['sm','md','lg','xl']);
export const CARD_FONT_LABELS=Object.freeze({sm:'صغير',md:'متوسط',lg:'كبير',xl:'كبير جدًا'});
/** كثافة العرض: تباعد الحقول وحشو البطاقة */
export const CARD_DENSITIES=Object.freeze(['compact','cozy','roomy']);
export const CARD_DENSITY_LABELS=Object.freeze({compact:'مدمج',cozy:'مريح',roomy:'واسع'});
/** طريقة عرض البيانات: عدد الحقول في السطر داخل البطاقة/القسم */
export const FIELD_LAYOUTS=Object.freeze(['normal','comfortable','expanded']);
export const FIELD_LAYOUT_LABELS=Object.freeze({normal:'عادي',comfortable:'مريح',expanded:'موسع'});
/** أحجام وكثافة الجداول — نفس قيم Universal DataGrid الحالية (لا نظام ثانٍ) */
export const GRID_FONT_SIZES=Object.freeze(['small','medium','large']);
export const GRID_DENSITIES=Object.freeze(['','compact','normal','comfortable','mobile']);
export const GRID_FONT_LABELS=Object.freeze({small:'خط صغير',medium:'خط متوسط',large:'خط كبير'});
export const GRID_DENSITY_LABELS=Object.freeze({'':'حسب الثيم',compact:'مضغوط',normal:'عادي',comfortable:'مريح',mobile:'مناسب للموبايل'});

export const DISPLAY_DEFAULTS=Object.freeze({
 card:Object.freeze({fontSize:'md',density:'cozy',fieldLayout:'normal',secondary:true,borders:true}),
 grid:Object.freeze({fontSize:'medium',density:''})
});

const pick=(value,allowed,fallback)=>allowed.includes(value)?value:fallback;

function sanitizeCardPatch(patch){
 const out={};
 if(!patch||typeof patch!=='object'||Array.isArray(patch))return out;
 if(patch.fontSize!==undefined)out.fontSize=pick(patch.fontSize,CARD_FONT_SIZES,DISPLAY_DEFAULTS.card.fontSize);
 if(patch.density!==undefined)out.density=pick(patch.density,CARD_DENSITIES,DISPLAY_DEFAULTS.card.density);
 if(patch.fieldLayout!==undefined)out.fieldLayout=pick(patch.fieldLayout,FIELD_LAYOUTS,DISPLAY_DEFAULTS.card.fieldLayout);
 if(patch.secondary!==undefined)out.secondary=Boolean(patch.secondary);
 if(patch.borders!==undefined)out.borders=Boolean(patch.borders);
 return out;
}
function sanitizeGridPatch(patch){
 const out={};
 if(!patch||typeof patch!=='object'||Array.isArray(patch))return out;
 if(patch.fontSize!==undefined)out.fontSize=pick(patch.fontSize,GRID_FONT_SIZES,DISPLAY_DEFAULTS.grid.fontSize);
 if(patch.density!==undefined)out.density=pick(patch.density,GRID_DENSITIES,DISPLAY_DEFAULTS.grid.density);
 return out;
}
function normalizeSections(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return {order:[],hidden:[],legacyMigrated:false};
 return {
  order:Array.isArray(raw.order)?[...new Set(raw.order.map(String))]:[],
  hidden:Array.isArray(raw.hidden)?[...new Set(raw.hidden.map(String))]:[],
  legacyMigrated:Boolean(raw.legacyMigrated)
 };
}
function normalize(raw){
 const src=(raw&&typeof raw==='object'&&!Array.isArray(raw))?raw:{};
 const pages={};
 if(src.pages&&typeof src.pages==='object'&&!Array.isArray(src.pages)){
  for(const [pageId,page] of Object.entries(src.pages)){
   if(!page||typeof page!=='object')continue;
   pages[String(pageId)]={display:sanitizeCardPatch(page.display),sections:normalizeSections(page.sections)};
  }
 }
 const cards={};
 if(src.cards&&typeof src.cards==='object'&&!Array.isArray(src.cards)){
  for(const [cardKey,value] of Object.entries(src.cards)){
   const clean=sanitizeCardPatch(value);
   if(Object.keys(clean).length)cards[String(cardKey)]=clean;
  }
 }
 return {version:1,global:{card:sanitizeCardPatch(src.global?.card),grid:sanitizeGridPatch(src.global?.grid)},pages,cards};
}

// ذاكرة معيارية واحدة: قراءة فورية متسقة (مثل collapse-state) وكتابة مباشرة عبر prefs.
let mem=null;
function read(){
 if(mem)return mem;
 mem=normalize(prefs.get(DISPLAY_PREF_KEY,null));
 return mem;
}
function write(state){
 mem=state;
 prefs.set(DISPLAY_PREF_KEY,state);
 return state;
}
function ensurePage(state,pageId){
 if(!state.pages[pageId])state.pages[pageId]={display:{},sections:{order:[],hidden:[],legacyMigrated:false}};
 return state.pages[pageId];
}

/** نسخة كاملة من حالة التفضيلات (للعرض في الإعدادات والاختبارات). */
export function getDisplayState(){
 const st=read();
 return {version:st.version,global:{card:{...st.global.card},grid:{...st.global.grid}},pages:JSON.parse(JSON.stringify(st.pages)),cards:JSON.parse(JSON.stringify(st.cards))};
}

/** دمج على مستوى الحقل: Card → Page → Global → Default */
function mergeCardLevels(levels){
 const out={};
 for(const field of ['fontSize','density','fieldLayout','secondary','borders']){
  let value;
  for(const level of levels){
   if(level&&level[field]!==undefined){value=level[field];break}
  }
  out[field]=value===undefined?DISPLAY_DEFAULTS.card[field]:value;
 }
 return out;
}
/** الإعدادات الفعالة لبطاقة معينة (المستويات: بطاقة ← صفحة ← عام ← افتراضي). */
export function resolveCardDisplay(cardKey,pageId=''){
 const st=read();
 return mergeCardLevels([
  cardKey?st.cards[cardKey]:null,
  pageId?st.pages[pageId]?.display:null,
  st.global.card,
  DISPLAY_DEFAULTS.card
 ]);
}
/** الإعدادات الفعالة لصفحة (صفحة ← عام ← افتراضي) — تُطبق على جذر المحتوى. */
export function resolvePageDisplay(pageId=''){
 const st=read();
 return mergeCardLevels([pageId?st.pages[pageId]?.display:null,st.global.card,DISPLAY_DEFAULTS.card]);
}
/** الافتراضي العام للجداول: يقرأه Universal DataGrid عندما لا توجد قيمة محفوظة للجدول. */
export function resolveGridDisplay(){
 const st=read();
 return {
  fontSize:st.global.grid.fontSize!==undefined?st.global.grid.fontSize:DISPLAY_DEFAULTS.grid.fontSize,
  density:st.global.grid.density!==undefined?st.global.grid.density:DISPLAY_DEFAULTS.grid.density
 };
}

export function setCardDisplay(cardKey,patch){
 if(!cardKey)return null;
 const clean=sanitizeCardPatch(patch);
 if(!Object.keys(clean).length)return read();
 const st=read();
 st.cards={...st.cards,[cardKey]:{...(st.cards[cardKey]||{}),...clean}};
 return write(st);
}
/** حذف تفضيل بطاقة معينة فتعود للمستوى الأعم (صفحة/عام/افتراضي). */
export function clearCardDisplay(cardKey){
 if(!cardKey)return read();
 const st=read();
 if(!(cardKey in st.cards))return st;
 const cards={...st.cards};delete cards[cardKey];st.cards=cards;
 return write(st);
}
export function setPageDisplay(pageId,patch){
 if(!pageId)return null;
 const clean=sanitizeCardPatch(patch);
 if(!Object.keys(clean).length)return read();
 const st=read();
 ensurePage(st,pageId).display={...st.pages[pageId].display,...clean};
 return write(st);
}
export function clearPageDisplay(pageId){
 if(!pageId)return read();
 const st=read();
 if(!st.pages[pageId])return st;
 st.pages[pageId].display={};
 return write(st);
}
/** scope: 'card' | 'grid' */
export function setGlobalDisplay(scope,patch){
 const clean=scope==='grid'?sanitizeGridPatch(patch):sanitizeCardPatch(patch);
 if(!Object.keys(clean).length)return read();
 const st=read();
 st.global[scope==='grid'?'grid':'card']={...st.global[scope==='grid'?'grid':'card'],...clean};
 return write(st);
}

/** A− / A+ : تحريك متدرج خطوة واحدة داخل القائمة المعتمدة. */
export function stepCardFontSize(current,direction){
 const index=CARD_FONT_SIZES.indexOf(current);
 const base=index<0?1:index;
 const next=Math.max(0,Math.min(CARD_FONT_SIZES.length-1,base+(direction>0?1:-1)));
 return CARD_FONT_SIZES[next];
}

// ===== ترتيب وإظهار أقسام الصفحات (التخزين هنا، والمنطق في ui/page-layout.js) =====
export function getSectionLayout(pageId){
 const st=read();
 return st.pages[pageId]?.sections||{order:[],hidden:[],legacyMigrated:false};
}
export function saveSectionLayout(pageId,{order,hidden}={}){
 if(!pageId)return null;
 const st=read();
 const page=ensurePage(st,pageId);
 if(Array.isArray(order))page.sections.order=[...new Set(order.map(String))];
 if(Array.isArray(hidden))page.sections.hidden=[...new Set(hidden.map(String))];
 return write(st);
}
export function markSectionsLegacyMigrated(pageId){
 const st=read();
 ensurePage(st,pageId).sections.legacyMigrated=true;
 return write(st);
}
export function isSectionsLegacyMigrated(pageId){
 return Boolean(getSectionLayout(pageId).legacyMigrated);
}

// ===== إعادة الضبط =====
/** إعادة ضبط تفضيلات صفحة واحدة (العرض + ترتيب/إظهار الأقسام) — بلا أي تأثير على البيانات. */
export function resetPagePreferences(pageId){
 if(!pageId)return read();
 const st=read();
 if(!st.pages[pageId])return st;
 const pages={...st.pages};delete pages[pageId];st.pages=pages;
 return write(st);
}
/**
 * إعادة ضبط إعدادات العرض بالكامل: العام + كل البطاقات + عرض كل صفحة.
 * لا يمس ترتيب/إظهار الأقسام (تلك «تخطيط الصفحة» وتُعاد من نافذة تخصيص الصفحة)
 * ولا يمس أي بيانات أو فلاتر/أعمدة الجداول المحفوظة لكل جدول.
 */
export function resetAllDisplay(){
 const st=read();
 st.global={card:{},grid:{}};
 st.cards={};
 for(const id of Object.keys(st.pages))st.pages[id].display={};
 return write(st);
}
/** مسح إعدادات العرض المحفوظة لكل الجداول (مفاتيح grid:* فقط — ليست بيانات). */
export function resetAllGridPreferences(){
 let removed=0;
 try{
  const names=[];
  for(let i=0;i<localStorage.length;i++){
   const key=localStorage.key(i);
   if(!key)continue;
   if(key.startsWith(MIRROR_PREFIX+'grid:'))names.push(key.slice(MIRROR_PREFIX.length));
   else if(key.startsWith('grid:')){try{localStorage.removeItem(key)}catch{}}
  }
  for(const name of names){prefs.remove(name);removed++}
 }catch{}
 return removed;
}

/** للاختبارات فقط: إفراغ الذاكرة المعيارية وإعادة القراءة من المخزن. */
export function _resetDisplayPrefsForTests(){
 mem=null;
 try{prefs.remove(DISPLAY_PREF_KEY)}catch{}
 mem=normalize(null);
 return getDisplayState();
}
