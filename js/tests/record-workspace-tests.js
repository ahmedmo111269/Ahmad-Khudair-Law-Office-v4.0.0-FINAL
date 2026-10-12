import {bindRecordWorkspaceTabs,primaryRecordTabs,recordSectionsFor,recordWorkspaceMarkup,section,kvHtml} from '../modules/record-page.js';
import {registerPageLayout} from '../ui/page-layout.js';

export function runRecordWorkspaceTests(test,expect){
 test('سجل البيانات: الحقل الفارغ يبقى محفوظًا ويصبح خيار عرض مستقلًا افتراضيًا',()=>{
  const html=kvHtml([{k:'email',l:'البريد الإلكتروني',t:'text'}],{email:''},new Map(),{skipEmpty:false,includeEmptyAvailable:true});
  const host=document.createElement('div');host.innerHTML=html;
  const field=host.querySelector('[data-display-item="field:email"]');
  expect(Boolean(field)).toBe(true);
  expect(field.dataset.displayDefaultHidden).toBe('true');
  expect(field.textContent.includes('غير مسجل')).toBe(true);
 });

 test('مساحة سجل القضية تسجل الخط الزمني والجلسات والأحكام وبقية الوظائف',()=>{
  const sections=recordSectionsFor('cases');
  const ids=sections.map(section=>section.id);
  expect(ids.includes('case-timeline')).toBe(true);
  expect(ids.includes('hearings')).toBe(true);
  expect(ids.includes('judgments')).toBe(true);
  expect(ids.includes('quickNotes')).toBe(true);
  expect(ids.includes('work')).toBe(true);
  expect(ids.includes('activity')).toBe(true);
  expect(primaryRecordTabs('cases',sections).join('|')).toBe('data|case-timeline|hearings|judgments');
 });

 test('مساحات الجلسة والإعلان تعرض الدورة في التبويبات الأساسية وتحافظ على المرتبطات',()=>{
  const hearingSections=recordSectionsFor('hearings');
  const serviceSections=recordSectionsFor('serviceRecords');
  expect(primaryRecordTabs('hearings',hearingSections).join('|')).toBe('data|hearing-cycle|quickNotes|work');
  expect(primaryRecordTabs('serviceRecords',serviceSections).join('|')).toBe('data|service-cycle|quickNotes|work');
  expect(hearingSections.some(section=>section.id==='activity')).toBe(true);
  expect(serviceSections.some(section=>section.id==='activity')).toBe(true);
 });

 test('تبويبات السجل تبدّل اللوحات وتحمّل القسم عند أول فتح فقط',async()=>{
  const pageId='record-workspace-test';
  const sections=[
   {id:'data',title:'البيانات',icon:'▤'},
   {id:'files',title:'الملفات',count:'2',icon:'▣'},
   {id:'activity',title:'النشاط',count:'1',icon:'≋'}
  ];
  registerPageLayout({pageId,title:'اختبار مساحة السجل',sections});
  const content=sections.map(item=>section(item.id,item.title,item.count??null,`<p>${item.id}</p>`,{pageId})).join('');
  const host=document.createElement('div');
  host.innerHTML=recordWorkspaceMarkup({pageId,pageTitle:'اختبار مساحة السجل',sections,primaryTabs:['data','files'],head:'<header></header>',content});
  const activated=[];
  bindRecordWorkspaceTabs({fail(error){throw error}},host,pageId,'اختبار مساحة السجل',sections,['data','files'],{onActivate:id=>activated.push(id)});
  await Promise.resolve();
  expect(host.querySelector('[data-record-workspace]').dataset.activeTab).toBe('data');
  expect(host.querySelector('[data-record-tab="data"]').getAttribute('aria-selected')).toBe('true');
  expect(host.querySelector('[data-record-section="files"]').hidden).toBe(true);
  host.querySelector('[data-record-tab="activity"]').click();
  await Promise.resolve();
  expect(host.querySelector('[data-record-workspace]').dataset.activeTab).toBe('activity');
  expect(host.querySelector('[data-record-section="activity"]').hidden).toBe(false);
  expect(host.querySelector('[data-record-tab="activity"]').getAttribute('aria-checked')).toBe('true');
  host.querySelector('[data-record-tab="files"]').click();
  await Promise.resolve();
  host.querySelector('[data-record-tab="files"]').click();
  await Promise.resolve();
  expect(activated.join('|')).toBe('data|activity|files');
 });
}
