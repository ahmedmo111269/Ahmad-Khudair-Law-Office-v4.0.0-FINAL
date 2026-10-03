// Browser-facing persistence regressions for v13 stores, indexes, integrity, and backup/restore.
import { STORES, SCHEMA, upgradeSchema } from '../db/schema.js';
import { Office } from '../services/office.js';
import { createLegalFile } from '../services/legal-files.js';
import { saveBailiff, saveServiceRecord } from '../services/service-records.js';
import { auditIndexes } from '../services/index-audit.js';
import { deepHealth } from '../services/integrity.js';
import { exportDatabase, importDatabase, inspectBackup } from '../services/backup.js';

function openTestDatabase(name) {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(name, 13);
    r.onupgradeneeded = e => upgradeSchema(r.result, e.target.transaction);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function runBackupAndIntegrityTests(test, expect) {
  const sourceName = `AhmadKhudairLawOfficeDB__test__backup13__${Date.now()}`;
  const targetName = `${sourceName}__restore`;
  const sourceDb = await openTestDatabase(sourceName);
  const targetDb = await openTestDatabase(targetName);
  const sourceCtx = { db: sourceDb, token: 'backup-v13', profile: { id: 'backup-v13', databaseName: sourceName }, assert() {} };
  const targetCtx = { db: targetDb, token: 'restore-v13', profile: { id: 'restore-v13', databaseName: targetName }, assert() {} };
  const source = new Office(sourceCtx), target = new Office(targetCtx);
  const out = {};
  try {
    const client = await source.saveClient({ fullName: 'موكل اختبار النسخ الاحتياطي' });
    const file = await createLegalFile(source, { clientId: client.id, title: 'ملف اختبار النسخ الاحتياطي', fileType: 'مدني' });
    const bailiff = await saveBailiff(source, { name: 'محضر النسخ الاحتياطي', court: 'محكمة الاختبار' });
    const service = await saveServiceRecord(source, { fileId: file.id, bailiffId: bailiff.id, actionType: 'إعلان', type: 'إعلان صحيفة دعوى', status: 'تم الإعلان', result: 'تم الإعلان', serviceDate: '2026-09-29' });
    out.serviceId = service.id;
    out.indexes = auditIndexes(sourceDb);
    out.healthBefore = await deepHealth(sourceCtx, { scanRows: true });
    const payload = await exportDatabase(sourceCtx);
    out.backup = await inspectBackup(payload);
    out.storeListMatches = payload.manifest.storeNames.length === STORES.length && STORES.every(name => payload.manifest.storeNames.includes(name));
    out.indexCount = Object.values(SCHEMA).reduce((sum, definition) => sum + Object.keys(definition.indexes).length, 0);

    const tampered = structuredClone(payload);
    tampered.stores.files[0].title = 'تغيير غير مصرح به بعد التصدير';
    try { await inspectBackup(tampered); out.tamperRejected = false; }
    catch { out.tamperRejected = true; }

    await target.r.files.put({ id: 'target-only-row', title: 'يجب استبداله', isDeleted: false });
    out.restoreResult = await importDatabase(targetCtx, payload, { mode: 'replace' });
    out.restoredFile = await target.r.files.get(file.id);
    out.restoredService = await target.r.serviceRecords.get(service.id);
    out.targetOnlyRemoved = !(await target.r.files.get('target-only-row'));
    out.healthAfter = await deepHealth(targetCtx, { scanRows: true });
    try { await importDatabase(targetCtx, payload, { mode: 'merge' }); out.mergeRejected = false; }
    catch { out.mergeRejected = true; }
  } finally {
    sourceDb.close(); targetDb.close();
    try { indexedDB.deleteDatabase(sourceName); } catch {}
    try { indexedDB.deleteDatabase(targetName); } catch {}
  }

  test('v13 database declares every store and index (including service and party relations)', () => {
    expect(out.storeListMatches).toBe(true);
    expect(out.indexes.every(row => row.status === 'ok')).toBe(true);
    expect(out.indexCount).toBe(308);   // 267 حتى v15 + 17 للمزامنة v16 + 24 لـFEAS v17
    expect(out.indexes.length).toBe(out.indexCount);
  });
  test('v13 deep integrity scan resolves linked party, file, bailiff and service records', () => {
    expect(out.healthBefore.ok).toBe(true);
    expect(out.healthAfter.ok).toBe(true);
    expect(out.healthBefore.summary.relationIssues).toBe(0);
  });
  test('backup v3 manifest and digest validate, and tampering is rejected', () => {
    expect(out.backup.valid).toBe(true);
    expect(out.backup.integrity.verified).toBe(true);
    expect(out.backup.schemaVersion).toBe(17);
    expect(out.tamperRejected).toBe(true);
  });
  test('full replace restore retains service data and removes destination-only rows', () => {
    expect(Boolean(out.restoredFile?.id)).toBe(true);
    expect(Boolean(out.restoredService?.id)).toBe(true);
    expect(out.targetOnlyRemoved).toBe(true);
    expect(out.restoreResult.stores.files > 0).toBe(true);
    expect(out.mergeRejected).toBe(true);
  });
}
