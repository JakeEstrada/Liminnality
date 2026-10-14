import { createChromiumSpeechRecognition } from './chromiumSpeech';
import { liminalityPrefetchLines } from './liminalityCommands';
import { readLiminalityVoiceUri } from './liminalitySettings';
import { neuralVoiceIdFromUri } from './neuralVoices';
import { cancelNeuralSpeech, prefetchNeuralSpeech, speakNeural, unlockNeuralAudio } from './neuralSpeech';

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    [index: number]: { transcript?: string };
  }>;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

export function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  const speechWindow = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition || null;
}

function browserBrands() {
  const brands = (navigator as Navigator & {
    userAgentData?: { brands?: Array<{ brand: string }> };
  }).userAgentData?.brands;
  return brands?.map((brand) => brand.brand) || [];
}

/** Real Google Chrome. Raspberry Pi Chromium does not report this brand. */
export function isGoogleChrome() {
  if (typeof navigator === 'undefined') return false;
  return browserBrands().includes('Google Chrome');
}

/** Chromium, including Raspberry Pi OS. Excludes Edge, Opera, and Firefox. */
export function isChromiumBrowser() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/Edg\/|OPR\/|Opera|Firefox\/|SamsungBrowser/.test(ua)) return false;
  const brands = browserBrands();
  if (brands.length) return brands.includes('Chromium') || brands.includes('Google Chrome');
  return /Chromium\/|Chrome\//.test(ua);
}

function isPiOrArmLinux() {
  const ua = navigator.userAgent || '';
  const platform = navigator.platform || '';
  if (/CrOS/.test(ua)) return false;
  return /aarch64|armv7l|armv6l|raspberry/i.test(`${ua} ${platform}`);
}

/**
 * Chromium has a speech recognizer object, but on the Pi it only grabs the mic
 * and never returns words. Chrome and Edge keep the built-in recognizer.
 */
export function usesServerSpeechCapture() {
  if (typeof navigator === 'undefined') return false;
  if (!navigator.mediaDevices?.getUserMedia) return false;
  const ua = navigator.userAgent || '';
  if (/Edg\/|OPR\/|Opera|Firefox\/|SamsungBrowser/.test(ua)) return false;
  if (isPiOrArmLinux()) return isChromiumBrowser() || /Chrome\/|Chromium\//.test(ua);
  if (isGoogleChrome()) return false;
  return isChromiumBrowser();
}

export function isSpeechRecognitionSupported() {
  if (getSpeechRecognitionCtor() && window.speechSynthesis) return true;
  return usesServerSpeechCapture();
}

export function createSpeechRecognition(): SpeechRecognitionLike | null {
  if (usesServerSpeechCapture()) return createChromiumSpeechRecognition();
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) return null;
  const recognition = new Ctor();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';
  return recognition;
}

const CUTE_VOICE_NAMES = [
  'samantha',
  'karen',
  'tessa',
  'moira',
  'fiona',
  'aria',
  'jenny',
  'ana',
  'sonia',
  'zira',
  'susan',
  'victoria',
  'allison',
  'ava',
  'salli',
  'joanna',
  'ivy',
  'google us english',
  'google uk english female',
];

const AVOID_VOICE_NAMES = [
  'zarvox',
  'trinoids',
  'bad news',
  'good news',
  'whisper',
  'boing',
  'bubbles',
  'cellos',
  'albert',
  'ralph',
  'fred',
  'junior',
  'daniel',
  'alex',
  'tom',
  'david',
  'mark',
  'guy',
  'compact',
];

let cachedVoice: SpeechSynthesisVoice | null = null;
let voicesReady: Promise<SpeechSynthesisVoice[]> | null = null;

function listVoices() {
  return window.speechSynthesis?.getVoices() || [];
}

export function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  if (!window.speechSynthesis) return Promise.resolve([]);
  const already = listVoices();
  if (already.length) return Promise.resolve(already);
  if (voicesReady) return voicesReady;
  voicesReady = new Promise((resolve) => {
    const finish = () => {
      window.speechSynthesis.removeEventListener('voiceschanged', finish);
      const loaded = listVoices();
      if (!loaded.length) voicesReady = null;
      resolve(loaded);
    };
    window.speechSynthesis.addEventListener('voiceschanged', finish);
    window.setTimeout(finish, 800);
  });
  return voicesReady;
}

export function voiceChoiceLabel(voice: SpeechSynthesisVoice) {
  const lang = String(voice.lang || '').trim();
  const online = voice.localService ? '' : ' · online';
  return lang ? `${voice.name} (${lang})${online}` : `${voice.name}${online}`;
}

export function listSelectableVoices(voices: SpeechSynthesisVoice[]) {
  const seen = new Set<string>();
  const unique = voices.filter((voice) => {
    const key = voice.voiceURI || `${voice.name}:${voice.lang}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return Boolean(voice.name);
  });
  return unique.sort((a, b) => {
    const aEn = String(a.lang || '').toLowerCase().startsWith('en') ? 0 : 1;
    const bEn = String(b.lang || '').toLowerCase().startsWith('en') ? 0 : 1;
    if (aEn !== bEn) return aEn - bEn;
    const scoreDiff = scoreVoice(b) - scoreVoice(a);
    if (scoreDiff !== 0) return scoreDiff;
    return String(a.name).localeCompare(String(b.name));
  });
}

function resolveSpeakVoice(voices: SpeechSynthesisVoice[]) {
  const selectedUri = readLiminalityVoiceUri();
  if (selectedUri) {
    const match = voices.find(
      (voice) => voice.voiceURI === selectedUri || voice.name === selectedUri
    );
    if (match) return match;
  }
  return pickCuteVoice(voices);
}

function scoreVoice(voice: SpeechSynthesisVoice) {
  const name = String(voice.name || '').toLowerCase();
  const lang = String(voice.lang || '').toLowerCase();
  if (AVOID_VOICE_NAMES.some((part) => name.includes(part))) return -100;
  if (!lang.startsWith('en')) return -50;

  let score = 10;
  if (lang.startsWith('en-us')) score += 8;
  if (lang.startsWith('en-gb') || lang.startsWith('en-au')) score += 5;
  if (voice.localService) score += 3;
  if (/neural|natural|premium|online|enhanced/.test(name)) score += 18;
  if (/female|woman|girl/.test(name)) score += 12;
  if (CUTE_VOICE_NAMES.some((part) => name.includes(part))) score += 20;
  return score;
}

function pickCuteVoice(voices: SpeechSynthesisVoice[]) {
  if (cachedVoice && voices.some((voice) => voice.voiceURI === cachedVoice?.voiceURI)) {
    return cachedVoice;
  }
  const ranked = [...voices].sort((a, b) => scoreVoice(b) - scoreVoice(a));
  cachedVoice = ranked[0] || null;
  return cachedVoice;
}

export function collectTranscript(event: SpeechRecognitionEventLike) {
  let finalText = '';
  let interimText = '';
  for (let i = event.resultIndex; i < event.results.length; i += 1) {
    const result = event.results[i];
    const piece = String(result?.[0]?.transcript || '').trim();
    if (!piece) continue;
    if (result.isFinal) finalText = finalText ? `${finalText} ${piece}` : piece;
    else interimText = interimText ? `${interimText} ${piece}` : piece;
  }
  return { finalText, interimText };
}

function softenSpokenText(text: string) {
  return String(text || '')
    .replace(/([.?!])\s+/g, '$1 ')
    .trim();
}

export async function speakText(
  text: string,
  options?: { tone?: 'polite' | 'candid' },
): Promise<void> {
  const spoken = softenSpokenText(text);
  if (!spoken) return;

  const selectedUri = neuralVoiceIdFromUri(readLiminalityVoiceUri());
  await speakNeural(spoken, selectedUri, options?.tone);
}

export function warmUpSpeechVoices() {
  void loadVoices();
}

export function prefetchLiminalitySpeech() {
  unlockNeuralAudio();
  const voice = neuralVoiceIdFromUri(readLiminalityVoiceUri());
  const { polite, candid } = liminalityPrefetchLines();
  void prefetchNeuralSpeech(polite, voice, 'polite').then(() =>
    prefetchNeuralSpeech(candid, voice, 'candid'),
  );
}

export function cancelSpeech() {
  cancelNeuralSpeech();
  try {
    window.speechSynthesis?.cancel();
  } catch {
    /* ignore */
  }
}
