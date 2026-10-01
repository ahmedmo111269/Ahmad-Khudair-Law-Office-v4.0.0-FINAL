// Read-only relation adapter shared by every legal-file DataGrid. Models live in a
// WeakMap, not on domain records: displaying, filtering and printing never writes
// names, IDs or derived fields back to the office database.
import {formatLegalFile,formatOfficialNumber} from '../core/file-number.js';

const unique = values => [...new Set(values.filter(Boolean))];
const kindOf = party => party.partyKind || (['client','opponent'].includes(party.partyType) ? party.partyType : '') || (party.clientId ? 'client' : party.opponentId ? 'opponent' : party.isClient ? 'client' : 'other');
const live = row => row && !row.isDeleted;
const abort = signal => { if (signal?.aborted) throw new DOMException('تم إلغاء قراءة علاقات الجدول.', 'AbortError'); };

/** IDs only. Never infer context from a heading, a cell or a client-name string. */
export function gridPageContext(route = '') {
  const [page, ...parts] = String(route).split('?')[0].split(':');
  if (page === 'client' || page === 'cfile') return {clientId: parts.join(':')};
  if (page === 'file') return {fileId: parts.join(':')};
  if (page === 'case') return {caseId: parts.join(':')};
  if (page === 'rec') return {entityType: parts[0], entityId: parts.slice(1).join(':')};
  return {};
}

export function hasLegalFileColumns(store) {
  return ['clients','opponents','files','cases','hearings','procedures','judgments',
    'fileRelations','fileParties','serviceRecords','appointments','communications',
    'powersOfAttorney','caseNotes','expertReports','execution','fees','feePayments',
    'documentReferences','activityLog','witnesses','agenda','workItems'].includes(store);
}

export function createGridRelations(office, store) {
  const token = office.ctx.token;
  let models = new WeakMap();
  const labels = {client: new Map(), opponent: new Map(), legalFile: new Map()};
  const assert = signal => { abort(signal); office.ctx.assert(); if (office.ctx.token !== token) throw new Error('تغيّرت قاعدة البيانات أثناء قراءة الجدول.'); };
  const getMany = async (name, ids) => unique(ids).length ? office.r[name].getMany(unique(ids)) : [];
  const byIndex = (name, index, id) => id ? office.r[name].byIndexAll(index, id) : Promise.resolve([]);
  const sourceStore = row => store === 'agenda' ? row.store : store === 'activityLog' ? row.entityType : store;

  async function hydrate(rows = [], {signal} = {}) {
    assert(signal);
    rows = rows.filter(row => row && typeof row === 'object');
    // Historical activity records may carry only entityType/entityId, not a
    // fileId snapshot. Join the original entity without adding fields to the log.
    const linked = new WeakMap();
    if (store === 'activityLog') {
      const groups = new Map();
      for (const row of rows) if (row.entityId && row.entityType !== 'activityLog' && typeof office.r[row.entityType]?.getMany === 'function') {
        if (!groups.has(row.entityType)) groups.set(row.entityType, []);
        groups.get(row.entityType).push(row);
      }
      await Promise.all([...groups].map(async ([name, entries]) => {
        const records = new Map((await getMany(name, entries.map(row => row.entityId))).map(record => [record.id, record]));
        entries.forEach(row => { if (records.has(row.entityId)) linked.set(row, records.get(row.entityId)); });
      }));
    }
    const original = row => linked.get(row) || row;
    const caseId = row => original(row).caseId || original(row).stageId || (store === 'activityLog' && row.entityType === 'cases' ? row.entityId : '');
    const clientId = row => store === 'clients' ? row.id : store === 'activityLog' && row.entityType === 'clients' ? row.entityId : original(row).clientId;
    const opponentId = row => store === 'opponents' ? row.id : store === 'activityLog' && row.entityType === 'opponents' ? row.entityId : original(row).opponentId;
    // Resolve indirect links (case-only historical rows and payments), before files.
    const fees = new Map((await getMany('fees', rows.map(row => original(row).feeId))).map(row => [row.id, row]));
    const cases = new Map(rows.filter(row => store === 'cases').map(row => [row.id, row]));
    const caseIds = unique(rows.map(caseId));
    for (const row of await getMany('cases', caseIds)) cases.set(row.id, row);
    assert(signal);

    // Directories have many-to-many file relations. Do not pick an arbitrary file
    // or confuse the client's main file code with a legal file number.
    const directoryIds = new Map();
    if (store === 'clients' || store === 'opponents') {
      await Promise.all(rows.map(async row => {
        const isClient = store === 'clients';
        const [parties, links, legacy, clientFiles] = await Promise.all([
          byIndex('fileParties', isClient ? 'clientId' : 'opponentId', row.id),
          isClient ? byIndex('fileClients', 'clientId', row.id) : [],
          byIndex(isClient ? 'caseClients' : 'caseOpponents', isClient ? 'clientId' : 'opponentId', row.id),
          isClient ? byIndex('clientFiles', 'clientId', row.id) : []
        ]);
        const legacyCases = await getMany('cases', legacy.map(link => link.caseId));
        legacyCases.forEach(stage => cases.set(stage.id, stage));
        const owned = (await Promise.all(clientFiles.map(cf => byIndex('files', 'clientFileId', cf.id)))).flat();
        directoryIds.set(row, unique([...parties.map(p => p.fileId), ...links.map(l => l.fileId), ...legacyCases.map(c => c.fileId), ...owned.map(f => f.id)]));
      }));
    }
    assert(signal);
    const primaryId = row => store === 'files' ? row.id : store === 'fileRelations' ? row.sourceFileId : row.fileId || (store === 'activityLog' && row.entityType === 'files' ? row.entityId : '') || original(row).fileId || original(row).sourceFileId || cases.get(caseId(row))?.fileId || fees.get(original(row).feeId)?.fileId || '';
    const fileIds = unique(rows.flatMap(row => [primaryId(row), row.targetFileId, row.otherFileId, ...(directoryIds.get(row) || [])]));
    const files = new Map((await getMany('files', fileIds)).map(row => [row.id, row]));
    // A source file row already contains all fields, including unsaved display-only
    // annotations. It is not modified by this adapter.
    if (store === 'files') rows.forEach(row => { if (live(row)) files.set(row.id, row); });

    const bundles = new Map();
    await Promise.all([...files.values()].map(async file => {
      const [parties, links, stages, cf] = await Promise.all([
        byIndex('fileParties', 'fileId', file.id), byIndex('fileClients', 'fileId', file.id),
        byIndex('cases', 'fileId', file.id), file.clientFileId ? office.r.clientFiles.get(file.clientFileId) : null
      ]);
      stages.forEach(stage => cases.set(stage.id, stage));
      const legacy = await Promise.all(stages.map(async stage => ({stage,
        clients: await byIndex('caseClients', 'caseId', stage.id),
        opponents: await byIndex('caseOpponents', 'caseId', stage.id)
      })));
      // Retain every non-deleted party, including inactive parties and different
      // roles of the same person. Only the compact name list is de-duplicated.
      const entries = [...parties].sort((a,b) => Number(Boolean(b.isPrimary)) - Number(Boolean(a.isPrimary)) || (Number(a.sequence) || 999999) - (Number(b.sequence) || 999999) || String(a.id).localeCompare(String(b.id)));
      const have = new Set(entries.map(p => `${kindOf(p)}:${p.clientId || p.opponentId || ''}`));
      const add = (kind, id, role = '', extra = {}) => {
        if (!id || have.has(`${kind}:${id}`)) return;
        have.add(`${kind}:${id}`);
        entries.push({partyKind: kind, ...(kind === 'client' ? {clientId: id} : {opponentId: id}), role, ...extra});
      };
      links.forEach(link => add('client', link.clientId, link.role));
      if (live(cf)) add('client', cf.clientId, 'موكل');
      legacy.forEach(part => {
        part.clients.forEach(link => add('client', link.clientId, link.role));
        part.opponents.forEach(link => add('opponent', link.opponentId, link.role));
      });
      bundles.set(file.id, {file, entries, stages});
    }));
    assert(signal);
    const allEntries = [...bundles.values()].flatMap(bundle => bundle.entries);
    const [clientRows, opponentRows, typeRows] = await Promise.all([
      getMany('clients', [...rows.map(clientId), ...allEntries.map(p => p.clientId), ...(store === 'clients' ? rows.map(row => row.id) : [])]),
      getMany('opponents', [...rows.map(opponentId), ...allEntries.map(p => p.opponentId), ...(store === 'opponents' ? rows.map(row => row.id) : [])]),
      getMany('taxonomy', [...files.values()].map(file => file.fileTypeId))
    ]);
    assert(signal);
    const clients = new Map(clientRows.map(row => [row.id, row]));
    const opponents = new Map(opponentRows.map(row => [row.id, row]));
    const types = new Map(typeRows.map(row => [row.id, row]));
    clients.forEach(row => labels.client.set(row.id, row.fullName || ''));
    opponents.forEach(row => labels.opponent.set(row.id, row.name || ''));
    for (const bundle of bundles.values()) {
      bundle.label = formatLegalFile(bundle.file, {typeName: types.get(bundle.file.fileTypeId)?.name});
      labels.legalFile.set(bundle.file.id, bundle.label);
      bundle.parties = bundle.entries.map(party => {
        const kind = kindOf(party), id = kind === 'client' ? party.clientId : party.opponentId;
        const original = kind === 'client' ? clients.get(id) : opponents.get(id);
        const name = (kind === 'client' ? original?.fullName : original?.name) || party.partyName || party.name || '';
        return {id: id || '', kind, text: name, detail: [party.role, party.isActive === false ? 'غير نشط' : ''].filter(Boolean).join(' — '), party, original};
      });
    }
    for (const row of rows) {
      const ids = directoryIds.get(row) || [primaryId(row)].filter(Boolean);
      const primary = ids.map(id => bundles.get(id)).filter(Boolean);
      const stage = store === 'cases' ? row : cases.get(original(row).currentStageId || caseId(row));
      models.set(row, {primary, target: bundles.get(row.targetFileId), other: bundles.get(row.otherFileId), stage,
        directClient: clients.get(clientId(row)),
        directOpponent: opponents.get(opponentId(row)), sourceStore: sourceStore(row)});
    }
    return rows;
  }

  const bundlesOf = (row, side = 'primary') => {
    const model = models.get(row);
    return side === 'primary' ? model?.primary || [] : model?.[side] ? [model[side]] : [];
  };
  function parties(row, kind, side = 'primary') {
    const model = models.get(row);
    let values = bundlesOf(row, side).flatMap(bundle => bundle.parties.filter(p => p.kind === kind));
    // Directory rows identify one person. File-linked records expose all of the
    // file's clients, plus a directly linked client if not already represented.
    const direct = side === 'primary' ? kind === 'client' ? model?.directClient : model?.directOpponent : null;
    if (direct) {
      const item = {id: direct.id, kind, text: kind === 'client' ? direct.fullName : direct.name, original: direct, detail: ''};
      if (store === 'clients' && kind === 'client' || store === 'opponents' && kind === 'opponent') values = [item];
      else if (store !== 'fileParties' && !values.some(value => value.id === direct.id)) values.unshift(item);
    }
    return values.filter(p => p.text);
  }
  function items(row, role, side = 'primary') {
    const values = role === 'legalFile'
      ? bundlesOf(row, side).map(bundle => ({id: bundle.file.id, text: bundle.label, detail: bundle.file.title || '', original: bundle.file}))
      : parties(row, role, side);
    // Same person with two roles: one name in the compact list, both roles in
    // details. Distinct people sharing a name keep distinct identities.
    const out = new Map();
    values.forEach((value, index) => {
      const key = value.id || `name:${value.text}:${index}`;
      const old = out.get(key);
      if (old) old.detail = unique([old.detail, value.detail]).join('، ');
      else out.set(key, {...value});
    });
    return [...out.values()];
  }
  const references = (row, role, side) => items(row, role, side).filter(item => item.id).map(item => ({id: item.id, label: item.text}));
  const referenceLabel = (role, id) => labels[role]?.get(String(id)) || '';

  async function loadFilterLabels(query, columns = []) {
    const ids = {client: [], opponent: [], legalFile: []};
    const visit = tree => (tree?.rules || []).forEach(rule => {
      if (rule.rules) return visit(rule);
      const role = columns.find(column => column.key === rule.key)?.contextRole;
      if (ids[role] && (rule.valueType === 'reference' || rule.setValueType === 'reference')) ids[role].push(...(rule.set || [rule.v1]));
    });
    visit(query.filters); visit(query.advanced);
    await Promise.all(Object.entries(ids).map(async ([role, values]) => {
      const records = await getMany(role === 'client' ? 'clients' : role === 'opponent' ? 'opponents' : 'files', values);
      records.forEach(row => labels[role].set(row.id, role === 'client' ? row.fullName : role === 'opponent' ? row.name : formatLegalFile(row)));
    }));
    assert();
  }

  async function resolvePrintContext({context = {}, query, columns = [], rows = [], date} = {}) {
    assert();
    let scope = {...context};
    if (scope.entityType && scope.entityId) {
      const row = await office.r[scope.entityType]?.get(scope.entityId);
      if (live(row)) {
        scope = {...scope, clientId: scope.clientId || row.clientId, fileId: scope.fileId || row.fileId,
          caseId: scope.caseId || (scope.entityType === 'cases' ? row.id : row.caseId)};
        if (!scope.fileId && row.feeId) scope.fileId = (await office.r.fees.get(row.feeId))?.fileId;
      }
    }
    // Fresh source reads before validating a filter against the printed rows.
    // Selections can outlive their page/filter, and party links may have changed.
    if (rows.length) await hydrate(rows);
    // Only an identity-based constraint valid for the whole AND/OR tree may
    // supply global report context. A one-client cursor page is not a scope.
    const filteredClientId = constrainedReferenceId(query, columns, 'client', rows);
    const filteredFileId = constrainedReferenceId(query, columns, 'legalFile', rows);
    scope.clientId ||= filteredClientId;
    scope.fileId ||= filteredFileId;
    let stage = scope.caseId ? await office.r.cases.get(scope.caseId) : null;
    if (!live(stage)) stage = null;
    scope.fileId ||= stage?.fileId;
    let file = scope.fileId ? await office.r.files.get(scope.fileId) : null;
    if (!live(file)) file = null;
    let fileModel = null;
    if (file) {
      const reader = createGridRelations(office, 'files');
      await reader.hydrate([file]);
      fileModel = reader.model(file)?.primary[0];
      if (!stage && !scope.caseId) {
        stage = fileModel?.stages.find(row => row.id === file.currentStageId) || null;
        if (!stage) {
          const numbered = (fileModel?.stages || []).filter(row => row.caseNumber && row.lifecycle !== 'planned');
          if (numbered.length === 1) stage = numbered[0];
        }
      }
    }
    const client = scope.clientId ? await office.r.clients.get(scope.clientId) : null;
    // An explicit but unavailable client must not be replaced by another
    // co-client of the file. Omit the field; retain all party values in rows.
    const contextClients = scope.clientId ? live(client) ? [{id: client.id, name: client.fullName || ''}] : []
      : fileModel ? itemsFromBundle(fileModel, 'client') : [];
    assert();
    return {tableTitle: scope.tableTitle || '', clients: contextClients.filter(row => row.name),
      client: contextClients.length === 1 ? contextClients[0] : null,
      legalFile: file ? {id: file.id, label: fileModel?.label || formatLegalFile(file)} : null,
      caseNumber: stage?.caseNumber ? formatOfficialNumber(stage) : '',
      filters: scope.filters || [], filtered: Boolean(filteredClientId || filteredFileId), date,
      omitContextClientColumn: Boolean(scope.clientId || file)};
  }
  return {store, hydrate, items, references, referenceLabel, loadFilterLabels, resolvePrintContext,
    model: row => models.get(row), officialNumber: row => formatOfficialNumber(models.get(row)?.stage),
    reset(){models = new WeakMap(); Object.values(labels).forEach(map => map.clear());},
    gridOptions(context = {}) {return {printContext: context, resolvePrintContext};}
  };
}

function itemsFromBundle(bundle, kind) {
  const out = new Map();
  for (const party of bundle.parties || []) {
    if (party.kind !== kind || !party.original || !party.id) continue;
    const name = kind === 'client' ? party.original.fullName : party.original.name;
    if (name) out.set(party.id, {id: party.id, name});
  }
  return [...out.values()];
}

/** Conservative constraint analysis: OR constrains an ID only if every branch
 * constrains the same ID. Never resolve a client by the rendered name. */
export function constrainedReferenceId(query, columns, role, rows = null) {
  const relevant = columns.filter(column => column.contextRole === role && column.contextSide !== 'target' && column.contextSide !== 'other');
  const keys = new Set(relevant.map(column => column.key));
  const analyze = tree => {
    const constraints = (tree?.rules || []).map(rule => {
      if (rule.rules) return analyze(rule);
      if (!keys.has(rule.key)) return null;
      if (rule.valueType === 'reference' && rule.op === 'eq' && rule.v1 && !rule.set) return String(rule.v1);
      if ((rule.valueType === 'reference' || rule.setValueType === 'reference') && Array.isArray(rule.set) && rule.set.length === 1 && rule.set[0] !== '(فارغ)') return String(rule.set[0]);
      return null;
    });
    if (!constraints.length) return null;
    if (tree.logic === 'or') return constraints.every(id => id && id === constraints[0]) ? constraints[0] : null;
    const known = unique(constraints);
    return known.length === 1 ? known[0] : null;
  };
  const ids = unique([analyze(query?.filters), analyze(query?.advanced)]);
  const id = ids.length === 1 ? ids[0] : null;
  // Validate the actual document, not just the current UI query: retained
  // selections from another page/filter must not acquire a false header.
  return id && (!rows?.length || rows.every(row => relevant.some(column => (column.references?.(row) || []).some(ref => String(ref.id) === id)))) ? id : null;
}
