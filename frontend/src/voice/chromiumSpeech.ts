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
  start: () => void;
  stop: () => void;
  abort: () => void;
};

const TARGET_RATE = 16000;
const SPEECH_RMS = 0.02;
const SILENCE_MS = 800;
const MIN_SPEECH_MS = 280;
const MAX_SPEECH_MS = 12000;

let primedStream: MediaStream | null = null;
let priming: Promise<MediaStream> | null = null;

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

async function transcribeWav(blob: Blob) {
  const body = new FormData();
  body.append('audio', blob, 'speech.wav');
  const response = await api.post('/tts/transcribe', body);
  return String(response.data?.text || '').trim();
}

function micConstraints(): MediaStreamConstraints {
  return {
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
    },
  };
}

export async function primeChromiumMicrophone() {
  await ensureStream();
}

export function createChromiumSpeechRecognition(): SpeechRecognitionLike {
  let paused = true;
  let opening = false;
  let context: AudioContext | null = null;
  let processor: ScriptProcessorNode | null = null;
  let stream: MediaStream | null = null;
  let chunks: Float32Array[] = [];
  let speechMs = 0;
  let silenceMs = 0;
  let inSpeech = false;
  let sending = false;
  let queued: Float32Array | null = null;

  const recognition: SpeechRecognitionLike = {
    continuous: true,
    interimResults: true,
    lang: 'en-US',
    onresult: null,
    onerror: null,
    onend: null,
    start() {
      paused = false;
      if (context && stream && liveStream(stream)) return;
      if (opening) return;
      void open();
    },
    stop() {
      const teardown = recognition.onend == null;
      paused = true;
      chunks = [];
      speechMs = 0;
      silenceMs = 0;
      inSpeech = false;
      queued = null;
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

  function release() {
    processor?.disconnect();
    processor = null;
    if (context) {
      void context.close().catch(() => {});
      context = null;
    }
    stream?.getTracks().forEach((track) => track.stop());
    if (stream && stream === primedStream) primedStream = null;
    stream = null;
    chunks = [];
    inSpeech = false;
    queued = null;
  }

  async function open() {
    opening = true;
    try {
      if (!liveStream(primedStream)) {
        await ensureStream();
      }
      if (paused) return;
      stream = primedStream;
      const AudioCtx = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) throw new Error('AudioContext unavailable');
      context = new AudioCtx();
      if (context.state === 'suspended') await context.resume();
      if (paused || !stream) return;
      const source = context.createMediaStreamSource(stream);
      processor = context.createScriptProcessor(4096, 1, 1);
      const mute = context.createGain();
      mute.gain.value = 0;
      processor.onaudioprocess = (event) => onAudio(event.inputBuffer.getChannelData(0));
      source.connect(processor);
      processor.connect(mute);
      mute.connect(context.destination);
    } catch (error) {
      const name = error instanceof DOMException ? error.name : '';
      recognition.onerror?.({
        error: name === 'NotAllowedError' || name === 'NotFoundError' ? 'not-allowed' : 'network',
      });
    } finally {
      opening = false;
    }
  }

  function onAudio(input: Float32Array) {
    if (paused || !context) return;
    const frameMs = (input.length / context.sampleRate) * 1000;
    const level = rms(input);
    if (level >= SPEECH_RMS) {
      inSpeech = true;
      silenceMs = 0;
      speechMs += frameMs;
      chunks.push(new Float32Array(input));
      if (speechMs >= MAX_SPEECH_MS) flush();
      return;
    }
    if (!inSpeech) return;
    silenceMs += frameMs;
    chunks.push(new Float32Array(input));
    if (silenceMs >= SILENCE_MS) flush();
  }

  function flush() {
    const sampleRate = context?.sampleRate || TARGET_RATE;
    const captured = chunks;
    const spokenFor = speechMs;
    chunks = [];
    speechMs = 0;
    silenceMs = 0;
    inSpeech = false;
    if (spokenFor < MIN_SPEECH_MS || !captured.length) return;
    const samples = downsample(mergeSamples(captured), sampleRate, TARGET_RATE);
    if (sending) {
      queued = samples;
      return;
    }
    void send(samples);
  }

  async function send(samples: Float32Array) {
    sending = true;
    try {
      const text = await transcribeWav(encodeWav(samples, TARGET_RATE));
      if (!paused && text) {
        recognition.onresult?.({
          resultIndex: 0,
          results: [{ isFinal: true, 0: { transcript: text } }],
        });
      }
    } catch {
      if (!paused) recognition.onerror?.({ error: 'network' });
    } finally {
      sending = false;
      if (!paused && queued) {
        const next = queued;
        queued = null;
        void send(next);
      }
    }
  }

  return recognition;
}
