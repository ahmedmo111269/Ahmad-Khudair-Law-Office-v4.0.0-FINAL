// Central column-definition contract. Legacy `label`/`get`/`text` definitions remain valid.
export function defineGridColumns(definitions = []) {
  return (definitions || []).map((definition, index) => {
    const column = definition && typeof definition === 'object' ? definition : {};
    const key = String(column.key ?? `column-${index + 1}`);
    const label = String(column.title ?? column.label ?? key);
    const get = typeof column.get === 'function' ? column.get : row => row?.[key];
    const items = typeof column.items === 'function' ? column.items : null;
    const text = typeof column.text === 'function' ? column.text : items ? row => items(row).map(item => typeof item === 'object' ? item.text : item).filter(Boolean).join('\n') : row => String(get(row) ?? '');
    return {
      ...column,
      key,
      label,
      title: label,
      type: column.type || 'text',
      get,
      text,
      items,
      references: typeof column.references === 'function' ? column.references : null,
      compactLimit: Math.max(1, Number(column.compactLimit) || 2),
      order: Number.isFinite(Number(column.order)) ? Number(column.order) : index,
      width: Number.isFinite(Number(column.width)) ? Number(column.width) : undefined,
      minWidth: Number.isFinite(Number(column.minWidth)) ? Number(column.minWidth) : 90,
      maxWidth: Number.isFinite(Number(column.maxWidth)) ? Number(column.maxWidth) : 900,
      sortable: column.sortable !== false,
      filterable: column.filterable !== false,
      searchable: column.searchable !== false,
      hideable: column.hideable !== false,
      pinnable: column.pinnable !== false,
      copyable: Boolean(column.copyable)
    };
  });
}

export function defaultColumnOrder(columns = []) {
  return [...columns].sort((a, b) => a.order - b.order).map(column => column.key);
}

/** Real shared Column Definitions, not extra text appended to a file cell.
 * The read adapter resolves domain relationships; the grid stays domain-neutral.
 * Existing column keys may be supplied to preserve each table's saved preferences.
 */
export function legalFileColumns(relations, {
  fileKey = 'fileId', clientKey = 'clientId', opponentKey = 'opponentId',
  side = 'primary', fileTitle = 'رقم الملف / نوع الملف',
  clientTitle = 'الموكل', opponentTitle = 'الخصم', hidden = false
} = {}) {
  return [
    [fileKey, fileTitle, 'legalFile', 190],
    [clientKey, clientTitle, 'client', 220],
    [opponentKey, opponentTitle, 'opponent', 220]
  ].map(([key, title, role, width]) => ({
    key, title, type: 'text', width, minWidth: 130, hidden, index: false,
    contextRole: role, contextSide: side,
    items: row => relations?.items(row, role, side) || [],
    get: row => (relations?.items(row, role, side) || []).map(item => item.text).join('\n'),
    references: row => relations?.references(row, role, side) || [],
    referenceLabel: id => relations?.referenceLabel(role, id) || '',
    // Printing may omit a *redundant* contextual client column, but never a
    // co-client, a target-file client or any column from an unrelated report.
    printOmitWhenContext: role === 'client' && side === 'primary'
  }));
}

/** Use one preference namespace whether callers supply "clients" or "grid:clients". */
export function gridPreferenceKey(gridId = '') {
  const id = String(gridId || '').trim();
  return id ? id.startsWith('grid:') ? id : `grid:${id}` : '';
}
