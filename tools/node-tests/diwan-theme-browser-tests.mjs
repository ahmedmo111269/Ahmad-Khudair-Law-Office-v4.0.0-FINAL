// Optional theme smoke test with a stored layout sentinel in a disposable profile.
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
 const context=await browser.newContext({viewport:{width,height:width===360?780:660}});
 await context.addInitScript(()=>localStorage.setItem('akl:prefs:ui:display-prefs',JSON.stringify({version:1,global:{card:{density:'roomy'},grid:{}},pages:{},cards:{'sentinel-old-card':{fontSize:'lg'}},componentContents:{}})));
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto((process.env.DIWAN_BASE_URL||'http://127.0.0.1:8080')+'/index.html');
 await page.waitForFunction(()=>window.__LAW_OFFICE_APP__?.office&&!window.__LAW_OFFICE_APP__.booting);
 const before=await page.evaluate(()=>({theme:document.documentElement.dataset.theme||'luxuryGold',layout:JSON.parse(localStorage.getItem('akl:prefs:ui:display-prefs')).cards['sentinel-old-card']}));
 if(width===360){
  // On mobile, the theme icon is hidden; the Settings preset panel starts collapsed.
  await page.evaluate(()=>window.__LAW_OFFICE_APP__.go('settings'));
  const panel=page.locator('#appearance-root .panel').filter({has:page.locator('[data-preset="diwan"]')});
  const toggle=panel.locator(':scope > .panel-collapse-head .card-collapse-toggle');
  await toggle.focus();await toggle.press('Enter');
  if(await toggle.getAttribute('aria-expanded')!=='true')throw Error('Theme panel did not expand from keyboard');
  const preset=panel.locator('[data-preset="diwan"]');
  await preset.focus();await preset.press('Enter');
 }else{
  await page.locator('#theme-btn').click();await page.locator('.theme-menu [data-preset="diwan"]').click();
 }
 await page.evaluate(()=>window.__LAW_OFFICE_APP__.go('clients'));await page.locator('.dg-table tbody tr[data-i]').first().waitFor();
 const after=await page.evaluate(()=>({theme:document.documentElement.dataset.theme,color:getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),layout:JSON.parse(localStorage.getItem('akl:prefs:ui:display-prefs')).cards['sentinel-old-card'],stored:JSON.parse(localStorage.getItem('akl:prefs:theme')).preset,overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth}));
 if(width===1024)await page.screenshot({path:'docs/design/after/clients-1024-diwan.png'});
 const ok=before.theme==='luxuryGold'&&after.theme==='diwan'&&after.stored==='diwan'&&after.color.toUpperCase()==='#F6F4EF'&&after.layout?.fontSize==='lg'&&!after.overflow&&!errors.length;
 console.log(`${ok?'PASS':'FAIL'} theme ${width}`,{before,after,errors});if(!ok)failures++;
 await context.close();
}
await browser.close();if(failures)process.exitCode=1;
