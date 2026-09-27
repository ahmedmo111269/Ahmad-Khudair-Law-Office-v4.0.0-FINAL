// قائمة «إضافة» السريعة في الشريط العلوي: كل عنصر يفتح نموذجه الخاص.
import {modal,closeModal} from '../ui/modal.js';
import {openEntityForm} from '../ui/form.js';
import {ENTITIES} from '../domain/entities.js';
const ITEMS=[['files','📁'],['clients','👤'],['opponents','⚔️'],['cases','⚖️'],['hearings','🗓️'],['procedures','📝'],['powersOfAttorney','📜'],['appointments','⏰'],['communications','📞'],['caseNotes','🗒️'],['judgments','🔨'],['expertReports','🧾'],['execution','🏛️'],['fees','💰'],['documentReferences','📎']];
export function openQuickAdd(app){
 const card=modal(`<h2 class="modal-title">إضافة جديد</h2><div class="quick-grid">${ITEMS.map(([s,i])=>`<button type="button" class="quick-item" data-qa="${s}"><span aria-hidden="true">${i}</span>${ENTITIES[s].label}</button>`).join('')}</div>`);
 card.querySelectorAll('[data-qa]').forEach(b=>b.onclick=()=>{closeModal();openEntityForm(app,b.dataset.qa)});
}
