// Lightweight static contrast gate for explicitly declared solid theme tokens.
// Not a replacement for computed-style/alpha/color-mix/gradient browser auditing.
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../css/themes.css',import.meta.url),'utf8');
const blocks=[['luxuryGold',source.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1]],['elegantLight',source.match(/:root\[data-theme="elegantLight"\]\s*\{([\s\S]*?)\}/)?.[1]],['diwan',source.match(/:root\[data-theme="diwan"\]\s*\{([\s\S]*?)\}/)?.[1]]];
const channels=hex=>{
 const value=hex.slice(1);
 const pairs=value.length===3?[...value].map(c=>c+c):value.match(/../g);
 return pairs.map(pair=>{const c=parseInt(pair,16)/255;return c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4});
};
const luminance=hex=>channels(hex).reduce((n,c,i)=>n+c*[0.2126,0.7152,0.0722][i],0);
const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05)};
let failures=0;
for(const [theme,block] of blocks){
 if(!block){console.error(`BLOCKED: ${theme} token block not found`);failures++;continue}
 const vars=Object.fromEntries([...block.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)].map(([,key,val])=>[key,val]));
 // Only known solid-text-on-solid-surface pairs; gradients, translucent surfaces
 // and border/icon contrast need browser checks, and must not be reported as passing.
 for(const [fg,bg] of [...[['--text','--bg'],['--text-muted','--surface'],['--primary','--bg'],['--on-primary','--primary']],...(theme==='diwan'?[['--on-primary','--primary-2']]:[])]){
  if(!vars[fg]||!vars[bg]){console.error(`BLOCKED: ${theme} ${fg}/${bg} is not a literal six-digit hex pair`);failures++;continue}
  const value=contrast(vars[fg],vars[bg]);const pass=value>=4.5;
  console.log(`${pass?'PASS':'FAIL'} ${theme} ${fg}/${bg} ${value.toFixed(2)}:1 (normal text ≥4.5)`);
  if(!pass)failures++;
 }
}
console.log('NOT TESTED: computed colors, borders, status badges, gradients, other presets and custom themes');
if(failures)process.exitCode=1;
