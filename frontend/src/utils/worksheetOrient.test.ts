import { describe, expect, it } from 'vitest';
import { headerRotation } from './worksheetOrient';

describe('headerRotation', () => {
  it('turns a right-side header up', () => {
    expect(headerRotation({ top: 0.03, right: 0.27, bottom: 0.02, left: 0 })).toBe(-90);
  });

  it('leaves an upright header alone', () => {
    expect(headerRotation({ top: 0.26, right: 0.04, bottom: 0, left: 0.03 })).toBe(0);
  });

  it('ignores a page with no blue bar', () => {
    expect(headerRotation({ top: 0.02, right: 0.03, bottom: 0.01, left: 0.02 })).toBe(0);
  });
});
