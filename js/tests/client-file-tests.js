// اختبارات ملف الموكل (v12): الأكواد، المسارات المرنة، العلاقات، الترحيل غير المدمر. تعمل على قاعدة اختبار مؤقتة.
import {upgradeSchema} from '../db/schema.js';
import {Office} from '../services/office.js';
import {createLegalFile,saveParty} from '../services/legal-files.js';
import * as S from '../services/client-files.js';
import {PRESETS,LIGHT_PRESETS} from '../ui/theme.js';
import {mountGrid} from '../ui/datagrid.js';
import {localDate} from '../core/clock.js';

export async function runClientFileTests(test,expect){
 const name=`AhmadKhudairLawOfficeDB__test__cf__${Date.now()}`;
 const db=await new Promise((res,rej)=>{const r=indexedDB.open(name,12);r.onupgradeneeded=e=>upgradeSchema(r.result,e.target.transaction);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});
 const o=new Office({db,assert(){},token:'t',profile:{id:'test'}});
 const out={};
 try{
  await S.seedTaxonomy(o);
  const legacy=await o.saveClient({fullName:'موكل قديم'});
  const lf=await createLegalFile(o,{clientId:legacy.id,fileType:'أسرة',title:'ملف قديم'});
  const before=await o.r.files.get(lf.id);
  await S.migrateToClientFiles(o);
  const after=await o.r.files.get(lf.id),lc=await o.r.clients.get(legacy.id);
  out.migration={before,after,lc};
  const c=await o.saveClient({fullName:'أحمد محمد علي'});
  const tax=await S.taxonomy(o);const steps=t=>tax.templateFor(t)?.steps.map(x=>({...x}))||[];
  const mk=(cat,type,extra={})=>S.createLegalFileInClientFile(o,{clientId:c.id,categoryId:cat,fileTypeId:type,steps:extra.steps??steps(type),related:extra.related});
  const a=await mk('family','family.settlement');
  const originParty=await saveParty(o,{fileId:a.id,partyKind:'other',name:'طرف خارجي في الملف الأصلي',role:'مدعى عليه'});
  const b=await mk('family','family.lawsuit',{related:{fileId:a.id,relationCode:'ORIGINATED_FROM'}});
  const copiedParty=(await o.r.fileParties.byIndex('fileId',b.id,50)).find(p=>p.copiedFrom===originParty.id);
  out.relatedParty={origin:originParty,copied:copiedParty};
  const m=await mk('criminal','criminal.misdemeanor',{steps:[]});
  let st=(await o.r.cases.byIndex('fileId',b.id,50)).sort((x,y)=>x.stageOrder-y.stageOrder);
  out.firstLifecycle=st.map(s=>s.lifecycle);
  const extra=await S.addStage(o,b.id,{name:'إشكال في التنفيذ',makeCurrent:true});
  out.current=(await o.r.files.get(b.id)).currentStageId===extra.id;
  await S.setStageLifecycle(o,b.id,st[0].id,'skipped');
  out.skipped=(await o.r.cases.get(st[0].id)).lifecycle;
  out.cc=await o.r.clients.get(c.id);
  out.sum=await S.clientFileSummary(o,out.cc.clientFileId);
  out.rel=await o.r.fileRelations.byIndex('targetFileId',a.id,10);
  out.nums=[a,b,m].map(x=>x.fileNumber);out.mStages=(await o.r.cases.byIndex('fileId',m.id,10)).length;
  let blocked=false;try{await S.archiveClientFile(o,out.cc.clientFileId)}catch{blocked=true}out.blocked=blocked;
 }finally{db.close();try{indexedDB.deleteDatabase(name)}catch{}}
 const y=new Date().getFullYear();
 test('ملف الموكل: كود CL-YYYY-NNNNNN فريد',()=>{expect(/^CL-\d{4}-\d{6}$/.test(out.cc.clientCode)).toBe(true);expect(out.cc.clientCode!==out.migration.lc.clientCode).toBe(true)});
 test('الملف القانوني: رقم LF-YYYY-NNNNNN متسلسل',()=>{expect(out.nums.every(n=>n.startsWith(`LF-${y}-`))).toBe(true);expect(new Set(out.nums).size).toBe(3)});
 test('ملف الموكل يجمع كل الملفات بأقسامها',()=>{expect(out.sum.total).toBe(3);expect(out.sum.byCategory.get('family')).toBe(2);expect(out.sum.byCategory.get('criminal')).toBe(1)});
 test('المسار المقترح اختياري: ملف بلا مراحل مسموح',()=>expect(out.mStages).toBe(0));
 test('أول مرحلة جارية والباقي مخطط',()=>{expect(out.firstLifecycle[0]).toBe('active');expect(out.firstLifecycle.slice(1).every(x=>x==='planned')).toBe(true)});
 test('إضافة مرحلة غير متوقعة وجعلها الحالية',()=>expect(out.current).toBe(true));
 test('تخطي مرحلة دون حذفها',()=>expect(out.skipped).toBe('skipped'));
 test('علاقة نشأ عن مكتوبة',()=>expect(out.rel[0]?.relationCode).toBe('ORIGINATED_FROM'));
 test('الملف المرتبط مستقل ويرث روابط الأطراف بهويات جديدة',()=>{expect(Boolean(out.relatedParty.copied?.id)).toBe(true);expect(out.relatedParty.copied.id===out.relatedParty.origin.id).toBe(false);expect(out.relatedParty.copied.fileId===out.relatedParty.origin.fileId).toBe(false);expect(out.relatedParty.copied.copiedFrom).toBe(out.relatedParty.origin.id)});
 test('الترحيل إضافي: لا يغيّر الرقم أو النوع القديم',()=>{const {before,after}=out.migration;expect(after.fileNumber).toBe(before.fileNumber);expect(after.fileType).toBe(before.fileType);expect(after.categoryId).toBe('family');expect(after.clientFileId).toBe(out.migration.lc.clientFileId)});
 test('الثيمات: 9 أوضاع والفاتحة معرفة',()=>{expect(Object.keys(PRESETS).length>=9).toBe(true);expect(LIGHT_PRESETS.every(k=>PRESETS[k])).toBe(true)});
 test('الجدول: الإجماليات والتجميع والفلاتر والتصدير الآمن وتخصيص الأعمدة',()=>{const g=document.createElement('div');document.body.append(g);const grid=mountGrid(g,{rows:[{a:'x',n:5,t:'أ',d:localDate(),partyName:'اسم شخص سري'},{a:'y',n:7,t:'أ',d:'2000-01-01',partyName:'اسم آخر سري'},{a:'z',n:1,t:'ب',d:localDate(),partyName:'اسم ثالث سري'}],columns:[{key:'a',label:'A'},{key:'n',label:'N',type:'number'},{key:'t',label:'T'},{key:'d',label:'التاريخ',type:'date'},{key:'partyName',label:'اسم الطرف'}]});expect(g.querySelector('tfoot').textContent.includes('١٣')).toBe(true);const sel=g.querySelector('.dg-groupby');sel.value='t';sel.dispatchEvent(new Event('change'));g.querySelector('.dg-grouprow').click();expect(g.querySelectorAll('tbody tr[data-i]').length).toBe(1);g.querySelector('.dg-sort').click();expect(g.querySelector('.dg-chips').hidden).toBe(false);sel.value='';sel.dispatchEvent(new Event('change'));const dateFilter=g.querySelector('th[data-key="d"] .dg-fbtn');dateFilter.click();const pop=document.querySelector('.dg-pop');pop.querySelector('.dg-op').value='today';pop.querySelector('.dg-op').dispatchEvent(new Event('change',{bubbles:true}));pop.querySelector('.dg-apply').click();expect(g.querySelectorAll('tbody tr[data-i]').length).toBe(2);const font=g.querySelector('.dg-font');font.value='large';font.dispatchEvent(new Event('change',{bubbles:true}));expect(g.classList.contains('dg-font-large')).toBe(true);g.querySelector('.dg-filter-toggle').click();expect(g.classList.contains('dg-filter-open')).toBe(false);g.querySelector('th[data-key="a"] .dg-resizer').dispatchEvent(new document.defaultView.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));expect(parseFloat(g.querySelector('th[data-key="a"]').style.width)>0).toBe(true);expect(grid.docHtml().includes('اسم شخص سري')).toBe(false);g.remove()});
 test('لا أرشفة لملف موكل به ملفات نشطة',()=>expect(out.blocked).toBe(true));
}
