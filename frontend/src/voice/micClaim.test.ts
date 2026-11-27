import { describe, expect, it } from 'vitest';
import { claimMicrophone, microphoneHeldBy, microphoneOwner, releaseMicrophone } from './micClaim';

describe('microphone claim', () => {
  it('lets the help window take the mic and hand it back', () => {
    releaseMicrophone('help');
    claimMicrophone('help');
    expect(microphoneOwner()).toBe('help');
    expect(microphoneHeldBy('help')).toBe(true);
    releaseMicrophone('help');
    expect(microphoneHeldBy('help')).toBe(false);
  });
});