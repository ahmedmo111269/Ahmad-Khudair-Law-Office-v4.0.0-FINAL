import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const root=process.cwd();
const failures=[]; const warnings=[];
const required=['index.html','tests.html','manifest.webmanifest','sw.js','js/app.js','js/core/constants.js','js/db/schema.js','js/db/repository.js','js/db/database-registry.js','js/db/database-manager.js','js/services/backup.js'];
for(const f of required) if(!fs.existsSync(path.join(root,f))) failures.push(`MISSING ${f}`);
const files=[]; function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){if(['.git','node_modules'].includes(e.name))continue;const p=path.join(d,e.name);if(e.isDirectory())walk(p);else files.push(p)}} walk(root);
const js=files.filter(f=>f.endsWith('.js')||f.endsWith('.mjs'));
for(const f of js){try{execFileSync(process.execPath,['--check',f],{stdio:'pipe'});}catch(e){failures.push(`SYNTAX ${path.relative(root,f)}\n${e.stderr?.toString()||e.message}`)}}
const importRe=/from\s+['"](\.\.?\/[^'"]+)['"]/g;
for(const f of files.filter(x=>x.endsWith('.js'))){const s=fs.readFileSync(f,'utf8');let m;while((m=importRe.exec(s))){let p=path.resolve(path.dirname(f),m[1]);if(!path.extname(p))p+='.js';if(!fs.existsSync(p))failures.push(`IMPORT ${path.relative(root,f)} -> ${m[1]}`)}}
const text=files.filter(f=>/\.(js|html|css|md|json|webmanifest)$/.test(f)).map(f=>fs.readFileSync(f,'utf8')).join('\n');
for(const pat of [/window\.location\.reload\s*\(/,/location\.href\s*=/]) if(pat.test(text)) warnings.push(`REVIEW ${pat}`);
const officeListCallsites=files.filter(f=>f.endsWith('.js')&& !f.endsWith('/services/office.js')).filter(f=>/\boffice\.list\s*\(/.test(fs.readFileSync(f,'utf8')));
if(officeListCallsites.length) warnings.push(`REVIEW office.list callsites: ${officeListCallsites.map(f=>path.relative(root,f)).join(', ')}`);
const c=fs.readFileSync(path.join(root,'js/core/constants.js'),'utf8'); const vm=c.match(/APP_VERSION=['"]([^'"]+)/)?.[1]; if(vm!=='4.0.0-RC10') failures.push(`VERSION constants=${vm||'unknown'} expected=4.0.0-RC10`);
const result={timestamp:new Date().toISOString(),version:vm,files:files.length,javascript:js.length,failures,warnings,status:failures.length?'FAIL':'PASS'};
fs.writeFileSync(path.join(root,'docs/RELEASE-AUDIT.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
if(failures.length)process.exit(1);
