const FILE_DRAG_TYPES = new Set([
  'files',
  'application/x-moz-file',
  'application/x-moz-file-promise',
  'application/vnd.portal.files',
  'application/vnd.portal.filetransfer',
  'text/uri-list',
]);

let internalDragActive = false;
let trackingInstalled = false;

/**
 * Drags that start inside the page (job cards, links, images) fire dragstart here.
 * Desktop file drags never do, which is how they are told apart on every browser.
 */
export function trackInternalDrags() {
  if (trackingInstalled || typeof window === 'undefined') return;
  trackingInstalled = true;
  window.addEventListener('dragstart', () => {
    internalDragActive = true;
  }, true);
  const clear = () => {
    internalDragActive = false;
  };
  window.addEventListener('dragend', clear, true);
  window.addEventListener('drop', clear);
}

export function isExternalFileDrag(dataTransfer) {
  if (internalDragActive || !dataTransfer) return false;
  const types = Array.from(dataTransfer.types || []).map((type) => String(type).toLowerCase());
  if (types.includes('application/json')) return false;
  if (types.some((type) => FILE_DRAG_TYPES.has(type))) return true;
  if (dataTransfer.files?.length) return true;
  const items = dataTransfer.items;
  if (items) {
    for (let i = 0; i < items.length; i += 1) {
      if (items[i]?.kind === 'file') return true;
    }
  }
  return false;
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

const WORKSHEET_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
export const WORKSHEET_ACCEPT = 'application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png';
export const MAX_WORKSHEET_BYTES = 10 * 1024 * 1024;

export function worksheetFileProblem(file: File | null | undefined) {
  if (!file) return 'Drop a worksheet PDF, JPG, or PNG';
  const name = String(file.name || '').toLowerCase();
  const typeOk = WORKSHEET_TYPES.includes(file.type) || /\.(pdf|jpe?g|png)$/.test(name);
  if (!typeOk) return 'Worksheets must be a PDF, JPG, or PNG';
  if (file.size > MAX_WORKSHEET_BYTES) return 'File must be less than 10MB';
  return '';
}

/** Files dropped from some Linux file managers arrive with an empty type. */
export function withWorksheetType(file: File) {
  if (file.type) return file;
  const name = file.name.toLowerCase();
  const type = name.endsWith('.pdf') ? 'application/pdf' : name.endsWith('.png') ? 'image/png' : 'image/jpeg';
  return new File([file], file.name, { type, lastModified: file.lastModified });
}
