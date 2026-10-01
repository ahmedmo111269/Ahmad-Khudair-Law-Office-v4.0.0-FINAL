// =====================================================================
// مركز العمل — محرك الاستعلام (Query-first). لا «تحميل الكل ثم التصفية»:
//  • كل مصدر يُقرأ من فهرس التاريخ الخاص به بنطاق [من، إلى] وبصفحات ≤100 صف عبر Repository.page.
//  • الدمج بين المصادر k-way بمفتاح ترتيب موحّد (تاريخ|وقت|أولوية|معرّف) → ترقيم بالمؤشر (keyset)
//    لا يعتمد على جلسة: المؤشر هو موضع في الترتيب الكلي، فيصلح مهما تغيّرت المرشحات.
//  • «المتأخر» يُقصّ بعمق قابل للضبط للمصادر التي لا تملك فهرس حالة؛ والمقصوص يُعلن صراحةً (partial).
//  • البحث النصي يعيد استخدام تطبيع/تقطيع البحث الشامل (tokenizeQuery/matchTokens)، ويقرأ الأسماء من العلاقات حيًّا.
//  • الإلغاء: signal يُمرَّر إلى كل قراءة؛ استعلام أحدث يُلغي الأقدم في الواجهة.
// =====================================================================
import {STORE} from '../db/schema.js';
import {Clock, addDays} from '../core/clock.js';
import {normalizeArabic, normalizeDigits} from '../core/search-normalizer.js';
import {presetRange} from './entity-query.js';
import {tokenizeQuery, matchTokens} from './search-engine.js';
import {createGridRelations} from './grid-relations.js';
import {getWorkConfig} from './work-config.js';
import {
  overlayId, WORK_KIND, NO_DATE_KEY, keyDate, isIsoDate, classifyDue, workSearchFields, expandRecurrence,
  RECURRENCE_LOOKBACK_DAYS, RECURRENCE_MAX_OCCURRENCES, priorityRank, sortKeyOf, dayDiff
} from '../domain/work-items.js';
import {
  enabledWorkSources, workSource, buildProjectedItem, buildNativeItem, buildOrphanItem, itemPassesFilters, isLiveSourceRow
} from '../domain/work-sources.js';

export const PAGE = 100;
export const MAX_SCAN = 20000;
const WI = STORE.workItems;
const MIN_DATE = '0000-01-01', MAX_DATE = '9999-12-31';
const cursorKey = cursor => typeof cursor === 'string' && cursor.startsWith('wc1:') ? cursor.slice(4) : '';
const toCursor = key => `wc1:${key}`;
const abortError = () => new DOMException('تم إلغاء استعلام مركز العمل بسبب استعلام أحدث.', 'AbortError');
const byKey = (a, b) => a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0;
const asList = value => Array.isArray(value) ? value.filter(Boolean).map(String) : value ? [String(value)] : [];

// ---------- النطاقات والمواصفات ----------
export function resolveRange(key, {from = '', to = ''} = {}) {
  switch (key) {
    case 'all': return {key, from: '', to: ''};
    case 'overdue': return {key, from: '', to: addDays(Clock.today(), -1)};
    case 'custom': { const [a, b] = presetRange('custom', from, to); return {key, from: a, to: b}; }
    default: { const [a, b] = presetRange(key); return {key, from: a, to: b}; }
  }
}

export function normalizeSpec(spec = {}, {today = Clock.today(), config = getWorkConfig()} = {}) {
  const range = resolveRange(spec.range || 'all', {from: spec.from, to: spec.to});
  const kinds = asList(spec.kinds).filter(k => ['open', 'done', 'cancelled'].includes(k));
  return {
    range: range.key, from: range.from || '', to: range.to || '', undated: Boolean(spec.undated), onlyUndated: Boolean(spec.onlyUndated),
    kinds: kinds.length ? kinds : ['open'],
    statuses: asList(spec.statuses), priorities: asList(spec.priorities), sources: asList(spec.sources), types: asList(spec.types), tags: asList(spec.tags),
    pinned: Boolean(spec.pinned), archived: spec.archived === 'any' || spec.archived === 'only' ? spec.archived : 'none',
    fileId: spec.fileId || '', caseId: spec.caseId || '', clientId: spec.clientId || '', opponentId: spec.opponentId || '', relatedId: spec.relatedId || '',
    quadrant: spec.quadrant || '', q: String(spec.q || '').trim(), drive: spec.drive || '', order: spec.order === 'desc' ? 'desc' : 'asc',
    includeVirtual: spec.includeVirtual !== false, today, config
  };
}
const isScoped = spec => Boolean(spec.fileId || spec.caseId || spec.clientId || spec.opponentId || spec.relatedId);
function lowerFor(source, spec) {
  let lower = spec.from || MIN_DATE;
  if (!spec.from && spec.kinds.length === 1 && spec.kinds[0] === 'open') {
    const days = spec.config.lookback?.[source.type] ?? source.lookbackDays;
    if (Number.isFinite(days)) lower = addDays(spec.today, -days);
  }
  return lower;
}
const upperFor = spec => `${spec.to || MAX_DATE}\uffff`;

// ---------- مجرى مجمّع حسب التاريخ ----------
// يقرأ صفحات الفهرس تدريجيًا ويُخرج عناصر مرتبة بمفتاح الترتيب الكلي؛ مجموعة اليوم كاملة تُحمَّل قبل إخراجها
// فيصح الترتيب بالوقت داخل اليوم الواحد حتى لو اختلف ترتيب المفتاح الأساسي.
class GroupedStream {
  constructor({fetchPage, build, accept, fromKey, name}) {
    Object.assign(this, {fetchPage, build, accept, fromKey, name});
    this.queue = []; this.pos = 0; this.cursor = null; this.done = false; this.group = []; this.groupDate = null; this.rawSeen = 0;
  }
  async ready() {
    while (this.pos >= this.queue.length && !this.done) { this.queue = []; this.pos = 0; await this.load(); }
  }
  peek() { return this.pos < this.queue.length ? this.queue[this.pos] : null; }
  shift() { return this.queue[this.pos++]; }
  async load() {
    const page = await this.fetchPage(this.cursor);
    this.cursor = page.nextCursor || null;
    this.rawSeen += page.rows.length;
    for (const item of await this.build(page.rows)) {
      if (this.groupDate !== null && item.dueDate !== this.groupDate) this.flush();
      this.groupDate = item.dueDate; this.group.push(item);
    }
    if (!page.hasMore) { this.flush(); this.done = true; }
  }
  flush() {
    this.group.sort(byKey);
    for (const item of this.group) if (item.sortKey >= this.fromKey && this.accept(item)) this.queue.push(item);
    this.group = []; this.groupDate = null;
  }
}
class ArrayStream {
  constructor(loader, fromKey, accept) { this.loader = loader; this.fromKey = fromKey; this.accept = accept; this.items = null; this.pos = 0; this.rawSeen = 0; }
  async ready() {
    if (this.items) return;
    const items = await this.loader();
    this.rawSeen = items.length;
    this.items = items.filter(item => item.sortKey >= this.fromKey && this.accept(item)).sort(byKey);
  }
  peek() { return this.items && this.pos < this.items.length ? this.items[this.pos] : null; }
  shift() { return this.items[this.pos++]; }
  get done() { return Boolean(this.items) && this.pos >= this.items.length; }
}

// ---------- بناء المجاري ----------
const EMPTY_PAGE = Object.freeze({rows: [], nextCursor: null, hasMore: false});
const pageOf = async (repo, opts) => {
  const page = await repo.page(opts);
  return {rows: page.items, nextCursor: page.nextCursor, hasMore: page.hasMore};
};

function projectionStream(office, source, spec, ctx, {undated = false} = {}) {
  const repo = office.r[source.store], kinds = new Set(spec.kinds);
  const lower = lowerFor(source, spec), upper = upperFor(spec);
  const raw = row => source.include(row) && isLiveSourceRow(row) && (source.overlayTerminal || kinds.has(source.sourceKind(row, null)));
  return new GroupedStream({
    name: `${source.type}${undated ? ':undated' : ''}`, fromKey: ctx.fromKey, accept: ctx.accept,
    fetchPage: cursor => {
      if (ctx.signal?.aborted) throw abortError();
      const base = {index: source.index, limit: PAGE, cursor, signal: ctx.signal, filter: undated ? (r => isLiveSourceRow(r) && !source.dateOf(r) && (source.overlayTerminal || kinds.has(source.sourceKind(r, null)))) : raw};
      const lo = ctx.lowerDate(lower);
      if (!undated && lo > upper) return Promise.resolve(EMPTY_PAGE);
      return pageOf(repo, undated ? {...base, key: source.undatedKey} : {...base, lower: lo, upper});
    },
    build: async rows => {
      if (!rows.length) return [];
      const overlays = await office.r.workItems.getManyRaw(rows.map(r => overlayId(source.type, r.id)));
      const map = new Map(overlays.map(o => [o.id, o]));
      return rows.map(r => buildProjectedItem(source, r, map.get(overlayId(source.type, r.id)), {config: spec.config}));
    }
  });
}

function nativeStream(office, spec, ctx, {undated = false} = {}) {
  const lower = spec.from || MIN_DATE, upper = upperFor(spec);
  return new GroupedStream({
    name: undated ? 'native:undated' : 'native', fromKey: ctx.fromKey, accept: ctx.accept,
    fetchPage: cursor => {
      if (ctx.signal?.aborted) throw abortError();
      const base = {index: 'kind_dueDate', limit: PAGE, cursor, signal: ctx.signal};
      const lo = ctx.lowerDate(lower);
      if (!undated && lo > upper) return Promise.resolve(EMPTY_PAGE);
      return pageOf(office.r.workItems, undated ? {...base, key: [WORK_KIND.native, '']} : {...base, lower: [WORK_KIND.native, lo], upper: [WORK_KIND.native, upper]});
    },
    build: async rows => rows.map(r => buildNativeItem(r, {config: spec.config}))
  });
}

/** طبقات فقدت مصدرها (حُذف/أُرشف): تبقى ظاهرة بعبارة «المصدر غير متاح حاليًا». */
function orphanStream(office, spec, ctx, enabledTypes, {undated = false} = {}) {
  const lower = spec.from || MIN_DATE, upper = upperFor(spec);
  return new GroupedStream({
    name: 'orphans', fromKey: ctx.fromKey, accept: ctx.accept,
    fetchPage: cursor => {
      if (ctx.signal?.aborted) throw abortError();
      const base = {index: 'kind_dueDate', limit: PAGE, cursor, signal: ctx.signal};
      const lo = ctx.lowerDate(lower);
      if (!undated && lo > upper) return Promise.resolve(EMPTY_PAGE);
      return pageOf(office.r.workItems, undated ? {...base, key: [WORK_KIND.overlay, '']} : {...base, lower: [WORK_KIND.overlay, lo], upper: [WORK_KIND.overlay, upper]});
    },
    build: async rows => hydrateOverlays(office, rows, spec, {onlyOrphans: true, enabledTypes})
  });
}

/** يحوّل صفوف الطبقات إلى عناصر: مسقَطة إن كان المصدر حيًّا، يتيمة إن لم يكن. */
async function hydrateOverlays(office, overlays, spec, {onlyOrphans = false, enabledTypes = null} = {}) {
  const bySource = new Map();
  for (const o of overlays) {
    if (!workSource(o.sourceType)) continue;
    if (!bySource.has(o.sourceType)) bySource.set(o.sourceType, []);
    bySource.get(o.sourceType).push(o);
  }
  const out = [];
  await Promise.all([...bySource].map(async ([type, list]) => {
    const source = workSource(type);
    const rows = await office.r[source.store].getManyRaw(list.map(o => o.sourceId));
    const live = new Map(rows.filter(r => isLiveSourceRow(r) && source.include(r)).map(r => [r.id, r]));
    for (const o of list) {
      const row = live.get(o.sourceId);
      if (row) { if (!onlyOrphans) out.push(buildProjectedItem(source, row, o, {config: spec.config})); }
      else if (!enabledTypes || enabledTypes.has(type)) out.push(buildOrphanItem(o, {config: spec.config}));
    }
  }));
  return out;
}

/** تكرارات افتراضية (لا تُخزَّن): تُولَّد لنافذة الاستعلام فقط وتُستثنى منها التواريخ المحوَّلة لمهام حقيقية. */
function recurrenceStream(office, spec, ctx) {
  return new ArrayStream(async () => {
    const defs = await office.r.workItemRecurrences.byIndex('status', 'active', 500);
    if (!defs.length) return [];
    const today = spec.today;
    const floor = addDays(today, -RECURRENCE_LOOKBACK_DAYS);
    const lo = ctx.lowerDate(spec.from && spec.from > floor ? spec.from : floor);
    const hi = spec.to || addDays(today, 60);
    if (lo > hi) return [];
    const items = [];
    for (const def of defs) {
      const dates = expandRecurrence(def.rule, def.startDate, lo, hi, {limit: RECURRENCE_MAX_OCCURRENCES});
      if (!dates.length) continue;
      const made = await office.r.workItems.range('recurrenceId_occurrenceDate', [def.id, lo], [def.id, hi], 100);
      const materialized = new Set(made.map(r => r.occurrenceDate));
      const past = dates.filter(d => d < today && !materialized.has(d)), future = dates.filter(d => d >= today && !materialized.has(d));
      for (const date of [...past.slice(-1), ...future]) {
        const item = buildNativeItem({
          id: `rec::${def.id}::${date}`, title: def.title, description: def.description, type: def.type, dueDate: date, dueTime: def.dueTime,
          status: 'notStarted', priority: def.priority, tags: def.tags, fileId: def.fileId, caseId: def.caseId, clientId: def.clientId, opponentId: def.opponentId,
          relatedType: def.relatedType, relatedId: def.relatedId, recurrenceId: def.id, occurrenceDate: date, createdAt: def.createdAt, updatedAt: def.updatedAt, version: 0
        }, {config: spec.config});
        item.isVirtual = true; item.sourceLabel = 'مهمة متكررة'; item.typeLabel = def.type || 'مهمة متكررة';
        items.push(item);
      }
    }
    return items;
  }, ctx.fromKey, ctx.accept);
}

// ---------- نطاق الملف/القضية/الموكل/الخصم (مجموعات صغيرة محدودة) ----------
const SCOPE_FILES_LIMIT = 200;
export async function scopeFileIds(office, spec) {
  const ids = new Set();
  if (spec.fileId) ids.add(spec.fileId);
  if (spec.caseId) { const c = await office.r.cases.get(spec.caseId); if (c?.fileId) ids.add(c.fileId); }
  if (spec.clientId) {
    const [parties, links] = await Promise.all([office.r.fileParties.byIndex('clientId', spec.clientId, 1000), office.r.fileClients.byIndex('clientId', spec.clientId, 1000)]);
    for (const row of [...parties, ...links]) if (row.fileId) ids.add(row.fileId);
  }
  if (spec.opponentId) {
    const parties = await office.r.fileParties.byIndex('opponentId', spec.opponentId, 1000);
    for (const row of parties) if (row.fileId) ids.add(row.fileId);
  }
  return [...ids].slice(0, SCOPE_FILES_LIMIT);
}
function scopedStreams(office, spec, ctx, sources) {
  // المهام المرتبطة بسجل معيّن: فهرس relatedId مباشرة (لا مسح لنطاق «الكل»).
  if (spec.relatedId && !spec.fileId && !spec.caseId && !spec.clientId && !spec.opponentId) {
    return [new ArrayStream(async () => (await office.r.workItems.byIndexAll('relatedId', spec.relatedId)).filter(r => r.kind === WORK_KIND.native).map(r => buildNativeItem(r, {config: spec.config})),
      ctx.fromKey, item => ctx.accept(item) && inScopeWindow(item, spec))];
  }
  const streams = [];
  const load = async () => {
    const fileIds = await scopeFileIds(office, spec);
    const stageIds = new Set(spec.caseId ? [spec.caseId] : []);
    return {fileIds, stageIds};
  };
  let scope = null;
  const scopeOnce = () => scope ||= load();
  for (const source of sources) {
    streams.push(new ArrayStream(async () => {
      const {fileIds, stageIds} = await scopeOnce();
      const rows = new Map();
      const add = list => list.forEach(r => { if (isLiveSourceRow(r) && source.include(r)) rows.set(r.id, r); });
      const idx = source.scopeIndexes || {};
      for (const fileId of fileIds) {
        if (idx.fileId === 'id') { const f = await office.r.files.get(fileId); if (f) add([f]); }
        else if (idx.fileId) add(await office.r[source.store].byIndexAll(idx.fileId, fileId));
        if (source.type === 'hearings') for (const c of await office.r.cases.byIndexAll('fileId', fileId)) add(await office.r.hearings.byIndexAll('caseId', c.id));
      }
      if (spec.caseId && idx.caseId) add(await office.r[source.store].byIndexAll(idx.caseId, spec.caseId));
      if (spec.clientId && idx.clientId) add(await office.r[source.store].byIndexAll(idx.clientId, spec.clientId));
      const list = [...rows.values()];
      const overlays = await office.r.workItems.getManyRaw(list.map(r => overlayId(source.type, r.id)));
      const map = new Map(overlays.map(o => [o.id, o]));
      return list.map(r => buildProjectedItem(source, r, map.get(overlayId(source.type, r.id)), {config: spec.config}));
    }, ctx.fromKey, item => ctx.accept(item) && inScopeWindow(item, spec)));
  }
  streams.push(new ArrayStream(async () => {
    const {fileIds} = await scopeOnce();
    const rows = new Map();
    const add = list => list.forEach(r => { if (r.kind === WORK_KIND.native) rows.set(r.id, r); });
    for (const fileId of fileIds) add(await office.r.workItems.byIndexAll('fileId', fileId));
    if (spec.caseId) add(await office.r.workItems.byIndexAll('caseId', spec.caseId));
    if (spec.clientId) add(await office.r.workItems.byIndexAll('clientId', spec.clientId));
    return [...rows.values()].map(r => buildNativeItem(r, {config: spec.config}));
  }, ctx.fromKey, item => ctx.accept(item) && inScopeWindow(item, spec)));
  return streams;
}
function inScopeWindow(item, spec) {
  if (!item.dueDate) return spec.undated || (!spec.from && !spec.to);
  if (spec.from && item.dueDate < spec.from) return false;
  if (spec.to && item.dueDate > spec.to) return false;
  return true;
}

// ---------- بحث نصي: يعيد استخدام تطبيع البحث الشامل ----------
const norm = value => normalizeArabic(normalizeDigits(String(value ?? '')));
function refsOf(relations, item) {
  const names = role => relations.items(item, role).map(x => x.text);
  const stage = relations.model(item)?.stage;
  return {
    fileLabel: names('legalFile').join(' '), fileTitle: relations.items(item, 'legalFile').map(x => x.detail).join(' '),
    fileNumber: (relations.model(item)?.primary || []).map(b => b.file?.fileNumber).filter(Boolean).join(' '),
    caseNumber: [relations.officialNumber(item), stage?.caseNumber, stage?.caseNumber && stage?.caseYear ? `${stage.caseNumber}/${stage.caseYear}` : ''].filter(Boolean).join(' '),
    court: [item.raw?.court, stage?.courtId].filter(Boolean).join(' '),
    clients: names('client'), opponents: names('opponent')
  };
}
async function matchingCommentItemIds(office, tokens, signal) {
  const ids = new Set();
  let cursor = null, scanned = 0;
  while (scanned < 3000) {
    if (signal?.aborted) throw abortError();
    const page = await office.r.workItemComments.page({index: 'createdAt', direction: 'prev', limit: PAGE, cursor, signal});
    for (const row of page.items) if (matchTokens(tokens, norm(row.body))) ids.add(row.workItemId);
    scanned += page.items.length;
    if (!page.hasMore) break;
    cursor = page.nextCursor;
  }
  return ids;
}

// ---------- الاستعلام الرئيسي ----------
/**
 * @returns {{items:object[], nextCursor:string|null, hasMore:boolean, partial:boolean, scanned:number}}
 * predicate(item): مرشّح إضافي (مثل استعلام الجدول) يُطبَّق بعد ربط العلاقات.
 */
export async function queryWorkItems(office, specInput = {}, {cursor = null, limit = 50, signal = null, predicate = null, relations = null} = {}) {
  office.ctx.assert();
  const spec = normalizeSpec(specInput);
  if (spec.drive) return driveQuery(office, spec, {cursor, limit, signal, predicate, relations});
  const fromKey = cursorKey(cursor);
  const fromDate = fromKey ? keyDate(fromKey) : '';
  const lowerDate = lower => fromDate && fromDate > lower ? (fromDate === NO_DATE_KEY ? MAX_DATE : fromDate) : lower;
  const sources = enabledWorkSources(spec.config).filter(s => !spec.sources.length || spec.sources.includes(s.type));
  const wantNative = !spec.sources.length || spec.sources.includes('task');
  const accept = item => itemPassesFilters(item, spec);
  const ctx = {fromKey, lowerDate, accept, signal};
  const wantsUndated = spec.undated || spec.onlyUndated || (!spec.from && !spec.to);
  const untilNoDate = (fromKey && keyDate(fromKey) === NO_DATE_KEY) || spec.onlyUndated;
  let streams = [];
  if (isScoped(spec)) streams = scopedStreams(office, spec, ctx, sources);
  else {
    const datedOk = !untilNoDate;
    if (datedOk) {
      for (const source of sources) streams.push(projectionStream(office, source, spec, ctx));
      if (wantNative) streams.push(nativeStream(office, spec, ctx));
      streams.push(orphanStream(office, spec, ctx, new Set(sources.map(s => s.type))));
      if (wantNative && spec.includeVirtual && spec.kinds.includes('open')) streams.push(recurrenceStream(office, spec, ctx));
    }
    if (wantsUndated) {
      for (const source of sources) if (source.undatedKey !== undefined) streams.push(projectionStream(office, source, spec, ctx, {undated: true}));
      if (wantNative) streams.push(nativeStream(office, spec, ctx, {undated: true}));
      streams.push(orphanStream(office, spec, ctx, new Set(sources.map(s => s.type)), {undated: true}));
    }
  }
  const tokens = spec.q ? tokenizeQuery(spec.q) : [];
  const needsRelations = Boolean(tokens.length || predicate);
  const rel = needsRelations ? (relations || createGridRelations(office, 'workItems')) : null;
  const commentHits = tokens.length ? await matchingCommentItemIds(office, tokens, signal) : new Set();
  const seen = new Set();
  const out = [];
  let scanned = 0, partial = false;
  const want = limit + 1;
  let nextHead = null;

  const refill = async () => { await Promise.all(streams.map(s => s.ready())); };
  const minStream = () => {
    let best = null;
    for (const s of streams) { const h = s.peek(); if (h && (!best || h.sortKey < best.peek().sortKey)) best = s; }
    return best;
  };
  for (;;) {
    if (signal?.aborted) throw abortError();
    await refill();
    const batch = [];
    while (batch.length < Math.max(30, Math.min(want - out.length, 120))) {
      const s = minStream();
      if (!s) break;
      const item = s.shift();
      if (seen.has(item.id)) continue;
      seen.add(item.id); batch.push(item);
    }
    if (!batch.length) break;
    scanned += batch.length;
    let kept = batch;
    if (needsRelations) {
      await rel.hydrate(batch, {signal});
      kept = batch.filter(item => {
        if (tokens.length && !commentHits.has(item.id) && !matchTokens(tokens, norm(workSearchFields(item, refsOf(rel, item))))) return false;
        return !predicate || predicate(item);
      });
    }
    out.push(...kept);
    if (out.length >= want) break;
    if (scanned >= MAX_SCAN) { partial = true; break; }
  }
  // أول عنصر من الصفحة التالية = بداية المؤشر (شامل). عند بلوغ حد المسح نبدأ من أصغر رأس متبقٍ.
  const extra = out.length > limit ? out[limit] : null;
  if (extra) nextHead = extra.sortKey;
  else if (partial) { const s = minStream(); nextHead = s?.peek()?.sortKey || null; }
  const items = out.slice(0, limit);
  if (!extra && !partial) nextHead = null;
  // العناصر التي سُحبت من المجاري ولم تُعرض (فائض الدفعة) لا تضيع: المؤشر يبدأ عند أول عنصر غير معروض.
  return {items, nextCursor: nextHead ? toCursor(nextHead) : null, hasMore: Boolean(nextHead), partial, scanned};
}

// ---------- الاستعلام بالطبقة (Overlay-driven): مثبت/مؤرشف/منجز/بحالة تشغيلية ----------
// يقرأ فهرس workItems المناسب مباشرة (status_dueDate / pinnedAt / archivedAt / completedAt) ثم يربط المصادر دفعةً واحدة.
// المؤشر هو مؤشر المستودع الأصلي بعد آخر صف استُهلك، فلا يضيع عنصر بين صفحتين.
const localDayStartIso = day => new Date(`${day}T00:00:00`).toISOString();
const localDayEndIso = day => new Date(`${day}T23:59:59.999`).toISOString();
async function driveQuery(office, spec, {cursor, limit, signal, predicate, relations}) {
  const repo = office.r.workItems;
  const tokens = spec.q ? tokenizeQuery(spec.q) : [];
  const needsRelations = Boolean(tokens.length || predicate);
  const rel = needsRelations ? (relations || createGridRelations(office, 'workItems')) : null;
  const filterSpec = {...spec, kinds: ['open', 'done', 'cancelled']};
  let base, dateWindow = false;
  switch (spec.drive) {
    case 'status': {
      const status = spec.statuses[0];
      if (!status) throw new Error('حالة العمود مطلوبة.');
      base = {index: 'status_dueDate', lower: [status, spec.from || ''], upper: [status, upperFor(spec)], direction: 'next'};
      filterSpec.statuses = []; filterSpec.kinds = spec.kinds; dateWindow = true;
      break;
    }
    case 'pinned': base = {index: 'pinnedAt', direction: 'prev'}; filterSpec.kinds = spec.kinds; break;
    case 'archived': base = {index: 'archivedAt', direction: 'prev'}; filterSpec.archived = 'only'; break;
    case 'completed':
      base = {index: 'completedAt', direction: 'prev', ...(spec.from ? {lower: localDayStartIso(spec.from)} : {}), ...(spec.to ? {upper: localDayEndIso(spec.to)} : {})};
      filterSpec.kinds = ['done'];
      break;
    default: throw new Error('نمط استعلام غير معروف.');
  }
  const items = [], seen = new Set();
  let pageCursor = cursor && !String(cursor).startsWith('wc1:') ? cursor : null;
  let nextCursor = null, hasMore = false, scanned = 0, partial = false;
  for (;;) {
    if (signal?.aborted) throw abortError();
    const page = await repo.page({...base, limit: PAGE, cursor: pageCursor, signal, includeItemCursors: true});
    scanned += page.items.length;
    const built = new Map();
    page.items.filter(r => r.kind === WORK_KIND.native).forEach(r => built.set(r.id, buildNativeItem(r, {config: spec.config})));
    for (const item of await hydrateOverlays(office, page.items.filter(r => r.kind === WORK_KIND.overlay), spec)) built.set(item.id, item);
    let candidates = page.items.map(r => built.get(r.id));
    const inScope = item => (!spec.fileId || item.fileId === spec.fileId) && (!spec.caseId || item.caseId === spec.caseId) && (!spec.clientId || item.clientId === spec.clientId);
    candidates = candidates.map(item => item && itemPassesFilters(item, filterSpec) && inScope(item) && !seen.has(item.id)
      && (!dateWindow || !item.dueDate || ((!spec.from || item.dueDate >= spec.from) && (!spec.to || item.dueDate <= spec.to))) ? item : null);
    const live = candidates.filter(Boolean);
    if (needsRelations && live.length) {
      await rel.hydrate(live, {signal});
      const pass = new Set(live.filter(item => (!tokens.length || matchTokens(tokens, norm(workSearchFields(item, refsOf(rel, item))))) && (!predicate || predicate(item))));
      candidates = candidates.map(item => item && pass.has(item) ? item : null);
    }
    let consumed = -1;
    for (let i = 0; i < candidates.length; i++) {
      if (items.length >= limit) break;
      consumed = i;
      if (candidates[i]) { items.push(candidates[i]); seen.add(candidates[i].id); }
    }
    const rest = consumed < page.items.length - 1;
    if (items.length >= limit && (rest || page.hasMore)) { hasMore = true; nextCursor = rest ? page.itemCursors[consumed] : page.nextCursor; break; }
    if (!page.hasMore) break;
    pageCursor = page.nextCursor;
    if (scanned >= MAX_SCAN) { partial = true; hasMore = true; nextCursor = pageCursor; break; }
  }
  return {items, nextCursor, hasMore: hasMore && Boolean(nextCursor), partial, scanned};
}


/** عنصر واحد بمعرّفه (مهمة/إسقاط/تكرار افتراضي/يتيم) — للمجلّد وللروابط المباشرة. null إن لم يوجد. */
export async function getWorkItem(office, id, {config = getWorkConfig()} = {}) {
  office.ctx.assert();
  const text = String(id || '');
  if (!text) return null;
  if (text.startsWith('rec::')) {
    const [, defId, date] = text.split('::');
    const def = await office.r.workItemRecurrences.get(defId);
    if (!def || !expandRecurrence(def.rule, def.startDate, date, date).includes(date)) return null;
    const made = await office.r.workItems.range('recurrenceId_occurrenceDate', [defId, date], [defId, date], 1);
    if (made[0]) return buildNativeItem(made[0], {config});
    const item = buildNativeItem({id: text, title: def.title, description: def.description, type: def.type, dueDate: date, dueTime: def.dueTime, status: 'notStarted', priority: def.priority,
      tags: def.tags, fileId: def.fileId, caseId: def.caseId, clientId: def.clientId, opponentId: def.opponentId, relatedType: def.relatedType, relatedId: def.relatedId,
      recurrenceId: defId, occurrenceDate: date, createdAt: def.createdAt, updatedAt: def.updatedAt, version: 0}, {config});
    item.isVirtual = true; item.sourceLabel = 'مهمة متكررة';
    return item;
  }
  const raw = (await office.r.workItems.getManyRaw([text]))[0] || null;
  const ref = text.includes('::') ? {sourceType: text.slice(0, text.indexOf('::')), sourceId: text.slice(text.indexOf('::') + 2)} : null;
  if (!ref) return raw && raw.kind === WORK_KIND.native && !raw.isDeleted ? buildNativeItem(raw, {config}) : null;
  const source = workSource(ref.sourceType);
  if (!source) return raw ? buildOrphanItem(raw, {config}) : null;
  const row = (await office.r[source.store].getManyRaw([ref.sourceId]))[0] || null;
  if (row && isLiveSourceRow(row) && source.include(row)) return buildProjectedItem(source, row, raw, {config});
  return raw ? buildOrphanItem(raw, {config}) : null;
}

// ---------- عدّادات وملخصات (بسقف صريح؛ لا مسح غير محدود) ----------
export async function countWorkItems(office, specInput = {}, {cap = 500, signal = null} = {}) {
  let total = 0, cursor = null, partial = false;
  for (let guard = 0; guard < 400; guard++) {
    const r = await queryWorkItems(office, specInput, {cursor, limit: 100, signal});
    total += r.items.length;
    partial ||= r.partial;
    if (total >= cap) return {n: cap, capped: true, partial};
    if (!r.hasMore || !r.nextCursor) break;
    cursor = r.nextCursor;
  }
  return {n: total, capped: false, partial};
}

/** حزمة أرقام الرأس: مسح واحد لنافذة [اليوم − عمق المتأخر، اليوم + نافذة الملخص] لكل مصدر. */
export async function workSummary(office, {today = Clock.today(), signal = null, maxItems = 5000} = {}) {
  const config = getWorkConfig();
  const windowEnd = addDays(today, config.summaryWindowDays);
  const result = {today, overdue: 0, todayCount: 0, tomorrow: 0, week: 0, later: 0, undated: 0, urgentToday: 0, hearingsToday: 0, hearingsTomorrow: 0, hearingsNext7: 0,
    byPriority: {urgent: 0, high: 0, medium: 0, low: 0}, inProgress: 0, waiting: 0, postponed: 0, pinned: 0, doneToday: 0, capped: false, partial: false, nowCount: 0};
  const page = await queryWorkItems(office, {range: 'custom', from: '', to: windowEnd, kinds: ['open'], undated: true}, {limit: maxItems, signal});
  result.capped = page.hasMore; result.partial = page.partial;
  for (const item of page.items) {
    const bucket = classifyDue(item.dueDate, today);
    if (bucket === 'overdue') result.overdue++;
    else if (bucket === 'today') { result.todayCount++; if (item.priority === 'urgent') result.urgentToday++; }
    else if (bucket === 'tomorrow') result.tomorrow++;
    else if (bucket === 'week') result.week++;
    else if (bucket === 'later') result.later++;
    else result.undated++;
    if (item.sourceType === 'hearings') { if (bucket === 'today') result.hearingsToday++; if (bucket === 'tomorrow') result.hearingsTomorrow++; const d = dayDiff(today, item.dueDate); if (bucket !== 'overdue' && d >= 0 && d <= 7) result.hearingsNext7++; }
    result.byPriority[item.priority] = (result.byPriority[item.priority] || 0) + 1;
    if (item.status === 'inProgress') result.inProgress++;
    else if (item.status === 'waiting') result.waiting++;
    else if (item.status === 'postponed') result.postponed++;
    if (item.isPinned) result.pinned++;
  }
  const done = await queryWorkItems(office, {drive: 'completed', from: today, to: today}, {limit: 200, signal});
  result.doneToday = done.items.length;
  return result;
}

/** «الآن» و«التالي» لقائمة عناصر اليوم (مرتبة بالوقت): بلا افتراضات قانونية، مجرد قرب الوقت الحالي. */
export function nowAndNext(items, hhmm, {windowBefore = 60, windowAfter = 30} = {}) {
  const toMin = t => { const [h, m] = String(t || '').split(':').map(Number); return Number.isFinite(h) ? h * 60 + (m || 0) : null; };
  const nowMin = toMin(hhmm);
  const timed = items.filter(i => i.isOpen && toMin(i.dueTime) !== null).sort((a, b) => toMin(a.dueTime) - toMin(b.dueTime));
  const now = timed.filter(i => toMin(i.dueTime) <= nowMin + windowAfter && toMin(i.dueTime) >= nowMin - windowBefore);
  const next = timed.find(i => toMin(i.dueTime) > nowMin + windowAfter) || null;
  return {now, next};
}

export {sortKeyOf, priorityRank, isIsoDate};
