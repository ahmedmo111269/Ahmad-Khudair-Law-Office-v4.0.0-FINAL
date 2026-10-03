import {uid} from '../core/id.js';
import {getDeviceId} from '../core/device-id.js';
import {AppError,ERR} from '../core/errors.js';
import {SYNCABLE_STORES,STORE} from './schema.js';

const CAPTURE_STORES = new Set(SYNCABLE_STORES);
const SYSTEM_STORES = [STORE.syncChanges, STORE.syncState];
const IDB_KEYS = globalThis.IDBKeyRange;

function storeNames(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.map(String);
  if (value && typeof value.length === 'number') return Array.from(value, String);
  return [];
}

function cloneRow(value) {
  try { return globalThis.structuredClone ? structuredClone(value) : value; }
  catch { return value; }
}

function rowId(store, value, key = undefined) {
  const path = store.keyPath;
  if (typeof path === 'string') return value?.[path] ?? key;
  if (Array.isArray(path)) return key ?? (value ? path.map(part => value[part]) : undefined);
  return key ?? value?.id;
}

function listen(request, type, handler) {
  if (typeof request.addEventListener === 'function') request.addEventListener(type, handler);
  else {
    const property = `on${type}`;
    const previous = request[property];
    request[property] = event => { previous?.call(request, event); handler(event); };
  }
}

function makeCaptureQueue(rawTx, context) {
  const pending = [];
  let started = false;
  let ready = false;
  let processing = false;
  let position = 0;
  let sequence = 0;
  let causalVector = {};
  let receivedVector = {};
  const stateStore = rawTx.objectStore(STORE.syncState);
  const logStore = rawTx.objectStore(STORE.syncChanges);
  const deviceId = context.deviceId;
  const sequenceKey = `sequence:${deviceId}`;
  const clockKey = 'causalVector';
  const receivedKey = 'receivedVector';

  const processNext = () => {
    if (!ready || processing) return;
    if (position >= pending.length) return;
    processing = true;
    const item = pending[position++];
    sequence += 1;
    causalVector[deviceId] = sequence;
    receivedVector[deviceId] = sequence;
    const change = {
      changeId: uid(),
      originDeviceId: deviceId,
      originSequence: sequence,
      entity: item.entity,
      entityId: item.entityId,
      operation: item.operation,
      changedAt: item.changedAt,
      baseVersion: item.oldRow?.version ?? null,
      recordVersion: item.payload?.version ?? null,
      causalVector: {...causalVector},
      applied: true,
      payload: item.payload
    };
    const add = logStore.add(change);
    listen(add, 'success', () => {
      const now = new Date().toISOString();
      stateStore.put({id: sequenceKey, value: sequence, updatedAt: now});
      stateStore.put({id: clockKey, value: {...causalVector}, updatedAt: now});
      stateStore.put({id: receivedKey, value: {...receivedVector}, updatedAt: now});
      processing = false;
      processNext();
    });
  };

  const enqueue = item => {
    pending.push(item);
    if (!started) {
      started = true;
      let loaded = 0;
      const done = () => { if (++loaded === 3) { ready = true; processNext(); } };
      const seq = stateStore.get(sequenceKey);
      const clock = stateStore.get(clockKey);
      const received = stateStore.get(receivedKey);
      listen(seq, 'success', () => { sequence = Number(seq.result?.value || 0); done(); });
      listen(clock, 'success', () => { causalVector = {...(clock.result?.value || {})}; done(); });
      listen(received, 'success', () => { receivedVector = {...(received.result?.value || {})}; done(); });
    } else processNext();
  };

  return {enqueue};
}

function wrapStore(rawStore, name, captureQueue) {
  if (!captureQueue || !CAPTURE_STORES.has(name)) return rawStore;
  return new Proxy(rawStore, {
    get(target, property) {
      if (property === 'put' || property === 'add') {
        return (value, key = undefined) => {
          const payload = cloneRow(value);
          const id = rowId(target, payload, key);
          if (id === undefined || id === null) return target[property](value, ...(key === undefined ? [] : [key]));
          const oldRequest = target.get(id);
          const writeRequest = target[property](value, ...(key === undefined ? [] : [key]));
          let oldReady = false;
          let writeReady = false;
          let oldRow = null;
          let recorded = false;
          const queueIfReady = () => {
            if (!oldReady || !writeReady || recorded) return;
            recorded = true;
            const stamp = new Date().toISOString();
            const deleted = payload?.isDeleted === true;
            const operation = deleted ? 'delete' : (property === 'add' || !oldRow ? 'create' : 'update');
            captureQueue.enqueue({
              entity: name,
              entityId: String(id),
              operation,
              changedAt: String(payload?.updatedAt || payload?.deletedAt || stamp),
              oldRow,
              payload
            });
          };
          listen(oldRequest, 'success', () => { oldRow = cloneRow(oldRequest.result || null); oldReady = true; queueIfReady(); });
          listen(writeRequest, 'success', () => { writeReady = true; queueIfReady(); });
          return writeRequest;
        };
      }

      if (property === 'delete') {
        return key => {
          const oldRequest = target.get(key);
          const deleteRequest = target.delete(key);
          let oldRow = null;
          listen(oldRequest, 'success', () => { oldRow = cloneRow(oldRequest.result || null); });
          listen(deleteRequest, 'success', () => {
            const stamp = new Date().toISOString();
            const id = rowId(target, oldRow, key);
            const path = target.keyPath;
            const tombstone = {
              ...(oldRow || {}),
              ...(typeof path === 'string' ? {[path]: id} : {id}),
              isDeleted: true,
              deletedAt: oldRow?.deletedAt || stamp,
              updatedAt: stamp,
              version: Number(oldRow?.version || 0) + 1
            };
            const tombstoneRequest = target.put(tombstone);
            listen(tombstoneRequest, 'success', () => captureQueue.enqueue({
              entity: name,
              entityId: String(id),
              operation: 'delete',
              changedAt: stamp,
              oldRow,
              payload: tombstone
            }));
          });
          return deleteRequest;
        };
      }

      if (property === 'clear') {
        return () => { throw new Error(`المسح الكامل لمخزن ${name} غير مسموح خارج الاستعادة الصريحة؛ استخدم Tombstones.`); };
      }

      const result = Reflect.get(target, property, target);
      return typeof result === 'function' ? result.bind(target) : result;
    },
    set(target, property, value) { return Reflect.set(target, property, value, target); }
  });
}

function wrapTransaction(rawTx, context, captureEnabled) {
  if (!captureEnabled) return rawTx;
  const captureQueue = makeCaptureQueue(rawTx, context);
  const stores = new Map();
  return new Proxy(rawTx, {
    get(target, property) {
      if (property === 'objectStore') {
        return name => {
          const key = String(name);
          if (!stores.has(key)) stores.set(key, wrapStore(target.objectStore(name), key, captureQueue));
          return stores.get(key);
        };
      }
      const result = Reflect.get(target, property, target);
      return typeof result === 'function' ? result.bind(target) : result;
    },
    set(target, property, value) { return Reflect.set(target, property, value, target); }
  });
}

function instrumentDatabase(db, context) {
  return new Proxy(db, {
    get(target, property) {
      if (property === 'transaction') {
        return (requestedNames, mode = 'readonly', options = undefined) => {
          const names = storeNames(requestedNames);
          const supportsSync = target.objectStoreNames?.contains?.(STORE.syncChanges) && target.objectStoreNames?.contains?.(STORE.syncState);
          const captureEnabled = supportsSync && mode === 'readwrite' && options?.captureChanges !== false && names.some(name => CAPTURE_STORES.has(name));
          const txNames = captureEnabled ? [...new Set([...names, ...SYSTEM_STORES])] : requestedNames;
          let nativeOptions = options;
          if (nativeOptions && Object.prototype.hasOwnProperty.call(nativeOptions, 'captureChanges')) {
            nativeOptions = {...nativeOptions};
            delete nativeOptions.captureChanges;
            if (!Object.keys(nativeOptions).length) nativeOptions = undefined;
          }
          let rawTx;
          if (mode === 'readonly' && options === undefined) rawTx = target.transaction(txNames);
          else if (nativeOptions === undefined) rawTx = target.transaction(txNames, mode);
          else rawTx = target.transaction(txNames, mode, nativeOptions);
          return wrapTransaction(rawTx, context, captureEnabled);
        };
      }
      const result = Reflect.get(target, property, target);
      return typeof result === 'function' ? result.bind(target) : result;
    },
    set(target, property, value) { return Reflect.set(target, property, value, target); }
  });
}

export class DatabaseContext {
  constructor(db, profile, {deviceId = getDeviceId()} = {}) {
    this.rawDb = db;
    this.deviceId = String(deviceId || getDeviceId());
    this.db = instrumentDatabase(db, this);
    this.profile = {...profile};
    this.token = uid();
    this.openedAt = new Date().toISOString();
    this.closed = false;
  }
  assert() {
    if (this.closed || !this.db || this.db.readyState === 'done') throw new AppError(ERR.STALE, 'سياق قاعدة البيانات لم يعد نشطًا.');
  }
  isCurrent(profileId, token) { return !this.closed && this.profile.id === profileId && this.token === token; }
  close() { if (this.closed) return; this.closed = true; try { this.rawDb.close(); } catch {} }
}
