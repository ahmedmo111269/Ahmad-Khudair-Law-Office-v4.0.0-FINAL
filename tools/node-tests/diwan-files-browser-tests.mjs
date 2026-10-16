// Browser gate for the file workspace: no storage writes or record mutations.
// Start tools/static-preview-server.mjs, then set DIWAN_MODULE_DIR to test deps.
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const dir=process.env.DIWAN_MODULE_DIR;
const load=async(name,file)=>dir?import(pathToFileURL(join(resolve(dir),name,file)).href):import(name);
const {chromium}=await load('playwright','index.mjs');
const slimModule=await load('@sparticuz/chromium','build/index.js');
if(dir){await slimModule.inflate(join(resolve(dir),'@sparticuz/chromium/bin/al2023.tar.br'));process.env.LD_LIBRARY_PATH=join(process.env.TMPDIR||'/tmp','al2023/lib')}
const browser=await chromium.launch({executablePath:await slimModule.default.executablePath(),args:['--no-sandbox','--disable-dev-shm-usage']});
const base=process.env.DIWAN_BASE_URL||'http://127.0.0.1:8080';
let failures=0;
for(const width of [360,768,1024,1280])for(const theme of ['luxuryGold','elegantLight']){
 const page=await browser.newPage({viewport:{width,height:width===360?780:660}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/index.html');
 await page.waitForFunction(()=>window.__LAW_OFFICE_APP__?.office&&!window.__LAW_OFFICE_APP__.booting);
 await page.evaluate(async preset=>{
  const mod=await import('./js/ui/theme.js');mod.applyTheme({...mod.getConfig(),preset,colors:{},followSystem:false});
  await window.__LAW_OFFICE_APP__.go('files');
 },theme);
 await page.locator('.dg-table tbody tr[data-i]').first().waitFor();
 const snapshot=await page.evaluate(()=>{
  const row=document.querySelector('.dg-table tbody tr[data-i]');
  return {height:Math.round(row.getBoundingClientRect().height),first:Math.round(row.getBoundingClientRect().top),
   overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth};
 });
 let details=false,selection=false,navigation=false;
 if(width===1024){
  const info=page.locator('.dg-table tbody tr[data-i] .dg-cell-more').first();
  await info.click();details=await page.locator('.dg-pop .dg-cell-details').count()===1;
  await page.keyboard.press('Escape');
  await page.locator('.dg-table tbody tr[data-i] .dg-rowchk').first().check();
  selection=await page.locator('.dg-table tbody tr[data-i] .dg-rowchk').first().isChecked();
  await page.locator('.dg-table tbody tr[data-i] td[data-k="title"]').first().click();
  navigation=(await page.evaluate(()=>window.__LAW_OFFICE_APP__.route)).startsWith('file:');
 }
 const ok=snapshot.overflow===0&&!errors.length&&(width<761||snapshot.height===44)&&(width!==1024||details&&selection&&navigation);
 console.log(`${ok?'PASS':'FAIL'} files ${width} ${theme} ${JSON.stringify({snapshot,details,selection,navigation,errors})}`);
 if(!ok)failures++;
 await page.close();
}
await browser.close();
if(failures)process.exitCode=1;
