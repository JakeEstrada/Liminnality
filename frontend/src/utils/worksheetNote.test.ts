import { describe, expect, it } from 'vitest';
import { upsertWorksheetNote } from './worksheetNote';

describe('upsertWorksheetNote', () => {
  it('adds a worksheet note and keeps the other notes', () => {
    const notes = upsertWorksheetNote(
      [{ content: 'Called the customer', _id: 'n1' }],
      'Scope: Oak rail',
    );
    expect(notes).toEqual([
      { content: 'Called the customer', _id: 'n1' },
      { content: 'Scope: Oak rail', isWorksheet: true },
    ]);
  });

  it('replaces the worksheet note already on the job', () => {
    const notes = upsertWorksheetNote(
      [
        { content: 'Scope: Old rail', isWorksheet: true, _id: 'n1' },
        { content: 'Stage updated: Estimate Sent', isStageChange: true, _id: 'n2' },
      ],
      'Scope: Maple rail',
    );
    expect(notes).toEqual([
      { content: 'Scope: Maple rail', isWorksheet: true, _id: 'n1' },
      { content: 'Stage updated: Estimate Sent', isStageChange: true, _id: 'n2' },
    ]);
  });
});
