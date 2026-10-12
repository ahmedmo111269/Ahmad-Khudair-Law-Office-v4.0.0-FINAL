// End-to-end checks for client, opponent, and generic/case record workspaces.
// All records are synthetic and confined to this disposable Chromium profile.
import {chromium} from 'playwright';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const repository=path.resolve(new URL('../../',import.meta.url).pathname);
const base=(process.env.RECORD_WORKSPACE_BASE_URL||'http://127.0.0.1:8080').replace(/\/$/,'');
const artifactDir=path.join(repository,'.cache','record-workspace-browser');
await fs.mkdir(artifactDir,{recursive:true});
const require=createRequire(import.meta.url);
const {default:slim,inflate}=await import('@sparticuz/chromium');
await inflate(path.resolve(path.dirname(require.resolve('@sparticuz/chromium')),'../bin/al2023.tar.br'));
process.env.LD_LIBRARY_PATH=path.join(process.env.TMPDIR||'/tmp','al2023','lib');
const browser=await chromium.launch({executablePath:await slim.executablePath(),headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const context=await browser.newContext({viewport:{width:412,height:915},locale:'ar-EG',deviceScaleFactor:2});
const page=await context.newPage();
const report={date:new Date().toISOString(),browser:browser.version(),base,checks:[],errors:[]};
page.on('pageerror',error=>report.errors.push(error.message));
page.on('console',message=>{if(message.type()==='error'&&!/ERR_CONNECTION_CLOSED|service worker/i.test(message.text()))report.errors.push(message.text())});
const verify=async(name,fn)=>{await fn();report.checks.push(name);console.log(`VERIFIED — ${name}`)};
const go=async route=>{
 await page.evaluate(value=>window.__LAW_OFFICE_APP__.go(value),route);
 await page.waitForFunction(expected=>String(window.__LAW_OFFICE_APP__?.route||'').split('?')[0]===expected,route,{timeout:20000});
 await page.waitForSelector('#main-content .record-workspace',{timeout:20000});
};
const activate=async id=>{
 const tab=page.locator(`#main-content [data-record-tab="${id}"]`).first();
 if(await tab.getAttribute('role')==='menuitemradio'){
  await page.locator('#main-content [data-record-more-toggle]').click();
  await tab.waitFor({state:'visible'});
 }
 await tab.click();
 await page.waitForFunction(expected=>document.querySelector('#main-content [data-record-workspace]')?.dataset.activeTab===expected,id);
};

try{
 await page.goto(`${base}/index.html`,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__LAW_OFFICE_APP__?.office&&!window.__LAW_OFFICE_APP__.booting,null,{timeout:90000});
 await page.waitForFunction(()=>document.querySelector('#main-content')?.children.length>0,null,{timeout:90000});
 const fixture=await page.evaluate(async()=>{
  const app=window.__LAW_OFFICE_APP__,suffix=String(Date.now()).slice(-12);
  const client=await app.office.saveClient({fullName:`موكل فحص مساحة السجل ${suffix}`,nationalId:`29${suffix}`});
  const {saveEntity}=await import('/js/services/entity-save.js');
  const opponent=await saveEntity(app.office,'opponents',{name:`خصم فحص مساحة السجل ${suffix}`});
  const file=await app.office.createFile({title:`ملف فحص مساحة السجل ${suffix}`,openedAt:'2026-01-10'},[client.id]);
  const stage=await app.office.createCase({fileId:file.id,stageType:'دعوى',numberType:'رقم دعوى',subject:`قضية فحص مساحة السجل ${suffix}`,caseNumber:'123',caseYear:'2026'},[]);
  await saveEntity(app.office,'procedures',{fileId:file.id,caseId:stage.id,type:'متابعة',description:'إجراء تركيبي لفحص التحميل الكسول',status:'pending'});
  return {clientId:client.id,opponentId:opponent.id,stageId:stage.id,fileId:file.id};
 });
 report.fixture='Synthetic-only records in a disposable Chromium profile';

 await verify('سجل الموكل: بنية التبويبات وإمكانية الوصول وعرض الملفات عند فتح التبويب',async()=>{
  await go(`client:${fixture.clientId}`);
  const structure=await page.evaluate(()=>{
   const workspace=document.querySelector('#main-content [data-record-workspace]');
   const tabs=[...workspace.querySelectorAll('.record-primary-tabs [role="tab"]')];
   const panels=[...workspace.querySelectorAll('[data-record-tab-panel]')];
   return {primary:tabs.length,panels:panels.length,aria:panels.every(panel=>{
    const label=document.getElementById(panel.getAttribute('aria-labelledby'));
    return panel.getAttribute('role')==='tabpanel'&&Boolean(label)&&label.getAttribute('aria-controls')===panel.id;
   }),filesMounted:Boolean(workspace.querySelector('[data-grid="files"] .dg'))};
  });
  assert.equal(structure.primary,4);
  assert.ok(structure.panels>=7);
  assert.equal(structure.aria,true);
  assert.equal(structure.filesMounted,false,'unopened grids should stay unmounted');
  await activate('files');
  await page.waitForSelector('#main-content [data-record-section="files"] .dg',{state:'attached',timeout:15000});
  assert.ok(await page.locator('#main-content [data-record-section="files"] [data-add="files"]').count());
 });

 await verify('سجل الخصم: التبويبات الأربعة والتنقل بين القضايا والجلسات',async()=>{
  await go(`opponent:${fixture.opponentId}`);
  assert.equal(await page.locator('#main-content .record-primary-tabs [role="tab"]').count(),4);
  await activate('cases');
  assert.equal(await page.locator('#main-content [data-record-section="cases"]').getAttribute('aria-hidden'),'false');
  await activate('hearings');
  assert.equal(await page.locator('#main-content [data-record-section="hearings"]').getAttribute('aria-hidden'),'false');
  assert.ok(await page.locator('#main-content [data-rec-edit]').count());
  assert.ok(await page.locator('#main-content [data-rec-delete]').count());
 });

 await verify('القضية/المرحلة: بطاقة بيانات بارزة وشريط إجراءات مطوي وتخصيص الحقول',async()=>{
  await go(`case:${fixture.stageId}`);
  assert.equal(await page.locator('#main-content .record-primary-tabs [role="tab"]').count(),4);
  assert.ok(await page.locator('#main-content [data-record-section="case-timeline"] [data-case-timeline]').count());
  const actions=page.locator('#main-content [data-record-actions]');
  assert.equal(await actions.count(),1);
  assert.equal(await actions.getAttribute('open'),null,'الإجراءات مطوية افتراضيًا لتقليل المساحة');
  assert.ok((await actions.locator('summary').innerText()).includes('إجراءات'));
  assert.ok(await actions.locator('[data-open-ref^="files:"]').count());
  assert.ok(await actions.locator('[data-wc-linked-task]').count());
  assert.ok(await actions.locator('[data-rec-edit]').count());
  assert.ok(await actions.locator('[data-rec-delete]').count());
  assert.equal(await page.locator('#main-content [data-list-nav-id]').count(),0,'لا توجد أزرار السابق/التالي في صفحة السجل');
  const identity=page.locator('#main-content .record-case-identity');
  assert.equal(await identity.count(),1);
  const identityText=await identity.innerText();
  const identityHtml=await identity.evaluate(el=>el.outerHTML);
  for(const label of ['الموكل','الخصم','رقم القضية والسنة','نوع الدعوى / المرحلة','موضوع الدعوى'])assert.ok(identityText.includes(label),`case identity is missing «${label}»: ${identityText} | ${identityHtml}`);
  assert.ok((await identity.innerText()).includes('123'));
  assert.ok((await identity.innerText()).includes('2026'));
  await identity.locator('.uxc-gear').click();
  const customizer=page.locator('#modal-root .uxc-modal');
  await customizer.locator('[data-uxc-tab="content"]').click();
  const clientField=customizer.locator('[data-uxc-content-visible="case:clients"]');
  assert.equal(await clientField.isChecked(),true);
  await clientField.uncheck();
  assert.equal(await identity.locator('[data-display-item="case:clients"]').evaluate(el=>el.classList.contains('ux-content-hidden')),true);
  await clientField.check();
  await customizer.locator('[data-uxc-content-move="-1"][data-uxc-content-id="case:subject"]').click();
  assert.equal(await identity.locator('dl [data-display-item]').last().evaluate(el=>el.dataset.displayItem),'case:number-type');
  await customizer.locator('[data-uxc-tab="actions"]').click();
  await customizer.locator('[data-uxc-done]').click();
  assert.equal(await page.locator('#main-content [data-grid="procedures"] .dg').count(),0);
  await activate('procedures');
  await page.waitForSelector('#main-content [data-record-section="procedures"] .dg',{state:'attached',timeout:15000});
  assert.equal(await page.locator('#main-content [data-record-more-toggle]').getAttribute('aria-current'),'true');
 });

 await verify('صفحة الملف: إزالة السابق/التالي مع بقاء أدوات الملف',async()=>{
  const route=`file:${fixture.fileId}`;
  await page.evaluate(value=>window.__LAW_OFFICE_APP__.go(value),route);
  await page.waitForFunction(expected=>String(window.__LAW_OFFICE_APP__?.route||'').split('?')[0]===expected,route,{timeout:20000});
  await page.waitForSelector('#main-content #file-head',{timeout:20000});
  assert.equal(await page.locator('#main-content [data-list-nav-id]').count(),0);
  assert.equal(await page.locator('#main-content .list-nav').count(),0);
  assert.ok(await page.locator('#main-content [data-file-edit]').count());
  assert.ok(await page.locator('#main-content [data-file-quick]').count());
 });

 await verify('أدوات الطي الجماعية محفوظة وموجودة داخل أدوات شريط التبويبات',async()=>{
  await go(`case:${fixture.stageId}`);
  const bulk=page.locator('#main-content .record-tabs-bar .ftb-tools>.collapse-page-tools');
  await bulk.waitFor({state:'visible'});
  assert.equal(await page.locator('#main-content [data-record-workspace] > .collapse-page-tools').count(),0);
  await bulk.locator(':scope > summary').click();
  await bulk.locator('[data-collapse-bulk="closed"]').click();
  const allClosed=await page.locator('#main-content .record-workspace details.rec-section').evaluateAll(items=>items.length>0&&items.every(item=>!item.open));
  assert.equal(allClosed,true);
  await bulk.locator(':scope > summary').click();
  await bulk.locator('[data-collapse-bulk="open"]').click();
  const allOpen=await page.locator('#main-content .record-workspace details.rec-section').evaluateAll(items=>items.length>0&&items.every(item=>item.open));
  assert.equal(allOpen,true);
 });

 await verify('الهاتف وسطح المكتب: الشريط المتجاوب لا يسبب تمريرًا أفقيًا',async()=>{
  const measure=async width=>{
   await page.setViewportSize({width,height:915});
   await page.waitForTimeout(150);
   return page.evaluate(()=>{const bar=document.querySelector('.record-tabs-bar');return{viewport:innerWidth,document:document.documentElement.scrollWidth,barWidth:bar?.getBoundingClientRect().width,barClientWidth:bar?.clientWidth,barScrollWidth:bar?.scrollWidth,visibleTabs:[...document.querySelectorAll('.record-primary-tabs [role="tab"]')].filter(tab=>getComputedStyle(tab).display!=='none').length}});
  };
  for(const width of [360,412,1440]){
   const metrics=await measure(width);
   assert.ok(metrics.barWidth<=metrics.viewport+1&&metrics.barScrollWidth<=metrics.barClientWidth+1,`${width}px tab bar overflows: ${JSON.stringify(metrics)}`);
   assert.equal(metrics.visibleTabs,4);
  }
 });

 report.status=report.errors.length?'FAIL':'PASS';
 await fs.writeFile(path.join(artifactDir,'report.json'),JSON.stringify(report,null,2)+'\n');
 if(report.status!=='PASS'){
  console.error(JSON.stringify(report,null,2));process.exitCode=1;
 }else console.log(`PASS — record workspace browser checks: ${report.checks.length}; no page errors.`);
}finally{
 await context.close().catch(()=>{});await browser.close().catch(()=>{});
}
