// Central column-definition contract. Legacy `label`/`get`/`text` definitions remain valid.
export function defineGridColumns(definitions = []) {
  return (definitions || []).map((definition, index) => {
    const column = definition && typeof definition === 'object' ? definition : {};
    const key = String(column.key ?? `column-${index + 1}`);
    const label = String(column.title ?? column.label ?? key);
    const get = typeof column.get === 'function' ? column.get : row => row?.[key];
    const text = typeof column.text === 'function' ? column.text : row => String(get(row) ?? '');
    return {
      ...column,
      key,
      label,
      title: label,
      type: column.type || 'text',
      get,
      text,
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
