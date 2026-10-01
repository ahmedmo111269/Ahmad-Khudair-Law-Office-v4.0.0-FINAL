// =====================================================================
// ⚙ تخصيص العرض — اللوحة العالمية الواحدة لكل عنصر في البرنامج
// ---------------------------------------------------------------------
// نظام مركزي واحد (لا نظام لكل نوع) يتعامل مع كل العناصر عبر:
//   Component ID + Component Type + Scoped Preferences
// • أي Component جديد يشترك بتسجيل واحد: registerCustomizableComponent()
//   فيحصل تلقائيًا على زر «⚙ تخصيص العرض» ولوحة كاملة بلا كود إضافي.
// • التعديل محلي Local: يخص العنصر المعني فقط ولا ينتقل تلقائيًا لأي
//   عنصر آخر — الانتقال يتم بأمر صريح («تطبيق على…»، «حفظ كإعداد افتراضي»).
// • السلسلة: العنصر ← افتراضي النوع ← الصفحة ← العام ← تصميم النظام
//   (js/core/component-style.js) — Override العنصر لا يمسّه تغيير الأعم.
// • معاينة مباشرة: كل تغيير يُطبق على العنصر الحيّ وعلى معاينة اللوحة فورًا —
//   بلا Reload وبلا إعادة Query لقاعدة البيانات (CSS Variables/Inline فقط).
// • اللوحة منظمة: [أساسي] [النصوص] [متقدم] [إجراءات] — الخيارات المتقدمة
//   داخل مجموعات مطوية حتى لا تتحول إلى واجهة معقدة.
import {esc} from './dom.js';
import {icon} from './icons.js';
import {modal,closeModal,confirmBox} from './modal.js';
import {toast} from './toast.js';
import {
 COMPONENT_TYPES,COMPONENT_TYPE_LABELS,TEXT_ROLES,TEXT_ROLE_LABELS,TEXT_ROLE_SAMPLES,
 ROLE_BOX_EXTRAS,STYLE_LIMITS,FONT_WEIGHTS,TEXT_ALIGNS,TEXT_ALIGN_LABELS,
 TEXT_TRANSFORMS,TEXT_TRANSFORM_LABELS,TEXT_DECORATIONS,TEXT_DECORATION_LABELS,
 BORDER_STYLES,BORDER_STYLE_LABELS,SHADOWS,SHADOW_LABELS,FONT_FAMILIES,FONT_FAMILY_LABELS,
 resolveComponentStyle,resolveStyleSources,resolveBaseScale,getComponentStyle,setComponentStyle,
 clearComponentStyle,copyComponentStyle,getStyleClipboard,applyStyleToComponentIds,
 setTypeDefault,clearTypeDefault,getTypeDefault,setGlobalStyle,clearGlobalStyle,getGlobalStyle,
 noteComponent,knownComponents,applyComponentStyle,applyAllComponentStyles,applyStyleVars
} from '../core/component-style.js';
import {
 CARD_DENSITIES,CARD_DENSITY_LABELS,FIELD_LAYOUTS,FIELD_LAYOUT_LABELS,
 resolveCardDisplay,resolvePageDisplay,setCardDisplay,setPageDisplay
} from '../core/display-prefs.js';

// ===== سجل المكونات القابلة للتخصيص (قابلية التوسع — البند 24) =====
const componentRegistry=new Map();
/**
 * تسجيل أي Component في نظام التخصيص المركزي — يحصل تلقائيًا على ⚙.
 * def: {id (Stable UI Component ID), type ('card'|'section'|'stage'|'page'|'panel'|'component'),
 *       title, pageId, selector (اختياري: وسم العناصر تلقائيًا), gear (افتراضيًا true)}
 */
export function registerCustomizableComponent(def={}){
 const id=String(def?.id||'');
 if(!id)return null;
 const type=COMPONENT_TYPES.includes(def.type)?def.type:'component';
 const entry={id,type,title:String(def.title||''),pageId:String(def.pageId||''),selector:String(def.selector||''),gear:def.gear!==false};
 componentRegistry.set(id,entry);
 noteComponent({id,type,title:entry.title,pageId:entry.pageId});
 if(entry.selector&&globalThis.document?.querySelectorAll){
  for(const el of document.querySelectorAll(entry.selector)){
   el.dataset.uxcId=id;el.dataset.uxcType=type;
   if(entry.title)el.dataset.uxcTitle=entry.title;
   if(entry.gear)el.setAttribute('data-uxc-gear','');
  }
 }
 return entry;
}
export const getRegisteredComponent=id=>componentRegistry.get(String(id||''))||null;

/** أنواع النصوص المتاحة لكل نوع عنصر (منطقي وظيفيًا — بلا حشو). */
const ALL_TEXT=[...TEXT_ROLES];
const TYPE_ROLES={
 card:['mainTitle','subTitle','fieldLabel','primaryValue','secondaryValue','helperText','description','annotation','caption','badge','status','legalNumber','tableText','tableHeader'],
 section:['mainTitle','sectionTitle','subTitle','fieldLabel','primaryValue','secondaryValue','helperText','description','annotation','caption','badge','status','legalNumber','tableText','tableHeader'],
 panel:['mainTitle','sectionTitle','subTitle','fieldLabel','primaryValue','secondaryValue','helperText','description','annotation','caption','badge','status','legalNumber','tableText','tableHeader'],
 stage:['mainTitle','legalNumber','helperText','badge','status'],
 page:['mainTitle','sectionTitle','subTitle','fieldLabel','primaryValue','secondaryValue','helperText','description','annotation','caption','badge','status','legalNumber','tableText','tableHeader'],
 grid:[],
 component:ALL_TEXT
};
const rolesFor=(type,scope)=>scope==='global'?ALL_TEXT:(TYPE_ROLES[type]||ALL_TEXT);
const COARSE_TYPES=['card','section','panel','page'];
const FW_LABELS={'':'افتراضي','300':'خفيف 300','400':'عادي 400','500':'متوسط 500','600':'شبه عريض 600','700':'عريض 700','800':'أعرض 800','900':'أعرض 900'};
const getPath=(style,path)=>path.split('.').reduce((o,k)=>(o==null?undefined:o[k]),style);

// ===== بناء صفوف التحكم =====
const ctlWrap=(path,label,inner,has)=>`<div class="uxc-ctl" data-path="${esc(path)}"><span class="uxc-ctl-lbl">${esc(label)}</span><div class="uxc-ctl-in">${inner}<button type="button" class="link uxc-clear" data-uxc-clear="${esc(path)}" title="إعادة هذه القيمة إلى الوضع الموروث" aria-label="إعادة ${esc(label)} إلى الموروث"${has?'':' hidden'}>↺</button></div></div>`;
const rangeCtl=(path,label,{min,max,step,value,unit=''})=>ctlWrap(path,label,
 `<input type="range" data-uxc-range="${esc(path)}" min="${min}" max="${max}" step="${step}" value="${value??min}" aria-label="${esc(label)}"><output data-uxc-out>${value!=null?`${value}${unit}`:'—'}</output>`,value!=null);
const colorCtl=(path,label,value)=>ctlWrap(path,label,
 `<input type="color" data-uxc-color="${esc(path)}" value="${value||'#d4af37'}" aria-label="${esc(label)}"><input type="text" class="uxc-hex" data-uxc-hex="${esc(path)}" value="${esc(value||'')}" placeholder="افتراضي" maxlength="7" dir="ltr" spellcheck="false" aria-label="${esc(label)} — hex">`,Boolean(value));
const segCtl=(path,label,options,labels,current)=>{
 const cur=current==null?'':String(current);
 return ctlWrap(path,label,`<div class="uxc-seg" role="radiogroup" aria-label="${esc(label)}" data-uxc-seg="${esc(path)}">${options.map(v=>`<button type="button" role="radio" aria-checked="${String(v)===cur}" class="${String(v)===cur?'on':''}" data-v="${esc(String(v))}">${esc(labels[v]??v)}</button>`).join('')}</div>`,cur!=='');
};
const selectCtl=(path,label,options,labels,current)=>ctlWrap(path,label,
 `<select data-uxc-select="${esc(path)}" aria-label="${esc(label)}">${options.map(v=>`<option value="${esc(String(v))}"${String(v)===String(current??'')?' selected':''}>${esc(labels[v]??v)}</option>`).join('')}</select>`,current!=null&&current!=='');

const PREVIEW_HTML=`
 <div class="uxc-pv-head"><b data-uxc-role="mainTitle">عنوان العنصر</b><span class="ux-badge" data-uxc-role="badge">شارة</span><span class="ux-badge ux-badge--ok" data-uxc-role="status">نشط</span></div>
 <div class="uxc-pv-grid">
  <div><span class="uxc-pv-k" data-uxc-role="fieldLabel">اسم الموكل</span><strong class="uxc-pv-v" data-uxc-role="primaryValue">فاطمة محمد إبراهيم محمد</strong><small class="uxc-pv-s" data-uxc-role="secondaryValue">بيان ثانوي — آخر نشاط 28/09/2026</small></div>
  <div><span class="uxc-pv-k" data-uxc-role="fieldLabel">رقم القضية</span><span class="fno fno-sub" data-uxc-role="legalNumber"><i class="fno-kind">فرعي</i><b dir="ltr">1545/2026</b></span></div>
 </div>
 <div class="uxc-pv-foot"><p class="muted small uxc-pv-h" data-uxc-role="helperText">نص مساعد يوضح المعلومة</p><span class="uxc-pv-cap" data-uxc-role="caption">12 سجلًا</span></div>`;

let current=null; // {id,type,title,pageId,el,cardKey,scope,card (modal element)}
let rangeTimer=0;

/** العنصر المستهدف للتطبيق الحيّ. */
const liveTargets=()=>{
 const out=[];
 if(current?.scope==='element'&&current.el)out.push([current.el,{type:current.type,pageId:current.pageId,cardKey:current.cardKey}]);
 return out;
};
const effectiveStyle=()=>{
 if(!current)return {};
 if(current.scope==='element')return resolveComponentStyle(current.id,{type:current.type,pageId:current.pageId});
 if(current.scope==='type')return resolveComponentStyle('',{type:current.type});
 return resolveComponentStyle('',{});
};
const ownStyle=()=>{
 if(!current)return {};
 if(current.scope==='element')return getComponentStyle(current.id)||{};
 if(current.scope==='type')return getTypeDefault(current.type)||{};
 return getGlobalStyle()||{};
};
const coarseKey=()=>current?.cardKey||(String(current?.id||'').startsWith('card:')?String(current.id).slice(5):String(current?.id||''));

function commit(path,value){
 if(!current)return;
 const parts=path.split('.');
 const patch=parts[0]==='text'?{text:{[parts[1]]:{[parts[2]]:value}}}:{[parts[0]]:{[parts[1]]:value}};
 if(current.scope==='element')setComponentStyle(current.id,patch,{type:current.type,pageId:current.pageId});
 else if(current.scope==='type')setTypeDefault(current.type,patch);
 else setGlobalStyle(patch);
 refreshApplied();
}
function commitRoleClear(role){
 if(!current)return;
 const patch={text:{[role]:null}};
 if(current.scope==='element')setComponentStyle(current.id,patch,{type:current.type,pageId:current.pageId});
 else if(current.scope==='type')setTypeDefault(current.type,patch);
 else setGlobalStyle(patch);
 refreshApplied();
}
function refreshApplied(){
 if(!current)return;
 // العنصر الحيّ أولًا ثم كل العناصر المخصصة (لتحديث الوراثة من النوع/الصفحة/العام)
 for(const [el,ctx] of liveTargets())applyComponentStyle(el,current.id,{...ctx,type:ctx.type});
 applyAllComponentStyles(globalThis.document);
 updatePreview();
 syncControls();
}
function updatePreview(){
 const card=current?.card;if(!card)return;
 const box=card.querySelector('.uxc-preview-box');
 const eff=effectiveStyle();
 if(box)applyComponentStyle(box,'uxc-preview',{type:'card',pageId:'',cardKey:'',styleOverride:eff});
 // عيّنات أنواع النصوص داخل تبويب «النصوص» تتبع الإعداد الفعّال مباشرة
 const rolePane=card.querySelector('[data-uxc-rolepane]');
 if(rolePane)applyStyleVars(rolePane,eff,{type:'card'});
}
/** مزامنة قيم التحكم مع الحالة الفعّالة + إظهار ↺ فقط عند وجود Override في هذا المستوى. */
function syncControls(){
 const card=current?.card;if(!card)return;
 const eff=effectiveStyle(),own=ownStyle();
 const basePx=eff.base?.fontSize??Math.round(resolveBaseScale(eff,{type:current.type,pageId:current.pageId,cardKey:current.cardKey})*15.5*2)/2;
 card.querySelectorAll('[data-path]').forEach(row=>{
  const path=row.dataset.path;
  const v=path==='base.fontSize'?basePx:getPath(eff,path);
  const o=getPath(own,path);
  const range=row.querySelector('[data-uxc-range]');
  if(range){
   if(v!=null)range.value=String(v);
   const out=row.querySelector('[data-uxc-out]');
   if(out)out.textContent=v!=null?String(v):'—';
  }
  const color=row.querySelector('[data-uxc-color]');
  if(color){color.value=v||'#d4af37';const hex=row.querySelector('[data-uxc-hex]');if(hex&&document.activeElement!==hex)hex.value=v||''}
  const seg=row.querySelector('[data-uxc-seg]');
  if(seg){const cur=v==null?'':String(v);seg.querySelectorAll('button').forEach(b=>{const on=b.dataset.v===cur;b.classList.toggle('on',on);b.setAttribute('aria-checked',String(on))})}
  const sel=row.querySelector('[data-uxc-select]');
  if(sel&&document.activeElement!==sel)sel.value=v==null?'':String(v);
  const clear=row.querySelector('[data-uxc-clear]');
  if(clear)clear.hidden=o==null||o==='';
 });
 // أنواع النصوص: العدد + مصدر القيمة + زر مسح النوع
 const sources=resolveStyleSources(current.scope==='element'?current.id:'',{type:current.type,pageId:current.pageId});
 card.querySelectorAll('.uxc-role[data-role]').forEach(det=>{
  const role=det.dataset.role;
  const ownRole=own.text?.[role]||{};
  const count=Object.keys(ownRole).length;
  const badge=det.querySelector('[data-uxc-role-count]');
  if(badge){badge.hidden=!count;badge.textContent=count?`${count} تخصيصات${current.scope==='element'?' خاصة بهذا العنصر':''}`:''}
  const clr=det.querySelector('[data-uxc-role-clear]');
  if(clr)clr.hidden=!count;
  const src=det.querySelector('[data-uxc-src]');
  if(src){
   const lvls=[sources.text?.[role]?.fs,sources.text?.[role]?.color].filter(l=>l&&l!=='default');
   const names={element:'تخصيص هذا العنصر',type:'افتراضي النوع',page:'إعداد الصفحة',global:'الافتراضي العام'};
   const label=lvls.length?names[lvls[0]]:'';
   src.hidden=!label;src.textContent=label?`موروث من: ${label}`:'';
  }
 });
 // عناصر الإجراءات
 const paste=card.querySelector('[data-uxc-paste]');
 if(paste)paste.hidden=!getStyleClipboard();
 const copyInfo=card.querySelector('[data-uxc-clipinfo]');
 if(copyInfo){const cb=getStyleClipboard();copyInfo.textContent=cb?`الحافظة: إعدادات «${cb.fromId}» جاهزة للتطبيق الصريح.`:'';copyInfo.hidden=!cb}
 const saveType=card.querySelector('[data-uxc-save-type]');
 if(saveType)saveType.disabled=!Object.keys(own).length&&current.scope==='element';
}

// ===== اللوحة =====
function tabButton(id,label,active){
 return `<button type="button" role="tab" class="uxc-tab${active?' active':''}" data-uxc-tab="${id}" aria-selected="${active}" id="uxc-tab-${id}" aria-controls="uxc-pane-${id}">${esc(label)}</button>`;
}
function basicTabHtml(){
 const eff=effectiveStyle(),own=ownStyle();
 const lim=STYLE_LIMITS;
 const coarse=current.scope==='element'&&COARSE_TYPES.includes(current.type);
 const disp=coarse?(current.type==='page'?resolvePageDisplay(current.pageId):resolveCardDisplay(coarseKey(),current.pageId)):null;
 return `
 <section class="uxc-pane" data-pane="basic" role="tabpanel" aria-labelledby="uxc-tab-basic">
  <div class="uxc-group"><h4>الخط</h4>
   ${rangeCtl('base.fontSize','حجم الخط الأساسي',{min:lim.baseFontSize.min,max:lim.baseFontSize.max,step:lim.baseFontSize.step,value:eff.base?.fontSize??Math.round(resolveBaseScale(eff,{type:current.type,pageId:current.pageId,cardKey:current.cardKey})*15.5*2)/2,unit:'px'})}
   ${selectCtl('base.fontFamily','نوع الخط',FONT_FAMILIES,FONT_FAMILY_LABELS,eff.base?.fontFamily)}
   <p class="uxc-note">تحكم حر متدرج (A ──●── A) بدل درجات محدودة — الحدود تقنية لمنع كسر التصميم فقط. ↺ تعيد القيمة للوضع الموروث.</p>
  </div>
  <div class="uxc-group"><h4>اللون</h4>
   ${colorCtl('text.primaryValue.color','لون النص الأساسي',eff.text?.primaryValue?.color)}
   ${colorCtl('box.accent','لون التمييز / إبراز المرحلة',eff.box?.accent)}
  </div>
  ${current.scope==='global'?`<p class="uxc-note">الافتراضي العام يشمل الخط والنصوص فقط — شكل العناصر (خلفية/حدود/ظلال) يُخصص لكل عنصر أو لكل نوع.</p>`:`
  <div class="uxc-group"><h4>الخلفية</h4>
   ${colorCtl('box.bg','لون الخلفية',eff.box?.bg)}
   ${rangeCtl('box.bgAlpha','شفافية الخلفية',{min:lim.bgAlpha.min,max:lim.bgAlpha.max,step:lim.bgAlpha.step,value:eff.box?.bgAlpha??1})}
  </div>`}
  ${coarse?`<div class="uxc-group"><h4>الكثافة وعرض الحقول (نظام العرض الموحّد الموجود)</h4>
   <div class="uxc-ctl"><span class="uxc-ctl-lbl">كثافة العرض</span><div class="uxc-ctl-in"><div class="uxc-seg" role="radiogroup" aria-label="كثافة العرض" data-coarse="density">${CARD_DENSITIES.map(v=>`<button type="button" role="radio" aria-checked="${disp.density===v}" class="${disp.density===v?'on':''}" data-v="${v}">${esc(CARD_DENSITY_LABELS[v])}</button>`).join('')}</div></div></div>
   <div class="uxc-ctl"><span class="uxc-ctl-lbl">طريقة عرض البيانات</span><div class="uxc-ctl-in"><div class="uxc-seg" role="radiogroup" aria-label="طريقة عرض البيانات" data-coarse="fieldLayout">${FIELD_LAYOUTS.map(v=>`<button type="button" role="radio" aria-checked="${disp.fieldLayout===v}" class="${disp.fieldLayout===v?'on':''}" data-v="${v}">${esc(FIELD_LAYOUT_LABELS[v])}</button>`).join('')}</div></div></div>
   <label class="ux-dp-check"><input type="checkbox" data-coarse-tg="secondary" ${disp.secondary?'checked':''}> إظهار البيانات الثانوية</label>
   <label class="ux-dp-check"><input type="checkbox" data-coarse-tg="borders" ${disp.borders?'checked':''}> إظهار الحدود الفاصلة</label>
  </div>`:''}
 </section>`;
}
function roleBlockHtml(role){
 const eff=effectiveStyle(),own=ownStyle();
 const t=eff.text?.[role]||{};
 const lim=STYLE_LIMITS;
 const extras=ROLE_BOX_EXTRAS[role]||[];
 return `<details class="uxc-role" data-role="${esc(role)}">
  <summary>
   <span class="uxc-role-name">${esc(TEXT_ROLE_LABELS[role]||role)}</span>
   <span class="uxc-role-sample" data-uxc-role="${esc(role)}">${esc(TEXT_ROLE_SAMPLES[role]||'')}</span>
   <span class="uxc-src" data-uxc-src hidden></span>
   <span class="uxc-role-count" data-uxc-role-count hidden></span>
   <button type="button" class="link uxc-role-clear" data-uxc-role-clear="${esc(role)}" title="إعادة هذا النوع من النصوص للوضع الموروث" aria-label="إعادة ${esc(TEXT_ROLE_LABELS[role]||role)} للموروث" hidden>↺</button>
  </summary>
  <div class="uxc-role-body">
   ${rangeCtl(`text.${role}.fs`,'حجم الخط',{min:lim.roleFontSize.min,max:lim.roleFontSize.max,step:lim.roleFontSize.step,value:t.fs,unit:'px'})}
   ${colorCtl(`text.${role}.color`,'اللون',t.color)}
   ${selectCtl(`text.${role}.fw`,'الوزن',FONT_WEIGHTS,FW_LABELS,t.fw)}
   <details class="uxc-adv"><summary>Advanced Typography — typography متقدمة</summary><div class="uxc-adv-body">
    ${rangeCtl(`text.${role}.lh`,'ارتفاع السطر',{min:lim.lineHeight.min,max:lim.lineHeight.max,step:lim.lineHeight.step,value:t.lh})}
    ${rangeCtl(`text.${role}.ls`,'تباعد الأحرف',{min:lim.letterSpacing.min,max:lim.letterSpacing.max,step:lim.letterSpacing.step,value:t.ls,unit:'px'})}
    ${segCtl(`text.${role}.align`,'المحاذاة',TEXT_ALIGNS,TEXT_ALIGN_LABELS,t.align)}
    ${selectCtl(`text.${role}.tt`,'تحويل النص',TEXT_TRANSFORMS,TEXT_TRANSFORM_LABELS,t.tt)}
    ${selectCtl(`text.${role}.td`,'زخرفة النص',TEXT_DECORATIONS,TEXT_DECORATION_LABELS,t.td)}
    ${rangeCtl(`text.${role}.op`,'الشفافية',{min:lim.opacity.min,max:lim.opacity.max,step:lim.opacity.step,value:t.op})}
    ${selectCtl(`text.${role}.ff`,'نوع الخط',FONT_FAMILIES,FONT_FAMILY_LABELS,t.ff)}
   </div></details>
   ${extras.length?`<details class="uxc-adv"><summary>شكل ${role==='legalNumber'?'الرقم':'الشارة'} — خلفية وحدود وحواف</summary><div class="uxc-adv-body">
    ${colorCtl(`text.${role}.bg`,'لون الخلفية',t.bg)}
    ${colorCtl(`text.${role}.bc`,'لون الحدود',t.bc)}
    ${rangeCtl(`text.${role}.bw`,'سمك الحد',{min:lim.roleBorderWidth.min,max:lim.roleBorderWidth.max,step:lim.roleBorderWidth.step,value:t.bw,unit:'px'})}
    ${rangeCtl(`text.${role}.br`,'استدارة الحواف',{min:lim.roleRadius.min,max:lim.roleRadius.max,step:lim.roleRadius.step,value:t.br,unit:'px'})}
    ${rangeCtl(`text.${role}.pad`,'الحشو الداخلي',{min:lim.rolePad.min,max:lim.rolePad.max,step:lim.rolePad.step,value:t.pad,unit:'px'})}
   </div></details>`:''}
  </div>
 </details>`;
}
function textsTabHtml(){
 const roles=rolesFor(current.type,current.scope);
 return `<section class="uxc-pane" data-pane="texts" role="tabpanel" aria-labelledby="uxc-tab-texts" hidden>
  <p class="uxc-note">كل نوع نص يُخصص بشكل مستقل تمامًا عن الآخر — تغيير «اسم الحقل» لا يمس «القيمة الأساسية» ولا أي نوع آخر. العينة بجانب كل نوع تتحدث مباشرة.</p>
  <div class="uxc-roles" data-uxc-rolepane>${roles.map(roleBlockHtml).join('')}</div>
 </section>`;
}
function advancedTabHtml(){
 const eff=effectiveStyle();
 const lim=STYLE_LIMITS;
 if(current.scope==='global')return `<section class="uxc-pane" data-pane="advanced" role="tabpanel" aria-labelledby="uxc-tab-advanced" hidden>
  <p class="uxc-note">لا توجد إعدادات شكل (خلفية/حدود/ظلال) على المستوى العام — حتى لا يتغير شكل كل عنصر في البرنامج دفعة واحدة. خصّص الشكل لكل عنصر على حدة، أو احفظه كافتراضي «نوع» من لوحة ذلك العنصر.</p></section>`;
 return `<section class="uxc-pane" data-pane="advanced" role="tabpanel" aria-labelledby="uxc-tab-advanced" hidden>
  <div class="uxc-group"><h4>Spacing — المسافات</h4>
   ${rangeCtl('box.padding','الحشو الداخلي',{min:lim.padding.min,max:lim.padding.max,step:lim.padding.step,value:eff.box?.padding,unit:'px'})}
   ${rangeCtl('box.gap','المسافة بين العناصر',{min:lim.gap.min,max:lim.gap.max,step:lim.gap.step,value:eff.box?.gap,unit:'px'})}
   ${rangeCtl('box.margin','المسافة الخارجية',{min:lim.margin.min,max:lim.margin.max,step:lim.margin.step,value:eff.box?.margin,unit:'px'})}
  </div>
  <div class="uxc-group"><h4>Border — الحدود</h4>
   ${colorCtl('box.borderColor','لون الحد',eff.box?.borderColor)}
   ${rangeCtl('box.borderWidth','سمك الحد',{min:lim.borderWidth.min,max:lim.borderWidth.max,step:lim.borderWidth.step,value:eff.box?.borderWidth,unit:'px'})}
   ${segCtl('box.borderStyle','نوع الحد',BORDER_STYLES,BORDER_STYLE_LABELS,eff.box?.borderStyle||'solid')}
  </div>
  <div class="uxc-group"><h4>الشكل والظل</h4>
   ${rangeCtl('box.radius','استدارة الحواف',{min:lim.radius.min,max:lim.radius.max,step:lim.radius.step,value:eff.box?.radius,unit:'px'})}
   ${segCtl('box.shadow','الظل',SHADOWS,SHADOW_LABELS,eff.box?.shadow)}
  </div>
  <div class="uxc-group"><h4>Layout — التخطيط والحجم</h4>
   ${segCtl('box.align','محاذاة المحتوى',TEXT_ALIGNS,TEXT_ALIGN_LABELS,eff.box?.align)}
   ${rangeCtl('box.maxWidth','أقصى عرض للعنصر',{min:lim.maxWidth.min,max:lim.maxWidth.max,step:lim.maxWidth.step,value:eff.box?.maxWidth,unit:'px'})}
   <p class="uxc-note">ترتيب الحقول وعدد الأعمدة من «طريقة عرض البيانات» في تبويب أساسي؛ وترتيب الأقسام وإظهارها من «⚙ تخصيص الصفحة». لا يتغير أي ترتيب منطقي للبيانات — تخصيص واجهة فقط.</p>
  </div>
  <div class="uxc-group"><h4>Visibility — الإظهار</h4>
   <p class="uxc-note">إظهار/إخفاء الأقسام وحالة الطي تُدار من نظام الصفحة المركزي («⚙ تخصيص الصفحة») ومن دبوس الطي 📌 في رأس كل بطاقة أو جدول — حتى تبقى دائمًا طريقة استعادة واضحة ولا يُحجب عنصر بلا طريق عودة.</p>
  </div>
 </section>`;
}
function actionsTabHtml(){
 const typeLabel=COMPONENT_TYPE_LABELS[current.type]||current.type;
 const s=current.scope;
 return `<section class="uxc-pane" data-pane="actions" role="tabpanel" aria-labelledby="uxc-tab-actions" hidden>
  <div class="uxc-actions">
   ${s==='element'?`
   <div class="uxc-group"><h4>إعادة الضبط — لهذا العنصر فقط</h4>
    <div class="form-actions"><button type="button" class="ghost danger" data-uxc-reset-element>↺ إعادة إعدادات هذا العنصر</button></div>
    <p class="uxc-note">يعود هذا العنصر وحده إلى الإعداد الموروث (النوع ← الصفحة ← العام ← الافتراضي) — دون تغيير أي عنصر آخر ودون أي مساس بالبيانات.</p>
   </div>
   <div class="uxc-group"><h4>نسخ الإعدادات وتطبيقها (بأمر صريح فقط)</h4>
    <div class="form-actions">
     <button type="button" class="ghost" data-uxc-copy>⧉ نسخ إعدادات هذا العنصر</button>
     <button type="button" class="ghost" data-uxc-paste hidden>تطبيق المنسوخ على هذا العنصر</button>
     <button type="button" class="ghost" data-uxc-applyto>تطبيق على…</button>
    </div>
    <p class="uxc-note uxc-clipinfo" data-uxc-clipinfo hidden></p>
    <div class="uxc-group uxc-applypanel" data-uxc-applypanel hidden>
     <h4>تطبيق على…</h4>
     <input type="search" class="uxc-search" data-uxc-tsearch placeholder="ابحث بالعنوان أو المعرف…" aria-label="بحث في العناصر">
     <div class="uxc-quick-targets">
      <button type="button" class="ghost small" data-uxc-qsel="type">كل عناصر نوع «${esc(typeLabel)}»</button>
      <button type="button" class="ghost small" data-uxc-qsel="page">عناصر هذه الصفحة</button>
      <button type="button" class="ghost small" data-uxc-qsel="pages">كل الصفحات</button>
      <button type="button" class="ghost small" data-uxc-qsel="none">إلغاء التحديد</button>
     </div>
     <div class="uxc-targets" data-uxc-tlist></div>
     <label class="ux-dp-check"><input type="radio" name="uxc-apply-mode" value="replace" checked> استبدال إعدادات العرض المحددة</label>
     <label class="ux-dp-check"><input type="radio" name="uxc-apply-mode" value="merge"> دمج فوق إعداداتها الحالية</label>
     <div class="form-actions"><button type="button" class="primary" data-uxc-apply>تطبيق على المحدد</button><button type="button" class="ghost" data-uxc-apply-cancel>إلغاء</button></div>
     <p class="uxc-note">لا يحدث أي تطبيق جماعي إلا بهذا الأمر الصريح — الإعدادات المستقلة هي القاعدة.</p>
    </div>
   </div>
   <div class="uxc-group"><h4>حفظ كإعداد افتراضي (اختياري)</h4>
    <div class="form-actions">
     <button type="button" class="ghost" data-uxc-save-type>حفظ كافتراضي لنوع «${esc(typeLabel)}»</button>
     <button type="button" class="ghost" data-uxc-save-global>حفظ كافتراضي عام</button>
    </div>
    <p class="uxc-note">يَحفظ تخصيصك الخاص بهذا العنصر فقط (لا الموروث) كمستوى افتراضي أعم. العناصر التي لها Override خاص تبقى كما هي — الافتراضي لا يعني الإجباري.</p>
   </div>`:''}
   ${s==='type'?`<div class="uxc-group"><h4>افتراضي النوع</h4>
    <div class="form-actions"><button type="button" class="ghost danger" data-uxc-reset-type>↺ إعادة افتراضي نوع «${esc(typeLabel)}»</button></div>
    <p class="uxc-note">يمسح مستوى «افتراضي النوع» فقط؛ تخصيصات العناصر الفردية والعام يبقى كل منهما كما هو.</p></div>`:''}
   ${s==='global'?`<div class="uxc-group"><h4>الافتراضي العام</h4>
    <div class="form-actions"><button type="button" class="ghost danger" data-uxc-reset-global>↺ إعادة الافتراضي العام</button></div>
    <p class="uxc-note">يمسح المستوى العام فقط — كل عنصر أو نوع أو صفحة مخصصة تحتفظ بإعداداتها المستقلة.</p></div>`:''}
   <div class="form-actions"><button type="button" class="primary" data-uxc-done>تم</button></div>
  </div>
 </section>`;
}

/** فتح لوحة «⚙ تخصيص العرض» — واحدة لكل العناصر والأنواع والمستويات. */
export function openComponentCustomizer(opts={}){
 const scope=opts.scope==='type'||opts.scope==='global'?opts.scope:'element';
 const type=scope==='type'?(COMPONENT_TYPES.includes(opts.type)?opts.type:'component'):(COMPONENT_TYPES.includes(opts.type)?opts.type:'component');
 const id=scope==='element'?String(opts.id||opts.el?.dataset?.uxcId||''):'';
 if(scope==='element'&&!id){toast('لا يوجد معرف ثابت لهذا العنصر','error');return null}
 current={
  id,type,scope,
  title:String(opts.title||opts.el?.dataset?.uxcTitle||id),
  pageId:String(opts.pageId||opts.el?.dataset?.pageId||opts.el?.closest?.('[data-uxc-page]')?.dataset?.uxcPage||''),
  el:scope==='element'?(opts.el||(id?document.querySelector(`[data-uxc-id="${CSS.escape(id)}"]`):null))||null:null,
  cardKey:String(opts.cardKey||opts.el?.dataset?.displayKey||(id.startsWith('card:')?id.slice(5):''))
 };
 if(scope==='element'&&current.el){
  current.el.dataset.uxcId=id;
  current.el.dataset.uxcType=type;
  noteComponent({id,type,title:current.title,pageId:current.pageId});
 }
 const scopeNote=scope==='type'?`افتراضي نوع — يسري على كل «${COMPONENT_TYPE_LABELS[type]||type}» بلا Override خاص`:scope==='global'?'الافتراضي العام — أدنى مستوى في السلسلة':'تخصيص مستقل — يخص هذا العنصر وحده';
 const card=modal(`
  <div class="uxc-modal" data-uxc-scope="${scope}">
   <h2 class="modal-title">⚙ تخصيص العرض${current.title?` — ${esc(current.title)}`:''}</h2>
   <div class="uxc-idline">${id?`<code class="uxc-idchip" dir="ltr">${esc(id)}</code>`:''}<span class="uxc-typechip">${esc(COMPONENT_TYPE_LABELS[type]||type)}</span><span class="uxc-scope-note">${esc(scopeNote)}</span></div>
   <p class="uxc-note">السلسلة: <b>العنصر ← افتراضي النوع ← الصفحة ← العام ← تصميم النظام</b>. كل تغيير يُحفظ فورًا لهذا المستوى ويُعاين مباشرة — بلا إعادة تحميل وبلا أي مساس بالبيانات.</p>
   <div class="uxc-preview-box uxc-preview" data-uxc-id="uxc-preview" data-uxc-type="card" aria-label="معاينة مباشرة">${PREVIEW_HTML}</div>
   <span class="uxc-pv-label">معاينة مباشرة</span>
   <div class="uxc-tabs" role="tablist" aria-label="أقسام تخصيص العرض">
    ${tabButton('basic','أساسي',true)}${tabButton('texts','النصوص',false)}${tabButton('advanced','متقدم',false)}${tabButton('actions','إجراءات',false)}
   </div>
   ${basicTabHtml()}${textsTabHtml()}${advancedTabHtml()}${actionsTabHtml()}
  </div>`);
 current.card=card;
 bindPanel(card);
 updatePreview();
 syncControls();
 return card;
}
export function closeComponentCustomizer(){closeModal()}

/** فتح اللوحة لعنصر حيّ عبر سماته (data-uxc-id / data-display-key). */
export function openCustomizerForElement(el,trigger=null){
 if(!el)return null;
 const id=el.dataset.uxcId||(el.dataset.displayKey?`card:${el.dataset.displayKey}`:'');
 if(!id)return null;
 if(!el.dataset.uxcId){el.dataset.uxcId=id;el.dataset.uxcType=el.dataset.uxcType||(el.classList.contains('ux-card')?'card':'component')}
 const title=el.dataset.uxcTitle||el.querySelector('.ux-card-title h3,.panel-head h3,.panel-head h2,summary span,.sp-head>b,h3,h2')?.textContent?.trim()||'';
 return openComponentCustomizer({id,type:el.dataset.uxcType||'component',title,el,trigger});
}
export function openGlobalStyleCustomizer(){
 return openComponentCustomizer({scope:'global',type:'component',title:'الافتراضي العام لكل العناصر'});
}
export function openTypeDefaultCustomizer(type){
 return openComponentCustomizer({scope:'type',type,title:`افتراضي نوع «${COMPONENT_TYPE_LABELS[type]||type}»`});
}

// ===== أحداث اللوحة =====
function bindPanel(card){
 // التبويبات
 card.querySelector('.uxc-tabs').addEventListener('click',e=>{
  const btn=e.target.closest('[data-uxc-tab]');if(!btn)return;
  card.querySelectorAll('[data-uxc-tab]').forEach(b=>{const on=b===btn;b.classList.toggle('active',on);b.setAttribute('aria-selected',String(on))});
  card.querySelectorAll('[data-pane]').forEach(p=>{p.hidden=p.dataset.pane!==btn.dataset.uxcTab});
 });
 // أزرار ↺ لكل خاصية
 card.addEventListener('click',e=>{
  const clr=e.target.closest('[data-uxc-clear]');
  if(clr){commit(clr.dataset.uxcClear,null);return}
  const roleClr=e.target.closest('[data-uxc-role-clear]');
  if(roleClr){e.preventDefault();e.stopPropagation();commitRoleClear(roleClr.dataset.uxcRoleClear);return}
  const segBtn=e.target.closest('[data-uxc-seg] button');
  if(segBtn){commit(segBtn.closest('[data-uxc-seg]').dataset.uxcSeg,segBtn.dataset.v||null);return}
  const coarseBtn=e.target.closest('[data-coarse] button');
  if(coarseBtn){commitCoarse(coarseBtn.closest('[data-coarse]').dataset.coarse,coarseBtn.dataset.v);return}
 });
 card.addEventListener('change',e=>{
  const tg=e.target.closest('[data-coarse-tg]');
  if(tg){commitCoarse(tg.dataset.coarseTg,tg.checked);return}
  const color=e.target.closest('[data-uxc-color]');
  if(color){commit(color.dataset.uxcColor,color.value);return}
  const sel=e.target.closest('[data-uxc-select]');
  if(sel){commit(sel.dataset.uxcSelect,sel.value||null);return}
  const range=e.target.closest('[data-uxc-range]');
  if(range){clearTimeout(rangeTimer);commit(range.dataset.uxcRange,Number(range.value));return}
 });
 card.addEventListener('input',e=>{
  const range=e.target.closest('[data-uxc-range]');
  if(range){
   const out=range.closest('[data-path]')?.querySelector('[data-uxc-out]');
   if(out)out.textContent=range.value;
   clearTimeout(rangeTimer);
   const path=range.dataset.uxcRange,value=Number(range.value);
   rangeTimer=setTimeout(()=>commit(path,value),140);
   return;
  }
  const color=e.target.closest('[data-uxc-color]');
  if(color){
   clearTimeout(rangeTimer);
   const path=color.dataset.uxcColor,value=color.value;
   const hex=color.closest('[data-path]')?.querySelector('[data-uxc-hex]');
   if(hex)hex.value=value;
   rangeTimer=setTimeout(()=>commit(path,value),120);
   return;
  }
  const hex=e.target.closest('[data-uxc-hex]');
  if(hex){
   const v=hex.value.trim().toLowerCase();
   if(v===''||/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/.test(v)){
    clearTimeout(rangeTimer);
    const path=hex.dataset.uxcHex;
    rangeTimer=setTimeout(()=>commit(path,v||null),250);
   }
   return;
  }
  const search=e.target.closest('[data-uxc-tsearch]');
  if(search){
   const q=search.value.trim();
   card.querySelectorAll('[data-uxc-tlist] label').forEach(l=>{l.hidden=Boolean(q)&&!l.textContent.includes(q)});
  }
 });
 // الإجراءات
 card.addEventListener('click',async e=>{
  const hit=sel=>e.target.closest?.(sel)||null;
  if(hit('[data-uxc-done]')){closeModal();return}
  if(hit('[data-uxc-reset-element]')){
   const btn=hit('[data-uxc-reset-element]');
   if(btn.dataset.confirm!=='1'){btn.dataset.confirm='1';btn.textContent='تأكيد إعادة هذا العنصر؟';setTimeout(()=>{if(btn.isConnected){btn.dataset.confirm='';btn.textContent='↺ إعادة إعدادات هذا العنصر'}},4000);return}
   clearComponentStyle(current.id);refreshApplied();toast('أُعيد هذا العنصر إلى الإعداد الموروث — وحده');return;
  }
  if(hit('[data-uxc-reset-type]')){
   if(!await confirmBox(`إعادة افتراضي نوع «${COMPONENT_TYPE_LABELS[current.type]||current.type}»؟ يمسح هذا المستوى فقط؛ تخصيصات العناصر الفردية تبقى كما هي. لا يمس أي بيانات.`,{okText:'إعادة افتراضي النوع'}))return;
   clearTypeDefault(current.type);refreshApplied();toast('أُعيد افتراضي النوع');return;
  }
  if(hit('[data-uxc-reset-global]')){
   if(!await confirmBox('إعادة الافتراضي العام؟ يمسح المستوى العام فقط — كل عنصر/نوع/صفحة مخصصة تحتفظ بإعداداتها المستقلة. لا يمس أي بيانات.',{okText:'إعادة الافتراضي العام'}))return;
   clearGlobalStyle();refreshApplied();toast('أُعيد الافتراضي العام');return;
  }
  if(hit('[data-uxc-copy]')){
   copyComponentStyle(current.id,{type:current.type,pageId:current.pageId});
   toast('نُسخ الإعداد الفعّال لهذا العنصر — الطبقة جاهزة للتطبيق الصريح');syncControls();return;
  }
  if(hit('[data-uxc-paste]')){
   const cb=getStyleClipboard();if(!cb)return;
   if(!await confirmBox(`تطبيق إعدادات «${cb.fromId}» المنسوخة على هذا العنصر (استبدال تخصيصه الحالي)؟`,{okText:'تطبيق'}))return;
   applyStyleToComponentIds([current.id],cb.style,{replace:true,type:current.type,pageId:current.pageId});
   refreshApplied();toast('طُبقت الإعدادات المنسوخة على هذا العنصر');return;
  }
  if(hit('[data-uxc-applyto]')){
   const panel=card.querySelector('[data-uxc-applypanel]');
   panel.hidden=!panel.hidden;
   if(!panel.hidden)drawTargets();
   return;
  }
  if(hit('[data-uxc-apply-cancel]')){card.querySelector('[data-uxc-applypanel]').hidden=true;return}
  const qsel=hit('[data-uxc-qsel]');
  if(qsel){
   const mode=qsel.dataset.uxcQsel;
   card.querySelectorAll('[data-uxc-tlist] input[type="checkbox"]').forEach(box=>{
    const label=box.closest('label');
    const t=label?.dataset.type||'',p=label?.dataset.pageid||'';
    box.checked=mode==='type'?t===current.type:mode==='page'?p===current.pageId&&Boolean(p):mode==='pages'?t==='page':false;
    if(label)label.hidden=false;
   });
   return;
  }
  if(hit('[data-uxc-apply]')){
   const ids=[...card.querySelectorAll('[data-uxc-tlist] input[type="checkbox"]:checked')].map(b=>b.value);
   if(!ids.length){toast('لم يُحدد أي عنصر','error');return}
   const mode=card.querySelector('input[name="uxc-apply-mode"]:checked')?.value||'replace';
   const style=resolveComponentStyle(current.id,{type:current.type,pageId:current.pageId});
   if(!await confirmBox(`تطبيق إعدادات عرض «${current.title||current.id}» على ${ids.length} عنصرًا (${mode==='replace'?'استبدال تخصيصاتها':'دمج فوق تخصيصاتها'})؟ يتم هذا بأمر صريح منك فقط — ولا يمس أي بيانات أو سجلات.`,{okText:'تطبيق على المحدد'}))return;
   const n=applyStyleToComponentIds(ids,style,{replace:mode==='replace',type:current.type,pageId:current.pageId});
   applyAllComponentStyles(document);
   card.querySelector('[data-uxc-applypanel]').hidden=true;
   toast(`طُبقت الإعدادات على ${n} عنصرًا`);
   return;
  }
  if(hit('[data-uxc-save-type]')){
   const own=ownStyle();
   if(!Object.keys(own).length){toast('لا يوجد تخصيص خاص بهذا العنصر لحفظه كافتراضي — خصّص أولًا','error');return}
   if(!await confirmBox(`حفظ تخصيصك الخاص بهذا العنصر كافتراضي لكل «${COMPONENT_TYPE_LABELS[current.type]||current.type}»؟ يسري على العناصر التي لا تملك Override خاصًا؛ العناصر المخصصة فرديًا لا تتأثر.`,{okText:'حفظ كافتراضي للنوع'}))return;
   setTypeDefault(current.type,own);
   applyAllComponentStyles(document);updatePreview();
   toast(`حُفظ كافتراضي لنوع «${COMPONENT_TYPE_LABELS[current.type]||current.type}»`);return;
  }
  if(hit('[data-uxc-save-global]')){
   const own=ownStyle();
   if(!Object.keys(own).length){toast('لا يوجد تخصيص خاص بهذا العنصر لحفظه كافتراضي عام','error');return}
   if(!await confirmBox('حفظ تخصيصك الخاص بهذا العنصر كافتراضي عام؟ يسري على كل عنصر لا يملك Override خاصًا (عنصر/نوع/صفحة) — وهذا مختلف تمامًا عن تعديل عنصر واحد.',{okText:'حفظ كافتراضي عام'}))return;
   setGlobalStyle(own);
   applyAllComponentStyles(document);updatePreview();
   toast('حُفظ كافتراضي عام');return;
  }
 });
 // عيّنة أنواع النصوص داخل اللوحة تتحدث مباشرة
 const rolePane=card.querySelector('[data-uxc-rolepane]');
 if(rolePane)applyStyleVars(rolePane,effectiveStyle(),{type:'card'});
}
async function commitCoarse(key,value){
 if(!current)return;
 const displayKey=coarseKey();
 if(current.type==='page')setPageDisplay(current.pageId,{[key]:value});
 else setCardDisplay(displayKey,{[key]:value});
 // تطبيق فوري على العنصر الحيّ (سمات data-* القديمة) ثم تحديث المقياس الحر
 try{
  if(current.el){
   const {applyCardDisplay}=await import('./card-display.js');
   if(current.type==='page'){
    const {applyPageDisplay}=await import('./page-layout.js');
    applyPageDisplay(current.el,current.pageId);
   }else applyCardDisplay(current.el,displayKey,current.pageId);
   applyComponentStyle(current.el,current.id,{type:current.type,pageId:current.pageId,cardKey:current.cardKey});
  }
  applyAllComponentStyles(document);
 }catch{}
 updatePreview();syncControls();
}
function drawTargets(){
 const card=current?.card;if(!card)return;
 const list=card.querySelector('[data-uxc-tlist]');
 if(!list)return;
 const items=knownComponents().filter(c=>c.id!==current.id&&c.type!=='grid');
 list.innerHTML=items.map(c=>`<label data-type="${esc(c.type)}" data-pageid="${esc(c.pageId)}"><input type="checkbox" value="${esc(c.id)}"><span>${esc(c.title||COMPONENT_TYPE_LABELS[c.type]||c.type)}</span><span class="uxc-t-id">${esc(c.id)}</span></label>`).join('')||'<p class="uxc-note">لا توجد عناصر معروفة أخرى بعد — تُرصد العناصر أثناء تصفح صفحاتها.</p>';
}

// ===== الربط التلقائي في أي جذر (اكتشاف + وسم + تطبيق + أزرار ⚙) =====
const headTitle=el=>el.querySelector('.panel-head h3,.panel-head h2,.sp-head>b,summary span,h3,h2,b')?.textContent?.trim()||'';
function ensureGear(el,{id,title}){
 if(el.querySelector('.uxc-gear'))return;
 const btn=document.createElement('button');
 btn.type='button';btn.className='uxc-gear';
 btn.dataset.uxcGear=id;
 btn.setAttribute('aria-haspopup','dialog');
 btn.setAttribute('aria-label',`تخصيص العرض${title?': '+title:''}`);
 btn.title='⚙ تخصيص العرض';
 btn.innerHTML=icon('settings');
 btn.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();openCustomizerForElement(el,btn)});
 const head=el.querySelector('.panel-head,.panel-collapse-head,summary,.sp-head');
 if(head&&head.closest('[data-uxc-id]')===el)head.append(btn);
 else{el.classList.add('uxc-gear-host');el.append(btn)}
}
/**
 * اكتشاف العناصر القابلة للتخصيص في جذر معين: البطاقات (من نظام البطاقات
 * الموجود)، الأقسام (data-section-id)، والمكونات المسجلة/الموسومة
 * (data-uxc-id) — ثم تطبيق إعداداتها المحفوظة وربط أزرار ⚙. Idempotent.
 */
export function bindCustomizableComponents(root=document){
 if(!root?.querySelectorAll)return;
 const pageId=root.dataset?.uxcPage||root.closest?.('[data-uxc-page]')?.dataset?.uxcPage||'';
 const seen=new Set();
 // 1) البطاقات — نظام البطاقات الموجود (displayKey هو الهوية الثابتة)
 root.querySelectorAll('.ux-card[data-display-key]').forEach(el=>{
  const key=el.dataset.displayKey,id=`card:${key}`;
  if(!el.dataset.uxcId){el.dataset.uxcId=id;el.dataset.uxcType='card'}
  const pid=el.dataset.pageId||pageId;
  const title=el.dataset.uxcTitle||el.querySelector('.ux-card-title h3')?.textContent?.trim()||'';
  if(title)el.dataset.uxcTitle=title;
  noteComponent({id,type:'card',title,pageId:pid});
  applyComponentStyle(el,id,{type:'card',pageId:pid,cardKey:key});
  seen.add(el);
 });
 // 2) الأقسام غير البطاقة (لوحات/تفاصيل/حاويات) — لكل قسم هوية مستقرة
 root.querySelectorAll('[data-section-id]').forEach(el=>{
  if(seen.has(el)||el.classList.contains('ux-card'))return;
  const sid=el.dataset.sectionId,id=`section:${pageId||'page'}:${sid}`;
  el.dataset.uxcId=id;el.dataset.uxcType='section';
  const title=el.dataset.uxcTitle||headTitle(el)||sid;
  el.dataset.uxcTitle=title;
  noteComponent({id,type:'section',title,pageId});
  ensureGear(el,{id,title});
  applyComponentStyle(el,id,{type:'section',pageId});
  seen.add(el);
 });
 // 3) المراحل وأي مكون موسوم (stage / stagepath / component / مسجل مسبقًا)
 const processTagged=el=>{
  if(seen.has(el)||el.classList.contains('uxc-preview'))return;
  const id=el.dataset.uxcId,type=el.dataset.uxcType||'component';
  const title=el.dataset.uxcTitle||(type==='stage'?el.querySelector('span')?.textContent?.trim()||'':headTitle(el))||'';
  if(title)el.dataset.uxcTitle=title;
  const pid=el.dataset.uxcPage||pageId;
  noteComponent({id,type,title,pageId:type==='page'?'':pid});
  const reg=getRegisteredComponent(id);
  if(el.hasAttribute('data-uxc-gear')||reg?.gear===true&&!el.classList.contains('ux-card'))ensureGear(el,{id,title});
  applyComponentStyle(el,id,{type,pageId:type==='page'?'':pid,cardKey:el.dataset.displayKey||''});
  seen.add(el);
 };
 root.querySelectorAll('[data-uxc-id]').forEach(processTagged);
 // 4) الجذر نفسه إن كان مكوّنًا موسومًا (جذر الصفحة page:<id> مثلًا)
 if(root.matches?.('[data-uxc-id]'))processTagged(root);
}

/**
 * نقطة الدخول الموحدة بعد كل تنقل (تُستدعى من app.js): توسم الصفحة كمكوّن،
 * ثم اكتشاف وربط وتطبيق كل العناصر — نقل أنماط فقط، بلا إعادة رسم.
 */
export function applyUniversalStyles(root,pageId=''){
 if(!root)return;
 if(pageId){
  root.dataset.uxcPage=pageId;
  if(!root.dataset.uxcId){root.dataset.uxcId=`page:${pageId}`;root.dataset.uxcType='page'}
  const title=globalThis.document?.querySelector?.('#page-title')?.textContent?.trim()||pageId;
  noteComponent({id:`page:${pageId}`,type:'page',title,pageId:''});
 }
 bindCustomizableComponents(root);
}
