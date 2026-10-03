import {STORE, SYNCABLE_STORES} from '../db/schema.js';
import {SCHEMA_VERSION, APP_VERSION} from '../core/constants.js';
import {uid} from '../core/id.js';
import {Clock} from '../core/clock.js';
import {getDeviceId, getDeviceName} from '../core/device-id.js';
import {transaction, request} from '../db/unit-of-work.js';
import {events} from '../core/events.js';
import {SYNC_PACKAGE_FORMAT, SYNC_PACKAGE_VERSION} from './sync-transport.js';

const STATE = STORE.syncState;
const CHANGES = STORE.syncChanges;
const CONFLICTS = STORE.syncConflicts;
const PEERS = STORE.syncPeers;
const VECTOR_CAUSAL = 'causalVector';
const VECTOR_RECEIVED = 'receivedVector';
const BOOTSTRAP = 'initialBaseline';
const BATCH_SIZE = 100;
const MAX_BUNDLE_CHANGES = 500;
const MAX_BUNDLE_CHARS = 6 * 1024 * 1024;
const activeContexts = new Set();

const abortError = () => new DOMException('تم إلغاء المزامنة.', 'AbortError');
const now = () => Clock.now();
const peerKey = deviceId => `peer:${deviceId}`;
const sequenceKey = deviceId => `sequence:${deviceId}`;

function rangeOnly(key) { return IDBKeyRange.only(key); }
function clone(value) {
  try { return globalThis.structuredClone ? structuredClone(value) : JSON.parse(JSON.stringify(value)); }
  catch { return value; }
}
function plainVector(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return Object.create(null);
  const out = Object.create(null);
  for (const [device, seq] of Object.entries(value)) {
    if (!device || device.length > 100) continue;
    const n = Number(seq);
    if (Number.isSafeInteger(n) && n >= 0) out[device] = n;
  }
  return out;
}
function mergeVectors(...vectors) {
  const out = Object.create(null);
  for (const vector of vectors) for (const [device, seq] of Object.entries(plainVector(vector))) out[device] = Math.max(out[device] || 0, seq);
  return out;
}
function vectorRelation(left, right) {
  const a = plainVector(left), b = plainVector(right);
  let aGreater = false, bGreater = false;
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const av = a[key] || 0, bv = b[key] || 0;
    if (av > bv) aGreater = true;
    if (bv > av) bGreater = true;
  }
  if (!aGreater && !bGreater) return 'equal';
  if (aGreater && !bGreater) return 'after';
  if (bGreater && !aGreater) return 'before';
  return 'concurrent';
}
function stableValue(value) {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map(key => `${JSON.stringify(key)}:${stableValue(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
function sameValue(a, b) {
  try { return stableValue(a) === stableValue(b); }
  catch { return false; }
}
function idbRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('فشل طلب IndexedDB.'));
  });
}
async function latestEntityChange(tx, entity, entityId) {
  const store = tx.objectStore(CHANGES);
  const conflictStore = tx.objectStoreNames?.contains?.(CONFLICTS) ? tx.objectStore(CONFLICTS) : null;
  return new Promise((resolve, reject) => {
    const req = store.index('entity_entityId').openCursor(rangeOnly([entity, String(entityId)]), 'prev');
    const fail = () => reject(req.error || new Error('تعذر قراءة سجل التغيير.'));
    const next = cursor => { try { cursor.continue(); } catch (error) { reject(error); } };
    req.onerror = fail;
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) { resolve(null); return; }
      const change = cursor.value;
      if (change.applied === false) { next(cursor); return; }
      // Older v16 logs did not carry the materialized-head marker. A pending conflict row
      // identifies an un-applied branch; skip it rather than treating it as local state.
      if (change.applied == null && conflictStore) {
        const pendingConflict = conflictStore.get(change.changeId);
        pendingConflict.onerror = () => reject(pendingConflict.error || new Error('تعذر فحص سجل التعارض.'));
        pendingConflict.onsuccess = () => pendingConflict.result?.status === 'pending' ? next(cursor) : resolve(change);
        return;
      }
      resolve(change);
    };
  });
}
async function readState(ctx, id) {
  const tx = ctx.db.transaction(STATE, 'readonly');
  return idbRequest(tx.objectStore(STATE).get(id));
}
async function stateSnapshot(ctx) {
  const tx = ctx.db.transaction([STATE, PEERS, CONFLICTS], 'readonly');
  const [rows, peers, conflicts] = await Promise.all([
    idbRequest(tx.objectStore(STATE).getAll()),
    idbRequest(tx.objectStore(PEERS).getAll()),
    idbRequest(tx.objectStore(CONFLICTS).index('status').getAll(rangeOnly('pending')))
  ]);
  const state = new Map((rows || []).map(row => [row.id, row]));
  return {state, peers: peers || [], conflicts: conflicts || []};
}
function rowsCount(ctx) {
  return new Promise((resolve, reject) => {
    const tx = ctx.db.transaction(SYNCABLE_STORES, 'readonly');
    const totals = {};
    let pending = SYNCABLE_STORES.length;
    if (!pending) return resolve({total: 0, byStore: totals});
    for (const name of SYNCABLE_STORES) {
      const req = tx.objectStore(name).count();
      req.onsuccess = () => { totals[name] = req.result; if (--pending === 0) resolve({total: Object.values(totals).reduce((a, b) => a + b, 0), byStore: totals}); };
      req.onerror = () => reject(req.error || new Error(`تعذر عدّ السجلات في ${name}.`));
    }
    tx.onerror = () => reject(tx.error || new Error('تعذر عدّ السجلات المحلية.'));
  });
}
async function countMissingChanges(ctx, knownVector, localVector) {
  const known = plainVector(knownVector), local = plainVector(localVector);
  const origins = Object.keys(local);
  if (!origins.length) return 0;
  const tx = ctx.db.transaction(CHANGES, 'readonly');
  const index = tx.objectStore(CHANGES).index('originDeviceId_originSequence');
  const counts = await Promise.all(origins.map(origin => {
    const start = (known[origin] || 0) + 1, end = local[origin] || 0;
    if (start > end) return 0;
    const req = index.count(IDBKeyRange.bound([origin, start], [origin, end]));
    return idbRequest(req);
  }));
  return counts.reduce((a, b) => a + b, 0);
}
async function queryOriginChanges(ctx, origin, afterSequence, throughSequence, limit) {
  if (limit < 1 || afterSequence >= throughSequence) return [];
  const tx = ctx.db.transaction(CHANGES, 'readonly');
  const index = tx.objectStore(CHANGES).index('originDeviceId_originSequence');
  const range = IDBKeyRange.bound([origin, afterSequence + 1], [origin, throughSequence]);
  return new Promise((resolve, reject) => {
    const out = [];
    const req = index.openCursor(range, 'next');
    let expected = afterSequence + 1;
    req.onerror = () => reject(req.error || new Error('تعذر قراءة دفعة المزامنة.'));
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor || out.length >= limit) return resolve(out);
      const row = cursor.value;
      if (Number(row.originSequence) !== expected) return reject(new Error(`فجوة في سجل التغييرات للجهاز ${origin}: المتوقع ${expected} ووصل ${row.originSequence}. أُوقفت الحزمة دون تجاوز سجل.`));
      out.push(row);
      expected += 1;
      cursor.continue();
    };
  });
}
function serializableChange(change) {
  const copy = {...change};
  delete copy.sequence;
  delete copy.applied; // local materialization marker must not travel to another peer.
  return copy;
}
function localChangeOperation(oldRow, payload, method) {
  if (payload?.isDeleted === true) return 'delete';
  return method === 'add' || !oldRow ? 'create' : 'update';
}
function validateVector(value, label) {
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} غير صالح.`);
  for (const [device, seq] of Object.entries(value)) {
    if (!device || device.length > 100 || !Number.isSafeInteger(Number(seq)) || Number(seq) < 0) throw new Error(`${label} يحتوي مؤشرًا غير صالح.`);
  }
  return plainVector(value);
}

/** Validate untrusted file-exchange payloads before previewing or writing anything. */
export function validateSyncBundle(bundle, {deviceId = getDeviceId()} = {}) {
  if (!bundle || typeof bundle !== 'object' || bundle.format !== SYNC_PACKAGE_FORMAT) throw new Error('ملف غير صالح: ليس حزمة مزامنة لهذا البرنامج.');
  if (Number(bundle.version) !== SYNC_PACKAGE_VERSION) throw new Error(`إصدار حزمة المزامنة (${bundle.version || 'غير معروف'}) غير مدعوم.`);
  if (!bundle.sourceDeviceId || typeof bundle.sourceDeviceId !== 'string' || bundle.sourceDeviceId.length > 100) throw new Error('الحزمة لا تحمل هوية جهاز صالحة.');
  if (bundle.sourceDeviceId === deviceId) throw new Error('هذه الحزمة صادرة من الجهاز نفسه.');
  if (!Array.isArray(bundle.changes) || bundle.changes.length > 1000) throw new Error('عدد التغييرات في الحزمة يتجاوز الحد الآمن (1000).');
  if (!bundle.packageId || String(bundle.packageId).length > 140) throw new Error('معرّف حزمة المزامنة غير صالح.');
  validateVector(bundle.knownVector, 'متجه الجهاز المرسل');
  const seenIds = new Set(), seenSequences = new Set();
  for (const change of bundle.changes) {
    if (!change || typeof change !== 'object') throw new Error('يوجد تغيير غير صالح في الحزمة.');
    const id = String(change.changeId || ''), origin = String(change.originDeviceId || ''), entity = String(change.entity || ''), entityId = String(change.entityId || '');
    const sequence = Number(change.originSequence);
    if (!id || id.length > 140 || !origin || origin.length > 100 || !entityId || entityId.length > 200) throw new Error('التغيير يفتقد معرّفًا مطلوبًا.');
    if (!SYNCABLE_STORES.includes(entity)) throw new Error(`المخزن «${entity}» غير مسموح بالمزامنة.`);
    if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error('رقم تسلسل التغيير غير صالح.');
    if (!['create', 'update', 'delete'].includes(change.operation)) throw new Error('نوع عملية المزامنة غير مدعوم.');
    if (!change.payload || typeof change.payload !== 'object' || Array.isArray(change.payload) || String(change.payload.id) !== entityId) throw new Error('بيانات التغيير لا تطابق معرّف السجل.');
    if (change.operation === 'delete' && change.payload.isDeleted !== true) throw new Error('الحذف الوارد لا يحتوي Tombstone آمنًا.');
    const vector = validateVector(change.causalVector, 'متجه التغيير');
    if ((vector[origin] || 0) < sequence) throw new Error('متجه التغيير لا يغطي رقم تسلسله.');
    if (seenIds.has(id)) throw new Error('الحزمة تحتوي Change ID مكررًا.');
    const sequenceId = `${origin}\u0000${sequence}`;
    if (seenSequences.has(sequenceId)) throw new Error('الحزمة تحتوي تسلسلًا مكررًا للجهاز نفسه.');
    seenIds.add(id);
    seenSequences.add(sequenceId);
  }
  return true;
}

function decideRemoteApplication(localRow, localHead, remoteChange) {
  if (!localRow) return {kind: 'apply'};
  if (!localHead) return sameValue(localRow, remoteChange.payload) ? {kind: 'same'} : {kind: 'conflict'};
  const relation = vectorRelation(remoteChange.causalVector, localHead.causalVector);
  if (relation === 'after') return {kind: 'apply'};
  if (relation === 'before') return {kind: 'stale'};
  if (sameValue(localRow, remoteChange.payload)) return {kind: 'same'};
  // Equal vectors with different data are treated as an anomaly/conflict, never as a timestamp tie-break.
  return {kind: 'conflict'};
}

async function validateContiguousChanges(ctx, bundle, receivedVector) {
  const cursors = plainVector(receivedVector);
  const ordered = [...bundle.changes].sort((a, b) => String(a.originDeviceId).localeCompare(String(b.originDeviceId)) || Number(a.originSequence) - Number(b.originSequence));
  for (const change of ordered) {
    const origin = String(change.originDeviceId), sequence = Number(change.originSequence), cursor = cursors[origin] || 0;
    if (sequence <= cursor) continue;
    if (sequence !== cursor + 1) throw new Error(`الحزمة غير مكتملة لجهاز ${origin}: المتوقع التغيير ${cursor + 1} ووصل ${sequence}. استورد الدفعة السابقة أولًا.`);
    cursors[origin] = sequence;
  }
  // Reject conflicting claims about a sequence already held locally.
  if (ordered.length) {
    const tx = ctx.db.transaction(CHANGES, 'readonly');
    const index = tx.objectStore(CHANGES).index('originDeviceId_originSequence');
    for (const change of ordered) {
      const existing = await idbRequest(index.get([change.originDeviceId, Number(change.originSequence)]));
      if (existing && existing.changeId !== change.changeId) throw new Error('وجدت قاعدة البيانات Change ID مختلفًا للتسلسل نفسه؛ أُوقفت المزامنة دون استبدال أي بيانات.');
    }
  }
  return ordered;
}

async function countBundleDuplicates(ctx, changes) {
  if (!changes.length) return 0;
  const tx = ctx.db.transaction(CHANGES, 'readonly');
  const index = tx.objectStore(CHANGES).index('changeId');
  const results = await Promise.all(changes.map(change => idbRequest(index.getKey(change.changeId))));
  return results.filter(Boolean).length;
}

async function previewConflicts(ctx, changes) {
  if (!changes.length) return 0;
  const stores = [...new Set([CHANGES, CONFLICTS, ...changes.map(change => change.entity)])];
  const tx = ctx.db.transaction(stores, 'readonly');
  const simulated = new Map();
  let count = 0;
  for (const change of changes) {
    const key = `${change.entity}\u0000${change.entityId}`;
    let current = simulated.get(key);
    if (!current) {
      const row = await idbRequest(tx.objectStore(change.entity).get(change.entityId));
      const head = await latestEntityChange(tx, change.entity, change.entityId);
      current = {row: row || null, head};
      simulated.set(key, current);
    }
    const decision = decideRemoteApplication(current.row, current.head, change);
    if (decision.kind === 'conflict') { count += 1; continue; }
    if (decision.kind === 'apply') current.row = change.payload;
    if (decision.kind === 'apply' || decision.kind === 'same') current.head = change;
  }
  return count;
}

async function logActivity(ctx, {action, peerDeviceId = '', changes = 0, conflicts = 0, packageId = '', choice = ''}) {
  const timestamp = now();
  const id = action === 'sync-import' && packageId ? `sync-import:${packageId}` : uid();
  return transaction(ctx, [STORE.activityLog], async tx => {
    const activity = tx.objectStore(STORE.activityLog);
    if (await request(activity.get(id))) return;
    await request(activity.add({
      id, entityType: 'sync', entityId: peerDeviceId || packageId || uid(), action,
      timestamp, summary: action === 'sync-import' ? `استيراد ${changes} تغيير مزامنة` : action === 'sync-conflict-resolved' ? 'حسم تعارض مزامنة' : 'تبادل حزمة مزامنة',
      metadata: {changes, conflicts, ...(packageId ? {packageId} : {}), ...(choice ? {choice} : {})}
    }));
  }, {captureChanges: false});
}

export async function recordSyncExport(ctx, bundle) {
  ctx.assert();
  await logActivity(ctx, {action: 'sync-export', changes: Number(bundle?.changes?.length || 0), packageId: bundle?.packageId || ''});
}

async function saveFailure(ctx, error, processed = 0) {
  try {
    await transaction(ctx, [STATE], async tx => {
      await request(tx.objectStore(STATE).put({id: 'lastFailure', message: String(error?.message || error).slice(0, 300), at: now(), processed}));
    }, {captureChanges: false});
  } catch (writeError) { console.error('Unable to persist sync failure', writeError); }
}

export async function syncStatus(ctx) {
  ctx.assert();
  const [{state, peers, conflicts}, recordCounts] = await Promise.all([stateSnapshot(ctx), rowsCount(ctx)]);
  const receivedVector = plainVector(state.get(VECTOR_RECEIVED)?.value);
  const peerVectors = peers.map(peer => plainVector(peer.knownVector));
  const minimumKnown = {};
  for (const origin of Object.keys(receivedVector)) minimumKnown[origin] = peerVectors.length ? Math.min(...peerVectors.map(vector => vector[origin] || 0)) : 0;
  const pendingLogChanges = await countMissingChanges(ctx, minimumKnown, receivedVector);
  const bootstrap = state.get(BOOTSTRAP);
  const baselinePending = bootstrap?.complete ? 0 : recordCounts.total;
  const pendingChanges = pendingLogChanges + baselinePending;
  const lastSyncAt = peers.map(peer => peer.lastSyncAt || '').filter(Boolean).sort().at(-1) || state.get('lastSyncAt')?.value || null;
  const failure = state.get('lastFailure');
  let status = activeContexts.has(ctx.token) ? 'SYNCING' : conflicts.length ? 'CONFLICT' : failure && pendingChanges ? 'FAILED' : pendingChanges ? 'PENDING' : 'SYNCED';
  return {
    status,
    deviceId: ctx.deviceId || getDeviceId(),
    deviceName: getDeviceName(),
    lastSyncAt,
    pendingChanges,
    pendingLogChanges,
    baselinePending,
    baselineComplete: Boolean(bootstrap?.complete),
    unresolvedConflicts: conflicts.length,
    peers: peers.map(peer => ({deviceId: peer.deviceId, deviceName: peer.deviceName || 'جهاز آخر', lastSyncAt: peer.lastSyncAt || null, remoteConflictCount: Number(peer.remoteConflictCount || 0)})),
    lastFailure: failure ? {message: failure.message, at: failure.at, processed: failure.processed || 0} : null,
    recordCounts
  };
}

export async function previewSyncBundle(ctx, bundle) {
  ctx.assert();
  validateSyncBundle(bundle, {deviceId: ctx.deviceId || getDeviceId()});
  const state = await stateSnapshot(ctx);
  const localReceived = plainVector(state.state.get(VECTOR_RECEIVED)?.value);
  const orderedChanges = await validateContiguousChanges(ctx, bundle, localReceived);
  const duplicateCount = await countBundleDuplicates(ctx, orderedChanges);
  const existing = new Set();
  if (orderedChanges.length) {
    const tx = ctx.db.transaction(CHANGES, 'readonly');
    const index = tx.objectStore(CHANGES).index('changeId');
    for (const change of orderedChanges) if (await idbRequest(index.getKey(change.changeId))) existing.add(change.changeId);
  }
  const incomingNew = orderedChanges.filter(change => !existing.has(change.changeId));
  const localPending = await countMissingChanges(ctx, bundle.knownVector, localReceived);
  const baseline = state.state.get(BOOTSTRAP);
  const pendingBaseline = baseline?.complete ? 0 : (await rowsCount(ctx)).total;
  const conflicts = await previewConflicts(ctx, incomingNew);
  const peer = state.peers.find(row => row.deviceId === bundle.sourceDeviceId);
  return {
    peerDeviceId: bundle.sourceDeviceId,
    peerDeviceName: String(bundle.sourceDeviceName || 'جهاز آخر').slice(0, 80),
    lastSyncAt: peer?.lastSyncAt || bundle.lastSyncAt || null,
    localChanges: localPending + pendingBaseline,
    localLogChanges: localPending,
    baselinePending: pendingBaseline,
    remoteChanges: incomingNew.length,
    duplicateChanges: duplicateCount,
    conflicts,
    existingConflicts: state.conflicts.length,
    bundleHasMore: Boolean(bundle.hasMore),
    packageId: bundle.packageId,
    noChanges: incomingNew.length === 0 && localPending === 0 && pendingBaseline === 0
  };
}

function countStoreRows(ctx, storeName) {
  return idbRequest(ctx.db.transaction(storeName, 'readonly').objectStore(storeName).count());
}

/** Create the one-time, batched baseline for pre-existing records; never runs at boot or without user consent. */
export async function initializeSyncBaseline(ctx, {batchSize = 200, signal = null, onProgress = null} = {}) {
  ctx.assert();
  if (activeContexts.has(ctx.token)) throw new Error('هناك عملية مزامنة أخرى جارية في قاعدة البيانات.');
  const snapshot = await stateSnapshot(ctx);
  const prior = snapshot.state.get(BOOTSTRAP);
  if (prior?.complete) return {complete: true, generated: 0, scanned: prior.scanned || 0};
  const total = (await rowsCount(ctx)).total;
  let generated = 0;
  let scanned = 0;
  activeContexts.add(ctx.token);
  try {
    while (true) {
      if (signal?.aborted) throw signal.reason || abortError();
      const stateRow = await readState(ctx, BOOTSTRAP);
      let storeIndex = Math.max(0, Number(stateRow?.storeIndex || 0));
      let afterKey = stateRow?.afterKey ?? null;
      if (storeIndex >= SYNCABLE_STORES.length) {
        await transaction(ctx, [STATE], async tx => {
          await request(tx.objectStore(STATE).put({...stateRow, id: BOOTSTRAP, complete: true, completedAt: now()}));
        }, {captureChanges: false});
        break;
      }
      const storeName = SYNCABLE_STORES[storeIndex];
      let batch = {scanned: 0, generated: 0, storeIndex, afterKey, completeStore: false};
      await transaction(ctx, [storeName, CHANGES, STATE], async tx => {
        const stateStore = tx.objectStore(STATE), changes = tx.objectStore(CHANGES), rows = tx.objectStore(storeName);
        const [seqRow, causalRow, receivedRow, progressRow] = await Promise.all([
          request(stateStore.get(sequenceKey(ctx.deviceId))),
          request(stateStore.get(VECTOR_CAUSAL)),
          request(stateStore.get(VECTOR_RECEIVED)),
          request(stateStore.get(BOOTSTRAP))
        ]);
        let sequence = Number(seqRow?.value || 0);
        const causal = plainVector(causalRow?.value);
        const received = plainVector(receivedRow?.value);
        const range = progressRow?.afterKey != null ? IDBKeyRange.lowerBound(progressRow.afterKey, true) : undefined;
        await new Promise((resolve, reject) => {
          const cursorRequest = rows.openCursor(range);
          let settled = false;
          const finish = completeStore => {
            if (settled) return;
            settled = true;
            batch.storeIndex = storeIndex + (completeStore ? 1 : 0);
            batch.afterKey = completeStore ? null : batch.afterKey;
            batch.completeStore = completeStore;
            const stamp = now();
            stateStore.put({id: sequenceKey(ctx.deviceId), value: sequence, updatedAt: stamp});
            stateStore.put({id: VECTOR_CAUSAL, value: causal, updatedAt: stamp});
            stateStore.put({id: VECTOR_RECEIVED, value: received, updatedAt: stamp});
            stateStore.put({id: BOOTSTRAP, storeIndex: batch.storeIndex, afterKey: batch.afterKey, complete: batch.storeIndex >= SYNCABLE_STORES.length, startedAt: progressRow?.startedAt || stamp, updatedAt: stamp, scanned: Number(progressRow?.scanned || 0), generated: Number(progressRow?.generated || 0)});
            resolve();
          };
          cursorRequest.onerror = () => { if (!settled) { settled = true; reject(cursorRequest.error || new Error(`تعذر إنشاء خط الأساس لمخزن ${storeName}.`)); } };
          cursorRequest.onsuccess = () => {
            if (settled) return;
            const cursor = cursorRequest.result;
            if (!cursor) { finish(true); return; }
            if (batch.scanned >= Math.max(1, Math.min(500, batchSize))) { finish(false); return; }
            const row = cursor.value;
            batch.scanned += 1;
            batch.afterKey = cursor.primaryKey;
            const lookup = changes.index('entity_entityId').count([storeName, String(row.id)]);
            lookup.onerror = () => { if (!settled) { settled = true; reject(lookup.error || new Error('تعذر فحص سجل خط الأساس.')); } };
            lookup.onsuccess = () => {
              if (lookup.result > 0) { cursor.continue(); return; }
              sequence += 1;
              causal[ctx.deviceId] = sequence;
              received[ctx.deviceId] = sequence;
              const operation = row.isDeleted === true ? 'delete' : 'create';
              const change = {
                changeId: uid(), originDeviceId: ctx.deviceId, originSequence: sequence,
                entity: storeName, entityId: String(row.id), operation,
                changedAt: String(row.updatedAt || row.createdAt || now()),
                baseVersion: null, recordVersion: row.version ?? null,
                causalVector: {...causal}, applied: true, payload: clone(row), baseline: true
              };
              const add = changes.add(change);
              add.onerror = () => { if (!settled) { settled = true; reject(add.error || new Error('تعذر حفظ تغيير خط الأساس.')); } };
              add.onsuccess = () => { batch.generated += 1; cursor.continue(); };
            };
          };
        });
        const bootstrapRecord = await request(stateStore.get(BOOTSTRAP));
        // Progress values are kept in the same transaction as the changes so an interruption is restart-safe.
        if (bootstrapRecord) {
          bootstrapRecord.scanned = Number(bootstrapRecord.scanned || 0) + batch.scanned;
          bootstrapRecord.generated = Number(bootstrapRecord.generated || 0) + batch.generated;
          await request(stateStore.put(bootstrapRecord));
        }
      }, {captureChanges: false});
      generated += batch.generated;
      scanned += batch.scanned;
      const progress = await readState(ctx, BOOTSTRAP);
      if (onProgress) await onProgress({store: storeName, storeIndex: progress?.storeIndex || storeIndex, scanned: progress?.scanned || scanned, total, generated: progress?.generated || generated, complete: Boolean(progress?.complete)});
      if (progress?.complete) break;
    }
    return {complete: true, generated, scanned, total};
  } catch (error) {
    await saveFailure(ctx, error, scanned);
    throw error;
  } finally { activeContexts.delete(ctx.token); }
}

/** Incremental envelope. It queries only changes beyond the peer's per-device vector, never exports the database. */
export async function createSyncBundle(ctx, {peerKnownVector = {}, maxChanges = MAX_BUNDLE_CHANGES, maxChars = MAX_BUNDLE_CHARS, sourceDeviceName = getDeviceName()} = {}) {
  ctx.assert();
  const bootstrap = await readState(ctx, BOOTSTRAP);
  if (!bootstrap?.complete) throw new Error('لم يكتمل خط الأساس بعد. ابدأ مزامنة مؤكدة لأخذ نسخة الأمان وإنشاء خط الأساس على دفعات.');
  const snapshot = await stateSnapshot(ctx);
  const knownVector = plainVector(snapshot.state.get(VECTOR_RECEIVED)?.value);
  const remoteVector = plainVector(peerKnownVector);
  const max = Math.max(1, Math.min(1000, Math.floor(maxChanges)));
  const charLimit = Math.max(1024, Math.min(MAX_BUNDLE_CHARS, Math.floor(maxChars)));
  const origins = Object.keys(knownVector).sort((a, b) => a === ctx.deviceId ? -1 : b === ctx.deviceId ? 1 : a.localeCompare(b));
  const changes = [];
  let estimatedChars = 0;
  let hasMore = false;
  for (const origin of origins) {
    const peerSequence = remoteVector[origin] || 0;
    const localSequence = knownVector[origin] || 0;
    if (peerSequence >= localSequence) continue;
    if (changes.length >= max) { hasMore = true; break; }
    const rows = await queryOriginChanges(ctx, origin, peerSequence, localSequence, max - changes.length);
    for (const row of rows) {
      const payload = serializableChange(row);
      const chars = JSON.stringify(payload).length + 2;
      if (estimatedChars + chars > charLimit) {
        if (!changes.length) throw new Error('التغيير التالي أكبر من الحد الآمن لحزمة المزامنة؛ يلزم ناقل ملفات يدعم الملفات الكبيرة.');
        hasMore = true;
        break;
      }
      changes.push(payload);
      estimatedChars += chars;
    }
    const latestIncluded = changes.filter(row => row.originDeviceId === origin).at(-1)?.originSequence ?? peerSequence;
    if (latestIncluded < localSequence) hasMore = true;
    if (hasMore && (changes.length >= max || estimatedChars >= charLimit)) break;
  }
  const conflictCount = snapshot.conflicts.length;
  const envelope = {
    format: SYNC_PACKAGE_FORMAT,
    version: SYNC_PACKAGE_VERSION,
    applicationVersion: APP_VERSION,
    schemaVersion: SCHEMA_VERSION,
    packageId: uid(),
    sourceDeviceId: ctx.deviceId || getDeviceId(),
    sourceDeviceName: String(sourceDeviceName || getDeviceName()).slice(0, 80),
    createdAt: now(),
    lastSyncAt: snapshot.state.get('lastSyncAt')?.value || null,
    knownVector,
    changes,
    hasMore,
    pendingConflictCount: conflictCount
  };
  const finalChars = JSON.stringify(envelope).length;
  if (finalChars > charLimit && changes.length) throw new Error('تجاوزت بيانات الحزمة حد الحجم الآمن. أنشئ دفعات أصغر.');
  return envelope;
}

/** Applies changes in small atomic batches. Change IDs and source sequences make a rerun safe after interruption. */
export async function applySyncBundle(ctx, bundle, {batchSize = BATCH_SIZE, signal = null, onProgress = null} = {}) {
  ctx.assert();
  validateSyncBundle(bundle, {deviceId: ctx.deviceId || getDeviceId()});
  if (activeContexts.has(ctx.token)) throw new Error('هناك عملية مزامنة أخرى جارية في قاعدة البيانات.');
  const snapshot = await stateSnapshot(ctx);
  const received = plainVector(snapshot.state.get(VECTOR_RECEIVED)?.value);
  const ordered = await validateContiguousChanges(ctx, bundle, received);
  const existing = new Set();
  if (ordered.length) {
    const read = ctx.db.transaction(CHANGES, 'readonly');
    const byId = read.objectStore(CHANGES).index('changeId');
    for (const change of ordered) if (await idbRequest(byId.getKey(change.changeId))) existing.add(change.changeId);
  }
  const pending = ordered.filter(change => !existing.has(change.changeId));
  const size = Math.max(1, Math.min(250, Math.floor(batchSize)));
  const totals = {received: ordered.length, applied: 0, skipped: 0, duplicates: ordered.length - pending.length, conflicts: 0, batches: 0};
  activeContexts.add(ctx.token);
  try {
    for (let offset = 0; offset < pending.length; offset += size) {
      if (signal?.aborted) throw signal.reason || abortError();
      const batch = pending.slice(offset, offset + size);
      const stores = [...new Set([CHANGES, STATE, CONFLICTS, ...batch.map(change => change.entity)])];
      const touched = [];
      const outcome = {applied: 0, skipped: 0, conflicts: 0};
      await transaction(ctx, stores, async tx => {
        const stateStore = tx.objectStore(STATE), logStore = tx.objectStore(CHANGES), conflictStore = tx.objectStore(CONFLICTS);
        const [causalRow, receivedRow] = await Promise.all([request(stateStore.get(VECTOR_CAUSAL)), request(stateStore.get(VECTOR_RECEIVED))]);
        const causal = plainVector(causalRow?.value), receivedVector = plainVector(receivedRow?.value);
        for (const change of batch) {
          const knownById = await request(logStore.index('changeId').get(change.changeId));
          if (knownById) { outcome.skipped += 1; continue; }
          const knownBySequence = await request(logStore.index('originDeviceId_originSequence').get([change.originDeviceId, Number(change.originSequence)]));
          if (knownBySequence && knownBySequence.changeId !== change.changeId) throw new Error('تعارض في تسلسل Change ID؛ لم يتم اعتماد هذه الدفعة.');
          const store = tx.objectStore(change.entity);
          const localRow = await request(store.get(change.entityId));
          const head = await latestEntityChange(tx, change.entity, change.entityId);
          const decision = decideRemoteApplication(localRow || null, head, change);
          if (decision.kind === 'conflict') {
            if (!(await request(conflictStore.get(change.changeId)))) {
              await request(conflictStore.put({
                id: change.changeId, changeId: change.changeId,
                entity: change.entity, entityId: change.entityId, peerDeviceId: bundle.sourceDeviceId,
                peerDeviceName: String(bundle.sourceDeviceName || 'جهاز آخر').slice(0, 80),
                local: clone(localRow), remote: clone(change.payload),
                localChangeId: head?.changeId || null, remoteChangeId: change.changeId,
                localVector: clone(head?.causalVector || {}), remoteVector: clone(change.causalVector),
                status: 'pending', detectedAt: now(), resolvedAt: null, resolution: null
              }));
            }
            outcome.conflicts += 1;
          } else if (decision.kind === 'apply') {
            await request(store.put(clone(change.payload)));
            touched.push({entityType: change.entity, id: change.entityId});
            outcome.applied += 1;
          } else outcome.skipped += 1;

          const imported = serializableChange(change);
          delete imported.sequence;
          imported.applied = decision.kind === 'apply' || decision.kind === 'same';
          await request(logStore.add(imported));
          causalVectorMergeInto(causal, change.causalVector, change.originDeviceId, change.originSequence);
          receivedVector[change.originDeviceId] = Number(change.originSequence);
        }
        const stamp = now();
        await request(stateStore.put({id: VECTOR_CAUSAL, value: causal, updatedAt: stamp}));
        await request(stateStore.put({id: VECTOR_RECEIVED, value: receivedVector, updatedAt: stamp}));
        await request(stateStore.put({id: `apply:${bundle.packageId}`, packageId: bundle.packageId, sourceDeviceId: bundle.sourceDeviceId, processed: offset + batch.length, total: pending.length, updatedAt: stamp, complete: offset + batch.length >= pending.length}));
      }, {captureChanges: false});
      totals.applied += outcome.applied;
      totals.skipped += outcome.skipped;
      totals.conflicts += outcome.conflicts;
      totals.batches += 1;
      for (const event of touched) events.emit('entity:changed', event);
      if (onProgress) await onProgress({processed: Math.min(offset + batch.length, pending.length), total: pending.length, ...totals});
    }

    const timestamp = now();
    await transaction(ctx, [PEERS, STATE], async tx => {
      const peers = tx.objectStore(PEERS), states = tx.objectStore(STATE);
      const id = peerKey(bundle.sourceDeviceId);
      const existingPeer = await request(peers.get(id));
      await request(peers.put({
        ...(existingPeer || {}), id, deviceId: bundle.sourceDeviceId,
        deviceName: String(bundle.sourceDeviceName || 'جهاز آخر').slice(0, 80),
        knownVector: plainVector(bundle.knownVector), lastSyncAt: timestamp,
        lastReceivedAt: timestamp, lastPackageId: bundle.packageId,
        remoteConflictCount: Number(bundle.pendingConflictCount || 0)
      }));
      await request(states.put({id: 'lastSyncAt', value: timestamp, peerDeviceId: bundle.sourceDeviceId}));
      await request(states.delete('lastFailure'));
      const checkpoint = await request(states.get(`apply:${bundle.packageId}`));
      if (checkpoint) { checkpoint.complete = true; checkpoint.completedAt = timestamp; await request(states.put(checkpoint)); }
    }, {captureChanges: false});
    await logActivity(ctx, {action: 'sync-import', peerDeviceId: bundle.sourceDeviceId, changes: totals.applied + totals.skipped + totals.conflicts, conflicts: totals.conflicts, packageId: bundle.packageId});
    return {...totals, complete: true, peerDeviceId: bundle.sourceDeviceId, peerDeviceName: bundle.sourceDeviceName || 'جهاز آخر', packageId: bundle.packageId};
  } catch (error) {
    await saveFailure(ctx, error, totals.applied + totals.skipped + totals.conflicts);
    throw error;
  } finally { activeContexts.delete(ctx.token); }
}
function causalVectorMergeInto(target, vector, origin, sequence) {
  for (const [device, value] of Object.entries(plainVector(vector))) target[device] = Math.max(target[device] || 0, value);
  target[origin] = Math.max(target[origin] || 0, Number(sequence));
}

/** Explicit user choice. The local/remote values stay in the conflict store as an audit trail. */
export async function resolveSyncConflict(ctx, conflictId, choice, manualValue = null) {
  ctx.assert();
  if (!['local', 'remote', 'manual'].includes(choice)) throw new Error('اختيار حل التعارض غير صالح.');
  const before = await readConflict(ctx, conflictId);
  if (!before || before.status !== 'pending') throw new Error('التعارض غير موجود أو سبق حسمه.');
  const stores = [before.entity, CONFLICTS, CHANGES, STATE, STORE.activityLog];
  const result = await transaction(ctx, stores, async tx => {
    const conflictStore = tx.objectStore(CONFLICTS), rowStore = tx.objectStore(before.entity), changes = tx.objectStore(CHANGES), stateStore = tx.objectStore(STATE);
    const conflict = await request(conflictStore.get(conflictId));
    if (!conflict || conflict.status !== 'pending') throw new Error('التعارض تغير قبل الحسم؛ أعد تحميل الشاشة.');
    const current = await request(rowStore.get(conflict.entityId));
    const head = await latestEntityChange(tx, conflict.entity, conflict.entityId);
    // A conflicting remote branch is also in the immutable Change Log, so the newest log row is not
    // necessarily the value currently stored locally. Compare the actual stored value captured at detection.
    if (!sameValue(current || null, conflict.local || null)) throw new Error('تغيّرت القيمة المحلية بعد اكتشاف التعارض. راجع القيم الجديدة قبل اختيار الحل.');
    let selected;
    if (choice === 'local') selected = clone(conflict.local);
    else if (choice === 'remote') selected = clone(conflict.remote);
    else {
      if (!manualValue || typeof manualValue !== 'object' || Array.isArray(manualValue)) throw new Error('قيمة الدمج اليدوي يجب أن تكون كائن سجل صالحًا.');
      selected = clone(manualValue);
    }
    if (!selected || typeof selected !== 'object') throw new Error('القيمة المختارة غير متاحة.');
    selected.id = conflict.entityId;
    const stamp = now();
    selected.updatedAt = stamp;
    selected.version = Math.max(Number(current?.version || 0), Number(conflict.remote?.version || 0)) + 1;
    if (choice === 'manual' && selected.isDeleted !== true) selected.isDeleted = false;
    if (selected.isDeleted === true) { selected.deletedAt = selected.deletedAt || stamp; }
    await request(rowStore.put(selected));

    const [sequenceRow, causalRow, receivedRow] = await Promise.all([
      request(stateStore.get(sequenceKey(ctx.deviceId))),
      request(stateStore.get(VECTOR_CAUSAL)),
      request(stateStore.get(VECTOR_RECEIVED))
    ]);
    const sequence = Number(sequenceRow?.value || 0) + 1;
    const causal = mergeVectors(causalRow?.value, head?.causalVector, conflict.remoteVector);
    causal[ctx.deviceId] = sequence;
    const received = plainVector(receivedRow?.value);
    received[ctx.deviceId] = sequence;
    const changeId = uid();
    const change = {
      changeId, originDeviceId: ctx.deviceId, originSequence: sequence,
      entity: conflict.entity, entityId: conflict.entityId,
      operation: selected.isDeleted === true ? 'delete' : 'update', changedAt: stamp,
      baseVersion: current?.version ?? null, recordVersion: selected.version,
      causalVector: {...causal}, applied: true, payload: clone(selected), resolvesConflictId: conflict.id
    };
    await request(changes.add(change));
    await request(stateStore.put({id: sequenceKey(ctx.deviceId), value: sequence, updatedAt: stamp}));
    await request(stateStore.put({id: VECTOR_CAUSAL, value: causal, updatedAt: stamp}));
    await request(stateStore.put({id: VECTOR_RECEIVED, value: received, updatedAt: stamp}));
    const relatedConflicts = await request(conflictStore.index('entity_entityId').getAll([conflict.entity, conflict.entityId]));
    for (const related of relatedConflicts || []) {
      if (related.status !== 'pending') continue;
      if (related.id === conflict.id) {
        related.status = 'resolved';
        related.resolvedAt = stamp;
        related.resolution = choice;
        related.resolutionChangeId = changeId;
      } else if (related.peerDeviceId === conflict.peerDeviceId && ['after', 'equal'].includes(vectorRelation(conflict.remoteVector, related.remoteVector))) {
        // A later decision for the same peer branch covers its older pending snapshots, but
        // the old conflict row and both original values remain available for audit.
        related.status = 'superseded';
        related.resolvedAt = stamp;
        related.resolution = 'superseded-by-later-remote-change';
        related.resolutionChangeId = changeId;
      } else continue;
      await request(conflictStore.put(related));
    }
    await request(tx.objectStore(STORE.activityLog).add({
      id: uid(), entityType: 'sync', entityId: conflict.id, action: 'conflict-resolved', timestamp: stamp,
      summary: 'حسم تعارض مزامنة', metadata: {choice, changeId}
    }));
    return {entityType: conflict.entity, id: conflict.entityId, changeId, choice};
  }, {captureChanges: false});
  events.emit('entity:changed', {entityType: result.entityType, id: result.id});
  return result;
}
async function readConflict(ctx, id) {
  return idbRequest(ctx.db.transaction(CONFLICTS, 'readonly').objectStore(CONFLICTS).get(id));
}

export async function listSyncConflicts(ctx, {limit = 100, status = 'pending'} = {}) {
  ctx.assert();
  const tx = ctx.db.transaction(CONFLICTS, 'readonly');
  const index = tx.objectStore(CONFLICTS).index('status');
  return new Promise((resolve, reject) => {
    const out = [], cursor = index.openCursor(rangeOnly(status), 'prev');
    cursor.onerror = () => reject(cursor.error || new Error('تعذر قراءة تعارضات المزامنة.'));
    cursor.onsuccess = () => {
      const current = cursor.result;
      if (!current || out.length >= Math.max(1, Math.min(500, limit))) return resolve(out);
      out.push(current.value);
      current.continue();
    };
  });
}

export async function syncHistory(ctx, limit = 30) {
  ctx.assert();
  const tx = ctx.db.transaction(STORE.activityLog, 'readonly');
  return new Promise((resolve, reject) => {
    const out = [], cursor = tx.objectStore(STORE.activityLog).index('entityType').openCursor(rangeOnly('sync'), 'prev');
    cursor.onerror = () => reject(cursor.error || new Error('تعذر قراءة سجل المزامنة.'));
    cursor.onsuccess = () => {
      const current = cursor.result;
      if (!current || out.length >= Math.max(1, Math.min(100, limit))) return resolve(out);
      out.push(current.value);
      current.continue();
    };
  });
}

export const SYNC_ENGINE_DEFAULTS = Object.freeze({batchSize: BATCH_SIZE, maxChanges: MAX_BUNDLE_CHANGES, maxBundleChars: MAX_BUNDLE_CHARS});
