// =====================================================================
// CardDisplayController — زر «⚙ تخصيص العرض» داخل كل بطاقة موحدة
// ---------------------------------------------------------------------
// • applyCardDisplay يضبط سمات القياس المحلية (data-cfont/cdensity/…) من
//   DisplayPreferences الموجود — بلا إعادة رسم وبلا إعادة قراءة بيانات.
// • زر ⚙ يفتح الآن اللوحة العالمية الواحدة «تخصيص العرض»
//   (ui/component-customizer.js) — نفس النظام المركزي لكل العناصر:
//   البطاقات، الأقسام، المراحل، الصفحات، الجداول وأي مكون مسجل.
//   التعديل يخص البطاقة المعنية فقط (Override مستقل بهويتها الثابتة
//   card:<displayKey>) ولا ينتقل لأي بطاقة أخرى إلا بأمر صريح.
// • الوصول: النافذة الحوارية الموحدة (modal) بفخ تركيز وإغلاق بـ Esc،
//   واستعادة التركيز للزر الذي فتحها.
import {esc} from './dom.js';
import {icon} from './icons.js';
import {resolveCardDisplay} from '../core/display-prefs.js';
import {openCustomizerForElement,closeComponentCustomizer} from './component-customizer.js';

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

/** ⚙ تخصيص العرض — زر صغير أنيق في رأس البطاقة (قبل دبوس الطي). */
export function cardDisplayButtonMarkup(cardKey,title=''){
 return `<button type="button" class="ux-card-display" data-card-display="${esc(cardKey)}" aria-haspopup="dialog" aria-label="تخصيص عرض البطاقة${title?': '+esc(title):''}" title="تخصيص العرض">${icon('settings')}</button>`;
}

/** فتح لوحة تخصيص العرض لبطاقة — اللوحة العالمية المركزية (عنصر واحد في كل مرة). */
export function openCardDisplayPanel(cardEl,trigger=null){
 if(!cardEl?.dataset?.displayKey&&!cardEl?.dataset?.uxcId)return null;
 return openCustomizerForElement(cardEl,trigger);
}
/** إغلاق اللوحة المفتوحة (نافذة موحدة). */
export function closeCardDisplayPanel(){
 if(document.querySelector('#modal-root .uxc-modal'))closeComponentCustomizer();
}

/** ربط أزرار تخصيص العرض داخل جذر معين — يُستدعى من bindCards ( idempotent ). */
export function bindCardDisplay(root=document){
 if(!root?.querySelectorAll)return;
 root.querySelectorAll('.ux-card[data-display-key] [data-card-display]').forEach(btn=>{
  if(btn.dataset.displayBound)return;
  btn.dataset.displayBound='1';
  btn.addEventListener('click',e=>{
   e.preventDefault();e.stopPropagation();
   const cardEl=btn.closest('.ux-card');
   if(!cardEl)return;
   openCardDisplayPanel(cardEl,btn);
  });
 });
}
