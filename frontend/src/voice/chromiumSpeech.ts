import api from '../utils/axios';

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    [index: number]: { transcript?: string };
  }>;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  onhearing: (() => void) | null;
  ontranscribing: (() => void) | null;
  onidle: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

const TARGET_RATE = 16000;
const SILENCE_MS = 380;
const MIN_SPEECH_MS = 220;
const MAX_SPEECH_MS = 8000;
const POLL_MS = 50;

let primedStream: MediaStream | null = null;
let priming: Promise<MediaStream> | null = null;
let sharedContext: AudioContext | null = null;

function ensureStream() {
  if (liveStream(primedStream) && primedStream) return Promise.resolve(primedStream);
  if (!priming) {
    priming = navigator.mediaDevices.getUserMedia(micConstraints())
      .then((stream) => {
        primedStream = stream;
        return stream;
      })
      .finally(() => {
        priming = null;
      });
  }
  return priming;
}

function liveStream(stream: MediaStream | null) {
  return Boolean(stream && stream.getAudioTracks().some((track) => track.readyState === 'live'));
}

function rms(samples: Float32Array) {
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, samples.length));
}

function mergeSamples(chunks: Float32Array[]) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Float32Array(length);
  let offset = 0;
  chunks.forEach((chunk) => {
    merged.set(chunk, offset);
    offset += chunk.length;
  });
  return merged;
}

function downsample(input: Float32Array, inRate: number, outRate: number) {
  if (outRate >= inRate) return input;
  const ratio = inRate / outRate;
  const length = Math.floor(input.length / ratio);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    let count = 0;
    for (let j = start; j < end; j += 1) {
      sum += input[j];
      count += 1;
    }
    out[i] = count ? sum / count : 0;
  }
  return out;
}

function encodeWav(samples: Float32Array, sampleRate: number) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  write(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

async function transcribeBlob(blob: Blob, filename: string, signal?: AbortSignal) {
  const body = new FormData();
  body.append('audio', blob, filename);
  const response = await api.post('/tts/transcribe', body, { timeout: 12_000, signal });
  return String(response.data?.text || '').trim();
}

function micConstraints(): MediaStreamConstraints {
  return {
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: true,
      channelCount: 1,
    },
  };
}

function audioContext() {
  const AudioCtx = window.AudioContext
    || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;
  if (!sharedContext || sharedContext.state === 'closed') sharedContext = new AudioCtx();
  return sharedContext;
}

function recorderMime() {
  if (typeof MediaRecorder === 'undefined') return '';
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
  return types.find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

export async function primeChromiumMicrophone() {
  await ensureStream();
  const context = audioContext();
  if (context?.state === 'suspended') await context.resume();
}

export function createChromiumSpeechRecognition(): SpeechRecognitionLike {
  let paused = true;
  let opening = false;
  let polling = false;
  let stream: MediaStream | null = null;
  let analyser: AnalyserNode | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let timer = 0;
  let recorder: MediaRecorder | null = null;
  let recorderBlobs: Blob[] = [];
  let pcmChunks: Float32Array[] = [];
  let speechMs = 0;
  let silenceMs = 0;
  let inSpeech = false;
  let noise = 0.004;
  let sending = false;
  let queued: { blob: Blob; filename: string } | null = null;
  let transcribeAbort: AbortController | null = null;
  const mime = recorderMime();

  const recognition: SpeechRecognitionLike = {
    continuous: true,
    interimResults: true,
    lang: 'en-US',
    onresult: null,
    onerror: null,
    onend: null,
    onhearing: null,
    ontranscribing: null,
    onidle: null,
    start() {
      paused = false;
      if (polling && liveStream(stream)) return;
      if (opening) return;
      void open();
    },
    stop() {
      const teardown = recognition.onend == null;
      paused = true;
      discardUtterance();
      if (teardown) {
        release();
        return;
      }
      recognition.onend?.();
    },
    abort() {
      paused = true;
      recognition.onend = null;
      release();
    },
  };

  function abortTranscribe() {
    try {
      transcribeAbort?.abort();
    } catch {
      /* ignore */
    }
    transcribeAbort = null;
    queued = null;
    sending = false;
  }

  function discardUtterance() {
    abortTranscribe();
    speechMs = 0;
    silenceMs = 0;
    inSpeech = false;
    pcmChunks = [];
    queued = null;
    if (recorder && recorder.state !== 'inactive') {
      recorder.onstop = null;
      try {
        recorder.stop();
      } catch {
        /* already stopped */
      }
    }
    recorder = null;
    recorderBlobs = [];
  }

  function release() {
    if (timer) window.clearInterval(timer);
    timer = 0;
    polling = false;
    discardUtterance();
    source?.disconnect();
    analyser?.disconnect();
    source = null;
    analyser = null;
    stream?.getTracks().forEach((track) => track.stop());
    if (stream && stream === primedStream) primedStream = null;
    stream = null;
  }

  async function open() {
    opening = true;
    try {
      if (!liveStream(primedStream)) await ensureStream();
      if (paused) return;
      stream = primedStream;
      const context = audioContext();
      if (!context || !stream) throw new Error('AudioContext unavailable');
      if (context.state === 'suspended') await context.resume();
      if (paused) return;
      source = context.createMediaStreamSource(stream);
      analyser = context.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0;
      source.connect(analyser);
      polling = true;
      const samples = new Float32Array(analyser.fftSize);
      timer = window.setInterval(() => {
        if (!analyser || paused) return;
        analyser.getFloatTimeDomainData(samples);
        onLevel(samples, POLL_MS, context.sampleRate);
      }, POLL_MS);
    } catch (error) {
      const name = error instanceof DOMException ? error.name : '';
      recognition.onerror?.({
        error: name === 'NotAllowedError' || name === 'NotFoundError' ? 'not-allowed' : 'network',
      });
    } finally {
      opening = false;
    }
  }

  function onLevel(samples: Float32Array, frameMs: number, sampleRate: number) {
    const level = rms(samples);
    const threshold = Math.max(0.006, noise * 2.8);
    if (!inSpeech) noise = noise * 0.96 + level * 0.04;
    if (level >= threshold) {
      if (!inSpeech) beginUtterance();
      inSpeech = true;
      silenceMs = 0;
      speechMs += frameMs;
      if (!recorder) pcmChunks.push(new Float32Array(samples));
      if (speechMs >= MAX_SPEECH_MS) finishUtterance(sampleRate);
      return;
    }
    if (!inSpeech) return;
    silenceMs += frameMs;
    if (!recorder) pcmChunks.push(new Float32Array(samples));
    if (silenceMs >= SILENCE_MS) finishUtterance(sampleRate);
  }

  function beginUtterance() {
    pcmChunks = [];
    recorderBlobs = [];
    recognition.onhearing?.();
    if (!stream || !mime) return;
    try {
      recorder = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 24_000 });
      recorder.ondataavailable = (event) => {
        if (event.data?.size) recorderBlobs.push(event.data);
      };
      recorder.start();
    } catch {
      recorder = null;
    }
  }

  function finishUtterance(sampleRate: number) {
    const spokenFor = speechMs;
    const active = recorder;
    const pcm = pcmChunks;
    inSpeech = false;
    speechMs = 0;
    silenceMs = 0;
    pcmChunks = [];
    recorder = null;
    if (spokenFor < MIN_SPEECH_MS) {
      if (active && active.state !== 'inactive') {
        active.onstop = null;
        try {
          active.stop();
        } catch {
          /* already stopped */
        }
      }
      recorderBlobs = [];
      return;
    }
    if (active && active.state !== 'inactive') {
      active.onstop = () => {
        const type = active.mimeType || mime || 'audio/webm';
        const ext = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'webm';
        const blob = new Blob(recorderBlobs, { type });
        recorderBlobs = [];
        if (blob.size > 800) queueSend(blob, `speech.${ext}`);
      };
      try {
        active.stop();
      } catch {
        /* already stopped */
      }
      return;
    }
    if (!pcm.length) return;
    const samples = downsample(mergeSamples(pcm), sampleRate, TARGET_RATE);
    queueSend(encodeWav(samples, TARGET_RATE), 'speech.wav');
  }

  function queueSend(blob: Blob, filename: string) {
    if (paused) return;
    recognition.ontranscribing?.();
    if (sending) {
      queued = { blob, filename };
      return;
    }
    void send(blob, filename);
  }

  async function send(blob: Blob, filename: string) {
    const ac = new AbortController();
    transcribeAbort = ac;
    sending = true;
    if (!paused) recognition.ontranscribing?.();
    try {
      const text = await transcribeBlob(blob, filename, ac.signal);
      if (ac.signal.aborted || paused || transcribeAbort !== ac) {
        if (!paused) recognition.onidle?.();
        return;
      }
      if (text) {
        recognition.onresult?.({
          resultIndex: 0,
          results: [{ isFinal: true, 0: { transcript: text } }],
        });
      } else {
        recognition.onidle?.();
      }
    } catch (error) {
      if (ac.signal.aborted || paused) return;
      const canceled = (error as { code?: string; name?: string })?.code === 'ERR_CANCELED'
        || (error as { name?: string })?.name === 'CanceledError'
        || (error as { name?: string })?.name === 'AbortError';
      if (canceled) return;
      recognition.onerror?.({ error: 'network' });
      recognition.onidle?.();
    } finally {
      if (transcribeAbort === ac) transcribeAbort = null;
      sending = false;
      if (!paused && queued) {
        const next = queued;
        queued = null;
        void send(next.blob, next.filename);
      }
    }
  }

  return recognition;
}
