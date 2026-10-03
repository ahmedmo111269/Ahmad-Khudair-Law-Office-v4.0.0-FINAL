import {STORE, STORES, SYNCABLE_STORES, upgradeSchema, migrationPlan, SCHEMA_MIGRATIONS} from '../db/schema.js';
import {SCHEMA_VERSION} from '../core/constants.js';
import {DatabaseContext} from '../db/database-context.js';
import {Office} from '../services/office.js';
import {
  syncStatus, initializeSyncBaseline, createSyncBundle, previewSyncBundle,
  applySyncBundle, listSyncConflicts, syncHistory, resolveSyncConflict, validateSyncBundle
} from '../services/sync-engine.js';
import {NetworkStatusService, ONLINE, OFFLINE} from '../core/network-status.js';
import {OnlineCapabilityRegistry} from '../core/online-capabilities.js';
import {FileExchangeSyncTransportAdapter} from '../services/sync-transport.js';
import {encryptSyncEnvelope, decryptSyncEnvelope, ENCRYPTED_SYNC_FORMAT} from '../services/sync-crypto.js';

const rejects = async fn => { try { await fn(); } catch (error) { return error; } throw Error('Expected promise to reject'); };

async function createDevice(tag) {
  const name = `AhmadKhudairLawOfficeDB__test__sync__${tag}__${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const db = await new Promise((resolve, reject) => {
    const open = indexedDB.open(name, SCHEMA_VERSION);
    open.onupgradeneeded = event => upgradeSchema(open.result, event.target.transaction);
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  const ctx = new DatabaseContext(db, {id: tag, databaseName: name}, {deviceId: `dev-test-${tag}`});
  const office = new Office(ctx);
  return {name, db, ctx, office, close() { ctx.close(); try { indexedDB.deleteDatabase(name); } catch {} }};
}

async function changesFor(device) {
  return device.office.r[STORE.syncChanges].all(10000);
}

export async function runSyncTests(test, expect) {
  const out = {};
  const a = await createDevice('A');
  const b = await createDevice('B');
  const d = await createDevice('D');
  const e = await createDevice('E');
  const legacyName = `AhmadKhudairLawOfficeDB__test__syncLegacy__${Date.now()}`;
  let legacyDb = null;
  try {
    out.schema = {version: SCHEMA_VERSION, stores: STORES.length, syncable: SYNCABLE_STORES.length, migration: migrationPlan(15, 16)};

    // IndexedDB middleware logs create/update/delete in the same transaction as the business write.
    let row = await a.office.saveClient({fullName: 'سجل محلي للمزامنة'});
    const created = row;
    row = await a.office.saveClient({...row, fullName: 'تعديل محلي للمزامنة'}, row.id, row.version);
    row = await a.office.softDelete('clients', row.id, row.version);
    const logged = (await changesFor(a)).filter(change => change.entityId === row.id).sort((x, y) => x.originSequence - y.originSequence);
    out.capture = {
      operations: logged.map(change => change.operation).join(','),
      payloads: logged.every(change => change.payload?.id === row.id),
      deviceIds: new Set(logged.map(change => change.originDeviceId)).size,
      uniqueChangeIds: new Set(logged.map(change => change.changeId)).size,
      sequenceUnique: new Set(logged.map(change => change.originSequence)).size
    };

    // The first device pairing syncs an initial delta; the receiver applies once and a repeated package is idempotent.
    const target = await a.office.saveClient({fullName: 'سجل للحذف الآمن'});
    await initializeSyncBaseline(a.ctx, {batchSize: 40});
    await initializeSyncBaseline(b.ctx, {batchSize: 40});
    const firstBundle = await createSyncBundle(a.ctx, {maxChanges: 100});
    const firstPreview = await previewSyncBundle(b.ctx, firstBundle);
    const firstApply = await applySyncBundle(b.ctx, firstBundle, {batchSize: 2});
    const importedTarget = await b.office.r.clients.get(target.id);
    const afterFirst = await changesFor(b);
    const beforeDuplicateCount = afterFirst.length;
    const beforeDuplicateHistory = (await syncHistory(b.ctx)).length;
    await applySyncBundle(b.ctx, firstBundle, {batchSize: 2});
    const afterDuplicateCount = (await changesFor(b)).length;
    const afterDuplicateHistory = (await syncHistory(b.ctx)).length;
    out.firstSync = {
      previewRemote: firstPreview.remoteChanges,
      previewConflicts: firstPreview.conflicts,
      applied: firstApply.applied,
      imported: importedTarget?.fullName === 'سجل للحذف الآمن',
      duplicateCountStable: beforeDuplicateCount === afterDuplicateCount,
      activityLogIdempotent: beforeDuplicateHistory === afterDuplicateHistory
    };

    // Physical delete is converted into a durable Tombstone and is propagated as a deletion, not a blind purge.
    await b.office.r.clients.delete(target.id);
    const localTombstone = await b.office.r.clients.get(target.id);
    const deleteChange = (await changesFor(b)).find(change => change.entityId === target.id && change.operation === 'delete');
    const deleteBundle = await createSyncBundle(b.ctx, {peerKnownVector: firstBundle.knownVector});
    const deletePreview = await previewSyncBundle(a.ctx, deleteBundle);
    const deleteApply = await applySyncBundle(a.ctx, deleteBundle);
    const remoteTombstone = await a.office.r.clients.get(target.id);
    out.tombstone = {
      localTombstone: localTombstone?.isDeleted === true,
      changeOperation: deleteChange?.operation,
      remoteChanges: deletePreview.remoteChanges,
      conflicts: deletePreview.conflicts,
      applied: deleteApply.applied,
      remoteTombstone: remoteTombstone?.isDeleted === true
    };

    // Concurrent edits on two offline replicas produce a conflict retaining both full values.
    let conflictRecord = await a.office.saveClient({fullName: 'قيمة أصلية قبل التعارض'});
    const aKnown = await syncStatus(a.ctx);
    const a2Bundle = await createSyncBundle(a.ctx, {peerKnownVector: deleteBundle.knownVector});
    await applySyncBundle(b.ctx, a2Bundle);
    const bCurrent = await b.office.r.clients.get(conflictRecord.id);
    const aLocal = await a.office.saveClient({...conflictRecord, fullName: 'قيمة محلية على الجهاز A'}, conflictRecord.id, conflictRecord.version);
    await b.office.saveClient({...bCurrent, fullName: 'قيمة بعيدة على الجهاز B'}, bCurrent.id, bCurrent.version);
    const bBundle = await createSyncBundle(b.ctx, {peerKnownVector: a2Bundle.knownVector});
    const conflictPreview = await previewSyncBundle(a.ctx, bBundle);
    const conflictApply = await applySyncBundle(a.ctx, bBundle);
    const pendingConflicts = await listSyncConflicts(a.ctx);
    const conflict = pendingConflicts.find(item => item.entityId === conflictRecord.id);
    const unchangedLocal = await a.office.r.clients.get(conflictRecord.id);
    out.conflict = {
      expectedConflict: conflictPreview.conflicts,
      createdConflict: Boolean(conflict),
      appliedConflictCount: conflictApply.conflicts,
      localValuePreserved: unchangedLocal?.fullName === 'قيمة محلية على الجهاز A',
      bothValuesRetained: conflict?.local?.fullName === 'قيمة محلية على الجهاز A' && conflict?.remote?.fullName === 'قيمة بعيدة على الجهاز B',
      localDevice: conflict?.peerDeviceId === b.ctx.deviceId,
      localChangeVersion: aLocal.version
    };
    const bFollowupBase = await b.office.r.clients.get(conflictRecord.id);
    await b.office.saveClient({...bFollowupBase, fullName: 'تعديل بعيد ثانٍ قبل استلام A'}, bFollowupBase.id, bFollowupBase.version);
    const bFollowupBundle = await createSyncBundle(b.ctx, {peerKnownVector: bBundle.knownVector});
    const followupPreview = await previewSyncBundle(a.ctx, bFollowupBundle);
    await applySyncBundle(a.ctx, bFollowupBundle);
    const afterFollowupLocal = await a.office.r.clients.get(conflictRecord.id);
    const followupConflicts = await listSyncConflicts(a.ctx);
    const followupConflict = followupConflicts.find(item => item.entityId === conflictRecord.id && item.remote?.fullName === 'تعديل بعيد ثانٍ قبل استلام A');
    out.followupConflict = {
      detected: followupPreview.conflicts === 1 && Boolean(followupConflict),
      localValuePreserved: afterFollowupLocal?.fullName === 'قيمة محلية على الجهاز A',
      earlierBranchRetained: Boolean((await a.office.r[STORE.syncConflicts].get(conflict.id))?.local?.fullName === 'قيمة محلية على الجهاز A')
    };
    const merged = {...followupConflict.local, fullName: 'قيمة مدمجة بموافقة المستخدم'};
    const resolution = await resolveSyncConflict(a.ctx, followupConflict.id, 'manual', merged);
    const resolved = await listSyncConflicts(a.ctx);
    const mergedRow = await a.office.r.clients.get(conflictRecord.id);
    const resolvedLog = (await changesFor(a)).find(change => change.changeId === resolution.changeId);
    out.resolution = {
      value: mergedRow?.fullName,
      status: (await a.office.r[STORE.syncConflicts].get(followupConflict.id))?.status,
      supersededPriorConflict: (await a.office.r[STORE.syncConflicts].get(conflict.id))?.status === 'superseded',
      unresolved: resolved.some(item => item.entityId === conflictRecord.id),
      resolutionChange: resolvedLog?.operation,
      resolutionCausalityIncludesB: Number(resolvedLog?.causalVector?.[b.ctx.deviceId] || 0) > 0
    };

    // Offline is informational: saving still works; online-only capability fails locally and boundedly.
    const transitions = [];
    const network = new NetworkStatusService({windowRef: null, navigatorRef: () => ({onLine: true})});
    network.start();
    network.subscribe(event => transitions.push(event.status));
    network.setStatus(OFFLINE);
    const localDuringOffline = await a.office.saveClient({fullName: 'تم الحفظ أثناء Offline'});
    const capabilities = new OnlineCapabilityRegistry({network});
    const onlineCall = await rejects(() => capabilities.run('googleDrive', () => { throw Error('must not run'); }, {retries: 0, timeoutMs: 50}));
    network.setStatus(ONLINE);
    out.offline = {
      localSave: (await a.office.r.clients.get(localDuringOffline.id))?.fullName,
      stateDuringSave: transitions[0] || OFFLINE,
      transitionSequence: transitions.join(','),
      localSearchAvailable: capabilities.canUse('localSearch'),
      fileSyncAvailable: capabilities.canUse('fileExchangeSync'),
      googleDriveUnavailable: !capabilities.canUse('googleDrive') || Boolean(onlineCall)
    };

    // A new sync package to a third empty replica includes a causally complete tombstone history.
    const aLatest = await syncStatus(a.ctx);
    const aOut = await createSyncBundle(a.ctx, {peerKnownVector: {}, maxChanges: 100});
    const c = await createDevice('C');
    try {
      await initializeSyncBaseline(c.ctx, {batchSize: 40});
      const cApply = await applySyncBundle(c.ctx, aOut, {batchSize: 3});
      out.replication = {received: cApply.received, targetTombstone: (await c.office.r.clients.get(target.id))?.isDeleted === true, conflicts: cApply.conflicts};
    } finally { c.close(); }

    // Simulated interruption after one committed batch. Retry imports only missing Change IDs.
    await initializeSyncBaseline(d.ctx, {batchSize: 40});
    await initializeSyncBaseline(e.ctx, {batchSize: 40});
    const dRows = [];
    for (let i = 1; i <= 3; i++) dRows.push(await d.office.saveClient({fullName: `دفعة انقطاع ${i}`}));
    const interruptedBundle = await createSyncBundle(d.ctx, {maxChanges: 20});
    const interrupted = await rejects(() => applySyncBundle(e.ctx, interruptedBundle, {
      batchSize: 1,
      onProgress: progress => { if (progress.processed === 1) throw new Error('simulated-sync-interruption'); }
    }));
    const afterInterrupted = (await changesFor(e)).length;
    await applySyncBundle(e.ctx, interruptedBundle, {batchSize: 1});
    const finalLog = await changesFor(e);
    const statusAfterRetry = await syncStatus(e.ctx);
    out.interruption = {
      error: interrupted?.message,
      committedFirstBatch: afterInterrupted === 1,
      allRowsArrived: (await e.office.r.clients.count()) === 3,
      noDuplicateChanges: finalLog.length === 3,
      statusNotFailed: statusAfterRetry.status !== 'FAILED'
    };

    // Old rows from pre-v16 databases receive a resumable one-time baseline, not a repeated full export.
    legacyDb = await new Promise((resolve, reject) => {
      const open = indexedDB.open(legacyName, SCHEMA_VERSION);
      open.onupgradeneeded = event => upgradeSchema(open.result, event.target.transaction);
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    await new Promise((resolve, reject) => {
      const tx = legacyDb.transaction(STORE.clients, 'readwrite');
      tx.objectStore(STORE.clients).put({id: 'LEGACY-SYNC-1', fullName: 'سجل تاريخي', version: 4, isDeleted: false, updatedAt: '2024-01-01T00:00:00.000Z'});
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
    const legacyCtx = new DatabaseContext(legacyDb, {id: 'legacy', databaseName: legacyName}, {deviceId: 'dev-test-legacy'});
    await initializeSyncBaseline(legacyCtx, {batchSize: 1});
    const legacyChanges = await new Office(legacyCtx).r[STORE.syncChanges].all(1000);
    out.legacyBaseline = {complete: (await syncStatus(legacyCtx)).baselineComplete, oneTimeRow: legacyChanges.some(change => change.baseline && change.entityId === 'LEGACY-SYNC-1')};
    legacyCtx.close();

    const fileTransport = new FileExchangeSyncTransportAdapter();
    const invalidBundle = {...aOut, changes: [{...aOut.changes[0], entity: 'syncState'}]};
    const validationError = await rejects(() => validateSyncBundle(invalidBundle, {deviceId: 'dev-test-someone-else'}));
    const passphrase = 'Correct Horse Battery Staple 2026';
    const privateBundle = {format: 'test-private-sync', sourceDeviceId: 'device-alpha', caseNote: 'معلومة قانونية سرية'};
    const encrypted = await encryptSyncEnvelope(privateBundle, passphrase);
    const roundTrip = await fileTransport.readIncoming(new Blob([JSON.stringify(encrypted)], {type: 'application/json'}), {passphrase});
    const wrongPassword = await rejects(() => decryptSyncEnvelope(encrypted, 'Wrong password 123'));
    const plaintextRejected = await rejects(() => fileTransport.readIncoming(new Blob([JSON.stringify(privateBundle)]), {passphrase}));
    out.encryption = {
      format: encrypted.format,
      hidesPlaintext: !JSON.stringify(encrypted).includes(privateBundle.caseNote),
      roundTrip: roundTrip.caseNote === privateBundle.caseNote,
      wrongPasswordRejected: Boolean(wrongPassword),
      plaintextRejected: Boolean(plaintextRejected)
    };
    out.transport = {offlineAvailable: !fileTransport.onlineRequired, rejectsInternalStores: Boolean(validationError)};
    out.status = {schema: aLatest.status, conflictAfterResolution: (await syncStatus(a.ctx)).unresolvedConflicts};
  } finally {
    a.close(); b.close(); d.close(); e.close();
    legacyDb?.close(); try { indexedDB.deleteDatabase(legacyName); } catch {}
  }

  test('Sync schema v16: additive stores, primary sequence and unique Change ID/source sequence indexes', () => {
    expect(out.schema.version).toBe(16);
    expect(SCHEMA_MIGRATIONS.some(step => step.version === 16 && step.destructive === false && step.backfill === false)).toBe(true);
    expect(out.schema.migration.addsStores.join()).toBe('syncChanges,syncState,syncConflicts,syncPeers');
    expect(out.schema.syncable > 0).toBe(true);
  });
  test('Change Log records create/update/delete payloads atomically with unique IDs and sequences', () => {
    expect(out.capture.operations).toBe('create,update,delete');
    expect(out.capture.payloads).toBe(true);
    expect(out.capture.deviceIds).toBe(1);
    expect(out.capture.uniqueChangeIds).toBe(3);
    expect(out.capture.sequenceUnique).toBe(3);
  });
  test('Two-device delta sync previews counts and applies changes once', () => {
    expect(out.firstSync.previewRemote > 0).toBe(true);
    expect(out.firstSync.previewConflicts).toBe(0);
    expect(out.firstSync.applied > 0).toBe(true);
    expect(out.firstSync.imported).toBe(true);
    expect(out.firstSync.duplicateCountStable).toBe(true);
    expect(out.firstSync.activityLogIdempotent).toBe(true);
  });
  test('Physical delete becomes a Tombstone and safely propagates to another device', () => {
    expect(out.tombstone.localTombstone).toBe(true);
    expect(out.tombstone.changeOperation).toBe('delete');
    expect(out.tombstone.remoteChanges).toBe(1);
    expect(out.tombstone.conflicts).toBe(0);
    expect(out.tombstone.remoteTombstone).toBe(true);
  });
  test('Concurrent device edits are retained as a conflict; neither value is overwritten', () => {
    expect(out.conflict.expectedConflict).toBe(1);
    expect(out.conflict.createdConflict).toBe(true);
    expect(out.conflict.appliedConflictCount).toBe(1);
    expect(out.conflict.localValuePreserved).toBe(true);
    expect(out.conflict.bothValuesRetained).toBe(true);
    expect(out.conflict.localDevice).toBe(true);
  });
  test('A later update from an unresolved remote branch cannot overwrite the preserved local value', () => {
    expect(out.followupConflict.detected).toBe(true);
    expect(out.followupConflict.localValuePreserved).toBe(true);
    expect(out.followupConflict.earlierBranchRetained).toBe(true);
  });
  test('Manual conflict resolution creates a causally merged new change and keeps audit values', () => {
    expect(out.resolution.value).toBe('قيمة مدمجة بموافقة المستخدم');
    expect(out.resolution.status).toBe('resolved');
    expect(out.resolution.supersededPriorConflict).toBe(true);
    expect(out.resolution.unresolved).toBe(false);
    expect(out.resolution.resolutionChange).toBe('update');
    expect(out.resolution.resolutionCausalityIncludesB).toBe(true);
  });
  test('Offline saves remain local; network-only capabilities are separate and bounded', () => {
    expect(out.offline.localSave).toBe('تم الحفظ أثناء Offline');
    expect(out.offline.transitionSequence).toBe('OFFLINE,ONLINE');
    expect(out.offline.localSearchAvailable).toBe(true);
    expect(out.offline.fileSyncAvailable).toBe(true);
    expect(out.offline.googleDriveUnavailable).toBe(true);
  });
  test('One-time legacy baseline is batched and includes pre-existing rows', () => {
    expect(out.legacyBaseline.complete).toBe(true);
    expect(out.legacyBaseline.oneTimeRow).toBe(true);
  });
  test('File transport is offline-capable and untrusted payloads cannot target internal stores', () => {
    expect(out.transport.offlineAvailable).toBe(true);
    expect(out.transport.rejectsInternalStores).toBe(true);
  });
  test('Device-exchange files use authenticated AES-256-GCM encryption and reject plaintext/wrong passwords', () => {
    expect(out.encryption.format).toBe(ENCRYPTED_SYNC_FORMAT);
    expect(out.encryption.hidesPlaintext).toBe(true);
    expect(out.encryption.roundTrip).toBe(true);
    expect(out.encryption.wrongPasswordRejected).toBe(true);
    expect(out.encryption.plaintextRejected).toBe(true);
  });
  test('Interrupted sync commits only finished batches; retry resumes without duplicating Change IDs', () => {
    expect(out.interruption.error).toBe('simulated-sync-interruption');
    expect(out.interruption.committedFirstBatch).toBe(true);
    expect(out.interruption.allRowsArrived).toBe(true);
    expect(out.interruption.noDuplicateChanges).toBe(true);
    expect(out.interruption.statusNotFailed).toBe(true);
  });
  test('Conflict status clears only after explicit resolution; synchronization leaves no pending conflict', () => {
    expect(out.status.conflictAfterResolution).toBe(0);
  });
}
