// Release audit: run with `node tools/release-audit.mjs` from the repository root.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

const root=process.cwd();
const failures=[]; const warnings=[]; const reviews=[];
const required=['index.html','tests.html','manifest.webmanifest','sw.js','js/app.js','js/core/constants.js','js/db/schema.js','js/db/repository.js','js/db/database-registry.js','js/db/database-manager.js','js/services/backup.js'];
for(const f of required) if(!fs.existsSync(path.join(root,f))) failures.push(`MISSING ${f}`);

const files=[];
function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){if(['.git','node_modules','.cache'].includes(e.name))continue;const p=path.join(d,e.name);if(e.isDirectory())walk(p);else files.push(p)}}
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
// ملاحظة: تُقرأ الشيفرة بعد إزالة التعليقات، وإلا فكلمة "import" داخل تعليق
// تُفسَّر خطأً كسطر استيراد (كان يسبب فشلًا وهميًا في js/domain/execution-calendar.js).
function stripComments(source){
  let out='';let i=0;let state=null;
  while(i<source.length){
    const c=source[i],n=source[i+1];
    if(state===null){
      if(c==='/'&&n==='/'){state='line';i+=2;continue}
      if(c==='/'&&n==='*'){state='block';i+=2;continue}
      if(c==='\"'||c==="'"||c==='`')state=c;
      out+=c;i++;continue;
    }
    if(state==='line'){if(c==='\n'){state=null;out+='\n'}i++;continue}
    if(state==='block'){if(c==='*'&&n==='/'){state=null;i+=2;continue}if(c==='\n')out+='\n';i++;continue}
    if(c==='\\'){out+=c+(n??'');i+=2;continue}
    if(c===state)state=null;
    out+=c;i++;continue;
  }
  return out;
}
const exportsOf=new Map();
let importsChecked=0;
function collectExports(file){
  if(exportsOf.has(file))return exportsOf.get(file);
  const s=stripComments(fs.readFileSync(file,'utf8'));const set=new Set();
  for(const m of s.matchAll(/export\s+(?:async\s+)?(?:const|let|var|function\*?|class)\s+([\w$]+)/g))set.add(m[1]);
  for(const m of s.matchAll(/export\s*\{([^}]*)\}/g))m[1].split(',').map(x=>x.trim()).filter(Boolean).forEach(x=>{const a=x.split(/\s+as\s+/);set.add((a[1]||a[0]).trim())});
  if(/export\s+default/.test(s))set.add('default');
  exportsOf.set(file,set);return set;
}
function checkImports(file,rawSource){
  const source=stripComments(rawSource);
  for(const m of source.matchAll(/(?:^[ \t]*|[;}])\s*import\s+([^'";]*?)\s*from\s*['"](\.\.?\/[^'"]+)['"]/gm)){
    importsChecked++;
    let target=path.resolve(path.dirname(file),m[2]);if(!path.extname(target))target+='.js';
    if(!fs.existsSync(target)){failures.push(`IMPORT ${rel(file)} -> ${m[2]}`);continue}
    const names=[];const clause=m[1];const braces=clause.match(/\{([^}]*)\}/);
    if(braces)braces[1].split(',').map(x=>x.trim()).filter(Boolean).forEach(x=>names.push(x.split(/\s+as\s+/)[0].trim()));
    const rest=clause.replace(/\{[^}]*\}/,'').replace(/\*\s+as\s+[\w$]+/,'').replace(/,/g,'').trim();
    if(rest)names.push('default');
    const ex=collectExports(target);
    for(const n of names)if(!ex.has(n))failures.push(`EXPORT ${rel(file)} imports "${n}" but ${rel(target)} does not export it`);
  }
  // استيراد بلا "from" (تحميل جانبي): يجب أن يكون الملف موجودًا
  for(const m of source.matchAll(/(?:^[ \t]*|[;}])\s*import\s*['"](\.\.?\/[^'"]+)['"]/gm)){
    importsChecked++;
    let target=path.resolve(path.dirname(file),m[1]);if(!path.extname(target))target+='.js';
    if(!fs.existsSync(target))failures.push(`SIDE-EFFECT IMPORT ${rel(file)} -> ${m[1]}`);
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
const reloadPattern=/location\.reload\s*\(/g;
const reloadCount=[...text.matchAll(reloadPattern)].length;
if(reloadCount){
  const appSource=fs.readFileSync(path.join(root,'js/app.js'),'utf8');
  const updateSource=fs.existsSync(path.join(root,'js/services/pwa-updates.js'))?fs.readFileSync(path.join(root,'js/services/pwa-updates.js'),'utf8'):'';
  const explicitPwaUpdateReload=reloadCount===1
    && /reloadForUpdate\s*\(\s*\)\s*\{\s*try\s*\{\s*location\.reload\s*\(\s*\)\s*\}/.test(appSource)
    && /apply\s*:\s*\(\s*\)\s*=>\s*this\.reloadForUpdate\s*\(\s*\)/.test(appSource)
    && /action\s*:\s*\(\s*\)\s*=>\s*this\.accept\(\)\s*,\s*actionLabel\s*:\s*'تحديث الآن'/.test(updateSource)
    && /accept\s*\(\s*\)[\s\S]*?if\s*\(!waiting\)\s*return\s*false[\s\S]*?postMessage\(\{type:\s*'SKIP_WAITING'\}\)[\s\S]*?setTimeout\(reload,\s*350\)/.test(updateSource);
  if(explicitPwaUpdateReload) reviews.push('REVIEWED location.reload: الوحيد في المصدر، مرتبط بقبول زر تحديث PWA، ولا يعمل بلا عامل ينتظر');
  else warnings.push('REVIEW location.reload: verify reload is only user-confirmed and data-safe');
}
if(/location\.href\s*=/.test(text)) warnings.push('REVIEW location.href assignment');
const officeListCallsites=files.filter(f=>f.endsWith('.js')&&!f.endsWith(path.join('services','office.js'))).filter(f=>/\boffice\.list\s*\(/.test(fs.readFileSync(f,'utf8')));
if(officeListCallsites.length) warnings.push(`REVIEW office.list callsites: ${officeListCallsites.map(rel).join(', ')}`);

// 4) Version consistency: APP_VERSION must have a matching release heading in CHANGELOG.
// UI milestones and the Service Worker cache have independent version clocks; later
// changelog headings may leave APP_VERSION unchanged, so comparing only the newest
// heading produces a false failure.
const c=fs.readFileSync(path.join(root,'js/core/constants.js'),'utf8');
const vm=c.match(/APP_VERSION=['"]([^'"]+)/)?.[1];
const changelog=fs.existsSync(path.join(root,'CHANGELOG.md'))?fs.readFileSync(path.join(root,'CHANGELOG.md'),'utf8'):'';
const changelogVersions=[...changelog.matchAll(/^#+\s*v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?=\s|$)/gm)].map(match=>match[1]);
if(!vm)failures.push('VERSION APP_VERSION not found in js/core/constants.js');
else if(!changelogVersions.includes(vm))failures.push(`VERSION APP_VERSION=${vm} has no matching CHANGELOG heading`);

const result={timestamp:new Date().toISOString(),version:vm,files:files.length,javascript:js.length,relativeImportsChecked:importsChecked,failures,warnings,reviews,status:failures.length?'FAIL':'PASS'};
fs.writeFileSync(path.join(root,'docs/RELEASE-AUDIT.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
if(failures.length)process.exit(1);
