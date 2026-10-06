// يولّد أيقونات PWA (PNG) من شعار المشروع نفسه — بلا أي اعتماد خارجي:
// يُرسم الشعار بـ Chromium (Playwright) ويُلتقط بأحجام Android المطلوبة.
import {chromium} from 'playwright';
import {createRequire} from 'node:module';
import path from 'node:path';
import fs from 'node:fs/promises';

const require=createRequire(import.meta.url);
const repo=path.resolve(new URL('../../',import.meta.url).pathname);
const {default:slim,inflate}=await import('@sparticuz/chromium');
await inflate(path.resolve(path.dirname(require.resolve('@sparticuz/chromium')),'../bin/al2023.tar.br'));
process.env.LD_LIBRARY_PATH=path.join(process.env.TMPDIR||'/tmp','al2023','lib');
const browser=await chromium.launch({executablePath:await slim.executablePath(),headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});

const GLYPH=`<path d="M256 96v300M154 157h204M179 157l-66 122h132l-66-122Zm154 0-66 122h132l-66-122Z" fill="none" stroke="#d6b56d" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/><path d="M176 397h160" fill="none" stroke="#f3ead6" stroke-width="20" stroke-linecap="round"/><circle cx="256" cy="104" r="21" fill="#d6b56d"/>`;

const build=(size,{maskable})=>{
	const bleed=maskable;
	const scale=maskable?0.92:1;
	const bg=bleed?`<rect width="512" height="512" fill="#101827"/>`:`<rect width="512" height="512" rx="112" fill="#101827"/>`;
	const body=maskable
		? `<g transform="translate(256 256) scale(${scale}) translate(-256 -256)">${GLYPH}</g>`
		: GLYPH;
	return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:transparent}svg{display:block}</style></head><body><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}">${bg}${body}</svg></body></html>`;
};

const targets=[
	{file:'icons/icon-192.png',size:192,maskable:false},
	{file:'icons/icon-512.png',size:512,maskable:false},
	{file:'icons/maskable-192.png',size:192,maskable:true},
	{file:'icons/maskable-512.png',size:512,maskable:true},
	{file:'icons/apple-touch-icon.png',size:180,maskable:true}
];

const page=await browser.newPage({deviceScaleFactor:1});
const out=[];
for(const target of targets){
	await page.setViewportSize({width:target.size,height:target.size});
	await page.setContent(build(target.size,target),{waitUntil:'load'});
	const buffer=await page.locator('svg').screenshot({omitBackground:true,type:'png'});
	const file=path.join(repo,target.file);
	await fs.writeFile(file,buffer);
	out.push({file:target.file,bytes:buffer.length});
}
await browser.close();
console.log(JSON.stringify(out,null,1));
