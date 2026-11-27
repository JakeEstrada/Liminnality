export const HELP_GREETING_REPLY = 'Hello. Ask me about a job, a payment, or how search works.';

export function isHelpGreeting(text: string) {
  const spoken = String(text || '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!spoken || spoken.length > 48) return false;
  return /^(?:hey|hi|hello|howdy|yo|good morning|good afternoon|good evening)(?:\s+(?:there|hello|hi|hey|liminality|liminnality))*$/.test(
    spoken,
  );
}

/** Spoken phrases that end the help-window conversation. */
export function isHelpVoiceStop(text: string) {
  const spoken = String(text || '')
    .toLowerCase()
    .replace(/[^a-z\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return /^(stop|cancel|never mind|goodbye|good bye|that'?s enough|shut up|stop talking|done)$/.test(spoken);
}
