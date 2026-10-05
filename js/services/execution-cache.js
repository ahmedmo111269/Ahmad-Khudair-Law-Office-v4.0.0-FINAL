// مركز التنفيذ — تخزين مؤقت بسيط مع LRU وإبطال عند تغيير الإعدادات أو الكتابة
// المفتاح: `${executionId}|${asOf}|${allowFuture}|${ruleVersion}|${engineVersion}`
// الحد الأقصى 200 مدخل، وعند تغيير الإعدادات يُفرغ بالكامل
import {events} from '../core/events.js';

const MAX_ENTRIES = 200;
const cache = new Map();

function makeKey({executionId = '', asOf = '', allowFuture = false, ruleVersion = 0, engineVersion = 0} = {}) {
  return `${executionId}|${asOf}|${allowFuture ? '1' : '0'}|${ruleVersion}|${engineVersion}`;
}

export function getCache(keyObj) {
  const key = typeof keyObj === 'string' ? keyObj : makeKey(keyObj);
  if (!cache.has(key)) return null;
  const value = cache.get(key);
  // LRU: أعد الإدراج ليصبح الأحدث
  cache.delete(key);
  cache.set(key, value);
  return value;
}

export function setCache(keyObj, value) {
  const key = typeof keyObj === 'string' ? keyObj : makeKey(keyObj);
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  if (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  return value;
}

export function clearCache() {
  cache.clear();
}

export function clearExecutionCache(executionId) {
  if (!executionId) { clearCache(); return; }
  for (const key of [...cache.keys()]) {
    if (key.startsWith(`${executionId}|`)) cache.delete(key);
  }
}

export function onSettingsChange() {
  clearCache();
}

export function cacheKeyFor({executionId = '', asOf = '', allowFuture = false, ruleVersion = 0, engineVersion = 0} = {}) {
  return makeKey({executionId, asOf, allowFuture, ruleVersion, engineVersion});
}

try {
  events.on('execution:cache-invalidated', () => {
    clearCache();
  });
  events.on('execution:configuration-changed', () => {
    clearCache();
  });
} catch {}

export const executionCache = {
  get: getCache,
  set: setCache,
  clear: clearCache,
  clearExecution: clearExecutionCache,
  onSettingsChange,
  key: cacheKeyFor,
  _map: cache
};
