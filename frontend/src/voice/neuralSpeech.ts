import api from '../utils/axios';
import { readLiminalitySpeechSpeed } from './liminalitySettings';
import { neuralVoiceIdFromUri, isNeuralVoiceUri } from './neuralVoices';

const clipCache = new Map<string, Blob>();
const MAX_CACHE = 80;
const PREFETCH_BATCH = 3;
const SILENT_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=';

let sharedAudio: HTMLAudioElement | null = null;
let currentUrl: string | null = null;
let speakAbort: AbortController | null = null;
let pcmSources: AudioBufferSourceNode[] = [];

function ensureAudio() {
  if (!sharedAudio) sharedAudio = new Audio();
  return sharedAudio;
}

export function unlockNeuralAudio() {
  const ctx = getAudioContext();
  if (ctx?.state === 'suspended') void ctx.resume();
  const audio = ensureAudio();
  if (!audio.src) audio.src = SILENT_WAV;
  audio.muted = true;
  void audio
    .play()
    .catch(() => {})
    .finally(() => {
      audio.muted = false;
    });
}

function stopCurrentAudio() {
  if (sharedAudio) {
    sharedAudio.pause();
    sharedAudio.removeAttribute('src');
    sharedAudio.load();
  }
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl);
    currentUrl = null;
  }
}

export function cancelNeuralSpeech() {
  try {
    speakAbort?.abort();
  } catch {
    /* ignore */
  }
  speakAbort = null;
  pcmSources.forEach((source) => {
    try {
      source.stop();
    } catch {
      /* ignore */
    }
  });
  pcmSources = [];
  stopCurrentAudio();
}

function cacheKey(voice: string, text: string, tone = 'polite', speed = 1) {
  return `${voice}::${tone}::${speed}::${text}`;
}

function rememberClip(key: string, blob: Blob) {
  clipCache.set(key, blob);
  if (clipCache.size <= MAX_CACHE) return;
  const first = clipCache.keys().next().value;
  if (first) clipCache.delete(first);
}

async function errorFromSpeechResponse(error: unknown) {
  const data = (error as { response?: { data?: unknown } })?.response?.data;
  if (data instanceof Blob) {
    try {
      const parsed = JSON.parse(await data.text()) as { error?: string };
      if (parsed?.error) return parsed.error;
    } catch {
      /* ignore */
    }
  }
  if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string') {
    return data.error;
  }
  return 'ElevenLabs speech failed.';
}

async function fetchSpeechBlob(
  text: string,
  voice: string,
  signal: AbortSignal,
  tone = 'polite',
  speed = 1,
) {
  const key = cacheKey(voice, text, tone, speed);
  const cached = clipCache.get(key);
  if (cached) return cached;

  try {
    const response = await api.post(
      '/tts/speech',
      { text, voice, tone, speed },
      { responseType: 'blob', signal }
    );
    const blob = response.data as Blob;
    const type = String(blob?.type || response.headers['content-type'] || '');
    if (type.includes('json')) {
      throw new Error(await errorFromSpeechResponse({ response: { data: blob } }));
    }
    rememberClip(key, blob);
    return blob;
  } catch (error) {
    if (error instanceof Error && !('response' in error)) throw error;
    throw new Error(await errorFromSpeechResponse(error));
  }
}

function playBlob(blob: Blob, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    stopCurrentAudio();
    const url = URL.createObjectURL(blob);
    const audio = ensureAudio();
    currentUrl = url;
    audio.muted = false;
    audio.src = url;

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      audio.onended = null;
      audio.onerror = null;
      if (currentUrl === url) {
        URL.revokeObjectURL(url);
        currentUrl = null;
      }
      resolve();
    };

    const onAbort = () => {
      audio.pause();
      finish();
    };

    signal.addEventListener('abort', onAbort, { once: true });
    audio.onended = finish;
    audio.onerror = finish;
    void audio.play().catch(finish);
  });
}

export async function prefetchNeuralSpeech(
  texts: string[],
  voiceUri: string,
  tone: 'polite' | 'candid' = 'polite',
) {
  if (!isNeuralVoiceUri(voiceUri)) return;
  const voice = neuralVoiceIdFromUri(voiceUri);
  const speed = readLiminalitySpeechSpeed();
  const unique = [...new Set(texts.map((line) => String(line || '').trim()).filter(Boolean))];
  const pending = unique.filter((text) => !clipCache.has(cacheKey(voice, text, tone, speed)));
  for (let i = 0; i < pending.length; i += PREFETCH_BATCH) {
    const batch = pending.slice(i, i + PREFETCH_BATCH);
    await Promise.all(
      batch.map((text) =>
        fetchSpeechBlob(text, voice, new AbortController().signal, tone, speed).catch(() => null),
      ),
    );
  }
}

function ttsStreamUrl() {
  const base = String(api.defaults.baseURL || import.meta.env.VITE_API_URL || 'http://localhost:4000').replace(
    /\/+$/,
    '',
  );
  return `${base}/tts/speech-stream`;
}

function ttsAuthHeaders() {
  const token = localStorage.getItem('accessToken');
  const tenantId = localStorage.getItem('tenantId');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (tenantId && /^[a-fA-F0-9]{24}$/.test(tenantId.trim())) {
    headers['x-tenant-id'] = tenantId.trim();
  }
  return headers;
}

let audioCtx: AudioContext | null = null;

function getAudioContext() {
  const Ctor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!audioCtx || audioCtx.state === 'closed') audioCtx = new Ctor();
  if (audioCtx.state === 'suspended') void audioCtx.resume();
  return audioCtx;
}

function pcm16ToFloat32(bytes: Uint8Array) {
  const aligned = bytes.byteOffset % 2 === 0 ? bytes : bytes.slice();
  const samples = new Float32Array(Math.floor(aligned.byteLength / 2));
  const view = new DataView(aligned.buffer, aligned.byteOffset, samples.length * 2);
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = view.getInt16(i * 2, true) / 32768;
  }
  return samples;
}

async function playPcmStream(response: Response, signal: AbortSignal) {
  const ctx = getAudioContext();
  const body = response.body;
  if (!ctx || !body) {
    const blob = await response.blob();
    await playBlob(blob, signal);
    return;
  }

  const reader = body.getReader();
  let pending = new Uint8Array(0);
  let nextTime = 0;
  let lastSource: AudioBufferSourceNode | null = null;

  const enqueue = (bytes: Uint8Array) => {
    if (bytes.byteLength < 2) return;
    const samples = pcm16ToFloat32(bytes);
    if (!samples.length) return;
    const buffer = ctx.createBuffer(1, samples.length, 24000);
    buffer.copyToChannel(samples, 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    const startAt = Math.max(ctx.currentTime + 0.04, nextTime);
    source.start(startAt);
    nextTime = startAt + buffer.duration;
    lastSource = source;
    pcmSources.push(source);
  };

  const onAbort = () => {
    try {
      reader.cancel();
    } catch {
      /* ignore */
    }
  };
  signal.addEventListener('abort', onAbort, { once: true });

  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      const merged = new Uint8Array(pending.byteLength + value.byteLength);
      merged.set(pending, 0);
      merged.set(value, pending.byteLength);
      const even = merged.byteLength - (merged.byteLength % 2);
      if (even >= 4800) {
        enqueue(merged.slice(0, even));
        pending = merged.slice(even);
      } else {
        pending = merged;
      }
    }
    const even = pending.byteLength - (pending.byteLength % 2);
    if (even >= 2) enqueue(pending.slice(0, even));
    if (lastSource && !signal.aborted) {
      await new Promise<void>((resolve) => {
        lastSource.onended = () => resolve();
        if (signal.aborted) resolve();
      });
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

async function streamSpeech(
  text: string,
  voice: string,
  signal: AbortSignal,
  tone = 'polite',
  speed = 1,
) {
  const response = await fetch(ttsStreamUrl(), {
    method: 'POST',
    headers: ttsAuthHeaders(),
    body: JSON.stringify({ text, voice, tone, speed }),
    signal,
  });
  const type = String(response.headers.get('content-type') || '');
  if (!response.ok || type.includes('json')) {
    const err = await response.json().catch(() => ({ error: 'ElevenLabs stream failed.' }));
    throw new Error(typeof err?.error === 'string' ? err.error : 'ElevenLabs stream failed.');
  }
  await playPcmStream(response, signal);
}

export async function speakNeural(
  text: string,
  voiceUri: string,
  tone: 'polite' | 'candid' | 'asmr' = 'polite',
) {
  if (!isNeuralVoiceUri(voiceUri)) {
    throw new Error('Not a studio voice');
  }
  cancelNeuralSpeech();
  const controller = new AbortController();
  speakAbort = controller;
  const voice = neuralVoiceIdFromUri(voiceUri);
  const speed = readLiminalitySpeechSpeed();
  const cached = clipCache.get(cacheKey(voice, text, tone, speed));
  if (cached) {
    await playBlob(cached, controller.signal);
    return;
  }
  try {
    await streamSpeech(text, voice, controller.signal, tone, speed);
  } catch {
    if (controller.signal.aborted) return;
    const blob = await fetchSpeechBlob(text, voice, controller.signal, tone, speed);
    if (controller.signal.aborted) return;
    await playBlob(blob, controller.signal);
  }
}
