// Read-only W5 parity check: compare the saved W0 inventories with the current route,
// schema, entity, preference, service API, and CRUD declarations. Writes only a report to .cache.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(fileURLToPath(new URL('../../',import.meta.url)));
const readJson=async file=>JSON.parse(await fs.readFile(path.join(root,file),'utf8'));
const baseline=await readJson('docs/RESTRUCTURE-BASELINE.json');
const [{NAV_GROUPS,NAV_ROUTE_REGISTRY,NAV_ROUTE_ALIASES,NAV_COMMAND_ROUTES},{SCHEMA,STORES,SYNCABLE_STORES,SCHEMA_MIGRATIONS},{ENTITIES,FILE_TYPE_GROUPS,allFileTypeFields},{SCHEMA_VERSION}]=await Promise.all([
 import('../../js/ui/nav-model.js'),import('../../js/db/schema.js'),import('../../js/domain/entities.js'),import('../../js/core/constants.js')
]);
const sort=values=>[...values].sort((a,b)=>String(a).localeCompare(String(b)));
const missing=(before,after)=>before.filter(value=>!after.includes(value));
const added=(after,before)=>after.filter(value=>!before.includes(value));
const stable=value=>JSON.stringify(value);
const compareSet=(before,after)=>({before:before.length,after:after.length,missing:missing(before,after),added:added(after,before)});
const report={date:new Date().toISOString(),baselineCommit:baseline.metadata.baselineCommit,checks:{},limits:[]};

// Routes and aliases are inventoried separately from actions that invoke them.
const baselineNav=sort(baseline.navigation.globalRoutes);
const currentNav=sort(NAV_ROUTE_REGISTRY.map(item=>item.route));
const baselineCommandRoutes=sort(baseline.navigation.commandPaletteRoutes);
const currentCommandRoutes=sort(NAV_ROUTE_REGISTRY.map(item=>NAV_COMMAND_ROUTES[item.route]||item.route));
report.checks.navigation={groups:{before:baseline.counts.navigationGroups,after:NAV_GROUPS.length},globalRoutes:compareSet(baselineNav,currentNav),commandRoutes:compareSet(baselineCommandRoutes,sort(currentCommandRoutes)),commandRouteDuplicates:currentCommandRoutes.length-new Set(currentCommandRoutes).size,aliases:{...NAV_ROUTE_ALIASES},commandAliasTargetCount:currentCommandRoutes.filter(route=>route==='quickNotes').length};

// Reconstruct the static route key inventory from the existing PAGES + LIST_STORES declarations.
const appSource=await fs.readFile(path.join(root,'js/app.js'),'utf8');
const pageBlock=appSource.match(/const PAGES=\{([\s\S]*?)\n\};/);
const listBlock=appSource.match(/const LIST_STORES=\[([^\]]*)\]/);
assert.ok(pageBlock&&listBlock,'Could not read PAGES/LIST_STORES declarations');
const explicitPageRoutes=[...pageBlock[1].matchAll(/^\s*([A-Za-z_$][\w$]*):\s*\{/gm)].map(match=>match[1]);
const listStores=[...listBlock[1].matchAll(/['"]([^'"]+)['"]/g)].map(match=>match[1]);
const currentStaticRoutes=sort(new Set([...explicitPageRoutes,...listStores]));
const baselineStaticRoutes=sort(baseline.routing.staticRoutes);
report.checks.staticRoutes={...compareSet(baselineStaticRoutes,currentStaticRoutes),beforeSurfaces:baseline.counts.uniqueStaticPageSurfaces,afterSurfaces:new Set(currentStaticRoutes.map(route=>route==='caseNotes'?'quickNotes':route)).size,explicitPageRoutes:explicitPageRoutes.length,listStores:listStores.length};

// IndexedDB schema: compare store names, key paths, index names/key paths, uniqueness and sync scope.
const baselineStores=new Map(baseline.data.stores.map(store=>[store.name,store]));
const currentStores=sort(STORES);
const baselineStoreNames=sort([...baselineStores.keys()]);
const storeDiff=compareSet(baselineStoreNames,currentStores);
const storeDetails=[];
for(const name of baselineStoreNames){
 const before=baselineStores.get(name),after=SCHEMA[name];
 if(!after){storeDetails.push({store:name,missingStore:true});continue}
 const beforeIndexes=sort(before.indexes.map(index=>index.name));
 const afterIndexes=sort(Object.keys(after.indexes));
 const beforeUnique=sort(before.uniqueIndexes.map(index=>index.name));
 const afterUnique=sort(after.uniqueIndexes);
 const beforeIndexKeys=Object.fromEntries(before.indexes.map(index=>[index.name,index.keyPath]));
 const afterIndexKeys=after.indexes;
 const keyPathDifferences=[];
 for(const indexName of beforeIndexes){if(indexName in afterIndexKeys&&stable(beforeIndexKeys[indexName])!==stable(afterIndexKeys[indexName]))keyPathDifferences.push(indexName)}
 const keyPath=stable(before.keyPath)===stable(after.keyPath);
 const autoIncrement=before.autoIncrement===after.autoIncrement;
 const entityDefinition=Boolean(ENTITIES[name])===Boolean(before.hasEntityDefinition);
 if(beforeIndexes.length!==afterIndexes.length||missing(beforeIndexes,afterIndexes).length||missing(afterIndexes,beforeIndexes).length||missing(beforeUnique,afterUnique).length||missing(afterUnique,beforeUnique).length||keyPathDifferences.length||!keyPath||!autoIncrement||!entityDefinition){
  storeDetails.push({store:name,indexes:{missing:missing(beforeIndexes,afterIndexes),added:missing(afterIndexes,beforeIndexes)},uniqueIndexes:{missing:missing(beforeUnique,afterUnique),added:missing(afterUnique,beforeUnique)},keyPathDifferences,keyPath,autoIncrement,entityDefinition});
 }
}
const baselineSyncable=sort(baseline.data.stores.filter(store=>store.syncable).map(store=>store.name));
const currentIndexCount=Object.values(SCHEMA).reduce((total,definition)=>total+Object.keys(definition.indexes).length+definition.uniqueIndexes.length,0);
report.checks.schema={schemaVersion:{before:baseline.data.schemaVersion,after:SCHEMA_VERSION},stores:storeDiff,indexes:{before:baseline.data.indexCount,after:currentIndexCount},syncableStores:compareSet(baselineSyncable,sort(SYNCABLE_STORES)),storeDefinitionDifferences:storeDetails,migrationVersions:{before:baseline.data.migrations.map(item=>item.version),after:SCHEMA_MIGRATIONS.map(item=>item.version)}};

// Entity/form inventories compare field metadata and relationships separately.
const normalizeEntityField=field=>({key:field.k,label:field.l,type:field.t,required:Boolean(field.req),grid:Boolean(field.grid),group:field.g??null,lookup:field.lk??null,reference:field.ref??null,displayType:field.dt??null,options:field.opts??null});
const currentEntityNames=sort(Object.keys(ENTITIES));
const baselineEntityNames=sort(baseline.data.entities.map(entity=>entity.store));
const entityMetadataDifferences=[];
for(const store of baselineEntityNames){
 const before=baseline.data.entities.find(entity=>entity.store===store),after=ENTITIES[store];
 if(!after){entityMetadataDifferences.push({store,missingEntity:true});continue}
 const beforeShape={label:before.label,plural:before.plural,routePrefix:before.routePrefix,fields:before.fields};
 const afterShape={label:after.label,plural:after.plural,routePrefix:after.route??null,fields:after.fields.map(normalizeEntityField)};
 if(stable(beforeShape)!==stable(afterShape)){
  const oldKeys=before.fields.map(field=>field.key),newKeys=after.fields.map(field=>field.k);
  entityMetadataDifferences.push({store,missingFields:missing(oldKeys,newKeys),addedFields:missing(newKeys,oldKeys),metadataChanged:missing(oldKeys,newKeys).length===0&&missing(newKeys,oldKeys).length===0});
 }
}
const currentFieldCount=Object.values(ENTITIES).reduce((sum,entity)=>sum+entity.fields.length,0);
const normalizeFileField=field=>({key:field.k,label:field.l,type:field.t,lookup:field.lk??null,required:Boolean(field.req)});
const baselineFileGroups=new Map(baseline.data.dynamicFileTypeGroups.map(group=>[group.key,group]));
const currentFileGroups=Object.entries(FILE_TYPE_GROUPS);
const fileGroupDifferences=[];
for(const [key,group] of currentFileGroups){
 const before=baselineFileGroups.get(key);
 const afterFields=group.fields.map(normalizeFileField);
 if(!before||stable(before.fields)!==stable(afterFields))fileGroupDifferences.push({group:key,missingFields:before?missing(before.fields.map(field=>field.key),afterFields.map(field=>field.key)):before,addedFields:before?missing(afterFields.map(field=>field.key),before.fields.map(field=>field.key)):afterFields.map(field=>field.key)});
}
const currentRefFields=Object.entries(ENTITIES).flatMap(([store,entity])=>entity.fields.filter(field=>field.ref).map(field=>({store,field:field.k,label:field.l,reference:field.ref,type:field.t})));
const currentLookupFields=Object.entries(ENTITIES).flatMap(([store,entity])=>entity.fields.filter(field=>field.lk).map(field=>({store,field:field.k,category:field.lk})));
const normalizeRows=rows=>sort(rows.map(row=>stable(row)));
const formFieldTypes=sort(new Set([...Object.values(ENTITIES).flatMap(entity=>entity.fields.map(field=>field.t)),...allFileTypeFields().map(field=>field.t)]));
report.checks.entities={definitions:compareSet(baselineEntityNames,currentEntityNames),fields:{before:baseline.data.entityFieldCount,after:currentFieldCount},fieldMetadataDifferences:entityMetadataDifferences,dynamicFileTypeGroups:{before:baseline.data.dynamicFileTypeGroups.length,after:currentFileGroups.length,fieldsBefore:baseline.data.dynamicFileTypeFieldCount,fieldsAfter:allFileTypeFields().length,differences:fileGroupDifferences},relationshipFields:{before:baseline.data.relationshipFields.length,after:currentRefFields.length,missing:missing(normalizeRows(baseline.data.relationshipFields),normalizeRows(currentRefFields)),added:missing(normalizeRows(currentRefFields),normalizeRows(baseline.data.relationshipFields))},lookupFields:{before:baseline.data.lookupFields.length,after:currentLookupFields.length,missing:missing(normalizeRows(baseline.data.lookupFields),normalizeRows(currentLookupFields)),added:missing(normalizeRows(currentLookupFields),normalizeRows(baseline.data.lookupFields))},relationshipStoreFamilies:{before:baseline.data.relationshipStoreFamilies.length,missing:missing(baseline.data.relationshipStoreFamilies,currentStores)}};
const baselineFormTypes=sort(baseline.routeAndActionArchitecture.formFieldKinds);
report.checks.formKinds={before:baselineFormTypes,after:formFieldTypes,missing:missing(baselineFormTypes,formFieldTypes),added:missing(formFieldTypes,baselineFormTypes)};

// CRUD API inventories are captured from the existing prototypes; no database instance is opened or written.
globalThis.window=globalThis.window||{};
const [{Repository},{Office}]=await Promise.all([import('../../js/db/repository.js'),import('../../js/services/office.js')]);
const prototypeMethods=Constructor=>sort(Object.getOwnPropertyNames(Constructor.prototype).filter(name=>name!=='constructor'));
report.checks.crud={repository:compareSet(sort(baseline.routeAndActionArchitecture.repositoryMethods),prototypeMethods(Repository)),officeDomain:compareSet(sort(baseline.routeAndActionArchitecture.officeDomainMethods),prototypeMethods(Office))};

// Preserve all recorded service export names and preference constants (value + defining module).
const apiMissing=[];
const apiAdded=[];
const exportRegex=/\bexport\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)|\bexport\s*\{([^}]*)\}/g;
for(const [module,inventory] of Object.entries(baseline.serviceApiInventory)){
 const source=await fs.readFile(path.join(root,module),'utf8').catch(()=>null);
 if(source===null){apiMissing.push({module,reason:'module removed'});continue}
 const found=new Set();
 for(const match of source.matchAll(exportRegex)){
  if(match[1])found.add(match[1]);
  else for(const entry of match[2].split(',')){const name=entry.trim().split(/\s+as\s+/).at(-1);if(name)found.add(name)}
 }
 for(const name of inventory.exports)if(!found.has(name))apiMissing.push({module,name});
 for(const name of found)if(!inventory.exports.includes(name))apiAdded.push({module,name});
}
const currentServiceModules=sort((await fs.readdir(path.join(root,'js/services'))).filter(name=>name.endsWith('.js')).map(name=>`js/services/${name}`));
const baselineServiceModules=sort(Object.keys(baseline.serviceApiInventory));
report.checks.serviceApi={modules:compareSet(baselineServiceModules,currentServiceModules),baselineExportCount:baseline.counts.serviceExportNames,baselineExportsChecked:Object.values(baseline.serviceApiInventory).reduce((sum,item)=>sum+item.exports.length,0),missingExports:apiMissing,addedExports:apiAdded};
const preferenceMissing=[];
for(const item of baseline.persistence.preferenceKeyConstants){
 const source=await fs.readFile(path.join(root,item.module),'utf8').catch(()=>null);
 if(source===null){preferenceMissing.push({...item,reason:'module removed'});continue}
 const pattern=new RegExp(`\\b${item.symbol}\\s*=\\s*(['"])${item.value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\1`);
 if(!pattern.test(source))preferenceMissing.push({...item,reason:'value or declaration changed'});
}
report.checks.preferences={baselineConstants:baseline.persistence.preferenceKeyConstants.length,missingOrChanged:preferenceMissing};

// Current action inventory from the command builder; dynamic actions are sampled in both global and file context.
await import('./harness.mjs');
const {staticCommands}=await import('../../js/ui/palette.js');
const dashboardCommands=staticCommands({route:'dashboard',go(){},office:null});
const fileContextCommands=staticCommands({route:'file:w5-inventory',go(){},office:null});
const commandIds=commands=>commands.map(command=>command.id);
const byId=(commands,id)=>commands.filter(command=>command.id===id).length;
const groups=Object.fromEntries([...new Set(dashboardCommands.map(command=>command.group))].map(group=>[group,dashboardCommands.filter(command=>command.group===group).length]));
const paletteSource=await fs.readFile(path.join(root,'js/ui/palette.js'),'utf8');
report.checks.actions={baselineNavigationCommands:baseline.navigation.commandPaletteRoutes.length,currentNavigationCommands:dashboardCommands.filter(command=>command.group==='التنقل').length,globalStaticCommandCount:dashboardCommands.length,globalCommandsByGroup:groups,fileContextActionCount:fileContextCommands.filter(command=>command.group==='في السياق الحالي').length,duplicateIds:commandIds(dashboardCommands).filter((id,index,all)=>all.indexOf(id)!==index),searchRouteCommands:byId(dashboardCommands,'nav:search'),backupRouteCommands:byId(dashboardCommands,'nav:backup'),manualSearchCommands:byId(dashboardCommands,'qa:search'),manualBackupCommands:byId(dashboardCommands,'qa:backup'),quickAddCommands:byId(dashboardCommands,'qa:quick-add'),quickNoteCaptureCommands:byId(dashboardCommands,'qa:quick-note'),quickNotesAliasRouteCommands:byId(dashboardCommands,'nav:quickNotes'),canonicalCaseNotesRouteCommands:byId(dashboardCommands,'nav:caseNotes'),liveSearchAllSourcePresent:paletteSource.includes('searchAll'),contextActionsSourcePresent:paletteSource.includes('contextualQuickActions(app)')};

// Shortcuts are recorded as source signatures, separately from the browser behavior evidence.
const [workCenterSource,listPageSource,formSource,datagridSource]=await Promise.all(['js/modules/work-center.js','js/modules/list-page.js','js/ui/form.js','js/ui/datagrid.js'].map(file=>fs.readFile(path.join(root,file),'utf8')));
const shortcutSignatures=[
 ['Ctrl/Cmd+K',appSource.includes("!typing&&(e.ctrlKey||e.metaKey)&&e.code==='KeyK'")],
 ['Ctrl/Cmd+Shift+N',appSource.includes("!typing&&(e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key.toLowerCase()==='n'")],
 ['Ctrl/Cmd+Shift+T',appSource.includes("!typing&&(e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key.toLowerCase()==='t'")],
 ['Ctrl/Cmd+\\',appSource.includes("!typing&&(e.ctrlKey||e.metaKey)&&e.key==='\\\\'")],
 ['Alt+1…9',appSource.includes("!typing&&e.altKey&&!e.ctrlKey&&!e.metaKey&&/^[1-9]$/.test(e.key)")],
 ['?',appSource.includes("e.key==='?' &&")||appSource.includes("e.key==='?'")],
 ['G',appSource.includes("e.key.toLowerCase()==='g'")],
 ['N/T/W/M/R', ['n:','t:','w:','m:','r:'].every(token=>workCenterSource.includes(token))],
 ['/',listPageSource.includes("e.key==='/'")||datagridSource.includes("e.key==='/'")],
 ['Ctrl/Cmd+Enter',formSource.includes("(e.ctrlKey||e.metaKey)&&e.key==='Enter'")],
 ['Escape',appSource.includes("e.key==='Escape'")],
 ['DataGrid arrows + Enter',['ArrowDown','ArrowUp','clickRow(tr)'].every(token=>datagridSource.includes(token))]
];
report.checks.shortcuts={baselineItems:baseline.shortcuts.length,inventory:baseline.shortcuts.map(item=>item.keys),currentCodeSignatures:shortcutSignatures.map(([keys,present])=>({keys,present})),missingSignatures:shortcutSignatures.filter(([,present])=>!present).map(([keys])=>keys)};
report.limits.push('Action/form/store/relation/shortcut inventories are reported separately from browser behavior checks.');
report.limits.push('Service export parsing covers named declarations and export lists; it does not infer whether every business action was exercised.');

const failures=[];
const requireNoLoss=(path,value)=>{if(value?.missing?.length)failures.push({path,missing:value.missing})};
requireNoLoss('navigation.globalRoutes',report.checks.navigation.globalRoutes);
requireNoLoss('navigation.commandRoutes',report.checks.navigation.commandRoutes);
requireNoLoss('staticRoutes',report.checks.staticRoutes);
requireNoLoss('schema.stores',report.checks.schema.stores);
requireNoLoss('schema.syncableStores',report.checks.schema.syncableStores);
requireNoLoss('entities.definitions',report.checks.entities.definitions);
requireNoLoss('crud.repository',report.checks.crud.repository);
requireNoLoss('crud.officeDomain',report.checks.crud.officeDomain);
if(report.checks.staticRoutes.after!==baseline.routing.staticRoutes.length)failures.push({path:'staticRoutes.count',expected:baseline.routing.staticRoutes.length,actual:report.checks.staticRoutes.after});
if(report.checks.schema.schemaVersion.before!==report.checks.schema.schemaVersion.after)failures.push({path:'schemaVersion',before:report.checks.schema.schemaVersion.before,after:report.checks.schema.schemaVersion.after});
if(report.checks.schema.storeDefinitionDifferences.length)failures.push({path:'schema.storeDefinitionDifferences',details:report.checks.schema.storeDefinitionDifferences});
if(report.checks.entities.fieldMetadataDifferences.length)failures.push({path:'entities.fieldMetadataDifferences',details:report.checks.entities.fieldMetadataDifferences});
if(report.checks.entities.dynamicFileTypeGroups.differences.length)failures.push({path:'dynamicFileTypeGroups.differences',details:report.checks.entities.dynamicFileTypeGroups.differences});
if(report.checks.entities.relationshipFields.missing.length)failures.push({path:'relationshipFields',missing:report.checks.entities.relationshipFields.missing});
if(report.checks.entities.lookupFields.missing.length)failures.push({path:'lookupFields',missing:report.checks.entities.lookupFields.missing});
if(report.checks.formKinds.missing.length)failures.push({path:'formKinds',missing:report.checks.formKinds.missing});
if(apiMissing.length)failures.push({path:'serviceApi.missingExports',details:apiMissing});
if(preferenceMissing.length)failures.push({path:'preferences.missingOrChanged',details:preferenceMissing});
if(report.checks.navigation.commandRouteDuplicates)failures.push({path:'navigation.commandRouteDuplicates',count:report.checks.navigation.commandRouteDuplicates});
if(report.checks.navigation.commandAliasTargetCount!==1)failures.push({path:'navigation.quickNotesAliasCommandCount',count:report.checks.navigation.commandAliasTargetCount});
if(report.checks.actions.duplicateIds.length)failures.push({path:'actions.duplicateIds',details:report.checks.actions.duplicateIds});
for(const [key,expected] of [['searchRouteCommands',1],['backupRouteCommands',1],['manualSearchCommands',0],['manualBackupCommands',0],['quickAddCommands',1],['quickNoteCaptureCommands',1],['quickNotesAliasRouteCommands',1],['canonicalCaseNotesRouteCommands',0]])if(report.checks.actions[key]!==expected)failures.push({path:`actions.${key}`,expected,actual:report.checks.actions[key]});
if(!report.checks.actions.liveSearchAllSourcePresent||!report.checks.actions.contextActionsSourcePresent)failures.push({path:'actions.sourceSignatures',details:report.checks.actions});
if(report.checks.shortcuts.missingSignatures.length)failures.push({path:'shortcuts.missingSignatures',details:report.checks.shortcuts.missingSignatures});
report.failures=failures;
report.status=failures.length?'FAIL':'PASS';
const outputDir=path.join(root,'.cache','restructure-w5');
await fs.mkdir(outputDir,{recursive:true});
await fs.writeFile(path.join(outputDir,'inventory.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({status:report.status,output:'.cache/restructure-w5/inventory.json',checks:{navigation:report.checks.navigation,staticRoutes:report.checks.staticRoutes,schema:report.checks.schema,entities:report.checks.entities,formKinds:report.checks.formKinds,crud:report.checks.crud,serviceApi:{modules:report.checks.serviceApi.modules,baselineExportsChecked:report.checks.serviceApi.baselineExportsChecked,missingExports:report.checks.serviceApi.missingExports,addedExports:report.checks.serviceApi.addedExports.length},preferences:report.checks.preferences},failures},null,2));
if(failures.length)process.exitCode=1;
