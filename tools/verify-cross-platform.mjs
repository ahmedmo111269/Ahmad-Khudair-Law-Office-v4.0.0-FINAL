// ============================================================
// بوابة الجاهزية متعددة المنصات — PWA / Android (TWA・APK) / Desktop (EXE)
// ------------------------------------------------------------
// لا يفتح متصفحًا ولا يغلّف شيئًا: يفحص ما يطلبه PWABuilder وBubblewrap و
// Electron/TWA فعليًا في ملفات المستودع، ويُصدر قرارًا آليًا لكل بند.
// الهدف: قبل التغليف لا يجب أن يكون «أظن أن الكاش تمام»، بل «الفحص مرّ».
//
// التشغيل (من جذر المستودع):
//   node tools/verify-cross-platform.mjs          # تقرير مقروء
//   node tools/verify-cross-platform.mjs --json   # للمكينة/CI
//   node tools/verify-cross-platform.mjs --strict # التحذير يُفشل الخروج أيضًا
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {bootModuleGraph} from './module-graph.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const strict = process.argv.includes('--strict');
const asJson = process.argv.includes('--json');
const results = [];
const read = rel => { try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch { return null; } };
const exists = rel => fs.existsSync(path.join(ROOT, rel));
const add = (level, area, name, detail = '') => results.push({level, area, name, detail});
const pass = (area, name, detail) => add('PASS', area, name, detail);
const warn = (area, name, detail) => add('WARN', area, name, detail);
const fail = (area, name, detail) => add('FAIL', area, name, detail);
const relPath = value => typeof value === 'string' && (value.startsWith('./') || value.startsWith('/'));

// ===== 1) البيان (Web App Manifest) =====
const manifestRaw = read('manifest.webmanifest');
let manifest = null;
if (!manifestRaw) fail('PWA', 'manifest.webmanifest موجود', 'الملف مفقود — لن يُثبَّت التطبيق إطلاقًا.');
else {
  try { manifest = JSON.parse(manifestRaw); pass('PWA', 'manifest.webmanifest JSON صالح'); }
  catch (error) { fail('PWA', 'manifest.webmanifest JSON صالح', error.message); }
}
if (manifest) {
  const required = ['name', 'short_name', 'start_url', 'scope', 'display', 'icons', 'lang'];
  for (const key of required) (manifest[key] !== undefined ? pass : fail)('PWA', `manifest.${key} موجود`, manifest[key] === undefined ? 'شرط إلزامي للتثبيت' : '');
  if (manifest.display === 'standalone' || manifest.display === 'fullscreen') pass('PWA', 'وضع العرض standalone/fullscreen', manifest.display);
  else fail('PWA', 'وضع العرض standalone/fullscreen', `القيمة الحالية: ${manifest.display}`);
  if (manifest.id) pass('PWA', 'manifest.id ثابت (هوية التطبيق بعد التنقل/التغليف)', String(manifest.id));
  else warn('PWA', 'manifest.id ثابت', 'بدونه يعتمد المتصفح على start_url كهُوية — خطر عند نقل الاستضافة.');
  if (manifest.dir === 'rtl') pass('PWA', 'اتجاه RTL معلن', 'dir=rtl');
  else warn('PWA', 'اتجاه RTL معلن', 'التطبيق عربي: dir=rtl مطلوب ليُرسَّم الإطار صحيحًا على Android');
  for (const [label, value] of [['start_url', manifest.start_url], ['scope', manifest.scope]]) {
    if (relPath(value)) pass('PWA', `${label} مسار نسبي (يعمل على GitHub Pages في subpath)`, value);
    else fail('PWA', `${label} مسار نسبي`, `${value} — المسار المطلق يكسر النشر في مجلد فرعي`);
  }
  const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
  const has = (size, purpose) => icons.some(icon => String(icon.sizes || '').includes(size) && (icon.purpose || 'any') === purpose);
  for (const [size, purpose] of [['192', 'any'], ['512', 'any'], ['192', 'maskable'], ['512', 'maskable']]) {
    if (has(size, purpose)) pass('Android', `أيقونة ${size}px ${purpose}`, 'شرط التغطية الكاملة على Launchers أندرويد');
    else fail('Android', `أيقونة ${size}px ${purpose}`, 'بدونها يظهر التطبيق بحواف سوداء أو يُرفض التثبيت');
  }
  for (const icon of icons) {
    const src = String(icon.src || '').replace(/^\.\//, '');
    if (!src) fail('PWA', 'كل أيقونة لها src', 'مصدر فارغ');
    else if (!exists(src)) fail('PWA', `ملف الأيقونة ${icon.src} موجود`, 'مذكور في البيان ولا يوجد في المستودع');
  }
  for (const shot of (manifest.screenshots || [])) {
    const src = String(shot.src || '').replace(/^\.\//, '');
    if (!exists(src)) fail('PWA', `لقطة الشاشة ${shot.src} موجودة`, 'مطلوبة لصف المتجر في TWA/PWABuilder');
    if (shot.form_factor && shot.sizes) pass('PWA', `لقطة ${shot.form_factor} بأبعاد ${shot.sizes}`);
  }
  const shortcuts = Array.isArray(manifest.shortcuts) ? manifest.shortcuts : [];
  if (shortcuts.length) {
    pass('Desktop', `اختصارات التطبيق (${shortcuts.length})`, 'تظهر في قائمة النقر يمين على الأيقونة (Windows/Chrome) وقائمة الضغط المطوّل على Android');
    for (const shortcut of shortcuts) {
      if (!shortcut.name || !shortcut.url) { fail('Desktop', 'اختصار مكتمل (name + url)', JSON.stringify(shortcut)); continue; }
      const file = String(shortcut.url).split('#')[0].replace(/^\.\//, '') || 'index.html';
      if (!exists(file)) fail('Desktop', `اختصار «${shortcut.name}» يشير إلى ملف موجود`, shortcut.url);
      // هذا التطبيق يقرأ المسار من location.hash بالصيغة #/<route> (js/core/history-nav.js)،
      // فاختصار بصيغة ./#route يفتح التطبيق على الرئيسية بصمت — خطأ وقع فعلًا وكشفه المتصفح.
      const hash = String(shortcut.url).split('#')[1] || '';
      if (String(shortcut.url).includes('#') && !hash.startsWith('/')) fail('Desktop', `اختصار «${shortcut.name}» يستخدم صيغة-hash الصحيحة`, `${shortcut.url} — المطلوب ./#/<route>`);
      else pass('Desktop', `اختصار «${shortcut.name}» يستخدم صيغة-hash الصحيحة`);
      for (const icon of shortcut.icons || []) if (!exists(String(icon.src).replace(/^\.\//, ''))) fail('Desktop', `أيقونة الاختصار «${shortcut.name}» موجودة`, icon.src);
    }
    if (shortcuts.length >= 4) pass('Desktop', '4 اختصارات فأكثر', 'الحد الأدنى المفيد لشاشة البداية/القائمة السياقية');
  } else warn('Desktop', 'اختصارات التطبيق', 'بلا shortcuts: يفقد التطبيق مزيته على Windows/Android launcher');
  if (manifest.handle_links) pass('Android', 'handle_links معلن (الروابط تُفتح في التطبيق المثبَّت)', manifest.handle_links);
  else warn('Android', 'handle_links', 'مفيد عند وجود روابط مشاركة؛ غير إلزامي');
}

// ===== 2) index.html =====
const html = read('index.html') || '';
if (!html) fail('PWA', 'index.html موجود');
else {
  const checks = [
    ['viewport-fit=cover (الحواف الآمنة على الهاتف)', /viewport-fit=cover/, 'warn'],
    ['meta theme-color', /name="theme-color"/, 'fail'],
    ['theme-color لوضع الفاتح/الداكن', /media="\(prefers-color-scheme/, 'warn'],
    ['color-scheme معلن', /name="color-scheme"/, 'warn'],
    ['link manifest نسبي', /rel="manifest"\s+href="\.\/manifest\.webmanifest"/, 'fail'],
    ['dir=rtl على الجذر', /<html[^>]+dir="rtl"/, 'fail'],
    ['تخطي إلى المحتوى (إمكانية الوصول)', /class="skip"/, 'warn'],
    ['noscript رسالة واضحة', /<noscript>/, 'warn'],
    ['شاشة إقلاع قبل JS', /boot-splash/, 'warn'],
    ['منع تكبير الهاتف العشوائي', /initial-scale=1/, 'warn']
  ];
  for (const [label, rx, level] of checks) {
    if (rx.test(html)) pass('UI', label);
    else (level === 'fail' ? fail : warn)('UI', label);
  }
  const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(m => m[1]).filter(v => !v.startsWith('#') && !v.startsWith('data:'));
  const external = assets.filter(v => /^https?:\/\//i.test(v));
  if (external.length) fail('Offline', 'لا أصول خارجية في index.html', external.join(', ') + ' — كل ملف خارجي يعني انكسارًا في الوضع دون اتصال');
  else pass('Offline', 'كل ملفات index.html محلية (يعمل بلا إنترنت بعد أول تحميل)');
  for (const asset of assets) {
    const file = asset.replace(/^\.\//, '');
    if (!file || file.startsWith('mailto')) continue;
    if (!exists(file)) fail('PWA', `ملف مذكور في index.html موجود: ${asset}`);
  }
  if (/<script[^>]+src="\.\/js\/app\.js"[^>]*>/.test(html)) pass('PWA', 'نقطة الدخول js/app.js');
  else fail('PWA', 'نقطة الدخول js/app.js', 'المسار يجب أن يبقى نسبيًا بنفس الاسم');
}

// ===== 3) Service Worker: الإقلاع بلا إنترنت =====
const sw = read('sw.js') || '';
const constants = read('js/core/constants.js') || '';
const appVersion = (constants.match(/APP_VERSION\s*=\s*'([^']+)'/) || [])[1] || '';
const cacheName = (sw.match(/const CACHE\s*=\s*'([^']+)'/) || [])[1] || '';
if (!sw) fail('Offline', 'sw.js موجود');
else {
  if (!cacheName) fail('Offline', 'كاش مُرقَّم في sw.js');
  else if (cacheName.includes(appVersion)) pass('Offline', `كاش مُرقَّم بإصدار التطبيق (${cacheName})`, 'تحديث الكاش يتم بذرة إصدار لا يدويًا فقط');
  else fail('Offline', 'رقم الكاش يطابق APP_VERSION', `CACHE=${cacheName} مقابل APP_VERSION=${appVersion} — تحديث قد لا يصل`);
  const precached = new Set([...sw.matchAll(/"\.\/([^"]+)"/g)].map(m => m[1]));
  const boot = bootModuleGraph(ROOT).filter(file => file !== 'js/app.js');
  const missing = boot.filter(file => !precached.has(file));
  if (missing.length) fail('Offline', `كل وحدات الإقلاع مُخزَّنة مسبقًا (${boot.length} وحدة)`, 'ناقص: ' + missing.join(', '));
  else pass('Offline', `كل وحدات الإقلاع مُخزَّنة مسبقًا (${boot.length} وحدة)`);
  const css = [...html.matchAll(/href="\.\/(css\/[^"]+)"/g)].map(m => m[1]);
  const missingCss = css.filter(file => !precached.has(file));
  if (missingCss.length) fail('Offline', 'كل ملفات CSS مُخزَّنة مسبقًا', missingCss.join(', '));
  else pass('Offline', `كل ملفات CSS مُخزَّنة مسبقًا (${css.length})`);
  if (/self\.addEventListener\(\s*'install'/.test(sw) && /self\.addEventListener\(\s*'activate'/.test(sw)) pass('Offline', 'دورتا install/activate معلنتان');
  else fail('Offline', 'دورتا install/activate معلنتان');
  if (/SKIP_WAITING/.test(sw)) pass('PWA', 'تحديث بموافقة المستخدم (SKIP_WAITING)', 'لا يُستبدل الكود تحت يدي المستخدم أثناء العمل');
  else warn('PWA', 'آلية تحديث صريحة', 'بلا SKIP_WAITING قد يبقى المستخدم على نسخة قديمة بلا إنذار');
  if (!/\.match\([^)]*ignoreSearch/.test(sw)) warn('Offline', 'مطابقة الكاش لطلبات التنقل تتجاهل الاستعلام', 'روابط مثل ./index.html?x يجب أن تُخدَم من القشرة');
  else pass('Offline', 'مطابقة الكاش لطلبات التنقل تتجاهل الاستعلام');
}

// ===== 4) لا نداءات خارجية في الكود (شرط أوفلاين حقيقي) =====
{
  const offenders = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), {withFileTypes: true})) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) { if (!['node_modules', '.git', '.cache'].includes(entry.name)) walk(rel); continue; }
      if (!/\.(js|mjs|css|html)$/.test(entry.name)) continue;
      const source = read(rel) || '';
      const lines = source.split('\n');
      for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
        const match = line.match(/(?:fetch|import|new Worker|navigator\.serviceWorker\.register)\s*\(\s*['"`](https?:\/\/[^'"`]+)/);
        if (match) offenders.push(`${rel}:${index + 1} ${match[1]}`);
        const tag = line.match(/(?:src|href)=["']https?:\/\/[^"']+/);
        if (tag && !rel.endsWith('.html')) offenders.push(`${rel}:${index + 1} ${tag[0]}`);
      }
    }
  };
  walk('js'); walk('css');
  if (offenders.length) fail('Offline', 'لا نداءات شبكة خارجية من الكود', offenders.slice(0, 8).join(' | '));
  else pass('Offline', 'لا نداءات شبكة خارجية من JS/CSS (Offline-first حقيقي)');
}

// ===== 5) IndexedDB وحده بيانات: لا كاش للمتصفح =====
if (/indexedDB/i.test(sw) && !/caches\.open\([^)]*(?:data|records)/i.test(sw)) pass('Data', 'بيانات المكتب لا تدخل Cache Storage', 'فصل تام بين كاش التطبيق وبيانات المستخدم');
else warn('Data', 'فصل الكاش عن البيانات', 'راجع استراتيجية SW يدويًا');

// ===== 6) تفضيلات تبقى بعد التحديث/التغليف =====
{
  const prefs = read('js/core/preferences.js') || '';
  if (/localStorage|indexedDB/i.test(prefs)) pass('Cross-platform', 'التفضيلات في تخزين الجهاز (تبقى بعد التحديث)', 'تخصيصات المستخدم لا تُفقد عند رفع إصدار');
  else fail('Cross-platform', 'تخزين التفضيلات', 'لا يُعرف أين تُحفظ التفضيلات');
  if (/scopedPreferenceKey/.test(prefs)) pass('Cross-platform', 'التفضيلات مقيّدة بمعرّف القاعدة (تبديل آمن بين القواعد)');
  else warn('Cross-platform', 'تقييد التفضيلات بالقاعدة', 'قد تتسرب إعدادات قاعدة إلى أخرى');
}

// ===== 7) توصيات التغليف (معلوماتية) =====
const packaging = {
  pwabuilder: {target: 'Windows (EXE) / Android (TWA) / iOS', requires: ['manifest.id', 'icons 192+512 any و maskable', 'start_url نسبي', 'service worker يغطّي الإقلاع', 'HTTPS (GitHub Pages يحققها)']},
  bubblewrap: {notes: 'TWA يحتاج نفس شروط PWABuilder + أيقونة maskable 512 + scope يغطّي كل المسارات المستخدمة (وهو هنا ./)؛ التطبيق لا يستخدم توجيهات مسار متعددة فالـ intent filters الافتراضية تكفي.'},
  electron: {notes: 'لا حاجة لطبقة Electron: لا نوافذ متعددة ولا نظام ملفات خام. لو طُلب EXE بلا Chrome فالبديل الأقوى هو PWABuilder (يعتمد WebView2 على ويندوز) — لا يُضاف أي اعتماد جديد للمستودع.'},
  caveats: ['لم تُختبر على أجهزة حقيقية من داخل هذا الفحص؛ android-pwa-browser-tests.mjs يغطي Chromium فقط.', 'الملفات المُولَّدة من PWABuilder لا تُضاف للمستودع: المصدر يبقى هذا البيان.']
};

// ===== التقرير =====
const counts = results.reduce((acc, item) => (acc[item.level] = (acc[item.level] || 0) + 1, acc), {});
const ok = !results.some(item => item.level === 'FAIL') && (!strict || !results.some(item => item.level === 'WARN'));
if (asJson) {
  process.stdout.write(JSON.stringify({ok, counts, results, version: appVersion, cache: cacheName, packaging}, null, 2) + '\n');
} else {
  console.log(`\nبوابـة الجاهزية متعددة المنصات — v${appVersion} (كاش: ${cacheName})\n`);
  let area = '';
  for (const item of results) {
    if (item.area !== area) { area = item.area; console.log(`\n[${area}]`); }
    console.log(`  ${item.level === 'PASS' ? '✔' : item.level === 'WARN' ? '▲' : '✕'} ${item.name}${item.detail ? ` — ${item.detail}` : ''}`);
  }
  console.log(`\nPASS ${counts.PASS || 0} · WARN ${counts.WARN || 0} · FAIL ${counts.FAIL || 0} → ${ok ? 'جاهز للتغليف' : 'غير جاهز'}`);
  console.log('\nتوصيات التغليف:');
  console.log(`  PWABuilder: ${packaging.pwabuilder.requires.join(' + ')}`);
  console.log(`  TWA/Bubblewrap: ${packaging.bubblewrap.notes}`);
  console.log(`  Electron: ${packaging.electron.notes}`);
  for (const caveat of packaging.caveats) console.log(`  ملاحظة: ${caveat}`);
  console.log('');
}
process.exit(ok ? 0 : 1);
