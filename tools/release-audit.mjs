// Release audit: run with `node tools/release-audit.mjs` from the repository root.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

const root=process.cwd();
const failures=[]; const warnings=[];
const required=['index.html','tests.html','manifest.webmanifest','sw.js','js/app.js','js/core/constants.js','js/db/schema.js','js/db/repository.js','js/db/database-registry.js','js/db/database-manager.js','js/services/backup.js'];
for(const f of required) if(!fs.existsSync(path.join(root,f))) failures.push(`MISSING ${f}`);

const files=[];
function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){if(['.git','node_modules'].includes(e.name))continue;const p=path.join(d,e.name);if(e.isDirectory())walk(p);else files.push(p)}}
walk(root);
const js=files.filter(f=>f.endsWith('.js')||f.endsWith('.mjs'));
const rel=f=>path.relative(root,f);

// 1) Syntax. Browser files under js/ are ES modules; `node --check file.js` would parse them as CommonJS
//    (no package.json "type":"module") and can miss module-only syntax errors, so check a .mjs copy.
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'release-audit-'));
for(const f of js){
  const isModule=f.endsWith('.mjs')||rel(f).startsWith('js'+path.sep);
  const target=isModule&&!f.endsWith('.mjs')?path.join(tmp,path.basename(f,'.js')+'.mjs'):f;
  if(target!==f)fs.copyFileSync(f,target);
  try{execFileSync(process.execPath,['--check',target],{stdio:'pipe'})}
  catch(e){failures.push(`SYNTAX ${rel(f)}\n${(e.stderr?.toString()||e.message).replaceAll(target,rel(f))}`)}
}
fs.rmSync(tmp,{recursive:true,force:true});

// 2) Relative imports must exist and every named import must be exported by the target module.
const exportsOf=new Map();
function collectExports(file){
  if(exportsOf.has(file))return exportsOf.get(file);
  const s=fs.readFileSync(file,'utf8');const set=new Set();
  for(const m of s.matchAll(/export\s+(?:async\s+)?(?:const|let|var|function\*?|class)\s+([\w$]+)/g))set.add(m[1]);
  for(const m of s.matchAll(/export\s*\{([^}]*)\}/g))m[1].split(',').map(x=>x.trim()).filter(Boolean).forEach(x=>{const a=x.split(/\s+as\s+/);set.add((a[1]||a[0]).trim())});
  if(/export\s+default/.test(s))set.add('default');
  exportsOf.set(file,set);return set;
}
function checkImports(file,source){
  for(const m of source.matchAll(/import\s*([^'";]*?)\s*from\s*['"](\.\.?\/[^'"]+)['"]/g)){
    let target=path.resolve(path.dirname(file),m[2]);if(!path.extname(target))target+='.js';
    if(!fs.existsSync(target)){failures.push(`IMPORT ${rel(file)} -> ${m[2]}`);continue}
    const names=[];const clause=m[1];const braces=clause.match(/\{([^}]*)\}/);
    if(braces)braces[1].split(',').map(x=>x.trim()).filter(Boolean).forEach(x=>names.push(x.split(/\s+as\s+/)[0].trim()));
    const rest=clause.replace(/\{[^}]*\}/,'').replace(/\*\s+as\s+[\w$]+/,'').replace(/,/g,'').trim();
    if(rest)names.push('default');
    const ex=collectExports(target);
    for(const n of names)if(!ex.has(n))failures.push(`EXPORT ${rel(file)} imports "${n}" but ${rel(target)} does not export it`);
  }
  for(const m of source.matchAll(/import\(\s*['"](\.\.?\/[^'"]+)['"]\s*\)/g)){const target=path.resolve(path.dirname(file),m[1]);if(!fs.existsSync(target))failures.push(`DYNAMIC-IMPORT ${rel(file)} -> ${m[1]}`)}
}
for(const f of files.filter(x=>x.endsWith('.js')))checkImports(f,fs.readFileSync(f,'utf8'));
for(const f of files.filter(x=>x.endsWith('.html'))){
  const s=fs.readFileSync(f,'utf8');
  for(const m of s.matchAll(/<script[^>]*type=["']module["'][^>]*>([\s\S]*?)<\/script>/g))checkImports(f,m[1]);
  for(const m of s.matchAll(/(?:src|href)=["'](\.\/[^"'#?]+)["']/g))if(!fs.existsSync(path.resolve(path.dirname(f),m[1])))failures.push(`ASSET ${rel(f)} -> ${m[1]}`);
  if(/\$\{[^}]*\}/.test(s.replace(/<script[\s\S]*?<\/script>/g,'')))warnings.push(`TEMPLATE-LITERAL text outside <script> in ${rel(f)}`);
}

// 3) Policy checks.
const text=files.filter(f=>/\.(js|html)$/.test(f)).map(f=>fs.readFileSync(f,'utf8')).join('\n');
for(const pat of [/location\.reload\s*\(/,/location\.href\s*=/]) if(pat.test(text)) warnings.push(`REVIEW ${pat}`);
const officeListCallsites=files.filter(f=>f.endsWith('.js')&&!f.endsWith(path.join('services','office.js'))).filter(f=>/\boffice\.list\s*\(/.test(fs.readFileSync(f,'utf8')));
if(officeListCallsites.length) warnings.push(`REVIEW office.list callsites: ${officeListCallsites.map(rel).join(', ')}`);

// 4) Version consistency: constants.js must match the newest CHANGELOG heading.
const c=fs.readFileSync(path.join(root,'js/core/constants.js'),'utf8');
const vm=c.match(/APP_VERSION=['"]([^'"]+)/)?.[1];
const changelog=fs.existsSync(path.join(root,'CHANGELOG.md'))?fs.readFileSync(path.join(root,'CHANGELOG.md'),'utf8'):'';
const cv=changelog.match(/^#+\s*v?(\d+\.\d+\.\d+[^\s—]*)/m)?.[1];
if(!vm)failures.push('VERSION APP_VERSION not found in js/core/constants.js');
else if(cv&&cv!==vm)failures.push(`VERSION constants=${vm} changelog=${cv}`);

const result={timestamp:new Date().toISOString(),version:vm,files:files.length,javascript:js.length,failures,warnings,status:failures.length?'FAIL':'PASS'};
fs.writeFileSync(path.join(root,'docs/RELEASE-AUDIT.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
if(failures.length)process.exit(1);
