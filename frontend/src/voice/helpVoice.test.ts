import { describe, expect, it } from 'vitest';
import { isHelpVoiceStop } from './helpVoice';

describe('help voice stop', () => {
  it('ends the conversation on a short stop phrase', () => {
    expect(isHelpVoiceStop('stop')).toBe(true);
    expect(isHelpVoiceStop("That's enough.")).toBe(true);
    expect(isHelpVoiceStop('what jobs ordered balusters')).toBe(false);
  });
});
