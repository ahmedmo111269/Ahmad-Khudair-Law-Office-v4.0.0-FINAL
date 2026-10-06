// تشغيل كل مجموعات الاختبار داخل Node (بدون متصفح) عبر fake-indexeddb + linkedom.
import './harness.mjs';
const R=new URL('../../js',import.meta.url).href;
const {test,expect,run}=await import(`${R}/tests/runner.js`);
const {normalizeArabic,normalizeDigits}=await import(`${R}/core/search-normalizer.js`);
const {validateClient}=await import(`${R}/domain/validators.js`);
const {formatDate,formatDateTime,parseDisplayDate}=await import(`${R}/core/format.js`);
const {contrast,PRESETS,normalize}=await import(`${R}/ui/theme.js`);
const {pagingState,nextPage,prevPage,applyPageResult,currentCursor}=await import(`${R}/ui/pagination.js`);
const {localDate,addDays,isActiveProcedure}=await import(`${R}/core/clock.js`);

const {runTransactionTests}=await import(`${R}/tests/transaction-tests.js`);
const {runClientFileTests}=await import(`${R}/tests/client-file-tests.js`);
const {runServiceAndRelationsTests}=await import(`${R}/tests/service-and-relations-tests.js`);
const {runBackupAndIntegrityTests}=await import(`${R}/tests/backup-and-integrity-tests.js`);
const {runUxTests}=await import(`${R}/tests/ux-tests.js`);
const {runSearchTableTests,runGridUpgradeTests}=await import(`${R}/tests/search-table-tests.js`);
const {runFileNumberTests}=await import(`${R}/tests/file-number-tests.js`);
const {runCardSidebarTests}=await import(`${R}/tests/card-sidebar-tests.js`);
const {runTopNavTests}=await import(`${R}/tests/topnav-tests.js`);
const {runDemoSeedTests}=await import(`${R}/tests/demo-seed-tests.js`);
const {runDemoCleanupTests}=await import(`${R}/tests/demo-cleanup-tests.js`);
const {runCollapseStateTests}=await import(`${R}/tests/collapse-state-tests.js`);
const {runGridProviderTests}=await import(`${R}/tests/grid-provider-tests.js`);
const {runDisplayPrefsTests}=await import(`${R}/tests/display-prefs-tests.js`);
const {runComponentStyleTests}=await import(`${R}/tests/component-style-tests.js`);
const {runGridContextTests}=await import(`${R}/tests/grid-context-tests.js`);
const {runWorkCenterTests}=await import(`${R}/tests/work-center-tests.js`);
const {runExecutionTests}=await import(`${R}/tests/execution-tests.js`);
const {runExecutionSimpleTests,runExecutionCardTests,runExecutionPrintDocumentTests,runExecutionSupersedeTests}=await import(`${R}/tests/execution-simple-tests.js`);
const {runExecutionUiTests}=await import(`${R}/tests/execution-ui-tests.js`);
const {runSyncTests}=await import(`${R}/tests/sync-tests.js`);
const {runQuickNotesTests}=await import(`${R}/tests/quick-notes-tests.js`);
const {runPwaTests}=await import(`${R}/tests/pwa-tests.js`);

test('Date format DD/MM/YYYY',()=>expect(formatDate('2026-09-28')).toBe('28/09/2026'));
test('Date parse from DD/MM/YYYY',()=>expect(parseDisplayDate('5/9/2026')).toBe('2026-09-05'));
test('Invalid date rejected',()=>expect(parseDisplayDate('31/02/2026')).toBe(''));
test('Arabic digit date',()=>expect(parseDisplayDate('٢٨/٠٩/٢٠٢٦')).toBe('2026-09-28'));
test('DateTime format',()=>expect(formatDateTime(new Date(2026,8,28,9,5))).toBe('28/09/2026 09:05'));
test('Themes meet WCAG AA text contrast',()=>{for(const p of Object.values(PRESETS)){if(contrast(p.c.text,p.c.surface)<4.5||contrast(p.c.textMuted,p.c.surface)<4.5)throw Error(p.name)}});
test('Theme config normalizes unknown preset',()=>expect(normalize({preset:'x'}).preset).toBe('luxuryGold'));
test('Arabic normalization',()=>expect(normalizeArabic('أحمد ـ إكرام')).toBe('احمد اكرام'));
test('Arabic digits',()=>expect(normalizeDigits('١٢٣')).toBe('123'));
test('national id validation',()=>expect(Object.keys(validateClient({fullName:'أحمد',nationalId:'123'})).length).toBe(1));
test('valid client',()=>expect(Object.keys(validateClient({fullName:'أحمد',nationalId:'12345678901234'})).length).toBe(0));
test('cursor stack paging',()=>{const s=pagingState();applyPageResult(s,{nextCursor:'c2',hasMore:true});expect(nextPage(s)).toBe(true);expect(currentCursor(s)).toBe('c2');applyPageResult(s,{nextCursor:null,hasMore:false});expect(nextPage(s)).toBe(false);expect(prevPage(s)).toBe(true);expect(currentCursor(s)).toBe(null);expect(prevPage(s)).toBe(false)});
test('local date helpers',()=>{expect(localDate(new Date(2026,0,31))).toBe('2026-01-31');expect(addDays('2026-02-28',1)).toBe('2026-03-01')});
test('open procedures are active',()=>{expect(isActiveProcedure({status:'open'})).toBe(true);expect(isActiveProcedure({status:'pending'})).toBe(true);expect(isActiveProcedure({status:'done'})).toBe(false)});

await runTransactionTests(test,expect);
await runClientFileTests(test,expect);
await runServiceAndRelationsTests(test,expect);
await runBackupAndIntegrityTests(test,expect);
await runUxTests(test,expect);
await runFileNumberTests(test,expect);
await runCardSidebarTests(test,expect);
await runTopNavTests(test,expect);
try{await runSearchTableTests(test,expect)}catch(e){test('search-table suite import/setup',()=>{throw e})}
try{await runGridUpgradeTests(test,expect)}catch(e){test('grid-upgrade suite import/setup',()=>{throw e})}
await runDemoSeedTests(test,expect);
await runDemoCleanupTests(test,expect);
await runCollapseStateTests(test,expect);
await runGridProviderTests(test,expect);
runDisplayPrefsTests(test,expect);
runComponentStyleTests(test,expect);
runGridContextTests(test,expect);
await runWorkCenterTests(test,expect);
await runExecutionTests(test,expect);
await runExecutionSimpleTests(test,expect);
await runExecutionCardTests(test,expect);
await runExecutionPrintDocumentTests(test,expect);
await runExecutionSupersedeTests(test,expect);
await runExecutionUiTests(test,expect);
await runSyncTests(test,expect);
await runQuickNotesTests(test,expect);
await runPwaTests(test,expect);

const r=await run();
for(const [status,name,msg] of r.results){
 if(status==='FAIL')console.log(`FAIL — ${name}${msg?' — '+msg:''}`);
}
console.log(`\n${r.passed}/${r.total} اختبارًا ناجحًا (${r.failed} فشل)`);
process.exit(r.failed?1:0);
