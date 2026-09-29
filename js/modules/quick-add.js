// قائمة «إضافة» السريعة في الشريط العلوي: بحث فوري داخل الأنواع + أيقونات موحدة + اختصار لكل عنصر.
import {modal,closeModal} from '../ui/modal.js';
import {esc} from '../ui/dom.js';
import {ENTITIES} from '../domain/entities.js';
import {icon} from '../ui/icons.js';
import {normalizeArabic} from '../core/search-normalizer.js';

const QI={files:'folder',clients:'users',opponents:'userX',cases:'gavel',hearings:'calendar',procedures:'clipboard',powersOfAttorney:'stamp',appointments:'clock',communications:'phone',caseNotes:'note',judgments:'landmark',expertReports:'microscope',execution:'hammer',fees:'wallet',documentReferences:'file',serviceRecords:'stamp',bailiffs:'scale'};
const ITEMS=Object.keys(QI).filter(s=>ENTITIES[s]).map(s=>[s,QI[s]]);
export function openQuickAdd(app){
 const card=modal(`<h2 class="modal-title">إضافة جديد</h2><input type="search" class="qa-filter" placeholder="فلترة سريعة… (مثل: جلسة، موكل، أتعاب)" aria-label="فلترة قائمة الإضافة"><div class="quick-grid">${ITEMS.map(([s,i])=>`<button type="button" class="quick-item" data-qa="${s}" data-label="${esc(normalizeArabic(ENTITIES[s].label))}"><span class="quick-ic" aria-hidden="true">${icon(i)}</span>${ENTITIES[s].label}</button>`).join('')}</div>`);
 card.classList.add('quick-card');
 const input=card.querySelector('.qa-filter');
 input.addEventListener('input',()=>{const n=normalizeArabic(input.value.trim());card.querySelectorAll('.quick-item').forEach(b=>b.hidden=Boolean(n)&&!b.dataset.label.includes(n))});
 setTimeout(()=>input.focus(),30);
 let lastActive=null;
 card.querySelector('.quick-grid').addEventListener('mouseover',e=>{const b=e.target.closest('.quick-item');if(b)lastActive=b});
 input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();(lastActive||card.querySelector('.quick-item:not([hidden])'))?.click()}});
 card.querySelectorAll('[data-qa]').forEach(b=>b.onclick=async()=>{closeModal();if(b.dataset.qa==='files'){const {startNewLegalFile}=await import('./client-file.js');return startNewLegalFile(app)}const {openEntityForm}=await import('../ui/form.js');openEntityForm(app,b.dataset.qa)});
 return card;
}
