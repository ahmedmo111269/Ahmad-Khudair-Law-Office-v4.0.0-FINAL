// T10 partial smoke: shared list chrome on related legal records; no record writes.
import {chromium} from 'playwright';
import slim,{inflate} from '@sparticuz/chromium';
import {createRequire} from 'node:module';
import {dirname,resolve} from 'node:path';
const require=createRequire(import.meta.url);
await inflate(resolve(dirname(require.resolve('@sparticuz/chromium')),'../bin/al2023.tar.br'));
process.env.LD_LIBRARY_PATH=(process.env.TMPDIR||'/tmp')+'/al2023/lib';
const browser=await chromium.launch({executablePath:await slim.executablePath(),args:['--no-sandbox']});
let failures=0;
for(const width of [360,1024]){
 const page=await browser.newPage({viewport:{width,height:width===360?780:660}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto((process.env.DIWAN_BASE_URL||'http://127.0.0.1:8080')+'/index.html');
 await page.waitForFunction(()=>window.__LAW_OFFICE_APP__?.office&&!window.__LAW_OFFICE_APP__.booting);
 for(const route of ['cases','hearings','procedures']){
  await page.evaluate(r=>window.__LAW_OFFICE_APP__.go(r),route);
  await page.locator('.dg-tools-summary-toggle').waitFor({state:'visible'});
  const tools=page.locator('.dg-tools-summary-toggle');
  await tools.click();const open=await page.locator('.dg-tools-panel').isVisible();
  await tools.click();const closed=!(await page.locator('.dg-tools-panel').isVisible());
  const state=await page.evaluate(()=>({route:window.__LAW_OFFICE_APP__.route,scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth,add:!!document.querySelector('[data-list-add]'),pageFilter:!!document.querySelector('.list-filter-panel'),grid:!!document.querySelector('.dg-table')}));
  const ok=state.route===route&&state.scroll<=state.client&&state.add&&state.pageFilter&&state.grid&&open&&closed&&!errors.length;
  if(ok)await page.screenshot({path:`docs/design/after/${route}-${width}-gold.png`});
  console.log(`${ok?'PASS':'FAIL'} related-list ${route} ${width}`,{state,open,closed,errors});
  if(!ok)failures++;
 }
 await page.close();
}
await browser.close();if(failures)process.exitCode=1;
