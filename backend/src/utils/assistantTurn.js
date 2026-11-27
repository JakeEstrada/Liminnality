function spokenWords(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A hello with no shop question. "hey hello" counts. "hello, which jobs" does not. */
function isGreeting(text) {
  const spoken = spokenWords(text);
  if (!spoken || spoken.length > 48) return false;
  return /^(?:hey|hi|hello|howdy|yo|good morning|good afternoon|good evening)(?:\s+(?:there|hello|hi|hey|liminality|liminnality))*$/.test(
    spoken,
  );
}

function greetingReply() {
  return 'Hello. Ask me about a job, a payment, or how search works.';
}

module.exports = {
  isGreeting,
  greetingReply,
};
