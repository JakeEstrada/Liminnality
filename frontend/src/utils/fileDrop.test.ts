import { describe, expect, it } from 'vitest';
import { filesFromDrop, isExternalFileDrag } from './fileDrop';

describe('isExternalFileDrag', () => {
  it('recognizes a Linux file-manager drag', () => {
    expect(
      isExternalFileDrag({
        types: ['application/x-moz-file', 'text/x-moz-url', 'text/uri-list', 'text/plain'],
      }),
    ).toBe(true);
  });

  it('recognizes a Chrome file drag', () => {
    expect(isExternalFileDrag({ types: ['Files'] })).toBe(true);
  });

  it('leaves a job card drag on the pipeline', () => {
    expect(isExternalFileDrag({ types: ['application/json'] })).toBe(false);
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
