function dragTypes(dataTransfer) {
  const types = dataTransfer?.types;
  if (!types) return [];
  return Array.from(types).map((type) => String(type).toLowerCase());
}

/** A file coming from the desktop. Job cards only carry application/json. */
export function isExternalFileDrag(dataTransfer) {
  const types = dragTypes(dataTransfer);
  if (
    types.includes('files') ||
    types.includes('application/x-moz-file') ||
    types.includes('application/x-moz-file-promise')
  ) {
    return true;
  }
  if (dataTransfer?.files?.length) return true;
  const items = dataTransfer?.items;
  if (items) {
    for (let i = 0; i < items.length; i += 1) {
      if (items[i]?.kind === 'file') return true;
    }
  }
  if (types.includes('application/json')) return false;
  return types.includes('text/uri-list') || types.includes('text/x-moz-url');
}

export function filesFromDrop(dataTransfer): File[] {
  const found: File[] = [];
  const list = dataTransfer?.files;
  if (list) {
    for (let i = 0; i < list.length; i += 1) {
      if (list[i]) found.push(list[i]);
    }
  }
  if (found.length || !dataTransfer?.items) return found;
  for (let i = 0; i < dataTransfer.items.length; i += 1) {
    const item = dataTransfer.items[i];
    if (item?.kind !== 'file' || typeof item.getAsFile !== 'function') continue;
    const file = item.getAsFile();
    if (file) found.push(file);
  }
  return found;
}
