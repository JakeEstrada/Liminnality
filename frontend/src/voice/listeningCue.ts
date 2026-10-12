const CUE_URL = '/sfx/liminality-listen.mp3';
const CUE_FALLBACK_MS = 1600;

let cueAudio: HTMLAudioElement | null = null;

function getCueAudio() {
  if (typeof window === 'undefined') return null;
  if (!cueAudio) {
    cueAudio = new Audio(CUE_URL);
    cueAudio.preload = 'auto';
  }
  return cueAudio;
}

export function unlockListeningCue() {
  const audio = getCueAudio();
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

/** First hit from the shop UI SFX pack. Mic should be paused while this plays. */
export async function playListeningCue() {
  const audio = getCueAudio();
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
    const timer = window.setTimeout(done, CUE_FALLBACK_MS);
  });
}
