// Run the project's complete tests.html suite in Chromium and fail on any test or module error.
import {chromium} from 'playwright';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';

const repository=path.resolve(new URL('../../',import.meta.url).pathname);
const base=(process.env.TESTS_HTML_BASE_URL||'http://127.0.0.1:8080').replace(/\/$/,'');
const artifactDir=path.join(repository,'.cache','tests-html-browser');
await fs.mkdir(artifactDir,{recursive:true});
const require=createRequire(import.meta.url);
const {default:slim,inflate}=await import('@sparticuz/chromium');
await inflate(path.resolve(path.dirname(require.resolve('@sparticuz/chromium')),'../bin/al2023.tar.br'));
process.env.LD_LIBRARY_PATH=path.join(process.env.TMPDIR||'/tmp','al2023','lib');
const browser=await chromium.launch({executablePath:await slim.executablePath(),headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
const page=await context.newPage();
const pageErrors=[];
page.on('pageerror',error=>pageErrors.push(error.message));
try{
 await page.goto(`${base}/tests.html`,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.querySelector('#out ol li')&&/\d+\/\d+/.test(document.querySelector('#out p')?.textContent||''),null,{timeout:180000});
 const result=await page.evaluate(()=>({
  summary:document.querySelector('#out p')?.textContent||'',
  total:document.querySelectorAll('#out ol li').length,
  failed:[...document.querySelectorAll('#out ol li.fail')].map(item=>item.textContent.trim())
 }));
 const report={date:new Date().toISOString(),browser:browser.version(),base,status:result.failed.length||pageErrors.length?'FAIL':'PASS',...result,pageErrors};
 await fs.writeFile(path.join(artifactDir,'report.json'),JSON.stringify(report,null,2)+'\n');
 if(report.status!=='PASS'){
  console.error(JSON.stringify(report,null,2));process.exitCode=1;
 }else console.log(`VERIFIED — tests.html Chromium suite: ${result.summary}; no browser module errors.`);
}finally{
 await context.close().catch(()=>{});await browser.close().catch(()=>{});
}
