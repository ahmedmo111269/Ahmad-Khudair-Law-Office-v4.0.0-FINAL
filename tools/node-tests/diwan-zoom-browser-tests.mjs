// 200% browser zoom approximation: CSS zoom, not an OS-level accessibility audit.
import {chromium} from 'playwright';import slim,{inflate} from '@sparticuz/chromium';
import {createRequire} from 'node:module';import {dirname,resolve} from 'node:path';
const require=createRequire(import.meta.url);await inflate(resolve(dirname(require.resolve('@sparticuz/chromium')),'../bin/al2023.tar.br'));process.env.LD_LIBRARY_PATH=(process.env.TMPDIR||'/tmp')+'/al2023/lib';
const browser=await chromium.launch({executablePath:await slim.executablePath(),args:['--no-sandbox']});
for(const width of [360,768,1024]){
 const page=await browser.newPage({viewport:{width,height:780}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));await page.goto((process.env.DIWAN_BASE_URL||'http://127.0.0.1:8080')+'/index.html');
 await page.waitForFunction(()=>window.__LAW_OFFICE_APP__?.office&&!window.__LAW_OFFICE_APP__.booting);
 for(const route of ['files','clients']){
  await page.evaluate(r=>window.__LAW_OFFICE_APP__.go(r),route);
  await page.locator('.dg-table tbody tr[data-i]').first().waitFor();
  await page.evaluate(()=>document.documentElement.style.zoom='2');
  const measure=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth,body:document.body.scrollWidth,viewport:innerWidth}));
  console.log(width,route,measure,errors);
  await page.evaluate(()=>document.documentElement.style.zoom='');
 }
 await page.close();
}
await browser.close();
