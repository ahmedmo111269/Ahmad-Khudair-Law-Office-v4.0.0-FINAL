// أداة فحص صفحة الملف (قبل/بعد): تقلع المتصفح، تبني بيانات تجريبية معزولة في ملف
// IndexedDB خاص بالاختبار، تفتح صفحة الملف، وتلتقط لقطات + تفريغًا بنيويًا للأقسام.
// لا تلمس قاعدة بيانات المكتب الحقيقية عند المستخدم (ملف متصفح مؤقت يُحذف بعد التشغيل).
import {chromium} from 'playwright';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';

const repository=path.resolve(new URL('../../',import.meta.url).pathname);
const base=(process.env.FP_BASE_URL||'http://127.0.0.1:8080').replace(/\/$/,'');
const outDir=path.join(process.env.FP_OUT||path.join(repository,'.cache','file-page-probe'));
await fs.mkdir(outDir,{recursive:true});
const require=createRequire(import.meta.url);
const {default:slim,inflate}=await import('@sparticuz/chromium');
await inflate(path.resolve(path.dirname(require.resolve('@sparticuz/chromium')),'../bin/al2023.tar.br'));
process.env.LD_LIBRARY_PATH=path.join(process.env.TMPDIR||'/tmp','al2023','lib');
const browser=await chromium.launch({executablePath:await slim.executablePath(),headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const context=await browser.newContext({viewport:{width:Number(process.env.FP_W||1440),height:Number(process.env.FP_H||1000)},locale:'ar-EG',permissions:['clipboard-read','clipboard-write']});
const page=await context.newPage();
const errors=[];
page.on('pageerror',e=>errors.push('pageerror: '+e.message));
page.on('console',m=>{if(m.type()==='error')errors.push('console: '+m.text())});

await page.goto(`${base}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>window.__LAW_OFFICE_APP__?.office&&!window.__LAW_OFFICE_APP__.booting,null,{timeout:120000});
await page.waitForFunction(()=>document.querySelector('#main-content')?.children.length>0,null,{timeout:120000});

const suffix=String(Date.now()).slice(-12);
const fixture=await page.evaluate(async suffix=>{
 const app=window.__LAW_OFFICE_APP__;
 const CF=await import('/js/services/client-files.js');
 const {saveEntity}=await import('/js/services/entity-save.js');
 await CF.seedTaxonomy(app.office);
 const client=await app.office.saveClient({fullName:'محمد عبد الرحمن السيد',nationalId:'29'+suffix,phones:['010'+String(suffix).slice(0,8)]});
 const opponent=await app.office.saveClient({fullName:'شركة النيل للمقاولات',nationalId:'30'+suffix,phones:['02'+String(suffix).slice(0,8)]});
 const file=await CF.createLegalFileInClientFile(app.office,{clientId:client.id,categoryId:'civil',fileTypeId:'civil.lawsuit',title:'صحة توقيع — عقد بيع ابتدائي',openedAt:'2026-01-12',steps:[]});
 // أطراف إضافية (موكل ثانٍ + خصم ثانٍ) لاختبار تعدد الأطراف
 await saveEntity(app.office,'fileParties',{fileId:file.id,partyKind:'client',clientId:opponent.id,name:'شركة النيل للمقاولات',role:'خصم',roleGroup:'الخصوم',sequence:2});
 await saveEntity(app.office,'fileParties',{fileId:file.id,partyKind:'other',name:'ورثة المرحوم أحمد خليل',role:'مدعى عليهم',roleGroup:'أطراف أخرى',sequence:3});
 // المرحلة الأولى: دعوى ابتدائية
 const s1=await app.office.createCase({fileId:file.id,stageType:'دعوى',numberType:'رقم دعوى',caseNumber:'1234',caseYear:'2026',courtId:'محكمة بنها الابتدائية',chamber:'دائرة 3 مدني',degree:'أول درجة',subject:'صحة توقيع عقد بيع ابتدائي',requests:'الحكم بصحة التوقيع',filingDate:'2026-01-20',status:'متداولة',lifecycle:'active',stageOrder:1,clientCapacity:'مدعٍ',opponentCapacity:'مدعى عليه'},[]);
 const fileRow=await app.office.r.files.get(file.id);
 await app.office.saveFile({...fileRow,currentStageId:s1.id,responsibleLawyer:'أحمد محمد خضير',nextStep:'إيداع تقرير الخبير',nextStepDate:'2026-11-05'},file.id,fileRow.version);
 await saveEntity(app.office,'hearings',{fileId:file.id,caseId:s1.id,hearingDate:'2026-10-05',hearingTime:'09:30',court:'محكمة بنها الابتدائية',chamber:'دائرة 3',type:'مرافعة',result:'تأجيل لتقديم المستندات',adjournedTo:'2026-11-12',adjournReason:'استيفاء المستندات'});
 await saveEntity(app.office,'hearings',{fileId:file.id,caseId:s1.id,hearingDate:'2026-11-12',hearingTime:'10:00',court:'محكمة بنها الابتدائية',chamber:'دائرة 3',type:'مرافعة',reason:'إيداع تقرير الخبير'});
 await saveEntity(app.office,'judgments',{fileId:file.id,caseId:s1.id,judgmentDate:'2026-09-01',judgmentType:'حكم تمهيدي',operativeSummary:'ندب خبير هندسي لمعاينة التوقيعات',court:'محكمة بنها الابتدائية',stage:'دعوى'});
 await saveEntity(app.office,'procedures',{fileId:file.id,caseId:s1.id,type:'إعلان',description:'إعلان صحيفة الدعوى للمدعى عليه',internalDueDate:'2026-10-20',status:'open',priority:'high'});
 await saveEntity(app.office,'procedures',{fileId:file.id,type:'متابعة',description:'متابعة تقرير الخبير بمكتب الخبراء',internalDueDate:'2026-10-11',status:'pending'});
 await saveEntity(app.office,'procedures',{fileId:file.id,type:'شهادة',description:'استخراج شهادة من الجدول',actionDate:'2026-08-14',status:'done',result:'تم الاستخراج'});
 await saveEntity(app.office,'serviceRecords',{fileId:file.id,caseId:s1.id,actionType:'إعلان',serviceDate:'2026-10-02',status:'تم الإعلان',notes:'سلم لشخصه'});
 await saveEntity(app.office,'fees',{fileId:file.id,agreedAmount:5000,agreementType:'مقطوع',paymentStatus:'partial',currency:'جنيه'});
 await saveEntity(app.office,'documentReferences',{fileId:file.id,type:'عقد',title:'عقد البيع الابتدائي',date:'2025-12-01'});
 await saveEntity(app.office,'communications',{fileId:file.id,date:'2026-10-01',channel:'هاتف',direction:'outgoing',contactName:'محمد عبد الرحمن',subject:'متابعة الجلسة'});
 await saveEntity(app.office,'appointments',{fileId:file.id,title:'موعد مع الخبير',date:'2026-10-25',time:'11:00',location:'مكتب الخبراء'});
 return {client,opponent,file,s1,suffix};
},suffix);

// ملف ثانٍ بلا أي رقم قضائي (ملف إداري) لاختبار الحالة الخاصة
const plain=await page.evaluate(async suffix=>{
 const app=window.__LAW_OFFICE_APP__;
 const CF=await import('/js/services/client-files.js');
 const client=await app.office.saveClient({fullName:'هدى إبراهيم منصور',nationalId:'31'+suffix,phones:['011'+String(suffix).slice(0,8)]});
 const tax=await CF.taxonomy(app.office);
 const cat=(tax.categories.find(c=>/إدار|other/i.test(c.id+c.name))||tax.categories[0]);
 const types=tax.typesOf(cat.id);
 const file=await CF.createLegalFileInClientFile(app.office,{clientId:client.id,categoryId:cat.id,fileTypeId:types[0]?.id||'',title:'استشارة قانونية — مراجعة عقد إيجار',openedAt:'2026-03-02',steps:[]});
 return {file,cat,types:types.map(t=>t.name)};
},suffix);

console.log(JSON.stringify({fixture,plain},null,1).slice(0,1600));

const dump=async(name,route)=>{
 await page.evaluate(r=>window.__LAW_OFFICE_APP__.go(r),route);
 await page.waitForTimeout(2200);
 await page.screenshot({path:path.join(outDir,`${name}-full.png`),fullPage:true});
 await page.screenshot({path:path.join(outDir,`${name}-top.png`)});
 const info=await page.evaluate(()=>{
  const t=s=>(document.querySelector(s)?.textContent||'').replace(/\s+/g,' ').trim();
  const tabs=[...document.querySelectorAll('.file-tabs-bar [data-tab]')].map(b=>({tab:b.dataset.tab,label:b.textContent.trim(),sel:b.getAttribute('aria-selected')||b.getAttribute('aria-checked'),inMenu:Boolean(b.closest('.ftb-menu')),hidden:b.hidden}));
  const groups=[...document.querySelectorAll('.ftb-group')].map(g=>({group:g.dataset.group,label:g.querySelector('.ftb-group-btn .tab-label')?.textContent?.trim(),active:g.classList.contains('is-active'),items:[...g.querySelectorAll('.ftb-item')].map(i=>i.dataset.tab)}));
  const areas=[...document.querySelectorAll('[data-area]')].map(b=>({area:b.dataset.area,label:b.textContent.trim(),sel:b.getAttribute('aria-selected')}));
  const panels=[...document.querySelectorAll('#main-content section.panel,#main-content .stage-path,#main-content .cp-fc,#main-content .cp-exec')].map(p=>({cls:p.className,collapse:p.dataset?.collapseId||'',collapsed:p.dataset?.collapseCollapsed||'',title:t('h3',p)?'':''}));
  const heads=[...document.querySelectorAll('#main-content h2,#main-content h3')].map(h=>h.textContent.replace(/\s+/g,' ').trim());
  return {route:window.__LAW_OFFICE_APP__.route,title:document.querySelector('#page-title')?.textContent,tabs,groups,areas,heads,panelsCount:panels.length,headText:t('.file-head'),tabText:t('#file-tab').slice(0,900)};
 });
 await fs.writeFile(path.join(outDir,`${name}.json`),JSON.stringify(info,null,1));
 console.log(`\n===== ${name} (${route}) =====`);
 console.log('HEAD:',info.headText.slice(0,600));
 console.log('TABS:',info.tabs.map(x=>`${x.tab}${x.sel==='true'?'*':''}${x.inMenu?'(قائمة)':''}`).join(' | '));
 console.log('GROUPS:',info.groups.map(g=>`${g.group}${g.active?'*':''}[${g.items.join(',')}]`).join(' | '));
 console.log('AREAS:',info.areas.map(x=>`${x.area}${x.sel==='true'?'*':''}`).join(' | '));
 console.log('H3s:',info.heads.join(' / '));
 console.log('TABTEXT:',info.tabText.slice(0,700));
};

await dump('01-case-file',`file:${fixture.file.id}`);
await dump('02-plain-file',`file:${plain.file.id}`);
await dump('03-hearings',`file:${fixture.file.id}`);
await page.locator('.file-tabs-bar [data-tab="hearings"]').first().click().catch(()=>{});
await page.waitForTimeout(1200);
await page.screenshot({path:path.join(outDir,'04-hearings-tab.png'),fullPage:true});
console.log('HEARINGS TAB TEXT:',(await page.evaluate(()=>document.querySelector('#file-tab')?.textContent.replace(/\s+/g,' ').trim().slice(0,500))));
await page.locator('[data-tab="procedures"]').first().click().catch(()=>{});
await page.waitForTimeout(1200);
await page.screenshot({path:path.join(outDir,'05-procedures-tab.png'),fullPage:true});
console.log('PROCEDURES TAB TEXT:',(await page.evaluate(()=>document.querySelector('#file-tab')?.textContent.replace(/\s+/g,' ').trim().slice(0,500))));
// بقية التبويبات: تفريغ سريع لكل تبويب للتأكد من وجود المحتوى
const allTabs=await page.evaluate(()=>[...document.querySelectorAll('.file-tabs-bar [data-tab]')].map(b=>b.dataset.tab));
const perTab={};
for(const tab of allTabs){
 await page.evaluate(t=>{const b=document.querySelector(`.file-tabs-bar [data-tab="${t}"]`);b&&b.click()},tab);
 await page.waitForTimeout(900);
 perTab[tab]=await page.evaluate(()=>{const el=document.querySelector('#file-tab');return {len:(el?.textContent||'').trim().length,first:(el?.textContent||'').replace(/\s+/g,' ').trim().slice(0,220),grids:el?.querySelectorAll('.dg').length||0,panels:el?.querySelectorAll('section.panel').length||0}});
}
await fs.writeFile(path.join(outDir,'tabs-dump.json'),JSON.stringify(perTab,null,1));
console.log('\n===== per-tab =====');
for(const [k,v] of Object.entries(perTab))console.log(`${k.padEnd(16)} len=${String(v.len).padEnd(6)} grids=${v.grids} panels=${v.panels} :: ${v.first.slice(0,140)}`);

console.log('\nERRORS('+errors.length+'):',errors.slice(0,20).join('\n'));
await browser.close();
