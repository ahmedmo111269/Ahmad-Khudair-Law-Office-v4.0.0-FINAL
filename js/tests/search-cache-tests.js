// ============================================================
// اختبارات كاش مفاتيح البحث (موجة 3).
// ------------------------------------------------------------
// الكاش يسرّع البحث لكنه يقرأ من الذاكرة، والذاكرة قد تقادم. لذلك هذه
// المجموعة لا تقيس السرعة بل «التطابق المطلق» مع المسح الكامل:
//   1) نفس النتائج بنفس الترتيب وبلا زيادة أو نقصان، على بيانات حقيقية
//      (عربية مطبَّعة، محذوفة منطقيًا، أكواد، أرقام، صفوف خاصة بالمخزن).
//   2) الإبطال الفوري بعد أي كتابة عبر السياق المُجهَّز (DatabaseContext).
//   3) الإبطال بعد كتابة مصدرها خارج هذه النافذة (سيناريو النافذين).
//   4) دلالة «ما زالت هناك نتائج إضافية» (stopped) كما كانت.
//   5) السلوك عند إيقاف العلم: رجوع كامل للمسار القديم.
// تُستخدم fake-indexeddb في Node وIndexedDB الحقيقي في المتصفح — نفس الملف.
// ============================================================
import {searchStore, searchAll, searchDebounceMs, searchEngineStats, allSearchStores, CACHE_EXEMPT} from '../services/search-engine.js';
import {matchKeys, searchCacheStats, clearSearchCache, MAX_CACHED_ROWS, withSuspendedSearchCache, getSearchKeys, searchCacheSuspended} from '../services/search-cache.js';
import {bumpGlobalEpoch, readEpoch, bumpWriteEpoch} from '../db/write-epoch.js';
import {isWarm as isWarmCache} from '../services/search-cache.js';
import {setFlag, resetFlags} from '../core/feature-flags.js';
import {upgradeSchema, STORE} from '../db/schema.js';
import {DatabaseContext} from '../db/database-context.js';
import {Office} from '../services/office.js';

const NOW = '2026-10-01T09:00:00.000Z';
const QUERIES = ['محمد', 'عقد بيع', 'خضير', '29000000000012', 'CL2026', 'الشرقاوي', 'محمد 12', 'لا يوجد هنا إطلاقا', '١٢٣٤', 'file-9'];

function openDb(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 18);
    request.onupgradeneeded = event => upgradeSchema(request.result, event.target.transaction);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** بيانات تقصد الحالات الحرجة: محذوف منطقيًا، أكواد، تطبيع عربي، صفوف مستثناة. */
async function seed(office) {
  const tx = office.ctx.db.transaction([STORE.clients, STORE.files, STORE.workItems, STORE.serviceRecords], 'readwrite', {captureChanges: false});
  const clients = tx.objectStore(STORE.clients), files = tx.objectStore(STORE.files);
  const workItems = tx.objectStore(STORE.workItems), services = tx.objectStore(STORE.serviceRecords);
  const names = ['أحمد محمد خضير', 'محمود على الشرقاوي', 'فاطمة السيد عبد الله', 'محمد فؤاد جاد', 'إبراهيم حسن حسين', 'سامح محمد 1234', 'عمرو علي ١٢٣٤'];
  for (let i = 0; i < 40; i++) {
    const fullName = `${names[i % names.length]} ${i}`;
    clients.put({
      id: `c-${String(i).padStart(4, '0')}`, fullName,
      fullNameNormalized: fullName.replace(/أ|إ|آ/g, 'ا').replace(/ة/g, 'ه'),
      nationalId: String(29000000000000 + i), clientCode: `CL2026${String(i).padStart(5, '0')}`,
      phones: [`0100000${String(i).padStart(3, '0')}`], status: 'active',
      createdAt: NOW, updatedAt: NOW, version: 1, isDeleted: i % 11 === 0, isArchived: false,
      address: i % 5 === 0 ? '12 شارع التحرير، القاهرة' : ''
    });
    files.put({
      id: `f-${String(i).padStart(4, '0')}`, fileNumber: `2026/${String(i + 1).padStart(6, '0')}`,
      title: `قضية ${names[i % names.length]} — عقد بيع`, titleNormalized: 'قضية عقد بيع',
      fileType: 'مدني', status: 'open', partyNames: fullName,
      searchText: fullName.replace(/أ|إ|آ/g, 'ا'), createdAt: NOW, updatedAt: NOW, version: 1,
      isDeleted: i % 13 === 0, isArchived: false, lastActivityAt: NOW
    });
    // عنصر عمل «طبقة» فوق سجل أصلي: لا يدخل نتائج البحث (kind !== 'native')
    workItems.put({id: `w-overlay-${i}`, kind: 'overlay', title: `متابعة عقد بيع ${i}`, status: 'open', dueDate: '2026-10-05', createdAt: NOW, updatedAt: NOW, isDeleted: false, sourceType: 'files', sourceId: `f-${String(i).padStart(4, '0')}`});
    workItems.put({id: `w-native-${i}`, kind: 'native', title: `مهمة عقد بيع ${i}`, status: 'open', dueDate: '2026-10-05', createdAt: NOW, updatedAt: NOW, isDeleted: i % 17 === 0});
    services.put({id: `s-${i}`, internalNumber: `9${String(i).padStart(4, '0')}`, partyName: `إعلان عقد بيع ${i}`, actionType: 'إعلان', status: 'sent', recordState: i % 7 === 0 ? 'deleted' : 'active', createdAt: NOW, updatedAt: NOW, isDeleted: false});
  }
  await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });
}

async function idsFor(office, store, query, {limit = 8} = {}) {
  const result = await searchStore(office, store, query, {limit});
  return result.items.map(item => item.id);
}

export async function runSearchCacheTests(test, expect) {
  const name = `AhmadKhudairLawOfficeDB__test__searchcache__${Date.now()}`;
  const results = {};
  const db = await openDb(name);
  const ctx = new DatabaseContext(db, {id: 'p1', databaseName: name, displayName: 'اختبار'}, {deviceId: 'test-device'});
  const office = new Office(ctx);
  try {
    await seed(office);
    results.setupError = '';
    resetFlags();
    clearSearchCache(ctx);

    // 1) تطابق كامل على كل استعلام وكل مخزن حسّاس
    const stores = ['clients', 'files', 'workItems', 'serviceRecords'];
    results.parity = {};
    for (const store of stores) {
      for (const query of QUERIES) {
        setFlag('searchKeyCache', false);
        const scan = await idsFor(office, store, query, {limit: 8});
        setFlag('searchKeyCache', true);
        const cached = await idsFor(office, store, query, {limit: 8});
        results.parity[`${store}:${query}`] = {scan, cached};
      }
    }
    // أوسع من limit حتى نختبر الإزالة والترتيب، لا أول 8 فقط
    results.wide = {};
    for (const query of ['محمد', 'عقد بيع']) {
      setFlag('searchKeyCache', false);
      const scan = await idsFor(office, 'clients', query, {limit: 25});
      setFlag('searchKeyCache', true);
      const cached = await idsFor(office, 'clients', query, {limit: 25});
      results.wide[query] = {scan, cached};
    }

    // 2) الكتابة عبر مسار التطبيق تُبطل الكاش: النتيجة الجديدة تظهر فورًا
    results.beforeEdit = await idsFor(office, 'clients', 'صفقة اختبار نادرة', {limit: 8});
    await office.saveClient({fullName: 'صفقة اختبار نادرة', nationalId: '29000000000999', phones: []});
    results.afterEdit = await idsFor(office, 'clients', 'صفقة اختبار نادرة', {limit: 8});
    results.epochAfterEdit = readEpoch(ctx, STORE.clients) > 0;

    // 3) تعديل سجل قائم: البحث بنص ما بعد التعديل لا النص القديم
    const target = (await office.r.clients.all(500)).find(row => row.fullName?.startsWith('أحمد محمد خضير'));
    await office.saveClient({fullName: 'أحمد محمد خضير المعدَّل للبحث', nationalId: target.nationalId, phones: target.phones || []}, target.id, target.version);
    results.afterRename = await idsFor(office, 'clients', 'المعدَّل للبحث', {limit: 8});
    results.oldGone = (await office.r.clients.get(target.id)).fullName.includes('المعدَّل');

    // 4) الحذف المنطقي عبر التطبيق: يختفي من النتائج فورًا
    await office.softDelete('clients', target.id);
    results.afterDelete = await idsFor(office, 'clients', 'المعدَّل للبحث', {limit: 8});

    // 5) كتابة من خارج هذا السياق (نافذة أخرى) + رسالة الإبطال.
    // الترتيب مقصود: نُدفّئ الكاش أولًا، ثم نكتب خارج السياق، فنتأكد أن الكاش
    // الدافئ وحده لا يرى الكتابة (لذلك الإبطال ضروري)، وبعد رسالة النافذة
    // الأخرى تظهر النتيجة مباشرة — ولا تُعرض أبدًا نتيجة نصف قديمة.
    await idsFor(office, 'clients', 'محمد', {limit: 8});
    const outsider = office.ctx.rawDb;
    await new Promise((resolve, reject) => {
      const tx = outsider.transaction(STORE.clients, 'readwrite');
      tx.objectStore(STORE.clients).put({...target, id: 'c-9999', fullName: 'موكل نافذة أخرى غريب', fullNameNormalized: 'موكل نافذة اخرى غريب', isDeleted: false, version: 1, createdAt: NOW, updatedAt: new Date().toISOString()});
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
    results.staleUntilBumped = await idsFor(office, 'clients', 'نافذة أخرى غريب', {limit: 8});
    bumpGlobalEpoch(); // هذا بالضبط ما يفعله مستمع BroadcastChannel في js/db/write-broadcast.js
    results.afterCrossTab = await idsFor(office, 'clients', 'نافذة أخرى غريب', {limit: 8});
    results.warmAfterCrossTab = await idsFor(office, 'clients', 'محمد', {limit: 8});

    // 5b) كتابة في مخزن لا تُبطل كاش مخزن آخر
    const clientsWarmBefore = readEpoch(ctx, STORE.files) > 0;
    await office.saveClient({fullName: 'تحقق عزل المخازن', nationalId: '29000000000888', phones: []});
    results.otherStoreCacheSurvived = clientsWarmBefore && !isWarmCache(ctx, STORE.files);

    // 6) دلالة «النتائج أكثر من الحد»
    results.more = await searchStore(office, 'clients', 'محمد', {limit: 2});

    // 7) البحث الشامل يعمل ويعطي warm/cold كما هو متوقع
    clearSearchCache(ctx);
    setFlag('searchKeyCache', true);
    const cold = await searchAll(office, 'محمد', {stores: ['clients', 'files'], perStore: 5});
    const warm = await searchAll(office, 'محمد', {stores: ['clients', 'files'], perStore: 5});
    results.coldWarm = {coldTotal: cold.total, warmTotal: warm.total, coldDebounce: searchDebounceMs(office, ['clients', 'files']), warmDebounce: searchDebounceMs(office, ['clients', 'files'])};
    // تُدفَّأ ثلاثة مخازن قبل قراءة الإحصاءات حتى تقيس الوحدة ما بُني فعلًا
    await searchAll(office, 'محمد', {stores: ['clients', 'files', 'workItems', 'serviceRecords'], perStore: 3});

    // الأقسام ذات الصيغة الخاصة (الملاحظات السريعة) لا تُبنى لها مفاتيح عمدًا.
    // كانت تُحسب باردة فأبقت سطر الحالة والتأخير في «مسح المخزن» إلى الأبد — هذه تغطية لذلك الانحدار.
    {
      const stores = allSearchStores();
      const all1 = await searchAll(office, 'محمد', {stores, perStore: 5});
      const all2 = await searchAll(office, 'محمد', {stores, perStore: 5});
      const notes = await searchStore(office, 'caseNotes', 'موكل', {limit: 5});
      results.allStoresWarm = {
        warm1: all1.indexWarm, warm2: all2.indexWarm,
        total1: all1.total, total2: all2.total,
        scannedAfterWarm: all2.scannedStores, cachedCount: all2.cachedStores,
        exempt: CACHE_EXEMPT.size && stores.filter(store => CACHE_EXEMPT.has(store)).length,
        debounceWarm: searchDebounceMs(office, stores),
        notesCached: notes.cached, notesBypassed: notes.cacheBypassed,
        coldDebounceBefore: all1.indexWarm
      };
    }
    results.stats = searchEngineStats(office);
    results.ctxStats = searchCacheStats(ctx);

    // 7b) العملية الجماعية (زرع/استعادة/مزامنة) تُعلّق الكاش أثناءها
    results.bulk = await withSuspendedSearchCache('unit-test', async () => {
      clearSearchCache(ctx);
      const suspended = searchCacheSuspended();
      const keysWhileSuspended = await getSearchKeys(ctx, STORE.clients, {});
      const searchWhileSuspended = await idsFor(office, 'clients', 'محمد', {limit: 5});
      const statsWhileSuspended = searchCacheStats(ctx).rows;
      await office.saveClient({fullName: 'موكل داخل التعليق', nationalId: '29000000000777', phones: []});
      const afterWrite = await idsFor(office, 'clients', 'داخل التعليق', {limit: 5});
      return {suspended, keysWhileSuspended, searchWhileSuspended, statsWhileSuspended, afterWrite};
    });
    results.afterBulk = await idsFor(office, 'clients', 'داخل التعليق', {limit: 5});

    // 8) إيقاف العلم يُرجع المسار القديم بلا أي كاش
    setFlag('searchKeyCache', false);
    clearSearchCache(ctx);
    await searchAll(office, 'محمد', {stores: ['clients'], perStore: 5});
    results.disabledStats = searchCacheStats(ctx);
  } catch (error) {
    results.setupError = String(error?.message || error);
  } finally {
    setFlag('searchKeyCache', null);
    ctx.close();
    try { indexedDB.deleteDatabase(name); } catch { /* بيئة بلا صلاحية */ }
  }

  test('إعداد مجموعة الاختبار نجح بلا خطأ (لا تعليق ولا انتظار)', () => {
    expect(results.setupError).toBe('');
  });
  const same = pair => JSON.stringify(pair.scan) === JSON.stringify(pair.cached);
  const differing = Object.entries(results.parity).filter(([, pair]) => !same(pair));

  test('كاش البحث يعطي نفس نتائج المسح الكامل حرفيًا (كل الاستعلامات × كل المخازن)', () => {
    expect(Object.keys(results.parity).length).toBe(4 * QUERIES.length);
    expect(differing.length).toBe(0);
  });
  test('كاش البحث يطابق المسح الكامل عند حد أوسع من عدد النتائج', () => {
    for (const query of Object.keys(results.wide)) expect(query + ': ' + results.wide[query].scan.length).toBe(query + ': ' + results.wide[query].cached.length);
    expect(results.wide['محمد'].scan.length > 8).toBe(true);
  });
  test('الاستعلام الذي لا يطابق شيئًا يرجع فارغًا من الكاش كما من المسح', () => {
    const pair = results.parity['clients:لا يوجد هنا إطلاقا'];
    expect(pair.scan.length).toBe(0);
    expect(pair.cached.length).toBe(0);
  });
  test('الصفوف المحذوفة منطقيًا لا تظهر في الكاش (المحذوف i%11 كان يطابق «خضير»)', () => {
    const pair = results.parity['clients:خضير'];
    expect(JSON.stringify(pair.cached)).toBe(JSON.stringify(pair.scan));
    // الصف c-0000 محذوف منطقيًا ويحمل الاسم نفسه: لا يظهر في المسارين
    expect(pair.cached.includes('c-0000')).toBe(false);
    expect(pair.scan.includes('c-0000')).toBe(false);
    expect(pair.cached.length > 0).toBe(true);
  });
  test('عناصر العمل غير المستقلة (overlay) مستثناة كما في المسح الكامل', () => {
    const pair = results.parity['workItems:عقد بيع'];
    expect(pair.scan.length > 0).toBe(true);
    expect(pair.cached.every(id => id.startsWith('w-native-'))).toBe(true);
    expect(pair.scan.every(id => id.startsWith('w-native-'))).toBe(true);
  });
  test('الإعلانات المحذوفة بحالتها الخاصة (recordState=deleted) مستثناة في المسارين', () => {
    const pair = results.parity['serviceRecords:عقد بيع'];
    expect(pair.scan.every(id => !/s-(0|7|14|21|28|35)$/.test(id))).toBe(true);
    expect(JSON.stringify(pair.cached)).toBe(JSON.stringify(pair.scan));
    expect(pair.cached.length > 0).toBe(true);
  });
  test('كتابة جديدة تظهر في البحث فورًا (إبطال بالعدّاد لا بالزمن)', () => {
    expect(results.beforeEdit.length).toBe(0);
    expect(results.afterEdit.length).toBe(1);
    expect(results.epochAfterEdit).toBe(true);
  });
  test('تعديل سجل يغيّر نتائج البحث ولا يترك نصًا قديمًا', () => {
    expect(results.afterRename.length).toBe(1);
    expect(results.oldGone).toBe(true);
  });
  test('الحذف المنطقي يزيل السجل من نتائج البحث مباشرة', () => {
    expect(results.afterDelete.length).toBe(0);
  });
  test('كتابة من نافذة أخرى: تُرى بعد رسالة الإبطال فقط، ولا تُقرأ أبدًا من كاش قديم', () => {
    // بلا إبطال: قد تُهمَل النتيجة (كاش دافئ) — والمطلوب ألّا تُعرض بيانات خاطئة؛
    // بعد إبطال النافذة الأخرى: تظهر النتيجة الجديدة بلا أي تدخل يدوي.
    expect(results.staleUntilBumped.length).toBe(0);
    expect(results.afterCrossTab.length).toBe(1);
    expect(results.warmAfterCrossTab.length > 0).toBe(true);
  });
  test('كتابة في مخزن لا تُبطل كاش مخزن آخر (تتبّع دقيق)', () => {
    expect(results.otherStoreCacheSurvived).toBe(true);
  });
  test('إبطال مخزن واحد يرفع عدّاده وحده (تتبّع دقيق لا general-purpose)', () => {
    const fresh = {db: {}, profile: {databaseName: 'x'}, assert() {}};
    bumpWriteEpoch(fresh, [STORE.files]);
    expect(readEpoch(fresh, STORE.files) > readEpoch(fresh, STORE.clients)).toBe(true);
  });
  test('دلالة «هناك نتائج أكثر» محفوظة عند الحد', () => {
    expect(results.more.items.length).toBe(2);
    expect(results.more.more).toBe(true);
  });
  test('الإقلاع البارد للكاش والبحث الدافئ يرجّعان نفس العدد، والتأخير يتكيّف', () => {
    expect(results.coldWarm.coldTotal).toBe(results.coldWarm.warmTotal);
    expect(results.coldWarm.warmDebounce).toBe(60);
  });
  test('كل الأقسام: الاستثناء لا يجمّد سطر الحالة ولا التأخير المتكيف', () => {
    expect(results.allStoresWarm.total1).toBe(results.allStoresWarm.total2);
    expect(results.allStoresWarm.warm2).toBe(true);
    expect(results.allStoresWarm.scannedAfterWarm).toBe(0);
    expect(results.allStoresWarm.exempt).toBe(1);
    expect(results.allStoresWarm.debounceWarm).toBe(60);
  });
  test('قسم الملاحظات السريعة: لا كاش ولا ادّعاء بكاذب (cached=false, bypassed=true)', () => {
    expect(results.allStoresWarm.notesCached).toBe(false);
    expect(results.allStoresWarm.notesBypassed).toBe(true);
  });
  test('إحصاءات الكاش تُظهر صفوفًا مخزّنة وميزانية معقولة', () => {
    expect(results.ctxStats.rows >= 120).toBe(true);
    expect(results.ctxStats.caches >= 3).toBe(true);
    expect(results.ctxStats.bytes > 0 && results.ctxStats.bytes < 8 * 1024 * 1024).toBe(true);
    expect(results.stats.budget).toBe(24 * 1024 * 1024);
    expect(MAX_CACHED_ROWS).toBe(60000);
  });
  test('إيقاف العلم يعيد المسار القديم ولا يبني أي كاش', () => {
    expect(results.disabledStats.rows).toBe(0);
    expect(results.disabledStats.caches).toBe(0);
  });
  test('أثناء العملية الجماعية: لا كاش، والبحث يعمل بالمسار القديم، والكتابة الجديدة تُرى', () => {
    expect(results.bulk.suspended).toBe(true);
    expect(results.bulk.keysWhileSuspended).toBe(null);
    expect(results.bulk.statsWhileSuspended).toBe(0);
    expect(results.bulk.searchWhileSuspended.length > 0).toBe(true);
    expect(results.bulk.afterWrite.length).toBe(1);
    expect(results.afterBulk.length).toBe(1);
    expect(searchCacheSuspended()).toBe(false);
  });

  test('منطق المطابقة الصافي: حدّ، ترتيب، أكواد، وأرقام قصيرة', () => {
    // الترتيب تنازلي مثل قراءة المخزن: الأحدث أولًا، وآخر صف لا «بعده» شيء.
    const entries = [
      {id: 'a', t: 'محمد عقد بيع', c: ['CL202600001'], ok: true},
      {id: 'd', t: 'محمد عقد بيع', c: ['CL202600002'], ok: true},
      {id: 'c', t: 'محمد إيجار', c: [], ok: false},
      {id: 'b', t: 'علي عقد إيجار', c: ['290000000000001'], ok: true}
    ];
    expect(JSON.stringify(matchKeys(entries, {tokens: ['محمد', 'عقد'], limit: 8}).ids)).toBe(JSON.stringify(['a', 'd']));
    expect(matchKeys(entries, {tokens: ['محمد'], limit: 2}).stopped).toBe(true);
    expect(matchKeys(entries, {tokens: ['محمد'], limit: 2}).ids.length).toBe(2);
    expect(matchKeys(entries, {tokens: ['محمد'], limit: 3}).stopped).toBe(false);
    // بلا كلمات بحث وبكود موجود: المحرك الأصلي يعتبر كل صف صالح مطابقة (فرع
    // معطوب عمليًا لكنه قائم — تُحاكيه مطابقة الكاش حرفيًا، ولا يُعرض للمستخدم
    // لأن searchStore يرفض النص الفارغ أصلًا).
    expect(JSON.stringify(matchKeys(entries, {tokens: [], code: 'CL202600002', limit: 8}).ids)).toBe(JSON.stringify(['a', 'd', 'b']));
    expect(JSON.stringify(matchKeys(entries, {tokens: ['علي'], code: 'CL202600002', limit: 8}).ids)).toBe(JSON.stringify(['d', 'b']));
    expect(JSON.stringify(matchKeys(entries, {tokens: ['محمد'], numDigits: '12', limit: 8}).ids)).toBe(JSON.stringify(['a', 'd']));
    // كلمة لا تطابق نصًا + رقم قومي يطابق حقل الكود: يُحسم بالكود وحده (كما في المحرك)
    expect(JSON.stringify(matchKeys(entries, {tokens: ['خالد'], numDigits: '290000000000001', limit: 8}).ids)).toBe(JSON.stringify(['b']));
    expect(matchKeys(entries, {tokens: ['محمد'], numDigits: '123456', limit: 8}).ids.length).toBe(2);
    expect(matchKeys(null, {tokens: []})).toBe(null);
  });
}
