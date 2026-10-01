// =====================================================================
// CardDisplayController — زر «إعدادات العرض» داخل كل بطاقة موحدة
// ---------------------------------------------------------------------
// • يُطبَّق على البطاقة المعنية فقط (تغيير data-attributes محلية) — بلا
//   إعادة رسم للصفحة وبلا إعادة قراءة أي بيانات من IndexedDB.
// • الحفظ عبر DisplayPreferences المركزي (بطاقة ← صفحة ← عام ← افتراضي).
// • سطح المكتب: Popover صغير داخل البطاقة. الهاتف (≤640px): Bottom Sheet
//   بلمس مريح — نفس المحتوى، بلا اعتماد على Hover.
// • وصول: role=dialog، تسميات ARIA، إغلاق بـ Esc أو نقرة خارجية، وإعادة
//   التركيز إلى الزر الذي فتح اللوحة.
import {esc} from './dom.js';
import {icon} from './icons.js';
import {
 resolveCardDisplay,setCardDisplay,clearCardDisplay,stepCardFontSize,
 CARD_FONT_SIZES,CARD_FONT_LABELS,CARD_DENSITIES,CARD_DENSITY_LABELS,
 FIELD_LAYOUTS,FIELD_LAYOUT_LABELS
} from '../core/display-prefs.js';

/** سمات العرض التي تترجمها css/display.css إلى متغيرات قياس. */
export function applyCardDisplay(el,cardKey,pageId=''){
 if(!el||!cardKey)return null;
 const resolved=resolveCardDisplay(cardKey,pageId);
 el.dataset.cfont=resolved.fontSize;
 el.dataset.cdensity=resolved.density;
 el.dataset.clayout=resolved.fieldLayout;
 el.dataset.csecondary=resolved.secondary?'on':'off';
 el.dataset.cborders=resolved.borders?'on':'off';
 return resolved;
}

/** ⚙ إعدادات العرض — زر صغير أنيق في رأس البطاقة (قبل دبوس الطي). */
export function cardDisplayButtonMarkup(cardKey,title=''){
 return `<button type="button" class="ux-card-display" data-card-display="${esc(cardKey)}" aria-haspopup="dialog" aria-label="إعدادات عرض البطاقة${title?': '+esc(title):''}" title="إعدادات العرض">${icon('settings')}</button>`;
}

const seg=(name,current,options,labels,ariaLabel)=>`<div class="ux-seg" role="radiogroup" aria-label="${esc(ariaLabel)}" data-seg="${esc(name)}">${options.map(value=>`<button type="button" role="radio" aria-checked="${value===current}" class="${value===current?'on':''}" data-v="${esc(value)}">${esc(labels[value]||value)}</button>`).join('')}</div>`;

let openPanel=null,openTrigger=null,openCardEl=null;

export function closeCardDisplayPanel(){
 if(!openPanel)return;
 const panel=openPanel,trigger=openTrigger;
 openPanel=null;openTrigger=null;openCardEl=null;
 document.removeEventListener('keydown',onPanelKey,true);
 panel.remove();
 try{if(trigger&&document.contains(trigger))trigger.focus({preventScroll:true})}catch{}
}
function onPanelKey(e){
 if(e.key==='Escape'&&openPanel){e.stopPropagation();closeCardDisplayPanel()}
}
function refreshPanel(){
 if(!openPanel||!openCardEl)return;
 const key=openCardEl.dataset.displayKey,pageId=openCardEl.dataset.pageId||'';
 const resolved=applyCardDisplay(openCardEl,key,pageId)||resolveCardDisplay(key,pageId);
 openPanel.querySelectorAll('[data-seg="fontSize"] button').forEach(b=>{const on=b.dataset.v===resolved.fontSize;b.classList.toggle('on',on);b.setAttribute('aria-checked',String(on))});
 openPanel.querySelectorAll('[data-seg="density"] button').forEach(b=>{const on=b.dataset.v===resolved.density;b.classList.toggle('on',on);b.setAttribute('aria-checked',String(on))});
 openPanel.querySelectorAll('[data-seg="fieldLayout"] button').forEach(b=>{const on=b.dataset.v===resolved.fieldLayout;b.classList.toggle('on',on);b.setAttribute('aria-checked',String(on))});
 const secondary=openPanel.querySelector('[data-tg="secondary"]');if(secondary)secondary.checked=resolved.secondary!==false;
 const borders=openPanel.querySelector('[data-tg="borders"]');if(borders)borders.checked=resolved.borders!==false;
}

/** فتح لوحة إعدادات عرض بطاقة معينة (واحدة فقط في كل مرة). */
export function openCardDisplayPanel(cardEl,trigger=null){
 if(!cardEl?.dataset?.displayKey)return null;
 if(openPanel&&openCardEl===cardEl){closeCardDisplayPanel();return null}
 closeCardDisplayPanel();
 const key=cardEl.dataset.displayKey,pageId=cardEl.dataset.pageId||'';
 const resolved=resolveCardDisplay(key,pageId);
 const panel=document.createElement('div');
 panel.className='ux-display-pop';
 panel.setAttribute('role','dialog');
 panel.setAttribute('aria-label','إعدادات عرض البطاقة');
 panel.innerHTML=`
  <div class="ux-dp-head"><b>${icon('settings')} إعدادات العرض</b><button type="button" class="link ux-dp-close" aria-label="إغلاق إعدادات العرض">✕</button></div>
  <div class="ux-dp-row"><span class="ux-dp-lbl" id="ux-dp-font-lbl">حجم الخط</span>
   <div class="ux-dp-stepper">
    <button type="button" class="ghost small" data-fstep="-1" aria-label="تصغير حجم الخط" title="تصغير">A−</button>
    ${seg('fontSize',resolved.fontSize,CARD_FONT_SIZES,CARD_FONT_LABELS,'حجم خط البطاقة')}
    <button type="button" class="ghost small" data-fstep="1" aria-label="تكبير حجم الخط" title="تكبير">A+</button>
   </div></div>
  <div class="ux-dp-row"><span class="ux-dp-lbl">كثافة العرض</span>${seg('density',resolved.density,CARD_DENSITIES,CARD_DENSITY_LABELS,'كثافة عرض البطاقة')}</div>
  <div class="ux-dp-row"><span class="ux-dp-lbl">طريقة عرض البيانات</span>${seg('fieldLayout',resolved.fieldLayout,FIELD_LAYOUTS,FIELD_LAYOUT_LABELS,'طريقة عرض البيانات')}</div>
  <label class="ux-dp-check"><input type="checkbox" data-tg="secondary" ${resolved.secondary?'checked':''}> إظهار البيانات الثانوية</label>
  <label class="ux-dp-check"><input type="checkbox" data-tg="borders" ${resolved.borders?'checked':''}> إظهار الحدود الفاصلة</label>
  <div class="ux-dp-foot"><button type="button" class="ghost small" data-dp-reset>↺ إعادة الإعدادات الافتراضية</button><small class="muted">تُحفظ اختياراتك تلقائيًا لهذه البطاقة</small></div>`;
 cardEl.append(panel);
 openPanel=panel;openTrigger=trigger;openCardEl=cardEl;
 document.addEventListener('keydown',onPanelKey,true);
 panel.addEventListener('click',e=>{
  const hit=sel=>e.target.closest?.(sel)||null;
  if(hit('.ux-dp-close')){closeCardDisplayPanel();return}
  const fs=hit('[data-seg="fontSize"] button');
  if(fs){setCardDisplay(key,{fontSize:fs.dataset.v});refreshPanel();return}
  const dn=hit('[data-seg="density"] button');
  if(dn){setCardDisplay(key,{density:dn.dataset.v});refreshPanel();return}
  const fl=hit('[data-seg="fieldLayout"] button');
  if(fl){setCardDisplay(key,{fieldLayout:fl.dataset.v});refreshPanel();return}
  const step=hit('[data-fstep]');
  if(step){const current=resolveCardDisplay(key,pageId).fontSize;setCardDisplay(key,{fontSize:stepCardFontSize(current,Number(step.dataset.fstep))});refreshPanel();return}
  if(hit('[data-dp-reset]')){clearCardDisplay(key);refreshPanel();return}
 });
 panel.addEventListener('change',e=>{
  const toggle=e.target.closest?.('[data-tg]');
  if(!toggle)return;
  setCardDisplay(key,{[toggle.dataset.tg]:toggle.checked});
  refreshPanel();
 });
 try{panel.querySelector('[data-seg="fontSize"] button.on')?.focus({preventScroll:true})}catch{}
 return panel;
}

// إغلاق عند النقر خارج اللوحة (capture حتى لا يسبقه toggle رأس البطاقة)
document.addEventListener('mousedown',e=>{
 if(openPanel&&!e.target.closest?.('.ux-display-pop')&&!e.target.closest?.('[data-card-display]'))closeCardDisplayPanel();
},true);

/** ربط أزرار إعدادات العرض داخل جذر معين — يُستدعى من bindCards ( idempotent ). */
export function bindCardDisplay(root=document){
 if(!root?.querySelectorAll)return;
 root.querySelectorAll('.ux-card[data-display-key] [data-card-display]').forEach(btn=>{
  if(btn.dataset.displayBound)return;
  btn.dataset.displayBound='1';
  btn.addEventListener('click',e=>{
   e.preventDefault();e.stopPropagation();
   const cardEl=btn.closest('.ux-card');
   if(!cardEl)return;
   if(openPanel&&openCardEl===cardEl)closeCardDisplayPanel();
   else openCardDisplayPanel(cardEl,btn);
  });
 });
}
