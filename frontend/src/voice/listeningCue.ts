let cueContext: AudioContext | null = null;

function getCueContext() {
  if (typeof window === 'undefined') return null;
  const Ctx = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  if (!cueContext) cueContext = new Ctx();
  return cueContext;
}

export function unlockListeningCue() {
  const ctx = getCueContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') void ctx.resume();
}

function tone(
  ctx: AudioContext,
  {
    type = 'sine',
    freq,
    freqEnd,
    start,
    duration,
    gain = 0.07,
  }: {
    type?: OscillatorType;
    freq: number;
    freqEnd?: number;
    start: number;
    duration: number;
    gain?: number;
  },
) {
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (freqEnd && freqEnd !== freq) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), start + duration);
  }
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(gain, start + 0.018);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(amp);
  amp.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

function whoosh(ctx: AudioContext, start: number) {
  const length = Math.floor(ctx.sampleRate * 0.28);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / length);
  }
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 4;
  filter.frequency.setValueAtTime(420, start);
  filter.frequency.exponentialRampToValueAtTime(2400, start + 0.22);
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(0.045, start + 0.04);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + 0.26);
  src.connect(filter);
  filter.connect(amp);
  amp.connect(ctx.destination);
  src.start(start);
}

/** Short sci-fi listen cue. Mic should be paused while this plays. */
export async function playListeningCue() {
  const ctx = getCueContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') {
    try {
      await ctx.resume();
    } catch {
      return;
    }
  }
  const t0 = ctx.currentTime + 0.02;
  whoosh(ctx, t0);
  tone(ctx, { type: 'sine', freq: 196, freqEnd: 392, start: t0, duration: 0.22, gain: 0.045 });
  tone(ctx, { type: 'triangle', freq: 784, start: t0 + 0.09, duration: 0.09, gain: 0.055 });
  tone(ctx, { type: 'sine', freq: 1175, start: t0 + 0.18, duration: 0.14, gain: 0.07 });
  tone(ctx, { type: 'sine', freq: 1568, start: t0 + 0.28, duration: 0.16, gain: 0.035 });
  await new Promise((resolve) => {
    window.setTimeout(resolve, 460);
  });
}
