// Reflow proxy for 200% zoom: a viewport with half the original CSS width.
// This is not a real browser zoom test; check clipping separately.
import {chromium} from 'playwright';
import slim,{inflate} from '@sparticuz/chromium';
import {createRequire} from 'node:module';
import {dirname,resolve} from 'node:path';
const require=createRequire(import.meta.url);
await inflate(resolve(dirname(require.resolve('@sparticuz/chromium')),'../bin/al2023.tar.br'));
process.env.LD_LIBRARY_PATH=(process.env.TMPDIR||'/tmp')+'/al2023/lib';
const browser=await chromium.launch({executablePath:await slim.executablePath(),args:['--no-sandbox']});
let failures=0;
for(const width of [180,384,512]){
 const page=await browser.newPage({viewport:{width,height:780},reducedMotion:'reduce'}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto((process.env.DIWAN_BASE_URL||'http://127.0.0.1:8080')+'/index.html');
 await page.waitForFunction(()=>window.__LAW_OFFICE_APP__?.office&&!window.__LAW_OFFICE_APP__.booting);
 for(const route of ['files','clients']){
  await page.evaluate(r=>window.__LAW_OFFICE_APP__.go(r),route);
  await page.locator('.dg-table tbody tr[data-i]').first().waitFor();
  const result=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth,body:document.body.scrollWidth,reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,themeTransition:getComputedStyle(document.documentElement).getPropertyValue('--transition').trim(),caretTransition:(()=>{const caret=document.querySelector('.collapse-caret');return caret?getComputedStyle(caret).transitionDuration:null})()}));
  const ok=!errors.length&&result.scroll<=result.client&&result.reduced&&result.themeTransition==='0s'&&(result.caretTransition===null||result.caretTransition==='0s');
  console.log(`${ok?'PASS':'FAIL'} reflow ${width} ${route}`,result,errors);
  if(!ok)failures++;
 }
 await page.close();
}
await browser.close();if(failures)process.exitCode=1;
