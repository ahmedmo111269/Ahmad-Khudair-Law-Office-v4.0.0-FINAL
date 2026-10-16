// Run against the local static preview server with a throwaway browser profile.
// npm dependencies are test-only, not application dependencies:
// DIWAN_MODULE_DIR=/path/to/test/node_modules node tools/node-tests/diwan-grid-browser-tests.mjs
import {pathToFileURL} from 'node:url';
import {resolve,join} from 'node:path';
const moduleDir=process.env.DIWAN_MODULE_DIR;
const load=async name=>moduleDir?import(pathToFileURL(join(resolve(moduleDir),name,name==='playwright'?'index.mjs':'build/index.js')).href):import(name);
const {chromium}=await load('playwright');
const slimModule=await load('@sparticuz/chromium');
const slim=slimModule.default;
if(moduleDir){
 await slimModule.inflate(join(resolve(moduleDir),'@sparticuz/chromium/bin/al2023.tar.br'));
 process.env.LD_LIBRARY_PATH=join(process.env.TMPDIR||'/tmp','al2023/lib');
}
const browser=await chromium.launch({executablePath:await slim.executablePath(),args:['--no-sandbox','--disable-dev-shm-usage']});
const base=process.env.DIWAN_BASE_URL||'http://127.0.0.1:8080';
let failures=0;
for(const width of [360,768,1024,1280]){
 const page=await browser.newPage({viewport:{width,height:width===360?780:660}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/index.html');
 await page.waitForFunction(()=>window.__LAW_OFFICE_APP__?.office&&!window.__LAW_OFFICE_APP__.booting);
 for(const preset of ['luxuryGold','elegantLight']){
  await page.evaluate(async name=>{
   const theme=await import('./js/ui/theme.js');
   theme.applyTheme({...theme.getConfig(),preset:name,followSystem:false,colors:{}});
   await window.__LAW_OFFICE_APP__.go('clients');
  },preset);
  await page.locator('.dg-table tbody tr').first().waitFor();
  const snapshot=await page.evaluate(()=>{
   const grid=document.querySelector('#list-grid'),first=grid.querySelector('.dg-table tbody tr');
   return {first:Math.round(first.getBoundingClientRect().top),gear:grid.querySelector('.uxc-gear')?.parentElement?.className,
    overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth};
  });
  await page.locator('.dg-tools-summary-toggle').click();
  const opened=await page.locator('.dg-tools-panel').isVisible();
  await page.locator('.dg-tools-summary-toggle').click();
  const closed=!(await page.locator('.dg-tools-panel').isVisible());
  const ok=snapshot.gear==='dg-shell-head'&&!snapshot.overflow&&opened&&closed&&!errors.length;
  console.log(`${ok?'PASS':'FAIL'} clients ${width} ${preset}: first=${snapshot.first}px gear=${snapshot.gear} tools=${opened}/${closed} pageErrors=${errors.length}`);
  if(!ok)failures++;
 }
 await page.close();
}
await browser.close();
if(failures)process.exitCode=1;
