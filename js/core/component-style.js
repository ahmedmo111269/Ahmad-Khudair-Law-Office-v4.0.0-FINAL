// =====================================================================
// نظام التخصيص الكامل والمستقل لكل عنصر (Universal Component Styles)
// ---------------------------------------------------------------------
// طبقة مركزية واحدة فوق DisplayPreferences الموجودة — لا نظام مكرر:
//   • التخزين عبر prefs (IndexedDB + مرآة localStorage) في namespace واحد
//     اسمه ui:component-styles — لا مخازن جديدة في قاعدة المكتب.
//   • سلسلة أولويات لكل خاصية على حدة:
//       العنصر (Specific Element) ← افتراضي النوع (Component Default)
//       ← الصفحة (Page Default) ← العام (Global Default) ← تصميم النظام.
//     بمجرد تخصيص عنصر يدويًا يصبح له Override مستقل: تغيير العام أو
//     الصفحة afterwards لا يمسّه — القاعدة الذهبية «الافتراضي لا يعني الإجباري».
//   • كل عنصر له هوية ثابتة Stable UI Component ID مثل:
//       card:client-main-data • section:client-details:hearings
//       stage:<caseId> • page:client-details • stagepath:<fileId>
//     لا اعتماد على ترتيب DOM أو موضع العنصر.
//   • التطبيق عبر CSS Variables + Inline Styles على العنصر المعني فقط:
//     بلا إعادة رسم للصفحة وبلا إعادة Query لأي بيانات (UI State بحت).
//   • 15 نوع نص (Main Title … Table Header) لكل نوع تحكم مستقل:
//     حجم/لون/وزن/ارتفاع سطر/تباعد أحرف/محاذاة/تحويل/زخرفة/شفافية/خط.
//   • شكل العنصر: خلفية(+شفافية)/حدود(لون+سمك+نوع)/حواف/ظل/مسافات/حجم.
// سلامة البيانات: هذا النظام واجهة فقط — لا يلمس الموكلين/الملفات/القضايا
// أو أي سجل؛ الكتابة الوحيدة هي مفتاح تفضيلات العرض.
import {prefs} from './preferences.js';
import {resolveCardDisplay,resolvePageDisplay} from './display-prefs.js';

export const COMPONENT_STYLE_KEY='ui:component-styles';

/** أنواع العناصر القابلة للتخصيص — أي نوع جديد يُضاف هنا يظهر في كل اللوحات. */
export const COMPONENT_TYPES=Object.freeze(['card','section','stage','page','panel','grid','component']);
export const COMPONENT_TYPE_LABELS=Object.freeze({card:'بطاقة',section:'قسم',stage:'مرحلة',page:'صفحة',panel:'لوحة',grid:'جدول',component:'مكون'});

/** أنواع النصوص — كل نوع يُخصص بشكل مستقل عن الآخر (البند 5 و6). */
export const TEXT_ROLES=Object.freeze(['mainTitle','sectionTitle','subTitle','fieldLabel','primaryValue','secondaryValue','helperText','description','annotation','caption','badge','status','legalNumber','tableText','tableHeader']);
export const TEXT_ROLE_LABELS=Object.freeze({
 mainTitle:'العنوان الرئيسي',sectionTitle:'عنوان القسم',subTitle:'العنوان الفرعي',
 fieldLabel:'اسم الحقل',primaryValue:'القيمة الأساسية',secondaryValue:'القيمة الثانوية',
 helperText:'نص مساعد',description:'وصف',annotation:'بيان هامشي / ملاحظة',caption:'تعليق صغير',
 badge:'الشارات',status:'تسمية الحالة',legalNumber:'الرقم القضائي / رقم الملف',
 tableText:'نص الجداول',tableHeader:'رأس الجداول'
});
/** عينات عربية تظهر داخل اللوحة والمعاينة لكل نوع نص. */
export const TEXT_ROLE_SAMPLES=Object.freeze({
 mainTitle:'بيانات الموكل الأساسية',sectionTitle:'قسم الجلسات',subTitle:'ملخص سريع',
 fieldLabel:'اسم الموكل',primaryValue:'فاطمة محمد إبراهيم محمد',secondaryValue:'آخر نشاط: 28/09/2026',
 helperText:'نص مساعد يوضح المعلومة',description:'وصف تفصيلي أطول للقسم أو السجل.',annotation:'ملاحظة هامشية على السجل',
 caption:'12 سجلًا',badge:'شارة',status:'نشط',legalNumber:'1545/2026',tableText:'خلية جدول',tableHeader:'رأس عمود'
});

/** خصائص كل نوع نص (Typography كاملة — البند 9). */
export const ROLE_PROPS=Object.freeze(['fs','color','fw','lh','ls','align','tt','td','op','ff']);
/** أنواع محددة تملك أيضًا شكلًا خاصًا (خلفية/حدود/حواف/حشو) — البند 17 للرقم القضائي. */
export const ROLE_BOX_EXTRAS=Object.freeze({legalNumber:['bg','bc','bw','br','pad'],badge:['bg','bc','bw','br','pad'],status:['bg','bc','bw','br','pad']});

export const BASE_PROPS=Object.freeze(['fontSize','fontFamily']);
export const BOX_PROPS=Object.freeze(['bg','bgAlpha','borderColor','borderWidth','borderStyle','radius','shadow','padding','gap','margin','maxWidth','align','accent']);

/** حدود تقنية آمنة تمنع كسر التصميم مع حرية تدريجية كاملة (البند 7). */
export const STYLE_LIMITS=Object.freeze({
 baseFontSize:{min:11,max:28,step:.5},
 roleFontSize:{min:9,max:42,step:.5},
 lineHeight:{min:.9,max:2.6,step:.05},
 letterSpacing:{min:-2,max:8,step:.1},
 opacity:{min:.25,max:1,step:.05},
 borderWidth:{min:0,max:8,step:1},
 radius:{min:0,max:40,step:1},
 padding:{min:0,max:48,step:1},
 gap:{min:0,max:40,step:1},
 margin:{min:0,max:32,step:1},
 maxWidth:{min:240,max:2400,step:20},
 bgAlpha:{min:.05,max:1,step:.05},
 rolePad:{min:0,max:20,step:1},
 roleRadius:{min:0,max:30,step:1},
 roleBorderWidth:{min:0,max:6,step:1}
});
export const FONT_WEIGHTS=Object.freeze(['','300','400','500','600','700','800','900']);
export const TEXT_ALIGNS=Object.freeze(['','start','center','end','justify']);
export const TEXT_ALIGN_LABELS=Object.freeze({'':'افتراضي',start:'بداية',center:'وسط',end:'نهاية',justify:'ضبط'});
export const TEXT_TRANSFORMS=Object.freeze(['','none','uppercase','lowercase','capitalize']);
export const TEXT_TRANSFORM_LABELS=Object.freeze({'':'افتراضي',none:'بلا',uppercase:'أحرف كبيرة',lowercase:'أحرف صغيرة',capitalize:'أول حرف كبير'});
export const TEXT_DECORATIONS=Object.freeze(['','none','underline','line-through']);
export const TEXT_DECORATION_LABELS=Object.freeze({'':'افتراضي',none:'بلا',underline:'تسطير','line-through':'شطب'});
export const BORDER_STYLES=Object.freeze(['solid','dashed','dotted','double','none']);
export const BORDER_STYLE_LABELS=Object.freeze({solid:'متصل',dashed:'متقطع',dotted:'منقط',double:'مزدوج',none:'بلا'});
export const SHADOWS=Object.freeze(['','none','sm','md','lg','xl']);
export const SHADOW_LABELS=Object.freeze({'':'افتراضي',none:'بلا ظل',sm:'خفيف',md:'متوسط',lg:'قوي',xl:'قوي جدًا'});
export const FONT_FAMILIES=Object.freeze(['','cairo','inter','noto','serif','mono']);
export const FONT_FAMILY_LABELS=Object.freeze({'':'خط النظام الافتراضي',cairo:'Cairo',inter:'Inter',noto:'Noto Sans Arabic',serif:'Georgia / Times',mono:'خط أحادي (أرقام)'});
const FAMILY_STACKS={cairo:'"Cairo",var(--font-body)',inter:'"Inter",var(--font-body)',noto:'"Noto Sans Arabic",var(--font-body)',serif:'Georgia,"Times New Roman",serif',mono:'var(--font-mono)'};
const SHADOW_VALUES={none:'none',sm:'var(--shadow-sm)',md:'var(--shadow-md)',lg:'var(--shadow-lg)',xl:'0 18px 50px -12px var(--shadow-color),0 8px 20px -8px var(--shadow-color)'};

/** معامل القياس الحر مقابل الدرجات القديمة (sm/md/lg/xl) — تكامل بلا نظام ثانٍ. */
const PRESET_SCALE=Object.freeze({sm:.9,md:1,lg:1.13,xl:1.27});
const BASE_PX=15.5;

// ===== تخزين مركزي واحد =====
const blank=()=>({version:1,components:{},typeDefaults:{},global:{}});
let mem=null;
function normalizeStyle(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return {};
 const out={};
 if(raw.base&&typeof raw.base==='object')out.base=sanitizeBase(raw.base);
 if(raw.box&&typeof raw.box==='object')out.box=sanitizeBox(raw.box);
 if(raw.text&&typeof raw.text==='object'&&!Array.isArray(raw.text)){
  const text={};
  for(const [role,value] of Object.entries(raw.text)){
   if(!TEXT_ROLES.includes(role))continue;
   const clean=sanitizeRole(role,value);
   if(Object.keys(clean).length)text[role]=clean;
  }
  if(Object.keys(text).length)out.text=text;
 }
 if(!out.base||!Object.keys(out.base).length)delete out.base;
 if(!out.box||!Object.keys(out.box).length)delete out.box;
 return out;
}
function normalize(raw){
 const src=(raw&&typeof raw==='object'&&!Array.isArray(raw))?raw:{};
 const st=blank();
 if(src.components&&typeof src.components==='object'){
  for(const [id,entry] of Object.entries(src.components)){
   if(!id||!entry||typeof entry!=='object')continue;
   const style=normalizeStyle(entry.style!==undefined?entry.style:entry);
   if(Object.keys(style).length)st.components[String(id)]={type:String(entry.type||''),pageId:String(entry.pageId||''),style,updatedAt:Number(entry.updatedAt)||Date.now()};
  }
 }
 if(src.typeDefaults&&typeof src.typeDefaults==='object'){
  for(const [type,style] of Object.entries(src.typeDefaults)){
   const clean=normalizeStyle(style);
   if(Object.keys(clean).length)st.typeDefaults[String(type)]=clean;
  }
 }
 st.global=normalizeStyle(src.global);
 return st;
}
function read(){
 if(mem)return mem;
 mem=normalize(prefs.get(COMPONENT_STYLE_KEY,null));
 return mem;
}
function write(state){
 mem=state;
 prefs.set(COMPONENT_STYLE_KEY,state);
 return state;
}

// ===== تطبيع القيم (Sanitization) — حدود آمنة لكل خاصية =====
const clampNum=(v,lim)=>{
 const n=Number(v);
 if(!Number.isFinite(n))return undefined;
 const step=lim.step||1;
 const q=Math.round(n/step)*step;
 const c=Math.min(lim.max,Math.max(lim.min,q));
 return Math.round(c*1000)/1000;
};
const HEX_RE=/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const hexColor=v=>typeof v==='string'&&HEX_RE.test(v.trim())?v.trim().toLowerCase():undefined;
const pickFrom=(v,allowed)=>allowed.includes(v)?v:undefined;
/** null صريح = علامة مسح الخاصية (إعادة للموروث) — تمر كما هي ليحذفها الدمج. */
const orNull=(patch,key,conv)=>patch[key]===null?null:conv(patch[key]);
function sanitizeBase(patch){
 const out={};
 if(!patch||typeof patch!=='object')return out;
 {const v=orNull(patch,'fontSize',x=>clampNum(x,STYLE_LIMITS.baseFontSize));if(v!==undefined)out.fontSize=v}
 {const v=orNull(patch,'fontFamily',x=>pickFrom(String(x),FONT_FAMILIES));if(v!==undefined)out.fontFamily=v}
 return out;
}
function sanitizeBox(patch){
 const out={};
 if(!patch||typeof patch!=='object')return out;
 {const v=orNull(patch,'bg',x=>hexColor(x));if(v!==undefined)out.bg=v}
 {const v=orNull(patch,'bgAlpha',x=>clampNum(x,STYLE_LIMITS.bgAlpha));if(v!==undefined)out.bgAlpha=v}
 {const v=orNull(patch,'borderColor',x=>hexColor(x));if(v!==undefined)out.borderColor=v}
 {const v=orNull(patch,'borderWidth',x=>clampNum(x,STYLE_LIMITS.borderWidth));if(v!==undefined)out.borderWidth=v}
 {const v=orNull(patch,'borderStyle',x=>pickFrom(String(x),BORDER_STYLES));if(v!==undefined)out.borderStyle=v}
 {const v=orNull(patch,'radius',x=>clampNum(x,STYLE_LIMITS.radius));if(v!==undefined)out.radius=v}
 {const v=orNull(patch,'shadow',x=>pickFrom(String(x),SHADOWS));if(v!==undefined)out.shadow=v}
 {const v=orNull(patch,'padding',x=>clampNum(x,STYLE_LIMITS.padding));if(v!==undefined)out.padding=v}
 {const v=orNull(patch,'gap',x=>clampNum(x,STYLE_LIMITS.gap));if(v!==undefined)out.gap=v}
 {const v=orNull(patch,'margin',x=>clampNum(x,STYLE_LIMITS.margin));if(v!==undefined)out.margin=v}
 {const v=orNull(patch,'maxWidth',x=>clampNum(x,STYLE_LIMITS.maxWidth));if(v!==undefined)out.maxWidth=v}
 {const v=orNull(patch,'align',x=>pickFrom(String(x),TEXT_ALIGNS));if(v!==undefined)out.align=v}
 {const v=orNull(patch,'accent',x=>hexColor(x));if(v!==undefined)out.accent=v}
 return out;
}
function sanitizeRole(role,patch){
 const out={};
 if(!patch||typeof patch!=='object')return out;
 {const v=orNull(patch,'fs',x=>clampNum(x,STYLE_LIMITS.roleFontSize));if(v!==undefined)out.fs=v}
 {const v=orNull(patch,'color',x=>hexColor(x));if(v!==undefined)out.color=v}
 {const v=orNull(patch,'fw',x=>pickFrom(String(x),FONT_WEIGHTS));if(v!==undefined)out.fw=v}
 {const v=orNull(patch,'lh',x=>clampNum(x,STYLE_LIMITS.lineHeight));if(v!==undefined)out.lh=v}
 {const v=orNull(patch,'ls',x=>clampNum(x,STYLE_LIMITS.letterSpacing));if(v!==undefined)out.ls=v}
 {const v=orNull(patch,'align',x=>pickFrom(String(x),TEXT_ALIGNS));if(v!==undefined)out.align=v}
 {const v=orNull(patch,'tt',x=>pickFrom(String(x),TEXT_TRANSFORMS));if(v!==undefined)out.tt=v}
 {const v=orNull(patch,'td',x=>pickFrom(String(x),TEXT_DECORATIONS));if(v!==undefined)out.td=v}
 {const v=orNull(patch,'op',x=>clampNum(x,STYLE_LIMITS.opacity));if(v!==undefined)out.op=v}
 {const v=orNull(patch,'ff',x=>pickFrom(String(x),FONT_FAMILIES));if(v!==undefined)out.ff=v}
 if((ROLE_BOX_EXTRAS[role]||[]).length){
  {const v=orNull(patch,'bg',x=>hexColor(x));if(v!==undefined)out.bg=v}
  {const v=orNull(patch,'bc',x=>hexColor(x));if(v!==undefined)out.bc=v}
  {const v=orNull(patch,'bw',x=>clampNum(x,STYLE_LIMITS.roleBorderWidth));if(v!==undefined)out.bw=v}
  {const v=orNull(patch,'br',x=>clampNum(x,STYLE_LIMITS.roleRadius));if(v!==undefined)out.br=v}
  {const v=orNull(patch,'pad',x=>clampNum(x,STYLE_LIMITS.rolePad));if(v!==undefined)out.pad=v}
 }
 return out;
}
export function sanitizeStyle(patch){
 if(!patch||typeof patch!=='object'||Array.isArray(patch))return {};
 const out={};
 if(patch.base!==undefined){const b=sanitizeBase(patch.base);if(Object.keys(b).length)out.base=b}
 if(patch.box!==undefined){const b=sanitizeBox(patch.box);if(Object.keys(b).length)out.box=b}
 if(patch.text!==undefined&&patch.text&&typeof patch.text==='object'){
  const text={};
  for(const [role,value] of Object.entries(patch.text)){
   if(!TEXT_ROLES.includes(role))continue;
   const clean=sanitizeRole(role,value);
   if(Object.keys(clean).length)text[role]=clean;
  }
  if(Object.keys(text).length)out.text=text;
 }
 return out;
}

/** دمج رقعة جزئية فوق أسلوب محفوظ — القيمة null تحذف الخاصية (إعادة للموروث). */
function mergePatch(base,patch){
 for(const [key,value] of Object.entries(patch||{})){
  if(value===null||value===undefined){delete base[key];continue}
  if(typeof value==='object'&&!Array.isArray(value)){
   const child=(base[key]&&typeof base[key]==='object'&&!Array.isArray(base[key]))?base[key]:{};
   mergePatch(child,value);
   if(Object.keys(child).length)base[key]=child;else delete base[key];
  }else base[key]=value;
 }
 return base;
}
const clone=o=>JSON.parse(JSON.stringify(o||{}));

// ===== سلسلة الأولويات: عنصر ← نوع ← صفحة ← عام =====
/** مستويات الحل مرتبة من الأخص إلى الأعم — تُدمج لكل خاصية على حدة. */
export function styleLevels(id,{type='',pageId=''}={}){
 const st=read();
 const levels=[];
 if(id&&st.components[id])levels.push({level:'element',label:'تخصيص هذا العنصر',style:st.components[id].style});
 if(type&&st.typeDefaults[type])levels.push({level:'type',label:`افتراضي نوع «${COMPONENT_TYPE_LABELS[type]||type}»`,style:st.typeDefaults[type]});
 const pageKey=pageId?`page:${pageId}`:'';
 if(pageKey&&pageKey!==id&&type!=='page'&&st.components[pageKey]){
  levels.push({level:'page',label:'إعداد الصفحة',style:st.components[pageKey].style});
 }
 if(Object.keys(st.global).length)levels.push({level:'global',label:'الافتراضي العام',style:st.global});
 return levels;
}
function mergeLevels(levels){
 const out={base:{},box:{},text:{}};
 const take=(group,key)=>{for(const l of levels){const v=l.style?.[group]?.[key];if(v!==undefined)return v}return undefined};
 for(const k of BASE_PROPS){const v=take('base',k);if(v!==undefined)out.base[k]=v}
 for(const k of BOX_PROPS){const v=take('box',k);if(v!==undefined)out.box[k]=v}
 for(const role of TEXT_ROLES){
  const props=[...ROLE_PROPS,...(ROLE_BOX_EXTRAS[role]||[])];
  const o={};
  // دمج لكل خاصية على حدة داخل النوع نفسه (عنصر ← نوع ← صفحة ← عام)
  for(const k of props){
   let v;
   for(const l of levels){const cand=l.style?.text?.[role]?.[k];if(cand!==undefined){v=cand;break}}
   if(v!==undefined)o[k]=v;
  }
  if(Object.keys(o).length)out.text[role]=o;
 }
 if(!Object.keys(out.base).length)delete out.base;
 if(!Object.keys(out.box).length)delete out.box;
 return out;
}
/** الأسلوب الفعّال لعنصر (دمج كل خاصية من أخص مستوى يملكها). */
export function resolveComponentStyle(id,{type='',pageId=''}={}){
 return mergeLevels(styleLevels(id,{type,pageId}));
}
/** مثل resolveComponentStyle لكن يعيد مصدر كل خاصية (للعرض في اللوحة: «موروث من…»). */
export function resolveStyleSources(id,ctx={}){
 const levels=styleLevels(id,ctx);
 const src={base:{},box:{},text:{}};
 const mark=(group,key)=>{for(const l of levels){if(l.style?.[group]?.[key]!==undefined)return l.level}return 'default'};
 for(const k of BASE_PROPS)src.base[k]=mark('base',k);
 for(const k of BOX_PROPS)src.box[k]=mark('box',k);
 for(const role of TEXT_ROLES){
  src.text[role]={};
  for(const k of [...ROLE_PROPS,...(ROLE_BOX_EXTRAS[role]||[])])src.text[role][k]=levels.find(l=>l.style?.text?.[role]?.[k]!==undefined)?.level||'default';
 }
 return src;
}

// ===== الكتّاب (Setters) — حفظ مستقل ودائم لكل عنصر =====
export function getComponentStyle(id){
 const entry=read().components[String(id||'')];
 return entry?clone(entry.style):null;
}
export function getComponentMeta(id){
 const entry=read().components[String(id||'')];
 return entry?{type:entry.type,pageId:entry.pageId,updatedAt:entry.updatedAt}:null;
}
export function setComponentStyle(id,patch,{type='',pageId=''}={}){
 if(!id)return null;
 const st=read();
 const clean=sanitizeStyle(patch);
 if(!Object.keys(clean).length)return st;
 const prev=st.components[id]||{type:'',pageId:'',style:{}};
 const style=mergePatch(clone(prev.style),clean);
 const components={...st.components};
 if(Object.keys(style).length)components[id]={type:type||prev.type||String(id).split(':')[0],pageId:pageId||prev.pageId||'',style,updatedAt:Date.now()};
 else delete components[id];
 st.components=components;
 return write(st);
}
export function clearComponentStyle(id){
 if(!id)return read();
 const st=read();
 if(!st.components[id])return st;
 const components={...st.components};delete components[id];st.components=components;
 return write(st);
}
/** حذف خاصية واحدة من تخصيص العنصر فتعود وحدها للمستوى الموروث. path: 'text.primaryValue.fs' | 'box.bg' | 'base.fontSize' */
export function clearComponentStyleProp(id,path){
 if(!id||!path)return read();
 const parts=String(path).split('.');
 const patch=parts.length===2?{[parts[0]]:{[parts[1]]:null}}:parts.length===3?{[parts[0]]:{[parts[1]]:{[parts[2]]:null}}}:null;
 if(!patch)return read();
 const st=read();
 if(!st.components[id])return st;
 const style=mergePatch(clone(st.components[id].style),patch);
 const components={...st.components};
 if(Object.keys(style).length)components[id]={...st.components[id],style,updatedAt:Date.now()};
 else delete components[id];
 st.components=components;
 return write(st);
}
/** «حفظ كإعداد افتراضي» لنوع عنصر — مستوى Component Default في السلسلة. */
export function setTypeDefault(type,patch){
 if(!COMPONENT_TYPES.includes(type))return null;
 const st=read();
 const clean=sanitizeStyle(patch);
 if(!Object.keys(clean).length)return st;
 const style=mergePatch(clone(st.typeDefaults[type]||{}),clean);
 const typeDefaults={...st.typeDefaults};
 if(Object.keys(style).length)typeDefaults[type]=style;else delete typeDefaults[type];
 st.typeDefaults=typeDefaults;
 return write(st);
}
export function clearTypeDefault(type){
 const st=read();
 if(!st.typeDefaults[type])return st;
 const typeDefaults={...st.typeDefaults};delete typeDefaults[type];st.typeDefaults=typeDefaults;
 return write(st);
}
export function getTypeDefault(type){
 const v=read().typeDefaults[String(type||'')];
 return v?clone(v):null;
}
/** الافتراضي العام (Global Default) — أدنى مستوى في السلسلة. */
export function setGlobalStyle(patch){
 const st=read();
 const clean=sanitizeStyle(patch);
 if(!Object.keys(clean).length)return st;
 st.global=mergePatch(clone(st.global),clean);
 return write(st);
}
export function clearGlobalStyle(){
 const st=read();
 st.global={};
 return write(st);
}
export function getGlobalStyle(){
 return clone(read().global);
}

// ===== النسخ والتطبيق الصريح (لا تطبيق جماعي بلا أمر) — البند 18 =====
let clipboard=null;
export function copyComponentStyle(id,{type='',pageId=''}={}){
 const style=resolveComponentStyle(id,{type,pageId});
 clipboard={fromId:String(id||''),style:clone(style),at:Date.now()};
 return clipboard;
}
export function getStyleClipboard(){
 return clipboard?{fromId:clipboard.fromId,style:clone(clipboard.style),at:clipboard.at}:null;
}
/** تطبيق أسلوب على قائمة معرفات — يُستدعى فقط بأمر صريح من المستخدم. */
export function applyStyleToComponentIds(ids,style,{replace=true,type='',pageId=''}={}){
 const list=(Array.isArray(ids)?ids:[ids]).map(String).filter(Boolean);
 if(!list.length)return 0;
 const clean=clone(style||{});
 const st=read();
 const components={...st.components};
 let n=0;
 for(const id of list){
  const prev=components[id];
  const next=replace?clone(clean):mergePatch(clone(prev?.style||{}),clean);
  const normalized=normalizeStyle(next);
  if(Object.keys(normalized).length)components[id]={type:(prev?.type||type||id.split(':')[0]),pageId:(prev?.pageId||pageId||''),style:normalized,updatedAt:Date.now()};
  else if(prev)delete components[id];
  n++;
 }
 st.components=components;
 write(st);
 return n;
}

// ===== سجل العناصر المعروفة (لأوامر «تطبيق على…») =====
const known=new Map();
export function noteComponent({id,type='component',title='',pageId=''}={}){
 const key=String(id||'');
 if(!key)return null;
 const prev=known.get(key)||{};
 const entry={id:key,type:String(type||prev.type||'component'),title:String(title||prev.title||''),pageId:String(pageId||prev.pageId||'')};
 known.set(key,entry);
 return entry;
}
export function knownComponents({type='',pageId=''}={}){
 const st=read();
 const out=new Map(known);
 // أي عنصر له تخصيص محفوظ معروف حتى لو لم يُرصد في الصفحة الحالية
 for(const [id,entry] of Object.entries(st.components)){
  if(!out.has(id))out.set(id,{id,type:entry.type||id.split(':')[0],title:'',pageId:entry.pageId||''});
 }
 return [...out.values()].filter(c=>(!type||c.type===type)&&(!pageId||c.pageId===pageId))
  .sort((a,b)=>(a.type===b.type?String(a.title||a.id).localeCompare(String(b.title||b.id),'ar'):a.type.localeCompare(b.type)));
}

// ===== الاستعادة وإعادة الضبط (البند 22) =====
/** إعادة إعدادات عنصر واحد فقط — يعود للموروث بلا مساس ببقية العناصر. */
export function resetComponentStyle(id){return clearComponentStyle(id)}
/** إعادة إعدادات صفحة: مستوى الصفحة + كل عناصرها المخصصة (بأمر صريح). */
export function resetPageComponentStyles(pageId,{includeElements=true}={}){
 if(!pageId)return 0;
 const st=read();
 const pageKey=`page:${pageId}`;
 let removed=0;
 const components={};
 for(const [id,entry] of Object.entries(st.components)){
  const isPage=id===pageKey;
  const inPage=includeElements&&entry.pageId===pageId&&!isPage;
  if(isPage||inPage)removed++;else components[id]=entry;
 }
 st.components=components;
 write(st);
 return removed;
}
/** إعادة الافتراضي العام + افتراضيات الأنواع (لا يمس تخصيصات العناصر نفسها). */
export function resetUniversalDefaults(){
 const st=read();
 st.global={};st.typeDefaults={};
 return write(st);
}
/** مسح تخصيصات كل العناصر (Overrides) — يُبقي العام وافتراضيات الأنواع. */
export function resetAllComponentOverrides(){
 const st=read();
 st.components={};
 return write(st);
}

/** نسخة كاملة من الحالة (للإعدادات والاختبارات). */
export function getComponentStyleState(){
 const st=read();
 return {version:st.version,components:clone(st.components),typeDefaults:clone(st.typeDefaults),global:clone(st.global)};
}
export function getStyleCounts(){
 const st=read();
 return {components:Object.keys(st.components).length,types:Object.keys(st.typeDefaults).length,global:Object.keys(st.global).length,known:known.size};
}

// ===== الترجمة إلى CSS Variables / Inline Styles =====
/** كل المتغيرات والرموز والأساليب المباشرة لأسلوب فعّال واحد. */
export function computeStyleApplication(style,{type=''}={}){
 const vars={},tokens=[],inline={};
 const s=style||{};
 if(s.base?.fontSize){const scale=(Number(s.base.fontSize)/BASE_PX).toFixed(3);vars['--cd-fs']=scale;vars['--cd-lbl']=scale;tokens.push('base.fontSize')}
 if(s.base?.fontFamily&&FAMILY_STACKS[s.base.fontFamily]){inline.fontFamily=FAMILY_STACKS[s.base.fontFamily];tokens.push('base.fontFamily')}
 const box=s.box||{};
 if(box.bg){
  const alpha=box.bgAlpha!==undefined?Number(box.bgAlpha):1;
  inline.background=alpha>=1?box.bg:`color-mix(in srgb, ${box.bg} ${Math.round(alpha*100)}%, transparent)`;
  tokens.push('box.bg');
 }
 if(box.borderColor!==undefined||box.borderWidth!==undefined||box.borderStyle!==undefined){
  inline.border=`${box.borderWidth!==undefined?box.borderWidth:1}px ${box.borderStyle||'solid'} ${box.borderColor||'var(--border)'}`;
  tokens.push('box.border');
 }
 if(box.radius!==undefined){inline.borderRadius=box.radius+'px';tokens.push('box.radius')}
 if(box.shadow){inline.boxShadow=SHADOW_VALUES[box.shadow]||'';tokens.push('box.shadow')}
 if(box.padding!==undefined){
  vars['--uxc-pad']=box.padding+'px';
  if(type!=='card')inline.padding=box.padding+'px'; // البطاقة تستخدم --card-pad حتى يبقى رأسها وجسمها متناسقين
  else vars['--card-pad']=box.padding+'px';
  tokens.push('box.padding');
 }
 if(box.gap!==undefined){
  vars['--cd-gap']=box.gap+'px';
  vars['--cd-gap-row']=Math.max(2,Math.round(box.gap*.8))+'px';
  vars['--cd-gap-col']=Math.round(box.gap*1.6)+'px';
  tokens.push('box.gap');
 }
 if(box.margin!==undefined){inline.margin=box.margin+'px';tokens.push('box.margin')}
 if(box.maxWidth!==undefined){inline.maxWidth=box.maxWidth+'px';tokens.push('box.maxWidth')}
 if(box.align){inline.textAlign=box.align;tokens.push('box.align')}
 if(box.accent){vars['--uxc-accent']=box.accent;tokens.push('box.accent')}
 for(const [role,props] of Object.entries(s.text||{})){
  if(!TEXT_ROLES.includes(role))continue;
  for(const [k,v] of Object.entries(props||{})){
   if(v===undefined||v===null||v==='')continue;
   const name=`--uxc-${role}-${k}`;
   if(k==='fs'||k==='ls')vars[name]=v+'px';
   else if(k==='ff')vars[name]=FAMILY_STACKS[v]||'';
   else if(k==='pad'||k==='br')vars[name]=v+'px';
   else if(k==='bw')vars[name]=v+'px';
   else vars[name]=String(v);
   if(vars[name]!=='')tokens.push(`${role}.${k}`);else delete vars[name];
  }
 }
 return {vars,tokens,inline};
}

// ===== التطبيق على DOM — العنصر المعني فقط، بلا إعادة رسم =====
const appliedVars=new WeakMap(),appliedInline=new WeakMap();
/** مقياس الخط الأساسي الفعّال: حر (px) أو من درجات النظام القديم (sm/md/lg/xl). */
export function resolveBaseScale(style,{type='',pageId='',cardKey=''}={}){
 if(style?.base?.fontSize)return Number(style.base.fontSize)/BASE_PX;
 try{
  if(type==='card'){
   const key=cardKey||'';
   return PRESET_SCALE[resolveCardDisplay(key,pageId).fontSize]??1;
  }
  return PRESET_SCALE[resolvePageDisplay(pageId).fontSize]??1;
 }catch{return 1}
}
/** متغيرات النصوص فقط (بلا أساليب صندوق) — تُستخدم لمعاينات اللوحة. */
export function applyStyleVars(el,style,{type=''}={}){
 if(!el?.style)return null;
 const app=computeStyleApplication(style,{type});
 const prev=appliedVars.get(el)||new Set();
 for(const name of prev)if(!(name in app.vars))el.style.removeProperty(name);
 for(const [name,v] of Object.entries(app.vars))el.style.setProperty(name,v);
 appliedVars.set(el,new Set(Object.keys(app.vars)));
 if(app.tokens.length)el.dataset.uxcHas=app.tokens.join(' ');else delete el.dataset.uxcHas;
 return app;
}
/**
 * تطبيق الأسلوب الفعّال على عنصر واحد (المتغيرات تُورَّث داخليًا، وأساليب
 * الصندوق على العنصر نفسه — وللمرحلة على زرّها المرئي). تغيير محلي فوري.
 */
export function applyComponentStyle(el,id,{type='',pageId,cardKey='',styleOverride=null}={}){
 if(!el?.style)return null;
 type=type||el.dataset.uxcType||'';
 if(id)el.dataset.uxcId=id;
 if(type)el.dataset.uxcType=type;
 const pid=pageId!==undefined?pageId:(el.dataset.uxcPage||(el.closest?.('[data-uxc-page]')?.dataset.uxcPage)||'');
 const style=styleOverride||resolveComponentStyle(id||'',{type,pageId:pid});
 const app=computeStyleApplication(style,{type});
 // المقياس الأساسي: الحر أو الموروث من درجات النظام القديم — دائمًا مضبوط محليًا
 const scale=resolveBaseScale(style,{type,pageId:pid,cardKey:cardKey||el.dataset.displayKey||''});
 app.vars['--cd-fs']=scale.toFixed(3);
 app.vars['--cd-lbl']=scale.toFixed(3);
 const prev=appliedVars.get(el)||new Set();
 for(const name of prev)if(!(name in app.vars))el.style.removeProperty(name);
 for(const [name,v] of Object.entries(app.vars))el.style.setProperty(name,v);
 appliedVars.set(el,new Set(Object.keys(app.vars)));
 const boxTarget=(type==='stage'&&el.querySelector?.('button'))||el;
 const prevInline=appliedInline.get(boxTarget)||new Set();
 for(const prop of prevInline)if(!(prop in app.inline))boxTarget.style[prop]='';
 for(const [prop,v] of Object.entries(app.inline))boxTarget.style[prop]=v;
 appliedInline.set(boxTarget,new Set(Object.keys(app.inline)));
 if(app.tokens.length)el.dataset.uxcHas=app.tokens.join(' ');else delete el.dataset.uxcHas;
 el.dataset.uxcStyled='1';
 return style;
}
/** إعادة تطبيق كل العناصر المخصصة في جذر معين — نقل أنماط فقط، بلا إعادة رسم. */
export function applyAllComponentStyles(root){
 const doc=root||globalThis.document;
 if(!doc?.querySelectorAll)return 0;
 let n=0;
 const roots=[];
 if(doc.matches?.('[data-uxc-id]')&&!doc.classList?.contains('uxc-preview'))roots.push(doc);
 for(const el of doc.querySelectorAll('[data-uxc-id]')){
  if(el.classList.contains('uxc-preview')||roots.includes(el))continue;
  roots.push(el);
 }
 for(const el of roots){
  applyComponentStyle(el,el.dataset.uxcId,{type:el.dataset.uxcType||'',cardKey:el.dataset.displayKey||''});
  n++;
 }
 return n;
}

/** للاختبارات فقط: إفراغ الذاكرة وإعادة القراءة من المخزن — محاكاة «إعادة فتح البرنامج» بلا مسح. */
export function _reloadComponentStylesForTests(){
 mem=null;
 return getComponentStyleState();
}

export function _resetComponentStylesForTests(){
 mem=null;
 clipboard=null;
 known.clear();
 try{prefs.remove(COMPONENT_STYLE_KEY)}catch{}
 mem=normalize(null);
 return getComponentStyleState();
}
