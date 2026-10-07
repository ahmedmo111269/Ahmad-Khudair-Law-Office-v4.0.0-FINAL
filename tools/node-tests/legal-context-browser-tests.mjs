// End-to-end checks for contextual quick-add, record preview, and the duplicate-client acknowledgement flow.
import {chromium} from 'playwright';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const repository=path.resolve(new URL('../../',import.meta.url).pathname);
const base=(process.env.LEGAL_CONTEXT_BASE_URL||'http://127.0.0.1:8080').replace(/\/$/,'');
const artifactDir=path.join(repository,'.cache','legal-context-browser');
await fs.mkdir(artifactDir,{recursive:true});
const require=createRequire(import.meta.url);
const {default:slim,inflate}=await import('@sparticuz/chromium');
await inflate(path.resolve(path.dirname(require.resolve('@sparticuz/chromium')),'../bin/al2023.tar.br'));
process.env.LD_LIBRARY_PATH=path.join(process.env.TMPDIR||'/tmp','al2023','lib');
const browser=await chromium.launch({executablePath:await slim.executablePath(),headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const context=await browser.newContext({viewport:{width:412,height:915},deviceScaleFactor:2.625,isMobile:true,hasTouch:true});
const page=await context.newPage();
const report={date:new Date().toISOString(),browser:browser.version(),base,checks:[],errors:[]};
page.on('pageerror',error=>report.errors.push(error.message));
const verify=async(name,fn)=>{await fn();report.checks.push(name);console.log(`VERIFIED — ${name}`)};
const boot=async()=>{
 await page.goto(`${base}/index.html`,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__LAW_OFFICE_APP__?.office&&!window.__LAW_OFFICE_APP__.booting,null,{timeout:90000});
 await page.waitForFunction(()=>document.querySelector('#main-content')?.children.length>0,null,{timeout:90000});
};

try{
 await boot();
 const suffix=String(Date.now()).slice(-12);
 const fixture=await page.evaluate(async suffix=>{
  const app=window.__LAW_OFFICE_APP__,nationalId='29'+suffix;
  const client=await app.office.saveClient({fullName:`موكل اصطناعي لاختبار السياق ${suffix}`,nationalId});
  const file=await app.office.createFile({title:`ملف اصطناعي لاختبار السياق ${suffix}`,openedAt:'2026-10-07'},[client.id]);
  const stage=await app.office.createCase({fileId:file.id,subject:'مرحلة اختبارية',caseNumber:`T${suffix}`,caseYear:'2026'},[]);
  const fileRow=await app.office.r.files.get(file.id);
  await app.office.saveFile({...fileRow,currentStageId:stage.id},file.id,fileRow.version);
  return {client,file,stage,nationalId};
 },suffix);
 report.fixture='Synthetic-only records in an ephemeral browser profile';

 await verify('إضافة من صفحة الموكل تختار الملف المرتبط بدل التخمين',async()=>{
  await page.evaluate(id=>window.__LAW_OFFICE_APP__.go(`client:${id}`),fixture.client.id);
  await page.waitForTimeout(700);
  await page.locator('#quick-add').click();
  const action=page.locator('.quick-context [data-qa-kind="procedure"]');
  await action.waitFor({state:'visible'});
  await action.click();
  const fileField=page.locator('.entity-form[data-store="procedures"] input[type="hidden"][name="fileId"]');
  await fileField.waitFor({state:'attached'});
  assert.equal(await fileField.inputValue(),fixture.file.id);
  assert.equal(await page.locator('.entity-form[data-store="procedures"] input[type="hidden"][name="caseId"]').inputValue(),fixture.stage.id);
  await page.locator('#modal-root .modal-card [data-close]').first().click();
 });

 await verify('إضافة جلسة من الملف ترث المرحلة الحالية في نموذج الحفظ القائم',async()=>{
  await page.evaluate(id=>window.__LAW_OFFICE_APP__.go(`file:${id}`),fixture.file.id);
  await page.waitForTimeout(700);
  await page.locator('#quick-add').click();
  await page.locator('.quick-context [data-qa-kind="hearing"]').click();
  const caseField=page.locator('.entity-form[data-store="hearings"] input[type="hidden"][name="caseId"]');
  await caseField.waitFor({state:'attached'});
  assert.equal(await caseField.inputValue(),fixture.stage.id);
  await page.locator('#modal-root .modal-card [data-close]').first().click();
 });

 await verify('لوحة الأوامر تقترح الإضافة المرتبطة بالملف الحالي',async()=>{
  await page.keyboard.press('Control+k');
  await page.locator('.pal-q').waitFor({state:'visible'});
  await page.locator('.pal-q').fill('جلسة في الملف');
  await page.waitForFunction(()=>[...document.querySelectorAll('.pal-item')].some(item=>item.textContent.includes('جلسة في الملف')));
  await page.keyboard.press('Escape');
 });

 await verify('معاينة السجل تفتح من قائمة إجراءات DataGrid وتخفي بيانات الاتصال والهوية',async()=>{
  await page.evaluate(()=>window.__LAW_OFFICE_APP__.go('clients'));
  const filterToggle=page.locator('.list-filter-panel .collapse-toggle');
  if(await filterToggle.getAttribute('aria-expanded')==='false')await filterToggle.click();
  await page.locator('#list-q').fill(fixture.client.fullName);
  const row=page.locator('.dg tbody tr[data-i]').filter({hasText:fixture.client.fullName}).first();
  await row.waitFor({state:'visible'});
  await row.locator('.dg-qa-btn').click();
  await page.locator('.dg-ctx [data-act="preview"]').click();
  const preview=page.locator('.record-preview-card');await preview.waitFor({state:'visible'});
  const text=await preview.textContent();
  assert.ok(text.includes(fixture.client.fullName));
  assert.equal(text.includes(fixture.nationalId),false);
  assert.equal(text.includes('الرقم القومي'),false);
  assert.ok(await preview.locator('[data-preview-open]').count());
  await preview.locator('[data-close]').first().click();
 });

 await verify('معاينة السجل تلتزم بمتغيرات الثيم في الفاتح والداكن',async()=>{
  const openPreview=async()=>{
   const row=page.locator('.dg tbody tr[data-i]').filter({hasText:fixture.client.fullName}).first();
   await row.locator('.dg-qa-btn').click();await page.locator('.dg-ctx [data-act="preview"]').click();
   const preview=page.locator('.record-preview-card');await preview.waitFor({state:'visible'});return preview;
  };
  const darkPreview=await openPreview();
  const dark=await darkPreview.locator('.rp-fields>div').first().evaluate(element=>getComputedStyle(element).backgroundColor);
  await darkPreview.locator('[data-close]').first().click();
  await page.locator('#theme-btn').click();await page.locator('.theme-menu [data-preset="elegantLight"]').click();
  const lightPreview=await openPreview();
  const light=await lightPreview.locator('.rp-fields>div').first().evaluate(element=>getComputedStyle(element).backgroundColor);
  assert.notEqual(light,dark,`light=${light}; dark=${dark}`);
  assert.equal(await page.locator('html').getAttribute('data-theme'),'elegantLight');
  await lightPreview.locator('[data-close]').first().click();
  await page.locator('#theme-btn').click();await page.locator('.theme-menu [data-preset="luxuryGold"]').click();
 });

 await verify('نموذج الموكل يحجب الحفظ عند رقم قومي مطابق حتى إقرار المتابعة صراحةً',async()=>{ 
  const before=await page.evaluate(()=>window.__LAW_OFFICE_APP__.office.r.clients.count());
  await page.locator('[data-list-add]').click();
  await page.locator('.entity-form[data-store="clients"] [name="fullName"]').fill(`موكل مستقل بإقرار اختبار ${suffix}`);
  await page.locator('.entity-form[data-store="clients"] [name="nationalId"]').fill(fixture.nationalId);
  const warning=page.locator('.client-duplicate-warning');await warning.waitFor({state:'visible'});
  assert.ok((await warning.textContent()).includes('رقم قومي مطابق'));
  await page.locator('.entity-form[data-store="clients"] [type="submit"]').click();
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(()=>window.__LAW_OFFICE_APP__.office.r.clients.count()),before);
  await page.locator('[data-client-duplicate-continue]').click();
  await page.locator('.entity-form[data-store="clients"]').waitFor({state:'detached',timeout:10000});
  assert.equal(await page.evaluate(()=>window.__LAW_OFFICE_APP__.office.r.clients.count()),before+1);
 });

 await verify('المتصفح لا يسجل استثناءات JavaScript في الرحلة الجديدة',async()=>assert.deepEqual(report.errors,[]));
 report.status='PASS';report.total=report.checks.length;
 await fs.writeFile(path.join(artifactDir,'report.json'),JSON.stringify(report,null,2)+'\n');
 console.log(`\n${report.total}/${report.total} legal-context browser checks verified — report: .cache/legal-context-browser/report.json`);
} catch(error){
 report.status='FAIL';report.failure=error?.stack||String(error);
 await fs.writeFile(path.join(artifactDir,'report.json'),JSON.stringify(report,null,2)+'\n');
 console.error('LEGAL CONTEXT BROWSER FAILURE',report.failure);
 process.exitCode=1;
} finally{
 await context.close().catch(()=>{});await browser.close().catch(()=>{});
}
