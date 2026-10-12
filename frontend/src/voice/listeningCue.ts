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

function connectFx(ctx: AudioContext, start: number) {
  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.setValueAtTime(90, start);
  const delay = ctx.createDelay();
  delay.delayTime.value = 0.078;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.22;
  const wet = ctx.createGain();
  wet.gain.value = 0.28;
  const master = ctx.createGain();
  master.gain.value = 1;
  filter.connect(master);
  filter.connect(delay);
  delay.connect(feedback);
  feedback.connect(delay);
  delay.connect(wet);
  wet.connect(master);
  master.connect(ctx.destination);
  return { input: filter, master };
}

function tone(
  ctx: AudioContext,
  dest: AudioNode,
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
  amp.gain.exponentialRampToValueAtTime(gain, start + Math.min(0.012, duration * 0.2));
  amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(amp);
  amp.connect(dest);
  osc.start(start);
  osc.stop(start + duration + 0.03);
}

function noiseBurst(
  ctx: AudioContext,
  dest: AudioNode,
  start: number,
  duration: number,
  fromHz: number,
  toHz: number,
  gain: number,
  q = 6,
) {
  const length = Math.floor(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / length);
  }
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = q;
  filter.frequency.setValueAtTime(fromHz, start);
  filter.frequency.exponentialRampToValueAtTime(Math.max(80, toHz), start + duration);
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(gain, start + 0.03);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  src.connect(filter);
  filter.connect(amp);
  amp.connect(dest);
  src.start(start);
}

/** Sci-fi listen cue. Mic should be paused while this plays. */
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
  const fx = connectFx(ctx, t0);

  noiseBurst(ctx, fx.input, t0, 0.34, 280, 3200, 0.07, 3.2);
  noiseBurst(ctx, fx.input, t0 + 0.08, 0.22, 1800, 5200, 0.04, 8);

  tone(ctx, fx.input, { type: 'sine', freq: 110, freqEnd: 55, start: t0, duration: 0.42, gain: 0.08 });
  tone(ctx, fx.input, { type: 'sawtooth', freq: 220, freqEnd: 880, start: t0 + 0.04, duration: 0.28, gain: 0.028 });
  tone(ctx, fx.input, { type: 'square', freq: 164, freqEnd: 980, start: t0 + 0.1, duration: 0.2, gain: 0.018 });

  const blips = [988, 1175, 1480, 1976];
  blips.forEach((freq, i) => {
    tone(ctx, fx.input, {
      type: i % 2 ? 'triangle' : 'square',
      freq,
      start: t0 + 0.22 + i * 0.055,
      duration: 0.05,
      gain: 0.045 - i * 0.004,
    });
  });

  tone(ctx, fx.input, { type: 'sine', freq: 659, start: t0 + 0.46, duration: 0.22, gain: 0.05 });
  tone(ctx, fx.input, { type: 'sine', freq: 988, start: t0 + 0.46, duration: 0.26, gain: 0.06 });
  tone(ctx, fx.input, { type: 'triangle', freq: 1319, start: t0 + 0.52, duration: 0.3, gain: 0.04 });
  tone(ctx, fx.input, { type: 'sine', freq: 1976, start: t0 + 0.58, duration: 0.18, gain: 0.022 });

  fx.master.gain.setValueAtTime(1, t0);
  fx.master.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.92);

  await new Promise((resolve) => {
    window.setTimeout(resolve, 820);
  });
}
