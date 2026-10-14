import { getPrimedMicStream, getSharedAudioContext, primeChromiumMicrophone } from './chromiumSpeech';

const FFT_SIZE = 1024;
const WAVE_SAMPLES = 160;

let users = 0;
let stream: MediaStream | null = null;
let source: MediaStreamAudioSourceNode | null = null;
let analyser: AnalyserNode | null = null;
let ownsStream = false;
const timeData = new Uint8Array(FFT_SIZE);

function live(next: MediaStream | null) {
  return Boolean(next && next.getAudioTracks().some((track) => track.readyState === 'live'));
}

async function connect() {
  if (analyser && live(stream)) {
    const context = getSharedAudioContext();
    if (context?.state === 'suspended') await context.resume();
    return;
  }
  disconnect();
  await primeChromiumMicrophone().catch(() => {});
  stream = getPrimedMicStream();
  if (!live(stream)) {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true },
    });
    ownsStream = true;
  }
  const context = getSharedAudioContext();
  if (!context || !stream) throw new Error('Microphone waveform unavailable');
  if (context.state === 'suspended') await context.resume();
  source = context.createMediaStreamSource(stream);
  analyser = context.createAnalyser();
  analyser.fftSize = FFT_SIZE;
  analyser.smoothingTimeConstant = 0.12;
  source.connect(analyser);
}

function disconnect() {
  source?.disconnect();
  analyser?.disconnect();
  source = null;
  analyser = null;
  if (ownsStream) {
    stream?.getTracks().forEach((track) => track.stop());
  }
  stream = null;
  ownsStream = false;
}

export async function startMicWaveform() {
  users += 1;
  if (users > 1 && analyser) return;
  try {
    await connect();
  } catch {
    users = Math.max(0, users - 1);
  }
}

export function stopMicWaveform() {
  users = Math.max(0, users - 1);
  if (users === 0) disconnect();
}

export function readMicWaveform(target: number[]) {
  const count = target.length || WAVE_SAMPLES;
  if (!analyser) {
    for (let i = 0; i < count; i += 1) target[i] = 0;
    return false;
  }
  analyser.getByteTimeDomainData(timeData);
  const step = Math.max(1, Math.floor(timeData.length / count));
  for (let i = 0; i < count; i += 1) {
    const sample = timeData[i * step] ?? 128;
    target[i] = (sample - 128) / 128;
  }
  return true;
}
