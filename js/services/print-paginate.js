// ترقيم صفحات مستندات الطباعة (كشف الحساب / التوكيل) بلا نظام طباعة ثانٍ:
// يُبنى فوق PrintContext القائم (openDocumentForPrint) بواجهة نصية بحتة،
// والقياس الفعلي يحدث داخل نافذة الطباعة نفسها قبل window.print().
//
// لماذا؟ كشف متعدد السنوات (36 شهرًا مثلًا) كان يُطبع بترقيم المتصفح التلقائي:
// بلا أرقام صفحات وبلا ضمان ألا يُقطع صف بين صفحتين — وهذا ما يحتاجه المحامي
// عند تقديم كشف أو إرفاقه بتوكيل. الحل: تقسيم المحتوى إلى صفحات مقيسة، كل صفحة
// تحمل «صفحة N من M»، ورؤوس الجداول تتكرر تلقائيًا في كل صفحة.
//
// الحدود المعلنة: الترقيم يحسب على مقاس A4 وهوامشه من `@page`، وما زاد عن
// سقف الحماية (2000 صف) يُترك لترقيم المتصفح بدل تجميد النافذة.

export const PRINT_PAGE_STYLES = `
  @page { size: A4; margin: 14mm 12mm; }
  html, body { margin: 0; padding: 0; }
  .print-page { break-after: page; page-break-after: always; }
  .print-page:last-of-type { break-after: auto; page-break-after: auto; }
  .print-page > h1, .print-page > h3, .print-page > .numbers, .print-page > .grid2 { break-inside: avoid; page-break-inside: avoid; }
  table { break-inside: auto; page-break-inside: auto; }
  thead { display: table-header-group; }
  tr, td, th { break-inside: avoid; page-break-inside: avoid; }
  tr.total td { break-inside: avoid; page-break-inside: avoid; }
  .page-foot { margin-top: 10px; padding-top: 6px; border-top: 1px solid #bbb; font-size: 10px; color: #555; display: flex; justify-content: space-between; gap: 10px; }
  .page-foot .page-no { font-weight: 700; color: #111; white-space: nowrap; }
  caption.cont { caption-side: top; text-align: start; font-size: 10px; color: #666; padding-bottom: 4px; }
`;

// سكربت يُحقن في نافذة الطباعة قبل نقر الطباعة. يقيس ارتفاع المحتوى داخل مقاس
// الصفحة الفعلي ثم يوزّع الصفوف على صفحات، ولا يعتمد على أي توقّع لعدد صفوف ثابت.
export const PRINT_PAGINATOR_SCRIPT = `
(function () {
 try {
  var A4_W_MM = 210, A4_H_MM = 297, MARGIN_X_MM = 12, MARGIN_Y_MM = 14;
  var MM = 96 / 25.4;
  var CONTENT_W = Math.round((A4_W_MM - MARGIN_X_MM * 2) * MM);
  // ارتفاع الصفحة الفعلي = A4 − الهوامش، بخصم أمان صغير + ارتفاع تذييل الترقيم
  // (سطر + حد + هوامش ≈ 35px). القياس المحافظ يمنع صفحة تُفيض فتُنشئ صفحة فارغة.
  var PAGE_H = Math.floor((A4_H_MM - MARGIN_Y_MM * 2) * MM) - 4;
  var FOOTER_H = 40;
  var MAX_ROWS = 2000;
  var body = document.body;
  if (!body) return;
  var blocks = [].slice.call(body.children).filter(function (el) {
    return ['SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT'].indexOf(el.tagName) === -1;
  });
  var totalRows = 0;
  blocks.forEach(function (el) { if (el.tagName === 'TABLE') totalRows += el.querySelectorAll('tbody tr').length; });
  if (totalRows > MAX_ROWS) return; // مستند ضخم: يبقى على ترقيم المتصفح بدل إبطاء الطباعة

  body.style.margin = '0';
  body.style.padding = '0';
  body.style.width = CONTENT_W + 'px';

  var used = [];
  var current = null;
  function ensurePage() {
    if (current) return current;
    current = document.createElement('div');
    current.className = 'print-page';
    current.style.width = CONTENT_W + 'px';
    used.push(current);
    body.appendChild(current);
    return current;
  }
  function room() { return PAGE_H - FOOTER_H - (current ? current.getBoundingClientRect().height : 0); }
  function wouldOverflow(el) { return el.getBoundingClientRect().height > room(); }
  function pageFull() { return current.getBoundingClientRect().height > PAGE_H - FOOTER_H; }
  function textOnly(el) { return el.tagName === 'PRE' || el.children.length === 0; }

  // بلوك نصي أطول من صفحة (مقدمة توكيل مثلًا): يُقسَّم عند حدود الأسطر
  // ولا يُترك صفحة تُفيض فتخرج صفحة إضافية بلا ترقيم.
  function distributeText(block) {
    var lines = String(block.textContent || '').split('\\n');
    var page = ensurePage();
    if (current.children.length) { current = null; page = ensurePage(); }
    var holder = block.cloneNode(false);
    holder.textContent = '';
    page.appendChild(holder);
    block.remove();
    for (var i = 0; i < lines.length; i++) {
      var previous = holder.textContent;
      holder.textContent = previous ? previous + '\\n' + lines[i] : lines[i];
      if (pageFull() && holder.textContent.indexOf('\\n') !== -1) {
        holder.textContent = previous;
        current = null;
        page = ensurePage();
        holder = block.cloneNode(false);
        holder.textContent = lines[i];
        page.appendChild(holder);
      }
    }
  }

  blocks.forEach(function (block) {
    if (block.tagName !== 'TABLE') {
      var page = ensurePage();
      if (current.children.length && wouldOverflow(block)) current = null, page = ensurePage();
      if (block.getBoundingClientRect().height > PAGE_H - FOOTER_H && textOnly(block)) { distributeText(block); return; }
      page.appendChild(block);
      return;
    }
    // جدول: يُوزّع صفًّا صفًّا وتتكرر رؤوسه في كل صفحة
    var head = block.querySelector('thead'), rowList = [].slice.call(block.querySelectorAll('tbody tr'));
    if (!rowList.length) {
      var only = ensurePage();
      if (current.children.length && wouldOverflow(block)) current = null, only = ensurePage();
      only.appendChild(block);
      return;
    }
    var template = block.cloneNode(false);
    if (head) template.appendChild(head.cloneNode(true));
    template.appendChild(document.createElement('tbody'));
    var page2 = ensurePage();
    var table = template.cloneNode(true);
    page2.appendChild(table);
    var tbody = table.querySelector('tbody');
    function overflowed() { return current.getBoundingClientRect().height > PAGE_H - FOOTER_H; }
    rowList.forEach(function (row) {
      tbody.appendChild(row);
      if (overflowed() && tbody.children.length > 1) {
        tbody.removeChild(row);
        current = null;
        var nextPage = ensurePage();
        var nextTable = template.cloneNode(true);
        var caption = document.createElement('caption');
        caption.className = 'cont';
        caption.textContent = 'تكملة الجدول';
        nextTable.insertBefore(caption, nextTable.firstChild);
        nextPage.appendChild(nextTable);
        nextTable.querySelector('tbody').appendChild(row);
        table = nextTable;
        tbody = nextTable.querySelector('tbody');
      }
    });
    block.remove();
  });

  if (!used.length) return;
  used.forEach(function (page, index) {
    var foot = document.createElement('div');
    foot.className = 'page-foot';
    foot.innerHTML = '<span>' + (document.title || '') + '</span><span class="page-no">صفحة ' + (index + 1) + ' من ' + used.length + '</span>';
    page.appendChild(foot);
  });
  document.documentElement.setAttribute('data-print-pages', String(used.length));
  document.documentElement.setAttribute('data-print-rows', String(totalRows));
 } catch (error) {
  // الطباعة لا تُكسر أبدًا: لو تعثّر الترقيم يبقى المستند كما هو بترقيم المتصفح،
  // ويُسجَّل السبب في السمة data-print-error ليظهر في الفحوص بدل الفشل الصامت.
  try { document.documentElement.setAttribute('data-print-error', String((error && error.message) || error)); } catch (ignored) {}
 }
})();
`;

/**
 * يلفّ مستند الطباعة بأنماط مقاس A4 وسكربت الترقيم معًا.
 * دالة نصية بحتة (بلا DOM) لتُختبر في Node وفي المتصفح.
 */
export function wrapForPrint(html, {styles = PRINT_PAGE_STYLES, script = PRINT_PAGINATOR_SCRIPT} = {}) {
  const source = String(html || '');
  if (!source) throw new Error('مستند الطباعة فارغ.');
  if (source.includes('data-print-paginator')) return source; // لا لفّ مزدوج: الترقيم مرة واحدة
  const injection = `<style data-print-pages>${styles}</style><script data-print-paginator>${script}</script>`;
  if (/<\/body>/i.test(source)) return source.replace(/<\/body>/i, `${injection}</body>`);
  if (/<\/html>/i.test(source)) return source.replace(/<\/html>/i, `${injection}</html>`);
  return `${source}${injection}`;
}
