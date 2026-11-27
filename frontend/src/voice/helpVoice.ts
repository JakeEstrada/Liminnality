/** Spoken phrases that end the help-window conversation. */
export function isHelpVoiceStop(text: string) {
  const spoken = String(text || '')
    .toLowerCase()
    .replace(/[^a-z\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return /^(stop|cancel|never mind|goodbye|good bye|that'?s enough|shut up|stop talking|done)$/.test(spoken);
}
