// Throwaway profile; verifies that reading mode preserves customization access.
// Start tools/static-preview-server.mjs, then run with Playwright + @sparticuz/chromium installed for testing.
import {chromium} from 'playwright';
import slim,{inflate} from '@sparticuz/chromium';
import {createRequire} from 'node:module';
import {dirname,resolve} from 'node:path';
const require=createRequire(import.meta.url);
await inflate(resolve(dirname(require.resolve('@sparticuz/chromium')),'../bin/al2023.tar.br'));
process.env.LD_LIBRARY_PATH=(process.env.TMPDIR||'/tmp')+'/al2023/lib';
const browser=await chromium.launch({executablePath:await slim.executablePath(),args:['--no-sandbox','--disable-dev-shm-usage']});
let failed=0;
for(const width of [360,1024])for(const theme of ['luxuryGold','elegantLight']){
 const page=await browser.newPage({viewport:{width,height:width===360?780:660}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto((process.env.DIWAN_BASE_URL||'http://127.0.0.1:8080')+'/index.html');
 await page.waitForFunction(()=>window.__LAW_OFFICE_APP__?.office&&!window.__LAW_OFFICE_APP__.booting);
 await page.evaluate(async preset=>{const m=await import('./js/ui/theme.js');m.applyTheme({...m.getConfig(),preset,followSystem:false,colors:{}});await window.__LAW_OFFICE_APP__.go('clients')},theme);
 await page.locator('.dg-table tbody tr[data-i]').first().waitFor();
 const visible=()=>page.evaluate(()=>({gears:[...document.querySelectorAll('#main-content .uxc-gear')].filter(x=>x.getBoundingClientRect().width>0).length,pins:[...document.querySelectorAll('#main-content .collapse-pin')].filter(x=>x.getBoundingClientRect().width>0).length,overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth}));
 const reading=await visible();
 await page.locator('[data-customize-page]').click();
 await page.locator('[data-pl-edit-controls]').click();
 const editing=await visible();
 await page.locator('[data-pl-done]').click();
 await page.locator('#list-grid .uxc-gear').click();
 const modal=await page.locator('#modal-root .modal-card').count();
 await page.evaluate(async()=>{(await import('./js/ui/modal.js')).closeModal()});
 await page.locator('[data-customize-page]').click();
 await page.locator('[data-pl-edit-controls]').click();
 await page.locator('[data-pl-done]').click();
 const returned=await visible();
 await page.locator('[data-customize-page]').click();await page.locator('[data-pl-edit-controls]').click();await page.locator('[data-pl-done]').click();
 await page.evaluate(()=>window.__LAW_OFFICE_APP__.go('files'));
 await page.locator('.dg-table tbody tr[data-i]').first().waitFor();
 const routeReset=await page.evaluate(()=>!document.querySelector('#main-content').classList.contains('layout-customizing'));
 const ok=reading.gears===0&&reading.pins===0&&editing.gears>0&&returned.gears===0&&modal===1&&routeReset&&!reading.overflow&&!editing.overflow&&!errors.length;
 console.log(`${ok?'PASS':'FAIL'} mode ${width} ${theme}`,{reading,editing,returned,modal,routeReset,errors});
 if(!ok)failed++;
 await page.close();
}
await browser.close();if(failed)process.exitCode=1;
