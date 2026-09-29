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
  bailiffs: 'bailiffs'
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
  bailiffs: { nameNormalized: 'nameNormalized', court: 'court', section: 'section', office: 'office', activeStatus: 'activeStatus' }
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
