import {DatabaseContext} from '../db/database-context.js';
import {SCHEMA_VERSION} from '../core/constants.js';
import {ensureSchema,STORES} from '../db/schema.js';
import {transaction,request} from '../db/unit-of-work.js';
import {Office} from '../services/office.js';
import {createGridRelations,constrainedReferenceId,gridPageContext,hasLegalFileColumns} from '../services/grid-relations.js';
import {resolveRefs,createEntityGridProvider,loadRows} from '../services/entity-query.js';
import {columnsFor} from '../modules/list-page.js';
import {ENTITIES} from '../domain/entities.js';
import {defineGridColumns,legalFileColumns,gridPreferenceKey} from '../ui/grid-columns.js';
import {mountGrid} from '../ui/datagrid.js';
import {createArrayDataProvider} from '../ui/grid-data-provider.js';
import {createIndexedDbDataProvider} from '../db/grid-data-provider.js';
import {createGridQuery,applyGridQuery} from '../core/grid-query.js';
import {formatLegalFile,formatOfficialNumber} from '../core/file-number.js';
import {prefs} from '../core/preferences.js';

export const GRID_TEST_CLIENT='فاطمة محمد إبراهيم محمد';
export const GRID_TEST_COCLIENT='أحمد محمود علي';
const parse=html=>{const root=document.createElement('div');root.innerHTML=html;return root};
const field=(root,label)=>[...root.querySelectorAll('.dg-print-context div')].find(node=>node.querySelector('dt')?.textContent===label)?.querySelector('dd')?.textContent||'';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

// Isolated, synthetic database shared by Node and browser integration tests.
// No registry/default database is selected, modified, repaired or migrated here.
export async function createGridFixture(){
 const name=`AhmadKhudairLawOfficeDB__test__grid_context__${Date.now()}_${Math.random().toString(36).slice(2)}`;
 const db=await new Promise((resolve,reject)=>{const request=indexedDB.open(name,SCHEMA_VERSION);request.onupgradeneeded=()=>ensureSchema(request.result);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
 const ctx=new DatabaseContext(db,{id:name,name:'اختبار الجداول'}),office=new Office(ctx);
 const base={createdAt:'2026-01-01T10:00:00.000Z',updatedAt:'2026-01-01T10:00:00.000Z',version:1,isDeleted:false};
 const rows={
  clients:[{id:'c1',fullName:GRID_TEST_CLIENT,clientCode:'CL-2026-000001',clientFileId:'cf1'},
   {id:'c2',fullName:GRID_TEST_COCLIENT,clientCode:'CL-2026-000002',clientFileId:'cf2'},
   {id:'c3',fullName:'موكل آخر',clientCode:'CL-2026-000003'},
   {id:'c-duplicate-name',fullName:GRID_TEST_CLIENT,clientCode:'CL-2026-000004'}],
  opponents:[{id:'o1',name:'الخصم الأول'},{id:'o2',name:'الخصم الثاني'},{id:'o3',name:'الخصم الثالث'},
   {id:'o4',name:'خصم <img src=x onerror="alert(1)">'},{id:'o-legacy',name:'خصم تاريخي'},{id:'o6',name:'خصم الملف المشترك'}],
  clientFiles:[{id:'cf1',clientId:'c1',clientCode:'CL-2026-000001',status:'نشط',openedAt:'2026-01-01'},
   {id:'cf2',clientId:'c2',clientCode:'CL-2026-000002',status:'نشط',openedAt:'2026-01-01'}],
  taxonomy:[{id:'civil',kind:'category',name:'مدني',parentId:'root'},
   {id:'type-lawsuit',kind:'fileType',parentId:'civil',name:'دعوى'}],
  files:[{id:'f1',fileNumber:'LF-2026-000002',fileType:'نوع قديم',fileTypeId:'type-lawsuit',categoryId:'civil',title:'عنوان يدوي — لا يُستخرج منه اسم الموكل',clientFileId:'cf1',currentStageId:'ca1'},
   {id:'f2',fileNumber:'LF-2026-000011',fileType:'عقد',title:'عنوان عقد مستقل',currentStageId:'ca2'},
   {id:'f3',fileNumber:'2026/0009',typeSnapshot:{type:'استشارة'},title:'ملف بلا موكل وبلا قضية'},
   {id:'f4',fileNumber:'LF-2026-000004',fileType:'دعوى',title:'ملف مشترك',clientFileId:'cf2',currentStageId:'ca4'},
   {id:'f5',fileNumber:'LF-2026-000005',fileType:'خدمة',title:'ملف ملكية ملف الموكل فقط',clientFileId:'cf1'},
   {id:'f6',fileNumber:'LF-2026-000006',fileType:'تنفيذ',title:'علاقات قضائية قديمة فقط'},
   {id:'f-duplicate',fileNumber:'LF-2026-000008',fileType:'عقد',title:'نفس الاسم — شخص مختلف'}],
  cases:[{id:'ca1',fileId:'f1',stageType:'أول درجة',caseNumber:'4661',caseYear:2026,lifecycle:'active'},
   {id:'ca-planned',fileId:'f1',stageType:'استئناف',lifecycle:'planned'},
   {id:'ca2',fileId:'f2',stageType:'طلب',caseNumber:'9000',caseYear:2025},
   {id:'ca4',fileId:'f4',caseNumber:'42',caseYear:2026},
   {id:'ca6',fileId:'f6',caseNumber:'616',caseYear:2026}],
  fileParties:[{id:'p-c1',fileId:'f1',partyKind:'client',clientId:'c1',name:'اسم موكل قديم',partyName:'اسم موكل قديم',role:'مدعية',sequence:1,isPrimary:true},
   {id:'p-c1-second-role',fileId:'f1',partyKind:'client',clientId:'c1',name:'اسم موكل قديم',role:'مستأنفة',sequence:2},
   {id:'p-o1',fileId:'f1',partyKind:'opponent',opponentId:'o1',name:'اسم خصم قديم',role:'مدعى عليه',sequence:1,isPrimary:true},
   {id:'p-o2',fileId:'f1',partyKind:'opponent',opponentId:'o2',role:'مدعى عليه',sequence:2},
   {id:'p-o3',fileId:'f1',partyKind:'opponent',opponentId:'o3',role:'مدعى عليه',sequence:3,isActive:false},
   {id:'p-o4',fileId:'f1',partyKind:'opponent',opponentId:'o4',role:'مدعى عليه',sequence:4},
   {id:'p-unregistered',fileId:'f1',partyKind:'opponent',name:'خصم دون سجل شخصي',role:'خصم',sequence:5},
   {id:'p-deleted',fileId:'f1',partyKind:'opponent',name:'طرف محذوف منطقيًا',isDeleted:true},
   {id:'p-c4a',fileId:'f4',partyKind:'client',clientId:'c1',role:'مدعٍ'},
   {id:'p-c4b',fileId:'f4',partyKind:'client',clientId:'c2',role:'مدعٍ'},
   {id:'p-o6',fileId:'f4',partyKind:'opponent',opponentId:'o6',role:'خصم'},
   {id:'p-duplicate',fileId:'f-duplicate',partyKind:'client',clientId:'c-duplicate-name',role:'موكل'}],
  fileClients:[{id:'legacy-c3',fileId:'f2',clientId:'c3',role:'principal'}],
  caseClients:[{id:'legacy-case-c1',caseId:'ca6',clientId:'c1',role:'موكل'}],
  caseOpponents:[{id:'legacy-case-o1',caseId:'ca1',opponentId:'o1',role:'خصم'},
   {id:'legacy-case-o',caseId:'ca1',opponentId:'o-legacy',role:'مستأنف ضده'},
   {id:'legacy-case-o6',caseId:'ca6',opponentId:'o-legacy',role:'المنفذ ضده'}],
  hearings:[{id:'h1',caseId:'ca1',hearingDate:'2026-10-01',type:'مرافعة'},
   {id:'h2',fileId:'f2',caseId:'ca2',hearingDate:'2026-10-02',type:'طلب'},
   {id:'h4',caseId:'ca4',hearingDate:'2026-10-03',type:'ملف مشترك'}],
  procedures:[{id:'pr1',fileId:'f1',type:'عمل إداري',description:'متابعة الملف',actionDate:'2026-10-01',status:'open'}],
  serviceRecords:[{id:'service1',fileId:'f1',caseId:'ca1',internalNumber:'SR-2026-000001',partyId:'p-o1',partyName:'طرف إعلان',actionType:'إعلان',status:'مطلوب',recordState:'active'}],
  judgments:[{id:'j1',caseId:'ca1',judgmentDate:'2026-10-01',operativeSummary:'منطوق اختبار'}],
  fees:[{id:'fee1',fileId:'f1',agreedAmount:1000}],
  feePayments:[{id:'pay1',feeId:'fee1',amount:100,date:'2026-10-01'}],
  appointments:[{id:'appt1',clientId:'c3',title:'موعد موكل بدون ملف',date:'2026-10-01'}],
  communications:[{id:'comm1',clientId:'c1',fileId:'f4',subject:'اتصال عن ملف مشترك',date:'2026-10-01'}],
  powersOfAttorney:[{id:'poa1',clientId:'c1',fileId:'f1',poaNumber:'123',issuedDate:'2026-01-01'}],
  fileRelations:[{id:'rel1',sourceFileId:'f1',targetFileId:'f4',relationType:'مرتبط'}],
  activityLog:[{id:'log1',fileId:'f1',entityType:'hearings',entityId:'h1',action:'create',timestamp:'2026-10-01T10:00:00.000Z'},
   {id:'log2',entityType:'files',entityId:'f1',action:'update',timestamp:'2026-10-01T10:01:00.000Z'},
   {id:'log3',entityType:'cases',entityId:'ca1',action:'update',timestamp:'2026-10-01T10:02:00.000Z'},
   {id:'log4',entityType:'feePayments',entityId:'pay1',action:'create',timestamp:'2026-10-01T10:03:00.000Z'},
   {id:'log5',entityType:'clients',entityId:'c1',action:'update',timestamp:'2026-10-01T10:04:00.000Z'}],
  bailiffs:[{id:'bailiff1',name:'محضر اختبار',court:'محكمة اختبار'}]
 };
 for(const entries of Object.values(rows))entries.forEach(row=>{for(const [key,value] of Object.entries(base))if(row[key]===undefined)row[key]=value});
 await new Promise((resolve,reject)=>{const tx=db.transaction(Object.keys(rows),'readwrite');for(const [store,entries] of Object.entries(rows))entries.forEach(row=>tx.objectStore(store).put(row));tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)});
 return {name,db,ctx,office,rows,grids:[],
  async snapshot(){const data={};for(const store of STORES)data[store]=await office.r[store].all(5000);return JSON.stringify(data)},
  async dispose(){this.grids.forEach(({grid,root})=>{grid.destroy();root.remove()});ctx.close();await new Promise(resolve=>{const request=indexedDB.deleteDatabase(name);request.onsuccess=resolve;request.onerror=resolve;request.onblocked=resolve})}
 };
}

// Additional bounded records for cursor/date tests only. Seed once, atomically,
// before taking integrity snapshots; never touch a registered office database.
export async function seedGridDateRows(fixture){
 const ordered=Array.from({length:230},(_,index)=>({
  id:`dated-${String(index).padStart(3,'0')}`,fileId:'f1',caseId:'ca1',
  type:`DATED-${String(index).padStart(3,'0')}`,
  hearingDate:new Date(Date.UTC(2026,0,index+1)).toISOString().slice(0,10),isDeleted:false
 }));
 await transaction(fixture.ctx,['hearings'],async tx=>{
  for(const row of ordered)await request(tx.objectStore('hearings').put(row));
 });
 return ordered;
}

export async function fixtureGrid(fixture,store,rows=fixture.rows[store]||[],options={}){
 const relations=createGridRelations(fixture.office,store);
 const [refs]=await Promise.all([resolveRefs(fixture.office,rows,ENTITIES[store]?.fields||[]),relations.hydrate(rows)]);
 const columns=defineGridColumns(options.columns||columnsFor(store,refs,{relations}));
 const root=document.createElement('div');document.body.append(root);
 const grid=mountGrid(root,{rows,columns,storageKey:'',selectable:true,title:ENTITIES[store]?.plural||'جدول',...relations.gridOptions(options.printContext||{}),...options});
 const result={root,grid,relations,columns};fixture.grids.push(result);return result;
}
const withFixture=fn=>async()=>{const fixture=await createGridFixture();try{await fn(fixture)}finally{await fixture.dispose()}};

export function runGridContextTests(test,expect){
 test('Grid formatters: internal file/type is independent of the title and official case number',()=>{
  expect(formatLegalFile({fileNumber:'LF-2026-000002',fileType:'دعوى',title:GRID_TEST_CLIENT})).toBe('2/2026 — دعوى');
  expect(formatOfficialNumber({caseNumber:'4661',caseYear:2026})).toBe('4661/2026');
  expect(formatLegalFile({fileNumber:'2026/0001',typeSnapshot:{type:'خدمة'}})).toBe('1/2026 — خدمة');
  expect(gridPreferenceKey('grid:clients')).toBe('grid:clients');
  expect(gridPreferenceKey('clients')).toBe('grid:clients');
 });
 test('Grid column audit: legal datasets have real file/client/opponent definitions; reference-only datasets do not',withFixture(async f=>{
  for(const store of Object.keys(ENTITIES)){
   const relations=createGridRelations(f.office,store),columns=defineGridColumns(columnsFor(store,new Map(),{relations}));
   expect(new Set(columns.map(c=>c.key)).size).toBe(columns.length);
   expect(columns.some(c=>c.contextRole==='legalFile')).toBe(hasLegalFileColumns(store));
   if(hasLegalFileColumns(store))for(const role of ['legalFile','client','opponent']){
    const c=columns.find(c=>c.contextRole===role);expect(Boolean(c)).toBe(true);
    expect(c.sortable&&c.filterable&&c.searchable&&c.hideable).toBe(true);
   }
  }
 }));
 test('Grid relations: original names, inactive parties, repeated roles and legacy links are retained',withFixture(async f=>{
  const before=await f.snapshot(),{relations,columns}=await fixtureGrid(f,'files',[f.rows.files[0]]);
  const file=f.rows.files[0],opponents=relations.items(file,'opponent');
  expect(columns[0].text(file)).toBe('2/2026 — دعوى');
  expect(relations.items(file,'client').length).toBe(1);
  expect(relations.items(file,'client')[0].text).toBe(GRID_TEST_CLIENT);
  expect(relations.items(file,'client')[0].detail.includes('مستأنفة')).toBe(true);
  expect(opponents.length).toBe(6);expect(opponents.some(p=>p.id==='o3')).toBe(true);
  expect(opponents.find(p=>p.id==='o3').detail.includes('غير نشط')).toBe(true);
  expect(opponents.some(p=>p.text==='خصم تاريخي')).toBe(true);
  expect(opponents.some(p=>p.text==='خصم دون سجل شخصي')).toBe(true);
  expect(await f.snapshot()).toBe(before);
 }));
 test('Grid cells: compact +N, full accessible details, escaped names and no row-opening side effect',withFixture(async f=>{
  let opened=0;const {root}=await fixtureGrid(f,'files',[f.rows.files[0]],{onRowClick:()=>opened++});
  const cell=root.querySelector('td[data-k="opponentId"]');
  expect(cell.querySelectorAll('.dg-cell-item').length).toBe(2);
  expect(cell.querySelector('.dg-cell-more').textContent).toBe('+4');
  cell.querySelector('.dg-cell-more').click();
  const pop=document.querySelector('.dg-pop');expect(pop.querySelectorAll('li').length).toBe(6);
  expect(pop.querySelector('img')).toBe(null);expect(pop.textContent.includes('غير نشط')).toBe(true);
  expect(opened).toBe(0);pop.querySelector('.dg-x').click();
 }));
 test('Grid query: all multi-party names participate in search/filter/sort, not just the two compact names',withFixture(async f=>{
  const {grid}=await fixtureGrid(f,'files',[f.rows.files[0],f.rows.files[1],f.rows.files[3]]);
  grid.setColSearch('opponentId','تاريخي');expect(grid.getView().length).toBe(1);expect(grid.getView()[0].id).toBe('f1');
  grid.setColSearch('opponentId','');grid.setColSearch('clientId','احمد محمود');expect(grid.getView()[0].id).toBe('f4');
  grid.setColSearch('clientId','');grid.sortBy('fileNumber','asc');expect(grid.getView().map(r=>r.id).join(',')).toBe('f1,f4,f2');
  grid.applyFilter('fileNumber','contains','4661');expect(grid.getView().length).toBe(0);
 }));
 test('Grid directory rows: many legal files are aggregated, never confused with the main client file',withFixture(async f=>{
  const {relations,columns}=await fixtureGrid(f,'clients',[f.rows.clients[0]]);
  const files=relations.items(f.rows.clients[0],'legalFile');
  expect(files.map(file=>file.id).sort().join(',')).toBe('f1,f4,f5,f6');
  expect(columns.find(c=>c.key==='clientCode').text(f.rows.clients[0])).toBe('1/2026');
  expect(columns.find(c=>c.contextRole==='client').text(f.rows.clients[0])).toBe(GRID_TEST_CLIENT);
  expect(relations.items(f.rows.clients[0],'opponent').some(p=>p.id==='o-legacy')).toBe(true);
 }));
 test('Grid indirect links: cases, fee payments, historical activity, client-only appointments and both sides of file relations',withFixture(async f=>{
  for(const store of ['hearings','judgments','feePayments']){
   const {relations}=await fixtureGrid(f,store,[f.rows[store][0]]);
   expect(relations.items(f.rows[store][0],'legalFile')[0].id).toBe('f1');
   expect(relations.items(f.rows[store][0],'client')[0].text).toBe(GRID_TEST_CLIENT);
  }
  const audit=(await fixtureGrid(f,'activityLog')).relations;
  for(const row of f.rows.activityLog.slice(0,4)){
   expect(audit.items(row,'legalFile')[0].id).toBe('f1');
   expect(audit.items(row,'client')[0].text).toBe(GRID_TEST_CLIENT);
  }
  expect(audit.items(f.rows.activityLog[4],'legalFile').length).toBe(0);
  expect(audit.items(f.rows.activityLog[4],'client')[0].text).toBe(GRID_TEST_CLIENT);
  const appt=(await fixtureGrid(f,'appointments')).relations;
  expect(appt.items(f.rows.appointments[0],'legalFile').length).toBe(0);
  expect(appt.items(f.rows.appointments[0],'client')[0].id).toBe('c3');
  const {columns}=await fixtureGrid(f,'fileRelations');
  expect(columns.find(c=>c.key==='sourceFileId').text(f.rows.fileRelations[0])).toBe('2/2026 — دعوى');
  expect(columns.find(c=>c.key==='targetClientId').text(f.rows.fileRelations[0]).includes(GRID_TEST_COCLIENT)).toBe(true);
 }));
 test('Print document — client files: ID-resolved header and no repeated client column in the printed rows',withFixture(async f=>{
  const {grid,root}=await fixtureGrid(f,'files',[f.rows.files[0]],{printContext:{clientId:'c1'},title:'ملفات الموكل'});
  const doc=parse(await grid.getPrintDocument());
  expect(field(doc,'الموكل')).toBe(GRID_TEST_CLIENT);expect(doc.querySelector('h1').textContent).toBe('ملفات الموكل');
  expect(doc.querySelector('th[data-column="clientId"]')).toBe(null);
  expect(doc.querySelector('tbody').textContent.includes(GRID_TEST_CLIENT)).toBe(false);
  expect(Boolean(root.querySelector('th[data-key="clientId"]'))).toBe(true);
  expect(doc.querySelector('.dg-print-office').textContent).toBe('مكتب الأستاذ / أحمد محمد خضير المحامي');
 }));
 for(const [store,title] of [['hearings','جلسات الملف'],['procedures','الأعمال الإدارية للملف'],['judgments','أحكام الملف']]){
  test(`Print document — ${store}: correct client/file/official case context without record mutation`,withFixture(async f=>{
   const before=await f.snapshot(),{grid}=await fixtureGrid(f,store,[f.rows[store][0]],{title,printContext:{fileId:'f1'}});
   const doc=parse(await grid.getPrintDocument());
   expect(field(doc,'الموكل')).toBe(GRID_TEST_CLIENT);expect(field(doc,'رقم الملف / نوع الملف')).toBe('2/2026 — دعوى');
   expect(field(doc,'رقم الدعوى / القضية')).toBe('4661/2026');expect(Boolean(field(doc,'تاريخ الطباعة'))).toBe(true);
   expect(doc.querySelectorAll('tbody tr').length).toBe(1);expect(await f.snapshot()).toBe(before);
  }));
 }
 test('Print document — general multi-client table: no invented single-client context, even for a one-client page',withFixture(async f=>{
  const {grid}=await fixtureGrid(f,'clients');
  let doc=parse(await grid.getPrintDocument());expect(field(doc,'الموكل')).toBe('');expect(field(doc,'الموكلون')).toBe('');
  expect(Boolean(doc.querySelector('th[data-column="fullName"]'))).toBe(true);
  grid.setRows([f.rows.clients[0]]);doc=parse(await grid.getPrintDocument());expect(field(doc,'الموكل')).toBe('');
 }));
 test('Print document — filtered client: references use real IDs, including people with identical names',withFixture(async f=>{
  const {grid}=await fixtureGrid(f,'files',[f.rows.files[0],f.rows.files[3],f.rows.files[6]]);
  grid.applyReferenceFilter('clientId','c1');
  expect(grid.getView().map(row=>row.id).sort().join(',')).toBe('f1,f4');
  const context=await grid.getPrintContext(),doc=parse(await grid.getPrintDocument());
  expect(context.client.id).toBe('c1');expect(context.filtered).toBe(true);expect(field(doc,'الموكل')).toBe(GRID_TEST_CLIENT);
  expect(doc.querySelector('.dg-print-filters').textContent.includes(GRID_TEST_CLIENT)).toBe(true);
  // A shared file still prints its other client; its column is not redundant.
  expect(doc.querySelector('tbody').textContent.includes(GRID_TEST_COCLIENT)).toBe(true);
  expect(Boolean(doc.querySelector('th[data-column="clientId"]'))).toBe(true);
 }));
 test('Print document — explicit file filter: context resolves the file, current case and original client',withFixture(async f=>{
  const {grid}=await fixtureGrid(f,'hearings');grid.applyReferenceFilter('fileId','f1');
  const doc=parse(await grid.getPrintDocument());
  expect(field(doc,'الموكل')).toBe(GRID_TEST_CLIENT);expect(field(doc,'رقم الملف / نوع الملف')).toBe('2/2026 — دعوى');
  expect(field(doc,'رقم الدعوى / القضية')).toBe('4661/2026');
 }));
 test('Grid reference filter UI: exact identity choice and multi-valued ID facets persist in the normal query',withFixture(async f=>{
  const {root,grid}=await fixtureGrid(f,'files',[f.rows.files[0],f.rows.files[1],f.rows.files[3]]);
  root.querySelector('th[data-key="clientId"] .dg-fbtn').click();
  let pop=document.querySelector('.dg-pop');const choice=pop.querySelector('.dg-ref-choice');
  choice.value='c1';choice.dispatchEvent(new Event('change',{bubbles:true}));pop.querySelector('.dg-apply').click();
  expect(grid.getQuery().filters.rules[0].v1).toBe('c1');expect(grid.getQuery().filters.rules[0].valueType).toBe('reference');
  grid.clearFilter('clientId');root.querySelector('th[data-key="clientId"] .dg-fbtn').click();pop=document.querySelector('.dg-pop');
  pop.querySelector('.dg-checknone').click();pop.querySelector('.dg-checks input[value="c2"]').click();pop.querySelector('.dg-apply').click();
  expect(grid.getQuery().filters.rules[0].set[0]).toBe('c2');expect(grid.getQuery().filters.rules[0].setValueType).toBe('reference');
  expect(grid.getView()[0].id).toBe('f4');expect((await grid.getPrintContext()).client.id).toBe('c2');
 }));
 test('Print document — no linked client/file: omit unavailable fields and leave unrelated tables alone',withFixture(async f=>{
  const {grid}=await fixtureGrid(f,'bailiffs');const doc=parse(await grid.getPrintDocument());
  expect(field(doc,'الموكل')).toBe('');expect(field(doc,'رقم الملف / نوع الملف')).toBe('');expect(field(doc,'رقم الدعوى / القضية')).toBe('');
  expect(doc.querySelectorAll('.dg-print-context dt').length).toBe(1);
  const fileGrid=(await fixtureGrid(f,'files',[f.rows.files[2]],{printContext:{fileId:'f3'}})).grid;
  const fileDoc=parse(await fileGrid.getPrintDocument());expect(field(fileDoc,'رقم الملف / نوع الملف')).toBe('9/2026 — استشارة');
  expect(field(fileDoc,'الموكل')).toBe('');expect(field(fileDoc,'رقم الدعوى / القضية')).toBe('');
  const unavailable=(await fixtureGrid(f,'files',[f.rows.files[3]],{printContext:{clientId:'missing-client-record',fileId:'f4',caseId:'missing-stage-record'}})).grid;
  const missingDoc=parse(await unavailable.getPrintDocument());
  expect(field(missingDoc,'الموكل')).toBe('');expect(field(missingDoc,'الموكلون')).toBe('');expect(field(missingDoc,'رقم الدعوى / القضية')).toBe('');
  expect(missingDoc.querySelector('th[data-column="clientId"]')!==null).toBe(true);
  expect(missingDoc.querySelector('tbody').textContent).toContain(GRID_TEST_COCLIENT);
 }));
 test('Print document — multi-client file: every original client is in context, without repeating an identical client column',withFixture(async f=>{
  const {grid}=await fixtureGrid(f,'hearings',[f.rows.hearings[2]],{printContext:{fileId:'f4'}});
  const doc=parse(await grid.getPrintDocument());expect(field(doc,'الموكلون')).toBe(`${GRID_TEST_CLIENT}، ${GRID_TEST_COCLIENT}`);
  expect(doc.querySelector('th[data-column="clientId"]')).toBe(null);
 }));
 test('Print document — multiple pages/virtual rows: all rows, one report context, repeatable thead CSS (not Print Preview)',withFixture(async f=>{
  const rows=Array.from({length:720},(_,index)=>({...f.rows.hearings[0],id:`long-${index}`,type:`صف ${index}`}));
  const {grid,root}=await fixtureGrid(f,'hearings',rows,{printContext:{fileId:'f1'}});
  expect(root.querySelectorAll('tbody tr[data-i]').length<720).toBe(true);
  const html=await grid.getPrintDocument(),doc=parse(html);
  expect(doc.querySelectorAll('tbody tr').length).toBe(720);expect(doc.querySelectorAll('.dg-print-header').length).toBe(1);
  expect(html.includes('thead{display:table-header-group}')).toBe(true);expect(doc.querySelector('script')).toBe(null);
 }));
 test('Print document — original record renamed after screen load: the header refreshes by clientId, not stale UI text',withFixture(async f=>{
  const {grid}=await fixtureGrid(f,'files',[f.rows.files[0]],{printContext:{clientId:'c1'}});
  const record=await f.office.r.clients.get('c1');await f.office.r.clients.put({...record,fullName:'الاسم الصحيح بعد التعديل'});
  const doc=parse(await grid.getPrintDocument());expect(field(doc,'الموكل')).toBe('الاسم الصحيح بعد التعديل');
  expect(doc.querySelector('tbody').textContent.includes('اسم موكل قديم')).toBe(false);
 }));
 test('Print context inference: conservative nested AND/OR; never infer from client-name text or target-file columns',()=>{
  const columns=defineGridColumns(legalFileColumns(null));
  const idRule={key:'clientId',op:'eq',v1:'c1',valueType:'reference'},other={key:'status',op:'eq',v1:'open'};
  expect(constrainedReferenceId(createGridQuery({filters:{logic:'and',rules:[idRule,other]}}),columns,'client')).toBe('c1');
  expect(constrainedReferenceId(createGridQuery({filters:{logic:'or',rules:[idRule,other]}}),columns,'client')).toBe(null);
  expect(constrainedReferenceId(createGridQuery({filters:{logic:'or',rules:[idRule,{logic:'and',rules:[idRule,other]}]}}),columns,'client')).toBe('c1');
  expect(constrainedReferenceId(createGridQuery({filters:[{key:'clientId',op:'eq',v1:GRID_TEST_CLIENT}]}),columns,'client')).toBe(null);
  expect(constrainedReferenceId(createGridQuery({filters:[{...idRule,key:'targetClientId'}]}),defineGridColumns(legalFileColumns(null,{side:'target',clientKey:'targetClientId'})),'client')).toBe(null);
  expect(gridPageContext('client:c1?tab=files').clientId).toBe('c1');expect(gridPageContext('case:ca1').caseId).toBe('ca1');
  expect(gridPageContext('rec:hearings:h1').entityId).toBe('h1');expect(Object.keys(gridPageContext('clients')).length).toBe(0);
 });
 test('Grid IDs/preferences: columns/order/widths/sort/filters/Saved Views are isolated and survive remount and print',withFixture(async f=>{
  const key=`context-files-${Date.now()}`,otherKey=`context-hearings-${Date.now()}`;
  try{
   const {root,grid}=await fixtureGrid(f,'files',[f.rows.files[0],f.rows.files[1]],{storageKey:key});
   const other=await fixtureGrid(f,'hearings',f.rows.hearings,{storageKey:otherKey});
   grid.applyReferenceFilter('clientId','c1');grid.sortBy('fileNumber','desc');
   root.querySelector('th[data-key="opponentId"] .dg-resizer').dispatchEvent(new document.defaultView.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
   root.querySelector('.dg-cols-btn').click();let pop=document.querySelector('.dg-pop');
   pop.querySelector('input[value="title"]').click();pop.querySelector('li[data-k="opponentId"] [data-mv="-1"]').click();pop.querySelector('.dg-x').click();
   root.querySelector('.dg-views-btn').click();pop=document.querySelector('.dg-pop');const form=pop.querySelector('form');
   const input=form.querySelector('[name="nm"]');input.value='عرض مستقل';if(!form.nm)form.nm=input;
   form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));pop.querySelector('.dg-x').click();
   const saved=JSON.stringify(prefs.get(`grid:${key}`));await grid.getPrintDocument();expect(JSON.stringify(prefs.get(`grid:${key}`))).toBe(saved);
   expect(prefs.get(`grid:${key}`).views[0].state.filters[0][1].v1).toBe('c1');
   expect(prefs.get(`grid:${otherKey}`)).toBe(null);expect(other.grid.getView().length).toBe(3);
   grid.clearFilter('clientId');root.querySelector('.dg-views-btn').click();document.querySelector('.dg-pop [data-vi="0"]').click();
   expect(grid.getView()[0].id).toBe('f1');expect(grid.getQuery().filters.rules[0].valueType).toBe('reference');
   const remount=await fixtureGrid(f,'files',[f.rows.files[0],f.rows.files[1]],{storageKey:key});
   expect(remount.grid.getGridId()).toBe(`grid:${key}`);expect(remount.grid.getView().length).toBe(1);
   expect(remount.root.querySelector('th[data-key="title"]')).toBe(null);expect(remount.root.querySelector('.dg-tools-view').textContent.includes('عرض مستقل')).toBe(true);
   expect(Boolean(prefs.get(`grid:${key}`).widths.opponentId)).toBe(true);
   const doc=parse(await remount.grid.getPrintDocument());expect(doc.querySelector('th[data-column="title"]')).toBe(null);
   expect(doc.querySelectorAll('col').length).toBe(doc.querySelectorAll('thead th').length);
  }finally{await prefs.remove(`grid:${key}`);await prefs.remove(`grid:${otherKey}`)}
 }));
 test('Grid export: all multi-party names appear in CSV/TXT/Excel/Word, safely escaped and in the selected columns',withFixture(async f=>{
  const {grid}=await fixtureGrid(f,'files',[f.rows.files[0],f.rows.files[3]]),blobs=[];
  const create=URL.createObjectURL,revoke=URL.revokeObjectURL;
  URL.createObjectURL=blob=>{blobs.push(blob);return create.call(URL,blob)};URL.revokeObjectURL=()=>{};
  try{
   for(const format of ['csv','txt','xls','doc'])await grid.exportData(format);
   const [csv,txt,xls,doc]=await Promise.all(blobs.map(blob=>blob.text()));
   for(const text of [csv,txt,xls,doc]){expect(text.includes(GRID_TEST_COCLIENT)).toBe(true);expect(text.includes('خصم تاريخي')).toBe(true);expect(text.includes('+4')).toBe(false)}
   expect(xls.includes('&lt;img')).toBe(true);expect(parse(doc).querySelector('img')).toBe(null);
  }finally{URL.createObjectURL=create;URL.revokeObjectURL=revoke}
 }));
 test('Grid provider: hydrate before filtering, keyset continuation across 100-row batches, no lost/duplicate rows',withFixture(async f=>{
  for(let i=0;i<130;i++)await f.office.r.hearings.put({id:`batch-${String(i).padStart(3,'0')}`,caseId:i%2?'ca2':'ca1',hearingDate:'2026-10-04',isDeleted:false});
  const relations=createGridRelations(f.office,'hearings'),refs=new Map(),columns=defineGridColumns(columnsFor('hearings',refs,{relations}));
  const provider=createEntityGridProvider(f.office,'hearings',{prepareRows:async(rows,{signal})=>{await Promise.all([relations.hydrate(rows,{signal}),resolveRefs(f.office,rows,ENTITIES.hearings.fields,refs)])}});
  let cursor=null;const ids=[];
  do{const result=await provider.getRows({filters:[{key:'clientId',op:'eq',v1:'c1',valueType:'reference'}],sort:[{key:'hearingDate',dir:'asc'}],pagination:{size:25,cursor}},{columns});
   result.rows.forEach(row=>{ids.push(row.id);expect(relations.items(row,'client').some(item=>item.id==='c1')).toBe(true)});
   cursor=result.nextCursor;if(!result.hasMore)break;
  }while(cursor);
  expect(ids.length).toBe(67);expect(new Set(ids).size).toBe(67);
  const sorted=await provider.getRows({sort:[{key:'clientId',dir:'asc'}]},{columns});expect(sorted.sortStatus.global).toBe(false);
 }));
 test('Grid provider — date-scoped ascending/descending cursors remain globally ordered across prepared batches',withFixture(async f=>{
  const ordered=await seedGridDateRows(f);
  const before=await f.snapshot(),relations=createGridRelations(f.office,'hearings'),refs=new Map(),columns=defineGridColumns(columnsFor('hearings',refs,{relations}));
  const provider=createEntityGridProvider(f.office,'hearings',{getBaseQuery:()=>({from:ordered[0].hearingDate,to:ordered.at(-1).hearingDate,dateField:'hearingDate'}),prepareRows:async rows=>{await Promise.all([relations.hydrate(rows),resolveRefs(f.office,rows,ENTITIES.hearings.fields,refs)])}});
  const plain=createIndexedDbDataProvider(f.office.r.hearings,{resolveScope:()=>({index:'hearingDate',lower:ordered[0].hearingDate,upper:ordered.at(-1).hearingDate+'\uffff',direction:'prev'})});
  for(const implementation of [provider,plain])for(const direction of ['asc','desc']){
   let cursor=null;const ids=[];
   do{
    const result=await implementation.getRows({sort:[{key:'hearingDate',dir:direction}],pagination:{size:25,cursor}},{columns});
    expect(result.sortStatus.global).toBe(true);ids.push(...result.rows.map(row=>row.id));cursor=result.nextCursor;
    if(!result.hasMore)break;
   }while(cursor);
   expect(ids.join(',')).toBe((direction==='asc'?ordered:[...ordered].reverse()).map(row=>row.id).join(','));
   expect(new Set(ids).size).toBe(230);
  }
  expect(await f.snapshot()).toBe(before);
 }));
 test('Grid provider/reports: original client/opponent names participate in outer search before the bounded limit',withFixture(async f=>{
  const relations=createGridRelations(f.office,'hearings'),refs=new Map(),columns=defineGridColumns(columnsFor('hearings',refs,{relations}));
  const prepareRows=async(rows,{signal})=>{await Promise.all([relations.hydrate(rows,{signal}),resolveRefs(f.office,rows,ENTITIES.hearings.fields,refs)])};
  const provider=createEntityGridProvider(f.office,'hearings',{getBaseQuery:()=>({q:'فاطمة محمد'}),prepareRows});
  const result=await provider.getRows({}, {columns});expect(result.rows.map(row=>row.id).sort().join(',')).toBe('h1,h4');
  const report=await loadRows(f.office,'hearings',{q:'خصم تاريخي',limit:1,columns,prepareRows});expect(report.rows[0].id).toBe('h1');
  const controller=new AbortController();controller.abort();let name='';try{await provider.getRows({}, {columns,signal:controller.signal})}catch(error){name=error.name}
  expect(name).toBe('AbortError');
 }));
 test('Print document — selected rows: current sort/filter/selection are not changed by document generation',withFixture(async f=>{
  const {grid,root}=await fixtureGrid(f,'hearings',f.rows.hearings,{printContext:{clientId:'c1'}});
  root.querySelector('.dg-rowchk[data-i="0"]').click();const before=JSON.stringify(grid.getQuery());
  const doc=parse(await grid.getPrintDocument({srcRows:grid.getSelection()}));expect(doc.querySelectorAll('tbody tr').length).toBe(1);
  expect(JSON.stringify(grid.getQuery())).toBe(before);expect(grid.getSelection().length).toBe(1);
  const clientOnly=await fixtureGrid(f,'hearings',[f.rows.hearings[0]],{printContext:{clientId:'c1'}});
  clientOnly.root.querySelector('.dg-cols-btn').click();const pop=document.querySelector('.dg-pop');
  [...pop.querySelectorAll('.dg-cols-list input')].forEach(input=>{if(input.value!=='clientId'&&input.checked)input.click()});pop.querySelector('.dg-x').click();
  const onlyDoc=parse(await clientOnly.grid.getPrintDocument());
  expect(onlyDoc.querySelectorAll('thead th').length).toBe(1);expect(onlyDoc.querySelector('tbody').textContent).toContain(GRID_TEST_CLIENT);
 }));
 test('Print selection — hidden/off-filter selections do not acquire false client/file context',withFixture(async f=>{
  const before=await f.snapshot(),{grid,root}=await fixtureGrid(f,'hearings');
  root.querySelector('.dg-rowchk[data-i="0"]').click();root.querySelector('.dg-rowchk[data-i="1"]').click();
  grid.applyReferenceFilter('clientId','c1');
  expect(grid.getView().length).toBe(2);expect(grid.getSelection().length).toBe(2);
  const query=JSON.stringify(grid.getQuery()),selected=grid.getSelection();
  const clientDoc=parse(await grid.getPrintDocument({srcRows:selected}));
  expect(field(clientDoc,'الموكل')).toBe('');expect(clientDoc.querySelectorAll('tbody tr').length).toBe(2);
  expect(clientDoc.querySelector('tbody').textContent).toContain('موكل آخر');
  expect(clientDoc.querySelector('.dg-print-filters').textContent).toContain('لا تُطبق مجددًا');
  expect(JSON.stringify(grid.getQuery())).toBe(query);expect(grid.getSelection().length).toBe(2);
  grid.clearFilter('clientId');grid.applyReferenceFilter('fileId','f1');
  const fileDoc=parse(await grid.getPrintDocument({srcRows:selected}));
  expect(field(fileDoc,'رقم الملف / نوع الملف')).toBe('');expect(field(fileDoc,'رقم الدعوى / القضية')).toBe('');
  expect(fileDoc.querySelectorAll('tbody tr').length).toBe(2);expect(await f.snapshot()).toBe(before);
 }));
 test('Print selection — cursor-page metadata is honest and source selections survive a new identity filter',withFixture(async f=>{
  const before=await f.snapshot(),rows=Array.from({length:31},(_,index)=>({...f.rows.hearings[index===25?1:0],id:`selected-${String(index).padStart(3,'0')}`}));
  const relations=createGridRelations(f.office,'hearings');await relations.hydrate(rows);
  const {grid,root}=await fixtureGrid(f,'hearings',[],{columns:columnsFor('hearings',new Map(),{relations}),dataProvider:createArrayDataProvider(rows),...relations.gridOptions()});
  const ready=async id=>{for(let i=0;i<100;i++){if(grid.getView()[0]?.id===id&&!root.querySelector('.dg-state.is-loading'))return;await pause(5)}throw Error('Cursor selection grid did not settle')};
  await ready('selected-000');expect(root.querySelector('.dg-provider-note').textContent).toContain('أوامر المحدد');
  root.querySelector('.dg-rowchk[data-i="0"]').click();root.querySelector('.dg-page-next').click();
  await ready('selected-025');root.querySelector('.dg-rowchk[data-i="0"]').click();
  const firstDoc=parse(await grid.getPrintDocument({srcRows:grid.getSelection()}));
  expect(firstDoc.querySelectorAll('tbody tr').length).toBe(2);expect(firstDoc.querySelector('.dg-print-meta').textContent).toContain('عبر الصفحات');
  expect(firstDoc.querySelector('.dg-print-meta').textContent.includes('الصفحة الحالية')).toBe(false);
  grid.applyReferenceFilter('clientId','c1');await ready('selected-000');
  const selected=grid.getSelection(),doc=parse(await grid.getPrintDocument({srcRows:selected}));
  expect(selected.map(row=>row.id).join(',')).toBe('selected-000,selected-025');
  expect(field(doc,'الموكل')).toBe('');expect(doc.querySelectorAll('tbody tr').length).toBe(2);
  expect(doc.querySelector('tbody').textContent).toContain('موكل آخر');expect(await f.snapshot()).toBe(before);
 }));
 test('Print selection — identical names with different IDs never make an off-filter selection look scoped',withFixture(async f=>{
  const {grid,root}=await fixtureGrid(f,'files',[f.rows.files[0],f.rows.files[6]]);
  root.querySelector('.dg-rowchk[data-i="0"]').click();root.querySelector('.dg-rowchk[data-i="1"]').click();grid.applyReferenceFilter('clientId','c1');
  expect(grid.getView().length).toBe(1);expect(grid.getSelection().length).toBe(2);
  const doc=parse(await grid.getPrintDocument({srcRows:grid.getSelection()}));
  expect(field(doc,'الموكل')).toBe('');expect(doc.querySelectorAll('tbody tr').length).toBe(2);
  expect(doc.querySelector('th[data-column="clientId"]')!==null).toBe(true);
 }));
 test('Print context — fresh original party membership is checked before accepting a filter-derived header',withFixture(async f=>{
  const {grid}=await fixtureGrid(f,'files',[f.rows.files[3]]);grid.applyReferenceFilter('clientId','c1');
  const old=f.rows.fileParties.find(party=>party.id==='p-c4a');await f.office.r.fileParties.put({...old,isDeleted:true});
  const before=await f.snapshot(),doc=parse(await grid.getPrintDocument());
  expect(field(doc,'الموكل')).toBe('');expect(doc.querySelector('tbody').textContent).toContain(GRID_TEST_COCLIENT);
  expect(doc.querySelector('tbody').textContent.includes(GRID_TEST_CLIENT)).toBe(false);expect(await f.snapshot()).toBe(before);
 }));
 test('Print pipeline: popup opens synchronously, one valid print script, and blocked/stale contexts do not print',withFixture(async f=>{
  const {grid}=await fixtureGrid(f,'files',[f.rows.files[0]],{printContext:{fileId:'f1'}});
  const originalOpen=window.open,originalAlert=globalThis.alert;let opened=false,closed=false,html='',alerted=false;
  window.open=()=>{opened=true;return {closed:false,document:{open(){},write(text){html=text},close(){}},close(){closed=true}}};globalThis.alert=()=>{alerted=true};
  try{
   const printing=grid.print();expect(opened).toBe(true);expect(await printing).toBe(true);
   expect(html.includes('window.print()')).toBe(true);expect(html.includes('</script>')).toBe(true);expect(html.includes('<\\/script>')).toBe(false);
   window.open=()=>null;expect(await grid.print()).toBe(false);expect(alerted).toBe(true);
   window.open=()=>({closed:false,document:{open(){},write(){},close(){}},close(){closed=true}});
   f.ctx.close();expect(await grid.print()).toBe(false);expect(closed).toBe(true);
  }finally{window.open=originalOpen;globalThis.alert=originalAlert}
 }));
 test('Grid data integrity: screen/query/print/export are read-only for all stores, IDs, links and the current schema version',withFixture(async f=>{
  const before=await f.snapshot();
  for(const store of ['clients','files','hearings','procedures','judgments','fileParties','fileRelations','communications','powersOfAttorney','feePayments']){
   const {grid}=await fixtureGrid(f,store);grid.sortBy(grid.getVisibleColumns()[0].key);await grid.getPrintDocument();await grid.docHtml();
  }
  expect(await f.snapshot()).toBe(before);expect(f.db.version).toBe(SCHEMA_VERSION);
  expect(Object.keys(f.rows.files[0]).includes('clientName')).toBe(false);
 }));
}
