const ENABLED_KEY = 'paarth.liminality.enabled';
const VOICE_URI_KEY = 'paarth.liminality.voiceUri';
const SPEED_KEY = 'paarth.liminality.speechSpeed';

export const LIMINALITY_SPEED_MIN = 0.7;
export const LIMINALITY_SPEED_MAX = 1.2;
export const LIMINALITY_SPEED_DEFAULT = 1;

export function readLiminalityEnabled() {
  try {
    return localStorage.getItem(ENABLED_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeLiminalityEnabled(enabled: boolean) {
  try {
    localStorage.setItem(ENABLED_KEY, enabled ? '1' : '0');
  } catch {
    /* ignore */
  }
}

export function readLiminalityVoiceUri() {
  try {
    return localStorage.getItem(VOICE_URI_KEY) || '';
  } catch {
    return '';
  }
}

export function writeLiminalityVoiceUri(uri: string) {
  try {
    if (!uri) localStorage.removeItem(VOICE_URI_KEY);
    else localStorage.setItem(VOICE_URI_KEY, uri);
  } catch {
    /* ignore */
  }
}

export function clampLiminalitySpeed(raw: unknown) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return LIMINALITY_SPEED_DEFAULT;
  return Math.min(LIMINALITY_SPEED_MAX, Math.max(LIMINALITY_SPEED_MIN, Math.round(n * 20) / 20));
}

export function readLiminalitySpeechSpeed() {
  try {
    return clampLiminalitySpeed(localStorage.getItem(SPEED_KEY));
  } catch {
    return LIMINALITY_SPEED_DEFAULT;
  }
}

export function writeLiminalitySpeechSpeed(speed: number) {
  try {
    localStorage.setItem(SPEED_KEY, String(clampLiminalitySpeed(speed)));
  } catch {
    /* ignore */
  }
}
