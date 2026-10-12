export type ListeningCueKind = 'start' | 'close';

const CUE_URLS: Record<ListeningCueKind, string> = {
  start: '/sfx/liminality-listen-start.mp3',
  close: '/sfx/liminality-listen-close.mp3',
};

const CUE_FALLBACK_MS: Record<ListeningCueKind, number> = {
  start: 2200,
  close: 1400,
};

const cueAudio: Partial<Record<ListeningCueKind, HTMLAudioElement>> = {};

function getCueAudio(kind: ListeningCueKind) {
  if (typeof window === 'undefined') return null;
  if (!cueAudio[kind]) {
    const audio = new Audio(CUE_URLS[kind]);
    audio.preload = 'auto';
    cueAudio[kind] = audio;
  }
  return cueAudio[kind] || null;
}

function unlockOne(kind: ListeningCueKind) {
  const audio = getCueAudio(kind);
  if (!audio) return;
  audio.muted = true;
  void audio
    .play()
    .then(() => {
      audio.pause();
      audio.currentTime = 0;
      audio.muted = false;
    })
    .catch(() => {
      audio.muted = false;
    });
}

export function unlockListeningCue() {
  unlockOne('start');
  unlockOne('close');
}

/** Start = 0:00–1.99. Close = 8:00–8.99. Mic should be paused while this plays. */
export async function playListeningCue(kind: ListeningCueKind = 'start') {
  const audio = getCueAudio(kind);
  if (!audio) return;
  try {
    audio.pause();
    audio.muted = false;
    audio.currentTime = 0;
    await audio.play();
  } catch {
    return;
  }
  await new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      audio.removeEventListener('ended', done);
      window.clearTimeout(timer);
      resolve();
    };
    audio.addEventListener('ended', done);
    const timer = window.setTimeout(done, CUE_FALLBACK_MS[kind]);
  });
}
