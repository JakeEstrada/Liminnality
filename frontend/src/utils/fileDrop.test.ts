import { afterEach, describe, expect, it } from 'vitest';
import {
  filesFromDrop,
  isExternalFileDrag,
  trackInternalDrags,
  withWorksheetType,
  worksheetFileProblem,
} from './fileDrop';

trackInternalDrags();

afterEach(() => {
  window.dispatchEvent(new Event('dragend'));
});

describe('isExternalFileDrag', () => {
  it('recognizes a Linux file-manager drag', () => {
    expect(
      isExternalFileDrag({
        types: ['application/x-moz-file', 'text/x-moz-url', 'text/uri-list', 'text/plain'],
      }),
    ).toBe(true);
  });

  it('recognizes a GNOME portal drag', () => {
    expect(isExternalFileDrag({ types: ['application/vnd.portal.filetransfer', 'text/uri-list'] })).toBe(true);
  });

  it('recognizes a Chrome file drag', () => {
    expect(isExternalFileDrag({ types: ['Files'] })).toBe(true);
  });

  it('leaves a job card drag on the pipeline', () => {
    expect(isExternalFileDrag({ types: ['application/json'] })).toBe(false);
  });

  it('ignores anything dragged from inside the page', () => {
    window.dispatchEvent(new Event('dragstart'));
    expect(isExternalFileDrag({ types: ['text/uri-list', 'Files'] })).toBe(false);
    window.dispatchEvent(new Event('dragend'));
    expect(isExternalFileDrag({ types: ['Files'] })).toBe(true);
  });
});

describe('filesFromDrop', () => {
  it('reads a Firefox item when the file list is empty', () => {
    const file = new File(['pdf'], 'worksheet.pdf', { type: 'application/pdf' });
    const found = filesFromDrop({
      files: { length: 0 },
      items: [{ kind: 'file', getAsFile: () => file }],
    });
    expect(found).toEqual([file]);
  });
});

describe('worksheet files', () => {
  it('accepts PDF, JPG, and PNG worksheets', () => {
    expect(worksheetFileProblem(new File(['x'], 'a.pdf', { type: 'application/pdf' }))).toBe('');
    expect(worksheetFileProblem(new File(['x'], 'a.JPG', { type: '' }))).toBe('');
    expect(worksheetFileProblem(new File(['x'], 'a.docx', { type: 'application/msword' }))).toMatch(/PDF, JPG, or PNG/);
  });

  it('fills in a missing type from the file name', () => {
    expect(withWorksheetType(new File(['x'], 'scan.pdf', { type: '' })).type).toBe('application/pdf');
  });
});
