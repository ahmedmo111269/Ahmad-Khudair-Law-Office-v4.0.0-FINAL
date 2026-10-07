import {contextualQuickActions,openQuickAdd} from '../modules/quick-add.js';
import {openRecordPreview} from '../ui/record-preview.js';
import {closeModal} from '../ui/modal.js';

export async function runQuickActionTests(test,expect){
 test('إجراءات الإضافة السياقية تتبدل مع المسار الحالي',()=>{
  const actions=contextualQuickActions({route:'file:file-1'});
  expect(actions.some(action=>action.kind==='hearing'&&action.context.id==='file-1')).toBe(true);
  expect(actions.some(action=>action.kind==='party')).toBe(true);
  expect(contextualQuickActions({route:'dashboard'}).length).toBe(0);
 });
 test('قائمة الإضافة قابلة للبحث والفتح بالكيبورد وتعرض الأنواع القديمة',()=>{
  document.body.innerHTML='<div id="modal-root"></div>';
  const card=openQuickAdd({route:'dashboard'});
  expect(card.querySelector('[role="combobox"]')!==null).toBe(true);
  expect(card.querySelector('[role="listbox"]')!==null).toBe(true);
  expect(card.querySelector('[data-qa-kind="file"]')!==null).toBe(true);
  const toggle=card.querySelector('[data-quick-more]');toggle.click();
  expect(card.querySelector('.quick-more').hidden).toBe(false);
  toggle.click();expect(card.querySelector('.quick-more').hidden).toBe(true);
  const input=card.querySelector('.qa-filter');input.value='أتعاب';input.dispatchEvent(new Event('input',{bubbles:true}));
  expect(card.querySelector('.quick-more').hidden).toBe(false);
  expect(card.querySelector('[data-qa-kind="fees"]').hidden).toBe(false);
  expect(toggle.hidden).toBe(true);
  closeModal();
 });
 test('المعاينة السريعة تستبعد الحقول الحساسة وتبقي النص غير موثوق كنص',async()=>{
  document.body.innerHTML='<div id="modal-root"></div>';
  const row={id:'preview-client',fullName:'<img src=x onerror=alert(1)>',clientCode:'CL-2026-000001',nationalId:'29001011201234',phone:'01000000000',address:'عنوان تجريبي',city:'مدينة حساسة',status:'active'};
  const app={route:'clients',office:{r:{clientFiles:{byIndex:async()=>[]}}},go(){}};
  const card=await openRecordPreview(app,'clients',row);
  expect(card.querySelector('img')===null).toBe(true);
  expect(card.textContent.includes(row.fullName)).toBe(true);
  expect(card.textContent.includes(row.nationalId)).toBe(false);
  expect(card.textContent.includes(row.phone)).toBe(false);
  expect(card.textContent.includes(row.address)).toBe(false);
  expect(card.textContent.includes(row.city)).toBe(false);
  expect(card.querySelector('[data-preview-open]')!==null).toBe(true);
  closeModal();
 });
}
