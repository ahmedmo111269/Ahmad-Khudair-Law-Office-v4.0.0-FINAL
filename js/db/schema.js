export const STORE = Object.freeze({
  clients: 'clients',
  staff: 'staff',
  files: 'files',
  cases: 'cases',
  fileClients: 'fileClients',
  caseClients: 'caseClients',
  opponents: 'opponents',
  caseOpponents: 'caseOpponents',
  caseRelations: 'caseRelations',
  powersOfAttorney: 'powersOfAttorney',
  hearings: 'hearings',
  procedures: 'procedures',
  appointments: 'appointments',
  communications: 'communications',
  caseNotes: 'caseNotes',
  witnesses: 'witnesses', // Kept for historical records; its UI is retired without deleting user data.
  expertReports: 'expertReports',
  judgments: 'judgments',
  execution: 'execution',
  fees: 'fees',
  feePayments: 'feePayments',
  documentReferences: 'documentReferences',
  activityLog: 'activityLog',
  lookups: 'lookups',
  settings: 'settings',
  fileNumberCounters: 'fileNumberCounters',
  meta: 'meta',
  fileParties: 'fileParties',
  fileRelations: 'fileRelations',
  clientFiles: 'clientFiles',
  taxonomy: 'taxonomy',
  caseTemplates: 'caseTemplates',
  assets: 'assets',
  fileAssets: 'fileAssets',
  serviceRecords: 'serviceRecords',
  bailiffs: 'bailiffs',
  // v14 — مركز العمل (Work Center). مخازن تشغيلية فقط؛ لا تنسخ أي بيانات قانونية من الملفات/الجلسات/الموكلين.
  workItems: 'workItems',
  workItemComments: 'workItemComments',
  workItemRecurrences: 'workItemRecurrences'
});

// Index declarations use short aliases for compound keys. Schema upgrades are additive:
// never remove stores or indexes because existing browser databases may contain production data.
const IDX = {
  clients: { clientCode: 'clientCode', fullNameNormalized: 'fullNameNormalized', nationalId: 'nationalId', status: 'status', createdAt: 'createdAt', a: ['isArchived', 'isDeleted', 'createdAt', 'id'] },
  staff: { fullNameNormalized: 'fullNameNormalized', isActive: 'isActive' },
  files: { clientFileId: 'clientFileId', categoryId: 'categoryId', fileTypeId: 'fileTypeId', b: ['clientFileId', 'categoryId'], c: ['clientFileId', 'lastActivityAt'], fileNumber: 'fileNumber', titleNormalized: 'titleNormalized', status: 'status', stage: 'stage', priority: 'priority', lastActivityAt: 'lastActivityAt', nextStepDate: 'nextStepDate', isDeleted: 'isDeleted', isArchived: 'isArchived', fileType: 'fileType', openedAt: 'openedAt', a: ['isArchived', 'isDeleted', 'lastActivityAt', 'id'] },
  cases: { stageTypeId: 'stageTypeId', fileId: 'fileId', caseNumber: 'caseNumber', caseYear: 'caseYear', courtId: 'courtId', status: 'status', filingDate: 'filingDate', subjectNormalized: 'subjectNormalized', isDeleted: 'isDeleted', a: ['fileId', 'isDeleted'] },
  fileClients: { fileId: 'fileId', clientId: 'clientId', a: ['clientId', 'fileId'] },
  caseClients: { caseId: 'caseId', clientId: 'clientId', a: ['clientId', 'caseId'] },
  opponents: { nameNormalized: 'nameNormalized', isDeleted: 'isDeleted' },
  caseOpponents: { caseId: 'caseId', opponentId: 'opponentId', role: 'role' },
  caseRelations: { sourceCaseId: 'sourceCaseId', targetCaseId: 'targetCaseId', a: ['targetCaseId', 'sourceCaseId'] },
  powersOfAttorney: { clientId: 'clientId', fileId: 'fileId', poaNumber: 'poaNumber', expiryDate: 'expiryDate', a: ['clientId', 'expiryDate'] },
  hearings: { caseId: 'caseId', fileId: 'fileId', stageId: 'stageId', hearingDate: 'hearingDate', nextHearingDate: 'nextHearingDate', previousHearingId: 'previousHearingId', status: 'status', a: ['caseId', 'hearingDate'], b: ['hearingDate', 'caseId'], c: ['fileId', 'hearingDate'] },
  procedures: { fileId: 'fileId', caseId: 'caseId', status: 'status', internalDueDate: 'internalDueDate', a: ['status', 'internalDueDate'] },
  appointments: { date: 'date', clientId: 'clientId', fileId: 'fileId' },
  communications: { clientId: 'clientId', fileId: 'fileId', date: 'date', followUpDate: 'followUpDate', a: ['fileId', 'date'] },
  caseNotes: { fileId: 'fileId', caseId: 'caseId', createdAt: 'createdAt' },
  witnesses: { caseId: 'caseId' },
  expertReports: { caseId: 'caseId', reportDate: 'reportDate', a: ['caseId', 'reportDate'] },
  judgments: { caseId: 'caseId', fileId: 'fileId', judgmentDate: 'judgmentDate', a: ['caseId', 'judgmentDate'] },
  execution: { caseId: 'caseId', fileId: 'fileId', status: 'status', openedDate: 'openedDate' },
  fees: { fileId: 'fileId', createdAt: 'createdAt', a: ['fileId', 'createdAt'] },
  feePayments: { feeId: 'feeId', date: 'date', a: ['feeId', 'date'] },
  documentReferences: { fileId: 'fileId', date: 'date', a: ['fileId', 'date'] },
  activityLog: { entityType: 'entityType', entityId: 'entityId', fileId: 'fileId', timestamp: 'timestamp', a: ['entityType', 'entityId', 'timestamp'], b: ['entityId', 'timestamp'] },
  lookups: { category: 'category', a: ['category', 'order'] },
  settings: { key: 'key' },
  fileNumberCounters: { year: 'year' },
  meta: { key: 'key' },
  fileParties: {
    fileId: 'fileId', clientId: 'clientId', opponentId: 'opponentId', role: 'role', roleGroup: 'roleGroup', sequence: 'sequence', activeStatus: 'activeStatus',
    a: ['fileId', 'roleGroup', 'sequence'], b: ['fileId', 'clientId', 'role'], c: ['fileId', 'sequence']
  },
  fileRelations: { sourceFileId: 'sourceFileId', targetFileId: 'targetFileId', relationCode: 'relationCode' },
  clientFiles: { clientId: 'clientId', clientCode: 'clientCode', status: 'status', lastActivityAt: 'lastActivityAt' },
  taxonomy: { kind: 'kind', parentId: 'parentId', a: ['kind', 'parentId'] },
  caseTemplates: { fileTypeId: 'fileTypeId' },
  assets: { kind: 'kind', nameNormalized: 'nameNormalized', plate: 'plate' },
  fileAssets: { fileId: 'fileId', assetId: 'assetId' },
  serviceRecords: {
    internalNumber: 'internalNumber', fileId: 'fileId', caseId: 'caseId', hearingId: 'hearingId', partyId: 'partyId', previousServiceId: 'previousServiceId',
    bailiffId: 'bailiffId', type: 'type', status: 'status', createdAt: 'createdAt', submittedAt: 'submittedAt', serviceDate: 'serviceDate',
    recordState: 'recordState', a: ['fileId', 'serviceDate'], b: ['status', 'submittedAt'], c: ['fileId', 'recordState']
  },
  bailiffs: { nameNormalized: 'nameNormalized', court: 'court', section: 'section', office: 'office', activeStatus: 'activeStatus' },
  // v14. صف واحد لكل «عنصر عمل مستقل» (kind='native') أو «طبقة تشغيلية» فوق سجل أصلي (kind='overlay', id='<store>::<sourceId>').
  // dueDate: '' للمهام بلا موعد حتى تُفهرس (النص الفارغ مفتاح صالح) أما null/undefined فلا تُفهرس.
  workItems: {
    kind: 'kind', dueDate: 'dueDate', status: 'status', completedAt: 'completedAt', pinnedAt: 'pinnedAt', archivedAt: 'archivedAt',
    sourceType: 'sourceType', sourceId: 'sourceId', fileId: 'fileId', caseId: 'caseId', clientId: 'clientId', relatedId: 'relatedId',
    recurrenceId: 'recurrenceId', createdAt: 'createdAt', updatedAt: 'updatedAt',
    a: ['kind', 'dueDate'], b: ['recurrenceId', 'occurrenceDate'], c: ['status', 'dueDate']
  },
  workItemComments: { workItemId: 'workItemId', createdAt: 'createdAt', a: ['workItemId', 'createdAt'] },
  workItemRecurrences: { status: 'status', startDate: 'startDate', fileId: 'fileId', createdAt: 'createdAt' }
};

export const SCHEMA = {};
for (const [name, indexes] of Object.entries(IDX)) {
  const copy = {};
  for (const [key, value] of Object.entries(indexes)) {
    if (!['a', 'b', 'c'].includes(key)) copy[key] = value;
  }
  for (const alias of ['a', 'b', 'c']) {
    if (indexes[alias]) copy[indexes[alias].join('_')] = indexes[alias];
  }
  SCHEMA[name] = { keyPath: 'id', indexes: copy };
}
export const STORES = Object.values(STORE);

// Official, additive migration registry. Each entry is the complete description of what an upgrade to `version`
// does to an existing database. Upgrades never rewrite, move or delete rows (see ADR in PROJECT_MAP).
export const SCHEMA_MIGRATIONS = Object.freeze([
  Object.freeze({
    version: 14,
    title: 'مركز العمل: عناصر العمل والتعليقات وتعريفات التكرار',
    addsStores: Object.freeze(['workItems', 'workItemComments', 'workItemRecurrences']),
    destructive: false,
    backfill: false
  })
]);

/** Pure description of the work an upgrade will do (used by tests, diagnostics and backup/restore inspection). */
export function migrationPlan(fromVersion = 0, toVersion = Infinity) {
  const steps = SCHEMA_MIGRATIONS.filter(step => step.version > fromVersion && step.version <= toVersion);
  return { steps, addsStores: [...new Set(steps.flatMap(step => step.addsStores))], destructive: steps.some(step => step.destructive) };
}

export function ensureSchema(db) {
  for (const name of STORES) {
    const def = SCHEMA[name];
    const store = db.objectStoreNames.contains(name) ? null : db.createObjectStore(name, { keyPath: def.keyPath });
    if (store) {
      for (const [indexName, keyPath] of Object.entries(def.indexes)) store.createIndex(indexName, keyPath, { unique: false });
    }
  }
}

export function upgradeSchema(db, tx) {
  ensureSchema(db);
  for (const [name, def] of Object.entries(SCHEMA)) {
    const store = tx.objectStore(name);
    for (const [indexName, keyPath] of Object.entries(def.indexes)) {
      if (!store.indexNames.contains(indexName)) store.createIndex(indexName, keyPath, { unique: false });
    }
  }
}
